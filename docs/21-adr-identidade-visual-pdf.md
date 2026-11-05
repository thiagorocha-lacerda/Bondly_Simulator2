# 21 — ADR: Identidade visual do PDF diverge do design system do app (decisão de marca)

- Status: **DECIDIDO pelo sponsor (CTO)**, 2026-11-05. Implementação no PDF: FEITA. Verificação: Guardian/PRR.
- Origem: decisão de marca sinalizada como pendente pelo product-designer em [doc 20 §5](./20-spec-visual-pdf.md).
- Classe da decisão: produto/marca — Nível 2–3.

## Contexto
O **design system do app** usa amber `#ffc81e` como cor-assinatura e tipografia Montserrat/Anton. O exemplo de referência do sponsor para a peça comercial usa destaque **verde-limão `#C2FF01`** e fontes **Space Grotesk + Geist Mono** (SIL OFL). São identidades visuais diferentes.

## Decisão
O **PDF de proposta** replica À RISCA a referência do sponsor: destaque **verde-limão `#C2FF01`** e tipografia **Space Grotesk (títulos/corpo) + Geist Mono (números/labels)**. O app mantém amber + Montserrat/Anton.

## Consequência (ACEITA deliberadamente)
PDF e app **divergem** na identidade de marca, por decisão explícita do sponsor. Inconsistência amber (app) × verde-limão (PDF) é intencional nesta fase, não um defeito.

## Questão em aberto (não decidir agora — só registrar)
Reconciliar a marca no futuro, por uma de três vias: (a) app migra para verde-limão + Space Grotesk/Geist Mono; (b) PDF tratado como peça de identidade própria, divergência permanente; (c) revisão da decisão. **Nenhuma escolhida aqui.**

## Referências
- Spec visual e divergência DS×referência: [doc 20 §5](./20-spec-visual-pdf.md).
- Paleta no código: `apps/commercial-workspace/src/services/pdf.ts:26` (`const LIME = '#C2FF01'`).
- Fontes no código: `apps/commercial-workspace/src/services/pdfFonts.ts:19-20` (registro Space Grotesk/Geist Mono no VFS do jsPDF); licença em `apps/commercial-workspace/src/assets/OFL.md`.
