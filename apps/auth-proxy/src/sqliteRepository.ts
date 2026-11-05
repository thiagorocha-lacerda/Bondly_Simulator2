/**
 * Implementação SQLite do ProposalRepository (contrato em domain.ts), via `node:sqlite` (nativo do
 * Node 22+, sem dependência nativa extra). Persiste em DATA_DIR/bondly.db — na Render, um Disk montado.
 *
 * Mesmo contrato do memoryRepository: lock otimista (version) e auditoria append-only na MESMA
 * operação. Trocar por Postgres depois é reimplementar esta interface, sem tocar api.ts/server.ts.
 *
 * Nota: `node:sqlite` é experimental no Node 22 (emite ExperimentalWarning). Importado dinamicamente
 * para não quebrar ambientes sem ele — o factory (createRepository) cai para in-memory se faltar.
 */
import { isProductionEnv } from './envMode.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  type Proposal,
  type ProposalRepository,
  type CreateProposalArgs,
  type AuditEntry,
  type SlaEventRow,
  type MeetingRecord,
  type MeetingLogEntry,
  type WorkflowState,
  type RoleAssignment,
  type AssignmentAuditEntry,
  type OwnerAuditEntry,
  type ApprovalRequest,
  type ApprovalKind,
  type ApprovalRequestStatus,
  ApprovalConflictError,
  IssuedImmutableError,
  VersionConflictError,
  NotFoundError,
  LastAdminError,
} from './domain.js';
import { isRole, type Role } from './rbac.js';
import { ownerMatches } from './scope.js';
import { statusAfterMaterialEdit, kindsInvalidatedBy } from './workflow.js';

// Tipagem mínima do subconjunto de node:sqlite que usamos (evita depender de @types instáveis).
interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

function rowToProposal(r: Record<string, unknown>): Proposal {
  return {
    id: String(r.id),
    version: Number(r.version),
    status: String(r.status) as WorkflowState,
    ownerEmail: String(r.owner_email),
    commercial: JSON.parse(String(r.commercial ?? '{}')),
    ...(r.technical != null ? { technical: JSON.parse(String(r.technical)) } : {}),
    ...(r.snapshot != null ? { snapshot: JSON.parse(String(r.snapshot)) } : {}),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToApproval(r: Record<string, unknown>): ApprovalRequest {
  return {
    id: String(r.id),
    proposalId: String(r.proposal_id),
    kind: String(r.kind) as ApprovalKind,
    status: String(r.status) as ApprovalRequestStatus,
    requestedBy: String(r.requested_by),
    requestedByRole: String(r.requested_by_role) as Role,
    justification: String(r.justification),
    proposalVersion: Number(r.proposal_version),
    previousState: String(r.previous_state) as WorkflowState,
    createdAt: String(r.created_at),
    ...(r.decided_by != null ? { decidedBy: String(r.decided_by) } : {}),
    ...(r.decided_at != null ? { decidedAt: String(r.decided_at) } : {}),
    ...(r.decision_justification != null ? { decisionJustification: String(r.decision_justification) } : {}),
    ...(r.decided_proposal_version != null ? { decidedProposalVersion: Number(r.decided_proposal_version) } : {}),
    ...(r.invalidated_at != null ? { invalidatedAt: String(r.invalidated_at) } : {}),
    ...(r.invalidated_reason != null ? { invalidatedReason: String(r.invalidated_reason) } : {}),
  };
}

function rowToMeeting(r: Record<string, unknown>): MeetingRecord {
  return {
    id: String(r.id),
    proposalId: String(r.proposal_id),
    state: String(r.state),
    objective: String(r.objective),
    ...(r.scheduled_for != null ? { scheduledFor: String(r.scheduled_for) } : {}),
    log: JSON.parse(String(r.log ?? '[]')) as MeetingLogEntry[],
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToAssignment(r: Record<string, unknown>): RoleAssignment {
  return { email: String(r.email), role: r.role as Role, assignedBy: String(r.assigned_by), assignedAt: String(r.assigned_at) };
}

/** G-029: contenção persistente de lock no SQLite (após busy_timeout + retries) ⇒ API responde 503 claro. */
export class StorageBusyError extends Error {
  constructor() {
    super('storage_busy');
    this.name = 'StorageBusyError';
  }
}
const isBusy = (e: unknown): boolean => /database is locked|SQLITE_BUSY|database table is locked/i.test((e as Error)?.message ?? '');

/**
 * G-029: envolve cada método do repositório com retry LIMITADO (o `busy_timeout` já espera dentro do SQLite). Os métodos
 * transacionais fazem ROLLBACK antes de relançar ⇒ repetir é seguro. Persistindo ⇒ StorageBusyError (503).
 * NOTA: SQLite continua recomendado só com INSTÂNCIA ÚNICA (disco do Render); isto é mitigação, não multi-writer.
 */
function withBusyRetry(repo: ProposalRepository, retries: number): ProposalRepository {
  const out: Record<string, unknown> = {};
  for (const [k, fn] of Object.entries(repo as unknown as Record<string, unknown>)) {
    if (typeof fn !== 'function') { out[k] = fn; continue; }
    out[k] = async (...args: unknown[]) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
        } catch (e) {
          if (!isBusy(e)) throw e;
          if (attempt >= retries) throw new StorageBusyError();
          await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
        }
      }
    };
  }
  return out as unknown as ProposalRepository;
}

export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export async function createSqliteRepository(
  dataDir: string,
  now: () => string = () => new Date().toISOString(),
  opts: { busyTimeoutMs?: number; busyRetries?: number } = {},
): Promise<ProposalRepository> {
  // `node:sqlite` é builtin novo (Node 22+). Carregamos via createRequire para escapar da
  // transformação ESM do Vite/Vitest (que reescreve o especificador 'node:sqlite' e falha ao
  // resolvê-lo). Em runtime de produção (node dist/server.js) isto é um require nativo direto.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url) as (id: string) => unknown;
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => SqliteDb;
  };
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'bondly.db'));
  // G-029: espera por lock em vez de falhar na hora; G-028: recursive_triggers=ON faz o DELETE implícito do REPLACE disparar os triggers.
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS))}; PRAGMA recursive_triggers = ON;`);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      commercial TEXT NOT NULL,
      technical TEXT,
      snapshot TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT,
      note TEXT,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seq (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
    INSERT OR IGNORE INTO seq (k, v) VALUES ('proposal', 0);
    CREATE TABLE IF NOT EXISTS sla_events (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      at INTEGER NOT NULL,
      by_email TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sla_events_proposal ON sla_events (proposal_id, at);
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      state TEXT NOT NULL,
      objective TEXT NOT NULL,
      scheduled_for TEXT,
      log TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meetings_proposal ON meetings (proposal_id, created_at);
    CREATE TABLE IF NOT EXISTS role_assignments (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      assigned_by TEXT NOT NULL,
      assigned_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assignment_audit (
      id TEXT PRIMARY KEY,
      target_email TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      from_role TEXT,
      to_role TEXT,
      at TEXT NOT NULL
    );
    -- G-018: decisão do approver única por (proposta, kind) — atômica por constraint (migração aditiva).
    CREATE TABLE IF NOT EXISTS approval_decisions (
      proposal_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      decision TEXT NOT NULL,
      PRIMARY KEY (proposal_id, kind)
    );
    -- G-002: auditoria de reatribuição de dono, append-only ENFORÇADA pelo banco (aditiva, idempotente).
    CREATE TABLE IF NOT EXISTS owner_audit (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      from_owner TEXT NOT NULL,
      to_owner TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_owner_audit_proposal ON owner_audit (proposal_id, at);
    CREATE TRIGGER IF NOT EXISTS owner_audit_no_update BEFORE UPDATE ON owner_audit
      BEGIN SELECT RAISE(ABORT, 'owner_audit é append-only'); END;
    CREATE TRIGGER IF NOT EXISTS owner_audit_no_delete BEFORE DELETE ON owner_audit
      BEGIN SELECT RAISE(ABORT, 'owner_audit é append-only'); END;
    -- G-006: solicitações ao Gestor/Aprovador. Aditiva/idempotente. Uma decisão por solicitação (UPDATE condicional
    -- WHERE status='pending'), no máximo UMA pendente por proposta (índice único parcial), linhas decididas imutáveis.
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('excecao_comercial','alteracao_escopo','replanejamento_sla')),
      status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','invalidated')),
      requested_by TEXT NOT NULL,
      requested_by_role TEXT NOT NULL,
      justification TEXT NOT NULL,
      proposal_version INTEGER NOT NULL,
      previous_state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_by TEXT,
      decided_at TEXT,
      decision_justification TEXT,
      decided_proposal_version INTEGER,
      invalidated_at TEXT,
      invalidated_reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_approval_pending ON approval_requests (proposal_id) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests (status, created_at);
    CREATE TRIGGER IF NOT EXISTS approval_requests_no_delete BEFORE DELETE ON approval_requests
      BEGIN SELECT RAISE(ABORT, 'approval_requests é append-only'); END;
    CREATE TRIGGER IF NOT EXISTS approval_requests_immutable BEFORE UPDATE ON approval_requests
      WHEN OLD.status <> 'pending' AND NOT (OLD.status = 'approved' AND NEW.status = 'invalidated')
      BEGIN SELECT RAISE(ABORT, 'approval_requests decididas são imutáveis'); END;
    -- G-007: trilha de atribuições append-only ENFORÇADA pelo banco (migração aditiva, idempotente).
    CREATE TRIGGER IF NOT EXISTS assignment_audit_no_update BEFORE UPDATE ON assignment_audit
      BEGIN SELECT RAISE(ABORT, 'assignment_audit é append-only'); END;
    CREATE TRIGGER IF NOT EXISTS assignment_audit_no_delete BEFORE DELETE ON assignment_audit
      BEGIN SELECT RAISE(ABORT, 'assignment_audit é append-only'); END;
    -- G-028 (migração aditiva): audit principal append-only + INSERT OR REPLACE inócuo (BEFORE INSERT aborta se a chave existe).
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
      BEGIN SELECT RAISE(ABORT, 'audit é append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
      BEGIN SELECT RAISE(ABORT, 'audit é append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_replace BEFORE INSERT ON audit WHEN EXISTS (SELECT 1 FROM audit WHERE id = NEW.id)
      BEGIN SELECT RAISE(ABORT, 'audit é append-only (replace)'); END;
    CREATE TRIGGER IF NOT EXISTS owner_audit_no_replace BEFORE INSERT ON owner_audit WHEN EXISTS (SELECT 1 FROM owner_audit WHERE id = NEW.id)
      BEGIN SELECT RAISE(ABORT, 'owner_audit é append-only (replace)'); END;
    CREATE TRIGGER IF NOT EXISTS assignment_audit_no_replace BEFORE INSERT ON assignment_audit WHEN EXISTS (SELECT 1 FROM assignment_audit WHERE id = NEW.id)
      BEGIN SELECT RAISE(ABORT, 'assignment_audit é append-only (replace)'); END;
    CREATE TRIGGER IF NOT EXISTS approval_requests_no_replace BEFORE INSERT ON approval_requests WHEN EXISTS (SELECT 1 FROM approval_requests WHERE id = NEW.id)
      BEGIN SELECT RAISE(ABORT, 'approval_requests é append-only (replace)'); END;
    -- G-031 (migração aditiva, idempotente): approval_decisions é imutável por decisão (uma por proposta,kind).
    -- O INSERT legítimo usa ON CONFLICT(proposal_id,kind) DO NOTHING (não dispara DELETE ⇒ passa). Um
    -- INSERT OR REPLACE, porém, com recursive_triggers=ON dispara o BEFORE DELETE implícito e ABORTA — logo
    -- NÃO há trigger BEFORE INSERT WHEN EXISTS aqui (ela quebraria o DO NOTHING idempotente). UPDATE/DELETE abortam.
    CREATE TRIGGER IF NOT EXISTS approval_decisions_no_update BEFORE UPDATE ON approval_decisions
      BEGIN SELECT RAISE(ABORT, 'approval_decisions é imutável'); END;
    CREATE TRIGGER IF NOT EXISTS approval_decisions_no_delete BEFORE DELETE ON approval_decisions
      BEGIN SELECT RAISE(ABORT, 'approval_decisions é imutável'); END;
    -- G-031 (migração aditiva, idempotente): sla_events é append-only (INSERT puro com id PK). no_update +
    -- no_delete + no_replace (BEFORE INSERT WHEN EXISTS no id), idêntico ao padrão provado de audit/owner_audit.
    CREATE TRIGGER IF NOT EXISTS sla_events_no_update BEFORE UPDATE ON sla_events
      BEGIN SELECT RAISE(ABORT, 'sla_events é append-only'); END;
    CREATE TRIGGER IF NOT EXISTS sla_events_no_delete BEFORE DELETE ON sla_events
      BEGIN SELECT RAISE(ABORT, 'sla_events é append-only'); END;
    CREATE TRIGGER IF NOT EXISTS sla_events_no_replace BEFORE INSERT ON sla_events WHEN EXISTS (SELECT 1 FROM sla_events WHERE id = NEW.id)
      BEGIN SELECT RAISE(ABORT, 'sla_events é append-only (replace)'); END;
  `);

  // G-002 (migração aditiva): bancos MUITO antigos sem owner_email ganham a coluna vazia (⇒ só admin enxerga).
  const cols = db.prepare(`PRAGMA table_info(proposals)`).all();
  if (!cols.some((c) => c.name === 'owner_email')) {
    db.exec(`ALTER TABLE proposals ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''`);
  }

  function appendAudit(a: Omit<AuditEntry, 'id' | 'at'>): void {
    db.prepare(
      `INSERT INTO audit (id, proposal_id, actor_email, role, action, from_state, to_state, note, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), a.proposalId, a.actorEmail, a.role, a.action, a.fromState ?? null, a.toState ?? null, a.note ?? null, now());
  }

  const repo: ProposalRepository = {
    async nextSequence(): Promise<number> {
      db.prepare(`UPDATE seq SET v = v + 1 WHERE k = 'proposal'`).run();
      const row = db.prepare(`SELECT v FROM seq WHERE k = 'proposal'`).get();
      return Number(row?.v ?? 0);
    },

    async create(args: CreateProposalArgs, audit): Promise<Proposal> {
      const existing = db.prepare(`SELECT id FROM proposals WHERE id = ?`).get(args.id);
      if (existing) throw new Error(`proposta já existe: ${args.id}`);
      const ts = now();
      db.prepare(
        `INSERT INTO proposals (id, version, status, owner_email, commercial, technical, snapshot, created_at, updated_at)
         VALUES (?, 1, 'rascunho_comercial', ?, ?, NULL, NULL, ?, ?)`,
      ).run(args.id, args.ownerEmail, JSON.stringify(args.commercial), ts, ts);
      appendAudit({ ...audit, proposalId: args.id });
      return rowToProposal(db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(args.id)!);
    },

    async get(id: string): Promise<Proposal | null> {
      const r = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(id);
      return r ? rowToProposal(r) : null;
    },

    async list(): Promise<readonly Proposal[]> {
      return db.prepare(`SELECT * FROM proposals ORDER BY id DESC`).all().map(rowToProposal);
    },

    async update(id, expectedVersion, patch, audit, opts): Promise<Proposal> {
      const current = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(id);
      if (!current) throw new NotFoundError(id);
      if (opts?.requireOwner !== undefined && !ownerMatches(String(current.owner_email ?? ''), opts.requireOwner)) throw new NotFoundError(id);
      const curVersion = Number(current.version);
      if (curVersion !== expectedVersion) throw new VersionConflictError(id, expectedVersion, curVersion);
      const next = {
        status: patch.status ?? String(current.status),
        commercial: 'commercial' in patch && patch.commercial ? JSON.stringify(patch.commercial) : String(current.commercial),
        technical: 'technical' in patch && patch.technical !== undefined ? JSON.stringify(patch.technical) : (current.technical as string | null),
        snapshot: 'snapshot' in patch && patch.snapshot !== undefined ? JSON.stringify(patch.snapshot) : (current.snapshot as string | null),
      };
      // UPDATE guardado por versão (lock otimista no próprio SQL — defende contra corrida)
      const res = db
        .prepare(
          `UPDATE proposals SET version = version + 1, status = ?, commercial = ?, technical = ?, snapshot = ?, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(next.status, next.commercial, next.technical, next.snapshot, now(), id, expectedVersion);
      if (Number(res.changes) === 0) {
        const actual = Number(db.prepare(`SELECT version FROM proposals WHERE id = ?`).get(id)?.version ?? -1);
        throw new VersionConflictError(id, expectedVersion, actual);
      }
      appendAudit({ ...audit, proposalId: id });
      return rowToProposal(db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(id)!);
    },

    async editProposal(a) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const cur = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(a.id);
        if (!cur) throw new NotFoundError(a.id);
        if (a.requireOwner !== undefined && !ownerMatches(String(cur.owner_email ?? ''), a.requireOwner)) throw new NotFoundError(a.id);
        const curVersion = Number(cur.version);
        if (curVersion !== a.expectedVersion) throw new VersionConflictError(a.id, a.expectedVersion, curVersion);
        if (String(cur.status) === 'emitido') throw new IssuedImmutableError(a.id); // G-025
        const pend = db.prepare(`SELECT * FROM approval_requests WHERE proposal_id = ? AND status = 'pending'`).get(a.id);
        if (pend && !a.material) throw new ApprovalConflictError('approval_pending'); // G-023
        const reason = `mudança material ${a.edit === 'commercial' ? 'comercial' : 'técnica'} após a solicitação`;
        const affected = new Set<string>(kindsInvalidatedBy(a.edit));
        const toInvalidate = a.material
          ? db.prepare(`SELECT * FROM approval_requests WHERE proposal_id = ? AND status IN ('pending','approved')`).all(a.id)
              .filter((r) => String(r.status) === 'pending' || affected.has(String(r.kind)))
          : [];
        const target = a.material ? statusAfterMaterialEdit(String(cur.status) as WorkflowState, pend ? (String(pend.previous_state) as WorkflowState) : null, a.edit) : null;
        const ts = now();
        const res = db.prepare(
          `UPDATE proposals SET version = version + 1, status = ?, commercial = ?, technical = ?, updated_at = ? WHERE id = ? AND version = ?`,
        ).run(
          target ?? String(cur.status),
          a.patch.commercial ? JSON.stringify(a.patch.commercial) : String(cur.commercial),
          a.patch.technical !== undefined ? JSON.stringify(a.patch.technical) : (cur.technical as string | null),
          ts, a.id, a.expectedVersion,
        );
        if (Number(res.changes) === 0) throw new VersionConflictError(a.id, a.expectedVersion, curVersion);
        appendAudit({
          proposalId: a.id, actorEmail: a.actor.email, role: a.actor.role, action: a.action,
          ...(target ? { fromState: String(cur.status) as WorkflowState, toState: target, note: `aprovação invalidada por mudança material ${a.edit === 'commercial' ? 'comercial' : 'técnica'}` } : {}),
        });
        for (const r of toInvalidate) {
          db.prepare(`UPDATE approval_requests SET status = 'invalidated', invalidated_at = ?, invalidated_reason = ? WHERE id = ?`).run(ts, reason, String(r.id));
          appendAudit({ proposalId: a.id, actorEmail: a.actor.email, role: a.actor.role, action: `approval_request.invalidated.${String(r.kind)}`, note: reason });
        }
        db.exec('COMMIT');
        return {
          proposal: rowToProposal(db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(a.id)!),
          invalidated: toInvalidate.map((r) => rowToApproval(db.prepare(`SELECT * FROM approval_requests WHERE id = ?`).get(String(r.id))!)),
          stateInvalidated: target !== null,
        };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    async reassignOwner(id, toOwner, actorEmail) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const cur = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(id);
        if (!cur) throw new NotFoundError(id);
        const ts = now();
        const entry: OwnerAuditEntry = {
          id: randomUUID(),
          proposalId: id,
          actorEmail,
          fromOwner: String(cur.owner_email ?? ''),
          toOwner,
          at: ts,
        };
        db.prepare(`UPDATE proposals SET owner_email = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(toOwner, ts, id);
        // G-024: a versão referenciada pela solicitação PENDENTE acompanha o bump (dono não é mudança material).
        db.prepare(`UPDATE approval_requests SET proposal_version = proposal_version + 1 WHERE proposal_id = ? AND status = 'pending'`).run(id);
        db.prepare(`INSERT INTO owner_audit (id, proposal_id, actor_email, from_owner, to_owner, at) VALUES (?, ?, ?, ?, ?, ?)`).run(
          entry.id, id, actorEmail, entry.fromOwner, toOwner, ts,
        );
        db.exec('COMMIT');
        return { proposal: rowToProposal(db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(id)!), audit: entry };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    async ownerAudit(proposalId: string): Promise<readonly OwnerAuditEntry[]> {
      return db
        .prepare(`SELECT * FROM owner_audit WHERE proposal_id = ? ORDER BY at ASC, rowid ASC`)
        .all(proposalId)
        .map((r) => ({
          id: String(r.id),
          proposalId: String(r.proposal_id),
          actorEmail: String(r.actor_email),
          fromOwner: String(r.from_owner),
          toOwner: String(r.to_owner),
          at: String(r.at),
        }));
    },

    async audit(id: string): Promise<readonly AuditEntry[]> {
      return db
        .prepare(`SELECT * FROM audit WHERE proposal_id = ? ORDER BY at ASC`)
        .all(id)
        .map((r) => ({
          id: String(r.id),
          proposalId: String(r.proposal_id),
          actorEmail: String(r.actor_email),
          role: String(r.role) as AuditEntry['role'],
          action: String(r.action),
          ...(r.from_state != null ? { fromState: String(r.from_state) as WorkflowState } : {}),
          ...(r.to_state != null ? { toState: String(r.to_state) as WorkflowState } : {}),
          ...(r.note != null ? { note: String(r.note) } : {}),
          at: String(r.at),
        }));
    },

    async appendAuditEntry(proposalId, entry): Promise<void> {
      if (!db.prepare(`SELECT id FROM proposals WHERE id = ?`).get(proposalId)) throw new NotFoundError(proposalId);
      appendAudit({ ...entry, proposalId });
    },

    async recordApprovalDecision(proposalId, kind, decision, entry) {
      if (!db.prepare(`SELECT id FROM proposals WHERE id = ?`).get(proposalId)) throw new NotFoundError(proposalId);
      db.exec('BEGIN IMMEDIATE');
      try {
        // Legado: decisões gravadas só na auditoria (pré-G-018) são promovidas à tabela antes do INSERT.
        const legacy = db
          .prepare(`SELECT action FROM audit WHERE proposal_id = ? AND action LIKE 'approval.%.' || ? ORDER BY at ASC, rowid ASC LIMIT 1`)
          .get(proposalId, kind);
        if (legacy) {
          const d = String(legacy.action).split('.')[1];
          if (d === 'approved' || d === 'rejected') {
            db.prepare(`INSERT INTO approval_decisions (proposal_id, kind, decision) VALUES (?, ?, ?) ON CONFLICT(proposal_id, kind) DO NOTHING`).run(proposalId, kind, d);
          }
        }
        const r = db
          .prepare(`INSERT INTO approval_decisions (proposal_id, kind, decision) VALUES (?, ?, ?) ON CONFLICT(proposal_id, kind) DO NOTHING`)
          .run(proposalId, kind, decision);
        const created = Number(r.changes) === 1;
        if (created) appendAudit({ ...entry, proposalId, action: `approval.${decision}.${kind}` });
        const winner = String(
          db.prepare(`SELECT decision FROM approval_decisions WHERE proposal_id = ? AND kind = ?`).get(proposalId, kind)?.decision,
        ) as 'approved' | 'rejected';
        db.exec('COMMIT');
        return { created, decision: winner };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    // ── G-006: tudo em BEGIN IMMEDIATE (solicitação/decisão + estado + auditoria na MESMA transação) ──
    async createApprovalRequest(a) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const cur = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(a.proposalId);
        if (!cur) throw new NotFoundError(a.proposalId);
        if (a.requireOwner !== undefined && !ownerMatches(String(cur.owner_email ?? ''), a.requireOwner)) throw new NotFoundError(a.proposalId);
        const curVersion = Number(cur.version);
        if (curVersion !== a.expectedVersion) throw new VersionConflictError(a.proposalId, a.expectedVersion, curVersion);
        if (String(cur.status) !== a.fromState) throw new ApprovalConflictError('invalid_state');
        if (db.prepare(`SELECT id FROM approval_requests WHERE proposal_id = ? AND status = 'pending'`).get(a.proposalId)) throw new ApprovalConflictError('pending_exists');
        const ts = now();
        const id = randomUUID();
        db.prepare(
          `INSERT INTO approval_requests (id, proposal_id, kind, status, requested_by, requested_by_role, justification, proposal_version, previous_state, created_at)
           VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        ).run(id, a.proposalId, a.kind, a.requestedBy, a.requestedByRole, a.justification, curVersion, String(cur.status), ts);
        db.prepare(`UPDATE proposals SET status = 'aguardando_aprovacao_gestor', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`).run(ts, a.proposalId, curVersion);
        appendAudit({ proposalId: a.proposalId, actorEmail: a.requestedBy, role: a.requestedByRole, action: `approval_request.requested.${a.kind}`, fromState: String(cur.status) as WorkflowState, toState: 'aguardando_aprovacao_gestor', note: a.justification });
        db.exec('COMMIT');
        return { request: rowToApproval(db.prepare(`SELECT * FROM approval_requests WHERE id = ?`).get(id)!), proposal: rowToProposal(db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(a.proposalId)!) };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    async getApprovalRequest(id) {
      const r = db.prepare(`SELECT * FROM approval_requests WHERE id = ?`).get(id);
      return r ? rowToApproval(r) : null;
    },

    async listApprovalRequests(filter) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter?.status) { where.push('status = ?'); params.push(filter.status); }
      if (filter?.proposalId) { where.push('proposal_id = ?'); params.push(filter.proposalId); }
      return db
        .prepare(`SELECT * FROM approval_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at ASC, rowid ASC`)
        .all(...params)
        .map(rowToApproval);
    },

    async decideApprovalRequest(id, decision, decider, justification) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = db.prepare(`SELECT * FROM approval_requests WHERE id = ?`).get(id);
        if (!r) throw new NotFoundError(id);
        const cur = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(String(r.proposal_id));
        if (!cur) throw new NotFoundError(String(r.proposal_id));
        // G-024: pré-condição DENTRO da transação — solicitação ainda pendente ⇒ proposta em espera e na versão referenciada (+1).
        if (String(r.status) === 'pending' && (String(cur.status) !== 'aguardando_aprovacao_gestor' || Number(cur.version) !== Number(r.proposal_version) + 1)) {
          throw new ApprovalConflictError('stale');
        }
        const ts = now();
        // UPDATE condicional: só UMA decisão por solicitação (idempotência/atomicidade herdadas de G-018).
        const upd = db
          .prepare(
            `UPDATE approval_requests SET status = ?, decided_by = ?, decided_at = ?, decision_justification = ?, decided_proposal_version = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(decision, decider.email, ts, justification || null, Number(cur.version) + 1, id);
        const created = Number(upd.changes) === 1;
        if (created) {
          db.prepare(`UPDATE proposals SET status = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(String(r.previous_state), ts, String(r.proposal_id));
          appendAudit({ proposalId: String(r.proposal_id), actorEmail: decider.email, role: decider.role, action: `approval_request.${decision}.${String(r.kind)}`, fromState: String(cur.status) as WorkflowState, toState: String(r.previous_state) as WorkflowState, ...(justification ? { note: justification } : {}) });
        }
        db.exec('COMMIT');
        return {
          created,
          request: rowToApproval(db.prepare(`SELECT * FROM approval_requests WHERE id = ?`).get(id)!),
          proposal: rowToProposal(db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(String(r.proposal_id))!),
        };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    async invalidateApprovals(proposalId, kinds, actor, reason) {
      if (kinds.length === 0) return [];
      db.exec('BEGIN IMMEDIATE');
      try {
        const rows = db
          .prepare(`SELECT * FROM approval_requests WHERE proposal_id = ? AND status IN ('pending','approved')`)
          .all(proposalId)
          .filter((r) => (kinds as readonly string[]).includes(String(r.kind)));
        const ts = now();
        for (const r of rows) {
          db.prepare(`UPDATE approval_requests SET status = 'invalidated', invalidated_at = ?, invalidated_reason = ? WHERE id = ?`).run(ts, reason, String(r.id));
          appendAudit({ proposalId, actorEmail: actor.email, role: actor.role, action: `approval_request.invalidated.${String(r.kind)}`, note: reason });
        }
        db.exec('COMMIT');
        return rows.map((r) => rowToApproval(db.prepare(`SELECT * FROM approval_requests WHERE id = ?`).get(String(r.id))!));
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    async appendSlaEvent(event: Omit<SlaEventRow, 'id'>): Promise<void> {
      db.prepare(
        `INSERT INTO sla_events (id, proposal_id, kind, at, by_email, payload) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), event.proposalId, event.kind, event.at, event.by, JSON.stringify(event.payload));
    },

    async slaEvents(proposalId: string): Promise<readonly SlaEventRow[]> {
      return db
        .prepare(`SELECT * FROM sla_events WHERE proposal_id = ? ORDER BY at ASC`)
        .all(proposalId)
        .map((r) => ({
          id: String(r.id),
          proposalId: String(r.proposal_id),
          kind: String(r.kind) as SlaEventRow['kind'],
          at: Number(r.at),
          by: String(r.by_email),
          payload: JSON.parse(String(r.payload ?? '{}')) as Record<string, unknown>,
        }));
    },

    async allSlaEvents(): Promise<readonly SlaEventRow[]> {
      return db
        .prepare(`SELECT * FROM sla_events ORDER BY at ASC`)
        .all()
        .map((r) => ({
          id: String(r.id),
          proposalId: String(r.proposal_id),
          kind: String(r.kind) as SlaEventRow['kind'],
          at: Number(r.at),
          by: String(r.by_email),
          payload: JSON.parse(String(r.payload ?? '{}')) as Record<string, unknown>,
        }));
    },

    async getAssignment(email: string): Promise<RoleAssignment | null> {
      const r = db.prepare(`SELECT * FROM role_assignments WHERE email = ?`).get(email.toLowerCase());
      return r && isRole(r.role) ? rowToAssignment(r) : null;
    },

    async listAssignments(): Promise<readonly RoleAssignment[]> {
      return db
        .prepare(`SELECT * FROM role_assignments ORDER BY email ASC`)
        .all()
        .filter((r) => isRole(r.role))
        .map(rowToAssignment);
    },

    async setAssignment(email, role, actorEmail): Promise<AssignmentAuditEntry> {
      const key = email.toLowerCase();
      const prevRow = db.prepare(`SELECT * FROM role_assignments WHERE email = ?`).get(key);
      const prev: Role | null = prevRow && isRole(prevRow.role) ? prevRow.role : null;
      const ts = now();
      const entry: AssignmentAuditEntry = { id: randomUUID(), targetEmail: key, actorEmail, fromRole: prev, toRole: role, at: ts };
      db.exec('BEGIN IMMEDIATE');
      try {
        if (prev === 'admin' && role !== 'admin') {
          const admins = Number(db.prepare(`SELECT COUNT(*) AS c FROM role_assignments WHERE role = 'admin'`).get()?.c ?? 0);
          if (admins <= 1) throw new LastAdminError();
        }
        if (role === null) db.prepare(`DELETE FROM role_assignments WHERE email = ?`).run(key);
        else
          db.prepare(
            `INSERT INTO role_assignments (email, role, assigned_by, assigned_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(email) DO UPDATE SET role = excluded.role, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at`,
          ).run(key, role, actorEmail, ts);
        db.prepare(
          `INSERT INTO assignment_audit (id, target_email, actor_email, from_role, to_role, at) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(entry.id, key, actorEmail, prev, role, ts);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return entry;
    },

    async assignmentAudit(): Promise<readonly AssignmentAuditEntry[]> {
      return db
        .prepare(`SELECT * FROM assignment_audit ORDER BY at ASC, rowid ASC`)
        .all()
        .map((r) => ({
          id: String(r.id),
          targetEmail: String(r.target_email),
          actorEmail: String(r.actor_email),
          fromRole: r.from_role != null && isRole(r.from_role) ? r.from_role : null,
          toRole: r.to_role != null && isRole(r.to_role) ? r.to_role : null,
          at: String(r.at),
        }));
    },

    async createMeeting(args): Promise<MeetingRecord> {
      const ts = now();
      const id = randomUUID();
      const log: MeetingLogEntry[] = [{ at: Date.now(), by: args.by, transition: 'solicitada', toState: 'solicitada' }];
      db.prepare(
        `INSERT INTO meetings (id, proposal_id, state, objective, scheduled_for, log, created_at, updated_at)
         VALUES (?, ?, 'solicitada', ?, ?, ?, ?, ?)`,
      ).run(id, args.proposalId, args.objective, args.scheduledFor ?? null, JSON.stringify(log), ts, ts);
      return rowToMeeting(db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(id)!);
    },

    async meetings(proposalId: string): Promise<readonly MeetingRecord[]> {
      return db.prepare(`SELECT * FROM meetings WHERE proposal_id = ? ORDER BY created_at ASC`).all(proposalId).map(rowToMeeting);
    },

    async updateMeeting(meetingId, patch): Promise<MeetingRecord> {
      const current = db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId);
      if (!current) throw new NotFoundError(meetingId);
      const log = [...(JSON.parse(String(current.log ?? '[]')) as MeetingLogEntry[]), patch.logEntry];
      const scheduledFor = patch.scheduledFor !== undefined ? patch.scheduledFor : (current.scheduled_for as string | null);
      db.prepare(
        `UPDATE meetings SET state = ?, scheduled_for = ?, log = ?, updated_at = ? WHERE id = ?`,
      ).run(patch.state, scheduledFor ?? null, JSON.stringify(log), now(), meetingId);
      return rowToMeeting(db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId)!);
    },
  };
  return withBusyRetry(repo, opts.busyRetries ?? 2);
}

export class RepositoryUnavailableError extends Error {
  constructor(public readonly code: 'data_dir_missing' | 'sqlite_unavailable', detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'RepositoryUnavailableError';
  }
}

/**
 * Factory de repositório. SQLite quando DATA_DIR está setado E `node:sqlite` disponível.
 *
 * G-003 (fail-closed): em produção (qualquer NODE_ENV fora da allowlist {development,test} — G-013, mesma regra do loadConfig) a
 * ausência de DATA_DIR ou um SQLite inacessível LANÇA RepositoryUnavailableError — o servidor NÃO sobe
 * em memória (perderia atribuições, auditoria e propostas a cada restart). Único escape: opt-in explícito
 * ALLOW_EPHEMERAL_REPO=true (NÃO para produção real; só demo/preview descartável).
 * Fora de produção, mantém o fallback em memória (dev/teste). A mensagem de erro nunca inclui segredos.
 */
export async function createRepository(env: NodeJS.ProcessEnv = process.env): Promise<{
  repo: ProposalRepository;
  backend: 'sqlite' | 'memory';
}> {
  const isProd = isProductionEnv(env); // G-013
  const allowEphemeral = (env.ALLOW_EPHEMERAL_REPO ?? '').trim().toLowerCase() === 'true';
  const dataDir = env.DATA_DIR;
  let failure: RepositoryUnavailableError | null = null;
  if (dataDir) {
    try {
      const repo = await createSqliteRepository(dataDir);
      return { repo, backend: 'sqlite' };
    } catch (e) {
      failure = new RepositoryUnavailableError('sqlite_unavailable', (e as Error).message);
      console.error(JSON.stringify({ evt: 'sqlite_unavailable', msg: (e as Error).message }));
    }
  } else {
    failure = new RepositoryUnavailableError('data_dir_missing');
  }
  if (isProd) {
    if (!allowEphemeral) throw failure;
    console.warn(JSON.stringify({ evt: 'ephemeral_repo_in_production', reason: failure?.code, warning: 'ALLOW_EPHEMERAL_REPO=true: dados serão PERDIDOS no restart; NÃO usar em produção real' }));
  }
  const { createMemoryRepository } = await import('./memoryRepository.js');
  return { repo: createMemoryRepository(), backend: 'memory' };
}
