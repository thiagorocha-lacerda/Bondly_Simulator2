import { describe, it, expect } from 'vitest';
import { canTransition, invalidationOnEdit, isMaterialChange } from './workflow.js';
import { handleApi } from './api.js';
import { createMemoryRepository } from './memoryRepository.js';
import { scryptHasher } from './profileCodes.js';
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';
import type { Role } from './rbac.js';

// Modo LEGADO (LEGACY_PROFILE_CODES=true) só para que estes testes de lógica de endpoint sigam usando o papel na sessão.
// A resolução real por atribuição individual (default) é coberta em rbacApi.test.ts.
const cfg = { legacyProfileCodes: true, profileCodeHashes: {} } as unknown as ServerConfig;
function sess(role?: Role): SessionData {
  return { email: role === 'tech' ? 'tec@minu.co' : 'ana@minu.co', domain: 'minu.co', exp: Math.floor(Date.now() / 1000) + 3600, ...(role ? { role } : {}) };
}

describe('Máquina de estados — decisão pura (§5.2)', () => {
  it('Negócios submete rascunho para análise; P&T não pode submeter', () => {
    expect(canTransition('rascunho_comercial', 'submeter_analise', 'business')).toMatchObject({ ok: true, to: 'aguardando_analise_tecnica' });
    expect(canTransition('rascunho_comercial', 'submeter_analise', 'tech')).toMatchObject({ ok: false, reason: 'wrong_role' });
  });
  it('P&T inicia análise, aprova/solicita ajustes/reprova a partir de em_analise', () => {
    expect(canTransition('aguardando_analise_tecnica', 'iniciar_analise', 'tech').ok).toBe(true);
    expect(canTransition('em_analise_tecnica', 'aprovar_tecnico', 'tech')).toMatchObject({ ok: true, to: 'aprovado_tecnicamente' });
    expect(canTransition('em_analise_tecnica', 'solicitar_ajustes', 'tech')).toMatchObject({ ok: true, to: 'ajustes_solicitados' });
    expect(canTransition('em_analise_tecnica', 'reprovar', 'tech')).toMatchObject({ ok: true, to: 'reprovado' });
  });
  it('estado de origem inválido recusa (invalid_from)', () => {
    expect(canTransition('rascunho_comercial', 'aprovar_tecnico', 'tech')).toMatchObject({ ok: false, reason: 'invalid_from' });
  });
  it('transição desconhecida recusa', () => {
    expect(canTransition('rascunho_comercial', 'teleportar', 'business')).toMatchObject({ ok: false, reason: 'unknown_transition' });
  });
});

describe('Invalidação por mudança material (§5.2)', () => {
  it('mudança comercial material pós-aprovação volta para aguardando análise', () => {
    expect(invalidationOnEdit('aprovado_tecnicamente', 'commercial')).toBe('aguardando_analise_tecnica');
    expect(invalidationOnEdit('pronto_para_emissao', 'commercial')).toBe('aguardando_analise_tecnica');
  });
  it('mudança técnica material pós-aprovação volta para em análise', () => {
    expect(invalidationOnEdit('aprovado_tecnicamente', 'technical')).toBe('em_analise_tecnica');
  });
  it('antes da aprovação não invalida nada', () => {
    expect(invalidationOnEdit('rascunho_comercial', 'commercial')).toBeNull();
    expect(invalidationOnEdit('em_analise_tecnica', 'technical')).toBeNull();
  });
  it('isMaterialChange detecta mudança em campos relevantes e ignora cosméticos', () => {
    const a = { volume: { users: 50000 }, negotiation: { term: 12, tierDiscount: 0.05 } };
    const b = { volume: { users: 60000 }, negotiation: { term: 12, tierDiscount: 0.05 } };
    expect(isMaterialChange('commercial', a, b)).toBe(true); // users mudou
    const c = { volume: { users: 50000 }, negotiation: { term: 12, tierDiscount: 0.05 }, clientName: 'X' };
    const d = { volume: { users: 50000 }, negotiation: { term: 12, tierDiscount: 0.05 }, clientName: 'Y' };
    expect(isMaterialChange('commercial', c, d)).toBe(false); // só nome mudou (não material)
    expect(isMaterialChange('technical', { integrations: 2 }, { integrations: 3 })).toBe(true);
  });
});

describe('Esteira completa via API (§11 Esteira)', () => {
  async function seed() {
    const repo = createMemoryRepository();
    const created = await handleApi({ method: 'POST', path: '/api/proposals', session: sess('business'), body: { commercial: { volume: { users: 50000 }, negotiation: { term: 12 } } }, repo, cfg });
    const id = (created.body as { proposal: { id: string; version: number } }).proposal.id;
    return { repo, id };
  }

  it('fluxo feliz: rascunho → análise → aprovado → pronto → emitido, com auditoria', async () => {
    const { repo, id } = await seed();
    const t = (role: Role, transition: string, version: number) =>
      handleApi({ method: 'POST', path: `/api/proposals/${id}/transition`, session: sess(role), body: { version, transition }, repo, cfg });

    expect((await t('business', 'submeter_analise', 1)).status).toBe(200);
    expect((await t('tech', 'iniciar_analise', 2)).status).toBe(200);
    expect((await t('tech', 'aprovar_tecnico', 3)).status).toBe(200);
    expect((await t('business', 'consolidar', 4)).status).toBe(200);
    const emit = await t('business', 'emitir', 5);
    expect(emit.status).toBe(200);
    expect((emit.body as { proposal: { status: string } }).proposal.status).toBe('emitido');

    const audit = await repo.audit(id);
    expect(audit.map((a) => a.action)).toContain('transition.aprovar_tecnico');
  });

  it('Negócios não pode acionar transição de P&T (403)', async () => {
    const { repo, id } = await seed();
    await handleApi({ method: 'POST', path: `/api/proposals/${id}/transition`, session: sess('business'), body: { version: 1, transition: 'submeter_analise' }, repo, cfg });
    const bad = await handleApi({ method: 'POST', path: `/api/proposals/${id}/transition`, session: sess('business'), body: { version: 2, transition: 'aprovar_tecnico' }, repo, cfg });
    expect(bad.status).toBe(403);
  });

  it('mudança material comercial após aprovação invalida a aprovação (volta a aguardando análise)', async () => {
    const { repo, id } = await seed();
    await handleApi({ method: 'POST', path: `/api/proposals/${id}/transition`, session: sess('business'), body: { version: 1, transition: 'submeter_analise' }, repo, cfg });
    await handleApi({ method: 'POST', path: `/api/proposals/${id}/transition`, session: sess('tech'), body: { version: 2, transition: 'iniciar_analise' }, repo, cfg });
    await handleApi({ method: 'POST', path: `/api/proposals/${id}/transition`, session: sess('tech'), body: { version: 3, transition: 'aprovar_tecnico' }, repo, cfg });
    // Negócios altera volume (material) na proposta aprovada
    const edit = await handleApi({ method: 'PUT', path: `/api/proposals/${id}/commercial`, session: sess('business'), body: { version: 4, commercial: { volume: { users: 99999 }, negotiation: { term: 12 } } }, repo, cfg });
    expect(edit.status).toBe(200);
    expect((edit.body as { invalidated: boolean }).invalidated).toBe(true);
    const after = await repo.get(id);
    expect(after?.status).toBe('aguardando_analise_tecnica');
  });

  it('emissão exige estar pronto para emissão (409 se fora de ordem)', async () => {
    const { repo, id } = await seed();
    const premature = await handleApi({ method: 'POST', path: `/api/proposals/${id}/transition`, session: sess('business'), body: { version: 1, transition: 'emitir' }, repo, cfg });
    expect(premature.status).toBe(409);
  });
});
