/**
 * Simulation Lab — drought & heat season scenario on the workspace portfolio.
 *
 *   inputs   seasonal rainfall deficit d (% below normal) · growing-season
 *            temperature anomaly ΔT (°C) · irrigation assumption
 *   yield    FAO-33 yield response  1 − Ya/Ym = Ky·(1 − ETa/ETm)  plus a direct
 *            heat penalty (Zhao et al. 2017), see sim-impact.ts `yieldImpact`
 *   revenue  area × normal revenue/ha:
 *              rice   = national paddy yield × farm-gate price (agri-reference.json)
 *              other  = cost of cultivation × 1.3 (assumed 30 % gross margin)
 *            loans without an area: area ≈ loan balance ÷ cost of cultivation/ha
 *   finance  insured plots: payout = SI × yield loss − deductible;
 *            loans: PD shock via credit-risk.ts (drought hazard realised, k scaled
 *            by yield loss ÷ 0.35 typical severe-year damage);
 *            communities: farm households × share losing > 30 % of the harvest;
 *            facilities: sourcing shortfall = mean yield loss of crops nearby.
 */
import { countryStats, drySpells, productionCostUsdHa } from "../data/real";
import { getStore } from "../data/store";
import { workspaceAssets } from "./portfolio";
import { rememberSim, haversine } from "./sim-flood";
import { HEAT_SENS, insuredLoss, KY, loanShock, RAIN_DEPENDENCY, round, yieldImpact, type CreditFns } from "./sim-impact";

export interface DroughtSimInput {
  deficitPct: number;
  tempAnomalyC: number;
  /** "asset" = use each farm's irrigation field where known */
  irrigation: "asset" | "rainfed" | "irrigated";
  season?: string;
  tag?: string | null;
  label?: string;
}

export interface DroughtAssetImpact {
  id: string;
  name: string;
  type: string;
  crop: string;
  country: string;
  lat: number;
  lon: number;
  areaHa: number;
  valueUsd: number;
  rainDependency: number;
  yieldLossPct: number;
  waterLossPct: number;
  heatLossPct: number;
  revenueUsd: number;
  revenueLossUsd: number;
  insuredLossUsd: number | null;
  elUpliftUsd: number | null;
  pdBase: number | null;
  pdStressed: number | null;
  households: number | null;
}

export interface DroughtSimResult {
  id: string;
  kind: "drought";
  createdAt: string;
  input: DroughtSimInput;
  assets: DroughtAssetImpact[];
  byCrop: { crop: string; ky: number; kySource: string; heatPerDegPct: number; assets: number; areaHa: number; yieldLossPct: number; revenueLossUsd: number }[];
  curves: { deficitPct: number; [crop: string]: number }[];
  totals: { assets: number; areaHa: number; revenueUsd: number; revenueLossUsd: number; insuredLossUsd: number; elUpliftUsd: number; householdsSevere: number; meanYieldLossPct: number; assetsSevere: number };
  sources: { label: string; href?: string }[];
  caveats: string[];
}

async function creditFns(): Promise<CreditFns | null> {
  try {
    const m = await import("./credit-risk");
    return { baselinePd: m.baselinePd, climatePd: m.climatePd, sensitivity: m.sensitivity as CreditFns["sensitivity"], lgdFor: m.lgdFor };
  } catch {
    return null;
  }
}

const CC: Record<string, string> = { Bangladesh: "BD", India: "IN", Vietnam: "VN", Philippines: "PH", Indonesia: "ID" };
const cc = (country: string) => (country.length === 2 ? country : CC[country] ?? "BD");

export function revenuePerHa(country: string, crop: string): number {
  const c = cc(country);
  if (crop === "rice") {
    const s = countryStats(c);
    return s.paddyYieldTHa * s.paddyFarmgateUsdT;
  }
  return productionCostUsdHa(c, crop) * 1.3;
}

function dependency(input: DroughtSimInput, meta: Record<string, unknown>): number {
  if (input.irrigation === "rainfed") return RAIN_DEPENDENCY.rainfed!;
  if (input.irrigation === "irrigated") return RAIN_DEPENDENCY.irrigated!;
  const irr = String(meta.irrigation ?? "rainfed");
  return RAIN_DEPENDENCY[irr] ?? RAIN_DEPENDENCY.rainfed!;
}

export async function runDroughtSim(workspaceId: string, input: DroughtSimInput): Promise<DroughtSimResult> {
  const d = Math.max(0, Math.min(90, input.deficitPct)) / 100;
  const dT = Math.max(-2, Math.min(6, input.tempAnomalyC));
  const all = workspaceAssets(workspaceId).filter((a) => !input.tag || a.tags.includes(input.tag));
  const credit = all.some((a) => a.type === "loan") ? await creditFns() : null;

  // crop-bearing assets first (facilities/communities derive from their surroundings)
  const cropAssets = all.filter((a) => ["farm", "field", "insured_plot", "loan"].includes(a.type));
  const results: DroughtAssetImpact[] = [];
  for (const a of cropAssets) {
    const crop = a.crop ?? "rice";
    const w = dependency(input, a.meta);
    const yi = yieldImpact(crop, d, dT, w);
    const country = cc(a.country);
    const cost = productionCostUsdHa(country, crop);
    const area = a.areaHa && a.areaHa > 0 ? a.areaHa : Math.max(0.1, a.valueUsd / Math.max(100, cost));
    const rev = area * revenuePerHa(country, crop);
    const shock = a.type === "loan" && credit ? loanShock(a, "drought", yi.yieldLoss, credit) : null;
    results.push({
      id: a.id,
      name: a.name,
      type: a.type,
      crop: yi.crop,
      country,
      lat: a.lat,
      lon: a.lon,
      areaHa: round(area, 2),
      valueUsd: a.valueUsd,
      rainDependency: w,
      yieldLossPct: round(yi.yieldLoss * 100, 1),
      waterLossPct: round(yi.waterLoss * 100, 1),
      heatLossPct: round(yi.heatLoss * 100, 1),
      revenueUsd: Math.round(rev),
      revenueLossUsd: Math.round(rev * yi.yieldLoss),
      insuredLossUsd: a.type === "insured_plot" ? Math.round(insuredLoss(a.valueUsd, yi.yieldLoss, Number(a.meta.deductiblePct ?? 0))) : null,
      elUpliftUsd: shock?.elUpliftUsd ?? null,
      pdBase: shock?.pdBase ?? null,
      pdStressed: shock?.pdStressed ?? null,
      households: null,
    });
  }

  // communities & facilities: district primary crops (seeded geography) under the same scenario
  const districts = getStore().districts;
  for (const a of all.filter((x) => !["farm", "field", "insured_plot", "loan"].includes(x.type))) {
    const dist = districts.find((x) => x.id === a.districtId) ?? districts.reduce((b, x) => (haversine(a.lat, a.lon, x.lat, x.lon) < haversine(a.lat, a.lon, b.lat, b.lon) ? x : b), districts[0]!);
    const crops = (dist?.primaryCrops?.length ? dist.primaryCrops : ["rice"]) as string[];
    const w = input.irrigation === "irrigated" ? RAIN_DEPENDENCY.irrigated! : RAIN_DEPENDENCY.rainfed!;
    const losses = crops.map((c) => yieldImpact(c, d, dT, w));
    const mean = losses.reduce((s, x) => s + x.yieldLoss, 0) / losses.length;
    const country = cc(a.country);
    let households: number | null = null;
    if (a.type === "community") {
      const hh = Number(a.meta.households ?? 0);
      const farmShare = countryStats(country).farmHouseholdShare;
      // households losing > 30 % of harvest: all farm households once the mean loss passes 30 %, scaled below that
      households = Math.round(hh * farmShare * Math.min(1, Math.max(0, (mean - 0.1) / 0.2)));
    }
    results.push({
      id: a.id,
      name: a.name,
      type: a.type,
      crop: crops[0]!,
      country,
      lat: a.lat,
      lon: a.lon,
      areaHa: 0,
      valueUsd: a.valueUsd,
      rainDependency: w,
      yieldLossPct: round(mean * 100, 1),
      waterLossPct: round((losses.reduce((s, x) => s + x.waterLoss, 0) / losses.length) * 100, 1),
      heatLossPct: round((losses.reduce((s, x) => s + x.heatLoss, 0) / losses.length) * 100, 1),
      revenueUsd: 0,
      // facilities: stock/throughput value exposed to the sourcing shortfall
      revenueLossUsd: a.type === "community" ? 0 : Math.round(a.valueUsd * mean),
      insuredLossUsd: null,
      elUpliftUsd: null,
      pdBase: null,
      pdStressed: null,
      households,
    });
  }

  const byCropMap = new Map<string, { n: number; area: number; lossW: number; rev: number }>();
  for (const r of results.filter((x) => x.areaHa > 0)) {
    const m = byCropMap.get(r.crop) ?? { n: 0, area: 0, lossW: 0, rev: 0 };
    m.n++;
    m.area += r.areaHa;
    m.lossW += r.yieldLossPct * r.areaHa;
    m.rev += r.revenueLossUsd;
    byCropMap.set(r.crop, m);
  }
  const byCrop = [...byCropMap.entries()]
    .map(([crop, m]) => ({ crop, ky: KY[crop]?.ky ?? 1, kySource: KY[crop]?.source ?? "assumption", heatPerDegPct: round((HEAT_SENS[crop]?.perDeg ?? -0.04) * 100, 1), assets: m.n, areaHa: Math.round(m.area), yieldLossPct: round(m.area ? m.lossW / m.area : 0, 1), revenueLossUsd: Math.round(m.rev) }))
    .sort((a, b) => b.revenueLossUsd - a.revenueLossUsd);

  const crops = byCrop.length ? byCrop.map((c) => c.crop) : ["rice"];
  const curves = Array.from({ length: 17 }, (_, k) => {
    const def = k * 5;
    const row: { deficitPct: number; [crop: string]: number } = { deficitPct: def };
    for (const c of crops) row[c] = round(yieldImpact(c, def / 100, dT, input.irrigation === "irrigated" ? RAIN_DEPENDENCY.irrigated! : RAIN_DEPENDENCY.rainfed!).yieldLoss * 100, 1);
    return row;
  });

  const cropRows = results.filter((x) => x.areaHa > 0);
  const area = cropRows.reduce((s, r) => s + r.areaHa, 0);
  const totals = {
    assets: results.length,
    areaHa: Math.round(area),
    revenueUsd: cropRows.reduce((s, r) => s + r.revenueUsd, 0),
    revenueLossUsd: results.reduce((s, r) => s + r.revenueLossUsd, 0),
    insuredLossUsd: results.reduce((s, r) => s + (r.insuredLossUsd ?? 0), 0),
    elUpliftUsd: results.reduce((s, r) => s + (r.elUpliftUsd ?? 0), 0),
    householdsSevere: results.reduce((s, r) => s + (r.households ?? 0), 0),
    meanYieldLossPct: round(area ? cropRows.reduce((s, r) => s + r.yieldLossPct * r.areaHa, 0) / area : results.length ? results.reduce((s, r) => s + r.yieldLossPct, 0) / results.length : 0, 1),
    assetsSevere: results.filter((r) => r.yieldLossPct >= 30).length,
  };

  const res: DroughtSimResult = {
    id: `sim-dr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind: "drought",
    createdAt: new Date().toISOString(),
    input,
    assets: results.sort((a, b) => b.revenueLossUsd - a.revenueLossUsd),
    byCrop,
    curves,
    totals,
    sources: [
      { label: "FAO Irrigation & Drainage Paper 33 (Doorenbos & Kassam 1979) — yield response factor Ky", href: "https://www.fao.org/4/i2800e/i2800e.pdf" },
      { label: "Zhao et al. 2017, PNAS 114:9326 — temperature impacts on global yields", href: "https://doi.org/10.1073/pnas.1701762114" },
      { label: "Farm-gate prices, cost of cultivation, household statistics: server/data/real/agri-reference.json (BBS, GSO, PSA, MoA&FW, BPS)" },
    ],
    caveats: DROUGHT_CAVEATS,
  };
  rememberSim(res.id, res);
  return res;
}

export const DROUGHT_CAVEATS = [
  "Seasonal (whole-season) Ky: the same deficit at flowering hurts far more than during vegetative growth. Treat results as a season-average screening estimate.",
  "Irrigation is assumed to buffer the deficit in proportion to the crop's reliance on rain; groundwater or canal failures in a severe drought are not modelled.",
  "Heat penalty uses global mean sensitivities per °C (Zhao et al. 2017); local varieties and timing of heat waves matter.",
  "Revenue uses national farm-gate prices without the price rise that a widespread drought usually causes — farm revenue loss may be partly offset.",
];

/** Presets: the worst real 30-day dry spell on record in the workspace's districts + illustrative seasons. */
export function droughtPresets(workspaceId: string) {
  const ds = new Set(workspaceAssets(workspaceId).map((a) => a.districtId).filter(Boolean) as string[]);
  let worst: { district: string; start: string; end: string; ratio: number } | null = null;
  for (const id of ds)
    for (const s of drySpells(id))
      if (!worst || s.minRatioToNormal < worst.ratio) worst = { district: getStore().districts.find((d) => d.id === id)?.name ?? id, start: s.start, end: s.end, ratio: s.minRatioToNormal };
  const out: { id: string; label: string; deficitPct: number; tempAnomalyC: number; basis: string }[] = [];
  if (worst)
    out.push({ id: "record", label: `Worst dry spell on record (${worst.district}, ${worst.start.slice(0, 7)})`, deficitPct: Math.round((1 - worst.ratio) * 100), tempAnomalyC: 1, basis: `Real ERA5 30-day rainfall fell to ${Math.round(worst.ratio * 100)}% of normal (${worst.start} → ${worst.end}). Applied here as a whole-season deficit — a stress test, not a forecast.` });
  out.push({ id: "elnino", label: "Moderate El Niño-type season (−25 %, +0.8 °C)", deficitPct: 25, tempAnomalyC: 0.8, basis: "Illustrative: typical monsoon deficit and warming in a moderate El Niño year for South & Southeast Asia." });
  out.push({ id: "severe", label: "Severe drought (−45 %, +1.5 °C)", deficitPct: 45, tempAnomalyC: 1.5, basis: "Illustrative severe season, comparable to the worst monsoon failures of recent decades." });
  out.push({ id: "heat", label: "Heat-wave season (normal rain, +2.5 °C)", deficitPct: 0, tempAnomalyC: 2.5, basis: "Illustrative: rainfall near normal but a very hot season (heat stress during flowering)." });
  return out;
}
