/**
 * Open-Meteo family of free, key-less APIs (open-meteo.com, CC BY 4.0):
 *  - Forecast API      → hourly rain/temp/humidity/wind/soil moisture
 *  - Flood API         → GloFAS v4 river discharge (Copernicus EMS)
 *  - Marine API        → sea level height (tidal + surge proxy for salinity)
 *  - Elevation API     → Copernicus DEM GLO-90
 *  - Archive API       → ERA5 reanalysis history
 *  - Geocoding API     → place search
 * Multi-location requests are batched into a single HTTP call.
 */
import { cached, fetchJson } from "./http";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const FLOOD = "https://flood-api.open-meteo.com/v1/flood";
const MARINE = "https://marine-api.open-meteo.com/v1/marine";
const ELEVATION = "https://api.open-meteo.com/v1/elevation";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";

export interface Point {
  lat: number;
  lon: number;
}

export interface HourlyForecast {
  time: string[];
  precipitation: number[];
  precipitation_probability: number[];
  temperature_2m: number[];
  relative_humidity_2m: number[];
  wind_speed_10m: number[];
  soil_moisture_0_to_7cm: number[];
}

export interface ForecastResult {
  latitude: number;
  longitude: number;
  elevation: number;
  current?: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    precipitation: number;
    wind_speed_10m: number;
    weather_code: number;
    cloud_cover: number;
  };
  hourly: HourlyForecast;
  daily: {
    time: string[];
    precipitation_sum: number[];
    precipitation_probability_max: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    et0_fao_evapotranspiration: number[];
  };
}

const coordKey = (pts: Point[]) => pts.map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join("|");
const join = (pts: Point[], k: "lat" | "lon") => pts.map((p) => p[k].toFixed(4)).join(",");
const asArray = <T,>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

export function getForecast(points: Point[], days = 7): Promise<ForecastResult[]> {
  return cached(`fc:${days}:${coordKey(points)}`, 20 * 60_000, async () => {
    const url =
      `${FORECAST}?latitude=${join(points, "lat")}&longitude=${join(points, "lon")}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code,cloud_cover` +
      `&hourly=precipitation,precipitation_probability,temperature_2m,relative_humidity_2m,wind_speed_10m,soil_moisture_0_to_7cm` +
      `&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration` +
      `&forecast_days=${days}&past_days=1&timezone=auto&wind_speed_unit=kmh`;
    return asArray(await fetchJson<ForecastResult | ForecastResult[]>(url, 12000));
  });
}

export interface FloodResult {
  daily: { time: string[]; river_discharge: (number | null)[]; river_discharge_mean: (number | null)[]; river_discharge_max: (number | null)[] };
}

/** GloFAS river discharge (m³/s) — 7-day forecast plus ensemble mean/max. */
export function getRiverDischarge(points: Point[], days = 7): Promise<FloodResult[]> {
  return cached(`flood:${days}:${coordKey(points)}`, 60 * 60_000, async () => {
    const url =
      `${FLOOD}?latitude=${join(points, "lat")}&longitude=${join(points, "lon")}` +
      `&daily=river_discharge,river_discharge_mean,river_discharge_max&past_days=30&forecast_days=${days}`;
    return asArray(await fetchJson<FloodResult | FloodResult[]>(url, 12000));
  });
}

export interface MarineResult {
  hourly: { time: string[]; sea_level_height_msl: (number | null)[]; wave_height: (number | null)[] };
}

/** Sea level height incl. tides — drives saltwater push up tidal rivers. */
export function getSeaLevel(points: Point[]): Promise<MarineResult[]> {
  return cached(`marine:${coordKey(points)}`, 60 * 60_000, async () => {
    const url =
      `${MARINE}?latitude=${join(points, "lat")}&longitude=${join(points, "lon")}` +
      `&hourly=sea_level_height_msl,wave_height&forecast_days=3`;
    return asArray(await fetchJson<MarineResult | MarineResult[]>(url, 12000));
  });
}

export function getElevation(points: Point[]): Promise<number[]> {
  return cached(`elev:${coordKey(points)}`, 24 * 3600_000, async () => {
    const r = await fetchJson<{ elevation: number[] }>(
      `${ELEVATION}?latitude=${join(points, "lat")}&longitude=${join(points, "lon")}`,
      8000
    );
    return r.elevation;
  });
}

export interface ArchiveResult {
  daily: { time: string[]; precipitation_sum: (number | null)[]; temperature_2m_mean: (number | null)[] };
}

/** ERA5 reanalysis daily history, e.g. 90 days for the historical charts. */
export function getHistory(point: Point, days = 90): Promise<ArchiveResult> {
  const end = new Date(Date.now() - 5 * 86_400_000); // ERA5 lags ~5 days
  const start = new Date(end.getTime() - days * 86_400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return cached(`hist:${days}:${coordKey([point])}:${d(end)}`, 12 * 3600_000, () =>
    fetchJson<ArchiveResult>(
      `${ARCHIVE}?latitude=${point.lat}&longitude=${point.lon}&start_date=${d(start)}&end_date=${d(end)}` +
        `&daily=precipitation_sum,temperature_2m_mean&timezone=auto`,
      15000
    )
  );
}

export interface GeoHit {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
  elevation?: number;
}

export function geocode(query: string): Promise<GeoHit[]> {
  return cached(`geo:${query.toLowerCase()}`, 24 * 3600_000, async () => {
    const r = await fetchJson<{ results?: GeoHit[] }>(
      `${GEOCODE}?name=${encodeURIComponent(query)}&count=6&language=en&format=json`,
      6000
    );
    return r.results ?? [];
  });
}

/** WMO weather code → human label */
export function weatherLabel(code: number | undefined): string {
  if (code === undefined) return "—";
  if (code === 0) return "Clear sky";
  if (code <= 3) return ["Mainly clear", "Partly cloudy", "Overcast"][code - 1]!;
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}
