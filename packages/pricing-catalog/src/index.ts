/**
 * @bondly/pricing-catalog — catálogo de módulos comerciais e validação de dependências.
 *
 * G-001: contém SÓ dados NÃO sensíveis (id/nome/maturidade/dependências dos módulos) e funções puras de
 * validação de dependência/complexidade por contagem. NENHUM preço de tabela, custo, margem, tributo ou
 * premissa financeira — por isso é seguro no bundle do navegador. As formas de tipo vêm de @bondly/pricing-types.
 *
 * FONTE DE VERDADE: packages/pricing-engine/src/modules/catalog.ts. Um teste de sincronia
 * (commercial-workspace/src/services/pricing/catalogSync.test.ts) garante igualdade estrutural com o engine.
 */
import type { ModuleId, ModuleDefinition, CommercialComplexity, DependencyIssue } from '@bondly/pricing-types';

export type { ModuleId, ModuleDefinition, CommercialComplexity, DependencyIssue } from '@bondly/pricing-types';

/** Catálogo padrão (D-M1). Espelho EXATO de MODULE_CATALOG do engine — validado por catalogSync.test.ts. */
export const MODULE_CATALOG: readonly ModuleDefinition[] = [
  { id: 'points', name: 'Motor de Pontos', maturity: 'homologado', requires: [], recommends: [] },
  { id: 'engagement', name: 'Motor de Engajamento (Missões)', maturity: 'homologado', requires: ['points'], recommends: [] },
  { id: 'roulette', name: 'Roletas', maturity: 'disponivel-config', requires: ['points'], recommends: ['engagement'] },
  { id: 'nfReader', name: 'Leitor de NF', maturity: 'disponivel-config', requires: [], recommends: ['points'] },
  { id: 'benefits', name: 'Planos de Benefícios', maturity: 'disponivel-config', requires: [], recommends: [] },
];

/** Complexidade comercial pela quantidade de módulos (§8.1). Função pura, sem premissa de custo. */
export function commercialComplexity(count: number): CommercialComplexity {
  if (count <= 2) return 'Baixa';
  if (count <= 4) return 'Média';
  return 'Alta';
}

/** Valida dependências dos módulos selecionados (§8.2). `required` ausente = bloqueio. Função pura. */
export function validateDependencies(selected: readonly ModuleId[]): readonly DependencyIssue[] {
  const set = new Set(selected);
  const issues: DependencyIssue[] = [];
  for (const id of selected) {
    const def = MODULE_CATALOG.find((m) => m.id === id);
    if (!def) continue;
    for (const req of def.requires) if (!set.has(req)) issues.push({ module: id, missing: req, kind: 'required' });
    for (const rec of def.recommends) if (!set.has(rec)) issues.push({ module: id, missing: rec, kind: 'recommended' });
  }
  return issues;
}
