/**
 * Sensors & IoT — pure physical models used by the simulator (and unit-tested).
 *
 *  • Astronomical tide: harmonic sum  η(t) = Σ Aᵢ cos(ωᵢ t − φᵢ)
 *      M2 principal lunar semi-diurnal   12.4206012 h
 *      S2 principal solar semi-diurnal   12.0000000 h
 *      K1 luni-solar diurnal             23.9344696 h  (optional, Mekong-type mixed tides)
 *      O1 principal lunar diurnal        25.8193417 h  (optional)
 *    M2 and S2 beat against each other → spring–neap cycle of
 *      T_sn = 1 / (1/12.00 − 1/12.4206) h ≈ 14.77 days,
 *    tidal range oscillating between 2(A_M2 − A_S2) (neap) and 2(A_M2 + A_S2) (spring).
 *  • Seasonal river stage (GloFAS-like): smooth annual harmonic with a monsoon peak.
 *  • Linear-reservoir rainfall-runoff (exponential unit hydrograph).
 *  • Soil water bucket with exponential drying toward the wilting point.
 */

export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface TidalConstituent {
  name: "M2" | "S2" | "K1" | "O1" | "N2";
  /** period in hours */
  periodH: number;
  /** amplitude in metres */
  amp: number;
  /** phase lag in radians */
  phase: number;
}

export const CONSTITUENT_PERIOD_H = { M2: 12.4206012, S2: 12.0, N2: 12.65834751, K1: 23.93446966, O1: 25.81934171 } as const;

/** Spring–neap beat period of M2 and S2, in hours (≈ 354.4 h = 14.77 d). */
export const SPRING_NEAP_PERIOD_H = 1 / (1 / CONSTITUENT_PERIOD_H.S2 - 1 / CONSTITUENT_PERIOD_H.M2);

/** Arbitrary but fixed epoch so tides are continuous across restarts. */
const TIDE_EPOCH = Date.UTC(2026, 0, 1);

export function tideLevel(t: number, cons: TidalConstituent[], meanLevel = 0): number {
  const hours = (t - TIDE_EPOCH) / HOUR;
  let eta = meanLevel;
  for (const c of cons) eta += c.amp * Math.cos((2 * Math.PI * hours) / c.periodH - c.phase);
  return eta;
}

/** Envelope of the M2+S2 pair at time t: the instantaneous semi-diurnal amplitude. */
export function springNeapEnvelope(t: number, m2: TidalConstituent, s2: TidalConstituent): number {
  const hours = (t - TIDE_EPOCH) / HOUR;
  const dphi = (2 * Math.PI * hours) / s2.periodH - s2.phase - ((2 * Math.PI * hours) / m2.periodH - m2.phase);
  return Math.sqrt(m2.amp * m2.amp + s2.amp * s2.amp + 2 * m2.amp * s2.amp * Math.cos(dphi));
}

/** Tidal regime presets (amplitudes in metres) — Bay of Bengal estuaries vs Mekong mixed tides. */
export function tidalConstituents(regime: "bengal" | "mekong" | "odisha" | "luzon", seed: number): TidalConstituent[] {
  const ph = (k: number) => ((seed * 9301 + k * 49297) % 233280) / 233280 * 2 * Math.PI;
  const P = CONSTITUENT_PERIOD_H;
  switch (regime) {
    case "bengal":
      return [
        { name: "M2", periodH: P.M2, amp: 1.05, phase: ph(1) },
        { name: "S2", periodH: P.S2, amp: 0.48, phase: ph(2) },
        { name: "N2", periodH: P.N2, amp: 0.18, phase: ph(3) },
        { name: "K1", periodH: P.K1, amp: 0.15, phase: ph(4) },
      ];
    case "odisha":
      return [
        { name: "M2", periodH: P.M2, amp: 0.62, phase: ph(1) },
        { name: "S2", periodH: P.S2, amp: 0.28, phase: ph(2) },
        { name: "K1", periodH: P.K1, amp: 0.12, phase: ph(4) },
        { name: "O1", periodH: P.O1, amp: 0.05, phase: ph(5) },
      ];
    case "mekong":
      return [
        { name: "M2", periodH: P.M2, amp: 0.78, phase: ph(1) },
        { name: "S2", periodH: P.S2, amp: 0.32, phase: ph(2) },
        { name: "K1", periodH: P.K1, amp: 0.58, phase: ph(4) },
        { name: "O1", periodH: P.O1, amp: 0.42, phase: ph(5) },
      ];
    case "luzon":
      return [
        { name: "M2", periodH: P.M2, amp: 0.36, phase: ph(1) },
        { name: "S2", periodH: P.S2, amp: 0.14, phase: ph(2) },
        { name: "K1", periodH: P.K1, amp: 0.28, phase: ph(4) },
        { name: "O1", periodH: P.O1, amp: 0.24, phase: ph(5) },
      ];
  }
}

/**
 * GloFAS-like seasonal discharge ratio (flow / annual mean) for day-of-year.
 * Monsoon basins peak ~late Aug; dry-season minimum ~April. `peakDoy` shifts
 * the curve (Mekong peaks mid-Sept/Oct, Luzon Aug).
 */
export function seasonalFlowRatio(t: number, peakDoy = 235, amplitude = 0.75): number {
  const d = new Date(t);
  const doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY + d.getUTCHours() / 24;
  const x = (2 * Math.PI * (doy - peakDoy)) / 365.25;
  // first + second harmonic gives a sharper monsoon peak and a long flat dry season
  return Math.max(0.15, 1 + amplitude * Math.cos(x) + 0.18 * amplitude * Math.cos(2 * x));
}

/** Rating curve inverse: stage (m above datum) from flow ratio, h = h0 + a·Q^b with b≈0.45. */
export function stageFromFlowRatio(ratio: number, base: number, scale: number): number {
  return base + scale * Math.pow(Math.max(0, ratio), 0.45);
}

/** One explicit step of a linear reservoir: storage decays with time constant tauH and gains input. */
export function reservoirStep(storage: number, inflow: number, dtH: number, tauH: number): number {
  return storage * Math.exp(-dtH / tauH) + inflow;
}

/**
 * Soil moisture bucket (% VWC): exponential drying toward `floor` with a
 * time constant that shortens in hot weather, plus rain/irrigation infiltration
 * capped at saturation.
 */
export function soilMoistureStep(m: number, dtH: number, opts: { rainMm: number; irrigationMm: number; floor: number; saturation: number; tauH: number; depthMm?: number }): number {
  const depth = opts.depthMm ?? 300; // root-zone depth: 1 mm of water raises VWC by 100/depth %
  const dried = opts.floor + (m - opts.floor) * Math.exp(-dtH / opts.tauH);
  const wetted = dried + ((opts.rainMm * 0.8 + opts.irrigationMm) * 100) / depth;
  return Math.min(opts.saturation, Math.max(opts.floor * 0.8, wetted));
}

/** Diurnal cycle (0 at 06:00 local-solar, peak 1 around 14:30). lon for local solar time. */
export function diurnal(t: number, lon: number): number {
  const solarH = ((t / HOUR + lon / 15) % 24 + 24) % 24;
  return Math.cos((2 * Math.PI * (solarH - 14.5)) / 24);
}

// ─── Deterministic noise ─────────────────────────────────────────────────

/** 32-bit string hash (FNV-1a). */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Uniform [0,1) from integer key (splitmix-ish). */
export function hash01(a: number, b = 0): number {
  let x = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

/** Standard normal from two uniforms (Box–Muller). */
export function gauss(a: number, b: number): number {
  const u = Math.max(1e-12, hash01(a, b));
  const v = hash01(b, a + 17);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Smooth (cosine-interpolated) standard-normal noise with a correlation time of `periodMs`. */
export function smoothNoise(seed: number, t: number, periodMs: number): number {
  const x = t / periodMs;
  const k = Math.floor(x);
  const f = (1 - Math.cos(Math.PI * (x - k))) / 2;
  return gauss(seed, k) * (1 - f) + gauss(seed, k + 1) * f;
}

/**
 * Hourly rain (mm) for a rain "cell" (shared by nearby devices): a
 * clustered Poisson process whose wet-hour probability and intensity follow
 * the monsoon season and are scaled by the forecast/observed 72 h rain of the
 * nearest district (cached live data where available).
 */
export function hourlyRain(cell: number, hourIndex: number, opts: { monsoonPeakDoy: number; wetness: number }): number {
  const t = hourIndex * HOUR;
  const season = seasonalFlowRatio(t, opts.monsoonPeakDoy, 0.9); // 0.15 … ~2
  // storms are clustered: a 6-hour "storm window" gates individual wet hours
  const stormWin = Math.floor(hourIndex / 6);
  const pStorm = Math.min(0.55, 0.05 + 0.16 * season * opts.wetness);
  if (hash01(cell, stormWin * 7 + 3) > pStorm) return 0;
  const pWetHour = 0.55;
  if (hash01(cell, hourIndex * 13 + 1) > pWetHour) return 0;
  // exponential intensity, mean grows with season
  const mean = 1.6 + 3.2 * season * opts.wetness;
  const u = Math.max(1e-9, hash01(cell, hourIndex * 31 + 5));
  return Math.round(-Math.log(u) * mean * 5) / 5; // 0.2 mm bucket resolution
}
