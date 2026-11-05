/**
 * Teste de SINCRONIA (G-001-A Fase 3): o espelho de tipos quote.v1 no frontend (quoteTypes.ts) NÃO pode
 * divergir da fonte de verdade no servidor (apps/auth-proxy/src/quoteProjection.ts e pricingQuote.ts).
 * Lemos o SOURCE do auth-proxy só no teste (nunca no bundle) e comparamos os NOMES de campo de cada interface.
 * Se o servidor ganhar/renomear um campo, este teste quebra — como o teste de sincronia dos pauseReasons.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function src(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

/** Extrai os nomes de campo de um bloco `export interface Name { ... }` (chaves de 1º nível por identação). */
function interfaceFields(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name}`);
  if (start < 0) throw new Error(`interface ${name} não encontrada`);
  const open = source.indexOf('{', start);
  // casa chaves balanceadas
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(open + 1, end);
  const fields = new Set<string>();
  // campos de 1º nível: identação de 2 espaços; ignora linhas aninhadas (4+ espaços) e comentários.
  for (const line of body.split('\n')) {
    const m = /^ {2}(?:readonly )?([A-Za-z_][A-Za-z0-9_]*)\??:/.exec(line);
    if (m && m[1]) fields.add(m[1]);
  }
  return [...fields].sort();
}

const serverProjection = src('../../../../auth-proxy/src/quoteProjection.ts');
const serverPricingQuote = src('../../../../auth-proxy/src/pricingQuote.ts');
const mirror = src('./quoteTypes.ts');

describe('quote.v1 — sincronia de tipos frontend ⇄ auth-proxy', () => {
  it('encontra o SOURCE do auth-proxy (caminho relativo válido)', () => {
    expect(serverProjection).toContain('export interface ClientQuote');
    expect(serverPricingQuote).toContain('export function publicCatalog');
  });

  for (const name of ['ClientQuote', 'CommercialQuote', 'InternalQuote']) {
    it(`${name}: mesmos campos de 1º nível no servidor e no espelho`, () => {
      expect(interfaceFields(mirror, name)).toEqual(interfaceFields(serverProjection, name));
    });
  }

  it('MarginAlert/ScenarioPrice espelhados', () => {
    expect(interfaceFields(mirror, 'MarginAlert')).toEqual(interfaceFields(serverProjection, 'MarginAlert'));
    expect(interfaceFields(mirror, 'ScenarioPrice')).toEqual(interfaceFields(serverProjection, 'ScenarioPrice'));
  });

  it('contractVersion idêntico', () => {
    expect(mirror).toContain("QUOTE_CONTRACT_VERSION = 'quote.v1'");
    expect(serverProjection).toContain("QUOTE_CONTRACT_VERSION = 'quote.v1'");
  });

  it('PublicCatalog cobre as chaves que publicCatalog() devolve', () => {
    const catalogKeys = interfaceFields(mirror, 'PublicCatalog');
    for (const k of ['contractVersion', 'premisesVersion', 'tiers', 'tierDiscount', 'terms', 'options', 'communicationStrategies', 'modules']) {
      expect(catalogKeys).toContain(k);
      expect(serverPricingQuote).toContain(`${k}:`);
    }
  });
});
