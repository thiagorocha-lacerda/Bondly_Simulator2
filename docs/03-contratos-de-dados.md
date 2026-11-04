# Contratos de dados (§23.4)

A fronteira pública do Pricing Engine. Interfaces estáveis que CRM, portal de parceiros, ferramentas
financeiras e a app comercial consomem (§21). Definidas em
`packages/pricing-engine/src/contracts/types.ts`.

## Entrada — `PricingInput`

```ts
interface PricingInput {
  volume: VolumeParameters;            // base, MAU%, stickiness, tx/MAU
  invoices: InvoiceParameters;         // leitura de NF
  communication: CommunicationParameters; // estratégia + mix + fallback
  complexity: ComplexityParameters;    // integrações, módulos, SLA, custom, AI, migração, horas
  negotiation: NegotiationParameters;  // opção, desconto, prazo, via Minu, expansão, estratégico
  services: ServiceParameters;         // perfis dedicados + horas + premissas de serviço
  campaign: CampaignParameters;        // campanha de marketing (fora do ARR)
  arka?: ArkaParameters;               // evidência comercial (opcional)
}
```

| Bloco | Campos | Unidade/forma |
|---|---|---|
| `volume` | `users`, `mauPct`, `stickiness`, `transactionsPerMau` | usuários; frações [0,1]; nº |
| `invoices` | `enabled`, `participantPct`, `notesPerParticipant` | bool; fração; inteiro |
| `communication` | `perMau`, `strategy`, `fallbackRate`, `customMix` | nº; enum; fração; mix frações |
| `complexity` | `integrations`, `modules`, `slaPoints`, `customizationPoints`, `aiPoints`, `migrationPoints`, `implementationHours` | contagens; pontos; horas |
| `negotiation` | `option`, `extraDiscount`, `term`, `viaMinu`, `expansion`, `strategic` | enum; fração; 12\|24\|36; bools |
| `services` | `profiles[]`, `tablePrice`, `minMargin`, `compCap`, `targetMargin?`, `passthroughPct`, `startMonth`, `hourMinMargin`, `productiveHoursPerMonth`, `hourCost?`, `negotiatedHourPrice?` | R$; frações; mês |
| `campaign` | `enabled`, `objectives[]`, `base?`, `consentPct`, `frequency`, `months`, `mix`, `deliveryRate`, `conversionRate`, `activationRate`, `operationHours`, `markup` | bool; enum[]; nº; frações |
| `arka` | `clientName`, `goLiveDate`, `owner`, `evidenceStage` (1–15), `probability` (0–100) | strings; nº |

**Convenção:** percentuais são sempre frações `[0,1]` na fronteira do motor (a UI converte 0–100 → fração).

## Saída — `PricingResult`

Campos principais (ver o tipo completo para a lista exaustiva):

| Grupo | Campos |
|---|---|
| Versão | `engineVersion`, `premisesVersion`, `premisesHash` |
| Tier | `tierName`, `isCustom` |
| Engajamento | `mau`, `dau` |
| Receita | `platformFeeTable`, `platformFee`, `usage`, `processing`, `core` |
| Custos | `costs` (`CostBreakdown`), `servicesMrr` |
| Setup | `setupNet`, `setupClient` |
| Tributos/Minu | `taxes` (`TaxBreakdown`), `minuConversionFee`, `minuAccountFee` |
| Margens | `technicalMargin`, `netMarginY1`, `netMarginSteady`, `marginStatus` |
| Desconto | `discountAuthority`, `maxDiscount`, `termDiscount` |
| Contrato | `tcvClient`, `tcvBondly`, `contractContribution`, `contractMargin` |
| 1º ano/Minu | `clientYear1`, `minuYear1`, `minuContract` |
| Complexidade | `complexityScore`, `complexityBand` |
| Avisos | `warnings[]` (`PricingWarning`) |

## Contratos auxiliares (módulos)

- **Serviços:** `ProfileResult`, `ServicesResult` (via `services()`).
- **Campanha:** `CampaignResult` (via `campaign()`).
- **B2C:** `B2cInput`, `B2cMonthRow`, `B2cResult` (via `runB2c()`).
- **ARKA:** `ArkaResult`, `EvidenceStage` (via `arkaClassification()`).
- **Snapshot:** `ProposalSnapshot` (via `createProposalSnapshot()`).

## Estabilidade e versão

As interfaces de entrada/saída são o contrato público. Mudanças que quebram o formato exigem bump de
`ENGINE_VERSION` (semver MAJOR). Novos campos opcionais de saída são MINOR. A **tabela de premissas**
tem seu próprio versionamento (`premisesVersion` + `premisesHash`), independente da versão do motor.

## QuoteView — contrato de saída da cotação no servidor (`quote.v1`, G-001-A)

Projeção por perfil do `PricingResult` (fonte única = Pricing Engine). Devolvida por `POST /api/pricing/quote`.
Fronteira de confidencialidade (CWE-200/CWE-602): custo, margem, COGS, tributo, fee Minu, premissa de custo e
breakdown existem **apenas** em `internal`. Módulo `quoteProjection.ts` (puro). `contractVersion: "quote.v1"`.

| view | papel | conteúdo | NUNCA contém |
|---|---|---|---|
| `client` | peça p/ o cliente | `view`, `contractVersion`, `engineVersion`, `premisesVersion`, `plan`, `termMonths`, `pricing` (monthly, setupHours, setupTotal, firstYearTotal, tcv), `discounts` (públicos), `scenarios` | política, composição, waterfall, Setup detalhado, qualquer custo/margem |
| `commercial` | business/approver | client **+** `composition` (coreMonthly…), `waterfall` (final…), Setup detalhado, alçada, `policy.marginAlert { level, requiresApproval }` (SINAL, sem valores) | custo, margem, COGS, tributo, fee Minu, breakdown, `marginValue` |
| `internal` | tech/admin (`proposal.see_internal`) | commercial **+** `result` (`PricingResult` completo, bit-a-bit = `calculate(input)`), `scenariosFull` | — (única visão com custo/margem) |

- **marginAlert.level** ∈ `ok | review | below_floor | custom | incomplete`, derivado do `marginStatus` do engine
  (`REPRECIFICAR`→`below_floor`+`requiresApproval:true`). Não cria limite novo — piso/meta são premissas do engine.
- **Visão máxima por papel:** `maxViewFor` — `see_internal`⇒`internal`; demais com `pricing.quote`⇒`commercial`. Pedir acima do direito ⇒ 403 `view_forbidden`.
- **Paridade (REQUIREMENT, provada por teste):** `QuoteView.internal.result ≡ calculate(input)` (igualdade estrutural e serializada) em todos os cenários de `parityInputs()`.
- **Invariante estrutural (REQUIREMENT, provado por teste):** varredura recursiva de `client`/`commercial` não acha nenhuma chave/valor proibido (`cost|custo|cogs|margin|margem|tax|tributo|fee Minu|premissa de custo|marginValue`); única exceção permitida em `commercial` é `policy.marginAlert` com exatamente `{level, requiresApproval}`.
