/**
 * Question polarity: does a TICKED checkbox mean something GOOD or BAD?
 *
 * Most assessment questions are positive ("Is the sponsor engaged?" — ticked =
 * good). But some are risk flags where ticking the box signals a PROBLEM
 * ("Did the champion leave the company?" — ticked = bad).
 *
 * This module is the single source of truth for detecting those negative
 * questions and normalizing every answer into a health signal (`isRisk`).
 */

/**
 * Known negative / risk-flag questions. Ticked (Yes) = negative impact.
 * Matching is case-insensitive and based on distinctive keywords so slight
 * wording differences ("Did the champion leave?" vs "Champion left the org")
 * still match.
 */
const NEGATIVE_PATTERNS: RegExp[] = [
  // 1) Did Champion Leave the Company
  /\bchampion\b.*\b(leav|left|gone|departed?|exit|churn|attrit)/i,
  /\b(lost|no)\s+champion\b/i,

  // 2) Did Sponsor Leave the Company?
  /\bsponsor\b.*\b(leav|left|gone|departed?|exit|churn|attrit)/i,
  /\b(lost|no)\s+sponsor\b/i,

  // 3) Is there a re-org that happened?
  /\bre[-\s]?org(anization|anisation)?\b/i,
  /\breorg\b/i,
  /\b(leadership|management)\s+change\b/i,

  // 4) Training Gap
  /\btraining\s+gap\b/i,
  /\b(lack|missing|insufficient|no)\s+training\b/i,

  // 5) Customer Resource Constraints
  /\bresource\s+constraint/i,
  /\b(customer|resourc).*\bconstraint/i,

  // 6) Customer Technical Constraints
  /\btechnical\s+constraint/i,

  // 7) Vulnerability Constraints  (also spelled "Costraints")
  /\bvulnerab(ility|ilities)?\b.*\bcon?straint/i,
  /\bvulnerab(ility|ilities)\b/i,

  // 8) Infosec Constraints
  /\binfo\s?sec\b.*\bcon?straint/i,
  /\b(information\s+security|infosec|security)\s+con?straint/i,

  // 9) Are there Product Feature Gaps?
  /\bproduct\b.*\bfeature\b.*\bgap/i,
  /\bfeature\s+gap/i,

  // 10) Are there Product Bugs?
  /\bproduct\s+bug/i,

  // General negative phrasing safety net.
  /\bgap\b/i,
  /\bconstraint/i,
  /\bblocker\b/i,
  /\brisk\b(?!\s*(mitigat|owner))/i, // "risk" but not "risk mitigated/owner"
  /\bissue[s]?\b.*\b(open|unresolved|outstanding)\b/i,
  /\bopen\s+(escalation|issue|ticket)/i,
  /\b(churn|at[-\s]?risk|detractor)\b/i,
  /\bcomplaint/i,
  /\b(dissatisf|unhappy|unsatisf)/i,
  /\bdid\s+.*\b(leave|left|quit|resign)/i,
];

/**
 * Explicit NON-risk questions. Even if they'd otherwise match a general
 * safety-net pattern (e.g. "gap"), these are treated as positive questions.
 * (Product Feature Gaps and Product Bugs have been moved to NEGATIVE_PATTERNS.)
 */
const POSITIVE_OVERRIDES: RegExp[] = [];

/** Returns true if a ticked answer to this question is a NEGATIVE signal. */
export function isNegativeQuestion(question: string): boolean {
  const q = (question || '').trim();
  if (!q) return false;
  if (POSITIVE_OVERRIDES.some((re) => re.test(q))) return false;
  return NEGATIVE_PATTERNS.some((re) => re.test(q));
}

/**
 * Normalize an answer + polarity into a health signal.
 *   positive question: isRisk = !answer   (unticked = problem)
 *   negative question: isRisk =  answer    (ticked   = problem)
 */
export function toIsRisk(answer: boolean, negative: boolean): boolean {
  return negative ? answer : !answer;
}
