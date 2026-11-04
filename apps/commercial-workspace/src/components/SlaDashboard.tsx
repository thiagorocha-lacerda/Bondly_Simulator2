import { useEffect, useState } from 'react';
import { Panel } from './Fields';
import type { ProposalView } from '../hooks/useProposals';
import type { SlaStateView } from '../hooks/useSla';

import type { Role } from '../hooks/roles';

/**
 * Painel de indicadores do SLA técnico (§6.6) — visão interna (P&T/admin).
 * Agrega o estado do relógio de cada proposta: aguardando/em andamento/pausadas/vencidas e o
 * percentual de pareceres concluídos dentro dos 5 dias úteis. Os dados vêm do BFF (/sla por proposta).
 *
 * Nota de escopo: agrega via N chamadas /sla (uma por proposta). No volume do simulador isto é
 * trivial; se a base crescer, um endpoint de agregação dedicado seria o próximo passo.
 */
interface DistView {
  readonly mean: number | null;
  readonly median: number | null;
  readonly p75: number | null;
  readonly p90: number | null;
}
interface IndicatorsView {
  readonly n: number;
  readonly slaBusinessDays: number;
  readonly effective: DistView;
  readonly raw: DistView;
  readonly pctWithinSla: number | null;
  readonly pausesByReason: readonly { reason: string; businessDays: number; proposals: number }[];
}

const fmt = (v: number | null): string => (v === null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));

/**
 * Indicadores P75/P90 (gestão) — vêm PRONTOS do servidor (/api/sla/indicators, pricing-engine puro).
 * Nenhum cálculo nem custo/margem aqui. Rótulos distinguem "tempo útil" (sem pausas; base do SLA) de
 * "tempo bruto" (início→conclusão, com pausas; só comparativo). Percentil: nearest-rank.
 */
export function SlaIndicatorsPanel({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<IndicatorsView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    if (!enabled) return;
    (async () => {
      try {
        const r = await fetch('/api/sla/indicators', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { indicators: IndicatorsView };
        if (alive) {
          setData(d.indicators);
          setState('ready');
        }
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <Panel
      title="Tempo de parecer técnico — P75 / P90"
      sub="Propostas com SLA concluído. Base: tempo útil efetivo em dias úteis (exclui pausas). Percentil nearest-rank."
    >
      {state === 'loading' && <p className="sub">Carregando indicadores…</p>}
      {state === 'error' && <p className="sub" role="alert">Não foi possível carregar os indicadores.</p>}
      {state === 'ready' && data && data.n === 0 && <p className="sub">Nenhuma proposta com SLA concluído ainda.</p>}
      {state === 'ready' && data && data.n > 0 && (
        <>
          <table style={{ width: '100%' }} aria-label="Indicadores de tempo de parecer">
            <thead>
              <tr>
                <th align="left">Base (n = {data.n})</th>
                <th align="right">Média</th>
                <th align="right">Mediana</th>
                <th align="right">P75</th>
                <th align="right">P90</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Tempo útil efetivo (dias úteis, sem pausas)</td>
                <td align="right">{fmt(data.effective.mean)}</td>
                <td align="right">{fmt(data.effective.median)}</td>
                <td align="right">{fmt(data.effective.p75)}</td>
                <td align="right">{fmt(data.effective.p90)}</td>
              </tr>
              <tr>
                <td>Tempo bruto (início → conclusão, com pausas)</td>
                <td align="right">{fmt(data.raw.mean)}</td>
                <td align="right">{fmt(data.raw.median)}</td>
                <td align="right">{fmt(data.raw.p75)}</td>
                <td align="right">{fmt(data.raw.p90)}</td>
              </tr>
            </tbody>
          </table>
          <p className="sub">
            Dentro de {data.slaBusinessDays} dias úteis (tempo útil): <b>{data.pctWithinSla === null ? '—' : `${fmt(data.pctWithinSla)}%`}</b>
          </p>
          {data.pausesByReason.length > 0 && (
            <details>
              <summary>Tempo em pausa por motivo (dias úteis)</summary>
              <ul className="sub">
                {data.pausesByReason.map((p) => (
                  <li key={p.reason}>{p.reason}: {p.businessDays} dia(s) em {p.proposals} proposta(s)</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Panel>
  );
}

export function SlaDashboard({ proposals, role, enabled }: { proposals: readonly ProposalView[]; role: Role; enabled: boolean }) {
  const [states, setStates] = useState<Record<string, SlaStateView>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!enabled || proposals.length === 0) {
      setLoaded(true);
      return;
    }
    (async () => {
      const entries = await Promise.all(
        proposals.map(async (p) => {
          try {
            const r = await fetch(`/api/proposals/${p.id}/sla`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!r.ok) return null;
            const data = (await r.json()) as { sla?: SlaStateView };
            return data.sla ? ([p.id, data.sla] as const) : null;
          } catch {
            return null;
          }
        }),
      );
      if (!alive) return;
      const map: Record<string, SlaStateView> = {};
      for (const e of entries) if (e) map[e[0]] = e[1];
      setStates(map);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [proposals, enabled]);

  // Business não vê indicadores de gestão (o servidor também nega: sla.view_indicators).
  if (role !== 'tech' && role !== 'admin' && role !== 'approver') return null;
  if (!enabled) return null;

  const all = Object.values(states);
  const running = all.filter((s) => s.phase === 'em_andamento');
  const paused = all.filter((s) => s.phase === 'pausado');
  const overdue = all.filter((s) => s.health === 'vencido');
  const completed = all.filter((s) => s.phase === 'concluido');
  const completedOnTime = completed.filter((s) => s.metSla === true);
  const pctOnTime = completed.length > 0 ? Math.round((completedOnTime.length / completed.length) * 100) : null;

  const Metric = ({ label, value, cls }: { label: string; value: string | number; cls?: string }) => (
    <div style={{ flex: '1 1 120px', padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
      <div className={`status ${cls ?? 'info'}`} style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div className="sub" style={{ margin: 0 }}>{label}</div>
    </div>
  );

  return (
    <>
    <SlaIndicatorsPanel enabled={enabled} />
    <Panel title="Indicadores de SLA técnico (§6.6)" sub="Visão interna P&T — tempo técnico efetivo (exclui pausas justificadas).">
      {!loaded && <p className="sub">Carregando indicadores…</p>}
      {loaded && all.length === 0 && <p className="sub">Nenhuma proposta com SLA iniciado ainda.</p>}
      {loaded && all.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Metric label="Em análise" value={running.length} cls="info" />
          <Metric label="Pausadas" value={paused.length} cls="info" />
          <Metric label="Vencidas" value={overdue.length} cls={overdue.length > 0 ? 'bad' : 'ok'} />
          <Metric label="Concluídas" value={completed.length} cls="ok" />
          <Metric label="% no prazo" value={pctOnTime === null ? '—' : `${pctOnTime}%`} cls={pctOnTime !== null && pctOnTime < 80 ? 'warn' : 'ok'} />
        </div>
      )}
    </Panel>
    </>
  );
}
