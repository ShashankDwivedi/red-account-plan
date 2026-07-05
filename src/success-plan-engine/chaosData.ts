import { loadConfig } from '../chaos-data/src/config';
import { HarnessClient } from '../chaos-data/src/harnessClient';
import {
  computeOnboardingThreshold,
  computeLicenseUtilization,
  computeTeamsOnboarded,
  computeExperimentRunStats,
} from '../chaos-data/src/thresholds';

/**
 * The four chaos metrics we surface into the Chaos-Data-Questionnaire tab.
 * All values are numbers; percentages are expressed as whole-number percents
 * (e.g. 60 means 60%).
 */
export interface ChaosMetrics {
  /** Percentage of teams (unique projects) onboarded vs. the threshold. */
  teamsOnboardedPct: number;
  /** License utilization percentage (totalUsage / secondaryEntitlement). */
  licenseUtilizationPct: number;
  /** Average monthly experiment runs (total / 12). */
  avgMonthlyExperimentRuns: number;
  /** Total number of experiment executions (runs) in the window. */
  totalExperimentRuns: number;
}

/** The four field labels, as they appear in the Chaos-Data-Questionnaire tab. */
export const CHAOS_FIELD_LABELS = {
  teamsOnboardedPct: 'Percentage Of Teams Onboarded',
  licenseUtilizationPct: 'License Utilisation Percentage',
  avgMonthlyExperimentRuns: 'Avg Monthly Experiment Runs',
  totalExperimentRuns: 'Total Number of Experiment Executions',
} as const;

/**
 * Fetch the four chaos metrics from Harness using the same logic as the
 * chaos-data CLI (reads token / base URL / account ID from the .env file).
 *
 * @param days      Lookback window in days (default 365). Ignored when
 *                  `startDate` and `endDate` are both provided.
 * @param startDate Optional ISO date string (`YYYY-MM-DD`). When provided the
 *                  window starts at 00:00:00 UTC on that date.
 * @param endDate   Optional ISO date string (`YYYY-MM-DD`). When provided the
 *                  window ends at 23:59:59.999 UTC on that date. Defaults to
 *                  today when `startDate` is given but `endDate` is omitted.
 */
export async function fetchChaosMetrics(
  days = 365,
  startDate?: string,
  endDate?: string
): Promise<ChaosMetrics> {
  const cfg = loadConfig();
  const client = new HarnessClient(cfg);

  // Step 1: onboarding threshold from the CHAOS license secondary entitlement.
  const license = await client.getModuleLicense('CHAOS');
  const threshold = computeOnboardingThreshold(license);

  // Resolve the query window.
  const { startTime, endTime } = resolveWindow(days, startDate, endDate);

  // Compute actual months in the window for an accurate avg monthly figure.
  const MILLIS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;
  const monthsDivisor = Math.max(1, Math.round((endTime - startTime) / MILLIS_PER_MONTH));

  // Step 2: license utilization from overall stats totalUsage.
  const stats = await client.getOverallStats(startTime, endTime);
  const utilization = computeLicenseUtilization(
    stats.totalUsage,
    threshold.secondaryEntitlement
  );

  // Steps 3 & 4: teams onboarded + experiment runs (single service scan).
  const service = await client.getServiceUtilisation(startTime, endTime);
  const teams = computeTeamsOnboarded(service.uniqueProjects, threshold.threshold);
  const runs = computeExperimentRunStats(service.totalExperimentRuns, monthsDivisor);

  return {
    teamsOnboardedPct: teams.percentage,
    licenseUtilizationPct: utilization.percentage,
    avgMonthlyExperimentRuns: runs.avgMonthlyExperimentRuns,
    totalExperimentRuns: runs.totalExperimentRuns,
  };
}

/**
 * Convert optional ISO date strings into epoch-millisecond timestamps.
 *
 * Rules:
 *  - Both absent  → window = [now - days * 24h, now]
 *  - startDate only → endDate defaults to today
 *  - endDate only   → startDate defaults to (endDate - days * 24h)
 *  - Both present  → use them as-is; `days` is ignored
 */
function resolveWindow(
  days: number,
  startDate?: string,
  endDate?: string
): { startTime: number; endTime: number } {
  if (!startDate && !endDate) {
    const endTime = Date.now();
    return { startTime: endTime - days * 24 * 60 * 60 * 1000, endTime };
  }

  const endTime = endDate
    ? new Date(`${endDate}T23:59:59.999Z`).getTime()
    : Date.now();
  const startTime = startDate
    ? new Date(`${startDate}T00:00:00.000Z`).getTime()
    : endTime - days * 24 * 60 * 60 * 1000;

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    throw new Error(
      `Invalid date format. Expected YYYY-MM-DD, got startDate="${startDate}" endDate="${endDate}".`
    );
  }
  if (startTime >= endTime) {
    throw new Error('startDate must be before endDate.');
  }

  return { startTime, endTime };
}
