/**
 * G-001-A Fase 3 — ESPELHO no frontend do contrato `quote.v1`.
 *
 * FONTE DE VERDADE: apps/auth-proxy/src/quoteProjection.ts (ClientQuote/CommercialQuote/InternalQuote/
 * QuoteViewPayload) e apps/auth-proxy/src/pricingQuote.ts (publicCatalog). NÃO importamos o auth-proxy no
 * bundle do Commercial Workspace (ele roda só no servidor). Como ainda não há pacote shared-types ligado
 * (packages/shared-types/src está vazio), DUPLICAMOS os tipos aqui — exatamente como pauseReasons.ts faz —
 * e um teste de sincronia (quoteTypes.sync.test.ts) quebra se os campos divergirem da fonte.
 *
 * `PricingResult` (usado só na visão `internal`) continua vindo de @bondly/pricing-engine; a remoção do
 * engine do bundle é um PEDAÇO POSTERIOR da Fase 3/4 — nesta run nada ainda consome estes tipos nas telas.
 */
import type { PricingResult } from '@bondly/pricing-types';

export const QUOTE_CONTRACT_VERSION = 'quote.v1' as const;
export type QuoteViewName = 'client' | 'commercial' | 'internal';

export type MarginAlertLevel = 'ok' | 'review' | 'below_floor' | 'custom' | 'incomplete';
export interface MarginAlert {
  readonly level: MarginAlertLevel;
  readonly requiresApproval: boolean;
}

export interface ScenarioPrice {
  readonly name: string;
  readonly monthly: number;
  readonly tcv: number;
}

export interface ClientQuote {
  readonly contractVersion: typeof QUOTE_CONTRACT_VERSION;
  readonly view: 'client';
  readonly engineVersion: string;
  readonly premisesVersion: string;
  readonly plan: { readonly name: string; readonly isCustom: boolean };
  readonly termMonths: number;
  readonly pricing: {
    readonly monthly: number;
    readonly servicesMonthly: number;
    readonly setupTotal: number;
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
  readonly result: PricingResult;
  readonly scenariosFull: readonly { readonly name: string; readonly result: PricingResult }[];
}

export type QuoteViewPayload = ClientQuote | CommercialQuote | InternalQuote;

/** Resposta de GET /api/pricing/catalog ({ catalog }). Rótulos/limites — SEM preço de tabela/custo/margem. */
export interface PublicCatalog {
  readonly contractVersion: typeof QUOTE_CONTRACT_VERSION;
  readonly premisesVersion: string;
  readonly tiers: readonly { readonly name: string; readonly maxUsers: number }[];
  readonly tierDiscount: { readonly min: number; readonly max: number };
  readonly terms: readonly number[];
  readonly options: readonly string[];
  readonly communicationStrategies: readonly string[];
  readonly modules: readonly {
    readonly id: string;
    readonly name: string;
    readonly maturity: string;
    readonly requires: readonly string[];
    readonly recommends: readonly string[];
  }[];
}
