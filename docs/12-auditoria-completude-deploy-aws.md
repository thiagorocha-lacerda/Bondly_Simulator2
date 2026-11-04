# 12 — Auditoria de completude para deploy AWS manual e publicação em Bondly_Simulator2

- Data da auditoria: 2026-11-04 (somente leitura; nada provisionado, código intocado, sem git push)
- Autor: Documentation, Knowledge & Context Agent
- Escopo: `/Users/mac/.kiro/crew/workspace/bondly-commercial-platform` @ branch `main`, HEAD `667b97a`
- Legenda: OK / LACUNA / N-A. Dono: `fullstack` ou `docs`. Tudo que não pôde ser verificado está marcado **[NÃO VERIFICADO]**.
- Limite: não executei build, testes nem `npm audit`. O que dizem os docs foi lido, não rodado.

## 1. Veredito

**Código-fonte: COMPLETO e buildável, com a ressalva de `docs/` desatualizado. Pacote para deploy AWS manual: INCOMPLETO.**
Não existe nenhuma documentação, Dockerfile ou IaC voltada à AWS. O deploy hoje está descrito só para a Render.
O repo no GitHub `Bondly_Simulator2` está **21 commits atrás** do `main` local, e o que hoje está lá não basta para subir a aplicação (ver §4).

## 2. Tabela checklist × status × evidência × ação × dono

| # | Item | Status | Evidência (arquivo:linha) | Ação sugerida | Dono |
|---|------|--------|---------------------------|---------------|------|
| 1a | Workspaces, lockfile e scripts | OK | `package.json:7-10` (workspaces `packages/*`, `apps/*`); `package.json:11-19` (scripts test/typecheck/build/smoke); `package-lock.json` versionado (129 KB); tsconfig em cada workspace | — | — |
| 1b | Ordem de build com `dist` gitignorado | OK | `.gitignore:2` ignora `dist/`. `packages/pricing-engine/package.json:9-15` exporta `./dist/index.js`. O CI constrói o engine antes de typecheck/testes (`.github/workflows/ci.yml:37-40`). A ordem de `npm run build --workspaces` é alfabética por padrão do npm, mas as globs `packages/*` vêm primeiro (`package.json:7-10`), o que na prática constrói o engine antes. **[NÃO VERIFICADO em runner limpo]** | Documentar a sequência explícita de 3 builds (engine, workspace, auth-proxy) como a do `render.yaml:25` | docs |
| 1c | Versão de Node declarada | LACUNA | `engines.node >=20` em `package.json:23-25` e nos 3 workspaces. O auth-proxy usa `node:sqlite` (`apps/auth-proxy/src/sqliteRepository.ts:74`), que **exige Node 22+** (`:3`, `docs/10:17`). O CI usa 22 (`ci.yml:28-32`) e o `render.yaml:30-31` usa 22. Os docs `02:39` e `09:116` ainda dizem `NODE_VERSION=20`. O Node local é v24.19.0 | Subir `engines` para `>=22`, adicionar `.nvmrc` e corrigir os docs 02 e 09 | fullstack + docs |
| 1d | Frontend e engine independem do servidor | OK | `apps/commercial-workspace/vite.config.ts:12-18` resolve o engine pela fonte via alias. O auth-proxy consome o engine pelo `dist` | — | — |
| 1e | Testes presentes | OK | 12 arquivos `*.test.*` no auth-proxy, workspace e engine, mais `scripts/smoke-sla.mjs`. **[NÃO EXECUTADO]** | O time AWS roda `npm run test` | — |
| 2 | `.env.example` cobre todas as variáveis | LACUNA (parcial) | Ver diff em §3 | Completar o `.env.example` e alinhar a porta padrão | fullstack |
| 3a | `.gitignore` cobre node_modules, dist e .env | OK | `.gitignore:1-2` (`node_modules/`, `dist/`), `:8-10` (`.env`, `.env.*`, `!.env.example`) | — | — |
| 3b | `.gitignore` cobre `*.db`, `data/`, uploads | LACUNA (baixa) | Sem regra para `*.db`, `*.sqlite*` ou `data/`. O `DATA_DIR` padrão é externo ao repo (`render.yaml:50-51`) e `smoke-sla.mjs:13-14` usa `mkdtemp` sob `KIROCREW_SCRATCH` ou a raiz. Risco: um `.db` criado na raiz seria versionável | Adicionar `*.db`, `*.db-wal`, `*.db-shm`, `data/`, `sla-e2e-*/` | fullstack |
| 3c | Segredos versionados ou hardcoded | OK | Nenhum arquivo `.env`, `.db`, chave `AKIA`, `GOCSPX` ou `BEGIN PRIVATE KEY` rastreado (`git ls-files`, grep). Há só dummies: `scripts/smoke-sla.mjs:25-26` e fallbacks de dev em `apps/auth-proxy/src/config.ts:38-40`, que lançam erro em produção (`:26`). A varredura do histórico por `.env` e `.db` adicionados retornou vazio | — | — |
| 3d | Segredos operacionais em `render.yaml` | OK | `GOOGLE_CLIENT_ID/SECRET` e `PROFILE_CODE_HASH_*` usam `sync:false` (`render.yaml:42-59`). `SESSION_SECRET` usa `generateValue` (`:46-47`). `PUBLIC_URL` é URL pública, não segredo | — | — |
| 3e | Domínios autorizados hardcoded | LACUNA (info) | A lista de domínios (minu.co, minutrade.com etc.) está no código, em `authz.ts` e `render.yaml:6`, e não em env var. O time AWS não consegue mudar os domínios sem rebuild. **[`authz.ts` não lido em detalhe]** | Registrar como decisão ou expor via env (decisão de produto) | fullstack |
| 4 | Doc de deploy AWS manual | **LACUNA (crítica)** | `grep -i "aws\|docker\|fargate\|efs\|ecs\|ec2\|apprunner\|cloudfront"` em `docs/`, `README.md` e `render*.yaml` retornou **zero ocorrências**. O deploy é descrito só em `docs/02-execucao-e-deploy.md:24-56` e `docs/09:105-124` (Render) | Criar o runbook AWS (§5 abaixo) | docs (com fullstack) |
| 4a | Porta e health check | OK (dados existem) | `/healthz` retorna 200 `{ok:true}` em `server.ts:141-143`. Porta por `PORT` em `config.ts:31`, padrão **10000**; o `.env.example:12` diz 8799. `server.listen(cfg.port)` sem host (`server.ts:234`) escuta em todas as interfaces | Documentar porta, health check e o padrão divergente | docs |
| 4b | Persistência SQLite em container | LACUNA | `docs/10:150-154` descreve só Disk Render (1 GB, single-instance). Nada sobre ECS/Fargate/EFS. `DATA_DIR` ausente ou falha do sqlite faz **fallback silencioso para memória** (`sqliteRepository.ts:257-275`), então perde dados no restart | Documentar: volume obrigatório, single-instance, risco de WAL/locking em EFS (NFS), e que `backend:'memory'` é um aviso. Decisão de arquitetura: EBS/EC2 vs EFS vs migrar para Postgres (`docs/10:155-157`) | fullstack (decisão) + docs |
| 4c | Redirect URI Google OAuth | OK parcial | `docs/09:88-101` e `config.ts:49` (`/auth/callback`). Doc fala em `onrender.com` | Adicionar o exemplo com o domínio AWS e a regra `redirect_uri = PUBLIC_URL + /auth/callback` | docs |
| 4d | TLS / proxy reverso e cookies Secure | LACUNA | Cookies `Secure` dependem de `NODE_ENV=production` (`session.ts:70-83`). O servidor monta URLs a partir de `PUBLIC_URL` (`server.ts:135`) e não trata `X-Forwarded-*` (grep em `server.ts` não achou nada). **[NÃO VERIFICADO se atrás de ALB/CloudFront há algum efeito]** | Documentar que a terminação TLS é externa e `PUBLIC_URL` deve ser https | docs + fullstack |
| 4e | Build / start | OK | `render.yaml:25-26`: build `npm ci && npm run build --workspace` ×3. Start: `npm run start --workspace @bondly/auth-proxy` (`node dist/server.js`, `apps/auth-proxy/package.json:10`) | Copiar para o runbook AWS | docs |
| 4f | Geração dos hashes de perfil | OK | `scripts/gen-profile-hash.mjs` e `docs/10:150` | Referenciar no runbook | docs |
| 4g | Gestão de segredos na AWS (Secrets Manager / SSM) | LACUNA | Nada documentado. Os segredos são só env vars (`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `PROFILE_CODE_HASH_*`) | Listar quais são segredos | docs |
| 4h | Backup, rollback e observabilidade | LACUNA parcial | `docs/02:58-67` e `docs/10:150-154` são específicos da Render. Os logs são JSON no stdout (`server.ts:235`) | Adaptar para a AWS | docs |
| 5 | Dockerfile / `.dockerignore` / docker-compose / IaC | **LACUNA** | Ausentes (`find` achou zero Dockerfile*, compose, `.dockerignore`, `*.tf`) | Lacuna apenas listada, nada criado. Sugestão: Dockerfile multi-stage Node 22, `.dockerignore` (node_modules, dist, .git, .env*, *.db), compose local com volume `DATA_DIR`, runbook | fullstack |
| 5b | `render.preview.yaml` | N-A para AWS | Static Site com **senha cosmética** (`render.preview.yaml:1-9`); `VITE_PREVIEW_PASSWORD` entra no bundle (`PreviewGate.tsx:21`) | **Não levar para produção AWS.** Marcar como arquivo só da Render, ou removê-lo do repo público | docs |
| 6 | CI roda sem Render | OK | `ci.yml:21-58`: Node 22, `npm ci`, build do engine, typecheck, testes, builds, verificação do `dist` e `npm audit --omit=dev --audit-level=high`. Nenhuma dependência da Render (só comentário em `:4`). Dispara em push e PR para `main` | Opcional: um passo de build de imagem Docker quando o Dockerfile existir | fullstack |
| 7a | Git: raiz e repo próprio | OK | `git rev-parse --show-toplevel` = a própria pasta; `.git` próprio (3,2 MB). Não é nested | — | — |
| 7b | Git: branch e remotes | **LACUNA (atenção)** | Branch `main`. `origin` = `.../Bondly_Simulator.git` (**sem o 2**). `sim2` = `.../Bondly_Simulator2.git` (`.git/config`). Existe a branch local `preview` | O push para o Simulator2 deve ser `git push sim2 main`, **não** `origin` (decisão e comando do usuário) | usuário |
| 7c | Git: estado | OK | `git status --short` vazio (árvore limpa). O `.gitignore` cobre dist e node_modules | — | — |
| 7d | Git: sim2 vs local | **LACUNA** | `git rev-list --left-right --count main...sim2/main` = **21 à frente, 0 atrás**. `sim2/main` está em `f859180` (34 commits, 101 arquivos), contra 144 arquivos rastreados localmente. Faltam em sim2: `docs/10`, `docs/11`, `render.preview.yaml`, `scripts/`, e a maior parte do auth-proxy (11 arquivos lá). Os 2 refs de remote vêm do último fetch; `git ls-remote sim2` confirmou `f859180` | Publicar o `main` local em `sim2/main` é um fast-forward limpo, sem conflito (0 atrás). Executar só com o ok do usuário | usuário |
| 7e | Inventário projeto × lixo | OK | Projeto: 144 arquivos rastreados (engine 36, workspace ~58, auth-proxy 26, docs 13, raiz 6, scripts 2). Ignorados e não rastreados: `node_modules/` (165 MB), `apps/*/dist`, `packages/pricing-engine/dist`. Sem `data/` nem uploads | — | — |
| 8a | RBAC com 4 perfis (incl. Gestor/Aprovador) | **IMPLEMENTADO (doc 10 §9); a evidência abaixo é da auditoria original: PARCIAL** | `rbac.ts:12` `Role = 'business' \| 'tech' \| 'admin'` (**3 papéis**). Grep por `gestor\|aprovador\|approver\|manager` em apps, packages e docs: **zero**. Há o estado `aprovado_tecnicamente` (`domain.ts:16`) e `verdict`, mas é decisão da P&T (tech), sem papel Aprovador. A matriz também diz "refinável" (`rbac.ts:35`) e `docs/10:155` lista a matriz fina como pendente | Papel(éis) Gestor/Aprovador é requisito a decidir: **DECISION REQUIRED** (Orchestrator/sponsor). Implementação: fullstack | fullstack |
| 8b | Estados de SLA ampliados | **PARCIAL** | Saúde: No prazo / Atenção / Vencido / Pausado / Concluído (`SlaCard.tsx:7-11`; `docs/11:35-36`). Fase: `nao_iniciado → em_andamento ⇄ pausado → concluido`. Reunião técnica com 7 estados (`docs/11:~45`). O brief que define "ampliados" **não está no repo**, então não consigo dizer o que falta | **[NÃO VERIFICADO contra o brief]** O sponsor/Orchestrator deve fornecer a lista alvo para o diff | docs |
| 8c | Indicadores P75/P90 | **IMPLEMENTADO (doc 11 §9); a evidência abaixo é da auditoria original: AUSENTE** | Grep por `p75`, `p90`, `p95`, `percentil`, `mediana` em apps/*/src, packages/*/src e docs: **zero**. `SlaDashboard.tsx:53-61` calcula só contagens (em andamento, pausados, vencidos) e `pctOnTime` (% no prazo) | Implementar P75/P90 do tempo técnico efetivo e documentar | fullstack |

## 3. Diff de variáveis de ambiente (lidas × documentadas)

Variáveis lidas (fonte: grep de `process.env` e `import.meta.env`, excluindo testes):

| Variável | Lida em | No `.env.example`? | Obrigatória? | Observação |
|----------|---------|--------------------|--------------|------------|
| `PORT` | `config.ts:31` | Sim (`:12`, valor 8799) | Não (padrão **10000**) | Padrão do código ≠ exemplo |
| `NODE_ENV` | `config.ts:30` | Sim (`:14`) | Padrão `production` se ausente | Cuidado: se ausente, o servidor assume produção e exige segredos |
| `PUBLIC_URL` | `config.ts:32-33` | Sim (`:17`) | Sim em produção | |
| `STATIC_DIR` | `config.ts:42` | Sim (`:19`) | Não (padrão relativo ao módulo) | |
| `GOOGLE_CLIENT_ID` | `config.ts:38` | Sim (`:22`) | Sim em produção | |
| `GOOGLE_CLIENT_SECRET` | `config.ts:39` | Sim (`:23`) | Sim em produção | |
| `SESSION_SECRET` | `config.ts:40` | Sim (`:29`) | Sim em produção | |
| **`DATA_DIR`** | `sqliteRepository.ts:258` | **NÃO** | Não, mas sem ele **cai em memória** | **Lacuna** |
| **`PROFILE_CODE_HASH_BUSINESS`** | `profileCodes.ts:101` | **NÃO** | Opcional | **Lacuna** (papel sem hash fica inatingível) |
| **`PROFILE_CODE_HASH_TECH`** | `profileCodes.ts:102` | **NÃO** | Opcional | **Lacuna** |
| **`PROFILE_CODE_HASH_ADMIN`** | `profileCodes.ts:103` | **NÃO** | Opcional | **Lacuna** |
| `VITE_PREVIEW_MODE` | `PreviewGate.tsx:17` | NÃO | Só no preview | Build-time; **não usar na AWS** |
| `VITE_PREVIEW_PASSWORD` | `PreviewGate.tsx:21` | NÃO | Só no preview | Vai no bundle; cosmética |
| `KIROCREW_SCRATCH` | `scripts/smoke-sla.mjs:13` | NÃO | Só no smoke | Ferramenta interna, irrelevante para a AWS |
| `NODE_VERSION` | `render.yaml:30` | NÃO | Convenção da Render | Não é lida pelo código; na AWS vale a imagem/runtime |

Resumo: 7 de 11 variáveis de runtime estão documentadas. Faltam `DATA_DIR` e `PROFILE_CODE_HASH_*` ×3.
Não há valores secretos no `.env.example`. O comentário `:3-4,28` ainda cita a Render.

## 4. Itens críticos para o time do sponsor (ordenados)

1. **Sem documentação AWS** (item 4): variáveis, porta 10000, `/healthz`, Node 22, build/start e redirect URI precisam de runbook.
2. **Persistência SQLite** (4b): a decisão de arquitetura precisa ser tomada antes de subir. Sem volume, o serviço roda "ok" em memória e perde dados. WAL em EFS/NFS é um risco **[não testado]**.
3. **Dockerfile / IaC ausentes** (item 5).
4. **`engines`/docs dizem Node 20**, mas `node:sqlite` exige 22 (1c).
5. **Remote**: `origin` ≠ Simulator2. Use o remote `sim2`. O Simulator2 está 21 commits atrás e **não contém o auth-proxy completo** (7d).
6. `render.preview.yaml` não deve ir para produção (5b).
7. Itens do brief: RBAC 4 perfis PARCIAL (3 papéis), P75/P90 AUSENTE, SLA ampliado não verificável (8).

## 5. Conteúdo mínimo sugerido para `docs/13-deploy-aws-manual.md` (a criar pelo owner; nada foi criado)

Pré-requisitos (Node 22) · build em 3 passos · start · variáveis (tabela do §3 + quais são segredos) · porta e `/healthz` ·
decisão de persistência (volume, single-instance, backup `VACUUM INTO`) · redirect URI Google = `PUBLIC_URL/auth/callback` ·
TLS externo · geração dos hashes (`scripts/gen-profile-hash.mjs`) · smoke pós-deploy (`/healthz` 200, `GET /` sem sessão → 302 `/login`, `/api/me` → 401, conforme `docs/09:135`) · rollback.

## 6. Não verificado

- Build e testes não foram executados (somente leitura e sem instalar).
- `authz.ts` (domínios) não foi lido linha a linha.
- Comportamento de `node:sqlite` com WAL em EFS e em Fargate.
- Ausência do brief que define "estados de SLA ampliados" e o 4º perfil.
- Conteúdo remoto real do Simulator2 além do `ls-remote` do HEAD (`f859180`) e dos refs do último fetch.

DOCUMENTATION STATUS: **UPDATE REQUIRED** (docs de deploy só Render e divergentes em Node; não há runbook AWS).
