/**
 * Pure geometry helpers shared by the farmer router and the client
 * (field drawing in onboarding). No I/O, no Node APIs.
 * Coordinates follow GeoJSON order: [lon, lat].
 */

const R = 6_378_137; // WGS84 equatorial radius (m)
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Area of a polygon ring on the sphere (m²) — Chamberlain & Duquette (2007),
 * the same formula used by Turf/Mapbox for geodesic area.
 */
export function ringAreaM2(ring: number[][]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = ring[i]!;
    const [lon2, lat2] = ring[(i + 1) % n]!;
    total += rad(lon2! - lon1!) * (2 + Math.sin(rad(lat1!)) + Math.sin(rad(lat2!)));
  }
  return Math.abs((total * R * R) / 2);
}

export const ringAreaHa = (ring: number[][]) => ringAreaM2(ring) / 10_000;

/** Close a ring (first == last) as GeoJSON requires. */
export function closeRing(ring: number[][]): number[][] {
  if (ring.length === 0) return ring;
  const [a, b] = [ring[0]!, ring[ring.length - 1]!];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, [a[0]!, a[1]!]];
}

export function ringCentroid(ring: number[][]): { lat: number; lon: number } {
  const pts = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
  const s = pts.reduce((a, p) => [a[0]! + p[0]!, a[1]! + p[1]!], [0, 0]);
  return { lon: s[0]! / Math.max(1, pts.length), lat: s[1]! / Math.max(1, pts.length) };
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Distance (km) from a point to a polyline given as [lat, lon] pairs (equirectangular, fine at field scale). */
export function pointToPolylineKm(lat: number, lon: number, line: [number, number][]): number {
  if (!line.length) return Infinity;
  const kx = 111.32 * Math.cos(rad(lat));
  const ky = 110.574;
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [aLat, aLon] = line[i]!;
    const [bLat, bLon] = line[i + 1]!;
    const ax = (aLon - lon) * kx, ay = (aLat - lat) * ky;
    const bx = (bLon - lon) * kx, by = (bLat - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx, py = ay + t * dy;
    best = Math.min(best, Math.hypot(px, py));
  }
  if (line.length === 1) best = haversineKm(lat, lon, line[0]![0], line[0]![1]);
  return best;
}

/** Square-ish outline of `areaHa` centred on a point (used for "auto-outline"). */
export function squareAround(lat: number, lon: number, areaHa = 1): number[][] {
  const sideM = Math.sqrt(areaHa * 10_000);
  const dLat = sideM / 2 / 110_574;
  const dLon = sideM / 2 / (111_320 * Math.cos(rad(lat)));
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return [
    [r(lon - dLon), r(lat - dLat)],
    [r(lon + dLon), r(lat - dLat)],
    [r(lon + dLon), r(lat + dLat)],
    [r(lon - dLon), r(lat + dLat)],
    [r(lon - dLon), r(lat - dLat)],
  ];
}
