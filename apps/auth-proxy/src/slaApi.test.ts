import { describe, it, expect } from 'vitest';
import { createMemoryRepository } from './memoryRepository.js';
import { handleApi } from './api.js';
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';
import type { Role } from './rbac.js';
import type { ProposalRepository } from './domain.js';

// Modo LEGADO (LEGACY_PROFILE_CODES=true) só para que estes testes de lógica de endpoint sigam usando o papel na sessão.
// A resolução real por atribuição individual (default) é coberta em rbacApi.test.ts.
const cfg = { legacyProfileCodes: true } as unknown as ServerConfig;

function sess(role?: Role, email = 'user@minu.co'): SessionData {
  return { email, domain: 'minu.co', exp: Math.floor(Date.now() / 1000) + 3600, ...(role ? { role } : {}) };
}

/** Cria uma proposta e a leva até 'aguardando_analise_tecnica' (submeter_analise dispara o SLA). */
async function proposalInQueue(repo: ProposalRepository): Promise<string> {
  const seq = await repo.nextSequence();
  const id = `BONDLY-2027-${String(seq).padStart(6, '0')}`;
  await repo.create(
    { id, ownerEmail: 'biz@minu.co', commercial: { users: 1000 } },
    { actorEmail: 'biz@minu.co', role: 'business', action: 'proposal.create', toState: 'rascunho_comercial' },
  );
  // Negócios submete para análise → inicia o SLA
  const r = await handleApi({
    method: 'POST',
    path: `/api/proposals/${id}/transition`,
    session: sess('business', 'biz@minu.co'),
    body: { version: 1, transition: 'submeter_analise' },
    repo,
    cfg,
  });
  expect(r.status).toBe(200);
  return id;
}

describe('SLA API (§6) — start automático, RBAC e ciclo pausa/retomada/parecer', () => {
  it('submeter_analise inicia o relógio (started) — GET /sla mostra em_andamento, 5 dias', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const r = await handleApi({ method: 'GET', path: `/api/proposals/${id}/sla`, session: sess('tech'), body: null, repo, cfg });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sla: { phase: 'em_andamento', businessDaysRemaining: 5 } });
  });

  it('start é idempotente — submeter de novo não cria um segundo started', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    // volta para rascunho e re-submete (solicita ajustes → retomar → submeter)
    await repo.update(id, 2, { status: 'ajustes_solicitados' }, { actorEmail: 'tech@minu.co', role: 'tech', action: 'x' });
    await handleApi({ method: 'POST', path: `/api/proposals/${id}/transition`, session: sess('business', 'biz@minu.co'), body: { version: 3, transition: 'submeter_analise' }, repo, cfg });
    const events = await repo.slaEvents(id);
    expect(events.filter((e) => e.kind === 'started').length).toBe(1);
  });

  it('§6.7.12 — Negócios NÃO pode pausar o relógio (RBAC sla.manage nega business)', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const r = await handleApi({ method: 'POST', path: `/api/proposals/${id}/sla/pause`, session: sess('business', 'biz@minu.co'), body: { reason: 'x' }, repo, cfg });
    expect(r.status).toBe(403);
  });

  it('pausa exige justificativa (reason) — 400 sem ela', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const r = await handleApi({ method: 'POST', path: `/api/proposals/${id}/sla/pause`, session: sess('tech'), body: {}, repo, cfg });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: 'reason_required' });
  });

  it('tech pausa e retoma — phase reflete, e não reseta (§6.4)', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const paused = await handleApi({ method: 'POST', path: `/api/proposals/${id}/sla/pause`, session: sess('tech'), body: { reason: 'faltam specs', missingItems: ['api'] }, repo, cfg });
    expect(paused.status).toBe(200);
    expect(paused.body).toMatchObject({ sla: { phase: 'pausado' } });

    const resumed = await handleApi({ method: 'POST', path: `/api/proposals/${id}/sla/resume`, session: sess('tech'), body: { confirmedItems: ['api'] }, repo, cfg });
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({ sla: { phase: 'em_andamento' } });
  });

  it('não pode retomar um relógio que não está pausado (409 sla_not_paused)', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const r = await handleApi({ method: 'POST', path: `/api/proposals/${id}/sla/resume`, session: sess('tech'), body: {}, repo, cfg });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'sla_not_paused' });
  });

  it('complete exige verdict válido e congela o relógio (phase concluido)', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const bad = await handleApi({ method: 'POST', path: `/api/proposals/${id}/sla/complete`, session: sess('tech'), body: { verdict: 'talvez' }, repo, cfg });
    expect(bad.status).toBe(400);

    const ok = await handleApi({ method: 'POST', path: `/api/proposals/${id}/sla/complete`, session: sess('tech'), body: { verdict: 'aprovado' }, repo, cfg });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ sla: { phase: 'concluido', verdict: 'aprovado', metSla: true } });
  });

  it('sem papel → 403 profile_required mesmo nas rotas de SLA', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const r = await handleApi({ method: 'GET', path: `/api/proposals/${id}/sla`, session: sess(), body: null, repo, cfg });
    expect(r.status).toBe(403);
  });
});

describe('Reunião técnica API (§6.3) — ciclo e regra de não-pausa (§6.4)', () => {
  async function requestMeeting(repo: ProposalRepository, id: string) {
    return handleApi({
      method: 'POST',
      path: `/api/proposals/${id}/meetings`,
      session: sess('tech'),
      body: { objective: 'esclarecer integrações do ERP' },
      repo,
      cfg,
    });
  }

  it('§6.4 — solicitar reunião NÃO pausa o SLA (phase segue em_andamento)', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const created = await requestMeeting(repo, id);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ slaUnaffected: true, meeting: { state: 'solicitada' } });
    // o relógio continua correndo
    const sla = await handleApi({ method: 'GET', path: `/api/proposals/${id}/sla`, session: sess('tech'), body: null, repo, cfg });
    expect(sla.body).toMatchObject({ sla: { phase: 'em_andamento' } });
  });

  it('solicitar exige objetivo (400 sem objective)', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const r = await handleApi({ method: 'POST', path: `/api/proposals/${id}/meetings`, session: sess('tech'), body: {}, repo, cfg });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: 'objective_required' });
  });

  it('Negócios NÃO pode solicitar reunião (RBAC sla.manage)', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const r = await handleApi({ method: 'POST', path: `/api/proposals/${id}/meetings`, session: sess('business', 'biz@minu.co'), body: { objective: 'x' }, repo, cfg });
    expect(r.status).toBe(403);
  });

  it('percorre agendamento → realizada e transição inválida dá 409', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const { body } = await requestMeeting(repo, id);
    const mid = (body as { meeting: { id: string } }).meeting.id;
    const step = (transition: string, extra: Record<string, unknown> = {}) =>
      handleApi({ method: 'POST', path: `/api/proposals/${id}/meetings/${mid}/transition`, session: sess('tech'), body: { transition, ...extra }, repo, cfg });

    expect((await step('iniciar_agendamento')).status).toBe(200);
    expect((await step('agendar', { scheduledFor: '2027-04-05T14:00:00-03:00' })).status).toBe(200);
    expect((await step('realizar')).status).toBe(200);
    // transição inválida: receber_insumos sem estar em aguardando_insumos
    const bad = await step('receber_insumos');
    expect(bad.status).toBe(409);
    expect(bad.body).toMatchObject({ error: 'meeting_invalid_from' });
  });

  it('cancelamento exige justificativa (note) — 400 sem ela, 200 com ela', async () => {
    const repo = createMemoryRepository();
    const id = await proposalInQueue(repo);
    const { body } = await requestMeeting(repo, id);
    const mid = (body as { meeting: { id: string } }).meeting.id;
    const noNote = await handleApi({ method: 'POST', path: `/api/proposals/${id}/meetings/${mid}/transition`, session: sess('tech'), body: { transition: 'cancelar' }, repo, cfg });
    expect(noNote.status).toBe(400);
    const ok = await handleApi({ method: 'POST', path: `/api/proposals/${id}/meetings/${mid}/transition`, session: sess('tech'), body: { transition: 'cancelar', note: 'cliente desmarcou' }, repo, cfg });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ meeting: { state: 'cancelada' } });
  });
});
