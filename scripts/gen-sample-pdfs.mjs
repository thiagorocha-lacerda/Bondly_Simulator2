// Gera os 3 PDFs de amostra (client / commercial / internal) para o sponsor validar o VISUAL.
//
// Exercita o MESMO gerador do app — generateQuotePdf (apps/commercial-workspace/src/services/pdf.ts) —
// alimentado pelo MESMO caminho de projeção por perfil que o servidor usa: calculate(input) do Pricing Engine
// + projectQuote(view, result, term, scenarios) (apps/auth-proxy/src/quoteProjection.ts, dist buildado).
// NÃO altera pdf.ts nem lógica de produto: só projeta um input representativo e salva os arquivos.
//
// jsPDF roda headless em Node (doc.output('arraybuffer')); o logo é um PNG data-URL puro (sem canvas/html2canvas).
//
// Uso: npm run build --workspace @bondly/pricing-engine && npm run build --workspace @bondly/auth-proxy \
//      && node --import ./scripts/ts-ext-loader-register.mjs scripts/gen-sample-pdfs.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculate, defaultScenarios, ENGINE_VERSION } from '@bondly/pricing-engine';
import { projectQuote } from '../apps/auth-proxy/dist/quoteProjection.js';
import { generateQuotePdf } from '../apps/commercial-workspace/src/services/pdf.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

// INPUT REPRESENTATIVO (ASSUMPTION rotulada): tier Growth ~50k usuários, opção recomendada, prazo 24m,
// 120h de implantação, via Minu. Mesmo formato de scripts/smoke-quote.mjs — espelha os defaults do simulador.
const input = {
  volume: { users: 50000, mauPct: 0.4, stickiness: 0.15, transactionsPerMau: 1 },
  invoices: { enabled: true, participantPct: 0.1, notesPerParticipant: 1 },
  communication: { perMau: 1, strategy: 'fallback', fallbackRate: 0.4, customMix: { sms: 0, email: 0, rcs: 1, wa: 0.4 } },
  complexity: { integrations: 2, modules: 2, slaPoints: 0, customizationPoints: 0, aiPoints: 0, migrationPoints: 0, implementationHours: 120 },
  negotiation: { option: 'recommended', extraDiscount: 0, term: 24, viaMinu: true, expansion: false, strategic: false, tierDiscount: 0, setupFixedReductionPct: 0, setupOtherAdditions: 0 },
  services: { profiles: [], tablePrice: 35000, minMargin: 5000, compCap: 25000, passthroughPct: 0, startMonth: 1, hourMinMargin: 50, productiveHoursPerMonth: 160 },
  campaign: { enabled: false, objectives: [], consentPct: 0, frequency: 1, months: 2, mix: { sms: 0, email: 0, rcs: 1, wa: 0.4 }, deliveryRate: { sms: 0.7, email: 0.7, rcs: 0.7, wa: 0.7 }, conversionRate: 0.35, activationRate: 0.15, operationHours: 0, markup: 0.2 },
  arka: { clientName: '', goLiveDate: '', owner: '', evidenceStage: 1, probability: 0 },
};

const result = calculate(input);
const scenarios = defaultScenarios(input).map((s) => ({ name: s.name, result: s.result }));
const term = input.negotiation.term;

const meta = {
  id: 'BND-2027-0001',
  issuedAt: new Date('2027-01-15T12:00:00Z').toISOString(),
  clientName: 'Programa de Fidelidade — Cliente Exemplo',
  selectedModules: ['pontos', 'engajamento'],
  users: input.volume.users,
};

const checks = [];
for (const view of ['client', 'commercial', 'internal']) {
  const payload = projectQuote(view, result, term, scenarios);
  const doc = await generateQuotePdf(payload, { ...meta, id: view === 'internal' ? meta.id + '-INT' : meta.id });
  const buf = Buffer.from(doc.output('arraybuffer'));
  const out = join(OUT, `bondly-proposta-${view}.pdf`);
  writeFileSync(out, buf);
  const header = buf.subarray(0, 5).toString('latin1');
  checks.push({ view, out, bytes: buf.length, header, ok: buf.length > 0 && header === '%PDF-' });
}

console.log(`engine=${ENGINE_VERSION} tier=${result.tierName} marginStatus=${result.marginStatus}`);
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.view.padEnd(10)} ${c.header} ${String(c.bytes).padStart(7)}B  ${c.out}`);
}
const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? 'GEN PDFs: FAIL' : 'GEN PDFs: PASS');
process.exit(failed.length ? 1 : 0);
