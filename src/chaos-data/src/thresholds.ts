import { ModuleLicense } from './harnessClient';

/** Divisor used to convert the secondary entitlement into a project threshold. */
export const ONBOARDING_DIVISOR = 3;

export interface OnboardingThreshold {
  moduleType: string;
  secondaryEntitlement: number;
  divisor: number;
  /** Exact (possibly fractional) value. */
  rawThreshold: number;
  /** Floored whole-number threshold (you can't onboard a fraction of a project). */
  threshold: number;
}

/**
 * Threshold for the number of projects that should be onboarded:
 *   secondaryEntitlement / 3
 *
 * We expose both the raw (fractional) value and a floored whole number.
 */
export function computeOnboardingThreshold(
  license: ModuleLicense
): OnboardingThreshold {
  const secondaryEntitlement = license.secondaryEntitlement;
  if (typeof secondaryEntitlement !== 'number' || Number.isNaN(secondaryEntitlement)) {
    throw new Error(
      `Module "${license.moduleType}" has no numeric secondaryEntitlement to compute a threshold from.`
    );
  }

  const rawThreshold = secondaryEntitlement / ONBOARDING_DIVISOR;
  return {
    moduleType: license.moduleType,
    secondaryEntitlement,
    divisor: ONBOARDING_DIVISOR,
    rawThreshold,
    threshold: Math.floor(rawThreshold),
  };
}

export interface LicenseUtilization {
  totalUsage: number;
  secondaryEntitlement: number;
  /** Fraction: totalUsage / secondaryEntitlement (e.g. 1.2). */
  ratio: number;
  /** Percentage rounded to 1 decimal (e.g. 120). */
  percentage: number;
}

/**
 * License utilization percentage:
 *   totalUsage / secondaryEntitlement  (expressed as a percentage)
 */
export function computeLicenseUtilization(
  totalUsage: number,
  secondaryEntitlement: number
): LicenseUtilization {
  if (
    typeof secondaryEntitlement !== 'number' ||
    Number.isNaN(secondaryEntitlement) ||
    secondaryEntitlement === 0
  ) {
    throw new Error(
      'Cannot compute utilization: secondaryEntitlement is missing or zero.'
    );
  }
  const ratio = totalUsage / secondaryEntitlement;
  return {
    totalUsage,
    secondaryEntitlement,
    ratio,
    percentage: Math.round(ratio * 100 * 10) / 10,
  };
}

export interface TeamsOnboarded {
  uniqueProjects: number;
  /** The onboarding threshold from step 1. */
  threshold: number;
  /** Fraction: uniqueProjects / threshold. */
  ratio: number;
  /** Percentage rounded to 1 decimal (progress toward the threshold). */
  percentage: number;
}

/**
 * Percentage of total teams onboarded (progress toward the threshold):
 *   uniqueProjects / threshold  (expressed as a percentage)
 */
export function computeTeamsOnboarded(
  uniqueProjects: number,
  threshold: number
): TeamsOnboarded {
  if (typeof threshold !== 'number' || Number.isNaN(threshold) || threshold === 0) {
    throw new Error(
      'Cannot compute teams onboarded: onboarding threshold is missing or zero.'
    );
  }
  const ratio = uniqueProjects / threshold;
  return {
    uniqueProjects,
    threshold,
    ratio,
    percentage: Math.round(ratio * 100 * 10) / 10,
  };
}

/** Months used to derive the average monthly experiment runs. */
export const MONTHS_IN_YEAR = 12;

export interface ExperimentRunStats {
  totalExperimentRuns: number;
  monthsDivisor: number;
  /** totalExperimentRuns / 12, rounded to 1 decimal. */
  avgMonthlyExperimentRuns: number;
}

/**
 * Experiment run stats:
 *   total       = sum of experimentRuns across services
 *   avg monthly = totalExperimentRuns / monthsDivisor
 *
 * @param totalExperimentRuns  sum of experiment runs across all service entries
 * @param monthsDivisor        number of months in the query window (default 12).
 *                             Pass the actual window duration so the average is
 *                             correct when a custom date range is used.
 */
export function computeExperimentRunStats(
  totalExperimentRuns: number,
  monthsDivisor = MONTHS_IN_YEAR
): ExperimentRunStats {
  const divisor = Math.max(1, monthsDivisor);
  const avg = totalExperimentRuns / divisor;
  return {
    totalExperimentRuns,
    monthsDivisor: divisor,
    avgMonthlyExperimentRuns: Math.round(avg * 10) / 10,
  };
}
