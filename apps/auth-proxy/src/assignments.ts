/**
 * Atribuição individual de perfis (user_email → role) — lógica de domínio sem I/O de HTTP.
 *
 * ASSUMPTION (doc 10 §9, reversível): o perfil NÃO vem de código compartilhado nem do cookie; é
 * resolvido do repositório a cada request. Justificativa: a sessão é um cookie HMAC stateless de 8h —
 * embutir o papel nele atrasaria a revogação em até 8h. Uma leitura indexada por e-mail por request é
 * barata e dá revogação/rebaixamento IMEDIATOS.
 */
import { ALLOWED_DOMAINS, extractDomain } from './authz.js';
import type { ProposalRepository } from './domain.js';
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';
import { isRole, type Role } from './rbac.js';

/** Normaliza e valida um e-mail contra os domínios autorizados (igualdade exata do domínio). */
export function normalizeAuthorizedEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  const domain = extractDomain(email);
  if (domain === null || !ALLOWED_DOMAINS.includes(domain)) return null;
  return email;
}

/**
 * G-010: e-mail ATRIBUÍVEL — estrito. Parte local ASCII `[a-z0-9._-]` (sem '+alias', sem '@' extra,
 * sem homóglifos/full-width/espaços/zero-width), começando e terminando em alfanumérico, sem '..', ≤64.
 * O domínio segue a regra de igualdade exata. Aliases (+x) não são atribuíveis: nunca casariam com o
 * e-mail canônico do token. Usado em PUT /api/admin/assignments e BOOTSTRAP_ADMIN_EMAILS.
 * (resolveEffectiveRole continua usando a normalização leniente: a sessão vem de e-mail verificado.)
 */
const STRICT_LOCAL = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
export function normalizeAssignableEmail(raw: unknown): string | null {
  const email = normalizeAuthorizedEmail(raw);
  if (email === null) return null;
  if ((email.match(/@/g) ?? []).length !== 1) return null;
  const local = email.slice(0, email.indexOf('@'));
  if (!STRICT_LOCAL.test(local) || local.includes('..')) return null;
  return email;
}

/** Lê BOOTSTRAP_ADMIN_EMAILS (lista separada por vírgula/;/espaço). Entradas inválidas são rejeitadas. */
export function parseBootstrapAdminEmails(raw: string | undefined): { valid: readonly string[]; rejected: readonly string[] } {
  const valid = new Set<string>();
  const rejected: string[] = [];
  for (const item of (raw ?? '').split(/[,;\s]+/).filter(Boolean)) {
    const email = normalizeAssignableEmail(item);
    if (email) valid.add(email);
    else rejected.push(item);
  }
  return { valid: [...valid], rejected };
}

export type RoleSource = 'assignment' | 'legacy';
export interface EffectiveRole {
  readonly role: Role;
  readonly source: RoleSource;
}

/**
 * Perfil efetivo da sessão. Ordem: (1) atribuição no repositório; (2) SOMENTE com LEGACY_PROFILE_CODES=true,
 * o papel elevado pelo código legado (nunca `approver`). Domínio fora da lista autorizada ⇒ sem perfil
 * (defesa em profundidade, mesmo que exista atribuição).
 */
export async function resolveEffectiveRole(
  session: SessionData,
  repo: ProposalRepository,
  cfg: Pick<ServerConfig, 'legacyProfileCodes'>,
): Promise<EffectiveRole | null> {
  if (normalizeAuthorizedEmail(session.email) === null) return null;
  const a = await repo.getAssignment(session.email);
  if (a && isRole(a.role)) return { role: a.role, source: 'assignment' };
  if (cfg.legacyProfileCodes === true && session.role && isRole(session.role) && session.role !== 'approver') {
    return { role: session.role, source: 'legacy' };
  }
  return null;
}

export const BOOTSTRAP_ACTOR = 'bootstrap:env';

/**
 * Bootstrap seguro do primeiro admin: só atua quando NÃO existe nenhum admin atribuído. Cada e-mail
 * precisa estar num domínio autorizado (já filtrado no parse). Auditado com ator 'bootstrap:env'.
 * Sem segredo; após existir um admin, a variável é ignorada (não vira backdoor permanente).
 */
export async function bootstrapAdmins(repo: ProposalRepository, emails: readonly string[]): Promise<readonly string[]> {
  if (emails.length === 0) return [];
  const existing = await repo.listAssignments();
  if (existing.some((a) => a.role === 'admin')) return [];
  const created: string[] = [];
  for (const email of emails) {
    await repo.setAssignment(email, 'admin', BOOTSTRAP_ACTOR);
    created.push(email);
  }
  return created;
}
