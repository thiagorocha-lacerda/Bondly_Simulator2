import { describe, it, expect } from 'vitest';
import { createProposalSnapshot } from '@bondly/pricing-engine';
import { projectQuotePreview } from './pricing/devEngine';
import { generateQuotePdf } from './pdf';
import { DEFAULT_INPUT } from './defaults';

/**
 * Smoke test do gerador de PDF: usa a API real do jsPDF 4.x (addImage/roundedRect/splitTextToSize/
 * getNumberOfPages/setPage) e produz um %PDF- válido a partir de um QuoteView real PROJETADO pelo servidor
 * (não de um cálculo local). Garante que a peça não quebra em runtime e que a interna é maior que a externa.
 */
function viewFor(view: 'client' | 'commercial' | 'internal', input = DEFAULT_INPUT, modules?: readonly string[]) {
  const snap = createProposalSnapshot({ id: 'BONDLY-2027-000001', input, ...(modules ? { selectedModules: modules as never } : {}) });
  const scenarios = snap.scenarios.map((s) => ({ name: s.name, result: s.result }));
  return projectQuotePreview(view, snap.result, snap.input.negotiation.term, scenarios);
}
const META = { id: 'BONDLY-2027-000001', issuedAt: '2027-02-01T00:00:00.000Z', clientName: 'ACME', users: DEFAULT_INPUT.volume.users };

describe('generateQuotePdf — peça comercial a partir do QuoteView', () => {
  it('gera um PDF válido (view client)', async () => {
    const doc = await generateQuotePdf(viewFor('client'), { ...META, clientName: '' });
    const buf = doc.output('arraybuffer');
    const head = String.fromCharCode(...new Uint8Array(buf.slice(0, 5)));
    expect(head).toBe('%PDF-');
    expect(buf.byteLength).toBeGreaterThan(1000);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('gera PDF para view commercial (peça externa com descontos/alçada no dado, mas sem custo no PDF)', async () => {
    const doc = await generateQuotePdf(viewFor('commercial'), META);
    const head = String.fromCharCode(...new Uint8Array(doc.output('arraybuffer').slice(0, 5)));
    expect(head).toBe('%PDF-');
  });

  it('PDF interno tem mais conteúdo que o externo (seções internas)', async () => {
    const ext = await generateQuotePdf(viewFor('commercial', DEFAULT_INPUT, ['points', 'engagement']), META);
    const int = await generateQuotePdf(viewFor('internal', DEFAULT_INPUT, ['points', 'engagement']), META);
    expect(int.output('arraybuffer').byteLength).toBeGreaterThan(ext.output('arraybuffer').byteLength);
  });
});
