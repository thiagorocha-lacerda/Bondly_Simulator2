import type { jsPDF } from 'jspdf';
import { MODULE_CATALOG } from '@bondly/pricing-catalog';
import type { ClientQuote, CommercialQuote, InternalQuote, QuoteViewPayload } from './pricing/quoteTypes';
import { brl, pct } from './defaults';

/**
 * Gerador do PDF da proposta (§16) — G-001-A Fase 4.
 *
 * FONTE DE VERDADE: o QuoteView PROJETADO PELO SERVIDOR (contrato `quote.v1`, apps/auth-proxy/src/quoteProjection.ts),
 * a MESMA origem que as telas consomem via `useCentralPricing`. Este módulo NÃO importa o Pricing Engine nem as tabelas
 * de custo/premissas: ele só FORMATA o que o servidor já decidiu enviar para o perfil. A fronteira de confidencialidade
 * (§12/§16, CWE-200) é portanto ESTRUTURAL — não depende de o gerador "lembrar" de esconder nada:
 *   - view 'client'/'commercial'  → PEÇA EXTERNA (cliente): o payload NÃO CONTÉM custo, COGS, margem, tributo nem fee
 *     Minu (não há de onde vazar). Mostra preço/mensalidade/Setup/descontos/TCV/condições/cenários.
 *   - view 'internal' (só perfil com proposal.see_internal)  → PEÇA COMPLETA: acrescenta composição da mensalidade,
 *     COGS, margens, alçada e fees Minu, lidos de `view.result` (PricingResult completo do engine, projetado só aqui).
 *
 * jsPDF e o logo (data URL ~22KB) carregam via import() dinâmico (code-splitting, §27.1).
 */

const NAVY = '#2a2470';
const AMBER = '#ffc81e';
const INK = '#12131c';
const INK_SOFT = '#3e4152';
const MUTED = '#5f6479';
const SAND = '#f6f4ee';
const SAND_LINE = '#e1ddd0';

const moduleName = (id: string): string => MODULE_CATALOG.find((m) => m.id === id)?.name ?? id;

/** Metadados fora do contrato de preço (identidade/emissão). Nome do cliente é dado comercial, não do engine. */
export interface QuotePdfMeta {
  readonly id: string;
  readonly issuedAt: string;
  readonly clientName?: string;
  /** Módulos contratados (ids do catálogo público). Vêm da seleção da tela, não do preço. */
  readonly selectedModules?: readonly string[];
  /** Base de usuários elegíveis — número comercial exibido na peça (não é custo/margem). */
  readonly users?: number;
}

/**
 * Gera o PDF a partir do QuoteView projetado pelo servidor. A AUDIENCE é DERIVADA da `view`:
 * 'internal' ⇒ peça completa; 'client'/'commercial' ⇒ peça externa (cliente). Não há parâmetro de audience que
 * possa "forçar" interno sobre um payload externo: se o campo interno não veio no payload, ele não existe no PDF.
 */
export async function generateQuotePdf(quote: QuoteViewPayload, meta: QuotePdfMeta): Promise<jsPDF> {
  const internal = quote.view === 'internal';
  const result = internal ? (quote as InternalQuote).result : null;
  const commercial = quote.view !== 'client' ? (quote as CommercialQuote) : null;
  const client = quote as ClientQuote;

  const { jsPDF: JsPDF } = await import('jspdf');
  const { BONDLY_LOGO_PNG, BONDLY_LOGO_W, BONDLY_LOGO_H } = await import('../assets/logo');
  const doc = new JsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;
  const cw = W - 2 * M;

  // ---- helpers -------------------------------------------------------------
  let y = 0;
  const ensure = (need: number) => {
    if (y > H - need) {
      doc.addPage();
      y = 64;
    }
  };
  const sectionTitle = (text: string) => {
    ensure(70);
    y += 10;
    doc.setFillColor(AMBER);
    doc.rect(M, y - 9, 22, 4, 'F'); // traço amber da marca
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(NAVY);
    doc.text(text.toUpperCase(), M, y + 6);
    y += 24;
  };
  const kv = (k: string, v: string, strong = false) => {
    // Layout em 2 colunas com QUEBRA no valor: chave à esquerda (até ~46% da largura),
    // valor à direita alinhado, podendo ocupar várias linhas — evita estouro/sobreposição.
    const keyW = cw * 0.46;
    const valW = cw * 0.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const keyLines = doc.splitTextToSize(k, keyW) as string[];
    doc.setFont('helvetica', strong ? 'bold' : 'normal');
    doc.setFontSize(strong ? 12 : 11);
    const valLines = doc.splitTextToSize(v, valW) as string[];
    const rows = Math.max(keyLines.length, valLines.length);
    const rowH = 15;
    const blockH = rows * rowH + 10;
    ensure(blockH + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(INK_SOFT);
    doc.text(keyLines, M, y);
    doc.setFont('helvetica', strong ? 'bold' : 'normal');
    doc.setFontSize(strong ? 12 : 11);
    doc.setTextColor(INK);
    doc.text(valLines, W - M, y, { align: 'right' });
    y += blockH;
    doc.setDrawColor(SAND_LINE);
    doc.line(M, y - 8, W - M, y - 8);
  };
  const paragraph = (text: string, color = INK_SOFT, size = 11) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines = doc.splitTextToSize(text, cw);
    ensure(lines.length * (size + 4) + 10);
    doc.text(lines, M, y);
    y += lines.length * (size + 4) + 6;
  };

  // ---- CAPA ----------------------------------------------------------------
  doc.setFillColor(NAVY);
  doc.rect(0, 0, W, 210, 'F');
  doc.setFillColor(AMBER);
  doc.rect(0, 210, W, 6, 'F');

  const logoW = 150;
  const logoH = (logoW * BONDLY_LOGO_H) / BONDLY_LOGO_W;
  const cardPadX = 18;
  const cardPadY = 14;
  doc.setFillColor('#ffffff');
  doc.roundedRect(M, 40, logoW + cardPadX * 2, logoH + cardPadY * 2, 8, 8, 'F');
  doc.addImage(BONDLY_LOGO_PNG, 'PNG', M + cardPadX, 40 + cardPadY, logoW, logoH);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(AMBER);
  doc.text(internal ? 'PROPOSTA · USO INTERNO · 2027' : 'PROPOSTA COMERCIAL · 2027', M, 150);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor('#ffffff');
  const clientName = meta.clientName?.trim() || 'Programa de Fidelidade';
  doc.text(doc.splitTextToSize(clientName, cw), M, 180);

  y = 250;

  // ---- ABERTURA ------------------------------------------------------------
  const usersLabel =
    typeof meta.users === 'number' && meta.users > 0
      ? `uma base de ${meta.users.toLocaleString('pt-BR')} usuários elegíveis em `
      : '';
  paragraph(
    `Esta proposta apresenta o investimento e o alcance do programa de fidelidade Bondly para ` +
      `${clientName}, dimensionado para ${usersLabel}um contrato de ${client.termMonths} meses.`,
    INK_SOFT,
    12,
  );
  y += 4;

  // ---- INVESTIMENTO (destaque) --------------------------------------------
  sectionTitle('Investimento');
  const cardH = 100;
  ensure(cardH + 20);
  const cardTop = y - 4;
  doc.setFillColor(SAND);
  doc.roundedRect(M, cardTop, cw, cardH, 10, 10, 'F');
  const padX = 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(MUTED);
  doc.text('Investimento mensal estimado', M + padX, cardTop + 26);
  const monthly = `${brl(client.pricing.monthly)}/mês`;
  const leftW = cw * 0.56 - padX;
  let mSize = 28;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(mSize);
  while (doc.getTextWidth(monthly) > leftW && mSize > 16) {
    mSize -= 1;
    doc.setFontSize(mSize);
  }
  doc.setTextColor(NAVY);
  doc.text(monthly, M + padX, cardTop + 62);
  const rx = W - M - padX;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text('Setup (único)', rx, cardTop + 24, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(INK);
  doc.text(brl(client.pricing.setupTotal), rx, cardTop + 42, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text('Total no 1º ano', rx, cardTop + 68, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(INK);
  doc.text(brl(client.pricing.firstYearTotal), rx, cardTop + 86, { align: 'right' });
  y = cardTop + cardH + 18;

  kv('Valor total do contrato (TCV)', brl(client.pricing.tcv), true);
  if (client.termMonths > 12) {
    kv('Condição especial de prazo', `contrato de ${client.termMonths} meses`);
  }

  // ---- ESCOPO (benefícios) -------------------------------------------------
  sectionTitle('O que está incluído');
  paragraph(
    'A plataforma Bondly entrega o programa de ponta a ponta: motor de pontos e engajamento, ' +
      'régua de comunicação com o participante e operação gerenciada — pronta para escalar com a sua base.',
  );
  kv('Plano', client.plan.name);
  if (typeof meta.users === 'number' && meta.users > 0) {
    kv('Base de usuários elegíveis', meta.users.toLocaleString('pt-BR'));
  }
  if (meta.selectedModules && meta.selectedModules.length > 0) {
    kv('Módulos contratados', meta.selectedModules.map(moduleName).join(', '));
  }
  kv('Prazo do contrato', `${client.termMonths} meses`);
  if (client.pricing.servicesMonthly > 0) kv('Equipe dedicada (recorrente)', `${brl(client.pricing.servicesMonthly)}/mês`);

  // ---- PROJEÇÃO DE ENGAJAMENTO (cenários §13, só preço ao cliente) --------
  sectionTitle('Projeção por engajamento');
  paragraph(
    'Como o programa acompanha o uso real, projetamos três cenários variando o engajamento mensal ' +
      'da base em ±30%. Os valores abaixo são o que o programa representa em cada cenário.',
  );
  const cLabels: Record<string, string> = {
    conservador: 'Conservador (−30%)',
    base: 'Base',
    otimista: 'Otimista (+30%)',
  };
  if (client.scenarios.length > 0) {
    ensure(30 + client.scenarios.length * 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(INK_SOFT);
    doc.text('Cenário', M, y);
    doc.text('Mensal', W - M - 170, y, { align: 'right' });
    doc.text('Total do contrato', W - M, y, { align: 'right' });
    y += 8;
    doc.setDrawColor(SAND_LINE);
    doc.line(M, y, W - M, y);
    y += 16;
    for (const s of client.scenarios) {
      const isBase = s.name === 'base';
      doc.setFont('helvetica', isBase ? 'bold' : 'normal');
      doc.setFontSize(10);
      doc.setTextColor(isBase ? NAVY : INK);
      doc.text(cLabels[s.name] ?? s.name, M, y);
      doc.text(`${brl(s.monthly)}/mês`, W - M - 170, y, { align: 'right' });
      doc.text(brl(s.tcv), W - M, y, { align: 'right' });
      y += 19;
    }
  }

  // ---- SEÇÕES INTERNAS (uso interno apenas; lidas de quote.result) --------
  // Estruturalmente inalcançáveis na peça externa: `result`/`composition`/`waterfall`/fees Minu só existem
  // no payload quando view==='internal'. Para client/commercial, `result` é null e `commercial` pode ser null.
  if (internal && result) {
    sectionTitle('Composição da mensalidade (interno)');
    kv('Platform Fee', `${brl(result.platformFee)}/mês`);
    kv('DAU Usage', `${brl(result.usage)}/mês`);
    kv('Processing', `${brl(result.processing)}/mês`);
    if (result.servicesMrr > 0) kv('Recursos dedicados', `${brl(result.servicesMrr)}/mês`);
    kv('Receita recorrente Core', `${brl(result.core)}/mês`, true);

    sectionTitle('Custos e margens (interno)');
    kv('Custo variável (COGS)', `${brl(result.costs.total)}/mês`);
    paragraph(
      `CleverTap ${brl(result.costs.cleverTap)} · infra ${brl(result.costs.infra)} · NF ${brl(result.costs.invoices)} · ` +
        `comunicação ${brl(result.costs.communication)}`,
      MUTED,
      10,
    );
    kv('Margem técnica', pct(result.technicalMargin), true);
    kv('Margem líquida (Y1 / regime)', `${pct(result.netMarginY1)} / ${pct(result.netMarginSteady)}`);
    kv('Status de margem', result.marginStatus);
    kv('Alçada de desconto', result.discountAuthority);
    if (result.minuConversionFee > 0 || result.minuAccountFee > 0 || result.minuYear1 > 0) {
      kv('Fee Minu — conversão (mês)', brl(result.minuConversionFee));
      kv('Fee Minu — conta (mês)', brl(result.minuAccountFee));
      kv('Minu ganha no 1º ano', brl(result.minuYear1));
    }
    // Sinais de política que o servidor marcou (sem valores): alertas de margem/alçada do engine.
    if (commercial) {
      const { marginAlert, flags } = commercial.policy;
      kv('Sinal de margem', `${marginAlert.level}${marginAlert.requiresApproval ? ' · requer aprovação' : ''}`);
      if (flags.length > 0) paragraph('Flags de política: ' + flags.join(', '), MUTED, 10);
    }
    if (result.warnings.length > 0) {
      paragraph('Alertas: ' + result.warnings.map((w) => w.message).join(' '), MUTED, 10);
    }
  }

  // ---- PRÓXIMOS PASSOS -----------------------------------------------------
  sectionTitle('Próximos passos');
  paragraph(
    '1. Validação desta proposta pelo time.  2. Alinhamento de escopo e cronograma de implantação.  ' +
      '3. Formalização do contrato e início do onboarding.',
  );
  const valid = new Date(meta.issuedAt);
  valid.setDate(valid.getDate() + 30);
  paragraph(
    `Proposta válida até ${valid.toLocaleDateString('pt-BR')}. ` +
      `Condições sujeitas a confirmação na assinatura do contrato.`,
    MUTED,
    10,
  );

  // ---- RODAPÉ (discreto, em todas as páginas) -----------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(SAND_LINE);
    doc.line(M, H - 44, W - M, H - 44);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text(internal ? `Bondly · Proposta ${meta.id} · USO INTERNO` : `Bondly · Proposta ${meta.id}`, M, H - 30);
    // premisesHash só existe em `result` (interno). Na peça externa, a data de emissão é suficiente.
    const right = internal && result
      ? `Motor ${quote.engineVersion} · premissas ${quote.premisesVersion} (${result.premisesHash}) · pág. ${p}/${pages}`
      : `Emitida em ${new Date(meta.issuedAt).toLocaleDateString('pt-BR')} · pág. ${p}/${pages}`;
    doc.text(right, W - M, H - 30, { align: 'right' });
  }

  return doc;
}
