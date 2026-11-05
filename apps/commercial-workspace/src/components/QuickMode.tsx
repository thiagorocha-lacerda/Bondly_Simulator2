import type { PricingInput } from '@bondly/pricing-types';
import { NumberField, PercentField, Panel, Toggle } from './Fields';
import { MODULE_CATALOG, type ModuleId } from '@bondly/pricing-catalog';
import type { InputPatch } from '../services/patch';

/** Quick Proposal (§10.1): cliente, oportunidade, módulos, volumes, prazo → cálculo automático. */
export function QuickMode(props: {
  input: PricingInput;
  update: (patch: InputPatch) => void;
  selectedModules: readonly ModuleId[];
  onModules: (ids: ModuleId[]) => void;
}) {
  const { input, update } = props;
  return (
    <>
      <Panel title="Oportunidade" sub="O essencial para uma proposta rápida. O cálculo usa as premissas comerciais padrão.">
        <div className="field full">
          <label>
            Cliente
            <small>Nome da empresa.</small>
          </label>
          <input
            type="text"
            value={input.arka?.clientName ?? ''}
            onChange={(e) => update({ arka: { clientName: e.target.value } })}
          />
        </div>
        <NumberField
          label="Usuários elegíveis"
          hint="Base que pode participar do programa. Define o tier."
          value={input.volume.users}
          min={0}
          step={1000}
          onChange={(v) => update({ volume: { users: v } })}
        />
        <Toggle
          label="Prazo contratual"
          hint="12 meses padrão · 24 dá −5% · 36 dá −10% só no Platform Fee."
          value={input.negotiation.term}
          options={[
            { v: 12, label: '12 meses' },
            { v: 24, label: '24 meses · −5%' },
            { v: 36, label: '36 meses · −10%' },
          ]}
          onChange={(v) => update({ negotiation: { term: v } })}
        />
        <PercentField
          label="Desconto negociado (% do Platform Fee)"
          hint="Até 5% aprova Comercial · 5–10% Head · 10–15% CEO+Fin. Acima do corredor pede exceção formal."
          value={input.negotiation.extraDiscount}
          onChange={(v) => update({ negotiation: { extraDiscount: v } })}
        />
      </Panel>

      <div style={{ height: 16 }} />

      <Panel title="Módulos" sub="Selecione os módulos contratados. A quantidade define a complexidade comercial.">
        <div className="checks" style={{ display: 'grid', gap: 8 }}>
          {MODULE_CATALOG.map((m) => {
            const checked = props.selectedModules.includes(m.id);
            return (
              <label key={m.id} className="field full" style={{ cursor: 'pointer' }}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    style={{ width: 'auto' }}
                    onChange={() =>
                      props.onModules(
                        checked
                          ? props.selectedModules.filter((x) => x !== m.id)
                          : [...props.selectedModules, m.id],
                      )
                    }
                  />
                  <b>{m.name}</b>
                </span>
              </label>
            );
          })}
        </div>
      </Panel>

      <div style={{ height: 16 }} />

      <Panel title="Volumes" sub="Engajamento típico do programa.">
        <PercentField
          label="MAU (% da base)"
          hint="Quantos entram no programa num mês típico."
          value={input.volume.mauPct}
          onChange={(v) => update({ volume: { mauPct: v } })}
        />
        <PercentField
          label="Stickiness (DAU/MAU)"
          hint="DAU médio = MAU × stickiness."
          value={input.volume.stickiness}
          onChange={(v) => update({ volume: { stickiness: v } })}
        />
        <NumberField
          label="Transações por MAU/mês"
          value={input.volume.transactionsPerMau}
          min={0}
          step={0.1}
          onChange={(v) => update({ volume: { transactionsPerMau: v } })}
        />
      </Panel>
    </>
  );
}
