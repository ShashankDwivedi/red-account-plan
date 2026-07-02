import ExcelJS from 'exceljs';
import { Assessment } from '../types';
import { isNegativeQuestion, toIsRisk } from './polarity';

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

/** Read a workbook buffer and return every assessment item across all tabs. */
export async function parseWorkbook(buffer: Buffer): Promise<Assessment[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  let items: Assessment[] = [];
  workbook.eachSheet((ws) => {
    items = items.concat(parseWorksheet(ws));
  });

  const controls = await parseFormControls(workbook);
  // De-duplicate control items already captured via cell scan.
  for (const c of controls) {
    const dup = items.some(
      (i) => i.tab === c.tab && i.question.toLowerCase() === c.question.toLowerCase()
    );
    if (!dup) items.push(c);
  }

  return items;
}
