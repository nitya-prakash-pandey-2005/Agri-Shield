/**
 * Sustainability & carbon MRV for rice-heavy portfolios — IPCC 2019 Refinement Tier 1.
 *
 *  Rice CH4 (Vol.4 Ch.5 Eq. 5.1-5.3)
 *    EF_i  = EF_c × SF_w × SF_p × SF_o                    kg CH4 ha⁻¹ day⁻¹
 *    CH4   = EF_i × t × A                                  t = cultivation period (days), A = ha
 *    EF_c  = 1.19 (global default, Table 5.11; regional values in Table 5.11A optional)
 *    SF_w  = 1.00 continuously flooded · 0.71 single drainage · 0.55 multiple drainage (AWD) ·
 *            0.54 regular rain-fed · 0.16 drought-prone · 0.06 deep water        (Table 5.12)
 *    SF_p  = 1.00 non-flooded < 180 d · 0.89 > 180 d · 2.41 flooded > 30 d · 0.59 > 365 d (Table 5.13)
 *    SF_o  = (1 + Σ ROA_i × CFOA_i)^0.59                  (Eq. 5.3, Table 5.14)
 *  N2O from synthetic N (Ch.11 Eq. 11.1, 11.9-11.10)
 *    direct   = F_SN × EF1 × 44/28 — EF1 = 0.004 flooded rice (0.003 continuous / 0.005 drained
 *               when disaggregated), 0.01 other crops (aggregated default)
 *    indirect = F_SN × (Frac_GASF × EF4 + Frac_LEACH × EF5) × 44/28
 *  Urea CO2 (Eq. 11.13) = urea × 0.20 × 44/12, urea = F_SN / 0.46
 *  CO2e (GWP-100, IPCC AR6): CH4 non-fossil 27.0 · N2O 273
 *
 *  Carbon-credit revenue is INDICATIVE (price slider × avoided t CO2e after a conservativeness
 *  deduction) and is not a Verra VM0051 verified estimate.
 *
 * Author: Nitya Prakash Pandey.
 */
import { getStore, type AssetRecord } from "../data/store";
import ipccJson from "../data/real/ipcc-rice.json";
import { countryCodeOf, irrigationOf, yieldBook, type YieldAssetRow } from "./yield-model";
import { awdWaterSaving, waterFootprint } from "./water-footprint";

// ─── Reference data ───────────────────────────────────────────────────────

interface Factor {
  value: number;
  low?: number;
  high?: number;
  label?: string;
}
interface IpccFile {
  sources: Record<string, string>;
  ch4: {
    efBaseline: { value: number; low: number; high: number; unit: string; table: string };
    efRegional: Record<string, number | string>;
    regionOf: Record<string, string>;
    sfw: Record<string, Factor | string>;
    sfp: Record<string, Factor | string>;
    cfoa: Record<string, Factor | string>;
    sfoExponent: number;
  };
  n2o: {
    ef1Aggregated: { value: number; low: number; high: number; table: string };
    ef1FloodedRice: { value: number; low: number; high: number; table: string };
    ef1RiceByRegime: { continuous: number; drainage: number; table: string };
    fracGasf: number;
    ef4: number;
    fracLeach: number;
    ef5: number;
    n2oPerN2oN: number;
  };
  urea: { efTcPerTUrea: number; ureaNFrac: number; co2PerC: number; note: string };
  gwp100: { ch4: number; ch4Fossil: number; n2o: number; source: string };
  nRateKgHa: Record<string, number | string | Record<string, number>>;
  croppingIntensity: { irrigated: Record<string, number>; rainfed: number; _note: string };
  awd: { sfwBaseline: string; sfwProject: string; waterSavingPct: { central: number; low: number; high: number }; yieldEffectPct: number; eligibility: string };
  creditPrice: { default: number; min: number; max: number; note: string };
  conservativenessPct: number;
}
export const IPCC = ipccJson as unknown as IpccFile;

export type SfwKey = "continuously_flooded" | "single_drainage" | "multiple_drainage" | "regular_rainfed" | "drought_prone" | "deep_water" | "upland";
export type SfpKey = "non_flooded_lt180" | "non_flooded_gt180" | "flooded_gt30" | "non_flooded_gt365";
export type OrganicKey = "none" | "straw_short" | "straw_long" | "compost" | "fym" | "green_manure";
export const SFW_KEYS: SfwKey[] = ["continuously_flooded", "single_drainage", "multiple_drainage", "regular_rainfed", "drought_prone", "deep_water", "upland"];
export const SFP_KEYS: SfpKey[] = ["non_flooded_lt180", "non_flooded_gt180", "flooded_gt30", "non_flooded_gt365"];
export const ORGANIC_KEYS: OrganicKey[] = ["none", "straw_short", "straw_long", "compost", "fym", "green_manure"];

const fac = (table: Record<string, Factor | string>, key: string): Factor => {
  const v = table[key];
  return typeof v === "object" ? v : { value: 1 };
};
export const sfwOf = (k: SfwKey) => fac(IPCC.ch4.sfw, k).value;
export const sfpOf = (k: SfpKey) => fac(IPCC.ch4.sfp, k).value;
export const cfoaOf = (k: OrganicKey) => fac(IPCC.ch4.cfoa, k).value;
export const labelOf = (table: "sfw" | "sfp" | "cfoa", k: string) => fac(IPCC.ch4[table] as Record<string, Factor | string>, k).label ?? k;

// ─── Pure IPCC maths ──────────────────────────────────────────────────────

/** Eq. 5.3: SF_o = (1 + Σ ROA_i · CFOA_i)^0.59 */
export function sfo(amendments: { cfoa: number; tPerHa: number }[]): number {
  const s = amendments.reduce((a, x) => a + Math.max(0, x.tPerHa) * Math.max(0, x.cfoa), 0);
  return Math.pow(1 + s, IPCC.ch4.sfoExponent);
}

/** Eq. 5.2 daily EF: EF_i = EF_c × SF_w × SF_p × SF_o (× SF_s,r = 1). */
export function dailyEf(efc: number, sfw: number, sfp: number, sfoV: number): number {
  return efc * sfw * sfp * sfoV;
}

/** Eq. 5.1 (one season, one field): kg CH4 = EF_i × t × A. */
export function riceCh4Kg(p: { efc: number; sfw: number; sfp: number; sfo: number; days: number; areaHa: number }): number {
  return dailyEf(p.efc, p.sfw, p.sfp, p.sfo) * Math.max(0, p.days) * Math.max(0, p.areaHa);
}

/** Direct N2O (kg N2O) from synthetic fertiliser N (kg N). */
export function n2oDirectKg(nKg: number, ef1: number): number {
  return Math.max(0, nKg) * ef1 * IPCC.n2o.n2oPerN2oN;
}
/** Indirect N2O (kg N2O): volatilisation + leaching/runoff. */
export function n2oIndirectKg(nKg: number): number {
  const n = IPCC.n2o;
  return Math.max(0, nKg) * (n.fracGasf * n.ef4 + n.fracLeach * n.ef5) * n.n2oPerN2oN;
}
/** Urea hydrolysis CO2 (kg CO2) if all N is applied as urea. */
export function ureaCo2Kg(nKg: number): number {
  const u = IPCC.urea;
  return (Math.max(0, nKg) / u.ureaNFrac) * u.efTcPerTUrea * u.co2PerC;
}
/** t CO2e with AR6 GWP-100 (CH4 non-fossil 27, N2O 273). */
export function tCo2e(p: { ch4Kg?: number; n2oKg?: number; co2Kg?: number }): number {
  const g = IPCC.gwp100;
  return ((p.ch4Kg ?? 0) * g.ch4 + (p.n2oKg ?? 0) * g.n2o + (p.co2Kg ?? 0)) / 1000;
}

/** EF1 for a crop / water regime. */
export function ef1For(crop: string, regime: SfwKey, disaggregate = true): number {
  if (crop !== "rice" || regime === "upland") return IPCC.n2o.ef1Aggregated.value;
  if (!disaggregate) return IPCC.n2o.ef1FloodedRice.value;
  return regime === "continuously_flooded" || regime === "deep_water" ? IPCC.n2o.ef1RiceByRegime.continuous : regime === "single_drainage" || regime === "multiple_drainage" ? IPCC.n2o.ef1RiceByRegime.drainage : IPCC.n2o.ef1FloodedRice.value;
}

export interface Emissions {
  ch4Kg: number;
  n2oKg: number;
  co2Kg: number;
  tCo2e: number;
  ch4TCo2e: number;
  n2oTCo2e: number;
  co2TCo2e: number;
}

/** Season emissions of one crop plot. */
export function seasonEmissions(p: { crop: string; areaHa: number; days: number; efc: number; regime: SfwKey; preseason: SfpKey; organic: OrganicKey; organicT: number; nKgHa: number; indirect?: boolean; disaggregateN2o?: boolean }): Emissions {
  const nKg = p.nKgHa * p.areaHa;
  const ch4Kg = p.crop === "rice" ? riceCh4Kg({ efc: p.efc, sfw: sfwOf(p.regime), sfp: sfpOf(p.preseason), sfo: sfo(p.organic === "none" ? [] : [{ cfoa: cfoaOf(p.organic), tPerHa: p.organicT }]), days: p.days, areaHa: p.areaHa }) : 0;
  const n2oKg = n2oDirectKg(nKg, ef1For(p.crop, p.regime, p.disaggregateN2o ?? true)) + (p.indirect === false ? 0 : n2oIndirectKg(nKg));
  const co2Kg = ureaCo2Kg(nKg);
  const g = IPCC.gwp100;
  return { ch4Kg, n2oKg, co2Kg, tCo2e: tCo2e({ ch4Kg, n2oKg, co2Kg }), ch4TCo2e: (ch4Kg * g.ch4) / 1000, n2oTCo2e: (n2oKg * g.n2o) / 1000, co2TCo2e: co2Kg / 1000 };
}

/** Indicative credit revenue: avoided t × (1 − deduction) × price. */
export function creditRevenue(avoidedT: number, priceUsd: number, deductionPct = IPCC.conservativenessPct) {
  const credits = Math.max(0, avoidedT) * (1 - deductionPct / 100);
  return { credits, usd: credits * priceUsd };
}

// ─── Practice state (kept on asset.meta, prefixed mrv_) ───────────────────

export type AwdStatus = "self_reported" | "field_verified" | "remote_sensed";
export interface Practice {
  eligible: boolean;
  irrigated: boolean;
  irrigationLabel: string;
  baselineRegime: SfwKey;
  regime: SfwKey;
  preseason: SfpKey;
  organic: OrganicKey;
  organicT: number;
  nKgHa: number;
  nDefault: boolean;
  awd: boolean;
  awdStatus: AwdStatus | null;
  awdSince: string | null;
  note: string | null;
  seasonsPerYear: number;
  overridden: boolean;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const numOr = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function defaultNRate(crop: string, cc: string): number {
  const v = IPCC.nRateKgHa[crop];
  if (typeof v === "number") return v;
  if (v && typeof v === "object") return (v as Record<string, number>)[cc] ?? 90;
  return 80;
}

export function practiceOf(a: AssetRecord): Practice {
  const cc = countryCodeOf(a);
  const irr = irrigationOf(a, cc);
  const crop = a.crop ?? "rice";
  const m = a.meta ?? {};
  const baselineRegime: SfwKey = (str(m.mrv_regime) as SfwKey | null) ?? (crop !== "rice" ? "upland" : irr.irrigated ? "continuously_flooded" : "regular_rainfed");
  const awd = crop === "rice" && irr.irrigated && m.mrv_awd === true;
  const nRate = numOr(m.mrv_nKgHa, NaN);
  return {
    eligible: crop === "rice" && irr.irrigated && baselineRegime !== "upland" && baselineRegime !== "deep_water" && baselineRegime !== "regular_rainfed" && baselineRegime !== "drought_prone",
    irrigated: irr.irrigated,
    irrigationLabel: irr.label,
    baselineRegime,
    regime: awd ? "multiple_drainage" : baselineRegime,
    preseason: (str(m.mrv_preseason) as SfpKey | null) ?? "non_flooded_lt180",
    organic: (str(m.mrv_organic) as OrganicKey | null) ?? "none",
    organicT: numOr(m.mrv_organicT, 0),
    nKgHa: Number.isFinite(nRate) ? nRate : defaultNRate(crop, cc),
    nDefault: !Number.isFinite(nRate),
    awd,
    awdStatus: awd ? ((str(m.mrv_status) as AwdStatus | null) ?? "self_reported") : null,
    awdSince: awd ? str(m.mrv_since) : null,
    note: str(m.mrv_note),
    seasonsPerYear: numOr(m.mrv_seasons, crop === "rice" ? (irr.irrigated ? IPCC.croppingIntensity.irrigated[cc] ?? 2 : IPCC.croppingIntensity.rainfed) : 1),
    overridden: ["mrv_regime", "mrv_preseason", "mrv_organic", "mrv_nKgHa", "mrv_seasons"].some((k) => m[k] != null),
  };
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const gs = globalThis as unknown as { __agriMrvSeeded?: Set<string> };
const seeded = (gs.__agriMrvSeeded ??= new Set());

/** Seed ~20 % AWD adoption among eligible rice assets (once per workspace per process). */
export function ensureMrvSeed(ws: string, share = 0.2) {
  if (seeded.has(ws)) return;
  seeded.add(ws);
  const s = getStore();
  const now = Date.now();
  for (const a of s.assets) {
    if (a.workspaceId !== ws || a.status !== "active" || a.crop !== "rice") continue;
    if (a.meta.mrv_awd != null) continue;
    const p = practiceOf(a);
    if (!p.eligible) continue;
    const h = hash01(`${a.id}:awd`);
    if (h >= share) continue;
    const st = hash01(`${a.id}:st`);
    a.meta.mrv_awd = true;
    a.meta.mrv_status = st < 0.55 ? "self_reported" : st < 0.85 ? "field_verified" : "remote_sensed";
    a.meta.mrv_since = new Date(now - Math.round(60 + hash01(`${a.id}:d`) * 300) * 86_400_000).toISOString().slice(0, 10);
    a.meta.mrv_seeded = true;
  }
}

// ─── Programme ────────────────────────────────────────────────────────────

export interface ProgrammeOptions {
  priceUsd: number;
  targetAdoptionPct: number;
  efMode: "global" | "regional";
  deductionPct: number;
  awdWaterSavingPct: number;
}

export interface ProgrammeRow {
  id: string;
  name: string;
  externalRef: string | null;
  type: string;
  crop: string;
  district: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  areaHa: number;
  farmers: number;
  season: string;
  seasonDays: number;
  practice: Practice;
  efc: number;
  baseline: Emissions;
  actual: Emissions;
  awdPotential: Emissions | null;
  avoidedTCo2e: number;
  potentialAvoidedTCo2e: number;
  productionT: number;
  intensity: number | null;
  water: ReturnType<typeof waterFootprint> | null;
  awdWaterSavedM3: number;
  potentialWaterSavedM3: number;
}

/** Farmers represented by an asset (insured unit = village cluster; loan/farm = one household; community = households). */
export function farmersOf(a: Pick<AssetRecord, "type" | "meta">): number {
  const fc = Number(a.meta?.farmersCovered);
  if (Number.isFinite(fc) && fc > 0) return fc;
  const hh = Number(a.meta?.households);
  if (a.type === "community" && Number.isFinite(hh) && hh > 0) return hh;
  return 1;
}

function efcFor(cc: string, mode: ProgrammeOptions["efMode"]): number {
  if (mode === "regional") {
    const r = IPCC.ch4.regionOf[cc];
    const v = r ? IPCC.ch4.efRegional[r] : undefined;
    if (typeof v === "number") return v;
  }
  return IPCC.ch4.efBaseline.value;
}

function rowFor(a: AssetRecord, y: YieldAssetRow | undefined, o: ProgrammeOptions): ProgrammeRow {
  const p = practiceOf(a);
  const cc = countryCodeOf(a);
  const efc = efcFor(cc, o.efMode);
  const days = y?.forecast.season.days ?? 120;
  const area = a.areaHa ?? 0;
  const base = { crop: a.crop ?? "rice", areaHa: area, days, efc, preseason: p.preseason, organic: p.organic, organicT: p.organicT, nKgHa: p.nKgHa };
  const baseline = seasonEmissions({ ...base, regime: p.baselineRegime });
  const actual = p.awd ? seasonEmissions({ ...base, regime: "multiple_drainage" }) : baseline;
  const awdPotential = p.eligible ? seasonEmissions({ ...base, regime: "multiple_drainage" }) : null;
  const prod = y ? y.forecast.yieldTHa.p50 * area : 0;
  const wb = y?.forecast.climWater ?? y?.forecast.water ?? null;
  const water = wb && y ? waterFootprint({ etaMm: wb.etaMm, rainMm: wb.rainMm, irrigationMm: p.irrigated ? wb.irrigationMm : 0, percolationMm: wb.percolationMm }, area, y.forecast.yieldTHa.p50) : null;
  const saving = water && p.eligible ? awdWaterSaving(water.withdrawalM3, o.awdWaterSavingPct).m3 : 0;
  const s = getStore();
  const d = a.districtId ? s.districts.find((x) => x.id === a.districtId) : null;
  return {
    id: a.id,
    name: a.name,
    externalRef: a.externalRef,
    type: a.type,
    crop: a.crop ?? "rice",
    district: d?.name ?? null,
    country: a.country,
    countryCode: cc,
    lat: a.lat,
    lon: a.lon,
    areaHa: area,
    farmers: farmersOf(a),
    season: y?.forecast.season.name ?? "—",
    seasonDays: days,
    practice: p,
    efc,
    baseline,
    actual,
    awdPotential,
    avoidedTCo2e: baseline.tCo2e - actual.tCo2e,
    potentialAvoidedTCo2e: awdPotential ? baseline.tCo2e - awdPotential.tCo2e : 0,
    productionT: prod,
    intensity: prod > 0 ? actual.tCo2e / prod : null,
    water,
    awdWaterSavedM3: p.awd ? saving : 0,
    potentialWaterSavedM3: saving,
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export async function carbonProgramme(ws: string, opts: Partial<ProgrammeOptions> = {}) {
  const o: ProgrammeOptions = {
    priceUsd: opts.priceUsd ?? IPCC.creditPrice.default,
    targetAdoptionPct: opts.targetAdoptionPct ?? 50,
    efMode: opts.efMode ?? "global",
    deductionPct: opts.deductionPct ?? IPCC.conservativenessPct,
    awdWaterSavingPct: opts.awdWaterSavingPct ?? IPCC.awd.waterSavingPct.central,
  };
  ensureMrvSeed(ws);
  const book = await yieldBook(ws);
  const byId = new Map(book.assets.map((r) => [r.id, r]));
  const s = getStore();
  const assets = s.assets.filter((a) => a.workspaceId === ws && a.status === "active" && a.crop && (a.areaHa ?? 0) > 0 && ["insured_plot", "loan", "farm", "field"].includes(a.type));
  const rows = assets.map((a) => rowFor(a, byId.get(a.id), o));
  const rice = rows.filter((r) => r.crop === "rice");
  const eligible = rice.filter((r) => r.practice.eligible);
  const adopted = eligible.filter((r) => r.practice.awd);
  const sumOf = (rs: ProgrammeRow[], f: (r: ProgrammeRow) => number) => rs.reduce((a, r) => a + f(r), 0);
  const annual = (r: ProgrammeRow, v: number) => v * r.practice.seasonsPerYear;

  const achievedSeason = sumOf(rice, (r) => r.avoidedTCo2e);
  const achievedAnnual = sumOf(rice, (r) => annual(r, r.avoidedTCo2e));
  const eligArea = sumOf(eligible, (r) => r.areaHa);
  const adoptedArea = sumOf(adopted, (r) => r.areaHa);
  // scenario: adoption reaches target % of eligible AREA (already-adopted first, then remaining by potential)
  const target = (o.targetAdoptionPct / 100) * eligArea;
  const remaining = eligible.filter((r) => !r.practice.awd).sort((a, b) => b.potentialAvoidedTCo2e / Math.max(1e-9, b.areaHa) - a.potentialAvoidedTCo2e / Math.max(1e-9, a.areaHa));
  let scenArea = adoptedArea;
  let scenSeason = achievedSeason;
  let scenAnnual = achievedAnnual;
  let scenWater = sumOf(adopted, (r) => r.awdWaterSavedM3);
  let scenFarmers = sumOf(adopted, (r) => r.farmers);
  for (const r of remaining) {
    if (scenArea >= target - 1e-9) break;
    const frac = Math.min(1, (target - scenArea) / Math.max(1e-9, r.areaHa));
    scenArea += r.areaHa * frac;
    scenSeason += r.potentialAvoidedTCo2e * frac;
    scenAnnual += annual(r, r.potentialAvoidedTCo2e) * frac;
    scenWater += r.potentialWaterSavedM3 * frac;
    scenFarmers += r.farmers * frac;
  }
  // adoption curve 0 → 100 % of eligible area (linear in area at the average potential per ha)
  const potPerHaAnnual = eligArea > 0 ? sumOf(eligible, (r) => annual(r, r.potentialAvoidedTCo2e)) / eligArea : 0;
  const curve = Array.from({ length: 11 }, (_, i) => {
    const pct = i * 10;
    const t = potPerHaAnnual * eligArea * (pct / 100);
    return { adoptionPct: pct, avoidedTCo2eYr: r1(t), revenueUsdYr: Math.round(creditRevenue(t, o.priceUsd, o.deductionPct).usd) };
  });
  const efRange = { low: IPCC.ch4.efBaseline.low / IPCC.ch4.efBaseline.value, high: IPCC.ch4.efBaseline.high / IPCC.ch4.efBaseline.value };
  const baselineT = sumOf(rows, (r) => r.baseline.tCo2e);
  const actualT = sumOf(rows, (r) => r.actual.tCo2e);
  const prodT = sumOf(rows, (r) => r.productionT);
  const riceProd = sumOf(rice, (r) => r.productionT);
  const riceActual = sumOf(rice, (r) => r.actual.tCo2e);
  const statusCounts = { self_reported: 0, field_verified: 0, remote_sensed: 0 } as Record<AwdStatus, number>;
  for (const r of adopted) statusCounts[r.practice.awdStatus ?? "self_reported"]++;
  const waterWithdrawal = sumOf(rows, (r) => r.water?.withdrawalM3 ?? 0);

  return {
    generatedAt: new Date().toISOString(),
    options: o,
    rows: rows.map((r) => ({ ...r, avoidedTCo2e: r2(r.avoidedTCo2e), potentialAvoidedTCo2e: r2(r.potentialAvoidedTCo2e), productionT: r1(r.productionT), intensity: r.intensity == null ? null : r2(r.intensity) })),
    totals: {
      assets: rows.length,
      riceAssets: rice.length,
      riceAreaHa: r1(sumOf(rice, (r) => r.areaHa)),
      eligibleAssets: eligible.length,
      eligibleAreaHa: r1(eligArea),
      adoptedAssets: adopted.length,
      adoptedAreaHa: r1(adoptedArea),
      adoptionPctArea: eligArea > 0 ? r1((adoptedArea / eligArea) * 100) : 0,
      adoptedFarmers: sumOf(adopted, (r) => r.farmers),
      eligibleFarmers: sumOf(eligible, (r) => r.farmers),
      verification: statusCounts,
      emissionsSeasonTCo2e: r1(actualT),
      baselineSeasonTCo2e: r1(baselineT),
      emissionsAnnualTCo2e: r1(sumOf(rows, (r) => annual(r, r.actual.tCo2e))),
      bySource: { ch4: r1(sumOf(rows, (r) => r.actual.ch4TCo2e)), n2o: r1(sumOf(rows, (r) => r.actual.n2oTCo2e)), ureaCo2: r1(sumOf(rows, (r) => r.actual.co2TCo2e)) },
      productionT: Math.round(prodT),
      intensityTCo2ePerT: prodT > 0 ? r2(actualT / prodT) : null,
      riceIntensityTCo2ePerT: riceProd > 0 ? r2(riceActual / riceProd) : null,
      riceCh4KgHaDay: r2(IPCC.ch4.efBaseline.value),
      waterWithdrawalM3: Math.round(waterWithdrawal),
    },
    achieved: {
      avoidedSeasonTCo2e: r1(achievedSeason),
      avoidedAnnualTCo2e: r1(achievedAnnual),
      avoidedAnnualRange: { low: r1(achievedAnnual * efRange.low), high: r1(achievedAnnual * efRange.high) },
      revenue: (() => {
        const c = creditRevenue(achievedAnnual, o.priceUsd, o.deductionPct);
        return { credits: r1(c.credits), usd: Math.round(c.usd) };
      })(),
      waterSavedM3: Math.round(sumOf(adopted, (r) => r.awdWaterSavedM3)),
    },
    scenario: {
      targetAdoptionPct: o.targetAdoptionPct,
      areaHa: r1(scenArea),
      farmers: Math.round(scenFarmers),
      avoidedSeasonTCo2e: r1(scenSeason),
      avoidedAnnualTCo2e: r1(scenAnnual),
      avoidedAnnualRange: { low: r1(scenAnnual * efRange.low), high: r1(scenAnnual * efRange.high) },
      revenue: (() => {
        const c = creditRevenue(scenAnnual, o.priceUsd, o.deductionPct);
        return { credits: r1(c.credits), usd: Math.round(c.usd), perFarmerUsd: scenFarmers > 0 ? r2(c.usd / scenFarmers) : 0 };
      })(),
      waterSavedM3: Math.round(scenWater),
    },
    curve,
    fullPotential: { avoidedAnnualTCo2e: r1(potPerHaAnnual * eligArea), sharePctOfRiceEmissions: riceActual > 0 ? r1((sumOf(eligible, (r) => r.potentialAvoidedTCo2e) / sumOf(rice, (r) => r.baseline.tCo2e)) * 100) : 0 },
    label: "Indicative, not a Verra VM0051 verified estimate",
  };
}

export const CARBON_METHODOLOGY = {
  ch4: {
    equation: "CH4 (kg) = EF_c × SF_w × SF_p × SF_o × t × A   (IPCC 2019 Refinement Vol.4 Ch.5 Eq. 5.1-5.2)",
    efBaseline: IPCC.ch4.efBaseline,
    efRegional: IPCC.ch4.efRegional,
    sfw: IPCC.ch4.sfw,
    sfp: IPCC.ch4.sfp,
    cfoa: IPCC.ch4.cfoa,
    sfo: "SF_o = (1 + Σ ROA_i × CFOA_i)^0.59 (Eq. 5.3)",
    period: "t = cultivation period of the current season from the crop calendar (days)",
  },
  n2o: { ...IPCC.n2o, equation: "N2O (kg) = F_SN × [EF1 + Frac_GASF × EF4 + Frac_LEACH × EF5] × 44/28" },
  urea: IPCC.urea,
  gwp: IPCC.gwp100,
  nRates: IPCC.nRateKgHa,
  croppingIntensity: IPCC.croppingIntensity,
  awd: IPCC.awd,
  credits: { ...IPCC.creditPrice, conservativenessPct: IPCC.conservativenessPct, label: "Indicative, not a Verra VM0051 verified estimate", verra: IPCC.sources.verra },
  sources: IPCC.sources,
  assumptions: [
    "Baseline water regime: irrigated rice = continuously flooded (SF_w 1.00); rain-fed rice = regular rain-fed (0.54). Override per asset where drainage practice is known.",
    "AWD = 'multiple drainage' (SF_w 0.55). Only irrigated rice with water control is eligible.",
    "Pre-season: non-flooded < 180 days (SF_p 1.00); no organic amendment (SF_o 1.00) unless recorded.",
    "Synthetic N at typical national rates, all as urea (overridable per asset); indirect N2O included.",
    "Annual figures multiply season results by the rice seasons per year (irrigated: 2-2.5; rain-fed: 1).",
    "Indicative credit revenue applies a conservativeness deduction to avoided emissions; uncertainty band scales with the IPCC EF_c range 0.80-1.76.",
  ],
};

// ─── ESG summary ──────────────────────────────────────────────────────────

/** Workspace ESG summary: physical risk (portfolio), emissions intensity, water, smallholder reach. */
export async function esgSummary(ws: string) {
  const { effectiveScore, portfolioVaR, riskThreshold } = await import("./portfolio");
  const s = getStore();
  const org = s.orgs.find((o) => o.id === ws);
  const assets = s.assets.filter((a) => a.workspaceId === ws && a.status === "active");
  const thr = riskThreshold(ws);
  const scored = assets.map((a) => ({ a, sc: effectiveScore(a) }));
  const varr = portfolioVaR(scored.map((x) => ({ valueUsd: x.a.valueUsd, scores: x.sc })));
  const atRisk = scored.filter((x) => x.sc.composite >= thr);
  const prog = await carbonProgramme(ws);
  const book = await yieldBook(ws);
  // smallholder reach
  const farmers = assets.reduce((acc, a) => acc + farmersOf(a), 0);
  const womenRows = assets.filter((a) => Number.isFinite(Number(a.meta?.femaleHeadedPct)) && a.meta?.femaleHeadedPct != null);
  const womenWeight = womenRows.reduce((acc, a) => acc + farmersOf(a), 0);
  const womenPct = womenWeight > 0 ? womenRows.reduce((acc, a) => acc + farmersOf(a) * Number(a.meta.femaleHeadedPct), 0) / womenWeight : null;
  const areaHa = assets.reduce((acc, a) => acc + (a.areaHa ?? 0), 0);
  const byHazard = varr.byHazard;
  const water = prog.rows.reduce(
    (acc, r) => {
      if (!r.water) return acc;
      acc.withdrawal += r.water.withdrawalM3;
      acc.green += r.water.greenM3;
      acc.blue += r.water.blueM3;
      return acc;
    },
    { withdrawal: 0, green: 0, blue: 0 }
  );
  const prodT = book.totals.productionT.p50;
  return {
    workspace: { id: ws, name: org?.name ?? ws, industry: org?.industry ?? null, country: org?.country ?? null },
    generatedAt: new Date().toISOString(),
    physicalRisk: {
      assets: assets.length,
      exposureUsd: Math.round(varr.exposure),
      valueAtRiskUsd: Math.round(varr.total),
      varRatioPct: r1(varr.ratio * 100),
      atRiskAssets: atRisk.length,
      atRiskExposureUsd: Math.round(atRisk.reduce((acc, x) => acc + x.a.valueUsd, 0)),
      threshold: thr,
      byHazardUsd: { flood: Math.round(byHazard.flood), salinity: Math.round(byHazard.salinity), drought: Math.round(byHazard.drought), heat: Math.round(byHazard.heat) },
      meanComposite: scored.length ? r1(scored.reduce((acc, x) => acc + x.sc.composite, 0) / scored.length) : 0,
    },
    production: { cropAssets: book.totals.assets, productionT: book.totals.productionT, normalProductionT: book.totals.normalProductionT, vsNormalPct: book.totals.vsNormalPct, valueUsd: book.totals.valueUsd },
    emissions: {
      seasonTCo2e: prog.totals.emissionsSeasonTCo2e,
      annualTCo2e: prog.totals.emissionsAnnualTCo2e,
      bySource: prog.totals.bySource,
      intensityTCo2ePerT: prog.totals.intensityTCo2ePerT,
      riceIntensityTCo2ePerT: prog.totals.riceIntensityTCo2ePerT,
      avoidedAnnualTCo2e: prog.achieved.avoidedAnnualTCo2e,
      awdAdoptionPctArea: prog.totals.adoptionPctArea,
    },
    water: {
      withdrawalM3: Math.round(water.withdrawal),
      greenM3: Math.round(water.green),
      blueM3: Math.round(water.blue),
      footprintM3PerT: prodT > 0 ? Math.round((water.green + water.blue) / prodT) : null,
      awdSavedM3: prog.achieved.waterSavedM3,
    },
    reach: {
      farmers,
      areaHa: r1(areaHa),
      womenHeadedPct: womenPct == null ? null : r1(womenPct),
      womenHeadedBasis: womenPct == null ? "Not recorded in this workspace's asset data — add a femaleHeadedPct column on import to report it." : `Household-weighted over ${womenRows.length} assets that record it`,
      awdFarmers: prog.totals.adoptedFarmers,
    },
    frameworks: ["ISSB IFRS S2 (physical risk, Scope 3 agriculture emissions)", "GHG Protocol Land Sector & Removals guidance (draft)", "SBTi FLAG", "TNFD (water)"],
    notes: ["Emissions are IPCC 2019 Tier 1 estimates on the portfolio's crop area (financed / insured / member production), not audited inventories.", "Physical-risk VaR = exposure × hazard likelihood × mean damage ratio (Portfolio module)."],
  };
}
