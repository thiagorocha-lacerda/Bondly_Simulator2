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
//
// REGRA "identificador nu" (bareId) — F-04 (docs/14): vários tokens de DADO de custo/margem/premissa colidem
// nominalmente com CAMPOS legítimos do PricingResult/QuoteView que o cliente PODE exibir (ex.: `cleverTap:0`,
// `minuConversionFee:0`, `technicalMargin:0`, `netMarginY1`, `premisesHash:""`, `platformFeeTable:0`). Esses
// campos são o RESULTADO já sanitizado (números/strings), não o engine. O que NUNCA pode vazar é a FUNÇÃO ou a
// referência ao DADO-DE-TABELA do engine. Então proibimos apenas a forma NUA do identificador:
//   proibido:  `cleverTap(`  `=cleverTap`  `,cleverTap,`  `(cleverTap)`  `f=platformFeeTable; f()`
//   permitido: `.platformFeeTable` (property-access)  e  `platformFeeTable:` (property-key)
// bareId(t) = token como palavra inteira NÃO precedido por `.` (access) e NÃO seguido por `:` (key) nem por
// `\w` (substring). Isto também endurece `platformFeeTable`: o lookbehind antigo `(?<![.\w])platformFeeTable\s*\(`
// só pegava a CHAMADA e deixava escapar o ALIAS (`const f=platformFeeTable`) e o acesso por bracket
// (`obj['platformFeeTable']`); a forma nua cobre o alias e o identificador cru direto. (A ausência do engine
// também é provada por `calculate`/`CURRENT_PREMISES`/`platformFeeBands`/`tierFor`/`validateTierDiscountPct`=0.)
export const bareId = (t) => new RegExp(`(?<![.\\w])${t}(?![\\w:])`);

export const FORBIDDEN = [
  { id: 'calculate', re: /\bcalculate\b/ },
  { id: 'defaultScenarios', re: /\bdefaultScenarios\b/ },
  { id: 'runB2c', re: /\brunB2c\b/ },
  { id: 'createProposalSnapshot', re: /\bcreateProposalSnapshot\b/ },
  { id: 'arkaClassification', re: /\barkaClassification\b/ },
  { id: 'normalizeB2cInput', re: /\bnormalizeB2cInput\b/ },
  { id: 'cogs', re: /\bcogs\b/ },
  { id: 'CURRENT_PREMISES', re: /\bCURRENT_PREMISES\b/ },
  // platformFeeTable: só a forma NUA (função/alias/bracket-via-identificador). Ver nota "bareId" acima.
  { id: 'platformFeeTable', re: bareId('platformFeeTable') },
  { id: 'platformFeeBands', re: /\bplatformFeeBands\b/ },
  { id: 'validateTierDiscountPct', re: /\bvalidateTierDiscountPct\b/ },
  { id: 'tierFor', re: /\btierFor\b/ },
  { id: 'taxRate', re: /\btaxRate\b/ },
  { id: 'serviceCompCap', re: /\bserviceCompCap\b/ },
  // F-04 — tokens de DADO de custo/premissa que SÓ existem no engine (0 no dist de prod atual, verificado por
  // grep). Os que colidem com campo exibido do resultado (cleverTap, minuConversionFee, minuAccountFee,
  // premisesHash, technicalMargin, netMargin) são proibidos só na forma NUA (bareId); os que não têm colisão
  // legítima (0 em qualquer forma) usam \b. NOTA: o label de texto "CleverTap" (capitalizado, nome de produto
  // exibido na UI) NÃO é identificador — por isso listamos `cleverTap` (camelCase do engine), não `CleverTap`.
  { id: 'cleverTapPerMau', re: /\bcleverTapPerMau\b/ },
  { id: 'cleverTap', re: bareId('cleverTap') },
  { id: 'invoiceReadCost', re: /\binvoiceReadCost\b/ },
  { id: 'infraPerTransaction', re: /\binfraPerTransaction\b/ },
  { id: 'processingPerTransaction', re: /\bprocessingPerTransaction\b/ },
  { id: 'serviceProductiveHours', re: /\bserviceProductiveHours\b/ },
  { id: 'serviceMinMargin', re: /\bserviceMinMargin\b/ },
  { id: 'serviceHourMinMargin', re: /\bserviceHourMinMargin\b/ },
  { id: 'minuConversionFee', re: bareId('minuConversionFee') },
  { id: 'minuAccountFee', re: bareId('minuAccountFee') },
  { id: 'setupMarkup', re: /\bsetupMarkup\b/ },
  { id: 'discountCorridorBase', re: /\bdiscountCorridorBase\b/ },
  { id: 'premisesHash', re: bareId('premisesHash') },
  { id: 'PREMISES_V15', re: /\bPREMISES_V15\b/ },
  { id: 'PREMISES_V16', re: /\bPREMISES_V16\b/ },
  { id: 'netMargin', re: bareId('netMargin') },
  { id: 'technicalMargin', re: bareId('technicalMargin') },
  { id: 'marginFloor', re: /\bmarginFloor\b/ },
  { id: 'marginTarget', re: /\bmarginTarget\b/ },
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

// Execução direta (node scripts/check-bundle.mjs). Guardada para o módulo ser importável por testes sem efeito
// colateral (o teste unitário importa FORBIDDEN/bareId e exercita os regex contra fixtures de string).
function main() {
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
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
