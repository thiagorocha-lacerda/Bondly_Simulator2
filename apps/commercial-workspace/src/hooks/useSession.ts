import { useEffect, useState } from 'react';
import type { Role } from './roles';

/**
 * Identidade da sessão atual, lida do BFF em /api/me (§6). O frontend NÃO decide autorização —
 * quem entrega esta página já passou pelo proxy de borda. Isto é só para exibir nome/e-mail/foto
 * e o botão Sair. Em dev sem o proxy (Vite puro), /api/me responde 401/HTML e caímos em `null`,
 * então a UI simplesmente não mostra a barra de usuário — sem quebrar o simulador.
 */
export interface SessionUser {
  readonly email: string;
  readonly name: string | null;
  readonly picture: string | null;
  readonly domain: string;
  /** Perfil atribuído individualmente pelo admin (resolvido no servidor); null = autenticado sem perfil. */
  readonly role: Role | null;
  readonly roleLabel?: string | null;
  /** Ações permitidas ao perfil (para a UI refletir; o servidor continua sendo a fronteira). */
  readonly permissions?: readonly string[];
  /** true só se o servidor mantém o fluxo LEGADO (DEPRECATED) de código de perfil. */
  readonly legacyProfileCodes?: boolean;
}

export interface UseSession {
  readonly user: SessionUser | null;
  readonly loading: boolean;
  /** Desbloqueia um papel com o código (§7.2). Retorna true em sucesso e atualiza o user. */
  unlock: (role: 'business' | 'tech' | 'admin', code: string) => Promise<boolean>;
}

export function useSession(): UseSession {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refetch(): Promise<void> {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!r.ok) {
        setUser(null);
        return;
      }
      const ct = r.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        setUser(null);
        return;
      }
      setUser((await r.json()) as SessionUser);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    let alive = true;
    refetch().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const unlock = async (role: 'business' | 'tech' | 'admin', code: string): Promise<boolean> => {
    try {
      const r = await fetch('/api/profile/unlock', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ role, code }),
      });
      if (!r.ok) return false;
      await refetch();
      return true;
    } catch {
      return false;
    }
  };

  return { user, loading, unlock };
}
