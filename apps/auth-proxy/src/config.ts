/**
 * Configuração do servidor a partir do ambiente (§7). Validada no boot: faltando um segredo
 * obrigatório em produção, o processo recusa subir (fail-fast) em vez de rodar inseguro.
 */

import type { ProfileCodeHashes } from './profileCodes.js';
import { loadProfileCodeHashes } from './profileCodes.js';
import { parseBootstrapAdminEmails } from './assignments.js';
import { isProductionEnv } from './envMode.js';

export interface ServerConfig {
  readonly port: number;
  readonly isProd: boolean;
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly sessionSecret: string;
  /** Base URL pública (ex.: https://bondly-simulator.onrender.com), usada no redirect_uri. */
  readonly publicUrl: string;
  /** Diretório com o dist do SPA a servir. */
  readonly staticDir: string;
  /** Hashes dos códigos de perfil (2º fator §7.2); vazio = papel inatingível por código. */
  readonly profileCodeHashes: ProfileCodeHashes;
  /**
   * @deprecated Habilita o fluxo LEGADO de código de perfil compartilhado (/api/profile/unlock).
   * Default FALSE. Nunca concede `approver`. Existe só por compatibilidade.
   */
  readonly legacyProfileCodes: boolean;
  /**
   * G-001-A/G-026: PRICING_GUARD_STRICT=true ⇒ proposta cujos inputs persistidos NÃO são um PricingInput completo
   * também é bloqueada na consolidação/emissão (fail-closed). Default false até a Fase 3 (o cliente atual grava `{}`).
   */
  readonly pricingGuardStrict?: boolean;
  /** G-008: LEGACY_PROFILE_CODES=true foi pedido em produção SEM ack explícito ⇒ recusado (legacyProfileCodes=false). */
  readonly legacyProfileCodesRefused: boolean;
  /** G-008: produção com LEGACY_PROFILE_CODES=true + LEGACY_PROFILE_CODES_ACK_INSECURE=true (inseguro por design; warn no boot). */
  readonly legacyProfileCodesAckInsecure: boolean;
  /** E-mails (domínio autorizado) promovidos a admin SE ainda não existir admin. Sem segredo. */
  readonly bootstrapAdminEmails: readonly string[];
  /** Entradas de BOOTSTRAP_ADMIN_EMAILS descartadas por domínio não autorizado/malformadas (para log). */
  readonly bootstrapAdminRejected: readonly string[];
}

function required(name: string, value: string | undefined, isProd: boolean, devFallback?: string): string {
  if (value && value.length > 0) return value;
  if (!isProd && devFallback !== undefined) return devFallback;
  throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
}

/** G-019: defaults de dev usados como segredo — públicos no repositório, NUNCA aceitos em produção. */
export const DEV_SESSION_SECRET = 'dev-session-secret-not-for-production-use';
export const DEV_CLIENT_SECRET = 'dev-client-secret';
export const MIN_SESSION_SECRET_LENGTH = 32;

/**
 * G-032: entropia MÍNIMA estimada do segredo, em bits. Trocamos a regra antiga de "16 caracteres distintos"
 * (que rejeitava `openssl rand -hex 16` — alfabeto hex só tem 16 símbolos possíveis, logo ≤16 distintos) por
 * uma estimativa de força: bits ≈ comprimento × log2(tamanho do alfabeto observado). 128 bits é o piso de um
 * segredo criptográfico moderno. `openssl rand -hex 16` (32 chars, alfabeto 16) = 32×4 = 128 bits ✓;
 * `-hex 32` = 256 ✓; base64url de 48 bytes (64 chars, alfabeto 64) = 384 ✓. Sequências/dicionário continuam
 * recusados por verificações próprias (não por entropia). `'x'*40` e `32×'a'` têm alfabeto 1 ⇒ 0 bits ✗.
 */
export const MIN_ESTIMATED_SECRET_BITS = 128;
/**
 * G-032: entropia de Shannon empírica mínima (bits/caractere) — backstop FRACO contra baixa variação.
 * Rebaixada de 3,5 para 2,5: um `openssl rand -hex 16` uniforme pode cair a ~3,0 bits/char observados (só
 * 16 símbolos possíveis, ~11–14 aparecendo), então 3,5 rejeitaria hex legítimo. O piso de força real agora é
 * `estimatedSecretBits >= 128`; o Shannon só derruba cadeias de pouquíssima variação que escapem das demais.
 */
export const MIN_SHANNON_BITS_PER_CHAR = 2.5;
/** Run ordenado (alfabeto/dígitos/linha de teclado, crescente ou decrescente) a partir do qual o segredo é recusado. */
export const MAX_SEQUENTIAL_RUN = 5;
const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];
const WEAK_WORDS = ['password', 'passw0rd', 'secret', 'changeme', 'letmein', 'qwerty', 'admin', 'welcome'];

export function shannonBitsPerChar(value: string): number {
  const freq = new Map<string, number>();
  for (const ch of value) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  const n = [...value].length;
  let h = 0;
  for (const c of freq.values()) h -= (c / n) * Math.log2(c / n);
  return h;
}

/**
 * G-032: tamanho do alfabeto-FONTE (classe de caracteres), não a contagem de símbolos distintos observados.
 * Um `openssl rand -hex 16` (32 chars) usa a classe hex (16 símbolos possíveis); por acaso só ~11–14 aparecem
 * de fato, então contar distintos SUBESTIMA a entropia e rejeitaria segredos hex válidos. A força de um segredo
 * aleatório é length × log2(alfabeto-fonte), e o alfabeto-fonte é inferido pelas classes de caractere presentes.
 */
function sourceAlphabetSize(value: string): number {
  let size = 0;
  if (/[0-9]/.test(value)) size += 10;
  if (/[a-f]/.test(value) && !/[g-z]/.test(value) && !/[A-Z]/.test(value) && !/[^0-9a-f._~+/=-]/.test(value)) {
    // parece hexadecimal puro (dígitos + a–f): a classe hex tem 16 símbolos, não 10+6 genéricos.
    return 16;
  }
  if (/[a-z]/.test(value)) size += 26;
  if (/[A-Z]/.test(value)) size += 26;
  // símbolos base64url/base64 e pontuação comum de segredos.
  if (/[^0-9A-Za-z]/.test(value)) size += 16;
  return Math.max(size, new Set(value).size);
}

/**
 * G-032: bits de força ESTIMADOS ≈ comprimento × log2(alfabeto-fonte). Não é a entropia real do gerador
 * (desconhecida aqui), mas uma estimativa que aceita segredos aleatórios de alfabeto pequeno (hex) e rejeita
 * cadeias curtas/pobres. Sequências e dicionário são tratados por verificações próprias.
 */
export function estimatedSecretBits(value: string): number {
  const alphabet = sourceAlphabetSize(value);
  if (alphabet <= 1) return 0;
  return [...value].length * Math.log2(alphabet);
}

/** Maior sequência de caracteres consecutivos (código ±1, ou vizinhos numa linha de teclado) em qualquer direção. */
function longestOrderedRun(value: string): number {
  const v = value.toLowerCase();
  let best = 1;
  let up = 1;
  let down = 1;
  for (let i = 1; i < v.length; i++) {
    const d = v.charCodeAt(i) - v.charCodeAt(i - 1);
    up = d === 1 ? up + 1 : 1;
    down = d === -1 ? down + 1 : 1;
    best = Math.max(best, up, down);
  }
  for (const row of KEYBOARD_ROWS) {
    for (const r of [row, [...row].reverse().join('')]) {
      for (let len = r.length; len > best; len--) {
        for (let i = 0; i + len <= r.length; i++) if (v.includes(r.slice(i, i + len))) { best = len; break; }
      }
    }
  }
  return best;
}

/**
 * G-019/G-030/G-032: motivo da recusa de um segredo fraco (ou null se aceitável). Nunca inclui o valor.
 * Recusa: valor de dev público, < 32 chars, padrão repetido ('abab…'), sequência ordenada
 * (alfabeto/dígitos/teclado) > 5, palavras fracas conhecidas, entropia de Shannon < 3,5 bits/char e
 * força estimada (comprimento × log2(alfabeto)) < 128 bits. A ordem põe os padrões ESTRUTURAIS antes da
 * entropia para que 'x'*40 / 32×'a' / 'abcdefgh…' sejam recusados pelo motivo mais específico.
 */
export function weakSecretReason(value: string, devDefaults: readonly string[] = [DEV_SESSION_SECRET, DEV_CLIENT_SECRET]): string | null {
  if (devDefaults.includes(value)) return 'dev_default';
  if (value.length < MIN_SESSION_SECRET_LENGTH) return 'too_short';
  // Padrão periódico (unidade de até 16 chars repetida): pega 'abab…', 'abcd1234'×, 'a1b2c3…'×, 'abc123ABC!'×.
  // G-032: ampliado de 8 p/ 16 porque, ao trocar o piso de "16 distintos" por força estimada, cadeias
  // visivelmente periódicas de período 9–16 passariam na entropia estimada; o período as recusa com precisão
  // (zero falso-positivo em hex/base64 aleatórios — verificado). Independe do alfabeto, então não penaliza hex.
  for (let n = 1; n <= 16; n++) {
    const unit = value.slice(0, n);
    if (unit.length < value.length && unit.repeat(Math.ceil(value.length / n)).slice(0, value.length) === value) return 'trivial_entropy';
  }
  if (longestOrderedRun(value) > MAX_SEQUENTIAL_RUN) return 'sequential_pattern';
  const lower = value.toLowerCase();
  if (WEAK_WORDS.some((w) => lower.includes(w))) return 'dictionary_word';
  if (shannonBitsPerChar(value) < MIN_SHANNON_BITS_PER_CHAR) return 'low_entropy';
  if (estimatedSecretBits(value) < MIN_ESTIMATED_SECRET_BITS) return 'low_entropy';
  return null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const isProd = isProductionEnv(env); // G-013: allowlist {development,test}; resto = produção
  const port = Number(env.PORT ?? 10000);
  const publicUrl = (env.PUBLIC_URL ?? (isProd ? '' : `http://127.0.0.1:${port}`)).replace(/\/$/, '');
  if (isProd && !publicUrl) throw new Error('Variável de ambiente obrigatória ausente: PUBLIC_URL');

  if (isProd) {
    // G-019: fail-closed; a mensagem cita só o NOME da variável e o motivo, nunca o valor.
    const sr = weakSecretReason(env.SESSION_SECRET ?? '');
    if (env.SESSION_SECRET && sr) throw new Error(`weak_secret: SESSION_SECRET (${sr})`);
    if (env.GOOGLE_CLIENT_SECRET === DEV_CLIENT_SECRET) throw new Error('weak_secret: GOOGLE_CLIENT_SECRET (dev_default)');
  }

  const bootstrap = parseBootstrapAdminEmails(env.BOOTSTRAP_ADMIN_EMAILS);
  const flag = (v: string | undefined): boolean => (v ?? '').trim().toLowerCase() === 'true';
  // G-008: fluxo legado (código compartilhado) é INSEGURO por design; em produção só com ack explícito.
  const legacyRequested = flag(env.LEGACY_PROFILE_CODES);
  const legacyAck = flag(env.LEGACY_PROFILE_CODES_ACK_INSECURE);
  const legacyRefused = legacyRequested && isProd && !legacyAck;

  return {
    port,
    isProd,
    googleClientId: required('GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID, isProd, 'dev-client-id.apps.googleusercontent.com'),
    googleClientSecret: required('GOOGLE_CLIENT_SECRET', env.GOOGLE_CLIENT_SECRET, isProd, DEV_CLIENT_SECRET),
    sessionSecret: required('SESSION_SECRET', env.SESSION_SECRET, isProd, DEV_SESSION_SECRET),
    publicUrl,
    staticDir: env.STATIC_DIR ?? new URL('../../commercial-workspace/dist', import.meta.url).pathname,
    profileCodeHashes: loadProfileCodeHashes(env),
    pricingGuardStrict: (env.PRICING_GUARD_STRICT ?? '').trim().toLowerCase() === 'true',
    legacyProfileCodes: legacyRequested && !legacyRefused,
    legacyProfileCodesRefused: legacyRefused,
    legacyProfileCodesAckInsecure: legacyRequested && isProd && legacyAck,
    bootstrapAdminEmails: bootstrap.valid,
    bootstrapAdminRejected: bootstrap.rejected,
  };
}

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const REDIRECT_PATH = '/auth/callback';
