/**
 * Orquestrador do Pricing Engine — `calculate()` (reproduz `calc()` do HTML legado).
 * Função pura e determinística: mesma entrada + mesma versão de premissas ⇒ mesma saída.
 */
import type { PricingInput, PricingResult, PricingWarning } from '../contracts/types.js';
import type { PremiseTable } from '../premises/premises.js';
import { CURRENT_PREMISES } from '../premises/premises.js';
import { ENGINE_VERSION } from '../version.js';
import { communicationUnitCost } from '../costs/communication.js';
import { cogs as computeCogs, invoicesFactor } from '../costs/cogs.js';
import { complexity as computeComplexity } from '../pricing/complexity.js';
import {
  economicFloor,
  platformFeeTable,
  resolvePlatformFee,
  termDiscountFor,
} from '../pricing/platformFee.js';
import { dauOf, mauOf, monthlyUsage, processing, tierFor } from '../pricing/usage.js';
import { marginStatus, netMargin, technicalMargin } from '../margins/margins.js';
import { discountAuthority } from '../validations/discountAuthority.js';
import { resolveTierDiscount } from '../validations/tierDiscount.js';
import { services as computeServices } from '../pricing/services.js';
import { minuFees, setup as computeSetup } from '../pricing/setup.js';
import { campaign as computeCampaign } from '../modules/campaign.js';

export function calculate(input: PricingInput, premises: PremiseTable = CURRENT_PREMISES): PricingResult {
  const { volume, invoices, communication, complexity, negotiation, services, campaign } = input;
  const warnings: PricingWarning[] = [];

  // Engajamento
  const mau = mauOf(volume.users, volume.mauPct);
  const dau = dauOf(mau, volume.stickiness);

  // Comunicação e COGS
  const nf = invoicesFactor(invoices.enabled, invoices.participantPct, invoices.notesPerParticipant);
  const commUnit = communicationUnitCost(
    communication.strategy,
    communication.fallbackRate,
    communication.customMix,
    premises.communicationTariffs.value,
  );
  const costs = computeCogs({
    mau,
    transactionsPerMau: volume.transactionsPerMau,
    invoicesFactor: nf,
    communicationUnit: commUnit,
    communicationsPerMau: communication.perMau,
    cleverTapPerMau: premises.cleverTapPerMau.value,
    invoiceReadCost: premises.invoiceReadCost.value,
    infraPerTransaction: premises.infraPerTransaction.value,
  });

  // Receita base
  const usage = monthlyUsage(dau, premises.usageBands.value);
  const proc = processing(mau, volume.transactionsPerMau, premises.processingPerTransaction.value);

  // Complexidade
  const cx = computeComplexity(complexity, premises.complexityBands.value);

  // Platform Fee
  const tier = tierFor(volume.users, premises.tiers.value);
  const pfTable = platformFeeTable(volume.users, premises.platformFeeBands.value);
  const floorEconomic = economicFloor({
    cogs: costs.total,
    usage,
    processing: proc,
    marginTarget: premises.marginFloor.value,
  });
  const extraDiscount = Math.max(0, negotiation.extraDiscount);
  const tdisc = termDiscountFor(negotiation.term, premises);
  // Desconto por tier (§3.1): resolvido contra os limites da tabela (clamp de fronteira do contrato).
  const tierDisc = resolveTierDiscount(negotiation.tierDiscount, premises.tierDiscountLimits.value);
  const pf = resolvePlatformFee({
    table: pfTable,
    floorEconomic,
    complexity: cx,
    option: negotiation.option,
    extraDiscount,
    termDiscount: tdisc,
    tierDiscount: tierDisc.fraction,
  });

  const core = pf.final + usage + proc;

  // Serviços
  const sv = computeServices({
    params: services,
    taxRate: premises.taxRate.value,
    tablePriceDefault: premises.dedicatedTablePrice.value,
    hourlyRate: premises.hourlyRate.value,
    implementationHours: complexity.implementationHours,
    compCapDefault: premises.serviceCompCap.value,
    productiveHoursDefault: premises.serviceProductiveHours.value,
    minMarginDefault: premises.serviceMinMargin.value,
    hourMinMarginDefault: premises.serviceHourMinMargin.value,
  });
  const servicesMrr = sv.mrr;

  // Setup — redução do fixo: a proposta sobrescreve; na ausência, usa o DEFAULT governado da tabela
  // de premissas ativa (v16 = 0,20 validado pelo sponsor; v15 = 0, comportamento histórico).
  // Forward-compat (F-02): snapshots congelados sob o schema ANTIGO não têm este campo. Ausente ⇒ 0
  // (comportamento histórico: tabela antiga = sem redução default), para reabrir sem crash.
  const setupFixedReductionDefault = premises.setupFixedReductionDefault?.value ?? 0;
  const reductionFromProposal = negotiation.setupFixedReductionPct !== undefined;
  const effectiveSetupFixedReduction = reductionFromProposal
    ? negotiation.setupFixedReductionPct!
    : setupFixedReductionDefault;
  const setupR = computeSetup({
    tierSetup: tier.setup,
    complexity: cx,
    option: negotiation.option,
    implementationCost: sv.implementationCost,
    viaMinu: negotiation.viaMinu,
    setupMarkup: premises.setupMarkup.value,
    implementationHours: complexity.implementationHours,
    hourlyRate: sv.hourPrice,
    otherAdditions: negotiation.setupOtherAdditions,
    fixedReductionPct: effectiveSetupFixedReduction,
  });

  // Tributos e fees
  const taxRate = premises.taxRate.value;
  const taxes = {
    rate: taxRate,
    onCore: core * taxRate,
    onServices: servicesMrr * taxRate,
    total: (core + servicesMrr) * taxRate,
  };
  const mf = minuFees({
    viaMinu: negotiation.viaMinu,
    platformFee: pf.final,
    conversionRate: premises.minuConversionFee.value,
    accountRate: premises.minuAccountFee.value,
    setupNet: setupR.net,
    setupMarkup: premises.setupMarkup.value,
    term: negotiation.term,
  });

  // Margens
  const margin = technicalMargin(core, costs.total);
  const net = netMargin({
    core,
    cogs: costs.total,
    taxRate,
    conversionFee: mf.conversionFee,
    accountFee: mf.accountFee,
  });
  const maxTierUsers = premises.tiers.value[premises.tiers.value.length - 1]!.users;
  const status = marginStatus({
    margin,
    mau,
    users: volume.users,
    target: premises.marginTarget.value,
    floor: premises.marginFloor.value,
    maxTierUsers,
  });

  // Alçada
  const auth = discountAuthority({
    requestedDiscount: extraDiscount,
    expansion: negotiation.expansion,
    strategic: negotiation.strategic,
    table: premises,
  });

  // Campanha
  const camp = computeCampaign({
    params: campaign,
    eligibleUsers: volume.users,
    term: negotiation.term,
    tariffs: premises.communicationTariffs.value,
    taxRate,
    hourlyRate: premises.hourlyRate.value,
  });

  // TCV e contrato (R-025/R-026)
  const term = negotiation.term;
  const kRev = (core + servicesMrr) * term;
  const kCogs = costs.total * term;
  const kTax = (core + servicesMrr) * taxRate * term;
  const kFees = mf.conversionFee * Math.min(12, term) + mf.accountFee * term;
  const contractContribution =
    kRev +
    setupR.net -
    kCogs -
    kTax -
    kFees +
    camp.contribution -
    setupR.net * taxRate -
    sv.cost * term -
    complexity.implementationHours * sv.hourCost;
  const contractDenom = kRev + setupR.net + camp.revenue;
  const contractMargin = contractDenom > 0 ? contractContribution / contractDenom : 0;

  const tcvClient = (core + servicesMrr) * term + setupR.client + camp.revenue;
  const tcvBondly = (core + servicesMrr) * term + setupR.net + camp.revenue;
  const clientYear1 = (core + servicesMrr) * 12 + setupR.client + camp.revenueYear1;

  // Avisos
  if (status === 'REPRECIFICAR')
    warnings.push({ code: 'MARGIN_BELOW_FLOOR', message: 'Margem técnica abaixo do piso de 60%.', severity: 'error' });
  else if (status === 'REVISAR')
    warnings.push({ code: 'MARGIN_BELOW_TARGET', message: 'Margem entre 60% e 70%: aceitável com justificativa.', severity: 'warn' });
  if (auth.severity === 'error')
    warnings.push({ code: 'DISCOUNT_OUT_OF_CORRIDOR', message: auth.authority, severity: 'error' });
  if (sv.belowMin > 0)
    warnings.push({ code: 'SERVICE_BELOW_MIN', message: `${sv.belowMin} perfil(is) de serviço abaixo da margem mínima.`, severity: 'error' });
  if (tierDisc.clamped) {
    const lim = premises.tierDiscountLimits.value;
    warnings.push({
      code: 'TIER_DISCOUNT_CLAMPED',
      message: `Desconto por tier ajustado para a faixa permitida (${(lim.min * 100).toFixed(2)}%–${(lim.max * 100).toFixed(2)}%).`,
      severity: 'warn',
    });
  }
  // Flag de redução do Setup fixo PENDENTE.
  // Regra (DECISION sponsor/CTO 2026-11-05): a redução até o DEFAULT governado e validado da tabela
  // ativa é aprovada e NÃO é pendente. A flag só sinaliza uma redução AD HOC por proposta ACIMA do
  // default validado (concessão comercial adicional não aprovada). Em v15 o default é 0, logo
  // QUALQUER redução volta a ser ad hoc e pendente — o comportamento legado é preservado.
  const adHocReductionAboveDefault =
    reductionFromProposal && setupR.fixedReductionPct > setupFixedReductionDefault + 1e-9;
  if (adHocReductionAboveDefault) {
    warnings.push({
      code: 'SETUP_FIXED_REDUCTION_PENDING',
      message:
        `Setup fixo reduzido em ${(setupR.fixedReductionPct * 100).toFixed(1)}% — acima do default ` +
        `validado de ${(setupFixedReductionDefault * 100).toFixed(1)}% (v${premises.version.replace(/^v/, '')}); ` +
        `concessão ad hoc pendente de aprovação comercial.`,
      severity: 'warn',
    });
  }
  if (complexity.implementationHours > 0 && sv.hourStatus === 'r') {
    warnings.push({
      code: 'SETUP_HOUR_BELOW_MIN_MARGIN',
      message: `Hora de implantação abaixo da margem mínima de R$ ${premises.serviceHourMinMargin.value.toFixed(0)}/HH.`,
      severity: 'error',
    });
  }

  return {
    engineVersion: ENGINE_VERSION,
    premisesVersion: premises.version,
    premisesHash: premises.hash,
    tierName: tier.name + (volume.users > maxTierUsers ? ' · custom' : ''),
    isCustom: volume.users > maxTierUsers,
    mau,
    dau,
    platformFeeTable: pfTable,
    platformFee: pf.final,
    usage,
    processing: proc,
    core,
    costs,
    servicesMrr,
    setupNet: setupR.net,
    setupClient: setupR.client,
    setup: {
      fixed: setupR.fixed,
      fixedReductionPct: setupR.fixedReductionPct,
      implementationHours: setupR.implementationHours,
      hourlyRate: setupR.hourlyRate,
      implementationSubtotal: setupR.implementationSubtotal,
      otherAdditions: setupR.otherAdditions,
      net: setupR.net,
      client: setupR.client,
    },
    taxes,
    minuConversionFee: mf.conversionFee,
    minuAccountFee: mf.accountFee,
    technicalMargin: margin,
    netMarginY1: net.year1,
    netMarginSteady: net.steady,
    marginStatus: status,
    discountAuthority: auth.authority,
    maxDiscount: auth.maxDiscount,
    termDiscount: tdisc,
    tierDiscount: tierDisc.fraction,
    tierDiscountApplied: tierDisc.applied,
    discountWaterfall: {
      base: pf.chosen,
      tierDiscountRate: pf.tierDiscount,
      afterTierDiscount: pf.afterTierDiscount,
      commercialDiscountRate: extraDiscount,
      afterCommercialDiscount: pf.afterTierDiscount * (1 - extraDiscount),
      termDiscountRate: tdisc,
      final: pf.final,
    },
    tcvClient,
    tcvBondly,
    contractContribution,
    contractMargin,
    clientYear1,
    minuYear1: mf.year1,
    minuContract: mf.contract,
    complexityScore: cx.score,
    complexityBand: cx.band.name,
    warnings,
  };
}
