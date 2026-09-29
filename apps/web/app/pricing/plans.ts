/**
 * Agri-SHIELD plan catalogue (spec §12). Pure data — imported by the pricing
 * page, the landing teaser and the billing tRPC router.
 */
export type PlanId = "free" | "farmer_pro" | "gov_basic" | "gov_enterprise" | "supply_chain" | "business" | "enterprise";
export type BillingInterval = "month" | "year";
export type CurrencyCode = "USD" | "INR" | "BDT" | "VND" | "PHP" | "IDR";
/** "workspace" = the multi-tenant organisation workspace (insurers, banks, agribusiness, NGOs, co-ops). */
export type Audience = "farmer" | "government" | "supply_chain" | "workspace";

export interface Plan {
  id: PlanId;
  name: string;
  audience: Audience;
  tagline: string;
  /** USD per month; null = custom quote */
  usdMonthly: number | null;
  /** Indicative starting price for quoted plans ("from $4,900 / month"). Display only. */
  fromUsdMonthly?: number;
  /** Fixed local list prices that override FX conversion (e.g. ₹199 Farmer Pro). */
  localMonthly?: Partial<Record<CurrencyCode, number>>;
  unit: string;
  highlight?: boolean;
  trialDays: number;
  cta: string;
  features: string[];
}

/** Annual billing = 10× monthly (two months free). */
export const ANNUAL_MONTHS = 10;
export const TRIAL_DAYS = 14;

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Farmer Basic",
    audience: "farmer",
    tagline: "Flood warnings for smallholders, free forever.",
    usdMonthly: 0,
    unit: "per farmer",
    trialDays: 0,
    cta: "Start free",
    features: ["Up to 2 fields (10 ha)", "Flood alerts, 24 h ahead", "7-day weather forecast", "App + 5 SMS alerts / month", "English interface"],
  },
  {
    id: "farmer_pro",
    name: "Farmer Pro",
    audience: "farmer",
    tagline: "72-hour flood and salt warnings plus an AI advisor.",
    usdMonthly: 3,
    localMonthly: { INR: 199, BDT: 299, VND: 69_000, PHP: 149, IDR: 45_000 },
    unit: "per farmer / month",
    highlight: true,
    trialDays: TRIAL_DAYS,
    cta: "Start 14-day trial",
    features: [
      "Unlimited fields",
      "Flood + salinity alerts, 72 h ahead",
      "AI farm advisor (50 questions / month)",
      "All 8 languages",
      "Weekly satellite field scans",
      "WhatsApp alerts",
      "Crop-insurance recommendations",
    ],
  },
  {
    id: "business",
    name: "Business",
    audience: "workspace",
    tagline: "One climate-risk workspace for an insurer, lender, agribusiness, NGO or co-op.",
    usdMonthly: 1490,
    unit: "per workspace / month",
    highlight: true,
    trialDays: TRIAL_DAYS,
    cta: "Start 14-day trial",
    features: [
      "Up to 2,500 monitored assets · 10 seats",
      "Risk Explorer for any location on Earth",
      "Portfolio monitoring, re-scored daily",
      "Alert rules → app, email, SMS, webhook",
      "One industry module: Insurance, Finance or Anticipatory Action",
      "Copilot: ask questions of your own portfolio",
      "REST API + signed webhooks",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    audience: "workspace",
    tagline: "Every module, unlimited assets, your security and hosting requirements.",
    usdMonthly: null,
    fromUsdMonthly: 4900,
    unit: "per organisation · annual contract",
    trialDays: 0,
    cta: "Book a demo",
    features: [
      "Unlimited assets and seats",
      "All modules: Insurance, Finance, Anticipatory Action",
      "Multiple workspaces (regions, subsidiaries)",
      "Higher API limits + bulk portfolio import",
      "Private hosting / data-residency options",
      "Dedicated customer success manager",
      "99.9% uptime SLA",
    ],
  },
  {
    id: "gov_basic",
    name: "Government Basic",
    audience: "government",
    tagline: "A provincial command centre for one agency.",
    usdMonthly: 299,
    unit: "per agency / month",
    trialDays: TRIAL_DAYS,
    cta: "Start 14-day trial",
    features: ["Regional dashboard (1 province)", "Broadcast alerts to registered farmers", "Resource tracking & dispatch", "Monthly PDF reports"],
  },
  {
    id: "gov_enterprise",
    name: "Government Enterprise",
    audience: "government",
    tagline: "National coordination across ministries and provinces.",
    usdMonthly: null,
    unit: "custom contract",
    trialDays: 0,
    cta: "Talk to us",
    features: ["National dashboard", "Multi-province management", "REST API access", "Custom alert templates", "Dedicated support", "99.9% uptime SLA"],
  },
  {
    id: "supply_chain",
    name: "Supply Chain",
    audience: "supply_chain",
    tagline: "See crop disruption before it reaches your P&L.",
    usdMonthly: 499,
    unit: "per organisation / month",
    trialDays: TRIAL_DAYS,
    cta: "Start 14-day trial",
    features: ["Commodity risk tracking (10 commodities)", "Disruption scenario modelling", "REST API + signed webhooks", "ERP integration support"],
  },
];

export const planById = (id: string) => PLANS.find((p) => p.id === id);

/** Indicative FX (USD → local) for display only. Cards are charged in USD, UPI in INR. */
export const FX: Record<CurrencyCode, number> = { USD: 1, INR: 88, BDT: 122, VND: 26_300, PHP: 58, IDR: 16_400 };

export const CURRENCIES: { code: CurrencyCode; label: string; locale: string }[] = [
  { code: "USD", label: "US dollar", locale: "en-US" },
  { code: "INR", label: "Indian rupee", locale: "en-IN" },
  { code: "BDT", label: "Bangladeshi taka", locale: "bn-BD" },
  { code: "VND", label: "Vietnamese đồng", locale: "vi-VN" },
  { code: "PHP", label: "Philippine peso", locale: "en-PH" },
  { code: "IDR", label: "Indonesian rupiah", locale: "id-ID" },
];

/** Price for one billing period in the chosen currency (null = custom). */
export function priceFor(plan: Plan, currency: CurrencyCode, interval: BillingInterval): number | null {
  if (plan.usdMonthly === null) return null;
  const monthly = plan.localMonthly?.[currency] ?? roundNice(plan.usdMonthly * FX[currency]);
  return interval === "year" ? monthly * ANNUAL_MONTHS : monthly;
}

function roundNice(v: number) {
  if (v === 0) return 0;
  if (v < 20) return Math.round(v);
  if (v < 1000) return Math.round(v / 5) * 5;
  const mag = 10 ** (Math.floor(Math.log10(v)) - 2);
  return Math.round(v / mag) * mag;
}

export function formatMoney(amount: number, currency: CurrencyCode) {
  const locale = CURRENCIES.find((c) => c.code === currency)?.locale ?? "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0, currencyDisplay: "narrowSymbol" }).format(amount);
}

/** Smallest-unit amount for payment providers (cents / paise). */
export function minorUnits(plan: Plan, currency: "USD" | "INR", interval: BillingInterval) {
  const p = priceFor(plan, currency, interval) ?? 0;
  return Math.round(p * 100);
}

/** Column order of the feature matrix (and of plan cards in the "All" view). */
export const MATRIX_COLUMNS: PlanId[] = ["free", "farmer_pro", "gov_basic", "gov_enterprise", "supply_chain", "business", "enterprise"];

export type Cell = boolean | string;
export interface MatrixRow {
  label: string;
  /** Plain-language explanation shown under the label */
  help?: string;
  cells: Record<PlanId, Cell>;
}

/** Row helper — cells listed in MATRIX_COLUMNS order. */
function r(label: string, cells: [Cell, Cell, Cell, Cell, Cell, Cell, Cell], help?: string): MatrixRow {
  return { label, help, cells: Object.fromEntries(MATRIX_COLUMNS.map((id, i) => [id, cells[i]!])) as Record<PlanId, Cell> };
}

export const MATRIX: { group: string; rows: MatrixRow[] }[] = [
  {
    group: "Early warning",
    rows: [
      r("Flood alerts", ["24 h", "72 h", "72 h", "72 h", "72 h", "72 h", "72 h"]),
      r("Saltwater-intrusion alerts", [false, true, true, true, true, true, true]),
      r("Live hazard feed (GDACS · NASA EONET)", [true, true, true, true, true, true, true]),
      r("Alert channels", ["App + 5 SMS", "App, SMS, WhatsApp", "Broadcast to farmers", "Broadcast + custom templates", "Email + webhooks", "App, email, SMS, webhook, Slack", "All + custom integrations"]),
    ],
  },
  {
    group: "Workspace modules",
    rows: [
      r("Risk Explorer", [false, false, "1 province", "National", true, "Any location", "Any location"], "Type any place or click the map for a full flood, salinity, drought and heat report."),
      r("Portfolio monitoring", [false, false, false, false, "20 supply nodes", "2,500 assets", "Unlimited"], "Import plots, loans, facilities or communities; each is re-scored against live forecasts."),
      r("Alert rules engine", [false, false, false, true, false, true, true], "“If flood probability on a coastal plot exceeds 60%, SMS the claims team.”"),
      r("Insurance module", [false, false, false, false, false, "1 industry module", true], "Parametric trigger watch, expected loss, claims triage."),
      r("Lending & Finance module", [false, false, false, false, false, "1 industry module", true], "Climate-adjusted expected loss on the loan book, restructuring watch-list."),
      r("Anticipatory Action module", [false, false, false, false, false, "1 industry module", true], "Pre-agreed triggers that release cash or supplies before the peak."),
      r("Copilot (ask your data)", [false, false, false, false, false, true, true], "Plain-language questions answered only from your workspace data, with sources."),
      r("REST API + webhooks", [false, false, false, true, true, true, "Higher limits"]),
      r("Seats", ["1", "1", "Agency team", "Unlimited", "Team", "10", "Unlimited"]),
    ],
  },
  {
    group: "Intelligence",
    rows: [
      r("Fields / regions", ["2 fields · 10 ha", "Unlimited fields", "1 province", "National", "20 supply nodes", "Any region", "Any region"]),
      r("AI farm advisor", [false, "50 / month", false, false, false, false, false]),
      r("Satellite field scans (NASA MODIS NDVI)", [false, "Weekly", "Weekly", "Daily", false, "Weekly", "Daily"]),
      r("Commodity risk tracking", [false, false, false, false, "10 commodities", false, true]),
      r("Scenario modelling", [false, false, false, true, true, true, true]),
      r("Languages", ["English", "All 8", "All 8", "All 8", "English", "English + 1", "All 8"]),
    ],
  },
  {
    group: "Operations",
    rows: [
      r("Resource tracking & dispatch", [false, false, true, true, false, false, true]),
      r("Reports", [false, false, "Monthly PDF", "On demand", "On demand", "On demand + CSV/GeoJSON", "On demand + scheduled"]),
      r("Signed webhooks", [false, false, false, true, true, true, true]),
      r("Offline PWA + SMS fallback", [true, true, true, true, true, true, true]),
      r("Private hosting / data residency", [false, false, false, true, false, false, true]),
    ],
  },
  {
    group: "Support",
    rows: [
      r("Support", ["Community", "In-app chat", "Email, 1 business day", "Dedicated manager", "Integration engineer", "Email + onboarding call", "Dedicated success manager"]),
      r("Uptime SLA", [false, false, "99.5%", "99.9%", "99.5%", "99.5%", "99.9%"]),
      r("Free trial", ["—", "14 days, no card", "14 days, no card", "Pilot on request", "14 days, no card", "14 days, no card", "Paid pilot on request"]),
    ],
  },
];
