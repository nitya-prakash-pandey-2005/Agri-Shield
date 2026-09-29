/**
 * Live health probes for every free/open data source the platform depends on.
 * Each probe is a tiny real request with a hard timeout; results are cached for
 * 60 s (MyMemory for 10 min to respect its free quota) and the last successful
 * probe per source is remembered for the admin "Data Sources" view.
 */
import { cached, OFFLINE } from "../live/http";
import { mlHealth, ML_API_URL } from "../ml-client";

export type SourceStatus = "up" | "degraded" | "down" | "offline";

export interface SourceHealth {
  id: string;
  name: string;
  provider: string;
  category: "weather" | "hydrology" | "ocean" | "terrain" | "hazards" | "satellite" | "soil" | "translation" | "economics" | "ml";
  usedFor: string;
  url: string;
  status: SourceStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  checkedAt: Date;
  lastSuccessAt: Date | null;
  error: string | null;
  docs: string;
}

interface ProbeDef {
  id: string;
  name: string;
  provider: string;
  category: SourceHealth["category"];
  usedFor: string;
  url: () => string;
  docs: string;
  timeoutMs?: number;
  ttlMs?: number;
  /** response latency above this is "degraded" */
  slowMs?: number;
}

const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export const PROBES: ProbeDef[] = [
  { id: "open-meteo-forecast", name: "Open-Meteo Forecast", provider: "Open-Meteo (ECMWF/GFS/ICON blend)", category: "weather", usedFor: "72 h rainfall, soil moisture, temperature — district flood scoring", url: () => "https://api.open-meteo.com/v1/forecast?latitude=22.70&longitude=90.36&current=temperature_2m,precipitation", docs: "https://open-meteo.com/en/docs" },
  { id: "open-meteo-flood", name: "Open-Meteo Flood (GloFAS v4)", provider: "Copernicus EMS GloFAS via Open-Meteo", category: "hydrology", usedFor: "River discharge vs 30-day mean", url: () => "https://flood-api.open-meteo.com/v1/flood?latitude=22.70&longitude=90.36&daily=river_discharge&forecast_days=1", docs: "https://open-meteo.com/en/docs/flood-api" },
  { id: "open-meteo-marine", name: "Open-Meteo Marine", provider: "Open-Meteo (ECMWF WAM / tides)", category: "ocean", usedFor: "Sea-level height → tidal salinity push", url: () => "https://marine-api.open-meteo.com/v1/marine?latitude=22.20&longitude=90.36&hourly=sea_level_height_msl&forecast_days=1", docs: "https://open-meteo.com/en/docs/marine-weather-api" },
  { id: "open-meteo-elevation", name: "Open-Meteo Elevation", provider: "Copernicus DEM GLO-90", category: "terrain", usedFor: "Field elevation factor in flood model", url: () => "https://api.open-meteo.com/v1/elevation?latitude=22.70&longitude=90.36", docs: "https://open-meteo.com/en/docs/elevation-api" },
  { id: "open-meteo-archive", name: "Open-Meteo Archive (ERA5)", provider: "ECMWF ERA5 reanalysis", category: "weather", usedFor: "90-day rainfall history, seed weather_readings", url: () => `https://archive-api.open-meteo.com/v1/archive?latitude=22.70&longitude=90.36&start_date=${day(-10)}&end_date=${day(-8)}&daily=precipitation_sum`, docs: "https://open-meteo.com/en/docs/historical-weather-api" },
  { id: "gdacs", name: "GDACS", provider: "UN OCHA / EC JRC", category: "hazards", usedFor: "Live flood / cyclone / drought alerts", url: () => `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL&fromdate=${day(-3)}&todate=${day(0)}&alertlevel=Orange;Red`, docs: "https://www.gdacs.org/", timeoutMs: 9000, slowMs: 4000 },
  { id: "nasa-eonet", name: "NASA EONET v3", provider: "NASA Earth Observatory", category: "hazards", usedFor: "Floods & severe storms event feed", url: () => "https://eonet.gsfc.nasa.gov/api/v3/events?limit=1&category=floods", docs: "https://eonet.gsfc.nasa.gov/docs/v3", timeoutMs: 9000, slowMs: 4000 },
  { id: "nasa-gibs", name: "NASA GIBS WMTS", provider: "NASA EOSDIS", category: "satellite", usedFor: "MODIS true-colour & flood imagery map layers", url: () => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${day(-2)}/GoogleMapsCompatible_Level9/3/3/6.jpg`, docs: "https://nasa-gibs.github.io/gibs-api-docs/" },
  { id: "ornl-modis", name: "ORNL DAAC MODIS Subsets", provider: "NASA ORNL DAAC", category: "satellite", usedFor: "MOD13Q1 250 m NDVI for every district (satellite ingest)", url: () => "https://modis.ornl.gov/rst/api/v1/MOD13Q1/bands", docs: "https://modis.ornl.gov/data/modis_webservice.html", timeoutMs: 12000, slowMs: 5000 },
  { id: "soilgrids", name: "ISRIC SoilGrids 2.0", provider: "ISRIC World Soil Information", category: "soil", usedFor: "Soil pH / texture priors for salinity model", url: () => "https://rest.isric.org/soilgrids/v2.0/properties/query?lon=90.36&lat=22.70&property=phh2o&depth=0-5cm&value=mean", docs: "https://rest.isric.org/", timeoutMs: 12000, slowMs: 6000 },
  { id: "soilgrids-wms", name: "ISRIC SoilGrids 2.0 (WMS)", provider: "ISRIC World Soil Information", category: "soil", usedFor: "Fallback point queries when the SoilGrids REST API is unavailable", url: () => "https://maps.isric.org/mapserv?map=/map/phh2o.map&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities", docs: "https://maps.isric.org/", timeoutMs: 12000, slowMs: 6000 },
  { id: "mymemory", name: "MyMemory Translation", provider: "Translated srl", category: "translation", usedFor: "Alert + SMS translation (fallback when no DeepL key)", url: () => "https://api.mymemory.translated.net/get?q=flood&langpair=en|bn", docs: "https://mymemory.translated.net/doc/spec.php", ttlMs: 10 * 60_000 },
  { id: "world-bank", name: "World Bank Open Data", provider: "World Bank", category: "economics", usedFor: "Agricultural land share / GDP context in reports", url: () => "https://api.worldbank.org/v2/country/BD/indicator/AG.LND.AGRI.ZS?format=json&per_page=1", docs: "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392" },
];

const g = globalThis as unknown as { __agriSourceOk?: Map<string, Date> };
const lastOk: Map<string, Date> = (g.__agriSourceOk ??= new Map());

export function markSourceSuccess(id: string) {
  lastOk.set(id, new Date());
}

async function probe(def: ProbeDef): Promise<SourceHealth> {
  const base = { id: def.id, name: def.name, provider: def.provider, category: def.category, usedFor: def.usedFor, url: def.url().split("?")[0]!, docs: def.docs };
  if (OFFLINE) return { ...base, status: "offline", httpStatus: null, latencyMs: null, checkedAt: new Date(), lastSuccessAt: lastOk.get(def.id) ?? null, error: "AGRI_OFFLINE=true" };
  const ctrl = new AbortController();
  const timeout = def.timeoutMs ?? 7000;
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const t0 = Date.now();
  try {
    const res = await fetch(def.url(), { signal: ctrl.signal, cache: "no-store", headers: { "User-Agent": "Agri-SHIELD/1.0 health-probe" } });
    await res.arrayBuffer().catch(() => null);
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { ...base, status: res.status >= 500 ? "down" : "degraded", httpStatus: res.status, latencyMs, checkedAt: new Date(), lastSuccessAt: lastOk.get(def.id) ?? null, error: `HTTP ${res.status}` };
    lastOk.set(def.id, new Date());
    return { ...base, status: latencyMs > (def.slowMs ?? 3000) ? "degraded" : "up", httpStatus: res.status, latencyMs, checkedAt: new Date(), lastSuccessAt: lastOk.get(def.id)!, error: null };
  } catch (e) {
    const err = (e as Error).name === "AbortError" ? `timeout after ${timeout} ms` : (e as Error).message;
    return { ...base, status: "down", httpStatus: null, latencyMs: null, checkedAt: new Date(), lastSuccessAt: lastOk.get(def.id) ?? null, error: err };
  } finally {
    clearTimeout(timer);
  }
}

async function probeMl(): Promise<SourceHealth> {
  const h = await mlHealth();
  if (h.up) lastOk.set("ml-api", new Date());
  return {
    id: "ml-api",
    name: "Agri-SHIELD ML API",
    provider: "FastAPI (apps/ml-api)",
    category: "ml",
    usedFor: "Flood / salinity inference, RAG advisor, supply-chain Monte Carlo",
    url: ML_API_URL,
    status: h.up ? ((h.latencyMs ?? 0) > 1500 ? "degraded" : "up") : "down",
    httpStatus: h.up ? 200 : null,
    latencyMs: h.latencyMs,
    checkedAt: new Date(),
    lastSuccessAt: lastOk.get("ml-api") ?? null,
    error: h.up ? null : "unreachable — web formula fallback active",
    docs: `${ML_API_URL}/docs`,
  };
}

/** All probes in parallel; cached 60 s (per-probe TTL overrides). */
export async function checkSources(force = false): Promise<SourceHealth[]> {
  const results = await Promise.all([
    ...PROBES.map((p) => (force && p.id !== "mymemory" ? probe(p) : cached(`health:${p.id}`, p.ttlMs ?? 60_000, () => probe(p)))),
    force ? probeMl() : cached("health:ml-api", 30_000, probeMl),
  ]);
  // Serve the freshest known lastSuccess even from cached entries
  return results.map((r) => ({ ...r, lastSuccessAt: lastOk.get(r.id) ?? r.lastSuccessAt }));
}

export function summarize(sources: SourceHealth[]) {
  const up = sources.filter((s) => s.status === "up").length;
  const degraded = sources.filter((s) => s.status === "degraded").length;
  const down = sources.filter((s) => s.status === "down" || s.status === "offline").length;
  return { total: sources.length, up, degraded, down, status: down === 0 && degraded === 0 ? "operational" : down > sources.length / 2 ? "major_outage" : "degraded" };
}
