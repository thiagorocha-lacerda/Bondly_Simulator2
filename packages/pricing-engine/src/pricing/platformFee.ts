/** Platform Fee progressivo e derivados (R-001, R-013, R-014, R-016). */
import type { Band, PremiseTable } from '../premises/premises.js';
import type { CommercialOption } from '../contracts/types.js';
import type { ComplexityResult } from './complexity.js';

/** Platform Fee de tabela — soma progressiva por faixa de usuários (R-001). */
export function platformFeeTable(users: number, bands: readonly Band[]): number {
  let sum = 0;
  for (const [from, to, unit] of bands) {
    if (users > from) sum += (Math.min(users, to) - from) * unit;
  }
  return sum;
}

export interface PlatformFeeResolution {
  readonly table: number;
  readonly floor: number;
  readonly recommended: number;
  readonly premium: number;
  readonly chosen: number; // antes de descontos
  readonly optionMultiplier: number;
  readonly tierDiscount: number; // fração do desconto por tier aplicada (§3.1)
  readonly afterTierDiscount: number; // chosen × (1 − tierDiscount)
  readonly final: number; // após desconto por tier, negociado e por prazo
}

/**
 * Resolve o Platform Fee para as três opções comerciais e aplica descontos (R-013/R-014/R-016 + §3).
 * - pfPiso  = max(tabela×0.9, piso econômico pela margem floor)
 * - pfRec   = max(pfPiso, tabela×(1+markup))
 * - pfPrem  = max(pfRec, tabela×(1+markupPremium))
 *
 * WATERFALL comercial (§3.2.4) — descontos SEQUENCIAIS sobre a base elegível (o Capacity/Platform
 * Fee), sem incidência dupla ou ambígua e nesta ordem:
 *   escolhido → ×(1−descontoPorTier) → ×(1−descontoNegociado) → ×(1−descontoPrazo) = final
 *
 * O desconto por tier incide EXCLUSIVAMENTE sobre o Platform Fee; usage, processing, Setup e
 * serviços não recebem o desconto do tier (§3.2.5). `tierDiscount` default 0 preserva o cálculo
 * legado bit-a-bit quando não há desconto por tier (paridade §22).
 *
 * Observação (§3.2.3): a ORDEM e a cumulatividade aqui foram RATIFICADAS pelo sponsor (CTO) em
 * 2026-11-05 — o premise `tierDiscountLimits` passou a status 'validada' na v16 das premissas
 * (a v15 permanece 'pendente' por snapshot imutável). A lógica de cálculo NÃO mudou.
 */
export function resolvePlatformFee(args: {
  table: number;
  floorEconomic: number; // cogs0/(1-floor) - usage0 - proc0
  complexity: ComplexityResult;
  option: CommercialOption;
  extraDiscount: number;
  termDiscount: number;
  tierDiscount?: number; // fração [0, max] já resolvida/validada; default 0
}): PlatformFeeResolution {
  const { table, floorEconomic, complexity, option, extraDiscount, termDiscount } = args;
  const tierDiscount = Math.max(0, args.tierDiscount ?? 0);
  const floor = Math.max(table * 0.9, floorEconomic);
  const recommended = Math.max(floor, table * (1 + complexity.band.markup));
  const premium = Math.max(recommended, table * (1 + complexity.band.markupPremium));

  const chosen = option === 'floor' ? floor : option === 'recommended' ? recommended : premium;
  const optionMultiplier = table ? chosen / table : 1;
  const afterTierDiscount = chosen * (1 - tierDiscount);
  const final = afterTierDiscount * (1 - extraDiscount) * (1 - termDiscount);

  return { table, floor, recommended, premium, chosen, optionMultiplier, tierDiscount, afterTierDiscount, final };
}

/** Piso econômico do PF dado um alvo de margem (R-013 usa floor; reusado para o alvo). */
export function economicFloor(args: {
  cogs: number;
  usage: number;
  processing: number;
  marginTarget: number;
}): number {
  const { cogs, usage, processing, marginTarget } = args;
  return Math.max(0, cogs / (1 - marginTarget) - usage - processing);
}

export function termDiscountFor(term: 12 | 24 | 36, table: PremiseTable): number {
  return table.termDiscounts.value[term] ?? 0;
}
