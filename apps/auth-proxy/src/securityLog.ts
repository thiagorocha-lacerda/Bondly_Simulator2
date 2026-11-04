/**
 * Log estruturado de eventos RBAC (G-007). Nunca registra e-mail em claro: só pseudônimo curto (correlação).
 * G-014: HMAC-SHA256 com chave derivada de SESSION_SECRET (setLogPseudonymKey no boot) ⇒ não enumerável por
 * dicionário sem a chave. Sem chave configurada (testes/uso isolado) usa chave aleatória por processo.
 */
import { createHmac, randomBytes } from 'node:crypto';

let pseudonymKey: Buffer = randomBytes(32);

export function setLogPseudonymKey(secret: string): void {
  pseudonymKey = createHmac('sha256', secret).update('bondly:log-pseudonym:v1').digest();
}

export function emailRef(email: string): string {
  return createHmac('sha256', pseudonymKey).update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
}

export function logRbacChange(a: { actor: string; target: string; from: string | null; to: string | null }): void {
  console.info(JSON.stringify({ evt: 'rbac_change', actor: emailRef(a.actor), target: emailRef(a.target), from: a.from, to: a.to }));
}

export function logOwnerReassigned(a: { actor: string; proposalId: string; from: string; to: string }): void {
  console.info(
    JSON.stringify({ evt: 'rbac_owner_reassigned', actor: emailRef(a.actor), proposalId: a.proposalId, from: a.from ? emailRef(a.from) : null, to: emailRef(a.to) }),
  );
}

export function logRbacDenied(a: { actor: string; role: string | null; method: string; path: string; reason?: string }): void {
  console.warn(
    JSON.stringify({ evt: 'rbac_denied', actor: emailRef(a.actor), role: a.role, method: a.method, path: a.path, ...(a.reason ? { reason: a.reason } : {}) }),
  );
}

/** G-006: eventos de solicitação/decisão; ator em pseudônimo, sem justificativa (texto livre) nem e-mail. */
export function logApprovalEvent(a: { evt: 'rbac_approval_requested' | 'rbac_approval_decided' | 'rbac_approval_invalidated'; actor: string; proposalId: string; requestId: string; kind: string; decision?: string }): void {
  console.info(JSON.stringify({ evt: a.evt, actor: emailRef(a.actor), proposalId: a.proposalId, requestId: a.requestId, kind: a.kind, ...(a.decision ? { decision: a.decision } : {}) }));
}

/** G-001-A: auditoria da cotação — ator pseudonimizado; NUNCA valores de preço/margem, input nem resultado. */
export function logPricingQuote(a: { actor: string; role: string; view: string; proposalId?: string; engineVersion: string; requiresApproval?: boolean }): void {
  console.info(
    JSON.stringify({ evt: 'pricing_quote', actor: emailRef(a.actor), role: a.role, view: a.view, ...(a.proposalId ? { proposalId: a.proposalId } : {}), engineVersion: a.engineVersion, ...(a.requiresApproval !== undefined ? { requiresApproval: a.requiresApproval } : {}) }),
  );
}

/** G-026: bloqueio de consolidação/emissão por política; só códigos, sem valores. */
export function logEmissionBlocked(a: { actor: string; proposalId: string; transition: string; error: string }): void {
  console.warn(JSON.stringify({ evt: 'emission_blocked', actor: emailRef(a.actor), proposalId: a.proposalId, transition: a.transition, error: a.error }));
}
