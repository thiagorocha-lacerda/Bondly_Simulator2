import type { PricingInput } from '@bondly/pricing-types';

/** Entrada padrão — reproduz os defaults do simulador HTML (§10.1 premissas padrão). */
export const DEFAULT_INPUT: PricingInput = {
  volume: { users: 50000, mauPct: 0.4, stickiness: 0.15, transactionsPerMau: 1 },
  invoices: { enabled: true, participantPct: 0.1, notesPerParticipant: 1 },
  communication: {
    perMau: 1,
    strategy: 'fallback',
    fallbackRate: 0.4,
    customMix: { sms: 0, email: 0, rcs: 1, wa: 0.4 },
  },
  complexity: {
    integrations: 1,
    modules: 2,
    slaPoints: 0,
    customizationPoints: 0,
    aiPoints: 0,
    migrationPoints: 0,
    implementationHours: 0,
  },
  negotiation: { option: 'recommended', extraDiscount: 0, term: 12, viaMinu: true, expansion: false, strategic: false, tierDiscount: 0, setupFixedReductionPct: 0, setupOtherAdditions: 0 },
  services: {
    profiles: [],
    tablePrice: 35000,
    minMargin: 5000,
    compCap: 25000,
    targetMargin: undefined,
    passthroughPct: 0,
    startMonth: 1,
    hourMinMargin: 50,
    productiveHoursPerMonth: 160,
    hourCost: undefined,
    negotiatedHourPrice: undefined,
  },
  campaign: {
    enabled: false,
    objectives: [],
    base: undefined,
    consentPct: 0,
    frequency: 1,
    months: 2,
    mix: { sms: 0, email: 0, rcs: 1, wa: 0.4 },
    deliveryRate: { sms: 0.7, email: 0.7, rcs: 0.7, wa: 0.7 },
    conversionRate: 0.35,
    activationRate: 0.15,
    operationHours: 0,
    markup: 0.2,
  },
  arka: { clientName: '', goLiveDate: '', owner: '', evidenceStage: 1, probability: 0 },
};

export const brl = (v: number): string => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
export const brl2 = (v: number): string =>
  'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (v: number): string =>
  (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
export const n0 = (v: number): string => Math.round(v).toLocaleString('pt-BR');
