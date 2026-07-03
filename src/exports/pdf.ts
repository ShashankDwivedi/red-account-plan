import PDFDocument from 'pdfkit';
import { AnalysisResult, Assessment, PlanPhase } from '../types';
import {
  BRAND,
  COLORS,
  hex,
  statusColors,
  horizonColor,
  PRIORITY_COLOR,
  formatDate,
  splitByCategory,
} from './theme';

/**
 * Executive-ready PDF built with pdfkit.
 *
 * Layout (mirrors the web UI):
 *   1. Cover page
 *   2. Account Details (if present) + Executive Summary + Chaos Metrics (if present)
 *   3. Correlated Risk Pattern Analysis (if present)
 *   4. What's Not Working Well / What's Working Well (with Yes/No/value badges)
 *   5. One section per horizon (30 / 60 / 90) — top 3 actions, pattern tags
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait (pt)
const M = 56; // page margin
const CONTENT_W = PAGE.width - M * 2;

/** Priority sort order — lower = higher priority. */
const PRIO_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2 };

/**
 * pdfkit's built-in Helvetica uses WinAnsi encoding and cannot render many
 * Unicode glyphs (arrows, en/em dashes, middots, smart quotes). Map those to
 * safe ASCII so the PDF never shows tofu/garbage characters.
 */
function s(text: string): string {
  return String(text == null ? '' : text)
    .replace(/[\u2192\u2794\u279C\u27A1]/g, '->') // arrows
    .replace(/[\u2190]/g, '<-')
    .replace(/[\u2013\u2014]/g, '-') // en/em dash
    .replace(/[\u2022]/g, '-') // bullet
    .replace(/[\u00B7\u2027]/g, '|') // middle dot -> pipe
    .replace(/[\u2018\u2019]/g, "'") // smart single quotes
    .replace(/[\u201C\u201D]/g, '"') // smart double quotes
    .replace(/[\u2026]/g, '...') // ellipsis
    .replace(/[\u2713\u2714\u2705]/g, 'Y') // check marks
    .replace(/[\u2715\u2716\u2717\u2718\u2573]/g, 'X'); // crosses
}

/** Label shown for the account status — matches the UI "Why Account is Red" wording. */
function statusLabel(status: string): string {
  if (status === 'Green') return 'Account is Healthy';
  if (status === 'Yellow') return 'Why Account is Yellow';
  return 'Why Account is Red';
}

/** Display value shown next to a risk/strength item (matches UI badge logic). */
function itemAnswer(item: Assessment): string {
  if (item.displayValue != null) return item.displayValue;
  return item.answer ? 'Yes' : 'No';
}

export function generatePdf(data: AnalysisResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: M, bottom: M, left: M, right: M },
      bufferPages: true,
      info: {
        Title: `${data.fileName} — 30-60-90 Success Plan`,
        Author: BRAND.name,
        Subject: 'Customer Success 30-60-90 Day Recovery Plan',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawCover(doc, data);
      drawSummary(doc, data);
      if (data.riskPatterns && data.riskPatterns.length) {
        drawPatterns(doc, data);
      }
      drawRisksAndStrengths(doc, data);
      data.plan.forEach((phase) => drawPhase(doc, phase, data));
      addFooters(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// --------------------------------------------------------------------------
// Cover page
// --------------------------------------------------------------------------
function drawCover(doc: PDFKit.PDFDocument, data: AnalysisResult) {
  const sc = statusColors(data.overall.status);

  // Full-bleed brand banner.
  doc.rect(0, 0, PAGE.width, 250).fill(hex(COLORS.brandDark));
  doc.rect(0, 250, PAGE.width, 6).fill(hex(COLORS.brand));

  // RAG dots.
  const dotY = 70;
  [COLORS.red, COLORS.amber, COLORS.green].forEach((c, i) => {
    doc.circle(M + 6 + i * 20, dotY, 6).fill(hex(c));
  });

  doc
    .fill(hex(COLORS.white))
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(s(BRAND.name.toUpperCase()), M, dotY + 18, { characterSpacing: 2 });

  doc
    .fill(hex(COLORS.white))
    .font('Helvetica-Bold')
    .fontSize(30)
    .text('30-60-90 Day', M, 120, { width: CONTENT_W });
  doc
    .fill('#C7D2FE')
    .fontSize(30)
    .text('Customer Success Plan', M, 156, { width: CONTENT_W });

  doc
    .fill('#A5B4FC')
    .font('Helvetica')
    .fontSize(12)
    .text('Moving the account from Red -> Yellow -> Green', M, 200);

  // Account meta card.
  const cardY = 300;
  card(doc, M, cardY, CONTENT_W, 96);
  doc
    .fill(hex(COLORS.inkMuted))
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('ACCOUNT / SOURCE', M + 20, cardY + 18, { characterSpacing: 1 });
  doc
    .fill(hex(COLORS.ink))
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(s(data.fileName), M + 20, cardY + 34, { width: CONTENT_W - 40 });
  doc
    .fill(hex(COLORS.inkSoft))
    .font('Helvetica')
    .fontSize(10)
    .text(s(`Prepared ${formatDate(data.generatedAt)}`), M + 20, cardY + 66);

  // Health status ring.
  const ringCx = PAGE.width / 2;
  const ringCy = 500;
  drawScoreRing(doc, ringCx, ringCy, 62, data.overall.score, sc.main);

  // Status badge.
  const badgeText = statusLabel(data.overall.status).toUpperCase();
  doc.font('Helvetica-Bold').fontSize(11);
  const textW = doc.widthOfString(badgeText);
  const dotGap = 10;
  const dotR = 5;
  const padX = 20;
  const bw = padX * 2 + dotR * 2 + dotGap + textW;
  const bx = ringCx - bw / 2;
  const by = ringCy + 92;
  roundedRect(doc, bx, by, bw, 34, 17).fill(hex(sc.soft));
  doc.circle(bx + padX + dotR, by + 17, dotR).fill(hex(sc.main));
  doc
    .fill(hex(sc.main))
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(badgeText, bx + padX + dotR * 2 + dotGap, by + 11, {
      width: textW + 4,
      lineBreak: false,
    });

  // Bottom key stats.
  const stats = [
    { label: 'Criteria', value: String(data.overall.total) },
    { label: 'Met (Yes)', value: String(data.overall.yes), color: COLORS.green },
    { label: 'Gaps (No)', value: String(data.overall.no), color: COLORS.red },
    { label: 'Areas', value: String(data.tabs.length) },
  ];
  const sy = 660;
  const colW = CONTENT_W / stats.length;
  stats.forEach((st, i) => {
    const x = M + i * colW;
    doc
      .fill(hex(st.color || COLORS.ink))
      .font('Helvetica-Bold')
      .fontSize(24)
      .text(st.value, x, sy, { width: colW, align: 'center' });
    doc
      .fill(hex(COLORS.inkMuted))
      .font('Helvetica')
      .fontSize(9)
      .text(st.label.toUpperCase(), x, sy + 30, {
        width: colW,
        align: 'center',
        characterSpacing: 1,
      });
  });
}

// --------------------------------------------------------------------------
// Summary page: Account Details + Executive Summary + Chaos Metrics
// --------------------------------------------------------------------------
function drawSummary(doc: PDFKit.PDFDocument, data: AnalysisResult) {
  doc.addPage();
  let y = M;

  // ---- Account Details ---------------------------------------------------
  if (data.accountDetails && data.accountDetails.length) {
    y = sectionHeading(doc, 'Account Details', y);
    const cols = 2;
    const cellW = (CONTENT_W - 16) / cols;
    let colIdx = 0;
    data.accountDetails.forEach((d, i) => {
      const col = i % cols;
      const x = M + col * (cellW + 16);
      if (col === 0 && i !== 0) {
        y += 46;
        if (y > PAGE.height - M - 60) { doc.addPage(); y = M; }
      }
      doc
        .fill(hex(COLORS.inkMuted))
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(s(d.label).toUpperCase(), x, y, { characterSpacing: 1 });
      doc
        .fill(hex(COLORS.ink))
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(s(d.value || '\u2014'), x, y + 12, { width: cellW });
      colIdx = col;
    });
    y += 46 + 16;
    if (y > PAGE.height - M - 100) { doc.addPage(); y = M; }
  }

  // ---- Executive Summary -------------------------------------------------
  y = sectionHeading(doc, statusLabel(data.overall.status), y);
  const summaryLines = data.executiveSummary
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  summaryLines.forEach((line) => {
    if (y + 20 > PAGE.height - M) { doc.addPage(); y = M; }
    doc.fill(hex(COLORS.brand)).font('Helvetica-Bold').fontSize(10).text('>', M, y + 1);
    doc
      .fill(hex(COLORS.inkSoft))
      .font('Helvetica')
      .fontSize(11)
      .text(s(line), M + 14, y, { width: CONTENT_W - 14, lineGap: 3 });
    y = doc.y + 6;
  });
  y += 12;

  // Stats strip.
  if (y > PAGE.height - M - 60) { doc.addPage(); y = M; }
  const statW = CONTENT_W / 4;
  const statsData = [
    { label: 'Criteria', value: String(data.overall.total), color: COLORS.ink },
    { label: 'Met (Yes)', value: String(data.overall.yes), color: COLORS.green },
    { label: 'Gaps (No)', value: String(data.overall.no), color: COLORS.red },
    { label: 'Areas', value: String(data.tabs.length), color: COLORS.brand },
  ];
  statsData.forEach((st, i) => {
    const x = M + i * statW;
    doc.fill(hex(st.color)).font('Helvetica-Bold').fontSize(20).text(st.value, x, y, { width: statW, align: 'center' });
    doc.fill(hex(COLORS.inkMuted)).font('Helvetica').fontSize(8).text(st.label.toUpperCase(), x, y + 24, { width: statW, align: 'center', characterSpacing: 1 });
  });
  y += 50;

  // ---- Chaos Metrics (if present) ----------------------------------------
  if (data.chaosMetrics) {
    if (y > PAGE.height - M - 120) { doc.addPage(); y = M; }
    const m = data.chaosMetrics;
    y = sectionHeading(doc, 'Chaos Data Metrics', y);
    const metrics = [
      { label: 'Teams Onboarded', value: `${m.teamsOnboardedPct}%` },
      { label: 'License Utilisation', value: `${m.licenseUtilizationPct}%` },
      { label: 'Avg Monthly Runs', value: String(m.avgMonthlyExperimentRuns) },
      { label: 'Total Experiment Runs', value: String(m.totalExperimentRuns) },
    ];
    const tileW = (CONTENT_W - 16 * 3) / 4;
    metrics.forEach((mt, i) => {
      const x = M + i * (tileW + 16);
      card(doc, x, y, tileW, 60);
      doc.fill(hex(COLORS.brand)).font('Helvetica-Bold').fontSize(18).text(mt.value, x, y + 8, { width: tileW, align: 'center' });
      doc.fill(hex(COLORS.inkMuted)).font('Helvetica').fontSize(8).text(mt.label.toUpperCase(), x, y + 34, { width: tileW, align: 'center', characterSpacing: 0.5 });
    });
    y += 76;
  }
}

// --------------------------------------------------------------------------
// Correlated Risk Patterns page
// --------------------------------------------------------------------------
function drawPatterns(doc: PDFKit.PDFDocument, data: AnalysisResult) {
  if (!data.riskPatterns || !data.riskPatterns.length) return;
  doc.addPage();
  let y = M;

  y = sectionHeading(doc, 'Correlated Risk Pattern Analysis', y);
  doc
    .fill(hex(COLORS.inkMuted))
    .font('Helvetica')
    .fontSize(9)
    .text(
      'The CS consultant engine identified these root-cause clusters. The 30-60-90 plan addresses each pattern, not just individual checkboxes.',
      M, y, { width: CONTENT_W, lineGap: 2 }
    );
  y = doc.y + 16;

  const SEV_COLOR: Record<string, string> = {
    Critical: COLORS.red,
    High: COLORS.amber,
    Medium: '0891B2',
  };

  data.riskPatterns.forEach((p) => {
    const accent = SEV_COLOR[p.severity] || COLORS.brand;

    // Estimate pattern card height.
    doc.font('Helvetica').fontSize(9.5);
    const descH = doc.heightOfString(s(p.description), { width: CONTENT_W - 32, lineGap: 2 });
    const rootH = doc.heightOfString(s(p.rootCause), { width: CONTENT_W - 120 - 32, lineGap: 2 });
    const implH = doc.heightOfString(s(p.implication), { width: CONTENT_W - 120 - 32, lineGap: 2 });
    const risksText = p.matchedRisks.slice(0, 4).map(s).join(' | ') + (p.matchedRisks.length > 4 ? ` +${p.matchedRisks.length - 4} more` : '');
    const risksH = doc.heightOfString(risksText, { width: CONTENT_W - 120 - 32, lineGap: 2 });
    const boxH = 16 + 20 + descH + 12 + Math.max(rootH, 14) + 8 + Math.max(implH, 14) + 8 + Math.max(risksH, 14) + 16;

    if (y + boxH > PAGE.height - M - 20) { doc.addPage(); y = M; }

    card(doc, M, y, CONTENT_W, boxH);
    doc.rect(M, y, 4, boxH).fill(hex(accent));

    // Severity + name header.
    doc.fill(hex(accent)).font('Helvetica-Bold').fontSize(8).text(p.severity.toUpperCase(), M + 16, y + 14, { characterSpacing: 1 });
    doc.fill(hex(COLORS.ink)).font('Helvetica-Bold').fontSize(13).text(s(p.name), M + 16, y + 28, { width: CONTENT_W - 80 });
    const countText = `${p.matchedRisks.length} risks`;
    doc.font('Helvetica').fontSize(8);
    const cw = doc.widthOfString(countText) + 14;
    roundedRect(doc, M + CONTENT_W - cw - 4, y + 14, cw, 18, 9).fill(hex(COLORS.surfaceSoft));
    doc.fill(hex(accent)).font('Helvetica-Bold').fontSize(8).text(countText, M + CONTENT_W - cw - 4, y + 19, { width: cw, align: 'center' });

    let cy = y + 46;
    // Description.
    doc.fill(hex(COLORS.inkSoft)).font('Helvetica-Oblique').fontSize(9.5)
      .text(s(p.description), M + 16, cy, { width: CONTENT_W - 32, lineGap: 2 });
    cy = doc.y + 10;

    // Root Cause / Business Risk / Matched Risks rows.
    const labelW = 110;
    const valW = CONTENT_W - 32 - labelW;

    [
      { key: 'Root Cause:', val: p.rootCause },
      { key: 'Business Risk:', val: p.implication },
      { key: 'Linked Risks:', val: risksText },
    ].forEach((row) => {
      doc.fill(hex(COLORS.inkMuted)).font('Helvetica-Bold').fontSize(8.5).text(s(row.key), M + 16, cy, { width: labelW, characterSpacing: 0.5 });
      doc.fill(hex(COLORS.inkSoft)).font('Helvetica').fontSize(8.5).text(s(row.val), M + 16 + labelW, cy, { width: valW, lineGap: 1 });
      cy = Math.max(doc.y, cy + 14) + 6;
    });

    y = y + boxH + 12;
  });
}

// --------------------------------------------------------------------------
// What's Not Working Well / What's Working Well
// --------------------------------------------------------------------------
function drawRisksAndStrengths(doc: PDFKit.PDFDocument, data: AnalysisResult) {
  if (!data.topRisks.length && !data.strengths.length) return;
  // Always start on a fresh page so risks/strengths never share a page with patterns.
  doc.addPage();
  let y = M;

  y = sectionHeading(doc, "What's Not Working Well & What's Working Well", y);

  const risks = splitByCategory(data.topRisks);
  const strengths = splitByCategory(data.strengths);

  const prevBizRisk = y;
  y = drawAssessmentList(doc, M, y, CONTENT_W, `WHAT'S NOT WORKING WELL — BUSINESS RELATED (${risks.business.length})`, risks.business, COLORS.red, 'X');
  if (y !== prevBizRisk) y += 10;

  const prevChaosRisk = y;
  y = drawAssessmentList(doc, M, y, CONTENT_W, `WHAT'S NOT WORKING WELL — CHAOS (${risks.chaos.length})`, risks.chaos, COLORS.red, 'X');
  if (y !== prevChaosRisk) y += 16;

  const prevBizStr = y;
  y = drawAssessmentList(doc, M, y, CONTENT_W, `WHAT'S WORKING WELL — BUSINESS RELATED (${strengths.business.length})`, strengths.business, COLORS.green, 'Y');
  if (y !== prevBizStr) y += 10;

  drawAssessmentList(doc, M, y, CONTENT_W, `WHAT'S WORKING WELL — CHAOS (${strengths.chaos.length})`, strengths.chaos, COLORS.green, 'Y');
}

// --------------------------------------------------------------------------
// One phase (horizon) section
// --------------------------------------------------------------------------
function drawPhase(
  doc: PDFKit.PDFDocument,
  phase: PlanPhase,
  _data: AnalysisResult
) {
  doc.addPage();
  const accent = horizonColor(phase.horizon);

  // Phase header band.
  doc.rect(0, 0, PAGE.width, 108).fill(hex(accent));
  doc
    .fill(hex(COLORS.white))
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(s(`DAYS ${phase.horizon === 30 ? '0-30' : phase.horizon === 60 ? '31-60' : '61-90'}`), M, 32, {
      characterSpacing: 2,
    });
  const titlePart = phase.label.split('\u00B7').slice(1).join('\u00B7').trim();
  doc
    .fill(hex(COLORS.white))
    .font('Helvetica-Bold')
    .fontSize(22)
    .text(s(titlePart || phase.label), M, 50, { width: CONTENT_W - 120 });
  // Target chip.
  const chip = `TARGET: ${phase.targetStatus.toUpperCase()}`;
  doc.font('Helvetica-Bold').fontSize(10);
  const cw = doc.widthOfString(chip) + 26;
  roundedRect(doc, PAGE.width - M - cw, 40, cw, 26, 13).fill(
    'rgba(255,255,255,0.22)'
  );
  doc
    .fill(hex(COLORS.white))
    .text(chip, PAGE.width - M - cw, 48, { width: cw, align: 'center' });

  let y = 132;
  doc
    .fill(hex(COLORS.inkSoft))
    .font('Helvetica-Oblique')
    .fontSize(10.5)
    .text(s(phase.objective), M, y, { width: CONTENT_W, lineGap: 3 });
  y = doc.y + 18;

  // Top 3 actions sorted by priority (matches UI).
  const topActions = phase.actions
    .slice()
    .sort((a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9))
    .slice(0, 3);

  topActions.forEach((a) => {
    const needed = estimateActionHeight(doc, a.title, a.detail, a.owner, a.addresses);
    if (y + needed > PAGE.height - M - 20) {
      doc.addPage();
      y = M;
    }
    y = drawAction(doc, a, y, accent);
  });

  y += 8;
  // Metrics + exit criteria in two cards.
  if (y > PAGE.height - M - 150) {
    doc.addPage();
    y = M;
  }
  const colW = (CONTENT_W - 16) / 2;
  const boxY = y;
  const h1 = drawMiniList(doc, M, boxY, colW, 'SUCCESS METRICS', phase.successMetrics.map(s), accent);
  const h2 = drawMiniList(
    doc,
    M + colW + 16,
    boxY,
    colW,
    'EXIT CRITERIA',
    phase.exitCriteria.map(s),
    accent
  );
  doc.y = Math.max(h1, h2);
}

// --------------------------------------------------------------------------
// Primitives
// --------------------------------------------------------------------------
function sectionHeading(doc: PDFKit.PDFDocument, text: string, y: number): number {
  doc.rect(M, y + 2, 4, 16).fill(hex(COLORS.brand));
  doc
    .fill(hex(COLORS.ink))
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(text, M + 12, y);
  return doc.y + 12;
}

function drawBar(
  doc: PDFKit.PDFDocument,
  label: string,
  score: number,
  meta: string,
  y: number
): number {
  const labelW = 170;
  const barX = M + labelW;
  const barW = CONTENT_W - labelW - 70;
  doc
    .fill(hex(COLORS.ink))
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(label, M, y + 1, { width: labelW - 10, ellipsis: true });
  // Track.
  roundedRect(doc, barX, y + 2, barW, 9, 4.5).fill(hex(COLORS.line));
  const col = score >= 75 ? COLORS.green : score >= 45 ? COLORS.amber : COLORS.red;
  const fillW = Math.max(6, (barW * score) / 100);
  roundedRect(doc, barX, y + 2, fillW, 9, 4.5).fill(hex(col));
  doc
    .fill(hex(COLORS.inkSoft))
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(`${score}%`, barX + barW + 8, y, { width: 60 });
  doc
    .fill(hex(COLORS.inkMuted))
    .font('Helvetica')
    .fontSize(7.5)
    .text(meta, barX + barW + 8, y + 11, { width: 60 });
  return y + 24;
}

/**
 * Draws a list of Assessment items with a Yes/No (or displayValue) badge.
 * Returns y unchanged if items is empty (caller decides on gaps).
 */
function drawAssessmentList(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  title: string,
  items: Assessment[],
  color: string,
  bulletChar: string
): number {
  if (!items.length) return y;

  // Ensure there's enough room for the title + at least one item.
  if (y + 32 > PAGE.height - M) {
    doc.addPage();
    y = M;
  }
  doc
    .fill(hex(color))
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(title, x, y, { characterSpacing: 1 });
  let cy = y + 16;

  items.forEach((item) => {
    doc.font('Helvetica').fontSize(9.5);
    const answerText = itemAnswer(item);
    const answerColor = item.displayValue != null
      ? COLORS.brand
      : item.answer ? COLORS.green : COLORS.red;

    // Measure row height (question text wraps, badge stays on first line).
    const badgeW = 36;
    const textW = w - 16 - badgeW - 6;
    const itemH = doc.heightOfString(s(item.question), { width: textW, lineGap: 1 });
    if (cy + itemH > PAGE.height - M) {
      doc.addPage();
      cy = M;
    }

    // Bullet.
    doc.fill(hex(color)).font('Helvetica-Bold').fontSize(9).text(bulletChar, x, cy);
    // Question text — save doc.y afterward so multi-line questions advance cy correctly.
    doc
      .fill(hex(COLORS.inkSoft))
      .font('Helvetica')
      .fontSize(9.5)
      .text(s(item.question), x + 14, cy - 1, { width: textW, lineGap: 1 });
    const afterQuestion = doc.y;
    // Answer badge (pill).
    const badgeX = x + w - badgeW;
    roundedRect(doc, badgeX, cy, badgeW, 14, 7).fill(
      hex(answerColor === COLORS.green ? COLORS.greenSoft : answerColor === COLORS.red ? COLORS.redSoft : COLORS.brandSoft)
    );
    doc
      .fill(hex(answerColor))
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text(answerText, badgeX, cy + 3, { width: badgeW, align: 'center' });
    cy = afterQuestion + 8;
  });
  return cy;
}

function drawAction(
  doc: PDFKit.PDFDocument,
  a: { title: string; detail: string; owner: string; priority: string; addresses?: string; patternName?: string },
  y: number,
  accent: string
): number {
  const padX = 16;
  const innerW = CONTENT_W - padX * 2;
  const startY = y;

  // Measure heights.
  doc.font('Helvetica-Bold').fontSize(12);
  const titleH = doc.heightOfString(a.title, { width: innerW - 90 });
  // Show first sentence of detail only (mirrors UI).
  const firstSentence = (a.detail.split('\n\n')[0].match(/^[^.!?]+[.!?]/)?.[0] || a.detail).slice(0, 180);
  doc.font('Helvetica').fontSize(10);
  const detailH = doc.heightOfString(firstSentence, { width: innerW, lineGap: 2 });
  const patternH = a.patternName ? 18 : 0;
  const boxH = 14 + Math.max(titleH, 16) + 6 + patternH + detailH + 16 + 14;

  // Card.
  card(doc, M, startY, CONTENT_W, boxH);
  doc.rect(M, startY, 4, boxH).fill(hex(accent));

  let cy = startY + 14;
  // Priority chip (right).
  const pc = PRIORITY_COLOR[a.priority] || COLORS.brand;
  const chipText = a.priority.toUpperCase();
  doc.font('Helvetica-Bold').fontSize(8);
  const chipW = doc.widthOfString(chipText) + 16;
  roundedRect(doc, M + CONTENT_W - padX - chipW, cy, chipW, 16, 8).fill(hex(pc));
  doc
    .fill(hex(COLORS.white))
    .text(chipText, M + CONTENT_W - padX - chipW, cy + 4, {
      width: chipW,
      align: 'center',
    });

  // Title.
  doc
    .fill(hex(COLORS.ink))
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(s(a.title), M + padX, cy, { width: innerW - chipW - 10 });
  cy = doc.y + 4;

  // Pattern tag (if present).
  if (a.patternName) {
    doc.font('Helvetica').fontSize(8);
    const tagW = Math.min(doc.widthOfString(a.patternName) + 14, innerW);
    roundedRect(doc, M + padX, cy, tagW, 14, 7).fill(hex(COLORS.brandSoft));
    doc.fill(hex(COLORS.brand)).text(s(a.patternName), M + padX + 7, cy + 3, { width: tagW - 14, lineBreak: false });
    cy += 18;
  }

  // Detail (first sentence).
  doc
    .fill(hex(COLORS.inkSoft))
    .font('Helvetica')
    .fontSize(10)
    .text(s(firstSentence), M + padX, cy, { width: innerW, lineGap: 2 });
  cy = doc.y + 8;

  // Owner.
  doc
    .fill(hex(COLORS.inkMuted))
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('OWNER  ', M + padX, cy, { continued: true, characterSpacing: 1 })
    .fill(hex(COLORS.inkSoft))
    .font('Helvetica')
    .text(s(a.owner));

  return startY + boxH + 12;
}

function drawMiniList(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  title: string,
  items: string[],
  accent: string
): number {
  doc.font('Helvetica').fontSize(9);
  let contentH = 30;
  items.forEach((it) => {
    contentH += doc.heightOfString(it, { width: w - 30 }) + 6;
  });
  card(doc, x, y, w, contentH);
  doc.rect(x, y, w, 3).fill(hex(accent));
  doc
    .fill(hex(COLORS.inkMuted))
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(title, x + 14, y + 14, { characterSpacing: 1 });
  let cy = y + 30;
  items.forEach((it) => {
    doc.fill(hex(accent)).font('Helvetica-Bold').fontSize(9).text('>', x + 14, cy);
    doc
      .fill(hex(COLORS.inkSoft))
      .font('Helvetica')
      .fontSize(9)
      .text(s(it), x + 26, cy, { width: w - 40, lineGap: 1 });
    cy = doc.y + 6;
  });
  return y + contentH + 12;
}

function drawScoreRing(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  r: number,
  score: number,
  color: string
) {
  const lw = 12;
  doc.lineWidth(lw).strokeColor(hex(COLORS.line)).circle(cx, cy, r).stroke();
  const start = -Math.PI / 2;
  const end = start + (Math.PI * 2 * Math.min(100, Math.max(0, score))) / 100;
  doc
    .lineWidth(lw)
    .strokeColor(hex(color))
    .lineCap('round')
    .path(describeArc(cx, cy, r, start, end))
    .stroke();
  doc
    .fill(hex(color))
    .font('Helvetica-Bold')
    .fontSize(30)
    .text(String(score), cx - r, cy - 20, { width: r * 2, align: 'center' });
  doc
    .fill(hex(COLORS.inkMuted))
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('HEALTH SCORE', cx - r, cy + 14, {
      width: r * 2,
      align: 'center',
      characterSpacing: 1,
    });
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number
): string {
  const segments = 60;
  let d = '';
  for (let i = 0; i <= segments; i++) {
    const a = start + ((end - start) * i) / segments;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return d;
}

function card(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number
) {
  roundedRect(doc, x, y, w, h, 10).fill(hex(COLORS.surface));
  roundedRect(doc, x, y, w, h, 10).lineWidth(1).stroke(hex(COLORS.line));
}

function roundedRect(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  return doc.roundedRect(x, y, w, h, r);
}

function estimateActionHeight(
  doc: PDFKit.PDFDocument,
  title: string,
  detail: string,
  owner: string,
  addresses?: string
): number {
  const innerW = CONTENT_W - 32;
  doc.font('Helvetica-Bold').fontSize(12);
  const t = doc.heightOfString(title, { width: innerW - 90 });
  doc.font('Helvetica').fontSize(10);
  const firstSentence = (detail.split('\n\n')[0].match(/^[^.!?]+[.!?]/)?.[0] || detail).slice(0, 180);
  const d = doc.heightOfString(firstSentence, { width: innerW, lineGap: 2 });
  return 14 + Math.max(t, 16) + 6 + d + 30 + 24;
}

// --------------------------------------------------------------------------
// Footers (page numbers)
// --------------------------------------------------------------------------
function addFooters(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  const totalPages = range.count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(range.start + i);
    // Skip footer on cover (page 0).
    if (i === 0) continue;
    // Keep y well within the content area (PAGE.height - M = 785.89).
    // Drawing beyond that would trigger pdfkit's auto-addPage, creating blank pages.
    const y = PAGE.height - M - 22;
    doc
      .lineWidth(0.5)
      .strokeColor(hex(COLORS.line))
      .moveTo(M, y)
      .lineTo(PAGE.width - M, y)
      .stroke();
    doc
      .fill(hex(COLORS.inkMuted))
      .font('Helvetica')
      .fontSize(8)
      .text(s(`${BRAND.name} | ${BRAND.tagline}`), M, y + 6, { lineBreak: false });
    doc
      .fill(hex(COLORS.inkMuted))
      .font('Helvetica')
      .fontSize(8)
      .text(`Page ${i + 1} of ${totalPages}`, M, y + 6, {
        width: CONTENT_W,
        align: 'right',
      });
  }
}
