/**
 * Farmer-portal domain helpers: profile resolution, field views, alert
 * categorisation, recommendation generation (onboarding + live), CSV export.
 */
import { TRPCError } from "@trpc/server";
import type { CropType, RecommendationPriority, RiskLevel, UserRole } from "@agri-shield/types";
import { CROP_EC_THRESHOLDS } from "@agri-shield/types";
import {
  DAY,
  getStore,
  nextId,
  riskLevelFromScore,
  type AlertRecord,
  type DistrictRecord,
  type FarmerProfileRecord,
  type FieldRecord,
  type RecommendationRecord,
} from "./store";

export const DEMO_FARMER_ID = "farmer-000";

export const CROP_LIST = ["rice", "wheat", "maize", "sugarcane", "jute", "coconut", "vegetables", "sorghum", "barley", "potato", "onion", "cotton", "tobacco", "banana", "mango"] as const satisfies readonly CropType[];
export const IRRIGATION_LIST = ["rainfed", "drip", "flood_irrigation", "sprinkler", "canal"] as const;
export const SOIL_LIST = ["clay", "loam", "sandy", "silt", "peat", "chalky"] as const;

/** Typical crop cycle (days) used to derive expected harvest. */
export const CROP_CYCLE_DAYS: Record<CropType, number> = {
  rice: 120, wheat: 125, maize: 110, sugarcane: 330, jute: 120, coconut: 365, vegetables: 75, sorghum: 110,
  barley: 110, potato: 100, onion: 120, cotton: 170, tobacco: 130, banana: 300, mango: 365,
};

// ─── Profile resolution ───────────────────────────────────────────────────

export interface ResolvedFarmer {
  farmer: FarmerProfileRecord;
  district: DistrictRecord;
  isDemoFallback: boolean;
}

/**
 * Farmers see their own profile. Officers/admins (who have view_farm_data but
 * no farm) get the demo farmer so they can preview the farmer experience.
 */
export function resolveFarmer(user: { id: string; role: UserRole }): ResolvedFarmer {
  const s = getStore();
  let farmer = s.farmers.find((f) => f.userId === user.id);
  let isDemoFallback = false;
  if (!farmer) {
    if (user.role === "farmer") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ONBOARDING_REQUIRED" });
    farmer = s.farmers.find((f) => f.id === DEMO_FARMER_ID) ?? s.farmers[0]!;
    isDemoFallback = true;
  }
  const district = s.districts.find((d) => d.id === farmer!.districtId) ?? s.districts[0]!;
  return { farmer, district, isDemoFallback };
}

export function farmerFields(farmerId: string): FieldRecord[] {
  return getStore().fields.filter((f) => f.farmerId === farmerId);
}

// ─── Field view ───────────────────────────────────────────────────────────

export type NdviHealth = "excellent" | "good" | "moderate" | "stressed";
export const ndviHealth = (n: number): NdviHealth => (n >= 0.65 ? "excellent" : n >= 0.5 ? "good" : n >= 0.35 ? "moderate" : "stressed");

export function fieldRiskScore(f: Pick<FieldRecord, "floodRisk" | "salinityRisk">) {
  return Math.round(Math.max(f.floodRisk, f.salinityRisk * 0.9));
}

const PRIORITY_RANK: Record<RecommendationPriority, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
export const byPriority = (a: { priority: RecommendationPriority; createdAt: Date }, b: { priority: RecommendationPriority; createdAt: Date }) =>
  PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.createdAt.getTime() - a.createdAt.getTime();

export function fieldView(f: FieldRecord, now = Date.now()) {
  const s = getStore();
  const total = Math.max(1, f.expectedHarvest.getTime() - f.plantingDate.getTime());
  const growthPct = Math.round(Math.min(100, Math.max(0, ((now - f.plantingDate.getTime()) / total) * 100)));
  const daysToHarvest = Math.ceil((f.expectedHarvest.getTime() - now) / DAY);
  const hist = f.ndviHistory;
  const prev = hist.length > 1 ? hist[hist.length - 2]!.ndvi : f.ndviScore;
  const riskScore = fieldRiskScore(f);
  const ecThreshold = CROP_EC_THRESHOLDS[f.cropType]?.sensitive ?? 3;
  const recommendations = s.recommendations
    .filter((r) => r.fieldId === f.id && r.expiresAt.getTime() > now)
    .sort(byPriority)
    .slice(0, 4)
    .map((r) => ({ id: r.id, title: r.title, description: r.description, priority: r.priority, actions: r.actions, confidence: r.confidenceScore, generatedBy: r.generatedBy, type: r.recommendationType }));
  return {
    id: f.id,
    name: f.name,
    areaHa: f.areaHa,
    cropType: f.cropType,
    plantingDate: f.plantingDate,
    expectedHarvest: f.expectedHarvest,
    daysToHarvest,
    growthPct,
    soilType: f.soilType,
    irrigationType: f.irrigationType,
    geometry: f.geometry,
    lat: f.lat,
    lon: f.lon,
    elevationM: f.elevationM,
    ndvi: f.ndviScore,
    ndviDelta: Math.round((f.ndviScore - prev) * 100) / 100,
    ndviHealth: ndviHealth(f.ndviScore),
    ndviHistory: hist,
    lastSatelliteScan: f.lastSatelliteScan,
    floodRisk: Math.round(f.floodRisk),
    salinityRisk: Math.round(f.salinityRisk),
    soilEc: f.soilEc,
    ecThreshold,
    riskScore,
    riskLevel: riskLevelFromScore(riskScore) as RiskLevel,
    recommendations,
  };
}

// ─── Alerts ───────────────────────────────────────────────────────────────

export type AlertCategory = "flood" | "salinity" | "weather" | "advisory";
export const alertCategory = (t: AlertRecord["alertType"]): AlertCategory => (t === "flood" ? "flood" : t === "salinity" ? "salinity" : "weather");
export const SEVERITY_RANK: Record<string, number> = { emergency: 3, warning: 2, watch: 1 };

export const priorityToSeverity = (p: RecommendationPriority) => (p === "urgent" ? "warning" : "watch") as "warning" | "watch";

// ─── Recommendations ──────────────────────────────────────────────────────

interface RecDraft {
  type: string;
  title: string;
  description: string;
  priority: RecommendationPriority;
  actions: string[];
  confidence: number;
  model: string;
  ttlDays: number;
}

/**
 * Rule layer over model outputs → concrete field actions. Thresholds come from
 * FAO-56 salinity tolerance tables (CROP_EC_THRESHOLDS) and IRRI flood guidance.
 */
export function draftRecommendations(
  f: Pick<FieldRecord, "name" | "cropType" | "floodRisk" | "salinityRisk" | "soilEc" | "ndviScore" | "plantingDate" | "expectedHarvest" | "irrigationType">,
  farmer: Pick<FarmerProfileRecord, "hasInsurance" | "floodHistory">,
  district: Pick<DistrictRecord, "name" | "riverName" | "rainfall72hMm">
): RecDraft[] {
  const out: RecDraft[] = [];
  const now = Date.now();
  const daysToHarvest = Math.ceil((f.expectedHarvest.getTime() - now) / DAY);
  const growth = (now - f.plantingDate.getTime()) / Math.max(1, f.expectedHarvest.getTime() - f.plantingDate.getTime());
  const ecT = CROP_EC_THRESHOLDS[f.cropType]?.sensitive ?? 3;

  if (f.floodRisk >= 60 && growth >= 0.8)
    out.push({ type: "early_harvest", title: `Harvest ${f.name} before the rain peaks`, description: `Flood probability ${Math.round(f.floodRisk)}% and your ${f.cropType} is ${Math.round(growth * 100)}% mature (${Math.max(0, daysToHarvest)} days to harvest). Harvesting now avoids submergence losses.`, priority: "urgent", actions: ["Harvest mature panicles first", "Dry and store grain on raised platforms"], confidence: 0.84, model: "flood-ensemble-v2.3.1", ttlDays: 3 });
  if (f.floodRisk >= 45)
    out.push({ type: "flood_preparedness", title: `Open drainage on ${f.name}`, description: `Flood probability ${Math.round(f.floodRisk)}% with ${Math.round(district.rainfall72hMm)} mm forecast in 72h on the ${district.riverName} basin. Clear outlets and open bunds toward the canal.`, priority: f.floodRisk >= 70 ? "urgent" : "high", actions: ["Clear drainage outlets", "Raise seedbed bunds by 15 cm", "Move seed and fertiliser to raised ground"], confidence: 0.81, model: "flood-ensemble-v2.3.1", ttlDays: 3 });
  if (f.soilEc > ecT)
    out.push({ type: "salinity_management", title: `Soil EC above ${f.cropType} threshold`, description: `Soil EC ${f.soilEc} dS/m exceeds the ${ecT} dS/m tolerance for ${f.cropType}. Flush with fresh water at low tide and apply gypsum.`, priority: f.soilEc > ecT * 1.6 ? "high" : "medium", actions: ["Freshwater flush 150 mm at low tide", "Apply gypsum 2 t/ha", "Close sluice gates at high tide"], confidence: 0.78, model: "salinity-lgbm-v1.4.0", ttlDays: 14 });
  else if (f.salinityRisk >= 55)
    out.push({ type: "salinity_watch", title: `Watch salinity on ${f.name}`, description: `Dry-season tides may push salt up the ${district.riverName}. Store fresh water now and test EC weekly.`, priority: "medium", actions: ["Store fresh water in pond", "Test soil EC weekly"], confidence: 0.72, model: "salinity-lgbm-v1.4.0", ttlDays: 14 });
  if (!farmer.hasInsurance && (f.floodRisk >= 45 || farmer.floodHistory === "often" || farmer.floodHistory === "sometimes"))
    out.push({ type: "insurance", title: "Protect this season with crop insurance", description: `Your area has a history of flooding. Parametric crop insurance pays out automatically when rainfall or flood thresholds are crossed.`, priority: "medium", actions: ["Apply for crop insurance", "Keep planting records and photos"], confidence: 0.7, model: "advisor-rules-v1", ttlDays: 30 });
  if (f.ndviScore < 0.45 && growth > 0.2)
    out.push({ type: "crop_health", title: `NDVI below expected on ${f.name}`, description: `Latest satellite NDVI ${f.ndviScore.toFixed(2)} is low for this growth stage. Scout for pests, nutrient deficiency or salt burn.`, priority: "medium", actions: ["Scout field for pests/disease", "Check leaf tips for salt burn"], confidence: 0.69, model: "ndvi-anomaly-v1.1", ttlDays: 7 });
  if (!out.length)
    out.push({ type: "routine", title: `${f.name}: conditions normal`, description: `Flood and salinity risks are low. Continue your normal schedule and keep drains clear.`, priority: "low", actions: [f.irrigationType === "rainfed" ? "Keep drains clear" : "Irrigate on schedule"], confidence: 0.66, model: "advisor-rules-v1", ttlDays: 7 });
  return out;
}

export function persistRecommendations(fieldId: string, drafts: RecDraft[]): RecommendationRecord[] {
  const s = getStore();
  const now = new Date();
  const recs = drafts.map((d) => ({
    id: nextId("rec"),
    fieldId,
    alertId: null,
    recommendationType: d.type,
    title: d.title,
    description: d.description,
    priority: d.priority,
    actions: d.actions,
    confidenceScore: d.confidence,
    generatedBy: d.model,
    createdAt: now,
    expiresAt: new Date(now.getTime() + d.ttlDays * DAY),
  }));
  s.recommendations.push(...recs);
  return recs;
}

// ─── CSV ──────────────────────────────────────────────────────────────────

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    // neutralise spreadsheet formula injection
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}
