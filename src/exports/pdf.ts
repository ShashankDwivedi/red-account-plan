import PDFDocument from 'pdfkit';
import { AnalysisResult, PlanPhase } from '../types';
import {
  BRAND,
  COLORS,
  hex,
  statusColors,
  horizonColor,
  PRIORITY_COLOR,
  formatDate,
} from './theme';

/**
 * Executive-ready PDF built with pdfkit.
 *
 * Layout:
 *   1. Cover page  – brand, title, account, RAG status, health score ring.
 *   2. Executive summary + health dashboard (tab bars, risks/strengths).
 *   3. One section per horizon (30 / 60 / 90) with actions, metrics, exits.
 *
 * Design language mirrors the web UI: slate ink, indigo brand, RAG accents,
 * generous whitespace, and a consistent footer.
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait (pt)
const M = 56; // page margin
const CONTENT_W = PAGE.width - M * 2;

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

  // Status badge (dot + label, laid out left-to-right and centered as a unit).
  const badgeText = `ACCOUNT STATUS: ${data.overall.status.toUpperCase()}`;
  doc.font('Helvetica-Bold').fontSize(12);
  const textW = doc.widthOfString(badgeText);
  const dotGap = 10;
  const dotR = 5;
  const padX = 22;
  const bw = padX * 2 + dotR * 2 + dotGap + textW;
  const bx = ringCx - bw / 2;
  const by = ringCy + 92;
  roundedRect(doc, bx, by, bw, 34, 17).fill(hex(sc.soft));
  doc.circle(bx + padX + dotR, by + 17, dotR).fill(hex(sc.main));
  doc
    .fill(hex(sc.main))
    .font('Helvetica-Bold')
    .fontSize(12)
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
  stats.forEach((s, i) => {
    const x = M + i * colW;
    doc
      .fill(hex(s.color || COLORS.ink))
      .font('Helvetica-Bold')
      .fontSize(24)
      .text(s.value, x, sy, { width: colW, align: 'center' });
    doc
      .fill(hex(COLORS.inkMuted))
      .font('Helvetica')
      .fontSize(9)
      .text(s.label.toUpperCase(), x, sy + 30, {
        width: colW,
        align: 'center',
        characterSpacing: 1,
      });
  });
}

// --------------------------------------------------------------------------
// Summary + dashboard page
// --------------------------------------------------------------------------
function drawSummary(doc: PDFKit.PDFDocument, data: AnalysisResult) {
  doc.addPage();
  let y = M;

  y = sectionHeading(doc, 'Executive Summary', y);
  doc
    .fill(hex(COLORS.inkSoft))
    .font('Helvetica')
    .fontSize(11)
    .text(s(data.executiveSummary), M, y, { width: CONTENT_W, lineGap: 4 });
  y = doc.y + 24;

  // Health by area.
  y = sectionHeading(doc, 'Health by Assessment Area', y);
  data.tabs.forEach((t) => {
    if (y > PAGE.height - M - 40) {
      doc.addPage();
      y = M;
    }
    y = drawBar(doc, s(t.tab), t.score, `${t.yes}/${t.total} yes`, y);
  });
  y += 16;

  // Risks & strengths — full-width stacked lists so every item is shown.
  if (y > PAGE.height - M - 160) {
    doc.addPage();
    y = M;
  }
  y = sectionHeading(doc, 'Risks & Strengths', y);

  y = drawList(
    doc,
    M,
    y,
    CONTENT_W,
    `TOP RISKS (${data.topRisks.length})`,
    data.topRisks.map((r) => s(r.question)),
    COLORS.red,
    'X'
  );
  y += 14;
  y = drawList(
    doc,
    M,
    y,
    CONTENT_W,
    `STRENGTHS TO LEVERAGE (${data.strengths.length})`,
    data.strengths.map((x) => s(x.question)),
    COLORS.green,
    'Y'
  );
  doc.y = y;
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
    .text(s(`DAYS ${phase.horizon === 30 ? '0–30' : phase.horizon === 60 ? '31–60' : '61–90'}`), M, 32, {
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

  // Actions.
  phase.actions.forEach((a) => {
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

function drawList(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  title: string,
  items: string[],
  color: string,
  bullet: string
): number {
  doc
    .fill(hex(color))
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(title, x, y, { characterSpacing: 1 });
  let cy = y + 16;
  const list = items.length ? items : ['None recorded.'];
  list.forEach((it) => {
    // Measure this item and break to a new page if it won't fit.
    doc.font('Helvetica').fontSize(9.5);
    const itemH = doc.heightOfString(s(it), { width: w - 16, lineGap: 1 });
    if (cy + itemH > PAGE.height - M) {
      doc.addPage();
      cy = M;
    }
    doc.fill(hex(color)).font('Helvetica-Bold').fontSize(9).text(bullet, x, cy);
    doc
      .fill(hex(COLORS.inkSoft))
      .font('Helvetica')
      .fontSize(9.5)
      .text(s(it), x + 14, cy - 1, { width: w - 16, lineGap: 1 });
    cy = doc.y + 8;
  });
  return cy;
}

function drawAction(
  doc: PDFKit.PDFDocument,
  a: { title: string; detail: string; owner: string; priority: string; addresses?: string },
  y: number,
  accent: string
): number {
  const padX = 16;
  const innerW = CONTENT_W - padX * 2;
  const startY = y;

  // Measure heights.
  doc.font('Helvetica-Bold').fontSize(12);
  const titleH = doc.heightOfString(a.title, { width: innerW - 90 });
  doc.font('Helvetica').fontSize(10);
  const detailH = doc.heightOfString(a.detail, { width: innerW, lineGap: 2 });
  const addressesH = a.addresses
    ? doc.heightOfString(`Addresses: ${a.addresses}`, { width: innerW }) + 6
    : 0;
  const boxH = 14 + Math.max(titleH, 16) + 6 + detailH + 16 + addressesH + 14;

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
  cy = doc.y + 6;

  // Detail.
  doc
    .fill(hex(COLORS.inkSoft))
    .font('Helvetica')
    .fontSize(10)
    .text(s(a.detail), M + padX, cy, { width: innerW, lineGap: 2 });
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
  cy = doc.y + 2;

  if (a.addresses) {
    doc
      .fill(hex(COLORS.inkMuted))
      .font('Helvetica-Oblique')
      .fontSize(8.5)
      .text(s(`Addresses: ${a.addresses}`), M + padX, cy + 4, { width: innerW });
    cy = doc.y;
  }

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
    doc.fill(hex(accent)).font('Helvetica-Bold').fontSize(9).text('›', x + 14, cy);
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
  // Track.
  doc.lineWidth(lw).strokeColor(hex(COLORS.line)).circle(cx, cy, r).stroke();
  // Progress arc.
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
  // Build an SVG arc path across possibly >180deg by segmenting.
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
  const d = doc.heightOfString(detail, { width: innerW, lineGap: 2 });
  const a = addresses ? 24 : 0;
  return 14 + Math.max(t, 16) + 6 + d + 30 + a + 24;
}

// --------------------------------------------------------------------------
// Footers (page numbers)
// --------------------------------------------------------------------------
function addFooters(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Skip footer on cover (page 0).
    if (i === 0) continue;
    const y = PAGE.height - 34;
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
      .text(s(`${BRAND.name} | ${BRAND.tagline}`), M, y + 8, { lineBreak: false });
    doc
      .fill(hex(COLORS.inkMuted))
      .font('Helvetica')
      .fontSize(8)
      .text(`Page ${i + 1} of ${range.count}`, M, y + 8, {
        width: CONTENT_W,
        align: 'right',
      });
  }
}
