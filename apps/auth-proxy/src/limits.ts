/**
 * Limites centrais de entrada (G-005 / G-009). Uma única fonte de verdade para tamanhos de texto livre
 * e corpo HTTP — NENHUM campo de texto livre deve ser aceito sem passar por `checkText`.
 */

/** Teto de corpo JSON por requisição (excedeu ⇒ 413, nunca 500). */
export const MAX_BODY_BYTES = 256 * 1024;
/** Teto padrão de texto livre (reason de aprovação, note, objective, ...). */
export const MAX_TEXT_CHARS = 500;
/** Motivo livre de pausa de SLA: só na trilha (NÃO agregado, NÃO exposto ao approver). */
export const MAX_PAUSE_REASON_CHARS = 200;
/** Itens de lista (missingItems/confirmedItems): quantidade e tamanho por item. */
export const MAX_LIST_ITEMS = 20;
export const MAX_ITEM_CHARS = 200;
/** scheduledFor e similares (ISO-8601 cabe com folga). */
export const MAX_SHORT_CHARS = 64;

/**
 * Catálogo FECHADO de motivos de pausa. Só estes códigos são agregados em /api/sla/indicators —
 * texto livre nunca vira dimensão de agregação (evita vazamento ao approver, bloat e "motivos" por grafia).
 */
export const PAUSE_REASON_LABELS = {
  aguardando_cliente: 'Aguardando cliente',
  aguardando_insumos_tecnicos: 'Aguardando insumos técnicos',
  aguardando_reuniao_tecnica: 'Aguardando reunião técnica',
  escopo_indefinido: 'Escopo indefinido',
  dependencia_externa: 'Dependência externa',
  outro: 'Outro',
} as const;
export type PauseReasonCode = keyof typeof PAUSE_REASON_LABELS;
export const PAUSE_REASON_CODES = Object.keys(PAUSE_REASON_LABELS) as PauseReasonCode[];
export function isPauseReasonCode(v: unknown): v is PauseReasonCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PAUSE_REASON_LABELS, v);
}

export type TextCheck = { ok: true; value: string } | { ok: false; error: 'text_too_long' | 'invalid_text'; field: string };

/**
 * G-027: normaliza texto livre. Remove controles C0/C1 (exceto \t \n \r) e apara das PONTAS espaços Unicode,
 * controles e caracteres de formato invisíveis (\u200b \u200c \u200d \u2060 \uFEFF, \p{Cf}). Texto só com invisíveis
 * vira '' (⇒ "vazio" para justificativas obrigatórias). Interior preserva ZWJ (emoji compostos).
 */
const EDGE_INVISIBLE = /^[\s\p{Cc}\p{Cf}]+|[\s\p{Cc}\p{Cf}]+$/gu;
const INNER_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
export function normalizeFreeText(raw: string): string {
  return raw.replace(INNER_CONTROLS, '').replace(EDGE_INVISIBLE, '');
}

/** Valida um texto opcional/obrigatório: tipo string, trim, ≤ max. `undefined`/ausente ⇒ value ''. */
export function checkText(raw: unknown, field: string, max: number = MAX_TEXT_CHARS): TextCheck {
  if (raw === undefined || raw === null) return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_text', field };
  const value = normalizeFreeText(raw);
  if (value.length > max) return { ok: false, error: 'text_too_long', field };
  return { ok: true, value };
}

export type ListCheck = { ok: true; value: string[] } | { ok: false; error: 'text_too_long' | 'invalid_text' | 'too_many_items'; field: string };

/** Lista de strings com limite de itens e de tamanho por item. */
export function checkTextList(raw: unknown, field: string): ListCheck {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'invalid_text', field };
  if (raw.length > MAX_LIST_ITEMS) return { ok: false, error: 'too_many_items', field };
  const out: string[] = [];
  for (const it of raw) {
    const c = checkText(it, field, MAX_ITEM_CHARS);
    if (!c.ok) return c;
    out.push(c.value);
  }
  return { ok: true, value: out };
}

export class BodyTooLargeError extends Error {
  constructor() {
    super('body_too_large');
    this.name = 'BodyTooLargeError';
  }
}

/** G-006: justificativa de solicitação/decisão ao Gestor ≤ limite central de texto livre. */
export const MAX_APPROVAL_JUSTIFICATION_CHARS = MAX_TEXT_CHARS;
export const APPROVAL_KIND_LABELS = {
  excecao_comercial: 'Exceção comercial',
  alteracao_escopo: 'Alteração de escopo',
  replanejamento_sla: 'Replanejamento de SLA',
} as const;
export function isApprovalKind(v: unknown): v is keyof typeof APPROVAL_KIND_LABELS {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(APPROVAL_KIND_LABELS, v);
}

// ───────────── G-001-A: limites da cotação no servidor (POST /api/pricing/quote) ─────────────
/** Corpo da cotação (JSON serializado) — bem abaixo do teto global; excedeu ⇒ 413 `payload_too_large`. */
export const MAX_QUOTE_BODY_CHARS = 32 * 1024;
export const MAX_QUOTE_USERS = 100_000_000;
export const MAX_QUOTE_PROFILES = 50;
export const MAX_QUOTE_NAME_CHARS = 120;
export const MAX_QUOTE_MONEY = 1_000_000_000;
/** Rate limit simples por usuário (debounce do cliente ~250 ms ⇒ ≤ ~4 req/s em digitação contínua). */
export const QUOTE_RATE_LIMIT = { limit: 300, windowMs: 60_000 } as const;
