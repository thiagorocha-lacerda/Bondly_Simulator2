// Smoke e2e do SLA técnico (§6) contra o servidor REAL (auth-proxy buildado + SQLite).
// Modelo RBAC pós-G-008: o servidor DERIVA o papel de `role_assignments` (ignora `role` do cookie fora do
// fluxo legado). Por isso: bootstrap do 1º admin via BOOTSTRAP_ADMIN_EMAILS, admin atribui business/tech via
// PUT /api/admin/assignments, e só então exercita submeter→sla→pause→resume→reunião→complete + RBAC.
// Uso: npm run build --workspace @bondly/pricing-engine && npm run build --workspace @bondly/auth-proxy && node scripts/smoke-sla.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createSessionToken } from '../apps/auth-proxy/dist/session.js';

const ROOT = process.cwd();
const SEC = randomBytes(32).toString('hex'); // G-032: 64 hex = 256 bits (forte; sem sequência/dicionário)
const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;
// Dir efêmero sob KIROCREW_SCRATCH (reclamado pela sessão); cai em cwd se a env não existir.
const scratch = process.env.KIROCREW_SCRATCH || ROOT;
const dataDir = mkdtempSync(join(scratch, 'sla-e2e-'));

// G-010: e-mails ASCII válidos, parte local sem caracteres especiais, domínio autorizado (minu.co).
const E = { adm: 'admin@minu.co', tech: 'tech@minu.co', biz: 'biz@minu.co' };

const srv = spawn(process.execPath, ['apps/auth-proxy/dist/server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    SESSION_SECRET: SEC,
    PORT: String(PORT),
    STATIC_DIR: join(dataDir, 'static'),
    PUBLIC_URL: BASE,
    GOOGLE_CLIENT_ID: 'dummy.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'dummy-secret',
    BOOTSTRAP_ADMIN_EMAILS: E.adm, // cria o 1º admin no boot (perfil derivado no servidor)
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
srv.stdout.on('data', (d) => (bootLog += d));
srv.stderr.on('data', (d) => (bootLog += d));

// Cookie SEM `role`: o servidor deriva o papel de role_assignments. Embutir role seria o modelo antigo.
const hdr = (email) => ({
  Cookie: 'bondly_sess=' + createSessionToken({ email, domain: 'minu.co' }, SEC),
  'Content-Type': 'application/json',
  Accept: 'application/json',
});
const api = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: hdr(E[who]), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corpo vazio */ }
  return { status: r.status, json, text };
};
const results = [];
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail });

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

try {
  const healthy = await waitHealth();
  check('server sobe e /healthz=200', healthy);
  check('boot usa SQLite', /"repo":"sqlite"/.test(bootLog), bootLog.match(/"repo":"\w+"/)?.[0]);
  if (!healthy) throw new Error('server não respondeu /healthz\n' + bootLog);

  // --- atribuição de perfis pelo admin (modelo RBAC atual) ---
  const asgTech = await api('adm', 'PUT', '/api/admin/assignments', { email: E.tech, role: 'tech' });
  check('admin atribui role tech', asgTech.status === 200, asgTech.status);
  const asgBiz = await api('adm', 'PUT', '/api/admin/assignments', { email: E.biz, role: 'business' });
  check('admin atribui role business', asgBiz.status === 200, asgBiz.status);

  // --- business (dono) cria e submete a proposta; só então o tech enxerga o histórico (G-002/G-021) ---
  const created = await api('biz', 'POST', '/api/proposals', { commercial: { users: 1000 } });
  const id = created.json?.proposal?.id;
  check('cria proposta (business)', created.status === 201 && !!id, id ?? `status=${created.status} body=${created.text}`);
  if (!id) throw new Error('criação falhou: status=' + created.status + ' body=' + created.text);

  // versão real antes da transição (lock otimista — não assumir 1)
  const ver = async () => (await api('biz', 'GET', `/api/proposals/${id}`)).json?.proposal?.version;
  const sub = await api('biz', 'POST', `/api/proposals/${id}/transition`, { version: await ver(), transition: 'submeter_analise' });
  check('submeter_analise (business, dono)', sub.status === 200, `status=${sub.status} body=${sub.text}`);

  // --- SLA técnico: pause/resume/complete não usam version (append-only de eventos) ---
  const s1 = (await api('tech', 'GET', `/api/proposals/${id}/sla`)).json?.sla;
  check('submeter_analise inicia SLA (em_andamento, 5 dias)', s1?.phase === 'em_andamento' && s1?.businessDaysRemaining === 5, `phase=${s1?.phase} rem=${s1?.businessDaysRemaining}`);

  const sp = (await api('tech', 'POST', `/api/proposals/${id}/sla/pause`, { reason: 'faltam specs ERP', reasonCode: 'aguardando_cliente' })).json?.sla;
  check('pause → pausado', sp?.phase === 'pausado', `phase=${sp?.phase}`);

  const sr = (await api('tech', 'POST', `/api/proposals/${id}/sla/resume`, {})).json?.sla;
  check('resume → em_andamento, saldo preservado (5)', sr?.phase === 'em_andamento' && sr?.businessDaysRemaining === 5, `phase=${sr?.phase} rem=${sr?.businessDaysRemaining}`);

  const mt = (await api('tech', 'POST', `/api/proposals/${id}/meetings`, { objective: 'esclarecer ERP' })).json;
  check('solicita reunião (solicitada, slaUnaffected)', mt?.meeting?.state === 'solicitada' && mt?.slaUnaffected === true, `state=${mt?.meeting?.state} unaffected=${mt?.slaUnaffected}`);

  const s2 = (await api('tech', 'GET', `/api/proposals/${id}/sla`)).json?.sla;
  check('§6.4 reunião NÃO pausou o SLA (segue em_andamento)', s2?.phase === 'em_andamento', `phase=${s2?.phase}`);

  const sc = (await api('tech', 'POST', `/api/proposals/${id}/sla/complete`, { verdict: 'aprovado' })).json?.sla;
  check('complete → concluído, verdict, metSla', sc?.phase === 'concluido' && sc?.verdict === 'aprovado' && sc?.metSla === true, `phase=${sc?.phase} verdict=${sc?.verdict} metSla=${sc?.metSla}`);

  // RBAC: business não pode gerir o SLA (sla.manage) → 403
  const forbid = await api('biz', 'POST', `/api/proposals/${id}/sla/pause`, { reason: 'x', reasonCode: 'outro' });
  check('RBAC: business não pausa (403)', forbid.status === 403, `status=${forbid.status}`);
} catch (e) {
  check('execução sem exceção', false, String(e).slice(0, 400));
} finally {
  srv.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true }); // limpa o dir efêmero (sla-e2e-*)
}

let allOk = true;
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.ok) allOk = false;
}
console.log(allOk ? '\nSMOKE SLA: PASS' : '\nSMOKE SLA: FAIL');
process.exit(allOk ? 0 : 1);
