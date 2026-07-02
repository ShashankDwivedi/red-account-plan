# chaos-data

A small Node.js + TypeScript CLI that reads Harness credentials from a `.env`
file and computes chaos onboarding thresholds from the Harness
`licenses/modules` API.

## What it does

1. Reads `HARNESS_API_KEY`, `HARNESS_BASE_URL`, and `HARNESS_ACCOUNT_ID` from a
   `.env` file (it searches the current directory and parent directories, so the
   repo-root `.env` is used automatically).
2. **Onboarding threshold** — calls
   `GET /gateway/ng/api/licenses/modules/{accountId}?moduleType=CHAOS`, reads
   `secondaryEntitlement`, and divides it by **3** to produce the **threshold
   for the number of projects that should be onboarded**.
3. **License utilization** — calls
   `GET /gateway/chaos/manager/api/rest/service/overall/stats/{accountId}?startTime=&endTime=`,
   reads `totalUsage`, and divides it by the `secondaryEntitlement` from step 2
   to produce the **license utilization percentage**.
4. **Teams onboarded** — calls
   `GET /gateway/chaos/manager/api/rest/service/{accountId}?startTime=&endTime=&page=&limit=100`
   (paginated), counts the **unique projects** (distinct `orgID/projectID`) with
   chaos activity, and divides that by the onboarding threshold from step 1 to
   produce the **percentage of teams onboarded**.
5. **Experiment runs** — from the same `service/` data, sums `experimentRuns`
   across all services to produce **Total Experiment Runs**, and divides that by
   **12** to produce **Avg Monthly Experiment Runs**.

## Setup

```bash
cd chaos-data
npm install
npm run build
```

## Usage

```bash
# Human-readable output
npm start

# JSON output
node dist/index.js --json

# A different module (default is CHAOS)
node dist/index.js --module CHAOS

# Change the utilization time window (default 365 days)
node dist/index.js --days 90
```

### Required environment variables

| Variable             | Description                         | Default                  |
| -------------------- | ----------------------------------- | ------------------------ |
| `HARNESS_API_KEY`    | Harness PAT / API key (`x-api-key`) | — (required)             |
| `HARNESS_ACCOUNT_ID` | Harness account identifier          | — (required)             |
| `HARNESS_BASE_URL`   | Harness base URL                    | `https://app.harness.io` |

## Formulas

```
onboarding threshold = floor(secondaryEntitlement / 3)
license utilization  = (totalUsage / secondaryEntitlement) * 100   [%]
teams onboarded      = (uniqueProjects / onboardingThreshold) * 100 [%]
total experiment runs = sum(experimentRuns across services)
avg monthly runs      = totalExperimentRuns / 12
```

For the threshold, both the raw (fractional) value and the floored whole number
are returned, since you can't onboard a fraction of a project.

## Project structure

```
src/
  config.ts         .env loader + config resolution
  harnessClient.ts  licenses/modules API client
  thresholds.ts     threshold computation
  index.ts          CLI entry point
```

> Uses Node's built-in `fetch` (Node 18+). No runtime dependencies.
