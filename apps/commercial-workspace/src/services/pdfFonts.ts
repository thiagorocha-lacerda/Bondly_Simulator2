import type { jsPDF } from 'jspdf';

/**
 * Registra as fontes da peça (Space Grotesk + Geist Mono, docs/20 §2.2) no VFS do jsPDF.
 *
 * É importado por `pdf.ts` via `import()` DINÂMICO, junto do bundle de base64 das fontes (`../assets/pdfFonts`),
 * para que o peso (~104KB TTF) fique num CHUNK SEPARADO. Como o único caller do PDF (`PreviewModal.download`)
 * está atrás de um guard literal `import.meta.env.DEV`, o Rollup faz DCE do `import('../services/pdf')` no build
 * de produção — e, por transitividade, deste módulo e das fontes. Logo o peso NÃO entra no bundle principal de
 * prod (provado por scripts/check-bundle.mjs: 0 identificadores proibidos; o chunk de fonte não é referenciado).
 *
 * Nomes de fonte expostos ao jsPDF e usados em pdf.ts via `doc.setFont(family, style)`:
 *   - 'SpaceGrotesk'  normal | bold
 *   - 'GeistMono'     normal (400) | medium (500, registrado como estilo 'medium')
 */
export async function registerPdfFonts(doc: jsPDF): Promise<{ sans: string; mono: string }> {
  const f = await import('../assets/pdfFonts');
  // addFileToVFS + addFont: grava o TTF base64 no sistema de arquivos virtual e o liga a (família, estilo).
  doc.addFileToVFS('SpaceGrotesk-Regular.ttf', f.SPACE_GROTESK_REGULAR);
  doc.addFont('SpaceGrotesk-Regular.ttf', 'SpaceGrotesk', 'normal');
  doc.addFileToVFS('SpaceGrotesk-Bold.ttf', f.SPACE_GROTESK_BOLD);
  doc.addFont('SpaceGrotesk-Bold.ttf', 'SpaceGrotesk', 'bold');
  doc.addFileToVFS('GeistMono-Regular.ttf', f.GEIST_MONO_REGULAR);
  doc.addFont('GeistMono-Regular.ttf', 'GeistMono', 'normal');
  doc.addFileToVFS('GeistMono-Medium.ttf', f.GEIST_MONO_MEDIUM);
  doc.addFont('GeistMono-Medium.ttf', 'GeistMono', 'medium');
  return { sans: 'SpaceGrotesk', mono: 'GeistMono' };
}
