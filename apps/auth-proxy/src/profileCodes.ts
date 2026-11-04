/**
 * @deprecated FLUXO LEGADO de código de perfil compartilhado — mantido só por compatibilidade atrás de
 * `LEGACY_PROFILE_CODES=true` (default FALSE). O brief do sponsor proíbe código/senha compartilhado como
 * substituto de Google OAuth + RBAC: o perfil agora vem de atribuição INDIVIDUAL por usuário (domain.ts).
 * Este caminho NUNCA concede `approver` e nunca habilita a gestão de atribuições.
 *
 * Segundo fator por perfil (prompt §7.2 / §7.3).
 *
 * Um código de desbloqueio por papel ELEVA a sessão (já autenticada por Google) ao papel. NÃO
 * substitui o SSO nem identidade individual (§7.2): a auditoria amarra sempre o papel ao e-mail.
 *
 * Armazenamento: só **hash** (nunca texto puro, nunca no bundle). §7.3 pede Argon2id; usamos scrypt
 * nativo (`node:crypto`, memory-hard, sal por código) atrás de `PasswordHasher` para não adicionar
 * dependência nativa — a troca por argon2 é trivial reimplementando a interface. Decisão de
 * algoritmo/parâmetros: PENDENTE de sign-off de segurança.
 *
 * Formato do hash: `scrypt$N$r$p$<salt b64url>$<derived b64url>`. Verificação em tempo constante.
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Role } from './rbac.js';

export interface PasswordHasher {
  hash(secret: string): string;
  verify(secret: string, stored: string): boolean;
}

// Parâmetros scrypt — custo adequado para um código de desbloqueio (não é senha de usuário final).
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export const scryptHasher: PasswordHasher = {
  hash(secret: string): string {
    const salt = randomBytes(16);
    const derived = scryptSync(secret, salt, KEYLEN, { N, r: R, p: P });
    return `scrypt$${N}$${R}$${P}$${b64url(salt)}$${b64url(derived)}`;
  },
  verify(secret: string, stored: string): boolean {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(parts[4]!, 'base64url');
      expected = Buffer.from(parts[5]!, 'base64url');
    } catch {
      return false;
    }
    let derived: Buffer;
    try {
      derived = scryptSync(secret, salt, expected.length, { N: n, r, p });
    } catch {
      return false;
    }
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  },
};

/**
 * Catálogo de códigos por papel: mapa papel → hash. Carregado do ambiente/arquivo seguro, nunca do
 * bundle. Um papel sem hash configurado é INATINGÍVEL pelo 2º fator (deny-by-default).
 */
export type LegacyUnlockRole = Exclude<Role, 'approver'>;
export type ProfileCodeHashes = Partial<Record<LegacyUnlockRole, string>>;

export type UnlockResult =
  | { readonly ok: true; readonly role: LegacyUnlockRole }
  | { readonly ok: false; readonly reason: 'unknown_role' | 'not_configured' | 'bad_code' };

/**
 * Valida um código de desbloqueio contra o hash do papel. PURO (hasher injetável para teste).
 * Deny-by-default: papel desconhecido ou sem hash configurado recusa; código errado recusa.
 */
export function verifyProfileCode(
  role: string,
  code: string,
  hashes: ProfileCodeHashes,
  hasher: PasswordHasher = scryptHasher,
): UnlockResult {
  if (role !== 'business' && role !== 'tech' && role !== 'admin') {
    return { ok: false, reason: 'unknown_role' };
  }
  const stored = hashes[role];
  if (!stored) return { ok: false, reason: 'not_configured' };
  if (typeof code !== 'string' || code.length === 0) return { ok: false, reason: 'bad_code' };
  return hasher.verify(code, stored) ? { ok: true, role } : { ok: false, reason: 'bad_code' };
}

/**
 * Carrega os hashes dos códigos a partir do ambiente. Cada um é OPCIONAL — um papel sem código
 * configurado simplesmente não pode ser desbloqueado. Os valores são HASHES (gerados por
 * `scryptHasher.hash`), nunca os códigos em texto puro.
 *   PROFILE_CODE_HASH_BUSINESS, PROFILE_CODE_HASH_TECH, PROFILE_CODE_HASH_ADMIN
 */
export function loadProfileCodeHashes(env: NodeJS.ProcessEnv = process.env): ProfileCodeHashes {
  const out: ProfileCodeHashes = {};
  if (env.PROFILE_CODE_HASH_BUSINESS) out.business = env.PROFILE_CODE_HASH_BUSINESS;
  if (env.PROFILE_CODE_HASH_TECH) out.tech = env.PROFILE_CODE_HASH_TECH;
  if (env.PROFILE_CODE_HASH_ADMIN) out.admin = env.PROFILE_CODE_HASH_ADMIN;
  return out;
}
