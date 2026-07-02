/**
 * Shared domain types for the Red Account Plan generator.
 */

/** A single answered question extracted from the workbook. */
export interface Assessment {
  /** The tab/worksheet the item came from. */
  tab: string;
  /** The human-readable question / criterion text. */
  question: string;
  /** true = checkbox ticked (Yes), false = not ticked (No). */
  answer: boolean;
  /**
   * Polarity of the question.
   *  - false (default): a positive criterion — ticked (Yes) is GOOD.
   *  - true: a negative/risk-flag question — ticked (Yes) is BAD.
   * e.g. "Did the champion leave the company?" ticked = a problem.
   */
  negative?: boolean;
  /**
   * Normalized health signal, independent of polarity:
   *  - true  => this item is a PROBLEM (a risk / gap) for the account.
   *  - false => this item is HEALTHY (a strength).
   * For positive questions: isRisk = !answer.
   * For negative questions: isRisk =  answer.
   */
  isRisk: boolean;
  /** Optional notes/comment captured from an adjacent cell. */
  notes?: string;
}

/** Aggregated results for a single tab. */
export interface TabSummary {
  tab: string;
  total: number;
  yes: number;
  no: number;
  /** 0..100 – percentage of "Yes" answers. */
  score: number;
  items: Assessment[];
}

/** RAG (Red / Amber-Yellow / Green) health status. */
export type HealthStatus = 'Red' | 'Yellow' | 'Green';

/** A single actionable play in the plan. */
export interface PlanAction {
  title: string;
  detail: string;
  owner: string;
  /** Which weakness this action addresses. */
  addresses?: string;
  priority: 'Critical' | 'High' | 'Medium';
}

/** One horizon (30 / 60 / 90) of the success plan. */
export interface PlanPhase {
  horizon: 30 | 60 | 90;
  label: string;
  /** Target status by the end of this horizon. */
  targetStatus: HealthStatus;
  objective: string;
  actions: PlanAction[];
  successMetrics: string[];
  exitCriteria: string[];
}

/** Full analysis payload returned to the client. */
export interface AnalysisResult {
  fileName: string;
  generatedAt: string;
  overall: {
    total: number;
    yes: number;
    no: number;
    score: number;
    status: HealthStatus;
  };
  tabs: TabSummary[];
  /** The lowest-scoring criteria that most threaten the account. */
  topRisks: Assessment[];
  /** The strengths we can leverage. */
  strengths: Assessment[];
  plan: PlanPhase[];
  executiveSummary: string;
  /** Non-fatal warnings to surface to the user (e.g. chaos data unavailable). */
  warnings?: string[];
  /** Live chaos metric values (present when Harness data was fetched). */
  chaosMetrics?: {
    teamsOnboardedPct: number;
    licenseUtilizationPct: number;
    avgMonthlyExperimentRuns: number;
    totalExperimentRuns: number;
  };
}
