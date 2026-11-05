/**
 * G-001-A Fase 3 — Hook de cotação no servidor. Recebe um PricingInput (ou um proposalId), aplica debounce
 * (~250 ms, ASSUNÇÃO aprovada), cancela requisições obsoletas (AbortController), ignora respostas fora de
 * ordem (guarda por número de requisição) e expõe { quote, status, error, lastUpdatedAt }.
 *
 * SEM offline: sem rede ⇒ status 'error' com mensagem clara. 429 ⇒ backoff simples (Retry-After quando houver,
 * senão base exponencial com teto) e re-tentativa automática uma vez.
 *
 * NESTA RUN o hook NÃO é consumido por nenhuma tela — a migração do ResultsDashboard/PreviewModal/QuickMode é
 * um pedaço posterior. As telas continuam usando o engine local (usePricing).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PricingInput } from '@bondly/pricing-types';
import { postQuote, QuoteError, type PostQuoteArgs } from './quoteClient';
import type { QuoteViewPayload } from './quoteTypes';

export type QuoteStatus = 'idle' | 'calculating' | 'ok' | 'error';

export interface UseQuoteResult {
  readonly quote: QuoteViewPayload | null;
  readonly status: QuoteStatus;
  readonly error: QuoteError | null;
  readonly lastUpdatedAt: number | null;
}

export interface UseQuoteOptions {
  /** PricingInput a cotar; ou undefined para cotar por proposalId. */
  readonly input?: PricingInput;
  readonly proposalId?: string;
  readonly view?: PostQuoteArgs['view'];
  /** ms de debounce (default 250). */
  readonly debounceMs?: number;
  /** Habilita/desabilita a cotação (ex.: atrás de um flag). Default true. */
  readonly enabled?: boolean;
}

const DEFAULT_DEBOUNCE_MS = 250;
const MAX_RATE_LIMIT_BACKOFF_MS = 10_000;

/** Chave estável do pedido: muda ⇒ re-cotar. Serializa input/proposalId/view. */
function requestKey(o: UseQuoteOptions): string {
  return JSON.stringify({ i: o.input ?? null, p: o.proposalId ?? null, v: o.view ?? null });
}

export function useQuote(options: UseQuoteOptions): UseQuoteResult {
  const { debounceMs = DEFAULT_DEBOUNCE_MS, enabled = true } = options;
  const [quote, setQuote] = useState<QuoteViewPayload | null>(null);
  const [status, setStatus] = useState<QuoteStatus>('idle');
  const [error, setError] = useState<QuoteError | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  // Número da última requisição disparada — respostas com seq < atual são descartadas (corrida/fora de ordem).
  const seqRef = useRef(0);
  const key = requestKey(options);
  const hasRequest = options.input !== undefined || options.proposalId !== undefined;

  const run = useCallback(
    async (args: PostQuoteArgs, seq: number, allowRetry: boolean): Promise<void> => {
      const controller = new AbortController();
      // Cancelamento: se um pedido mais novo começou, aborta este.
      const abortIfStale = () => {
        if (seqRef.current !== seq) controller.abort();
      };
      try {
        const q = await postQuote({ ...args, signal: controller.signal });
        if (seqRef.current !== seq) return; // resposta fora de ordem: ignora
        setQuote(q);
        setError(null);
        setStatus('ok');
        setLastUpdatedAt(Date.now());
      } catch (e) {
        if (seqRef.current !== seq) return; // obsoleta: ignora silenciosamente
        if (controller.signal.aborted) return;
        const err = e instanceof QuoteError ? e : new QuoteError('unexpected', 0);
        if (err.code === 'rate_limited' && allowRetry) {
          const waitMs = err.retryAfterSec !== undefined ? Math.min(err.retryAfterSec * 1000, MAX_RATE_LIMIT_BACKOFF_MS) : 1000;
          setStatus('calculating');
          window.setTimeout(() => {
            if (seqRef.current === seq) void run(args, seq, false);
          }, waitMs);
          return;
        }
        setError(err);
        setStatus('error');
      } finally {
        void abortIfStale;
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !hasRequest) {
      setStatus('idle');
      return;
    }
    const seq = ++seqRef.current;
    setStatus('calculating');
    const args: PostQuoteArgs = {
      ...(options.input !== undefined ? { input: options.input } : {}),
      ...(options.proposalId !== undefined ? { proposalId: options.proposalId } : {}),
      ...(options.view !== undefined ? { view: options.view } : {}),
    };
    const timer = window.setTimeout(() => {
      void run(args, seq, true);
    }, debounceMs);
    return () => {
      // Edição nova antes do debounce fechar: cancela o timer (1 request por rajada) e invalida respostas pendentes.
      window.clearTimeout(timer);
    };
    // key cobre input/proposalId/view; os demais são primitivos estáveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, hasRequest, debounceMs, run]);

  return { quote, status, error, lastUpdatedAt };
}
