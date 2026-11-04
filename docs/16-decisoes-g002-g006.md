# 16 — Decisões do sponsor: G-002 (escopo por dono) e G-006 (Gestor/Aprovador funcional)

- Status: **DECIDIDO pelo sponsor (CTO)**, 2026-11-04. Implementação: **G-002 IMPLEMENTADO-PENDENTE-REVISÃO** (2026-11-04; ver doc 14 "Resposta do autor (G-002)"); G-006 **IMPLEMENTADO-PENDENTE-REVISÃO** (2026-11-04; ver doc 10 §11 e doc 14 "Resposta do autor (G-019..022 e G-006)"), exceto o alerta de margem (CONFLICT, ver doc 10 §11.5). Verificação: somente o Guardian.
- Origem: Findings G-002 e G-006 em [doc 14](./14-quality-review-rbac-indicadores.md).
- Classe: Nível 2 (produto). Os pontos marcados ASSUMPTION foram propostos pelo orchestrator para evitar bloqueio e podem ser vetados.

## G-002 — DECISÃO: só o dono vê e edita (perfil Negócios)

**Status:** IMPLEMENTADO-PENDENTE-REVISÃO (autor não marca VERIFIED; somente o Guardian).

**REQUIREMENT:** um usuário `business` só lista, lê, edita e transiciona propostas em que `ownerEmail` é o seu próprio e-mail. Qualquer acesso a proposta alheia responde 404 (não 403, para não revelar existência) e gera log `rbac_denied`.

**Efeitos colaterais da decisão (a tratar na implementação):**
1. `tech`, `approver` e `admin` precisam enxergar propostas fora do próprio dono para cumprir o papel. ASSUMPTION: `tech` e `approver` leem somente propostas que **saíram do rascunho** (estado ≥ `aguardando_analise_tecnica`); `admin` lê todas. Rascunhos comerciais de Negócios ficam invisíveis a `tech`/`approver`.
2. Troca de dono: se o responsável sai da empresa ou muda de área, a proposta fica órfã. ASSUMPTION: `admin` pode **reatribuir o dono**, com auditoria (de, para, quem, quando). Sem isso a proposta só seria acessível ao admin.
3. Colaboração entre colegas de Negócios deixa de existir (decisão do sponsor). Registrar como limitação conhecida; não criar compartilhamento sem nova decisão.
4. Indicadores de SLA (P75/P90) continuam agregados e sem identificação de propostas, e portanto não são afetados.
5. Aplicar a regra no repositório/`api.ts` (camada única), não só nas rotas, para que listagem, leitura, escrita, transição, reuniões, SLA e exportações compartilhem o mesmo guard. Teste de regressão IDOR obrigatório por rota.

## G-006 — DECISÃO: entregar o Gestor/Aprovador funcional

**REQUIREMENT (brief §11):** o Gestor/Aprovador aprova exceções comerciais, alterações de escopo e replanejamentos justificados.

**Lacuna:** não existe especificação de fluxo para exceções. ASSUMPTIONs abaixo, a validar pelo sponsor:

1. **Tipos de solicitação (`kind`)**: `excecao_comercial`, `alteracao_escopo`, `replanejamento_sla`. A lista é fechada (enum).
2. **Quem solicita:** `business` solicita `excecao_comercial` e `alteracao_escopo`; `tech` solicita `replanejamento_sla` (mudança material de escopo, brief §10.5). Cada solicitação exige justificativa (≤ 500 caracteres) e referência à versão da proposta.
3. **Efeito na esteira:** a solicitação coloca a proposta em estado `aguardando_aprovacao_gestor` (sub-estado que **não** reinicia nem pausa o relógio do SLA, para não violar o brief §10.4). `aprovado` retorna ao estado anterior com a exceção registrada e vinculada ao snapshot; `rejeitado` retorna com a justificativa obrigatória do aprovador. Decisão idempotente (já existe 200/409).
4. **Alerta de margem:** exceção comercial que gere alerta de margem exige aprovação do Gestor antes da emissão (reaproveita a alçada existente; sem criar limite financeiro novo).
5. **Fila e tela do aprovador:** lista de pendências (solicitante, tipo, proposta, idade, justificativa), tela de decisão com aprovar/rejeitar + justificativa. O aprovador **não** vê custo/margem (consistente com o ADR do doc 15).
6. **Separação de funções:** quem solicitou não pode aprovar a própria solicitação. O `admin` não decide (já definido).
7. **Auditoria:** solicitação, decisão e justificativa em trilha append-only, com dono da proposta e versão.
8. **Invalidação:** mudança material após a aprovação invalida apenas a aprovação afetada, com nova solicitação (brief §4).

**Dependência cruzada:** o aprovador, sob G-002, precisa ler a proposta e sua solicitação fora do dono. Isso é coberto pela assunção G-002 §1 (leitura de propostas já submetidas) e deve ser limitado à solicitação em análise.

## Ordem de implementação (evita conflito de arquivos)
1. Rodada 2 do fullstack (G-013, G-016 e menores) — em fila.
2. G-002 (guard por dono + reatribuição por admin) — **IMPLEMENTADO-PENDENTE-REVISÃO**.
3. G-006 (solicitações, estado, fila e tela do aprovador) — **IMPLEMENTADO-PENDENTE-REVISÃO**.
4. G-001-A (cotação no servidor, ADR doc 15) — depende do RBAC estável.
Guardian revisa após cada bloco; só ele marca VERIFIED.


## Rodada 3 — correções do Guardian (PENDENTE-REVISÃO; Guardian marca VERIFIED)
- **G-023 (DECISION):** invalidar a pendência em edição material de QUALQUER kind + 409 `approval_pending` em edição não material. Escolhido por preservar o comportamento já revisado (invalidação por material) e fechar o bypass sem novo estado. Alternativa descartada: bloquear toda edição (quebraria o "retirar pedido editando" da §5.2).
- **G-024:** atomicidade e pré-condições no repositório (doc 10 §Rodada 3). **G-025:** apenas bloqueio; ASSUMPTION/CONFLICT de reabertura pós-emissão registrados (sem fluxo novo). **G-027..G-030:** doc 10.
- **Não implementados (inalterados):** G-001-A e G-026 (alerta de margem depende do G-001-A) — continuam OPEN/CONFLICT e bloqueiam o release.
