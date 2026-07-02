import {
  Assessment,
  AnalysisResult,
  RiskPattern,
  TabSummary,
  HealthStatus,
  PlanPhase,
  PlanAction,
} from '../types';

/**
 * Customer Success plan engine.
 *
 * Philosophy (Principal CS Architect lens):
 *  - Health is measured across the classic CS value pillars: Adoption,
 *    Value/ROI, Relationship, Sentiment, Commercial, and Support/Product.
 *  - A "Red" account is de-risked in stages. We do not try to fix everything
 *    at once; we sequence work: STABILIZE (0-30d) -> BUILD MOMENTUM (31-60d)
 *    -> INSTITUTIONALIZE VALUE (61-90d).
 *  - Every gap ("No" answer) becomes an owned, time-bound play mapped to the
 *    horizon where it has the most leverage.
 */

// ---------------------------------------------------------------------------
// Scoring & status
// ---------------------------------------------------------------------------

/** RAG thresholds on a 0..100 "Yes" percentage. */
function statusFromScore(score: number): HealthStatus {
  if (score >= 75) return 'Green';
  if (score >= 45) return 'Yellow';
  return 'Red';
}

function summarizeTabs(items: Assessment[]): TabSummary[] {
  const byTab = new Map<string, Assessment[]>();
  for (const item of items) {
    if (!byTab.has(item.tab)) byTab.set(item.tab, []);
    byTab.get(item.tab)!.push(item);
  }

  const summaries: TabSummary[] = [];
  for (const [tab, tabItems] of byTab) {
    // Health-aware counts: "yes" here means HEALTHY (not a risk), "no" means a
    // problem. This keeps polarity correct — a ticked risk flag counts as a
    // problem, not a positive.
    const healthy = tabItems.filter((i) => !i.isRisk).length;
    const total = tabItems.length;
    const problems = total - healthy;
    const score = total > 0 ? Math.round((healthy / total) * 100) : 0;
    summaries.push({
      tab,
      total,
      yes: healthy,
      no: problems,
      score,
      items: tabItems,
    });
  }
  summaries.sort((a, b) => a.score - b.score);
  return summaries;
}

// ---------------------------------------------------------------------------
// Pillar classification – map a free-text question to a CS pillar.
// ---------------------------------------------------------------------------

type Pillar =
  | 'Adoption'
  | 'Value'
  | 'Relationship'
  | 'Sentiment'
  | 'Commercial'
  | 'Support';

const PILLAR_KEYWORDS: Record<Pillar, string[]> = {
  Adoption: [
    'adopt',
    'usage',
    'active',
    'login',
    'feature',
    'onboard',
    'training',
    'enable',
    'rollout',
    'deploy',
    'utiliz',
    'seats',
    'license',
  ],
  Value: [
    'value',
    'roi',
    'outcome',
    'goal',
    'success criteria',
    'business',
    'kpi',
    'metric',
    'benefit',
    'objective',
    'realiz',
    'impact',
  ],
  Relationship: [
    'champion',
    'sponsor',
    'stakeholder',
    'executive',
    'relationship',
    'contact',
    'ebr',
    'qbr',
    'meeting',
    'engagement',
    'decision maker',
    're-org',
    'reorg',
    'reorganization',
    'reorganisation',
    'leadership change',
  ],
  Sentiment: [
    'nps',
    'csat',
    'satisf',
    'sentiment',
    'happy',
    'complaint',
    'escalat',
    'feedback',
    'promoter',
    'reference',
    'advocate',
  ],
  Commercial: [
    'renew',
    'contract',
    'expansion',
    'upsell',
    'cross-sell',
    'revenue',
    'invoice',
    'payment',
    'budget',
    'procure',
    'churn',
    'price',
  ],
  Support: [
    'ticket',
    'support',
    'bug',
    'issue',
    'sla',
    'incident',
    'downtime',
    'performance',
    'defect',
    'response time',
    'product gap',
    'technical constraint',
    'resource constraint',
    'vulnerability',
    'vulnerabilities',
    'infosec',
    'information security',
    'security constraint',
    'compliance',
  ],
};

function classify(question: string): Pillar {
  const q = question.toLowerCase();
  let best: Pillar = 'Adoption';
  let bestHits = 0;
  (Object.keys(PILLAR_KEYWORDS) as Pillar[]).forEach((pillar) => {
    const hits = PILLAR_KEYWORDS[pillar].filter((kw) => q.includes(kw)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = pillar;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// Pattern detection – correlate individual risks into root-cause clusters.
//
// A "pattern" is a set of 2+ related risks that share a common underlying
// driver.  Rather than fixing each checkbox in isolation, the CS plan leads
// with a coordinated intervention that addresses the root cause.  This is the
// difference between a checklist and a consultant's diagnosis.
// ---------------------------------------------------------------------------

interface PatternPlay {
  title: string;
  detail: string;
  owner: string;
}

interface PatternDef {
  id: string;
  name: string;
  severity: PlanAction['priority'];
  description: string;
  minMatches: number;
  testRisk: (question: string) => boolean;
  rootCause: string;
  implication: string;
  plays: Record<30 | 60 | 90, PatternPlay>;
}

interface DetectedPattern {
  def: PatternDef;
  /** The exact risk question strings that triggered this pattern. */
  matchedRisks: string[];
}

const PATTERN_DEFS: PatternDef[] = [
  // ── Pattern 1: Leadership Vacuum ──────────────────────────────────────────
  {
    id: 'leadership_vacuum',
    name: 'Leadership Vacuum',
    severity: 'Critical',
    minMatches: 2,
    testRisk: (q) =>
      /sponsor|champion|re-?org|org chart|executive|leadership change|decision maker|account executive.*connect/i.test(
        q
      ),
    description:
      'Executive alignment has broken down — the account lacks a stable internal sponsor and champion.',
    rootCause:
      'Organisational change (re-org, staff departure) severed the executive relationship without a proactive re-engagement plan from the vendor team.',
    implication:
      'Without an internal sponsor there is no one to champion the renewal, unblock deployment, or drive adoption. This is the #1 predictor of churn for B2B SaaS.',
    plays: {
      30: {
        title: 'Re-establish executive alignment',
        detail:
          'Map the new org structure after the re-org. Identify a candidate sponsor and champion in the reorganised leadership team within the first week. ' +
          'Secure a 30-minute executive alignment meeting within 10 days — present a candid state-of-the-account assessment and co-create a signed recovery commitment. ' +
          'Document every stakeholder with their influence level, attitude toward the product, and preferred communication style. ' +
          'Ensure the AE has a direct, warm line to the executive sponsor — not just the operational champion.',
        owner: 'CSM + Account Executive',
      },
      60: {
        title: 'Stand up a formal governance cadence',
        detail:
          'Establish a bi-weekly champion working session and a monthly executive sponsor review. ' +
          'Use the first champion session to review progress against the signed recovery commitment from day 30. ' +
          'Multi-thread into at least 2 additional contacts (e.g. Head of DevOps, VP Engineering) to eliminate single-point-of-failure risk from future staff turnover.',
        owner: 'CSM',
      },
      90: {
        title: 'Run a recovery-focused Executive Business Review',
        detail:
          'Deliver an EBR that quantifies recovery progress against every risk identified in this plan, demonstrates value delivered during the 90-day period, and presents the renewal narrative. ' +
          'Secure explicit renewal intent from the sponsor before the EBR closes. ' +
          'Use the EBR to formalise the multi-threaded stakeholder map going forward and identify the next strategic goal.',
        owner: 'CSM + Account Executive',
      },
    },
  },

  // ── Pattern 2: Environment & Deployment Blockers ──────────────────────────
  {
    id: 'deployment_blocker',
    name: 'Environment & Deployment Blockers',
    severity: 'Critical',
    minMatches: 2,
    testRisk: (q) =>
      /install|infosec|technical constraint|resource constraint|environment|deploy|security constraint|compliance/i.test(
        q
      ),
    description:
      'The product cannot be fully used due to unresolved environment, security, and resource constraints.',
    rootCause:
      'Post-sale deployment support was insufficient. Infosec, technical, and resource barriers were not jointly owned with a tracked resolution plan from the outset.',
    implication:
      'Zero value realization is possible while deployment is blocked. The customer has no justification for renewing software they cannot run — this must be unblocked before any adoption or value conversation.',
    plays: {
      30: {
        title: 'Launch a deployment unblocking war room',
        detail:
          'Convene a joint task force (CSM + Solutions Engineer + Product/Support) with the customer\'s DevOps and Security teams within 5 days of this plan. ' +
          'Document every blocker (Infosec approval, technical gap, resource constraint) with: a specific vendor owner, a specific customer owner, resolution criteria, and a target date. ' +
          'Treat each blocker as a P1 issue with weekly status emails to the executive sponsor. ' +
          'For SMP (self-managed) deployments: ensure the support team has approved remote or screen-share access to diagnose environment-specific issues without waiting for tickets.',
        owner: 'CSM + Solutions Engineer + Support Lead',
      },
      60: {
        title: 'Achieve first fully operational deployment',
        detail:
          'Drive every blocker to resolution or an agreed workaround. Validate the product is fully operational in the customer\'s target environment by running a joint smoke test. ' +
          'Document each resolved blocker as a concrete proof point for the renewal conversation. ' +
          'If resource constraints were the blocker (no internal staff time), agree a formal staffing plan with the customer\'s manager and fund it with the saved renewal at risk. ' +
          'Confirm there are no hidden secondary blockers before declaring deployment complete.',
        owner: 'CSM + Solutions Engineer',
      },
      90: {
        title: 'Institutionalise the deployment and operations runbook',
        detail:
          'Codify the deployment architecture, security approval process, and resource requirements into a customer-owned runbook so future environment changes (upgrades, new clusters, DR environments) do not reintroduce blockers. ' +
          'Hand ownership of the runbook to the internal champion. ' +
          'Add deployment health (version currency, connectivity, infosec compliance status) as a standing agenda item on the monthly governance cadence.',
        owner: 'Solutions Engineer + CSM',
      },
    },
  },

  // ── Pattern 3: Chaos Engineering Not Operationalized ─────────────────────
  {
    id: 'chaos_not_operationalized',
    name: 'Chaos Engineering Not Operationalized',
    severity: 'High',
    minMatches: 2,
    testRisk: (q) =>
      /probe template|experiment template|pipeline|apm tool|load test|chaos integrat/i.test(q),
    description:
      'Chaos experiments are not embedded in CI/CD pipelines — the product risks being perceived as shelfware.',
    rootCause:
      'The customer moved past initial installation without completing the operationalization checklist: APM instrumentation, probe/experiment template creation, and pipeline integration were skipped or deferred.',
    implication:
      'Without pipeline-integrated, repeatable experiments the customer cannot measure resilience improvements. The renewal ROI case cannot be built without measurable outcomes — every week this remains blocked, the renewal risk increases.',
    plays: {
      30: {
        title: 'Audit operationalization gaps and select the pilot service',
        detail:
          'Conduct a structured audit with the customer\'s chaos champion: Is APM instrumented and generating observable steady-state signals? Are any probe templates created? Are any experiment templates in place? Is chaos triggering from any pipeline stage? ' +
          'Produce a prioritized gap list (what\'s missing and why). ' +
          'Identify ONE high-value, high-traffic service as the pilot for the first pipeline-integrated experiment — choose for impact, not for ease. ' +
          'Document the steady-state hypothesis for the pilot service (what defines "healthy" before an experiment runs).',
        owner: 'CSM + Solutions Engineer',
      },
      60: {
        title: 'Ship the first pipeline-integrated chaos experiment',
        detail:
          'Co-create probe templates and at least one experiment template for the pilot service. ' +
          'Integrate the experiment into the CI/CD pipeline (pre-production stage) so it runs on every deployment build. ' +
          'Instrument APM to provide evidence-based steady-state measurements — this is the foundation for all future ROI claims. ' +
          'Validate with the customer\'s team that they can run the experiment, read the results, and take action without vendor hand-holding. ' +
          'This reference implementation is the template all subsequent experiments follow.',
        owner: 'CSM + Solutions Engineer + Customer Chaos Champion',
      },
      90: {
        title: 'Scale to a Chaos Centre of Excellence (CCoE)',
        detail:
          'Replicate the reference implementation across 3–5 services (targeting the highest business-criticality ones). ' +
          'Integrate load testing alongside chaos experiments in at least one pipeline (the reference service). ' +
          'Draft and hand over a Chaos Engineering Playbook the customer\'s team owns independently, covering: when to run experiments, how to interpret results, how to file hypothesis templates, and how to escalate detected weaknesses. ' +
          'Track and report: monthly experiment run rate, teams onboarded, services covered, and incidents caught by experiments — these become the renewal business case metrics.',
        owner: 'Customer Chaos Champion + CSM',
      },
    },
  },

  // ── Pattern 4: Value Realization Gap ─────────────────────────────────────
  {
    id: 'value_realization_gap',
    name: 'Value Realization Gap',
    severity: 'High',
    minMatches: 1,
    testRisk: (q) =>
      /training gap|avg monthly|total number|license utilisation|license utilization|teams onboarded/i.test(
        q
      ),
    description:
      'Experiment run rates are critically below the healthy threshold — the customer has not derived measurable business value from their investment.',
    rootCause:
      'Enablement was never fully completed after initial setup. Teams lack the skills and confidence to design and run experiments independently, resulting in critically low run rates and under-utilized licenses.',
    implication:
      'Without a value story — reduced incidents, improved MTTR, quantified resilience improvements — the procurement team has no evidence to approve the renewal. This is a direct commercial risk.',
    plays: {
      30: {
        title: 'Baseline the value gap and co-define success metrics',
        detail:
          'Conduct a value-mapping session with the champion: What were the customer\'s stated outcomes when they purchased the product? What metrics would make a compelling renewal story? ' +
          'Capture current-state baseline: experiment run rate (monthly), teams actively running experiments, services covered, MTTR, incident count. ' +
          'Identify the 3 teams with the highest potential to be quick wins — teams that are closest to running experiments but blocked by a training or tooling gap. ' +
          'Agree on the success metrics that will be tracked weekly and reported at each governance cadence.',
        owner: 'CSM',
      },
      60: {
        title: 'Run a structured enablement programme',
        detail:
          'Deliver hands-on, role-based training sessions for the 3 identified teams. Use the probe and experiment templates created in the operationalization track (chaos_not_operationalized) rather than starting from scratch. ' +
          'Set a sprint-based target: at least one experiment per team per two-week sprint. ' +
          'Measure and report the experiment run rate weekly — make the number visible to the team as a shared goal. ' +
          'Celebrate and socialise each team\'s first successful experiment run internally (Slack, newsletter, all-hands) to create internal momentum and peer pressure for remaining teams.',
        owner: 'CSM + Enablement + Solutions Engineer',
      },
      90: {
        title: 'Produce and present a Value Realization & ROI Report',
        detail:
          'Quantify the delta from baseline to current state: ' +
          'Δ experiment run rate (monthly), Δ teams onboarded (% of licensed seats), Δ services covered, incidents caught by experiments before they reached production, MTTR improvement. ' +
          'Package as an executive-ready ROI report with visual charts — use this as the centrepiece of the EBR and the renewal business case. ' +
          'If a quantified ROI cannot be made yet (too early), use case studies from comparable customers as proxies and project the expected ROI trajectory.',
        owner: 'CSM',
      },
    },
  },
];

function detectPatterns(risks: Assessment[]): DetectedPattern[] {
  const result: DetectedPattern[] = [];
  for (const def of PATTERN_DEFS) {
    const matched = risks.filter((r) => def.testRisk(r.question));
    if (matched.length >= def.minMatches) {
      result.push({ def, matchedRisks: matched.map((r) => r.question) });
    }
  }
  // Critical before High before Medium — the most urgent work leads each plan phase.
  const order: Record<PlanAction['priority'], number> = { Critical: 0, High: 1, Medium: 2 };
  result.sort((a, b) => order[a.def.severity] - order[b.def.severity]);
  return result;
}

// ---------------------------------------------------------------------------
// Play library – for each pillar, the remediation play by horizon.
// ---------------------------------------------------------------------------

interface PlayTemplate {
  title: string;
  detail: string;
  owner: string;
  priority: PlanAction['priority'];
  horizon: 30 | 60 | 90;
}

/** Per-pillar computed health, used to drive the dynamic plan. */
interface PillarHealth {
  pillar: Pillar;
  yes: number;
  no: number;
  total: number;
  score: number; // 0..100 (% ticked)
  gaps: Assessment[]; // the specific unticked items
  wins: Assessment[]; // the specific ticked items
}

const PLAYBOOK: Record<Pillar, PlayTemplate[]> = {
  Relationship: [
    {
      horizon: 30,
      title: 'Re-establish executive alignment',
      detail:
        'Secure a 30-minute executive sponsor meeting to acknowledge the current state, reset expectations, and co-own a recovery plan. Identify and map all decision makers, blockers, and a mobilized internal champion.',
      owner: 'CSM + Account Executive',
      priority: 'Critical',
    },
    {
      horizon: 60,
      title: 'Establish a recurring governance cadence',
      detail:
        'Stand up a bi-weekly working session with the champion and a monthly steering check-in with the sponsor to review progress against the joint success plan.',
      owner: 'CSM',
      priority: 'High',
    },
    {
      horizon: 90,
      title: 'Run a formal Executive Business Review (EBR)',
      detail:
        'Deliver an EBR that quantifies value delivered, reaffirms the shared roadmap, and multi-threads into 2–3 new stakeholders to reduce single-champion risk.',
      owner: 'CSM + Account Executive',
      priority: 'High',
    },
  ],
  Value: [
    {
      horizon: 30,
      title: 'Define the value gap & success criteria',
      detail:
        'Facilitate a value-mapping workshop to (re)document the customer’s desired business outcomes and the 3–5 measurable KPIs that define success. Baseline current-state metrics.',
      owner: 'CSM',
      priority: 'Critical',
    },
    {
      horizon: 60,
      title: 'Deliver a first measurable win',
      detail:
        'Ship one quantifiable outcome tied to a top KPI and package it into a value snapshot the champion can circulate internally.',
      owner: 'CSM + Solutions',
      priority: 'High',
    },
    {
      horizon: 90,
      title: 'Publish an ROI / value-realization report',
      detail:
        'Produce a data-backed ROI report showing progress against baseline; use it to justify renewal and expansion conversations.',
      owner: 'CSM',
      priority: 'High',
    },
  ],
  Adoption: [
    {
      horizon: 30,
      title: 'Diagnose the adoption blockers',
      detail:
        'Pull product usage data, identify inactive users/teams, and interview 2–3 end users to surface friction. Produce a prioritized adoption gap list.',
      owner: 'CSM + CS Ops',
      priority: 'Critical',
    },
    {
      horizon: 60,
      title: 'Run targeted enablement & re-onboarding',
      detail:
        'Deliver role-based training and an enablement plan for the highest-value, lowest-adoption workflows. Set weekly active-usage targets.',
      owner: 'CSM + Enablement',
      priority: 'High',
    },
    {
      horizon: 90,
      title: 'Drive sustained, self-sufficient adoption',
      detail:
        'Establish internal champions/power users, embed the product in a core recurring workflow, and hand off a lightweight adoption dashboard the customer owns.',
      owner: 'CSM',
      priority: 'Medium',
    },
  ],
  Sentiment: [
    {
      horizon: 30,
      title: 'Rebuild trust & capture sentiment baseline',
      detail:
        'Run a candid “state of the relationship” conversation, log every open complaint, and issue a written recovery commitment with owners and dates.',
      owner: 'CSM',
      priority: 'Critical',
    },
    {
      horizon: 60,
      title: 'Close the loop on top detractor issues',
      detail:
        'Resolve or provide a credible plan for the top sentiment drivers and communicate proactively. Re-measure CSAT to confirm the trend is improving.',
      owner: 'CSM + Support',
      priority: 'High',
    },
    {
      horizon: 90,
      title: 'Convert sentiment into advocacy',
      detail:
        'With sentiment recovered, invite the customer into a reference/advisory motion and capture a testimonial or case study.',
      owner: 'CSM + Marketing',
      priority: 'Medium',
    },
  ],
  Support: [
    {
      horizon: 30,
      title: 'Triage & stabilize open issues',
      detail:
        'Audit all open tickets/escalations, assign severities, and drive a war-room on any P1/blocking issue. Give the customer a single point of contact.',
      owner: 'CSM + Support Lead',
      priority: 'Critical',
    },
    {
      horizon: 60,
      title: 'Fix root causes & set SLA expectations',
      detail:
        'Partner with Product/Support to resolve recurring root causes and agree a clear response/resolution SLA framework with the customer.',
      owner: 'Support + Product',
      priority: 'High',
    },
    {
      horizon: 90,
      title: 'Institutionalize proactive support',
      detail:
        'Implement proactive monitoring/health alerts and a monthly technical review so issues are caught before they escalate.',
      owner: 'Support + CSM',
      priority: 'Medium',
    },
  ],
  Commercial: [
    {
      horizon: 30,
      title: 'De-risk the commercial relationship',
      detail:
        'Confirm renewal date, contract terms, and any at-risk revenue. Flag churn risk to leadership and align AE + CSM on a save strategy.',
      owner: 'Account Executive + CSM',
      priority: 'Critical',
    },
    {
      horizon: 60,
      title: 'Rebuild the commercial value narrative',
      detail:
        'Tie recovered value to the renewal case and remove procurement/billing friction. Draft the renewal proposal early to avoid a last-minute scramble.',
      owner: 'Account Executive',
      priority: 'High',
    },
    {
      horizon: 90,
      title: 'Secure renewal & seed expansion',
      detail:
        'Close the renewal and, where health supports it, introduce a right-sized expansion aligned to newly demonstrated outcomes.',
      owner: 'Account Executive + CSM',
      priority: 'High',
    },
  ],
};

/**
 * "Protect & grow" plays used when a pillar is strong (all/most boxes ticked).
 * These keep the plan honest: we don't invent problems where the data shows none.
 */
const PROTECT_PLAYBOOK: Record<Pillar, Record<30 | 60 | 90, string>> = {
  Relationship: {
    30: 'Relationship signals are healthy. Confirm the sponsor and champion are still in seat and document the current stakeholder map so it stays current.',
    60: 'Keep the relationship warm: maintain the existing cadence and use the goodwill to multi-thread into one additional stakeholder.',
    90: 'Leverage the strong relationship to run a forward-looking EBR focused on the next strategic goal rather than remediation.',
  },
  Value: {
    30: 'Value is being tracked well. Re-confirm the success KPIs are still the right ones and refresh the current-state numbers.',
    60: 'Package the value already being delivered into a crisp snapshot the champion can share upward.',
    90: 'Publish a proactive ROI report and use it to open an expansion or renewal-uplift conversation.',
  },
  Adoption: {
    30: 'Adoption is solid. Confirm no recent drop in active usage and identify the next high-value workflow to activate.',
    60: 'Deepen adoption by enabling one additional team or advanced workflow while usage momentum is strong.',
    90: 'Formalize internal champions/power users so adoption stays self-sustaining without heavy CSM involvement.',
  },
  Sentiment: {
    30: 'Sentiment is positive. Capture a fresh CSAT/NPS reading to lock in the baseline while it is strong.',
    60: 'Nurture the goodwill and proactively ask for structured feedback to catch any early drift.',
    90: 'Convert the positive sentiment into advocacy: pursue a reference, testimonial, or case study.',
  },
  Support: {
    30: 'Support health is good. Verify there are no lurking P2/P3 issues and that SLAs remain comfortably met.',
    60: 'Introduce lightweight proactive monitoring so any regression is caught before the customer feels it.',
    90: 'Institutionalize a periodic technical review to keep the support experience durable.',
  },
  Commercial: {
    30: 'Commercials are in good shape. Confirm the renewal date/terms and that there is no procurement or billing friction on the horizon.',
    60: 'With a stable base, begin shaping the renewal narrative early and scan for a right-sized expansion.',
    90: 'Secure the renewal ahead of time and progress the identified expansion opportunity.',
  },
};

/** Human label for each pillar. */
const PILLAR_LABEL: Record<Pillar, string> = {
  Relationship: 'Relationship & Sponsorship',
  Value: 'Value & ROI',
  Adoption: 'Adoption & Enablement',
  Sentiment: 'Sentiment & Satisfaction',
  Support: 'Support & Product',
  Commercial: 'Commercial & Renewal',
};

/**
 * Severity of a pillar based on how many boxes are unticked.
 * Drives priority so the SAME pillar can be Critical for one account and
 * Medium for another depending on the actual checkboxes.
 */
function severityPriority(score: number): PlanAction['priority'] {
  if (score < 40) return 'Critical';
  if (score < 70) return 'High';
  return 'Medium';
}

// ---------------------------------------------------------------------------
// Plan assembly
// ---------------------------------------------------------------------------

const PHASE_META: Record<
  30 | 60 | 90,
  { label: string; target: HealthStatus; objective: string }
> = {
  30: {
    label: 'Days 0–30 · Stabilize & Diagnose',
    target: 'Yellow',
    objective:
      'Stop the bleeding. Re-establish trust and executive alignment, triage the most acute risks, and build a shared, fact-based picture of the account.',
  },
  60: {
    label: 'Days 31–60 · Build Momentum',
    target: 'Yellow',
    objective:
      'Turn the corner. Deliver visible early wins against the customer’s top outcomes and resolve the root causes behind the biggest gaps.',
  },
  90: {
    label: 'Days 61–90 · Realize & Institutionalize Value',
    target: 'Green',
    objective:
      'Make recovery durable. Prove ROI, secure the commercial relationship, and hand the customer sustainable habits that keep the account healthy.',
  },
};

/**
 * Build a horizon's actions dynamically from the actual per-pillar health.
 *
 * - Pillars WITH gaps get a remediation play whose priority scales with how
 *   many boxes are unticked, and whose detail cites the specific unticked items.
 * - Pillars that are fully/mostly ticked get a lighter "protect & grow" play.
 * - Pillars are ordered worst-first so the most critical work leads.
 * - Nothing is force-added: if a pillar isn't in the data, it isn't in the plan.
 */
/**
 * Split a pillar's gaps across the three horizons so that EVERY identified risk
 * is addressed somewhere in the plan (not just the first few). The most severe
 * pillars front-load more risks into the 0-30 day horizon.
 */
function gapsForHorizon(
  gaps: Assessment[],
  horizon: 30 | 60 | 90,
  score: number
): Assessment[] {
  if (gaps.length === 0) return [];

  // Critical/weak pillars tackle more up front; healthier pillars spread evenly.
  const weights =
    score < 40 ? [0.5, 0.3, 0.2] : score < 70 ? [0.4, 0.35, 0.25] : [0.34, 0.33, 0.33];

  const n = gaps.length;
  const c30 = Math.max(1, Math.round(n * weights[0]));
  const c60 = Math.max(0, Math.round(n * weights[1]));
  const i30 = Math.min(c30, n);
  const i60 = Math.min(i30 + c60, n);

  if (horizon === 30) return gaps.slice(0, i30);
  if (horizon === 60) return gaps.slice(i30, i60);
  return gaps.slice(i60); // 90 sweeps up everything remaining
}

function buildPhase(
  horizon: 30 | 60 | 90,
  pillarHealth: PillarHealth[],
  status: HealthStatus,
  patterns: DetectedPattern[]
): PlanPhase {
  const meta = PHASE_META[horizon];
  const actions: PlanAction[] = [];

  // Track which risk questions are owned by a pattern play so the pillar
  // fallback does not double-address them.
  const coveredByPattern = new Set<string>();

  // Step 1: Pattern-driven plays (consultant-grade, correlated, Critical-first).
  for (const p of patterns) {
    const play = p.def.plays[horizon];
    p.matchedRisks.forEach((r) => coveredByPattern.add(r));

    const riskSummary =
      p.matchedRisks.length <= 3
        ? p.matchedRisks.join('; ')
        : `${p.matchedRisks.slice(0, 3).join('; ')} (+${p.matchedRisks.length - 3} more)`;

    actions.push({
      title: play.title,
      detail:
        `${play.detail}\n\n` +
        `Correlated risks addressed by this pattern (${p.matchedRisks.length}): ${riskSummary}.`,
      owner: play.owner,
      priority: p.def.severity,
      addresses: p.matchedRisks.join('; '),
      patternId: p.def.id,
      patternName: p.def.name,
    });
  }

  // Step 2: Pillar fallback for any risks NOT covered by a pattern.
  const ordered = [...pillarHealth].sort((a, b) => a.score - b.score);
  const hasPatterns = patterns.length > 0;

  for (const ph of ordered) {
    const uncoveredGaps = ph.gaps.filter((g) => !coveredByPattern.has(g.question));

    if (uncoveredGaps.length > 0) {
      const template = PLAYBOOK[ph.pillar].find((p) => p.horizon === horizon);
      if (!template) continue;

      const priority = severityPriority(ph.score);
      const horizonGaps = gapsForHorizon(uncoveredGaps, horizon, ph.score);
      const cited = horizonGaps.map((g) => g.question);
      if (cited.length === 0) continue;

      const severityNote =
        ph.score < 40
          ? `This is a critical gap area \u2014 ${ph.no} of ${ph.total} checks are unmet.`
          : ph.score < 70
          ? `A partial gap \u2014 ${ph.no} of ${ph.total} checks are unmet.`
          : `A minor gap \u2014 ${ph.no} of ${ph.total} checks are unmet.`;

      const focus = horizon === 30 && cited.length ? ` Start with: ${cited[0]}.` : '';
      const coverage = ` This horizon addresses ${cited.length} identified risk(s) in this area.`;

      actions.push({
        title: template.title,
        detail: `${template.detail} ${severityNote}${focus}${coverage}`,
        owner: template.owner,
        priority,
        addresses: cited.join('; '),
      });
    } else if (!hasPatterns && ph.total > 0 && ph.no === 0) {
      // "Protect & grow" only when no patterns are active.
      actions.push({
        title: `Protect & grow: ${PILLAR_LABEL[ph.pillar]}`,
        detail: `${PROTECT_PLAYBOOK[ph.pillar][horizon]} (All ${ph.total} checks in this area are met.)`,
        owner: PLAYBOOK[ph.pillar].find((p) => p.horizon === horizon)?.owner || 'CSM',
        priority: 'Medium',
        addresses: ph.wins.slice(0, 3).map((w) => w.question).join('; ') || undefined,
      });
    }
  }

  // Absolute fallback (no pillars in data at all).
  if (actions.length === 0) {
    actions.push({
      title:
        horizon === 90
          ? 'Sustain momentum and plan the next value chapter'
          : 'Reinforce what is working',
      detail:
        "The assessment did not surface specific gaps for this horizon. Maintain the current cadence, document what is working, and reinvest freed-up capacity into the customer's next strategic goal.",
      owner: 'CSM',
      priority: 'Medium',
    });
  }

  return {
    horizon,
    label: meta.label,
    targetStatus: dynamicTarget(horizon, status),
    objective: dynamicObjective(horizon, status, ordered, patterns),
    actions,
    successMetrics: metricsFor(horizon, ordered, patterns),
    exitCriteria: exitFor(horizon, status),
  };
}

/** Target status per horizon adapts to where the account starts. */
function dynamicTarget(horizon: 30 | 60 | 90, status: HealthStatus): HealthStatus {
  if (status === 'Green') return 'Green'; // already green: stay green
  if (status === 'Red') {
    // Red needs the full climb: Red -> (stabilize) -> Yellow -> Green.
    if (horizon === 30) return 'Red'; // realistic: still stabilizing at day 30
    if (horizon === 60) return 'Yellow';
    return 'Green';
  }
  // Yellow: closer, so reach Yellow-solid then Green.
  if (horizon === 30) return 'Yellow';
  if (horizon === 60) return 'Yellow';
  return 'Green';
}

/** Objective text that adapts to status and names the weakest areas. */
/** Objective text — pattern-aware and named by the weakest areas. */
function dynamicObjective(
  horizon: 30 | 60 | 90,
  status: HealthStatus,
  ordered: PillarHealth[],
  patterns: DetectedPattern[]
): string {
  const weakest = ordered
    .filter((p) => p.no > 0)
    .slice(0, 2)
    .map((p) => PILLAR_LABEL[p.pillar]);

  if (weakest.length === 0 && patterns.length === 0) {
    const greenBase: Record<30 | 60 | 90, string> = {
      30: 'Protect the strong position. Re-confirm the signals that make this account healthy and capture a fresh baseline while everything is green.',
      60: 'Grow from strength. Deepen adoption and value where the account is already succeeding, and open the next strategic conversation.',
      90: 'Compound the value. Turn sustained health into advocacy, renewal certainty, and a right-sized expansion.',
    };
    return greenBase[horizon];
  }

  const base = PHASE_META[horizon].objective;

  // If patterns detected, name the patterns as the focus areas — more specific.
  if (patterns.length > 0) {
    const criticals = patterns.filter((p) => p.def.severity === 'Critical').map((p) => p.def.name);
    const highs = patterns.filter((p) => p.def.severity === 'High').map((p) => p.def.name);
    const named = [...criticals, ...highs].slice(0, 2);
    const focusArea =
      horizon === 30
        ? `Immediate focus: resolve ${named.join(' and ')}.`
        : horizon === 60
        ? `Continue pressing on ${named.join(' and ')}.`
        : `Lock in durable gains — close out ${named.join(' and ')} and secure the renewal.`;
    return `${base} ${focusArea}`;
  }

  const focusArea =
    horizon === 30
      ? `Immediate focus: ${weakest.join(' and ')}.`
      : horizon === 60
      ? `Continue pressing on ${weakest.join(' and ')}.`
      : `Lock in durable gains across ${weakest.join(' and ')}.`;
  return `${base} ${focusArea}`;
}

/**
 * Success metrics adapt to the pillars that are actually weak, so two different
 * uploads produce different, relevant metrics.
 */
/**
 * Success metrics — augmented with pattern-specific milestones so the
 * metrics for a chaos-heavy account differ from a relationship-heavy one.
 */
function metricsFor(horizon: 30 | 60 | 90, ordered: PillarHealth[], patterns: DetectedPattern[]): string[] {
  const weak = new Set(ordered.filter((p) => p.no > 0).map((p) => p.pillar));
  const metrics: string[] = [];

  if (horizon === 30) {
    if (weak.has('Relationship')) metrics.push('Executive sponsor meeting held and joint recovery plan signed off');
    if (weak.has('Support')) metrics.push('All P1/critical issues have owners and target dates');
    if (weak.has('Value')) metrics.push('Baseline metrics captured for the top success KPIs');
    if (weak.has('Adoption')) metrics.push('Adoption gap list produced from actual usage data');
    if (weak.has('Sentiment')) metrics.push('Every open complaint logged with a recovery owner');
    if (weak.has('Commercial')) metrics.push('Renewal date/terms confirmed and churn risk flagged to leadership');
  } else if (horizon === 60) {
    if (weak.has('Value')) metrics.push('At least one measurable customer win delivered and socialized');
    if (weak.has('Adoption')) metrics.push('Active usage trending up vs. the day-30 baseline');
    if (weak.has('Sentiment')) metrics.push('CSAT / sentiment measurably improved vs. baseline');
    if (weak.has('Support')) metrics.push('Recurring root causes resolved and SLA framework agreed');
    if (weak.has('Relationship')) metrics.push('Recurring governance cadence running with champion + sponsor');
    if (weak.has('Commercial')) metrics.push('Renewal narrative drafted and billing friction removed');
  } else {
    if (weak.has('Value')) metrics.push('ROI / value-realization report delivered to the sponsor');
    if (weak.has('Commercial')) metrics.push('Renewal path confirmed (and expansion identified where healthy)');
    if (weak.has('Adoption')) metrics.push('Customer owns a sustainable adoption cadence');
    if (weak.has('Relationship')) metrics.push('EBR delivered and multi-threaded into new stakeholders');
    if (weak.has('Sentiment')) metrics.push('Sentiment converted into a reference or case study');
    if (weak.has('Support')) metrics.push('Proactive monitoring and periodic technical review in place');
  }

  // Pattern-specific metrics (prepend — they are the most actionable).
  const patternIds = new Set(patterns.map((p) => p.def.id));
  const patternMetrics: string[] = [];
  if (horizon === 30) {
    if (patternIds.has('leadership_vacuum')) patternMetrics.push('New sponsor and champion identified; executive alignment meeting scheduled');
    if (patternIds.has('deployment_blocker')) patternMetrics.push('Every deployment blocker documented with owner, resolution criteria, and target date');
    if (patternIds.has('chaos_not_operationalized')) patternMetrics.push('Operationalization gap audit complete; pilot service selected for first pipeline experiment');
    if (patternIds.has('value_realization_gap')) patternMetrics.push('Baseline metrics captured: experiment run rate, teams onboarded, MTTR');
  } else if (horizon === 60) {
    if (patternIds.has('leadership_vacuum')) patternMetrics.push('Bi-weekly champion cadence running; monthly sponsor review established');
    if (patternIds.has('deployment_blocker')) patternMetrics.push('Product fully operational in customer environment; joint smoke test passed');
    if (patternIds.has('chaos_not_operationalized')) patternMetrics.push('First pipeline-integrated chaos experiment shipped and running autonomously');
    if (patternIds.has('value_realization_gap')) patternMetrics.push('Monthly experiment run rate trending upward vs. day-30 baseline');
  } else {
    if (patternIds.has('leadership_vacuum')) patternMetrics.push('EBR delivered; renewal intent secured from sponsor');
    if (patternIds.has('deployment_blocker')) patternMetrics.push('Deployment runbook handed to customer; no open blockers');
    if (patternIds.has('chaos_not_operationalized')) patternMetrics.push('3-5 services instrumented; Chaos CoE playbook delivered to customer team');
    if (patternIds.has('value_realization_gap')) patternMetrics.push('ROI report delivered: quantified experiment run rate, incidents caught, MTTR improvement');
  }

  const combined = [...patternMetrics, ...metrics];

  // Fallback for strong accounts / horizons with no weak pillar or pattern match.
  if (combined.length === 0) {
    if (horizon === 30) combined.push('Current strengths re-confirmed and baselined');
    else if (horizon === 60) combined.push('Momentum sustained; next strategic goal identified with the customer');
    else combined.push('Account re-scored and confirmed healthy; growth path agreed');
  }
  return combined.slice(0, 5);
}

/** Exit criteria adapt to the account's starting status. */
function exitFor(horizon: 30 | 60 | 90, status: HealthStatus): string[] {
  if (horizon === 30) {
    if (status === 'Red')
      return [
        'Account no longer trending toward churn; acute risk is contained',
        'Sponsor/champion re-engaged and joint recovery plan is in motion',
      ];
    if (status === 'Yellow')
      return [
        'Open risks have named owners and target dates',
        'Momentum plan agreed with the customer',
      ];
    return [
      'Strengths re-confirmed with a fresh baseline',
      'Next strategic goal identified with the customer',
    ];
  }
  if (horizon === 60)
    return [
      'Health signals (usage, sentiment, open issues) moving in the right direction',
      status === 'Green' ? 'At least one growth conversation opened' : 'Customer can articulate at least one concrete win',
    ];
  return [
    status === 'Green'
      ? 'Account remains Green on re-scoring; expansion path agreed'
      : 'Account health assessed as Green on re-scoring',
    'Value is quantified, documented, and tied to the renewal',
  ];
}

// ---------------------------------------------------------------------------
// Executive summary
// ---------------------------------------------------------------------------

/**
 * Consultant-grade executive summary.
 *
 * When patterns are detected the summary names them and explains how they
 * compound each other, giving the reader an insight into the underlying
 * dynamics rather than a list of bullet points. Account details (ARR,
 * renewal date, product) are woven in so the summary reads as specific
 * to THIS customer, not a generic template.
 */
/**
 * Returns a newline-separated list of crisp, consultant-quality bullet points.
 * Account details (name, ARR, region, renewal) are deliberately omitted here —
 * they are already displayed in the Account Details card above this section.
 * The summary focuses purely on the "why": health signal, risk count, patterns,
 * compounding dynamics, and what the plan will do about it.
 */
function buildExecutiveSummary(
  status: HealthStatus,
  score: number,
  topRisks: Assessment[],
  strengths: Assessment[],
  patterns: DetectedPattern[],
  accountDetails?: AnalysisResult['accountDetails']
): string {
  const get = (label: string) => accountDetails?.find((d) => d.label === label)?.value;
  const renewal = get('Renewal Date');

  const bullets: string[] = [];

  // Line 1 — health signal
  const statusVerb =
    status === 'Red'
      ? `Health score is ${score}/100 — account is RED and requires immediate, senior-led intervention to prevent churn`
      : status === 'Yellow'
      ? `Health score is ${score}/100 — account is YELLOW and at risk without a focused, time-bound recovery plan`
      : `Health score is ${score}/100 — account is GREEN`;
  bullets.push(statusVerb);

  // Line 2 — renewal urgency (only if not already obvious from Account Details)
  if (renewal && status !== 'Green') {
    bullets.push(`Renewal is due ${renewal} — the window to demonstrate value and secure commitment is time-limited`);
  }

  // Line 3 — risk count
  const tabCount = [...new Set(topRisks.map((r) => r.tab))].length;
  if (topRisks.length > 0) {
    bullets.push(
      `${topRisks.length} risks identified across ${tabCount} assessment area${tabCount > 1 ? 's' : ''}; ` +
      `${strengths.length} strengths confirmed that can anchor the recovery`
    );
  }

  if (patterns.length === 0) {
    // No patterns — name the top risks directly
    if (topRisks.length > 0) {
      bullets.push(`Key gaps: ${topRisks.slice(0, 3).map((r) => r.question).join('; ')}`);
    }
    bullets.push('This 30-60-90 plan: stabilize & re-align (day 30) → build early wins (day 60) → prove value & secure renewal (day 90)');
    return bullets.join('\n');
  }

  // Line 4 — pattern summary
  const criticals = patterns.filter((p) => p.def.severity === 'Critical');
  const highs = patterns.filter((p) => p.def.severity === 'High');

  const patternSummary = [
    criticals.length > 0
      ? `${criticals.length} Critical: ${criticals.map((p) => p.def.name).join(', ')}`
      : '',
    highs.length > 0
      ? `${highs.length} High: ${highs.map((p) => p.def.name).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  bullets.push(`${patterns.length} correlated risk pattern${patterns.length > 1 ? 's' : ''} detected — ${patternSummary}`);

  // Line 5 — compounding note (only when ≥2 Criticals)
  if (criticals.length >= 2) {
    bullets.push(
      `These patterns are compounding: without executive alignment, deployment blockers cannot be escalated; ` +
      `without deployment, no value can be demonstrated; without a value story, the renewal fails`
    );
  } else if (criticals.length === 1 && highs.length >= 1) {
    bullets.push(
      `"${criticals[0].def.name}" is the root blocker — resolving it first unlocks progress on all High-severity patterns`
    );
  }

  // Line 6 — plan sequence
  const planSeq =
    status === 'Red'
      ? 'Plan: unblock deployment & restore exec trust (day 30) → first chaos experiment & enablement wins (day 60) → ROI report & renewal business case (day 90)'
      : 'Plan: address critical gaps (day 30) → build momentum (day 60) → institutionalise value & secure renewal (day 90)';
  bullets.push(planSeq);

  return bullets.join('\n');
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function buildAnalysis(
  fileName: string,
  items: Assessment[],
  warnings: string[] = [],
  chaosMetrics?: AnalysisResult['chaosMetrics'],
  accountDetails?: AnalysisResult['accountDetails']
): AnalysisResult {
  const tabs = summarizeTabs(items);

  // Overall health is computed on the normalized signal (isRisk), so ticked
  // risk-flag questions correctly reduce the score instead of raising it.
  const total = items.length;
  const healthy = items.filter((i) => !i.isRisk).length;
  const problems = total - healthy;
  const score = total > 0 ? Math.round((healthy / total) * 100) : 0;
  const status = statusFromScore(score);

  // Risks = anything flagged as a problem (unmet positive OR ticked negative).
  // Strengths = healthy items.
  const topRisks = items.filter((i) => i.isRisk);
  const strengths = items.filter((i) => !i.isRisk);

  // Compute per-pillar health directly from the ticked/unticked checkboxes.
  // This is what makes the plan dynamic: the plays, priorities, ordering,
  // objectives, metrics and exit criteria all derive from these numbers.
  const pillarMap = new Map<Pillar, PillarHealth>();
  for (const item of items) {
    const pillar = classify(item.question);
    if (!pillarMap.has(pillar)) {
      pillarMap.set(pillar, {
        pillar,
        yes: 0,
        no: 0,
        total: 0,
        score: 0,
        gaps: [],
        wins: [],
      });
    }
    const ph = pillarMap.get(pillar)!;
    ph.total += 1;
    // Use the normalized health signal, not the raw answer, so a ticked risk
    // flag lands in gaps (problems) and an unticked risk flag is a win.
    if (!item.isRisk) {
      ph.yes += 1;
      ph.wins.push(item);
    } else {
      ph.no += 1;
      ph.gaps.push(item);
    }
  }
  const pillarHealth = Array.from(pillarMap.values()).map((ph) => ({
    ...ph,
    score: ph.total > 0 ? Math.round((ph.yes / ph.total) * 100) : 0,
  }));

  // Detect correlated risk patterns before building the plan.
  // Patterns drive the primary plays; pillar plays serve as fallback.
  const detectedPatterns = detectPatterns(topRisks);

  const plan: PlanPhase[] = [
    buildPhase(30, pillarHealth, status, detectedPatterns),
    buildPhase(60, pillarHealth, status, detectedPatterns),
    buildPhase(90, pillarHealth, status, detectedPatterns),
  ];

  // Safety net: guarantee EVERY identified risk is addressed somewhere in the
  // plan. Pattern plays already cover matched risks; this catches any stragglers.
  const citedRisks = new Set<string>();
  for (const phase of plan) {
    for (const action of phase.actions) {
      if (action.addresses) {
        action.addresses.split(';').forEach((r) => citedRisks.add(r.trim()));
      }
    }
  }
  const uncovered = topRisks
    .map((r) => r.question)
    .filter((q) => !citedRisks.has(q.trim()));
  if (uncovered.length > 0) {
    const day90 = plan.find((p) => p.horizon === 90);
    if (day90) {
      day90.actions.push({
        title: 'Close out remaining identified risks',
        detail:
          'Ensure no identified risk is left unaddressed. Drive each remaining ' +
          `risk to resolution or an owned mitigation plan. Remaining risks (${uncovered.length}): ` +
          `${uncovered.join('; ')}.`,
        owner: 'CSM',
        priority: 'High',
        addresses: uncovered.join('; '),
      });
    }
  }

  // Convert internal DetectedPattern to the exported RiskPattern type.
  const riskPatterns: RiskPattern[] = detectedPatterns.map((p) => ({
    id: p.def.id,
    name: p.def.name,
    severity: p.def.severity,
    description: p.def.description,
    rootCause: p.def.rootCause,
    implication: p.def.implication,
    matchedRisks: p.matchedRisks,
  }));

  return {
    fileName,
    generatedAt: new Date().toISOString(),
    overall: { total, yes: healthy, no: problems, score, status },
    tabs,
    topRisks,
    strengths,
    plan,
    executiveSummary: buildExecutiveSummary(status, score, topRisks, strengths, detectedPatterns, accountDetails),
    warnings: warnings.length ? warnings : undefined,
    chaosMetrics,
    accountDetails: accountDetails && accountDetails.length ? accountDetails : undefined,
    riskPatterns: riskPatterns.length ? riskPatterns : undefined,
  };
}
