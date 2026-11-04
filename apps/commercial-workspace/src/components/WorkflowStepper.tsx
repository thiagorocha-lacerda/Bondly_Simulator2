import { useState } from 'react';
import { Panel } from './Fields';
import type { ProposalView, UseProposals } from '../hooks/useProposals';
import { SlaCard } from './SlaCard';
import { SlaDashboard } from './SlaDashboard';

import type { Role } from '../hooks/roles';
import { RequestApproval } from './ApprovalPanels';

/** Fases da esteira na ordem (§9) + rótulo e responsável. */
const PHASES: readonly { state: string; label: string; owner: string }[] = [
  { state: 'rascunho_comercial', label: 'Rascunho comercial', owner: 'Negócios' },
  { state: 'aguardando_analise_tecnica', label: 'Aguardando análise', owner: 'Negócios → P&T' },
  { state: 'em_analise_tecnica', label: 'Em análise técnica', owner: 'P&T' },
  { state: 'aprovado_tecnicamente', label: 'Aprovado tecnicamente', owner: 'P&T' },
  { state: 'pronto_para_emissao', label: 'Pronto para emissão', owner: 'Negócios' },
  { state: 'emitido', label: 'Emitido', owner: 'Negócios' },
];

/** Ações disponíveis por estado+papel (espelha a tabela de transições do servidor). */
function actionsFor(status: string, role: Role): readonly { name: string; label: string }[] {
  if (role === 'business') {
    if (status === 'rascunho_comercial' || status === 'ajustes_solicitados') return [{ name: 'submeter_analise', label: 'Enviar para análise técnica' }];
    if (status === 'reprovado') return [{ name: 'retomar', label: 'Retomar e corrigir' }];
    if (status === 'aprovado_tecnicamente') return [{ name: 'consolidar', label: 'Consolidar proposta' }];
    if (status === 'pronto_para_emissao') return [{ name: 'emitir', label: 'Emitir proposta' }];
  }
  if (role === 'tech') {
    if (status === 'aguardando_analise_tecnica') return [{ name: 'iniciar_analise', label: 'Iniciar análise' }];
    if (status === 'em_analise_tecnica')
      return [
        { name: 'aprovar_tecnico', label: 'Aprovar tecnicamente' },
        { name: 'solicitar_ajustes', label: 'Solicitar ajustes' },
        { name: 'reprovar', label: 'Reprovar' },
      ];
  }
  return [];
}

const STATUS_CLASS: Record<string, string> = {
  emitido: 'ok',
  aprovado_tecnicamente: 'ok',
  reprovado: 'bad',
  ajustes_solicitados: 'warn',
  em_analise_tecnica: 'info',
  aguardando_analise_tecnica: 'info',
  pronto_para_emissao: 'ok',
  rascunho_comercial: 'info',
  aguardando_aprovacao_gestor: 'warn',
};

/** G-006: sub-estado fora da sequência linear; o SLA segue correndo enquanto aguarda. */
const AWAITING = { state: 'aguardando_aprovacao_gestor', label: 'Aguardando aprovação do gestor', owner: 'Gestor/Aprovador' } as const;

/**
 * Esteira Negócios→P&T (§5/§9): stepper por fase, status/responsável por proposta e as ações
 * permitidas ao papel atual. As transições são validadas no servidor; aqui só oferecemos as do papel.
 */
export function WorkflowStepper(props: { role: Role; proposals: UseProposals }) {
  const { role, proposals } = props;
  const [busy, setBusy] = useState<string | null>(null);

  if (!proposals.available) {
    return (
      <Panel title="Esteira comercial → técnica" sub="Processo colaborativo Negócios → Projetos & Tecnologia.">
        <p className="sub">
          A esteira usa as APIs do servidor (BFF). Em ambiente sem o proxy (dev direto no Vite) ela
          fica indisponível — acesse pela URL do Web Service para usar o fluxo completo.
        </p>
      </Panel>
    );
  }

  async function act(p: ProposalView, name: string) {
    setBusy(p.id + name);
    await proposals.transition(p.id, p.version, name);
    setBusy(null);
  }

  return (
    <Panel title="Esteira comercial → técnica" sub="Processo colaborativo com etapas, responsáveis e status (§5).">
      <div className="field full" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {role === 'business' && (
          <button
            type="button"
            className="cta"
            disabled={busy === 'new'}
            onClick={async () => {
              setBusy('new');
              await proposals.create({});
              setBusy(null);
            }}
          >
            Nova oportunidade
          </button>
        )}
        <span className="sub" style={{ margin: 0 }}>{proposals.proposals.length} proposta(s)</span>
      </div>

      {proposals.loading && <p className="sub">Carregando…</p>}

      <SlaDashboard proposals={proposals.proposals} role={role} enabled={proposals.available} />

      {proposals.proposals.map((p) => {
        const idx = PHASES.findIndex((f) => f.state === p.status);
        const phase = p.status === AWAITING.state ? AWAITING : PHASES.find((f) => f.state === p.status);
        const acts = actionsFor(p.status, role);
        return (
          <div key={p.id} className="field full" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <b>{p.id}</b>
              <span className={`status ${STATUS_CLASS[p.status] ?? 'info'}`}>{phase?.label ?? p.status}</span>
            </div>

            {/* stepper por fase */}
            <div className="stepper-dots" style={{ display: 'flex', gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
              {PHASES.filter((f) => f.state !== 'ajustes_solicitados').map((f, i) => (
                <span
                  key={f.state}
                  title={`${f.label} · ${f.owner}`}
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    background: i <= idx ? 'var(--btn-primary-bg)' : 'transparent',
                    color: i <= idx ? 'var(--btn-primary-text)' : 'var(--text-secondary, inherit)',
                  }}
                >
                  {f.label}
                </span>
              ))}
              {p.status === AWAITING.state && (
                <span title={`${AWAITING.label} · o SLA não é pausado`} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}>
                  {AWAITING.label}
                </span>
              )}
            </div>

            <div className="sub" style={{ margin: '4px 0' }}>
              Responsável atual: <b>{phase?.owner ?? '—'}</b> · atualizado {new Date(p.updatedAt).toLocaleString('pt-BR')}
              {p.technicalSummary && <> · {p.technicalSummary}</>}
            </div>

            {acts.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                {acts.map((a) => (
                  <button key={a.name} type="button" className="ghostbtn" disabled={busy === p.id + a.name} onClick={() => act(p, a.name)}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}

            <RequestApproval proposalId={p.id} version={p.version} status={p.status} role={role} onDone={() => void proposals.refresh()} />

            {/* SLA técnico (§6): relógio + ações de P&T + reuniões */}
            <SlaCard proposalId={p.id} role={role} enabled={proposals.available} />
          </div>
        );
      })}
    </Panel>
  );
}
