# Fontes do PDF da proposta — atribuição (SIL Open Font License 1.1)

O gerador de PDF (`src/services/pdf.ts`) embute duas famílias tipográficas livres,
convertidas para o VFS do jsPDF em `src/assets/pdfFonts.ts` (gerado por
`scripts/build-pdf-fonts.mjs` a partir dos pacotes `@fontsource`, subset `latin`).

| Família | Papel na peça | Origem | Copyright | Licença |
|---------|---------------|--------|-----------|---------|
| **Space Grotesk** | títulos, subtítulos, corpo | [`@fontsource/space-grotesk`](https://www.npmjs.com/package/@fontsource/space-grotesk) · [projeto](https://github.com/floriankarsten/space-grotesk) | Copyright 2020 The Space Grotesk Project Authors | SIL OFL 1.1 |
| **Geist Mono** | números tabulares, eyebrows, labels, rodapé | [`@fontsource/geist-mono`](https://www.npmjs.com/package/@fontsource/geist-mono) · [projeto](https://github.com/vercel/geist-font) | Copyright 2024 The Geist Project Authors | SIL OFL 1.1 |

A SIL OFL 1.1 permite uso, embute e redistribuição (inclusive embutida em documentos/PDF)
sem royalties, desde que a licença acompanhe o Font Software e que os nomes das famílias
não sejam usados para promover trabalhos derivados sem permissão. O texto integral da
licença está em `node_modules/@fontsource/<família>/LICENSE`.

> Decisão do sponsor (docs/20 §2.2): replicar a referência à risca com Space Grotesk +
> Geist Mono. As fontes carregam **sob demanda** no caminho do PDF (DEV-gated), fora do
> bundle principal de produção — ver `scripts/check-bundle.mjs`.
