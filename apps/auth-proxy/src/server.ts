/**
 * Servidor BFF / proxy de borda (Opção B).
 *
 * Responsabilidades:
 *  - rotas públicas: /login (tela), /healthz, /auth/login (inicia OAuth), /auth/callback
 *  - gate: QUALQUER outra rota exige sessão válida; sem ela → 302 /login (ou 401 em /api/*)
 *  - entrega protegida do SPA estático (dist) somente após sessão
 *
 * Limite honesto (§5): as regras de pricing seguem no bundle servido. Este proxy impede ACESSO
 * sem sessão; não cifra o conteúdo para quem já está autenticado. Mover cálculo/dados para o
 * servidor seria a Opção A.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { loadConfig, REDIRECT_PATH } from './config.js';
import { resolveStaticPath, isAssetPath } from './static-path.js';
import {
  SESSION_COOKIE,
  createSessionToken,
  verifySessionToken,
  sessionSetCookie,
  sessionClearCookie,
  readCookies,
  serializeFlowCookie,
  readFlowCookie,
  clearFlowCookie,
} from './session.js';
import { newAuthRequestState, buildAuthUrl, exchangeCode } from './oauth.js';
import { authorizeIdentity } from './authz.js';
import { renderLoginPage } from './login-page.js';
import { handleApi } from './api.js';
import { createRepository, RepositoryUnavailableError } from './sqliteRepository.js';
import { bootstrapAdmins } from './assignments.js';
import { healthStatus } from './health.js';
import { resolveEffectiveRole } from './assignments.js';
import { setLogPseudonymKey } from './securityLog.js';
import { checkCrossSite, checkJsonContentType, mayServeSpaBundle, isSourceMapPath, renderNoProfilePage, PROTECTED_ASSET_CACHE_CONTROL, PROTECTED_ASSET_VARY } from './httpGuards.js';
import { BodyTooLargeError, MAX_BODY_BYTES } from './limits.js';

let cfg: ReturnType<typeof loadConfig>;
try {
  cfg = loadConfig();
} catch (e) {
  // G-019: config inválida/segredo fraco ⇒ recusa boot (exit 1); log sem valor de segredo.
  console.error(JSON.stringify({ evt: 'boot_refused_config', msg: (e as Error).message }));
  process.exit(1);
}
let repo: Awaited<ReturnType<typeof createRepository>>['repo'];
let repoBackend: Awaited<ReturnType<typeof createRepository>>['backend'];
try {
  ({ repo, backend: repoBackend } = await createRepository());
} catch (e) {
  // G-003: fail-closed em produção — sem segredos no log, saída não-zero.
  if (e instanceof RepositoryUnavailableError) {
    console.error(JSON.stringify({ evt: 'boot_refused_ephemeral_repo', code: e.code }));
  } else {
    console.error(JSON.stringify({ evt: 'boot_failed', msg: (e as Error).message }));
  }
  process.exit(1);
}
// G-003: memória-em-produção só chega aqui via ALLOW_EPHEMERAL_REPO=true (opt-in já logado como warn).
setLogPseudonymKey(cfg.sessionSecret); // G-014
const allowEphemeralRepo = (process.env.ALLOW_EPHEMERAL_REPO ?? '').trim().toLowerCase() === 'true';
if (cfg.bootstrapAdminRejected.length > 0) {
  // não loga os e-mails (PII): só a contagem
  console.warn(JSON.stringify({ evt: 'bootstrap_admin_rejected', count: cfg.bootstrapAdminRejected.length }));
}
const bootstrapped = await bootstrapAdmins(repo, cfg.bootstrapAdminEmails);
if (bootstrapped.length > 0) console.info(JSON.stringify({ evt: 'bootstrap_admin_created', count: bootstrapped.length }));
if (cfg.legacyProfileCodes) console.warn(JSON.stringify({ evt: 'legacy_profile_codes_enabled', deprecated: true, ackInsecure: cfg.legacyProfileCodesAckInsecure }));
// G-008: em produção a flag legada é RECUSADA (inseguro por design) salvo ack explícito.
if (cfg.legacyProfileCodesRefused) console.error(JSON.stringify({ evt: 'legacy_profile_codes_refused', reason: 'production_without_ack', hint: 'LEGACY_PROFILE_CODES_ACK_INSECURE=true para forçar (NÃO recomendado)' }));
// G-008: sem nenhum admin (nem bootstrap) em produção ninguém administra perfis — alerta operacional.
if (cfg.isProd && cfg.bootstrapAdminEmails.length === 0 && !(await repo.listAssignments()).some((a) => a.role === 'admin')) {
  console.warn(JSON.stringify({ evt: 'no_admin_configured', hint: 'defina BOOTSTRAP_ADMIN_EMAILS (domínio autorizado) para criar o primeiro admin' }));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function securityHeaders(res: ServerResponse, isHtml: boolean): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (isHtml) {
    // páginas privadas nunca em cache compartilhado (§8)
    res.setHeader('Cache-Control', 'no-store');
  }
}

function redirect(res: ServerResponse, location: string, cookies: string[] = []): void {
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.writeHead(302, { Location: location });
  res.end();
}

function send(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8', cookies: string[] = []): void {
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

const INVALID_JSON = Symbol('invalid_json');

/** Lê e parseia o corpo JSON da requisição (bounded a 256 KB). Retorna null em corpo vazio/ inválido. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return null;
  const MAX = MAX_BODY_BYTES;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX) throw new BodyTooLargeError(); // G-005: vira 413, nunca 500
    chunks.push(buf);
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return INVALID_JSON;
  }
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  // G-001: sourcemaps nunca são servidos (e o build de produção também não os gera)
  if (isSourceMapPath(urlPath)) {
    send(res, 404, 'not found');
    return;
  }
  // guard puro (n2): barra traversal e casamento de diretório irmão — testado em static-path.test.ts
  const resolved = resolveStaticPath(cfg.staticDir, urlPath);
  if (!resolved.ok) {
    send(res, 403, 'forbidden');
    return;
  }
  let { filePath } = resolved;
  const { rel } = resolved;
  let isHtmlFallback = false;
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) {
      filePath = join(filePath, 'index.html');
    }
  } catch {
    // SPA fallback: rota sem arquivo → index.html (mas preserva /assets/* como 404 real)
    // G-020: `rel` vem com barra inicial ('/assets/x.js'); normaliza antes de comparar.
    if (isAssetPath(rel)) {
      send(res, 404, 'not found');
      return;
    }
    filePath = join(cfg.staticDir, 'index.html');
    isHtmlFallback = true;
  }
  try {
    const data = await readFile(filePath);
    const ext = isHtmlFallback ? '.html' : extname(filePath);
    const isHtml = ext === '.html';
    securityHeaders(res, isHtml);
    // G-016: tudo que sai atrás do gate de perfil é privado e não cacheável por CDN/ALB (Vary: Cookie).
    res.setHeader('Cache-Control', PROTECTED_ASSET_CACHE_CONTROL);
    res.setHeader('Vary', PROTECTED_ASSET_VARY);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    send(res, 404, 'not found');
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', cfg.publicUrl || `http://${req.headers.host}`);
  const path = url.pathname;
  const cookies = readCookies(req.headers.cookie);
  const session = verifySessionToken(cookies[SESSION_COOKIE], cfg.sessionSecret);

  // --- rotas públicas ---
  if (path === '/healthz') {
    const h = healthStatus({ backend: repoBackend, isProd: cfg.isProd, allowEphemeral: allowEphemeralRepo });
    res.setHeader('Cache-Control', 'no-store');
    send(res, h.status, JSON.stringify(h.body), 'application/json; charset=utf-8');
    return;
  }

  if (path === '/login') {
    if (session) return redirect(res, '/');
    const err = url.searchParams.get('error');
    securityHeaders(res, true);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderLoginPage(err));
    return;
  }

  if (path === '/auth/login') {
    const reqState = newAuthRequestState();
    const flow = serializeFlowCookie(
      { state: reqState.state, nonce: reqState.nonce, verifier: reqState.pkce.verifier, returnTo: url.searchParams.get('returnTo') ?? '/' },
      cfg.sessionSecret,
      cfg.isProd,
    );
    redirect(res, buildAuthUrl(cfg, reqState), [flow]);
    return;
  }

  if (path === REDIRECT_PATH) {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthErr = url.searchParams.get('error');
    const flow = readFlowCookie(cookies, cfg.sessionSecret);
    if (oauthErr) return redirect(res, '/login?error=cancelled', [clearFlowCookie(cfg.isProd)]);
    if (!code || !state || !flow || state !== flow.state) {
      return redirect(res, '/login?error=state', [clearFlowCookie(cfg.isProd)]);
    }
    try {
      const payload = await exchangeCode(cfg, code, flow.verifier, flow.nonce);
      const authz = authorizeIdentity({ email: payload.email, email_verified: payload.email_verified });
      if (!authz.ok) {
        console.warn(JSON.stringify({ evt: 'login_denied', reason: authz.reason, domain_hint: payload.hd ?? null }));
        return redirect(res, '/login?error=unauthorized', [clearFlowCookie(cfg.isProd)]);
      }
      const token = createSessionToken(
        { email: authz.email, name: payload.name, picture: payload.picture, domain: authz.domain },
        cfg.sessionSecret,
      );
      console.info(JSON.stringify({ evt: 'login_ok', domain: authz.domain }));
      const returnTo = flow.returnTo && flow.returnTo.startsWith('/') && !flow.returnTo.startsWith('//') ? flow.returnTo : '/';
      return redirect(res, returnTo, [sessionSetCookie(token, cfg.isProd), clearFlowCookie(cfg.isProd)]);
    } catch (e) {
      console.error(JSON.stringify({ evt: 'login_error', msg: (e as Error).message }));
      return redirect(res, '/login?error=provider', [clearFlowCookie(cfg.isProd)]);
    }
  }

  if (path === '/auth/logout') {
    if (session) console.info(JSON.stringify({ evt: 'logout', domain: session.domain }));
    return redirect(res, '/login', [sessionClearCookie(cfg.isProd)]);
  }

  // --- a partir daqui, tudo exige sessão ---
  if (!session) {
    if (path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      send(res, 401, JSON.stringify({ error: 'unauthenticated' }), 'application/json; charset=utf-8');
      return;
    }
    const returnTo = encodeURIComponent(path + url.search);
    return redirect(res, `/login?returnTo=${returnTo}`);
  }

  // --- API /api/* (RBAC + payloads filtrados por papel), delegada ao handler puro ---
  if (path.startsWith('/api/')) {
    // G-009: cabeçalhos em TODA resposta /api/*
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const jsonErr = (status: number, error: string): void => send(res, status, JSON.stringify({ error }), 'application/json; charset=utf-8');
    const xs = checkCrossSite({ method: req.method ?? 'GET', headers: req.headers, publicUrl: cfg.publicUrl });
    if (!xs.ok) return jsonErr(xs.status, xs.error);
    const ct = checkJsonContentType({ method: req.method ?? 'GET', headers: req.headers });
    if (!ct.ok) return jsonErr(ct.status, ct.error);
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      if (e instanceof BodyTooLargeError) return jsonErr(413, 'payload_too_large');
      throw e;
    }
    if (body === INVALID_JSON) return jsonErr(400, 'invalid_json');
    const result = await handleApi({ method: req.method ?? 'GET', path, session, body, repo, cfg });
    const cookies: string[] = [];
    if (result.session) {
      // ex.: /api/profile/unlock elevou o papel → reemite o cookie de sessão assinado
      cookies.push(sessionSetCookie(createSessionToken(result.session, cfg.sessionSecret), cfg.isProd));
    }
    if (result.headers) for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
    const payload = result.body === undefined ? '' : JSON.stringify(result.body);
    send(res, result.status, payload, 'application/json; charset=utf-8', cookies);
    return;
  }

  // G-001 (parcial): o bundle do SPA só vai a quem tem perfil atribuído; sem perfil ⇒ tela mínima sem bundle.
  const eff = await resolveEffectiveRole(session, repo, cfg);
  if (!mayServeSpaBundle(eff !== null, cfg.legacyProfileCodes)) {
    securityHeaders(res, true);
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderNoProfilePage());
    return;
  }
  await serveStatic(res, path === '/' ? '/index.html' : path);
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(JSON.stringify({ evt: 'unhandled', msg: (e as Error).message }));
    if (!res.headersSent) send(res, 500, 'internal error');
  });
});

server.listen(cfg.port, () => {
  console.info(JSON.stringify({ evt: 'listening', port: cfg.port, prod: cfg.isProd, publicUrl: cfg.publicUrl, repo: repoBackend }));
});
