/**
 * Budget planning model — pure (no imports) so the Policy page can run it
 * client-side on every slider move while the server uses the same code to
 * produce the recommended portfolio in the policy briefs.
 *
 * Avoided loss per category follows a saturating (diminishing-returns) curve:
 *   avoided_c = baseline_hazard × maxShare_c × (1 − e^(−invest_c / scale_c))
 * Categories are combined multiplicatively so the total never exceeds the
 * baseline:  residual = Π (1 − reduction_c).
 */

export type BudgetCategory = "embankment" | "sluice" | "early_warning" | "preposition" | "resilient_seed";

export interface CategoryParams {
  key: BudgetCategory;
  label: string;
  hazard: "flood" | "salinity" | "both";
  /** maximum share of the hazard's baseline loss this lever can remove */
  maxShare: number;
  /** $ at which ~63% of maxShare is realised */
  scaleUsd: number;
  lifetimeYears: number;
  /** annual O&M as share of capex */
  omPct: number;
  description: string;
}

export const BUDGET_CATEGORIES: CategoryParams[] = [
  { key: "embankment", label: "Embankment reinforcement", hazard: "flood", maxShare: 0.42, scaleUsd: 60_000_000, lifetimeYears: 25, omPct: 0.02, description: "Raise & armour river/polder embankments at breach-prone reaches" },
  { key: "sluice", label: "Tidal sluice gates & regulators", hazard: "salinity", maxShare: 0.55, scaleUsd: 18_000_000, lifetimeYears: 30, omPct: 0.025, description: "Automated sluices that close on high tide to block saline ingress" },
  { key: "early_warning", label: "Sensors & early warning", hazard: "both", maxShare: 0.3, scaleUsd: 4_000_000, lifetimeYears: 8, omPct: 0.08, description: "Rain/river/EC sensor densification + 72h alert dissemination" },
  { key: "preposition", label: "Pumps & pre-positioned stock", hazard: "flood", maxShare: 0.18, scaleUsd: 6_000_000, lifetimeYears: 10, omPct: 0.05, description: "Dewatering pumps, sandbags and relief stock in district depots" },
  { key: "resilient_seed", label: "Stress-tolerant seed & training", hazard: "both", maxShare: 0.22, scaleUsd: 5_000_000, lifetimeYears: 5, omPct: 0.1, description: "Submergence/salt-tolerant varieties (e.g. BRRI dhan 67, Swarna-Sub1) + extension" },
];

export interface BudgetBaseline {
  floodAnnualLossUsd: number;
  salinityAnnualLossUsd: number;
}

export interface BudgetResult {
  totalInvestUsd: number;
  annualOmUsd: number;
  baselineAnnualLossUsd: number;
  avoidedAnnualUsd: number;
  residualAnnualLossUsd: number;
  pvAvoidedUsd: number;
  pvCostUsd: number;
  costOfInactionUsd: number;
  bcr: number;
  paybackYears: number | null;
  npvUsd: number;
  perCategory: { key: BudgetCategory; label: string; investUsd: number; avoidedAnnualUsd: number; reductionPct: number; marginalBcr: number }[];
  yearly: { year: number; inaction: number; proactive: number }[];
}

const pvFactor = (rate: number, years: number) => (rate === 0 ? years : (1 - (1 + rate) ** -years) / rate);

export function computeBudget(
  invest: Partial<Record<BudgetCategory, number>>,
  baseline: BudgetBaseline,
  opts: { horizonYears?: number; discountRate?: number; climateTrendPct?: number } = {}
): BudgetResult {
  const horizon = opts.horizonYears ?? 15;
  const rate = opts.discountRate ?? 0.08;
  const trend = (opts.climateTrendPct ?? 2.5) / 100; // losses grow with climate change

  let floodResidual = 1;
  let salResidual = 1;
  const reductions: Record<string, { flood: number; sal: number }> = {};
  for (const c of BUDGET_CATEGORIES) {
    const x = Math.max(0, invest[c.key] ?? 0);
    const r = c.maxShare * (1 - Math.exp(-x / c.scaleUsd));
    const f = c.hazard === "salinity" ? 0 : r;
    const s = c.hazard === "flood" ? 0 : r;
    floodResidual *= 1 - f;
    salResidual *= 1 - s;
    reductions[c.key] = { flood: f, sal: s };
  }
  const base = baseline.floodAnnualLossUsd + baseline.salinityAnnualLossUsd;
  const avoided = baseline.floodAnnualLossUsd * (1 - floodResidual) + baseline.salinityAnnualLossUsd * (1 - salResidual);

  const total = BUDGET_CATEGORIES.reduce((s, c) => s + Math.max(0, invest[c.key] ?? 0), 0);
  const om = BUDGET_CATEGORIES.reduce((s, c) => s + Math.max(0, invest[c.key] ?? 0) * c.omPct, 0);

  // growing annuity: losses escalate with climate trend
  let pvAvoided = 0;
  let pvBase = 0;
  const yearly: BudgetResult["yearly"] = [];
  let cumIn = 0;
  let cumPro = total;
  for (let y = 1; y <= horizon; y++) {
    const g = (1 + trend) ** (y - 1);
    const df = (1 + rate) ** -y;
    pvAvoided += avoided * g * df;
    pvBase += base * g * df;
    cumIn += base * g;
    cumPro += (base - avoided) * g + om;
    yearly.push({ year: y, inaction: Math.round(cumIn), proactive: Math.round(cumPro) });
  }
  const pvCost = total + om * pvFactor(rate, horizon);
  const net = avoided - om;
  const perCategory = BUDGET_CATEGORIES.map((c) => {
    const x = Math.max(0, invest[c.key] ?? 0);
    const red = reductions[c.key]!;
    const av = baseline.floodAnnualLossUsd * red.flood + baseline.salinityAnnualLossUsd * red.sal;
    // marginal BCR of the next $1M in this category
    const dx = 1_000_000;
    const r2 = c.maxShare * (1 - Math.exp(-(x + dx) / c.scaleUsd));
    const hazardBase = c.hazard === "flood" ? baseline.floodAnnualLossUsd : c.hazard === "salinity" ? baseline.salinityAnnualLossUsd : base;
    const dAv = hazardBase * (r2 - c.maxShare * (1 - Math.exp(-x / c.scaleUsd)));
    return {
      key: c.key,
      label: c.label,
      investUsd: x,
      avoidedAnnualUsd: Math.round(av),
      reductionPct: Math.round((red.flood || red.sal) * 1000) / 10,
      marginalBcr: Math.round(((dAv * pvFactor(rate, Math.min(horizon, c.lifetimeYears))) / dx) * 100) / 100,
    };
  });
  return {
    totalInvestUsd: total,
    annualOmUsd: Math.round(om),
    baselineAnnualLossUsd: Math.round(base),
    avoidedAnnualUsd: Math.round(avoided),
    residualAnnualLossUsd: Math.round(base - avoided),
    pvAvoidedUsd: Math.round(pvAvoided),
    pvCostUsd: Math.round(pvCost),
    costOfInactionUsd: Math.round(pvBase),
    bcr: pvCost > 0 ? Math.round((pvAvoided / pvCost) * 100) / 100 : 0,
    paybackYears: net > 0 && total > 0 ? Math.round((total / net) * 10) / 10 : null,
    npvUsd: Math.round(pvAvoided - pvCost),
    perCategory,
    yearly,
  };
}

/**
 * Greedy allocation in tranches to the category with the highest marginal BCR,
 * stopping at the budget cap or when the next tranche no longer returns
 * `minMarginalBcr` (default 1.5 — a common appraisal hurdle for public works).
 */
export function optimisePortfolio(budgetUsd: number, baseline: BudgetBaseline, opts?: { horizonYears?: number; discountRate?: number; minMarginalBcr?: number }) {
  const alloc: Partial<Record<BudgetCategory, number>> = {};
  const hurdle = opts?.minMarginalBcr ?? 1.5;
  const step = Math.max(250_000, Math.round(budgetUsd / 80 / 250_000) * 250_000);
  for (let spent = 0; spent + step <= budgetUsd; spent += step) {
    const r = computeBudget(alloc, baseline, opts);
    const best = [...r.perCategory].sort((a, b) => b.marginalBcr - a.marginalBcr)[0]!;
    if (best.marginalBcr < hurdle) break;
    alloc[best.key] = (alloc[best.key] ?? 0) + step;
  }
  return alloc;
}
