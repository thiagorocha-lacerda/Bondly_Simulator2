/**
 * G-001 (ADR docs/15) — PONTE DEV-ONLY para o Pricing Engine local.
 *
 * DECISION: em PRODUÇÃO o cálculo é EXCLUSIVAMENTE server-side (POST /api/pricing/quote). O motor e as
 * tabelas de custo/margem NÃO entram no bundle do navegador. O único caminho que ainda chama o engine no
 * browser é o modo de desenvolvimento, e o `import()` dinâmico fica LEXICALMENTE DENTRO de um
 * `if (import.meta.env.DEV)`. O Vite substitui `import.meta.env.DEV` por `false` no build de produção, e o
 * Rollup faz dead-code elimination do bloco `if (false) { ... }` — INCLUINDO o `import('@bondly/pricing-engine')`
 * de dentro dele. Resultado: nenhuma linha de `calculate`/`CURRENT_PREMISES`/`cogs`/margens é emitida no `dist`.
 *
 * PROVA: `scripts/check-bundle.mjs` (passo de CI) faz grep no `dist` por identificadores sensíveis e FALHA se
 * achar qualquer um. Em dev, o engine é carregado sob demanda e o app mantém o comportamento legado.
 */
import type { PricingInput, PricingResult, B2cInput } from '@bondly/pricing-types';
import type { QuoteViewName, QuoteViewPayload } from './quoteTypes';

/** true somente em `vite dev`/testes; `false` (literal) no build de produção ⇒ habilita o DCE do ramo DEV. */
export const IS_DEV: boolean = import.meta.env.DEV;

/** Módulo público do engine (tipo-only; `typeof import` é apagado no build). */
type EngineModule = typeof import('@bondly/pricing-engine');

let cached: EngineModule | null = null;

/**
 * Carrega o engine SOMENTE em DEV. O `import()` está dentro de `if (import.meta.env.DEV)` para que o build de
 * produção (DEV=false) elimine o ramo inteiro. Em produção retorna rejeição — mas nunca é chamado lá, porque
 * todo consumidor está atrás de `if (IS_DEV)`.
 */
export async function loadDevEngine(): Promise<EngineModule> {
  if (import.meta.env.DEV) {
    if (!cached) cached = (await import('@bondly/pricing-engine')) as EngineModule;
    return cached;
  }
  throw new Error('Pricing Engine local indisponível em produção — o cálculo é server-side (G-001).');
}

/**
 * Projeção DEV-ONLY do PricingResult → QuoteView por perfil, ESPELHANDO apps/auth-proxy/src/quoteProjection.ts
 * (fonte de verdade em produção). Existe só para a pré-visualização/PDF rodarem no navegador em DEV sem ir ao
 * servidor; em produção o QuoteView vem do fio (POST /api/pricing/quote) e esta função é eliminada pelo DCE
 * junto com o engine. Os NOMES de campo são guardados por quoteTypes.sync.test.ts (sincronia com o servidor).
 */
export function projectQuotePreview(
  view: QuoteViewName,
  r: PricingResult,
  termMonths: number,
  scenarios: readonly { readonly name: string; readonly result: PricingResult }[],
): QuoteViewPayload {
  const base = {
    contractVersion: 'quote.v1' as const,
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
    scenarios: scenarios.map((s) => ({ name: s.name, monthly: s.result.core + s.result.servicesMrr, tcv: s.result.tcvClient })),
  };
  const tierRate = r.tierDiscount;
  const termRate = r.termDiscount;
  if (view === 'client') return { ...base, view: 'client', discounts: { tierRate, termRate } };

  const commercial = {
    ...base,
    view: 'commercial' as const,
    discounts: { tierRate, termRate, negotiatedRate: r.discountWaterfall.commercialDiscountRate },
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
    policy: { marginAlert: marginAlertPreview(r.marginStatus), flags: [] as string[] },
  };
  if (view === 'commercial') return commercial;
  const { view: _v, ...rest } = commercial;
  void _v;
  return { ...rest, view: 'internal', result: r, scenariosFull: scenarios.map((s) => ({ name: s.name, result: s.result })) };
}

/** Espelho DEV do sinal de margem do servidor (sem valores). */
function marginAlertPreview(status: PricingResult['marginStatus']) {
  switch (status) {
    case 'REPRECIFICAR':
      return { level: 'below_floor' as const, requiresApproval: true };
    case 'REVISAR':
      return { level: 'review' as const, requiresApproval: false };
    case 'CUSTOMIZADO':
      return { level: 'custom' as const, requiresApproval: false };
    case 'INCOMPLETO':
      return { level: 'incomplete' as const, requiresApproval: false };
    default:
      return { level: 'ok' as const, requiresApproval: false };
  }
}

export type { PricingInput, PricingResult, B2cInput };
