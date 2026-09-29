// ============================================================
// AGRI-SHIELD — Shared TypeScript Types
// ============================================================

// ─── Enums ───────────────────────────────────────────────────

export type UserRole =
  | "farmer"
  | "field_officer"
  | "regional_admin"
  | "national_admin"
  | "supply_chain_analyst"
  | "supply_chain_admin"
  | "enterprise_analyst"
  | "enterprise_admin"
  | "platform_admin";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AlertType = "flood" | "salinity" | "drought" | "storm" | "frost";
export type AlertSeverity = "watch" | "warning" | "emergency";
export type AlertChannel = "app" | "sms" | "whatsapp" | "email";
export type SubscriptionPlan =
  | "free"
  | "farmer_pro"
  | "gov_basic"
  | "gov_enterprise"
  | "supply_chain"
  | "business"
  | "enterprise";
export type SubscriptionStatus = "active" | "past_due" | "cancelled" | "trialing";
export type CropType =
  | "rice"
  | "wheat"
  | "maize"
  | "sugarcane"
  | "jute"
  | "coconut"
  | "vegetables"
  | "sorghum"
  | "barley"
  | "potato"
  | "onion"
  | "cotton"
  | "tobacco"
  | "banana"
  | "mango";

export type SoilType = "clay" | "loam" | "sandy" | "silt" | "peat" | "chalky";
export type IrrigationType =
  | "rainfed"
  | "drip"
  | "flood_irrigation"
  | "sprinkler"
  | "canal";
export type AdminLevel = "national" | "provincial" | "district";
export type ResourceType =
  | "pumps"
  | "sandbags"
  | "evacuation_buses"
  | "medical"
  | "food_aid";
export type ResourceStatus = "pending" | "approved" | "dispatched" | "delivered";
export type SupplyChainNodeType =
  | "warehouse"
  | "port"
  | "processor"
  | "retailer";
export type SupplyChainRiskType =
  | "flood_disruption"
  | "salinity_quality"
  | "access_blocked"
  | "storage_damaged";
export type RecommendationPriority = "low" | "medium" | "high" | "urgent";

/** Industry a workspace (tenant organisation) operates in — drives default modules. */
export type Industry =
  | "government"
  | "insurance"
  | "banking"
  | "agribusiness"
  | "ngo"
  | "cooperative";

/** Kinds of assets a workspace can monitor anywhere on Earth. */
export type AssetType =
  | "farm"
  | "field"
  | "warehouse"
  | "processing_plant"
  | "port"
  | "retail_outlet"
  | "insured_plot"
  | "loan"
  | "community"
  | "office";

// ─── Geo Types ────────────────────────────────────────────────

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeoPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface GeoBoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

// ─── User & Auth ──────────────────────────────────────────────

export interface User {
  id: string;
  email: string | null;
  name: string;
  role: UserRole;
  language: SupportedLanguage;
  phone: string | null;
  createdAt: Date;
  lastActive: Date;
  subscriptionTier: SubscriptionPlan;
}

export interface FarmerProfile {
  id: string;
  userId: string;
  farmName: string;
  totalAreaHa: number;
  primaryCrops: CropType[];
  experienceYears: number;
  location: GeoPoint;
  district: string;
  country: string;
}

export interface FarmField {
  id: string;
  farmerId: string;
  name: string;
  areaHa: number;
  cropType: CropType;
  plantingDate: Date | null;
  expectedHarvest: Date | null;
  soilType: SoilType;
  irrigationType: IrrigationType;
  geometry: GeoPolygon;
  elevationM: number | null;
  ndviScore: number | null;
  lastSatelliteScan: Date | null;
  currentFloodRisk: number; // 0-100
  currentSalinityRisk: number; // 0-100
}

export interface Organization {
  id: string;
  name: string;
  type: "government" | "supply_chain" | "ngo";
  country: string;
  region: string | null;
  verified: boolean;
  planTier: SubscriptionPlan;
}

// ─── Climate & Risk ───────────────────────────────────────────

export interface WeatherReading {
  time: Date;
  stationId: string;
  location: GeoPoint;
  temperatureC: number;
  humidityPct: number;
  rainfallMm: number;
  windSpeedKmh: number;
  soilMoisturePct: number | null;
  waterLevelM: number | null;
  salinityEcDsM: number | null;
}

export interface FloodRiskZone {
  id: string;
  regionId: string;
  geometry: GeoPolygon;
  riskLevel: RiskLevel;
  floodProbability7d: number;
  floodProbability24h: number;
  estimatedDepthM: number;
  lastUpdated: Date;
  modelVersion: string;
  confidenceScore: number;
}

export interface SalinityRiskZone {
  id: string;
  regionId: string;
  geometry: GeoPolygon;
  ecCurrentDsM: number;
  ecPredicted30d: number;
  intrusionDepthKm: number;
  riskLevel: RiskLevel;
  affectedAreaHa: number;
  lastUpdated: Date;
}

// ─── Alerts ───────────────────────────────────────────────────

export interface ClimateAlert {
  id: string;
  alertType: AlertType;
  severity: AlertSeverity;
  regionId: string | null;
  title: string;
  description: string;
  predictedImpact: Record<string, unknown>;
  recommendedActions: string[];
  validFrom: Date;
  validUntil: Date;
  createdAt: Date;
  isActive: boolean;
  geometry?: GeoPolygon;
}

export interface FarmRecommendation {
  id: string;
  farmFieldId: string;
  alertId: string | null;
  recommendationType: string;
  title: string;
  description: string;
  priority: RecommendationPriority;
  actions: RecommendationAction[];
  confidenceScore: number;
  generatedBy: string;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface RecommendationAction {
  id: string;
  label: string;
  description: string;
  urgency: RecommendationPriority;
  estimatedCostUsd?: number;
  expectedBenefitPct?: number;
}

// ─── ML API Contracts ─────────────────────────────────────────

export interface FloodRiskRequest {
  lat: number;
  lon: number;
  forecastDays?: number;
}

export interface FloodRiskResponse {
  probability24h: number;
  probability48h: number;
  probability72h: number;
  estimatedDepthM: number;
  confidenceInterval: [number, number];
  contributingFactors: string[];
  modelVersion: string;
  riskLevel: RiskLevel;
  lastUpdated: string;
}

export interface SalinityRiskRequest {
  lat: number;
  lon: number;
  cropType: CropType;
  predictionHorizonDays?: number;
}

export interface SalinityRiskResponse {
  ecCurrent: number;
  ecPredicted7d: number;
  ecPredicted30d: number;
  riskLevel: RiskLevel;
  cropDamageProbability: number;
  recommendedCrops: string[];
  mitigationActions: string[];
  confidence: number;
  modelVersion: string;
}

export interface AdvisorRequest {
  question: string;
  farmerProfile: {
    name: string;
    crops: CropType[];
    areaHa: number;
    district: string;
    country: string;
  };
  currentRisk: {
    floodProbability: number;
    salinityEc: number;
    weatherSummary: string;
  };
  language?: SupportedLanguage;
}

export interface AdvisorResponse {
  answer: string;
  actions: RecommendationAction[];
  sources: string[];
  confidence: number;
  language: SupportedLanguage;
}

export interface SupplyChainImpactRequest {
  nodeId: string;
  commodity: string;
  floodScenario: {
    intensityCategory: 1 | 2 | 3 | 4 | 5;
    durationDays: number;
    affectedArea: GeoPolygon;
  };
}

export interface SupplyChainImpactResponse {
  disruptionProbability: number;
  volumeLossTonnes: number;
  estimatedLossUsd: number;
  priceImpactPct: number;
  recoveryTimelineDays: number;
  confidenceInterval: [number, number];
  mitigationOptions: MitigationOption[];
}

export interface MitigationOption {
  id: string;
  label: string;
  description: string;
  estimatedCostUsd: number;
  riskReductionPct: number;
}

// ─── Government ────────────────────────────────────────────────

export interface GovernmentRegion {
  id: string;
  orgId: string;
  name: string;
  adminLevel: AdminLevel;
  geometry: GeoPolygon;
  population: number;
  vulnerableAreaHa: number;
  totalFarms: number;
}

export interface ResourceRequest {
  id: string;
  orgId: string;
  requestedBy: string;
  resourceType: ResourceType;
  quantity: number;
  targetRegion: string;
  status: ResourceStatus;
  priority: string;
  notes: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
}

// ─── Supply Chain ─────────────────────────────────────────────

export interface SupplyChainNode {
  id: string;
  orgId: string;
  type: SupplyChainNodeType;
  location: GeoPoint;
  capacityTonnes: number;
  primaryCommodities: string[];
  riskScore: number;
  name: string;
  country: string;
}

export interface CommodityRisk {
  commodity: string;
  producingRegions: string[];
  riskLevel: RiskLevel;
  supplyDisruptionPct: number;
  priceImpactForecast: number;
  atRiskVolumeTonnes: number;
  forecastDays: 7 | 14 | 30;
}

// ─── Analytics ────────────────────────────────────────────────

export interface DashboardKPIs {
  totalMonitoredAreaHa: number;
  activeHighRiskZones: number;
  farmersInAlertZones: number;
  resourcesDispatchedToday: number;
  alertsSentThisWeek: number;
  estimatedCropLossUsd: number;
}

// ─── i18n ─────────────────────────────────────────────────────

export type SupportedLanguage =
  | "en"
  | "hi"
  | "bn"
  | "vi"
  | "fil"
  | "id"
  | "ta"
  | "si";

export interface LanguageMeta {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  flag: string;
  rtl: boolean;
}

export const SUPPORTED_LANGUAGES: LanguageMeta[] = [
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", rtl: false },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳", rtl: false },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", flag: "🇧🇩", rtl: false },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", flag: "🇻🇳", rtl: false },
  { code: "fil", name: "Filipino", nativeName: "Filipino", flag: "🇵🇭", rtl: false },
  { code: "id", name: "Bahasa Indonesia", nativeName: "Bahasa Indonesia", flag: "🇮🇩", rtl: false },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", flag: "🇱🇰", rtl: false },
  { code: "si", name: "Sinhala", nativeName: "සිංහල", flag: "🇱🇰", rtl: false },
];

// ─── Crop Constants ────────────────────────────────────────────

export const CROP_EC_THRESHOLDS: Record<
  CropType,
  { sensitive: number; moderate: number; tolerant: number }
> = {
  rice: { sensitive: 3.0, moderate: 6.0, tolerant: 10.0 },
  wheat: { sensitive: 6.0, moderate: 9.0, tolerant: 13.0 },
  sugarcane: { sensitive: 1.7, moderate: 3.4, tolerant: 7.0 },
  coconut: { sensitive: 5.0, moderate: 8.0, tolerant: 12.0 },
  maize: { sensitive: 1.8, moderate: 3.6, tolerant: 5.0 },
  jute: { sensitive: 2.0, moderate: 4.0, tolerant: 8.0 },
  vegetables: { sensitive: 1.5, moderate: 3.0, tolerant: 5.0 },
  sorghum: { sensitive: 4.0, moderate: 7.0, tolerant: 11.0 },
  barley: { sensitive: 8.0, moderate: 12.0, tolerant: 18.0 },
  potato: { sensitive: 1.7, moderate: 3.4, tolerant: 5.9 },
  onion: { sensitive: 1.2, moderate: 2.4, tolerant: 4.0 },
  cotton: { sensitive: 7.7, moderate: 12.0, tolerant: 17.0 },
  tobacco: { sensitive: 1.5, moderate: 3.0, tolerant: 6.0 },
  banana: { sensitive: 1.0, moderate: 2.0, tolerant: 4.5 },
  mango: { sensitive: 1.5, moderate: 3.0, tolerant: 5.5 },
};

// ─── Map Layer Types ───────────────────────────────────────────

export type MapLayerId =
  | "flood-risk"
  | "salinity-intrusion"
  | "ndvi"
  | "rainfall"
  | "water-bodies"
  | "satellite"
  | "farmer-density"
  | "resource-allocation";

export interface MapLayer {
  id: MapLayerId;
  label: string;
  icon: string;
  color: string;
  enabled: boolean;
  opacity: number;
}
