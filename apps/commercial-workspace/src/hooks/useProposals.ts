import { useCallback, useEffect, useState } from 'react';

/** Visão de proposta como a API devolve (filtrada por papel; campos internos podem faltar). */
export interface ProposalView {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly ownerEmail: string;
  readonly commercial: Record<string, unknown>;
  readonly technical?: Record<string, unknown>;
  readonly technicalSummary?: string;
  readonly reopenedFrom?: string;
  readonly supersededBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UseProposals {
  readonly proposals: readonly ProposalView[];
  readonly loading: boolean;
  readonly available: boolean; // false em dev sem BFF (API indisponível)
  refresh: () => Promise<void>;
  create: (commercial: Record<string, unknown>) => Promise<ProposalView | null>;
  transition: (id: string, version: number, transition: string, note?: string) => Promise<boolean>;
  /** G-025: reabre uma proposta emitida criando uma nova versão. Retorna o erro do servidor (ou null = ok). */
  reopen: (id: string, reason: string) => Promise<string | null>;
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const ct = r.headers.get('content-type') ?? '';
    if (!r.ok || !ct.includes('application/json')) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Estado das propostas da esteira (§5). Consome as APIs filtradas por papel do BFF. */
export function useProposals(enabled: boolean): UseProposals {
  const [proposals, setProposals] = useState<readonly ProposalView[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    const data = await getJson('/api/proposals');
    if (data && typeof data === 'object' && 'proposals' in data) {
      setProposals((data as { proposals: ProposalView[] }).proposals);
      setAvailable(true);
    } else {
      setAvailable(false);
    }
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (commercial: Record<string, unknown>): Promise<ProposalView | null> => {
      try {
        const r = await fetch('/api/proposals', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ commercial }),
        });
        if (!r.ok) return null;
        const body = (await r.json()) as { proposal: ProposalView };
        await refresh();
        return body.proposal;
      } catch {
        return null;
      }
    },
    [refresh],
  );

  const transition = useCallback(
    async (id: string, version: number, name: string, note?: string): Promise<boolean> => {
      try {
        const r = await fetch(`/api/proposals/${id}/transition`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ version, transition: name, ...(note ? { note } : {}) }),
        });
        if (r.ok) await refresh();
        return r.ok;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  const reopen = useCallback(
    async (id: string, reason: string): Promise<string | null> => {
      try {
        const r = await fetch(`/api/proposals/${encodeURIComponent(id)}/reopen`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ reason }),
        });
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        if (r.ok) {
          await refresh();
          return null;
        }
        return data.error ?? 'erro';
      } catch {
        return 'network';
      }
    },
    [refresh],
  );

  return { proposals, loading, available, refresh, create, transition, reopen };
}
