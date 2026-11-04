/**
 * G-001-A — validação ESTRITA do PricingInput recebido na cotação (POST /api/pricing/quote) e lido das propostas.
 *
 * Fronteira de confiança: o corpo vem do navegador. Aqui só se validam FORMA e LIMITES (NaN/Infinity/negativos/tamanho/
 * enums/chaves desconhecidas). Nenhuma fórmula de preço/custo/margem vive aqui — a fonte única é o Pricing Engine.
 * Devolve um objeto NOVO e tipado (nunca repassa o objeto cru do cliente ao motor).
 */
import type { PricingInput, CommunicationStrategy, CommercialOption, ContractMonths, CampaignObjective, ChannelMix } from '@bondly/pricing-engine';
import { checkText, MAX_QUOTE_USERS, MAX_QUOTE_PROFILES, MAX_QUOTE_NAME_CHARS, MAX_QUOTE_MONEY } from './limits.js';

export type QuoteInputResult = { readonly ok: true; readonly input: PricingInput } | { readonly ok: false; readonly error: 'invalid_input'; readonly field: string };

class Bad extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function obj(v: unknown, path: string, allowed: readonly string[], strict: boolean): Obj {
  if (!isObj(v)) throw new Bad(path);
  if (strict) for (const k of Object.keys(v)) if (!allowed.includes(k)) throw new Bad(`${path}.${k}`);
  return v;
}
function num(v: unknown, path: string, min: number, max: number, int = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) throw new Bad(path);
  return v;
}
const frac = (v: unknown, path: string): number => num(v, path, 0, 1);
function optNum(v: unknown, path: string, min: number, max: number, int = false): number | undefined {
  return v === undefined || v === null ? undefined : num(v, path, min, max, int);
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new Bad(path);
  return v;
}
function oneOf<T extends string | number>(v: unknown, path: string, allowed: readonly T[]): T {
  if (!allowed.includes(v as T)) throw new Bad(path);
  return v as T;
}
function text(v: unknown, path: string, max: number): string {
  const c = checkText(v, path, max);
  if (!c.ok) throw new Bad(path);
  return c.value;
}
function mix(v: unknown, path: string, strict: boolean): ChannelMix {
  const o = obj(v, path, ['sms', 'email', 'rcs', 'wa'], strict);
  return { sms: frac(o.sms, `${path}.sms`), email: frac(o.email, `${path}.email`), rcs: frac(o.rcs, `${path}.rcs`), wa: frac(o.wa, `${path}.wa`) };
}

const STRATEGIES: readonly CommunicationStrategy[] = ['rcs', 'wa', 'sms', 'email', 'both', 'fallback', 'custom', 'none'];
const OPTIONS: readonly CommercialOption[] = ['floor', 'recommended', 'premium'];
const TERMS: readonly ContractMonths[] = [12, 24, 36];
const OBJECTIVES: readonly CampaignObjective[] = ['Aquisição', 'Ativação', 'Conversão', 'Engajamento'];

export const PRICING_INPUT_KEYS = ['volume', 'invoices', 'communication', 'complexity', 'negotiation', 'services', 'campaign', 'arka'] as const;

/**
 * `strict`=true (corpo da cotação): chaves desconhecidas em QUALQUER nível ⇒ erro.
 * `strict`=false (inputs persistidos da proposta): ignora chaves extras (a proposta pode carregar metadados do cliente,
 * ex.: módulos selecionados), mas valida TODOS os campos do PricingInput da mesma forma.
 */
export function parsePricingInput(raw: unknown, strict = true): QuoteInputResult {
  try {
    return { ok: true, input: parse(raw, strict) };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: 'invalid_input', field: e.field };
    throw e;
  }
}

function parse(raw: unknown, strict: boolean): PricingInput {
  const top = obj(raw, 'input', PRICING_INPUT_KEYS, strict);

  const v = obj(top.volume, 'volume', ['users', 'mauPct', 'stickiness', 'transactionsPerMau'], strict);
  const volume = {
    users: num(v.users, 'volume.users', 0, MAX_QUOTE_USERS, true),
    mauPct: frac(v.mauPct, 'volume.mauPct'),
    stickiness: frac(v.stickiness, 'volume.stickiness'),
    transactionsPerMau: num(v.transactionsPerMau, 'volume.transactionsPerMau', 0, 1000),
  };

  const iv = obj(top.invoices, 'invoices', ['enabled', 'participantPct', 'notesPerParticipant'], strict);
  const invoices = {
    enabled: bool(iv.enabled, 'invoices.enabled'),
    participantPct: frac(iv.participantPct, 'invoices.participantPct'),
    notesPerParticipant: num(iv.notesPerParticipant, 'invoices.notesPerParticipant', 0, 1000, true),
  };

  const cm = obj(top.communication, 'communication', ['perMau', 'strategy', 'fallbackRate', 'customMix'], strict);
  const communication = {
    perMau: num(cm.perMau, 'communication.perMau', 0, 1000),
    strategy: oneOf(cm.strategy, 'communication.strategy', STRATEGIES),
    fallbackRate: frac(cm.fallbackRate, 'communication.fallbackRate'),
    customMix: mix(cm.customMix, 'communication.customMix', strict),
  };

  const cx = obj(top.complexity, 'complexity', ['integrations', 'modules', 'slaPoints', 'customizationPoints', 'aiPoints', 'migrationPoints', 'implementationHours'], strict);
  const complexity = {
    integrations: num(cx.integrations, 'complexity.integrations', 0, 1000, true),
    modules: num(cx.modules, 'complexity.modules', 0, 100, true),
    slaPoints: num(cx.slaPoints, 'complexity.slaPoints', 0, 100),
    customizationPoints: num(cx.customizationPoints, 'complexity.customizationPoints', 0, 100),
    aiPoints: num(cx.aiPoints, 'complexity.aiPoints', 0, 100),
    migrationPoints: num(cx.migrationPoints, 'complexity.migrationPoints', 0, 100),
    implementationHours: num(cx.implementationHours, 'complexity.implementationHours', 0, 100_000),
  };

  const ng = obj(
    top.negotiation,
    'negotiation',
    ['option', 'extraDiscount', 'tierDiscount', 'term', 'viaMinu', 'expansion', 'strategic', 'setupFixedReductionPct', 'setupOtherAdditions'],
    strict,
  );
  const tierDiscount = optNum(ng.tierDiscount, 'negotiation.tierDiscount', 0, 1);
  const setupFixedReductionPct = optNum(ng.setupFixedReductionPct, 'negotiation.setupFixedReductionPct', 0, 1);
  const setupOtherAdditions = optNum(ng.setupOtherAdditions, 'negotiation.setupOtherAdditions', 0, MAX_QUOTE_MONEY);
  const negotiation = {
    option: oneOf(ng.option, 'negotiation.option', OPTIONS),
    extraDiscount: frac(ng.extraDiscount, 'negotiation.extraDiscount'),
    ...(tierDiscount !== undefined ? { tierDiscount } : {}),
    term: oneOf(ng.term, 'negotiation.term', TERMS),
    viaMinu: bool(ng.viaMinu, 'negotiation.viaMinu'),
    expansion: bool(ng.expansion, 'negotiation.expansion'),
    strategic: bool(ng.strategic, 'negotiation.strategic'),
    ...(setupFixedReductionPct !== undefined ? { setupFixedReductionPct } : {}),
    ...(setupOtherAdditions !== undefined ? { setupOtherAdditions } : {}),
  };

  const sv = obj(
    top.services,
    'services',
    ['profiles', 'tablePrice', 'minMargin', 'compCap', 'targetMargin', 'passthroughPct', 'startMonth', 'hourMinMargin', 'productiveHoursPerMonth', 'hourCost', 'negotiatedHourPrice'],
    strict,
  );
  if (!Array.isArray(sv.profiles) || sv.profiles.length > MAX_QUOTE_PROFILES) throw new Bad('services.profiles');
  const profiles = sv.profiles.map((pr, i) => {
    const path = `services.profiles[${i}]`;
    const o = obj(pr, path, ['name', 'quantity', 'totalCompensation', 'directCosts', 'tablePrice', 'negotiatedPrice'], strict);
    const tablePrice = optNum(o.tablePrice, `${path}.tablePrice`, 0, MAX_QUOTE_MONEY);
    const negotiatedPrice = optNum(o.negotiatedPrice, `${path}.negotiatedPrice`, 0, MAX_QUOTE_MONEY);
    return {
      name: text(o.name, `${path}.name`, MAX_QUOTE_NAME_CHARS),
      quantity: num(o.quantity, `${path}.quantity`, 0, 1000),
      totalCompensation: num(o.totalCompensation, `${path}.totalCompensation`, 0, MAX_QUOTE_MONEY),
      directCosts: num(o.directCosts, `${path}.directCosts`, 0, MAX_QUOTE_MONEY),
      ...(tablePrice !== undefined ? { tablePrice } : {}),
      ...(negotiatedPrice !== undefined ? { negotiatedPrice } : {}),
    };
  });
  const services = {
    profiles,
    tablePrice: num(sv.tablePrice, 'services.tablePrice', 0, MAX_QUOTE_MONEY),
    minMargin: num(sv.minMargin, 'services.minMargin', 0, MAX_QUOTE_MONEY),
    compCap: num(sv.compCap, 'services.compCap', 0, MAX_QUOTE_MONEY),
    targetMargin: optNum(sv.targetMargin, 'services.targetMargin', 0, 1),
    passthroughPct: frac(sv.passthroughPct, 'services.passthroughPct'),
    startMonth: num(sv.startMonth, 'services.startMonth', 1, 12, true),
    hourMinMargin: num(sv.hourMinMargin, 'services.hourMinMargin', 0, MAX_QUOTE_MONEY),
    productiveHoursPerMonth: num(sv.productiveHoursPerMonth, 'services.productiveHoursPerMonth', 1, 744),
    hourCost: optNum(sv.hourCost, 'services.hourCost', 0, MAX_QUOTE_MONEY),
    negotiatedHourPrice: optNum(sv.negotiatedHourPrice, 'services.negotiatedHourPrice', 0, MAX_QUOTE_MONEY),
  };

  const cp = obj(
    top.campaign,
    'campaign',
    ['enabled', 'objectives', 'base', 'consentPct', 'frequency', 'months', 'mix', 'deliveryRate', 'conversionRate', 'activationRate', 'operationHours', 'markup'],
    strict,
  );
  if (!Array.isArray(cp.objectives) || cp.objectives.length > OBJECTIVES.length) throw new Bad('campaign.objectives');
  const campaign = {
    enabled: bool(cp.enabled, 'campaign.enabled'),
    objectives: cp.objectives.map((o, i) => oneOf(o, `campaign.objectives[${i}]`, OBJECTIVES)),
    base: optNum(cp.base, 'campaign.base', 0, MAX_QUOTE_USERS, true),
    consentPct: frac(cp.consentPct, 'campaign.consentPct'),
    frequency: num(cp.frequency, 'campaign.frequency', 0, 1000),
    months: num(cp.months, 'campaign.months', 0, 60, true),
    mix: mix(cp.mix, 'campaign.mix', strict),
    deliveryRate: mix(cp.deliveryRate, 'campaign.deliveryRate', strict),
    conversionRate: frac(cp.conversionRate, 'campaign.conversionRate'),
    activationRate: frac(cp.activationRate, 'campaign.activationRate'),
    operationHours: num(cp.operationHours, 'campaign.operationHours', 0, 100_000),
    markup: num(cp.markup, 'campaign.markup', 0, 10),
  };

  let arka: PricingInput['arka'];
  if (top.arka !== undefined && top.arka !== null) {
    const a = obj(top.arka, 'arka', ['clientName', 'goLiveDate', 'owner', 'evidenceStage', 'probability'], strict);
    arka = {
      clientName: text(a.clientName, 'arka.clientName', MAX_QUOTE_NAME_CHARS),
      goLiveDate: text(a.goLiveDate, 'arka.goLiveDate', 32),
      owner: text(a.owner, 'arka.owner', MAX_QUOTE_NAME_CHARS),
      evidenceStage: num(a.evidenceStage, 'arka.evidenceStage', 1, 15, true),
      probability: num(a.probability, 'arka.probability', 0, 100),
    };
  }

  return { volume, invoices, communication, complexity, negotiation, services, campaign, ...(arka ? { arka } : {}) };
}
