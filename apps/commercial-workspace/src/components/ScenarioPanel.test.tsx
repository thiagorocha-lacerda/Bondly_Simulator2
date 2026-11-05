import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScenarioPanel } from './ScenarioPanel';
import { AudienceProvider } from '../app/audience';
import { DEFAULT_INPUT } from '../services/defaults';

/**
 * §12/§16 — a tabela de cenários NA TELA não pode expor margem técnica/status (internos) em visão
 * comercial. Em visão interna, as colunas aparecem. (O PDF já segue o mesmo contrato.)
 */
describe('ScenarioPanel — confidencialidade por audience (§12/§16)', () => {
  it('visão interna: mostra Margem técnica e Status', async () => {
    render(
      <AudienceProvider initial="internal">
        <ScenarioPanel input={DEFAULT_INPUT} />
      </AudienceProvider>,
    );
    // G-001: a tabela de cenários depende do engine (DEV, import dinâmico) — espera o render assíncrono.
    expect(await screen.findByText(/Margem técnica/i)).toBeInTheDocument();
    expect(screen.getByText(/^Status$/i)).toBeInTheDocument();
  });

  it('visão comercial: oculta Margem técnica e Status; mantém Core MRR e TCV', async () => {
    render(
      <AudienceProvider initial="external">
        <ScenarioPanel input={DEFAULT_INPUT} />
      </AudienceProvider>,
    );
    expect(await screen.findByText(/Core MRR/i)).toBeInTheDocument();
    expect(screen.getByText(/TCV ao cliente/i)).toBeInTheDocument();
    expect(screen.queryByText(/Margem técnica/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Status$/i)).not.toBeInTheDocument();
  });
});
