/**
 * Pure climate statistics used by the Location Intelligence engine.
 * Dependency-free and deterministic so every formula is unit-tested
 * (tests/explorer-climate-math.test.ts).
 *
 *  quantile / percentileRank      — empirical distribution helpers
 *  linearTrend / mannKendall      — trend per decade + significance
 *  gumbelFit / gumbelReturnLevel  — extreme-value (annual maxima) return periods
 *  gammaFit / spi                 — Standardised Precipitation Index (McKee 1993)
 *  heatIndexC / wetBulbC          — NOAA Rothfusz heat index, Stull (2011) wet-bulb
 */

export const round = (v: number, d = 1) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

const finite = (a: (number | null | undefined)[]) => a.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

export function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
}

export function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/** Linear-interpolated empirical quantile (type 7, same as numpy default). q in [0,1]. */
export function quantile(values: (number | null | undefined)[], q: number): number {
  const a = finite(values).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const pos = (a.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo]! + (a[hi]! - a[lo]!) * (pos - lo);
}

/** Share (0-100) of the record that is ≤ value (mid-rank for ties). */
export function percentileRank(values: (number | null | undefined)[], value: number): number {
  const a = finite(values);
  if (!a.length) return NaN;
  let below = 0;
  let equal = 0;
  for (const v of a) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return (100 * (below + 0.5 * equal)) / a.length;
}

// ─── Trends ──────────────────────────────────────────────────────────────

export interface Trend {
  /** change per decade in the series' units */
  slopePerDecade: number;
  intercept: number;
  r2: number;
  /** Mann-Kendall two-sided p-value (non-parametric significance) */
  pValue: number;
  significant: boolean;
  n: number;
}

/** Ordinary least squares on (year, value) → slope per decade, plus Mann-Kendall significance. */
export function linearTrend(points: { x: number; y: number | null | undefined }[]): Trend {
  const p = points.filter((d): d is { x: number; y: number } => typeof d.y === "number" && Number.isFinite(d.y));
  const n = p.length;
  if (n < 3) return { slopePerDecade: 0, intercept: n ? p[0]!.y : 0, r2: 0, pValue: 1, significant: false, n };
  const mx = mean(p.map((d) => d.x));
  const my = mean(p.map((d) => d.y));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const d of p) {
    sxy += (d.x - mx) * (d.y - my);
    sxx += (d.x - mx) ** 2;
    syy += (d.y - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  const mk = mannKendall(p.map((d) => d.y));
  return { slopePerDecade: slope * 10, intercept: my - slope * mx, r2, pValue: mk.pValue, significant: mk.pValue < 0.05, n };
}

/** Mann-Kendall trend test (no tie correction beyond the standard variance term). */
export function mannKendall(y: number[]): { s: number; z: number; pValue: number } {
  const n = y.length;
  if (n < 3) return { s: 0, z: 0, pValue: 1 };
  let s = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(y[j]! - y[i]!);
  // tie correction
  const counts = new Map<number, number>();
  for (const v of y) counts.set(v, (counts.get(v) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of counts.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = variance <= 0 ? 0 : s > 0 ? (s - 1) / Math.sqrt(variance) : s < 0 ? (s + 1) / Math.sqrt(variance) : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { s, z, pValue };
}

// ─── Normal distribution ─────────────────────────────────────────────────

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, |ε| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Inverse standard normal CDF (Acklam's rational approximation, rel. error < 1.15e-9). */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

// ─── Gumbel (EV-I) extremes ──────────────────────────────────────────────

export interface GumbelFit {
  mu: number;
  beta: number;
  n: number;
}

const EULER = 0.5772156649;

/** Method-of-moments Gumbel fit to a series of annual maxima. */
export function gumbelFit(annualMaxima: (number | null | undefined)[]): GumbelFit | null {
  const a = finite(annualMaxima);
  if (a.length < 5) return null;
  const s = stdev(a);
  if (s <= 0) return null;
  const beta = (s * Math.sqrt(6)) / Math.PI;
  return { mu: mean(a) - EULER * beta, beta, n: a.length };
}

/** Value expected to be exceeded on average once every `years` (T-year return level). */
export function gumbelReturnLevel(fit: GumbelFit, years: number): number {
  return fit.mu - fit.beta * Math.log(-Math.log(1 - 1 / years));
}

/** Return period (years) of a given magnitude; ≥1. */
export function gumbelReturnPeriod(fit: GumbelFit, value: number): number {
  const F = Math.exp(-Math.exp(-(value - fit.mu) / fit.beta)); // non-exceedance probability
  const exceed = 1 - F;
  if (exceed <= 1e-6) return 1e6;
  return Math.max(1, 1 / exceed);
}

// ─── Gamma distribution + SPI ────────────────────────────────────────────

function lnGamma(z: number): number {
  // Lanczos approximation (g=7, n=9)
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0]!;
  for (let i = 1; i < g + 2; i++) x += c[i]! / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularised lower incomplete gamma P(a, x) (series / continued fraction, Numerical Recipes). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // continued fraction for Q, P = 1 - Q
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

export interface GammaFit {
  alpha: number; // shape
  beta: number; // scale
  q0: number; // probability of zero
}

/** Thom (1958) maximum-likelihood approximation, with a mixed zero-probability term. */
export function gammaFit(values: (number | null | undefined)[]): GammaFit | null {
  const all = finite(values);
  if (all.length < 8) return null;
  const pos = all.filter((v) => v > 0);
  const q0 = (all.length - pos.length) / all.length;
  if (pos.length < 5) return null;
  const m = mean(pos);
  const A = Math.log(m) - mean(pos.map(Math.log));
  if (!(A > 0)) return null;
  const alpha = (1 + Math.sqrt(1 + (4 * A) / 3)) / (4 * A);
  return { alpha, beta: m / alpha, q0 };
}

export function gammaCdf(fit: GammaFit, x: number): number {
  if (x <= 0) return fit.q0;
  return fit.q0 + (1 - fit.q0) * gammaP(fit.alpha, x / fit.beta);
}

/**
 * Standardised Precipitation Index of `current` against a reference sample of
 * same-season accumulations (e.g. the 30-day total ending on this date in each
 * of the last 40 years). Clamped to ±3.
 */
export function spi(reference: (number | null | undefined)[], current: number): number | null {
  const fit = gammaFit(reference);
  if (!fit) return null;
  const p = Math.min(0.99865, Math.max(0.00135, gammaCdf(fit, current)));
  return Math.max(-3, Math.min(3, normalInv(p)));
}

export function spiCategory(v: number | null): { label: string; severity: "wet" | "normal" | "moderate" | "severe" | "extreme" } {
  if (v == null) return { label: "Unknown", severity: "normal" };
  if (v >= 2) return { label: "Extremely wet", severity: "wet" };
  if (v >= 1.5) return { label: "Very wet", severity: "wet" };
  if (v >= 1) return { label: "Moderately wet", severity: "wet" };
  if (v > -1) return { label: "Near normal", severity: "normal" };
  if (v > -1.5) return { label: "Moderately dry", severity: "moderate" };
  if (v > -2) return { label: "Severely dry", severity: "severe" };
  return { label: "Extremely dry", severity: "extreme" };
}

// ─── Heat stress ─────────────────────────────────────────────────────────

/** NOAA heat index (Rothfusz regression with Steadman low-end + adjustments). Inputs °C, %RH. Output °C. */
export function heatIndexC(tempC: number, rh: number): number {
  const T = (tempC * 9) / 5 + 32;
  const R = Math.min(100, Math.max(0, rh));
  let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + R * 0.094);
  if ((hi + T) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    if (R < 13 && T >= 80 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (R > 85 && T >= 80 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
  }
  return ((hi - 32) * 5) / 9;
}

/** Stull (2011) wet-bulb temperature from air temperature (°C) and RH (%), valid 5-99 %RH, -20..50 °C. */
export function wetBulbC(tempC: number, rh: number): number {
  const R = Math.min(99, Math.max(5, rh));
  const T = tempC;
  return (
    T * Math.atan(0.151977 * Math.sqrt(R + 8.313659)) +
    Math.atan(T + R) -
    Math.atan(R - 1.676331) +
    0.00391838 * R ** 1.5 * Math.atan(0.023101 * R) -
    4.686035
  );
}

export function heatIndexCategory(hiC: number): { label: string; level: 0 | 1 | 2 | 3 | 4 } {
  if (hiC >= 54) return { label: "Extreme danger", level: 4 };
  if (hiC >= 41) return { label: "Danger", level: 3 };
  if (hiC >= 32) return { label: "Extreme caution", level: 2 };
  if (hiC >= 27) return { label: "Caution", level: 1 };
  return { label: "No heat stress", level: 0 };
}

// ─── Series helpers ──────────────────────────────────────────────────────

/** Max rolling-window sum over a numeric series (nulls count as 0). */
export function maxRollingSum(values: (number | null | undefined)[], window: number): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < values.length; i++) {
    run += values[i] ?? 0;
    if (i >= window) run -= values[i - window] ?? 0;
    if (i >= window - 1 && run > best) best = run;
  }
  return best;
}

/** Longest run of consecutive days below `threshold` mm. */
export function longestDrySpell(values: (number | null | undefined)[], threshold = 1): number {
  let best = 0;
  let run = 0;
  for (const v of values) {
    if ((v ?? 0) < threshold) {
      run++;
      if (run > best) best = run;
    } else run = 0;
  }
  return best;
}
