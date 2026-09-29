/**
 * Satellite Lab service.
 *
 *  - decodePng()          dependency-free PNG decoder (node:zlib) used to read
 *                         NASA GIBS tiles server-side.
 *  - layerAvailability()  published dates per GIBS layer, parsed from the WMTS
 *                         capabilities document (5.8 MB → a few KB of ranges,
 *                         persisted to disk for 24 h).
 *  - floodScan()          samples the MODIS Combined Flood 2-Day tile pixel at
 *                         every workspace asset → "observed flooded" flags.
 *                         Coarse (~250-300 m) satellite evidence: clouds hide
 *                         water, so "no flood pixel" never proves "no flood".
 *  - ndviSeries()         MODIS MOD13Q1 250 m NDVI for a point vs the same
 *                         16-day composites of the 3 previous years → anomaly,
 *                         z-score and "stress detected" markers. Re-uses the
 *                         satellite-ingest district cache when the point is
 *                         close to a district; otherwise ONE on-demand point
 *                         fetch at a time (ORNL DAAC), cached to disk.
 */
import { inflateSync } from "node:zlib";
import { getStore } from "../data/store";
import { cached } from "../live/http";
import { peekPersisted, persisted } from "../live/disk-cache";
import { satelliteStatus } from "../jobs/satellite-ingest";
import { haversineKm } from "./location-risk";
import { effectiveScore, valueAtRisk, workspaceAssets } from "./portfolio";
import { notifyWorkspace } from "./workspace-notifications";
import {
  LAYERS,
  LAYER_IDS,
  addDays,
  gibsTileUrl,
  isoDate,
  latestAvailable,
  parseTimeValue,
  tileFor,
  worldviewUrl,
  type DateRange,
  type LayerId,
} from "@/components/imagery/tile-math";

const UA = "Agri-SHIELD/1.0 (climate early-warning research)";

// ─── PNG decoding ─────────────────────────────────────────────────────────

export interface DecodedPng {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  /** palette index (colour type 3 only), else null */
  index(x: number, y: number): number | null;
  pixel(x: number, y: number): [number, number, number, number];
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(input: Uint8Array | ArrayBuffer): DecodedPng {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error("Not a PNG file");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p + 8 <= buf.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(buf[p + 4]!, buf[p + 5]!, buf[p + 6]!, buf[p + 7]!);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const channels = CHANNELS[colorType];
  if (!width || !height || channels === undefined) throw new Error(`Unsupported PNG (colour type ${colorType})`);
  if (interlace) throw new Error("Interlaced PNGs are not supported");
  if (colorType === 3 && !palette) throw new Error("Palette PNG without PLTE");
  if (colorType === 3 ? ![1, 2, 4, 8].includes(bitDepth) : colorType === 0 ? ![1, 2, 4, 8, 16].includes(bitDepth) : ![8, 16].includes(bitDepth)) {
    throw new Error(`Unsupported bit depth ${bitDepth} for colour type ${colorType}`);
  }

  const total = idat.reduce((s, c) => s + c.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const c of idat) {
    joined.set(c, o);
    o += c.length;
  }
  const raw = inflateSync(joined);
  const bitsPP = channels * bitDepth;
  const stride = Math.ceil((width * bitsPP) / 8);
  const bpp = Math.max(1, bitsPP >> 3);
  if (raw.length < height * (stride + 1)) throw new Error("PNG data truncated");
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = y > 0 ? dst - stride : -1;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const a = x >= bpp ? out[dst + x - bpp]! : 0;
      const b = prev >= 0 ? out[prev + x]! : 0;
      const c = prev >= 0 && x >= bpp ? out[prev + x - bpp]! : 0;
      let r: number;
      switch (ft) {
        case 0:
          r = v;
          break;
        case 1:
          r = v + a;
          break;
        case 2:
          r = v + b;
          break;
        case 3:
          r = v + ((a + b) >> 1);
          break;
        case 4:
          r = v + paeth(a, b, c);
          break;
        default:
          throw new Error(`Bad PNG filter type ${ft}`);
      }
      out[dst + x] = r & 0xff;
    }
  }

  const sample = (x: number, y: number, ch: number): number => {
    const row = y * stride;
    if (bitDepth === 8) return out[row + x * channels + ch]!;
    if (bitDepth === 16) return out[row + (x * channels + ch) * 2]!; // high byte
    const bitPos = (x * channels + ch) * bitDepth;
    const byte = out[row + (bitPos >> 3)]!;
    const shift = 8 - bitDepth - (bitPos & 7);
    return (byte >> shift) & ((1 << bitDepth) - 1);
  };
  const sample16 = (x: number, y: number, ch: number): number => {
    const i = y * stride + (x * channels + ch) * 2;
    return (out[i]! << 8) | out[i + 1]!;
  };
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;

  return {
    width,
    height,
    colorType,
    bitDepth,
    index(x, y) {
      if (colorType !== 3 || !inside(x, y)) return null;
      return sample(x, y, 0);
    },
    pixel(x, y) {
      if (!inside(x, y)) return [0, 0, 0, 0];
      switch (colorType) {
        case 3: {
          const i = sample(x, y, 0);
          const pl = palette!;
          if (i * 3 + 2 >= pl.length) return [0, 0, 0, 0];
          return [pl[i * 3]!, pl[i * 3 + 1]!, pl[i * 3 + 2]!, trns && i < trns.length ? trns[i]! : 255];
        }
        case 0: {
          const raw0 = sample(x, y, 0);
          const g = bitDepth < 8 ? Math.round((raw0 * 255) / ((1 << bitDepth) - 1)) : raw0;
          let alpha = 255;
          if (trns && trns.length >= 2) {
            const key = (trns[0]! << 8) | trns[1]!;
            const actual = bitDepth === 16 ? sample16(x, y, 0) : raw0;
            if (actual === key) alpha = 0;
          }
          return [g, g, g, alpha];
        }
        case 2: {
          const r = sample(x, y, 0);
          const g = sample(x, y, 1);
          const b = sample(x, y, 2);
          let alpha = 255;
          if (trns && trns.length >= 6) {
            const k = [(trns[0]! << 8) | trns[1]!, (trns[2]! << 8) | trns[3]!, (trns[4]! << 8) | trns[5]!];
            const act = bitDepth === 16 ? [sample16(x, y, 0), sample16(x, y, 1), sample16(x, y, 2)] : [r, g, b];
            if (act[0] === k[0] && act[1] === k[1] && act[2] === k[2]) alpha = 0;
          }
          return [r, g, b, alpha];
        }
        case 4: {
          const g = sample(x, y, 0);
          return [g, g, g, sample(x, y, 1)];
        }
        default:
          return [sample(x, y, 0), sample(x, y, 1), sample(x, y, 2), sample(x, y, 3)];
      }
    },
  };
}

// ─── MODIS flood classes ──────────────────────────────────────────────────

export type FloodClass = "flood" | "recurring_flood" | "surface_water" | "no_water" | "no_data";

/**
 * GIBS colormap MODIS_Flood.xml (v1.3):
 *   0,0,0 transparent = no data · 0,0,1 transparent = no water · 50,210,245 surface water
 *   255,255,0 recurring flood · 250,30,36 flood · 175,175,175 insufficient data (cloud)
 * Nearest-colour matching tolerates resampling at tile edges.
 */
const FLOOD_COLOURS: { cls: FloodClass; rgb: [number, number, number] }[] = [
  { cls: "flood", rgb: [250, 30, 36] },
  { cls: "recurring_flood", rgb: [255, 255, 0] },
  { cls: "surface_water", rgb: [50, 210, 245] },
  { cls: "no_data", rgb: [175, 175, 175] },
];

export function classifyFloodPixel([r, g, b, a]: [number, number, number, number] | number[]): FloodClass {
  if ((a ?? 255) < 128) return r === 0 && g === 0 && b === 0 ? "no_data" : "no_water";
  let best: FloodClass = "no_water";
  let bestD = Infinity;
  for (const c of FLOOD_COLOURS) {
    const d = (r! - c.rgb[0]) ** 2 + (g! - c.rgb[1]) ** 2 + (b! - c.rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c.cls;
    }
  }
  return bestD <= 60 ** 2 ? best : "no_water";
}

export const FLOOD_CLASS_LABEL: Record<FloodClass, string> = {
  flood: "Flood water",
  recurring_flood: "Recurring flood",
  surface_water: "Normal surface water",
  no_water: "Dry land",
  no_data: "Cloud / no data",
};

const isFloodClass = (c: FloodClass) => c === "flood" || c === "recurring_flood";

// ─── GIBS availability ────────────────────────────────────────────────────

const CAPS_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml";

/** Pull the <Value> time ranges of a layer out of the WMTS capabilities text. */
export function extractLayerRanges(caps: string, gibsId: string): DateRange[] {
  const idTag = `<ows:Identifier>${gibsId}</ows:Identifier>`;
  const i = caps.indexOf(idTag);
  if (i < 0) return [];
  const start = caps.lastIndexOf("<Layer>", i);
  const end = caps.indexOf("</Layer>", i);
  const block = caps.slice(start < 0 ? i : start, end < 0 ? undefined : end);
  const dim = block.indexOf("<Dimension>");
  const dimEnd = block.indexOf("</Dimension>", dim);
  const scope = dim >= 0 ? block.slice(dim, dimEnd < 0 ? undefined : dimEnd) : block;
  const out: DateRange[] = [];
  const re = /<Value>([^<]+)<\/Value>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope))) {
    const r = parseTimeValue(m[1]!);
    if (r) out.push(r);
  }
  return out;
}

export interface LayerAvailability {
  layers: Record<LayerId, { ranges: DateRange[]; latest: string | null; earliest: string | null }>;
  fetchedAt: string;
  source: "gibs-capabilities" | "assumed-daily";
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.split("?")[0]}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function assumedAvailability(): LayerAvailability {
  const today = isoDate(new Date());
  const layers = {} as LayerAvailability["layers"];
  for (const id of LAYER_IDS) {
    const lag = LAYERS[id].level === 12 ? 4 : 1;
    const latest = addDays(today, -lag);
    layers[id] = { ranges: [{ start: "2016-01-01", end: latest, periodDays: 1 }], latest, earliest: "2016-01-01" };
  }
  return { layers, fetchedAt: new Date().toISOString(), source: "assumed-daily" };
}

export async function layerAvailability(): Promise<LayerAvailability> {
  try {
    return await persisted(
      "gibs:availability:v1",
      24 * 3600_000,
      async () => {
        const caps = await fetchText(CAPS_URL, 60_000);
        const layers = {} as LayerAvailability["layers"];
        for (const id of LAYER_IDS) {
          const ranges = extractLayerRanges(caps, LAYERS[id].gibsId);
          layers[id] = { ranges, latest: latestAvailable(ranges), earliest: ranges.length ? ranges.reduce((m, r) => (r.start < m ? r.start : m), ranges[0]!.start) : null };
        }
        if (!LAYER_IDS.some((id) => layers[id].ranges.length)) throw new Error("GIBS capabilities had none of our layers");
        return { layers, fetchedAt: new Date().toISOString(), source: "gibs-capabilities" as const };
      },
      { negativeTtlMs: 10 * 60_000 }
    );
  } catch {
    return assumedAvailability();
  }
}

// ─── Tile fetch + decode (cached) ─────────────────────────────────────────

interface FloodTile {
  ok: boolean;
  error: string | null;
  classes: Uint8Array | null; // 256×256 FloodClass codes
}
const CLASS_CODES: FloodClass[] = ["no_data", "no_water", "surface_water", "recurring_flood", "flood"];

async function fetchBytes(url: string, timeoutMs = 20_000): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

export async function floodTile(date: string, x: number, y: number, z = 9): Promise<FloodTile> {
  const url = gibsTileUrl("modis_flood", date, z, x, y);
  try {
    return await cached(`gibs-flood:${date}:${z}/${x}/${y}`, 6 * 3600_000, async () => {
      const png = decodePng(await fetchBytes(url));
      const classes = new Uint8Array(png.width * png.height);
      for (let py = 0; py < png.height; py++)
        for (let px = 0; px < png.width; px++) classes[py * png.width + px] = CLASS_CODES.indexOf(classifyFloodPixel(png.pixel(px, py)));
      return { ok: true, error: null, classes };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), classes: null };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    })
  );
  return out;
}

// ─── Flood scan ───────────────────────────────────────────────────────────

export type FloodVerdict = "observed_flooded" | "flood_nearby" | "cloud" | "dry" | "normal_water" | "unavailable";

export interface FloodScanRow {
  assetId: string;
  name: string;
  type: string;
  country: string;
  lat: number;
  lon: number;
  valueUsd: number;
  varUsd: number;
  composite: number;
  pixel: FloodClass | null;
  verdict: FloodVerdict;
  /** flood pixels in the 3×3 neighbourhood (0-9) */
  floodNeighbours: number;
  /** cloud/no-data pixels in the 3×3 neighbourhood (0-9) */
  cloudNeighbours: number;
  /** date of the look the verdict comes from (multi-day scans) */
  observedOn: string | null;
  /** days in the window with a cloud-free look at the asset */
  clearDays: number;
  tile: string;
}

export interface FloodScanResult {
  workspaceId: string;
  /** last day of the window */
  date: string;
  /** first day of the window */
  from: string;
  windowDays: number;
  scannedAt: Date;
  rows: FloodScanRow[];
  summary: {
    assets: number;
    flooded: number;
    nearby: number;
    cloud: number;
    dry: number;
    normalWater: number;
    unavailable: number;
    exposureFloodedUsd: number;
    exposureNearbyUsd: number;
    tilesFetched: number;
    tilesFailed: number;
    tilesSkipped: number;
  };
  source: string;
  resolution: string;
  worldview: string | null;
  caveat: string;
}

export const FLOOD_SOURCE = "NASA GIBS MODIS Combined Flood 2-Day, ~250 m — coarse satellite evidence";
export const FLOOD_CAVEAT =
  "Coarse 250 m satellite evidence. MODIS cannot see through cloud (grey pixels), small or short-lived floods and flooding under crop canopy can be missed, and one pixel covers ~6 ha. A 'flooded' flag supports — never replaces — a field inspection; 'no flood pixel' does not prove there was no flood.";

const MAX_TILES = 80;

/** Sample centre + 3×3 neighbourhood in tile class grid (neighbours can cross tile edges: clamp inside). */
export function sampleNeighbourhood(classes: Uint8Array, px: number, py: number, size = 256): { centre: FloodClass; flood: number; cloud: number } {
  const centre = CLASS_CODES[classes[py * size + px]!] ?? "no_data";
  let flood = 0;
  let cloud = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = Math.min(size - 1, Math.max(0, px + dx));
      const y = Math.min(size - 1, Math.max(0, py + dy));
      const c = CLASS_CODES[classes[y * size + x]!] ?? "no_data";
      if (isFloodClass(c)) flood++;
      else if (c === "no_data") cloud++;
    }
  return { centre, flood, cloud };
}

export function verdictFor(centre: FloodClass | null, floodNeighbours: number): FloodVerdict {
  if (centre === null) return "unavailable";
  if (isFloodClass(centre)) return "observed_flooded";
  if (floodNeighbours > 0) return "flood_nearby";
  if (centre === "no_data") return "cloud";
  if (centre === "surface_water") return "normal_water";
  return "dry";
}

interface LastScan {
  date: string;
  scannedAt: Date;
  flooded: number;
  nearby: number;
  assets: number;
  exposureFloodedUsd: number;
  floodedAssetIds: string[];
}

const g = globalThis as unknown as { __agriFloodScans?: Map<string, { last: LastScan; result: FloodScanResult }> };
const scans: Map<string, { last: LastScan; result: FloodScanResult }> = (g.__agriFloodScans ??= new Map());

export function lastFloodScan(orgId: string): { date: string; scannedAt: Date; flooded: number; nearby: number; assets: number; exposureFloodedUsd: number; floodedAssetIds: string[] } | null {
  return scans.get(orgId)?.last ?? null;
}

export function lastFloodScanResult(orgId: string): FloodScanResult | null {
  return scans.get(orgId)?.result ?? null;
}

export interface DaySample {
  date: string;
  pixel: FloodClass | null;
  verdict: FloodVerdict;
  floodNeighbours: number;
  cloudNeighbours: number;
}

/**
 * Combine several days of samples for one asset (newest first). Cloud is the
 * enemy of optical flood mapping, so a multi-day window keeps the most
 * informative clear look: any flood → the latest flooded day; else flood
 * nearby; else the latest clear (dry / normal water) day; else cloud.
 */
export function mergeDaySamples(days: DaySample[]): (DaySample & { clearDays: number }) | null {
  if (!days.length) return null;
  const clearDays = days.filter((d) => d.verdict !== "cloud" && d.verdict !== "unavailable").length;
  const pick =
    days.find((d) => d.verdict === "observed_flooded") ??
    days.find((d) => d.verdict === "flood_nearby") ??
    days.find((d) => d.verdict === "dry" || d.verdict === "normal_water") ??
    days.find((d) => d.verdict === "cloud") ??
    days[0]!;
  return { ...pick, clearDays };
}

export async function floodScan(orgId: string, date: string, opts: { assetIds?: string[]; windowDays?: number } = {}): Promise<FloodScanResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");
  const windowDays = Math.max(1, Math.min(10, Math.round(opts.windowDays ?? 1)));
  const idSet = opts.assetIds?.length ? new Set(opts.assetIds) : null;
  const assets = workspaceAssets(orgId).filter((a) => !idSet || idSet.has(a.id));
  const z = 9;
  const byTile = new Map<string, { x: number; y: number; assets: { a: (typeof assets)[number]; px: number; py: number }[] }>();
  for (const a of assets) {
    const t = tileFor(a.lat, a.lon, z);
    const key = `${t.x}/${t.y}`;
    const e = byTile.get(key) ?? { x: t.x, y: t.y, assets: [] };
    e.assets.push({ a, px: t.px, py: t.py });
    byTile.set(key, e);
  }
  // Busiest tiles first so the cap drops the fewest assets
  const tiles = [...byTile.entries()].sort((p, q) => q[1].assets.length - p[1].assets.length);
  const toFetch = tiles.slice(0, MAX_TILES);
  const dates = Array.from({ length: windowDays }, (_, k) => addDays(date, -k)); // newest first
  const jobs = dates.flatMap((d) => toFetch.map(([key, t]) => ({ d, key, t })));
  const fetched = await mapLimit(jobs, 4, async (j) => ({ ...j, tile: await floodTile(j.d, j.t.x, j.t.y, z) }));

  const samples = new Map<string, DaySample[]>();
  let failed = 0;
  for (const { d, t, tile } of fetched) {
    if (!tile.ok) failed++;
    for (const { a, px, py } of t.assets) {
      const s = tile.classes ? sampleNeighbourhood(tile.classes, px, py) : null;
      const arr = samples.get(a.id) ?? [];
      arr.push({ date: d, pixel: s?.centre ?? null, verdict: verdictFor(s?.centre ?? null, s?.flood ?? 0), floodNeighbours: s?.flood ?? 0, cloudNeighbours: s?.cloud ?? 0 });
      samples.set(a.id, arr);
    }
  }
  const rows: FloodScanRow[] = [];
  for (const [key, t] of tiles) {
    for (const { a } of t.assets) {
      const e = effectiveScore(a);
      const days = (samples.get(a.id) ?? []).sort((p, q) => q.date.localeCompare(p.date));
      const m = mergeDaySamples(days);
      rows.push({
        assetId: a.id,
        name: a.name,
        type: a.type,
        country: a.country,
        lat: a.lat,
        lon: a.lon,
        valueUsd: a.valueUsd,
        varUsd: Math.round(valueAtRisk(a.valueUsd, e)),
        composite: e.composite,
        pixel: m?.pixel ?? null,
        verdict: m?.verdict ?? "unavailable",
        floodNeighbours: m?.floodNeighbours ?? 0,
        cloudNeighbours: m?.cloudNeighbours ?? 0,
        observedOn: m && m.verdict !== "unavailable" ? m.date : null,
        clearDays: m?.clearDays ?? 0,
        tile: `${z}/${key}`,
      });
    }
  }
  const rank: Record<FloodVerdict, number> = { observed_flooded: 0, flood_nearby: 1, cloud: 2, unavailable: 3, normal_water: 4, dry: 5 };
  rows.sort((p, q) => rank[p.verdict] - rank[q.verdict] || q.valueUsd - p.valueUsd);
  const count = (v: FloodVerdict) => rows.filter((r) => r.verdict === v).length;
  const sumV = (v: FloodVerdict) => rows.filter((r) => r.verdict === v).reduce((s, r) => s + r.valueUsd, 0);
  const first = rows.find((r) => r.verdict === "observed_flooded") ?? rows[0];
  const result: FloodScanResult = {
    workspaceId: orgId,
    date,
    from: dates[dates.length - 1]!,
    windowDays,
    scannedAt: new Date(),
    rows,
    summary: {
      assets: rows.length,
      flooded: count("observed_flooded"),
      nearby: count("flood_nearby"),
      cloud: count("cloud"),
      dry: count("dry"),
      normalWater: count("normal_water"),
      unavailable: count("unavailable"),
      exposureFloodedUsd: Math.round(sumV("observed_flooded")),
      exposureNearbyUsd: Math.round(sumV("flood_nearby")),
      tilesFetched: fetched.length - failed,
      tilesFailed: failed,
      tilesSkipped: (tiles.length - toFetch.length) * windowDays,
    },
    source: FLOOD_SOURCE,
    resolution: "~250 m MODIS pixel (sampled on the z9 web-mercator grid, ~300 m)",
    worldview: first ? worldviewUrl(first.observedOn ?? date, first.lat, first.lon) : null,
    caveat: FLOOD_CAVEAT,
  };
  if (!idSet) {
    scans.set(orgId, {
      result,
      last: {
        date,
        scannedAt: result.scannedAt,
        flooded: result.summary.flooded,
        nearby: result.summary.nearby,
        assets: result.summary.assets,
        exposureFloodedUsd: result.summary.exposureFloodedUsd,
        floodedAssetIds: rows.filter((r) => r.verdict === "observed_flooded").map((r) => r.assetId),
      },
    });
  }
  return result;
}

export function notifyFloodScan(orgId: string, by: string) {
  const r = lastFloodScanResult(orgId);
  if (!r) throw new Error("Run a flood scan first");
  const s = r.summary;
  const names = r.rows.filter((x) => x.verdict === "observed_flooded").slice(0, 5).map((x) => x.name);
  const span = r.windowDays > 1 ? `${r.from} → ${r.date}` : r.date;
  return notifyWorkspace({
    workspaceId: orgId,
    kind: "alert",
    title: s.flooded ? `Satellite: ${s.flooded} asset${s.flooded === 1 ? "" : "s"} under observed flood water (${span})` : `Satellite flood check ${span}: no asset under flood pixels`,
    body: s.flooded
      ? `MODIS 2-day flood map shows water at ${names.join(", ")}${s.flooded > names.length ? ` and ${s.flooded - names.length} more` : ""}; ${s.nearby} more have flood pixels within ~300 m. Exposure flagged: $${s.exposureFloodedUsd.toLocaleString("en-US")}. Coarse 250 m evidence — confirm on the ground. Shared by ${by}.`
      : `${s.assets} assets checked; ${s.cloud} were under cloud so could not be verified. Shared by ${by}.`,
    href: `/app/imagery?tab=flood&date=${r.date}&days=${r.windowDays}`,
    severity: s.flooded ? "warning" : "info",
  });
}

// ─── Places (quick picks) ─────────────────────────────────────────────────

export function imageryPlaces(orgId: string) {
  const s = getStore();
  const ingest = satelliteStatus();
  const cachedIds = new Set(ingest.districts.filter((d) => d.series.length).map((d) => d.districtId));
  const assets = workspaceAssets(orgId).map((a) => {
    const e = effectiveScore(a);
    return { id: a.id, name: a.name, type: a.type, lat: a.lat, lon: a.lon, country: a.country, composite: e.composite, level: e.level, valueUsd: a.valueUsd };
  });
  const org = s.orgs.find((o) => o.id === orgId);
  return {
    assets,
    districts: s.districts.map((d) => ({ id: d.id, name: d.name, country: d.countryName, lat: d.lat, lon: d.lon, ndviCached: cachedIds.has(d.id) })),
    center: (org?.settings?.defaultCenter ?? (assets[0] ? [assets[0].lat, assets[0].lon] : [22.7, 90.3])) as [number, number],
    zoom: org?.settings?.defaultZoom ?? 7,
    ingest: { lastSuccessAt: ingest.lastSuccessAt, latestComposite: ingest.latestComposite, districts: cachedIds.size },
  };
}

// ─── NDVI time series with multi-year anomaly ─────────────────────────────

export interface NdviComposite {
  date: string;
  doy: number;
  ndvi: number;
  quality?: "clear" | "cloudy";
}

export interface NdviPointResult {
  date: string;
  doy: number;
  ndvi: number;
  mean: number | null;
  std: number | null;
  lower: number | null;
  upper: number | null;
  anomaly: number | null;
  z: number | null;
  dropPct: number | null;
  stress: boolean;
  possibleCloud: boolean;
  years: number;
}

export interface NdviSeriesResult {
  lat: number;
  lon: number;
  name: string | null;
  points: NdviPointResult[];
  baselineYears: number[];
  latest: NdviPointResult | null;
  stressCount: number;
  summary: string;
  tone: "ok" | "warning" | "critical" | "info";
  source: { current: "satellite-ingest cache" | "fetched on demand"; district: string | null; product: string; baseline: string };
}

const doyOf = (iso: string) => {
  const t = Date.parse(`${iso}T00:00:00Z`);
  const y = new Date(t).getUTCFullYear();
  return Math.round((t - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
};
const julian = (iso: string) => `A${iso.slice(0, 4)}${String(doyOf(iso)).padStart(3, "0")}`;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const STRESS_ANOMALY = -0.1;
export const STRESS_Z = -1.5;
export const STRESS_DROP = 0.2;
const MIN_STD = 0.03;

/**
 * Pure: align current composites with baseline composites by day-of-year,
 * compute mean/σ/anomaly/z and stress + possible-cloud markers.
 */
export function ndviAnomalies(current: NdviComposite[], baseline: { year: number; composites: NdviComposite[] }[]): NdviPointResult[] {
  const cur = [...current].sort((a, b) => a.date.localeCompare(b.date));
  const byDoy = new Map<number, number[]>();
  for (const b of baseline)
    for (const c of b.composites) {
      if (!(c.ndvi > -0.2 && c.ndvi <= 1)) continue;
      const arr = byDoy.get(c.doy) ?? [];
      arr.push(c.ndvi);
      byDoy.set(c.doy, arr);
    }
  const pts: NdviPointResult[] = cur.map((c, i) => {
    // tolerate ±3 day misalignment (8-day vs 16-day grids)
    let vals = byDoy.get(c.doy);
    if (!vals) for (let d = 1; d <= 3 && !vals; d++) vals = byDoy.get(c.doy - d) ?? byDoy.get(c.doy + d);
    const n = vals?.length ?? 0;
    const mean = n ? vals!.reduce((s, v) => s + v, 0) / n : null;
    const sd = n >= 2 ? Math.sqrt(vals!.reduce((s, v) => s + (v - mean!) ** 2, 0) / (n - 1)) : null;
    const stdEff = mean != null ? Math.max(MIN_STD, sd ?? MIN_STD) : null;
    const anomaly = mean != null ? c.ndvi - mean : null;
    const z = anomaly != null && stdEff ? anomaly / stdEff : null;
    const prev = i > 0 ? cur[i - 1]!.ndvi : null;
    const dropPct = prev != null && prev > 0.05 ? (c.ndvi - prev) / prev : null;
    const stress = (anomaly != null && z != null && anomaly <= STRESS_ANOMALY && z <= STRESS_Z) || (dropPct != null && dropPct <= -STRESS_DROP);
    return {
      date: c.date,
      doy: c.doy,
      ndvi: r3(c.ndvi),
      mean: mean != null ? r3(mean) : null,
      std: sd != null ? r3(sd) : null,
      lower: mean != null ? r3(mean - (stdEff ?? 0)) : null,
      upper: mean != null ? r3(mean + (stdEff ?? 0)) : null,
      anomaly: anomaly != null ? r3(anomaly) : null,
      z: z != null ? Math.round(z * 100) / 100 : null,
      dropPct: dropPct != null ? Math.round(dropPct * 1000) / 10 : null,
      stress,
      possibleCloud: c.quality === "cloudy",
      years: n,
    };
  });
  // An isolated dip that recovers by the next composite is typical of cloud / haze contamination
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    if (p.stress && pts[i + 1]!.ndvi >= pts[i - 1]!.ndvi * 0.9) p.possibleCloud = true;
  }
  return pts;
}

export function describeNdvi(points: NdviPointResult[]): { summary: string; tone: NdviSeriesResult["tone"] } {
  const latest = points[points.length - 1];
  if (!latest) return { summary: "No usable MODIS composites for this location yet.", tone: "info" };
  const real = points.filter((p) => p.stress && !p.possibleCloud);
  const last3 = points.slice(-3).filter((p) => p.stress && !p.possibleCloud);
  const a = latest.anomaly;
  const vs = a == null ? "" : a >= 0.05 ? ` — greener than usual for this time of year (+${a.toFixed(2)})` : a <= -0.05 ? ` — browner than usual for this time of year (${a.toFixed(2)})` : " — close to normal for this time of year";
  if (latest.ndvi < 0.1)
    return {
      summary: `Latest NDVI ${latest.ndvi.toFixed(2)}${vs}. Values this low mean the pixel is reading water or bare soil, not crop — typically standing flood water, a freshly flooded paddy or thick cloud. Cross-check the Flood extent tab for the same weeks.`,
      tone: latest.mean != null && latest.mean >= 0.3 ? "critical" : "warning",
    };
  if (last3.length)
    return {
      summary: `Vegetation stress detected in ${last3.length} of the last 3 composites. Latest NDVI ${latest.ndvi.toFixed(2)}${vs}. Scout the area: waterlogging, salt burn, drought or an early harvest can all cause this.`,
      tone: last3.length >= 2 ? "critical" : "warning",
    };
  if (real.length) return { summary: `Latest NDVI ${latest.ndvi.toFixed(2)}${vs}. Earlier stress (${real.map((p) => p.date).join(", ")}) has since recovered.`, tone: "ok" };
  return { summary: `Latest NDVI ${latest.ndvi.toFixed(2)}${vs}. No stress signal in the last ${points.length} composites.`, tone: "ok" };
}

interface OrnlSubset {
  scale?: string;
  subset?: { modis_date: string; calendar_date: string; data: number[] }[];
}

async function ornlWindow(lat: number, lon: number, from: string, to: string): Promise<NdviComposite[]> {
  const url =
    `https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&band=250m_16_days_NDVI&startDate=${julian(from)}&endDate=${julian(to)}&kmAboveBelow=0&kmLeftRight=0`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`ORNL MODIS ${res.status}`);
    const r = (await res.json()) as OrnlSubset;
    const scale = Number(r.scale ?? "0.0001") || 0.0001;
    return (r.subset ?? [])
      .map((s) => ({ date: s.calendar_date, doy: Number(s.modis_date.slice(5)), ndvi: (s.data?.[0] ?? -3000) * scale }))
      .filter((s) => s.ndvi > -0.2 && s.ndvi <= 1);
  } finally {
    clearTimeout(t);
  }
}

// One on-demand ORNL point at a time, platform-wide.
const gq = globalThis as unknown as { __agriNdviQueue?: Promise<unknown> };
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const prev = gq.__agriNdviQueue ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  gq.__agriNdviQueue = run.catch(() => undefined);
  return run;
}

const WINDOW_DAYS = 150; // ≤ 10 × 16-day composites per ORNL request
const BASELINE_YEARS = 3;

export async function ndviSeries(p: { lat: number; lon: number; name?: string | null }): Promise<NdviSeriesResult> {
  const lat = Math.round(p.lat * 100) / 100;
  const lon = Math.round(p.lon * 100) / 100;
  const to = isoDate(new Date());
  const from = addDays(to, -WINDOW_DAYS);
  const bucket = to.slice(0, 8) + (Number(to.slice(8)) < 16 ? "a" : "b"); // refresh twice a month

  // 1) current window: satellite-ingest district cache when within 5 km (zero fetch)
  const ingest = satelliteStatus().districts.filter((d) => d.series.length >= 3);
  const near = ingest.map((d) => ({ d, km: haversineKm(lat, lon, d.lat, d.lon) })).sort((a, b) => a.km - b.km)[0];
  const fromIngest = !!near && near.km <= 5;
  const qLat = fromIngest ? near!.d.lat : lat;
  const qLon = fromIngest ? near!.d.lon : lon;

  // 2) baseline: same calendar window in the previous years (immutable → long TTL)
  const thisYear = Number(to.slice(0, 4));
  const windows = [
    ...(fromIngest ? [] : [{ year: thisYear, key: `ndvi:cur:${lat},${lon}:${bucket}`, ttl: 16 * 86_400_000, f: from, t: to }]),
    ...Array.from({ length: BASELINE_YEARS }, (_, i) => {
      const y = thisYear - (i + 1);
      const f = `${y + (Number(from.slice(0, 4)) - thisYear)}${from.slice(4)}`;
      const t = `${y}${to.slice(4)}`;
      return { year: y, key: `ndvi:base:${qLat.toFixed(2)},${qLon.toFixed(2)}:${f}:${t}`, ttl: 365 * 86_400_000, f, t };
    }),
  ];
  const fetchAll = () => Promise.all(windows.map((w) => persisted(w.key, w.ttl, () => ornlWindow(qLat, qLon, w.f, w.t)).catch(() => null)));
  // Already on disk → answer immediately; otherwise join the one-point-at-a-time queue
  const peeked = await Promise.all(windows.map((w) => peekPersisted<NdviComposite[]>(w.key, w.ttl)));
  const got = peeked.every((x) => x) ? peeked : await serial(fetchAll);

  let current: NdviComposite[];
  if (fromIngest) current = near!.d.series.map((s) => ({ date: s.date, doy: Number(s.modisDate.slice(5)), ndvi: s.ndvi, quality: s.quality }));
  else {
    if (!got[0]) throw new Error("ORNL DAAC did not return this season's composites");
    current = got[0];
  }
  const sourceCurrent: NdviSeriesResult["source"]["current"] = fromIngest ? "satellite-ingest cache" : "fetched on demand";
  const district = fromIngest ? near!.d.name : null;
  const baseline = windows
    .map((w, i) => ({ w, c: got[i] }))
    .filter((x) => x.w.year !== thisYear && x.c)
    .map((x) => ({ year: x.w.year, composites: x.c! }));

  const points = ndviAnomalies(current, baseline);
  const { summary, tone } = describeNdvi(points);
  return {
    lat,
    lon,
    name: p.name ?? null,
    points,
    baselineYears: baseline.filter((b) => b.composites.length).map((b) => b.year),
    latest: points[points.length - 1] ?? null,
    stressCount: points.filter((x) => x.stress && !x.possibleCloud).length,
    summary,
    tone,
    source: {
      current: sourceCurrent,
      district,
      product: "MODIS MOD13Q1 v6.1 · 250 m · 16-day NDVI (ORNL DAAC)",
      baseline: `Same 16-day composites in ${baseline.map((b) => b.year).join(", ") || "—"}`,
    },
  };
}
