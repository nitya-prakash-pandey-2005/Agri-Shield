/**
 * Elevation + surface-water rasters for the Simulation Lab, read straight from
 * free global tile pyramids (no keys) and mosaicked server-side:
 *
 *   DEM     AWS Terrain Tiles "Terrarium" (Mapzen/Tilezen; SRTM 1–3″ on land,
 *           ETOPO1/GEBCO bathymetry at sea) — elevation = R·256 + G + B/256 − 32768 m
 *           https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 *   Water   JRC Global Surface Water v1.4 "occurrence" (Pekel et al. 2016,
 *           Nature 540:418) — share of valid Landsat observations 1984–2021 in
 *           which the pixel was water. Tile colour ramp red→blue: B/255 ≈ occurrence.
 *           https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png
 *
 * Both pyramids use the Web-Mercator XYZ scheme, so the mosaic is a regular
 * grid in mercator pixel space (it lines up exactly with Leaflet image overlays).
 *
 * PNG decoding uses Node's built-in zlib and a minimal parser (8-bit greyscale,
 * RGB, RGBA or palette, non-interlaced — which covers both pyramids).
 * Raw tile bytes are cached on disk (OS temp dir) forever: terrain doesn't change.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";

export const TILE = 256;
const EARTH_R = 6378137;

export type TileKind = "terrarium" | "jrc";

export const TILE_SOURCES: Record<TileKind, { url: (z: number, x: number, y: number) => string; maxZoom: number; label: string; href: string }> = {
  terrarium: {
    url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    maxZoom: 15,
    label: "SRTM/ETOPO via AWS Terrain Tiles (Terrarium)",
    href: "https://registry.opendata.aws/terrain-tiles/",
  },
  jrc: {
    url: (z, x, y) => `https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/${z}/${x}/${y}.png`,
    maxZoom: 13,
    label: "JRC Global Surface Water occurrence 1984–2021",
    href: "https://global-surface-water.appspot.com/",
  },
};

// ─── Web-Mercator helpers (global pixel coordinates at zoom z) ─────────────

export const worldSize = (z: number) => TILE * 2 ** z;

export function lonToPx(lon: number, z: number): number {
  return ((lon + 180) / 360) * worldSize(z);
}
export function latToPx(lat: number, z: number): number {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize(z);
}
export function pxToLon(px: number, z: number): number {
  return (px / worldSize(z)) * 360 - 180;
}
export function pxToLat(py: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * py) / worldSize(z);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
/** Ground size (m) of one mercator pixel at latitude `lat`. */
export function pixelSizeM(lat: number, z: number): number {
  return (2 * Math.PI * EARTH_R * Math.cos((lat * Math.PI) / 180)) / worldSize(z);
}

// ─── Minimal PNG decoder ──────────────────────────────────────────────────

export interface DecodedPng {
  width: number;
  height: number;
  /** channels per pixel in `data` (1, 3 or 4; palette images are expanded to 4) */
  channels: number;
  data: Uint8Array;
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodePng(buf: Uint8Array): DecodedPng {
  for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) throw new Error("not a PNG");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p + 8 <= buf.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(buf[p + 4]!, buf[p + 5]!, buf[p + 6]!, buf[p + 7]!);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
      bitDepth = buf[p + 16]!;
      colorType = buf[p + 17]!;
      interlace = buf[p + 20]!;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG not supported");
  const bpp = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  const total = idat.reduce((s, c) => s + c.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const c of idat) {
    joined.set(c, o);
    o += c.length;
  }
  const raw = inflateSync(joined);
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= bpp ? out[dst + i - bpp]! : 0;
      const b = y > 0 ? out[prev + i]! : 0;
      let v: number;
      switch (ft) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4: {
          const c = i >= bpp && y > 0 ? out[prev + i - bpp]! : 0;
          const pp = a + b - c;
          const pa = Math.abs(pp - a);
          const pb = Math.abs(pp - b);
          const pc = Math.abs(pp - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`bad PNG filter ${ft}`);
      }
      out[dst + i] = v & 255;
    }
  }
  if (colorType === 3) {
    if (!palette) throw new Error("palette PNG without PLTE");
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const k = out[i]!;
      rgba[i * 4] = palette[k * 3]!;
      rgba[i * 4 + 1] = palette[k * 3 + 1]!;
      rgba[i * 4 + 2] = palette[k * 3 + 2]!;
      rgba[i * 4 + 3] = trns && k < trns.length ? trns[k]! : 255;
    }
    return { width, height, channels: 4, data: rgba };
  }
  if (colorType === 4) {
    // grey+alpha → RGBA
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[i * 2]!;
      rgba[i * 4 + 3] = out[i * 2 + 1]!;
    }
    return { width, height, channels: 4, data: rgba };
  }
  return { width, height, channels: bpp, data: out };
}

/** Terrarium RGB → metres. */
export function decodeTerrarium(png: DecodedPng): Float32Array {
  const n = png.width * png.height;
  const e = new Float32Array(n);
  const c = png.channels;
  for (let i = 0; i < n; i++) e[i] = png.data[i * c]! * 256 + png.data[i * c + 1]! + png.data[i * c + 2]! / 256 - 32768;
  return e;
}

/** JRC occurrence tile → 0-100 % (0 = never observed as water / no data). */
export function decodeOccurrence(png: DecodedPng): Uint8Array {
  const n = png.width * png.height;
  const o = new Uint8Array(n);
  const c = png.channels;
  for (let i = 0; i < n; i++) {
    const alpha = c === 4 ? png.data[i * c + 3]! : 255;
    if (alpha === 0) continue;
    const b = png.data[i * c + 2]!;
    o[i] = Math.max(1, Math.round((b / 255) * 100));
  }
  return o;
}

// ─── Tile fetching with a permanent disk cache ────────────────────────────

const CACHE_DIR = join(process.env.AGRI_CACHE_DIR ?? join(tmpdir(), "agri-shield-cache"), "tiles");
const g = globalThis as unknown as {
  __agriTileMem?: Map<string, Float32Array | Uint8Array | null>;
  __agriTileInflight?: Map<string, Promise<Float32Array | Uint8Array | null>>;
};
const mem: Map<string, Float32Array | Uint8Array | null> = (g.__agriTileMem ??= new Map());
const inflight: Map<string, Promise<Float32Array | Uint8Array | null>> = (g.__agriTileInflight ??= new Map());
const MEM_MAX = 260;

function remember(key: string, v: Float32Array | Uint8Array | null) {
  if (mem.size >= MEM_MAX) {
    const first = mem.keys().next().value;
    if (first !== undefined) mem.delete(first);
  }
  mem.set(key, v);
}

async function fetchBytes(url: string, timeoutMs: number): Promise<Uint8Array | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Agri-SHIELD/2 (simulation lab)" } });
    if (r.status === 404 || r.status === 403) return null; // outside the pyramid (e.g. no JRC tile over open ocean)
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return new Uint8Array(await r.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

export interface TileStats {
  requested: number;
  fromDisk: number;
  fromNetwork: number;
  missing: number;
}

/**
 * Decoded tile (Float32 metres for terrarium, Uint8 % for jrc), or null when the
 * pyramid has no tile there. Throws on network failure (callers decide fallback).
 */
export function getTile(kind: TileKind, z: number, x: number, y: number, stats?: TileStats): Promise<Float32Array | Uint8Array | null> {
  const key = `${kind}/${z}/${x}/${y}`;
  if (stats) stats.requested++;
  if (mem.has(key)) {
    if (stats) stats.fromDisk++;
    return Promise.resolve(mem.get(key)!);
  }
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    const file = join(CACHE_DIR, kind, String(z), String(x), `${y}.png`);
    let bytes: Uint8Array | null = null;
    let missing = false;
    try {
      const b = await readFile(file);
      bytes = b.length ? new Uint8Array(b) : null;
      missing = !b.length;
      if (stats) stats.fromDisk++;
    } catch {
      if (process.env.AGRI_OFFLINE === "true") throw new Error("offline mode: tile not cached");
      bytes = await fetchBytes(TILE_SOURCES[kind].url(z, x, y), 12_000);
      if (stats) stats.fromNetwork++;
      missing = !bytes;
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes ?? new Uint8Array(0)); // empty file = known-missing tile
      } catch {
        /* read-only FS: memory cache only */
      }
    }
    if (missing || !bytes) {
      if (stats) stats.missing++;
      remember(key, null);
      return null;
    }
    const png = decodePng(bytes);
    const v = kind === "terrarium" ? decodeTerrarium(png) : decodeOccurrence(png);
    remember(key, v);
    return v;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const it = items[i++]!;
      await fn(it);
    }
  });
  await Promise.all(workers);
}

// ─── Mosaic ───────────────────────────────────────────────────────────────

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface DemGrid {
  z: number;
  /** global mercator pixel of the grid's top-left corner */
  px0: number;
  py0: number;
  width: number;
  height: number;
  /** exact geographic bounds of the pixel edges */
  bounds: Bbox;
  elev: Float32Array;
  /** JRC water occurrence 0-100 (null if `withWater` was false) */
  occ: Uint8Array | null;
  /** ground pixel size (m) per row (varies with latitude) */
  rowSizeM: Float32Array;
  tiles: TileStats;
  fetchMs: number;
}

/** Grid dimensions a bbox would have at zoom z (no fetching). */
export function gridDims(b: Bbox, z: number) {
  const px0 = Math.floor(lonToPx(b.west, z));
  const px1 = Math.ceil(lonToPx(b.east, z));
  const py0 = Math.floor(latToPx(b.north, z));
  const py1 = Math.ceil(latToPx(b.south, z));
  return { px0, py0, width: px1 - px0, height: py1 - py0 };
}

/** Load DEM (+ optional JRC water) for a bbox at zoom z, mosaicked and cropped. */
export async function loadGrid(b: Bbox, z: number, opts: { withWater?: boolean; concurrency?: number } = {}): Promise<DemGrid> {
  const t0 = Date.now();
  const { px0, py0, width, height } = gridDims(b, z);
  if (width <= 0 || height <= 0) throw new Error("empty area");
  const tx0 = Math.floor(px0 / TILE);
  const ty0 = Math.floor(py0 / TILE);
  const tx1 = Math.floor((px0 + width - 1) / TILE);
  const ty1 = Math.floor((py0 + height - 1) / TILE);
  const n = 2 ** z;
  const tiles: [number, number][] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.push([tx, ty]);
  const elev = new Float32Array(width * height);
  const occ = opts.withWater ? new Uint8Array(width * height) : null;
  const stats: TileStats = { requested: 0, fromDisk: 0, fromNetwork: 0, missing: 0 };
  const jrcZ = Math.min(z, TILE_SOURCES.jrc.maxZoom);

  await pool(tiles, opts.concurrency ?? 8, async ([tx, ty]) => {
    const wx = ((tx % n) + n) % n;
    const dem = (await getTile("terrarium", z, wx, ty, stats)) as Float32Array | null;
    // copy the overlapping window of this tile into the grid
    const gx0 = Math.max(px0, tx * TILE);
    const gx1 = Math.min(px0 + width, (tx + 1) * TILE);
    const gy0 = Math.max(py0, ty * TILE);
    const gy1 = Math.min(py0 + height, (ty + 1) * TILE);
    for (let gy = gy0; gy < gy1; gy++) {
      const row = (gy - py0) * width;
      const trow = (gy - ty * TILE) * TILE;
      for (let gx = gx0; gx < gx1; gx++) elev[row + gx - px0] = dem ? dem[trow + gx - tx * TILE]! : 0;
    }
    if (occ) {
      // JRC pyramid stops at z13; sample the parent tile when z > 13
      const shift = z - jrcZ;
      const jx = wx >> shift;
      const jy = ty >> shift;
      let w: Uint8Array | null = null;
      try {
        w = (await getTile("jrc", jrcZ, jx, jy, stats)) as Uint8Array | null;
      } catch {
        w = null; // surface water is optional — the DEM still drives the model
      }
      if (w) {
        const scale = 2 ** shift;
        for (let gy = gy0; gy < gy1; gy++) {
          const row = (gy - py0) * width;
          const ly = Math.floor((gy - jy * TILE * scale) / scale);
          for (let gx = gx0; gx < gx1; gx++) {
            const lx = Math.floor((gx - jx * TILE * scale) / scale);
            occ[row + gx - px0] = w[ly * TILE + lx]!;
          }
        }
      }
    }
  });

  const rowSizeM = new Float32Array(height);
  for (let y = 0; y < height; y++) rowSizeM[y] = pixelSizeM(pxToLat(py0 + y + 0.5, z), z);
  return {
    z,
    px0,
    py0,
    width,
    height,
    bounds: { west: pxToLon(px0, z), east: pxToLon(px0 + width, z), north: pxToLat(py0, z), south: pxToLat(py0 + height, z) },
    elev,
    occ,
    rowSizeM,
    tiles: stats,
    fetchMs: Date.now() - t0,
  };
}

/** Elevation (m) at a set of points, sampled from Terrarium tiles at zoom z (default 11 ≈ 70 m). */
export async function sampleElevations(points: { lat: number; lon: number }[], z = 11): Promise<(number | null)[]> {
  const out: (number | null)[] = new Array(points.length).fill(null);
  const byTile = new Map<string, number[]>();
  points.forEach((p, i) => {
    const k = `${Math.floor(lonToPx(p.lon, z) / TILE)}/${Math.floor(latToPx(p.lat, z) / TILE)}`;
    const arr = byTile.get(k) ?? [];
    arr.push(i);
    byTile.set(k, arr);
  });
  await pool([...byTile.entries()], 8, async ([k, idx]) => {
    const [tx, ty] = k.split("/").map(Number) as [number, number];
    let t: Float32Array | null = null;
    try {
      t = (await getTile("terrarium", z, tx, ty)) as Float32Array | null;
    } catch {
      return;
    }
    if (!t) return;
    for (const i of idx) {
      const p = points[i]!;
      const lx = Math.min(TILE - 1, Math.floor(lonToPx(p.lon, z) - tx * TILE));
      const ly = Math.min(TILE - 1, Math.floor(latToPx(p.lat, z) - ty * TILE));
      out[i] = t[ly * TILE + lx]!;
    }
  });
  return out;
}
