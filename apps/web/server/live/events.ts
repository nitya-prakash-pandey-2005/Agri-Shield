/**
 * Live global hazard feeds (free, no key):
 *  - GDACS (UN / EC JRC Global Disaster Alert & Coordination System) — floods & cyclones
 *  - NASA EONET v3 (Earth Observatory Natural Event Tracker) — floods & severe storms
 * Filtered to the Asia-Pacific window Agri-SHIELD monitors.
 */
import { cached, fetchJson } from "./http";

export interface HazardEvent {
  id: string;
  source: "GDACS" | "NASA EONET";
  type: "flood" | "cyclone" | "storm" | "drought" | "other";
  title: string;
  country: string | null;
  alertLevel: "green" | "orange" | "red" | null;
  lat: number;
  lon: number;
  date: string;
  url: string | null;
}

// Rough Asia-Pacific bounding box: lon 60E–150E, lat 15S–40N
const inAsia = (lat: number, lon: number) => lon >= 60 && lon <= 150 && lat >= -15 && lat <= 40;

interface GdacsFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    eventtype: string;
    eventid: number;
    name?: string;
    description?: string;
    country?: string;
    alertlevel?: string;
    fromdate?: string;
    url?: { report?: string };
  };
}

async function gdacs(): Promise<HazardEvent[]> {
  const to = new Date();
  const from = new Date(to.getTime() - 45 * 86_400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const r = await fetchJson<{ features?: GdacsFeature[] }>(
    `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL;TC;DR&fromdate=${d(from)}&todate=${d(to)}&alertlevel=Green;Orange;Red`,
    10000
  );
  return (r.features ?? [])
    .filter((f) => inAsia(f.geometry.coordinates[1], f.geometry.coordinates[0]))
    .map((f) => {
      const p = f.properties;
      return {
        id: `gdacs-${p.eventtype}-${p.eventid}`,
        source: "GDACS" as const,
        type: p.eventtype === "FL" ? "flood" : p.eventtype === "TC" ? "cyclone" : p.eventtype === "DR" ? "drought" : "other",
        title: p.name || p.description || `${p.eventtype} event`,
        country: p.country ?? null,
        alertLevel: (p.alertlevel?.toLowerCase() as HazardEvent["alertLevel"]) ?? null,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        date: p.fromdate ?? to.toISOString(),
        url: p.url?.report ?? null,
      };
    });
}

interface EonetEvent {
  id: string;
  title: string;
  link: string;
  categories: { id: string }[];
  geometry: { date: string; coordinates: [number, number] | number[][][] }[];
}

async function eonet(): Promise<HazardEvent[]> {
  const r = await fetchJson<{ events: EonetEvent[] }>(
    "https://eonet.gsfc.nasa.gov/api/v3/events?category=floods,severeStorms&days=60&status=all&limit=200",
    10000
  );
  const out: HazardEvent[] = [];
  for (const e of r.events) {
    const last = e.geometry[e.geometry.length - 1];
    if (!last) continue;
    const c = last.coordinates as unknown;
    let lon: number, lat: number;
    if (Array.isArray(c) && typeof c[0] === "number") [lon, lat] = c as [number, number];
    else {
      const ring = (c as number[][][])[0]!;
      lon = ring.reduce((s, p) => s + p[0]!, 0) / ring.length;
      lat = ring.reduce((s, p) => s + p[1]!, 0) / ring.length;
    }
    if (!inAsia(lat, lon)) continue;
    out.push({
      id: e.id,
      source: "NASA EONET",
      type: e.categories[0]?.id === "floods" ? "flood" : "storm",
      title: e.title,
      country: null,
      alertLevel: null,
      lat,
      lon,
      date: last.date,
      url: e.link,
    });
  }
  return out;
}

/** Merged, de-duplicated, newest-first. Never throws — returns [] if both feeds are down. */
export function getHazardEvents(): Promise<HazardEvent[]> {
  return cached("hazards", 30 * 60_000, async () => {
    const [a, b] = await Promise.allSettled([gdacs(), eonet()]);
    const all = [...(a.status === "fulfilled" ? a.value : []), ...(b.status === "fulfilled" ? b.value : [])];
    return all.sort((x, y) => +new Date(y.date) - +new Date(x.date)).slice(0, 60);
  }).catch(() => []);
}
