# 17 — Fechamento de escopo e follow-ups

- Data: 2026-11-04. Decisão do sponsor (CTO): **fechar o escopo atual; migração do frontend do G-001 (fases 3-4) vira follow-up rastreável.**
- Nada foi commitado, pushado ou implantado na AWS por este trabalho. O commit e o `git push sim2 main` são ação do usuário.

## 1. Objetivo atendido
Repositório `bondly-commercial-platform` completo e buildável para o time do sponsor subir manualmente na AWS, e pronto para publicação em `Bondly_Simulator2` (remote `sim2`). Sobre a base, foram adicionados RBAC de 4 perfis, indicadores de SLA P75/P90 e o backend do cálculo server-side.

## 2. Estado por eixo

### Empacotamento AWS — PRONTO (docker build NÃO VERIFICADO)
Dockerfile multi-stage Node 22, `.dockerignore`, `.nvmrc`, `.env.example` completo, `.gitignore` endurecido, runbook `docs/13`. Build dos 3 workspaces e testes verificados por execução. Persistência: SQLite exige volume + instância única; sem `DATA_DIR` em produção o servidor **falha fechado** (G-003). `docker build`/`trivy` e o comportamento atrás de ALB/CloudFront **não foram verificados aqui** (sem Docker/sem AWS) — ficam para a homologação do time.

### RBAC 4 perfis + indicadores + esteira/aprovador — VERIFIED pelo Guardian
`business`/`tech`/`approver`/`admin`; atribuição individual por e-mail (tabela gerida por admin + bootstrap); escopo por dono (G-002); Gestor/Aprovador funcional (solicitações, estado `aguardando_aprovacao_gestor` sem pausar SLA, fila e tela); P75/P90 sobre tempo útil. Findings G-002, G-013..G-022 VERIFIED; G-023/G-024 corrigidos e re-verificados; LOWs G-027..G-030 corrigidos. Suíte: 753 testes passando (engine 109, UI 60, auth-proxy 584), typecheck e 3 builds OK (último estado verificado por execução).

### G-001 (cálculo no servidor, alternativa A) — BACKEND PRONTO, FRONTEND PENDENTE (follow-up)
Fases 0-2 feitas e provadas por teste: endpoint `POST /api/pricing/quote` + `GET /api/pricing/catalog` (RBAC `pricing.quote`, no-store, validação estrita, guard de dono), projeção por perfil com invariante de confidencialidade testado, paridade bit-a-bit com o engine, e gate de emissão G-026 (emitir exige exceção comercial aprovada quando `marginStatus=REPRECIFICAR`). **O frontend ainda importa o engine local, então o motor e as tabelas de custo/margem continuam no bundle comercial** — o risco original do G-001 **permanece** até a Fase 3.

## 3. Riscos conhecidos / ACCEPTED RISK no fechamento
- **G-001 residual (HIGH):** custo/margem derivável a partir do bundle por qualquer usuário autenticado até a Fase 3. **Mitigação parcial aplicada:** sourcemaps desligados; bundle servido só a usuário com perfil. **Aceito como risco até o follow-up** — NÃO liberar para clientes externos sem concluir a Fase 3.
- **G-026:** o gate de emissão server-side existe, mas enquanto o frontend calcular localmente a alçada visível ao usuário é cosmética; o bloqueio real está no servidor.
- **G-025:** proposta `emitido` é imutável (409); **não há fluxo de reabertura/nova versão** — decisão de produto pendente (ver §4).
- Itens só cobertos por teste unitário / não exercitados por HTTP real: 413/415/cross-site/gate do SPA, OAuth real, multi-processo no SQLite, migração sobre banco legado completo, SAST/secret-scan de histórico.

## 4. Follow-ups rastreáveis (ordenados)
1. **G-001 Fase 3 — migrar o frontend** para consumir `/api/pricing/quote` (reescrever `usePricing`, `ResultsDashboard`, painéis, validações que usam tabelas) e PDF a partir do QuoteView projetado. Fase 4: remover o engine/tabelas do bundle comercial + teste de bundle no CI (0 ocorrências de custo/margem). Só então o G-001 fecha (Guardian verifica por busca no `dist`).
2. **G-025 — política de revisão pós-emissão** (decisão do sponsor): manter imutável ou criar reabertura com nova versão.
3. **Homologação na AWS:** `docker build` + `trivy image`, smoke `docs/13 §9`, OAuth real, prova HTTP autenticada dos gates, teste multi-processo do SQLite (ou migração para Postgres se multi-instância for necessária).
4. **CI:** adicionar SAST (Semgrep/CodeQL), secret-scan (gitleaks no histórico) e container scan.
5. **UI:** textos de erro para `approval_pending`, `approval_stale`, `proposal_issued_immutable`, `storage_busy`; seletor de `reasonCode` já entregue.
6. **Brief ainda não endereçado** (fora deste ciclo): política comercial final de tiers e novos valores de Setup fixo (pendente de aprovação comercial); estados de SLA "ampliados" do brief §10 (precisam da lista-alvo para diff).

## 5. Publicação em Bondly_Simulator2 (ação do usuário)
- Remote correto: **`sim2`** (o `origin` aponta para `Bondly_Simulator`, sem o 2).
- `main` local está à frente de `sim2/main` (fast-forward; não apaga histórico).
- Antes de commitar: `git rev-parse --abbrev-ref HEAD` deve mostrar `main`.
- Sequência sugerida (o usuário executa no próprio terminal):
  1. `git status` (revisar os arquivos alterados desta fase)
  2. `git add -A && git commit -m "feat: RBAC 4 perfis, SLA P75/P90, aprovador, hardening e backend de cotação server-side"`
  3. `git push sim2 main`
- A limpeza/substituição destrutiva do conteúdo antigo do Simulator2 **não é necessária**: o push é fast-forward aditivo. Se o time quiser remover arquivos antigos, fazer por commit versionado, nunca `push --force`.
