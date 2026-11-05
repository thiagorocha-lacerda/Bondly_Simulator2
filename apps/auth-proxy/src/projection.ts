/**
 * Projeção de proposta POR PAPEL (prompt §6.2/§6.3/§8).
 *
 * "Não enviar payload completo para o frontend de Negócios para depois esconder campos" (§8).
 * Esta função é a fronteira: dado um papel, devolve SÓ os campos que ele pode ver. Negócios nunca
 * recebe parecer/riscos técnicos nem o snapshot interno; P&T e admin recebem a visão completa.
 *
 * Observação: os VALORES financeiros (custo, margem, breakdown) são recalculados no cliente a partir
 * do PricingInput via o engine; a visão de Negócios usa `audience=external` no front, que já oculta
 * custo/margem. Aqui garantimos que o SERVIDOR não entrega os INPUTS TÉCNICOS e o parecer a Negócios.
 */
import type { Proposal, AuditEntry } from './domain.js';
import { canSeeInternal, type Role } from './rbac.js';

export interface ProposalView {
  readonly id: string;
  readonly version: number;
  readonly status: Proposal['status'];
  readonly ownerEmail: string;
  readonly commercial: Proposal['commercial'];
  readonly createdAt: string;
  readonly updatedAt: string;
  // só para quem pode ver interno:
  readonly technical?: Proposal['technical'];
  readonly snapshot?: unknown;
  readonly technicalSummary?: string; // resumo não-confidencial para Negócios (§6.2)
  // G-025: vínculo de rastreabilidade da reabertura (metadados, não custo/margem) — visível a todos os papéis.
  readonly reopenedFrom?: string;
  readonly supersededBy?: string;
}

/** Projeta a proposta conforme o papel. Negócios: sem technical/snapshot, só um resumo do parecer. */
export function projectProposal(p: Proposal, role: Role | undefined): ProposalView {
  const base: ProposalView = {
    id: p.id,
    version: p.version,
    status: p.status,
    ownerEmail: p.ownerEmail,
    commercial: p.commercial,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    ...(p.reopenedFrom !== undefined ? { reopenedFrom: p.reopenedFrom } : {}),
    ...(p.supersededBy !== undefined ? { supersededBy: p.supersededBy } : {}),
  };
  if (canSeeInternal(role)) {
    return {
      ...base,
      ...(p.technical !== undefined ? { technical: p.technical } : {}),
      ...(p.snapshot !== undefined ? { snapshot: p.snapshot } : {}),
    };
  }
  // Negócios: resumo de viabilidade sem expor riscos/esforço detalhados (§6.2).
  const verdict = p.technical?.verdict;
  const summary =
    verdict === 'aprovado'
      ? 'Viabilidade técnica: aprovado'
      : verdict === 'ajustes'
        ? 'Viabilidade técnica: ajustes solicitados'
        : verdict === 'reprovado'
          ? 'Viabilidade técnica: reprovado'
          : 'Viabilidade técnica: pendente';
  return { ...base, technicalSummary: summary };
}

/** Auditoria filtrada: Negócios vê um resumo (ação/estado/data), P&T/admin veem tudo (com notas). */
export function projectAudit(entries: readonly AuditEntry[], role: Role | undefined): readonly Partial<AuditEntry>[] {
  if (canSeeInternal(role)) return entries;
  return entries.map((e) => ({
    id: e.id,
    proposalId: e.proposalId,
    actorEmail: e.actorEmail,
    role: e.role,
    action: e.action,
    ...(e.fromState ? { fromState: e.fromState } : {}),
    ...(e.toState ? { toState: e.toState } : {}),
    at: e.at,
    // note (justificativa técnica) OMITIDA para Negócios (§5.2: sem expor confidencial)
  }));
}
