# 15 — ADR: G-001, cálculo de preço/margem movido ao servidor (alternativa A)

- Status: **DECIDIDO pelo sponsor (CTO)**, 2026-11-04. Implementação: PENDENTE. Verificação: somente o Guardian.
- Origem: Finding G-001 (HIGH) em [doc 14](./14-quality-review-rbac-indicadores.md).
- Classe da decisão: Nível 3 (estratégica: arquitetura + segurança).

## Contexto
O Pricing Engine roda no navegador. O bundle servido a qualquer usuário com perfil (inclusive Negócios e Gestor/Aprovador) contém tabelas de custo, premissas de margem e o motor, e o payload de propostas é idêntico entre perfis. "Negócios não vê margem" não é garantido por construção (CWE-602, CWE-200; OWASP A04/API3).

## Decisão
Executar o cálculo no **servidor** e devolver ao cliente apenas a saída **filtrada por perfil**. O navegador deixa de conter o motor completo e as tabelas de custo/margem.

## Requisitos (REQUIREMENT)
1. Endpoint de cotação no auth-proxy (ex.: `POST /api/pricing/quote`) que chama o Pricing Engine (fonte única de verdade, sem duplicar regra) e aplica projeção por perfil.
2. Projeção por perfil: `business` e `approver` recebem preço, descontos, Setup, mensalidade, TCV e alertas de **política** sem custo, margem ou breakdown de custo; `tech` e `admin` mantêm `proposal.see_internal`. A UI externa/PDF cliente nunca recebe dados internos.
3. O bundle do Commercial Workspace **não pode importar o motor completo nem as tabelas de custo/margem**. Verificação: busca no `dist` por identificadores sensíveis (ex.: cogs, marginPct, custos por transação) = 0 ocorrências para o bundle comercial.
4. Preservar paridade numérica: o resultado do endpoint deve ser idêntico ao motor atual para as mesmas entradas (testes de paridade e regressão existentes continuam valendo).
5. Alertas de margem: o servidor decide o alerta (ex.: abaixo do piso → exige aprovação) e devolve apenas o **sinal**, não os valores de margem, para perfis sem `see_internal`.
6. Validação de entrada no servidor (schema e limites), `Cache-Control: no-store`, RBAC por ação (nova ação, ex.: `pricing.quote`), auditoria sem dados de preço sensíveis em log.
7. Dashboard, resumo, pré-visualização e PDF reconciliados com a mesma resposta do servidor (um cálculo, várias visões).

## Pontos em aberto (DECISION REQUIRED antes de implementar)
- **Latência/UX:** cotação a cada alteração de campo exige debounce e estado "calculando"; aceitar? (ASSUMPTION: sim, com debounce ~250 ms.)
- **Geração de PDF:** hoje no navegador (jsPDF) a partir do resultado interno. ASSUMPTION: o servidor devolve ao navegador o conjunto de dados do PDF **já projetado por perfil** (versão cliente sem custo/margem; versão interna só para `see_internal`); geração do PDF permanece no navegador.
- **Modo offline/rascunho local:** deixa de existir cálculo local. Aceitar? (ASSUMPTION: sim.)
- **Premissas v15 e snapshot:** o snapshot imutável da proposta continua gravado no servidor; versão das premissas devolvida como identificador, sem valores de custo.

## Consequências
- Remove a classe de risco G-001; reduz a superfície de G-002 (dados internos deixam de trafegar).
- Aumenta dependência do servidor (disponibilidade e latência) e exige testes de carga leves.
- Altera o contrato interno entre `commercial-workspace` e `auth-proxy`; exige nova versão de contratos (doc 03) e atualização de docs 08, 10 e 13.

## Critérios de aceite (para o Guardian)
- Payload e bundle de `business`/`approver` sem custo/margem (prova por busca no `dist` e por teste de API por perfil).
- Paridade com o motor atual em todos os cenários de teste existentes; regressão financeira intacta (Capacity Fee, descontos por prazo e por tier, Setup híbrido).
- Reconciliação engine = dashboard = resumo = pré-visualização = PDF.
- Sem regressão de RBAC, SLA e fail-closed.

---

## Plano de implementação — G-001-A (fases 0-2 CONCLUÍDAS; 3-4 PENDENTES)

**DECISION:** entrega incremental em 4 fases. Fases 0-2 (backend: fonte única + projeção + gate) implementadas e verificadas por teste. Fases 3-4 (migração do frontend) NÃO iniciadas — a UI ainda usa o engine local.

### Fase 0 — fundação (CONCLUÍDA)
- `quoteInput.ts` — `parsePricingInput(raw, strict)`: validação estrita de `PricingInput` (NaN/Infinity/negativos/fora de faixa/tipos/chaves desconhecidas/listas gigantes rejeitados); modo não-estrito para inputs persistidos (`{}` legado).
- `quoteFixtures.ts` — `baseInput`, `lowMarginInput`, `parityInputs()` (33 cenários: tiers 3/5/7%, Setup 0/10/40/100h, prazos 12/24/36, MAU 1k–600k, comunicação, serviços).
- `rbac.ts` — nova ação `pricing.quote` (business/tech/approver permitem; admin permite leitura de catálogo/cotação; matriz em `rbac.test.ts`).

### Fase 1 — projeção por perfil (CONCLUÍDA)
- `quoteProjection.ts` (PURO) — contrato `quote.v1`; `projectQuote(view, result, term, scenarios)`, `resolveView`, `maxViewFor`, `marginAlertOf`. Fronteira de confidencialidade: custo/margem/COGS/tributo/fee Minu/premissa/breakdown só em `internal`.
- `pricingQuote.ts` — `computeQuote(input, view)` (chama `calculate()` do engine = fonte única, nunca recalcula), `persistedPricingInput`, `evaluateProposalPolicy`, `publicCatalog()`.

### Fase 2 — rota + gate (CONCLUÍDA)
- `api.ts` — `GET /api/pricing/catalog` e `POST /api/pricing/quote` registrados em `handleApi`, com RBAC `pricing.quote`, rate limit (`rateLimit.ts`), guard de corpo (tipo/tamanho `MAX_QUOTE_BODY_CHARS`/413), `contractVersion`, `resolveView`→403 `view_forbidden`, guard de dono (`visible()`) quando há `proposalId` (404 indistinguível), `json()` aplica `Cache-Control: no-store` + `Content-Type: application/json`.
- `pricingQuote.ts` — `emissionGate(args)` (G-026): `marginStatus=REPRECIFICAR` exige a ÚLTIMA `excecao_comercial` `approved` e nenhuma `proposal.edit_commercial` posterior na auditoria; `config.ts` `pricingGuardStrict` (fail-closed p/ inputs não-avaliáveis).

### Contrato da rota (`quote.v1`)
```
GET  /api/pricing/catalog            → 200 { catalog }            (rótulos/limites; SEM preço de tabela/custo/margem)
POST /api/pricing/quote              → 200 { quote: QuoteView }
  body: { contractVersion?: "quote.v1", view?: "client"|"commercial"|"internal", input?: PricingInput, proposalId?: string }
  Precedência: proposalId (lê inputs persistidos, 404/422) OU input (validado). Sem nenhum ⇒ 400 input_required.
  Erros: 400 invalid_body|invalid_view|unsupported_contract_version|input_required|invalid_proposal_id
         403 forbidden|view_forbidden · 404 not_found · 413 payload_too_large · 422 proposal_inputs_incomplete · 429 rate_limited
```

### Fase 3 — migração do frontend (PENDENTE — checklist exato por arquivo)
- [ ] `apps/commercial-workspace/src/**` — substituir import do engine local pela chamada `POST /api/pricing/quote` (view derivada do perfil pelo servidor; cliente NÃO envia `view=internal`).
- [ ] `apps/commercial-workspace/src/api/*` (camada de integração nova) — client HTTP com debounce ~250 ms, estados loading/erro/vazio, tratamento de 429/413/403.
- [ ] remover do bundle comercial qualquer import de `@bondly/pricing-engine` e tabelas de custo/margem; prova: `grep` no `dist` por `cogs|marginPct|custos` = 0.
- [ ] dashboard/resumo/pré-visualização passam a consumir `QuoteView` (um cálculo, várias visões).

### Fase 4 — PDF + hardening de bundle (PENDENTE — checklist exato por arquivo)
- [ ] geração de PDF (jsPDF no navegador) a partir do `QuoteView` projetado por perfil (cliente sem custo/margem; interno só p/ `see_internal`).
- [ ] teste de bundle no CI: falha o build se o bundle comercial contiver identificadores sensíveis.
- [ ] teste E2E da jornada cotação→proposta→emissão contra o endpoint real.

**ASSUMPTION (não transformada em requisito):** debounce ~250 ms, fim do cálculo offline/rascunho local, PDF permanece no navegador. Confirmar com o sponsor antes da Fase 3.
