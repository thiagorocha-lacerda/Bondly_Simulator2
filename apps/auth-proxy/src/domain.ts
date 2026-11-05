/**
 * Domínio de propostas, esteira e auditoria (prompt §5, §8) + contrato de repositório (§1.1 do doc 10).
 *
 * O repositório guarda INPUTS (comercial/técnico), estado, snapshot e histórico — NÃO duplica regra
 * de cálculo (a fonte única é o Pricing Engine, §8). A interface isola o backend: a implementação
 * inicial é in-memory (testes) / SQLite (produção), trocável por Postgres sem tocar as rotas.
 */
import type { Role } from './rbac.js';

/** Estados da esteira Negócios→P&T (§5.2). */
export type WorkflowState =
  | 'rascunho_comercial'
  | 'aguardando_analise_tecnica'
  | 'em_analise_tecnica'
  | 'ajustes_solicitados'
  | 'aprovado_tecnicamente'
  | 'reprovado'
  | 'pronto_para_emissao'
  | 'emitido'
  /** G-006: sub-estado de espera pela decisão do Gestor/Aprovador. NÃO pausa nem reinicia o relógio de SLA. */
  | 'aguardando_aprovacao_gestor';

/**
 * Entradas comerciais (preenchidas por Negócios). Mantidas como JSON opaco do ponto de vista do
 * repositório — o shape canônico é o PricingInput do engine; aqui guardamos o que a proposta carrega.
 */
export type CommercialInput = Record<string, unknown>;

/** Entradas técnicas (preenchidas por P&T): integrações, complexidade, horas, parecer. */
export interface TechnicalInput {
  readonly integrations?: number;
  readonly complexityNote?: string;
  readonly implementationHours?: number;
  readonly risks?: string;
  readonly verdict?: 'aprovado' | 'ajustes' | 'reprovado';
  readonly verdictNote?: string;
}

/** Proposta persistida. `version` é o lock otimista (§5.2). */
export interface Proposal {
  readonly id: string; // BONDLY-2027-NNNNNN
  readonly version: number;
  readonly status: WorkflowState;
  readonly ownerEmail: string;
  readonly commercial: CommercialInput;
  readonly technical?: TechnicalInput;
  /** Snapshot congelado na aprovação técnica (JSON do ProposalSnapshot do engine). */
  readonly snapshot?: unknown;
  /** G-025 (reabertura): id da proposta EMITIDA de origem desta nova versão (nova → origem). Opcional/aditivo. */
  readonly reopenedFrom?: string;
  /** G-025 (reabertura): id da nova versão que SUBSTITUI esta proposta emitida (origem → sucessora). Opcional/aditivo. */
  readonly supersededBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Entrada de auditoria imutável (§5.2 / §8). */
export interface AuditEntry {
  readonly id: string;
  readonly proposalId: string;
  readonly actorEmail: string;
  readonly role: Role;
  readonly action: string;
  readonly fromState?: WorkflowState;
  readonly toState?: WorkflowState;
  readonly note?: string;
  readonly at: string;
}

/**
 * Evento de SLA técnico persistido (§6). É APPEND-ONLY, como a auditoria: o estado do relógio
 * (consumido/restante/status) é SEMPRE DERIVADO destes eventos via reduceSla() do pricing-engine,
 * nunca armazenado — assim não há estado duplicado que possa divergir. `at` é epoch-millis (o engine
 * trabalha com Instant), diferente do `at` ISO da auditoria.
 */
export interface SlaEventRow {
  readonly id: string;
  readonly proposalId: string;
  /** started | paused | resumed | completed (mesmos kinds do SlaEvent do engine). */
  readonly kind: 'started' | 'paused' | 'resumed' | 'completed';
  readonly at: number; // epoch-millis
  readonly by: string; // email do ator
  /** Carga específica do kind, serializada (reason/missingItems/confirmedItems/verdict/briefingVersion). */
  readonly payload: Record<string, unknown>;
}

export interface CreateProposalArgs {
  readonly id: string;
  readonly ownerEmail: string;
  readonly commercial: CommercialInput;
}

/**
 * Registro de uma REUNIÃO TÉCNICA com o cliente (§6.3). Persistido por proposta; pode haver mais de
 * uma. O `state` é o estado atual da máquina (meeting.ts no engine); `log` é o histórico append-only
 * de transições com ata/decisões/anexos. Solicitar/agendar NÃO pausa o SLA (§6.4) — pausa é ação à parte.
 */
export interface MeetingLogEntry {
  readonly at: number; // epoch-millis
  readonly by: string;
  readonly transition: string; // nome da transição (ou 'solicitada' na criação)
  readonly toState: string;
  readonly note?: string; // ata/decisão/justificativa de cancelamento
}

export interface MeetingRecord {
  readonly id: string; // uuid da reunião
  readonly proposalId: string;
  readonly state: string; // MeetingState do engine
  readonly objective: string; // §6.3: objetivo, tópicos a esclarecer
  readonly scheduledFor?: string; // data/hora sugerida/agendada (ISO), opcional
  readonly log: readonly MeetingLogEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Atribuição INDIVIDUAL de perfil: user_email → role (ASSUMPTION doc 10 §9, reversível). Gerida SOMENTE
 * por admin (ou pelo bootstrap por env). Resolvida do repositório a cada request ⇒ revogação imediata.
 */
export interface RoleAssignment {
  readonly email: string; // minúsculo, domínio autorizado
  readonly role: Role;
  readonly assignedBy: string;
  readonly assignedAt: string;
}

/** Auditoria APPEND-ONLY de atribuições: quem/quando/de/para. `null` = sem perfil (revogado). */
export interface AssignmentAuditEntry {
  readonly id: string;
  readonly targetEmail: string;
  readonly actorEmail: string; // e-mail do admin, ou 'bootstrap:env'
  readonly fromRole: Role | null;
  readonly toRole: Role | null;
  readonly at: string;
}

/** G-002: auditoria APPEND-ONLY de reatribuição de dono (quem/quando/de/para/proposta). `fromOwner` '' = legado sem dono. */
export interface OwnerAuditEntry {
  readonly id: string;
  readonly proposalId: string;
  readonly actorEmail: string;
  readonly fromOwner: string;
  readonly toOwner: string;
  readonly at: string;
}

/** G-006: tipos FECHADOS de solicitação ao Gestor/Aprovador (enum). */
export const APPROVAL_KINDS = ['excecao_comercial', 'alteracao_escopo', 'replanejamento_sla'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'invalidated';

/** G-006: solicitação ao Gestor/Aprovador. Referencia a VERSÃO da proposta; decisão vinculada ao snapshot. */
export interface ApprovalRequest {
  readonly id: string;
  readonly proposalId: string;
  readonly kind: ApprovalKind;
  readonly status: ApprovalRequestStatus;
  readonly requestedBy: string;
  readonly requestedByRole: Role;
  readonly justification: string;
  /** Versão da proposta no momento da solicitação. */
  readonly proposalVersion: number;
  /** Estado da esteira para o qual a proposta volta ao decidir. */
  readonly previousState: WorkflowState;
  readonly createdAt: string;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
  readonly decisionJustification?: string;
  /** Versão da proposta já com a decisão aplicada (vínculo da exceção ao snapshot/versão vigente). */
  readonly decidedProposalVersion?: number;
  readonly invalidatedAt?: string;
  readonly invalidatedReason?: string;
}

/** G-006: conflitos de negócio na criação da solicitação. */
export class ApprovalConflictError extends Error {
  constructor(readonly code: 'pending_exists' | 'invalid_state' | 'approval_pending' | 'stale') {
    super(`approval_conflict:${code}`);
    this.name = 'ApprovalConflictError';
  }
}

/** G-025: proposta já `emitido` é imutável (snapshot entregue ao cliente) — edição comercial/técnica recusada. */
export class IssuedImmutableError extends Error {
  constructor(readonly id: string) {
    super(`proposta emitida é imutável: ${id}`);
    this.name = 'IssuedImmutableError';
  }
}

/** G-025 (reabertura): só uma proposta `emitido` pode ser reaberta — qualquer outro estado recusa. */
export class NotIssuedError extends Error {
  constructor(readonly id: string) {
    super(`proposta não está emitida: ${id}`);
    this.name = 'NotIssuedError';
  }
}

/** Tentativa de remover/rebaixar o último admin (evita lockout). */
export class LastAdminError extends Error {
  constructor() {
    super('não é permitido remover o último administrador');
    this.name = 'LastAdminError';
  }
}

/** Erro de concorrência (optimistic lock) — escrita com versão defasada (§5.2). */
export class VersionConflictError extends Error {
  constructor(
    readonly id: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`conflito de versão em ${id}: esperado ${expected}, atual ${actual}`);
    this.name = 'VersionConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(readonly id: string) {
    super(`proposta não encontrada: ${id}`);
    this.name = 'NotFoundError';
  }
}

/** Identificador de proposta `BONDLY-2027-NNNNNN` (§15). Local ao BFF para não acoplar ao engine. */
export function formatProposalId(sequence: number, year = 2027): string {
  return `BONDLY-${year}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Contrato do repositório. Toda mutação exige `expectedVersion` (lock otimista) e devolve a proposta
 * com a versão incrementada. Grava a auditoria na MESMA operação lógica (append-only).
 */
export interface ProposalRepository {
  nextSequence(): Promise<number>;
  create(args: CreateProposalArgs, audit: Omit<AuditEntry, 'id' | 'proposalId' | 'at'>): Promise<Proposal>;
  get(id: string): Promise<Proposal | null>;
  list(): Promise<readonly Proposal[]>;
  /**
   * Aplica uma mutação (patch parcial de status/commercial/technical/snapshot) sob lock otimista,
   * gravando a auditoria. Lança VersionConflictError / NotFoundError.
   */
  update(
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<Proposal, 'status' | 'commercial' | 'technical' | 'snapshot'>>,
    audit: Omit<AuditEntry, 'id' | 'proposalId' | 'at'>,
    /**
     * G-002 (anti-TOCTOU): se `requireOwner` for informado, o repositório recusa (NotFoundError ⇒ 404) quando o dono
     * ATUAL da proposta não for esse e-mail — checado na mesma operação do UPDATE, antes da versão.
     */
    opts?: { requireOwner?: string },
  ): Promise<Proposal>;
  /**
   * G-023/G-024: edição comercial/técnica ATÔMICA (update da proposta + invalidação das solicitações + auditoria na
   * MESMA transação). Com solicitação PENDENTE (qualquer kind): edição material a invalida e devolve a proposta ao
   * estado ANTERIOR à solicitação já passado por `statusAfterMaterialEdit` (reanálise); edição NÃO material é
   * recusada (ApprovalConflictError('approval_pending') ⇒ 409). Lança VersionConflictError / NotFoundError.
   */
  editProposal(args: {
    id: string;
    expectedVersion: number;
    edit: 'commercial' | 'technical';
    patch: { commercial?: Proposal['commercial']; technical?: Proposal['technical'] };
    material: boolean;
    actor: { email: string; role: Role };
    action: string;
    requireOwner?: string;
  }): Promise<{ proposal: Proposal; invalidated: readonly ApprovalRequest[]; stateInvalidated: boolean }>;
  /**
   * G-002: troca o dono da proposta e grava owner_audit NA MESMA transação; incrementa `version`.
   * Lança NotFoundError se a proposta não existir.
   */
  reassignOwner(id: string, toOwner: string, actorEmail: string): Promise<{ proposal: Proposal; audit: OwnerAuditEntry }>;
  ownerAudit(proposalId: string): Promise<readonly OwnerAuditEntry[]>;
  /**
   * G-025 (reabertura pós-emissão): cria uma NOVA VERSÃO derivada de uma proposta `emitido`, na MESMA transação em que:
   *  - a nova proposta recebe id próprio, estado inicial editável `rascunho_comercial`, version=1, herda `ownerEmail` e os
   *    inputs comercial/técnico da emitida (cópia dos dados, NÃO do snapshot congelado), e `reopenedFrom` = id da emitida;
   *  - a emitida permanece `emitido` e com conteúdo inalterado — apenas ganha `supersededBy` = id da nova versão (ponteiro
   *    aditivo, não muda status/version/commercial/technical/snapshot);
   *  - a auditoria append-only registra o evento `reopen` em AMBAS as propostas (actor/origem/destino/justificativa/at).
   * Recusa: NotFoundError (inexistente/fora de escopo via requireOwner — aqui não usado pois só approver/admin alcançam),
   * NotIssuedError (estado ≠ `emitido`).
   */
  reopenProposal(args: {
    sourceId: string;
    newId: string;
    actor: { email: string; role: Role };
    reason: string;
  }): Promise<{ source: Proposal; reopened: Proposal }>;
  audit(id: string): Promise<readonly AuditEntry[]>;
  /** Grava uma entrada de auditoria SEM alterar a proposta (ex.: decisão do aprovador). Append-only. */
  appendAuditEntry(proposalId: string, entry: Omit<AuditEntry, 'id' | 'proposalId' | 'at'>): Promise<void>;
  /**
   * G-018: registra a decisão do approver de forma ATÔMICA (UNIQUE(proposal_id, kind) + auditoria na mesma
   * operação). `created:true` = esta chamada venceu; `created:false` = já existia — `decision` é a VENCEDORA
   * (quem chamou compara com a sua para responder 200 idempotente ou 409). Lança NotFoundError.
   */
  recordApprovalDecision(
    proposalId: string,
    kind: string,
    decision: 'approved' | 'rejected',
    entry: Omit<AuditEntry, 'id' | 'proposalId' | 'at' | 'action'>,
  ): Promise<{ created: boolean; decision: 'approved' | 'rejected' }>;
  /**
   * G-006: cria a solicitação E move a proposta para `aguardando_aprovacao_gestor` (version+1) E grava a auditoria,
   * tudo na MESMA transação. Valida `fromState` e `expectedVersion` (lock otimista) dentro da transação.
   * No máximo UMA solicitação pendente por proposta. Lança NotFoundError (inclui requireOwner), VersionConflictError,
   * ApprovalConflictError.
   */
  createApprovalRequest(args: {
    proposalId: string;
    kind: ApprovalKind;
    requestedBy: string;
    requestedByRole: Role;
    justification: string;
    expectedVersion: number;
    fromState: WorkflowState;
    requireOwner?: string;
  }): Promise<{ request: ApprovalRequest; proposal: Proposal }>;
  getApprovalRequest(id: string): Promise<ApprovalRequest | null>;
  listApprovalRequests(filter?: { status?: ApprovalRequestStatus; proposalId?: string }): Promise<readonly ApprovalRequest[]>;
  /**
   * G-006 (estende o padrão atômico/idempotente de recordApprovalDecision): decide a solicitação com UPDATE condicional
   * `WHERE status='pending'` (uma decisão por solicitação), devolve a proposta ao estado anterior (version+1) e grava
   * a auditoria na MESMA transação. `created:false` = já decidida (`request.status` é a vencedora).
   */
  decideApprovalRequest(
    id: string,
    decision: 'approved' | 'rejected',
    decider: { email: string; role: Role },
    justification: string,
  ): Promise<{ created: boolean; request: ApprovalRequest; proposal: Proposal }>;
  /**
   * G-006: invalida (pending/approved ⇒ invalidated) as solicitações dos `kinds` afetados por mudança material,
   * com auditoria na mesma transação. Devolve as invalidadas (para o chamador refletir no estado, se pendentes).
   */
  invalidateApprovals(proposalId: string, kinds: readonly ApprovalKind[], actor: { email: string; role: Role }, reason: string): Promise<readonly ApprovalRequest[]>;
  /** Anexa um evento de SLA (append-only). O estado do relógio é derivado destes via reduceSla. */
  appendSlaEvent(event: Omit<SlaEventRow, 'id'>): Promise<void>;
  /** Lê os eventos de SLA de uma proposta em ordem cronológica (by `at`). */
  slaEvents(proposalId: string): Promise<readonly SlaEventRow[]>;
  /** Todos os eventos de SLA (para indicadores gerenciais); ordem cronológica. */
  allSlaEvents(): Promise<readonly SlaEventRow[]>;
  /** Perfil atribuído ao usuário (null = sem perfil). */
  getAssignment(email: string): Promise<RoleAssignment | null>;
  listAssignments(): Promise<readonly RoleAssignment[]>;
  /**
   * Define (role) ou revoga (null) o perfil do usuário e grava a auditoria na MESMA operação.
   * Lança LastAdminError se a mudança deixaria o sistema sem admin.
   */
  setAssignment(email: string, role: Role | null, actorEmail: string): Promise<AssignmentAuditEntry>;
  assignmentAudit(): Promise<readonly AssignmentAuditEntry[]>;
  /** Cria uma reunião técnica (estado inicial 'solicitada'). §6.3. */
  createMeeting(args: { proposalId: string; objective: string; by: string; scheduledFor?: string }): Promise<MeetingRecord>;
  /** Lê as reuniões técnicas de uma proposta. */
  meetings(proposalId: string): Promise<readonly MeetingRecord[]>;
  /** Aplica uma transição à reunião (novo estado + entrada no log). Lança NotFoundError se não existir. */
  updateMeeting(
    meetingId: string,
    patch: { state: string; logEntry: MeetingLogEntry; scheduledFor?: string },
  ): Promise<MeetingRecord>;
}
