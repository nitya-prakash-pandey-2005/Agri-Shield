/**
 * Simulation Lab — flood inundation ("what if the water rises by h metres?").
 *
 * Model: connectivity-aware bathtub on a real DEM
 * ────────────────────────────────────────────────
 *  1. Mosaic the Terrarium DEM (SRTM on land) + JRC surface-water occurrence for
 *     the area at zoom 11-13 (≈ 70 / 35 / 18 m pixels) — see server/live/dem.ts.
 *  2. Water sources
 *       sea   = connected cells ≤ 0 m that touch the area edge (≥ 200 px or real bathymetry)
 *       river = JRC occurrence ≥ 50 % (water in at least half of 1984-2021 observations),
 *               8-connected components that touch the area edge, the sea, or are large
 *               (≥ 3 km²) — isolated ponds / aquaculture ghers are NOT treated as sources.
 *     Reference water surface of each source ("base"):
 *       mode "source":  sea = 0 m (mean sea level); river = today's bank-full level =
 *                       min(lowest river cell, lowest dry land) in a 7×7 window — robust to
 *                       SRTM noise, and never above land that is dry today (HAND-style)
 *       mode "lowpct":  one uniform level = the p-th percentile of land elevation
 *  3. Priority-flood (Barnes et al. 2014) outward from every source with a Dial
 *     bucket queue (1 cm buckets). For every land cell it yields
 *       rise(p) = min over 4-connected paths from a source of max(z along path) − base
 *     i.e. the water-level rise at which the cell first connects to the water, and
 *       d0(p)   = −HAND = min(0, base − z(p)), so depth at rise h is h + d0(p) when
 *     rise(p) < h. Cells below the local reference (DEM pits, polders that are dry
 *     today) are treated as sitting at the reference — depth never exceeds the rise
 *     there (HAND convention, Nobre et al. 2011), avoiding metre-deep "floods" at +0.1 m.
 *     One pass therefore answers every rise 0…h_max — the client animates locally.
 *     4-connectivity is deliberately conservative: water can't leak through a
 *     one-pixel diagonal gap in a levee.
 *  4. Optional rainfall-excess ponding: priority-flood from the area edge + all
 *     sources gives the depression-filled surface; every closed depression is
 *     filled (level-pool) with R·C·A_dep of water (R = rain excess, C = catchment
 *     ratio, default 3) up to its spill level.
 *  5. Impacts per 0.1 m step: flooded ha, depth bands, assets hit (hazard averaged
 *     over each asset's footprint), loss via JRC depth-damage curves, households.
 *
 * Caveats: SRTM (2000) is a surface model — vegetation/buildings bias it high by
 * 1-3 m; embankments/polder dykes narrower than a pixel are invisible (bathtub
 * over-estimates behind dykes); land subsidence since 2000 (e.g. Demak, up to
 * ~10 cm/yr) is not included; no flow dynamics, duration or velocity.
 */
import { deflateSync } from "node:zlib";
import { getStore } from "../data/store";
import { districtBoundaryMeta, floodEvents, floodThresholds } from "../data/real";
import { gridDims, latToPx, loadGrid, lonToPx, pxToLat, TILE_SOURCES, type Bbox, type DemGrid } from "../live/dem";
import { workspaceAssets } from "./portfolio";
import { curveForAsset, DAMAGE_SOURCE, depthDamage, footprintRadiusM, insuredLoss, loanShock, round, type CreditFns } from "./sim-impact";

// ─── Core raster algorithms (pure, typed arrays) ──────────────────────────

export const CLS_LAND = 0;
export const CLS_SEA = 1;
export const CLS_RIVER = 2;
/** permanent water that is NOT a source (isolated ponds, aquaculture) */
export const CLS_POND = 3;

export interface SourceOptions {
  sea: boolean;
  rivers: boolean;
  occThreshold?: number;
}

/** Classify cells into land / sea / river-source / isolated water. */
export function classifyWater(elev: Float32Array, occ: Uint8Array | null, w: number, h: number, opts: SourceOptions): Uint8Array {
  const n = w * h;
  const cls = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const thr = opts.occThreshold ?? 50;
  const members = new Int32Array(n);

  // sea: ≤ 0 m components touching the edge
  for (let s = 0; s < n; s++) {
    if (seen[s] || !(elev[s]! <= 0)) continue;
    let sp = 0;
    let cnt = 0;
    let edge = false;
    let minZ = Infinity;
    let occSum = 0;
    stack[sp++] = s;
    seen[s] = 1;
    while (sp) {
      const i = stack[--sp]!;
      members[cnt++] = i;
      const z = elev[i]!;
      if (z < minZ) minZ = z;
      if (occ) occSum += occ[i]!;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      if (x > 0 && !seen[i - 1] && elev[i - 1]! <= 0) ((seen[i - 1] = 1), (stack[sp++] = i - 1));
      if (x < w - 1 && !seen[i + 1] && elev[i + 1]! <= 0) ((seen[i + 1] = 1), (stack[sp++] = i + 1));
      if (y > 0 && !seen[i - w] && elev[i - w]! <= 0) ((seen[i - w] = 1), (stack[sp++] = i - w));
      if (y < h - 1 && !seen[i + w] && elev[i + w]! <= 0) ((seen[i + w] = 1), (stack[sp++] = i + w));
    }
    const isSea = (edge && (cnt >= 200 || minZ < -1)) || (cnt >= 200 && occ !== null && occSum / cnt >= 60);
    if (isSea && opts.sea) for (let k = 0; k < cnt; k++) cls[members[k]!] = CLS_SEA;
    else if (isSea) for (let k = 0; k < cnt; k++) cls[members[k]!] = CLS_POND; // sea shown as water but not a source
  }

  if (!occ) return cls;
  // river / lake: occurrence ≥ thr, 8-connected components
  seen.fill(0);
  const bigPx = Math.max(400, Math.round(n * 0.0015));
  for (let s = 0; s < n; s++) {
    if (seen[s] || cls[s] || occ[s]! < thr) continue;
    let sp = 0;
    let cnt = 0;
    let edge = false;
    let touchesSea = false;
    stack[sp++] = s;
    seen[s] = 1;
    while (sp) {
      const i = stack[--sp]!;
      members[cnt++] = i;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (cls[j] === CLS_SEA) touchesSea = true;
          if (!seen[j] && !cls[j] && occ[j]! >= thr) {
            seen[j] = 1;
            stack[sp++] = j;
          }
        }
      }
    }
    const source = opts.rivers && cnt >= 30 && (edge || touchesSea || cnt >= bigPx);
    const c = source ? CLS_RIVER : CLS_POND;
    for (let k = 0; k < cnt; k++) cls[members[k]!] = c;
  }
  return cls;
}

/** Base water-surface level per source cell. */
export function sourceBase(elev: Float32Array, cls: Uint8Array, w: number, h: number, mode: "source" | "lowpct", uniform: number): Float32Array {
  const n = w * h;
  const base = new Float32Array(n);
  if (mode === "lowpct") {
    for (let i = 0; i < n; i++) if (cls[i] === CLS_SEA || cls[i] === CLS_RIVER) base[i] = uniform;
    return base;
  }
  // Robust local water surface for river cells:
  //   min( lowest river-cell elevation in a 7×7 window , lowest land elevation in the same window )
  // SRTM over narrow channels is noisy and biased high by bank vegetation, and the
  // normal water level cannot sit above the adjacent land that is dry today — so
  // "rise" is measured from today's bank-full level (HAND-style reference).
  const isRiver = new Uint8Array(n);
  const isLand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    isRiver[i] = cls[i] === CLS_RIVER ? 1 : 0;
    isLand[i] = cls[i] === CLS_LAND ? 1 : 0;
  }
  const riverMin = windowMin(elev, w, h, 3, isRiver);
  const landMin = windowMin(elev, w, h, 3, isLand);
  for (let i = 0; i < n; i++) {
    if (cls[i] === CLS_SEA) base[i] = 0;
    else if (cls[i] === CLS_RIVER) {
      const m = Math.min(riverMin[i]!, landMin[i]!);
      base[i] = Math.max(0, m < 1e9 ? m : elev[i]!);
    }
  }
  return base;
}

/** Separable (2R+1)² minimum filter over the cells selected by `use` (1e9 where none). */
export function windowMin(v: Float32Array, w: number, h: number, R: number, mask: Uint8Array): Float32Array {
  const n = w * h;
  const BIG = 1e9;
  const tmp = new Float32Array(n);
  const out = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = BIG;
      for (let xx = Math.max(0, x - R), x1 = Math.min(w - 1, x + R); xx <= x1; xx++) {
        const j = y * w + xx;
        if (mask[j] && v[j]! < m) m = v[j]!;
      }
      tmp[y * w + x] = m;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = BIG;
      for (let yy = Math.max(0, y - R), y1 = Math.min(h - 1, y + R); yy <= y1; yy++) {
        const t = tmp[yy * w + x]!;
        if (t < m) m = t;
      }
      out[y * w + x] = m;
    }
  return out;
}

export interface FloodField {
  /** rise (m) at which the cell floods; +Infinity = not within maxRise */
  rise: Float32Array;
  /** min(0, base − z) = −HAND (m): depth at rise h is h + d0 */
  d0: Float32Array;
}

/**
 * Priority-flood from the source cells with a Dial bucket queue (1 cm).
 * Each cell is queued at most once → O(N). Keys are monotone (max-plus), so
 * processing buckets in order yields the minimax rise for single-base sources
 * and a greedy approximation when sources have different bases.
 */
export function floodField(elev: Float32Array, cls: Uint8Array, base: Float32Array, w: number, h: number, maxRise: number): FloodField {
  const n = w * h;
  const rise = new Float32Array(n).fill(Infinity);
  const d0 = new Float32Array(n);
  const b = new Float32Array(n); // propagated base
  const B = Math.ceil(maxRise * 100) + 2;
  const head = new Int32Array(B).fill(-1);
  const next = new Int32Array(n);
  const visited = new Uint8Array(n);
  const push = (i: number, key: number) => {
    const k = Math.min(B - 1, Math.ceil(key * 100 - 1e-6));
    next[i] = head[k]!;
    head[k] = i;
  };
  for (let i = 0; i < n; i++) {
    const c = cls[i];
    if (c !== CLS_SEA && c !== CLS_RIVER) continue;
    const key = Math.max(0, elev[i]! - base[i]!);
    visited[i] = 1;
    b[i] = base[i]!;
    rise[i] = key;
    d0[i] = Math.min(0, base[i]! - elev[i]!);
    if (key <= maxRise) push(i, key);
  }
  const tryCell = (j: number, from: number) => {
    if (visited[j]) return;
    const kj = Math.max(rise[from]!, elev[j]! - b[from]!);
    if (kj > maxRise) return; // leave unvisited: another source (other base) may still reach it
    visited[j] = 1;
    rise[j] = kj;
    b[j] = b[from]!;
    d0[j] = Math.min(0, b[from]! - elev[j]!); // depth = h − HAND, HAND = max(0, z − base)
    push(j, kj);
  };
  for (let k = 0; k < B; k++) {
    while (head[k]! !== -1) {
      const i = head[k]!;
      head[k] = next[i]!;
      const x = i % w;
      if (x > 0) tryCell(i - 1, i);
      if (x < w - 1) tryCell(i + 1, i);
      if (i >= w) tryCell(i - w, i);
      if (i < n - w) tryCell(i + w, i);
    }
  }
  return { rise, d0 };
}

/** Typed-array binary min-heap (float keys). */
class MinHeap {
  keys: Float32Array;
  vals: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float32Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(k: number, v: number) {
    let i = this.size++;
    const K = this.keys;
    const V = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p]! <= k) break;
      K[i] = K[p]!;
      V[i] = V[p]!;
      i = p;
    }
    K[i] = k;
    V[i] = v;
  }
  pop(): number {
    const K = this.keys;
    const V = this.vals;
    const top = V[0]!;
    const n = --this.size;
    if (n > 0) {
      const k = K[n]!;
      const v = V[n]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1]! < K[c]!) c++;
        if (K[c]! >= k) break;
        K[i] = K[c]!;
        V[i] = V[c]!;
        i = c;
      }
      K[i] = k;
      V[i] = v;
    }
    return top;
  }
  get topKey() {
    return this.keys[0]!;
  }
}

/** Depression-filled surface (Priority-Flood, Barnes et al. 2014) seeded at the area edge and all water cells. */
export function fillDepressions(elev: Float32Array, cls: Uint8Array, w: number, h: number): Float32Array {
  const n = w * h;
  const filled = new Float32Array(n);
  const closed = new Uint8Array(n);
  const heap = new MinHeap(n);
  for (let i = 0; i < n; i++) {
    const x = i % w;
    const y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || cls[i] === CLS_SEA || cls[i] === CLS_RIVER) {
      closed[i] = 1;
      filled[i] = elev[i]!;
      heap.push(elev[i]!, i);
    }
  }
  while (heap.size) {
    const i = heap.pop();
    const zi = filled[i]!;
    const x = i % w;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const j of nb) {
      if (j < 0 || j >= n || closed[j]) continue;
      closed[j] = 1;
      const fj = Math.max(zi, elev[j]!);
      filled[j] = fj;
      heap.push(fj, j);
    }
  }
  return filled;
}

/**
 * Level-pool ponding of rainfall excess in closed depressions.
 * Each depression (4-connected cells with filled − z > 1 cm) receives
 * V = R · C · A_dep and fills from its lowest cell up to at most its spill level.
 */
export function pondDepth(elev: Float32Array, filled: Float32Array, w: number, h: number, rowArea: Float32Array, rainExcessM: number, catchmentRatio: number): Float32Array {
  const n = w * h;
  const depth = new Float32Array(n);
  if (!(rainExcessM > 0)) return depth;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const members = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s] || filled[s]! - elev[s]! <= 0.01) continue;
    let sp = 0;
    let cnt = 0;
    stack[sp++] = s;
    seen[s] = 1;
    let area = 0;
    let spill = -Infinity;
    while (sp) {
      const i = stack[--sp]!;
      members[cnt++] = i;
      const x = i % w;
      const y = (i - x) / w;
      area += rowArea[y]!;
      if (filled[i]! > spill) spill = filled[i]!;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0 || seen[j] || filled[j]! - elev[j]! <= 0.01) continue;
        seen[j] = 1;
        stack[sp++] = j;
      }
    }
    const V = rainExcessM * catchmentRatio * area;
    const cells = Array.from(members.subarray(0, cnt)).sort((a, b) => elev[a]! - elev[b]!);
    // raise level L until stored volume Σ (L − z)·a = V
    let vol = 0;
    let aSum = 0;
    let L = elev[cells[0]!]!;
    let k = 0;
    for (; k < cells.length; k++) {
      const c = cells[k]!;
      const z = elev[c]!;
      const a = rowArea[Math.floor(c / w)]!;
      const need = vol + aSum * (z - L);
      if (need >= V) break;
      vol = need;
      L = z;
      aSum += a;
    }
    let level = aSum > 0 ? L + (V - vol) / aSum : L;
    if (level > spill) level = spill;
    for (let q = 0; q < cnt; q++) {
      const c = members[q]!;
      const d = level - elev[c]!;
      if (d > 0) depth[c] = d;
    }
  }
  return depth;
}

export function percentile(values: Float32Array, mask: Uint8Array | null, p: number): number {
  const arr: number[] = [];
  const step = Math.max(1, Math.floor(values.length / 200_000));
  for (let i = 0; i < values.length; i += step) if (!mask || mask[i] === CLS_LAND) arr.push(values[i]!);
  if (!arr.length) return 0;
  arr.sort((a, b) => a - b);
  return arr[Math.min(arr.length - 1, Math.max(0, Math.floor((p / 100) * (arr.length - 1))))]!;
}

// ─── Level statistics ─────────────────────────────────────────────────────

export interface LevelStat {
  riseM: number;
  floodedHa: number;
  meanDepthM: number;
  /** ha in depth bands < 0.5, 0.5–1, 1–2, ≥ 2 m */
  bandsHa: [number, number, number, number];
}

/**
 * Flooded area, mean depth and depth bands for every level h_k = k·step in one
 * O(N) pass: each cell contributes to a contiguous range of level indices, so
 * difference arrays replace a per-level scan. Cells with rainfall ponding are
 * few and handled explicitly (depth = max(pond, bathtub depth)).
 */
export function levelStats(field: FloodField, cls: Uint8Array, pond: Float32Array | null, w: number, h: number, rowArea: Float32Array, levels: number[]): LevelStat[] {
  const n = w * h;
  const L = levels.length;
  const step = L > 1 ? levels[1]! - levels[0]! : 0.1;
  const dA = new Float64Array(L + 1);
  const dD0 = new Float64Array(L + 1);
  const dB = [new Float64Array(L + 1), new Float64Array(L + 1), new Float64Array(L + 1), new Float64Array(L + 1)];
  const MIN = 0.02;
  const TH = [0.5, 1, 2];
  const pondCells: number[] = [];
  const add = (arr: Float64Array, k0: number, k1: number, v: number) => {
    if (k1 <= k0) return;
    arr[k0]! += v;
    arr[Math.min(L, k1)]! -= v;
  };
  for (let y = 0; y < h; y++) {
    const a = rowArea[y]!;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = cls[i];
      if (c === CLS_SEA || c === CLS_RIVER) continue;
      if (pond && pond[i]! > MIN) {
        pondCells.push(i);
        continue;
      }
      const r = field.rise[i]!;
      if (r === Infinity) continue;
      const d0 = field.d0[i]!;
      const start = Math.max(0, Math.floor(r / step + 1e-9) + 1, Math.floor((MIN - d0) / step + 1e-9) + 1);
      if (start >= L) continue;
      add(dA, start, L, a);
      add(dD0, start, L, a * d0);
      const kT = TH.map((t) => Math.max(start, Math.ceil((t - d0) / step - 1e-9)));
      add(dB[0]!, start, kT[0]!, a);
      add(dB[1]!, kT[0]!, kT[1]!, a);
      add(dB[2]!, kT[1]!, kT[2]!, a);
      add(dB[3]!, kT[2]!, L, a);
    }
  }
  const out: LevelStat[] = [];
  let A = 0;
  let D0 = 0;
  const B = [0, 0, 0, 0];
  for (let k = 0; k < L; k++) {
    A += dA[k]!;
    D0 += dD0[k]!;
    for (let q = 0; q < 4; q++) B[q]! += dB[q]![k]!;
    const hLev = levels[k]!;
    let area = A;
    let dsum = hLev * A + D0;
    const bands = [...B];
    for (const i of pondCells) {
      const r = field.rise[i]!;
      let d = r < hLev ? hLev + field.d0[i]! : 0;
      if (pond![i]! > d) d = pond![i]!;
      const a = rowArea[Math.floor(i / w)]!;
      area += a;
      dsum += a * d;
      bands[d < 0.5 ? 0 : d < 1 ? 1 : d < 2 ? 2 : 3]! += a;
    }
    out.push({
      riseM: round(hLev, 2),
      floodedHa: Math.round(area / 10_000),
      meanDepthM: area > 0 ? round(dsum / area, 2) : 0,
      bandsHa: bands.map((v) => Math.max(0, Math.round(v / 10_000))) as [number, number, number, number],
    });
  }
  return out;
}

// ─── Display encoding ─────────────────────────────────────────────────────

export interface EncodedRaster {
  width: number;
  height: number;
  /** every display pixel = `factor` × `factor` analysis pixels (nearest sample) */
  factor: number;
  bounds: Bbox;
  /**
   * base64(zlib(deflate)) of, in order: rise cm Uint16[n] (65535 = never) ·
   * d0 cm Int16[n] · pond cm Uint16[n] · elevation dm Int16[n] · class Uint8[n]
   */
  data: string;
}

export function encodeDisplay(grid: { z: number; width: number; height: number; bounds: Bbox; elev: Float32Array }, field: FloodField, cls: Uint8Array, pond: Float32Array | null, maxSide = 560): EncodedRaster {
  const f = Math.max(1, Math.ceil(Math.max(grid.width, grid.height) / maxSide));
  const W = Math.floor(grid.width / f);
  const H = Math.floor(grid.height / f);
  const n = W * H;
  const buf = new ArrayBuffer(n * 9);
  const rise = new Uint16Array(buf, 0, n);
  const d0 = new Int16Array(buf, n * 2, n);
  const pd = new Uint16Array(buf, n * 4, n);
  const el = new Int16Array(buf, n * 6, n);
  const cl = new Uint8Array(buf, n * 8, n);
  const off = Math.floor(f / 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * f + off) * grid.width + x * f + off;
      const o = y * W + x;
      const r = field.rise[i]!;
      rise[o] = r === Infinity ? 65535 : Math.min(65534, Math.round(r * 100));
      d0[o] = Math.max(-32767, Math.min(32767, Math.round(field.d0[i]! * 100)));
      pd[o] = pond ? Math.min(65535, Math.round(pond[i]! * 100)) : 0;
      el[o] = Math.max(-32767, Math.min(32767, Math.round(grid.elev[i]! * 10)));
      cl[o] = cls[i]!;
    }
  }
  // bounds of the (possibly trimmed) display raster
  const b = grid.bounds;
  const east = b.west + ((b.east - b.west) * (W * f)) / grid.width;
  // latitude trimming in mercator space
  const south = pxToLat(latToPx(b.north, grid.z) + H * f, grid.z);
  return { width: W, height: H, factor: f, bounds: { west: b.west, north: b.north, east, south }, data: deflateSync(Buffer.from(buf), { level: 6 }).toString("base64") };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export const RISE_STEP = 0.1;

export interface FloodSimInput {
  center: { lat: number; lon: number };
  sizeKm: number;
  zoom?: number | "auto";
  sources: "sea" | "rivers" | "both";
  reference: "source" | "lowpct";
  lowPercentile?: number;
  maxRiseM?: number;
  rainExcessMm?: number;
  catchmentRatio?: number;
  /** selected rise for the headline narrative */
  riseM: number;
  label?: string;
}

export interface FloodAssetImpact {
  id: string;
  name: string;
  type: string;
  crop: string | null;
  lat: number;
  lon: number;
  valueUsd: number;
  elevationM: number;
  /** rise (m) at which the asset's own cell floods (null = not within range) */
  floodsAtM: number | null;
  curve: string;
  /** per level (index = rise / 0.1) */
  depthM: number[];
  sharePct: number[];
  lossUsd: number[];
  insuredLossUsd: number[] | null;
  elUpliftUsd: number[] | null;
  households: number | null;
}

export interface FloodSimResult {
  id: string;
  kind: "flood";
  createdAt: string;
  input: FloodSimInput;
  grid: { z: number; width: number; height: number; pixelM: number; bounds: Bbox; cells: number };
  raster: EncodedRaster;
  referenceLevelM: number;
  sourcesFound: { seaPct: number; riverPct: number; pondPct: number };
  landElevation: { p5: number; p50: number; p95: number };
  levels: (LevelStat & { assetsHit: number; exposureHitUsd: number; lossUsd: number; insuredLossUsd: number; elUpliftUsd: number; households: number; people: number | null })[];
  assets: FloodAssetImpact[];
  population: { densityPerKm2: number | null; basis: string };
  timings: { fetchMs: number; computeMs: number; stages: Record<string, number>; tiles: DemGrid["tiles"] };
  sources: { label: string; href?: string }[];
  caveats: string[];
}

const g = globalThis as unknown as { __agriSimCache?: Map<string, unknown> };
export const simCache: Map<string, unknown> = (g.__agriSimCache ??= new Map());
export function rememberSim(id: string, v: unknown) {
  if (simCache.size > 24) {
    const first = simCache.keys().next().value;
    if (first !== undefined) simCache.delete(first);
  }
  simCache.set(id, v);
}

export function bboxAround(lat: number, lon: number, sizeKm: number): Bbox {
  const dLat = sizeKm / 2 / 111.32;
  const dLon = sizeKm / 2 / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return { west: lon - dLon, east: lon + dLon, south: Math.max(-84, lat - dLat), north: Math.min(84, lat + dLat) };
}

const MAX_CELLS = 2_600_000;

export function chooseZoom(b: Bbox, requested?: number | "auto"): number {
  let z = typeof requested === "number" ? Math.max(11, Math.min(13, Math.round(requested))) : 13;
  if (requested === "auto" || requested === undefined) {
    // finest zoom that keeps the grid under the cell cap
    while (z > 11) {
      const d = gridDims(b, z);
      if (d.width * d.height <= MAX_CELLS) break;
      z--;
    }
  }
  for (;;) {
    const d = gridDims(b, z);
    if (d.width * d.height <= MAX_CELLS || z <= 8) return z;
    z--;
  }
}

/** Nearest seeded district (for population density & historical flood presets). */
export function nearestDistrict(lat: number, lon: number, maxKm = 120) {
  let best: { id: string; name: string; country: string; km: number; population: number } | null = null;
  for (const d of getStore().districts) {
    const km = haversine(lat, lon, d.lat, d.lon);
    if (km <= maxKm && (!best || km < best.km)) best = { id: d.id, name: d.name, country: d.country, km, population: d.population };
  }
  return best;
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function creditFns(): Promise<CreditFns | null> {
  try {
    const m = await import("./credit-risk");
    return { baselinePd: m.baselinePd, climatePd: m.climatePd, sensitivity: m.sensitivity as CreditFns["sensitivity"], lgdFor: m.lgdFor };
  } catch {
    return null;
  }
}

export async function runFloodSim(workspaceId: string, input: FloodSimInput, opts: { assetIds?: string[] } = {}): Promise<FloodSimResult> {
  const maxRise = Math.max(0.5, Math.min(8, input.maxRiseM ?? 5));
  const bbox = bboxAround(input.center.lat, input.center.lon, Math.max(2, Math.min(60, input.sizeKm)));
  const z = chooseZoom(bbox, input.zoom);
  const grid = await loadGrid(bbox, z, { withWater: true });
  const t0 = Date.now();
  const { width: w, height: h, elev } = grid;
  const n = w * h;
  const rowArea = new Float32Array(h);
  for (let y = 0; y < h; y++) rowArea[y] = grid.rowSizeM[y]! ** 2;

  const stage: Record<string, number> = {};
  let tt = Date.now();
  const lap = (k: string) => {
    const now = Date.now();
    stage[k] = now - tt;
    tt = now;
  };
  const cls = classifyWater(elev, grid.occ, w, h, { sea: input.sources !== "rivers", rivers: input.sources !== "sea" });
  lap("classify");
  const pLow = percentile(elev, cls, input.lowPercentile ?? 5);
  const base = sourceBase(elev, cls, w, h, input.reference, Math.max(0, pLow));
  lap("base");
  const field = floodField(elev, cls, base, w, h, maxRise);
  lap("flood");
  const rain = Math.max(0, input.rainExcessMm ?? 0) / 1000;
  const pond = rain > 0 ? pondDepth(elev, fillDepressions(elev, cls, w, h), w, h, rowArea, rain, Math.max(1, Math.min(10, input.catchmentRatio ?? 3))) : null;

  const levels: number[] = [];
  for (let k = 0; k <= Math.round(maxRise / RISE_STEP); k++) levels.push(round(k * RISE_STEP, 2));
  lap("pond");
  const stats = levelStats(field, cls, pond, w, h, rowArea, levels);
  lap("levels");

  let sea = 0;
  let river = 0;
  let pondN = 0;
  for (let i = 0; i < n; i++) cls[i] === CLS_SEA ? sea++ : cls[i] === CLS_RIVER ? river++ : cls[i] === CLS_POND ? pondN++ : 0;

  // ── assets inside the area ──
  const all = workspaceAssets(workspaceId).filter((a) => (opts.assetIds ? opts.assetIds.includes(a.id) : true));
  const inside = all.filter((a) => a.lat <= grid.bounds.north && a.lat >= grid.bounds.south && a.lon >= grid.bounds.west && a.lon <= grid.bounds.east);
  const credit = inside.some((a) => a.type === "loan") ? await creditFns() : null;
  const assets: FloodAssetImpact[] = inside.map((a) => {
    const cx = Math.floor(lonToPx(a.lon, z) - grid.px0);
    const cy = Math.floor(latToPx(a.lat, z) - grid.py0);
    const ci = Math.max(0, Math.min(h - 1, cy)) * w + Math.max(0, Math.min(w - 1, cx));
    const rM = footprintRadiusM(a.type, a.areaHa);
    const rPx = Math.max(0, Math.round(rM / grid.rowSizeM[Math.max(0, Math.min(h - 1, cy))]!));
    const step = Math.max(1, Math.ceil(rPx / 30));
    const cells: number[] = [];
    for (let dy = -rPx; dy <= rPx; dy += step)
      for (let dx = -rPx; dx <= rPx; dx += step) {
        if (dx * dx + dy * dy > rPx * rPx) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (cls[i] === CLS_SEA || cls[i] === CLS_RIVER) continue; // footprint = land only
        cells.push(i);
      }
    if (!cells.length) cells.push(ci);
    const curve = curveForAsset(a.type);
    const depthAt = (i: number, hl: number) => {
      let d = field.rise[i]! < hl ? hl + field.d0[i]! : 0;
      if (pond && pond[i]! > d) d = pond[i]!;
      return d > 0.02 ? d : 0;
    };
    const depthM: number[] = [];
    const sharePct: number[] = [];
    const lossUsd: number[] = [];
    const ins: number[] = [];
    const el: number[] = [];
    const deductible = Number(a.meta.deductiblePct ?? 0);
    for (const hl of levels) {
      let wet = 0;
      let dmg = 0;
      for (const i of cells) {
        const d = depthAt(i, hl);
        if (d > 0) {
          wet++;
          dmg += depthDamage(curve, d);
        }
      }
      const meanDmg = dmg / cells.length;
      depthM.push(round(depthAt(ci, hl), 2));
      sharePct.push(Math.round((wet / cells.length) * 100));
      lossUsd.push(Math.round(a.valueUsd * meanDmg));
      if (a.type === "insured_plot") ins.push(Math.round(insuredLoss(a.valueUsd, meanDmg, deductible)));
      if (a.type === "loan" && credit) el.push(loanShock(a, "flood", meanDmg, credit).elUpliftUsd);
    }
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      crop: a.crop,
      lat: a.lat,
      lon: a.lon,
      valueUsd: a.valueUsd,
      elevationM: round(elev[ci]!, 1),
      floodsAtM: field.rise[ci]! < Infinity ? round(field.rise[ci]!, 2) : null,
      curve,
      depthM,
      sharePct,
      lossUsd,
      insuredLossUsd: a.type === "insured_plot" ? ins : null,
      elUpliftUsd: a.type === "loan" && credit ? el : null,
      households: a.type === "community" ? Number(a.meta.households ?? 0) || null : null,
    };
  });

  // ── population density: nearest district census population / boundary area ──
  const dist = nearestDistrict(input.center.lat, input.center.lon);
  const meta = dist ? districtBoundaryMeta(dist.id) : null;
  const density = dist && meta?.areaKm2 ? dist.population / meta.areaKm2 : null;

  const out = stats.map((s, k) => {
    let assetsHit = 0;
    let exposure = 0;
    let loss = 0;
    let insured = 0;
    let elUp = 0;
    let hh = 0;
    for (const a of assets) {
      if (a.sharePct[k]! > 0) {
        assetsHit++;
        exposure += a.valueUsd;
      }
      loss += a.lossUsd[k]!;
      insured += a.insuredLossUsd?.[k] ?? 0;
      elUp += a.elUpliftUsd?.[k] ?? 0;
      if (a.households) hh += (a.households * a.sharePct[k]!) / 100;
    }
    return { ...s, assetsHit, exposureHitUsd: Math.round(exposure), lossUsd: loss, insuredLossUsd: insured, elUpliftUsd: elUp, households: Math.round(hh), people: density ? Math.round((s.floodedHa / 100) * density) : null };
  });

  lap("assets");
  const raster = encodeDisplay(grid, field, cls, pond);
  lap("encode");
  const computeMs = Date.now() - t0;
  const px = grid.rowSizeM[Math.floor(h / 2)]!;
  const res: FloodSimResult = {
    id: `sim-fl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind: "flood",
    createdAt: new Date().toISOString(),
    input: { ...input, maxRiseM: maxRise },
    grid: { z, width: w, height: h, pixelM: round(px, 1), bounds: grid.bounds, cells: n },
    raster,
    referenceLevelM: input.reference === "lowpct" ? round(Math.max(0, pLow), 2) : 0,
    sourcesFound: { seaPct: round((sea / n) * 100, 1), riverPct: round((river / n) * 100, 1), pondPct: round((pondN / n) * 100, 1) },
    landElevation: { p5: round(pLow, 1), p50: round(percentile(elev, cls, 50), 1), p95: round(percentile(elev, cls, 95), 1) },
    levels: out,
    assets,
    population: {
      densityPerKm2: density ? Math.round(density) : null,
      basis: dist && density ? `${dist.name} census population ÷ district area (${Math.round(meta!.areaKm2)} km²), uniform-density assumption` : "No census district within 120 km — people affected not estimated",
    },
    timings: { fetchMs: grid.fetchMs, computeMs, stages: stage, tiles: grid.tiles },
    sources: [
      { label: TILE_SOURCES.terrarium.label, href: TILE_SOURCES.terrarium.href },
      { label: TILE_SOURCES.jrc.label + " (Pekel et al. 2016)", href: TILE_SOURCES.jrc.href },
      { label: DAMAGE_SOURCE, href: "https://publications.jrc.ec.europa.eu/repository/handle/JRC105688" },
    ],
    caveats: FLOOD_CAVEATS,
  };
  rememberSim(res.id, res);
  return res;
}

export const FLOOD_CAVEATS = [
  "Static 'bathtub' screening model: it shows where water CAN reach if the level rises, not how fast, for how long, or with what velocity.",
  "SRTM (2000) is a surface model — trees and buildings read 1-3 m too high, so flooding in vegetated or built-up areas is under-estimated there.",
  "Embankments and polder dykes narrower than one pixel are invisible to the DEM, so protected polders can show as flooded (worst case: dyke breach/overtopping).",
  "Land subsidence since 2000 is not included — on sinking coasts (e.g. Demak, up to ~10 cm/yr) the real exposure is larger.",
  "Damage uses continental average JRC curves; local construction, crop stage and flood duration can shift losses by ±50 %.",
];

// ─── "Use forecast" + history presets ──────────────────────────────────────

export interface FloodPreset {
  id: string;
  label: string;
  riseM: number;
  basis: string;
  kind: "forecast" | "history" | "sea-level" | "custom";
}

/**
 * Indicative presets for an area: live GloFAS discharge (if the district overlay
 * has it) mapped to a rise via this district's own history (depth proxy vs
 * peak discharge / Q95), the largest recorded events, and AR6 sea-level rise.
 */
export function floodPresets(lat: number, lon: number): { district: { id: string; name: string; km: number } | null; presets: FloodPreset[] } {
  const d = nearestDistrict(lat, lon);
  const presets: FloodPreset[] = [];
  if (d) {
    const rec = getStore().districts.find((x) => x.id === d.id);
    const th = floodThresholds(d.id);
    const evs = floodEvents(d.id);
    if (th && evs.length >= 3) {
      // least-squares depth = a + b · (Q / Q95) on this district's own episodes
      const xs = evs.map((e) => e.peakDischargeM3s / th.qP95);
      const ys = evs.map((e) => e.depthM);
      const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
      const my = ys.reduce((s, v) => s + v, 0) / ys.length;
      let sxy = 0;
      let sxx = 0;
      xs.forEach((x, i) => ((sxy += (x - mx) * (ys[i]! - my)), (sxx += (x - mx) ** 2)));
      const bSlope = sxx > 0 ? sxy / sxx : 0;
      const a = my - bSlope * mx;
      const q = rec?.riverDischargeM3s ?? null;
      if (q != null && rec?.liveSource === "open-meteo") {
        const ratio = q / th.qP95;
        const rise = Math.max(0, Math.min(5, a + bSlope * ratio));
        presets.push({ id: "forecast", kind: "forecast", label: `Use forecast (GloFAS ${Math.round(q)} m³/s = ${Math.round(ratio * 100)}% of Q95)`, riseM: round(rise, 1), basis: `Indicative: today's GloFAS discharge at ${d.name} mapped to a water-level rise with a regression of ${evs.length} past flood episodes (depth proxy vs peak flow ÷ Q95). Not an official forecast.` });
      } else {
        const p72 = rec?.floodProb72h ?? 0;
        const rise = Math.max(0, Math.min(5, my * Math.min(1, p72 / 0.6)));
        presets.push({ id: "forecast", kind: "forecast", label: `Use current outlook (72 h flood probability ${Math.round(p72 * 100)}%)`, riseM: round(rise, 1), basis: `Indicative: live discharge unavailable, so the district's current 72-hour flood probability scales the mean depth proxy of ${evs.length} past episodes (${round(my, 2)} m). Not an official forecast.` });
      }
      [...evs].sort((x, y) => y.depthM - x.depthM).slice(0, 3).forEach((e, i) => {
        presets.push({ id: `hist-${i}`, kind: "history", label: `Replay ${e.peakDate.slice(0, 7)} flood (${e.driver})`, riseM: round(Math.min(5, e.depthM), 1), basis: `${d.name}: real GloFAS/ERA5 episode ${e.start} → ${e.end}, peak ${Math.round(e.peakDischargeM3s)} m³/s, 3-day rain ${Math.round(e.peakRain3dMm)} mm; depth proxy ${round(e.depthM, 2)} m used as the rise.` });
      });
    }
  }
  presets.push({ id: "slr-245", kind: "sea-level", label: "Sea-level rise 2100 · SSP2-4.5 (+0.56 m)", riseM: 0.6, basis: "IPCC AR6 WG1 global-mean sea-level rise by 2100 under SSP2-4.5, median 0.56 m (likely 0.44–0.76 m). Local rise differs (subsidence, ocean dynamics)." });
  presets.push({ id: "slr-585", kind: "sea-level", label: "Sea-level rise 2100 · SSP5-8.5 (+0.77 m) + spring tide", riseM: 1.5, basis: "IPCC AR6 SSP5-8.5 median 0.77 m by 2100 plus ~0.7 m spring-tide/storm-tide allowance — an indicative high-end coastal planning level." });
  return { district: d ? { id: d.id, name: d.name, km: Math.round(d.km) } : null, presets };
}
