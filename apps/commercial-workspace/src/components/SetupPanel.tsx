import type { PricingInput, PricingResult } from '@bondly/pricing-types';
import { NumberField, PercentField, Panel } from './Fields';
import { brl } from '../services/defaults';
import type { InputPatch } from '../services/patch';

/**
 * Setup redesenhado (§4): Setup total = Setup fixo padrão + (Horas × R$/HH) + outros adicionais.
 *
 * O valor fixo padrão é CONFIGURÁVEL via uma redução percentual — o novo valor reduzido é decisão
 * comercial PENDENTE (§4.1), então o default é 0 (valor atual) e qualquer redução dispara aviso.
 * As horas de implantação entram SÓ aqui (R$ 350/HH), nunca na mensalidade. §4.2 pede exibir cada
 * componente — a tabela abaixo mostra fixo, horas, R$/HH, subtotal, outros, total, mensalidade e TCV.
 */
export function SetupPanel(props: {
  input: PricingInput;
  result: PricingResult;
  update: (patch: InputPatch) => void;
  internal: boolean;
}) {
  const { input, result, update, internal } = props;
  const s = result.setup;

  return (
    <Panel
      title="Setup e implantação"
      sub="Setup fixo padrão + horas de implantação (R$ 350/HH, só no Setup) + outros adicionais. O valor fixo reduzido é configurável e pendente de aprovação comercial."
    >
      <PercentField
        label="Redução do Setup fixo padrão"
        hint="0% mantém o valor atual. Reduzir é decisão comercial pendente — dispara aviso de aprovação."
        value={input.negotiation.setupFixedReductionPct ?? 0}
        step={1}
        onChange={(v) => update({ negotiation: { setupFixedReductionPct: v } })}
      />
      <NumberField
        label="Outros adicionais de Setup (R$)"
        hint="Adicionais expressamente previstos; somam ao Setup, não à mensalidade."
        value={input.negotiation.setupOtherAdditions ?? 0}
        min={0}
        step={1000}
        onChange={(v) => update({ negotiation: { setupOtherAdditions: v } })}
      />

      <div className="field full">
        <table className="bd" aria-label="Composição do Setup">
          <tbody>
            <tr>
              <td>
                Setup fixo padrão
                {s.fixedReductionPct > 0 && <span className="why">reduzido {(s.fixedReductionPct * 100).toFixed(1)}%</span>}
              </td>
              <td className="num">{brl(s.fixed)}</td>
            </tr>
            <tr>
              <td>Horas adicionais de implantação<span className="why">{s.implementationHours} HH × {brl(s.hourlyRate)}</span></td>
              <td className="num">{brl(s.implementationSubtotal)}</td>
            </tr>
            {s.otherAdditions > 0 && (
              <tr>
                <td>Outros adicionais de Setup</td>
                <td className="num">{brl(s.otherAdditions)}</td>
              </tr>
            )}
            <tr className="sum">
              <td>Setup total {internal ? '(líquido Bondly)' : ''}</td>
              <td className="num">{brl(internal ? s.net : s.client)}</td>
            </tr>
            {internal && (
              <tr>
                <td>Setup ao cliente<span className="why">+ markup Minu quando via Minu</span></td>
                <td className="num">{brl(s.client)}</td>
              </tr>
            )}
            <tr>
              <td>Mensalidade recorrente<span className="why">sem horas de implantação</span></td>
              <td className="num">{brl(result.core)}/mês</td>
            </tr>
            <tr>
              <td>TCV ao cliente<span className="why">inclui o Setup uma única vez</span></td>
              <td className="num">{brl(result.tcvClient)}</td>
            </tr>
          </tbody>
        </table>
        <small className="sub">
          As horas de implantação entram uma única vez, via Setup — nunca na mensalidade, no Capacity Fee
          ou em custos recorrentes (§4.1). Margem mínima de R$ 50/HH preservada.
        </small>
      </div>
    </Panel>
  );
}
