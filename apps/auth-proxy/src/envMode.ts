/**
 * G-013: ALLOWLIST explícita de ambientes NÃO-produção. Qualquer outro valor de NODE_ENV
 * (ausente, 'staging', 'prod', 'Production', typo...) é tratado como PRODUÇÃO (fail-closed):
 * exige DATA_DIR, SESSION_SECRET real, GOOGLE_*, PUBLIC_URL e recusa fallbacks de dev.
 * Normaliza case e espaços.
 */
const NON_PROD_ENVS: ReadonlySet<string> = new Set(['development', 'test']);

export function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  const v = (env.NODE_ENV ?? '').trim().toLowerCase();
  return !NON_PROD_ENVS.has(v);
}
