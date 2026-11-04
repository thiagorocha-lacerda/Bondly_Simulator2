import type { SessionUser } from '../hooks/useSession';

/**
 * Barra discreta de usuário no cabeçalho (§6): foto (se houver), nome/e-mail e botão Sair.
 * Sair navega para /auth/logout no BFF, que limpa o cookie de sessão e redireciona ao login.
 * Renderiza nada quando não há sessão conhecida (dev sem proxy), para não poluir a UI.
 */
export function UserMenu(props: { user: SessionUser | null }) {
  const { user } = props;
  if (!user) return null;
  const label = user.name ?? user.email;
  const initial = (user.name ?? user.email).charAt(0).toUpperCase();
  return (
    <div className="usermenu">
      {user.picture ? (
        <img className="useravatar" src={user.picture} alt="" referrerPolicy="no-referrer" width={28} height={28} />
      ) : (
        <span className="useravatar useravatar--fallback" aria-hidden="true">{initial}</span>
      )}
      <span className="userinfo">
        <span className="username" title={user.email}>{label}</span>
        <span className="useremail">{user.email}</span>
        {user.roleLabel && <span className="useremail">{user.roleLabel}</span>}
      </span>
      <a className="logoutbtn" href="/auth/logout" title="Encerrar a sessão neste aplicativo">Sair</a>
    </div>
  );
}
