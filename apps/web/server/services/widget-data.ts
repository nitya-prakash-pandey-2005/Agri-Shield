/**
 * widget-data — ONE server-side resolver for every dashboard widget.
 *
 * Every number comes from real workspace state (assets + their re-score
 * history, alert rules, firings, notifications, usage meter, explorer
 * snapshots, the insurance book cache, the Satellite Lab flood scan) or a
 * live free feed (GDACS/EONET hazards, Open-Meteo forecast) with graceful
 * "unavailable" states. Nothing is invented: when a figure cannot be
 * computed the widget says so and tells the user how to get it.
 *
 * Pure aggregation helpers are exported for unit tests.
 */
import { getStore, riskLevelFromScore, type AssetRecord } from "../data/store";
import {
  HAZARDS,
  change7d,
  effectiveScore,
  filterAssets,
  riskThreshold,
  ruleFirings,
  snapshotsFor,
  valueAtRisk,
  valueAtRiskByHazard,
  workspaceAssets,
  workspaceRules,
  type EffectiveScore,
  type Hazard,
} from "./portfolio";
import { evaluateRule } from "./rules";
import { compositeScore, haversineKm } from "./location-risk";
import { hazardsNear } from "./workspace-home";
import { usageDaily } from "./usage";
import { getSnapshot, listSnapshots } from "./explorer-reports";
import { getForecast } from "../live/open-meteo";
import { within } from "../live/disk-cache";
import {
  ASSET_METRICS,
  BAR_MEASURES,
  KPI_METRICS,
  SERIES,
  describeWidget,
  thresholdTone,
  type AssetMetric,
  type BarDimension,
  type BarMeasure,
  type KpiMetric,
  type SeriesKey,
  type Unit,
  type Widget,
  type WidgetFilters,
} from "@/components/dashboards/catalog";

const DAY = 86_400_000;
const isoDay = (d: Date | number) => new Date(d).toISOString().slice(0, 10);

export interface Source {
  label: string;
  href?: string;
}
type Tone = "ok" | "warn" | "crit" | "neutral";

interface Base {
  explain: string;
  sources: Source[];
  asOf: string;
  /** set when the widget has nothing to show — plain-language next step */
  empty?: string | null;
  /** a live feed is still loading in the background — the client polls again shortly */
  pending?: boolean;
}

export interface KpiData extends Base {
  kind: "kpi";
  metric: KpiMetric;
  label: string;
  unit: Unit;
  value: number | null;
  delta: number | null;
  spark: number[];
  tone: Tone;
  max: number | null;
  higherIsWorse: boolean;
  note: string | null;
  href: string | null;
}
export interface SeriesData extends Base {
  kind: "timeseries";
  series: SeriesKey;
  unit: Unit;
  lines: { key: string; label: string }[];
  points: ({ date: string } & Record<string, number | null | string>)[];
  thresholdLine: number | null;
}
export interface BarData extends Base {
  kind: "bar";
  unit: Unit;
  measureLabel: string;
  bars: { key: string; label: string; value: number; color?: string }[];
}
export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  value: number;
  composite: number;
  level: string;
  type: string;
  valueUsd: number;
}
export interface MapData extends Base {
  kind: "map";
  metric: AssetMetric;
  unit: Unit;
  mode: "points" | "choropleth";
  points: MapPoint[];
  districts: { id: string; name: string; value: number; assets: number; geometry: { type: "Polygon"; coordinates: number[][][] } }[];
  center: [number, number] | null;
}
export interface TableData extends Base {
  kind: "table";
  metric: AssetMetric;
  unit: Unit;
  total: number;
  rows: { id: string; name: string; type: string; country: string; district: string | null; value: number | null; composite: number; level: string; valueUsd: number; varUsd: number; change7d: number | null }[];
}
export interface HazardsData extends Base {
  kind: "hazards";
  live: boolean;
  items: { id: string; source: string; type: string; title: string; country: string | null; alertLevel: string | null; date: string; url: string | null; distanceKm: number; assetsWithin: number }[];
}
export interface NotificationsData extends Base {
  kind: "notifications";
  items: { id: string; title: string; body: string; severity: string; kind: string; createdAt: string; href: string | null }[];
}
export interface ForecastData extends Base {
  kind: "forecast";
  place: { name: string; lat: number; lon: number } | null;
  status: "live" | "cached" | "unavailable";
  days: { date: string; rainMm: number | null; rainProb: number | null; tMax: number | null; tMin: number | null }[];
  district: { name: string; km: number; floodProb72h: number; rainfall72hMm: number; ecCurrent: number; riskLevel: string } | null;
  message: string | null;
}
export interface ExplorerData extends Base {
  kind: "explorer";
  report: {
    id: string;
    title: string;
    place: string;
    lat: number;
    lon: number;
    createdAt: string;
    composite: number;
    level: string;
    summary: string;
    hazards: { key: string; score: number }[];
    drivers: string[];
    url: string;
  } | null;
  available: { id: string; title: string; createdAt: string }[];
}
export interface EmbedData extends Base {
  kind: "embed";
  url: string | null;
  target: "report" | "dashboard" | "external" | null;
  report: ExplorerData["report"];
  dashboard: { name: string; orgName: string; widgets: number; kinds: string[]; updatedAt: string } | null;
}
export interface StaticData extends Base {
  kind: "static";
}
export type WidgetData = KpiData | SeriesData | BarData | MapData | TableData | HazardsData | NotificationsData | ForecastData | ExplorerData | EmbedData | StaticData;

export interface ResolveOpts {
  userId?: string | null;
  /** read-only public share: hides pickers that would list other workspace content */
  shared?: boolean;
  now?: Date;
}

const ENGINE: Source = { label: "Agri-SHIELD location engine", href: "/docs" };
const HISTORY: Source = { label: "Asset re-score history" };

// ─── Pure helpers (exported for tests) ────────────────────────────────────

/** Composite on a given day: last history entry on/before `date`; today → current score. */
export function compositeOn(history: { date: string; composite: number }[], date: string, current: number, today: string): number | null {
  if (date >= today) return current;
  let v: number | null = null;
  for (const h of history) {
    if (h.date <= date) v = h.composite;
    else break;
  }
  return v;
}

export interface DailyAgg {
  date: string;
  n: number;
  avg: number | null;
  weighted: number | null;
  atRisk: number;
  pctAtRisk: number | null;
  critical: number;
  varUsd: number;
  exposure: number;
  exposureAtRisk: number;
}

export interface AggInput {
  valueUsd: number;
  history: { date: string; composite: number }[];
  score: Pick<EffectiveScore, "composite" | "flood" | "salinity" | "drought" | "heat">;
}

/** Daily portfolio aggregates for the last `days` days (oldest first), from each asset's composite history. */
export function dailyAggregates(items: AggInput[], days: number, threshold: number, now = new Date()): DailyAgg[] {
  const today = isoDay(now);
  const out: DailyAgg[] = [];
  const sorted = items.map((it) => ({ ...it, history: [...it.history].sort((a, b) => a.date.localeCompare(b.date)) }));
  for (let k = days - 1; k >= 0; k--) {
    const date = isoDay(now.getTime() - k * DAY);
    let n = 0;
    let sum = 0;
    let wsum = 0;
    let w = 0;
    let atRisk = 0;
    let critical = 0;
    let varUsd = 0;
    let exposure = 0;
    let exposureAtRisk = 0;
    for (const it of sorted) {
      const c = compositeOn(it.history, date, it.score.composite, today);
      if (c == null) continue;
      n++;
      sum += c;
      wsum += c * it.valueUsd;
      w += it.valueUsd;
      exposure += it.valueUsd;
      if (c >= threshold) {
        atRisk++;
        exposureAtRisk += it.valueUsd;
      }
      if (c >= 80) critical++;
      varUsd += valueAtRisk(it.valueUsd, { ...it.score, composite: c });
    }
    out.push({
      date,
      n,
      avg: n ? Math.round((sum / n) * 10) / 10 : null,
      weighted: w > 0 ? Math.round((wsum / w) * 10) / 10 : null,
      atRisk,
      pctAtRisk: n ? Math.round((atRisk / n) * 1000) / 10 : null,
      critical,
      varUsd: Math.round(varUsd),
      exposure: Math.round(exposure),
      exposureAtRisk: Math.round(exposureAtRisk),
    });
  }
  return out;
}

/** Count events per ISO day for the last `days` days (oldest first, zero-filled). */
export function perDay(dates: (Date | string)[], days: number, now = new Date()): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const k = isoDay(new Date(d));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = isoDay(now.getTime() - (days - 1 - i) * DAY);
    return { date, count: counts.get(date) ?? 0 };
  });
}

/** Group values into labelled buckets, keep the top `max` and fold the rest into "Other". */
export function topBuckets(entries: { key: string; label: string; value: number }[], max = 12): { key: string; label: string; value: number }[] {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((s, e) => s + e.value, 0);
  return [...head, { key: "__other", label: "Other", value: Math.round(rest * 10) / 10 }];
}

export function assetMetricValue(metric: AssetMetric, a: AssetRecord, e: EffectiveScore): number | null {
  switch (metric) {
    case "composite":
      return e.composite;
    case "flood":
    case "salinity":
    case "drought":
    case "heat":
      return e[metric];
    case "var":
      return Math.round(valueAtRisk(a.valueUsd, e));
    case "value":
      return a.valueUsd;
    case "change7d":
      return change7d(a, e.composite);
  }
}

// ─── Scope ────────────────────────────────────────────────────────────────

function scopedAssets(orgId: string, f: WidgetFilters | undefined): AssetRecord[] {
  if (!f || (!f.tags?.length && !f.types?.length && !f.countries?.length)) return workspaceAssets(orgId);
  return filterAssets(orgId, { tags: f.tags, types: f.types as never, countries: f.countries });
}

const orgOf = (orgId: string) => getStore().orgs.find((o) => o.id === orgId) ?? null;

function firingDates(orgId: string, sinceMs: number): Date[] {
  const firings = ruleFirings(orgId, { limit: 5000 }).filter((f) => f.at.getTime() >= sinceMs);
  const linked = new Set(firings.map((f) => f.notificationId).filter(Boolean) as string[]);
  const notes = getStore().notifications.filter((n) => n.workspaceId === orgId && n.kind === "rule" && n.createdAt.getTime() >= sinceMs && !linked.has(n.id));
  return [...firings.map((f) => f.at), ...notes.map((n) => n.createdAt)];
}

async function expectedLossFromBook(orgId: string): Promise<{ value: number; at: number } | null> {
  const g = globalThis as unknown as { __agriBook?: Map<string, { at: number; v: Promise<{ totals: { expectedLossUsd: number }; plots: { id: string }[] }> }> };
  const hit = g.__agriBook?.get(orgId);
  if (!hit) return null;
  const r = await Promise.race([hit.v.catch(() => null), new Promise<null>((res) => setTimeout(() => res(null), 40))]);
  return r ? { value: Math.round(r.totals.expectedLossUsd), at: hit.at } : null;
}

interface FloodScanSummary {
  date: string;
  scannedAt: Date;
  flooded: number;
  nearby: number;
  assets: number;
  exposureFloodedUsd: number;
  floodedAssetIds: string[];
}
async function lastFlood(orgId: string): Promise<FloodScanSummary | null> {
  try {
    const mod = (await import("./imagery")) as unknown as { lastFloodScan?: (id: string) => FloodScanSummary | null };
    return mod.lastFloodScan?.(orgId) ?? null;
  } catch {
    return null;
  }
}

// ─── KPI / gauge ──────────────────────────────────────────────────────────

async function resolveKpi(orgId: string, w: Widget, now: Date): Promise<KpiData> {
  const metric = ((w.config.metric ?? "var") in KPI_METRICS ? w.config.metric : "var") as KpiMetric;
  const def = KPI_METRICS[metric] as (typeof KPI_METRICS)[KpiMetric] & { thresholds?: { warn: number; crit: number }; max?: number };
  const assets = scopedAssets(orgId, w.config.filters);
  const threshold = riskThreshold(orgId);
  const scores = assets.map((a) => ({ a, e: effectiveScore(a) }));
  const needsDaily = ["var", "var_ratio", "pct_at_risk", "at_risk", "exposure_at_risk", "critical_assets", "avg_composite"].includes(metric);
  const daily = needsDaily ? dailyAggregates(scores.map(({ a, e }) => ({ valueUsd: a.valueUsd, history: a.history, score: e })), 30, threshold, now) : [];
  const pick = (d: DailyAgg): number | null => {
    switch (metric) {
      case "var":
        return d.varUsd;
      case "var_ratio":
        return d.exposure > 0 ? Math.round((d.varUsd / d.exposure) * 1000) / 10 : null;
      case "pct_at_risk":
        return d.pctAtRisk;
      case "at_risk":
        return d.atRisk;
      case "exposure_at_risk":
        return d.exposureAtRisk;
      case "critical_assets":
        return d.critical;
      case "avg_composite":
        return d.avg;
      default:
        return null;
    }
  };
  let value: number | null = null;
  let note: string | null = null;
  let href: string | null = "/app/portfolio";
  const sources: Source[] = [ENGINE];
  const exposure = assets.reduce((s, a) => s + a.valueUsd, 0);
  const n = assets.length;
  const avgOf = (h: Hazard) => (n ? Math.round((scores.reduce((s, x) => s + x.e[h], 0) / n) * 10) / 10 : null);
  switch (metric) {
    case "assets":
      value = n;
      break;
    case "exposure":
      value = Math.round(exposure);
      break;
    case "var":
      value = Math.round(scores.reduce((s, x) => s + valueAtRisk(x.a.valueUsd, x.e), 0));
      break;
    case "var_ratio": {
      const v = scores.reduce((s, x) => s + valueAtRisk(x.a.valueUsd, x.e), 0);
      value = exposure > 0 ? Math.round((v / exposure) * 1000) / 10 : null;
      break;
    }
    case "pct_at_risk":
      value = n ? Math.round((scores.filter((x) => x.e.composite >= threshold).length / n) * 1000) / 10 : null;
      note = `Threshold: composite ≥ ${threshold}`;
      break;
    case "at_risk":
      value = scores.filter((x) => x.e.composite >= threshold).length;
      note = `Threshold: composite ≥ ${threshold}`;
      break;
    case "exposure_at_risk":
      value = Math.round(scores.filter((x) => x.e.composite >= threshold).reduce((s, x) => s + x.a.valueUsd, 0));
      break;
    case "critical_assets":
      value = scores.filter((x) => x.e.composite >= 80).length;
      break;
    case "avg_composite":
      value = n ? Math.round((scores.reduce((s, x) => s + x.e.composite, 0) / n) * 10) / 10 : null;
      break;
    case "flood_avg":
      value = avgOf("flood");
      break;
    case "salinity_avg":
      value = avgOf("salinity");
      break;
    case "drought_avg":
      value = avgOf("drought");
      break;
    case "heat_avg":
      value = avgOf("heat");
      break;
    case "active_alerts": {
      const snaps = snapshotsFor(assets);
      const rules = workspaceRules(orgId).filter((r) => r.enabled);
      const inAlarm = rules.filter((r) => evaluateRule(r, assets, snaps, { ignoreCooldown: true }).matches.length > 0);
      value = inAlarm.length;
      note = rules.length ? `${inAlarm.length} of ${rules.length} enabled rules${inAlarm[0] ? ` · e.g. "${inAlarm[0].name}"` : ""}` : "No enabled rules yet";
      href = "/app/alerts";
      sources.push({ label: "Alert-rule engine" });
      break;
    }
    case "rule_firings": {
      const days = Math.max(1, Math.min(90, w.config.days ?? 7));
      const dates = firingDates(orgId, now.getTime() - days * DAY);
      value = dates.length;
      note = `Last ${days} days`;
      href = "/app/alerts";
      sources.push({ label: "Rule firings & notifications" });
      const pd = perDay(dates, Math.min(30, Math.max(days, 7)), now);
      return finishKpi(w, metric, def, value, null, pd.map((p) => p.count), note, href, sources, now);
    }
    case "insured_sum": {
      const plots = assets.filter((a) => a.type === "insured_plot");
      value = Math.round(plots.reduce((s, a) => s + a.valueUsd, 0));
      note = `${plots.length} insured unit${plots.length === 1 ? "" : "s"}`;
      href = "/app/insurance?tab=book";
      break;
    }
    case "expected_loss": {
      const el = await expectedLossFromBook(orgId);
      href = "/app/insurance?tab=book";
      if (el) {
        value = el.value;
        note = `Book backtest · ${Math.round((now.getTime() - el.at) / 60_000)} min ago`;
        sources.push({ label: "ERA5/GloFAS 30-yr book backtest" });
      } else {
        value = null;
        note = "Not computed yet — open Insurance → Book to run the 30-year backtest.";
      }
      break;
    }
    case "observed_flooded": {
      const fl = await lastFlood(orgId);
      href = "/app/imagery?tab=flood";
      sources.push({ label: "NASA GIBS MODIS flood (~250 m)", href: "https://www.earthdata.nasa.gov/gibs" });
      if (fl) {
        const ids = new Set(assets.map((a) => a.id));
        value = fl.floodedAssetIds.filter((id) => ids.has(id)).length;
        note = `Scan of ${fl.date} · ${fl.nearby} more with flood within ~300 m`;
      } else {
        value = null;
        note = "No flood scan yet — run one in Satellite Lab → Flood extent.";
      }
      break;
    }
  }
  const valid = daily.map(pick);
  const spark = valid.filter((v): v is number => v != null);
  let delta: number | null = null;
  if (needsDaily && valid.length >= 8) {
    const past = valid[valid.length - 8];
    if (value != null && past != null) delta = Math.round((value - past) * 10) / 10;
  }
  if (needsDaily) sources.push(HISTORY);
  return finishKpi(w, metric, def, value, delta, spark, note, href, sources, now);
}

function finishKpi(w: Widget, metric: KpiMetric, def: { label: string; unit: Unit; higherIsWorse: boolean; thresholds?: { warn: number; crit: number }; max?: number }, value: number | null, delta: number | null, spark: number[], note: string | null, href: string | null, sources: Source[], now: Date): KpiData {
  const thresholds = w.config.thresholds && (w.config.thresholds.warn != null || w.config.thresholds.crit != null) ? w.config.thresholds : def.thresholds;
  return {
    kind: "kpi",
    metric,
    label: def.label,
    unit: def.unit,
    value,
    delta,
    spark,
    tone: thresholdTone(value, thresholds, def.higherIsWorse),
    max: def.max ?? (def.unit === "pct" || def.unit === "score" ? 100 : null),
    higherIsWorse: def.higherIsWorse,
    note,
    href,
    explain: describeWidget(w),
    sources,
    asOf: now.toISOString(),
    empty: null,
  };
}

// ─── Time series ──────────────────────────────────────────────────────────

function resolveSeries(orgId: string, w: Widget, now: Date): SeriesData {
  const series = ((w.config.series ?? "composite") in SERIES ? w.config.series : "composite") as SeriesKey;
  const days = Math.max(7, Math.min(90, w.config.days ?? 30));
  const base = { kind: "timeseries" as const, series, unit: SERIES[series].unit, explain: describeWidget(w), asOf: now.toISOString(), thresholdLine: null as number | null };
  if (series === "composite" || series === "at_risk" || series === "var") {
    const assets = scopedAssets(orgId, w.config.filters);
    const threshold = riskThreshold(orgId);
    const daily = dailyAggregates(assets.map((a) => ({ valueUsd: a.valueUsd, history: a.history, score: effectiveScore(a) })), days, threshold, now).filter((d) => d.n > 0);
    const lines =
      series === "composite"
        ? [
            { key: "avg", label: "Average" },
            { key: "weighted", label: "Exposure-weighted" },
          ]
        : series === "at_risk"
          ? [{ key: "atRisk", label: `Assets ≥ ${threshold}` }]
          : [{ key: "varUsd", label: "Value at risk" }];
    return {
      ...base,
      lines,
      points: daily.map((d) => ({ date: d.date, avg: d.avg, weighted: d.weighted, atRisk: d.atRisk, varUsd: d.varUsd })),
      thresholdLine: series === "composite" ? threshold : null,
      sources: [ENGINE, HISTORY],
      empty: daily.length ? null : assets.length ? "No score history yet — re-score the portfolio to start the trend." : "No assets match this widget's filters. Add assets in Portfolio or relax the filters.",
    };
  }
  if (series === "firings" || series === "notifications") {
    const since = now.getTime() - days * DAY;
    const dates = series === "firings" ? firingDates(orgId, since) : getStore().notifications.filter((n) => n.workspaceId === orgId && n.createdAt.getTime() >= since).map((n) => n.createdAt);
    const pd = perDay(dates, days, now);
    return {
      ...base,
      lines: [{ key: "count", label: series === "firings" ? "Rule firings" : "Notifications" }],
      points: pd.map((p) => ({ date: p.date, count: p.count })),
      sources: [{ label: series === "firings" ? "Alert-rule engine" : "Workspace notifications" }],
      empty: null,
    };
  }
  // usage
  const since = isoDay(now.getTime() - (days - 1) * DAY);
  const rows = usageDaily(orgId).filter((r) => r.date >= since);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const points = perDay([], days, now).map(({ date }) => {
    const r = byDate.get(date);
    return { date, assessments: r?.assessments ?? 0, apiCalls: r?.apiCalls ?? 0, reports: r?.reports ?? 0, messages: r?.messages ?? 0 };
  });
  return {
    ...base,
    lines: [
      { key: "assessments", label: "Assessments" },
      { key: "apiCalls", label: "API calls" },
      { key: "reports", label: "Reports" },
      { key: "messages", label: "Messages" },
    ],
    points,
    sources: [{ label: "Usage meter (since server start)" }],
    empty: rows.length ? null : "No metered usage recorded since the server started.",
  };
}

// ─── Bars ─────────────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<string, string> = { low: "#4ade80", medium: "#fbbf24", high: "#f87171", critical: "#a78bfa" };
const HAZARD_COLORS: Record<Hazard, string> = { flood: "#3494d4", salinity: "#d9689e", drought: "#b58f1c", heat: "#8a7ff0" };
const TYPE_LABEL: Record<string, string> = { farm: "Farm", field: "Field", warehouse: "Warehouse", processing_plant: "Processing plant", port: "Port", retail_outlet: "Retail outlet", insured_plot: "Insured unit", loan: "Agri loan", community: "Community", office: "Office" };

function resolveBar(orgId: string, w: Widget, now: Date): BarData {
  const dimension = (w.config.dimension ?? "histogram") as BarDimension;
  const measure = ((w.config.measure ?? "count") in BAR_MEASURES ? w.config.measure : "count") as BarMeasure;
  const assets = scopedAssets(orgId, w.config.filters);
  const rows = assets.map((a) => ({ a, e: effectiveScore(a) }));
  const districts = new Map(getStore().districts.map((d) => [d.id, d.name]));
  const measureOf = (list: typeof rows): number => {
    switch (measure) {
      case "count":
        return list.length;
      case "exposure":
        return Math.round(list.reduce((s, r) => s + r.a.valueUsd, 0));
      case "var":
        return Math.round(list.reduce((s, r) => s + valueAtRisk(r.a.valueUsd, r.e), 0));
      case "avg_composite":
        return list.length ? Math.round((list.reduce((s, r) => s + r.e.composite, 0) / list.length) * 10) / 10 : 0;
    }
  };
  const group = (keyOf: (r: (typeof rows)[number]) => { key: string; label: string }[]) => {
    const m = new Map<string, { label: string; list: typeof rows }>();
    for (const r of rows) for (const k of keyOf(r)) (m.get(k.key) ?? m.set(k.key, { label: k.label, list: [] }).get(k.key)!).list.push(r);
    return [...m.entries()].map(([key, v]) => ({ key, label: v.label, value: measureOf(v.list) }));
  };
  let bars: BarData["bars"];
  switch (dimension) {
    case "histogram":
      bars = Array.from({ length: 10 }, (_, i) => {
        const list = rows.filter((r) => Math.min(9, Math.floor(r.e.composite / 10)) === i);
        return { key: String(i * 10), label: `${i * 10}-${i * 10 + 9}`, value: measureOf(list), color: LEVEL_COLORS[riskLevelFromScore(i * 10 + 5)] };
      });
      break;
    case "level":
      bars = (["low", "medium", "high", "critical"] as const).map((l) => ({ key: l, label: l[0]!.toUpperCase() + l.slice(1), value: measureOf(rows.filter((r) => r.e.level === l)), color: LEVEL_COLORS[l] }));
      break;
    case "hazard":
      bars = HAZARDS.map((h) => {
        let value = 0;
        if (measure === "var") value = Math.round(rows.reduce((s, r) => s + valueAtRiskByHazard(r.a.valueUsd, r.e)[h], 0));
        else if (measure === "avg_composite") value = rows.length ? Math.round((rows.reduce((s, r) => s + r.e[h], 0) / rows.length) * 10) / 10 : 0;
        else {
          const dom = rows.filter((r) => HAZARDS.reduce((b, x) => (r.e[x] > r.e[b] ? x : b), "flood" as Hazard) === h);
          value = measure === "count" ? dom.length : Math.round(dom.reduce((s, r) => s + r.a.valueUsd, 0));
        }
        return { key: h, label: h[0]!.toUpperCase() + h.slice(1), value, color: HAZARD_COLORS[h] };
      });
      break;
    case "country":
      bars = topBuckets(group((r) => [{ key: r.a.country, label: r.a.country }]));
      break;
    case "type":
      bars = topBuckets(group((r) => [{ key: r.a.type, label: TYPE_LABEL[r.a.type] ?? r.a.type }]));
      break;
    case "crop":
      bars = topBuckets(group((r) => [{ key: r.a.crop ?? "none", label: r.a.crop ? r.a.crop.replace(/_/g, " ") : "Not set" }]));
      break;
    case "district":
      bars = topBuckets(group((r) => [{ key: r.a.districtId ?? `other:${r.a.country}`, label: r.a.districtId ? districts.get(r.a.districtId) ?? r.a.districtId : `${r.a.country} (other)` }]));
      break;
    case "tag":
      bars = topBuckets(group((r) => (r.a.tags.length ? r.a.tags.map((t) => ({ key: t, label: t })) : [{ key: "__untagged", label: "Untagged" }])));
      break;
    default:
      bars = [];
  }
  const avgMeasure = measure === "avg_composite";
  if (avgMeasure && dimension !== "histogram" && dimension !== "level" && dimension !== "hazard") bars = bars.filter((b) => b.key !== "__other");
  return {
    kind: "bar",
    unit: BAR_MEASURES[measure].unit,
    measureLabel: dimension === "hazard" && measure === "count" ? "Assets where this hazard dominates" : dimension === "hazard" && measure === "exposure" ? "Exposure where this hazard dominates" : BAR_MEASURES[measure].label,
    bars,
    explain: describeWidget(w),
    sources: [ENGINE],
    asOf: now.toISOString(),
    empty: assets.length ? null : "No assets match this widget's filters. Add assets in Portfolio or relax the filters.",
  };
}

// ─── Map ──────────────────────────────────────────────────────────────────

function resolveMap(orgId: string, w: Widget, now: Date): MapData {
  const metric = ((w.config.metric ?? "composite") in ASSET_METRICS ? w.config.metric : "composite") as AssetMetric;
  const mode = w.config.mapMode === "choropleth" ? "choropleth" : "points";
  const assets = scopedAssets(orgId, w.config.filters);
  const points: MapPoint[] = assets.map((a) => {
    const e = effectiveScore(a);
    return { id: a.id, name: a.name, lat: a.lat, lon: a.lon, value: assetMetricValue(metric, a, e) ?? 0, composite: e.composite, level: e.level, type: a.type, valueUsd: a.valueUsd };
  });
  const store = getStore();
  let districtsOut: MapData["districts"] = [];
  if (mode === "choropleth") {
    const byD = new Map<string, number[]>();
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i]!;
      if (!a.districtId) continue;
      (byD.get(a.districtId) ?? byD.set(a.districtId, []).get(a.districtId)!).push(points[i]!.value);
    }
    let ds = store.districts.filter((d) => byD.has(d.id));
    if (!ds.length) ds = store.districts.filter((d) => d.orgId === orgId);
    if (!ds.length) ds = store.districts;
    districtsOut = ds.map((d) => {
      const vals = byD.get(d.id);
      let value: number;
      if (vals?.length) value = metric === "var" || metric === "value" ? vals.reduce((s, v) => s + v, 0) : vals.reduce((s, v) => s + v, 0) / vals.length;
      else value = metric === "flood" ? d.floodRisk : metric === "salinity" ? d.salinityRisk : compositeScore({ flood: d.floodRisk, salinity: d.salinityRisk, drought: 15, heat: 10 });
      return { id: d.id, name: d.name, value: Math.round(value * 10) / 10, assets: vals?.length ?? 0, geometry: d.geometry };
    });
  }
  const org = orgOf(orgId);
  const center = (org?.settings?.defaultCenter as [number, number] | undefined) ?? (points[0] ? [points[0].lat, points[0].lon] : null);
  return {
    kind: "map",
    metric,
    unit: ASSET_METRICS[metric].unit,
    mode,
    points,
    districts: districtsOut,
    center,
    explain: describeWidget(w),
    sources: mode === "choropleth" ? [ENGINE, { label: "District boundaries (Agri-SHIELD)" }] : [ENGINE],
    asOf: now.toISOString(),
    empty: points.length || districtsOut.length ? null : "No assets match this widget's filters. Add assets in Portfolio or relax the filters.",
  };
}

// ─── Table ────────────────────────────────────────────────────────────────

function resolveTable(orgId: string, w: Widget, now: Date): TableData {
  const metric = ((w.config.metric ?? "var") in ASSET_METRICS ? w.config.metric : "var") as AssetMetric;
  const limit = Math.max(3, Math.min(25, w.config.limit ?? 8));
  const dir = w.config.sortDir === "asc" ? 1 : -1;
  const assets = scopedAssets(orgId, w.config.filters);
  const dnames = new Map(getStore().districts.map((d) => [d.id, d.name]));
  const rows = assets
    .map((a) => {
      const e = effectiveScore(a);
      return { id: a.id, name: a.name, type: a.type, country: a.country, district: a.districtId ? dnames.get(a.districtId) ?? null : null, value: assetMetricValue(metric, a, e), composite: e.composite, level: e.level, valueUsd: a.valueUsd, varUsd: Math.round(valueAtRisk(a.valueUsd, e)), change7d: change7d(a, e.composite) };
    })
    .sort((x, y) => ((x.value ?? -Infinity) - (y.value ?? -Infinity)) * dir || x.name.localeCompare(y.name));
  return {
    kind: "table",
    metric,
    unit: ASSET_METRICS[metric].unit,
    total: rows.length,
    rows: rows.slice(0, limit),
    explain: describeWidget(w),
    sources: [ENGINE],
    asOf: now.toISOString(),
    empty: rows.length ? null : "No assets match this widget's filters. Add assets in Portfolio or relax the filters.",
  };
}

// ─── Feeds ────────────────────────────────────────────────────────────────

async function resolveHazards(orgId: string, w: Widget, now: Date): Promise<HazardsData> {
  let refs: { lat: number; lon: number }[] = scopedAssets(orgId, w.config.filters);
  if (!refs.length) refs = getStore().districts.filter((d) => d.orgId === orgId);
  const limit = Math.max(3, Math.min(15, w.config.limit ?? 6));
  let items: HazardsData["items"] = [];
  let live = true;
  let pending = false;
  try {
    // Never hold the (batched) dashboard request hostage to a slow upstream:
    // answer within 1.5 s; the feed keeps loading into the cache and the widget re-polls.
    const near = await within(hazardsNear(refs as AssetRecord[], 300), 1500, "hazard feed").catch((e: Error) => {
      if (/still computing/.test(e.message)) {
        pending = true;
        return [];
      }
      throw e;
    });
    items = near.slice(0, limit).map((e) => ({ id: e.id, source: e.source, type: e.type, title: e.title, country: e.country, alertLevel: e.alertLevel, date: e.date, url: e.url, distanceKm: e.distanceKm, assetsWithin: e.assetsWithin }));
  } catch {
    live = false;
  }
  return {
    kind: "hazards",
    live,
    pending,
    items,
    explain: describeWidget(w),
    sources: [
      { label: "GDACS (UN/EC JRC)", href: "https://www.gdacs.org" },
      { label: "NASA EONET", href: "https://eonet.gsfc.nasa.gov" },
    ],
    asOf: now.toISOString(),
    empty: pending ? "Fetching live GDACS / NASA EONET feeds…" : !live ? "Live hazard feeds are not reachable right now — the widget retries on the next refresh." : items.length ? null : "No GDACS/EONET events within 300 km of your assets in the last 45 days. Good news.",
  };
}

function resolveNotifications(orgId: string, w: Widget, opts: ResolveOpts, now: Date): NotificationsData {
  const limit = Math.max(3, Math.min(20, w.config.limit ?? 6));
  const items = getStore()
    .notifications.filter((n) => n.workspaceId === orgId && (n.userId === null || (!!opts.userId && n.userId === opts.userId)) && (!opts.shared || n.kind !== "billing"))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map((n) => ({ id: n.id, title: n.title, body: n.body, severity: n.severity, kind: n.kind, createdAt: n.createdAt.toISOString(), href: n.href }));
  return { kind: "notifications", items, explain: describeWidget(w), sources: [{ label: "Workspace notifications" }], asOf: now.toISOString(), empty: items.length ? null : "No notifications yet — they appear when rules fire, reports finish or teammates join." };
}

function nearestDistrict(lat: number, lon: number) {
  let best: { d: ReturnType<typeof getStore>["districts"][number]; km: number } | null = null;
  for (const d of getStore().districts) {
    const km = haversineKm(lat, lon, d.lat, d.lon);
    if (!best || km < best.km) best = { d, km };
  }
  return best;
}

/** Look for a cached full location report (Explorer) near the point — zero upstream calls. */
function cachedReportDaily(lat: number, lon: number): ForecastData["days"] | null {
  const g = globalThis as unknown as { __agriReports?: Map<string, { value: { location: { lat: number; lon: number }; forecast: { daily: { date: string; precipMm: number; precipProb: number; tMax: number | null; tMin: number | null }[] } }; expires: number }> };
  const m = g.__agriReports;
  if (!m) return null;
  for (const { value } of m.values()) {
    if (Math.abs(value.location.lat - lat) < 0.05 && Math.abs(value.location.lon - lon) < 0.05 && value.forecast.daily.length) {
      return value.forecast.daily.map((d) => ({ date: d.date, rainMm: d.precipMm, rainProb: d.precipProb, tMax: d.tMax, tMin: d.tMin }));
    }
  }
  return null;
}

async function resolveForecast(orgId: string, w: Widget, now: Date): Promise<ForecastData> {
  let place = w.config.place ?? null;
  if (!place && w.config.assetId) {
    const a = getStore().assets.find((x) => x.id === w.config.assetId && x.workspaceId === orgId);
    if (a) place = { lat: a.lat, lon: a.lon, name: a.name };
  }
  if (!place) {
    const org = orgOf(orgId);
    const c = org?.settings?.defaultCenter;
    const first = workspaceAssets(orgId)[0];
    if (first) place = { lat: first.lat, lon: first.lon, name: first.name };
    else if (c) place = { lat: c[0], lon: c[1], name: `${org?.shortName ?? "Workspace"} centre` };
  }
  const base = { kind: "forecast" as const, explain: describeWidget(w), asOf: now.toISOString() };
  if (!place) return { ...base, place: null, status: "unavailable", days: [], district: null, message: null, sources: [], empty: "Pick a place or an asset in this widget's settings." };
  const nd = nearestDistrict(place.lat, place.lon);
  const district = nd && nd.km < 150 ? { name: nd.d.name, km: Math.round(nd.km), floodProb72h: Math.round(nd.d.floodProb72h), rainfall72hMm: Math.round(nd.d.rainfall72hMm), ecCurrent: Math.round(nd.d.ecCurrent * 10) / 10, riskLevel: nd.d.riskLevel } : null;
  let pending = false;
  try {
    const [f] = await within(getForecast([{ lat: place.lat, lon: place.lon }], 7), 2500, "forecast").catch((e: Error) => {
      if (/still computing/.test(e.message)) pending = true;
      throw e;
    });
    const today = isoDay(now);
    const days = (f?.daily.time ?? [])
      .map((date, i) => ({ date, rainMm: f!.daily.precipitation_sum[i] ?? null, rainProb: f!.daily.precipitation_probability_max[i] ?? null, tMax: f!.daily.temperature_2m_max[i] ?? null, tMin: f!.daily.temperature_2m_min[i] ?? null }))
      .filter((d) => d.date >= today)
      .slice(0, 7);
    if (days.length) return { ...base, place, status: "live", days, district, message: null, sources: [{ label: "Open-Meteo (ECMWF/GFS/ICON blend)", href: "https://open-meteo.com" }], empty: null };
  } catch {
    /* fall through to cache / unavailable */
  }
  const cachedDays = cachedReportDaily(place.lat, place.lon);
  if (cachedDays?.length)
    return { ...base, place, status: "cached", days: cachedDays.slice(0, 7), district, message: "Live forecast feed busy — showing the most recent cached Explorer forecast for this place.", sources: [{ label: "Open-Meteo (cached)", href: "https://open-meteo.com" }], empty: null };
  return {
    ...base,
    place,
    status: "unavailable",
    pending,
    days: [],
    district,
    message: pending ? "Fetching the live forecast…" : "Live forecast feed unavailable right now (upstream quota or timeout). The nearest district's latest risk context is shown; the strip fills in automatically on a later refresh.",
    sources: district ? [{ label: "District live risk overlay" }] : [],
    empty: null,
  };
}

function reportCard(ok: NonNullable<ReturnType<typeof getSnapshot>>): NonNullable<ExplorerData["report"]> {
  const rep = ok.report;
  return {
    id: ok.id,
    title: ok.title,
    place: rep.location.name ?? `${rep.location.lat.toFixed(3)}, ${rep.location.lon.toFixed(3)}`,
    lat: rep.location.lat,
    lon: rep.location.lon,
    createdAt: ok.createdAt.toISOString(),
    composite: rep.composite.score,
    level: rep.composite.level,
    summary: rep.composite.summary,
    hazards: [
      { key: "flood", score: rep.hazards.flood.score },
      { key: "salinity", score: rep.hazards.salinity.score },
      { key: "drought", score: rep.hazards.drought.score },
      { key: "heat", score: rep.hazards.heat.score },
    ],
    drivers: rep.composite.drivers.slice(0, 3),
    url: `/r/${ok.id}`,
  };
}

/**
 * Shared-report card. The workspace's security policy forbids framing
 * (CSP frame-ancestors 'none'), so shared pages are rendered natively as a
 * summary card with a link instead of an <iframe>.
 */
async function resolveEmbed(w: Widget, now: Date): Promise<EmbedData> {
  const url = w.config.url ?? null;
  const base = { kind: "embed" as const, url, explain: describeWidget(w), asOf: now.toISOString(), report: null, dashboard: null };
  if (!url) return { ...base, target: null, sources: [], empty: "Paste a shared report link (/r/…) or shared dashboard link (/d/…) in this widget's settings." };
  const path = url.startsWith("/") ? url : (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  })();
  const r = /^\/r\/([A-Za-z0-9_-]{4,80})$/.exec(path);
  if (r) {
    const snap = getSnapshot(r[1]!);
    return snap ? { ...base, target: "report", report: reportCard(snap), sources: [{ label: "Shared Explorer report" }], empty: null } : { ...base, target: "report", sources: [], empty: "That shared report link no longer exists." };
  }
  const d = /^\/d\/([A-Za-z0-9_-]{16,64})$/.exec(path);
  if (d) {
    const { getByShareToken, orgDisplayName } = await import("./dashboards");
    const dash = getByShareToken(d[1]!);
    return dash
      ? { ...base, target: "dashboard", dashboard: { name: dash.name, orgName: orgDisplayName(dash.orgId), widgets: dash.widgets.length, kinds: [...new Set(dash.widgets.map((x) => x.kind))], updatedAt: dash.updatedAt.toISOString() }, sources: [{ label: "Shared dashboard" }], empty: null }
      : { ...base, target: "dashboard", sources: [], empty: "That shared dashboard link is invalid or sharing was turned off." };
  }
  return { ...base, target: "external", sources: [], empty: null };
}

function resolveExplorer(orgId: string, w: Widget, opts: ResolveOpts, now: Date): ExplorerData {
  const available = opts.shared ? [] : listSnapshots(orgId).slice(0, 30).map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt.toISOString() }));
  const id = w.config.reportId ?? null;
  const r = id ? getSnapshot(id) : null;
  const ok = r && r.orgId === orgId ? r : null;
  return {
    kind: "explorer",
    available,
    report: ok ? reportCard(ok) : null,
    explain: describeWidget(w),
    sources: [{ label: "Risk Explorer snapshot" }],
    asOf: now.toISOString(),
    empty: ok ? null : id ? "That report no longer exists or belongs to another workspace." : available.length ? "Choose a saved Explorer report in this widget's settings." : "No saved Explorer reports yet — open Risk Explorer, assess a place and press Share/Save.",
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────

export async function resolveWidget(orgId: string, w: Widget, opts: ResolveOpts = {}): Promise<WidgetData> {
  const now = opts.now ?? new Date();
  switch (w.kind) {
    case "kpi":
    case "gauge":
      return resolveKpi(orgId, w, now);
    case "timeseries":
      return resolveSeries(orgId, w, now);
    case "bar":
      return resolveBar(orgId, w, now);
    case "map":
      return resolveMap(orgId, w, now);
    case "table":
      return resolveTable(orgId, w, now);
    case "hazards":
      return resolveHazards(orgId, w, now);
    case "notifications":
      return resolveNotifications(orgId, w, opts, now);
    case "forecast":
      return resolveForecast(orgId, w, now);
    case "explorer":
      return resolveExplorer(orgId, w, opts, now);
    case "embed":
      return resolveEmbed(w, now);
    default:
      return { kind: "static", explain: describeWidget(w), sources: [], asOf: now.toISOString(), empty: null };
  }
}

/** Facets for the widget config panel (filters), scoped to the workspace. */
export function widgetFacets(orgId: string) {
  const assets = workspaceAssets(orgId);
  const count = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, count: n }));
  };
  return {
    types: count(assets.map((a) => a.type)).map((t) => ({ ...t, label: TYPE_LABEL[t.value] ?? t.value })),
    tags: count(assets.flatMap((a) => a.tags)),
    countries: count(assets.map((a) => a.country)),
    assets: assets.slice(0, 400).map((a) => ({ id: a.id, name: a.name, lat: a.lat, lon: a.lon })),
    reports: listSnapshots(orgId)
      .slice(0, 30)
      .map((r) => ({ id: r.id, title: r.title })),
    threshold: riskThreshold(orgId),
  };
}

/**
 * Plain-text digest of a dashboard's headline numbers (KPI / gauge widgets) —
 * for the Copilot ("what does my ops dashboard say?") or e-mail digests.
 */
export async function dashboardDigest(orgId: string, widgets: Widget[]): Promise<{ lines: string[]; asOf: string }> {
  const fmt = (v: number | null, unit: Unit) =>
    v == null ? "not available" : unit === "usd" ? `$${Math.round(v).toLocaleString("en-US")}` : unit === "pct" ? `${v}%` : String(v);
  const kpis = widgets.filter((w) => w.kind === "kpi" || w.kind === "gauge").slice(0, 12);
  const out = await Promise.all(kpis.map((w) => resolveKpi(orgId, w, new Date())));
  return {
    lines: out.map((d, i) => `${kpis[i]!.title}: ${fmt(d.value, d.unit)}${d.delta != null ? ` (${d.delta > 0 ? "+" : ""}${d.delta} vs 7 days ago)` : ""}${d.note ? ` — ${d.note}` : ""}`),
    asOf: new Date().toISOString(),
  };
}
