import { describe, it, expect } from 'vitest';
import {
  validateTierDiscountPct,
  resolveTierDiscount,
  resolvePlatformFee,
  calculate,
  createProposalSnapshot,
  reopenProposal,
  reviseProposal,
  CURRENT_PREMISES,
  PREMISES_V15,
  PREMISES_V16,
  premisesForVersion,
  complexity as computeComplexity,
  type PricingInput,
  type TierDiscountLimits,
} from '../src/index.js';

const P = CURRENT_PREMISES;
const LIMITS: TierDiscountLimits = P.tierDiscountLimits.value;

/** Entrada base reutilizável (Growth, recommended, 12m, via Minu) para os testes de integração. */
function baseInput(overrides?: Partial<PricingInput['negotiation']>): PricingInput {
  return {
    volume: { users: 50000, mauPct: 0.4, stickiness: 0.15, transactionsPerMau: 1 },
    invoices: { enabled: true, participantPct: 0.1, notesPerParticipant: 1 },
    communication: { perMau: 1, strategy: 'fallback', fallbackRate: 0.4, customMix: { sms: 0, email: 0, rcs: 1, wa: 0.4 } },
    complexity: { integrations: 1, modules: 2, slaPoints: 0, customizationPoints: 0, aiPoints: 0, migrationPoints: 0, implementationHours: 0 },
    negotiation: { option: 'recommended', extraDiscount: 0, term: 12, viaMinu: true, expansion: false, strategic: false, ...overrides },
    services: {
      profiles: [], tablePrice: 35000, minMargin: 5000, compCap: 25000, targetMargin: undefined,
      passthroughPct: 0, startMonth: 1, hourMinMargin: 50, productiveHoursPerMonth: 160, hourCost: undefined, negotiatedHourPrice: undefined,
    },
    campaign: {
      enabled: false, objectives: [], base: undefined, consentPct: 0, frequency: 1, months: 2,
      mix: { sms: 0, email: 0, rcs: 1, wa: 0.4 }, deliveryRate: { sms: 0.7, email: 0.7, rcs: 0.7, wa: 0.7 },
      conversionRate: 0.35, activationRate: 0.15, operationHours: 0, markup: 0.2,
    },
  };
}

describe('Desconto por tier — limites da tabela (§3.1)', () => {
  it('a faixa padrão é 3%–7%, VALIDADA na v16 (ratificação do sponsor 2026-11-05)', () => {
    expect(LIMITS.min).toBeCloseTo(0.03, 9);
    expect(LIMITS.max).toBeCloseTo(0.07, 9);
    expect(P.version).toBe('v16');
    expect(P.tierDiscountLimits.status).toBe('validada');
  });
});

describe('Governança de versões — v15 e v16 coexistem (prompt §27.6)', () => {
  it('v15 permanece PENDENTE e congelada; v16 é VALIDADA; só o status muda', () => {
    expect(PREMISES_V15.version).toBe('v15');
    expect(PREMISES_V15.tierDiscountLimits.status).toBe('pendente');
    expect(PREMISES_V16.version).toBe('v16');
    expect(PREMISES_V16.tierDiscountLimits.status).toBe('validada');
    // valores da premissa inalterados entre as versões
    expect(PREMISES_V16.tierDiscountLimits.value).toEqual(PREMISES_V15.tierDiscountLimits.value);
  });
  it('hashes distintos entre v15 e v16 (identidade imutável de snapshot)', () => {
    expect(PREMISES_V15.hash).not.toBe(PREMISES_V16.hash);
  });
  it('demais campos idênticos entre v15/v16, exceto o tier-discount e a redução do Setup fixo', () => {
    const strip = (t: typeof PREMISES_V15) => {
      const { version, hash, label, effectiveDate, tierDiscountLimits, setupFixedReductionDefault, ...rest } = t;
      void version; void hash; void label; void effectiveDate; void tierDiscountLimits; void setupFixedReductionDefault;
      return rest;
    };
    expect(strip(PREMISES_V16)).toEqual(strip(PREMISES_V15));
    // os valores-base dos tiers (incl. setup) permanecem RASTREÁVEIS e inalterados entre versões
    expect(PREMISES_V16.tiers.value).toEqual(PREMISES_V15.tiers.value);
    // a redução do Setup fixo é a segunda mudança de governança da v16
    expect(PREMISES_V15.setupFixedReductionDefault.value).toBe(0);
    expect(PREMISES_V16.setupFixedReductionDefault.value).toBeCloseTo(0.2, 9);
    expect(PREMISES_V16.setupFixedReductionDefault.status).toBe('validada');
  });
  it('o registro resolve cada versão pela sua chave', () => {
    expect(premisesForVersion('v15')).toBe(PREMISES_V15);
    expect(premisesForVersion('v16')).toBe(PREMISES_V16);
    expect(premisesForVersion('v99')).toBeUndefined();
  });
  it('CURRENT_PREMISES é a v16', () => {
    expect(CURRENT_PREMISES).toBe(PREMISES_V16);
  });
});

describe('Reabertura reproduz a versão congelada da proposta (snapshot imutável)', () => {
  const input = baseInput({ tierDiscount: 0.05 });

  it('proposta criada sob v15 reabre com cálculo e status PENDENTE históricos', () => {
    const snap = createProposalSnapshot({ id: 'BONDLY-2027-000010', input, premises: PREMISES_V15 });
    expect(snap.premisesVersion).toBe('v15');
    expect(snap.premises.tierDiscountLimits.status).toBe('pendente');
    const re = reopenProposal(snap);
    expect(re.reproducible).toBe(true);
    expect(re.premisesIntact).toBe(true);
    expect(re.versionRegistered).toBe(true);
  });

  it('nova proposta usa v16 (validada) por padrão e reabre reproduzindo v16', () => {
    const snap = createProposalSnapshot({ id: 'BONDLY-2027-000011', input });
    expect(snap.premisesVersion).toBe('v16');
    expect(snap.premises.tierDiscountLimits.status).toBe('validada');
    expect(snap.premisesHash).toBe(PREMISES_V16.hash);
    const re = reopenProposal(snap);
    expect(re.reproducible).toBe(true);
    expect(re.premisesIntact).toBe(true);
    expect(re.versionRegistered).toBe(true);
  });

  it('Core/PF idênticos entre v15 e v16 (governança do tier); Setup fixo −20% na v16', () => {
    const r15 = calculate(input, PREMISES_V15);
    const r16 = calculate(input, PREMISES_V16);
    // o desconto por tier incide só no PF/Core — idêntico entre as versões
    expect(r16.platformFee).toBeCloseTo(r15.platformFee, 9);
    expect(r16.core).toBeCloseTo(r15.core, 9);
    // o Setup fixo diverge: v16 aplica a redução default de 20% (DECISION sponsor 2026-11-05)
    expect(r16.setup.fixedReductionPct).toBeCloseTo(0.2, 9);
    expect(r15.setup.fixedReductionPct).toBe(0);
    expect(r16.setup.fixed).toBeCloseTo(r15.setup.fixed * 0.8, 6);
    expect(r16.tcvClient).toBeLessThan(r15.tcvClient); // Setup menor ⇒ TCV ao cliente menor
  });
});

describe('Validação do desconto por tier (§3.1 / §11 Descontos)', () => {
  it('aceita os limites EXATOS 3,00% e 7,00%', () => {
    const lo = validateTierDiscountPct(3, LIMITS);
    const hi = validateTierDiscountPct(7, LIMITS);
    expect(lo.ok).toBe(true);
    expect(hi.ok).toBe(true);
    if (lo.ok) expect(lo.fraction).toBeCloseTo(0.03, 9);
    if (hi.ok) expect(hi.fraction).toBeCloseTo(0.07, 9);
  });
  it('aceita 3,00 e 7,00 com duas casas; aceita vírgula decimal', () => {
    expect(validateTierDiscountPct(3.0, LIMITS).ok).toBe(true);
    expect(validateTierDiscountPct(5.5, LIMITS).ok).toBe(true);
    expect(validateTierDiscountPct('4,25', LIMITS).ok).toBe(true);
  });
  it('REJEITA 2,99% (below_min) e 7,01% (above_max)', () => {
    const below = validateTierDiscountPct(2.99, LIMITS);
    const above = validateTierDiscountPct(7.01, LIMITS);
    expect(below.ok).toBe(false);
    expect(above.ok).toBe(false);
    if (!below.ok) expect(below.reason).toBe('below_min');
    if (!above.ok) expect(above.reason).toBe('above_max');
  });
  it('REJEITA NaN, string inválida, negativo e precisão excessiva', () => {
    expect(validateTierDiscountPct(Number.NaN, LIMITS)).toMatchObject({ ok: false, reason: 'nan' });
    expect(validateTierDiscountPct('abc', LIMITS)).toMatchObject({ ok: false, reason: 'nan' });
    expect(validateTierDiscountPct({}, LIMITS)).toMatchObject({ ok: false, reason: 'nan' });
    expect(validateTierDiscountPct(-1, LIMITS)).toMatchObject({ ok: false, reason: 'negative' });
    expect(validateTierDiscountPct(5.005, LIMITS)).toMatchObject({ ok: false, reason: 'too_precise' });
  });
});

describe('resolveTierDiscount — fronteira do contrato público (§21)', () => {
  it('ausente / 0 / NaN / negativo → sem desconto (fração 0, não aplicado)', () => {
    expect(resolveTierDiscount(undefined, LIMITS)).toMatchObject({ fraction: 0, applied: false });
    expect(resolveTierDiscount(0, LIMITS)).toMatchObject({ fraction: 0, applied: false });
    expect(resolveTierDiscount(Number.NaN, LIMITS)).toMatchObject({ fraction: 0, applied: false });
    expect(resolveTierDiscount(-0.1, LIMITS)).toMatchObject({ fraction: 0, applied: false });
  });
  it('valor na faixa passa direto; fora da faixa é CLAMPADO e sinalizado', () => {
    expect(resolveTierDiscount(0.05, LIMITS)).toMatchObject({ fraction: 0.05, applied: true, clamped: false });
    expect(resolveTierDiscount(0.01, LIMITS)).toMatchObject({ fraction: LIMITS.min, applied: true, clamped: true });
    expect(resolveTierDiscount(0.2, LIMITS)).toMatchObject({ fraction: LIMITS.max, applied: true, clamped: true });
  });
});

describe('Waterfall do Platform Fee (§3.2.4) — sem incidência dupla', () => {
  const cx = computeComplexity(baseInput().complexity, P.complexityBands.value);
  const common = { table: 24625, floorEconomic: 0, complexity: cx, option: 'recommended' as const };

  it('ordem: base → ×(1−tier) → ×(1−comercial) → ×(1−prazo)', () => {
    const r = resolvePlatformFee({ ...common, extraDiscount: 0.1, termDiscount: 0.05, tierDiscount: 0.05 });
    const expected = r.chosen * (1 - 0.05) * (1 - 0.1) * (1 - 0.05);
    expect(r.final).toBeCloseTo(expected, 6);
    expect(r.afterTierDiscount).toBeCloseTo(r.chosen * 0.95, 6);
  });
  it('tierDiscount default 0 ⇒ resultado IDÊNTICO ao cálculo sem desconto por tier (paridade preservada)', () => {
    const withZero = resolvePlatformFee({ ...common, extraDiscount: 0.1, termDiscount: 0.05, tierDiscount: 0 });
    const without = resolvePlatformFee({ ...common, extraDiscount: 0.1, termDiscount: 0.05 });
    expect(withZero.final).toBeCloseTo(without.final, 12);
  });
  it('descontos NÃO se somam: 5%+5%+5% ≠ 15% linear (sequenciais sobre a base corrente)', () => {
    const r = resolvePlatformFee({ ...common, extraDiscount: 0.05, termDiscount: 0.05, tierDiscount: 0.05 });
    const linear15 = r.chosen * (1 - 0.15);
    const sequential = r.chosen * 0.95 ** 3;
    expect(r.final).toBeCloseTo(sequential, 6);
    expect(r.final).toBeGreaterThan(linear15); // sequencial desconta menos que a soma linear
  });
});

describe('Integração no engine — desconto por tier incide SÓ no Platform Fee (§3.2.5)', () => {
  it('reduz platformFee/core/TCV; NÃO toca usage, processing nem setup', () => {
    const noDisc = calculate(baseInput());
    const withDisc = calculate(baseInput({ tierDiscount: 0.05 }));

    // Platform Fee cai exatamente 5%
    expect(withDisc.platformFee).toBeCloseTo(noDisc.platformFee * 0.95, 6);
    // bases não elegíveis (§3.2.5) ficam idênticas
    expect(withDisc.usage).toBeCloseTo(noDisc.usage, 9);
    expect(withDisc.processing).toBeCloseTo(noDisc.processing, 9);
    expect(withDisc.setupNet).toBeCloseTo(noDisc.setupNet, 9);
    expect(withDisc.setupClient).toBeCloseTo(noDisc.setupClient, 9);
    // core cai só pela parcela do PF
    expect(noDisc.core - withDisc.core).toBeCloseTo(noDisc.platformFee - withDisc.platformFee, 6);
    expect(withDisc.tcvClient).toBeLessThan(noDisc.tcvClient);
    expect(withDisc.tierDiscount).toBeCloseTo(0.05, 9);
    expect(withDisc.tierDiscountApplied).toBe(true);
  });

  it('coexiste com desconto por prazo (36m=10%) sem duplicidade', () => {
    const r = calculate(baseInput({ tierDiscount: 0.05, term: 36 }));
    // final = chosen × 0.95 (tier) × 1 (comercial) × 0.90 (prazo)
    expect(r.discountWaterfall.final).toBeCloseTo(r.discountWaterfall.base * 0.95 * 0.9, 6);
    expect(r.termDiscount).toBeCloseTo(0.1, 9);
    expect(r.platformFee).toBeCloseTo(r.discountWaterfall.final, 9);
  });

  it('valor fora da faixa é clampado e gera warning TIER_DISCOUNT_CLAMPED', () => {
    const r = calculate(baseInput({ tierDiscount: 0.2 }));
    expect(r.tierDiscount).toBeCloseTo(LIMITS.max, 9);
    expect(r.warnings.some((w) => w.code === 'TIER_DISCOUNT_CLAMPED')).toBe(true);
  });

  it('descontos por tier distintos produzem resultados distintos na mesma base', () => {
    const a = calculate(baseInput({ tierDiscount: 0.03 }));
    const b = calculate(baseInput({ tierDiscount: 0.07 }));
    expect(b.platformFee).toBeLessThan(a.platformFee);
  });

  it('reversão para padrão (sem desconto por tier) restaura o Platform Fee', () => {
    const withDisc = calculate(baseInput({ tierDiscount: 0.05 }));
    const restored = calculate(baseInput({ tierDiscount: 0 }));
    expect(restored.tierDiscountApplied).toBe(false);
    expect(restored.platformFee).toBeGreaterThan(withDisc.platformFee);
  });
});

describe('Snapshot histórico reproduz o desconto por tier (§3.2.8 / §27.6)', () => {
  it('a proposta congela o desconto por tier e reproduz o cálculo', () => {
    const snap = createProposalSnapshot({ id: 'BONDLY-2027-000001', input: baseInput({ tierDiscount: 0.06 }) });
    expect(snap.input.negotiation.tierDiscount).toBeCloseTo(0.06, 9);
    expect(snap.result.tierDiscount).toBeCloseTo(0.06, 9);
    const re = reopenProposal(snap);
    expect(re.reproducible).toBe(true);
    expect(re.premisesIntact).toBe(true);
    expect(re.result.tierDiscount).toBeCloseTo(0.06, 9);
  });
  it('revisar preserva o desconto por tier do input', () => {
    const snap = createProposalSnapshot({ id: 'BONDLY-2027-000002', input: baseInput({ tierDiscount: 0.04 }) });
    const rev = reviseProposal(snap);
    expect(rev.revision).toBe(2);
    expect(rev.result.tierDiscount).toBeCloseTo(0.04, 9);
  });
});
