/**
 * Guardas HTTP puras para /api/* (G-009) e gate do bundle do SPA (G-001 parcial). Sem I/O.
 *
 * Escolha documentada (CSRF): além de SameSite=Lax+HttpOnly, métodos mutantes (POST/PUT/PATCH/DELETE)
 * em /api/* são checados por:
 *   1) Sec-Fetch-Site (enviado por todos os browsers atuais): só 'same-origin' (ou 'none' = ação direta
 *      do usuário) passa; 'cross-site' e 'same-site' (ex.: subdomínio irmão) são rejeitados;
 *   2) senão, Origin: precisa igualar a origem de PUBLIC_URL (ou, sem PUBLIC_URL, o Host da requisição);
 *   3) sem Sec-Fetch-Site e sem Origin ⇒ PERMITIDO. É cliente não-browser (curl/CLI/healthcheck): CSRF exige
 *      browser, e todo /api/* ainda exige o cookie de sessão HttpOnly. Trade-off aceito e documentado.
 */
import type { IncomingHttpHeaders } from 'node:http';
import { posix } from 'node:path';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function checkCrossSite(args: { method: string; headers: IncomingHttpHeaders; publicUrl: string }): GuardResult {
  const { method, headers, publicUrl } = args;
  if (!MUTATING.has(method.toUpperCase())) return { ok: true };
  const sfs = first(headers['sec-fetch-site'])?.toLowerCase();
  if (sfs !== undefined) {
    return sfs === 'same-origin' || sfs === 'none' ? { ok: true } : { ok: false, status: 403, error: 'cross_site_forbidden' };
  }
  const origin = first(headers.origin);
  if (origin === undefined) return { ok: true }; // ferramenta não-browser (ver cabeçalho)
  let expected: string | null = null;
  try {
    expected = publicUrl ? new URL(publicUrl).origin : `http://${first(headers.host) ?? ''}`;
  } catch {
    expected = null;
  }
  return expected !== null && origin === expected ? { ok: true } : { ok: false, status: 403, error: 'cross_site_forbidden' };
}

/** Corpo presente em método mutante exige Content-Type: application/json (415 caso contrário). */
export function checkJsonContentType(args: { method: string; headers: IncomingHttpHeaders }): GuardResult {
  const { method, headers } = args;
  if (!MUTATING.has(method.toUpperCase())) return { ok: true };
  const len = Number(first(headers['content-length']) ?? 0);
  const chunked = headers['transfer-encoding'] !== undefined;
  if (!(len > 0) && !chunked) return { ok: true }; // sem corpo
  const ct = (first(headers['content-type']) ?? '').split(';')[0]!.trim().toLowerCase();
  return ct === 'application/json' ? { ok: true } : { ok: false, status: 415, error: 'unsupported_media_type' };
}

/**
 * G-001 (parcial): o bundle do SPA (contém o motor/tabelas de custo) só é servido a quem tem perfil
 * atribuído. Exceção: LEGACY_PROFILE_CODES=true (o fluxo legado precisa da UI para o unlock).
 */
export function mayServeSpaBundle(hasRole: boolean, legacyProfileCodes: boolean): boolean {
  return hasRole || legacyProfileCodes;
}

/**
 * Sourcemaps nunca são servidos (G-001). G-015: avalia o caminho DECODIFICADO (inclusive %2E e duplo
 * encode, até estabilizar) e normalizado; byte nulo, decode inválido ou encode profundo demais ⇒ trata como
 * map (nega). Barra `.map` seguido de `/`, `\` ou espaços/pontos finais.
 */
export function isSourceMapPath(urlPath: string): boolean {
  let p = urlPath.split('?')[0] ?? '';
  for (let i = 0; i < 5; i++) {
    let d: string;
    try {
      d = decodeURIComponent(p);
    } catch {
      return true;
    }
    if (d === p) {
      if (p.includes('\0')) return true;
      return /\.map[\s./\\]*$/i.test(posix.normalize(p.replace(/\\/g, '/')));
    }
    p = d;
  }
  return true; // encode aninhado além do limite: suspeito
}

/** Tela mínima (sem bundle de negócio) para autenticado sem perfil. */
export function renderNoProfilePage(): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bondly — aguardando perfil</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>Aguardando atribuição de perfil</h1><p>Você está autenticado, mas ainda não há um perfil atribuído à sua conta. Peça a um administrador para atribuir seu perfil e depois recarregue esta página.</p><p><a href="/">Recarregar</a> · <a href="/auth/logout">Sair</a></p></body></html>`;
}

/**
 * G-016: cabeçalhos de cache para QUALQUER resposta do SPA atrás do gate de perfil. Nunca `public`/`immutable`:
 * CDN/proxy compartilhado serviria o bundle (motor/tabelas de custo) a quem não tem sessão/perfil.
 */
export const PROTECTED_ASSET_CACHE_CONTROL = 'private, no-store';
export const PROTECTED_ASSET_VARY = 'Cookie';
