import { useEffect, useState } from 'react';
import type { PricingInput, PricingResult } from '@bondly/pricing-types';
import { brl, pct } from '../services/defaults';
import { useAudience } from '../app/audience';
import { IS_DEV, loadDevEngine } from '../services/pricing/devEngine';

/**
 * Comparação de cenários (§13): conservador (−30% MAU) / base / otimista (+30% MAU).
 *
 * G-001 (ADR docs/15): os cenários derivam do MESMO motor. Em PRODUÇÃO o motor não está no bundle — a
 * projeção de cenários por `QuoteView` é Fase 4 (endpoint já devolve `scenarios`/`scenariosFull`; falta ligar
 * a UI). Até lá, DEV calcula via engine sob demanda; PROD mostra aviso claro. Visão comercial oculta margem/status.
 */
type Scenario = { readonly name: string; readonly result: PricingResult };

export function ScenarioPanel(props: { input: PricingInput }) {
  const { internal } = useAudience();
  const [scenarios, setScenarios] = useState<readonly Scenario[] | null>(null);

  useEffect(() => {
    if (!IS_DEV) return;
    let alive = true;
    void loadDevEngine().then((eng) => {
      if (alive) setScenarios(eng.defaultScenarios(props.input) as unknown as readonly Scenario[]);
    });
    return () => {
      alive = false;
    };
  }, [props.input]);

  const label: Record<string, string> = {
    conservador: 'Conservador · −30% MAU',
    base: 'Base',
    otimista: 'Otimista · +30% MAU',
  };

  if (!scenarios) {
    return (
      <div className="panel">
        <h2>Cenários — sensibilidade ao engajamento</h2>
        <p className="sub" role="status">
          A análise de cenários é consolidada no servidor (Fase 4 — pendente). Indisponível neste ambiente.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Cenários — sensibilidade ao engajamento</h2>
      <p className="sub">Mesmas premissas e motor; varia só o MAU. Útil para enquadrar o risco da proposta.</p>
      <table className="bd">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Cenário</th>
            <th className="num">Core MRR</th>
            <th className="num">TCV ao cliente</th>
            {internal && <th className="num">Margem técnica</th>}
            {internal && <th className="num">Status</th>}
          </tr>
        </thead>
        <tbody>
          {scenarios.map((s) => (
            <tr key={s.name} className={s.name === 'base' ? 'sum' : undefined}>
              <td>{label[s.name] ?? s.name}</td>
              <td className="num">{brl(s.result.core)}/mês</td>
              <td className="num">{brl(s.result.tcvClient)}</td>
              {internal && <td className="num">{pct(s.result.technicalMargin)}</td>}
              {internal && (
                <td className="num">
                  <span
                    className={`status ${
                      s.result.marginStatus === 'SAUDÁVEL'
                        ? 'ok'
                        : s.result.marginStatus === 'REVISAR'
                          ? 'warn'
                          : s.result.marginStatus === 'REPRECIFICAR'
                            ? 'bad'
                            : 'info'
                    }`}
                  >
                    {s.result.marginStatus}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
