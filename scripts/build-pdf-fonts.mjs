// Gera o módulo de fontes do PDF (apps/commercial-workspace/src/assets/pdfFonts.ts) a partir dos
// pacotes @fontsource (OFL/open). Decodifica os woff2 → TTF (via wawoff2, o descompressor woff2 oficial
// do Google em WASM) e serializa cada TTF em base64 para o VFS do jsPDF. O subset `latin` do @fontsource já
// cobre ASCII + acentos pt-BR (ç ã õ á é í ó ú â ê ô à) + º ª · – — R$ % . , : () — verificado por
// probe de cmap em scripts (não precisa mesclar latin-ext).
//
// Rodar quando as versões de @fontsource/space-grotesk | @fontsource/geist-mono mudarem:
//   node scripts/build-pdf-fonts.mjs
//
// Famílias (decisão do sponsor, docs/20 §2.2): Space Grotesk (títulos/corpo) + Geist Mono (números/eyebrows).
// Licença: SIL Open Font License 1.1 (ambas). Atribuição em apps/commercial-workspace/src/assets/OFL.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decompress } from 'wawoff2';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SG = join(ROOT, 'node_modules', '@fontsource', 'space-grotesk', 'files');
const GM = join(ROOT, 'node_modules', '@fontsource', 'geist-mono', 'files');
const OUT = join(ROOT, 'apps', 'commercial-workspace', 'src', 'assets', 'pdfFonts.ts');

/** woff2 (Buffer) → TTF base64. */
async function toBase64(file) {
  const ttf = await decompress(readFileSync(file)); // Uint8Array TTF
  return Buffer.from(ttf).toString('base64');
}

const specs = [
  { key: 'SPACE_GROTESK_REGULAR', file: join(SG, 'space-grotesk-latin-400-normal.woff2') },
  { key: 'SPACE_GROTESK_BOLD', file: join(SG, 'space-grotesk-latin-700-normal.woff2') },
  { key: 'GEIST_MONO_REGULAR', file: join(GM, 'geist-mono-latin-400-normal.woff2') },
  { key: 'GEIST_MONO_MEDIUM', file: join(GM, 'geist-mono-latin-500-normal.woff2') },
];

const parts = [];
for (const s of specs) {
  const b64 = await toBase64(s.file);
  parts.push({ key: s.key, b64, bytes: Math.floor((b64.length * 3) / 4) });
}

const header = `/**
 * Fontes do PDF da proposta — VFS do jsPDF (base64 TTF). GERADO por scripts/build-pdf-fonts.mjs.
 * NÃO EDITAR À MÃO. Famílias: Space Grotesk + Geist Mono (SIL OFL 1.1, open). Origem: @fontsource/*.
 * Subset latin (cobre pt-BR). Carregado SOB DEMANDA no caminho do PDF (DEV-gated via import() dinâmico
 * em pdf.ts), fora do bundle principal de produção.
 */
/* eslint-disable */
`;
const body = parts.map((p) => `// ${p.key}: ~${(p.bytes / 1024).toFixed(0)}KB TTF\nexport const ${p.key} = '${p.b64}';`).join('\n');
writeFileSync(OUT, header + body + '\n');

const total = parts.reduce((a, p) => a + p.bytes, 0);
console.log(`[build-pdf-fonts] OK → ${OUT}`);
for (const p of parts) console.log(`  ${p.key.padEnd(24)} ${(p.bytes / 1024).toFixed(0)}KB`);
console.log(`  total ~${(total / 1024).toFixed(0)}KB TTF (base64 ~${((total * 4) / 3 / 1024).toFixed(0)}KB no fonte .ts)`);
