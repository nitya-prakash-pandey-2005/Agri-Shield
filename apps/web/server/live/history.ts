/**
 * Long daily climate history for ANY point on Earth (free, key-less):
 *
 *  Primary  ERA5 reanalysis (ECMWF / Copernicus) via the Open-Meteo archive API
 *           precipitation_sum · temperature_2m_max · et0_fao_evapotranspiration · wind_gusts_10m_max
 *  Fallback NASA POWER daily (MERRA-2, precipitation bias-corrected with IMERG/GPCP) when
 *           the Open-Meteo archive is rate-limited or down; ET0 by Hargreaves–Samani,
 *           gusts ≈ 1.4 × daily max 10 m wind.
 *  Rivers   GloFAS v4 river-discharge reanalysis via the Open-Meteo flood API.
 *
 * Used by the Insurance (parametric backtests, claims evidence), Finance (hazard
 * frequencies for climate-adjusted PD) and Anticipatory Action (trigger backtests).
 *
 * A 35-year daily history is a *heavy* request on the free Open-Meteo tier (~900
 * weighted calls per location), so caching is aggressive:
 *   1. in-process map — 24 h
 *   2. on-disk JSON in the OS temp dir — never re-downloaded in full; when older
 *      than 2 days only the missing tail is fetched and appended
 *   3. one location per upstream request through a small priority queue (2 workers),
 *      with 429 back-off (minutely / hourly / daily) → NASA POWER fallback
 * Set OPEN_METEO_API_KEY to use the commercial customer-* endpoints.
 *
 * Recent days (ERA5 lags ~5 days) and the next 16 days come from the Open-Meteo
 * forecast API; ensemble members (ECMWF IFS 0.25°, 51 members) from the ensemble API.
 * CMIP6 HighResMIP daily projections (SSP5-8.5 forcing) from the climate API.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cached, fetchJson, OFFLINE, withProviderKeys } from "./http";

const KEY = process.env.OPEN_METEO_API_KEY;
const om = (host: string) => (KEY ? `https://customer-${host}.open-meteo.com` : `https://${host}.open-meteo.com`);
const withKey = (url: string) => (KEY ? `${url}&apikey=${encodeURIComponent(KEY)}` : url);
const ARCHIVE = `${om("archive-api")}/v1/archive`;
const FLOOD = `${om("flood-api")}/v1/flood`;
const FORECAST = `${om("api")}/v1/forecast`;
const ENSEMBLE = `${om("ensemble-api")}/v1/ensemble`;
const CLIMATE = `${om("climate-api")}/v1/climate`;
const POWER = "https://power.larc.nasa.gov/api/temporal/daily/point";

/** First year fetched. Backtests may slice a later start. GloFAS reanalysis starts 1984, ERA5 1940. */
export const HISTORY_START_YEAR = 1991;
const DAY_MS = 86_400_000;

export interface HistoryPoint {
  lat: number;
  lon: number;
}

export type HistoryProvider = "ERA5" | "NASA POWER";

export interface DailyHistory {
  /** Requested point (rounded to the cache grid) */
  lat: number;
  lon: number;
  provider: HistoryProvider;
  /** ERA5 / GloFAS grid cell actually used */
  era5Cell: { lat: number; lon: number } | null;
  glofasCell: { lat: number; lon: number } | null;
  elevationM: number | null;
  time: string[]; // YYYY-MM-DD, contiguous days
  rain: (number | null)[]; // mm/day
  tmax: (number | null)[]; // °C
  et0: (number | null)[]; // mm/day reference evapotranspiration
  gust: (number | null)[]; // km/h daily max wind gust
  /** GloFAS daily discharge m³/s aligned with `time` (null where unavailable) */
  discharge: (number | null)[] | null;
  fetchedAt: string;
  source: "live" | "disk-cache" | "stale-cache";
}

export interface RecentForecast {
  time: string[];
  rain: (number | null)[];
  tmax: (number | null)[];
  et0: (number | null)[];
  gust: (number | null)[];
  /** index of today in `time` — values before it are recent analysis, from it on forecast */
  todayIdx: number;
  discharge: { time: string[]; values: (number | null)[]; todayIdx: number } | null;
}

export interface RainEnsemble {
  time: string[];
  /** members[m][d] mm/day */
  members: number[][];
  model: string;
}

// ─── Grid + disk cache helpers ────────────────────────────────────────────

const round = (v: number, step: number) => Math.round(v / step) * step;
/** 0.05° ≈ GloFAS grid; also fine-grained enough for ERA5 (0.25°). */
export const gridKey = (p: HistoryPoint) => `${round(p.lat, 0.05).toFixed(2)},${round(p.lon, 0.05).toFixed(2)}`;
const snap = (p: HistoryPoint): HistoryPoint => ({ lat: Number(round(p.lat, 0.05).toFixed(2)), lon: Number(round(p.lon, 0.05).toFixed(2)) });

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Last ERA5 day we request (archive lags ~5 days behind real time). */
export const era5EndDate = (now = Date.now()) => iso(new Date(now - 6 * DAY_MS));

const CACHE_DIR = path.join(os.tmpdir(), "agri-shield-cache", "history");
const TAIL_REFRESH_MS = 2 * DAY_MS;
const fileOf = (key: string) => `h_${key.replace(",", "_")}.json`;

async function readDisk<T>(name: string): Promise<{ value: T; mtime: number } | null> {
  try {
    const file = path.join(CACHE_DIR, name);
    const [raw, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    return { value: JSON.parse(raw) as T, mtime: st.mtimeMs };
  } catch {
    return null;
  }
}

async function writeDisk(name: string, value: unknown) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, name), JSON.stringify(value));
  } catch {
    /* disk cache is best-effort */
  }
}

const asArray = <T,>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

// ─── Upstream fetchers (one location each) ───────────────────────────────

class RateLimited extends Error {
  constructor(
    public scope: "minute" | "hour" | "day",
    msg: string
  ) {
    super(msg);
  }
}
/** Earliest time each host may be called again (after a 429). */
const blockedUntil: Record<"archive" | "flood", number> = { archive: 0, flood: 0 };

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  if (OFFLINE) throw new Error("offline mode");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(withProviderKeys(url), { signal: ctrl.signal, headers: { "User-Agent": "Agri-SHIELD/1.0 (climate risk research)", Accept: "application/json" }, cache: "no-store" });
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      const reason = body.reason ?? "rate limited";
      throw new RateLimited(/daily/i.test(reason) ? "day" : /hourly/i.test(reason) ? "hour" : "minute", reason);
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.split("?")[0]}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function block(host: "archive" | "flood", e: RateLimited) {
  const now = new Date();
  const until = e.scope === "minute" ? now.getTime() + 65_000 : e.scope === "hour" ? now.getTime() + 61 * 60_000 : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5);
  blockedUntil[host] = Math.max(blockedUntil[host], until);
}

interface WeatherPart {
  provider: HistoryProvider;
  cell: { lat: number; lon: number } | null;
  elevationM: number | null;
  time: string[];
  rain: (number | null)[];
  tmax: (number | null)[];
  et0: (number | null)[];
  gust: (number | null)[];
}

async function fetchEra5(p: HistoryPoint, start: string, end: string): Promise<WeatherPart> {
  const r = await getJson<{
    latitude: number;
    longitude: number;
    elevation?: number;
    daily: { time: string[]; precipitation_sum: (number | null)[]; temperature_2m_max: (number | null)[]; et0_fao_evapotranspiration: (number | null)[]; wind_gusts_10m_max: (number | null)[] };
  }>(
    withKey(
      `${ARCHIVE}?latitude=${p.lat.toFixed(2)}&longitude=${p.lon.toFixed(2)}&start_date=${start}&end_date=${end}&daily=precipitation_sum,temperature_2m_max,et0_fao_evapotranspiration,wind_gusts_10m_max&timezone=GMT`
    ),
    45_000
  );
  return { provider: "ERA5", cell: { lat: r.latitude, lon: r.longitude }, elevationM: r.elevation ?? null, time: r.daily.time, rain: r.daily.precipitation_sum, tmax: r.daily.temperature_2m_max, et0: r.daily.et0_fao_evapotranspiration, gust: r.daily.wind_gusts_10m_max };
}

/** FAO-56 extraterrestrial radiation (mm/day equivalent) for Hargreaves ET0. */
export function extraterrestrialMm(latDeg: number, doy: number): number {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  const ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws)); // MJ m-2 d-1
  return 0.408 * ra;
}

/** Hargreaves–Samani (1985) reference ET0, mm/day. */
export function hargreavesEt0(tmax: number, tmin: number, latDeg: number, doy: number): number {
  const tmean = (tmax + tmin) / 2;
  return Math.max(0, 0.0023 * extraterrestrialMm(latDeg, doy) * (tmean + 17.8) * Math.sqrt(Math.max(0, tmax - tmin)));
}

async function fetchPower(p: HistoryPoint, start: string, end: string): Promise<WeatherPart> {
  const s = start.replace(/-/g, "");
  const e = end.replace(/-/g, "");
  const r = await getJson<{ geometry?: { coordinates?: number[] }; properties: { parameter: Record<string, Record<string, number>> } }>(
    `${POWER}?parameters=PRECTOTCORR,T2M_MAX,T2M_MIN,WS10M_MAX&community=AG&longitude=${p.lon.toFixed(3)}&latitude=${p.lat.toFixed(3)}&start=${s}&end=${e}&format=JSON`,
    60_000
  );
  const P = r.properties.parameter;
  const keys = Object.keys(P.PRECTOTCORR ?? {}).sort();
  const v = (k: string, d: string) => {
    const x = P[k]?.[d];
    return x == null || x <= -998 ? null : x;
  };
  const time: string[] = [];
  const rain: (number | null)[] = [];
  const tmax: (number | null)[] = [];
  const et0: (number | null)[] = [];
  const gust: (number | null)[] = [];
  for (const d of keys) {
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const doy = Math.floor((Date.parse(date) - Date.UTC(Number(d.slice(0, 4)), 0, 0)) / DAY_MS);
    const tx = v("T2M_MAX", d);
    const tn = v("T2M_MIN", d);
    const ws = v("WS10M_MAX", d);
    time.push(date);
    rain.push(v("PRECTOTCORR", d));
    tmax.push(tx);
    et0.push(tx != null && tn != null ? Math.round(hargreavesEt0(tx, tn, p.lat, doy) * 100) / 100 : null);
    gust.push(ws == null ? null : Math.round(ws * 3.6 * 1.4 * 10) / 10);
  }
  return { provider: "NASA POWER", cell: null, elevationM: r.geometry?.coordinates?.[2] ?? null, time, rain, tmax, et0, gust };
}

async function fetchGlofas(p: HistoryPoint, start: string, end: string): Promise<{ cell: { lat: number; lon: number }; time: string[]; values: (number | null)[] } | null> {
  if (Date.now() < blockedUntil.flood) return null;
  try {
    const r = await getJson<{ latitude: number; longitude: number; daily: { time: string[]; river_discharge: (number | null)[] } }>(
      withKey(`${FLOOD}?latitude=${p.lat.toFixed(2)}&longitude=${p.lon.toFixed(2)}&start_date=${start}&end_date=${end}&daily=river_discharge`),
      45_000
    );
    return r.daily?.time?.length ? { cell: { lat: r.latitude, lon: r.longitude }, time: r.daily.time, values: r.daily.river_discharge } : null;
  } catch (e) {
    if (e instanceof RateLimited) block("flood", e);
    return null;
  }
}

/** Weather for [start, end]: ERA5 unless the archive is blocked/failing (or `prefer` says POWER). */
async function fetchWeather(p: HistoryPoint, start: string, end: string, prefer?: HistoryProvider): Promise<WeatherPart> {
  if (prefer !== "NASA POWER" && Date.now() >= blockedUntil.archive) {
    try {
      return await fetchEra5(p, start, end);
    } catch (e) {
      if (e instanceof RateLimited) block("archive", e);
      if (prefer === "ERA5") throw e; // tail update must stay on the same provider
    }
  } else if (prefer === "ERA5") throw new Error("ERA5 archive temporarily rate-limited");
  return fetchPower(p, start, end);
}

function trimTrailingNulls(w: WeatherPart) {
  while (w.time.length && w.rain[w.rain.length - 1] == null) {
    w.time.pop();
    w.rain.pop();
    w.tmax.pop();
    w.et0.pop();
    w.gust.pop();
  }
}

function alignDischarge(time: string[], g: { time: string[]; values: (number | null)[] } | null): (number | null)[] | null {
  if (!g) return null;
  const idx = new Map(g.time.map((t, i) => [t, i]));
  const out = time.map((t) => {
    const i = idx.get(t);
    return i == null ? null : (g.values[i] ?? null);
  });
  return out.some((v) => v != null && v > 0) ? out : null;
}

/** Full download, or tail-append onto a cached record. */
async function loadOne(key: string, p: HistoryPoint): Promise<DailyHistory | null> {
  const end = era5EndDate();
  const start = `${HISTORY_START_YEAR}-01-01`;
  const disk = await readDisk<DailyHistory>(fileOf(key));
  const cachedOk = !!disk && disk.value.time?.[0] === start;
  if (disk && cachedOk) disk.value.provider ??= "ERA5"; // records written before the provider field existed
  if (disk && cachedOk && Date.now() - disk.mtime < TAIL_REFRESH_MS) return { ...disk.value, source: "disk-cache" };
  if (OFFLINE) return disk && cachedOk ? { ...disk.value, source: "stale-cache" } : null;
  if (disk && cachedOk) {
    // incremental tail update — a few days of data, trivially cheap
    const h = disk.value;
    const last = h.time[h.time.length - 1]!;
    const from = iso(new Date(Date.parse(last) + DAY_MS));
    if (from > end) {
      void writeDisk(fileOf(key), h); // touch
      return { ...h, source: "disk-cache" };
    }
    try {
      const [w, g] = await Promise.all([fetchWeather(p, from, end, h.provider), h.discharge ? fetchGlofas(p, from, end) : Promise.resolve(null)]);
      trimTrailingNulls(w);
      const add = w.time.length;
      const merged: DailyHistory = {
        ...h,
        time: [...h.time, ...w.time],
        rain: [...h.rain, ...w.rain],
        tmax: [...h.tmax, ...w.tmax],
        et0: [...h.et0, ...w.et0],
        gust: [...h.gust, ...w.gust],
        discharge: h.discharge ? [...h.discharge, ...(alignDischarge(w.time, g) ?? new Array<number | null>(add).fill(null))] : null,
        fetchedAt: new Date().toISOString(),
        source: "live",
      };
      await writeDisk(fileOf(key), merged);
      return merged;
    } catch {
      return { ...h, source: "stale-cache" };
    }
  }
  try {
    const [w, g] = await Promise.all([fetchWeather(p, start, end), fetchGlofas(p, start, end)]);
    trimTrailingNulls(w);
    const h: DailyHistory = {
      lat: p.lat,
      lon: p.lon,
      provider: w.provider,
      era5Cell: w.cell,
      glofasCell: g?.cell ?? null,
      elevationM: w.elevationM,
      time: w.time,
      rain: w.rain,
      tmax: w.tmax,
      et0: w.et0,
      gust: w.gust,
      discharge: alignDischarge(w.time, g),
      fetchedAt: new Date().toISOString(),
      source: "live",
    };
    if (h.time.length < 3650) return null;
    await writeDisk(fileOf(key), h);
    return h;
  } catch {
    return disk?.value ? { ...disk.value, source: "stale-cache" } : null;
  }
}

// ─── Priority queue (2 workers) ───────────────────────────────────────────

interface Job {
  key: string;
  p: HistoryPoint;
  prio: number;
  done: ((v: DailyHistory | null) => void)[];
}
const gq = globalThis as unknown as { __agriHistQ?: { jobs: Job[]; workers: number; mem: Map<string, { v: DailyHistory; exp: number }>; running: Map<string, Promise<DailyHistory | null>> } };
const Q = (gq.__agriHistQ ??= { jobs: [] as Job[], workers: 0, mem: new Map<string, { v: DailyHistory; exp: number }>(), running: new Map<string, Promise<DailyHistory | null>>() });

function memGet(key: string): DailyHistory | null {
  const hit = Q.mem.get(key);
  return hit && hit.exp > Date.now() ? hit.v : null;
}
function memSet(key: string, v: DailyHistory) {
  Q.mem.set(key, { v, exp: Date.now() + 24 * 3600_000 });
  if (Q.mem.size > 400) Q.mem.delete(Q.mem.keys().next().value!);
}

function enqueue(key: string, p: HistoryPoint, prio: number): Promise<DailyHistory | null> {
  const existing = Q.jobs.find((j) => j.key === key);
  const pr = new Promise<DailyHistory | null>((resolve) => {
    if (existing) {
      existing.prio = Math.max(existing.prio, prio);
      existing.done.push(resolve);
    } else Q.jobs.push({ key, p, prio, done: [resolve] });
  });
  pump();
  return pr;
}

function pump() {
  while (Q.workers < 2 && Q.jobs.length) {
    Q.jobs.sort((a, b) => b.prio - a.prio);
    const job = Q.jobs.shift()!;
    Q.workers++;
    const run = loadOne(job.key, job.p)
      .catch(() => null)
      .then((v) => {
        if (v) memSet(job.key, v);
        for (const d of job.done) d(v);
        return v;
      })
      .finally(() => {
        Q.running.delete(job.key);
        Q.workers--;
        pump();
      });
    Q.running.set(job.key, run);
  }
}

export interface HistoryBatch {
  map: Map<string, DailyHistory>;
  /** locations still downloading in the background */
  pending: number;
  total: number;
  providers: HistoryProvider[];
}

/**
 * Daily history (1991 → ~6 days ago) for many points, keyed by `gridKey(point)`.
 * mode "wait"    — resolve when every point is loaded (or failed)
 * mode "partial" — return whatever is ready within `budgetMs`; the rest keeps
 *                  downloading in the background (poll again for progress)
 */
export async function getHistoryBatch(points: HistoryPoint[], opts: { mode?: "wait" | "partial"; budgetMs?: number; prio?: number } = {}): Promise<HistoryBatch> {
  const map = new Map<string, DailyHistory>();
  const uniq = new Map<string, HistoryPoint>();
  for (const p of points) uniq.set(gridKey(p), snap(p));
  const waits: Promise<unknown>[] = [];
  for (const [key, p] of uniq) {
    const m = memGet(key);
    if (m) {
      map.set(key, m);
      continue;
    }
    const pr = Q.running.get(key) ?? enqueue(key, p, opts.prio ?? (opts.mode === "partial" ? 0 : 10));
    waits.push(pr.then((v) => v && map.set(key, v)));
  }
  if (waits.length) {
    const all = Promise.all(waits);
    if (opts.mode === "partial") await Promise.race([all, new Promise((r) => setTimeout(r, opts.budgetMs ?? 8000))]);
    else await all;
  }
  return { map: new Map(map), pending: uniq.size - map.size, total: uniq.size, providers: [...new Set([...map.values()].map((h) => h.provider))] };
}

export async function getHistoryMany(points: HistoryPoint[]): Promise<Map<string, DailyHistory>> {
  return (await getHistoryBatch(points, { mode: "wait" })).map;
}

export async function getDailyHistory(point: HistoryPoint): Promise<DailyHistory | null> {
  const m = await getHistoryMany([point]);
  return m.get(gridKey(point)) ?? null;
}

export function historyQueueStats() {
  return { queued: Q.jobs.length, running: Q.workers, archiveBlockedUntil: blockedUntil.archive > Date.now() ? new Date(blockedUntil.archive).toISOString() : null };
}

// ─── Recent analysis + 16-day forecast ────────────────────────────────────

interface ForecastResp {
  daily: { time: string[]; precipitation_sum: (number | null)[]; temperature_2m_max: (number | null)[]; et0_fao_evapotranspiration: (number | null)[]; wind_gusts_10m_max: (number | null)[] };
}
interface FloodFcResp {
  daily: { time: string[]; river_discharge: (number | null)[] };
}

/** Last 14 days (model analysis, fills the ERA5 lag) + next 16 days, batched for many points. */
export async function getRecentForecastMany(points: HistoryPoint[]): Promise<Map<string, RecentForecast>> {
  const out = new Map<string, RecentForecast>();
  const uniq = new Map<string, HistoryPoint>();
  for (const p of points) uniq.set(gridKey(p), snap(p));
  const entries = [...uniq];
  const today = iso(new Date());
  for (let i = 0; i < entries.length; i += 40) {
    const chunk = entries.slice(i, i + 40);
    const lats = chunk.map((c) => c[1].lat.toFixed(2)).join(",");
    const lons = chunk.map((c) => c[1].lon.toFixed(2)).join(",");
    const key = chunk.map((c) => c[0]).join("|");
    const [fc, fl] = await Promise.allSettled([
      cached(`recentfc:${key}`, 30 * 60_000, async () =>
        asArray(
          await fetchJson<ForecastResp | ForecastResp[]>(
            withKey(`${FORECAST}?latitude=${lats}&longitude=${lons}&daily=precipitation_sum,temperature_2m_max,et0_fao_evapotranspiration,wind_gusts_10m_max&past_days=31&forecast_days=16&timezone=GMT`),
            20_000
          )
        )
      ),
      cached(`recentflood:${key}`, 60 * 60_000, async () =>
        asArray(await fetchJson<FloodFcResp | FloodFcResp[]>(withKey(`${FLOOD}?latitude=${lats}&longitude=${lons}&daily=river_discharge&past_days=31&forecast_days=30`), 20_000))
      ),
    ]);
    chunk.forEach(([k], j) => {
      const f = fc.status === "fulfilled" ? fc.value[j] : undefined;
      if (!f) return;
      const d = fl.status === "fulfilled" ? fl.value[j] : undefined;
      out.set(k, {
        time: f.daily.time,
        rain: f.daily.precipitation_sum,
        tmax: f.daily.temperature_2m_max,
        et0: f.daily.et0_fao_evapotranspiration,
        gust: f.daily.wind_gusts_10m_max,
        todayIdx: Math.max(0, f.daily.time.indexOf(today)),
        discharge: d?.daily?.time?.length ? { time: d.daily.time, values: d.daily.river_discharge, todayIdx: Math.max(0, d.daily.time.indexOf(today)) } : null,
      });
    });
  }
  return out;
}

/** ECMWF IFS 0.25° ensemble daily precipitation (51 members, 15 days) for many points. */
export async function getRainEnsembleMany(points: HistoryPoint[]): Promise<Map<string, RainEnsemble>> {
  const out = new Map<string, RainEnsemble>();
  const uniq = new Map<string, HistoryPoint>();
  for (const p of points) uniq.set(gridKey(p), snap(p));
  const entries = [...uniq];
  for (let i = 0; i < entries.length; i += 20) {
    const chunk = entries.slice(i, i + 20);
    const lats = chunk.map((c) => c[1].lat.toFixed(2)).join(",");
    const lons = chunk.map((c) => c[1].lon.toFixed(2)).join(",");
    try {
      const res = await cached(`ens:${chunk.map((c) => c[0]).join("|")}`, 3 * 3600_000, async () =>
        asArray(
          await fetchJson<{ daily: Record<string, (number | null)[] | string[]> } | { daily: Record<string, (number | null)[] | string[]> }[]>(
            withKey(`${ENSEMBLE}?latitude=${lats}&longitude=${lons}&daily=precipitation_sum&models=ecmwf_ifs025&forecast_days=15&timezone=GMT`),
            25_000
          )
        )
      );
      chunk.forEach(([k], j) => {
        const d = res[j]?.daily;
        if (!d) return;
        const time = d.time as string[];
        const members = Object.keys(d)
          .filter((c) => c.startsWith("precipitation_sum"))
          .map((c) => (d[c] as (number | null)[]).map((v) => v ?? 0));
        if (members.length) out.set(k, { time, members, model: "ECMWF IFS 0.25° ENS" });
      });
    } catch {
      /* ensemble optional — callers fall back to the deterministic forecast */
    }
  }
  return out;
}

// ─── CMIP6 projections (HighResMIP, SSP5-8.5 forcing after 2015) ─────────

export interface ClimateShift {
  point: HistoryPoint;
  models: string[];
  baseline: string; // "1995–2014"
  future: string; // "2031–2050"
  /** multiplicative change in annual frequency of heavy-rain days (≥ baseline P99) */
  heavyRainFreqFactor: number;
  /** change in annual total rainfall (ratio) */
  annualRainFactor: number;
  /** change in annual max 5-day rainfall (ratio) */
  rx5dayFactor: number;
  /** change in the number of dry days (< 1 mm) per year (ratio) */
  dryDaysFactor: number;
  /** extra days/yr with Tmax ≥ 35 °C (absolute) and ratio */
  hotDaysDelta: number;
  meanTmaxDeltaC: number;
}

const CMIP_MODELS = ["EC_Earth3P_HR", "MRI_AGCM3_2_S"];

/** Pure: compute change factors from a daily series (exported for tests). */
export function climateShiftFromSeries(time: string[], rain: (number | null)[], tmax: (number | null)[]) {
  const inR = (y: number, a: number, b: number) => y >= a && y <= b;
  const yearOf = (t: string) => Number(t.slice(0, 4));
  const base = time.map((t, i) => (inR(yearOf(t), 1995, 2014) ? i : -1)).filter((i) => i >= 0);
  const fut = time.map((t, i) => (inR(yearOf(t), 2031, 2050) ? i : -1)).filter((i) => i >= 0);
  const vals = (idx: number[], a: (number | null)[]) => idx.map((i) => a[i]).filter((v): v is number => v != null);
  const bRain = vals(base, rain);
  const sorted = [...bRain].sort((a, b) => a - b);
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 50;
  const years = (idx: number[]) => new Set(idx.map((i) => yearOf(time[i]!))).size || 1;
  const count = (idx: number[], pred: (i: number) => boolean) => idx.filter(pred).length / years(idx);
  const heavyB = count(base, (i) => (rain[i] ?? 0) >= p99);
  const heavyF = count(fut, (i) => (rain[i] ?? 0) >= p99);
  const totB = vals(base, rain).reduce((a, b) => a + b, 0) / years(base);
  const totF = vals(fut, rain).reduce((a, b) => a + b, 0) / years(fut);
  const dryB = count(base, (i) => (rain[i] ?? 0) < 1);
  const dryF = count(fut, (i) => (rain[i] ?? 0) < 1);
  const hotB = count(base, (i) => (tmax[i] ?? 0) >= 35);
  const hotF = count(fut, (i) => (tmax[i] ?? 0) >= 35);
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const rx5 = (idx: number[]) => {
    const byYear = new Map<number, number>();
    for (let k = 4; k < idx.length; k++) {
      const i = idx[k]!;
      if (idx[k - 4] !== i - 4) continue;
      const s = (rain[i] ?? 0) + (rain[i - 1] ?? 0) + (rain[i - 2] ?? 0) + (rain[i - 3] ?? 0) + (rain[i - 4] ?? 0);
      const y = yearOf(time[i]!);
      byYear.set(y, Math.max(byYear.get(y) ?? 0, s));
    }
    return mean([...byYear.values()]);
  };
  const safe = (a: number, b: number) => (b > 0 ? a / b : 1);
  return {
    heavyRainFreqFactor: safe(heavyF, heavyB),
    annualRainFactor: safe(totF, totB),
    rx5dayFactor: safe(rx5(fut), rx5(base)),
    dryDaysFactor: safe(dryF, dryB),
    hotDaysDelta: hotF - hotB,
    meanTmaxDeltaC: mean(vals(fut, tmax)) - mean(vals(base, tmax)),
  };
}

/** Multi-model mean change 2031–2050 vs 1995–2014 at a point (cached 30 days on disk). */
export async function getClimateShift(point: HistoryPoint): Promise<ClimateShift | null> {
  const p = { lat: Number(round(point.lat, 0.5).toFixed(1)), lon: Number(round(point.lon, 0.5).toFixed(1)) };
  const name = `cmip_${p.lat}_${p.lon}.json`;
  return cached(`cmip:${p.lat},${p.lon}`, 7 * 24 * 3600_000, async () => {
    const disk = await readDisk<ClimateShift>(name);
    if (disk && Date.now() - disk.mtime < 30 * DAY_MS) return disk.value;
    if (OFFLINE) return disk?.value ?? null;
    const res = await Promise.allSettled(
      CMIP_MODELS.map(async (m) => {
        // two 20-year windows only (baseline + future) — keeps the weighted request cost down
        type R = { daily: { time: string[]; precipitation_sum: (number | null)[]; temperature_2m_max: (number | null)[] } };
        const get = (a: string, b: string) => fetchJson<R>(withKey(`${CLIMATE}?latitude=${p.lat}&longitude=${p.lon}&start_date=${a}&end_date=${b}&models=${m}&daily=precipitation_sum,temperature_2m_max`), 45_000);
        const base = await get("1995-01-01", "2014-12-31");
        const fut = await get("2031-01-01", "2050-12-31");
        const time = [...base.daily.time, ...fut.daily.time];
        return { m, s: climateShiftFromSeries(time, [...base.daily.precipitation_sum, ...fut.daily.precipitation_sum], [...base.daily.temperature_2m_max, ...fut.daily.temperature_2m_max]) };
      })
    );
    const ok = res.filter((r): r is PromiseFulfilledResult<{ m: string; s: ReturnType<typeof climateShiftFromSeries> }> => r.status === "fulfilled").map((r) => r.value);
    if (!ok.length) {
      if (disk?.value) return disk.value;
      throw new Error("CMIP6 projections unavailable"); // not cached — retried next time
    }
    const avg = (k: keyof ReturnType<typeof climateShiftFromSeries>) => ok.reduce((t, o) => t + o.s[k], 0) / ok.length;
    const value: ClimateShift = {
      point: p,
      models: ok.map((o) => o.m),
      baseline: "1995–2014",
      future: "2031–2050",
      heavyRainFreqFactor: avg("heavyRainFreqFactor"),
      annualRainFactor: avg("annualRainFactor"),
      rx5dayFactor: avg("rx5dayFactor"),
      dryDaysFactor: avg("dryDaysFactor"),
      hotDaysDelta: avg("hotDaysDelta"),
      meanTmaxDeltaC: avg("meanTmaxDeltaC"),
    };
    void writeDisk(name, value);
    return value;
  });
}

// ─── MODIS NDVI (ORNL DAAC REST, optional) ────────────────────────────────

export interface NdviSample {
  date: string;
  ndvi: number;
}

const julian = (d: Date) => {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = Math.floor((d.getTime() - start) / DAY_MS);
  return `A${d.getUTCFullYear()}${String(doy).padStart(3, "0")}`;
};

/** MOD13Q1 250 m 16-day NDVI at a point between two dates (≤ 10 samples per ORNL request). */
export async function getNdviSeries(point: HistoryPoint, from: Date, to: Date): Promise<NdviSample[]> {
  const key = `ndvi:${point.lat.toFixed(3)},${point.lon.toFixed(3)}:${iso(from)}:${iso(to)}`;
  return cached(key, 7 * 24 * 3600_000, async () => {
    const url =
      `https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=${point.lat.toFixed(4)}&longitude=${point.lon.toFixed(4)}` +
      `&startDate=${julian(from)}&endDate=${julian(to)}&kmAboveBelow=0&kmLeftRight=0&band=250m_16_days_NDVI`;
    const r = await fetchJson<{ scale?: string; subset?: { calendar_date: string; data: number[] }[] }>(url, 20_000);
    const scale = Number(r.scale ?? "0.0001") || 0.0001;
    return (r.subset ?? [])
      .map((s) => ({ date: s.calendar_date, ndvi: (s.data?.[0] ?? -3000) * scale }))
      .filter((s) => s.ndvi > -0.2 && s.ndvi <= 1);
  });
}

// ─── Series utilities shared by the services ─────────────────────────────

/**
 * Join ERA5 history with the recent-analysis/forecast feed into one contiguous
 * daily series. Returns index of today and of the last "observed" day.
 */
export function mergeHistoryAndForecast(h: DailyHistory, f: RecentForecast | undefined) {
  const time = [...h.time];
  const rain = [...h.rain];
  const tmax = [...h.tmax];
  const et0 = [...h.et0];
  const gust = [...h.gust];
  const discharge = h.discharge ? [...h.discharge] : null;
  // trim trailing nulls in ERA5 (the archive sometimes returns empty last days)
  while (rain.length && rain[rain.length - 1] == null) {
    time.pop();
    rain.pop();
    tmax.pop();
    et0.pop();
    gust.pop();
    discharge?.pop();
  }
  let lastObs = time.length - 1;
  const today = iso(new Date());
  if (f) {
    const lastT = time[time.length - 1] ?? "";
    for (let i = 0; i < f.time.length; i++) {
      if (f.time[i]! <= lastT) continue;
      time.push(f.time[i]!);
      rain.push(f.rain[i] ?? null);
      tmax.push(f.tmax[i] ?? null);
      et0.push(f.et0[i] ?? null);
      gust.push(f.gust[i] ?? null);
      if (discharge) {
        const j = f.discharge ? f.discharge.time.indexOf(f.time[i]!) : -1;
        discharge.push(j >= 0 ? (f.discharge!.values[j] ?? null) : null);
      }
      if (f.time[i]! < today) lastObs = time.length - 1;
    }
  }
  const todayIdx = time.indexOf(today);
  return { time, rain, tmax, et0, gust, discharge, lastObsIdx: lastObs, todayIdx: todayIdx < 0 ? time.length : todayIdx };
}

export const HISTORY_SOURCES = [
  { name: "ERA5 reanalysis (ECMWF/Copernicus) via Open-Meteo archive", url: "https://open-meteo.com/en/docs/historical-weather-api" },
  { name: "GloFAS v4 river discharge reanalysis (Copernicus EMS)", url: "https://open-meteo.com/en/docs/flood-api" },
];
