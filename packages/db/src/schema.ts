/**
 * Agri-SHIELD — PostgreSQL schema (Drizzle ORM)
 * Author: Nitya Prakash Pandey
 *
 * Mirrors spec §3 (PostgreSQL 16 + PostGIS + TimescaleDB + pgvector) and adds
 * the operational tables the platform uses at runtime (webhooks, API keys,
 * audit log, feature flags, supply-chain flows, commodities, inventory,
 * RAG documents, job runs).
 *
 * Spatial columns are real PostGIS `geometry(<Type>, 4326)` columns with GIST
 * indexes. On write they accept a GeoJSON geometry object or an EWKT string
 * (e.g. `SRID=4326;POINT(90.36 22.70)`); on read they return the driver's raw
 * hex EWKB — select `ST_AsGeoJSON(col)` when you need GeoJSON back.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type PgTable,
} from "drizzle-orm/pg-core";

// ─── PostGIS / pgvector custom types ───────────────────────────────────────

export type GeoJSONGeometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

const fmtPos = (p: number[]) => `${p[0]} ${p[1]}`;
const fmtRing = (r: number[][]) => `(${r.map(fmtPos).join(", ")})`;
const fmtPoly = (poly: number[][][]) => `(${poly.map(fmtRing).join(", ")})`;

/** GeoJSON geometry → EWKT (SRID 4326). Exported for seeders/tests. */
export function toEwkt(g: GeoJSONGeometry | string): string {
  if (typeof g === "string") return g.startsWith("SRID=") ? g : `SRID=4326;${g}`;
  switch (g.type) {
    case "Point":
      return `SRID=4326;POINT(${fmtPos(g.coordinates)})`;
    case "Polygon":
      return `SRID=4326;POLYGON${fmtPoly(g.coordinates)}`;
    case "MultiPolygon":
      return `SRID=4326;MULTIPOLYGON(${g.coordinates.map(fmtPoly).join(", ")})`;
  }
}

/** Promote a Polygon to MultiPolygon (government_regions stores MultiPolygon). */
export function asMultiPolygon(g: GeoJSONGeometry): GeoJSONGeometry {
  if (g.type === "MultiPolygon") return g;
  if (g.type === "Polygon") return { type: "MultiPolygon", coordinates: [g.coordinates] };
  throw new Error(`cannot convert ${g.type} to MultiPolygon`);
}

type GeomKind = "Point" | "Polygon" | "MultiPolygon";

const geometry = (name: string, kind: GeomKind) =>
  customType<{ data: GeoJSONGeometry | string; driverData: string }>({
    dataType() {
      return `geometry(${kind}, 4326)`;
    },
    toDriver(value) {
      return toEwkt(value);
    },
    fromDriver(value) {
      return value;
    },
  })(name);

/**
 * pgvector `vector(n)`. The migration that creates `rag_documents` is guarded:
 * when the `vector` extension is unavailable the column falls back to float8[]
 * (same literal format `{…}` vs `[…]` is handled in toDriver/fromDriver).
 */
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value) {
      return `[${value.join(",")}]`;
    },
    fromDriver(value) {
      return String(value)
        .replace(/[[\]{}]/g, "")
        .split(",")
        .filter(Boolean)
        .map(Number);
    },
  })(name);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const pk = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);

// ─── Enums ─────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "farmer",
  "field_officer",
  "regional_admin",
  "national_admin",
  "supply_chain_analyst",
  "supply_chain_admin",
  "platform_admin",
]);
export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "pending_verification"]);
export const orgTypeEnum = pgEnum("org_type", ["government", "supply_chain", "ngo"]);
export const adminLevelEnum = pgEnum("admin_level", ["national", "provincial", "district"]);
export const riskLevelEnum = pgEnum("risk_level", ["low", "medium", "high", "critical"]);
export const alertTypeEnum = pgEnum("alert_type", ["flood", "salinity", "drought", "storm", "frost"]);
export const alertSeverityEnum = pgEnum("alert_severity", ["watch", "warning", "emergency"]);
export const alertSourceEnum = pgEnum("alert_source", ["model", "manual", "gdacs", "eonet"]);
export const alertChannelEnum = pgEnum("alert_channel", ["app", "sms", "whatsapp", "email"]);
export const deliveryStatusEnum = pgEnum("delivery_status", ["queued", "sent", "simulated", "delivered", "failed"]);
export const subscriptionPlanEnum = pgEnum("subscription_plan", ["free", "farmer_pro", "gov_basic", "gov_enterprise", "supply_chain"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["active", "past_due", "cancelled", "trialing"]);
export const paymentProviderEnum = pgEnum("payment_provider", ["stripe", "razorpay", "paymongo", "none"]);
export const resourceTypeEnum = pgEnum("resource_type", ["pumps", "sandbags", "evacuation_buses", "medical", "food_aid"]);
export const resourceStatusEnum = pgEnum("resource_status", ["pending", "approved", "dispatched", "delivered", "rejected"]);
export const requestPriorityEnum = pgEnum("request_priority", ["low", "medium", "high", "critical"]);
export const supplyChainNodeTypeEnum = pgEnum("supply_chain_node_type", ["warehouse", "port", "processor", "retailer"]);
export const supplyChainRiskTypeEnum = pgEnum("supply_chain_risk_type", ["flood_disruption", "salinity_quality", "access_blocked", "storage_damaged"]);
export const recommendationPriorityEnum = pgEnum("recommendation_priority", ["low", "medium", "high", "urgent"]);
export const irrigationTypeEnum = pgEnum("irrigation_type", ["rainfed", "drip", "flood_irrigation", "sprinkler", "canal"]);
export const soilTypeEnum = pgEnum("soil_type", ["clay", "loam", "sandy", "silt", "peat", "chalky"]);
export const floodHistoryEnum = pgEnum("flood_history", ["never", "rarely", "sometimes", "often"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "skipped"]);

// ─── Core tables ───────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: pk(),
    email: varchar("email", { length: 320 }),
    name: varchar("name", { length: 255 }).notNull(),
    role: userRoleEnum("role").notNull().default("farmer"),
    language: varchar("language", { length: 8 }).notNull().default("en"),
    phone: varchar("phone", { length: 32 }),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
    lastActive: timestamp("last_active", { withTimezone: true }).notNull().defaultNow(),
    subscriptionTier: subscriptionPlanEnum("subscription_tier").notNull().default("free"),
    /** bcrypt/argon2 hash for org users; farmers authenticate with OTP only */
    passwordHash: text("password_hash"),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
    uniqueIndex("users_phone_uq").on(t.phone),
    index("users_role_idx").on(t.role),
    index("users_last_active_idx").on(t.lastActive),
  ]
);

export const organizations = pgTable(
  "organizations",
  {
    id: pk(),
    name: varchar("name", { length: 255 }).notNull(),
    shortName: varchar("short_name", { length: 64 }),
    type: orgTypeEnum("type").notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    region: varchar("region", { length: 255 }),
    verified: boolean("verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by"),
    planTier: subscriptionPlanEnum("plan_tier").notNull().default("free"),
    createdAt: createdAt(),
  },
  (t) => [index("orgs_type_idx").on(t.type), index("orgs_verified_idx").on(t.verified), index("orgs_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`)]
);

export const userOrganizations = pgTable(
  "user_organizations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    roleInOrg: varchar("role_in_org", { length: 64 }).notNull(),
    permissions: jsonb("permissions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] }), index("user_orgs_org_idx").on(t.orgId)]
);

export const governmentRegions = pgTable(
  "government_regions",
  {
    id: pk(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** stable slug, e.g. "bd-barisal" */
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    adminLevel: adminLevelEnum("admin_level").notNull().default("district"),
    parentId: uuid("parent_id"),
    geometry: geometry("geometry", "MultiPolygon").notNull(),
    centroid: geometry("centroid", "Point").notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    basin: varchar("basin", { length: 255 }),
    riverName: varchar("river_name", { length: 255 }),
    population: integer("population").notNull().default(0),
    vulnerableAreaHa: doublePrecision("vulnerable_area_ha").notNull().default(0),
    monitoredAreaHa: doublePrecision("monitored_area_ha").notNull().default(0),
    totalFarms: integer("total_farms").notNull().default(0),
    floodExposure: real("flood_exposure").notNull().default(0),
    salinityExposure: real("salinity_exposure").notNull().default(0),
    coastDistanceKm: real("coast_distance_km"),
    historicalFloods: jsonb("historical_floods")
      .$type<{ year: number; month: string; areaHa: number; lossUsd: number; farmsAffected: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("gov_regions_code_uq").on(t.code),
    index("gov_regions_org_idx").on(t.orgId),
    index("gov_regions_geom_gist").using("gist", t.geometry),
  ]
);

export const farmerProfiles = pgTable(
  "farmer_profiles",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    farmName: varchar("farm_name", { length: 255 }).notNull(),
    totalAreaHa: real("total_area_ha").notNull(),
    primaryCrops: text("primary_crops").array().notNull().default(sql`'{}'::text[]`),
    experienceYears: integer("experience_years").notNull().default(0),
    location: geometry("location", "Point").notNull(),
    district: varchar("district", { length: 255 }).notNull(),
    regionId: uuid("region_id").references(() => governmentRegions.id, { onDelete: "set null" }),
    country: varchar("country", { length: 100 }).notNull(),
    floodHistory: floodHistoryEnum("flood_history").notNull().default("never"),
    salinityObserved: boolean("salinity_observed").notNull().default(false),
    hasInsurance: boolean("has_insurance").notNull().default(false),
    referralCode: varchar("referral_code", { length: 32 }),
    referrals: integer("referrals").notNull().default(0),
    notificationPrefs: jsonb("notification_prefs").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("farmer_profiles_user_uq").on(t.userId),
    uniqueIndex("farmer_profiles_referral_uq").on(t.referralCode),
    index("farmer_profiles_region_idx").on(t.regionId),
    index("farmer_profiles_location_gist").using("gist", t.location),
  ]
);

export const farmFields = pgTable(
  "farm_fields",
  {
    id: pk(),
    farmerId: uuid("farmer_id")
      .notNull()
      .references(() => farmerProfiles.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    areaHa: real("area_ha").notNull(),
    cropType: varchar("crop_type", { length: 64 }).notNull(),
    plantingDate: date("planting_date"),
    expectedHarvest: date("expected_harvest"),
    soilType: soilTypeEnum("soil_type"),
    irrigationType: irrigationTypeEnum("irrigation_type"),
    geometry: geometry("geometry", "Polygon").notNull(),
    elevationM: real("elevation_m"),
    ndviScore: real("ndvi_score"),
    ndviHistory: jsonb("ndvi_history").$type<{ date: string; ndvi: number }[]>().notNull().default(sql`'[]'::jsonb`),
    lastSatelliteScan: timestamp("last_satellite_scan", { withTimezone: true }),
    floodRisk: real("flood_risk").notNull().default(0),
    salinityRisk: real("salinity_risk").notNull().default(0),
    soilEcDsM: real("soil_ec_ds_m"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("farm_fields_farmer_idx").on(t.farmerId),
    index("farm_fields_crop_idx").on(t.cropType),
    index("farm_fields_geom_gist").using("gist", t.geometry),
  ]
);

export const supplyChainNodes = pgTable(
  "supply_chain_nodes",
  {
    id: pk(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    type: supplyChainNodeTypeEnum("type").notNull(),
    regionId: uuid("region_id").references(() => governmentRegions.id, { onDelete: "set null" }),
    country: varchar("country", { length: 100 }).notNull(),
    location: geometry("location", "Point").notNull(),
    capacityTonnes: doublePrecision("capacity_tonnes").notNull(),
    utilizationPct: real("utilization_pct").notNull().default(0),
    primaryCommodities: text("primary_commodities").array().notNull().default(sql`'{}'::text[]`),
    riskScore: real("risk_score").notNull().default(0),
    floodRisk: real("flood_risk").notNull().default(0),
    salinityRisk: real("salinity_risk").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("sc_nodes_org_idx").on(t.orgId),
    index("sc_nodes_region_idx").on(t.regionId),
    index("sc_nodes_location_gist").using("gist", t.location),
  ]
);

// ─── Climate & risk data ───────────────────────────────────────────────────

/** Time-series (TimescaleDB hypertable on `time` when the extension exists). */
export const weatherReadings = pgTable(
  "weather_readings",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    stationId: uuid("station_id").notNull(),
    regionId: uuid("region_id").references(() => governmentRegions.id, { onDelete: "set null" }),
    location: geometry("location", "Point").notNull(),
    temperatureC: real("temperature_c"),
    humidityPct: real("humidity_pct"),
    rainfallMm: real("rainfall_mm"),
    windSpeedKmh: real("wind_speed_kmh"),
    soilMoisturePct: real("soil_moisture_pct"),
    waterLevelM: real("water_level_m"),
    salinityEcDsM: real("salinity_ec_ds_m"),
    source: varchar("source", { length: 64 }).notNull().default("sensor"),
  },
  (t) => [
    primaryKey({ columns: [t.stationId, t.time] }),
    index("weather_readings_time_idx").on(t.time.desc()),
    index("weather_readings_region_time_idx").on(t.regionId, t.time.desc()),
    index("weather_readings_location_gist").using("gist", t.location),
  ]
);

export const floodRiskZones = pgTable(
  "flood_risk_zones",
  {
    id: pk(),
    regionId: uuid("region_id").references(() => governmentRegions.id, { onDelete: "cascade" }),
    geometry: geometry("geometry", "Polygon").notNull(),
    riskLevel: riskLevelEnum("risk_level").notNull(),
    floodProbability7d: real("flood_probability_7d").notNull(),
    floodProbability24h: real("flood_probability_24h").notNull(),
    floodProbability48h: real("flood_probability_48h"),
    floodProbability72h: real("flood_probability_72h"),
    estimatedDepthM: real("estimated_depth_m").notNull().default(0),
    lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
    modelVersion: varchar("model_version", { length: 64 }).notNull(),
    confidenceScore: real("confidence_score").notNull(),
  },
  (t) => [
    index("flood_zones_region_idx").on(t.regionId),
    index("flood_zones_level_idx").on(t.riskLevel),
    index("flood_zones_geom_gist").using("gist", t.geometry),
  ]
);

export const salinityRiskZones = pgTable(
  "salinity_risk_zones",
  {
    id: pk(),
    regionId: uuid("region_id").references(() => governmentRegions.id, { onDelete: "cascade" }),
    geometry: geometry("geometry", "Polygon").notNull(),
    ecCurrentDsM: real("ec_current_ds_m").notNull(),
    ecPredicted30d: real("ec_predicted_30d").notNull(),
    intrusionDepthKm: real("intrusion_depth_km").notNull().default(0),
    riskLevel: riskLevelEnum("risk_level").notNull(),
    affectedAreaHa: doublePrecision("affected_area_ha").notNull().default(0),
    lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("salinity_zones_region_idx").on(t.regionId),
    index("salinity_zones_level_idx").on(t.riskLevel),
    index("salinity_zones_geom_gist").using("gist", t.geometry),
  ]
);

export const climateForecasts = pgTable(
  "climate_forecasts",
  {
    id: pk(),
    location: geometry("location", "Point").notNull(),
    forecastDate: date("forecast_date").notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    rawData: jsonb("raw_data").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("climate_forecasts_date_idx").on(t.forecastDate, t.source), index("climate_forecasts_location_gist").using("gist", t.location)]
);

export const satelliteScenes = pgTable(
  "satellite_scenes",
  {
    id: pk(),
    satellite: varchar("satellite", { length: 64 }).notNull(),
    sceneDate: date("scene_date").notNull(),
    cloudCoverPct: real("cloud_cover_pct"),
    bands: jsonb("bands"),
    geometry: geometry("geometry", "Polygon"),
    ndviMean: real("ndvi_mean"),
    ndwiMean: real("ndwi_mean"),
    storageUrl: text("storage_url"),
    processed: boolean("processed").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("satellite_scenes_date_idx").on(t.sceneDate), index("satellite_scenes_geom_gist").using("gist", t.geometry)]
);

// ─── Alerts & recommendations ──────────────────────────────────────────────

export const climateAlerts = pgTable(
  "climate_alerts",
  {
    id: pk(),
    alertType: alertTypeEnum("alert_type").notNull(),
    severity: alertSeverityEnum("severity").notNull(),
    regionId: uuid("region_id").references(() => governmentRegions.id, { onDelete: "set null" }),
    geometry: geometry("geometry", "Polygon"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    predictedImpact: jsonb("predicted_impact").$type<{ farmsAffected: number; areaHa: number; estLossUsd: number; probability: number }>(),
    recommendedActions: jsonb("recommended_actions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    channels: alertChannelEnum("channels").array().notNull().default(sql`'{app}'::alert_channel[]`),
    source: alertSourceEnum("source").notNull().default("model"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    /** NULL = system / model generated */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    deliveryStats: jsonb("delivery_stats")
      .$type<{ sent: number; delivered: number; read: number; actioned: number }>()
      .notNull()
      .default(sql`'{"sent":0,"delivered":0,"read":0,"actioned":0}'::jsonb`),
  },
  (t) => [
    index("climate_alerts_active_idx").on(t.isActive, t.validUntil),
    index("climate_alerts_region_created_idx").on(t.regionId, t.createdAt.desc()),
    index("climate_alerts_type_idx").on(t.alertType),
    index("climate_alerts_geom_gist").using("gist", t.geometry),
  ]
);

export const alertDeliveries = pgTable(
  "alert_deliveries",
  {
    id: pk(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => climateAlerts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: alertChannelEnum("channel").notNull(),
    status: deliveryStatusEnum("status").notNull().default("queued"),
    provider: varchar("provider", { length: 32 }),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    actioned: boolean("actioned").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("alert_deliveries_uq").on(t.alertId, t.userId, t.channel),
    index("alert_deliveries_user_idx").on(t.userId),
    index("alert_deliveries_status_idx").on(t.status),
  ]
);

export const farmRecommendations = pgTable(
  "farm_recommendations",
  {
    id: pk(),
    farmFieldId: uuid("farm_field_id")
      .notNull()
      .references(() => farmFields.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id").references(() => climateAlerts.id, { onDelete: "set null" }),
    recommendationType: varchar("recommendation_type", { length: 64 }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    priority: recommendationPriorityEnum("priority").notNull(),
    actions: jsonb("actions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    confidenceScore: real("confidence_score").notNull(),
    generatedBy: varchar("generated_by", { length: 64 }).notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    farmerFeedback: text("farmer_feedback"),
    outcomeRecorded: boolean("outcome_recorded").notNull().default(false),
  },
  (t) => [
    index("farm_recs_field_idx").on(t.farmFieldId),
    index("farm_recs_alert_idx").on(t.alertId),
    index("farm_recs_priority_idx").on(t.priority),
  ]
);

export const resourceInventory = pgTable(
  "resource_inventory",
  {
    id: pk(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: resourceTypeEnum("type").notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    unit: varchar("unit", { length: 32 }).notNull(),
    total: integer("total").notNull(),
    deployed: integer("deployed").notNull().default(0),
    depots: jsonb("depots")
      .$type<{ name: string; lat: number; lon: number; quantity: number; coverageKm: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("resource_inventory_org_type_uq").on(t.orgId, t.type)]
);

export const resourceRequests = pgTable(
  "resource_requests",
  {
    id: pk(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    resourceType: resourceTypeEnum("resource_type").notNull(),
    quantity: integer("quantity").notNull(),
    targetRegion: uuid("target_region").references(() => governmentRegions.id, { onDelete: "set null" }),
    status: resourceStatusEnum("status").notNull().default("pending"),
    priority: requestPriorityEnum("priority").notNull().default("medium"),
    notes: text("notes"),
    vehicle: varchar("vehicle", { length: 64 }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    timeline: jsonb("timeline").$type<{ status: string; at: string; by: string }[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("resource_requests_org_status_idx").on(t.orgId, t.status),
    index("resource_requests_region_idx").on(t.targetRegion),
  ]
);

export const supplyChainRisks = pgTable(
  "supply_chain_risks",
  {
    id: pk(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => supplyChainNodes.id, { onDelete: "cascade" }),
    commodity: varchar("commodity", { length: 64 }).notNull(),
    riskType: supplyChainRiskTypeEnum("risk_type").notNull(),
    probability: real("probability").notNull(),
    estimatedLossTonnes: doublePrecision("estimated_loss_tonnes"),
    estimatedLossUsd: doublePrecision("estimated_loss_usd"),
    mitigationOptions: jsonb("mitigation_options"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sc_risks_node_idx").on(t.nodeId), index("sc_risks_commodity_idx").on(t.commodity, t.validFrom)]
);

// ─── Analytics & feedback ──────────────────────────────────────────────────

export const farmerActions = pgTable(
  "farmer_actions",
  {
    id: pk(),
    farmerId: uuid("farmer_id")
      .notNull()
      .references(() => farmerProfiles.id, { onDelete: "cascade" }),
    recommendationId: uuid("recommendation_id").references(() => farmRecommendations.id, { onDelete: "set null" }),
    alertId: uuid("alert_id").references(() => climateAlerts.id, { onDelete: "set null" }),
    actionTaken: text("action_taken").notNull(),
    actionDate: timestamp("action_date", { withTimezone: true }).notNull().defaultNow(),
    outcome: text("outcome"),
    cropSavedPct: real("crop_saved_pct"),
  },
  (t) => [index("farmer_actions_farmer_idx").on(t.farmerId, t.actionDate.desc()), index("farmer_actions_alert_idx").on(t.alertId)]
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: pk(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    properties: jsonb("properties"),
    sessionId: uuid("session_id"),
    createdAt: createdAt(),
  },
  (t) => [index("usage_events_type_created_idx").on(t.eventType, t.createdAt.desc()), index("usage_events_user_idx").on(t.userId)]
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: pk(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    plan: subscriptionPlanEnum("plan").notNull(),
    status: subscriptionStatusEnum("status").notNull().default("trialing"),
    provider: paymentProviderEnum("provider").notNull().default("none"),
    mrrUsd: real("mrr_usd").notNull().default(0),
    currentPeriodStart: date("current_period_start").notNull(),
    currentPeriodEnd: date("current_period_end").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    razorpaySubscriptionId: text("razorpay_subscription_id"),
    paymongoSubscriptionId: text("paymongo_subscription_id"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("subscriptions_user_idx").on(t.userId),
    index("subscriptions_org_idx").on(t.orgId),
    index("subscriptions_status_idx").on(t.status),
  ]
);

// ─── Operational tables (integrations, governance, jobs, RAG) ──────────────

export const webhooks = pgTable(
  "webhooks",
  {
    id: pk(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    commodities: text("commodities").array().notNull().default(sql`'{}'::text[]`),
    riskThreshold: integer("risk_threshold").notNull().default(70),
    events: text("events").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    /** HMAC signing secret — encrypt at rest (Supabase Vault / pgsodium) in production */
    secret: text("secret").notNull(),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    lastDeliveryStatus: integer("last_delivery_status"),
    createdAt: createdAt(),
  },
  (t) => [index("webhooks_org_idx").on(t.orgId)]
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: pk(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    /** first chars shown in UI, e.g. ags_live_7Hq2 */
    prefix: varchar("prefix", { length: 32 }).notNull(),
    /** hex sha256 of the full key — the key itself is never stored */
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), uniqueIndex("api_keys_prefix_uq").on(t.prefix), index("api_keys_org_idx").on(t.orgId)]
);

/** Append-only (spec §18: every create/update/delete with user + timestamp). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: varchar("user_name", { length: 255 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    entity: varchar("entity", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 128 }).notNull(),
    details: text("details"),
    ip: varchar("ip", { length: 64 }),
  },
  (t) => [
    index("audit_log_at_idx").on(t.at.desc()),
    index("audit_log_user_idx").on(t.userId, t.at.desc()),
    index("audit_log_entity_idx").on(t.entity, t.entityId),
  ]
);

export const featureFlags = pgTable("feature_flags", {
  key: varchar("key", { length: 64 }).primaryKey(),
  description: text("description").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  rolloutPct: integer("rollout_pct").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export const supplyChainFlows = pgTable(
  "supply_chain_flows",
  {
    id: pk(),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => supplyChainNodes.id, { onDelete: "cascade" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => supplyChainNodes.id, { onDelete: "cascade" }),
    commodity: varchar("commodity", { length: 64 }).notNull(),
    tonnesPerWeek: doublePrecision("tonnes_per_week").notNull(),
  },
  (t) => [index("sc_flows_from_idx").on(t.fromNodeId), index("sc_flows_to_idx").on(t.toNodeId)]
);

export const commodities = pgTable("commodities", {
  commodity: varchar("commodity", { length: 64 }).primaryKey(),
  unit: varchar("unit", { length: 16 }).notNull(),
  basePriceUsd: doublePrecision("base_price_usd").notNull(),
  producingRegionIds: uuid("producing_region_ids").array().notNull().default(sql`'{}'::uuid[]`),
  floodSensitivity: real("flood_sensitivity").notNull(),
  salinitySensitivity: real("salinity_sensitivity").notNull(),
  weeklyVolumeTonnes: doublePrecision("weekly_volume_tonnes").notNull(),
});

export const commodityPrices = pgTable(
  "commodity_prices",
  {
    commodity: varchar("commodity", { length: 64 })
      .notNull()
      .references(() => commodities.commodity, { onDelete: "cascade" }),
    date: date("date").notNull(),
    priceUsd: doublePrecision("price_usd").notNull(),
  },
  (t) => [primaryKey({ columns: [t.commodity, t.date] })]
);

/** RAG knowledge base (FAO / IRRI guidance chunks) for the AI advisor. */
export const ragDocuments = pgTable(
  "rag_documents",
  {
    id: pk(),
    title: text("title").notNull(),
    source: text("source").notNull(),
    language: varchar("language", { length: 8 }).notNull().default("en"),
    chunk: text("chunk").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    /** all-MiniLM-L6-v2 embeddings (384-d) */
    embedding: vector("embedding", 384),
    createdAt: createdAt(),
  },
  (t) => [index("rag_documents_source_idx").on(t.source)]
);

/** Background job history (climate scan, satellite ingest, dispatch, retrain). */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: pk(),
    job: varchar("job", { length: 64 }).notNull(),
    trigger: varchar("trigger", { length: 32 }).notNull().default("schedule"),
    status: jobStatusEnum("status").notNull().default("queued"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    summary: jsonb("summary"),
    error: text("error"),
  },
  (t) => [index("job_runs_job_started_idx").on(t.job, t.startedAt.desc())]
);

// ─── Inferred row types ────────────────────────────────────────────────────

export type AnyTable = PgTable;
export type AnyInsert<T extends PgTable> = T["$inferInsert"];

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type UserOrganization = typeof userOrganizations.$inferSelect;
export type GovernmentRegion = typeof governmentRegions.$inferSelect;
export type NewGovernmentRegion = typeof governmentRegions.$inferInsert;
export type FarmerProfile = typeof farmerProfiles.$inferSelect;
export type NewFarmerProfile = typeof farmerProfiles.$inferInsert;
export type FarmField = typeof farmFields.$inferSelect;
export type NewFarmField = typeof farmFields.$inferInsert;
export type SupplyChainNode = typeof supplyChainNodes.$inferSelect;
export type NewSupplyChainNode = typeof supplyChainNodes.$inferInsert;
export type WeatherReading = typeof weatherReadings.$inferSelect;
export type NewWeatherReading = typeof weatherReadings.$inferInsert;
export type FloodRiskZone = typeof floodRiskZones.$inferSelect;
export type SalinityRiskZone = typeof salinityRiskZones.$inferSelect;
export type ClimateForecast = typeof climateForecasts.$inferSelect;
export type SatelliteScene = typeof satelliteScenes.$inferSelect;
export type ClimateAlert = typeof climateAlerts.$inferSelect;
export type NewClimateAlert = typeof climateAlerts.$inferInsert;
export type AlertDelivery = typeof alertDeliveries.$inferSelect;
export type FarmRecommendation = typeof farmRecommendations.$inferSelect;
export type ResourceInventory = typeof resourceInventory.$inferSelect;
export type ResourceRequest = typeof resourceRequests.$inferSelect;
export type SupplyChainRisk = typeof supplyChainRisks.$inferSelect;
export type FarmerAction = typeof farmerActions.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type SupplyChainFlow = typeof supplyChainFlows.$inferSelect;
export type Commodity = typeof commodities.$inferSelect;
export type CommodityPrice = typeof commodityPrices.$inferSelect;
export type RagDocument = typeof ragDocuments.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
