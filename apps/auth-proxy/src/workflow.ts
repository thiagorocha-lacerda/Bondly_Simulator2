/**
 * Máquina de estados da esteira Negócios→P&T (prompt §5.2) — PURA e testável.
 *
 * Define as transições válidas, QUEM pode fazer cada uma (papel), e a regra de INVALIDAÇÃO de
 * aprovação por mudança material (§5.2: mudança relevante em módulos/volumes/integrações/horas/
 * descontos/condições invalida aprovações afetadas e retorna à etapa apropriada).
 *
 * O enforcement roda no servidor (api.ts chama `canTransition`); o front nunca decide a transição
 * (§5.2: "não marque aprovada por clique no front; valide no servidor e registre auditoria").
 */
import type { WorkflowState, ApprovalKind } from './domain.js';
import type { Role } from './rbac.js';

/** Nome de transição acionável por um ator. */
export type TransitionName =
  | 'submeter_analise' // Negócios: rascunho → aguardando análise técnica
  | 'iniciar_analise' // P&T: aguardando → em análise
  | 'solicitar_ajustes' // P&T: em análise → ajustes solicitados
  | 'aprovar_tecnico' // P&T: em análise → aprovado tecnicamente
  | 'reprovar' // P&T: em análise → reprovado
  | 'consolidar' // Negócios: aprovado → pronto para emissão
  | 'emitir' // Negócios: pronto para emissão → emitido
  | 'retomar'; // Negócios: ajustes solicitados/reprovado → rascunho (para corrigir)

interface TransitionDef {
  readonly from: readonly WorkflowState[];
  readonly to: WorkflowState;
  readonly role: Role; // papel autorizado a acionar
}

const TRANSITIONS: Readonly<Record<TransitionName, TransitionDef>> = {
  submeter_analise: { from: ['rascunho_comercial', 'ajustes_solicitados'], to: 'aguardando_analise_tecnica', role: 'business' },
  iniciar_analise: { from: ['aguardando_analise_tecnica'], to: 'em_analise_tecnica', role: 'tech' },
  solicitar_ajustes: { from: ['em_analise_tecnica'], to: 'ajustes_solicitados', role: 'tech' },
  aprovar_tecnico: { from: ['em_analise_tecnica'], to: 'aprovado_tecnicamente', role: 'tech' },
  reprovar: { from: ['em_analise_tecnica'], to: 'reprovado', role: 'tech' },
  consolidar: { from: ['aprovado_tecnicamente'], to: 'pronto_para_emissao', role: 'business' },
  emitir: { from: ['pronto_para_emissao'], to: 'emitido', role: 'business' },
  retomar: { from: ['ajustes_solicitados', 'reprovado'], to: 'rascunho_comercial', role: 'business' },
};

export function isTransitionName(v: unknown): v is TransitionName {
  return typeof v === 'string' && v in TRANSITIONS;
}

export type TransitionDecision =
  | { readonly ok: true; readonly to: WorkflowState }
  | { readonly ok: false; readonly reason: 'unknown_transition' | 'wrong_role' | 'invalid_from' };

/**
 * Decide uma transição a partir do estado atual e do papel. PURA.
 * Deny-by-default: transição desconhecida, papel errado ou estado de origem inválido recusam.
 */
export function canTransition(current: WorkflowState, name: string, role: Role | undefined): TransitionDecision {
  if (!isTransitionName(name)) return { ok: false, reason: 'unknown_transition' };
  const def = TRANSITIONS[name];
  if (role !== def.role) return { ok: false, reason: 'wrong_role' };
  if (!def.from.includes(current)) return { ok: false, reason: 'invalid_from' };
  return { ok: true, to: def.to };
}

/** Estados em que uma aprovação técnica já foi concedida e pode ser invalidada por mudança material. */
const APPROVED_STATES: readonly WorkflowState[] = ['aprovado_tecnicamente', 'pronto_para_emissao'];

/**
 * Regra de invalidação (§5.2): se a proposta está num estado pós-aprovação e houve mudança MATERIAL
 * nos inputs, a aprovação é invalidada e a proposta volta ao estado apropriado.
 *   - mudança comercial material → volta a 'aguardando_analise_tecnica' (reanálise)
 *   - mudança técnica material (horas/integrações) → volta a 'em_analise_tecnica'
 * Retorna o novo estado, ou null se nada muda.
 */
export function invalidationOnEdit(
  current: WorkflowState,
  edit: 'commercial' | 'technical',
): WorkflowState | null {
  if (!APPROVED_STATES.includes(current)) return null;
  return edit === 'commercial' ? 'aguardando_analise_tecnica' : 'em_analise_tecnica';
}

/**
 * Determina se uma mudança de inputs é MATERIAL (§5.2). Compara campos relevantes dos dois objetos.
 * Para `commercial` (PricingInput parcial): módulos, volumes, prazo, descontos, opção, horas.
 * Para `technical`: integrações, horas de implantação. Qualquer diferença nesses campos é material.
 */
const MATERIAL_COMMERCIAL_PATHS = [
  'volume.users',
  'negotiation.term',
  'negotiation.option',
  'negotiation.extraDiscount',
  'negotiation.tierDiscount',
  'negotiation.setupFixedReductionPct',
  'negotiation.setupOtherAdditions',
  'complexity.modules',
  'complexity.implementationHours',
] as const;

const MATERIAL_TECHNICAL_PATHS = ['integrations', 'implementationHours'] as const;

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function isMaterialChange(
  edit: 'commercial' | 'technical',
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): boolean {
  const paths = edit === 'commercial' ? MATERIAL_COMMERCIAL_PATHS : MATERIAL_TECHNICAL_PATHS;
  for (const p of paths) {
    if (JSON.stringify(getPath(before, p)) !== JSON.stringify(getPath(after, p))) return true;
  }
  return false;
}


// ───────────────────────── G-006: solicitações ao Gestor/Aprovador (tabela PURA) ─────────────────────────

/** Estado de espera. NÃO é alvo de nenhuma transição comum (`TRANSITIONS`): só `requestApproval`/`resolveApproval`. */
export const AWAITING_APPROVAL: WorkflowState = 'aguardando_aprovacao_gestor';

/**
 * Quem solicita cada tipo (ASSUMPTION docs/16 §2) e a mudança material que o invalida (brief §4):
 * exceção comercial ← edição comercial; replanejamento de SLA ← edição técnica; alteração de escopo ← ambas.
 */
export const APPROVAL_RULES: Readonly<Record<ApprovalKind, { readonly requesters: readonly Role[]; readonly invalidatedBy: readonly ('commercial' | 'technical')[] }>> = {
  excecao_comercial: { requesters: ['business'], invalidatedBy: ['commercial'] },
  alteracao_escopo: { requesters: ['business'], invalidatedBy: ['commercial', 'technical'] },
  replanejamento_sla: { requesters: ['tech'], invalidatedBy: ['technical'] },
};

/**
 * Estados de origem que aceitam solicitação. NUNCA `rascunho_comercial` (o aprovador não lê rascunho — G-002),
 * nem `reprovado`/`emitido`/o próprio estado de espera.
 */
export const APPROVAL_REQUEST_FROM: readonly WorkflowState[] = [
  'aguardando_analise_tecnica',
  'em_analise_tecnica',
  'ajustes_solicitados',
  'aprovado_tecnicamente',
  'pronto_para_emissao',
];

export type ApprovalRequestDecision =
  | { readonly ok: true; readonly to: WorkflowState }
  | { readonly ok: false; readonly reason: 'wrong_role' | 'invalid_from' };

/** Pura, deny-by-default: papel do tipo + estado de origem elegível ⇒ `aguardando_aprovacao_gestor`. */
export function canRequestApproval(current: WorkflowState, kind: ApprovalKind, role: Role | undefined): ApprovalRequestDecision {
  if (!role || !APPROVAL_RULES[kind].requesters.includes(role)) return { ok: false, reason: 'wrong_role' };
  if (!APPROVAL_REQUEST_FROM.includes(current)) return { ok: false, reason: 'invalid_from' };
  return { ok: true, to: AWAITING_APPROVAL };
}

/** Aprovado OU rejeitado volta ao estado ANTERIOR (a diferença está na exceção vinculada, não no estado). */
export function resolveApprovalState(previous: WorkflowState): WorkflowState {
  return previous;
}

/** Tipos cuja aprovação é invalidada por uma mudança material do tipo `edit`. */
export function kindsInvalidatedBy(edit: 'commercial' | 'technical'): readonly ApprovalKind[] {
  return (Object.keys(APPROVAL_RULES) as ApprovalKind[]).filter((k) => APPROVAL_RULES[k].invalidatedBy.includes(edit));
}

/**
 * SEPARAÇÃO DE FUNÇÕES (G-006): quem solicitou NÃO decide a própria solicitação. Compara e-mail normalizado.
 * Pura e isolada para o teste de mutação (inverter este guard TEM que quebrar a suíte).
 */
export function violatesSeparationOfDuties(requestedBy: string, decidedBy: string): boolean {
  return requestedBy.trim().toLowerCase() === decidedBy.trim().toLowerCase();
}

/**
 * G-023: estado resultante de uma mudança MATERIAL. Com solicitação pendente (qualquer kind), a base é o estado
 * ANTERIOR à solicitação (`pendingPrevious`) — a pendência é invalidada e a proposta NUNCA volta a um estado
 * que permita consolidar/emitir sem a reanálise exigida por §5.2. Sem pendência, base = estado atual.
 * Retorna null se nada muda de estado.
 */
export function statusAfterMaterialEdit(current: WorkflowState, pendingPrevious: WorkflowState | null, edit: 'commercial' | 'technical'): WorkflowState | null {
  return invalidationOnEdit(pendingPrevious ?? current, edit) ?? pendingPrevious;
}
