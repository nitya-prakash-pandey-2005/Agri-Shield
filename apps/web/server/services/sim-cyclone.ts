/**
 * Simulation Lab — tropical-cyclone wind footprint, storm-surge index and
 * portfolio impacts for a historical (IBTrACS) or custom track.
 *
 * Wind: Holland (1980, Mon. Wea. Rev. 108:1212) parametric profile
 *   p(r) = pc + Δp·exp(−(Rmax/r)^B)
 *   Vg(r) = sqrt( (B/ρ)(Rmax/r)^B Δp e^{−(Rmax/r)^B} + (r f / 2)² ) − r f / 2
 *   surface 1-min wind  Vs = 0.8·Vg  (Powell et al. 2003 boundary-layer ratio)
 *   + forward-motion asymmetry  0.5·Vt·cos(angle to the right of motion)·Vs/Vmax
 *   Δp   = P_env − pc  (P_env = IBTrACS POCI where known, else 1010 hPa)
 *   Rmax = IBTrACS USA_RMW where known, else Vickery & Wadhera (2008):
 *          ln Rmax[km] = 3.015 − 6.291e-5·Δp² + 0.0337·|lat|
 *   B    = ρ·e·(Vmax/0.8)² / Δp (Holland 1980, matched to the best-track Vmax),
 *          clamped 1.0–2.5; Vickery & Wadhera B = 1.881 − 0.00557·Rmax − 0.01295·|lat| if Vmax is missing
 *   Missing pc ↔ Vmax from Atkinson & Holliday (1977): Vmax[kt] = 6.7·(1010 − pc)^0.644
 *   The 6-hourly best track is interpolated to 1-hour steps; each grid cell keeps
 *   its lifetime maximum (the "footprint").
 *
 * Surge index (coastal sea cells): inverse barometer + steady wind set-up
 *   η_IB = Δp(r)·100 / (ρw·g)              (≈ 1 cm per hPa)
 *   η_ws = ρa·Cd·U²·cosθ / (ρw·g) · (L/h)  (θ = wind vs. onshore normal; L/h = shelf width ÷ depth,
 *          default 4000 ≈ broad shallow shelf such as the northern Bay of Bengal)
 *   Cd   = min(2.5e-3, (0.75 + 0.067·U)·1e-3)  (Garratt 1977, capped per Powell et al. 2003)
 *   This is an INDEX (no tides, waves, wetting/drying, or basin resonance) — it
 *   ranks where surge is worst and gives an order of magnitude only.
 * Surge flooding reuses the connectivity-aware inundation engine (sim-flood.ts)
 * with the sea as the only source and the surge index as the water-level rise.
 */
import { getStore } from "../data/store";
import { districtRing } from "../data/real";
import trackJson from "../data/real/cyclone-tracks.json";
import classicJson from "./sim-cyclone-classics.json";
import { gridDims, latToPx, loadGrid, lonToPx, pixelSizeM, pxToLat, pxToLon, sampleElevations, TILE_SOURCES, type Bbox } from "../live/dem";
import { deflateSync } from "node:zlib";
import { workspaceAssets } from "./portfolio";
import { haversine, rememberSim, runFloodSim, type FloodSimResult } from "./sim-flood";
import { combineDamage, curveForAsset, depthDamage, emanuelDamage, insuredLoss, loanShock, round, windFragilityFor, WIND_SOURCE, DAMAGE_SOURCE, type CreditFns } from "./sim-impact";

const RHO_AIR = 1.15;
const RHO_W = 1025;
const G = 9.81;
const KT = 0.514444;
const OMEGA = 7.292e-5;
export const P_ENV = 1010;

// ─── Track library ────────────────────────────────────────────────────────

export interface TrackPoint {
  /** hours since track start */
  t: number;
  lat: number;
  lon: number;
  /** 1-min sustained surface wind (m/s) */
  vmax: number;
  /** central pressure (hPa) */
  pc: number;
  /** radius of maximum wind (km) */
  rmax: number;
  penv: number;
  /** Holland B */
  b: number;
}

export interface TrackMeta {
  id: string;
  name: string;
  season: number;
  basin: string;
  start: string;
  maxWindKt: number | null;
  minPresHpa: number | null;
  source: "IBTrACS (classic)" | "IBTrACS (last 3 years)";
}

type RawTrack = { id: string; name: string; season: number; basin: string; start: string; maxWindKt: number | null; minPresHpa: number | null; points: (number | null)[][] };

function library(): { meta: TrackMeta; raw: RawTrack; kind: "classic" | "recent" }[] {
  const out: { meta: TrackMeta; raw: RawTrack; kind: "classic" | "recent" }[] = [];
  const seen = new Set<string>();
  for (const t of (classicJson as { tracks: RawTrack[] }).tracks) {
    seen.add(`${t.name.toLowerCase()}-${t.season}`);
    out.push({ meta: { ...pickMeta(t), source: "IBTrACS (classic)" }, raw: t, kind: "classic" });
  }
  for (const t of (trackJson as unknown as { tracks: RawTrack[] }).tracks) {
    if (seen.has(`${t.name.toLowerCase()}-${t.season}`) || t.name === "Unnamed") continue;
    if ((t.maxWindKt ?? 0) < 34) continue; // skip depressions
    out.push({ meta: { ...pickMeta(t), source: "IBTrACS (last 3 years)" }, raw: t, kind: "recent" });
  }
  return out.sort((a, b) => b.meta.start.localeCompare(a.meta.start));
}
const pickMeta = (t: RawTrack) => ({ id: t.id, name: t.name, season: t.season, basin: t.basin, start: t.start, maxWindKt: t.maxWindKt, minPresHpa: t.minPresHpa });

/** Storms whose track passes within `km` of any point (e.g. the workspace's assets). */
export function listTracks(near?: { lat: number; lon: number }[], km = 400): (TrackMeta & { closestKm: number | null })[] {
  return library()
    .map(({ meta, raw }) => {
      let closest: number | null = null;
      if (near?.length) {
        for (const p of raw.points) {
          const lat = p[1] as number;
          const lon = p[2] as number;
          for (const q of near) {
            const d = haversine(lat, lon, q.lat, q.lon);
            if (closest === null || d < closest) closest = d;
          }
        }
      }
      return { ...meta, closestKm: closest === null ? null : Math.round(closest) };
    })
    .filter((t) => !near?.length || (t.closestKm ?? Infinity) <= km)
    .sort((a, b) => (a.closestKm ?? 0) - (b.closestKm ?? 0) || b.start.localeCompare(a.start));
}

// ─── Parameterisation ─────────────────────────────────────────────────────

export const ktFromPc = (pc: number) => 6.7 * Math.pow(Math.max(0, 1010 - pc), 0.644);
export const pcFromKt = (kt: number) => 1010 - Math.pow(Math.max(0, kt) / 6.7, 1 / 0.644);

export function rmaxVickery(dp: number, lat: number): number {
  return Math.max(8, Math.min(150, Math.exp(3.015 - 6.291e-5 * dp * dp + 0.0337 * Math.abs(lat))));
}

export function hollandB(vmax: number | null, dp: number, rmax: number, lat: number): number {
  const b = vmax && vmax > 0 && dp > 0 ? (RHO_AIR * Math.E * (vmax / 0.8) ** 2) / (dp * 100) : 1.881 - 0.00557 * rmax - 0.01295 * Math.abs(lat);
  return Math.max(1, Math.min(2.5, b));
}

export interface RawPoint {
  t: number;
  lat: number;
  lon: number;
  windKt: number | null;
  presHpa: number | null;
  rmwNm?: number | null;
  pociHpa?: number | null;
}

export function parameterise(p: RawPoint): TrackPoint {
  let kt = p.windKt;
  let pc = p.presHpa;
  if ((kt == null || kt <= 0) && pc != null) kt = ktFromPc(pc);
  if (pc == null && kt != null) pc = pcFromKt(kt);
  kt = kt ?? 25;
  pc = pc ?? 1005;
  const penv = p.pociHpa && p.pociHpa > pc ? p.pociHpa + 1 : P_ENV;
  const dp = Math.max(1, penv - pc);
  const rmax = p.rmwNm && p.rmwNm > 0 ? p.rmwNm * 1.852 : rmaxVickery(dp, p.lat);
  const vmax = kt * KT;
  return { t: p.t, lat: p.lat, lon: p.lon, vmax, pc, rmax, penv, b: hollandB(vmax, dp, rmax, p.lat) };
}

export function trackFromLibrary(id: string): { meta: TrackMeta; points: TrackPoint[] } | null {
  const hit = library().find((x) => x.meta.id === id);
  if (!hit) return null;
  const pts = hit.raw.points
    .filter((p) => p[1] != null && p[2] != null)
    .map((p) =>
      hit.kind === "classic"
        ? parameterise({ t: p[0] as number, lat: p[1] as number, lon: p[2] as number, windKt: p[3] as number | null, presHpa: p[4] as number | null, rmwNm: p[5] as number | null, pociHpa: p[6] as number | null })
        : parameterise({ t: p[0] as number, lat: p[1] as number, lon: p[2] as number, windKt: p[3] as number | null, presHpa: p[4] as number | null })
    );
  return { meta: hit.meta, points: pts };
}

/** Lightweight preview of a library track (for drawing before running). */
export function trackPreview(id: string) {
  const tr = trackFromLibrary(id);
  if (!tr) return null;
  return { meta: tr.meta, points: tr.points.map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, windMs: round(p.vmax, 1), pc: Math.round(p.pc) })) };
}

/** Custom track: points in order with wind (kt); time from distance ÷ forward speed. */
export function customTrack(points: { lat: number; lon: number; windKt: number; presHpa?: number | null }[], speedKmh: number): TrackPoint[] {
  let t = 0;
  return points.map((p, i) => {
    if (i > 0) t += haversine(points[i - 1]!.lat, points[i - 1]!.lon, p.lat, p.lon) / Math.max(5, speedKmh);
    return parameterise({ t: round(t, 2), lat: p.lat, lon: p.lon, windKt: p.windKt, presHpa: p.presHpa ?? null });
  });
}

/** Linear interpolation of the parameterised track to `dt`-hour steps (+ forward motion). */
export function interpolate(track: TrackPoint[], dt = 1): (TrackPoint & { vt: number; heading: number })[] {
  const out: (TrackPoint & { vt: number; heading: number })[] = [];
  if (track.length === 1) return [{ ...track[0]!, vt: 0, heading: 0 }];
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i]!;
    const b = track[i + 1]!;
    const span = Math.max(0.01, b.t - a.t);
    const km = haversine(a.lat, a.lon, b.lat, b.lon);
    const vt = (km * 1000) / (span * 3600);
    // heading as math angle (rad, CCW from east) in local metric coordinates
    const heading = Math.atan2(b.lat - a.lat, (b.lon - a.lon) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180));
    const steps = Math.max(1, Math.round(span / dt));
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      const L = (x: number, y: number) => x + (y - x) * f;
      out.push({ t: L(a.t, b.t), lat: L(a.lat, b.lat), lon: L(a.lon, b.lon), vmax: L(a.vmax, b.vmax), pc: L(a.pc, b.pc), rmax: L(a.rmax, b.rmax), penv: L(a.penv, b.penv), b: L(a.b, b.b), vt, heading });
    }
  }
  const last = track[track.length - 1]!;
  out.push({ ...last, vt: out[out.length - 1]?.vt ?? 0, heading: out[out.length - 1]?.heading ?? 0 });
  return out;
}

/** Symmetric Holland surface wind (m/s) at distance r (km). */
export function hollandWind(r: number, p: Pick<TrackPoint, "rmax" | "b" | "pc" | "penv" | "lat">): number {
  const rm = Math.max(0.5, r) * 1000;
  const R = p.rmax * 1000;
  const dp = Math.max(1, p.penv - p.pc) * 100;
  const f = Math.abs(2 * OMEGA * Math.sin((p.lat * Math.PI) / 180));
  const x = Math.pow(R / rm, p.b);
  const vg = Math.sqrt((p.b / RHO_AIR) * x * dp * Math.exp(-x) + ((rm * f) / 2) ** 2) - (rm * f) / 2;
  return 0.8 * vg;
}

/** Full wind (m/s) and direction (unit vector the air moves toward) at a point. */
export function windAt(lat: number, lon: number, s: TrackPoint & { vt: number; heading: number }, vmaxSym = hollandWind(s.rmax, s)): { v: number; ux: number; uy: number; r: number; dpHpa: number } {
  const kx = 111.32 * Math.cos((s.lat * Math.PI) / 180);
  const dx = (lon - s.lon) * kx;
  const dy = (lat - s.lat) * 111.32;
  const r = Math.sqrt(dx * dx + dy * dy);
  const vs = hollandWind(r, s);
  const nh = s.lat >= 0;
  const beta = Math.atan2(dy, dx);
  // right of motion (NH) / left (SH)
  const side = s.heading + (nh ? -Math.PI / 2 : Math.PI / 2);
  const asym = 0.5 * s.vt * Math.cos(beta - side) * (vmaxSym > 0 ? Math.min(1, vs / vmaxSym) : 0);
  const v = Math.max(0, vs + asym);
  // tangential direction (CCW in NH) with 20° inflow toward the centre
  const tang = beta + (nh ? Math.PI / 2 : -Math.PI / 2);
  const inflow = (20 * Math.PI) / 180;
  const dir = tang + (nh ? inflow : -inflow);
  const Rkm = s.rmax;
  const dpHpa = Math.max(0, s.penv - s.pc) * (1 - Math.exp(-Math.pow(Rkm / Math.max(0.5, r), s.b)));
  return { v, ux: Math.cos(dir), uy: Math.sin(dir), r, dpHpa };
}

/** Radius (km) where the symmetric wind first drops below `thr` m/s outside Rmax (0 if never reached). */
export function radiusOf(thr: number, p: TrackPoint): number {
  if (hollandWind(p.rmax, p) < thr) return 0;
  let lo = p.rmax;
  let hi = p.rmax;
  while (hollandWind(hi, p) >= thr && hi < 1500) hi *= 1.5;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (hollandWind(m, p) >= thr) lo = m;
    else hi = m;
  }
  return Math.round(lo);
}

export const cdGarratt = (u: number) => Math.min(2.5e-3, (0.75 + 0.067 * u) * 1e-3);

/** Surge index (m) at a coastal sea cell. */
export function surgeIndex(u: number, cosOnshore: number, dpHpa: number, shelfFactor: number): { total: number; ib: number; setup: number } {
  const ib = (dpHpa * 100) / (RHO_W * G);
  const setup = ((RHO_AIR * cdGarratt(u) * u * u) / (RHO_W * G)) * shelfFactor * Math.max(0, cosOnshore);
  return { total: ib + setup, ib, setup };
}

// ─── Saffir–Simpson ───────────────────────────────────────────────────────

export const SSHS = [
  { cat: "TS", min: 17.5, label: "Tropical storm" },
  { cat: "1", min: 33, label: "Category 1" },
  { cat: "2", min: 43, label: "Category 2" },
  { cat: "3", min: 50, label: "Category 3" },
  { cat: "4", min: 58, label: "Category 4" },
  { cat: "5", min: 70, label: "Category 5" },
];
export function categoryOf(v: number): string {
  let c = "—";
  for (const s of SSHS) if (v >= s.min) c = s.cat;
  return c;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export interface CycloneSimInput {
  trackId?: string;
  custom?: { points: { lat: number; lon: number; windKt: number; presHpa?: number | null }[]; speedKmh: number; name?: string };
  /** intensity multiplier on Δp (what-if: "same track, stronger storm") */
  intensityScale?: number;
  shelfFactor?: number;
  /** centre of the surge-flood focus area (default: automatic) */
  surgeFocus?: { lat: number; lon: number } | null;
  runSurgeFlood?: boolean;
  label?: string;
}

export interface CycloneAssetImpact {
  id: string;
  name: string;
  type: string;
  crop: string | null;
  lat: number;
  lon: number;
  valueUsd: number;
  maxWindMs: number;
  category: string;
  hourOfMax: number;
  windDamage: number;
  surgeM: number;
  surgeDepthM: number;
  surgeDamage: number;
  damage: number;
  lossUsd: number;
  insuredLossUsd: number | null;
  elUpliftUsd: number | null;
  pdBase: number | null;
  pdStressed: number | null;
  households: number | null;
  method: "engine" | "point";
}

export interface CycloneSimResult {
  id: string;
  kind: "cyclone";
  createdAt: string;
  input: CycloneSimInput;
  storm: { name: string; season: number | null; source: string; peakWindMs: number; minPcHpa: number; landfall: { lat: number; lon: number; t: number } | null };
  track: { t: number; lat: number; lon: number; vmax: number; pc: number; rmax: number; b: number; r33: number; r17: number }[];
  footprint: { width: number; height: number; bounds: Bbox; z: number; data: string; maxMs: number };
  surgePoints: [number, number, number][];
  surgeMaxM: number;
  surgeFlood: Pick<FloodSimResult, "id" | "raster" | "grid" | "levels" | "input"> | null;
  areaHa: { ts: number; cat1: number; cat3: number };
  people: { cat1: number; basis: string };
  assets: CycloneAssetImpact[];
  totals: { assetsHit: number; exposureHitUsd: number; lossUsd: number; windLossUsd: number; surgeLossUsd: number; insuredLossUsd: number; elUpliftUsd: number; households: number };
  timings: { computeMs: number; surgeMs: number };
  sources: { label: string; href?: string }[];
  caveats: string[];
}

async function creditFns(): Promise<CreditFns | null> {
  try {
    const m = await import("./credit-risk");
    return { baselinePd: m.baselinePd, climatePd: m.climatePd, sensitivity: m.sensitivity as CreditFns["sensitivity"], lgdFor: m.lgdFor };
  } catch {
    return null;
  }
}

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export async function runCycloneSim(workspaceId: string, input: CycloneSimInput): Promise<CycloneSimResult> {
  const t0 = Date.now();
  let name = input.custom?.name ?? "Custom storm";
  let season: number | null = null;
  let source = "Custom track (user-drawn)";
  let pts: TrackPoint[];
  if (input.trackId) {
    const tr = trackFromLibrary(input.trackId);
    if (!tr) throw new Error("Unknown storm track");
    pts = tr.points;
    name = tr.meta.name;
    season = tr.meta.season;
    source = `NOAA IBTrACS v04r01 (${tr.meta.id})`;
  } else if (input.custom && input.custom.points.length >= 2) {
    pts = customTrack(input.custom.points, input.custom.speedKmh);
  } else throw new Error("Choose a historical storm or draw at least two track points");

  const scale = Math.max(0.5, Math.min(1.6, input.intensityScale ?? 1));
  if (scale !== 1)
    pts = pts.map((p) => {
      const dp = (p.penv - p.pc) * scale;
      const pc = p.penv - dp;
      const vmax = p.vmax * Math.sqrt(scale); // Vmax ∝ √Δp (Holland 1980)
      return { ...p, pc, vmax, b: hollandB(vmax, dp, p.rmax, p.lat) };
    });
  const steps = interpolate(pts, 1);

  // ── analysis window: assets (± 3°) ∩ track (± 4°), capped ──
  const assets = workspaceAssets(workspaceId);
  const tb = { west: Math.min(...pts.map((p) => p.lon)) - 4, east: Math.max(...pts.map((p) => p.lon)) + 4, south: Math.min(...pts.map((p) => p.lat)) - 4, north: Math.max(...pts.map((p) => p.lat)) + 4 };
  let win: Bbox = tb;
  const near = assets.filter((a) => a.lat >= tb.south && a.lat <= tb.north && a.lon >= tb.west && a.lon <= tb.east);
  if (near.length) {
    const ab = { west: Math.min(...near.map((a) => a.lon)) - 3, east: Math.max(...near.map((a) => a.lon)) + 3, south: Math.min(...near.map((a) => a.lat)) - 3, north: Math.max(...near.map((a) => a.lat)) + 3 };
    win = { west: Math.max(tb.west, ab.west), east: Math.min(tb.east, ab.east), south: Math.max(tb.south, ab.south), north: Math.min(tb.north, ab.north) };
  }
  // cap to 24° × 24° around the track's most intense segment
  const peak = pts.reduce((a, b) => (b.vmax > a.vmax ? b : a));
  if (win.east - win.west > 24) ((win.west = Math.max(win.west, peak.lon - 12)), (win.east = Math.min(win.east, peak.lon + 12)));
  if (win.north - win.south > 24) ((win.south = Math.max(win.south, peak.lat - 12)), (win.north = Math.min(win.north, peak.lat + 12)));
  win.south = Math.max(-70, win.south);
  win.north = Math.min(70, win.north);

  let z = 8;
  while (z > 3) {
    const d = gridDims(win, z);
    if (d.width * d.height <= 320_000) break;
    z--;
  }
  const dem = await loadGrid(win, z, { withWater: false }).catch(() => null);
  const dims = dem ?? { ...gridDims(win, z), bounds: win, px0: gridDims(win, z).px0, py0: gridDims(win, z).py0 };
  const W = dims.width;
  const H = dims.height;
  const px0 = dims.px0;
  const py0 = dims.py0;
  const lat = new Float32Array(H);
  for (let y = 0; y < H; y++) lat[y] = pxToLat(py0 + y + 0.5, z);
  const lon = new Float32Array(W);
  for (let x = 0; x < W; x++) lon[x] = pxToLon(px0 + x + 0.5, z);
  const land = new Uint8Array(W * H);
  if (dem) for (let i = 0; i < W * H; i++) land[i] = dem.elev[i]! > 0 ? 1 : 0;

  // coastal sea cells + onshore normal (gradient of a 5×5 land fraction)
  const coast: { i: number; nx: number; ny: number }[] = [];
  if (dem) {
    for (let y = 2; y < H - 2; y++)
      for (let x = 2; x < W - 2; x++) {
        const i = y * W + x;
        if (land[i]) continue;
        if (!(land[i - 1] || land[i + 1] || land[i - W] || land[i + W])) continue;
        let gx = 0;
        let gy = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (land[(y + dy) * W + x + dx]) ((gx += dx), (gy -= dy)); // +y = north
        const m = Math.hypot(gx, gy);
        if (m > 0) coast.push({ i, nx: gx / m, ny: gy / m });
      }
  }

  const maxW = new Float32Array(W * H);
  const tMax = new Uint16Array(W * H);
  const surge = new Float32Array(coast.length);
  const shelf = Math.max(500, Math.min(10000, input.shelfFactor ?? 4000));
  const cellKm = pixelSizeM((win.north + win.south) / 2, z) / 1000;
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k]!;
    const reach = Math.min(900, Math.max(150, radiusOf(15, s) * 1.3));
    const vSym = hollandWind(s.rmax, s);
    const cx = lonToPx(s.lon, z) - px0;
    const cy = latToPx(s.lat, z) - py0;
    const rc = Math.ceil(reach / cellKm);
    const x0 = Math.max(0, Math.floor(cx - rc));
    const x1 = Math.min(W - 1, Math.ceil(cx + rc));
    const y0 = Math.max(0, Math.floor(cy - rc));
    const y1 = Math.min(H - 1, Math.ceil(cy + rc));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const v = windAt(lat[y]!, lon[x]!, s, vSym).v;
        if (v > maxW[i]!) {
          maxW[i] = v;
          tMax[i] = Math.round(s.t);
        }
      }
    for (let c = 0; c < coast.length; c++) {
      const cc = coast[c]!;
      const x = cc.i % W;
      const y = (cc.i - x) / W;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const wv = windAt(lat[y]!, lon[x]!, s, vSym);
      const cos = wv.ux * cc.nx + wv.uy * cc.ny;
      const e = surgeIndex(wv.v, cos, wv.dpHpa, shelf).total;
      if (e > surge[c]!) surge[c] = e;
    }
  }

  // ── landfall: first step over land ──
  let landfall: CycloneSimResult["storm"]["landfall"] = null;
  if (dem)
    for (const s of steps) {
      const x = Math.floor(lonToPx(s.lon, z) - px0);
      const y = Math.floor(latToPx(s.lat, z) - py0);
      if (x >= 0 && y >= 0 && x < W && y < H && land[y * W + x]) {
        landfall = { lat: round(s.lat, 2), lon: round(s.lon, 2), t: Math.round(s.t) };
        break;
      }
    }

  // ── area & people ──
  let ts = 0;
  let c1 = 0;
  let c3 = 0;
  for (let y = 0; y < H; y++) {
    const a = (pixelSizeM(lat[y]!, z) ** 2) / 10_000;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (dem && !land[i]) continue;
      const v = maxW[i]!;
      if (v >= 17.5) ts += a;
      if (v >= 33) c1 += a;
      if (v >= 50) c3 += a;
    }
  }
  let people = 0;
  const hitDistricts: string[] = [];
  for (const d of getStore().districts) {
    const ring = districtRing(d.id);
    if (!ring) continue;
    let tot = 0;
    let hit = 0;
    const xs = ring.map((p) => p[0]!);
    const ys = ring.map((p) => p[1]!);
    const gx0 = Math.max(0, Math.floor(lonToPx(Math.min(...xs), z) - px0));
    const gx1 = Math.min(W - 1, Math.ceil(lonToPx(Math.max(...xs), z) - px0));
    const gy0 = Math.max(0, Math.floor(latToPx(Math.max(...ys), z) - py0));
    const gy1 = Math.min(H - 1, Math.ceil(latToPx(Math.min(...ys), z) - py0));
    for (let y = gy0; y <= gy1; y++)
      for (let x = gx0; x <= gx1; x++)
        if (pointInRing(lon[x]!, lat[y]!, ring)) {
          tot++;
          if (maxW[y * W + x]! >= 33) hit++;
        }
    if (tot && hit) {
      people += (d.population * hit) / tot;
      hitDistricts.push(d.name);
    }
  }

  // ── surge points for the map (downsample to ≤ 1500) ──
  const surgePts: [number, number, number][] = [];
  const stepC = Math.max(1, Math.ceil(coast.length / 1500));
  let surgeMax = 0;
  for (let c = 0; c < coast.length; c++) {
    if (surge[c]! > surgeMax) surgeMax = surge[c]!;
    if (c % stepC || surge[c]! < 0.2) continue;
    const x = coast[c]!.i % W;
    const y = (coast[c]!.i - x) / W;
    surgePts.push([round(lat[y]!, 3), round(lon[x]!, 3), round(surge[c]!, 2)]);
  }
  const surgeNear = (la: number, lo: number, maxKm = 40): { eta: number; km: number } => {
    let best = { eta: 0, km: Infinity };
    for (let c = 0; c < coast.length; c++) {
      if (surge[c]! < 0.1) continue;
      const x = coast[c]!.i % W;
      const y = (coast[c]!.i - x) / W;
      const km = haversine(la, lo, lat[y]!, lon[x]!);
      if (km <= maxKm && surge[c]! - 0.1 * km > best.eta - 0.1 * best.km) best = { eta: surge[c]!, km };
    }
    return best.km === Infinity ? { eta: 0, km: Infinity } : best;
  };

  // ── surge-flood focus area (reuse the inundation engine) ──
  const t1 = Date.now();
  let surgeFlood: CycloneSimResult["surgeFlood"] = null;
  let focusRes: FloodSimResult | null = null;
  const inWin = assets.filter((a) => a.lat >= win.south && a.lat <= win.north && a.lon >= win.west && a.lon <= win.east);
  if (input.runSurgeFlood !== false && surgeMax >= 0.3) {
    let focus = input.surgeFocus ?? null;
    if (!focus) {
      // coastal cell maximising surge × (1 + assets within 30 km)
      let best = -1;
      for (let c = 0; c < coast.length; c += Math.max(1, Math.floor(coast.length / 600))) {
        const x = coast[c]!.i % W;
        const y = (coast[c]!.i - x) / W;
        const n = inWin.filter((a) => haversine(a.lat, a.lon, lat[y]!, lon[x]!) <= 30).length;
        const score = surge[c]! ** 2 * (1 + Math.sqrt(n));
        if (score > best) ((best = score), (focus = { lat: lat[y]!, lon: lon[x]! }));
      }
    }
    if (focus) {
      const eta = surgeNear(focus.lat, focus.lon, 30).eta || surgeMax;
      const rise = Math.min(8, Math.max(0.3, round(eta, 1)));
      try {
        focusRes = await runFloodSim(workspaceId, { center: focus, sizeKm: 40, zoom: "auto", sources: "sea", reference: "source", maxRiseM: Math.min(8, Math.ceil(rise + 0.5)), riseM: rise, label: `${name} surge` });
        surgeFlood = { id: focusRes.id, raster: focusRes.raster, grid: focusRes.grid, levels: focusRes.levels, input: focusRes.input };
      } catch {
        surgeFlood = null; // DEM tiles unavailable — point method only
      }
    }
  }
  const surgeMs = Date.now() - t1;

  // ── portfolio impacts ──
  const credit = inWin.some((a) => a.type === "loan") ? await creditFns() : null;
  const elevs = await sampleElevations(inWin.map((a) => ({ lat: a.lat, lon: a.lon })), 11).catch(() => inWin.map(() => null));
  const focusRiseIdx = focusRes ? Math.round((focusRes.input.riseM ?? 0) / 0.1) : -1;
  const out: CycloneAssetImpact[] = inWin.map((a, k) => {
    const x = Math.floor(lonToPx(a.lon, z) - px0);
    const y = Math.floor(latToPx(a.lat, z) - py0);
    const i = Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x));
    const v = maxW[i]!;
    const frag = windFragilityFor(a.type, a.crop);
    const wd = emanuelDamage(v, frag);
    // surge: engine result if the asset is inside the focus area, else point estimate with inland attenuation
    let surgeM = 0;
    let depth = 0;
    let method: "engine" | "point" = "point";
    const fa = focusRes?.assets.find((q) => q.id === a.id);
    if (fa && focusRiseIdx >= 0) {
      method = "engine";
      surgeM = focusRes!.input.riseM;
      depth = fa.depthM[Math.min(fa.depthM.length - 1, focusRiseIdx)] ?? 0;
    } else {
      const sn = surgeNear(a.lat, a.lon, 40);
      surgeM = sn.eta;
      const zA = elevs[k];
      if (sn.eta > 0 && zA != null) depth = Math.max(0, sn.eta - 0.1 * sn.km - Math.max(0, zA)); // 10 cm/km inland attenuation (Krauss et al. 2009)
    }
    const sd = depthDamage(curveForAsset(a.type), depth);
    const dmg = combineDamage(wd, sd);
    const loss = a.valueUsd * dmg;
    const shock = a.type === "loan" && credit ? loanShock(a, "flood", dmg, credit) : null;
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      crop: a.crop,
      lat: a.lat,
      lon: a.lon,
      valueUsd: a.valueUsd,
      maxWindMs: round(v, 1),
      category: categoryOf(v),
      hourOfMax: tMax[i]!,
      windDamage: round(wd, 3),
      surgeM: round(surgeM, 2),
      surgeDepthM: round(depth, 2),
      surgeDamage: round(sd, 3),
      damage: round(dmg, 3),
      lossUsd: Math.round(loss),
      insuredLossUsd: a.type === "insured_plot" ? Math.round(insuredLoss(a.valueUsd, dmg, Number(a.meta.deductiblePct ?? 0))) : null,
      elUpliftUsd: shock ? shock.elUpliftUsd : null,
      pdBase: shock ? shock.pdBase : null,
      pdStressed: shock ? shock.pdStressed : null,
      households: a.type === "community" ? Number(a.meta.households ?? 0) || null : null,
      method,
    };
  });

  const totals = out.reduce(
    (s, a) => {
      if (a.maxWindMs >= 17.5 || a.surgeDepthM > 0) {
        s.assetsHit++;
        s.exposureHitUsd += a.valueUsd;
        if (a.households) s.households += a.households;
      }
      s.lossUsd += a.lossUsd;
      s.windLossUsd += Math.round(a.valueUsd * a.windDamage);
      s.surgeLossUsd += Math.round(a.valueUsd * a.surgeDamage);
      s.insuredLossUsd += a.insuredLossUsd ?? 0;
      s.elUpliftUsd += a.elUpliftUsd ?? 0;
      return s;
    },
    { assetsHit: 0, exposureHitUsd: 0, lossUsd: 0, windLossUsd: 0, surgeLossUsd: 0, insuredLossUsd: 0, elUpliftUsd: 0, households: 0 }
  );

  // ── encode footprint: wind m/s Uint8[n] · land Uint8[n] · hour of max Uint16[n] ──
  const n2 = W * H;
  const ab = new ArrayBuffer(n2 * 4);
  const buf = new Uint8Array(ab, 0, n2 * 2);
  const hrs = new Uint16Array(ab, n2 * 2, n2);
  let fmax = 0;
  for (let i = 0; i < n2; i++) {
    buf[i] = Math.min(255, Math.round(maxW[i]!));
    buf[n2 + i] = land[i]!;
    hrs[i] = tMax[i]!;
    if (maxW[i]! > fmax) fmax = maxW[i]!;
  }
  const bounds: Bbox = { west: pxToLon(px0, z), east: pxToLon(px0 + W, z), north: pxToLat(py0, z), south: pxToLat(py0 + H, z) };

  const res: CycloneSimResult = {
    id: `sim-tc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind: "cyclone",
    createdAt: new Date().toISOString(),
    input,
    storm: { name, season, source, peakWindMs: round(Math.max(...pts.map((p) => p.vmax)), 1), minPcHpa: Math.round(Math.min(...pts.map((p) => p.pc))), landfall },
    track: steps
      .filter((_, k) => k % 3 === 0 || k === steps.length - 1)
      .map((s) => ({ t: round(s.t, 1), lat: round(s.lat, 3), lon: round(s.lon, 3), vmax: round(s.vmax, 1), pc: Math.round(s.pc), rmax: Math.round(s.rmax), b: round(s.b, 2), r33: radiusOf(33, s), r17: radiusOf(17.5, s) })),
    footprint: { width: W, height: H, bounds, z, data: deflateSync(Buffer.from(ab)).toString("base64"), maxMs: round(fmax, 1) },
    surgePoints: surgePts,
    surgeMaxM: round(surgeMax, 2),
    surgeFlood,
    areaHa: { ts: Math.round(ts), cat1: Math.round(c1), cat3: Math.round(c3) },
    people: { cat1: Math.round(people), basis: hitDistricts.length ? `Census population of ${hitDistricts.join(", ")} × share of each district's area inside ≥ 33 m/s winds (seeded districts only)` : "No seeded census district inside ≥ 33 m/s winds" },
    assets: out.sort((a, b) => b.lossUsd - a.lossUsd),
    totals,
    timings: { computeMs: Date.now() - t0, surgeMs },
    sources: [
      { label: source, href: "https://www.ncei.noaa.gov/products/international-best-track-archive" },
      { label: "Holland (1980) wind profile · Vickery & Wadhera (2008) Rmax/B" },
      { label: WIND_SOURCE },
      { label: DAMAGE_SOURCE },
      { label: TILE_SOURCES.terrarium.label, href: TILE_SOURCES.terrarium.href },
    ],
    caveats: CYCLONE_CAVEATS,
  };
  rememberSim(res.id, res);
  return res;
}

export const CYCLONE_CAVEATS = [
  "Parametric wind field: a smooth, symmetric-plus-motion vortex. Real storms have rain bands, eyewall replacement and terrain effects that can move peak winds by tens of km.",
  "Best-track intensity is the agency estimate (1-min where the US JTWC value exists, otherwise 3/10-min regional values), so peak winds can differ by ±10-15 %.",
  "Surge is an index (inverse barometer + steady wind set-up with a shelf factor): no astronomical tide, waves or funnelling in estuaries. Observed surges can be 50 % higher or lower — use it to rank exposure, not as a water-level forecast.",
  "Crop wind fragilities are screening assumptions (Emanuel-type curves); building fragilities follow CLIMADA defaults and are not calibrated to local construction.",
  "Loss is to the exposure value on record (sum insured, loan balance, stock value); business interruption and rainfall flooding are not included.",
];
