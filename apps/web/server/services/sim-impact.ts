/**
 * Simulation Lab — impact functions shared by the flood, cyclone and drought
 * simulators. Pure maths, no I/O (unit-tested in tests/simulate-impact.test.ts).
 *
 * 1. Flood depth–damage — JRC Global Flood Depth-Damage Functions
 *    (Huizinga, de Moel & Szewczyk 2017, JRC Technical Report EUR 28552 EN,
 *    doi:10.2760/16510), continental curves for ASIA. Damage fraction of the
 *    maximum damage (here: the asset's exposure value) vs water depth, linearly
 *    interpolated between the tabulated depths 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6 m.
 *
 * 2. Wind fragility — Emanuel (2011, Weather Clim. Soc. 3:261) sigmoid used by
 *    CLIMADA (Eberenz et al. 2021, NHESS 21:393):
 *        v = max(0, V − V_thresh) / (V_half − V_thresh);  damage = v³ / (1 + v³)
 *    V = 1-min sustained wind (m/s). Buildings: V_thresh 25.7 m/s, V_half from
 *    the CLIMADA default 74.7 m/s (engineered) down to 55 m/s for non-engineered
 *    rural housing. Crops lodge/defoliate at much lower wind speeds — the crop
 *    thresholds below are screening assumptions (rice/wheat lodging typically
 *    begins at ~15 m/s; bananas are the most wind-sensitive, tree crops the least).
 *
 * 3. Drought — FAO Irrigation & Drainage Paper 33 (Doorenbos & Kassam 1979):
 *        1 − Ya/Ym = Ky · (1 − ETa/ETm)
 *    with seasonal Ky from FAO-33 Table 1 where tabulated (maize 1.25, wheat 1.05,
 *    sugarcane 1.2, potato 1.1, onion 1.1, cotton 0.85, sorghum 0.9, banana 1.2,
 *    tobacco 0.9); rice 1.1 (CROPWAT default), vegetables 1.05, jute 1.0, barley 1.0
 *    are documented assumptions (FAO-66 / crop proxies), aligned with
 *    server/data/real/crop-coefficients.json (coconut 0.5, mango 0.8).
 *    Heat: direct yield change per +1 °C of growing-season warming from
 *    Zhao et al. (2017, PNAS 114:9326): wheat −6.0 %, rice −3.2 %, maize −7.4 %
 *    (other crops mapped to the nearest analogue, documented below).
 */

// ─── Flood: JRC depth–damage (Asia) ───────────────────────────────────────

export const JRC_DEPTHS = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6] as const;

export type DamageCurve = "residential" | "commercial" | "industrial" | "agriculture";

export const JRC_ASIA: Record<DamageCurve, number[]> = {
  residential: [0, 0.327, 0.494, 0.617, 0.721, 0.87, 0.931, 0.984, 1],
  commercial: [0, 0.377, 0.538, 0.659, 0.763, 0.883, 0.942, 0.981, 1],
  industrial: [0, 0.283, 0.482, 0.629, 0.717, 0.857, 0.91, 0.955, 1],
  agriculture: [0, 0.135, 0.37, 0.524, 0.558, 0.66, 0.834, 0.988, 1],
};

export const DAMAGE_SOURCE =
  "JRC Global Flood Depth-Damage Functions, Asia continental curves (Huizinga, de Moel & Szewczyk 2017, EUR 28552 EN, doi:10.2760/16510)";

/** Damage fraction (0-1) at water depth `d` metres, linear between tabulated points. */
export function depthDamage(curve: DamageCurve, d: number): number {
  if (!(d > 0)) return 0;
  const ys = JRC_ASIA[curve];
  const xs = JRC_DEPTHS;
  if (d >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
  for (let i = 1; i < xs.length; i++) {
    if (d <= xs[i]!) {
      const t = (d - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
      return ys[i - 1]! + t * (ys[i]! - ys[i - 1]!);
    }
  }
  return 1;
}

export type AssetKind = "farm" | "field" | "warehouse" | "processing_plant" | "port" | "retail_outlet" | "insured_plot" | "loan" | "community" | "office";

export function curveForAsset(type: AssetKind | string): DamageCurve {
  switch (type) {
    case "community":
      return "residential";
    case "warehouse":
    case "processing_plant":
    case "port":
      return "industrial";
    case "retail_outlet":
    case "office":
      return "commercial";
    default:
      return "agriculture";
  }
}

/** Footprint radius (m) used to average hazard over an asset. */
export function footprintRadiusM(type: string, areaHa: number | null): number {
  if (type === "community") return 1000;
  if (type === "warehouse" || type === "processing_plant" || type === "port" || type === "retail_outlet" || type === "office") return 120;
  const ha = areaHa && areaHa > 0 ? areaHa : 1;
  return Math.max(60, Math.min(1500, Math.sqrt((ha * 10_000) / Math.PI)));
}

// ─── Wind: Emanuel (2011) sigmoid fragility ───────────────────────────────

export interface WindFragility {
  vThresh: number;
  vHalf: number;
  label: string;
}

export const WIND_FRAGILITY: Record<string, WindFragility> = {
  community: { vThresh: 25.7, vHalf: 55, label: "Non-engineered rural housing" },
  warehouse: { vThresh: 25.7, vHalf: 74.7, label: "Light industrial (CLIMADA default V½)" },
  processing_plant: { vThresh: 25.7, vHalf: 74.7, label: "Light industrial (CLIMADA default V½)" },
  port: { vThresh: 25.7, vHalf: 80, label: "Port infrastructure" },
  retail_outlet: { vThresh: 25.7, vHalf: 70, label: "Commercial" },
  office: { vThresh: 25.7, vHalf: 80, label: "Engineered commercial" },
  // crops (standing crop / plantation)
  rice: { vThresh: 15, vHalf: 36, label: "Rice — lodging & grain shattering" },
  wheat: { vThresh: 15, vHalf: 36, label: "Wheat — lodging" },
  barley: { vThresh: 15, vHalf: 36, label: "Barley — lodging" },
  maize: { vThresh: 14, vHalf: 32, label: "Maize — stalk lodging" },
  sorghum: { vThresh: 14, vHalf: 34, label: "Sorghum — lodging" },
  sugarcane: { vThresh: 16, vHalf: 40, label: "Sugarcane — lodging" },
  jute: { vThresh: 15, vHalf: 38, label: "Jute — lodging" },
  cotton: { vThresh: 14, vHalf: 34, label: "Cotton — boll loss" },
  tobacco: { vThresh: 12, vHalf: 30, label: "Tobacco — leaf tearing" },
  vegetables: { vThresh: 12, vHalf: 30, label: "Vegetables — defoliation" },
  onion: { vThresh: 14, vHalf: 36, label: "Onion" },
  potato: { vThresh: 15, vHalf: 40, label: "Potato" },
  banana: { vThresh: 11, vHalf: 26, label: "Banana — pseudostem snapping" },
  coconut: { vThresh: 22, vHalf: 55, label: "Coconut — frond & nut loss" },
  mango: { vThresh: 20, vHalf: 50, label: "Mango — fruit drop & limb breakage" },
  crop: { vThresh: 15, vHalf: 36, label: "Generic field crop" },
};

export const WIND_SOURCE = "Emanuel (2011) sigmoid damage function as used in CLIMADA (Eberenz et al. 2021); crop thresholds are screening assumptions";

export function emanuelDamage(v: number, f: WindFragility): number {
  const x = Math.max(0, v - f.vThresh) / (f.vHalf - f.vThresh);
  const x3 = x * x * x;
  return x3 / (1 + x3);
}

export function windFragilityFor(type: string, crop: string | null): WindFragility {
  if (WIND_FRAGILITY[type] && !["farm", "field", "insured_plot", "loan"].includes(type)) return WIND_FRAGILITY[type]!;
  return (crop && WIND_FRAGILITY[crop]) || WIND_FRAGILITY.crop!;
}

/** Combine independent damage ratios: 1 − Π(1 − d). */
export const combineDamage = (...ds: number[]) => 1 - ds.reduce((p, d) => p * (1 - Math.max(0, Math.min(1, d))), 1);

// ─── Drought & heat: FAO-33 Ky + Zhao et al. 2017 ─────────────────────────

export const KY: Record<string, { ky: number; source: string }> = {
  maize: { ky: 1.25, source: "FAO-33" },
  wheat: { ky: 1.05, source: "FAO-33" },
  sugarcane: { ky: 1.2, source: "FAO-33" },
  potato: { ky: 1.1, source: "FAO-33" },
  onion: { ky: 1.1, source: "FAO-33" },
  cotton: { ky: 0.85, source: "FAO-33" },
  sorghum: { ky: 0.9, source: "FAO-33" },
  banana: { ky: 1.2, source: "FAO-33 (1.2–1.35)" },
  tobacco: { ky: 0.9, source: "FAO-33" },
  rice: { ky: 1.1, source: "assumption (FAO-66 paddy range)" },
  vegetables: { ky: 1.05, source: "assumption (FAO-33 tomato/cabbage proxy)" },
  jute: { ky: 1.0, source: "assumption" },
  barley: { ky: 1.0, source: "assumption (wheat analogue)" },
  coconut: { ky: 0.5, source: "assumption (perennial; as crop-coefficients.json)" },
  mango: { ky: 0.8, source: "assumption (perennial, deep roots)" },
};

/** Fractional yield change per +1 °C (negative = loss). Zhao et al. 2017 for wheat/rice/maize; analogues otherwise. */
export const HEAT_SENS: Record<string, { perDeg: number; source: string }> = {
  wheat: { perDeg: -0.06, source: "Zhao et al. 2017" },
  rice: { perDeg: -0.032, source: "Zhao et al. 2017" },
  maize: { perDeg: -0.074, source: "Zhao et al. 2017" },
  sorghum: { perDeg: -0.05, source: "analogue (between maize and rice)" },
  barley: { perDeg: -0.06, source: "analogue (wheat)" },
  sugarcane: { perDeg: -0.03, source: "analogue (C4 perennial grass)" },
  cotton: { perDeg: -0.04, source: "analogue" },
  potato: { perDeg: -0.06, source: "analogue (cool-season crop)" },
  onion: { perDeg: -0.05, source: "analogue (cool-season crop)" },
  vegetables: { perDeg: -0.05, source: "analogue" },
  jute: { perDeg: -0.02, source: "analogue (heat-tolerant fibre crop)" },
  tobacco: { perDeg: -0.03, source: "analogue" },
  banana: { perDeg: -0.03, source: "analogue" },
  coconut: { perDeg: -0.02, source: "analogue (perennial)" },
  mango: { perDeg: -0.02, source: "analogue (perennial)" },
};

/** Share of crop water that comes from rain (the rest is irrigation that buffers a deficit). */
export const RAIN_DEPENDENCY: Record<string, number> = { rainfed: 0.9, tubewell: 0.4, canal: 0.3, drip: 0.2, sprinkler: 0.25, flood_irrigation: 0.3, irrigated: 0.25 };

/** ET0 sensitivity to warming: ~3 % more atmospheric demand per °C (FAO-56 Penman-Monteith, humid tropics). */
export const ET_PER_DEG = 0.03;

export interface YieldImpact {
  crop: string;
  ky: number;
  /** 1 − ETa/ETm */
  etDeficit: number;
  waterLoss: number;
  heatLoss: number;
  /** total fractional yield loss 0-1 */
  yieldLoss: number;
}

/**
 * Yield loss relative to a normal season.
 *   supply  S = 1 − w·d          (w = rain dependency, d = rainfall deficit 0-1)
 *   demand  D = 1 + w·0.03·ΔT    (extra evaporative demand only unmet on the rain-fed share)
 *   ETa/ETm = min(1, S / D)
 *   water   = Ky · (1 − ETa/ETm)                                   (FAO-33)
 *   heat    = max(0, −perDeg · ΔT)                                  (Zhao et al. 2017; no gain credited for cooling)
 *   loss    = 1 − (1 − water)(1 − heat)
 */
export function yieldImpact(crop: string | null, deficit: number, tempAnomalyC: number, rainDependency = RAIN_DEPENDENCY.rainfed!): YieldImpact {
  const c = crop && KY[crop] ? crop : "rice";
  const ky = KY[c]!.ky;
  const d = Math.max(0, Math.min(1, deficit));
  const w = Math.max(0, Math.min(1, rainDependency));
  const S = 1 - w * d;
  const D = 1 + w * ET_PER_DEG * Math.max(0, tempAnomalyC);
  const ratio = Math.min(1, S / D);
  const etDeficit = 1 - ratio;
  const waterLoss = Math.min(1, ky * etDeficit);
  const heatLoss = Math.min(1, Math.max(0, -(HEAT_SENS[c]?.perDeg ?? -0.04) * tempAnomalyC));
  const yieldLoss = 1 - (1 - waterLoss) * (1 - heatLoss);
  return { crop: c, ky, etDeficit: round(etDeficit, 4), waterLoss: round(waterLoss, 4), heatLoss: round(heatLoss, 4), yieldLoss: round(yieldLoss, 4) };
}

// ─── Finance helpers ──────────────────────────────────────────────────────

/** Insured loss after a percentage deductible of the sum insured. */
export function insuredLoss(sumInsured: number, damageRatio: number, deductiblePct = 0): number {
  return Math.max(0, sumInsured * Math.max(0, Math.min(1, damageRatio)) - (sumInsured * deductiblePct) / 100);
}

/** Minimal signature of the credit-risk functions we reuse (injected to keep this module pure). */
export interface CreditFns {
  baselinePd: (rating: string, dpd: number) => { pd: number; stage: 1 | 2 | 3 };
  climatePd: (pdBase: number, p: Record<"flood" | "drought" | "salinity" | "heat", number>, sens: Record<"flood" | "drought" | "salinity" | "heat", number>, segment: "smallholder" | "sme", severity?: Partial<Record<"flood" | "drought" | "salinity" | "heat", number>>) => number;
  sensitivity: (crop: string | null) => Record<"flood" | "drought" | "salinity" | "heat", number>;
  lgdFor: (collateral: string, p: Record<"flood" | "drought" | "salinity" | "heat", number>, extraPp?: number) => number;
}

/** Portfolio-average damage ratio of a "typical severe year" per hazard (portfolio.ts MEAN_DAMAGE_RATIO). */
const TYPICAL_DAMAGE = { flood: 0.45, drought: 0.35, heat: 0.2 } as const;

export interface LoanShock {
  pdBase: number;
  pdStressed: number;
  lgd: number;
  eadUsd: number;
  elBaseUsd: number;
  elStressedUsd: number;
  elUpliftUsd: number;
}

/**
 * Loan PD shock for a *realised* event: the hazard probability for the event
 * year is 1 and the credit-risk k-factor is scaled by (damage / typical severe
 * damage), so a total loss adds ~2× the severe-year default probability.
 */
export function loanShock(
  a: { valueUsd: number; crop: string | null; tags: string[]; meta: Record<string, unknown> },
  hazard: "flood" | "drought" | "heat",
  damageRatio: number,
  fns: CreditFns
): LoanShock {
  const rating = String(a.meta.internalRating ?? "BB");
  const dpd = Number(a.meta.daysPastDue ?? 0);
  const principal = Number(a.meta.principalUsd ?? a.valueUsd);
  const segment: "smallholder" | "sme" = a.tags.includes("sme") || principal > 10000 ? "sme" : "smallholder";
  const collateral = String(a.meta.collateral ?? "None");
  const { pd } = fns.baselinePd(rating, dpd);
  const zero = { flood: 0, drought: 0, salinity: 0, heat: 0 };
  const p = { ...zero, [hazard]: damageRatio > 0.01 ? 1 : 0 };
  const sev = { [hazard]: Math.max(0, damageRatio) / TYPICAL_DAMAGE[hazard] };
  const pdS = damageRatio > 0.01 ? fns.climatePd(pd, p, fns.sensitivity(a.crop), segment, sev) : pd;
  const lgd = fns.lgdFor(collateral, hazard === "flood" && damageRatio > 0.2 ? { ...zero, flood: 1 } : zero);
  const ead = a.valueUsd;
  const elBase = pd * lgd * ead;
  const elS = pdS * lgd * ead;
  return { pdBase: round(pd, 4), pdStressed: round(pdS, 4), lgd: round(lgd, 3), eadUsd: ead, elBaseUsd: Math.round(elBase), elStressedUsd: Math.round(elS), elUpliftUsd: Math.round(elS - elBase) };
}

export function round(v: number, d = 2): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}
