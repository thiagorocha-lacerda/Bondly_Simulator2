import { useEffect, useMemo, useState } from 'react';
import type { PricingInput, PricingResult } from '@bondly/pricing-types';
import { Panel } from './Fields';
import { brl } from '../services/defaults';
import type { InputPatch } from '../services/patch';
import { fetchCatalog, QuoteError } from '../services/pricing/quoteClient';
import type { PublicCatalog } from '../services/pricing/quoteTypes';

/**
 * G-001 (ADR docs/15) — o painel de desconto por tier lê APENAS o catálogo público do servidor
 * (GET /api/pricing/catalog): rótulos de tier, faixa de usuários e os limites `tierDiscount.min/max`.
 * NÃO importa o Pricing Engine nem tabelas de custo/premissas — a resposta do autor em docs/14 (resíduo
 * G-001, Opção b) troca o uso de `validateTierDiscountPct`/`platformFeeTable`/`tierFor`/`platformFeeBands`
 * (que o Rollup preservava como acesso a propriedade no bundle) por uma validação de FAIXA trivial contra
 * os limites do catálogo. O preço-base de Platform Fee por tier NÃO é mais exibido no cliente: ele é preço
 * de tabela e vive só no servidor; o waterfall do tier ativo vem do `PricingResult` servido pelo quote.
 */
const TIER_DISCOUNT_DECIMALS = 2;

type TierRow = { readonly name: string; readonly maxUsers: number };
type Limits = { readonly min: number; readonly max: number };

/** Faixa humana (p.p.) validada só contra os limites do catálogo — sem regra de preço/custo no cliente. */
function validateTierDiscountRange(raw: string, limits: Limits): { ok: true; fraction: number } | { ok: false; message: string } {
  const normalized = raw.replace(',', '.').trim();
  const pct = Number(normalized);
  if (normalized === '' || !Number.isFinite(pct)) return { ok: false, message: 'Informe um número válido.' };
  const fraction = Math.round((pct / 100) * 10 ** (TIER_DISCOUNT_DECIMALS + 2)) / 10 ** (TIER_DISCOUNT_DECIMALS + 2);
  if (fraction < limits.min || fraction > limits.max) {
    return { ok: false, message: `O desconto por tier deve ficar entre ${(limits.min * 100).toFixed(2)}% e ${(limits.max * 100).toFixed(2)}%.` };
  }
  return { ok: true, fraction };
}

/** Tier ativo = menor tier cujo teto de usuários comporta a base atual (regra de SELEÇÃO, não de preço). */
function activeTierFor(users: number, tiers: readonly TierRow[]): TierRow | null {
  const sorted = [...tiers].sort((a, b) => a.maxUsers - b.maxUsers);
  return sorted.find((t) => users <= t.maxUsers) ?? sorted[sorted.length - 1] ?? null;
}

/**
 * "Descontos por tier" (§3.1). Exibe os tiers reais (do catálogo do servidor), permite editar o desconto
 * do TIER ATIVO (faixa vinda de `tierDiscount.min/max`), valida inline contra essa faixa e recalcula
 * imediatamente. O valor editado é salvo na proposta via `negotiation.tierDiscount` (fração) — não altera a
 * tabela global. "Restaurar padrão" zera o desconto por tier.
 */
export function TierDiscountPanel(props: {
  input: PricingInput;
  result: PricingResult;
  update: (patch: InputPatch) => void;
}) {
  const { input, result, update } = props;

  // G-001: catálogo PÚBLICO do servidor (sem preço/custo/tabela). Estados loading/erro/vazio explícitos.
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    fetchCatalog(ctrl.signal)
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch((e: unknown) => {
        if (!alive || ctrl.signal.aborted) return;
        setLoadError(e instanceof QuoteError ? e.message : 'Não foi possível carregar os tiers do servidor.');
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, []);

  const LIMITS: Limits = catalog?.tierDiscount ?? { min: 0.03, max: 0.07 };
  const MIN_PCT = LIMITS.min * 100;
  const MAX_PCT = LIMITS.max * 100;
  const tiers: readonly TierRow[] = catalog?.tiers ?? [];
  const activeTier = catalog ? activeTierFor(input.volume.users, tiers) : null;

  // percentual humano atual (fração → p.p.), arredondado às casas aceitas
  const currentPct = useMemo(() => {
    const f = input.negotiation.tierDiscount ?? 0;
    return Math.round(f * 100 * 10 ** TIER_DISCOUNT_DECIMALS) / 10 ** TIER_DISCOUNT_DECIMALS;
  }, [input.negotiation.tierDiscount]);

  const [draft, setDraft] = useState<string>(currentPct > 0 ? String(currentPct) : '');

  const validation = draft.trim() === '' || !catalog ? null : validateTierDiscountRange(draft, LIMITS);
  const error = validation && !validation.ok ? validation.message : null;

  function commit(value: string) {
    setDraft(value);
    if (value.trim() === '' || !catalog) {
      update({ negotiation: { tierDiscount: 0 } });
      return;
    }
    const v = validateTierDiscountRange(value, LIMITS);
    if (v.ok) update({ negotiation: { tierDiscount: v.fraction } });
    // inválido: não propaga ao engine; mantém o último válido e mostra o erro inline
  }

  function restoreDefault() {
    if (!window.confirm('Restaurar o desconto por tier para o padrão (sem desconto por tier)?')) return;
    setDraft('');
    update({ negotiation: { tierDiscount: 0 } });
  }

  const applied = result.tierDiscountApplied;
  const w = result.discountWaterfall;

  if (loadError) {
    return (
      <Panel title="Descontos por tier" sub="Política de desconto por tier consolidada no servidor.">
        <p className="sub" role="alert" style={{ color: 'var(--error)' }}>
          {loadError}
        </p>
      </Panel>
    );
  }

  if (!catalog) {
    return (
      <Panel title="Descontos por tier" sub="Política de desconto por tier consolidada no servidor.">
        <p className="sub" role="status">
          Carregando tiers e limites do servidor…
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Descontos por tier"
      sub={`Desconto editável por tier, de ${MIN_PCT.toFixed(2)}% a ${MAX_PCT.toFixed(2)}%. Incide só sobre o Platform Fee, antes do desconto negociado e do prazo. Política pendente de aprovação comercial.`}
    >
      <div className="field full">
        <label htmlFor="tier-discount-input">
          Desconto do tier ativo — <b>{activeTier?.name ?? '—'}</b>
          <small>Salvo na proposta; não altera a tabela global. Faixa {MIN_PCT.toFixed(2)}%–{MAX_PCT.toFixed(2)}%, duas casas decimais.</small>
        </label>
        <div className="inputwrap">
          <input
            id="tier-discount-input"
            type="number"
            inputMode="decimal"
            value={draft}
            min={0}
            max={MAX_PCT}
            step={0.01}
            placeholder="0,00"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'tier-discount-error' : undefined}
            onChange={(e) => commit(e.target.value)}
          />
          <span className="unit" aria-hidden="true">%</span>
        </div>
        {error && (
          <small id="tier-discount-error" role="alert" style={{ color: 'var(--error)' }}>
            {error}
          </small>
        )}
      </div>

      <div className="field full" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" className="ghostbtn" onClick={restoreDefault}>
          Restaurar valores padrão
        </button>
        <span className="sub" style={{ margin: 0 }}>
          {applied ? `Aplicado: ${(result.tierDiscount * 100).toFixed(2)}% sobre o Platform Fee` : 'Nenhum desconto por tier aplicado'}
        </span>
      </div>

      <div className="field full">
        <table className="bd" aria-label="Descontos por tier">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Tier</th>
              <th style={{ textAlign: 'left' }}>Faixa (usuários)</th>
              <th style={{ textAlign: 'right' }}>Desconto</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => {
              const isActive = activeTier?.name === t.name;
              const disc = isActive ? result.tierDiscount : 0;
              return (
                <tr key={t.name} className={isActive ? 'sum' : undefined}>
                  <td>
                    {t.name}
                    {isActive && <span className="why">tier ativo</span>}
                  </td>
                  <td>{'até ' + t.maxUsers.toLocaleString('pt-BR')}</td>
                  <td className="num">
                    {isActive ? (disc > 0 ? `${(disc * 100).toFixed(2)}%` : '—') : <span className="sub" style={{ margin: 0 }}>n/a</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <small className="sub">
          Só o tier ativo (selecionado pela base de usuários) recebe desconto neste cenário; os demais
          são exibidos como referência e marcados como não aplicáveis (§3.1). O preço-base de Platform Fee
          por tier é calculado no servidor e não trafega para o cliente.
        </small>
      </div>

      {applied && (
        <div className="field full">
          <h3 style={{ marginBottom: 6 }}>Waterfall do Platform Fee</h3>
          <table className="bd" aria-label="Composição do desconto">
            <tbody>
              <tr>
                <td>Platform Fee escolhido (base)</td>
                <td className="num">{brl(w.base)}</td>
              </tr>
              <tr>
                <td>− Desconto por tier<span className="why">{(w.tierDiscountRate * 100).toFixed(2)}%</span></td>
                <td className="num">{brl(w.afterTierDiscount)}</td>
              </tr>
              {w.commercialDiscountRate > 0 && (
                <tr>
                  <td>− Desconto negociado<span className="why">{(w.commercialDiscountRate * 100).toFixed(2)}%</span></td>
                  <td className="num">{brl(w.afterCommercialDiscount)}</td>
                </tr>
              )}
              {w.termDiscountRate > 0 && (
                <tr>
                  <td>− Desconto por prazo<span className="why">{(w.termDiscountRate * 100).toFixed(2)}%</span></td>
                  <td className="num">{brl(w.final)}</td>
                </tr>
              )}
              <tr className="sum">
                <td>Platform Fee final</td>
                <td className="num">{brl(w.final)}/mês</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
