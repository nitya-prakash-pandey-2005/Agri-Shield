/**
 * Farm-level weather feeds for the farmer tools (Open-Meteo, CC BY 4.0, no key):
 *  · water-balance feed: daily FAO-56 reference ET0 (`et0_fao_evapotranspiration`),
 *    rain + rain probability for the past 14 and next 8 days, and model soil moisture
 *    (9–27 cm) to initialise the root-zone balance
 *  · nowcast: 15-minutely precipitation for the next 6 hours → "rain arriving in N min"
 *  · RainViewer radar frame index (public API, animated past/nowcast radar tiles)
 */
import { cached, fetchJson } from "../live/http";

const FORECAST = "https://api.open-meteo.com/v1/forecast";

export interface WaterBalanceFeed {
  timezone: string;
  today: string;
  daily: { date: string; et0: number | null; rainMm: number; rainProb: number | null; tMax: number | null; tMin: number | null; forecast: boolean }[];
  soilMoisture: { first: number | null; now: number | null };
  elevation: number | null;
  source: string;
}

interface OmDaily {
  timezone: string;
  utc_offset_seconds: number;
  elevation?: number;
  daily: {
    time: string[];
    et0_fao_evapotranspiration: (number | null)[];
    precipitation_sum: (number | null)[];
    precipitation_probability_max: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
  };
  hourly?: { time: string[]; soil_moisture_9_to_27cm: (number | null)[] };
}

/** Farm-local "today" (YYYY-MM-DD) for a UTC offset. */
export const localToday = (utcOffsetSeconds: number, now = Date.now()) => new Date(now + utcOffsetSeconds * 1000).toISOString().slice(0, 10);

export function getWaterBalanceFeed(lat: number, lon: number): Promise<WaterBalanceFeed> {
  const key = `farm-wb:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return cached(key, 30 * 60_000, async () => {
    const url =
      `${FORECAST}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&daily=et0_fao_evapotranspiration,precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min` +
      `&hourly=soil_moisture_9_to_27cm&past_days=14&forecast_days=8&timezone=auto`;
    const r = await fetchJson<OmDaily>(url, 12000);
    const today = localToday(r.utc_offset_seconds);
    const sm = r.hourly?.soil_moisture_9_to_27cm ?? [];
    const nowIdx = r.hourly ? Math.max(0, r.hourly.time.findIndex((t) => t.slice(0, 10) === today)) : -1;
    return {
      timezone: r.timezone,
      today,
      daily: r.daily.time.map((date, i) => ({
        date,
        et0: r.daily.et0_fao_evapotranspiration[i] ?? null,
        rainMm: r.daily.precipitation_sum[i] ?? 0,
        rainProb: r.daily.precipitation_probability_max[i] ?? null,
        tMax: r.daily.temperature_2m_max[i] ?? null,
        tMin: r.daily.temperature_2m_min[i] ?? null,
        forecast: date >= today,
      })),
      soilMoisture: { first: sm.find((v) => v != null) ?? null, now: nowIdx >= 0 ? sm[nowIdx] ?? null : null },
      elevation: r.elevation ?? null,
      source: "Open-Meteo (FAO-56 ET0, ECMWF/GFS blend)",
    };
  });
}

export interface Nowcast {
  steps: { time: string; mm: number }[];
  /** minutes until the first 15-min step with ≥ 0.2 mm, null if none in 6 h */
  rainInMinutes: number | null;
  raining: boolean;
  totalMm: number;
  peakMmPerHour: number;
  stopsInMinutes: number | null;
  source: string;
}

/** Pure: derive the nowcast hint from 15-minutely precipitation (mm per 15 min). */
export function nowcastFrom(times: string[], mm: (number | null)[], nowLocalIso: string): Nowcast {
  // Open-Meteo 15-min values are sums over the *preceding* 15 minutes: the slot labelled
  // ≥ now is the one in progress.
  const nowKey = nowLocalIso.slice(0, 16);
  const all = times.map((time, i) => ({ time, mm: mm[i] ?? 0 }));
  const idx = all.findIndex((s) => s.time >= nowKey);
  const cur = idx < 0 ? [] : all.slice(idx);
  const WET = 0.2;
  const raining = (cur[0]?.mm ?? 0) >= WET;
  const minsFrom = (t: string) => Math.max(0, Math.round((Date.parse(`${t}:00Z`) - Date.parse(`${nowKey}:00Z`)) / 60_000) - 15);
  const firstWet = cur.find((s) => s.mm >= WET);
  const firstDryAfter = raining ? cur.find((s) => s.mm < WET) : undefined;
  return {
    steps: cur.slice(0, 24).map((s) => ({ time: s.time, mm: Math.round(s.mm * 100) / 100 })),
    rainInMinutes: raining ? 0 : firstWet ? minsFrom(firstWet.time) : null,
    raining,
    totalMm: Math.round(cur.slice(0, 24).reduce((a, s) => a + s.mm, 0) * 10) / 10,
    peakMmPerHour: Math.round(Math.max(0, ...cur.slice(0, 24).map((s) => s.mm * 4)) * 10) / 10,
    stopsInMinutes: firstDryAfter ? minsFrom(firstDryAfter.time) : null,
    source: "Open-Meteo 15-minutely",
  };
}

export function getNowcast(lat: number, lon: number): Promise<Nowcast> {
  return cached(`farm-nowcast:${lat.toFixed(2)},${lon.toFixed(2)}`, 10 * 60_000, async () => {
    const r = await fetchJson<{ utc_offset_seconds: number; minutely_15: { time: string[]; precipitation: (number | null)[] } }>(
      `${FORECAST}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&minutely_15=precipitation&past_minutely_15=1&forecast_minutely_15=25&timezone=auto`,
      10000
    );
    const nowLocal = new Date(Date.now() + r.utc_offset_seconds * 1000).toISOString();
    return nowcastFrom(r.minutely_15.time, r.minutely_15.precipitation, nowLocal);
  });
}

export interface RadarFrames {
  host: string;
  frames: { time: number; path: string; nowcast: boolean }[];
  source: string;
}

export function getRadarFrames(): Promise<RadarFrames> {
  return cached("rainviewer:frames", 5 * 60_000, async () => {
    const r = await fetchJson<{ host: string; radar: { past: { time: number; path: string }[]; nowcast?: { time: number; path: string }[] } }>("https://api.rainviewer.com/public/weather-maps.json", 8000);
    return {
      host: r.host,
      frames: [...r.radar.past.map((f) => ({ ...f, nowcast: false })), ...(r.radar.nowcast ?? []).map((f) => ({ ...f, nowcast: true }))],
      source: "RainViewer",
    };
  });
}
