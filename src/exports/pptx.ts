import PptxGenJS from 'pptxgenjs';
import { AnalysisResult, Assessment, PlanPhase } from '../types';
import { BRAND, COLORS, statusColors, horizonColor, PRIORITY_COLOR, formatDate, splitByCategory } from './theme';

/**
 * Executive-ready slide deck built with pptxgenjs (16:9).
 *
 * Slides mirror the web UI:
 *   1. Cover
 *   2. Executive Summary ("Why Account is Red/Yellow") + health score
 *   3. Account Details (if present)
 *   4. Chaos Data Metrics (if present)
 *   5. Correlated Risk Patterns (if present) — one slide per pattern batch
 *   6. What's Not Working Well (Business + Chaos, with Yes/No badges)
 *   7. What's Working Well (Business + Chaos, with Yes/No badges)
 *   8-10. One slide per horizon (30/60/90) — top 3 actions, pattern tags
 *   11. Closing
 */

const W = 13.333; // 16:9 slide width (inches)
const H = 7.5;

/** Priority sort — lower = higher urgency. */
const PRIO_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2 };

function statusLabel(status: string): string {
  if (status === 'Green') return 'Account is Healthy';
  if (status === 'Yellow') return 'Why Account is Yellow';
  return 'Why Account is Red';
}

function itemAnswer(item: Assessment): string {
  if (item.displayValue != null) return item.displayValue;
  return item.answer ? 'Yes' : 'No';
}

function answerBadgeColor(item: Assessment): string {
  if (item.displayValue != null) return COLORS.brand;
  return item.answer ? COLORS.green : COLORS.red;
}

export async function generatePptx(data: AnalysisResult): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: W, height: H });
  pptx.layout = 'WIDE';
  pptx.author = BRAND.name;
  pptx.title = `${data.fileName} — 30-60-90 Success Plan`;

  coverSlide(pptx, data);
  summarySlide(pptx, data);
  if (data.accountDetails && data.accountDetails.length) accountDetailsSlide(pptx, data);
  if (data.chaosMetrics) chaosMetricsSlide(pptx, data);
  if (data.riskPatterns && data.riskPatterns.length) patternSlides(pptx, data);
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

  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.14, fill: { color: COLORS.brand } });

  [COLORS.red, COLORS.amber, COLORS.green].forEach((c, i) => {
    slide.addShape(pptx.ShapeType.ellipse, { x: 0.9 + i * 0.34, y: 0.9, w: 0.22, h: 0.22, fill: { color: c } });
  });
  slide.addText(BRAND.name.toUpperCase(), { x: 0.9, y: 1.25, w: 8, h: 0.4, fontFace: 'Arial', fontSize: 14, bold: true, color: 'C7D2FE', charSpacing: 3 });

  slide.addText('30·60·90 Day', { x: 0.85, y: 2.2, w: 11, h: 0.9, fontFace: 'Arial', fontSize: 48, bold: true, color: 'FFFFFF' });
  slide.addText('Customer Success Plan', { x: 0.85, y: 3.1, w: 11, h: 0.9, fontFace: 'Arial', fontSize: 48, bold: true, color: 'A5B4FC' });
  slide.addText('Moving the account from Red → Yellow → Green', { x: 0.9, y: 4.2, w: 11, h: 0.5, fontFace: 'Arial', fontSize: 16, color: 'C7D2FE' });

  slide.addText(
    [
      { text: 'ACCOUNT  ', options: { bold: true, color: '818CF8', fontSize: 11 } },
      { text: data.fileName, options: { color: 'E0E7FF', fontSize: 13 } },
    ],
    { x: 0.9, y: 5.4, w: 8, h: 0.4, fontFace: 'Arial' }
  );
  slide.addText(`Prepared ${formatDate(data.generatedAt)}`, { x: 0.9, y: 5.8, w: 8, h: 0.4, fontFace: 'Arial', fontSize: 11, color: '818CF8' });

  scoreRing(slide, pptx, 10.4, 2.6, data.overall.score, sc.main, true);
  slide.addShape(pptx.ShapeType.roundRect, { x: 9.5, y: 4.9, w: 3.2, h: 0.55, rectRadius: 0.27, fill: { color: sc.main } });
  slide.addText(statusLabel(data.overall.status).toUpperCase(), { x: 9.5, y: 4.9, w: 3.2, h: 0.55, align: 'center', valign: 'middle', fontFace: 'Arial', fontSize: 11, bold: true, color: 'FFFFFF' });
}

// --------------------------------------------------------------------------
function summarySlide(pptx: PptxGenJS, data: AnalysisResult) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slideTitle(slide, pptx, 'Overview', statusLabel(data.overall.status));

  const sc = statusColors(data.overall.status);

  // Executive summary as bullet lines.
  const summaryLines = data.executiveSummary
    .split('\n').map((l) => l.trim()).filter(Boolean);
  const summaryRuns = summaryLines.flatMap((line): PptxGenJS.TextProps[] => [
    { text: `› ${line}`, options: { fontSize: 11.5, color: COLORS.inkSoft, breakLine: true } },
  ]);
  slide.addText(summaryRuns, { x: 0.72, y: 1.5, w: 8.3, h: 4.0, fontFace: 'Arial', lineSpacingMultiple: 1.45, valign: 'top' });

  // Right stat panel.
  const px = 9.4;
  slide.addShape(pptx.ShapeType.roundRect, { x: px, y: 1.5, w: 3.3, h: 4.6, rectRadius: 0.12, fill: { color: COLORS.surfaceSoft }, line: { color: COLORS.line, width: 1 } });
  scoreRing(slide, pptx, px + 0.9, 1.75, data.overall.score, sc.main, false);
  slide.addText(statusLabel(data.overall.status), { x: px, y: 3.55, w: 3.3, h: 0.4, align: 'center', fontFace: 'Arial', fontSize: 11, bold: true, color: sc.main });

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

// --------------------------------------------------------------------------
function accountDetailsSlide(pptx: PptxGenJS, data: AnalysisResult) {
  if (!data.accountDetails || !data.accountDetails.length) return;
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slideTitle(slide, pptx, 'Context', 'Account Details');

  const cols = 3;
  const cellW = (W - 1.2) / cols;
  const cellH = 1.1;
  const startX = 0.6;
  const startY = 1.7;

  data.accountDetails.forEach((d, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cellW + 0.1);
    const y = startY + row * (cellH + 0.2);
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cellW, h: cellH, rectRadius: 0.08, fill: { color: COLORS.surfaceSoft }, line: { color: COLORS.line, width: 1 } });
    slide.addText(d.label.toUpperCase(), { x: x + 0.15, y: y + 0.12, w: cellW - 0.3, h: 0.3, fontFace: 'Arial', fontSize: 9, bold: true, color: COLORS.inkMuted, charSpacing: 1 });
    slide.addText(d.value || '—', { x: x + 0.15, y: y + 0.42, w: cellW - 0.3, h: 0.55, fontFace: 'Arial', fontSize: 15, bold: true, color: COLORS.ink, valign: 'top' });
  });

  footer(slide, pptx);
}

// --------------------------------------------------------------------------
function chaosMetricsSlide(pptx: PptxGenJS, data: AnalysisResult) {
  if (!data.chaosMetrics) return;
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slideTitle(slide, pptx, 'Chaos Engineering', 'Chaos Data Metrics');

  const m = data.chaosMetrics;
  const metrics = [
    { label: 'Percentage of Teams Onboarded', value: `${m.teamsOnboardedPct}%` },
    { label: 'License Utilisation', value: `${m.licenseUtilizationPct}%` },
    { label: 'Avg Monthly Experiment Runs', value: String(m.avgMonthlyExperimentRuns) },
    { label: 'Total Number of Experiment Runs', value: String(m.totalExperimentRuns) },
  ];

  const tileW = (W - 1.2 - 0.3 * 3) / 4;
  metrics.forEach((mt, i) => {
    const x = 0.6 + i * (tileW + 0.3);
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 1.9, w: tileW, h: 2.8, rectRadius: 0.1, fill: { color: COLORS.surfaceSoft }, line: { color: COLORS.line, width: 1 } });
    slide.addText(mt.value, { x, y: 2.3, w: tileW, h: 1.0, align: 'center', fontFace: 'Arial', fontSize: 36, bold: true, color: COLORS.brand });
    slide.addText(mt.label, { x: x + 0.1, y: 3.4, w: tileW - 0.2, h: 0.9, align: 'center', fontFace: 'Arial', fontSize: 12, color: COLORS.inkSoft, valign: 'top' });
  });

  footer(slide, pptx);
}

// --------------------------------------------------------------------------
function patternSlides(pptx: PptxGenJS, data: AnalysisResult) {
  if (!data.riskPatterns || !data.riskPatterns.length) return;

  const SEV_COLOR: Record<string, string> = { Critical: COLORS.red, High: COLORS.amber, Medium: '0891B2' };
  const PER_SLIDE = 2;
  const chunks: typeof data.riskPatterns[] = [];
  for (let i = 0; i < data.riskPatterns.length; i += PER_SLIDE) {
    chunks.push(data.riskPatterns.slice(i, i + PER_SLIDE));
  }

  chunks.forEach((patterns, pageIdx) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    const suffix = chunks.length > 1 ? ` (${pageIdx + 1}/${chunks.length})` : '';
    slideTitle(slide, pptx, 'Diagnosis', `Correlated Risk Pattern Analysis${suffix}`);

    const cardH = 2.5;
    const cardY = 1.55;

    patterns.forEach((p, i) => {
      const accent = SEV_COLOR[p.severity] || COLORS.brand;
      const cardW = (W - 1.2 - 0.3) / 2;
      const x = 0.6 + i * (cardW + 0.3);

      slide.addShape(pptx.ShapeType.roundRect, { x, y: cardY, w: cardW, h: cardH, rectRadius: 0.1, fill: { color: COLORS.surfaceSoft }, line: { color: accent, width: 2 } });
      slide.addShape(pptx.ShapeType.rect, { x, y: cardY, w: cardW, h: 0.08, fill: { color: accent } });

      slide.addText(p.severity.toUpperCase(), { x: x + 0.15, y: cardY + 0.18, w: cardW - 0.3, h: 0.25, fontFace: 'Arial', fontSize: 10, bold: true, color: accent, charSpacing: 2 });
      slide.addText(p.name, { x: x + 0.15, y: cardY + 0.4, w: cardW - 1.1, h: 0.55, fontFace: 'Arial', fontSize: 14, bold: true, color: COLORS.ink });
      slide.addText(`${p.matchedRisks.length} risks`, { x: x + cardW - 0.9, y: cardY + 0.44, w: 0.75, h: 0.3, align: 'center', fontFace: 'Arial', fontSize: 9, bold: true, color: accent });

      slide.addText(p.description, { x: x + 0.15, y: cardY + 0.97, w: cardW - 0.3, h: 0.5, fontFace: 'Arial', fontSize: 10, italic: true, color: COLORS.inkSoft, valign: 'top' });

      const rowData = [
        { key: 'Root Cause', val: p.rootCause },
        { key: 'Business Risk', val: p.implication },
      ];
      rowData.forEach((r, ri) => {
        const ry = cardY + 1.55 + ri * 0.45;
        slide.addText(r.key + ':', { x: x + 0.15, y: ry, w: 1.2, h: 0.38, fontFace: 'Arial', fontSize: 9, bold: true, color: COLORS.inkMuted });
        slide.addText(r.val, { x: x + 1.35, y: ry, w: cardW - 1.5, h: 0.38, fontFace: 'Arial', fontSize: 9, color: COLORS.inkSoft, valign: 'top' });
      });
    });

    footer(slide, pptx);
  });
}

// --------------------------------------------------------------------------
function risksSlide(pptx: PptxGenJS, data: AnalysisResult) {
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
 * Skips creating any slide if both categories are empty.
 */
function categorizedSlides(
  pptx: PptxGenJS,
  kicker: string,
  title: string,
  items: Assessment[],
  color: string,
  soft: string,
  businessLabel: string,
  chaosLabel: string
) {
  const PER_SLIDE = 7;
  const { business, chaos } = splitByCategory(items);

  if (!business.length && !chaos.length) return;

  const slideCount = Math.max(
    Math.ceil(business.length / PER_SLIDE) || 1,
    Math.ceil(chaos.length / PER_SLIDE) || 1
  );

  for (let p = 0; p < slideCount; p++) {
    const bPage = business.slice(p * PER_SLIDE, (p + 1) * PER_SLIDE);
    const cPage = chaos.slice(p * PER_SLIDE, (p + 1) * PER_SLIDE);
    if (!bPage.length && !cPage.length) continue;

    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    const suffix = slideCount > 1 ? ` (${p + 1}/${slideCount})` : '';
    slideTitle(slide, pptx, kicker, title + suffix);

    if (bPage.length && cPage.length) {
      panelList(slide, pptx, 0.72, 1.6, 5.9,
        p === 0 ? `${businessLabel} (${business.length})`.toUpperCase() : `${businessLabel} (cont.)`.toUpperCase(),
        bPage, color, soft);
      panelList(slide, pptx, 6.9, 1.6, 5.7,
        p === 0 ? `${chaosLabel} (${chaos.length})`.toUpperCase() : `${chaosLabel} (cont.)`.toUpperCase(),
        cPage, color, soft);
    } else if (bPage.length) {
      panelList(slide, pptx, 0.72, 1.6, W - 1.44,
        p === 0 ? `${businessLabel} (${business.length})`.toUpperCase() : `${businessLabel} (cont.)`.toUpperCase(),
        bPage, color, soft);
    } else {
      panelList(slide, pptx, 0.72, 1.6, W - 1.44,
        p === 0 ? `${chaosLabel} (${chaos.length})`.toUpperCase() : `${chaosLabel} (cont.)`.toUpperCase(),
        cPage, color, soft);
    }

    footer(slide, pptx);
  }
}

// --------------------------------------------------------------------------
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

  // Top 3 actions sorted by priority (matches UI).
  const topActions = phase.actions
    .slice()
    .sort((a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9))
    .slice(0, 3);

  const colGap = 0.3;
  const colW = (W - 1.2 - colGap) / 2;
  topActions.forEach((a, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.6 + col * (colW + colGap);
    const y = 2.5 + row * 1.9;
    const pc = PRIORITY_COLOR[a.priority] || COLORS.brand;

    slide.addShape(pptx.ShapeType.roundRect, { x, y, w: colW, h: 1.75, rectRadius: 0.08, fill: { color: COLORS.surfaceSoft }, line: { color: COLORS.line, width: 1 } });
    slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.07, h: 1.75, fill: { color: accent } });

    // Index number.
    slide.addText(String(i + 1), { x: x + 0.15, y: y + 0.12, w: 0.35, h: 0.4, fontFace: 'Arial', fontSize: 16, bold: true, color: COLORS.inkMuted });
    // Title.
    slide.addText(a.title, { x: x + 0.5, y: y + 0.12, w: colW - 1.6, h: 0.48, fontFace: 'Arial', fontSize: 11.5, bold: true, color: COLORS.ink, valign: 'top' });
    // Priority chip.
    slide.addShape(pptx.ShapeType.roundRect, { x: x + colW - 1.1, y: y + 0.13, w: 0.95, h: 0.28, rectRadius: 0.14, fill: { color: pc } });
    slide.addText(a.priority.toUpperCase(), { x: x + colW - 1.1, y: y + 0.13, w: 0.95, h: 0.28, align: 'center', valign: 'middle', fontFace: 'Arial', fontSize: 7.5, bold: true, color: 'FFFFFF' });

    // Pattern tag (if any).
    if (a.patternName) {
      slide.addText(a.patternName, { x: x + 0.2, y: y + 0.62, w: colW - 0.4, h: 0.22, fontFace: 'Arial', fontSize: 8.5, italic: true, color: COLORS.brand });
    }

    // First sentence of detail.
    const firstSentence = (a.detail.split('\n\n')[0].match(/^[^.!?]+[.!?]/)?.[0] || a.detail).slice(0, 160);
    const detailY = a.patternName ? y + 0.86 : y + 0.64;
    slide.addText(firstSentence, { x: x + 0.2, y: detailY, w: colW - 0.4, h: 0.7, fontFace: 'Arial', fontSize: 9.5, color: COLORS.inkSoft, valign: 'top', lineSpacingMultiple: 1.05 });

    // Owner.
    slide.addText([
      { text: 'Owner: ', options: { bold: true, color: COLORS.inkMuted } },
      { text: a.owner, options: { color: COLORS.inkSoft } },
    ], { x: x + 0.2, y: y + 1.5, w: colW - 0.4, h: 0.22, fontFace: 'Arial', fontSize: 9 });
  });

  footer(slide, pptx);
}

// --------------------------------------------------------------------------
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

/**
 * Renders an Assessment panel with Yes/No or displayValue badges.
 * Skips rendering entirely if items is empty — no "None recorded." placeholder.
 */
function panelList(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  x: number,
  y: number,
  w: number,
  title: string,
  items: Assessment[],
  color: string,
  soft: string
) {
  if (!items.length) return;

  slide.addText(title, { x, y, w, h: 0.35, fontFace: 'Arial', fontSize: 11, bold: true, color, charSpacing: 1 });
  const rowH = Math.min(0.66, 4.3 / items.length);
  items.forEach((item, i) => {
    const ry = y + 0.42 + i * rowH;
    const ans = itemAnswer(item);
    const badgeColor = answerBadgeColor(item);

    slide.addShape(pptx.ShapeType.roundRect, { x, y: ry, w: w - 0.65, h: rowH - 0.1, rectRadius: 0.06, fill: { color: soft } });
    slide.addShape(pptx.ShapeType.rect, { x, y: ry, w: 0.06, h: rowH - 0.1, fill: { color } });
    slide.addText(item.question, { x: x + 0.2, y: ry, w: w - 1.1, h: rowH - 0.1, valign: 'middle', fontFace: 'Arial', fontSize: 10, color: COLORS.ink });

    // Answer badge.
    slide.addShape(pptx.ShapeType.roundRect, { x: x + w - 0.6, y: ry + (rowH - 0.1) / 2 - 0.14, w: 0.52, h: 0.28, rectRadius: 0.14, fill: { color: badgeColor } });
    slide.addText(ans, { x: x + w - 0.6, y: ry + (rowH - 0.1) / 2 - 0.14, w: 0.52, h: 0.28, align: 'center', valign: 'middle', fontFace: 'Arial', fontSize: 7.5, bold: true, color: 'FFFFFF' });
  });
}
