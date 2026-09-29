/**
 * Soil profile from ISRIC SoilGrids 2.0 (250 m global soil maps, CC BY 4.0).
 * Topsoil (0-30 cm) depth-weighted means of clay/sand/silt, pH, organic carbon
 * and CEC, plus a USDA texture class and plain-language agronomic notes.
 * The REST query API is occasionally slow/unavailable → long disk cache +
 * negative cache, and a fallback to ISRIC's MapServer (WMS GetFeatureInfo on
 * the same 250 m SoilGrids layers) when the REST host does not answer.
 */
import { fetchJson, OFFLINE } from "./http";
import { persisted } from "./disk-cache";

const SOILGRIDS = "https://rest.isric.org/soilgrids/v2.0/properties/query";
const SOILGRIDS_WMS = "https://maps.isric.org/mapserv";
const DEPTHS = [
  { label: "0-5cm", w: 5 },
  { label: "5-15cm", w: 10 },
  { label: "15-30cm", w: 15 },
];
const PROPS = ["clay", "sand", "silt", "phh2o", "soc", "cec"] as const;
type Prop = (typeof PROPS)[number];

export interface SoilProfile {
  source: string;
  depth: string;
  clayPct: number | null;
  sandPct: number | null;
  siltPct: number | null;
  ph: number | null;
  socGkg: number | null;
  cecCmolKg: number | null;
  texture: string | null;
  drainage: "poor" | "moderate" | "good" | null;
  notes: string[];
}

interface SoilGridsResponse {
  properties: {
    layers: {
      name: string;
      unit_measure: { d_factor: number; target_units: string };
      depths: { label: string; values: { mean: number | null } }[];
    }[];
  };
}

/** USDA soil texture triangle (percentages summing to ~100). */
export function usdaTexture(sand: number, silt: number, clay: number): string {
  if (silt + 1.5 * clay < 15) return "Sand";
  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return "Loamy sand";
  if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) || (clay < 7 && silt < 50 && silt + 2 * clay >= 30)) return "Sandy loam";
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "Loam";
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return "Silt loam";
  if (silt >= 80 && clay < 12) return "Silt";
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "Sandy clay loam";
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return "Clay loam";
  if (clay >= 27 && clay < 40 && sand <= 20) return "Silty clay loam";
  if (clay >= 35 && sand > 45) return "Sandy clay";
  if (clay >= 40 && silt >= 40) return "Silty clay";
  if (clay >= 40 && sand <= 45 && silt < 40) return "Clay";
  return "Loam";
}

export function soilNotes(p: Pick<SoilProfile, "clayPct" | "sandPct" | "ph" | "socGkg">): { drainage: SoilProfile["drainage"]; notes: string[] } {
  const notes: string[] = [];
  let drainage: SoilProfile["drainage"] = null;
  if (p.clayPct != null && p.sandPct != null) {
    drainage = p.clayPct >= 35 ? "poor" : p.sandPct >= 60 ? "good" : "moderate";
    if (drainage === "poor") notes.push("Heavy clay drains slowly — standing water after heavy rain lasts longer, raising flood-damage duration; good for paddy rice.");
    if (drainage === "good") notes.push("Sandy soil drains fast and holds little water — crops feel dry spells sooner; irrigate little and often.");
    if (drainage === "moderate") notes.push("Medium texture with balanced drainage and water holding — suits most field crops.");
  }
  if (p.ph != null) {
    if (p.ph < 5.5) notes.push(`Acidic (pH ${p.ph}) — lime may be needed; phosphorus availability is reduced.`);
    else if (p.ph > 8) notes.push(`Alkaline (pH ${p.ph}) — watch for sodicity and zinc/iron deficiency; often linked to salt-affected land.`);
    else notes.push(`pH ${p.ph} is within the comfortable range for most crops.`);
  }
  if (p.socGkg != null) {
    if (p.socGkg < 10) notes.push("Low organic carbon — soil holds less water and nutrients; residues/manure improve resilience to drought.");
    else if (p.socGkg > 25) notes.push("High organic carbon — good structure and water-holding capacity.");
  }
  return { drainage, notes };
}

/** Every SoilGrids 2.0 property used here is published as mapped value = conventional unit × 10. */
const D_FACTOR = 10;

/** Pull the numeric value out of MapServer's text/html GetFeatureInfo template (null = no data, e.g. water). */
export function parseFeatureInfoValue(html: string): number | null {
  const m = /<span id="value">\s*(-?\d+(?:\.\d+)?)\s*<\/span>/.exec(html);
  return m ? Number(m[1]) : null;
}

/** Single-pixel point query against ISRIC's WMS for one property/depth layer. */
async function wmsPoint(prop: Prop, depth: string, lat: number, lon: number, timeoutMs = 15000): Promise<number | null> {
  if (OFFLINE) throw new Error("offline mode");
  const layer = `${prop}_${depth}_mean`;
  // ~1 km window rendered at 11×11 px, queried at the centre pixel (the point itself)
  const d = 0.005;
  const q = new URLSearchParams({
    map: `/map/${prop}.map`,
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetFeatureInfo",
    LAYERS: layer,
    QUERY_LAYERS: layer,
    STYLES: "",
    SRS: "EPSG:4326",
    BBOX: `${(lon - d).toFixed(4)},${(lat - d).toFixed(4)},${(lon + d).toFixed(4)},${(lat + d).toFixed(4)}`,
    WIDTH: "11",
    HEIGHT: "11",
    X: "5",
    Y: "5",
    INFO_FORMAT: "text/html",
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SOILGRIDS_WMS}?${q}`, { signal: ctrl.signal, headers: { "User-Agent": "Agri-SHIELD/1.0 (climate early-warning research)" }, cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${SOILGRIDS_WMS}`);
    return parseFeatureInfoValue(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

/** Depth-weighted 0–30 cm mean in conventional units from per-depth mapped values. */
export function depthWeighted(values: Record<string, number | null | undefined>, dFactor = D_FACTOR): number | null {
  let s = 0;
  let w = 0;
  for (const d of DEPTHS) {
    const v = values[d.label];
    if (v != null) {
      s += (v / (dFactor || 1)) * d.w;
      w += d.w;
    }
  }
  return w ? Math.round((s / w) * 10) / 10 : null;
}

async function fromRest(lat: number, lon: number): Promise<Record<Prop, number | null>> {
  const q = PROPS.map((p) => `property=${p}`).join("&") + "&" + DEPTHS.map((d) => `depth=${d.label}`).join("&");
  const r = await fetchJson<SoilGridsResponse>(`${SOILGRIDS}?lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}&${q}&value=mean`, 12000);
  const out = {} as Record<Prop, number | null>;
  for (const p of PROPS) {
    const layer = r.properties.layers.find((l) => l.name === p);
    out[p] = layer ? depthWeighted(Object.fromEntries(layer.depths.map((x) => [x.label, x.values.mean])), layer.unit_measure.d_factor) : null;
  }
  return out;
}

/** Point first, then rings at ~1 km and ~2 km: SoilGrids masks towns and rivers, farms often sit right beside them. */
const PROBE_OFFSETS: [number, number][] = [[0, 0], ...[0.01, 0.02].flatMap((r) => [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [r, -r], [-r, r], [-r, -r]] as [number, number][])];

async function fromWms(lat: number, lon: number): Promise<{ values: Record<Prop, number | null>; offsetKm: number }> {
  let anchor: { lat: number; lon: number; clay0: number } | null = null;
  for (let i = 0; i < PROBE_OFFSETS.length && !anchor; i += i === 0 ? 1 : 8) {
    const ring = i === 0 ? [PROBE_OFFSETS[0]!] : PROBE_OFFSETS.slice(i, i + 8);
    const res = await Promise.allSettled(ring.map(([dy, dx]) => wmsPoint("clay", "0-5cm", lat + dy, lon + dx)));
    if (i === 0 && res[0]!.status === "rejected") throw (res[0] as PromiseRejectedResult).reason;
    const k = res.findIndex((r) => r.status === "fulfilled" && r.value != null);
    if (k >= 0) anchor = { lat: lat + ring[k]![0], lon: lon + ring[k]![1], clay0: (res[k] as PromiseFulfilledResult<number>).value };
  }
  if (!anchor) throw new Error("SoilGrids has no data here (water, urban or ice)");
  const a = anchor;
  const jobs = PROPS.flatMap((p) => DEPTHS.map((d) => ({ p, depth: d.label }))).filter((j) => !(j.p === "clay" && j.depth === "0-5cm"));
  const values = new Map<string, number | null>([["clay|0-5cm", a.clay0]]);
  // A few at a time — it's a shared public map server
  for (let i = 0; i < jobs.length; i += 6) {
    const batch = jobs.slice(i, i + 6);
    const res = await Promise.allSettled(batch.map((j) => wmsPoint(j.p, j.depth, a.lat, a.lon)));
    res.forEach((r, k) => values.set(`${batch[k]!.p}|${batch[k]!.depth}`, r.status === "fulfilled" ? r.value : null));
  }
  const out = {} as Record<Prop, number | null>;
  for (const p of PROPS) out[p] = depthWeighted(Object.fromEntries(DEPTHS.map((d) => [d.label, values.get(`${p}|${d.label}`)])));
  const offsetKm = Math.round(Math.hypot((a.lat - lat) * 111, (a.lon - lon) * 111 * Math.cos((lat * Math.PI) / 180)) * 10) / 10;
  return { values: out, offsetKm };
}

/** When the REST host stops answering, go straight to WMS for a while instead of waiting out its timeout per lookup. */
let restDownUntil = 0;

export function getSoilProfile(lat: number, lon: number): Promise<SoilProfile> {
  const key = `soil:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return persisted(key, 180 * 86_400_000, async () => {
    let v: Record<Prop, number | null>;
    let source = "ISRIC SoilGrids 2.0 (250 m)";
    try {
      if (Date.now() < restDownUntil) throw new Error("SoilGrids REST recently unavailable");
      v = await fromRest(lat, lon);
    } catch (e) {
      if (!/recently unavailable/.test((e as Error).message)) restDownUntil = Date.now() + 15 * 60_000;
      const w = await fromWms(lat, lon);
      v = w.values;
      source = w.offsetKm > 0 ? `ISRIC SoilGrids 2.0 (250 m, WMS · nearest soil pixel ${w.offsetKm} km)` : "ISRIC SoilGrids 2.0 (250 m, WMS)";
    }
    // mapped units ÷ d_factor = conventional units (clay/sand/silt %, pH, SOC g/kg, CEC cmol(c)/kg)
    const { clay: clayPct, sand: sandPct, silt: siltPct, phh2o: ph, soc: socGkg, cec: cecCmolKg } = v;
    if (clayPct == null && ph == null) throw new Error("SoilGrids has no data here (water, urban or ice)");
    const texture = clayPct != null && sandPct != null && siltPct != null ? usdaTexture(sandPct, siltPct, clayPct) : null;
    const n = soilNotes({ clayPct, sandPct, ph, socGkg });
    return { source, depth: "0–30 cm (depth-weighted)", clayPct, sandPct, siltPct, ph, socGkg, cecCmolKg, texture, drainage: n.drainage, notes: n.notes };
  }, { negativeTtlMs: 10 * 60_000 });
}
