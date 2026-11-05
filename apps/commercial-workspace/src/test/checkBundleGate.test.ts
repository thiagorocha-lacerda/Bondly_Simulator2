// F-04 (docs/14) — trava a regra do gate de bundle (scripts/check-bundle.mjs). Exercita os regex contra
// fixtures de string, sem tocar o dist. Garante que a forma NUA de identificador é pega (função/alias/cru)
// e que as formas legítimas de property-key / property-access permanecem permitidas.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs sem tipos; importamos só os regex para o teste.
import { bareId, FORBIDDEN } from '../../../../scripts/check-bundle.mjs';

const hits = (token: string, text: string) => {
  const entry = FORBIDDEN.find((f: { id: string }) => f.id === token);
  if (!entry) throw new Error(`token ${token} ausente em FORBIDDEN`);
  return entry.re.test(text);
};

describe('check-bundle gate — regra de identificador nu', () => {
  it('pega a FUNÇÃO (chamada)', () => {
    expect(hits('platformFeeTable', 'return platformFeeTable(input)')).toBe(true);
  });

  it('pega o ALIAS por atribuição', () => {
    expect(hits('platformFeeTable', 'const f=platformFeeTable; f(x)')).toBe(true);
  });

  it('pega a referência CRUA do identificador', () => {
    expect(hits('cleverTap', 'foo(cleverTap)')).toBe(true);
  });

  it('PERMITE property-access (.platformFeeTable)', () => {
    expect(hits('platformFeeTable', 'children:[T(t.platformFeeTable)]')).toBe(false);
  });

  it('PERMITE property-key (platformFeeTable:0)', () => {
    expect(hits('platformFeeTable', 'costs:{platformFeeTable:0,mau:0}')).toBe(false);
  });

  it('PERMITE campos legítimos do resultado como chave', () => {
    const resultObj = 'costs:{cleverTap:0,minuConversionFee:0,minuAccountFee:0,technicalMargin:0,premisesHash:""}';
    for (const t of ['cleverTap', 'minuConversionFee', 'minuAccountFee', 'technicalMargin', 'premisesHash']) {
      expect(hits(t, resultObj)).toBe(false);
    }
  });

  it('netMargin nu NÃO casa o prefixo de campo netMarginY1', () => {
    expect(hits('netMargin', 'technicalMargin:0,netMarginY1:0,netMarginSteady:0')).toBe(false);
    expect(hits('netMargin', 'return netMargin')).toBe(true);
  });

  it('bareId é uma factory de RegExp reutilizável', () => {
    expect(bareId('foo').test('=foo')).toBe(true);
    expect(bareId('foo').test('.foo')).toBe(false);
    expect(bareId('foo').test('foo:1')).toBe(false);
  });
});
