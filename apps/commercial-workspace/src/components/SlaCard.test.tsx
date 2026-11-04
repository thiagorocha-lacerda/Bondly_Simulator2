import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SlaCard } from './SlaCard';
import { PAUSE_REASONS } from '../hooks/pauseReasons';

afterEach(() => vi.unstubAllGlobals());

const slaState = {
  phase: 'em_andamento', health: 'no_prazo', startedAt: 1, dueAt: 2, businessDaysElapsed: 1, businessDaysRemaining: 4,
  pausedAt: null, pauseReason: null, completedAt: null, verdict: null, metSla: null,
};
const jsonRes = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: () => Promise.resolve(body) } as Response);

describe('SlaCard — pausa com reasonCode (G-017)', () => {
  it('catálogo pt-BR com 6 códigos; Pausar exige categoria e envia reasonCode', async () => {
    const calls: { url: string; body: Record<string, unknown> | null }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return jsonRes({});
      }
      return jsonRes(url.includes('/meetings') ? { meetings: [] } : { sla: slaState });
    }));
    render(<SlaCard proposalId="BONDLY-2027-000001" role="tech" enabled />);
    const select = await screen.findByLabelText('Motivo da pausa (categoria)');
    expect(PAUSE_REASONS).toHaveLength(6);
    expect(screen.getByRole('option', { name: 'Aguardando cliente' })).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Pausar relógio' });
    await userEvent.type(screen.getByPlaceholderText('Detalhe da pausa (obrigatório)'), 'cliente não respondeu');
    expect(btn).toBeDisabled(); // sem categoria
    await userEvent.selectOptions(select, 'aguardando_cliente');
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toContain('/sla/pause');
    expect(calls[0]!.body).toMatchObject({ reason: 'cliente não respondeu', reasonCode: 'aguardando_cliente' });
  });
});
