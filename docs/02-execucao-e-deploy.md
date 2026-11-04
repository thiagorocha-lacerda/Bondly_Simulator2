# Execução, build e deploy — Bondly Commercial Platform

Monorepo npm workspaces. Node ≥ 22.

## Instalação

```bash
npm install
```

## Comandos

| Objetivo | Comando |
|---|---|
| Testes do motor (40) | `npm run test` |
| Typecheck de tudo | `npm run typecheck` |
| Dev do workspace | `npm run dev --workspace @bondly/commercial-workspace` → http://127.0.0.1:5173 |
| Build de produção | `npm run build --workspace @bondly/commercial-workspace` → `apps/commercial-workspace/dist/` |
| Preview do build | `npm run preview --workspace @bondly/commercial-workspace` → http://127.0.0.1:4173 |

O workspace resolve o Pricing Engine pela **fonte TypeScript** (alias Vite + tsconfig paths), então não
há passo de build intermediário do pacote em dev. A Render compila o mesmo source no build.

## Deploy na Render (§27 / Autenticação Opção B)

> **Mudança de modelo:** com a área logada (login Google + proxy de borda), o deploy deixou de ser
> **Static Site** e passou a ser um **Web Service Node** (`@bondly/auth-proxy`) que autentica e só
> então serve o SPA. Detalhes de OAuth, autorização por domínio, segurança, guia do Google Cloud e
> checklist de publicação estão em `docs/09-autenticacao-e-seguranca.md`.

Configuração versionada em `render.yaml` (Blueprint):

| Campo | Valor |
|---|---|
| Tipo de serviço | **Web Service** (`runtime: node`) |
| Build Command | `npm ci && npm run build --workspace @bondly/commercial-workspace && npm run build --workspace @bondly/auth-proxy` |
| Start Command | `npm run start --workspace @bondly/auth-proxy` |
| Health check | `/healthz` |
| Node | `NODE_VERSION=22` |
| SPA fallback | feito no servidor (rota sem arquivo → `index.html`, preservando `/assets/*`) |
| Segredos | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (sync:false); `SESSION_SECRET` (generateValue) |
| Vars | `NODE_ENV=production`, `STATIC_DIR`, `PUBLIC_URL` (a URL real pós-1º deploy) |

### Passos para publicar (quando houver acesso)

1. Criar o OAuth Client no **Google Cloud Console** (ver `docs/09`, §5) com origens/redirects reais.
2. Render Dashboard → **New → Blueprint** → conectar o repositório; a Render lê `render.yaml` e cria
   o **Web Service** `bondly-simulator`.
3. Preencher os segredos no painel (Environment). **Nunca commitar.**
4. Após o 1º deploy, setar `PUBLIC_URL` com o host `*.onrender.com` e **redeploy**.
5. Validar o login na URL real e rodar o checklist de homologação + o de `docs/09` (§6).

### Variáveis de ambiente

Nenhuma obrigatória na entrega atual (SPA estática, armazenamento local). Variáveis do Cenário B
(backend/auth/DB) ficam documentadas em `.env.example` e **não** são prefixadas por `VITE_`.

## Rollback e recuperação (§27.7)

- **Rollback de deploy:** na Render, serviço → aba **Deploys** → selecionar um deploy estável anterior
  → **Rollback** (ou **Redeploy** daquele commit). A Render mantém o histórico de deploys.
- **Verificação pós-rollback:** abrir a URL de produção, rodar os itens 1–4 do checklist
  (carregamento, refresh em rota interna, 5 módulos, conciliação Setup/mensalidade/TCV).
- **Dados do usuário:** o Cenário A guarda propostas no `localStorage` do navegador; um rollback de
  deploy **não** apaga esses dados. Exportação/importação explícita é a via de backup/portabilidade.
- **Reprodutibilidade financeira:** cada proposta carrega snapshot imutável (versão do motor + hash
  de premissas); atualizar o deploy não altera valores de propostas já emitidas (§27.6).

## Limitações (§18/§27.5)

- **Cenário A (entregue):** armazenamento local no navegador — **não** há persistência compartilhada,
  autenticação, aprovação institucional nem unicidade global de propostas. O identificador
  `BONDLY-2027-NNNNNN` é sequencial **por navegador**.
- **Cenário B (evolução):** para múltiplos usuários, histórico compartilhado e aprovação institucional,
  é necessário backend + banco durável + auth, sujeitos a escolha e aprovação de infraestrutura.
