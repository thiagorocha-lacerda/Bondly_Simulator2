/**
 * G-001-A — PROJEÇÃO POR PERFIL da cotação (QuoteView). Módulo PURO: recebe o PricingResult do Pricing Engine
 * (fonte única — nada é recalculado aqui) e devolve SÓ o que o perfil pode ver. Esta é a fronteira de confidencialidade
 * (CWE-200/CWE-602): custo, margem, COGS, tributos, fees Minu, premissas e breakdown existem APENAS em `internal`.
 *
 * Contrato `quote.v1` (docs/03 §QuoteView):
 *   client      — peça comercial para o CLIENTE: preço, mensalidade, Setup (horas + total), descontos públicos, TCV, cenários.
 *   commercial  — Negócios/Aprovador: client + composição de PREÇO, waterfall, Setup detalhado, alçada e SINAIS de política
 *                 (marginAlert {level, requiresApproval} sem valores). Nunca custo/margem.
 *   internal    — P&T/Admin (proposal.see_internal): commercial + PricingResult completo + cenários completos.
 */
import type { PricingResult, MarginStatus } from '@bondly/pricing-engine';
import { canSeeInternal, type Role } from './rbac.js';

export const QUOTE_CONTRACT_VERSION = 'quote.v1' as const;
export type QuoteViewName = 'client' | 'commercial' | 'internal';
const RANK: Readonly<Record<QuoteViewName, number>> = { client: 0, commercial: 1, internal: 2 };
export const QUOTE_VIEWS: readonly QuoteViewName[] = ['client', 'commercial', 'internal'];

export function isQuoteView(v: unknown): v is QuoteViewName {
  return typeof v === 'string' && (QUOTE_VIEWS as readonly string[]).includes(v);
}

/** Visão máxima a que o papel tem direito: see_internal ⇒ internal; demais papéis com `pricing.quote` ⇒ commercial. */
export function maxViewFor(role: Role | undefined): QuoteViewName {
  return canSeeInternal(role) ? 'internal' : 'commercial';
}

/** Visão efetiva: sem pedido ⇒ a máxima do papel; pedido acima do direito ⇒ null (o chamador responde 403). */
export function resolveView(requested: QuoteViewName | undefined, role: Role | undefined): QuoteViewName | null {
  const max = maxViewFor(role);
  if (requested === undefined) return max;
  return RANK[requested] <= RANK[max] ? requested : null;
}

export type MarginAlertLevel = 'ok' | 'review' | 'below_floor' | 'custom' | 'incomplete';
export interface MarginAlert {
  readonly level: MarginAlertLevel;
  /** Decidido NO SERVIDOR a partir do `marginStatus` do engine (REPRECIFICAR = margem abaixo do piso). Sem valores. */
  readonly requiresApproval: boolean;
}

/**
 * Sinal de política derivado do status do engine — NÃO cria limite novo: o piso/meta já são premissas validadas do
 * engine (`marginFloor`/`marginTarget`). CUSTOMIZADO (acima do maior tier) e INCOMPLETO (sem MAU) não são avaliados
 * pelo engine como abaixo do piso ⇒ não exigem aprovação por margem (ASSUMPTION registrada em docs/15).
 */
export function marginAlertOf(status: MarginStatus): MarginAlert {
  switch (status) {
    case 'SAUDÁVEL':
      return { level: 'ok', requiresApproval: false };
    case 'REVISAR':
      return { level: 'review', requiresApproval: false };
    case 'REPRECIFICAR':
      return { level: 'below_floor', requiresApproval: true };
    case 'CUSTOMIZADO':
      return { level: 'custom', requiresApproval: false };
    case 'INCOMPLETO':
      return { level: 'incomplete', requiresApproval: false };
  }
}

/** Códigos de aviso do engine que são POLÍTICA de preço/alçada (sem valores). MARGIN_* ficam só em `marginAlert`. */
const PUBLIC_POLICY_FLAGS: readonly string[] = [
  'DISCOUNT_OUT_OF_CORRIDOR',
  'SERVICE_BELOW_MIN',
  'SETUP_HOUR_BELOW_MIN_MARGIN',
  'TIER_DISCOUNT_CLAMPED',
  'SETUP_FIXED_REDUCTION_PENDING',
];

export interface ScenarioPrice {
  readonly name: string;
  readonly monthly: number;
  readonly tcv: number;
}

export interface ClientQuote {
  readonly contractVersion: typeof QUOTE_CONTRACT_VERSION;
  readonly view: 'client';
  readonly engineVersion: string;
  /** Identificador da versão de premissas (sem valores de custo/margem). */
  readonly premisesVersion: string;
  readonly plan: { readonly name: string; readonly isCustom: boolean };
  readonly termMonths: number;
  readonly pricing: {
    readonly monthly: number; // core + serviços recorrentes
    readonly servicesMonthly: number;
    readonly setupTotal: number; // Setup ao cliente (inclui markup Minu quando via Minu — sem expor o markup)
    readonly implementationHours: number;
    readonly firstYearTotal: number;
    readonly tcv: number;
  };
  readonly discounts: { readonly tierRate: number; readonly termRate: number };
  readonly scenarios: readonly ScenarioPrice[];
}

export interface CommercialQuote extends Omit<ClientQuote, 'view' | 'discounts'> {
  readonly view: 'commercial';
  readonly discounts: { readonly tierRate: number; readonly termRate: number; readonly negotiatedRate: number };
  readonly composition: {
    readonly platformFee: number;
    readonly usage: number;
    readonly processing: number;
    readonly servicesMonthly: number;
    readonly coreMonthly: number;
  };
  readonly waterfall: {
    readonly base: number;
    readonly afterTier: number;
    readonly afterNegotiated: number;
    readonly final: number;
  };
  readonly setup: {
    readonly fixed: number;
    readonly fixedReductionPct: number;
    readonly implementationHours: number;
    readonly hourlyRate: number;
    readonly implementationSubtotal: number;
    readonly otherAdditions: number;
    readonly total: number;
  };
  readonly engagement: { readonly mau: number; readonly dau: number };
  readonly discountCorridor: { readonly authority: string; readonly maxDiscount: number };
  readonly policy: { readonly marginAlert: MarginAlert; readonly flags: readonly string[] };
}

export interface InternalQuote extends Omit<CommercialQuote, 'view'> {
  readonly view: 'internal';
  /** PricingResult COMPLETO do engine (bit-a-bit; custo, margem, tributos, fees Minu, hash das premissas). */
  readonly result: PricingResult;
  readonly scenariosFull: readonly { readonly name: string; readonly result: PricingResult }[];
}

export type QuoteViewPayload = ClientQuote | CommercialQuote | InternalQuote;

export interface ScenarioInput {
  readonly name: string;
  readonly result: PricingResult;
}

function clientBase(r: PricingResult, termMonths: number, scenarios: readonly ScenarioInput[]) {
  return {
    contractVersion: QUOTE_CONTRACT_VERSION,
    engineVersion: r.engineVersion,
    premisesVersion: r.premisesVersion,
    plan: { name: r.tierName, isCustom: r.isCustom },
    termMonths,
    pricing: {
      monthly: r.core + r.servicesMrr,
      servicesMonthly: r.servicesMrr,
      setupTotal: r.setupClient,
      implementationHours: r.setup.implementationHours,
      firstYearTotal: r.clientYear1,
      tcv: r.tcvClient,
    },
    scenarios: scenarios.map((s): ScenarioPrice => ({ name: s.name, monthly: s.result.core + s.result.servicesMrr, tcv: s.result.tcvClient })),
  };
}

function commercialExtras(r: PricingResult) {
  return {
    composition: { platformFee: r.platformFee, usage: r.usage, processing: r.processing, servicesMonthly: r.servicesMrr, coreMonthly: r.core },
    waterfall: {
      base: r.discountWaterfall.base,
      afterTier: r.discountWaterfall.afterTierDiscount,
      afterNegotiated: r.discountWaterfall.afterCommercialDiscount,
      final: r.discountWaterfall.final,
    },
    setup: {
      fixed: r.setup.fixed,
      fixedReductionPct: r.setup.fixedReductionPct,
      implementationHours: r.setup.implementationHours,
      hourlyRate: r.setup.hourlyRate,
      implementationSubtotal: r.setup.implementationSubtotal,
      otherAdditions: r.setup.otherAdditions,
      total: r.setupClient,
    },
    engagement: { mau: r.mau, dau: r.dau },
    discountCorridor: { authority: r.discountAuthority, maxDiscount: r.maxDiscount },
    policy: {
      marginAlert: marginAlertOf(r.marginStatus),
      flags: r.warnings.map((w) => w.code).filter((c) => PUBLIC_POLICY_FLAGS.includes(c)),
    },
  };
}

/** Projeta o resultado do engine (+ cenários) para a visão pedida. PURA; nenhuma fórmula de preço aqui. */
export function projectQuote(view: QuoteViewName, r: PricingResult, termMonths: number, scenarios: readonly ScenarioInput[]): QuoteViewPayload {
  const base = clientBase(r, termMonths, scenarios);
  const tierRate = r.tierDiscount;
  const termRate = r.termDiscount;
  if (view === 'client') {
    return { ...base, view: 'client', discounts: { tierRate, termRate } };
  }
  const commercial: CommercialQuote = {
    ...base,
    view: 'commercial',
    discounts: { tierRate, termRate, negotiatedRate: r.discountWaterfall.commercialDiscountRate },
    ...commercialExtras(r),
  };
  if (view === 'commercial') return commercial;
  const { view: _v, ...rest } = commercial;
  void _v;
  return { ...rest, view: 'internal', result: r, scenariosFull: scenarios.map((s) => ({ name: s.name, result: s.result })) };
}
