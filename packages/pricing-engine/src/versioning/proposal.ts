/**
 * Versionamento financeiro e reprodutibilidade (prompt §27.6 + requisito complementar + §15).
 *
 * Cada proposta armazena um SNAPSHOT IMUTÁVEL: versão do motor, versão + hash das premissas, cópia
 * congelada da tabela de premissas, entradas e saídas do cálculo, identificador e data de emissão.
 * Reabrir uma proposta histórica reproduz exatamente os valores originais, mesmo que a Bondly mude
 * preços/custos/tributos/margens depois. Recalcular com novas premissas gera uma NOVA revisão.
 */
import type { PricingInput, PricingResult } from '../contracts/types.js';
import type { PremiseTable } from '../premises/premises.js';
import { CURRENT_PREMISES, hashPremiseTable, premisesForVersion } from '../premises/premises.js';
import { ENGINE_VERSION } from '../version.js';
import { calculate } from '../calculations/calculate.js';
import { runB2c, type B2cInput, type B2cResult } from '../modules/b2c.js';
import { defaultScenarios, type ScenarioResult } from '../scenarios/scenarios.js';
import type { ModuleId } from '../modules/catalog.js';

/** Bloco B2C opcional de uma proposta: input normalizado + projeção, congelados no snapshot. */
export interface ProposalB2c {
  readonly input: B2cInput;
  readonly result: B2cResult;
}

export interface ProposalSnapshot {
  readonly id: string; // BONDLY-2027-NNNNNN
  readonly revision: number;
  readonly issuedAt: string; // ISO datetime
  readonly engineVersion: string;
  readonly premisesVersion: string;
  readonly premisesHash: string;
  readonly premises: PremiseTable; // cópia congelada
  readonly input: PricingInput;
  readonly result: PricingResult;
  readonly b2c?: ProposalB2c; // módulo B2C (quando a proposta o inclui)
  readonly scenarios: readonly ScenarioResult[]; // conservador/base/otimista (§13), congelados
  readonly selectedModules?: readonly ModuleId[]; // módulos nominais selecionados (para a proposta)
}

/** Formata um identificador único de proposta `BONDLY-2027-NNNNNN` (§15). */
export function formatProposalId(sequence: number, year = 2027): string {
  return `BONDLY-${year}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Cria um snapshot imutável de proposta a partir de uma entrada. A tabela de premissas é copiada e
 * congelada; o resultado é calculado contra ELA, não contra a versão corrente global — garantindo
 * reprodutibilidade (§27.6).
 */
export function createProposalSnapshot(args: {
  id: string;
  input: PricingInput;
  premises?: PremiseTable;
  revision?: number;
  issuedAt?: string;
  b2cInput?: B2cInput;
  selectedModules?: readonly ModuleId[];
}): ProposalSnapshot {
  const premises = args.premises ?? CURRENT_PREMISES;
  const result = calculate(args.input, premises);
  const b2c: ProposalB2c | undefined = args.b2cInput
    ? { input: args.b2cInput, result: runB2c(args.b2cInput, premises) }
    : undefined;
  const scenarios = defaultScenarios(args.input, premises);
  return Object.freeze({
    id: args.id,
    revision: args.revision ?? 1,
    issuedAt: args.issuedAt ?? new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    premisesVersion: premises.version,
    premisesHash: premises.hash,
    premises,
    input: args.input,
    result,
    scenarios,
    ...(b2c ? { b2c } : {}),
    ...(args.selectedModules ? { selectedModules: [...args.selectedModules] } : {}),
  });
}

/**
 * Reabre um snapshot histórico: recalcula contra as premissas congeladas e verifica se os valores
 * reproduzem o resultado original (integridade do snapshot). Não altera nada.
 */
export function reopenProposal(snapshot: ProposalSnapshot): {
  readonly result: PricingResult;
  readonly reproducible: boolean;
  readonly premisesIntact: boolean;
  readonly versionRegistered: boolean;
} {
  const result = calculate(snapshot.input, snapshot.premises);
  const premisesIntact = hashPremiseTable({ ...snapshot.premises, hash: '' }) === snapshot.premisesHash;
  // A versão congelada na proposta deve existir no registro e bater em hash com ele (quando
  // registrada). O recálculo usa SEMPRE o snapshot imutável — o registro é só verificação/resolução.
  const registered = premisesForVersion(snapshot.premisesVersion);
  const versionRegistered = registered !== undefined && registered.hash === snapshot.premisesHash;
  const reproducible =
    Math.abs(result.core - snapshot.result.core) < 1e-6 &&
    Math.abs(result.tcvClient - snapshot.result.tcvClient) < 1e-6 &&
    Math.abs(result.technicalMargin - snapshot.result.technicalMargin) < 1e-9;
  return { result, reproducible, premisesIntact, versionRegistered };
}

/**
 * Gera uma nova revisão de uma proposta aplicando premissas atuais (ou outras), preservando o id.
 * O snapshot anterior permanece inalterado (histórico).
 */
export function reviseProposal(
  previous: ProposalSnapshot,
  newPremises: PremiseTable = CURRENT_PREMISES,
): ProposalSnapshot {
  return createProposalSnapshot({
    id: previous.id,
    input: previous.input,
    premises: newPremises,
    revision: previous.revision + 1,
    ...(previous.b2c ? { b2cInput: previous.b2c.input } : {}),
    ...(previous.selectedModules ? { selectedModules: previous.selectedModules } : {}),
  });
}
