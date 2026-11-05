import { describe, it, expect } from 'vitest';
import { calculate, PREMISES_V15 } from '../src/index.js';
import type { PricingInput, CommercialOption, CommunicationStrategy, ContractMonths } from '../src/index.js';
import { legacyCalc, type LegacyScenario } from './legacyReference.js';

/** Converte um cenário legado para a entrada do Pricing Engine. */
function toInput(s: LegacyScenario): PricingInput {
  const option: CommercialOption = s.opt === 0.9 ? 'floor' : s.opt === 1 ? 'recommended' : 'premium';
  return {
    volume: {
      users: s.users,
      mauPct: s.mauPct / 100,
      stickiness: s.stick / 100,
      transactionsPerMau: s.tx,
    },
    invoices: { enabled: s.nfOn, participantPct: s.nfPct / 100, notesPerParticipant: s.nfQty },
    communication: {
      perMau: s.cpm,
      strategy: s.comm as CommunicationStrategy,
      fallbackRate: s.fb / 100,
      customMix: { sms: 0, email: 0, rcs: 1, wa: 0.4 },
    },
    complexity: {
      integrations: s.integ,
      modules: s.mods,
      slaPoints: s.sla,
      customizationPoints: s.custom,
      aiPoints: s.ai,
      migrationPoints: s.migr,
      implementationHours: s.implh,
    },
    negotiation: {
      option,
      extraDiscount: s.disc / 100,
      term: s.term as ContractMonths,
      viaMinu: s.via,
      expansion: s.exp,
      strategic: s.key,
    },
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
  };
}

const base: LegacyScenario = {
  users: 50000,
  mauPct: 40,
  stick: 15,
  tx: 1,
  nfOn: true,
  nfPct: 10,
  nfQty: 1,
  comm: 'fallback',
  fb: 40,
  cpm: 1,
  integ: 1,
  mods: 2,
  sla: 0,
  custom: 0,
  ai: 0,
  migr: 0,
  implh: 0,
  opt: 1,
  disc: 0,
  term: 12,
  via: true,
  exp: false,
  key: false,
};

/** Grid de cenários que varre os eixos principais. */
function grid(): LegacyScenario[] {
  const out: LegacyScenario[] = [base];
  const usersSet = [10000, 25000, 50000, 150000, 250000, 400000, 500000];
  const terms: (12 | 24 | 36)[] = [12, 24, 36];
  const opts: (0.9 | 1 | 1.1)[] = [0.9, 1, 1.1];
  const comms: LegacyScenario['comm'][] = ['fallback', 'rcs', 'wa', 'sms', 'email', 'both', 'none'];
  for (const users of usersSet)
    for (const term of terms)
      for (const opt of opts) out.push({ ...base, users, term, opt });
  for (const comm of comms) out.push({ ...base, comm });
  // eixos de complexidade / negociação / NF / via
  out.push({ ...base, integ: 5, mods: 5, sla: 15, custom: 20, ai: 15, migr: 15 }); // estratégico
  out.push({ ...base, integ: 2, mods: 3, sla: 7.5 }); // avançado
  out.push({ ...base, integ: 3, mods: 4, custom: 10, ai: 7.5, migr: 7.5 }); // complexo
  out.push({ ...base, disc: 5 });
  out.push({ ...base, disc: 10, exp: true });
  out.push({ ...base, disc: 15, exp: true, key: true, term: 36 });
  out.push({ ...base, nfOn: false });
  out.push({ ...base, nfPct: 50, nfQty: 3 });
  out.push({ ...base, via: false });
  out.push({ ...base, implh: 40 });
  out.push({ ...base, mauPct: 0 }); // incompleto
  out.push({ ...base, stick: 30, tx: 2.5, cpm: 2 });
  return out;
}

describe('Paridade Pricing Engine × calc() legado (§22)', () => {
  const scenarios = grid();
  // Paridade bit-a-bit é contra a v15 (tabela congelada equivalente ao HTML legado). A v16 diverge
  // DELIBERADAMENTE no Setup fixo (redução default de 20% validada pelo sponsor, DECISION 2026-11-05),
  // portanto não é comparável ao legado — ver tests/setup.test.ts (v16 −20%) e docs/19.
  it(`reproduz ${scenarios.length} cenários com valores idênticos (vs. v15 congelada)`, () => {
    for (const s of scenarios) {
      const legacy = legacyCalc(s);
      const r = calculate(toInput(s), PREMISES_V15);
      const ctx = JSON.stringify(s);
      const close = (a: number, b: number, tol = 1e-6) =>
        expect(Math.abs(a - b), `${ctx}`).toBeLessThanOrEqual(tol);
      close(r.platformFeeTable, legacy.pfTable);
      close(r.platformFee, legacy.pf);
      close(r.usage, legacy.usage);
      close(r.processing, legacy.proc);
      close(r.core, legacy.core);
      close(r.costs.total, legacy.cogs);
      close(r.technicalMargin, legacy.margin, 1e-9);
      close(r.mau, legacy.mau);
      close(r.dau, legacy.dau);
      close(r.setupNet, legacy.setupNet);
      close(r.setupClient, legacy.setupClient);
      close(r.netMarginY1, legacy.netY1, 1e-9);
      close(r.netMarginSteady, legacy.netSteady, 1e-9);
      close(r.minuYear1, legacy.minuY1);
      close(r.clientYear1, legacy.clientY1);
      close(r.tcvClient, legacy.tcvClient);
      close(r.tcvBondly, legacy.tcvBondly);
      close(r.contractContribution, legacy.kContrib, 1e-4);
      close(r.minuContract, legacy.minuContract);
      close(r.complexityScore, legacy.score, 1e-9);
      expect(r.complexityBand, ctx).toBe(legacy.band);
      expect(r.tierName, ctx).toBe(legacy.tierName);
    }
  });
});
