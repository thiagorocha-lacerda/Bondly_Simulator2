import { useCallback, useEffect, useMemo, useState } from 'react';
import type { B2cInput } from '@bondly/pricing-types';
import { IS_DEV, loadDevEngine } from '../services/pricing/devEngine';

const KEY = 'bondly-ws-b2c';
const INCLUDE_KEY = 'bondly-ws-b2c-include';
const ENABLED_KEY = 'bondly-ws-b2c-enabled';

export const B2C_DEFAULTS: Partial<B2cInput> = {
  som: 2_400_000,
  conv: 0.01,
  ticket: 10,
  churn: 0.08,
  fee: 0.1,
  gateway: 0.05,
  tax: 0.15,
  minFee: 2,
  minuShare: 0.5,
  commission: 0,
  method: 'progressiva',
  scope: 'primeira',
  validation: 0,
  cardReuse: 0.005,
  setup: 3000,
  minMargin: 1500,
  addCost: 0,
  weights: [10, 14, 17, 19, 20, 20],
};

function loadRaw(): Partial<B2cInput> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...B2C_DEFAULTS, ...(JSON.parse(raw) as Partial<B2cInput>) } : B2C_DEFAULTS;
  } catch {
    return B2C_DEFAULTS;
  }
}

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function loadInclude(): boolean {
  try {
    // Normaliza no boot: include só vale se o módulo estiver habilitado (fecha estados órfãos
    // enabled=false + include=true de versões anteriores ao encadeamento).
    return localStorage.getItem(INCLUDE_KEY) === '1' && localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export interface UseB2c {
  readonly raw: Partial<B2cInput>;
  readonly input: B2cInput; // normalizado
  readonly enabled: boolean; // módulo de vendas habilitado na simulação?
  readonly include: boolean; // entra no snapshot/PDF da proposta?
  set: (patch: Partial<B2cInput>) => void;
  setEnabled: (on: boolean) => void;
  setInclude: (on: boolean) => void;
  reset: () => void;
}

/**
 * Fonte ÚNICA do estado B2C (§7.5). O painel edita e o fluxo de proposta (PreviewModal) lê o MESMO
 * estado — assim o funil B2C entra no snapshot/PDF quando `include` está ligado. Persistência local.
 * `enabled` habilita o módulo de vendas (mostra os campos nos dois modos); `include` leva ao PDF.
 */
export function useB2c(): UseB2c {
  const [raw, setRaw] = useState<Partial<B2cInput>>(loadRaw);
  const [include, setIncludeState] = useState<boolean>(loadInclude);
  const [enabled, setEnabledState] = useState<boolean>(loadEnabled);

  const set = useCallback((patch: Partial<B2cInput>) => {
    setRaw((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    // Desabilitar o módulo também o tira da proposta — não dá para incluir o que está desligado.
    if (!on) {
      setIncludeState(false);
      try {
        localStorage.setItem(INCLUDE_KEY, '0');
      } catch {
        /* ignore */
      }
    }
  }, []);

  const setInclude = useCallback((on: boolean) => {
    setIncludeState(on);
    try {
      localStorage.setItem(INCLUDE_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  // G-001: normalização canônica via engine SOMENTE em DEV (fora do bundle de produção). Em PROD usa um
  // merge local com os defaults (suficiente para o formulário; a projeção B2C real roda no servidor na Fase 4).
  const localInput = useMemo(() => ({ ...B2C_DEFAULTS, ...raw }) as B2cInput, [raw]);
  const [input, setInput] = useState<B2cInput>(localInput);
  useEffect(() => {
    if (!IS_DEV) {
      setInput(localInput);
      return;
    }
    let alive = true;
    void loadDevEngine().then((eng) => {
      if (alive) setInput(eng.normalizeB2cInput(raw, eng.CURRENT_PREMISES) as B2cInput);
    });
    return () => {
      alive = false;
    };
  }, [raw, localInput]);

  const reset = useCallback(() => {
    setRaw(B2C_DEFAULTS);
    setIncludeState(false);
    setEnabledState(false);
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(INCLUDE_KEY);
      localStorage.removeItem(ENABLED_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { raw, input, enabled, include, set, setEnabled, setInclude, reset };
}
