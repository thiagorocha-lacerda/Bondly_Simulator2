import { useState } from 'react';
import { useSla } from '../hooks/useSla';
import { PAUSE_REASONS, MAX_PAUSE_REASON_CHARS } from '../hooks/pauseReasons';

import type { Role } from '../hooks/roles';

const HEALTH_LABEL: Record<string, { text: string; cls: string }> = {
  no_prazo: { text: 'No prazo', cls: 'ok' },
  atencao: { text: 'Atenção', cls: 'warn' },
  vencido: { text: 'Vencido', cls: 'bad' },
  pausado: { text: 'Pausado', cls: 'info' },
  concluido: { text: 'Concluído', cls: 'ok' },
  nao_iniciado: { text: 'Não iniciado', cls: 'info' },
};

const VERDICTS: readonly { v: string; label: string }[] = [
  { v: 'aprovado', label: 'Aprovado' },
  { v: 'aprovado_com_ressalvas', label: 'Aprovado com ressalvas' },
  { v: 'ajustes_necessarios', label: 'Ajustes necessários' },
  { v: 'inviavel', label: 'Inviável' },
];

const MEETING_NEXT: Record<string, readonly { t: string; label: string }[]> = {
  solicitada: [{ t: 'iniciar_agendamento', label: 'Iniciar agendamento' }, { t: 'cancelar', label: 'Cancelar' }],
  em_agendamento: [{ t: 'agendar', label: 'Marcar como agendada' }, { t: 'cancelar', label: 'Cancelar' }],
  agendada: [{ t: 'realizar', label: 'Marcar como realizada' }, { t: 'cancelar', label: 'Cancelar' }],
  realizada: [{ t: 'aguardar_insumos', label: 'Aguardar insumos' }, { t: 'retomar_avaliacao', label: 'Retomar avaliação' }],
  aguardando_insumos: [{ t: 'receber_insumos', label: 'Insumos recebidos' }, { t: 'cancelar', label: 'Cancelar' }],
  insumos_recebidos: [{ t: 'retomar_avaliacao', label: 'Retomar avaliação' }],
};

/**
 * Cartão de SLA técnico de uma proposta (§6). Mostra o relógio (dias úteis restantes + status),
 * e — só para P&T/admin — as ações de pausar/retomar/concluir e o fluxo de reunião técnica.
 * A visão de Negócios (§6.6) vê status e previsão, sem os controles técnicos.
 */
export function SlaCard({ proposalId, role, enabled }: { proposalId: string; role: Role; enabled: boolean }) {
  const s = useSla(proposalId, enabled);
  const [busy, setBusy] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [objective, setObjective] = useState('');

  if (!s.available || !s.sla) return null;
  const sla = s.sla;
  const canManage = role === 'tech' || role === 'admin';
  const health = HEALTH_LABEL[sla.health] ?? HEALTH_LABEL.nao_iniciado!;

  async function run(fn: () => Promise<boolean>) {
    setBusy(true);
    await fn();
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--panel-2, transparent)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>SLA técnico (5 dias úteis)</b>
        <span className={`status ${health.cls}`}>{health.text}</span>
      </div>

      {sla.phase !== 'nao_iniciado' && (
        <div className="sub" style={{ margin: '6px 0' }}>
          {sla.businessDaysRemaining} dia(s) útil(eis) restante(s) · consumido {sla.businessDaysElapsed}
          {sla.dueAt && <> · previsão {new Date(sla.dueAt).toLocaleDateString('pt-BR')}</>}
          {sla.phase === 'pausado' && sla.pauseReason && <> · pausado: {sla.pauseReason}</>}
          {sla.phase === 'concluido' && (
            <> · parecer <b>{sla.verdict}</b> {sla.metSla ? '(no prazo)' : '(fora do prazo)'}</>
          )}
        </div>
      )}
      {sla.phase === 'nao_iniciado' && <div className="sub" style={{ margin: '6px 0' }}>Inicia ao enviar para análise técnica.</div>}

      {/* Controles técnicos — só P&T/admin (§6.6) */}
      {canManage && sla.phase === 'em_andamento' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
          <select
            aria-label="Motivo da pausa (categoria)"
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text, inherit)' }}
          >
            <option value="">Selecione o motivo…</option>
            {PAUSE_REASONS.map((r) => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
          <input
            type="text"
            maxLength={MAX_PAUSE_REASON_CHARS}
            placeholder="Detalhe da pausa (obrigatório)"
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            style={{ flex: '1 1 180px', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text, inherit)' }}
          />
          <button type="button" className="ghostbtn" disabled={busy || !reasonCode || !pauseReason.trim()} onClick={() => run(async () => { const ok = await s.pause(pauseReason.trim(), [], reasonCode); if (ok) { setPauseReason(''); setReasonCode(''); } return ok; })}>
            Pausar relógio
          </button>
          {VERDICTS.map((v) => (
            <button key={v.v} type="button" className="ghostbtn" disabled={busy} onClick={() => run(() => s.complete(v.v))} title={`Emitir parecer: ${v.label}`}>
              {v.label}
            </button>
          ))}
        </div>
      )}
      {canManage && sla.phase === 'pausado' && (
        <button type="button" className="ghostbtn" disabled={busy} style={{ marginTop: 6 }} onClick={() => run(() => s.resume())}>
          Retomar relógio
        </button>
      )}

      {/* Reunião técnica — só P&T/admin */}
      {canManage && (sla.phase === 'em_andamento' || sla.phase === 'pausado') && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Objetivo da reunião técnica"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            style={{ flex: '1 1 180px', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text, inherit)' }}
          />
          <button type="button" className="ghostbtn" disabled={busy || !objective.trim()} onClick={() => run(async () => { const ok = await s.requestMeeting(objective.trim()); if (ok) setObjective(''); return ok; })}>
            Solicitar reunião (não pausa o SLA)
          </button>
        </div>
      )}

      {s.meetings.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="sub" style={{ marginBottom: 4 }}>Reuniões técnicas:</div>
          {s.meetings.map((m) => (
            <div key={m.id} className="sub" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '3px 0' }}>
              <span className="status info">{m.state}</span>
              <span>{m.objective}</span>
              {canManage && (MEETING_NEXT[m.state] ?? []).map((n) => (
                <button
                  key={n.t}
                  type="button"
                  className="ghostbtn"
                  disabled={busy}
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => run(() => s.meetingTransition(m.id, n.t, n.t === 'cancelar' ? 'cancelada pela equipe técnica' : undefined))}
                >
                  {n.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
