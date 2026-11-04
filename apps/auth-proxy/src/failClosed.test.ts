import { loadConfig } from './config.js';
import { isProductionEnv } from './envMode.js';
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository, RepositoryUnavailableError } from './sqliteRepository.js';
import { healthStatus } from './health.js';

const quiet = () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
};

describe('G-003 — repositório fail-closed em produção', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('produção sem DATA_DIR → lança data_dir_missing', async () => {
    quiet();
    await expect(createRepository({ NODE_ENV: 'production' })).rejects.toMatchObject({ code: 'data_dir_missing' });
  });
  it('NODE_ENV ausente conta como produção (mesma regra do loadConfig)', async () => {
    quiet();
    await expect(createRepository({})).rejects.toBeInstanceOf(RepositoryUnavailableError);
  });
  it.each(['staging', 'prod', 'Production', ' PRODUCTION ', 'qa', ''])('G-013: NODE_ENV=%j (fora da allowlist) ⇒ fail-closed', async (nodeEnv) => {
    quiet();
    await expect(createRepository({ NODE_ENV: nodeEnv })).rejects.toMatchObject({ code: 'data_dir_missing' });
    expect(() => loadConfig({ NODE_ENV: nodeEnv })).toThrow(/obrigatória ausente/);
    expect(isProductionEnv({ NODE_ENV: nodeEnv })).toBe(true);
  });
  it.each(['development', 'test', ' Development ', 'TEST'])('G-013: NODE_ENV=%j (allowlist) ⇒ não-produção, fallbacks de dev', (nodeEnv) => {
    expect(isProductionEnv({ NODE_ENV: nodeEnv })).toBe(false);
    expect(loadConfig({ NODE_ENV: nodeEnv }).isProd).toBe(false);
  });
  it('produção com DATA_DIR inacessível → lança sqlite_unavailable', async () => {
    quiet();
    await expect(createRepository({ NODE_ENV: 'production', DATA_DIR: '/proc/nope/x' })).rejects.toMatchObject({ code: 'sqlite_unavailable' });
  });
  it('produção com DATA_DIR válido → sqlite', async () => {
    const d = mkdtempSync(join(tmpdir(), 'bondly-fc-'));
    dirs.push(d);
    const r = await createRepository({ NODE_ENV: 'production', DATA_DIR: d });
    expect(r.backend).toBe('sqlite');
  });
  it('produção + ALLOW_EPHEMERAL_REPO=true → memória, com warn', async () => {
    quiet();
    const r = await createRepository({ NODE_ENV: 'production', ALLOW_EPHEMERAL_REPO: 'true' });
    expect(r.backend).toBe('memory');
    expect(console.warn).toHaveBeenCalled();
  });
  it('dev/teste sem DATA_DIR → memória (fallback preservado)', async () => {
    const r = await createRepository({ NODE_ENV: 'development' });
    expect(r.backend).toBe('memory');
  });
  it('a mensagem do erro não vaza segredos de env', async () => {
    quiet();
    const e = await createRepository({ NODE_ENV: 'production', SESSION_SECRET: 'SEGREDO-XYZ' }).catch((x: Error) => x);
    expect(String((e as Error).message)).not.toContain('SEGREDO-XYZ');
  });
});

describe('G-003 — /healthz', () => {
  it('sqlite → 200 e expõe repo', () => {
    expect(healthStatus({ backend: 'sqlite', isProd: true, allowEphemeral: false })).toEqual({ status: 200, body: { ok: true, repo: 'sqlite' } });
  });
  it('memória em produção sem opt-in → 503', () => {
    const h = healthStatus({ backend: 'memory', isProd: true, allowEphemeral: false });
    expect(h.status).toBe(503);
    expect(h.body.repo).toBe('memory');
  });
  it('memória em produção com opt-in → 200 sinalizando ephemeral', () => {
    expect(healthStatus({ backend: 'memory', isProd: true, allowEphemeral: true }).body).toMatchObject({ repo: 'memory', ephemeral: true });
  });
  it('memória em dev → 200', () => {
    expect(healthStatus({ backend: 'memory', isProd: false, allowEphemeral: false }).status).toBe(200);
  });
});
