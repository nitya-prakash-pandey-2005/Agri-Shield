/**
 * Pure risk-scoring functions — used when the Python ML service is unreachable
 * and to overlay live Open-Meteo/GloFAS observations onto district risk.
 * Kept dependency-free so they are trivially unit-testable.
 */
import type { CropType, RiskLevel } from "@agri-shield/types";
import { CROP_EC_THRESHOLDS } from "@agri-shield/types";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function riskLevel(score0to100: number): RiskLevel {
  if (score0to100 >= 80) return "critical";
  if (score0to100 >= 60) return "high";
  if (score0to100 >= 35) return "medium";
  return "low";
}

export interface FloodInputs {
  rain24hMm: number;
  rain48hMm: number;
  rain72hMm: number;
  /** volumetric soil moisture m³/m³ (0–0.55) */
  soilMoisture: number;
  /** current / 30-day mean river discharge; 1 = normal */
  dischargeRatio: number | null;
  /** 0–1 static exposure: elevation, river/coast proximity, flood history */
  exposure: number;
  elevationM?: number | null;
}

export interface FloodOutputs {
  p24: number;
  p48: number;
  p72: number;
  score: number;
  depthM: number;
  factors: string[];
}

export function scoreFlood(i: FloodInputs): FloodOutputs {
  const rainF = (mm: number, pivot: number) => sigmoid((mm - pivot) / (pivot * 0.45));
  const soilF = clamp01((i.soilMoisture - 0.15) / 0.3);
  const dis = i.dischargeRatio ?? 1;
  const disF = clamp01((dis - 0.8) / 1.2);
  const elevF = i.elevationM == null ? 0.5 : clamp01(1 - i.elevationM / 15);
  const staticF = 0.7 * i.exposure + 0.3 * elevF;

  const combine = (rain: number) => clamp01(0.34 * staticF + 0.3 * rain + 0.14 * soilF + 0.22 * disF);
  const p24 = combine(rainF(i.rain24hMm, 45));
  const p48 = Math.max(p24, combine(rainF(i.rain48hMm, 70)));
  const p72 = Math.max(p48, combine(rainF(i.rain72hMm, 90)));

  const factors: string[] = [];
  if (i.rain72hMm > 80) factors.push("above_avg_rainfall_72h");
  if (soilF > 0.6) factors.push("high_soil_saturation");
  if (dis > 1.4) factors.push("river_discharge_above_normal");
  if (i.exposure > 0.7) factors.push("low_lying_floodplain");
  if (elevF > 0.7) factors.push("low_elevation");
  if (!factors.length) factors.push("seasonal_baseline");

  return {
    p24: round2(p24),
    p48: round2(p48),
    p72: round2(p72),
    score: Math.round(p72 * 100),
    depthM: round2(Math.max(0, (p72 - 0.35) * 1.6 + (i.rain72hMm / 1000) * elevF)),
    factors,
  };
}

export interface SalinityInputs {
  /** 0–1 static exposure: coast distance, tidal rivers */
  exposure: number;
  month: number; // 1–12
  rain30dMm: number;
  /** sea level height above MSL (m), tidal proxy */
  seaLevelM: number | null;
  latitude: number;
}

/** Dry-season factor: salinity peaks Mar–May in S/SE Asian deltas (N hemisphere). */
export function drySeasonFactor(month: number, latitude: number): number {
  const m = latitude < 0 ? ((month + 5) % 12) + 1 : month;
  const curve = [0.75, 0.9, 1.0, 1.0, 0.9, 0.6, 0.45, 0.4, 0.42, 0.5, 0.6, 0.7];
  return curve[m - 1]!;
}

export function scoreSalinity(i: SalinityInputs) {
  const season = drySeasonFactor(i.month, i.latitude);
  const dilution = clamp01(i.rain30dMm / 400);
  const tide = i.seaLevelM == null ? 0 : clamp01((i.seaLevelM + 0.5) / 2);
  const ec = 0.4 + i.exposure * 9 * season * (1 - 0.45 * dilution) * (1 + 0.25 * tide);
  const ec30 = ec * (1 + 0.35 * (season < 0.6 ? 0.3 : 1) * i.exposure);
  return {
    ecCurrent: round1(ec),
    ecPredicted7d: round1(ec + (ec30 - ec) * 0.3),
    ecPredicted30d: round1(ec30),
    score: Math.round(clamp01(ec30 / 9) * 100),
  };
}

export function salinityClass(ec: number): "safe" | "sensitive" | "moderate" | "severe" {
  if (ec < 2) return "safe";
  if (ec < 4) return "sensitive";
  if (ec < 8) return "moderate";
  return "severe";
}

/** FAO Maas–Hoffman style yield-loss probability for a crop at a given EC. */
export function cropDamageProbability(crop: CropType, ec: number): number {
  const t = CROP_EC_THRESHOLDS[crop] ?? CROP_EC_THRESHOLDS.rice;
  if (ec <= t.sensitive) return round2(ec / t.sensitive * 0.15);
  if (ec >= t.tolerant) return 0.97;
  return round2(0.15 + ((ec - t.sensitive) / (t.tolerant - t.sensitive)) * 0.82);
}

/** Commodity loss curve, e.g. "rice flooded 5 days at 0.8 m → ~80 % loss". */
export function floodCropLoss(depthM: number, durationDays: number, sensitivity = 0.8): number {
  const depthF = clamp01(depthM / 1.0);
  const durF = clamp01(durationDays / 7);
  return round2(clamp01(sensitivity * (0.55 * depthF + 0.45 * durF) * 1.25));
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round1 = (v: number) => Math.round(v * 10) / 10;
