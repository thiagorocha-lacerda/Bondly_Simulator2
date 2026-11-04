import { describe, it, expect } from 'vitest';
import { createMemoryRepository } from './memoryRepository.js';
import { handleApi } from './api.js';
import { scryptHasher } from './profileCodes.js';
import { VersionConflictError } from './domain.js';
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';
import type { Role } from './rbac.js';

// Modo LEGADO (LEGACY_PROFILE_CODES=true) só para que estes testes de lógica de endpoint sigam usando o papel na sessão.
// A resolução real por atribuição individual (default) é coberta em rbacApi.test.ts.
const cfg = {
  legacyProfileCodes: true,
  profileCodeHashes: { business: scryptHasher.hash('biz'), tech: scryptHasher.hash('tek') },
} as unknown as ServerConfig;

function sess(role?: Role): SessionData {
  return { email: 'ana@minu.co', domain: 'minu.co', exp: Math.floor(Date.now() / 1000) + 3600, ...(role ? { role } : {}) };
}

describe('memoryRepository — contrato (§5.2)', () => {
  it('cria, lê, atualiza sob lock otimista e audita', async () => {
    const repo = createMemoryRepository();
    const seq = await repo.nextSequence();
    const p = await repo.create(
      { id: `BONDLY-2027-${String(seq).padStart(6, '0')}`, ownerEmail: 'ana@minu.co', commercial: { users: 50000 } },
      { actorEmail: 'ana@minu.co', role: 'business', action: 'proposal.create', toState: 'rascunho_comercial' },
    );
    expect(p.version).toBe(1);
    expect(p.status).toBe('rascunho_comercial');

    const upd = await repo.update(p.id, 1, { commercial: { users: 60000 } }, { actorEmail: 'ana@minu.co', role: 'business', action: 'proposal.edit_commercial' });
    expect(upd.version).toBe(2);

    const audit = await repo.audit(p.id);
    expect(audit.length).toBe(2);
  });

  it('rejeita escrita com versão defasada (VersionConflictError)', async () => {
    const repo = createMemoryRepository();
    const p = await repo.create({ id: 'BONDLY-2027-000001', ownerEmail: 'ana@minu.co', commercial: {} }, { actorEmail: 'ana@minu.co', role: 'business', action: 'proposal.create' });
    await repo.update(p.id, 1, { commercial: { x: 1 } }, { actorEmail: 'ana@minu.co', role: 'business', action: 'proposal.edit_commercial' });
    await expect(repo.update(p.id, 1, { commercial: { x: 2 } }, { actorEmail: 'ana@minu.co', role: 'business', action: 'proposal.edit_commercial' })).rejects.toBeInstanceOf(VersionConflictError);
  });
});

describe('API — autenticação e 2º fator (§6/§7.2)', () => {
  it('sem sessão → 401', async () => {
    const r = await handleApi({ method: 'GET', path: '/api/me', session: null, body: null, repo: createMemoryRepository(), cfg });
    expect(r.status).toBe(401);
  });

  it('sem papel → /api/proposals dá 403 profile_required', async () => {
    const r = await handleApi({ method: 'GET', path: '/api/proposals', session: sess(), body: null, repo: createMemoryRepository(), cfg });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'profile_required' });
  });

  it('unlock com código certo eleva o papel e devolve session para reemitir cookie', async () => {
    const r = await handleApi({ method: 'POST', path: '/api/profile/unlock', session: sess(), body: { role: 'business', code: 'biz' }, repo: createMemoryRepository(), cfg });
    expect(r.status).toBe(200);
    expect(r.session?.role).toBe('business');
  });

  it('unlock com código errado → 401 genérico (sem vazar motivo)', async () => {
    const r = await handleApi({ method: 'POST', path: '/api/profile/unlock', session: sess(), body: { role: 'business', code: 'errado' }, repo: createMemoryRepository(), cfg });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: 'unlock_failed' });
    expect(r.session).toBeUndefined();
  });
});

describe('API — RBAC e filtragem de payload por papel (§6/§8)', () => {
  it('Negócios cria rascunho; P&T NÃO pode criar', async () => {
    const repo = createMemoryRepository();
    const ok = await handleApi({ method: 'POST', path: '/api/proposals', session: sess('business'), body: { commercial: { users: 50000 } }, repo, cfg });
    expect(ok.status).toBe(201);
    const denied = await handleApi({ method: 'POST', path: '/api/proposals', session: sess('tech'), body: { commercial: {} }, repo, cfg });
    expect(denied.status).toBe(403);
  });

  it('P&T edita técnico e vê technical; Negócios recebe só resumo (sem technical/snapshot)', async () => {
    const repo = createMemoryRepository();
    const created = await handleApi({ method: 'POST', path: '/api/proposals', session: sess('business'), body: { commercial: { users: 50000 } }, repo, cfg });
    const id = (created.body as { proposal: { id: string } }).proposal.id;
    await repo.update(id, 1, { status: 'aguardando_analise_tecnica' }, { actorEmail: 'ana@minu.co', role: 'business', action: 'test.submit' }); // G-002: tech só lê fora do rascunho

    // P&T preenche parecer técnico
    const edited = await handleApi({ method: 'PUT', path: `/api/proposals/${id}/technical`, session: sess('tech'), body: { version: 2, technical: { integrations: 3, risks: 'migração legada', verdict: 'ajustes' } }, repo, cfg });
    expect(edited.status).toBe(200);

    // P&T vê o technical completo
    const asTech = await handleApi({ method: 'GET', path: `/api/proposals/${id}`, session: sess('tech'), body: null, repo, cfg });
    const techView = (asTech.body as { proposal: Record<string, unknown> }).proposal;
    expect(techView.technical).toBeDefined();

    // Negócios NÃO recebe technical nem risks; só um resumo
    const asBiz = await handleApi({ method: 'GET', path: `/api/proposals/${id}`, session: sess('business'), body: null, repo, cfg });
    const bizView = (asBiz.body as { proposal: Record<string, unknown> }).proposal;
    expect(bizView.technical).toBeUndefined();
    expect(bizView.snapshot).toBeUndefined();
    expect(bizView.technicalSummary).toContain('ajustes');
    expect(JSON.stringify(bizView)).not.toContain('migração legada');
  });

  it('Negócios NÃO pode editar técnico; P&T NÃO pode editar comercial', async () => {
    const repo = createMemoryRepository();
    const created = await handleApi({ method: 'POST', path: '/api/proposals', session: sess('business'), body: { commercial: {} }, repo, cfg });
    const id = (created.body as { proposal: { id: string } }).proposal.id;
    const bizTech = await handleApi({ method: 'PUT', path: `/api/proposals/${id}/technical`, session: sess('business'), body: { version: 1, technical: {} }, repo, cfg });
    expect(bizTech.status).toBe(403);
    const techComm = await handleApi({ method: 'PUT', path: `/api/proposals/${id}/commercial`, session: sess('tech'), body: { version: 1, commercial: {} }, repo, cfg });
    expect(techComm.status).toBe(403);
  });

  it('edição com versão defasada → 409 version_conflict', async () => {
    const repo = createMemoryRepository();
    const created = await handleApi({ method: 'POST', path: '/api/proposals', session: sess('business'), body: { commercial: {} }, repo, cfg });
    const id = (created.body as { proposal: { id: string } }).proposal.id;
    await handleApi({ method: 'PUT', path: `/api/proposals/${id}/commercial`, session: sess('business'), body: { version: 1, commercial: { a: 1 } }, repo, cfg });
    const stale = await handleApi({ method: 'PUT', path: `/api/proposals/${id}/commercial`, session: sess('business'), body: { version: 1, commercial: { a: 2 } }, repo, cfg });
    expect(stale.status).toBe(409);
  });

  it('auditoria: Negócios não recebe as notas técnicas (note omitido)', async () => {
    const repo = createMemoryRepository();
    const created = await handleApi({ method: 'POST', path: '/api/proposals', session: sess('business'), body: { commercial: {} }, repo, cfg });
    const id = (created.body as { proposal: { id: string } }).proposal.id;
    const asBiz = await handleApi({ method: 'GET', path: `/api/proposals/${id}/audit`, session: sess('business'), body: null, repo, cfg });
    const entries = (asBiz.body as { audit: Record<string, unknown>[] }).audit;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect('note' in e).toBe(false);
  });
});
