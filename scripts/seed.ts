/**
 * Agri-SHIELD — Postgres seeder.
 * Author: Nitya Prakash Pandey
 *
 * Seeds PostgreSQL + PostGIS from the SAME deterministic generator the web app
 * uses in demo mode (`apps/web/server/data/store.ts`), so the database and the
 * in-memory store describe exactly the same 5 deltas / 22 districts / 50
 * farmers / 20 supply-chain nodes. On top of that it loads 90 days of real
 * ERA5 reanalysis weather per district from the free Open-Meteo archive API.
 *
 *   pnpm db:up && pnpm db:migrate && pnpm db:rls && pnpm db:seed
 *
 * Env:
 *   DATABASE_URL   postgres connection (default: local docker-compose)
 *   SEED_OFFLINE   "true" → skip network (no live risk overlay, cached ERA5 only)
 *
 * Idempotent: store ids map to deterministic UUIDs and every run truncates and
 * reloads inside a single transaction.
 */
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getStore, type DistrictRecord, type Store } from "../apps/web/server/data/store";
import { PERMISSIONS } from "../apps/web/lib/rbac";
import { closeDb, getDb, getSql, DEFAULT_DATABASE_URL } from "../packages/db/src/client";
import * as t from "../packages/db/src/schema";
import { asMultiPolygon, type GeoJSONGeometry } from "../packages/db/src/schema";
import { sql } from "../packages/db/src/index";

const HERE = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, ".cache");
const OFFLINE = process.env.SEED_OFFLINE === "true" || process.env.AGRI_OFFLINE === "true";
const DAY = 86_400_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

const NAMESPACE = "agri-shield.seed.v1";

/** RFC 4122 v5-style UUID from a store id → stable FKs across runs. */
function uid(storeId: string): string {
  const h = createHash("sha1").update(`${NAMESPACE}:${storeId}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const point = (lon: number, lat: number): GeoJSONGeometry => ({ type: "Point", coordinates: [lon, lat] });
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const riskLevel = (s: number) => (s >= 80 ? "critical" : s >= 60 ? "high" : s >= 35 ? "medium" : "low") as "low" | "medium" | "high" | "critical";

/** scrypt password hash (format: scrypt$N$saltHex$hashHex). Demo passwords only. */
function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString("hex")}$${hash.toString("hex")}`;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function chunk<T>(rows: T[], size = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const log = (msg: string) => console.log(`  ${msg}`);

// ─── ERA5 weather (Open-Meteo archive, cached) ─────────────────────────────

interface Era5Daily {
  time: string[];
  precipitation_sum: (number | null)[];
  temperature_2m_mean: (number | null)[];
  relative_humidity_2m_mean: (number | null)[];
  wind_speed_10m_max: (number | null)[];
  soil_moisture_0_to_7cm_mean: (number | null)[];
}

async function loadEra5(districts: DistrictRecord[]): Promise<{ daily: Era5Daily[]; source: string } | null> {
  const end = new Date(Date.now() - 6 * DAY); // ERA5 lags ~5 days
  const start = new Date(end.getTime() - 89 * DAY);
  const key = `era5-${isoDate(start)}-${isoDate(end)}-${districts.length}.json`;
  mkdirSync(CACHE_DIR, { recursive: true });
  if (!existsSync(join(CACHE_DIR, ".gitignore"))) writeFileSync(join(CACHE_DIR, ".gitignore"), "*\n");
  const file = join(CACHE_DIR, key);
  if (existsSync(file)) return { daily: JSON.parse(readFileSync(file, "utf8")), source: `cache ${key}` };

  if (!OFFLINE) {
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${districts.map((d) => d.lat.toFixed(4)).join(",")}` +
      `&longitude=${districts.map((d) => d.lon.toFixed(4)).join(",")}` +
      `&start_date=${isoDate(start)}&end_date=${isoDate(end)}` +
      `&daily=precipitation_sum,temperature_2m_mean,relative_humidity_2m_mean,wind_speed_10m_max,soil_moisture_0_to_7cm_mean&timezone=UTC`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45_000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Agri-SHIELD-seed/1.0" } });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { daily: Era5Daily } | { daily: Era5Daily }[];
      const daily = (Array.isArray(json) ? json : [json]).map((r) => r.daily);
      if (daily.length !== districts.length) throw new Error(`expected ${districts.length} locations, got ${daily.length}`);
      writeFileSync(file, JSON.stringify(daily));
      return { daily, source: "archive-api.open-meteo.com (ERA5)" };
    } catch (e) {
      console.warn(`  ! ERA5 fetch failed (${(e as Error).message}) — trying older cache`);
    }
  }
  // fall back to the newest cache file for the same district set
  const older = readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith("era5-") && f.endsWith(`-${districts.length}.json`))
    .sort()
    .pop();
  if (older) return { daily: JSON.parse(readFileSync(join(CACHE_DIR, older), "utf8")), source: `stale cache ${older}` };
  return null;
}

// ─── Live risk overlay (same code path as the web app) ─────────────────────

async function applyLiveRisk(): Promise<string> {
  if (OFFLINE) return "seeded baseline (offline)";
  try {
    const { ensureLiveRiskAwait } = await import("../apps/web/server/live/district-risk");
    await ensureLiveRiskAwait(20_000);
    const live = getStore().districts.filter((d) => d.liveSource === "open-meteo").length;
    return live ? `Open-Meteo live overlay (${live}/${getStore().districts.length} districts)` : "seeded baseline (live feeds unreachable)";
  } catch (e) {
    return `seeded baseline (${(e as Error).message})`;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  console.log(`\nAgri-SHIELD seed → ${url.replace(/:[^:@/]+@/, ":****@")}`);

  // 0. connectivity check with a friendly error
  const pg = getSql(url);
  try {
    await pg`select 1`;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.error(`\n✖ Cannot reach PostgreSQL (${err.code ?? err.message}).`);
    console.error("  Start it with `pnpm db:up` (docker compose) or set DATABASE_URL, then run");
    console.error("  `pnpm db:migrate && pnpm db:rls && pnpm db:seed`.\n");
    process.exitCode = 1;
    return;
  }
  const [{ exists: migrated }] = await pg<{ exists: boolean }[]>`select to_regclass('public.farm_fields') is not null as exists`;
  if (!migrated) {
    console.error("\n✖ Schema not found — run `pnpm db:migrate` first.\n");
    process.exitCode = 1;
    return;
  }

  // 1. generate the demo world (deterministic) + optional live overlay
  const store: Store = getStore();
  const riskSource = await applyLiveRisk();
  log(`generator: ${store.users.length} users, ${store.farmers.length} farmers, ${store.fields.length} fields, ${store.alerts.length} alerts · risk: ${riskSource}`);
  const era5 = await loadEra5(store.districts);
  log(era5 ? `weather: ERA5 daily from ${era5.source}` : "weather: skipped (no network and no cache)");

  // 2. post-migrate (TimescaleDB hypertable when available)
  const post = readFileSync(join(HERE, "post-migrate.sql"), "utf8");
  await pg.unsafe(post);

  const userIds = new Set(store.users.map((u) => u.id));
  const districtById = new Map(store.districts.map((d) => [d.id, d]));
  const now = new Date();
  const counts: Record<string, number> = {};

  const db = getDb();
  await db.transaction(async (tx) => {
    const insert = async <T extends t.AnyTable>(table: T, rows: T["$inferInsert"][], label: string) => {
      for (const part of chunk(rows)) if (part.length) await tx.insert(table).values(part as never);
      counts[label] = rows.length;
    };

    await tx.execute(
      // order-independent thanks to CASCADE
      sql.raw(`TRUNCATE TABLE users, organizations, user_organizations, government_regions, farmer_profiles, farm_fields,
         supply_chain_nodes, weather_readings, flood_risk_zones, salinity_risk_zones, climate_forecasts, satellite_scenes,
         climate_alerts, alert_deliveries, farm_recommendations, resource_inventory, resource_requests, supply_chain_risks,
         farmer_actions, usage_events, subscriptions, webhooks, api_keys, audit_log, feature_flags, supply_chain_flows,
         commodities, commodity_prices, job_runs CASCADE`)
    );

    // ── organisations & users ──
    await insert(
      t.organizations,
      store.orgs.map((o) => ({
        id: uid(o.id),
        name: o.name,
        shortName: o.shortName,
        type: o.type,
        country: o.country,
        region: o.region,
        verified: o.verified,
        verifiedAt: o.verified ? o.createdAt : null,
        planTier: o.planTier,
        createdAt: o.createdAt,
      })),
      "organizations"
    );

    await insert(
      t.users,
      store.users.map((u) => ({
        id: uid(u.id),
        email: u.email,
        name: u.name,
        role: u.role,
        language: u.language,
        phone: u.phone,
        status: u.status,
        createdAt: u.createdAt,
        lastActive: u.lastActive,
        subscriptionTier: u.subscriptionTier,
        passwordHash: u.password ? hashPassword(u.password) : null,
      })),
      "users"
    );

    await insert(
      t.userOrganizations,
      store.users
        .filter((u) => u.orgId)
        .map((u) => ({
          userId: uid(u.id),
          orgId: uid(u.orgId!),
          roleInOrg: u.role,
          permissions: Object.entries(PERMISSIONS)
            .filter(([, roles]) => (roles as readonly string[]).includes(u.role))
            .map(([p]) => p),
          joinedAt: u.createdAt,
        })),
      "user_organizations"
    );

    // ── geography ──
    await insert(
      t.governmentRegions,
      store.districts.map((d) => ({
        id: uid(d.id),
        orgId: uid(d.orgId),
        code: d.id,
        name: d.name,
        adminLevel: "district" as const,
        geometry: asMultiPolygon(d.geometry),
        centroid: point(d.lon, d.lat),
        country: d.countryName,
        basin: d.basin,
        riverName: d.riverName,
        population: d.population,
        vulnerableAreaHa: d.vulnerableAreaHa,
        monitoredAreaHa: d.monitoredAreaHa,
        totalFarms: d.totalFarms,
        floodExposure: d.floodExposure,
        salinityExposure: d.salinityExposure,
        coastDistanceKm: d.coastDistanceKm,
        historicalFloods: d.historicalFloods,
      })),
      "government_regions"
    );

    // ── farmers & fields ──
    await insert(
      t.farmerProfiles,
      store.farmers.map((f) => ({
        id: uid(f.id),
        userId: uid(f.userId),
        farmName: f.farmName,
        totalAreaHa: f.totalAreaHa,
        primaryCrops: f.primaryCrops,
        experienceYears: f.experienceYears,
        location: point(f.lon, f.lat),
        district: districtById.get(f.districtId)?.name ?? f.districtId,
        regionId: uid(f.districtId),
        country: f.country,
        floodHistory: f.floodHistory,
        salinityObserved: f.salinityObserved,
        hasInsurance: f.hasInsurance,
        referralCode: f.referralCode,
        referrals: f.referrals,
        notificationPrefs: f.notificationPrefs,
      })),
      "farmer_profiles"
    );

    await insert(
      t.farmFields,
      store.fields.map((f) => ({
        id: uid(f.id),
        farmerId: uid(f.farmerId),
        name: f.name,
        areaHa: f.areaHa,
        cropType: f.cropType,
        plantingDate: isoDate(f.plantingDate),
        expectedHarvest: isoDate(f.expectedHarvest),
        soilType: f.soilType,
        irrigationType: f.irrigationType,
        geometry: f.geometry,
        elevationM: f.elevationM,
        ndviScore: f.ndviScore,
        ndviHistory: f.ndviHistory,
        lastSatelliteScan: f.lastSatelliteScan,
        floodRisk: f.floodRisk,
        salinityRisk: f.salinityRisk,
        soilEcDsM: f.soilEc,
      })),
      "farm_fields"
    );

    // ── risk zones (current district assessment) ──
    const floodModel = riskSource.startsWith("Open-Meteo") ? "web-formula-v1.2+open-meteo" : "seed-baseline";
    await insert(
      t.floodRiskZones,
      store.districts.map((d) => ({
        regionId: uid(d.id),
        geometry: d.geometry,
        riskLevel: riskLevel(d.floodRisk),
        floodProbability24h: d.floodProb24h,
        floodProbability48h: d.floodProb48h,
        floodProbability72h: d.floodProb72h,
        floodProbability7d: Math.min(0.99, Math.round(d.floodProb72h * 1.12 * 100) / 100),
        estimatedDepthM: Math.max(0, Math.round((d.floodProb72h - 0.35) * 1.6 * 100) / 100),
        lastUpdated: d.lastUpdated,
        modelVersion: floodModel,
        confidenceScore: d.liveSource === "open-meteo" ? 0.82 : 0.6,
      })),
      "flood_risk_zones"
    );
    await insert(
      t.salinityRiskZones,
      store.districts.map((d) => ({
        regionId: uid(d.id),
        geometry: d.geometry,
        ecCurrentDsM: d.ecCurrent,
        ecPredicted30d: d.ecPredicted30d,
        // intrusion front estimate: exposure-weighted reach up the tidal river
        intrusionDepthKm: Math.round(d.salinityExposure * Math.min(1, d.ecPredicted30d / 9) * 80 * 10) / 10,
        riskLevel: riskLevel(d.salinityRisk),
        affectedAreaHa: Math.round((d.vulnerableAreaHa * d.salinityRisk) / 100),
        lastUpdated: d.lastUpdated,
      })),
      "salinity_risk_zones"
    );

    // ── alerts, deliveries, recommendations, actions ──
    await insert(
      t.climateAlerts,
      store.alerts.map((a) => ({
        id: uid(a.id),
        alertType: a.alertType,
        severity: a.severity,
        regionId: uid(a.districtId),
        geometry: districtById.get(a.districtId)?.geometry ?? null,
        title: a.title,
        description: a.description,
        predictedImpact: a.predictedImpact,
        recommendedActions: a.recommendedActions,
        channels: a.channels,
        source: a.source,
        validFrom: a.validFrom,
        validUntil: a.validUntil,
        createdAt: a.createdAt,
        createdBy: a.createdBy !== "system" && userIds.has(a.createdBy) ? uid(a.createdBy) : null,
        isActive: a.isActive,
        deliveryStats: a.deliveries,
      })),
      "climate_alerts"
    );

    // Per-user delivery rows: every registered farmer in an active alert's district,
    // on every channel both the alert and the farmer's preferences allow.
    const deliveries = new Map<string, t.AnyInsert<typeof t.alertDeliveries>>();
    for (const a of store.alerts.filter((x) => x.isActive)) {
      for (const f of store.farmers.filter((x) => x.districtId === a.districtId)) {
        for (const ch of a.channels.filter((c) => f.notificationPrefs.channels.includes(c))) {
          deliveries.set(`${a.id}|${f.userId}|${ch}`, {
            alertId: uid(a.id),
            userId: uid(f.userId),
            channel: ch,
            status: ch === "app" ? "delivered" : "simulated",
            provider: ch === "app" ? "in-app" : "outbox",
            attempts: 1,
            deliveredAt: a.createdAt,
            readAt: ch === "app" ? new Date(a.createdAt.getTime() + 40 * 60_000) : null,
            actioned: false,
            createdAt: a.createdAt,
          });
        }
      }
    }
    // historical deliveries implied by recorded farmer actions (feedback loop)
    for (const act of store.farmerActions) {
      const farmer = store.farmers.find((f) => f.id === act.farmerId);
      const alert = act.alertId ? store.alerts.find((x) => x.id === act.alertId) : undefined;
      if (!farmer || !alert) continue;
      deliveries.set(`${alert.id}|${farmer.userId}|app`, {
        alertId: uid(alert.id),
        userId: uid(farmer.userId),
        channel: "app",
        status: "delivered",
        provider: "in-app",
        attempts: 1,
        deliveredAt: alert.createdAt,
        readAt: new Date(alert.createdAt.getTime() + 30 * 60_000),
        actioned: true,
        createdAt: alert.createdAt,
      });
    }
    await insert(t.alertDeliveries, [...deliveries.values()], "alert_deliveries");

    await insert(
      t.farmRecommendations,
      store.recommendations.map((r) => ({
        id: uid(r.id),
        farmFieldId: uid(r.fieldId),
        alertId: r.alertId ? uid(r.alertId) : null,
        recommendationType: r.recommendationType,
        title: r.title,
        description: r.description,
        priority: r.priority,
        actions: r.actions,
        confidenceScore: r.confidenceScore,
        generatedBy: r.generatedBy,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      })),
      "farm_recommendations"
    );

    const recIds = new Set(store.recommendations.map((r) => r.id));
    const alertIds = new Set(store.alerts.map((a) => a.id));
    await insert(
      t.farmerActions,
      store.farmerActions.map((a) => ({
        id: uid(a.id),
        farmerId: uid(a.farmerId),
        recommendationId: a.recommendationId && recIds.has(a.recommendationId) ? uid(a.recommendationId) : null,
        alertId: a.alertId && alertIds.has(a.alertId) ? uid(a.alertId) : null,
        actionTaken: a.actionTaken,
        actionDate: a.actionDate,
        outcome: a.outcome,
        cropSavedPct: a.cropSavedPct,
      })),
      "farmer_actions"
    );

    // ── government resources ──
    await insert(
      t.resourceInventory,
      store.inventory.map((i) => ({
        id: uid(i.id),
        orgId: uid(i.orgId),
        type: i.type,
        label: i.label,
        unit: i.unit,
        total: i.total,
        deployed: i.deployed,
        depots: i.depots,
      })),
      "resource_inventory"
    );
    await insert(
      t.resourceRequests,
      store.resourceRequests.map((r) => ({
        id: uid(r.id),
        orgId: uid(r.orgId),
        requestedBy: uid(r.requestedBy),
        resourceType: r.resourceType,
        quantity: r.quantity,
        targetRegion: uid(r.targetDistrictId),
        status: r.status,
        priority: r.priority,
        notes: r.notes,
        vehicle: r.vehicle,
        approvedBy: r.approvedBy && userIds.has(r.approvedBy) ? uid(r.approvedBy) : null,
        approvedAt: r.approvedAt,
        timeline: r.timeline.map((s) => ({ status: s.status, at: s.at.toISOString(), by: s.by })),
        createdAt: r.createdAt,
      })),
      "resource_requests"
    );

    // ── supply chain ──
    await insert(
      t.supplyChainNodes,
      store.nodes.map((n) => ({
        id: uid(n.id),
        orgId: uid(n.orgId),
        name: n.name,
        type: n.type,
        regionId: uid(n.districtId),
        country: n.country,
        location: point(n.lon, n.lat),
        capacityTonnes: n.capacityTonnes,
        utilizationPct: n.utilizationPct,
        primaryCommodities: n.primaryCommodities,
        riskScore: n.riskScore,
        floodRisk: n.floodRisk,
        salinityRisk: n.salinityRisk,
      })),
      "supply_chain_nodes"
    );
    await insert(
      t.supplyChainFlows,
      store.flows.map((f) => ({ id: uid(f.id), fromNodeId: uid(f.from), toNodeId: uid(f.to), commodity: f.commodity, tonnesPerWeek: f.tonnesPerWeek })),
      "supply_chain_flows"
    );
    await insert(
      t.commodities,
      store.commodities.map((c) => ({
        commodity: c.commodity,
        unit: c.unit,
        basePriceUsd: c.basePriceUsd,
        producingRegionIds: c.producingDistricts.map(uid),
        floodSensitivity: c.floodSensitivity,
        salinitySensitivity: c.salinitySensitivity,
        weeklyVolumeTonnes: c.weeklyVolumeTonnes,
      })),
      "commodities"
    );
    await insert(
      t.commodityPrices,
      store.commodities.flatMap((c) => c.priceHistory.map((p) => ({ commodity: c.commodity, date: p.date, priceUsd: p.price }))),
      "commodity_prices"
    );

    // node × commodity disruption outlook for the next 14 days (from current node risk)
    const priceOf = new Map(store.commodities.map((c) => [c.commodity, c.basePriceUsd]));
    const scRisks: t.AnyInsert<typeof t.supplyChainRisks>[] = [];
    for (const n of store.nodes) {
      for (const c of n.primaryCommodities) {
        const pFlood = Math.round((n.floodRisk / 100) * 100) / 100;
        const pSalt = Math.round((n.salinityRisk / 100) * 0.8 * 100) / 100;
        const throughput = (n.capacityTonnes * n.utilizationPct) / 100 / 26; // ~2-week share
        for (const [riskType, p, lossFrac] of [
          ["flood_disruption", pFlood, 0.18],
          ["salinity_quality", pSalt, 0.07],
        ] as const) {
          if (p < 0.35) continue;
          const tonnes = Math.round(throughput * p * lossFrac);
          scRisks.push({
            nodeId: uid(n.id),
            commodity: c,
            riskType,
            probability: p,
            estimatedLossTonnes: tonnes,
            estimatedLossUsd: Math.round(tonnes * (priceOf.get(c) ?? 400)),
            mitigationOptions:
              riskType === "flood_disruption"
                ? [{ action: "pre-position stock at inland warehouse", costUsd: Math.round(tonnes * 12) }, { action: "reroute via alternate port", costUsd: Math.round(tonnes * 18) }]
                : [{ action: "source from low-EC districts", costUsd: Math.round(tonnes * 9) }],
            validFrom: isoDate(now),
            validTo: isoDate(new Date(now.getTime() + 14 * DAY)),
          });
        }
      }
    }
    await insert(t.supplyChainRisks, scRisks, "supply_chain_risks");

    await insert(
      t.webhooks,
      store.webhooks.map((w) => ({
        id: uid(w.id),
        orgId: uid(w.orgId),
        url: w.url,
        commodities: w.commodities,
        riskThreshold: w.riskThreshold,
        events: w.events,
        active: w.active,
        secret: w.secret,
        lastDeliveryAt: w.lastDelivery?.at ?? null,
        lastDeliveryStatus: w.lastDelivery?.status ?? null,
        createdAt: w.createdAt,
      })),
      "webhooks"
    );
    await insert(
      t.apiKeys,
      store.apiKeys.map((k) => {
        const extra = k as unknown as { hash?: string; keyHash?: string };
        // demo keys: derive a stable secret suffix; production stores only the hash
        const derived = `${k.prefix}${sha256(`${NAMESPACE}:${k.id}`).slice(0, 28)}`;
        return {
          id: uid(k.id),
          orgId: uid(k.orgId),
          name: k.name,
          prefix: k.prefix,
          keyHash: extra.keyHash ?? extra.hash ?? sha256(derived),
          scopes: k.scopes,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsed,
        };
      }),
      "api_keys"
    );

    // ── governance ──
    await insert(
      t.auditLog,
      store.audit.map((a) => ({
        id: uid(a.id),
        at: a.at,
        userId: userIds.has(a.userId) ? uid(a.userId) : null,
        userName: a.userName,
        action: a.action,
        entity: a.entity,
        entityId: a.entityId,
        details: a.details,
      })),
      "audit_log"
    );
    await insert(
      t.featureFlags,
      store.flags.map((f) => ({ key: f.key, description: f.description, enabled: f.enabled, rolloutPct: f.rolloutPct })),
      "feature_flags"
    );
    await insert(
      t.subscriptions,
      store.subscriptions.map((s) => ({
        id: uid(s.id),
        userId: s.userId ? uid(s.userId) : null,
        orgId: s.orgId ? uid(s.orgId) : null,
        plan: s.plan,
        status: s.status,
        provider: s.provider,
        mrrUsd: s.mrrUsd,
        currentPeriodStart: isoDate(new Date(s.currentPeriodEnd.getTime() - 30 * DAY)),
        currentPeriodEnd: isoDate(s.currentPeriodEnd),
        trialEndsAt: s.status === "trialing" ? new Date(now.getTime() + 14 * DAY) : null,
      })),
      "subscriptions"
    );

    // ── ERA5 weather history (TimescaleDB hypertable when available) ──
    if (era5) {
      const rows: t.AnyInsert<typeof t.weatherReadings>[] = [];
      store.districts.forEach((d, i) => {
        const daily = era5.daily[i];
        if (!daily) return;
        daily.time.forEach((day, k) => {
          const sm = daily.soil_moisture_0_to_7cm_mean[k];
          rows.push({
            time: new Date(`${day}T00:00:00Z`),
            stationId: uid(`station:${d.id}`),
            regionId: uid(d.id),
            location: point(d.lon, d.lat),
            temperatureC: daily.temperature_2m_mean[k] ?? null,
            humidityPct: daily.relative_humidity_2m_mean[k] ?? null,
            rainfallMm: daily.precipitation_sum[k] ?? null,
            windSpeedKmh: daily.wind_speed_10m_max[k] ?? null,
            soilMoisturePct: sm == null ? null : Math.round(sm * 1000) / 10,
            source: "era5",
          });
        });
      });
      await insert(t.weatherReadings, rows, "weather_readings");
    } else counts.weather_readings = 0;
  });

  console.log("\n✔ Seed complete");
  console.table(counts);
}

main()
  .catch((e) => {
    console.error("\n✖ Seed failed:", e instanceof Error ? e.message : e);
    if (e && typeof e === "object" && "detail" in e) console.error("  detail:", (e as { detail?: string }).detail);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => {});
    // the live-risk refresher may leave timers/sockets open
    setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
  });
