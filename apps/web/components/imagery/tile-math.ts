/**
 * Web-Mercator tile maths + the NASA GIBS layer catalogue used by the
 * Satellite Lab. Pure (no DOM, no Node APIs) so the server (flood-pixel
 * sampling) and the browser (swipe maps, time-lapse canvas) share one
 * implementation.
 *
 *   EPSG:3857 "GoogleMapsCompatible" tile grid, 256 px tiles:
 *     x = (lon + 180) / 360 · 2^z
 *     y = (1 − ln(tan φ + sec φ) / π) / 2 · 2^z
 */

export const TILE_SIZE = 256;
export const MAX_LAT = 85.0511287798066;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

const clampLat = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
/** Wrap longitude into [-180, 180). */
export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Fractional tile coordinates of a point at zoom z. */
export function lonLatToTileFrac(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const phi = (clampLat(lat) * Math.PI) / 180;
  const x = ((wrapLon(lon) + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n;
  return { x: Math.min(n - 1e-9, Math.max(0, x)), y: Math.min(n - 1e-9, Math.max(0, y)) };
}

/** Inverse of lonLatToTileFrac: fractional tile coords → lat/lon. */
export function tileFracToLonLat(x: number, y: number, z: number): { lat: number; lon: number } {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lon };
}

export interface TilePixel {
  z: number;
  x: number;
  y: number;
  /** pixel column/row inside the 256×256 tile (0-255) */
  px: number;
  py: number;
}

/** The tile containing a point and the pixel inside it. */
export function tileFor(lat: number, lon: number, z: number): TilePixel {
  const f = lonLatToTileFrac(lat, lon, z);
  const x = Math.floor(f.x);
  const y = Math.floor(f.y);
  const px = Math.min(TILE_SIZE - 1, Math.floor((f.x - x) * TILE_SIZE));
  const py = Math.min(TILE_SIZE - 1, Math.floor((f.y - y) * TILE_SIZE));
  return { z, x, y, px, py };
}

/** Centre of a pixel of a tile → lat/lon. */
export function pixelToLonLat(z: number, x: number, y: number, px: number, py: number): { lat: number; lon: number } {
  return tileFracToLonLat(x + (px + 0.5) / TILE_SIZE, y + (py + 0.5) / TILE_SIZE, z);
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function tileBounds(z: number, x: number, y: number): BBox {
  const nw = tileFracToLonLat(x, y, z);
  const se = tileFracToLonLat(x + 1, y + 1, z);
  return { north: nw.lat, west: nw.lon, south: se.lat, east: se.lon };
}

/** Every tile (x,y) at zoom z intersecting a bbox (no antimeridian wrapping). */
export function tilesCovering(b: BBox, z: number, max = 400): { z: number; x: number; y: number }[] {
  const a = lonLatToTileFrac(b.north, b.west, z);
  const c = lonLatToTileFrac(b.south, b.east, z);
  const x0 = Math.floor(Math.min(a.x, c.x));
  const x1 = Math.floor(Math.max(a.x, c.x));
  const y0 = Math.floor(Math.min(a.y, c.y));
  const y1 = Math.floor(Math.max(a.y, c.y));
  const out: { z: number; x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    out.push({ z, x, y });
    if (out.length >= max) return out;
  }
  return out;
}

/** Ground resolution of one tile pixel at latitude `lat`. */
export function metresPerPixel(lat: number, z: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((clampLat(lat) * Math.PI) / 180)) / (TILE_SIZE * 2 ** z);
}

/** Largest zoom whose tile count across a bbox stays within a budget (for canvas time-lapse). */
export function zoomForBBox(b: BBox, maxZoom: number, maxTiles = 16): number {
  for (let z = maxZoom; z >= 1; z--) if (tilesCovering(b, z, maxTiles + 1).length <= maxTiles) return z;
  return 1;
}

// ─── GIBS layer catalogue ─────────────────────────────────────────────────

export type LayerKind = "truecolor" | "ndvi" | "flood";

export interface ImageryLayer {
  id: LayerId;
  label: string;
  short: string;
  gibsId: string;
  /** GoogleMapsCompatible_Level{level} — also the max native zoom */
  level: number;
  ext: "png" | "jpg";
  resolution: string;
  cadence: string;
  kind: LayerKind;
  /** transparent overlay that should be drawn over a true-colour base */
  overlay: boolean;
  description: string;
  /** typical days between usable images (for availability hints) */
  revisitDays: number;
}

export type LayerId = "hls_s30" | "hls_l30" | "modis_tc" | "viirs_tc" | "modis_ndvi" | "modis_flood";

export const LAYERS: Record<LayerId, ImageryLayer> = {
  hls_s30: {
    id: "hls_s30",
    label: "HLS Sentinel-2 · 30 m true colour",
    short: "HLS S30",
    gibsId: "HLS_S30_Nadir_BRDF_Adjusted_Reflectance",
    level: 12,
    ext: "png",
    resolution: "30 m",
    cadence: "every 2–5 days (per satellite pass)",
    kind: "truecolor",
    overlay: false,
    description: "Field-scale colour photo from ESA Sentinel-2, harmonised by NASA. Sharp enough to see individual fields and river banks, but each date only covers the strips a satellite passed over — many dates are blank or cloudy.",
    revisitDays: 3,
  },
  hls_l30: {
    id: "hls_l30",
    label: "HLS Landsat · 30 m true colour",
    short: "HLS L30",
    gibsId: "HLS_L30_Nadir_BRDF_Adjusted_Reflectance",
    level: 12,
    ext: "png",
    resolution: "30 m",
    cadence: "every 8 days (Landsat 8+9)",
    kind: "truecolor",
    overlay: false,
    description: "Field-scale colour photo from NASA/USGS Landsat. Same 30 m detail as Sentinel-2, fewer passes; use it to fill gaps.",
    revisitDays: 8,
  },
  modis_tc: {
    id: "modis_tc",
    label: "MODIS Terra · 250 m true colour",
    short: "MODIS",
    gibsId: "MODIS_Terra_CorrectedReflectance_TrueColor",
    level: 9,
    ext: "jpg",
    resolution: "250 m",
    cadence: "daily, full coverage",
    kind: "truecolor",
    overlay: false,
    description: "A daily whole-Earth colour photo. Coarse (250 m) but never misses a day, so it is the best layer for watching floods spread and recede.",
    revisitDays: 1,
  },
  viirs_tc: {
    id: "viirs_tc",
    label: "VIIRS SNPP · 375 m true colour",
    short: "VIIRS",
    gibsId: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
    level: 9,
    ext: "jpg",
    resolution: "375 m",
    cadence: "daily, full coverage",
    kind: "truecolor",
    overlay: false,
    description: "Daily colour photo from the Suomi-NPP satellite (afternoon pass). A second look when MODIS is cloudy.",
    revisitDays: 1,
  },
  modis_ndvi: {
    id: "modis_ndvi",
    label: "MODIS NDVI · 8-day vegetation",
    short: "NDVI",
    gibsId: "MODIS_Terra_NDVI_8Day",
    level: 9,
    ext: "png",
    resolution: "250 m",
    cadence: "8-day composite",
    kind: "ndvi",
    overlay: false,
    description: "Greenness of vegetation: dark green = dense healthy crops, brown/yellow = bare, stressed or harvested land.",
    revisitDays: 8,
  },
  modis_flood: {
    id: "modis_flood",
    label: "MODIS flood · 2-day observed water",
    short: "Flood",
    gibsId: "MODIS_Combined_Flood_2-Day",
    level: 9,
    ext: "png",
    resolution: "250 m",
    cadence: "daily (2-day window)",
    kind: "flood",
    overlay: true,
    description: "NASA's near-real-time flood map: red = water where there normally is none (flood), yellow = recurring seasonal flooding, light blue = normal rivers and lakes, grey = too cloudy to tell.",
    revisitDays: 1,
  },
};

export const LAYER_IDS = Object.keys(LAYERS) as LayerId[];

export function gibsTileUrl(layerId: LayerId, date: string, z: number, x: number, y: number): string {
  const l = LAYERS[layerId];
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${l.gibsId}/default/${date}/GoogleMapsCompatible_Level${l.level}/${z}/${y}/${x}.${l.ext}`;
}

/** Leaflet-style URL template ({z}/{y}/{x}) for a layer/date. */
export function gibsTemplate(layerId: LayerId, date: string): string {
  const l = LAYERS[layerId];
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${l.gibsId}/default/${date}/GoogleMapsCompatible_Level${l.level}/{z}/{y}/{x}.${l.ext}`;
}

export const worldviewUrl = (date: string, lat: number, lon: number, layers = "MODIS_Terra_CorrectedReflectance_TrueColor,MODIS_Combined_Flood_2-Day") =>
  `https://worldview.earthdata.nasa.gov/?v=${(lon - 1.5).toFixed(2)},${(lat - 1).toFixed(2)},${(lon + 1.5).toFixed(2)},${(lat + 1).toFixed(2)}&l=${layers}&t=${date}`;

// ─── Dates & availability ────────────────────────────────────────────────

const DAY_MS = 86_400_000;
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => Date.parse(`${s}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  return isoDate(new Date(parse(date) + days * DAY_MS));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / DAY_MS);
}

/** Dates from `from` to `to` inclusive every `stepDays` (max `limit`). */
export function stepDates(from: string, to: string, stepDays: number, limit = 120): string[] {
  const out: string[] = [];
  const step = Math.max(1, Math.round(stepDays));
  if (parse(from) > parse(to)) return out;
  for (let d = from; parse(d) <= parse(to) && out.length < limit; d = addDays(d, step)) out.push(d);
  return out;
}

export interface DateRange {
  start: string;
  end: string;
  periodDays: number;
}

/** Parse GIBS ISO-8601 time values ("2021-03-22/2021-12-20/P1D" or single "2021-01-01"). */
export function parseTimeValue(v: string): DateRange | null {
  const parts = v.trim().split("/");
  const d = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
  if (parts.length === 1) {
    const s = d(parts[0]!);
    return s ? { start: s, end: s, periodDays: 1 } : null;
  }
  const start = d(parts[0]!);
  const end = d(parts[1]!);
  if (!start || !end) return null;
  const m = /^P(\d+)D$/.exec(parts[2] ?? "P1D");
  return { start, end, periodDays: m ? Number(m[1]) : 1 };
}

/** Is `date` a published time step of any range? */
export function isAvailable(date: string, ranges: DateRange[]): boolean {
  const t = parse(date);
  return ranges.some((r) => {
    const s = parse(r.start);
    const e = parse(r.end);
    if (t < s || t > e) return false;
    return Math.round((t - s) / DAY_MS) % Math.max(1, r.periodDays) === 0;
  });
}

/** The published date closest to `date` (ties → earlier). null if no ranges. */
export function nearestAvailable(date: string, ranges: DateRange[]): string | null {
  if (!ranges.length) return null;
  const t = parse(date);
  let best: string | null = null;
  let bestDist = Infinity;
  for (const r of ranges) {
    const s = parse(r.start);
    const e = parse(r.end);
    const p = Math.max(1, r.periodDays) * DAY_MS;
    let cands: number[];
    if (t <= s) cands = [s];
    else if (t >= e) cands = [s + Math.floor((e - s) / p) * p];
    else {
      const k = Math.floor((t - s) / p);
      cands = [s + k * p, Math.min(e, s + (k + 1) * p)];
    }
    for (const c of cands) {
      const dist = Math.abs(c - t);
      if (dist < bestDist || (dist === bestDist && best && c < parse(best))) {
        bestDist = dist;
        best = isoDate(new Date(c));
      }
    }
  }
  return best;
}

/** Latest published date across ranges. */
export function latestAvailable(ranges: DateRange[]): string | null {
  let best: string | null = null;
  for (const r of ranges) if (!best || r.end > best) best = r.end;
  return best;
}
