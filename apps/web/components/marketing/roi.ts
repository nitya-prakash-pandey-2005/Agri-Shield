/**
 * ROI model for the public calculator (/roi) and the worked examples on the
 * solutions pages. Pure functions, no React: every figure on screen comes
 * from here, and every output carries the formula that produced it.
 *
 * The model is deliberately simple and conservative:
 *   baseline expected loss (EL)  = exposure × annual climate-loss rate
 *   avoided loss                 = EL × share avoidable with 3-7 days' notice × share of warnings acted on
 *   operational saving           = units × cost per unit × % of that work Agri-SHIELD removes
 *   net benefit                  = avoided loss + operational saving − subscription
 * Defaults are illustrative starting points, not measured results. Buyers are
 * expected to replace them with their own loss history.
 */

export type RoiIndustry = "insurance" | "banking" | "agribusiness" | "government" | "ngo" | "cooperative" | "farmers";

export interface RoiField {
  key: string;
  label: string;
  /** "usd" | "pct" | "count" | "usd_per" */
  kind: "usd" | "pct" | "count";
  min: number;
  max: number;
  step: number;
  help: string;
}

export interface RoiPlanOption {
  id: string;
  label: string;
  annualUsd: number;
}

/** Annual list prices (monthly × 12; annual prepay is 10× monthly). */
export const ROI_PLANS: RoiPlanOption[] = [
  { id: "farmer_pro", label: "Farmer Pro · $3/mo", annualUsd: 36 },
  { id: "gov_basic", label: "Government Basic · $299/mo", annualUsd: 299 * 12 },
  { id: "supply_chain", label: "Supply Chain · $499/mo", annualUsd: 499 * 12 },
  { id: "business", label: "Business · $1,490/mo", annualUsd: 1490 * 12 },
  { id: "business_nonprofit", label: "Business · NGO / co-op rate $745/mo", annualUsd: 745 * 12 },
  { id: "enterprise", label: "Enterprise · from $4,900/mo", annualUsd: 4900 * 12 },
];

export interface RoiPreset {
  industry: RoiIndustry;
  label: string;
  /** What "exposure" means for this buyer */
  exposureLabel: string;
  unitLabel: string;
  opsLabel: string;
  fields: RoiField[];
  defaults: Record<string, number>;
  defaultPlan: string;
  assumptions: string[];
}

const F = {
  exposure: (label: string, max: number, help: string): RoiField => ({ key: "exposureUsd", label, kind: "usd", min: 0, max, step: max / 200, help }),
  lossRate: (help: string): RoiField => ({ key: "lossRatePct", label: "Annual climate-loss rate", kind: "pct", min: 0, max: 30, step: 0.1, help }),
  avoidable: (help: string): RoiField => ({ key: "avoidablePct", label: "Share of loss avoidable with early warning", kind: "pct", min: 0, max: 60, step: 1, help }),
  action: (help: string): RoiField => ({ key: "actionRatePct", label: "Share of warnings acted on", kind: "pct", min: 0, max: 100, step: 1, help }),
  units: (label: string, max: number, help: string): RoiField => ({ key: "units", label, kind: "count", min: 0, max, step: Math.max(1, Math.round(max / 500)), help }),
  unitCost: (label: string, max: number, help: string): RoiField => ({ key: "costPerUnitUsd", label, kind: "usd", min: 0, max, step: Math.max(0.5, max / 200), help }),
  opsCut: (label: string, help: string): RoiField => ({ key: "opsReductionPct", label, kind: "pct", min: 0, max: 80, step: 1, help }),
};

export const ROI_PRESETS: Record<RoiIndustry, RoiPreset> = {
  insurance: {
    industry: "insurance",
    label: "Agri insurer",
    exposureLabel: "Sum insured",
    unitLabel: "Claims per year",
    opsLabel: "Claims handling",
    fields: [
      F.exposure("Total sum insured (USD)", 200_000_000, "Total liability across crop policies in the season."),
      { key: "premiumRatePct", label: "Average premium rate", kind: "pct", min: 0.5, max: 15, step: 0.1, help: "Premium as % of sum insured." },
      F.lossRate("Expected claims as % of sum insured per year (your historical burning cost)."),
      F.avoidable("Portion of indemnity losses policyholders can prevent with 3-7 days' notice (draining, early harvest, moving inputs). Not applicable to pure parametric covers."),
      F.action("Share of warned policyholders who act. Pilot programmes typically see 30-60%."),
      F.units("Claims per year", 50_000, "Number of claims your team verifies each year."),
      F.unitCost("Field verification cost per claim (USD)", 200, "Loss adjuster visit, travel and admin."),
      F.opsCut("Verification work removed", "Share of claims that can be triaged remotely from satellite + forecast evidence."),
    ],
    defaults: { exposureUsd: 25_000_000, premiumRatePct: 5, lossRatePct: 3.5, avoidablePct: 15, actionRatePct: 40, units: 4_000, costPerUnitUsd: 35, opsReductionPct: 30 },
    defaultPlan: "business",
    assumptions: [
      "Parametric payouts are contractual; only indemnity-style losses are assumed preventable.",
      "Loss-ratio change is shown before reinsurance and expenses.",
      "No credit is taken for premium growth or better pricing, although the risk scores support both.",
    ],
  },
  banking: {
    industry: "banking",
    label: "Bank or MFI",
    exposureLabel: "Agri loan book",
    unitLabel: "Loans monitored",
    opsLabel: "Field monitoring",
    fields: [
      F.exposure("Agricultural loans outstanding (USD)", 500_000_000, "Current outstanding balance on crop, equipment and working-capital loans."),
      { key: "lgdPct", label: "Loss given default (LGD)", kind: "pct", min: 5, max: 90, step: 1, help: "Share of the balance lost when a loan defaults, after collateral." },
      F.lossRate("Annual share of the book that defaults because of floods, salinity or drought (climate-driven PD)."),
      F.avoidable("Portion of those defaults avoidable through early restructuring, input advice or insurance top-ups."),
      F.action("Share of flagged borrowers your officers reach in time."),
      F.units("Loans monitored", 100_000, "Number of active agricultural loans."),
      F.unitCost("Monitoring cost per loan per year (USD)", 100, "Officer visits and phone checks."),
      F.opsCut("Monitoring visits replaced", "Visits replaced by remote risk scoring (officers visit only flagged borrowers)."),
    ],
    defaults: { exposureUsd: 40_000_000, lgdPct: 45, lossRatePct: 2.2, avoidablePct: 20, actionRatePct: 50, units: 8_000, costPerUnitUsd: 18, opsReductionPct: 25 },
    defaultPlan: "enterprise",
    assumptions: [
      "Expected loss = book × climate-driven PD × LGD.",
      "Avoided defaults come from earlier restructuring, not from declining credit.",
      "Capital relief and pricing benefits are excluded.",
    ],
  },
  agribusiness: {
    industry: "agribusiness",
    label: "Agribusiness / food company",
    exposureLabel: "Sourced volume at risk",
    unitLabel: "Shipments per year",
    opsLabel: "Emergency logistics",
    fields: [
      F.exposure("Annual sourcing + stock value in climate-exposed regions (USD)", 500_000_000, "Value of crops sourced and stored in flood- or salinity-exposed districts."),
      F.lossRate("Share of that value lost each year to disruption (spoiled stock, missed volume, spot-price premiums)."),
      F.avoidable("Share avoidable by re-routing, pre-buying or moving stock a few days earlier."),
      F.action("Share of alerts your procurement and logistics teams act on."),
      F.units("Emergency re-routings per year", 5_000, "Shipments currently re-booked at short notice."),
      F.unitCost("Premium paid per short-notice re-routing (USD)", 5_000, "Expedite fees, demurrage, spot trucking."),
      F.opsCut("Re-routings planned in advance instead", "Share of those moves made at normal rates thanks to 3-7 days' notice."),
    ],
    defaults: { exposureUsd: 60_000_000, lossRatePct: 2.5, avoidablePct: 20, actionRatePct: 50, units: 120, costPerUnitUsd: 1_800, opsReductionPct: 40 },
    defaultPlan: "business",
    assumptions: ["Only direct losses and logistics premiums are counted.", "Revenue protected from on-shelf availability is excluded."],
  },
  government: {
    industry: "government",
    label: "Government agency",
    exposureLabel: "Crop value in monitored districts",
    unitLabel: "Relief deployments per year",
    opsLabel: "Relief logistics",
    fields: [
      F.exposure("Crop production value in the districts you manage (USD)", 5_000_000_000, "Annual farm-gate value of crops in your jurisdiction."),
      F.lossRate("Average annual crop loss to floods and salinity (from past disaster records)."),
      F.avoidable("Share preventable by farmers with 72 h notice (drain fields, harvest early, protect seedbeds)."),
      F.action("Share of warned farmers who act. Depends on channel reach (SMS, extension officers)."),
      F.units("Relief deployments per year", 2_000, "Pump, seed or food-pack deployments after events."),
      F.unitCost("Cost per deployment (USD)", 50_000, "Transport, staff and materials."),
      F.opsCut("Deployment cost saved by pre-positioning", "Pre-positioned stock reaches farms sooner and at lower cost."),
    ],
    defaults: { exposureUsd: 400_000_000, lossRatePct: 3, avoidablePct: 12, actionRatePct: 35, units: 150, costPerUnitUsd: 6_000, opsReductionPct: 20 },
    defaultPlan: "gov_basic",
    assumptions: ["Benefits accrue to farmers and the public budget, not to the agency's own P&L.", "Lives protected and household welfare effects are not monetised."],
  },
  ngo: {
    industry: "ngo",
    label: "NGO / humanitarian",
    exposureLabel: "Household assets at risk",
    unitLabel: "Households in programme",
    opsLabel: "Response cost",
    fields: [
      F.exposure("Value of household crops, livestock and assets at risk (USD)", 200_000_000, "Across the communities in your programme."),
      F.lossRate("Average annual share lost to floods and cyclones."),
      F.avoidable("Share avoidable when cash or supplies arrive before the peak (anticipatory action) rather than after."),
      F.action("Share of targeted households reached before the peak."),
      F.units("Households in programme", 200_000, "Households eligible for anticipatory transfers."),
      F.unitCost("Post-disaster response cost per household (USD)", 500, "Average cost of the response you run today."),
      F.opsCut("Response cost avoided by acting early", "Earlier, pre-agreed delivery is usually cheaper than emergency delivery."),
    ],
    defaults: { exposureUsd: 12_000_000, lossRatePct: 6, avoidablePct: 20, actionRatePct: 60, units: 25_000, costPerUnitUsd: 110, opsReductionPct: 15 },
    defaultPlan: "business",
    assumptions: ["Registered NGOs receive a 50% discount on request; the calculator uses list price.", "Replace the defaults with your own programme evaluation data."],
  },
  cooperative: {
    industry: "cooperative",
    label: "Farmer co-operative",
    exposureLabel: "Members' crop value",
    unitLabel: "Member farms",
    opsLabel: "Agronomy visits",
    fields: [
      F.exposure("Annual crop value across member farms (USD)", 50_000_000, "Farm-gate value of the members' harvest."),
      F.lossRate("Average annual share lost to floods, salinity and dry spells."),
      F.avoidable("Share preventable with 72 h – 30 day notice (sluice timing, early harvest, salt-tolerant seed)."),
      F.action("Share of members who act on the co-op's advisory."),
      F.units("Member farms", 20_000, "Farms the co-op advises."),
      F.unitCost("Agronomy visit cost per farm per year (USD)", 50, "Field staff time and travel."),
      F.opsCut("Visits replaced by targeted advisories", "Staff visit flagged farms instead of all farms."),
    ],
    defaults: { exposureUsd: 1_400_000, lossRatePct: 8, avoidablePct: 20, actionRatePct: 55, units: 900, costPerUnitUsd: 12, opsReductionPct: 25 },
    defaultPlan: "business_nonprofit",
    assumptions: ["Uses the 50% registered co-operative rate on the Business plan. At full list price a co-op of this size needs roughly 1,100+ member farms to break even."],
  },
  farmers: {
    industry: "farmers",
    label: "Farmer",
    exposureLabel: "Harvest value",
    unitLabel: "Fields",
    opsLabel: "Inputs saved",
    fields: [
      F.exposure("Value of your harvest per year (USD)", 50_000, "What your crop sells for in a normal year."),
      F.lossRate("Share you lose in a typical year to floods, salt or dry spells."),
      F.avoidable("Share you could save with 3 days' warning (drain, harvest early, store fresh water)."),
      F.action("How often you would act on a warning."),
      F.units("Fields", 20, "Number of fields you farm."),
      F.unitCost("Inputs wasted per field when a flood hits (USD)", 500, "Fertiliser or seed applied just before a flood."),
      F.opsCut("Input waste avoided", "Delay spraying or fertilising when heavy rain is forecast."),
    ],
    defaults: { exposureUsd: 2_400, lossRatePct: 12, avoidablePct: 25, actionRatePct: 70, units: 2, costPerUnitUsd: 40, opsReductionPct: 50 },
    defaultPlan: "farmer_pro",
    assumptions: ["Farmer Basic is free; the calculator uses Farmer Pro at $3/month.", "Price benefits from better-timed selling are excluded."],
  },
};

export interface RoiLine {
  label: string;
  value: number;
  unit: "usd" | "pct" | "months" | "x" | "pts";
  formula: string;
}

export interface RoiResult {
  baselineLossUsd: number;
  avoidedLossUsd: number;
  opsSavingUsd: number;
  totalBenefitUsd: number;
  planCostUsd: number;
  netBenefitUsd: number;
  /** benefit ÷ cost */
  roiMultiple: number;
  /** months of benefit needed to cover one year of subscription; Infinity when there is no benefit */
  paybackMonths: number;
  /** avoided loss as % of the baseline expected loss */
  elReductionPct: number;
  /** industry-specific extras (loss ratio, EL in bps, cost per household…) */
  extras: RoiLine[];
  lines: RoiLine[];
}

const pct = (v: number | undefined) => (v ?? 0) / 100;
const num = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0);

export function computeRoi(industry: RoiIndustry, inputs: Record<string, number>, planAnnualUsd: number): RoiResult {
  const preset = ROI_PRESETS[industry];
  const v = { ...preset.defaults, ...inputs };
  const exposure = Math.max(0, num(v.exposureUsd));
  const lossRate = pct(v.lossRatePct);
  const avoidable = pct(v.avoidablePct);
  const action = pct(v.actionRatePct);

  // Banking uses PD × LGD; everyone else uses a direct loss rate.
  const lgd = industry === "banking" ? pct(v.lgdPct) : 1;
  const baseline = exposure * lossRate * lgd;
  const avoided = baseline * avoidable * action;
  const ops = Math.max(0, num(v.units)) * Math.max(0, num(v.costPerUnitUsd)) * pct(v.opsReductionPct);
  const benefit = avoided + ops;
  const cost = Math.max(0, planAnnualUsd);
  const net = benefit - cost;
  const roiMultiple = cost > 0 ? benefit / cost : 0;
  const paybackMonths = benefit > 0 ? (cost / benefit) * 12 : Number.POSITIVE_INFINITY;
  const elReductionPct = baseline > 0 ? (avoided / baseline) * 100 : 0;

  const baselineFormula =
    industry === "banking" ? "loan book × climate-driven PD × LGD" : `${preset.exposureLabel.toLowerCase()} × annual climate-loss rate`;

  const extras: RoiLine[] = [];
  if (industry === "insurance") {
    const premium = exposure * pct(v.premiumRatePct);
    const lrBefore = premium > 0 ? (baseline / premium) * 100 : 0;
    const lrAfter = premium > 0 ? ((baseline - avoided) / premium) * 100 : 0;
    extras.push(
      { label: "Gross written premium", value: premium, unit: "usd", formula: "sum insured × premium rate" },
      { label: "Loss ratio before", value: lrBefore, unit: "pct", formula: "expected claims ÷ premium" },
      { label: "Loss ratio after", value: lrAfter, unit: "pct", formula: "(expected claims − avoided claims) ÷ premium" },
      { label: "Loss-ratio improvement (pts)", value: lrBefore - lrAfter, unit: "pts", formula: "loss ratio before − after" }
    );
  } else if (industry === "banking") {
    extras.push(
      { label: "Climate EL before (bps)", value: exposure > 0 ? (baseline / exposure) * 10_000 : 0, unit: "pts", formula: "EL ÷ book, in basis points" },
      { label: "Climate EL after (bps)", value: exposure > 0 ? ((baseline - avoided) / exposure) * 10_000 : 0, unit: "pts", formula: "(EL − avoided) ÷ book, in basis points" }
    );
  } else if (industry === "ngo") {
    const hh = Math.max(0, num(v.units));
    extras.push(
      { label: "Losses avoided per household", value: hh > 0 ? avoided / hh : 0, unit: "usd", formula: "avoided loss ÷ households" },
      { label: "Platform cost per household", value: hh > 0 ? cost / hh : 0, unit: "usd", formula: "subscription ÷ households" }
    );
  } else if (industry === "cooperative" || industry === "government") {
    const n = Math.max(0, num(v.units));
    if (industry === "cooperative") extras.push({ label: "Platform cost per member farm", value: n > 0 ? cost / n : 0, unit: "usd", formula: "subscription ÷ member farms" });
  }

  const lines: RoiLine[] = [
    { label: "Baseline expected loss", value: baseline, unit: "usd", formula: baselineFormula },
    { label: "Avoided loss", value: avoided, unit: "usd", formula: "baseline EL × avoidable share × action rate" },
    { label: `${preset.opsLabel} saving`, value: ops, unit: "usd", formula: `${preset.unitLabel.toLowerCase()} × cost per unit × work removed` },
    { label: "Total annual benefit", value: benefit, unit: "usd", formula: "avoided loss + operational saving" },
    { label: "Subscription (annual)", value: cost, unit: "usd", formula: "plan price × 12" },
    { label: "Net annual benefit", value: net, unit: "usd", formula: "total benefit − subscription" },
    { label: "Return on subscription", value: roiMultiple, unit: "x", formula: "total benefit ÷ subscription" },
    { label: "Payback", value: paybackMonths, unit: "months", formula: "subscription ÷ total benefit × 12" },
    { label: "Expected-loss reduction", value: elReductionPct, unit: "pct", formula: "avoided loss ÷ baseline EL" },
  ];

  return {
    baselineLossUsd: baseline,
    avoidedLossUsd: avoided,
    opsSavingUsd: ops,
    totalBenefitUsd: benefit,
    planCostUsd: cost,
    netBenefitUsd: net,
    roiMultiple,
    paybackMonths,
    elReductionPct,
    extras,
    lines,
  };
}

export function planAnnual(planId: string): number {
  return ROI_PLANS.find((p) => p.id === planId)?.annualUsd ?? 0;
}

/** Compact USD: $1.2M, $48k, $950 */
export function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const s = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${s}$${Math.round(a / 1e3)}k`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}k`;
  return `${s}$${Math.round(a)}`;
}

export function fmtLine(l: Pick<RoiLine, "value" | "unit">): string {
  switch (l.unit) {
    case "usd":
      return fmtUsd(l.value);
    case "pct":
      return `${l.value.toFixed(l.value < 10 ? 1 : 0)}%`;
    case "pts":
      return `${l.value.toFixed(1)}`;
    case "x":
      return `${l.value.toFixed(1)}×`;
    case "months":
      return Number.isFinite(l.value) ? (l.value < 1 ? `${Math.max(1, Math.round(l.value * 30))} days` : `${l.value.toFixed(1)} months`) : "no payback";
  }
}

/** Format an input value for display next to its field. */
export function fmtInput(kind: RoiField["kind"], v: number): string {
  if (kind === "usd") return fmtUsd(v);
  if (kind === "pct") return `${Number(v.toFixed(1))}%`;
  return Math.round(v).toLocaleString("en-US");
}
