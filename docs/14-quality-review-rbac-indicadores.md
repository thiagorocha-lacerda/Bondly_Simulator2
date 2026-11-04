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
