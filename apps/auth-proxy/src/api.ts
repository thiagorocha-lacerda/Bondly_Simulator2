/**
 * Camada de API /api/* (prompt §5/§6/§8) — PURA e testável sem servidor HTTP.
 *
 * Recebe a sessão já verificada, o método, o caminho, o corpo JSON parseado, o repositório e a config;
 * devolve { status, body?, session? }. O enforcement de RBAC roda AQUI, no servidor — o front nunca é
 * a fronteira. Payloads saem filtrados por papel (projection.ts). A máquina de estados da esteira
 * (/transition) é ligada no passo 5; aqui entregam-se identidade, 2º fator, CRUD de inputs e leitura.
 */
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';
import { can, ACTIONS, ROLES, ROLE_LABELS, isRole, type Role } from './rbac.js';
import { verifyProfileCode } from './profileCodes.js';
import {
  checkText,
  checkTextList,
  isPauseReasonCode,
  PAUSE_REASON_LABELS,
  PAUSE_REASON_CODES,
  MAX_PAUSE_REASON_CHARS,
  MAX_SHORT_CHARS,
  type PauseReasonCode,
} from './limits.js';
import { resolveEffectiveRole, normalizeAssignableEmail } from './assignments.js';
import {
  type ProposalRepository,
  type CommercialInput,
  type TechnicalInput,
  type SlaEventRow,
  type Proposal,
  VersionConflictError,
  NotFoundError,
  NotIssuedError,
  LastAdminError,
  ApprovalConflictError,
  IssuedImmutableError,
  formatProposalId,
  type ApprovalRequest,
} from './domain.js';
import { logRbacChange, logRbacDenied, logOwnerReassigned, logApprovalEvent, logPricingQuote, logEmissionBlocked } from './securityLog.js';
import { parsePricingInput } from './quoteInput.js';
import { computeQuote, persistedPricingInput, emissionGate, publicCatalog } from './pricingQuote.js';
import { isQuoteView, resolveView, QUOTE_CONTRACT_VERSION } from './quoteProjection.js';
import { createRateLimiter } from './rateLimit.js';
import { MAX_QUOTE_BODY_CHARS, QUOTE_RATE_LIMIT } from './limits.js';
import { canAccessProposal, canAccessResumedHistory } from './scope.js';
import { projectProposal, projectAudit } from './projection.js';
import {
  canTransition,
  isMaterialChange,
  canRequestApproval,
  violatesSeparationOfDuties,
} from './workflow.js';
import { APPROVAL_KIND_LABELS, isApprovalKind } from './limits.js';
import {
  reduceSla,
  defaultSlaConfig,
  buildHolidaySet,
  canMeetingTransition,
  MEETING_INITIAL,
  computeSlaIndicatorsFromEvents,
  type SlaEvent,
  type TechnicalVerdict,
} from '@bondly/pricing-engine';

/** Calendário de feriados efetivo do SLA (base nacional BR; extras viriam da config). */
const SLA_HOLIDAYS = buildHolidaySet();
const SLA_CONFIG = defaultSlaConfig(SLA_HOLIDAYS);

/**
 * Reconstrói os eventos tipados do engine a partir das rows persistidas (ordenadas por `at`).
 * `reasonMode`: 'free' = texto livre da trilha (estado do SLA da proposta, visão interna);
 * 'catalog' = rótulo do catálogo fechado (G-005: único valor agregado em /api/sla/indicators).
 */
function toEngineEvents(rows: readonly SlaEventRow[], reasonMode: 'free' | 'catalog' = 'free'): SlaEvent[] {
  return [...rows]
    .sort((a, b) => a.at - b.at)
    .map((r): SlaEvent => {
      const p = r.payload;
      switch (r.kind) {
        case 'started':
          return { kind: 'started', at: r.at, by: r.by, briefingVersion: Number(p.briefingVersion ?? 1) };
        case 'paused':
          return {
            kind: 'paused',
            at: r.at,
            by: r.by,
            reason:
              reasonMode === 'catalog'
                ? PAUSE_REASON_LABELS[isPauseReasonCode(p.reasonCode) ? p.reasonCode : 'outro']
                : String(p.reason ?? ''),
            missingItems: Array.isArray(p.missingItems) ? (p.missingItems as string[]) : [],
          };
        case 'resumed':
          return {
            kind: 'resumed',
            at: r.at,
            by: r.by,
            confirmedItems: Array.isArray(p.confirmedItems) ? (p.confirmedItems as string[]) : [],
          };
        case 'completed': {
          const verdicts: readonly TechnicalVerdict[] = ['aprovado', 'aprovado_com_ressalvas', 'ajustes_necessarios', 'inviavel'];
          const v = verdicts.includes(p.verdict as TechnicalVerdict) ? (p.verdict as TechnicalVerdict) : 'aprovado';
          return { kind: 'completed', at: r.at, by: r.by, verdict: v };
        }
      }
    });
}

/** G-001-A: limitador da cotação (por usuário). Exportado para os testes reiniciarem o estado. */
export const quoteRateLimiter = createRateLimiter(QUOTE_RATE_LIMIT);

export interface ApiResult {
  readonly status: number;
  readonly body?: unknown;
  /** cabeçalhos extras (ex.: Retry-After no 429). */
  readonly headers?: Readonly<Record<string, string>>;
  /** quando presente, o servidor deve reemitir o cookie de sessão com estes dados (ex.: após unlock). */
  readonly session?: Omit<SessionData, 'exp'>;
}

function json(status: number, body: unknown): ApiResult {
  return { status, body };
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Trata uma rota /api/*. `session` é a sessão verificada (ou null). `body` é o JSON já parseado.
 * Retorna 401 sem sessão, 403 sem papel/ação, 409 em conflito de versão, 404 inexistente.
 */
export async function handleApi(args: Parameters<typeof handleApiInner>[0]): Promise<ApiResult> {
  try {
    return await handleApiInner(args);
  } catch (e) {
    // G-029: lock persistente do SQLite ⇒ 503 claro (retry do cliente), nunca 500 opaco.
    if (e instanceof Error && e.name === 'StorageBusyError') return { status: 503, body: { error: 'storage_busy' } };
    throw e;
  }
}

async function handleApiInner(args: {
  method: string;
  path: string;
  session: SessionData | null;
  body: unknown;
  repo: ProposalRepository;
  cfg: ServerConfig;
}): Promise<ApiResult> {
  const { method, path, session, body, repo, cfg } = args;

  if (!session) return json(401, { error: 'unauthenticated' });
  // Perfil resolvido do REPOSITÓRIO a cada request (revogação imediata) — nunca confiado ao cookie.
  const effective = await resolveEffectiveRole(session, repo, cfg);
  const role: Role | undefined = effective?.role;

  // --- identidade (inclui papel atual e permissões, para a UI REFLETIR — o servidor continua sendo a fronteira) ---
  if (path === '/api/me' && method === 'GET') {
    return json(200, {
      email: session.email,
      name: session.name ?? null,
      picture: session.picture ?? null,
      domain: session.domain,
      role: role ?? null,
      roleLabel: role ? ROLE_LABELS[role] : null,
      roleSource: effective?.source ?? null,
      // G-008: permissões coerentes com o PAPEL EFETIVO — o admin LEGADO não gerencia atribuições
      // (a rota exige source=assignment), então não anuncia admin.manage_users.
      permissions: role ? ACTIONS.filter((a) => can(role, a) && !(a === 'admin.manage_users' && effective?.source !== 'assignment')) : [],
      legacyProfileCodes: cfg.legacyProfileCodes === true,
    });
  }

  // --- 2º fator LEGADO (DEPRECATED): só com LEGACY_PROFILE_CODES=true; nunca concede `approver` ---
  if (path === '/api/profile/unlock' && method === 'POST') {
    if (cfg.legacyProfileCodes !== true) return json(403, { error: 'legacy_profile_codes_disabled' });
    const b = (body ?? {}) as { role?: unknown; code?: unknown };
    const reqRole = typeof b.role === 'string' ? b.role : '';
    const code = typeof b.code === 'string' ? b.code : '';
    const result = verifyProfileCode(reqRole, code, cfg.profileCodeHashes);
    if (!result.ok) {
      // mensagem genérica; motivo fica no log do servidor, não no corpo (anti-enumeração)
      return json(result.reason === 'unknown_role' ? 400 : 401, { error: 'unlock_failed' });
    }
    const next: Omit<SessionData, 'exp'> = {
      email: session.email,
      ...(session.name !== undefined ? { name: session.name } : {}),
      ...(session.picture !== undefined ? { picture: session.picture } : {}),
      domain: session.domain,
      role: result.role,
    };
    return { status: 200, body: { role: result.role }, session: next };
  }

  // A partir daqui, tudo exige um perfil atribuído (deny-by-default): autenticado sem perfil ⇒ 403.
  if (!role) return json(403, { error: 'profile_required' });

  /**
   * G-002 — PONTO ÚNICO do guard de escopo por dono. Toda rota que recebe :id de proposta (leitura, escrita,
   * transição, reuniões, SLA, aprovação, auditoria) carrega a proposta SOMENTE por aqui. Inexistente e fora do
   * escopo são indistinguíveis (null ⇒ 404 `not_found`); a negação por escopo gera o log `rbac_denied`
   * (pseudônimo HMAC, sem e-mail em claro). A checagem de AÇÃO (403) vem ANTES e independe do recurso,
   * então não vaza existência.
   */
  const visible = async (id: string): Promise<Proposal | null> => {
    const p = await repo.get(id);
    if (!p) return null;
    if (canAccessProposal(role, session.email, p)) return p;
    logRbacDenied({ actor: session.email, role, method, path, reason: 'owner_scope' });
    return null;
  };
  /**
   * G-021: tech/approver mantêm acesso ao HISTÓRICO (SLA, auditoria, reuniões) de proposta que JÁ foi submetida
   * e voltou ao rascunho via `retomar` — o relógio e as decisões continuam existindo. Rascunho nunca submetido
   * continua invisível (G-002 intacto); a LEITURA/ESCRITA do corpo da proposta continua só via `visible`.
   */
  const visibleHistory = async (id: string): Promise<Proposal | null> => {
    const p = await repo.get(id);
    if (!p) return null;
    if (canAccessProposal(role, session.email, p)) return p;
    if (canAccessResumedHistory(role, p, (await repo.audit(id)).some((e) => e.action === 'transition.submeter_analise'))) return p;
    logRbacDenied({ actor: session.email, role, method, path, reason: 'owner_scope' });
    return null;
  };
  /** Escritas de business só passam se o dono ATUAL ainda for o ator (fecha a corrida com a reatribuição). */
  const ownerOpt = role === 'business' ? { requireOwner: session.email } : undefined;

  /**
   * G-023/G-024: edição comercial/técnica via `repo.editProposal` — update + invalidação das solicitações (QUALQUER kind
   * pendente, mais as aprovadas afetadas) + auditoria numa ÚNICA transação. Edição NÃO material com solicitação pendente
   * ⇒ 409 `approval_pending`. Mudança material com pendência devolve a proposta ao estado ANTERIOR à solicitação já
   * rebaixado por `statusAfterMaterialEdit` (reanálise), então a decisão posterior não restaura estado emitível.
   */
  const editViaRepo = async (id: string, v: number, edit: 'commercial' | 'technical', patch: { commercial?: CommercialInput; technical?: TechnicalInput }, material: boolean): Promise<ApiResult> => {
    try {
      const r = await repo.editProposal({
        id, expectedVersion: v, edit, patch, material, actor: { email: session.email, role },
        action: edit === 'commercial' ? 'proposal.edit_commercial' : 'proposal.edit_technical',
        ...(ownerOpt ? { requireOwner: ownerOpt.requireOwner } : {}),
      });
      for (const x of r.invalidated) logApprovalEvent({ evt: 'rbac_approval_invalidated', actor: session.email, proposalId: id, requestId: x.id, kind: x.kind });
      return json(200, { proposal: projectProposal(r.proposal, role), invalidated: r.stateInvalidated, approvalsInvalidated: r.invalidated.length });
    } catch (e) {
      if (e instanceof ApprovalConflictError && e.code === 'approval_pending') return json(409, { error: 'approval_pending' });
      if (e instanceof IssuedImmutableError) return json(409, { error: 'proposal_issued_immutable' });
      return mapRepoError(e);
    }
  };

  // --- gestão de atribuições de perfil (admin) — SOMENTE por atribuição individual, nunca por código legado ---
  if (path === '/api/admin/assignments') {
    if (!can(role, 'admin.manage_users') || effective?.source !== 'assignment') {
      logRbacDenied({ actor: session.email, role, method, path }); // G-007: tentativa negada (sem e-mail em claro)
      return json(403, { error: 'forbidden' });
    }
    if (method === 'GET') {
      return json(200, { assignments: await repo.listAssignments(), audit: await repo.assignmentAudit(), roles: ROLES });
    }
    if (method === 'PUT') {
      const b = (body ?? {}) as { email?: unknown; role?: unknown };
      const target = normalizeAssignableEmail(b.email);
      if (!target) return json(400, { error: 'email_not_allowed' });
      if (b.role !== null && !isRole(b.role)) return json(400, { error: 'invalid_role' });
      try {
        const entry = await repo.setAssignment(target, b.role as Role | null, session.email);
        logRbacChange({ actor: session.email, target, from: entry.fromRole, to: entry.toRole }); // G-007
        return json(200, { audit: entry, assignments: await repo.listAssignments() });
      } catch (e) {
        if (e instanceof LastAdminError) return json(409, { error: 'last_admin' });
        throw e;
      }
    }
    return json(404, { error: 'not_found' });
  }

  // --- G-002: reatribuição de dono (admin-only, atribuição individual) + auditoria append-only ---
  const mOwner = path.match(/^\/api\/admin\/proposals\/([A-Za-z0-9-]+)\/owner$/);
  if (mOwner) {
    if (!can(role, 'admin.reassign_owner') || effective?.source !== 'assignment') {
      logRbacDenied({ actor: session.email, role, method, path });
      return json(403, { error: 'forbidden' });
    }
    const id = mOwner[1]!;
    const current = await repo.get(id);
    if (!current) return json(404, { error: 'not_found' });
    if (method === 'GET') {
      return json(200, { proposalId: id, ownerEmail: current.ownerEmail, version: current.version, audit: await repo.ownerAudit(id) });
    }
    if (method === 'PUT' || method === 'POST') {
      const b = (body ?? {}) as { ownerEmail?: unknown; version?: unknown };
      const target = normalizeAssignableEmail(b.ownerEmail);
      if (!target) return json(400, { error: 'email_not_allowed' });
      // G-022: `version` OBRIGATÓRIA (lock otimista); ausente/inválida ⇒ 400, defasada ⇒ 409.
      const v = num(b.version);
      if (v === null) return json(400, { error: 'version_required' });
      if (v !== current.version) return json(409, { error: 'version_conflict', actual: current.version });
      // ASSUMPTION: reatribuir para o mesmo dono é no-op idempotente (200, sem auditoria nem bump de versão).
      if (target === current.ownerEmail.trim().toLowerCase()) {
        return json(200, { changed: false, proposal: projectProposal(current, role), audit: await repo.ownerAudit(id) });
      }
      // G-021: o novo dono precisa ter perfil `business` atribuído — senão a proposta fica órfã/inalcançável
      // (tech/approver/admin não editam como dono; sem perfil nem lê). Rejeita antes de qualquer escrita.
      const targetRole = await repo.getAssignment(target);
      if (!targetRole) return json(400, { error: 'new_owner_without_role' });
      if (targetRole.role !== 'business') return json(400, { error: 'new_owner_not_business' });
      try {
        const r = await repo.reassignOwner(id, target, session.email);
        logOwnerReassigned({ actor: session.email, proposalId: id, from: r.audit.fromOwner, to: target });
        return json(200, { changed: true, proposal: projectProposal(r.proposal, role), audit: await repo.ownerAudit(id) });
      } catch (e) {
        return mapRepoError(e);
      }
    }
    return json(404, { error: 'not_found' });
  }

  // ───────────── G-001-A: cotação NO SERVIDOR (Pricing Engine = fonte única) com projeção por perfil ─────────────
  if (path === '/api/pricing/catalog' && method === 'GET') {
    if (!can(role, 'pricing.quote')) {
      logRbacDenied({ actor: session.email, role, method, path });
      return json(403, { error: 'forbidden' });
    }
    return json(200, { catalog: publicCatalog() });
  }

  if (path === '/api/pricing/quote' && method === 'POST') {
    if (!can(role, 'pricing.quote')) {
      logRbacDenied({ actor: session.email, role, method, path });
      return json(403, { error: 'forbidden' });
    }
    const rl = quoteRateLimiter.hit(session.email.trim().toLowerCase());
    if (!rl.ok) return { status: 429, body: { error: 'rate_limited' }, headers: { 'Retry-After': String(rl.retryAfterSec) } };
    const b = body;
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return json(400, { error: 'invalid_body' });
    if (JSON.stringify(b).length > MAX_QUOTE_BODY_CHARS) return json(413, { error: 'payload_too_large' });
    const q = b as { contractVersion?: unknown; view?: unknown; input?: unknown; proposalId?: unknown };
    for (const k of Object.keys(q)) if (!['contractVersion', 'view', 'input', 'proposalId'].includes(k)) return json(400, { error: 'invalid_body', field: k });
    if (q.contractVersion !== undefined && q.contractVersion !== QUOTE_CONTRACT_VERSION) return json(400, { error: 'unsupported_contract_version', supported: QUOTE_CONTRACT_VERSION });
    if (q.view !== undefined && !isQuoteView(q.view)) return json(400, { error: 'invalid_view' });
    const view = resolveView(q.view as Parameters<typeof resolveView>[0], role);
    if (!view) {
      logRbacDenied({ actor: session.email, role, method, path, reason: 'quote_view' });
      return json(403, { error: 'view_forbidden' });
    }
    let proposalId: string | undefined;
    let input: ReturnType<typeof persistedPricingInput> = null;
    if (q.proposalId !== undefined) {
      if (typeof q.proposalId !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(q.proposalId)) return json(400, { error: 'invalid_proposal_id' });
      // G-002: mesmo guard de dono de toda rota com :id (inexistente e fora do escopo ⇒ 404 indistinguíveis).
      const p = await visible(q.proposalId);
      if (!p) return json(404, { error: 'not_found' });
      proposalId = p.id;
      if (q.input === undefined) {
        input = persistedPricingInput(p.commercial);
        if (!input) return json(422, { error: 'proposal_inputs_incomplete' });
      }
    }
    if (q.input !== undefined) {
      const parsed = parsePricingInput(q.input, true);
      if (!parsed.ok) return json(400, { error: parsed.error, field: parsed.field });
      input = parsed.input;
    }
    if (!input) return json(400, { error: 'input_required' });
    const out = computeQuote(input, view);
    logPricingQuote({ actor: session.email, role, view, ...(proposalId ? { proposalId } : {}), engineVersion: out.result.engineVersion });
    return json(200, { quote: out.view });
  }

  // --- indicadores gerenciais de SLA (P75/P90 do tempo útil efetivo) — SEM custo/margem no payload ---
  if (path === '/api/sla/indicators' && method === 'GET') {
    if (!can(role, 'sla.view_indicators')) return json(403, { error: 'forbidden' });
    const rows = await repo.allSlaEvents();
    const byProposal = new Map<string, SlaEventRow[]>();
    for (const r of rows) byProposal.set(r.proposalId, [...(byProposal.get(r.proposalId) ?? []), r]);
    const indicators = computeSlaIndicatorsFromEvents([...byProposal.values()].map((r) => toEngineEvents(r, 'catalog')), SLA_CONFIG);
    return json(200, {
      indicators,
      basis: 'tempo_util_efetivo', // dias úteis consumidos, excluindo pausas; 'raw' = tempo bruto (comparativo)
      percentileMethod: 'nearest-rank',
      generatedAt: new Date().toISOString(),
    });
  }

  // ───────────── G-006: solicitações ao Gestor/Aprovador ─────────────
  // Fila do aprovador — filtrada NO SERVIDOR: só pendentes de propostas que o papel alcança (nunca rascunho),
  // sem custo/margem/commercial/technical (só metadados + justificativa).
  if (path === '/api/approvals/pending' && method === 'GET') {
    if (!can(role, 'approval.read_queue')) {
      logRbacDenied({ actor: session.email, role, method, path });
      return json(403, { error: 'forbidden' });
    }
    const out: ReturnType<typeof approvalView>[] = [];
    for (const r of await repo.listApprovalRequests({ status: 'pending' })) {
      const p = await repo.get(r.proposalId);
      if (p && canAccessProposal(role, session.email, p)) out.push(approvalView(r, p.status));
    }
    return json(200, { requests: out });
  }

  // Solicitações de UMA proposta (status/decisão visíveis ao dono, a P&T e ao aprovador — mesmo guard de escopo).
  const mReqList = path.match(/^\/api\/proposals\/([A-Za-z0-9-]+)\/approval-requests$/);
  if (mReqList && method === 'GET') {
    if (!can(role, 'proposal.read')) return json(403, { error: 'forbidden' });
    const p = await visible(mReqList[1]!);
    if (!p) return json(404, { error: 'not_found' });
    return json(200, { requests: (await repo.listApprovalRequests({ proposalId: p.id })).map((r) => approvalView(r, p.status)) });
  }

  // Criar solicitação: business (excecao_comercial, alteracao_escopo — só nas PRÓPRIAS) / tech (replanejamento_sla).
  if (mReqList && method === 'POST') {
    if (!can(role, 'approval.request')) {
      logRbacDenied({ actor: session.email, role, method, path });
      return json(403, { error: 'forbidden' });
    }
    const id = mReqList[1]!;
    const b = (body ?? {}) as { kind?: unknown; justification?: unknown; version?: unknown };
    if (!isApprovalKind(b.kind)) return json(400, { error: 'invalid_kind' });
    const kind = b.kind;
    const jc = checkText(b.justification, 'justification'); // limite central (500)
    if (!jc.ok) return json(400, { error: jc.error, field: jc.field });
    if (!jc.value) return json(400, { error: 'justification_required' });
    const v = num(b.version);
    if (v === null) return json(400, { error: 'version_required' });
    const current = await visible(id);
    if (!current) return json(404, { error: 'not_found' });
    const rule = canRequestApproval(current.status, kind, role);
    if (!rule.ok) return json(rule.reason === 'wrong_role' ? 403 : 409, { error: `approval_${rule.reason}` });
    try {
      const r = await repo.createApprovalRequest({
        proposalId: id,
        kind,
        requestedBy: session.email,
        requestedByRole: role,
        justification: jc.value,
        expectedVersion: v,
        fromState: current.status,
        ...(ownerOpt ? { requireOwner: ownerOpt.requireOwner } : {}),
      });
      logApprovalEvent({ evt: 'rbac_approval_requested', actor: session.email, proposalId: id, requestId: r.request.id, kind });
      return json(201, { request: approvalView(r.request, r.proposal.status), proposal: projectProposal(r.proposal, role) });
    } catch (e) {
      if (e instanceof ApprovalConflictError) return json(409, { error: e.code === 'pending_exists' ? 'approval_pending_exists' : 'approval_invalid_from' });
      return mapRepoError(e);
    }
  }

  // Decidir: SÓ `approver` (approval.decide). Admin e solicitante NÃO decidem. Idempotente (200) / conflito (409).
  const mDecide = path.match(/^\/api\/approval-requests\/([A-Za-z0-9-]+)\/decision$/);
  if (mDecide && method === 'POST') {
    if (!can(role, 'approval.decide')) {
      logRbacDenied({ actor: session.email, role, method, path });
      return json(403, { error: 'forbidden' });
    }
    const reqRow = await repo.getApprovalRequest(mDecide[1]!);
    const prop = reqRow ? await repo.get(reqRow.proposalId) : null;
    // escopo G-002: o aprovador só alcança solicitação cuja proposta já saiu do rascunho; resto = 404 padrão
    if (!reqRow || !prop || !canAccessProposal(role, session.email, prop)) {
      if (reqRow) logRbacDenied({ actor: session.email, role, method, path, reason: 'owner_scope' });
      return json(404, { error: 'not_found' });
    }
    const b = (body ?? {}) as { decision?: unknown; justification?: unknown };
    const decision = b.decision === 'approved' || b.decision === 'rejected' ? b.decision : null;
    if (!decision) return json(400, { error: 'decision_required' });
    const jc = checkText(b.justification, 'justification');
    if (!jc.ok) return json(400, { error: jc.error, field: jc.field });
    if (decision === 'rejected' && !jc.value) return json(400, { error: 'justification_required' }); // rejeição sempre justificada
    // SEPARAÇÃO DE FUNÇÕES: quem solicitou não decide a própria solicitação.
    if (violatesSeparationOfDuties(reqRow.requestedBy, session.email)) {
      logRbacDenied({ actor: session.email, role, method, path, reason: 'self_decision' });
      return json(403, { error: 'self_decision_forbidden' });
    }
    if (reqRow.status === 'invalidated') return json(409, { error: 'approval_invalidated' });
    let res: Awaited<ReturnType<typeof repo.decideApprovalRequest>>;
    try {
      res = await repo.decideApprovalRequest(reqRow.id, decision, { email: session.email, role }, jc.value);
    } catch (e) {
      if (e instanceof ApprovalConflictError && e.code === 'stale') return json(409, { error: 'approval_stale' }); // G-024
      throw e;
    }
    if (!res.created) {
      if (res.request.status === decision) return json(200, { recorded: true, idempotent: true, request: approvalView(res.request, res.proposal.status) });
      return json(409, { error: res.request.status === 'invalidated' ? 'approval_invalidated' : 'decision_conflict', existing: res.request.status });
    }
    logApprovalEvent({ evt: 'rbac_approval_decided', actor: session.email, proposalId: reqRow.proposalId, requestId: reqRow.id, kind: reqRow.kind, decision });
    return json(201, { recorded: true, request: approvalView(res.request, res.proposal.status), proposal: projectProposal(res.proposal, role) });
  }

  // --- decisão do aprovador LEGADA (G-018; sem efeito na esteira — mantida por compatibilidade) ---
  const mApproval = path.match(/^\/api\/proposals\/([A-Za-z0-9-]+)\/approval$/);
  if (mApproval && method === 'POST') {
    if (!can(role, 'approval.decide')) return json(403, { error: 'forbidden' });
    const id = mApproval[1]!;
    if (!(await visible(id))) return json(404, { error: 'not_found' });
    const b = (body ?? {}) as { decision?: unknown; kind?: unknown; note?: unknown };
    const decision = b.decision === 'approved' || b.decision === 'rejected' ? b.decision : null;
    if (!decision) return json(400, { error: 'decision_required' });
    const kinds = ['excecao_comercial', 'alteracao_escopo', 'replanejamento'];
    const kind = typeof b.kind === 'string' && kinds.includes(b.kind) ? b.kind : null;
    if (!kind) return json(400, { error: 'kind_required' });
    const noteC = checkText(b.note, 'note');
    if (!noteC.ok) return json(400, { error: noteC.error, field: noteC.field });
    const note = noteC.value;
    if (!note) return json(400, { error: 'note_required' }); // decisão justificada
    // G-006 (parte segura) + G-018: decisão ATÔMICA no repositório (UNIQUE(proposal_id, kind)).
    // Vencedor ⇒ 201; mesmo resultado repetido ⇒ 200 idempotente; resultado divergente ⇒ 409.
    // NÃO há efeito na esteira nem UI (aguarda DECISÃO do sponsor — doc 14 G-006).
    // ASSUMPTION: registra a decisão na auditoria (append-only) SEM mudar o estado da esteira.
    const res = await repo.recordApprovalDecision(id, kind, decision, { actorEmail: session.email, role, note });
    if (!res.created) {
      if (res.decision === decision) return json(200, { recorded: true, idempotent: true, decision, kind });
      return json(409, { error: 'decision_conflict', existing: res.decision });
    }
    return json(201, { recorded: true, decision, kind });
  }

  // --- listar propostas ---
  if (path === '/api/proposals' && method === 'GET') {
    if (!can(role, 'proposal.read')) return json(403, { error: 'forbidden' });
    // G-002: filtrado NO SERVIDOR pelo mesmo guard; sem totais/contagens/paginação que revelem propostas alheias.
    const all = (await repo.list()).filter((p) => canAccessProposal(role, session.email, p));
    return json(200, { proposals: all.map((p) => projectProposal(p, role)) });
  }

  // --- criar proposta (rascunho comercial) ---
  if (path === '/api/proposals' && method === 'POST') {
    if (!can(role, 'proposal.create')) return json(403, { error: 'forbidden' });
    const b = (body ?? {}) as { commercial?: CommercialInput };
    const seq = await repo.nextSequence();
    const id = formatProposalId(seq);
    const p = await repo.create(
      { id, ownerEmail: session.email, commercial: b.commercial ?? {} },
      { actorEmail: session.email, role, action: 'proposal.create', toState: 'rascunho_comercial' },
    );
    return json(201, { proposal: projectProposal(p, role) });
  }

  // --- reunião técnica com o cliente (§6.3) ---
  // listar reuniões de uma proposta
  const mList = path.match(/^\/api\/proposals\/([A-Za-z0-9-]+)\/meetings$/);
  if (mList && method === 'GET') {
    // G-004: objetivo e log técnico das reuniões são conteúdo interno ⇒ exige proposal.see_internal
    // (business/approver recebem 403; não há projeção resumida nesta versão).
    if (!can(role, 'proposal.read') || !can(role, 'proposal.see_internal')) return json(403, { error: 'forbidden' });
    const id = mList[1]!;
    if (!(await visibleHistory(id))) return json(404, { error: 'not_found' });
    const list = await repo.meetings(id);
    return json(200, { meetings: list });
  }
  // solicitar uma reunião (estado inicial 'solicitada') — só quem gere o SLA técnico
  if (mList && method === 'POST') {
    if (!can(role, 'sla.manage')) return json(403, { error: 'forbidden' });
    const id = mList[1]!;
    const current = await visibleHistory(id);
    if (!current) return json(404, { error: 'not_found' });
    const b = (body ?? {}) as { objective?: unknown; scheduledFor?: unknown };
    const objC = checkText(b.objective, 'objective');
    if (!objC.ok) return json(400, { error: objC.error, field: objC.field });
    const objective = objC.value;
    if (!objective) return json(400, { error: 'objective_required' });
    const schC = checkText(b.scheduledFor, 'scheduledFor', MAX_SHORT_CHARS);
    if (!schC.ok) return json(400, { error: schC.error, field: schC.field });
    const scheduledFor = schC.value || undefined;
    const rec = await repo.createMeeting({ proposalId: id, objective, by: session.email, ...(scheduledFor ? { scheduledFor } : {}) });
    // §6.4: solicitar reunião NÃO pausa o SLA automaticamente — nenhum evento de pausa é emitido aqui.
    return json(201, { meeting: rec, slaUnaffected: true });
  }
  // transicionar uma reunião (agendar, realizar, aguardar/receber insumos, retomar, cancelar)
  const mTrans = path.match(/^\/api\/proposals\/([A-Za-z0-9-]+)\/meetings\/([A-Za-z0-9-]+)\/transition$/);
  if (mTrans && method === 'POST') {
    if (!can(role, 'sla.manage')) return json(403, { error: 'forbidden' });
    const meetingId = mTrans[2]!;
    if (!(await visibleHistory(mTrans[1]!))) return json(404, { error: 'not_found' });
    const all = await repo.meetings(mTrans[1]!);
    const meeting = all.find((m) => m.id === meetingId);
    if (!meeting) return json(404, { error: 'not_found' });
    const b = (body ?? {}) as { transition?: unknown; note?: unknown; scheduledFor?: unknown };
    const name = typeof b.transition === 'string' ? b.transition : '';
    const decision = canMeetingTransition(meeting.state as Parameters<typeof canMeetingTransition>[0], name);
    if (!decision.ok) return json(409, { error: `meeting_${decision.reason}` });
    const noteC = checkText(b.note, 'note');
    if (!noteC.ok) return json(400, { error: noteC.error, field: noteC.field });
    const note = noteC.value || undefined;
    // cancelamento exige justificativa (§6.3)
    if (name === 'cancelar' && !note) return json(400, { error: 'note_required' });
    const schC = checkText(b.scheduledFor, 'scheduledFor', MAX_SHORT_CHARS);
    if (!schC.ok) return json(400, { error: schC.error, field: schC.field });
    const scheduledFor = schC.value || undefined;
    const rec = await repo.updateMeeting(meetingId, {
      state: decision.to,
      logEntry: { at: Date.now(), by: session.email, transition: name, toState: decision.to, ...(note ? { note } : {}) },
      ...(scheduledFor !== undefined ? { scheduledFor } : {}),
    });
    return json(200, { meeting: rec });
  }

  // --- G-025: reabertura pós-emissão (approver/admin) — cria NOVA VERSÃO; a emitida permanece imutável ---
  const mReopen = path.match(/^\/api\/proposals\/([A-Za-z0-9-]+)\/reopen$/);
  if (mReopen && method === 'POST') {
    if (!can(role, 'proposal.reopen')) {
      logRbacDenied({ actor: session.email, role, method, path }); // business/tech ⇒ 403 (sem e-mail em claro)
      return json(403, { error: 'forbidden' });
    }
    const id = mReopen[1]!;
    // G-002: mesmo guard de escopo de toda rota com :id (inexistente/fora de escopo ⇒ 404 indistinguíveis).
    const current = await visible(id);
    if (!current) return json(404, { error: 'not_found' });
    // Só proposta `emitido` reabre — qualquer outro estado ⇒ 409 `not_issued`.
    if (current.status !== 'emitido') return json(409, { error: 'not_issued' });
    const b = (body ?? {}) as { reason?: unknown };
    const rc = checkText(b.reason, 'reason'); // limite central (500) + normalização (vazio/invisível ⇒ '')
    if (!rc.ok) return json(400, { error: rc.error, field: rc.field });
    if (!rc.value) return json(400, { error: 'reason_required' });
    const seq = await repo.nextSequence();
    const newId = formatProposalId(seq);
    try {
      const r = await repo.reopenProposal({ sourceId: id, newId, actor: { email: session.email, role }, reason: rc.value });
      return json(201, { proposal: projectProposal(r.reopened, role), source: projectProposal(r.source, role) });
    } catch (e) {
      if (e instanceof NotIssuedError) return json(409, { error: 'not_issued' });
      return mapRepoError(e);
    }
  }

  // --- rotas com :id ---
  const m = path.match(/^\/api\/proposals\/([A-Za-z0-9-]+)(\/(commercial|technical|audit|transition|sla|sla\/pause|sla\/resume|sla\/complete))?$/);
  if (m) {
    const id = m[1]!;
    const sub = m[3];

    if (!sub && method === 'GET') {
      if (!can(role, 'proposal.read')) return json(403, { error: 'forbidden' });
      const p = await visible(id);
      if (!p) return json(404, { error: 'not_found' });
      return json(200, { proposal: projectProposal(p, role) });
    }

    if (sub === 'audit' && method === 'GET') {
      if (!can(role, 'proposal.read')) return json(403, { error: 'forbidden' });
      if (!(await visibleHistory(id))) return json(404, { error: 'not_found' });
      const entries = await repo.audit(id);
      return json(200, { audit: projectAudit(entries, role) });
    }

    if (sub === 'commercial' && method === 'PUT') {
      if (!can(role, 'proposal.edit_commercial')) return json(403, { error: 'forbidden' });
      const b = (body ?? {}) as { version?: unknown; commercial?: CommercialInput };
      const v = num(b.version);
      if (v === null) return json(400, { error: 'version_required' });
      const current = await visible(id);
      if (!current) return json(404, { error: 'not_found' });
      const nextCommercial = b.commercial ?? {};
      // §5.2: mudança material pós-aprovação invalida a aprovação e retorna à etapa apropriada.
      const material = isMaterialChange('commercial', current.commercial, nextCommercial);
      return editViaRepo(id, v, 'commercial', { commercial: nextCommercial }, material);
    }

    if (sub === 'technical' && method === 'PUT') {
      if (!can(role, 'proposal.edit_technical')) return json(403, { error: 'forbidden' });
      const b = (body ?? {}) as { version?: unknown; technical?: TechnicalInput };
      const v = num(b.version);
      if (v === null) return json(400, { error: 'version_required' });
      const current = await visible(id);
      if (!current) return json(404, { error: 'not_found' });
      const nextTechnical = b.technical ?? {};
      const material = isMaterialChange(
        'technical',
        current.technical as Record<string, unknown> | undefined,
        nextTechnical as Record<string, unknown>,
      );
      return editViaRepo(id, v, 'technical', { technical: nextTechnical }, material);
    }

    // --- SLA técnico (§6) ---
    if (sub === 'sla' && method === 'GET') {
      if (!can(role, 'proposal.read')) return json(403, { error: 'forbidden' });
      const current = await visibleHistory(id);
      if (!current) return json(404, { error: 'not_found' });
      const rows = await repo.slaEvents(id);
      // G-005: quem não vê interno (business/approver) só recebe o motivo do CATÁLOGO, nunca o texto livre.
      const state = reduceSla(toEngineEvents(rows, can(role, 'proposal.see_internal') ? 'free' : 'catalog'), Date.now(), SLA_CONFIG);
      return json(200, { sla: state });
    }

    // pausar / retomar / concluir o relógio — exige sla.manage (tech/admin)
    if ((sub === 'sla/pause' || sub === 'sla/resume' || sub === 'sla/complete') && method === 'POST') {
      if (!can(role, 'sla.manage')) return json(403, { error: 'forbidden' });
      const current = await visibleHistory(id);
      if (!current) return json(404, { error: 'not_found' });
      const rows = await repo.slaEvents(id);
      const prior = reduceSla(toEngineEvents(rows), Date.now(), SLA_CONFIG);
      const sb = (body ?? {}) as Record<string, unknown>;

      if (sub === 'sla/pause') {
        // §6.4: só pausa se o relógio está em andamento; justificativa obrigatória.
        if (prior.phase !== 'em_andamento') return json(409, { error: 'sla_not_running' });
        // G-005: reasonCode (catálogo fechado) é o que agrega; `reason` livre (≤200) fica só na trilha.
        const rc = checkText(sb.reason, 'reason', MAX_PAUSE_REASON_CHARS);
        if (!rc.ok) return json(400, { error: rc.error, field: rc.field });
        const reason = rc.value;
        if (!reason) return json(400, { error: 'reason_required' });
        if (sb.reasonCode !== undefined && !isPauseReasonCode(sb.reasonCode)) {
          return json(400, { error: 'invalid_reason_code', allowed: PAUSE_REASON_CODES });
        }
        const reasonCode: PauseReasonCode = isPauseReasonCode(sb.reasonCode) ? sb.reasonCode : 'outro';
        const mi = checkTextList(sb.missingItems, 'missingItems');
        if (!mi.ok) return json(400, { error: mi.error, field: mi.field });
        await repo.appendSlaEvent({ proposalId: id, kind: 'paused', at: Date.now(), by: session.email, payload: { reason, reasonCode, missingItems: mi.value } });
      } else if (sub === 'sla/resume') {
        if (prior.phase !== 'pausado') return json(409, { error: 'sla_not_paused' });
        const ci = checkTextList(sb.confirmedItems, 'confirmedItems');
        if (!ci.ok) return json(400, { error: ci.error, field: ci.field });
        await repo.appendSlaEvent({ proposalId: id, kind: 'resumed', at: Date.now(), by: session.email, payload: { confirmedItems: ci.value } });
      } else {
        // sla/complete — emite o parecer técnico e congela o relógio.
        if (prior.phase === 'nao_iniciado' || prior.phase === 'concluido') return json(409, { error: 'sla_not_active' });
        const verdicts = ['aprovado', 'aprovado_com_ressalvas', 'ajustes_necessarios', 'inviavel'];
        const verdict = typeof sb.verdict === 'string' && verdicts.includes(sb.verdict) ? sb.verdict : '';
        if (!verdict) return json(400, { error: 'verdict_required' });
        await repo.appendSlaEvent({ proposalId: id, kind: 'completed', at: Date.now(), by: session.email, payload: { verdict } });
      }

      const rowsAfter = await repo.slaEvents(id);
      const state = reduceSla(toEngineEvents(rowsAfter), Date.now(), SLA_CONFIG);
      return json(200, { sla: state });
    }

    if (sub === 'transition' && method === 'POST') {
      const b = (body ?? {}) as { version?: unknown; transition?: unknown; note?: unknown };
      const v = num(b.version);
      if (v === null) return json(400, { error: 'version_required' });
      const current = await visible(id);
      if (!current) return json(404, { error: 'not_found' });
      const name = typeof b.transition === 'string' ? b.transition : '';
      const decision = canTransition(current.status, name, role);
      if (!decision.ok) {
        // emissão exige a ação proposal.emit além da transição (dupla checagem de alçada)
        return json(decision.reason === 'wrong_role' ? 403 : 409, { error: `transition_${decision.reason}` });
      }
      // a emissão também é gated pela ação RBAC proposal.emit (§6.1)
      if (decision.to === 'emitido' && !can(role, 'proposal.emit')) return json(403, { error: 'forbidden' });
      // G-026: a consolidação e a emissão consultam a política NO SERVIDOR, calculada dos inputs PERSISTIDOS
      // (nunca de flag do cliente): margem abaixo do piso exige exceção comercial APROVADA e não invalidada.
      if (decision.to === 'pronto_para_emissao' || decision.to === 'emitido') {
        const gate = emissionGate({
          commercial: current.commercial,
          requests: await repo.listApprovalRequests({ proposalId: id }),
          audit: await repo.audit(id),
          ...(cfg.pricingGuardStrict === true ? { strictUnevaluable: true } : {}),
        });
        if (!gate.ok) {
          logEmissionBlocked({ actor: session.email, proposalId: id, transition: name, error: gate.error });
          return json(409, { error: gate.error, requiredApproval: 'excecao_comercial' });
        }
      }
      const noteC = checkText(b.note, 'note');
      if (!noteC.ok) return json(400, { error: noteC.error, field: noteC.field });
      const note = noteC.value || undefined;
      try {
        const p = await repo.update(
          id,
          v,
          { status: decision.to },
          { actorEmail: session.email, role, action: `transition.${name}`, fromState: current.status, toState: decision.to, ...(note ? { note } : {}) },
          ownerOpt,
        );
        // §6.1 — marco inicial do SLA: ao submeter para análise, o relógio técnico inicia na entrada
        // da fila (briefing completo e encaminhado). Idempotente: só o primeiro 'started' vale.
        if (name === 'submeter_analise') {
          const existing = await repo.slaEvents(id);
          const hasStarted = existing.some((e) => e.kind === 'started');
          if (!hasStarted) {
            await repo.appendSlaEvent({
              proposalId: id,
              kind: 'started',
              at: Date.now(),
              by: session.email,
              payload: { briefingVersion: p.version },
            });
          }
        }
        return json(200, { proposal: projectProposal(p, role) });
      } catch (e) {
        return mapRepoError(e);
      }
    }
  }

  return json(404, { error: 'not_found' });
}

/** Visão da solicitação: metadados + justificativas. NUNCA custo/margem/commercial/technical (ADR doc 15). */
function approvalView(r: ApprovalRequest, proposalStatus: string) {
  return {
    id: r.id,
    proposalId: r.proposalId,
    proposalStatus,
    kind: r.kind,
    kindLabel: APPROVAL_KIND_LABELS[r.kind],
    status: r.status,
    requestedBy: r.requestedBy,
    requestedByRole: r.requestedByRole,
    justification: r.justification,
    proposalVersion: r.proposalVersion,
    createdAt: r.createdAt,
    ageHours: Math.max(0, Math.round(((Date.now() - Date.parse(r.createdAt)) / 3_600_000) * 10) / 10),
    ...(r.decidedBy ? { decidedBy: r.decidedBy } : {}),
    ...(r.decidedAt ? { decidedAt: r.decidedAt } : {}),
    ...(r.decisionJustification ? { decisionJustification: r.decisionJustification } : {}),
    ...(r.decidedProposalVersion !== undefined ? { decidedProposalVersion: r.decidedProposalVersion } : {}),
    ...(r.invalidatedReason ? { invalidatedReason: r.invalidatedReason } : {}),
  };
}

function mapRepoError(e: unknown): ApiResult {
  if (e instanceof VersionConflictError) return json(409, { error: 'version_conflict', actual: e.actual });
  if (e instanceof NotFoundError) return json(404, { error: 'not_found' });
  throw e;
}

/** Papéis que o 2º fator pode conceder, para a tela de desbloqueio. */
export const UNLOCKABLE_ROLES: readonly Role[] = ['business', 'tech', 'admin'];
