import {
  Assessment,
  AnalysisResult,
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
function buildPhase(
  horizon: 30 | 60 | 90,
  pillarHealth: PillarHealth[],
  status: HealthStatus
): PlanPhase {
  const meta = PHASE_META[horizon];
  const actions: PlanAction[] = [];

  // Worst pillars first (lowest score), so Critical work leads each phase.
  const ordered = [...pillarHealth].sort((a, b) => a.score - b.score);

  for (const ph of ordered) {
    const isWeak = ph.no > 0;

    if (isWeak) {
      const template = PLAYBOOK[ph.pillar].find((p) => p.horizon === horizon);
      if (!template) continue;

      // Priority scales with severity of THIS pillar for THIS account.
      const priority = severityPriority(ph.score);

      // Cite the specific unticked items so the play reflects the sheet.
      const cited = ph.gaps.slice(0, 3).map((g) => g.question);
      const addresses = cited.length > 0 ? cited.join('; ') : undefined;

      // Dynamically enrich the detail with the pillar's severity + specifics.
      const severityNote =
        ph.score < 40
          ? `This is a critical gap area — ${ph.no} of ${ph.total} checks are unmet.`
          : ph.score < 70
          ? `A partial gap — ${ph.no} of ${ph.total} checks are unmet.`
          : `A minor gap — ${ph.no} of ${ph.total} checks are unmet.`;

      const focus =
        horizon === 30 && cited.length
          ? ` Start with: ${cited[0]}.`
          : '';

      actions.push({
        title: template.title,
        detail: `${template.detail} ${severityNote}${focus}`,
        owner: template.owner,
        priority,
        addresses,
      });
    } else if (ph.total > 0) {
      // Strong pillar: protect & grow rather than fabricate a problem.
      actions.push({
        title: `Protect & grow: ${PILLAR_LABEL[ph.pillar]}`,
        detail: `${PROTECT_PLAYBOOK[ph.pillar][horizon]} (All ${ph.total} checks in this area are met.)`,
        owner: PLAYBOOK[ph.pillar].find((p) => p.horizon === horizon)?.owner || 'CSM',
        priority: 'Medium',
        addresses: ph.wins.slice(0, 3).map((w) => w.question).join('; ') || undefined,
      });
    }
  }

  // Absolute fallback (e.g. no recognizable pillars at all).
  if (actions.length === 0) {
    actions.push({
      title:
        horizon === 90
          ? 'Sustain momentum and plan the next value chapter'
          : 'Reinforce what is working',
      detail:
        'The assessment did not surface specific gaps for this horizon. Maintain the current cadence, document what is working, and reinvest freed-up capacity into the customer’s next strategic goal.',
      owner: 'CSM',
      priority: 'Medium',
    });
  }

  return {
    horizon,
    label: meta.label,
    targetStatus: dynamicTarget(horizon, status),
    objective: dynamicObjective(horizon, status, ordered),
    actions,
    successMetrics: metricsFor(horizon, ordered),
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
function dynamicObjective(
  horizon: 30 | 60 | 90,
  status: HealthStatus,
  ordered: PillarHealth[]
): string {
  const weakest = ordered
    .filter((p) => p.no > 0)
    .slice(0, 2)
    .map((p) => PILLAR_LABEL[p.pillar]);

  // Healthy account: protect-and-grow language, never "stop the bleeding".
  if (weakest.length === 0) {
    const greenBase: Record<30 | 60 | 90, string> = {
      30: 'Protect the strong position. Re-confirm the signals that make this account healthy and capture a fresh baseline while everything is green.',
      60: 'Grow from strength. Deepen adoption and value where the account is already succeeding, and open the next strategic conversation.',
      90: 'Compound the value. Turn sustained health into advocacy, renewal certainty, and a right-sized expansion.',
    };
    return greenBase[horizon];
  }

  // There are real gaps: use recovery language scaled to how bad it is.
  const base = PHASE_META[horizon].objective;
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
function metricsFor(horizon: 30 | 60 | 90, ordered: PillarHealth[]): string[] {
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

  // Fallback for strong accounts / horizons with no weak pillar match.
  if (metrics.length === 0) {
    if (horizon === 30) metrics.push('Current strengths re-confirmed and baselined');
    else if (horizon === 60) metrics.push('Momentum sustained; next strategic goal identified with the customer');
    else metrics.push('Account re-scored and confirmed healthy; growth path agreed');
  }
  return metrics.slice(0, 4);
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

function buildExecutiveSummary(
  status: HealthStatus,
  score: number,
  topRisks: Assessment[],
  strengths: Assessment[]
): string {
  const riskList =
    topRisks.length > 0
      ? topRisks.slice(0, 3).map((r) => `“${r.question}”`).join(', ')
      : 'no material gaps';
  const strengthList =
    strengths.length > 0
      ? strengths.slice(0, 2).map((s) => `“${s.question}”`).join(', ')
      : 'a solid foundation';

  const trajectory =
    status === 'Red'
      ? 'The account is currently RED and requires immediate, senior-led intervention to avoid churn.'
      : status === 'Yellow'
      ? 'The account is YELLOW — recoverable, but at risk without a focused, time-bound plan.'
      : 'The account is GREEN — the priority is to protect and grow the relationship.';

  return `${trajectory} Overall health scored ${score}/100 based on the uploaded assessment. The most pressing risks are ${riskList}. We will leverage existing strengths (${strengthList}) as anchors for recovery. This 30-60-90 plan sequences the work to move the account from ${status} → Yellow → Green: stabilize and re-align in the first 30 days, build demonstrable momentum by day 60, and prove durable value to secure the relationship by day 90.`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function buildAnalysis(
  fileName: string,
  items: Assessment[]
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

  const plan: PlanPhase[] = [
    buildPhase(30, pillarHealth, status),
    buildPhase(60, pillarHealth, status),
    buildPhase(90, pillarHealth, status),
  ];

  return {
    fileName,
    generatedAt: new Date().toISOString(),
    overall: { total, yes: healthy, no: problems, score, status },
    tabs,
    topRisks,
    strengths,
    plan,
    executiveSummary: buildExecutiveSummary(status, score, topRisks, strengths),
  };
}
