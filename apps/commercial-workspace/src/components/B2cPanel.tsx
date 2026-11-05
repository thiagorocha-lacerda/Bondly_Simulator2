import { useEffect, useState } from 'react';
import type { B2cInput, AntifraudMethod, B2cScope } from '@bondly/pricing-types';
import { Panel, NumberField, PercentField, Toggle } from './Fields';
import { brl, pct, n0 } from '../services/defaults';
import { useAudience } from '../app/audience';
import { IS_DEV, loadDevEngine } from '../services/pricing/devEngine';

type B2cResultView = {
  readonly tot: { readonly end: number; readonly gmv: number; readonly rev: number; readonly total: number; readonly minu: number };
  readonly rows: readonly { readonly end: number; readonly rev: number; readonly total: number }[];
};

const B2C_MONTHS = ['jul/27', 'ago/27', 'set/27', 'out/27', 'nov/27', 'dez/27'];

/**
 * Assinaturas B2C (§7.5) — módulo de vendas habilitável. Estado vem do hook useB2c (fonte única);
 * projeção via `runB2c`. Em visão comercial (external) NÃO expõe números internos (Resultado Bondly,
 * split com a Minu, participação da Minu): mostra só o volume ao cliente (§12/§16).
 */
export function B2cPanel(props: {
  input: B2cInput;
  enabled: boolean;
  include: boolean;
  set: (patch: Partial<B2cInput>) => void;
  setEnabled: (on: boolean) => void;
  setInclude: (on: boolean) => void;
}) {
  const { input, set } = props;
  const { internal } = useAudience();
  // G-001: projeção B2C via engine SOMENTE em DEV (import dinâmico atrás de import.meta.env.DEV; fora do bundle
  // de produção). Server-side do B2C é Fase 4. Em PROD o resultado fica nulo e a tabela mostra aviso.
  const [result, setResult] = useState<B2cResultView | null>(null);
  useEffect(() => {
    if (!IS_DEV) return;
    let alive = true;
    void loadDevEngine().then((eng) => {
      if (alive) setResult(eng.runB2c(input, eng.CURRENT_PREMISES) as unknown as B2cResultView);
    });
    return () => {
      alive = false;
    };
  }, [input]);
  const t = result?.tot ?? { end: 0, gmv: 0, rev: 0, total: 0, minu: 0 };
  const rows = result?.rows ?? [];
  const cls = (v: number): string => (v < -0.005 ? 'bad' : v > 0.005 ? 'ok' : 'info');

  return (
    <Panel title="Assinaturas B2C — módulo de vendas (jul–dez/2027)" sub="Habilite para dimensionar a receita de assinaturas e, opcionalmente, incluí-la na proposta.">
      <Toggle
        label="Habilitar módulo Assinaturas B2C"
        hint="Liga o dimensionamento do produto de assinaturas na simulação. Desligado, não entra em nada."
        value={props.enabled ? 1 : 0}
        options={[{ v: 1, label: 'Habilitado' }, { v: 0, label: 'Desabilitado' }]}
        onChange={(v) => props.setEnabled(v === 1)}
      />

      {!props.enabled ? (
        <p className="sub" style={{ marginTop: 8 }}>
          Módulo desabilitado. Habilite acima para configurar fee, SOM, ticket, churn e antifraude, e para incluir o funil na proposta.
        </p>
      ) : (
        <>
          <Toggle
            label="Incluir na proposta (snapshot e PDF)"
            hint="Quando ligado, o funil B2C é congelado no snapshot da proposta e aparece no PDF."
            value={props.include ? 1 : 0}
            options={[{ v: 1, label: 'Sim' }, { v: 0, label: 'Não' }]}
            onChange={(v) => props.setInclude(v === 1)}
          />
          <Toggle label="Fee de processamento" value={input.fee} options={[{ v: 0.1, label: '10% · oficial' }, { v: 0.125, label: '12,5%' }, { v: 0.15, label: '15%' }]} onChange={(v) => set({ fee: v })} />
          <NumberField label="Base elegível (SOM)" value={input.som} min={0} step={1000} onChange={(v) => set({ som: v })} />
          <PercentField label="Meta de conversão em dez" value={input.conv} step={0.1} onChange={(v) => set({ conv: v })} />
          <NumberField label="Ticket médio mensal (R$)" value={input.ticket} min={0} step={0.5} onChange={(v) => set({ ticket: v })} />
          <PercentField label="Churn mensal" value={input.churn} step={0.5} onChange={(v) => set({ churn: v })} />
          <NumberField label="Fee mínimo por transação (R$)" value={input.minFee} min={0} step={0.1} onChange={(v) => set({ minFee: v })} />
          {internal && (
            <>
              <PercentField label="Gateway (% do transacionado)" value={input.gateway} step={0.5} onChange={(v) => set({ gateway: v })} />
              <PercentField label="Tributos sobre o fee" value={input.tax} step={0.5} onChange={(v) => set({ tax: v })} />
              <PercentField label="Participação da Minu na margem positiva" value={input.minuShare} step={1} onChange={(v) => set({ minuShare: v })} />
              <Toggle label="Antifraude — método" value={input.method} options={[{ v: 'progressiva', label: 'Progressiva · aprovada' }, { v: 'integral', label: 'Integral' }]} onChange={(v) => set({ method: v as AntifraudMethod })} />
              <Toggle label="Antifraude — escopo" value={input.scope} options={[{ v: 'primeira', label: '1ª cobrança + troca' }, { v: 'todas', label: 'Todas as cobranças' }]} onChange={(v) => set({ scope: v as B2cScope })} />
            </>
          )}

          <h3 style={{ marginTop: 16 }}>Resultado H2/2027</h3>
          <div className="big">
            <div><b className="num">{n0(t.end)}</b><span>Assinantes ativos em dez</span></div>
            <div><b className="num">{brl(t.gmv)}</b><span>Valor transacionado H2</span></div>
            <div><b className="num">{brl(t.rev)}</b><span>Receita de processamento</span></div>
            {internal && <div className="minu"><b className="num">{brl(t.total)}</b><span>Resultado Bondly</span></div>}
          </div>
          {internal && (
            <div className={`note ${cls(t.total)}`}>
              {t.total < 0
                ? `Com fee de ${pct(input.fee)}, a receita não cobre gateway, antifraude e impostos no semestre: a Bondly fica com ${brl(t.total)}.`
                : `Margem positiva no semestre: a Bondly fica com ${brl(t.total)} (Minu ${brl(t.minu)}).`}
            </div>
          )}

          <h3 style={{ marginTop: 16 }}>Projeção mensal</h3>
          {rows.length === 0 ? (
            <p className="sub" role="status">
              A projeção B2C é consolidada no servidor (Fase 4 — pendente). Indisponível neste ambiente.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="bd" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <td style={{ fontWeight: 700 }}>Mês</td>
                    {B2C_MONTHS.map((m) => (<td key={m} style={{ textAlign: 'right', fontWeight: 700 }}>{m}</td>))}
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Ativos no fim</td>{rows.map((row, i) => (<td key={i} className="num">{n0(row.end)}</td>))}</tr>
                  <tr><td>Receita</td>{rows.map((row, i) => (<td key={i} className="num">{brl(row.rev)}</td>))}</tr>
                  {internal && (
                    <tr><td>Resultado Bondly</td>{rows.map((row, i) => (<td key={i} className="num">{brl(row.total)}</td>))}</tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
