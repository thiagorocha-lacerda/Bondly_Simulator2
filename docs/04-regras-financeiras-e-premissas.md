# Regras financeiras e premissas (§23.5, §23.6)

Fonte única: `packages/pricing-engine/src/premises/premises.ts` (premissas governadas e versionadas) e
os módulos de `pricing/`, `costs/`, `margins/`, `modules/`. Nenhum valor fixo espalhado pelo código.

## Premissas v15 (governança — §6.1)

Cada premissa carrega **valor, unidade, fonte, data de referência e status**. Versão corrente: `v16`,
`effectiveDate` 2026-11-05, com `hash` de conteúdo imutável. A `v15` (`effectiveDate` 2026-10-01)
permanece congelada e acessível por snapshot — propostas emitidas sob ela reproduzem seus valores e
status originais.

> **DECISION (sponsor/CTO, 2026-11-05):** a política de **desconto por tier** foi ratificada
> exatamente como o motor a implementa (base elegível = Platform Fee do tier ativo; waterfall
> sequencial `PF → ×(1−tier) → ×(1−negociado) → ×(1−prazo)`, não-linear; convive com os descontos
> negociado e por prazo sem substituí-los; limites inclusivos 3%–7%). Por isso `tierDiscountLimits`
> passou de **pendente → validada** na **v16**. Valores min/max inalterados (0,03/0,07) e lógica de
> cálculo inalterada — a mudança é **apenas de governança**.

> **DECISION (sponsor/CTO, 2026-11-05) — Setup fixo −20%:** redução **uniforme de 20%** no Setup fixo
> de **todos os tiers**, gravada como **DEFAULT GOVERNADO e validado** na **v16** via a premissa
> `setupFixedReductionDefault = 0,20`. Os **valores-base de `setup` da tabela de tiers permanecem
> inalterados e rastreáveis** (Starter 40.000 · Growth 60.000 · Scale 100.000 · Enterprise 140.000 ·
> Enterprise+ 180.000) — a redução **não reescreve** os números: o motor a aplica como default quando
> a proposta não informa `negotiation.setupFixedReductionPct`. A **v15 fica congelada sem redução
> (0%)**. Impacto analisado em docs/19 (20% é seguro nos guardrails que o motor avalia;
> `marginStatus` e `SETUP_HOUR_BELOW_MIN_MARGIN` não são afetados). **Follow-up aberto:** cadastrar o
> **custo de implantação por tier** + guardrail de margem do próprio Setup (dono: project-book — ver
> docs/18 §Follow-ups), hoje o motor não calcula margem do Setup.

| Premissa | Valor | Unidade | Status |
|---|---|---|---|
| CleverTap por MAU | 0,0633 | R$/MAU | validada |
| Custo de leitura de NF | 0,12 | R$/nota | validada |
| Infra por transação | 0,1462 | R$/transação | validada |
| Tarifas de comunicação | RCS 0,056 · WhatsApp 0,70 · SMS 0,15 · E-mail 0,15 | R$/comunicação | validada |
| Processing por transação | 0,30 | R$/transação | validada |
| Preço de tabela — dedicado | 35.000 | R$/profissional/mês | validada |
| Hora técnica | 350 | R$/hora | validada |
| Tributos | 11,7% | fração da receita | validada |
| Fee de conversão Minu | 15% | fração do PF (12m) | validada |
| Fee AM/CS Minu | 5% | fração do PF (prazo) | validada |
| Markup de Setup (Minu) | 20% | fração do Setup | validada |
| Margem alvo / piso | 70% / 60% | fração | validada |
| Descontos por prazo | 12→0 · 24→5% · 36→10% | fração sobre PF | validada |
| Corredor de desconto | base 10% · +2,5pp por gatilho · teto 15% | fração | validada |
| **Desconto por tier (editável)** | **3,00%–7,00%** (inclusivo) | fração por tier sobre o PF | **validada (v16)** · _v15: pendente (histórico)_ |
| **Redução default do Setup fixo** | **20%** (uniforme, todos os tiers) | fração do Setup fixo | **validada (v16)** · _v15: 0% (histórico, congelado)_ |
| Markup de campanha | 20% | fração sobre a mídia | validada |
| B2C — fee/mínimo/split | 10% (oficial) · R$2,00 · 50% Minu | — | validada |

Faixas progressivas (`platformFeeBands`, `usageBands`, `tiers`, `complexityBands`, `b2c.antifraudBands`)
reproduzem `PBANDS`/`BANDS`/`TIERS`/`BANDSCX`/Konduto do HTML.

## Regras-chave (prompt §7)

### Platform Fee (progressivo — R-001)
Σ por faixa de usuários: 0,50 ≤25k · 0,485 ≤50k · 0,47 ≤150k · 0,455 ≤250k · 0,445 >250k.
Piso econômico = `cogs/(1−0,60) − usage − proc`. Recomendado/Premium aplicam o markup da banda de
complexidade. Final = escolhido × (1−desc. negociado) × (1−desc. prazo).

### Capacity / recursos dedicados (§7.2 — R-030)
Total Comp de referência **R$ 25.000**, preço-alvo **R$ 35.000**, margem mínima **R$ 5.000**/profissional.
`net = 1 − tributos − repasses`. PMS = `(TC+custos+margemMín)/net`; PCS = tabela quando cobre o PMS,
senão o PMS arredondado; margem = `preço×net − TC − custos`. Avaliado por perfil individualmente.

### Serviços adicionais (§7.3 — R-031)
Hora de referência **R$ 350**, margem mínima **R$ 50/h**. Custo/h = teto de Total Comp ÷ horas
produtivas (160) quando não informado. Horas entram **só no Setup**, nunca na mensalidade.

### Setup redesenhado (§4 — Fase 2) — base fixa configurável + horas + outros
**Setup total (net) = Setup fixo padrão + (Horas × R$ 350/HH) + outros adicionais de Setup.**

- **Setup fixo padrão:** `tier.setup × banda.setupMultiplier`, ajustado pela opção comercial
  (piso ×0,9 · recomendado ×1 · premium ×1,15) e por uma **redução governada**. A redução efetiva é
  `negotiation.setupFixedReductionPct` quando informada na proposta; na ausência, o motor usa o
  **DEFAULT da tabela de premissas ativa** `setupFixedReductionDefault` (**v16 = 0,20 validado**;
  v15 = 0). Os valores-base dos tiers **não são reescritos** — permanecem rastreáveis na tabela.
  Ex. (Growth/recomendado/Padrão): 60.000 → **48.000** na v16; (Starter/piso): 36.000 → **28.800**.
  A flag `SETUP_FIXED_REDUCTION_PENDING` **só sinaliza concessão AD HOC** por proposta **acima do
  default validado** — a redução até o default governado da v16 é aprovada e **não** é pendente; em
  v15 (default 0) qualquer redução volta a ser ad hoc e pendente (legado preservado).
- **Horas de implantação:** `implementationHours × R$/HH` (R$ 350 por padrão, do `services`). Entram
  **exclusivamente no Setup** (§4.1) — nunca na mensalidade, no Capacity Fee ou em custos recorrentes.
  Efeito no TCV ocorre uma única vez, via Setup. Margem mínima de **R$ 50/HH** preservada
  (`hourStatus`; abaixo dela → `SETUP_HOUR_BELOW_MIN_MARGIN`).
- **Outros adicionais de Setup:** `negotiation.setupOtherAdditions` (default 0), somam ao net sem
  tocar a mensalidade.
- **Setup ao cliente:** `net × (via Minu ? 1 + markup : 1)`.
- **Transparência (§4.2):** o resultado expõe `setup` = { fixed, fixedReductionPct, implementationHours,
  hourlyRate, implementationSubtotal, otherAdditions, net, client } — a UI mostra cada componente,
  a mensalidade sem horas e o TCV sem duplicidade.
- **Status (v16):** redução de 20% do Setup fixo **validada** (DECISION sponsor/CTO 2026-11-05,
  `setupFixedReductionDefault`). `setupOtherAdditions` default 0 e a ausência de concessão ad hoc
  mantêm o restante do cálculo. **v15 permanece sem redução (0%)**, reproduzindo o legado bit-a-bit
  (paridade §22 roda contra a v15). **Follow-up:** custo de implantação por tier + guardrail de margem
  do Setup (o motor ainda não calcula margem do Setup) — dono project-book (docs/18 §Follow-ups).

### Tributação Capacity Fee (§7.1)
**11,7%** sobre a base tributável. Imposto = base × 0,117; líquido = base − imposto. Sem dupla tributação.

### Prazos (§7.4 — R-015)
12/24/36 meses → desconto 0/5/10% **só sobre o Platform Fee**. Não incide em Usage, Processing, Setup,
serviços, comunicação nem campanhas.

### Desconto por tier editável (§3 — Fase 1) — **política VALIDADA (v16, sponsor 2026-11-05)**
Nova entrada `negotiation.tierDiscount` (fração). Editável por tier dentro de **3,00%–7,00% inclusivo**
(limites em `premises.tierDiscountLimits`, status `validada` na v16; `pendente` no snapshot histórico
v15). Fonte única: engine e UI leem o mesmo limite via `validateTierDiscountPct`.

- **Base elegível:** incide **exclusivamente sobre o Platform Fee (Capacity Fee)** do tier ativo
  (§3.2.5). Não toca Usage, Processing, Setup, serviços, comunicação, campanha ou B2C.
- **Ordem de aplicação (waterfall §3.2.4):** `PF escolhido → ×(1−descontoPorTier) → ×(1−descontoNegociado)
  → ×(1−descontoPrazo) = PF final`. Descontos **sequenciais sobre a base corrente** — não se somam
  linearmente (5%+5%+5% ≠ 15%), evitando incidência dupla/ambígua.
- **Cumulatividade:** convive com o desconto negociado (corredor/alçada R-017) e o desconto por prazo
  (R-015) **sem** substituí-los. A alçada de aprovação do desconto negociado permanece inalterada.
- **Validação dupla (§3.1):** formulário (inline) **e** engine (`resolveTierDiscount` faz clamp de
  fronteira do contrato público §21). Rejeita `NaN`, negativo, string inválida, fora da faixa e mais de
  duas casas decimais. `0`/ausente = sem desconto por tier (não aplicado).
- **Snapshot (§3.2.8):** o valor por tier é salvo em `negotiation.tierDiscount` e congelado no snapshot
  da proposta; `reopenProposal` reproduz o cálculo histórico mesmo que a tabela global mude.
- **Tributação:** o imposto de 11,7% incide sobre o Core **já com o PF descontado** — sem dupla incidência.
- **Status:** a ORDEM e a cumulatividade acima foram **ratificadas pelo sponsor (CTO) em 2026-11-05**
  exatamente como implementadas; o limite é premissa **validada** na v16. O snapshot histórico v15
  mantém o status `pendente` (reprodutibilidade §27.6). A lógica de cálculo não mudou — ver §3.2.3.


### Assinaturas B2C (§7.5 — R-060..R-063)
Fee = `max(ticket×fee%, mínimo R$2)`. Gateway, antifraude (faixas Konduto progressivas/integral),
tributos 15%. Margem distribuível dividida 50/50 com a Minu nos meses positivos.

### Comunicação (§7.6 — R-006)
RCS 0,056 · WhatsApp 0,70 · SMS/E-mail 0,15. Fallback = RCS + WhatsApp×taxa. Entra no custo variável.

### TCV (§7.7 — R-025)
`TCV cliente = (core + serviços)×prazo + setup ao cliente + campanha`. Distingue TCV, receita bruta,
receita líquida, custos e margem — todos reconciliados contra o mesmo motor.

## Política de precisão (§5.3)

Aritmética em float64 de precisão plena, sem arredondamentos intermediários; arredondamento só de
apresentação. Mesma ordem de cálculo do HTML → paridade garantida (ver `parity.test.ts`).

## Versionamento (§27.6)

Alterar uma premissa **não** edita a versão vigente: cria-se uma nova versão e as propostas antigas
permanecem apontando para a versão anterior via snapshot imutável. `premisesHash` detecta qualquer
alteração. **Aplicação concreta (2026-11-05):** a validação do desconto por tier gerou a **v16**
(derivada da v15 com **duas mudanças de governança**: `tierDiscountLimits.status: pendente → validada`
e `setupFixedReductionDefault: 0 → 0,20` validada); a **v15**
permanece congelada com hash distinto. O `PREMISES_REGISTRY` resolve cada versão por chave
(`premisesForVersion('v15'|'v16')`); `createProposalSnapshot` usa a v16 por padrão e `reopenProposal`
reproduz a versão congelada na proposta (uma proposta v15 reabre com `status: pendente`).
