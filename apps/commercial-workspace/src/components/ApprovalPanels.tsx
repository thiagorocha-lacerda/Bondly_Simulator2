import { useCallback, useEffect, useState } from 'react';
import { Panel } from './Fields';
import type { Role } from '../hooks/roles';

/** G-006: tipos de solicitação e rótulos pt-BR (espelha o enum do servidor; o servidor valida). */
export const APPROVAL_KIND_LABELS: Readonly<Record<string, string>> = {
  excecao_comercial: 'Exceção comercial',
  alteracao_escopo: 'Alteração de escopo',
  replanejamento_sla: 'Replanejamento de SLA',
};
const KINDS_BY_ROLE: Readonly<Record<string, readonly string[]>> = {
  business: ['excecao_comercial', 'alteracao_escopo'],
  tech: ['replanejamento_sla'],
};
/** Estados em que o servidor aceita solicitar (espelho de APPROVAL_REQUEST_FROM; o servidor é a fronteira). */
const REQUESTABLE = ['aguardando_analise_tecnica', 'em_analise_tecnica', 'ajustes_solicitados', 'aprovado_tecnicamente', 'pronto_para_emissao'];
const MAX_JUSTIFICATION = 500;

const ERRORS: Record<string, string> = {
  justification_required: 'Informe a justificativa.',
  text_too_long: 'Justificativa acima de 500 caracteres.',
  version_conflict: 'A proposta mudou; atualize e tente novamente.',
  approval_pending_exists: 'Já existe uma solicitação pendente para esta proposta.',
  approval_invalid_from: 'O estado atual da proposta não permite solicitar aprovação.',
  approval_wrong_role: 'Seu perfil não pode solicitar este tipo.',
  forbidden: 'Sem permissão.',
  self_decision_forbidden: 'Você não pode decidir a própria solicitação.',
  decision_conflict: 'Esta solicitação já foi decidida de outra forma.',
  approval_invalidated: 'Solicitação invalidada por mudança material; é necessária uma nova.',
  not_found: 'Solicitação não encontrada.',
};
const errText = (d: { error?: string }): string => ERRORS[d.error ?? ''] ?? 'Não foi possível concluir a operação.';

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: { error?: string } }> {
  try {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, data: (await r.json().catch(() => ({}))) as { error?: string } };
  } catch {
    return { ok: false, data: { error: 'network' } };
  }
}

/** Botão "Solicitar aprovação" (Negócios/P&T): tipo + justificativa. O servidor valida papel, tipo, estado e versão. */
export function RequestApproval(props: { proposalId: string; version: number; status: string; role: Role; onDone: () => void }) {
  const { proposalId, version, status, role, onDone } = props;
  const kinds = KINDS_BY_ROLE[role] ?? [];
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(kinds[0] ?? '');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (kinds.length === 0 || !REQUESTABLE.includes(status)) return null;

  async function submit() {
    setBusy(true);
    setMsg(null);
    const r = await postJson(`/api/proposals/${encodeURIComponent(proposalId)}/approval-requests`, { kind, justification: text, version });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setText('');
      onDone();
    } else setMsg(errText(r.data));
  }

  if (!open) {
    return (
      <button type="button" className="ghostbtn" onClick={() => setOpen(true)}>
        Solicitar aprovação
      </button>
    );
  }
  return (
    <form
      aria-label="Solicitar aprovação do gestor"
      style={{ display: 'grid', gap: 6, marginTop: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={`kind-${proposalId}`}>Tipo da solicitação</label>
      <select id={`kind-${proposalId}`} value={kind} onChange={(e) => setKind(e.target.value)}>
        {kinds.map((k) => (
          <option key={k} value={k}>{APPROVAL_KIND_LABELS[k]}</option>
        ))}
      </select>
      <label htmlFor={`just-${proposalId}`}>Justificativa</label>
      <textarea id={`just-${proposalId}`} value={text} maxLength={MAX_JUSTIFICATION} onChange={(e) => setText(e.target.value)} rows={3} />
      <span className="sub" style={{ margin: 0 }}>{text.length}/{MAX_JUSTIFICATION}</span>
      {msg && <div className="note bad" role="alert">{msg}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="cta" disabled={busy || !text.trim()}>Enviar solicitação</button>
        <button type="button" className="ghostbtn" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}

interface QueueItem {
  readonly id: string;
  readonly proposalId: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly requestedBy: string;
  readonly justification: string;
  readonly ageHours: number;
}

/** Fila do Gestor/Aprovador (filtrada no servidor) + decisão aprovar/rejeitar com justificativa. Sem custo/margem. */
export function ApproverQueue(props: { enabled: boolean }) {
  const [items, setItems] = useState<readonly QueueItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/approvals/pending', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('http');
      setItems(((await r.json()) as { requests: QueueItem[] }).requests);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    if (props.enabled) void load();
  }, [props.enabled, load]);
  if (!props.enabled) return null;

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setMsg(null);
    const r = await postJson(`/api/approval-requests/${encodeURIComponent(id)}/decision`, { decision, justification: notes[id] ?? '' });
    if (!r.ok) setMsg(errText(r.data));
    await load();
  }

  return (
    <Panel title="Aprovações pendentes" sub="Solicitações de exceção, alteração de escopo e replanejamento aguardando sua decisão.">
      {state === 'loading' && <p className="sub">Carregando…</p>}
      {state === 'error' && <div className="note bad" role="alert">Não foi possível carregar as solicitações.</div>}
      {state === 'ready' && items.length === 0 && <p className="sub">Nenhuma solicitação pendente.</p>}
      {msg && <div className="note bad" role="alert">{msg}</div>}
      {items.map((it) => (
        <div key={it.id} className="field full" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div><b>{it.kindLabel}</b> · {it.proposalId}</div>
          <div className="sub" style={{ margin: '2px 0' }}>Solicitante: {it.requestedBy} · há {it.ageHours} h</div>
          <p style={{ margin: '4px 0' }}>{it.justification}</p>
          <label htmlFor={`dec-${it.id}`}>Justificativa da decisão</label>
          <textarea id={`dec-${it.id}`} rows={2} maxLength={MAX_JUSTIFICATION} value={notes[it.id] ?? ''} onChange={(e) => setNotes({ ...notes, [it.id]: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="cta" onClick={() => void decide(it.id, 'approved')}>Aprovar</button>
            <button type="button" className="ghostbtn" disabled={!(notes[it.id] ?? '').trim()} title="A rejeição exige justificativa" onClick={() => void decide(it.id, 'rejected')}>Rejeitar</button>
          </div>
        </div>
      ))}
    </Panel>
  );
}
