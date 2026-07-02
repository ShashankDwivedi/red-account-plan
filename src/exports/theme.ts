import { HealthStatus, Assessment } from '../types';

/**
 * Shared brand + design tokens used across all export formats (PDF, DOCX, PPTX)
 * so the deliverables feel like one consistent, executive-ready system.
 *
 * Colors are hex without the leading '#'. Helpers add it where a library needs
 * it, since pptxgenjs/docx expect "RRGGBB" while pdfkit expects "#RRGGBB".
 */

export const BRAND = {
  name: 'Red Account Plan',
  tagline: 'Customer Success · 30·60·90 Recovery Plan',
};

/** Core palette (hex, no #). */
export const COLORS = {
  ink: '0F172A', // slate-900
  inkSoft: '475569', // slate-600
  inkMuted: '94A3B8', // slate-400
  line: 'E2E8F0', // slate-200
  surface: 'FFFFFF',
  surfaceSoft: 'F8FAFC', // slate-50
  brand: '4F46E5', // indigo-600
  brandDark: '312E81', // indigo-900
  brandSoft: 'EEF2FF', // indigo-50

  red: 'DC2626',
  redSoft: 'FEF2F2',
  amber: 'D97706',
  amberSoft: 'FFFBEB',
  green: '16A34A',
  greenSoft: 'F0FDF4',

  white: 'FFFFFF',
};

/** Priority accent colors. */
export const PRIORITY_COLOR: Record<string, string> = {
  Critical: COLORS.red,
  High: COLORS.amber,
  Medium: '0891B2', // cyan-600
};

/** RAG status -> primary color + soft background. */
export function statusColors(status: HealthStatus): {
  main: string;
  soft: string;
} {
  switch (status) {
    case 'Green':
      return { main: COLORS.green, soft: COLORS.greenSoft };
    case 'Yellow':
      return { main: COLORS.amber, soft: COLORS.amberSoft };
    default:
      return { main: COLORS.red, soft: COLORS.redSoft };
  }
}

/** Per-horizon gradient-ish accent used on phase cards/slides. */
export function horizonColor(horizon: 30 | 60 | 90): string {
  if (horizon === 30) return COLORS.red;
  if (horizon === 60) return COLORS.amber;
  return COLORS.green;
}

/** Prefix a hex value with '#'. */
export function hex(color: string): string {
  return color.startsWith('#') ? color : `#${color}`;
}

/** A short human date for cover pages. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Category of an assessment item, based on which tab it came from:
 *  - 'chaos'    -> Chaos-Data-Questionnaire
 *  - 'business' -> everything else (Harness-Questionnaire)
 */
export function categoryOf(item: Pick<Assessment, 'tab'>): 'business' | 'chaos' {
  const t = (item.tab || '').toLowerCase().replace(/[\s_-]+/g, '-');
  return t.indexOf('chaos') !== -1 ? 'chaos' : 'business';
}

/** Split items into Business Related and Chaos groups (preserving order). */
export function splitByCategory<T extends Pick<Assessment, 'tab'>>(
  items: T[]
): { business: T[]; chaos: T[] } {
  return {
    business: items.filter((i) => categoryOf(i) === 'business'),
    chaos: items.filter((i) => categoryOf(i) === 'chaos'),
  };
}

/** Safe file-name stem derived from the source workbook name. */
export function fileStem(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const clean = base.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'account';
  return `${clean.replace(/\s+/g, '-')}-30-60-90-plan`;
}
