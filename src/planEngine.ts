import {
  Assessment,
  AnalysisResult,
  TabSummary,
  HealthStatus,
  PlanPhase,
  PlanAction,
} from './types';

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
    const yes = tabItems.filter((i) => i.answer).length;
    const total = tabItems.length;
    const no = total - yes;
    const score = total > 0 ? Math.round((yes / total) * 100) : 0;
    summaries.push({ tab, total, yes, no, score, items: tabItems });
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

function buildPhase(
  horizon: 30 | 60 | 90,
  weakPillars: Set<Pillar>,
  gapsByPillar: Map<Pillar, Assessment[]>
): PlanPhase {
  const meta = PHASE_META[horizon];
  const actions: PlanAction[] = [];

  // Deterministic pillar order so Critical work leads.
  const order: Pillar[] = [
    'Relationship',
    'Value',
    'Support',
    'Sentiment',
    'Adoption',
    'Commercial',
  ];

  for (const pillar of order) {
    if (!weakPillars.has(pillar)) continue;
    const template = PLAYBOOK[pillar].find((p) => p.horizon === horizon);
    if (!template) continue;
    const gaps = gapsByPillar.get(pillar) || [];
    const addresses =
      gaps.length > 0
        ? gaps
            .slice(0, 3)
            .map((g) => g.question)
            .join('; ')
        : undefined;
    actions.push({
      title: template.title,
      detail: template.detail,
      owner: template.owner,
      priority: template.priority,
      addresses,
    });
  }

  // Guarantee at least one action per phase even for very healthy accounts.
  if (actions.length === 0) {
    actions.push({
      title:
        horizon === 90
          ? 'Sustain momentum and plan the next value chapter'
          : 'Reinforce what is working',
      detail:
        'Account health is strong in this area. Maintain the cadence, document the winning motions, and reinvest freed-up capacity into the customer’s next strategic goal.',
      owner: 'CSM',
      priority: 'Medium',
    });
  }

  return {
    horizon,
    label: meta.label,
    targetStatus: meta.target,
    objective: meta.objective,
    actions,
    successMetrics: metricsFor(horizon),
    exitCriteria: exitFor(horizon),
  };
}

function metricsFor(horizon: 30 | 60 | 90): string[] {
  if (horizon === 30)
    return [
      'Executive sponsor meeting held and joint recovery plan signed off',
      'All P1/critical issues have owners and target dates',
      'Baseline metrics captured for the top 3 success KPIs',
    ];
  if (horizon === 60)
    return [
      'At least one measurable customer win delivered and socialized',
      'Active usage trending up vs. the day-30 baseline',
      'CSAT / sentiment measurably improved vs. baseline',
    ];
  return [
    'ROI / value-realization report delivered to the sponsor',
    'Renewal path confirmed (and expansion identified where healthy)',
    'Customer owns a sustainable adoption + governance cadence',
  ];
}

function exitFor(horizon: 30 | 60 | 90): string[] {
  if (horizon === 30)
    return [
      'Account no longer trending toward churn; risk is contained',
      'Champion re-engaged and joint plan is in motion',
    ];
  if (horizon === 60)
    return [
      'Health signals (usage, sentiment, open issues) moving in the right direction',
      'Customer can articulate at least one concrete win',
    ];
  return [
    'Account health assessed as Green on re-scoring',
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

  const total = items.length;
  const yes = items.filter((i) => i.answer).length;
  const no = total - yes;
  const score = total > 0 ? Math.round((yes / total) * 100) : 0;
  const status = statusFromScore(score);

  // Risks = unmet criteria; strengths = met criteria.
  const topRisks = items.filter((i) => !i.answer);
  const strengths = items.filter((i) => i.answer);

  // Which pillars are weak? A pillar is weak if it has any unmet criteria OR
  // (for empty accounts) if there is nothing proving it is strong.
  const gapsByPillar = new Map<Pillar, Assessment[]>();
  for (const risk of topRisks) {
    const pillar = classify(risk.question);
    if (!gapsByPillar.has(pillar)) gapsByPillar.set(pillar, []);
    gapsByPillar.get(pillar)!.push(risk);
  }

  const weakPillars = new Set<Pillar>(gapsByPillar.keys());
  // For a Red/Yellow account, always exercise the core recovery pillars so the
  // plan is complete even if the sheet was sparse.
  if (status !== 'Green') {
    ['Relationship', 'Value', 'Adoption'].forEach((p) =>
      weakPillars.add(p as Pillar)
    );
  }

  const plan: PlanPhase[] = [
    buildPhase(30, weakPillars, gapsByPillar),
    buildPhase(60, weakPillars, gapsByPillar),
    buildPhase(90, weakPillars, gapsByPillar),
  ];

  return {
    fileName,
    generatedAt: new Date().toISOString(),
    overall: { total, yes, no, score, status },
    tabs,
    topRisks,
    strengths,
    plan,
    executiveSummary: buildExecutiveSummary(status, score, topRisks, strengths),
  };
}
