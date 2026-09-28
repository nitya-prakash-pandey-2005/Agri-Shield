import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  real,
  timestamp,
  date,
  jsonb,
  pgEnum,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "farmer",
  "field_officer",
  "regional_admin",
  "national_admin",
  "supply_chain_analyst",
  "supply_chain_admin",
  "platform_admin",
]);

export const adminLevelEnum = pgEnum("admin_level", [
  "national",
  "provincial",
  "district",
]);

export const riskLevelEnum = pgEnum("risk_level", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const alertTypeEnum = pgEnum("alert_type", [
  "flood",
  "salinity",
  "drought",
  "storm",
  "frost",
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "watch",
  "warning",
  "emergency",
]);

export const alertChannelEnum = pgEnum("alert_channel", [
  "app",
  "sms",
  "whatsapp",
  "email",
]);

export const subscriptionPlanEnum = pgEnum("subscription_plan", [
  "free",
  "farmer_pro",
  "gov_basic",
  "gov_enterprise",
  "supply_chain",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "cancelled",
  "trialing",
]);

export const resourceTypeEnum = pgEnum("resource_type", [
  "pumps",
  "sandbags",
  "evacuation_buses",
  "medical",
  "food_aid",
]);

export const resourceStatusEnum = pgEnum("resource_status", [
  "pending",
  "approved",
  "dispatched",
  "delivered",
]);

export const supplyChainNodeTypeEnum = pgEnum("supply_chain_node_type", [
  "warehouse",
  "port",
  "processor",
  "retailer",
]);

export const supplyChainRiskTypeEnum = pgEnum("supply_chain_risk_type", [
  "flood_disruption",
  "salinity_quality",
  "access_blocked",
  "storage_damaged",
]);

export const recommendationPriorityEnum = pgEnum("recommendation_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const orgTypeEnum = pgEnum("org_type", [
  "government",
  "supply_chain",
  "ngo",
]);

export const irrigationTypeEnum = pgEnum("irrigation_type", [
  "rainfed",
  "drip",
  "flood_irrigation",
  "sprinkler",
  "canal",
]);

export const soilTypeEnum = pgEnum("soil_type", [
  "clay",
  "loam",
  "sandy",
  "silt",
  "peat",
  "chalky",
]);

// ─── Core Tables ──────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    email: varchar("email", { length: 320 }).unique(),
    name: varchar("name", { length: 255 }).notNull(),
    role: userRoleEnum("role").notNull().default("farmer"),
    language: varchar("language", { length: 10 }).notNull().default("en"),
    phone: varchar("phone", { length: 30 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActive: timestamp("last_active", { withTimezone: true })
      .notNull()
      .defaultNow(),
    subscriptionTier: subscriptionPlanEnum("subscription_tier")
      .notNull()
      .default("free"),
    avatarUrl: text("avatar_url"),
    isVerified: boolean("is_verified").notNull().default(false),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
    roleIdx: index("users_role_idx").on(table.role),
  })
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    name: varchar("name", { length: 255 }).notNull(),
    type: orgTypeEnum("type").notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    region: varchar("region", { length: 100 }),
    verified: boolean("verified").notNull().default(false),
    planTier: subscriptionPlanEnum("plan_tier").notNull().default("free"),
    logoUrl: text("logo_url"),
    website: text("website"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nameIdx: index("orgs_name_idx").on(table.name),
  })
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
    roleInOrg: varchar("role_in_org", { length: 100 }).notNull(),
    permissions: jsonb("permissions"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.orgId] }),
  })
);

export const farmerProfiles = pgTable(
  "farmer_profiles",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    farmName: varchar("farm_name", { length: 255 }).notNull(),
    totalAreaHa: real("total_area_ha").notNull(),
    primaryCrops: text("primary_crops").array().notNull().default(sql`'{}'`),
    experienceYears: integer("experience_years").notNull().default(0),
    locationLat: real("location_lat").notNull(),
    locationLon: real("location_lon").notNull(),
    district: varchar("district", { length: 255 }).notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    hasFloodHistory: boolean("has_flood_history").notNull().default(false),
    hasSalinityHistory: boolean("has_salinity_history").notNull().default(false),
    hasFloodInsurance: boolean("has_flood_insurance").notNull().default(false),
    distanceToRiverKm: real("distance_to_river_km"),
    distanceToCoastKm: real("distance_to_coast_km"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIdx: index("farmer_profiles_user_id_idx").on(table.userId),
    locationIdx: index("farmer_profiles_location_idx").on(
      table.locationLat,
      table.locationLon
    ),
  })
);

export const farmFields = pgTable(
  "farm_fields",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    farmerId: uuid("farmer_id")
      .notNull()
      .references(() => farmerProfiles.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    areaHa: real("area_ha").notNull(),
    cropType: varchar("crop_type", { length: 100 }).notNull(),
    plantingDate: date("planting_date"),
    expectedHarvest: date("expected_harvest"),
    soilType: soilTypeEnum("soil_type"),
    irrigationType: irrigationTypeEnum("irrigation_type"),
    geometryGeoJson: jsonb("geometry_geojson").notNull(),
    centerLat: real("center_lat").notNull(),
    centerLon: real("center_lon").notNull(),
    elevationM: real("elevation_m"),
    ndviScore: real("ndvi_score"),
    lastSatelliteScan: timestamp("last_satellite_scan", { withTimezone: true }),
    currentFloodRisk: real("current_flood_risk").notNull().default(0),
    currentSalinityRisk: real("current_salinity_risk").notNull().default(0),
    currentEcDsM: real("current_ec_ds_m"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    farmerIdIdx: index("farm_fields_farmer_id_idx").on(table.farmerId),
    locationIdx: index("farm_fields_location_idx").on(
      table.centerLat,
      table.centerLon
    ),
  })
);

// ─── Government Tables ────────────────────────────────────────

export const governmentRegions = pgTable(
  "government_regions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    adminLevel: adminLevelEnum("admin_level").notNull(),
    geometryGeoJson: jsonb("geometry_geojson").notNull(),
    centerLat: real("center_lat").notNull(),
    centerLon: real("center_lon").notNull(),
    population: integer("population").notNull().default(0),
    vulnerableAreaHa: real("vulnerable_area_ha").notNull().default(0),
    totalFarms: integer("total_farms").notNull().default(0),
    country: varchar("country", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index("gov_regions_org_id_idx").on(table.orgId),
  })
);

export const resourceRequests = pgTable(
  "resource_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    resourceType: resourceTypeEnum("resource_type").notNull(),
    quantity: integer("quantity").notNull(),
    targetRegion: uuid("target_region").references(() => governmentRegions.id),
    status: resourceStatusEnum("status").notNull().default("pending"),
    priority: varchar("priority", { length: 50 }).notNull().default("medium"),
    notes: text("notes"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index("resource_requests_org_id_idx").on(table.orgId),
    statusIdx: index("resource_requests_status_idx").on(table.status),
  })
);

// ─── Supply Chain Tables ──────────────────────────────────────

export const supplyChainNodes = pgTable(
  "supply_chain_nodes",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    type: supplyChainNodeTypeEnum("type").notNull(),
    locationLat: real("location_lat").notNull(),
    locationLon: real("location_lon").notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    capacityTonnes: real("capacity_tonnes").notNull(),
    primaryCommodities: text("primary_commodities").array().notNull().default(sql`'{}'`),
    riskScore: real("risk_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index("sc_nodes_org_id_idx").on(table.orgId),
    locationIdx: index("sc_nodes_location_idx").on(
      table.locationLat,
      table.locationLon
    ),
  })
);

export const supplyChainRisks = pgTable(
  "supply_chain_risks",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => supplyChainNodes.id, { onDelete: "cascade" }),
    commodity: varchar("commodity", { length: 100 }).notNull(),
    riskType: supplyChainRiskTypeEnum("risk_type").notNull(),
    probability: real("probability").notNull(),
    estimatedLossTonnes: real("estimated_loss_tonnes"),
    estimatedLossUsd: real("estimated_loss_usd"),
    mitigationOptions: jsonb("mitigation_options"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nodeIdIdx: index("sc_risks_node_id_idx").on(table.nodeId),
  })
);

// ─── Climate & Risk Data ──────────────────────────────────────

export const weatherReadings = pgTable(
  "weather_readings",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    stationId: uuid("station_id").notNull(),
    locationLat: real("location_lat").notNull(),
    locationLon: real("location_lon").notNull(),
    temperatureC: real("temperature_c"),
    humidityPct: real("humidity_pct"),
    rainfallMm: real("rainfall_mm"),
    windSpeedKmh: real("wind_speed_kmh"),
    soilMoisturePct: real("soil_moisture_pct"),
    waterLevelM: real("water_level_m"),
    salinityEcDsM: real("salinity_ec_ds_m"),
  },
  (table) => ({
    timeIdx: index("weather_readings_time_idx").on(table.time),
    stationIdx: index("weather_readings_station_idx").on(table.stationId),
    locationIdx: index("weather_readings_location_idx").on(
      table.locationLat,
      table.locationLon
    ),
  })
);

export const floodRiskZones = pgTable(
  "flood_risk_zones",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    regionId: uuid("region_id").references(() => governmentRegions.id),
    geometryGeoJson: jsonb("geometry_geojson").notNull(),
    centerLat: real("center_lat").notNull(),
    centerLon: real("center_lon").notNull(),
    riskLevel: riskLevelEnum("risk_level").notNull(),
    floodProbability7d: real("flood_probability_7d").notNull(),
    floodProbability24h: real("flood_probability_24h").notNull(),
    estimatedDepthM: real("estimated_depth_m").notNull(),
    lastUpdated: timestamp("last_updated", { withTimezone: true })
      .notNull()
      .defaultNow(),
    modelVersion: varchar("model_version", { length: 50 }).notNull(),
    confidenceScore: real("confidence_score").notNull(),
  },
  (table) => ({
    riskLevelIdx: index("flood_risk_zones_level_idx").on(table.riskLevel),
    locationIdx: index("flood_risk_zones_location_idx").on(
      table.centerLat,
      table.centerLon
    ),
  })
);

export const salinityRiskZones = pgTable(
  "salinity_risk_zones",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    regionId: uuid("region_id").references(() => governmentRegions.id),
    geometryGeoJson: jsonb("geometry_geojson").notNull(),
    centerLat: real("center_lat").notNull(),
    centerLon: real("center_lon").notNull(),
    ecCurrentDsM: real("ec_current_ds_m").notNull(),
    ecPredicted30d: real("ec_predicted_30d").notNull(),
    intrusionDepthKm: real("intrusion_depth_km").notNull(),
    riskLevel: riskLevelEnum("risk_level").notNull(),
    affectedAreaHa: real("affected_area_ha").notNull(),
    lastUpdated: timestamp("last_updated", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    riskLevelIdx: index("salinity_risk_zones_level_idx").on(table.riskLevel),
  })
);

export const satelliteScenes = pgTable(
  "satellite_scenes",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    satellite: varchar("satellite", { length: 50 }).notNull(),
    sceneDate: date("scene_date").notNull(),
    cloudCoverPct: real("cloud_cover_pct").notNull(),
    bands: jsonb("bands"),
    boundingBoxGeoJson: jsonb("bounding_box_geojson"),
    ndviMean: real("ndvi_mean"),
    ndwiMean: real("ndwi_mean"),
    storageUrl: text("storage_url"),
    processed: boolean("processed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }
);

export const climateForecasts = pgTable(
  "climate_forecasts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    locationLat: real("location_lat").notNull(),
    locationLon: real("location_lon").notNull(),
    forecastDate: date("forecast_date").notNull(),
    source: varchar("source", { length: 100 }).notNull(),
    rawData: jsonb("raw_data").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    locationDateIdx: index("climate_forecasts_loc_date_idx").on(
      table.locationLat,
      table.locationLon,
      table.forecastDate
    ),
  })
);

// ─── Alerts ───────────────────────────────────────────────────

export const climateAlerts = pgTable(
  "climate_alerts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    alertType: alertTypeEnum("alert_type").notNull(),
    severity: alertSeverityEnum("severity").notNull(),
    regionId: uuid("region_id").references(() => governmentRegions.id),
    geometryGeoJson: jsonb("geometry_geojson"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    predictedImpact: jsonb("predicted_impact"),
    recommendedActions: jsonb("recommended_actions"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    affectedFarmersCount: integer("affected_farmers_count").default(0),
  },
  (table) => ({
    isActiveIdx: index("climate_alerts_active_idx").on(table.isActive),
    alertTypeIdx: index("climate_alerts_type_idx").on(table.alertType),
    validUntilIdx: index("climate_alerts_valid_until_idx").on(table.validUntil),
  })
);

export const alertDeliveries = pgTable(
  "alert_deliveries",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => climateAlerts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: alertChannelEnum("channel").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    actioned: boolean("actioned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    alertIdIdx: index("alert_deliveries_alert_id_idx").on(table.alertId),
    userIdIdx: index("alert_deliveries_user_id_idx").on(table.userId),
  })
);

export const farmRecommendations = pgTable(
  "farm_recommendations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    farmFieldId: uuid("farm_field_id")
      .notNull()
      .references(() => farmFields.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id").references(() => climateAlerts.id),
    recommendationType: varchar("recommendation_type", { length: 100 }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    priority: recommendationPriorityEnum("priority").notNull(),
    actions: jsonb("actions"),
    confidenceScore: real("confidence_score").notNull(),
    generatedBy: varchar("generated_by", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    farmerFeedback: text("farmer_feedback"),
    outcomeRecorded: boolean("outcome_recorded").notNull().default(false),
  },
  (table) => ({
    farmFieldIdIdx: index("farm_recommendations_field_id_idx").on(table.farmFieldId),
    priorityIdx: index("farm_recommendations_priority_idx").on(table.priority),
  })
);

export const farmerActions = pgTable(
  "farmer_actions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    farmerId: uuid("farmer_id")
      .notNull()
      .references(() => farmerProfiles.id, { onDelete: "cascade" }),
    recommendationId: uuid("recommendation_id").references(
      () => farmRecommendations.id
    ),
    actionTaken: text("action_taken").notNull(),
    actionDate: timestamp("action_date", { withTimezone: true })
      .notNull()
      .defaultNow(),
    outcome: text("outcome"),
    cropSavedPct: real("crop_saved_pct"),
  },
  (table) => ({
    farmerIdIdx: index("farmer_actions_farmer_id_idx").on(table.farmerId),
  })
);

// ─── Subscriptions ─────────────────────────────────────────────

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    userId: uuid("user_id").references(() => users.id),
    orgId: uuid("org_id").references(() => organizations.id),
    plan: subscriptionPlanEnum("plan").notNull(),
    status: subscriptionStatusEnum("status").notNull().default("trialing"),
    currentPeriodStart: date("current_period_start").notNull(),
    currentPeriodEnd: date("current_period_end").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    razorpaySubscriptionId: text("razorpay_subscription_id"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIdx: index("subscriptions_user_id_idx").on(table.userId),
    orgIdIdx: index("subscriptions_org_id_idx").on(table.orgId),
  })
);

// ─── Analytics ─────────────────────────────────────────────────

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    userId: uuid("user_id").references(() => users.id),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    properties: jsonb("properties"),
    sessionId: uuid("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIdx: index("usage_events_user_id_idx").on(table.userId),
    eventTypeIdx: index("usage_events_event_type_idx").on(table.eventType),
    createdAtIdx: index("usage_events_created_at_idx").on(table.createdAt),
  })
);

// ─── Export all tables ────────────────────────────────────────

export type DB = {
  users: typeof users;
  organizations: typeof organizations;
  userOrganizations: typeof userOrganizations;
  farmerProfiles: typeof farmerProfiles;
  farmFields: typeof farmFields;
  governmentRegions: typeof governmentRegions;
  resourceRequests: typeof resourceRequests;
  supplyChainNodes: typeof supplyChainNodes;
  supplyChainRisks: typeof supplyChainRisks;
  weatherReadings: typeof weatherReadings;
  floodRiskZones: typeof floodRiskZones;
  salinityRiskZones: typeof salinityRiskZones;
  satelliteScenes: typeof satelliteScenes;
  climateForecasts: typeof climateForecasts;
  climateAlerts: typeof climateAlerts;
  alertDeliveries: typeof alertDeliveries;
  farmRecommendations: typeof farmRecommendations;
  farmerActions: typeof farmerActions;
  subscriptions: typeof subscriptions;
  usageEvents: typeof usageEvents;
};
