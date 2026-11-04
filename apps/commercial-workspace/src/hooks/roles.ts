/**
 * Perfis (espelho de apps/auth-proxy/src/rbac.ts) — usado SÓ para rótulos e para refletir a UI.
 * A autorização real é do servidor; nenhuma regra financeira vive aqui.
 */
export type Role = 'business' | 'tech' | 'approver' | 'admin';

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  business: 'Negócios',
  tech: 'Projetos & Tecnologia',
  approver: 'Gestor/Aprovador',
  admin: 'Administrador',
};

export const ALL_ROLES: readonly Role[] = ['business', 'tech', 'approver', 'admin'];

/** Perfis que podem ver custo/margem (visão interna). Negócios e Gestor/Aprovador ficam na visão comercial. */
export function canUseInternalView(role: Role | null): boolean {
  return role === 'tech' || role === 'admin';
}
