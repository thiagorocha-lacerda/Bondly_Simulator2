/**
 * G-001-A Fase 3.2 — flag de origem do cálculo. Default DEVE ser 'local' (comportamento atual).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolvePricingSource, isServerPricing, PRICING_SOURCE_DEFAULT } from './pricingSource';

describe('pricingSource (flag de runtime)', () => {
  beforeEach(() => localStorage.clear());

  it('default é local (comportamento idêntico ao app atual)', () => {
    expect(PRICING_SOURCE_DEFAULT).toBe('local');
    expect(resolvePricingSource('')).toBe('local');
    expect(isServerPricing('')).toBe(false);
  });

  it('?pricingSource=server liga o servidor e persiste a escolha', () => {
    expect(resolvePricingSource('?pricingSource=server')).toBe('server');
    expect(localStorage.getItem('bondly-ws-pricing-source')).toBe('server');
    // navegação seguinte (sem querystring) mantém o modo persistido
    expect(resolvePricingSource('')).toBe('server');
  });

  it('?pricingSource=local volta para o engine local', () => {
    localStorage.setItem('bondly-ws-pricing-source', 'server');
    expect(resolvePricingSource('?pricingSource=local')).toBe('local');
  });

  it('valor inválido na querystring cai para localStorage/default', () => {
    expect(resolvePricingSource('?pricingSource=xyz')).toBe('local');
    localStorage.setItem('bondly-ws-pricing-source', 'server');
    expect(resolvePricingSource('?pricingSource=xyz')).toBe('server');
  });
});
