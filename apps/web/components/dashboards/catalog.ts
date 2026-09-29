/**
 * Widget catalogue for custom dashboards (pure data — used by the builder UI,
 * the server-side resolver/sanitiser and the tests).
 *
 * Every widget is { id, kind, title, x, y, w, h, config }. `config` is a flat,
 * JSON-safe bag; each kind reads the keys it understands.
 */
import type { GridItem } from "./grid";

export type WidgetKind =
  | "kpi"
  | "gauge"
  | "timeseries"
  | "bar"
  | "map"
  | "table"
  | "hazards"
  | "notifications"
  | "forecast"
  | "note"
  | "explorer"
  | "embed";

export interface WidgetFilters {
  tags?: string[];
  types?: string[];
  countries?: string[];
}

export interface WidgetConfig {
  metric?: string;
  series?: string;
  dimension?: string;
  measure?: string;
  mapMode?: "points" | "choropleth";
  limit?: number;
  days?: number;
  sortDir?: "desc" | "asc";
  filters?: WidgetFilters;
  /** Colour thresholds in the metric's own unit (warn → amber, crit → red). */
  thresholds?: { warn: number | null; crit: number | null };
  place?: { lat: number; lon: number; name: string } | null;
  assetId?: string | null;
  text?: string;
  reportId?: string | null;
  url?: string | null;
}

export interface Widget extends GridItem {
  kind: WidgetKind;
  title: string;
  config: WidgetConfig;
}

export type Unit = "count" | "usd" | "pct" | "score" | "ratio";

export interface MetricDef {
  label: string;
  unit: Unit;
  explain: string;
  /** true → higher is worse (thresholds colour upwards) */
  higherIsWorse: boolean;
  thresholds?: { warn: number; crit: number };
  /** gauge range */
  max?: number;
  glossary?: string;
}

export const KPI_METRICS = {
  assets: { label: "Monitored assets", unit: "count", explain: "Active assets (plots, loans, facilities, communities) in this workspace that match the widget filters.", higherIsWorse: false, glossary: "asset" },
  exposure: { label: "Total exposure", unit: "usd", explain: "Sum of the financial value you entered for each asset — sum insured, loan outstanding, stock or replacement value.", higherIsWorse: false, glossary: "exposure" },
  var: { label: "Value at risk", unit: "usd", explain: "Expected-loss style indicator: value × (composite score / 100) × hazard-weighted mean damage ratio, summed over assets. For triage, not a regulatory VaR.", higherIsWorse: true, glossary: "var" },
  var_ratio: { label: "VaR / exposure", unit: "pct", explain: "Value at risk as a share of total exposure — how much of the book is currently threatened.", higherIsWorse: true, thresholds: { warn: 5, crit: 10 }, max: 25 },
  pct_at_risk: { label: "% assets at risk", unit: "pct", explain: "Share of assets whose composite score is at or above the workspace risk threshold (Settings).", higherIsWorse: true, thresholds: { warn: 15, crit: 30 }, max: 100, glossary: "risk_threshold" },
  at_risk: { label: "Assets at risk", unit: "count", explain: "Number of assets with a composite score at or above the workspace risk threshold.", higherIsWorse: true, glossary: "risk_threshold" },
  exposure_at_risk: { label: "Exposure at risk", unit: "usd", explain: "Total value of the assets that are above the risk threshold.", higherIsWorse: true },
  critical_assets: { label: "Critical assets", unit: "count", explain: "Assets whose composite score is 80 or more (critical band).", higherIsWorse: true, thresholds: { warn: 1, crit: 5 } },
  avg_composite: { label: "Average composite score", unit: "score", explain: "Mean 0-100 composite climate-risk score across the filtered assets. 35+ medium, 60+ high, 80+ critical.", higherIsWorse: true, thresholds: { warn: 35, crit: 60 }, max: 100, glossary: "composite_score" },
  flood_avg: { label: "Average flood score", unit: "score", explain: "Mean flood hazard score (0-100): forecast rain, soil saturation, river discharge and terrain.", higherIsWorse: true, thresholds: { warn: 35, crit: 60 }, max: 100, glossary: "flood_probability" },
  salinity_avg: { label: "Average salinity score", unit: "score", explain: "Mean salinity hazard score (0-100) — saltwater intrusion into soil and irrigation water.", higherIsWorse: true, thresholds: { warn: 35, crit: 60 }, max: 100, glossary: "salinity" },
  drought_avg: { label: "Average drought score", unit: "score", explain: "Mean drought hazard score (0-100) from the 7-day FAO-56 water balance.", higherIsWorse: true, thresholds: { warn: 35, crit: 60 }, max: 100, glossary: "drought" },
  heat_avg: { label: "Average heat score", unit: "score", explain: "Mean crop heat-stress score (0 at 32 °C, 100 at 42 °C+).", higherIsWorse: true, thresholds: { warn: 35, crit: 60 }, max: 100, glossary: "heat_stress" },
  active_alerts: { label: "Rules in alarm", unit: "count", explain: "Enabled alert rules whose conditions are met by at least one asset right now (regardless of cooldown).", higherIsWorse: true, thresholds: { warn: 1, crit: 3 }, glossary: "alert_rule" },
  rule_firings: { label: "Rule firings", unit: "count", explain: "Alert-rule notifications dispatched in the selected time range.", higherIsWorse: true, glossary: "alert_rule" },
  insured_sum: { label: "Sum insured", unit: "usd", explain: "Total sum insured across insured units (asset type 'Insured unit').", higherIsWorse: false, glossary: "sum_insured" },
  expected_loss: { label: "Annual expected loss", unit: "usd", explain: "Average annual loss of the insured book from the 30-year historical backtest (Insurance → Book). Shows 'not computed' until that backtest has run.", higherIsWorse: true, glossary: "aal" },
  observed_flooded: { label: "Observed flooded (satellite)", unit: "count", explain: "Assets under flood pixels in the latest Satellite Lab flood scan (NASA MODIS 2-day, ~250 m — coarse evidence).", higherIsWorse: true, thresholds: { warn: 1, crit: 5 } },
} satisfies Record<string, MetricDef>;
export type KpiMetric = keyof typeof KPI_METRICS;

export const SERIES = {
  composite: { label: "Average composite score (daily)", unit: "score", explain: "Daily mean composite score across the filtered assets (simple and exposure-weighted), from each asset's re-score history." },
  at_risk: { label: "Assets at risk (daily)", unit: "count", explain: "How many assets were at or above the risk threshold on each day." },
  var: { label: "Value at risk (daily)", unit: "usd", explain: "Daily value-at-risk indicator using each asset's composite that day and today's hazard mix." },
  firings: { label: "Rule firings per day", unit: "count", explain: "Alert-rule notifications dispatched per day." },
  notifications: { label: "Notifications per day", unit: "count", explain: "All workspace notifications (alerts, rules, reports, system) per day." },
  usage: { label: "Platform usage per day", unit: "count", explain: "Assessments, API calls, reports and Copilot messages metered per day since the server started." },
} satisfies Record<string, { label: string; unit: Unit; explain: string }>;
export type SeriesKey = keyof typeof SERIES;

export const BAR_DIMENSIONS = {
  histogram: { label: "Risk distribution (score bins)", explain: "Assets grouped into 10-point composite score bins." },
  level: { label: "Risk level", explain: "Low (<35), medium (35-59), high (60-79), critical (80+)." },
  hazard: { label: "Hazard", explain: "Flood, salinity, drought and heat — value at risk attributable to each, or average score." },
  country: { label: "Country", explain: "Assets grouped by country." },
  type: { label: "Asset type", explain: "Insured units, loans, farms, facilities, communities…" },
  crop: { label: "Crop", explain: "Assets grouped by main crop (where known)." },
  district: { label: "District", explain: "Assets grouped by the monitored district they fall in." },
  tag: { label: "Tag", explain: "Assets grouped by your own tags (an asset with two tags counts in both)." },
} as const;
export type BarDimension = keyof typeof BAR_DIMENSIONS;

export const BAR_MEASURES = {
  count: { label: "Number of assets", unit: "count" },
  exposure: { label: "Exposure", unit: "usd" },
  var: { label: "Value at risk", unit: "usd" },
  avg_composite: { label: "Average composite", unit: "score" },
} as const satisfies Record<string, { label: string; unit: Unit }>;
export type BarMeasure = keyof typeof BAR_MEASURES;

export const ASSET_METRICS = {
  composite: { label: "Composite score", unit: "score" },
  flood: { label: "Flood score", unit: "score" },
  salinity: { label: "Salinity score", unit: "score" },
  drought: { label: "Drought score", unit: "score" },
  heat: { label: "Heat score", unit: "score" },
  var: { label: "Value at risk", unit: "usd" },
  value: { label: "Exposure", unit: "usd" },
  change7d: { label: "7-day change", unit: "score" },
} as const satisfies Record<string, { label: string; unit: Unit }>;
export type AssetMetric = keyof typeof ASSET_METRICS;

export interface WidgetMeta {
  label: string;
  description: string;
  icon: string; // lucide icon name, resolved in the UI
  size: { w: number; h: number; minW: number; minH: number };
  defaults: WidgetConfig;
  defaultTitle: string;
}

export const WIDGETS: Record<WidgetKind, WidgetMeta> = {
  kpi: { label: "KPI tile", description: "One headline number with 7-day change, sparkline and colour thresholds.", icon: "Hash", size: { w: 3, h: 2, minW: 2, minH: 2 }, defaults: { metric: "var" }, defaultTitle: "Value at risk" },
  gauge: { label: "Gauge", description: "A percentage or 0-100 score on a dial with warn/critical bands.", icon: "Gauge", size: { w: 3, h: 3, minW: 2, minH: 3 }, defaults: { metric: "pct_at_risk" }, defaultTitle: "% assets at risk" },
  timeseries: { label: "Time series", description: "Daily history: composite trend, assets at risk, VaR, rule firings, usage.", icon: "LineChart", size: { w: 6, h: 4, minW: 3, minH: 3 }, defaults: { series: "composite", days: 30 }, defaultTitle: "30-day composite trend" },
  bar: { label: "Bar / histogram", description: "Risk distribution or exposure/VaR by hazard, country, type, crop, district or tag.", icon: "BarChart3", size: { w: 6, h: 4, minW: 3, minH: 3 }, defaults: { dimension: "histogram", measure: "count" }, defaultTitle: "Risk distribution" },
  map: { label: "Map", description: "Assets coloured by any metric, or a district choropleth.", icon: "Map", size: { w: 6, h: 5, minW: 3, minH: 3 }, defaults: { metric: "composite", mapMode: "points" }, defaultTitle: "Portfolio risk map" },
  table: { label: "Top-N table", description: "The N highest (or lowest) assets by any metric, with filters.", icon: "Table", size: { w: 6, h: 5, minW: 4, minH: 3 }, defaults: { metric: "var", limit: 8, sortDir: "desc" }, defaultTitle: "Top assets by value at risk" },
  hazards: { label: "Hazard feed", description: "Live GDACS / NASA EONET disasters near your assets.", icon: "Siren", size: { w: 4, h: 4, minW: 3, minH: 3 }, defaults: { limit: 6 }, defaultTitle: "Live hazards near assets" },
  notifications: { label: "Notifications", description: "Latest workspace alerts, rule firings and reports.", icon: "Bell", size: { w: 4, h: 4, minW: 3, minH: 3 }, defaults: { limit: 6 }, defaultTitle: "Latest notifications" },
  forecast: { label: "Forecast strip", description: "7-day weather outlook and risk context for a place or asset.", icon: "CloudRain", size: { w: 6, h: 3, minW: 4, minH: 3 }, defaults: { place: null, assetId: null }, defaultTitle: "7-day outlook" },
  note: { label: "Markdown note", description: "Your own text: context, instructions, links. Supports **bold**, lists and links.", icon: "StickyNote", size: { w: 4, h: 3, minW: 2, minH: 2 }, defaults: { text: "## Notes\n- Add context for your team here." }, defaultTitle: "Notes" },
  explorer: { label: "Explorer mini-report", description: "A saved Risk Explorer report: score, hazards and drivers for one location.", icon: "Compass", size: { w: 4, h: 4, minW: 3, minH: 3 }, defaults: { reportId: null }, defaultTitle: "Location report" },
  embed: { label: "Shared report", description: "Show a shared Explorer report (/r/…) or shared dashboard (/d/…) as a live card with a link to the full page.", icon: "Link2", size: { w: 4, h: 4, minW: 3, minH: 3 }, defaults: { url: null }, defaultTitle: "Shared report" },
};

export const WIDGET_KINDS = Object.keys(WIDGETS) as WidgetKind[];

export const REFRESH_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 30, label: "30 s" },
  { value: 60, label: "1 min" },
  { value: 300, label: "5 min" },
  { value: 900, label: "15 min" },
] as const;

/** Colour for a value given thresholds (null thresholds → neutral). */
export function thresholdTone(value: number | null | undefined, t: { warn: number | null; crit: number | null } | undefined, higherIsWorse = true): "ok" | "warn" | "crit" | "neutral" {
  if (value == null || !Number.isFinite(value) || !t || (t.warn == null && t.crit == null)) return "neutral";
  const beyond = (lim: number | null) => lim != null && (higherIsWorse ? value >= lim : value <= lim);
  if (beyond(t.crit)) return "crit";
  if (beyond(t.warn)) return "warn";
  return "ok";
}

export const TONE_COLOR = { ok: "#34d399", warn: "#fbbf24", crit: "#f87171", neutral: "#38bdf8" } as const;

/** Plain-language "What this shows" for a widget config (used in tooltips and share view). */
export function describeWidget(w: Pick<Widget, "kind" | "config">): string {
  const c = w.config;
  const f = c.filters;
  const scope = [f?.types?.length ? `types: ${f.types.join(", ")}` : null, f?.tags?.length ? `tags: ${f.tags.join(", ")}` : null, f?.countries?.length ? `countries: ${f.countries.join(", ")}` : null].filter(Boolean).join("; ");
  const scopeTxt = scope ? ` Filtered to ${scope}.` : " Covers every active asset in the workspace.";
  switch (w.kind) {
    case "kpi":
    case "gauge": {
      const m = KPI_METRICS[(c.metric ?? "var") as KpiMetric] ?? KPI_METRICS.var;
      return `${m.label}. ${m.explain}${scopeTxt}`;
    }
    case "timeseries": {
      const s = SERIES[(c.series ?? "composite") as SeriesKey] ?? SERIES.composite;
      return `${s.label} over the last ${c.days ?? 30} days. ${s.explain}${scopeTxt}`;
    }
    case "bar": {
      const d = BAR_DIMENSIONS[(c.dimension ?? "histogram") as BarDimension] ?? BAR_DIMENSIONS.histogram;
      const m = BAR_MEASURES[(c.measure ?? "count") as BarMeasure] ?? BAR_MEASURES.count;
      return `${m.label} by ${d.label.toLowerCase()}. ${d.explain}${scopeTxt}`;
    }
    case "map": {
      const m = ASSET_METRICS[(c.metric ?? "composite") as AssetMetric] ?? ASSET_METRICS.composite;
      return c.mapMode === "choropleth" ? `Districts shaded by the average ${m.label.toLowerCase()} of the assets inside them (districts without assets use the district's own live flood/salinity risk).${scopeTxt}` : `Each dot is an asset, coloured by ${m.label.toLowerCase()}.${scopeTxt}`;
    }
    case "table": {
      const m = ASSET_METRICS[(c.metric ?? "var") as AssetMetric] ?? ASSET_METRICS.var;
      return `The ${c.limit ?? 8} ${c.sortDir === "asc" ? "lowest" : "highest"} assets by ${m.label.toLowerCase()}.${scopeTxt}`;
    }
    case "hazards":
      return "Floods, cyclones and droughts reported by GDACS (UN/EC JRC) and NASA EONET in the last 45 days within 300 km of your assets.";
    case "notifications":
      return "The latest notifications in this workspace — rule firings, alerts, reports and system messages.";
    case "forecast":
      return "Daily rain and temperature outlook for the chosen place, with the current flood/salinity context of the nearest monitored district.";
    case "note":
      return "A free-text note written by your team.";
    case "explorer":
      return "A frozen Risk Explorer report for one location: composite score, hazard scores and the main drivers at the time it was saved.";
    case "embed":
      return "A shared, read-only report or dashboard shown as a summary card, with a link to open the full page.";
  }
}
