import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApproverQueue, RequestApproval } from './ApprovalPanels';

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
afterEach(() => vi.unstubAllGlobals());

describe('G-006 — UI de aprovação', () => {
  it('Negócios solicita: só tipos do papel, justificativa obrigatória, envia kind+justification+version', async () => {
    const fetchMock = vi.fn(() => ok({}));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<RequestApproval proposalId="BONDLY-2027-000001" version={4} status="em_analise_tecnica" role="business" onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: /Solicitar aprovação/i }));
    expect(screen.queryByRole('option', { name: /Replanejamento/i })).toBeNull();
    expect(screen.getByRole('option', { name: 'Exceção comercial' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar solicitação/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/Justificativa/i), 'cliente estratégico');
    await user.click(screen.getByRole('button', { name: /Enviar solicitação/i }));
    expect(onDone).toHaveBeenCalled();
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(call[0]).toBe('/api/proposals/BONDLY-2027-000001/approval-requests');
    expect(JSON.parse(call[1].body as string)).toEqual({ kind: 'excecao_comercial', justification: 'cliente estratégico', version: 4 });
  });
  it('rascunho não oferece o botão; aprovador/admin também não', () => {
    const a = render(<RequestApproval proposalId="x" version={1} status="rascunho_comercial" role="business" onDone={() => {}} />);
    expect(a.container.firstChild).toBeNull();
    const b = render(<RequestApproval proposalId="x" version={1} status="em_analise_tecnica" role="approver" onDone={() => {}} />);
    expect(b.container.firstChild).toBeNull();
  });
  it('fila do aprovador: mostra solicitante/tipo/idade/justificativa, sem custo/margem; rejeitar exige justificativa', async () => {
    const item = { id: 'r1', proposalId: 'BONDLY-2027-000001', kind: 'excecao_comercial', kindLabel: 'Exceção comercial', requestedBy: 'ana@minu.co', justification: 'cliente estratégico', ageHours: 3 };
    let pending = [item];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        pending = [];
        return ok({});
      }
      return ok({ requests: pending });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { container } = render(<ApproverQueue enabled />);
    expect(await screen.findByText('Exceção comercial', { exact: false })).toBeInTheDocument();
    expect(container.textContent).toMatch(/ana@minu\.co/);
    expect(container.textContent).toMatch(/cliente estratégico/);
    expect(container.textContent).not.toMatch(/margem|custo/i);
    expect(screen.getByRole('button', { name: 'Rejeitar' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Justificativa da decisão/i), 'ok');
    await user.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(await screen.findByText(/Nenhuma solicitação pendente/i)).toBeInTheDocument();
    const post = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find((c) => c[1]?.method === 'POST')!;
    expect(post[0]).toBe('/api/approval-requests/r1/decision');
    expect(JSON.parse(post[1].body as string)).toEqual({ decision: 'approved', justification: 'ok' });
  });
  it('vazio e erro', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 403 } as Response)));
    render(<ApproverQueue enabled />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
