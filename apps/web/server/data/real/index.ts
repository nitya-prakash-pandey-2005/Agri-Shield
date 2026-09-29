/**
 * Real reference datasets (committed, compact JSON) + typed loaders.
 *
 * Everything here is loaded synchronously at import time (≈ 0.2 MB total) so
 * the deterministic demo seed can use it without I/O. Regenerate the JSON with
 * the scripts in `scripts/data/` — see `./README.md` for sources, licences and
 * transformations.
 */
import agriJson from "./agri-reference.json";
import commodityJson from "./commodity-prices.json";
import cycloneJson from "./cyclones.json";
import boundaryJson from "./district-boundaries.json";
import drySpellJson from "./dry-spells.json";
import facilityJson from "./facilities.json";
import floodJson from "./flood-events.json";
import landJson from "./land-points.json";
import salinityJson from "./salinity-seasons.json";

// ─── Floods ───────────────────────────────────────────────────────────────

export interface FloodEvent {
  start: string;
  end: string;
  peakDate: string;
  durationDays: number;
  /** GloFAS v4 peak daily discharge at the district's river cell (m³/s) */
  peakDischargeM3s: number;
  /** max ERA5 3-day rainfall during the episode (mm) */
  peakRain3dMm: number;
  rainTotalMm: number;
  /** physically-derived inundation depth proxy (m) — see ML features.depth_proxy */
  depthM: number;
  driver: "riverine" | "pluvial" | "both";
}

type FloodRow = [string, string, string, number, number, number, number, string];
interface FloodFile {
  generated: string;
  period: [string, string];
  definition: string;
  districts: Record<string, { qP95: number; rain3P99: number; elevationM: number; glofasCell: [number, number]; events: FloodRow[] }>;
}
const FLOODS = floodJson as unknown as FloodFile;
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;

export const floodPeriod = (): [string, string] => FLOODS.period;

export function floodEvents(districtId: string): FloodEvent[] {
  const d = FLOODS.districts[districtId];
  if (!d) return [];
  return d.events.map(([start, end, peakDate, q, r3, rt, depth, driver]) => ({
    start,
    end,
    peakDate,
    durationDays: days(start, end),
    peakDischargeM3s: q,
    peakRain3dMm: r3,
    rainTotalMm: rt,
    depthM: depth,
    driver: driver as FloodEvent["driver"],
  }));
}

/**
 * Climatological flood probability for a calendar month: the share of days in
 * that month (across the whole record) from which a real flood episode was
 * underway within the next `windowDays`. This is the honest "no-forecast"
 * baseline — what history alone says about the next 1-3 days.
 */
export function floodClimatology(districtId: string, month: number, windowDays = 3): number {
  const evs = floodEvents(districtId);
  if (!evs.length) return 0.05;
  const [p0, p1] = FLOODS.period;
  const startYear = Number(p0.slice(0, 4));
  const endYear = Number(p1.slice(0, 4));
  const spans = evs.map((e) => [Date.parse(e.start), Date.parse(e.end) + DAY - 1] as const);
  let hit = 0;
  let total = 0;
  for (let y = startYear; y <= endYear; y++) {
    const dim = new Date(Date.UTC(y, month, 0)).getUTCDate();
    for (let d = 1; d <= dim; d++) {
      const t0 = Date.UTC(y, month - 1, d);
      if (t0 > Date.parse(p1)) break;
      total++;
      const t1 = t0 + windowDays * DAY;
      if (spans.some(([a, b]) => a < t1 && b >= t0)) hit++;
    }
  }
  return total ? hit / total : 0.05;
}

export function floodThresholds(districtId: string) {
  const d = FLOODS.districts[districtId];
  return d ? { qP95: d.qP95, rain3P99: d.rain3P99, elevationM: d.elevationM, glofasCell: d.glofasCell } : null;
}

// ─── Salinity / dry spells / cyclones ─────────────────────────────────────

export interface SalinitySeason {
  year: number;
  onset: string;
  peak: string;
  /** relative salt-intrusion length vs a normal year (Savenije L ∝ Q^-0.6 of main-stem discharge) */
  intrusionIndex: number;
  /** estimated dry-season peak root-zone ECe (dS/m) */
  peakEce: number;
}
interface SalFile {
  drivers: Record<string, string>;
  districts: Record<string, { driver: string; seasons: [number, string, string, number, number][] }>;
}
const SAL = salinityJson as unknown as SalFile;

export function salinitySeasons(districtId: string): SalinitySeason[] {
  return (SAL.districts[districtId]?.seasons ?? []).map(([year, onset, peak, intrusionIndex, peakEce]) => ({ year, onset, peak, intrusionIndex, peakEce }));
}
export function salinityDriver(districtId: string): string | null {
  const d = SAL.districts[districtId];
  if (!d) return null;
  return SAL.drivers[d.driver] ?? "ERA5 60-day dry-season rainfall deficit";
}

export interface DrySpell {
  start: string;
  end: string;
  minRain30dMm: number;
  minRatioToNormal: number;
}
const DRY = drySpellJson as unknown as { districts: Record<string, [string, string, number, number][]> };
export function drySpells(districtId: string): DrySpell[] {
  return (DRY.districts[districtId] ?? []).map(([start, end, minRain30dMm, minRatioToNormal]) => ({ start, end, minRain30dMm, minRatioToNormal }));
}

export interface CycloneHit {
  name: string;
  gdacsId: number;
  alert: "Green" | "Orange" | "Red";
  maxWindKmh: number;
  /** date of closest approach to the district */
  date: string;
  /** GDACS wind buffer containing the district centroid; "near" = track within 150 km */
  windBuffer: "red" | "orange" | "green" | "near";
  distanceKm: number;
}
interface CycFile {
  events: { name: string; gdacsId: number; alert: string; maxWindKmh: number; districts: [string, string, string, number][] }[];
}
const CYC = cycloneJson as unknown as CycFile;
export function cyclonesFor(districtId: string): CycloneHit[] {
  const out: CycloneHit[] = [];
  for (const e of CYC.events)
    for (const [id, date, buf, km] of e.districts)
      if (id === districtId)
        out.push({ name: e.name, gdacsId: e.gdacsId, alert: e.alert as CycloneHit["alert"], maxWindKmh: e.maxWindKmh, date, windBuffer: buf as CycloneHit["windBuffer"], distanceKm: km });
  return out;
}

// ─── Commodity prices ─────────────────────────────────────────────────────

interface CommodityFile {
  generated: string;
  start: string;
  end: string;
  pinkSheetUrl: string;
  pinkSheetUpdated: string;
  series: Record<string, { label: string; unit: string; source: string; lastObserved?: string; values: (number | null)[] }>;
  commodities: Record<string, { series: string; factor: number; method: string; values: (number | null)[] }>;
}
const PRICES = commodityJson as unknown as CommodityFile;

function monthsFrom(start: string, n: number): string[] {
  const [y, m] = start.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const t = y * 12 + (m - 1) + i;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  });
}

export interface MonthlyPrice {
  month: string;
  price: number;
}

/** Monthly USD/t series (app commodity name, e.g. "rice", or a raw series key, e.g. "urea"). */
export function monthlyPrices(key: string): MonthlyPrice[] {
  const vals = PRICES.commodities[key]?.values ?? PRICES.series[key]?.values;
  if (!vals) return [];
  const months = monthsFrom(PRICES.start, vals.length);
  return vals.flatMap((v, i) => (v == null ? [] : [{ month: months[i]!, price: v }]));
}

export function commodityPriceMeta(commodity: string) {
  const c = PRICES.commodities[commodity];
  if (!c) return null;
  const s = PRICES.series[c.series];
  return {
    method: c.method,
    series: c.series,
    label: s?.label ?? c.series,
    source: s?.source ?? "",
    lastObservedMonth: s?.lastObserved ?? PRICES.end,
    latestMonth: PRICES.end,
    publication: PRICES.pinkSheetUpdated,
    url: PRICES.pinkSheetUrl,
  };
}

/** Linear interpolation of a monthly series (values anchored mid-month) at an ISO date; flat beyond the ends. */
export function priceAt(series: MonthlyPrice[], isoDate: string): number {
  if (!series.length) return NaN;
  const t = Date.parse(isoDate);
  const anchor = (m: string) => Date.parse(`${m}-15T00:00:00Z`);
  if (t <= anchor(series[0]!.month)) return series[0]!.price;
  for (let i = 1; i < series.length; i++) {
    const a = anchor(series[i - 1]!.month);
    const b = anchor(series[i]!.month);
    if (t <= b) return series[i - 1]!.price + ((series[i]!.price - series[i - 1]!.price) * (t - a)) / (b - a);
  }
  return series[series.length - 1]!.price;
}

/** Mean of the last `n` monthly prints. */
export function trailingMean(series: MonthlyPrice[], n = 12): number {
  const s = series.slice(-n);
  return s.reduce((a, b) => a + b.price, 0) / Math.max(1, s.length);
}

// ─── Land-validated points & facilities ───────────────────────────────────

/** [lat, lon, elevation m (SRTM-based Terrarium DEM)] */
export type LandPoint = [number, number, number];
export interface LandSite {
  home: LandPoint;
  plots: LandPoint[];
}
const LAND = landJson as unknown as { checks: string; districts: Record<string, [number, number, number, LandPoint[]][]> };

export function landSites(districtId: string): LandSite[] {
  return (LAND.districts[districtId] ?? []).map(([lat, lon, elev, plots]) => ({ home: [lat, lon, elev], plots }));
}
/** Every validated point (homes + plots) of a district, in a stable order. */
export function landPoints(districtId: string): LandPoint[] {
  return landSites(districtId).flatMap((s) => [s.home, ...s.plots]);
}
export const landChecks = () => LAND.checks;

export interface Facility {
  name: string;
  districtId: string;
  lat: number;
  lon: number;
  osmQuery: string;
  offsetKm: number | null;
  landCheck?: boolean;
}
const FAC = facilityJson as unknown as { facilities: Facility[] };
export const facilityByName = (name: string) => FAC.facilities.find((f) => f.name === name) ?? null;
export const facilities = () => FAC.facilities;

// ─── District boundaries ──────────────────────────────────────────────────

interface BoundaryFile {
  source: string;
  districts: Record<string, { units: string[]; source: string; method: string; areaKm2: number; ring: [number, number][] }>;
}
const BOUNDS = boundaryJson as unknown as BoundaryFile;

/** Real, simplified admin boundary (GeoJSON outer ring [lon, lat], CCW, closed) or null. */
export function districtRing(districtId: string): number[][] | null {
  const b = BOUNDS.districts[districtId];
  return b ? b.ring.map(([x, y]) => [x, y]) : null;
}
export function districtBoundaryMeta(districtId: string) {
  const b = BOUNDS.districts[districtId];
  return b ? { units: b.units, source: b.source, method: b.method, areaKm2: b.areaKm2 } : null;
}

// ─── Agricultural reference statistics ────────────────────────────────────

export interface CountryAgriStats {
  avgFarmHa: number;
  avgFarmHaSource: string;
  householdSize: number;
  farmHouseholdShare: number;
  paddyYieldTHa: number;
  paddyFarmgateUsdT: number;
  loanRatePct: [number, number];
  loanRateSource: string;
}
interface AgriFile {
  countries: Record<string, CountryAgriStats>;
  districtRuralAdjust: Record<string, number | string>;
  productionCostUsdHa: Record<string, Record<string, number> | string>;
  insurancePremiumPct: { weatherIndex: [number, number]; areaYield: [number, number]; indemnity: [number, number] };
  loanSizeUsd: Record<string, { median: number; min: number; max: number } | string>;
  anticipatoryCash: { bdtPerHousehold: number };
}
export const AGRI = agriJson as unknown as AgriFile;

export const countryStats = (code: string): CountryAgriStats => AGRI.countries[code] ?? AGRI.countries.BD!;

/** Farm households in a district ≈ population / household size × farm-household share × urban adjustment. */
export function farmHouseholds(districtId: string, country: string, population: number): number {
  const s = countryStats(country);
  const adj = AGRI.districtRuralAdjust[districtId];
  return Math.round((population / s.householdSize) * s.farmHouseholdShare * (typeof adj === "number" ? adj : 1));
}

export function productionCostUsdHa(country: string, crop: string): number {
  const t = AGRI.productionCostUsdHa[country];
  const row = typeof t === "object" ? t : undefined;
  return row?.[crop] ?? row?.rice ?? 900;
}

export function loanSize(country: string) {
  const v = AGRI.loanSizeUsd[country];
  return typeof v === "object" ? v : { median: 2500, min: 500, max: 15000 };
}

// ─── Flood loss model (documented in README) ──────────────────────────────

const WET_SEASON: Record<string, number[]> = { BD: [6, 7, 8, 9, 10, 11], IN: [6, 7, 8, 9, 10, 11], VN: [5, 6, 7, 8, 9, 10, 11], PH: [6, 7, 8, 9, 10, 11], ID: [11, 12, 1, 2, 3, 4] };

export interface FloodLoss {
  floodedHa: number;
  damageRatio: number;
  cropValueUsdHa: number;
  lossUsd: number;
  farmsAffected: number;
}

/**
 * floodedHa  = vulnerableHa × clamp(0.005 + 0.35·(1 − e^(−depth/0.7))·(0.4 + 0.6·min(1, days/14)), 0.002, 0.5)
 * damage     = clamp(0.2 + 0.6·(1 − e^(−depth/0.8)) + 0.012·days, 0.1, 0.95)
 * lossUsd    = floodedHa × (paddy yield × farm-gate price) × damage × seasonFactor(1 | 0.5)
 * farms      = floodedHa / country mean farm size
 */
export function floodLoss(p: { depthM: number; durationDays: number; vulnerableAreaHa: number; country: string; month: number }): FloodLoss {
  const s = countryStats(p.country);
  const share = Math.min(0.5, Math.max(0.002, 0.005 + 0.35 * (1 - Math.exp(-p.depthM / 0.7)) * (0.4 + 0.6 * Math.min(1, p.durationDays / 14))));
  const damage = Math.min(0.95, Math.max(0.1, 0.2 + 0.6 * (1 - Math.exp(-p.depthM / 0.8)) + 0.012 * p.durationDays));
  const cropValue = s.paddyYieldTHa * s.paddyFarmgateUsdT;
  const season = (WET_SEASON[p.country] ?? WET_SEASON.BD!).includes(p.month) ? 1 : 0.5;
  const floodedHa = p.vulnerableAreaHa * share;
  return {
    floodedHa: Math.round(floodedHa),
    damageRatio: Math.round(damage * 100) / 100,
    cropValueUsdHa: Math.round(cropValue),
    lossUsd: Math.round(floodedHa * cropValue * damage * season),
    farmsAffected: Math.round(floodedHa / s.avgFarmHa),
  };
}

// ─── Provenance ───────────────────────────────────────────────────────────

export const REAL_SOURCES = {
  floods: `GloFAS v4 discharge + ERA5 rainfall (Open-Meteo, CC BY 4.0), episodes ${FLOODS.period[0]} → ${FLOODS.period[1]}`,
  salinity: "GloFAS v4 main-stem dry-season discharge (salt-intrusion length ∝ Q^-0.6) / ERA5 rainfall deficit (Java)",
  cyclones: "GDACS tropical-cyclone events & wind buffers (EC JRC / UN OCHA)",
  prices: `World Bank Pink Sheet (CC BY 4.0), ${PRICES.pinkSheetUpdated.replace("Updated on ", "updated ")}; WFP/HDX; CACP MSP`,
  land: "geoBoundaries admin polygons + SRTM-based Terrarium DEM + JRC Global Surface Water",
  boundaries: "geoBoundaries gbOpen ADM1/ADM2 (CC BY 3.0 IGO · ODbL · public domain), simplified",
  agri: "BBS, GSO, PSA, MoA&FW Agriculture Census, BPS (see real/agri-reference.json)",
} as const;
