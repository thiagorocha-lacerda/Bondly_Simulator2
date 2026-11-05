/**
 * G-001-A Fase 3 — Client HTTP do contrato `quote.v1`. Única porta de saída do frontend para o cálculo no
 * servidor (GET /api/pricing/catalog, POST /api/pricing/quote). NÃO contém regra de preço — só transporte,
 * envelope de erro tipado e mensagens pt-BR. O servidor decide a `view` pela sessão: o cliente NUNCA envia
 * `view: 'internal'` (fail-safe: filtramos abaixo e a rota responderia 403 de qualquer forma).
 */
import type { PricingInput } from '@bondly/pricing-types';
import { QUOTE_CONTRACT_VERSION, type PublicCatalog, type QuoteViewName, type QuoteViewPayload } from './quoteTypes';

/** Códigos de erro que a rota quote.v1 pode devolver (espelha os `json(status,{error})` do api.ts). */
export type QuoteErrorCode =
  | 'invalid_body'
  | 'invalid_view'
  | 'invalid_proposal_id'
  | 'input_required'
  | 'unsupported_contract_version'
  | 'forbidden'
  | 'view_forbidden'
  | 'not_found'
  | 'payload_too_large'
  | 'proposal_inputs_incomplete'
  | 'rate_limited'
  | 'unauthenticated'
  | 'network'
  | 'unexpected';

export class QuoteError extends Error {
  readonly code: QuoteErrorCode;
  readonly status: number;
  /** Segundos sugeridos para retry (do header Retry-After em 429), quando disponível. */
  readonly retryAfterSec?: number;
  constructor(code: QuoteErrorCode, status: number, retryAfterSec?: number) {
    super(messageFor(code));
    this.name = 'QuoteError';
    this.code = code;
    this.status = status;
    if (retryAfterSec !== undefined) this.retryAfterSec = retryAfterSec;
  }
}

/** Mensagens pt-BR por código — sem vazar detalhe sensível; o servidor não envia valores de custo/margem. */
export function messageFor(code: QuoteErrorCode): string {
  switch (code) {
    case 'forbidden':
    case 'view_forbidden':
      return 'Você não tem permissão para ver esta cotação.';
    case 'rate_limited':
      return 'Muitas cotações em pouco tempo. Aguarde um instante e tente de novo.';
    case 'not_found':
      return 'Proposta não encontrada.';
    case 'proposal_inputs_incomplete':
      return 'A proposta ainda não tem dados suficientes para cotar.';
    case 'payload_too_large':
      return 'Os dados enviados são grandes demais para cotar.';
    case 'invalid_body':
    case 'invalid_view':
    case 'invalid_proposal_id':
    case 'input_required':
    case 'unsupported_contract_version':
      return 'Não foi possível cotar com os dados atuais.';
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente.';
    case 'network':
      return 'Sem conexão com o servidor de cotação. Verifique sua internet.';
    case 'unexpected':
    default:
      return 'Não foi possível calcular a cotação agora. Tente novamente.';
  }
}

const KNOWN_CODES: readonly QuoteErrorCode[] = [
  'invalid_body', 'invalid_view', 'invalid_proposal_id', 'input_required', 'unsupported_contract_version',
  'forbidden', 'view_forbidden', 'not_found', 'payload_too_large', 'proposal_inputs_incomplete',
  'rate_limited', 'unauthenticated',
];

function codeFromBody(body: unknown, status: number): QuoteErrorCode {
  const raw = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  if (typeof raw === 'string' && (KNOWN_CODES as readonly string[]).includes(raw)) return raw as QuoteErrorCode;
  if (status === 429) return 'rate_limited';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 413) return 'payload_too_large';
  if (status === 401) return 'unauthenticated';
  return 'unexpected';
}

async function parseError(r: Response): Promise<QuoteError> {
  let body: unknown = null;
  try {
    body = await r.json();
  } catch {
    /* corpo não-JSON: mantém unexpected/por status */
  }
  const code = codeFromBody(body, r.status);
  let retryAfterSec: number | undefined;
  const ra = r.headers.get('Retry-After');
  if (ra) {
    const n = Number(ra);
    if (Number.isFinite(n) && n >= 0) retryAfterSec = n;
  }
  return new QuoteError(code, r.status, retryAfterSec);
}

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' } as const;

/** GET /api/pricing/catalog → { catalog }. */
export async function fetchCatalog(signal?: AbortSignal): Promise<PublicCatalog> {
  let r: Response;
  try {
    r = await fetch('/api/pricing/catalog', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) });
  } catch {
    throw new QuoteError('network', 0);
  }
  if (!r.ok) throw await parseError(r);
  const data = (await r.json()) as { catalog: PublicCatalog };
  return data.catalog;
}

export interface PostQuoteArgs {
  readonly input?: PricingInput;
  readonly proposalId?: string;
  /** O servidor decide a view pela sessão. Aceitamos pedir 'client'/'commercial'; 'internal' é bloqueado aqui. */
  readonly view?: Exclude<QuoteViewName, 'internal'>;
  readonly signal?: AbortSignal;
}

/** POST /api/pricing/quote → { quote }. */
export async function postQuote(args: PostQuoteArgs): Promise<QuoteViewPayload> {
  const body: Record<string, unknown> = { contractVersion: QUOTE_CONTRACT_VERSION };
  if (args.input !== undefined) body.input = args.input;
  if (args.proposalId !== undefined) body.proposalId = args.proposalId;
  // Nunca enviar view=internal a partir do cliente (o servidor decide pela sessão).
  if (args.view !== undefined && args.view !== ('internal' as unknown)) body.view = args.view;

  let r: Response;
  try {
    r = await fetch('/api/pricing/quote', {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      ...(args.signal ? { signal: args.signal } : {}),
    });
  } catch {
    throw new QuoteError('network', 0);
  }
  if (!r.ok) throw await parseError(r);
  const data = (await r.json()) as { quote: QuoteViewPayload };
  return data.quote;
}
