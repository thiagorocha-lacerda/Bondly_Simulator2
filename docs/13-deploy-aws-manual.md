# 13 — Deploy manual na AWS (runbook)

Status: **documento de empacotamento. Nada foi provisionado nem implantado na AWS por este trabalho.** O Dockerfile e os passos abaixo **não foram verificados em AWS** (ver §12). Base: [doc 12](./12-auditoria-completude-deploy-aws.md).

## 1. Pré-requisitos
- Node **22+** (`.nvmrc`; o auth-proxy usa `node:sqlite`). Ou Docker (imagem `node:22-slim`).
- Cliente OAuth Google tipo Web (Client ID + Secret).
- Domínio com TLS terminado fora do app (ALB ou CloudFront), ver §6.
- Volume persistente para o SQLite, ver §8.

## 2. Build (3 passos, nesta ordem)
```bash
npm ci
npm run build --workspace @bondly/pricing-engine
npm run build --workspace @bondly/commercial-workspace
npm run build --workspace @bondly/auth-proxy
```
Os `dist/` são gitignorados: sempre buildar em ambiente limpo. Alternativa: `docker build -t bondly-commercial-platform .` (Dockerfile multi-stage, usuário não-root, `DATA_DIR=/data`).

## 3. Start
```bash
NODE_ENV=production node apps/auth-proxy/dist/server.js
# equivalente: npm run start --workspace @bondly/auth-proxy
```
Com Docker: `docker run -p 10000:10000 -v bondly-data:/data --env-file .env.prod bondly-commercial-platform` (arquivo de env fora do Git).

## 4. Porta e health check
- Porta: `PORT`, **padrão do código 10000** (o `.env.example` usa 8799 só para dev). Escuta em todas as interfaces.
- Health check (ALB target group / ECS): `GET /healthz` -> 200 `{ok:true}`.

## 5. Variáveis de ambiente
| Variável | Segredo? | Obrigatória | Observação |
|---|---|---|---|
| `NODE_ENV` | não | sim (`production`) | G-013: allowlist `{development,test}`; qualquer outro valor (ausente, `staging`, `prod`, `Production`) é tratado como PRODUÇÃO (fail-closed: exige `DATA_DIR`, `SESSION_SECRET`, `GOOGLE_*`, `PUBLIC_URL`). Em AWS use `production` |
| `PORT` | não | não (10000) | |
| `PUBLIC_URL` | não | sim | **https** público |
| `STATIC_DIR` | não | não | padrão: dist do workspace |
| `DATA_DIR` | não | **SIM (G-003)** | em produção, ausente/inacessível ⇒ o servidor falha ao subir (exit 1) |
| `ALLOW_EPHEMERAL_REPO` | não | **NÃO usar em produção** | opt-in para memória em prod (dados perdidos no restart); `/healthz` mostra `repo:"memory"`,`ephemeral:true` |
| `LEGACY_PROFILE_CODES_ACK_INSECURE` | não | **NÃO usar** | sem ele `LEGACY_PROFILE_CODES=true` é recusado em produção (G-008) |
| `GOOGLE_CLIENT_ID` | não (público) | sim | |
| `GOOGLE_CLIENT_SECRET` | **SIM** | sim | Secrets Manager / SSM SecureString |
| `SESSION_SECRET` | **SIM** | sim | idem; gerar com 48 bytes aleatórios. **G-019:** em produção o boot é recusado (exit 1, log `boot_refused_config` sem o valor) se for o default de dev público, < 32 caracteres ou entropia trivial; `GOOGLE_CLIENT_SECRET` igual ao default de dev também é recusado |
| `BOOTSTRAP_ADMIN_EMAILS` | não | **sim no 1º deploy** | e-mails (domínio autorizado) promovidos a admin no boot **só se não houver admin**; sem segredo. Sem isso e sem legado, ninguém consegue atribuir perfis |
| `LEGACY_PROFILE_CODES` | não | não (default `false`) | **DEPRECATED**; `true` reativa código de perfil compartilhado. Manter `false` em produção |
| `PROFILE_CODE_HASH_BUSINESS/_TECH/_ADMIN` | **SIM** | só com `LEGACY_PROFILE_CODES=true` | DEPRECATED; papel sem hash fica inatingível |

Sugestão (PROPOSAL): guardar os itens SIM no AWS Secrets Manager ou SSM Parameter Store (SecureString) e injetá-los como env no ECS/EC2. Nunca usar variáveis `VITE_*` (vão para o bundle público).

## 6. TLS e URL pública
- O app **não termina TLS** e não trata `X-Forwarded-*`. Termine TLS em ALB/CloudFront e repasse HTTP para a porta do app.
- `PUBLIC_URL` deve ser a URL https pública; cookies `Secure` dependem de `NODE_ENV=production`. Comportamento atrás de ALB/CloudFront **[NÃO VERIFICADO]**.
- **Redirect URI no Google Cloud Console = `PUBLIC_URL` + `/auth/callback`**, idêntico (ex. ilustrativo: `https://simulador.exemplo.com.br/auth/callback`). Erro típico: `redirect_uri_mismatch`.
- Quem pode entrar é decidido pelo servidor (domínio exato + `email_verified`), não pelo Google.

## 7. Perfis (RBAC) e hashes legados
Perfis são atribuídos por usuário (doc 10 §9). No 1º deploy defina `BOOTSTRAP_ADMIN_EMAILS`; o admin atribui os demais pela tela "Gestão de perfis". A seção abaixo é o fluxo **DEPRECATED** (`LEGACY_PROFILE_CODES=true`):
```bash
node scripts/gen-profile-hash.mjs 'codigo-em-texto-puro'
```
Cole a saída (`scrypt$...`) em `PROFILE_CODE_HASH_<PAPEL>`. Não versione o código nem o hash.

## 8. Persistência (SQLite) — decisão necessária
O `ProposalRepository` usa SQLite (`node:sqlite`) em `DATA_DIR`. **G-003: em produção, sem `DATA_DIR` (ou com SQLite inacessível) o servidor NÃO sobe** (exit 1, log `boot_refused_ephemeral_repo`, sem segredos). `/healthz` expõe `repo` (`sqlite`/`memory`) e responde 503 se memória em produção sem `ALLOW_EPHEMERAL_REPO=true`. Use o `repo` do `/healthz` como health check do target group.

- **(a) Recomendada — ASSUMPTION: instância ÚNICA com volume EBS.** EC2 com EBS, ou task ECS única com EBS (ou bind mount de host EBS), montado em `DATA_DIR` (ex.: `/data`). Sem múltiplas réplicas (SQLite é single-writer); deploy com stop-then-start, não rolling com sobreposição.
- **(b) EFS: RISCO.** WAL/locking sobre NFS **NÃO TESTADO**; pode corromper ou travar. Só adotar após teste de carga/concorrência.
- **(c) Migrar para Postgres/RDS** (novo repositório): **fora de escopo** deste pacote; habilita multi-instância.

Esta é uma ASSUMPTION recomendada, não requisito aprovado; precisa de confirmação do time de arquitetura do sponsor.

## 9. Smoke pós-deploy
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://URL_PUBLICA/healthz        # 200
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://URL_PUBLICA/  # 302 -> /login
curl -s -o /dev/null -w "%{http_code}\n" https://URL_PUBLICA/api/me         # 401
```
Depois: login Google com conta de domínio autorizado, criar proposta, reiniciar a instância e confirmar que ela persiste (prova do volume).

## 10. Rollback
Manter a imagem/artefato anterior tagueado. Rollback = reimplantar a versão anterior apontando para o **mesmo volume** (`DATA_DIR`); fazer backup antes de cada release (§11). Não há migrações de schema automáticas verificadas neste doc: **[NÃO VERIFICADO]** compatibilidade de dados entre versões.

## 11. Backup do SQLite
Cópia consistente (não copiar o arquivo cru com WAL ativo):
```bash
sqlite3 /data/ARQUIVO.db "VACUUM INTO '/backup/bondly-AAAAMMDD.db'"
```
(o nome do arquivo `.db` está em `apps/auth-proxy/src/sqliteRepository.ts`). Envie o backup ao S3 e/ou use snapshots EBS. Teste a restauração.

## 12. Não verificado
Build de imagem Docker; execução em ECS/EC2; comportamento atrás de ALB/CloudFront; WAL em EFS; restauração de backup. Logs: JSON no stdout (enviar ao CloudWatch). `render.preview.yaml` **não** deve ser usado na AWS.


## Cache de borda (G-016) — CDN/ALB NÃO deve cachear o SPA

Todo caminho servido atrás do gate de perfil (`/`, `/index.html`, `/assets/*`, rotas SPA) sai com `Cache-Control: private, no-store` e `Vary: Cookie`; `/api/*` e `/healthz` já são `no-store`. O bundle contém o motor e as tabelas de custo, então um cache compartilhado (CloudFront, ALB/WAF cache, Cloudflare) serviria o JS a quem não tem sessão/perfil. Configure CloudFront/CDN com **CachingDisabled** (ou política que respeite `Cache-Control` do origin, sem ignorar `private`/`no-store`) para esses caminhos. Comportamento real de CDN/ALB **[NÃO VERIFICADO]**.


## Rodada 3 — operação
- **SQLite:** `busy_timeout` 5000 ms + retry limitado; lock persistente ⇒ HTTP 503 `{"error":"storage_busy"}` (cliente repete). Continue com **UMA instância** (volume/EFS único); multi-instância não é suportado (G-029).
- **Segredo de sessão:** gerar com `openssl rand -base64 48 | tr '+/' '-_' | tr -d '='` (≥ 32 chars, ≥ 16 distintos, entropia ≥ 3,5 bits/char). Sequências/teclado/palavras fracas fazem o boot recusar (exit 1, só nome+motivo; G-030).
- **Migração:** reabrir o banco existente aplica, de forma aditiva, os triggers append-only de `audit` e anti-REPLACE (G-028); nenhuma ação manual.
- **Editar proposta emitida** retorna 409 `proposal_issued_immutable` (G-025).
