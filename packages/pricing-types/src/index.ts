/**
 * @bondly/pricing-types — TIPOS PÚBLICOS do Pricing Engine. SOMENTE declarações (`type`/`interface`).
 *
 * G-001 (ADR docs/15): o Commercial Workspace NÃO pode arrastar o motor de cálculo nem as tabelas de
 * custo/premissa para o bundle do navegador. Como os tipos vivem no mesmo barrel (`@bondly/pricing-engine`)
 * que o runtime (calculate/CURRENT_PREMISES/cogs/margins), importar o barrel — mesmo como `import type` —
 * deixa o bundler sujeito a arrastar valor. Este pacote é a fronteira de TIPO pura: nenhum `const`, nenhuma
 * função, nenhuma tabela. Importável com `import type` sem risco de incluir uma linha de runtime no bundle.
 *
 * FONTE DE VERDADE das formas: packages/pricing-engine/src/contracts/types.ts e módulos públicos. Um teste
 * de sincronia (pricing-types.sync no commercial-workspace) garante que PricingInput/PricingResult/ModuleId/
 * B2cInput aqui são ESTRUTURALMENTE ASSIGNÁVEIS aos do engine — qualquer divergência quebra o typecheck/CI.
 */

// ───────────────────────── Contratos de entrada/saída (contracts/types.ts) ─────────────────────────

export type ContractMonths = 12 | 24 | 36;
export type CommercialOption = 'floor' | 'recommended' | 'premium';
export type CommunicationStrategy = 'rcs' | 'wa' | 'sms' | 'email' | 'both' | 'fallback' | 'custom' | 'none';

export interface ChannelMix {
  readonly sms: number;
  readonly email: number;
  readonly rcs: number;
  readonly wa: number;
}

export interface VolumeParameters {
  readonly users: number;
  readonly mauPct: number;
  readonly stickiness: number;
  readonly transactionsPerMau: number;
}

export interface InvoiceParameters {
  readonly enabled: boolean;
  readonly participantPct: number;
  readonly notesPerParticipant: number;
}

export interface CommunicationParameters {
  readonly perMau: number;
  readonly strategy: CommunicationStrategy;
  readonly fallbackRate: number;
  readonly customMix: ChannelMix;
}

export interface ComplexityParameters {
  readonly integrations: number;
  readonly modules: number;
  readonly slaPoints: number;
  readonly customizationPoints: number;
  readonly aiPoints: number;
  readonly migrationPoints: number;
  readonly implementationHours: number;
}

export interface NegotiationParameters {
  readonly option: CommercialOption;
  readonly extraDiscount: number;
  readonly tierDiscount?: number;
  readonly term: ContractMonths;
  readonly viaMinu: boolean;
  readonly expansion: boolean;
  readonly strategic: boolean;
  readonly setupFixedReductionPct?: number;
  readonly setupOtherAdditions?: number;
}

export interface DedicatedProfile {
  readonly name: string;
  readonly quantity: number;
  readonly totalCompensation: number;
  readonly directCosts: number;
  readonly tablePrice?: number;
  readonly negotiatedPrice?: number;
}

export interface ServiceParameters {
  readonly profiles: readonly DedicatedProfile[];
  readonly tablePrice: number;
  readonly minMargin: number;
  readonly compCap: number;
  readonly targetMargin?: number | undefined;
  readonly passthroughPct: number;
  readonly startMonth: number;
  readonly hourMinMargin: number;
  readonly productiveHoursPerMonth: number;
  readonly hourCost?: number | undefined;
  readonly negotiatedHourPrice?: number | undefined;
}

export type CampaignObjective = 'Aquisição' | 'Ativação' | 'Conversão' | 'Engajamento';

export interface CampaignParameters {
  readonly enabled: boolean;
  readonly objectives: readonly CampaignObjective[];
  readonly base?: number | undefined;
  readonly consentPct: number;
  readonly frequency: number;
  readonly months: number;
  readonly mix: ChannelMix;
  readonly deliveryRate: { readonly sms: number; readonly email: number; readonly rcs: number; readonly wa: number };
  readonly conversionRate: number;
  readonly activationRate: number;
  readonly operationHours: number;
  readonly markup: number;
}

export interface ArkaParameters {
  readonly clientName: string;
  readonly goLiveDate: string;
  readonly owner: string;
  readonly evidenceStage: number;
  readonly probability: number;
}

export interface PricingInput {
  readonly volume: VolumeParameters;
  readonly invoices: InvoiceParameters;
  readonly communication: CommunicationParameters;
  readonly complexity: ComplexityParameters;
  readonly negotiation: NegotiationParameters;
  readonly services: ServiceParameters;
  readonly campaign: CampaignParameters;
  readonly arka?: ArkaParameters | undefined;
}

export interface CostBreakdown {
  readonly cleverTap: number;
  readonly infra: number;
  readonly invoices: number;
  readonly communication: number;
  readonly total: number;
}

export interface TaxBreakdown {
  readonly rate: number;
  readonly onCore: number;
  readonly onServices: number;
  readonly total: number;
}

export type MarginStatus = 'SAUDÁVEL' | 'REVISAR' | 'REPRECIFICAR' | 'CUSTOMIZADO' | 'INCOMPLETO';

export interface PricingWarning {
  readonly code: string;
  readonly message: string;
  readonly severity: 'info' | 'warn' | 'error';
}

export interface DiscountWaterfall {
  readonly base: number;
  readonly tierDiscountRate: number;
  readonly afterTierDiscount: number;
  readonly commercialDiscountRate: number;
  readonly afterCommercialDiscount: number;
  readonly termDiscountRate: number;
  readonly final: number;
}

export interface SetupBreakdown {
  readonly fixed: number;
  readonly fixedReductionPct: number;
  readonly implementationHours: number;
  readonly hourlyRate: number;
  readonly implementationSubtotal: number;
  readonly otherAdditions: number;
  readonly net: number;
  readonly client: number;
}

export interface PricingResult {
  readonly engineVersion: string;
  readonly premisesVersion: string;
  readonly premisesHash: string;
  readonly tierName: string;
  readonly isCustom: boolean;
  readonly mau: number;
  readonly dau: number;
  readonly platformFeeTable: number;
  readonly platformFee: number;
  readonly usage: number;
  readonly processing: number;
  readonly core: number;
  readonly costs: CostBreakdown;
  readonly servicesMrr: number;
  readonly setupNet: number;
  readonly setupClient: number;
  readonly setup: SetupBreakdown;
  readonly taxes: TaxBreakdown;
  readonly minuConversionFee: number;
  readonly minuAccountFee: number;
  readonly technicalMargin: number;
  readonly netMarginY1: number;
  readonly netMarginSteady: number;
  readonly marginStatus: MarginStatus;
  readonly discountAuthority: string;
  readonly maxDiscount: number;
  readonly termDiscount: number;
  readonly tierDiscount: number;
  readonly tierDiscountApplied: boolean;
  readonly discountWaterfall: DiscountWaterfall;
  readonly tcvClient: number;
  readonly tcvBondly: number;
  readonly contractContribution: number;
  readonly contractMargin: number;
  readonly clientYear1: number;
  readonly minuYear1: number;
  readonly minuContract: number;
  readonly complexityScore: number;
  readonly complexityBand: string;
  readonly warnings: readonly PricingWarning[];
}

// ───────────────────────── Módulos (modules/catalog.ts) ─────────────────────────

export type ModuleId = 'points' | 'engagement' | 'roulette' | 'nfReader' | 'benefits';
export type TechnicalMaturity =
  | 'homologado'
  | 'disponivel-config'
  | 'requer-customizacao'
  | 'em-desenvolvimento'
  | 'em-avaliacao'
  | 'indisponivel';
export type CommercialComplexity = 'Baixa' | 'Média' | 'Alta';

export interface ModuleDefinition {
  readonly id: ModuleId;
  readonly name: string;
  readonly maturity: TechnicalMaturity;
  readonly requires: readonly ModuleId[];
  readonly recommends: readonly ModuleId[];
}

export interface DependencyIssue {
  readonly module: ModuleId;
  readonly missing: ModuleId;
  readonly kind: 'required' | 'recommended';
}

// ───────────────────────── B2C (modules/b2c.ts) — forma mínima usada pela UI ─────────────────────────

export type AntifraudMethod = 'progressiva' | 'integral';
export type B2cScope = 'primeira' | 'todas';

export interface B2cInput {
  readonly som: number;
  readonly conv: number;
  readonly ticket: number;
  readonly churn: number;
  readonly fee: number;
  readonly gateway: number;
  readonly tax: number;
  readonly minFee: number;
  readonly minuShare: number;
  readonly commission: number;
  readonly method: AntifraudMethod;
  readonly scope: B2cScope;
  readonly validation: number;
  readonly cardReuse: number;
  readonly setup: number;
  readonly minMargin: number;
  readonly addCost: number;
  readonly weights: readonly number[];
}

// ───────────────────────── B2C resultado + proposta/cenário (modules/b2c.ts, versioning/proposal.ts) ─────────

export interface B2cMonthRow {
  readonly start: number;
  readonly nw: number;
  readonly canc: number;
  readonly end: number;
  readonly billed: number;
  readonly gmv: number;
  readonly rev: number;
  readonly rev10: number;
  readonly comm: number;
  readonly gw: number;
  readonly vol: number;
  readonly af: number;
  readonly tax: number;
  readonly add: number;
  readonly margin: number;
  readonly minu: number;
  readonly bondly: number;
  readonly commNet: number;
  readonly total: number;
}

export interface B2cResult {
  readonly rows: readonly B2cMonthRow[];
  readonly tot: B2cMonthRow;
  readonly K: number;
  readonly target: number;
}

export interface ProposalB2c {
  readonly input: B2cInput;
  readonly result: B2cResult;
}

export type ScenarioName = 'conservador' | 'base' | 'otimista' | string;

export interface ScenarioResult {
  readonly name: ScenarioName;
  readonly input: PricingInput;
  readonly result: PricingResult;
}

/**
 * Snapshot imutável de proposta. `premises` é a tabela congelada (opaca aqui — contém premissas de custo
 * confidenciais, não deve ser lida campo a campo no bundle do navegador). Em produção o snapshot completo só
 * existe no servidor (Fase 4); este tipo serve ao gerador de PDF que roda SOMENTE em DEV atrás do guard.
 */
export interface ProposalSnapshot {
  readonly id: string;
  readonly revision: number;
  readonly issuedAt: string;
  readonly engineVersion: string;
  readonly premisesVersion: string;
  readonly premisesHash: string;
  readonly premises: unknown;
  readonly input: PricingInput;
  readonly result: PricingResult;
  readonly b2c?: ProposalB2c;
  readonly scenarios: readonly ScenarioResult[];
  readonly selectedModules?: readonly ModuleId[];
}
