# Autenticação, autorização e segurança — Bondly Commercial Workspace

**Escopo:** área logada obrigatória, login exclusivo via Google, autorização estrita por domínio,
proteção de borda. Entregue como **Opção B** (login Google + proxy de borda), preservando o deploy
na **Render**.

## 1. Arquitetura

A aplicação deixou de ser Static Site e passou a ser um **Web Service Node** — o pacote
`@bondly/auth-proxy` — que fica na frente do SPA:

```
Navegador ──HTTPS──> [ @bondly/auth-proxy (Render Web Service) ]
                        │  rotas públicas:  /login  /healthz  /auth/login  /auth/callback
                        │  gate de sessão:  qualquer outra rota exige cookie de sessão válido
                        │                    sem sessão → 302 /login  (ou 401 em /api/*)
                        └─ com sessão ──────> serve apps/commercial-workspace/dist (o SPA)
                                              + GET /api/me (identidade da sessão)
```

Fluxo de login: **OpenID Connect / OAuth 2.0 Authorization Code + PKCE**.

1. `/auth/login` gera `state`, `nonce` e um par PKCE (`verifier`/`challenge S256`), grava-os num
   **cookie de fluxo assinado** (HttpOnly, SameSite=Lax, 10 min) e redireciona ao Google.
2. Google autentica e volta a `/auth/callback?code&state`.
3. O servidor confere o `state` contra o cookie de fluxo, troca o `code` por tokens (enviando o
   `code_verifier`), e **verifica o ID token criptograficamente** com a `google-auth-library`
   (`verifyIdToken`: assinatura via chaves públicas do Google, `iss`, `aud`, `exp`). Confere o `nonce`.
4. Autoriza por domínio (ver §2). Em sucesso, cria a **sessão** (cookie assinado HMAC, HttpOnly,
   Secure em produção, SameSite=Lax, 8 h) e redireciona ao `returnTo` original.

Nenhum token do Google fica no navegador. O cookie de sessão carrega só a identidade mínima já
autorizada (e-mail, nome, foto, domínio, expiração), assinada — não é alterável no cliente.

## 2. Autorização estrita por domínio (`src/authz.ts`)

Domínios permitidos (correspondência **exata**, após o último `@`, normalizado para minúsculas):

`minu.co` · `minutrade.com` · `grupoarka.co` · `brain3.com.br` · `coremidia.co`

Regras aplicadas sobre claims **já verificadas**:

- `email_verified === true` (boolean estrito — não aceita `"true"`, `1`, truthy).
- e-mail presente e bem-formado.
- domínio = parte após o **último** `@`, em minúsculas, igual por **string** a um dos permitidos.

**Recusa explícita de bypass** (testado): `usuario@minu.co.evil.com`, `usuario@sub.minu.co`,
`usuario@minu.co.br`, `usuario@minu.com`, domínio como local-part (`minu.co@gmail.com`), espaços,
e qualquer correspondência parcial/`endsWith`/`includes`. A decisão é feita **no servidor**; o
parâmetro `hd` do Google é tratado só como dica de UX, nunca como prova de autorização.

> Nota (§4): o domínio verificado comprova controle do endereço, não vínculo individual. Se a
> política exigir allowlist por pessoa/grupo, acrescente-a **sem** afrouxar a restrição por domínio.

## 3. Segurança aplicada

| Vetor | Mitigação |
|---|---|
| CSRF no fluxo OAuth | `state` ancorado em cookie de fluxo assinado; conferido no callback |
| Replay de ID token | `nonce` gerado e conferido; ID token verificado por assinatura |
| Interceptação do code | PKCE S256 (`code_verifier` nunca trafega na URL) |
| Adulteração de sessão | cookie assinado HMAC-SHA256; comparação em tempo constante |
| Roubo de cookie | `HttpOnly` (sem acesso por JS), `Secure` em produção, `SameSite=Lax` |
| Open redirect | `returnTo` só aceita caminho interno começando por `/` e não `//` |
| Cache de conteúdo privado | HTML servido com `Cache-Control: no-store`; assets com hash imutáveis |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` |
| Path traversal nos assets | caminho normalizado e confinado ao `STATIC_DIR` |
| 401 vs 403 | sem sessão → 401/redirect; a negação por domínio é tratada no callback com mensagem genérica |

Logs de segurança emitidos (sem tokens nem PII desnecessária): `login_ok` (só domínio),
`login_denied` (motivo + dica de domínio), `logout`, `login_error`.

## 4. Limitações conhecidas — leia (§5/§11)

Esta é a **Opção B**. Ela entrega proteção **de acesso** real: sem sessão válida, o navegador não
baixa o SPA nem alcança `/api/*`. Isso é muito mais forte que uma tela de login só no React.

**Porém**, as regras de precificação e os dados continuam no **bundle entregue ao cliente
autorizado**. O proxy barra quem *não* tem sessão; ele **não cifra** o conteúdo para quem *já*
entrou. Em outras palavras: um usuário autorizado consegue, tecnicamente, ler as fórmulas no JS
que recebeu. Isso é aceitável se o modelo de ameaça é "manter fora quem não é da equipe"; **não é**
aceitável se o objetivo for esconder as fórmulas **dos próprios usuários autorizados**.

Para esse nível mais forte, é preciso a **Opção A**: mover cálculo e dados sensíveis para
endpoints protegidos no servidor, deixando no cliente apenas entradas e resultados. O engine já é
independente de framework, então essa evolução é direta quando/se for priorizada.

## 5. Guia do Google Cloud Console (passo a passo)

Depende de acesso ao Google Cloud — **não suposto aqui**. Execute quem tiver a conta:

1. **Console → APIs & Services → OAuth consent screen**: tipo **Internal** se todos os domínios
   estiverem sob a mesma organização Workspace; senão **External**. Preencha nome do app, e-mail de
   suporte e domínios autorizados. Escopos: `openid`, `email`, `profile`.
2. **Credentials → Create Credentials → OAuth client ID → Application type: Web application**.
3. **Authorized JavaScript origins**:
   - produção: `https://SEU-SERVICO.onrender.com` (e o domínio personalizado, se houver)
   - dev: `http://127.0.0.1:8799`
4. **Authorized redirect URIs**:
   - produção: `https://SEU-SERVICO.onrender.com/auth/callback`
   - dev: `http://127.0.0.1:8799/auth/callback`
5. Copie **Client ID** e **Client secret** para as variáveis `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` (nunca commitar).

## 6. Deploy na Render (Opção B)

O `render.yaml` já descreve o Web Service. Configuração real a confirmar no painel:

| Campo | Valor |
|---|---|
| Tipo | **Web Service** (`runtime: node`) |
| Build | `npm ci && npm run build --workspace @bondly/commercial-workspace && npm run build --workspace @bondly/auth-proxy` |
| Start | `npm run start --workspace @bondly/auth-proxy` |
| Health check | `/healthz` |
| Secrets (Environment) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (sync:false), `SESSION_SECRET` (generateValue) |
| Vars | `NODE_ENV=production`, `NODE_VERSION=22`, `STATIC_DIR`, `PUBLIC_URL` (a URL real pós-primeiro deploy) |

### Checklist de publicação

- [ ] Criar o OAuth Client no Google Cloud (§5) com as origens/redirects reais.
- [ ] No painel Render, converter/criar o serviço como **Web Service** a partir do Blueprint.
- [ ] Preencher `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; deixar `SESSION_SECRET` gerado.
- [ ] Após o 1º deploy, setar `PUBLIC_URL` com o host `*.onrender.com` e **redeploy**.
- [ ] Conferir `redirect_uri` do Google == `PUBLIC_URL + /auth/callback` (erro comum: divergência).
- [ ] Testar na URL real: acesso sem sessão redireciona ao login; conta de domínio permitido entra;
      conta externa/`gmail.com` é negada com a mensagem padrão; logout encerra a sessão.
- [ ] Confirmar que o simulador e os cálculos seguem idênticos após login (nada do engine mudou).

> **Não** declarar o deploy concluído sem verificação real do login na URL publicada (§7/§11).

## 7. Testes

- `@bondly/auth-proxy`: `authz.test.ts` (autorizados, negados, 10 bypasses), `session.test.ts`
  (round-trip, adulteração, expiração, segredo errado). Smoke de servidor validado manualmente:
  `/healthz` 200, `GET /` sem sessão → 302 `/login`, `/api/me` → 401, `/auth/login` → 302 Google
  com PKCE/state/nonce + cookie de fluxo HttpOnly.
- `@bondly/commercial-workspace`: `UserMenu.test.tsx` + a suíte existente (engine e UI intactos).
