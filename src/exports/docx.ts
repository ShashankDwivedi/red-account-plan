import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  TableLayoutType,
} from 'docx';
import { AnalysisResult, Assessment, PlanPhase } from '../types';
import { BRAND, COLORS, statusColors, horizonColor, PRIORITY_COLOR, formatDate, splitByCategory } from './theme';

/**
 * Executive-ready Word document built with `docx`.
 *
 * Structure mirrors the web UI:
 *   - Cover block (title, account, status, score).
 *   - Account Details (if present).
 *   - Executive Summary ("Why Account is Red/Yellow") as bullets.
 *   - Chaos Data Metrics (if present).
 *   - Correlated Risk Pattern Analysis (if present).
 *   - What's Not Working Well / What's Working Well (with Yes/No/value answers).
 *   - One section per horizon with top-3 actions (pattern-tagged) + metrics/exits.
 */

const FONT = 'Calibri';

/** Priority sort — lower = higher urgency. */
const PRIO_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2 };

/** "Why Account is Red/Yellow" label matching the UI. */
function statusLabel(status: string): string {
  if (status === 'Green') return 'Account is Healthy';
  if (status === 'Yellow') return 'Why Account is Yellow';
  return 'Why Account is Red';
}

/** Display answer — matches UI badge logic. */
function itemAnswer(item: Assessment): string {
  if (item.displayValue != null) return item.displayValue;
  return item.answer ? 'Yes' : 'No';
}

/** Color for an answer badge. */
function answerColor(item: Assessment): string {
  if (item.displayValue != null) return COLORS.brand;
  return item.answer ? COLORS.green : COLORS.red;
}

export async function generateDocx(data: AnalysisResult): Promise<Buffer> {
  const sc = statusColors(data.overall.status);

  const children: (Paragraph | Table)[] = [];

  // ---- Cover ------------------------------------------------------------
  children.push(
    new Paragraph({
      spacing: { before: 200, after: 60 },
      children: [
        new TextRun({
          text: BRAND.name.toUpperCase(),
          bold: true,
          size: 20,
          color: COLORS.brand,
          font: FONT,
          characterSpacing: 40,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: '30·60·90 Day Customer Success Plan', bold: true, size: 52, color: COLORS.ink, font: FONT }),
      ],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({ text: 'Moving the account from Red → Yellow → Green', italics: true, size: 24, color: COLORS.inkSoft, font: FONT }),
      ],
    })
  );

  // Meta + status card.
  children.push(
    shadedInfoTable([
      ['Account / Source', data.fileName],
      ['Prepared', formatDate(data.generatedAt)],
      ['Overall Health Score', `${data.overall.score} / 100`],
      ['Account Status', statusLabel(data.overall.status)],
    ], sc.main)
  );

  // ---- Account Details --------------------------------------------------
  if (data.accountDetails && data.accountDetails.length) {
    children.push(heading('Account Details'));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: noBorders(),
        rows: chunkArray(data.accountDetails, 2).map(
          (rowItems) =>
            new TableRow({
              children: rowItems.map((d) =>
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.surfaceSoft },
                  margins: { top: 80, bottom: 80, left: 140, right: 100 },
                  children: [
                    new Paragraph({ children: [new TextRun({ text: d.label.toUpperCase(), bold: true, size: 16, color: COLORS.inkMuted, font: FONT, characterSpacing: 20 })] }),
                    new Paragraph({ children: [new TextRun({ text: d.value || '—', bold: true, size: 24, color: COLORS.ink, font: FONT })] }),
                  ],
                })
              ),
            })
        ),
      })
    );
  }

  // ---- Executive summary ------------------------------------------------
  children.push(heading(statusLabel(data.overall.status)));
  data.executiveSummary
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) =>
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          bullet: { level: 0 },
          children: [new TextRun({ text: line, size: 21, color: COLORS.inkSoft, font: FONT })],
        })
      )
    );
  // Key stats strip.
  children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  children.push(statStrip(data));

  // ---- Chaos Metrics ----------------------------------------------------
  if (data.chaosMetrics) {
    const m = data.chaosMetrics;
    children.push(heading('Chaos Data Metrics'));
    const cells = [
      { label: 'Teams Onboarded', value: `${m.teamsOnboardedPct}%` },
      { label: 'License Utilisation', value: `${m.licenseUtilizationPct}%` },
      { label: 'Avg Monthly Runs', value: String(m.avgMonthlyExperimentRuns) },
      { label: 'Total Experiment Runs', value: String(m.totalExperimentRuns) },
    ];
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: noBorders(),
        rows: [
          new TableRow({
            children: cells.map((c) =>
              new TableCell({
                shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.surfaceSoft },
                margins: { top: 120, bottom: 120, left: 60, right: 60 },
                children: [
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.value, bold: true, size: 40, color: COLORS.brand, font: FONT })] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.label.toUpperCase(), size: 15, color: COLORS.inkMuted, font: FONT, characterSpacing: 20 })] }),
                ],
              })
            ),
          }),
        ],
      })
    );
  }

  // ---- Correlated Risk Patterns -----------------------------------------
  if (data.riskPatterns && data.riskPatterns.length) {
    children.push(heading('Correlated Risk Pattern Analysis'));
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: 'Root-cause clusters identified by the CS consultant engine. The 30-60-90 plan addresses each pattern.', italics: true, size: 19, color: COLORS.inkMuted, font: FONT })],
      })
    );
    const SEV_COLOR: Record<string, string> = { Critical: COLORS.red, High: COLORS.amber, Medium: '0891B2' };
    data.riskPatterns.forEach((p) => {
      const accent = SEV_COLOR[p.severity] || COLORS.brand;
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 40 },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.surfaceSoft },
          border: { left: { color: accent, size: 16, style: BorderStyle.SINGLE, space: 8 } },
          children: [
            new TextRun({ text: `${p.severity.toUpperCase()}  `, bold: true, size: 18, color: accent, font: FONT }),
            new TextRun({ text: p.name, bold: true, size: 24, color: COLORS.ink, font: FONT }),
            new TextRun({ text: `  (${p.matchedRisks.length} risks)`, size: 18, color: COLORS.inkMuted, font: FONT }),
          ],
        })
      );
      children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: p.description, italics: true, size: 20, color: COLORS.inkSoft, font: FONT })] }));
      children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Root Cause: ', bold: true, size: 18, color: COLORS.inkMuted, font: FONT }), new TextRun({ text: p.rootCause, size: 18, color: COLORS.inkSoft, font: FONT })] }));
      children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Business Risk: ', bold: true, size: 18, color: COLORS.inkMuted, font: FONT }), new TextRun({ text: p.implication, size: 18, color: COLORS.inkSoft, font: FONT })] }));
      const risksPreview = p.matchedRisks.slice(0, 4).join(' | ') + (p.matchedRisks.length > 4 ? ` +${p.matchedRisks.length - 4} more` : '');
      children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: 'Linked Risks: ', bold: true, size: 18, color: COLORS.inkMuted, font: FONT }), new TextRun({ text: risksPreview, size: 18, color: COLORS.inkSoft, font: FONT })] }));
    });
  }

  // ---- What's Not Working Well / What's Working Well --------------------
  children.push(heading(`What's Not Working Well (${data.topRisks.length})`));
  assessmentBullets(data.topRisks, COLORS.red, 'Business Related Risks', 'Chaos Risks', 'No gaps detected.')
    .forEach((p) => children.push(p));

  children.push(heading(`What's Working Well (${data.strengths.length})`));
  assessmentBullets(data.strengths, COLORS.green, 'Business Related Strengths', 'Chaos Strengths', 'None recorded.')
    .forEach((p) => children.push(p));

  // ---- Phases -----------------------------------------------------------
  data.plan.forEach((phase) => {
    phaseSection(phase).forEach((el) => children.push(el));
  });

  const doc = new Document({
    creator: BRAND.name,
    title: `${data.fileName} — 30-60-90 Success Plan`,
    description: 'Customer Success 30-60-90 Day Recovery Plan',
    styles: {
      default: {
        document: { run: { font: FONT, size: 22, color: COLORS.ink } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
        headers: undefined,
        footers: undefined,
        children,
      },
    ],
  });

  return (await Packer.toBuffer(doc)) as Buffer;
}

// --------------------------------------------------------------------------
// Building blocks
// --------------------------------------------------------------------------
function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    border: { bottom: { color: COLORS.line, size: 6, style: BorderStyle.SINGLE, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 28, color: COLORS.ink, font: FONT })],
  });
}

function bullet(text: string, color: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    bullet: { level: 0 },
    children: [new TextRun({ text, size: 21, color: COLORS.inkSoft, font: FONT })],
  });
}

function subHeading(text: string, color: string): Paragraph {
  return new Paragraph({
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 20, color, font: FONT })],
  });
}

/** Render a categorized list of Assessment items with Yes/No/value answer badges. */
function assessmentBullets(
  items: Assessment[],
  color: string,
  businessLabel: string,
  chaosLabel: string,
  emptyMsg: string
): Paragraph[] {
  if (!items.length) return [bullet(emptyMsg, color)];
  const { business, chaos } = splitByCategory(items);
  const out: Paragraph[] = [];

  function group(label: string, groupItems: Assessment[]) {
    if (!groupItems.length) return;
    out.push(subHeading(`${label} (${groupItems.length})`, color));
    groupItems.forEach((item) => {
      const ans = itemAnswer(item);
      const aColor = answerColor(item);
      out.push(
        new Paragraph({
          spacing: { after: 60 },
          bullet: { level: 0 },
          children: [
            new TextRun({ text: item.question, size: 21, color: COLORS.inkSoft, font: FONT }),
            new TextRun({ text: `  [${ans}]`, bold: true, size: 19, color: aColor, font: FONT }),
          ],
        })
      );
    });
  }

  group(businessLabel, business);
  group(chaosLabel, chaos);
  return out;
}

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
}

function shadedInfoTable(rows: [string, string][], accent: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.line },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.line },
      left: { style: BorderStyle.SINGLE, size: 24, color: accent },
      right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.line },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: COLORS.line },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: rows.map(
      ([k, v]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 35, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.surfaceSoft },
              margins: { top: 80, bottom: 80, left: 140, right: 100 },
              children: [
                new Paragraph({ children: [new TextRun({ text: k.toUpperCase(), bold: true, size: 16, color: COLORS.inkMuted, font: FONT, characterSpacing: 20 })] }),
              ],
            }),
            new TableCell({
              width: { size: 65, type: WidthType.PERCENTAGE },
              margins: { top: 80, bottom: 80, left: 140, right: 100 },
              children: [
                new Paragraph({ children: [new TextRun({ text: v, bold: true, size: 22, color: COLORS.ink, font: FONT })] }),
              ],
            }),
          ],
        })
    ),
  });
}

function statStrip(data: AnalysisResult): Table {
  const cells = [
    { label: 'CRITERIA', value: String(data.overall.total), color: COLORS.ink },
    { label: 'MET (YES)', value: String(data.overall.yes), color: COLORS.green },
    { label: 'GAPS (NO)', value: String(data.overall.no), color: COLORS.red },
    { label: 'AREAS', value: String(data.tabs.length), color: COLORS.brand },
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: noBorders(),
    rows: [
      new TableRow({
        children: cells.map(
          (c) =>
            new TableCell({
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.surfaceSoft },
              margins: { top: 120, bottom: 120, left: 60, right: 60 },
              children: [
                new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.value, bold: true, size: 40, color: c.color, font: FONT })] }),
                new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.label, size: 15, color: COLORS.inkMuted, font: FONT, characterSpacing: 20 })] }),
              ],
            })
        ),
      }),
    ],
  });
}

function cellText(text: string, align: (typeof AlignmentType)[keyof typeof AlignmentType]): TableCell {
  return new TableCell({
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, size: 20, color: COLORS.inkSoft, font: FONT })] })],
  });
}

function prioritySoft(priority: string): string {
  return priority === 'Critical' ? COLORS.redSoft : priority === 'High' ? COLORS.amberSoft : 'ECFEFF';
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function phaseSection(phase: PlanPhase): (Paragraph | Table)[] {
  const accent = horizonColor(phase.horizon);
  const days = phase.horizon === 30 ? '0–30' : phase.horizon === 60 ? '31–60' : '61–90';
  const titlePart = phase.label.split('·').slice(1).join('·').trim() || phase.label;
  const out: (Paragraph | Table)[] = [];

  // pageBreakBefore on an empty paragraph prevents the blank-page issue that a
  // manual PageBreak element causes when preceding content ends at page bottom.
  out.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] }));

  // Colored header band.
  out.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: noBorders(),
      rows: [
        new TableRow({
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: accent },
              margins: { top: 160, bottom: 160, left: 200, right: 200 },
              children: [
                new Paragraph({ children: [new TextRun({ text: `DAYS ${days}`, bold: true, size: 16, color: 'FFFFFF', font: FONT, characterSpacing: 40 })] }),
                new Paragraph({ children: [new TextRun({ text: titlePart, bold: true, size: 32, color: 'FFFFFF', font: FONT })] }),
                new Paragraph({ children: [new TextRun({ text: `Target status: ${phase.targetStatus}`, size: 18, color: 'FFFFFF', font: FONT })] }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  out.push(
    new Paragraph({
      spacing: { before: 160, after: 160 },
      children: [new TextRun({ text: phase.objective, italics: true, size: 21, color: COLORS.inkSoft, font: FONT })],
    })
  );

  // Top 3 actions sorted by priority (matches UI).
  const topActions = phase.actions
    .slice()
    .sort((a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9))
    .slice(0, 3);

  // Actions table header.
  const actionHeader = new TableRow({
    tableHeader: true,
    children: ['#', 'Action', 'Owner', 'Priority'].map(
      (h) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.surfaceSoft },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: h.toUpperCase(), bold: true, size: 15, color: COLORS.inkMuted, font: FONT, characterSpacing: 20 })] })],
        })
    ),
  });

  const actionRows = topActions.map((a, idx) => {
    const pc = PRIORITY_COLOR[a.priority] || COLORS.brand;
    // First sentence only — mirrors UI.
    const firstSentence = (a.detail.split('\n\n')[0].match(/^[^.!?]+[.!?]/)?.[0] || a.detail).slice(0, 200);
    const paras: Paragraph[] = [
      new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: a.title, bold: true, size: 21, color: COLORS.ink, font: FONT })] }),
      new Paragraph({ children: [new TextRun({ text: firstSentence, size: 19, color: COLORS.inkSoft, font: FONT })] }),
    ];
    if (a.patternName) {
      paras.push(new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: `Pattern: ${a.patternName}`, italics: true, size: 16, color: COLORS.brand, font: FONT })] }));
    }
    return new TableRow({
      children: [
        new TableCell({ width: { size: 5, type: WidthType.PERCENTAGE }, margins: { top: 100, bottom: 100, left: 120, right: 60 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(idx + 1), bold: true, size: 20, color: COLORS.inkMuted, font: FONT })] })] }),
        new TableCell({ width: { size: 58, type: WidthType.PERCENTAGE }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: paras }),
        new TableCell({ width: { size: 21, type: WidthType.PERCENTAGE }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: a.owner, size: 18, color: COLORS.inkSoft, font: FONT })] })] }),
        new TableCell({
          width: { size: 16, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: prioritySoft(a.priority) },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: a.priority, bold: true, size: 16, color: pc, font: FONT })] })],
        }),
      ],
    });
  });

  out.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      columnWidths: [5, 58, 21, 16].map((p) => Math.round((p / 100) * 9000)),
      borders: {
        top: { style: BorderStyle.SINGLE, size: 2, color: COLORS.line },
        bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.line },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: COLORS.line },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      },
      rows: [actionHeader, ...actionRows],
    })
  );

  // Success Metrics.
  out.push(
    new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: 'Success Metrics', bold: true, size: 20, color: accent, font: FONT })] })
  );
  phase.successMetrics.forEach((m) => out.push(bullet(m, accent)));

  // Exit Criteria.
  out.push(
    new Paragraph({ spacing: { before: 120, after: 80 }, children: [new TextRun({ text: 'Exit Criteria', bold: true, size: 20, color: accent, font: FONT })] })
  );
  phase.exitCriteria.forEach((x) => out.push(bullet(x, accent)));

  return out;
}
