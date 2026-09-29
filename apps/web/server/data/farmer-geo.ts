/**
 * Farm-scale open data (free, key-less):
 *  - OpenStreetMap Overpass API → rivers & canals around a farm (distance to
 *    nearest waterway, map layer)
 *  - ORNL DAAC MODIS web service (MOD13Q1, 250 m, 16-day) → real NDVI time series
 *  - Nearest-district lookup + coast-distance estimate for onboarding
 * Every call is cached and fails soft (returns null) so the UI never breaks.
 */
import { cached, fetchJson } from "../live/http";
import { DISTRICTS, countryByCode, type DistrictDef } from "./geography";
import { haversineKm, pointToPolylineKm } from "./farmer-geometry";

// ─── Waterways (OSM Overpass) ─────────────────────────────────────────────

export interface Waterway {
  id: number;
  name: string | null;
  kind: "river" | "canal" | "stream";
  coords: [number, number][]; // [lat, lon]
}

interface OverpassWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

export function getWaterways(lat: number, lon: number, radiusM = 7000): Promise<Waterway[] | null> {
  const key = `osm-water:${lat.toFixed(2)},${lon.toFixed(2)}:${radiusM}`;
  return cached(key, 24 * 3600_000, async () => {
    const q = `[out:json][timeout:20];way(around:${radiusM},${lat.toFixed(5)},${lon.toFixed(5)})[waterway~"^(river|canal|stream)$"];out tags geom 80;`;
    let lastErr: unknown;
    for (const url of OVERPASS) {
      try {
        const r = await fetchJson<{ elements?: OverpassWay[] }>(url, 18000, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(q)}`,
        });
        return (r.elements ?? [])
          .filter((e) => e.type === "way" && e.geometry?.length)
          .map((e) => ({
            id: e.id,
            name: e.tags?.["name:en"] ?? e.tags?.name ?? null,
            kind: (e.tags?.waterway === "canal" ? "canal" : e.tags?.waterway === "stream" ? "stream" : "river") as Waterway["kind"],
            coords: e.geometry!.map((g) => [Math.round(g.lat * 1e5) / 1e5, Math.round(g.lon * 1e5) / 1e5] as [number, number]),
          }));
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }).catch(() => null);
}

export function nearestWaterway(lat: number, lon: number, ways: Waterway[]): { km: number; name: string | null; kind: string } | null {
  let best: { km: number; name: string | null; kind: string } | null = null;
  for (const w of ways) {
    const km = pointToPolylineKm(lat, lon, w.coords);
    if (!best || km < best.km) best = { km: Math.round(km * 100) / 100, name: w.name, kind: w.kind };
  }
  return best;
}

// ─── NDVI (ORNL DAAC MODIS MOD13Q1) ───────────────────────────────────────

const modisDate = (d: Date) => {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = Math.floor((d.getTime() - start) / 86_400_000);
  return `A${d.getUTCFullYear()}${String(doy).padStart(3, "0")}`;
};

/** 16-day NDVI composites for the last ~150 days at 250 m. */
export function getModisNdvi(lat: number, lon: number): Promise<{ date: string; ndvi: number }[] | null> {
  const key = `modis-ndvi:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return cached(key, 12 * 3600_000, async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 150 * 86_400_000);
    const url =
      `https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}` +
      `&band=250m_16_days_NDVI&startDate=${modisDate(start)}&endDate=${modisDate(end)}&kmAboveBelow=0&kmLeftRight=0`;
    const r = await fetchJson<{ scale?: string; subset?: { calendar_date: string; data: number[] }[] }>(url, 15000);
    const scale = Number(r.scale ?? "0.0001") || 0.0001;
    return (r.subset ?? [])
      .map((s) => ({ date: s.calendar_date, ndvi: Math.round((s.data[0] ?? -3000) * scale * 1000) / 1000 }))
      .filter((s) => s.ndvi > -0.2 && s.ndvi <= 1);
  }).catch(() => null);
}

// ─── District / coast ─────────────────────────────────────────────────────

export function nearestDistrict(lat: number, lon: number): { district: DistrictDef; km: number } {
  let best = { district: DISTRICTS[0]!, km: Infinity };
  for (const d of DISTRICTS) {
    const km = haversineKm(lat, lon, d.lat, d.lon);
    if (km < best.km) best = { district: d, km };
  }
  return { district: best.district, km: Math.round(best.km * 10) / 10 };
}

/**
 * Coast distance estimate: the district centroid's coast distance, shifted by
 * how far the farm sits toward the sea. All five monitored deltas drain toward
 * the equator side (Bay of Bengal, South China Sea, Manila Bay) except Java's
 * north coast, where the sea lies poleward — hence the sign flip south of 0°.
 */
export function estimateCoastKm(lat: number, d: DistrictDef): number {
  const towardSea = (lat - d.lat) * 111 * (d.lat >= 0 ? 1 : -1);
  return Math.max(0.5, Math.round((d.coastDistanceKm + towardSea) * 10) / 10);
}

export const countryNameFor = (code: string) => countryByCode(code)?.name ?? code;
