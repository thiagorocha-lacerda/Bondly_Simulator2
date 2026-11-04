/** /healthz (G-003): expõe o backend do repositório e falha (503) se for memória em produção sem opt-in. */
export function healthStatus(args: {
  backend: 'sqlite' | 'memory';
  isProd: boolean;
  allowEphemeral: boolean;
}): { status: number; body: { ok: boolean; repo: 'sqlite' | 'memory'; ephemeral?: true } } {
  const { backend, isProd, allowEphemeral } = args;
  if (backend === 'sqlite') return { status: 200, body: { ok: true, repo: backend } };
  if (isProd && !allowEphemeral) return { status: 503, body: { ok: false, repo: backend } };
  return { status: 200, body: { ok: true, repo: backend, ...(isProd ? { ephemeral: true as const } : {}) } };
}
