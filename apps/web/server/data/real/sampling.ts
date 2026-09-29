/** Small deterministic sampling helpers shared by the demo seeders. */
import type { Rng } from "../prng";

/** Standard normal via Box–Muller (two PRNG draws). */
export function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-normal draw around a median, clamped — farm, plot and loan sizes are right-skewed. */
export function logNormal(rng: Rng, median: number, sigma: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, median * Math.exp(sigma * gauss(rng))));
}

/** Split `total` into `n` positive parts with random (0.5–1.5) weights. */
export function splitShares(rng: Rng, total: number, n: number): number[] {
  const w = Array.from({ length: n }, () => 0.5 + rng());
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (total * x) / sum);
}
