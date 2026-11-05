import { useEffect, useRef, useState } from 'react';
import type { PricingInput, B2cInput, ModuleId, ProposalSnapshot } from '@bondly/pricing-types';
import { brl } from '../services/defaults';
import { useAudience } from '../app/audience';
import { loadDevEngine, projectQuotePreview } from '../services/pricing/devEngine';

/** Formata o identificador BONDLY-2027-NNNNNN sem depender do engine (função trivial pura). */
function formatProposalId(sequence: number, year = 2027): string {
  return `BONDLY-${year}-${String(sequence).padStart(6, '0')}`;
}

const SEQ_KEY = 'bondly-proposal-seq';

/** Próximo número da sequência SEM persistir (só leitura). Consumir via commitSequence após sucesso. */
function peekNextSequence(): number {
  try {
    return Number(localStorage.getItem(SEQ_KEY) ?? '0') + 1;
  } catch {
    return Math.floor(Math.random() * 999999) + 1;
  }
}

/** Persiste o número consumido — chamado SÓ após o PDF gerar com sucesso, para não queimar IDs. */
function commitSequence(n: number): void {
  try {
    localStorage.setItem(SEQ_KEY, String(n));
  } catch {
    /* ignore */
  }
}

/**
 * Fluxo PRÉ-VISUALIZAR → CONFERIR → CONFIRMAR → GERAR PDF (§16).
 * A pré-visualização usa um snapshot PROVISÓRIO (sem consumir a sequência de identificadores).
 * A sequência `BONDLY-2027-NNNNNN` só é consumida ao GERAR o PDF — abrir/cancelar não queima IDs (§15).
 */
export function PreviewModal(props: {
  input: PricingInput;
  b2cInput?: B2cInput | undefined;
  selectedModules?: readonly ModuleId[];
  onClose: () => void;
}) {
  const { internal } = useAudience();
  // G-001 (ADR docs/15): snapshot/PDF dependem do engine (premissas de custo + margem). Em PRODUÇÃO o engine
  // não está no bundle — a pré-visualização e o PDF por `QuoteView` projetado são Fase 4 (PENDENTE). DEV gera o
  // snapshot localmente via engine sob demanda; PROD mostra aviso claro e desabilita a geração.
  const [preview, setPreview] = useState<ProposalSnapshot | null>(null);
  useEffect(() => {
    // G-001: guard LITERAL para DCE no build de produção (remove o acesso a `eng.createProposalSnapshot`).
    if (!import.meta.env.DEV) return undefined;
    let alive = true;
    void loadDevEngine().then((eng) => {
      if (!alive) return;
      setPreview(
        eng.createProposalSnapshot({
          id: formatProposalId(0),
          input: props.input,
          ...(props.b2cInput ? { b2cInput: props.b2cInput } : {}),
          ...(props.selectedModules ? { selectedModules: props.selectedModules } : {}),
        }) as unknown as ProposalSnapshot,
      );
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issuedId, setIssuedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const r = preview?.result ?? null;
  const hasClient = !!preview?.input.arka?.clientName?.trim();

  // Acessibilidade: ao fechar o modal, devolve o foco ao elemento que o abriu (evita armadilha
  // de teclado) e permite fechar com Esc. O foco inicial vai ao diálogo.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gera o PDF ANTES de consumir a sequência: se a geração falhar, nenhum identificador é
  // queimado (o próximo clique reusa o mesmo número). Só persiste o contador no sucesso.
  // `kind` escolhe a peça: 'external' (cliente) ou 'internal' (completa).
  const download = async (kind: 'internal' | 'external') => {
    // G-001: geração de PDF depende do engine (DEV). Guard LITERAL para o Rollup remover TODO o corpo —
    // incluindo `eng.createProposalSnapshot` e o import de `../services/pdf` — no build de produção.
    if (!import.meta.env.DEV) return;
    setBusy(true);
    setError(null);
    try {
      const n = peekNextSequence();
      const id = formatProposalId(n);
      // G-001 Fase 4: o PDF é montado a partir do QuoteView PROJETADO POR PERFIL (a mesma fonte das telas),
      // NÃO de um ProposalSnapshot do engine. Em DEV projetamos localmente (projectQuotePreview, espelho do
      // servidor); em produção o QuoteView vem do fio. REGRA DE VIEW (F-PDF-04, decisão de produto do sponsor):
      // o PDF EXTERNO entregue ao cliente usa a view 'client' (peça enxuta — SEM composição de preço, waterfall
      // de descontos nem alçada); o PDF INTERNO (botão gated por audience interna / proposal.see_internal) usa
      // 'internal' (composição completa, margens, ARKA). A view 'commercial' não é mais exercitada pela UI.
      // Nenhuma das views de cliente carrega custo/margem no payload (fronteira estrutural). O gerador NÃO toca o engine.
      const eng = await loadDevEngine();
      const snap = eng.createProposalSnapshot({
        id,
        input: props.input,
        ...(props.b2cInput ? { b2cInput: props.b2cInput } : {}),
        ...(props.selectedModules ? { selectedModules: props.selectedModules } : {}),
      }) as unknown as ProposalSnapshot;
      const view = projectQuotePreview(
        kind === 'internal' ? 'internal' : 'client',
        snap.result,
        snap.input.negotiation.term,
        snap.scenarios.map((s) => ({ name: s.name, result: s.result })),
      );
      const { generateQuotePdf } = await import('../services/pdf');
      const doc = await generateQuotePdf(view, {
        id,
        issuedAt: snap.issuedAt,
        ...(props.input.arka?.clientName?.trim() ? { clientName: props.input.arka.clientName } : {}),
        ...(props.selectedModules ? { selectedModules: props.selectedModules } : {}),
        users: props.input.volume.users,
      });
      const suffix = kind === 'internal' ? '-INTERNO' : '';
      doc.save(`${snap.id}${suffix}.pdf`);
      commitSequence(n); // consome o número só agora, após sucesso
      setIssuedId(id);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Não foi possível gerar o PDF: ${e.message}. Nenhum identificador foi consumido — tente novamente.`
          : 'Não foi possível gerar o PDF. Nenhum identificador foi consumido — tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pdfmodal-backdrop" role="dialog" aria-modal="true" aria-label="Pré-visualização da proposta" onClick={props.onClose}>
      <div className="pdfmodal" ref={dialogRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h2>Pré-visualizar proposta</h2>
        {!preview || !r ? (
          <>
            <p className="sub" role="status">
              A pré-visualização e a geração de PDF são consolidadas no servidor a partir do QuoteView projetado
              por perfil (Fase 4 — pendente). Indisponível neste ambiente.
            </p>
            <div className="actions">
              <button className="ghostbtn" type="button" onClick={props.onClose}>Fechar</button>
            </div>
          </>
        ) : (
          <>
        <p className="sub">
          Identificador <b>{issuedId ?? 'definido ao gerar o PDF'}</b> · motor {r.engineVersion} · premissas {r.premisesVersion} ({r.premisesHash})
        </p>
        <table className="bd">
          <tbody>
            <tr><td>Cliente</td><td className="num">{preview.input.arka?.clientName || '—'}</td></tr>
            <tr><td>Tier · usuários</td><td className="num">{r.tierName} · {preview.input.volume.users.toLocaleString('pt-BR')}</td></tr>
            <tr><td>Prazo</td><td className="num">{preview.input.negotiation.term} meses</td></tr>
            <tr className="sum"><td>Setup</td><td className="num">{brl(r.setupClient)}</td></tr>
            <tr><td>Valor mensal estimado</td><td className="num">{brl(r.core + r.servicesMrr)}/mês</td></tr>
            <tr className="sum"><td>TCV ao cliente</td><td className="num">{brl(r.tcvClient)}</td></tr>
            {preview.b2c && (
              internal ? (
                <tr><td>Assinaturas B2C · resultado Bondly H2</td><td className="num">{brl(preview.b2c.result.tot.total)}</td></tr>
              ) : (
                // Visão comercial: NÃO expõe o resultado Bondly (número interno). Só volume ao cliente.
                <tr><td>Assinaturas B2C · ativos em dez</td><td className="num">{preview.b2c.result.tot.end.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td></tr>
              )
            )}
          </tbody>
        </table>

        {!hasClient && (
          <div className="note" role="alert" style={{ marginTop: 12 }}>
            Sem cliente nomeado — a proposta sairá sem identificação do cliente. Preencha o campo
            “Cliente” se for enviá-la externamente.
          </div>
        )}
        {issuedId && !error && (
          <div className="note ok" role="status" aria-live="polite" style={{ marginTop: 12 }}>
            PDF gerado: <b>{issuedId}</b>. Verifique os downloads do navegador.
          </div>
        )}
        {error && (
          <div className="note bad" role="alert" style={{ marginTop: 12 }}>{error}</div>
        )}

        <label className="field full" style={{ cursor: 'pointer', marginTop: 12 }}>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="checkbox" checked={confirmed} style={{ width: 'auto' }} onChange={(e) => setConfirmed(e.target.checked)} />
            <b>Conferi os valores e confirmo a geração do PDF.</b>
          </span>
        </label>

        <div className="actions">
          <button className="cta" type="button" disabled={!confirmed || busy} onClick={() => void download('external')} style={{ opacity: confirmed && !busy ? 1 : 0.5 }}>
            {busy ? 'Gerando…' : 'Gerar PDF do cliente'}
          </button>
          {internal && (
            <button className="ghostbtn" type="button" disabled={!confirmed || busy} onClick={() => void download('internal')} style={{ opacity: confirmed && !busy ? 1 : 0.5 }}>
              Gerar PDF interno (completo)
            </button>
          )}
          <button className="ghostbtn" type="button" onClick={props.onClose}>
            {issuedId && !error ? 'Fechar' : 'Cancelar'}
          </button>
        </div>
        <p className="sub" style={{ marginTop: 10 }}>
          {internal
            ? 'O PDF do cliente omite custos, margens e dados internos. O PDF interno traz a composição completa, margens e ARKA.'
            : 'Este snapshot é imutável: alterar a proposta depois de confirmar gera uma nova revisão.'}
        </p>
          </>
        )}
      </div>
    </div>
  );
}
