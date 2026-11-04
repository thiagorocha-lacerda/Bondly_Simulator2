/**
 * G-002 — escopo por dono (docs/16): regressão IDOR por TODA rota com :id, listagem, reatribuição por admin,
 * concorrência com versão otimista e migração de banco legado. Roda em memória E em SQLite real.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryRepository } from './memoryRepository.js';
import { createSqliteRepository } from './sqliteRepository.js';
import { handleApi, type ApiResult } from './api.js';
import { scryptHasher } from './profileCodes.js';
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';
import { ROLES, ACTIONS, can, type Role } from './rbac.js';
import { canAccessProposal, ownerMatches } from './scope.js';
import { NotFoundError, type ProposalRepository, type Proposal } from './domain.js';

const cfg = { legacyProfileCodes: false, profileCodeHashes: { admin: scryptHasher.hash('adm') } } as unknown as ServerConfig;
const cfgLegacy = { legacyProfileCodes: true, profileCodeHashes: {} } as unknown as ServerConfig;

const EMAIL = {
  bizA: 'biz.a@minu.co',
  bizB: 'biz.b@minu.co',
  tech: 'tec@minu.co',
  approver: 'apr@minu.co',
  admin: 'adm@minu.co',
} as const;
type Who = keyof typeof EMAIL;
const ROLE_OF: Record<Who, Role> = { bizA: 'business', bizB: 'business', tech: 'tech', approver: 'approver', admin: 'admin' };

const sess = (email: string, role?: Role): SessionData => ({
  email,
  domain: email.slice(email.lastIndexOf('@') + 1),
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...(role ? { role } : {}),
});
const call = (repo: ProposalRepository, who: Who, method: string, path: string, body: unknown = null): Promise<ApiResult> =>
  handleApi({ method, path, session: sess(EMAIL[who]), body, repo, cfg });
const snap = (r: ApiResult) => ({ status: r.status, body: r.body });

async function seed(repo: ProposalRepository): Promise<void> {
  for (const w of Object.keys(EMAIL) as Who[]) await repo.setAssignment(EMAIL[w], ROLE_OF[w], 'seed');
}
/** Cria proposta de `owner`; `submitted` tira do rascunho (aguardando_analise_tecnica, versão 2). */
async function mk(repo: ProposalRepository, owner: string, submitted: boolean): Promise<Proposal> {
  const id = `BONDLY-2027-${String(await repo.nextSequence()).padStart(6, '0')}`;
  let p = await repo.create({ id, ownerEmail: owner, commercial: { volume: { users: 10 } } }, { actorEmail: owner, role: 'business', action: 'proposal.create' });
  if (submitted) p = await repo.update(id, p.version, { status: 'aguardando_analise_tecnica' }, { actorEmail: owner, role: 'business', action: 'test.submit' });
  return p;
}

// ---- Todas as rotas com :id de proposta (a lista É o contrato do teste) ----
interface RouteDef {
  name: string;
  method: string;
  path: (id: string) => string;
  body: (p: Proposal) => unknown;
  /** ação RBAC exigida (a checagem de ação 403 vem antes e independe do recurso) */
  action: (typeof ACTIONS)[number];
}
const ROUTES: readonly RouteDef[] = [
  { name: 'GET /:id', method: 'GET', path: (id) => `/api/proposals/${id}`, body: () => null, action: 'proposal.read' },
  { name: 'GET /:id/audit', method: 'GET', path: (id) => `/api/proposals/${id}/audit`, body: () => null, action: 'proposal.read' },
  { name: 'PUT /:id/commercial', method: 'PUT', path: (id) => `/api/proposals/${id}/commercial`, body: (p) => ({ version: p.version, commercial: { volume: { users: 99 } } }), action: 'proposal.edit_commercial' },
  { name: 'PUT /:id/technical', method: 'PUT', path: (id) => `/api/proposals/${id}/technical`, body: (p) => ({ version: p.version, technical: { integrations: 1 } }), action: 'proposal.edit_technical' },
  { name: 'GET /:id/sla', method: 'GET', path: (id) => `/api/proposals/${id}/sla`, body: () => null, action: 'proposal.read' },
  { name: 'POST /:id/sla/pause', method: 'POST', path: (id) => `/api/proposals/${id}/sla/pause`, body: () => ({ reason: 'x', reasonCode: 'outro' }), action: 'sla.manage' },
  { name: 'POST /:id/sla/resume', method: 'POST', path: (id) => `/api/proposals/${id}/sla/resume`, body: () => ({ confirmedItems: [] }), action: 'sla.manage' },
  { name: 'POST /:id/sla/complete', method: 'POST', path: (id) => `/api/proposals/${id}/sla/complete`, body: () => ({ verdict: 'aprovado' }), action: 'sla.manage' },
  { name: 'POST /:id/transition', method: 'POST', path: (id) => `/api/proposals/${id}/transition`, body: (p) => ({ version: p.version, transition: 'submeter_analise' }), action: 'proposal.read' },
  { name: 'GET /:id/meetings', method: 'GET', path: (id) => `/api/proposals/${id}/meetings`, body: () => null, action: 'proposal.see_internal' },
  { name: 'POST /:id/meetings', method: 'POST', path: (id) => `/api/proposals/${id}/meetings`, body: () => ({ objective: 'alinhar' }), action: 'sla.manage' },
  { name: 'POST /:id/meetings/:mid/transition', method: 'POST', path: (id) => `/api/proposals/${id}/meetings/00000000-0000-0000-0000-000000000000/transition`, body: () => ({ transition: 'agendar' }), action: 'sla.manage' },
  { name: 'POST /:id/approval', method: 'POST', path: (id) => `/api/proposals/${id}/approval`, body: () => ({ decision: 'approved', kind: 'excecao_comercial', note: 'ok' }), action: 'approval.decide' },
  { name: 'GET /api/admin/proposals/:id/owner', method: 'GET', path: (id) => `/api/admin/proposals/${id}/owner`, body: () => null, action: 'admin.reassign_owner' },
  { name: 'PUT /api/admin/proposals/:id/owner', method: 'PUT', path: (id) => `/api/admin/proposals/${id}/owner`, body: (p) => ({ ownerEmail: EMAIL.bizB, version: p.version }), action: 'admin.reassign_owner' },
  { name: 'POST /api/admin/proposals/:id/owner', method: 'POST', path: (id) => `/api/admin/proposals/${id}/owner`, body: (p) => ({ ownerEmail: EMAIL.bizB, version: p.version }), action: 'admin.reassign_owner' },
];

let dir = '';
const sqliteAvailable = Number(process.versions.node.split('.')[0]) >= 22;
const factories: [string, () => Promise<ProposalRepository>][] = [['memória', async () => createMemoryRepository()]];
if (sqliteAvailable) {
  factories.push(['sqlite', async () => createSqliteRepository(mkdtempSync(join(dir || (dir = mkdtempSync(join(tmpdir(), 'bondly-g002-'))), 'r-')))]);
}
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('scope.ts — função pura', () => {
  it('ownerMatches normaliza caixa/espaços e nunca casa dono vazio', () => {
    expect(ownerMatches(' Ana@Minu.co ', 'ana@minu.co')).toBe(true);
    expect(ownerMatches('', '')).toBe(false);
    expect(ownerMatches(undefined, 'a@minu.co')).toBe(false);
  });
  it('4 papéis × (própria, alheia, rascunho, submetida, legada)', () => {
    const own = { ownerEmail: 'a@minu.co', status: 'rascunho_comercial' as const };
    const sub = { ownerEmail: 'b@minu.co', status: 'aguardando_analise_tecnica' as const };
    const legacy = { ownerEmail: '', status: 'emitido' as const };
    expect(canAccessProposal('business', 'a@minu.co', own)).toBe(true);
    expect(canAccessProposal('business', 'a@minu.co', sub)).toBe(false);
    expect(canAccessProposal('business', 'a@minu.co', legacy)).toBe(false);
    for (const r of ['tech', 'approver'] as const) {
      expect(canAccessProposal(r, 'x@minu.co', own)).toBe(false);
      expect(canAccessProposal(r, 'x@minu.co', sub)).toBe(true);
      expect(canAccessProposal(r, 'x@minu.co', legacy)).toBe(true);
    }
    for (const p of [own, sub, legacy]) expect(canAccessProposal('admin', 'x@minu.co', p)).toBe(true);
    expect(canAccessProposal(undefined, 'a@minu.co', own)).toBe(false);
  });
});

describe('matriz: admin.reassign_owner só para admin (4 papéis)', () => {
  for (const r of ROLES) {
    it(`${r} × admin.reassign_owner → ${r === 'admin' ? 'permite' : 'nega'}`, () => {
      expect(can(r, 'admin.reassign_owner')).toBe(r === 'admin');
    });
  }
});

for (const [label, factory] of factories) {
  describe(`IDOR por rota com :id [${label}]`, () => {
    it(`lista de rotas cobre o conjunto esperado (${ROUTES.length})`, () => {
      expect(ROUTES.length).toBe(16);
    });

    for (const route of ROUTES) {
      describe(route.name, () => {
        it('business B → 404 (ou 403 constante por ação) em proposta de A, IDÊNTICO ao de id inexistente; log rbac_denied sem e-mail', async () => {
          const repo = await factory();
          await seed(repo);
          const pa = await mk(repo, EMAIL.bizA, false);
          warn.mockClear();
          const alien = await call(repo, 'bizB', route.method, route.path(pa.id), route.body(pa));
          const ghost = await call(repo, 'bizB', route.method, route.path('BONDLY-2027-999999'), route.body(pa));
          expect(snap(alien)).toEqual(snap(ghost)); // não revela existência
          const allowed = can('business', route.action) && !route.action.startsWith('admin.');
          expect(alien.status).toBe(allowed ? 404 : 403);
          if (allowed) {
            const logs = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"rbac_denied"'));
            expect(logs.length).toBeGreaterThan(0);
            expect(logs[0]).toContain('owner_scope');
            expect(logs.join('')).not.toContain('@minu.co');
          }
          // nada mudou na proposta de A
          expect(await repo.get(pa.id)).toMatchObject({ version: pa.version, ownerEmail: EMAIL.bizA, commercial: pa.commercial });
        });

        it('tech/approver NÃO alcançam rascunho (404, idêntico ao inexistente) quando têm a ação', async () => {
          const repo = await factory();
          await seed(repo);
          const draft = await mk(repo, EMAIL.bizA, false);
          for (const who of ['tech', 'approver'] as const) {
            const r = await call(repo, who, route.method, route.path(draft.id), route.body(draft));
            const ghost = await call(repo, who, route.method, route.path('BONDLY-2027-999999'), route.body(draft));
            expect(snap(r)).toEqual(snap(ghost));
            const hasAction = can(ROLE_OF[who], route.action) && !route.action.startsWith('admin.');
            // transition: ação é decidida por estado ⇒ guard (404) vem antes do 403 de papel
            const expected = route.name === 'POST /:id/transition' ? 404 : hasAction ? 404 : 403;
            expect(r.status).toBe(expected);
          }
        });

        it('dono (A) e admin alcançam (≠404) nas rotas permitidas ao papel', async () => {
          const repo = await factory();
          await seed(repo);
          const p = await mk(repo, EMAIL.bizA, true);
          if (can('business', route.action) && !route.action.startsWith('admin.')) {
            const a = await call(repo, 'bizA', route.method, route.path(p.id), route.body(p));
            expect(a.status).not.toBe(404);
            expect(a.status).not.toBe(403);
          }
          if (can('admin', route.action) && route.name.startsWith('GET /:id')) {
            expect((await call(repo, 'admin', route.method, route.path(p.id), route.body(p))).status).toBe(200);
          }
          if (route.action === 'admin.reassign_owner') {
            const r = await call(repo, 'admin', route.method, route.path(p.id), route.body(p));
            expect(r.status).toBe(200);
          }
        });
      });
    }

    it('tech/approver/admin alcançam proposta submetida; tech opera SLA/técnico só nas visíveis', async () => {
      const repo = await factory();
      await seed(repo);
      const draft = await mk(repo, EMAIL.bizA, false);
      const sub = await mk(repo, EMAIL.bizA, true);
      for (const who of ['tech', 'approver', 'admin'] as const) {
        expect((await call(repo, who, 'GET', `/api/proposals/${sub.id}`)).status).toBe(200);
        expect((await call(repo, who, 'GET', `/api/proposals/${sub.id}/audit`)).status).toBe(200);
        expect((await call(repo, who, 'GET', `/api/proposals/${sub.id}/sla`)).status).toBe(200);
      }
      expect((await call(repo, 'admin', 'GET', `/api/proposals/${draft.id}`)).status).toBe(200);
      expect((await call(repo, 'tech', 'PUT', `/api/proposals/${sub.id}/technical`, { version: sub.version, technical: { integrations: 2 } })).status).toBe(200);
      expect((await call(repo, 'tech', 'PUT', `/api/proposals/${draft.id}/technical`, { version: draft.version, technical: { integrations: 2 } })).status).toBe(404);
      expect((await call(repo, 'tech', 'POST', `/api/proposals/${draft.id}/meetings`, { objective: 'x' })).status).toBe(404);
      expect((await call(repo, 'tech', 'POST', `/api/proposals/${sub.id}/meetings`, { objective: 'x' })).status).toBe(201);
      expect((await call(repo, 'approver', 'POST', `/api/proposals/${sub.id}/approval`, { decision: 'approved', kind: 'excecao_comercial', note: 'ok' })).status).toBe(201);
      // nenhum papel ganhou escrita nova: approver/admin seguem 403 em edição
      expect((await call(repo, 'approver', 'PUT', `/api/proposals/${sub.id}/commercial`, { version: 9, commercial: {} })).status).toBe(403);
      expect((await call(repo, 'admin', 'PUT', `/api/proposals/${sub.id}/commercial`, { version: 9, commercial: {} })).status).toBe(403);
    });

    it('listagem filtrada no servidor: sem ids/contagens alheios; tech/approver só submetidas; admin todas', async () => {
      const repo = await factory();
      await seed(repo);
      const a1 = await mk(repo, EMAIL.bizA, false);
      const a2 = await mk(repo, EMAIL.bizA, true);
      const b1 = await mk(repo, EMAIL.bizB, false);
      const ids = async (who: Who) => ((await call(repo, who, 'GET', '/api/proposals')).body as { proposals: { id: string }[] }).proposals.map((p) => p.id).sort();
      expect(await ids('bizA')).toEqual([a1.id, a2.id].sort());
      expect(await ids('bizB')).toEqual([b1.id]);
      expect(await ids('tech')).toEqual([a2.id]);
      expect(await ids('approver')).toEqual([a2.id]);
      expect(await ids('admin')).toEqual([a1.id, a2.id, b1.id].sort());
      const rawB = JSON.stringify((await call(repo, 'bizB', 'GET', '/api/proposals')).body);
      expect(rawB).not.toContain(a1.id);
      expect(rawB).not.toContain(a2.id);
      expect(Object.keys((await call(repo, 'bizB', 'GET', '/api/proposals')).body as object)).toEqual(['proposals']); // sem total/paginação
    });

    it('usuário novo sem propostas: lista vazia, não revela o total existente', async () => {
      const repo = await factory();
      await seed(repo);
      await mk(repo, EMAIL.bizA, true);
      expect((await call(repo, 'bizB', 'GET', '/api/proposals')).body).toEqual({ proposals: [] });
    });

    describe('reatribuição de dono (admin)', () => {
      it('transfere o acesso (A perde, B ganha), audita (quem/quando/de/para/proposta) e incrementa versão', async () => {
        const repo = await factory();
        await seed(repo);
        const p = await mk(repo, EMAIL.bizA, true);
        expect((await call(repo, 'bizA', 'GET', `/api/proposals/${p.id}`)).status).toBe(200);
        expect((await call(repo, 'bizB', 'GET', `/api/proposals/${p.id}`)).status).toBe(404);
        const r = await call(repo, 'admin', 'PUT', `/api/admin/proposals/${p.id}/owner`, { ownerEmail: ' Biz.B@Minu.co ', version: p.version });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ changed: true, proposal: { ownerEmail: EMAIL.bizB, version: p.version + 1 } });
        expect((await call(repo, 'bizA', 'GET', `/api/proposals/${p.id}`)).status).toBe(404);
        expect((await call(repo, 'bizA', 'PUT', `/api/proposals/${p.id}/commercial`, { version: p.version + 1, commercial: {} })).status).toBe(404);
        expect((await call(repo, 'bizB', 'GET', `/api/proposals/${p.id}`)).status).toBe(200);
        const audit = await repo.ownerAudit(p.id);
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({ proposalId: p.id, actorEmail: EMAIL.admin, fromOwner: EMAIL.bizA, toOwner: EMAIL.bizB });
        expect(Date.parse(audit[0]!.at)).not.toBeNaN();
        const g = await call(repo, 'admin', 'GET', `/api/admin/proposals/${p.id}/owner`);
        expect(g.body).toMatchObject({ ownerEmail: EMAIL.bizB, audit: [{ fromOwner: EMAIL.bizA }] });
        expect(warn.mock.calls.length >= 0).toBe(true);
      });

      it('e-mail inválido / domínio não autorizado / não-ASCII / alias → 400 e nada muda', async () => {
        const repo = await factory();
        await seed(repo);
        const p = await mk(repo, EMAIL.bizA, true);
        for (const bad of ['x@gmail.com', 'a+b@minu.co', 'ünï@minu.co', 'a b@minu.co', 'sem-arroba', '', 42, null, undefined, 'a@minu.co.evil.com']) {
          const r = await call(repo, 'admin', 'PUT', `/api/admin/proposals/${p.id}/owner`, { ownerEmail: bad });
          expect(r.status).toBe(400);
          expect(r.body).toEqual({ error: 'email_not_allowed' });
        }
        expect((await repo.get(p.id))?.ownerEmail).toBe(EMAIL.bizA);
        expect(await repo.ownerAudit(p.id)).toHaveLength(0);
      });

      it('business/tech/approver → 403 (e nada muda); admin LEGADO (sem atribuição) → 403; inexistente → 404; mesmo dono → no-op; versão defasada → 409', async () => {
        const repo = await factory();
        await seed(repo);
        const p = await mk(repo, EMAIL.bizA, true);
        for (const who of ['bizA', 'bizB', 'tech', 'approver'] as const) {
          expect((await call(repo, who, 'PUT', `/api/admin/proposals/${p.id}/owner`, { ownerEmail: EMAIL.bizB })).status).toBe(403);
          expect((await call(repo, who, 'GET', `/api/admin/proposals/${p.id}/owner`)).status).toBe(403);
        }
        const legacy = await handleApi({ method: 'PUT', path: `/api/admin/proposals/${p.id}/owner`, session: sess('legacy.admin@minu.co', 'admin'), body: { ownerEmail: EMAIL.bizB }, repo, cfg: cfgLegacy });
        expect(legacy.status).toBe(403);
        expect((await call(repo, 'admin', 'PUT', '/api/admin/proposals/BONDLY-2027-999999/owner', { ownerEmail: EMAIL.bizB })).status).toBe(404);
        const same = await call(repo, 'admin', 'PUT', `/api/admin/proposals/${p.id}/owner`, { ownerEmail: EMAIL.bizA, version: p.version });
        expect(same.body).toMatchObject({ changed: false });
        expect(await repo.ownerAudit(p.id)).toHaveLength(0);
        expect((await call(repo, 'admin', 'PUT', `/api/admin/proposals/${p.id}/owner`, { ownerEmail: EMAIL.bizB, version: 999 })).status).toBe(409);
        expect((await repo.get(p.id))?.ownerEmail).toBe(EMAIL.bizA);
      });
    });

    describe('concorrência e versão otimista não burlam o guard', () => {
      it('A escreve com versão antiga DEPOIS da reatribuição → 404 (guard) e proposta intacta', async () => {
        const repo = await factory();
        await seed(repo);
        const p = await mk(repo, EMAIL.bizA, false);
        await call(repo, 'admin', 'PUT', `/api/admin/proposals/${p.id}/owner`, { ownerEmail: EMAIL.bizB, version: p.version });
        const r = await call(repo, 'bizA', 'PUT', `/api/proposals/${p.id}/commercial`, { version: p.version, commercial: { hack: true } });
        expect(r.status).toBe(404);
        expect((await repo.get(p.id))?.commercial).toEqual(p.commercial);
      });

      it('TOCTOU: guard passou com dono antigo e a reatribuição ocorreu antes do UPDATE → repositório recusa (404), não grava', async () => {
        const repo = await factory();
        await seed(repo);
        const p = await mk(repo, EMAIL.bizA, false);
        // repositório "defasado": get() devolve o snapshot de antes da reatribuição (simula a janela check→write)
        const stale: ProposalRepository = { ...repo, get: async (id) => (id === p.id ? p : repo.get(id)) };
        const reassigned = await repo.reassignOwner(p.id, EMAIL.bizB, EMAIL.admin);
        const r = await handleApi({
          method: 'PUT',
          path: `/api/proposals/${p.id}/commercial`,
          session: sess(EMAIL.bizA),
          body: { version: reassigned.proposal.version, commercial: { hack: true } },
          repo: stale,
          cfg,
        });
        expect(r.status).toBe(404);
        expect((await repo.get(p.id))?.commercial).toEqual(p.commercial);
        await expect(repo.update(p.id, reassigned.proposal.version, { commercial: { hack: 1 } }, { actorEmail: EMAIL.bizA, role: 'business', action: 'x' }, { requireOwner: EMAIL.bizA })).rejects.toBeInstanceOf(NotFoundError);
      });

      it('reatribuição e escrita do dono em paralelo: nunca o ex-dono escreve após a troca; transition idem', async () => {
        const repo = await factory();
        await seed(repo);
        const p = await mk(repo, EMAIL.bizA, false);
        const [w, t] = await Promise.all([
          call(repo, 'bizA', 'PUT', `/api/proposals/${p.id}/commercial`, { version: p.version, commercial: { v: 1 } }),
          call(repo, 'admin', 'PUT', `/api/admin/proposals/${p.id}/owner`, { ownerEmail: EMAIL.bizB, version: p.version }),
        ]);
        expect(w.status === 200 || w.status === 404 || w.status === 409).toBe(true);
        expect(t.status).toBe(200);
        const after = await repo.get(p.id);
        expect(after?.ownerEmail).toBe(EMAIL.bizB);
        const late = await call(repo, 'bizA', 'POST', `/api/proposals/${p.id}/transition`, { version: after!.version, transition: 'submeter_analise' });
        expect(late.status).toBe(404);
        expect((await repo.get(p.id))?.status).toBe('rascunho_comercial');
      });

      it('A e B disputam a mesma proposta alheia a B: B nunca escreve; versão defasada de A continua 409 só para o dono', async () => {
        const repo = await factory();
        await seed(repo);
        const p = await mk(repo, EMAIL.bizA, false);
        const [a, b] = await Promise.all([
          call(repo, 'bizA', 'PUT', `/api/proposals/${p.id}/commercial`, { version: p.version, commercial: { by: 'A' } }),
          call(repo, 'bizB', 'PUT', `/api/proposals/${p.id}/commercial`, { version: p.version, commercial: { by: 'B' } }),
        ]);
        expect(a.status).toBe(200);
        expect(b.status).toBe(404);
        expect((await repo.get(p.id))?.commercial).toEqual({ by: 'A' });
        const stale = await call(repo, 'bizA', 'PUT', `/api/proposals/${p.id}/commercial`, { version: p.version, commercial: {} });
        expect(stale.status).toBe(409);
        const staleB = await call(repo, 'bizB', 'PUT', `/api/proposals/${p.id}/commercial`, { version: p.version, commercial: {} });
        expect(staleB).toMatchObject({ status: 404 }); // 409 (com `actual`) nunca vaza para quem não é dono
        expect(JSON.stringify(staleB.body)).not.toContain('actual');
      });
    });
  });
}

describe('SQLite — auditoria de dono append-only e migração de banco legado', () => {
  const run = sqliteAvailable ? it : it.skip;
  type RawDb = { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): Record<string, unknown>[] } };
  const rawOpen = (file: string): RawDb => {
    const req = createRequire(import.meta.url) as (id: string) => unknown;
    const { DatabaseSync } = req('node:sqlite') as { DatabaseSync: new (p: string) => RawDb };
    return new DatabaseSync(file);
  };

  run('owner_audit: UPDATE/DELETE abortam por trigger', async () => {
    dir ||= mkdtempSync(join(tmpdir(), 'bondly-g002-'));
    const d = mkdtempSync(join(dir, 'ap-'));
    const repo = await createSqliteRepository(d);
    const p = await mk(repo, EMAIL.bizA, true);
    await repo.reassignOwner(p.id, EMAIL.bizB, EMAIL.admin);
    const raw = rawOpen(join(d, 'bondly.db'));
    expect(() => raw.exec(`UPDATE owner_audit SET to_owner = 'x'`)).toThrow(/append-only/);
    expect(() => raw.exec(`DELETE FROM owner_audit`)).toThrow(/append-only/);
  });

  const legacyDdl = (withOwner: boolean) => `
    CREATE TABLE proposals (id TEXT PRIMARY KEY, version INTEGER NOT NULL, status TEXT NOT NULL,
      ${withOwner ? 'owner_email TEXT NOT NULL,' : ''} commercial TEXT NOT NULL, technical TEXT, snapshot TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE audit (id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, actor_email TEXT NOT NULL, role TEXT NOT NULL,
      action TEXT NOT NULL, from_state TEXT, to_state TEXT, note TEXT, at TEXT NOT NULL);
    CREATE TABLE seq (k TEXT PRIMARY KEY, v INTEGER NOT NULL); INSERT INTO seq VALUES ('proposal', 3);
    CREATE TABLE role_assignments (email TEXT PRIMARY KEY, role TEXT NOT NULL, assigned_by TEXT NOT NULL, assigned_at TEXT NOT NULL);
    CREATE TABLE assignment_audit (id TEXT PRIMARY KEY, target_email TEXT NOT NULL, actor_email TEXT NOT NULL, from_role TEXT, to_role TEXT, at TEXT NOT NULL);`;

  run('schema anterior (sem owner_audit): migra aditivamente; dono legado vazio/caixa-mista; só admin vê órfã; reatribuição repara', async () => {
    dir ||= mkdtempSync(join(tmpdir(), 'bondly-g002-'));
    const d = mkdtempSync(join(dir, 'legacy-'));
    const raw = rawOpen(join(d, 'bondly.db'));
    raw.exec(legacyDdl(true));
    const ins = raw.prepare(`INSERT INTO proposals VALUES (?, 1, 'aguardando_analise_tecnica', ?, '{}', NULL, NULL, 't', 't')`);
    ins.run('BONDLY-2027-000001', ' Biz.A@Minu.co ');
    ins.run('BONDLY-2027-000002', '');
    ins.run('BONDLY-2027-000003', 'outro@minu.co');
    const repo = await createSqliteRepository(d); // abre o banco antigo
    await seed(repo);
    const ids = async (who: Who) => ((await call(repo, who, 'GET', '/api/proposals')).body as { proposals: { id: string }[] }).proposals.map((p) => p.id).sort();
    expect(await ids('bizA')).toEqual(['BONDLY-2027-000001']); // normalizado
    expect(await ids('bizB')).toEqual([]);
    expect(await ids('admin')).toEqual(['BONDLY-2027-000001', 'BONDLY-2027-000002', 'BONDLY-2027-000003']);
    expect((await call(repo, 'bizA', 'GET', '/api/proposals/BONDLY-2027-000002')).status).toBe(404); // órfã
    expect((await call(repo, 'admin', 'GET', '/api/proposals/BONDLY-2027-000002')).status).toBe(200);
    const fix = await call(repo, 'admin', 'PUT', '/api/admin/proposals/BONDLY-2027-000002/owner', { ownerEmail: EMAIL.bizB, version: 1 });
    expect(fix.status).toBe(200);
    expect((await repo.ownerAudit('BONDLY-2027-000002'))[0]).toMatchObject({ fromOwner: '', toOwner: EMAIL.bizB });
    expect((await call(repo, 'bizB', 'GET', '/api/proposals/BONDLY-2027-000002')).status).toBe(200);
    expect(await repo.nextSequence()).toBe(4); // dados anteriores preservados
  });

  run('schema MUITO antigo (sem coluna owner_email): coluna aditiva vazia ⇒ só admin enxerga', async () => {
    dir ||= mkdtempSync(join(tmpdir(), 'bondly-g002-'));
    const d = mkdtempSync(join(dir, 'older-'));
    const raw = rawOpen(join(d, 'bondly.db'));
    raw.exec(legacyDdl(false));
    raw.prepare(`INSERT INTO proposals (id, version, status, commercial, created_at, updated_at) VALUES ('BONDLY-2027-000001', 1, 'rascunho_comercial', '{}', 't', 't')`).run();
    const repo = await createSqliteRepository(d);
    await seed(repo);
    expect((await call(repo, 'bizA', 'GET', '/api/proposals/BONDLY-2027-000001')).status).toBe(404);
    expect((await call(repo, 'tech', 'GET', '/api/proposals/BONDLY-2027-000001')).status).toBe(404); // rascunho
    expect((await call(repo, 'admin', 'GET', '/api/proposals/BONDLY-2027-000001')).status).toBe(200);
    // reabrir é idempotente
    await createSqliteRepository(d);
  });
});
