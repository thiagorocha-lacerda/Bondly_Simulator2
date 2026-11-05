/**
 * @bondly/pricing-engine — API pública.
 * Motor financeiro independente de React/DOM (prompt §5). Contratos estáveis para CRM, portal de
 * parceiros, app comercial e ferramentas financeiras (§21).
 */

export { ENGINE_VERSION } from './version.js';

// Contratos
export type * from './contracts/types.js';

// Premissas (governança + versionamento)
export {
  PREMISES_V15,
  PREMISES_V16,
  CURRENT_PREMISES,
  PREMISES_REGISTRY,
  premisesForVersion,
  freezePremiseTable,
  hashPremiseTable,
} from './premises/premises.js';
export type {
  Premise,
  PremiseStatus,
  PremiseTable,
  Band,
  TierDefinition,
  ComplexityBand,
  CommunicationTariffs,
  TierDiscountLimits,
} from './premises/premises.js';

// Orquestrador
export { calculate } from './calculations/calculate.js';

// Precificação (blocos individuais, reutilizáveis)
export { platformFeeTable, resolvePlatformFee, economicFloor, termDiscountFor } from './pricing/platformFee.js';
export type { PlatformFeeResolution } from './pricing/platformFee.js';
export { usagePerDay, monthlyUsage, processing, mauOf, dauOf, tierFor } from './pricing/usage.js';
export { complexity } from './pricing/complexity.js';
export type { ComplexityResult, ComplexityPart } from './pricing/complexity.js';
export { setup, minuFees } from './pricing/setup.js';
export type { SetupResult, MinuFees } from './pricing/setup.js';
export { services } from './pricing/services.js';
export type { ServicesResult, ProfileResult, ServiceStatus } from './pricing/services.js';

// Custos
export { communicationUnitCost } from './costs/communication.js';
export { cogs, invoicesFactor } from './costs/cogs.js';

// Margens
export { technicalMargin, marginStatus, netMargin } from './margins/margins.js';

// Validações
export { discountAuthority } from './validations/discountAuthority.js';
export type { DiscountAuthorityResult } from './validations/discountAuthority.js';
export {
  validateTierDiscountPct,
  resolveTierDiscount,
  TIER_DISCOUNT_DECIMALS,
} from './validations/tierDiscount.js';
export type { TierDiscountValidation, ResolvedTierDiscount } from './validations/tierDiscount.js';

// Módulos
export {
  MODULE_CATALOG,
  commercialComplexity,
  validateDependencies,
  allModuleCombinations,
} from './modules/catalog.js';
export type { ModuleId, ModuleDefinition, TechnicalMaturity, CommercialComplexity, DependencyIssue } from './modules/catalog.js';
export { campaign } from './modules/campaign.js';
export type { CampaignResult } from './modules/campaign.js';
export { arkaClassification, EVIDENCE_STAGES, EVIDENCE_MIN_H2 } from './modules/arka.js';
export type { ArkaResult, ArkaClass, EvidenceStage } from './modules/arka.js';
export { runB2c, antifraudCost, normalizeB2cInput } from './modules/b2c.js';
export type { B2cInput, B2cResult, B2cMonthRow, AntifraudMethod, B2cScope } from './modules/b2c.js';

// Cenários (§13)
export { runScenarios, applyScenario, defaultScenarios } from './scenarios/scenarios.js';
export type { ScenarioName, ScenarioOverride, ScenarioResult } from './scenarios/scenarios.js';

// Primitivas de faixas progressivas
export { progressiveSum, progressiveSumInclusive, bandRateIntegral, ceilTo } from './calculations/bands.js';

// Versionamento de propostas
export {
  createProposalSnapshot,
  reopenProposal,
  reviseProposal,
  formatProposalId,
} from './versioning/proposal.js';
export type { ProposalSnapshot, ProposalB2c } from './versioning/proposal.js';

// Utilidades monetárias
export { roundCurrency, toCents, fromCents, clamp, pctToFraction, finiteOr } from './calculations/money.js';

// SLA técnico (§6) — motor de dias úteis + relógio auditável de pausas/retomadas
export {
  toSpCivil,
  isBusinessDay,
  businessDaysBetween,
  addBusinessDays,
} from './sla/businessDays.js';
export type { Instant, SpDate } from './sla/businessDays.js';
export { BR_NATIONAL_HOLIDAYS, buildHolidaySet } from './sla/holidays.js';
export { reduceSla, defaultSlaConfig } from './sla/clock.js';
export type {
  SlaEvent,
  TechnicalVerdict,
  SlaPhase,
  SlaHealth,
  SlaConfig,
  SlaState,
} from './sla/clock.js';
// Indicadores P75/P90 do SLA (tempo útil efetivo; nearest-rank)
export {
  percentileNearestRank,
  mean as slaMean,
  median as slaMedian,
  sampleFromSlaEvents,
  computeSlaIndicators,
  computeSlaIndicatorsFromEvents,
} from './sla/indicators.js';
export type { SlaSample, SlaIndicators, DistributionStats, PauseByReason } from './sla/indicators.js';
export {
  canMeetingTransition,
  isMeetingTransition,
  isMeetingTerminal,
  MEETING_INITIAL,
} from './sla/meeting.js';
export type { MeetingState, MeetingTransition, MeetingDecision } from './sla/meeting.js';
