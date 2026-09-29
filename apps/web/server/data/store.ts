/**
 * Agri-SHIELD in-memory data store.
 *
 * In demo mode (no DATABASE_URL) this is the system of record: a deterministic,
 * realistic dataset (5 deltas, 22 districts, 50 farmers, ~150 fields, 200+
 * alerts, 20 supply-chain nodes) that supports reads AND writes, so every
 * workflow (dispatch resources, broadcast alert, mark actioned…) works end to end.
 * Live climate values are overlaid on top by `server/live/district-risk.ts`.
 *
 * Stored on globalThis so Next.js hot-reload doesn't wipe user actions.
 */
import type {
  AlertChannel,
  AlertSeverity,
  AlertType,
  CropType,
  IrrigationType,
  RecommendationPriority,
  ResourceStatus,
  ResourceType,
  RiskLevel,
  SoilType,
  SubscriptionPlan,
  SupplyChainNodeType,
  SupportedLanguage,
  UserRole,
} from "@agri-shield/types";
import { COUNTRIES, DISTRICTS, countryByCode, type DistrictDef } from "./geography";
import { between, blobPolygon, fieldPolygon, intBetween, makeId, mulberry32, pick, round } from "./prng";

// ─── Record types ─────────────────────────────────────────────────────────

export interface UserRecord {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  role: UserRole;
  language: SupportedLanguage;
  orgId: string | null;
  subscriptionTier: SubscriptionPlan;
  status: "active" | "suspended" | "pending_verification";
  createdAt: Date;
  lastActive: Date;
  /** demo-only; real deployments use Supabase Auth */
  password?: string;
}

export interface OrgRecord {
  id: string;
  name: string;
  shortName: string;
  type: "government" | "supply_chain" | "ngo";
  country: string;
  region: string | null;
  verified: boolean;
  planTier: SubscriptionPlan;
  createdAt: Date;
}

export interface DistrictRecord extends DistrictDef {
  countryName: string;
  basin: string;
  orgId: string;
  geometry: { type: "Polygon"; coordinates: number[][][] };
  vulnerableAreaHa: number;
  totalFarms: number;
  monitoredAreaHa: number;
  /** 0-100, overlaid with live model output when available */
  floodRisk: number;
  salinityRisk: number;
  floodProb24h: number;
  floodProb48h: number;
  floodProb72h: number;
  ecCurrent: number;
  ecPredicted30d: number;
  riskLevel: RiskLevel;
  rainfall72hMm: number;
  riverDischargeM3s: number | null;
  riverDischargeMeanM3s: number | null;
  seaLevelAnomalyM: number | null;
  liveSource: "seed" | "open-meteo" | "ml-model";
  lastUpdated: Date;
  historicalFloods: { year: number; month: string; areaHa: number; lossUsd: number; farmsAffected: number }[];
}

export interface FarmerProfileRecord {
  id: string;
  userId: string;
  farmName: string;
  totalAreaHa: number;
  primaryCrops: CropType[];
  experienceYears: number;
  lat: number;
  lon: number;
  districtId: string;
  country: string;
  floodHistory: "never" | "rarely" | "sometimes" | "often";
  salinityObserved: boolean;
  hasInsurance: boolean;
  referralCode: string;
  referrals: number;
  notificationPrefs: {
    alertTypes: string[];
    channels: AlertChannel[];
    timing: "immediate" | "daily" | "weekly";
    threshold: "low" | "medium" | "high";
  };
}

export interface FieldRecord {
  id: string;
  farmerId: string;
  name: string;
  areaHa: number;
  cropType: CropType;
  plantingDate: Date;
  expectedHarvest: Date;
  soilType: SoilType;
  irrigationType: IrrigationType;
  geometry: { type: "Polygon"; coordinates: number[][][] };
  lat: number;
  lon: number;
  elevationM: number;
  ndviScore: number;
  ndviHistory: { date: string; ndvi: number }[];
  lastSatelliteScan: Date;
  floodRisk: number;
  salinityRisk: number;
  soilEc: number;
}

export interface AlertRecord {
  id: string;
  alertType: AlertType;
  severity: AlertSeverity;
  districtId: string;
  title: string;
  description: string;
  predictedImpact: { farmsAffected: number; areaHa: number; estLossUsd: number; probability: number };
  recommendedActions: string[];
  channels: AlertChannel[];
  validFrom: Date;
  validUntil: Date;
  createdAt: Date;
  createdBy: string; // user id or "system"
  source: "model" | "manual" | "gdacs" | "eonet";
  isActive: boolean;
  deliveries: { sent: number; delivered: number; read: number; actioned: number };
}

export interface RecommendationRecord {
  id: string;
  fieldId: string;
  alertId: string | null;
  recommendationType: string;
  title: string;
  description: string;
  priority: RecommendationPriority;
  actions: string[];
  confidenceScore: number;
  generatedBy: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface FarmerActionRecord {
  id: string;
  farmerId: string;
  alertId: string | null;
  recommendationId: string | null;
  actionTaken: string;
  actionDate: Date;
  outcome: string | null;
  cropSavedPct: number | null;
}

export interface ResourceInventoryRecord {
  id: string;
  orgId: string;
  type: ResourceType;
  label: string;
  unit: string;
  total: number;
  deployed: number;
  depots: { name: string; lat: number; lon: number; quantity: number; coverageKm: number }[];
}

export interface ResourceRequestRecord {
  id: string;
  orgId: string;
  requestedBy: string;
  requestedByName: string;
  resourceType: ResourceType;
  quantity: number;
  targetDistrictId: string;
  status: ResourceStatus | "rejected";
  priority: "low" | "medium" | "high" | "critical";
  notes: string | null;
  vehicle: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  timeline: { status: string; at: Date; by: string }[];
}

export interface SupplyNodeRecord {
  id: string;
  orgId: string;
  name: string;
  type: SupplyChainNodeType;
  districtId: string;
  country: string;
  lat: number;
  lon: number;
  capacityTonnes: number;
  utilizationPct: number;
  primaryCommodities: string[];
  riskScore: number;
  floodRisk: number;
  salinityRisk: number;
}

export interface SupplyFlowRecord {
  id: string;
  from: string;
  to: string;
  commodity: string;
  tonnesPerWeek: number;
}

export interface CommodityRecord {
  commodity: string;
  unit: string;
  basePriceUsd: number;
  producingDistricts: string[];
  /** fraction of production lost per unit of flood risk (0-1) */
  floodSensitivity: number;
  salinitySensitivity: number;
  weeklyVolumeTonnes: number;
  priceHistory: { date: string; price: number }[];
}

export interface WebhookRecord {
  id: string;
  orgId: string;
  url: string;
  commodities: string[];
  riskThreshold: number;
  events: string[];
  active: boolean;
  secret: string;
  createdAt: Date;
  lastDelivery: { at: Date; status: number } | null;
}

export interface ApiKeyRecord {
  id: string;
  orgId: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsed: Date | null;
  scopes: string[];
}

export interface AuditRecord {
  id: string;
  at: Date;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  details: string;
}

export interface FeatureFlagRecord {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPct: number;
}

export interface SubscriptionRecord {
  id: string;
  userId: string | null;
  orgId: string | null;
  plan: SubscriptionPlan;
  status: "active" | "past_due" | "cancelled" | "trialing";
  mrrUsd: number;
  currentPeriodEnd: Date;
  provider: "stripe" | "razorpay" | "paymongo" | "none";
}

export interface Store {
  seededAt: Date;
  users: UserRecord[];
  orgs: OrgRecord[];
  districts: DistrictRecord[];
  farmers: FarmerProfileRecord[];
  fields: FieldRecord[];
  alerts: AlertRecord[];
  recommendations: RecommendationRecord[];
  farmerActions: FarmerActionRecord[];
  inventory: ResourceInventoryRecord[];
  resourceRequests: ResourceRequestRecord[];
  nodes: SupplyNodeRecord[];
  flows: SupplyFlowRecord[];
  commodities: CommodityRecord[];
  webhooks: WebhookRecord[];
  apiKeys: ApiKeyRecord[];
  audit: AuditRecord[];
  flags: FeatureFlagRecord[];
  subscriptions: SubscriptionRecord[];
  counters: Record<string, number>;
  /** Live = pure observations. Scenarios inject a stress event on top of live data for drills/demos. */
  scenario: { mode: ScenarioMode; intensity: number; setAt: Date; setBy: string };
}

export type ScenarioMode = "live" | "monsoon_surge" | "cyclone_landfall" | "dry_season_salinity";

// ─── Helpers ──────────────────────────────────────────────────────────────

export const riskLevelFromScore = (score: number): RiskLevel =>
  score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low";

const DAY = 86_400_000;
const HOUR = 3_600_000;

const FIRST_NAMES: Record<string, string[]> = {
  BD: ["Ratan", "Rafiqul", "Shirin", "Abdul", "Nasima", "Kamal", "Fatema", "Jahangir", "Mousumi", "Habib"],
  VN: ["Nguyễn Văn", "Trần Thị", "Lê Văn", "Phạm Thị", "Huỳnh Văn", "Võ Thị", "Đặng Văn", "Bùi Thị"],
  PH: ["Juan", "Maria", "Jose", "Ana", "Pedro", "Liza", "Ramon", "Cristina", "Arnel", "Rowena"],
  IN: ["Ramesh", "Sunita", "Prakash", "Lakshmi", "Bikash", "Sarojini", "Manoj", "Pratima", "Debasis", "Kalpana"],
  ID: ["Budi", "Siti", "Agus", "Dewi", "Slamet", "Sri", "Joko", "Wati", "Heru", "Yuni"],
};
const LAST_NAMES: Record<string, string[]> = {
  BD: ["Das", "Islam", "Akter", "Rahman", "Begum", "Hossain", "Khatun", "Mondal"],
  VN: ["Minh", "Lan", "Hùng", "Hoa", "Phúc", "Mai", "Tuấn", "Thảo"],
  PH: ["Santos", "Reyes", "Cruz", "Bautista", "Garcia", "Mendoza", "Dela Cruz", "Villanueva"],
  IN: ["Behera", "Nayak", "Sahoo", "Mohanty", "Panda", "Swain", "Jena", "Pradhan"],
  ID: ["Santoso", "Rahayu", "Wibowo", "Lestari", "Susanto", "Wulandari", "Hidayat", "Purnomo"],
};
const FARM_SUFFIX = ["Green Valley", "Riverside", "Golden Paddy", "Delta Bloom", "Sunrise", "Lotus", "Monsoon", "Tidewater", "Emerald", "Harvest Moon"];
const FIELD_NAMES = ["North Paddy", "South Plot", "River Bank", "East Terrace", "Homestead Garden", "Canal Field", "West Block", "Lowland Strip"];

const CROP_DAYS: Partial<Record<CropType, number>> = {
  rice: 120, jute: 120, sugarcane: 330, coconut: 365, vegetables: 75, maize: 110, onion: 120, mango: 365, wheat: 125,
};

// ─── Seeder ───────────────────────────────────────────────────────────────

function seed(): Store {
  const rng = mulberry32(20260929);
  const now = new Date();
  let n = 0;
  const id = (p: string) => makeId(p, ++n);

  // Organizations — one ministry per country + supply-chain companies + NGO
  const orgs: OrgRecord[] = COUNTRIES.map((c) => ({
    id: `org-gov-${c.code.toLowerCase()}`,
    name: c.ministry,
    shortName: c.ministryShort,
    type: "government" as const,
    country: c.name,
    region: c.basin,
    verified: true,
    planTier: c.code === "BD" ? ("gov_enterprise" as const) : ("gov_basic" as const),
    createdAt: new Date(now.getTime() - intBetween(rng, 90, 400) * DAY),
  }));
  orgs.push(
    { id: "org-sc-asiagrain", name: "AsiaGrain Logistics Pte Ltd", shortName: "AsiaGrain", type: "supply_chain", country: "Singapore", region: "South & Southeast Asia", verified: true, planTier: "supply_chain", createdAt: new Date(now.getTime() - 210 * DAY) },
    { id: "org-sc-mekongfoods", name: "Mekong Fresh Foods JSC", shortName: "MekongFoods", type: "supply_chain", country: "Vietnam", region: "Mekong Delta", verified: true, planTier: "supply_chain", createdAt: new Date(now.getTime() - 120 * DAY) },
    { id: "org-ngo-brac", name: "Delta Resilience Foundation", shortName: "DRF", type: "ngo", country: "Bangladesh", region: "Coastal Belt", verified: false, planTier: "gov_basic", createdAt: new Date(now.getTime() - 4 * DAY) },
    { id: "org-gov-lk", name: "Sri Lanka Dept. of Agriculture", shortName: "DOA-LK", type: "government", country: "Sri Lanka", region: "Northern Province", verified: false, planTier: "gov_basic", createdAt: new Date(now.getTime() - 2 * DAY) },
  );

  // Districts
  const months = ["Jun", "Jul", "Aug", "Sep", "Oct"];
  const districts: DistrictRecord[] = DISTRICTS.map((d) => {
    const c = countryByCode(d.country);
    const floodRisk = round(Math.min(97, d.floodExposure * 85 + between(rng, -8, 12)), 0);
    const salinityRisk = round(Math.min(96, d.salinityExposure * 88 + between(rng, -6, 8)), 0);
    const p72 = Math.min(0.97, floodRisk / 100 + between(rng, 0.02, 0.08));
    const ec = round(0.8 + d.salinityExposure * between(rng, 6, 9), 1);
    const totalFarms = Math.round((d.population / 1000) * between(rng, 55, 95));
    return {
      ...d,
      countryName: c.name,
      basin: c.basin,
      orgId: `org-gov-${d.country.toLowerCase()}`,
      geometry: { type: "Polygon" as const, coordinates: blobPolygon(rng, d.lat, d.lon, 0.22, 12) },
      vulnerableAreaHa: Math.round(totalFarms * between(rng, 0.4, 0.9)),
      totalFarms,
      monitoredAreaHa: Math.round(totalFarms * between(rng, 0.9, 1.6)),
      floodRisk,
      salinityRisk,
      floodProb24h: round(p72 * between(rng, 0.7, 0.85), 2),
      floodProb48h: round(p72 * between(rng, 0.86, 0.95), 2),
      floodProb72h: round(p72, 2),
      ecCurrent: ec,
      ecPredicted30d: round(ec * between(rng, 1.1, 1.5), 1),
      riskLevel: riskLevelFromScore(Math.max(floodRisk, salinityRisk * 0.9)),
      rainfall72hMm: round(d.floodExposure * between(rng, 40, 160), 1),
      riverDischargeM3s: null,
      riverDischargeMeanM3s: null,
      seaLevelAnomalyM: null,
      liveSource: "seed" as const,
      lastUpdated: now,
      historicalFloods: Array.from({ length: 6 }, (_, i) => {
        const areaHa = Math.round(d.floodExposure * between(rng, 2000, 42000));
        return {
          year: 2020 + i,
          month: pick(rng, months),
          areaHa,
          lossUsd: Math.round(areaHa * between(rng, 380, 900)),
          farmsAffected: Math.round(areaHa / between(rng, 0.8, 1.6)),
        };
      }),
    };
  });

  // Users — demo accounts first (credentials from spec §15)
  const users: UserRecord[] = [
    { id: "user-farmer-demo", email: "farmer@demo.agrishield.io", phone: "+8801711000000", name: "Ratan Das", role: "farmer", language: "en", orgId: null, subscriptionTier: "farmer_pro", status: "active", createdAt: new Date(now.getTime() - 180 * DAY), lastActive: now },
    { id: "user-gov-demo", email: "gov@demo.agrishield.io", phone: "+8801711000001", name: "Dr. Farhana Ahmed", role: "national_admin", language: "en", orgId: "org-gov-bd", subscriptionTier: "gov_enterprise", status: "active", createdAt: new Date(now.getTime() - 300 * DAY), lastActive: now, password: "demo2026" },
    { id: "user-supply-demo", email: "supply@demo.agrishield.io", phone: "+6590000001", name: "Wei Lin Tan", role: "supply_chain_admin", language: "en", orgId: "org-sc-asiagrain", subscriptionTier: "supply_chain", status: "active", createdAt: new Date(now.getTime() - 200 * DAY), lastActive: now, password: "demo2026" },
    { id: "user-admin-demo", email: "admin@demo.agrishield.io", phone: null, name: "Platform Admin", role: "platform_admin", language: "en", orgId: null, subscriptionTier: "gov_enterprise", status: "active", createdAt: new Date(now.getTime() - 400 * DAY), lastActive: now, password: "demo2026" },
    { id: "user-officer-barisal", email: "officer.barisal@demo.agrishield.io", phone: null, name: "Md. Kamrul Hasan", role: "field_officer", language: "bn", orgId: "org-gov-bd", subscriptionTier: "gov_enterprise", status: "active", createdAt: new Date(now.getTime() - 150 * DAY), lastActive: new Date(now.getTime() - 3 * HOUR), password: "demo2026" },
    { id: "user-regional-khulna", email: "regional.khulna@demo.agrishield.io", phone: null, name: "Nusrat Jahan", role: "regional_admin", language: "bn", orgId: "org-gov-bd", subscriptionTier: "gov_enterprise", status: "active", createdAt: new Date(now.getTime() - 140 * DAY), lastActive: new Date(now.getTime() - 26 * HOUR), password: "demo2026" },
  ];
  for (const c of COUNTRIES.filter((c) => c.code !== "BD")) {
    users.push({
      id: `user-gov-${c.code.toLowerCase()}`,
      email: `gov.${c.code.toLowerCase()}@demo.agrishield.io`,
      phone: null,
      name: `${c.ministryShort} Operations Desk`,
      role: "national_admin",
      language: c.language,
      orgId: `org-gov-${c.code.toLowerCase()}`,
      subscriptionTier: "gov_basic",
      status: "active",
      createdAt: new Date(now.getTime() - intBetween(rng, 60, 250) * DAY),
      lastActive: new Date(now.getTime() - intBetween(rng, 1, 90) * HOUR),
      password: "demo2026",
    });
  }

  // Farmers — 50 demo farmers across districts, 2-5 fields each
  const farmers: FarmerProfileRecord[] = [];
  const fields: FieldRecord[] = [];
  const cropSoil: SoilType[] = ["clay", "loam", "silt", "clay", "sandy"];
  const irrigation: IrrigationType[] = ["rainfed", "canal", "flood_irrigation", "drip", "sprinkler"];

  const makeFarmer = (idx: number, district: DistrictRecord, userId: string, overrideName?: string) => {
    const c = district.country;
    const name = overrideName ?? `${pick(rng, FIRST_NAMES[c]!)} ${pick(rng, LAST_NAMES[c]!)}`;
    const lat = district.lat + between(rng, -0.12, 0.12);
    const lon = district.lon + between(rng, -0.12, 0.12);
    const nFields = idx === 0 ? 2 : intBetween(rng, 2, 5);
    const crops = Array.from(new Set(district.primaryCrops.concat(rng() > 0.6 ? ["vegetables"] : []))) as CropType[];
    const farmerId = `farmer-${idx.toString().padStart(3, "0")}`;
    let total = 0;
    for (let f = 0; f < nFields; f++) {
      const areaHa = idx === 0 ? [2.1, 1.4][f]! : round(between(rng, 0.4, 3.2), 1);
      total += areaHa;
      const crop = idx === 0 ? (["rice", "jute"] as CropType[])[f]! : pick(rng, crops);
      const cycle = CROP_DAYS[crop] ?? 120;
      const planted = new Date(now.getTime() - intBetween(rng, 20, Math.min(cycle - 10, 160)) * DAY);
      const flat = lat + between(rng, -0.01, 0.01);
      const flon = lon + between(rng, -0.01, 0.01);
      const fr = Math.min(98, Math.max(5, district.floodRisk + between(rng, -15, 10)));
      const sr = Math.min(98, Math.max(2, district.salinityRisk + between(rng, -15, 10)));
      const baseNdvi = between(rng, 0.52, 0.8) - fr / 600;
      fields.push({
        id: idx === 0 ? `field-${f + 1}` : id("fld"),
        farmerId,
        name: idx === 0 ? ["North Paddy Field", "South Jute Plot"][f]! : FIELD_NAMES[f % FIELD_NAMES.length]!,
        areaHa,
        cropType: crop,
        plantingDate: planted,
        expectedHarvest: new Date(planted.getTime() + cycle * DAY),
        soilType: pick(rng, cropSoil),
        irrigationType: pick(rng, irrigation),
        geometry: { type: "Polygon", coordinates: fieldPolygon(rng, flat, flon, areaHa) },
        lat: round(flat, 5),
        lon: round(flon, 5),
        elevationM: round(between(rng, 0.8, 9), 1),
        ndviScore: round(baseNdvi, 2),
        ndviHistory: Array.from({ length: 12 }, (_, w) => ({
          date: new Date(now.getTime() - (11 - w) * 7 * DAY).toISOString().slice(0, 10),
          ndvi: round(Math.max(0.15, baseNdvi - 0.25 + (w / 11) * 0.28 + between(rng, -0.04, 0.04)), 2),
        })),
        lastSatelliteScan: new Date(now.getTime() - intBetween(rng, 1, 70) * HOUR),
        floodRisk: round(fr, 0),
        salinityRisk: round(sr, 0),
        soilEc: round(district.ecCurrent + between(rng, -0.6, 0.8), 1),
      });
    }
    farmers.push({
      id: farmerId,
      userId,
      farmName: `${pick(rng, FARM_SUFFIX)} Farm`,
      totalAreaHa: round(total, 1),
      primaryCrops: crops,
      experienceYears: intBetween(rng, 3, 38),
      lat: round(lat, 5),
      lon: round(lon, 5),
      districtId: district.id,
      country: district.countryName,
      floodHistory: pick(rng, ["rarely", "sometimes", "often"] as const),
      salinityObserved: district.salinityExposure > 0.5,
      hasInsurance: rng() > 0.65,
      referralCode: `AGS-${name.split(" ")[0]!.slice(0, 3).toUpperCase()}${intBetween(rng, 100, 999)}`,
      referrals: intBetween(rng, 0, 6),
      notificationPrefs: {
        alertTypes: ["flood", "salinity", "weather", "planting"],
        channels: ["app", "sms", ...(rng() > 0.5 ? (["whatsapp"] as AlertChannel[]) : [])],
        timing: "immediate",
        threshold: "medium",
      },
    });
    return name;
  };

  // Demo farmer: Ratan Das, Barisal
  const barisal = districts.find((d) => d.id === "bd-barisal")!;
  makeFarmer(0, barisal, "user-farmer-demo", "Ratan Das");
  farmers[0]!.farmName = "Green Valley Farm";
  farmers[0]!.lat = 22.7011;
  farmers[0]!.lon = 90.3637;
  farmers[0]!.referralCode = "AGS-RATAN42";

  for (let i = 1; i < 50; i++) {
    const district = districts[i % districts.length]!;
    const userId = `user-farmer-${i.toString().padStart(3, "0")}`;
    const name = makeFarmer(i, district, userId);
    const c = countryByCode(district.country);
    users.push({
      id: userId,
      email: null,
      phone: `+${intBetween(rng, 60, 99)}${intBetween(rng, 1_000_000_000, 9_999_999_999)}`,
      name,
      role: "farmer",
      language: c.language,
      orgId: null,
      subscriptionTier: rng() > 0.7 ? "farmer_pro" : "free",
      status: rng() > 0.96 ? "suspended" : "active",
      createdAt: new Date(now.getTime() - intBetween(rng, 5, 330) * DAY),
      lastActive: new Date(now.getTime() - intBetween(rng, 1, 400) * HOUR),
    });
  }

  // Alerts — 3 active flood + 2 active salinity (spec §15) + 200 historical
  const ACTIONS: Record<AlertType, string[]> = {
    flood: ["Harvest mature crops (≥80% maturity) immediately", "Move equipment, seed stock and livestock to raised ground", "Clear field drainage channels and open bunds toward canals", "Store drinking water and keep phone charged", "Register for emergency pump support with your field officer"],
    salinity: ["Flush fields with 150–200 mm freshwater if available", "Delay transplanting until EC drops below crop threshold", "Apply gypsum at 2–4 t/ha on affected plots", "Close sluice gates during high tide", "Switch next season to salt-tolerant variety (e.g. BRRI dhan 67)"],
    drought: ["Prioritise irrigation for flowering-stage crops", "Apply mulch to conserve soil moisture", "Use alternate wetting and drying (AWD) irrigation"],
    storm: ["Secure loose structures and greenhouse covers", "Harvest ready produce before landfall", "Move boats and nets to safe harbour"],
    frost: ["Irrigate lightly in the evening to retain heat", "Cover nursery beds overnight"],
  };
  const alerts: AlertRecord[] = [];
  const active: [string, AlertType, AlertSeverity, number][] = [
    ["bd-barisal", "flood", "warning", 72],
    ["bd-khulna", "flood", "emergency", 88],
    ["vn-angiang", "flood", "warning", 74],
    ["vn-bentre", "salinity", "warning", 81],
    ["bd-satkhira", "salinity", "watch", 66],
  ];
  for (const [did, type, severity, prob] of active) {
    const d = districts.find((x) => x.id === did)!;
    const farmsAffected = Math.round(d.totalFarms * (prob / 100) * 0.18);
    alerts.push({
      id: id("alr"),
      alertType: type,
      severity,
      districtId: did,
      title:
        type === "flood"
          ? `${severity === "emergency" ? "Flood Emergency" : "Elevated Flood Risk"} — ${d.name}`
          : `Saltwater Intrusion ${severity === "watch" ? "Watch" : "Warning"} — ${d.name}`,
      description:
        type === "flood"
          ? `Upstream discharge on the ${d.riverName} is running above its 30-day mean and soils in low-lying unions are near saturation. Model probability of field-level flooding within 72h: ${prob}%.`
          : `Soil/water EC trending upward at monitoring stations (${d.ecCurrent} → ${d.ecPredicted30d} dS/m forecast in 30 days) as dry-season tides push salt up the ${d.riverName}. Rice yield loss likely above 3 dS/m.`,
      predictedImpact: { farmsAffected, areaHa: Math.round(farmsAffected * 1.3), estLossUsd: Math.round(farmsAffected * 1.3 * 620), probability: prob / 100 },
      recommendedActions: ACTIONS[type].slice(0, 3),
      channels: ["app", "sms", "whatsapp"],
      validFrom: new Date(now.getTime() - intBetween(rng, 1, 10) * HOUR),
      validUntil: new Date(now.getTime() + (type === "flood" ? 72 : 168) * HOUR),
      createdAt: new Date(now.getTime() - intBetween(rng, 1, 10) * HOUR),
      createdBy: "system",
      source: "model",
      isActive: true,
      deliveries: { sent: farmsAffected, delivered: Math.round(farmsAffected * 0.97), read: Math.round(farmsAffected * 0.81), actioned: Math.round(farmsAffected * 0.58) },
    });
  }
  const types: AlertType[] = ["flood", "flood", "flood", "salinity", "salinity", "storm", "drought"];
  for (let i = 0; i < 200; i++) {
    const d = pick(rng, districts);
    const type = pick(rng, types);
    const severity = pick(rng, ["watch", "warning", "warning", "emergency"] as const);
    const created = new Date(now.getTime() - intBetween(rng, 2, 365) * DAY - intBetween(rng, 0, 23) * HOUR);
    const sent = intBetween(rng, 80, 4200);
    const typeLabel = { flood: "Flood", salinity: "Salinity", storm: "Cyclone/Storm", drought: "Dry-spell", frost: "Cold-wave" }[type];
    alerts.push({
      id: id("alr"),
      alertType: type,
      severity,
      districtId: d.id,
      title: `${typeLabel} ${severity === "emergency" ? "Emergency" : severity === "warning" ? "Warning" : "Watch"} — ${d.name}`,
      description: `${typeLabel} ${severity} issued for ${d.name}, ${d.countryName}.`,
      predictedImpact: { farmsAffected: Math.round(sent * 0.9), areaHa: Math.round(sent * 1.2), estLossUsd: Math.round(sent * 1.2 * 540), probability: round(between(rng, 0.45, 0.95), 2) },
      recommendedActions: ACTIONS[type].slice(0, 3),
      channels: rng() > 0.4 ? ["app", "sms", "whatsapp"] : ["app", "sms"],
      validFrom: created,
      validUntil: new Date(created.getTime() + 72 * HOUR),
      createdAt: created,
      createdBy: rng() > 0.7 ? "user-gov-demo" : "system",
      source: rng() > 0.7 ? "manual" : "model",
      isActive: false,
      deliveries: {
        sent,
        delivered: Math.round(sent * between(rng, 0.93, 0.99)),
        read: Math.round(sent * between(rng, 0.62, 0.9)),
        actioned: Math.round(sent * between(rng, 0.35, 0.72)),
      },
    });
  }
  alerts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Recommendations for every field
  const recommendations: RecommendationRecord[] = [];
  for (const f of fields) {
    if (f.floodRisk > 55)
      recommendations.push({ id: id("rec"), fieldId: f.id, alertId: null, recommendationType: "flood_preparedness", title: "Prepare drainage before forecast rainfall", description: `Flood probability ${f.floodRisk}% on ${f.name}. Open bunds toward the nearest canal and clear outlets.`, priority: f.floodRisk > 75 ? "urgent" : "high", actions: ["Clear drainage outlets", "Raise seedbed bunds by 15 cm"], confidenceScore: round(between(rng, 0.74, 0.92), 2), generatedBy: "flood-ensemble-v2.3.1", createdAt: new Date(now.getTime() - 5 * HOUR), expiresAt: new Date(now.getTime() + 72 * HOUR) });
    if (f.soilEc > 3)
      recommendations.push({ id: id("rec"), fieldId: f.id, alertId: null, recommendationType: "salinity_management", title: "Soil EC above crop threshold", description: `Measured EC ${f.soilEc} dS/m. Apply freshwater flush and gypsum to protect ${f.cropType}.`, priority: f.soilEc > 5 ? "high" : "medium", actions: ["Freshwater flush 150 mm", "Gypsum 2 t/ha"], confidenceScore: round(between(rng, 0.7, 0.88), 2), generatedBy: "salinity-lgbm-v1.4.0", createdAt: new Date(now.getTime() - 20 * HOUR), expiresAt: new Date(now.getTime() + 14 * DAY) });
    recommendations.push({ id: id("rec"), fieldId: f.id, alertId: null, recommendationType: "crop_health", title: f.ndviScore > 0.6 ? "Canopy healthy — maintain nutrient schedule" : "NDVI below expected — scout for stress", description: `Latest Sentinel-2 NDVI ${f.ndviScore}.`, priority: f.ndviScore > 0.6 ? "low" : "medium", actions: f.ndviScore > 0.6 ? ["Top-dress urea at panicle initiation"] : ["Scout for pests/disease", "Check leaf tips for salt burn"], confidenceScore: round(between(rng, 0.66, 0.85), 2), generatedBy: "ndvi-anomaly-v1.1", createdAt: new Date(now.getTime() - 30 * HOUR), expiresAt: new Date(now.getTime() + 7 * DAY) });
  }

  // Farmer action history (outcome feedback loop)
  const farmerActions: FarmerActionRecord[] = [];
  for (let i = 0; i < 160; i++) {
    const farmer = pick(rng, farmers);
    const alert = pick(rng, alerts.slice(5));
    const saved = round(between(rng, 40, 100), 0);
    farmerActions.push({ id: id("act"), farmerId: farmer.id, alertId: alert.id, recommendationId: null, actionTaken: pick(rng, alert.recommendedActions), actionDate: new Date(alert.createdAt.getTime() + intBetween(rng, 1, 30) * HOUR), outcome: saved > 80 ? "Crop protected" : "Partial loss", cropSavedPct: saved });
  }
  farmerActions.push(
    { id: id("act"), farmerId: "farmer-000", alertId: alerts[40]!.id, recommendationId: null, actionTaken: "Cleared drainage channels", actionDate: new Date(now.getTime() - 5 * DAY), outcome: "No flooding — precautions taken", cropSavedPct: 100 },
    { id: id("act"), farmerId: "farmer-000", alertId: alerts[60]!.id, recommendationId: null, actionTaken: "Early harvest of North Paddy", actionDate: new Date(now.getTime() - 3 * DAY), outcome: "Drainage prepared, 0% crop loss", cropSavedPct: 100 },
  );

  // Resource inventory per government org (BD detailed; others scaled)
  const RES: { type: ResourceType; label: string; unit: string; base: number }[] = [
    { type: "pumps", label: "Water Pumps", unit: "units", base: 250 },
    { type: "sandbags", label: "Sandbags", unit: "bags", base: 12000 },
    { type: "evacuation_buses", label: "Evacuation Buses", unit: "vehicles", base: 85 },
    { type: "medical", label: "Medical Kits", unit: "kits", base: 500 },
    { type: "food_aid", label: "Food Aid Packages", unit: "packages", base: 8000 },
  ];
  const inventory: ResourceInventoryRecord[] = [];
  for (const org of orgs.filter((o) => o.type === "government" && o.verified)) {
    const orgDistricts = districts.filter((d) => d.orgId === org.id);
    const scale = org.id === "org-gov-bd" ? 1 : between(rng, 0.4, 0.8);
    for (const r of RES) {
      const total = Math.round(r.base * scale);
      const deployedPct = r.type === "pumps" ? 0.88 : between(rng, 0.2, 0.7);
      inventory.push({
        id: id("inv"),
        orgId: org.id,
        type: r.type,
        label: r.label,
        unit: r.unit,
        total,
        deployed: Math.round(total * deployedPct),
        depots: orgDistricts.map((d) => ({ name: `${d.name} Central Depot`, lat: round(d.lat + between(rng, -0.05, 0.05), 4), lon: round(d.lon + between(rng, -0.05, 0.05), 4), quantity: Math.round((total * (1 - deployedPct)) / orgDistricts.length), coverageKm: intBetween(rng, 15, 40) })),
      });
    }
  }

  const resourceRequests: ResourceRequestRecord[] = [];
  const reqStatuses: ResourceRequestRecord["status"][] = ["pending", "pending", "pending", "approved", "dispatched", "dispatched", "delivered", "delivered", "delivered", "rejected"];
  const requesters = [
    { id: "user-officer-barisal", name: "Md. Kamrul Hasan" },
    { id: "user-regional-khulna", name: "Nusrat Jahan" },
  ];
  for (let i = 0; i < 18; i++) {
    const d = pick(rng, districts.filter((x) => x.country === "BD"));
    const status = reqStatuses[i % reqStatuses.length]!;
    const r = pick(rng, RES);
    const created = new Date(now.getTime() - intBetween(rng, 1, 96) * HOUR);
    const who = pick(rng, requesters);
    const timeline = [{ status: "pending", at: created, by: who.name }];
    if (status !== "pending") timeline.push({ status: status === "rejected" ? "rejected" : "approved", at: new Date(created.getTime() + 2 * HOUR), by: "Dr. Farhana Ahmed" });
    if (status === "dispatched" || status === "delivered") timeline.push({ status: "dispatched", at: new Date(created.getTime() + 5 * HOUR), by: "Logistics Cell" });
    if (status === "delivered") timeline.push({ status: "delivered", at: new Date(created.getTime() + 14 * HOUR), by: `${d.name} Depot` });
    resourceRequests.push({
      id: id("req"),
      orgId: "org-gov-bd",
      requestedBy: who.id,
      requestedByName: who.name,
      resourceType: r.type,
      quantity: Math.max(1, Math.round(r.base * between(rng, 0.02, 0.12))),
      targetDistrictId: d.id,
      status,
      priority: d.floodRisk > 75 ? "critical" : d.floodRisk > 60 ? "high" : "medium",
      notes: pick(rng, ["Embankment breach reported near union parishad", "Low-lying paddies submerged since morning", "Pre-positioning ahead of forecast rainfall", "Request from Upazila Agriculture Officer", null]),
      vehicle: status === "dispatched" || status === "delivered" ? `Truck DHK-${intBetween(rng, 1000, 9999)}` : null,
      approvedBy: status !== "pending" && status !== "rejected" ? "user-gov-demo" : null,
      approvedAt: status !== "pending" && status !== "rejected" ? new Date(created.getTime() + 2 * HOUR) : null,
      createdAt: created,
      timeline,
    });
  }
  resourceRequests.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Supply chain nodes (20) + flows
  const NODE_DEFS: [string, SupplyChainNodeType, string, string[], number][] = [
    ["Chattogram Port Terminal", "port", "bd-barisal", ["rice", "jute", "sugarcane"], 850000],
    ["Mongla Port", "port", "bd-khulna", ["rice", "jute"], 420000],
    ["Barisal Rice Mill Cluster", "processor", "bd-barisal", ["rice"], 64000],
    ["Khulna Jute Processing Hub", "processor", "bd-khulna", ["jute"], 38000],
    ["Satkhira Cold Storage", "warehouse", "bd-satkhira", ["vegetables", "rice"], 12000],
    ["Sylhet Grain Depot", "warehouse", "bd-sylhet", ["rice"], 26000],
    ["Cần Thơ Rice Export Warehouse", "warehouse", "vn-cantho", ["rice"], 95000],
    ["Cái Mép Port", "port", "vn-bentre", ["rice", "coconut"], 1200000],
    ["An Giang Milling Complex", "processor", "vn-angiang", ["rice"], 88000],
    ["Sóc Trăng Sugar Refinery", "processor", "vn-soctrang", ["sugarcane"], 42000],
    ["Manila North Harbor", "port", "ph-bulacan", ["rice", "sugarcane"], 640000],
    ["Nueva Ecija NFA Warehouse", "warehouse", "ph-nuevaecija", ["rice", "onion"], 54000],
    ["Pampanga Sugar Central", "processor", "ph-pampanga", ["sugarcane"], 36000],
    ["Paradip Port", "port", "in-jagatsinghpur", ["rice", "jute"], 980000],
    ["Kendrapara FCI Godown", "warehouse", "in-kendrapara", ["rice"], 31000],
    ["Balasore Agro Processing Park", "processor", "in-balasore", ["rice", "vegetables"], 22000],
    ["Tanjung Emas Port", "port", "id-semarang", ["rice", "sugarcane"], 560000],
    ["Demak Bulog Warehouse", "warehouse", "id-demak", ["rice"], 40000],
    ["Indramayu Rice Mill", "processor", "id-indramayu", ["rice"], 47000],
    ["Jakarta Wholesale Market (Cipinang)", "retailer", "id-indramayu", ["rice", "vegetables"], 30000],
  ];
  const nodes: SupplyNodeRecord[] = NODE_DEFS.map(([name, type, did, comms, cap], i) => {
    const d = districts.find((x) => x.id === did)!;
    const floodRisk = Math.round(Math.min(97, d.floodRisk + between(rng, -12, 8)));
    const salinityRisk = Math.round(Math.min(95, d.salinityRisk + between(rng, -15, 5)));
    return {
      id: `node-${(i + 1).toString().padStart(2, "0")}`,
      orgId: i % 3 === 1 && d.country === "VN" ? "org-sc-mekongfoods" : "org-sc-asiagrain",
      name,
      type,
      districtId: did,
      country: d.countryName,
      lat: round(d.lat + between(rng, -0.08, 0.08), 4),
      lon: round(d.lon + between(rng, -0.08, 0.08), 4),
      capacityTonnes: cap,
      utilizationPct: round(between(rng, 48, 94), 0),
      primaryCommodities: comms,
      floodRisk,
      salinityRisk,
      riskScore: Math.round(floodRisk * 0.65 + salinityRisk * 0.35 * (comms.includes("rice") ? 1 : 0.6)),
    };
  });
  const flows: SupplyFlowRecord[] = [];
  const link = (from: number, to: number, commodity: string, t: number) =>
    flows.push({ id: id("flw"), from: `node-${from.toString().padStart(2, "0")}`, to: `node-${to.toString().padStart(2, "0")}`, commodity, tonnesPerWeek: t });
  link(3, 1, "rice", 4200); link(4, 2, "jute", 1800); link(5, 2, "vegetables", 600); link(6, 3, "rice", 1400);
  link(9, 7, "rice", 6800); link(7, 8, "rice", 9200); link(10, 8, "sugarcane", 2100);
  link(12, 11, "rice", 3100); link(13, 11, "sugarcane", 1700);
  link(15, 14, "rice", 2600); link(16, 14, "rice", 1900);
  link(18, 17, "rice", 2300); link(19, 20, "rice", 2800); link(19, 17, "rice", 1500);
  link(8, 11, "rice", 5400); link(8, 17, "rice", 4700); link(1, 14, "jute", 900);

  const COMMODITIES: [string, string, number, number, number, number][] = [
    ["rice", "t", 538, 0.82, 0.7, 52000],
    ["wheat", "t", 262, 0.35, 0.25, 8000],
    ["jute", "t", 690, 0.55, 0.4, 7400],
    ["sugarcane", "t", 42, 0.48, 0.55, 18000],
    ["coconut", "t", 1150, 0.25, 0.45, 3200],
    ["vegetables", "t", 410, 0.9, 0.6, 9600],
    ["onion", "t", 460, 0.7, 0.5, 2600],
    ["maize", "t", 218, 0.6, 0.45, 6100],
  ];
  const commodities: CommodityRecord[] = COMMODITIES.map(([commodity, unit, base, fs, ss, vol]) => {
    let p = base;
    return {
      commodity,
      unit,
      basePriceUsd: base,
      producingDistricts: districts.filter((d) => d.primaryCrops.includes(commodity) || (commodity === "wheat" && d.country === "IN") || (commodity === "maize" && d.country === "PH")).map((d) => d.id),
      floodSensitivity: fs,
      salinitySensitivity: ss,
      weeklyVolumeTonnes: vol,
      priceHistory: Array.from({ length: 26 }, (_, w) => {
        p = p * (1 + between(rng, -0.025, 0.03));
        return { date: new Date(now.getTime() - (25 - w) * 7 * DAY).toISOString().slice(0, 10), price: round(p, 0) };
      }),
    };
  });

  const webhooks: WebhookRecord[] = [
    { id: id("whk"), orgId: "org-sc-asiagrain", url: "https://erp.asiagrain.example/hooks/agrishield", commodities: ["rice", "jute"], riskThreshold: 70, events: ["commodity.risk.threshold", "node.flood.warning"], active: true, secret: "whsec_demo_9f2c1e", createdAt: new Date(now.getTime() - 40 * DAY), lastDelivery: { at: new Date(now.getTime() - 2 * HOUR), status: 200 } },
    { id: id("whk"), orgId: "org-sc-asiagrain", url: "https://logistics.asiagrain.example/api/reroute", commodities: ["rice"], riskThreshold: 85, events: ["scenario.critical"], active: false, secret: "whsec_demo_4ab77d", createdAt: new Date(now.getTime() - 12 * DAY), lastDelivery: null },
  ];
  const apiKeys: ApiKeyRecord[] = [
    { id: id("key"), orgId: "org-sc-asiagrain", name: "SAP S/4HANA production", prefix: "ags_live_7Hq2", createdAt: new Date(now.getTime() - 60 * DAY), lastUsed: new Date(now.getTime() - 20 * 60_000), scopes: ["risk:read", "commodities:read"] },
    { id: id("key"), orgId: "org-sc-asiagrain", name: "Data science sandbox", prefix: "ags_test_Pk91", createdAt: new Date(now.getTime() - 9 * DAY), lastUsed: new Date(now.getTime() - 3 * DAY), scopes: ["risk:read", "scenarios:run"] },
  ];

  const audit: AuditRecord[] = [];
  const auditActs = [
    ["alert.create", "climate_alert"], ["resource.approve", "resource_request"], ["resource.dispatch", "resource_request"],
    ["user.update", "user"], ["org.verify", "organization"], ["webhook.create", "webhook"], ["flag.toggle", "feature_flag"],
  ] as const;
  for (let i = 0; i < 60; i++) {
    const [action, entity] = pick(rng, auditActs);
    const u = pick(rng, users.filter((x) => x.role !== "farmer"));
    audit.push({ id: id("aud"), at: new Date(now.getTime() - intBetween(rng, 1, 720) * HOUR), userId: u.id, userName: u.name, action, entity, entityId: id(entity.slice(0, 3)), details: `${action} via dashboard` });
  }
  audit.sort((a, b) => b.at.getTime() - a.at.getTime());

  const flags: FeatureFlagRecord[] = [
    { key: "voice_input", description: "Web Speech voice input in AI Advisor", enabled: true, rolloutPct: 100 },
    { key: "camera_disease", description: "MobileNet crop disease scanner (beta)", enabled: false, rolloutPct: 0 },
    { key: "whatsapp_rich_cards", description: "WhatsApp interactive alert cards", enabled: true, rolloutPct: 60 },
    { key: "lstm_flood_v3", description: "Shadow-deploy flood LSTM v3 alongside v2.3", enabled: true, rolloutPct: 10 },
    { key: "auto_escalation", description: "Auto-escalate alert severity at T+6h if risk rises", enabled: true, rolloutPct: 100 },
    { key: "referral_rewards", description: "Farmer referral → Pro unlocks", enabled: true, rolloutPct: 100 },
  ];

  const PLAN_MRR: Record<SubscriptionPlan, number> = { free: 0, farmer_pro: 3, gov_basic: 299, gov_enterprise: 2400, supply_chain: 499 };
  const subscriptions: SubscriptionRecord[] = [
    ...users.filter((u) => u.role === "farmer").map((u) => ({ id: id("sub"), userId: u.id, orgId: null, plan: u.subscriptionTier, status: (rng() > 0.93 ? "past_due" : "active") as SubscriptionRecord["status"], mrrUsd: PLAN_MRR[u.subscriptionTier], currentPeriodEnd: new Date(now.getTime() + intBetween(rng, 1, 30) * DAY), provider: (u.subscriptionTier === "free" ? "none" : "razorpay") as SubscriptionRecord["provider"] })),
    ...orgs.map((o) => ({ id: id("sub"), userId: null, orgId: o.id, plan: o.planTier, status: (o.verified ? "active" : "trialing") as SubscriptionRecord["status"], mrrUsd: o.verified ? PLAN_MRR[o.planTier] : 0, currentPeriodEnd: new Date(now.getTime() + intBetween(rng, 1, 30) * DAY), provider: (o.country === "Philippines" ? "paymongo" : "stripe") as SubscriptionRecord["provider"] })),
  ];

  return {
    seededAt: now,
    users,
    orgs,
    districts,
    farmers,
    fields,
    alerts,
    recommendations,
    farmerActions,
    inventory,
    resourceRequests,
    nodes,
    flows,
    commodities,
    webhooks,
    apiKeys,
    audit,
    flags,
    subscriptions,
    counters: { n, farmersProtectedToday: 15_284, smsSentToday: 3_912 },
    scenario: { mode: (process.env.AGRI_SCENARIO as ScenarioMode) || "live", intensity: 0.7, setAt: now, setBy: "system" },
  };
}

// ─── Singleton access ─────────────────────────────────────────────────────

const g = globalThis as unknown as { __agriStore?: Store };

export function getStore(): Store {
  if (!g.__agriStore) g.__agriStore = seed();
  return g.__agriStore;
}

/** Reset demo data (spec: "reset daily"). */
export function resetStore(): Store {
  g.__agriStore = seed();
  return g.__agriStore;
}

export function nextId(prefix: string): string {
  const s = getStore();
  s.counters.n = (s.counters.n ?? 0) + 1;
  return makeId(prefix, s.counters.n) + Date.now().toString(36).slice(-3);
}

export function audit(entry: Omit<AuditRecord, "id" | "at">) {
  const s = getStore();
  s.audit.unshift({ ...entry, id: nextId("aud"), at: new Date() });
  if (s.audit.length > 500) s.audit.length = 500;
}

export { DAY, HOUR };
