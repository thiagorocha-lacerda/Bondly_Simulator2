import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreviewModal } from './PreviewModal';
import { AudienceProvider } from '../app/audience';
import { DEFAULT_INPUT } from '../services/defaults';

// Mocka o gerador de PDF para simular falha sem invocar jsPDF real.
vi.mock('../services/pdf', () => ({
  generateProposalPdf: vi.fn().mockRejectedValue(new Error('jspdf indisponível')),
}));

const SEQ_KEY = 'bondly-proposal-seq';

describe('PreviewModal — falha ao gerar NÃO queima a sequência (§15)', () => {
  beforeEach(() => localStorage.clear());

  it('erro é exibido e o contador de sequência permanece inalterado', async () => {
    const user = userEvent.setup();
    localStorage.setItem(SEQ_KEY, '41'); // próximo seria 42
    render(
      <AudienceProvider initial="internal">
        <PreviewModal input={DEFAULT_INPUT} onClose={() => {}} />
      </AudienceProvider>,
    );
    // G-001: o checkbox/ações só renderizam após o snapshot (engine, DEV) carregar — espera o render.
    fireEvent.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Gerar PDF do cliente/i }));

    await waitFor(() => expect(screen.getByText(/Não foi possível gerar o PDF/i)).toBeInTheDocument());
    // a sequência NÃO foi consumida — continua 41
    expect(localStorage.getItem(SEQ_KEY)).toBe('41');
    expect(screen.getByText(/Nenhum identificador foi consumido/i)).toBeInTheDocument();
  });
});
