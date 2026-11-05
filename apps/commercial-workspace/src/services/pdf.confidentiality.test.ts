import { describe, it, expect, vi } from 'vitest';
import { createProposalSnapshot } from '@bondly/pricing-engine';
// Projeção por perfil: em DEV usamos `projectQuotePreview`, o ESPELHO do servidor cujos campos são travados
// contra apps/auth-proxy/src/quoteProjection.ts por quoteTypes.sync.test.ts. Assim o PDF é provado contra o
// MESMO formato de QuoteView que o fio de produção entrega, sem importar o auth-proxy no grafo do workspace.
import { projectQuotePreview } from './pricing/devEngine';
import type { QuoteViewName } from './pricing/quoteTypes';
import { DEFAULT_INPUT } from './defaults';

/**
 * Prova ESTRUTURAL de confidencialidade por PERFIL (§12/§16, G-001 Fase 4).
 *
 * O PDF é gerado a partir do QuoteView PROJETADO PELO SERVIDOR (client/commercial/internal). A fronteira é
 * estrutural: a peça do cliente nasce de um payload que NÃO CONTÉM custo/COGS/margem/tributo/fee Minu — não há
 * de onde vazar. Capturamos TODO texto que o gerador escreve (interceptando doc.text via mock do jsPDF) e, além
 * disso, varremos o PRÓPRIO PAYLOAD (JSON) para provar que os campos internos sequer existem no dado de origem.
 *
 * Perfis cobertos (mapeamento RBAC → view, docs/03/quoteProjection):
 *   business / approver  → view 'commercial'  → PEÇA EXTERNA (sem interno)
 *   tech / admin         → view 'internal'    → PEÇA COMPLETA (com interno)
 *   cliente final        → view 'client'      → PEÇA EXTERNA (sem interno)
 */
const captured: string[] = [];
vi.mock('jspdf', () => {
  class FakeDoc {
    internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setFillColor() {}
    setDrawColor() {}
    rect() {}
    roundedRect() {}
    line() {}
    addPage() {}
    setPage() {}
    getNumberOfPages() { return 1; }
    getTextWidth() { return 10; }
    splitTextToSize(t: string) { return [t]; }
    addImage() {}
    text(t: string | string[]) { captured.push(Array.isArray(t) ? t.join(' ') : t); }
    output() { return new ArrayBuffer(8); }
    save() {}
  }
  return { jsPDF: FakeDoc };
});
vi.mock('../assets/logo', () => ({ BONDLY_LOGO_PNG: 'data:image/png;base64,AA==', BONDLY_LOGO_W: 875, BONDLY_LOGO_H: 240 }));

/** Projeta um QuoteView real (via engine + projectQuote do servidor) para o perfil pedido. */
function viewFor(view: QuoteViewName) {
  const snap = createProposalSnapshot({
    id: 'BONDLY-2027-000123',
    input: { ...DEFAULT_INPUT, arka: { clientName: 'ACME', goLiveDate: '2027-03-01', owner: 'Ana', evidenceStage: 8, probability: 60 } },
    selectedModules: ['points', 'engagement'],
  });
  const scenarios = snap.scenarios.map((s) => ({ name: s.name, result: s.result }));
  return projectQuotePreview(view, snap.result, snap.input.negotiation.term, scenarios);
}

async function textsFor(view: QuoteViewName): Promise<string> {
  captured.length = 0;
  const { generateQuotePdf } = await import('./pdf');
  const quote = viewFor(view);
  await generateQuotePdf(quote, {
    id: 'BONDLY-2027-000123',
    issuedAt: '2027-02-01T00:00:00.000Z',
    clientName: 'ACME',
    selectedModules: ['points', 'engagement'],
    users: DEFAULT_INPUT.volume.users,
  });
  return captured.join('\n');
}

// Termos internos que a peça externa NUNCA pode conter (texto renderizado).
const INTERNAL_TERMS = [/COGS|Custo variável/i, /Margem técnica/i, /Platform Fee/i, /Fee Minu/i, /premissas v/i, /Composição da mensalidade/i];
// Chaves internas que não podem sequer existir no PAYLOAD de origem das peças externas.
const INTERNAL_PAYLOAD_KEYS = ['costs', 'taxes', 'technicalMargin', 'netMargin', 'tcvBondly', 'setupNet', 'premisesHash', 'minuConversionFee', '"result"'];

describe('PDF por perfil — confidencialidade estrutural (QuoteView)', () => {
  it("cliente (view 'client') NÃO expõe termo interno no texto nem campo interno no payload", async () => {
    const quote = viewFor('client');
    const payload = JSON.stringify(quote);
    for (const k of INTERNAL_PAYLOAD_KEYS) expect(payload).not.toContain(k);

    const t = await textsFor('client');
    for (const re of INTERNAL_TERMS) expect(t).not.toMatch(re);
    // Conteúdo esperado na peça externa (redesign docs/20 §4): KPI de investimento + módulos + eyebrow de perfil.
    expect(t).toMatch(/Resumo do investimento/i);
    expect(t).toMatch(/Motor de Pontos/i);
    expect(t).toMatch(/PROPOSTA COMERCIAL/i);
  });

  it("business/approver (view 'commercial') NÃO expõe custo/margem no texto nem no payload", async () => {
    const quote = viewFor('commercial');
    const payload = JSON.stringify(quote);
    // commercial carrega composição/waterfall/alçada, mas NUNCA custo/margem/tributo/fee Minu nem o PricingResult.
    for (const k of ['costs', 'taxes', 'technicalMargin', 'netMargin', 'tcvBondly', 'setupNet', 'premisesHash', 'minuConversionFee', '"result"']) {
      expect(payload).not.toContain(k);
    }
    const t = await textsFor('commercial');
    for (const re of INTERNAL_TERMS) expect(t).not.toMatch(re);
    expect(t).toMatch(/Resumo do investimento/i);
    expect(t).toMatch(/PROPOSTA COMERCIAL/i);
  });

  it("tech/admin (view 'internal') CONTÉM os termos internos (peça completa)", async () => {
    const t = await textsFor('internal');
    for (const re of INTERNAL_TERMS) expect(t).toMatch(re);
    expect(t).toMatch(/USO INTERNO/i);
    expect(t).toMatch(/Custo variável/i);
    expect(t).toMatch(/Margem técnica/i);
  });
});
