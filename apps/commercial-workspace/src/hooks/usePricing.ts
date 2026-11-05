import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PricingInput, PricingResult } from '@bondly/pricing-types';
import { DEFAULT_INPUT } from '../services/defaults';
import { EMPTY_RESULT } from '../services/pricing/emptyResult';
import { IS_DEV, loadDevEngine } from '../services/pricing/devEngine';
import type { DeepPartial } from '../services/patch';

const STORAGE_KEY = 'bondly-ws-input';

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const k of Object.keys(patch) as (keyof T)[]) {
    const pv = patch[k] as unknown;
    const bv = (base as Record<string, unknown>)[k as string];
    out[k as string] =
      pv && typeof pv === 'object' && !Array.isArray(pv) && bv && typeof bv === 'object'
        ? deepMerge(bv, pv as DeepPartial<typeof bv>)
        : pv;
  }
  return out as T;
}

function loadStored(): PricingInput {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_INPUT;
    return deepMerge(DEFAULT_INPUT, JSON.parse(raw) as DeepPartial<PricingInput>);
  } catch {
    return DEFAULT_INPUT;
  }
}

export interface UsePricing {
  readonly input: PricingInput;
  readonly result: PricingResult;
  update: (patch: DeepPartial<PricingInput>) => void;
  reset: () => void;
}

/**
 * Estado central LOCAL — SOMENTE DEV (G-001). Em produção o cálculo é server-side (useCentralPricing/useQuote);
 * este hook só é exercitado quando `import.meta.env.DEV` é verdadeiro. O engine é carregado por import dinâmico
 * (devEngine) atrás do guard DEV, então o motor/tabelas NÃO entram no bundle de produção. Em produção o `result`
 * aqui é o EMPTY_RESULT (nunca exibido: a origem efetiva é o servidor), mantido só para satisfazer a mesma forma.
 */
export function usePricing(): UsePricing {
  const [input, setInput] = useState<PricingInput>(loadStored);
  const [result, setResult] = useState<PricingResult>(EMPTY_RESULT);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
    } catch {
      /* quota/privado: ignora, dados ficam em memória */
    }
  }, [input]);

  // DEV: recalcula localmente via engine carregado sob demanda. PROD: ramo eliminado (DCE), result = EMPTY_RESULT.
  useEffect(() => {
    if (!IS_DEV) return;
    let alive = true;
    void loadDevEngine().then((eng) => {
      if (alive) setResult(eng.calculate(input));
    });
    return () => {
      alive = false;
    };
  }, [input]);

  const update = useCallback((patch: DeepPartial<PricingInput>) => {
    setInput((prev) => deepMerge(prev, patch));
  }, []);

  const reset = useCallback(() => {
    setInput(DEFAULT_INPUT);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return useMemo(() => ({ input, result, update, reset }), [input, result, update, reset]);
}
