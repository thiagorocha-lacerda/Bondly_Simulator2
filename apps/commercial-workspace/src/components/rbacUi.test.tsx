import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SlaDashboard, SlaIndicatorsPanel } from './SlaDashboard';
import { AssignmentsAdmin } from './AssignmentsAdmin';
import { ROLE_LABELS, canUseInternalView } from '../hooks/roles';

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
afterEach(() => vi.unstubAllGlobals());

describe('perfis (rótulos pt-BR)', () => {
  it('4 rótulos e só tech/admin usam a visão interna (custo/margem)', () => {
    expect(ROLE_LABELS).toEqual({ business: 'Negócios', tech: 'Projetos & Tecnologia', approver: 'Gestor/Aprovador', admin: 'Administrador' });
    expect(canUseInternalView('business')).toBe(false);
    expect(canUseInternalView('approver')).toBe(false);
    expect(canUseInternalView('tech')).toBe(true);
    expect(canUseInternalView('admin')).toBe(true);
    expect(canUseInternalView(null)).toBe(false);
  });
});

describe('SlaIndicatorsPanel (P75/P90)', () => {
  it('exibe tempo útil efetivo e tempo bruto com rótulos distintos, sem custo/margem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        ok({
          indicators: {
            n: 10,
            slaBusinessDays: 5,
            effective: { mean: 5.5, median: 5.5, p75: 8, p90: 9 },
            raw: { mean: 6.5, median: 6, p75: 9, p90: 11 },
            pctWithinSla: 50,
            pausesByReason: [{ reason: 'Aguardando cliente', businessDays: 4, proposals: 2 }],
          },
        }),
      ),
    );
    const { container } = render(<SlaIndicatorsPanel enabled />);
    expect(await screen.findByText(/Tempo útil efetivo/i)).toBeInTheDocument();
    expect(screen.getByText(/Tempo bruto/i)).toBeInTheDocument();
    expect(screen.getByText('P75')).toBeInTheDocument();
    expect(screen.getByText('P90')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/margem|custo/i);
  });
  it('n=0 → mensagem de vazio; erro → alerta; desabilitado → nada', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({ indicators: { n: 0, slaBusinessDays: 5, effective: {}, raw: {}, pctWithinSla: null, pausesByReason: [] } })));
    const { unmount } = render(<SlaIndicatorsPanel enabled />);
    expect(await screen.findByText(/Nenhuma proposta com SLA concluído/i)).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 403 } as Response)));
    const r2 = render(<SlaIndicatorsPanel enabled />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    r2.unmount();
    const r3 = render(<SlaIndicatorsPanel enabled={false} />);
    expect(r3.container.firstChild).toBeNull();
  });
  it('SlaDashboard não renderiza nada para Negócios', () => {
    const { container } = render(<SlaDashboard proposals={[]} role="business" enabled />);
    expect(container.firstChild).toBeNull();
  });
});

describe('AssignmentsAdmin', () => {
  it('lista atribuições, envia PUT para atribuir e mostra erro do servidor', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'email_not_allowed' }) } as Response);
      return ok({
        assignments: [{ email: 'ana@minu.co', role: 'admin', assignedBy: 'bootstrap:env', assignedAt: '2027-01-01' }],
        audit: [{ id: '1', targetEmail: 'ana@minu.co', actorEmail: 'bootstrap:env', fromRole: null, toRole: 'admin', at: '2027-01-01' }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AssignmentsAdmin />);
    expect(await screen.findByText('ana@minu.co')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gestor/Aprovador' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/E-mail corporativo/i), 'x@evil.com');
    await user.selectOptions(screen.getByLabelText('Perfil'), 'approver');
    await user.click(screen.getByRole('button', { name: /Atribuir perfil/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/domínios autorizados/i);
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')!;
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({ email: 'x@evil.com', role: 'approver' });
  });
});

describe('AssignmentsAdmin — reatribuição de dono (G-002)', () => {
  it('envia PUT /api/admin/proposals/:id/owner e mostra erro/sucesso do servidor', async () => {
    let n = 0;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        n += 1;
        return n === 1
          ? Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'email_not_allowed' }) } as Response)
          : ok({ changed: true });
      }
      if (String(_url).includes('/owner')) return ok({ version: 3 });
      return ok({ assignments: [], audit: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AssignmentsAdmin />);
    await user.type(await screen.findByLabelText(/Proposta \(ID\)/i), 'BONDLY-2027-000001');
    await user.type(screen.getByLabelText(/Novo dono/i), 'x@evil.com');
    await user.click(screen.getByRole('button', { name: /Reatribuir dono/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/domínios autorizados/i);
    await user.clear(screen.getByLabelText(/Novo dono/i));
    await user.type(screen.getByLabelText(/Novo dono/i), 'novo@minu.co');
    await user.click(screen.getByRole('button', { name: /Reatribuir dono/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/reatribuído/i);
    const put = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT').pop()!;
    expect(put[0]).toBe('/api/admin/proposals/BONDLY-2027-000001/owner');
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({ ownerEmail: 'novo@minu.co', version: 3 });
  });
});

