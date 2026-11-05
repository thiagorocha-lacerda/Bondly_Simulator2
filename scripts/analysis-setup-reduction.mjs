/**
 * ANÁLISE REPRODUTÍVEL (somente leitura) — Impacto do corte do Setup fixo na margem.
 *
 * NÃO altera código nem premissas. Importa o PRÓPRIO Pricing Engine (dist já buildado) e varre
 * todas as combinações pedidas, capturando Setup net/client, status de margem e flags emitidas.
 *
 * Fontes (motor):
 *   - calculate()                      packages/pricing-engine/src/calculations/calculate.ts
 *   - setup()                          packages/pricing-engine/src/pricing/setup.ts
 *   - services() -> hourStatus         packages/pricing-engine/src/pricing/services.ts
 *   - marginStatus()/technicalMargin() packages/pricing-engine/src/margins/margins.ts
 *   - premissas v16                    packages/pricing-engine/src/premises/premises.ts
 *
 * Execução: node scripts/analysis-setup-reduction.mjs
 */
import {
  calculate,
  CURRENT_PREMISES,
} from '../packages/pricing-engine/dist/index.js';

const P = CURRENT_PREMISES;

// ---- Seleção determinística de tier (tierFor: menor tier cujo teto >= users) --------------------
const TIERS = [
  { name: 'Starter', users: 25000, setup: 40000 },
  { name: 'Growth', users: 50000, setup: 60000 },
  { name: 'Scale', users: 150000, setup: 100000 },
  { name: 'Enterprise', users: 250000, setup: 140000 },
  { name: 'Enterprise+', users: 400000, setup: 180000 },
];

// ---- Complexidade: inputs que caem em cada banda (score < maxScore) -----------------------------
// Padrão score<25 ; Avançado <50 ; Complexo <75 ; Estratégico <101
const CX = {
  'Padrão': { integrations: 0, modules: 1, slaPoints: 0, customizationPoints: 0, aiPoints: 0, migrationPoints: 0 }, // 0
  'Avançado': { integrations: 5, modules: 1, slaPoints: 7.5, customizationPoints: 0, aiPoints: 0, migrationPoints: 0 }, // 27.5
  'Complexo': { integrations: 5, modules: 1, slaPoints: 15, customizationPoints: 20, aiPoints: 0, migrationPoints: 0 }, // 55
  'Estratégico': { integrations: 5, modules: 1, slaPoints: 15, customizationPoints: 20, aiPoints: 15, migrationPoints: 15 }, // 85
};
const MULT = { 'Padrão': 1, 'Avançado': 1.15, 'Complexo': 1.3, 'Estratégico': 1.5 };
const OPTFACTOR = { floor: 0.9, recommended: 1, premium: 1.15 };

const OPTIONS = ['floor', 'recommended', 'premium'];
const BANDS = ['Padrão', 'Avançado', 'Complexo', 'Estratégico'];
const HOURS = [0, 10, 40, 100];
const REDUCTIONS = [0, 0.1, 0.15, 0.2];

function makeInput(tier, option, bandName, hours, reductionPct) {
  return {
    volume: { users: tier.users, mauPct: 0.4, stickiness: 0.15, transactionsPerMau: 1 },
    invoices: { enabled: true, participantPct: 0.1, notesPerParticipant: 1 },
    communication: { perMau: 1, strategy: 'fallback', fallbackRate: 0.4, customMix: { sms: 0, email: 0, rcs: 1, wa: 0.4 } },
    complexity: { ...CX[bandName], implementationHours: hours },
    negotiation: {
      option, extraDiscount: 0, term: 12, viaMinu: true, expansion: false, strategic: false,
      setupFixedReductionPct: reductionPct, setupOtherAdditions: 0,
    },
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

const rows = [];
for (const tier of TIERS) {
  for (const option of OPTIONS) {
    for (const band of BANDS) {
      for (const hours of HOURS) {
        for (const red of REDUCTIONS) {
          const r = calculate(makeInput(tier, option, band, hours, red));
          const flags = r.warnings.map((w) => w.code);
          rows.push({
            tier: tier.name, option, band, hours, red,
            setupFixed: r.setup.fixed,
            implSub: r.setup.implementationSubtotal,
            setupNet: r.setupNet,
            setupClient: r.setupClient,
            marginStatus: r.marginStatus,
            technicalMargin: r.technicalMargin,
            hourBelowMin: flags.includes('SETUP_HOUR_BELOW_MIN_MARGIN'),
            reductionPending: flags.includes('SETUP_FIXED_REDUCTION_PENDING'),
            flags: flags.join('|'),
          });
        }
      }
    }
  }
}

// ---- Resumo 1: a redução altera marginStatus ou dispara SETUP_HOUR_BELOW_MIN_MARGIN? ------------
const statuses = new Set(rows.map((r) => r.marginStatus));
const anyHourBelow = rows.filter((r) => r.hourBelowMin);
const anyReprice = rows.filter((r) => r.marginStatus === 'REPRECIFICAR');
console.log('=== RESUMO GLOBAL ===');
console.log('marginStatus observados (todas as combinações):', [...statuses].join(', '));
console.log('Cenários com SETUP_HOUR_BELOW_MIN_MARGIN:', anyHourBelow.length);
console.log('Cenários com marginStatus=REPRECIFICAR:', anyReprice.length);

// marginStatus varia com a redução do setup? (comparar red=0 vs red=0.2 mesmo resto)
let statusChangedByReduction = 0;
for (const tier of TIERS) for (const option of OPTIONS) for (const band of BANDS) for (const hours of HOURS) {
  const a = rows.find((r) => r.tier === tier.name && r.option === option && r.band === band && r.hours === hours && r.red === 0);
  const b = rows.find((r) => r.tier === tier.name && r.option === option && r.band === band && r.hours === hours && r.red === 0.2);
  if (a.marginStatus !== b.marginStatus) statusChangedByReduction++;
}
console.log('Combinações onde marginStatus muda entre red=0% e red=20%:', statusChangedByReduction);

// ---- Resumo 2: variação do Setup net/client por tier/opção/banda (independe de horas) ------------
console.log('\n=== SETUP FIXO (net, horas=0) — Atual x -10% x -15% x -20% por tier/opção/banda ===');
console.log('tier | option | band | 0% | -10% | -15% | -20% | Δ%(-20%)');
for (const tier of TIERS) for (const option of OPTIONS) for (const band of BANDS) {
  const get = (red) => rows.find((r) => r.tier === tier.name && r.option === option && r.band === band && r.hours === 0 && r.red === red).setupNet;
  const v0 = get(0), v10 = get(0.1), v15 = get(0.15), v20 = get(0.2);
  console.log(`${tier.name} | ${option} | ${band} | ${v0.toFixed(0)} | ${v10.toFixed(0)} | ${v15.toFixed(0)} | ${v20.toFixed(0)} | ${((v20 / v0 - 1) * 100).toFixed(2)}%`);
}

// ---- Resumo 3: hourStatus / margem da hora (independe do setup fixo) -----------------------------
console.log('\n=== MARGEM DA HORA DE IMPLANTAÇÃO (hourStatus / SETUP_HOUR_BELOW_MIN_MARGIN) ===');
const hr = rows.find((r) => r.hours === 40);
console.log('hourStatus é função só de hourPrice×net - hourCost vs R$50/HH; independe de setupFixedReductionPct.');
console.log('Qualquer cenário com horas>0 dispara SETUP_HOUR_BELOW_MIN_MARGIN?', anyHourBelow.length > 0);

// ---- Export JSON completo para auditoria --------------------------------------------------------
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./analysis-setup-reduction.out.json', import.meta.url), JSON.stringify(rows, null, 2));
console.log('\nLinhas calculadas:', rows.length, '-> scripts/analysis-setup-reduction.out.json');
