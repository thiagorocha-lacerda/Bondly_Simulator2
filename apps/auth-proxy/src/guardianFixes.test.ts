/** Regressões das correções dos Findings do Guardian (docs/14): G-004/5/6/7/8/9/10/001-parcial. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryRepository } from './memoryRepository.js';
import { createSqliteRepository } from './sqliteRepository.js';
import { handleApi } from './api.js';
import { loadConfig, type ServerConfig } from './config.js';
import { normalizeAssignableEmail, parseBootstrapAdminEmails } from './assignments.js';
import { checkCrossSite, checkJsonContentType, mayServeSpaBundle, isSourceMapPath, PROTECTED_ASSET_CACHE_CONTROL, PROTECTED_ASSET_VARY } from './httpGuards.js';
import { checkText, checkTextList, MAX_TEXT_CHARS, MAX_PAUSE_REASON_CHARS, PAUSE_REASON_CODES } from './limits.js';
import { ROLES, type Role } from './rbac.js';
import type { SessionData } from './session.js';
import type { ProposalRepository } from './domain.js';
import { emailRef, setLogPseudonymKey } from './securityLog.js';
import { resolveStaticPath } from './static-path.js';

const cfg = { legacyProfileCodes: false, profileCodeHashes: {} } as unknown as ServerConfig;
const cfgLegacy = { legacyProfileCodes: true, profileCodeHashes: {} } as unknown as ServerConfig;
const EMAIL: Record<Role, string> = { business: 'biz@minu.co', tech: 'tec@minu.co', approver: 'apr@minu.co', admin: 'adm@minu.co' };
const sess = (email: string, role?: Role): SessionData => ({
  email,
  domain: email.slice(email.lastIndexOf('@') + 1),
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...(role ? { role } : {}),
});
async function seeded(): Promise<{ repo: ProposalRepository; id: string }> {
  const repo = createMemoryRepository();
  for (const r of ROLES) await repo.setAssignment(EMAIL[r], r, 'seed');
  const id = `BONDLY-2027-${String(await repo.nextSequence()).padStart(6, '0')}`;
  await repo.create({ id, ownerEmail: EMAIL.business, commercial: {} }, { actorEmail: EMAIL.business, role: 'business', action: 'proposal.create' });
  await repo.update(id, 1, { status: 'aguardando_analise_tecnica' }, { actorEmail: EMAIL.business, role: 'business', action: 'test.submit' }); // G-002: tech/approver só leem fora do rascunho
  return { repo, id };
}
const call = (repo: ProposalRepository, who: Role, method: string, path: string, body: unknown = null, c = cfg) =>
  handleApi({ method, path, session: sess(EMAIL[who]), body, repo, cfg: c });

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('G-004 — reuniões só para quem vê interno', () => {
  it('tech/admin 200 com objetivo; business/approver 403 sem objetivo/log', async () => {
    const { repo, id } = await seeded();
    const created = await call(repo, 'tech', 'POST', `/api/proposals/${id}/meetings`, { objective: 'conf tech: custo real 40%' });
    expect(created.status).toBe(201);
    for (const r of ['tech', 'admin'] as const) {
      const res = await call(repo, r, 'GET', `/api/proposals/${id}/meetings`);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).toContain('custo real 40%');
    }
    for (const r of ['business', 'approver'] as const) {
      const res = await call(repo, r, 'GET', `/api/proposals/${id}/meetings`);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('custo real');
    }
  });
});

describe('G-005 — limites de texto e catálogo de motivos', () => {
  async function running() {
    const s = await seeded();
    await s.repo.appendSlaEvent({ proposalId: s.id, kind: 'started', at: Date.now() - 1000, by: EMAIL.tech, payload: {} });
    return s;
  }
  it('checkText/checkTextList: limites centrais', () => {
    expect(checkText('a'.repeat(MAX_TEXT_CHARS), 'f').ok).toBe(true);
    expect(checkText('a'.repeat(MAX_TEXT_CHARS + 1), 'f')).toMatchObject({ ok: false, error: 'text_too_long' });
    expect(checkText(123, 'f')).toMatchObject({ ok: false, error: 'invalid_text' });
    expect(checkTextList(new Array(21).fill('x'), 'l')).toMatchObject({ ok: false, error: 'too_many_items' });
    expect(checkTextList(['x'.repeat(201)], 'l')).toMatchObject({ ok: false, error: 'text_too_long' });
  });
  it('pausa com reason de 200 KB → 400 e NADA é gravado; indicadores continuam pequenos para o approver', async () => {
    const { repo, id } = await running();
    const r = await call(repo, 'tech', 'POST', `/api/proposals/${id}/sla/pause`, { reason: 'x'.repeat(200 * 1024) });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: 'text_too_long', field: 'reason' });
    expect(await repo.slaEvents(id)).toHaveLength(1);
    const ind = await call(repo, 'approver', 'GET', '/api/sla/indicators');
    expect(JSON.stringify(ind.body).length).toBeLessThan(2000);
  });
  it('reason no limite (200) ok; 201 rejeitado; missingItems excessivo rejeitado; reasonCode inválido rejeitado', async () => {
    const { repo, id } = await running();
    const bad = await call(repo, 'tech', 'POST', `/api/proposals/${id}/sla/pause`, { reason: 'x'.repeat(MAX_PAUSE_REASON_CHARS + 1) });
    expect(bad.status).toBe(400);
    const badCode = await call(repo, 'tech', 'POST', `/api/proposals/${id}/sla/pause`, { reason: 'r', reasonCode: 'qualquer coisa' });
    expect(badCode.body).toMatchObject({ error: 'invalid_reason_code' });
    const many = await call(repo, 'tech', 'POST', `/api/proposals/${id}/sla/pause`, { reason: 'r', missingItems: new Array(50).fill('i') });
    expect(many.body).toMatchObject({ error: 'too_many_items' });
    const ok = await call(repo, 'tech', 'POST', `/api/proposals/${id}/sla/pause`, { reason: 'x'.repeat(MAX_PAUSE_REASON_CHARS), reasonCode: 'aguardando_cliente' });
    expect(ok.status).toBe(200);
  });
  it('indicadores agregam SOMENTE pelo catálogo; texto livre não aparece ao approver (nem no /sla)', async () => {
    const { repo, id } = await seeded();
    const T = Date.parse('2027-03-15T12:00:00-03:00');
    const ev = (kind: 'started' | 'paused' | 'resumed' | 'completed', at: string, payload: Record<string, unknown> = {}) =>
      repo.appendSlaEvent({ proposalId: id, kind, at: Date.parse(`${at}:00-03:00`), by: EMAIL.tech, payload });
    expect(T).toBeGreaterThan(0);
    await ev('started', '2027-03-15T12:00');
    await ev('paused', '2027-03-17T12:00', { reason: 'SEGREDO tecnico: custo 40%', reasonCode: 'escopo_indefinido' });
    await ev('resumed', '2027-03-19T12:00');
    await ev('completed', '2027-03-22T12:00', { verdict: 'aprovado' });
    const ind = await call(repo, 'approver', 'GET', '/api/sla/indicators');
    const txt = JSON.stringify(ind.body);
    expect(txt).not.toContain('SEGREDO');
    expect((ind.body as { indicators: { pausesByReason: { reason: string }[] } }).indicators.pausesByReason[0]!.reason).toBe('Escopo indefinido');
    const slaApprover = await call(repo, 'approver', 'GET', `/api/proposals/${id}/sla`);
    expect(JSON.stringify(slaApprover.body)).not.toContain('SEGREDO');
    const slaTech = await call(repo, 'tech', 'GET', `/api/proposals/${id}/sla`);
    expect(slaTech.status).toBe(200);
    expect(PAUSE_REASON_CODES).toContain('outro');
  });
  it('approval.note, meeting.objective, meeting note e transition note respeitam o limite', async () => {
    const { repo, id } = await seeded();
    const big = 'n'.repeat(MAX_TEXT_CHARS + 1);
    expect((await call(repo, 'approver', 'POST', `/api/proposals/${id}/approval`, { decision: 'approved', kind: 'excecao_comercial', note: big })).body).toMatchObject({ error: 'text_too_long' });
    expect((await call(repo, 'tech', 'POST', `/api/proposals/${id}/meetings`, { objective: big })).body).toMatchObject({ error: 'text_too_long' });
    const draftId = 'BONDLY-2027-000099'; // rascunho próprio de business (a proposta `seeded` já saiu do rascunho)
    await repo.create({ id: draftId, ownerEmail: EMAIL.business, commercial: {} }, { actorEmail: EMAIL.business, role: 'business', action: 'proposal.create' });
    expect((await call(repo, 'business', 'POST', `/api/proposals/${draftId}/transition`, { version: 1, transition: 'submeter_analise', note: big })).body).toMatchObject({ error: 'text_too_long' });
  });
});

describe('G-006 (parte segura) — idempotência/conflito de decisão', () => {
  it('mesmo resultado repetido = 200 idempotente (1 só registro); resultado diferente = 409; outro kind independente', async () => {
    const { repo, id } = await seeded();
    const post = (decision: string, kind = 'excecao_comercial') =>
      call(repo, 'approver', 'POST', `/api/proposals/${id}/approval`, { decision, kind, note: 'ok' });
    expect((await post('approved')).status).toBe(201);
    const again = await post('approved');
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ idempotent: true });
    const conflict = await post('rejected');
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ error: 'decision_conflict', existing: 'approved' });
    expect((await post('rejected', 'replanejamento')).status).toBe(201);
    const audits = (await repo.audit(id)).filter((e) => e.action.startsWith('approval.'));
    expect(audits).toHaveLength(2);
  });
});

describe('G-008 — legado em produção e permissions coerentes', () => {
  const base = { NODE_ENV: 'production', PUBLIC_URL: 'https://x.example', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', SESSION_SECRET: 'k9Xv2mQpL7wZr4TnB8yHd3FsGj6UaCe1' };
  it('LEGACY_PROFILE_CODES=true em produção sem ack → recusado', () => {
    const c = loadConfig({ ...base, LEGACY_PROFILE_CODES: 'true' });
    expect(c.legacyProfileCodes).toBe(false);
    expect(c.legacyProfileCodesRefused).toBe(true);
  });
  it('com ack explícito → habilitado e marcado inseguro', () => {
    const c = loadConfig({ ...base, LEGACY_PROFILE_CODES: 'true', LEGACY_PROFILE_CODES_ACK_INSECURE: 'true' });
    expect(c.legacyProfileCodes).toBe(true);
    expect(c.legacyProfileCodesAckInsecure).toBe(true);
  });
  it('fora de produção a flag segue funcionando; ack sozinho não liga nada', () => {
    expect(loadConfig({ NODE_ENV: 'development', LEGACY_PROFILE_CODES: 'true' }).legacyProfileCodes).toBe(true);
    expect(loadConfig({ ...base, LEGACY_PROFILE_CODES_ACK_INSECURE: 'true' }).legacyProfileCodes).toBe(false);
  });
  it('admin legado: /api/me NÃO lista admin.manage_users; admin atribuído lista', async () => {
    const repo = createMemoryRepository();
    const legacy = await handleApi({ method: 'GET', path: '/api/me', session: sess('leg@minu.co', 'admin'), body: null, repo, cfg: cfgLegacy });
    const perms = (legacy.body as { permissions: string[]; roleSource: string }).permissions;
    expect((legacy.body as { roleSource: string }).roleSource).toBe('legacy');
    expect(perms).not.toContain('admin.manage_users');
    expect(perms).toContain('sla.manage');
    await repo.setAssignment('adm@minu.co', 'admin', 'seed');
    const real = await handleApi({ method: 'GET', path: '/api/me', session: sess('adm@minu.co'), body: null, repo, cfg });
    expect((real.body as { permissions: string[] }).permissions).toContain('admin.manage_users');
  });
});

describe('G-009 — guardas HTTP', () => {
  const pub = 'https://app.example.com';
  it('cross-site em métodos mutantes é rejeitado; same-origin/none/sem Origin passam; GET sempre passa', () => {
    const m = (headers: Record<string, string>, method = 'PUT') => checkCrossSite({ method, headers, publicUrl: pub });
    expect(m({ 'sec-fetch-site': 'cross-site' })).toMatchObject({ ok: false, status: 403 });
    expect(m({ 'sec-fetch-site': 'same-site' })).toMatchObject({ ok: false });
    expect(m({ 'sec-fetch-site': 'same-origin' }).ok).toBe(true);
    expect(m({ 'sec-fetch-site': 'none' }).ok).toBe(true);
    expect(m({ origin: 'https://evil.example.com' }).ok).toBe(false);
    expect(m({ origin: 'https://app.example.com.evil.com' }).ok).toBe(false);
    expect(m({ origin: pub }).ok).toBe(true);
    expect(m({}).ok).toBe(true); // ferramenta não-browser (documentado)
    expect(m({ 'sec-fetch-site': 'cross-site' }, 'GET').ok).toBe(true);
    expect(m({ 'sec-fetch-site': 'cross-site' }, 'DELETE').ok).toBe(false);
  });
  it('Content-Type application/json obrigatório quando há corpo', () => {
    const c = (headers: Record<string, string>, method = 'POST') => checkJsonContentType({ method, headers });
    expect(c({ 'content-length': '10', 'content-type': 'text/plain' })).toMatchObject({ ok: false, status: 415 });
    expect(c({ 'content-length': '10' })).toMatchObject({ ok: false, status: 415 });
    expect(c({ 'content-length': '10', 'content-type': 'application/json; charset=utf-8' }).ok).toBe(true);
    expect(c({}).ok).toBe(true);
    expect(c({ 'content-length': '10', 'content-type': 'text/plain' }, 'GET').ok).toBe(true);
  });
});

describe('G-010 — e-mail atribuível estrito', () => {
  it('rejeita +alias, múltiplos @, homóglifos, full-width, símbolos; aceita ASCII normal', () => {
    for (const bad of ['bob+x@minu.co', 'a@b@minu.co', '<script>@minu.co', 'b\u043eb@minu.co', '\uff41@minu.co', 'a..b@minu.co', '.a@minu.co', 'a.@minu.co', "o'x@minu.co", `${'a'.repeat(65)}@minu.co`]) {
      expect(normalizeAssignableEmail(bad), bad).toBeNull();
    }
    for (const good of ['bob@minu.co', ' Ana.Silva@MINU.CO ', 'a_b-c@minutrade.com', 'x@grupoarka.co']) {
      expect(normalizeAssignableEmail(good), good).not.toBeNull();
    }
    expect(normalizeAssignableEmail('x@evil.com')).toBeNull();
  });
  it('PUT /api/admin/assignments → 400 email_not_allowed para alias/homóglifo', async () => {
    const { repo } = await seeded();
    for (const email of ['bob+x@minu.co', 'b\u043eb@minu.co', '\uff41@minu.co']) {
      const r = await call(repo, 'admin', 'PUT', '/api/admin/assignments', { email, role: 'tech' });
      expect(r.status, email).toBe(400);
      expect(r.body).toEqual({ error: 'email_not_allowed' });
    }
    expect((await call(repo, 'admin', 'PUT', '/api/admin/assignments', { email: 'ok.user@minu.co', role: 'tech' })).status).toBe(200);
  });
  it('bootstrap também usa a regra estrita', () => {
    const r = parseBootstrapAdminEmails('ceo@minu.co, ceo+x@minu.co');
    expect(r.valid).toEqual(['ceo@minu.co']);
    expect(r.rejected).toHaveLength(1);
  });
});

describe('G-007 — auditoria append-only (triggers) e logs sem e-mail em claro', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bondly-g7-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('UPDATE e DELETE direto em assignment_audit abortam; INSERT via setAssignment segue funcionando', async () => {
    const repo = await createSqliteRepository(dir);
    await repo.setAssignment('a@minu.co', 'admin', 'seed');
    const require = createRequire(import.meta.url) as (id: string) => unknown;
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => { exec(s: string): void } };
    const raw = new DatabaseSync(join(dir, 'bondly.db'));
    expect(() => raw.exec(`UPDATE assignment_audit SET to_role = 'tech'`)).toThrow(/append-only/);
    expect(() => raw.exec(`DELETE FROM assignment_audit`)).toThrow(/append-only/);
    await repo.setAssignment('b@minu.co', 'tech', 'a@minu.co');
    expect(await repo.assignmentAudit()).toHaveLength(2);
    // migração aditiva idempotente: reabrir não falha
    await expect(createSqliteRepository(dir)).resolves.toBeTruthy();
  });
  it('rbac_change e rbac_denied são logados SEM e-mail em claro', async () => {
    const { repo } = await seeded();
    const info = vi.spyOn(console, 'info');
    const warn = vi.spyOn(console, 'warn');
    await call(repo, 'admin', 'PUT', '/api/admin/assignments', { email: 'novo.user@minu.co', role: 'business' });
    await call(repo, 'business', 'PUT', '/api/admin/assignments', { email: 'x@minu.co', role: 'admin' });
    const lines = [...info.mock.calls, ...warn.mock.calls].map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('"evt":"rbac_change"'))).toBe(true);
    expect(lines.some((l) => l.includes('"evt":"rbac_denied"'))).toBe(true);
    expect(lines.join('\n')).not.toMatch(/@minu\.co/);
  });
});

describe('G-001 (parcial) — bundle só com perfil; sem sourcemaps', () => {
  it('mayServeSpaBundle: sem perfil ⇒ não (exceto fluxo legado ligado)', () => {
    expect(mayServeSpaBundle(true, false)).toBe(true);
    expect(mayServeSpaBundle(false, false)).toBe(false);
    expect(mayServeSpaBundle(false, true)).toBe(true);
  });
  it('.map nunca é servido', () => {
    expect(isSourceMapPath('/assets/index-abc.js.map')).toBe(true);
    expect(isSourceMapPath('/assets/index-abc.js')).toBe(false);
  });
});

describe('G-015 — .map negado após decode/normalização', () => {
  it.each([
    '/assets/a.js%2Emap', '/assets/a.js%2emap', '/assets/a.js%252Emap', '/assets/a.js%25252Emap',
    '/assets/a.js.map/', '/assets/a.js.map%00', '/assets/a.js.MAP', '/assets/x/../a.js.map', '/assets/a.js.map?v=1', '/assets/a.js.map%2F',
    '/assets/a.js%', '/assets/a.js%252525252Emap',
  ])('nega %s', (p) => expect(isSourceMapPath(p)).toBe(true));
  it('não bloqueia arquivos legítimos', () => {
    expect(isSourceMapPath('/assets/index-abc.js')).toBe(false);
    expect(isSourceMapPath('/assets/mapa.png')).toBe(false);
    expect(isSourceMapPath('/')).toBe(false);
  });
  it('coerente com resolveStaticPath: o que resolve para *.map é negado', () => {
    const r = resolveStaticPath('/srv/dist', '/assets/a.js%2Emap');
    expect(r.ok && r.filePath.endsWith('.map')).toBe(true);
    expect(isSourceMapPath('/assets/a.js%2Emap')).toBe(true);
  });
});

describe('G-016 — assets atrás do gate: nunca public/immutable', () => {
  it('constantes de cache são private/no-store e Vary: Cookie', () => {
    expect(PROTECTED_ASSET_CACHE_CONTROL).toBe('private, no-store');
    expect(PROTECTED_ASSET_CACHE_CONTROL).not.toMatch(/public|immutable|s-maxage/);
    expect(PROTECTED_ASSET_VARY).toBe('Cookie');
  });
});

describe('G-014 — pseudônimo de e-mail por HMAC com chave de SESSION_SECRET', () => {
  it('determinístico por chave, difere entre chaves e não bate com sha256 puro (dicionário)', async () => {
    const { createHash } = await import('node:crypto');
    setLogPseudonymKey('segredo-A');
    const a = emailRef('Ana.Silva@minu.co');
    expect(emailRef(' ana.silva@minu.co ')).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(createHash('sha256').update('ana.silva@minu.co').digest('hex').slice(0, a.length));
    expect(a).not.toBe('faa1863eaa4a'); // valor do dicionário sem chave citado em G-014
    setLogPseudonymKey('segredo-B');
    expect(emailRef('ana.silva@minu.co')).not.toBe(a);
  });
});

describe('G-018 — decisão do approver atômica', () => {
  const body = (decision: string) => ({ decision, kind: 'excecao_comercial', note: 'ok' });
  it('duas requisições paralelas divergentes ⇒ 201 + 409, 1 só auditoria (memória)', async () => {
    const { repo, id } = await seeded();
    const p = `/api/proposals/${id}/approval`;
    const [a, b] = await Promise.all([call(repo, 'approver', 'POST', p, body('approved')), call(repo, 'approver', 'POST', p, body('rejected'))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await repo.audit(id)).filter((e) => e.action.startsWith('approval.'))).toHaveLength(1);
  });
  it('paralelas iguais ⇒ 201 + 200 idempotente', async () => {
    const { repo, id } = await seeded();
    const p = `/api/proposals/${id}/approval`;
    const [a, b] = await Promise.all([call(repo, 'approver', 'POST', p, body('approved')), call(repo, 'approver', 'POST', p, body('approved'))]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
  });
  it('SQLite: constraint UNIQUE garante vencedor único e lê o resultado vencedor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bondly-g018-'));
    try {
      const repo = await createSqliteRepository(dir);
      await repo.create({ id: 'BONDLY-2027-000001', ownerEmail: EMAIL.business, commercial: {} }, { actorEmail: EMAIL.business, role: 'business', action: 'proposal.create' });
      const e = { actorEmail: EMAIL.approver, role: 'approver' as const, note: 'n' };
      const [x, y] = await Promise.all([
        repo.recordApprovalDecision('BONDLY-2027-000001', 'replanejamento', 'approved', e),
        repo.recordApprovalDecision('BONDLY-2027-000001', 'replanejamento', 'rejected', e),
      ]);
      expect([x.created, y.created].sort()).toEqual([false, true]);
      expect(x.decision).toBe(y.decision); // ambos enxergam o vencedor
      expect((await repo.audit('BONDLY-2027-000001')).filter((a) => a.action.startsWith('approval.'))).toHaveLength(1);
      await expect(repo.recordApprovalDecision('NOPE', 'replanejamento', 'approved', e)).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('G-017 — catálogo do frontend em sincronia com o servidor', () => {
  it('pauseReasons.ts do workspace contém exatamente os códigos/rótulos de PAUSE_REASON_LABELS', async () => {
    const { readFileSync } = await import('node:fs');
    const { PAUSE_REASON_LABELS } = await import('./limits.js');
    const src = readFileSync(new URL('../../commercial-workspace/src/hooks/pauseReasons.ts', import.meta.url), 'utf8');
    const found = [...src.matchAll(/code: '([a-z_]+)', label: '([^']+)'/g)].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(found)).toEqual(PAUSE_REASON_LABELS);
  });
});
