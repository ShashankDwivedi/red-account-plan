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
  PageBreak,
  TableLayoutType,
} from 'docx';
import { AnalysisResult, PlanPhase } from '../types';
import { BRAND, COLORS, statusColors, horizonColor, PRIORITY_COLOR, formatDate } from './theme';

/**
 * Executive-ready Word document built with `docx`.
 *
 * Structure:
 *   - Branded cover block (title, account, status, score).
 *   - Executive summary.
 *   - Health-by-area table (with RAG-shaded scores).
 *   - Risks & strengths.
 *   - One section per horizon with an actions table + metrics/exit lists.
 */

const FONT = 'Calibri';

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

  // Meta + status card as a 2-col table.
  children.push(
    shadedInfoTable([
      ['Account / Source', data.fileName],
      ['Prepared', formatDate(data.generatedAt)],
      ['Overall Health Score', `${data.overall.score} / 100`],
      ['Account Status', data.overall.status.toUpperCase()],
    ], sc.main)
  );

  // ---- Executive summary ------------------------------------------------
  children.push(heading('Executive Summary'));
  children.push(
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: data.executiveSummary, size: 22, color: COLORS.inkSoft, font: FONT })],
    })
  );

  // Key stats strip.
  children.push(statStrip(data));

  // ---- Health by area ---------------------------------------------------
  children.push(heading('Health by Assessment Area'));
  children.push(healthTable(data));

  // ---- Risks & strengths ------------------------------------------------
  children.push(heading('Top Risks'));
  (data.topRisks.length ? data.topRisks.slice(0, 8) : [{ question: 'No gaps detected.' } as any]).forEach((r) =>
    children.push(bullet(r.question, COLORS.red))
  );
  children.push(heading('Strengths to Leverage'));
  (data.strengths.length ? data.strengths.slice(0, 8) : [{ question: 'None recorded.' } as any]).forEach((s) =>
    children.push(bullet(s.question, COLORS.green))
  );

  // ---- Phases -----------------------------------------------------------
  data.plan.forEach((phase) => {
    children.push(new Paragraph({ children: [new PageBreak()] }));
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

function healthTable(data: AnalysisResult): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: ['Assessment Area', 'Yes / Total', 'Score', 'Status'].map(
      (h, i) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.brandDark },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.CENTER, children: [new TextRun({ text: h.toUpperCase(), bold: true, size: 16, color: 'FFFFFF', font: FONT })] })],
        })
    ),
  });

  const rows = data.tabs.map((t) => {
    const col = t.score >= 75 ? COLORS.green : t.score >= 45 ? COLORS.amber : COLORS.red;
    const label = t.score >= 75 ? 'Green' : t.score >= 45 ? 'Yellow' : 'Red';
    return new TableRow({
      children: [
        cellText(t.tab, AlignmentType.LEFT),
        cellText(`${t.yes} / ${t.total}`, AlignmentType.CENTER),
        new TableCell({
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          verticalAlign: 'center' as any,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${t.score}%`, bold: true, size: 20, color: col, font: FONT })] })],
        }),
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: statusSoft(label) },
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: label, bold: true, size: 18, color: col, font: FONT })] })],
        }),
      ],
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    columnWidths: [50, 18, 16, 16].map((p) => Math.round((p / 100) * 9000)),
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: COLORS.line },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.line },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: COLORS.line },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [headerRow, ...rows],
  });
}

function cellText(text: string, align: (typeof AlignmentType)[keyof typeof AlignmentType]): TableCell {
  return new TableCell({
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, size: 20, color: COLORS.inkSoft, font: FONT })] })],
  });
}

function statusSoft(label: string): string {
  return label === 'Green' ? COLORS.greenSoft : label === 'Yellow' ? COLORS.amberSoft : COLORS.redSoft;
}

function phaseSection(phase: PlanPhase): (Paragraph | Table)[] {
  const accent = horizonColor(phase.horizon);
  const days = phase.horizon === 30 ? '0–30' : phase.horizon === 60 ? '31–60' : '61–90';
  const titlePart = phase.label.split('·').slice(1).join('·').trim() || phase.label;
  const out: (Paragraph | Table)[] = [];

  // Colored header band (single-cell shaded table).
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

  // Actions table.
  const actionHeader = new TableRow({
    tableHeader: true,
    children: ['Action', 'Owner', 'Priority'].map(
      (h) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.surfaceSoft },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: h.toUpperCase(), bold: true, size: 15, color: COLORS.inkMuted, font: FONT, characterSpacing: 20 })] })],
        })
    ),
  });

  const actionRows = phase.actions.map((a) => {
    const pc = PRIORITY_COLOR[a.priority] || COLORS.brand;
    const paras: Paragraph[] = [
      new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: a.title, bold: true, size: 21, color: COLORS.ink, font: FONT })] }),
      new Paragraph({ children: [new TextRun({ text: a.detail, size: 19, color: COLORS.inkSoft, font: FONT })] }),
    ];
    if (a.addresses) {
      paras.push(new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: `Addresses: ${a.addresses}`, italics: true, size: 16, color: COLORS.inkMuted, font: FONT })] }));
    }
    return new TableRow({
      children: [
        new TableCell({ width: { size: 62, type: WidthType.PERCENTAGE }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: paras }),
        new TableCell({ width: { size: 22, type: WidthType.PERCENTAGE }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: a.owner, size: 18, color: COLORS.inkSoft, font: FONT })] })] }),
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
      columnWidths: [62, 22, 16].map((p) => Math.round((p / 100) * 9000)),
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

  // Metrics & exit criteria.
  out.push(
    new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: 'Success Metrics', bold: true, size: 20, color: accent, font: FONT })] })
  );
  phase.successMetrics.forEach((m) => out.push(bullet(m, accent)));
  out.push(
    new Paragraph({ spacing: { before: 120, after: 80 }, children: [new TextRun({ text: 'Exit Criteria', bold: true, size: 20, color: accent, font: FONT })] })
  );
  phase.exitCriteria.forEach((x) => out.push(bullet(x, accent)));

  return out;
}

function prioritySoft(priority: string): string {
  return priority === 'Critical' ? COLORS.redSoft : priority === 'High' ? COLORS.amberSoft : 'ECFEFF';
}
