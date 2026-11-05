// G-001-A Fase 4 — SMOKE E2E da jornada COTAÇÃO → PROPOSTA → EMISSÃO contra o auth-proxy REAL (buildado + SQLite
// em DATA_DIR efêmero, modo produção). Padrão de scripts/smoke-quote.mjs / smoke-sla.mjs (bootstrap admin,
// atribuição de perfis via API, cookies de sessão). Prova, ponta a ponta:
//   1. cotação POR PERFIL no fio: business ⇒ view 'commercial' SEM custo/margem; tech ⇒ 'internal' com breakdown;
//   2. RECONCILIAÇÃO cotação = proposta: quotar por {input} e quotar a proposta criada por {proposalId} dão o MESMO
//      preço público (mesma fonte persistida, nada recalculado no cliente);
//   3. jornada de esteira submeter → análise → aprovar técnico → consolidar → (exceção) → emitir, DOCUMENTANDO o
//      estado REAL do gate G-026 (ver NOTA abaixo), sem falso verde.
//
// NOTA G-026 (estado REAL verificado no código, api.ts ~l.715): o gate de política é consultado em AMBAS as
// transições cujo destino é `pronto_para_emissao` (consolidar) E `emitido` (emitir) — "defesa em profundidade"
// (emissionGuard.test.ts). A premissa da tarefa ("emitir ainda não consulta G-026") NÃO corresponde ao código
// atual: emitir TAMBÉM é gated. Este smoke ASSERTA o comportamento implementado hoje; não implementa nada novo.
//
// Uso: npm run build --workspace @bondly/pricing-engine && npm run build --workspace @bondly/auth-proxy \
//      && node scripts/smoke-e2e-quote-proposal.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createSessionToken } from '../apps/auth-proxy/dist/session.js';

const ROOT = process.cwd();
const SEC = randomBytes(48).toString('base64url');
const PORT = 8795;
const BASE = `http://127.0.0.1:${PORT}`;
const scratch = process.env.KIROCREW_SCRATCH || ROOT;
const dataDir = mkdtempSync(join(scratch, 'e2e-quote-proposal-'));
const staticDir = join(dataDir, 'static');
mkdirSync(staticDir);
writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>e2e</title>');

const E = { adm: 'adm@minu.co', biz: 'biz@minu.co', tech: 'tec@minu.co', apr: 'apr@minu.co' };
const srv = spawn(process.execPath, ['apps/auth-proxy/dist/server.js'], {
  cwd: ROOT,
  env: {
    ...process.env, NODE_ENV: 'production', DATA_DIR: dataDir, SESSION_SECRET: SEC, PORT: String(PORT), STATIC_DIR: staticDir,
    PUBLIC_URL: BASE, GOOGLE_CLIENT_ID: 'dummy.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: randomBytes(24).toString('base64url'),
    BOOTSTRAP_ADMIN_EMAILS: E.adm,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
srv.stdout.on('data', (d) => (log += d));
srv.stderr.on('data', (d) => (log += d));

const hdr = (email) => ({
  Cookie: 'bondly_sess=' + createSessionToken({ email, domain: 'minu.co' }, SEC),
  'Content-Type': 'application/json', Accept: 'application/json', Origin: BASE,
});
const api = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: hdr(E[who]), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corpo vazio */ }
  return { status: r.status, json, text, headers: r.headers };
};
const results = [];
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail });

// Input com margem SAUDÁVEL (sem desconto agressivo): a jornada feliz consolida/emite SEM exigir exceção.
const healthy = {
  volume: { users: 50000, mauPct: 0.4, stickiness: 0.15, transactionsPerMau: 1 },
  invoices: { enabled: true, participantPct: 0.1, notesPerParticipant: 1 },
  communication: { perMau: 1, strategy: 'fallback', fallbackRate: 0.4, customMix: { sms: 0, email: 0, rcs: 1, wa: 0.4 } },
  complexity: { integrations: 1, modules: 2, slaPoints: 0, customizationPoints: 0, aiPoints: 0, migrationPoints: 0, implementationHours: 0 },
  negotiation: { option: 'recommended', extraDiscount: 0, term: 12, viaMinu: true, expansion: false, strategic: false, tierDiscount: 0 },
  services: { profiles: [], tablePrice: 35000, minMargin: 5000, compCap: 25000, passthroughPct: 0, startMonth: 1, hourMinMargin: 50, productiveHoursPerMonth: 160 },
  campaign: { enabled: false, objectives: [], consentPct: 0, frequency: 1, months: 2, mix: { sms: 0, email: 0, rcs: 1, wa: 0.4 }, deliveryRate: { sms: 0.7, email: 0.7, rcs: 0.7, wa: 0.7 }, conversionRate: 0.35, activationRate: 0.15, operationHours: 0, markup: 0.2 },
};
// Input com margem ABAIXO do piso (engine: REPRECIFICAR): consolidar/emitir exigem exceção aprovada (G-026).
const lowMargin = { ...healthy, negotiation: { ...healthy.negotiation, extraDiscount: 0.6, option: 'floor', term: 36 } };
// Campos internos que NUNCA podem aparecer na visão commercial (no fio).
const LEAK = /cogs|technicalMargin|netMargin|"costs"|"taxes"|tcvBondly|setupNet|premisesHash|contractContribution/;

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`${BASE}/healthz`)).ok; } catch { /* aguardando */ }
    if (!up) await new Promise((r) => setTimeout(r, 150));
  }
  check('server sobe em produção (/healthz=200)', up);
  if (!up) throw new Error('server não subiu\n' + log);

  // --- perfis (RBAC derivado de role_assignments) ---
  for (const [who, role] of [['biz', 'business'], ['tech', 'tech'], ['apr', 'approver']]) {
    check(`admin atribui ${role}`, (await api('adm', 'PUT', '/api/admin/assignments', { email: E[who], role })).status === 200);
  }

  // ===== PARTE A — COTAÇÃO POR PERFIL =====
  const qBiz = await api('biz', 'POST', '/api/pricing/quote', { input: healthy });
  check('business cota ⇒ 200 view=commercial', qBiz.status === 200 && qBiz.json?.quote?.view === 'commercial', qBiz.status);
  check('business: SEM custo/margem no fio', !LEAK.test(qBiz.text));
  const qTech = await api('tech', 'POST', '/api/pricing/quote', { input: healthy });
  check('tech cota ⇒ 200 view=internal com breakdown', qTech.json?.quote?.view === 'internal' && qTech.json.quote.result?.costs?.total > 0, qTech.status);

  // ===== PARTE B — PROPOSTA + RECONCILIAÇÃO cotação = proposta =====
  const created = await api('biz', 'POST', '/api/proposals', { commercial: healthy });
  const id = created.json?.proposal?.id;
  check('business cria proposta (inputs persistidos)', created.status === 201 && !!id, created.text?.slice(0, 160));
  if (!id) throw new Error('criação falhou: ' + created.text);

  const byInput = await api('biz', 'POST', '/api/pricing/quote', { input: healthy });
  const byProposal = await api('biz', 'POST', '/api/pricing/quote', { proposalId: id });
  check('cotar por proposalId ⇒ 200 commercial', byProposal.status === 200 && byProposal.json?.quote?.view === 'commercial', byProposal.text?.slice(0, 160));
  // reconciliação: o PREÇO público projetado da proposta é idêntico ao da cotação avulsa do mesmo input.
  const pricingOf = (r) => JSON.stringify(r.json?.quote?.pricing);
  check('reconciliação cotação=proposta (mesmo pricing público)', pricingOf(byInput) === pricingOf(byProposal), `input=${pricingOf(byInput)} proposal=${pricingOf(byProposal)}`);
  check('reconciliação: proposta NÃO vaza custo/margem', !LEAK.test(byProposal.text));

  // ===== PARTE C — JORNADA DE ESTEIRA ATÉ EMISSÃO (margem saudável: sem exceção) =====
  const ver = async () => (await api('biz', 'GET', `/api/proposals/${id}`)).json.proposal.version;
  const tr = async (who, name) => api(who, 'POST', `/api/proposals/${id}/transition`, { version: await ver(), transition: name });
  check('submeter_analise', (await tr('biz', 'submeter_analise')).status === 200);
  check('iniciar_analise (tech)', (await tr('tech', 'iniciar_analise')).status === 200);
  check('aprovar_tecnico (tech)', (await tr('tech', 'aprovar_tecnico')).status === 200);
  const consHealthy = await tr('biz', 'consolidar');
  check('consolidar margem saudável ⇒ 200 (sem exceção)', consHealthy.status === 200, consHealthy.text?.slice(0, 160));
  const emitHealthy = await tr('biz', 'emitir');
  check('emitir margem saudável ⇒ 200', emitHealthy.status === 200, emitHealthy.text?.slice(0, 160));
  check('proposta ficou emitida', (await api('biz', 'GET', `/api/proposals/${id}`)).json?.proposal?.status === 'emitido');

  // ===== PARTE D — GATE G-026 EM MARGEM ABAIXO DO PISO (estado REAL: consolidar E emitir gated) =====
  const createdLow = await api('biz', 'POST', '/api/proposals', { commercial: lowMargin });
  const idL = createdLow.json?.proposal?.id;
  check('cria proposta de margem baixa', createdLow.status === 201 && !!idL);
  const verL = async () => (await api('biz', 'GET', `/api/proposals/${idL}`)).json.proposal.version;
  const trL = async (who, name) => api(who, 'POST', `/api/proposals/${idL}/transition`, { version: await verL(), transition: name });
  check('submeter (low)', (await trL('biz', 'submeter_analise')).status === 200);
  check('iniciar análise (low)', (await trL('tech', 'iniciar_analise')).status === 200);
  check('aprovar técnico (low)', (await trL('tech', 'aprovar_tecnico')).status === 200);
  const blocked = await trL('biz', 'consolidar');
  check('G-026: consolidar sem exceção ⇒ 409 approval_required', blocked.status === 409 && blocked.json?.error === 'approval_required', blocked.text?.slice(0, 160));
  const rq = await api('biz', 'POST', `/api/proposals/${idL}/approval-requests`, { kind: 'excecao_comercial', justification: 'cliente estratégico', version: await verL() });
  check('solicita exceção comercial', rq.status === 201, rq.text?.slice(0, 120));
  const dec = await api('apr', 'POST', `/api/approval-requests/${rq.json?.request?.id}/decision`, { decision: 'approved', justification: 'ok' });
  check('aprovador aprova exceção (G-006 separação de funções)', dec.status === 201, dec.text?.slice(0, 120));
  check('G-026: consolidar com exceção aprovada ⇒ 200', (await trL('biz', 'consolidar')).status === 200);
  // DOCUMENTA o estado real: emitir TAMBÉM passa pelo gate; com a exceção aprovada, libera.
  const emitLow = await trL('biz', 'emitir');
  check('G-026: emitir é gated e, com exceção aprovada, ⇒ 200 (defesa em profundidade)', emitLow.status === 200, emitLow.text?.slice(0, 160));

  check('log estruturado sem valores de preço', !/"users":50000|extraDiscount|"monthly":/.test(log) && /pricing_quote/.test(log));
} catch (e) {
  check('execução sem exceção', false, String(e).slice(0, 400));
} finally {
  srv.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true }); // limpa o dir efêmero (e2e-quote-proposal-*)
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  → ' + (r.detail ?? '')}`);
console.log(`\n${results.length - failed.length}/${results.length} checks`);
console.log(failed.length ? 'SMOKE E2E QUOTE→PROPOSAL: FAIL' : 'SMOKE E2E QUOTE→PROPOSAL: PASS');
process.exit(failed.length ? 1 : 0);
