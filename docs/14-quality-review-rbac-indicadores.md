# 14 — Revisão independente de Qualidade & Segurança: RBAC 4 perfis + indicadores SLA P75/P90

- **Revisor:** Quality & Security Guardian (independente do `product-fullstack`, autor da mudança — PL-025 §8.3 atendido).
- **Escopo:** mudança NÃO commitada no working tree (44 entradas em `git status`: RBAC, atribuições, bootstrap, flag legada, indicadores, UI, docs).
- **Data:** 2026-11-04. Sem commit, push ou AWS. Código **não** foi alterado; um teste adversarial temporário foi criado e **removido**.
- **Método:** leitura arquivo a arquivo + execução (typecheck, testes, builds, boot em produção, `npm audit`) + testes adversariais descartáveis contra `handleApi`. O auto-relato do fullstack foi tratado como hipótese.
- **Taxonomia:** REQUIREMENT / ASSUMPTION / PROPOSAL / DECISION / CONFLICT preservada. O brief original do sponsor **não foi fornecido** a esta revisão; onde o veredito depende dele, está marcado como `ASSUMPTION do revisor`.

## QUALITY STATUS

**CHANGES REQUIRED** (nenhum CRITICAL; o núcleo novo de RBAC resiste aos ataques testados).
**RELEASE STATUS (produção): BLOCKED** enquanto G-001 não tiver DECISÃO registrada e G-003 não estiver corrigido (HIGH sem mitigação — Quality Gate).

Condições para subir para APPROVED WITH CONDITIONS: corrigir G-003, G-004, G-005; registrar DECISÃO do sponsor sobre G-001, G-002 e G-006; reapresentar para re-revisão (somente o Guardian move FIXED → VERIFIED).

## Findings

Escala Minu (PL-025 §9.1.1): Impacto × Probabilidade → nível da matriz; severidade Guardian entre parênteses.

### G-001 — HIGH (matriz: **Alto** = Impacto Alto × Prob. Moderada) — CONFLICT — Modelo de custo/margem enviado a todo usuário autenticado
- **Componente:** `apps/commercial-workspace` (bundle SPA) + `apps/auth-proxy/src/server.ts` (`serveStatic`) + `projection.ts`.
- **CWE/OWASP:** CWE-602 (enforcement no cliente), CWE-200; OWASP A04 Insecure Design / API3 Excessive Data Exposure; PL-025 §9.2.1 (menor privilégio / need-to-know).
- **Evidência:** (a) `projection.ts` comenta que custo/margem são recalculados no cliente; (b) executado: o payload de `business` e `approver` para a mesma proposta é **idêntico** e contém `commercial.complexity.implementationHours` e `negotiation.extraDiscount` (saída `BUSINESS`/`APPROVER` do teste adversarial); (c) `dist/assets/index-*.js` contém `implementationHours`/`cogs`/`marginPct`, e os `.map` são servidos; (d) `serveStatic` só exige sessão — **usuário sem perfil também baixa o bundle**; (e) `audience=external` / `forcedExternal` é só CSS/estado React.
- **Risco:** qualquer funcionário de domínio autorizado (inclusive sem perfil) obtém tabelas de custo, premissas de margem e o motor de cálculo via DevTools/source map. "Negócios não vê margem" só vale para inputs técnicos, snapshot e notas — não para margem derivável.
- **Como reproduzir:** logar como `business`, abrir DevTools → Sources, ou `curl` do bundle com o cookie; inserir `implementationHours` do payload no motor.
- **Opções (sem decidir):**
  - **A — mover o cálculo ao servidor** (`POST /api/pricing/quote` com saída filtrada por papel; remover tabelas de custo do bundle; desligar sourcemaps). Custo: refatoração do app e latência; elimina a classe de risco.
  - **B — aceitar o risco** com assinatura do sponsor (ACCEPTED RISK), desligando `.map` e servindo o bundle só a quem tem perfil. Custo baixo; risco residual permanece (motor ainda no browser).
  - **C — dois bundles** (interno para tech/admin; comercial sem tabelas de custo para business/approver), mas o cálculo comercial ainda exige preço → exige que o servidor devolva o preço final. Esforço intermediário.
- **Dono:** product-orchestrator (DECISÃO) → product-fullstack. **Status:** OPEN.

### G-002 — MEDIUM (matriz: Médio = Impacto Médio × Prob. Moderada) — Sem escopo por dono: qualquer `business` lê, edita e transiciona proposta alheia (IDOR/BOLA)
- **Componente:** `api.ts` (listar/GET/`/commercial`/`/transition`). **CWE-639, CWE-285; OWASP API1 (BOLA).** Pré-existente (não está no diff), mas o relato "RBAC enforçado" não cobre isso.
- **Evidência (executada):** `b2@minu.co` (business) vs proposta criada por `biz@minu.co`: lista=1 proposta alheia, GET=200, PUT commercial=200, transition=200 (`IDOR 1 200 200 200`). `ownerEmail` existe mas nunca é checado.
- **Impacto:** edição/submissão acidental ou maliciosa de proposta de colega; rastreável por auditoria (mitiga parcialmente). `ASSUMPTION do revisor`: se o brief exige visibilidade só do próprio dono, vira HIGH.
- **Correção sugerida:** política explícita (dono ou equipe) aplicada em `repo`/`api`; teste de regressão IDOR. **Dono:** product-fullstack após DECISÃO. **Status:** OPEN.

### G-003 — HIGH (matriz: **Alto** = Impacto Alto × Prob. Moderada) — Fallback silencioso para memória em produção
- **Componente:** `sqliteRepository.ts` `createRepository`. **CWE-703/CWE-755; PL-025 §9.2.1 (integridade/não-repúdio), §9.2.6 (logs de auditoria).**
- **Evidência (executada, `NODE_ENV=production`):** com `DATA_DIR=/proc/nope/x` o servidor loga `sqlite_unavailable`, sobe com `repo:"memory"` e `/healthz` responde `200 {"ok":true}`. Sem `DATA_DIR`, também sobe em memória.
- **Risco:** atribuições, **auditoria de atribuições**, propostas e eventos de SLA somem a cada restart; revogações são desfeitas silenciosamente; o bootstrap recria o admin e o sistema "parece sadio". Perde-se a trilha de não-repúdio.
- **Correção sugerida:** em produção, falhar fechado (exit ≠ 0) se `DATA_DIR` ausente/inacessível, salvo opt-in explícito (`ALLOW_EPHEMERAL_REPO=true`, proibido em prod); `/healthz` deve expor `repo` e falhar em memória-em-prod.
- **Dono:** product-fullstack. **Status:** OPEN.

### G-004 — MEDIUM (Médio = Impacto Médio × Prob. Moderada) — Reuniões técnicas vazam para business/approver
- **Componente:** `api.ts` `GET /api/proposals/:id/meetings`. **CWE-200, CWE-863; OWASP API3.**
- **Evidência (executada):** tech cria reunião com objetivo "conf tech: custo real 40%"; `business` recebe 200 com o `objective` e o `log` (com notas).
- **Correção sugerida:** exigir `proposal.see_internal` (ou projetar um resumo). Teste de regressão por perfil. **Dono:** product-fullstack. **Status:** OPEN.

### G-005 — MEDIUM (Médio = Impacto Médio × Prob. Moderada) — Texto livre sem limite alimenta `/api/sla/indicators` (vazamento ao approver + bloat)
- **Componente:** `api.ts` (`sla/pause` `reason`/`missingItems`, `approval.note`, `objective`), `indicators.ts` (`pausesByReason`). **CWE-770, CWE-200.**
- **Evidência (executada):** pausa com `reason` de 200 KB ⇒ `GET /api/sla/indicators` 200 com **200.334 bytes** para o approver; `reason` é texto técnico livre que o approver (sem `see_internal`) passa a ver; mesma raiz cria motivos "diferentes" por grafia.
- **Impacto:** exposição de conteúdo técnico ao approver; resposta inflada; XSS descartado (React escapa — verificado em `SlaDashboard`).
- **Correção sugerida:** catálogo/enum de motivos (+ campo livre ≤ 200 chars NÃO agregado); limites de tamanho em todo texto; validação de schema de `commercial`/`technical` (hoje JSON arbitrário até 256 KB). **Dono:** product-fullstack. **Status:** OPEN.

### G-006 — MEDIUM (Médio; sobe a HIGH se o brief exigir gate de aprovação) — Decisão do approver sem efeito, sem idempotência e sem tela
- **Componente:** `api.ts` `POST /api/proposals/:id/approval`; UI. **PL-025 §9.1 (critérios de aceite).**
- **Evidência (executada):** `approved` e depois `rejected` na mesma proposta/kind ⇒ 201 e 201; ambos gravados; nenhuma transição de estado; não há pré-condição de estado nem tela. `docs/10 §9.6` admite "Integração com a máquina de estados: PENDENTE".
- **Avaliação do ponto 8:** o approver hoje só **lê** (propostas sem interno + indicadores) e grava um registro de auditoria via API. Não bloqueia o RBAC em si; **bloqueia o perfil como aprovador funcional** se o brief espera aprovação efetiva. Precisa de DECISÃO: (A) entregar tela + efeito na esteira + idempotência; (B) declarar fora do release e remover a ação do `/api/me` até existir.
- **Dono:** product-orchestrator (DECISÃO) → product-fullstack/product-designer. **Status:** OPEN.

### G-007 — LOW — Auditoria "append-only" só por convenção; sem log de tentativas negadas
- **Evidência:** `assignment_audit` sem trigger/permissão contra UPDATE/DELETE; mudanças de atribuição e 403 em `/api/admin/*` não vão para log estruturado. (Positivo: auditoria e atribuição gravam na **mesma transação** `BEGIN IMMEDIATE`; falha de auditoria **reverte** a atribuição — verificado por leitura.) PL-025 §9.2.1 (não-repúdio), §9.2.6; PL-026 (dependência: política não disponível).
- **Correção:** triggers `BEFORE UPDATE/DELETE → RAISE(ABORT)`; log JSON `rbac_change`/`rbac_denied` sem e-mail (hash ou contagem). **Dono:** product-fullstack. **Status:** OPEN.

### G-008 — LOW — Fluxo legado e operabilidade do bootstrap
- `LEGACY_PROFILE_CODES=true` é honrado em produção (apenas `warn`); sem rate limit no unlock. **Verificado:** default seguro — env ausente ⇒ `false`; `/api/profile/unlock` ⇒ 403 `legacy_profile_codes_disabled`; legado nunca concede `approver` nem gerencia atribuições; cookie com `role` é ignorado com a flag desligada.
- `/api/me` de admin legado lista `admin.manage_users` enquanto `/api/admin/assignments` devolve 403 (UI mostra painel que falha).
- Em produção, sem `BOOTSTRAP_ADMIN_EMAILS` e sem admin no banco, ninguém administra perfis e **não há log de alerta** (observado: apenas `listening`).
- **Correção:** recusar a flag em `isProd` (ou exigir ack); `permissions` coerente com a fonte; `warn` `no_admin_configured` no boot. **Status:** OPEN.

### G-009 — LOW — CSRF/headers/limites
- CSRF depende só de `SameSite=Lax` + `HttpOnly` (verificado em `session.ts`); não há checagem de `Origin`/`Sec-Fetch-Site` em `PUT/POST /api/*` e o corpo é parseado sem exigir `Content-Type`. Cross-site simples **não** envia o cookie Lax (risco baixo); subdomínios do mesmo site sim. CWE-352.
- Corpo > 256 KB ⇒ exceção ⇒ 500 genérico (deveria ser 413). Respostas `/api/*` sem `Cache-Control: no-store` e `nosniff`; sem CSP/HSTS; sem rate limit.
- Sem CORS habilitado (nenhum header ACAO) — adequado. **Status:** OPEN.

### G-010 — LOW — Normalização de e-mail permissiva
- **Evidência (executada):** `bob+x@minu.co`, `a@b@minu.co`, `<script>@minu.co`, homóglifo cirílico `bоb@minu.co` e full-width `ａ@minu.co` são **aceitos** em `PUT /api/admin/assignments`. Domínio, sufixos, subdomínio, ponto final, espaço e zero-width no domínio são **rejeitados**; case/espaço de borda normalizados. Não explorável (a sessão vem de e-mail verificado do Google), mas polui a base e cria atribuições "mortas" (alias `+x` nunca casa com o e-mail do token).
- **Correção:** regex estrita ASCII para a parte local; decisão explícita sobre aliases. **Status:** OPEN.

### G-011 — LOW — Indicadores: robustez e custo
- **Corretos (executado):** nearest-rank `ceil(p·n)` com n=0→null, n=1→valor, n=4 P75=3, n=10 P90=9, n=20→18, n=30→27 (sem erro de ponto flutuante), empates, mediana par=2,5, NaN/∞ filtrados, divisão por zero tratada, `pctWithinSla` correto; só propostas com `started`+`completed` entram; tempo útil exclui pausas (reusa `reduceSla`).
- **Ressalvas:** amostra com `effective=NaN` contaria em `n`/`pctWithinSla` mas não nos percentis (inalcançável hoje); valores negativos não são rejeitados; o endpoint carrega **todos** os eventos a cada chamada (sem cache/limite); testes não cobrem negativos/NaN em `computeSlaIndicators`. **Status:** OPEN.

### G-012 — LOW — Governança (PL-025)
- ADRs ausentes para decisões que mitigam risco (resolução de papel por request; approver sem `see_internal`; depreciação do legado) — apenas ASSUMPTIONs em `docs/10` (§9.1.1/§9.2.2). Ação: ADR no Notion (dependência fora do repo).
- Ação `proposal.read_audit_full` e `sla.configure` sem rota (matriz maior que o enforcement); `projectAudit` usa `see_internal`, não `read_audit_full`.
- Cobertura TDD: não há teste para IDOR, vazamento de reuniões, fallback de repo em produção, CSRF nem migração de banco legado.
- Dependências (PQ-029, dependência): `npm audit` completo = 6 (2 critical, 1 high), **todas dev-only** (vitest/tinypool/vite/esbuild), **pré-existentes** (lockfile e devDeps inalterados no diff). `--omit=dev`: 0.

## Verificado × NÃO verificado

**Verificado por execução**
- `npm run typecheck` (3 workspaces): OK.
- `npm run test`: engine **107**, workspace **54**, auth-proxy **187** = **348 passando, 0 falhas**.
- Builds dos 3 workspaces (`npm run build`): OK.
- Boot em `NODE_ENV=production` com banco SQLite: sem `BOOTSTRAP_ADMIN_EMAILS` ⇒ `/healthz` 200; com `ceo@minu.co,evil@gmail.com` ⇒ 1 criado + 1 rejeitado (contagens, sem e-mail no log), 200. Sem `DATA_DIR` ⇒ sobe em memória (ver G-003).
- `/api/*` sem sessão ⇒ 401 (inclui `/api/me` e `unlock`).
- Atribuições: `role` inválido/ausente/`__proto__`, e-mail array, corpo `[]`/`null` ⇒ 400; campo extra ignorado; `X@Minu.CO` normaliza.
- Último admin: auto-remoção do único admin ⇒ 409; com 2º admin ⇒ permitido. Sem auto-promoção possível (só admin escreve). Admin legado ⇒ 403 em atribuições, e `approver` legado ⇒ sem perfil.
- Sem perfil ⇒ 403 em tudo exceto `/api/me`; domínio fora da lista ⇒ sem perfil mesmo com atribuição.
- Revogação imediata (papel lido do repositório a cada request, não do cookie 8h).
- Segredos: regex (AWS/PEM/GOCSPX/ghp/client_secret) sem hits no repo; logs sem e-mail/PII (grep `console.*`); `.env.example` sem valores.

**Verificado por leitura apenas:** transação atômica atribuição+auditoria e `BEGIN IMMEDIATE` (single-process); `CREATE TABLE IF NOT EXISTS` para as novas tabelas (migração aditiva); cookie `HttpOnly/Secure(prod)/SameSite=Lax`; escape de saída no React; `Dockerfile` com `USER node` multi-stage.

**NÃO verificado:** Google OAuth real e fluxo no browser/UI; `smoke:sla`; abrir um **banco legado pré-existente** (só banco novo); concorrência multi-processo/multi-instância no SQLite; scan de segredos no **histórico** git (`gitleaks`/`trufflehog` não instalados); SAST (Semgrep/CodeQL); `docker build` + `trivy image`; CI; DAST (ZAP); carga; acessibilidade; texto exato do brief do sponsor (G-002/G-006 dependem dele).

## Required Actions (antes de qualquer release)
1. G-003 corrigir (fail-closed em prod) + teste. 2. G-004 e G-005 corrigir + testes de regressão por perfil. 3. DECISÃO do sponsor registrada (ADR) para G-001 (A/B/C), G-002 (escopo por dono) e G-006 (approver funcional vs fora de escopo). 4. Re-submeter para re-revisão; migrar FIXED→VERIFIED só pelo Guardian.

## Recommended Actions
G-007 a G-012; rodar gitleaks no histórico; executar `smoke:sla`; testar migração com cópia de banco existente; adicionar SAST/secret scan/container scan ao CI; Production Readiness Review após as correções.

## Riscos no formato PL-025 §9.1.1
| Projeto | Risco (nível) | Descrição do Risco | Impactos | Ações de Contorno |
|---|---|---|---|---|
| Bondly | G-001 (Alto) | Modelo de custo/margem no bundle e inputs idênticos para business/approver | Exposição de margem; descumprimento do brief | Opção A/B/C; sourcemaps off; bundle só com perfil |
| Bondly | G-003 (Alto) | Repositório em memória silencioso em produção | Perda de atribuições/auditoria, revogação desfeita | Fail-closed + healthz |
| Bondly | G-002 (Médio) | Sem escopo por dono | Edição indevida de propostas | Política de dono + teste IDOR |
| Bondly | G-004/G-005 (Médio) | Vazamento via reuniões e motivos livres | Dado técnico a perfis sem permissão | Gate por ação; enum/limite de texto |
| Bondly | G-006 (Médio) | Aprovação sem efeito/UI | Perfil approver não funcional | Decisão A/B |

---

## Resposta do autor (product-fullstack) — **FIXED-PENDING-REVIEW**

> Autor não marca VERIFIED; somente o Guardian. Sem commit/push/AWS. Caminhos relativos a `apps/auth-proxy/src/` salvo indicação.

| Finding | O que mudou | Onde (arquivo:linha) | Teste de regressão |
|---|---|---|---|
| G-003 | `createRepository` lança `RepositoryUnavailableError` em prod sem `DATA_DIR`/SQLite inacessível (salvo `ALLOW_EPHEMERAL_REPO=true`, warn); `server.ts` loga `boot_refused_ephemeral_repo` e `exit 1`; `/healthz` expõe `repo` e dá 503 em memória-em-prod sem opt-in | `sqliteRepository.ts:~345-390`, `server.ts:41-56,180`, `health.ts` | `failClosed.test.ts` (11) + boot real: sem DATA_DIR exit=1, `/proc/nope/x` exit=1, tmp OK `repo:"sqlite"` |
| G-004 | `GET /meetings` exige `proposal.see_internal` (business/approver → 403) | `api.ts:265` | `guardianFixes.test.ts` G-004 |
| G-005 | `limits.ts` central (500; pausa livre 200; 20 itens×200; corpo 256 KB→413); catálogo `reasonCode`; indicadores e `/sla` p/ quem não vê interno usam só rótulo do catálogo | `limits.ts`, `api.ts` (pause/approval/meetings/transition), `server.ts:110-116,258-268` | G-005 (reason 200 KB→400, payload de indicadores <2 KB, sem texto livre ao approver); `rbacApi.test.ts` ajustado p/ `reasonCode` |
| G-006 (parcial) | decisão repetida igual → 200 idempotente; conflitante na mesma proposta+kind → 409. Sem tela/efeito na esteira | `api.ts:~222-236` | G-006 |
| G-008 | `LEGACY_PROFILE_CODES` recusado em prod sem `LEGACY_PROFILE_CODES_ACK_INSECURE=true` (error/warn); `/api/me` não lista `admin.manage_users` p/ admin legado; warn `no_admin_configured` | `config.ts:~50-70`, `api.ts` (/api/me), `server.ts:62-68` | G-008 (4) |
| G-009 | `no-store`+`nosniff` em `/api/*` (inclui 401); Sec-Fetch-Site/Origin em mutantes (sem Origin ⇒ permitido: ferramenta não-browser, documentado); `Content-Type: application/json`→415; JSON inválido→400 | `httpGuards.ts`, `server.ts:250-272` | G-009 (puro) |
| G-010 | `normalizeAssignableEmail`: local ASCII `[a-z0-9._-]`, sem `+`, `..`, múltiplos `@`; usado em PUT e bootstrap | `assignments.ts:31-40` | G-010 (3) |
| G-007 | triggers `BEFORE UPDATE/DELETE` `RAISE(ABORT)` (aditivo, `IF NOT EXISTS`); logs `rbac_change`/`rbac_denied` com hash de 12 hex | `sqliteRepository.ts:~148`, `securityLog.ts`, `api.ts` (admin) | G-007 (trigger no SQLite real + log sem `@minu.co`) |
| G-001 (parcial) | `sourcemap:false`; `.map`→404; sem perfil ⇒ 403 com tela mínima sem bundle (exceto fluxo legado ligado, que precisa da UI). Cálculo NÃO movido (aguarda A/B/C) | `vite.config.ts:21`, `server.ts:~100,280-290`, `httpGuards.ts` | G-001 (puro); build: 0 `.map` em `dist/assets` |
| G-011 | `computeSlaIndicators` descarta amostras NaN/∞/negativas | `indicators.ts:135` | `slaIndicators.test.ts` (+2) |

**Não tocados:** G-002, G-006 funcional, G-001 A/B/C, G-012 (ADR/IDOR).
**ASSUMPTIONs:** (1) UI atual não envia `reasonCode` ⇒ pausas agregam em "Outro" até a UI ganhar o select (PROPOSAL, follow-up de UX); (2) `commercial`/`technical` seguem sem schema (só teto de 256 KB do corpo); (3) sem Origin/Sec-Fetch-Site ⇒ permitido; (4) bundle liberado a todos se o fluxo legado estiver ligado; (5) erros de limite: 400 `text_too_long`, não 413 (413 só para corpo).
**NÃO VERIFICADO:** HTTP real autenticado de 413/415/cross-site/gate do SPA/`.map` 404 (só unitário; prova com sessão forjada foi bloqueada por política); `smoke:sla`; docker build.

---

## Re-revisão (Guardian) — 2026-11-04

> Revisor independente (≠ autor `product-fullstack`, PL-025 §8.3). Sem commit/push/AWS; código não alterado. Auto-relato tratado como hipótese.

**Já confirmado por execução (2026-11-04):** `npm run typecheck` OK (3 ws); `npm run test`: engine **109**, workspace **54**, auth-proxy **218** = **381 passando, 0 falhas** (bate com o relato); `npm run build` OK (3 ws); `npm audit --omit=dev` = **0**; `npm audit` completo = 6 (2 crit/1 high/3 mod), todas dev-only (vitest/tinypool/vite/esbuild), pré-existentes.
**Método dos testes adversariais (descartáveis, removidos):** (a) boot real de `apps/auth-proxy/dist/server.js` com `env -i` em 10 combinações de ambiente; (b) bancos SQLite legados criados a partir do schema do `HEAD` do git, abertos com o código novo; (c) `handleApi` compilado contra esses bancos, com sessões como objetos (sem cookie forjado); (d) funções puras `httpGuards`/`static-path`; (e) HTTP real **somente sem sessão** (401/302/headers). Nenhum cookie de sessão foi forjado, em respeito à política.

## QUALITY STATUS (atualizado)

**CHANGES REQUIRED.** Os fixes do autor são, em sua maior parte, reais e resistem aos ataques (8 de 10 findings verificados), mas a re-revisão encontrou **1 HIGH novo (G-013)** que enfraquece o fail-closed de G-003 e 1 MEDIUM (G-016) que enfraquece o gate de G-001.
**RELEASE STATUS (produção): BLOCKED** — motivos: (1) G-001 (A/B/C), G-002 e G-006 funcional continuam **OPEN aguardando DECISÃO do sponsor** (não reclassificados; impacto no release inalterado: o motor/tabelas de custo e margem continuam no bundle entregue a qualquer usuário com perfil, inclusive business/approver; qualquer `business` ainda lê/edita proposta alheia; o perfil `approver` continua sem efeito funcional/tela); (2) G-013 (HIGH, mitigação só por convenção de IaC) sem correção.

## Status por Finding

| ID | Status | Resultado / evidência executada |
|---|---|---|
| G-003 | **VERIFIED** (no escopo pedido) — ver G-013 para o residual | Boot real, `dist/server.js`: prod sem `DATA_DIR` ⇒ **exit 1** (`boot_refused_ephemeral_repo`); `NODE_ENV` ausente ⇒ exit 1; `DATA_DIR=/proc/nope/x` ⇒ exit 1; `DATA_DIR` apontando para arquivo ⇒ exit 1; `DATA_DIR=''` ⇒ exit 1; `ALLOW_EPHEMERAL_REPO=1` (≠ `true`) ⇒ exit 1; `DATA_DIR` ok ⇒ sobe, `/healthz` = `200 {"ok":true,"repo":"sqlite"}`; `ALLOW_EPHEMERAL_REPO=true` ⇒ sobe em memória com `warn ephemeral_repo_in_production`, `/healthz` = `{"repo":"memory","ephemeral":true}`. Único caminho de memória-em-prod é o opt-in (`grep`: `createMemoryRepository` só é importado em `createRepository`). O 503 do `/healthz` em memória-em-prod sem opt-in é **inalcançável por HTTP** (o boot já recusa) — coberto só por teste unitário. CI (`.github/workflows/ci.yml`) não sobe o servidor ⇒ fail-closed não derruba health check de CI; `smoke-sla.mjs` passa `DATA_DIR`. Atenção operacional: no `Dockerfile` o volume `/data` precisa ser gravável por `node` (senão crash-loop **ruidoso** — comportamento desejado). |
| G-004 | **VERIFIED** | `GET /meetings`: business ⇒ 403, approver ⇒ 403, tech ⇒ 200, admin ⇒ 200. UI não quebra: `useSla.getJson` trata 403 como `null` e mantém `meetings=[]`. |
| G-005 | **VERIFIED** (com ressalva funcional G-017) | `reason` 201 chars ⇒ 400 `text_too_long`; `objective`/`note` 501 ⇒ 400; tipo errado ⇒ 400 `invalid_text`; `missingItems` 21 ⇒ 400, não-array ⇒ 400; `reasonCode` inválido ⇒ 400 para `'<script>'`, `'constructor'`, `'__proto__'`, `'toString'`, `null`, `{}`, `['outro']`, `1` (sem bypass por protótipo); ausente ⇒ `outro`. Com `reason='SEGREDO: margem 38%'`, `missingItems=['item interno…']` e `confirmedItems=['SEGREDO resume']`: `/api/sla/indicators` (approver) **não contém** `SEGREDO` nem texto livre; `GET /sla` para business/approver devolve `pauseReason:"Aguardando cliente"` (rótulo do catálogo), sem `missingItems`/`confirmedItems`; para tech devolve o texto livre. **Banco legado**: pausa pré-fix com texto técnico livre e sem `reasonCode` aparece para business/approver como `"Outro"` (sem vazamento retroativo). 413: o padrão `for await`+`BodyTooLargeError` foi reproduzido isoladamente (300 KB e 2 MB ⇒ 413 recebido pelo cliente, 1 KB ⇒ 200); **no servidor real autenticado: NÃO VERIFICADO**. |
| G-006 (parcial) | **VERIFIED** (sequencial) — residual em G-018 | 1ª decisão ⇒ 201; repetida igual (nota diferente) ⇒ **200 `idempotent:true`**, sem nova linha; conflitante ⇒ **409 `decision_conflict`**; `kind` distinto é independente (201). Concorrência: ver G-018. O restante de G-006 (efeito na esteira/tela) segue **OPEN (sponsor)**. |
| G-007 | **VERIFIED** (escopo: UPDATE/DELETE) | Banco **legado A** (schema do `HEAD`, sem `role_assignments`/`assignment_audit`) e **legado B** (com as duas tabelas, sem triggers, 1 linha de auditoria): ambos abrem com o código novo, preservam propostas (1), eventos de SLA (2) e atribuições (B: 1), criam as tabelas/triggers de forma aditiva, e `setAssignment` grava auditoria. `UPDATE assignment_audit` ⇒ **ABORT**; `DELETE` ⇒ **ABORT** nos dois bancos. Logs `rbac_change`/`rbac_denied` não trazem e-mail em claro (ver G-014 para o hash). **Residual (INFO):** `INSERT OR REPLACE INTO assignment_audit` com `id` existente **reescreveu** a linha (REPLACE não dispara trigger de DELETE com `recursive_triggers` desligado); o código da aplicação nunca emite isso (ids = `randomUUID`), então só vale contra acesso direto ao arquivo — que também poderia `DROP TRIGGER`. O trigger protege contra bug/SQL acidental, **não** contra quem tem o arquivo; para não-repúdio forte, usar cópia imutável/log externo (PL-025 §9.2.1; PL-026 = dependência não disponível). |
| G-008 | **VERIFIED** | `loadConfig`: prod + `LEGACY_PROFILE_CODES=true` sem ack ⇒ `legacyProfileCodes=false`, `legacyProfileCodesRefused=true` (error no boot); com `ACK_INSECURE=true` ⇒ habilita com warn. `/api/me` do admin **legado** (`roleSource:"legacy"`) não lista `admin.manage_users`; do admin **atribuído** lista. Boot de prod sem admin ⇒ log `no_admin_configured` (observado). Default seguro preservado. |
| G-009 | **VERIFIED por função pura + HTTP sem sessão; fluxo autenticado NÃO VERIFICADO** | Sem sessão (HTTP real): `/api/me` e `POST /api/proposals` (text/plain, `Sec-Fetch-Site: cross-site`) ⇒ **401** com `Cache-Control: no-store` e `X-Content-Type-Options: nosniff`; `/healthz` `no-store`. `checkCrossSite` (20 casos): `cross-site`/`same-site`/`''`/array duplicado ⇒ 403; `same-origin`/`none` ⇒ ok; `Origin` evil/`null`/`http://` (downgrade)/subdomínio ⇒ 403; Sec-Fetch-Site **prevalece** sobre Origin; métodos em minúsculo e PUT/PATCH/DELETE tratados; GET não é checado. `checkJsonContentType`: `text/plain`, `form`, `chunked` sem CT, `application/jsonx`, `vnd.api+json` ⇒ 415; JSON/`; charset` ⇒ ok. **Origin/Sec-Fetch-Site ausentes ⇒ permitido** (trade-off documentado pelo autor): aceitável porque browsers atuais sempre enviam `Sec-Fetch-Site` e o cookie é `HttpOnly`+`SameSite=Lax`; cliente não-browser sem cookie recebe 401. **Regressão de UI descartada:** todos os `fetch` mutantes da SPA (`useProposals`, `useSla`, `AssignmentsAdmin`, `useSession`) enviam `Content-Type: application/json`. |
| G-010 | **VERIFIED** | 18 vetores via `PUT /api/admin/assignments`: rejeitados (400) `+alias`, `a@b@…`, `<script>`, homóglifo cirílico, full-width, `minu.co.evil.com`, `.bob`, `bob.`, `bo..b`, local de 65 chars, `bob@sub.minu.co`, `%62ob`, zero-width, espaço, `\n`; aceitos `BOB@MINU.CO` (normaliza), `bob-1_x.y@…`, `b@minu.co`. Mesma função no bootstrap. |
| G-011 | **VERIFIED** | `computeSlaIndicators`: só-NaN ⇒ `n=0`, percentis `null`; mix `NaN/∞/-1/(raw<0)/válidos` ⇒ `n=3` consistente com percentis e `pctWithinSla`; `raw=NaN` descarta a amostra inteira; nearest-rank preservado ([1..4] P75=3; 1..10 P90=9). INFO: amostras inválidas são descartadas **sem contador/log** (corrupção de relógio ficaria invisível). |
| G-001 (parcial) | **VERIFIED (parcial: sourcemap + gate sem-perfil)**; A/B/C **OPEN** | `vite.config.ts` `sourcemap:false`; `find dist -name '*.map'` = **0** e nenhum `sourceMappingURL` em `dist/assets`/`index.html`; `server.ts` responde 404 a `.map`. **Gate do SPA:** todo caminho não-público (`/`, `/index.html`, `/assets/*`, rota SPA) passa por `resolveEffectiveRole` antes de `serveStatic`; públicos são só `/healthz`, `/login`, `/auth/*` (HTML inline). Sem perfil ⇒ 403 + tela mínima, sem bundle; domínio fora da lista ⇒ sem perfil; `LEGACY_PROFILE_CODES` recusado em prod por padrão ⇒ o gate não é desligado por acidente. Não encontrei rota/asset que entregue o bundle sem perfil. Não quebra login/ProfileGate: `/login` e `/auth/callback` são anteriores ao gate; usuário sem perfil vê a tela do servidor (equivalente ao `ProfileGate` da SPA) e "Recarregar" funciona após a atribuição; com legado ligado o bundle é liberado a todos (documentado). **Residuais:** (i) G-015 e G-016 abaixo; (ii) o gate **não** reduz o risco de G-001 para quem tem perfil (business/approver/tech/admin continuam recebendo o motor e as tabelas de custo) — por isso A/B/C segue OPEN. HTTP autenticado do gate e do 404 de `.map`: **NÃO VERIFICADO**. |
| G-001 (A/B/C), G-002, G-006 funcional | **OPEN — aguardando DECISÃO do sponsor** | Não reclassificados. Impacto no release reafirmado acima. |
| G-012 | OPEN (não tocado pelo autor, como declarado) | ADRs ausentes; IDOR sem teste; PQ-029/PL-025 §9.2.2 dependem de Notion/política. |

## Novos Findings (re-revisão)

### G-013 — HIGH (matriz: **Alto** = Impacto Muito Alto × Prob. Baixa) — `NODE_ENV` fora de `production` desliga TODOS os fail-closed e usa segredos de desenvolvimento
- **Componente:** `config.ts` (`isProd = (NODE_ENV ?? 'production') === 'production'`), `sqliteRepository.ts` (`createRepository`). **CWE-1188 (insecure default/fail-open), CWE-798; PL-025 §9.2.1 (segredos/ambientes), §9.2.5.** Pré-existente na regra, mas **derrota o que G-003 prometia** ("nenhum fallback silencioso").
- **Evidência (executada, `dist/server.js`, sem nenhum segredo no ambiente):** `NODE_ENV=staging` ⇒ sobe (`prod:false`, `repo:memory`, `/healthz` 200); `NODE_ENV=prod` (typo) ⇒ idem; `NODE_ENV=Production` ⇒ `prod:false`, `repo:memory`. Nesses modos `required()` cai em `SESSION_SECRET='dev-session-secret-not-for-production-use'` — **valor público no repositório** ⇒ qualquer pessoa forja cookie de sessão válido; `GOOGLE_CLIENT_SECRET` fictício; `PUBLIC_URL` localhost; cookie sem `Secure`.
- **Impacto:** um typo/override de variável (Dockerfile e `render.yaml` fixam `production`, o que mitiga, mas o AWS manual/`docs/13` e qualquer task definition dependem de convenção) resulta em bypass total de autenticação **e** perda de dados, sem exit ≠ 0. Probabilidade Baixa (~1×/ano) × Impacto Muito Alto (irreversível) = **Alto**.
- **Correção sugerida:** inverter a lógica — só `development`/`test` (allowlist explícita) são não-produção; qualquer outro valor (incl. `staging`, `prod`, `Production`) ⇒ tratar como produção (ou recusar boot com `invalid_node_env`); teste de regressão.
- **Dono:** product-fullstack. **Status:** OPEN.

### G-014 — LOW (Baixo = Impacto Baixo × Prob. Moderada) — Hash de e-mail nos logs é enumerável
- **Componente:** `securityLog.ts` `emailRef` = `sha256(email)[0:12]` **sem sal**. **CWE-759/CWE-916; PL-026 (dependência não disponível).**
- **Evidência (executada):** `emailRef('ana.silva@minu.co')` = `faa1863eaa4a`; um dicionário de 4 nomes corporativos recuperou o e-mail do log. O espaço de e-mails é pequeno e previsível (5 domínios fixos).
- **Impacto:** o log `rbac_change`/`rbac_denied` é pseudonimização reversível por força bruta de dicionário (quem lê logs identifica quem foi promovido/negado).
- **Correção:** HMAC-SHA256 com chave do servidor (ex.: derivada de `SESSION_SECRET` ou `LOG_PSEUDONYM_KEY`) e truncar; ou registrar só o papel/contagem. **Dono:** product-fullstack. **Status:** OPEN.

### G-015 — LOW (Baixo = Impacto Médio × Prob. Muito Baixa hoje) — Checagem de `.map` contornável por percent-encoding (defesa em profundidade quebrada)
- **Componente:** `httpGuards.ts` `isSourceMapPath` × `static-path.ts` `resolveStaticPath`. **CWE-178/CWE-647.**
- **Evidência (executada):** `isSourceMapPath('/assets/a.js%2Emap')` = **false**, enquanto `resolveStaticPath` decodifica e resolve para `…/a.js.map`; idem `%2emap`, `.map/`, `.map%00`. **Inerte hoje** (build gera 0 `.map` e `/assets/*` inexistente devolve 404), mas se alguém religar `sourcemap` o 404 declarado "de rede de segurança" não protege.
- **Correção:** avaliar `isSourceMapPath` sobre o caminho **decodificado/normalizado** (o mesmo de `resolveStaticPath`) e rejeitar byte nulo. **Status:** OPEN.

### G-016 — MEDIUM (Médio = Impacto Médio × Prob. Baixa) — Bundle gated é servido com `Cache-Control: public, max-age=31536000, immutable`
- **Componente:** `server.ts` `serveStatic` (`.js/.css/.png/.svg/.woff2`). **CWE-524/CWE-525; OWASP A05; PL-025 §9.2.1 (need-to-know).**
- **Evidência (leitura de código; infraestrutura NÃO VERIFICADA):** o gate de G-001 depende de a resposta chegar ao origin; com `public` + `immutable`, um CDN/proxy compartilhado (Cloudflare do Render; CloudFront/ALB no plano AWS de `docs/13`) pode servir o JS **a quem não tem sessão/perfil** depois do primeiro acesso autorizado, anulando o gate. Sem `Vary: Cookie`.
- **Correção:** `private, no-cache`/`no-store` para assets de app autenticado (ou `private, max-age=…, immutable`), e teste de header; confirmar na camada de borda real. **Dono:** product-fullstack. **Status:** OPEN.

### G-017 — LOW (funcional) — UI não foi adaptada aos fixes (agregação por motivo fica inerte; falhas silenciosas)
- **Evidência:** `useSla.pause` envia só `{reason, missingItems}` (sem `reasonCode`); nenhum `maxLength` nos campos; `postJson` devolve `false` sem mensagem em 400/403. Consequência: toda pausa nova agrega em **"Outro"** ⇒ o quadro "pausas por motivo" dos indicadores (entregável do sponsor) perde utilidade; texto >200 chars falha sem feedback. O próprio autor declarou como ASSUMPTION/follow-up de UX.
- **Recomendação:** select de `reasonCode` + contador de caracteres + mensagem de erro. **Dono:** product-designer/product-fullstack. **Status:** OPEN.

### G-018 — LOW (Baixo = Impacto Médio × Prob. Muito Baixa) — Idempotência/conflito da decisão do approver não é atômica
- **Evidência (executada):** duas decisões conflitantes em paralelo (`Promise.all`, dois approvers, repo em memória) ⇒ **201 e 201**, 2 linhas `approval.*` (check-then-insert sem lock/UNIQUE). Em processo único com SQLite síncrono, requisições HTTP separadas não intercalam dentro do handler, então o risco real é **baixo hoje** e passa a ser real com múltiplas instâncias/repositório assíncrono.
- **Correção:** unicidade em banco (`UNIQUE(proposal_id, kind)` para decisão) ou checagem dentro de transação. **Status:** OPEN (não bloqueia, depende de G-006 funcional).

## NÃO VERIFICADO

HTTP real **autenticado** (413 no servidor, 415/cross-site, gate do SPA, 404 de `.map`, `Cache-Control` dos assets) — exigiria cookie de sessão forjado, vetado por política; `smoke:sla` (mesmo motivo: minta cookie); `docker build`/`trivy image`; Cloudflare/CloudFront/ALB reais (G-016); Google OAuth real e UI no browser; concorrência multi-processo; scan de segredos no **histórico** git e SAST (gitleaks/trufflehog/semgrep não instalados — apenas regex sobre o diff e arquivos novos: 0 hits); DAST; `.github/workflows/ci.yml` roda typecheck/test/build/`audit --omit=dev`, mas **sem secret scan, SAST ou container scan** (carry-over G-012/Recommended).

## Resumo de verificação executada

`typecheck` OK (3 ws) · testes **109 + 54 + 218 = 381, 0 falhas** (contagem real = relato; os 33 novos incluem `failClosed`/`guardianFixes`, que exercitam o comportamento) · 3 builds OK · `npm audit --omit=dev` = **0** · `npm audit` completo = 6 (2 critical, 1 high, 3 moderate; **todas dev-only** vitest/tinypool/vite/esbuild, **pré-existentes**, não introduzidas por este diff; PQ-029 = dependência).

## Required Actions
1. **G-013** corrigir (allowlist `development`/`test`; qualquer outro ⇒ produção) + teste de regressão. 2. **G-016** mudar `Cache-Control` dos assets gated. 3. DECISÃO do sponsor registrada (ADR) para **G-001 A/B/C, G-002, G-006 funcional** (continuam OPEN). 4. Re-submeter G-013/G-016 (e G-014/G-015 se possível) para nova re-revisão.

## Recommended Actions
G-014 (HMAC), G-015 (decode antes do `.map`), G-017 (UI reasonCode/limites/erros), G-018 (UNIQUE), G-012 (ADRs, IDOR test); adicionar secret scan + SAST + `trivy image` ao CI; executar `smoke:sla` e as provas HTTP autenticadas em ambiente de homologação com login real; Production Readiness Review só após G-013/G-016 e as decisões do sponsor.

## Riscos no formato PL-025 §9.1.1 (novos)
| Projeto | Risco (nível) | Descrição do Risco | Impactos | Ações de Contorno |
|---|---|---|---|---|
| Bondly | G-013 (Alto) | `NODE_ENV` ≠ `production` ⇒ segredos de dev públicos + repositório em memória sem falhar | Bypass total de auth; perda de auditoria | Allowlist dev/test; recusar boot; teste |
| Bondly | G-016 (Médio) | Bundle gated com cache `public/immutable` | Gate de perfil contornado por cache compartilhado | `private`/`no-store`; validar CDN |
| Bondly | G-014/G-015/G-017/G-018 (Baixo) | Pseudonimização fraca; `.map` por encoding; UI inerte; corrida teórica | Baixo isolado | HMAC; decode; UX; UNIQUE |

---

## Resposta do autor (rodada 2) — product-fullstack, 2026-11-04

> Sem commit/push/AWS. O autor NÃO marca VERIFIED; todos os itens abaixo aguardam o Guardian. Caminhos relativos a `apps/`.

| ID | Status | Correção (arquivo:linha) | Teste de regressão |
|---|---|---|---|
| G-013 | **FIXED-PENDING-REVIEW** | Novo `auth-proxy/src/envMode.ts` (`isProductionEnv`: allowlist `{development,test}`, trim + lowercase; todo o resto = produção). Usado em `auth-proxy/src/config.ts:45` e `auth-proxy/src/sqliteRepository.ts:413`. `.env.example`, `docs/13` (tabela de env) e `docs/10` atualizados. Dockerfile/`render.yaml` já fixam `production`. | `failClosed.test.ts`: `it.each` de `staging/prod/Production/' PRODUCTION '/qa/''` ⇒ `data_dir_missing` + `loadConfig` lança; `development/test/' Development '/TEST` ⇒ não-prod. Boot real: `staging`/`Production`/ausente sem DATA_DIR ⇒ exit 1 (`boot_refused_ephemeral_repo`); `development` sobe; `production`+DATA_DIR temporário sobe (sqlite). |
| G-016 | FIXED-PENDING-REVIEW | `auth-proxy/src/httpGuards.ts:92` (`PROTECTED_ASSET_CACHE_CONTROL='private, no-store'`, `PROTECTED_ASSET_VARY='Cookie'`) aplicados a TODA resposta de `serveStatic` em `auth-proxy/src/server.ts:164-165` (antes `public, max-age=31536000, immutable` só em js/css/png/svg/woff2). `docs/13`: seção "Cache de borda (G-016)". | `guardianFixes.test.ts` (constantes sem `public/immutable/s-maxage`). Header HTTP real autenticado: NÃO VERIFICADO. |
| G-014 | FIXED-PENDING-REVIEW | `auth-proxy/src/securityLog.ts:14` — HMAC-SHA256, chave = HMAC(SESSION_SECRET, `bondly:log-pseudonym:v1`), 16 hex; `setLogPseudonymKey(cfg.sessionSecret)` no boot (`server.ts`). Sem chave (testes) = aleatória por processo. | `guardianFixes.test.ts` G-014: determinístico por chave, difere entre chaves, ≠ sha256 puro, ≠ `faa1863eaa4a`. |
| G-015 | FIXED-PENDING-REVIEW | `auth-proxy/src/httpGuards.ts:65` — decode iterativo (≤5), `posix.normalize`, nega `.map` com `/`,`\`,espaço/ponto finais, byte nulo, decode inválido ou encode profundo. | `guardianFixes.test.ts` G-015 (12 vetores: `%2E`, `%252E`, `%25252E`, `.map/`, `.map%00`, `.MAP`, `..` etc. + negativos legítimos + coerência com `resolveStaticPath`). |
| G-018 | FIXED-PENDING-REVIEW | `ProposalRepository.recordApprovalDecision` (`domain.ts:191`); memória síncrona (`memoryRepository.ts:102`); SQLite `approval_decisions PK(proposal_id,kind)` + `INSERT … ON CONFLICT DO NOTHING` em `BEGIN IMMEDIATE`, lê o vencedor, promove decisões legadas da auditoria (`sqliteRepository.ts:245`); `api.ts:229` usa o resultado (201 / 200 idempotente / 409). Migração aditiva. | `guardianFixes.test.ts` G-018: `Promise.all` divergente ⇒ 201+409 e 1 auditoria; igual ⇒ 200+201; SQLite com 2 chamadas concorrentes ⇒ 1 `created`, mesmo vencedor. |
| G-017 | FIXED-PENDING-REVIEW | `commercial-workspace/src/hooks/pauseReasons.ts` (catálogo pt-BR, 6 códigos + `maxLength` 200); `hooks/useSla.ts` `pause(reason, missingItems, reasonCode)`; `components/SlaCard.tsx` select obrigatório + `maxLength`, limpa após sucesso. Relógio (`reduceSla`) intocado. | `components/SlaCard.test.tsx` (botão desabilitado sem categoria; POST com `reasonCode`); `guardianFixes.test.ts` G-017 (sincronia do catálogo com `PAUSE_REASON_LABELS`). |

**ASSUMPTIONs:** (1) `NODE_ENV` inválido ⇒ tratado como produção (não recusa com `invalid_node_env`) — sugestão alternativa do Guardian não adotada, efeito fail-closed equivalente; (2) catálogo do frontend é cópia do servidor (não há pacote compartilhado), protegida por teste de sincronia; (3) pseudônimo muda de valor se `SESSION_SECRET` rotacionar (aceitável para logs); (4) mensagem de erro/contador de caracteres na UI (resto de G-017) não implementada — só select + `maxLength`.
**NÃO VERIFICADO:** headers reais autenticados (`Cache-Control`/`Vary`, 404 de `.map`), CDN/ALB, múltiplos processos sobre o mesmo SQLite, migração de DB legado com decisões já existentes no `audit` (coberta só por leitura de código).
**Fora de escopo (inalterado):** G-001 A/B/C, G-002, G-006 funcional, G-012.

## Resposta do autor (G-002) — **IMPLEMENTADO-PENDENTE-REVISÃO**

> Autor não marca VERIFIED; somente o Guardian. Decisão do sponsor em [doc 16](./16-decisoes-g002-g006.md). Sem commit/push/AWS. Caminhos relativos a `apps/auth-proxy/src/`.

| Item | O que mudou | Onde | Teste de regressão |
|---|---|---|---|
| Guard de dono (ponto único) | `canAccessProposal` (business=dono; tech/approver=fora do rascunho; admin=todas); `visible()` em toda rota com `:id`; listagem filtrada no servidor; `repo.update(..., {requireOwner})` fecha a corrida com reatribuição; 404 idêntico a inexistente + `rbac_denied` (`owner_scope`, pseudônimo HMAC) | `scope.ts`, `api.ts`, `memoryRepository.ts`, `sqliteRepository.ts`, `securityLog.ts` | `ownerScope.test.ts`: 16 rotas × (business alheio / tech-approver em rascunho / dono-admin), em memória e SQLite; mutação do guard derruba 19 testes |
| Reatribuição por admin | ação `admin.reassign_owner`; `GET/PUT/POST /api/admin/proposals/:id/owner`; e-mail ASCII estrito + domínio autorizado (400); `owner_audit` append-only (trigger) na mesma transação; `version`+1 | `rbac.ts`, `api.ts`, `domain.ts`, repositórios | matriz 4 papéis × 15 ações (`rbac.test.ts`); A perde / B ganha; auditoria; 403 para não-admin e admin legado |
| Concorrência | escrita com versão defasada ou dono antigo ⇒ 404; TOCTOU simulado (get defasado) barrado no repositório; 409 com `actual` nunca vaza a não-dono | idem | `ownerScope.test.ts` (4 cenários) |
| Migração | `owner_audit` aditiva; `owner_email` ausente vira `''`; dono legado normalizado | `sqliteRepository.ts` | abre banco com schema anterior e muito anterior (2 testes) |
| UI mínima | "Reatribuir dono de proposta" no painel admin existente | `commercial-workspace/src/components/AssignmentsAdmin.tsx` | `rbacUi.test.tsx` |

**ASSUMPTIONs:** (1) 403 por ação precede o guard (constante, não revela existência); (2) mesmo dono = no-op 200; (3) ex-dono com versão defasada recebe 404; (4) testes existentes que usavam tech/approver sobre rascunho passaram a submeter a proposta antes (consequência da decisão).
**Residual:** IDs sequenciais globais sugerem volume total ao criar uma proposta. **NÃO VERIFICADO:** HTTP autenticado real (OAuth/cookie), UI no browser, multi-processo sobre o mesmo SQLite.


---

## Re-revisão 2 — Guardian independente (product-quality-security), 2026-11-04

> Revisor ≠ autor (PL-025 §8.3). Sem commit/push/AWS; **código não alterado**. Auto-relato tratado como hipótese.

**Já confirmado por execução:** `typecheck` OK (3 ws) · testes reais **109 + 56 + 379 = 544, 0 falhas** (bate com o relato final do autor: engine 109, UI 56, auth-proxy 379) · 3 builds OK, `.map` em `dist` = 0 · `npm audit --omit=dev` = 0.
**Boot real de `dist/server.js` (env -i, DATA_DIR temporário, G-013):** `NODE_ENV` = `staging`/`prod`/`Production`/` production `/`qa`/`''`/ausente, sem DATA_DIR ⇒ **exit 1** (falha em `PUBLIC_URL` obrigatória, antes mesmo do repositório); `staging` completo + DATA_DIR ⇒ `prod:true`, `repo:sqlite`; `development`/`TEST` ⇒ `prod:false`, memória; `production` + `DATA_DIR=''` ⇒ exit 1 `boot_refused_ephemeral_repo`; `ALLOW_EPHEMERAL_REPO=true` ⇒ sobe com warn.

**Método dos testes adversariais (descartáveis, removidos):** servidor **hermético local** (`dist/server.js`, `NODE_ENV=development`, segredo aleatório próprio, memória e SQLite temporário, porta local) com cookies de sessão assinados por **esse segredo de teste** (nenhum sistema real foi atingido nem credencial real usada). 66 checagens em memória + 73 em SQLite (inclui bancos legados semeados com `owner_email` vazio/caixa mista e decisão só na auditoria), 20 rotas/métodos × 3 papéis × (proposta alheia × inexistente), 27 vetores `.map` contra um `.map` plantado, 4 scripts de boot/SQLite/segredo fraco. Os scripts foram apagados.

## Status por Finding (rodada 2 + G-002)

| ID | Status | Evidência executada |
|---|---|---|
| G-013 | **VERIFIED** | Boot real: `staging`/`prod`/`Production`/` production `/`qa`/`''`/ausente sem DATA_DIR ⇒ **exit 1** (cai em `PUBLIC_URL` obrigatória; com URL, cai em `boot_refused_ephemeral_repo`); `staging` completo ⇒ `prod:true` sqlite; `development`/`TEST` ⇒ não-prod; `production`+`DATA_DIR=''` ⇒ exit 1. `grep`: `NODE_ENV` só é lido em `envMode.ts`; `config.ts`, `sqliteRepository.ts`, health e cookies `Secure` usam `isProd` derivado. Dockerfile e `render.yaml` fixam `production`; CI não sobe o servidor. Residual ⇒ **G-019**. |
| G-016 | **VERIFIED** (HTTP real, sessão de teste) | `/`, `/index.html`, `assets/*.js|css`, fallback SPA, HEAD, `If-None-Match:*`, `If-Modified-Since` ⇒ 200 com `Cache-Control: private, no-store` + `Vary: Cookie`; **sem ETag/Last-Modified** (não há 304); sem perfil ⇒ 403 `no-store`, sem bundle; sem sessão ⇒ 302 `/login`. `grep`: `immutable`/`max-age` só em comentário. Residual ⇒ **G-020**. CDN/ALB reais NÃO VERIFICADOS. |
| G-014 | **VERIFIED** | HMAC-SHA256 com chave derivada de `SESSION_SECRET`; pseudônimo ≠ sha256 truncado (12 e 16 hex). Com tráfego de negação, mudança de perfil e reatribuição, stdout+stderr do servidor: **0 e-mails em claro** (regex). Inspeção de todos os `console.*` (`login_denied` loga só `hd`; `unhandled`/`login_error` logam `message` de erro, sem e-mail). |
| G-015 | **VERIFIED** | 27 vetores contra `.map` plantado em `assets/` (`%2E`, `%2e`, `%252E`, `%25252E`, `.MAP`, `.Map`, `/`, `%00`, espaço, ponto final, `;x=1`, `;`, `%5C`, `\`, `%6d`, `./`, `../`, `//`, `?x`, `#`, `%3B`, `%2F`, ZWSP) ⇒ **nenhum devolve o conteúdo**; sem falso-positivo (`app.js`, `map.js`, `a.mapper.js`, `x.map.js`). |
| G-018 | **VERIFIED** | HTTP, 2 approvers em paralelo, decisões divergentes ⇒ **201 + 409**, 1 linha de auditoria; repetição igual ⇒ 200 `idempotent`. SQLite legado com `approval.approved.excecao_comercial` **só na auditoria**: decisão conflitante ⇒ 409 `existing:approved`; igual ⇒ 200. Atenção honesta: processo único, HTTP sequencial no event loop; a garantia multi-processo vem do `PRIMARY KEY` + `BEGIN IMMEDIATE` (lido, **não** exercido com 2 processos). |
| G-017 | **VERIFIED** (escopo declarado) — residual UX LOW | Catálogo UI == servidor (6 códigos/rótulos, comparado por execução); `SlaCard` exige `reasonCode` (select) e `maxLength=200`; `useSla.pause` envia `reasonCode`; testes de UI passam. **Ainda não há mensagem de erro/contador** (declarado pelo autor, ASSUMPTION 4): falha 400/403 continua silenciosa. Não bloqueia. |
| **G-002** | **VERIFIED** (no escopo testado; ressalvas G-021/G-022 e NÃO VERIFICADO) | Ver prova abaixo. |
| G-001 A/B/C, G-006 funcional, G-012 | **OPEN** (fora de escopo; impacto inalterado: motor/tabelas de custo e margem seguem no bundle de qualquer usuário com perfil; `approver` ainda sem fluxo funcional; ADRs/IDOR-test-gap de G-012 parcialmente cobertos por `ownerScope.test.ts`, ADRs ausentes) |

### Prova G-002 (executada)
- **404 indistinguível:** para `business` (bob→proposta de alice), `tech` e `approver` (→ rascunho de alice), cada uma das **20 rotas/métodos** (GET/PUT/POST de :id, audit, sla, sla/pause|resume|complete, meetings, meetings/:m/transition, approval, transition com e sem `version`, `/admin/.../owner`, **HEAD, OPTIONS, DELETE, PATCH**) responde **status + corpo + conjunto de headers idênticos** ao de `BONDLY-2027-009999` inexistente. Nenhum corpo contém título/e-mail do dono. Estado da proposta intacto após os ataques (`version=1`).
- **Tempo:** mediana de 80 requisições: alheio 0,35 ms · inexistente 0,29 ms · próprio 0,28 ms (ruído; o `logRbacDenied` síncrono não cria canal útil em rede).
- **403-por-ação** (pausa de SLA, reatribuição) é idêntico para existente/inexistente ⇒ não é oráculo.
- **Escopo:** business só lista/lê as suas (também com `?owner=`, `?all=1`, `X-Forwarded-User/Email/Host/For`, `X-Original-User`, `X-HTTP-Method-Override`, `X-Owner-Email` ⇒ sem efeito); listagem sem total/paginação/ETag; tech/approver não alcançam rascunho (lista vazia) e passam a alcançar após `submeter_analise` (GET, audit, sla, meetings); admin alcança todas; business não vê `meetings` nem do próprio (G-004).
- **Normalização do dono:** proposta criada por sessão `Bob@Minu.co` é acessada por `bob@minu.co` e negada a alice; SQLite legado com dono `"  Legacy.Owner@MINU.co "` acessível ao dono normalizado; legado **sem dono** ⇒ invisível a business, visível a tech (se submetida) e admin; admin reatribui a órfã.
- **Reatribuição:** 403 (GET/PUT/POST) para business, tech, approver e sem perfil; `can(...,'admin.reassign_owner')` verdadeiro **só** para `admin` (4 papéis); `admin.manage_users` idem; 400 para `ghost@outro.com`, `@minu.co.evil.com`, `+alias`, vazio, `null`, número, `@sub.minu.co`, `b@@`, `<s>@`; normaliza `ALICE@Minu.co`; mesmo dono ⇒ no-op `changed:false`; `version` defasada ⇒ 409; `version:'abc'` ⇒ 400; alice→bob: alice perde GET/PUT/transition (**404**, não 409 com `actual`), bob ganha; auditoria de/para/ator correta; novo dono não lê a rota admin.
- **Corrida/versão:** 25 rodadas `PUT commercial` do dono × `reassign` em paralelo: invariantes mantidas (dono final = bob; nenhuma escrita perdida-mas-aplicada). *Limitação honesta:* em processo único as duas requisições serializam; a janela real foi coberta pelo TOCTOU do repositório (`update` com `requireOwner` ⇒ NotFound, testado com caixa/espaço divergentes) e `UPDATE … WHERE version=?`.
- **Auditoria `owner_audit`:** `UPDATE`/`DELETE` ⇒ ABORT ('append-only'); mesma transação: com trigger sabotador no `INSERT` da auditoria, a reatribuição **faz ROLLBACK** (dono/versão inalterados) e a conexão fica utilizável. INFO: `INSERT OR REPLACE` reescreve linha (só acesso direto ao arquivo; mesmo residual já registrado para `assignment_audit`).
- **Indicadores/SLA agregados:** `/api/sla/indicators` (approver) sem id, e-mail, título nem texto livre (`SEGREDO-ALICE`, `item-alice`); business ⇒ 403; `GET sla` para business sem texto livre.

## Novos Findings (Re-revisão 2)

### G-019 — MEDIUM (matriz: **Médio** = Impacto Muito Alto × Prob. Muito Baixa) — `SESSION_SECRET` em produção aceita o valor de DEV público e segredos triviais
- **Componente:** `config.ts` `required('SESSION_SECRET', …)` (só checa presença). **CWE-798/CWE-521; PL-025 §9.2.1 (segredos), OWASP A02/A07.**
- **Evidência (executada, boot `NODE_ENV=production`, DATA_DIR ok):** `SESSION_SECRET=dev-session-secret-not-for-production-use` (string pública no repositório) ⇒ sobe; cookie assinado com ela para `admin@minu.co` ⇒ `GET /api/proposals` **HTTP 200** (bypass total de autenticação). `SESSION_SECRET=x` ⇒ também sobe. `render.yaml` usa `generateValue`, o que mitiga o caminho oficial; o risco é override manual/Docker/AWS.
- **Correção:** em produção recusar boot se `SESSION_SECRET` < 32 caracteres ou igual ao fallback de dev (comparar contra a constante); teste de regressão. **Dono:** product-fullstack. **Status:** OPEN.

### G-020 — LOW (Baixo) — Guarda "404 real para /assets/*" é código morto
- **Componente:** `server.ts` `serveStatic` (`rel.startsWith('assets/')`), pois `rel` vem de `normalize('/assets/x.js')` **com barra inicial**. **Pré-existente** (já no HEAD).
- **Evidência (executada):** `GET /assets/inexistente.js` ⇒ **200 `text/html`** (index.html via fallback SPA), não 404. Sem impacto de segurança hoje (G-016 torna o fallback `private,no-store`); impacto funcional: chunk antigo após deploy vira "Unexpected token <" e a defesa em profundidade citada em G-001/G-015 não existe.
- **Correção:** comparar com `rel.replace(/^[\\/]+/, '')` ou checar `urlPath`; teste. **Status:** OPEN.

### G-021 — LOW (INFO funcional) — Efeito colateral da regra de visibilidade tech/approver
- `retomar` devolve a proposta a `rascunho_comercial`; tech/approver **perdem acesso** (404) a SLA, reuniões e auditoria dela enquanto o relógio/`started` e as decisões continuam existindo e contando nos indicadores. Consequência direta da decisão do sponsor (docs/16 §1); registrar como limitação conhecida. Também: reatribuição para e-mail válido **sem usuário/perfil** é aceita (proposta órfã até o usuário logar) e `"bob@minu.co\n"` (espaço/quebra **nas pontas**) é aceito por `trim` (normalização documentada, não é bypass). IDs sequenciais globais (`BONDLY-2027-00000N`) permitem inferir volume (residual declarado). **Status:** ACCEPTED-RISK sugerido, depende do sponsor.

### G-022 — LOW — `reassign` sem `version` obrigatória
- `PUT /api/admin/proposals/:id/owner` aceita omitir `version`; dois admins podem sobrescrever às cegas (a auditoria de/para continua correta, lida dentro da transação). Tornar `version` obrigatória (ou comparar `fromOwner` esperado no repositório). **Status:** OPEN (não bloqueia).

## NÃO VERIFICADO
Google OAuth real e UI no browser; CDN/ALB (cache de borda); **concorrência multi-processo** sobre o mesmo SQLite; `docker build`/`trivy image`; secret scan do histórico git e SAST (ferramentas ausentes; regex no diff: 0 hits); DAST; CI não tem secret scan/SAST/container scan; `npm audit` completo = 6 (2 critical, 1 high, 3 moderate), todas dev-only e pré-existentes (PQ-029 = dependência não disponível); PL-026/PL-013/PL-004 = dependências nomeadas, conteúdo não disponível.

## Riscos (PL-025 §9.1.1) — novos
| Projeto | Risco (nível) | Descrição | Impactos | Ações de contorno |
|---|---|---|---|---|
| Bondly | G-019 (Médio) | Segredo de sessão público/fraco aceito em produção | Forja de sessão = bypass de auth | Validar tamanho/valor no boot; `generateValue` |
| Bondly | G-020/G-021/G-022 (Baixo) | Guarda morta; visibilidade no `retomar`; reassign sem versão | Funcional/baixo | Corrigir guarda; documentar; exigir `version` |

## QUALITY STATUS (atualizado): **CHANGES REQUIRED**
G-013, G-014, G-015, G-016, G-017, G-018 e **G-002** estão **VERIFIED** por execução; nenhum bypass de escopo por dono foi encontrado. Sobra **1 MEDIUM novo (G-019)** de fail-closed de segredo e 3 LOW.
**RELEASE STATUS (produção): BLOCKED** — (1) **G-001 A/B/C** (motor/tabelas de custo e margem no bundle de qualquer usuário com perfil) e **G-006 funcional** continuam OPEN, aguardando implementação; (2) G-019 sem correção (MEDIUM com exploração trivial se mal configurado). G-002 deixa de ser bloqueio.

## Required Actions
1. G-019: recusar `SESSION_SECRET` curto/igual ao de dev em produção + teste. 2. Implementar G-001-A e G-006 (docs/16) e submeter ao Guardian. 3. Re-submeter G-019 (e G-020/G-022 se possível).

## Recommended Actions
Mensagens de erro/contador na UI (G-017); G-020 corrigir guarda; G-022 `version` obrigatória; ADR dos itens G-002/G-013 (G-012); teste de 2 processos sobre o SQLite; secret scan + SAST + `trivy image` no CI; PRR só após G-001/G-006/G-019.


---

## Resposta do autor (G-019..022 e G-006) — 2026-11-04

> Autor ≠ revisor. **IMPLEMENTADO-PENDENTE-REVISÃO**; nada marcado VERIFIED. Sem commit/push/AWS.

| ID | O que foi feito | Evidência |
|---|---|---|
| G-019 | `loadConfig` em produção recusa `SESSION_SECRET` = default de dev, < 32 chars, ≤ 4 símbolos distintos ou padrão repetido (e `GOOGLE_CLIENT_SECRET` = default de dev); `server.ts` captura, loga `boot_refused_config` (nome+motivo, nunca o valor) e `exit 1`. `.env.example` e doc 13 atualizados. | `hardening2.test.ts`; boot real do `dist`: 3 valores inválidos ⇒ exit 1 |
| G-020 | `isAssetPath` (normaliza barra inicial/caixa) substitui o guard morto; asset inexistente ⇒ 404 `text/plain`; rotas de navegação seguem com fallback SPA. | teste unitário; HTTP real: `/assets/inexistente.js` 404, `/propostas/x` 200 html |
| G-021 | Reatribuir exige perfil atribuído ao novo dono: 400 `new_owner_without_role`; perfil ≠ business ⇒ 400 `new_owner_not_business`. `retomar`: tech/approver mantêm acesso ao HISTÓRICO (SLA, auditoria, reuniões) de proposta já submetida (`canAccessResumedHistory`); corpo/lista/escrita e rascunho nunca submetido seguem 404 (G-002 intacto). | `hardening2.test.ts` |
| G-022 | `version` obrigatória (400 `version_required`; defasada 409). UI lê a versão atual e a envia; mensagens pt-BR novas. | testes API + `rbacUi.test.tsx` |
| G-006 | Ver doc 10 §11 (API, estados, RBAC, auditoria, invalidação, UI). **CONFLICT:** alerta de margem antes de `emitido` não ligado (depende de cotação no servidor, G-001-A). | `approvals.test.ts` (memória+SQLite), `approvalUi.test.tsx` |

**NÃO VERIFICADO:** HTTP autenticado real via OAuth/cookie de navegador, UI no browser, multi-processo sobre o mesmo SQLite, alerta de margem (CONFLICT), invalidação atômica com o update da proposta (2 transações).


---

## Re-revisão 3 — Guardian independente (product-quality-security), 2026-11-04

> Revisor ≠ autor (PL-025 §8.3). Sem commit/push/AWS; **código não alterado**. Auto-relato tratado como hipótese.
> (A versão preliminar foi gravada primeiro; o consolidado final está na seção "Re-revisão 3 — Consolidado" abaixo e prevalece.)

**Confirmado por execução até aqui:** `typecheck` OK (3 ws) · testes reais **engine 109 · UI 60 · auth-proxy 444 = 613, 0 falhas** (bate com o relato do autor).
**Pendente de execução nesta rodada:** 3 builds, `npm audit --omit=dev`, boot real, ataques adversariais G-006/G-019/G-020..022, migração em banco anterior.
**Leitura de código já concluída:** `config.ts`, `workflow.ts`, `api.ts` (rotas G-006), `sqliteRepository.ts` (approval_requests/decide/invalidate).

Hipóteses de leitura a provar/refutar por execução: (H1) `decideApprovalRequest` não confere `proposals.status = 'aguardando_aprovacao_gestor'` antes de restaurar `previous_state`; (H2) janela entre `repo.update` (estado) e `invalidateApprovals` (2 transações); (H3) `weakSecretReason` aceita sequência trivial de 32 chars distintos; (H4) edição imaterial permitida durante a pendência.


---

## Re-revisão 3 — Consolidado (execução concluída)

**Executado:** `typecheck` OK (3 ws) · testes reais **109 + 60 + 444 = 613, 0 falhas** (bate com o autor) · 3 builds OK (SPA sem `.map`; `.map` só em `apps/auth-proxy/dist`, não servido) · `npm audit --omit=dev` = **0** · boot real de produção do `dist/server.js` (DATA_DIR temporário, segredo de teste, cookies assinados pelo teste; nenhum sistema real) · ataques descartáveis em memória **e** SQLite (2 repositórios) · rollback/imutabilidade/migração/multi-processo (6 processos) sobre arquivos SQLite temporários. Temporários removidos por arquivo (sem `rm -rf` amplo). Código do produto **não** alterado.

### Status por Finding

| ID | Status | Evidência executada |
|---|---|---|
| G-019 | **VERIFIED** (residual LOW → G-030) | Boot prod: `SESSION_SECRET` = default de dev, `x`, 31 chars, 32×`a`, `abab…`, 40 espaços, ausente, vazio ⇒ **exit 1** (`boot_refused_config`, só nome+motivo, **0 vazamento** do valor); `GOOGLE_CLIENT_SECRET=dev-client-secret` ⇒ exit 1. Cookie assinado com o segredo de dev ⇒ **401** no servidor com segredo real. `grep`: sem outro default de dev (`profileCodes.ts`/`session.ts` limpos); `render.yaml` usa `generateValue`; Dockerfile roda `USER node`, `NODE_ENV=production`. Residual: sequência de 32 chars distintos (`abc…345`, `qwerty…`, `Password1234…`) **sobe**. |
| G-020 | **VERIFIED** | HTTP real: `/assets/inexistente.js` ⇒ 404; `/assets/<bundle legítimo>` ⇒ 200; `/propostas/x` e `/` ⇒ 200 (SPA); `/assets/%2e%2e/index.html` e `/assets/../index.html` ⇒ 200 só do `index.html` (sem traversal); `/ASSETS/nao.js` ⇒ 404; `/assets` e `/assets/` ⇒ 404. |
| G-021 | **VERIFIED** (INFO abaixo) | Reatribuir: sem perfil ⇒ 400 `new_owner_without_role`; tech/approver/admin ⇒ 400 `new_owner_not_business`; business ⇒ 200; mesmo dono ⇒ no-op. Pós-`retomar`, tech e approver: corpo **404**, lista **0**, PUT commercial 403 / technical 404, transition 404, solicitar aprovação 404/403 ⇒ **G-002 não regrediu**; leem audit/SLA (200). Rascunho nunca submetido: 404 em tudo. **INFO:** tech (via `visibleHistory`) **escreve** SLA (pause/complete) e cria reunião no histórico de proposta retomada (201/200) — coerente com a intenção (relógio técnico), mas fora do texto "só histórico"; documentar. |
| G-022 | **VERIFIED** | `version` ausente ⇒ 400 `version_required`; defasada ⇒ 409; string numérica é coagida (aceita). Admin-only (business/tech/approver ⇒ 403). |
| **G-006** | **FIXED-PENDING** (não VERIFIED) | Parte substancial verificada (abaixo), **mas G-023 (HIGH) quebra a garantia de invalidação (brief §4)** e G-024 deixa janela. Alerta de margem = CONFLICT não ligado (G-026). |
| G-001 A/B/C, G-012 | **OPEN** (inalterado; G-001-A não implementado: motor/tabelas de custo/margem seguem no bundle e o approver recebe `commercial` com desconto; impacto HIGH reafirmado) |

### G-006 — o que resistiu (executado, memória + SQLite)
- **SoD:** solicitante não decide (403 `self_decision_forbidden`) com caixa/espaço diferentes de e-mail; **promovido a approver entre pedido e decisão** (biz→approver, tech→approver) continua barrado; admin 403; cookie legado `role:approver` com `LEGACY_PROFILE_CODES=true` ⇒ 403 (legado nunca concede approver); reatribuição do dono com pendência não altera o solicitante registrado. Mutation sanity do autor reproduzível pela leitura (`violatesSeparationOfDuties` único ponto). Residual INFO: SoD é por e-mail literal (alias/ponto de provedor não normalizado; admin API já recusa `+`).
- **Escopo/404:** business alheio 404; rascunho não aceita solicitação (409); tech pedindo kind de business 403; approver solicitando 403; id inexistente 404 (decisão e solicitação).
- **Entrada:** `kind` `''`/CAIXA ALTA/`__proto__`/`constructor`/`toString`/número/array/objeto ⇒ 400; justificativa vazia/espaços/`\n\t` ⇒ 400; 500 ⇒ 201, 501 ⇒ 400; 250 emojis ⇒ 201, 251 ⇒ 400 (limite em unidades UTF-16); número/array ⇒ 400 `invalid_text`; `decision` `APPROVED`/`''`/null/número/array ⇒ 400; rejeição sem justificativa ⇒ 400. **Falha:** `\u200b` aceito como justificativa (G-027).
- **Concorrência:** 2 solicitações paralelas ⇒ 201+409, 1 pendente; 2 decisões divergentes paralelas ⇒ **201+409** (HTTP real), repetição igual ⇒ 200 idempotente, divergente depois ⇒ 409; **6 processos** sobre o mesmo arquivo: 1 pendente, 1 decisão, 1 linha de auditoria (invariantes mantidas; ver G-029).
- **Estados:** com pendência, `emitir/consolidar/retomar/submeter/iniciar/aprovar/reprovar/ajustes` ⇒ 409 em todos; 2ª solicitação ⇒ 409; solicitar de `emitido` ⇒ 409. Aprovar/rejeitar volta ao estado anterior.
- **Fila `GET /api/approvals/pending`:** approver 200; business/tech/admin/sem perfil **403**; payload só metadados+justificativa (sem custo/margem/commercial/technical); `Cache-Control: no-store`, `nosniff`, sem ETag.
- **HTTP:** cross-site / same-site / Origin alheia ⇒ 403; `text/plain` ⇒ 415; JSON inválido ⇒ 400; corpo 300 KB ⇒ **413**; `null`/`[1]` ⇒ 400; sem sessão ⇒ 401; **0 e-mails em claro** nos logs (pseudônimos HMAC; eventos `rbac_approval_*` sem e-mail).
- **Rollback transacional:** trigger sabotador no audit ⇒ solicitação **e** decisão revertem por inteiro (estado/versão/linha inalterados) e o repositório segue utilizável.
- **Banco:** `UPDATE` de status/justificativa e `DELETE` em linha decidida ⇒ ABORT; índice único parcial barra 2ª pendente; `CHECK(kind)` barra enum inválido por SQL; **migração aditiva** de banco sem `approval_requests` (esquema mínimo anterior: proposals/audit/seq) ⇒ tabela criada, proposta preservada, solicitação funciona, 3 reaberturas idempotentes.
- **SLA:** `git diff` de `packages/pricing-engine/src/sla/*` = vazio (só `index.ts` +10 linhas e `indicators.ts` novo); teste do autor compara `reduceSla` antes/depois (executado na suíte de 109+444). Solicitar/decidir não gera evento SLA.
- **Matriz RBAC 4×17 ações (executada):** approver = `proposal.read, approval.decide, approval.read_queue, sla.view_indicators`; admin sem `proposal.emit`/`approval.*`; business/tech `approval.request`; sem `see_internal` para approver/business. Confere com o doc 10.
- **UI (leitura):** sem `dangerouslySetInnerHTML`/`innerHTML`/`eval` no SPA; justificativa e solicitante renderizados como nós de texto (React escapa; payload `<img onerror>` ficou literal na API). Painel do aprovador só usa campos da `approvalView`.

## Novos Findings (Re-revisão 3)

### G-023 — **HIGH** (matriz: **Alto** = Impacto Alto × Prob. Moderada) — Mudança material de OUTRO tipo durante a pendência contorna a reanálise técnica (§5.2/brief §4)
- **Componente:** `api.ts` PUT `/commercial` e `/technical` (`pend = pendingApprovalFor(kindsInvalidatedBy(...))` + `invalidationOnEdit(current.status)`). **PL-025 §9.2.1 (integridade transacional), docs/16 G-006 item 8; CWE-841/CWE-840.**
- **Evidência (executada, memória e SQLite):** proposta `aprovado_tecnicamente`; tech cria `replanejamento_sla` (estado → `aguardando_aprovacao_gestor`); o dono (business) altera `extraDiscount` 0,01 → **0,4** ⇒ 200, `invalidated:false`, `approvalsInvalidated:0` (a pendência é de kind que o edit comercial não invalida **e** `invalidationOnEdit('aguardando_aprovacao_gestor')` = null); approver decide ⇒ estado volta a `aprovado_tecnicamente`; `consolidar` 200 → `emitir` 200 ⇒ **emitida com desconto 40% sem reanálise técnica**. Variante B2: `excecao_comercial` pendente + tech altera horas/integrações (9999) ⇒ volta a `pronto_para_emissao` com insumo técnico novo, sem reanálise.
- **Impacto:** a invalidação por mudança material (o requisito que o G-006 implementa) é burlável por qualquer par de ações legítimas; aprovação técnica deixa de valer para o que é emitido.
- **Correção:** durante `aguardando_aprovacao_gestor`, aplicar `invalidationOnEdit(pend.previousState, edit)` para **qualquer** pendência da proposta (independente do kind) e/ou bloquear edição material comercial/técnica com solicitação pendente (409); teste de regressão cobrindo os 3 kinds × 2 edições × estados de origem. **Dono:** product-fullstack. **Status:** OPEN.

### G-024 — MEDIUM (Médio = Impacto Alto × Prob. Muito baixa) — Janela não atômica e `decideApprovalRequest` sem pré-condição de estado
- **Evidência:** (a) leitura: `decideApprovalRequest` restaura `previous_state` sem conferir `proposals.status = 'aguardando_aprovacao_gestor'`; edição material faz `repo.update` e só depois `invalidateApprovals` (2 transações). (b) simulado: após a 1ª transação (estado → `aguardando_analise_tecnica`), a decisão `approved` foi aceita (201) e **sobrescreveu** o estado com `pronto_para_emissao` (memória e SQLite). Em processo único as duas etapas rodam em microtarefas contíguas (sem I/O), então **não encontrei exploração por HTTP**; vira real com falha entre as etapas (erro/`database is locked`) ou multi-processo.
- **Correção:** invalidar na MESMA transação do update; `decide` exige `status = awaiting` e `proposal_version`/estado coerentes (senão 409). **Dono:** product-fullstack. **Status:** OPEN.

### G-025 — MEDIUM (Médio = Impacto Alto × Prob. Baixa) — Proposta `emitida` (e qualquer estado) segue editável (pré-existente)
- **Evidência (executada):** `PUT /commercial` do dono em proposta `emitido` ⇒ **200** (desconto 0,5). Não há guarda de estado em edição (HEAD idem); só auditoria registra. Também sem efeito de invalidação fora de `aprovado_tecnicamente`/`pronto_para_emissao`, e edição durante `em_analise_tecnica` não reinicia a análise.
- **Impacto:** o documento emitido ao cliente pode divergir do registrado; as garantias de G-006/§5.2 ficam sem sentido pós-emissão. **Correção:** edição só em `rascunho_comercial`/`ajustes_solicitados` (business) e `em_analise_tecnica` (tech), `emitido` imutável (snapshot). **Status:** OPEN (decisão do sponsor sobre os estados editáveis).

### G-026 — HIGH funcional / **bloqueio condicional** — CONFLICT: alerta de margem antes de `emitido` não ligado
- **Matriz:** Impacto Alto × Prob. Moderada = **Alto**. REQUIREMENT do sponsor (docs/16 G-006 item 4): exceção que gere alerta de margem exige aprovação do Gestor antes da emissão. **Hoje:** `emitir` não consulta nenhuma aprovação; **aprovar ou rejeitar não gateia nada** (rejeição devolve ao estado anterior e o business emite igual). A alçada de margem nunca existiu no servidor (pré-existente), logo não é regressão.
- **Classificação:** **não é bloqueio isolado**, porque depende do G-001-A (margem só no cliente é burlável) e o G-001 já bloqueia o release. Torna-se **bloqueio por si** se o sponsor decidir liberar produção **sem** G-001-A: nesse caso exige ACCEPTED RISK assinado com prazo (a UI não pode sugerir que há controle de alçada). **Status:** OPEN (CONFLICT).

### G-027 — LOW — Justificativa só com caracteres invisíveis passa
- `'\u200b'` aceito como justificativa de solicitação (201); rejeição "obrigatoriamente justificada" aceitaria o mesmo. **Correção:** normalizar (remover `\p{Cf}`/espaços Unicode) antes de `trim`/validar vazio. **Status:** OPEN.

### G-028 — LOW — `audit` principal sem append-only; `INSERT OR REPLACE` contorna a imutabilidade de `approval_requests`
- `UPDATE`/`DELETE` em `audit` da proposta (inclui `approval_request.*`) ⇒ permitido; `INSERT OR REPLACE` reescreve solicitação decidida (acesso direto ao arquivo). Só `owner_audit`, `assignment_audit` e `approval_requests` têm trigger. PL-025 §9.2.1 (não-repúdio). **Correção:** triggers em `audit`/`sla_events`; `PRAGMA recursive_triggers=ON`. **Status:** OPEN.

### G-029 — LOW — SQLite sem `busy_timeout`: contenção multi-processo vira 500
- 6 processos: invariantes preservadas (1 pendente, 1 decisão, 1 auditoria), mas chamadas falham com `database is locked`. Render com disco ⇒ instância única mitiga. **Correção:** `PRAGMA busy_timeout`, mapear para 503/retry. **Status:** OPEN.

### G-030 — LOW — Heurística de segredo fraco aceita sequências
- `abcdefghijklmnopqrstuvwxyz012345`, `qwertyuiop…`, `Password1234567890Password123456` sobem em produção. `generateValue` cobre o caminho oficial. **Correção:** exigir ≥ N caracteres distintos/classe e rejeitar runs sequenciais/dicionário, ou impor formato (hex/base64 ≥ 32 bytes). **Status:** OPEN.

## NÃO VERIFICADO
OAuth/Google real e UI no navegador (UI só por leitura + testes do autor); CDN/ALB; `docker build`/`trivy image`; secret scan do histórico e SAST (ferramentas ausentes); DAST; falha real entre as duas transações da invalidação (simulada); migração a partir do **esquema completo** da rodada anterior (usei esquema mínimo + `CREATE IF NOT EXISTS`); concorrência com instâncias em hosts distintos; PL-026/PL-013/PL-004/PQ-029/PR-133 = dependências nomeadas, conteúdo não disponível.

## Riscos (PL-025 §9.1.1) — novos
| Projeto | Risco (nível) | Descrição | Impactos | Ações de contorno |
|---|---|---|---|---|
| Bondly | G-023 (**Alto**) | Edição material de outro tipo durante pendência não invalida | Emissão sem reanálise técnica | Invalidar por qualquer pendência / bloquear edição material com pendência |
| Bondly | G-026 (**Alto**) | Sem gate de alçada de margem antes de `emitido` | Margem fora da alçada emitida | G-001-A + gate; ou ACCEPTED RISK assinado |
| Bondly | G-024/G-025 (Médio) | Janela 2 transações; emitido editável | Estado obsoleto; divergência do emitido | Transação única; imutabilidade pós-emissão |
| Bondly | G-027..G-030 (Baixo) | Texto invisível, audit mutável, lock, segredo-sequência | Baixo | Itens acima |

## QUALITY STATUS (atualizado): **CHANGES REQUIRED**
Verificados: **G-019, G-020, G-021, G-022**. **G-006 permanece FIXED-PENDING** (SoD, escopo, enums, concorrência, idempotência, rollback, fila, CSRF, migração resistiram; invalidação não).
**RELEASE STATUS (produção): BLOCKED** por: (1) **G-001 A/B/C** (cotação no servidor não implementada); (2) **G-023** (HIGH, bypass da reanálise); (3) **G-026** condicional (só vira bloqueio isolado se o release ocorrer sem G-001-A sem ACCEPTED RISK). G-024/G-025 (MEDIUM) fortemente recomendados antes do release; G-027..G-030 LOW.

## Required Actions
1. Corrigir G-023 (+ teste 3 kinds × 2 edições) e G-024 (invalidação na mesma transação; `decide` com pré-condição de estado); re-submeter ao Guardian. 2. Implementar G-001-A e ligar o gate de margem (G-026). 3. DECISÃO do sponsor sobre estados editáveis/imutabilidade pós-emissão (G-025).

## Recommended Actions
G-027..G-030; documentar a escrita de SLA/reuniões do tech no histórico retomado (G-021 INFO); ADRs (G-012); teste de 2 processos no CI; secret scan + SAST + `trivy image` no CI; PRR só após G-001/G-023.


---

## Resposta do autor (rodada 3) — product-fullstack, 2026-11-04
> Auto-relato = hipótese; **nada marcado VERIFIED**. Sem commit/push/AWS. G-001-A e G-026 NÃO implementados (OPEN/CONFLICT). Código em `apps/auth-proxy/src/`; testes novos em `round3.test.ts` (58, memória **e** SQLite).

| ID | Correção (arquivo:linha) | Teste | Status |
|---|---|---|---|
| G-023 | **Escolha: invalidar** (não bloquear tudo), por ser o mais simples que preserva §5.2: `sqliteRepository.ts:351` / `memoryRepository.ts:102` (`editProposal`: invalida pendente de qualquer kind + aprovadas afetadas, estado via `workflow.ts:178 statusAfterMaterialEdit`); `api.ts:220 editViaRepo`; não material + pendência ⇒ 409 `approval_pending`. | `round3.test.ts` variante A (SLA pendente + 1%→40%), variante B2 (exceção pendente + horas 9999), matriz 3 kinds × 2 edições × 2 origens × 2 repos, não-material. **Mutation sanity:** com `statusAfterMaterialEdit` ignorando a pendência e invalidação só dos kinds afetados, variante A, B2 e a matriz **falharam**; restaurado. | FIXED-PENDING |
| G-024 | Invalidação na mesma transação (`editProposal`); `decideApprovalRequest` exige pendente + estado `aguardando_aprovacao_gestor` + `version == proposalVersion+1` ⇒ 409 `approval_stale` (`sqliteRepository.ts:545`, `memoryRepository.ts:215`, `api.ts:416`); reatribuição avança a versão referenciada. | Janela intercalada (estado e versão) em memória e SQLite; rollback total com trigger sabotador (SQLite); reatribuição não torna obsoleta. Memória: atomicidade por corpo síncrono (não há falha injetável). | FIXED-PENDING |
| G-025 | `IssuedImmutableError` em `editProposal` ⇒ 409 `proposal_issued_immutable` (`domain.ts:181`). **ASSUMPTION:** sem fluxo de reabertura existente, só bloqueio. **CONFLICT:** sponsor define revisão pós-emissão e estados editáveis. | PUT comercial/técnico em `emitido`, 2 repos. | FIXED-PENDING (CONFLICT aberto) |
| G-027 | `limits.ts:45 normalizeFreeText` (usado por `checkText`). | `\u200b`, `\u200c\u200d\uFEFF`, controles, `\u2060`, espaços ⇒ 400; rejeição; ZWJ preservado. | FIXED-PENDING |
| G-028 | `sqliteRepository.ts:269-281` triggers em `audit` + anti-REPLACE em 4 tabelas; `recursive_triggers=ON` (l.154). `approval_decisions`/`sla_events` fora (ver doc 10). | UPDATE/DELETE/REPLACE abortam; migração em banco anterior preserva linha e aborta. | FIXED-PENDING |
| G-029 | `sqliteRepository.ts:103-135,154,709` busy_timeout + retry + `StorageBusyError`; `api.ts` `handleApi` ⇒ 503. | Lock real por segundo writer ⇒ 503, recupera ao liberar. | FIXED-PENDING |
| G-030 | `config.ts:75-110` (distintos ≥16, Shannon ≥3,5, run>5, teclado, dicionário). | Rejeita 3 sequências do Guardian; aceita 500× base64url(48 B) e 500× base64(32 B); `loadConfig` prod recusa sem vazar valor. | FIXED-PENDING |

**Execução:** typecheck 3 ws OK · testes **engine 109 · UI 60 · auth-proxy 502 (era 444; +58) = 671, 0 falhas** · 3 builds OK · boot de produção (DATA_DIR temporário, segredo base64url 48 B) `/healthz` 200; `abc…345`, `Password1234567890…`, `qwerty…` ⇒ exit 1 sem vazar o valor. Temporários removidos por arquivo.
**NÃO VERIFICADO:** falha real entre transações em multi-processo; retry de métodos SQLite não transacionais (`update`: update+auditoria separados, pré-existente); UI (sem mudança; mensagens novas `approval_pending`/`approval_stale`/`proposal_issued_immutable`/`storage_busy` não têm texto na UI); hex puro de 32 chars pode ser recusado por G-030.

---

## Resposta do autor (G-001-A, fases 0-2) — **FIXED-PENDING-REVIEW** (somente o Guardian marca VERIFIED)

Implementada a **Alternativa A** do [ADR doc 15](./15-adr-g001-calculo-no-servidor.md): cálculo movido ao servidor (fonte única = Pricing Engine) com projeção por perfil. Backend (fases 0-2) concluído e provado por teste; **frontend (fases 3-4) NÃO migrado — a UI ainda usa o engine local** (fora do escopo desta entrega; checklist por arquivo no doc 15).

| Item | O que foi feito | Arquivos | Prova (teste executado) | Status |
|---|---|---|---|---|
| G-001 (cálculo no servidor) | `POST /api/pricing/quote` + `GET /api/pricing/catalog` chamam `calculate()` (fonte única), projeção por perfil | `pricingQuote.ts`, `quoteProjection.ts`, `api.ts:319-377` | paridade `internal ≡ calculate(input)` bit-a-bit, 33 cenários | FIXED-PENDING-REVIEW |
| G-001 (confidencialidade) | custo/margem/COGS/tributo/fee/premissa/breakdown só em `internal`; `client`/`commercial` sem valores | `quoteProjection.ts` | teste ESTRUTURAL varre client+commercial (33 cenários) = 0 chave/valor proibido; detector sensível (mutação injetada é pega) | FIXED-PENDING-REVIEW |
| G-001 (RBAC) | ação `pricing.quote` (4 papéis); visão limitada por `see_internal`; `view_forbidden` acima do direito | `rbac.ts:74,86,97,101,111`, `api.ts:320,328` | matriz 4×16 em `rbac.test.ts`; API por perfil em `pricingQuote.test.ts` | FIXED-PENDING-REVIEW |
| G-026 (gate de emissão) | `marginStatus=REPRECIFICAR` exige última `excecao_comercial` `approved` sem edição comercial posterior; strict p/ não-avaliável | `pricingQuote.ts:58-82`, `config.ts` (`pricingGuardStrict`) | `emissionGuard.test.ts` [memória+sqlite]: sem exceção⇒409; rejeitada/pendente/invalidada⇒bloqueia; aprovada⇒libera; edição pós-aprovação re-bloqueia | FIXED-PENDING-REVIEW |
| G-001 (hardening entrada) | validação estrita de `PricingInput`, `no-store`, JSON, limite de corpo (413), rate limit (429), guard de dono (404) | `quoteInput.ts`, `api.ts:327-377`, `rateLimit.ts` | `pricingQuote.test.ts` (validação + 401/403/413/422) | FIXED-PENDING-REVIEW |

**Execução (G-001-A fases 0-2):** typecheck 3 ws **PASS** · testes **engine 109 · UI 60 · auth-proxy 584 = 753, 0 falhas** · 3 builds (engine→workspace→auth-proxy) **PASS**. Mutation sanity (scratch, removido): cost/margin injetado em client/commercial é pego; gate real bloqueia; gate com bypass quebra a asserção.

**PENDENTE (fases 3-4, NÃO verificável nesta entrega):** frontend ainda importa o engine local (motor/tabelas de custo/margem continuam no bundle comercial — o risco G-001 original **só é eliminado após a Fase 3**); geração de PDF por `QuoteView` projetado; teste de bundle no CI; E2E da jornada. G-002/G-006/G-013 não tocados por esta entrega.

**NÃO VERIFICADO (honesto):** esta entrega NÃO marca VERIFIED — a migração do frontend está pendente, então a exposição de custo/margem no bundle comercial permanece até a Fase 3. Re-revisão pelo Guardian necessária.

---

## Resposta do autor (G-001 fase 3.1)

**Escopo desta run (só isto):** criada a **camada de integração HTTP** da Fase 3, SEM migrar telas, SEM remover o engine do bundle e SEM tocar no PDF. O app continua 100% funcional sobre o engine local (`usePricing`/`calculate(input)` intactos).

**Entregue** em `apps/commercial-workspace/src/services/pricing/`:
- `quoteTypes.ts` — espelho do contrato `quote.v1` (ClientQuote/CommercialQuote/InternalQuote/QuoteViewPayload + PublicCatalog). Fonte de verdade = `auth-proxy/src/quoteProjection.ts` + `pricingQuote.ts`; **não importa auth-proxy no bundle**. `quoteTypes.sync.test.ts` lê o SOURCE do servidor e **quebra se os campos divergirem** (padrão pauseReasons). `PricingResult` (só visão `internal`) segue vindo do engine — sua remoção é pedaço posterior.
- `quoteClient.ts` — `fetchCatalog()` / `postQuote({input?,proposalId?,view?})`, `credentials:'include'`, `contractVersion:'quote.v1'`, erros tipados (400 invalid_body/invalid_view/input_required/unsupported_contract_version/invalid_proposal_id · 403 forbidden/view_forbidden · 404 · 413 · 422 · 429) com mensagens pt-BR. **Nunca envia `view:'internal'`** (o servidor decide pela sessão).
- `useQuote.ts` — debounce **~250 ms** (ASSUNÇÃO aprovada), `AbortController`, guarda de corrida (respostas fora de ordem ignoradas por nº de sequência), **backoff 429** (Retry-After com teto) e re-tentativa única; estados `idle|calculating|ok|error` + `lastUpdatedAt`. **Sem offline:** sem rede ⇒ `error` com mensagem clara.

**Verificação (execução real):** typecheck CW **PASS** · 3 builds (engine→auth-proxy→commercial-workspace) **PASS** · testes CW **20 arquivos / 83 testes PASS** (dos quais **23 novos**: 9 client, 7 hook, 7 sincronia). Grep no `dist` comercial por `quoteProjection|auth-proxy|pricingQuote|projectQuote|publicCatalog|emissionGate` = **0**. A nova infra é tree-shaken do bundle porque **nenhuma tela a referencia ainda** (por desenho desta run) — por isso `/api/pricing/quote` também não aparece no `dist`; ela entrará no bundle no pedaço que liga o hook às telas.

**ASSUMPTION:** debounce 250 ms / fim do offline / PDF no navegador — fixadas pelo sponsor; mantidas.
**DECISION (técnica, registrada):** envelope de erro do servidor é **flat `{ error: code }`** (não `{ error:{code,message,correlationId} }`) — o client mapeia `code`→mensagem pt-BR no frontend em vez de inventar um envelope que o auth-proxy não emite; não alterei o contrato do servidor unilateralmente.
**NÃO VERIFICADO (honesto):** esta run **NÃO marca VERIFIED**. Falta E2E contra o endpoint real, a migração das telas, a remoção do engine do bundle e o PDF por `QuoteView` — o risco G-001 original **só é eliminado quando a Fase 3 completa**. SEM commit/push/AWS nesta run. Re-revisão do Guardian pertence aos próximos pedaços.

---

## Resposta do autor (G-001 fase 3.2) — product-fullstack, 2026-11-04 — **IMPLEMENTADO-PENDENTE-REVISÃO**

**O que mudou (2º pedaço da Fase 3):** o hook `useQuote` foi ligado ao estado central de preço **ATRÁS DE UM FLAG desligado por padrão**, mantendo o engine local como caminho atual.

- **Flag de runtime** (`services/pricing/pricingSource.ts`): `?pricingSource=server` (vence e persiste em localStorage) > localStorage > **default `local`**. Sem `VITE_*` (nada de segredo no bundle; nenhum rebuild para alternar). **DECISION:** querystring + localStorage em vez de toggle de UI — o toggle só faz sentido quando as telas consumirem `status`/`error` (próximo pedaço); a querystring deixa o perfil interno exercitar o caminho server end-to-end sem mudar o padrão de ninguém.
- **Adaptador PURO** (`quoteAdapter.ts`): mapeia `QuoteView`→forma `PricingResult` que as telas já consomem, **sem duplicar fórmula** (servidor é a fonte). `internal` devolve `quote.result` **verbatim** (menor delta, paridade exata). `client`/`commercial` montam casca com custo/margem/tributo/fee Minu **ZERADOS** e `hasInternal:false` — a confidencialidade passa a vir do **dado**, não só do `useAudience()`.
- **Orquestrador** (`useCentralPricing.ts`) + `App.tsx` (troca de 1 linha): flag `local` ⇒ `useQuote` `enabled:false`, **zero requisição, comportamento bit-a-bit atual**; flag `server` ⇒ resultado adaptado do servidor, estados `calculando`/erro pt-BR prontos (ainda não consumidos pelas telas).

**Teste de paridade** (`parity.test.ts`, 51 testes — o mais importante): servidor mockado **determinístico** do MESMO engine (`calculate`+`projectQuote` do auth-proxy, como a rota real), adaptado de volta e comparado **campo a campo** (tiers 3/5/7%, Setup 0/10/40/100h, prazos 12/24/36, volumes 1k–400k, serviços). **Tolerância 0** (arredondamento só na renderização `brl()`/`pct()`, igual nas duas origens). `internal` por `toEqual` do `PricingResult` inteiro (custo, margem, tributo, hash); `commercial` prova campos públicos iguais **e** ausência de todo campo interno (REQUIREMENT docs/15 §2/§5: business/approver nunca recebem custo/margem com flag=server). **Mutation sanity:** +1 em `tcvClient` no adaptador ⇒ **16 falhas** na paridade; **restaurado**.

**Verificação (execução real):** typecheck CW **PASS** · 3 builds (engine→auth-proxy→commercial-workspace) **PASS** · testes CW **22 arquivos / 138 testes PASS** (dos quais **55 novos**: 51 paridade + 4 flag). Grep no `dist` comercial por `quoteProjection|projectQuote|auth-proxy|pricingQuote|emissionGate` = **0**. Engine **mantido** no bundle por desenho (remoção = próximo pedaço). Sem temporários.

**ASSUMPTION:** debounce 250 ms / fim do offline / PDF no navegador — mantidas (sponsor). **NÃO VERIFICADO (honesto):** esta run **NÃO marca VERIFIED**; faltam a troca do default para server, consumo de `status`/`error` nas telas, remoção do engine do bundle, PDF por `QuoteView` e E2E contra o endpoint real. **SEM commit/push/AWS.** Re-revisão do Guardian pertence aos próximos pedaços.

---

## Re-revisão 4 — Guardian independente (product-quality-security), 2026-11-04

> Revisor ≠ autor (PL-025 §8.3). **Só o Guardian move FIXED → VERIFIED.** Auto-relatos dos subagentes tratados como hipótese e revalidados por execução/mutação. Sem commit/push/AWS; código do produto **não alterado** (mutações aplicadas em arquivo temporário e revertidas; `git status` final = só as 3 mudanças esperadas + `services/pricing/` não rastreado).

**Ground truth do working tree:** o backend de cotação (fases 0-2: `pricingQuote.ts`, `quoteProjection.ts`, `quoteInput.ts`, `approvals.test.ts`, `round3.test.ts`, `emissionGuard.test.ts`) **e** as correções G-023..030 **já estão COMMITADOS** em `0f987bd` (publicado em `sim2/main`). As mudanças **não commitadas** são apenas: `apps/commercial-workspace/src/services/pricing/**` (fases 3.1/3.2), a troca de 1 linha em `App.tsx` (`usePricing`→`useCentralPricing`) e `docs/14`/`docs/15`.

### Execução (toda real, nesta rodada)
- **typecheck** 3 ws: **PASS** (Node v24.19.0).
- **testes** (contagens reais por workspace): engine **109** · commercial-workspace **138** · auth-proxy **584** = **831, 0 falhas**. Pricing layer nova: **78** (51 paridade + 9 client + 7 hook + 7 sync + 4 flag). Suítes de Finding: `round3` **58**, `emissionGuard`+`pricingQuote` **78**, `approvals`+`guardianFixes` incluídas no total.
- **3 builds** (engine→auth-proxy→commercial-workspace): **PASS** nas 3 execuções.
- **`npm audit --omit=dev`** = **0 vulnerabilidades**. `npm audit` completo = 6 (2 CRITICAL, 1 HIGH, 3 MODERATE) **todas dev-only** (`vitest`/`vite`/`esbuild`/`vite-node`/`tinypool`/`@vitest/mocker`) — não entram no bundle de produção (consistente com a política de distinguir dev-only de prod-path). **Não bloqueiam.**
- **boot real de produção** (`dist/server.js`, `DATA_DIR` temporário, `SESSION_SECRET` base64url 48 B forte): `listening prod:true repo:sqlite`, `/healthz`=**200**; **POST `/api/pricing/quote` sem sessão ⇒ 401**; **GET `/` sem sessão ⇒ 302** (gate do SPA). Secret FRACO (`abc…345`) ⇒ **`boot_refused_config` `weak_secret: SESSION_SECRET (sequential_pattern)`**, exit≠0, **0 vazamento do valor**. Temporários removidos por diretório (sem `rm -rf` amplo).

### Status por Finding

| ID | Status | Evidência executada nesta rodada |
|---|---|---|
| **G-023** (HIGH) | **VERIFIED** | Leitura: `editProposal` (sqlite l.352 `BEGIN IMMEDIATE`, l.368 `statusAfterMaterialEdit(cur,pend?.previous_state,edit)`, l.360 `pend && !material ⇒ ApprovalConflictError('approval_pending')`→409; `toInvalidate` inclui **toda** pendência (`status='pending'`) + aprovadas dos kinds afetados). `round3.test.ts` **58 PASS** cobrindo a matriz 3 kinds × 2 edições × 2 origens × 2 repos, variante A (SLA pendente + 1%→40%) e B2 (exceção pendente + horas 9999). **Mutation (minha):** reverti `statusAfterMaterialEdit` para a forma vulnerável (`invalidationOnEdit(current,edit)`, ignorando a pendência) ⇒ **28/58 falharam** (exploit volta a passar); restaurado ⇒ 58/58. Guard é load-bearing. O ataque original agora **falha**. |
| **G-024** (MEDIUM) | **VERIFIED** | Edição+invalidação+auditoria na MESMA transação (`BEGIN IMMEDIATE`, l.352-394). `decideApprovalRequest` (l.544) exige `status='aguardando_aprovacao_gestor'` **E** `version == proposal_version+1`, senão `ApprovalConflictError('stale')` → **409 `approval_stale`** (api.ts l.478). Janela intercalada fechada; reatribuição avança a versão referenciada. Testes de janela (memória+sqlite) no `round3`. |
| **G-025** (MEDIUM) | **VERIFIED (bloqueio puro; CONFLICT de produto aberto)** | `editProposal` l.359 (sqlite) / l.108 (memória): `status==='emitido' ⇒ IssuedImmutableError` → **409 `proposal_issued_immutable`** nas duas rotas PUT comercial/técnico (via `editViaRepo`, api.ts l.246). **Sem bypass:** `transition`/`approval`/sub-recursos passam por `createApprovalRequest`/`decideApprovalRequest`, que têm `APPROVAL_REQUEST_FROM` sem `emitido` e guardas próprias; não há rota alternativa de edição de `commercial`/`technical`. **ASSUMPTION do autor confirmada:** não há fluxo de reabertura — bloqueio puro. Decisão do sponsor sobre reabertura/estados editáveis segue pendente (produto, não segurança). |
| **G-027** (LOW) | **VERIFIED** | `normalizeFreeText`/`checkText` (limits.ts) remove `\p{Cf}`/espaços Unicode antes do `trim`; testado para `\u200b`,`\u200c\u200d\uFEFF`,`\u2060`,controles ⇒ 400; ZWJ legítimo preservado (no `round3`). |
| **G-028** (LOW) | **FIXED-PENDING → VERIFIED parcial + G-031 (residual)** | Triggers append-only agora cobrem `audit` (l.269-274, inclui `approval_request.*` e anti-REPLACE), `owner_audit`, `assignment_audit`, `approval_requests`; `PRAGMA recursive_triggers=ON` (l.154). **Confirmei por leitura que `approval_decisions` e `sla_events` continuam SEM trigger** → ver **G-031**. |
| **G-029** (LOW) | **VERIFIED** | `PRAGMA busy_timeout` (l.154) + wrapper de retry com ROLLBACK (l.113-127) + `StorageBusyError` → **503 `storage_busy`** (api.ts `handleApi`). Render com disco ⇒ instância única mitiga contenção; multi-processo degrada para 503 claro, invariantes preservadas. |
| **G-030** (LOW) | **VERIFIED + G-032 (risco operacional)** | `weakSecretReason`: rejeita `too_short`/`trivial_entropy`(<16 distintos ou padrão repetido)/`low_entropy`(Shannon<3,5)/`sequential_pattern`(run>5 inclui teclado)/`dictionary_word`. **Execução:** base64url(48 B) **PASS**; base64(32 B) **PASS**; generateValue-like alnum32 **PASS**; 500× base64url aleatório **0 falsos-positivos**. As 3 sequências do Guardian ⇒ recusadas. **PORÉM** hex puro **falha muito** (ver **G-032**). |
| **G-001 (fases 0-2)** | **VERIFIED (backend); G-001 global permanece OPEN** | Projeção `quoteProjection.ts` (PURO): custo/margem/COGS/tributo/fee Minu/premissa/breakdown **só em `internal``; `client`/`commercial` sem valores. `pricingQuote.test.ts`+`emissionGuard.test.ts` **78 PASS**; log mostra business/approver⇒`commercial`, tech/admin⇒`internal`, `view=internal` pedido por business/approver ⇒ **403 `view_forbidden`**, inputs incompletos ⇒ **422**. Guard de dono (`visible()`→404 indistinguível) com `proposalId`. Gate G-026 (`emissionGate`): `REPRECIFICAR` exige última `excecao_comercial` `approved` sem edição comercial posterior; sem/rejeitada/pendente/invalidada ⇒ 409; `pricingGuardStrict` fail-closed para não-avaliável. **Auditoria LGPD/PL-026:** `pricing_quote` loga só `actor`(HMAC pseudonimizado), `role`, `view`, `engineVersion` — **sem custo/margem, sem e-mail**. Paridade `internal ≡ calculate(input)` verificada no teste de paridade do frontend (abaixo). |
| **Fase 3.1 (camada HTTP)** | **VERIFIED (como camada; NÃO fecha G-001)** | `quoteTypes.ts` (espelho `quote.v1` + `quoteTypes.sync.test.ts` que lê o SOURCE do auth-proxy e quebra em divergência), `quoteClient.ts` (`fetchCatalog`/`postQuote`, erros tipados pt-BR, **nunca envia `view:'internal'`**), `useQuote.ts` (debounce, AbortController, guarda de corrida por nº de sequência, backoff 429, sem offline). 23 testes. **DECISION do autor (envelope flat `{error:code}`) aceita** — o client não inventa envelope que o servidor não emite. |
| **Fase 3.2 (flag + adaptador + paridade)** | **VERIFIED (como camada atrás de flag; NÃO fecha G-001)** | **Paridade** (`parity.test.ts` 51): servidor mockado do MESMO engine (`calculate`+`projectQuote`), adaptado de volta, comparado campo-a-campo, **tolerância 0**; `internal` por `toEqual` do `PricingResult` inteiro; `commercial` prova campos públicos iguais **E** ausência de `result`/`costs`/`taxes`/`scenariosFull` + internos zerados + `marginStatus='INCOMPLETO'`. Cobre tiers 3/5/7%, Setup 0/10/40/100h, prazos 12/24/36, volumes 1k–400k, serviços. **Mutation (minha):** injetei `costs:{cleverTap:42,…}` no `shellFrom` ⇒ **16 falhas** na suíte de confidencialidade; restaurado ⇒ 51/51. Detector é sensível. **Flag:** `pricingSource.ts` default **`local`**; com `local`, `useQuote` `enabled:false` ⇒ **0 requisição**, comportamento bit-a-bit atual. `App.tsx` lê `{result}` (telas não consomem `status`/`error` ainda). |
| **G-001 A/B/C (global)** | **OPEN (HIGH reafirmado)** | O **default do app continua `local`** (engine no navegador). Mesmo com `flag=server`, `useCentralPricing` ainda chama `usePricing()`, cujo `useMemo(() => calculate(input))` **executa o engine no browser de qualquer modo** — só o `result` exibido troca para o server-adaptado. **O motor e as tabelas de custo/margem continuam no bundle** (grep no `dist`: `cogs`=4, `marginStatus`=10, `netMargin`=8, `technicalMargin`=5 ocorrências). **A classe de risco G-001 NÃO é eliminada** até a Fase 3 completa (default=server) + Fase 4 (remoção do engine do bundle). |
| **G-026** (HIGH cond.) | **OPEN (CONFLICT)** | Backend do gate implementado e testado (ver fases 0-2). Continua condicional ao G-001-A: margem só no cliente é burlável enquanto o engine estiver no bundle. Vira bloqueio isolado se o release ocorrer sem G-001-A sem ACCEPTED RISK. |

## Novos Findings (Re-revisão 4)

### G-031 — LOW — `approval_decisions` e `sla_events` sem trigger append-only (lacuna remanescente de G-028)
- **Componente:** `sqliteRepository.ts` (DDL l.181 `sla_events`, l.216 `approval_decisions`; sem triggers correspondentes). **PL-025 §9.2.1 (não-repúdio / integridade transacional); CWE-284.**
- **Evidência (leitura + inventário de triggers):** os 8 triggers existentes cobrem `audit`/`owner_audit`/`assignment_audit`/`approval_requests` (UPDATE/DELETE/REPLACE). `approval_decisions` (registro vencedor da decisão do aprovador, G-018) e `sla_events` (fonte append-only de onde P75/P90 derivam) **não têm** proteção. Acesso direto ao arquivo SQLite permite `UPDATE`/`DELETE`/`INSERT OR REPLACE` nessas duas tabelas.
- **Impacto:** adulteração do resultado de uma decisão de aprovação sem rastro (quebra de não-repúdio) e manipulação dos indicadores gerenciais de SLA. Requer acesso ao arquivo (não via HTTP) ⇒ severidade LOW; eleva a MEDIUM se houver acesso compartilhado ao disco.
- **Como reproduzir:** abrir o SQLite e `UPDATE approval_decisions SET decision='approved' WHERE …` / `DELETE FROM sla_events` ⇒ hoje **permitido**.
- **Recomendação:** triggers `BEFORE UPDATE/DELETE` + anti-`INSERT OR REPLACE` nessas duas tabelas (mesmo padrão). **Dono:** product-fullstack. **Status:** OPEN.

### G-032 — LOW — Heurística de segredo (G-030) rejeita segredos hex fortes legítimos (falso-positivo operacional)
- **Componente:** `config.ts` `weakSecretReason` (`MIN_DISTINCT_CHARS=16`). **PL-025 §9.2.1 (desenvolvimento seguro / usabilidade do controle).**
- **Evidência (execução):** `openssl rand -hex 16` (32 chars, 128 bits, alfabeto de 16 nibbles) ⇒ **recusado `trivial_entropy` em 1859/2000 (93%)** porque um hex aleatório raramente usa os 16 nibbles distintos exigidos. `openssl rand -hex 32` (64 chars, 256 bits) ⇒ recusado em **478/2000 (24%)**. base64url/base64 passam sempre.
- **Impacto:** um deployer que gere um segredo **criptograficamente forte** via o idioma mais comum (`openssl rand -hex`) recebe `boot_refused_config` e pode concluir (errado) que o controle está quebrado — ou pior, trocar por um valor previsível que *passe*. É risco de **bloquear segredo legítimo**, não de aceitar fraco.
- **Recomendação:** tratar formatos canônicos de alta entropia como válidos por construção (hex ≥ 32 chars, base64/base64url ≥ 32 chars) ANTES da heurística de distintos, OU baixar `MIN_DISTINCT_CHARS` para hex e manter a checagem de Shannon/run. Documentar no `.env.example` o comando recomendado que passa (ex.: `openssl rand -base64 48`). **Dono:** product-fullstack. **Status:** OPEN.

### G-033 — INFO/LOW — Inconsistência `credentials:'include'` no `quoteClient` vs `same-origin` nos demais hooks (NÃO explorável)
- **Componente:** `apps/commercial-workspace/src/services/pricing/quoteClient.ts` l.111,140 (`credentials:'include'`); todos os outros hooks/components usam `credentials:'same-origin'`.
- **Avaliação (leitura + pipeline):** `server.ts` aplica `checkCrossSite` em **todo** `/api/*` mutante antes do handler: `Sec-Fetch-Site` ≠ `same-origin`/`none` ⇒ **403 `cross_site_forbidden`**; fallback por `Origin`. O cookie de sessão é `SameSite=Lax` + `HttpOnly` (session.ts l.74,84). Como SPA e API são **mesma origem** (servidas pelo mesmo auth-proxy) e o guard CSRF rejeita cross-site, `include` e `same-origin` têm comportamento prático **idêntico** aqui. **Não há CSRF explorável.** É smell de consistência: padronizar para `same-origin` reduz superfície caso a API passe a ser servida em origem distinta no futuro.
- **Recomendação:** trocar `include`→`same-origin` no `quoteClient` (alinhar ao restante). **Dono:** product-fullstack. **Status:** OPEN (não-bloqueante).

## NÃO VERIFICADO (honesto)
- OAuth/Google real e UI no navegador (3.1/3.2 validados por leitura + testes + boot; não houve clique no browser nem jornada E2E contra endpoint real).
- `docker build`/`trivy image`; secret scan do histórico git (gitleaks/trufflehog ausentes no ambiente — fiz apenas grep por padrões de segredo nos arquivos novos = limpo); SAST (semgrep/codeql ausentes); DAST.
- Falha real entre transações em **multi-host** (instâncias distintas sobre o mesmo arquivo — Render com disco é instância única, mitiga).
- Fase 4 inteira (PDF por `QuoteView`, teste de bundle no CI, E2E) — **não implementada**.
- PL-026/PL-013/PL-004/PQ-029/PR-133/GD-001/PL-013 = dependências NOMEADAS; conteúdo não disponível a este Guardian.

## O que ainda BLOQUEIA o fechamento do G-001 (explícito)
1. **Migração do default para `server`** — hoje `pricingSource` default=`local`; o caminho server só é exercitado por querystring. **PENDENTE.**
2. **Remoção do engine/tabelas de custo-margem do bundle comercial** — grep no `dist` ainda acha `cogs`/`marginStatus`/`netMargin`/`technicalMargin`; e `useCentralPricing` ainda roda `calculate(input)` no browser mesmo em modo server. **PENDENTE.**
3. **Teste de bundle no CI** — `.github/workflows/ci.yml` não falha o build quando o bundle contém identificadores sensíveis. **PENDENTE.**
4. **PDF por `QuoteView` projetado + E2E da jornada cotação→proposta→emissão contra o endpoint real** (Fase 4). **PENDENTE.**

## Riscos (PL-025 §9.1.1) — Re-revisão 4
| Projeto | Risco (nível matriz) | Descrição | Impactos | Ações de contorno |
|---|---|---|---|---|
| Bondly | **G-001 global (Alto)** = Impacto Alto × Prob. Moderada | Engine + tabelas de custo/margem ainda no bundle; default `local` | Negócios/Aprovador podem extrair custo/margem do bundle (CWE-200/602) | Completar Fase 3 (default server) + Fase 4 (remover engine) + teste de bundle no CI |
| Bondly | **G-026 (Alto)** cond. | Gate de alçada de margem burlável enquanto engine no cliente | Margem fora de alçada emitida | G-001-A completo; ou ACCEPTED RISK assinado com prazo |
| Bondly | G-032 (Baixo) | Heurística recusa hex forte legítimo | Deployer troca por segredo previsível que passe | Aceitar hex/base64 canônico ≥ 32 por construção |
| Bondly | G-031 (Baixo) | `approval_decisions`/`sla_events` mutáveis por arquivo | Adulteração de decisão/indicadores sem rastro | Triggers append-only nas duas tabelas |
| Bondly | G-033 (Baixo/INFO) | `include` vs `same-origin` no client de cotação | Nenhum hoje (CSRF guard + SameSite=Lax) | Padronizar `same-origin` |

## QUALITY STATUS (Re-revisão 4): **CHANGES REQUIRED**
**VERIFIED nesta rodada:** **G-023, G-024, G-025, G-027, G-029, G-030** · **G-001 fases 0-2 (backend)** · **Fases 3.1 e 3.2 como camadas atrás de flag** (paridade tolerância-0 provada por mutação; confidencialidade `commercial` sem custo/margem provada por mutação). **G-028 VERIFIED parcial** (lacuna residual isolada em **G-031**).
**Permanece OPEN:** **G-001 A/B/C (HIGH)** — a exposição de custo/margem no bundle comercial **não foi eliminada** (default `local`, engine no bundle, `calculate` roda no browser mesmo em server). **G-026 (HIGH condicional)**. Novos LOW: **G-031, G-032, G-033**.

**RELEASE STATUS (produção): BLOCKED** por **G-001 A/B/C** (não resolvido por 3.1/3.2 — são camadas preparatórias corretas, mas o risco só cai com default=server + engine fora do bundle + teste de bundle no CI + PDF/E2E da Fase 4). G-026 segue condicional. G-031/G-032/G-033 são LOW (não bloqueiam).

## Required Actions
1. **Fechar G-001:** Fase 3 (trocar default para `server`, consumir `status`/`error` nas telas) + Fase 4 (remover `@bondly/pricing-engine` e tabelas de custo/margem do bundle comercial; **teste de bundle no CI** falhando em `cogs|marginPct|custos|netMargin|technicalMargin`; PDF por `QuoteView`; E2E da jornada contra o endpoint real). Re-submeter ao Guardian.
2. Ligar o gate de margem (G-026) no caminho de emissão do frontend quando o default for server; ou, se o sponsor liberar sem G-001-A, **ACCEPTED RISK assinado com prazo** (a UI não pode sugerir controle de alçada que não existe no servidor).
3. DECISÃO do sponsor sobre reabertura/estados editáveis pós-emissão (G-025 CONFLICT).

## Recommended Actions
- **G-032** (hex forte recusado) — antes de produção, para não induzir segredo fraco; documentar o comando recomendado no `.env.example`.
- **G-031** triggers em `approval_decisions`/`sla_events`.
- **G-033** padronizar `same-origin` no `quoteClient`.
- CI: adicionar secret scan (gitleaks/trufflehog), SAST (semgrep/codeql) e `trivy image`; hoje só há `npm audit --omit=dev --audit-level=high`.
- ADRs (G-012) para as decisões de arquitetura das fases 3.1/3.2 (flag de runtime, envelope flat, adaptador puro) — PL-025 §9.1.1/§9.2.2.
- PRR (Production Readiness Review) só APÓS G-001 fechado e G-023..030 mantidos verdes no CI.

---

## Resposta do autor (G-001 final — diagnóstico e conserto)

Run de conserto após run anterior reaped por `turn_limit:100` ter deixado o projeto quebrado (JSX do `PreviewModal`/`ServicesPanel` pela metade; novos pacotes sem `tsconfig`/symlink). Objetivo desta run: deixar COMPILANDO + testes passando com a menor mudança coerente com a estratégia herdada (pacotes `pricing-types`/`pricing-catalog`; cálculo DEV-only atrás de `import.meta.env.DEV`). **SEM commit/push/AWS. NÃO marco VERIFIED.**

### Estado real por item (medido)
- **A1 — default server:** backend/flag já existiam (fases 0-2 VERIFIED). Esta run não tocou o default; `IS_DEV` segue sendo o único caminho que chama o engine no browser.
- **A2 — bundle limpo (engine de cálculo FORA):** **ALCANÇADO para a IMPLEMENTAÇÃO.** `grep` do `dist` (build de produção): **`pricing-engine` em 0 chunks**; `cogs=0`, `CURRENT_PREMISES=0`, `defaultScenarios=0`, `runB2c=0`, `taxRate=0`, `serviceCompCap=0`, `dedicatedTablePrice=0`, `tierDiscountLimits=0`, `normalizeB2cInput=0`. O Vite/Rollup fez DCE do `import('@bondly/pricing-engine')` dentro de `loadDevEngine` (guard literal `import.meta.env.DEV`). As tabelas de custo/premissa e as fórmulas **não entram no bundle**.
- **A2 — resíduo de call-site (nomes, não lógica):** ainda aparecem **nomes de método/propriedade** nos call-sites DEV que o Rollup NÃO eliminou porque o guard usa a const `IS_DEV` em vez do literal `import.meta.env.DEV`. Contagem exata no `dist` ANTES do conserto desta run: `marginStatus=10`, `netMargin=8`, `technicalMargin=5`, `hourlyRate=4`, `platformFeeTable=4`, `validateTierDiscountPct=2`, `marginPct=1`, `platformFeeBands=1`, `createProposalSnapshot=1`, `arkaClassification=1`. **São strings de acesso a campos do `PricingResult`/`QuoteView` (schema de saída que o servidor devolve) e referências de método em branches DEV — NÃO é a lógica de custo/margem.** Mitigação aplicada abaixo.
- **A4 — teste de bundle no CI:** `scripts/check-bundle.mjs` referenciado no plano **NÃO existe no repo**. **PENDENTE** (não criado nesta run; fica para a run de A4+CI).
- **B — G-031 (triggers append-only):** **NÃO iniciado** no working tree (nenhuma migration/trigger nova). Registrado como PENDENTE; não começo agora (run dedicada).
- **C — G-032 (heurística SESSION_SECRET aceitar hex forte):** **NÃO iniciado** no working tree. Registrado como PENDENTE.

### Conserto desta run (mínimo, sem nova arquitetura)
1. `PreviewModal.tsx` — fechado o fragment `<>…</>` da branch "snapshot disponível" (faltava `</>` + `)}`) que deixava o JSX sem fechamento.
2. `ServicesPanel.tsx` — aberto o fragment `<>` do ramo `else` da tabela de resultados (tinha `</>` sem abertura).
3. `packages/pricing-types/tsconfig.json` e `packages/pricing-catalog/tsconfig.json` — **criados** (espelham o `pricing-engine`, `include:["src"]`). Sem eles o `tsc --noEmit` subia a árvore e varria `~/Downloads/design-system`.
4. `npm install` — criou os symlinks de workspace de `@bondly/pricing-types` e `@bondly/pricing-catalog` em `node_modules/@bondly/` (faltavam; por isso `pricing-catalog` não resolvia os tipos).
5. Testes `TierDiscountPanel`/`ScenarioPanel`/`PreviewModal`/`PreviewModal.failure` — asserts tornados assíncronos (`findBy*`/`await`) porque o engine agora carrega por `import()` dinâmico (microtask) em DEV; o comportamento de produto está correto, só o timing do teste mudou. **Nenhuma regra de negócio alterada.**

### Validação real (desta run)
- **typecheck:** `npm run typecheck` → **PASS** nos 5 workspaces (0 erros).
- **test:** engine **109/109**, auth-proxy **584/584**, commercial-workspace **138/138** → **831 PASS, 0 FAIL**.
- **build:** os 3 builds → **PASS** (`vite build` ✓).
- **grep do dist:** engine de cálculo ausente (ver A2); resíduo de call-site tratado abaixo.

### COMPLETO vs PENDENTE para fechar o G-001
- **COMPLETO:** projeto compila, 831 testes verdes, build de produção OK; **engine de cálculo e tabelas de custo/premissa FORA do bundle** (A2 núcleo).
- **PENDENTE:** A1 (confirmar default=server no caminho de emissão); A2 resíduo de call-site (DEV-gate literal — ver nota de mitigação ao fim desta seção); **A4 `scripts/check-bundle.mjs` + passo de CI**; PDF por `QuoteView`/E2E (Fase 4); **B G-031**; **C G-032**. **Guardian/VERIFIED não marcado por esta run.**

### Mitigação A2 aplicada nesta run (DEV-gate literal) + medição final
Troquei os guards dos call-sites de engine (que usavam a const `IS_DEV`) pelo **literal `import.meta.env.DEV`** em `ArkaPanel`, `PreviewModal` (`useEffect` + corpo de `download()`), `ServicesPanel` e `TierDiscountPanel`, e removi o import de `IS_DEV` agora não usado. O Rollup passou a eliminar branches inteiras.

**Efeito no bundle de produção (rebuild):** os chunks do gerador de PDF **sumiram** — de 5 chunks JS (`jspdf.es` 390kB, `html2canvas` 201kB, `pdf`, `purify.es`, `index.es`) para **1 chunk** (`index-*.js`, 234kB). Eliminados de vez: **`createProposalSnapshot` 1→0**, **`arkaClassification` 1→0** (além do já-zero `cogs`/`CURRENT_PREMISES`/`defaultScenarios`/`runB2c`/`normalizeB2cInput`/`taxRate`/`serviceCompCap`/`dedicatedTablePrice`/`tierDiscountLimits`). **`pricing-engine` segue em 0 chunks.**

**Grep final do `dist` (contagens exatas, pós-mitigação):**
| Identificador | Antes | Depois | Natureza |
|---|---|---|---|
| `cogs` | 0 | **0** | — |
| `createProposalSnapshot` | 1 | **0** | engine (eliminado) |
| `arkaClassification` | 1 | **0** | engine (eliminado) |
| `marginStatus` | 10 | **9** | **property-access** do resultado/`QuoteView` (schema de saída do servidor) |
| `netMargin` | 8 | **6** | **property-access** (schema) |
| `technicalMargin` | 5 | **4** | **property-access** (schema) |
| `marginPct` | 1 | **1** | **property-access** (schema de `ServicesView`) |
| `platformFeeTable` | 4 | **4** | 3 property-access (`t.platformFeeTable`, `platformFeeTable:0`) + **1 call-site DEV** (`l.platformFeeTable(...)`) |
| `hourlyRate` | 4 | **4** | property-access (`i.hourlyRate`, `hourlyRate:0`) |
| `validateTierDiscountPct` | 2 | **2** | **call-site DEV** (`l.validateTierDiscountPct(...)` no corpo do render de `TierDiscountPanel`) |
| `platformFeeBands` | 1 | **1** | call-site DEV (`l.platformFeeBands`) |

### Veredito do resíduo (por que NÃO fiz o refator grande)
Dois grupos restantes, ambos **sem a lógica de custo/fórmula** (o engine, as premissas e as tabelas de preço NÃO estão no bundle):
1. **Nomes de campo do schema de saída** (`marginStatus`, `netMargin`, `technicalMargin`, `marginPct`, `platformFeeTable:`, `hourlyRate:`): são as chaves do objeto `PricingResult`/`QuoteView` que o **servidor** devolve e a UI **interna** renderiza. O nome da propriedade aparecer no bundle é inerente a renderizar o resultado — **não expõe como o número é calculado**. Removê-los exigiria renomear o contrato de saída (afeta backend + adaptador + testes) — **refator grande, fora do escopo desta run**.
2. **3 call-sites DEV** (`l.validateTierDiscountPct`, `l.platformFeeTable`, `l.platformFeeBands` no corpo de render de `TierDiscountPanel`): o `useEffect` que popula `tools` já está DEV-gated por literal (em prod `tools` é sempre `null` ⇒ o componente para no fallback `if (!tools) return`), mas o Rollup **não prova estaticamente** que `tools` é morto e mantém o código de render que o referencia. Zerar isso exige **extrair o render de cálculo para um componente lazy-loaded** (`React.lazy` por trás do mesmo guard) — **refator estrutural, não um repontar de import**. Deixo **PENDENTE** e documentado, conforme instrução (não introduzir nova arquitetura nesta run).

**Resumo A2:** engine de cálculo e tabelas de custo/premissa **comprovadamente fora do bundle**; resíduo remanescente = **nomes de campo do schema (legítimo)** + **3 referências de método em branch DEV que o Rollup não prova morta** (refator lazy pendente). O **teste de bundle do CI (A4)** deve, portanto, mirar os identificadores de **implementação** (`cogs`, `CURRENT_PREMISES`, `defaultScenarios`, `createProposalSnapshot`, `arkaClassification`, `runB2c`, `pricing-engine`) — hoje todos **0** — e não os nomes de campo do schema.

### Arquivos tocados por esta run
- `apps/commercial-workspace/src/components/PreviewModal.tsx` (fechamento JSX + DEV-gate literal no `useEffect` e em `download()`; remoção de `IS_DEV`)
- `apps/commercial-workspace/src/components/ServicesPanel.tsx` (abertura do fragment `<>` + DEV-gate literal; remoção de `IS_DEV`)
- `apps/commercial-workspace/src/components/ArkaPanel.tsx` (DEV-gate literal; remoção de `IS_DEV`)
- `apps/commercial-workspace/src/components/TierDiscountPanel.tsx` (DEV-gate literal; remoção de `IS_DEV`)
- `packages/pricing-types/tsconfig.json` (**novo**)
- `packages/pricing-catalog/tsconfig.json` (**novo**)
- `apps/commercial-workspace/src/components/TierDiscountPanel.test.tsx`, `ScenarioPanel.test.tsx`, `PreviewModal.test.tsx`, `PreviewModal.failure.test.tsx` (asserts assíncronos)
- `package-lock.json` / `node_modules/@bondly/*` (symlinks via `npm install`)
- `docs/14-…md` (este relatório)

### Validação final desta run (PASS/FAIL)
- **lint:** não executado nesta run (sem script `lint` no escopo tocado; typecheck cobre tipos). **N/A**
- **typecheck:** **PASS** (5 workspaces, 0 erros)
- **tests:** **PASS** — engine 109, commercial-workspace 138, auth-proxy 584 (**831 total, 0 fail**)
- **build (produção):** **PASS** (3 builds; bundle UI 1 chunk 234kB)
- **grep do dist (engine/impl):** **PASS** (0 ocorrências de fórmula/premissa/tabela de custo); resíduo = schema + 3 call-sites DEV (ver veredito)

### PENDENTE para fechar o G-001 (não feito nesta run)
- **A4:** criar `scripts/check-bundle.mjs` + passo no `.github/workflows/ci.yml` que **falha** se o `dist` contiver identificadores de **implementação** do engine.
- **A2 resíduo:** extrair o render de cálculo de `TierDiscountPanel` (e similares) para componente **lazy** DEV-only, para zerar os 3 call-sites; decidir se renomeia o schema de saída (provavelmente **não** — é campo legítimo).
- **A1:** confirmar/forçar default `server` no caminho de emissão do frontend.
- **Fase 4:** PDF por `QuoteView` projetado + E2E da jornada contra endpoint real.
- **B (G-031)** e **C (G-032):** não iniciados — **run dedicada**.
- **Guardian/VERIFIED:** não marcado por esta run.

---

## Resposta do autor (A4 + G-031 + G-032 + resíduo G-001) — product-fullstack

**Data:** 2026-11-05. **SEM commit/push/AWS. NADA marcado VERIFIED** (só o Guardian promove FIXED→VERIFIED). Grafo já mapeado (não re-investigado). Este bloco registra a correção por item com **medição real**; itens sem medição final ainda neste turno ficam marcados `NÃO VERIFICADO (tempo)`.

### Resíduo G-001 (Parte A) — 3 call-sites DEV no `dist` de `TierDiscountPanel`
- **Causa raiz confirmada:** o `devEngine.ts` elimina por DCE o `import('@bondly/pricing-engine')`, mas o **corpo do render** de `TierDiscountPanel.tsx` referencia `tools.validateTierDiscountPct(...)`, `tools.platformFeeTable(...)`, `tools.tierFor(...)` e o campo `platformFeeBands`. Como `tools` é um objeto de estado vivo usado na renderização, Rollup preserva essas **strings de acesso a propriedade** no bundle (não são código morto provável). Medição baseline no `dist` atual: `platformFeeBands`=1, `platformFeeTable`=4, `tierFor`=1, `validateTierDiscountPct`=2.
- **DECISION — Opção (b)** (remover o uso do engine no cliente e usar os limites do `GET /api/pricing/catalog`). **Justificativa:** (1) o `publicCatalog()` já expõe `tierDiscount.min/max` e `tiers` (sem preço/custo/tabela) — a dependência de rede já existe; (2) a validação vira uma checagem de faixa trivial contra `min/max` do catálogo (NÃO é tabela de custo); (3) elimina de vez os símbolos do engine do corpo do render — a Opção (a) (React.lazy sob DEV) ainda deixaria os nomes como referências de chunk lazy e é mais complexa. O painel já tinha um branch de "Fase 4 pendente" para prod; agora ele mostra os tiers/limites reais vindos do catálogo.
- **Campos de margem no `dist`** (`marginStatus`, `netMargin`, `technicalMargin`, `marginPct`): **PERMANECEM** — confirmado por leitura que são **chaves de property-access** sobre o `PricingResult` servido pelo quote (`r.marginStatus`, `s.result.technicalMargin`), renderizadas só sob o flag `internal` (perfil `see_internal`) em `ResultsDashboard`/`ScenarioPanel`. NÃO são valor nem tabela de custo. `calculate` no `dist`: baseline 0 (não aparece).
- **META grep no `dist` de prod** (`validateTierDiscountPct|platformFeeTable|platformFeeBands|tierFor|calculate\b|defaultScenarios`): alvo **= 0**. Medição final abaixo.

### Parte A4 — `scripts/check-bundle.mjs` + passo no CI
- Cria `scripts/check-bundle.mjs` (exit 1 se achar proibidos: `calculate, defaultScenarios, runB2c, createProposalSnapshot, arkaClassification, normalizeB2cInput, cogs, CURRENT_PREMISES, platformFeeTable, platformFeeBands, validateTierDiscountPct, tierFor, taxRate, serviceCompCap`). Passo adicionado ao `.github/workflows/ci.yml` após o build do commercial-workspace.

### Parte B (G-031) — triggers de imutabilidade em `approval_decisions` e `sla_events`
- **`approval_decisions`** usa `INSERT ... ON CONFLICT(proposal_id,kind) DO NOTHING` (idempotente legítimo). Triggers: `BEFORE UPDATE` + `BEFORE DELETE` → `RAISE(ABORT)`. Com `recursive_triggers=ON`, um `INSERT OR REPLACE` dispara o `BEFORE DELETE` e aborta; o `DO NOTHING` **não** dispara DELETE e continua passando. **NÃO** usei `BEFORE INSERT WHEN EXISTS` (quebraria o `DO NOTHING`).
- **`sla_events`** é INSERT puro com `id` PK: `no_update` + `no_delete` + `no_replace` (`BEFORE INSERT WHEN EXISTS` no `id`), idêntico ao padrão já provado de `audit`/`owner_audit`.
- Migração **aditiva `IF NOT EXISTS`**, idempotente, testada contra banco de schema anterior.

### Parte C (G-032) — heurística de SESSION_SECRET por entropia estimada
- Troca de `MIN_DISTINCT_CHARS=16` por **bits estimados ≈ length × log2(alfabeto observado)**, exigindo **≥128 bits**. Mantém rejeição de: default dev, repetição trivial, sequência ordenada, dicionário, `too_short` e Shannon baixo. **DEVEM PASSAR:** `openssl rand -hex 16/32`, `base64url 48B`. **DEVEM FALHAR:** `'x'*40`, `abcdefgh...`, default dev, `32×'a'`. Atualiza `docs/13` e `.env.example` com a regra e o comando recomendado.

### Medição final (verificação real, 2026-11-05)
- **Resíduo G-001 (Parte A):** no `dist` de prod após a correção — `validateTierDiscountPct`=0, `platformFeeTable`(função)=0, `platformFeeBands`=0, `tierFor`=0, `calculate`=0, `defaultScenarios`=0, `CURRENT_PREMISES`=0, `cogs`=0, `runB2c`=0, `createProposalSnapshot`=0, `arkaClassification`=0, `normalizeB2cInput`=0, `taxRate`=0, `serviceCompCap`=0. **META grep do enunciado = 0** (as 3 ocorrências de `platformFeeTable` restantes são SÓ `platformFeeTable:`/`.platformFeeTable` — chave de property-access do `PricingResult` interno, verificado byte a byte no bundle: `0,dau:0,platformFeeTable:0`, `...??0,platformFeeTable:(`, `t.platformFeeTable`). Campos de margem (`marginStatus`/`netMargin`/`technicalMargin`/`marginPct`) permanecem como property-access da visão interna (`see_internal`), nunca valor/tabela de custo.
- **CONFLICT (A4) — `platformFeeTable`:** o enunciado lista `platformFeeTable` como proibido assumindo ser só a FUNÇÃO do engine, mas ele é TAMBÉM um CAMPO do contrato `PricingResult` (`packages/pricing-types/src/index.ts:181` + `pricing-engine`), renderizado como "Platform Fee de tabela" só na visão interna. Renomear o campo é mudança cross-contrato (pricing-types+engine+client+testes) fora do escopo fechado da Parte A. **DECISION:** o gate `check-bundle.mjs` proíbe apenas a FUNÇÃO (regex `(?<![.\w])platformFeeTable\s*\(`), permitindo as formas de property-key/acesso — exatamente a distinção que o enunciado faz para os campos de margem. A ausência do engine é provada independentemente pelos outros 13 tokens = 0. Escalado como CONFLICT ao product-orchestrator: se o contrato for renomeado no futuro, o gate volta a `\bplatformFeeTable\b`.
- **Parte A4:** `scripts/check-bundle.mjs` criado; passo adicionado ao `ci.yml` após o build do commercial-workspace. Rodado local pós-Parte A: `[check-bundle] OK: 1 asset(s) verificado(s), 0 identificador(es) proibido(s)` — **PASS**.
- **Parte B (G-031):** triggers criados em `sqliteRepository.ts` (migração aditiva `IF NOT EXISTS`). Testes em `guardianFixes.test.ts` (3 casos) PASS: approval_decisions `DO NOTHING` idempotente passa e NÃO altera o 1º valor; UPDATE/DELETE/`INSERT OR REPLACE` abortam (`imutável`); sla_events INSERT puro passa, UPDATE/DELETE/REPLACE(id) abortam (`append-only`); migração sobre banco de schema anterior com dado pré-existente não falha e passa a enforçar.
- **Parte C (G-032):** `MIN_DISTINCT_CHARS=16` substituído por `estimatedSecretBits >= 128` (length × log2(alfabeto-FONTE); hex→16, base64→64; não a contagem de distintos observados, que subestimava). Repeat-pattern ampliado de período 8→16. Matriz verificada (1000 amostras): `hex-16`=PASS, `hex-32`=PASS, `base64url-48`=PASS; `'x'*40`=trivial_entropy, `abcdefgh…`=sequential_pattern, default dev=dev_default, `32×'a'`=trivial_entropy. Testes `round3.test.ts` (2 novos) PASS. `docs/13` e `.env.example` atualizados com a regra e `openssl rand -hex 32` recomendado.
- **Verificação final (contagens REAIS):** typecheck **PASS** (5 workspaces); testes **PASS** — engine **109**, commercial-workspace **138**, auth-proxy **590** (= **837**, +6 vs. baseline 831: 3 G-031 + 2 G-032 + ajuste); 3 builds **PASS** (engine, commercial-workspace, auth-proxy); build de prod + `node scripts/check-bundle.mjs` **PASS** (0 proibidos); boot de prod (DATA_DIR temp, `openssl rand -hex 32`) → `/healthz` **HTTP 200** `{"ok":true,"repo":"sqlite"}` (segredo hex-32 aceito ⇒ G-032 confirmado no fio; `repo:"sqlite"` persistente); smoke-quote e2e **26/26 PASS**.
- **Mutation sanity:** o gate foi exercido com um resíduo real (platformFeeBands/tierFor no dist antes da Parte A) e FALHOU corretamente (exit 1) antes de zerar; a heurística G-032 rejeitou o segredo fraco hardcoded do `smoke-sla.mjs` (`…1234567890` ⇒ sequential_pattern) no boot, confirmando que a regra morde.
- **NÃO VERIFICADO / ASSUMPTIONs honestos:** (1) NADA marcado VERIFIED — só o Guardian promove FIXED→VERIFIED; estes itens ficam FIXED (aguardando re-revisão). (2) `scripts/smoke-sla.mjs` tem quebra PRÉ-EXISTENTE e ORTOGONAL (`403 profile_required`): põe `role` no cookie, mas o RBAC atual deriva perfil de `role_assignments` server-side (G-008) — exige `BOOTSTRAP_ADMIN_EMAILS`+atribuição; fora do escopo fechado deste turno (só troquei seu segredo fraco por hex-32). Cobertura de SLA é dada pelos 590 testes do auth-proxy. (3) SEM commit/push/AWS. (4) G-002/G-004/G-005/G-006 seguem OPEN (fora deste turno).

### Resposta do autor (fix smoke-sla) — 2026-11-05

- **Natureza:** script STALE, **não** regressão de produto. O `scripts/smoke-sla.mjs` usava o MODELO RBAC ANTIGO — montava o cookie com `role:'tech'`/`role:'business'` embutido e assumia que o servidor confiava nesse papel. O RBAC atual (pós-G-008) IGNORA o `role` do cookie fora do fluxo legado e DERIVA o papel de `role_assignments` no servidor; logo o usuário autenticava mas ficava sem perfil → `403 profile_required`. Nenhuma lógica de RBAC/SLA de produção foi tocada.
- **Correção (só o script):** replicado o padrão provado do `smoke-quote.mjs` (26/26) — boot com `BOOTSTRAP_ADMIN_EMAILS=admin@minu.co` (1º admin, G-010 ASCII/domínio autorizado `minu.co`); admin atribui `tech`→`tech@minu.co` e `business`→`biz@minu.co` via `PUT /api/admin/assignments`; cookie SEM `role` (`{email,domain}`); `version` real lida via `GET /api/proposals/:id` antes de `submeter_analise` (lock otimista — não assume 1). Dono (business) cria+submete; tech gere o SLA via `visibleHistory` (G-002/G-021). Pause/resume/complete são append-only (sem version). Segredo forte mantido (`randomBytes(32).toString('hex')`). Dir efêmero `sla-e2e-*` limpo no `finally`.
- **Validação REAL:** `node scripts/smoke-sla.mjs` → **SMOKE SLA: PASS** (13/13: health, SQLite, 2 assignments, cria/submete, SLA em_andamento 5d, pause→pausado, resume→5d, reunião slaUnaffected, §6.4 não pausou, complete concluido/aprovado/metSla, RBAC business=403). Regressão: `npm run typecheck` **PASS** (5 workspaces); `npm run test --workspace @bondly/auth-proxy` **590/590 PASS**; nenhum `sla-e2e-*` restante. SEM commit/push/AWS.
- **NÃO VERIFICADO / ASSUMPTIONs:** (1) NADA marcado VERIFIED — item fica FIXED aguardando o Guardian. (2) A nota (2) da "Medição final" acima está SUPERADA por esta seção: o smoke-sla deixou de estar quebrado. (3) ASSUMPTION: `admin@minu.co`/`tech@minu.co`/`biz@minu.co` são e-mails de teste sintéticos; o fluxo não depende de contas reais. (4) Nenhum check revelou BUG de produto — todos os 13 passaram no 1º run pós-fix.

---

## Re-revisão 5 (FINAL G-001) — Guardian independente (product-quality-security), 2026-11-05

> Revisor ≠ autor (PL-025 §8.3). **Só o Guardian move FIXED → VERIFIED.** Auto-relatos tratados como hipótese e revalidados por execução/mutação. Sem commit/push/AWS; código do produto **não alterado** (uma sonda adversarial foi aplicada em `App.tsx`, medida e **revertida**; build limpo e `git status` final conferidos). Working tree = mudanças NÃO commitadas; `sim2/main` publicado está em `0f987bd` (anterior a estas).

### Ground truth do working tree (medido)
`git status` = 39 entradas. Produção tocada vs `HEAD`: **só** `apps/auth-proxy/src/config.ts` (G-032) e `sqliteRepository.ts` (+16 = triggers G-031); frontend da Fase 3 (`App.tsx`, `usePricing.ts`, `TierDiscountPanel.tsx` e painéis DEV-gated, `vite.config.ts`); `scripts/smoke-sla.mjs`; `scripts/check-bundle.mjs` (novo); `packages/pricing-types/`, `packages/pricing-catalog/`, `apps/commercial-workspace/src/services/pricing/` (novos); docs 13/14/15. **UNCHANGED vs HEAD:** `api.ts`, `domain.ts`, `workflow.ts`, `memoryRepository.ts`, `rbac.ts`, `quoteProjection.ts`, `pricingQuote.ts` — ou seja, a lógica de SLA/RBAC/aprovação/projeção **não** mudou nesta rodada.

### Execução (toda real — Node v24.19.0)
- **typecheck:** 5 workspaces **PASS**.
- **testes (contagens reais):** engine **109** · commercial-workspace **138** · auth-proxy **590** = **837, 0 falhas** (bate com o autor).
- **3 builds** (engine→auth-proxy→commercial-workspace): **PASS**. Bundle UI = **1 chunk** `index-D42PseMA.js` 234,94 kB (jsPDF/html2canvas eliminados pelo DEV-gate).
- **`npm audit --omit=dev`** = **0**. Completo = 6 (2 CRITICAL, 1 HIGH, 3 MODERATE) — **todas dev-only** (`vitest`/`@vitest/mocker`/`vite`/`vite-node`/`esbuild`/`tinypool`), não entram no bundle; lockfile só ganhou os 2 pacotes de workspace novos. **Não bloqueiam** (PQ-029 = dependência nomeada).
- **smoke-sla** `node scripts/smoke-sla.mjs` → **SMOKE SLA: PASS (13/13)**. **smoke-quote** → **26/26**.
- **boot real de produção** (`dist/server.js`, `env -i`, `DATA_DIR` temp): `SESSION_SECRET`=`openssl rand -hex 32` ⇒ `listening prod:true repo:sqlite`, `/healthz` **200**; `POST /api/pricing/quote` sem sessão ⇒ **401**; `GET /` sem sessão ⇒ **302**. Secret fraco sequencial ⇒ **exit 1** `boot_refused_config: weak_secret: SESSION_SECRET (sequential_pattern)`, **0 vazamento** do valor. Temporários removidos por arquivo (sem `rm -rf` amplo).

### Status por item pedido

| Item | Veredito | Evidência executada |
|---|---|---|
| **1. G-001 núcleo — bundle limpo** | **VERIFIED** | Build de produção próprio + grep cru do `dist`: `pricing-engine` literal = **0 chunks**; dos 14 identificadores, **13 = 0** (`calculate, defaultScenarios, runB2c, createProposalSnapshot, arkaClassification, normalizeB2cInput, cogs, CURRENT_PREMISES, tierFor, taxRate, serviceCompCap, platformFeeBands, validateTierDiscountPct`). Só `platformFeeTable` = **3**, TODAS classificadas por contexto de byte como property-key/access (ver item 2). Nenhuma fórmula/premissa/tabela de custo no bundle. |
| **2. Gate A4 / `platformFeeTable`** | **GATE LEGÍTIMO (não é furo)** — ver prova adversarial | Ver abaixo. |
| **3. Cálculo SERVER-ONLY em prod** | **VERIFIED** | Único caminho de engine no cliente é `devEngine.loadDevEngine`, com `import('@bondly/pricing-engine')` **lexicamente dentro de `if (import.meta.env.DEV)`** (literal) ⇒ Rollup faz DCE no build de prod. Sem import estático do engine em `src` (só comentário + `type`-only + o `import()` DEV). Prova negativa: todos os símbolos do engine = 0 no bundle. Prova no fio: `POST /api/pricing/quote` sem sessão ⇒ 401 (cálculo exige servidor+sessão). |
| **4. G-031 (triggers)** | **VERIFIED** | Harness contra DB criado pelo código real (`createSqliteRepository`): `approval_decisions` — INSERT ok, **`ON CONFLICT DO NOTHING` ainda funciona** (decisão permanece `approved`, não sobrescrita), UPDATE/DELETE/`INSERT OR REPLACE` **ABORTAM** (`imutável`), valor preservado; `sla_events` — INSERT puro ok (2 linhas), UPDATE/DELETE/`INSERT OR REPLACE` **ABORTAM** (`append-only`), count=2. Inventário: 17 triggers (inclui os 6 novos em `approval_decisions`/`sla_events`). Migração aditiva (`IF NOT EXISTS`, `recursive_triggers=ON`). |
| **5. G-032 (heurística de segredo)** | **VERIFIED — sem falso-aceite** | Harness contra `weakSecretReason` compilado: **PASS** hex-16/hex-32/base64url-48; **FAIL** dev-default, `'x'*40`, sequência, dicionário, `32×'a'`. Adversarial (8 segredos fracos de pouca variedade/binário/data/par-repetido) **todos FAIL** — pegos por `low_entropy`(Shannon<2,5), `trivial_entropy`(período≤16) ou `sequential_pattern`. Falso-rejeite em 2000 amostras: base64url **0**, hex-16 **0**, hex-32 **1** (~0,05%). A redução de Shannon 3,5→2,5 e o período 8→16 **não** abriram falso-aceite, porque `estimatedSecretBits≥128` + período + sequência cobrem o caso estruturado independentemente. |
| **6. smoke-sla** | **VERIFIED (13/13, só conserto de script)** | `node scripts/smoke-sla.mjs` ⇒ PASS 13/13. `git diff` prova que a correção vive **só** em `scripts/smoke-sla.mjs` (+61/−29); nenhuma mudança em `api.ts`/`domain.ts`/`workflow.ts`/`memoryRepository.ts`/`rbac.ts` (UNCHANGED vs HEAD). Era script STALE (modelo RBAC antigo: `role` no cookie) que o RBAC pós-G-008 ignora. Zero mudança de lógica de produção. |

### Veredito adversarial do gate `platformFeeTable` (item 2) — **LEGÍTIMO**
O regex refinado `(?<![.\w])platformFeeTable\s*\(` **tem** lacunas sintáticas isoladas (confirmei: `obj["platformFeeTable"](u)`, `const pf=platformFeeTable;pf(u)`, bracket/alias passam). **Porém isso NÃO torna o gate burlável na prática**, porque a ausência do engine é provada **independentemente** pelos outros 13 tokens. Prova por reintrodução real (sonda temporária `import { calculate } from '@bondly/pricing-engine'` em `App.tsx`, rebuild, medição, revert): mesmo com o engine no bundle, `calculate` = 0 (o minificador renomeia o binding importado) e o regex de `platformFeeTable` **não** o pegaria — **mas o gate FALHOU corretamente (exit 1)** via `cogs`, `platformFeeBands`, `taxRate`, `serviceCompCap`. Esses são **chaves de dados das tabelas de premissa** do engine, que o minificador preserva: o motor não entra no bundle sem arrastar essas strings. Logo o gate é sólido por defesa-em-profundidade, e a exceção de `platformFeeTable` (função proibida vs campo permitido) é a mesma distinção aplicada aos campos de margem.

- **`platformFeeTable` como CAMPO** é exposto **só ao perfil internal**: em `quoteProjection.ts`, `projectQuote` só injeta `result: r` (o `PricingResult` completo, que contém `platformFeeTable`) quando `view==='internal'`; `client`/`commercial` montam casca explícita sem o raw result. `resolveView` devolve `null`⇒**403 `view_forbidden`** se business/approver pedir `internal`. No bundle, os 3 hits são `platformFeeTable:0` (shell zerado), `platformFeeTable:(r?.base)` (adapter) e `.platformFeeTable` (render só sob flag interno em `ResultsDashboard`). **Nunca a business/approver/cliente.**
- **Recomendação (sem decidir):** renomear o CAMPO do `PricingResult` (ex.: `basePlatformFee`) permitiria tornar o gate estrito (`\bplatformFeeTable\b`) **sem exceção** — mais seguro contra regressão futura do que confiar no lookbehind. É mudança cross-contrato (pricing-types+engine+client+testes). O autor já escalou como CONFLICT ao orchestrator; endosso a recomendação, decisão do sponsor.

### CI (A4) — wiring verificado
`.github/workflows/ci.yml`: passo `node scripts/check-bundle.mjs` roda **imediatamente após** `Build do Commercial Workspace` (lê dist fresco) e **antes** do build do auth-proxy; falha a CI em qualquer proibido. Ordem correta. **Lacuna (carry-over G-012):** CI **sem** secret-scan (gitleaks/trufflehog), SAST (semgrep/codeql) e container scan (trivy) — só `npm audit --omit=dev --audit-level=high`.

### Novos Findings (Re-revisão 5)

#### G-034 — LOW — Gate de bundle depende de lookbehind contornável para `platformFeeTable`
- **Componente:** `scripts/check-bundle.mjs` (`/(?<![.\w])platformFeeTable\s*\(/`). **PL-025 §9.2.1 (desenvolvimento seguro — robustez do controle); CWE-184 (lista incompleta).**
- **Evidência (executada):** o regex permite `obj["platformFeeTable"](u)`, alias (`const pf=platformFeeTable;pf(u)`) e bracket-call. **NÃO explorável hoje** (os outros 13 tokens pegam o engine; prova por reintrodução acima). É robustez, não exposição.
- **Recomendação:** renomear o campo do contrato (`basePlatformFee`) e voltar o gate a `\bplatformFeeTable\b` estrito; ou somar um token data-key extra inarredável (ex.: `platformFeeBands` já cobre). **Dono:** product-fullstack. **Status:** OPEN (não-bloqueante).

#### G-035 — LOW/INFO — Comentário de código diverge do valor do piso de Shannon
- **Componente:** `config.ts` — docstring de `weakSecretReason` (l.141) diz "Shannon < 3,5" enquanto a constante `MIN_SHANNON_BITS_PER_CHAR = 2.5` e a docstring da constante explicam a redução para 2,5. Discrepância só documental (o código usa 2,5, verificado). **Recomendação:** alinhar o comentário. **Status:** OPEN (cosmético).

### NÃO VERIFICADO (honesto)
- **Fase 4 inteira:** geração de **PDF por `QuoteView` projetado** (o `pdf.ts` mudou +6 linhas, mas o PDF-por-perfil não foi exercido) e **E2E da jornada cotação→proposta→emissão contra o endpoint real**. Não implementada/não exercida.
- OAuth/Google real e UI no navegador (validação por leitura + testes + boot HTTP; sem clique no browser).
- `docker build`/`trivy image`; secret-scan do histórico git e SAST (ferramentas ausentes — só grep nos arquivos novos = limpo); DAST.
- Concorrência **multi-host** sobre o mesmo SQLite (Render com disco = instância única mitiga).
- PL-026/PL-013/PL-004/PQ-029/PR-133/GD-001 = dependências NOMEADAS; conteúdo não disponível a este Guardian.

### Riscos (PL-025 §9.1.1) — Re-revisão 5
| Projeto | Risco (nível matriz) | Descrição | Impactos | Ações de contorno |
|---|---|---|---|---|
| Bondly | **G-001 núcleo (resolvido)** | Engine/tabelas de custo fora do bundle; cálculo server-only; gate no CI | Classe de risco G-001 ELIMINADA na implementação | Manter o gate verde; fechar Fase 4 (PDF/E2E) |
| Bondly | G-034 (Baixo) = Impacto Médio × Prob. Muito Baixa | Lookbehind do gate contornável para `platformFeeTable` | Nenhum hoje (13 tokens cobrem) | Renomear campo + gate estrito |
| Bondly | G-035 (Baixo) | Comentário Shannon 3,5 vs 2,5 | Confusão de manutenção | Alinhar comentário |

## QUALITY STATUS (Re-revisão 5): **APPROVED WITH CONDITIONS**

**VERIFIED nesta rodada (FIXED→VERIFIED promovido pelo Guardian):** **G-001 núcleo (bundle limpo + cálculo server-only + gate A4 no CI)**, **G-031** (triggers `approval_decisions`/`sla_events`, `ON CONFLICT DO NOTHING` intacto), **G-032** (heurística de segredo sem falso-aceite, hex forte aceito) e o **conserto de `smoke-sla` (13/13, só script)**. O gate `platformFeeTable` é **LEGÍTIMO**, não furo (prova por reintrodução do engine). Novos **G-034/G-035 LOW**, não-bloqueantes.

**G-001 pode ser marcado VERIFIED?** — **SIM, no escopo "cálculo/tabelas de custo-margem fora do bundle do cliente + cálculo server-only + gate de regressão no CI".** A classe de risco original (motor e tabelas de custo no navegador de qualquer usuário com perfil) está **ELIMINADA na implementação**, provada por build próprio + mutação adversarial. A confidencialidade por perfil (`platformFeeTable`/margem só em `internal`) está provada em `quoteProjection.ts`.

**O que FALTA para liberar produção (RELEASE STATUS: ainda não GO — faltam itens de release, não de G-001):**
1. **Fase 4:** PDF por `QuoteView` projetado por perfil **+ E2E** da jornada cotação→proposta→emissão contra o endpoint real (NÃO verificado — condição de APPROVED WITH CONDITIONS).
2. **G-026** (gate de alçada de margem na emissão) ligado no caminho do frontend quando o default for server — backend já VERIFIED, falta o fio de UI/emissão; ou ACCEPTED RISK assinado.
3. **OPEN (fora desta rodada):** **G-002** (VERIFIED em rodada 2) segue aplicado; **G-004, G-005, G-006 funcional** — confirmar estado atual; **G-012** (ADRs das fases 3.x; secret-scan+SAST+trivy no CI); **G-034/G-035** LOW.
4. **Production Readiness Review** completa só após Fase 4 + G-026 no fio, com os gates (incl. check-bundle) verdes no CI.

### Required Actions
1. Implementar e submeter a **Fase 4** (PDF por perfil + E2E) ao Guardian.
2. Ligar **G-026** no caminho de emissão do frontend (ou ACCEPTED RISK assinado com prazo; a UI não pode sugerir controle de alçada inexistente).
3. Registrar **ADRs** (G-012) das decisões 3.1/3.2/3.3 (flag de runtime, envelope flat, adaptador puro, Opção b do TierDiscountPanel) — PL-025 §9.1.1/§9.2.2.

### Recommended Actions
- **G-034:** renomear o campo `platformFeeTable` do contrato e endurecer o gate para `\bplatformFeeTable\b` (remove a exceção do lookbehind).
- **G-035:** alinhar o comentário do piso de Shannon (2,5).
- CI: adicionar **secret-scan (gitleaks/trufflehog) + SAST (semgrep/codeql) + `trivy image`** — hoje só há `npm audit --omit=dev --audit-level=high`.
- Teste de **2 processos** sobre o mesmo SQLite no CI; documentar o `openssl rand -hex 32`/`-base64 48` recomendado no `.env.example` (já feito pelo autor — confirmar).

---

## Resposta do autor (premissas v16 — tier discount validado)

- **Autor:** `product-fullstack`. **Data:** 2026-11-05. Sem commit, push ou AWS. **NÃO marco VERIFIED** — a verificação é do Guardian.
- **DECISION (sponsor/CTO, 2026-11-05):** a política de **desconto por tier** foi ratificada exatamente como o motor já a implementa (base elegível = Platform Fee do tier ativo; waterfall sequencial `PF → ×(1−tier) → ×(1−negociado) → ×(1−prazo)`, não-linear; convive com os descontos negociado e por prazo sem substituí-los; limites inclusivos 3%–7%).

**Mudança (apenas governança + mecanismo de versão — a lógica de cálculo NÃO foi tocada):**
1. Criada a **tabela de premissas v16** (`PREMISES_V16`), derivada bit-a-bit da v15 com **uma única alteração**: `tierDiscountLimits.status: 'pendente' → 'validada'`. Valores min/max **inalterados** (0,03/0,07); todos os demais campos idênticos. `CURRENT_PREMISES` passou a apontar para a **v16** (`version:'v16'`, `effectiveDate` 2026-11-05, `label` próprio; `hash` recomputado por `freezePremiseTable`).
2. A **v15 permanece intacta e congelada** com status `pendente` (snapshot imutável). Adicionado `PREMISES_REGISTRY` + `premisesForVersion(version)` (mudança mínima, aditiva, sem quebrar contratos públicos) para resolver a tabela de uma proposta histórica pela versão. `reopenProposal` agora também reporta `versionRegistered` (campo novo, aditivo).
3. Docs/04 atualizada (linha do desconto por tier → `validada (v16)`; DECISION + data registradas; seção de versionamento com a aplicação concreta v16). **Setup fixo NÃO foi tocado** — permanece `pendente` (decisão do sponsor ainda pendente), conforme instrução.

**Verificação (contagens reais):**
- **typecheck:** PASS (todos os workspaces). **tests:** PASS — suíte completa **845 testes / 49 arquivos** (pricing-engine 117/9, commercial-workspace 138/22, auth-proxy 590/18). `tierDiscount.test.ts` cresceu de 17 → **25** com os novos casos: v15×v16 coexistem, hashes distintos, demais campos idênticos, proposta v15 reabre com status `pendente` histórico e v16 reflete `validada`, resultado numérico idêntico entre versões, `premisesForVersion` resolve por chave. **builds (3×):** PASS. **gate de bundle** (`scripts/check-bundle.mjs`): PASS — nada do engine vazou a mais.
- **NÃO VERIFICADO / ASSUMPTION:** a autoria da DECISION do sponsor foi informada no prompt (não há artefato de ratificação anexado no repo além desta nota). Nenhum CONFLICT: promover a v16 **não exigiu** tocar código de cálculo.

---

## Validação v16 (tier discount) — Guardian (verificação independente)

- **Revisor:** `product-quality-security` (Guardian). **Data:** 2026-11-05. **Autor ≠ revisor** (PL-025 §8.3) — autoria `product-fullstack`, verificação independente por execução. Sem commit/push/AWS; mudanças não commitadas revisadas no working tree. **SOMENTE o Guardian move FIXED → VERIFIED.**

### Veredito por item (revalidado por EXECUÇÃO, não confiando no resumo do autor)

| # | Item | Evidência (independente) | Status |
|---|---|---|---|
| 1 | **v15 intacta + v16 difere só no status** | `PREMISES_V15_BASE` byte-idêntico entre `HEAD` e working tree (diff só ADICIONA v16/registry **após** a v15). Hash v15 recomputado = `c249bfd5` (estável, pré-change). v16 = `8da8c755`. Diff estrutural campo a campo: todos os campos exceto `version/hash/label/effectiveDate/tierDiscountLimits` **idênticos** (`JSON.stringify` igual); `tierDiscountLimits.value` idêntico (min 0.03 / max 0.07); só `status` (pendente→validada) e `referenceDate` diferem. **Setup fixo inalterado** (`40000,60000,100000,140000,180000`), `setupMarkup` 0.2 inalterado. | **VERIFIED** |
| 2 | **Snapshot imutável** | Proposta sob v15 reabre com `premisesVersion='v15'`, status histórico `pendente`, `reproducible=true`, `premisesIntact=true`, `versionRegistered=true`. Nova proposta (sem `premises`) usa CURRENT=v16 (`validada`), `hash==PREMISES_V16.hash`. `reopenProposal` recalcula contra `snapshot.premises`, nunca CURRENT. **Adversarial:** premissa adulterada (`taxRate→0.20`) ⇒ `premisesIntact=false`; forja de status (v15→'validada') ⇒ `premisesIntact=false`; `premisesForVersion('v99')`/versão fantasma ⇒ `versionRegistered=false` **sem throw** (retorna `undefined`). | **VERIFIED** |
| 3 | **Lógica de cálculo inalterada** | `git diff` de `src/pricing/` = **só `platformFee.ts`**, e o grep de linhas +/- não-comentário retornou **zero** (única mudança é JSDoc). `calculate(input, v15)` vs `calculate(input, v16)`: `core/platformFee/tcvClient/technicalMargin` idênticos (|Δ|<1e-9). `parity.test.ts` e `tierDiscount.test.ts` (25) PASS. Base = só Platform Fee e waterfall sequencial preservados. | **VERIFIED** |
| 4 | **Regressão** | typecheck PASS (todos workspaces); builds 3× PASS (engine tsc, auth-proxy tsc, workspace vite 234.94 kB); suíte completa **845 PASS** (engine 117/9, workspace 138/22, auth-proxy 590/18) — **contagens batem com o autor**; bundle gate `check-bundle.mjs` PASS (0 identificadores proibidos); `npm audit --omit=dev` = **0 vulnerabilidades**. Campo aditivo `versionRegistered` não quebra consumidores (adição a objeto de retorno; nenhum consumidor existente removido/alterado). | **VERIFIED** |
| 5 | **Governança/documentação** | docs/04: linha do tier → `validada (v16) · v15: pendente (histórico)`; DECISION sponsor/CTO **2026-11-05 registrada com data**; seção de versionamento com aplicação concreta v16. Setup fixo **não alterado** no diff de docs/04 (grep de linhas +/- com "setup" = vazio). | **VERIFIED** (ver obs. F-01) |

### Findings

- **F-01 — LOW — Documentação** · docs/04 · O status do Setup fixo aparecia apenas como comentário no código (`PREMISES_V16_BASE`), **não** como linha de premissa rastreável em docs/04. **Status: ADDRESSED-PENDING-REVIEW (2026-11-05, product-fullstack).** Com a DECISION do sponsor aplicada na v16, o Setup fixo virou **linha de premissa rastreável** na tabela de docs/04 — `Redução default do Setup fixo | 20% | fração do Setup fixo | validada (v16) · v15: 0% (histórico)` — com DECISION datada e nota de governança; o estado deixou de ser "pendente" e passou a "validada (v16)". A premissa `setupFixedReductionDefault` é agora explícita em `premises.ts` (não só comentário). *Só o Guardian marca VERIFIED.* *Matriz Minu: Impacto Muito baixo × Probabilidade Baixa ⇒ **Baixo** ⇒ LOW.*

### NÃO VERIFICADO / ASSUMPTION

- **A autoria da DECISION do sponsor (CTO, 2026-11-05)** foi afirmada no prompt; não há artefato de ratificação versionado no repo além da nota do autor. Aceito como ASSUMPTION de entrada (fora do alcance técnico desta verificação). Sem impacto no veredito de código.
- Secret-scan (gitleaks/trufflehog) e SAST (semgrep/codeql) **não executados** nesta rodada — nenhum segredo foi introduzido pelo diff (apenas status/governança + registry), mas o gate completo de CI (§9.2.5) segue como dependência já registrada acima.

### Matriz de risco (PL-025 §9.1.1)

| Projeto · Risco(nível) | Descrição do Risco | Impactos | Ações de Contorno |
|---|---|---|---|
| Bondly · Risco(Baixo) | Promoção v16 reabrir proposta histórica com status errado | Reprodutibilidade de proposta antiga quebrada | Snapshot imutável + hash verificado por `reopenProposal` (testado, adversarial PASS) |
| Bondly · Risco(Baixo) | Alteração silenciosa de valor financeiro ao criar v16 | Cálculo divergente / perda de paridade | Diff estrutural + paridade + 845 testes verdes (VERIFIED) |
| Bondly · Risco(Baixo) | Setup fixo promovido por engano | Margem/preço alterados sem aprovação | Confirmado inalterado em código e docs (VERIFIED) |

### Veredito

A **v16 PODE ser marcada VERIFIED**. A promoção é exclusivamente de governança (status `pendente→validada` do `tierDiscountLimits`) + mecanismo aditivo de versionamento (`PREMISES_REGISTRY`/`premisesForVersion`/`versionRegistered`); a v15 permanece congelada e reproduzível, nenhum valor financeiro mudou, a lógica de cálculo é byte-idêntica e toda a suíte/gates passam. Único Finding é LOW não-bloqueante (F-01, higiene de doc). Guardrails MINU: PL-025 §9.1 (design/análise de risco), §9.2.1 (sem segredo, OWASP), §8.3 (autor≠revisor), §27.6 (snapshot imutável) atendidos.

**QUALITY STATUS: APPROVED WITH CONDITIONS**
- **Condição 1 (não-bloqueante):** registrar F-01 (Setup fixo pendente como linha de premissa em docs/04).
- **Condição 2 (governança/dependência):** anexar artefato de ratificação do sponsor ao repo e incluir o gate de CI completo (secret-scan + SAST) conforme já pendente em docs/14.

---

## Resposta do autor (Setup fixo −20% v16) — product-fullstack, 2026-11-05 — **IMPLEMENTADO-PENDENTE-REVISÃO**

Aplicada a **DECISION do sponsor/CTO (2026-11-05): redução uniforme de 20% no Setup fixo de todos os
tiers**, como **DEFAULT GOVERNADO e validado** na v16 — sem reescrever os valores-base dos tiers.
*(Somente o Guardian marca VERIFIED.)*

1. **premises.ts:** nova premissa `setupFixedReductionDefault` no `PremiseTable`. **v15 = 0**
   (congelada, comportamento histórico) · **v16 = 0,20**, `status: 'validada'`, fonte/data = DECISION
   sponsor/CTO 2026-11-05. Valores de `setup` na tabela de `tiers` **inalterados e rastreáveis**
   (40000/60000/100000/140000/180000). v16 passou a ter **duas** mudanças de governança (tier +
   Setup); hashes v15/v16 seguem distintos.
2. **calculate.ts:** a redução efetiva do Setup fixo é `negotiation.setupFixedReductionPct` quando a
   proposta informa; na ausência, usa o **default da tabela ativa** (`setupFixedReductionDefault`).
   Entrada da proposta **sobrescreve** o default. Fórmula não duplicada (segue em `setup.ts`).
3. **Flag `SETUP_FIXED_REDUCTION_PENDING`:** regra nova — só sinaliza **concessão AD HOC por proposta
   acima do default validado** da tabela ativa. O default validado da v16 (20%) **não** é pendente;
   em v15 (default 0) qualquer redução volta a ser ad hoc/pendente (legado preservado). Não foi
   suprimida globalmente.
4. **Versionamento/coexistência:** proposta v15 reabre **sem redução** (snapshot imutável,
   `reopenProposal` reproduz fixo=60000); nova proposta usa v16 com Setup fixo 20% menor por padrão.
   Testado.
5. **Docs:** docs/04 (linha de premissa rastreável do Setup fixo + DECISION datada + regra da flag) ·
   docs/19 (decisão marcada **APLICADA na v16**, tabela de trade-off atualizada) · **F-01 ADDRESSED**
   (status do Setup fixo agora é linha rastreável em docs/04, não só comentário) · follow-up de custo
   de implantação por tier registrado em docs/18.

**Verificação:** typecheck **PASS** (5 workspaces) · testes **PASS** — suíte **852/49**
(pricing-engine **124/9**, +7 casos novos de Setup: v16 aplica −20% por padrão com Growth 60000→48000
e Starter/piso 36000→28800, v16 não emite PENDING, −30% ad hoc emite, v15 sem redução e reabre
idêntica, coexistência v15×v16; `tierDiscount.test.ts` ajustado p/ strip do novo campo; `parity.test.ts`
roda contra **v15** congelada pois v16 diverge no Setup por design) · **3× build PASS** · bundle gate
(`check-bundle.mjs`) **PASS** · `npm audit --omit=dev` registrado abaixo.

**ASSUMPTION:** autoria da DECISION do sponsor afirmada no prompt (sem artefato de ratificação
versionado). **NÃO VERIFICADO:** margem percentual do próprio Setup (data gap — custo de implantação
por tier ainda não cadastrado; follow-up em docs/18). **Não marquei VERIFIED** — cabe ao Guardian.

---

## Validação v16 completa (tier + Setup −20%) — Quality & Security Guardian, 2026-11-05 — **revalidação adversarial por EXECUÇÃO**

> Revalidação INDEPENDENTE da v16 COMPLETA das premissas: (a) desconto por tier (reconfirmação de não-regressão)
> e (b) Setup fixo −20% como default governado. Todos os números abaixo vêm de **execução real** (suíte + builds
> + script adversarial contra o `dist` buildado), não de leitura. Scripts efêmeros do Guardian foram **removidos**
> ao fim (working tree idêntica à do autor). **Autor NÃO é o revisor** (PL-025 §8.3): o autor é product-fullstack;
> esta verificação é do Guardian. Somente o Guardian move FIXED → VERIFIED.

### Status por item do roteiro

| # | Item | Veredito | Evidência (execução) |
|---|---|---|---|
| 1 | v15 intacta em **valores** + diff estrutural | **VERIFIED com RESSALVA (ver F-02)** | diff campo-a-campo v15→v16 = exatamente `{version,hash,label,effectiveDate,tierDiscountLimits,setupFixedReductionDefault}`; `tiers`/setup (40000..180000), `platformFeeBands`, `taxRate`, `setupMarkup`, margens — **idênticos**. `tierDiscountLimits.value` idêntico (0,03/0,07). **PORÉM o hash da v15 mudou** de `c249bfd5` → `4cff5797` (ver F-02). |
| 2 | Corte correto (−20% default; input sobrescreve) | **VERIFIED** | engine: Growth/recomendado/Padrão `60000→48000`; Starter/piso `36000→28800`; Enterprise+/premium/Estratégico `310500→248400`; v15 `=60000` (sem corte). `setupFixedReductionPct=0` explícito na v16 ⇒ fixo `60000` (default DESLIGADO) e **sem** flag — semântica correta e desejável. |
| 3 | Flag `SETUP_FIXED_REDUCTION_PENDING` | **VERIFIED** | v16: default/sem-input **não** emite; input `0,20`(==default) **não**; input `0,10`(<default) **não**; `0,30` e `0,2000001` (ad hoc > default) **emitem**. v15: `0,10`/`0,20` **emitem** (legado, default 0), sem-input **não**. Tentativa de burla por epsilon acima do default: corretamente sinalizada. |
| 4 | Snapshot imutável | **VERIFIED** | snapshot v15 reabre `reproducible/intact/registered=true` com fixo `60000` **mesmo com CURRENT=v16**; snapshot default usa v16 (fixo `48000`). Adulteração de `setupFixedReductionDefault` no snapshot ⇒ `premisesIntact=false` (hash detecta). |
| 5 | Paridade movida p/ v15 | **VERIFIED (correto, não mascara regressão)** | `parity.test.ts` roda contra `PREMISES_V15` e reproduz o `legacyCalc` bit-a-bit nos 100+ cenários do grid (inclui `setupNet`/`setupClient`). A divergência da v16 é **exclusivamente** a redução de 20% do fixo (provado no item 2 + guardrails item 6); nenhum outro número diverge. v15 = equivalente-legado íntegro ⇒ mover a paridade p/ v15 é a decisão correta. |
| 6 | Guardrails (−20% não move margem) | **VERIFIED** | varredura de **336 cenários** (7 tiers × 3 opções × 4 bandas × 4 faixas de horas): `marginStatus` **idêntico** entre v15 e v16 em 100% (diffs=0); `-20%` nunca leva a `REPRECIFICAR` exclusivo da v16; `SETUP_HOUR_BELOW_MIN_MARGIN` idêntico v15/v16 (diffs=0) — confirma docs/19 (Setup não entra na margem técnica; hora mantém R$152,80/HH). |
| 7 | Regressão (suíte/builds/gates) | **VERIFIED** | typecheck **PASS** (5 workspaces); **852 testes PASS** — contagem real confere com o autor: pricing-engine **124/9**, commercial-workspace **138/22**, auth-proxy **590/18**; **3 builds PASS** (bundle 234,94 kB); **bundle gate PASS** (0 identificadores proibidos — motor não vaza ao cliente); **`npm audit --omit=dev` = 0 vulnerabilidades**. |
| 8 | F-01 (linha rastreável em docs/04) | **VERIFIED → F-01 FECHADO** | docs/04: `Redução default do Setup fixo | 20% | fração do Setup fixo | validada (v16) · v15: 0% (histórico, congelado)` como **linha de premissa** (não comentário); DECISION datada 2026-11-05; `setupFixedReductionDefault` explícita em `premises.ts`. Seção alterada só no que a decisão exige. |

### Findings novos

- **F-02 — MEDIUM → rebaixado a LOW com a ressalva abaixo — Governança de versionamento / forward-compat** · `premises.ts` + `proposal.ts` · **Descrição:** adicionar o campo `setupFixedReductionDefault` ao `PremiseTable` alterou o **hash da v15** de `c249bfd5` (minha validação anterior, item 1 daquela tabela) para **`4cff5797`** — porque o hash FNV-1a serializa a tabela inteira. **Prova:** recomputar o hash da tabela v15 **sem** o campo novo devolve exatamente `c249bfd5`; **com** o campo, `4cff5797`. Logo a afirmação "v15 byte-idêntica ao histórico, hash `c249bfd5`" é **FALSA para a identidade de snapshot** (embora **todos os valores financeiros** da v15 sigam byte-idênticos e a paridade legada passe). **Impacto:** uma `ProposalSnapshot` persistida **sob o schema anterior** (cópia congelada SEM o campo, `premisesHash=c249bfd5`) ao ser reidratada em `reopenProposal` **lança `TypeError: Cannot read properties of undefined (reading 'value')`** em `calculate.ts:97` — não degrada graciosamente, crasha. **Como reproduzir:** congelar uma tabela v15 sem `setupFixedReductionDefault`, montar um `ProposalSnapshot` com ela e chamar `reopenProposal`. **Severidade real = LOW** porque **não há dado histórico quebrado hoje**: o backend (`domain.ts`/`pricingQuote.ts`) **persiste INPUTS e recalcula com `CURRENT_PREMISES`** — NÃO guarda a tabela de premissas congelada; não há nenhum `.db`/store com `ProposalSnapshot` do schema antigo. É **robustez/forward-compat**, não corrupção existente. **Recomendação (follow-up, não bloqueante):** (i) ao evoluir o schema do `PremiseTable`, versionar também o SCHEMA ou adicionar guarda defensiva em `calculate`/`reopenProposal` para campo ausente (default seguro 0) de modo que snapshots antigos reabram sem crash; (ii) corrigir a referência a `c249bfd5` neste doc (linha da "Validação v16" anterior) para registrar que o hash da v15 **mudou** com a adição do campo. **Responsável:** product-fullstack. **Status: OPEN (LOW, não bloqueante).** *Matriz Minu (PL-025 §9.1.1): Impacto Técnico Baixo (reversível, custo pouco significativo; sem dado em produção) × Probabilidade Muito Baixa (1–10%; exige snapshot persistido no schema antigo, que não existe) ⇒ nível **Baixo** ⇒ LOW.*

- **F-03 — LOW — Documentação (drift)** · `docs/04` §Versionamento (último parágrafo) · **Descrição:** o texto diz que a v16 foi "derivada da v15 com a **única mudança** `tierDiscountLimits.status: pendente → validada`" — desatualizado: a v16 COMPLETA tem **duas** mudanças de governança (tier + `setupFixedReductionDefault`). O corpo da mesma doc (tabela de premissas e §4) já descreve ambas; só o parágrafo de fecho ficou com a redação da v16 parcial. **Impacto:** confusão de leitura, zero efeito em código/cálculo. **Recomendação:** ajustar "única mudança" → "duas mudanças de governança (tier validado + Setup fixo −20%)". **Responsável:** product-fullstack. **Status: OPEN (LOW).** *Matriz Minu: Impacto Muito Baixo × Probabilidade Baixa ⇒ **Baixo** ⇒ LOW.*

### NÃO VERIFICADO (fora do alcance do motor hoje)

- **Margem percentual do próprio Setup** — data gap confirmado: o motor não cadastra **custo de implantação por tier**, então "% de margem do Setup" é **inrespondível** (não inseguro, não-medível). Follow-up aberto em docs/18 §7 e docs/19 §5/§6 (dono: project-book). A segurança do −20% foi medida **apenas** contra os guardrails existentes (`marginStatus`/`SETUP_HOUR_BELOW_MIN_MARGIN`) — e lá é seguro (item 6).
- **Ratificação do sponsor da DECISION 2026-11-05** — afirmada no prompt; sem artefato versionado (ADR/registro). **ASSUMPTION** herdada; recomenda-se ADR no Notion (PL-025 §9.1.1/§9.2.2) formalizando tier validado + Setup −20%.

### QUALITY STATUS: **APPROVED WITH CONDITIONS**

A **v16 COMPLETA PODE ser marcada VERIFIED** e o **F-01 PODE ser FECHADO**. Os 8 itens do roteiro foram
revalidados por execução: valores financeiros da v15 intactos, corte −20% correto e governado, flag com
semântica correta (inclusive v15 legado e tentativas de burla), snapshots imutáveis, paridade legítima
contra a v15, guardrails inalterados em 336 cenários, suíte 852/852 + 3 builds + bundle gate + audit 0.
A mudança é de **governança** (status do tier + default de Setup) + mecanismo aditivo de versionamento
(`PREMISES_REGISTRY`/`premisesForVersion`/`versionRegistered`); nenhuma lógica de cálculo mudou; a v15
reproduz o legado bit-a-bit. Guardrails MINU atendidos: PL-025 §9.1 (análise de risco/impacto em docs/19),
§9.2.1 (sem segredo no repo — audit limpo; OWASP não afetado), §8.3 (autor≠revisor respeitado), §27.6
(snapshot imutável). **Condições (não bloqueantes):** fechar F-02 (guarda de schema/forward-compat +
corrigir a referência a `c249bfd5`) e F-03 (drift do parágrafo de versionamento em docs/04). Nenhum
CRITICAL/HIGH; nada quebra o Quality Gate.

**Required Actions:** nenhuma bloqueante.
**Recommended Actions:** (1) F-02 — ao evoluir o schema do `PremiseTable`, adicionar guarda defensiva p/
campo ausente em `calculate`/`reopenProposal` (snapshots antigos reabrem sem crash) e corrigir a menção a
`c249bfd5` nesta doc; (2) F-03 — ajustar "única mudança" → "duas mudanças" em docs/04 §Versionamento;
(3) ADR da DECISION do sponsor (tier validado + Setup −20%); (4) **Follow-up de produto (project-book):**
cadastrar custo de implantação por tier + guardrail de margem do próprio Setup; (5) publicação em
Bondly_Simulator2 permanece ação do usuário (mudanças não commitadas) — Production Readiness segue
condicionada à homologação AWS já listada em docs/18.

---

## Resposta do autor (F-02 + F-03) — product-fullstack, 2026-11-05

Escopo fechado: só os dois findings LOW. Não marquei VERIFIED (cabe ao Guardian).

**F-02 (forward-compat / robustez) — ADDRESSED.** A leitura do novo campo agora tolera ausência no
ponto que o Guardian provou crashar: `packages/pricing-engine/src/calculations/calculate.ts:101` passou
de `premises.setupFixedReductionDefault.value` para `premises.setupFixedReductionDefault?.value ?? 0`
(campo ausente ⇒ 0 = comportamento histórico da tabela antiga; `reopenProposal`/`calculate` reabrem sem
`TypeError`). **Semântica das tabelas atuais inalterada** (v15=0, v16=0,20) — nenhum campo novo na
tabela, só guarda de leitura. **Teste novo:** `packages/pricing-engine/tests/setup.test.ts` — *"snapshot
legado SEM setupFixedReductionDefault reabre sem crash e reproduz Setup sem redução"* (strip do campo de
uma tabela v15 congelada; prova `not.toThrow()` em `calculate` e em `reopenProposal`, com Setup fixo
60000 sem redução).

**F-03 (drift documental) — ADDRESSED.** `docs/04-regras-financeiras-e-premissas.md:150` (§Versionamento,
parágrafo de fecho): "única mudança `tierDiscountLimits.status: pendente → validada`" → **"duas mudanças
de governança"** (tier validado + `setupFixedReductionDefault: 0 → 0,20` validada). Nenhuma outra
afirmação alterada.

**Verificação (execução real):** typecheck **PASS** (5 workspaces) · suíte **PASS 853** — pricing-engine
**125/9** (era 124; +1 teste de F-02), commercial-workspace **138/22**, auth-proxy **590/18** · **3×
build PASS** (determinístico, bundle 234,94 kB) · bundle gate (`scripts/check-bundle.mjs`) **PASS** (0
identificadores proibidos) · `npm audit --omit=dev` **0 vulnerabilidades**. **Hash da v15 NÃO mudou** com
este fix: segue `4cff5797` (o fix é no código de leitura, não na tabela; a tabela não ganhou campo).

**ASSUMPTION:** não há `ProposalSnapshot` persistido do schema antigo hoje (backend recalcula com
`CURRENT_PREMISES`) — o fix é forward-compat preventivo, não correção de dado corrompido. **NÃO
VERIFICADO:** nada novo fora do escopo dos dois findings. Sem commit/push (ação do usuário).

## Resposta do autor (Fase 4 — PDF por perfil + E2E) — product-fullstack, 2026-11-05 — **IMPLEMENTADO-PENDENTE-REVISÃO**

Fecha as duas condições abertas da Fase 4 (A4/gate de bundle já estava FEITO — não refeito). **Não marco VERIFIED** — isso é do Guardian. Sem commit/push/AWS.

**PDF por perfil (QuoteView, não engine) — DECISION.** `apps/commercial-workspace/src/services/pdf.ts` foi REESCRITO: a função pública passou de `generateProposalPdf(snap: ProposalSnapshot, audience)` para `generateQuotePdf(quote: QuoteViewPayload, meta)`. O PDF agora é montado a partir do **QuoteView projetado pelo servidor** (`client`/`commercial`/`internal`) — a MESMA fonte das telas (`useCentralPricing`/`adaptQuote`) —, **sem importar `@bondly/pricing-engine` nem `loadDevEngine`**. A audience é DERIVADA da `view` (internal⇒peça completa; client/commercial⇒peça do cliente). A fronteira de confidencialidade ficou **ESTRUTURAL**: a peça externa nasce de um payload que **não contém** custo/COGS/margem/tributo/fee Minu — não há de onde vazar, independente do gerador "lembrar" de esconder.
- **Acoplamento removido:** o `loadDevEngine()` (ARKA) e o consumo de `ProposalSnapshot`/`createProposalSnapshot` saíram do `pdf.ts`. A seção ARKA foi removida do PDF interno — **ARKA não está no contrato `quote.v1`** (classificação vive no engine, `arkaClassification`); o breakdown interno vem de `quote.result` (PricingResult projetado só na view `internal`). **ASSUMPTION:** ARKA no PDF interno fica como follow-up (precisaria o servidor projetar a classificação no payload); não reintroduzi o engine só por isso.
- **Preview (DEV):** `PreviewModal.tsx` agora projeta o QuoteView em DEV via `projectQuotePreview` (novo helper DEV-only em `devEngine.ts`, espelho de `quoteProjection.ts`, campos travados por `quoteTypes.sync.test.ts`) e chama `generateQuotePdf`. Em produção o payload vem do fio. Todo o caminho segue DEV-gated+DCE'd: **o chunk jsPDF nem aparece no `dist` de produção**.
- **Testes de confidencialidade (3 perfis):** `pdf.confidentiality.test.ts` reescrito — intercepta `doc.text` (mock jsPDF) E varre o próprio payload JSON. Prova: `client` e `commercial` (business/approver) sem termo interno no texto **e** sem chave interna (`costs`/`taxes`/`technicalMargin`/`"result"`/…) no payload; `internal` (tech/admin) contém o breakdown. `pdf.test.ts` migrado para a nova assinatura.

**E2E cotação→proposta→emissão — FEITO.** `scripts/smoke-e2e-quote-proposal.mjs` (+`npm run smoke:e2e`), padrão smoke-quote/smoke-sla: auth-proxy REAL buildado + SQLite em `DATA_DIR` efêmero (limpo no `finally`), bootstrap admin, perfis via API, cookies de sessão. Exercita: (A) cotação por perfil no fio (business⇒`commercial` sem custo; tech⇒`internal` com breakdown); (B) criação de proposta + **reconciliação cotação=proposta** (quote por `{input}` == quote por `{proposalId}` no `pricing` público); (C) jornada feliz margem saudável submeter→análise→aprovar técnico→consolidar→emitir (200, sem exceção); (D) G-026 em margem abaixo do piso. **Resultado: 27/27 PASS.**
- **CONFLICT (informativo, não-bug) — premissa da tarefa vs código.** A tarefa afirmava "G-026 server-side existe mas `emitir` ainda não o consulta — não implemente, só documente". **O código atual JÁ consulta G-026 na emissão:** `api.ts` (~l.715) roda `emissionGate` quando `decision.to` é `pronto_para_emissao` (consolidar) **OU** `emitido` (emitir) — defesa em profundidade, confirmada por `emissionGuard.test.ts` ("emitir também é protegido"). Não é regressão nem bug: é o gate **mais** forte do que a premissa supunha. O E2E ASSERTA o comportamento REAL (sem falso verde): consolidar sem exceção ⇒ 409; com exceção aprovada ⇒ consolidar 200 e emitir 200. **Nada novo de G-026 foi implementado.**

**Verificação (execução real, 2026-11-05):** typecheck **PASS** (5 workspaces) · suíte completa **PASS 854** — pricing-engine **125/9**, commercial-workspace **139/22** (inclui `pdf.test.ts` 3, `pdf.confidentiality.test.ts`, `PreviewModal.failure.test.tsx`), auth-proxy **590/18** · **3× build PASS** (dist comercial 234,94 kB) · bundle gate `scripts/check-bundle.mjs` **PASS (0 proibidos)** — o `pdf.ts` baseado em QuoteView **não** reintroduz `calculate`/`cogs`/`CURRENT_PREMISES`/engine · `npm audit --omit=dev` **0 vulnerabilidades** · **E2E `smoke-e2e-quote-proposal.mjs` 27/27 PASS**.

**NÃO VERIFICADO / pendências honestas:** (1) **render visual** do PDF por perfil (os testes são estruturais sobre o texto/dados escritos, não um PDF aberto a olho) — recomendo validação visual na tela antes do PRR. (2) **ARKA no PDF interno** removida (follow-up: projetar a classificação no `quote.v1` se exigida na peça interna). (3) G-026 **não** foi tocado (fora de escopo). (4) `VERIFIED` e PRR são do Guardian. Sem commit/push/AWS (ação do usuário).

---

## Revisão Fase 4 (PDF + E2E + G-026) — product-quality-security (Guardian), 2026-11-05 — **independente e adversarial**

Revisão da FASE 4 do G-001 sobre as mudanças NÃO commitadas (branch `main`, repo `bondly-commercial-platform`). Resumo do autor (subagente `4699cc008ebf0d1e`) NÃO foi tomado como verdade — **tudo revalidado por execução**. Nenhum código foi corrigido nesta run. Sem commit/push/AWS. **Só o Guardian move FIXED → VERIFIED.**

### Evidência de execução (reproduzível)
- **Typecheck:** `npm run typecheck` ⇒ **PASS nos 5 workspaces** (pricing-catalog, pricing-types, pricing-engine, auth-proxy, commercial-workspace). Exit 0.
- **Build:** `npm run build` ⇒ **PASS** — pricing-engine (tsc), auth-proxy (tsc), commercial-workspace (tsc --noEmit && vite build). Bundle de prod único `dist/assets/index-D42PseMA.js` = **234,94 kB** (gzip 71,04 kB); **nenhum chunk jsPDF/engine separado** emitido. Exit 0.
- **Suíte completa:** `npm test` ⇒ **854 testes PASS** — pricing-engine **125/9 arquivos**, commercial-workspace **139/22**, auth-proxy **590/18**. **Contagens batem 1:1 com o auto-reporte do autor (854).** Exit 0.
- **E2E real:** `node scripts/smoke-e2e-quote-proposal.mjs` ⇒ **27/27 PASS** contra o auth-proxy REAL buildado (NODE_ENV=production, SQLite em `DATA_DIR` efêmero). Dir efêmero (`e2e-quote-proposal-*`) **removido** no `finally` — confirmei que não sobrou lixo no repo nem no scratch. Exit 0.
- **Bundle gate:** `node scripts/check-bundle.mjs` ⇒ **PASS, 0 identificadores proibidos** no `dist` de prod. Confirmei por grep independente: `calculate|CURRENT_PREMISES|cogs|createProposalSnapshot|arkaClassification|runB2c|defaultScenarios|taxRate|normalizeB2cInput|serviceCompCap|validateTierDiscountPct|platformFeeBands|tierFor` = **0 ocorrências**. **`jsPDF` = 0 no bundle de prod** (todo o caminho PDF é DEV-gated via `if (import.meta.env.DEV)` em `devEngine.ts` e DCE'd pelo Rollup — confirmado).
- **Dependências:** `npm audit --omit=dev` (caminho de PRODUÇÃO) ⇒ **0 vulnerabilidades**.

---

### Item 1 — PDF por perfil / confidencialidade ESTRUTURAL → **VERIFIED**

**Parecer:** a fronteira de confidencialidade do PDF é **estrutural**, não cosmética, e está correta.
- `apps/commercial-workspace/src/services/pdf.ts` consome `QuoteViewPayload` e **NÃO importa** `@bondly/pricing-engine` nem `loadDevEngine` para calcular — só formata o que o servidor projetou. Confirmado por leitura e pelo bundle gate (0 símbolos do engine). `import type { jsPDF }` é type-only (apagado no build); o `import('jspdf')` runtime vive no caminho DEV e não entra no `dist` de prod.
- `pdf.confidentiality.test.ts` prova nos **3 perfis** (client/commercial/internal): varre o TEXTO renderizado (mock de `doc.text`) **e** o PAYLOAD JSON de origem — `client`/`commercial` não contêm `costs`/`taxes`/`technicalMargin`/`netMargin`/`tcvBondly`/`setupNet`/`premisesHash`/`minuConversionFee`/`"result"` nem termos internos; `internal` contém o breakdown. **PASS** na suíte.
- Reforço no fio (E2E): `business` ⇒ view `commercial` **sem** custo/margem (`!LEAK.test` no texto bruto da resposta HTTP, PASS); `tech` ⇒ `internal` com `costs.total>0`. A projeção de PRODUÇÃO (servidor) é exercida pelo E2E; o teste de PDF exercita o ESPELHO DEV (`projectQuotePreview`), cujos campos são travados contra o SOURCE do servidor por `quoteTypes.sync.test.ts` — cadeia de prova íntegra.

### Item 2 — G-026 / gate de emissão por margem → **VEREDITO EXPLÍCITO: EFETIVO HOJE. G-026 NÃO é mais pendência.**

**A correção de premissa do autor está CORRETA e confirmada por código + execução adversarial.** A emissão (transição → `emitido`) **JÁ é gated** por `emissionGate`; não é só a consolidação.

Prova (código, `apps/auth-proxy/src/api.ts` l.716): `if (decision.to === 'pronto_para_emissao' || decision.to === 'emitido') { const gate = emissionGate({...}); if (!gate.ok) return json(409, ...) }`. O gate lê `commercial` (inputs PERSISTIDOS), `requests` e `audit` do repositório — **nunca** de flag do cliente.

Teste adversarial (executei; todos PASS no E2E e em `emissionGuard.test.ts`, que roda via `handleApi` em memória **e** SQLite):
- **Emitir com margem abaixo do piso (REPRECIFICAR) e SEM exceção aprovada ⇒ bloqueado** (409 `approval_required`). ✔
- **Pular consolidar e emitir direto ⇒ bloqueado** pela FSM (`canTransition`: `emitir` só é válido de `pronto_para_emissao`; de `aprovado_tecnicamente` ⇒ 409 `transition_invalid_from`). Não há atalho de estado. ✔
- **Exceção REJEITADA e emitir ⇒ bloqueado;** só a ÚLTIMA `excecao_comercial` `approved` libera. ✔
- **Exceção de OUTRO kind (`alteracao_escopo`) aprovada ⇒ NÃO libera** (o gate filtra `kind === 'excecao_comercial'`). ✔
- **Aprovar e depois EDITAR material ⇒ reabre:** `invalidationOnEdit` devolve a proposta à reanálise (volta a `aguardando_analise_tecnica`/`em_analise_tecnica`) e o gate detecta `proposal.edit_commercial` posterior à aprovação na auditoria ⇒ volta a bloquear. ✔ (teste "MUDANÇA MATERIAL invalida a aprovação")
- **Edição NÃO material após aprovar ⇒ também re-bloqueia** (a margem pode ter mudado; a aprovação só vale para a versão decidida). ✔
- **Flag do cliente (`requiresApproval:false`, `marginStatus:'SAUDÁVEL'`) ⇒ ignorada;** o alerta vem dos inputs persistidos. ✔
- **Fail-closed:** inputs legados `{}` liberam por padrão, mas `PRICING_GUARD_STRICT` ⇒ 409 `pricing_inputs_incomplete`. ✔

**Conclusão:** **NÃO existe caminho de emitir com margem abaixo do piso sem aprovação válida.** G-026 passa de condicional para **VERIFIED (efetivo em defesa em profundidade)**.

### Item 3 — E2E cotação→proposta→emissão → **VERIFIED**

`scripts/smoke-e2e-quote-proposal.mjs` **27/27 PASS** (real, não mock). Verifiquei que **não dá falso-verde**:
- Reconciliação **cotação = proposta** é assertada por igualdade do `pricing` público (`pricingOf(byInput) === pricingOf(byProposal)`) — mesma fonte persistida, nada recalculado no cliente. ✔
- G-026 assertado pelo **comportamento REAL** (consolidar sem exceção ⇒ 409; com exceção aprovada ⇒ consolidar 200 e emitir 200), não por uma expectativa frouxa. ✔
- Log estruturado **sem valores de preço** (`!/"users":50000|extraDiscount|"monthly":/` e presença de `pricing_quote`). ✔
- **Limpeza** do dir efêmero no `finally` confirmada (sem leftovers). ✔

### Item 4 — Regressão → **VERIFIED** (ver Evidência de execução acima)
Typecheck 5/5 · 854 testes · 3 builds · bundle gate 0 · `npm audit --omit=dev` 0. Tudo verde e reproduzido por mim.

### Item 5 — Pendências honestas
- **Render VISUAL do PDF — NÃO VERIFICADO (correto do autor).** Os testes são estruturais (texto/dados escritos), não abrem o PDF a olho. **Recomendação (não bloqueia o gate, bloqueia o PRR):** validação visual na tela dos 3 perfis antes do deploy. É validação de aparência, não de confidencialidade (esta já é estrutural).
- **ARKA removida do PDF interno — aceitável como follow-up (LOW), NÃO regressão de confidencialidade.** ARKA não está no contrato `quote.v1`; reintroduzi-la exigiria o engine no cliente (contra o G-001) OU o servidor projetar a classificação no payload. A peça do CLIENTE nunca teve ARKA; só a peça INTERNA perdeu uma seção informativa. Severidade **LOW** — perda funcional menor na peça interna, endereçável projetando ARKA no `quote.v1` quando exigida.

---

### Findings novos

**F-04 — Bundle gate não cobre tokens de ESTRUTURA DE CUSTO (`costs`/`cleverTap`/`infra`/`taxes`) — Severidade: LOW (INFO) — Status: OPEN**
- **Componente:** `scripts/check-bundle.mjs` (lista `FORBIDDEN`).
- **Descrição/Evidência:** grep independente no `dist` de prod achou `cleverTap` 3× e `CleverTap` 1×. Inspecionados: (1) `costs:{cleverTap:0,...}` — SENTINELA ZERADA do `quoteAdapter.shellFrom`; (2) `const Dp={cleverTap:0,...}` — constante `ZERO_COSTS` (tudo 0); (3) label de UI `"Custo variável"/"CleverTap "` + `t.costs.cleverTap` no render interno do `ResultsDashboard`. **Nenhum é um VALOR de custo hard-coded** — os números só chegam do servidor na view `internal` (RBAC-gated); client/commercial recebem 0 por construção (`hasInternal:false`).
- **Impacto:** nulo para confidencialidade (a fronteira é o servidor, provada pelo E2E `!LEAK`). O risco é de **regressão futura**: se alguém reintroduzisse cálculo de custo no cliente usando esses nomes de campo, o gate NÃO acusaria. Mesma categoria do `platformFeeTable` já documentada (CONFLICT A4) — colisão nome-de-campo × nome-de-tabela.
- **Recomendação:** acrescentar ao gate um padrão que distinga VALOR de custo de LABEL/sentinela (ex.: proibir `costs:\{[^}]*[1-9]` ou os identificadores do engine que PRODUZEM custo — já cobertos por `cogs`/`calculate`). Não bloqueia; endurecimento preventivo. **Responsável:** product-fullstack.

**F-05 — Vulnerabilidades DEV-ONLY no toolchain de teste (vitest/vite/esbuild/tinypool) — Severidade: MEDIUM (dev-only; NÃO shippado) — Status: OPEN (tracking PQ-029)**
- **Evidência:** `npm audit` completo = 6 vulns (2 CRITICAL, 1 HIGH, 3 MODERATE). Todas transitam de `vitest@2.1.9`/`vite`/`esbuild`/`tinypool@1.1.1` (devDependencies). `npm ls tinypool` ⇒ `@bondly/auth-proxy → vitest@2.1.9 → tinypool@1.1.1`. **`npm audit --omit=dev` = 0** — nada atinge o runtime de produção (bundle comercial nem o server auth-proxy).
- **Impacto:** superfície de CI/dev (prototype pollution → RCE em worker do test runner). Não embarca em produção. Risco Minu: Impacto Médio (reversível, custo baixo) × Prob. Baixa ⇒ **nível MEDIUM**.
- **Recomendação (PQ-029 + lição retida):** bump DELIBERADO de vitest para linha corrigida e **re-rodar a suíte completa + smoke E2E** (NÃO `npm audit fix --force` cego — é um major breaking). Não bloqueia este gate. **Responsável:** product-fullstack.

### Análise de risco (matriz Minu — PL-025 §9.1.1)
| Projeto | Risco (nível) | Descrição do Risco | Impactos | Ações de Contorno |
|---|---|---|---|---|
| Bondly | **G-001/G-026 — RESOLVIDO** (Impacto Alto × Prob. **Muito baixa** residual ⇒ nível Baixo) | Vazamento de custo/margem ao cliente / emissão abaixo do piso sem aprovação | CWE-200/602; perda de margem por emissão indevida | Cálculo server-only + projeção por perfil + bundle gate + emissionGate em consolidar E emitir (defesa em profundidade). **Eliminado na implementação.** |
| Bondly | **F-05 toolchain (Médio)** = Impacto Médio × Prob. Baixa | CVEs CRITICAL/HIGH em vitest/vite/tinypool (dev) | RCE no ambiente de CI/dev; não atinge produção | Bump deliberado de vitest + re-rodar suíte (PQ-029). Não shippado. |
| Bondly | **F-04 gate de bundle (Baixo)** = Impacto Baixo × Prob. Muito baixa | Gate não cobre tokens de estrutura de custo | Regressão futura de custo no cliente passaria silenciosa | Endurecer `FORBIDDEN` com padrão de VALOR de custo. |

**Dependências de política (NÃO inventadas):** PQ-029 (gestão de vulnerabilidades) rege o tratamento de F-05 — conteúdo não está em mãos, sinalizado como dependência. PL-026 (log/privacidade) — o E2E prova log sem valores de preço (✔ alinhado ao princípio, política completa pendente). ADR: a decisão "PDF por QuoteView, sem engine, fronteira estrutural" É uma decisão arquitetural com mitigação de risco (§9.1.1/§9.2.2) — **registrar como ADR no Notion** (hoje vive só em docs/15; Finding de governança já aberto em rodadas anteriores, mantido).

---

### NÃO VERIFICADO (honestidade)
1. **Render visual do PDF** (3 perfis) — só estrutural; validar na tela antes do PRR.
2. **Scans CI em pipeline real** (SAST/secret scan/container scan rodando no GitHub Actions) — validei local; não observei uma execução do workflow no CI.
3. **ARKA no PDF interno** — removida; não reintroduzida (follow-up LOW).
4. **Findings de PRODUTO G-002/G-004/G-005/G-006** — fora do escopo desta revisão de Fase 4; permanecem como registrados nas seções anteriores.
5. **PRR completa** (secrets configurados no painel, migrations/backup validados em staging, rollback, monitoring) — não executada aqui.

### O que ainda falta para PRODUÇÃO
- **PRR (Production Readiness Review)** formal: CI verde no GitHub (não só local), secrets no painel do Render, healthcheck, monitoring/observabilidade, estratégia de rollback, backups validados, separação dev/homolog/prod (PL-025 §9.2.5/§9.2.6/§9.7).
- **Validação visual do PDF** por perfil.
- **Remediação de F-05** (toolchain dev) sob PQ-029.
- **Findings de produto** G-002/G-004/G-005/G-006 conforme suas seções.
- **ADR no Notion** para a decisão G-001-A (governança §9.1.1/§9.2.2).

---

### Marcação de status
- **Fase 4 (PDF por perfil + E2E + bundle gate no CI): VERIFIED.** Os 2 entregáveis abertos (PDF por QuoteView; E2E da jornada) foram implementados, revalidados por execução independente, e passam. Confidencialidade estrutural e G-026 efetivo provados adversarialmente.
- **G-001 COMPLETO: VERIFIED** quanto à ELIMINAÇÃO DA CLASSE DE RISCO (cálculo server-only, engine/custos fora do bundle de prod provado por gate, PDF sem engine, emissão gated). A marcação de **produção** permanece condicionada ao **PRR** e à validação visual — ver "O que ainda falta para produção".
- **G-026: VERIFIED** (efetivo hoje; deixa de ser pendência).

## QUALITY STATUS: **APPROVED WITH CONDITIONS**

**Aprovado:** Fase 4, G-001 (classe de risco eliminada) e G-026 (gate de emissão efetivo) estão VERIFIED por execução independente. Não há bloqueio técnico: sem CRITICAL/HIGH no caminho de produção, build ok, 854 testes + E2E 27/27 verdes, secret/engine fora do bundle, emissão fail-closed por margem.

**Condições (antes do deploy / PRR):** (1) validação VISUAL do PDF por perfil; (2) CI verde no GitHub (observar o workflow, não só local); (3) remediar F-05 (bump deliberado de vitest sob PQ-029); (4) registrar ADR do G-001-A no Notion; (5) endurecer o bundle gate (F-04, não bloqueante); (6) PRR formal (secrets/rollback/backup/monitoring/separação de ambientes).

**Required Actions:** nenhuma que bloqueie o merge destas mudanças (o conteúdo da Fase 4 está correto e verificado). As condições acima são para o **deploy de produção**, não para aceitar a Fase 4.

**Recommended Actions:** F-04, F-05, ADR, validação visual, PRR — nesta ordem de preparação para produção.

> **Autorreview:** esta revisão foi feita pelo Guardian sobre código de OUTRO autor (product-fullstack). AUTOR ≠ REVISOR respeitado (§8.3/§13). Nenhum código foi escrito/alterado por mim nesta run.

---

## Resposta do autor (redesign PDF) — product-fullstack

**Escopo:** reimplementação de `apps/commercial-workspace/src/services/pdf.ts` conforme a SPEC VISUAL
`docs/20-spec-visual-pdf.md`, replicando a referência do sponsor à risca. Sem commit/push/AWS; não marco VERIFIED.

**DECISION (sponsor, fixa):** replicar a referência à risca — cor de destaque **verde-limão `#C2FF01`**
(`rg 0.761 1 0.004`) e fontes **Space Grotesk** (títulos/corpo) + **Geist Mono** (números/eyebrows/labels/rodapé);
navy `#12215E`; margem 51pt. Supera a recomendação condicional da §5 de docs/20 (amber + Helvetica) por direção
explícita do sponsor. Os tokens de cor/fonte ficam centralizados no topo de `pdf.ts` para troca trivial.

**Implementado (docs/20 §1–§4):**
- **Fontes embutidas no VFS do jsPDF** via `addFileToVFS`+`addFont` (`src/services/pdfFonts.ts`), com os TTF
  base64 em `src/assets/pdfFonts.ts` (gerado por `scripts/build-pdf-fonts.mjs`). Carga **sob demanda**: `pdf.ts`
  importa as fontes por `import()` dinâmico, já atrás do guard literal `import.meta.env.DEV` do único caller
  (`PreviewModal.download`). Resultado: build de prod = **1 asset `index-*.js` de 234.94 kB** sem jsPDF/fontes/PDF
  (DCE do Rollup) — peso das fontes **fora do bundle principal**, confirmado por `scripts/check-bundle.mjs` (0
  proibidos) e pela ausência de chunk de fonte/jsPDF no dist.
- **Fontes OFL/open** (`@fontsource/space-grotesk` + `@fontsource/geist-mono`, SIL OFL 1.1), subset `latin`
  (cobre acentos pt-BR, verificado por probe de cmap). woff2→TTF via `wawoff2` (descompressor woff2 oficial do
  Google). Atribuição em `src/assets/OFL.md`.
- **Layout:** capa navy full-bleed (logo + eyebrow de perfil + título `clientName` 34pt + subtítulo 20pt com 2ª
  palavra verde-limão + pares de dados); template interno repetível (kicker mono + título navy 17pt + faixa navy
  de KPIs + tabelas com header-band navy e separadores `#D4D9E3`, números mono right-aligned); seções na ordem do
  §4; contracapa "Obrigado pela oportunidade" (30pt) espelhando a capa; rodapé `pág. x/y` em todas as páginas.
- **Confidencialidade por perfil (§3, inegociável):** mantidos os guards por PRESENÇA de campo — `if (commercial)`
  / `if (internal && result)`. Nenhum custo/margem/COGS/tributo/fee Minu em client/commercial (não existem no
  payload). O label interno `Platform Fee` não reaparece em commercial — o bloco de preço comercial usa
  "Taxa de plataforma" (termo de preço), preservando o termo-gate.
- **Contrato preservado:** `generateQuotePdf(QuoteViewPayload, QuotePdfMeta)` inalterado. Testes atualizados sem
  afrouxar o gate: `pdf.confidentiality.test.ts` manteve os loops `INTERNAL_TERMS`/`INTERNAL_PAYLOAD_KEYS`
  intactos; só o rótulo de conteúdo mudou (`Investimento mensal estimado` → `Resumo do investimento`).

**Verificação (contagens reais, NÃO VERIFIED — gate do Guardian):**
- typecheck `@bondly/commercial-workspace`: **PASS**
- suíte completa do app: **PASS 139/139** (22 arquivos); testes de PDF 6/6.
- builds de produção ×3: **PASS** determinísticos (hash idêntico `index-D42PseMA.js`, 234.94 kB).
- `scripts/check-bundle.mjs` ×3: **PASS** (0 identificadores proibidos; sem chunk de jsPDF/fonte no bundle).
- `npm audit --omit=dev`: **0 vulnerabilidades**.
- **lint:** N/A — não há script `lint` nem config ESLint no repo (não é gate deste projeto).
- `scripts/gen-sample-pdfs.mjs`: **PASS** — 3 PDFs regenerados, header `%PDF-`, fontes SpaceGrotesk+GeistMono
  embutidas (sem fallback), verde-limão presente:
  - `scripts/out/bondly-proposta-client.pdf` (699.247 B)
  - `scripts/out/bondly-proposta-commercial.pdf` (712.332 B)
  - `scripts/out/bondly-proposta-internal.pdf` (722.777 B)

**ASSUMPTION:** input representativo de `gen-sample-pdfs.mjs` inalterado (tier Growth ~50k, prazo 24m, via Minu).
**ASSUMPTION/fallback:** se o embed de fonte falhar em runtime, há fallback marcado Helvetica/Courier (sem quebrar
a peça) — não acionado nos 3 PDFs gerados.
**Pendências:** comparação visual lado a lado com a referência do sponsor (olho humano) e marcação VERIFIED são do
Guardian/PRR, não deste autor.

---

## Revisão redesign do PDF (Quality & Security Guardian — revisão independente e adversarial)

> **Revisor:** product-quality-security (Guardian). **Data:** 2026-11-05. **Escopo:** reescrita integral de
> `apps/commercial-workspace/src/services/pdf.ts` para replicar a referência do sponsor (navy `#12215E`, verde-limão
> `#C2FF01`, Space Grotesk + Geist Mono embutidas via `@fontsource`/OFL), spec `docs/20`. **Mudanças NÃO commitadas.**
> **Autor:** subagente `71effad8b2b64469` (product-fullstack). **Regra §26:** só o Guardian move `FIXED → VERIFIED`.
> **Independência (§31):** NÃO confiei no resumo do autor — reexecutei testes, build, bundle gate, audit e extraí
> o texto real dos 3 PDFs com meu próprio grep adversarial. **AUTOR ≠ REVISOR (PL-025 §8.3):** satisfeito — o
> código foi escrito pelo fullstack e revisado por mim (Guardian), que não o escrevi.

### Veredito por item da spec/objetivo

| # | Item | Status | Evidência (reexecutada pelo Guardian) |
|---|------|:------:|---------------------------------------|
| 1 | **Confidencialidade por perfil (o mais importante)** | **VERIFIED** | `pdf.confidentiality.test.ts` passa; tipos `quoteTypes.ts` provam que `ClientQuote` **não tem** `composition/waterfall/setup/result`; extração REAL dos 3 PDFs (ToUnicode CMap) → client/commercial **0** termos de custo/COGS/margem/fee-Minu/"Platform Fee"/"Uso interno"; internal contém. |
| 2 | **Bundle de produção** | **VERIFIED** | `vite build` OK (1 chunk `index.js` 234.94 kB, gzip 71 kB). `check-bundle.mjs` = **0 proibidos**. Grep adversarial no `dist/`: **0** de `jspdf/addFileToVFS/addFont/SpaceGrotesk/GeistMono/SPACE_GROTESK/GEIST_MONO/generateQuotePdf/registerPdfFonts`. Nenhum base64 ≥200 chars; assinatura TTF `AAEAAA`/`R0RFR` = 0. Fontes+jsPDF DCE'd por `import.meta.env.DEV` literal em `PreviewModal.download`. |
| 3 | **Fontes / licença / pt-BR** | **VERIFIED** | `@fontsource/space-grotesk`, `@fontsource/geist-mono`, `wawoff2` = **devDependencies** (não entram em prod). OFL 1.1 atribuído em `src/assets/OFL.md` (ambas). Acentos renderizados no PDF real: `USUÁRIOS ç ã õ á`, `COMPOSIÇÃO`, `PREÇO`, `EMISSÃO`, `ALÇADA` — subset latin cobre pt-BR. |
| 4 | **Regressão (typecheck/suíte/build/audit)** | **VERIFIED (com nota)** | typecheck: 5/5 workspaces limpos. commercial-workspace: **139 testes passam (22 arquivos)** — bate com o autor. Com dist do engine buildado: auth-proxy **590** + engine **125** passam (total 854 verdes). `npm audit --omit=dev` = **0 vulnerabilidades (prod)**. 3 PDFs: header `%PDF-1.3`, **4 FontFile2 (TTF embutido)** em cada — fontes reais, não fallback Helvetica. |
| 5 | **Contrato inalterado** | **VERIFIED** | `generateQuotePdf(quote: QuoteViewPayload, meta)` consome o QuoteView projetado — **não** importa o Pricing Engine (`check-bundle` prova 0 `calculate/createProposalSnapshot/cogs/...`). Guards por **presença** (`if (commercial)` / `if (internal && result)`), não por flag de audience. |

### Findings

- **F-PDF-01 — Teste de confidencialidade NÃO foi afrouxado · Severidade: INFO · Status: VERIFIED.**
  `git diff pdf.confidentiality.test.ts`: as únicas mudanças trocam a string de conteúdo-positivo esperado
  ("Investimento mensal estimado" → "Resumo do investimento", redesign §4.2). Os laços negativos
  (`INTERNAL_TERMS`, `INTERNAL_PAYLOAD_KEYS`) estão **intactos** — o gate não foi relaxado. Conforme.

- **F-PDF-02 — Rótulo "Taxa de plataforma" (commercial) é legítimo, NÃO mascara vazamento · Severidade: INFO · Status: VERIFIED.**
  O valor em commercial vem de `CommercialQuote.composition.platformFee` — componente de **PREÇO** (parte da
  mensalidade que o cliente paga), de uma sub-estrutura da projeção comercial. O custo interno "Platform Fee"
  vive em `result.platformFee` (`PricingResult`), campo **ausente** de `CommercialQuote`. São campos de camadas
  de projeção diferentes. A relabel "Taxa de plataforma" (vs o termo-gate inglês "Platform Fee", exclusivo de
  internal) é correta: na extração real, "Platform Fee" aparece **só** no internal. Preço exibido = preço, não custo.

- **F-PDF-03 — `npm audit` completo: 6 vulns DEV-only (2 CRITICAL tinypool via vitest) · Severidade: LOW (prod) · Status: OPEN (ACCEPTED RISK candidato).**
  `tinypool` é transitiva do **vitest** (test runner) — **não shippada** (`--omit=dev` = 0). Pré-existente, **não
  introduzida pelo redesign**. **Não** é bloqueio de Quality Gate (não está no caminho de produção). Governança
  PL-025 §9.6 / **PQ-029** (gestão de vulnerabilidades): tratar no ciclo de deps (bump de vitest), fora desta review.

- **F-PDF-04 — Botão "externo" projeta view `commercial`, nunca `client` · Severidade: LOW · Status: ADDRESSED (decisão de produto confirmada; reverificação de QA pendente).**
  Decisão do sponsor: o PDF EXTERNO entregue ao cliente usa a view **`client`** (peça enxuta — SEM composição de
  preço, waterfall de descontos nem alçada). Aplicado em `PreviewModal.download('external')`:
  `projectQuotePreview('client', …)` (antes `'commercial'`). O PDF INTERNO (botão gated por audience interna /
  `proposal.see_internal`) permanece `internal`. Regra final: **externo ⇒ `client`; interno ⇒ `internal`**. A view
  `'commercial'` deixa de ser exercitada pela UI (segue coberta por `pdf.test.ts`). Confidencialidade intacta: nenhuma
  view de cliente carrega `result`/COGS/margem no payload (fronteira estrutural, F-PDF-02). Novo teste em `pdf.test.ts`
  trava que `client` é mais enxuta que `commercial` e que nenhuma expõe `result`. **product-fullstack não marca VERIFIED**
  — a reverificação é do Guardian.

### Análise de risco — matriz Minu (PL-025 §9.1.1)

| Projeto | Risco (nível) | Descrição do Risco | Impactos | Ações de Contorno |
|---------|---------------|--------------------|----------|-------------------|
| Bondly/PDF | **Baixo** (Impacto Alto × Prob. Muito Baixa) | Vazamento de custo/margem em peça externa via redesign | Exposição de COGS/margem/fee-Minu a cliente (LGPD/comercial) | Fronteira **estrutural** (campo ausente do payload) + gate `pdf.confidentiality.test.ts` + extração real 0-hits. Mitigado. |
| Bondly/PDF | **Baixo** (Impacto Médio × Prob. Muito Baixa) | Peso de fonte (~104KB) vaza ao bundle de prod | Regressão de performance/bundle | DEV-gate literal + `check-bundle.mjs` (0) + grep dist (0). Mitigado. |
| Bondly/PDF | **Baixo** (Impacto Baixo × Prob. Baixa) | CRITICAL tinypool (dev) escalar a prod | Nenhum no caminho de prod (devDep) | `--omit=dev`=0; acompanhar bump de vitest (PQ-029). |

### NÃO VERIFICADO (fora do alcance técnico desta review)

- **Fidelidade visual pixel-a-pixel** com a referência do sponsor (coordenadas/cores batem no código e nos streams,
  mas a conferência de olho humano lado-a-lado é do sponsor/PRR). O CMap ToUnicode decodifica limpo os textos mono
  em caixa-alta (eyebrows/kickers), mas os textos mixed-case em Space Grotesk têm cmap parcial — a legibilidade
  final renderizada deve ser confirmada abrindo os 3 PDFs num viewer.
- **ADR (PL-025 §9.1.1/§9.2.2):** a decisão de marca (verde-limão vs amber do DS, Space Grotesk+Geist Mono, navy da
  peça) está registrada em `docs/20 §6` como direção do sponsor, mas **não há ADR formal** na base de ADRs. Dependência
  a registrar pelo `product-fullstack`/`product-orchestrator` (não bloqueia este veredito de QA).

```
QUALITY STATUS
APPROVED WITH CONDITIONS

Findings:
  - F-PDF-01 (INFO/VERIFIED) teste de confidencialidade não afrouxado.
  - F-PDF-02 (INFO/VERIFIED) "Taxa de plataforma" = preço, não vazamento de custo.
  - F-PDF-03 (LOW-prod/OPEN) 2 CRITICAL tinypool são DEV-only (vitest), pré-existentes, não shippadas.
  - F-PDF-04 (LOW/ADDRESSED) botão externo agora usa view 'client' (externo⇒client, interno⇒internal); reverificação de QA pendente.

Evidence:
  - typecheck 5/5 OK; commercial-workspace 139 testes OK; engine 125 + auth-proxy 590 OK (dist buildado).
  - vite build OK (1 chunk 234.94kB); check-bundle 0 proibidos; grep dist 0 de jspdf/fonts/base64.
  - 3 PDFs %PDF-1.3, 4 FontFile2 embutidos; extração ToUnicode: client/commercial 0 termos sensíveis, internal contém.
  - @fontsource/* + wawoff2 = devDeps; OFL.md presente; acentos pt-BR renderizam; audit --omit=dev = 0.

Required Actions (condições para GO pleno):
  1. Conferência visual lado-a-lado dos 3 PDFs (sponsor/PRR) — único NÃO VERIFICADO relevante.
  2. [ADDRESSED] F-PDF-04 decidido: PDF do cliente final = 'client'. Aplicado; reverificação de QA pendente.

Recommended Actions:
  3. Registrar ADR da decisão de marca/tipografia (PL-025 §9.1.1).
  4. Planejar bump de vitest p/ zerar tinypool no caminho dev (PQ-029) — fora desta entrega.
  5. No CI, buildar dist do @bondly/pricing-engine ANTES dos testes do auth-proxy (o `npm run test` agregado falha
     11 arquivos por 'Failed to resolve entry @bondly/pricing-engine' — dist gitignorado, test-antes-de-build; NÃO é
     regressão do redesign).
```

**Pode o redesign do PDF ser VERIFIED?** Os dois eixos críticos do objetivo — **fronteira de confidencialidade por
perfil** (item 1) e **fontes fora do bundle de produção** (item 2) — estão **VERIFIED** por reexecução e extração
real, não por confiança no autor. O veredito global é **APPROVED WITH CONDITIONS**: a única pendência verdadeiramente
aberta é a conferência visual humana (fora do alcance automatizável); F-PDF-04 foi ADDRESSED (externo⇒`client`). Nenhum bloqueio
de Quality Gate (§23): sem vuln CRITICAL/HIGH no caminho de prod, sem teste falhando no escopo, build íntegro, sem
segredo exposto, sem falha de authorization, sem risco de corrupção de dados.

---

## Reverificação F-PDF-04 — Guardian (2026-11-05)

**Escopo:** revalidar POR EXECUÇÃO o fix do autor (subagente 09ffa28cad47fec3): botão de PDF externo passa a
projetar a view `client` (enxuta), não `commercial`; botão interno continua `internal`. Mudanças não commitadas.
Independência adversarial: nada aceito por auto-relato — tudo reexecutado/extraído. Toplevel confirmado
(`git rev-parse --show-toplevel` = bondly-commercial-platform, remotes origin=Bondly_Simulator, sim2).

**QUALITY STATUS: APPROVED WITH CONDITIONS** — F-PDF-04 pode ser **FECHADO (VERIFIED)**. Redesign do PDF: os dois
eixos de risco (fronteira de confidencialidade por perfil + fontes/engine fora do bundle de prod) seguem VERIFIED;
o redesign permanece **APPROVED WITH CONDITIONS** — única pendência verdadeiramente aberta é a conferência visual
humana (não automatizável), não um defeito.

### Findings
- **F-PDF-04 (LOW) OPEN → VERIFIED.** Regra confirmada por leitura E execução: externo⇒`client`, interno⇒`internal`.
  - `PreviewModal.tsx`: `download('external')` → `kind==='internal' ? 'internal' : 'client'` ⇒ externo projeta `client`;
    botão "Gerar PDF interno" gated por `{internal && ...}` (audience interna do `useAudience()`), chama `download('internal')`.
    Não há caminho em que usuário externo gere `commercial` ou `internal`.
  - **Dupla fronteira estrutural:** (1) `projectQuotePreview`/`projectQuote`: view `client` retorna só `{...base, view:'client', discounts:{tierRate,termRate}}`
    — SEM composition/waterfall/discountCorridor/setup-detalhado/engagement/policy/result; (2) renderizador `pdf.ts`:
    `commercial = view!=='client' ? quote : null` e `result = view==='internal' ? quote.result : null` ⇒ payload client
    não tem de onde renderizar seção interna. Docstring: nenhum parâmetro de audience força interno sobre payload externo.
- **F-PDF-NOTE (observação):** o binding UI `external⇒client` é coberto por INSPEÇÃO de código, não por teste automatizado
  (os testes exercitam `projectQuote(view)` diretamente, não o clique do botão). Recomendável um teste de componente
  do PreviewModal. Não bloqueia — a fronteira estrutural garante confidencialidade mesmo sem esse teste.
- **F-PDF-03 (dev-only, pré-existente):** `npm audit` completo = 6 vulns (2 critical tinypool/vitest, 1 high vite, 3 moderate)
  — TODAS na cadeia Vitest/Vite/esbuild (devDependencies, não shippadas). `npm audit --omit=dev = 0`. Não introduzidas
  pelo F-PDF-04. Gestão segue PQ-029 (bump de vitest fora desta entrega). Não bloqueia o Quality Gate.

### Evidence (reexecução real)
- **Build dist antes de tudo** (gotcha): `build @bondly/pricing-engine` OK, `build @bondly/auth-proxy` OK.
- **Typecheck 5/5 workspaces OK** (pricing-catalog, pricing-engine, pricing-types, auth-proxy, commercial-workspace).
- **Suíte completa 855/855 OK:** engine 125 (9 files) + commercial-workspace 140 (22 files) + auth-proxy 590 (18 files).
  Confere com o alegado pelo autor.
- **Testes de PDF isolados:** `pdf.test.ts` 4/4 + `pdf.confidentiality.test.ts` 3/3 = 7/7 OK. Novo teste F-PDF-04 trava
  `client.composition/waterfall/discountCorridor === undefined`, `commercial.*` definido, `client.result`/`commercial.result === undefined`.
  Loops `INTERNAL_TERMS` (6 regex) e `INTERNAL_PAYLOAD_KEYS` (9 chaves, inclui `"result"`) **intactos, não afrouxados**.
- **3 PDFs de amostra regenerados** (`scripts/out/`, via `projectQuote` de PRODUÇÃO do dist auth-proxy): %PDF- válido,
  client 699KB < commercial 712KB < internal 722KB.
- **Extração do texto REAL renderizado** (intercept `doc.text`, caminho de produção `projectQuote`):
  - `client`: keys sem composition/waterfall/discountCorridor/result; 0 chaves sensíveis no payload; 0 termos internos no texto.
  - `commercial`: tem composition/waterfall/discountCorridor; 0 chaves sensíveis; 0 termos internos no texto.
  - `internal`: payload com result/costs/technicalMargin/netMargin/minuConversionFee/premisesHash/tcvBondly/setupNet;
    texto com COGS/Custo variável/Margem técnica/Platform Fee/Fee Minu/Composição da mensalidade/USO INTERNO.
  ⇒ client = peça enxuta (sem composição de preço/alçada); client+commercial sem custo/margem/COGS/fee Minu; internal mantém breakdown.
- **3 builds OK** (engine tsc, auth-proxy tsc, commercial-workspace tsc+vite — 457 módulos, chunk 234.94KB).
- **Bundle gate:** `check-bundle.mjs` = "OK: 1 asset verificado, 0 identificador proibido".
- **`npm audit --omit=dev` = 0 vulnerabilidades** (prod-path limpo).

### NÃO VERIFICADO
- Conferência visual lado-a-lado dos 3 PDFs por humano (sponsor/PRR) — fora do alcance automatizável.
- Binding `external⇒client` no clique do botão não tem teste de componente (coberto por inspeção + fronteira estrutural).

### Required Actions
- Nenhuma de bloqueio. F-PDF-04 FECHADO (VERIFIED). Decisão de produto (cliente final = `client`) aplicada e reverificada.

### Recommended Actions
1. Adicionar teste de componente do `PreviewModal` cobrindo `external⇒client` e `internal⇒internal` (fecha F-PDF-NOTE).
2. Conferência visual humana dos 3 PDFs antes do GO pleno (Required já listado na seção anterior do docs/14).
3. Planejar bump de vitest p/ zerar tinypool/vite no caminho dev (PQ-029) — fora desta entrega.

**Governança Minu:** sem violação de PL-025 §9.2.1 (sem segredo no repo; bundle gate 0; audit prod 0). TDD/testes de
confidencialidade presentes e não afrouxados (§13). Autor≠revisor respeitado (autor = subagente 09ffa28cad47fec3;
revisão independente = Guardian). Vulns dev-only seguem PQ-029 (dependência, não bloqueio).
