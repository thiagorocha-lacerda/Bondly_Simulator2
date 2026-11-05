import type { jsPDF } from 'jspdf';
import type { ProposalSnapshot } from '@bondly/pricing-types';
import { MODULE_CATALOG } from '@bondly/pricing-catalog';
import { loadDevEngine } from './pricing/devEngine';
import { brl, pct } from './defaults';

/**
 * Gerador do PDF da proposta (§16). Consome EXCLUSIVAMENTE o snapshot do Pricing Engine
 * (paridade Engine = Dashboard = PDF, §20). Dois públicos:
 *   - audience='external' (padrão): PEÇA COMERCIAL para o CLIENTE — foca valor/investimento;
 *     NÃO expõe custos, margens, fees internos, ARKA nem o resultado Bondly do B2C (§12/§16).
 *   - audience='internal': PROPOSTA COMPLETA para uso interno — acrescenta composição da
 *     mensalidade, COGS, margens, alçada, ARKA e o resultado Bondly/Minu do B2C.
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

export async function generateProposalPdf(
  snap: ProposalSnapshot,
  audience: 'internal' | 'external' = 'external',
): Promise<jsPDF> {
  const internal = audience === 'internal';
  const { jsPDF: JsPDF } = await import('jspdf');
  const { BONDLY_LOGO_PNG, BONDLY_LOGO_W, BONDLY_LOGO_H } = await import('../assets/logo');
  const r = snap.result;
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
    // Layout em 2 colunas com QUEBRA no valor: chave à esquerda (até ~48% da largura),
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
    // chave
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(INK_SOFT);
    doc.text(keyLines, M, y);
    // valor (alinhado à direita)
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
  // Faixa navy no topo com o traço amber; o logo vai num cartão branco abaixo.
  doc.setFillColor(NAVY);
  doc.rect(0, 0, W, 210, 'F');
  doc.setFillColor(AMBER);
  doc.rect(0, 210, W, 6, 'F');

  // Logo num cartão branco (o PNG tem fundo branco — some no cartão).
  const logoW = 150;
  const logoH = (logoW * BONDLY_LOGO_H) / BONDLY_LOGO_W;
  const cardPadX = 18;
  const cardPadY = 14;
  doc.setFillColor('#ffffff');
  doc.roundedRect(M, 40, logoW + cardPadX * 2, logoH + cardPadY * 2, 8, 8, 'F');
  doc.addImage(BONDLY_LOGO_PNG, 'PNG', M + cardPadX, 40 + cardPadY, logoW, logoH);

  // Título e cliente na faixa navy
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(AMBER);
  doc.text(internal ? 'PROPOSTA · USO INTERNO · 2027' : 'PROPOSTA COMERCIAL · 2027', M, 150);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor('#ffffff');
  const clientName = snap.input.arka?.clientName?.trim() || 'Programa de Fidelidade';
  doc.text(doc.splitTextToSize(clientName, cw), M, 180);

  y = 250;

  // ---- ABERTURA ------------------------------------------------------------
  paragraph(
    `Esta proposta apresenta o investimento e o alcance do programa de fidelidade Bondly para ` +
      `${clientName}, dimensionado para uma base de ${snap.input.volume.users.toLocaleString('pt-BR')} ` +
      `usuários elegíveis em um contrato de ${snap.input.negotiation.term} meses.`,
    INK_SOFT,
    12,
  );
  y += 4;

  // ---- INVESTIMENTO (destaque) --------------------------------------------
  sectionTitle('Investimento');
  // Cartão de destaque: valor mensal grande à esquerda; Setup e 1º ano empilhados à direita.
  const cardH = 100;
  ensure(cardH + 20);
  const cardTop = y - 4;
  doc.setFillColor(SAND);
  doc.roundedRect(M, cardTop, cw, cardH, 10, 10, 'F');
  const padX = 20;
  // rótulo + valor mensal (fonte ajustada para caber na metade esquerda)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(MUTED);
  doc.text('Investimento mensal estimado', M + padX, cardTop + 26);
  const monthly = `${brl(r.core + r.servicesMrr)}/mês`;
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
  // coluna direita: dois valores empilhados
  const rx = W - M - padX;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text('Setup (único)', rx, cardTop + 24, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(INK);
  doc.text(brl(r.setupClient), rx, cardTop + 42, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text('Total no 1º ano', rx, cardTop + 68, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(INK);
  doc.text(brl(r.clientYear1), rx, cardTop + 86, { align: 'right' });
  y = cardTop + cardH + 18;

  kv('Valor total do contrato (TCV)', brl(r.tcvClient), true);
  if (snap.input.negotiation.term > 12) {
    kv('Condição especial de prazo', `contrato de ${snap.input.negotiation.term} meses`);
  }

  // ---- ESCOPO (benefícios) -------------------------------------------------
  sectionTitle('O que está incluído');
  paragraph(
    'A plataforma Bondly entrega o programa de ponta a ponta: motor de pontos e engajamento, ' +
      'régua de comunicação com o participante e operação gerenciada — pronta para escalar com a sua base.',
  );
  kv('Plano', r.tierName);
  kv('Base de usuários elegíveis', snap.input.volume.users.toLocaleString('pt-BR'));
  if (snap.selectedModules && snap.selectedModules.length > 0) {
    kv('Módulos contratados', snap.selectedModules.map(moduleName).join(', '));
  } else {
    kv('Módulos contratados', `${Math.max(1, snap.input.complexity.modules)} módulo(s)`);
  }
  kv('Prazo do contrato', `${snap.input.negotiation.term} meses`);
  if (r.servicesMrr > 0) kv('Equipe dedicada (recorrente)', `${brl(r.servicesMrr)}/mês`);

  // ---- PROJEÇÃO DE ENGAJAMENTO (cenários §13, só receita) -----------------
  sectionTitle('Projeção por engajamento');
  paragraph(
    'Como o programa acompanha o uso real, projetamos três cenários variando o engajamento mensal ' +
      'da base em ±30%. Os valores abaixo são o que o programa representa em cada cenário.',
  );
  ensure(30 + snap.scenarios.length * 20);
  const cLabels: Record<string, string> = {
    conservador: 'Conservador (−30%)',
    base: 'Base',
    otimista: 'Otimista (+30%)',
  };
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
  for (const s of snap.scenarios) {
    const isBase = s.name === 'base';
    doc.setFont('helvetica', isBase ? 'bold' : 'normal');
    doc.setFontSize(10);
    doc.setTextColor(isBase ? NAVY : INK);
    doc.text(cLabels[s.name] ?? s.name, M, y);
    doc.text(`${brl(s.result.core)}/mês`, W - M - 170, y, { align: 'right' });
    doc.text(brl(s.result.tcvClient), W - M, y, { align: 'right' });
    y += 19;
  }

  // ---- B2C (quando incluído) ----------------------------------------------
  if (snap.b2c) {
    const b = snap.b2c.result.tot;
    sectionTitle('Assinaturas B2C · 2º semestre de 2027');
    if (internal) {
      paragraph('Projeção do produto de assinaturas no 2º semestre de 2027, com o resultado Bondly e o split com a Minu.');
      kv('Assinantes ativos em dezembro', b.end.toLocaleString('pt-BR', { maximumFractionDigits: 0 }));
      kv('Valor transacionado no semestre (GMV)', brl(b.gmv));
      kv('Receita de processamento', brl(b.rev));
      kv('Resultado Bondly no semestre', brl(b.total), true);
      kv('Parte da Minu', brl(b.minu));
    } else {
      paragraph(
        'Projeção do produto de assinaturas para a base, no 2º semestre de 2027. ' +
          'Valores de alcance ao cliente — sem dados internos.',
      );
      kv('Assinantes ativos em dezembro', b.end.toLocaleString('pt-BR', { maximumFractionDigits: 0 }));
      kv('Valor transacionado no semestre (GMV)', brl(b.gmv));
      kv('Receita de processamento', brl(b.rev));
    }
  }

  // ---- SEÇÕES INTERNAS (uso interno apenas) -------------------------------
  if (internal) {
    sectionTitle('Composição da mensalidade (interno)');
    kv('Platform Fee', `${brl(r.platformFee)}/mês`);
    kv('DAU Usage', `${brl(r.usage)}/mês`);
    kv('Processing', `${brl(r.processing)}/mês`);
    if (r.servicesMrr > 0) kv('Recursos dedicados', `${brl(r.servicesMrr)}/mês`);
    kv('Receita recorrente Core', `${brl(r.core)}/mês`, true);

    sectionTitle('Custos e margens (interno)');
    kv('Custo variável (COGS)', `${brl(r.costs.total)}/mês`);
    paragraph(
      `CleverTap ${brl(r.costs.cleverTap)} · infra ${brl(r.costs.infra)} · NF ${brl(r.costs.invoices)} · ` +
        `comunicação ${brl(r.costs.communication)}`,
      MUTED,
      10,
    );
    kv('Margem técnica', pct(r.technicalMargin), true);
    kv('Margem líquida (Y1 / regime)', `${pct(r.netMarginY1)} / ${pct(r.netMarginSteady)}`);
    kv('Status de margem', r.marginStatus);
    kv('Alçada de desconto', r.discountAuthority);
    if (snap.input.negotiation.viaMinu) {
      kv('Fee Minu — conversão (mês)', brl(r.minuConversionFee));
      kv('Fee Minu — conta (mês)', brl(r.minuAccountFee));
      kv('Minu ganha no 1º ano', brl(r.minuYear1));
    }

    sectionTitle('Evidência comercial — ARKA (interno)');
    const { arkaClassification } = await loadDevEngine();
    const arka = arkaClassification(snap.input.arka);
    kv('Classe ARKA', `${arka.arkaClass} · ${arka.stage.maturity} (estágio ${arka.stage.rank}/15)`);
    kv('Elegível ao Orçamento Compromissado', arka.allOk ? 'Sim' : 'Não — completar evidência');
    paragraph(arka.note, MUTED, 10);
    if (r.warnings.length > 0) {
      paragraph('Alertas: ' + r.warnings.map((w) => w.message).join(' '), MUTED, 10);
    }
  }

  // ---- PRÓXIMOS PASSOS -----------------------------------------------------
  sectionTitle('Próximos passos');
  paragraph(
    '1. Validação desta proposta pelo time.  2. Alinhamento de escopo e cronograma de implantação.  ' +
      '3. Formalização do contrato e início do onboarding.',
  );
  const valid = new Date(snap.issuedAt);
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
    doc.text(internal ? `Bondly · Proposta ${snap.id} · USO INTERNO` : `Bondly · Proposta ${snap.id}`, M, H - 30);
    doc.text(
      internal
        ? `Motor ${r.engineVersion} · premissas ${r.premisesVersion} (${r.premisesHash}) · pág. ${p}/${pages}`
        : `Emitida em ${new Date(snap.issuedAt).toLocaleDateString('pt-BR')} · pág. ${p}/${pages}`,
      W - M,
      H - 30,
      { align: 'right' },
    );
  }

  return doc;
}
