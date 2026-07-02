import ExcelJS from 'exceljs';
import { Assessment } from '../types';
import { isNegativeQuestion, toIsRisk } from './polarity';
import { ChaosMetrics, CHAOS_FIELD_LABELS } from './chaosData';

/** Tabs that drive the success plan. Analysis is scoped to these only. */
export const CHAOS_TAB = 'Chaos-Data-Questionnaire';
export const HARNESS_TAB = 'Harness-Questionnaire';
export const ACCOUNT_TAB = 'Account_Details';
const ANALYZED_TABS = new Set([HARNESS_TAB.toLowerCase(), CHAOS_TAB.toLowerCase()]);

/**
 * Health thresholds for the four numeric chaos metrics. A value is HEALTHY
 * (counts as a ticked/Yes) when it is >= the threshold; otherwise it is a gap.
 */
const CHAOS_THRESHOLDS: Record<keyof ChaosMetrics, number> = {
  teamsOnboardedPct: 50,
  licenseUtilizationPct: 50,
  avgMonthlyExperimentRuns: 50,
  totalExperimentRuns: 500,
};

/**
 * Extracts assessment answers from an Excel workbook.
 *
 * Excel "checkboxes" show up in several different ways depending on how the
 * template was authored. This parser handles the common ones:
 *
 *  1. Native cell checkboxes / boolean values  -> TRUE / FALSE cell values.
 *  2. Textual markers typed into a cell        -> "Yes"/"No", "Y"/"N",
 *     "x", "✓", "✔", "[x]", "checked", "1"/"0", etc.
 *  3. Legacy Form-Control / ActiveX checkboxes -> parsed from the raw sheet
 *     XML (their checked state lives in the drawing/control XML, not in a
 *     cell), then associated with the nearest label to their left.
 *
 * The goal: ticked = Yes (true), un-ticked = No (false).
 */

const TRUTHY = new Set([
  'true',
  'yes',
  'y',
  'x',
  '✓',
  '✔',
  '☑',
  '✅',
  'checked',
  'check',
  'done',
  'complete',
  'completed',
  '1',
  '[x]',
  '(x)',
]);

const FALSY = new Set([
  'false',
  'no',
  'n',
  '',
  '-',
  'unchecked',
  '☐',
  '□',
  '0',
  '[ ]',
  '( )',
  'n/a',
  'na',
]);

/** Interpret a raw cell value as a tri-state: true / false / undefined (unknown). */
function interpretValue(value: ExcelJS.CellValue): boolean | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'boolean') return value;

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }

  let text = '';
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'object') {
    // Rich text / formula / hyperlink objects.
    const anyVal = value as any;
    if (typeof anyVal.result !== 'undefined') return interpretValue(anyVal.result);
    if (typeof anyVal.text === 'string') text = anyVal.text;
    else if (Array.isArray(anyVal.richText)) {
      text = anyVal.richText.map((rt: any) => rt.text).join('');
    }
  }

  const norm = text.trim().toLowerCase();
  if (TRUTHY.has(norm)) return true;
  if (FALSY.has(norm)) return false;
  // Marker characters embedded in longer text.
  if (/[✓✔☑✅]/.test(norm)) return true;
  return undefined;
}

/** Pull plain text out of any cell value (used for question labels). */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  const anyVal = value as any;
  if (typeof anyVal.text === 'string') return anyVal.text.trim();
  if (Array.isArray(anyVal.richText)) {
    return anyVal.richText.map((rt: any) => rt.text).join('').trim();
  }
  if (typeof anyVal.result !== 'undefined') return String(anyVal.result).trim();
  if (typeof anyVal.hyperlink === 'string' && anyVal.text) return String(anyVal.text).trim();
  return '';
}

const HEADER_HINTS = [
  'yes',
  'no',
  'checked',
  'answer',
  'response',
  'status',
  'complete',
  'done',
  'value',
  'y/n',
];

/** Words that, when they ARE the label, indicate a header row (any row). */
const LABEL_HEADER_WORDS = new Set([
  'criteria',
  'criterion',
  'question',
  'questions',
  'item',
  'items',
  'assessment',
  'checklist',
  'description',
  'category',
  'area',
  'topic',
  'metric',
  'metrics',
]);

/** Raw text values in the answer column that indicate a header row (any row). */
const ANSWER_HEADER_WORDS = new Set([
  'checked',
  'answer',
  'response',
  'status',
  'yes/no',
  'y/n',
  'value',
  'result',
]);

/**
 * Parse a worksheet by scanning each row for:
 *   - a label cell (longest text in the row), and
 *   - an answer cell (a boolean-ish / marker value).
 */
function parseWorksheet(ws: ExcelJS.Worksheet): Assessment[] {
  const results: Assessment[] = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    let label = '';
    let answer: boolean | undefined;
    let notes = '';

    const cells: { col: number; value: ExcelJS.CellValue }[] = [];
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      cells.push({ col: colNumber, value: cell.value });
    });

    if (cells.length === 0) return;

    // Find the best label: the longest predominantly-alphabetic string.
    let bestLabelLen = 0;
    for (const c of cells) {
      const t = cellText(c.value);
      const interpreted = interpretValue(c.value);
      const looksLikeAnswer = interpreted !== undefined && t.length <= 12;

      if (!looksLikeAnswer && /[a-zA-Z]/.test(t) && t.length > bestLabelLen) {
        bestLabelLen = t.length;
        label = t;
      }
    }

    // Find the answer: prefer a boolean-ish cell that isn't the label.
    let answerRawText = '';
    for (const c of cells) {
      const t = cellText(c.value);
      if (t === label && label.length > 12) continue;
      const interpreted = interpretValue(c.value);
      if (interpreted !== undefined && t.length <= 12) {
        answer = interpreted;
        answerRawText = t;
        break;
      }
    }

    // Capture a longer free-text cell (not the label) as notes.
    for (const c of cells) {
      const t = cellText(c.value);
      if (t && t !== label && t.length > 15 && interpretValue(c.value) === undefined) {
        notes = t;
      }
    }

    // Skip header rows. Three ways to detect one:
    //  a) row 1 whose label looks like a header hint;
    //  b) the label itself is a header word (e.g. "Criteria", "Question");
    //  c) the answer cell's raw text is a header word (e.g. "Checked", "Status")
    //     — this catches header rows on any row, e.g. a "Criteria | Checked" row
    //     where "Checked" would otherwise be misread as a ticked answer.
    const lowerLabel = label.toLowerCase();
    const lowerAnswerText = answerRawText.toLowerCase();
    const isHeaderRow =
      (rowNumber === 1 &&
        HEADER_HINTS.some((h) => lowerLabel === h || lowerLabel.startsWith(h))) ||
      LABEL_HEADER_WORDS.has(lowerLabel) ||
      ANSWER_HEADER_WORDS.has(lowerAnswerText);

    if (label && answer !== undefined && !isHeaderRow && label.length > 2) {
      const negative = isNegativeQuestion(label);
      results.push({
        tab: ws.name,
        question: label,
        answer,
        negative,
        isRisk: toIsRisk(answer, negative),
        notes: notes || undefined,
      });
    }
  });

  return results;
}

/**
 * Fallback / augmentation: read legacy form-control checkboxes from the raw
 * worksheet XML. ExcelJS does not expose their checked state, so we inspect the
 * underlying `<control>` / `<checkBox checked="Checked"/>` markers when present.
 *
 * This is best-effort; if the template uses cell values (the common modern
 * case) this simply returns nothing extra.
 */
async function parseFormControls(
  workbook: ExcelJS.Workbook
): Promise<Assessment[]> {
  // ExcelJS keeps control data on worksheet model when available.
  const extra: Assessment[] = [];
  workbook.eachSheet((ws) => {
    const model: any = (ws as any).model;
    const controls = model?.controls || model?.formControls;
    if (Array.isArray(controls)) {
      for (const ctrl of controls) {
        const checked =
          ctrl.checked === true ||
          ctrl.checked === 'Checked' ||
          ctrl.fmlaLink?.checked === true;
        const text = (ctrl.text || ctrl.name || '').toString().trim();
        if (text) {
          const negative = isNegativeQuestion(text);
          const ans = Boolean(checked);
          extra.push({
            tab: ws.name,
            question: text,
            answer: ans,
            negative,
            isRisk: toIsRisk(ans, negative),
          });
        }
      }
    }
  });
  return extra;
}

/** Loosely normalize a tab name so "Chaos_Data Questionnaire" == "Chaos-Data-Questionnaire". */
function normalizeTab(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, '-').trim();
}

/** Is this worksheet one of the two tabs that drive the plan? */
function isAnalyzedTab(name: string): boolean {
  const n = normalizeTab(name);
  return ANALYZED_TABS.has(n);
}

/**
 * Locate the Chaos-Data-Questionnaire worksheet and write each computed metric
 * into the value cell immediately to the right of its label. If a label is not
 * found it is appended as a new row so the value is still recorded.
 */
function fillChaosTab(
  workbook: ExcelJS.Workbook,
  metrics: ChaosMetrics
): void {
  const ws = workbook.worksheets.find(
    (w) => normalizeTab(w.name) === normalizeTab(CHAOS_TAB)
  );
  if (!ws) return;

  const targets: { label: string; value: number }[] = [
    { label: CHAOS_FIELD_LABELS.teamsOnboardedPct, value: metrics.teamsOnboardedPct },
    { label: CHAOS_FIELD_LABELS.licenseUtilizationPct, value: metrics.licenseUtilizationPct },
    { label: CHAOS_FIELD_LABELS.avgMonthlyExperimentRuns, value: metrics.avgMonthlyExperimentRuns },
    { label: CHAOS_FIELD_LABELS.totalExperimentRuns, value: metrics.totalExperimentRuns },
  ];

  for (const t of targets) {
    const wanted = t.label.toLowerCase().replace(/\s+/g, ' ').trim();
    let filled = false;

    ws.eachRow({ includeEmpty: false }, (row) => {
      if (filled) return;
      let labelCol = -1;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const text = cellText(cell.value).toLowerCase().replace(/\s+/g, ' ').trim();
        if (text === wanted) labelCol = colNumber;
      });
      if (labelCol !== -1) {
        row.getCell(labelCol + 1).value = t.value;
        row.commit();
        filled = true;
      }
    });

    if (!filled) {
      ws.addRow([t.label, t.value]).commit();
    }
  }
}

/**
 * Read whatever values are already in Column 2 of the Chaos-Data-Questionnaire
 * tab for the four numeric metric labels.
 *
 * Returns a complete ChaosMetrics object if ALL four labels have a non-negative
 * numeric value — which means the customer filled them in manually (typical for
 * on-prem / SMP deployments where the Harness API is not reachable).
 *
 * Returns null if any value is missing or non-numeric, signalling that the
 * server should fall back to fetching live data from the Harness API.
 */
export async function readChaosMetricsFromExcel(buffer: Buffer): Promise<ChaosMetrics | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const ws = workbook.worksheets.find(
    (w) => normalizeTab(w.name) === normalizeTab(CHAOS_TAB)
  );
  if (!ws) return null;

  // Labels we are looking for (keyed for fast lookup).
  const labelToKey = new Map<string, keyof ChaosMetrics>([
    ['percentage of teams onboarded', 'teamsOnboardedPct'],
    ['license utilisation percentage', 'licenseUtilizationPct'],
    ['avg monthly experiment runs', 'avgMonthlyExperimentRuns'],
    ['total number of experiment executions', 'totalExperimentRuns'],
  ]);

  const found: Partial<Record<keyof ChaosMetrics, number>> = {};

  ws.eachRow({ includeEmpty: false }, (row) => {
    let labelCol = -1;
    let metricKey: keyof ChaosMetrics | undefined;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = cellText(cell.value).toLowerCase().replace(/\s+/g, ' ').trim();
      if (labelToKey.has(text) && labelCol === -1) {
        labelCol = colNumber;
        metricKey = labelToKey.get(text);
      }
    });

    if (labelCol !== -1 && metricKey) {
      const valueCell = row.getCell(labelCol + 1);
      const raw = valueCell.value;
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
      if (!isNaN(num) && num >= 0) {
        found[metricKey] = num;
      }
    }
  });

  if (
    found.teamsOnboardedPct !== undefined &&
    found.licenseUtilizationPct !== undefined &&
    found.avgMonthlyExperimentRuns !== undefined &&
    found.totalExperimentRuns !== undefined
  ) {
    return found as ChaosMetrics;
  }

  return null;
}

/** The four chaos fields in a stable order, with their threshold keys. */
const CHAOS_ROWS: { key: keyof ChaosMetrics; label: string }[] = [
  { key: 'teamsOnboardedPct', label: CHAOS_FIELD_LABELS.teamsOnboardedPct },
  { key: 'licenseUtilizationPct', label: CHAOS_FIELD_LABELS.licenseUtilizationPct },
  { key: 'avgMonthlyExperimentRuns', label: CHAOS_FIELD_LABELS.avgMonthlyExperimentRuns },
  { key: 'totalExperimentRuns', label: CHAOS_FIELD_LABELS.totalExperimentRuns },
];

/** True if a question is one of the four numeric chaos metric labels. */
function isChaosMetricLabel(question: string): boolean {
  const q = (question || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return CHAOS_ROWS.some(
    (r) => r.label.toLowerCase().replace(/\s+/g, ' ').trim() === q
  );
}

/**
 * Turn the four numeric chaos metrics into health-signal assessments using the
 * configured thresholds (>= threshold = healthy/ticked).
 *
 * When `metrics` is undefined (chaos data could not be fetched), the four
 * fields are still emitted — as gaps with an explicit "data unavailable" note —
 * so the Chaos-Data-Questionnaire tab is always analyzed and visible.
 */
function chaosAssessments(metrics?: ChaosMetrics): Assessment[] {
  return CHAOS_ROWS.map((r) => {
    if (!metrics) {
      return {
        tab: CHAOS_TAB,
        question: r.label,
        answer: false,
        negative: false,
        isRisk: true,
        notes: `Chaos data unavailable (could not reach Harness). Healthy when >= ${CHAOS_THRESHOLDS[r.key]}.`,
      };
    }
    const value = metrics[r.key];
    const healthy = value >= CHAOS_THRESHOLDS[r.key];
    return {
      tab: CHAOS_TAB,
      question: r.label,
      answer: healthy,
      negative: false,
      isRisk: !healthy,
      notes: `Measured: ${value} (healthy when >= ${CHAOS_THRESHOLDS[r.key]})`,
    };
  });
}

/**
 * Read a workbook buffer and return the assessment items that drive the plan.
 *
 * Behaviour:
 *  - If `metrics` are provided, the four values are written into the
 *    Chaos-Data-Questionnaire tab and evaluated against health thresholds.
 *  - Analysis is scoped to the Harness-Questionnaire and
 *    Chaos-Data-Questionnaire tabs only; all other tabs are ignored.
 */
export async function parseWorkbook(
  buffer: Buffer,
  metrics?: ChaosMetrics
): Promise<Assessment[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  if (metrics) fillChaosTab(workbook, metrics);

  let items: Assessment[] = [];
  workbook.eachSheet((ws) => {
    if (!isAnalyzedTab(ws.name)) return; // only the two questionnaire tabs
    let parsed = parseWorksheet(ws);
    // In the Chaos tab, the four metric rows are scored from fetched values
    // (see chaosAssessments), so drop them here; keep all OTHER rows as normal
    // checkbox questions (ticked = Yes, unticked = No).
    if (normalizeTab(ws.name) === normalizeTab(CHAOS_TAB)) {
      parsed = parsed.filter((i) => !isChaosMetricLabel(i.question));
    }
    items = items.concat(parsed);
  });

  const controls = await parseFormControls(workbook);
  for (const c of controls) {
    if (!isAnalyzedTab(c.tab)) continue;
    if (
      normalizeTab(c.tab) === normalizeTab(CHAOS_TAB) &&
      isChaosMetricLabel(c.question)
    ) {
      continue; // metric rows are handled by chaosAssessments
    }
    const dup = items.some(
      (i) => i.tab === c.tab && i.question.toLowerCase() === c.question.toLowerCase()
    );
    if (!dup) items.push(c);
  }

  // The four Chaos metric fields are always analyzed. When metrics are present
  // they are scored from the fetched values against thresholds; when they are
  // not (Harness unreachable) they are emitted as explicit gaps so they are
  // never silently dropped. (The tab's other checkbox rows are parsed above.)
  items = items.concat(chaosAssessments(metrics));

  return items;
}

/** A single label/value pair from the Account Details tab. */
export interface AccountDetail {
  label: string;
  value: string;
}

/** Format a raw Account-Details cell value for display. */
function formatDetailValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    // Show large numbers with thousands separators (e.g. ARR).
    return value.toLocaleString('en-US');
  }
  if (value instanceof Date) {
    return value.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
  return cellText(value);
}

/**
 * Read the Account Details tab as an ordered list of label/value pairs.
 * Returns an empty array when the tab is absent.
 */
export async function extractAccountDetails(
  buffer: Buffer
): Promise<AccountDetail[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const ws = workbook.worksheets.find(
    (w) => normalizeTab(w.name) === normalizeTab(ACCOUNT_TAB)
  );
  if (!ws) return [];

  const details: AccountDetail[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: { col: number; value: ExcelJS.CellValue }[] = [];
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      cells.push({ col: colNumber, value: cell.value });
    });
    if (cells.length < 2) return;
    const label = cellText(cells[0].value);
    const value = formatDetailValue(cells[1].value);
    // Skip an obvious header row like "Field | Value".
    const lower = label.toLowerCase();
    if (lower === 'field' || lower === 'label' || lower === 'attribute') return;
    if (label) details.push({ label, value });
  });
  return details;
}

/**
 * Load a workbook, write the four chaos metrics into Col 2 of the
 * Chaos-Data-Questionnaire tab, and return the updated workbook as an .xlsx
 * buffer. Use this to hand the user back a file with the values filled in.
 */
export async function fillWorkbook(
  buffer: Buffer,
  metrics: ChaosMetrics
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  fillChaosTab(workbook, metrics);
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
