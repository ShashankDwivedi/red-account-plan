import PptxGenJS from 'pptxgenjs';
import { AnalysisResult, PlanPhase } from '../types';
import { BRAND, COLORS, statusColors, horizonColor, PRIORITY_COLOR, formatDate, splitByCategory } from './theme';

/**
 * Executive-ready slide deck built with pptxgenjs (16:9).
 *
 * Slides:
 *   1. Title / cover.
 *   2. Executive summary + health score.
 *   3. Health by assessment area (bar-style rows).
 *   4. Risks & strengths.
 *   5-7. One slide per horizon (30 / 60 / 90).
 *   8. Closing / recap.
 *
 * Uses a shared palette so it matches the PDF and Word deliverables.
 */

const W = 13.333; // 16:9 slide width (inches)
const H = 7.5;

export async function generatePptx(data: AnalysisResult): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: W, height: H });
  pptx.layout = 'WIDE';
  pptx.author = BRAND.name;
  pptx.title = `${data.fileName} — 30-60-90 Success Plan`;

  coverSlide(pptx, data);
  summarySlide(pptx, data);
  healthSlide(pptx, data);
  risksSlide(pptx, data);
  data.plan.forEach((p) => phaseSlide(pptx, p));
  closingSlide(pptx, data);

  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return out;
}

// --------------------------------------------------------------------------
function footer(slide: PptxGenJS.Slide, pptx: PptxGenJS) {
  slide.addShape(pptx.ShapeType.line, { x: 0.5, y: H - 0.55, w: W - 1, h: 0, line: { color: COLORS.line, width: 0.75 } });
  slide.addText(`${BRAND.name} · ${BRAND.tagline}`, { x: 0.5, y: H - 0.5, w: 8, h: 0.3, fontFace: 'Arial', fontSize: 8, color: COLORS.inkMuted });
}

function slideTitle(slide: PptxGenJS.Slide, pptx: PptxGenJS, kicker: string, title: string, accent = COLORS.brand) {
  slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.5, w: 0.09, h: 0.55, fill: { color: accent } });
  slide.addText(kicker.toUpperCase(), { x: 0.72, y: 0.42, w: 11, h: 0.28, fontFace: 'Arial', fontSize: 11, bold: true, color: COLORS.inkMuted, charSpacing: 2 });
  slide.addText(title, { x: 0.72, y: 0.66, w: 11.8, h: 0.6, fontFace: 'Arial', fontSize: 26, bold: true, color: COLORS.ink });
}

// --------------------------------------------------------------------------
function coverSlide(pptx: PptxGenJS, data: AnalysisResult) {
  const slide = pptx.addSlide();
  const sc = statusColors(data.overall.status);
  slide.background = { color: COLORS.brandDark };

  // Accent bar.
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.14, fill: { color: COLORS.brand } });

  // RAG dots.
  [COLORS.red, COLORS.amber, COLORS.green].forEach((c, i) => {
    slide.addShape(pptx.ShapeType.ellipse, { x: 0.9 + i * 0.34, y: 0.9, w: 0.22, h: 0.22, fill: { color: c } });
  });
  slide.addText(BRAND.name.toUpperCase(), { x: 0.9, y: 1.25, w: 8, h: 0.4, fontFace: 'Arial', fontSize: 14, bold: true, color: 'C7D2FE', charSpacing: 3 });

  slide.addText('30·60·90 Day', { x: 0.85, y: 2.2, w: 11, h: 0.9, fontFace: 'Arial', fontSize: 48, bold: true, color: 'FFFFFF' });
  slide.addText('Customer Success Plan', { x: 0.85, y: 3.1, w: 11, h: 0.9, fontFace: 'Arial', fontSize: 48, bold: true, color: 'A5B4FC' });
  slide.addText('Moving the account from Red → Yellow → Green', { x: 0.9, y: 4.2, w: 11, h: 0.5, fontFace: 'Arial', fontSize: 16, color: 'C7D2FE' });

  // Account + status chips.
  slide.addText(
    [
      { text: 'ACCOUNT  ', options: { bold: true, color: '818CF8', fontSize: 11 } },
      { text: data.fileName, options: { color: 'E0E7FF', fontSize: 13 } },
    ],
    { x: 0.9, y: 5.4, w: 8, h: 0.4, fontFace: 'Arial' }
  );
  slide.addText(`Prepared ${formatDate(data.generatedAt)}`, { x: 0.9, y: 5.8, w: 8, h: 0.4, fontFace: 'Arial', fontSize: 11, color: '818CF8' });

  // Score ring (right).
  scoreRing(slide, pptx, 10.4, 2.6, data.overall.score, sc.main, true);
  // Status pill.
  slide.addShape(pptx.ShapeType.roundRect, { x: 9.7, y: 4.9, w: 2.8, h: 0.55, rectRadius: 0.27, fill: { color: sc.main } });
  slide.addText(`STATUS: ${data.overall.status.toUpperCase()}`, { x: 9.7, y: 4.9, w: 2.8, h: 0.55, align: 'center', valign: 'middle', fontFace: 'Arial', fontSize: 13, bold: true, color: 'FFFFFF' });
}

function summarySlide(pptx: PptxGenJS, data: AnalysisResult) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slideTitle(slide, pptx, 'Overview', 'Executive Summary');

  const sc = statusColors(data.overall.status);
  slide.addText(data.executiveSummary, { x: 0.72, y: 1.5, w: 8.3, h: 3.4, fontFace: 'Arial', fontSize: 14, color: COLORS.inkSoft, lineSpacingMultiple: 1.25, valign: 'top' });

  // Right stat panel.
  const px = 9.4;
  slide.addShape(pptx.ShapeType.roundRect, { x: px, y: 1.5, w: 3.3, h: 4.6, rectRadius: 0.12, fill: { color: COLORS.surfaceSoft }, line: { color: COLORS.line, width: 1 } });
  scoreRing(slide, pptx, px + 0.9, 1.75, data.overall.score, sc.main, false);
  slide.addText(`Account Status: ${data.overall.status}`, { x: px, y: 3.55, w: 3.3, h: 0.4, align: 'center', fontFace: 'Arial', fontSize: 13, bold: true, color: sc.main });

  const stats: [string, string, string][] = [
    [String(data.overall.total), 'Criteria', COLORS.ink],
    [String(data.overall.yes), 'Met (Yes)', COLORS.green],
    [String(data.overall.no), 'Gaps (No)', COLORS.red],
    [String(data.tabs.length), 'Areas', COLORS.brand],
  ];
  stats.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = px + 0.25 + col * 1.55;
    const y = 4.1 + row * 0.95;
    slide.addText(s[0], { x, y, w: 1.4, h: 0.55, align: 'center', fontFace: 'Arial', fontSize: 26, bold: true, color: s[2] });
    slide.addText(s[1].toUpperCase(), { x, y: y + 0.5, w: 1.4, h: 0.3, align: 'center', fontFace: 'Arial', fontSize: 9, color: COLORS.inkMuted, charSpacing: 1 });
  });

  footer(slide, pptx);
}

function healthSlide(pptx: PptxGenJS, data: AnalysisResult) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slideTitle(slide, pptx, 'Diagnostics', 'Health by Assessment Area');

  const startY = 1.6;
  const rowH = Math.min(0.62, 4.8 / Math.max(1, data.tabs.length));
  const barX = 4.4;
  const barW = 6.6;

  data.tabs.forEach((t, i) => {
    const y = startY + i * rowH;
    const col = t.score >= 75 ? COLORS.green : t.score >= 45 ? COLORS.amber : COLORS.red;
    slide.addText(t.tab, { x: 0.72, y, w: 3.5, h: rowH - 0.08, fontFace: 'Arial', fontSize: 12, bold: true, color: COLORS.ink, valign: 'middle' });
    slide.addShape(pptx.ShapeType.roundRect, { x: barX, y: y + rowH / 2 - 0.09, w: barW, h: 0.18, rectRadius: 0.09, fill: { color: COLORS.line } });
    slide.addShape(pptx.ShapeType.roundRect, { x: barX, y: y + rowH / 2 - 0.09, w: Math.max(0.2, (barW * t.score) / 100), h: 0.18, rectRadius: 0.09, fill: { color: col } });
    slide.addText(`${t.score}%  ·  ${t.yes}/${t.total}`, { x: barX + barW + 0.15, y, w: 1.7, h: rowH - 0.08, fontFace: 'Arial', fontSize: 11, bold: true, color: COLORS.inkSoft, valign: 'middle' });
  });

  footer(slide, pptx);
}

function risksSlide(pptx: PptxGenJS, data: AnalysisResult) {
  // Two categorized slides: What's Not Working Well, then What's Working Well.
  categorizedSlides(
    pptx,
    'Where we stand',
    "What's Not Working Well",
    data.topRisks,
    COLORS.red,
    COLORS.redSoft,
    'Business Related Risks',
    'Chaos Risks'
  );
  categorizedSlides(
    pptx,
    'What we can build on',
    "What's Working Well",
    data.strengths,
    COLORS.green,
    COLORS.greenSoft,
    'Business Related Strengths',
    'Chaos Strengths'
  );
}

/**
 * Render one section (risks OR strengths) as Business Related + Chaos panels,
 * paginating each panel across slides so rows stay readable.
 */
function categorizedSlides(
  pptx: PptxGenJS,
  kicker: string,
  title: string,
  items: AnalysisResult['topRisks'],
  color: string,
  soft: string,
  businessLabel: string,
  chaosLabel: string
) {
  const PER_SLIDE = 8;
  const { business, chaos } = splitByCategory(items);
  const b = business.map((i) => i.question);
  const c = chaos.map((i) => i.question);
  const slideCount = Math.max(
    1,
    Math.ceil(b.length / PER_SLIDE),
    Math.ceil(c.length / PER_SLIDE)
  );

  for (let p = 0; p < slideCount; p++) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    const suffix = slideCount > 1 ? ` (${p + 1}/${slideCount})` : '';
    slideTitle(slide, pptx, kicker, title + suffix);

    panelList(
      slide, pptx, 0.72, 1.6, 5.9,
      p === 0 ? `${businessLabel} (${b.length})`.toUpperCase() : `${businessLabel} (cont.)`.toUpperCase(),
      b.slice(p * PER_SLIDE, (p + 1) * PER_SLIDE), color, soft
    );
    panelList(
      slide, pptx, 6.9, 1.6, 5.7,
      p === 0 ? `${chaosLabel} (${c.length})`.toUpperCase() : `${chaosLabel} (cont.)`.toUpperCase(),
      c.slice(p * PER_SLIDE, (p + 1) * PER_SLIDE), color, soft
    );

    footer(slide, pptx);
  }
}

function phaseSlide(pptx: PptxGenJS, phase: PlanPhase) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  const accent = horizonColor(phase.horizon);
  const days = phase.horizon === 30 ? '0–30' : phase.horizon === 60 ? '31–60' : '61–90';
  const titlePart = phase.label.split('·').slice(1).join('·').trim() || phase.label;

  // Colored header band.
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 1.5, fill: { color: accent } });
  slide.addText(`DAYS ${days}`, { x: 0.6, y: 0.28, w: 6, h: 0.35, fontFace: 'Arial', fontSize: 13, bold: true, color: 'FFFFFF', charSpacing: 3 });
  slide.addText(titlePart, { x: 0.6, y: 0.6, w: 9, h: 0.7, fontFace: 'Arial', fontSize: 24, bold: true, color: 'FFFFFF' });
  slide.addShape(pptx.ShapeType.roundRect, { x: W - 3, y: 0.5, w: 2.4, h: 0.55, rectRadius: 0.27, fill: { color: 'FFFFFF' } });
  slide.addText(`TARGET: ${phase.targetStatus.toUpperCase()}`, { x: W - 3, y: 0.5, w: 2.4, h: 0.55, align: 'center', valign: 'middle', fontFace: 'Arial', fontSize: 12, bold: true, color: accent });

  slide.addText(phase.objective, { x: 0.6, y: 1.65, w: 12.1, h: 0.7, fontFace: 'Arial', fontSize: 12, italic: true, color: COLORS.inkSoft });

  // Actions (up to 4 shown; remaining summarized).
  const shown = phase.actions.slice(0, 4);
  const colGap = 0.3;
  const colW = (W - 1.2 - colGap) / 2;
  shown.forEach((a, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.6 + col * (colW + colGap);
    const y = 2.5 + row * 1.9;
    const pc = PRIORITY_COLOR[a.priority] || COLORS.brand;
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w: colW, h: 1.75, rectRadius: 0.08, fill: { color: COLORS.surfaceSoft }, line: { color: COLORS.line, width: 1 } });
    slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.07, h: 1.75, fill: { color: accent } });
    slide.addText(a.title, { x: x + 0.2, y: y + 0.12, w: colW - 1.4, h: 0.5, fontFace: 'Arial', fontSize: 12.5, bold: true, color: COLORS.ink, valign: 'top' });
    slide.addShape(pptx.ShapeType.roundRect, { x: x + colW - 1.15, y: y + 0.13, w: 1, h: 0.28, rectRadius: 0.14, fill: { color: pc } });
    slide.addText(a.priority.toUpperCase(), { x: x + colW - 1.15, y: y + 0.13, w: 1, h: 0.28, align: 'center', valign: 'middle', fontFace: 'Arial', fontSize: 7.5, bold: true, color: 'FFFFFF' });
    slide.addText(a.detail, { x: x + 0.2, y: y + 0.62, w: colW - 0.4, h: 0.85, fontFace: 'Arial', fontSize: 9.5, color: COLORS.inkSoft, valign: 'top', lineSpacingMultiple: 1.05 });
    slide.addText([{ text: 'Owner: ', options: { bold: true, color: COLORS.inkMuted } }, { text: a.owner, options: { color: COLORS.inkSoft } }], { x: x + 0.2, y: y + 1.45, w: colW - 0.4, h: 0.25, fontFace: 'Arial', fontSize: 9 });
  });

  if (phase.actions.length > 4) {
    slide.addText(`+ ${phase.actions.length - 4} more action(s) in the full plan`, { x: 0.6, y: 6.3, w: 8, h: 0.3, fontFace: 'Arial', fontSize: 10, italic: true, color: COLORS.inkMuted });
  }

  footer(slide, pptx);
}

function closingSlide(pptx: PptxGenJS, data: AnalysisResult) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.brandDark };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.14, fill: { color: COLORS.brand } });

  slide.addText('The Path Forward', { x: 0.9, y: 2.1, w: 11, h: 0.8, fontFace: 'Arial', fontSize: 38, bold: true, color: 'FFFFFF' });

  const arrow = [
    { label: 'Days 0–30', text: 'Stabilize & align', color: COLORS.red },
    { label: 'Days 31–60', text: 'Build momentum', color: COLORS.amber },
    { label: 'Days 61–90', text: 'Realize value', color: COLORS.green },
  ];
  arrow.forEach((a, i) => {
    const x = 0.9 + i * 4.05;
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 3.4, w: 3.7, h: 1.4, rectRadius: 0.1, fill: { color: '1E293B' }, line: { color: a.color, width: 2 } });
    slide.addText(a.label.toUpperCase(), { x, y: 3.6, w: 3.7, h: 0.4, align: 'center', fontFace: 'Arial', fontSize: 12, bold: true, color: a.color, charSpacing: 2 });
    slide.addText(a.text, { x, y: 4.0, w: 3.7, h: 0.6, align: 'center', fontFace: 'Arial', fontSize: 18, bold: true, color: 'FFFFFF' });
    if (i < 2) slide.addText('→', { x: x + 3.72, y: 3.75, w: 0.35, h: 0.8, align: 'center', fontFace: 'Arial', fontSize: 26, bold: true, color: '64748B' });
  });

  slide.addText('Red → Yellow → Green', { x: 0.9, y: 5.3, w: 11, h: 0.5, fontFace: 'Arial', fontSize: 16, color: '94A3B8' });
  slide.addText(`${BRAND.name} · Generated ${formatDate(data.generatedAt)}`, { x: 0.9, y: H - 0.7, w: 11, h: 0.4, fontFace: 'Arial', fontSize: 10, color: '64748B' });
}

// --------------------------------------------------------------------------
function scoreRing(slide: PptxGenJS.Slide, pptx: PptxGenJS, x: number, y: number, score: number, color: string, onDark: boolean) {
  const size = 1.7;
  // Use a pie chart as the ring.
  slide.addChart(pptx.ChartType.doughnut, [{ name: 'score', labels: ['Met', 'Gap'], values: [score, 100 - score] }], {
    x, y, w: size, h: size,
    chartColors: [color, onDark ? '334155' : COLORS.line],
    holeSize: 68,
    showLegend: false,
    showTitle: false,
    showValue: false,
    dataBorder: { pt: 0, color: onDark ? '1E1B4B' : 'FFFFFF' },
  });
  slide.addText(String(score), { x, y: y + size / 2 - 0.4, w: size, h: 0.55, align: 'center', fontFace: 'Arial', fontSize: 28, bold: true, color: onDark ? 'FFFFFF' : color });
  slide.addText('SCORE', { x, y: y + size / 2 + 0.12, w: size, h: 0.3, align: 'center', fontFace: 'Arial', fontSize: 8, bold: true, color: onDark ? 'A5B4FC' : COLORS.inkMuted, charSpacing: 2 });
}

function panelList(slide: PptxGenJS.Slide, pptx: PptxGenJS, x: number, y: number, w: number, title: string, items: string[], color: string, soft: string) {
  slide.addText(title, { x, y, w, h: 0.35, fontFace: 'Arial', fontSize: 12, bold: true, color, charSpacing: 1 });
  const list = items.length ? items : ['None recorded.'];
  const rowH = Math.min(0.72, 4.4 / list.length);
  list.forEach((it, i) => {
    const ry = y + 0.5 + i * rowH;
    slide.addShape(pptx.ShapeType.roundRect, { x, y: ry, w, h: rowH - 0.1, rectRadius: 0.06, fill: { color: soft } });
    slide.addShape(pptx.ShapeType.rect, { x, y: ry, w: 0.06, h: rowH - 0.1, fill: { color } });
    slide.addText(it, { x: x + 0.2, y: ry, w: w - 0.35, h: rowH - 0.1, valign: 'middle', fontFace: 'Arial', fontSize: 10.5, color: COLORS.ink });
  });
}
