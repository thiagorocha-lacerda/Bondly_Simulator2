import type { PricingInput, CommunicationStrategy, CommercialOption, ModuleId } from '@bondly/pricing-types';
import { MODULE_CATALOG } from '@bondly/pricing-catalog';
import { NumberField, PercentField, Panel, Toggle, SelectField, TextField } from './Fields';
import { useAudience } from '../app/audience';

import type { InputPatch } from '../services/patch';

/** Modo avançado (§10.2): parâmetros detalhados. Usa o MESMO Pricing Engine que o Quick mode. */
export function AdvancedMode(props: {
  input: PricingInput;
  update: (patch: InputPatch) => void;
  selectedModules: readonly ModuleId[];
  onModules: (ids: ModuleId[]) => void;
}) {
  const { input, update } = props;
  const { internal } = useAudience();
  return (
    <>
      <Panel title="A implementação" sub="O que o cliente pede define a complexidade, o Setup e o markup sugerido.">
        <NumberField label="Integrações" hint="0–1 simples · 2–3 médio · 4+ alto." value={input.complexity.integrations} min={0} max={20} onChange={(v) => update({ complexity: { integrations: v } })} />
        <div className="field full">
          <label>
            Módulos contratados
            <small>Fonte única da contagem de módulos (mesma do modo rápido): {input.complexity.modules} selecionado(s) → score de complexidade.</small>
          </label>
          <div className="checks" style={{ display: 'grid', gap: 8 }}>
            {MODULE_CATALOG.map((m) => {
              const checked = props.selectedModules.includes(m.id);
              return (
                <label key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
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
                </label>
              );
            })}
          </div>
        </div>
        <SelectField label="Criticidade de SLA" value={String(input.complexity.slaPoints)} options={[{ v: '0', label: 'Padrão' }, { v: '7.5', label: 'Reforçado' }, { v: '15', label: 'Missão crítica' }]} onChange={(v) => update({ complexity: { slaPoints: Number(v) } })} />
        <SelectField label="Customização" value={String(input.complexity.customizationPoints)} options={[{ v: '0', label: 'Baixo' }, { v: '10', label: 'Médio' }, { v: '20', label: 'Alto' }]} onChange={(v) => update({ complexity: { customizationPoints: Number(v) } })} />
        <SelectField label="Escopo de AI" value={String(input.complexity.aiPoints)} options={[{ v: '0', label: 'Nenhum' }, { v: '7.5', label: 'Padrão' }, { v: '15', label: 'Avançado' }]} onChange={(v) => update({ complexity: { aiPoints: Number(v) } })} />
        <SelectField label="Migração de dados" value={String(input.complexity.migrationPoints)} options={[{ v: '0', label: 'Baixo' }, { v: '7.5', label: 'Médio' }, { v: '15', label: 'Alto' }]} onChange={(v) => update({ complexity: { migrationPoints: Number(v) } })} />
        <NumberField label="Horas de implantação" hint="Entram só no Setup (R$ 350/HH), nunca na mensalidade." value={input.complexity.implementationHours} min={0} step={5} onChange={(v) => update({ complexity: { implementationHours: v } })} />
      </Panel>

      {internal && (
        <>
          <div style={{ height: 16 }} />

          <Panel title="Leitura de notas fiscais" sub="Custo de R$ 0,12 por nota lida; não gera receita direta.">
        <Toggle label="Leitura de NF" value={input.invoices.enabled ? 1 : 0} options={[{ v: 1, label: 'Sim' }, { v: 0, label: 'Não' }]} onChange={(v) => update({ invoices: { enabled: v === 1 } })} />
        {input.invoices.enabled && (
          <>
            <PercentField label="% dos MAU que enviam notas" value={input.invoices.participantPct} onChange={(v) => update({ invoices: { participantPct: v } })} />
            <NumberField label="Notas por participante/mês" value={input.invoices.notesPerParticipant} min={0} max={31} onChange={(v) => update({ invoices: { notesPerParticipant: v } })} />
          </>
        )}
      </Panel>

      <div style={{ height: 16 }} />

      <Panel title="Comunicação transacional" sub="Custo operacional recorrente, dentro da margem técnica.">
        <NumberField label="Comunicações por MAU/mês" value={input.communication.perMau} min={0} step={0.1} onChange={(v) => update({ communication: { perMau: v } })} />
        <SelectField
          label="Estratégia de comunicação"
          value={input.communication.strategy}
          options={[
            { v: 'fallback', label: 'RCS + WhatsApp (fallback)' },
            { v: 'rcs', label: 'Só RCS' },
            { v: 'wa', label: 'Só WhatsApp' },
            { v: 'sms', label: 'Só SMS' },
            { v: 'email', label: 'Só E-mail' },
            { v: 'both', label: 'RCS + WhatsApp (todo o volume)' },
            { v: 'custom', label: 'Personalizado (mix)' },
            { v: 'none', label: 'Nenhuma' },
          ]}
          onChange={(v) => update({ communication: { strategy: v as CommunicationStrategy } })}
        />
        {input.communication.strategy === 'fallback' && (
          <PercentField label="Taxa de fallback para WhatsApp" value={input.communication.fallbackRate} step={5} onChange={(v) => update({ communication: { fallbackRate: v } })} />
        )}
        {input.communication.strategy === 'custom' && (
          <>
            <PercentField label="Mix — SMS" value={input.communication.customMix.sms} step={5} onChange={(v) => update({ communication: { customMix: { sms: v } } })} />
            <PercentField label="Mix — E-mail" value={input.communication.customMix.email} step={5} onChange={(v) => update({ communication: { customMix: { email: v } } })} />
            <PercentField label="Mix — RCS" value={input.communication.customMix.rcs} step={5} onChange={(v) => update({ communication: { customMix: { rcs: v } } })} />
            <PercentField label="Mix — WhatsApp" value={input.communication.customMix.wa} step={5} onChange={(v) => update({ communication: { customMix: { wa: v } } })} />
          </>
        )}
      </Panel>

      <div style={{ height: 16 }} />
        </>
      )}

      <Panel title="A negociação" sub="Tudo o que muda o preço — e quem aprova.">
        <Toggle label="Opção comercial" value={input.negotiation.option} options={[{ v: 'floor', label: 'Piso' }, { v: 'recommended', label: 'Recomendado' }, { v: 'premium', label: 'Premium' }]} onChange={(v) => update({ negotiation: { option: v as CommercialOption } })} />
        <PercentField label="Desconto extra (% do Platform Fee)" hint="Até 5% Comercial · 5–10% Head · 10–15% CEO+Fin." value={input.negotiation.extraDiscount} onChange={(v) => update({ negotiation: { extraDiscount: v } })} />
        <NumberField
          label="Recursos dedicados (qtd. Perfil 1)"
          hint="R$ 25 mil Total Comp · R$ 35 mil tabela por padrão. Ajuste perfis/custos na seção Serviços."
          value={input.services.profiles[0]?.quantity ?? 0}
          min={0}
          onChange={(v) => {
            const existing = input.services.profiles;
            const first = existing[0] ?? { name: 'Perfil 1', quantity: 0, totalCompensation: 25000, directCosts: 0 };
            const next = existing.length
              ? existing.map((p, i) => (i === 0 ? { ...p, quantity: v } : p))
              : [{ ...first, quantity: v }];
            update({ services: { profiles: next } });
          }}
        />
        <Toggle label="Potenciais do corredor de desconto" value={input.negotiation.expansion ? 'exp' : input.negotiation.strategic ? 'key' : 'none'} options={[{ v: 'none', label: 'Padrão' }, { v: 'exp', label: 'Expansão alta' }, { v: 'key', label: 'Estratégico' }]} onChange={(v) => update({ negotiation: { expansion: v === 'exp', strategic: v === 'key' } })} />
        <Toggle label="Venda pela Minu" value={input.negotiation.viaMinu ? 1 : 0} options={[{ v: 1, label: 'Sim' }, { v: 0, label: 'Direto Bondly' }]} onChange={(v) => update({ negotiation: { viaMinu: v === 1 } })} />
      </Panel>

      <div style={{ height: 16 }} />

      <Panel title="Evidência para o orçamento (ARKA)" sub="Uma oportunidade só entra no Budget quando vira H2 — exige evidência.">
        <TextField label="Owner comercial" value={input.arka?.owner ?? ''} onChange={(v) => update({ arka: { owner: v } })} />
        <TextField label="Data prevista de go-live" type="date" value={input.arka?.goLiveDate ?? ''} onChange={(v) => update({ arka: { goLiveDate: v } })} />
        <SelectField
          label="Evidência comercial"
          value={String(input.arka?.evidenceStage ?? 1)}
          options={[
            { v: '1', label: 'Nenhuma ainda' },
            { v: '4', label: 'Reunião realizada' },
            { v: '5', label: 'Oportunidade qualificada' },
            { v: '7', label: 'Cotação enviada' },
            { v: '8', label: 'Proposta enviada' },
            { v: '9', label: 'Negociação em andamento' },
            { v: '11', label: 'Piloto em andamento' },
            { v: '14', label: 'Contrato em formalização' },
            { v: '15', label: 'Contrato assinado' },
          ]}
          onChange={(v) => update({ arka: { evidenceStage: Number(v) } })}
        />
        <PercentField label="Probabilidade declarada" value={(input.arka?.probability ?? 0) / 100} step={5} onChange={(v) => update({ arka: { probability: Math.round(v * 100) } })} />
      </Panel>
    </>
  );
}
