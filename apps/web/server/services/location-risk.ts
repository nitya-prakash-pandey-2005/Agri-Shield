/**
 * Location Intelligence engine — climate risk for ANY coordinate on Earth.
 *
 *  assessMany(points)      → fast batched scoring for portfolios (hundreds of assets;
 *                            Open-Meteo multi-location + GloFAS in a few HTTP calls)
 *  assessLocation(lat,lon) → full report for one site: ML flood/salinity models,
 *                            72 h forecast, GloFAS river discharge + its 40-year record,
 *                            ECMWF ensemble spread, SEAS5 seasonal outlook, ERA5
 *                            climatology/trends/return periods, SPI drought index,
 *                            heat index & wet-bulb, CMIP6 2050 projection, SoilGrids
 *                            soil, DEM terrain & coast proximity, reverse-geocoded
 *                            place name and nearby hazard events.
 *
 * The shapes below are the stable contract used by the Explorer, Portfolio,
 * Insurance, Finance and Copilot modules. Extend with optional fields only.
 * Every enrichment is independent (own timeout + cache); failures and still-
 * computing items are recorded in `sources` / `extras.pending`, never thrown.
 */
import type { CropType, RiskLevel } from "@agri-shield/types";
import { getStore } from "../data/store";
import { within } from "../live/disk-cache";
import { getForecast, getRiverDischarge, type ForecastResult, type FloodResult } from "../live/open-meteo";
import { getHazardEvents, type HazardEvent } from "../live/events";
import {
  dayOfYear,
  getClimateHistory,
  findRiverCell,
  getDroughtIndex,
  getEnsemble,
  getPastRain30,
  getProjection,
  getRiverHistory,
  getSeasonal,
  heatStressFromHourly,
  type ClimateHistory,
  type ClimateProjection,
  type DroughtIndex,
  type EnsembleOutlook,
  type HeatStress,
  type RiverHistory,
  type SeasonalOutlook,
} from "../live/climate";
import { gumbelReturnPeriod, round } from "../live/climate-math";
import { getSoilProfile, type SoilProfile } from "../live/soil";
import { getTerrain, type TerrainInfo } from "../live/terrain";
import { reverseGeocode, type PlaceInfo } from "../live/geosearch";
import { getFloodRisk, getSalinityRisk } from "../ml-client";
import { clamp01, riskLevel, scoreFlood, scoreSalinity } from "../risk/scoring";

// ─── Contract ─────────────────────────────────────────────────────────────

export interface QuickAssessment {
  floodRisk: number; // 0-100 (72h probability)
  floodProb24h: number; // 0-1
  salinityRisk: number; // 0-100
  salinityEc: number; // dS/m
  droughtRisk: number; // 0-100
  heatRisk: number; // 0-100
  composite: number; // 0-100
  level: RiskLevel;
  drivers: string[];
  rain24hMm: number;
  rain72hMm: number;
  maxTempC: number | null;
  dischargeRatio: number | null;
  source: "open-meteo" | "fallback";
}

export interface DataSourceStamp {
  name: string;
  url: string;
  ok: boolean;
  fetchedAt: string;
  note?: string;
}

/** Optional enrichments (each null when its upstream failed or is still computing). */
export interface LocationExtras {
  place?: PlaceInfo | null;
  terrain?: TerrainInfo | null;
  ensemble?: EnsembleOutlook | null;
  seasonal?: SeasonalOutlook | null;
  climate?: ClimateHistory | null;
  drought?: DroughtIndex | null;
  heatStress?: HeatStress | null;
  projection?: ClimateProjection | null;
  riverHistory?: Omit<RiverHistory, "seasonalBand"> | null;
  soil?: SoilProfile | null;
  /** How rare the forecast's wettest day / 3 days is vs the site's own ERA5 record */
  forecastRarity?: { maxDailyMm: number; dailyReturnPeriodYears: number | null; max3dMm: number; threeDayReturnPeriodYears: number | null } | null;
  /** enrichments that did not finish inside the time budget (fetch climate/outlook separately) */
  pending?: string[];
}

export interface LocationRiskReport {
  location: {
    lat: number;
    lon: number;
    name: string | null;
    country: string | null;
    elevationM: number | null;
    nearestDistrictId: string | null;
    nearestDistrictKm: number | null;
    inCoreCoverage: boolean;
    /** optional: admin area / country code from reverse geocoding */
    admin1?: string | null;
    countryCode?: string | null;
    displayName?: string | null;
  };
  generatedAt: string;
  composite: { score: number; level: RiskLevel; drivers: string[]; summary: string };
  hazards: {
    flood: { score: number; p24: number; p48: number; p72: number; depthM: number; ci: [number, number]; factors: string[]; model: string };
    salinity: { score: number; ecNow: number; ec7d: number; ec30d: number; class: string; cropDamageProb: number; applicable: boolean; model: string; reason?: string };
    drought: { score: number; rain7dForecastMm: number; et0_7dMm: number; waterBalance7dMm: number; model: string; spi30?: number | null; spi90?: number | null };
    heat: { score: number; maxTempC: number | null; hotDays: number; model: string; heatIndexMaxC?: number | null; wetBulbMaxC?: number | null };
  };
  forecast: {
    hourly: { time: string; precipMm: number; precipProb: number; tempC: number | null; soilMoisture: number | null; floodProb?: number; humidity?: number | null; windKmh?: number | null }[];
    daily: { date: string; precipMm: number; precipProb: number; tMax: number | null; tMin: number | null; et0: number | null }[];
  };
  river: {
    dischargeM3s: number | null;
    meanM3s: number | null;
    ratio: number | null;
    /** p10/p50/p90 = the 1984→today GloFAS record for that calendar day (±7 d) */
    series: { date: string; value: number | null; p10?: number; p50?: number; p90?: number }[];
    /** optional: the GloFAS cell used (snapped to the main channel within ~5 km) */
    cell?: { lat: number; lon: number; distanceKm: number; snapped: boolean };
  } | null;
  hazardsNearby: (HazardEvent & { distanceKm: number })[];
  sources: DataSourceStamp[];
  /** Optional enrichments filled by the full engine (seasonal, climate, observed, soil…) */
  extras?: LocationExtras & Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Nearest monitored district and exposure priors (decay to a neutral prior with distance). */
export function exposurePriors(lat: number, lon: number) {
  const s = getStore();
  let best: { d: (typeof s.districts)[number]; km: number } | null = null;
  for (const d of s.districts) {
    const km = haversineKm(lat, lon, d.lat, d.lon);
    if (!best || km < best.km) best = { d, km };
  }
  const w = best ? Math.exp(-best.km / 120) : 0; // full weight inside a district, ~0 beyond ~400 km
  return {
    district: best?.d ?? null,
    km: best?.km ?? null,
    weight: w,
    flood: best ? w * best.d.floodExposure + (1 - w) * 0.45 : 0.45,
    salinity: best ? w * best.d.salinityExposure + (1 - w) * 0.15 : 0.15,
  };
}

/** Saltwater intrusion needs near-sea-level land: 1 at ≤5 m, fading to ~0 by 30 m. */
export function salinityElevationGate(elevationM: number | null | undefined): number {
  if (elevationM == null) return 1;
  return clamp01((30 - elevationM) / 25);
}

/** Salinity exposure combining the district prior, DEM elevation and coast proximity. */
export function salinityExposure(prior: number, elevationM: number | null | undefined, coastKm: 25 | 60 | null | undefined): number {
  const coastal = coastKm === 25 ? 0.5 : coastKm === 60 ? 0.3 : 0;
  // Inland (no sea within 60 km) sites keep only a small share of a far-away district prior
  const base = coastKm === null ? Math.min(prior, 0.08) : Math.max(prior, coastal);
  return Math.round(base * salinityElevationGate(elevationM) * 1000) / 1000;
}

const sum = (a: (number | null | undefined)[]) => a.reduce<number>((t, v) => t + (v ?? 0), 0);
const nowIdx = (times: string[]) => {
  const now = Date.now();
  const i = times.findIndex((t) => new Date(t).getTime() > now);
  return i < 0 ? times.length - 1 : Math.max(0, i - 1);
};

function dischargeRatio(f: FloodResult | undefined): { ratio: number | null; peak: number | null; mean: number | null } {
  const daily = f?.daily;
  if (!daily) return { ratio: null, peak: null, mean: null };
  const today = new Date().toISOString().slice(0, 10);
  const ti = Math.max(0, daily.time.indexOf(today));
  const hist = daily.river_discharge.slice(0, ti).filter((v): v is number => v != null && v > 0);
  const fut = daily.river_discharge.slice(ti, ti + 4).filter((v): v is number => v != null);
  if (hist.length < 5 || !fut.length) return { ratio: null, peak: null, mean: null };
  const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
  const peak = Math.max(...fut);
  return { ratio: mean > 0 ? peak / mean : null, peak, mean };
}

function droughtScore(f: ForecastResult): { score: number; rain7: number; et07: number } {
  const rain7 = sum(f.daily.precipitation_sum.slice(1, 8));
  const et07 = sum(f.daily.et0_fao_evapotranspiration.slice(1, 8));
  const deficit = et07 - rain7; // mm over the next week
  return { score: Math.round(clamp01((deficit - 10) / 35) * 100), rain7, et07 };
}

function heatScore(f: ForecastResult): { score: number; tmax: number | null; hot: number } {
  const t = f.daily.temperature_2m_max.filter((v): v is number => v != null);
  if (!t.length) return { score: 0, tmax: null, hot: 0 };
  const tmax = Math.max(...t);
  const hot = t.filter((v) => v >= 35).length;
  return { score: Math.round(clamp01((tmax - 32) / 10) * 100), tmax, hot };
}

export function compositeScore(p: { flood: number; salinity: number; drought: number; heat: number }): number {
  // Dominant hazard drives the score; secondary hazards add a compounding bonus
  const sorted = [p.flood, p.salinity * 0.9, p.drought * 0.85, p.heat * 0.7].sort((a, b) => b - a);
  return Math.round(Math.min(100, sorted[0]! + 0.25 * sorted[1]! + 0.1 * sorted[2]!));
}

function driversFor(q: { flood: number; salinity: number; drought: number; heat: number; rain72: number; ratio: number | null }): string[] {
  const d: string[] = [];
  if (q.flood >= 35) d.push(q.rain72 > 80 ? `Heavy rain forecast (${Math.round(q.rain72)} mm / 72h)` : "Elevated flood probability");
  if (q.ratio != null && q.ratio > 1.4) d.push(`River discharge ${q.ratio.toFixed(1)}× its 30-day mean`);
  if (q.salinity >= 35) d.push("Saltwater intrusion pressure");
  if (q.drought >= 35) d.push("Evaporation exceeds rainfall (dry spell)");
  if (q.heat >= 35) d.push("Heat stress on crops");
  if (!d.length) d.push("No significant hazard in the forecast window");
  return d;
}

// ─── Batched quick assessment (portfolios) ───────────────────────────────

export async function assessMany(points: { id: string; lat: number; lon: number; crop?: CropType | null }[]): Promise<Map<string, QuickAssessment>> {
  const out = new Map<string, QuickAssessment>();
  const CHUNK = 50;
  const month = new Date().getMonth() + 1;
  for (let i = 0; i < points.length; i += CHUNK) {
    const chunk = points.slice(i, i + CHUNK);
    // Round to ~1 km so nearby assets share cache entries
    const pts = chunk.map((p) => ({ lat: Math.round(p.lat * 100) / 100, lon: Math.round(p.lon * 100) / 100 }));
    const [fc, fl] = await Promise.allSettled([getForecast(pts, 8), getRiverDischarge(pts, 7)]);
    const forecasts = fc.status === "fulfilled" ? fc.value : [];

    // Salinity is only physically plausible on low, near-coast land. Coast probes (DEM rings)
    // run only for low-lying points outside monitored districts; recent 30-day rain drives dilution.
    const priors = chunk.map((p) => exposurePriors(p.lat, p.lon));
    const needCoast = new Map<string, { lat: number; lon: number }>();
    chunk.forEach((p, k) => {
      const el = forecasts[k]?.elevation;
      if (el != null && el < 20 && priors[k]!.weight < 0.5) needCoast.set(`${(Math.round(p.lat * 4) / 4).toFixed(2)},${(Math.round(p.lon * 4) / 4).toFixed(2)}`, { lat: Math.round(p.lat * 4) / 4, lon: Math.round(p.lon * 4) / 4 });
    });
    const coast = new Map<string, 25 | 60 | null>();
    await Promise.all(
      [...needCoast.entries()].slice(0, 25).map(async ([key, c]) => {
        try {
          coast.set(key, (await within(getTerrain(c.lat, c.lon), 6000, "terrain")).coastKm);
        } catch {
          /* unknown → keep prior */
        }
      })
    );
    const salExp = chunk.map((p, k) => {
      const pri = priors[k]!;
      const key = `${(Math.round(p.lat * 4) / 4).toFixed(2)},${(Math.round(p.lon * 4) / 4).toFixed(2)}`;
      const coastKm = pri.weight >= 0.5 ? (pri.salinity > 0.2 ? 25 : undefined) : coast.has(key) ? coast.get(key)! : undefined;
      return salinityExposure(pri.salinity, forecasts[k]?.elevation, coastKm);
    });
    // Past-30-day rain only where salinity applies, deduplicated on a 0.25° grid (each point costs ~2 weighted calls)
    const salIdx = chunk.map((_, k) => k).filter((k) => salExp[k]! > 0.1 && forecasts[k]);
    const cellOf = (k: number) => `${(Math.round(chunk[k]!.lat * 4) / 4).toFixed(2)},${(Math.round(chunk[k]!.lon * 4) / 4).toFixed(2)}`;
    const cells = [...new Set(salIdx.map(cellOf))];
    const rain30ByCell = new Map<string, number | null>();
    if (cells.length) {
      try {
        const vals = await within(getPastRain30(cells.map((c) => ({ lat: Number(c.split(",")[0]), lon: Number(c.split(",")[1]) }))), 8000, "rain30");
        cells.forEach((c, i) => rain30ByCell.set(c, vals[i] ?? null));
      } catch {
        /* fall back to the forecast-based proxy */
      }
    }

    chunk.forEach((p, k) => {
      const pri = priors[k]!;
      const f = forecasts[k];
      if (!f) {
        const d = pri.district;
        const flood = d ? d.floodRisk : 30;
        const salinity = d ? d.salinityRisk : 10;
        const composite = compositeScore({ flood, salinity, drought: 20, heat: 10 });
        out.set(p.id, { floodRisk: flood, floodProb24h: d?.floodProb24h ?? 0.2, salinityRisk: salinity, salinityEc: d?.ecCurrent ?? 1, droughtRisk: 20, heatRisk: 10, composite, level: riskLevel(composite), drivers: ["Using last known district baseline (live feed unavailable)"], rain24hMm: 0, rain72hMm: d?.rainfall72hMm ?? 0, maxTempC: null, dischargeRatio: null, source: "fallback" });
        return;
      }
      const i0 = nowIdx(f.hourly.time);
      const pr = f.hourly.precipitation;
      const r24 = sum(pr.slice(i0, i0 + 24));
      const r48 = sum(pr.slice(i0, i0 + 48));
      const r72 = sum(pr.slice(i0, i0 + 72));
      const dis = dischargeRatio(fl.status === "fulfilled" ? fl.value[k] : undefined);
      const flood = scoreFlood({ rain24hMm: r24, rain48hMm: r48, rain72hMm: r72, soilMoisture: f.hourly.soil_moisture_0_to_7cm[i0] ?? 0.3, dischargeRatio: dis.ratio, exposure: pri.flood, elevationM: f.elevation });
      const observed30 = salIdx.includes(k) ? (rain30ByCell.get(cellOf(k)) ?? null) : null;
      const sal = scoreSalinity({ exposure: salExp[k]!, month, rain30dMm: observed30 ?? sum(f.daily.precipitation_sum) * 4, seaLevelM: null, latitude: p.lat });
      const dr = droughtScore(f);
      const ht = heatScore(f);
      const composite = compositeScore({ flood: flood.score, salinity: sal.score, drought: dr.score, heat: ht.score });
      out.set(p.id, {
        floodRisk: flood.score,
        floodProb24h: flood.p24,
        salinityRisk: sal.score,
        salinityEc: sal.ecCurrent,
        droughtRisk: dr.score,
        heatRisk: ht.score,
        composite,
        level: riskLevel(composite),
        drivers: driversFor({ flood: flood.score, salinity: sal.score, drought: dr.score, heat: ht.score, rain72: r72, ratio: dis.ratio }),
        rain24hMm: Math.round(r24 * 10) / 10,
        rain72hMm: Math.round(r72 * 10) / 10,
        maxTempC: ht.tmax,
        dischargeRatio: dis.ratio == null ? null : Math.round(dis.ratio * 100) / 100,
        source: "open-meteo",
      });
    });
  }
  return out;
}

// ─── Full single-site report ─────────────────────────────────────────────

export interface AssessOptions {
  crop?: CropType;
  name?: string | null;
  /** ms to wait for slow enrichments (40-yr climate, soil…) before returning them as pending. Default 6000. */
  budgetMs?: number;
  /**
   * "standard" (default): everything except enrichments that draw heavily on Open-Meteo's shared
   * fair-use budget (GloFAS 10-yr record, 40-yr ERA5, CMIP6) — those are included only when cached.
   * "full": also computes the river record (Explorer). ERA5 history/SPI and CMIP6 are always
   * on demand (explorer.climate / explorer.outlook) and then reused here from cache.
   */
  enrich?: "standard" | "full";
}

const g = globalThis as unknown as { __agriReports?: Map<string, { value: LocationRiskReport; expires: number }> };
const reportCache: Map<string, { value: LocationRiskReport; expires: number }> = (g.__agriReports ??= new Map());
const reportInflight = new Map<string, Promise<LocationRiskReport>>();

export async function assessLocation(lat: number, lon: number, opts: AssessOptions = {}): Promise<LocationRiskReport> {
  const key = `loc:${lat.toFixed(3)},${lon.toFixed(3)}:${opts.crop ?? "rice"}:${opts.enrich ?? "standard"}`;
  const hit = reportCache.get(key);
  if (hit && hit.expires > Date.now()) return withName(hit.value, opts.name);
  const running = reportInflight.get(key);
  if (running) return withName(await running, opts.name);
  const p = buildReport(lat, lon, opts)
    .then((r) => {
      // complete reports live 10 min; partial ones (pending enrichments) are rebuilt after 45 s
      reportCache.set(key, { value: r, expires: Date.now() + (r.extras?.pending?.length ? 45_000 : 10 * 60_000) });
      if (reportCache.size > 500) reportCache.delete(reportCache.keys().next().value!);
      return r;
    })
    .finally(() => reportInflight.delete(key));
  reportInflight.set(key, p);
  return withName(await p, opts.name);
}

function withName(r: LocationRiskReport, name: string | null | undefined): LocationRiskReport {
  return name && name !== r.location.name ? { ...r, location: { ...r.location, name } } : r;
}

async function buildReport(lat: number, lon: number, opts: AssessOptions): Promise<LocationRiskReport> {
  const budget = opts.budgetMs ?? 6000;
  const full = opts.enrich === "full";
  const pri = exposurePriors(lat, lon);
  const stamp = (name: string, url: string, ok: boolean, note?: string): DataSourceStamp => ({ name, url, ok, fetchedAt: new Date().toISOString(), note });
  const errMsg = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)).slice(0, 140) : undefined);

  // Terrain first-class: it sharpens both ML models' exposure inputs (cheap: 1 request, cached 1 yr)
  const terrainP = within(getTerrain(lat, lon), 5000, "terrain");
  const exposureP = terrainP.then(
    (t) => {
      const floodExp = clamp01(pri.flood + (t.position === "depression" ? 0.1 : 0) + (t.elevationM <= 5 ? 0.08 : 0) - (t.position === "ridge / high ground" ? 0.15 : 0) - (t.elevationM > 200 ? 0.1 : 0));
      return { flood: floodExp, salinity: salinityExposure(pri.salinity, t.elevationM, pri.weight >= 0.5 && pri.salinity > 0.2 ? 25 : t.coastKm), coastKm: t.coastKm, elev: t.elevationM };
    },
    // terrain unknown: trust only a nearby delta district's prior, otherwise stay below the applicability bar
    () => ({ flood: pri.flood, salinity: pri.salinity > 0.2 ? pri.salinity : Math.min(pri.salinity, 0.1), coastKm: undefined as 25 | 60 | null | undefined, elev: null as number | null })
  );

  const fcP = getForecast([{ lat, lon }], 8);
  // River: snap to the main GloFAS channel within ~5 km (falls back to the exact cell)
  const cellP = findRiverCell(lat, lon).catch(async () => {
    const r = await getRiverDischarge([{ lat, lon }], 7);
    if (!r[0]) throw new Error("GloFAS unavailable");
    return { lat, lon, distanceKm: 0, snapped: false, result: r[0] };
  });
  const flP = cellP.then((c) => [c.result]);
  // ── Enrichments: start now, in parallel with the core models; each is independent and time-boxed ──
  const t0 = Date.now();
  const box = <T,>(p: Promise<T>, ms: number, label: string) => within(p, ms, label);
  const riverCellSeries = (c: Awaited<typeof cellP>) => c.result.daily.time.map((date, k) => ({ date, value: c.result.daily.river_discharge[k] ?? null }));
  const enrichP = Promise.allSettled([
    opts.name ? Promise.reject(new Error("name supplied")) : box(reverseGeocode(lat, lon), Math.min(6000, budget), "place"),
    box(getEnsemble(lat, lon), Math.max(budget, 8000), "ensemble"),
    box(getSeasonal(lat, lon), Math.max(budget, 8000), "seasonal"),
    // 40-yr ERA5 (≈1 000 weighted upstream calls) is computed on demand by explorer.climate; reused here when cached
    box(getClimateHistory(lat, lon, { cacheOnly: true }), Math.min(budget, 4000), "climate history"),
    box(getDroughtIndex(lat, lon, { cacheOnly: true }), budget, "drought index"),
    box(getProjection(lat, lon, { cacheOnly: true }), Math.min(budget, 3000), "climate projection"),
    cellP.then((c) => box(getRiverHistory(c.lat, c.lon, riverCellSeries(c), { cacheOnly: !full }), Math.max(1000, budget - (Date.now() - t0)), "river history")),
    box(getSoilProfile(lat, lon), Math.min(budget, 12000), "soil"),
  ]);
  const [fcR, flR, floodR, salR, hazR, terrR, expR] = await Promise.allSettled([
    fcP,
    flP,
    exposureP.then((e) => getFloodRisk(lat, lon, e.flood)),
    exposureP.then((e) => getSalinityRisk(lat, lon, opts.crop ?? "rice", e.salinity)),
    getHazardEvents(),
    terrainP,
    exposureP,
  ]);
  const f = fcR.status === "fulfilled" ? fcR.value[0] : undefined;
  const fl = flR.status === "fulfilled" ? flR.value[0] : undefined;
  const cell = fl ? await cellP.catch(() => null) : null;
  const flood = floodR.status === "fulfilled" ? floodR.value : null;
  const sal = salR.status === "fulfilled" ? salR.value : null;
  const terrain = terrR.status === "fulfilled" ? terrR.value : null;
  const exp = expR.status === "fulfilled" ? expR.value : { flood: pri.flood, salinity: Math.min(pri.salinity, 0.1), coastKm: undefined, elev: null };
  const dis = dischargeRatio(fl);
  const riverSeries = fl ? fl.daily.time.map((date, k) => ({ date, value: fl.daily.river_discharge[k] ?? null })) : [];

  // ── Enrichments (started above, in parallel with the core models) ──
  const pending: string[] = [];
  const [placeR, ensR, seasR, climR, drR, projR, rivR, soilR] = await enrichP;
  const val = <T,>(r: PromiseSettledResult<T>, label: string): T | null => {
    if (r.status === "fulfilled") return r.value;
    const m = errMsg(r) ?? "";
    if (m.includes("still computing")) pending.push(label);
    return null;
  };
  const place = placeR.status === "fulfilled" ? placeR.value : null;
  const ensemble = val(ensR, "ensemble");
  const seasonal = val(seasR, "seasonal");
  const climate = val(climR, "climate");
  const drought = val(drR, "drought");
  const projection = val(projR, "projection");
  const riverHist = val(rivR, "river");
  const soil = val(soilR, "soil");

  // ── Forecast series ──
  const i0 = f ? nowIdx(f.hourly.time) : 0;
  const hourly = f
    ? f.hourly.time.slice(i0, i0 + 72).map((time, k) => ({
        time,
        precipMm: f.hourly.precipitation[i0 + k] ?? 0,
        precipProb: f.hourly.precipitation_probability[i0 + k] ?? 0,
        tempC: f.hourly.temperature_2m[i0 + k] ?? null,
        soilMoisture: f.hourly.soil_moisture_0_to_7cm[i0 + k] ?? null,
        floodProb: flood?.hourly?.[k]?.probability,
        humidity: f.hourly.relative_humidity_2m[i0 + k] ?? null,
        windKmh: f.hourly.wind_speed_10m[i0 + k] ?? null,
      }))
    : [];
  const daily = f
    ? f.daily.time.map((date, k) => ({ date, precipMm: f.daily.precipitation_sum[k] ?? 0, precipProb: f.daily.precipitation_probability_max[k] ?? 0, tMax: f.daily.temperature_2m_max[k] ?? null, tMin: f.daily.temperature_2m_min[k] ?? null, et0: f.daily.et0_fao_evapotranspiration[k] ?? null }))
    : [];
  const heatStress = f ? heatStressFromHourly(f.hourly, i0) : null;

  // ── Hazard scores ──
  // Hydro-meteorological floor: the same transparent formula portfolios use (assessMany), so an
  // extreme rain / river signal is never under-scored when the ML model is outside its training range.
  const rain72Now = hourly.reduce((t, h) => t + h.precipMm, 0);
  // only when there is a live signal (heavy rain or a swollen river) — otherwise static exposure would dominate
  const hydro = f && (rain72Now >= 40 || ((dis.ratio ?? 0) >= 1.5 && (dis.peak ?? 0) >= 20))
    ? scoreFlood({
        rain24hMm: hourly.slice(0, 24).reduce((t, h) => t + h.precipMm, 0),
        rain48hMm: hourly.slice(0, 48).reduce((t, h) => t + h.precipMm, 0),
        rain72hMm: hourly.reduce((t, h) => t + h.precipMm, 0),
        soilMoisture: hourly[0]?.soilMoisture ?? 0.3,
        dischargeRatio: dis.ratio,
        exposure: exp.flood,
        elevationM: terrain?.elevationM ?? f.elevation,
      })
    : null;
  const floodP = {
    p24: Math.max(flood?.probability_24h ?? 0, hydro?.p24 ?? 0),
    p48: Math.max(flood?.probability_48h ?? 0, hydro?.p48 ?? 0),
    p72: Math.max(flood?.probability_72h ?? 0, hydro?.p72 ?? 0),
  };
  const hydroWins = !!hydro && hydro.p72 > (flood?.probability_72h ?? 0) + 0.02;
  const floodScore = flood || hydro ? Math.round(floodP.p72 * 100) : 0;
  const salApplicable = exp.salinity > 0.12;
  const salReason = salApplicable
    ? exp.coastKm
      ? `Low-lying land with the coast within ~${exp.coastKm} km`
      : "Inside a monitored saline delta district"
    : exp.coastKm === null
      ? "No sea within 60 km — saltwater intrusion is not a hazard here"
      : exp.elev != null && exp.elev > 25
        ? `Site is ${Math.round(exp.elev)} m above sea level — too high for tidal saltwater`
        : "Outside known saline-intrusion zones";
  const salScore = sal && salApplicable ? Math.round(clamp01(sal.ec_predicted_30d / 9) * 100) : 0;
  const dr = f ? droughtScore(f) : { score: 0, rain7: 0, et07: 0 };
  const droughtFinal = Math.max(dr.score, drought?.score ?? 0);
  const ht = f ? heatScore(f) : { score: 0, tmax: null, hot: 0 };
  const heatFinal = Math.max(ht.score, heatStress?.score ?? 0);
  const composite = compositeScore({ flood: floodScore, salinity: salScore, drought: droughtFinal, heat: heatFinal });
  const rain72 = hourly.reduce((t, h) => t + h.precipMm, 0);
  const drivers = driversFor({ flood: floodScore, salinity: salScore, drought: droughtFinal, heat: heatFinal, rain72, ratio: dis.ratio });
  const level = riskLevel(composite);

  // ── Context drivers from the enrichments ──
  let forecastRarity: LocationExtras["forecastRarity"] = null;
  if (climate?.gumbel.daily && daily.length) {
    const next = daily.slice(1);
    const maxDaily = Math.max(0, ...next.map((d) => d.precipMm));
    let max3 = 0;
    for (let k = 0; k + 3 <= next.length; k++) max3 = Math.max(max3, next[k]!.precipMm + next[k + 1]!.precipMm + next[k + 2]!.precipMm);
    const rpD = maxDaily > 1 ? round(gumbelReturnPeriod(climate.gumbel.daily, maxDaily), 1) : null;
    const rpT = climate.gumbel.threeDay && max3 > 1 ? round(gumbelReturnPeriod(climate.gumbel.threeDay, max3), 1) : null;
    forecastRarity = { maxDailyMm: round(maxDaily), dailyReturnPeriodYears: rpD, max3dMm: round(max3), threeDayReturnPeriodYears: rpT };
    if ((rpD ?? 0) >= 2 || (rpT ?? 0) >= 2) {
      const worst = Math.max(rpD ?? 0, rpT ?? 0);
      drivers.unshift(`Forecast rain is a 1-in-${Math.round(worst)}-year event for this site`);
    }
  }
  if (riverHist?.significantRiver && riverHist.current && riverHist.current.percentileSeason >= 90) drivers.push(`River flow in the top ${100 - riverHist.current.percentileSeason}% for the season`);
  if (drought && (drought.spi90 ?? 0) <= -1) drivers.push(`${drought.category90} over the last 90 days (SPI ${drought.spi90})`);
  if (heatStress && heatStress.level >= 3) drivers.push(`Heat index up to ${Math.round(heatStress.heatIndexMaxC)} °C (${heatStress.category.toLowerCase()})`);
  if (drivers.length > 1) {
    const idx = drivers.indexOf("No significant hazard in the forecast window");
    if (idx >= 0) drivers.splice(idx, 1);
  }

  const hazards = (hazR.status === "fulfilled" ? hazR.value : [])
    .map((h) => ({ ...h, distanceKm: Math.round(haversineKm(lat, lon, h.lat, h.lon)) }))
    .filter((h) => h.distanceKm <= 800)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 8);

  // River series + historical band for each date
  const bandByDoy = riverHist ? new Map(riverHist.seasonalBand.map((b) => [b.doy, b])) : null;
  const series = riverSeries.map((s) => {
    const b = bandByDoy?.get(dayOfYear(s.date));
    return b ? { ...s, p10: b.p10, p50: b.p50, p90: b.p90 } : s;
  });

  const placeName = opts.name ?? place?.name ?? null;
  const country = place?.country ?? (pri.district && (pri.km ?? 999) < 150 ? pri.district.countryName : null);
  const lvl = `${level[0]!.toUpperCase()}${level.slice(1)}`;
  const summaryParts = [`${lvl} overall climate risk (${composite}/100). ${drivers[0]}.`];
  if (seasonal) summaryParts.push(seasonal.summary);
  if (projection) summaryParts.push(`By 2050 (high-emissions scenario) annual rain changes ${projection.ensemble.annualRainPct.mean >= 0 ? "+" : ""}${projection.ensemble.annualRainPct.mean}% and days above 35 °C ${projection.ensemble.hotDays.mean >= 0 ? "+" : ""}${Math.round(projection.ensemble.hotDays.mean)}/yr.`);

  const { seasonalBand: _band, ...riverHistory } = riverHist ?? ({ seasonalBand: [] } as unknown as RiverHistory);
  void _band;

  return {
    location: {
      lat,
      lon,
      name: placeName,
      country,
      elevationM: terrain?.elevationM ?? f?.elevation ?? null,
      nearestDistrictId: pri.district?.id ?? null,
      nearestDistrictKm: pri.km == null ? null : Math.round(pri.km),
      inCoreCoverage: (pri.km ?? 999) < 80,
      admin1: place?.admin1 ?? null,
      countryCode: place?.countryCode ?? null,
      displayName: place?.displayName ?? null,
    },
    generatedAt: new Date().toISOString(),
    composite: { score: composite, level, drivers, summary: summaryParts.join(" ") },
    hazards: {
      flood: flood
        ? {
            score: floodScore,
            ...floodP,
            depthM: Math.max(flood.estimated_depth_m, hydroWins ? hydro!.depthM : 0),
            ci: hydroWins ? [Math.max(0, round(floodP.p72 - 0.15, 2)), Math.min(1, round(floodP.p72 + 0.15, 2))] : flood.confidence_interval,
            factors: [...new Set([...flood.contributing_factors, ...(hydroWins ? hydro!.factors : [])])],
            model: hydroWins ? `${flood.model_version} + hydromet floor` : flood.model_version,
          }
        : hydro
          ? { score: floodScore, ...floodP, depthM: hydro.depthM, ci: [Math.max(0, round(hydro.p72 - 0.2, 2)), Math.min(1, round(hydro.p72 + 0.2, 2))], factors: hydro.factors, model: "hydromet-formula-v1" }
          : { score: 0, p24: 0, p48: 0, p72: 0, depthM: 0, ci: [0, 0], factors: [], model: "unavailable" },
      salinity: sal
        ? { score: salScore, ecNow: salApplicable ? sal.ec_current : Math.min(sal.ec_current, 0.8), ec7d: salApplicable ? sal.ec_predicted_7d : Math.min(sal.ec_predicted_7d, 0.8), ec30d: salApplicable ? sal.ec_predicted_30d : Math.min(sal.ec_predicted_30d, 0.8), class: salApplicable ? sal.risk_level : "not applicable", cropDamageProb: salApplicable ? sal.crop_damage_probability : 0, applicable: salApplicable, model: sal.model_version, reason: salReason }
        : { score: 0, ecNow: 0, ec7d: 0, ec30d: 0, class: "unknown", cropDamageProb: 0, applicable: false, model: "unavailable", reason: salReason },
      drought: { score: droughtFinal, rain7dForecastMm: Math.round(dr.rain7 * 10) / 10, et0_7dMm: Math.round(dr.et07 * 10) / 10, waterBalance7dMm: Math.round((dr.rain7 - dr.et07) * 10) / 10, model: drought ? "fao56-water-balance-v1 + SPI (ERA5)" : "fao56-water-balance-v1", spi30: drought?.spi30 ?? null, spi90: drought?.spi90 ?? null },
      heat: { score: heatFinal, maxTempC: ht.tmax, hotDays: ht.hot, model: heatStress ? "tmax-threshold-v1 + NOAA heat index / Stull wet-bulb" : "tmax-threshold-v1", heatIndexMaxC: heatStress?.heatIndexMaxC ?? null, wetBulbMaxC: heatStress?.wetBulbMaxC ?? null },
    },
    forecast: { hourly, daily },
    river: fl ? { dischargeM3s: dis.peak == null ? null : Math.round(dis.peak), meanM3s: dis.mean == null ? null : Math.round(dis.mean), ratio: dis.ratio == null ? null : Math.round(dis.ratio * 100) / 100, series, cell: cell ? { lat: cell.lat, lon: cell.lon, distanceKm: cell.distanceKm, snapped: cell.snapped } : undefined } : null,
    hazardsNearby: hazards,
    sources: [
      stamp("Open-Meteo forecast", "https://open-meteo.com", !!f),
      stamp("GloFAS v4 river discharge", "https://open-meteo.com/en/docs/flood-api", !!fl),
      stamp("Agri-SHIELD flood model", "/docs/methodology-flood", !!flood, flood?.model_version),
      stamp("Agri-SHIELD salinity model", "/docs/methodology-salinity", !!sal, sal?.model_version),
      stamp("GDACS + NASA EONET", "https://www.gdacs.org", hazR.status === "fulfilled"),
      stamp("Copernicus GLO-90 DEM (terrain, coast)", "https://open-meteo.com/en/docs/elevation-api", !!terrain, errMsg(terrR)),
      stamp("OpenStreetMap Nominatim (place name)", "https://nominatim.org", !!place || !!opts.name, opts.name ? "name supplied by user" : errMsg(placeR)),
      stamp("ECMWF IFS ensemble (51 members)", "https://open-meteo.com/en/docs/ensemble-api", !!ensemble, errMsg(ensR)),
      stamp("ECMWF SEAS5 seasonal forecast", "https://open-meteo.com/en/docs/seasonal-forecast-api", !!seasonal, errMsg(seasR)),
      stamp("ERA5 reanalysis 1985→present (climatology, SPI)", "https://open-meteo.com/en/docs/historical-weather-api", !!climate, errMsg(climR) ?? errMsg(drR)),
      stamp("CMIP6 HighResMIP projections", "https://open-meteo.com/en/docs/climate-api", !!projection, errMsg(projR)),
      stamp("GloFAS reanalysis (last ~10 years)", "https://open-meteo.com/en/docs/flood-api", !!riverHist, errMsg(rivR)),
      stamp("ISRIC SoilGrids 2.0", "https://soilgrids.org", !!soil, errMsg(soilR)),
    ],
    extras: {
      place,
      terrain,
      ensemble,
      seasonal,
      climate,
      drought,
      heatStress,
      projection,
      riverHistory: riverHist ? riverHistory : null,
      soil,
      forecastRarity,
      pending,
    },
  };
}

/** Warm-cache helper used by the explorer's separate `climate` / `outlook` queries. */
export const locationEnrichments = {
  climate: (lat: number, lon: number) => getClimateHistory(lat, lon),
  drought: (lat: number, lon: number) => getDroughtIndex(lat, lon),
  seasonal: (lat: number, lon: number) => getSeasonal(lat, lon),
  projection: (lat: number, lon: number) => getProjection(lat, lon),
  soil: (lat: number, lon: number) => getSoilProfile(lat, lon),
  terrain: (lat: number, lon: number) => getTerrain(lat, lon),
  place: (lat: number, lon: number) => reverseGeocode(lat, lon),
  ensemble: (lat: number, lon: number) => getEnsemble(lat, lon),
  /** cache-only variants: never trigger the heavy upstream requests */
  climateCached: (lat: number, lon: number) => getClimateHistory(lat, lon, { cacheOnly: true }),
  droughtCached: (lat: number, lon: number) => getDroughtIndex(lat, lon, { cacheOnly: true }),
  projectionCached: (lat: number, lon: number) => getProjection(lat, lon, { cacheOnly: true }),
};

