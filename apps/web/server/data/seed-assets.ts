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
import fxSnapshot from "./real/fx-snapshot.json";
import { AGRI, countryStats, landPoints, loanSize, productionCostUsdHa } from "./real";
import { logNormal } from "./real/sampling";

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
  | "river_discharge_ratio"
  // Ground-truth from linked IoT sensors (null when no fresh, healthy reading)
  | "sensor_water_level_m"
  | "sensor_water_rise_6h_m"
  | "sensor_soil_ec"
  | "sensor_soil_moisture";

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

/**
 * Gross output value per ha for non-rice crops ≈ cost of cultivation × 1.6 (typical smallholder
 * value/cost ratio); rice uses FAOSTAT paddy yield × national farm-gate price (real/agri-reference.json).
 */
function grossValueUsdHa(country: string, crop: CropType): number {
  if (crop === "rice") {
    const s = countryStats(country);
    return s.paddyYieldTHa * s.paddyFarmgateUsdT;
  }
  return productionCostUsdHa(country, crop) * 1.6;
}

const VILLAGES: Record<string, string[]> = {
  BD: ["Char Kukri-Mukri", "Gabura", "Padmapukur", "Dacope", "Koyra", "Shyamnagar", "Kalapara", "Rangabali", "Morrelganj", "Sarankhola", "Mongla", "Bhola Sadar"],
  VN: ["Thạnh Phú", "Ba Tri", "Bình Đại", "Trần Đề", "Cù Lao Dung", "Năm Căn", "Ngọc Hiển", "Phú Tân", "Châu Đốc", "Tân Châu"],
  PH: ["Masantol", "Macabebe", "Hagonoy", "Calumpit", "Paombong", "Candaba", "San Luis", "Minalin"],
  IN: ["Mahakalapada", "Rajnagar", "Ersama", "Kujang", "Astaranga", "Chandbali", "Bhitarkanika", "Balikuda"],
  ID: ["Sayung", "Bedono", "Wedung", "Karangtengah", "Tirto", "Wonokerto", "Cantigi", "Losarang"],
};

/**
 * Deterministic walk over each district's land-validated points (real/land-points.json: inside the
 * real admin boundary, on dry land per SRTM-based DEM elevation + JRC surface-water occurrence).
 * Stride 7 is coprime with the 144-point pools, so points repeat only after the whole pool is used.
 */
function landWalker(rng: Rng) {
  const cursor = new Map<string, number>();
  return (d: DistrictRecord): [number, number] => {
    const pts = landPoints(d.id);
    if (!pts.length) return [round(d.lat + between(rng, -0.03, 0.03), 5), round(d.lon + between(rng, -0.03, 0.03), 5)];
    const c = cursor.get(d.id) ?? intBetween(rng, 0, pts.length - 1);
    cursor.set(d.id, c + 7);
    const p = pts[c % pts.length]!;
    return [p[0], p[1]];
  };
}

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
  const at = landWalker(rng);
  const PREM = AGRI.insurancePremiumPct;

  // Delta Mutual — 140 insured units. Index insurance in South Asia is written as group
  // policies through aggregators (MFIs, co-operatives, input dealers): one insured unit =
  // one village cluster of smallholders sharing a contract, index and trigger.
  for (const [i, d] of Array.from({ length: 140 }, (_, i) => [i, pick(rng, inCountry(["BD", "IN"]))] as const)) {
    const crop = pick(rng, d.primaryCrops.filter((c) => c !== "coconut").concat("rice")) as CropType;
    // Plot size ~ log-normal around the census mean farm size (BD ≈ 0.5 ha, Odisha ≈ 0.95 ha)
    const avg = countryStats(d.country).avgFarmHa;
    const plotHa = logNormal(rng, avg * 0.9, 0.5, 0.1, avg * 5);
    const farmersCovered = Math.round(logNormal(rng, 260, 0.6, 40, 1200));
    const areaHa = round(plotHa * farmersCovered, 1);
    const channel = pick(rng, ["MFI group policy", "MFI group policy", "Co-operative group policy", "Input-dealer bundle", "Loan-linked (bank)"]);
    const product = rng() > 0.45 ? "Weather-index (rainfall)" : rng() > 0.4 ? "Area-yield index" : "Indemnity (MPCI)";
    const [lat, lon] = at(d);
    // Sum insured = cost of cultivation (PMFBY-style scale of finance); premium rate rises with flood exposure
    const [lo, hi] = product.startsWith("Weather") ? PREM.weatherIndex : product.startsWith("Area") ? PREM.areaYield : PREM.indemnity;
    const premiumRatePct = round(lo + (hi - lo) * Math.min(1, Math.max(0, (d.floodExposure - 0.5) / 0.4)) + between(rng, -0.3, 0.3), 1);
    assets.push(
      base({
        workspaceId: "org-ins-deltamutual",
        type: "insured_plot",
        name: `${pick(rng, VILLAGES[d.country]!)} unit ${String(i + 1).padStart(3, "0")}`,
        externalRef: `DMA-${d.country}-${2026}${String(10000 + i * 7).padStart(5, "0")}`,
        lat,
        lon,
        districtId: d.id,
        country: d.countryName,
        areaHa,
        crop,
        valueUsd: Math.max(400, Math.round(areaHa * productionCostUsdHa(d.country, crop) * between(rng, 0.9, 1.05))),
        tags: [crop, product.startsWith("Weather") ? "parametric" : "indemnity", d.salinityExposure > 0.6 ? "coastal" : "inland"],
        meta: { product, season: d.country === "IN" ? "Kharif 2026" : "Aman 2026", premiumUsd: 0, premiumRatePct, sumInsuredBasis: "cost of cultivation", deductiblePct: product.startsWith("Indemnity") ? 20 : 0, farmersCovered, avgPlotHa: round(plotHa, 2), channel, farmerName: null },
      })
    );
    const last = assets[assets.length - 1]!;
    last.meta.premiumUsd = Math.max(1, Math.round((last.valueUsd * premiumRatePct) / 100));
  }

  // Mekong Rural Credit Bank — 160 agricultural loans (VN + PH)
  const tenors = [6, 9, 12, 18, 24];
  for (let i = 0; i < 160; i++) {
    const d = pick(rng, inCountry(["VN", "PH"]));
    const crop = pick(rng, d.primaryCrops) as CropType;
    // Loan size ~ log-normal around typical VN (≈ VND 100 M) / PH (≈ PHP 100k) smallholder production loans
    const size = loanSize(d.country);
    const principal = Math.round(logNormal(rng, size.median, 0.7, size.min, size.max) / 50) * 50;
    const outstanding = Math.round(principal * between(rng, 0.35, 1));
    const [rLo, rHi] = countryStats(d.country).loanRatePct;
    const [lat, lon] = at(d);
    assets.push(
      base({
        workspaceId: "org-bank-mekong",
        type: "loan",
        name: `${crop === "coconut" ? "Coconut orchard" : crop === "sugarcane" ? "Sugarcane" : crop === "rice" ? "Rice" : "Horticulture"} loan · ${pick(rng, VILLAGES[d.country]!)}`,
        externalRef: `MRCB-${d.country}-${String(700000 + i * 13)}`,
        lat,
        lon,
        districtId: d.id,
        country: d.countryName,
        areaHa: round(logNormal(rng, countryStats(d.country).avgFarmHa, 0.5, 0.2, 8), 2),
        crop,
        valueUsd: outstanding,
        tags: [crop, principal > 10000 ? "sme" : "smallholder", pick(rng, ["crop-loan", "crop-loan", "equipment", "working-capital"])],
        meta: {
          principalUsd: principal,
          tenorMonths: pick(rng, tenors),
          interestRatePct: round(between(rng, rLo, rHi), 1),
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

  // Delta Resilience Foundation — 48 at-risk coastal communities (anticipatory action).
  // Cash envelope = WFP/BRAC anticipatory transfer (BDT 5,000/household) at the committed FX snapshot.
  const CASH_PER_HH_USD = Math.round(AGRI.anticipatoryCash.bdtPerHousehold / (fxSnapshot.rates as Record<string, number>).BDT!);
  for (let i = 0; i < 48; i++) {
    const d = pick(rng, inCountry(["BD"]));
    const households = intBetween(rng, 180, 2400);
    const [lat, lon] = at(d);
    assets.push(
      base({
        workspaceId: "org-ngo-brac",
        type: "community",
        name: `${pick(rng, VILLAGES.BD!)} ${pick(rng, ["Union", "Ward", "Char", "Para"])} ${i + 1}`,
        externalRef: `DRF-COM-${String(i + 1).padStart(3, "0")}`,
        lat,
        lon,
        districtId: d.id,
        country: d.countryName,
        valueUsd: households * CASH_PER_HH_USD, // pre-arranged anticipatory cash envelope (BDT 5,000/household)
        tags: [d.salinityExposure > 0.7 ? "salinity-hotspot" : "flood-plain", households > 1200 ? "large" : "small"],
        meta: { households, population: Math.round(households * countryStats("BD").householdSize), cashPerHouseholdUsd: CASH_PER_HH_USD, femaleHeadedPct: intBetween(rng, 12, 34), cycloneShelterKm: round(between(rng, 0.6, 7.5), 1) },
      })
    );
  }

  // Mahanadi FPC — 90 member farms on the Odisha coast
  for (let i = 0; i < 90; i++) {
    const d = pick(rng, inCountry(["IN"]));
    const crop = pick(rng, d.primaryCrops) as CropType;
    // Odisha mean operational holding 0.95 ha (Agriculture Census 2015-16)
    const areaHa = round(logNormal(rng, countryStats("IN").avgFarmHa * 0.9, 0.5, 0.15, 5), 2);
    const [lat, lon] = at(d);
    assets.push(
      base({
        workspaceId: "org-coop-odisha",
        type: "farm",
        name: `Member farm ${String(i + 1).padStart(3, "0")} · ${pick(rng, VILLAGES.IN!)}`,
        externalRef: `MFPC-${String(2000 + i)}`,
        lat,
        lon,
        districtId: d.id,
        country: d.countryName,
        areaHa,
        crop,
        valueUsd: Math.max(40, Math.round(areaHa * grossValueUsdHa(d.country, crop))),
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
    n(1, "org-ins-deltamutual", "system", "success", "Weekly portfolio re-score complete", "140 insured units (≈44,500 farmers) re-assessed against the latest forecast and satellite data.", "/app/portfolio", 3),
    n(2, "org-ins-deltamutual", "rule", "warning", "Parametric trigger watch fired", "7 plots in Satkhira are within 25 mm of the rainfall payout trigger.", "/app/alerts", 30),
    n(3, "org-bank-mekong", "rule", "warning", "Salinity stress on rice borrowers", "11 rice loans in Bến Tre and Sóc Trăng are forecast above 3 dS/m.", "/app/alerts", 120),
    n(4, "org-bank-mekong", "report", "info", "Q3 physical-risk disclosure ready", "Your TCFD/ISSB-aligned physical climate risk report was generated.", "/app/reports", 50),
    n(5, "org-ngo-brac", "system", "info", "Welcome to Agri-SHIELD", "Start by reviewing the 48 communities imported from your programme database.", "/app/portfolio", 90),
    n(6, "org-sc-asiagrain", "team", "info", "Wei Lin Tan joined the workspace", "Supply Chain Admin", "/app/settings/team", 200),
  ];
}
