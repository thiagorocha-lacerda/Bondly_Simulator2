/**
 * Guard de caminho estático (n2) — módulo PURO, sem dependência de config/IO, para teste direto.
 *
 * Resolve o caminho de um pedido estático DENTRO de `staticDir`, barrando:
 *  - path traversal (`../`) para fora da raiz;
 *  - casamento de diretório IRMÃO por prefixo (ex.: raiz `/srv/dist` vs `/srv/dist-x`),
 *    usando separador final no comparador.
 *
 * Retorna `{ ok:false }` quando o caminho escaparia da raiz; senão `{ ok:true, filePath, rel }`.
 * O próprio `staticDir` (pedido da raiz) é permitido.
 */
import { join, normalize, sep } from 'node:path';

export type StaticResolution =
  | { ok: true; filePath: string; rel: string }
  | { ok: false };

export function resolveStaticPath(staticDir: string, urlPath: string): StaticResolution {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = join(staticDir, rel);
  const staticRoot = staticDir.endsWith(sep) ? staticDir : staticDir + sep;
  if (filePath !== staticDir && !filePath.startsWith(staticRoot)) {
    return { ok: false };
  }
  return { ok: true, filePath, rel };
}

/** G-020: o caminho (com ou sem barra inicial) está sob /assets/? Asset inexistente ⇒ 404, nunca o HTML do SPA. */
export function isAssetPath(rel: string): boolean {
  return rel.replace(/^[\\/]+/, '').toLowerCase().startsWith('assets/');
}
