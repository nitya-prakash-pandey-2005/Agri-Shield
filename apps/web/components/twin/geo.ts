/**
 * Earth Twin — pure geo/astro maths shared by the globe, the HUD and unit tests.
 * No three.js import here: vectors are plain tuples so the server and tests can use it.
 *
 * Globe convention (matches three.js SphereGeometry UVs and the landing HeroGlobe):
 *   φ = 90° − lat, θ = lon + 180°
 *   x = −sin φ · cos θ,  y = cos φ,  z = sin φ · sin θ
 *
 * Author: Nitya Prakash Pandey
 */
export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function latLonToVec3(lat: number, lon: number, r = 1): Vec3 {
  const phi = (90 - lat) * RAD;
  const theta = (lon + 180) * RAD;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

export function vec3ToLatLon(v: Vec3): { lat: number; lon: number } {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, v[1] / r))) * DEG;
  let lon = Math.atan2(v[2], -v[0]) * DEG - 180;
  if (lon < -180) lon += 360;
  if (lon > 180) lon -= 360;
  return { lat, lon };
}

export const normLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * Sub-solar point (where the Sun is overhead) for a UTC instant.
 * Low-precision solar ephemeris (Astronomical Almanac / NOAA), accurate to ~0.1°
 * in declination and ~0.3° in longitude for 1950-2050 — ample for a terminator.
 */
export function sunPosition(date: Date | number): { lat: number; lon: number; declination: number; gmstHours: number } {
  const ms = typeof date === "number" ? date : date.getTime();
  const jd = ms / 86_400_000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360; // mean longitude
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD; // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const eps = (23.439 - 0.0000004 * n) * RAD; // obliquity
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)); // right ascension
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  let gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  if (gmst < 0) gmst += 24;
  const lon = normLon(ra * DEG - gmst * 15);
  return { lat: dec * DEG, lon, declination: dec * DEG, gmstHours: gmst };
}

/** Solar elevation angle (degrees) at a place and instant. */
export function solarElevation(lat: number, lon: number, date: Date | number): number {
  const s = sunPosition(date);
  const phi = lat * RAD;
  const dec = s.lat * RAD;
  const h = (lon - s.lon) * RAD;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h)) * DEG;
}

/** Daylight with the standard −0.833° refraction/semi-diameter correction. */
export const isDaylight = (lat: number, lon: number, date: Date | number) => solarElevation(lat, lon, date) > -0.833;

/**
 * Terminator line (solar elevation = 0) as `n` lat/lon points, ordered by longitude.
 * Near the equinoxes the line is almost a meridian pair, which this handles since
 * tan(dec) → 0 gives lat → ±90 only where cos(h) = 0.
 */
export function terminatorLine(date: Date | number, n = 181): { lat: number; lon: number }[] {
  const s = sunPosition(date);
  const dec = s.lat * RAD;
  const out: { lat: number; lon: number }[] = [];
  const t0 = Math.tan(dec);
  const t = Math.abs(t0) < 1e-6 ? 1e-6 * (Math.sign(t0) || 1) : t0;
  for (let i = 0; i < n; i++) {
    const lon = -180 + (360 * i) / (n - 1);
    const h = (lon - s.lon) * RAD;
    const lat = Math.atan(-Math.cos(h) / t) * DEG;
    out.push({ lat, lon });
  }
  return out;
}

/** Great-circle distance (km). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Spherical linear interpolation between two surface points (returns unit vectors). */
export function slerpPath(a: { lat: number; lon: number }, b: { lat: number; lon: number }, n: number): Vec3[] {
  const va = latLonToVec3(a.lat, a.lon);
  const vb = latLonToVec3(b.lat, b.lon);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const om = Math.acos(dot);
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    if (om < 1e-6) {
      out.push(va);
      continue;
    }
    const k1 = Math.sin((1 - t) * om) / Math.sin(om);
    const k2 = Math.sin(t * om) / Math.sin(om);
    out.push([va[0] * k1 + vb[0] * k2, va[1] * k1 + vb[1] * k2, va[2] * k1 + vb[2] * k2]);
  }
  return out;
}

/** Camera distance that frames a region of `spanKm` across (perspective fov in degrees). */
export function distanceForSpan(spanKm: number, fovDeg = 40): number {
  const ang = Math.min(Math.PI * 0.9, spanKm / 6371); // radians of arc
  const half = Math.sin(ang / 2);
  return Math.max(1.35, Math.min(4.2, 1 + half / Math.tan((fovDeg * RAD) / 2) + 0.12));
}

// ─── Colour scales (kept in sync with components/hud riskColor) ─────────────

export const RISK_STOPS: [number, string][] = [
  [0, "#4ade80"],
  [35, "#fbbf24"],
  [60, "#f87171"],
  [80, "#a78bfa"],
];
export const riskHexStr = (score: number) => (score >= 80 ? "#a78bfa" : score >= 60 ? "#f87171" : score >= 35 ? "#fbbf24" : "#4ade80");

/** Saffir-Simpson colours (TD → Cat 5). */
export const CATEGORY_COLORS: Record<number, string> = {
  [-1]: "#60a5fa",
  0: "#22d3ee",
  1: "#facc15",
  2: "#fb923c",
  3: "#f87171",
  4: "#ef4444",
  5: "#e879f9",
};
export const categoryColor = (c: number) => CATEGORY_COLORS[Math.max(-1, Math.min(5, Math.round(c)))] ?? "#60a5fa";
export const categoryLabel = (c: number) => (c < 0 ? "Tropical depression" : c === 0 ? "Tropical storm" : `Category ${c}`);

export const hazardColor = (alert: string | null, type: string) =>
  alert === "red" ? "#f87171" : alert === "orange" ? "#fb923c" : alert === "green" ? "#4ade80" : type === "flood" ? "#38bdf8" : type === "cyclone" || type === "storm" ? "#c084fc" : "#fbbf24";

/** Linear interpolation into a day-series (fractional index), clamped. */
export function sampleSeries(s: number[], idx: number): number {
  if (!s.length) return 0;
  const i = Math.max(0, Math.min(s.length - 1, idx));
  const a = Math.floor(i);
  const b = Math.min(s.length - 1, a + 1);
  const t = i - a;
  return s[a]! * (1 - t) + s[b]! * t;
}
