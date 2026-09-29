/**
 * Copilot data access — read-only views over the workspace (store + live
 * location engine). Every figure the Copilot quotes flows through here.
 */
import type { RiskLevel } from "@agri-shield/types";
import { getStore, type AssetRecord } from "../../data/store";
import { geocode } from "../../live/open-meteo";
import { compositeScore } from "../location-risk";
import { effectiveScore, portfolioState, rescoreWorkspace, valueAtRisk } from "../portfolio";
import { riskLevel } from "../../risk/scoring";
import { COUNTRY_ALIASES, normalizeText, stripDiacritics } from "./intent";

export interface Row {
  id: string;
  name: string;
  type: string;
  ref: string | null;
  lat: number;
  lon: number;
  country: string;
  district: string | null;
  crop: string | null;
  tags: string[];
  valueUsd: number;
  meta: AssetRecord["meta"];
  composite: number;
  level: RiskLevel;
  flood: number;
  salinity: number;
  drought: number;
  heat: number;
  drivers: string[];
  rain24: number | null;
  rain72: number | null;
  ec: number | null;
  dischargeRatio: number | null;
  /** Expected-loss style value-at-risk (Portfolio module formula) */
  varUsd: number;
  assessedAt: string | null;
  scoreSource: string;
  history: { date: string; composite: number }[];
  href: string;
}

export interface Workspace {
  orgId: string;
  orgName: string;
  kind: "assets" | "districts";
  rows: Row[];
  riskThreshold: number;
  currency: string;
  defaultCenter: [number, number];
  region: string | null;
  live: boolean;
}

/** Deep links used by action buttons (kept in one place so modules can evolve). */
export const LINKS = {
  asset: (id: string) => `/app/portfolio?asset=${encodeURIComponent(id)}`,
  portfolio: (q: Record<string, string | number | undefined> = {}) => withQuery("/app/portfolio", q),
  explorer: (lat: number, lon: number, name?: string | null) => withQuery("/app/explorer", { lat: lat.toFixed(4), lon: lon.toFixed(4), name: name ?? undefined }),
  newRule: (q: Record<string, string | number | undefined>) => withQuery("/app/alerts", { new: 1, ...q }),
  alerts: () => "/app/alerts",
  insurance: () => "/app/insurance",
  finance: () => "/app/finance",
  anticipatory: () => "/app/anticipatory",
};

function withQuery(path: string, q: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

export const ASSET_NOUN: Record<string, [string, string]> = {
  insured_plot: ["insured unit", "insured units"],
  loan: ["loan", "loans"],
  farm: ["member farm", "member farms"],
  community: ["community", "communities"],
  warehouse: ["warehouse", "warehouses"],
  processing_plant: ["processing plant", "processing plants"],
  port: ["port", "ports"],
  retail_outlet: ["retail outlet", "retail outlets"],
  field: ["field", "fields"],
  office: ["office", "offices"],
  district: ["district", "districts"],
};

export function nounFor(rows: Pick<Row, "type">[], n = rows.length): string {
  const types = Array.from(new Set(rows.map((r) => r.type)));
  if (types.length === 1) return (ASSET_NOUN[types[0]!] ?? ["asset", "assets"])[n === 1 ? 0 : 1];
  return n === 1 ? "asset" : "assets";
}

// ─── Workspace rows ───────────────────────────────────────────────────────

/**
 * Make sure every asset has a live score before answering — through the
 * Portfolio module's own re-score path so Copilot numbers always match the
 * Portfolio screens (same lastAssessment, same quick metrics).
 */
async function ensureScoredNow(orgId: string, assets: AssetRecord[], by: string) {
  if (!assets.some((a) => !a.lastAssessment)) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 20_000));
  await Promise.race([rescoreWorkspace(orgId, { trigger: "copilot", by }).then(() => undefined).catch(() => undefined), timeout]);
}

export async function loadWorkspace(orgId: string, by = "copilot"): Promise<Workspace> {
  const s = getStore();
  const org = s.orgs.find((o) => o.id === orgId);
  const settings = org?.settings;
  const riskThreshold = settings?.riskThreshold ?? 60;
  const base = {
    orgId,
    orgName: org?.name ?? orgId,
    riskThreshold,
    currency: settings?.currency ?? "USD",
    defaultCenter: (settings?.defaultCenter ?? [22.5, 90]) as [number, number],
    region: org?.region ?? null,
  };
  const assets = s.assets.filter((a) => a.workspaceId === orgId && a.status === "active");
  const districtName = new Map(s.districts.map((d) => [d.id, d.name]));

  if (!assets.length && org?.type === "government") {
    // Government workspaces monitor their districts (live-overlaid by the district risk job)
    const ds = s.districts.filter((d) => d.orgId === orgId);
    const rows: Row[] = ds.map((d) => {
      const composite = compositeScore({ flood: d.floodRisk, salinity: d.salinityRisk, drought: 0, heat: 0 });
      return {
        id: d.id,
        name: d.name,
        type: "district",
        ref: d.id,
        lat: d.lat,
        lon: d.lon,
        country: d.countryName,
        district: d.name,
        crop: d.primaryCrops[0] ?? null,
        tags: [],
        valueUsd: 0,
        meta: { population: d.population, totalFarms: d.totalFarms, vulnerableAreaHa: d.vulnerableAreaHa, ecCurrent: d.ecCurrent },
        composite,
        level: riskLevel(composite),
        flood: Math.round(d.floodRisk),
        salinity: Math.round(d.salinityRisk),
        drought: 0,
        heat: 0,
        drivers: [],
        rain24: null,
        rain72: null,
        ec: d.ecCurrent,
        dischargeRatio: null,
        varUsd: 0,
        assessedAt: d.lastUpdated.toISOString(),
        scoreSource: d.liveSource === "open-meteo" ? "Open-Meteo live overlay" : "seed baseline",
        history: [],
        href: LINKS.explorer(d.lat, d.lon, d.name),
      };
    });
    return { ...base, kind: "districts", rows, live: ds.some((d) => d.liveSource === "open-meteo") };
  }

  await ensureScoredNow(orgId, assets, by);
  const rows: Row[] = assets.map((a) => {
    const q = portfolioState.quick.get(a.id);
    const e = effectiveScore(a);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      ref: a.externalRef,
      lat: a.lat,
      lon: a.lon,
      country: a.country,
      district: a.districtId ? (districtName.get(a.districtId) ?? null) : null,
      crop: a.crop,
      tags: a.tags,
      valueUsd: a.valueUsd,
      meta: a.meta,
      composite: e.composite,
      level: e.level,
      flood: e.flood,
      salinity: e.salinity,
      drought: e.drought,
      heat: e.heat,
      drivers: e.drivers,
      rain24: q?.rain24hMm ?? null,
      rain72: q?.rain72hMm ?? null,
      ec: q?.salinityEc ?? null,
      dischargeRatio: q?.dischargeRatio ?? null,
      varUsd: valueAtRisk(a.valueUsd, e),
      assessedAt: e.at ? new Date(e.at).toISOString() : null,
      scoreSource: e.source === "live" ? "Open-Meteo + GloFAS live re-score" : e.source === "fallback" ? "district baseline (live feed unavailable at last re-score)" : "district baseline (awaiting first live re-score)",
      history: a.history,
      href: LINKS.asset(a.id),
    };
  });
  const live = assets.some((a) => a.lastAssessment && a.lastAssessment.source !== "fallback");
  return { ...base, kind: "assets", rows, live };
}

// ─── Filters ──────────────────────────────────────────────────────────────

export interface RowFilter {
  country?: string;
  types?: string[];
  crop?: string;
  tag?: string;
  area?: string;
}

export function applyFilter(rows: Row[], f: RowFilter): Row[] {
  const n = (s: string) => normalizeText(s);
  return rows.filter((r) => {
    if (f.country && n(r.country) !== n(COUNTRY_ALIASES[n(f.country)] ?? f.country)) return false;
    if (f.types?.length && !f.types.includes(r.type) && !(r.type === "district")) return false;
    if (f.crop && r.crop !== f.crop && !r.tags.includes(f.crop)) return false;
    if (f.tag && !r.tags.includes(f.tag)) return false;
    if (f.area) {
      const a = n(f.area.split(",")[0]!.trim());
      const hit = (r.district && n(r.district) === a) || n(r.name).includes(a) || n(r.country) === a;
      if (!hit) return false;
    }
    return true;
  });
}

export function describeFilter(f: RowFilter): string {
  const parts: string[] = [];
  if (f.tag) parts.push(`tagged “${f.tag}”`);
  if (f.crop) parts.push(`growing ${f.crop}`);
  if (f.area) parts.push(`in ${f.area}`);
  if (f.country) parts.push(`in ${COUNTRY_ALIASES[normalizeText(f.country)] ?? f.country}`);
  return parts.join(", ");
}

// ─── Asset lookup ─────────────────────────────────────────────────────────

export function findAssets(rows: Row[], ref: string): Row[] {
  const r = ref.trim();
  const low = normalizeText(r);
  const exact = rows.filter((x) => x.id.toLowerCase() === low || (x.ref && x.ref.toLowerCase() === low) || normalizeText(x.name) === low);
  if (exact.length) return exact;
  const m = low.match(/^(plot|unit|loan|member farm|farm|community|union|ward)\s+(\d{1,4})$/);
  if (m) {
    const num = Number(m[2]);
    const kind = m[1]!;
    const byName = rows.filter((x) => {
      const nm = normalizeText(x.name);
      if (kind === "plot" || kind === "unit") return new RegExp(`\\b(plot|unit) 0*${num}\\b`).test(nm);
      if (kind === "farm" || kind === "member farm") return new RegExp(`\\bfarm 0*${num}\\b`).test(nm);
      if (kind === "loan") return false;
      return new RegExp(`\\b(${kind}|union|ward|char|para) 0*${num}$`).test(nm);
    });
    if (byName.length) return byName;
    if (kind === "loan") {
      const loans = rows.filter((x) => x.type === "loan");
      return loans[num - 1] ? [loans[num - 1]!] : [];
    }
    return [];
  }
  const partial = rows.filter((x) => normalizeText(x.name).includes(low) || (x.ref && x.ref.toLowerCase().includes(low)));
  return partial.slice(0, 8);
}

// ─── Places ───────────────────────────────────────────────────────────────

export interface ResolvedPlace {
  query: string;
  name: string;
  lat: number;
  lon: number;
  country: string | null;
  admin1: string | null;
  via: "monitored district" | "Open-Meteo geocoding";
}

export async function resolvePlace(query: string): Promise<ResolvedPlace | null> {
  const s = getStore();
  const [head, ...rest] = query.split(",").map((x) => x.trim());
  const country = rest.length ? (COUNTRY_ALIASES[normalizeText(rest.join(" "))] ?? rest.join(" ")) : null;
  const key = normalizeText(head ?? query);
  const d = s.districts.find((x) => normalizeText(x.name) === key);
  if (d && (!country || normalizeText(d.countryName) === normalizeText(country))) {
    return { query, name: d.name, lat: d.lat, lon: d.lon, country: d.countryName, admin1: null, via: "monitored district" };
  }
  const tryQuery = async (q: string) => {
    try {
      return await geocode(q);
    } catch {
      return [];
    }
  };
  let hits = await tryQuery(head ?? query);
  if (!hits.length && head && stripDiacritics(head) !== head) hits = await tryQuery(stripDiacritics(head));
  if (!hits.length) return null;
  const pick = (country && hits.find((h) => normalizeText(h.country ?? "") === normalizeText(country))) || hits[0]!;
  return { query, name: pick.name, lat: pick.latitude, lon: pick.longitude, country: pick.country ?? null, admin1: pick.admin1 ?? null, via: "Open-Meteo geocoding" };
}

// ─── Formatting ───────────────────────────────────────────────────────────

export function usd(v: number, compact = true): string {
  if (!Number.isFinite(v)) return "—";
  if (compact && Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (compact && Math.abs(v) >= 10_000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

export const pct = (part: number, whole: number, digits = 0) => (whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : "0%");
export const num = (v: number, digits = 0) => v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
export const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
