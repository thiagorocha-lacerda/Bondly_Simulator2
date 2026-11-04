import { useCallback, useEffect, useState } from 'react';

/**
 * Estado e ações do SLA técnico de uma proposta (§6). Consome as APIs do BFF:
 *   GET  /api/proposals/:id/sla          → estado derivado do relógio
 *   POST /api/proposals/:id/sla/pause|resume|complete
 *   GET/POST /api/proposals/:id/meetings e .../meetings/:mid/transition
 * Tolera dev sem BFF (fetch falha → available=false), como useProposals.
 */

export interface SlaStateView {
  readonly phase: 'nao_iniciado' | 'em_andamento' | 'pausado' | 'concluido';
  readonly health: 'no_prazo' | 'atencao' | 'vencido' | 'pausado' | 'concluido' | 'nao_iniciado';
  readonly startedAt: number | null;
  readonly dueAt: number | null;
  readonly businessDaysElapsed: number;
  readonly businessDaysRemaining: number;
  readonly pausedAt: number | null;
  readonly pauseReason: string | null;
  readonly completedAt: number | null;
  readonly verdict: string | null;
  readonly metSla: boolean | null;
}

export interface MeetingView {
  readonly id: string;
  readonly state: string;
  readonly objective: string;
  readonly scheduledFor?: string;
  readonly log: readonly { at: number; by: string; transition: string; toState: string; note?: string }[];
}

export interface UseSla {
  readonly sla: SlaStateView | null;
  readonly meetings: readonly MeetingView[];
  readonly loading: boolean;
  readonly available: boolean;
  refresh: () => Promise<void>;
  pause: (reason: string, missingItems?: string[], reasonCode?: string) => Promise<boolean>;
  resume: (confirmedItems?: string[]) => Promise<boolean>;
  complete: (verdict: string) => Promise<boolean>;
  requestMeeting: (objective: string, scheduledFor?: string) => Promise<boolean>;
  meetingTransition: (meetingId: string, transition: string, note?: string, scheduledFor?: string) => Promise<boolean>;
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

async function postJson(url: string, body: unknown): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function useSla(proposalId: string | null, enabled: boolean): UseSla {
  const [sla, setSla] = useState<SlaStateView | null>(null);
  const [meetings, setMeetings] = useState<readonly MeetingView[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled || !proposalId) return;
    setLoading(true);
    const [slaData, mData] = await Promise.all([
      getJson(`/api/proposals/${proposalId}/sla`),
      getJson(`/api/proposals/${proposalId}/meetings`),
    ]);
    if (slaData && typeof slaData === 'object' && 'sla' in slaData) {
      setSla((slaData as { sla: SlaStateView }).sla);
      setAvailable(true);
    } else {
      setAvailable(false);
    }
    if (mData && typeof mData === 'object' && 'meetings' in mData) {
      setMeetings((mData as { meetings: MeetingView[] }).meetings);
    }
    setLoading(false);
  }, [enabled, proposalId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (url: string, body: unknown): Promise<boolean> => {
      const ok = await postJson(url, body);
      if (ok) await refresh();
      return ok;
    },
    [refresh],
  );

  return {
    sla,
    meetings,
    loading,
    available,
    refresh,
    pause: (reason, missingItems = [], reasonCode) =>
      act(`/api/proposals/${proposalId}/sla/pause`, { reason, missingItems, ...(reasonCode ? { reasonCode } : {}) }),
    resume: (confirmedItems = []) => act(`/api/proposals/${proposalId}/sla/resume`, { confirmedItems }),
    complete: (verdict) => act(`/api/proposals/${proposalId}/sla/complete`, { verdict }),
    requestMeeting: (objective, scheduledFor) => act(`/api/proposals/${proposalId}/meetings`, { objective, ...(scheduledFor ? { scheduledFor } : {}) }),
    meetingTransition: (meetingId, transition, note, scheduledFor) =>
      act(`/api/proposals/${proposalId}/meetings/${meetingId}/transition`, { transition, ...(note ? { note } : {}), ...(scheduledFor ? { scheduledFor } : {}) }),
  };
}
