/**
 * Deterministic PRNG so the demo dataset is identical on every boot
 * (and across server/client) — judges see the same story every time.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof mulberry32>;

export const between = (rng: Rng, min: number, max: number) => min + rng() * (max - min);
export const intBetween = (rng: Rng, min: number, max: number) =>
  Math.floor(between(rng, min, max + 1));
export const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
export const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Stable short id derived from a prefix + counter. */
export const makeId = (prefix: string, n: number) => `${prefix}_${n.toString(36).padStart(4, "0")}`;

/** Irregular polygon ("blob") around a centre — looks like a real admin boundary. */
export function blobPolygon(
  rng: Rng,
  lat: number,
  lon: number,
  radiusDeg: number,
  vertices = 10
): number[][][] {
  const ring: number[][] = [];
  for (let i = 0; i < vertices; i++) {
    const angle = (i / vertices) * Math.PI * 2;
    const r = radiusDeg * between(rng, 0.7, 1.15);
    ring.push([round(lon + Math.cos(angle) * r, 5), round(lat + Math.sin(angle) * r * 0.9, 5)]);
  }
  ring.push(ring[0]!);
  return [ring];
}

/** Small rectangular farm plot, rotated a little. */
export function fieldPolygon(rng: Rng, lat: number, lon: number, areaHa: number): number[][][] {
  // 1 ha ≈ 100m x 100m ≈ 0.0009° — scale by sqrt(area)
  const side = 0.0009 * Math.sqrt(areaHa);
  const w = side * between(rng, 0.8, 1.4);
  const h = (side * side) / w;
  const rot = between(rng, -0.4, 0.4);
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => [
    round(lon + x! * Math.cos(rot) - y! * Math.sin(rot), 6),
    round(lat + x! * Math.sin(rot) + y! * Math.cos(rot), 6),
  ]);
  corners.push(corners[0]!);
  return [corners];
}
