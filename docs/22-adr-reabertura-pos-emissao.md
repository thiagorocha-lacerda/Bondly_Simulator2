# 22 — ADR: Reabertura pós-emissão de proposta (fecha G-025)

- Status: **DECIDIDO pelo sponsor (CTO)**, 2026-11-05. Implementação: **IMPLEMENTADO-PENDENTE-REVISÃO** (product-fullstack, 2026-11-05). Verificação: somente o Guardian (este agente NÃO marca VERIFIED).
- Origem: Finding **G-025** (proposta `emitido` imutável, sem fluxo de reabertura) em [doc 14](./14-quality-review-rbac-indicadores.md); CONFLICT registrado em [doc 16](./16-decisoes-g002-g006.md).
- Classe: Nível 2 (produto).

## Contexto
Hoje uma proposta em `emitido` é imutável (edição ⇒ 409 `proposal_issued_immutable`) e não há caminho de revisão — só recriar do zero. O sponsor decidiu criar um fluxo de reabertura controlado.

## Decisão
Reabrir uma proposta `emitido` cria uma **NOVA VERSÃO**; a emitida original permanece **imutável e preservada** como registro histórico.

### Requisitos (REQUIREMENT)
1. **Nova versão, não edição da emitida.** A reabertura gera uma nova proposta derivada (ex.: id `BONDLY-2027-NNNNNN` novo, ou sufixo de versão — decisão de implementação, documentar) que **herda** os inputs comerciais/técnicos da emitida (cópia dos dados, não do snapshot congelado) e entra num estado **editável** (`rascunho_comercial` ou `ajustes_solicitados` — o fullstack escolhe o coerente com a FSM atual e documenta). A emitida original NÃO muda de estado nem de conteúdo.
2. **Quem pode reabrir:** somente `approver` (Gestor/Aprovador) ou `admin`. `business`/`tech` NÃO reabrem. Nova ação RBAC (ex.: `proposal.reopen`) na matriz, com teste exaustivo 4 papéis × ações.
3. **Justificativa obrigatória:** a reabertura exige `reason` (texto, limite central de `limits.ts`, normalizado — vazio/invisível ⇒ 400). Registrada na auditoria.
4. **Auditoria append-only:** evento de reabertura com quem, quando, proposta origem (emitida), proposta destino (nova versão), justificativa — na mesma transação que cria a nova versão. Trilha imutável (triggers já existentes).
5. **Vínculo de rastreabilidade:** a nova versão referencia a proposta de origem (`reopenedFrom`/`supersedes`) e a emitida pode referenciar a sucessora (`supersededBy`), para navegação e auditoria. Não quebrar snapshots/propostas existentes (migração aditiva).
6. **Gates aplicáveis à nova versão:** ela percorre normalmente a esteira — reanálise técnica se o escopo mudar (reusa invalidação por mudança material, G-023), e o gate de emissão por margem (G-026) vale como em qualquer proposta. Nada de bypass por ser "reabertura".
7. **Escopo por dono (G-002):** a nova versão tem um `ownerEmail` — ASSUMPTION: herda o dono da emitida; `admin` pode reatribuir (fluxo G-021 existente). Confirmar se o approver que reabre deve virar dono (provavelmente NÃO — mantém o dono de Negócios).

## Pontos em aberto (decisão de implementação, documentar; não re-perguntar ao sponsor salvo bloqueio)
- Formato do id da nova versão (novo id vs sufixo `-v2`).
- Estado inicial exato da nova versão na FSM.
- Se a emitida de origem ganha um marcador visual "substituída por" na UI.

## Implementação (product-fullstack, 2026-11-05) — decisões de implementação
Resolvendo os "Pontos em aberto" acima:
- **Formato do id da nova versão:** `BONDLY-2027-NNNNNN` novo (sequência via `nextSequence()`/`formatProposalId`), **não** sufixo `-v2`. Coerente com o modelo existente (todo id é único e sequencial); o vínculo `reopenedFrom`/`supersededBy` carrega a rastreabilidade — DECISION.
- **Estado inicial da nova versão:** `rascunho_comercial` (constante `REOPENED_INITIAL_STATE` em `workflow.ts`). Recomeça a esteira sob o dono de Negócios e, ao avançar, passa por G-023 (reanálise material) e G-026 (gate de margem) como qualquer proposta — DECISION.
- **Marcador visual "substituída por":** SIM — a UI mostra "Substituída por <id>" na emitida e "Reaberta de <id>" na nova versão (campos projetados a todos os papéis; são metadados, não custo/margem) — DECISION.

**Onde:** ação RBAC `proposal.reopen` (`rbac.ts`, matriz 4×18 + teste exaustivo); endpoint `POST /api/proposals/:id/reopen { reason }` (`api.ts`); método transacional `reopenProposal` (`memoryRepository.ts` + `sqliteRepository.ts`); campos aditivos `reopenedFrom`/`supersededBy` em `Proposal`/`projection.ts`; migração aditiva (`ALTER TABLE ... ADD COLUMN` idempotente, colunas opcionais NULL — bancos antigos abrem sem elas); UI `ReopenProposal.tsx` + `WorkflowStepper.tsx`/`useProposals.ts`. Testes em `apps/auth-proxy/src/reopen.test.ts` (memória + SQLite real, incl. banco de schema anterior e mutation sanity do guard `not_issued`).

**Validação (product-fullstack, não é VERIFIED):** typecheck PASS · suíte PASS (auth 616, UI 140, engine 125) · 3 builds PASS · bundle gate 0 proibidos · `npm audit --omit=dev` 0 vulnerabilidades · smoke E2E 27/27 PASS.

## Consequências
- Mantém a imutabilidade e o não-repúdio da peça emitida (preserva o ganho do G-025).
- Dá caminho auditável de revisão sem recriar do zero.
- Reusa máquina de estados, invalidação por mudança material e gate de emissão — sem porta dos fundos.
- Custo: nova ação RBAC, campos de vínculo, UI mínima de reabertura para approver/admin.

## Critérios de aceite (para o Guardian)
- `emitido` + `business`/`tech` tentando reabrir ⇒ 403; `approver`/`admin` com justificativa ⇒ cria nova versão editável; sem justificativa ⇒ 400.
- A emitida original permanece `emitido`, imutável (edição ⇒ 409) e com conteúdo inalterado após a reabertura.
- A nova versão referencia a origem; auditoria append-only registra a reabertura; a nova versão respeita G-023/G-026 ao avançar.
- Sem regressão de G-002 (escopo por dono) nem dos testes existentes.
