import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryRepository } from './memoryRepository.js';
import { createSqliteRepository } from './sqliteRepository.js';
import { handleApi } from './api.js';
import { scryptHasher } from './profileCodes.js';
import { loadConfig, type ServerConfig } from './config.js';
import { bootstrapAdmins, parseBootstrapAdminEmails, BOOTSTRAP_ACTOR, normalizeAuthorizedEmail } from './assignments.js';
import { ROLES, ACTIONS, can, type Role } from './rbac.js';
import type { SessionData } from './session.js';
import type { ProposalRepository } from './domain.js';

/** Config de produção-like: fluxo legado DESLIGADO (default). */
const cfg = { legacyProfileCodes: false, profileCodeHashes: { admin: scryptHasher.hash('adm') } } as unknown as ServerConfig;
const cfgLegacy = { legacyProfileCodes: true, profileCodeHashes: { admin: scryptHasher.hash('adm'), business: scryptHasher.hash('biz') } } as unknown as ServerConfig;

function sess(email: string, role?: Role): SessionData {
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return { email, domain, exp: Math.floor(Date.now() / 1000) + 3600, ...(role ? { role } : {}) };
}
const EMAIL: Record<Role, string> = { business: 'biz@minu.co', tech: 'tec@minu.co', approver: 'apr@minu.co', admin: 'adm@minu.co' };

async function repoWithAllRoles(): Promise<ProposalRepository> {
  const repo = createMemoryRepository();
  for (const r of ROLES) await repo.setAssignment(EMAIL[r], r, 'seed');
  return repo;
}
const call = (repo: ProposalRepository, s: SessionData | null, method: string, path: string, body: unknown = null, c = cfg) =>
  handleApi({ method, path, session: s, body, repo, cfg: c });

async function newProposal(repo: ProposalRepository): Promise<string> {
  const id = `BONDLY-2027-${String(await repo.nextSequence()).padStart(6, '0')}`;
  await repo.create({ id, ownerEmail: EMAIL.business, commercial: {} }, { actorEmail: EMAIL.business, role: 'business', action: 'proposal.create' });
  await repo.update(id, 1, { status: 'aguardando_analise_tecnica' }, { actorEmail: EMAIL.business, role: 'business', action: 'test.submit' }); // G-002: tech/approver só leem fora do rascunho
  return id;
}

describe('sem perfil atribuído → 403 nas APIs de negócio', () => {
  const protectedCalls: [string, string, unknown][] = [
    ['GET', '/api/proposals', null],
    ['POST', '/api/proposals', { commercial: {} }],
    ['GET', '/api/proposals/BONDLY-2027-000001', null],
    ['GET', '/api/proposals/BONDLY-2027-000001/audit', null],
    ['GET', '/api/proposals/BONDLY-2027-000001/sla', null],
    ['POST', '/api/proposals/BONDLY-2027-000001/approval', { decision: 'approved' }],
    ['GET', '/api/sla/indicators', null],
    ['GET', '/api/admin/assignments', null],
    ['PUT', '/api/admin/assignments', { email: 'x@minu.co', role: 'admin' }],
  ];
  for (const [m, p, b] of protectedCalls) {
    it(`${m} ${p} → 403 profile_required`, async () => {
      const repo = createMemoryRepository();
      const r = await call(repo, sess('novo@minu.co'), m, p, b);
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: 'profile_required' });
    });
  }
  it('/api/me responde 200 com role null (a UI mostra "aguardando atribuição")', async () => {
    const r = await call(createMemoryRepository(), sess('novo@minu.co'), 'GET', '/api/me');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ role: null, permissions: [] });
  });
  it('papel forjado/antigo no cookie é IGNORADO com a flag legada desligada', async () => {
    const repo = createMemoryRepository();
    for (const forged of ROLES) {
      const r = await call(repo, sess('novo@minu.co', forged), 'GET', '/api/proposals');
      expect(r.status).toBe(403);
    }
  });
  it('sem sessão → 401', async () => {
    expect((await call(createMemoryRepository(), null, 'GET', '/api/proposals')).status).toBe(401);
  });
});

describe('usuário de domínio não autorizado', () => {
  it('mesmo com atribuição no repositório, domínio fora da lista ⇒ sem perfil (defesa em profundidade)', async () => {
    const repo = createMemoryRepository();
    await repo.setAssignment('x@evil.com', 'admin', 'seed');
    expect((await call(repo, sess('x@evil.com'), 'GET', '/api/proposals')).status).toBe(403);
    expect((await call(repo, sess('x@minu.co.evil.com'), 'GET', '/api/admin/assignments')).status).toBe(403);
  });
  it('admin não consegue atribuir perfil a e-mail fora dos domínios autorizados (400)', async () => {
    const repo = await repoWithAllRoles();
    for (const bad of ['x@evil.com', 'x@minu.co.evil.com', 'x@sub.minu.co', 'x@minu.co.br', 'sem-arroba', '', 42]) {
      const r = await call(repo, sess(EMAIL.admin), 'PUT', '/api/admin/assignments', { email: bad, role: 'tech' });
      expect(r.status).toBe(400);
    }
  });
  it('normalizeAuthorizedEmail', () => {
    expect(normalizeAuthorizedEmail('  Ana@MINU.co ')).toBe('ana@minu.co');
    expect(normalizeAuthorizedEmail('a@minu.co.evil.com')).toBeNull();
  });
});

describe('gestão de atribuições: admin-only + auditoria append-only', () => {
  it('business/tech/approver recebem 403 (GET e PUT); admin acessa', async () => {
    const repo = await repoWithAllRoles();
    for (const r of ['business', 'tech', 'approver'] as const) {
      expect((await call(repo, sess(EMAIL[r]), 'GET', '/api/admin/assignments')).status).toBe(403);
      expect((await call(repo, sess(EMAIL[r]), 'PUT', '/api/admin/assignments', { email: 'n@minu.co', role: 'admin' })).status).toBe(403);
    }
    expect(await repo.getAssignment('n@minu.co')).toBeNull();
    expect((await call(repo, sess(EMAIL.admin), 'GET', '/api/admin/assignments')).status).toBe(200);
  });

  it('atribui, altera e revoga registrando quem/quando/de/para; revogação é imediata', async () => {
    const repo = await repoWithAllRoles();
    const put = (role: unknown) => call(repo, sess(EMAIL.admin), 'PUT', '/api/admin/assignments', { email: 'Nova@minu.co', role });
    expect((await put('business')).status).toBe(200);
    expect((await call(repo, sess('nova@minu.co'), 'GET', '/api/proposals')).status).toBe(200);
    expect((await put('approver')).status).toBe(200);
    expect((await call(repo, sess('nova@minu.co'), 'GET', '/api/me')).body).toMatchObject({ role: 'approver', roleLabel: 'Gestor/Aprovador', roleSource: 'assignment' });
    expect((await put(null)).status).toBe(200);
    // mesma sessão (cookie ainda válido) perde acesso no request seguinte
    expect((await call(repo, sess('nova@minu.co'), 'GET', '/api/proposals')).status).toBe(403);

    const audit = (await repo.assignmentAudit()).filter((a) => a.targetEmail === 'nova@minu.co');
    expect(audit.map((a) => [a.fromRole, a.toRole, a.actorEmail])).toEqual([
      [null, 'business', EMAIL.admin],
      ['business', 'approver', EMAIL.admin],
      ['approver', null, EMAIL.admin],
    ]);
    expect(audit.every((a) => typeof a.at === 'string' && a.at.length > 0)).toBe(true);
    const listed = await call(repo, sess(EMAIL.admin), 'GET', '/api/admin/assignments');
    expect((listed.body as { audit: unknown[] }).audit.length).toBeGreaterThanOrEqual(7); // 4 seeds + 3
  });

  it('role inválido → 400; não é possível remover/rebaixar o último admin (409)', async () => {
    const repo = await repoWithAllRoles();
    expect((await call(repo, sess(EMAIL.admin), 'PUT', '/api/admin/assignments', { email: 'n@minu.co', role: 'root' })).status).toBe(400);
    expect((await call(repo, sess(EMAIL.admin), 'PUT', '/api/admin/assignments', { email: EMAIL.admin, role: 'tech' })).status).toBe(409);
    expect((await call(repo, sess(EMAIL.admin), 'PUT', '/api/admin/assignments', { email: EMAIL.admin, role: null })).status).toBe(409);
    expect((await repo.getAssignment(EMAIL.admin))?.role).toBe('admin');
  });
});

describe('fluxo legado de código de perfil (DEPRECATED) atrás de LEGACY_PROFILE_CODES', () => {
  it('flag desligada (default) → unlock 403 mesmo com código correto', async () => {
    const r = await call(createMemoryRepository(), sess('novo@minu.co'), 'POST', '/api/profile/unlock', { role: 'admin', code: 'adm' });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'legacy_profile_codes_disabled' });
    expect(r.session).toBeUndefined();
  });
  it('flag ligada → unlock funciona para business/admin, mas NUNCA para approver', async () => {
    const repo = createMemoryRepository();
    const ok = await call(repo, sess('novo@minu.co'), 'POST', '/api/profile/unlock', { role: 'business', code: 'biz' }, cfgLegacy);
    expect(ok.status).toBe(200);
    const apr = await call(repo, sess('novo@minu.co'), 'POST', '/api/profile/unlock', { role: 'approver', code: 'biz' }, cfgLegacy);
    expect(apr.status).toBe(400);
    expect(apr.session).toBeUndefined();
  });
  it('papel approver na sessão nunca vale, nem em modo legado', async () => {
    const r = await call(createMemoryRepository(), sess('novo@minu.co', 'approver'), 'GET', '/api/proposals', null, cfgLegacy);
    expect(r.status).toBe(403);
  });
  it('admin obtido por código legado NÃO gere atribuições (precisa de atribuição individual)', async () => {
    const r = await call(createMemoryRepository(), sess('novo@minu.co', 'admin'), 'PUT', '/api/admin/assignments', { email: 'x@minu.co', role: 'admin' }, cfgLegacy);
    expect(r.status).toBe(403);
  });
  it('loadConfig: flag default false; "true" liga', () => {
    const base = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    expect(loadConfig(base).legacyProfileCodes).toBe(false);
    expect(loadConfig({ ...base, LEGACY_PROFILE_CODES: 'true' }).legacyProfileCodes).toBe(true);
    expect(loadConfig({ ...base, LEGACY_PROFILE_CODES: '1' }).legacyProfileCodes).toBe(false);
  });
});

describe('bootstrap do primeiro admin (BOOTSTRAP_ADMIN_EMAILS)', () => {
  it('parse: aceita domínios autorizados, rejeita os demais, normaliza e deduplica', () => {
    const r = parseBootstrapAdminEmails('Ana@minu.co, ana@minu.co; bad@evil.com  cto@brain3.com.br x@minu.co.evil.com');
    expect(r.valid).toEqual(['ana@minu.co', 'cto@brain3.com.br']);
    expect(r.rejected).toEqual(['bad@evil.com', 'x@minu.co.evil.com']);
    expect(parseBootstrapAdminEmails(undefined)).toEqual({ valid: [], rejected: [] });
  });
  it('loadConfig expõe válidos/rejeitados', () => {
    const c = loadConfig({ NODE_ENV: 'development', BOOTSTRAP_ADMIN_EMAILS: 'ana@minu.co,bad@evil.com' } as NodeJS.ProcessEnv);
    expect(c.bootstrapAdminEmails).toEqual(['ana@minu.co']);
    expect(c.bootstrapAdminRejected).toEqual(['bad@evil.com']);
  });
  it('cria admin auditado (ator bootstrap:env) só quando não há admin; depois é ignorado', async () => {
    const repo = createMemoryRepository();
    expect(await bootstrapAdmins(repo, ['ana@minu.co'])).toEqual(['ana@minu.co']);
    expect((await repo.getAssignment('ana@minu.co'))?.role).toBe('admin');
    expect((await repo.assignmentAudit())[0]).toMatchObject({ actorEmail: BOOTSTRAP_ACTOR, fromRole: null, toRole: 'admin' });
    // admin já existe → env ignorada (não vira backdoor permanente)
    expect(await bootstrapAdmins(repo, ['outro@minu.co'])).toEqual([]);
    expect(await repo.getAssignment('outro@minu.co')).toBeNull();
    // admin bootstrapado consegue gerir atribuições
    const r = await call(repo, sess('ana@minu.co'), 'PUT', '/api/admin/assignments', { email: 'b@minu.co', role: 'business' });
    expect(r.status).toBe(200);
  });
  it('lista vazia não faz nada', async () => {
    expect(await bootstrapAdmins(createMemoryRepository(), [])).toEqual([]);
  });
});

describe('approval.decide — apenas approver', () => {
  it('approver registra decisão justificada na auditoria; demais perfis → 403', async () => {
    const repo = await repoWithAllRoles();
    const id = await newProposal(repo);
    const path = `/api/proposals/${id}/approval`;
    for (const r of ['business', 'tech', 'admin'] as const) {
      expect((await call(repo, sess(EMAIL[r]), 'POST', path, { decision: 'approved', kind: 'excecao_comercial', note: 'ok' })).status).toBe(403);
    }
    expect((await call(repo, sess(EMAIL.approver), 'POST', path, { decision: 'approved', kind: 'excecao_comercial' })).status).toBe(400); // sem nota
    expect((await call(repo, sess(EMAIL.approver), 'POST', path, { decision: 'maybe', kind: 'replanejamento', note: 'x' })).status).toBe(400);
    expect((await call(repo, sess(EMAIL.approver), 'POST', path, { decision: 'rejected', kind: 'alteracao_escopo', note: 'fora do escopo' })).status).toBe(201);
    expect((await call(repo, sess(EMAIL.approver), 'POST', '/api/proposals/BONDLY-2027-999999/approval', { decision: 'approved', kind: 'replanejamento', note: 'x' })).status).toBe(404);
    const entries = await repo.audit(id);
    expect(entries.at(-1)).toMatchObject({ action: 'approval.rejected.alteracao_escopo', role: 'approver', actorEmail: EMAIL.approver });
  });
  it('approver NÃO edita técnico/comercial nem opera o relógio (403)', async () => {
    const repo = await repoWithAllRoles();
    const id = await newProposal(repo);
    const s = sess(EMAIL.approver);
    expect((await call(repo, s, 'PUT', `/api/proposals/${id}/technical`, { version: 1, technical: {} })).status).toBe(403);
    expect((await call(repo, s, 'PUT', `/api/proposals/${id}/commercial`, { version: 1, commercial: {} })).status).toBe(403);
    expect((await call(repo, s, 'POST', `/api/proposals/${id}/sla/pause`, { reason: 'x' })).status).toBe(403);
    expect((await call(repo, s, 'POST', '/api/proposals', { commercial: {} })).status).toBe(403);
  });
});

describe('/api/sla/indicators — gestão (approver/admin/tech), sem custo/margem', () => {
  const T = (d: string) => Date.parse(`${d}:00-03:00`);
  async function seedCompleted(repo: ProposalRepository): Promise<void> {
    const id = await newProposal(repo);
    const row = (kind: 'started' | 'paused' | 'resumed' | 'completed', at: string, payload: Record<string, unknown> = {}) =>
      repo.appendSlaEvent({ proposalId: id, kind, at: T(at), by: EMAIL.tech, payload });
    await row('started', '2027-03-15T12:00');
    await row('paused', '2027-03-17T12:00', { reason: 'Aguardando cliente', reasonCode: 'aguardando_cliente' });
    await row('resumed', '2027-03-19T12:00');
    await row('completed', '2027-03-22T12:00', { verdict: 'aprovado' });
    const open = await newProposal(repo); // em andamento: fora da amostra
    await repo.appendSlaEvent({ proposalId: open, kind: 'started', at: T('2027-03-15T12:00'), by: EMAIL.tech, payload: {} });
  }
  it('approver/admin/tech 200; business 403; sem perfil 403', async () => {
    const repo = await repoWithAllRoles();
    await seedCompleted(repo);
    for (const r of ['approver', 'admin', 'tech'] as const) {
      const res = await call(repo, sess(EMAIL[r]), 'GET', '/api/sla/indicators');
      expect(res.status).toBe(200);
      const b = res.body as { indicators: { n: number; effective: { p75: number | null }; raw: { p75: number | null }; pausesByReason: { reason: string }[] }; basis: string; percentileMethod: string };
      expect(b.indicators.n).toBe(1);
      expect(b.basis).toBe('tempo_util_efetivo');
      expect(b.percentileMethod).toBe('nearest-rank');
      expect(b.indicators.effective.p75).toBeLessThan(b.indicators.raw.p75!); // útil < bruto (houve pausa)
      expect(b.indicators.pausesByReason[0]!.reason).toBe('Aguardando cliente');
      expect(JSON.stringify(res.body)).not.toMatch(/margin|margem|custo|cost|price|preco|snapshot/i);
    }
    expect((await call(repo, sess(EMAIL.business), 'GET', '/api/sla/indicators')).status).toBe(403);
    expect((await call(repo, sess('novo@minu.co'), 'GET', '/api/sla/indicators')).status).toBe(403);
  });
  it('base vazia → n=0 e percentis null', async () => {
    const repo = await repoWithAllRoles();
    const res = await call(repo, sess(EMAIL.approver), 'GET', '/api/sla/indicators');
    expect(res.body).toMatchObject({ indicators: { n: 0, effective: { p75: null, p90: null }, pctWithinSla: null } });
  });
});

describe('payload por perfil: business não recebe dado interno', () => {
  it('business recebe resumo técnico, sem technical/snapshot; /api/me expõe só permissões do perfil', async () => {
    const repo = await repoWithAllRoles();
    const id = await newProposal(repo);
    await repo.update(id, 2, { technical: { implementationHours: 100, risks: 'x' }, snapshot: { margin: 0.4 } }, { actorEmail: EMAIL.tech, role: 'tech', action: 'x' });
    const biz = await call(repo, sess(EMAIL.business), 'GET', `/api/proposals/${id}`);
    const raw = JSON.stringify(biz.body);
    expect(raw).not.toContain('"technical"');
    expect(raw).not.toContain('"snapshot"');
    expect(raw).not.toContain('margin');
    const apr = JSON.stringify((await call(repo, sess(EMAIL.approver), 'GET', `/api/proposals/${id}`)).body);
    expect(apr).not.toContain('"snapshot"'); // approver: sem see_internal (menor privilégio)
    const me = (await call(repo, sess(EMAIL.business), 'GET', '/api/me')).body as { permissions: string[] };
    expect(me.permissions).toEqual(ACTIONS.filter((a) => can('business', a)));
    expect(me.permissions).not.toContain('proposal.see_internal');
  });
});

describe('SQLite — atribuições persistem e auditam (mesmo contrato do in-memory)', () => {
  const available = Number(process.versions.node.split('.')[0]) >= 22;
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bondly-rbac-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it.skipIf(!available)('set/revoke/list/audit + último admin protegido + persistência após reabrir', async () => {
    let repo = await createSqliteRepository(dir);
    await repo.setAssignment('ana@minu.co', 'admin', BOOTSTRAP_ACTOR);
    await repo.setAssignment('bia@minu.co', 'approver', 'ana@minu.co');
    await expect(repo.setAssignment('ana@minu.co', 'tech', 'ana@minu.co')).rejects.toThrow(/último administrador/);
    expect((await repo.getAssignment('ana@minu.co'))?.role).toBe('admin');
    repo = await createSqliteRepository(dir); // reabre
    expect((await repo.listAssignments()).map((a) => [a.email, a.role])).toEqual([['ana@minu.co', 'admin'], ['bia@minu.co', 'approver']]);
    await repo.setAssignment('bia@minu.co', null, 'ana@minu.co');
    expect(await repo.getAssignment('bia@minu.co')).toBeNull();
    const audit = await repo.assignmentAudit();
    expect(audit.map((a) => [a.targetEmail, a.fromRole, a.toRole, a.actorEmail])).toEqual([
      ['ana@minu.co', null, 'admin', BOOTSTRAP_ACTOR],
      ['bia@minu.co', null, 'approver', 'ana@minu.co'],
      ['bia@minu.co', 'approver', null, 'ana@minu.co'],
    ]);
  });
});
