/**
 * Earth Twin — everything the 3D mission-control globe needs, in one compact
 * payload per workspace, plus the time machine (−30 d … +16 d) and the ranked
 * hotspots that drive the wall-mode auto-tour.
 *
 * Data sources (no Open-Meteo calls are made here — the free quota is shared):
 *  - store: assets (scored via portfolio.effectiveScore), districts (live overlay
 *    when available, seeded model values otherwise), alerts, supply nodes/flows
 *  - portfolio rule firings (portfolioState.firings)
 *  - GDACS + NASA EONET live hazards (server/live/events.ts, cached 30 min)
 *  - GDACS active tropical-cyclone geometry (cached 30 min)
 *  - NOAA IBTrACS v04r01 best tracks, last 3 seasons (server/data/real/cyclone-tracks.json)
 *  - real flood episodes + flood climatology (server/data/real)
 *
 * Pure helpers (track parsing, proximity, bucketing, hotspot ranking/captions,
 * forecast series) are exported for unit tests and for the Copilot.
 *
 * Author: Nitya Prakash Pandey
 */
import type { AssetType, Industry } from "@agri-shield/types";
import { getStore, riskLevelFromScore, type AssetRecord, type DistrictRecord, type SupplyNodeRecord } from "../data/store";
import { districtRing, floodClimatology, floodEvents } from "../data/real";
import trackJson from "../data/real/cyclone-tracks.json";
import { cached, fetchJson } from "../live/http";
import { getHazardEvents, type HazardEvent } from "../live/events";
import { compositeScore, haversineKm } from "./location-risk";
import { effectiveScore, portfolioState, riskThreshold, valueAtRisk } from "./portfolio";

const DAY = 86_400_000;
const HOUR = 3_600_000;
export const TIMELINE_PAST_DAYS = 30;
export const TIMELINE_FUTURE_DAYS = 16;

// ─── Types ────────────────────────────────────────────────────────────────

export type Level = "low" | "medium" | "high" | "critical";

export interface TwinAsset {
  id: string;
  name: string;
  type: AssetType;
  lat: number;
  lon: number;
  valueUsd: number;
  varUsd: number;
  score: number;
  level: Level;
  flood: number;
  salinity: number;
  drought: number;
  heat: number;
  districtId: string | null;
  country: string;
  driver: string;
  source: "live" | "fallback" | "baseline";
  externalRef: string | null;
}

export interface TwinDistrict {
  id: string;
  name: string;
  country: string;
  countryName: string;
  lat: number;
  lon: number;
  composite: number;
  flood: number;
  salinity: number;
  level: Level;
  floodProb72h: number;
  ecCurrent: number;
  ecPredicted30d: number;
  rain72hMm: number;
  dischargeRatio: number | null;
  farms: number;
  population: number;
  river: string;
  assets: number;
  exposureUsd: number;
  varUsd: number;
  liveSource: "seed" | "open-meteo";
  /** simplified real admin boundary ring [lon, lat][] */
  ring: [number, number][];
}

export interface TwinHazard {
  id: string;
  source: HazardEvent["source"];
  type: HazardEvent["type"];
  title: string;
  country: string | null;
  alertLevel: HazardEvent["alertLevel"];
  lat: number;
  lon: number;
  date: string;
  url: string | null;
  nearestKm: number | null;
  nearestName: string | null;
  assetsWithin: number;
  exposureWithinUsd: number;
  nearby: boolean;
}

/** [hoursSinceStart, lat, lon, windKt | null, category] */
export type TrackPoint = [number, number, number, number | null, number];

export interface TwinTrack {
  id: string;
  name: string;
  season: number;
  basin: string;
  start: string;
  end: string;
  maxWindKt: number;
  minPresHpa: number | null;
  maxCategory: number;
  provisional: boolean;
  active: boolean;
  source: "IBTrACS" | "IBTrACS + GDACS" | "GDACS";
  gdacsUrl: string | null;
  closestKm: number;
  closestAt: string;
  closestTo: string;
  points: TrackPoint[];
}

export interface TwinFlow {
  id: string;
  commodity: string;
  tonnesPerWeek: number;
  from: { id: string; name: string; type: string; lat: number; lon: number; risk: number };
  to: { id: string; name: string; type: string; lat: number; lon: number; risk: number };
  risk: number;
}

export interface TwinKpis {
  assets: number;
  atRisk: number;
  exposureUsd: number;
  exposureAtRiskUsd: number;
  varUsd: number;
  threshold: number;
  districts: number;
  districtsHigh: number;
  farmsAtRisk: number;
  activeHazards: number;
  nearbyHazards: number;
  activeAlerts: number;
  firings7d: number;
  activeCyclones: number;
  openIncidents: number | null;
}

export interface TwinScene {
  org: { id: string | null; name: string; industry: Industry | "platform"; currency: string; center: [number, number]; assetNoun: string; assetNounSingular: string };
  generatedAt: string;
  assets: TwinAsset[];
  districts: TwinDistrict[];
  hazards: TwinHazard[];
  tracks: TwinTrack[];
  flows: TwinFlow[];
  kpis: TwinKpis;
  feeds: {
    hazards: "ok" | "unavailable" | "warming";
    activeCyclones: "ok" | "unavailable";
    forecast: "live" | "climatology";
    tracksSource: string;
    tracksGenerated: string;
  };
  summary: string;
}

// ─── Pure helpers: tracks ─────────────────────────────────────────────────

interface TrackFileRow {
  id: string;
  name: string;
  season: number;
  basin: string;
  start: string;
  maxWindKt: number;
  minPresHpa: number | null;
  maxCategory: number;
  provisional?: boolean;
  points: [number, number, number, number | null, number | null, number][];
}
export interface TrackFile {
  generated: string;
  source: string;
  tracks: TrackFileRow[];
}

export interface ParsedTrack {
  id: string;
  name: string;
  season: number;
  basin: string;
  startMs: number;
  endMs: number;
  maxWindKt: number;
  minPresHpa: number | null;
  maxCategory: number;
  provisional: boolean;
  points: TrackPoint[];
}

/** Saffir-Simpson category from 1-min sustained wind (kt): −1 TD, 0 TS, 1-5. */
export function categoryFromWind(kt: number | null | undefined): number {
  if (kt == null || kt < 34) return -1;
  if (kt < 64) return 0;
  if (kt < 83) return 1;
  if (kt < 96) return 2;
  if (kt < 113) return 3;
  if (kt < 137) return 4;
  return 5;
}

/** Parse the committed IBTrACS JSON into tracks with absolute times (pressure dropped per point). */
export function parseTracks(file: TrackFile): ParsedTrack[] {
  const out: ParsedTrack[] = [];
  for (const t of file.tracks ?? []) {
    const startMs = Date.parse(t.start.endsWith("Z") ? t.start : `${t.start}Z`);
    if (!Number.isFinite(startMs) || !Array.isArray(t.points) || t.points.length < 2) continue;
    const points: TrackPoint[] = t.points
      .filter((p) => Array.isArray(p) && p.length >= 6 && Number.isFinite(p[1]) && Number.isFinite(p[2]))
      .map((p) => [p[0], p[1], p[2], p[3] ?? null, Number.isFinite(p[5]) ? p[5] : categoryFromWind(p[3])]);
    if (points.length < 2) continue;
    out.push({
      id: t.id,
      name: t.name,
      season: t.season,
      basin: t.basin,
      startMs,
      endMs: startMs + points[points.length - 1]![0] * HOUR,
      maxWindKt: t.maxWindKt,
      minPresHpa: t.minPresHpa ?? null,
      maxCategory: t.maxCategory,
      provisional: !!t.provisional,
      points,
    });
  }
  return out;
}

export interface FocusPoint {
  lat: number;
  lon: number;
  name: string;
}

/** Closest approach of a track to any focus point. */
export function trackClosest(track: Pick<ParsedTrack, "points" | "startMs">, focus: FocusPoint[]): { km: number; atMs: number; to: string } {
  let best = { km: Infinity, atMs: track.startMs, to: "" };
  for (const p of track.points)
    for (const f of focus) {
      const km = haversineKm(p[1], p[2], f.lat, f.lon);
      if (km < best.km) best = { km, atMs: track.startMs + p[0] * HOUR, to: f.name };
    }
  return best;
}

/** Thin a track for the globe: keep every `step`-th fix, the peak and the last fix. */
export function thinTrack(points: TrackPoint[], step: number): TrackPoint[] {
  if (step <= 1 || points.length <= 3) return points;
  let peak = 0;
  points.forEach((p, i) => {
    if ((p[3] ?? -1) > (points[peak]![3] ?? -1)) peak = i;
  });
  return points.filter((_, i) => i % step === 0 || i === peak || i === points.length - 1);
}

// ─── Pure helpers: geometry ───────────────────────────────────────────────

/** Douglas-Peucker-free decimation that keeps at most `max` vertices of a ring (closes it). */
export function simplifyRing(ring: number[][], max = 48): [number, number][] {
  if (!ring.length) return [];
  const step = Math.max(1, Math.ceil(ring.length / max));
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += step) out.push([Math.round(ring[i]![0]! * 1000) / 1000, Math.round(ring[i]![1]! * 1000) / 1000]);
  const f = out[0]!;
  const l = out[out.length - 1]!;
  if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0], f[1]]);
  return out;
}

// ─── Pure helpers: timeline bucketing ─────────────────────────────────────

export type TimelineEventKind = "alert" | "firing" | "hazard" | "cyclone" | "flood";
export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  at: string;
  title: string;
  severity: "info" | "watch" | "warning" | "critical";
  lat: number | null;
  lon: number | null;
  href: string | null;
}

export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** UTC midnight of the day containing `ms`. */
export const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;

export interface DayBucket {
  date: string;
  offset: number;
  counts: Record<TimelineEventKind, number>;
  worst: TimelineEvent["severity"] | null;
  events: TimelineEvent[];
}

const SEV_RANK: Record<TimelineEvent["severity"], number> = { info: 0, watch: 1, warning: 2, critical: 3 };

/**
 * Group events into UTC-day buckets from `fromOffset` to `toOffset` (days relative
 * to `nowMs`). Events outside the window are dropped; each bucket keeps its
 * `maxPerDay` most severe events (counts include all).
 */
export function bucketEvents(events: TimelineEvent[], nowMs: number, fromOffset: number, toOffset: number, maxPerDay = 6): DayBucket[] {
  const today = dayStart(nowMs);
  const buckets: DayBucket[] = [];
  for (let o = fromOffset; o <= toOffset; o++)
    buckets.push({ date: isoDay(today + o * DAY), offset: o, counts: { alert: 0, firing: 0, hazard: 0, cyclone: 0, flood: 0 }, worst: null, events: [] });
  for (const e of events) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    const o = Math.round((dayStart(t) - today) / DAY);
    if (o < fromOffset || o > toOffset) continue;
    const b = buckets[o - fromOffset]!;
    b.counts[e.kind]++;
    b.events.push(e);
    if (!b.worst || SEV_RANK[e.severity] > SEV_RANK[b.worst]) b.worst = e.severity;
  }
  for (const b of buckets) {
    b.events.sort((x, y) => SEV_RANK[y.severity] - SEV_RANK[x.severity] || y.at.localeCompare(x.at));
    b.events = b.events.slice(0, maxPerDay);
  }
  return buckets;
}

// ─── Pure helpers: forecast / series ──────────────────────────────────────

export interface DistrictForecastInput {
  id: string;
  floodRisk: number;
  salinityRisk: number;
  floodProb24h: number;
  floodProb48h: number;
  floodProb72h: number;
  ecCurrent: number;
  ecPredicted30d: number;
}

/** Salinity score (0-100) from root-zone EC (dS/m): rice tolerance ≈ 3, severe ≥ 8. */
export const salinityScoreFromEc = (ec: number) => Math.max(0, Math.min(100, Math.round((ec / 10) * 100)));

/**
 * Daily composite risk for days 0…`days` ahead, continuous with today's value.
 * Days 1-3 move from today's flood score to the 72-hour flood probability (the
 * horizon of the flood model); later days relax exponentially (e-folding 4 days)
 * towards the flood climatology of the calendar month (`clim(month)`, 0-1).
 * Salinity follows the linear EC trajectory towards the 30-day prediction.
 */
export function forecastSeries(d: DistrictForecastInput, nowMs: number, days: number, clim: (month: number) => number): number[] {
  const out: number[] = [];
  const f0 = d.floodRisk;
  const f72 = d.floodProb72h;
  const salSlope = (salinityScoreFromEc(d.ecPredicted30d) - salinityScoreFromEc(d.ecCurrent)) / 30;
  for (let k = 0; k <= days; k++) {
    let flood: number;
    if (k <= 3) flood = f0 + ((f72 - f0) * k) / 3;
    else {
      const month = new Date(nowMs + k * DAY).getUTCMonth() + 1;
      const climFlood = Math.max(0, Math.min(1, clim(month))) * 100;
      const w = Math.exp(-(k - 3) / 4);
      flood = f72 * w + climFlood * (1 - w);
    }
    const sal = Math.max(0, Math.min(100, d.salinityRisk + salSlope * k));
    out.push(compositeScore({ flood: Math.round(flood), salinity: Math.round(sal), drought: 0, heat: 0 }));
  }
  return out;
}

// ─── Pure helpers: hotspots ───────────────────────────────────────────────

export type HotspotKind = "district" | "hazard" | "cyclone" | "facility" | "asset";
export interface HotspotCandidate {
  id: string;
  kind: HotspotKind;
  targetId: string;
  name: string;
  lat: number;
  lon: number;
  /** 0-100 hazard severity */
  severity: number;
  /** 0-1 share of the workspace's exposure (or farms) concerned */
  impact: number;
  /** hours since the signal was observed (0 = now / forecast) */
  ageHours: number;
  facts: HotspotFacts;
}
export interface HotspotFacts {
  count?: number;
  noun?: string;
  nounSingular?: string;
  exposureUsd?: number;
  dischargeRatio?: number | null;
  floodProb72h?: number;
  ecCurrent?: number;
  composite?: number;
  distanceKm?: number | null;
  nearestName?: string | null;
  alertLevel?: string | null;
  hazardType?: string;
  windKt?: number | null;
  category?: number;
  active?: boolean;
  date?: string;
  tonnesPerWeek?: number;
  farms?: number;
  source?: string;
}
export interface Hotspot extends HotspotCandidate {
  rank: number;
  score: number;
  title: string;
  caption: string;
  href: string;
}

/** Recency half-life per kind: ongoing floods/droughts stay relevant for ~10 days, storms fade faster. */
export const HALF_LIFE_H: Record<HotspotKind, number> = { district: 72, asset: 72, facility: 72, hazard: 240, cyclone: 120 };

/** Ranking score: severity × (0.35 + 0.65·impact) × recency (per-kind half-life, 72 h default). */
export function hotspotScore(c: Pick<HotspotCandidate, "severity" | "impact" | "ageHours"> & { kind?: HotspotKind }): number {
  const sev = Math.max(0, Math.min(100, c.severity)) / 100;
  const imp = Math.max(0, Math.min(1, c.impact));
  const rec = Math.pow(0.5, Math.max(0, c.ageHours) / (c.kind ? HALF_LIFE_H[c.kind] : 72));
  return Math.round(sev * (0.35 + 0.65 * imp) * rec * 1000) / 10;
}

export const fmtUsdShort = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const CAT_LABEL = (c: number | undefined) => (c == null || c < 0 ? "tropical depression" : c === 0 ? "tropical storm" : `Category ${c}`);

/** Plain-language one-liner for the wall-mode caption. Driven only by the facts supplied. */
export function hotspotCaption(c: HotspotCandidate): { title: string; caption: string } {
  const f = c.facts;
  const who = f.count != null && f.noun ? plural(f.count, f.nounSingular ?? f.noun, f.noun) : null;
  const money = f.exposureUsd ? ` (${fmtUsdShort(f.exposureUsd)})` : "";
  switch (c.kind) {
    case "district": {
      let driver: string;
      if (f.dischargeRatio != null && f.dischargeRatio >= 1.3) driver = `river discharge ${f.dischargeRatio.toFixed(1)}× normal`;
      else if ((f.floodProb72h ?? 0) >= 35) driver = `72-hour flood probability ${Math.round(f.floodProb72h!)}%`;
      else if ((f.ecCurrent ?? 0) >= 3) driver = `soil salinity ${f.ecCurrent!.toFixed(1)} dS/m — above the rice limit of 3`;
      else driver = `composite risk ${Math.round(f.composite ?? c.severity)}/100`;
      const tail = who ? ` — ${who} exposed${money}` : f.farms ? ` — ${plural(f.farms, "farm", "farms")} in the district` : "";
      return { title: c.name, caption: `${c.name}: ${driver}${tail}` };
    }
    case "hazard": {
      const lvl = f.alertLevel ? `${f.alertLevel[0]!.toUpperCase()}${f.alertLevel.slice(1)} alert` : "reported";
      const near = f.distanceKm != null && f.nearestName ? `, ${Math.round(f.distanceKm)} km from ${f.nearestName}` : "";
      const tail = who && f.count ? ` — ${who} within 300 km${money}` : "";
      return { title: c.name, caption: `${c.name}: ${f.hazardType ?? "hazard"} ${lvl}${near}${tail}` };
    }
    case "cyclone": {
      const wind = f.windKt ? `, ${Math.round(f.windKt)} kt` : "";
      const when = f.active ? "active now" : f.date ? `passed ${f.date}` : "recent";
      const near = f.distanceKm != null && f.nearestName ? ` — closest ${Math.round(f.distanceKm)} km to ${f.nearestName}` : "";
      return { title: c.name, caption: `${c.name} (${CAT_LABEL(f.category)}${wind}) ${when}${near}` };
    }
    case "facility": {
      const t = f.tonnesPerWeek ? `${Math.round(f.tonnesPerWeek).toLocaleString("en-US")} t/week flows through it` : "key facility";
      return { title: c.name, caption: `${c.name}: composite risk ${Math.round(f.composite ?? c.severity)}/100 — ${t}${money}` };
    }
    default:
      return { title: c.name, caption: `${c.name}: composite risk ${Math.round(f.composite ?? c.severity)}/100${money}` };
  }
}

/**
 * Rank candidates, drop near-duplicates (same kind within `mergeKm`, or any
 * two within 25 km) and return the top `limit` with captions.
 */
export function rankHotspots(cands: HotspotCandidate[], opts: { limit?: number; mergeKm?: number; href?: (c: HotspotCandidate) => string } = {}): Hotspot[] {
  const limit = opts.limit ?? 10;
  const mergeKm = opts.mergeKm ?? 120;
  const scored = cands
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.severity > 0)
    .map((c) => ({ c, score: hotspotScore(c) }))
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
  const kept: { c: HotspotCandidate; score: number }[] = [];
  for (const s of scored) {
    const dup = kept.some((k) => {
      const km = haversineKm(k.c.lat, k.c.lon, s.c.lat, s.c.lon);
      return km < 25 || (k.c.kind === s.c.kind && km < mergeKm);
    });
    if (!dup) kept.push(s);
    if (kept.length >= limit) break;
  }
  return kept.map(({ c, score }, i) => ({ ...c, ...hotspotCaption(c), rank: i + 1, score, href: opts.href ? opts.href(c) : `/app/explorer?lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}` }));
}

// ─── Scope ────────────────────────────────────────────────────────────────

const NOUNS: Record<string, [string, string]> = {
  insured_plot: ["insured units", "insured unit"],
  loan: ["loans", "loan"],
  community: ["communities", "community"],
  farm: ["member farms", "member farm"],
  field: ["fields", "field"],
  warehouse: ["facilities", "facility"],
  processing_plant: ["facilities", "facility"],
  port: ["facilities", "facility"],
  retail_outlet: ["facilities", "facility"],
  office: ["sites", "site"],
};

function nounFor(assets: AssetRecord[], industry: string): [string, string] {
  if (!assets.length) return industry === "government" || industry === "platform" ? ["farms", "farm"] : ["assets", "asset"];
  const counts = new Map<string, number>();
  for (const a of assets) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  return NOUNS[top] ?? ["assets", "asset"];
}

interface Scope {
  orgId: string | null;
  name: string;
  industry: Industry | "platform";
  currency: string;
  center: [number, number];
  assets: AssetRecord[];
  districts: DistrictRecord[];
  nodes: SupplyNodeRecord[];
  own: Set<string>;
}

function scopeFor(orgId: string | null): Scope {
  const s = getStore();
  if (!orgId) {
    return { orgId: null, name: "All monitored regions", industry: "platform", currency: "USD", center: [15, 100], assets: [], districts: s.districts, nodes: [], own: new Set(s.districts.map((d) => d.id)) };
  }
  const org = s.orgs.find((o) => o.id === orgId);
  const assets = s.assets.filter((a) => a.workspaceId === orgId && a.status === "active");
  const nodes = s.nodes.filter((n) => n.orgId === orgId);
  const own = new Set<string>();
  for (const d of s.districts) if (d.orgId === orgId) own.add(d.id);
  for (const a of assets) if (a.districtId) own.add(a.districtId);
  for (const n of nodes) own.add(n.districtId);
  // assets outside the 22 monitored districts: attach the nearest district within 150 km
  for (const a of assets)
    if (!a.districtId) {
      let best: DistrictRecord | null = null;
      let bestKm = 150;
      for (const d of s.districts) {
        const km = haversineKm(a.lat, a.lon, d.lat, d.lon);
        if (km < bestKm) {
          bestKm = km;
          best = d;
        }
      }
      if (best) own.add(best.id);
    }
  const districts = s.districts.filter((d) => own.has(d.id));
  const industry = (org?.industry ?? (org?.type === "government" ? "government" : "agribusiness")) as Industry;
  let center: [number, number] = org?.settings?.defaultCenter ?? [15, 100];
  const pts = assets.length ? assets : districts;
  if (pts.length) {
    // circular mean of the workspace footprint (keeps the camera on the data, not the HQ)
    const lat = pts.reduce((t, p) => t + p.lat, 0) / pts.length;
    const lon = pts.reduce((t, p) => t + p.lon, 0) / pts.length;
    center = [Math.round(lat * 100) / 100, Math.round(lon * 100) / 100];
  }
  return { orgId, name: org?.name ?? orgId, industry, currency: org?.settings?.currency ?? "USD", center, assets, districts, nodes, own };
}

function focusPoints(sc: Scope): FocusPoint[] {
  const grid = new Map<string, FocusPoint>();
  for (const d of sc.districts) grid.set(`d:${d.id}`, { lat: d.lat, lon: d.lon, name: d.name });
  const dName = new Map(sc.districts.map((d) => [d.id, d.name]));
  for (const a of sc.assets) {
    const k = `${Math.round(a.lat * 2)}:${Math.round(a.lon * 2)}`;
    if (!grid.has(k)) grid.set(k, { lat: a.lat, lon: a.lon, name: (a.districtId && dName.get(a.districtId)) || a.name });
  }
  return [...grid.values()];
}

// ─── Live inputs (cached, never throw) ────────────────────────────────────

/** Readable name for unnamed systems, e.g. "Unnamed Bay of Bengal storm". */
export function trackDisplayName(t: Pick<ParsedTrack, "name" | "basin" | "points">): string {
  if (t.name && t.name !== "Unnamed") return t.name;
  const lon = t.points[0]?.[2] ?? 90;
  const sea = t.basin === "NI" ? (lon < 78 ? "Arabian Sea" : "Bay of Bengal") : t.basin === "WP" ? "West Pacific" : t.basin === "SI" ? "South Indian Ocean" : t.basin === "SP" ? "South Pacific" : "tropical";
  return `Unnamed ${sea} storm`;
}

const TRACKS: ParsedTrack[] = parseTracks(trackJson as unknown as TrackFile).map((t) => ({ ...t, name: trackDisplayName(t) }));
const TRACK_META = { source: "NOAA NCEI IBTrACS v04r01 (last 3 seasons)", generated: (trackJson as unknown as TrackFile).generated };

export function allTracks(): ParsedTrack[] {
  return TRACKS;
}

interface GdacsTc {
  eventId: number;
  name: string;
  alert: string;
  maxWindKmh: number;
  fromMs: number;
  toMs: number;
  url: string | null;
  points: { lat: number; lon: number; ms: number }[];
}

const inAsiaPacific = (lat: number, lon: number) => lon >= 40 && lon <= 180 && lat >= -40 && lat <= 50;

async function activeGdacsCyclones(): Promise<GdacsTc[]> {
  return cached("twin:gdacs-tc", 30 * 60_000, async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 12 * DAY);
    const d = (x: Date) => x.toISOString().slice(0, 10);
    const r = await fetchJson<{ features?: { geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }[] }>(
      `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromdate=${d(from)}&todate=${d(to)}&alertlevel=Green;Orange;Red`,
      9000
    );
    const evs = (r.features ?? []).filter((f) => {
      const p = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      const recent = Date.parse(String(p.todate ?? "")) > Date.now() - 2 * DAY;
      return inAsiaPacific(lat, lon) && (p.iscurrent === "true" || p.iscurrent === true || recent);
    });
    const out: GdacsTc[] = [];
    for (const f of evs.slice(0, 4)) {
      const p = f.properties;
      const sev = (p.severitydata as { severity?: number } | undefined)?.severity ?? 0;
      const fromMs = Date.parse(`${String(p.fromdate)}Z`);
      const toMs = Date.parse(`${String(p.todate)}Z`);
      const tc: GdacsTc = { eventId: Number(p.eventid), name: String(p.eventname ?? p.name ?? "Cyclone"), alert: String(p.alertlevel ?? "Green"), maxWindKmh: Math.round(sev), fromMs, toMs, url: (p.url as { report?: string } | undefined)?.report ?? null, points: [] };
      try {
        const g = await fetchJson<{ features?: { geometry: { type: string; coordinates: number[][][] }; properties: Record<string, unknown> }[] }>(
          `https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=${tc.eventId}&episodeid=${String(p.episodeid)}`,
          9000
        );
        tc.points = parseGdacsTrack(g.features ?? [], new Date(fromMs).getUTCFullYear());
      } catch {
        const [lon, lat] = f.geometry.coordinates;
        tc.points = [{ lat, lon, ms: toMs }];
      }
      out.push(tc);
    }
    return out;
  });
}

/** GDACS TC geometry → ordered track fixes (centres of the Point_Polygon_Point_* wind circles). */
export function parseGdacsTrack(features: { geometry: { type: string; coordinates: number[][][] }; properties: Record<string, unknown> }[], year: number): { lat: number; lon: number; ms: number }[] {
  const pts: { lat: number; lon: number; ms: number }[] = [];
  for (const f of features) {
    const cls = String(f.properties.Class ?? "");
    if (!cls.startsWith("Point_Polygon_Point") || f.geometry?.type !== "Polygon") continue;
    const ring = f.geometry.coordinates[0] ?? [];
    if (ring.length < 3) continue;
    const body = ring.slice(0, -1);
    const lon = body.reduce((t, c) => t + c[0]!, 0) / body.length;
    const lat = body.reduce((t, c) => t + c[1]!, 0) / body.length;
    const key = String(f.properties.key ?? ""); // MMDDHHmm
    let ms = NaN;
    if (/^\d{8}$/.test(key)) ms = Date.UTC(year, Number(key.slice(0, 2)) - 1, Number(key.slice(2, 4)), Number(key.slice(4, 6)), Number(key.slice(6, 8)));
    if (!Number.isFinite(ms)) continue;
    pts.push({ lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10, ms });
  }
  pts.sort((a, b) => a.ms - b.ms);
  // year roll-over (Dec → Jan)
  for (let i = 1; i < pts.length; i++) if (pts[i]!.ms < pts[i - 1]!.ms - 180 * DAY) pts[i]!.ms = Date.UTC(year + 1, 0, 1) + (pts[i]!.ms - Date.UTC(year, 0, 1));
  return pts;
}

async function within<T>(p: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<{ ok: false }>((res) => {
    timer = setTimeout(() => res({ ok: false }), ms);
  });
  try {
    return await Promise.race([p.then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const })), t]);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Incidents (optional module) ──────────────────────────────────────────

/** Open (not resolved) incidents from the Incidents module; null when that module is unavailable. */
async function openIncidentCount(orgId: string | null): Promise<number | null> {
  if (!orgId) return null;
  try {
    const mod = await import("./incidents");
    mod.ensureSeeded();
    return mod.incidentState.incidents.filter((i) => i.workspaceId === orgId && i.status !== "resolved").length;
  } catch {
    return null;
  }
}

// ─── Scene ────────────────────────────────────────────────────────────────

function dischargeRatio(d: DistrictRecord): number | null {
  return d.riverDischargeM3s != null && d.riverDischargeMeanM3s ? Math.round((d.riverDischargeM3s / d.riverDischargeMeanM3s) * 100) / 100 : null;
}

function districtComposite(d: DistrictRecord): number {
  return compositeScore({ flood: d.floodRisk, salinity: d.salinityRisk, drought: 0, heat: 0 });
}

export function scopeKey(orgId: string | null) {
  return orgId ?? "platform";
}

/** Build (or serve from the 60 s cache) the complete scene for a workspace. */
export function getTwinScene(orgId: string | null): Promise<TwinScene> {
  return cached(`twin:scene:${scopeKey(orgId)}`, 60_000, () => buildScene(orgId));
}

export async function buildScene(orgId: string | null, now = Date.now()): Promise<TwinScene> {
  const s = getStore();
  const sc = scopeFor(orgId);
  const threshold = orgId ? riskThreshold(orgId) : 60;
  const [nounMany, nounOne] = nounFor(sc.assets, sc.industry);

  // Assets
  const assets: TwinAsset[] = sc.assets.map((a) => {
    const e = effectiveScore(a);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      lat: Math.round(a.lat * 10000) / 10000,
      lon: Math.round(a.lon * 10000) / 10000,
      valueUsd: Math.round(a.valueUsd),
      varUsd: Math.round(valueAtRisk(a.valueUsd, e)),
      score: Math.round(e.composite),
      level: e.level,
      flood: Math.round(e.flood),
      salinity: Math.round(e.salinity),
      drought: Math.round(e.drought),
      heat: Math.round(e.heat),
      districtId: a.districtId,
      country: a.country,
      driver: e.drivers[0] ?? "",
      source: e.source,
      externalRef: a.externalRef,
    };
  });

  // Districts
  const byDistrict = new Map<string, { n: number; exp: number; v: number }>();
  for (const a of assets) {
    if (!a.districtId) continue;
    const r = byDistrict.get(a.districtId) ?? { n: 0, exp: 0, v: 0 };
    r.n++;
    r.exp += a.valueUsd;
    r.v += a.varUsd;
    byDistrict.set(a.districtId, r);
  }
  const districts: TwinDistrict[] = sc.districts.map((d) => {
    const agg = byDistrict.get(d.id) ?? { n: 0, exp: 0, v: 0 };
    const comp = districtComposite(d);
    return {
      id: d.id,
      name: d.name,
      country: d.country,
      countryName: d.countryName,
      lat: d.lat,
      lon: d.lon,
      composite: comp,
      flood: Math.round(d.floodRisk),
      salinity: Math.round(d.salinityRisk),
      level: riskLevelFromScore(comp),
      floodProb72h: Math.round(d.floodProb72h),
      ecCurrent: Math.round(d.ecCurrent * 10) / 10,
      ecPredicted30d: Math.round(d.ecPredicted30d * 10) / 10,
      rain72hMm: Math.round(d.rainfall72hMm),
      dischargeRatio: dischargeRatio(d),
      farms: d.totalFarms,
      population: d.population,
      river: d.riverName,
      assets: agg.n,
      exposureUsd: Math.round(agg.exp),
      varUsd: Math.round(agg.v),
      liveSource: d.liveSource,
      ring: simplifyRing(districtRing(d.id) ?? d.geometry.coordinates[0] ?? [], 56),
    };
  });

  const focus = focusPoints(sc);

  // Hazards (GDACS + EONET) — bounded wait so the globe never hangs on a slow feed
  const hz = await within(getHazardEvents(), 4500);
  const rawHazards = hz.ok ? hz.value : [];
  const hazards: TwinHazard[] = rawHazards
    .map((h) => {
      let nearestKm: number | null = null;
      let nearestName: string | null = null;
      for (const f of focus) {
        const km = haversineKm(h.lat, h.lon, f.lat, f.lon);
        if (nearestKm == null || km < nearestKm) {
          nearestKm = km;
          nearestName = f.name;
        }
      }
      let n = 0;
      let exp = 0;
      for (const a of assets)
        if (haversineKm(h.lat, h.lon, a.lat, a.lon) <= 300) {
          n++;
          exp += a.valueUsd;
        }
      return {
        id: h.id,
        source: h.source,
        type: h.type,
        title: h.title,
        country: h.country,
        alertLevel: h.alertLevel,
        lat: Math.round(h.lat * 1000) / 1000,
        lon: Math.round(h.lon * 1000) / 1000,
        date: h.date,
        url: h.url,
        nearestKm: nearestKm == null ? null : Math.round(nearestKm),
        nearestName,
        assetsWithin: n,
        exposureWithinUsd: Math.round(exp),
        nearby: nearestKm != null && nearestKm <= 600,
      };
    })
    .sort((a, b) => Number(b.nearby) - Number(a.nearby) || (a.nearestKm ?? 1e9) - (b.nearestKm ?? 1e9))
    .slice(0, 40);

  // Cyclone tracks: IBTrACS near the workspace (≤ 700 km) + GDACS active storms
  const tc = await within(activeGdacsCyclones(), 4500);
  const gdacsTcs = tc.ok ? tc.value : [];
  const tracks: TwinTrack[] = [];
  const usedGdacs = new Set<number>();
  for (const t of TRACKS) {
    const close = trackClosest(t, focus);
    const recentEnd = t.endMs > now - 3 * DAY;
    const gd = gdacsTcs.find((g) => g.name.toLowerCase().startsWith(t.name.toLowerCase()) && Math.abs(g.fromMs - t.startMs) < 10 * DAY);
    if (gd) usedGdacs.add(gd.eventId);
    if (close.km > 700 && !gd) continue;
    let points = t.points;
    let endMs = t.endMs;
    if (gd) {
      const extra = gd.points.filter((p) => p.ms > t.endMs + HOUR);
      const cat = categoryFromWind(gd.maxWindKmh / 1.852);
      points = [...points, ...extra.map((p) => [Math.round((p.ms - t.startMs) / HOUR), p.lat, p.lon, null, cat] as TrackPoint)];
      if (extra.length) endMs = extra[extra.length - 1]!.ms;
    }
    tracks.push({
      id: t.id,
      name: t.name,
      season: t.season,
      basin: t.basin,
      start: new Date(t.startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      maxWindKt: t.maxWindKt,
      minPresHpa: t.minPresHpa,
      maxCategory: t.maxCategory,
      provisional: t.provisional,
      active: !!gd || recentEnd,
      source: gd ? "IBTrACS + GDACS" : "IBTrACS",
      gdacsUrl: gd?.url ?? null,
      closestKm: Math.round(close.km),
      closestAt: new Date(close.atMs).toISOString(),
      closestTo: close.to,
      points: thinTrack(points, 2),
    });
  }
  for (const g of gdacsTcs) {
    if (usedGdacs.has(g.eventId) || g.points.length < 2) continue;
    const start = g.points[0]!.ms;
    const cat = categoryFromWind(g.maxWindKmh / 1.852);
    const pts: TrackPoint[] = g.points.map((p) => [Math.round((p.ms - start) / HOUR), p.lat, p.lon, null, cat]);
    const close = trackClosest({ points: pts, startMs: start }, focus);
    tracks.push({
      id: `gdacs-${g.eventId}`,
      name: g.name.replace(/-\d+$/, "").replace(/^\w/, (c) => c.toUpperCase()),
      season: new Date(start).getUTCFullYear(),
      basin: "—",
      start: new Date(start).toISOString(),
      end: new Date(g.points[g.points.length - 1]!.ms).toISOString(),
      maxWindKt: Math.round(g.maxWindKmh / 1.852),
      minPresHpa: null,
      maxCategory: cat,
      provisional: true,
      active: true,
      source: "GDACS",
      gdacsUrl: g.url,
      closestKm: Math.round(close.km),
      closestAt: new Date(close.atMs).toISOString(),
      closestTo: close.to,
      points: pts,
    });
  }
  // nearest & most intense first; keep the payload bounded
  tracks.sort((a, b) => Number(b.active) - Number(a.active) || a.closestKm - b.closestKm);
  tracks.splice(40);

  // Supply-chain flows between this workspace's nodes
  const nodeById = new Map(s.nodes.map((n) => [n.id, n]));
  const flows: TwinFlow[] = sc.nodes.length
    ? s.flows
        .filter((f) => sc.nodes.some((n) => n.id === f.from || n.id === f.to))
        .map((f) => {
          const a = nodeById.get(f.from)!;
          const b = nodeById.get(f.to)!;
          const side = (n: SupplyNodeRecord) => ({ id: n.id, name: n.name, type: n.type, lat: n.lat, lon: n.lon, risk: n.riskScore });
          return { id: f.id, commodity: f.commodity, tonnesPerWeek: f.tonnesPerWeek, from: side(a), to: side(b), risk: Math.max(a.riskScore, b.riskScore) };
        })
        .filter((f) => f.from && f.to)
    : [];

  // KPIs
  const atRiskAssets = assets.filter((a) => a.score >= threshold);
  const districtsHigh = districts.filter((d) => d.composite >= threshold);
  const activeAlerts = s.alerts.filter((a) => a.isActive && sc.own.has(a.districtId) && a.validUntil.getTime() > now).length;
  const firings7d = orgId ? portfolioState.firings.filter((f) => f.workspaceId === orgId && f.at.getTime() > now - 7 * DAY).length : 0;
  const kpis: TwinKpis = {
    assets: assets.length,
    atRisk: atRiskAssets.length,
    exposureUsd: assets.reduce((t, a) => t + a.valueUsd, 0),
    exposureAtRiskUsd: atRiskAssets.reduce((t, a) => t + a.valueUsd, 0),
    varUsd: assets.reduce((t, a) => t + a.varUsd, 0),
    threshold,
    districts: districts.length,
    districtsHigh: districtsHigh.length,
    farmsAtRisk: districtsHigh.reduce((t, d) => t + d.farms, 0),
    activeHazards: hazards.length,
    nearbyHazards: hazards.filter((h) => h.nearby).length,
    activeAlerts,
    firings7d,
    activeCyclones: tracks.filter((t) => t.active).length,
    openIncidents: await openIncidentCount(orgId),
  };

  const live = sc.districts.some((d) => d.liveSource === "open-meteo");
  const summary = sceneSummary({ industry: sc.industry, nounMany, kpis, districts, hazards, tracks, currencyNote: sc.currency });

  return {
    org: { id: orgId, name: sc.name, industry: sc.industry, currency: sc.currency, center: sc.center, assetNoun: nounMany, assetNounSingular: nounOne },
    generatedAt: new Date(now).toISOString(),
    assets,
    districts,
    hazards,
    tracks,
    flows,
    kpis,
    feeds: {
      hazards: hz.ok ? (rawHazards.length ? "ok" : "unavailable") : "warming",
      activeCyclones: tc.ok ? "ok" : "unavailable",
      forecast: live ? "live" : "climatology",
      tracksSource: TRACK_META.source,
      tracksGenerated: TRACK_META.generated,
    },
    summary,
  };
}

export function sceneSummary(p: { industry: string; nounMany: string; kpis: TwinKpis; districts: TwinDistrict[]; hazards: TwinHazard[]; tracks: TwinTrack[]; currencyNote?: string }): string {
  const k = p.kpis;
  const parts: string[] = [];
  if (k.assets) {
    parts.push(
      k.atRisk
        ? `${k.atRisk} of ${k.assets} ${p.nounMany} (${fmtUsdShort(k.exposureAtRiskUsd)} of ${fmtUsdShort(k.exposureUsd)}) are at or above your risk threshold of ${k.threshold}.`
        : `None of your ${k.assets} ${p.nounMany} is above your risk threshold of ${k.threshold} right now.`
    );
  } else if (k.districts) {
    parts.push(
      k.districtsHigh
        ? `${k.districtsHigh} of ${k.districts} districts are at high risk — about ${k.farmsAtRisk.toLocaleString("en-US")} farms live in them.`
        : `All ${k.districts} monitored districts are below the high-risk threshold.`
    );
  }
  const worst = [...p.districts].sort((a, b) => b.composite - a.composite)[0];
  if (worst) parts.push(`Highest pressure: ${worst.name} (${worst.composite}/100${worst.dischargeRatio && worst.dischargeRatio >= 1.3 ? `, river ${worst.dischargeRatio.toFixed(1)}× normal` : worst.ecCurrent >= 3 ? `, salinity ${worst.ecCurrent} dS/m` : ""}).`);
  const near = p.hazards.filter((h) => h.nearby).length;
  if (near) parts.push(`${near} live hazard event${near === 1 ? "" : "s"} within 600 km.`);
  const active = p.tracks.filter((t) => t.active && t.closestKm <= 2000);
  if (active.length) parts.push(`Active cyclone${active.length > 1 ? "s" : ""}: ${active.map((t) => `${t.name} (${t.closestKm.toLocaleString("en-US")} km from ${t.closestTo})`).join(", ")}.`);
  return parts.join(" ");
}

// ─── Hotspots ─────────────────────────────────────────────────────────────

export function hotspotCandidates(scene: TwinScene, now = Date.now()): HotspotCandidate[] {
  const out: HotspotCandidate[] = [];
  const totalExp = scene.kpis.exposureUsd || 1;
  const totalFarms = scene.districts.reduce((t, d) => t + d.farms, 0) || 1;
  const noun = scene.org.assetNoun;
  const nounOne = scene.org.assetNounSingular;
  const hasAssets = scene.assets.length > 0;

  for (const d of scene.districts) {
    if (hasAssets && !d.assets) continue;
    // severity: composite, lifted when the river is running high
    const sev = Math.min(100, d.composite + (d.dischargeRatio && d.dischargeRatio > 1.3 ? (d.dischargeRatio - 1) * 15 : 0));
    out.push({
      id: `district:${d.id}`,
      kind: "district",
      targetId: d.id,
      name: d.name,
      lat: d.lat,
      lon: d.lon,
      severity: sev,
      impact: hasAssets ? d.exposureUsd / totalExp : d.farms / totalFarms,
      ageHours: 0,
      facts: hasAssets
        ? { count: d.assets, noun, nounSingular: nounOne, exposureUsd: d.exposureUsd, dischargeRatio: d.dischargeRatio, floodProb72h: d.floodProb72h, ecCurrent: d.ecCurrent, composite: d.composite }
        : { farms: d.farms, dischargeRatio: d.dischargeRatio, floodProb72h: d.floodProb72h, ecCurrent: d.ecCurrent, composite: d.composite },
    });
  }
  for (const h of scene.hazards) {
    if (!h.nearby) continue;
    // the same storm is already represented by its track
    if (h.type === "cyclone" || h.type === "storm") {
      const hMs = Date.parse(h.date);
      const dup = scene.tracks.some((t) => Math.abs(Date.parse(t.end) - hMs) < 10 * 24 * HOUR && t.points.some((p) => haversineKm(p[1], p[2], h.lat, h.lon) < 300));
      if (dup) continue;
    }
    const lvl = h.alertLevel === "red" ? 90 : h.alertLevel === "orange" ? 70 : h.alertLevel === "green" ? 45 : 50;
    const prox = h.nearestKm == null ? 0.3 : Math.max(0.2, 1 - h.nearestKm / 800);
    out.push({
      id: `hazard:${h.id}`,
      kind: "hazard",
      targetId: h.id,
      name: h.title,
      lat: h.lat,
      lon: h.lon,
      severity: lvl * prox,
      impact: hasAssets ? h.exposureWithinUsd / totalExp : prox * 0.5,
      ageHours: Math.max(0, (now - Date.parse(h.date)) / HOUR),
      facts: { hazardType: h.type, alertLevel: h.alertLevel, distanceKm: h.nearestKm, nearestName: h.nearestName, count: h.assetsWithin, noun, nounSingular: nounOne, exposureUsd: h.exposureWithinUsd },
    });
  }
  for (const t of scene.tracks) {
    const endMs = Date.parse(t.end);
    const age = t.active ? 0 : Math.max(0, (now - endMs) / HOUR);
    if (!t.active && age > 45 * 24) continue;
    if (t.closestKm > 1000) continue; // regional awareness only — not a hotspot
    const last = t.points[t.points.length - 1]!;
    const peak = t.points.reduce((b, p) => ((p[3] ?? -1) > (b[3] ?? -1) ? p : b), t.points[0]!);
    const at = t.active ? last : peak;
    const prox = Math.max(0.15, 1 - t.closestKm / 900);
    out.push({
      id: `cyclone:${t.id}`,
      kind: "cyclone",
      targetId: t.id,
      name: t.name.startsWith("Unnamed") ? t.name : `Cyclone ${t.name}`,
      lat: at[1],
      lon: at[2],
      severity: Math.min(100, (40 + Math.max(0, t.maxCategory) * 12) * prox + (t.active ? 15 : 0)),
      impact: prox,
      ageHours: age,
      facts: { windKt: t.maxWindKt, category: t.maxCategory, active: t.active, date: t.closestAt.slice(0, 10), distanceKm: t.closestKm, nearestName: t.closestTo },
    });
  }
  // supply-chain facilities with throughput
  const through = new Map<string, number>();
  for (const f of scene.flows) {
    through.set(f.from.id, (through.get(f.from.id) ?? 0) + f.tonnesPerWeek);
    through.set(f.to.id, (through.get(f.to.id) ?? 0) + f.tonnesPerWeek);
  }
  if (through.size) {
    const maxT = Math.max(...through.values());
    for (const a of scene.assets) {
      const ref = a.externalRef?.toLowerCase() ?? "";
      const t = through.get(ref) ?? 0;
      if (!t) continue;
      out.push({ id: `facility:${a.id}`, kind: "facility", targetId: a.id, name: a.name, lat: a.lat, lon: a.lon, severity: a.score, impact: t / maxT, ageHours: 0, facts: { composite: a.score, tonnesPerWeek: t, exposureUsd: a.valueUsd } });
    }
  }
  return out;
}

export function hotspotHref(c: HotspotCandidate): string {
  if (c.kind === "facility" || c.kind === "asset") return `/app/portfolio/${c.targetId}`;
  return `/app/explorer?lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}`;
}

export async function getHotspots(orgId: string | null, limit = 10): Promise<Hotspot[]> {
  const scene = await getTwinScene(orgId);
  return rankHotspots(hotspotCandidates(scene), { limit, href: hotspotHref });
}

/** Copilot-ready: "what should I look at right now?" — top hotspot captions for a workspace. */
export async function twinBriefing(orgId: string | null, n = 3): Promise<{ summary: string; hotspots: { caption: string; href: string }[] }> {
  const scene = await getTwinScene(orgId);
  const hs = rankHotspots(hotspotCandidates(scene), { limit: n, href: hotspotHref });
  return { summary: scene.summary, hotspots: hs.map((h) => ({ caption: h.caption, href: h.href })) };
}

// ─── Timeline (time machine) ──────────────────────────────────────────────

export interface TwinTimeline {
  from: number;
  to: number;
  today: string;
  days: (DayBucket & { risk: number; band: [number, number] | null; phase: "past" | "today" | "future" })[];
  assetSeries: { id: string; s: number[] }[];
  districtSeries: { id: string; s: number[] }[];
  forecast: { source: "live" | "climatology"; note: string };
  methodology: string[];
}

const ALERT_SEV: Record<string, TimelineEvent["severity"]> = { info: "info", advisory: "watch", watch: "watch", warning: "warning", emergency: "critical", critical: "critical" };

function seriesFromHistory(a: AssetRecord, today: number, from: number, current: number): (number | null)[] {
  const byDate = new Map(a.history.map((h) => [h.date, h.composite]));
  const out: (number | null)[] = [];
  let last: number | null = a.history[0]?.composite ?? null;
  for (let o = from; o < 0; o++) {
    const v = byDate.get(isoDay(today + o * DAY));
    if (v != null) last = v;
    out.push(v ?? last);
  }
  out.push(current);
  return out;
}

export async function getTimeline(orgId: string | null, fromOffset = -TIMELINE_PAST_DAYS, toOffset = TIMELINE_FUTURE_DAYS, now = Date.now()): Promise<TwinTimeline> {
  const from = Math.max(-TIMELINE_PAST_DAYS, Math.min(0, Math.round(fromOffset)));
  const to = Math.min(TIMELINE_FUTURE_DAYS, Math.max(0, Math.round(toOffset)));
  const s = getStore();
  const sc = scopeFor(orgId);
  const scene = await getTwinScene(orgId);
  const today = dayStart(now);
  const winStart = today + from * DAY;
  const winEnd = today + (to + 1) * DAY;

  // ── events ──
  const events: TimelineEvent[] = [];
  for (const a of s.alerts) {
    if (!sc.own.has(a.districtId)) continue;
    const t = a.createdAt.getTime();
    if (t < winStart || t >= winEnd) continue;
    const d = s.districts.find((x) => x.id === a.districtId);
    events.push({ id: a.id, kind: "alert", at: a.createdAt.toISOString(), title: a.title, severity: ALERT_SEV[a.severity] ?? "watch", lat: d?.lat ?? null, lon: d?.lon ?? null, href: "/app/alerts" });
  }
  if (orgId)
    for (const f of portfolioState.firings) {
      if (f.workspaceId !== orgId) continue;
      const t = f.at.getTime();
      if (t < winStart || t >= winEnd) continue;
      events.push({ id: f.id, kind: "firing", at: f.at.toISOString(), title: `Rule “${f.ruleName}” matched ${f.matchCount} ${f.matchCount === 1 ? "asset" : "assets"}`, severity: f.severity === "critical" ? "critical" : f.severity === "warning" ? "warning" : "info", lat: null, lon: null, href: "/app/alerts" });
    }
  for (const h of scene.hazards) {
    const t = Date.parse(h.date);
    if (!Number.isFinite(t) || t < winStart || t >= winEnd) continue;
    events.push({ id: h.id, kind: "hazard", at: new Date(t).toISOString(), title: h.title, severity: h.alertLevel === "red" ? "critical" : h.alertLevel === "orange" ? "warning" : "watch", lat: h.lat, lon: h.lon, href: h.url });
  }
  for (const t of scene.tracks) {
    const ca = Date.parse(t.closestAt);
    if (ca < winStart || ca >= winEnd) continue;
    events.push({ id: `trk-${t.id}`, kind: "cyclone", at: t.closestAt, title: `${t.name}: closest approach ${t.closestKm} km to ${t.closestTo}`, severity: t.closestKm < 150 && t.maxCategory >= 1 ? "critical" : t.closestKm < 400 ? "warning" : "watch", lat: null, lon: null, href: t.gdacsUrl });
  }
  for (const d of sc.districts)
    for (const e of floodEvents(d.id)) {
      const st = Date.parse(e.start);
      const en = Date.parse(e.end) + DAY - 1;
      if (en < winStart || st >= winEnd) continue;
      events.push({ id: `fl-${d.id}-${e.start}`, kind: "flood", at: new Date(Math.max(st, winStart)).toISOString(), title: `${d.name}: ${e.driver} flood episode (${e.durationDays} d, depth proxy ${e.depthM.toFixed(2)} m)`, severity: e.depthM >= 0.5 ? "critical" : e.depthM >= 0.2 ? "warning" : "watch", lat: d.lat, lon: d.lon, href: `/app/explorer?lat=${d.lat.toFixed(4)}&lon=${d.lon.toFixed(4)}` });
    }
  const buckets = bucketEvents(events, now, from, to);

  // ── district series (past: observed flood episodes over climatology; future: forecast) ──
  const n = to - from + 1;
  const districtSeries = sc.districts.map((d) => {
    const memo = new Map<number, number>();
    const clim = (m: number) => {
      let v = memo.get(m);
      if (v == null) memo.set(m, (v = floodClimatology(d.id, m, 3)));
      return v;
    };
    const fut = forecastSeries(d, now, to, clim);
    const now0 = fut[0]!;
    const eps = floodEvents(d.id).map((e) => [Date.parse(e.start), Date.parse(e.end) + DAY - 1, e.depthM] as const);
    const sArr: number[] = [];
    for (let o = from; o <= to; o++) {
      if (o >= 0) {
        sArr.push(fut[o]!);
        continue;
      }
      const t = today + o * DAY + DAY / 2;
      const ep = eps.find(([a, b]) => t >= a && t <= b);
      const m = new Date(t).getUTCMonth() + 1;
      const climFlood = Math.round(clim(m) * 100);
      const flood = ep ? Math.min(100, 62 + ep[2] * 40) : Math.max(climFlood, d.floodRisk * 0.6);
      const v = compositeScore({ flood, salinity: d.salinityRisk, drought: 0, heat: 0 });
      // blend towards today's value over the last 3 days so the past joins the present smoothly
      const w = o >= -3 ? (3 + o) / 3 : 0;
      sArr.push(Math.round(v * (1 - w) + now0 * w));
    }
    return { id: d.id, s: sArr, fut, now0 };
  });
  const dById = new Map(districtSeries.map((d) => [d.id, d]));

  // ── asset series (past: stored daily history; future: today's score shifted by the district forecast delta) ──
  const assetSeries = sc.assets.map((a) => {
    const cur = scene.assets.find((x) => x.id === a.id)?.score ?? effectiveScore(a).composite;
    const past = seriesFromHistory(a, today, from, cur);
    const ds = a.districtId ? dById.get(a.districtId) : undefined;
    const sArr: number[] = past.map((v) => Math.round(v ?? cur));
    for (let o = 1; o <= to; o++) {
      const delta = ds ? ds.fut[o]! - ds.now0 : 0;
      sArr.push(Math.max(0, Math.min(100, Math.round(cur + delta * 0.8))));
    }
    return { id: a.id, s: sArr.slice(0, n) };
  });

  // ── headline risk index per day ──
  const weights = sc.assets.length ? sc.assets.map((a) => a.valueUsd) : sc.districts.map((d) => d.totalFarms);
  const seriesForIndex = sc.assets.length ? assetSeries : districtSeries.map((d) => ({ id: d.id, s: d.s }));
  const wSum = weights.reduce((t, w) => t + w, 0) || 1;
  const days = buckets.map((b, i) => {
    const risk = seriesForIndex.length ? Math.round((seriesForIndex.reduce((t, r, k) => t + (r.s[i] ?? 0) * weights[k]!, 0) / wSum) * 10) / 10 : 0;
    const phase: "past" | "today" | "future" = b.offset < 0 ? "past" : b.offset === 0 ? "today" : "future";
    // forecast uncertainty widens with lead time (±2 at day 1 → ±12 at day 16)
    const spread = b.offset > 0 ? Math.min(12, 2 + b.offset * 0.65) : 0;
    return { ...b, risk, phase, band: b.offset > 0 ? ([Math.max(0, Math.round(risk - spread)), Math.min(100, Math.round(risk + spread))] as [number, number]) : null };
  });

  const live = sc.districts.some((d) => d.liveSource === "open-meteo");
  return {
    from,
    to,
    today: isoDay(today),
    days,
    assetSeries,
    districtSeries: districtSeries.map((d) => ({ id: d.id, s: d.s })),
    forecast: live
      ? { source: "live", note: "Days 1-3 use the live 24/48/72-hour flood probabilities (Open-Meteo + GloFAS → flood model); days 4-16 relax towards the monthly flood climatology." }
      : { source: "climatology", note: "Forecast feed paused — showing climatology. Days 1-3 use the last stored model probabilities; days 4-16 are the real 2019-2026 flood climatology for the calendar month." },
    methodology: [
      "Past: daily composite scores stored for each asset; districts without assets use real flood episodes (GloFAS/ERA5, 2019-2026) over the monthly flood climatology.",
      "Events: alerts issued in your districts, your alert-rule firings, GDACS/NASA EONET hazard reports, cyclone closest approaches (IBTrACS/GDACS) and real flood episodes.",
      "Future: 24/48/72-hour flood probabilities, then exponential relaxation (e-folding 4 days) to the monthly climatology; salinity follows the 30-day EC prediction. The shaded band widens with lead time.",
    ],
  };
}
