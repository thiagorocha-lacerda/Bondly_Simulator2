# 24 — Production Readiness Review (parecer de go-live)

- Data: 2026-11-05. Autor: Product Orchestrator (consolidação). **Procedência:** este PRR **consolida** as verificações já executadas e registradas pelo Guardian (product-quality-security) ao longo do projeto — ver docs/14 (Revisões/Re-revisões 1–5, Validações G-002/G-025/v16/F-04, Reverificações). NÃO é uma nova execução de suíte: é o rollup de prontidão. Onde um item depende do ambiente do time (AWS real, GitHub Actions), está marcado **[EVIDÊNCIA DO SPONSOR/TIME]** ou **[NÃO VERIFICADO]**.
- Estado do código: publicado em `sim2/main` (Bondly_Simulator2) até o CI de segurança.

## 1. Eixos × prontidão

| Eixo | Status | Evidência |
|---|---|---|
| Empacotamento AWS (docs/13) | **PRONTO-COM-CONDIÇÃO** | Dockerfile Node 22, .env.example completo, fail-closed sem DATA_DIR (G-003/G-019 VERIFIED), runbook. **Condição:** docker build/run e comportamento atrás de ALB/CloudFront **[NÃO VERIFICADO]** — homologação do time. |
| Auth + RBAC 4 perfis (docs/10) | **PRONTO** | Google OAuth+PKCE, domínios autorizados, RBAC server-side deny-by-default, bootstrap admin, escopo por dono (G-002 VERIFIED), fluxo de perfil. Matriz 4×18 testada. |
| SLA 5 dias úteis + reunião + P75/P90 (docs/11) | **PRONTO** | Relógio derivado de eventos, reunião não pausa SLA, indicadores sobre tempo útil. VERIFIED. |
| Pricing/premissas v16 (docs/04/19) | **PRONTO** | Desconto por tier validado + Setup −20% governado; v15 congelada/snapshot imutável; paridade com legado. VERIFIED. |
| G-001 cálculo server-side | **PRONTO** | Motor/tabelas de custo FORA do bundle (gate CI, reintrodução real provou), server-only, PDF por perfil, E2E 27/27. VERIFIED. |
| G-026 gate de margem na emissão | **PRONTO** | Emitir+consolidar gated por emissionGate; sem bypass (adversarial). VERIFIED. |
| G-025 reabertura pós-emissão | **PRONTO** | Nova versão; emitida imutável; approver/admin + justificativa; auditoria. VERIFIED. |
| Confidencialidade por perfil | **PRONTO** | client/commercial sem custo/margem (projeção + PDF, texto real dos PDFs verificado); fronteira estrutural em 2 níveis. VERIFIED. |
| CI (ci.yml + security.yml) | **PRONTO-COM-CONDIÇÃO** | Conteúdo verificado por leitura: typecheck/testes/build/gate de bundle/audit prod + gitleaks(histórico)/Semgrep/audit. **3 jobs de segurança confirmados VERDES no GitHub Actions [EVIDÊNCIA DO SPONSOR].** Condição: manter verde a cada release. |
| Observabilidade/operação (docs/13) | **PRONTO-COM-CONDIÇÃO** | /healthz, logs JSON stdout, backup SQLite (VACUUM INTO), rollback documentados. **Condição:** exercitar backup/rollback reais em staging. |

## 2. Suíte (último estado verificado pelo Guardian; não re-executado neste rollup)
851–889 testes verdes conforme o eixo (engine ~125, UI ~148, auth-proxy ~616); typecheck 5/5; 3 builds; gate de bundle 0 proibidos; `npm audit --omit=dev` = 0; smokes quote/sla/e2e PASS. Fonte: docs/14.

## 3. Checklist de GO-LIVE (o time DEVE fazer antes de apontar clientes)
1. [ ] `docker build` da imagem + `docker run` com DATA_DIR em volume; `GET /healthz` 200 `repo:sqlite`.
2. [ ] Subir em **staging AWS** (instância ÚNICA — SQLite não é multi-writer, G-029) e rodar o smoke do docs/13 §9: `/healthz` 200, `GET /` sem sessão → 302 /login, `/api/me` → 401.
3. [ ] **OAuth Google real**: redirect_uri = PUBLIC_URL+/auth/callback idêntico ao Console; login com domínio autorizado; bootstrap admin via `BOOTSTRAP_ADMIN_EMAILS`.
4. [ ] Segredos via Secrets Manager/SSM: `SESSION_SECRET` forte (heurística G-030), `GOOGLE_CLIENT_SECRET`; confirmar que o boot recusa segredo fraco.
5. [ ] TLS terminado em ALB/CloudFront; `PUBLIC_URL` https; confirmar cookies Secure.
6. [ ] **Backup/rollback** do SQLite testado (VACUUM INTO + snapshot EBS); reimplantar versão anterior apontando ao mesmo volume.
7. [ ] CI verde no GitHub (ci.yml + security.yml) no commit a promover.
8. [ ] (Se publicar imagem em registry) habilitar o job trivy comentado em security.yml.

## 4. Riscos ACEITOS / condições abertas (com dono)
- **docker build/trivy não executados** aqui — dono: time (go-live checklist #1/#8).
- **ALB/CloudFront / X-Forwarded** não exercitados — dono: time (staging).
- **Multi-processo SQLite**: exige instância única; se precisar escalar horizontal, migrar `ProposalRepository` para Postgres (fora de escopo) — dono: arquitetura.
- **F-05** (CVEs dev-only vitest/vite/esbuild) — não shippadas; bump deliberado quando disponível (PQ-029) — dono: fullstack.
- **Reconciliação de marca** PDF (verde-limão) × app (amber) — ADR docs/21, decisão futura — dono: sponsor/project-book.
- **Custo de implantação por tier** ausente ⇒ margem do Setup não computável; o −20% é seguro nos guardrails existentes mas sem visibilidade de margem do Setup — dono: project-book (follow-up).
- **Migração de dados Render→AWS** (se houver propostas na Render) com backup/reconciliação — dono: time.
- **Validação visual do PDF**: APROVADA pelo sponsor (2026-11-05).

## 5. NÃO VERIFICADO
docker build/run; ALB/CloudFront; multi-processo SQLite; migração de dados real; execução real do smoke em AWS; o run do GitHub Actions foi confirmado pelo sponsor, não observado pelo autor deste rollup.

## 6. VEREDITO FINAL: **GO-COM-CONDIÇÕES**
A engenharia e a segurança do produto estão **aceitas**: todos os findings de produto/segurança do Guardian (G-001..G-035, F-PDF-04, F-04) estão corrigidos e VERIFIED; nenhum CRITICAL/HIGH em aberto no comportamento do sistema. O go-live para **clientes externos** fica condicionado ao **checklist §3** (itens 1–7 obrigatórios), que só pode ser executado no ambiente AWS do time. Condições numeradas:
1. docker build + smoke em staging AWS (checklist §3.1–§3.2).
2. OAuth real + segredos + TLS (§3.3–§3.5).
3. Backup/rollback testado + instância única confirmada (§3.6, §3.2).
4. CI verde no commit promovido (§3.7).
Cumpridos 1–4, o parecer passa a **GO**.
