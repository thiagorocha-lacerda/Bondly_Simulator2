/**
 * G-006 — Gestor/Aprovador funcional: tabela pura de estados, matriz RBAC (4 papéis × 3 ações novas), API
 * (memória E SQLite real), separação de funções, escopo G-002, idempotência, invalidação, SLA intocado, auditoria atômica.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reduceSla, defaultSlaConfig, buildHolidaySet, type SlaEvent } from '@bondly/pricing-engine';
import { createMemoryRepository } from './memoryRepository.js';
import { createSqliteRepository } from './sqliteRepository.js';
import { handleApi, type ApiResult } from './api.js';
import { can, ROLES, type Role } from './rbac.js';
import { APPROVAL_KINDS, type ProposalRepository, type WorkflowState, type ApprovalKind } from './domain.js';
import { canRequestApproval, canTransition, resolveApprovalState, kindsInvalidatedBy, violatesSeparationOfDuties, APPROVAL_REQUEST_FROM, AWAITING_APPROVAL } from './workflow.js';
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';

const cfg = { legacyProfileCodes: false, profileCodeHashes: {} } as unknown as ServerConfig;
const E = { biz: 'biz.a@minu.co', biz2: 'biz.b@minu.co', tech: 'tec@minu.co', apr: 'apr@minu.co', apr2: 'apr2@minu.co', adm: 'adm@minu.co' } as const;
type Who = keyof typeof E;
const ROLE_OF: Record<Who, Role> = { biz: 'business', biz2: 'business', tech: 'tech', apr: 'approver', apr2: 'approver', adm: 'admin' };
const sess = (email: string): SessionData => ({ email, domain: 'minu.co', exp: Math.floor(Date.now() / 1000) + 3600 });
const call = (repo: ProposalRepository, who: Who, method: string, path: string, body: unknown = null): Promise<ApiResult> =>
  handleApi({ method, path, session: sess(E[who]), body, repo, cfg });

describe('G-006 — tabela pura de estados', () => {
  it('estado novo é alvo SÓ de canRequestApproval; nenhuma transição comum parte dele', () => {
    const all: WorkflowState[] = ['rascunho_comercial', 'aguardando_analise_tecnica', 'em_analise_tecnica', 'ajustes_solicitados', 'aprovado_tecnicamente', 'reprovado', 'pronto_para_emissao', 'emitido', AWAITING_APPROVAL];
    for (const name of ['submeter_analise', 'iniciar_analise', 'solicitar_ajustes', 'aprovar_tecnico', 'reprovar', 'consolidar', 'emitir', 'retomar']) {
      for (const role of ROLES) expect(canTransition(AWAITING_APPROVAL, name, role).ok).toBe(false);
    }
    for (const from of all) {
      const ok = canRequestApproval(from, 'excecao_comercial', 'business');
      expect(ok.ok).toBe(APPROVAL_REQUEST_FROM.includes(from));
      if (ok.ok) expect(ok.to).toBe(AWAITING_APPROVAL);
    }
    expect(APPROVAL_REQUEST_FROM).not.toContain('rascunho_comercial');
  });
  it('papel × tipo (deny-by-default)', () => {
    const allowed: Record<ApprovalKind, Role[]> = { excecao_comercial: ['business'], alteracao_escopo: ['business'], replanejamento_sla: ['tech'] };
    for (const k of APPROVAL_KINDS) for (const r of [...ROLES, undefined]) expect(canRequestApproval('em_analise_tecnica', k, r).ok).toBe(!!r && allowed[k].includes(r));
  });
  it('resolução volta ao estado anterior; invalidação por tipo de edição', () => {
    expect(resolveApprovalState('pronto_para_emissao')).toBe('pronto_para_emissao');
    expect(kindsInvalidatedBy('commercial')).toEqual(['excecao_comercial', 'alteracao_escopo']);
    expect(kindsInvalidatedBy('technical')).toEqual(['alteracao_escopo', 'replanejamento_sla']);
  });
  it('separação de funções (guard puro; normaliza caixa/espaço)', () => {
    expect(violatesSeparationOfDuties('a@minu.co', ' A@Minu.co ')).toBe(true);
    expect(violatesSeparationOfDuties('a@minu.co', 'b@minu.co')).toBe(false);
  });
});

describe('G-006 — matriz RBAC exaustiva: 4 papéis × {request, decide, read_queue}', () => {
  const EXP: Record<Role, { request: boolean; decide: boolean; read_queue: boolean }> = {
    business: { request: true, decide: false, read_queue: false },
    tech: { request: true, decide: false, read_queue: false },
    approver: { request: false, decide: true, read_queue: true },
    admin: { request: false, decide: false, read_queue: false },
  };
  for (const role of ROLES) {
    for (const a of ['request', 'decide', 'read_queue'] as const) {
      it(`${role} × approval.${a} → ${EXP[role][a] ? 'permite' : 'nega'}`, () => expect(can(role, `approval.${a}`)).toBe(EXP[role][a]));
    }
  }
  it('papel indefinido nega tudo', () => {
    for (const a of ['request', 'decide', 'read_queue'] as const) expect(can(undefined, `approval.${a}`)).toBe(false);
  });
});

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const factories: [string, () => Promise<ProposalRepository>][] = [
  ['memória', async () => createMemoryRepository()],
  [
    'sqlite',
    async () => {
      const d = mkdtempSync(join(tmpdir(), 'bondly-g006-'));
      dirs.push(d);
      return createSqliteRepository(d);
    },
  ],
];

async function world(repo: ProposalRepository, status: WorkflowState = 'em_analise_tecnica') {
  for (const w of Object.keys(E) as Who[]) await repo.setAssignment(E[w], ROLE_OF[w], 'seed');
  const id = `BONDLY-2027-${String(await repo.nextSequence()).padStart(6, '0')}`;
  const base = { actorEmail: E.biz, role: 'business' as Role };
  let p = await repo.create({ id, ownerEmail: E.biz, commercial: { volume: { users: 10 } } }, { ...base, action: 'proposal.create' });
  p = await repo.update(id, p.version, { status }, { ...base, action: 'test.setup' });
  await repo.appendSlaEvent({ proposalId: id, kind: 'started', at: Date.parse('2027-03-01T12:00:00Z'), by: E.biz, payload: { briefingVersion: 1 } });
  return p;
}
const reqPath = (id: string) => `/api/proposals/${id}/approval-requests`;
const decPath = (id: string) => `/api/approval-requests/${id}/decision`;
type Id = { request: { id: string; proposalVersion: number } };

for (const [label, factory] of factories) {
  describe(`G-006 — API [${label}]`, () => {
    it('fluxo feliz: solicita ⇒ aguardando; fila; aprova ⇒ estado anterior; auditoria; SLA idêntico', async () => {
      const repo = await factory();
      const p = await world(repo, 'aprovado_tecnicamente');
      const slaBefore = await repo.slaEvents(p.id);
      const created = await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'excecao_comercial', justification: 'cliente estratégico', version: p.version });
      expect(created.status).toBe(201);
      const r = (created.body as Id).request;
      expect(r.proposalVersion).toBe(p.version);
      expect((await repo.get(p.id))?.status).toBe('aguardando_aprovacao_gestor');
      expect((await call(repo, 'biz', 'POST', `/api/proposals/${p.id}/transition`, { version: p.version + 1, transition: 'consolidar' })).status).toBe(409);
      const q = await call(repo, 'apr', 'GET', '/api/approvals/pending');
      expect(q.status).toBe(200);
      const items = (q.body as { requests: Record<string, unknown>[] }).requests;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ kind: 'excecao_comercial', kindLabel: 'Exceção comercial', requestedBy: E.biz, justification: 'cliente estratégico', proposalId: p.id });
      expect(JSON.stringify(items)).not.toMatch(/margin|margem|cost|custo|commercial|technical|volume/i);
      expect((await call(repo, 'apr', 'POST', decPath(r.id), { decision: 'approved', justification: 'ok' })).status).toBe(201);
      expect((await repo.get(p.id))?.status).toBe('aprovado_tecnicamente');
      const saved = await repo.getApprovalRequest(r.id);
      expect(saved).toMatchObject({ status: 'approved', decidedBy: E.apr, decisionJustification: 'ok' });
      expect(saved?.decidedProposalVersion).toBe((await repo.get(p.id))!.version);
      const acts = (await repo.audit(p.id)).map((a) => a.action);
      expect(acts).toContain('approval_request.requested.excecao_comercial');
      expect(acts).toContain('approval_request.approved.excecao_comercial');
      const slaAfter = await repo.slaEvents(p.id);
      expect(slaAfter).toEqual(slaBefore);
      const cfgSla = defaultSlaConfig(buildHolidaySet());
      const ev = (rows: typeof slaAfter): SlaEvent[] => rows.map((x) => ({ kind: 'started', at: x.at, by: x.by, briefingVersion: 1 }));
      const T = Date.parse('2027-03-04T15:00:00Z');
      expect(reduceSla(ev(slaAfter), T, cfgSla)).toEqual(reduceSla(ev(slaBefore), T, cfgSla));
      expect(((await call(repo, 'apr', 'GET', '/api/approvals/pending')).body as { requests: unknown[] }).requests).toHaveLength(0);
    });

    it('rejeição exige justificativa; idempotência 200; divergente 409', async () => {
      const repo = await factory();
      const p = await world(repo);
      const r = (await call(repo, 'tech', 'POST', reqPath(p.id), { kind: 'replanejamento_sla', justification: 'escopo cresceu', version: p.version })).body as Id;
      expect((await call(repo, 'apr', 'POST', decPath(r.request.id), { decision: 'rejected' })).status).toBe(400);
      expect((await call(repo, 'apr', 'POST', decPath(r.request.id), { decision: 'rejected', justification: 'sem base' })).status).toBe(201);
      expect((await repo.get(p.id))?.status).toBe('em_analise_tecnica');
      const again = await call(repo, 'apr2', 'POST', decPath(r.request.id), { decision: 'rejected', justification: 'sem base' });
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ idempotent: true });
      const conflict = await call(repo, 'apr2', 'POST', decPath(r.request.id), { decision: 'approved' });
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({ error: 'decision_conflict', existing: 'rejected' });
      expect((await repo.audit(p.id)).filter((a) => a.action.startsWith('approval_request.rejected')).length).toBe(1);
    });

    it('SEPARAÇÃO DE FUNÇÕES: solicitante não decide a própria; admin/tech/business não decidem', async () => {
      const repo = await factory();
      const p = await world(repo);
      const r = (await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'alteracao_escopo', justification: 'x', version: p.version })).body as Id;
      await repo.setAssignment(E.biz, 'approver', 'seed'); // solicitante promovido a aprovador continua barrado
      const self = await call(repo, 'biz', 'POST', decPath(r.request.id), { decision: 'approved', justification: 'eu mesmo' });
      expect(self.status).toBe(403);
      expect(self.body).toEqual({ error: 'self_decision_forbidden' });
      for (const w of ['adm', 'tech', 'biz2'] as Who[]) expect((await call(repo, w, 'POST', decPath(r.request.id), { decision: 'approved', justification: 'x' })).status).toBe(403);
      expect((await repo.getApprovalRequest(r.request.id))?.status).toBe('pending');
      expect((await repo.get(p.id))?.status).toBe('aguardando_aprovacao_gestor');
      expect((await call(repo, 'apr', 'POST', decPath(r.request.id), { decision: 'approved', justification: 'ok' })).status).toBe(201);
    });

    it('quem solicita: papel×tipo, só próprias, estados elegíveis, validações', async () => {
      const repo = await factory();
      const p = await world(repo);
      const ok = { kind: 'excecao_comercial', justification: 'j', version: p.version };
      expect((await call(repo, 'tech', 'POST', reqPath(p.id), ok)).status).toBe(403);
      expect((await call(repo, 'biz', 'POST', reqPath(p.id), { ...ok, kind: 'replanejamento_sla' })).status).toBe(403);
      for (const w of ['apr', 'adm'] as Who[]) expect((await call(repo, w, 'POST', reqPath(p.id), ok)).status).toBe(403);
      expect((await call(repo, 'biz2', 'POST', reqPath(p.id), ok)).status).toBe(404);
      expect((await call(repo, 'biz', 'POST', reqPath('BONDLY-2027-999999'), ok)).status).toBe(404);
      expect((await call(repo, 'biz', 'POST', reqPath(p.id), { ...ok, kind: 'x' })).body).toEqual({ error: 'invalid_kind' });
      expect((await call(repo, 'biz', 'POST', reqPath(p.id), { ...ok, justification: '   ' })).body).toEqual({ error: 'justification_required' });
      expect((await call(repo, 'biz', 'POST', reqPath(p.id), { ...ok, justification: 'x'.repeat(501) })).status).toBe(400);
      expect((await call(repo, 'biz', 'POST', reqPath(p.id), { ...ok, version: undefined })).status).toBe(400);
      expect((await call(repo, 'biz', 'POST', reqPath(p.id), { ...ok, version: 99 })).status).toBe(409);
      expect((await repo.get(p.id))?.status).toBe('em_analise_tecnica');
      expect((await call(repo, 'biz', 'POST', reqPath(p.id), { ...ok, justification: 'x'.repeat(500) })).status).toBe(201);
      expect((await call(repo, 'tech', 'POST', reqPath(p.id), { kind: 'replanejamento_sla', justification: 'j', version: p.version + 1 })).status).toBe(409);
    });

    it('ESCOPO G-002: rascunho inelegível e invisível ao aprovador; 404 padrão', async () => {
      const repo = await factory();
      const p = await world(repo, 'rascunho_comercial');
      expect((await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'excecao_comercial', justification: 'j', version: p.version })).status).toBe(409);
      expect(((await call(repo, 'apr', 'GET', '/api/approvals/pending')).body as { requests: unknown[] }).requests).toEqual([]);
      expect((await call(repo, 'apr', 'GET', reqPath(p.id))).status).toBe(404);
      expect((await call(repo, 'apr', 'POST', decPath('inexistente'), { decision: 'approved' })).status).toBe(404);
      for (const w of ['biz', 'tech', 'adm'] as Who[]) expect((await call(repo, w, 'GET', '/api/approvals/pending')).status).toBe(403);
      // proposta com solicitação pendente que volta ao rascunho some da fila
      const id = `BONDLY-2027-${String(await repo.nextSequence()).padStart(6, '0')}`;
      let q = await repo.create({ id, ownerEmail: E.biz, commercial: {} }, { actorEmail: E.biz, role: 'business', action: 'proposal.create' });
      q = await repo.update(id, q.version, { status: 'em_analise_tecnica' }, { actorEmail: E.biz, role: 'business', action: 'test.setup' });
      expect((await call(repo, 'biz', 'POST', reqPath(id), { kind: 'alteracao_escopo', justification: 'j', version: q.version })).status).toBe(201);
      const cur = (await repo.get(id))!;
      await repo.update(id, cur.version, { status: 'rascunho_comercial' }, { actorEmail: E.biz, role: 'business', action: 'test.force' });
      expect(((await call(repo, 'apr', 'GET', '/api/approvals/pending')).body as { requests: unknown[] }).requests).toEqual([]);
    });

    it('mudança material INVALIDA só a aprovação afetada', async () => {
      const repo = await factory();
      const p = await world(repo, 'aprovado_tecnicamente');
      const a = (await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'excecao_comercial', justification: 'j', version: p.version })).body as Id;
      await call(repo, 'apr', 'POST', decPath(a.request.id), { decision: 'approved', justification: 'ok' });
      const cur = (await repo.get(p.id))!;
      const cur2 = await repo.update(p.id, cur.version, { status: 'em_analise_tecnica' }, { actorEmail: E.tech, role: 'tech', action: 'test.force' });
      const b = (await call(repo, 'tech', 'POST', reqPath(p.id), { kind: 'replanejamento_sla', justification: 'j', version: cur2.version })).body as Id;
      await call(repo, 'apr', 'POST', decPath(b.request.id), { decision: 'approved', justification: 'ok' });
      const v = (await repo.get(p.id))!;
      const edit = await call(repo, 'biz', 'PUT', `/api/proposals/${p.id}/commercial`, { version: v.version, commercial: { volume: { users: 500 } } });
      expect(edit.status).toBe(200);
      expect((edit.body as { approvalsInvalidated: number }).approvalsInvalidated).toBe(1);
      expect((await repo.getApprovalRequest(a.request.id))?.status).toBe('invalidated');
      expect((await repo.getApprovalRequest(b.request.id))?.status).toBe('approved');
      expect((await call(repo, 'apr', 'POST', decPath(a.request.id), { decision: 'approved', justification: 'x' })).body).toMatchObject({ error: 'approval_invalidated' });
      const v2 = (await repo.get(p.id))!;
      const same = await call(repo, 'biz', 'PUT', `/api/proposals/${p.id}/commercial`, { version: v2.version, commercial: { volume: { users: 500 }, nota: 'texto' } });
      expect((same.body as { approvalsInvalidated: number }).approvalsInvalidated).toBe(0);
    });

    it('mudança material com solicitação PENDENTE invalida e devolve ao estado anterior (com §5.2)', async () => {
      const repo = await factory();
      const p = await world(repo, 'pronto_para_emissao');
      const a = (await call(repo, 'biz', 'POST', reqPath(p.id), { kind: 'excecao_comercial', justification: 'j', version: p.version })).body as Id;
      const cur = (await repo.get(p.id))!;
      const edit = await call(repo, 'biz', 'PUT', `/api/proposals/${p.id}/commercial`, { version: cur.version, commercial: { volume: { users: 777 } } });
      expect(edit.status).toBe(200);
      expect((await repo.getApprovalRequest(a.request.id))?.status).toBe('invalidated');
      expect((await repo.get(p.id))?.status).toBe('aguardando_analise_tecnica');
    });

    it('auditoria na MESMA transação (rollback se falhar); decisões imutáveis — sqlite', async () => {
      if (label !== 'sqlite') return;
      const d = mkdtempSync(join(tmpdir(), 'bondly-g006tx-'));
      dirs.push(d);
      const repo = await createSqliteRepository(d);
      const p = await world(repo);
      type Raw = { exec(s: string): void; prepare(s: string): { run(...a: unknown[]): unknown } };
      const raw = new (createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (f: string) => Raw }).DatabaseSync(join(d, 'bondly.db'));
      raw.exec(`CREATE TRIGGER sabota BEFORE INSERT ON audit WHEN NEW.action LIKE 'approval_request.requested.%' BEGIN SELECT RAISE(ABORT, 'x'); END;`);
      const body = { kind: 'excecao_comercial', justification: 'j', version: p.version };
      await expect(call(repo, 'biz', 'POST', reqPath(p.id), body)).rejects.toThrow();
      expect((await repo.get(p.id))?.status).toBe('em_analise_tecnica');
      expect((await repo.get(p.id))?.version).toBe(p.version);
      expect(await repo.listApprovalRequests()).toHaveLength(0);
      raw.exec('DROP TRIGGER sabota');
      expect((await call(repo, 'biz', 'POST', reqPath(p.id), body)).status).toBe(201);
      const id = (await repo.listApprovalRequests())[0]!.id;
      await call(repo, 'apr', 'POST', decPath(id), { decision: 'approved', justification: 'ok' });
      expect(() => raw.prepare(`UPDATE approval_requests SET status='rejected' WHERE id=?`).run(id)).toThrow(/imut/);
      expect(() => raw.prepare(`DELETE FROM approval_requests WHERE id=?`).run(id)).toThrow(/append-only/);
    });
  });
}
