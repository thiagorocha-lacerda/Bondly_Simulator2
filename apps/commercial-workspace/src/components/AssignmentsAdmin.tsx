import { useCallback, useEffect, useState } from 'react';
import { Panel } from './Fields';
import { ALL_ROLES, ROLE_LABELS, type Role } from '../hooks/roles';

interface Assignment {
  readonly email: string;
  readonly role: Role;
  readonly assignedBy: string;
  readonly assignedAt: string;
}
interface AuditRow {
  readonly id: string;
  readonly targetEmail: string;
  readonly actorEmail: string;
  readonly fromRole: Role | null;
  readonly toRole: Role | null;
  readonly at: string;
}

const ERRORS: Record<string, string> = {
  email_not_allowed: 'E-mail fora dos domínios autorizados.',
  invalid_role: 'Perfil inválido.',
  last_admin: 'Não é possível remover ou rebaixar o último Administrador.',
  forbidden: 'Sem permissão.',
};

const roleText = (r: Role | null): string => (r ? ROLE_LABELS[r] : 'sem perfil');

/**
 * Gestão de atribuições de perfil (somente Administrador). A tela só consome /api/admin/assignments;
 * a autorização e a validação de domínio são do SERVIDOR (esta UI não decide nada).
 */
export function AssignmentsAdmin() {
  const [assignments, setAssignments] = useState<readonly Assignment[]>([]);
  const [audit, setAudit] = useState<readonly AuditRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('business');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/assignments', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!r.ok) {
        setState('error');
        return;
      }
      const d = (await r.json()) as { assignments: Assignment[]; audit: AuditRow[] };
      setAssignments(d.assignments);
      setAudit(d.audit);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(target: string, next: Role | null) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/admin/assignments', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: target, role: next }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setMsg(ERRORS[d.error ?? ''] ?? 'Não foi possível salvar.');
      } else {
        setEmail('');
        await load();
      }
    } catch {
      setMsg('Falha de rede ao salvar.');
    }
    setBusy(false);
  }

  return (
    <Panel title="Gestão de perfis (Administrador)" sub="Cada pessoa recebe um perfil individual. Toda alteração é auditada (quem, quando, de → para).">
      {state === 'loading' && <p className="sub">Carregando atribuições…</p>}
      {state === 'error' && <p className="sub" role="alert">Não foi possível carregar as atribuições.</p>}
      {state === 'ready' && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void save(email.trim(), role);
            }}
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <div className="field">
              <label htmlFor="assign-email">E-mail corporativo</label>
              <input id="assign-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="assign-role">Perfil</label>
              <select id="assign-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <button className="cta" type="submit" disabled={busy || !email.trim()}>Atribuir perfil</button>
          </form>
          {msg && <p className="sub" role="alert" style={{ color: 'var(--error)' }}>{msg}</p>}

          {assignments.length === 0 ? (
            <p className="sub">Nenhuma atribuição ainda.</p>
          ) : (
            <table style={{ width: '100%', marginTop: 10 }}>
              <thead>
                <tr><th align="left">Usuário</th><th align="left">Perfil</th><th align="left">Atribuído por</th><th /></tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.email}>
                    <td>{a.email}</td>
                    <td>{ROLE_LABELS[a.role]}</td>
                    <td>{a.assignedBy}</td>
                    <td>
                      <button type="button" disabled={busy} onClick={() => void save(a.email, null)} aria-label={`Revogar perfil de ${a.email}`}>
                        Revogar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <OwnerReassign />

          <details style={{ marginTop: 10 }}>
            <summary>Auditoria de atribuições ({audit.length})</summary>
            <ul className="sub">
              {[...audit].reverse().map((a) => (
                <li key={a.id}>
                  {a.at} — {a.actorEmail}: {a.targetEmail} {roleText(a.fromRole)} → {roleText(a.toRole)}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Panel>
  );
}

const OWNER_ERRORS: Record<string, string> = {
  email_not_allowed: 'E-mail inválido ou fora dos domínios autorizados.',
  not_found: 'Proposta não encontrada.',
  forbidden: 'Sem permissão.',
  version_conflict: 'A proposta mudou; tente novamente.',
  version_required: 'Versão da proposta ausente; tente novamente.',
  new_owner_without_role: 'O novo dono não tem perfil atribuído. Atribua o perfil Negócios antes.',
  new_owner_not_business: 'O novo dono precisa ter o perfil Negócios.',
};

/** G-002: reatribuição de dono de proposta (admin). A autorização e a validação do e-mail são do SERVIDOR. */
function OwnerReassign() {
  const [proposalId, setProposalId] = useState('');
  const [owner, setOwner] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      // G-022: a reatribuição exige `version` (lock otimista): lê a versão atual e a envia no PUT.
      const url = `/api/admin/proposals/${encodeURIComponent(proposalId.trim())}/owner`;
      const cur = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const curBody = (await cur.json().catch(() => ({}))) as { version?: number; error?: string };
      if (!cur.ok || typeof curBody.version !== 'number') {
        setMsg({ text: OWNER_ERRORS[curBody.error ?? ''] ?? (cur.status === 404 ? 'Proposta não encontrada.' : 'Não foi possível ler a proposta.'), ok: false });
        setBusy(false);
        return;
      }
      const r = await fetch(url, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ownerEmail: owner.trim(), version: curBody.version }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; changed?: boolean };
      if (!r.ok) setMsg({ text: OWNER_ERRORS[d.error ?? ''] ?? 'Não foi possível reatribuir.', ok: false });
      else {
        setMsg({ text: d.changed === false ? 'A proposta já pertence a este dono.' : 'Dono reatribuído e auditado.', ok: true });
        setOwner('');
      }
    } catch {
      setMsg({ text: 'Falha de rede ao reatribuir.', ok: false });
    }
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 14 }}>
      <h4 style={{ margin: '0 0 4px' }}>Reatribuir dono de proposta</h4>
      <p className="sub">Somente o dono (Negócios) edita a própria proposta. Use quando o responsável sair ou mudar de área; a troca é auditada.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (proposalId.trim() && owner.trim()) void submit();
        }}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        <div className="field">
          <label htmlFor="owner-proposal">Proposta (ID)</label>
          <input id="owner-proposal" value={proposalId} onChange={(e) => setProposalId(e.target.value)} placeholder="BONDLY-2027-000001" />
        </div>
        <div className="field">
          <label htmlFor="owner-email">Novo dono (e-mail)</label>
          <input id="owner-email" type="email" value={owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
        <button className="cta" type="submit" disabled={busy || !proposalId.trim() || !owner.trim()}>Reatribuir dono</button>
      </form>
      {msg && (
        <p className="sub" role={msg.ok ? 'status' : 'alert'} style={msg.ok ? undefined : { color: 'var(--error)' }}>{msg.text}</p>
      )}
    </div>
  );
}
