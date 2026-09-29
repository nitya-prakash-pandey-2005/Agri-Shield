/**
 * Seeds the multi-tenant workspace layer: enterprise tenants, their monitored
 * assets (insured plots, agri loans, facilities, communities), alert rules and
 * in-app notifications. Kept separate from store.ts so it can evolve
 * independently (e.g. land-validated coordinates, real reference data).
 */
import type { AssetType, CropType, Industry } from "@agri-shield/types";
import type { DistrictRecord } from "./store";
import type { SupplyNodeRecord } from "./store";
import { between, intBetween, pick, round, type Rng } from "./prng";

// ─── Record types (re-exported from store.ts) ─────────────────────────────

export interface WorkspaceSettings {
  units: "metric" | "imperial";
  timezone: string;
  currency: string;
  locale: string;
  defaultCenter: [number, number];
  defaultZoom: number;
  /** Composite score (0-100) above which an asset counts as "at risk" on dashboards */
  riskThreshold: number;
  weeklyDigest: boolean;
}

export interface WorkspaceUsage {
  periodStart: Date;
  assessments: number;
  apiCalls: number;
  reports: number;
  messages: number;
}

export interface AssetAssessment {
  at: Date;
  floodRisk: number; // 0-100 (72h probability x100)
  salinityRisk: number; // 0-100
  droughtRisk: number; // 0-100
  heatRisk: number; // 0-100
  composite: number; // 0-100
  level: "low" | "medium" | "high" | "critical";
  drivers: string[];
  source: string;
}

export interface AssetRecord {
  id: string;
  workspaceId: string;
  type: AssetType;
  name: string;
  /** Customer's own reference (policy no., loan account, site code) */
  externalRef: string | null;
  lat: number;
  lon: number;
  address: string | null;
  districtId: string | null;
  country: string;
  areaHa: number | null;
  crop: CropType | null;
  /** Financial exposure in USD (sum insured, loan outstanding, stock value, replacement cost) */
  valueUsd: number;
  tags: string[];
  meta: Record<string, string | number | boolean | null>;
  status: "active" | "archived";
  createdAt: Date;
  createdBy: string;
  lastAssessment: AssetAssessment | null;
  history: { date: string; composite: number }[];
}

export type RuleMetric =
  | "flood_prob_72h"
  | "flood_prob_24h"
  | "salinity_ec"
  | "composite"
  | "rain_24h_mm"
  | "rain_72h_mm"
  | "drought_risk"
  | "heat_risk"
  | "river_discharge_ratio";

export interface AlertRuleRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: { assetIds?: string[]; tags?: string[]; types?: AssetType[]; countries?: string[] };
  conditions: { metric: RuleMetric; op: ">" | ">=" | "<" | "<="; value: number }[];
  match: "all" | "any";
  severity: "info" | "warning" | "critical";
  channels: ("app" | "email" | "sms" | "whatsapp" | "webhook" | "slack")[];
  recipients: string[];
  webhookUrl: string | null;
  cooldownHours: number;
  lastTriggeredAt: Date | null;
  triggerCount: number;
  createdBy: string;
  createdAt: Date;
}

export interface NotificationRecord {
  id: string;
  workspaceId: string | null;
  /** null = every member of the workspace */
  userId: string | null;
  kind: "alert" | "rule" | "system" | "report" | "billing" | "team";
  title: string;
  body: string;
  href: string | null;
  severity: "info" | "success" | "warning" | "critical";
  createdAt: Date;
  readBy: string[];
}

// ─── Tenants ──────────────────────────────────────────────────────────────

export const INDUSTRY_BY_ORG: Record<string, Industry> = {
  "org-sc-asiagrain": "agribusiness",
  "org-sc-mekongfoods": "agribusiness",
  "org-ngo-brac": "ngo",
  "org-ins-deltamutual": "insurance",
  "org-bank-mekong": "banking",
  "org-coop-odisha": "cooperative",
};

export const ENTERPRISE_ORGS = [
  { id: "org-ins-deltamutual", name: "Delta Mutual Agri Insurance Ltd", shortName: "Delta Mutual", type: "insurance" as const, country: "Bangladesh", region: "Bangladesh & Eastern India", planTier: "business" as const, currency: "BDT", locale: "en-BD", timezone: "Asia/Dhaka", center: [22.9, 89.9] as [number, number], zoom: 7 },
  { id: "org-bank-mekong", name: "Mekong Rural Credit Bank", shortName: "MRCB", type: "bank" as const, country: "Vietnam", region: "Mekong Delta & Central Luzon", planTier: "enterprise" as const, currency: "VND", locale: "vi-VN", timezone: "Asia/Ho_Chi_Minh", center: [10.1, 105.8] as [number, number], zoom: 8 },
  { id: "org-coop-odisha", name: "Mahanadi Farmers Producer Co-operative", shortName: "Mahanadi FPC", type: "cooperative" as const, country: "India", region: "Odisha coast", planTier: "business" as const, currency: "INR", locale: "en-IN", timezone: "Asia/Kolkata", center: [20.4, 86.3] as [number, number], zoom: 8 },
];

export const ENTERPRISE_USERS = [
  { id: "user-insurer-demo", email: "insurer@demo.agrishield.io", name: "Arif Rahman", title: "Head of Agri Underwriting", role: "enterprise_admin" as const, orgId: "org-ins-deltamutual", language: "en" as const },
  { id: "user-insurer-analyst", email: "claims@demo.agrishield.io", name: "Sharmin Akter", title: "Claims Analyst", role: "enterprise_analyst" as const, orgId: "org-ins-deltamutual", language: "bn" as const },
  { id: "user-bank-demo", email: "bank@demo.agrishield.io", name: "Trần Minh Khoa", title: "Chief Risk Officer", role: "enterprise_admin" as const, orgId: "org-bank-mekong", language: "en" as const },
  { id: "user-bank-analyst", email: "credit@demo.agrishield.io", name: "Nguyễn Thị Lan", title: "Credit Risk Analyst", role: "enterprise_analyst" as const, orgId: "org-bank-mekong", language: "vi" as const },
  { id: "user-ngo-demo", email: "ngo@demo.agrishield.io", name: "Tahmina Sultana", title: "Anticipatory Action Lead", role: "enterprise_admin" as const, orgId: "org-ngo-brac", language: "en" as const },
  { id: "user-coop-demo", email: "coop@demo.agrishield.io", name: "Sanjay Mohapatra", title: "CEO", role: "enterprise_admin" as const, orgId: "org-coop-odisha", language: "en" as const },
];

// ─── Assets ───────────────────────────────────────────────────────────────

const HA_PRICE_USD: Partial<Record<CropType, number>> = { rice: 1150, jute: 950, sugarcane: 2600, coconut: 3100, vegetables: 2400, maize: 900, onion: 2200, mango: 3600, wheat: 850 };

const VILLAGES: Record<string, string[]> = {
  BD: ["Char Kukri-Mukri", "Gabura", "Padmapukur", "Dacope", "Koyra", "Shyamnagar", "Kalapara", "Rangabali", "Morrelganj", "Sarankhola", "Mongla", "Bhola Sadar"],
  VN: ["Thạnh Phú", "Ba Tri", "Bình Đại", "Trần Đề", "Cù Lao Dung", "Năm Căn", "Ngọc Hiển", "Phú Tân", "Châu Đốc", "Tân Châu"],
  PH: ["Masantol", "Macabebe", "Hagonoy", "Calumpit", "Paombong", "Candaba", "San Luis", "Minalin"],
  IN: ["Mahakalapada", "Rajnagar", "Ersama", "Kujang", "Astaranga", "Chandbali", "Bhitarkanika", "Balikuda"],
  ID: ["Sayung", "Bedono", "Wedung", "Karangtengah", "Tirto", "Wonokerto", "Cantigi", "Losarang"],
};

const jitter = (rng: Rng, v: number, d: number) => round(v + between(rng, -d, d), 5);

export function seedAssets(rng: Rng, districts: DistrictRecord[], nodes: SupplyNodeRecord[], now: Date): AssetRecord[] {
  const assets: AssetRecord[] = [];
  let n = 0;
  const DAY = 86_400_000;
  const base = (over: Partial<AssetRecord> & Pick<AssetRecord, "workspaceId" | "type" | "name" | "lat" | "lon" | "country" | "valueUsd">): AssetRecord => ({
    id: `ast_${(++n).toString(36).padStart(4, "0")}`,
    externalRef: null,
    address: null,
    districtId: null,
    areaHa: null,
    crop: null,
    tags: [],
    meta: {},
    status: "active",
    createdAt: new Date(now.getTime() - intBetween(rng, 5, 300) * DAY),
    createdBy: "import",
    lastAssessment: null,
    history: [],
    ...over,
  });
  const inCountry = (codes: string[]) => districts.filter((d) => codes.includes(d.country));

  // Delta Mutual — 140 insured paddy/jute plots (area-yield index + indemnity policies)
  for (const [i, d] of Array.from({ length: 140 }, (_, i) => [i, pick(rng, inCountry(["BD", "IN"]))] as const)) {
    const crop = pick(rng, d.primaryCrops.filter((c) => c !== "coconut").concat("rice")) as CropType;
    const areaHa = round(between(rng, 0.4, 4.5), 1);
    const product = rng() > 0.45 ? "Weather-index (rainfall)" : rng() > 0.4 ? "Area-yield index" : "Indemnity (MPCI)";
    assets.push(
      base({
        workspaceId: "org-ins-deltamutual",
        type: "insured_plot",
        name: `${pick(rng, VILLAGES[d.country]!)} plot ${String(i + 1).padStart(3, "0")}`,
        externalRef: `DMA-${d.country}-${2026}${String(10000 + i * 7).padStart(5, "0")}`,
        lat: jitter(rng, d.lat, 0.07),
        lon: jitter(rng, d.lon, 0.07),
        districtId: d.id,
        country: d.countryName,
        areaHa,
        crop,
        valueUsd: Math.round(areaHa * (HA_PRICE_USD[crop] ?? 1000) * between(rng, 0.7, 1.0)),
        tags: [crop, product.startsWith("Weather") ? "parametric" : "indemnity", d.salinityExposure > 0.6 ? "coastal" : "inland"],
        meta: { product, season: "Aman 2026", premiumUsd: 0, deductiblePct: product.startsWith("Indemnity") ? 20 : 0, farmerName: null },
      })
    );
    const last = assets[assets.length - 1]!;
    last.meta.premiumUsd = Math.round(last.valueUsd * (product.startsWith("Weather") ? 0.045 : 0.06));
  }

  // Mekong Rural Credit Bank — 160 agricultural loans (VN + PH)
  const tenors = [6, 9, 12, 18, 24];
  for (let i = 0; i < 160; i++) {
    const d = pick(rng, inCountry(["VN", "PH"]));
    const crop = pick(rng, d.primaryCrops) as CropType;
    const principal = Math.round(between(rng, 800, 18000) / 50) * 50;
    const outstanding = Math.round(principal * between(rng, 0.35, 1));
    assets.push(
      base({
        workspaceId: "org-bank-mekong",
        type: "loan",
        name: `${crop === "coconut" ? "Coconut orchard" : crop === "sugarcane" ? "Sugarcane" : crop === "rice" ? "Rice" : "Horticulture"} loan · ${pick(rng, VILLAGES[d.country]!)}`,
        externalRef: `MRCB-${d.country}-${String(700000 + i * 13)}`,
        lat: jitter(rng, d.lat, 0.08),
        lon: jitter(rng, d.lon, 0.08),
        districtId: d.id,
        country: d.countryName,
        areaHa: round(between(rng, 0.5, 6), 1),
        crop,
        valueUsd: outstanding,
        tags: [crop, principal > 10000 ? "sme" : "smallholder", pick(rng, ["crop-loan", "crop-loan", "equipment", "working-capital"])],
        meta: {
          principalUsd: principal,
          tenorMonths: pick(rng, tenors),
          interestRatePct: round(between(rng, 6.5, 11.5), 1),
          daysPastDue: rng() > 0.9 ? intBetween(rng, 5, 95) : 0,
          internalRating: pick(rng, ["A", "BBB", "BBB", "BB", "BB", "B"]),
          collateral: pick(rng, ["Land-use certificate", "Group guarantee", "Machinery", "None"]),
        },
      })
    );
  }

  // AsiaGrain — its physical facilities mirror the supply-chain nodes
  for (const node of nodes.filter((x) => x.orgId === "org-sc-asiagrain")) {
    const d = districts.find((x) => x.id === node.districtId);
    assets.push(
      base({
        workspaceId: "org-sc-asiagrain",
        type: node.type === "port" ? "port" : node.type === "processor" ? "processing_plant" : node.type === "retailer" ? "retail_outlet" : "warehouse",
        name: node.name,
        externalRef: node.id.toUpperCase(),
        lat: node.lat,
        lon: node.lon,
        districtId: node.districtId,
        country: node.country,
        valueUsd: Math.round(node.capacityTonnes * (node.type === "port" ? 45 : 180) * between(rng, 0.8, 1.2)),
        tags: [...node.primaryCommodities, node.type],
        meta: { capacityTonnes: node.capacityTonnes, utilizationPct: node.utilizationPct, basin: d?.basin ?? null },
      })
    );
  }

  // Delta Resilience Foundation — 48 at-risk coastal communities (anticipatory action)
  for (let i = 0; i < 48; i++) {
    const d = pick(rng, inCountry(["BD"]));
    const households = intBetween(rng, 180, 2400);
    assets.push(
      base({
        workspaceId: "org-ngo-brac",
        type: "community",
        name: `${pick(rng, VILLAGES.BD!)} ${pick(rng, ["Union", "Ward", "Char", "Para"])} ${i + 1}`,
        externalRef: `DRF-COM-${String(i + 1).padStart(3, "0")}`,
        lat: jitter(rng, d.lat, 0.09),
        lon: jitter(rng, d.lon, 0.09),
        districtId: d.id,
        country: d.countryName,
        valueUsd: households * 85, // pre-arranged cash transfer envelope (USD 85/household)
        tags: [d.salinityExposure > 0.7 ? "salinity-hotspot" : "flood-plain", households > 1200 ? "large" : "small"],
        meta: { households, population: Math.round(households * 4.3), cashPerHouseholdUsd: 85, femaleHeadedPct: intBetween(rng, 12, 34), cycloneShelterKm: round(between(rng, 0.6, 7.5), 1) },
      })
    );
  }

  // Mahanadi FPC — 90 member farms on the Odisha coast
  for (let i = 0; i < 90; i++) {
    const d = pick(rng, inCountry(["IN"]));
    const crop = pick(rng, d.primaryCrops) as CropType;
    const areaHa = round(between(rng, 0.3, 2.8), 1);
    assets.push(
      base({
        workspaceId: "org-coop-odisha",
        type: "farm",
        name: `Member farm ${String(i + 1).padStart(3, "0")} · ${pick(rng, VILLAGES.IN!)}`,
        externalRef: `MFPC-${String(2000 + i)}`,
        lat: jitter(rng, d.lat, 0.07),
        lon: jitter(rng, d.lon, 0.07),
        districtId: d.id,
        country: d.countryName,
        areaHa,
        crop,
        valueUsd: Math.round(areaHa * (HA_PRICE_USD[crop] ?? 1000)),
        tags: [crop, rng() > 0.7 ? "organic" : "conventional"],
        meta: { memberSince: 2016 + intBetween(rng, 0, 9), irrigation: pick(rng, ["canal", "tubewell", "rainfed", "rainfed"]) },
      })
    );
  }

  // 30-day composite history so dashboards have trend lines from day one
  for (const a of assets) {
    const d = districts.find((x) => x.id === a.districtId);
    const baseScore = d ? Math.max(d.floodExposure, d.salinityExposure * 0.9) * 55 : 30;
    let v = baseScore + between(rng, -10, 10);
    a.history = Array.from({ length: 30 }, (_, k) => {
      v = Math.min(95, Math.max(3, v + between(rng, -4, 4)));
      return { date: new Date(now.getTime() - (29 - k) * DAY).toISOString().slice(0, 10), composite: Math.round(v) };
    });
  }
  return assets;
}

export function seedAlertRules(now: Date): AlertRuleRecord[] {
  const d = (h: number) => new Date(now.getTime() - h * 3_600_000);
  return [
    { id: "rule_001", workspaceId: "org-ins-deltamutual", name: "Parametric trigger watch — heavy rain", description: "Warn underwriting when 72h rainfall on any parametric policy approaches the 150 mm payout trigger.", enabled: true, scope: { tags: ["parametric"] }, conditions: [{ metric: "rain_72h_mm", op: ">=", value: 120 }], match: "all", severity: "warning", channels: ["app", "email"], recipients: ["insurer@demo.agrishield.io"], webhookUrl: null, cooldownHours: 12, lastTriggeredAt: d(30), triggerCount: 7, createdBy: "user-insurer-demo", createdAt: d(900) },
    { id: "rule_002", workspaceId: "org-ins-deltamutual", name: "Flood exposure — coastal book", description: "Escalate when flood probability exceeds 60% on coastal plots.", enabled: true, scope: { tags: ["coastal"] }, conditions: [{ metric: "flood_prob_72h", op: ">", value: 60 }], match: "all", severity: "critical", channels: ["app", "email", "sms"], recipients: ["insurer@demo.agrishield.io", "claims@demo.agrishield.io"], webhookUrl: null, cooldownHours: 24, lastTriggeredAt: null, triggerCount: 2, createdBy: "user-insurer-demo", createdAt: d(700) },
    { id: "rule_003", workspaceId: "org-bank-mekong", name: "Salinity stress on rice borrowers", description: "Flag rice loans where soil EC is forecast above the rice tolerance threshold.", enabled: true, scope: { tags: ["rice"] }, conditions: [{ metric: "salinity_ec", op: ">", value: 3 }], match: "all", severity: "warning", channels: ["app", "email"], recipients: ["credit@demo.agrishield.io"], webhookUrl: null, cooldownHours: 48, lastTriggeredAt: d(120), triggerCount: 11, createdBy: "user-bank-demo", createdAt: d(1500) },
    { id: "rule_004", workspaceId: "org-bank-mekong", name: "Portfolio composite > 70", description: "Any loan whose composite climate score crosses 70.", enabled: true, scope: {}, conditions: [{ metric: "composite", op: ">", value: 70 }], match: "all", severity: "critical", channels: ["app", "webhook"], recipients: [], webhookUrl: "https://core-banking.mrcb.example/hooks/climate", cooldownHours: 24, lastTriggeredAt: null, triggerCount: 0, createdBy: "user-bank-demo", createdAt: d(400) },
    { id: "rule_005", workspaceId: "org-ngo-brac", name: "Anticipatory action — flood readiness", description: "Pre-alert field teams when 72h flood probability > 50% for any community.", enabled: true, scope: { types: ["community"] }, conditions: [{ metric: "flood_prob_72h", op: ">", value: 50 }], match: "all", severity: "critical", channels: ["app", "sms", "whatsapp"], recipients: ["ngo@demo.agrishield.io"], webhookUrl: null, cooldownHours: 24, lastTriggeredAt: d(300), triggerCount: 3, createdBy: "user-ngo-demo", createdAt: d(200) },
    { id: "rule_006", workspaceId: "org-sc-asiagrain", name: "Port/warehouse flood exposure", description: "Notify logistics when a facility's flood probability > 55%.", enabled: true, scope: { types: ["port", "warehouse"] }, conditions: [{ metric: "flood_prob_72h", op: ">", value: 55 }], match: "all", severity: "warning", channels: ["app", "slack"], recipients: [], webhookUrl: null, cooldownHours: 12, lastTriggeredAt: null, triggerCount: 0, createdBy: "user-supply-demo", createdAt: d(500) },
  ];
}

export function seedNotifications(now: Date): NotificationRecord[] {
  const d = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const n = (id: number, ws: string, kind: NotificationRecord["kind"], severity: NotificationRecord["severity"], title: string, body: string, href: string | null, h: number): NotificationRecord => ({ id: `ntf_${id}`, workspaceId: ws, userId: null, kind, title, body, href, severity, createdAt: d(h), readBy: [] });
  return [
    n(1, "org-ins-deltamutual", "system", "success", "Weekly portfolio re-score complete", "140 insured plots re-assessed against the latest forecast and satellite data.", "/app/portfolio", 3),
    n(2, "org-ins-deltamutual", "rule", "warning", "Parametric trigger watch fired", "7 plots in Satkhira are within 25 mm of the rainfall payout trigger.", "/app/alerts", 30),
    n(3, "org-bank-mekong", "rule", "warning", "Salinity stress on rice borrowers", "11 rice loans in Bến Tre and Sóc Trăng are forecast above 3 dS/m.", "/app/alerts", 120),
    n(4, "org-bank-mekong", "report", "info", "Q3 physical-risk disclosure ready", "Your TCFD/ISSB-aligned physical climate risk report was generated.", "/app/reports", 50),
    n(5, "org-ngo-brac", "system", "info", "Welcome to Agri-SHIELD", "Start by reviewing the 48 communities imported from your programme database.", "/app/portfolio", 90),
    n(6, "org-sc-asiagrain", "team", "info", "Wei Lin Tan joined the workspace", "Supply Chain Admin", "/app/settings/team", 200),
  ];
}
