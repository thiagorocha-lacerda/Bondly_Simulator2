// Smoke e2e da cotação no servidor (G-001-A F1/F2) contra o auth-proxy REAL buildado + SQLite, em modo PRODUÇÃO.
// Prova: projeção por perfil no fio, cabeçalhos, RBAC, rate/limites, e o bloqueio de emissão por política (409 approval_required).
// Uso: npm run build --workspace @bondly/pricing-engine && npm run build --workspace @bondly/auth-proxy && node scripts/smoke-quote.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createSessionToken } from '../apps/auth-proxy/dist/session.js';

const ROOT = process.cwd();
const SEC = randomBytes(48).toString('base64url');
const PORT = 8794;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'bondly-quote-smoke-'));
const staticDir = join(dataDir, 'static');
mkdirSync(staticDir);
writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>smoke</title>');

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

const input = {
  volume: { users: 50000, mauPct: 0.4, stickiness: 0.15, transactionsPerMau: 1 },
  invoices: { enabled: true, participantPct: 0.1, notesPerParticipant: 1 },
  communication: { perMau: 1, strategy: 'fallback', fallbackRate: 0.4, customMix: { sms: 0, email: 0, rcs: 1, wa: 0.4 } },
  complexity: { integrations: 1, modules: 2, slaPoints: 0, customizationPoints: 0, aiPoints: 0, migrationPoints: 0, implementationHours: 0 },
  negotiation: { option: 'recommended', extraDiscount: 0, term: 12, viaMinu: true, expansion: false, strategic: false, tierDiscount: 0 },
  services: { profiles: [], tablePrice: 35000, minMargin: 5000, compCap: 25000, passthroughPct: 0, startMonth: 1, hourMinMargin: 50, productiveHoursPerMonth: 160 },
  campaign: { enabled: false, objectives: [], consentPct: 0, frequency: 1, months: 2, mix: { sms: 0, email: 0, rcs: 1, wa: 0.4 }, deliveryRate: { sms: 0.7, email: 0.7, rcs: 0.7, wa: 0.7 }, conversionRate: 0.35, activationRate: 0.15, operationHours: 0, markup: 0.2 },
};
const low = { ...input, negotiation: { ...input.negotiation, extraDiscount: 0.6, option: 'floor', term: 36 } };
const LEAK = /cogs|technicalMargin|netMargin|"costs"|"taxes"|tcvBondly|setupNet|premisesHash|contractContribution/;

try {
  let healthy = false;
  for (let i = 0; i < 60 && !healthy; i++) {
    try { healthy = (await fetch(`${BASE}/healthz`)).ok; } catch { /* aguardando */ }
    if (!healthy) await new Promise((r) => setTimeout(r, 150));
  }
  check('boot produção + /healthz=200', healthy, log.match(/"repo":"\w+"/)?.[0]);
  if (!healthy) throw new Error('server não subiu\n' + log);

  for (const [who, role] of [['biz', 'business'], ['tech', 'tech'], ['apr', 'approver']]) {
    const r = await api('adm', 'PUT', '/api/admin/assignments', { email: E[who], role });
    check(`admin atribui ${role}`, r.status === 200, r.status);
  }

  const noSess = await fetch(`${BASE}/api/pricing/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: '{}' });
  check('quote sem sessão ⇒ 401', noSess.status === 401);

  const biz = await api('biz', 'POST', '/api/pricing/quote', { input: low });
  check('business ⇒ 200 view commercial', biz.status === 200 && biz.json?.quote?.view === 'commercial', biz.status);
  check('business: nenhum custo/margem no corpo (fio)', !LEAK.test(biz.text));
  check('business: sinal de política sem valores', biz.json?.quote?.policy?.marginAlert?.requiresApproval === true && Object.keys(biz.json.quote.policy.marginAlert).length === 2);
  check('Cache-Control no-store + nosniff + JSON', /no-store/.test(biz.headers.get('cache-control') ?? '') && biz.headers.get('x-content-type-options') === 'nosniff' && /application\/json/.test(biz.headers.get('content-type') ?? ''));
  const apr = await api('apr', 'POST', '/api/pricing/quote', { input });
  check('approver ⇒ commercial sem custo/margem', apr.json?.quote?.view === 'commercial' && !LEAK.test(apr.text));
  const bizInternal = await api('biz', 'POST', '/api/pricing/quote', { view: 'internal', input });
  check('business pedindo internal ⇒ 403', bizInternal.status === 403 && !LEAK.test(bizInternal.text));
  const tech = await api('tech', 'POST', '/api/pricing/quote', { input });
  check('tech ⇒ internal com breakdown', tech.json?.quote?.view === 'internal' && tech.json.quote.result?.costs?.total > 0);
  const badNum = await fetch(`${BASE}/api/pricing/quote`, { method: 'POST', headers: hdr(E.biz), body: '{"input":{"volume":{"users":-1}}}' });
  check('input inválido ⇒ 400', badNum.status === 400);
  const wrongCt = await fetch(`${BASE}/api/pricing/quote`, { method: 'POST', headers: { ...hdr(E.biz), 'Content-Type': 'text/plain' }, body: '{}' });
  check('Content-Type não JSON ⇒ 415', wrongCt.status === 415, wrongCt.status);
  const big = await fetch(`${BASE}/api/pricing/quote`, { method: 'POST', headers: hdr(E.biz), body: JSON.stringify({ input, pad: 'x'.repeat(300 * 1024) }) });
  check('corpo > 256 KB ⇒ 413', big.status === 413, big.status);
  const cat = await api('biz', 'GET', '/api/pricing/catalog');
  check('catálogo público 200 sem custo', cat.status === 200 && !/cogs|cost|margin|platformFee|setup/i.test(cat.text));

  // G-026: bloqueio de emissão no servidor real
  const created = await api('biz', 'POST', '/api/proposals', { commercial: low });
  const id = created.json?.proposal?.id;
  check('proposta criada com inputs persistidos', created.status === 201 && !!id);
  const ver = async () => (await api('biz', 'GET', `/api/proposals/${id}`)).json.proposal.version;
  const tr = async (who, name) => api(who, 'POST', `/api/proposals/${id}/transition`, { version: await ver(), transition: name });
  check('submeter', (await tr('biz', 'submeter_analise')).status === 200);
  check('iniciar análise', (await tr('tech', 'iniciar_analise')).status === 200);
  check('aprovar técnico', (await tr('tech', 'aprovar_tecnico')).status === 200);
  const blocked = await tr('biz', 'consolidar');
  check('consolidar sem exceção ⇒ 409 approval_required', blocked.status === 409 && blocked.json?.error === 'approval_required', blocked.text);
  const rq = await api('biz', 'POST', `/api/proposals/${id}/approval-requests`, { kind: 'excecao_comercial', justification: 'cliente estratégico', version: await ver() });
  check('solicitar exceção', rq.status === 201);
  const dec = await api('apr', 'POST', `/api/approval-requests/${rq.json?.request?.id}/decision`, { decision: 'approved', justification: 'ok' });
  check('aprovador aprova', dec.status === 201);
  check('consolidar com exceção aprovada ⇒ 200', (await tr('biz', 'consolidar')).status === 200);
  check('emitir ⇒ 200', (await tr('biz', 'emitir')).status === 200);
  check('log sem valores de preço', !/"users":50000|extraDiscount|monthly/.test(log) && /pricing_quote/.test(log));
} catch (e) {
  check('execução sem exceção', false, String(e).slice(0, 400));
} finally {
  srv.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  → ' + (r.detail ?? '')}`);
console.log(`\n${results.length - failed.length}/${results.length} checks`);
process.exit(failed.length ? 1 : 0);
