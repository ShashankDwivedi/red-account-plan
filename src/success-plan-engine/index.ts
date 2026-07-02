/**
 * success-plan-engine
 *
 * Self-contained logic for turning an uploaded Excel account-health assessment
 * into a 30-60-90 day Customer Success plan:
 *
 *  - excelParser: reads every worksheet tab and detects ticked checkboxes.
 *  - polarity:    classifies risk-flag questions where ticked = negative.
 *  - planEngine:  scores health and builds the dynamic 30-60-90 plan.
 */
export { parseWorkbook, fillWorkbook, CHAOS_TAB, HARNESS_TAB } from './excelParser';
export { buildAnalysis } from './planEngine';
export { isNegativeQuestion, toIsRisk } from './polarity';
export { fetchChaosMetrics } from './chaosData';
export type { ChaosMetrics } from './chaosData';
