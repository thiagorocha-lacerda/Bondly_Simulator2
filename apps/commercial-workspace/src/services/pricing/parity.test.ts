/**
 * G-001-A Fase 3.2 — TESTE DE PARIDADE server-side × engine local.
 *
 * O servidor é mockado DETERMINISTICAMENTE a partir do MESMO engine (`calculate` + `projectQuote` do auth-proxy),
 * exatamente como a rota real faz (fonte única, sem recalcular). Adaptamos o QuoteView de volta (`adaptQuote`) e
 * comparamos CAMPO A CAMPO contra o PricingResult local — o que a tela exibiria via engine local vs via servidor.
 *
 * Tolerância ZERO: não há arredondamento de apresentação na camada de dados (o `brl()`/`pct()` arredondam só na
 * renderização, igual para as duas origens). Qualquer divergência numérica REPROVA.
 *
 * Confidencialidade (REQUIREMENT docs/15 §2/§5): a visão `commercial` NUNCA carrega custo/margem/tributo/fee Minu.
 */
import { describe, it, expect } from 'vitest';
import { calculate, defaultScenarios, type PricingInput, type PricingResult } from '@bondly/pricing-engine';
import { projectQuote, type QuoteViewName } from '../../../../auth-proxy/src/quoteProjection';
import { adaptQuote, adaptScenarios } from './quoteAdapter';
import { DEFAULT_INPUT } from '../defaults';

type Patch = (i: PricingInput) => PricingInput;
const base = (): PricingInput => structuredClone(DEFAULT_INPUT);
const withNeg = (p: Partial<PricingInput['negotiation']>): Patch => (i) => ({ ...i, negotiation: { ...i.negotiation, ...p } });
const withCx = (p: Partial<PricingInput['complexity']>): Patch => (i) => ({ ...i, complexity: { ...i.complexity, ...p } });
const withVol = (p: Partial<PricingInput['volume']>): Patch => (i) => ({ ...i, volume: { ...i.volume, ...p } });

/** Cenários representativos: tiers 3/5/7%, Setup 0/10/40/100h, prazos 12/24/36, volumes, serviços. */
function parityInputs(): { name: string; input: PricingInput }[] {
  const out: { name: string; input: PricingInput }[] = [{ name: 'default', input: base() }];
  for (const h of [0, 10, 40, 100]) out.push({ name: `setup${h}h`, input: withCx({ implementationHours: h })(base()) });
  for (const t of [0.03, 0.05, 0.07]) out.push({ name: `tier${t}`, input: withNeg({ tierDiscount: t })(base()) });
  for (const term of [12, 24, 36] as const) out.push({ name: `term${term}`, input: withNeg({ term })(base()) });
  for (const users of [1000, 25000, 150000, 400000]) out.push({ name: `users${users}`, input: withVol({ users })(base()) });
  // Com serviços dedicados (alimenta servicesMrr e o preço mensal) — mesmo perfil das fixtures do servidor.
  const svc = base();
  out.push({
    name: 'services',
    input: { ...svc, services: { ...svc.services, profiles: [{ name: 'Dev', quantity: 2, totalCompensation: 18000, directCosts: 500 }], passthroughPct: 0.1 } },
  });
  return out;
}

/** Projeta como a rota real: termo vem do input, cenários pelo MESMO engine. */
function serverQuote(view: QuoteViewName, input: PricingInput) {
  const r = calculate(input);
  const scenarios = defaultScenarios(input).map((s) => ({ name: s.name, result: s.result }));
  return projectQuote(view, r, input.negotiation.term, scenarios);
}

/** Campos que a visão COMMERCIAL exibe nas telas (sem custo/margem). */
const COMMERCIAL_FIELDS: (keyof PricingResult)[] = [
  'engineVersion', 'premisesVersion', 'tierName', 'isCustom', 'mau', 'dau',
  'platformFee', 'usage', 'processing', 'core', 'servicesMrr', 'setupClient',
  'termDiscount', 'tierDiscount', 'tcvClient', 'clientYear1',
];
/** Campos EXCLUSIVAMENTE internos — devem estar ZERADOS na visão comercial. */
const INTERNAL_ONLY: (keyof PricingResult)[] = [
  'setupNet', 'technicalMargin', 'netMarginY1', 'netMarginSteady', 'tcvBondly',
  'contractContribution', 'contractMargin', 'minuYear1', 'minuContract', 'minuConversionFee', 'minuAccountFee',
];

describe('paridade quote.v1: servidor (mesmo engine) × engine local', () => {
  const cases = parityInputs();

  describe('visão internal — PricingResult completo bit-a-bit', () => {
    for (const c of cases) {
      it(`internal paridade exata — ${c.name}`, () => {
        const local = calculate(c.input);
        const adapted = adaptQuote(serverQuote('internal', c.input));
        expect(adapted.hasInternal).toBe(true);
        // internal devolve o PricingResult verbatim ⇒ igualdade estrutural total (custo, margem, tributo, hash).
        expect(adapted.result).toEqual(local);
      });
    }

    it('cenários internos idênticos ao engine local', () => {
      const local = defaultScenarios(base()).map((s) => ({ name: s.name, result: s.result }));
      const adapted = adaptScenarios(serverQuote('internal', base()));
      expect(adapted).toEqual(local);
    });
  });

  describe('visão commercial — campos exibidos iguais; internos ausentes', () => {
    for (const c of cases) {
      it(`commercial paridade dos campos públicos — ${c.name}`, () => {
        const local = calculate(c.input);
        const adapted = adaptQuote(serverQuote('commercial', c.input));
        expect(adapted.hasInternal).toBe(false);
        for (const f of COMMERCIAL_FIELDS) {
          expect(adapted.result[f], `campo ${String(f)}`).toStrictEqual(local[f]);
        }
      });
    }

    it('Setup (fixo/horas/subtotal/total) e waterfall batem com o engine local', () => {
      const i = withCx({ implementationHours: 40 })(base());
      const local = calculate(i);
      const a = adaptQuote(serverQuote('commercial', i)).result;
      expect(a.setup.fixed).toStrictEqual(local.setup.fixed);
      expect(a.setup.implementationHours).toStrictEqual(local.setup.implementationHours);
      expect(a.setup.hourlyRate).toStrictEqual(local.setup.hourlyRate);
      expect(a.setup.implementationSubtotal).toStrictEqual(local.setup.implementationSubtotal);
      expect(a.setup.otherAdditions).toStrictEqual(local.setup.otherAdditions);
      expect(a.setupClient).toStrictEqual(local.setupClient);
      expect(a.discountWaterfall.final).toStrictEqual(local.discountWaterfall.final);
      expect(a.discountWaterfall.afterTierDiscount).toStrictEqual(local.discountWaterfall.afterTierDiscount);
      expect(a.discountWaterfall.afterCommercialDiscount).toStrictEqual(local.discountWaterfall.afterCommercialDiscount);
    });
  });

  // REQUIREMENT docs/15 §2/§5: perfil comercial (business/approver) NUNCA recebe custo/margem com flag=server.
  describe('confidencialidade — commercial sem campo interno', () => {
    for (const c of cases) {
      it(`sem custo/margem na visão comercial — ${c.name}`, () => {
        const a = adaptQuote(serverQuote('commercial', c.input)).result;
        expect(a.costs).toEqual({ cleverTap: 0, infra: 0, invoices: 0, communication: 0, total: 0 });
        expect(a.taxes).toEqual({ rate: 0, onCore: 0, onServices: 0, total: 0 });
        for (const f of INTERNAL_ONLY) expect(a[f], `campo interno ${String(f)} deve ser 0`).toStrictEqual(0);
        // marginStatus não vaza sinal de margem real para quem não vê interno.
        expect(a.marginStatus).toBe('INCOMPLETO');
      });
    }

    it('payload commercial do servidor não tem a chave `result`/`costs`/`taxes`', () => {
      const q = serverQuote('commercial', base()) as unknown as Record<string, unknown>;
      expect(q.result).toBeUndefined();
      expect(q.costs).toBeUndefined();
      expect(q.taxes).toBeUndefined();
      expect(q.scenariosFull).toBeUndefined();
    });
  });
});
