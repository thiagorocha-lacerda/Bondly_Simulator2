/**
 * G-001-A Fase 3.2 — Flag de ORIGEM do cálculo de preço (runtime, NÃO build-time).
 *
 * DECISION: a flag é resolvida em RUNTIME, nunca por `VITE_*` (que fixaria a escolha no bundle e exigiria rebuild).
 * Precedência: querystring `?pricingSource=server|local` (vence e PERSISTE em localStorage) > localStorage > default.
 * Default = 'local' ⇒ comportamento IDÊNTICO ao app atual (engine no navegador). 'server' liga o caminho `useQuote`.
 *
 * Por que querystring + localStorage e não um toggle de UI nesta run: o toggle só faz sentido depois que as telas
 * consomem o resultado adaptado (pedaço posterior); a querystring permite ao perfil interno exercitar o caminho
 * server end-to-end sem mudar o padrão de ninguém. Nada aqui lê/expõe segredo.
 */
export type PricingSource = 'local' | 'server';

export const PRICING_SOURCE_DEFAULT: PricingSource = 'local';
const STORAGE_KEY = 'bondly-ws-pricing-source';
const QS_KEY = 'pricingSource';

function isSource(v: unknown): v is PricingSource {
  return v === 'local' || v === 'server';
}

/** Lê a querystring do ambiente dado (default: window.location). Retorna undefined fora do browser. */
function fromQuery(search: string | undefined): PricingSource | undefined {
  if (!search) return undefined;
  try {
    const v = new URLSearchParams(search).get(QS_KEY);
    return isSource(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function fromStorage(): PricingSource | undefined {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isSource(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function persist(v: PricingSource): void {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    /* quota/privado: a escolha fica só nesta aba via retorno da função */
  }
}

/**
 * Resolve a origem efetiva do cálculo. PURA quanto ao resultado; o único efeito colateral é PERSISTIR a escolha
 * da querystring (para a navegação seguinte manter o modo). `search` é injetável para testes.
 */
export function resolvePricingSource(search?: string): PricingSource {
  const effectiveSearch = search ?? (typeof window !== 'undefined' ? window.location.search : undefined);
  const qs = fromQuery(effectiveSearch);
  if (qs) {
    persist(qs);
    return qs;
  }
  return fromStorage() ?? PRICING_SOURCE_DEFAULT;
}

/** true quando o cálculo deve vir do servidor (`useQuote`). Default false. */
export function isServerPricing(search?: string): boolean {
  return resolvePricingSource(search) === 'server';
}
