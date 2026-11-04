/**
 * G-026 (fechado no servidor, G-001-A Fase 2) — consolidar/emitir consultam a política: margem abaixo do piso exige
 * exceção comercial APROVADA e não invalidada. Alerta calculado dos inputs PERSISTIDOS, nunca de flag do cliente.
 * Roda em memória E em SQLite real.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryRepository } from './memoryRepository.js';
import { createSqliteRepository } from './sqliteRepository.js';
import { handleApi, type ApiResult } from './api.js';
import { emissionGate, evaluateProposalPolicy } from './pricingQuote.js';
import { baseInput, lowMarginInput } from './quoteFixtures.js';
import type { ProposalRepository, WorkflowState, ApprovalRequest } from './domain.js';
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';
import type { Role } from './rbac.js';

const mkCfg = (strict = false) => ({ legacyProfileCodes: false, profileCodeHashes: {}, pricingGuardStrict: strict }) as unknown as ServerConfig;
const E = { biz: 'biz.a@minu.co', tech: 'tec@minu.co', apr: 'apr@minu.co', adm: 'adm@minu.co' } as const;
type Who = keyof typeof E;
const ROLE_OF: Record<Who, Role> = { biz: 'business', tech: 'tech', apr: 'approver', adm: 'admin' };
const sess = (email: string): SessionData => ({ email, domain: 'minu.co', exp: Math.floor(Date.now() / 1000) + 3600 });
const J = (x: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(x));

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const factories: [string, () => Promise<ProposalRepository>][] = [
  ['memória', async () => createMemoryRepository()],
  ['sqlite', async () => {
    const d = mkdtempSync(join(tmpdir(), 'bondly-g026-'));
    dirs.push(d);
    return createSqliteRepository(d);
  }],
];

async function world(repo: ProposalRepository, commercial: Record<string, unknown>, status: WorkflowState) {
  for (const w of Object.keys(E) as Who[]) await repo.setAssignment(E[w], ROLE_OF[w], 'seed');
  const id = `BONDLY-2027-${String(await repo.nextSequence()).padStart(6, '0')}`;
  const base = { actorEmail: E.biz, role: 'business' as Role };
  const p = await repo.create({ id, ownerEmail: E.biz, commercial }, { ...base, action: 'proposal.create' });
  await repo.update(id, p.version, { status }, { ...base, action: 'test.setup' });
  return id;
}

for (const [label, factory] of factories) {
  describe(`G-026 — bloqueio de consolidação/emissão [${label}]`, () => {
    const call = (repo: ProposalRepository, who: Who, method: string, path: string, body: unknown = null, strict = false): Promise<ApiResult> =>
      handleApi({ method, path, session: sess(E[who]), body, repo, cfg: mkCfg(strict) });
    const ver = async (repo: ProposalRepository, id: string) => (await repo.get(id))!.version;
    const trans = async (repo: ProposalRepository, who: Who, id: string, transition: string, extra: Record<string, unknown> = {}, strict = false) =>
      call(repo, who, 'POST', `/api/proposals/${id}/transition`, { version: await ver(repo, id), transition, ...extra }, strict);
    const requestExc = async (repo: ProposalRepository, id: string, kind = 'excecao_comercial') => {
      const r = await call(repo, 'biz', 'POST', `/api/proposals/${id}/approval-requests`, { kind, justification: 'cliente estratégico', version: await ver(repo, id) });
      expect(r.status).toBe(201);
      return (r.body as { request: { id: string } }).request.id;
    };
    const decide = (repo: ProposalRepository, reqId: string, decision: 'approved' | 'rejected') =>
      call(repo, 'apr', 'POST', `/api/approval-requests/${reqId}/decision`, { decision, justification: 'ok' });

    it('SEM exceção: consolidar ⇒ 409 approval_required; estado intacto; margem saudável passa', async () => {
      const repo = await factory();
      const id = await world(repo, J(lowMarginInput()), 'aprovado_tecnicamente');
      const r = await trans(repo, 'biz', id, 'consolidar');
      expect(r).toMatchObject({ status: 409, body: { error: 'approval_required', requiredApproval: 'excecao_comercial' } });
      expect((await repo.get(id))?.status).toBe('aprovado_tecnicamente');
      const ok = await world(repo, J(baseInput()), 'aprovado_tecnicamente');
      expect((await trans(repo, 'biz', ok, 'consolidar')).status).toBe(200);
    });

    it('flag do cliente é ignorada: o alerta vem dos inputs persistidos', async () => {
      const repo = await factory();
      const id = await world(repo, J(lowMarginInput()), 'aprovado_tecnicamente');
      const r = await trans(repo, 'biz', id, 'consolidar', { requiresApproval: false, approved: true, marginStatus: 'SAUDÁVEL' });
      expect(r.status).toBe(409);
    });

    it('emitir também é protegido (defesa em profundidade: pronto_para_emissao sem exceção)', async () => {
      const repo = await factory();
      const id = await world(repo, J(lowMarginInput()), 'pronto_para_emissao');
      expect(await trans(repo, 'biz', id, 'emitir')).toMatchObject({ status: 409, body: { error: 'approval_required' } });
      expect((await repo.get(id))?.status).toBe('pronto_para_emissao');
    });

    it('exceção REJEITADA bloqueia; nova solicitação APROVADA libera consolidar e emitir', async () => {
      const repo = await factory();
      const id = await world(repo, J(lowMarginInput()), 'aprovado_tecnicamente');
      const r1 = await requestExc(repo, id);
      expect((await trans(repo, 'biz', id, 'consolidar')).status).toBe(409); // PENDENTE: estado de espera
      expect((await decide(repo, r1, 'rejected')).status).toBe(201);
      expect(await trans(repo, 'biz', id, 'consolidar')).toMatchObject({ status: 409, body: { error: 'approval_required' } });
      const r2 = await requestExc(repo, id);
      expect((await decide(repo, r2, 'approved')).status).toBe(201);
      expect((await trans(repo, 'biz', id, 'consolidar')).status).toBe(200);
      expect((await repo.get(id))?.status).toBe('pronto_para_emissao');
      expect((await trans(repo, 'biz', id, 'emitir')).status).toBe(200);
      expect((await repo.get(id))?.status).toBe('emitido');
    });

    it('outro tipo aprovado (alteracao_escopo) NÃO substitui a exceção comercial', async () => {
      const repo = await factory();
      const id = await world(repo, J(lowMarginInput()), 'aprovado_tecnicamente');
      const r = await requestExc(repo, id, 'alteracao_escopo');
      expect((await decide(repo, r, 'approved')).status).toBe(201);
      expect((await trans(repo, 'biz', id, 'consolidar')).status).toBe(409);
    });

    it('MUDANÇA MATERIAL invalida a aprovação e volta a bloquear', async () => {
      const repo = await factory();
      const id = await world(repo, J(lowMarginInput()), 'aprovado_tecnicamente');
      const r = await requestExc(repo, id);
      expect((await decide(repo, r, 'approved')).status).toBe(201);
      const next = J(lowMarginInput()) as { negotiation: Record<string, unknown> };
      next.negotiation.extraDiscount = 0.62; // material
      expect((await call(repo, 'biz', 'PUT', `/api/proposals/${id}/commercial`, { version: await ver(repo, id), commercial: next })).status).toBe(200);
      expect((await repo.getApprovalRequest(r))?.status).toBe('invalidated');
      // volta pela esteira (reanálise) até poder consolidar de novo
      expect((await trans(repo, 'tech', id, 'iniciar_analise')).status).toBe(200);
      expect((await trans(repo, 'tech', id, 'aprovar_tecnico')).status).toBe(200);
      expect(await trans(repo, 'biz', id, 'consolidar')).toMatchObject({ status: 409, body: { error: 'approval_required' } });
    });

    it('edição NÃO material depois da aprovação também exige nova exceção (a margem pode ter mudado)', async () => {
      const repo = await factory();
      const id = await world(repo, J(lowMarginInput()), 'aprovado_tecnicamente');
      const r = await requestExc(repo, id);
      expect((await decide(repo, r, 'approved')).status).toBe(201);
      const next = J(lowMarginInput()) as { volume: Record<string, unknown> };
      next.volume.mauPct = 0.5; // fora das chaves materiais
      expect((await call(repo, 'biz', 'PUT', `/api/proposals/${id}/commercial`, { version: await ver(repo, id), commercial: next })).status).toBe(200);
      expect((await repo.getApprovalRequest(r))?.status).toBe('approved'); // não invalidada…
      expect((await trans(repo, 'biz', id, 'consolidar')).status).toBe(409); // …mas não vale para a versão editada
    });

    it('perfis: só business transiciona; tech/approver/admin ⇒ 403 antes da política', async () => {
      const repo = await factory();
      const id = await world(repo, J(lowMarginInput()), 'aprovado_tecnicamente');
      for (const w of ['tech', 'apr', 'adm'] as Who[]) expect((await trans(repo, w, id, 'consolidar')).status).toBe(403);
    });

    it('inputs legados ({}): libera por padrão; PRICING_GUARD_STRICT bloqueia (fail-closed)', async () => {
      const repo = await factory();
      const id = await world(repo, {}, 'aprovado_tecnicamente');
      expect(await trans(repo, 'biz', id, 'consolidar', {}, true)).toMatchObject({ status: 409, body: { error: 'pricing_inputs_incomplete' } });
      expect((await trans(repo, 'biz', id, 'consolidar', {}, false)).status).toBe(200);
    });
  });
}

describe('emissionGate — função pura', () => {
  const req = (status: ApprovalRequest['status'], kind: ApprovalRequest['kind'] = 'excecao_comercial', createdAt = '2027-01-01T00:00:00.000Z') =>
    ({ id: 'r', proposalId: 'p', kind, status, createdAt }) as unknown as ApprovalRequest;
  const low = J(lowMarginInput());
  const approvedAudit = [{ action: 'approval_request.approved.excecao_comercial' }];
  it('avalia política dos inputs persistidos', () => {
    expect(evaluateProposalPolicy(low)).toEqual({ evaluable: true, alert: { level: 'below_floor', requiresApproval: true } });
    expect(evaluateProposalPolicy(J(baseInput()))).toMatchObject({ evaluable: true, alert: { requiresApproval: false } });
    expect(evaluateProposalPolicy({})).toEqual({ evaluable: false });
    expect(evaluateProposalPolicy({ volume: { users: NaN } })).toEqual({ evaluable: false });
  });
  it('tabela de decisão', () => {
    const g = (requests: ApprovalRequest[], audit: { action: string }[], commercial = low) => emissionGate({ commercial, requests, audit });
    expect(g([], []).ok).toBe(false);
    expect(g([req('pending')], []).ok).toBe(false);
    expect(g([req('rejected')], []).ok).toBe(false);
    expect(g([req('invalidated')], approvedAudit).ok).toBe(false);
    expect(g([req('approved', 'alteracao_escopo')], approvedAudit).ok).toBe(false);
    expect(g([req('approved')], approvedAudit).ok).toBe(true);
    expect(g([req('approved')], [...approvedAudit, { action: 'proposal.edit_commercial' }]).ok).toBe(false);
    expect(g([req('approved')], [{ action: 'proposal.edit_commercial' }, ...approvedAudit]).ok).toBe(true);
    // a ÚLTIMA solicitação manda: rejeitada depois de uma aprovada antiga bloqueia
    expect(g([req('approved'), req('rejected', 'excecao_comercial', '2027-02-01T00:00:00.000Z')], approvedAudit).ok).toBe(false);
    expect(g([], [], J(baseInput()))).toEqual({ ok: true });
  });
});
