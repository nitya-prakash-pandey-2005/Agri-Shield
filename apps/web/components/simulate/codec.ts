/**
 * Client-side decoding + rendering of Simulation Lab rasters.
 * The server sends zlib-deflated typed arrays (base64); the browser inflates
 * them natively (DecompressionStream "deflate") and paints a canvas for any
 * water level instantly — so the rise slider and the animation never wait for
 * the network.
 */

export async function inflateB64(b64: string): Promise<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

export interface FloodRaster {
  width: number;
  height: number;
  bounds: { west: number; south: number; east: number; north: number };
  /** cm; 65535 = never floods within the simulated range */
  rise: Uint16Array;
  /** cm (≤ 0): depth at rise h is h + d0 */
  d0: Int16Array;
  /** cm of rainfall ponding */
  pond: Uint16Array;
  /** decimetres */
  elev: Int16Array;
  /** 0 land · 1 sea · 2 river/lake source · 3 other permanent water */
  cls: Uint8Array;
}

export async function decodeFlood(r: { width: number; height: number; bounds: FloodRaster["bounds"]; data: string }): Promise<FloodRaster> {
  const buf = await inflateB64(r.data);
  const n = r.width * r.height;
  return {
    width: r.width,
    height: r.height,
    bounds: r.bounds,
    rise: new Uint16Array(buf, 0, n),
    d0: new Int16Array(buf, n * 2, n),
    pond: new Uint16Array(buf, n * 4, n),
    elev: new Int16Array(buf, n * 6, n),
    cls: new Uint8Array(buf, n * 8, n),
  };
}

/** Water depth (m) of display pixel i at rise h (m). */
export function depthAt(r: FloodRaster, i: number, h: number): number {
  const rise = r.rise[i]!;
  let d = rise !== 65535 && rise / 100 < h ? h + r.d0[i]! / 100 : 0;
  const p = r.pond[i]! / 100;
  if (p > d) d = p;
  return d > 0.02 ? d : 0;
}

// depth ramp: pale cyan → deep indigo (sequential, colour-blind safe)
const DEPTH_STOPS: [number, [number, number, number]][] = [
  [0, [165, 243, 252]],
  [0.5, [56, 189, 248]],
  [1, [37, 99, 235]],
  [2, [67, 56, 202]],
  [3.5, [88, 28, 135]],
];
export function depthColor(d: number): [number, number, number] {
  if (d <= DEPTH_STOPS[0]![0]) return DEPTH_STOPS[0]![1];
  for (let k = 1; k < DEPTH_STOPS.length; k++) {
    const [x1, c1] = DEPTH_STOPS[k]!;
    const [x0, c0] = DEPTH_STOPS[k - 1]!;
    if (d <= x1) {
      const t = (d - x0) / (x1 - x0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return DEPTH_STOPS[DEPTH_STOPS.length - 1]![1];
}
export const DEPTH_LEGEND = [
  { label: "< 0.5 m", color: "rgb(110,216,250)" },
  { label: "0.5–1 m", color: "rgb(46,144,241)" },
  { label: "1–2 m", color: "rgb(52,77,218)" },
  { label: "> 2 m", color: "rgb(78,42,168)" },
];

/** Paint the flood raster at level h into an RGBA canvas; returns flooded display pixels. */
export function paintFlood(canvas: HTMLCanvasElement, r: FloodRaster, h: number, opts: { showWater: boolean; showTerrain: boolean }): number {
  canvas.width = r.width;
  canvas.height = r.height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(r.width, r.height);
  const px = img.data;
  let wet = 0;
  for (let i = 0; i < r.rise.length; i++) {
    const o = i * 4;
    const c = r.cls[i]!;
    if (c === 1 || c === 2) {
      if (opts.showWater) {
        px[o] = 14;
        px[o + 1] = 40;
        px[o + 2] = 74;
        px[o + 3] = 150;
      }
      continue;
    }
    const d = depthAt(r, i, h);
    if (d > 0) {
      const [cr, cg, cb] = depthColor(d);
      px[o] = cr;
      px[o + 1] = cg;
      px[o + 2] = cb;
      px[o + 3] = 200;
      wet++;
    } else if (c === 3 && opts.showWater) {
      px[o] = 30;
      px[o + 1] = 64;
      px[o + 2] = 96;
      px[o + 3] = 110;
    } else if (opts.showTerrain) {
      // low ground amber → high ground transparent (helps read the relief)
      const e = r.elev[i]! / 10;
      const t = Math.max(0, Math.min(1, e / 12));
      px[o] = 250;
      px[o + 1] = 204 - 60 * t;
      px[o + 2] = 21;
      px[o + 3] = Math.round(70 * (1 - t));
    }
  }
  ctx.putImageData(img, 0, 0);
  return wet;
}

// ─── mercator helpers for hover read-out ──────────────────────────────────

const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
export function rasterIndex(r: { width: number; height: number; bounds: FloodRaster["bounds"] }, lat: number, lon: number): number | null {
  const x = Math.floor(((lon - r.bounds.west) / (r.bounds.east - r.bounds.west)) * r.width);
  const y0 = mercY(r.bounds.north);
  const y1 = mercY(r.bounds.south);
  const y = Math.floor(((mercY(lat) - y0) / (y1 - y0)) * r.height);
  if (x < 0 || y < 0 || x >= r.width || y >= r.height) return null;
  return y * r.width + x;
}

// ─── cyclone footprint ────────────────────────────────────────────────────

export interface WindRaster {
  width: number;
  height: number;
  bounds: FloodRaster["bounds"];
  wind: Uint8Array;
  land: Uint8Array;
  /** hour (since track start) at which the cell felt its peak wind */
  hour: Uint16Array;
}
export async function decodeWind(f: { width: number; height: number; bounds: FloodRaster["bounds"]; data: string }): Promise<WindRaster> {
  const buf = await inflateB64(f.data);
  const n = f.width * f.height;
  return { width: f.width, height: f.height, bounds: f.bounds, wind: new Uint8Array(buf, 0, n), land: new Uint8Array(buf, n, n), hour: new Uint16Array(buf, n * 2, n) };
}

/** Saffir–Simpson-aligned wind ramp (m/s, 1-min sustained). */
export const WIND_LEGEND = [
  { min: 17.5, label: "Gale 63+ km/h", color: [250, 204, 21] as [number, number, number] },
  { min: 25, label: "Storm 90+", color: [251, 146, 60] as [number, number, number] },
  { min: 33, label: "Cat 1 119+", color: [239, 68, 68] as [number, number, number] },
  { min: 43, label: "Cat 2 154+", color: [219, 39, 119] as [number, number, number] },
  { min: 50, label: "Cat 3 178+", color: [168, 85, 247] as [number, number, number] },
  { min: 58, label: "Cat 4 209+", color: [124, 58, 237] as [number, number, number] },
  { min: 70, label: "Cat 5 252+", color: [255, 255, 255] as [number, number, number] },
];
export function windColor(v: number): [number, number, number, number] | null {
  let c: [number, number, number] | null = null;
  for (const s of WIND_LEGEND) if (v >= s.min) c = s.color;
  return c ? [c[0], c[1], c[2], 150] : null;
}

export function paintWind(canvas: HTMLCanvasElement, r: WindRaster, landOnly: boolean, untilHour = Infinity) {
  canvas.width = r.width;
  canvas.height = r.height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(r.width, r.height);
  for (let i = 0; i < r.wind.length; i++) {
    if (landOnly && !r.land[i]) continue;
    if (r.hour[i]! > untilHour) continue;
    const c = windColor(r.wind[i]!);
    if (!c) continue;
    img.data.set(c, i * 4);
  }
  ctx.putImageData(img, 0, 0);
}

export const surgeColor = (m: number) => (m >= 3 ? "#f43f5e" : m >= 2 ? "#fb923c" : m >= 1 ? "#facc15" : "#67e8f9");
