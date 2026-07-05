import { loadConfig } from './config';
import { HarnessClient } from './harnessClient';
import {
  computeOnboardingThreshold,
  computeLicenseUtilization,
  computeTeamsOnboarded,
  computeExperimentRunStats,
} from './thresholds';

/**
 * chaos-data CLI
 *
 * 1. Reads Harness token / base URL / account ID from the .env file.
 * 2. Fetches the CHAOS module license -> secondaryEntitlement / 3 gives the
 *    threshold for the number of projects that should be onboarded.
 * 3. Fetches overall chaos stats -> totalUsage / secondaryEntitlement gives the
 *    license utilization percentage.
 * 4. Fetches service utilisation -> counts unique onboarded projects, then
 *    uniqueProjects / threshold gives the percentage of teams onboarded.
 * 5. From the same service utilisation data, sums experimentRuns to give total
 *    and average monthly (total / 12) experiment runs.
 */
async function main() {
  const asJson = process.argv.includes('--json');
  const moduleArg = getFlag('--module') || 'CHAOS';
  const days = Number(getFlag('--days') || '365');
  const startDateArg = getFlag('--start-date');
  const endDateArg = getFlag('--end-date');

  const cfg = loadConfig();
  const client = new HarnessClient(cfg);

  // --- Step 1: onboarding threshold from license secondary entitlement -------
  const license = await client.getModuleLicense(moduleArg);
  const threshold = computeOnboardingThreshold(license);

  // --- Resolve query window --------------------------------------------------
  // Priority: --start-date / --end-date  >  --days (default 365).
  const { startTime, endTime, windowLabel } = resolveWindow(days, startDateArg, endDateArg);

  // Compute actual months so avg monthly runs reflects the real window length.
  const MILLIS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;
  const monthsDivisor = Math.max(1, Math.round((endTime - startTime) / MILLIS_PER_MONTH));

  // --- Step 2: license utilization from overall stats totalUsage -------------
  const stats = await client.getOverallStats(startTime, endTime);
  const utilization = computeLicenseUtilization(
    stats.totalUsage,
    threshold.secondaryEntitlement
  );

  // --- Steps 3 & 4: teams onboarded + experiment runs (one API scan) ---------
  const service = await client.getServiceUtilisation(startTime, endTime);
  const teams = computeTeamsOnboarded(
    service.uniqueProjects,
    threshold.threshold
  );
  const runs = computeExperimentRunStats(service.totalExperimentRuns, monthsDivisor);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          accountId: cfg.accountId,
          window: { label: windowLabel, startTime, endTime },
          onboardingThreshold: threshold,
          licenseUtilization: utilization,
          teamsOnboarded: {
            ...teams,
            projectKeys: service.projectKeys,
          },
          experimentRuns: runs,
        },
        null,
        2
      )
    );
    return;
  }

  console.log('');
  console.log('  Harness Chaos — Account Data');
  console.log('  ============================');
  console.log(`  Account:                 ${cfg.accountId}`);
  console.log(`  Module:                  ${threshold.moduleType}`);
  console.log(`  Window:                  ${windowLabel}`);
  console.log('');
  console.log('  1) Onboarding threshold (projects to onboard)');
  console.log('  ---------------------------------------------');
  console.log(`  Secondary entitlement:   ${threshold.secondaryEntitlement}`);
  console.log(`  Divisor:                 ${threshold.divisor}`);
  console.log(
    `  Raw threshold:           ${threshold.rawThreshold} (= ${threshold.secondaryEntitlement} / ${threshold.divisor})`
  );
  console.log(`  => Projects to onboard:  ${threshold.threshold}`);
  console.log('');
  console.log(`  2) License utilization (${windowLabel})`);
  console.log('  ---------------------------------------------');
  console.log(`  Total usage:             ${utilization.totalUsage}`);
  console.log(`  Secondary entitlement:   ${utilization.secondaryEntitlement}`);
  console.log(
    `  Ratio:                   ${utilization.ratio} (= ${utilization.totalUsage} / ${utilization.secondaryEntitlement})`
  );
  console.log(`  => Utilization:          ${utilization.percentage}%`);
  console.log('');
  console.log(`  3) Teams onboarded (${windowLabel})`);
  console.log('  ---------------------------------------------');
  console.log(`  Unique projects onboarded: ${teams.uniqueProjects}`);
  console.log(`  Onboarding threshold:      ${teams.threshold}`);
  console.log(
    `  Ratio:                     ${teams.ratio} (= ${teams.uniqueProjects} / ${teams.threshold})`
  );
  console.log(`  => Teams onboarded:        ${teams.percentage}%`);
  console.log('');
  console.log(`  4) Experiment runs (${windowLabel})`);
  console.log('  ---------------------------------------------');
  console.log(`  Total experiment runs:     ${runs.totalExperimentRuns}`);
  console.log(`  Months divisor:            ${runs.monthsDivisor}`);
  console.log(
    `  => Avg monthly runs:       ${runs.avgMonthlyExperimentRuns} (= ${runs.totalExperimentRuns} / ${runs.monthsDivisor})`
  );
  console.log('');
}

/** Read a `--flag value` style argument. */
function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

/**
 * Resolve the query window into epoch-millisecond timestamps.
 *
 * Priority:
 *   --start-date / --end-date supplied  →  use those exact dates
 *   otherwise                           →  [now - days*24h, now]
 *
 * Either date can be omitted independently:
 *   --start-date only  →  end defaults to today
 *   --end-date only    →  start defaults to (endDate - days*24h)
 */
function resolveWindow(
  days: number,
  startDate?: string,
  endDate?: string
): { startTime: number; endTime: number; windowLabel: string } {
  if (!startDate && !endDate) {
    const endTime = Date.now();
    const startTime = endTime - days * 24 * 60 * 60 * 1000;
    return { startTime, endTime, windowLabel: `last ${days} days` };
  }

  const endTime = endDate
    ? new Date(`${endDate}T23:59:59.999Z`).getTime()
    : Date.now();
  const startTime = startDate
    ? new Date(`${startDate}T00:00:00.000Z`).getTime()
    : endTime - days * 24 * 60 * 60 * 1000;

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    throw new Error(
      `Invalid date format. Expected YYYY-MM-DD, got --start-date "${startDate}" --end-date "${endDate}".`
    );
  }
  if (startTime >= endTime) {
    throw new Error('--start-date must be before --end-date.');
  }

  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    startTime,
    endTime,
    windowLabel: `${fmt(startTime)} → ${fmt(endTime)}`,
  };
}

main().catch((err) => {
  console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
