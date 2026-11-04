/**
 * G-001-A / G-026 — serviço de cotação NO SERVIDOR. Fina camada de orquestração: chama o Pricing Engine (fonte única;
 * NENHUMA fórmula duplicada) e delega a projeção por perfil a quoteProjection.ts. Também decide o alerta de política
 * (margem abaixo do piso) a partir dos INPUTS PERSISTIDOS da proposta — nunca de flag enviada pelo cliente.
 */
import { calculate, defaultScenarios, CURRENT_PREMISES, MODULE_CATALOG, type PricingInput, type PricingResult } from '@bondly/pricing-engine';
import { parsePricingInput, PRICING_INPUT_KEYS } from './quoteInput.js';
import { projectQuote, marginAlertOf, type MarginAlert, type QuoteViewName, type QuoteViewPayload, QUOTE_CONTRACT_VERSION } from './quoteProjection.js';
import type { ApprovalRequest, AuditEntry, CommercialInput } from './domain.js';

export interface QuoteComputation {
  readonly result: PricingResult;
  readonly view: QuoteViewPayload;
}

/** Cálculo único: `calculate` + cenários do engine, depois projeção. `internal` é bit-a-bit o resultado do engine. */
export function computeQuote(input: PricingInput, view: QuoteViewName): QuoteComputation {
  const result = calculate(input);
  const scenarios = defaultScenarios(input).map((s) => ({ name: String(s.name), result: s.result }));
  return { result, view: projectQuote(view, result, input.negotiation.term, scenarios) };
}

export type PolicyEvaluation =
  | { readonly evaluable: true; readonly alert: MarginAlert }
  | { readonly evaluable: false };

/**
 * Extrai o PricingInput dos inputs comerciais PERSISTIDOS. Só as 8 chaves do contrato são lidas (a proposta pode carregar
 * metadados do cliente); todos os campos passam pela MESMA validação estrita da cotação. Incompleto/ inválido ⇒ null.
 */
export function persistedPricingInput(commercial: CommercialInput | undefined): PricingInput | null {
  if (!commercial || typeof commercial !== 'object') return null;
  const picked: Record<string, unknown> = {};
  for (const k of PRICING_INPUT_KEYS) if ((commercial as Record<string, unknown>)[k] !== undefined) picked[k] = (commercial as Record<string, unknown>)[k];
  const r = parsePricingInput(picked, false);
  return r.ok ? r.input : null;
}

/** Alerta de política da proposta, recalculado no servidor a partir dos inputs persistidos. */
export function evaluateProposalPolicy(commercial: CommercialInput | undefined): PolicyEvaluation {
  const input = persistedPricingInput(commercial);
  if (!input) return { evaluable: false };
  return { evaluable: true, alert: marginAlertOf(calculate(input).marginStatus) };
}

export type EmissionGate =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'approval_required' | 'pricing_inputs_incomplete'; readonly policy: 'margin' | 'unevaluable' };

/**
 * G-026 — gate de consolidação/emissão (função PURA, testável isoladamente).
 *  - alerta de margem (requiresApproval) ⇒ exige a ÚLTIMA `excecao_comercial` em estado `approved` (rejeitada,
 *    pendente, invalidada ou inexistente ⇒ bloqueia) E nenhuma edição comercial posterior à decisão na auditoria
 *    (uma edição não-material também pode mover a margem; a aprovação só vale para a versão decidida);
 *  - inputs persistidos não-avaliáveis ⇒ libera (legado, o cliente atual grava `{}`) salvo `strictUnevaluable`.
 * `audit` deve estar em ordem cronológica de inserção.
 */
export function emissionGate(args: {
  commercial: CommercialInput | undefined;
  requests: readonly ApprovalRequest[];
  audit: readonly Pick<AuditEntry, 'action'>[];
  strictUnevaluable?: boolean;
}): EmissionGate {
  const pol = evaluateProposalPolicy(args.commercial);
  if (!pol.evaluable) return args.strictUnevaluable ? { ok: false, error: 'pricing_inputs_incomplete', policy: 'unevaluable' } : { ok: true };
  if (!pol.alert.requiresApproval) return { ok: true };
  const excs = args.requests.filter((r) => r.kind === 'excecao_comercial');
  const latest = [...excs].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)).at(-1);
  if (!latest || latest.status !== 'approved') return { ok: false, error: 'approval_required', policy: 'margin' };
  let lastApprovedIdx = -1;
  args.audit.forEach((e, i) => {
    if (e.action === 'approval_request.approved.excecao_comercial') lastApprovedIdx = i;
  });
  const editedAfter = args.audit.some((e, i) => i > lastApprovedIdx && e.action === 'proposal.edit_commercial');
  if (lastApprovedIdx < 0 || editedAfter) return { ok: false, error: 'approval_required', policy: 'margin' };
  return { ok: true };
}

/**
 * Catálogo PÚBLICO (GET /api/pricing/catalog): só rótulos e limites de seleção. SEM preços de tabela, custos, margens,
 * premissas de custo. Os valores de preço vêm sempre da cotação.
 */
export function publicCatalog() {
  const tiers = CURRENT_PREMISES.tiers.value;
  const lim = CURRENT_PREMISES.tierDiscountLimits.value;
  return {
    contractVersion: QUOTE_CONTRACT_VERSION,
    premisesVersion: CURRENT_PREMISES.version,
    tiers: tiers.map((t) => ({ name: t.name, maxUsers: t.users })),
    tierDiscount: { min: lim.min, max: lim.max },
    terms: [12, 24, 36],
    options: ['floor', 'recommended', 'premium'],
    communicationStrategies: ['rcs', 'wa', 'sms', 'email', 'both', 'fallback', 'custom', 'none'],
    modules: MODULE_CATALOG.map((m) => ({ id: m.id, name: m.name, maturity: m.maturity, requires: m.requires, recommends: m.recommends })),
  };
}
