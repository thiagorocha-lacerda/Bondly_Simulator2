/**
 * Testes do client HTTP quote.v1 (G-001-A Fase 3): sucesso client/commercial, 403 (view negada), 404/422
 * por proposalId, 429 com Retry-After, erro de rede, e a garantia de que o cliente NUNCA envia view=internal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCatalog, postQuote, QuoteError } from './quoteClient';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Lê [url, init] da chamada `i` do mock de fetch com narrowing seguro (noUncheckedIndexedAccess). */
function call(mock: ReturnType<typeof vi.fn>, i: number): { url: string; init: RequestInit } {
  const c = mock.mock.calls[i];
  if (!c) throw new Error(`fetch não chamado na posição ${i}`);
  return { url: c[0] as string, init: (c[1] ?? {}) as RequestInit };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('quoteClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it('fetchCatalog retorna o catálogo e usa credentials:include', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { catalog: { contractVersion: 'quote.v1', tiers: [] } }));
    const cat = await fetchCatalog();
    expect(cat.contractVersion).toBe('quote.v1');
    const { url, init } = call(fetchMock, 0);
    expect(url).toBe('/api/pricing/catalog');
    expect(init.credentials).toBe('include');
  });

  it('postQuote (client) manda contractVersion e view=client, sem internal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { quote: { view: 'client', contractVersion: 'quote.v1' } }));
    const q = await postQuote({ input: { foo: 1 } as never, view: 'client' });
    expect(q.view).toBe('client');
    const { init } = call(fetchMock, 0);
    const body = JSON.parse(init.body as string);
    expect(body.contractVersion).toBe('quote.v1');
    expect(body.view).toBe('client');
    expect(init.credentials).toBe('include');
  });

  it('postQuote (commercial) devolve a visão comercial', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { quote: { view: 'commercial' } }));
    const q = await postQuote({ input: {} as never, view: 'commercial' });
    expect(q.view).toBe('commercial');
  });

  it('NUNCA envia view=internal mesmo que forçado', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { quote: { view: 'commercial' } }));
    await postQuote({ input: {} as never, view: 'internal' as never });
    const body = JSON.parse(call(fetchMock, 0).init.body as string);
    expect(body.view).toBeUndefined();
  });

  it('403 view_forbidden vira QuoteError tipado', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'view_forbidden' }));
    await expect(postQuote({ input: {} as never, view: 'commercial' })).rejects.toMatchObject({ code: 'view_forbidden', status: 403 });
  });

  it('404 not_found por proposalId', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'not_found' }));
    await expect(postQuote({ proposalId: 'p-1' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('422 proposal_inputs_incomplete por proposalId', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: 'proposal_inputs_incomplete' }));
    await expect(postQuote({ proposalId: 'p-2' })).rejects.toMatchObject({ code: 'proposal_inputs_incomplete' });
  });

  it('429 captura Retry-After', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'rate_limited' }, { 'Retry-After': '3' }));
    const err = await postQuote({ input: {} as never }).catch((e) => e);
    expect(err).toBeInstanceOf(QuoteError);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterSec).toBe(3);
  });

  it('erro de rede vira code=network com mensagem pt-BR', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await postQuote({ input: {} as never }).catch((e) => e);
    expect(err.code).toBe('network');
    expect(err.message).toMatch(/conexão/i);
  });
});
