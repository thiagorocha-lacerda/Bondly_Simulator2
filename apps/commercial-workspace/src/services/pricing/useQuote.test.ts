/**
 * Testes do hook useQuote (G-001-A Fase 3): debounce (N edições ⇒ 1 request), estado 'calculating'→'ok',
 * corrida (resposta antiga ignorada quando a nova chega primeiro), 429 com backoff e re-tentativa, erro de
 * rede ⇒ status 'error' (SEM offline). jsdom + fake timers; fetch mockado por teste.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useQuote } from './useQuote';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useQuote', () => {
  it('sem input/proposalId ⇒ status idle, sem request', () => {
    const { result } = renderHook(() => useQuote({}));
    expect(result.current.status).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cotação feliz: calculating → ok, expõe quote e lastUpdatedAt', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { quote: { view: 'commercial' } }));
    const { result } = renderHook(() => useQuote({ input: { a: 1 } as never, debounceMs: 10 }));
    expect(result.current.status).toBe('calculating');
    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current.quote).toMatchObject({ view: 'commercial' });
    expect(result.current.lastUpdatedAt).toBeGreaterThan(0);
  });

  it('debounce: N edições rápidas ⇒ 1 request', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse(200, { quote: { view: 'client' } }));
    const { rerender } = renderHook(({ n }) => useQuote({ input: { a: n } as never, debounceMs: 250 }), { initialProps: { n: 1 } });
    rerender({ n: 2 });
    rerender({ n: 3 });
    rerender({ n: 4 });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    const body = JSON.parse((firstCall?.[1] as RequestInit).body as string);
    expect(body.input.a).toBe(4);
  });

  it('corrida: resposta da requisição antiga é ignorada', async () => {
    let resolveFirst!: (r: Response) => void;
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((res) => { resolveFirst = res; }))
      .mockResolvedValueOnce(jsonResponse(200, { quote: { view: 'commercial', tag: 'new' } }));
    const { result, rerender } = renderHook(({ n }) => useQuote({ input: { a: n } as never, debounceMs: 0 }), { initialProps: { n: 1 } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender({ n: 2 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.quote).toMatchObject({ tag: 'new' }));
    // a antiga resolve DEPOIS — deve ser descartada
    await act(async () => {
      resolveFirst(jsonResponse(200, { quote: { view: 'client', tag: 'old' } }));
      await Promise.resolve();
    });
    expect(result.current.quote).toMatchObject({ tag: 'new' });
  });

  it('429: faz backoff e re-tenta uma vez, chegando a ok', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limited' }, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(jsonResponse(200, { quote: { view: 'client' } }));
    const { result } = renderHook(() => useQuote({ input: {} as never, debounceMs: 0 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.status).toBe('calculating');
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    await vi.waitFor(() => expect(result.current.status).toBe('ok'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('erro de rede ⇒ status error com mensagem clara (sem offline)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useQuote({ input: {} as never, debounceMs: 0 }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.code).toBe('network');
    expect(result.current.error?.message).toMatch(/conexão/i);
  });

  it('enabled=false ⇒ não dispara request', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { quote: { view: 'client' } }));
    renderHook(() => useQuote({ input: {} as never, enabled: false, debounceMs: 0 }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
