import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { normalizeB2cInput, CURRENT_PREMISES } from '@bondly/pricing-engine';
import { PreviewModal } from './PreviewModal';
import { AudienceProvider, type Audience } from '../app/audience';
import { DEFAULT_INPUT } from '../services/defaults';

/**
 * §12/§16 — a proposta externa (visão comercial) NÃO pode expor números internos da Bondly.
 * O bloco B2C mostra o "resultado Bondly H2" (margem interna) só na visão interna; na comercial,
 * mostra apenas o volume ao cliente (assinantes ativos). Este teste trava esse contrato.
 */
describe('PreviewModal — confidencialidade por audience (§12/§16)', () => {
  const b2cInput = normalizeB2cInput(
    { som: 2_400_000, conv: 0.01, ticket: 10, churn: 0.08, fee: 0.1, weights: [10, 14, 17, 19, 20, 20] },
    CURRENT_PREMISES,
  );
  const renderWith = (audience: Audience, b2c = b2cInput as typeof b2cInput | undefined) =>
    render(
      <AudienceProvider initial={audience}>
        <PreviewModal input={DEFAULT_INPUT} b2cInput={b2c} onClose={() => {}} />
      </AudienceProvider>,
    );

  it('visão interna: expõe o resultado Bondly H2 do B2C', async () => {
    renderWith('internal');
    // G-001: o snapshot da pré-visualização vem do engine (DEV, import dinâmico) — espera o render assíncrono.
    expect(await screen.findByText(/resultado Bondly H2/i)).toBeInTheDocument();
    expect(screen.queryByText(/ativos em dez/i)).not.toBeInTheDocument();
  });

  it('visão comercial: NÃO expõe o resultado Bondly; mostra só assinantes ativos', async () => {
    renderWith('external');
    expect(await screen.findByText(/ativos em dez/i)).toBeInTheDocument();
    expect(screen.queryByText(/resultado Bondly H2/i)).not.toBeInTheDocument();
  });

  it('sem B2C incluído: nenhuma linha B2C em qualquer visão', () => {
    const { rerender } = render(
      <AudienceProvider initial="external">
        <PreviewModal input={DEFAULT_INPUT} onClose={() => {}} />
      </AudienceProvider>,
    );
    expect(screen.queryByText(/Assinaturas B2C/i)).not.toBeInTheDocument();
    rerender(
      <AudienceProvider initial="internal">
        <PreviewModal input={DEFAULT_INPUT} onClose={() => {}} />
      </AudienceProvider>,
    );
    expect(screen.queryByText(/Assinaturas B2C/i)).not.toBeInTheDocument();
  });

  it('Esc fecha o modal (acessibilidade de teclado)', () => {
    const onClose = vi.fn();
    render(
      <AudienceProvider initial="internal">
        <PreviewModal input={DEFAULT_INPUT} onClose={onClose} />
      </AudienceProvider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('avisa quando não há cliente nomeado; sem aviso quando preenchido', async () => {
    const { unmount } = render(
      <AudienceProvider initial="internal">
        <PreviewModal input={DEFAULT_INPUT} onClose={() => {}} />
      </AudienceProvider>,
    );
    // G-001: o aviso só renderiza após o snapshot (engine, DEV) — espera o render assíncrono.
    expect(await screen.findByText(/Sem cliente nomeado/i)).toBeInTheDocument();
    unmount();

    const withClient = { ...DEFAULT_INPUT, arka: { ...(DEFAULT_INPUT.arka ?? { goLiveDate: '', owner: '', evidenceStage: 1, probability: 0 }), clientName: 'ACME' } };
    render(
      <AudienceProvider initial="internal">
        <PreviewModal input={withClient} onClose={() => {}} />
      </AudienceProvider>,
    );
    // espera o snapshot carregar (tabela do cliente) e confirma que o aviso NÃO aparece
    expect(await screen.findByText(/Tier · usuários/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sem cliente nomeado/i)).not.toBeInTheDocument();
  });
});
