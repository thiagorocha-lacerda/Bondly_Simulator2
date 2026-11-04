import { useState } from 'react';

/**
 * Tela de espera de perfil. Perfis são atribuídos INDIVIDUALMENTE por um Administrador; o formulário de
 * código abaixo é o fluxo LEGADO (DEPRECATED) e só aparece quando o servidor o mantém ligado
 * (`legacyEnabled`, vindo de /api/me.legacyProfileCodes).
 *
 * Tela de desbloqueio por código de perfil (§7.2) — 2º fator APÓS o Google SSO.
 *
 * Aparece quando há sessão Google válida mas ainda sem papel. O código é validado NO SERVIDOR
 * (POST /api/profile/unlock); aqui só coletamos. Nenhum dado confidencial é exibido antes do
 * desbloqueio (§8). Em dev sem BFF (user=null) esta tela não aparece — o App trata esse caso.
 */
export function ProfileGate(props: {
  email: string;
  onUnlock: (role: 'business' | 'tech' | 'admin', code: string) => Promise<boolean>;
  /** @deprecated fluxo legado de código; default true só por compatibilidade — o App passa o valor do servidor. */
  legacyEnabled?: boolean;
}) {
  const [role, setRole] = useState<'business' | 'tech'>('business');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    const ok = await props.onUnlock(role, code.trim());
    setBusy(false);
    if (!ok) {
      setError('Código inválido para este perfil. Verifique com o administrador.');
      setCode('');
    }
  }

  if (props.legacyEnabled === false) {
    return (
      <div className="wrap" style={{ maxWidth: 440, margin: '8vh auto' }}>
        <div className="panel">
          <div className="brand" style={{ marginBottom: 8 }}>
            BONDLY <span>· COMMERCIAL WORKSPACE</span>
          </div>
          <h2>Aguardando atribuição de perfil</h2>
          <p className="sub" role="status">
            Autenticado como <b>{props.email}</b>, mas ainda sem perfil. Peça a um Administrador para
            atribuir seu perfil (Negócios, Projetos &amp; Tecnologia, Gestor/Aprovador ou Administrador).
          </p>
          <a className="cta" href="/auth/logout">Sair</a>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap" style={{ maxWidth: 440, margin: '8vh auto' }}>
      <div className="panel">
        <div className="brand" style={{ marginBottom: 8 }}>
          BONDLY <span>· COMMERCIAL WORKSPACE</span>
        </div>
        <h2>Desbloqueio de perfil</h2>
        <p className="sub">
          Autenticado como <b>{props.email}</b>. Informe o código do seu perfil para liberar a visão
          correspondente. O código é validado no servidor e não substitui sua identidade.
        </p>
        <form onSubmit={submit}>
          <div className="field full">
            <label>Perfil</label>
            <div className="toggle" role="group" aria-label="Perfil">
              <button type="button" aria-pressed={role === 'business'} onClick={() => setRole('business')}>
                Negócios
              </button>
              <button type="button" aria-pressed={role === 'tech'} onClick={() => setRole('tech')}>
                Projetos & Tecnologia
              </button>
            </div>
          </div>
          <div className="field full">
            <label htmlFor="profile-code">Código de acesso</label>
            <input
              id="profile-code"
              type="password"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'profile-code-error' : undefined}
            />
            {error && (
              <small id="profile-code-error" role="alert" style={{ color: 'var(--error)' }}>
                {error}
              </small>
            )}
          </div>
          <button className="cta" type="submit" disabled={busy || !code.trim()}>
            {busy ? 'Validando…' : 'Desbloquear perfil'}
          </button>
        </form>
      </div>
    </div>
  );
}
