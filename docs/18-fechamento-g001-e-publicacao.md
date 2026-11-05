# 18 — Fechamento do ciclo G-001 e instruções de publicação

- Data: 2026-11-05. Decisão do sponsor (CTO): **fechar este ciclo com o G-001 VERIFIED; Fase 4 (PDF por perfil + E2E) e G-026 (gate de margem na emissão) viram o próximo projeto.**
- Nada foi commitado, pushado ou implantado por este trabalho. O commit e o `git push sim2 main` são ação do usuário (ver §5).
- Supersede o status do G-001 descrito no `docs/17` (que o marcava como follow-up; agora está CONCLUÍDO). As demais seções do `docs/17` seguem válidas.

## 1. Estado consolidado (verificado por execução)
- **Empacotamento AWS:** PRONTO. Dockerfile Node 22, `.env.example` completo, runbook `docs/13`. `docker build`/`trivy` e comportamento atrás de ALB/CloudFront NÃO verificados aqui (sem Docker/AWS) — homologação do time.
- **RBAC 4 perfis + indicadores P75/P90 + esteira/Gestor-Aprovador + escopo por dono:** VERIFIED pelo Guardian (G-002, G-013..G-030).
- **G-001 (cálculo no servidor, alternativa A): VERIFIED pelo Guardian (Re-revisão 5).** Motor e tabelas de custo/margem FORA do bundle (0 chunks do engine; identificadores sensíveis = 0, exceto `platformFeeTable` como property-key do perfil internal); cálculo SERVER-ONLY em produção (engine no cliente só sob `import.meta.env.DEV`, eliminado por DCE; `POST /api/pricing/quote` sem sessão = 401); gate de bundle no CI (`scripts/check-bundle.mjs` + passo no `ci.yml`) provado SÓLIDO por reintrodução real do engine.
- **G-031 (append-only em approval_decisions/sla_events) e G-032 (heurística de segredo aceita hex forte):** VERIFIED.
- **smoke-sla:** PASS 13/13 (conserto de script stale, sem mudança de produção).
- **Suíte:** 837 testes (engine 109, commercial-workspace 138, auth-proxy 590), typecheck e 3 builds OK, `npm audit --omit=dev` = 0.

## 2. Classe de risco do G-001 — ELIMINADA
O risco que originou o eixo (custo/margem deriváveis do bundle) está eliminado na implementação e verificado adversarialmente. O gate do CI impede regressão futura.

## 3. QUALITY STATUS: APPROVED WITH CONDITIONS
O G-001 está VERIFIED no seu escopo. NÃO liberar para produção com clientes antes de:
- **Fase 4:** geração de PDF por perfil (cliente sem custo/margem) + teste E2E da jornada cotação→proposta→emissão.
- **G-026:** ligar o alerta de margem no fio da emissão (hoje o gate existe no servidor mas `emitir` não o consulta) — ou ACCEPTED RISK assinado pelo sponsor com prazo.
- CI: secret-scan (gitleaks), SAST (Semgrep/CodeQL), container scan (trivy).
- Production Readiness Review após Fase 4 + G-026.

## 4. Follow-ups rastreáveis (próximo projeto)
1. Fase 4 (PDF por perfil + E2E).
2. G-026 (gate de margem na emissão) — decisão de produto.
3. G-025 (política de revisão pós-emissão) — decisão de produto.
4. G-002/G-004/G-005/G-006 (findings de produto OPEN de rodadas anteriores).
5. G-034 (renomear o campo `platformFeeTable` para endurecer o gate do CI) e G-035 (LOW).
6. Homologação AWS: docker build/trivy, OAuth real, provas HTTP autenticadas, multi-processo SQLite.
7. Do brief original, ainda fora do ciclo: política comercial de tiers + novos valores de Setup fixo (aprovação comercial); estados de SLA "ampliados" (falta a lista-alvo).
8. **Setup fixo −20% (DECISION sponsor/CTO 2026-11-05): APLICADA na v16** como default governado validado (`setupFixedReductionDefault = 0,20`); valores-base dos tiers inalterados e rastreáveis. Docs/04 e docs/19 atualizados; F-01 ADDRESSED em docs/14. **Follow-up aberto (dono: project-book):** cadastrar o **custo real de implantação por tier** (equipe de onboarding/horas internas/infra de setup) + estender o motor com **guardrail de margem do próprio Setup** (`setupMargin = (setupNet − custoImplantação)/setupNet`). Hoje o motor **não calcula margem do Setup** — por isso a segurança do corte foi medida (docs/19) apenas contra os guardrails existentes (`marginStatus`/`SETUP_HOUR_BELOW_MIN_MARGIN`), não contra uma margem do Setup. Classe: mudança de escopo (premissas + motor + UI), encaminhar Data → Orchestrator → project-book.

## 5. Publicação em Bondly_Simulator2 (ação do usuário)
As mudanças deste ciclo (G-001 + G-031 + G-032 + smoke) estão na working tree, NÃO commitadas. O que está hoje no remoto é o commit `0f987bd`, ANTERIOR à remoção do motor do bundle — esta publicação é o que leva o G-001 fechado para lá.
- Remote correto: **`sim2`** (o `origin` do repo do Bondly aponta para `Bondly_Simulator`, sem o 2).
- Rodar SEMPRE de dentro de `bondly-commercial-platform` (NUNCA do workspace pai, que é outro projeto — lição do push anterior).
- O push é aditivo (fast-forward sobre `0f987bd`); não apaga histórico; sem `--force`.

Sequência (o usuário executa no próprio terminal):
```bash
cd /Users/mac/.kiro/crew/workspace/bondly-commercial-platform
git rev-parse --show-toplevel          # confirmar: .../bondly-commercial-platform (NÃO o workspace pai)
git rev-parse --abbrev-ref HEAD        # confirmar: main
git remote -v                          # confirmar sim2 -> Bondly_Simulator2
git status --short                      # revisar os arquivos do ciclo
git add -A
git commit -m "feat(g-001): calculo de preco/margem server-side; engine fora do bundle + gate CI; G-031/G-032"
git push sim2 main
```
Antes de commitar, nenhum segredo entra: `.gitignore` cobre `.env`/`*.db`; o `.env.example` só tem placeholders.
