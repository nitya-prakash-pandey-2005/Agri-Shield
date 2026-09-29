/**
 * Terrain context from the Copernicus GLO-90 DEM (Open-Meteo elevation API).
 * One request samples 25 points:
 *   - centre + 8 neighbours at ~1 km → local relief, slope and topographic
 *     position (is the site lower than its surroundings? → water collects)
 *   - 16 points on rings at 25 km and 60 km → coast proximity (sea cells = 0 m),
 *     used to decide whether saltwater intrusion is physically plausible.
 */
import { fetchJson } from "./http";
import { persisted } from "./disk-cache";

export interface TerrainInfo {
  elevationM: number;
  reliefM: number;
  slopePct: number;
  /** centre minus mean of 1 km neighbours (negative = hollow / depression) */
  tpiM: number;
  position: "depression" | "flat lowland" | "valley floor" | "slope" | "ridge / high ground";
  coastKm: 25 | 60 | null;
  notes: string[];
}

const KM_PER_DEG = 111.32;

export function ringPoints(lat: number, lon: number, km: number, n: number): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const dLat = (km * Math.cos(a)) / KM_PER_DEG;
    const dLon = (km * Math.sin(a)) / (KM_PER_DEG * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
    out.push({ lat: Math.max(-89.9, Math.min(89.9, lat + dLat)), lon: ((lon + dLon + 540) % 360) - 180 });
  }
  return out;
}

export function classifyTerrain(center: number, near: number[], far25: number[], far60: number[]): TerrainInfo {
  const all = [center, ...near];
  const relief = Math.max(...all) - Math.min(...all);
  const meanNear = near.reduce((s, v) => s + v, 0) / Math.max(1, near.length);
  const tpi = center - meanNear;
  const slopePct = (Math.max(...near.map((v) => Math.abs(v - center))) / 1000) * 100;
  const position: TerrainInfo["position"] =
    tpi <= -3 ? "depression" : tpi >= 8 ? "ridge / high ground" : slopePct >= 5 ? "slope" : center < 20 ? "flat lowland" : "valley floor";
  const isSea = (v: number) => v === 0;
  const coastKm: TerrainInfo["coastKm"] = center !== 0 && far25.some(isSea) ? 25 : far25.concat(far60).some(isSea) ? 60 : null;
  const notes: string[] = [];
  if (center <= 5) notes.push(`Very low-lying (${Math.round(center)} m above sea level) — exposed to river backwater, storm surge and tidal flooding.`);
  else if (center <= 15) notes.push(`Low-lying (${Math.round(center)} m) floodplain elevation.`);
  if (position === "depression") notes.push(`Site sits ${Math.abs(Math.round(tpi))} m below its surroundings — runoff collects here, so waterlogging lasts longer.`);
  if (position === "ridge / high ground") notes.push("Site is higher than its surroundings — river/pluvial flooding is less likely to pond here.");
  if (slopePct >= 8) notes.push(`Steep terrain (~${Math.round(slopePct)}% slope) — heavy rain can trigger runoff, erosion or landslides.`);
  if (coastKm) notes.push(`Coast within ~${coastKm} km — saltwater intrusion and cyclone surge are relevant.`);
  return { elevationM: Math.round(center), reliefM: Math.round(relief), slopePct: Math.round(slopePct * 10) / 10, tpiM: Math.round(tpi * 10) / 10, position, coastKm, notes };
}

export function getTerrain(lat: number, lon: number): Promise<TerrainInfo> {
  return persisted(`terrain:${lat.toFixed(3)},${lon.toFixed(3)}`, 365 * 86_400_000, async () => {
    const near = ringPoints(lat, lon, 1, 8);
    const r25 = ringPoints(lat, lon, 25, 8);
    const r60 = ringPoints(lat, lon, 60, 8);
    const pts = [{ lat, lon }, ...near, ...r25, ...r60];
    const r = await fetchJson<{ elevation: number[] }>(
      `https://api.open-meteo.com/v1/elevation?latitude=${pts.map((p) => p.lat.toFixed(4)).join(",")}&longitude=${pts.map((p) => p.lon.toFixed(4)).join(",")}`,
      8000
    );
    const e = r.elevation;
    if (!e || e.length !== pts.length) throw new Error("elevation service returned incomplete data");
    return classifyTerrain(e[0]!, e.slice(1, 9), e.slice(9, 17), e.slice(17, 25));
  });
}
