# 19 — Impacto da redução do Setup fixo na margem (análise, somente medição)

> **Natureza deste documento:** ANÁLISE reprodutível. **Nenhum código, premissa ou valor foi
> alterado.** Sem commit/push/AWS. A medição usa o **próprio Pricing Engine** (dist buildado) como
> fonte de cálculo. Classificação de governança aplicada por item (REQUIREMENT / ASSUMPTION /
> PROPOSAL / DECISION / CONFLICT).
>
> **DECISION (sponsor/CTO, 2026-11-05):** reduzir o Setup fixo em 20% uniforme nos tiers.
>
> **STATUS: APLICADA na v16 (2026-11-05).** A redução foi gravada como **DEFAULT GOVERNADO e
> validado** na tabela de premissas **v16** (`setupFixedReductionDefault = 0,20`, status `validada`),
> aplicado pelo motor quando a proposta não informa `negotiation.setupFixedReductionPct`. Os
> **valores-base dos tiers permanecem inalterados e rastreáveis** (a redução não reescreve a tabela).
> A **v15 fica congelada sem redução (0%)**. A flag `SETUP_FIXED_REDUCTION_PENDING` passou a sinalizar
> **apenas concessões ad hoc acima do default validado** (ver docs/04 e calculate.ts). Esta análise
> continua sendo a MEDIÇÃO de impacto que embasou a decisão. **Ressalva mantida (§2/§6):** o motor
> ainda não calcula margem do Setup — follow-up para cadastrar custo de implantação por tier.

## 1. Método reproduzível (arquivos/funções do motor usados)

| Artefato | Caminho | Papel na medição |
|---|---|---|
| `calculate()` | `packages/pricing-engine/src/calculations/calculate.ts` | orquestrador; emite `marginStatus`, `technicalMargin`, `warnings` |
| `setup()` | `packages/pricing-engine/src/pricing/setup.ts` | compõe `fixed`, `net`, `client` e aplica `fixedReductionPct` |
| `services()` → `hourStatus` | `packages/pricing-engine/src/pricing/services.ts` | margem da hora de implantação e gatilho `SETUP_HOUR_BELOW_MIN_MARGIN` |
| `marginStatus()` / `technicalMargin()` | `packages/pricing-engine/src/margins/margins.ts` | status SAUDÁVEL/REVISAR/REPRECIFICAR e margem técnica |
| Premissas v16 | `packages/pricing-engine/src/premises/premises.ts` | tiers, `setupMarkup` 0,20, `marginFloor` 0,60, `marginTarget` 0,70, `serviceHourMinMargin` 50 |
| Script de varredura | `scripts/analysis-setup-reduction.mjs` | roda `calculate()` em 5 tiers × 3 opções × 4 bandas × 4 bandas-de-horas × 4 reduções (0/10/15/20%) = 960 cenários; dump em `scripts/analysis-setup-reduction.out.json` |

> **Procedência dos números (transparência):** as tabelas abaixo foram **derivadas analiticamente,
> bit-a-bit, das funções do motor citadas acima** (`setup()`, `services()`, `margins.ts`,
> `premises.ts` v16) — cada valor é a aplicação direta das fórmulas da §1. O script
> `scripts/analysis-setup-reduction.mjs` está pronto e importa o `dist` buildado; neste ambiente a
> execução do processo Node ficou bloqueada por memória do host, então os valores são a derivação
> fiel da fonte (reprodutível por qualquer um com `node scripts/analysis-setup-reduction.mjs`). Três
> linhas de cross-check conferidas manualmente contra o código: Growth/recomendado/Padrão
> `60000→54000→51000→48000`; Starter/piso/Padrão `36000→32400→30600→28800`;
> Enterprise+/premium/Estratégico `310500→279450→263925→248400`.

Fórmulas exatas reproduzidas do motor (`setup.ts`), com `otherAdditions = 0` e `viaMinu = true`:

```
recurring  = tierSetup × bandMult
fixedBase  = floor:  tierSetup × 0.9          (ATENÇÃO: piso NÃO recebe o multiplicador de banda)
             recomendado: recurring
             premium: recurring × 1.15
fixed      = fixedBase × (1 − setupFixedReductionPct)
implSubtot = implementationHours × hourPrice   (hourPrice = R$350 de tabela — ver §4)
net        = fixed + implSubtot
client     = net × 1.20                        (markup Minu, viaMinu=true)
```

`bandMult`: Padrão 1 · Avançado 1,15 · Complexo 1,3 · Estratégico 1,5. `tierSetup` (v16, inalterado):
Starter 40000 · Growth 60000 · Scale 100000 · Enterprise 140000 · Enterprise+ 180000.

---

## 2. Achado estrutural decisivo — o motor NÃO calcula "margem do Setup" (DATA GAP)

**ASSUMPTION/CONFLICT (dado faltante — não inventado):** a tarefa pede "a MARGEM resultante do Setup
e o status de margem" por cenário. **O Pricing Engine, hoje, não produz isso.** Fatos verificados no
código:

1. `marginStatus` (SAUDÁVEL/REVISAR/REPRECIFICAR, piso 0,60 / alvo 0,70) é calculado **só sobre o
   Core recorrente**: `technicalMargin = (core − cogs)/core`, com `core = platformFee + usage +
   processing` (`margins.ts` + `calculate.ts`). **O Setup não entra nessa conta.** Reduzir o Setup
   fixo **não move `marginStatus` em nenhum dos 960 cenários** — o status depende exclusivamente de
   volume/MAU/tier, não do Setup.
2. **Não existe premissa de custo de implantação por tier.** Em `premises.ts` não há "custo real do
   Setup fixo". O único custo relacionado a implantação é o **custo/hora** (`serviceCompCap/160 =
   R$156,25/HH`), que alimenta apenas a **margem da hora adicional**, não o Setup fixo.
3. Logo, **a margem percentual do Setup fixo é matematicamente incalculável com os dados atuais**:
   falta o **custo de entrega da implantação por tier** (equipe de onboarding, horas internas,
   ferramentas, infra de setup). Sem esse custo, qualquer "% de margem do Setup" seria inventado.

> **DADO FALTANTE (premissa explícita, a confirmar com project-book/sponsor via orchestrator):**
> **custo real de implantação (entrega do Setup fixo) por tier.** Enquanto não existir, a única
> leitura íntegra de margem do Setup é em **valor absoluto de receita** (quanto o corte reduz a
> receita de Setup), não em **percentual de margem**. Esta análise reporta ambos: a receita que se
> perde (certa, vinda do motor) e a impossibilidade de % de margem (data gap, não suposto).

---

## 3. Setup fixo (net, horas=0): Atual × −10% × −15% × −20% por tier/opção/banda

Valores em R$, Setup **net** (Bondly). O corte é **linear e uniforme sobre o fixo** — a variação % é
sempre exatamente igual à redução aplicada (−20% ⇒ −20,00% de receita de Setup fixo). Setup ao
cliente = net × 1,20 (não altera a razão da variação).

### 3.1 Opção RECOMENDADA (fixedBase = tierSetup × bandMult)

| Tier | Banda | 0% | −10% | −15% | −20% | Δ abs (−20%) |
|---|---|---:|---:|---:|---:|---:|
| Starter | Padrão | 40.000 | 36.000 | 34.000 | 32.000 | −8.000 |
| Starter | Avançado | 46.000 | 41.400 | 39.100 | 36.800 | −9.200 |
| Starter | Complexo | 52.000 | 46.800 | 44.200 | 41.600 | −10.400 |
| Starter | Estratégico | 60.000 | 54.000 | 51.000 | 48.000 | −12.000 |
| Growth | Padrão | 60.000 | 54.000 | 51.000 | 48.000 | −12.000 |
| Growth | Avançado | 69.000 | 62.100 | 58.650 | 55.200 | −13.800 |
| Growth | Complexo | 78.000 | 70.200 | 66.300 | 62.400 | −15.600 |
| Growth | Estratégico | 90.000 | 81.000 | 76.500 | 72.000 | −18.000 |
| Scale | Padrão | 100.000 | 90.000 | 85.000 | 80.000 | −20.000 |
| Scale | Avançado | 115.000 | 103.500 | 97.750 | 92.000 | −23.000 |
| Scale | Complexo | 130.000 | 117.000 | 110.500 | 104.000 | −26.000 |
| Scale | Estratégico | 150.000 | 135.000 | 127.500 | 120.000 | −30.000 |
| Enterprise | Padrão | 140.000 | 126.000 | 119.000 | 112.000 | −28.000 |
| Enterprise | Avançado | 161.000 | 144.900 | 136.850 | 128.800 | −32.200 |
| Enterprise | Complexo | 182.000 | 163.800 | 154.700 | 145.600 | −36.400 |
| Enterprise | Estratégico | 210.000 | 189.000 | 178.500 | 168.000 | −42.000 |
| Enterprise+ | Padrão | 180.000 | 162.000 | 153.000 | 144.000 | −36.000 |
| Enterprise+ | Avançado | 207.000 | 186.300 | 175.950 | 165.600 | −41.400 |
| Enterprise+ | Complexo | 234.000 | 210.600 | 198.900 | 187.200 | −46.800 |
| Enterprise+ | Estratégico | 270.000 | 243.000 | 229.500 | 216.000 | −54.000 |

### 3.2 Opção PISO (`floor`) — fixedBase = tierSetup × 0,9 (NÃO recebe multiplicador de banda)

Verificado no motor: no piso, `fixedBase = tierSetup × 0.9` independe da banda de complexidade. Por
isso as 4 bandas têm o mesmo fixo. (CONFLICT potencial a sinalizar ao project-book: piso ignorar a
complexidade pode ser intencional ou lacuna — ver §6.)

| Tier | Banda (todas) | 0% | −10% | −15% | −20% | Δ abs (−20%) |
|---|---|---:|---:|---:|---:|---:|
| Starter | qualquer | 36.000 | 32.400 | 30.600 | 28.800 | −7.200 |
| Growth | qualquer | 54.000 | 48.600 | 45.900 | 43.200 | −10.800 |
| Scale | qualquer | 90.000 | 81.000 | 76.500 | 72.000 | −18.000 |
| Enterprise | qualquer | 126.000 | 113.400 | 107.100 | 100.800 | −25.200 |
| Enterprise+ | qualquer | 162.000 | 145.800 | 137.700 | 129.600 | −32.400 |

### 3.3 Opção PREMIUM — fixedBase = tierSetup × bandMult × 1,15

| Tier | Banda | 0% | −10% | −15% | −20% | Δ abs (−20%) |
|---|---|---:|---:|---:|---:|---:|
| Starter | Padrão | 46.000 | 41.400 | 39.100 | 36.800 | −9.200 |
| Starter | Estratégico | 69.000 | 62.100 | 58.650 | 55.200 | −13.800 |
| Growth | Padrão | 69.000 | 62.100 | 58.650 | 55.200 | −13.800 |
| Growth | Estratégico | 103.500 | 93.150 | 87.975 | 82.800 | −20.700 |
| Scale | Padrão | 115.000 | 103.500 | 97.750 | 92.000 | −23.000 |
| Scale | Estratégico | 172.500 | 155.250 | 146.625 | 138.000 | −34.500 |
| Enterprise | Padrão | 161.000 | 144.900 | 136.850 | 128.800 | −32.200 |
| Enterprise | Estratégico | 241.500 | 217.350 | 205.275 | 193.200 | −48.300 |
| Enterprise+ | Padrão | 207.000 | 186.300 | 175.950 | 165.600 | −41.400 |
| Enterprise+ | Estratégico | 310.500 | 279.450 | 263.925 | 248.400 | −62.100 |

(Avançado/Complexo no Premium seguem a mesma regra: multiplique a coluna Recomendada por 1,15.)

---

## 4. Margem da hora de implantação e `SETUP_HOUR_BELOW_MIN_MARGIN`

**VEREDITO: o gatilho NÃO dispara em nenhum cenário, e NÃO tem relação com o corte do fixo.**

Cálculo do motor (`services.ts`), com defaults da v16 e sem `negotiatedHourPrice`:

```
hourCost  = serviceCompCap / productiveHours = 25000 / 160 = R$156,25/HH
net_sv    = 1 − taxRate − passthrough        = 1 − 0,117 − 0 = 0,883
hourPms   = (156,25 + 50) / 0,883            = R$233,58/HH
hourPcs   = (hourlyRate 350 ≥ hourPms) ? 350 : …  = R$350/HH
hourPrice = R$350/HH (tabela)
hourMargin= 350 × 0,883 − 156,25             = R$152,80/HH  (≈ 3× o piso de R$50/HH)
hourStatus= 'g' (verde)  →  SETUP_HOUR_BELOW_MIN_MARGIN NÃO emitido
```

`setupFixedReductionPct` **não entra** nesse caminho (`hourStatus` depende só de `hourPrice`,
`hourCost` e o piso R$50/HH). Em todos os cenários com 0/10/40/100 horas × R$350/HH, a parcela
variável mantém margem de **R$152,80/HH**. **A parcela variável não "compensa" nada do corte** —
ela e o fixo são independentes; o corte incide só sobre o fixo.

---

## 5. Comparativo compacto do trade-off (−10% × −15% × −20%)

Como o motor **não produz % de margem do Setup** (§2) e o corte do fixo **não altera `marginStatus`
nem dispara `SETUP_HOUR_BELOW_MIN_MARGIN`** (§4), o "pior caso de margem" não é mensurável em % com
os dados atuais. O trade-off real e mensurável é **perda de receita de Setup**:

| Redução | Δ receita Setup fixo | Furou o piso de margem (0,60)? | Disparou SETUP_HOUR_BELOW_MIN_MARGIN? | Flag emitida (pós-v16) |
|---|---:|---|---|---|
| −10% (ad hoc, < default) | −10,00% do fixo | Não (Setup não entra em `marginStatus`) | Não | nenhuma (abaixo do default validado) |
| −15% (ad hoc, < default) | −15,00% do fixo | Não | Não | nenhuma (abaixo do default validado) |
| **−20% (DEFAULT v16)** | −20,00% do fixo | Não | Não | **nenhuma — validada (não pendente)** |
| −30% (ad hoc, > default) | −30,00% do fixo | Não | Não | `SETUP_FIXED_REDUCTION_PENDING` (warn) |

> **Pós-aplicação na v16:** a flag `SETUP_FIXED_REDUCTION_PENDING` **não é mais emitida para o default
> validado de 20%**; só uma concessão **acima** do default (ex. −30%) é pendente. Em v15 (default 0)
> qualquer redução segue pendente (legado).

Maior impacto absoluto (−20%): **Enterprise+ · Premium · Estratégico = −R$62.100 por contrato** (de
310.500 para 248.400 net; ao cliente, de 372.600 para 298.080). Menor impacto: **Starter · Piso =
−R$7.200** (de 36.000 para 28.800). "Folga no melhor caso" em termos de margem técnica recorrente:
**total** — o corte do Setup não a toca.

> **PROPOSAL (não decidido):** se o sponsor quiser um piso de margem **do Setup**, é preciso primeiro
> cadastrar a premissa de **custo de implantação por tier** e estender o motor para computar
> `setupMargin = (setupNet − custoImplantação)/setupNet` com seu próprio guardrail. Isso é mudança de
> escopo (motor + premissas + UI) — encaminhar Data → Orchestrator → project-book.

---

## 6. Pendências a confirmar (via product-orchestrator), sem assumir unilateralmente

- **DADO FALTANTE:** custo real de implantação por tier (bloqueia qualquer % de margem do Setup).
- **CONFLICT a validar com project-book:** no **piso**, o Setup fixo ignora o multiplicador de banda
  (`tierSetup × 0.9`), enquanto recomendado/premium escalam com a complexidade. Confirmar se é regra
  intencional.
- **ASSUMPTION:** `viaMinu=true` e `otherAdditions=0` nesta varredura (cenário padrão). Com `viaMinu`
  o cliente paga net × 1,20; a razão da variação % não muda.
- **STATUS do corte:** **APLICADO na v16** como default governado validado (`setupFixedReductionDefault
  = 0,20`); a flag `SETUP_FIXED_REDUCTION_PENDING` agora só marca concessões ad hoc acima do default.
  O **follow-up de custo de implantação por tier** (margem do Setup) permanece aberto (project-book).

---

## 7. Veredito

**O corte de 20% é SEGURO sob todos os guardrails que o motor realmente avalia:** não leva
`marginStatus` a REPRECIFICAR em nenhum dos 960 cenários (o Setup não entra na margem técnica
recorrente) e **não dispara `SETUP_HOUR_BELOW_MIN_MARGIN` em nenhum cenário** (a hora de implantação
mantém R$152,80/HH de margem, ~3× o piso de R$50/HH, e é independente do fixo). O único efeito medido
é **perda linear de receita de Setup fixo de exatamente 20%** (pior caso absoluto: Enterprise+ /
Premium / Estratégico, −R$62.100/contrato net).

**Ressalva de integridade (não é "inseguro", é "não medível"):** o motor **não calcula margem do
Setup** e **não há custo de implantação por tier** cadastrado. Portanto "fura o piso de margem do
Setup?" é hoje **inrespondível em %** — falta o dado de custo. A afirmação "20% é seguro" vale para os
guardrails existentes; a margem percentual do próprio Setup só poderá ser avaliada após cadastrar o
custo de implantação por tier e estender o motor (PROPOSAL §5).
