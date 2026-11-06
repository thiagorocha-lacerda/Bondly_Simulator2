# Livro de Projeto — Bondly Commercial Platform

> **Nota de procedência (leia primeiro).** Este Livro é uma **consolidação fiel** dos documentos
> técnicos `docs/01` a `docs/24`, do `README.md` raiz e do `packages/pricing-engine/README.md` deste
> repositório, mais o código-fonte que eles descrevem. **Não é um documento-fonte novo** nem adiciona
> requisitos, regras, valores, APIs, SLAs ou termos comerciais que a fonte não suporte. Toda adição de
> leitura (recomendação, inferência) está **rotulada** como tal. Onde há decisão do sponsor, o ADR de
> origem é citado. **O estado de prontidão deste produto é o do Production Readiness Review
> (`docs/24`): veredito GO-COM-CONDIÇÕES** — a engenharia e a segurança do produto estão aceitas e
> VERIFIED pelo Guardian; o go-live para clientes externos está **condicionado** ao checklist §3 do
> PRR, executável apenas no ambiente AWS do time. Neste Livro, "implementado/VERIFIED" **não** equivale
> a "em produção": cada capítulo responde "o que é e como isto vai/foi a produção", usando o produto
> construído como **prova/âncora** da experiência-alvo, não como o objeto descrito.
>
> **Taxonomia de governança** preservada da fonte: **REQUIREMENT** (exigência), **ASSUMPTION**
> (premissa reversível, não aprovada como requisito), **DECISION** (decisão do sponsor/CTO, com ADR),
> **CONFLICT** (tensão/lacuna registrada). **Estado de prontidão** por item: **PRONTO** ·
> **PRONTO-COM-CONDIÇÃO** · **NÃO-VERIFICADO**, alinhado ao `docs/24`.
>
> Autor da consolidação: agente project-book. Data: 2026-11-06. Sem commit/push/AWS.

---

## Índice

1. [Resumo Executivo + Estado de Prontidão](#1-resumo-executivo--estado-de-prontidão)
2. [Problema, Contexto e Objetivo do Produto](#2-problema-contexto-e-objetivo-do-produto)
3. [Visão da Solução e Jornada Comercial](#3-visão-da-solução-e-jornada-comercial)
4. [Arquitetura-Alvo de Solução](#4-arquitetura-alvo-de-solução)
5. [Modelo de Negócio e Precificação (premissas v16)](#5-modelo-de-negócio-e-precificação-premissas-v16)
6. [Dados e Contratos](#6-dados-e-contratos)
7. [Segurança, RBAC, Confidencialidade e LGPD](#7-segurança-rbac-confidencialidade-e-lgpd)
8. [SLA Técnico e Indicadores](#8-sla-técnico-e-indicadores)
9. [Operação, Deploy e Observabilidade](#9-operação-deploy-e-observabilidade)
10. [Governança, Decisões (ADRs) e Qualidade](#10-governança-decisões-adrs-e-qualidade)
11. [Roadmap e Follow-ups](#11-roadmap-e-follow-ups)
12. [Riscos e Go-Live](#12-riscos-e-go-live)
13. [Matriz de Rastreabilidade](#13-matriz-de-rastreabilidade-objetivo--capítulo--doc-fonte)
14. [Lacunas e Drift de Documentação](#14-lacunas-e-drift-de-documentação)
15. [Apêndices (Glossário, ADRs, Requisitos)](#15-apêndices)

---

## 1. Resumo Executivo + Estado de Prontidão

A solução deve ser compreendida como a **plataforma comercial Bondly 2027**: um **Pricing Engine
independente** (motor financeiro TypeScript puro, fonte única de verdade das regras comerciais) mais um
**Commercial Workspace** (a interface da jornada comercial) e um **auth-proxy** (borda Node que
autentica, autoriza e serve o SPA). O produto nasce da reconstrução, do zero, do simulador legado
`Bondly_2027_Simulador_Comercial_V1.0.html` — ~1.400 linhas com motor financeiro embutido em JS, sem
separação motor/UI (`docs/01`). A proposta central é **separar a regra financeira da apresentação** e
levar o cálculo de preço/margem ao servidor, fechando a classe de risco de confidencialidade do modelo
de custo (ADR G-001, `docs/15`).

| Dimensão | Síntese executiva | Estado de prontidão |
|---|---|---|
| Motor de precificação | Regras do legado reproduzidas bit-a-bit; premissas governadas e versionadas (v15 congelada → v16 vigente) | PRONTO (VERIFIED, `docs/24`) |
| Cálculo server-side (G-001) | Motor e tabelas de custo fora do bundle; cotação por perfil em `POST /api/pricing/quote` | PRONTO (VERIFIED, `docs/18`) |
| Autenticação + RBAC 4 perfis | Google OAuth+PKCE, autorização por domínio, RBAC server-side deny-by-default, escopo por dono | PRONTO (VERIFIED, `docs/24`) |
| SLA 5 dias úteis + indicadores P75/P90 | Relógio derivado de eventos; reunião não pausa SLA | PRONTO (VERIFIED, `docs/24`) |
| Empacotamento AWS + observabilidade | Dockerfile, fail-closed, runbook, /healthz, backup/rollback documentados | PRONTO-COM-CONDIÇÃO (homologação do time, `docs/13`/`docs/24`) |
| CI de segurança (gitleaks/Semgrep/audit) | Workflows escritos e revisados; run verde confirmado pelo sponsor | PRONTO-COM-CONDIÇÃO (manter verde a cada release, `docs/23`/`docs/24`) |
| Margem do Setup por tier | Custo de implantação por tier não cadastrado | CONFLICT / follow-up aberto (`docs/19`) |

**Objetivos estratégicos (REQUIREMENT, derivados do prompt original citado em `docs/01`/`docs/08`):**

| Objetivo | Descrição | Indicador executivo |
|---|---|---|
| Fonte única de verdade | Toda regra financeira em um único motor, sem fórmula duplicada na UI | Paridade engine = dashboard = PDF provada por teste |
| Confidencialidade de custo/margem | Custo/margem nunca trafegam para perfis sem `see_internal` | Gate de bundle no CI = 0 identificadores proibidos |
| Jornada comercial governada | Esteira Negócios→P&T→aprovação→emissão→reabertura auditável | Transições + auditoria append-only |
| Reprodutibilidade financeira | Proposta emitida reproduz seus valores originais | Snapshot imutável + `premisesHash` |

**Decisões executivas recomendadas:** (1) executar o **checklist de go-live do PRR §3** no ambiente
AWS antes de apontar clientes externos; (2) cadastrar o **custo de implantação por tier** para habilitar
guardrail de margem do Setup (follow-up aberto, `docs/19`); (3) decidir a **reconciliação de marca**
PDF (verde-limão) × app (amber) (ADR `docs/21`).

### Síntese Executiva
O produto está **aceito em engenharia e segurança** e **condicionado em operação**. O valor gerado para
o negócio é uma máquina de propostas comerciais com regra financeira única, confidencialidade estrutural
e trilha de auditoria; o valor para o cliente é a peça comercial profissional (PDF) derivada do mesmo
cálculo. A principal dependência de go-live é **o ambiente AWS do time** (PRR §3). O risco residual
mensurável é a ausência de **margem do Setup por tier** — segura nos guardrails atuais, mas não medível
em percentual até o custo de implantação ser cadastrado.

---

## 2. Problema, Contexto e Objetivo do Produto

**Contexto (fonte: `docs/01`).** O simulador legado era um único HTML com todo o motor financeiro
embutido em JavaScript (`calc()`, `campaign()`, `svCalc()`, `complexity()`, `b2cRun()`), acoplado ao
DOM, com premissas espalhadas em `const C`, sem versionamento financeiro, sem fluxo de PDF nem
identificador único de proposta, e sem qualquer controle de acesso. Qualquer pessoa com o arquivo tinha
as fórmulas, os custos e as margens.

| Problema | Efeito no cliente/usuário | Efeito no negócio | Resposta da solução |
|---|---|---|---|
| Motor acoplado ao DOM (D-A2) | Impossível reusar o cálculo fora da tela | Regra duplicada, divergência de números | Motor TS puro, determinístico (Cap. 4) |
| Premissas sem governança (D-A1) | — | Alterar premissa mudava propostas antigas | Premissas versionadas + snapshot imutável (Cap. 5/6) |
| Custo/margem no cliente | — | Exposição de margem a qualquer um com o arquivo | Cálculo server-side por perfil (G-001, Cap. 4/7) |
| Sem fluxo de PDF/identificador (D-F1) | Peça comercial inconsistente | Sem rastreabilidade de proposta | Fluxo PRÉ-VISUALIZAR→CONFIRMAR→PDF + `BONDLY-2027-NNNNNN` (Cap. 3) |
| Módulos só como número (D-M1) | Sem catálogo nominal | Complexidade comercial pouco legível | Catálogo dos 5 módulos + dependências/maturidade (Cap. 3) |

**Objetivo do produto (REQUIREMENT).** Entregar a plataforma comercial que **reproduz fielmente** a
lógica financeira do legado (paridade provada por teste), corrige as divergências acima de forma
justificada (D-F1/D-M1/D-A1/D-A2/D-P1, `docs/01 §4.4`) e habilita operação governada (autenticação,
RBAC, esteira, auditoria) para produção.

### Síntese Executiva
O problema central não era "fazer um simulador" — ele já existia — e sim **transformar um artefato
monolítico e inseguro em uma plataforma com fonte única de verdade, confidencialidade e governança**.
A régua de fidelidade é o teste de paridade contra a reimplementação do `calc()` legado; a régua de
avanço são as correções justificadas das 5 divergências catalogadas.

---

## 3. Visão da Solução e Jornada Comercial

**Visão (fonte: `docs/05`, `docs/08`, `README`).** Duas camadas obrigatoriamente separadas (regra de
ouro §2): o **Pricing Engine** detém toda a regra financeira; o **Commercial Workspace** consome
resultados e **não reproduz fórmulas**. Sobre essa base, a Fase 3 adicionou **autenticação + RBAC +
esteira + persistência** e a iniciativa G-001 moveu o **cálculo para o servidor**.

**Jornada comercial implementada (UC, fonte: `docs/05 §11`):**

| ID | Caso de uso | Descrição | Atores |
|---|---|---|---|
| UC-001 | Identificação | Cliente/oportunidade no Modo rápido | business |
| UC-002 | Seleção de produtos | Escolha nominal dos 5 módulos | business |
| UC-003 | Configuração | Volumes, implementação, negociação (Modo avançado) | business |
| UC-004 | Integrações/Serviços | Recursos dedicados, horas, campanha, B2C | business |
| UC-005 | Resultados | Dashboard por perfil, margem, alçada, ARKA | business/tech |
| UC-006 | Revisão | Pré-visualização da proposta | business |
| UC-007 | Emissão | Confirmar → gerar PDF `BONDLY-2027-NNNNNN` | business |
| UC-008 | Esteira técnica | Negócios→P&T: análise, parecer, SLA | tech |
| UC-009 | Aprovação de exceção | Gestor decide exceção comercial/escopo/replanejamento | approver |
| UC-010 | Reabertura pós-emissão | Nova versão a partir de proposta emitida (G-025) | approver/admin |

**Esteira Negócios→P&T→aprovação→emissão→reabertura (REQUIREMENT, `docs/10 §1.5`/§9/§11):**
máquina de estados server-side `rascunho_comercial → aguardando_analise_tecnica → em_analise_tecnica →
ajustes_solicitados | aprovado_tecnicamente | reprovado → pronto_para_emissao → emitido`, com o
sub-estado `aguardando_aprovacao_gestor` (não pausa o SLA) e a reabertura que cria **nova versão** a
partir de `emitido` (G-025). Cada transição valida papel + estado no servidor e grava auditoria
append-only; mudança material invalida aprovações afetadas (G-023).

### Síntese Executiva
A experiência-alvo é uma jornada única do rascunho comercial à peça emitida, com P&T e o Gestor como
estágios governados. O protótipo prova a jornada ponta a ponta (smoke E2E 27/27, `docs/15`); em
produção, a mesma esteira roda no auth-proxy com persistência durável e auditoria imutável.

---

## 4. Arquitetura-Alvo de Solução

**Arquitetura conceitual (fonte: `docs/08`, `docs/09`, `docs/15`).** Monorepo npm workspaces, com a
borda Node servindo o SPA atrás de um gate de sessão:

```
Navegador ──HTTPS──> [ @bondly/auth-proxy (Web Service Node) ]
                       │  público:  /login /healthz /auth/login /auth/callback
                       │  gate:     qualquer outra rota exige sessão válida (senão 302 /login | 401 /api/*)
                       │  /api/pricing/quote  → chama o Pricing Engine e projeta por perfil
                       └─ com sessão + perfil ──> serve commercial-workspace/dist (SPA)
```

| Componente | Responsabilidade | Dados | Observabilidade |
|---|---|---|---|
| `@bondly/pricing-engine` | Toda a regra financeira; funções puras determinísticas; premissas versionadas; snapshot | `PricingInput`→`PricingResult` | testes de paridade/unidade/módulos |
| `@bondly/commercial-workspace` | UI React+Vite; jornada; dashboard por perfil; PDF (jsPDF) | consome `QuoteView` do servidor | — |
| `@bondly/auth-proxy` | Auth OAuth+PKCE; RBAC server-side; esteira; persistência SQLite; cotação por perfil | SQLite em `DATA_DIR` | /healthz, logs JSON stdout |

**Decisão arquitetural central — cálculo server-side (DECISION, ADR G-001, `docs/15`).** O bundle
deixou de conter o motor e as tabelas de custo/margem; `POST /api/pricing/quote` chama `calculate()` (a
mesma fonte única, nunca recalcula) e devolve uma **projeção por perfil** (`quote.v1`). Verificação
adversarial: reintrodução real do motor no bundle quebra o gate de CI (`scripts/check-bundle.mjs`);
cálculo é SERVER-ONLY em produção (engine no cliente só sob `import.meta.env.DEV`, eliminado por DCE);
`POST /api/pricing/quote` sem sessão = 401. VERIFIED (`docs/18`).

| Decisão arquitetural | Justificativa | Trade-off | Risco |
|---|---|---|---|
| Separação motor/UI (§2) | Fonte única; reuso por CRM/portal | Contrato interno a manter | Baixo (contratos tipados) |
| Cálculo no servidor (G-001) | Remove exposição de custo/margem | Latência + dependência do servidor | Mitigado (debounce ~250 ms — ASSUMPTION) |
| SQLite via `node:sqlite` (G-029) | Sem dependência nativa extra | Single-writer; instância única | Escala horizontal exige Postgres |
| Fail-closed sem `DATA_DIR`/segredo fraco (G-003/G-013/G-019/G-030/G-032) | Integridade e não-repúdio | Boot recusa em config incompleta | Baixo (comportamento desejado) |

**RNF (não funcionais, fonte: `docs/03`, `docs/09`, `docs/10`, `docs/13`):**

| ID | Requisito | Critério de aceite |
|---|---|---|
| RNF-001 | Determinismo | Mesma entrada + versão de premissas ⇒ mesma saída (funções puras) |
| RNF-002 | Precisão | float64 pleno, sem arredondamento intermediário; só de apresentação |
| RNF-003 | Confidencialidade estrutural | `client`/`commercial` sem custo/margem/COGS/tributo/fee Minu (invariante testado) |
| RNF-004 | Fail-closed de boot | Produção sem `DATA_DIR` ou com segredo fraco ⇒ exit 1 |
| RNF-005 | Estabilidade de contrato | Quebra de `PricingInput`/`PricingResult` exige bump MAJOR de `ENGINE_VERSION` |
| RNF-006 | Cache de borda seguro | SPA/`/assets/*` com `private, no-store` + `Vary: Cookie` (G-016) |

### Síntese Executiva
A arquitetura-alvo é um Web Service Node de instância única que autentica na borda, calcula no servidor
e serve um SPA que não carrega mais a regra financeira. A decisão de maior valor é o G-001: ela converte
"Negócios não vê margem" de promessa de UI em **garantia estrutural**, provada por gate de CL no CI.

---

## 5. Modelo de Negócio e Precificação (premissas v16)

**Fonte única de verdade:** `packages/pricing-engine/src/premises/premises.ts`, versão vigente **v16**
(`effectiveDate` 2026-11-05, `hash` imutável); **v15** permanece **congelada** e acessível por snapshot
(`docs/04`). Nenhum valor fixo espalhado pelo código.

**Fontes de receita e drivers (REQUIREMENT, `docs/04`/`docs/01 §4.2`):**

| Fonte | Composição | Regra |
|---|---|---|
| Platform Fee (Capacity Fee) | Progressivo por faixa de usuários | RB-001 (R-001) |
| Usage (DAU) | Faixas diárias × 30 | R-003 |
| Processing | MAU × tx × R$0,30 | R-004 |
| Setup | Fixo padrão + horas × R$350 + outros | RB-004 (R-021, redesenho §4) |
| Serviços dedicados | Capacity por perfil (TC R$25k, alvo R$35k, piso R$5k) | RB-003 (R-030) |
| Campanha | Markup 20% sobre mídia (fora do ARR) | R-040 |
| B2C | Fee por assinatura, antifraude Konduto, split 50/50 Minu | R-060..R-063 |

**Regras de negócio-chave (RB):**

| ID | Regra | Descrição (fonte) |
|---|---|---|
| RB-001 | Platform Fee progressivo | Σ por faixa (0,50 ≤25k … 0,445 >250k); piso econômico `cogs/(1−0,60)−usage−proc`; final = escolhido ×(1−desc. neg.)×(1−desc. prazo) (`docs/04`) |
| RB-002 | Desconto por tier editável | 3,00%–7,00% inclusivo, só sobre o PF do tier ativo; waterfall sequencial `PF→×(1−tier)→×(1−neg.)→×(1−prazo)`, não-linear; **validada na v16** (DECISION sponsor/CTO 2026-11-05) (`docs/04`) |
| RB-003 | Capacity/recursos dedicados | PMS/PCS por perfil; `net = 1−tributos−repasses`; margem = preço×net−TC−custos (`docs/04`) |
| RB-004 | Setup híbrido com redução −20% | Setup net = fixo padrão + horas×R$350 + outros; **redução default 20% uniforme, validada na v16** (`setupFixedReductionDefault=0,20`, DECISION 2026-11-05); valores-base dos tiers **inalterados e rastreáveis** (Starter 40k · Growth 60k · Scale 100k · Enterprise 140k · Enterprise+ 180k); v15 = 0% (`docs/04`/`docs/19`) |
| RB-005 | Desconto por prazo | 12→0 · 24→5% · 36→10%, só sobre o PF (R-015) |
| RB-006 | Corredor/alçada | base 10% · +2,5pp por gatilho · teto 15% (R-017) |
| RB-007 | Tributos | 11,7% sobre a base; sem dupla tributação (R-022) |
| RB-008 | Guardrails de margem | ≥70% SAUDÁVEL · ≥60% REVISAR · <60% REPRECIFICAR (R-019) |
| RB-009 | Fees Minu | conversão 15% do PF (12m) + AM/CS 5% (prazo) + markup Setup 20% (R-023/R-027) |
| RB-010 | TCV | `(core+serviços)×prazo + setup ao cliente + campanha` (R-025) |

**Versionamento (REQUIREMENT, `docs/04`/engine README).** Alterar uma premissa **não** edita a versão
vigente: cria-se nova versão e as propostas antigas seguem apontando para a anterior via snapshot
imutável; `premisesHash` detecta qualquer alteração. Aplicação concreta: a ratificação do desconto por
tier e a redução do Setup geraram a **v16** (duas mudanças de governança: `tierDiscountLimits.status:
pendente→validada` e `setupFixedReductionDefault: 0→0,20`). `reopenProposal` reproduz a versão congelada
da proposta (uma proposta v15 reabre com `status: pendente`).

**Dívida conhecida — margem do Setup (CONFLICT, `docs/19`).** O motor **não calcula margem do Setup** e
**não há premissa de custo de implantação por tier**. `marginStatus` incide só sobre o Core recorrente;
reduzir o Setup fixo **não move** o status em nenhum dos 960 cenários analisados e **não dispara**
`SETUP_HOUR_BELOW_MIN_MARGIN` (a hora de implantação mantém R$152,80/HH de margem, ~3× o piso de
R$50/HH). O corte de −20% é **seguro sob os guardrails existentes**, mas a margem percentual do próprio
Setup é hoje **inrespondível** — é um **dado faltante**, não uma afirmação inventada. Maior impacto
absoluto (−20%): Enterprise+ · Premium · Estratégico = −R$62.100 por contrato (net).

### Síntese Executiva
O modelo de precificação é o do legado, agora **governado e versionado**: v15 congelada, v16 vigente com
duas decisões do sponsor ratificadas (desconto por tier validado; Setup −20% como default). A única
dívida financeira aberta é a **margem do Setup por tier**, bloqueada por um dado de custo que ainda não
existe — explicitamente registrada como follow-up, não mascarada.

---

## 6. Dados e Contratos

**Fronteira pública (REQUIREMENT, `docs/03`).** As interfaces `PricingInput` → `PricingResult`
(`packages/pricing-engine/src/contracts/types.ts`) são o contrato estável que CRM, portal de parceiros,
ferramentas financeiras e a app consomem. Percentuais são sempre frações `[0,1]` na fronteira do motor.
Quebra de formato ⇒ bump MAJOR de `ENGINE_VERSION`; novos campos opcionais de saída ⇒ MINOR. A tabela de
premissas tem seu próprio versionamento (`premisesVersion` + `premisesHash`), independente do motor.

**QuoteView — contrato de saída da cotação (`quote.v1`, G-001-A, `docs/03`/`docs/15`).** Projeção por
perfil do `PricingResult`, devolvida por `POST /api/pricing/quote`. A fronteira de confidencialidade
(CWE-200/CWE-602) é **estrutural**: custo, margem, COGS, tributo, fee Minu, premissa de custo e breakdown
existem **apenas** em `internal`.

| view | papel | conteúdo | nunca contém |
|---|---|---|---|
| `client` | peça p/ cliente | plano, prazo, pricing público, descontos públicos, cenários | política, composição, waterfall, Setup detalhado, qualquer custo/margem |
| `commercial` | business/approver | client + composição, waterfall, Setup detalhado, alçada, `policy.marginAlert {level, requiresApproval}` (sinal, sem valores) | custo, margem, COGS, tributo, fee Minu, breakdown, `marginValue` |
| `internal` | tech/admin (`proposal.see_internal`) | commercial + `result` (PricingResult completo, bit-a-bit = `calculate(input)`), `scenariosFull` | — (única visão com custo/margem) |

**Invariantes (REQUIREMENT, provados por teste):** `QuoteView.internal.result ≡ calculate(input)`
(igualdade estrutural e serializada); varredura recursiva de `client`/`commercial` não acha nenhuma
chave proibida (exceção única permitida: `policy.marginAlert` com exatamente `{level, requiresApproval}`).

**Modelo de dados da esteira (`docs/10 §2`):** `Proposal {id, version(optimistic lock), status,
ownerEmail, commercial, technical?, snapshot?, reopenedFrom?, supersededBy?}`; `AuditEntry {id,
proposalId, actor, role, action, fromState?, toState?, note?, at}`. O repositório guarda inputs, estado,
snapshot e histórico — **não** duplica regra de cálculo.

**Snapshot imutável (REQUIREMENT, engine README).** Cada proposta grava `engineVersion`,
`premisesVersion`, `premisesHash`, cópia congelada das premissas, `input`, `result`, `id` e data.
`createProposalSnapshot()` calcula contra a tabela congelada; `reopenProposal()` recalcula contra as
premissas congeladas verificando reprodutibilidade e integridade do hash.

### Síntese Executiva
Os contratos são a espinha dorsal da confidencialidade e da reprodutibilidade. O `quote.v1` garante
"Negócios não vê margem" por **ausência física do campo**, não por ocultação de UI; o snapshot imutável
garante que uma proposta emitida reproduz seus valores mesmo após a tabela global mudar.

---

## 7. Segurança, RBAC, Confidencialidade e LGPD

**Autenticação (REQUIREMENT, `docs/09`).** Login exclusivo via Google, OpenID Connect / OAuth 2.0
Authorization Code + **PKCE (S256)**. `state`/`nonce`/PKCE em cookie de fluxo assinado (HttpOnly,
SameSite=Lax, 10 min); ID token **verificado criptograficamente** (`verifyIdToken`: assinatura, `iss`,
`aud`, `exp`, `nonce`). Nenhum token do Google fica no navegador; a sessão é um cookie assinado HMAC
(HttpOnly, Secure em produção, SameSite=Lax, 8h) com identidade mínima.

**Autorização por domínio (REQUIREMENT, `docs/09 §2`).** Quem pode entrar é decidido **no servidor**:
`email_verified === true` (boolean estrito) + domínio = parte após o **último** `@`, minúsculo, igual
por string a um de `minu.co · minutrade.com · grupoarka.co · brain3.com.br · coremidia.co`. 10 bypasses
testados e recusados; `hd` do Google tratado só como dica de UX.

**RBAC 4 perfis (REQUIREMENT, `docs/10 §9`).** `business` · `tech` · `approver` · `admin`. Decisão pura
(`authorize(action, role)`) + enforcement **sempre no servidor**; o React nunca é a fronteira. Matriz
exaustiva 4×18 testada. Sem perfil ⇒ 403 `profile_required` em toda API de negócio.

| Ação (resumo) | business | tech | approver | admin |
|---|:--:|:--:|:--:|:--:|
| create/edit_commercial/edit_tier_discount/emit | ✔ | — | — | — |
| edit_technical/validate_technical/see_internal | — | ✔ | — | ✔(see) |
| approval.decide | — | — | ✔ | — |
| proposal.reopen (G-025) | — | — | ✔ | ✔ |
| admin.reassign_owner (G-002) / manage_users / sla.configure | — | — | — | ✔ |
| pricing.quote | ✔(commercial) | ✔(internal) | ✔(commercial) | ✔(internal) |

**Escopo por dono (G-002, DECISION, `docs/16`/`docs/10 §9.1`).** `business` só vê/edita propostas cujo
`ownerEmail` é o seu; `tech`/`approver` só propostas fora do rascunho; `admin` lê todas. Fora do escopo
⇒ **404** (idêntico a inexistente, para não revelar existência) + log `rbac_denied` com pseudônimo HMAC.
`admin.reassign_owner` troca o dono com auditoria append-only. Teste de regressão IDOR por rota.

**Gestor/Aprovador (G-006, DECISION, `docs/16`/`docs/10 §11`).** Solicitações `excecao_comercial ·
alteracao_escopo · replanejamento_sla` (enum fechado), estado `aguardando_aprovacao_gestor` (não pausa
SLA), fila `/api/approvals/pending` só com metadados + justificativa (sem custo/margem), separação de
funções (solicitante ≠ decisor), invalidação por mudança material (G-023).

**Confidencialidade por perfil (REQUIREMENT, `docs/03`/`docs/15`/`docs/20`).** Estrutural em dois
níveis: (1) o servidor projeta `QuoteView` por perfil; (2) o PDF só formata o que o payload do perfil
contém — em `client`/`commercial` o `result` é nulo, logo não há de onde vazar. VERIFIED (texto real dos
PDFs verificado, `docs/24`).

**Segurança aplicada (REQUIREMENT, `docs/09 §3`/`docs/10`).** CSRF (state + SameSite), replay (nonce),
PKCE, sessão HMAC tempo-constante, open-redirect contido, cache privado (`no-store`), `X-Frame-Options:
DENY`, `nosniff`, path-traversal contido, `/api/*` com checagem Sec-Fetch-Site/Origin em métodos
mutantes e `Content-Type: application/json` (415), corpo >256 KB ⇒ 413, auditoria append-only por
triggers (G-007/G-028), segredo de sessão com heurística de força ≥128 bits (G-019/G-030/G-032).

**Limitação de modelo de ameaça (CONFLICT honesto, `docs/09 §4`).** A Opção B (proxy de borda) barra
quem **não** tem sessão, mas não cifra o conteúdo para quem **já** entrou. O risco residual de "usuário
autorizado lê fórmulas no JS" foi **eliminado** pelo G-001 (motor fora do bundle, `docs/18`) — é o que
elevou a proteção de "manter fora quem não é da equipe" para "esconder o custo até dos próprios
usuários autorizados".

**LGPD / auditoria (fonte disponível vs. recomendação).** A fonte documenta: identidade mínima na
sessão (e-mail/nome/foto/domínio/exp), logs de segurança **sem tokens nem PII desnecessária**
(`login_ok` só domínio; `rbac_denied` por pseudônimo HMAC), auditoria append-only e autorização estrita
por domínio corporativo. **Recomendação (não suportada por doc dedicado):** uma análise formal de LGPD
(ROPA, bases legais, retenção, direitos do titular) não consta dos docs 01–24 — ver Cap. 14 (lacuna
LG-01). Nada aqui afirma conformidade LGPD além do que os controles técnicos citados comprovam.

### Síntese Executiva
Segurança é o eixo mais maduro: autenticação federada com verificação criptográfica, RBAC server-side
deny-by-default, escopo por dono, confidencialidade estrutural e auditoria imutável, todos VERIFIED pelo
Guardian. A fronteira honesta é documental, não técnica: falta uma peça formal de LGPD (ROPA/retenção),
registrada como lacuna, não como conformidade presumida.

---

## 8. SLA Técnico e Indicadores

**Contrato (REQUIREMENT, `docs/11`).** P&T emite parecer técnico (aprovado / aprovado com ressalvas /
ajustes necessários / inviável) em **no máximo 5 dias úteis de tempo efetivo**, contados de um briefing
completo. Decisões congeladas: contagem em **dias úteis corridos**; fuso **America/Sao_Paulo**; feriados
nacionais BR configuráveis; prazo padrão 5 dias (só admin altera, com auditoria); limiar "Atenção" = 1
dia útil restante.

**Modelo (REQUIREMENT).** Estado **derivado** de eventos append-only (`reduceSla()`), nunca armazenado:
`started` (automático no handoff Negócios→fila técnica, idempotente), `paused` (exige justificativa, não
retroage), `resumed` (retoma o saldo, nunca reinicia), `completed` (congela + `verdict`, `metSla` =
consumido ≤ 5). Estados do relógio: `nao_iniciado → em_andamento ⇄ pausado → concluido`.

**Regra crítica (REQUIREMENT, §6.4):** solicitar/agendar reunião técnica **NÃO pausa** o SLA
(`slaUnaffected: true`); nem solicitações ao Gestor (G-006). A pausa é ação separada, explícita e
justificada de P&T.

**Indicadores P75/P90 (REQUIREMENT, `docs/11 §9`).** `GET /api/sla/indicators` (tech/approver/admin;
business ⇒ 403). Métrica principal = **tempo útil efetivo** (dias úteis excluindo pausas); percentil
nearest-rank inclusivo (ASSUMPTION documentada); payload sem custo/margem/snapshot (testado).

| SLI | Definição | SLO/alerta |
|---|---|---|
| Tempo útil efetivo | Dias úteis consumidos excluindo pausas | ≤ 5 dias úteis = no prazo |
| % no prazo (`pctWithinSla`) | Fração da amostra com útil ≤ 5 | indicador de gestão |
| P75/P90 (útil e bruto) | Percentis nearest-rank sobre a amostra started+completed | painel P&T |

**Pendências explicitadas (não inventadas, §8):** UI de configuração do SLA (hoje default fixo em
código); **alertas ativos** (status é exibido, mas disparo de notificação depende de infraestrutura de
canais — não se alega envio que não existe); histogramas de tempo mediano.

### Síntese Executiva
O SLA é um relógio auditável derivado de eventos, com a invariante de produto de que reunião e
aprovação **não** consomem o prazo. Está VERIFIED (unidade + API + smoke 10/10). As pendências são de
superfície (UI de config, alertas ativos), não de regra — e estão registradas, não mascaradas.

---

## 9. Operação, Deploy e Observabilidade

**Natureza (NÃO-VERIFICADO, `docs/13`/`docs/24`).** `docs/13` é um **runbook de empacotamento**: nada
foi provisionado nem implantado na AWS por este trabalho; o Dockerfile e os passos **não foram
verificados em AWS**. O deploy é **manual** e de responsabilidade do time.

**Build e start (REQUIREMENT operacional, `docs/13`).** Node 22+ (`node:sqlite`). Build em 3 passos
(pricing-engine → commercial-workspace → auth-proxy); `dist/` gitignorados ⇒ sempre buildar em ambiente
limpo. Alternativa: Dockerfile multi-stage `node:22-slim`, usuário não-root, `DATA_DIR=/data`. Start:
`NODE_ENV=production node apps/auth-proxy/dist/server.js`. Porta padrão 10000; health `GET /healthz`.

**Persistência (DECISION/ASSUMPTION, `docs/13 §8`/`docs/10`).** `ProposalRepository` sobre SQLite
(`node:sqlite`) em `DATA_DIR`. **Fail-closed (G-003):** em produção, sem `DATA_DIR` ou SQLite
inacessível ⇒ exit 1. Topologia recomendada (**ASSUMPTION a confirmar com arquitetura**): **instância
única** com volume EBS (SQLite é single-writer; deploy stop-then-start, não rolling). EFS = **RISCO**
(WAL/locking em NFS não testado). Postgres/RDS = fora de escopo (habilita multi-instância). `busy_timeout`
5000 ms + retry; lock persistente ⇒ 503 `storage_busy` (G-029).

**Segredos (REQUIREMENT, `docs/13 §5`).** `GOOGLE_CLIENT_SECRET` e `SESSION_SECRET` via Secrets
Manager/SSM; `SESSION_SECRET` recusado no boot se fraco (< 128 bits estimados, default de dev,
periódico, sequência/dicionário). `BOOTSTRAP_ADMIN_EMAILS` obrigatório no 1º deploy. **Nunca** usar
`VITE_*` para segredo (vai para o bundle).

**TLS/borda (NÃO-VERIFICADO).** O app não termina TLS nem trata `X-Forwarded-*`; termine em
ALB/CloudFront. `redirect_uri` do Google = `PUBLIC_URL + /auth/callback`, idêntico. Cache de borda:
`CachingDisabled` para o SPA (G-016) — comportamento real de CDN/ALB NÃO-VERIFICADO.

**Observabilidade (PRONTO-COM-CONDIÇÃO).** `/healthz` expõe `repo` (sqlite/memory) e serve de health
check; logs JSON no stdout (enviar ao CloudWatch). **Backup:** `sqlite3 … "VACUUM INTO …"` + S3/snapshot
EBS. **Rollback:** reimplantar versão anterior apontando ao mesmo volume. **Condição:** exercitar
backup/rollback reais em staging (`docs/24`).

**CI de segurança (PRONTO-COM-CONDIÇÃO, `docs/23`).** `ci.yml` (typecheck/testes/build/gate de
bundle/audit de produção) + `security.yml` (gitleaks no histórico + Semgrep + `npm audit`). Política:
secret-scan e SAST bloqueantes; `npm audit --omit=dev` bloqueante (0 em high+); audit completo
informativo (F-05 são CVEs dev-only de vitest/vite/esbuild, não shippadas). trivy de imagem = bloco
**comentado**, habilitar quando houver imagem em registry. Run verde confirmado pelo sponsor; condição:
manter verde a cada release.

### Síntese Executiva
A operação está empacotada e documentada, não exercitada em nuvem. O produto falha fechado diante de
configuração incompleta — comportamento desejado — e expõe os ganchos de observabilidade/backup/rollback.
Tudo que depende de AWS real está marcado NÃO-VERIFICADO e colapsa no checklist de go-live do PRR.

---

## 10. Governança, Decisões (ADRs) e Qualidade

**Índice de decisões (ADRs e DECISIONs do sponsor):**

| ADR/Doc | Decisão | Classe | Estado |
|---|---|---|---|
| `docs/15` (G-001) | Cálculo de preço/margem movido ao servidor; motor fora do bundle | Nível 3 (arquitetura+segurança) | VERIFIED (`docs/18`) |
| `docs/16` (G-002) | Escopo por dono (business só vê o próprio); reatribuição por admin | Nível 2 | VERIFIED |
| `docs/16` (G-006) | Gestor/Aprovador funcional (solicitações, estado, fila) | Nível 2 | VERIFIED (exceto alerta de margem, ver §11.5) |
| `docs/04`/`docs/19` | Desconto por tier validado + Setup −20% default → **v16** | Nível 2 | VERIFIED |
| `docs/22` (G-025) | Reabertura pós-emissão cria nova versão; emitida imutável | Nível 2 | IMPLEMENTADO-PENDENTE-REVISÃO→VERIFIED no PRR |
| `docs/21` | Identidade visual do PDF (verde-limão `#C2FF01` + Space Grotesk/Geist Mono) diverge do app (amber) | Nível 2–3 | DECIDIDO; reconciliação de marca em aberto |

**Qualidade (fonte: `docs/14`/`docs/18`/`docs/24`).** Revisão adversarial independente pelo Quality &
Security Guardian (≠ autor). Findings G-001..G-035, F-PDF-04 e F-04 **corrigidos e VERIFIED**; nenhum
CRITICAL/HIGH em aberto no comportamento do sistema. O autor nunca marca VERIFIED — só o Guardian.

**Estado da suíte (último verificado pelo Guardian; não re-executado no rollup do PRR):** 851–889 testes
verdes conforme o eixo (engine ~125, UI ~148, auth-proxy ~616); typecheck 5/5; 3 builds; gate de bundle
0 proibidos; `npm audit --omit=dev` = 0; smokes quote/sla/e2e PASS (`docs/24 §2`).

**Matriz RACI de governança (inferida da fonte, rotulada como leitura):**

| Atividade | business | tech | approver | admin | sponsor |
|---|:--:|:--:|:--:|:--:|:--:|
| Inputs comerciais / emissão | R/A | C | I | I | — |
| Parecer técnico / SLA | I | R/A | I | C | — |
| Decisão de exceção comercial | C | C | R/A | I | — |
| Administração de perfis/políticas | — | — | — | R/A | C |
| Decisões de produto/marca (ADRs) | I | C | C | C | R/A |

### Síntese Executiva
A governança é rastreável por ADRs com classe de decisão e por uma revisão adversarial que separa autor
de verificador. Toda a árvore de findings do Guardian está fechada; o que resta não é defeito de
sistema, e sim decisões de produto (margem do Setup, reconciliação de marca) e homologação de ambiente.

---

## 11. Roadmap e Follow-ups

**Follow-ups rastreáveis (fonte: `docs/18 §4`/`docs/24 §4`/`docs/08`):**

| ID | Item | Natureza | Dono |
|---|---|---|---|
| FUP-01 | Cadastrar **custo de implantação por tier** + guardrail de margem do Setup (`setupMargin`) | mudança de escopo (premissas + motor + UI) | project-book |
| FUP-02 | Reconciliação de marca PDF (verde-limão) × app (amber) — ADR `docs/21` | decisão de produto | sponsor/project-book |
| FUP-03 | Habilitar **trivy** (container scan) quando houver imagem em registry | CI/segurança | fullstack/time |
| FUP-04 | Migrar `ProposalRepository` para **Postgres/RDS** se precisar multi-instância | arquitetura | arquitetura |
| FUP-05 | Bump deliberado da cadeia Vitest/Vite (F-05, CVEs dev-only) com re-rodada da suíte | dependências | fullstack |
| FUP-06 | UI de configuração do SLA + **alertas ativos** por canal | produto/UI | fullstack |
| FUP-07 | Migração de dados Render→AWS (se houver propostas na Render) com backup/reconciliação | operação | time |
| FUP-08 | Exportar/importar propostas (JSON); matrizes B2C adicionais que o motor já calcula | produto | fullstack |

**Horizontes (fonte: `docs/08 §roadmap`):** curto prazo — deploy real + portabilidade JSON + matrizes
B2C; médio prazo (Cenário B) — histórico compartilhado, workflow de alçada institucional, integração
com CRM/sistemas de aprovação (contratos já prontos); governança financeira contínua — pipeline de novas
versões de premissas (v17…) + painel de status por item.

### Síntese Executiva
O roadmap distingue claramente **decisões de produto pendentes** (margem do Setup, marca), **homologação
de ambiente** (AWS, trivy, migração de dados) e **evolução estratégica** (Cenário B, CRM). O item de
maior valor financeiro é FUP-01: sem o custo de implantação por tier, a margem do Setup permanece não
medível.

---

## 12. Riscos e Go-Live

**Riscos (formato PL-025, fonte: `docs/14`/`docs/24`):**

| ID | Categoria | Risco | Prob. | Impacto | Mitigação | Dono |
|---|---|---|---|---|---|---|
| RK-01 | Operação | docker build / comportamento atrás de ALB/CloudFront NÃO-VERIFICADO | Média | Alto | Checklist go-live §3.1–§3.2 em staging | time |
| RK-02 | Dados | SQLite multi-processo (single-writer) | Baixa | Alto | Instância única (G-029); Postgres se escalar | arquitetura |
| RK-03 | Financeiro | Margem do Setup não computável (custo por tier ausente) | Certa | Médio | FUP-01; −20% seguro nos guardrails atuais | project-book |
| RK-04 | Dependências | F-05 (CVEs dev-only vitest/vite/esbuild) | Baixa | Baixo | Não shippadas; bump deliberado (FUP-05) | fullstack |
| RK-05 | Marca | Divergência PDF × app | Baixa | Baixo | ADR `docs/21`; decisão futura (FUP-02) | sponsor |
| RK-06 | Operação | Migração de dados Render→AWS | Média | Médio | Backup + reconciliação (FUP-07) | time |
| RK-07 | Conformidade | Peça formal de LGPD (ROPA/retenção) ausente nos docs | Média | Médio | Produzir análise LGPD (lacuna LG-01) | sponsor/jurídico |

**Checklist de Go-Live (REQUIREMENT, `docs/24 §3` — o time DEVE executar antes de apontar clientes):**

| # | Item | Critério | Dono | Estado |
|---|---|---|---|---|
| 1 | docker build + run | `docker build` + `docker run` com `DATA_DIR` em volume; `/healthz` 200 `repo:sqlite` | time | NÃO-VERIFICADO |
| 2 | Staging AWS (instância única) | smoke `docs/13 §9`: `/healthz` 200, `GET /` sem sessão → 302 /login, `/api/me` → 401 | time | NÃO-VERIFICADO |
| 3 | OAuth Google real | `redirect_uri` = `PUBLIC_URL+/auth/callback`; login de domínio autorizado; bootstrap admin | time | NÃO-VERIFICADO |
| 4 | Segredos | `SESSION_SECRET` forte + `GOOGLE_CLIENT_SECRET` via SM/SSM; boot recusa segredo fraco | time | NÃO-VERIFICADO |
| 5 | TLS em ALB/CloudFront | `PUBLIC_URL` https; cookies Secure | time | NÃO-VERIFICADO |
| 6 | Backup/rollback SQLite | VACUUM INTO + snapshot EBS; reimplantar versão anterior no mesmo volume | time | NÃO-VERIFICADO |
| 7 | CI verde no commit a promover | `ci.yml` + `security.yml` verdes | time | confirmado pelo sponsor (manter) |
| 8 | trivy (se imagem em registry) | habilitar job comentado em `security.yml` | time | CONDICIONAL |

**Veredito (fonte: `docs/24 §6`): GO-COM-CONDIÇÕES.** Engenharia e segurança **aceitas** (todos os
findings do Guardian VERIFIED; nenhum CRITICAL/HIGH aberto). Go-live para clientes externos condicionado
ao checklist §3 (itens 1–7 obrigatórios), executável só no ambiente AWS do time. Cumpridos: (1) docker
build + smoke em staging; (2) OAuth real + segredos + TLS; (3) backup/rollback + instância única; (4) CI
verde no commit promovido — o parecer passa a **GO**.

### Síntese Executiva
O produto não está "pronto para produção" de forma incondicional, e o Livro não o apresenta assim: está
**pronto-com-condição**, com um checklist de 8 itens cujo dono é o time, no ambiente AWS. A separação
entre "aceito em engenharia/segurança" e "condicionado em operação" é a leitura correta do estado real.

---

## 13. Matriz de Rastreabilidade (objetivo → capítulo → doc-fonte)

| Objetivo / tema | Capítulo | Docs-fonte |
|---|---|---|
| Fonte única de verdade / separação motor-UI | 2, 4 | 01, 08, README, engine README |
| Reprodução fiel do legado (paridade) | 2, 5 | 01, 04, engine README |
| Jornada comercial e esteira | 3 | 05, 10 |
| Arquitetura-alvo e cálculo server-side (G-001) | 4 | 08, 09, 15, 18 |
| Precificação, premissas v16, Setup −20% | 5 | 04, 19 |
| Margem do Setup (dívida) | 5, 11, 12 | 19, 18 |
| Contratos de dados e QuoteView | 6 | 03, 15 |
| Snapshot/versionamento | 6 | 04, engine README |
| Autenticação OAuth/PKCE + domínio | 7 | 09 |
| RBAC 4 perfis, escopo por dono, aprovador | 7 | 10, 16 |
| Confidencialidade por perfil (PDF/payload) | 7 | 03, 15, 20 |
| LGPD/auditoria (parcial) + lacuna | 7, 14 | 09, 10 |
| SLA 5 dias + P75/P90 | 8 | 11 |
| Deploy AWS / persistência / observabilidade | 9 | 12, 13, 24 |
| CI de segurança | 9 | 23 |
| Governança, ADRs, qualidade | 10 | 14, 15, 16, 18, 21, 22, 24 |
| Roadmap/follow-ups | 11 | 08, 17, 18, 24 |
| Riscos + go-live (PRR) | 12 | 14, 24 |
| Identidade visual do PDF | 10, 11 | 20, 21 |
| Design system / PDF / persistência | 3, 7 | 06 |

---

## 14. Lacunas e Drift de Documentação

Itens sinalizados, **não preenchidos com conteúdo inventado**.

**Lacunas (algo relevante não coberto por doc dedicado):**

- **LG-01 — LGPD formal.** Não há doc dedicado de LGPD (ROPA, bases legais, retenção, direitos do
  titular, RIPD). Os docs 09/10 cobrem controles técnicos (identidade mínima, logs sem PII, auditoria,
  autorização por domínio), mas não uma análise de privacidade. Recomendação: produzir peça de LGPD
  antes de dados de clientes reais trafegarem (dono: sponsor/jurídico).
- **LG-02 — Custo de implantação por tier.** Dado faltante que impede calcular a margem do Setup
  (`docs/19`); é follow-up FUP-01, aqui reafirmado como lacuna de dado, não de documentação.
- **LG-03 — Docs 02/07/12 não resumidos individualmente neste Livro.** São operacionais
  (comandos/checklist de homologação/auditoria de completude) e seu conteúdo substantivo está
  consolidado via docs 13 e 24; citados na matriz, sem capítulo próprio. Não é ausência de fonte, é
  escolha de consolidação (declarada para transparência).
- **LG-04 — Alertas ativos de SLA e UI de configuração.** Documentados como pendência honesta em
  `docs/11 §8`; dependem de infraestrutura de canais. Não há spec de implementação.

**Drift (doc que pode divergir do código — sinalizado, não "corrigido"):**

- **DR-01 — Contagem de testes.** As fontes reportam totais diferentes conforme a data da rodada:
  `docs/17` (753), `docs/18` (837), `docs/24 §2` (851–889). Não é contradição de regra, é fotografia de
  momentos distintos; o estado canônico de prontidão é o do PRR (`docs/24`). Validar o número real
  re-executando a suíte no commit a promover (go-live §7).
- **DR-02 — README raiz desatualizado quanto ao deploy.** O `README.md` raiz descreve o deploy como
  "Render (Static Site, SPA)" e lista o Pricing Engine com "40 testes", refletindo a Fase 1 anterior à
  Opção B (Web Service + auth-proxy) e ao G-001. O estado atual é Web Service Node com auth-proxy
  (docs 09/10/13) e suíte muito maior (docs 18/24). Recomendação: atualizar o README raiz; não alterado
  por este trabalho (fora do escopo pedido).
- **DR-03 — Nomenclatura de estado dos ADRs.** `docs/16`/`docs/22` marcam G-002/G-006/G-025 como
  "IMPLEMENTADO-PENDENTE-REVISÃO"; `docs/18`/`docs/24` os consolidam como VERIFIED. O estado vigente é
  o do PRR (VERIFIED). Os docs de ADR não foram reescritos para refletir o rollup — divergência de
  carimbo, não de comportamento.

---

## 15. Apêndices

### 15.1 Glossário
- **Pricing Engine** — motor financeiro TS puro, fonte única de verdade.
- **Commercial Workspace** — SPA React da jornada comercial.
- **auth-proxy** — Web Service Node de borda (auth + RBAC + esteira + persistência + cotação).
- **QuoteView (`quote.v1`)** — projeção por perfil do `PricingResult` (`client`/`commercial`/`internal`).
- **Snapshot** — cópia imutável da proposta (input + result + premissas congeladas + hash).
- **Esteira** — máquina de estados Negócios→P&T→aprovação→emissão→reabertura.
- **marginStatus** — SAUDÁVEL (≥70%) / REVISAR (≥60%) / REPRECIFICAR (<60%), sobre o Core recorrente.
- **PRR** — Production Readiness Review (`docs/24`), veredito GO-COM-CONDIÇÕES.

### 15.2 Catálogo de módulos (`docs/05`)
Motor de Pontos (`points`) · Motor de Engajamento/Missões (`engagement`, requer `points`) · Roletas
(`roulette`, requer `points`, recomenda `engagement`) · Leitor de NF (`nfReader`, recomenda `points`) ·
Planos de Benefícios (`benefits`). Complexidade por quantidade: 1–2 Baixa · 3–4 Média · 5 Alta. 32
combinações (2^5) testadas.

### 15.3 Requisitos funcionais (resumo; detalhe nas regras RB-001..RB-010 do Cap. 5)
- **RF-001** Calcular cotação por perfil via `POST /api/pricing/quote` (fonte única; projeção por view).
- **RF-002** Catálogo público `GET /api/pricing/catalog` (rótulos/limites; sem preço/custo/margem).
- **RF-003** Criar/editar/transicionar propostas na esteira com RBAC + optimistic lock + auditoria.
- **RF-004** SLA de 5 dias úteis derivado de eventos + indicadores P75/P90.
- **RF-005** Reabertura pós-emissão (G-025) criando nova versão rastreável.
- **RF-006** Gerar PDF `BONDLY-2027-NNNNNN` por perfil (confidencialidade estrutural).
- **RF-007** Atribuição individual de perfis por admin (bootstrap via `BOOTSTRAP_ADMIN_EMAILS`).

### 15.4 Decisões do sponsor (decision log)
G-001 (server-side) · G-002 (escopo por dono) · G-006 (aprovador funcional) · desconto por tier validado
(v16) · Setup −20% default (v16) · G-025 (reabertura) · identidade visual do PDF (verde-limão). Todas com
ADR/doc citado no Cap. 10.

### 15.5 Referências
`docs/01`–`docs/24`, `docs/README.md`, `README.md` raiz, `packages/pricing-engine/README.md`.
