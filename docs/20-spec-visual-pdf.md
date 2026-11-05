# 20 — Spec Visual do PDF de Proposta (redesign a partir da referência do sponsor)

> **Natureza deste documento:** `SPEC / PROPOSAL` — especificação visual implementável.
> **NÃO é código.** O destinatário de implementação é o `product-fullstack`, que aplicará
> isto no gerador `apps/commercial-workspace/src/services/pdf.ts` (jsPDF 2.5.2, mesma lib da
> referência). Nenhuma mudança de código, commit, push ou AWS foi feita nesta entrega.
>
> **Procedência / método:** a referência visual é o PDF enviado pelo sponsor
> (`…_Proposta_BONDLY-2027-000013_BBBBB.pdf`, jsPDF 2.5.2, A4 595,28×841,89 pt, 4 páginas
> lógicas). O texto está codificado por glifo (não legível), mas **a estrutura foi decodificada
> diretamente dos content streams** (operadores `re/f`, `m/l/S`, `BT/Tf/Td/Tj`, cores `rg/RG`,
> `cm/Do` de imagem, dicionários de fonte). Todos os valores de layout abaixo (coordenadas,
> cores `rg`, tamanhos de fonte) são **medidos do arquivo real**, não estimados. Os **números
> de negócio** do exemplo foram ignorados por design — extraímos o PADRÃO.
>
> **Rótulos de origem** usados ao longo do doc:
> `[Ref]` medido na referência do sponsor · `[DS]` vem do design system atual
> (`apps/commercial-workspace/src/styles/tokens.css`) · `[Atual]` comportamento do gerador
> `pdf.ts` hoje · `[Inferência]` interpretação para preencher lacuna (premissa explícita) ·
> `[Hipótese/Recomendação]` proposta nova de produto.

---

## 0. Regra inegociável de confidencialidade (vale para TODO o doc)

A fronteira de confidencialidade **é estrutural e já existe** no contrato `quote.v1`
(`apps/auth-proxy/src/quoteProjection.ts`): o gerador só FORMATA o que o servidor projetou
para o perfil. Em `client`/`commercial` o payload **não contém** `result` (COGS, margem,
tributo, fee Minu, breakdown técnico) — não há de onde vazar. Portanto esta spec **não pode
introduzir** nenhuma seção que exiba custo/margem/COGS/tributo/fee Minu/alçada em peça de
cliente. Tudo isso vive **exclusivamente** na view `internal` (perfil com `proposal.see_internal`).
O §3 (Mapa por Perfil) é o contrato que o fullstack deve obedecer campo a campo.

---

## 1. Inventário de páginas/seções da referência

A referência tem **4 páginas lógicas** (A4 retrato, margem lateral `x=51 pt`, faixa de rodapé
em `y≈21,5 pt` em todas). Função de cada uma `[Ref]`:

| Pág | Tipo | Função | Blocos medidos |
|-----|------|--------|----------------|
| 1 | **Capa** | Identidade + dados da proposta. Fundo navy integral. | Fundo navy full-bleed; logo grande (`/I0`, ~419×236 pt centro-direita) + logo-marca menor (`/I1`, ~221×71 pt topo-esq em `y≈662`); eyebrow mono em `y≈768`; título display 34 pt em `y≈587`; subtítulo 20 pt em `y≈553` com **segunda palavra em verde-limão**; 4 pares rótulo(7,5 pt)/valor(12,5 pt) empilhados (`y≈501→371`); linha de contato 9 pt em `y≈71`; rodapé mono 7,5 pt. |
| 2 | **Internas — bloco A** | 3 seções numeradas: KPIs de topo, tabela de composição, bloco de texto. | Faixa de seção navy (`51, h≈716→626`, 493×−91 pt) com **trio de KPIs** (rótulo mono 7,5 pt em `y≈688` + número 15 pt em `y≈657`, 3 colunas x=68/232/397); título de seção 17 pt navy; **tabela** com header-band navy (`51, y≈529`, 493×−19,8) texto branco 8 pt + linhas de corpo 9 pt (Space Grotesk rótulo / Geist Mono número) com 4 separadores `l`; parágrafo 10 pt. |
| 3 | **Internas — bloco B** | Mesma gramática da pág. 2 (seções numeradas seguintes). | Idêntico à pág. 2 em grid/estilo: faixa navy + KPIs, título 17 pt, tabela com header navy, parágrafos. Confirma que páginas internas são **um template repetível**, não layouts ad-hoc. |
| 4 | **Internas — bloco C (condições) + fecho** | 2 tabelas de 2 colunas (rótulo↔valor): "Detalhamento/Condições comerciais". | Dois header-bands navy (`y≈711` e `y≈484`, 493×−19,8); linhas 9 pt rótulo-esq (x=56,7) / valor-dir (x≈490–506 e x=226,8); 13 separadores `l`. Layout de **lista de condições** em 2 colunas. |
| 5 (contracapa) | **Contracapa** | Agradecimento + CTA. Fundo navy integral, espelha a capa. | Fundo navy full-bleed; logo `/I0` grande + `/I1` em `y≈513`; eyebrow mono 8,5 pt; título display **30 pt** "Obrigado…" em `y≈706`; subtítulo 12 pt em `y≈666`; frase 15 pt em `y≈479` com **palavra em verde-limão**; linha 9 pt; rodapé. |

> Observação de medição: o parser encontrou os streams duplicados (6–7 blocos), mas são
> **4 páginas lógicas distintas**: `capa` · `internas A` · `internas B` · `internas C/condições`
> · `contracapa`. As seções nomeadas pelo briefing ("Resumo do investimento", "Composição do
> TCV", "Resumo executivo", "Soluções contratadas", "Detalhamento comercial", "Condições
> comerciais") mapeiam para os blocos internos acima. `[Ref]`

---

## 2. Sistema visual (medido da referência + reconciliado com o DS)

### 2.1 Paleta — valores `rg` exatos `[Ref]`

| Papel | `rg` (0–1) | HEX aprox. | Onde aparece | Equivalente no DS `[DS]` |
|-------|-----------|-----------|--------------|--------------------------|
| **Navy fundo/faixa** | `0.07 0.13 0.37` | `#12215E` | Capa, contracapa, faixas de seção, header de tabela | `--base-navy-700 #2a2470` / `--deep` (DS é mais roxo/claro) |
| **Navy título (seção)** | `0.067 0.125 0.369` | `#11205E` | Títulos de seção 17 pt (quase o mesmo navy) | idem acima |
| **Navy escuro (texto em tabela clara)** | `0.039 0.067 0.188` | `#0A1130` | Texto de célula sobre fundo claro | `--base-ink-800 #1b1a3a` |
| **Branco-gelo (texto claro)** | `0.98 0.98 0.973` | `#FAFAF8` | Texto sobre navy; header de tabela | `--text-on-deep #ffffff` |
| **Verde-limão (destaque)** | `0.761 1.0 0.004` | `#C2FF01` | Palavra-destaque em capa/subtítulo/contracapa | **não existe no DS** — DS usa amber `#ffc81e` |
| **Azul-névoa (eyebrow/label sobre navy)** | `0.725 0.776 1.0` | `#B9C6FF` | Eyebrows mono e rótulos de KPI sobre navy | `--base-ink-200 #c9cce8` (próximo) |
| **Cinza-ardósia (rótulo sobre claro)** | `0.361 0.384 0.455` | `#5C6274` | Eyebrow/rótulo de seção sobre fundo branco; rodapé | `--text-muted #5f6479` (match quase exato) |
| **Linha de separação (stroke)** | `0.83 0.85 0.89` | `#D4D9E3` | Separadores de tabela (`S`) | `--base-sand-200 #e1ddd0` (DS usa sand, ref usa cinza-azulado) |

### 2.2 Tipografia por nível `[Ref]`

A referência embute **duas famílias** (confirmado nos dicionários de fonte):
- **Space Grotesk** (F15 corpo/rótulo; F16 display/headings) — títulos e texto.
- **Geist Mono** (F17 eyebrow/labels/KPI/rodapé; F18 número de tabela enfatizado) — **todos os
  números tabulares, eyebrows e labels em caixa-alta**. É a assinatura "fintech" da peça.

| Nível | Fonte `[Ref]` | Tamanho `[Ref]` | Cor típica | Uso |
|-------|---------------|-----------------|------------|-----|
| Título capa | Space Grotesk bold | **34 pt** | branco-gelo | nome do programa/cliente |
| Título contracapa | Space Grotesk bold | **30 pt** | branco-gelo | "Obrigado pela oportunidade" |
| Subtítulo capa | Space Grotesk | **20 pt** | branco + verde-limão na 2ª palavra | linha de posicionamento |
| KPI número | Geist Mono | **15 pt** | branco-gelo | valores do trio de KPIs |
| Título de seção | Space Grotesk bold | **17 pt** | navy | rótulo numerado da seção |
| Frase de fecho | Space Grotesk | **15 pt** | branco + palavra verde-limão | contracapa |
| Dado de capa (valor) | Space Grotesk | **12,5 pt** | branco-gelo | valores dos pares da capa |
| Subtítulo contracapa / corpo-grande | Space Grotesk | **12 pt / 10 pt** | azul-névoa / navy-escuro | descrição |
| Rótulo de célula / número de tabela | Space Grotesk 9 pt / Geist Mono 9 pt | **9 pt** | navy-escuro | corpo de tabela |
| Header de tabela | Geist Mono | **8 pt** | branco-gelo sobre navy | cabeçalho de coluna |
| Eyebrow / rótulo de seção / KPI label | Geist Mono (caixa-alta + tracking) | **7,5–8,5 pt** | cinza-ardósia / azul-névoa | kicker acima dos títulos |
| Rodapé / numeração de página | Geist Mono | **7,5 pt** | cinza-ardósia | "pág. x/y", id da proposta |

Detalhe medido: eyebrows/mono usam **tracking positivo** (`Tc` de ~1,1 a ~2,3 pt) → efeito
caixa-alta espaçada. `[Ref]`

### 2.3 Grid, margens, faixas, tabela, rodapé

- **Página:** A4 595,28 × 841,89 pt. **Margem lateral `M = 51 pt`** (ref) vs **`M = 56 pt`
  atual** `[Atual]`. Faixa útil ≈ 493 pt. `[Ref]`
- **Faixa de seção (navy band):** retângulo navy largura cheia da margem (`x=51, w≈493`),
  altura ~19,8 pt para header de tabela/condição e ~91 pt para a faixa de KPIs. Texto claro
  dentro. `[Ref]`
- **Título de seção:** eyebrow mono (kicker) em cima + título Space Grotesk 17 pt navy logo
  abaixo. (A referência **não** usa o "traço amber de 22×4 pt" do gerador atual — usa kicker
  mono + faixa navy.) `[Ref]` vs `[Atual]`
- **Trio de KPIs:** 3 colunas a `x≈68 / 232 / 397`, cada uma = rótulo mono 7,5 pt (azul-névoa)
  sobre número 15 pt (branco), dentro da faixa navy. Padrão reutilizável para "Resumo do
  investimento" (mensal / setup / TCV). `[Ref]`
- **Tabela:** header-band navy com rótulos de coluna mono 8 pt brancos; corpo em linhas de
  ~19 pt com rótulo à esquerda (Space Grotesk 9 pt) e números alinhados à direita (Geist Mono
  9 pt); separadores finos `#D4D9E3`. Colunas medidas na tabela de 5 colunas da pág. 2:
  `x≈56,7 / 243,8 / 345 / 429 / 514` (rótulo + 4 numéricas, números right-aligned). `[Ref]`
- **Tabela 2-colunas (condições):** rótulo-esq `x=56,7` ↔ valor-dir (`x≈490–506`), linhas de
  ~19 pt, header-band navy. `[Ref]`
- **Rodapé padronizado:** linha em `y≈21,5` com id/uso à esquerda e **numeração `pág. x/y`**
  à direita (`x≈534`), ambos Geist Mono 7,5 pt cinza-ardósia. Igual em todas as páginas. `[Ref]`
- **Capa/Contracapa:** fundo navy full-bleed (`0,0,595,842`), logo grande + logo-marca, títulos
  display, palavra-destaque verde-limão. Contracapa espelha a capa com título 30 pt. `[Ref]`

---

## 3. MAPA POR PERFIL (contrato campo-a-campo com `QuoteViewPayload`)

Legenda: ✅ renderiza · ⛔ **omitido (não existe no payload do perfil)** · — não aplicável.
Campos citados são os reais de `quoteTypes.ts` / `quoteProjection.ts`.

| Seção (nova gramática) | Campos do payload | client | commercial | internal |
|------------------------|-------------------|:------:|:----------:|:--------:|
| **Capa** (programa/cliente, prazo, emissão) | `meta.clientName`, `plan.name`, `termMonths`, `meta.issuedAt`; eyebrow = "PROPOSTA COMERCIAL · 2027" (client/commercial) / "USO INTERNO" (internal) | ✅ | ✅ | ✅ |
| **Resumo do investimento** (trio KPI) | `pricing.monthly` (mensal) · `pricing.setupTotal` (setup) · `pricing.tcv` (TCV) | ✅ | ✅ | ✅ |
| **Composição do TCV** (mensal×prazo + setup) | `pricing.monthly`, `pricing.firstYearTotal`, `pricing.tcv`, `termMonths`; se `termMonths>12` → nota "condição de prazo" | ✅ | ✅ | ✅ |
| **Resumo executivo** (parágrafo de abertura) | `meta.clientName`, `meta.users`, `termMonths` (texto já existe) | ✅ | ✅ | ✅ |
| **Soluções contratadas** | `plan.name`, `meta.selectedModules` (nomes via catálogo), `meta.users`, `pricing.servicesMonthly` | ✅ | ✅ | ✅ |
| **Projeção por engajamento** (3 cenários) | `scenarios[]` (`name`, `monthly`, `tcv`) | ✅ | ✅ | ✅ (pode usar `scenariosFull`) |
| **Descontos públicos** | `discounts.tierRate`, `discounts.termRate` | ✅ | ✅ (+`negotiatedRate`) | ✅ |
| **Detalhamento comercial — waterfall de preço** | `waterfall.{base,afterTier,afterNegotiated,final}` | ⛔ | ✅ | ✅ |
| **Detalhamento comercial — composição de PREÇO** | `composition.{platformFee,usage,processing,servicesMonthly,coreMonthly}` | ⛔ | ✅ | ✅ |
| **Setup detalhado** | `setup.{fixed,fixedReductionPct,implementationHours,hourlyRate,implementationSubtotal,otherAdditions,total}` | ⛔ (só `pricing.setupTotal`+`implementationHours`) | ✅ | ✅ |
| **Engajamento (MAU/DAU)** | `engagement.{mau,dau}` | ⛔ | ✅ | ✅ |
| **Alçada / corredor de desconto** | `discountCorridor.{authority,maxDiscount}` | ⛔ | ✅ | ✅ |
| **Sinais de política** (sem valores) | `policy.marginAlert.{level,requiresApproval}`, `policy.flags[]` | ⛔ | ✅ | ✅ |
| **Composição da mensalidade (interno)** | `result.{platformFee,usage,processing,servicesMrr,core}` | ⛔ | ⛔ | ✅ |
| **Custos e margens (interno)** | `result.costs.{total,cleverTap,infra,invoices,communication}`, `result.{technicalMargin,netMarginY1,netMarginSteady,marginStatus,discountAuthority}` | ⛔ | ⛔ | ✅ |
| **Fees Minu (interno)** | `result.{minuConversionFee,minuAccountFee,minuYear1}` | ⛔ | ⛔ | ✅ |
| **Alertas/avisos do engine** | `result.warnings[]` | ⛔ | ⛔ | ✅ |
| **Rodapé** | client/commercial: `meta.id` + `issuedAt`; internal: + `engineVersion`, `premisesVersion`, `result.premisesHash` | ✅ (sem hash) | ✅ (sem hash) | ✅ (com motor/premissas/hash) |
| **Contracapa** | estático + eyebrow de perfil | ✅ | ✅ | ✅ |

> **Garantia estrutural:** as linhas ⛔ em `client`/`commercial` **não dependem** de o gerador
> "lembrar" de esconder — os campos simplesmente **não existem** no payload dessas views
> (`result` é `null`, `commercial` é `null` em client). O fullstack deve **guardar cada bloco
> por `typeof`/presença do campo**, nunca por um flag de audience mutável. É exatamente o que o
> `pdf.ts` atual já faz (`if (internal && result)` / `if (commercial)`): preservar esse padrão.

---

## 4. Checklist de implementação para o `product-fullstack`

Ordem das seções (fluxo de leitura único; quebras de página automáticas via `ensure()`):

1. **Capa** (pág. própria) — fundo navy full-bleed + logos + eyebrow de perfil + título
   (`clientName`) + subtítulo com palavra-destaque + pares de dados. `addPage()` ao fim.
2. **Resumo do investimento** — trio de KPIs em faixa navy (mensal/setup/TCV).
3. **Composição do TCV** — mensal×prazo + setup + nota de prazo se `termMonths>12`.
4. **Resumo executivo** — parágrafo de abertura (texto atual preservado).
5. **Soluções contratadas** — plano, módulos, base de usuários, equipe dedicada.
6. **Projeção por engajamento** — tabela 3 cenários (header-band navy + linhas).
7. **[commercial+internal] Detalhamento comercial** — waterfall → composição de preço →
   setup detalhado → engajamento MAU/DAU → alçada → sinais de política.
   *Condicional:* `if (commercial)` (presença de `composition`/`waterfall`/`setup`).
8. **[internal] Blocos internos** — composição da mensalidade → custos/margens → fees Minu →
   avisos. *Condicional:* `if (internal && result)`.
9. **Condições comerciais** — tabela 2-colunas (validade 30d, sujeito a assinatura) + próximos
   passos. Comum a todos os perfis.
10. **Contracapa** (pág. própria) — espelha a capa, título "Obrigado pela oportunidade".
11. **Rodapé** — loop final em todas as páginas; numeração `pág. x/y`; detalhe de motor/
    premissas/hash **só** quando `internal && result`.

Pontos de atenção:
- **Quebra de página:** manter o helper `ensure(need)`; para capa/contracapa forçar página
  dedicada (`addPage()` antes do bloco de fundo navy full-bleed).
- **Condicionalidade por perfil:** sempre por presença de campo (`commercial`/`result` não
  nulos), nunca por parâmetro de audience — regra do §3.
- **Fontes:** ver §5 (decisão de família). Se mantiver Helvetica, aplicar a HIERARQUIA de
  tamanhos/pesos da §2.2; se adotar Space Grotesk + Geist Mono, registrar as fontes no jsPDF
  (`addFileToVFS`+`addFont`) e trocar os `setFont`.
- **Tabelas:** header-band navy + rótulo-esq/numérico-dir + separadores finos; números sempre
  na fonte mono (Geist Mono na ref) para alinhamento de dígitos.
- **Verificação:** rodar os testes de confidencialidade existentes
  (`pdf.confidentiality.test.ts`, `pdf.test.ts`) após o redesign — eles são o gate de que
  nenhum campo interno vazou para client/commercial.

---

## 5. Divergências referência × design system atual + recomendação

| Item | Referência `[Ref]` | DS/gerador atual `[DS]`/`[Atual]` | Recomendação |
|------|--------------------|-----------------------------------|--------------|
| **Navy** | `#12215E` (`0.07 0.13 0.37`) | `--base-navy-700 #2a2470` (mais roxo/claro) | **[Hipótese/Recomendação]** Adotar um token `--pdf-navy` = navy da ref para a peça, mantendo o navy do DS nas telas. A peça comercial ganha identidade mais "séria"; não força mudança no app. Consultar sponsor se o navy deve virar o navy oficial da marca. |
| **Cor de destaque** | **Verde-limão `#C2FF01`** | **Amber `#ffc81e`** (cor-assinatura Bondly no DS) | **[Hipótese/Recomendação] — decisão de marca, precisa de aprovação.** O DS inteiro é construído sobre o amber. Trocar por verde-limão na peça cria **inconsistência de marca** entre PDF e produto. Recomendo **manter o amber do DS** como destaque e tratar o verde-limão como escolha pontual do exemplo do sponsor — **salvo** direção explícita do sponsor de migrar a marca para verde-limão. Flag para o `project-book` registrar a decisão. |
| **Tipografia** | **Space Grotesk + Geist Mono** | DS: **Montserrat + Anton**; gerador: **Helvetica** (core, sem embed) | **[Inferência/Recomendação]** 3 famílias distintas em jogo. Opções: (a) **menor esforço** — manter Helvetica no PDF mas aplicar a HIERARQUIA da §2.2 (resolve 80% do "cara de proposta" com números mono via Courier para tabelas); (b) **fiel ao DS** — embutir Montserrat (texto) + usar Courier/mono para números; (c) **fiel à ref** — embutir Space Grotesk + Geist Mono. Recomendo **(b)** para casar com a identidade do produto; (c) só se o sponsor exigir paridade exata com o exemplo. |
| **Rótulo de seção** | Kicker mono caixa-alta + título 17 pt + faixa navy | Traço amber 22×4 pt + título 13 pt | **[Recomendação]** Adotar o padrão da ref (kicker mono + faixa navy) — hierarquia mais clara e escalável para doc multipágina. |
| **Margem** | `51 pt` | `56 pt` | **[Inferência]** Diferença cosmética (~5 pt). Padronizar em `51 pt` para igualar o grid da ref; baixo risco. |
| **Trio de KPIs** | Sim (faixa navy, 3 colunas) | Não — card sand único com 3 números soltos | **[Recomendação]** Adotar o trio de KPIs em faixa navy para o "Resumo do investimento": leitura mais forte do número-âncora (mensal/setup/TCV). |
| **Separadores de tabela** | Cinza-azulado `#D4D9E3` | Sand `#e1ddd0` | **[Inferência]** Alinhar ao cinza da ref dentro de tabelas; manter sand em superfícies de card. |
| **Contracapa** | Sim (página de fecho navy) | **Não existe** no gerador atual | **[Recomendação]** Adicionar contracapa "Obrigado pela oportunidade" — fecha a peça com profissionalismo; custo baixo (espelha a capa). |

> **Itens que exigem decisão do sponsor antes de implementar** (encaminhar ao `project-book`
> para registro): (1) cor de destaque **amber vs verde-limão** (impacto de marca); (2) família
> tipográfica oficial da peça; (3) se o navy da ref deve substituir o navy do DS. Enquanto não
> houver direção, o fullstack deve implementar **estrutura/hierarquia/contracapa/KPIs** (baixo
> risco, alto ganho) e deixar **cor-destaque e fontes** parametrizados por token para troca
> trivial depois.

---

## 6. Status de implementação (preenchido pelo product-fullstack)

> Redesign aplicado em `apps/commercial-workspace/src/services/pdf.ts` conforme §1–§4. Sem commit/push/AWS.
> Verificação em docs/14 ("Resposta do autor — redesign PDF"). VERIFIED pendente (Guardian/PRR).

| Item da spec | Status | Observação |
|--------------|:------:|-----------|
| **§2.1 Paleta** navy `#12215E`, verde-limão `#C2FF01`, azul-névoa, cinza-ardósia, branco-gelo, linha `#D4D9E3` | ✅ | tokens centralizados no topo de `pdf.ts` (troca trivial) |
| **§2.2 Tipografia** Space Grotesk + Geist Mono embutidas (hierarquia 34/30/20/17/15/12,5/10/9/8/7,5 pt) | ✅ | `pdfFonts.ts` (VFS) + `assets/pdfFonts.ts` (TTF base64); fallback marcado Helvetica/Courier |
| **§2.3 Margem 51pt / grid / faixas / rodapé pág. x/y** | ✅ | `M=51`; rodapé em `y≈H-21.5` em todas as páginas |
| **§4.1 Capa** navy full-bleed + logo + eyebrow de perfil + título 34pt + subtítulo 20pt (2ª palavra verde-limão) + pares | ✅ | `drawCover()` |
| **§4.2 Resumo do investimento** trio de KPIs em faixa navy (mensal/setup/TCV) | ✅ | `kpiBand()` |
| **§4.3 Composição do TCV** (mensal×prazo + setup + nota de prazo) | ✅ | nota se `termMonths>12` |
| **§4.4 Resumo executivo** · **§4.5 Soluções contratadas** · **§4.6 Projeção por engajamento** (3 cenários) | ✅ | tabelas com header-band navy |
| **§4.7 [commercial] Detalhamento comercial** waterfall → composição de preço → setup → engajamento/alçada → sinais de política | ✅ | `if (commercial)`; label `Taxa de plataforma` (não "Platform Fee") preserva o termo-gate |
| **§4.8 [internal] Blocos internos** composição mensalidade → custos/margens → fee Minu → avisos | ✅ | `if (internal && result)` |
| **§4.9 Condições comerciais** (2 colunas) · **§4.10 Contracapa** "Obrigado pela oportunidade" 30pt | ✅ | contracapa espelha a capa |
| **§4.11 Rodapé** motor/premissas/hash só em `internal && result` | ✅ | — |
| **§3 Confidencialidade por presença de campo** | ✅ | gate `pdf.confidentiality.test.ts` passa sem afrouxar asserções |

**Decisões resolvidas pela direção do sponsor (eram "exigem decisão" na §5):** (1) destaque = **verde-limão**;
(2) tipografia = **Space Grotesk + Geist Mono**; (3) navy da peça = `#12215E` (navy do DS das telas inalterado).

**Fonte das fontes:** `@fontsource/space-grotesk` + `@fontsource/geist-mono` (SIL OFL 1.1), subset latin,
woff2→TTF via `wawoff2`. Geração: `scripts/build-pdf-fonts.mjs`. Atribuição: `apps/commercial-workspace/src/assets/OFL.md`.
