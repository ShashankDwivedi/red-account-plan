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
 * @param days lookback window in days (default 365).
 */
export async function fetchChaosMetrics(days = 365): Promise<ChaosMetrics> {
  const cfg = loadConfig();
  const client = new HarnessClient(cfg);

  // Step 1: onboarding threshold from the CHAOS license secondary entitlement.
  const license = await client.getModuleLicense('CHAOS');
  const threshold = computeOnboardingThreshold(license);

  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  // Step 2: license utilization from overall stats totalUsage.
  const stats = await client.getOverallStats(startTime, endTime);
  const utilization = computeLicenseUtilization(
    stats.totalUsage,
    threshold.secondaryEntitlement
  );

  // Steps 3 & 4: teams onboarded + experiment runs (single service scan).
  const service = await client.getServiceUtilisation(startTime, endTime);
  const teams = computeTeamsOnboarded(service.uniqueProjects, threshold.threshold);
  const runs = computeExperimentRunStats(service.totalExperimentRuns);

  return {
    teamsOnboardedPct: teams.percentage,
    licenseUtilizationPct: utilization.percentage,
    avgMonthlyExperimentRuns: runs.avgMonthlyExperimentRuns,
    totalExperimentRuns: runs.totalExperimentRuns,
  };
}
