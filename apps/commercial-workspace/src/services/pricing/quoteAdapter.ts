/**
 * G-001-A Fase 3.2 — Adaptador PURO QuoteView → forma que as telas já consomem (PricingResult-like).
 *
 * Fonte de verdade é o SERVIDOR: aqui NÃO há fórmula de preço — só remapeamento de campos do contrato `quote.v1`
 * para os nomes que ResultsDashboard/ScenarioPanel/SetupPanel/TierDiscountPanel/PreviewModal leem hoje do
 * PricingResult. Menor delta possível: para `internal` o servidor já devolve o PricingResult COMPLETO em
 * `quote.result`, então devolvemos esse objeto verbatim (zero remapeamento, zero risco de divergência).
 *
 * FRONTEIRA DE CONFIDENCIALIDADE (G-001): para `client`/`commercial` o servidor NUNCA envia custo/margem/tributo/
 * fee Minu. O adaptador portanto PREENCHE esses campos com SENTINELA ZERADA e marca `hasInternal:false`. As telas
 * já escondem todo número interno atrás de `useAudience().internal` — este flag é a MESMA barreira vinda do dado,
 * não só da UI. Um perfil comercial com flag=server não tem de onde tirar custo/margem: eles não existem no payload.
 */
import type { PricingResult } from '@bondly/pricing-types';
import type { ClientQuote, CommercialQuote, InternalQuote, QuoteViewPayload } from './quoteTypes';

/** Resultado adaptado: o PricingResult que as telas consomem + um flag que diz se os campos internos são reais. */
export interface AdaptedPricing {
  readonly result: PricingResult;
  /** true só na visão `internal`: custo/margem/tributo/fee Minu são valores reais do engine. */
  readonly hasInternal: boolean;
  readonly view: QuoteViewPayload['view'];
}

/** Campos internos não presentes em client/commercial — zerados por construção (não há de onde vir). */
const ZERO_COSTS = { cleverTap: 0, infra: 0, invoices: 0, communication: 0, total: 0 } as const;
const ZERO_TAXES = { rate: 0, onCore: 0, onServices: 0, total: 0 } as const;

/**
 * Monta a casca PricingResult a partir dos campos PÚBLICOS/comerciais (sem custo/margem). Usado em client/commercial.
 * Os campos internos recebem sentinela zerada; `hasInternal` (no retorno de `adaptQuote`) sinaliza que são placeholders.
 */
function shellFrom(q: ClientQuote | CommercialQuote): PricingResult {
  const commercial = q.view === 'commercial' ? (q as CommercialQuote) : undefined;
  const comp = commercial?.composition;
  const wf = commercial?.waterfall;
  const setup = commercial?.setup;
  const eng = commercial?.engagement;

  const coreMonthly = comp?.coreMonthly ?? q.pricing.monthly - q.pricing.servicesMonthly;
  const platformFeeFinal = wf?.final ?? comp?.platformFee ?? 0;

  return {
    engineVersion: q.engineVersion,
    premisesVersion: q.premisesVersion,
    premisesHash: '', // não exposto fora de internal
    tierName: q.plan.name,
    isCustom: q.plan.isCustom,
    mau: eng?.mau ?? 0,
    dau: eng?.dau ?? 0,
    platformFeeTable: wf?.base ?? comp?.platformFee ?? 0,
    platformFee: platformFeeFinal,
    usage: comp?.usage ?? 0,
    processing: comp?.processing ?? 0,
    core: coreMonthly,
    costs: { ...ZERO_COSTS },
    servicesMrr: q.pricing.servicesMonthly,
    setupNet: 0, // líquido Bondly é interno
    setupClient: q.pricing.setupTotal,
    setup: {
      fixed: setup?.fixed ?? 0,
      fixedReductionPct: setup?.fixedReductionPct ?? 0,
      implementationHours: setup?.implementationHours ?? q.pricing.implementationHours,
      hourlyRate: setup?.hourlyRate ?? 0,
      implementationSubtotal: setup?.implementationSubtotal ?? 0,
      otherAdditions: setup?.otherAdditions ?? 0,
      net: 0,
      client: q.pricing.setupTotal,
    },
    taxes: { ...ZERO_TAXES },
    minuConversionFee: 0,
    minuAccountFee: 0,
    technicalMargin: 0,
    netMarginY1: 0,
    netMarginSteady: 0,
    marginStatus: 'INCOMPLETO', // sem sinal de margem para quem não vê interno
    discountAuthority: commercial?.discountCorridor.authority ?? '',
    maxDiscount: commercial?.discountCorridor.maxDiscount ?? 0,
    termDiscount: q.discounts.termRate,
    tierDiscount: q.discounts.tierRate,
    tierDiscountApplied: q.discounts.tierRate > 0,
    discountWaterfall: {
      base: wf?.base ?? 0,
      tierDiscountRate: q.discounts.tierRate,
      afterTierDiscount: wf?.afterTier ?? 0,
      commercialDiscountRate: commercial?.discounts.negotiatedRate ?? 0,
      afterCommercialDiscount: wf?.afterNegotiated ?? 0,
      termDiscountRate: q.discounts.termRate,
      final: wf?.final ?? 0,
    },
    tcvClient: q.pricing.tcv,
    tcvBondly: 0,
    contractContribution: 0,
    contractMargin: 0,
    clientYear1: q.pricing.firstYearTotal,
    minuYear1: 0,
    minuContract: 0,
    complexityScore: 0,
    complexityBand: '',
    warnings: [],
  };
}

/**
 * Adapta o payload do servidor para a forma consumida pelas telas.
 * - internal   → `quote.result` VERBATIM (PricingResult completo do engine; menor delta, paridade exata).
 * - commercial → casca com composição/waterfall/setup/alçada reais; custo/margem zerados (`hasInternal:false`).
 * - client     → casca só com preço/setup/descontos públicos; demais zerados (`hasInternal:false`).
 */
export function adaptQuote(quote: QuoteViewPayload): AdaptedPricing {
  if (quote.view === 'internal') {
    return { result: (quote as InternalQuote).result, hasInternal: true, view: 'internal' };
  }
  return { result: shellFrom(quote), hasInternal: false, view: quote.view };
}

/** Adapta os cenários do servidor para a lista { name, result } que o ScenarioPanel consome. */
export function adaptScenarios(quote: QuoteViewPayload): readonly { readonly name: string; readonly result: PricingResult }[] {
  if (quote.view === 'internal') {
    return (quote as InternalQuote).scenariosFull;
  }
  return quote.scenarios.map((s) => ({
    name: s.name,
    result: {
      ...shellFrom(quote),
      core: s.monthly - quote.pricing.servicesMonthly,
      tcvClient: s.tcv,
    },
  }));
}
