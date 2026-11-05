import { useState } from 'react';
import type { Role } from '../hooks/roles';

const MAX_REASON = 500;

const ERRORS: Record<string, string> = {
  reason_required: 'Informe a justificativa da reabertura.',
  text_too_long: 'Justificativa acima de 500 caracteres.',
  not_issued: 'Só propostas emitidas podem ser reabertas.',
  forbidden: 'Seu perfil não pode reabrir propostas.',
  not_found: 'Proposta não encontrada.',
  network: 'Falha de rede; tente novamente.',
};
const errText = (code: string): string => ERRORS[code] ?? 'Não foi possível reabrir a proposta.';

/**
 * G-025: ação "Reabrir proposta" — visível SÓ para approver/admin numa proposta EMITIDA. Exige justificativa.
 * O servidor é a fronteira (valida papel, estado e justificativa); aqui só oferecemos o fluxo para o papel certo.
 * Sem custo/margem expostos.
 */
export function ReopenProposal(props: {
  proposalId: string;
  status: string;
  role: Role;
  reopen: (id: string, reason: string) => Promise<string | null>;
}) {
  const { proposalId, status, role, reopen } = props;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Espelho do servidor (fronteira real): só approver/admin, só proposta emitida.
  if (!(role === 'approver' || role === 'admin') || status !== 'emitido') return null;

  async function submit() {
    setBusy(true);
    setMsg(null);
    const err = await reopen(proposalId, reason);
    setBusy(false);
    if (err === null) {
      setOpen(false);
      setReason('');
    } else {
      setMsg(errText(err));
    }
  }

  if (!open) {
    return (
      <button type="button" className="ghostbtn" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>
        Reabrir proposta
      </button>
    );
  }
  return (
    <form
      aria-label="Reabrir proposta emitida"
      style={{ display: 'grid', gap: 6, marginTop: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="sub" style={{ margin: 0 }}>
        A reabertura cria uma <b>nova versão</b> editável; a proposta emitida permanece preservada e imutável.
      </p>
      <label htmlFor={`reopen-${proposalId}`}>Justificativa da reabertura</label>
      <textarea
        id={`reopen-${proposalId}`}
        value={reason}
        maxLength={MAX_REASON}
        rows={3}
        onChange={(e) => setReason(e.target.value)}
      />
      <span className="sub" style={{ margin: 0 }}>{reason.length}/{MAX_REASON}</span>
      {msg && <div className="note bad" role="alert">{msg}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="cta" disabled={busy || !reason.trim()}>Confirmar reabertura</button>
        <button type="button" className="ghostbtn" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}
