import type { jsPDF } from 'jspdf';
import { MODULE_CATALOG } from '@bondly/pricing-catalog';
import type { ClientQuote, CommercialQuote, InternalQuote, QuoteViewPayload } from './pricing/quoteTypes';
import { brl, pct } from './defaults';

/**
 * Gerador do PDF da proposta (§16, redesign docs/20) — G-001-A Fase 4.
 *
 * FONTE DE VERDADE: o QuoteView PROJETADO PELO SERVIDOR (contrato `quote.v1`, apps/auth-proxy/src/quoteProjection.ts),
 * a MESMA origem que as telas consomem via `useCentralPricing`. Este módulo NÃO importa o Pricing Engine nem as tabelas
 * de custo/premissas: ele só FORMATA o que o servidor já decidiu enviar para o perfil. A fronteira de confidencialidade
 * (§12/§16, CWE-200) é ESTRUTURAL — não depende de o gerador "lembrar" de esconder nada:
 *   - view 'client'/'commercial'  → PEÇA EXTERNA (cliente): o payload NÃO CONTÉM custo/COGS/margem/tributo/fee Minu.
 *   - view 'internal' (só perfil com proposal.see_internal)  → PEÇA COMPLETA: acrescenta composição da mensalidade,
 *     COGS, margens, alçada e fees Minu, lidos de `view.result` (PricingResult, projetado só aqui).
 *
 * VISUAL (docs/20): replica À RISCA a referência do sponsor — navy #12215E, destaque verde-limão #C2FF01,
 * fontes Space Grotesk (títulos/corpo) + Geist Mono (números/eyebrows/labels/rodapé). jsPDF, o logo e as FONTES
 * carregam via import() dinâmico (code-splitting §27.1) — o peso das fontes fica fora do bundle de produção.
 */

// ---- Paleta (docs/20 §2.1, valores rg medidos da referência) --------------
const NAVY = '#12215E'; // fundo/faixa/header de tabela
const NAVY_TITLE = '#11205E'; // título de seção
const INK = '#0A1130'; // texto de célula sobre claro (navy escuro)
const LIME = '#C2FF01'; // destaque
const MIST = '#B9C6FF'; // eyebrow/label sobre navy (azul-névoa)
const SLATE = '#5C6274'; // rótulo sobre claro / rodapé (cinza-ardósia)
const ICE = '#FAFAF8'; // texto claro sobre navy (branco-gelo)
const LINE = '#D4D9E3'; // separador de tabela

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
 * 'internal' ⇒ peça completa; 'client'/'commercial' ⇒ peça externa. Não há parâmetro de audience que possa
 * "forçar" interno sobre um payload externo: se o campo interno não veio no payload, ele não existe no PDF.
 */
export async function generateQuotePdf(quote: QuoteViewPayload, meta: QuotePdfMeta): Promise<jsPDF> {
  const internal = quote.view === 'internal';
  const result = internal ? (quote as InternalQuote).result : null;
  const commercial = quote.view !== 'client' ? (quote as CommercialQuote) : null;
  const client = quote as ClientQuote;

  const { jsPDF: JsPDF } = await import('jspdf');
  const { BONDLY_LOGO_PNG, BONDLY_LOGO_W, BONDLY_LOGO_H } = await import('../assets/logo');
  const { registerPdfFonts } = await import('./pdfFonts');
  const doc = new JsPDF({ unit: 'pt', format: 'a4' });

  // Registra Space Grotesk + Geist Mono no VFS. `fontsReady` indica se o embed funcionou; caso contrário,
  // caímos num FALLBACK marcado (Helvetica/Courier) sem quebrar a geração — ASSUMPTION documentada em docs/20.
  let sans = 'helvetica';
  let mono = 'courier';
  let fontsReady = false;
  try {
    const fam = await registerPdfFonts(doc);
    sans = fam.sans;
    mono = fam.mono;
    fontsReady = true;
  } catch {
    // mantém fallback core; o visual perde a tipografia da referência mas a peça sai íntegra.
  }

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 51; // margem lateral da referência (docs/20 §2.3)
  const cw = W - 2 * M;

  // Estilo de fonte mono "medium" só existe quando as fontes reais estão carregadas; no fallback, 'normal'.
  const monoMedium = fontsReady ? 'medium' : 'normal';

  // ---- helpers de fonte ----------------------------------------------------
  const setSans = (style: 'normal' | 'bold', size: number, color: string) => {
    doc.setFont(sans, style);
    doc.setFontSize(size);
    doc.setTextColor(color);
  };
  const setMono = (style: 'normal' | 'medium', size: number, color: string) => {
    doc.setFont(mono, style === 'medium' ? monoMedium : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color);
  };

  let y = 0;
  const ensure = (need: number) => {
    if (y > H - need) {
      doc.addPage();
      y = 64;
    }
  };

  // ---- template de seção (kicker mono + título navy 17pt) ------------------
  const sectionTitle = (kicker: string, title: string) => {
    ensure(76);
    y += 12;
    setMono('normal', 7.5, SLATE);
    doc.text(kicker.toUpperCase(), M, y, { charSpace: 1.1 });
    y += 16;
    setSans('bold', 17, NAVY_TITLE);
    doc.text(title, M, y);
    y += 20;
  };

  // ---- faixa navy com trio de KPIs (docs/20 §2.3) --------------------------
  const kpiBand = (kpis: readonly { label: string; value: string }[]) => {
    const bandH = 78;
    ensure(bandH + 16);
    const top = y;
    doc.setFillColor(NAVY);
    doc.rect(M, top, cw, bandH, 'F');
    const cols = kpis.length;
    const colW = cw / cols;
    kpis.forEach((k, i) => {
      const cx = M + colW * i + 17;
      setMono('normal', 7.5, MIST);
      doc.text(k.label.toUpperCase(), cx, top + 30, { charSpace: 1 });
      setMono('medium', 15, ICE);
      doc.text(k.value, cx, top + 57);
    });
    y = top + bandH + 16;
  };

  // ---- tabela: header-band navy + linhas rótulo-esq / números mono dir -----
  // `cols[0]` = rótulo (Space Grotesk, esq); demais = numéricas (Geist Mono, dir).
  const table = (headers: readonly string[], rows: readonly (readonly string[])[]) => {
    const rowH = 19;
    const headH = 19.8;
    const nCols = headers.length;
    const numCols = nCols - 1;
    // posições das colunas numéricas (right-align), distribuídas na metade direita da faixa útil.
    const labelX = M + 5.7;
    const numArea = cw * 0.56;
    const numStart = M + cw - numArea;
    const colRight = (i: number) => numStart + (numArea / numCols) * (i + 1) - 4;

    ensure(headH + rowH * (rows.length + 1));
    // header band
    doc.setFillColor(NAVY);
    doc.rect(M, y, cw, headH, 'F');
    setMono('normal', 8, ICE);
    doc.text((headers[0] ?? '').toUpperCase(), labelX, y + 13.5, { charSpace: 0.6 });
    for (let i = 1; i < nCols; i++) {
      doc.text((headers[i] ?? '').toUpperCase(), colRight(i - 1), y + 13.5, { align: 'right', charSpace: 0.6 });
    }
    y += headH;
    // corpo
    for (const row of rows) {
      ensure(rowH + 4);
      setSans('normal', 9, INK);
      const labelLines = doc.splitTextToSize(row[0] ?? '', numStart - labelX - 8) as string[];
      doc.text(labelLines, labelX, y + 13);
      setMono('normal', 9, INK);
      for (let i = 1; i < nCols; i++) {
        doc.text(row[i] ?? '', colRight(i - 1), y + 13, { align: 'right' });
      }
      const h = Math.max(rowH, labelLines.length * 11 + 8);
      y += h;
      doc.setDrawColor(LINE);
      doc.line(M, y, M + cw, y);
    }
    y += 8;
  };

  const paragraph = (text: string, color = INK, size = 10) => {
    setSans('normal', size, color);
    const lines = doc.splitTextToSize(text, cw) as string[];
    ensure(lines.length * (size + 4) + 10);
    doc.text(lines, M, y);
    y += lines.length * (size + 4) + 6;
  };

  // ---- full-bleed navy (capa / contracapa) ---------------------------------
  const drawCover = (opts: {
    eyebrow: string;
    title: string;
    titleSize: number;
    subtitle: string;
    subtitleHighlightWord: number; // índice da palavra em verde-limão
    subtitleSize: number;
    pairs?: readonly { label: string; value: string }[];
    contactLine?: string;
  }) => {
    doc.setFillColor(NAVY);
    doc.rect(0, 0, W, H, 'F');
    // logo-marca (wordmark) no topo-esquerda, sobre card branco para contraste
    const logoW = 150;
    const logoH = (logoW * BONDLY_LOGO_H) / BONDLY_LOGO_W;
    const padX = 16;
    const padY = 12;
    doc.setFillColor('#ffffff');
    doc.roundedRect(M, 84, logoW + padX * 2, logoH + padY * 2, 8, 8, 'F');
    doc.addImage(BONDLY_LOGO_PNG, 'PNG', M + padX, 84 + padY, logoW, logoH);

    // eyebrow mono
    setMono('normal', 8.5, MIST);
    doc.text(opts.eyebrow.toUpperCase(), M, 220, { charSpace: 1.6 });

    // título display
    setSans('bold', opts.titleSize, ICE);
    const titleLines = doc.splitTextToSize(opts.title, cw) as string[];
    doc.text(titleLines, M, 266);

    // subtítulo com 2ª palavra (índice) em verde-limão, renderizado palavra a palavra
    const subY = 266 + titleLines.length * (opts.titleSize + 6) + 18;
    setSans('normal', opts.subtitleSize, ICE);
    const words = opts.subtitle.split(' ');
    let wx = M;
    words.forEach((w, i) => {
      doc.setTextColor(i === opts.subtitleHighlightWord ? LIME : ICE);
      doc.text(w, wx, subY);
      wx += doc.getTextWidth(w + ' ');
    });

    // pares rótulo/valor empilhados (capa)
    if (opts.pairs && opts.pairs.length > 0) {
      let py = subY + 54;
      for (const p of opts.pairs) {
        setMono('normal', 7.5, MIST);
        doc.text(p.label.toUpperCase(), M, py, { charSpace: 1 });
        setSans('normal', 12.5, ICE);
        doc.text(p.value, M, py + 18);
        py += 44;
      }
    }

    // linha de contato (rodapé do bloco)
    if (opts.contactLine) {
      setSans('normal', 9, MIST);
      doc.text(opts.contactLine, M, H - 60);
    }
  };

  // Datas/strings comuns
  const issued = new Date(meta.issuedAt);
  const clientName = meta.clientName?.trim() || 'Programa de Fidelidade';
  const eyebrowProfile = internal ? 'USO INTERNO' : 'PROPOSTA COMERCIAL · 2027';

  // ========================================================================
  // 1. CAPA (docs/20 §4.1) — página própria, fundo navy full-bleed
  // ========================================================================
  drawCover({
    eyebrow: eyebrowProfile,
    title: clientName,
    titleSize: 34,
    subtitle: 'Programa Bondly de ponta a ponta',
    subtitleHighlightWord: 1, // "Bondly" em verde-limão
    subtitleSize: 20,
    pairs: [
      { label: 'Plano', value: client.plan.name },
      { label: 'Prazo do contrato', value: `${client.termMonths} meses` },
      { label: 'Base de usuários', value: typeof meta.users === 'number' && meta.users > 0 ? meta.users.toLocaleString('pt-BR') : '—' },
      { label: 'Emissão', value: issued.toLocaleDateString('pt-BR') },
    ],
    contactLine: `Proposta ${meta.id}`,
  });
  doc.addPage();
  y = 64;

  // ========================================================================
  // 2. RESUMO DO INVESTIMENTO (docs/20 §4.2) — trio de KPIs em faixa navy
  // ========================================================================
  sectionTitle('Resumo do investimento', 'Resumo do investimento');
  kpiBand([
    { label: 'Mensal', value: `${brl(client.pricing.monthly)}` },
    { label: 'Setup (único)', value: brl(client.pricing.setupTotal) },
    { label: 'TCV', value: brl(client.pricing.tcv) },
  ]);

  // ========================================================================
  // 3. COMPOSIÇÃO DO TCV (docs/20 §4.3) — mensal×prazo + setup + nota de prazo
  // ========================================================================
  sectionTitle('Composição do contrato', 'Composição do TCV');
  table(
    ['Componente', 'Valor'],
    [
      ['Mensalidade', `${brl(client.pricing.monthly)}/mês`],
      [`Mensalidade × ${client.termMonths} meses`, brl(client.pricing.monthly * client.termMonths)],
      ['Setup (único)', brl(client.pricing.setupTotal)],
      ['Total no 1º ano', brl(client.pricing.firstYearTotal)],
      ['Valor total do contrato (TCV)', brl(client.pricing.tcv)],
    ],
  );
  if (client.termMonths > 12) {
    paragraph(`Condição especial de prazo: contrato de ${client.termMonths} meses.`, SLATE, 9);
  }

  // ========================================================================
  // 4. RESUMO EXECUTIVO (docs/20 §4.4) — parágrafo de abertura
  // ========================================================================
  sectionTitle('Visão geral', 'Resumo executivo');
  const usersLabel =
    typeof meta.users === 'number' && meta.users > 0
      ? `uma base de ${meta.users.toLocaleString('pt-BR')} usuários elegíveis em `
      : '';
  paragraph(
    `Esta proposta apresenta o investimento e o alcance do programa de fidelidade Bondly para ${clientName}, ` +
      `dimensionado para ${usersLabel}um contrato de ${client.termMonths} meses. A plataforma entrega o programa ` +
      `de ponta a ponta: motor de pontos e engajamento, régua de comunicação com o participante e operação ` +
      `gerenciada — pronta para escalar com a sua base.`,
  );

  // ========================================================================
  // 5. SOLUÇÕES CONTRATADAS (docs/20 §4.5)
  // ========================================================================
  sectionTitle('Escopo', 'Soluções contratadas');
  const scopeRows: string[][] = [['Plano', client.plan.name]];
  if (typeof meta.users === 'number' && meta.users > 0) scopeRows.push(['Base de usuários elegíveis', meta.users.toLocaleString('pt-BR')]);
  if (meta.selectedModules && meta.selectedModules.length > 0) scopeRows.push(['Módulos contratados', meta.selectedModules.map(moduleName).join(', ')]);
  scopeRows.push(['Prazo do contrato', `${client.termMonths} meses`]);
  if (client.pricing.servicesMonthly > 0) scopeRows.push(['Equipe dedicada (recorrente)', `${brl(client.pricing.servicesMonthly)}/mês`]);
  table(['Item', 'Detalhe'], scopeRows);

  // ========================================================================
  // 6. PROJEÇÃO POR ENGAJAMENTO (docs/20 §4.6) — 3 cenários
  // ========================================================================
  if (client.scenarios.length > 0) {
    sectionTitle('Cenários', 'Projeção por engajamento');
    paragraph(
      'Como o programa acompanha o uso real, projetamos três cenários variando o engajamento mensal da base ' +
        'em ±30%. Os valores abaixo são o que o programa representa em cada cenário.',
      SLATE,
      9,
    );
    const cLabels: Record<string, string> = { conservador: 'Conservador (−30%)', base: 'Base', otimista: 'Otimista (+30%)' };
    table(
      ['Cenário', 'Mensal', 'Total do contrato'],
      client.scenarios.map((s) => [cLabels[s.name] ?? s.name, `${brl(s.monthly)}/mês`, brl(s.tcv)]),
    );
  }

  // ========================================================================
  // 7. [commercial+internal] DETALHAMENTO COMERCIAL (docs/20 §4.7)
  //    Estruturalmente inalcançável em `client` (commercial === null): waterfall/composition/setup/engagement
  //    /discountCorridor/policy só existem no payload quando view !== 'client'. Guard por PRESENÇA, não por flag.
  // ========================================================================
  if (commercial) {
    sectionTitle('Detalhamento comercial', 'Formação do preço');
    table(
      ['Etapa do waterfall', 'Mensal'],
      [
        ['Preço base', `${brl(commercial.waterfall.base)}/mês`],
        ['Após desconto de tier', `${brl(commercial.waterfall.afterTier)}/mês`],
        ['Após negociação', `${brl(commercial.waterfall.afterNegotiated)}/mês`],
        ['Preço final', `${brl(commercial.waterfall.final)}/mês`],
      ],
    );
    table(
      ['Composição do preço', 'Mensal'],
      [
        ['Taxa de plataforma', `${brl(commercial.composition.platformFee)}/mês`],
        ['Usage (DAU)', `${brl(commercial.composition.usage)}/mês`],
        ['Processing', `${brl(commercial.composition.processing)}/mês`],
        ['Serviços recorrentes', `${brl(commercial.composition.servicesMonthly)}/mês`],
        ['Core (recorrente)', `${brl(commercial.composition.coreMonthly)}/mês`],
      ],
    );
    sectionTitle('Setup', 'Setup detalhado');
    table(
      ['Item', 'Valor'],
      [
        ['Setup fixo', brl(commercial.setup.fixed)],
        ['Redução sobre o fixo', pct(commercial.setup.fixedReductionPct)],
        ['Horas de implantação', `${commercial.setup.implementationHours} h`],
        ['Valor-hora', brl(commercial.setup.hourlyRate)],
        ['Subtotal de implantação', brl(commercial.setup.implementationSubtotal)],
        ['Outras adições', brl(commercial.setup.otherAdditions)],
        ['Total do setup', brl(commercial.setup.total)],
      ],
    );
    sectionTitle('Engajamento e alçada', 'Engajamento e corredor de desconto');
    table(
      ['Indicador', 'Valor'],
      [
        ['MAU (projetado)', commercial.engagement.mau.toLocaleString('pt-BR')],
        ['DAU (projetado)', commercial.engagement.dau.toLocaleString('pt-BR')],
        ['Desconto negociado', pct(commercial.discounts.negotiatedRate)],
        ['Alçada de desconto', commercial.discountCorridor.authority],
        ['Desconto máximo da alçada', pct(commercial.discountCorridor.maxDiscount)],
      ],
    );
    const { marginAlert, flags } = commercial.policy;
    paragraph(
      `Sinal de margem: ${marginAlert.level}${marginAlert.requiresApproval ? ' · requer aprovação' : ''}.` +
        (flags.length > 0 ? ` Flags de política: ${flags.join(', ')}.` : ''),
      SLATE,
      9,
    );
  }

  // ========================================================================
  // 8. [internal] BLOCOS INTERNOS (docs/20 §4.8) — só com result (view==='internal')
  // ========================================================================
  if (internal && result) {
    sectionTitle('Uso interno', 'Composição da mensalidade');
    const compRows: string[][] = [
      ['Platform Fee', `${brl(result.platformFee)}/mês`],
      ['DAU Usage', `${brl(result.usage)}/mês`],
      ['Processing', `${brl(result.processing)}/mês`],
    ];
    if (result.servicesMrr > 0) compRows.push(['Recursos dedicados', `${brl(result.servicesMrr)}/mês`]);
    compRows.push(['Receita recorrente Core', `${brl(result.core)}/mês`]);
    table(['Linha', 'Mensal'], compRows);

    sectionTitle('Uso interno', 'Custos e margens');
    table(
      ['Indicador', 'Valor'],
      [
        ['Custo variável (COGS)', `${brl(result.costs.total)}/mês`],
        ['CleverTap', `${brl(result.costs.cleverTap)}/mês`],
        ['Infra', `${brl(result.costs.infra)}/mês`],
        ['Notas fiscais', `${brl(result.costs.invoices)}/mês`],
        ['Comunicação', `${brl(result.costs.communication)}/mês`],
        ['Margem técnica', pct(result.technicalMargin)],
        ['Margem líquida (Y1 / regime)', `${pct(result.netMarginY1)} / ${pct(result.netMarginSteady)}`],
        ['Status de margem', result.marginStatus],
        ['Alçada de desconto', result.discountAuthority],
      ],
    );
    if (result.minuConversionFee > 0 || result.minuAccountFee > 0 || result.minuYear1 > 0) {
      sectionTitle('Uso interno', 'Fee Minu (interno)');
      table(
        ['Fee', 'Valor'],
        [
          ['Conversão (mês)', brl(result.minuConversionFee)],
          ['Conta (mês)', brl(result.minuAccountFee)],
          ['Minu ganha no 1º ano', brl(result.minuYear1)],
        ],
      );
    }
    if (result.warnings.length > 0) {
      paragraph('Alertas do motor: ' + result.warnings.map((w) => w.message).join(' '), SLATE, 9);
    }
  }

  // ========================================================================
  // 9. CONDIÇÕES COMERCIAIS (docs/20 §4.9) — tabela 2-colunas, comum a todos
  // ========================================================================
  const valid = new Date(meta.issuedAt);
  valid.setDate(valid.getDate() + 30);
  sectionTitle('Condições', 'Condições comerciais');
  table(
    ['Condição', 'Detalhe'],
    [
      ['Validade da proposta', valid.toLocaleDateString('pt-BR')],
      ['Formalização', 'Sujeita à assinatura do contrato'],
      ['Reajuste', 'Conforme contrato'],
    ],
  );
  sectionTitle('Próximos passos', 'Próximos passos');
  paragraph(
    '1. Validação desta proposta pelo time.  2. Alinhamento de escopo e cronograma de implantação.  ' +
      '3. Formalização do contrato e início do onboarding.',
    INK,
    10,
  );

  // ========================================================================
  // 10. CONTRACAPA (docs/20 §4.10) — espelha a capa, título 30pt
  // ========================================================================
  doc.addPage();
  drawCover({
    eyebrow: eyebrowProfile,
    title: 'Obrigado pela oportunidade',
    titleSize: 30,
    subtitle: 'Vamos construir juntos',
    subtitleHighlightWord: 1, // "construir" em verde-limão
    subtitleSize: 15,
    contactLine: `Proposta ${meta.id} · ${issued.toLocaleDateString('pt-BR')}`,
  });

  // ========================================================================
  // 11. RODAPÉ (docs/20 §4.11) — numeração pág. x/y em TODAS as páginas.
  //     Motor/premissas/hash só quando internal && result.
  // ========================================================================
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    setMono('normal', 7.5, SLATE);
    doc.text(internal ? `Bondly · Proposta ${meta.id} · USO INTERNO` : `Bondly · Proposta ${meta.id}`, M, H - 21.5);
    const right =
      internal && result
        ? `Motor ${quote.engineVersion} · premissas ${quote.premisesVersion} (${result.premisesHash}) · pág. ${p}/${pages}`
        : `Emitida em ${issued.toLocaleDateString('pt-BR')} · pág. ${p}/${pages}`;
    doc.text(right, W - M, H - 21.5, { align: 'right' });
  }

  return doc;
}
