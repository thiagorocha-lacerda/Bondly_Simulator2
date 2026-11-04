/**
 * Implementação in-memory do ProposalRepository (contrato em domain.ts).
 *
 * É a implementação de referência do contrato — usada nos testes e como default enquanto a camada
 * SQLite (node:sqlite, Disk da Render via DATA_DIR) não é plugada. A troca é drop-in: qualquer backend
 * que implemente ProposalRepository serve às rotas sem alterá-las (§1.1 do doc 10).
 *
 * Nota honesta: in-memory NÃO persiste entre reinícios do processo. Em produção, trocar por SQLite.
 */
import { randomUUID } from 'node:crypto';
import {
  type Proposal,
  type ProposalRepository,
  type CreateProposalArgs,
  type AuditEntry,
  type SlaEventRow,
  type MeetingRecord,
  type MeetingLogEntry,
  type RoleAssignment,
  type AssignmentAuditEntry,
  type OwnerAuditEntry,
  type ApprovalRequest,
  ApprovalConflictError,
  IssuedImmutableError,
  VersionConflictError,
  NotFoundError,
  LastAdminError,
} from './domain.js';
import { ownerMatches } from './scope.js';
import { statusAfterMaterialEdit, kindsInvalidatedBy } from './workflow.js';

export function createMemoryRepository(now: () => string = () => new Date().toISOString()): ProposalRepository {
  const proposals = new Map<string, Proposal>();
  const audits = new Map<string, AuditEntry[]>();
  const slaByProposal = new Map<string, SlaEventRow[]>();
  const meetings = new Map<string, MeetingRecord>();
  const approvals = new Map<string, 'approved' | 'rejected'>(); // chave `${proposalId}|${kind}` (G-018)
  const assignments = new Map<string, RoleAssignment>();
  const assignmentLog: AssignmentAuditEntry[] = [];
  const ownerLog: OwnerAuditEntry[] = [];
  const approvalRequests = new Map<string, ApprovalRequest>();
  let seq = 0;

  function appendAudit(proposalId: string, a: Omit<AuditEntry, 'id' | 'proposalId' | 'at'>): void {
    const entry: AuditEntry = { ...a, id: randomUUID(), proposalId, at: now() };
    const list = audits.get(proposalId) ?? [];
    list.push(entry);
    audits.set(proposalId, list);
  }

  return {
    async nextSequence(): Promise<number> {
      return ++seq;
    },

    async create(args: CreateProposalArgs, audit): Promise<Proposal> {
      if (proposals.has(args.id)) throw new Error(`proposta já existe: ${args.id}`);
      const ts = now();
      const p: Proposal = {
        id: args.id,
        version: 1,
        status: 'rascunho_comercial',
        ownerEmail: args.ownerEmail,
        commercial: args.commercial,
        createdAt: ts,
        updatedAt: ts,
      };
      proposals.set(p.id, p);
      appendAudit(p.id, audit);
      return p;
    },

    async get(id: string): Promise<Proposal | null> {
      return proposals.get(id) ?? null;
    },

    async list(): Promise<readonly Proposal[]> {
      return [...proposals.values()].sort((a, b) => (a.id < b.id ? 1 : -1));
    },

    async update(id, expectedVersion, patch, audit, opts): Promise<Proposal> {
      const current = proposals.get(id);
      if (!current) throw new NotFoundError(id);
      if (opts?.requireOwner !== undefined && !ownerMatches(current.ownerEmail, opts.requireOwner)) throw new NotFoundError(id);
      if (current.version !== expectedVersion) {
        throw new VersionConflictError(id, expectedVersion, current.version);
      }
      const next: Proposal = {
        ...current,
        ...('status' in patch && patch.status ? { status: patch.status } : {}),
        ...('commercial' in patch && patch.commercial ? { commercial: patch.commercial } : {}),
        ...('technical' in patch && patch.technical !== undefined ? { technical: patch.technical } : {}),
        ...('snapshot' in patch && patch.snapshot !== undefined ? { snapshot: patch.snapshot } : {}),
        version: current.version + 1,
        updatedAt: now(),
      };
      proposals.set(id, next);
      appendAudit(id, audit);
      return next;
    },

    async editProposal(a) {
      // corpo SÍNCRONO ⇒ atômico no event loop; todas as validações ANTES de qualquer mutação.
      const current = proposals.get(a.id);
      if (!current) throw new NotFoundError(a.id);
      if (a.requireOwner !== undefined && !ownerMatches(current.ownerEmail, a.requireOwner)) throw new NotFoundError(a.id);
      if (current.version !== a.expectedVersion) throw new VersionConflictError(a.id, a.expectedVersion, current.version);
      if (current.status === 'emitido') throw new IssuedImmutableError(a.id); // G-025
      const pend = [...approvalRequests.values()].find((r) => r.proposalId === a.id && r.status === 'pending') ?? null;
      if (pend && !a.material) throw new ApprovalConflictError('approval_pending'); // G-023: nada muda sob análise do Gestor
      const reason = `mudança material ${a.edit === 'commercial' ? 'comercial' : 'técnica'} após a solicitação`;
      const affected = a.material ? new Set<string>(kindsInvalidatedBy(a.edit)) : new Set<string>();
      const toInvalidate = a.material
        ? [...approvalRequests.values()].filter((r) => r.proposalId === a.id && ((r.status === 'pending') || (r.status === 'approved' && affected.has(r.kind))))
        : [];
      const target = a.material ? statusAfterMaterialEdit(current.status, pend ? pend.previousState : null, a.edit) : null;
      const ts = now();
      const next: Proposal = {
        ...current,
        ...(target ? { status: target } : {}),
        ...(a.patch.commercial ? { commercial: a.patch.commercial } : {}),
        ...(a.patch.technical !== undefined ? { technical: a.patch.technical } : {}),
        version: current.version + 1,
        updatedAt: ts,
      };
      proposals.set(a.id, next);
      appendAudit(a.id, {
        actorEmail: a.actor.email, role: a.actor.role, action: a.action,
        ...(target ? { fromState: current.status, toState: target, note: `aprovação invalidada por mudança material ${a.edit === 'commercial' ? 'comercial' : 'técnica'}` } : {}),
      });
      const out: ApprovalRequest[] = [];
      for (const r of toInvalidate) {
        const inv: ApprovalRequest = { ...r, status: 'invalidated', invalidatedAt: ts, invalidatedReason: reason };
        approvalRequests.set(r.id, inv);
        appendAudit(a.id, { actorEmail: a.actor.email, role: a.actor.role, action: `approval_request.invalidated.${r.kind}`, note: reason });
        out.push(inv);
      }
      return { proposal: next, invalidated: out, stateInvalidated: target !== null };
    },

    async reassignOwner(id, toOwner, actorEmail) {
      const current = proposals.get(id);
      if (!current) throw new NotFoundError(id);
      const ts = now();
      const next: Proposal = { ...current, ownerEmail: toOwner, version: current.version + 1, updatedAt: ts };
      // G-024: a versão referenciada pela solicitação PENDENTE acompanha o bump da reatribuição (dono não é mudança material).
      for (const r of approvalRequests.values()) if (r.proposalId === id && r.status === 'pending') approvalRequests.set(r.id, { ...r, proposalVersion: r.proposalVersion + 1 });
      const entry: OwnerAuditEntry = { id: randomUUID(), proposalId: id, actorEmail, fromOwner: current.ownerEmail, toOwner, at: ts };
      proposals.set(id, next);
      ownerLog.push(entry);
      return { proposal: next, audit: entry };
    },

    async ownerAudit(proposalId: string): Promise<readonly OwnerAuditEntry[]> {
      return ownerLog.filter((e) => e.proposalId === proposalId);
    },

    async audit(id: string): Promise<readonly AuditEntry[]> {
      return [...(audits.get(id) ?? [])];
    },

    async appendAuditEntry(proposalId, entry): Promise<void> {
      if (!proposals.has(proposalId)) throw new NotFoundError(proposalId);
      appendAudit(proposalId, entry);
    },

    async recordApprovalDecision(proposalId, kind, decision, entry) {
      if (!proposals.has(proposalId)) throw new NotFoundError(proposalId);
      // corpo síncrono (sem await entre check e set) ⇒ atômico no event loop
      const key = `${proposalId}|${kind}`;
      const existing = approvals.get(key);
      if (existing) return { created: false, decision: existing };
      approvals.set(key, decision);
      appendAudit(proposalId, { ...entry, action: `approval.${decision}.${kind}` });
      return { created: true, decision };
    },

    // ── G-006 (corpos síncronos ⇒ atômicos no event loop; mesmo contrato do SQLite) ──
    async createApprovalRequest(a) {
      const cur = proposals.get(a.proposalId);
      if (!cur) throw new NotFoundError(a.proposalId);
      if (a.requireOwner !== undefined && !ownerMatches(cur.ownerEmail, a.requireOwner)) throw new NotFoundError(a.proposalId);
      if (cur.version !== a.expectedVersion) throw new VersionConflictError(a.proposalId, a.expectedVersion, cur.version);
      if (cur.status !== a.fromState) throw new ApprovalConflictError('invalid_state');
      if ([...approvalRequests.values()].some((r) => r.proposalId === a.proposalId && r.status === 'pending')) throw new ApprovalConflictError('pending_exists');
      const ts = now();
      const request: ApprovalRequest = {
        id: randomUUID(), proposalId: a.proposalId, kind: a.kind, status: 'pending', requestedBy: a.requestedBy,
        requestedByRole: a.requestedByRole, justification: a.justification, proposalVersion: cur.version, previousState: cur.status, createdAt: ts,
      };
      const next: Proposal = { ...cur, status: 'aguardando_aprovacao_gestor', version: cur.version + 1, updatedAt: ts };
      approvalRequests.set(request.id, request);
      proposals.set(next.id, next);
      appendAudit(next.id, { actorEmail: a.requestedBy, role: a.requestedByRole, action: `approval_request.requested.${a.kind}`, fromState: cur.status, toState: next.status, note: a.justification });
      return { request, proposal: next };
    },

    async getApprovalRequest(id) {
      return approvalRequests.get(id) ?? null;
    },

    async listApprovalRequests(filter) {
      return [...approvalRequests.values()]
        .filter((r) => (!filter?.status || r.status === filter.status) && (!filter?.proposalId || r.proposalId === filter.proposalId))
        .sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : 0));
    },

    async decideApprovalRequest(id, decision, decider, justification) {
      const r = approvalRequests.get(id);
      if (!r) throw new NotFoundError(id);
      const cur = proposals.get(r.proposalId);
      if (!cur) throw new NotFoundError(r.proposalId);
      if (r.status !== 'pending') return { created: false, request: r, proposal: cur };
      // G-024: pré-condição de estado DENTRO da operação atômica — proposta ainda em espera e na versão referenciada (+1 da entrada em espera).
      if (cur.status !== 'aguardando_aprovacao_gestor' || cur.version !== r.proposalVersion + 1) throw new ApprovalConflictError('stale');
      const ts = now();
      const next: Proposal = { ...cur, status: r.previousState, version: cur.version + 1, updatedAt: ts };
      const decided: ApprovalRequest = { ...r, status: decision, decidedBy: decider.email, decidedAt: ts, decisionJustification: justification, decidedProposalVersion: next.version };
      approvalRequests.set(id, decided);
      proposals.set(next.id, next);
      appendAudit(next.id, { actorEmail: decider.email, role: decider.role, action: `approval_request.${decision}.${r.kind}`, fromState: cur.status, toState: next.status, ...(justification ? { note: justification } : {}) });
      return { created: true, request: decided, proposal: next };
    },

    async invalidateApprovals(proposalId, kinds, actor, reason) {
      const out: ApprovalRequest[] = [];
      for (const r of [...approvalRequests.values()]) {
        if (r.proposalId !== proposalId || !kinds.includes(r.kind) || (r.status !== 'pending' && r.status !== 'approved')) continue;
        const inv: ApprovalRequest = { ...r, status: 'invalidated', invalidatedAt: now(), invalidatedReason: reason };
        approvalRequests.set(r.id, inv);
        appendAudit(proposalId, { actorEmail: actor.email, role: actor.role, action: `approval_request.invalidated.${r.kind}`, note: reason });
        out.push(inv);
      }
      return out;
    },

    async appendSlaEvent(event: Omit<SlaEventRow, 'id'>): Promise<void> {
      const row: SlaEventRow = { ...event, id: randomUUID() };
      const list = slaByProposal.get(event.proposalId) ?? [];
      list.push(row);
      slaByProposal.set(event.proposalId, list);
    },

    async slaEvents(proposalId: string): Promise<readonly SlaEventRow[]> {
      return [...(slaByProposal.get(proposalId) ?? [])].sort((a, b) => a.at - b.at);
    },

    async allSlaEvents(): Promise<readonly SlaEventRow[]> {
      return [...slaByProposal.values()].flat().sort((a, b) => a.at - b.at);
    },

    async getAssignment(email: string): Promise<RoleAssignment | null> {
      return assignments.get(email.toLowerCase()) ?? null;
    },

    async listAssignments(): Promise<readonly RoleAssignment[]> {
      return [...assignments.values()].sort((a, b) => a.email.localeCompare(b.email));
    },

    async setAssignment(email, role, actorEmail): Promise<AssignmentAuditEntry> {
      const key = email.toLowerCase();
      const prev = assignments.get(key) ?? null;
      if (prev?.role === 'admin' && role !== 'admin') {
        const admins = [...assignments.values()].filter((a) => a.role === 'admin').length;
        if (admins <= 1) throw new LastAdminError();
      }
      const ts = now();
      if (role === null) assignments.delete(key);
      else assignments.set(key, { email: key, role, assignedBy: actorEmail, assignedAt: ts });
      const entry: AssignmentAuditEntry = {
        id: randomUUID(),
        targetEmail: key,
        actorEmail,
        fromRole: prev?.role ?? null,
        toRole: role,
        at: ts,
      };
      assignmentLog.push(entry);
      return entry;
    },

    async assignmentAudit(): Promise<readonly AssignmentAuditEntry[]> {
      return [...assignmentLog];
    },

    async createMeeting(args): Promise<MeetingRecord> {
      const ts = now();
      const rec: MeetingRecord = {
        id: randomUUID(),
        proposalId: args.proposalId,
        state: 'solicitada',
        objective: args.objective,
        ...(args.scheduledFor ? { scheduledFor: args.scheduledFor } : {}),
        log: [{ at: Date.now(), by: args.by, transition: 'solicitada', toState: 'solicitada' }],
        createdAt: ts,
        updatedAt: ts,
      };
      meetings.set(rec.id, rec);
      return rec;
    },

    async meetings(proposalId: string): Promise<readonly MeetingRecord[]> {
      return [...meetings.values()].filter((m) => m.proposalId === proposalId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },

    async updateMeeting(meetingId, patch): Promise<MeetingRecord> {
      const current = meetings.get(meetingId);
      if (!current) throw new NotFoundError(meetingId);
      const next: MeetingRecord = {
        ...current,
        state: patch.state,
        ...(patch.scheduledFor !== undefined ? { scheduledFor: patch.scheduledFor } : {}),
        log: [...current.log, patch.logEntry],
        updatedAt: now(),
      };
      meetings.set(meetingId, next);
      return next;
    },
  };
}
