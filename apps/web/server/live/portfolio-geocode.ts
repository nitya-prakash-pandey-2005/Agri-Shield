/**
 * Address → coordinates (and reverse) for portfolio imports / "add asset".
 *
 *  1. Nominatim (OpenStreetMap) — full street/village addresses. Usage policy:
 *     max 1 request/second, identifying User-Agent → a global 1.1 s throttle queue.
 *  2. Open-Meteo geocoding — fallback on the first address segment (place names).
 * Results are cached for 24 h; failures degrade to null (the import row then
 * reports "could not geocode" instead of failing the batch).
 */
import { cached, fetchJson, OFFLINE } from "./http";
import { geocode as omGeocode } from "./open-meteo";

export interface GeocodeResult {
  lat: number;
  lon: number;
  label: string;
  country: string | null;
  source: "nominatim" | "open-meteo";
}

const UA = { "User-Agent": "Agri-SHIELD/1.0 (portfolio geocoding; contact: ops@agrishield.io)", "Accept-Language": "en" };
const g = globalThis as unknown as { __agriNominatimQ?: Promise<unknown> };

/** Serialise Nominatim calls ≥ 1.1 s apart (process-wide). */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__agriNominatimQ ?? Promise.resolve();
  const next = prev.then(fn, fn);
  g.__agriNominatimQ = next.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100))
  );
  return next;
}

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  address?: { country?: string };
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const q = address.trim();
  if (!q || OFFLINE) return null;
  return cached(`geoaddr:${q.toLowerCase()}`, 24 * 3600_000, async () => {
    try {
      const hits = await throttled(() =>
        fetchJson<NominatimHit[]>(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`, 8000, { headers: UA })
      );
      const h = hits[0];
      if (h) return { lat: Number(h.lat), lon: Number(h.lon), label: h.display_name, country: h.address?.country ?? null, source: "nominatim" as const };
    } catch {
      /* fall through to Open-Meteo */
    }
    const parts = q.split(",").map((s) => s.trim()).filter(Boolean);
    for (const part of parts.slice(0, 2)) {
      try {
        const hits = await omGeocode(part);
        const want = parts.slice(1).map((p) => p.toLowerCase());
        const best = hits.find((x) => want.some((w) => x.country?.toLowerCase().includes(w) || x.admin1?.toLowerCase().includes(w))) ?? hits[0];
        if (best) return { lat: best.latitude, lon: best.longitude, label: [best.name, best.admin1, best.country].filter(Boolean).join(", "), country: best.country ?? null, source: "open-meteo" as const };
      } catch {
        /* next */
      }
    }
    return null;
  });
}

/** Free-text place search for the "add asset" dialog (several candidates). */
export async function searchPlaces(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 2 || OFFLINE) return [];
  return cached(`geosearch:${q.toLowerCase()}`, 6 * 3600_000, async () => {
    const out: GeocodeResult[] = [];
    try {
      const hits = await omGeocode(q);
      for (const h of hits) out.push({ lat: h.latitude, lon: h.longitude, label: [h.name, h.admin1, h.country].filter(Boolean).join(", "), country: h.country ?? null, source: "open-meteo" });
    } catch {
      /* ignore */
    }
    if (out.length < 3) {
      try {
        const hits = await throttled(() => fetchJson<NominatimHit[]>(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(q)}`, 8000, { headers: UA }));
        for (const h of hits) out.push({ lat: Number(h.lat), lon: Number(h.lon), label: h.display_name, country: h.address?.country ?? null, source: "nominatim" });
      } catch {
        /* ignore */
      }
    }
    return out.slice(0, 8);
  });
}

/** Coordinates → country / short label (Nominatim reverse, throttled). */
export async function reverseGeocode(lat: number, lon: number): Promise<{ country: string | null; label: string | null }> {
  if (OFFLINE) return { country: null, label: null };
  return cached(`georev:${lat.toFixed(3)},${lon.toFixed(3)}`, 7 * 24 * 3600_000, async () => {
    try {
      const r = await throttled(() =>
        fetchJson<{ display_name?: string; address?: { country?: string; village?: string; town?: string; city?: string; county?: string; state?: string } }>(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`,
          8000,
          { headers: UA }
        )
      );
      const a = r.address ?? {};
      return { country: a.country ?? null, label: [a.village ?? a.town ?? a.city ?? a.county, a.state].filter(Boolean).join(", ") || r.display_name || null };
    } catch {
      return { country: null, label: null };
    }
  });
}
