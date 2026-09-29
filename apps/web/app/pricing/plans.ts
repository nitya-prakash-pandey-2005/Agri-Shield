/**
 * Agri-SHIELD plan catalogue (spec §12). Pure data — imported by the pricing
 * page, the landing teaser and the billing tRPC router.
 */
export type PlanId = "free" | "farmer_pro" | "gov_basic" | "gov_enterprise" | "supply_chain";
export type BillingInterval = "month" | "year";
export type CurrencyCode = "USD" | "INR" | "BDT" | "VND" | "PHP" | "IDR";
export type Audience = "farmer" | "government" | "supply_chain";

export interface Plan {
  id: PlanId;
  name: string;
  audience: Audience;
  tagline: string;
  /** USD per month; null = custom quote */
  usdMonthly: number | null;
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

/** Full comparison matrix rows: [feature, free, pro, govBasic, govEnt, supply] */
export type Cell = boolean | string;
export const MATRIX: { group: string; rows: [string, Cell, Cell, Cell, Cell, Cell][] }[] = [
  {
    group: "Early warning",
    rows: [
      ["Flood alerts", "24 h", "72 h", "72 h", "72 h", "72 h"],
      ["Saltwater-intrusion alerts", false, true, true, true, true],
      ["Live hazard feed (GDACS · NASA EONET)", true, true, true, true, true],
      ["Alert channels", "App + 5 SMS", "App, SMS, WhatsApp", "Broadcast to farmers", "Broadcast + custom templates", "Email + webhooks"],
    ],
  },
  {
    group: "Intelligence",
    rows: [
      ["Fields / regions", "2 fields · 10 ha", "Unlimited fields", "1 province", "National", "20 supply nodes"],
      ["AI farm advisor", false, "50 / month", false, false, false],
      ["Satellite field scans (NASA MODIS NDVI)", false, "Weekly", "Weekly", "Daily", false],
      ["Commodity risk tracking", false, false, false, false, "10 commodities"],
      ["Scenario modelling", false, false, false, true, true],
      ["Languages", "English", "All 8", "All 8", "All 8", "English"],
    ],
  },
  {
    group: "Operations",
    rows: [
      ["Resource tracking & dispatch", false, false, true, true, false],
      ["Reports", false, false, "Monthly PDF", "On demand", "On demand"],
      ["REST API", false, false, false, true, true],
      ["Signed webhooks", false, false, false, true, true],
      ["Offline PWA + SMS fallback", true, true, true, true, true],
    ],
  },
  {
    group: "Support",
    rows: [
      ["Support", "Community", "In-app chat", "Email, 1 business day", "Dedicated manager", "Integration engineer"],
      ["Uptime SLA", false, false, "99.5%", "99.9%", "99.5%"],
      ["Free trial", "—", "14 days, no card", "14 days, no card", "Pilot on request", "14 days, no card"],
    ],
  },
];
