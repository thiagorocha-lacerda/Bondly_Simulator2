/**
 * G-002 — escopo de visibilidade de propostas por DONO (decisão do sponsor, docs/16).
 *
 * Função PURA, ponto único da regra (api.ts e os repositórios a reutilizam):
 *  - business: só propostas com ownerEmail == próprio e-mail (normalizado). Dono vazio/legado ⇒ ninguém além do admin.
 *  - tech / approver: só propostas fora do rascunho (estado ≥ aguardando_analise_tecnica).
 *  - admin: todas.
 * Fora do escopo ⇒ a API responde 404 (não 403) para não revelar existência.
 */
import type { Proposal } from './domain.js';
import type { Role } from './rbac.js';

export function normalizeOwner(email: string | undefined | null): string {
  return (email ?? '').trim().toLowerCase();
}

/** Igualdade de dono; vazio nunca casa (proposta legada sem dono é órfã ⇒ só admin). */
export function ownerMatches(ownerEmail: string | undefined | null, actorEmail: string | undefined | null): boolean {
  const o = normalizeOwner(ownerEmail);
  return o !== '' && o === normalizeOwner(actorEmail);
}

export function canAccessProposal(
  role: Role | undefined,
  actorEmail: string,
  p: Pick<Proposal, 'ownerEmail' | 'status'>,
): boolean {
  switch (role) {
    case 'admin':
      return true;
    case 'business':
      return ownerMatches(p.ownerEmail, actorEmail);
    case 'tech':
    case 'approver':
      return p.status !== 'rascunho_comercial';
    default:
      return false;
  }
}

/**
 * G-021: histórico (SLA/auditoria/reuniões) de proposta que já foi submetida e voltou ao rascunho (`retomar`).
 * Só tech/approver, só se houve submissão; NÃO concede leitura/escrita do corpo da proposta nem de rascunho nunca submetido.
 */
export function canAccessResumedHistory(role: Role | undefined, p: Pick<Proposal, 'status'>, everSubmitted: boolean): boolean {
  return (role === 'tech' || role === 'approver') && p.status === 'rascunho_comercial' && everSubmitted;
}
