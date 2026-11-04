/**
 * Rate limit simples (janela fixa, em memória, por chave). Proteção de recurso caro (cotação = cálculo no servidor).
 * Limite honesto: por instância (não distribuído); com 1 instância no MVP basta. Relógio injetável para teste.
 */
export interface RateLimiter {
  /** Consome 1 unidade. `retryAfterSec` presente quando negado. */
  hit(key: string): { readonly ok: true } | { readonly ok: false; readonly retryAfterSec: number };
  reset(): void;
}

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, { start: number; count: number }>();
  return {
    hit(key) {
      const t = now();
      const b = buckets.get(key);
      if (!b || t - b.start >= opts.windowMs) {
        buckets.set(key, { start: t, count: 1 });
        // higiene: evita crescimento ilimitado do mapa
        if (buckets.size > 10_000) for (const [k, v] of buckets) if (t - v.start >= opts.windowMs) buckets.delete(k);
        return { ok: true };
      }
      if (b.count >= opts.limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.start + opts.windowMs - t) / 1000)) };
      b.count += 1;
      return { ok: true };
    },
    reset() {
      buckets.clear();
    },
  };
}
