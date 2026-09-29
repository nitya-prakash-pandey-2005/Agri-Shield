/**
 * Parametric (index) insurance engine.
 *
 *  • Index definitions  — max N-day rainfall (excess rain / flood), seasonal rainfall
 *    total (deficit / drought), peak river discharge (GloFAS), longest dry spell,
 *    heat days (Tmax ≥ X °C).
 *  • Payout curve       — linear between trigger and exit, from `entryPayoutPct` at the
 *    trigger up to `maxPayoutPct` of the sum insured at the exit (capped).
 *  • Backtest           — replays every season since 1991 on ERA5 + GloFAS reanalysis.
 *  • Pricing            — burning cost (mean payout rate), σ, pure premium,
 *    loaded premium = (BC + λσ) / (1 − expense ratio), expected loss ratio.
 *  • Basis-risk check   — compares payouts with an independent damage proxy
 *    (GloFAS peak flow for flood covers, climatic water balance for drought,
 *    mean Tmax for heat) → hits, false negatives (loss but no payout),
 *    false positives (payout but no loss), Spearman agreement.
 *  • Live monitor       — season-to-date index + 51-member ECMWF ensemble for the
 *    next 15 days + the historical climatology for the rest of the season
 *    ("conditional climatology") → probability of payout & expected liability.
 *  • Book view          — annual aggregate losses across all insured plots,
 *    zero-inflated lognormal fit → PML (1-in-100/200/250), reinsurance layer maths.
 */
import { audit, getStore, nextId, type AssetRecord } from "../data/store";
import {
  getHistoryBatch,
  getHistoryMany,
  getRainEnsembleMany,
  getRecentForecastMany,
  gridKey,
  mergeHistoryAndForecast,
  type DailyHistory,
  type HistoryPoint,
} from "../live/history";
import { exposurePriors } from "./location-risk";
import { clamp, empiricalReturnLevel, fitZiln, mean, quantile, spearman, stdev, zilnExceedance, zilnLayerLoss, zilnReturnLevel, type ZilnFit } from "./risk-math";

// ─── Types ────────────────────────────────────────────────────────────────

export type IndexType = "rain_max_nday" | "rain_total" | "discharge_max" | "dry_spell" | "heat_days";
export type Peril = "excess_rain" | "flood" | "drought" | "heat";

export interface Season {
  startMonth: number; // 1-12
  startDay: number;
  endMonth: number;
  endDay: number;
}

export interface ProductSpec {
  indexType: IndexType;
  /** N for rain_max_nday (rolling window, days) */
  windowDays: number;
  /** a day with rain below this (mm) counts as dry (dry_spell) */
  dryDayMm: number;
  /** heat_days threshold °C */
  heatThresholdC: number;
  trigger: number;
  exit: number;
  season: Season;
  /** payout at the trigger (% of sum insured) — 0 = pure linear */
  entryPayoutPct: number;
  /** payout at/after exit (% of sum insured) — the cap */
  maxPayoutPct: number;
  /**
   * "absolute": trigger/exit are fixed index values everywhere.
   * "local": trigger/exit are set per location at its own historical 1-in-N season level
   * (e.g. trigger = local 1-in-5, exit = local 1-in-30) — the usual way to roll one
   * product design across many areas with different climates.
   */
  calibration?: { mode: "absolute" | "local"; triggerRp: number; exitRp: number };
}

/** Resolve a locally-calibrated spec to absolute trigger/exit for one location's history. */
export function resolveSpec(spec: ProductSpec, s: SeriesView & { time: string[] }, lastIdx = s.time.length - 1): ProductSpec {
  if (spec.calibration?.mode !== "local") return spec;
  const idx = seasonSlices(s.time, spec.season, lastIdx)
    .filter((x) => x.complete)
    .map((x) => computeIndex(spec, s, x.i0, x.i1))
    .filter((v): v is number => v != null);
  if (idx.length < 10) return spec;
  const above = INDEX_META[spec.indexType].direction === "above";
  const q = (rp: number) => Math.round(quantile(idx, above ? 1 - 1 / Math.max(1.01, rp) : 1 / Math.max(1.01, rp)) * 10) / 10;
  return { ...spec, trigger: q(spec.calibration.triggerRp), exit: q(spec.calibration.exitRp) };
}

export const INDEX_META: Record<IndexType, { label: string; unit: string; direction: "above" | "below"; peril: Peril; short: string; explain: string }> = {
  rain_max_nday: {
    label: "Cumulative rainfall over N days (excess rain)",
    short: "Max N-day rain",
    unit: "mm",
    direction: "above",
    peril: "excess_rain",
    explain: "The highest total rainfall in any run of N consecutive days inside the cover window. Pays when a very wet spell floods or waterlogs the crop.",
  },
  rain_total: {
    label: "Seasonal rainfall total (deficit)",
    short: "Season rain total",
    unit: "mm",
    direction: "below",
    peril: "drought",
    explain: "Total rainfall across the whole cover window. Pays when the season is too dry — the lower the total, the higher the payout.",
  },
  discharge_max: {
    label: "River discharge above X m³/s (GloFAS)",
    short: "Peak river flow",
    unit: "m³/s",
    direction: "above",
    peril: "flood",
    explain: "The highest daily river flow at the nearest GloFAS river cell during the window. Pays when the river rises above the trigger flow.",
  },
  dry_spell: {
    label: "Consecutive dry days",
    short: "Longest dry spell",
    unit: "days",
    direction: "above",
    peril: "drought",
    explain: "The longest run of consecutive days with less than the dry-day rain threshold. Pays when a dry spell lasts long enough to stress the crop.",
  },
  heat_days: {
    label: "Maximum temperature (days above X °C)",
    short: "Heat days",
    unit: "days",
    direction: "above",
    peril: "heat",
    explain: "Number of days in the window whose maximum temperature reaches the heat threshold. Pays for heat stress at flowering/grain fill.",
  },
};

export interface ParametricProduct {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  spec: ProductSpec;
  status: "draft" | "active" | "archived";
  pricing: { expenseLoadPct: number; riskLoadSigma: number };
  /** reference location used when designing the product */
  reference: { lat: number; lon: number; name: string };
  lastBacktest: { at: Date; years: number; frequencyPct: number; burningCostPct: number; premiumRatePct: number } | null;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
}

// ─── Season slicing ───────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
export const crossesYear = (s: Season) => s.endMonth < s.startMonth || (s.endMonth === s.startMonth && s.endDay < s.startDay);
export const seasonLabel = (s: Season) => {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${s.startDay} ${m[s.startMonth - 1]} – ${s.endDay} ${m[s.endMonth - 1]}`;
};

export interface SeasonSlice {
  year: number; // season labelled by its start year
  start: string;
  end: string;
  i0: number;
  i1: number; // inclusive
  complete: boolean;
}

/** Locate each season window inside a contiguous daily `time` axis. `lastIdx` = last observed index. */
export function seasonSlices(time: string[], s: Season, lastIdx = time.length - 1): SeasonSlice[] {
  if (!time.length) return [];
  const idx = new Map(time.map((t, i) => [t, i]));
  const first = Number(time[0]!.slice(0, 4));
  const last = Number(time[time.length - 1]!.slice(0, 4));
  const out: SeasonSlice[] = [];
  for (let y = first; y <= last; y++) {
    const start = `${y}-${pad(s.startMonth)}-${pad(s.startDay)}`;
    const endY = crossesYear(s) ? y + 1 : y;
    // clamp end day to the month length (e.g. 31 Sep → 30 Sep, 29 Feb in non-leap years)
    const dim = new Date(Date.UTC(endY, s.endMonth, 0)).getUTCDate();
    const end = `${endY}-${pad(s.endMonth)}-${pad(Math.min(s.endDay, dim))}`;
    const i0 = idx.get(start);
    if (i0 == null) continue;
    const i1full = idx.get(end);
    const i1 = i1full ?? time.length - 1;
    out.push({ year: y, start, end, i0, i1, complete: i1full != null && i1full <= lastIdx });
  }
  return out;
}

// ─── Index + payout ───────────────────────────────────────────────────────

export interface SeriesView {
  rain: (number | null)[];
  tmax: (number | null)[];
  discharge: (number | null)[] | null;
}

function tooSparse(a: (number | null)[], i0: number, i1: number) {
  let miss = 0;
  for (let i = i0; i <= i1; i++) if (a[i] == null) miss++;
  return miss > 0.1 * (i1 - i0 + 1);
}

/** Index value for window [i0, i1] (inclusive). null when data are missing. */
export function computeIndex(spec: ProductSpec, s: SeriesView, i0: number, i1: number): number | null {
  if (i1 < i0) return null;
  switch (spec.indexType) {
    case "rain_max_nday": {
      if (tooSparse(s.rain, i0, i1)) return null;
      const n = Math.max(1, Math.round(spec.windowDays));
      let run = 0;
      let best = 0;
      for (let i = i0; i <= i1; i++) {
        run += s.rain[i] ?? 0;
        if (i - i0 >= n) run -= s.rain[i - n] ?? 0;
        best = Math.max(best, run);
      }
      return Math.round(best * 10) / 10;
    }
    case "rain_total": {
      if (tooSparse(s.rain, i0, i1)) return null;
      let t = 0;
      for (let i = i0; i <= i1; i++) t += s.rain[i] ?? 0;
      return Math.round(t * 10) / 10;
    }
    case "discharge_max": {
      if (!s.discharge || tooSparse(s.discharge, i0, i1)) return null;
      let m = 0;
      for (let i = i0; i <= i1; i++) m = Math.max(m, s.discharge[i] ?? 0);
      return Math.round(m * 10) / 10;
    }
    case "dry_spell": {
      if (tooSparse(s.rain, i0, i1)) return null;
      let run = 0;
      let best = 0;
      for (let i = i0; i <= i1; i++) {
        run = (s.rain[i] ?? 0) < spec.dryDayMm ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return best;
    }
    case "heat_days": {
      if (tooSparse(s.tmax, i0, i1)) return null;
      let n = 0;
      for (let i = i0; i <= i1; i++) if ((s.tmax[i] ?? -99) >= spec.heatThresholdC) n++;
      return n;
    }
  }
}

/** Fraction of sum insured paid for an index value (0 … maxPayoutPct/100). */
export function payoutFraction(spec: ProductSpec, index: number | null): number {
  if (index == null || !Number.isFinite(index)) return 0;
  const dir = INDEX_META[spec.indexType].direction;
  const cap = clamp(spec.maxPayoutPct / 100);
  const entry = clamp(spec.entryPayoutPct / 100, 0, cap);
  const { trigger, exit } = spec;
  if (dir === "above") {
    if (index < trigger) return 0;
    if (exit <= trigger || index >= exit) return cap;
    return entry + ((cap - entry) * (index - trigger)) / (exit - trigger);
  }
  if (index > trigger) return 0;
  if (exit >= trigger || index <= exit) return cap;
  return entry + ((cap - entry) * (trigger - index)) / (trigger - exit);
}

export function validateSpec(spec: ProductSpec): string[] {
  const e: string[] = [];
  const dir = INDEX_META[spec.indexType].direction;
  if (spec.calibration?.mode === "local") {
    if (spec.calibration.exitRp <= spec.calibration.triggerRp) e.push("The exit return period must be rarer (larger) than the trigger return period.");
  } else if (dir === "above" && spec.exit <= spec.trigger) e.push("Exit must be above the trigger for this index (payout grows as the index rises).");
  else if (dir === "below" && spec.exit >= spec.trigger) e.push("Exit must be below the trigger for a deficit index (payout grows as rainfall falls).");
  if (spec.maxPayoutPct <= 0 || spec.maxPayoutPct > 100) e.push("Maximum payout must be between 1% and 100% of the sum insured.");
  if (spec.entryPayoutPct > spec.maxPayoutPct) e.push("Payout at trigger cannot exceed the maximum payout.");
  return e;
}

// ─── Damage proxy (independent of the index) for basis risk ──────────────

export interface ProxyYear {
  year: number;
  magnitude: number | null;
  /** oriented so that larger = worse */
  severity: number | null;
  event: boolean;
}

export interface ProxyInfo {
  name: string;
  unit: string;
  rule: string;
  years: ProxyYear[];
}

/**
 * Independent damage proxy per season:
 *  • flood / excess rain → GloFAS peak discharge in the window (if the river cell carries > 5 m³/s),
 *    otherwise the wettest 10-day ERA5 rainfall. Event = among the worst `1/returnPeriod` of seasons.
 *  • drought → climatic water balance Σ(rain − ET0) over the window (lowest = worst).
 *  • heat → mean daily Tmax over the window (highest = worst).
 * `lossYears` (e.g. the insurer's own claims history) overrides the proxy events.
 */
export function damageProxy(
  spec: ProductSpec,
  h: { rain: (number | null)[]; tmax: (number | null)[]; et0: (number | null)[]; discharge: (number | null)[] | null },
  slices: SeasonSlice[],
  opts: { returnPeriod?: number; lossYears?: number[] } = {}
): ProxyInfo {
  const peril = INDEX_META[spec.indexType].peril;
  const rp = Math.max(2, opts.returnPeriod ?? 5);
  let name: string;
  let unit: string;
  let worseHigh = true;
  let mag: (sl: SeasonSlice) => number | null;
  const dis = h.discharge;
  const disUsable = !!dis && Math.max(...dis.map((v) => v ?? 0)) > 5;
  if (peril === "flood" || peril === "excess_rain") {
    if (disUsable) {
      name = "GloFAS peak river discharge in window";
      unit = "m³/s";
      mag = (sl) => computeIndex({ ...spec, indexType: "discharge_max" }, { rain: h.rain, tmax: h.tmax, discharge: dis }, sl.i0, sl.i1);
    } else {
      name = "Wettest 10-day ERA5 rainfall in window";
      unit = "mm";
      mag = (sl) => computeIndex({ ...spec, indexType: "rain_max_nday", windowDays: 10 }, { rain: h.rain, tmax: h.tmax, discharge: null }, sl.i0, sl.i1);
    }
  } else if (peril === "drought") {
    name = "Climatic water balance Σ(rain − ET0) in window";
    unit = "mm";
    worseHigh = false;
    mag = (sl) => {
      if (tooSparse(h.rain, sl.i0, sl.i1) || tooSparse(h.et0, sl.i0, sl.i1)) return null;
      let wb = 0;
      for (let i = sl.i0; i <= sl.i1; i++) wb += (h.rain[i] ?? 0) - (h.et0[i] ?? 0);
      return Math.round(wb);
    };
  } else {
    name = "Mean daily max temperature in window";
    unit = "°C";
    mag = (sl) => {
      if (tooSparse(h.tmax, sl.i0, sl.i1)) return null;
      const v: number[] = [];
      for (let i = sl.i0; i <= sl.i1; i++) if (h.tmax[i] != null) v.push(h.tmax[i]!);
      return Math.round(mean(v) * 10) / 10;
    };
  }
  const years = slices.map((sl) => {
    const m = mag(sl);
    return { year: sl.year, magnitude: m, severity: m == null ? null : worseHigh ? m : -m, event: false };
  });
  const sev = years.map((y) => y.severity).filter((v): v is number => v != null);
  const thr = quantile(sev, 1 - 1 / rp);
  const lossSet = opts.lossYears?.length ? new Set(opts.lossYears) : null;
  for (const y of years) y.event = lossSet ? lossSet.has(y.year) : y.severity != null && y.severity >= thr;
  const rule = lossSet
    ? `Loss years supplied by you (${[...lossSet].sort().join(", ")})`
    : `Worst 1-in-${rp} seasons by ${name} (${worseHigh ? "≥" : "≤"} ${Math.round(worseHigh ? thr : -thr).toLocaleString("en-US")} ${unit})`;
  return { name, unit, rule, years };
}

export interface BasisRisk {
  hits: number[];
  falseNegatives: number[]; // loss proxy but no payout — the farmer's basis risk
  falsePositives: number[]; // payout without loss — the insurer's basis risk
  correctNegatives: number;
  basisRiskPct: number; // (FN + FP) / N
  detectionPct: number | null; // hits / (hits + FN)
  falseAlarmPct: number | null; // FP / (hits + FP)
  spearman: number | null; // agreement between index severity and proxy severity
  verdict: "low" | "moderate" | "high";
}

export function basisRisk(years: { year: number; payoutFraction: number; index: number | null }[], proxy: ProxyYear[], direction: "above" | "below"): BasisRisk {
  const pm = new Map(proxy.map((p) => [p.year, p]));
  const hits: number[] = [];
  const fn: number[] = [];
  const fp: number[] = [];
  let cn = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const y of years) {
    const p = pm.get(y.year);
    if (!p || y.index == null) continue;
    const paid = y.payoutFraction > 0;
    if (paid && p.event) hits.push(y.year);
    else if (!paid && p.event) fn.push(y.year);
    else if (paid && !p.event) fp.push(y.year);
    else cn++;
    if (p.severity != null) {
      xs.push(direction === "above" ? y.index : -y.index);
      ys.push(p.severity);
    }
  }
  const n = hits.length + fn.length + fp.length + cn;
  const rho = spearman(xs, ys);
  const br = n ? ((fn.length + fp.length) / n) * 100 : 0;
  const det = hits.length + fn.length ? (hits.length / (hits.length + fn.length)) * 100 : null;
  return {
    hits,
    falseNegatives: fn,
    falsePositives: fp,
    correctNegatives: cn,
    basisRiskPct: Math.round(br * 10) / 10,
    detectionPct: det == null ? null : Math.round(det),
    falseAlarmPct: hits.length + fp.length ? Math.round((fp.length / (hits.length + fp.length)) * 100) : null,
    spearman: Number.isFinite(rho) ? Math.round(rho * 100) / 100 : null,
    // Farmer-side misses (false negatives) matter most; unpaid-loss years erode trust in the product
    verdict: (det != null && det < 60) || br > 40 ? "high" : (det != null && det < 80) || br > 25 ? "moderate" : "low",
  };
}

// ─── Pricing ──────────────────────────────────────────────────────────────

export interface Pricing {
  years: number;
  payoutYears: number;
  frequencyPct: number;
  burningCostPct: number; // mean payout as % of SI
  stdevPct: number;
  purePremiumUsd: number;
  riskLoadUsd: number;
  loadedPremiumUsd: number;
  premiumRatePct: number;
  expectedLossRatioPct: number;
  worstYear: { year: number; payoutPct: number } | null;
  oneIn10Pct: number | null;
  oneIn20Pct: number | null;
}

/**
 * Loaded premium = (BC + λ·σ) / (1 − e) × SI
 *   BC = burning cost (mean annual payout rate), σ = std-dev of the annual payout rate,
 *   λ = risk-load multiple (capital / volatility charge), e = expense + commission ratio.
 */
export function pricing(years: { year: number; payoutFraction: number }[], sumInsured: number, load: { expenseLoadPct: number; riskLoadSigma: number }): Pricing {
  const f = years.map((y) => y.payoutFraction);
  const bc = mean(f);
  const sd = stdev(f);
  const e = clamp(load.expenseLoadPct / 100, 0, 0.9);
  const rate = (bc + load.riskLoadSigma * sd) / (1 - e);
  const worst = years.reduce<{ year: number; payoutFraction: number } | null>((w, y) => (!w || y.payoutFraction > w.payoutFraction ? y : w), null);
  const r10 = empiricalReturnLevel(f, 10);
  const r20 = empiricalReturnLevel(f, 20);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    years: f.length,
    payoutYears: f.filter((v) => v > 0).length,
    frequencyPct: f.length ? r((f.filter((v) => v > 0).length / f.length) * 100) : 0,
    burningCostPct: r(bc * 100),
    stdevPct: r(sd * 100),
    purePremiumUsd: Math.round(bc * sumInsured),
    riskLoadUsd: Math.round(load.riskLoadSigma * sd * sumInsured),
    loadedPremiumUsd: Math.round(rate * sumInsured),
    premiumRatePct: r(rate * 100),
    expectedLossRatioPct: rate > 0 ? r((bc / rate) * 100) : 0,
    worstYear: worst && worst.payoutFraction > 0 ? { year: worst.year, payoutPct: r(worst.payoutFraction * 100) } : null,
    oneIn10Pct: r10 == null ? null : r(r10 * 100),
    oneIn20Pct: r20 == null ? null : r(r20 * 100),
  };
}

// ─── Backtest ─────────────────────────────────────────────────────────────

export interface BacktestYear {
  year: number;
  index: number | null;
  payoutFraction: number;
  payoutUsd: number;
  lossRatioPct: number | null;
  proxy: number | null;
  proxyEvent: boolean;
}

export interface LocationBacktest {
  location: { lat: number; lon: number; name: string; sumInsuredUsd: number };
  cells: { era5: { lat: number; lon: number } | null; glofas: { lat: number; lon: number } | null };
  dataSource: DailyHistory["source"];
  provider: DailyHistory["provider"];
  /** trigger/exit actually applied at this location (after local calibration) */
  applied: { trigger: number; exit: number };
  years: BacktestYear[];
  pricing: Pricing;
  basis: BasisRisk;
  proxy: { name: string; unit: string; rule: string };
  /** distribution of the index across all years — helps pick trigger/exit */
  indexStats: { p10: number; p50: number; p80: number; p90: number; p95: number; max: number; min: number };
  /** daily discharge climatology for discharge covers */
  dischargeStats: { p50: number; p95: number; p99: number } | null;
}

export function backtestSeries(
  spec: ProductSpec,
  h: DailyHistory,
  opts: { sumInsuredUsd: number; startYear: number; expenseLoadPct: number; riskLoadSigma: number; proxyReturnPeriod?: number; lossYears?: number[]; name: string }
): LocationBacktest {
  // last index with non-null ERA5 rain
  let last = h.rain.length - 1;
  while (last > 0 && h.rain[last] == null) last--;
  spec = resolveSpec(spec, h, last);
  const slices = seasonSlices(h.time, spec.season, last).filter((s) => s.complete && s.year >= opts.startYear);
  const view: SeriesView = { rain: h.rain, tmax: h.tmax, discharge: h.discharge };
  const raw = slices.map((sl) => {
    const index = computeIndex(spec, view, sl.i0, sl.i1);
    return { year: sl.year, index, payoutFraction: payoutFraction(spec, index) };
  });
  const valid = raw.filter((r) => r.index != null);
  const pr = pricing(valid, opts.sumInsuredUsd, opts);
  const proxy = damageProxy(spec, h, slices, { returnPeriod: opts.proxyReturnPeriod, lossYears: opts.lossYears });
  const pm = new Map(proxy.years.map((p) => [p.year, p]));
  const premium = pr.loadedPremiumUsd;
  const years: BacktestYear[] = raw.map((r) => ({
    year: r.year,
    index: r.index,
    payoutFraction: Math.round(r.payoutFraction * 10000) / 10000,
    payoutUsd: Math.round(r.payoutFraction * opts.sumInsuredUsd),
    lossRatioPct: premium > 0 ? Math.round(((r.payoutFraction * opts.sumInsuredUsd) / premium) * 1000) / 10 : null,
    proxy: pm.get(r.year)?.magnitude ?? null,
    proxyEvent: pm.get(r.year)?.event ?? false,
  }));
  const idx = valid.map((v) => v.index!) as number[];
  const q = (p: number) => Math.round(quantile(idx, p) * 10) / 10;
  let dischargeStats: LocationBacktest["dischargeStats"] = null;
  if (h.discharge) {
    const d = h.discharge.filter((v): v is number => v != null);
    if (d.length) dischargeStats = { p50: Math.round(quantile(d, 0.5) * 10) / 10, p95: Math.round(quantile(d, 0.95) * 10) / 10, p99: Math.round(quantile(d, 0.99) * 10) / 10 };
  }
  return {
    location: { lat: h.lat, lon: h.lon, name: opts.name, sumInsuredUsd: opts.sumInsuredUsd },
    cells: { era5: h.era5Cell, glofas: h.glofasCell },
    dataSource: h.source,
    provider: h.provider,
    applied: { trigger: spec.trigger, exit: spec.exit },
    years,
    pricing: pr,
    basis: basisRisk(valid, proxy.years, INDEX_META[spec.indexType].direction),
    proxy: { name: proxy.name, unit: proxy.unit, rule: proxy.rule },
    indexStats: idx.length ? { p10: q(0.1), p50: q(0.5), p80: q(0.8), p90: q(0.9), p95: q(0.95), max: Math.max(...idx), min: Math.min(...idx) } : { p10: 0, p50: 0, p80: 0, p90: 0, p95: 0, max: 0, min: 0 },
    dischargeStats,
  };
}

export async function backtestProduct(
  spec: ProductSpec,
  locations: { lat: number; lon: number; name: string; sumInsuredUsd: number }[],
  opts: { startYear: number; expenseLoadPct: number; riskLoadSigma: number; proxyReturnPeriod?: number; lossYears?: number[] }
) {
  const hist = await getHistoryMany(locations);
  const results: LocationBacktest[] = [];
  const missing: string[] = [];
  for (const loc of locations) {
    const h = hist.get(gridKey(loc));
    if (!h) {
      missing.push(loc.name);
      continue;
    }
    results.push(backtestSeries(spec, h, { ...opts, sumInsuredUsd: loc.sumInsuredUsd, name: loc.name }));
  }
  // Aggregate across locations (same seasons)
  const yearSet = new Map<number, { payout: number; si: number }>();
  for (const r of results)
    for (const y of r.years) {
      const cur = yearSet.get(y.year) ?? { payout: 0, si: 0 };
      cur.payout += y.payoutUsd;
      cur.si += r.location.sumInsuredUsd;
      yearSet.set(y.year, cur);
    }
  const totalSi = results.reduce((t, r) => t + r.location.sumInsuredUsd, 0);
  const aggYears = [...yearSet.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, payoutUsd: v.payout, payoutFraction: totalSi ? v.payout / totalSi : 0 }));
  const aggPricing = pricing(aggYears, totalSi, opts);
  return { results, missing, aggregate: { totalSumInsuredUsd: totalSi, years: aggYears, pricing: aggPricing }, spec, meta: INDEX_META[spec.indexType], seasonLabel: seasonLabel(spec.season) };
}

// ─── Product store (per workspace) ────────────────────────────────────────

const g = globalThis as unknown as { __agriParametric?: ParametricProduct[] };

function seedProducts(): ParametricProduct[] {
  const now = new Date();
  const d = (days: number) => new Date(now.getTime() - days * 86_400_000);
  return [
    {
      id: "pp_aman_xsrain",
      workspaceId: "org-ins-deltamutual",
      name: "Aman Excess-Rain Cover (5-day)",
      description: "Pays when the wettest 5-day spell of the Aman transplanting/tillering window (Jul–Sep) exceeds the plot area's own 1-in-7-year level; full payout at the local 1-in-50-year level.",
      spec: { indexType: "rain_max_nday", windowDays: 5, dryDayMm: 1, heatThresholdC: 35, trigger: 200, exit: 400, season: { startMonth: 7, startDay: 1, endMonth: 9, endDay: 30 }, entryPayoutPct: 0, maxPayoutPct: 100, calibration: { mode: "local", triggerRp: 7, exitRp: 50 } },
      status: "active",
      pricing: { expenseLoadPct: 25, riskLoadSigma: 0.3 },
      reference: { lat: 22.7185, lon: 89.0705, name: "Satkhira" },
      lastBacktest: null,
      createdAt: d(120),
      createdBy: "user-insurer-demo",
      updatedAt: d(20),
    },
    {
      id: "pp_kharif_deficit",
      workspaceId: "org-ins-deltamutual",
      name: "Kharif Rainfall-Deficit Cover",
      description: "Pays when mid-Jun–Sep monsoon rainfall falls to the area's 1-in-7-year dry level (5 % payout), rising to 100 % at a 1-in-50-year monsoon failure.",
      spec: { indexType: "rain_total", windowDays: 5, dryDayMm: 1, heatThresholdC: 35, trigger: 800, exit: 400, season: { startMonth: 6, startDay: 15, endMonth: 9, endDay: 30 }, entryPayoutPct: 5, maxPayoutPct: 100, calibration: { mode: "local", triggerRp: 7, exitRp: 50 } },
      status: "active",
      pricing: { expenseLoadPct: 25, riskLoadSigma: 0.3 },
      reference: { lat: 20.3, lon: 86.4, name: "Odisha coast" },
      lastBacktest: null,
      createdAt: d(90),
      createdBy: "user-insurer-demo",
      updatedAt: d(30),
    },
  ];
}

function products(): ParametricProduct[] {
  if (!g.__agriParametric) {
    g.__agriParametric = seedProducts();
    // Attach the seeded covers to the weather-index plots (BD → excess rain, IN → deficit)
    for (const a of getStore().assets) {
      if (a.workspaceId !== "org-ins-deltamutual" || a.type !== "insured_plot" || a.meta.parametricProductId) continue;
      if (!String(a.meta.product ?? "").startsWith("Weather")) continue;
      a.meta.parametricProductId = a.country === "India" ? "pp_kharif_deficit" : "pp_aman_xsrain";
    }
  }
  return g.__agriParametric;
}

export function listProducts(workspaceId: string) {
  const assets = getStore().assets.filter((a) => a.workspaceId === workspaceId && a.status === "active");
  return products()
    .filter((p) => p.workspaceId === workspaceId && p.status !== "archived")
    .map((p) => {
      const att = assets.filter((a) => a.meta.parametricProductId === p.id);
      return { ...p, attachedCount: att.length, attachedSumInsuredUsd: att.reduce((t, a) => t + a.valueUsd, 0) };
    });
}

export function getProduct(workspaceId: string, id: string) {
  return products().find((p) => p.id === id && p.workspaceId === workspaceId) ?? null;
}

export function saveProduct(
  workspaceId: string,
  user: { id: string; name: string },
  input: { id?: string; name: string; description: string; spec: ProductSpec; status: "draft" | "active"; pricing: ParametricProduct["pricing"]; reference: ParametricProduct["reference"]; lastBacktest?: ParametricProduct["lastBacktest"] }
): ParametricProduct {
  const list = products();
  const now = new Date();
  const existing = input.id ? list.find((p) => p.id === input.id && p.workspaceId === workspaceId) : undefined;
  if (existing) {
    Object.assign(existing, { name: input.name, description: input.description, spec: input.spec, status: input.status, pricing: input.pricing, reference: input.reference, updatedAt: now });
    if (input.lastBacktest) existing.lastBacktest = input.lastBacktest;
    audit({ userId: user.id, userName: user.name, action: "update", entity: "parametric_product", entityId: existing.id, details: `Updated ${existing.name}` });
    return existing;
  }
  const p: ParametricProduct = { id: nextId("pp"), workspaceId, ...input, lastBacktest: input.lastBacktest ?? null, createdAt: now, createdBy: user.id, updatedAt: now };
  list.push(p);
  audit({ userId: user.id, userName: user.name, action: "create", entity: "parametric_product", entityId: p.id, details: `Created ${p.name}` });
  return p;
}

export function archiveProduct(workspaceId: string, id: string, user: { id: string; name: string }) {
  const p = getProduct(workspaceId, id);
  if (!p) return null;
  p.status = "archived";
  for (const a of getStore().assets) if (a.workspaceId === workspaceId && a.meta.parametricProductId === id) a.meta.parametricProductId = null;
  audit({ userId: user.id, userName: user.name, action: "archive", entity: "parametric_product", entityId: id, details: `Archived ${p.name}` });
  return p;
}

/** Attach (or detach) a product to insured plots — tags them "parametric". */
export function attachProduct(workspaceId: string, productId: string | null, assetIds: string[], user: { id: string; name: string }) {
  if (productId && !getProduct(workspaceId, productId)) throw new Error("Product not found");
  const ids = new Set(assetIds);
  let n = 0;
  for (const a of getStore().assets) {
    if (a.workspaceId !== workspaceId || !ids.has(a.id)) continue;
    a.meta.parametricProductId = productId;
    const tags = new Set(a.tags);
    if (productId) {
      tags.add("parametric");
      tags.delete("indemnity");
    } else tags.delete("parametric");
    a.tags = [...tags];
    n++;
  }
  audit({ userId: user.id, userName: user.name, action: productId ? "attach" : "detach", entity: "parametric_product", entityId: productId ?? "-", details: `${n} insured plots` });
  bookCacheBust(workspaceId);
  return n;
}

// ─── Indemnity damage-function proxy for non-parametric plots ────────────

/** Aman season window used for indemnity / area-yield policies in the book view. */
export const INDEMNITY_SEASON: Season = { startMonth: 7, startDay: 1, endMonth: 11, endDay: 30 };

/**
 * Modelled crop-loss ratio for a season (ERA5 damage functions, documented in-UI):
 *   flood/waterlogging: 5-day rain 220 → 520 mm ⇒ 0 → 60 % loss
 *   drought: water balance Σ(P−ET0) −200 → −600 mm ⇒ 0 → 50 % loss
 *   heat: days ≥ 38 °C 3 → 15 ⇒ 0 → 30 % loss
 *   combined = 1 − Π(1 − component); indemnity = max(0, loss − deductible)
 */
export function indemnityLoss(h: SeriesView & { et0: (number | null)[] }, sl: SeasonSlice, deductiblePct: number) {
  const rx5 = computeIndex({ ...DEFAULT_SPEC, indexType: "rain_max_nday", windowDays: 5 }, h, sl.i0, sl.i1) ?? 0;
  let wb = 0;
  for (let i = sl.i0; i <= sl.i1; i++) wb += (h.rain[i] ?? 0) - (h.et0[i] ?? 0);
  let hot = 0;
  for (let i = sl.i0; i <= sl.i1; i++) if ((h.tmax[i] ?? 0) >= 38) hot++;
  const flood = clamp((rx5 - 220) / 300) * 0.6;
  const drought = clamp((-wb - 200) / 400) * 0.5;
  const heat = clamp((hot - 3) / 12) * 0.3;
  const loss = 1 - (1 - flood) * (1 - drought) * (1 - heat);
  return { loss, paid: Math.max(0, loss - deductiblePct / 100), components: { flood, drought, heat } };
}

export const DEFAULT_SPEC: ProductSpec = {
  indexType: "rain_max_nday",
  windowDays: 5,
  dryDayMm: 1,
  heatThresholdC: 35,
  trigger: 150,
  exit: 350,
  season: { startMonth: 7, startDay: 1, endMonth: 9, endDay: 30 },
  entryPayoutPct: 0,
  maxPayoutPct: 100,
};

// ─── Book (portfolio) view ────────────────────────────────────────────────

/** Snap to 0.25° (ERA5 native grid) so the book needs one history fetch per cell. */
export const cell25 = (p: HistoryPoint) => ({ lat: Math.round(p.lat * 4) / 4, lon: Math.round(p.lon * 4) / 4 });

/**
 * Reference point for book-level analytics: the nearest monitored district centroid
 * (within 50 km) - the equivalent of a reference weather station for an area index -
 * otherwise the 0.25 deg ERA5 cell. Keeps the number of 35-year histories small.
 */
export function refPoint(p: HistoryPoint): HistoryPoint {
  const pri = exposurePriors(p.lat, p.lon);
  if (pri.district && (pri.km ?? 999) <= 50) return { lat: pri.district.lat, lon: pri.district.lon };
  return cell25(p);
}

const gb = globalThis as unknown as { __agriBook?: Map<string, { at: number; v: Promise<BookResult>; ttl: number }> };
const bookCache = (gb.__agriBook ??= new Map());
function bookCacheBust(ws: string) {
  bookCache.delete(ws);
}

export interface BookPlot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  district: string;
  country: string;
  crop: string | null;
  sumInsuredUsd: number;
  premiumUsd: number;
  peril: string;
  productId: string | null;
  productName: string;
  expectedLossUsd: number;
  worstLossUsd: number;
}

export interface BookResult {
  generatedAt: string;
  startYear: number;
  plots: BookPlot[];
  annual: { year: number; lossUsd: number; parametricUsd: number; indemnityUsd: number }[];
  totals: { sumInsuredUsd: number; premiumUsd: number; expectedLossUsd: number; expectedLossRatioPct: number; plots: number; modelledPlots: number };
  fit: ZilnFit;
  pml: { T: number; lossUsd: number; pctOfSi: number }[];
  empiricalWorst: { year: number; lossUsd: number } | null;
  byPeril: { peril: string; sumInsuredUsd: number; expectedLossUsd: number; plots: number }[];
  byRegion: { region: string; country: string; sumInsuredUsd: number; expectedLossUsd: number; plots: number; lat: number; lon: number }[];
  cells: { lat: number; lon: number; sumInsuredUsd: number; expectedLossUsd: number; plots: number; lossRatePct: number }[];
  missingCells: number;
  /** reference locations still downloading (free-tier rate limits) - poll again */
  pending: number;
  refLocations: number;
  providers: string[];
}

export async function bookBacktest(workspaceId: string, startYear = 1995): Promise<BookResult> {
  const hit = bookCache.get(workspaceId);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.v;
  const v = computeBook(workspaceId, startYear).catch((e) => {
    bookCache.delete(workspaceId);
    throw e;
  });
  const entry = { at: Date.now(), v, ttl: 60 * 60_000 };
  bookCache.set(workspaceId, entry);
  // incomplete results (histories still downloading) are only cached briefly
  void v.then((r) => r.pending > 0 && (entry.ttl = 10_000)).catch(() => undefined);
  return v;
}

async function computeBook(workspaceId: string, startYear: number): Promise<BookResult> {
  const s = getStore();
  const plots = s.assets.filter((a) => a.workspaceId === workspaceId && a.status === "active" && a.type === "insured_plot");
  const prods = new Map(products().filter((p) => p.workspaceId === workspaceId && p.status !== "archived").map((p) => [p.id, p]));
  const cells = new Map<string, HistoryPoint>();
  for (const a of plots) {
    const c = refPoint(a);
    cells.set(gridKey(c), c);
  }
  const batch = await getHistoryBatch([...cells.values()], { mode: "partial", budgetMs: 25_000 });
  const hist = batch.map;
  const distName = new Map(s.districts.map((d) => [d.id, d]));
  const annual = new Map<number, { lossUsd: number; parametricUsd: number; indemnityUsd: number }>();
  const outPlots: BookPlot[] = [];
  let missingCells = 0;
  const seenMissing = new Set<string>();
  const specCache = new Map<string, ProductSpec>();
  for (const a of plots) {
    const key = gridKey(refPoint(a));
    const h = hist.get(key);
    const product = a.meta.parametricProductId ? prods.get(String(a.meta.parametricProductId)) : undefined;
    const d = a.districtId ? distName.get(a.districtId) : undefined;
    const base: Omit<BookPlot, "expectedLossUsd" | "worstLossUsd"> = {
      id: a.id,
      name: a.name,
      lat: a.lat,
      lon: a.lon,
      district: d?.name ?? a.address ?? "—",
      country: a.country,
      crop: a.crop,
      sumInsuredUsd: a.valueUsd,
      premiumUsd: Number(a.meta.premiumUsd ?? 0),
      peril: product ? INDEX_META[product.spec.indexType].peril : "multi-peril",
      productId: product?.id ?? null,
      productName: product?.name ?? String(a.meta.product ?? "Indemnity"),
    };
    if (!h) {
      if (!seenMissing.has(key)) {
        seenMissing.add(key);
        missingCells++;
      }
      outPlots.push({ ...base, expectedLossUsd: 0, worstLossUsd: 0 });
      continue;
    }
    let last = h.rain.length - 1;
    while (last > 0 && h.rain[last] == null) last--;
    const season = product ? product.spec.season : INDEMNITY_SEASON;
    const slices = seasonSlices(h.time, season, last).filter((x) => x.complete && x.year >= startYear);
    const losses: number[] = [];
    const pspec = product ? (specCache.get(`${product.id}|${key}`) ?? specCache.set(`${product.id}|${key}`, resolveSpec(product.spec, h, last)).get(`${product.id}|${key}`)!) : null;
    for (const sl of slices) {
      const loss = pspec
        ? payoutFraction(pspec, computeIndex(pspec, h, sl.i0, sl.i1)) * a.valueUsd
        : indemnityLoss(h, sl, Number(a.meta.deductiblePct ?? 0)).paid * a.valueUsd;
      losses.push(loss);
      const cur = annual.get(sl.year) ?? { lossUsd: 0, parametricUsd: 0, indemnityUsd: 0 };
      cur.lossUsd += loss;
      if (product) cur.parametricUsd += loss;
      else cur.indemnityUsd += loss;
      annual.set(sl.year, cur);
    }
    outPlots.push({ ...base, expectedLossUsd: Math.round(mean(losses)), worstLossUsd: Math.round(Math.max(0, ...losses)) });
  }
  const annualArr = [...annual.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, lossUsd: Math.round(v.lossUsd), parametricUsd: Math.round(v.parametricUsd), indemnityUsd: Math.round(v.indemnityUsd) }));
  const totalSi = plots.reduce((t, a) => t + a.valueUsd, 0);
  const premium = plots.reduce((t, a) => t + Number(a.meta.premiumUsd ?? 0), 0);
  const fit = fitZiln(annualArr.map((y) => y.lossUsd), totalSi);
  const el = mean(annualArr.map((y) => y.lossUsd));
  const worst = annualArr.reduce<{ year: number; lossUsd: number } | null>((w, y) => (!w || y.lossUsd > w.lossUsd ? { year: y.year, lossUsd: y.lossUsd } : w), null);
  const group = <K extends string>(keyOf: (p: BookPlot) => K) => {
    const m = new Map<K, BookPlot[]>();
    for (const p of outPlots) m.set(keyOf(p), [...(m.get(keyOf(p)) ?? []), p]);
    return m;
  };
  const byPeril = [...group((p) => p.peril)].map(([peril, ps]) => ({ peril, plots: ps.length, sumInsuredUsd: ps.reduce((t, p) => t + p.sumInsuredUsd, 0), expectedLossUsd: ps.reduce((t, p) => t + p.expectedLossUsd, 0) }));
  const byRegion = [...group((p) => `${p.district}|${p.country}`)]
    .map(([k, ps]) => ({ region: k.split("|")[0]!, country: k.split("|")[1]!, plots: ps.length, sumInsuredUsd: ps.reduce((t, p) => t + p.sumInsuredUsd, 0), expectedLossUsd: ps.reduce((t, p) => t + p.expectedLossUsd, 0), lat: mean(ps.map((p) => p.lat)), lon: mean(ps.map((p) => p.lon)) }))
    .sort((a, b) => b.sumInsuredUsd - a.sumInsuredUsd);
  const cellArr = [...group((p) => gridKey(cell25(p)))].map(([k, ps]) => {
    const [lat, lon] = k.split(",").map(Number) as [number, number];
    const si = ps.reduce((t, p) => t + p.sumInsuredUsd, 0);
    const elc = ps.reduce((t, p) => t + p.expectedLossUsd, 0);
    return { lat, lon, plots: ps.length, sumInsuredUsd: si, expectedLossUsd: elc, lossRatePct: si ? Math.round((elc / si) * 1000) / 10 : 0 };
  });
  return {
    generatedAt: new Date().toISOString(),
    startYear,
    plots: outPlots,
    annual: annualArr,
    totals: { sumInsuredUsd: totalSi, premiumUsd: premium, expectedLossUsd: Math.round(el), expectedLossRatioPct: premium ? Math.round((el / premium) * 1000) / 10 : 0, plots: plots.length, modelledPlots: outPlots.filter((p) => hist.has(gridKey(refPoint(p)))).length },
    fit,
    pml: [10, 25, 50, 100, 200, 250].map((T) => {
      const l = zilnReturnLevel(fit, T);
      return { T, lossUsd: Math.round(l), pctOfSi: totalSi ? Math.round((l / totalSi) * 1000) / 10 : 0 };
    }),
    empiricalWorst: worst,
    byPeril,
    byRegion,
    cells: cellArr,
    missingCells,
    pending: batch.pending,
    refLocations: batch.total,
    providers: batch.providers,
  };
}

/** Excess-of-loss layer helper on the fitted annual aggregate loss distribution. */
export function reinsuranceLayer(fit: ZilnFit, attachmentUsd: number, limitUsd: number, loadingMultiple = 1.8) {
  const el = zilnLayerLoss(fit, attachmentUsd, limitUsd);
  const pAttach = zilnExceedance(fit, attachmentUsd);
  const pExhaust = zilnExceedance(fit, attachmentUsd + limitUsd);
  const rol = limitUsd > 0 ? (el * loadingMultiple) / limitUsd : 0;
  return {
    expectedLayerLossUsd: Math.round(el),
    attachProbPct: Math.round(pAttach * 1000) / 10,
    exhaustProbPct: Math.round(pExhaust * 1000) / 10,
    attachReturnPeriod: pAttach > 0 ? Math.round(1 / pAttach) : null,
    indicativePremiumUsd: Math.round(el * loadingMultiple),
    rateOnLinePct: Math.round(rol * 1000) / 10,
  };
}

// ─── Live trigger monitor ─────────────────────────────────────────────────

export interface SeasonOutlook {
  status: "upcoming" | "in_season" | "closed";
  seasonYear: number;
  windowStart: string;
  windowEnd: string;
  daysElapsed: number;
  daysTotal: number;
  indexToDate: number | null;
  indexWithForecast: number | null;
  probabilityPct: number;
  expectedPayoutFraction: number;
  p90PayoutFraction: number;
  scenarios: number;
  forecastModel: string;
  /** daily series for the chart: observed + forecast (deterministic) */
  series: { date: string; value: number | null; kind: "observed" | "forecast" }[];
}

/**
 * Probability of payout for the current season by conditional climatology:
 * observed days so far ⊕ each forecast member for the next ≤15 days ⊕ each
 * historical year's weather for the remainder of the window. Every
 * (member × year) combination is one scenario; P(payout) = share of scenarios paying.
 */
export function seasonOutlook(
  spec: ProductSpec,
  merged: ReturnType<typeof mergeHistoryAndForecast>,
  ensemble: { time: string[]; members: number[][]; model: string } | undefined,
  startYear = 1991,
  today = new Date().toISOString().slice(0, 10)
): SeasonOutlook | null {
  const { time } = merged;
  const view: SeriesView = { rain: merged.rain, tmax: merged.tmax, discharge: merged.discharge };
  const allSlices = seasonSlices(time, spec.season, time.length - 1);
  // current season = the one containing today, else the next upcoming, else the last one
  const ty = Number(today.slice(0, 4));
  const cand = [ty - 1, ty].map((y) => {
    const st = `${y}-${pad(spec.season.startMonth)}-${pad(spec.season.startDay)}`;
    const endY = crossesYear(spec.season) ? y + 1 : y;
    const dim = new Date(Date.UTC(endY, spec.season.endMonth, 0)).getUTCDate();
    return { y, st, en: `${endY}-${pad(spec.season.endMonth)}-${pad(Math.min(spec.season.endDay, dim))}` };
  });
  const cur = cand.find((c) => c.st <= today && today <= c.en) ?? cand.find((c) => c.st > today) ?? cand[cand.length - 1]!;
  const status: SeasonOutlook["status"] = today < cur.st ? "upcoming" : today > cur.en ? "closed" : "in_season";
  const dayMs = 86_400_000;
  const L = Math.round((Date.parse(cur.en) - Date.parse(cur.st)) / dayMs) + 1;
  const dates = Array.from({ length: L }, (_, d) => new Date(Date.parse(cur.st) + d * dayMs).toISOString().slice(0, 10));
  const tIdx = new Map(time.map((t, i) => [t, i]));
  const todayI = dates.indexOf(today);
  const obsEnd = status === "closed" ? L - 1 : status === "upcoming" ? -1 : todayI - 1; // last observed day in window

  // climatology slices (complete seasons, same window)
  const clim = allSlices.filter((s) => s.complete && s.year >= startYear && s.year !== cur.y);
  if (!clim.length) return null;
  const pick = (arr: (number | null)[] | null, date: string) => {
    const i = tIdx.get(date);
    return arr && i != null ? (arr[i] ?? null) : null;
  };
  const obsRain = dates.map((d, k) => (k <= obsEnd ? pick(view.rain, d) : null));
  const obsTmax = dates.map((d, k) => (k <= obsEnd ? pick(view.tmax, d) : null));
  const obsDis = dates.map((d, k) => (k <= obsEnd ? pick(view.discharge, d) : null));
  // deterministic forecast (merged series beyond today)
  const fcRain = dates.map((d, k) => (k > obsEnd ? pick(view.rain, d) : null));
  const fcTmax = dates.map((d, k) => (k > obsEnd ? pick(view.tmax, d) : null));
  const fcDis = dates.map((d, k) => (k > obsEnd ? pick(view.discharge, d) : null));

  const ensIdx = ensemble ? new Map(ensemble.time.map((t, i) => [t, i])) : null;
  const members: ((number | null)[] | null)[] = ensemble && ensemble.members.length ? ensemble.members.map((m) => dates.map((d, k) => (k > obsEnd && ensIdx!.has(d) ? m[ensIdx!.get(d)!]! : null))) : [null];

  const fr: number[] = [];
  const rainW = new Array<number | null>(L);
  const tmaxW = new Array<number | null>(L);
  const disW = new Array<number | null>(L);
  for (const mem of members) {
    for (const c of clim) {
      for (let k = 0; k < L; k++) {
        const ci = c.i0 + k <= c.i1 ? c.i0 + k : c.i1;
        const fromMem = mem?.[k];
        rainW[k] = k <= obsEnd ? obsRain[k]! : fromMem != null ? fromMem : fcRain[k] != null ? fcRain[k] : (view.rain[ci] ?? null);
        tmaxW[k] = k <= obsEnd ? obsTmax[k]! : fcTmax[k] != null ? fcTmax[k] : (view.tmax[ci] ?? null);
        disW[k] = k <= obsEnd ? obsDis[k]! : fcDis[k] != null ? fcDis[k] : (view.discharge?.[ci] ?? null);
      }
      const idx = computeIndex(spec, { rain: rainW, tmax: tmaxW, discharge: view.discharge ? disW : null }, 0, L - 1);
      fr.push(payoutFraction(spec, idx));
    }
  }
  const sv: SeriesView = { rain: obsRain, tmax: obsTmax, discharge: view.discharge ? obsDis : null };
  const toDate = obsEnd >= 0 ? computeIndex(spec, sv, 0, obsEnd) : null;
  const withFc = (() => {
    const last = Math.min(L - 1, obsEnd + 16);
    if (last <= obsEnd) return toDate;
    const r = dates.map((_, k) => (k <= obsEnd ? obsRain[k]! : fcRain[k]!));
    const t = dates.map((_, k) => (k <= obsEnd ? obsTmax[k]! : fcTmax[k]!));
    const di = dates.map((_, k) => (k <= obsEnd ? obsDis[k]! : fcDis[k]!));
    return computeIndex(spec, { rain: r, tmax: t, discharge: view.discharge ? di : null }, 0, last);
  })();
  const key: "rain" | "tmax" | "discharge" = spec.indexType === "discharge_max" ? "discharge" : spec.indexType === "heat_days" ? "tmax" : "rain";
  const obsArr = key === "rain" ? obsRain : key === "tmax" ? obsTmax : obsDis;
  const fcArr = key === "rain" ? fcRain : key === "tmax" ? fcTmax : fcDis;
  return {
    status,
    seasonYear: cur.y,
    windowStart: cur.st,
    windowEnd: cur.en,
    daysElapsed: Math.max(0, obsEnd + 1),
    daysTotal: L,
    indexToDate: toDate,
    indexWithForecast: withFc,
    probabilityPct: Math.round((fr.filter((f) => f > 0).length / fr.length) * 1000) / 10,
    expectedPayoutFraction: Math.round(mean(fr) * 10000) / 10000,
    p90PayoutFraction: Math.round(quantile(fr, 0.9) * 10000) / 10000,
    scenarios: fr.length,
    forecastModel: ensemble?.members.length ? `${ensemble.model} (${ensemble.members.length} members)` : "Open-Meteo deterministic forecast",
    series: dates
      .map((date, k) => ({ date, value: k <= obsEnd ? obsArr[k] ?? null : fcArr[k] ?? null, kind: (k <= obsEnd ? "observed" : "forecast") as "observed" | "forecast" }))
      .filter((p) => p.kind === "observed" || p.value != null),
  };
}

export async function liveMonitor(workspaceId: string) {
  const s = getStore();
  const prods = listProducts(workspaceId).filter((p) => p.status === "active");
  const plots = s.assets.filter((a) => a.workspaceId === workspaceId && a.status === "active" && a.type === "insured_plot" && a.meta.parametricProductId);
  const byCell = new Map<string, { cell: HistoryPoint; plots: AssetRecord[] }>();
  for (const a of plots) {
    const c = refPoint(a);
    const k = gridKey(c);
    const e = byCell.get(k) ?? { cell: c, plots: [] };
    e.plots.push(a);
    byCell.set(k, e);
  }
  const cellsArr = [...byCell.values()].map((e) => e.cell);
  const needEns = prods.some((p) => p.spec.indexType === "rain_max_nday" || p.spec.indexType === "rain_total" || p.spec.indexType === "dry_spell");
  const [batch, recent, ens] = await Promise.all([getHistoryBatch(cellsArr, { mode: "partial", budgetMs: 20_000 }), getRecentForecastMany(cellsArr), needEns ? getRainEnsembleMany(cellsArr) : Promise.resolve(new Map())]);
  const hist = batch.map;
  const distName = new Map(s.districts.map((d) => [d.id, d.name]));
  const rows: {
    productId: string;
    productName: string;
    cell: HistoryPoint;
    region: string;
    plots: number;
    sumInsuredUsd: number;
    trigger: number;
    exit: number;
    outlook: SeasonOutlook | null;
    expectedPayoutUsd: number;
    p90PayoutUsd: number;
  }[] = [];
  for (const p of prods) {
    for (const [k, e] of byCell) {
      const ps = e.plots.filter((a) => a.meta.parametricProductId === p.id);
      if (!ps.length) continue;
      const h = hist.get(k);
      const si = ps.reduce((t, a) => t + a.valueUsd, 0);
      const region = [...new Set(ps.map((a) => (a.districtId ? distName.get(a.districtId) : a.country) ?? a.country))].join(", ");
      if (!h) {
        rows.push({ productId: p.id, productName: p.name, cell: e.cell, region, plots: ps.length, sumInsuredUsd: si, trigger: p.spec.trigger, exit: p.spec.exit, outlook: null, expectedPayoutUsd: 0, p90PayoutUsd: 0 });
        continue;
      }
      const merged = mergeHistoryAndForecast(h, recent.get(k));
      const spec = resolveSpec(p.spec, h);
      const o = seasonOutlook(spec, merged, ens.get(k));
      rows.push({ productId: p.id, productName: p.name, cell: e.cell, region, plots: ps.length, sumInsuredUsd: si, trigger: spec.trigger, exit: spec.exit, outlook: o, expectedPayoutUsd: Math.round((o?.expectedPayoutFraction ?? 0) * si), p90PayoutUsd: Math.round((o?.p90PayoutFraction ?? 0) * si) });
    }
  }
  const byProduct = prods.map((p) => {
    const r = rows.filter((x) => x.productId === p.id);
    const si = r.reduce((t, x) => t + x.sumInsuredUsd, 0);
    return {
      id: p.id,
      name: p.name,
      spec: p.spec,
      meta: INDEX_META[p.spec.indexType],
      seasonLabel: seasonLabel(p.spec.season),
      plots: r.reduce((t, x) => t + x.plots, 0),
      sumInsuredUsd: si,
      expectedPayoutUsd: r.reduce((t, x) => t + x.expectedPayoutUsd, 0),
      p90PayoutUsd: r.reduce((t, x) => t + x.p90PayoutUsd, 0),
      cellsAtTrigger: r.filter((x) => (x.outlook?.probabilityPct ?? 0) >= 50).length,
      weightedProbPct: si ? Math.round((r.reduce((t, x) => t + (x.outlook?.probabilityPct ?? 0) * x.sumInsuredUsd, 0) / si) * 10) / 10 : 0,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    rows: rows.sort((a, b) => (b.outlook?.probabilityPct ?? 0) - (a.outlook?.probabilityPct ?? 0) || b.sumInsuredUsd - a.sumInsuredUsd),
    byProduct,
    totals: {
      sumInsuredUsd: rows.reduce((t, x) => t + x.sumInsuredUsd, 0),
      expectedPayoutUsd: rows.reduce((t, x) => t + x.expectedPayoutUsd, 0),
      p90PayoutUsd: rows.reduce((t, x) => t + x.p90PayoutUsd, 0),
      plots: plots.length,
      cells: byCell.size,
      missing: rows.filter((r) => !r.outlook).length,
      pending: batch.pending,
      providers: batch.providers,
    },
  };
}

export const stdevOf = stdev;
