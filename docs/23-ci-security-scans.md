# 23 — Scans de segurança no CI (gitleaks / SAST / dependências)

- Data: 2026-11-05. Fecha os findings de processo: **F-05** (dependency scan) e as Recommended Actions do Guardian (secret scan de histórico + SAST). Pré-requisito do Production Readiness Review (docs/18).
- Arquivo: `.github/workflows/security.yml` (novo), complementar a `.github/workflows/ci.yml` (typecheck/testes/build/gate de bundle/audit de produção).

## O que roda
| Job | Ferramenta | Gatilho | Política |
|---|---|---|---|
| secret-scan | gitleaks (OSS) | push/PR em main + cron semanal | **Bloqueante**: falha se achar segredo. Checkout com `fetch-depth: 0` (varre TODO o histórico — atende a lição "secret scan do histórico"). |
| sast | Semgrep (`--config=auto` + p/typescript + p/react + p/nodejs) | push/PR + cron | **Bloqueante** (`--error`) em findings de segurança. |
| dependencies — prod | `npm audit --omit=dev --audit-level=high` | push/PR + cron | **Bloqueante**: 0 em high+ no caminho shippado (espelha o gate que já existe em ci.yml). |
| dependencies — completo | `npm audit` (dev incluso) | push/PR + cron | **Informativo** (`continue-on-error`): F-05 são vulns dev-only da cadeia Vitest/Vite/esbuild/tinypool, NÃO shippadas — reportadas para gestão, não reprovam a pipeline. |

## F-05 — decisão de política (não bloqueia o merge)
As 6 vulnerabilidades do `npm audit` completo (2 critical, 1 high, 3 moderate) estão TODAS em devDependencies de teste/build (vitest, vite, esbuild, tinypool, vite-node, @vitest/mocker). `--omit=dev` = 0 → nada chega ao runtime de produção. Verificado por Guardian em múltiplas rodadas (PQ-029). Remediação quando houver bump deliberado da cadeia Vitest/Vite: aplicar o major bump, **re-rodar a suíte completa** e confirmar typecheck/build/testes — NUNCA `npm audit fix --force` cego numa dep de tooling (lição retida).

## trivy (scan de imagem) — CONDICIONAL, ainda NÃO ativo
O deploy atual é manual (docs/13) e não há imagem de container publicada em registry. O job `container-scan` (trivy, falha em HIGH/CRITICAL) está documentado como bloco comentado em `security.yml`; habilitar quando o time publicar a imagem (build do Dockerfile + push para ECR/GHCR).

## NÃO VERIFICADO (honesto)
- **O workflow não foi observado rodando verde no GitHub Actions** — foi escrito e revisado localmente; o CI executa no GitHub, não neste host. O passo de confirmar o run verde (e ajustar versões de Action/permissões se o GitHub reclamar) é do time, no primeiro push que dispare o workflow. Guardian/PRR devem exigir um run verde real antes do go-live.
- Possíveis ajustes no primeiro run: o Semgrep em `container:` pode exigir `GITHUB_TOKEN`/rede; o gitleaks-action OSS pode pedir configuração de licença para features extras (o modo OSS básico roda sem). Tratar como afinação esperada de primeira execução, não como defeito de design.
