# Documentação — Bondly Commercial Platform

Índice da documentação obrigatória (prompt §23) e operacional (§27).

| Doc | Conteúdo | §23 |
|---|---|---|
| [01 — Auditoria do HTML original](./01-auditoria-html-original.md) | Regras extraídas, matriz de rastreabilidade, divergências | 23.5 (parcial), Relatório §24.7 |
| [02 — Execução e deploy](./02-execucao-e-deploy.md) | Comandos, config Render, rollback, limitações | 23.14, 23.15 |
| [03 — Contratos de dados](./03-contratos-de-dados.md) | `PricingInput`/`PricingResult` e auxiliares | 23.4 |
| [04 — Regras financeiras e premissas](./04-regras-financeiras-e-premissas.md) | Premissas v15, regras §7, precisão, versionamento | 23.5, 23.6 |
| [05 — Módulos, validação e fluxos](./05-modulos-validacao-fluxos.md) | Catálogo, dependências, maturidade, validação técnica, jornada | 23.7, 23.8, 23.9 |
| [06 — Design System, PDF e persistência](./06-design-system-pdf-persistencia.md) | Tokens/temas/AA, gerador de PDF, Cenário A/B | 23.10, 23.11, 23.12 |
| [07 — Checklist de homologação](./07-checklist-homologacao.md) | Testes na URL de produção | §27.8 |
| [08 — Arquitetura e roadmap](./08-arquitetura-e-roadmap.md) | Arquitetura geral/motor/workspace, evolução | 23.1, 23.2, 23.3, 23.16 |
| [09 — Autenticação e segurança](./09-autenticacao-e-seguranca.md) | Google OAuth/PKCE, domínio, sessão, 2º fator, segurança | operacional |
| [10 — RBAC, esteira e persistência](./10-rbac-esteira-persistencia.md) | Perfis, esteira Negócios→P&T, persistência | operacional |
| [11 — SLA técnico](./11-sla-tecnico.md) | SLA de 5 dias úteis e reunião técnica | operacional |
| [12 — Auditoria de completude e deploy AWS](./12-auditoria-completude-deploy-aws.md) | Checklist de lacunas, evidências, env vars | operacional |
| [13 — Deploy manual na AWS](./13-deploy-aws-manual.md) | Runbook: build, env, TLS, persistência SQLite, smoke, rollback, backup | operacional |
| [20 — Spec visual do PDF](./20-spec-visual-pdf.md) | Layout/paleta/tipografia da peça comercial; §5 divergência DS×referência | design |
| [21 — ADR: identidade visual do PDF](./21-adr-identidade-visual-pdf.md) | Decisão do sponsor: PDF verde-limão + Space Grotesk/Geist Mono diverge do app (amber) | decisão/marca |

Documentação de testes (23.13) em `packages/pricing-engine/README.md`.

## Mapa §23 → entregue

1. Arquitetura geral — doc 08 ✅
2. Arquitetura do Pricing Engine — doc 08 + engine README ✅
3. Arquitetura do Commercial Workspace — doc 08 ✅
4. Contratos de dados — doc 03 ✅
5. Regras financeiras — doc 04 + doc 01 ✅
6. Premissas — doc 04 ✅
7. Matriz de dependências — doc 05 ✅
8. Regras de validação técnica — doc 05 ✅
9. Fluxos comerciais — doc 05 ✅
10. Design System — doc 06 ✅
11. Geração de PDF — doc 06 ✅
12. Persistência — doc 06 ✅
13. Testes — engine README ✅
14. Instruções de execução — doc 02 ✅
15. Limitações — doc 02 + doc 06 ✅
16. Roadmap de evolução — doc 08 ✅

> **`render.preview.yaml`**: arquivo SOMENTE da Render (Static Site com senha cosmética, `VITE_PREVIEW_PASSWORD` vai no bundle). **NÃO usar na AWS.** Para a AWS, ver doc 13.
