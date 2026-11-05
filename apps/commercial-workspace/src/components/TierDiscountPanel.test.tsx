import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TierDiscountPanel } from './TierDiscountPanel';
import { DEFAULT_INPUT } from '../services/defaults';
import { calculate, type PricingInput } from '@bondly/pricing-engine';
import * as quoteClient from '../services/pricing/quoteClient';
import type { PublicCatalog } from '../services/pricing/quoteTypes';
import { QUOTE_CONTRACT_VERSION } from '../services/pricing/quoteTypes';

// G-001 (Opção b, docs/14): o painel lê tiers/limites APENAS de GET /api/pricing/catalog (nenhum engine
// no cliente). O teste monta `result` com `calculate` do engine (uso de TESTE, não shippado no bundle —
// `scripts/check-bundle.mjs` prova 0 ocorrências no dist) e MOCKA `fetchCatalog` com o catálogo público.
const CATALOG: PublicCatalog = {
  contractVersion: QUOTE_CONTRACT_VERSION,
  premisesVersion: 'test',
  tiers: [
    { name: 'Starter', maxUsers: 10000 },
    { name: 'Growth', maxUsers: 50000 },
    { name: 'Scale', maxUsers: 200000 },
  ],
  tierDiscount: { min: 0.03, max: 0.07 },
  terms: [12, 24, 36],
  options: ['floor', 'recommended', 'premium'],
  communicationStrategies: ['none'],
  modules: [],
};

function renderPanel(input: PricingInput, update = vi.fn()) {
  const result = calculate(input);
  render(<TierDiscountPanel input={input} result={result} update={update} />);
  return { update };
}

describe('TierDiscountPanel (§3.1)', () => {
  beforeEach(() => {
    vi.spyOn(quoteClient, 'fetchCatalog').mockResolvedValue(CATALOG);
  });

  it('mostra o tier ativo e a faixa 3,00%–7,00% (do catálogo do servidor)', async () => {
    renderPanel(DEFAULT_INPUT); // 50k usuários → Growth
    expect((await screen.findAllByText('Growth')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3,00%.*7,00%|3.00%.*7.00%/i).length).toBeGreaterThan(0);
  });

  it('valor válido (5) propaga a fração', async () => {
    const user = userEvent.setup();
    const { update } = renderPanel(DEFAULT_INPUT);
    const input = await screen.findByLabelText(/Desconto do tier ativo/i);
    await user.clear(input);
    await user.type(input, '5');
    expect(update).toHaveBeenCalledWith({ negotiation: { tierDiscount: 0.05 } });
  });

  it('valor fora da faixa (2,99) mostra erro inline e NÃO propaga', async () => {
    const user = userEvent.setup();
    const { update } = renderPanel(DEFAULT_INPUT);
    const input = await screen.findByLabelText(/Desconto do tier ativo/i);
    await user.clear(input);
    await user.type(input, '2.99');
    expect(await screen.findByRole('alert')).toHaveTextContent(/ficar entre 3\.00% e 7\.00%/i);
    const calls = update.mock.calls.map((c) => c[0]?.negotiation?.tierDiscount);
    expect(calls).not.toContain(0.0299);
  });

  it('acima do máximo (7,01) mostra erro de faixa', async () => {
    const user = userEvent.setup();
    renderPanel(DEFAULT_INPUT);
    const input = await screen.findByLabelText(/Desconto do tier ativo/i);
    await user.clear(input);
    await user.type(input, '7.01');
    expect(await screen.findByRole('alert')).toHaveTextContent(/ficar entre 3\.00% e 7\.00%/i);
  });

  it('"Restaurar valores padrão" confirma e zera o desconto por tier', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const withDisc: PricingInput = { ...DEFAULT_INPUT, negotiation: { ...DEFAULT_INPUT.negotiation, tierDiscount: 0.05 } };
    const { update } = renderPanel(withDisc);
    await user.click(await screen.findByRole('button', { name: /Restaurar valores padrão/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ negotiation: { tierDiscount: 0 } });
    confirmSpy.mockRestore();
  });

  it('mostra o waterfall quando há desconto aplicado', async () => {
    const withDisc: PricingInput = { ...DEFAULT_INPUT, negotiation: { ...DEFAULT_INPUT.negotiation, tierDiscount: 0.05 } };
    renderPanel(withDisc);
    expect(await screen.findByText(/Waterfall do Platform Fee/i)).toBeInTheDocument();
    expect(screen.getByText(/Platform Fee final/i)).toBeInTheDocument();
  });
});
