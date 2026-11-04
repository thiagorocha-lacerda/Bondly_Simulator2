/**
 * Re-revisão 2 — G-019 (segredo fraco em produção), G-020 (404 em /assets/*), G-021 (novo dono sem perfil /
 * histórico após `retomar`) e G-022 (`version` obrigatória na reatribuição).
 */
import { describe, it, expect } from 'vitest';
import { loadConfig, weakSecretReason, DEV_SESSION_SECRET, DEV_CLIENT_SECRET } from './config.js';
import { isAssetPath } from './static-path.js';
import { canAccessResumedHistory } from './scope.js';
import { createMemoryRepository } from './memoryRepository.js';
import { handleApi, type ApiResult } from './api.js';
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';
import type { ProposalRepository } from './domain.js';

const STRONG = 'k9Xv2mQpL7wZr4TnB8yHd3FsGj6UaCe1';
const prod = { NODE_ENV: 'production', PUBLIC_URL: 'https://x.example', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'real-client-secret-value', SESSION_SECRET: STRONG };

describe('G-019 — segredos fracos recusados em produção', () => {
  it('segredo forte passa', () => {
    expect(() => loadConfig(prod)).not.toThrow();
  });
  it.each([
    ['dev público', DEV_SESSION_SECRET],
    ['curto (31)', 'k9Xv2mQpL7wZr4TnB8yHd3FsGj6UaCe'],
    ['x', 'x'],
    ['repetição de 40 x', 'x'.repeat(40)],
    ['padrão repetido', 'abcd1234'.repeat(6)],
    ['poucos símbolos distintos', 'abab'.repeat(12) + 'cc'],
  ])('SESSION_SECRET %s ⇒ throw weak_secret, sem vazar o valor', (_n, secret) => {
    let msg = '';
    try {
      loadConfig({ ...prod, SESSION_SECRET: secret });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/^weak_secret: SESSION_SECRET/);
    expect(msg).not.toContain(secret);
  });
  it('GOOGLE_CLIENT_SECRET com o default de dev ⇒ recusado em produção', () => {
    expect(() => loadConfig({ ...prod, GOOGLE_CLIENT_SECRET: DEV_CLIENT_SECRET })).toThrow(/weak_secret: GOOGLE_CLIENT_SECRET/);
  });
  it('fora de produção os defaults de dev continuam permitidos', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).sessionSecret).toBe(DEV_SESSION_SECRET);
    expect(weakSecretReason(STRONG)).toBeNull();
  });
  it('NODE_ENV fora da allowlist (staging) também recusa', () => {
    expect(() => loadConfig({ ...prod, NODE_ENV: 'staging', SESSION_SECRET: DEV_SESSION_SECRET })).toThrow(/weak_secret/);
  });
});

describe('G-020 — guarda de /assets/*', () => {
  it.each(['/assets/x.js', 'assets/x.js', '/Assets/x.js', '//assets/a.css', '/assets/'])('%s é asset', (p) => expect(isAssetPath(p)).toBe(true));
  it.each(['/', '/index.html', '/propostas/assets', '/dashboard', '/x/assets/y.js'])('%s NÃO é asset (fallback SPA)', (p) => expect(isAssetPath(p)).toBe(false));
});

const cfg = { legacyProfileCodes: false, profileCodeHashes: {} } as unknown as ServerConfig;
const sess = (email: string): SessionData => ({ email, domain: 'minu.co', exp: Math.floor(Date.now() / 1000) + 3600 });
const call = (repo: ProposalRepository, email: string, method: string, path: string, body: unknown = null): Promise<ApiResult> =>
  handleApi({ method, path, session: sess(email), body, repo, cfg });

async function world() {
  const repo = createMemoryRepository();
  await repo.setAssignment('adm@minu.co', 'admin', 's');
  await repo.setAssignment('biz.a@minu.co', 'business', 's');
  await repo.setAssignment('biz.b@minu.co', 'business', 's');
  await repo.setAssignment('tec@minu.co', 'tech', 's');
  await repo.setAssignment('apr@minu.co', 'approver', 's');
  const p = await repo.create({ id: 'BONDLY-2027-000001', ownerEmail: 'biz.a@minu.co', commercial: {} }, { actorEmail: 'biz.a@minu.co', role: 'business', action: 'proposal.create' });
  return { repo, p };
}

describe('G-021/G-022 — reatribuição', () => {
  it('G-022: sem version ⇒ 400 version_required; defasada ⇒ 409; nada muda', async () => {
    const { repo, p } = await world();
    const path = `/api/admin/proposals/${p.id}/owner`;
    const a = await call(repo, 'adm@minu.co', 'PUT', path, { ownerEmail: 'biz.b@minu.co' });
    expect(a.status).toBe(400);
    expect(a.body).toEqual({ error: 'version_required' });
    expect((await call(repo, 'adm@minu.co', 'PUT', path, { ownerEmail: 'biz.b@minu.co', version: 'x' })).status).toBe(400);
    expect((await call(repo, 'adm@minu.co', 'PUT', path, { ownerEmail: 'biz.b@minu.co', version: 99 })).status).toBe(409);
    expect((await repo.get(p.id))?.ownerEmail).toBe('biz.a@minu.co');
    expect((await call(repo, 'adm@minu.co', 'PUT', path, { ownerEmail: 'biz.b@minu.co', version: p.version })).status).toBe(200);
  });
  it('G-021: novo dono sem perfil ⇒ 400 new_owner_without_role; com perfil não-business ⇒ 400 new_owner_not_business', async () => {
    const { repo, p } = await world();
    const path = `/api/admin/proposals/${p.id}/owner`;
    const a = await call(repo, 'adm@minu.co', 'PUT', path, { ownerEmail: 'sem.perfil@minu.co', version: p.version });
    expect(a.status).toBe(400);
    expect(a.body).toEqual({ error: 'new_owner_without_role' });
    const b = await call(repo, 'adm@minu.co', 'PUT', path, { ownerEmail: 'tec@minu.co', version: p.version });
    expect(b.body).toEqual({ error: 'new_owner_not_business' });
    expect((await repo.get(p.id))?.ownerEmail).toBe('biz.a@minu.co');
    expect(await repo.ownerAudit(p.id)).toHaveLength(0);
  });
});

describe('G-021 — histórico de proposta retomada (tech/approver) sem afrouxar G-002', () => {
  it('função pura: só tech/approver, só rascunho JÁ submetido', () => {
    const d = { status: 'rascunho_comercial' } as const;
    expect(canAccessResumedHistory('tech', d, true)).toBe(true);
    expect(canAccessResumedHistory('approver', d, true)).toBe(true);
    expect(canAccessResumedHistory('tech', d, false)).toBe(false);
    expect(canAccessResumedHistory('business', d, true)).toBe(false);
    expect(canAccessResumedHistory('tech', { status: 'emitido' }, true)).toBe(false);
  });
  it('após retomar: tech lê SLA/auditoria (200) e pausa o relógio; corpo da proposta segue 404; rascunho nunca submetido 404', async () => {
    const { repo, p } = await world();
    const biz = 'biz.a@minu.co';
    const t = (name: string, who: string, v: number) => call(repo, who, 'POST', `/api/proposals/${p.id}/transition`, { version: v, transition: name, note: 'n' });
    expect((await t('submeter_analise', biz, 1)).status).toBe(200);
    expect((await t('iniciar_analise', 'tec@minu.co', 2)).status).toBe(200);
    expect((await t('solicitar_ajustes', 'tec@minu.co', 3)).status).toBe(200);
    expect((await t('retomar', biz, 4)).status).toBe(200);
    expect((await repo.get(p.id))?.status).toBe('rascunho_comercial');
    expect((await call(repo, 'tec@minu.co', 'GET', `/api/proposals/${p.id}/sla`)).status).toBe(200);
    expect((await call(repo, 'tec@minu.co', 'GET', `/api/proposals/${p.id}/audit`)).status).toBe(200);
    expect((await call(repo, 'tec@minu.co', 'POST', `/api/proposals/${p.id}/sla/pause`, { reason: 'aguardando cliente', reasonCode: 'aguardando_cliente' })).status).toBe(200);
    expect((await call(repo, 'apr@minu.co', 'GET', `/api/proposals/${p.id}/audit`)).status).toBe(200);
    // corpo e escrita seguem fora do escopo (G-002 intacto)
    expect((await call(repo, 'tec@minu.co', 'GET', `/api/proposals/${p.id}`)).status).toBe(404);
    expect((await call(repo, 'tec@minu.co', 'PUT', `/api/proposals/${p.id}/technical`, { version: 5, technical: {} })).status).toBe(404);
    expect((await call(repo, 'apr@minu.co', 'GET', '/api/proposals')).body).toEqual({ proposals: [] });
    // rascunho nunca submetido
    const d = await repo.create({ id: 'BONDLY-2027-000002', ownerEmail: biz, commercial: {} }, { actorEmail: biz, role: 'business', action: 'proposal.create' });
    expect((await call(repo, 'tec@minu.co', 'GET', `/api/proposals/${d.id}/sla`)).status).toBe(404);
    expect((await call(repo, 'tec@minu.co', 'GET', `/api/proposals/${d.id}/audit`)).status).toBe(404);
  });
});
