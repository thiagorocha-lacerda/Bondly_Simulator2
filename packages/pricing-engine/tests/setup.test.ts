import { describe, it, expect } from 'vitest';
import {
  calculate,
  setup,
  complexity as computeComplexity,
  CURRENT_PREMISES,
  PREMISES_V15,
  PREMISES_V16,
  createProposalSnapshot,
  reopenProposal,
  type PricingInput,
} from '../src/index.js';

const P = CURRENT_PREMISES;

function baseInput(neg?: Partial<PricingInput['negotiation']>, implHours = 0): PricingInput {
  return {
    volume: { users: 50000, mauPct: 0.4, stickiness: 0.15, transactionsPerMau: 1 },
    invoices: { enabled: true, participantPct: 0.1, notesPerParticipant: 1 },
    communication: { perMau: 1, strategy: 'fallback', fallbackRate: 0.4, customMix: { sms: 0, email: 0, rcs: 1, wa: 0.4 } },
    complexity: { integrations: 1, modules: 2, slaPoints: 0, customizationPoints: 0, aiPoints: 0, migrationPoints: 0, implementationHours: implHours },
    negotiation: { option: 'recommended', extraDiscount: 0, term: 12, viaMinu: true, expansion: false, strategic: false, ...neg },
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

describe('Setup — função decomposta (§4.1)', () => {
  const cx = computeComplexity(baseInput().complexity, P.complexityBands.value);
  const common = { tierSetup: 60000, complexity: cx, option: 'recommended' as const, viaMinu: false, setupMarkup: 0.2 };

  it('net = fixo + implementação + outros; defaults (red 0, outros 0) preservam o legado', () => {
    const r = setup({ ...common, implementationCost: 0 });
    expect(r.fixed).toBeCloseTo(60000, 6); // recommended = tierSetup × setupMultiplier(1 p/ Padrão)
    expect(r.net).toBeCloseTo(60000, 6);
    expect(r.otherAdditions).toBe(0);
    expect(r.fixedReductionPct).toBe(0);
  });

  it('fixo + N horas × R$/HH entra no net', () => {
    const r = setup({ ...common, implementationCost: 40 * 350, implementationHours: 40, hourlyRate: 350 });
    expect(r.implementationSubtotal).toBeCloseTo(14000, 6);
    expect(r.hourlyRate).toBeCloseTo(350, 6);
    expect(r.net).toBeCloseTo(60000 + 14000, 6);
  });

  it('redução configurável do fixo reduz só o fixo; outros adicionais somam ao net', () => {
    const r = setup({ ...common, implementationCost: 0, fixedReductionPct: 0.2, otherAdditions: 5000 });
    expect(r.fixed).toBeCloseTo(48000, 6); // 60000 × 0.8
    expect(r.net).toBeCloseTo(48000 + 5000, 6);
  });
});

describe('Setup no engine — horas entram SÓ no Setup (§4.1 / §11)', () => {
  it('HH não altera Capacity Fee nem mensalidade (core), só o Setup e o TCV', () => {
    const noH = calculate(baseInput({}, 0));
    const withH = calculate(baseInput({}, 40));
    // core (mensalidade recorrente) idêntico
    expect(withH.core).toBeCloseTo(noH.core, 6);
    expect(withH.platformFee).toBeCloseTo(noH.platformFee, 6);
    // setup cresce exatamente 40 × R$/HH
    expect(withH.setup.implementationSubtotal).toBeCloseTo(40 * withH.setup.hourlyRate, 6);
    expect(withH.setupNet - noH.setupNet).toBeCloseTo(withH.setup.implementationSubtotal, 6);
  });

  it('HH aparece UMA ÚNICA VEZ: a diferença no TCV Bondly é exatamente o subtotal de implantação', () => {
    const noH = calculate(baseInput({}, 0));
    const withH = calculate(baseInput({}, 40));
    expect(withH.tcvBondly - noH.tcvBondly).toBeCloseTo(withH.setup.implementationSubtotal, 4);
  });

  it('breakdown do Setup bate com setupNet/setupClient', () => {
    const r = calculate(baseInput({}, 40));
    expect(r.setup.fixed + r.setup.implementationSubtotal + r.setup.otherAdditions).toBeCloseTo(r.setupNet, 6);
    expect(r.setup.client).toBeCloseTo(r.setupClient, 6);
    expect(r.setup.hourlyRate).toBeCloseTo(350, 6); // default R$ 350/HH
  });
});

describe('Setup — redução e outros adicionais no engine (§4.1/§4.2)', () => {
  it('redução AD HOC acima do default validado gera warning SETUP_FIXED_REDUCTION_PENDING', () => {
    // Em v16 o default validado é 0,20; uma concessão de 0,30 é ad hoc e pendente.
    const reduced = calculate(baseInput({ setupFixedReductionPct: 0.3 }, 0));
    expect(reduced.setup.fixedReductionPct).toBeCloseTo(0.3, 9);
    expect(reduced.warnings.some((w) => w.code === 'SETUP_FIXED_REDUCTION_PENDING')).toBe(true);
  });

  it('outros adicionais somam ao Setup sem tocar a mensalidade', () => {
    const baseR = calculate(baseInput({}, 0));
    const withOther = calculate(baseInput({ setupOtherAdditions: 8000 }, 0));
    expect(withOther.setupNet - baseR.setupNet).toBeCloseTo(8000, 6);
    expect(withOther.core).toBeCloseTo(baseR.core, 6);
  });

  it('sem redução/outros: Setup bate com fixo+implementação (base da tabela ativa)', () => {
    const r = calculate(baseInput({}, 40));
    const legacyNet = r.setup.fixed + 40 * r.setup.hourlyRate; // fixed + impl, sem outros
    expect(r.setupNet).toBeCloseTo(legacyNet, 6);
    expect(r.setup.otherAdditions).toBe(0);
  });
});

describe('Setup fixo −20% como DEFAULT governado da v16 (DECISION sponsor 2026-11-05)', () => {
  it('v16 aplica −20% no Setup fixo por padrão (Growth/recomendado/Padrão 60000 → 48000)', () => {
    // baseInput: 50.000 usuários = tier Growth (setup 60000), opção recommended, banda Padrão (mult 1).
    const r = calculate(baseInput({}, 0), PREMISES_V16);
    expect(r.premisesVersion).toBe('v16');
    expect(r.setup.fixedReductionPct).toBeCloseTo(0.2, 9);
    expect(r.setup.fixed).toBeCloseTo(48000, 6); // 60000 × 0,8
  });

  it('v16/piso: Starter 36000 → 28800 (base piso = tier.setup×0.9, −20%)', () => {
    // 25.000 usuários = Starter (setup 40000). Piso: 40000×0.9=36000; −20% ⇒ 28800.
    const base = baseInput({ option: 'floor' }, 0);
    const input: PricingInput = { ...base, volume: { ...base.volume, users: 25000 } };
    const rStarter = calculate(input, PREMISES_V16);
    expect(rStarter.setup.fixed).toBeCloseTo(28800, 6);
  });

  it('o DEFAULT validado da v16 NÃO emite SETUP_FIXED_REDUCTION_PENDING', () => {
    const r = calculate(baseInput({}, 0), PREMISES_V16);
    expect(r.setup.fixedReductionPct).toBeCloseTo(0.2, 9);
    expect(r.warnings.some((w) => w.code === 'SETUP_FIXED_REDUCTION_PENDING')).toBe(false);
  });

  it('proposta que informa exatamente o default (0,20) tampouco é pendente', () => {
    const r = calculate(baseInput({ setupFixedReductionPct: 0.2 }, 0), PREMISES_V16);
    expect(r.warnings.some((w) => w.code === 'SETUP_FIXED_REDUCTION_PENDING')).toBe(false);
  });

  it('v15 permanece SEM redução (default 0) e reabre idêntica ao comportamento histórico', () => {
    const r15 = calculate(baseInput({}, 0), PREMISES_V15);
    expect(r15.premisesVersion).toBe('v15');
    expect(r15.setup.fixedReductionPct).toBe(0);
    expect(r15.setup.fixed).toBeCloseTo(60000, 6); // sem redução
    // snapshot v15 reabre idêntico
    const snap = createProposalSnapshot({ id: 'BONDLY-2027-000020', input: baseInput({}, 0), premises: PREMISES_V15 });
    const re = reopenProposal(snap);
    expect(re.reproducible).toBe(true);
    expect(re.premisesIntact).toBe(true);
    expect(re.result.setup.fixedReductionPct).toBe(0);
    expect(re.result.setup.fixed).toBeCloseTo(60000, 6);
  });

  it('coexistência: v16 = Setup fixo 20% menor que v15 para a mesma entrada', () => {
    const r15 = calculate(baseInput({}, 0), PREMISES_V15);
    const r16 = calculate(baseInput({}, 0), PREMISES_V16);
    expect(r16.setup.fixed).toBeCloseTo(r15.setup.fixed * 0.8, 6);
    expect(r16.premisesHash).not.toBe(r15.premisesHash);
  });

  it('entrada da proposta sobrescreve o default (0 explícito ⇒ v16 sem redução)', () => {
    const r = calculate(baseInput({ setupFixedReductionPct: 0 }, 0), PREMISES_V16);
    expect(r.setup.fixedReductionPct).toBe(0);
    expect(r.setup.fixed).toBeCloseTo(60000, 6);
  });

  // F-02 (forward-compat): um snapshot congelado sob o schema ANTIGO não tem o campo
  // `setupFixedReductionDefault`. Reabrir/recalcular NÃO pode crashar (TypeError em undefined.value);
  // o campo ausente deve ser tratado como 0 (comportamento histórico: tabela antiga = sem redução).
  it('snapshot legado SEM setupFixedReductionDefault reabre sem crash e reproduz Setup sem redução', () => {
    // Simula a tabela de premissas congelada do schema antigo (sem o campo novo).
    const { setupFixedReductionDefault: _omit, ...legacyPremises } = PREMISES_V15 as typeof PREMISES_V15 & {
      setupFixedReductionDefault?: unknown;
    };
    const legacy = legacyPremises as unknown as typeof PREMISES_V15;

    // Leitura direta no caminho que o Guardian provou crashar (calculate.ts).
    expect(() => calculate(baseInput({}, 0), legacy)).not.toThrow();
    const r = calculate(baseInput({}, 0), legacy);
    expect(r.setup.fixedReductionPct).toBe(0);
    expect(r.setup.fixed).toBeCloseTo(60000, 6); // ausente ⇒ 0 ⇒ sem redução

    // E via reopenProposal (reidrata o snapshot legado e recalcula contra ele).
    const snap = createProposalSnapshot({ id: 'BONDLY-2027-000099', input: baseInput({}, 0), premises: legacy });
    expect(() => reopenProposal(snap)).not.toThrow();
    const re = reopenProposal(snap);
    expect(re.result.setup.fixedReductionPct).toBe(0);
    expect(re.result.setup.fixed).toBeCloseTo(60000, 6);
  });
});
