/**
 * In-season crop yield forecast — crop-stage aware, for every crop asset of a
 * workspace (insured units, loans, co-op farms) and for monitored districts.
 *
 *   Y = Y_trend · f_season · f_region  ·  f_water · f_heat · f_flood · f_salinity · f_ndvi  ·  ε
 *
 *  Y_trend     FAOSTAT national yield, OLS trend 2015-2024 evaluated at the harvest year
 *              (capped ±8 % around the 2020-24 normal), × seasonal factor (Aman vs Boro …)
 *              × sub-national factor (Odisha, DA&FW ASAG 2023)          → real/fao-yield-stats.json
 *  f_water     FAO-33 yield response  1 − Ya/Ym = Ky (1 − ETa/ETm), applied per growth stage
 *              (multiplicative), from a daily FAO-56 water balance (Kc curve, root-zone bucket,
 *              paddy pond + percolation for rice, irrigation reliability) driven by ERA5 /
 *              NASA POWER daily rain + ET0 (server/live/history.ts cache — no bulk calls).
 *              Observed season-to-date weather + each of the last 30 years' weather for the
 *              rest of the season (climatological analogue ensemble) → 30 members.
 *              Expressed relative to the same model run over those 30 past seasons, so the
 *              national normal (which already contains typical stress) is not double-counted.
 *  f_heat      Degree-days above the crop's anthesis threshold in a ±w day flowering window,
 *              loss = 1 − e^(−0.02·HDD), relative to its climatological mean.
 *  f_flood     Real GloFAS/ERA5 flood episodes (real/flood-events.json) overlapping the season:
 *              share flooded × damage (same curves as real/index.ts#floodLoss, episode days
 *              capped at 21) × stage sensitivity × asset exposure; remaining-season risk is
 *              sampled from past seasons; live 72-h flood probability above climatology adds
 *              an expected loss. Relative to the mean seasonal flood loss 2019 → last season.
 *  f_salinity  FAO-29 Maas–Hoffman  RY = 1 − b(ECe − a)/100 with season-mean ECe from the
 *              platform salinity model (scoring.ts#scoreSalinity) fed with observed vs normal
 *              30-day rainfall.
 *  f_ndvi      Latest NDVI (MODIS MOD13Q1 via the satellite-ingest job, else seeded field
 *              history) vs a reference crop NDVI profile for the stage; small elasticity,
 *              weighted by stage and data quality, capped at −12 / +6 %.
 *  ε           Structural error, CV 14 % pre-season → 6 % at harvest.
 *
 * Author: Nitya Prakash Pandey.
 */
import type { CropType } from "@agri-shield/types";
import { getStore, type AssetRecord, type DistrictRecord } from "../data/store";
import { countryStats, floodClimatology, floodEvents, floodPeriod, monthlyPrices, productionCostUsdHa, trailingMean, type FloodEvent } from "../data/real";
import faoJson from "../data/real/fao-yield-stats.json";
import coefJson from "../data/real/crop-coefficients.json";
import { scoreSalinity } from "../risk/scoring";
import { getHistoryBatch, gridKey, type DailyHistory, type HistoryPoint } from "../live/history";
import { exposurePriors } from "./location-risk";
import { effectiveScore } from "./portfolio";

const DAY = 86_400_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const iso = (t: number | Date) => new Date(t).toISOString().slice(0, 10);

// ─── Reference data ───────────────────────────────────────────────────────

interface CropJson {
  label: string;
  perennial?: boolean;
  stages: number[];
  kc: number[];
  ky: number[];
  kySeasonal: number;
  zr: number;
  p: number;
  paddy?: { pondMaxMm: number; percolationMmDay: number };
  heat: { tcrit: number; floweringFrac: number; windowDays: number } | null;
  salinity: { a: number; b: number };
  ndvi: { min: number; max: number; peakFrac: number; end: number };
  floodSensitivity: number[];
  assumed?: string;
  src: string;
}
interface SeasonDef {
  id: string;
  name: string;
  sow: string;
  days: number;
}
interface CoefFile {
  sources: Record<string, string>;
  soil: { tawMmPerM: number; note: string };
  crops: Record<string, CropJson>;
  calendars: Record<string, Record<string, SeasonDef[]>>;
  irrigatedShare: Record<string, number>;
  irrigationReliability: Record<string, number>;
}
interface FaoFile {
  source: string;
  years: number[];
  normalYears: [number, number];
  trendYears: [number, number];
  countries: Record<string, Record<string, { yieldTHa: (number | null)[]; areaHa: (number | null)[] | null }>>;
  subnational: Record<string, Record<string, { region: string; factor: number; source: string; url: string } | string> | string>;
  seasonFactor: Record<string, Record<string, number> | string>;
}
const COEF = coefJson as unknown as CoefFile;
const FAO = faoJson as unknown as FaoFile;

export type CropParams = CropJson & { key: string; tawMm: number };

export function cropParams(crop: string): CropParams | null {
  const c = COEF.crops[crop];
  if (!c) return null;
  return { ...c, key: crop, tawMm: COEF.soil.tawMmPerM * c.zr };
}
export const SUPPORTED_CROPS = Object.keys(COEF.crops);

const COUNTRY_CODE: Record<string, string> = { Bangladesh: "BD", India: "IN", Vietnam: "VN", "Viet Nam": "VN", Philippines: "PH", Indonesia: "ID" };
export function countryCodeOf(a: Pick<AssetRecord, "country" | "districtId">): string {
  const d = a.districtId ? getStore().districts.find((x) => x.id === a.districtId) : null;
  return d?.country ?? COUNTRY_CODE[a.country] ?? (a.country.length === 2 ? a.country.toUpperCase() : "BD");
}

// ─── Pure maths ───────────────────────────────────────────────────────────

/** Growth stage (0 initial · 1 development · 2 mid-season · 3 late) at fraction f of the season. */
export function stageAt(p: Pick<CropParams, "stages">, f: number): 0 | 1 | 2 | 3 {
  let acc = 0;
  for (let i = 0; i < 4; i++) {
    acc += p.stages[i]!;
    if (f < acc - 1e-9) return i as 0 | 1 | 2 | 3;
  }
  return 3;
}
export const STAGE_LABEL = ["Establishment", "Vegetative", "Flowering / yield formation", "Ripening"] as const;

/** FAO-56 crop coefficient curve (Kc_ini flat, linear to Kc_mid, flat, linear to Kc_end). */
export function kcAt(p: Pick<CropParams, "stages" | "kc">, f: number): number {
  const [li, ld, lm] = p.stages as [number, number, number, number];
  const [ki, km, ke] = p.kc as [number, number, number];
  if (f <= li) return ki;
  if (f <= li + ld) return ki + ((f - li) / ld) * (km - ki);
  if (f <= li + ld + lm) return km;
  return km + ((f - li - ld - lm) / Math.max(1e-9, 1 - li - ld - lm)) * (ke - km);
}

export interface DayWx {
  rain: number;
  et0: number;
  tmax: number;
}

export interface WaterResult {
  stageEta: number[];
  stageEtc: number[];
  etaMm: number;
  etcMm: number;
  rainMm: number;
  irrigationMm: number;
  percolationMm: number;
  stressDays: number;
  relYield: number;
}

/** Reservoir geometry: capacity C, readily-available depletion RAW (both mm). */
export function reservoir(p: CropParams) {
  const pond = p.paddy?.pondMaxMm ?? 0;
  const C = pond + p.tawMm;
  const RAW = pond + p.p * p.tawMm;
  return { C, RAW, pond };
}

/**
 * Daily FAO-56 root-zone water balance over the season (`days`), FAO-33 Ky per stage.
 * Depletion D (mm below full: flooded pond for rice, field capacity otherwise).
 * Irrigation with reliability r ∈ [0,1] refills r × D once the trigger is crossed
 * (rice: pond gone; others: D > RAW).
 */
export function simulateWater(days: DayWx[], p: CropParams, r: number, d0: number): WaterResult {
  const n = days.length;
  const { C, RAW, pond } = reservoir(p);
  const perc = p.paddy?.percolationMmDay ?? 0;
  const trigger = p.paddy ? pond : RAW;
  const stageEta = [0, 0, 0, 0];
  const stageEtc = [0, 0, 0, 0];
  let D = clamp(d0, 0, C);
  let rain = 0;
  let irr = 0;
  let percSum = 0;
  let stress = 0;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const w = days[i]!;
    const etc = kcAt(p, f) * Math.max(0, w.et0);
    const ks = D <= RAW ? 1 : clamp((C - D) / Math.max(1e-6, C - RAW), 0, 1);
    if (ks < 0.999) stress++;
    const eta = ks * etc;
    const s = stageAt(p, f);
    stageEta[s] += eta;
    stageEtc[s] += etc;
    const pc = pond > 0 && D < pond ? perc : 0;
    percSum += pc;
    D += eta + pc - Math.max(0, w.rain);
    rain += Math.max(0, w.rain);
    if (D < 0) D = 0; // excess runs off / overflows the bunds
    if (r > 0 && D > trigger) {
      const add = r * D;
      irr += add;
      D -= add;
    }
    D = clamp(D, 0, C);
  }
  return { stageEta, stageEtc, etaMm: sum(stageEta), etcMm: sum(stageEtc), rainMm: rain, irrigationMm: irr, percolationMm: percSum, stressDays: stress, relYield: kyYield(stageEta, stageEtc, p.ky) };
}

/** FAO-33 multiplicative stage form: Ya/Ym = Π (1 − Ky_i (1 − ETa_i/ETm_i)), clamped to [0.05, 1]. */
export function kyYield(stageEta: number[], stageEtc: number[], ky: number[]): number {
  let ry = 1;
  for (let i = 0; i < ky.length; i++) {
    const etm = stageEtc[i] ?? 0;
    if (etm <= 0) continue;
    const ratio = clamp((stageEta[i] ?? 0) / etm, 0, 1);
    ry *= clamp(1 - ky[i]! * (1 - ratio), 0, 1);
  }
  return clamp(ry, 0.05, 1);
}

/** Seasonal single-Ky form (FAO-33 eq.): Ya/Ym = 1 − Ky (1 − ETa/ETm). */
export function kySeasonal(eta: number, etm: number, ky: number): number {
  if (etm <= 0) return 1;
  return clamp(1 - ky * (1 - clamp(eta / etm, 0, 1)), 0, 1);
}

/** Heat damage at flowering: degree-days above the anthesis threshold → fractional loss. */
export const HEAT_K = 0.02;
export function heatDegreeDays(tmax: number[], tcrit: number): number {
  return tmax.reduce((a, t) => a + Math.max(0, t - tcrit), 0);
}
export function heatLoss(hdd: number): number {
  return clamp(1 - Math.exp(-HEAT_K * hdd), 0, 0.6);
}

/** FAO-29 Maas–Hoffman relative yield (0-1) for a root-zone ECe (dS/m). */
export function maasHoffman(ece: number, a: number, b: number): number {
  return clamp(1 - (b * Math.max(0, ece - a)) / 100, 0, 1);
}

/** Same flooded-share and damage curves as real/index.ts#floodLoss (README §1), episode days capped at 21. */
export function floodShareDamage(depthM: number, durationDays: number) {
  const days = Math.min(21, Math.max(1, durationDays));
  const share = clamp(0.005 + 0.35 * (1 - Math.exp(-depthM / 0.7)) * (0.4 + 0.6 * Math.min(1, days / 14)), 0.002, 0.5);
  const damage = clamp(0.2 + 0.6 * (1 - Math.exp(-depthM / 0.8)) + 0.012 * days, 0.1, 0.95);
  return { share, damage, expectedLoss: share * damage };
}

/** Reference NDVI trajectory for a crop at season fraction f (rise to peak, decline to `end`). */
export function ndviExpected(p: Pick<CropParams, "ndvi">, f: number): number {
  const { min, max, peakFrac, end } = p.ndvi;
  if (f <= peakFrac) return min + (max - min) * Math.sin((Math.PI / 2) * clamp(f / peakFrac, 0, 1));
  return max - (max - end) * clamp((f - peakFrac) / Math.max(1e-6, 1 - peakFrac), 0, 1);
}

/** NDVI adjustment factor: elasticity 0.5 on the anomaly, weighted by stage (none before 25 % of the season) and quality. */
export function ndviFactor(observed: number, expected: number, seasonFrac: number, quality: number): { factor: number; anomaly: number; weight: number } {
  const anomaly = expected > 0 ? (observed - expected) / expected : 0;
  const weight = clamp((seasonFrac - 0.25) / 0.35, 0, 1) * clamp(quality, 0, 1);
  return { factor: clamp(1 + weight * 0.5 * clamp(anomaly, -0.4, 0.25), 0.88, 1.06), anomaly, weight };
}

/** Ordinary least squares y = a + b·x evaluated at x0 (nulls skipped). */
export function olsAt(xs: number[], ys: (number | null)[], x0: number): number | null {
  const pts = xs.map((x, i) => [x, ys[i]] as const).filter((p): p is readonly [number, number] => p[1] != null && Number.isFinite(p[1]));
  if (pts.length < 3) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  const sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
  const b = sxx > 0 ? sxy / sxx : 0;
  return my + b * (x0 - mx);
}

export function quantile(values: number[], q: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = clamp(q, 0, 1) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : NaN);

/** z-scores of the 10/30/50/70/90th percentiles — deterministic structural-error sampling. */
const Z = [-1.2816, -0.5244, 0, 0.5244, 1.2816];
export function modelCv(observedFrac: number, fallback: boolean): number {
  return fallback ? 0.16 : clamp(0.14 - 0.08 * observedFrac, 0.06, 0.14);
}

/** P10/P50/P90/mean of member factors × lognormal-ish structural error. */
export function bands(members: number[], cv: number) {
  const s: number[] = [];
  for (const m of members) for (const z of Z) s.push(m * Math.max(0.05, 1 + z * cv));
  return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9), mean: mean(s), samples: s };
}

// ─── Baselines (FAOSTAT) ──────────────────────────────────────────────────

export interface Baseline {
  normalTHa: number;
  trendTHa: number;
  nationalNormalTHa: number;
  seasonFactor: number;
  regionFactor: number;
  regionNote: string | null;
  series: { year: number; yieldTHa: number | null }[];
  source: string;
  proxy: string | null;
}

export function baselineFor(country: string, crop: string, seasonId: string, harvestYear: number): Baseline | null {
  let proxy: string | null = null;
  let row = FAO.countries[country]?.[crop];
  if (!row) {
    // closest available country for the crop (documented as a proxy)
    const alt = ["BD", "IN", "VN", "PH", "ID"].find((c) => FAO.countries[c]?.[crop]);
    if (!alt) return null;
    row = FAO.countries[alt]![crop]!;
    proxy = `FAOSTAT has no ${crop} series for ${country}; ${alt} national yield used as a proxy`;
  }
  const years = FAO.years;
  const [n0, n1] = FAO.normalYears;
  const normVals = years.map((y, i) => (y >= n0 && y <= n1 ? row!.yieldTHa[i] : null)).filter((v): v is number => v != null);
  const nationalNormal = mean(normVals);
  if (!Number.isFinite(nationalNormal)) return null;
  const trendRaw = olsAt(years, row.yieldTHa, harvestYear) ?? nationalNormal;
  const trend = clamp(trendRaw, nationalNormal * 0.92, nationalNormal * 1.08);
  const sf = FAO.seasonFactor[country];
  const seasonFactor = crop === "rice" && typeof sf === "object" ? (sf[seasonId] ?? 1) : 1;
  const sub = FAO.subnational[country];
  const subRow = typeof sub === "object" ? sub[crop] : undefined;
  const region = typeof subRow === "object" ? subRow : null;
  const regionFactor = region ? region.factor : 1;
  return {
    nationalNormalTHa: r3(nationalNormal),
    normalTHa: r3(nationalNormal * seasonFactor * regionFactor),
    trendTHa: r3(trend * seasonFactor * regionFactor),
    seasonFactor,
    regionFactor,
    regionNote: region ? `${region.region}: ${region.source}` : null,
    series: years.map((y, i) => ({ year: y, yieldTHa: row!.yieldTHa[i] ?? null })),
    source: "FAOSTAT QCL (CC BY 4.0), retrieved 2026-09-29",
    proxy,
  };
}

// ─── Crop calendar ────────────────────────────────────────────────────────

export type SeasonStatus = "pre_season" | "in_season" | "harvested";
export interface SeasonWindow {
  id: string;
  name: string;
  sow: string;
  harvest: string;
  days: number;
  sowYear: number;
  harvestYear: number;
  status: SeasonStatus;
  /** fraction of the season elapsed at `now` (0-1) */
  progress: number;
  stage: string;
}

function seasonsOf(country: string, crop: string): SeasonDef[] {
  return COEF.calendars[country]?.[crop] ?? COEF.calendars._default?.[crop] ?? COEF.calendars._default!.rice!;
}

function windowFor(def: SeasonDef, year: number, p: CropParams | null, now: number): SeasonWindow {
  const sowT = Date.parse(`${year}-${def.sow}T00:00:00Z`);
  const harvT = sowT + (def.days - 1) * DAY;
  const progress = clamp((now - sowT) / (def.days * DAY), 0, 1);
  const status: SeasonStatus = now < sowT ? "pre_season" : now > harvT + DAY - 1 ? "harvested" : "in_season";
  return {
    id: def.id,
    name: `${def.name} ${new Date(harvT).getUTCFullYear() !== year ? `${year}-${String(new Date(harvT).getUTCFullYear()).slice(2)}` : year}`,
    sow: iso(sowT),
    harvest: iso(harvT),
    days: def.days,
    sowYear: year,
    harvestYear: new Date(harvT).getUTCFullYear(),
    status,
    progress: r3(progress),
    stage: status === "pre_season" ? "Not yet sown" : status === "harvested" ? "Harvested" : p ? STAGE_LABEL[stageAt(p, progress)] : "In season",
  };
}

/** Season containing `now`; else the latest harvested within 120 days; else the next one. */
export function pickSeason(country: string, crop: string, now = Date.now(), preferId?: string): SeasonWindow {
  const p = cropParams(crop);
  const y = new Date(now).getUTCFullYear();
  const defs = seasonsOf(country, crop).filter((d) => !preferId || d.id === preferId);
  const all = (defs.length ? defs : seasonsOf(country, crop)).flatMap((d) => [y - 1, y, y + 1].map((yy) => windowFor(d, yy, p, now)));
  const inSeason = all.filter((w) => w.status === "in_season").sort((a, b) => b.sow.localeCompare(a.sow));
  if (inSeason.length) return inSeason[0]!;
  const recent = all.filter((w) => w.status === "harvested" && now - Date.parse(w.harvest) <= 120 * DAY).sort((a, b) => b.harvest.localeCompare(a.harvest));
  if (recent.length) return recent[0]!;
  return all.filter((w) => w.status === "pre_season").sort((a, b) => a.sow.localeCompare(b.sow))[0]!;
}

// ─── Weather access over a DailyHistory ───────────────────────────────────

interface Wx {
  h: DailyHistory;
  t0: number;
  lastObsIdx: number;
  fill: { et0: number; tmax: number };
}
function wxOf(h: DailyHistory): Wx {
  let last = h.time.length - 1;
  while (last > 0 && h.rain[last] == null) last--;
  const et0s = h.et0.slice(-3650).filter((v): v is number => v != null);
  const tx = h.tmax.slice(-3650).filter((v): v is number => v != null);
  return { h, t0: Date.parse(`${h.time[0]}T00:00:00Z`), lastObsIdx: last, fill: { et0: et0s.length ? mean(et0s) : 4, tmax: tx.length ? mean(tx) : 30 } };
}
const idxOf = (wx: Wx, isoDate: string) => Math.round((Date.parse(`${isoDate}T00:00:00Z`) - wx.t0) / DAY);
function day(wx: Wx, i: number): DayWx {
  const h = wx.h;
  return { rain: h.rain[i] ?? 0, et0: h.et0[i] ?? wx.fill.et0, tmax: h.tmax[i] ?? wx.fill.tmax };
}
function shiftYears(isoDate: string, dy: number): string {
  const y = Number(isoDate.slice(0, 4)) + dy;
  const md = isoDate.slice(5) === "02-29" ? "02-28" : isoDate.slice(5);
  return `${y}-${md}`;
}

// ─── Flood component ──────────────────────────────────────────────────────

interface FloodCtx {
  events: FloodEvent[];
  recordYears: number[];
  recordEnd: string;
  meanEventLoss: number;
}
function floodCtx(districtId: string | null): FloodCtx {
  const events = districtId ? floodEvents(districtId) : [];
  const [p0, p1] = floodPeriod();
  const years: number[] = [];
  for (let y = Number(p0.slice(0, 4)); y <= Number(p1.slice(0, 4)); y++) years.push(y);
  const losses = events.map((e) => floodShareDamage(e.depthM, e.durationDays).expectedLoss);
  return { events, recordYears: years, recordEnd: p1, meanEventLoss: losses.length ? mean(losses) : 0.05 };
}

/** Combined expected flood loss of the episodes that start (or peak) inside [fromIso, toIso] of a season window. */
function floodLossBetween(ctx: FloodCtx, p: CropParams, sowIso: string, n: number, fromIso: string, toIso: string, expo: number): { loss: number; events: FloodEvent[] } {
  const sowT = Date.parse(sowIso);
  const hits: FloodEvent[] = [];
  let keep = 1;
  for (const e of ctx.events) {
    if (e.end < fromIso || e.start > toIso) continue;
    const ref = e.peakDate >= fromIso && e.peakDate <= toIso ? e.peakDate : e.start >= fromIso ? e.start : fromIso;
    const f = clamp((Date.parse(ref) - sowT) / (n * DAY), 0, 0.999);
    const sens = p.floodSensitivity[stageAt(p, f)] ?? 1;
    const l = clamp(floodShareDamage(e.depthM, e.durationDays).expectedLoss * sens * expo, 0, 0.95);
    keep *= 1 - l;
    hits.push(e);
  }
  return { loss: 1 - keep, events: hits };
}

// ─── Salinity component ───────────────────────────────────────────────────

function seasonEce(wx: Wx | null, sowIdx: number, n: number, obsUntilIdx: number, climRain30: (offset: number) => number, exposure: number, sowIso: string, latitude: number, useObserved: boolean) {
  const blocks = Math.max(1, Math.round(n / 30));
  const vals: number[] = [];
  for (let b = 0; b < blocks; b++) {
    const endOff = Math.min(n - 1, (b + 1) * 30 - 1);
    const month = new Date(Date.parse(sowIso) + endOff * DAY).getUTCMonth() + 1;
    let rain30 = climRain30(endOff);
    if (useObserved && wx && sowIdx + endOff <= obsUntilIdx) {
      let s = 0;
      for (let i = sowIdx + endOff - 29; i <= sowIdx + endOff; i++) s += wx.h.rain[i] ?? 0;
      rain30 = s;
    }
    vals.push(scoreSalinity({ exposure, month, rain30dMm: rain30, seaLevelM: null, latitude }).ecCurrent);
  }
  return mean(vals);
}

// ─── NDVI component ───────────────────────────────────────────────────────

interface NdviSeries {
  points: { date: string; ndvi: number }[];
  source: "MODIS MOD13Q1 (ORNL DAAC)" | "seeded field history";
  quality: number;
  fields: number;
}
let satStatus: (() => { districts: { districtId: string; series: { date: string; ndvi: number }[] }[] }) | null = null;
async function loadSatStatus() {
  if (satStatus) return;
  try {
    const m = await import("../jobs/satellite-ingest");
    satStatus = m.satelliteStatus as unknown as typeof satStatus;
  } catch {
    satStatus = () => ({ districts: [] });
  }
}
function ndviSeriesFor(districtId: string | null, crop: string): NdviSeries | null {
  if (!districtId) return null;
  const s = getStore();
  const real = satStatus?.().districts.find((d) => d.districtId === districtId && d.series.length);
  if (real) return { points: real.series.map((p) => ({ date: p.date, ndvi: p.ndvi })), source: "MODIS MOD13Q1 (ORNL DAAC)", quality: 1, fields: 0 };
  const farmerIds = new Set(s.farmers.filter((f) => f.districtId === districtId).map((f) => f.id));
  const inD = s.fields.filter((f) => farmerIds.has(f.farmerId));
  const same = inD.filter((f) => f.cropType === crop);
  const use = same.length ? same : inD;
  if (!use.length) return null;
  const byDate = new Map<string, number[]>();
  for (const f of use) for (const p of f.ndviHistory) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p.ndvi]);
  const points = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ndvi: r3(mean(v)) }));
  return { points, source: "seeded field history", quality: same.length ? 0.5 : 0.3, fields: use.length };
}

// ─── Simulation per key (cell × district × crop × season × irrigation × exposure) ──

export interface SimInput {
  wx: Wx | null;
  cellKey: string;
  districtId: string | null;
  country: string;
  crop: string;
  season: SeasonWindow;
  reliability: number;
  floodExpo: number;
  salinityExposure: number;
  latitude: number;
  liveFloodExcess: number;
}

export interface FactorSet {
  asOf: string;
  observedFrac: number;
  members: number[];
  memberYears: number[];
  water: number[];
  heat: number[];
  flood: number[];
  salinity: number;
  ndvi: { factor: number; anomaly: number; weight: number; observed: number | null; expected: number | null; date: string | null };
  climMeans: { water: number; heat: number; flood: number };
  realisedFloodLoss: number;
  realisedEvents: FloodEvent[];
  liveFloodLoss: number;
  cv: number;
  waterBalance: { etcMm: number; etaMm: number; rainMm: number; irrigationMm: number; percolationMm: number; stressDays: number } | null;
  climWaterBalance: { etcMm: number; etaMm: number; rainMm: number; irrigationMm: number; percolationMm: number } | null;
  heatHdd: number | null;
  fallback: boolean;
}

const gClim = globalThis as unknown as { __agriYieldClim?: Map<string, { w: WaterResult; heat: number; days: DayWx[]; d0: number }[]> };
const climCache = (gClim.__agriYieldClim ??= new Map<string, { w: WaterResult; heat: number; days: DayWx[]; d0: number }[]>());

function runFactors(inp: SimInput, asOfT: number, ndvi: NdviSeries | null, fl: FloodCtx): FactorSet {
  const p = cropParams(inp.crop)!;
  const s = inp.season;
  const n = s.days;
  const asOf = iso(asOfT);
  const sowT = Date.parse(`${s.sow}T00:00:00Z`);
  const wx = inp.wx;
  const Y = s.sowYear;
  const effAsOfT = Math.min(asOfT, Date.parse(`${s.harvest}T00:00:00Z`));

  // NDVI (independent of weather availability)
  let nd: FactorSet["ndvi"] = { factor: 1, anomaly: 0, weight: 0, observed: null, expected: null, date: null };
  if (ndvi) {
    const pts = ndvi.points.filter((q) => q.date <= asOf && q.date >= s.sow);
    const last = pts[pts.length - 1];
    if (last) {
      const f = clamp((Date.parse(last.date) - sowT) / (n * DAY), 0, 1);
      const exp = ndviExpected(p, f);
      const r = ndviFactor(last.ndvi, exp, f, ndvi.quality);
      nd = { ...r, observed: last.ndvi, expected: r3(exp), date: last.date };
    }
  }

  // Flood: realised up to as-of + remaining sampled from past seasons
  const realised = floodLossBetween(fl, p, s.sow, n, s.sow, iso(Math.min(effAsOfT, Date.parse(fl.recordEnd))), inp.floodExpo);
  const pastYears = fl.recordYears.filter((y) => Date.parse(shiftYears(s.harvest, y - Y)) <= Date.parse(fl.recordEnd) && y !== Y);
  const pastFull = pastYears.map((y) => floodLossBetween(fl, p, shiftYears(s.sow, y - Y), n, shiftYears(s.sow, y - Y), shiftYears(s.harvest, y - Y), inp.floodExpo).loss);
  const pastRemaining = pastYears.map((y) => {
    const from = iso(Math.max(sowT, effAsOfT + DAY));
    return from > s.harvest ? 0 : floodLossBetween(fl, p, shiftYears(s.sow, y - Y), n, shiftYears(from, y - Y), shiftYears(s.harvest, y - Y), inp.floodExpo).loss;
  });
  const floodClim = pastFull.length ? mean(pastFull) : 0;
  const live = asOfT >= Date.now() - DAY && s.status === "in_season" ? clamp(inp.liveFloodExcess * fl.meanEventLoss * inp.floodExpo, 0, 0.5) : 0;
  const floodMember = (m: number) => {
    const rem = pastRemaining.length ? pastRemaining[m % pastRemaining.length]! : 0;
    const total = 1 - (1 - realised.loss) * (1 - rem) * (1 - live);
    return clamp((1 - total) / Math.max(0.05, 1 - floodClim), 0.05, 1.3);
  };

  const heatCfg = p.heat;
  const winLo = heatCfg ? Math.round(heatCfg.floweringFrac * n) - heatCfg.windowDays : 0;
  const winHi = heatCfg ? Math.round(heatCfg.floweringFrac * n) + heatCfg.windowDays : -1;

  if (!wx) {
    const members = Array.from({ length: 30 }, (_, m) => floodMember(m) * nd.factor);
    return {
      asOf,
      observedFrac: 0,
      members,
      memberYears: members.map((_, m) => Y - 1 - m),
      water: members.map(() => 1),
      heat: members.map(() => 1),
      flood: members.map((_, m) => floodMember(m)),
      salinity: 1,
      ndvi: nd,
      climMeans: { water: 1, heat: 1, flood: 1 - floodClim },
      realisedFloodLoss: realised.loss,
      realisedEvents: realised.events,
      liveFloodLoss: live,
      cv: modelCv(0, true),
      waterBalance: null,
      climWaterBalance: null,
      heatHdd: null,
      fallback: true,
    };
  }

  const sowIdx = idxOf(wx, s.sow);
  const obsUntilIdx = Math.min(wx.lastObsIdx, idxOf(wx, iso(effAsOfT)));
  const k = clamp(obsUntilIdx - sowIdx + 1, 0, n); // observed season days
  const analog: number[] = [];
  for (let y = Y - 1; y >= Y - 30; y--) {
    const si = idxOf(wx, shiftYears(s.sow, y - Y));
    if (si - 30 >= 0 && si + n - 1 <= wx.lastObsIdx) analog.push(y);
  }
  const res = reservoir(p);
  const spin = (startIdx: number) => {
    // 30-day pre-season bucket spin-up (bare/fallow soil, Kc 0.5)
    let D = res.C * 0.5;
    for (let i = startIdx - 30; i < startIdx; i++) {
      const w = day(wx, i);
      D = clamp(D + 0.5 * w.et0 - w.rain, 0, res.C);
    }
    return D;
  };
  const d0For = (startIdx: number) => (p.paddy && inp.reliability > 0 ? 0 : p.paddy ? Math.min(spin(startIdx), res.pond) : spin(startIdx));
  const seasonDays = (startIdx: number) => Array.from({ length: n }, (_, i) => day(wx, startIdx + i));

  // climatology: each analogue year's full season
  // climatology runs do not depend on the as-of date — cache them per (cell, crop, season, irrigation)
  const climKey = `${inp.cellKey}|${inp.crop}|${s.id}|${Y}|${inp.reliability}|${wx.lastObsIdx}`;
  let climRuns = climCache.get(climKey);
  if (!climRuns) {
    climRuns = analog.map((y) => {
      const si = idxOf(wx, shiftYears(s.sow, y - Y));
      const days = seasonDays(si);
      const w = simulateWater(days, p, inp.reliability, d0For(si));
      const hdd = heatCfg ? heatDegreeDays(days.slice(Math.max(0, winLo), Math.min(n, winHi + 1)).map((d) => d.tmax), heatCfg.tcrit) : 0;
      return { w, heat: 1 - heatLoss(hdd), days, d0: d0For(si) };
    });
    climCache.set(climKey, climRuns);
    if (climCache.size > 600) climCache.delete(climCache.keys().next().value!);
  }
  const climWater = climRuns.length ? mean(climRuns.map((c) => c.w.relYield)) : 1;
  const climHeat = climRuns.length ? mean(climRuns.map((c) => c.heat)) : 1;

  // members: observed season-to-date + analogue year for the remainder
  const obsDays = k > 0 && sowIdx >= 0 ? seasonDays(sowIdx).slice(0, k) : [];
  const d0Obs = sowIdx - 30 >= 0 && sowIdx <= wx.lastObsIdx ? d0For(sowIdx) : null;
  const water: number[] = [];
  const heat: number[] = [];
  const flood: number[] = [];
  const members: number[] = [];
  let wbMid: WaterResult[] = [];
  let hddObs: number[] = [];
  climRuns.forEach((c, m) => {
    const days = k > 0 ? [...obsDays, ...c.days.slice(k)] : c.days;
    const d0 = d0Obs ?? c.d0;
    const w = simulateWater(days, p, inp.reliability, d0);
    const hdd = heatCfg ? heatDegreeDays(days.slice(Math.max(0, winLo), Math.min(n, winHi + 1)).map((d) => d.tmax), heatCfg.tcrit) : 0;
    const fw = clamp(w.relYield / Math.max(0.05, climWater), 0.05, 1.3);
    const fh = clamp((1 - heatLoss(hdd)) / Math.max(0.05, climHeat), 0.3, 1.1);
    const ff = floodMember(m);
    water.push(fw);
    heat.push(fh);
    flood.push(ff);
    members.push(fw * fh * ff * nd.factor);
    wbMid.push(w);
    hddObs.push(hdd);
  });

  // salinity (season-mean ECe, observed vs normal 30-day rain)
  const climRain30 = (endOff: number) => {
    if (!analog.length) return 150;
    return mean(
      analog.map((y) => {
        const si = idxOf(wx, shiftYears(s.sow, y - Y));
        let t = 0;
        for (let i = si + endOff - 29; i <= si + endOff; i++) t += wx.h.rain[i] ?? 0;
        return t;
      })
    );
  };
  const eceThis = seasonEce(wx, sowIdx, n, obsUntilIdx, climRain30, inp.salinityExposure, s.sow, inp.latitude, true);
  const eceNorm = seasonEce(wx, sowIdx, n, -1, climRain30, inp.salinityExposure, s.sow, inp.latitude, false);
  const salinity = clamp(maasHoffman(eceThis, p.salinity.a, p.salinity.b) / Math.max(0.05, maasHoffman(eceNorm, p.salinity.a, p.salinity.b)), 0.3, 1.2);
  for (let i = 0; i < members.length; i++) members[i]! *= salinity;

  const medIdx = (arr: number[]) => {
    const sorted = arr.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    return sorted[Math.floor(sorted.length / 2)]?.[1] ?? 0;
  };
  const mi = water.length ? medIdx(water) : -1;
  const pick = mi >= 0 ? wbMid[mi]! : null;
  const cw = climRuns.map((c) => c.w);
  const out: FactorSet = {
    asOf,
    observedFrac: k / n,
    members: members.length ? members : [nd.factor * salinity],
    memberYears: analog,
    water,
    heat,
    flood,
    salinity: r3(salinity),
    ndvi: nd,
    climMeans: { water: climWater, heat: climHeat, flood: 1 - floodClim },
    realisedFloodLoss: realised.loss,
    realisedEvents: realised.events,
    liveFloodLoss: live,
    cv: modelCv(k / n, !analog.length),
    waterBalance: pick ? { etcMm: Math.round(pick.etcMm), etaMm: Math.round(pick.etaMm), rainMm: Math.round(pick.rainMm), irrigationMm: Math.round(pick.irrigationMm), percolationMm: Math.round(pick.percolationMm), stressDays: pick.stressDays } : null,
    climWaterBalance: cw.length ? { etcMm: Math.round(mean(cw.map((w) => w.etcMm))), etaMm: Math.round(mean(cw.map((w) => w.etaMm))), rainMm: Math.round(mean(cw.map((w) => w.rainMm))), irrigationMm: Math.round(mean(cw.map((w) => w.irrigationMm))), percolationMm: Math.round(mean(cw.map((w) => w.percolationMm))) } : null,
    heatHdd: heatCfg && hddObs.length ? r2(quantile(hddObs, 0.5)) : null,
    fallback: !analog.length,
  };
  wbMid = [];
  hddObs = [];
  return out;
}

// ─── Public types ─────────────────────────────────────────────────────────

export interface Driver {
  key: "trend" | "water" | "heat" | "flood" | "salinity" | "ndvi";
  label: string;
  pct: number;
}

export interface Forecast {
  season: SeasonWindow;
  baseline: Baseline;
  yieldTHa: { p10: number; p50: number; p90: number; mean: number };
  vsNormalPct: number;
  probBelowNormalPct: number;
  drivers: Driver[];
  factors: { water: number; heat: number; flood: number; salinity: number; ndvi: number };
  /** P50 yield per analogue member (weather + flood only, no structural error) — for coherent aggregation */
  memberYield: number[];
  cv: number;
  observedFrac: number;
  weather: { source: string; cell: string; lastObs: string | null; analogYears: number; fallback: boolean };
  ndvi: FactorSet["ndvi"] & { source: string | null };
  flood: { realisedLossPct: number; events: { start: string; end: string; depthM: number; driver: string }[]; seasonalNormalLossPct: number; liveLossPct: number };
  salinityFactor: number;
  water: FactorSet["waterBalance"];
  climWater: FactorSet["climWaterBalance"];
  heatHdd: number | null;
  irrigation: { label: string; reliability: number; assumed: boolean };
}

function driversOf(fs: FactorSet, trendRatio: number): { drivers: Driver[]; factors: Forecast["factors"] } {
  const med = (a: number[]) => (a.length ? quantile(a, 0.5) : 1);
  const factors = { water: med(fs.water), heat: med(fs.heat), flood: med(fs.flood), salinity: fs.salinity, ndvi: fs.ndvi.factor };
  const pc = (f: number) => Math.round((f - 1) * 1000) / 10 + 0;
  return {
    factors: { water: r3(factors.water), heat: r3(factors.heat), flood: r3(factors.flood), salinity: r3(factors.salinity), ndvi: r3(factors.ndvi) },
    drivers: [
      { key: "trend", label: "Yield trend vs 5-yr normal", pct: pc(trendRatio) },
      { key: "water", label: "Water stress (FAO-33 Ky)", pct: pc(factors.water) },
      { key: "heat", label: "Heat at flowering", pct: pc(factors.heat) },
      { key: "flood", label: "Flood / submergence", pct: pc(factors.flood) },
      { key: "salinity", label: "Soil salinity (Maas–Hoffman)", pct: pc(factors.salinity) },
      { key: "ndvi", label: "Satellite NDVI anomaly", pct: pc(factors.ndvi) },
    ],
  };
}

function forecastFrom(fs: FactorSet, base: Baseline, season: SeasonWindow, meta: Pick<Forecast, "weather" | "irrigation">, ndviSrc: string | null): Forecast {
  const scale = base.trendTHa;
  const b = bands(fs.members, fs.cv);
  const y = { p10: r2(b.p10 * scale), p50: r2(b.p50 * scale), p90: r2(b.p90 * scale), mean: r2(b.mean * scale) };
  const below = b.samples.filter((v) => v * scale < base.normalTHa).length / Math.max(1, b.samples.length);
  const { drivers, factors } = driversOf(fs, base.trendTHa / base.normalTHa);
  return {
    season,
    baseline: base,
    yieldTHa: y,
    vsNormalPct: Math.round((y.p50 / base.normalTHa - 1) * 1000) / 10,
    probBelowNormalPct: Math.round(below * 100),
    drivers,
    factors,
    memberYield: fs.members.map((m) => r3(m * scale)),
    cv: r3(fs.cv),
    observedFrac: r3(fs.observedFrac),
    weather: meta.weather,
    ndvi: { ...fs.ndvi, source: ndviSrc },
    flood: {
      realisedLossPct: Math.round(fs.realisedFloodLoss * 1000) / 10,
      events: fs.realisedEvents.map((e) => ({ start: e.start, end: e.end, depthM: e.depthM, driver: e.driver })),
      seasonalNormalLossPct: Math.round((1 - fs.climMeans.flood) * 1000) / 10,
      liveLossPct: Math.round(fs.liveFloodLoss * 1000) / 10,
    },
    salinityFactor: fs.salinity,
    water: fs.waterBalance,
    climWater: fs.climWaterBalance,
    heatHdd: fs.heatHdd,
    irrigation: meta.irrigation,
  };
}

// ─── Prices ───────────────────────────────────────────────────────────────

/** Farm-gate price USD/t for a crop in a country (paddy: national farm-gate; others: Pink Sheet/WFP-derived series). */
export function priceUsdT(country: string, crop: string, normalTHa?: number): { usdT: number; source: string } {
  if (crop === "rice") return { usdT: countryStats(country).paddyFarmgateUsdT, source: "National paddy farm-gate price (real/agri-reference.json)" };
  const series = monthlyPrices(crop);
  if (series.length) {
    const v = trailingMean(series, 12);
    // coconut series is copra-equivalent; copra ≈ 22 % of in-shell nut weight (assumed)
    if (crop === "coconut") return { usdT: Math.round(v * 0.22), source: "Pink Sheet coconut oil → copra eq. × 0.22 (in-shell), 12-mo mean" };
    return { usdT: Math.round(v), source: "World Bank Pink Sheet / WFP-derived farm-gate series, 12-month mean" };
  }
  const implied = normalTHa && normalTHa > 0 ? (productionCostUsdHa(country, crop) * 1.6) / normalTHa : 300;
  return { usdT: Math.round(implied), source: "Implied from cost of cultivation × 1.6 ÷ normal yield (no traded price series)" };
}

// ─── Workspace book ───────────────────────────────────────────────────────

export const CROP_ASSET_TYPES = new Set(["insured_plot", "loan", "farm", "field"]);

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export function irrigationOf(a: Pick<AssetRecord, "id" | "meta">, country: string): { label: string; reliability: number; assumed: boolean; irrigated: boolean } {
  const m = String(a.meta?.irrigation ?? "").toLowerCase();
  const rel = COEF.irrigationReliability;
  if (m === "canal") return { label: "Canal", reliability: rel.canal!, assumed: false, irrigated: true };
  if (m === "tubewell" || m === "tube-well" || m === "pump") return { label: "Tube-well", reliability: rel.tubewell!, assumed: false, irrigated: true };
  if (m === "rainfed" || m === "rain-fed") return { label: "Rain-fed", reliability: 0, assumed: false, irrigated: false };
  if (m === "irrigated") return { label: "Irrigated", reliability: rel.irrigated!, assumed: false, irrigated: true };
  const share = COEF.irrigatedShare[country] ?? 0.4;
  const irrigated = hash01(a.id) < share;
  return { label: irrigated ? "Irrigated (assumed)" : "Rain-fed (assumed)", reliability: irrigated ? rel.irrigated! : 0, assumed: true, irrigated };
}

export interface YieldAssetRow {
  id: string;
  name: string;
  type: string;
  externalRef: string | null;
  crop: string;
  cropLabel: string;
  districtId: string | null;
  district: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  areaHa: number;
  valueUsd: number;
  meta: AssetRecord["meta"];
  forecast: Forecast;
  productionT: { p10: number; p50: number; p90: number };
  priceUsdT: number;
  priceSource: string;
  grossValueUsd: number;
  normalValueUsd: number;
  simKey: string;
  outlook: { insurer?: InsurerOutlook; bank?: BankOutlook };
}

export interface InsurerOutlook {
  product: string;
  areaYield: boolean;
  coveragePct: number;
  thresholdTHa: number;
  sumInsuredUsd: number;
  premiumUsd: number;
  expectedPayoutUsd: number;
  payoutProbPct: number;
  p90PayoutUsd: number;
}
export interface BankOutlook {
  outstandingUsd: number;
  debtServiceUsd: number;
  revenueP50Usd: number;
  revenueP10Usd: number;
  costUsd: number;
  coverP50: number;
  coverP10: number;
  flag: "ok" | "watch" | "stress";
}

const AREA_YIELD_COVERAGE = 0.8;

export function insurerOutlook(a: AssetRecord, f: Forecast, samples: number[]): InsurerOutlook {
  const product = String(a.meta.product ?? "Area-yield index");
  const ty = f.baseline.normalTHa * AREA_YIELD_COVERAGE;
  const si = a.valueUsd;
  const pays = samples.map((y) => (Math.max(0, ty - y) / ty) * si);
  return {
    product,
    areaYield: /area-yield/i.test(product),
    coveragePct: AREA_YIELD_COVERAGE * 100,
    thresholdTHa: r2(ty),
    sumInsuredUsd: si,
    premiumUsd: Number(a.meta.premiumUsd ?? 0),
    expectedPayoutUsd: Math.round(mean(pays)),
    payoutProbPct: Math.round((pays.filter((v) => v > 0).length / Math.max(1, pays.length)) * 100),
    p90PayoutUsd: Math.round(quantile(pays, 0.9)),
  };
}

export function bankOutlook(a: AssetRecord, f: Forecast, areaHa: number, price: number, country: string): BankOutlook {
  const out = a.valueUsd;
  const tenor = Math.max(1, Number(a.meta.tenorMonths ?? 12));
  const rate = Number(a.meta.interestRatePct ?? 9) / 100;
  // debt due within this crop season (≤ 6 months): pro-rata principal + 6 months' interest
  const ds = out * Math.min(1, 6 / tenor) + out * rate * 0.5;
  const rev50 = f.yieldTHa.p50 * areaHa * price;
  const rev10 = f.yieldTHa.p10 * areaHa * price;
  const cost = productionCostUsdHa(country, a.crop ?? "rice") * areaHa;
  const c50 = ds > 0 ? rev50 / ds : 99;
  const c10 = ds > 0 ? rev10 / ds : 99;
  return { outstandingUsd: out, debtServiceUsd: Math.round(ds), revenueP50Usd: Math.round(rev50), revenueP10Usd: Math.round(rev10), costUsd: Math.round(cost), coverP50: r2(c50), coverP10: r2(c10), flag: c10 < 1 ? "stress" : c50 < 1.5 ? "watch" : "ok" };
}

export interface GroupAgg {
  key: string;
  label: string;
  assets: number;
  areaHa: number;
  yieldP50: number;
  normalTHa: number;
  vsNormalPct: number;
  productionT: { p10: number; p50: number; p90: number };
  normalProductionT: number;
  valueUsd: number;
  lat?: number;
  lon?: number;
}

/** Sum production member-wise (shared analogue years ⇒ spatially coherent weather) + partially-correlated structural error. */
export function aggregate(rows: { areaHa: number; memberYield: number[]; cv: number; p50: number; normal: number; price: number }[], rho = 0.3) {
  if (!rows.length) return { p10: 0, p50: 0, p90: 0, normal: 0, area: 0, value: 0 };
  const M = Math.max(...rows.map((r) => r.memberYield.length));
  const totals = Array.from({ length: M }, (_, m) => rows.reduce((a, r) => a + r.areaHa * (r.memberYield[m % r.memberYield.length] ?? r.p50), 0));
  const prod = rows.map((r) => r.areaHa * r.p50);
  const P = sum(prod);
  const sd = rows.map((r, i) => prod[i]! * r.cv);
  const varInd = sum(sd.map((x) => x * x));
  const varCorr = sum(sd) ** 2;
  const cvAgg = P > 0 ? Math.sqrt((1 - rho) * varInd + rho * varCorr) / P : 0;
  const b = bands(totals, cvAgg);
  return {
    p10: Math.round(b.p10),
    p50: Math.round(b.p50),
    p90: Math.round(b.p90),
    normal: Math.round(sum(rows.map((r) => r.areaHa * r.normal))),
    area: sum(rows.map((r) => r.areaHa)),
    value: Math.round(sum(rows.map((r, i) => prod[i]! * r.price))),
  };
}

export interface DistrictForecast {
  districtId: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  crop: string;
  cropAreaHa: number;
  irrigatedShare: number;
  forecast: Forecast;
  productionT: { p10: number; p50: number; p90: number };
  normalProductionT: number;
  valueUsd: number;
  priceUsdT: number;
}

export interface EvolutionPoint {
  asOf: string;
  p10: number;
  p50: number;
  p90: number;
  vsNormalPct: number;
  observedFrac: number;
}

export interface YieldBook {
  workspaceId: string;
  generatedAt: string;
  asOf: string;
  industry: string | null;
  assets: YieldAssetRow[];
  skipped: { id: string; name: string; reason: string }[];
  districts: DistrictForecast[];
  totals: { assets: number; areaHa: number; productionT: { p10: number; p50: number; p90: number }; normalProductionT: number; vsNormalPct: number; valueUsd: number; normalValueUsd: number; belowNormalAssets: number };
  byDistrict: GroupAgg[];
  byCountry: GroupAgg[];
  byCrop: GroupAgg[];
  evolution: EvolutionPoint[];
  outlook: {
    insurer: null | { units: number; areaYieldUnits: number; expectedPayoutUsd: number; areaYieldExpectedPayoutUsd: number; premiumUsd: number; areaYieldPremiumUsd: number; expectedLossRatioPct: number | null; unitsLikelyToPay: number };
    bank: null | { loans: number; stress: number; watch: number; outstandingUsd: number; outstandingStressUsd: number; medianCoverP50: number };
    sourcing: { byDistrict: { districtId: string; name: string; crop: string; p10: number; p50: number; p90: number; normal: number }[] };
  };
  coverage: { cells: number; cellsWithHistory: number; pending: number; providers: string[]; fallbackAssets: number };
  drivers: Driver[];
}

interface Prepared {
  input: SimInput;
  ndvi: NdviSeries | null;
  fl: FloodCtx;
  meta: Pick<Forecast, "weather" | "irrigation">;
}

const gcache = globalThis as unknown as { __agriYield?: Map<string, { at: number; v: Promise<YieldBook> }>; __agriYieldSim?: Map<string, { at: number; today: FactorSet; evo?: FactorSet[] }> };
type SimEntry = { at: number; today: FactorSet; evo?: FactorSet[] };
const bookCache: Map<string, { at: number; v: Promise<YieldBook> }> = (gcache.__agriYield ??= new Map());
const simCache: Map<string, SimEntry> = (gcache.__agriYieldSim ??= new Map<string, SimEntry>());
const TTL = 30 * 60_000;
export function yieldCacheBust(ws?: string) {
  if (ws) bookCache.delete(ws);
  else bookCache.clear();
  simCache.clear();
  climCache.clear();
}

/** Weekly as-of dates: the last 16 weeks ending today. */
export function evolutionDates(now = Date.now()): number[] {
  const t = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  return Array.from({ length: 16 }, (_, i) => t - (15 - i) * 7 * DAY);
}

function simulateKey(key: string, prep: Prepared, now: number, withEvolution: boolean) {
  const hit = simCache.get(key);
  if (hit && Date.now() - hit.at < TTL && (!withEvolution || hit.evo)) return hit;
  const today = runFactors(prep.input, now, prep.ndvi, prep.fl);
  let evo: FactorSet[] | undefined = hit?.evo;
  if (withEvolution && !evo) evo = evolutionDates(now).map((t) => (t >= now - DAY ? today : runFactors({ ...prep.input, liveFloodExcess: 0 }, t, prep.ndvi, prep.fl)));
  const v = { at: Date.now(), today, evo };
  simCache.set(key, v);
  return v;
}

async function historiesFor(points: HistoryPoint[], budgetMs: number) {
  try {
    return await getHistoryBatch(points, { mode: "partial", budgetMs, prio: 1 });
  } catch {
    return { map: new Map<string, DailyHistory>(), pending: points.length, total: points.length, providers: [] as string[] };
  }
}

/** Reference weather point: nearest monitored district centroid within 50 km (the platform's cached history cells), else the 0.25° cell. */
export function refPointOf(lat: number, lon: number): HistoryPoint {
  const pri = exposurePriors(lat, lon);
  if (pri.district && (pri.km ?? 999) <= 50) return { lat: pri.district.lat, lon: pri.district.lon };
  return { lat: Math.round(lat * 4) / 4, lon: Math.round(lon * 4) / 4 };
}

function districtsInScope(ws: string, assets: AssetRecord[]): DistrictRecord[] {
  const s = getStore();
  const ids = new Set(assets.map((a) => a.districtId).filter((x): x is string => !!x));
  if (!ids.size) {
    const org = s.orgs.find((o) => o.id === ws);
    const code = Object.entries(COUNTRY_CODE).find(([n]) => n === org?.country)?.[1];
    for (const d of s.districts) if (!code || d.country === code) ids.add(d.id);
  }
  return s.districts.filter((d) => ids.has(d.id));
}

function prepFor(opts: { id: string; lat: number; lon: number; districtId: string | null; country: string; crop: string; reliability: number; irrigationLabel: string; assumed: boolean; floodExpo: number; now: number; hist: Map<string, DailyHistory> }): { key: string; prep: Prepared; season: SeasonWindow } {
  const s = getStore();
  const d = opts.districtId ? s.districts.find((x) => x.id === opts.districtId) ?? null : exposurePriors(opts.lat, opts.lon).district;
  const rp = refPointOf(opts.lat, opts.lon);
  const ck = gridKey(rp);
  const h = opts.hist.get(ck) ?? null;
  const season = pickSeason(opts.country, opts.crop, opts.now);
  const pri = exposurePriors(opts.lat, opts.lon);
  const clim3 = d ? floodClimatology(d.id, new Date(opts.now).getUTCMonth() + 1, 3) : 0.05;
  const liveExcess = d ? Math.max(0, (d.floodProb72h ?? 0) - clim3) : 0;
  const expoQ = Math.round(clamp(opts.floodExpo, 0.5, 1.5) * 4) / 4;
  const relQ = Math.round(opts.reliability * 20) / 20;
  const key = [ck, d?.id ?? "-", opts.crop, season.id, season.sowYear, relQ, expoQ, iso(opts.now)].join("|");
  const wx = h ? wxOf(h) : null;
  const input: SimInput = { wx, cellKey: ck, districtId: d?.id ?? null, country: opts.country, crop: opts.crop, season, reliability: relQ, floodExpo: expoQ, salinityExposure: d ? d.salinityExposure : pri.salinity, latitude: opts.lat, liveFloodExcess: liveExcess };
  return {
    key,
    season,
    prep: {
      input,
      ndvi: ndviSeriesFor(d?.id ?? null, opts.crop),
      fl: floodCtx(d?.id ?? null),
      meta: {
        weather: { source: h ? `${h.provider} daily (${h.source})` : "District climatology fallback (history not cached yet)", cell: ck, lastObs: wx ? wx.h.time[wx.lastObsIdx] ?? null : null, analogYears: 0, fallback: !h },
        irrigation: { label: opts.irrigationLabel, reliability: relQ, assumed: opts.assumed },
      },
    },
  };
}

function finalize(prep: Prepared, fs: FactorSet, base: Baseline, season: SeasonWindow): Forecast {
  const f = forecastFrom(fs, base, season, { ...prep.meta, weather: { ...prep.meta.weather, analogYears: fs.memberYears.length, fallback: fs.fallback } }, prep.ndvi?.source ?? null);
  return f;
}

/** Flood exposure multiplier of an asset relative to its district. */
function floodExpoOf(a: AssetRecord, d: DistrictRecord | null): number {
  if (!d) return 1;
  const sc = effectiveScore(a).flood;
  return clamp(sc / Math.max(20, d.floodRisk || 20), 0.5, 1.5);
}

export async function yieldBook(ws: string, opts: { force?: boolean; now?: number; budgetMs?: number } = {}): Promise<YieldBook> {
  const hit = bookCache.get(ws);
  if (!opts.force && hit && Date.now() - hit.at < TTL) return hit.v;
  const v = buildBook(ws, opts.now ?? Date.now(), opts.budgetMs ?? 6000);
  bookCache.set(ws, { at: Date.now(), v });
  v.catch(() => bookCache.delete(ws));
  return v;
}

async function buildBook(ws: string, now: number, budgetMs: number): Promise<YieldBook> {
  await loadSatStatus();
  const s = getStore();
  const org = s.orgs.find((o) => o.id === ws);
  const all = s.assets.filter((a) => a.workspaceId === ws && a.status === "active");
  const skipped: YieldBook["skipped"] = [];
  const cropAssets = all.filter((a) => {
    if (!CROP_ASSET_TYPES.has(a.type)) return false;
    if (!a.crop) return skipped.push({ id: a.id, name: a.name, reason: "No crop recorded" }), false;
    if (!cropParams(a.crop)) return skipped.push({ id: a.id, name: a.name, reason: `Crop '${a.crop}' has no FAO parameters yet` }), false;
    if (!a.areaHa || a.areaHa <= 0) return skipped.push({ id: a.id, name: a.name, reason: "No area (ha) recorded" }), false;
    return true;
  });
  const dists = districtsInScope(ws, all);
  const points = new Map<string, HistoryPoint>();
  for (const a of cropAssets) {
    const rp = refPointOf(a.lat, a.lon);
    points.set(gridKey(rp), rp);
  }
  for (const d of dists) {
    const rp = refPointOf(d.lat, d.lon);
    points.set(gridKey(rp), rp);
  }
  const batch = await historiesFor([...points.values()], budgetMs);
  const hist = batch.map;

  // ── assets
  const rows: YieldAssetRow[] = [];
  const keyEvo = new Map<string, { prep: Prepared; base: Baseline; season: SeasonWindow }>();
  for (const a of cropAssets) {
    const cc = countryCodeOf(a);
    const d = a.districtId ? s.districts.find((x) => x.id === a.districtId) ?? null : null;
    const irr = irrigationOf(a, cc);
    const { key, prep, season } = prepFor({ id: a.id, lat: a.lat, lon: a.lon, districtId: a.districtId, country: cc, crop: a.crop!, reliability: irr.reliability, irrigationLabel: irr.label, assumed: irr.assumed, floodExpo: floodExpoOf(a, d), now, hist });
    const base = baselineFor(cc, a.crop!, season.id, season.harvestYear);
    if (!base) {
      skipped.push({ id: a.id, name: a.name, reason: `No FAOSTAT baseline for ${a.crop} in ${cc}` });
      continue;
    }
    const sim = simulateKey(key, prep, now, true);
    keyEvo.set(key, { prep, base, season });
    const f = finalize(prep, sim.today, base, season);
    const price = priceUsdT(cc, a.crop!, base.normalTHa);
    const area = a.areaHa!;
    const samples = bands(sim.today.members, sim.today.cv).samples.map((x) => x * base.trendTHa);
    const outlook: YieldAssetRow["outlook"] = {};
    if (a.type === "insured_plot") outlook.insurer = insurerOutlook(a, f, samples);
    if (a.type === "loan") outlook.bank = bankOutlook(a, f, area, price.usdT, cc);
    rows.push({
      id: a.id,
      name: a.name,
      type: a.type,
      externalRef: a.externalRef,
      crop: a.crop!,
      cropLabel: cropParams(a.crop!)!.label,
      districtId: d?.id ?? null,
      district: d?.name ?? null,
      country: a.country,
      countryCode: cc,
      lat: a.lat,
      lon: a.lon,
      areaHa: area,
      valueUsd: a.valueUsd,
      meta: a.meta,
      forecast: f,
      productionT: { p10: r2(f.yieldTHa.p10 * area), p50: r2(f.yieldTHa.p50 * area), p90: r2(f.yieldTHa.p90 * area) },
      priceUsdT: price.usdT,
      priceSource: price.source,
      grossValueUsd: Math.round(f.yieldTHa.p50 * area * price.usdT),
      normalValueUsd: Math.round(base.normalTHa * area * price.usdT),
      simKey: key,
      outlook,
    });
  }

  // ── districts (area-weighted mix of irrigated and rain-fed land)
  const districts: DistrictForecast[] = [];
  for (const d of dists) {
    const crop = (d.primaryCrops.find((c) => cropParams(c)) ?? "rice") as CropType;
    const share = COEF.irrigatedShare[d.country] ?? 0.4;
    const parts = [
      { rel: COEF.irrigationReliability.irrigated!, w: share, label: "Irrigated" },
      { rel: 0, w: 1 - share, label: "Rain-fed" },
    ].filter((x) => x.w > 0.001);
    let fcs: { f: Forecast; w: number; fs: FactorSet; prep: Prepared }[] = [];
    let season: SeasonWindow | null = null;
    let base: Baseline | null = null;
    for (const part of parts) {
      const { key, prep, season: se } = prepFor({ id: d.id, lat: d.lat, lon: d.lon, districtId: d.id, country: d.country, crop, reliability: part.rel, irrigationLabel: part.label, assumed: true, floodExpo: 1, now, hist });
      season = se;
      base = baselineFor(d.country, crop, se.id, se.harvestYear);
      if (!base) break;
      const sim = simulateKey(key, prep, now, false);
      fcs.push({ f: finalize(prep, sim.today, base, se), w: part.w, fs: sim.today, prep });
    }
    if (!base || !season || !fcs.length) continue;
    // mix members by weight
    const M = Math.max(...fcs.map((x) => x.fs.members.length));
    const members = Array.from({ length: M }, (_, m) => sum(fcs.map((x) => x.w * (x.fs.members[m % x.fs.members.length] ?? 1))));
    const mixFs: FactorSet = { ...fcs[0]!.fs, members, water: fcs[0]!.fs.water.map((_, m) => sum(fcs.map((x) => x.w * (x.fs.water[m % x.fs.water.length] ?? 1)))) };
    const f = finalize({ ...fcs[0]!.prep, meta: { ...fcs[0]!.prep.meta, irrigation: { label: `${Math.round(share * 100)} % irrigated (national share)`, reliability: r2(share * COEF.irrigationReliability.irrigated!), assumed: true } } }, mixFs, base, season);
    fcs = [];
    const cropShare = d.primaryCrops[0] === crop ? 0.7 : 0.25;
    const area = Math.round(d.monitoredAreaHa * cropShare);
    const price = priceUsdT(d.country, crop, base.normalTHa);
    districts.push({
      districtId: d.id,
      name: d.name,
      country: d.countryName,
      lat: d.lat,
      lon: d.lon,
      crop,
      cropAreaHa: area,
      irrigatedShare: share,
      forecast: f,
      productionT: { p10: Math.round(f.yieldTHa.p10 * area), p50: Math.round(f.yieldTHa.p50 * area), p90: Math.round(f.yieldTHa.p90 * area) },
      normalProductionT: Math.round(base.normalTHa * area),
      valueUsd: Math.round(f.yieldTHa.p50 * area * price.usdT),
      priceUsdT: price.usdT,
    });
  }

  // ── aggregations
  const aggRows = (rs: YieldAssetRow[]) => rs.map((r) => ({ areaHa: r.areaHa, memberYield: r.forecast.memberYield, cv: r.forecast.cv, p50: r.forecast.yieldTHa.p50, normal: r.forecast.baseline.normalTHa, price: r.priceUsdT }));
  const group = (keyOf: (r: YieldAssetRow) => string, labelOf: (r: YieldAssetRow) => string): GroupAgg[] => {
    const m = new Map<string, YieldAssetRow[]>();
    for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]);
    return [...m.entries()]
      .map(([k, rs]) => {
        const ag = aggregate(aggRows(rs));
        const area = ag.area;
        return {
          key: k,
          label: labelOf(rs[0]!),
          assets: rs.length,
          areaHa: r2(area),
          yieldP50: area ? r2(ag.p50 / area) : 0,
          normalTHa: area ? r2(ag.normal / area) : 0,
          vsNormalPct: ag.normal ? Math.round((ag.p50 / ag.normal - 1) * 1000) / 10 : 0,
          productionT: { p10: ag.p10, p50: ag.p50, p90: ag.p90 },
          normalProductionT: ag.normal,
          valueUsd: ag.value,
          lat: mean(rs.map((r) => r.lat)),
          lon: mean(rs.map((r) => r.lon)),
        };
      })
      .sort((a, b) => b.productionT.p50 - a.productionT.p50);
  };
  const tot = aggregate(aggRows(rows));

  // ── portfolio evolution (production-weighted)
  const evolution: EvolutionPoint[] = evolutionDates(now).map((t, wi) => {
    let p10 = 0;
    let p50 = 0;
    let p90 = 0;
    let normal = 0;
    let obs = 0;
    for (const r of rows) {
      const k = keyEvo.get(r.simKey);
      const sim = simCache.get(r.simKey);
      const fs = sim?.evo?.[wi];
      if (!k || !fs) continue;
      const b = bands(fs.members, fs.cv);
      p10 += b.p10 * k.base.trendTHa * r.areaHa;
      p50 += b.p50 * k.base.trendTHa * r.areaHa;
      p90 += b.p90 * k.base.trendTHa * r.areaHa;
      normal += k.base.normalTHa * r.areaHa;
      obs += fs.observedFrac * r.areaHa;
    }
    const area = sum(rows.map((r) => r.areaHa)) || 1;
    return { asOf: iso(t), p10: Math.round(p10), p50: Math.round(p50), p90: Math.round(p90), vsNormalPct: normal ? Math.round((p50 / normal - 1) * 1000) / 10 : 0, observedFrac: r2(obs / area) };
  });

  // ── industry outlooks
  const ins = rows.filter((r) => r.outlook.insurer);
  const insurer = ins.length
    ? (() => {
        const ay = ins.filter((r) => r.outlook.insurer!.areaYield);
        const prem = sum(ins.map((r) => r.outlook.insurer!.premiumUsd));
        const ayPrem = sum(ay.map((r) => r.outlook.insurer!.premiumUsd));
        const ayPay = sum(ay.map((r) => r.outlook.insurer!.expectedPayoutUsd));
        return {
          units: ins.length,
          areaYieldUnits: ay.length,
          expectedPayoutUsd: sum(ins.map((r) => r.outlook.insurer!.expectedPayoutUsd)),
          areaYieldExpectedPayoutUsd: ayPay,
          premiumUsd: prem,
          areaYieldPremiumUsd: ayPrem,
          expectedLossRatioPct: ayPrem > 0 ? Math.round((ayPay / ayPrem) * 1000) / 10 : null,
          unitsLikelyToPay: ins.filter((r) => r.outlook.insurer!.payoutProbPct >= 50).length,
        };
      })()
    : null;
  const loans = rows.filter((r) => r.outlook.bank);
  const bank = loans.length
    ? {
        loans: loans.length,
        stress: loans.filter((r) => r.outlook.bank!.flag === "stress").length,
        watch: loans.filter((r) => r.outlook.bank!.flag === "watch").length,
        outstandingUsd: sum(loans.map((r) => r.outlook.bank!.outstandingUsd)),
        outstandingStressUsd: sum(loans.filter((r) => r.outlook.bank!.flag === "stress").map((r) => r.outlook.bank!.outstandingUsd)),
        medianCoverP50: r2(quantile(loans.map((r) => r.outlook.bank!.coverP50), 0.5)),
      }
    : null;
  const allDrivers = rows.length ? rows[0]!.forecast.drivers.map((d) => ({ ...d, pct: Math.round((sum(rows.map((r) => (r.forecast.drivers.find((x) => x.key === d.key)?.pct ?? 0) * r.productionT.p50)) / Math.max(1e-9, sum(rows.map((r) => r.productionT.p50)))) * 10) / 10 + 0 })) : [];

  return {
    workspaceId: ws,
    generatedAt: new Date().toISOString(),
    asOf: iso(now),
    industry: org?.industry ?? null,
    assets: rows,
    skipped,
    districts,
    totals: {
      assets: rows.length,
      areaHa: r2(tot.area),
      productionT: { p10: tot.p10, p50: tot.p50, p90: tot.p90 },
      normalProductionT: tot.normal,
      vsNormalPct: tot.normal ? Math.round((tot.p50 / tot.normal - 1) * 1000) / 10 : 0,
      valueUsd: tot.value,
      normalValueUsd: Math.round(sum(rows.map((r) => r.normalValueUsd))),
      belowNormalAssets: rows.filter((r) => r.forecast.vsNormalPct < -5).length,
    },
    byDistrict: group((r) => r.districtId ?? "other", (r) => (r.district ? `${r.district}, ${r.countryCode}` : "Other")),
    byCountry: group((r) => r.countryCode, (r) => r.country),
    byCrop: group((r) => r.crop, (r) => r.cropLabel),
    evolution,
    outlook: {
      insurer,
      bank,
      sourcing: {
        byDistrict: districts.map((d) => ({ districtId: d.districtId, name: d.name, crop: d.crop, p10: d.productionT.p10, p50: d.productionT.p50, p90: d.productionT.p90, normal: d.normalProductionT })),
      },
    },
    coverage: { cells: points.size, cellsWithHistory: [...points.keys()].filter((k) => hist.has(k)).length, pending: batch.pending, providers: batch.providers, fallbackAssets: rows.filter((r) => r.forecast.weather.fallback).length },
    drivers: allDrivers,
  };
}

/** Full detail for one asset: forecast + weekly evolution + members + NDVI series. */
export async function assetDetail(ws: string, id: string, now = Date.now()) {
  const book = await yieldBook(ws, { now });
  const row = book.assets.find((r) => r.id === id);
  if (!row) return null;
  const sim = simCache.get(row.simKey);
  const base = row.forecast.baseline;
  const evolution: EvolutionPoint[] = (sim?.evo ?? []).map((fs) => {
    const b = bands(fs.members, fs.cv);
    return { asOf: fs.asOf, p10: r2(b.p10 * base.trendTHa), p50: r2(b.p50 * base.trendTHa), p90: r2(b.p90 * base.trendTHa), vsNormalPct: Math.round(((b.p50 * base.trendTHa) / base.normalTHa - 1) * 1000) / 10, observedFrac: r2(fs.observedFrac) };
  });
  const s = getStore();
  const ndvi = ndviSeriesFor(row.districtId, row.crop);
  const p = cropParams(row.crop)!;
  const sowT = Date.parse(row.forecast.season.sow);
  const hist = sim ? bands(sim.today.members, sim.today.cv).samples.map((x) => x * base.trendTHa) : [];
  const lo = Math.min(...hist, base.normalTHa * 0.5);
  const hi = Math.max(...hist, base.normalTHa * 1.3);
  const bins = 14;
  const histogram = Array.from({ length: bins }, (_, i) => {
    const a = lo + ((hi - lo) * i) / bins;
    const b = lo + ((hi - lo) * (i + 1)) / bins;
    return { from: r2(a), to: r2(b), mid: r2((a + b) / 2), share: hist.length ? r3(hist.filter((v) => v >= a && (i === bins - 1 ? v <= b : v < b)).length / hist.length) : 0 };
  });
  return {
    row,
    evolution,
    histogram,
    ndviSeries: (ndvi?.points ?? []).map((q) => ({ date: q.date, ndvi: q.ndvi, expected: q.date >= row.forecast.season.sow ? r3(ndviExpected(p, clamp((Date.parse(q.date) - sowT) / (row.forecast.season.days * DAY), 0, 1))) : null })),
    ndviSource: ndvi?.source ?? null,
    memberYears: sim?.today.memberYears ?? [],
    district: row.districtId ? s.districts.find((d) => d.id === row.districtId)?.name ?? null : null,
    crop: { label: p.label, stages: p.stages, kc: p.kc, ky: p.ky, kySeasonal: p.kySeasonal, heat: p.heat, salinity: p.salinity, assumed: p.assumed ?? null, src: p.src },
  };
}

/** District detail with weekly evolution (area-weighted irrigated / rain-fed mix). */
export async function districtDetail(ws: string, districtId: string, now = Date.now()) {
  const book = await yieldBook(ws, { now });
  const d = book.districts.find((x) => x.districtId === districtId);
  if (!d) return null;
  const s = getStore();
  const rec = s.districts.find((x) => x.id === districtId)!;
  const share = d.irrigatedShare;
  const hist = new Map<string, DailyHistory>();
  const rp = refPointOf(rec.lat, rec.lon);
  const b = await historiesFor([rp], 2000);
  for (const [k, v] of b.map) hist.set(k, v);
  const parts = [
    { rel: COEF.irrigationReliability.irrigated!, w: share },
    { rel: 0, w: 1 - share },
  ];
  const sims = parts.map((part) => {
    const { key, prep } = prepFor({ id: d.districtId, lat: rec.lat, lon: rec.lon, districtId: d.districtId, country: rec.country, crop: d.crop, reliability: part.rel, irrigationLabel: "", assumed: true, floodExpo: 1, now, hist });
    return { w: part.w, sim: simulateKey(key, prep, now, true) };
  });
  const base = d.forecast.baseline;
  const evolution: EvolutionPoint[] = evolutionDates(now).map((_, wi) => {
    const M = Math.max(...sims.map((x) => x.sim.evo?.[wi]?.members.length ?? 1));
    const members = Array.from({ length: M }, (_, m) => sum(sims.map((x) => x.w * (x.sim.evo?.[wi]?.members[m % (x.sim.evo?.[wi]?.members.length || 1)] ?? 1))));
    const fs0 = sims[0]!.sim.evo?.[wi];
    const bb = bands(members, fs0?.cv ?? 0.12);
    return { asOf: fs0?.asOf ?? "", p10: r2(bb.p10 * base.trendTHa), p50: r2(bb.p50 * base.trendTHa), p90: r2(bb.p90 * base.trendTHa), vsNormalPct: Math.round(((bb.p50 * base.trendTHa) / base.normalTHa - 1) * 1000) / 10, observedFrac: r2(fs0?.observedFrac ?? 0) };
  });
  return { district: d, evolution, assets: book.assets.filter((r) => r.districtId === districtId).map((r) => ({ id: r.id, name: r.name, crop: r.crop, yieldP50: r.forecast.yieldTHa.p50, vsNormalPct: r.forecast.vsNormalPct })) };
}

export const YIELD_METHODOLOGY = {
  formula: "Y = Y_trend · f_season · f_region · f_water · f_heat · f_flood · f_salinity · f_ndvi · ε",
  components: [
    { key: "baseline", title: "Baseline yield", text: "FAOSTAT national yield (QCL, 2015-2024). 5-year normal = mean 2020-2024; trend = OLS 2015-2024 at the harvest year, capped ±8 % of the normal. Rice is scaled by a seasonal factor (Aman/Boro, kharif/rabi, wet/dry, Winter-Spring…) and, for Odisha, by the state/national yield ratio 0.778 (DA&FW Agricultural Statistics at a Glance 2023)." },
    { key: "water", title: "Water stress — FAO-33 Ky", text: "Daily FAO-56 water balance: ETc = Kc·ET0 with the stage Kc curve; root-zone bucket TAW = 140 mm/m × Zr with depletion fraction p; rice adds a 100 mm paddy pond losing 3 mm/day to percolation. Irrigation refills a reliability share of the deficit (canal 0.8, tube-well 0.95; rain-fed 0). Relative yield per stage 1 − Ky(1 − ETa/ETc), multiplied across stages. Observed ERA5/NASA POWER weather to date, then each of the previous 30 years' weather for the rest of the season → 30 members, expressed relative to the same model over those 30 past seasons." },
    { key: "heat", title: "Heat at flowering", text: "Degree-days of Tmax above the anthesis threshold (rice 35 °C, maize 35 °C, vegetables 32 °C, wheat 31 °C) within ±7-10 days of flowering; loss = 1 − e^(−0.02·HDD), relative to its 30-season mean." },
    { key: "flood", title: "Flood / submergence", text: "Real flood episodes (GloFAS v4 discharge > P95 or ERA5 3-day rain > P99, 2019 → present) overlapping the season: flooded share × damage (depth/duration curves of real/index.ts#floodLoss, episode days capped at 21) × stage sensitivity × asset flood exposure. Rest of season sampled from past seasons; live 72-h flood probability above climatology adds its expected loss. Relative to the mean seasonal flood loss of past seasons." },
    { key: "salinity", title: "Salinity — FAO-29 Maas–Hoffman", text: "RY = 1 − b(ECe − a)/100 (rice a = 3.0 dS/m, b = 12 %/dS/m). Season-mean ECe from the platform salinity model with observed vs normal 30-day rainfall." },
    { key: "ndvi", title: "Satellite NDVI anomaly", text: "Latest NDVI (MODIS MOD13Q1 when the satellite job has run; otherwise the seeded field history, down-weighted) vs a reference crop NDVI profile at that stage. Elasticity 0.5, weighted 0 before 25 % of the season, capped −12 %/+6 % to limit double counting with the water and flood terms." },
    { key: "uncertainty", title: "Uncertainty", text: "P10/P90 from the 30 weather/flood members × structural error (CV 14 % before sowing → 6 % at harvest; 16 % when no weather history is cached). Portfolio totals sum members year-by-year (shared weather years are spatially coherent) with structural errors correlated at ρ = 0.3." },
  ],
  industry: {
    insurer: "Area-yield index: indemnity = max(0, TY − Y)/TY × sum insured with threshold yield TY = 80 % of the 5-yr normal (PMFBY-style indemnity level). Expected payout and payout probability over the forecast distribution.",
    bank: "Repayment capacity = crop revenue (yield × area × farm-gate price) ÷ debt service due this season (pro-rata principal over ≤ 6 months + 6 months' interest). 'Stress' when the P10 revenue does not cover it; 'watch' when P50 cover < 1.5×.",
    agribusiness: "Sourcing volume = forecast production (t) P10/P50/P90 by district, from estimated cropped area (census farm count × mean holding × crop share).",
  },
  sources: [
    { name: "FAOSTAT Crops and livestock products (QCL)", url: "https://www.fao.org/faostat/en/#data/QCL" },
    { name: "FAO-56 Crop evapotranspiration", url: "https://www.fao.org/4/x0490e/x0490e00.htm" },
    { name: "FAO-33 / FAO-66 Crop yield response to water", url: "https://www.fao.org/4/i2800e/i2800e.pdf" },
    { name: "FAO-29 Water quality for agriculture (Maas–Hoffman)", url: "https://www.fao.org/4/t0234e/t0234e00.htm" },
    { name: "Agricultural Statistics at a Glance 2023 (DA&FW, India)", url: "https://desagri.gov.in/wp-content/uploads/2024/09/Agricultural-Statistics-at-a-Glance-2023.pdf" },
    { name: "ERA5 via Open-Meteo archive / NASA POWER", url: "https://open-meteo.com/en/docs/historical-weather-api" },
    { name: "GloFAS v4 river discharge", url: "https://open-meteo.com/en/docs/flood-api" },
    { name: "MODIS MOD13Q1 NDVI (ORNL DAAC)", url: "https://modis.ornl.gov/data/modis_webservice.html" },
  ],
  limitations: [
    "National FAOSTAT yields (plus the Odisha ratio) are the baseline; farm-level yields differ with variety, management and soils — CV bands reflect that.",
    "Flood record is 2019 → present (≈ 7 seasons); the flood normal is therefore uncertain.",
    "NDVI is a weak yield signal before heading; seeded field NDVI is down-weighted until the MODIS ingest job runs.",
    "Pests, diseases and prices are not modelled.",
  ],
};
