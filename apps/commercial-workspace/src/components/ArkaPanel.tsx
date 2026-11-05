import { useEffect, useState } from 'react';
import type { PricingInput } from '@bondly/pricing-types';
import { loadDevEngine } from '../services/pricing/devEngine';

/**
 * Classificação ARKA (H1/H2/H3) — §18.
 *
 * G-001 (ADR docs/15): a classificação ARKA é lógica de negócio INTERNA (só visão interna a renderiza).
 * Em PRODUÇÃO o motor NÃO está no bundle; esta classificação é Fase 4 (migrar para `QuoteView`/endpoint
 * dedicado). Até lá, DEV calcula localmente via engine carregado sob demanda; PROD mostra um aviso claro de
 * que o detalhamento virá do servidor. O painel só aparece para perfis internos (App: `showInternal`).
 */
type ArkaView = {
  arkaClass: string;
  classLabel: string;
  stage: { rank: number; maturity: string; pipeline: string };
  checks: readonly { label: string; ok: boolean }[];
  note: string;
};

export function ArkaPanel(props: { input: PricingInput }) {
  const [arka, setArka] = useState<ArkaView | null>(null);

  useEffect(() => {
    // G-001: guard LITERAL `import.meta.env.DEV` (não a const IS_DEV) para o Rollup eliminar todo o bloco —
    // incluindo o acesso a `eng.arkaClassification` — no build de produção (DCE de `if (false) { … }`).
    if (import.meta.env.DEV) {
      let alive = true;
      void loadDevEngine().then((eng) => {
        if (alive) setArka(eng.arkaClassification(props.input.arka) as unknown as ArkaView);
      });
      return () => {
        alive = false;
      };
    }
    return undefined;
  }, [props.input.arka]);

  if (!arka) {
    return (
      <div className="panel">
        <h2>Evidência comercial — ARKA</h2>
        <p className="sub" role="status">
          A classificação ARKA é consolidada no servidor (Fase 4 — pendente). Indisponível neste ambiente.
        </p>
      </div>
    );
  }

  const cls = arka.arkaClass;
  const statusClass = cls === 'H3' ? 'warn' : 'ok';

  return (
    <div className="panel">
      <h2>Evidência comercial — ARKA</h2>
      <p className="sub">{arka.classLabel}</p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span className={`status ${statusClass}`}>{cls}</span>
        <span className="status info">Estágio {arka.stage.rank}/15 · {arka.stage.maturity}</span>
        <span className="status info">Pipeline: {arka.stage.pipeline}</span>
      </div>

      <table className="bd">
        <tbody>
          {arka.checks.map((c, i) => (
            <tr key={i}>
              <td>{c.label}</td>
              <td className="num">
                <span className={`status ${c.ok ? 'ok' : 'bad'}`}>{c.ok ? '✓' : '—'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="sub" style={{ marginTop: 12 }}>{arka.note}</p>
    </div>
  );
}
