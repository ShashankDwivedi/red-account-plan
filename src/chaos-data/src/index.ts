import { loadConfig } from './config';
import { HarnessClient } from './harnessClient';
import {
  computeOnboardingThreshold,
  computeLicenseUtilization,
  computeTeamsOnboarded,
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
 */
async function main() {
  const asJson = process.argv.includes('--json');
  const moduleArg = getFlag('--module') || 'CHAOS';
  const days = Number(getFlag('--days') || '365');

  const cfg = loadConfig();
  const client = new HarnessClient(cfg);

  // --- Step 1: onboarding threshold from license secondary entitlement -------
  const license = await client.getModuleLicense(moduleArg);
  const threshold = computeOnboardingThreshold(license);

  // --- Step 2: license utilization from overall stats totalUsage -------------
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;
  const stats = await client.getOverallStats(startTime, endTime);
  const utilization = computeLicenseUtilization(
    stats.totalUsage,
    threshold.secondaryEntitlement
  );

  // --- Step 3: percentage of teams onboarded ---------------------------------
  const onboarded = await client.getOnboardedProjects(startTime, endTime);
  const teams = computeTeamsOnboarded(
    onboarded.uniqueProjects,
    threshold.threshold
  );

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          accountId: cfg.accountId,
          window: { days, startTime, endTime },
          onboardingThreshold: threshold,
          licenseUtilization: utilization,
          teamsOnboarded: {
            ...teams,
            projectKeys: onboarded.projectKeys,
          },
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
  console.log(`  2) License utilization (last ${days} days)`);
  console.log('  ---------------------------------------------');
  console.log(`  Total usage:             ${utilization.totalUsage}`);
  console.log(`  Secondary entitlement:   ${utilization.secondaryEntitlement}`);
  console.log(
    `  Ratio:                   ${utilization.ratio} (= ${utilization.totalUsage} / ${utilization.secondaryEntitlement})`
  );
  console.log(`  => Utilization:          ${utilization.percentage}%`);
  console.log('');
  console.log(`  3) Teams onboarded (last ${days} days)`);
  console.log('  ---------------------------------------------');
  console.log(`  Unique projects onboarded: ${teams.uniqueProjects}`);
  console.log(`  Onboarding threshold:      ${teams.threshold}`);
  console.log(
    `  Ratio:                     ${teams.ratio} (= ${teams.uniqueProjects} / ${teams.threshold})`
  );
  console.log(`  => Teams onboarded:        ${teams.percentage}%`);
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

main().catch((err) => {
  console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
