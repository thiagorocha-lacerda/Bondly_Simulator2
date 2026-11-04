/**
 * Re-revisão 3 (docs/14): G-023 (HIGH) · G-024 · G-025 · G-027 · G-028 · G-029 · G-030.
 * Cada teste de G-023 reproduz o EXPLOIT ORIGINAL do Guardian (memória E SQLite) e falha no comportamento antigo.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createMemoryRepository } from './memoryRepository.js';
import { createSqliteRepository } from './sqliteRepository.js';
import { handleApi, type ApiResult } from './api.js';
import { checkText } from './limits.js';
import { weakSecretReason, loadConfig, DEV_SESSION_SECRET } from './config.js';
import type { ProposalRepository, WorkflowState, ApprovalKind } from './domain.js';
import type { Role } from './rbac.js';
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';

const cfg = { legacyProfileCodes: false, profileCodeHashes: {} } as unknown as ServerConfig;
const E = { biz: 'biz.a@minu.co', tech: 'tec@minu.co', apr: 'apr@minu.co', adm: 'adm@minu.co' } as const;
type Who = keyof typeof E;
const ROLE_OF: Record<Who, Role> = { biz: 'business', tech: 'tech', apr: 'approver', adm: 'admin' };
const sess = (email: string): SessionData => ({ email, domain: 'minu.co', exp: Math.floor(Date.now() / 1000) + 3600 });
const call = (repo: ProposalRepository, who: Who, method: string, path: string, body: unknown = null): Promise<ApiResult> =>
  handleApi({ method, path, session: sess(E[who]), body, repo, cfg });

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'bondly-r3-')); dirs.push(d); return d; };
const factories: [string, () => Promise<ProposalRepository>][] = [
  ['memória', async () => createMemoryRepository()],
  ['sqlite', async () => createSqliteRepository(tmp())],
];

async function world(repo: ProposalRepository, status: WorkflowState) {
  for (const w of Object.keys(E) as Who[]) await repo.setAssignment(E[w], ROLE_OF[w], 'seed');
  const id = `BONDLY-2027-${String(await repo.nextSequence()).padStart(6, '0')}`;
  const base = { actorEmail: E.biz, role: 'business' as Role };
  let p = await repo.create({ id, ownerEmail: E.biz, commercial: { volume: { users: 10 }, negotiation: { extraDiscount: 0.01 } } }, { ...base, action: 'proposal.create' });
  p = await repo.update(id, p.version, { status, technical: { implementationHours: 10, integrations: [] } }, { ...base, action: 'test.setup' });
  return p;
}
const reqPath = (id: string) => `/api/proposals/${id}/approval-requests`;
const decPath = (id: string) => `/api/approval-requests/${id}/decision`;
const ver = async (repo: ProposalRepository, id: string) => (await repo.get(id))!.version;
const REANALYSIS: WorkflowState[] = ['aguardando_analise_tecnica', 'em_analise_tecnica'];

for (const [label, factory] of factories) {
  describe(`G-023 [${label}] — mudança material com pendência NÃO contorna a reanálise`, () => {
    it('variante A: replanejamento_sla pendente + business altera desconto 1%→40% ⇒ invalida; decisão não restaura; consolidar/emitir 409', async () => {
      const repo = await factory();
      const p = await world(repo, 'aprovado_tecnicamente');
      const r = await call(repo, 'tech', 'POST', reqPath(p.id), { kind: 'replanejamento_sla', justification: 'replanejar', version: p.version });
      expect(r.status).toBe(201);
      const reqId = (r.body as { request: { id: string } }).request.id;
      const edit = await call(repo, 'biz', 'PUT', `/api/proposals/${p.id}/commercial`, { version: await ver(repo, p.id), commercial: { volume: { users: 10 }, negotiation: { extraDiscount: 0.4 } } });
      expect(edit.status).toBe(200);
      expect(edit.body).toMatchObject({ invalidated: true, approvalsInvalidated: 1 });
      expect((await repo.getApprovalRequest(reqId))?.status).toBe('invalidated');
      expect(REANALYSIS).toContain((await repo.get(p.id))!.status);
      // approver tenta aprovar a solicitação antiga ⇒ não restaura estado emitível
      const dec = await call(repo, 'apr', 'POST', decPath(reqId), { decision: 'approved', justification: 'ok' });
      expect(dec.status).toBe(409);
      expect(dec.body).toMatchObject({ error: 'approval_invalidated' });
      expect((await call(repo, 'biz', 'POST', `/api/proposals/${p.id}/transition`, { version: await ver(repo, p.id), transition: 'consolidar' })).status).toBe(409);
      expect((await call(repo, 'biz', 'POST', `/api/proposals/${p.id}/transition`, { version: await ver(repo, p.id), transition: 'emitir' })).status).toBe(409);
      expect(['aprovado_tecnicamente', 'pronto_para_emissao', 'emitido']).not.toContain((await repo.get(p.id))!.status);
    });

    it('variante B2: excecao_comercial pendente + tech altera horas/integrações ⇒ invalida e volta à análise técnica', async () => {
      const repo = await factory();
      const p = await world(repo, 'pronto_para_emissao');
      const r = await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'excecao_comercial', justification: 'exceção', version: p.version });
      expect(r.status).toBe(201);
      const reqId = (r.body as { request: { id: string } }).request.id;
      const edit = await call(repo, 'tech', 'PUT', `/api/proposals/${p.id}/technical`, { version: await ver(repo, p.id), technical: { implementationHours: 9999, integrations: [] } });
      expect(edit.status).toBe(200);
      expect(edit.body).toMatchObject({ invalidated: true, approvalsInvalidated: 1 });
      expect((await repo.getApprovalRequest(reqId))?.status).toBe('invalidated');
      expect((await repo.get(p.id))?.status).toBe('em_analise_tecnica');
      expect((await call(repo, 'apr', 'POST', decPath(reqId), { decision: 'approved', justification: 'ok' })).status).toBe(409);
      expect((await call(repo, 'biz', 'POST', `/api/proposals/${p.id}/transition`, { version: await ver(repo, p.id), transition: 'emitir' })).status).toBe(409);
      expect((await repo.get(p.id))?.status).toBe('em_analise_tecnica');
    });

    const KINDS: ApprovalKind[] = ['excecao_comercial', 'alteracao_escopo', 'replanejamento_sla'];
    const ORIGINS: WorkflowState[] = ['aprovado_tecnicamente', 'pronto_para_emissao'];
    for (const kind of KINDS) for (const edit of ['commercial', 'technical'] as const) for (const origin of ORIGINS) {
      it(`matriz: ${kind} × edição ${edit} × origem ${origin} ⇒ invalidada + reanálise`, async () => {
        const repo = await factory();
        const p = await world(repo, origin);
        const requester: Who = kind === 'replanejamento_sla' ? 'tech' : 'biz';
        const r = await call(repo, requester, 'POST', reqPath(p.id), { kind, justification: 'j', version: p.version });
        expect(r.status).toBe(201);
        const reqId = (r.body as { request: { id: string } }).request.id;
        const out = edit === 'commercial'
          ? await call(repo, 'biz', 'PUT', `/api/proposals/${p.id}/commercial`, { version: await ver(repo, p.id), commercial: { volume: { users: 999 }, negotiation: { extraDiscount: 0.01 } } })
          : await call(repo, 'tech', 'PUT', `/api/proposals/${p.id}/technical`, { version: await ver(repo, p.id), technical: { implementationHours: 777, integrations: [] } });
        expect(out.status).toBe(200);
        expect((await repo.getApprovalRequest(reqId))?.status).toBe('invalidated');
        expect(REANALYSIS).toContain((await repo.get(p.id))!.status);
        expect((await call(repo, 'apr', 'POST', decPath(reqId), { decision: 'approved', justification: 'ok' })).status).toBe(409);
        expect(REANALYSIS).toContain((await repo.get(p.id))!.status);
      });
    }

    it('edição NÃO material com pendência ⇒ 409 approval_pending (nada muda); sem pendência segue 200', async () => {
      const repo = await factory();
      const p = await world(repo, 'aprovado_tecnicamente');
      const r = await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'excecao_comercial', justification: 'j', version: p.version });
      const reqId = (r.body as { request: { id: string } }).request.id;
      const before = (await repo.get(p.id))!;
      const out = await call(repo, 'biz', 'PUT', `/api/proposals/${p.id}/commercial`, { version: before.version, commercial: { volume: { users: 10 }, negotiation: { extraDiscount: 0.01 }, nota: 'x' } });
      expect(out.status).toBe(409);
      expect(out.body).toMatchObject({ error: 'approval_pending' });
      expect(await repo.get(p.id)).toEqual(before);
      expect((await repo.getApprovalRequest(reqId))?.status).toBe('pending');
    });
  });

  describe(`G-024 [${label}] — pré-condição e atomicidade`, () => {
    it('janela: estado alterado entre solicitação e decisão (1ª etapa antiga sem invalidar) ⇒ decisão 409 approval_stale, estado preservado', async () => {
      const repo = await factory();
      const p = await world(repo, 'pronto_para_emissao');
      const r = await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'excecao_comercial', justification: 'j', version: p.version });
      const reqId = (r.body as { request: { id: string } }).request.id;
      // simula a "primeira transação" do fluxo antigo: estado → reanálise, MAS solicitação ainda pendente
      const cur = (await repo.get(p.id))!;
      await repo.update(p.id, cur.version, { status: 'aguardando_analise_tecnica' }, { actorEmail: E.biz, role: 'business', action: 'test.window' });
      const dec = await call(repo, 'apr', 'POST', decPath(reqId), { decision: 'approved', justification: 'ok' });
      expect(dec.status).toBe(409);
      expect(dec.body).toMatchObject({ error: 'approval_stale' });
      expect((await repo.get(p.id))?.status).toBe('aguardando_analise_tecnica'); // NÃO sobrescrito por pronto_para_emissao
      expect((await repo.getApprovalRequest(reqId))?.status).toBe('pending');
    });

    it('janela: versão defasada com estado ainda em espera ⇒ 409 approval_stale', async () => {
      const repo = await factory();
      const p = await world(repo, 'aprovado_tecnicamente');
      const r = await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'excecao_comercial', justification: 'j', version: p.version });
      const reqId = (r.body as { request: { id: string } }).request.id;
      const cur = (await repo.get(p.id))!;
      await repo.update(p.id, cur.version, {}, { actorEmail: E.biz, role: 'business', action: 'test.bump' });
      expect((await call(repo, 'apr', 'POST', decPath(reqId), { decision: 'approved', justification: 'ok' })).body).toMatchObject({ error: 'approval_stale' });
    });

    it('reatribuição de dono com pendência não torna a decisão obsoleta', async () => {
      const repo = await factory();
      const p = await world(repo, 'aprovado_tecnicamente');
      await repo.setAssignment('biz.b@minu.co', 'business', 'seed');
      const r = await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'excecao_comercial', justification: 'j', version: p.version });
      const reqId = (r.body as { request: { id: string } }).request.id;
      await repo.reassignOwner(p.id, 'biz.b@minu.co', E.adm);
      const dec = await call(repo, 'apr', 'POST', decPath(reqId), { decision: 'approved', justification: 'ok' });
      expect(dec.status).toBe(201);
      expect((await repo.get(p.id))?.status).toBe('aprovado_tecnicamente');
    });
  });

  describe(`G-025 [${label}] — proposta emitida é imutável`, () => {
    it('PUT comercial e técnico em `emitido` ⇒ 409 proposal_issued_immutable (nada muda)', async () => {
      const repo = await factory();
      const p = await world(repo, 'emitido');
      const c = await call(repo, 'biz', 'PUT', `/api/proposals/${p.id}/commercial`, { version: p.version, commercial: { negotiation: { extraDiscount: 0.5 } } });
      expect(c.status).toBe(409);
      expect(c.body).toMatchObject({ error: 'proposal_issued_immutable' });
      const t = await call(repo, 'tech', 'PUT', `/api/proposals/${p.id}/technical`, { version: p.version, technical: { implementationHours: 1 } });
      expect(t.status).toBe(409);
      expect(t.body).toMatchObject({ error: 'proposal_issued_immutable' });
      expect(await repo.get(p.id)).toEqual(p);
    });
  });

  describe(`G-027 [${label}] — justificativa só com invisíveis`, () => {
    for (const bad of ['\u200b', ' \u200c\u200d\uFEFF ', '\u0007\u0000', '\u2060', ' \n\t ']) {
      it(`solicitação com ${JSON.stringify(bad)} ⇒ 400 justification_required`, async () => {
        const repo = await factory();
        const p = await world(repo, 'em_analise_tecnica');
        const out = await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'excecao_comercial', justification: bad, version: p.version });
        expect(out.status).toBe(400);
        expect(out.body).toMatchObject({ error: 'justification_required' });
      });
    }
    it('rejeição com justificativa invisível ⇒ 400', async () => {
      const repo = await factory();
      const p = await world(repo, 'em_analise_tecnica');
      const r = await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'excecao_comercial', justification: 'j', version: p.version });
      const reqId = (r.body as { request: { id: string } }).request.id;
      expect((await call(repo, 'apr', 'POST', decPath(reqId), { decision: 'rejected', justification: '\u200b' })).status).toBe(400);
    });
  });
}

describe('G-027 — checkText', () => {
  it('apara invisíveis das pontas, remove controles internos e preserva ZWJ de emoji', () => {
    expect(checkText('\u200b ok \uFEFF', 'f')).toEqual({ ok: true, value: 'ok' });
    expect(checkText('a\u0007b', 'f')).toEqual({ ok: true, value: 'ab' });
    expect(checkText('👨‍👩‍👧', 'f')).toEqual({ ok: true, value: '👨‍👩‍👧' });
    expect(checkText('\u200b\u200c', 'f')).toEqual({ ok: true, value: '' });
  });
});

describe('G-024 — atomicidade (sqlite): falha na auditoria de invalidação reverte a edição inteira', () => {
  it('trigger sabotador em approval_request.invalidated ⇒ proposta, solicitação e auditoria inalteradas', async () => {
    const d = tmp();
    const repo = await createSqliteRepository(d);
    const p = await world(repo, 'aprovado_tecnicamente');
    const r = await call(repo, 'tech', 'POST', reqPath(p.id), { kind: 'replanejamento_sla', justification: 'j', version: p.version });
    const reqId = (r.body as { request: { id: string } }).request.id;
    type Raw = { exec(s: string): void };
    const raw = new (createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (f: string) => Raw }).DatabaseSync(join(d, 'bondly.db'));
    raw.exec(`CREATE TRIGGER sabota BEFORE INSERT ON audit WHEN NEW.action LIKE 'approval_request.invalidated.%' BEGIN SELECT RAISE(ABORT, 'x'); END;`);
    const before = (await repo.get(p.id))!;
    const auditBefore = (await repo.audit(p.id)).length;
    await expect(call(repo, 'biz', 'PUT', `/api/proposals/${p.id}/commercial`, { version: before.version, commercial: { volume: { users: 10 }, negotiation: { extraDiscount: 0.4 } } })).rejects.toThrow();
    expect(await repo.get(p.id)).toEqual(before);
    expect((await repo.getApprovalRequest(reqId))?.status).toBe('pending');
    expect((await repo.audit(p.id)).length).toBe(auditBefore);
    raw.exec('DROP TRIGGER sabota');
    expect((await call(repo, 'biz', 'PUT', `/api/proposals/${p.id}/commercial`, { version: before.version, commercial: { volume: { users: 10 }, negotiation: { extraDiscount: 0.4 } } })).status).toBe(200);
  });
});

type Raw = { exec(s: string): void; prepare(s: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): Record<string, unknown> | undefined; all(...a: unknown[]): Record<string, unknown>[] } };
const openRaw = (d: string): Raw => new (createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (f: string) => Raw }).DatabaseSync(join(d, 'bondly.db'));

describe('G-028 — append-only em audit e REPLACE inócuo (sqlite)', () => {
  it('UPDATE/DELETE/INSERT OR REPLACE abortam em audit, owner_audit, assignment_audit e approval_requests', async () => {
    const d = tmp();
    const repo = await createSqliteRepository(d);
    const p = await world(repo, 'aprovado_tecnicamente');
    await repo.setAssignment('biz.b@minu.co', 'business', E.adm);
    await repo.reassignOwner(p.id, 'biz.b@minu.co', E.adm);
    const r = await call(repo, 'tech', 'POST', reqPath(p.id), { kind: 'replanejamento_sla', justification: 'j', version: await ver(repo, p.id) });
    const reqId = (r.body as { request: { id: string } }).request.id;
    await call(repo, 'apr', 'POST', decPath(reqId), { decision: 'approved', justification: 'ok' });
    const raw = openRaw(d);
    raw.exec('PRAGMA recursive_triggers = ON');
    const a = raw.prepare(`SELECT * FROM audit LIMIT 1`).get()!;
    expect(() => raw.prepare(`UPDATE audit SET note = 'x' WHERE id = ?`).run(a.id)).toThrow(/append-only/);
    expect(() => raw.prepare(`DELETE FROM audit WHERE id = ?`).run(a.id)).toThrow(/append-only/);
    expect(() => raw.prepare(`INSERT OR REPLACE INTO audit (id, proposal_id, actor_email, role, action, at) VALUES (?, 'x', 'x', 'x', 'forjada', 'x')`).run(a.id)).toThrow(/append-only/);
    const o = raw.prepare(`SELECT * FROM owner_audit LIMIT 1`).get()!;
    expect(() => raw.prepare(`INSERT OR REPLACE INTO owner_audit (id, proposal_id, actor_email, from_owner, to_owner, at) VALUES (?, 'x', 'x', 'x', 'x', 'x')`).run(o.id)).toThrow(/append-only/);
    const g = raw.prepare(`SELECT * FROM assignment_audit LIMIT 1`).get()!;
    expect(() => raw.prepare(`INSERT OR REPLACE INTO assignment_audit (id, target_email, actor_email, at) VALUES (?, 'x', 'x', 'x')`).run(g.id)).toThrow(/append-only/);
    expect(() => raw.prepare(
      `INSERT OR REPLACE INTO approval_requests (id, proposal_id, kind, status, requested_by, requested_by_role, justification, proposal_version, previous_state, created_at)
       VALUES (?, 'x', 'excecao_comercial', 'pending', 'x', 'business', 'forjada', 1, 'x', 'x')`,
    ).run(reqId)).toThrow(/append-only/);
    expect((await repo.getApprovalRequest(reqId))?.status).toBe('approved');
    expect((await repo.getApprovalRequest(reqId))?.justification).toBe('j');
  });

  it('migração aditiva em banco ANTERIOR (sem triggers de audit): preserva linhas e passa a abortar', async () => {
    const d = tmp();
    const old = openRaw(d);
    old.exec(`CREATE TABLE proposals (id TEXT PRIMARY KEY, version INTEGER NOT NULL, status TEXT NOT NULL, owner_email TEXT NOT NULL, commercial TEXT NOT NULL, technical TEXT, snapshot TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE audit (id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, actor_email TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL, from_state TEXT, to_state TEXT, note TEXT, at TEXT NOT NULL);
      CREATE TABLE seq (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
      INSERT INTO audit VALUES ('legacy-1','P1','a@minu.co','business','proposal.create',NULL,NULL,NULL,'2027-01-01');`);
    old.exec('PRAGMA journal_mode = DELETE');
    const repo = await createSqliteRepository(d);
    await repo.nextSequence();
    await repo.nextSequence(); // reabertura idempotente
    await createSqliteRepository(d);
    const raw = openRaw(d);
    expect(raw.prepare(`SELECT id FROM audit WHERE id = 'legacy-1'`).get()).toBeTruthy();
    expect(() => raw.prepare(`UPDATE audit SET note = 'x' WHERE id = 'legacy-1'`).run()).toThrow(/append-only/);
    expect(() => raw.prepare(`DELETE FROM audit WHERE id = 'legacy-1'`).run()).toThrow(/append-only/);
    expect(() => raw.prepare(`INSERT OR REPLACE INTO audit (id, proposal_id, actor_email, role, action, at) VALUES ('legacy-1','x','x','x','forjada','x')`).run()).toThrow(/append-only/);
  });
});

describe('G-029 — SQLite ocupado ⇒ 503 claro', () => {
  it('lock persistente (outro writer) ⇒ 503 storage_busy após busy_timeout curto + retry limitado', async () => {
    const d = tmp();
    const repo = await createSqliteRepository(d, undefined, { busyTimeoutMs: 40, busyRetries: 1 });
    await repo.setAssignment(E.biz, 'business', 'seed');
    const blocker = openRaw(d);
    blocker.exec('BEGIN IMMEDIATE');
    try {
      const t0 = Date.now();
      const out = await call(repo, 'biz', 'POST', '/api/proposals', { commercial: {} });
      expect(out.status).toBe(503);
      expect(out.body).toEqual({ error: 'storage_busy' });
      expect(Date.now() - t0).toBeLessThan(3000);
    } finally {
      blocker.exec('ROLLBACK');
    }
    expect((await call(repo, 'biz', 'POST', '/api/proposals', { commercial: {} })).status).toBe(201);
  });
});

describe('G-030 — heurística de SESSION_SECRET', () => {
  it('rejeita sequências, teclado, dicionário, baixa entropia e poucos distintos', () => {
    expect(weakSecretReason('abcdefghijklmnopqrstuvwxyz012345')).toBe('sequential_pattern');
    expect(weakSecretReason('qwertyuiopasdfghjklzxcvbnm123456')).not.toBeNull();
    expect(weakSecretReason('Password1234567890Password123456')).not.toBeNull();
    expect(weakSecretReason('aB3dE6gH9jK2mN5pQ8sT1vW4yZ7xC0fL')).toBeNull(); // 32 distintos, sem run > 5
    expect(weakSecretReason('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).not.toBeNull(); // 12 distintos
    expect(weakSecretReason('x'.repeat(40))).toBe('trivial_entropy');
    expect(weakSecretReason('A'.repeat(20) + 'bcdefghijklmnopqr')).not.toBeNull(); // baixa entropia / sequência
    expect(weakSecretReason('abc123ABC!'.repeat(4))).not.toBeNull();
    expect(weakSecretReason('curto')).toBe('too_short');
    expect(weakSecretReason(DEV_SESSION_SECRET)).toBe('dev_default');
  });
  it('aceita base64url de 48 bytes e o formato do generateValue do Render (256 bits base64)', () => {
    for (let i = 0; i < 500; i++) {
      expect(weakSecretReason(randomBytes(48).toString('base64url'))).toBeNull();
      expect(weakSecretReason(randomBytes(32).toString('base64'))).toBeNull();
    }
  });
  it('produção recusa sequência no boot (loadConfig), sem vazar o valor', () => {
    const v = 'abcdefghijklmnopqrstuvwxyz012345';
    const env = { NODE_ENV: 'production', SESSION_SECRET: v, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'segredo-real-qualquer', PUBLIC_URL: 'https://x.example' } as NodeJS.ProcessEnv;
    expect(() => loadConfig(env)).toThrow(/weak_secret: SESSION_SECRET/);
    try { loadConfig(env); } catch (e) { expect((e as Error).message).not.toContain(v); }
  });
});
