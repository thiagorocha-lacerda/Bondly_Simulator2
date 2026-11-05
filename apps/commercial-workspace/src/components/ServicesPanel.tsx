import { useEffect, useState } from 'react';
import type { PricingInput, DedicatedProfile } from '@bondly/pricing-types';
import { Panel, NumberField, PercentField } from './Fields';
import type { InputPatch } from '../services/patch';
import { brl, pct } from '../services/defaults';
import { loadDevEngine } from '../services/pricing/devEngine';

type ServicesView = {
  profiles: readonly { index: number; name: string; quantity: number; pms: number; pcs: number; marginPct: number; price: number; status: 'g' | 'y' | 'r' }[];
  team: number; margin: number; mrr: number; implementationHours: number; hourPrice: number; hourPms: number; implementationCost: number; belowMin: number;
};

const chipClass = (s: 'g' | 'y' | 'r'): string => (s === 'g' ? 'ok' : s === 'y' ? 'warn' : 'bad');
const chipLabel = (s: 'g' | 'y' | 'r'): string =>
  s === 'g' ? 'meta atingida' : s === 'y' ? 'sustentável' : 'abaixo do mínimo';

const EMPTY: DedicatedProfile = { name: '', quantity: 0, totalCompensation: 25000, directCosts: 0 };

/** Serviços: recursos dedicados por perfil + horas (§7.2/§7.3). Resultado vem do motor (`services()`). */
export function ServicesPanel(props: { input: PricingInput; update: (patch: InputPatch) => void }) {
  const { input, update } = props;
  const profiles = input.services.profiles.length ? input.services.profiles : [{ ...EMPTY, name: 'Perfil 1' }];

  const setProfile = (i: number, patch: Partial<DedicatedProfile>) => {
    const next = profiles.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    update({ services: { profiles: next } });
  };
  const addProfile = () => {
    update({ services: { profiles: [...profiles, { ...EMPTY, name: `Perfil ${profiles.length + 1}` }] } });
  };
  const removeProfile = (i: number) => {
    // Remove o perfil i. Se sobrar vazio, o fallback re-renderiza um "Perfil 1" em branco.
    update({ services: { profiles: profiles.filter((_, idx) => idx !== i) } });
  };

  // G-001: cálculo de serviços (contém marginPct) via engine SOMENTE em DEV, fora do bundle de produção.
  const [sv, setSv] = useState<ServicesView | null>(null);
  useEffect(() => {
    // G-001: guard LITERAL para DCE no build de produção (remove o acesso a `eng.services`/`eng.CURRENT_PREMISES`).
    if (!import.meta.env.DEV) return undefined;
    let alive = true;
    void loadDevEngine().then((eng) => {
      if (!alive) return;
      setSv(eng.services({
        params: input.services,
        taxRate: eng.CURRENT_PREMISES.taxRate.value,
        tablePriceDefault: eng.CURRENT_PREMISES.dedicatedTablePrice.value,
        hourlyRate: eng.CURRENT_PREMISES.hourlyRate.value,
        implementationHours: input.complexity.implementationHours,
        compCapDefault: eng.CURRENT_PREMISES.serviceCompCap.value,
        productiveHoursDefault: eng.CURRENT_PREMISES.serviceProductiveHours.value,
        minMarginDefault: eng.CURRENT_PREMISES.serviceMinMargin.value,
        hourMinMarginDefault: eng.CURRENT_PREMISES.serviceHourMinMargin.value,
      }) as unknown as ServicesView);
    });
    return () => {
      alive = false;
    };
  }, [input.services, input.complexity.implementationHours]);

  return (
    <Panel
      title="Serviços — recursos dedicados e horas"
      sub="Recorrente, fora do ARR Core. Quatro preços: Tabela, Mínimo Sustentável (PMS), Comercial Sugerido (PCS) e negociado."
    >
      <div className="field">
        <label>Margem mínima por profissional<small>Premissa aprovada: R$ 5.000/mês.</small></label>
        <input type="number" value={input.services.minMargin} step={100} onChange={(e) => update({ services: { minMargin: Number(e.target.value) || 0 } })} />
      </div>
      <div className="field">
        <label>Teto de Total Comp<small>Premissa aprovada: R$ 25.000/mês.</small></label>
        <input type="number" value={input.services.compCap} step={500} onChange={(e) => update({ services: { compCap: Number(e.target.value) || 0 } })} />
      </div>
      <PercentField label="Repasses sobre serviços" value={input.services.passthroughPct} step={0.5} onChange={(v) => update({ services: { passthroughPct: v } })} />

      {profiles.map((p, i) => (
        <div key={i} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
          <div className="field full">
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>Perfil {i + 1}</span>
              {profiles.length > 1 && (
                <button
                  type="button"
                  className="ghostbtn"
                  style={{ padding: '2px 10px', fontSize: 'var(--fs-xs)' }}
                  aria-label={`Remover ${p.name || `Perfil ${i + 1}`}`}
                  onClick={() => removeProfile(i)}
                >
                  × Remover
                </button>
              )}
            </label>
            <input type="text" value={p.name} onChange={(e) => setProfile(i, { name: e.target.value })} />
          </div>
          <NumberField label="Quantidade" value={p.quantity} min={0} onChange={(v) => setProfile(i, { quantity: v })} />
          <NumberField label="Total Comp unitário/mês" value={p.totalCompensation} step={500} onChange={(v) => setProfile(i, { totalCompensation: v })} />
          <NumberField label="Custos diretos adicionais" value={p.directCosts} step={100} onChange={(v) => setProfile(i, { directCosts: v })} />
          <NumberField label="Preço negociado (vazio = PCS)" value={p.negotiatedPrice ?? 0} step={100} onChange={(v) => setProfile(i, { negotiatedPrice: v > 0 ? v : undefined })} />
        </div>
      ))}
      <div className="actions">
        <button className="ghostbtn" type="button" onClick={addProfile}>+ Adicionar perfil</button>
      </div>

      <h3 style={{ marginTop: 16 }}>Resultado dos serviços</h3>
      {!sv ? (
        <p className="sub" role="status">O cálculo de serviços é consolidado no servidor (Fase 4 — pendente). Indisponível neste ambiente.</p>
      ) : (
      <>
      <table className="bd">
        <tbody>
          {sv.profiles.filter((p) => p.quantity > 0).map((p) => (
            <tr key={p.index}>
              <td>
                {p.name} ({p.quantity})
                <span className="why">PMS {brl(p.pms)} · PCS {brl(p.pcs)} · margem {pct(p.marginPct)}</span>
              </td>
              <td className="num">
                {brl(p.price)} <span className={`status ${chipClass(p.status)}`}>{chipLabel(p.status)}</span>
              </td>
            </tr>
          ))}
          <tr className="sum">
            <td>Equipe · MRR de serviços<span className="why">{sv.team} profissional(is) · margem {brl(sv.margin)}</span></td>
            <td className="num">{brl(sv.mrr)}/mês</td>
          </tr>
          <tr>
            <td>Horas adicionais<span className="why">{sv.implementationHours} h × {brl(sv.hourPrice)} · PMS/h {brl(sv.hourPms)}</span></td>
            <td className="num">{brl(sv.implementationCost)} (Setup)</td>
          </tr>
        </tbody>
      </table>
      {sv.belowMin > 0 && (
        <div className="note bad">{sv.belowMin} perfil(is) abaixo da margem mínima: proposta economicamente inadequada.</div>
      )}
      </>
      )}
    </Panel>
  );
}
