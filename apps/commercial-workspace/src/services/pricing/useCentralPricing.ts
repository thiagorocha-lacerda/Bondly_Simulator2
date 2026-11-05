/**
 * G-001-A Fase 3.2 — Estado central de preço com origem comutável por FLAG.
 *
 * flag=local (DEFAULT): retorna exatamente o que `usePricing` sempre retornou — engine no navegador, zero mudança.
 * flag=server: o resultado passa a vir de `useQuote` (POST /api/pricing/quote, debounce/estados/erro/sem offline)
 *              adaptado para a MESMA forma (PricingResult-like) via `adaptQuote`. O input/update/reset continuam
 *              em `usePricing` (o servidor é cotado a partir do input local; a UI de edição não muda).
 *
 * NESTA RUN nenhuma tela foi trocada para ler `status`/`error`; App segue lendo `{ result }`. Expomos pricingStatus/
 * pricingError prontos para o pedaço seguinte, sem acoplar as telas ainda. Default garante comportamento idêntico.
 */
import { usePricing, type UsePricing } from '../../hooks/usePricing';
import { useQuote, type QuoteStatus } from './useQuote';
import { adaptQuote } from './quoteAdapter';
import { QuoteError } from './quoteClient';
import { isServerPricing } from './pricingSource';

export interface UseCentralPricing extends UsePricing {
  /** Origem efetiva do cálculo nesta sessão. */
  readonly source: 'local' | 'server';
  /** 'idle'|'calculating'|'ok'|'error' quando source=server; sempre 'ok' quando local (cálculo síncrono). */
  readonly pricingStatus: QuoteStatus;
  readonly pricingError: QuoteError | null;
}

/**
 * Orquestra engine local vs cotação no servidor sob um flag de runtime. Os dois hooks (usePricing/useQuote) são
 * SEMPRE chamados (regra dos hooks), mas `useQuote` fica `enabled:false` quando a origem é local — então não dispara
 * nenhuma requisição e o comportamento é bit-a-bit o atual.
 */
export function useCentralPricing(search?: string): UseCentralPricing {
  const local = usePricing();
  const server = isServerPricing(search);

  // O servidor decide a view pela sessão; o cliente NUNCA pede 'internal'. Sem view ⇒ a máxima do perfil.
  const q = useQuote({ input: local.input, enabled: server });

  if (!server) {
    return { ...local, source: 'local', pricingStatus: 'ok', pricingError: null };
  }

  const adapted = q.quote ? adaptQuote(q.quote) : null;
  // Enquanto a 1ª cotação não chega, mantém o último resultado local como placeholder visual (sem recalcular
  // nada sensível no cliente). O pedaço seguinte troca isto por skeleton/estado 'calculando' nas telas.
  const result = adapted?.result ?? local.result;

  return {
    input: local.input,
    update: local.update,
    reset: local.reset,
    result,
    source: 'server',
    pricingStatus: q.status,
    pricingError: q.error,
  };
}
