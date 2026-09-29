/**
 * Place search + reverse geocoding for the Risk Explorer.
 *   search:  coordinates ("22.7, 90.35" / "22.7N 90.35E") → Open-Meteo geocoding → Nominatim fallback
 *   reverse: Nominatim (OpenStreetMap, ODbL) — polite: ≤1 request/second, identified
 *            User-Agent, results cached for 30 days on a ~1 km grid.
 */
import { cached, fetchJson } from "./http";
import { persisted } from "./disk-cache";
import { geocode } from "./open-meteo";

const NOMINATIM = "https://nominatim.openstreetmap.org";
const UA = { "User-Agent": "Agri-SHIELD/1.0 (climate risk explorer; https://agrishield.io)", "Accept-Language": "en" };

export interface PlaceHit {
  id: string;
  name: string;
  label: string;
  lat: number;
  lon: number;
  kind: "coordinates" | "place" | "address";
  countryCode?: string | null;
}

export interface PlaceInfo {
  name: string | null;
  displayName: string | null;
  locality: string | null;
  admin2: string | null;
  admin1: string | null;
  country: string | null;
  countryCode: string | null;
}

// ─── polite queue (Nominatim usage policy: max 1 req/s) ─────────────────
const g = globalThis as unknown as { __agriNomQ?: { last: number; chain: Promise<unknown> } };
const q = (g.__agriNomQ ??= { last: 0, chain: Promise.resolve() });

function polite<T>(fn: () => Promise<T>): Promise<T> {
  const run = q.chain.then(async () => {
    const wait = q.last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    q.last = Date.now();
    return fn();
  });
  q.chain = run.catch(() => undefined);
  return run;
}

/** Parse "lat, lon", "lat lon", "22.7N 90.35E", "-6.2,106.8" → coordinates. */
export function parseCoordinates(input: string): { lat: number; lon: number } | null {
  const s = input.trim().toUpperCase();
  const m = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2] === "S") lat = -Math.abs(lat);
  if (m[4] === "W") lon = -Math.abs(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

interface NomSearch {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  addresstype?: string;
  address?: { country_code?: string };
}

export async function searchPlaces(query: string): Promise<PlaceHit[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  const c = parseCoordinates(text);
  if (c) return [{ id: `c:${c.lat},${c.lon}`, name: `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`, label: "Coordinates", lat: c.lat, lon: c.lon, kind: "coordinates" }];
  let hits: PlaceHit[] = [];
  try {
    hits = (await geocode(text)).map((h) => ({
      id: `om:${h.latitude},${h.longitude}`,
      name: h.name,
      label: [h.admin1, h.country].filter(Boolean).join(", "),
      lat: h.latitude,
      lon: h.longitude,
      kind: "place" as const,
    }));
  } catch {
    /* fall through to Nominatim */
  }
  if (hits.length >= 3) return hits;
  try {
    const nom = await cached(`nom-s:${text.toLowerCase()}`, 7 * 86_400_000, () =>
      polite(() => fetchJson<NomSearch[]>(`${NOMINATIM}/search?q=${encodeURIComponent(text)}&format=jsonv2&limit=6&addressdetails=1`, 8000, { headers: UA }))
    );
    const seen = new Set(hits.map((h) => `${h.lat.toFixed(2)},${h.lon.toFixed(2)}`));
    for (const n of nom) {
      const lat = Number(n.lat);
      const lon = Number(n.lon);
      const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const parts = n.display_name.split(",").map((x) => x.trim());
      hits.push({ id: `osm:${n.place_id}`, name: n.name || parts[0] || text, label: parts.slice(1, 4).join(", "), lat, lon, kind: n.addresstype === "road" || n.addresstype === "building" ? "address" : "place", countryCode: n.address?.country_code?.toUpperCase() ?? null });
    }
  } catch {
    /* both providers failed → whatever we have */
  }
  return hits.slice(0, 8);
}

interface NomReverse {
  name?: string;
  display_name?: string;
  error?: string;
  address?: Record<string, string | undefined>;
}

export function reverseGeocode(lat: number, lon: number): Promise<PlaceInfo> {
  return persisted(`nom-r2:${lat.toFixed(2)},${lon.toFixed(2)}`, 30 * 86_400_000, async () => {
    const r = await polite(() => fetchJson<NomReverse>(`${NOMINATIM}/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&format=jsonv2&zoom=10&addressdetails=1`, 8000, { headers: UA }));
    if (r.error) return { name: null, displayName: null, locality: null, admin2: null, admin1: null, country: null, countryCode: null };
    const a = r.address ?? {};
    const locality = a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb ?? a.county ?? null;
    return {
      // prefer the town/city over tiny wards (e.g. Jakarta rather than "Kenari")
      name: a.city ?? a.town ?? a.village ?? a.municipality ?? (r.name || locality || a.state_district || a.state || null),
      displayName: r.display_name ?? null,
      locality,
      admin2: a.state_district ?? a.county ?? null,
      admin1: a.state ?? a.region ?? a.province ?? null,
      country: a.country ?? null,
      countryCode: a.country_code?.toUpperCase() ?? null,
    };
  }, { negativeTtlMs: 2 * 60_000 });
}
