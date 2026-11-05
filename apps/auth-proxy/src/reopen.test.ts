/**
 * G-025 — Reabertura pós-emissão (ADR doc 22). Reabrir uma proposta `emitido` cria uma NOVA VERSÃO; a emitida
 * permanece imutável e preservada. Cobre: RBAC (só approver/admin), 409 se não-emitido, 400 sem justificativa,
 * criação da nova versão editável, imutabilidade/conteúdo da emitida, vínculo origem↔sucessora, auditoria
 * append-only, migração aditiva em banco antigo, e que a nova versão respeita G-023/G-026 ao avançar.
 * Roda em memória E em SQLite real.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryRepository } from './memoryRepository.js';
import { createSqliteRepository } from './sqliteRepository.js';
import { handleApi, type ApiResult } from './api.js';
import { baseInput, lowMarginInput } from './quoteFixtures.js';
import { REOPENED_INITIAL_STATE } from './workflow.js';
import type { ProposalRepository, WorkflowState } from './domain.js';
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';
import type { Role } from './rbac.js';

const cfg = { legacyProfileCodes: false, profileCodeHashes: {} } as unknown as ServerConfig;
const E = { biz: 'biz.a@minu.co', biz2: 'biz.b@minu.co', tech: 'tec@minu.co', apr: 'apr@minu.co', adm: 'adm@minu.co' } as const;
type Who = keyof typeof E;
const ROLE_OF: Record<Who, Role> = { biz: 'business', biz2: 'business', tech: 'tech', apr: 'approver', adm: 'admin' };
const sess = (email: string): SessionData => ({ email, domain: 'minu.co', exp: Math.floor(Date.now() / 1000) + 3600 });
const J = (x: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(x));

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const factories: [string, () => Promise<ProposalRepository>][] = [
  ['memória', async () => createMemoryRepository()],
  ['sqlite', async () => {
    const d = mkdtempSync(join(tmpdir(), 'bondly-g025-'));
    dirs.push(d);
    return createSqliteRepository(d);
  }],
];

/** Cria uma proposta já `emitido` (dono biz), com os inputs comerciais informados, via update de setup. */
async function issued(repo: ProposalRepository, commercial: Record<string, unknown>): Promise<string> {
  for (const w of Object.keys(E) as Who[]) await repo.setAssignment(E[w], ROLE_OF[w], 'seed');
  const id = `BONDLY-2027-${String(await repo.nextSequence()).padStart(6, '0')}`;
  const base = { actorEmail: E.biz, role: 'business' as Role };
  const p = await repo.create({ id, ownerEmail: E.biz, commercial }, { ...base, action: 'proposal.create' });
  await repo.update(id, p.version, { status: 'emitido', technical: { integrations: 2, implementationHours: 40 } }, { ...base, action: 'test.setup' });
  return id;
}

for (const [label, factory] of factories) {
  describe(`G-025 — reabertura pós-emissão [${label}]`, () => {
    const call = (repo: ProposalRepository, who: Who, method: string, path: string, body: unknown = null): Promise<ApiResult> =>
      handleApi({ method, path, session: sess(E[who]), body, repo, cfg });
    const ver = async (repo: ProposalRepository, id: string) => (await repo.get(id))!.version;
    const reopen = (repo: ProposalRepository, who: Who, id: string, body: unknown) =>
      call(repo, who, 'POST', `/api/proposals/${id}/reopen`, body);

    it('403: business e tech NÃO reabrem', async () => {
      const repo = await factory();
      const id = await issued(repo, J(baseInput()));
      expect((await reopen(repo, 'biz', id, { reason: 'x' })).status).toBe(403);
      expect((await reopen(repo, 'tech', id, { reason: 'x' })).status).toBe(403);
      // a emitida permanece intacta
      expect((await repo.get(id))?.status).toBe('emitido');
      expect((await repo.get(id))?.supersededBy).toBeUndefined();
    });

    it('409 not_issued: estado ≠ emitido (visível) não reabre; rascunho é 404 por escopo G-002', async () => {
      const repo = await factory();
      for (const w of Object.keys(E) as Who[]) await repo.setAssignment(E[w], ROLE_OF[w], 'seed');
      const base = { actorEmail: E.biz, role: 'business' as Role };
      // (a) estado não-emitido mas VISÍVEL ao approver (não é rascunho) ⇒ 409 not_issued
      const id1 = `BONDLY-2027-${String(await repo.nextSequence()).padStart(6, '0')}`;
      const p1 = await repo.create({ id: id1, ownerEmail: E.biz, commercial: J(baseInput()) }, { ...base, action: 'proposal.create' });
      await repo.update(id1, p1.version, { status: 'pronto_para_emissao' }, { ...base, action: 'test.setup' });
      expect(await reopen(repo, 'apr', id1, { reason: 'motivo válido' })).toMatchObject({ status: 409, body: { error: 'not_issued' } });
      // (b) rascunho_comercial é invisível ao approver (G-002) ⇒ 404, sem revelar existência
      const id2 = `BONDLY-2027-${String(await repo.nextSequence()).padStart(6, '0')}`;
      await repo.create({ id: id2, ownerEmail: E.biz, commercial: J(baseInput()) }, { ...base, action: 'proposal.create' });
      expect(await reopen(repo, 'apr', id2, { reason: 'motivo válido' })).toMatchObject({ status: 404, body: { error: 'not_found' } });
    });

    it('400: justificativa ausente / vazia / só-invisível', async () => {
      const repo = await factory();
      const id = await issued(repo, J(baseInput()));
      expect((await reopen(repo, 'apr', id, {})).body).toMatchObject({ error: 'reason_required' });
      expect((await reopen(repo, 'apr', id, { reason: '   ' })).body).toMatchObject({ error: 'reason_required' });
      expect((await reopen(repo, 'apr', id, { reason: '\u200b\u2060' })).body).toMatchObject({ error: 'reason_required' });
      expect((await reopen(repo, 'apr', id, { reason: 'a'.repeat(501) })).body).toMatchObject({ error: 'text_too_long' });
    });

    for (const who of ['apr', 'adm'] as Who[]) {
      it(`${who}: cria NOVA VERSÃO editável; emitida permanece emitido+imutável e inalterada`, async () => {
        const repo = await factory();
        const srcCommercial = J(baseInput());
        const id = await issued(repo, srcCommercial);
        const before = (await repo.get(id))!;
        const r = await reopen(repo, who, id, { reason: 'cliente pediu revisão de escopo' });
        expect(r.status).toBe(201);
        const nv = (r.body as { proposal: { id: string; status: string; version: number; ownerEmail: string; reopenedFrom?: string; commercial: unknown; technical?: unknown } }).proposal;
        // nova versão: id próprio ≠ origem, estado inicial editável, version=1, herda dono e inputs, vínculo à origem
        expect(nv.id).not.toBe(id);
        expect(nv.status).toBe(REOPENED_INITIAL_STATE);
        expect(nv.version).toBe(1);
        expect(nv.ownerEmail).toBe(E.biz); // o approver/admin NÃO vira dono
        expect(nv.reopenedFrom).toBe(id);
        expect(nv.commercial).toEqual(srcCommercial);
        // os inputs técnicos foram COPIADOS (verificado no repositório; a projeção ao approver/admin omite internos por papel)
        expect((await repo.get(nv.id))?.technical).toEqual({ integrations: 2, implementationHours: 40 });
        // nova versão NÃO herda o snapshot congelado
        expect((await repo.get(nv.id))?.snapshot).toBeUndefined();
        // emitida: status/version/commercial/technical inalterados; só ganhou supersededBy
        const after = (await repo.get(id))!;
        expect(after.status).toBe('emitido');
        expect(after.version).toBe(before.version);
        expect(after.commercial).toEqual(before.commercial);
        expect(after.technical).toEqual(before.technical);
        expect(after.supersededBy).toBe(nv.id);
        // emitida continua imutável: editar ⇒ 409
        const edit = await call(repo, 'biz', 'PUT', `/api/proposals/${id}/commercial`, { version: after.version, commercial: J(lowMarginInput()) });
        expect(edit).toMatchObject({ status: 409, body: { error: 'proposal_issued_immutable' } });
        // a nova versão (rascunho do dono) É editável
        const editNew = await call(repo, 'biz', 'PUT', `/api/proposals/${nv.id}/commercial`, { version: 1, commercial: srcCommercial });
        expect(editNew.status).toBe(200);
      });
    }

    it('vínculo origem↔sucessora + auditoria reopen append-only em ambas', async () => {
      const repo = await factory();
      const id = await issued(repo, J(baseInput()));
      const r = await reopen(repo, 'apr', id, { reason: 'revisão comercial' });
      const nv = (r.body as { proposal: { id: string } }).proposal;
      expect((await repo.get(nv.id))?.reopenedFrom).toBe(id);
      expect((await repo.get(id))?.supersededBy).toBe(nv.id);
      const auditSrc = await repo.audit(id);
      const auditNew = await repo.audit(nv.id);
      expect(auditSrc.some((e) => e.action === 'reopen.superseded' && e.actorEmail === E.apr && (e.note ?? '').includes(nv.id))).toBe(true);
      expect(auditNew.some((e) => e.action === 'reopen' && e.actorEmail === E.apr && e.toState === REOPENED_INITIAL_STATE && (e.note ?? '').includes(id))).toBe(true);
      // a justificativa consta na trilha
      expect(auditNew.find((e) => e.action === 'reopen')?.note).toContain('revisão comercial');
    });

    it('escopo G-002: approver/admin alcançam a emitida (não é rascunho) ⇒ reabrem', async () => {
      const repo = await factory();
      const id = await issued(repo, J(baseInput()));
      expect((await reopen(repo, 'apr', id, { reason: 'ok' })).status).toBe(201);
    });

    it('404: proposta inexistente', async () => {
      const repo = await factory();
      for (const w of Object.keys(E) as Who[]) await repo.setAssignment(E[w], ROLE_OF[w], 'seed');
      expect((await reopen(repo, 'apr', 'BONDLY-2027-999999', { reason: 'ok' })).status).toBe(404);
    });

    it('nova versão respeita G-026 (gate de margem) ao avançar — sem bypass por reabertura', async () => {
      const repo = await factory();
      // emitida com margem BAIXA; a nova versão herda os inputs de margem baixa
      const id = await issued(repo, J(lowMarginInput()));
      const r = await reopen(repo, 'apr', id, { reason: 'renegociar' });
      const nv = (r.body as { proposal: { id: string } }).proposal;
      // dono leva a nova versão pela esteira até pronto para consolidar
      const t = async (who: Who, name: string) => call(repo, who, 'POST', `/api/proposals/${nv.id}/transition`, { version: await ver(repo, nv.id), transition: name });
      expect((await t('biz', 'submeter_analise')).status).toBe(200);
      expect((await t('tech', 'iniciar_analise')).status).toBe(200);
      expect((await t('tech', 'aprovar_tecnico')).status).toBe(200);
      // consolidar ⇒ bloqueado pelo gate de margem (exige exceção aprovada), igual a qualquer proposta
      expect(await t('biz', 'consolidar')).toMatchObject({ status: 409, body: { error: 'approval_required' } });
    });

    it('nova versão respeita G-023 (invalidação por mudança material) ao avançar', async () => {
      const repo = await factory();
      const id = await issued(repo, J(baseInput()));
      const r = await reopen(repo, 'apr', id, { reason: 'ajuste de volume' });
      const nv = (r.body as { proposal: { id: string } }).proposal;
      const t = async (who: Who, name: string) => call(repo, who, 'POST', `/api/proposals/${nv.id}/transition`, { version: await ver(repo, nv.id), transition: name });
      await t('biz', 'submeter_analise');
      await t('tech', 'iniciar_analise');
      expect((await t('tech', 'aprovar_tecnico')).status).toBe(200);
      expect((await repo.get(nv.id))?.status).toBe('aprovado_tecnicamente');
      // mudança comercial material pós-aprovação invalida e volta à reanálise
      const next = { ...J(baseInput()), volume: { ...(J(baseInput()).volume as object), users: 99999 } };
      const edit = await call(repo, 'biz', 'PUT', `/api/proposals/${nv.id}/commercial`, { version: await ver(repo, nv.id), commercial: next });
      expect(edit.status).toBe(200);
      expect((await repo.get(nv.id))?.status).toBe('aguardando_analise_tecnica');
    });
  });
}

describe('G-025 — migração ADITIVA: banco de schema anterior (sem reopened_from/superseded_by) abre e reabre', () => {
  it('cria tabela sem as colunas, reabre, e os vínculos passam a existir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bondly-g025-mig-'));
    dirs.push(dir);
    // 1) simula um banco ANTIGO: tabela proposals SEM reopened_from/superseded_by + seq.
    const require = createRequire(import.meta.url) as (id: string) => unknown;
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => { exec(s: string): void; close(): void } };
    const dbPath = join(dir, 'bondly.db');
    const old = new DatabaseSync(dbPath);
    old.exec(`
      CREATE TABLE proposals (
        id TEXT PRIMARY KEY, version INTEGER NOT NULL, status TEXT NOT NULL, owner_email TEXT NOT NULL,
        commercial TEXT NOT NULL, technical TEXT, snapshot TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO proposals (id, version, status, owner_email, commercial, technical, snapshot, created_at, updated_at)
      VALUES ('BONDLY-2027-000001', 2, 'emitido', 'biz.a@minu.co', '{}', NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      CREATE TABLE seq (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
      INSERT INTO seq (k, v) VALUES ('proposal', 1);
    `);
    old.close();
    // 2) abre pelo repositório atual (roda a migração aditiva), seed de perfis e reabre.
    const repo = await createSqliteRepository(dir);
    await repo.setAssignment('apr@minu.co', 'approver', 'seed');
    const r = await handleApi({
      method: 'POST', path: '/api/proposals/BONDLY-2027-000001/reopen',
      session: sess('apr@minu.co'), body: { reason: 'reabrir após migração' },
      repo, cfg,
    });
    expect(r.status).toBe(201);
    const nv = (r.body as { proposal: { id: string; reopenedFrom?: string } }).proposal;
    expect(nv.reopenedFrom).toBe('BONDLY-2027-000001');
    expect((await repo.get('BONDLY-2027-000001'))?.supersededBy).toBe(nv.id);
  });
});
