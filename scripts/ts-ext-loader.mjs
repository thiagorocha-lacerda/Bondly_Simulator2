// Loader de resolução DEV-ONLY para scripts/gen-sample-pdfs.mjs.
//
// O gerador de PDF real (apps/commercial-workspace/src/services/pdf.ts) usa imports extensionless
// (`./defaults`, `./pricing/quoteTypes`, `../assets/logo`) que o VITE resolve no app, mas o Node ESM
// não. Este hook só preenche a extensão que falta (.ts / .js), para exercitar o `generateQuotePdf`
// EXATAMENTE como escrito, sem tocar no pdf.ts. Não altera lógica de produto — é só resolução de path.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();
    for (const ext of ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js']) {
      const candidate = resolvePath(base, specifier + ext);
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
