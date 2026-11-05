/**
 * Papéis e decisão de autorização RBAC (prompt §6).
 *
 * Função PURA e exaustivamente testável — espelha o padrão de `authz.ts` (autorização por domínio).
 * O enforcement real roda no servidor (server.ts chama `can(...)` em TODA rota sensível). O React
 * nunca é a fronteira de segurança (§6: "ocultar campos no React não constitui proteção").
 */

/**
 * Os 4 perfis do sponsor (brief §11/§10):
 *  - `business` Negócios · `tech` Projetos & Tecnologia · `approver` Gestor/Aprovador · `admin` Administrador.
 * O perfil é atribuído INDIVIDUALMENTE por usuário (tabela user_email→role, ver domain.ts), nunca por
 * código compartilhado. O papel `approver` NÃO é alcançável pelo fluxo legado de código (DEPRECATED).
 */
export type Role = 'business' | 'tech' | 'approver' | 'admin';

export const ROLES: readonly Role[] = ['business', 'tech', 'approver', 'admin'];

/** Rótulos pt-BR (a UI espelha estes valores; o servidor é a fronteira de segurança). */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  business: 'Negócios',
  tech: 'Projetos & Tecnologia',
  approver: 'Gestor/Aprovador',
  admin: 'Administrador',
};

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

/**
 * Ações sensíveis do sistema. Cada rota/ação do servidor mapeia para uma destas.
 * `see_internal` governa custo/margem/breakdown técnico — a linha que separa Negócios de P&T (§6.2/§6.3).
 */
export type Action =
  | 'proposal.create'
  | 'proposal.read'
  | 'proposal.edit_commercial'
  | 'proposal.edit_technical'
  | 'proposal.edit_tier_discount'
  | 'proposal.see_internal' // custo, margem, breakdown técnico
  | 'proposal.validate_technical'
  | 'proposal.emit'
  | 'proposal.reopen' // G-025: reabrir proposta emitida criando NOVA VERSÃO — só approver/admin
  | 'proposal.read_audit_full'
  | 'sla.manage' // pausar/retomar/concluir o relógio técnico (§6.3/§6.4)
  | 'sla.configure' // alterar prazo/calendário do SLA (§6.2 — só admin)
  | 'approval.request' // G-006: business (exceção/escopo) e tech (replanejamento de SLA) solicitam ao Gestor
  | 'approval.read_queue' // G-006: fila de pendências do aprovador (sem custo/margem)
  | 'approval.decide' // aprovar/recusar exceções comerciais, alterações de escopo e replanejamentos (approver)
  | 'sla.view_indicators' // indicadores gerenciais P75/P90 (sem custo/margem) — approver/admin/tech
  | 'admin.manage_users' // atribuição de perfis por usuário + auditoria de atribuições (admin)
  | 'admin.reassign_owner' // G-002: troca o dono (ownerEmail) de uma proposta, com auditoria (admin)
  | 'pricing.quote'; // G-001-A: cotação NO SERVIDOR; a saída é projetada por perfil (quoteProjection.ts)

/** Lista exaustiva das ações (usada pelos testes da matriz e pela UI para refletir permissões). */
export const ACTIONS: readonly Action[] = [
  'proposal.create',
  'proposal.read',
  'proposal.edit_commercial',
  'proposal.edit_technical',
  'proposal.edit_tier_discount',
  'proposal.see_internal',
  'proposal.validate_technical',
  'proposal.emit',
  'proposal.reopen',
  'proposal.read_audit_full',
  'sla.manage',
  'sla.configure',
  'approval.request',
  'approval.read_queue',
  'approval.decide',
  'sla.view_indicators',
  'admin.manage_users',
  'admin.reassign_owner',
  'pricing.quote',
];

/** Matriz inicial (§6.1) — refinável após auditoria das necessidades reais. */
const MATRIX: Readonly<Record<Role, ReadonlySet<Action>>> = {
  business: new Set<Action>([
    'proposal.create',
    'proposal.read',
    'proposal.edit_commercial',
    'proposal.edit_tier_discount',
    'approval.request',
    'proposal.emit', // só após aprovação exigida — validado também pela máquina de estados
    'pricing.quote', // visão `commercial` (sem custo/margem)
  ]),
  tech: new Set<Action>([
    'proposal.read',
    'proposal.edit_technical',
    'proposal.see_internal',
    'proposal.validate_technical',
    'proposal.read_audit_full',
    'approval.request',
    'sla.manage', // P&T opera o relógio técnico: pausa justificada, retomada, parecer (§6.3/§6.4)
    'sla.view_indicators',
    'pricing.quote', // visão `internal` (see_internal)
  ]),
  // Gestor/Aprovador: decide exceções/replanejamentos e acompanha indicadores. NÃO edita
  // dimensionamento técnico nem configuração; sem see_internal (menor privilégio — ASSUMPTION doc 10 §9).
  approver: new Set<Action>(['proposal.read', 'proposal.reopen', 'approval.decide', 'approval.read_queue', 'sla.view_indicators', 'pricing.quote']),
  admin: new Set<Action>([
    'proposal.read',
    'proposal.reopen', // G-025: admin também reabre proposta emitida (nova versão)
    'proposal.see_internal',
    'proposal.read_audit_full',
    'sla.manage',
    'sla.configure', // §6.2: prazo/calendário do SLA só mudam por admin, com trilha de auditoria
    'sla.view_indicators',
    'admin.manage_users',
    'admin.reassign_owner',
    'pricing.quote', // visão `internal` (see_internal)
  ]),
};

/** Decisão pura: o papel pode executar a ação? `undefined`/papel inválido ⇒ false (deny-by-default). */
export function can(role: Role | undefined, action: Action): boolean {
  if (!role || !isRole(role)) return false;
  return MATRIX[role].has(action);
}

/** Conveniência: o papel enxerga dados internos (custo/margem/breakdown)? */
export function canSeeInternal(role: Role | undefined): boolean {
  return can(role, 'proposal.see_internal');
}
