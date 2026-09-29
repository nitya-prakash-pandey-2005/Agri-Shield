/**
 * Climate intelligence fetchers (Open-Meteo family, free, CC BY 4.0) and the
 * statistics derived from them. Everything is cached (memory + disk) and
 * every function fails independently so the report degrades gracefully.
 *
 *   getEnsemble         ECMWF IFS 0.25° 51-member ensemble → p10/p50/p90 daily rain (15 d)
 *   getSeasonal         ECMWF SEAS5 monthly means + anomalies vs model climatology (6-7 months)
 *   getClimateHistory   ERA5 1985→last year: annual series, trends, Gumbel return periods, 1991-2020 normals
 *   getDroughtIndex     SPI-30 / SPI-90: last 30/90 days vs the same season in each of 40 years
 *   getProjection       CMIP6 HighResMIP (2 models) 2041-2060 vs 1995-2014
 *   getRiverHistory     GloFAS v4 reanalysis 1984→today: percentiles, seasonal band, return levels
 *   heatStressFromHourly  heat index + wet-bulb from the hourly forecast
 */
import { cached, fetchJson } from "./http";
import { peekPersisted, persisted } from "./disk-cache";
import { getHistory, getRiverDischarge, type FloodResult, type HourlyForecast } from "./open-meteo";
import {
  gumbelFit,
  gumbelReturnLevel,
  gumbelReturnPeriod,
  heatIndexC,
  heatIndexCategory,
  linearTrend,
  longestDrySpell,
  maxRollingSum,
  mean,
  percentileRank,
  quantile,
  round,
  spi,
  spiCategory,
  wetBulbC,
  type GumbelFit,
  type Trend,
} from "./climate-math";

const ENSEMBLE = "https://ensemble-api.open-meteo.com/v1/ensemble";
const SEASONAL = "https://seasonal-api.open-meteo.com/v1/seasonal";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const CLIMATE = "https://climate-api.open-meteo.com/v1/climate";
const FLOOD = "https://flood-api.open-meteo.com/v1/flood";

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** ~5 km grid snapping so neighbouring clicks share expensive cache entries */
const snap = (v: number, step = 0.05) => (Math.round(v / step) * step).toFixed(2);
const ck = (lat: number, lon: number, step?: number) => `${snap(lat, step)},${snap(lon, step)}`;
const nums = (a: (number | null | undefined)[] | undefined) => (a ?? []).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));

// ─── Heavy-request scheduler ────────────────────────────────────────────
// Open-Meteo weights long requests (≈ variables/10 × days/14 "calls") against a
// 600-calls-per-minute fair-use limit shared by everything on this IP. Multi-decade
// requests therefore run one at a time inside a rolling 60-second weight budget,
// and a 429 is retried after the window resets instead of failing the report.

const HEAVY_BUDGET = 350; // weighted calls per rolling minute (Open-Meteo limit: 600 / min per IP)
const HOURLY_CAP = 2000; // our share of the 5 000 / hour per-IP limit — beyond this, fail fast
const hq = ((globalThis as unknown as { __agriHeavyQ?: { log: { t: number; w: number }[]; hour: { t: number; w: number }[]; chain: Promise<unknown> } }).__agriHeavyQ ??= { log: [], hour: [], chain: Promise.resolve() });
hq.hour ??= [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Open-Meteo fair-use weight of one single-location request: >10 variables or >14 days count as multiple calls. */
export function requestWeight(variables: number, days: number): number {
  return Math.max(1, variables / 10) * Math.max(1, days / 14);
}

export function heavyFetch<T>(url: string, weight: number, timeoutMs: number): Promise<T> {
  // Commercial Open-Meteo key (OPEN_METEO_API_KEY): fetchJson routes to customer-* hosts; no free-tier budget needed
  if (process.env.OPEN_METEO_API_KEY) return fetchJson<T>(url, timeoutMs);
  const run = hq.chain.then(async () => {
    const now0 = Date.now();
    hq.hour = hq.hour.filter((x) => now0 - x.t < 3600_000);
    if (hq.hour.reduce((s, x) => s + x.w, 0) + weight > HOURLY_CAP) throw new Error("hourly fair-use budget for long climate records reached — try again later");
    for (let attempt = 0; ; attempt++) {
      for (;;) {
        const now = Date.now();
        hq.log = hq.log.filter((x) => now - x.t < 61_000);
        const used = hq.log.reduce((s, x) => s + x.w, 0);
        if (!hq.log.length || used + weight <= HEAVY_BUDGET) break;
        await sleep(hq.log[0]!.t + 61_000 - now);
      }
      hq.log.push({ t: Date.now(), w: weight });
      hq.hour.push({ t: Date.now(), w: weight });
      try {
        return await fetchJson<T>(url, timeoutMs);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt < 1 && /\b429\b/.test(msg)) {
          await sleep(62_000);
          continue;
        }
        throw e;
      }
    }
  });
  hq.chain = run.catch(() => undefined);
  return run;
}

export function heavyQueueStats() {
  const now = Date.now();
  const recent = hq.log.filter((x) => now - x.t < 61_000);
  const hour = (hq.hour ?? []).filter((x) => now - x.t < 3600_000);
  return { weightLastMinute: Math.round(recent.reduce((s, x) => s + x.w, 0)), budget: HEAVY_BUDGET, weightLastHour: Math.round(hour.reduce((s, x) => s + x.w, 0)), hourlyCap: HOURLY_CAP };
}

// ─── River cell snapping ────────────────────────────────────────────────

export interface RiverCell {
  lat: number;
  lon: number;
  distanceKm: number;
  snapped: boolean;
  result: FloodResult;
}

/**
 * GloFAS runs on a 0.05° (~5 km) grid; a clicked point often falls in a cell
 * next to the main channel. Search the 3×3 neighbourhood (±~5.5 km; 9 points ≈ 24
 * weighted calls with 37 days each) and use the
 * cell with the largest recent mean flow when it is clearly the main river.
 */
export async function findRiverCell(lat: number, lon: number): Promise<RiverCell> {
  const pts: { lat: number; lon: number }[] = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) pts.push({ lat: Math.round((lat + i * 0.05) * 1000) / 1000, lon: Math.round((lon + j * 0.05) * 1000) / 1000 });
  const res = await getRiverDischarge(pts, 7);
  const meanOf = (r: FloodResult | undefined) => {
    const v = (r?.daily.river_discharge ?? []).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  const centreIdx = 4;
  let best = centreIdx;
  res.forEach((r, k) => {
    if (meanOf(r) > meanOf(res[best])) best = k;
  });
  const snapped = best !== centreIdx && meanOf(res[best]) >= 5 && meanOf(res[best]) >= 3 * Math.max(0.1, meanOf(res[centreIdx]));
  const k = snapped ? best : centreIdx;
  const p = pts[k]!;
  const dKm = Math.round(Math.hypot((p.lat - lat) * 111.32, (p.lon - lon) * 111.32 * Math.cos((lat * Math.PI) / 180)) * 10) / 10;
  if (!res[k]) throw new Error("GloFAS returned no data");
  return { lat: p.lat, lon: p.lon, distanceKm: snapped ? dKm : 0, snapped, result: res[k]! };
}

// ─── Ensemble (uncertainty fan) ───────────────────────────────────────────

export interface Band {
  p10: number;
  p50: number;
  p90: number;
}
export interface EnsembleDay extends Band {
  date: string;
  mean: number;
  /** share of members with ≥ 1 mm / ≥ 20 mm / ≥ 50 mm on that day */
  probWet: number;
  probHeavy: number;
  probExtreme: number;
  tmax: Band | null;
}
export interface EnsembleOutlook {
  model: string;
  members: number;
  days: EnsembleDay[];
  totals: { days3: Band; days7: Band; days14: Band };
  /** probability that the wettest 3-day window in the next 14 days exceeds 100 mm */
  prob3dOver100mm: number;
  issuedAt: string;
}

const band = (a: number[], d = 1): Band => ({ p10: round(quantile(a, 0.1), d), p50: round(quantile(a, 0.5), d), p90: round(quantile(a, 0.9), d) });

export function getEnsemble(lat: number, lon: number): Promise<EnsembleOutlook> {
  return cached(`ens:${ck(lat, lon)}`, 60 * 60_000, async () => {
    const r = await fetchJson<{ daily: Record<string, (number | null)[]> & { time: string[] } }>(
      `${ENSEMBLE}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=precipitation_sum,temperature_2m_max&models=ecmwf_ifs025&forecast_days=15&timezone=auto`,
      15000
    );
    const d = r.daily;
    const pKeys = Object.keys(d).filter((k) => k.startsWith("precipitation_sum"));
    const tKeys = Object.keys(d).filter((k) => k.startsWith("temperature_2m_max"));
    const members = pKeys.map((k) => nums(d[k]));
    const tMembers = tKeys.map((k) => nums(d[k]));
    // keep days where most members have data
    const nDays = d.time.findIndex((_, i) => members.filter((m) => m[i] != null).length < members.length * 0.6);
    const len = nDays < 0 ? d.time.length : nDays;
    if (len < 3 || !members.length) throw new Error("ensemble returned no usable members");
    const days: EnsembleDay[] = d.time.slice(0, len).map((date, i) => {
      const v = members.map((m) => m[i]).filter((x): x is number => x != null);
      const t = tMembers.map((m) => m[i]).filter((x): x is number => x != null);
      return {
        date,
        ...band(v),
        mean: round(mean(v)),
        probWet: round(v.filter((x) => x >= 1).length / v.length, 2),
        probHeavy: round(v.filter((x) => x >= 20).length / v.length, 2),
        probExtreme: round(v.filter((x) => x >= 50).length / v.length, 2),
        tmax: t.length ? band(t) : null,
      };
    });
    // Per-member totals, then quantiles (summing daily percentiles would overstate the spread)
    const tot = (n: number) => members.map((m) => m.slice(0, Math.min(n, len)).reduce<number>((s, x) => s + (x ?? 0), 0));
    const max3 = members.map((m) => maxRollingSum(m.slice(0, len), 3));
    return {
      model: "ECMWF IFS 0.25° ensemble (51 members)",
      members: members.length,
      days,
      totals: { days3: band(tot(3)), days7: band(tot(7)), days14: band(tot(14)) },
      prob3dOver100mm: round(max3.filter((x) => x > 100).length / max3.length, 2),
      issuedAt: new Date().toISOString(),
    };
  });
}

// ─── Seasonal outlook ────────────────────────────────────────────────────

export interface SeasonalMonth {
  month: string; // YYYY-MM
  precipMm: number;
  precipAnomMm: number;
  /** anomaly as % of the model's normal for that month */
  precipAnomPct: number | null;
  tempC: number;
  tempAnomC: number;
  signal: "wetter" | "drier" | "near-normal";
}
export interface SeasonalOutlook {
  model: string;
  baseline: string;
  months: SeasonalMonth[];
  summary: string;
}

export function getSeasonal(lat: number, lon: number): Promise<SeasonalOutlook> {
  return persisted(`seas:${ck(lat, lon, 0.25)}:${ymd(new Date()).slice(0, 7)}`, 24 * 3600_000, async () => {
    const r = await fetchJson<{ monthly: { time: string[]; precipitation_mean: (number | null)[]; precipitation_anomaly: (number | null)[]; temperature_2m_mean: (number | null)[]; temperature_2m_anomaly: (number | null)[] } }>(
      `${SEASONAL}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&monthly=precipitation_mean,precipitation_anomaly,temperature_2m_mean,temperature_2m_anomaly`,
      15000
    );
    const m = r.monthly;
    const months: SeasonalMonth[] = m.time
      .map((t, i) => {
        const p = m.precipitation_mean[i];
        const a = m.precipitation_anomaly[i];
        const tc = m.temperature_2m_mean[i];
        const ta = m.temperature_2m_anomaly[i];
        if (p == null || a == null || tc == null || ta == null) return null;
        const normal = p - a;
        const pct = normal > 5 ? round((100 * a) / normal, 0) : null;
        const signal: SeasonalMonth["signal"] = pct != null && pct >= 20 ? "wetter" : pct != null && pct <= -20 ? "drier" : "near-normal";
        return { month: t.slice(0, 7), precipMm: round(p), precipAnomMm: round(a), precipAnomPct: pct, tempC: round(tc), tempAnomC: round(ta), signal };
      })
      .filter((x): x is SeasonalMonth => x != null);
    if (!months.length) throw new Error("seasonal forecast unavailable here");
    const next3 = months.slice(0, 3);
    const rainA = next3.reduce((s, x) => s + x.precipAnomMm, 0);
    const rainN = next3.reduce((s, x) => s + (x.precipMm - x.precipAnomMm), 0);
    const pct = rainN > 10 ? Math.round((100 * rainA) / rainN) : 0;
    const tA = mean(next3.map((x) => x.tempAnomC));
    const rainTxt = Math.abs(pct) < 10 ? "near-normal rainfall" : `${Math.abs(pct)}% ${pct > 0 ? "more" : "less"} rain than normal`;
    return {
      model: "ECMWF SEAS5 seasonal ensemble mean (via Open-Meteo)",
      baseline: "model hindcast climatology",
      months,
      summary: `Next 3 months: ${rainTxt}, ${tA >= 0 ? "+" : ""}${tA.toFixed(1)} °C ${tA >= 0 ? "warmer" : "cooler"} than normal.`,
    };
  });
}

// ─── 40-year daily climate record (ERA5) ─────────────────────────────────
// ERA5 via the Open-Meteo archive API. A 41-year daily request is weighted as
// ~1 070 fair-use calls, so it runs through the heavy scheduler, only on demand
// (Climate / Drought tabs), and is cached on disk for a year per ~5 km cell.
// (NASA POWER was evaluated as a cheaper source but its bias-corrected
// precipitation is not homogeneous over monsoon Asia — e.g. Barisal jumps from
// ~2 000 to 6 600 mm/yr after 2015 — so it is unsuitable for trends.)

interface Era5Daily {
  start: string; // YYYY-MM-DD of index 0
  precip: (number | null)[];
  tmax: (number | null)[];
  source: string;
}

const HIST_START_YEAR = 1985;
const lastFullYear = () => new Date().getUTCFullYear() - 1;
const era5Key = (lat: number, lon: number) => `era5d:${ck(lat, lon)}:${HIST_START_YEAR}-${lastFullYear()}`;

function era5Daily(lat: number, lon: number, cacheOnly = false): Promise<Era5Daily> {
  if (cacheOnly)
    return peekPersisted<Era5Daily>(era5Key(lat, lon), 365 * DAY).then((v) => {
      if (!v) throw new Error("40-year record not computed yet (open the Climate history tab)");
      return v;
    });
  return persisted(era5Key(lat, lon), 365 * DAY, async () => {
    const y1 = lastFullYear();
    const r = await heavyFetch<{ daily: { time: string[]; precipitation_sum: (number | null)[]; temperature_2m_max: (number | null)[] } }>(
      `${ARCHIVE}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=${HIST_START_YEAR}-01-01&end_date=${y1}-12-31&daily=precipitation_sum,temperature_2m_max&timezone=auto`,
      requestWeight(2, (y1 - HIST_START_YEAR + 1) * 365),
      90000
    );
    const d = r.daily;
    if (!d?.time?.length) throw new Error("ERA5 archive returned no data");
    return {
      start: d.time[0]!,
      precip: d.precipitation_sum.map((v) => (v == null ? null : Math.round(v * 10) / 10)),
      tmax: d.temperature_2m_max.map((v) => (v == null ? null : Math.round(v * 10) / 10)),
      source: "ERA5 reanalysis (ECMWF / Copernicus C3S) via Open-Meteo archive API",
    };
  }, { negativeTtlMs: 3 * 60_000 });
}

export interface AnnualClimate {
  year: number;
  rainMm: number;
  maxDailyRainMm: number;
  wettest3dMm: number;
  hottestDayC: number | null;
  hotDays: number; // Tmax ≥ 35 °C
  heavyRainDays: number; // ≥ 50 mm
  longestDrySpellDays: number;
}

export interface ClimateHistory {
  source: string;
  period: [number, number];
  annual: AnnualClimate[];
  trends: { rain: Trend; maxDaily: Trend; wettest3d: Trend; hottestDay: Trend; hotDays: Trend; drySpell: Trend };
  returnPeriods: { years: number; dailyRainMm: number; threeDayRainMm: number }[];
  gumbel: { daily: GumbelFit | null; threeDay: GumbelFit | null };
  normals: { month: number; rainMm: number; tMaxC: number | null }[];
  summary: { meanAnnualRainMm: number; meanHotDays: number; meanHottestDayC: number | null; rainTrendPctPerDecade: number; hottestYear: number | null; wettestYear: number | null; driestYear: number | null };
  headline: string[];
}

function yearSlices(e: Era5Daily): { year: number; from: number; to: number }[] {
  const out: { year: number; from: number; to: number }[] = [];
  const t0 = Date.parse(`${e.start}T00:00:00Z`);
  const y0 = Number(e.start.slice(0, 4));
  for (let y = y0; ; y++) {
    const from = Math.round((Date.UTC(y, 0, 1) - t0) / DAY);
    const to = Math.round((Date.UTC(y + 1, 0, 1) - t0) / DAY);
    if (from >= e.precip.length) break;
    out.push({ year: y, from: Math.max(0, from), to: Math.min(e.precip.length, to) });
  }
  return out;
}

export function summariseHistory(e: Era5Daily): ClimateHistory {
  const annual: AnnualClimate[] = yearSlices(e)
    .filter((s) => s.to - s.from >= 360)
    .map(({ year, from, to }) => {
      const p = e.precip.slice(from, to);
      const t = e.tmax.slice(from, to).filter((v): v is number => v != null);
      return {
        year,
        rainMm: Math.round(p.reduce<number>((s, v) => s + (v ?? 0), 0)),
        maxDailyRainMm: round(Math.max(0, ...p.map((v) => v ?? 0))),
        wettest3dMm: round(maxRollingSum(p, 3)),
        hottestDayC: t.length ? round(Math.max(...t)) : null,
        hotDays: t.filter((v) => v >= 35).length,
        heavyRainDays: p.filter((v) => (v ?? 0) >= 50).length,
        longestDrySpellDays: longestDrySpell(p, 1),
      };
    });
  const tr = (k: keyof AnnualClimate) => linearTrend(annual.map((a) => ({ x: a.year, y: a[k] as number | null })));
  const trends = { rain: tr("rainMm"), maxDaily: tr("maxDailyRainMm"), wettest3d: tr("wettest3dMm"), hottestDay: tr("hottestDayC"), hotDays: tr("hotDays"), drySpell: tr("longestDrySpellDays") };
  const gd = gumbelFit(annual.map((a) => a.maxDailyRainMm));
  const g3 = gumbelFit(annual.map((a) => a.wettest3dMm));
  const returnPeriods = [2, 5, 10, 25, 50].map((T) => ({ years: T, dailyRainMm: gd ? Math.round(gumbelReturnLevel(gd, T)) : 0, threeDayRainMm: g3 ? Math.round(gumbelReturnLevel(g3, T)) : 0 }));

  // 1991-2020 monthly normals (WMO standard period, clipped to available data)
  const t0 = Date.parse(`${e.start}T00:00:00Z`);
  const mRain = Array.from({ length: 12 }, () => 0);
  const mT: number[][] = Array.from({ length: 12 }, () => []);
  const yrs = new Set<number>();
  e.precip.forEach((v, i) => {
    const d = new Date(t0 + i * DAY);
    const y = d.getUTCFullYear();
    if (y < 1991 || y > 2020) return;
    yrs.add(y);
    mRain[d.getUTCMonth()]! += v ?? 0;
    const tv = e.tmax[i];
    if (tv != null) mT[d.getUTCMonth()]!.push(tv);
  });
  const ny = Math.max(1, yrs.size);
  const normals = mRain.map((r, m) => ({ month: m + 1, rainMm: Math.round(r / ny), tMaxC: mT[m]!.length ? round(mean(mT[m]!)) : null }));

  const meanRain = mean(annual.map((a) => a.rainMm));
  const hottestVals = annual.filter((a) => a.hottestDayC != null);
  const by = <K extends keyof AnnualClimate>(k: K, dir: 1 | -1) =>
    annual.length ? annual.reduce((b, a) => ((a[k] as number) * dir > (b[k] as number) * dir ? a : b)).year : null;
  const summary = {
    meanAnnualRainMm: Math.round(meanRain),
    meanHotDays: round(mean(annual.map((a) => a.hotDays))),
    meanHottestDayC: hottestVals.length ? round(mean(hottestVals.map((a) => a.hottestDayC!))) : null,
    rainTrendPctPerDecade: meanRain > 0 ? round((100 * trends.rain.slopePerDecade) / meanRain) : 0,
    hottestYear: hottestVals.length ? hottestVals.reduce((b, a) => (a.hottestDayC! > b.hottestDayC! ? a : b)).year : null,
    wettestYear: by("rainMm", 1),
    driestYear: by("rainMm", -1),
  };
  const headline: string[] = [];
  const sig = (t: Trend) => (t.significant ? "statistically significant" : "not statistically significant");
  headline.push(`Average rainfall is ${summary.meanAnnualRainMm.toLocaleString("en-US")} mm/yr; the trend is ${summary.rainTrendPctPerDecade >= 0 ? "+" : ""}${summary.rainTrendPctPerDecade}% per decade (${sig(trends.rain)}).`);
  if (trends.maxDaily.slopePerDecade !== 0) headline.push(`The wettest day of the year has ${trends.maxDaily.slopePerDecade > 0 ? "intensified" : "weakened"} by ${Math.abs(round(trends.maxDaily.slopePerDecade))} mm per decade (${sig(trends.maxDaily)}).`);
  if (summary.meanHottestDayC != null) headline.push(`The hottest day of the year averages ${summary.meanHottestDayC} °C and is changing ${trends.hottestDay.slopePerDecade >= 0 ? "+" : ""}${round(trends.hottestDay.slopePerDecade, 2)} °C per decade (${sig(trends.hottestDay)}).`);
  if (gd) headline.push(`A 1-in-10-year day brings about ${returnPeriods[2]!.dailyRainMm} mm of rain; a 1-in-25-year day about ${returnPeriods[3]!.dailyRainMm} mm.`);

  return {
    source: e.source,
    period: [annual[0]?.year ?? HIST_START_YEAR, annual[annual.length - 1]?.year ?? lastFullYear()],
    annual,
    trends,
    returnPeriods,
    gumbel: { daily: gd, threeDay: g3 },
    normals,
    summary,
    headline,
  };
}

export function getClimateHistory(lat: number, lon: number, opts: { cacheOnly?: boolean } = {}): Promise<ClimateHistory> {
  if (opts.cacheOnly) return era5Daily(lat, lon, true).then(summariseHistory);
  return cached(`climhist:${ck(lat, lon)}:${lastFullYear()}`, 12 * 3600_000, async () => summariseHistory(await era5Daily(lat, lon)));
}

// ─── Drought index (SPI) ────────────────────────────────────────────────

export interface DroughtIndex {
  asOf: string;
  spi30: number | null;
  spi90: number | null;
  rain30Mm: number;
  rain90Mm: number;
  normal30Mm: number;
  normal90Mm: number;
  pctOfNormal30: number | null;
  pctOfNormal90: number | null;
  category30: string;
  category90: string;
  severity: "wet" | "normal" | "moderate" | "severe" | "extreme";
  /** 0-100 drought score contribution */
  score: number;
  referenceYears: number;
}

/** Totals over `window` days ending at month/day of `end` in each full year of the record. */
function sameSeasonTotals(e: Era5Daily, end: Date, window: number): number[] {
  const t0 = Date.parse(`${e.start}T00:00:00Z`);
  const out: number[] = [];
  const y0 = Number(e.start.slice(0, 4));
  const y1 = Number(new Date(t0 + (e.precip.length - 1) * DAY).toISOString().slice(0, 4));
  const m = end.getUTCMonth();
  const d = Math.min(end.getUTCDate(), m === 1 ? 28 : 31);
  for (let y = y0 + 1; y <= y1; y++) {
    const idx = Math.round((Date.UTC(y, m, d) - t0) / DAY);
    if (idx - window + 1 < 0 || idx >= e.precip.length) continue;
    let s = 0;
    let missing = 0;
    for (let i = idx - window + 1; i <= idx; i++) {
      const v = e.precip[i];
      if (v == null) missing++;
      else s += v;
    }
    if (missing < window * 0.1) out.push(s);
  }
  return out;
}

export function computeDrought(e: Era5Daily, recent: { time: string[]; precip: (number | null)[] }): DroughtIndex {
  const valid = recent.time.map((t, i) => ({ t, v: recent.precip[i] })).filter((x) => x.v != null) as { t: string; v: number }[];
  if (valid.length < 60) throw new Error("not enough recent data for SPI");
  const last = valid[valid.length - 1]!;
  const end = new Date(`${last.t}T00:00:00Z`);
  const r30 = valid.slice(-30).reduce((s, x) => s + x.v, 0);
  const r90 = valid.slice(-90).reduce((s, x) => s + x.v, 0);
  const ref30 = sameSeasonTotals(e, end, 30);
  const ref90 = sameSeasonTotals(e, end, 90);
  const s30 = spi(ref30, r30);
  const s90 = spi(ref90, r90);
  const n30 = mean(ref30);
  const n90 = mean(ref90);
  const worst = Math.min(s30 ?? 0, s90 ?? 0);
  const cat = spiCategory(worst);
  return {
    asOf: last.t,
    spi30: s30 == null ? null : round(s30, 2),
    spi90: s90 == null ? null : round(s90, 2),
    rain30Mm: Math.round(r30),
    rain90Mm: Math.round(r90),
    normal30Mm: Math.round(n30),
    normal90Mm: Math.round(n90),
    pctOfNormal30: n30 > 5 ? Math.round((100 * r30) / n30) : null,
    pctOfNormal90: n90 > 5 ? Math.round((100 * r90) / n90) : null,
    category30: spiCategory(s30).label,
    category90: spiCategory(s90).label,
    severity: cat.severity,
    // SPI −0.5 → 0, −2.5 → 100
    score: Math.round(Math.min(100, Math.max(0, ((-worst - 0.5) / 2) * 100))),
    referenceYears: ref30.length,
  };
}

export async function getDroughtIndex(lat: number, lon: number, opts: { cacheOnly?: boolean } = {}): Promise<DroughtIndex> {
  const hist = await era5Daily(lat, lon, opts.cacheOnly);
  const recent = await getHistory({ lat, lon }, 100);
  return computeDrought(hist, { time: recent.daily.time, precip: recent.daily.precipitation_sum });
}

// ─── CMIP6 climate projection ───────────────────────────────────────────
// Five HighResMIP models in ONE request per 10-year window: Open-Meteo weights a
// request by max(1, variables/10) × days/14, so 5 models × 2 variables cost the
// same as one model. Two windows ≈ 520 weighted calls per site, cached 1 year.

export const PROJECTION_MODELS = ["MRI_AGCM3_2_S", "EC_Earth3P_HR", "CMCC_CM2_VHR4", "MPI_ESM1_2_XR", "FGOALS_f3_H"] as const;
const MODEL_LABEL: Record<string, string> = {
  MRI_AGCM3_2_S: "MRI-AGCM3-2-S (Japan, 20 km)",
  EC_Earth3P_HR: "EC-Earth3P-HR (Europe, 36 km)",
  CMCC_CM2_VHR4: "CMCC-CM2-VHR4 (Italy, 18 km)",
  MPI_ESM1_2_XR: "MPI-ESM1-2-XR (Germany, 34 km)",
  FGOALS_f3_H: "FGOALS-f3-H (China, 28 km)",
};
const BASE: [number, number] = [2005, 2014];
const FUT: [number, number] = [2045, 2054];

interface WindowStats {
  annualRainMm: number;
  heavyRainDays: number; // ≥ 50 mm/day per year
  hotDays: number; // Tmax ≥ 35 °C per year
  tmaxMeanC: number;
  rx1dayMm: number; // mean annual max daily rain
}

export function windowStats(time: string[], precip: (number | null)[], tmax: (number | null)[], years: number): WindowStats | null {
  const p = nums(precip);
  const t = nums(tmax).filter((v): v is number => v != null);
  if (p.filter((v) => v != null).length < 300 || t.length < 300) return null;
  const byYear = new Map<string, number>();
  time.forEach((ts, i) => {
    const y = ts.slice(0, 4);
    byYear.set(y, Math.max(byYear.get(y) ?? 0, p[i] ?? 0));
  });
  return {
    annualRainMm: Math.round(p.reduce<number>((s, v) => s + (v ?? 0), 0) / years),
    heavyRainDays: round(p.filter((v) => (v ?? 0) >= 50).length / years),
    hotDays: round(t.filter((v) => v >= 35).length / years),
    tmaxMeanC: round(mean(t)),
    rx1dayMm: round(mean([...byYear.values()])),
  };
}

async function windowAllModels(lat: number, lon: number, [y0, y1]: [number, number]): Promise<Record<string, WindowStats>> {
  return persisted(`cmip5m:${ck(lat, lon, 0.1)}:${y0}-${y1}`, 365 * DAY, async () => {
    const r = await heavyFetch<{ daily: Record<string, (number | null)[]> & { time: string[] } }>(
      `${CLIMATE}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=${y0}-01-01&end_date=${y1}-12-31&models=${PROJECTION_MODELS.join(",")}&daily=precipitation_sum,temperature_2m_max`,
      requestWeight(2 * PROJECTION_MODELS.length, (y1 - y0 + 1) * 365),
      60000
    );
    const out: Record<string, WindowStats> = {};
    for (const m of PROJECTION_MODELS) {
      const st = windowStats(r.daily.time, r.daily[`precipitation_sum_${m}`] ?? [], r.daily[`temperature_2m_max_${m}`] ?? [], y1 - y0 + 1);
      if (st) out[m] = st;
    }
    if (!Object.keys(out).length) throw new Error("no CMIP6 model data at this location");
    return out;
  }, { negativeTtlMs: 5 * 60_000 });
}

export interface ProjectionModel {
  model: string;
  label: string;
  baseline: WindowStats;
  future: WindowStats;
  change: { annualRainPct: number; heavyRainDays: number; hotDays: number; tmaxC: number; rx1dayPct: number };
}
export interface ClimateProjection {
  scenario: string;
  baseline: string;
  future: string;
  models: ProjectionModel[];
  ensemble: { annualRainPct: Range; heavyRainDays: Range; hotDays: Range; tmaxC: Range; rx1dayPct: Range };
  caveat: string;
}
export interface Range {
  mean: number;
  min: number;
  max: number;
}

const rng = (a: number[], d = 1): Range => ({ mean: round(mean(a), d), min: round(Math.min(...a), d), max: round(Math.max(...a), d) });
const pctChange = (b: number, f: number) => (b > 0 ? round((100 * (f - b)) / b) : 0);

/** `cacheOnly`: resolve from disk if already computed, otherwise throw (no upstream call). */
export function getProjection(lat: number, lon: number, opts: { cacheOnly?: boolean } = {}): Promise<ClimateProjection> {
  return cached(`proj:${ck(lat, lon, 0.1)}${opts.cacheOnly ? ":peek" : ""}`, opts.cacheOnly ? 60_000 : 24 * 3600_000, async () => {
    let base: Record<string, WindowStats> | null;
    let fut: Record<string, WindowStats> | null;
    if (opts.cacheOnly) {
      base = await peekPersisted<Record<string, WindowStats>>(`cmip5m:${ck(lat, lon, 0.1)}:${BASE[0]}-${BASE[1]}`, 365 * DAY);
      fut = await peekPersisted<Record<string, WindowStats>>(`cmip5m:${ck(lat, lon, 0.1)}:${FUT[0]}-${FUT[1]}`, 365 * DAY);
      if (!base || !fut) throw new Error("not computed yet (open the Outlook tab)");
    } else {
      // sequential: each 10-year multi-model request is heavy for the upstream fair-use limit
      base = await windowAllModels(lat, lon, BASE);
      fut = await windowAllModels(lat, lon, FUT);
    }
    const models: ProjectionModel[] = PROJECTION_MODELS.filter((m) => base[m] && fut[m]).map((model) => {
      const baseline = base[model]!;
      const future = fut[model]!;
      return {
        model,
        label: MODEL_LABEL[model] ?? model,
        baseline,
        future,
        change: {
          annualRainPct: pctChange(baseline.annualRainMm, future.annualRainMm),
          heavyRainDays: round(future.heavyRainDays - baseline.heavyRainDays),
          hotDays: round(future.hotDays - baseline.hotDays),
          tmaxC: round(future.tmaxMeanC - baseline.tmaxMeanC),
          rx1dayPct: pctChange(baseline.rx1dayMm, future.rx1dayMm),
        },
      };
    });
    if (!models.length) throw new Error("no projection models available here");
    const c = (k: keyof ProjectionModel["change"]) => rng(models.map((m) => m.change[k]));
    return {
      scenario: "CMIP6 HighResMIP highresSST-future (SSP5-8.5 forcing — a high-emissions pathway)",
      baseline: `${BASE[0]}–${BASE[1]}`,
      future: `${FUT[0]}–${FUT[1]} (around 2050)`,
      models,
      ensemble: { annualRainPct: c("annualRainPct"), heavyRainDays: c("heavyRainDays"), hotDays: c("hotDays"), tmaxC: c("tmaxC"), rx1dayPct: c("rx1dayPct") },
      caveat: `Changes are computed within each model (future minus its own baseline) to cancel model bias; ${models.length} models, the spread between them is part of the uncertainty. 10-year windows — year-to-year variability adds noise, especially for extremes. Not a forecast of any particular year.`,
    };
  });
}

// ─── GloFAS river history ───────────────────────────────────────────────

export interface RiverHistory {
  period: [number, number];
  recordDays: number;
  meanM3s: number;
  significantRiver: boolean;
  current: { date: string; valueM3s: number; percentileAll: number; percentileSeason: number } | null;
  forecastPeak: { date: string; valueM3s: number; percentileAll: number; returnPeriodYears: number | null } | null;
  returnLevels: { years: number; dischargeM3s: number }[];
  annualMax: { year: number; valueM3s: number }[];
  /** day-of-year (1-366) → p10/p50/p90 of the record within ±7 days */
  seasonalBand: { doy: number; p10: number; p50: number; p90: number }[];
  recordMax: { date: string; valueM3s: number } | null;
  summary: string;
}

export const dayOfYear = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1;
};

interface GlofasRecord {
  time: string[];
  q: (number | null)[];
}

/** Years of GloFAS reanalysis used for percentiles/return levels (each year ≈ 26 weighted calls). */
const RIVER_YEARS = 10;

async function glofasRecord(lat: number, lon: number, cacheOnly = false): Promise<GlofasRecord> {
  const today = ymd(new Date());
  const y0 = new Date().getUTCFullYear() - RIVER_YEARS;
  const key = `glofas-rec:${ck(lat, lon)}:${y0}:${today.slice(0, 7)}`;
  if (cacheOnly) {
    const v = await peekPersisted<GlofasRecord>(key, 30 * DAY);
    if (!v) throw new Error("river record not computed yet (open the Flood tab)");
    return v;
  }
  return persisted(key, 30 * DAY, async () => {
    const r = await heavyFetch<{ daily: { time: string[]; river_discharge: (number | null)[] } }>(
      `${FLOOD}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=${y0}-01-01&end_date=${ymd(new Date(Date.now() - 2 * DAY))}&daily=river_discharge`,
      requestWeight(1, (RIVER_YEARS + 1) * 365),
      60000
    );
    return { time: r.daily.time, q: r.daily.river_discharge.map((v) => (v == null ? null : Math.round(v * 10) / 10)) };
  }, { negativeTtlMs: 3 * 60_000 });
}

export function summariseRiver(rec: GlofasRecord, recentSeries: { date: string; value: number | null }[]): RiverHistory {
  const vals = rec.q.filter((v): v is number => v != null);
  if (vals.length < 5 * 365) throw new Error("GloFAS record too short");
  const byDoy: number[][] = Array.from({ length: 367 }, () => []);
  rec.time.forEach((t, i) => {
    const v = rec.q[i];
    if (v != null) byDoy[dayOfYear(t)]!.push(v);
  });
  const seasonalBand = Array.from({ length: 366 }, (_, k) => {
    const doy = k + 1;
    const pool: number[] = [];
    for (let o = -7; o <= 7; o++) pool.push(...(byDoy[((doy - 1 + o + 366) % 366) + 1] ?? []));
    return { doy, p10: round(quantile(pool, 0.1)), p50: round(quantile(pool, 0.5)), p90: round(quantile(pool, 0.9)) };
  });
  const annual = new Map<number, number>();
  rec.time.forEach((t, i) => {
    const v = rec.q[i];
    const y = Number(t.slice(0, 4));
    if (v != null) annual.set(y, Math.max(annual.get(y) ?? 0, v));
  });
  const thisYear = new Date().getUTCFullYear();
  const annualMax = [...annual.entries()].filter(([y]) => y < thisYear).map(([year, valueM3s]) => ({ year, valueM3s: round(valueM3s) }));
  const fit = gumbelFit(annualMax.map((a) => a.valueM3s));
  const returnLevels = fit ? [2, 5, 10, 25, 50].map((years) => ({ years, dischargeM3s: Math.round(gumbelReturnLevel(fit, years)) })) : [];
  const today = ymd(new Date());
  const past = recentSeries.filter((s) => s.date <= today && s.value != null);
  const fut = recentSeries.filter((s) => s.date >= today && s.value != null);
  const cur = past[past.length - 1];
  const seasonPool = (iso: string) => {
    const doy = dayOfYear(iso);
    const pool: number[] = [];
    for (let o = -15; o <= 15; o++) pool.push(...(byDoy[((doy - 1 + o + 366) % 366) + 1] ?? []));
    return pool;
  };
  const peak = fut.length ? fut.reduce((b, s) => (s.value! > b.value! ? s : b)) : null;
  let recordMax: RiverHistory["recordMax"] = null;
  rec.q.forEach((v, i) => {
    if (v != null && (!recordMax || v > recordMax.valueM3s)) recordMax = { date: rec.time[i]!, valueM3s: v };
  });
  const meanQ = mean(vals);
  const out: RiverHistory = {
    period: [Number(rec.time[0]!.slice(0, 4)), Number(rec.time[rec.time.length - 1]!.slice(0, 4))],
    recordDays: vals.length,
    meanM3s: round(meanQ),
    significantRiver: meanQ >= 5,
    current: cur ? { date: cur.date, valueM3s: round(cur.value!), percentileAll: round(percentileRank(vals, cur.value!), 0), percentileSeason: round(percentileRank(seasonPool(cur.date), cur.value!), 0) } : null,
    forecastPeak: peak ? { date: peak.date, valueM3s: round(peak.value!), percentileAll: round(percentileRank(vals, peak.value!), 0), returnPeriodYears: fit ? round(gumbelReturnPeriod(fit, peak.value!), 1) : null } : null,
    returnLevels,
    annualMax,
    seasonalBand,
    recordMax,
    summary: "",
  };
  if (!out.significantRiver) out.summary = "No major river channel at this point in the GloFAS network (mean flow < 5 m³/s) — local flooding here is driven by rainfall, not river overflow.";
  else if (out.current) {
    const ps = out.current.percentileSeason;
    const rp = out.forecastPeak?.returnPeriodYears;
    out.summary = `River flow is at the ${ordinal(ps)} percentile for this time of year (${ps >= 90 ? "unusually high" : ps <= 10 ? "unusually low" : "within the normal range"})${rp && rp >= 2 ? `; the forecast peak is roughly a 1-in-${Math.round(rp)}-year flow` : ""}.`;
  }
  return out;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export async function getRiverHistory(lat: number, lon: number, recentSeries: { date: string; value: number | null }[], opts: { cacheOnly?: boolean } = {}): Promise<RiverHistory> {
  const rec = await glofasRecord(lat, lon, opts.cacheOnly);
  return summariseRiver(rec, recentSeries);
}

// ─── Heat stress (from hourly forecast) ─────────────────────────────────

export interface HeatStress {
  days: { date: string; tMaxC: number; heatIndexMaxC: number; wetBulbMaxC: number; category: string }[];
  heatIndexMaxC: number;
  wetBulbMaxC: number;
  category: string;
  level: 0 | 1 | 2 | 3 | 4;
  dangerHours: number; // hours with heat index ≥ 41 °C
  labourAdvice: string;
  score: number;
}

export function heatStressFromHourly(h: Pick<HourlyForecast, "time" | "temperature_2m" | "relative_humidity_2m">, fromIdx = 0): HeatStress | null {
  const byDay = new Map<string, { t: number; hi: number; wb: number }>();
  let danger = 0;
  for (let i = fromIdx; i < h.time.length; i++) {
    const t = h.temperature_2m[i];
    const rh = h.relative_humidity_2m[i];
    if (t == null || rh == null) continue;
    const hi = heatIndexC(t, rh);
    const wb = wetBulbC(t, rh);
    if (hi >= 41) danger++;
    const day = h.time[i]!.slice(0, 10);
    const cur = byDay.get(day) ?? { t: -99, hi: -99, wb: -99 };
    byDay.set(day, { t: Math.max(cur.t, t), hi: Math.max(cur.hi, hi), wb: Math.max(cur.wb, wb) });
  }
  if (!byDay.size) return null;
  const days = [...byDay.entries()].map(([date, v]) => ({ date, tMaxC: round(v.t), heatIndexMaxC: round(v.hi), wetBulbMaxC: round(v.wb), category: heatIndexCategory(v.hi).label }));
  const hiMax = Math.max(...days.map((d) => d.heatIndexMaxC));
  const wbMax = Math.max(...days.map((d) => d.wetBulbMaxC));
  const cat = heatIndexCategory(hiMax);
  const labourAdvice =
    wbMax >= 31
      ? "Wet-bulb above 31 °C: stop heavy outdoor work at midday; the body cannot cool itself."
      : wbMax >= 28 || cat.level >= 3
        ? "High heat stress: shift field work to early morning/evening, 15-min shade breaks every hour, water every 20 min."
        : cat.level === 2
          ? "Extreme caution: schedule strenuous tasks before 10:00 and ensure drinking water in the field."
          : "No special heat precautions needed this week.";
  const score = Math.round(Math.min(100, Math.max(0, ((hiMax - 30) / 20) * 100, ((wbMax - 24) / 8) * 100)));
  return { days, heatIndexMaxC: hiMax, wetBulbMaxC: wbMax, category: cat.label, level: cat.level, dangerHours: danger, labourAdvice, score };
}

// ─── Recent 30-day rainfall (batched, for salinity dilution in portfolios) ──

/** Observed/analysed rainfall over the last 30 days for many points (Open-Meteo past_days, 1 call per 50 points). */
export function getPastRain30(points: { lat: number; lon: number }[]): Promise<(number | null)[]> {
  const key = points.map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join("|");
  return cached(`rain30:${key}`, 6 * 3600_000, async () => {
    const out: (number | null)[] = [];
    for (let i = 0; i < points.length; i += 50) {
      const chunk = points.slice(i, i + 50);
      const r = await fetchJson<{ daily: { precipitation_sum: (number | null)[] } } | { daily: { precipitation_sum: (number | null)[] } }[]>(
        `https://api.open-meteo.com/v1/forecast?latitude=${chunk.map((p) => p.lat.toFixed(3)).join(",")}&longitude=${chunk.map((p) => p.lon.toFixed(3)).join(",")}&daily=precipitation_sum&past_days=30&forecast_days=1&timezone=auto`,
        12000
      );
      const arr = Array.isArray(r) ? r : [r];
      arr.forEach((x) => out.push(x?.daily ? Math.round(x.daily.precipitation_sum.slice(0, 30).reduce<number>((s, v) => s + (v ?? 0), 0)) : null));
    }
    return out;
  });
}
