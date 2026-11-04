# SLA técnico de 5 dias úteis + reunião técnica (prompt §6, §9.10)

> Status: **implementado e validado** (engine + auth-proxy + UI, CI verde). Este documento é o
> contrato de execução do Eixo 4 (SLA) e registra as decisões **congeladas** que o prompt §6 exigia
> documentar, a operação e os casos de teste.

## 0. Objetivo

O time de Projetos & Tecnologia (P&T) deve emitir um **parecer técnico** (aprovado / aprovado com
ressalvas / ajustes necessários / inviável) em **no máximo 5 dias úteis de tempo efetivo** sob sua
responsabilidade, contados a partir de um briefing comercial completo e encaminhado. Não é garantia
de entrega do projeto ao cliente — é o prazo do parecer.

## 1. Decisões CONGELADAS (§6.2 exige convenção única e documentada)

| Decisão | Valor adotado | Observação |
|---|---|---|
| **Contagem** | **Dias úteis corridos** (não horas de expediente) | "5 dias úteis" = 5 datas que não sejam sáb/dom/feriado. Simples e auditável. |
| **Fuso** | **America/Sao_Paulo** | Toda aritmética é sobre a data civil SP derivada do instante UTC — independe do fuso do servidor (Render roda em UTC). |
| **Feriados** | **Nacionais BR** (legislação federal), 2026-2028, configurável | `buildHolidaySet(extras)` acrescenta feriados do calendário corporativo (ex.: Carnaval, municipal). Carnaval/Corpus Christi NÃO entram por padrão (facultativos federais). |
| **Prazo padrão** | **5 dias úteis** | Configurável só por admin (ação RBAC `sla.configure`), com trilha de auditoria. |
| **Limiar "Atenção"** | **1 dia útil restante** | §6.2. |

## 2. Modelo — estado DERIVADO de eventos (não armazenado)

O estado do relógio é **sempre derivado** de eventos append-only via `reduceSla()` do pricing-engine
— não há estado duplicado que possa divergir. Eventos: `started`, `paused`, `resumed`, `completed`.

- **started**: disparado automaticamente na transição `submeter_analise` (Negócios → fila técnica).
  Marco inicial §6.1. Idempotente: só o primeiro vale.
- **paused**: só com relógio em andamento; exige justificativa (`reason`). Não retroage, não apaga
  tempo consumido. §6.4.
- **resumed**: retoma com o SALDO restante; nunca reinicia os 5 dias. §6.4.
- **completed**: congela o relógio e registra o parecer (`verdict`). `metSla` = consumido ≤ 5.

"Tempo efetivo" = dias úteis decorridos apenas nos intervalos ativos (fora de pausa).

### Estados do relógio
`nao_iniciado → em_andamento ⇄ pausado → concluido`. Saúde exibida: **No prazo / Atenção / Vencido /
Pausado / Concluído**.

## 3. Reunião técnica com o cliente (§6.3) — etapa CONDICIONAL

Máquina de estados própria (`sla/meeting.ts`), 7 estados:

`solicitada → em_agendamento → agendada → realizada → aguardando_insumos → insumos_recebidos →
avaliacao_retomada`, + `cancelada` (de qualquer estado não-terminal, com justificativa).

**Regra crítica (§6.4): solicitar/agendar uma reunião NÃO pausa o SLA automaticamente.** O endpoint
responde `slaUnaffected: true` e nenhum evento de pausa é emitido. A pausa é ação separada e
explícita, só quando a reunião/resposta do cliente for de fato indispensável para avançar.

## 4. RBAC (§6)

| Ação | business | tech | admin |
|---|---|---|---|
| `sla.manage` (pausar/retomar/concluir, operar reunião) | — | ✓ | ✓ |
| `sla.configure` (prazo/calendário) | — | — | ✓ |

Negócios **não** controla o relógio nem conduz a avaliação técnica; vê status, previsão e pendências
(§6.6). O enforcement é no servidor; a UI apenas reflete.

## 5. Endpoints (`/api/proposals/:id/...`)

| Método | Rota | Papel | Efeito |
|---|---|---|---|
| GET | `/sla` | read | Estado derivado do relógio |
| POST | `/sla/pause` | sla.manage | Pausa (exige `reason`); 409 se não em andamento |
| POST | `/sla/resume` | sla.manage | Retoma; 409 se não pausado |
| POST | `/sla/complete` | sla.manage | Parecer (exige `verdict`); congela |
| GET | `/meetings` | read | Lista reuniões |
| POST | `/meetings` | sla.manage | Solicita reunião (exige `objective`); **não pausa o SLA** |
| POST | `/meetings/:mid/transition` | sla.manage | Avança/cancela (cancelar exige `note`) |

Persistência: tabelas `sla_events` (append-only) e `meetings` (log em JSON) no SQLite (Disk da Render
via `DATA_DIR`); in-memory em dev/teste. Eventos sobrevivem a restart — provado.

## 6. Operação (produção na Render)

- O SLA é feature do **Web Service** (não do preview estático, que não tem backend).
- Requer **Disk + `DATA_DIR`** para persistir os eventos (igual às propostas). No plano Free sem Disk,
  o SLA roda in-memory e **não sobrevive a reinícios** — aceitável só para validação.
- Para alterar o prazo ou o calendário de feriados: só `admin`, com trilha de auditoria (ação
  `sla.configure`; a UI de configuração é trabalho futuro — hoje o default de 5 dias é fixo em código
  e os feriados vêm de `buildHolidaySet`).

## 7. Casos de teste (§6.7) — cobertura

**Unidade (pricing-engine, `tests/sla.test.ts` + `tests/meeting.test.ts`):**
1. Dia útil vs fim de semana vs feriado; data civil SP perto da meia-noite UTC.
2. Contagem atravessando fim de semana e feriado configurado.
3. started inicia o relógio; sem started não conta (§6.7.1-2).
4. Conclusão dentro / fora de 5 dias úteis → `metSla` (§6.7.8).
5. Pausa não retroage; retomada preserva o saldo, não reinicia (§6.7.4, §6.7.7).
6. Limiares de status (no_prazo / atenção / vencido).
7. Reunião: fluxo feliz completo, cancelamento, deny-by-default em estados terminais.

**API (auth-proxy, `src/slaApi.test.ts`):** start automático no handoff, idempotência, RBAC nega
business, `reason`/`verdict` obrigatórios, pausa→retomada, guards de fase (409), reunião não pausa.

**Smoke e2e (`scripts/smoke-sla.mjs`):** servidor real + SQLite — submeter → sla → pause → resume →
reunião (não pausa) → complete, + RBAC. 10/10 checks, `metSla=true`.

## 8. Pendências explicitadas (não inventadas — §6, §10k)

- **UI de configuração do SLA** (prazo/feriados por admin) — hoje o default de 5 dias é fixo em código;
  a ação RBAC `sla.configure` já existe para quando a tela for construída.
- **Alertas ativos** (ex.: "resta 1 dia útil") — o status é exibido, mas disparo de notificação
  depende de infraestrutura de canais; não alegamos envio que não existe (§6.2).
- **Métricas de tempo mediano/calendário total** no painel — o painel §6.6 traz os agregados
  essenciais (em análise/pausadas/vencidas/concluídas/% no prazo); histogramas são refino futuro.

## 9. Indicadores de gestão P75/P90 (tempo útil efetivo)

Implementado em `packages/pricing-engine/src/sla/indicators.ts` (puro, exportado, testado em `tests/slaIndicators.test.ts`). Não altera `reduceSla`, calendário nem regras de pricing.

- **Amostra**: propostas com SLA `started` + `completed`. Em andamento ou pausadas ficam fora.
- **Métrica principal**: **tempo útil efetivo** = dias úteis consumidos EXCLUINDO pausas (`businessDaysElapsed` do `reduceSla`). **Tempo bruto** (início→conclusão, com pausas) é calculado só como comparativo e rotulado "bruto" na UI.
- **Saída**: `n`, média, mediana, P75, P90 (útil e bruto), `pctWithinSla` (útil ≤ 5 dias úteis) e tempo em pausa por motivo (dias úteis; motivo = texto da pausa com trim).
- **ASSUMPTION, percentil nearest-rank inclusivo**: P(p) = valor na posição `ceil(p·n)` (base 1) da lista ordenada, sem interpolação. n=0 → `null`; n=1 → o próprio valor. Ex.: 1..10 → P75=8, P90=9. **Mediana** = definição clássica (média dos centrais se n é par), também ASSUMPTION. Tolerância de 1e-9 contra erro de ponto flutuante em `ceil(p·n)`.
- **Endpoint**: `GET /api/sla/indicators` (ação `sla.view_indicators`: tech/approver/admin). Payload sem custo/margem/snapshot (testado). Exibido em `SlaDashboard` (`SlaIndicatorsPanel`).
- **Limitação**: o motivo de pausa é texto livre; grafias diferentes viram linhas distintas (catálogo de motivos seria refino futuro). Sem filtro por período.


## 10. G-006 — solicitações ao Gestor NÃO pausam o relógio

O estado `aguardando_aprovacao_gestor` é ortogonal ao SLA: `reduceSla` não foi alterado e criar/decidir/invalidar solicitação não anexa nenhum `sla_event`. Teste (`approvals.test.ts`, memória e SQLite): eventos idênticos antes/depois e `reduceSla` em instante fixo com resultado igual. Pausar continua sendo ação explícita e justificada de P&T (§6.4). G-021: após `retomar`, tech/approver continuam alcançando SLA/auditoria/reuniões da proposta (podem pausar o relógio que segue correndo).
