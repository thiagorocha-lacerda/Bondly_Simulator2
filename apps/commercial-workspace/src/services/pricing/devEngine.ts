/**
 * G-001 (ADR docs/15) — PONTE DEV-ONLY para o Pricing Engine local.
 *
 * DECISION: em PRODUÇÃO o cálculo é EXCLUSIVAMENTE server-side (POST /api/pricing/quote). O motor e as
 * tabelas de custo/margem NÃO entram no bundle do navegador. O único caminho que ainda chama o engine no
 * browser é o modo de desenvolvimento, e o `import()` dinâmico fica LEXICALMENTE DENTRO de um
 * `if (import.meta.env.DEV)`. O Vite substitui `import.meta.env.DEV` por `false` no build de produção, e o
 * Rollup faz dead-code elimination do bloco `if (false) { ... }` — INCLUINDO o `import('@bondly/pricing-engine')`
 * de dentro dele. Resultado: nenhuma linha de `calculate`/`CURRENT_PREMISES`/`cogs`/margens é emitida no `dist`.
 *
 * PROVA: `scripts/check-bundle.mjs` (passo de CI) faz grep no `dist` por identificadores sensíveis e FALHA se
 * achar qualquer um. Em dev, o engine é carregado sob demanda e o app mantém o comportamento legado.
 */
import type { PricingInput, PricingResult, B2cInput } from '@bondly/pricing-types';

/** true somente em `vite dev`/testes; `false` (literal) no build de produção ⇒ habilita o DCE do ramo DEV. */
export const IS_DEV: boolean = import.meta.env.DEV;

/** Módulo público do engine (tipo-only; `typeof import` é apagado no build). */
type EngineModule = typeof import('@bondly/pricing-engine');

let cached: EngineModule | null = null;

/**
 * Carrega o engine SOMENTE em DEV. O `import()` está dentro de `if (import.meta.env.DEV)` para que o build de
 * produção (DEV=false) elimine o ramo inteiro. Em produção retorna rejeição — mas nunca é chamado lá, porque
 * todo consumidor está atrás de `if (IS_DEV)`.
 */
export async function loadDevEngine(): Promise<EngineModule> {
  if (import.meta.env.DEV) {
    if (!cached) cached = (await import('@bondly/pricing-engine')) as EngineModule;
    return cached;
  }
  throw new Error('Pricing Engine local indisponível em produção — o cálculo é server-side (G-001).');
}

export type { PricingInput, PricingResult, B2cInput };
