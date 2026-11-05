import type { PricingResult } from '@bondly/pricing-types';
import { brl, pct } from '../services/defaults';
import { useAudience } from '../app/audience';

const statusClass = (s: PricingResult['marginStatus']): string =>
  s === 'SAUDÁVEL' ? 'ok' : s === 'REVISAR' ? 'warn' : s === 'REPRECIFICAR' ? 'bad' : 'info';

/** Dashboard de resultados (§12). Em visão interna mostra custos/margens; em comercial só o autorizado. */
export function ResultsDashboard(props: { result: PricingResult; users: number }) {
  const r = props.result;
  const { internal } = useAudience();
  // Core MRR por usuário elegível. Usa a base real (props.users), não uma reconstrução a partir do MAU.
  const perUser = props.users > 0 && r.core > 0 ? (r.core / props.users).toFixed(2) : '—';
  return (
    <div className="panel">
      <div className="tier">
        <div>
          <div className="t">{r.tierName}</div>
          <div className="u">Platform Fee de tabela {brl(r.platformFeeTable)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="u">R$ / usuário</div>
          <div className="t num">{perUser}</div>
        </div>
      </div>

      <div className="big">
        <div>
          <b className="num">{brl(r.clientYear1)}</b>
          <span>Cliente paga no 1º ano</span>
        </div>
        <div>
          <b className="num">{brl(r.tcvClient)}</b>
          <span>TCV ao cliente</span>
        </div>
        <div>
          <b className="num">{brl(r.core * 12)}</b>
          <span>ARR recorrente Bondly</span>
        </div>
        <div className="minu">
          <b className="num">{brl(r.minuYear1)}</b>
          <span>Minu ganha no 1º ano</span>
        </div>
      </div>

      <table className="bd">
        <tbody>
          <tr>
            <td>
              Platform Fee
              <span className="why">{r.complexityBand} · score {Math.round(r.complexityScore)}</span>
            </td>
            <td className="num">{brl(r.platformFee)}/mês</td>
          </tr>
          <tr>
            <td>DAU Usage<span className="why">{Math.round(r.dau).toLocaleString('pt-BR')} DAU · faixas · 30 dias</span></td>
            <td className="num">{brl(r.usage)}/mês</td>
          </tr>
          <tr>
            <td>Processing</td>
            <td className="num">{brl(r.processing)}/mês</td>
          </tr>
          <tr className="sum">
            <td>Receita recorrente Core</td>
            <td className="num">{brl(r.core)}/mês</td>
          </tr>
          {internal && (
            <tr>
              <td>
                Custo variável
                <span className="why">
                  CleverTap {brl(r.costs.cleverTap)} · infra {brl(r.costs.infra)} · NF {brl(r.costs.invoices)} · comunicação {brl(r.costs.communication)}
                </span>
              </td>
              <td className="num">− {brl(r.costs.total)}/mês</td>
            </tr>
          )}
          {r.servicesMrr > 0 && (
            <tr>
              <td>Recursos dedicados (recorrente)</td>
              <td className="num">{brl(r.servicesMrr)}/mês</td>
            </tr>
          )}
          <tr>
            <td>Setup ao cliente</td>
            <td className="num">{brl(r.setupClient)} uma vez</td>
          </tr>
          {internal && (
            <tr>
              <td>Margem líquida Bondly<span className="why">Y1 / regime</span></td>
              <td className="num">{pct(r.netMarginY1)} / {pct(r.netMarginSteady)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {internal && (
        <div style={{ marginTop: 16 }}>
          <h3>Régua de margem técnica</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            <span className={`status ${statusClass(r.marginStatus)}`}>{r.marginStatus}</span>
            <span className="status info">Margem técnica {pct(r.technicalMargin)}</span>
            <span className={`status ${r.discountAuthority === 'Comercial' ? 'info' : 'warn'}`}>Alçada: {r.discountAuthority}</span>
          </div>
          {r.warnings.length > 0 && (
            <div className={`note ${r.marginStatus === 'REPRECIFICAR' ? 'bad' : ''}`}>
              {r.warnings.map((w) => w.message).join(' ')}
            </div>
          )}
        </div>
      )}

      <p className="sub" style={{ marginTop: 14 }}>
        Motor {r.engineVersion} · premissas {r.premisesVersion} ({r.premisesHash})
      </p>
    </div>
  );
}
