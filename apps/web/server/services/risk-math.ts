/**
 * Shared statistics for the Insurance, Finance and Anticipatory Action modules.
 * Pure functions only (unit-tested in tests/insurance-*.test.ts, finance-*.test.ts).
 */

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
export const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

export function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/** Linear-interpolated quantile (type 7, as in R/numpy default). q in [0,1]. */
export function quantile(values: number[], q: number): number {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const pos = (a.length - 1) * clamp(q);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo]! + (a[hi]! - a[lo]!) * (pos - lo);
}

/** Percentile rank (0-100) of `v` within `sample` (mid-rank for ties). */
export function percentileRank(v: number, sample: number[]): number {
  const a = sample.filter((x) => Number.isFinite(x));
  if (!a.length) return NaN;
  let below = 0;
  let equal = 0;
  for (const x of a) {
    if (x < v) below++;
    else if (x === v) equal++;
  }
  return ((below + 0.5 * equal) / a.length) * 100;
}

/** Abramowitz–Stegun 7.1.26 erf → standard normal CDF (|error| < 1.5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Acklam's rational approximation of the inverse normal CDF (rel. error < 1.2e-9). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
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

/** Spearman rank correlation (average ranks for ties). NaN if < 3 pairs or no variance. */
export function spearman(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(a.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]![1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(x.slice(0, n));
  const ry = rank(y.slice(0, n));
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}

// ─── Zero-inflated lognormal for annual aggregate losses ──────────────────

export interface ZilnFit {
  /** probability of a zero-loss year */
  p0: number;
  mu: number;
  sigma: number;
  n: number;
  /** hard cap (e.g. total sum insured) */
  cap: number;
}

/**
 * Fit a zero-inflated lognormal to annual aggregate losses: P(L=0)=p0, L | L>0 ~ LN(mu, sigma).
 * Parameters by the method of moments on the positive years (matches their mean and
 * variance: σ² = ln(1 + s²/m²), μ = ln m − σ²/2), which — unlike fitting the logs —
 * is not distorted by near-zero loss years. σ is floored at 0.25 so a short record
 * doesn't give an unrealistically thin tail.
 */
export function fitZiln(losses: number[], cap = Infinity): ZilnFit {
  const n = losses.length;
  const pos = losses.filter((v) => v > 0);
  const p0 = n ? (n - pos.length) / n : 1;
  if (!pos.length) return { p0: 1, mu: 0, sigma: 0.25, n, cap };
  const m = mean(pos);
  const sd = pos.length > 1 ? stdev(pos) : m * 0.6;
  const sigma = Math.max(0.25, Math.sqrt(Math.log(1 + (sd * sd) / (m * m))));
  const mu = Math.log(m) - (sigma * sigma) / 2;
  return { p0, mu, sigma, n, cap };
}

/** Loss with annual exceedance probability 1/T (the "1-in-T" PML). */
export function zilnReturnLevel(fit: ZilnFit, T: number): number {
  const q = 1 / T;
  const pPos = 1 - fit.p0;
  if (pPos <= 0 || q >= pPos) return 0;
  const x = Math.exp(fit.mu + fit.sigma * normInv(1 - q / pPos));
  return Math.min(fit.cap, x);
}

/** Probability that annual loss exceeds x. */
export function zilnExceedance(fit: ZilnFit, x: number): number {
  const pPos = 1 - fit.p0;
  if (x <= 0) return pPos;
  if (x >= fit.cap) return 0;
  return pPos * (1 - normCdf((Math.log(x) - fit.mu) / fit.sigma));
}

/** Expected annual loss to an excess-of-loss layer `limit xs attachment` (numerical integration). */
export function zilnLayerLoss(fit: ZilnFit, attachment: number, limit: number, steps = 4000): number {
  const pPos = 1 - fit.p0;
  if (pPos <= 0 || limit <= 0) return 0;
  let s = 0;
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps;
    const x = Math.min(fit.cap, Math.exp(fit.mu + fit.sigma * normInv(u)));
    s += clamp(x - attachment, 0, limit);
  }
  return (pPos * s) / steps;
}

/** Empirical return level with Weibull plotting position (rank/(n+1)). */
export function empiricalReturnLevel(values: number[], T: number): number | null {
  const a = [...values].sort((x, y) => y - x);
  const n = a.length;
  // rank k has return period (n+1)/k
  const k = (n + 1) / T;
  if (k < 1) return null; // beyond the record
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  const vLo = a[lo - 1] ?? 0;
  const vHi = a[hi - 1] ?? vLo;
  return vLo + (vHi - vLo) * (k - lo);
}
