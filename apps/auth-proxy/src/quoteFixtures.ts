/** Fixtures de teste da cotação (G-001-A). Excluído do build (tsconfig). Espelha DEFAULT_INPUT do Commercial Workspace. */
import type { PricingInput } from '@bondly/pricing-engine';

export function baseInput(): PricingInput {
  return {
    volume: { users: 50000, mauPct: 0.4, stickiness: 0.15, transactionsPerMau: 1 },
    invoices: { enabled: true, participantPct: 0.1, notesPerParticipant: 1 },
    communication: { perMau: 1, strategy: 'fallback', fallbackRate: 0.4, customMix: { sms: 0, email: 0, rcs: 1, wa: 0.4 } },
    complexity: { integrations: 1, modules: 2, slaPoints: 0, customizationPoints: 0, aiPoints: 0, migrationPoints: 0, implementationHours: 0 },
    negotiation: { option: 'recommended', extraDiscount: 0, term: 12, viaMinu: true, expansion: false, strategic: false, tierDiscount: 0, setupFixedReductionPct: 0, setupOtherAdditions: 0 },
    services: { profiles: [], tablePrice: 35000, minMargin: 5000, compCap: 25000, passthroughPct: 0, startMonth: 1, hourMinMargin: 50, productiveHoursPerMonth: 160 },
    campaign: {
      enabled: false, objectives: [], consentPct: 0, frequency: 1, months: 2,
      mix: { sms: 0, email: 0, rcs: 1, wa: 0.4 }, deliveryRate: { sms: 0.7, email: 0.7, rcs: 0.7, wa: 0.7 },
      conversionRate: 0.35, activationRate: 0.15, operationHours: 0, markup: 0.2,
    },
    arka: { clientName: 'Cliente X', goLiveDate: '', owner: '', evidenceStage: 1, probability: 0 },
  };
}

/** Margem técnica abaixo do piso (engine: REPRECIFICAR) — desconto negociado alto, opção piso, 36 meses. */
export function lowMarginInput(): PricingInput {
  const i = baseInput();
  return { ...i, negotiation: { ...i.negotiation, extraDiscount: 0.6, option: 'floor', term: 36 } };
}

type Mut = (i: PricingInput) => PricingInput;
const withNeg = (p: Partial<PricingInput['negotiation']>): Mut => (i) => ({ ...i, negotiation: { ...i.negotiation, ...p } });
const withCx = (p: Partial<PricingInput['complexity']>): Mut => (i) => ({ ...i, complexity: { ...i.complexity, ...p } });
const withVol = (p: Partial<PricingInput['volume']>): Mut => (i) => ({ ...i, volume: { ...i.volume, ...p } });

/** Conjunto amplo: Setup 0/10/40/100 h, tiers 3/5/7%, prazos 12/24/36, opções, canais, via Minu, serviços, tiers de base. */
export function parityInputs(): { name: string; input: PricingInput }[] {
  const out: { name: string; input: PricingInput }[] = [{ name: 'default', input: baseInput() }, { name: 'lowMargin', input: lowMarginInput() }];
  for (const h of [0, 10, 40, 100]) out.push({ name: `setup${h}h`, input: withCx({ implementationHours: h })(baseInput()) });
  for (const t of [0.03, 0.05, 0.07]) out.push({ name: `tier${t}`, input: withNeg({ tierDiscount: t })(baseInput()) });
  for (const term of [12, 24, 36] as const) out.push({ name: `term${term}`, input: withNeg({ term })(baseInput()) });
  for (const option of ['floor', 'recommended', 'premium'] as const) out.push({ name: `opt-${option}`, input: withNeg({ option })(baseInput()) });
  for (const strategy of ['rcs', 'wa', 'sms', 'email', 'both', 'fallback', 'custom', 'none'] as const) {
    const b = baseInput();
    out.push({ name: `comm-${strategy}`, input: { ...b, communication: { ...b.communication, strategy } } });
  }
  for (const users of [1000, 25000, 150000, 250000, 400000, 600000]) out.push({ name: `users${users}`, input: withVol({ users })(baseInput()) });
  out.push({ name: 'direct', input: withNeg({ viaMinu: false })(baseInput()) });
  out.push({ name: 'setupReduction', input: withNeg({ setupFixedReductionPct: 0.2, setupOtherAdditions: 1500 })(withCx({ implementationHours: 40 })(baseInput())) });
  out.push({ name: 'discount+corridor', input: withNeg({ extraDiscount: 0.2, expansion: true, strategic: true })(baseInput()) });
  const b = baseInput();
  out.push({
    name: 'services+campaign',
    input: {
      ...b,
      services: { ...b.services, profiles: [{ name: 'Dev', quantity: 2, totalCompensation: 18000, directCosts: 500 }], passthroughPct: 0.1 },
      campaign: { ...b.campaign, enabled: true, objectives: ['Aquisição'], consentPct: 0.5, operationHours: 20 },
    },
  });
  return out;
}
