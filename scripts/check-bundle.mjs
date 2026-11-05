// G-001 (Parte A4, docs/14) — GATE DE BUNDLE: prova que o cálculo comercial, as tabelas de custo/premissas e
// o motor de preço NÃO vazam para o bundle de produção do commercial-workspace. Roda APÓS o build de produção
// (`npm run build --workspace @bondly/commercial-workspace`). Falha (exit 1) se qualquer identificador proibido
// aparecer em QUALQUER asset .js do dist. É um teste de regressão: o DCE do Vite/Rollup depende de o código do
// cliente não referenciar esses símbolos (ver TierDiscountPanel/devEngine). Uso: node scripts/check-bundle.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps', 'commercial-workspace', 'dist');

// Identificadores que NUNCA podem aparecer no bundle de produção (cálculo/tabelas/custo/premissas).
// \b ancora os nomes "curtos" (calculate, tierFor, cogs, taxRate) para não casar substrings legítimas.
const FORBIDDEN = [
  { id: 'calculate', re: /\bcalculate\b/ },
  { id: 'defaultScenarios', re: /\bdefaultScenarios\b/ },
  { id: 'runB2c', re: /\brunB2c\b/ },
  { id: 'createProposalSnapshot', re: /\bcreateProposalSnapshot\b/ },
  { id: 'arkaClassification', re: /\barkaClassification\b/ },
  { id: 'normalizeB2cInput', re: /\bnormalizeB2cInput\b/ },
  { id: 'cogs', re: /\bcogs\b/ },
  { id: 'CURRENT_PREMISES', re: /\bCURRENT_PREMISES\b/ },
  // G-001: `platformFeeTable` colide nominalmente com um CAMPO do PricingResult (o número "Platform Fee de
  // tabela" renderizado só na visão interna — mesma categoria dos campos de margem que PODEM ficar como chave
  // de property-access). Proibimos APENAS a FUNÇÃO do engine: uma chamada `platformFeeTable(` ou referência
  // nua. As formas de property-key (`platformFeeTable:`) e de acesso (`.platformFeeTable`) são permitidas e
  // NÃO contam como violação. A ausência do engine já é provada por `calculate`/`CURRENT_PREMISES`/
  // `platformFeeBands`/`tierFor`/`validateTierDiscountPct` = 0. (Decisão documentada em docs/14, CONFLICT A4.)
  { id: 'platformFeeTable', re: /(?<![.\w])platformFeeTable\s*\(/ },
  { id: 'platformFeeBands', re: /\bplatformFeeBands\b/ },
  { id: 'validateTierDiscountPct', re: /\bvalidateTierDiscountPct\b/ },
  { id: 'tierFor', re: /\btierFor\b/ },
  { id: 'taxRate', re: /\btaxRate\b/ },
  { id: 'serviceCompCap', re: /\bserviceCompCap\b/ },
];

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error(`[check-bundle] dist não encontrado em ${DIST}. Rode o build do commercial-workspace antes.`);
  process.exit(2);
}

const files = jsFiles(DIST);
if (files.length === 0) {
  console.error(`[check-bundle] nenhum .js em ${DIST}. Build de produção ausente?`);
  process.exit(2);
}

const violations = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const { id, re } of FORBIDDEN) {
    if (re.test(text)) violations.push({ file: file.replace(ROOT + '/', ''), id });
  }
}

if (violations.length > 0) {
  console.error(`[check-bundle] FALHA: ${violations.length} identificador(es) proibido(s) no bundle de produção:`);
  for (const v of violations) console.error(`  - ${v.id}  (${v.file})`);
  console.error('O cálculo/tabelas de custo devem permanecer server-only (ADR docs/15). Remova a referência no cliente.');
  process.exit(1);
}

console.log(`[check-bundle] OK: ${files.length} asset(s) verificado(s), 0 identificador(es) proibido(s).`);
