# Fase 3 — RBAC, esteira Negócios→P&T e persistência (prompt §5, §6, §7, §8, §12)

> Status: **em implementação**. **Atualização: 4 perfis + atribuição individual + P75/P90 IMPLEMENTADOS, ver §9 e §10 (superam §1.3 e §4).** Este documento é o contrato de execução da Fase 3. Decisões marcadas
> **PENDENTE** dependem de aprovação (comercial ou de segurança) e não são tratadas como validadas.

## 0. Ponto de partida (o que já existe)

- **Opção B** entregue: `@bondly/auth-proxy` (Web Service Node) com Google SSO + PKCE, autorização
  **estrita por domínio**, sessão HMAC stateless (cookie `bondly_sess`, 8h), gate de borda.
- **NÃO existe** hoje: conceito de papel (RBAC), persistência server-side, APIs de proposta, esteira.
- A sessão carrega só `email/name/picture/domain/exp`.

## 1. Decisões de arquitetura

### 1.1 Persistência — camada de dados ABSTRATA (decisão do usuário)
Repositório com **interface única** (`ProposalRepository`, `AuditRepository`), implementação inicial
**SQLite** via `node:sqlite` (nativo do Node 22 — sem dependência nativa extra), trocável por Postgres
sem tocar as rotas. Na Render exige um **Disk** (persistente) montado; o caminho vem de `DATA_DIR`
(default `./data` em dev). Em teste, implementação **in-memory** do mesmo contrato.

> **Fail-closed (G-003):** em produção (G-013: qualquer `NODE_ENV` fora da allowlist `{development,test}`, inclusive ausente) `createRepository` LANÇA se `DATA_DIR`
> faltar ou o SQLite falhar, e o servidor sai com código 1; o fallback em memória só vale fora de produção ou
> com `ALLOW_EPHEMERAL_REPO=true` (NÃO para produção real). `/healthz` expõe `repo` e responde 503 em memória-em-prod sem opt-in.
> **Outras regras (revisão Guardian, docs/14):** limites de texto centrais (`limits.ts`: 500 chars; pausa livre 200, não agregada;
> motivos agregados vêm de catálogo fechado `reasonCode`); `GET /meetings` exige `proposal.see_internal`; decisão do approver
> idempotente (mesmo resultado 200, conflitante 409; sem efeito na esteira); e-mail atribuível ASCII estrito; `assignment_audit`
> com triggers append-only; `/api/*` com `no-store`/`nosniff`, checagem Sec-Fetch-Site/Origin em métodos mutantes (sem Origin ⇒ permitido, ferramenta não-browser) e `Content-Type: application/json` (415); corpo >256 KB ⇒ 413;
> bundle do SPA e `.map`: sem sourcemaps no build, bundle só para quem tem perfil.

> **Status: IMPLEMENTADO.** `sqliteRepository.ts` grava `DATA_DIR/bondly.db` (WAL), com lock otimista
> no próprio SQL e auditoria append-only. `createRepository(env)` escolhe o backend: **SQLite quando
> `DATA_DIR` está setado**, senão **in-memory** (dev/teste). O `render.yaml` monta um Disk de 1 GB em
> `/var/data` e aponta `DATA_DIR=/var/data`. `node:sqlite` é carregado via `createRequire` para
> escapar da transformação do bundler; é experimental no Node 22 (emite ExperimentalWarning). Trocar
> por `better-sqlite3`/Postgres é reimplementar `ProposalRepository`, sem tocar `api.ts`/`server.ts`.

### 1.2 Hash dos códigos de perfil — scrypt nativo (§7.3)
O §7.3 pede **Argon2id**. Para não adicionar dependência nativa (build toolchain na Render) usamos
**scrypt** (`node:crypto`, memory-hard, com sal aleatório por código e parâmetros adequados) atrás de
uma interface `PasswordHasher`. Argon2id continua sendo a **preferência**; a interface torna a troca
trivial se o `argon2` for aprovado como dependência. **Decisão de parâmetro/algoritmo: PENDENTE** de
sign-off de segurança; o default scrypt é seguro e não bloqueia a entrega.

### 1.3 Papéis e o 2º fator (§6/§7.2)
Dois papéis: **`business`** (Negócios) e **`tech`** (Projetos & Tecnologia). Um 3º papel **`admin`**
é reservado para administração de usuários/credenciais/políticas (§6.1 última linha) — **não** editável
pelos dois papéis operacionais.

O 2º fator é um **código de desbloqueio de perfil** (§7.2), validado no servidor, que eleva a sessão
já autenticada por Google a um papel. **Não substitui** o SSO nem identidade individual (§7.2): a
auditoria amarra sempre o papel ao e-mail Google. Códigos ficam só como **hash** (scrypt) em `DATA_DIR`
ou env, nunca em texto puro, nunca no bundle.

Fluxo: Google SSO (como hoje) → tela de código de perfil → `POST /api/profile/unlock {role, code}` →
servidor valida o hash, grava `role` na sessão (novo campo assinado) → acesso liberado conforme RBAC.

### 1.4 RBAC — decisão PURA + enforcement no servidor (§6)
`authorize(action, role)` é uma função pura e exaustivamente testável (como `authz.ts`). TODA rota
`/api/*` sensível chama o enforcement **no servidor**; o React nunca é a fronteira. Payloads das APIs
são **filtrados por papel** na origem (§8): Negócios nunca recebe custo/margem/breakdown técnico.

### 1.5 Esteira Negócios→P&T — máquina de estados server-side (§5)
Estados: `rascunho_comercial → aguardando_analise_tecnica → em_analise_tecnica →
ajustes_solicitados | aprovado_tecnicamente | reprovado → pronto_para_emissao → emitido`.
Transições válidas definidas numa tabela pura; cada transição valida papel + estado atual no servidor
e grava **auditoria**. Aprovação vincula-se a um **snapshot** da proposta (reusa `createProposalSnapshot`
do engine). Mudança material (módulos, volumes, integrações, horas, descontos, condições) **invalida**
aprovações afetadas e retorna ao estado apropriado (§5.2). Concorrência: cada proposta tem `version`
(optimistic locking) — escrita com versão defasada é recusada (§5.2).

## 2. Modelo de dados (contrato do repositório)

```
Proposal {
  id            BONDLY-2027-NNNNNN
  version       int            # optimistic lock
  status        WorkflowState
  ownerEmail    string         # Negócios que criou
  commercial    PricingInput (parte comercial)   # entradas de Negócios
  technical     TechnicalInput?                   # entradas de P&T (horas, integrações, complexidade)
  snapshot      ProposalSnapshot?                 # congelado na aprovação
  createdAt, updatedAt
}
AuditEntry { id, proposalId, actor(email), role, action, fromState?, toState?, note?, at }
```

As entradas financeiras seguem no Pricing Engine (fonte única §8); o repositório guarda inputs, estado,
snapshot e histórico — não duplica regra de cálculo.

## 3. APIs (todas atrás do gate de sessão + RBAC)

| Rota | Método | Papel | Retorno filtrado |
|---|---|---|---|
| `/api/me` | GET | qualquer sessão | identidade + papel atual |
| `/api/profile/unlock` | POST | sessão sem papel | eleva a sessão ao papel (valida código) |
| `/api/proposals` | GET | business, tech | lista (campos conforme papel) |
| `/api/proposals` | POST | business | cria rascunho comercial |
| `/api/proposals/:id` | GET | business, tech | business: sem custo/margem; tech: completo |
| `/api/proposals/:id/commercial` | PUT | business | edita inputs comerciais (optimistic lock) |
| `/api/proposals/:id/technical` | PUT | tech | edita inputs técnicos (horas/integrações) |
| `/api/proposals/:id/transition` | POST | conforme matriz | muda estado + auditoria |
| `/api/proposals/:id/audit` | GET | business (resumo), tech (completo) | histórico |

Negação: 401 sem sessão, 403 sem papel/ação, **404 para proposta fora do escopo (G-002, §9.1)**. Nenhum payload completo vai para Negócios para “esconder
no front” (§8).

## 4. Matriz RBAC inicial (§6.1 — refinável)

| Ação | business | tech | admin |
|---|---|---|---|
| Criar/editar inputs comerciais | ✎ | 👁 | 👁 |
| Editar desconto por tier (3–7%) | ✎ | 👁/valida | 👁 |
| Ver preços/Setup/TCV | ✔ | ✔ | ✔ |
| Editar integrações/complexidade/horas | solicita | ✎ | 👁 |
| Ver custo interno/margem/breakdown técnico | ✗ | ✔ | ✔ |
| Validar tecnicamente / parecer | ✗ | ✔ | 👁 |
| Transição para emitido | ✔ (pós-aprovação) | conforme política | 👁 |
| Administrar usuários/credenciais/políticas | ✗ | ✗ | ✔ |

## 5. Plano incremental (cada passo compila, testa e tem CI verde)

1. **Papéis + RBAC puro** (`roles.ts`, `rbac.ts`) + testes de bypass. Sessão ganha `role?`.
2. **2º fator** (`profileCodes.ts` com `PasswordHasher` scrypt) + `POST /api/profile/unlock` + testes
   (código certo/errado, brute-force/rate-limit, papel na sessão).
3. **Repositório abstrato** (`repository.ts` interface + `sqliteRepository.ts` + `memoryRepository.ts`)
   + testes do contrato.
4. **APIs de proposta filtradas por papel** + testes de payload por papel (Negócios não vê custo).
5. **Máquina de estados da esteira** (`workflow.ts` puro) + `/transition` + auditoria + invalidação por
   mudança material + optimistic lock + testes.
6. **UI**: stepper por fase, tela de código de perfil, visões segregadas consumindo as APIs.
7. **Deploy**: `render.yaml` com Disk + `DATA_DIR`; doc de operação; migrações/backup/rollback.

## 6. Critérios de aceite cobertos (§14)

Permissões restringem **dados e ações no servidor** (não só visual); Google SSO preservado; os 2
códigos validados com segurança sem substituir identidade; nada confidencial antes de autorização;
aprovações auditáveis e invalidadas por mudança relevante; Render preservado (Web Service + Disk).

## 7. Operação (Render) — configuração real

### Variáveis de ambiente (painel Render → Environment)
| Var | Papel |
|---|---|
| `ALLOW_EPHEMERAL_REPO` | `false` (default). `true` permite memória em produção — NÃO para produção real (G-003) |
| `LEGACY_PROFILE_CODES_ACK_INSECURE` | `false`. Necessário para `LEGACY_PROFILE_CODES=true` em produção; inseguro por design (G-008) |
| `DATA_DIR` | `/var/data` — raiz do SQLite no Disk persistente (já no `render.yaml`) |
| `PROFILE_CODE_HASH_BUSINESS` | hash scrypt do código de Negócios (secret, `sync:false`) |
| `PROFILE_CODE_HASH_TECH` | hash scrypt do código de P&T (secret, `sync:false`) |
| `PROFILE_CODE_HASH_ADMIN` | hash scrypt do código de admin (opcional) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `SESSION_SECRET` / `PUBLIC_URL` | como na Fase anterior |

### Gerar um hash de código (nunca commitar o código em texto puro)
```bash
# Opção A — script standalone (não exige build prévio); replica o scryptHasher do servidor:
node scripts/gen-profile-hash.mjs 'O-CODIGO-REAL'

# Opção B — a partir do módulo buildado do auth-proxy:
node --input-type=module -e "import('./apps/auth-proxy/dist/profileCodes.js').then(m=>console.log(m.scryptHasher.hash(process.argv[1])))" 'O-CODIGO-REAL'
```
Ambas produzem o formato `scrypt$N$r$p$salt$derived` que o `verifyProfileCode` do servidor aceita.
Cole o hash resultante na env var correspondente (`PROFILE_CODE_HASH_BUSINESS` / `_TECH` / `_ADMIN`)
no painel da Render. Um papel SEM hash configurado fica inatingível pelo 2º fator (deny-by-default).
Gere um código por papel — o código de um papel **não** desbloqueia outro.

### Disk e backup
O `render.yaml` monta um **Disk** de 1 GB em `/var/data` (`DATA_DIR`). É **single-instance** (o Disk
não é compartilhado entre réplicas) — adequado ao volume de propostas de uma equipe comercial. Backup:
snapshot do Disk pela Render, ou cópia de `bondly.db` via `VACUUM INTO`. Migração para Postgres:
implementar `ProposalRepository` sobre o driver pg e trocar o factory `createRepository`.

## 8. O que permanece PENDENTE (não inventado)

- Valores/algoritmo final do hash (Argon2id vs scrypt) — sign-off de segurança.
- Os **códigos de perfil** reais (definidos pelo admin, nunca no repositório/bundle).
- Política fina da matriz RBAC após auditoria das necessidades reais.
- Escolha final SQLite vs Postgres (interface já isola).

## 9. Quatro perfis, atribuição individual e status (brief do sponsor §10/§11)

**Status: IMPLEMENTADO e testado** (typecheck + testes; NÃO verificado em deploy real nem com Google real).
As seções 1.3 e 4 acima descrevem o desenho original (3 papéis, código compartilhado) e estão SUPERADAS por esta seção.

Perfis: `business` Negócios · `tech` Projetos & Tecnologia · `approver` Gestor/Aprovador · `admin` Administrador.

| Ação | business | tech | approver | admin |
|---|---|---|---|---|
| proposal.create / edit_commercial / edit_tier_discount / emit | ✔ | — | — | — |
| proposal.read | ✔ | ✔ | ✔ | ✔ |
| proposal.edit_technical / validate_technical | — | ✔ | — | — |
| proposal.see_internal (inputs técnicos/snapshot) / read_audit_full | — | ✔ | — | ✔ |
| sla.manage (pausar/retomar/concluir, reunião) | — | ✔ | — | ✔ |
| sla.view_indicators (P75/P90, sem custo/margem) | — | ✔ | ✔ | ✔ |
| approval.decide (exceção comercial, escopo, replanejamento) | — | — | ✔ | — |
| **proposal.reopen** (G-025: reabre proposta `emitido` ⇒ nova versão) | — | — | ✔ | ✔ |
| sla.configure | — | — | — | ✔ |
| admin.manage_users (atribuições + auditoria) | — | — | — | ✔ |
| **admin.reassign_owner** (G-002: troca o dono da proposta + auditoria) | — | — | — | ✔ |
| **pricing.quote** (G-001-A: cotação no servidor; visão projetada por perfil) | ✔ (commercial) | ✔ (internal) | ✔ (commercial) | ✔ (internal) |

> **pricing.quote (G-001-A):** todos os 4 papéis cotam, mas a **visão** é projetada no servidor pela ação `proposal.see_internal`: business/approver recebem `commercial` (sinal de política, sem custo/margem); tech/admin recebem `internal`. Pedir visão acima do direito ⇒ 403 `view_forbidden`. Contrato `quote.v1` em [doc 03 §QuoteView](./03-contratos-de-dados.md). Gate de emissão G-026 (`emissionGate`) usa o mesmo `marginStatus` do engine.

Matriz exaustiva (4 × 18 ações) em `apps/auth-proxy/src/rbac.test.ts`. Sem perfil atribuído: 403 `profile_required` em todas as APIs de negócio (`/api/me` segue 200 com `role:null`). Enforcement sempre no servidor.

> **G-025 — reabertura pós-emissão (fluxo/estado):** `POST /api/proposals/:id/reopen { reason }` só em proposta `emitido` (outro estado visível ⇒ 409 `not_issued`; rascunho ⇒ 404 por escopo G-002), só `approver`/`admin` (`proposal.reopen`; business/tech ⇒ 403), `reason` obrigatório (limite central 500, normalizado; vazio/invisível ⇒ 400 `reason_required`). Cria uma **NOVA VERSÃO**: id próprio `BONDLY-2027-NNNNNN` (via `nextSequence`), estado inicial `rascunho_comercial`, `version=1`, herda `ownerEmail` (o approver NÃO vira dono) e os inputs comercial/técnico (cópia dos dados, **não** do snapshot), `reopenedFrom = id-origem`. A emitida permanece `emitido`, com mesma version/commercial/technical/snapshot, e ganha só `supersededBy = id-nova`. Auditoria append-only (`reopen` na nova, `reopen.superseded` na origem) na mesma transação. A nova versão percorre a esteira normalmente: reanálise por mudança material (G-023) e gate de margem na emissão (G-026) **sem bypass**. Testes em `apps/auth-proxy/src/reopen.test.ts` (memória + SQLite, migração aditiva).

### ASSUMPTIONs (reversíveis; não são requisitos aprovados)
1. **Atribuição individual** user_email→role em tabela do repositório (SQLite `role_assignments` + in-memory), gerida SÓ por admin via `PUT /api/admin/assignments`, com auditoria append-only (`assignment_audit`: quem/quando/de/para). E-mail precisa estar em domínio autorizado (igualdade exata). Não é possível remover/rebaixar o último admin (409).
2. **Perfil resolvido do repositório a cada request**, não embutido no cookie: o cookie é stateless de 8h, então embutir o papel atrasaria a revogação em até 8h. Custo: uma leitura indexada por request.
3. **Bootstrap**: `BOOTSTRAP_ADMIN_EMAILS` (lista, validada contra domínios autorizados, sem segredo) cria admin no boot SOMENTE se não existir admin; auditado com ator `bootstrap:env`. Depois é ignorado.
4. **Fluxo de código de perfil = DEPRECATED**, atrás de `LEGACY_PROFILE_CODES=true` (default false). Nunca concede `approver`; um admin obtido por código NÃO gere atribuições. Com a flag desligada, `/api/profile/unlock` responde 403 e o papel no cookie é ignorado.
5. **approver sem `proposal.see_internal`** (menor privilégio): vê a proposta como Negócios (resumo técnico). Se o sponsor quiser que o Aprovador veja margem para decidir, é mudança explícita de matriz.
6. **Decisão do aprovador**: `POST /api/proposals/:id/approval {decision, kind, note}` só registra auditoria append-only (`approval.<decisão>.<tipo>`), SEM alterar o estado da esteira (não há spec de workflow de exceções). Integração com a máquina de estados: PENDENTE.
7. **Admin** não tem `approval.decide` (segregação de funções) nem edita proposta.

### CONFLICT / limitação registrada
- Os valores financeiros (custo/margem) são calculados no cliente a partir dos inputs comerciais (`projection.ts`); o servidor entrega os mesmos inputs comerciais a todos os perfis que leem propostas. Logo, "Negócios não vê margem" é garantido no servidor apenas para inputs técnicos, snapshot, notas de auditoria e indicadores. O cálculo de margem no browser segue sendo UI (motor no servidor, a Opção A, fecharia isso).

### 9.1 Escopo de visibilidade por dono (G-002 — DECISÃO do sponsor, docs/16) — IMPLEMENTADO-PENDENTE-REVISÃO
Regra única (`apps/auth-proxy/src/scope.ts`, aplicada por `visible()`/listagem em `api.ts` e, nas escritas, por `requireOwner` no `repo.update`):
- **business**: só propostas com `ownerEmail` == próprio e-mail normalizado (minúsculas/trim). Dono vazio/legado ⇒ ninguém além do admin.
- **tech / approver**: só propostas **fora do rascunho** (`status != rascunho_comercial`, i.e. ≥ `aguardando_analise_tecnica`). Rascunho ⇒ 404. Nenhuma escrita nova (a matriz de ações não mudou, exceto a nova ação admin).
- **admin**: lê todas (sem ganhar escrita).
- Fora do escopo ⇒ **404** `not_found`, idêntico ao de id inexistente, + log `rbac_denied` (`reason: owner_scope`, ator por pseudônimo HMAC; sem e-mail em claro). A checagem de **ação** (403) vem antes e independe do recurso, então 403 não revela existência.
- Cobre: lista, GET, audit, commercial, technical, transition, sla (GET/pause/resume/complete), meetings (GET/POST/transition), approval, e a rota admin de dono. Listagem filtrada no servidor; resposta é só `{proposals}` (sem total/paginação).
- **Reatribuição**: `GET|PUT|POST /api/admin/proposals/:id/owner` (`admin.reassign_owner`; só admin com **atribuição individual**, não legado). Body `{ownerEmail, version?}`; e-mail ASCII estrito de domínio autorizado (mesma regra de `PUT /api/admin/assignments`) senão 400 `email_not_allowed`. Grava `owner_audit` (id, proposal_id, actor, from, to, at; append-only por trigger) e incrementa `version` na MESMA transação.
- **Migração (aditiva)**: `owner_audit` criada `IF NOT EXISTS`; coluna `owner_email` ausente em bancos muito antigos é adicionada vazia (⇒ só admin enxerga até reatribuir).
- **Limitações conhecidas**: sem colaboração entre colegas de Negócios (decisão do sponsor); IDs `BONDLY-AAAA-NNNNNN` são sequenciais globais, logo o ID da própria proposta nova sugere o volume total (residual; sem mudança de formato nesta rodada).
- ASSUMPTIONs: reatribuir ao mesmo dono = no-op 200 `changed:false` (sem auditoria/bump); `version` opcional no body; ex-dono com versão defasada recebe 404 (não 409).

## 10. Indicadores P75/P90 (ver doc 11 §9)
`GET /api/sla/indicators` (tech/approver/admin; 403 para business e sem perfil), calculado pelo engine puro (`packages/pricing-engine/src/sla/indicators.ts`).


## 11. G-006 — Gestor/Aprovador funcional (IMPLEMENTADO-PENDENTE-REVISÃO; só o Guardian marca VERIFIED)

**11.1 Matriz (ações novas):** `approval.request` = business, tech · `approval.read_queue` = approver · `approval.decide` = approver (admin NÃO decide). Teste exaustivo 4 papéis × 3 ações em `approvals.test.ts`; matriz geral em `rbac.test.ts` (18 ações, incl. G-025 `proposal.reopen`).

**11.2 Estados/tabela pura (`workflow.ts`):** novo estado `aguardando_aprovacao_gestor`, alvo só de `canRequestApproval` (estados de origem: aguardando_analise_tecnica, em_analise_tecnica, ajustes_solicitados, aprovado_tecnicamente, pronto_para_emissao — **nunca rascunho**, para o aprovador jamais ler rascunho). Nenhuma transição comum parte dele. Aprovado e rejeitado voltam ao estado anterior (`resolveApprovalState`). Visível no stepper da UI.

**11.3 API:** `POST /api/proposals/:id/approval-requests {kind, justification, version}` (201) · `GET /api/proposals/:id/approval-requests` · `GET /api/approvals/pending` (fila filtrada no servidor; só metadados + justificativa, sem custo/margem/commercial) · `POST /api/approval-requests/:id/decision {decision, justification}` (201 / 200 idempotente / 409 conflito ou `approval_invalidated`). Fora do escopo ⇒ 404 padrão. Solicitante ≠ decisor ⇒ 403 `self_decision_forbidden`. Rota legada `POST /proposals/:id/approval` (G-018) mantida, sem efeito na esteira.

**11.4 Persistência/auditoria:** tabela `approval_requests` (migração aditiva; índice único parcial = 1 pendente por proposta; decisão por `UPDATE … WHERE status='pending'`; decididas imutáveis e sem DELETE por trigger). Solicitação/decisão + mudança de estado + `audit` na MESMA transação (`BEGIN IMMEDIATE`; teste de rollback com trigger sabotador). Ações de auditoria `approval_request.{requested,approved,rejected,invalidated}.<kind>`. Logs `rbac_approval_*` com pseudônimo, sem justificativa.

**11.5 Alerta de margem — CONFLICT (não implementado):** exigir decisão do aprovador antes de `emitido` quando a exceção gerar alerta de política depende de o servidor calcular a alçada (`discountAuthority`/`calculate`) — hoje a cotação roda só no cliente (G-001-A, doc 15). Confiar em flag do cliente seria burlável e criar limite novo é vedado. **PENDENTE para depois de G-001-A.** Sem esta ligação, `emitir` NÃO é bloqueado por exceção rejeitada/ausente (só por solicitação pendente, que trava toda a esteira).

**11.6 Invalidação:** no ponto existente de `isMaterialChange` (PUT commercial/technical): comercial invalida `excecao_comercial` + `alteracao_escopo`; técnica invalida `alteracao_escopo` + `replanejamento_sla` (pending/approved ⇒ `invalidated`; nova solicitação necessária). Pendente invalidada devolve a proposta ao estado anterior (e aplica `invalidationOnEdit` a partir dele). Limite honesto: a invalidação roda logo APÓS o update da proposta (2 transações); falha entre elas deixaria a aprovação válida.

**ASSUNÇÕES/DESVIOS:** (a) justificativa obrigatória na REJEIÇÃO; na aprovação é opcional (spec literal; a rota legada exigia sempre); (b) no máximo 1 solicitação pendente por proposta; (c) mapeamento tipo→edição que invalida é ASSUMPTION; (d) “exceção vinculada ao snapshot” = `decidedProposalVersion` na solicitação (não altera o JSON do snapshot); (e) o aprovador não lê solicitações já decididas por tela (só a fila `pending`; o histórico por proposta via `GET …/approval-requests`, no escopo G-002); (f) G-021: tech/approver mantêm só o HISTÓRICO (SLA, auditoria, reuniões) de proposta submetida que voltou ao rascunho via `retomar`; corpo/escrita seguem 404; (g) G-021/G-022: reatribuição exige `version` e novo dono com perfil `business`.


## Rodada 3 (G-023..G-030) — decisões de implementação

**G-023/G-024 (DECISION):** com solicitação PENDENTE (qualquer kind), edição **material** (comercial por business ou técnica por tech) **invalida** a pendência (`INVALIDADA`, auditada) e devolve a proposta para a reanálise calculada sobre o estado ANTERIOR à solicitação (`statusAfterMaterialEdit`: comercial → `aguardando_analise_tecnica`, técnica → `em_analise_tecnica`); a decisão posterior responde 409 `approval_invalidated`. Edição **não material** com pendência ⇒ **409 `approval_pending`** (nada muda sob análise do Gestor). Tudo em `repo.editProposal` (update + invalidação + auditoria numa transação `BEGIN IMMEDIATE`). `decideApprovalRequest` confere, dentro da transação, solicitação ainda `pending`, proposta em `aguardando_aprovacao_gestor` e `version == proposalVersion + 1` (senão 409 `approval_stale`); a reatribuição de dono com pendência avança a versão referenciada (dono não é mudança material).
**G-025:** proposta `emitido` ⇒ PUT comercial/técnico 409 `proposal_issued_immutable`. **ASSUMPTION:** não existe fluxo de reabertura/nova versão pós-emissão — nada foi inventado; só bloqueio. **CONFLICT (sponsor):** definir fluxo de revisão do emitido e estados editáveis dos demais (rascunho/ajustes/em análise) — não alterado.
**G-027:** `checkText` normaliza texto livre (controles C0/C1 removidos; espaços Unicode e `\p{Cf}` aparados das pontas; ZWJ interior preservado) ⇒ só-invisíveis = vazio.
**G-028:** triggers append-only também em `audit`; `BEFORE INSERT … WHEN EXISTS(id)` aborta `INSERT OR REPLACE` em `audit`, `owner_audit`, `assignment_audit`, `approval_requests`; `PRAGMA recursive_triggers=ON`. Migração aditiva (`IF NOT EXISTS`). Fora de escopo: `approval_decisions` (usa `ON CONFLICT DO NOTHING`, incompatível com BEFORE INSERT) e `sla_events`.
**G-029:** `PRAGMA busy_timeout=5000` (padrão) + retry limitado (2) por método; lock persistente ⇒ **503 `storage_busy`**. A recomendação segue **instância única** (disco único); isto é mitigação, não suporte multi-writer.
**G-030:** `SESSION_SECRET` em produção: ≥ 32 chars, ≥ 16 distintos, Shannon ≥ 3,5 bits/char, sem run ordenado > 5 (alfabeto/dígitos/teclado) nem palavras fracas. Aceita `openssl rand -base64url 48`/`generateValue` do Render. Hex puro de 32 chars (≤ 16 distintos) pode ser recusado: usar base64.
