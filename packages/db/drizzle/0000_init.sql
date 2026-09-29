CREATE TYPE "public"."admin_level" AS ENUM('national', 'provincial', 'district');--> statement-breakpoint
CREATE TYPE "public"."alert_channel" AS ENUM('app', 'sms', 'whatsapp', 'email');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('watch', 'warning', 'emergency');--> statement-breakpoint
CREATE TYPE "public"."alert_source" AS ENUM('model', 'manual', 'gdacs', 'eonet');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('flood', 'salinity', 'drought', 'storm', 'frost');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('queued', 'sent', 'simulated', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."flood_history" AS ENUM('never', 'rarely', 'sometimes', 'often');--> statement-breakpoint
CREATE TYPE "public"."irrigation_type" AS ENUM('rainfed', 'drip', 'flood_irrigation', 'sprinkler', 'canal');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('government', 'supply_chain', 'ngo');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('stripe', 'razorpay', 'paymongo', 'none');--> statement-breakpoint
CREATE TYPE "public"."recommendation_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."request_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."resource_status" AS ENUM('pending', 'approved', 'dispatched', 'delivered', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('pumps', 'sandbags', 'evacuation_buses', 'medical', 'food_aid');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."soil_type" AS ENUM('clay', 'loam', 'sandy', 'silt', 'peat', 'chalky');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('free', 'farmer_pro', 'gov_basic', 'gov_enterprise', 'supply_chain');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'cancelled', 'trialing');--> statement-breakpoint
CREATE TYPE "public"."supply_chain_node_type" AS ENUM('warehouse', 'port', 'processor', 'retailer');--> statement-breakpoint
CREATE TYPE "public"."supply_chain_risk_type" AS ENUM('flood_disruption', 'salinity_quality', 'access_blocked', 'storage_damaged');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('farmer', 'field_officer', 'regional_admin', 'national_admin', 'supply_chain_analyst', 'supply_chain_admin', 'platform_admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'pending_verification');--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "alert_channel" NOT NULL,
	"status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"provider" varchar(32),
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"actioned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"prefix" varchar(32) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"user_name" varchar(255) NOT NULL,
	"action" varchar(64) NOT NULL,
	"entity" varchar(64) NOT NULL,
	"entity_id" varchar(128) NOT NULL,
	"details" text,
	"ip" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "climate_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_type" "alert_type" NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"region_id" uuid,
	"geometry" geometry(Polygon, 4326),
	"title" text NOT NULL,
	"description" text NOT NULL,
	"predicted_impact" jsonb,
	"recommended_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channels" "alert_channel"[] DEFAULT '{app}'::alert_channel[] NOT NULL,
	"source" "alert_source" DEFAULT 'model' NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"delivery_stats" jsonb DEFAULT '{"sent":0,"delivered":0,"read":0,"actioned":0}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "climate_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"forecast_date" date NOT NULL,
	"source" varchar(64) NOT NULL,
	"raw_data" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commodities" (
	"commodity" varchar(64) PRIMARY KEY NOT NULL,
	"unit" varchar(16) NOT NULL,
	"base_price_usd" double precision NOT NULL,
	"producing_region_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"flood_sensitivity" real NOT NULL,
	"salinity_sensitivity" real NOT NULL,
	"weekly_volume_tonnes" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commodity_prices" (
	"commodity" varchar(64) NOT NULL,
	"date" date NOT NULL,
	"price_usd" double precision NOT NULL,
	CONSTRAINT "commodity_prices_commodity_date_pk" PRIMARY KEY("commodity","date")
);
--> statement-breakpoint
CREATE TABLE "farm_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farmer_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"area_ha" real NOT NULL,
	"crop_type" varchar(64) NOT NULL,
	"planting_date" date,
	"expected_harvest" date,
	"soil_type" "soil_type",
	"irrigation_type" "irrigation_type",
	"geometry" geometry(Polygon, 4326) NOT NULL,
	"elevation_m" real,
	"ndvi_score" real,
	"ndvi_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_satellite_scan" timestamp with time zone,
	"flood_risk" real DEFAULT 0 NOT NULL,
	"salinity_risk" real DEFAULT 0 NOT NULL,
	"soil_ec_ds_m" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farm_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_field_id" uuid NOT NULL,
	"alert_id" uuid,
	"recommendation_type" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"priority" "recommendation_priority" NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence_score" real NOT NULL,
	"generated_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"farmer_feedback" text,
	"outcome_recorded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farmer_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farmer_id" uuid NOT NULL,
	"recommendation_id" uuid,
	"alert_id" uuid,
	"action_taken" text NOT NULL,
	"action_date" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text,
	"crop_saved_pct" real
);
--> statement-breakpoint
CREATE TABLE "farmer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"farm_name" varchar(255) NOT NULL,
	"total_area_ha" real NOT NULL,
	"primary_crops" text[] DEFAULT '{}'::text[] NOT NULL,
	"experience_years" integer DEFAULT 0 NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"district" varchar(255) NOT NULL,
	"region_id" uuid,
	"country" varchar(100) NOT NULL,
	"flood_history" "flood_history" DEFAULT 'never' NOT NULL,
	"salinity_observed" boolean DEFAULT false NOT NULL,
	"has_insurance" boolean DEFAULT false NOT NULL,
	"referral_code" varchar(32),
	"referrals" integer DEFAULT 0 NOT NULL,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout_pct" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "flood_risk_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid,
	"geometry" geometry(Polygon, 4326) NOT NULL,
	"risk_level" "risk_level" NOT NULL,
	"flood_probability_7d" real NOT NULL,
	"flood_probability_24h" real NOT NULL,
	"flood_probability_48h" real,
	"flood_probability_72h" real,
	"estimated_depth_m" real DEFAULT 0 NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"model_version" varchar(64) NOT NULL,
	"confidence_score" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "government_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"admin_level" "admin_level" DEFAULT 'district' NOT NULL,
	"parent_id" uuid,
	"geometry" geometry(MultiPolygon, 4326) NOT NULL,
	"centroid" geometry(Point, 4326) NOT NULL,
	"country" varchar(100) NOT NULL,
	"basin" varchar(255),
	"river_name" varchar(255),
	"population" integer DEFAULT 0 NOT NULL,
	"vulnerable_area_ha" double precision DEFAULT 0 NOT NULL,
	"monitored_area_ha" double precision DEFAULT 0 NOT NULL,
	"total_farms" integer DEFAULT 0 NOT NULL,
	"flood_exposure" real DEFAULT 0 NOT NULL,
	"salinity_exposure" real DEFAULT 0 NOT NULL,
	"coast_distance_km" real,
	"historical_floods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" varchar(64) NOT NULL,
	"trigger" varchar(32) DEFAULT 'schedule' NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"short_name" varchar(64),
	"type" "org_type" NOT NULL,
	"country" varchar(100) NOT NULL,
	"region" varchar(255),
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"plan_tier" "subscription_plan" DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Hand-edited: pgvector is optional. With the extension we get vector(384) +
-- an HNSW cosine index; without it the column degrades to float8[] so the
-- rest of the schema still migrates on a plain PostGIS image.
DO $$
DECLARE emb_type text := CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN 'vector(384)' ELSE 'double precision[]' END;
BEGIN
	EXECUTE format($ddl$CREATE TABLE "rag_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"language" varchar(8) DEFAULT 'en' NOT NULL,
	"chunk" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" %s,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
)$ddl$, emb_type);
	IF emb_type = 'vector(384)' THEN
		EXECUTE 'CREATE INDEX "rag_documents_embedding_hnsw" ON "rag_documents" USING hnsw ("embedding" vector_cosine_ops)';
	END IF;
END
$$;
--> statement-breakpoint
CREATE TABLE "resource_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" "resource_type" NOT NULL,
	"label" varchar(128) NOT NULL,
	"unit" varchar(32) NOT NULL,
	"total" integer NOT NULL,
	"deployed" integer DEFAULT 0 NOT NULL,
	"depots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"resource_type" "resource_type" NOT NULL,
	"quantity" integer NOT NULL,
	"target_region" uuid,
	"status" "resource_status" DEFAULT 'pending' NOT NULL,
	"priority" "request_priority" DEFAULT 'medium' NOT NULL,
	"notes" text,
	"vehicle" varchar(64),
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salinity_risk_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid,
	"geometry" geometry(Polygon, 4326) NOT NULL,
	"ec_current_ds_m" real NOT NULL,
	"ec_predicted_30d" real NOT NULL,
	"intrusion_depth_km" real DEFAULT 0 NOT NULL,
	"risk_level" "risk_level" NOT NULL,
	"affected_area_ha" double precision DEFAULT 0 NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "satellite_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"satellite" varchar(64) NOT NULL,
	"scene_date" date NOT NULL,
	"cloud_cover_pct" real,
	"bands" jsonb,
	"geometry" geometry(Polygon, 4326),
	"ndvi_mean" real,
	"ndwi_mean" real,
	"storage_url" text,
	"processed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"org_id" uuid,
	"plan" "subscription_plan" NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"provider" "payment_provider" DEFAULT 'none' NOT NULL,
	"mrr_usd" real DEFAULT 0 NOT NULL,
	"current_period_start" date NOT NULL,
	"current_period_end" date NOT NULL,
	"stripe_subscription_id" text,
	"razorpay_subscription_id" text,
	"paymongo_subscription_id" text,
	"trial_ends_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_chain_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"commodity" varchar(64) NOT NULL,
	"tonnes_per_week" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_chain_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "supply_chain_node_type" NOT NULL,
	"region_id" uuid,
	"country" varchar(100) NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"capacity_tonnes" double precision NOT NULL,
	"utilization_pct" real DEFAULT 0 NOT NULL,
	"primary_commodities" text[] DEFAULT '{}'::text[] NOT NULL,
	"risk_score" real DEFAULT 0 NOT NULL,
	"flood_risk" real DEFAULT 0 NOT NULL,
	"salinity_risk" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_chain_risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"commodity" varchar(64) NOT NULL,
	"risk_type" "supply_chain_risk_type" NOT NULL,
	"probability" real NOT NULL,
	"estimated_loss_tonnes" double precision,
	"estimated_loss_usd" double precision,
	"mitigation_options" jsonb,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" varchar(100) NOT NULL,
	"properties" jsonb,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_organizations" (
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role_in_org" varchar(64) NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_organizations_user_id_org_id_pk" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320),
	"name" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'farmer' NOT NULL,
	"language" varchar(8) DEFAULT 'en' NOT NULL,
	"phone" varchar(32),
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active" timestamp with time zone DEFAULT now() NOT NULL,
	"subscription_tier" "subscription_plan" DEFAULT 'free' NOT NULL,
	"password_hash" text
);
--> statement-breakpoint
CREATE TABLE "weather_readings" (
	"time" timestamp with time zone NOT NULL,
	"station_id" uuid NOT NULL,
	"region_id" uuid,
	"location" geometry(Point, 4326) NOT NULL,
	"temperature_c" real,
	"humidity_pct" real,
	"rainfall_mm" real,
	"wind_speed_kmh" real,
	"soil_moisture_pct" real,
	"water_level_m" real,
	"salinity_ec_ds_m" real,
	"source" varchar(64) DEFAULT 'sensor' NOT NULL,
	CONSTRAINT "weather_readings_station_id_time_pk" PRIMARY KEY("station_id","time")
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"url" text NOT NULL,
	"commodities" text[] DEFAULT '{}'::text[] NOT NULL,
	"risk_threshold" integer DEFAULT 70 NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"secret" text NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_delivery_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_alert_id_climate_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."climate_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "climate_alerts" ADD CONSTRAINT "climate_alerts_region_id_government_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."government_regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "climate_alerts" ADD CONSTRAINT "climate_alerts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commodity_prices" ADD CONSTRAINT "commodity_prices_commodity_commodities_commodity_fk" FOREIGN KEY ("commodity") REFERENCES "public"."commodities"("commodity") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_fields" ADD CONSTRAINT "farm_fields_farmer_id_farmer_profiles_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_recommendations" ADD CONSTRAINT "farm_recommendations_farm_field_id_farm_fields_id_fk" FOREIGN KEY ("farm_field_id") REFERENCES "public"."farm_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_recommendations" ADD CONSTRAINT "farm_recommendations_alert_id_climate_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."climate_alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmer_actions" ADD CONSTRAINT "farmer_actions_farmer_id_farmer_profiles_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmer_actions" ADD CONSTRAINT "farmer_actions_recommendation_id_farm_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."farm_recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmer_actions" ADD CONSTRAINT "farmer_actions_alert_id_climate_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."climate_alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmer_profiles" ADD CONSTRAINT "farmer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmer_profiles" ADD CONSTRAINT "farmer_profiles_region_id_government_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."government_regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flood_risk_zones" ADD CONSTRAINT "flood_risk_zones_region_id_government_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."government_regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "government_regions" ADD CONSTRAINT "government_regions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_inventory" ADD CONSTRAINT "resource_inventory_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_target_region_government_regions_id_fk" FOREIGN KEY ("target_region") REFERENCES "public"."government_regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salinity_risk_zones" ADD CONSTRAINT "salinity_risk_zones_region_id_government_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."government_regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_chain_flows" ADD CONSTRAINT "supply_chain_flows_from_node_id_supply_chain_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."supply_chain_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_chain_flows" ADD CONSTRAINT "supply_chain_flows_to_node_id_supply_chain_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."supply_chain_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_chain_nodes" ADD CONSTRAINT "supply_chain_nodes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_chain_nodes" ADD CONSTRAINT "supply_chain_nodes_region_id_government_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."government_regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_chain_risks" ADD CONSTRAINT "supply_chain_risks_node_id_supply_chain_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."supply_chain_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_readings" ADD CONSTRAINT "weather_readings_region_id_government_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."government_regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_deliveries_uq" ON "alert_deliveries" USING btree ("alert_id","user_id","channel");--> statement-breakpoint
CREATE INDEX "alert_deliveries_user_idx" ON "alert_deliveries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_deliveries_status_idx" ON "alert_deliveries" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_uq" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "climate_alerts_active_idx" ON "climate_alerts" USING btree ("is_active","valid_until");--> statement-breakpoint
CREATE INDEX "climate_alerts_region_created_idx" ON "climate_alerts" USING btree ("region_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "climate_alerts_type_idx" ON "climate_alerts" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX "climate_alerts_geom_gist" ON "climate_alerts" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "climate_forecasts_date_idx" ON "climate_forecasts" USING btree ("forecast_date","source");--> statement-breakpoint
CREATE INDEX "climate_forecasts_location_gist" ON "climate_forecasts" USING gist ("location");--> statement-breakpoint
CREATE INDEX "farm_fields_farmer_idx" ON "farm_fields" USING btree ("farmer_id");--> statement-breakpoint
CREATE INDEX "farm_fields_crop_idx" ON "farm_fields" USING btree ("crop_type");--> statement-breakpoint
CREATE INDEX "farm_fields_geom_gist" ON "farm_fields" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "farm_recs_field_idx" ON "farm_recommendations" USING btree ("farm_field_id");--> statement-breakpoint
CREATE INDEX "farm_recs_alert_idx" ON "farm_recommendations" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "farm_recs_priority_idx" ON "farm_recommendations" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "farmer_actions_farmer_idx" ON "farmer_actions" USING btree ("farmer_id","action_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "farmer_actions_alert_idx" ON "farmer_actions" USING btree ("alert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "farmer_profiles_user_uq" ON "farmer_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "farmer_profiles_referral_uq" ON "farmer_profiles" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "farmer_profiles_region_idx" ON "farmer_profiles" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "farmer_profiles_location_gist" ON "farmer_profiles" USING gist ("location");--> statement-breakpoint
CREATE INDEX "flood_zones_region_idx" ON "flood_risk_zones" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "flood_zones_level_idx" ON "flood_risk_zones" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "flood_zones_geom_gist" ON "flood_risk_zones" USING gist ("geometry");--> statement-breakpoint
CREATE UNIQUE INDEX "gov_regions_code_uq" ON "government_regions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "gov_regions_org_idx" ON "government_regions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "gov_regions_geom_gist" ON "government_regions" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "job_runs_job_started_idx" ON "job_runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orgs_type_idx" ON "organizations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "orgs_verified_idx" ON "organizations" USING btree ("verified");--> statement-breakpoint
CREATE INDEX "orgs_name_trgm_idx" ON "organizations" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "rag_documents_source_idx" ON "rag_documents" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_inventory_org_type_uq" ON "resource_inventory" USING btree ("org_id","type");--> statement-breakpoint
CREATE INDEX "resource_requests_org_status_idx" ON "resource_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "resource_requests_region_idx" ON "resource_requests" USING btree ("target_region");--> statement-breakpoint
CREATE INDEX "salinity_zones_region_idx" ON "salinity_risk_zones" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "salinity_zones_level_idx" ON "salinity_risk_zones" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "salinity_zones_geom_gist" ON "salinity_risk_zones" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "satellite_scenes_date_idx" ON "satellite_scenes" USING btree ("scene_date");--> statement-breakpoint
CREATE INDEX "satellite_scenes_geom_gist" ON "satellite_scenes" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_org_idx" ON "subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sc_flows_from_idx" ON "supply_chain_flows" USING btree ("from_node_id");--> statement-breakpoint
CREATE INDEX "sc_flows_to_idx" ON "supply_chain_flows" USING btree ("to_node_id");--> statement-breakpoint
CREATE INDEX "sc_nodes_org_idx" ON "supply_chain_nodes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sc_nodes_region_idx" ON "supply_chain_nodes" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "sc_nodes_location_gist" ON "supply_chain_nodes" USING gist ("location");--> statement-breakpoint
CREATE INDEX "sc_risks_node_idx" ON "supply_chain_risks" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "sc_risks_commodity_idx" ON "supply_chain_risks" USING btree ("commodity","valid_from");--> statement-breakpoint
CREATE INDEX "usage_events_type_created_idx" ON "usage_events" USING btree ("event_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "usage_events_user_idx" ON "usage_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_orgs_org_idx" ON "user_organizations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_last_active_idx" ON "users" USING btree ("last_active");--> statement-breakpoint
CREATE INDEX "weather_readings_time_idx" ON "weather_readings" USING btree ("time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "weather_readings_region_time_idx" ON "weather_readings" USING btree ("region_id","time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "weather_readings_location_gist" ON "weather_readings" USING gist ("location");--> statement-breakpoint
CREATE INDEX "webhooks_org_idx" ON "webhooks" USING btree ("org_id");