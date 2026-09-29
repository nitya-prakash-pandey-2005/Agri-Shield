/**
 * Portfolio & asset monitoring service (workspace SaaS layer).
 *
 *  - effectiveScore()        → latest risk for an asset (live assessment, or a district
 *                               baseline until the first re-score has run)
 *  - rescoreWorkspace()      → batched assessMany() → lastAssessment + 30/90-day history,
 *                               usage metering, realtime `portfolio.rescored`
 *  - portfolioSummary()      → KPIs, value-at-risk, movers, concentration, trend, hazard mix
 *  - evaluateWorkspaceRules()→ alert-rule engine (services/rules.ts) + dispatch to
 *                               in-app / e-mail / SMS / WhatsApp / signed webhook / Slack
 *  - createAssets / import / notes / tags / weekly digest
 *
 * ── Value-at-risk (VaR) formula ───────────────────────────────────────────
 *   For each asset i with exposure Vᵢ (USD) and hazard scores hᵢ = {flood, salinity, drought, heat} (0-100):
 *
 *     likelihoodᵢ   = compositeᵢ / 100                         (0-1, forecast-window likelihood proxy)
 *     wᵢ,h          = hᵢ,h / Σₕ hᵢ,h                            (hazard mix of the site)
 *     MDRᵢ          = Σₕ wᵢ,h · MDRₕ                             (mean damage ratio given an event)
 *     VaRᵢ          = Vᵢ · likelihoodᵢ · MDRᵢ
 *     Portfolio VaR = Σᵢ VaRᵢ          VaR by hazard h = Σᵢ Vᵢ · likelihoodᵢ · wᵢ,h · MDRₕ
 *
 *   MDRₕ (share of exposure lost when the hazard materialises) — engineering defaults
 *   for smallholder agriculture, tunable per workspace later:
 *     flood 0.45 (multi-day paddy inundation), drought 0.35, salinity 0.30, heat 0.20.
 *   This is an expected-loss style indicator for triage and disclosure, not a regulatory
 *   (Basel/Solvency) VaR quantile; every figure is tagged with its source.
 */
import { latestSensorMetrics, type AssetSensorMetrics } from "./iot-analytics";
import { iotReady } from "./iot-service";
import { createHmac, randomUUID } from "node:crypto";
import type { AssetType, CropType } from "@agri-shield/types";
import { audit, getStore, nextId, riskLevelFromScore, type AlertRuleRecord, type AssetRecord, type UserRecord } from "../data/store";
import { publish, type RealtimeEvent } from "../realtime";
import { sendEmail, sendSms, sendWhatsApp } from "../notify/channels";
import { OFFLINE } from "../live/http";
import { assessMany, compositeScore, exposurePriors, haversineKm, type QuickAssessment } from "./location-risk";
import { notifyWorkspace, emailHtml } from "./workspace-notifications";
import { trackUsage, enforceLimit } from "./usage";
import { geocodeAddress, reverseGeocode } from "../live/portfolio-geocode";
import { parseImport, type DraftAsset, type ExportAsset, type ParseResult } from "./portfolio-io";
import {
  METRICS,
  evaluateRule,
  explainResults,
  signWebhook,
  slackMessage,
  smsText,
  snapshotFrom,
  webhookPayload,
  type MetricSnapshot,
  type RuleEvaluation,
} from "./rules";

// ─── State (in-memory, alongside the store) ───────────────────────────────

export interface AssetNote {
  id: string;
  assetId: string;
  workspaceId: string;
  userId: string;
  userName: string;
  text: string;
  at: Date;
}

export interface Delivery {
  channel: "app" | "email" | "sms" | "whatsapp" | "webhook" | "slack";
  to: string;
  status: "sent" | "simulated" | "failed" | "skipped";
  detail?: string;
  httpStatus?: number | null;
}

export interface RuleFiring {
  id: string;
  ruleId: string;
  ruleName: string;
  workspaceId: string;
  at: Date;
  severity: AlertRuleRecord["severity"];
  trigger: "monitor" | "manual" | "rescore" | "test";
  triggeredBy: string;
  matchCount: number;
  matches: { assetId: string; name: string; reason: string; metrics: Partial<MetricSnapshot> }[];
  deliveries: Delivery[];
  notificationId: string | null;
}

export type QuickSnapshot = QuickAssessment & { at: Date };

interface PortfolioState {
  quick: Map<string, QuickSnapshot>;
  notes: Map<string, AssetNote[]>;
  firings: RuleFiring[];
  tagMeta: Map<string, Record<string, { color: string; description: string }>>;
  ruleExtras: Map<string, { slackUrl: string | null }>;
  lastRescore: Map<string, { at: Date; count: number; durationMs: number; live: number; fallback: number; trigger: string }>;
  rescoring: Map<string, Promise<RescoreResult>>;
  autoScoredAt: Map<string, number>;
  digestSent: Map<string, string>;
}

const g = globalThis as unknown as { __agriPortfolio?: PortfolioState };
export const portfolioState: PortfolioState = (g.__agriPortfolio ??= {
  quick: new Map(),
  notes: new Map(),
  firings: [],
  tagMeta: new Map(),
  ruleExtras: new Map(),
  lastRescore: new Map(),
  rescoring: new Map(),
  autoScoredAt: new Map(),
  digestSent: new Map(),
});

function wsPublish(workspaceId: string, event: Record<string, unknown> & { type: string }) {
  publish(`ws:${workspaceId}`, event as unknown as RealtimeEvent);
}

// ─── Scores & value-at-risk ───────────────────────────────────────────────

export const MEAN_DAMAGE_RATIO = { flood: 0.45, salinity: 0.3, drought: 0.35, heat: 0.2 } as const;
export type Hazard = keyof typeof MEAN_DAMAGE_RATIO;
export const HAZARDS: Hazard[] = ["flood", "salinity", "drought", "heat"];

export interface HazardScores {
  composite: number;
  flood: number;
  salinity: number;
  drought: number;
  heat: number;
}

/** Hazard weights wₕ = hₕ / Σ h (equal weights when every score is 0). */
export function hazardWeights(s: HazardScores): Record<Hazard, number> {
  const tot = s.flood + s.salinity + s.drought + s.heat;
  if (tot <= 0) return { flood: 0.25, salinity: 0.25, drought: 0.25, heat: 0.25 };
  return { flood: s.flood / tot, salinity: s.salinity / tot, drought: s.drought / tot, heat: s.heat / tot };
}

/** likelihood × Σ wₕ·MDRₕ  (0 – 0.45) */
export function damageFactor(s: HazardScores): number {
  const w = hazardWeights(s);
  const mdr = HAZARDS.reduce((t, h) => t + w[h] * MEAN_DAMAGE_RATIO[h], 0);
  return Math.max(0, Math.min(1, s.composite / 100)) * mdr;
}

export function valueAtRisk(valueUsd: number, s: HazardScores): number {
  return Math.max(0, valueUsd) * damageFactor(s);
}

export function valueAtRiskByHazard(valueUsd: number, s: HazardScores): Record<Hazard, number> {
  const w = hazardWeights(s);
  const like = Math.max(0, Math.min(1, s.composite / 100)) * Math.max(0, valueUsd);
  return { flood: like * w.flood * MEAN_DAMAGE_RATIO.flood, salinity: like * w.salinity * MEAN_DAMAGE_RATIO.salinity, drought: like * w.drought * MEAN_DAMAGE_RATIO.drought, heat: like * w.heat * MEAN_DAMAGE_RATIO.heat };
}

export function portfolioVaR(items: { valueUsd: number; scores: HazardScores }[]) {
  const byHazard: Record<Hazard, number> = { flood: 0, salinity: 0, drought: 0, heat: 0 };
  let total = 0;
  let exposure = 0;
  for (const it of items) {
    exposure += Math.max(0, it.valueUsd);
    total += valueAtRisk(it.valueUsd, it.scores);
    const bh = valueAtRiskByHazard(it.valueUsd, it.scores);
    for (const h of HAZARDS) byHazard[h] += bh[h];
  }
  return { total, exposure, byHazard, ratio: exposure > 0 ? total / exposure : 0 };
}

export interface EffectiveScore extends HazardScores {
  level: "low" | "medium" | "high" | "critical";
  drivers: string[];
  at: Date | null;
  source: "live" | "fallback" | "baseline";
}

export function effectiveScore(a: AssetRecord): EffectiveScore {
  const la = a.lastAssessment;
  if (la) {
    return { composite: la.composite, flood: la.floodRisk, salinity: la.salinityRisk, drought: la.droughtRisk, heat: la.heatRisk, level: la.level, drivers: la.drivers, at: la.at, source: la.source === "fallback" ? "fallback" : "live" };
  }
  const s = getStore();
  const d = (a.districtId && s.districts.find((x) => x.id === a.districtId)) || exposurePriors(a.lat, a.lon).district;
  let flood = d ? Math.round(d.floodRisk) : 30;
  let salinity = d ? Math.round(d.salinityRisk) : 10;
  let drought = 15;
  let heat = 10;
  const prior = compositeScore({ flood, salinity, drought, heat });
  let composite = prior;
  if (a.history.length) {
    // Keep the district's hazard mix but scale it to the asset's own last recorded composite,
    // so hazard scores and the overall score never contradict each other.
    composite = a.history[a.history.length - 1]!.composite;
    const k = prior > 0 ? composite / prior : 1;
    const sc = (v: number) => Math.max(0, Math.min(100, Math.round(v * k)));
    flood = sc(flood);
    salinity = sc(salinity);
    drought = sc(drought);
    heat = sc(heat);
  }
  return { composite, flood, salinity, drought, heat, level: riskLevelFromScore(composite), drivers: ["District baseline — awaiting first live re-score"], at: null, source: "baseline" };
}

/** Composite change vs ~7 days ago (history), null when no history. */
export function change7d(a: AssetRecord, current: number, now = new Date()): number | null {
  if (!a.history.length) return null;
  const target = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  let past: number | null = null;
  for (const h of a.history) if (h.date <= target) past = h.composite;
  if (past == null) past = a.history[0]!.composite;
  return current - past;
}

export function snapshotForAsset(a: AssetRecord): MetricSnapshot {
  const q = portfolioState.quick.get(a.id);
  const e = effectiveScore(a);
  const snap = q ? snapshotFrom(q, null) : snapshotFrom(null, { floodRisk: e.flood, salinityRisk: e.salinity, droughtRisk: e.drought, heatRisk: e.heat, composite: e.composite });
  // Merge ground truth from linked IoT sensors (fresh, non-faulty readings only)
  const s = sensorMetricsFor(a.workspaceId)[a.id];
  if (s) {
    snap.sensor_water_level_m = s.water_level_m;
    snap.sensor_water_rise_6h_m = s.water_level_rise_6h_m;
    snap.sensor_soil_ec = s.soil_ec;
    snap.sensor_soil_moisture = s.soil_moisture;
  }
  return snap;
}

/** Per-workspace sensor metrics, memoised for 30 s so rule evaluation over many assets stays cheap. */
const sensorMemo = new Map<string, { at: number; data: Record<string, AssetSensorMetrics> }>();
function sensorMetricsFor(orgId: string): Record<string, AssetSensorMetrics> {
  const hit = sensorMemo.get(orgId);
  if (hit && Date.now() - hit.at < 30_000) return hit.data;
  let data: Record<string, AssetSensorMetrics> = {};
  try {
    // Read-only: never boot the sensor fleet from inside rule evaluation
    if (iotReady()) data = latestSensorMetrics(orgId);
  } catch {
    data = {};
  }
  sensorMemo.set(orgId, { at: Date.now(), data });
  return data;
}

// ─── Queries ──────────────────────────────────────────────────────────────

export function workspaceAssets(ws: string, includeArchived = false): AssetRecord[] {
  return getStore().assets.filter((a) => a.workspaceId === ws && (includeArchived || a.status === "active"));
}

export function riskThreshold(ws: string): number {
  return getStore().orgs.find((o) => o.id === ws)?.settings?.riskThreshold ?? 60;
}

export interface AssetFilters {
  types?: AssetType[];
  tags?: string[];
  countries?: string[];
  levels?: ("low" | "medium" | "high" | "critical")[];
  search?: string;
  status?: "active" | "archived" | "all";
  ids?: string[];
}

export type SortKey = "name" | "composite" | "value" | "var" | "change7d" | "createdAt" | "type" | "country" | "flood" | "salinity" | "drought" | "heat";

export interface AssetRow {
  id: string;
  name: string;
  type: AssetType;
  externalRef: string | null;
  lat: number;
  lon: number;
  country: string;
  districtId: string | null;
  districtName: string | null;
  crop: CropType | null;
  areaHa: number | null;
  valueUsd: number;
  tags: string[];
  status: "active" | "archived";
  composite: number;
  level: EffectiveScore["level"];
  flood: number;
  salinity: number;
  drought: number;
  heat: number;
  drivers: string[];
  change7d: number | null;
  varUsd: number;
  spark: number[];
  assessedAt: Date | null;
  source: EffectiveScore["source"];
  createdAt: Date;
}

export function toRow(a: AssetRecord): AssetRow {
  const e = effectiveScore(a);
  const d = a.districtId ? getStore().districts.find((x) => x.id === a.districtId) : null;
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    externalRef: a.externalRef,
    lat: a.lat,
    lon: a.lon,
    country: a.country,
    districtId: a.districtId,
    districtName: d?.name ?? null,
    crop: a.crop,
    areaHa: a.areaHa,
    valueUsd: a.valueUsd,
    tags: a.tags,
    status: a.status,
    composite: e.composite,
    level: e.level,
    flood: e.flood,
    salinity: e.salinity,
    drought: e.drought,
    heat: e.heat,
    drivers: e.drivers,
    change7d: change7d(a, e.composite),
    varUsd: Math.round(valueAtRisk(a.valueUsd, e)),
    spark: a.history.slice(-30).map((h) => h.composite),
    assessedAt: e.at,
    source: e.source,
    createdAt: a.createdAt,
  };
}

export function filterAssets(ws: string, f: AssetFilters = {}): AssetRecord[] {
  const q = f.search?.trim().toLowerCase();
  const status = f.status ?? "active";
  const idSet = f.ids?.length ? new Set(f.ids) : null;
  return getStore().assets.filter((a) => {
    if (a.workspaceId !== ws) return false;
    if (status !== "all" && a.status !== status) return false;
    if (idSet && !idSet.has(a.id)) return false;
    if (f.types?.length && !f.types.includes(a.type)) return false;
    if (f.tags?.length && !f.tags.some((t) => a.tags.includes(t))) return false;
    if (f.countries?.length && !f.countries.includes(a.country)) return false;
    if (f.levels?.length && !f.levels.includes(effectiveScore(a).level)) return false;
    if (q && !`${a.name} ${a.externalRef ?? ""} ${a.address ?? ""} ${a.tags.join(" ")} ${a.country} ${a.crop ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function listAssetRows(ws: string, f: AssetFilters, sort: { key: SortKey; dir: "asc" | "desc" }, page: number, pageSize: number) {
  const rows = filterAssets(ws, f).map(toRow);
  const dir = sort.dir === "asc" ? 1 : -1;
  const val = (r: AssetRow): string | number => {
    switch (sort.key) {
      case "name":
        return r.name.toLowerCase();
      case "composite":
        return r.composite;
      case "value":
        return r.valueUsd;
      case "var":
        return r.varUsd;
      case "change7d":
        return r.change7d ?? 0;
      case "createdAt":
        return new Date(r.createdAt).getTime();
      case "type":
        return r.type;
      case "country":
        return r.country;
      case "flood":
      case "salinity":
      case "drought":
      case "heat":
        return r[sort.key];
    }
  };
  rows.sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.name.localeCompare(b.name);
  });
  const all = workspaceAssets(ws, f.status === "archived" || f.status === "all");
  const facet = (key: (a: AssetRecord) => string[]) => {
    const m = new Map<string, number>();
    for (const a of all) for (const k of key(a)) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  };
  return {
    total: rows.length,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(rows.length / pageSize)),
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    totals: { exposure: rows.reduce((s, r) => s + r.valueUsd, 0), varUsd: rows.reduce((s, r) => s + r.varUsd, 0) },
    facets: { types: facet((a) => [a.type]), tags: facet((a) => a.tags), countries: facet((a) => [a.country]), levels: facet((a) => [effectiveScore(a).level]) },
    archivedCount: getStore().assets.filter((a) => a.workspaceId === ws && a.status === "archived").length,
  };
}

// ─── Summary ──────────────────────────────────────────────────────────────

export function portfolioSummary(ws: string) {
  const s = getStore();
  const assets = workspaceAssets(ws);
  const threshold = riskThreshold(ws);
  const rows = assets.map((a) => ({ a, e: effectiveScore(a) }));
  const byType: Record<string, { count: number; exposure: number; varUsd: number }> = {};
  const byLevel = { low: 0, medium: 0, high: 0, critical: 0 };
  const exposureByLevel = { low: 0, medium: 0, high: 0, critical: 0 };
  const histogram = Array.from({ length: 10 }, (_, i) => ({ bin: `${i * 10}-${i * 10 + 9}`, from: i * 10, count: 0, exposure: 0 }));
  const byDistrict = new Map<string, { key: string; label: string; country: string; count: number; exposure: number; varUsd: number; compositeSum: number }>();
  const byCountry = new Map<string, { key: string; label: string; count: number; exposure: number; varUsd: number }>();
  const dominant: Record<Hazard, number> = { flood: 0, salinity: 0, drought: 0, heat: 0 };
  const hazardWeighted: Record<Hazard, number> = { flood: 0, salinity: 0, drought: 0, heat: 0 };
  let atRisk = 0;
  let exposureAtRisk = 0;
  let live = 0;
  let baseline = 0;
  let fallbackN = 0;
  const varItems: { valueUsd: number; scores: HazardScores }[] = [];
  const movers: { id: string; name: string; type: AssetType; composite: number; change: number; level: string; valueUsd: number; driver: string }[] = [];

  for (const { a, e } of rows) {
    const v = valueAtRisk(a.valueUsd, e);
    varItems.push({ valueUsd: a.valueUsd, scores: e });
    const t = (byType[a.type] ??= { count: 0, exposure: 0, varUsd: 0 });
    t.count++;
    t.exposure += a.valueUsd;
    t.varUsd += v;
    byLevel[e.level]++;
    exposureByLevel[e.level] += a.valueUsd;
    const bin = histogram[Math.min(9, Math.floor(e.composite / 10))]!;
    bin.count++;
    bin.exposure += a.valueUsd;
    if (e.composite >= threshold) {
      atRisk++;
      exposureAtRisk += a.valueUsd;
    }
    if (e.source === "baseline") baseline++;
    else if (e.source === "fallback") fallbackN++;
    else live++;
    const dName = a.districtId ? s.districts.find((d) => d.id === a.districtId)?.name ?? a.districtId : `${a.country} (other)`;
    const dk = a.districtId ?? `other:${a.country}`;
    const dd = byDistrict.get(dk) ?? { key: dk, label: dName, country: a.country, count: 0, exposure: 0, varUsd: 0, compositeSum: 0 };
    dd.count++;
    dd.exposure += a.valueUsd;
    dd.varUsd += v;
    dd.compositeSum += e.composite;
    byDistrict.set(dk, dd);
    const cc = byCountry.get(a.country) ?? { key: a.country, label: a.country, count: 0, exposure: 0, varUsd: 0 };
    cc.count++;
    cc.exposure += a.valueUsd;
    cc.varUsd += v;
    byCountry.set(a.country, cc);
    const top = HAZARDS.reduce((b, h) => (e[h] > e[b] ? h : b), "flood" as Hazard);
    dominant[top]++;
    for (const h of HAZARDS) hazardWeighted[h] += e[h] * a.valueUsd;
    const ch = change7d(a, e.composite);
    if (ch != null) movers.push({ id: a.id, name: a.name, type: a.type, composite: e.composite, change: ch, level: e.level, valueUsd: a.valueUsd, driver: e.drivers[0] ?? "" });
  }

  const pv = portfolioVaR(varItems);
  const totalExposure = pv.exposure;
  const hhi = totalExposure > 0 ? [...byDistrict.values()].reduce((t, d) => t + (d.exposure / totalExposure) ** 2, 0) : 0;

  // 30-day trend: mean composite per day across assets (simple + exposure-weighted)
  const days = new Map<string, { sum: number; n: number; wsum: number; w: number }>();
  for (const { a } of rows)
    for (const h of a.history.slice(-30)) {
      const d = days.get(h.date) ?? { sum: 0, n: 0, wsum: 0, w: 0 };
      d.sum += h.composite;
      d.n++;
      d.wsum += h.composite * a.valueUsd;
      d.w += a.valueUsd;
      days.set(h.date, d);
    }
  const trend = [...days.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .slice(-30)
    .map(([date, d]) => ({ date, avg: Math.round((d.sum / d.n) * 10) / 10, weighted: d.w > 0 ? Math.round((d.wsum / d.w) * 10) / 10 : null, assets: d.n }));

  movers.sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
  const last = portfolioState.lastRescore.get(ws) ?? null;
  const org = s.orgs.find((o) => o.id === ws);
  return {
    workspace: { id: ws, name: org?.name ?? ws, currency: org?.settings?.currency ?? "USD", center: org?.settings?.defaultCenter ?? null, zoom: org?.settings?.defaultZoom ?? null, industry: org?.industry ?? null },
    counts: { assets: assets.length, archived: s.assets.filter((a) => a.workspaceId === ws && a.status === "archived").length, live, baseline: baseline + fallbackN },
    liveFeed: last ? (last.live > 0 ? "ok" : last.fallback > 0 ? "unavailable" : "ok") : "pending",
    threshold,
    kpis: {
      totalExposureUsd: Math.round(totalExposure),
      valueAtRiskUsd: Math.round(pv.total),
      varRatio: Math.round(pv.ratio * 10000) / 100,
      atRisk,
      pctAtRisk: assets.length ? Math.round((atRisk / assets.length) * 1000) / 10 : 0,
      exposureAtRiskUsd: Math.round(exposureAtRisk),
      avgComposite: assets.length ? Math.round((rows.reduce((t, r) => t + r.e.composite, 0) / assets.length) * 10) / 10 : 0,
    },
    byType: Object.entries(byType)
      .map(([type, v]) => ({ type, ...v, varUsd: Math.round(v.varUsd) }))
      .sort((a, b) => b.exposure - a.exposure),
    byLevel,
    exposureByLevel,
    histogram,
    topMovers: movers.slice(0, 10),
    concentration: {
      hhi: Math.round(hhi * 1000) / 1000,
      byDistrict: [...byDistrict.values()]
        .map((d) => ({ key: d.key, label: d.label, country: d.country, count: d.count, exposure: Math.round(d.exposure), varUsd: Math.round(d.varUsd), share: totalExposure > 0 ? Math.round((d.exposure / totalExposure) * 1000) / 10 : 0, avgComposite: Math.round(d.compositeSum / d.count) }))
        .sort((a, b) => b.exposure - a.exposure)
        .slice(0, 12),
      byCountry: [...byCountry.values()].map((c) => ({ ...c, exposure: Math.round(c.exposure), varUsd: Math.round(c.varUsd), share: totalExposure > 0 ? Math.round((c.exposure / totalExposure) * 1000) / 10 : 0 })).sort((a, b) => b.exposure - a.exposure),
    },
    trend,
    hazardMix: HAZARDS.map((h) => ({
      hazard: h,
      avgScore: totalExposure > 0 ? Math.round(hazardWeighted[h] / totalExposure) : 0,
      varUsd: Math.round(pv.byHazard[h]),
      dominantCount: dominant[h],
      mdr: MEAN_DAMAGE_RATIO[h],
    })),
    lastRescore: last,
    rescoring: portfolioState.rescoring.has(ws),
    methodology: {
      var: "VaR = Σ value × (composite/100) × Σₕ (hazard share × mean damage ratio). Mean damage ratios: flood 45 %, drought 35 %, salinity 30 %, heat 20 %.",
      atRisk: `An asset is "at risk" when its composite score is ≥ ${threshold} (workspace setting).`,
      movers: "Change = today's composite minus the composite 7 days ago (daily history).",
    },
  };
}

// ─── Re-scoring ───────────────────────────────────────────────────────────

export interface RescoreResult {
  workspaceId: string;
  count: number;
  live: number;
  /** assets whose live feed was unavailable (last known score kept) */
  fallback: number;
  /** distinct ~5 km forecast cells queried */
  cells: number;
  levelChanges: { id: string; name: string; from: string | null; to: string }[];
  durationMs: number;
  at: Date;
}

const HISTORY_DAYS = 90;
/** Assets within the same 0.05° (~5 km) cell share one forecast lookup. */
const GRID_DEG = 0.05;

function applyAssessment(a: AssetRecord, q: QuickAssessment, at: Date) {
  a.lastAssessment = { at, floodRisk: q.floodRisk, salinityRisk: q.salinityRisk, droughtRisk: q.droughtRisk, heatRisk: q.heatRisk, composite: q.composite, level: q.level, drivers: q.drivers, source: q.source };
  const date = at.toISOString().slice(0, 10);
  const last = a.history[a.history.length - 1];
  if (last && last.date === date) last.composite = q.composite;
  else a.history.push({ date, composite: q.composite });
  if (a.history.length > HISTORY_DAYS) a.history.splice(0, a.history.length - HISTORY_DAYS);
  portfolioState.quick.set(a.id, { ...q, at });
}

/**
 * Re-assess a workspace's active assets (all, or `assetIds`) with the batched
 * location engine. Full re-scores are single-flight per workspace.
 */
export async function rescoreWorkspace(ws: string, opts: { assetIds?: string[]; trigger?: string; by?: string } = {}): Promise<RescoreResult> {
  const full = !opts.assetIds?.length;
  if (full) {
    const running = portfolioState.rescoring.get(ws);
    if (running) return running;
  }
  const p = (async () => {
    const t0 = Date.now();
    const ids = opts.assetIds ? new Set(opts.assetIds) : null;
    const assets = workspaceAssets(ws).filter((a) => !ids || ids.has(a.id));
    // Share one forecast call per ~5 km grid cell (keeps Open-Meteo usage low for dense books)
    const cells = new Map<string, { id: string; lat: number; lon: number; crop: CropType | null }>();
    const cellOf = new Map<string, string>();
    for (const a of assets) {
      const key = `${Math.round(a.lat / GRID_DEG) * GRID_DEG}|${Math.round(a.lon / GRID_DEG) * GRID_DEG}|${a.crop ?? ""}`;
      if (!cells.has(key)) cells.set(key, { id: key, lat: a.lat, lon: a.lon, crop: a.crop });
      cellOf.set(a.id, key);
    }
    const byCell = cells.size ? await assessMany([...cells.values()]) : new Map<string, QuickAssessment>();
    const at = new Date();
    let live = 0;
    let fallback = 0;
    let count = 0;
    const levelChanges: RescoreResult["levelChanges"] = [];
    for (const a of assets) {
      const q = byCell.get(cellOf.get(a.id)!);
      if (!q) continue;
      count++;
      if (q.source === "fallback") {
        // Live feed unavailable: keep the last known (live or baseline) score rather than overwrite it
        fallback++;
        continue;
      }
      live++;
      const before = a.lastAssessment?.level ?? effectiveScore(a).level;
      applyAssessment(a, q, at);
      if (before !== q.level) levelChanges.push({ id: a.id, name: a.name, from: before, to: q.level });
    }
    if (live) trackUsage(ws, "assessments", live);
    const out: RescoreResult = { workspaceId: ws, count, live, fallback, cells: cells.size, levelChanges, durationMs: Date.now() - t0, at };
    if (full || assets.length >= 5) portfolioState.lastRescore.set(ws, { at, count, durationMs: out.durationMs, live, fallback, trigger: opts.trigger ?? "manual" });
    wsPublish(ws, { type: "portfolio.rescored", workspaceId: ws, count, live, fallback, at: at.toISOString() });
    return out;
  })();
  if (full) {
    portfolioState.rescoring.set(ws, p);
    p.finally(() => portfolioState.rescoring.delete(ws)).catch(() => {});
  }
  return p;
}

/** First visit to a workspace: kick off a background live re-score if nothing has been scored yet. */
export function ensureScored(ws: string) {
  if (OFFLINE || portfolioState.rescoring.has(ws)) return;
  const last = portfolioState.autoScoredAt.get(ws) ?? 0;
  if (Date.now() - last < 15 * 60_000) return;
  const assets = workspaceAssets(ws);
  if (!assets.length || assets.every((a) => a.lastAssessment)) return;
  portfolioState.autoScoredAt.set(ws, Date.now());
  rescoreWorkspace(ws, { trigger: "auto", by: "system" }).catch((e) => console.warn("[portfolio] auto re-score failed:", (e as Error).message));
}

// ─── Asset CRUD ───────────────────────────────────────────────────────────

export interface NewAssetInput {
  name: string;
  type: AssetType;
  lat?: number | null;
  lon?: number | null;
  address?: string | null;
  country?: string | null;
  valueUsd?: number;
  crop?: CropType | null;
  externalRef?: string | null;
  tags?: string[];
  areaHa?: number | null;
  meta?: Record<string, string | number | boolean | null>;
}

export class PortfolioError extends Error {
  constructor(
    public code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND",
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

/** Existing active asset that would duplicate this one (same ref, or same name within 50 m, or any asset within 5 m). */
export function findDuplicate(ws: string, d: { name: string; lat: number; lon: number; externalRef?: string | null }, ignoreId?: string): AssetRecord | null {
  const ref = d.externalRef?.trim().toLowerCase();
  for (const a of workspaceAssets(ws)) {
    if (a.id === ignoreId) continue;
    if (ref && a.externalRef?.toLowerCase() === ref) return a;
    const km = haversineKm(a.lat, a.lon, d.lat, d.lon);
    if (km < 0.005) return a;
    if (km < 0.05 && a.name.trim().toLowerCase() === d.name.trim().toLowerCase()) return a;
  }
  return null;
}

async function locate(lat: number, lon: number, country: string | null | undefined): Promise<{ districtId: string | null; country: string }> {
  const pri = exposurePriors(lat, lon);
  const districtId = pri.district && (pri.km ?? 999) < 80 ? pri.district.id : null;
  if (country) return { districtId, country };
  if (pri.district && (pri.km ?? 999) < 150) return { districtId, country: pri.district.countryName };
  const rev = await reverseGeocode(lat, lon);
  return { districtId, country: rev.country ?? "Unknown" };
}

function buildAsset(ws: string, userId: string, input: NewAssetInput & { lat: number; lon: number }, where: { districtId: string | null; country: string }): AssetRecord {
  return {
    id: nextId("ast"),
    workspaceId: ws,
    type: input.type,
    name: input.name.trim(),
    externalRef: input.externalRef?.trim() || null,
    lat: Math.round(input.lat * 1e6) / 1e6,
    lon: Math.round(input.lon * 1e6) / 1e6,
    address: input.address?.trim() || null,
    districtId: where.districtId,
    country: where.country,
    areaHa: input.areaHa ?? null,
    crop: input.crop ?? null,
    valueUsd: Math.max(0, Math.round((input.valueUsd ?? 0) * 100) / 100),
    tags: [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))],
    meta: input.meta ?? {},
    status: "active",
    createdAt: new Date(),
    createdBy: userId,
    lastAssessment: null,
    history: [],
  };
}

export function validCoords(lat: unknown, lon: unknown): lat is number {
  return typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

export async function createAsset(ws: string, user: { id: string; name: string }, input: NewAssetInput, opts: { allowDuplicate?: boolean; score?: boolean } = {}): Promise<AssetRecord> {
  let { lat, lon } = input;
  let address = input.address ?? null;
  let country = input.country ?? null;
  if ((lat == null || lon == null) && address) {
    const hit = await geocodeAddress(address);
    if (!hit) throw new PortfolioError("BAD_REQUEST", `Could not find "${address}" — enter coordinates or pick a place from search.`);
    lat = hit.lat;
    lon = hit.lon;
    country ??= hit.country;
  }
  if (!validCoords(lat, lon)) throw new PortfolioError("BAD_REQUEST", "Valid coordinates are required (latitude −90…90, longitude −180…180, not 0,0).");
  const dup = findDuplicate(ws, { name: input.name, lat: lat!, lon: lon!, externalRef: input.externalRef });
  if (dup && !opts.allowDuplicate) throw new PortfolioError("CONFLICT", `Looks like a duplicate of "${dup.name}" (${dup.externalRef ?? dup.id}).`, { duplicateId: dup.id });
  enforceLimit(ws, "assets", 1);
  const where = await locate(lat!, lon!, country);
  const asset = buildAsset(ws, user.id, { ...input, lat: lat!, lon: lon!, address }, where);
  getStore().assets.push(asset);
  audit({ userId: user.id, userName: user.name, action: "asset.create", entity: "asset", entityId: asset.id, details: `${asset.name} (${asset.type}) @ ${asset.lat},${asset.lon}` });
  if (opts.score !== false) await rescoreWorkspace(ws, { assetIds: [asset.id], trigger: "create", by: user.id }).catch(() => null);
  return asset;
}

export function getWorkspaceAsset(ws: string, id: string): AssetRecord {
  const a = getStore().assets.find((x) => x.id === id && x.workspaceId === ws);
  if (!a) throw new PortfolioError("NOT_FOUND", "Asset not found in this workspace");
  return a;
}

// ─── Import ───────────────────────────────────────────────────────────────

export const GEOCODE_LIMIT_PER_IMPORT = 40;

export function defaultAssetType(ws: string): AssetType {
  const ind = getStore().orgs.find((o) => o.id === ws)?.industry;
  return ind === "insurance" ? "insured_plot" : ind === "banking" ? "loan" : ind === "ngo" || ind === "government" ? "community" : ind === "agribusiness" ? "warehouse" : "farm";
}

export function previewImport(ws: string, text: string, format: "csv" | "geojson" | "auto", defaultType?: AssetType): ParseResult & { duplicatesInWorkspace: { row: number; existingId: string; existingName: string }[] } {
  const res = parseImport(text, { format, defaultType: defaultType ?? defaultAssetType(ws) });
  const duplicatesInWorkspace: { row: number; existingId: string; existingName: string }[] = [];
  for (const r of res.rows) {
    if (r.errors.length || r.asset.lat == null || r.asset.lon == null) continue;
    const dup = findDuplicate(ws, { name: r.asset.name, lat: r.asset.lat, lon: r.asset.lon, externalRef: r.asset.externalRef });
    if (dup) {
      r.warnings.push(`Already in portfolio as "${dup.name}" — will be skipped`);
      duplicatesInWorkspace.push({ row: r.row, existingId: dup.id, existingName: dup.name });
    }
  }
  if (res.geocodeCount > GEOCODE_LIMIT_PER_IMPORT) {
    let n = 0;
    for (const r of res.rows) if (!r.errors.length && r.needsGeocode && ++n > GEOCODE_LIMIT_PER_IMPORT) r.warnings.push(`Over the ${GEOCODE_LIMIT_PER_IMPORT}-address geocoding limit per import — add coordinates or import in smaller batches`);
  }
  return { ...res, duplicatesInWorkspace };
}

export async function commitImport(
  ws: string,
  user: { id: string; name: string },
  text: string,
  opts: { format: "csv" | "geojson" | "auto"; defaultType?: AssetType; extraTags?: string[]; skipDuplicates?: boolean }
) {
  const parsed = parseImport(text, { format: opts.format, defaultType: opts.defaultType ?? defaultAssetType(ws) });
  if (parsed.fatal) throw new PortfolioError("BAD_REQUEST", parsed.fatal);
  const good = parsed.rows.filter((r) => !r.errors.length);
  if (!good.length) throw new PortfolioError("BAD_REQUEST", "No valid rows to import — fix the errors shown in the preview.");
  enforceLimit(ws, "assets", good.length);
  const created: string[] = [];
  const skipped: { row: number; reason: string }[] = parsed.rows.filter((r) => r.errors.length).map((r) => ({ row: r.row, reason: r.errors.join("; ") }));
  let geocoded = 0;
  let geocodeAttempts = 0;
  for (const r of good) {
    const d: DraftAsset = r.asset;
    let { lat, lon } = d;
    let country = d.country;
    if ((lat == null || lon == null) && d.address) {
      if (++geocodeAttempts > GEOCODE_LIMIT_PER_IMPORT) {
        skipped.push({ row: r.row, reason: "Geocoding limit reached for this import" });
        continue;
      }
      const hit = await geocodeAddress(d.address);
      if (!hit) {
        skipped.push({ row: r.row, reason: `Could not geocode "${d.address}"` });
        continue;
      }
      lat = hit.lat;
      lon = hit.lon;
      country ??= hit.country;
      geocoded++;
    }
    if (!validCoords(lat, lon)) {
      skipped.push({ row: r.row, reason: "Invalid coordinates" });
      continue;
    }
    const dup = findDuplicate(ws, { name: d.name, lat: lat!, lon: lon!, externalRef: d.externalRef });
    if (dup && opts.skipDuplicates !== false) {
      skipped.push({ row: r.row, reason: `Duplicate of existing "${dup.name}"` });
      continue;
    }
    const where = await locate(lat!, lon!, country);
    const asset = buildAsset(ws, user.id, { ...d, lat: lat!, lon: lon!, tags: [...d.tags, ...(opts.extraTags ?? [])] }, where);
    asset.meta = { ...asset.meta, importedAt: new Date().toISOString(), importRow: r.row };
    getStore().assets.push(asset);
    created.push(asset.id);
  }
  audit({ userId: user.id, userName: user.name, action: "asset.import", entity: "workspace", entityId: ws, details: `Imported ${created.length} assets (${skipped.length} skipped, ${geocoded} geocoded) from ${parsed.format.toUpperCase()}` });
  if (created.length)
    notifyWorkspace({ workspaceId: ws, userId: user.id, kind: "system", severity: "success", title: `Imported ${created.length} asset${created.length === 1 ? "" : "s"}`, body: `${skipped.length} row(s) skipped, ${geocoded} address(es) geocoded. Re-scoring against live forecasts…`, href: "/app/portfolio", email: false });
  return { created, skipped, geocoded, format: parsed.format };
}

// ─── Export ───────────────────────────────────────────────────────────────

export function exportRows(ws: string, f: AssetFilters): ExportAsset[] {
  return filterAssets(ws, f).map((a) => {
    const r = toRow(a);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      externalRef: a.externalRef,
      lat: a.lat,
      lon: a.lon,
      address: a.address,
      country: a.country,
      crop: a.crop,
      areaHa: a.areaHa,
      valueUsd: a.valueUsd,
      tags: a.tags,
      composite: r.composite,
      level: r.level,
      floodRisk: r.flood,
      salinityRisk: r.salinity,
      droughtRisk: r.drought,
      heatRisk: r.heat,
      valueAtRiskUsd: r.varUsd,
      change7d: r.change7d,
      assessedAt: r.assessedAt ? new Date(r.assessedAt).toISOString() : null,
      scoreSource: r.source === "baseline" ? "district baseline" : r.source === "fallback" ? "district baseline (live feed unavailable)" : "Open-Meteo + GloFAS (Agri-SHIELD quick assessment)",
    };
  });
}

// ─── Notes & tags ─────────────────────────────────────────────────────────

export function assetNotes(assetId: string): AssetNote[] {
  return portfolioState.notes.get(assetId) ?? [];
}

export function addNote(ws: string, assetId: string, user: { id: string; name: string }, text: string): AssetNote {
  getWorkspaceAsset(ws, assetId);
  const n: AssetNote = { id: nextId("note"), assetId, workspaceId: ws, userId: user.id, userName: user.name, text: text.trim().slice(0, 2000), at: new Date() };
  const list = portfolioState.notes.get(assetId) ?? [];
  list.unshift(n);
  portfolioState.notes.set(assetId, list);
  return n;
}

export function deleteNote(ws: string, assetId: string, noteId: string, user: { id: string; role: string }): boolean {
  const list = portfolioState.notes.get(assetId) ?? [];
  const i = list.findIndex((n) => n.id === noteId && n.workspaceId === ws);
  if (i < 0) return false;
  if (list[i]!.userId !== user.id && user.role !== "enterprise_admin" && user.role !== "platform_admin") throw new PortfolioError("BAD_REQUEST", "Only the author or a workspace admin can delete a note");
  list.splice(i, 1);
  return true;
}

const TAG_COLORS = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb923c", "#60a5fa", "#4ade80", "#e879f9", "#22d3ee"];
export function tagColor(ws: string, tag: string): string {
  const meta = portfolioState.tagMeta.get(ws)?.[tag];
  if (meta?.color) return meta.color;
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length]!;
}

export function listTags(ws: string) {
  const m = new Map<string, { count: number; exposure: number }>();
  for (const a of workspaceAssets(ws))
    for (const t of a.tags) {
      const x = m.get(t) ?? { count: 0, exposure: 0 };
      x.count++;
      x.exposure += a.valueUsd;
      m.set(t, x);
    }
  const meta = portfolioState.tagMeta.get(ws) ?? {};
  return [...m.entries()].map(([tag, v]) => ({ tag, ...v, color: tagColor(ws, tag), description: meta[tag]?.description ?? "" })).sort((a, b) => b.count - a.count);
}

export function bulkTag(ws: string, ids: string[], add: string[], remove: string[]): number {
  const set = new Set(ids);
  const addN = add.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
  const rm = new Set(remove.map((t) => t.toLowerCase()));
  let n = 0;
  for (const a of getStore().assets) {
    if (a.workspaceId !== ws || !set.has(a.id)) continue;
    a.tags = [...new Set([...a.tags.filter((t) => !rm.has(t)), ...addN])];
    n++;
  }
  return n;
}

export function renameTag(ws: string, from: string, to: string): number {
  const target = to.trim().toLowerCase().replace(/\s+/g, "-");
  let n = 0;
  for (const a of getStore().assets)
    if (a.workspaceId === ws && a.tags.includes(from)) {
      a.tags = [...new Set(a.tags.map((t) => (t === from ? target : t)))];
      n++;
    }
  for (const r of getStore().alertRules) if (r.workspaceId === ws && r.scope.tags?.includes(from)) r.scope.tags = [...new Set(r.scope.tags.map((t) => (t === from ? target : t)))];
  const meta = portfolioState.tagMeta.get(ws);
  if (meta?.[from]) {
    meta[target] = meta[from]!;
    delete meta[from];
  }
  return n;
}

export function setTagMeta(ws: string, tag: string, patch: { color?: string; description?: string }) {
  const meta = portfolioState.tagMeta.get(ws) ?? {};
  meta[tag] = { color: patch.color ?? meta[tag]?.color ?? tagColor(ws, tag), description: patch.description ?? meta[tag]?.description ?? "" };
  portfolioState.tagMeta.set(ws, meta);
  return meta[tag];
}

// ─── Rules: evaluation + dispatch ─────────────────────────────────────────

export function workspaceRules(ws: string): AlertRuleRecord[] {
  return getStore().alertRules.filter((r) => r.workspaceId === ws);
}

export function snapshotsFor(assets: AssetRecord[]): Map<string, MetricSnapshot> {
  return new Map(assets.map((a) => [a.id, snapshotForAsset(a)]));
}

export function testRuleDraft(ws: string, rule: Pick<AlertRuleRecord, "id" | "enabled" | "scope" | "conditions" | "match" | "lastTriggeredAt" | "cooldownHours">): RuleEvaluation {
  const assets = workspaceAssets(ws);
  return evaluateRule(rule, assets, snapshotsFor(assets), { ignoreEnabled: true });
}

/** Per-workspace webhook signing secret (stable; derived from the server secret). */
export function webhookSecret(ws: string): string {
  const base = process.env.AGRISHIELD_WEBHOOK_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "agri-shield-dev-secret-change-me-in-production-0f3c9";
  return `whsec_${createHmac("sha256", base).update(`portfolio-rule-webhook:${ws}`).digest("hex").slice(0, 40)}`;
}

/** Outbound URL guard: https only (http allowed outside production), never link-local / metadata hosts. */
export function safeOutboundUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && process.env.NODE_ENV !== "production")) return null;
    if (/^(169\.254\.|0\.|\[?fe80:)/i.test(u.hostname) || u.hostname === "metadata.google.internal") return null;
    if (process.env.NODE_ENV === "production" && /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

async function postJson(url: URL, body: string, headers: Record<string, string>): Promise<{ status: number | null; ok: boolean; error?: string }> {
  if (OFFLINE) return { status: null, ok: false, error: "offline mode" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json", "User-Agent": "Agri-SHIELD-Webhooks/1.0", ...headers }, signal: ctrl.signal, redirect: "manual", cache: "no-store" });
    return { status: res.status, ok: res.ok };
  } catch (e) {
    return { status: null, ok: false, error: (e as Error).name === "AbortError" ? "timeout after 6 s" : (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

function userFor(recipient: string, ws: string): UserRecord | undefined {
  const r = recipient.toLowerCase();
  return getStore().users.find((u) => u.orgId === ws && (u.email?.toLowerCase() === r || u.phone === recipient));
}

const isPhone = (s: string) => /^\+?[0-9][0-9\s-]{6,}$/.test(s);

export async function dispatchFiring(rule: AlertRuleRecord, ev: RuleEvaluation, trigger: RuleFiring["trigger"], by: string): Promise<RuleFiring> {
  const ws = rule.workspaceId;
  const now = new Date();
  const assetsById = new Map(workspaceAssets(ws).map((a) => [a.id, a]));
  const firing: RuleFiring = {
    id: `fire_${randomUUID().slice(0, 12)}`,
    ruleId: rule.id,
    ruleName: rule.name,
    workspaceId: ws,
    at: now,
    severity: rule.severity,
    trigger,
    triggeredBy: by,
    matchCount: ev.matches.length,
    matches: ev.matches.slice(0, 50).map((m) => {
      const a = assetsById.get(m.assetId);
      const snap = a ? snapshotForAsset(a) : null;
      const metrics: Partial<MetricSnapshot> = {};
      for (const c of rule.conditions) metrics[c.metric] = snap?.[c.metric] ?? null;
      return { assetId: m.assetId, name: m.name, reason: m.reason, metrics };
    }),
    deliveries: [],
    notificationId: null,
  };
  rule.lastTriggeredAt = now;
  rule.triggerCount++;

  const n = ev.matches.length;
  const title = `${rule.name}: ${n} asset${n === 1 ? "" : "s"}`;
  const top = firing.matches.slice(0, 3).map((m) => `${m.name} (${m.reason})`);
  const body = `${top.join("; ")}${n > 3 ? ` and ${n - 3} more` : ""}.`;
  const href = `/app/alerts?tab=history&firing=${firing.id}`;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const payload = webhookPayload({
    firingId: firing.id,
    workspaceId: ws,
    rule: { id: rule.id, name: rule.name, severity: rule.severity, description: rule.description },
    firedAt: now.toISOString(),
    matchCount: n,
    matches: firing.matches.map((m) => ({ assetId: m.assetId, name: m.name, reason: m.reason, metrics: m.metrics })),
    link: `${appUrl}${href}`,
  });
  const sev = rule.severity === "info" ? "info" : rule.severity;
  let messages = 0;

  for (const ch of rule.channels) {
    if (ch === "app") {
      const rec = notifyWorkspace({ workspaceId: ws, kind: "rule", title, body, href, severity: sev, email: false });
      firing.notificationId = rec.id;
      firing.deliveries.push({ channel: "app", to: "all workspace members", status: "sent" });
    } else if (ch === "email") {
      const to = rule.recipients.filter((r) => r.includes("@"));
      const list = to.length ? to : getStore().users.filter((u) => u.orgId === ws && u.role === "enterprise_admin" && u.email).map((u) => u.email!);
      const html = emailHtml({ title, body: `${rule.description}\n\n${firing.matches.slice(0, 10).map((m) => `• ${m.name}: ${m.reason}`).join("\n")}`, href, severity: sev });
      for (const addr of list) {
        const m = await sendEmail(addr, `[Agri-SHIELD ${rule.severity.toUpperCase()}] ${title}`, html);
        firing.deliveries.push({ channel: "email", to: addr, status: m.status, detail: m.provider });
        messages++;
      }
      if (!list.length) firing.deliveries.push({ channel: "email", to: "—", status: "skipped", detail: "no e-mail recipients" });
    } else if (ch === "sms" || ch === "whatsapp") {
      const text = smsText(payload);
      const phones = [...new Set(rule.recipients.map((r) => (isPhone(r) ? r : userFor(r, ws)?.phone ?? null)).filter((p): p is string => !!p))];
      for (const p of phones) {
        const m = ch === "sms" ? await sendSms(p, text) : await sendWhatsApp(p, text);
        firing.deliveries.push({ channel: ch, to: p, status: m.status, detail: m.provider });
        messages++;
      }
      if (!phones.length) firing.deliveries.push({ channel: ch, to: "—", status: "skipped", detail: "no phone numbers among recipients (add +countrycode numbers or members with a phone)" });
    } else if (ch === "webhook") {
      const url = safeOutboundUrl(rule.webhookUrl);
      if (!url) {
        firing.deliveries.push({ channel: "webhook", to: rule.webhookUrl ?? "—", status: "skipped", detail: rule.webhookUrl ? "URL rejected (must be https)" : "no webhook URL" });
        continue;
      }
      const raw = JSON.stringify(payload);
      const r = await postJson(url, raw, { "X-AgriShield-Event": "rule.fired", "X-AgriShield-Delivery": firing.id, "X-AgriShield-Signature": signWebhook(webhookSecret(ws), raw) });
      firing.deliveries.push({ channel: "webhook", to: url.origin + url.pathname, status: r.ok ? "sent" : "failed", httpStatus: r.status, detail: r.error ?? `HTTP ${r.status}` });
    } else if (ch === "slack") {
      const slackUrl = portfolioState.ruleExtras.get(rule.id)?.slackUrl ?? (rule.webhookUrl?.includes("hooks.slack.com") ? rule.webhookUrl : null);
      const url = safeOutboundUrl(slackUrl);
      if (!url) {
        firing.deliveries.push({ channel: "slack", to: "—", status: "skipped", detail: "no Slack incoming-webhook URL configured" });
        continue;
      }
      const r = await postJson(url, JSON.stringify(slackMessage(payload)), {});
      firing.deliveries.push({ channel: "slack", to: url.hostname, status: r.ok ? "sent" : "failed", httpStatus: r.status, detail: r.error ?? `HTTP ${r.status}` });
    }
  }
  if (messages) trackUsage(ws, "messages", messages);
  portfolioState.firings.unshift(firing);
  if (portfolioState.firings.length > 2000) portfolioState.firings.length = 2000;
  wsPublish(ws, { type: "rule.fired", workspaceId: ws, ruleId: rule.id, firingId: firing.id, name: rule.name, severity: rule.severity, matchCount: n, at: now.toISOString() });
  audit({ userId: by, userName: by === "system" ? "Portfolio monitor" : by, action: "rule.fired", entity: "alert_rule", entityId: rule.id, details: `${n} asset(s); channels ${rule.channels.join(",")}` });
  return firing;
}

/**
 * Evaluate a workspace's rules and dispatch firings. Automatic (monitor) runs only consider
 * assets scored on live data in the last 6 h, so an outage of the forecast feed can never
 * trigger an alert storm on stale baselines; manual runs use the best available score.
 */
export async function evaluateWorkspaceRules(ws: string, opts: { trigger?: RuleFiring["trigger"]; by?: string; ruleIds?: string[]; ignoreCooldown?: boolean; liveOnly?: boolean } = {}) {
  const liveOnly = opts.liveOnly ?? (opts.trigger ?? "monitor") === "monitor";
  const freshSince = Date.now() - 6 * 3_600_000;
  const assets = workspaceAssets(ws).filter((a) => !liveOnly || (a.lastAssessment && a.lastAssessment.source !== "fallback" && new Date(a.lastAssessment.at).getTime() >= freshSince));
  const snaps = snapshotsFor(assets);
  const out: { ruleId: string; name: string; fired: boolean; matchCount: number; blockedBy: RuleEvaluation["blockedBy"]; firingId: string | null }[] = [];
  for (const rule of workspaceRules(ws)) {
    if (opts.ruleIds && !opts.ruleIds.includes(rule.id)) continue;
    const ev = evaluateRule(rule, assets, snaps, { ignoreCooldown: opts.ignoreCooldown });
    let firingId: string | null = null;
    if (ev.fires) firingId = (await dispatchFiring(rule, ev, opts.trigger ?? "monitor", opts.by ?? "system")).id;
    out.push({ ruleId: rule.id, name: rule.name, fired: ev.fires, matchCount: ev.matches.length, blockedBy: ev.blockedBy, firingId });
  }
  return out;
}

export function ruleFirings(ws: string, opts: { ruleId?: string; assetId?: string; limit?: number } = {}): RuleFiring[] {
  return portfolioState.firings.filter((f) => f.workspaceId === ws && (!opts.ruleId || f.ruleId === opts.ruleId) && (!opts.assetId || f.matches.some((m) => m.assetId === opts.assetId))).slice(0, opts.limit ?? 100);
}

// ─── Weekly digest ────────────────────────────────────────────────────────

export function isoWeekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const wk = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}

export function digestText(ws: string): { title: string; body: string } {
  const s = portfolioSummary(ws);
  const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
  const up = s.topMovers.filter((m) => m.change > 0).slice(0, 3);
  const fired = ruleFirings(ws).filter((f) => Date.now() - new Date(f.at).getTime() < 7 * 86_400_000);
  return {
    title: `Weekly portfolio digest — ${s.counts.assets} assets, ${s.kpis.pctAtRisk}% at risk`,
    body: `Exposure ${usd(s.kpis.totalExposureUsd)}, value-at-risk ${usd(s.kpis.valueAtRiskUsd)} (${s.kpis.varRatio}% of exposure). ${s.byLevel.critical} critical, ${s.byLevel.high} high. ${fired.length} rule firing(s) this week.${up.length ? ` Biggest risers: ${up.map((m) => `${m.name} (+${m.change})`).join(", ")}.` : ""}`,
  };
}

export function sendWeeklyDigest(ws: string, force = false): boolean {
  const key = isoWeekKey();
  if (!force && portfolioState.digestSent.get(ws) === key) return false;
  const org = getStore().orgs.find((o) => o.id === ws);
  if (!force && org?.settings && org.settings.weeklyDigest === false) return false;
  if (!workspaceAssets(ws).length) return false;
  const d = digestText(ws);
  notifyWorkspace({ workspaceId: ws, kind: "report", severity: "info", title: d.title, body: d.body, href: "/app/portfolio", email: true });
  portfolioState.digestSent.set(ws, key);
  return true;
}

/** Workspaces that have at least one active asset. */
export function monitoredWorkspaces(): string[] {
  return [...new Set(getStore().assets.filter((a) => a.status === "active").map((a) => a.workspaceId))];
}
