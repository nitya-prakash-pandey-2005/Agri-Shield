/**
 * governmentRouter — Government portal (spec §4.5).
 * Every procedure is guarded by "view_gov_dashboard"; mutations additionally
 * by create_alert / request_resources / approve_resources. Data is scoped to
 * the caller's ministry (platform admins pass `country`).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { AlertChannel, AlertSeverity, AlertType, ResourceType } from "@agri-shield/types";
import { can } from "@/lib/rbac";
import { permitted, router } from "../trpc";
import { audit, getStore, nextId, type DistrictRecord, type ResourceRequestRecord } from "../data/store";
import { COUNTRIES } from "../data/geography";
import {
  districtAreaKm2,
  districtEconomics,
  districtNeeds,
  districtResourceBalance,
  districtsInPolygon,
  fleetFor,
  haversineKm,
  RESOURCE_TYPES,
  resolveScope,
  seasonOf,
  sensorInventory,
  SENSOR_TYPES,
  type Scope,
  type ScopeUser,
} from "../data/gov-model";
import { BUDGET_CATEGORIES, computeBudget, optimisePortfolio, type BudgetBaseline } from "../data/gov-budget";
import { deliveriesFor, govState, rulesFor, type EscalationRule } from "../data/gov-store";
import {
  ALERT_TEMPLATES,
  broadcastAlert,
  cancelScheduledAlert,
  escalationMonitor,
  evaluateEscalations,
  historicalResponseRates,
  processScheduledAlerts,
  refreshReceipts,
  renderApp,
  renderEmail,
  renderSms,
  renderWhatsApp,
  rosterSize,
  scheduleAlert,
  smsSegments,
  translateMessage,
} from "../services/alerts";
import { ensureLiveRiskAwait, liveRiskStatus } from "../live/district-risk";
import { getHazardEvents } from "../live/events";
import { getForecast, getHistory, getRiverDischarge, weatherLabel } from "../live/open-meteo";
import { drySeasonFactor } from "../risk/scoring";
import { publish } from "../realtime";

const view = permitted("view_gov_dashboard");
const alerter = permitted("create_alert");
const requester = permitted("request_resources");
const approver = permitted("approve_resources");

const HOUR = 3_600_000;
const DAY = 86_400_000;

const countryIn = z.object({ country: z.string().length(2).optional() });
const zAlertType = z.enum(["flood", "salinity", "drought", "storm", "frost"]);
const zSeverity = z.enum(["watch", "warning", "emergency"]);
const zChannel = z.enum(["app", "sms", "whatsapp", "email"]);
const zResource = z.enum(["pumps", "sandbags", "evacuation_buses", "medical", "food_aid"]);
const zPriority = z.enum(["low", "medium", "high", "critical"]);

type Ctx = { user: ScopeUser };
const scopeOf = (ctx: Ctx, country?: string) => resolveScope(ctx.user, country);

function districtOrThrow(scope: Scope, id: string): DistrictRecord {
  const d = scope.districts.find((x) => x.id === id);
  if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "District not in your jurisdiction" });
  return d;
}

const isActive = (a: { isActive: boolean; validUntil: Date }, now = Date.now()) => a.isActive && a.validUntil.getTime() > now;
const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();

function orgAlerts(scope: Scope) {
  return getStore().alerts.filter((a) => scope.districtIds.has(a.districtId));
}

function requestOrThrow(scope: Scope, id: string): ResourceRequestRecord {
  const r = getStore().resourceRequests.find((x) => x.id === id && x.orgId === scope.orgId);
  if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Resource request not found" });
  return r;
}

function inventoryOf(scope: Scope, type: ResourceType) {
  const inv = getStore().inventory.find((i) => i.orgId === scope.orgId && i.type === type);
  if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: `No ${type} inventory for this ministry` });
  return inv;
}

function publishResource(scope: Scope, r: ResourceRequestRecord) {
  const ev = { type: "resource.updated" as const, requestId: r.id, status: r.status };
  publish(`gov:${scope.orgId}`, ev);
  publish(`district:${r.targetDistrictId}`, ev);
}

/** keep reads cheap but fresh: scheduled sends, escalations, receipts */
async function housekeeping(scope: Scope) {
  await processScheduledAlerts();
  await evaluateEscalations({ orgId: scope.orgId });
  refreshReceipts();
}

function shortagesFor(scope: Scope) {
  const store = getStore();
  const byDistrict = scope.districts.map((d) => ({ d, bal: districtResourceBalance(scope.orgId, d), econ: districtEconomics(d) }));
  return RESOURCE_TYPES.map((type) => {
    const inv = store.inventory.find((i) => i.orgId === scope.orgId && i.type === type);
    const total = inv?.total ?? 0;
    const deployed = inv?.deployed ?? 0;
    const available = Math.max(0, total - deployed);
    const needed = byDistrict.reduce((s, x) => s + x.bal.find((b) => b.type === type)!.needed, 0);
    const shortDistricts = byDistrict.filter((x) => x.bal.find((b) => b.type === type)!.gap > 0);
    const farms = shortDistricts.filter((x) => x.d.riskLevel === "high" || x.d.riskLevel === "critical").reduce((s, x) => s + x.econ.farmsAtRisk, 0) || shortDistricts.reduce((s, x) => s + x.econ.farmsAtRisk, 0);
    const availablePct = total ? Math.round((available / total) * 100) : 0;
    const level: "critical" | "warning" | "ok" = needed > 0 && available < needed * 0.5 ? "critical" : needed > available || availablePct < 15 ? "warning" : "ok";
    const label = inv?.label ?? type;
    return {
      type,
      label,
      unit: inv?.unit ?? "units",
      total,
      deployed,
      available,
      availablePct,
      needed,
      gap: Math.max(0, needed - available),
      level,
      districts: shortDistricts.map((x) => x.d.name),
      message:
        level === "ok"
          ? `${label}: ${available.toLocaleString()} available covers modelled need (${needed.toLocaleString()}).`
          : needed > available
            ? `${label} inventory at ${availablePct}% — ${farms.toLocaleString()} farms in high-risk zones require ${label.toLowerCase()} (${needed.toLocaleString()} needed, ${available.toLocaleString()} available${shortDistricts.length ? `; gaps in ${shortDistricts.map((x) => x.d.name).join(", ")}` : ""}).`
            : `${label} inventory at ${availablePct}% of fleet — current need (${needed.toLocaleString()}) is covered, but only ${available.toLocaleString()} ${inv?.unit ?? "units"} remain for surge; ${deployed.toLocaleString()} are deployed.`,
    };
  });
}

/** Per-channel delivery breakdown: exact from receipts, otherwise estimated from the channel mix. */
const CHANNEL_MIX: Record<AlertChannel, number> = { sms: 0.52, app: 0.3, whatsapp: 0.15, email: 0.03 };
function channelBreakdown(alert: ReturnType<typeof orgAlerts>[number]) {
  const ds = deliveriesFor(alert.id);
  if (ds.length) {
    const rows = new Map<AlertChannel, { channel: AlertChannel; sent: number; delivered: number; read: number; actioned: number; failed: number }>();
    const rates = historicalResponseRates();
    for (const d of ds) {
      const r = rows.get(d.channel) ?? { channel: d.channel, sent: 0, delivered: 0, read: 0, actioned: 0, failed: 0 };
      const roster = d.recipientKind === "roster";
      r.sent += d.count;
      if (d.status === "failed") r.failed += d.count;
      else r.delivered += roster ? Math.round(d.count * rates.delivery) : d.count;
      if (d.readAt) r.read += roster ? Math.round(d.count * rates.read) : 1;
      if (d.actionedAt) r.actioned += roster ? Math.round(d.count * rates.action) : 1;
      rows.set(d.channel, r);
    }
    return { estimated: false, rows: [...rows.values()] };
  }
  const w = alert.channels.reduce((s, c) => s + CHANNEL_MIX[c], 0) || 1;
  const k = (c: AlertChannel, v: number) => Math.round((v * CHANNEL_MIX[c]) / w);
  return {
    estimated: true,
    rows: alert.channels.map((c) => ({ channel: c, sent: k(c, alert.deliveries.sent), delivered: k(c, alert.deliveries.delivered), read: k(c, alert.deliveries.read), actioned: k(c, alert.deliveries.actioned), failed: k(c, alert.deliveries.sent - alert.deliveries.delivered) })),
  };
}

function budgetBaseline(scope: Scope): BudgetBaseline & { floodYears: { year: number; lossUsd: number }[] } {
  const years = new Map<number, number>();
  for (const d of scope.districts) for (const h of d.historicalFloods) years.set(h.year, (years.get(h.year) ?? 0) + h.lossUsd);
  const floodYears = [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, lossUsd]) => ({ year, lossUsd }));
  const floodAnnual = floodYears.reduce((s, y) => s + y.lossUsd, 0) / Math.max(1, floodYears.length);
  const month = new Date().getMonth() + 1;
  const salAnnual = scope.districts.reduce((s, d) => s + districtEconomics(d).salinityLossUsd / Math.max(0.35, drySeasonFactor(month, d.lat)), 0);
  return { floodAnnualLossUsd: Math.round(floodAnnual), salinityAnnualLossUsd: Math.round(salAnnual), floodYears };
}

// ─── Router ───────────────────────────────────────────────────────────────

export const governmentRouter = router({
  ping: view.query(() => ({ ok: true })),

  /** Portal context: jurisdiction, permissions, live-data/scenario status. */
  getContext: view.input(countryIn.optional()).query(({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    const store = getStore();
    return {
      orgId: scope.orgId,
      orgName: scope.orgName,
      countryCode: scope.countryCode,
      countryName: scope.countryName,
      countries: ctx.user.role === "platform_admin" ? COUNTRIES.map((c) => ({ code: c.code, name: c.name })) : null,
      districts: scope.districts.map((d) => ({ id: d.id, name: d.name, lat: d.lat, lon: d.lon, riskLevel: d.riskLevel })),
      center: COUNTRIES.find((c) => c.code === scope.countryCode)!.center,
      permissions: {
        createAlert: can(ctx.user.role, "create_alert"),
        requestResources: can(ctx.user.role, "request_resources"),
        approveResources: can(ctx.user.role, "approve_resources"),
      },
      scenario: store.scenario,
      live: liveRiskStatus(),
      liveDistricts: scope.districts.filter((d) => d.liveSource === "open-meteo").length,
      lastUpdated: scope.districts.reduce((m, d) => (d.lastUpdated > m ? d.lastUpdated : m), new Date(0)),
      badges: {
        pendingRequests: store.resourceRequests.filter((r) => r.orgId === scope.orgId && r.status === "pending").length,
        activeAlerts: orgAlerts(scope).filter((a) => isActive(a)).length,
      },
    };
  }),

  /** KPI row (spec §4.5 Overview). */
  getOverview: view.input(countryIn.optional()).query(async ({ ctx, input }) => {
    await ensureLiveRiskAwait(5000);
    const scope = scopeOf(ctx, input?.country);
    await housekeeping(scope);
    const store = getStore();
    const now = Date.now();
    const alerts = orgAlerts(scope);
    const active = alerts.filter((a) => isActive(a, now));
    const activeDistricts = new Set(active.map((a) => a.districtId));
    const hot = scope.districts.filter((d) => d.riskLevel === "high" || d.riskLevel === "critical");
    const zoneDistricts = scope.districts.filter((d) => hot.includes(d) || activeDistricts.has(d.id));
    const econ = scope.districts.map((d) => ({ d, e: districtEconomics(d) }));

    const dispatchedSince = (t0: number, t1: number) =>
      store.resourceRequests
        .filter((r) => r.orgId === scope.orgId)
        .filter((r) => r.timeline.some((t) => t.status === "dispatched" && t.at.getTime() >= t0 && t.at.getTime() < t1));
    const today = startOfToday();
    const dToday = dispatchedSince(today, now + 1);
    const dYesterday = dispatchedSince(today - DAY, today);
    const week = alerts.filter((a) => a.createdAt.getTime() > now - 7 * DAY);
    const prevWeek = alerts.filter((a) => a.createdAt.getTime() > now - 14 * DAY && a.createdAt.getTime() <= now - 7 * DAY);
    const sentWeek = week.reduce((s, a) => s + a.deliveries.sent, 0);
    const sentPrev = prevWeek.reduce((s, a) => s + a.deliveries.sent, 0);
    const lossNow = econ.reduce((s, x) => s + x.e.expectedLossUsd, 0);

    return {
      scope: { orgName: scope.orgName, countryName: scope.countryName, countryCode: scope.countryCode },
      kpis: {
        monitoredHa: scope.districts.reduce((s, d) => s + d.monitoredAreaHa, 0),
        districts: scope.districts.length,
        highRiskZones: hot.length,
        criticalZones: hot.filter((d) => d.riskLevel === "critical").length,
        highRiskNames: hot.map((d) => d.name),
        farmersInAlertZones: zoneDistricts.reduce((s, d) => s + districtEconomics(d).farmsInVulnerableZone, 0),
        registeredInAlertZones: store.farmers.filter((f) => zoneDistricts.some((d) => d.id === f.districtId)).length,
        resourcesDispatchedToday: dToday.reduce((s, r) => s + r.quantity, 0),
        dispatchesToday: dToday.length,
        dispatchesYesterday: dYesterday.length,
        alertsSentThisWeek: sentWeek,
        alertsIssuedThisWeek: week.length,
        alertsSentPrevWeek: sentPrev,
        estCropLossUsd: lossNow,
        cropValueAtRiskUsd: econ.reduce((s, x) => s + x.e.cropValueUsd, 0),
        activeAlerts: active.length,
      },
      topDistricts: econ
        .sort((a, b) => b.e.expectedLossUsd - a.e.expectedLossUsd)
        .slice(0, 5)
        .map(({ d, e }) => ({ id: d.id, name: d.name, riskLevel: d.riskLevel, floodProb72h: d.floodProb72h, salinityRisk: d.salinityRisk, expectedLossUsd: e.expectedLossUsd, farmsAtRisk: e.farmsAtRisk })),
      scenario: store.scenario,
      live: liveRiskStatus(),
      liveDistricts: scope.districts.filter((d) => d.liveSource === "open-meteo").length,
      generatedAt: new Date(),
    };
  }),

  /** District polygons + every map layer's value. */
  getRegionMap: view.input(countryIn.optional()).query(({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    const store = getStore();
    const now = Date.now();
    return scope.districts.map((d) => {
      const bal = districtResourceBalance(scope.orgId, d);
      const need = bal.reduce((s, b) => s + (b.needed ? 1 : 0), 0);
      const allocation = need ? Math.round(bal.filter((b) => b.needed).reduce((s, b) => s + b.coveragePct, 0) / need) : 100;
      const act = store.alerts.filter((a) => a.districtId === d.id && isActive(a, now));
      const areaKm2 = districtAreaKm2(d);
      const e = districtEconomics(d);
      const floodAlerts = store.alerts.filter((a) => a.districtId === d.id && a.alertType === "flood").length;
      return {
        id: d.id,
        name: d.name,
        geometry: d.geometry,
        lat: d.lat,
        lon: d.lon,
        riverName: d.riverName,
        riskLevel: d.riskLevel,
        floodRisk: d.floodRisk,
        salinityRisk: d.salinityRisk,
        floodProb24h: d.floodProb24h,
        floodProb48h: d.floodProb48h,
        floodProb72h: d.floodProb72h,
        ecCurrent: d.ecCurrent,
        rainfall72hMm: d.rainfall72hMm,
        riverDischargeM3s: d.riverDischargeM3s,
        totalFarms: d.totalFarms,
        areaKm2,
        farmerDensity: Math.round(d.totalFarms / Math.max(1, areaKm2)),
        farmsAtRisk: e.farmsAtRisk,
        expectedLossUsd: e.expectedLossUsd,
        resourceAllocationPct: allocation,
        deployedUnits: bal.reduce((s, b) => s + b.deployed, 0),
        historicalEvents: d.historicalFloods.length,
        floodAlertsArchive: floodAlerts,
        historicalLossUsd: d.historicalFloods.reduce((s, h) => s + h.lossUsd, 0),
        worstYear: [...d.historicalFloods].sort((a, b) => b.areaHa - a.areaHa)[0] ?? null,
        activeAlerts: act.length,
        maxSeverity: act.reduce<AlertSeverity | null>((m, a) => (!m || ["watch", "warning", "emergency"].indexOf(a.severity) > ["watch", "warning", "emergency"].indexOf(m) ? a.severity : m), null),
        liveSource: d.liveSource,
        lastUpdated: d.lastUpdated,
      };
    });
  }),

  /** Drill-down panel for one district (map click). */
  getDistrict: view.input(countryIn.extend({ id: z.string().min(2).max(40) })).query(async ({ ctx, input }) => {
    const scope = scopeOf(ctx, input.country);
    const d = districtOrThrow(scope, input.id);
    const store = getStore();
    const e = districtEconomics(d);
    const farmers = store.farmers
      .filter((f) => f.districtId === d.id)
      .map((f) => {
        const u = store.users.find((x) => x.id === f.userId);
        const fields = store.fields.filter((x) => x.farmerId === f.id);
        const flood = Math.max(0, ...fields.map((x) => x.floodRisk));
        const sal = Math.max(0, ...fields.map((x) => x.salinityRisk));
        return {
          id: f.id,
          name: u?.name ?? f.farmName,
          farmName: f.farmName,
          areaHa: f.totalAreaHa,
          fields: fields.length,
          crops: f.primaryCrops,
          floodRisk: flood,
          salinityRisk: sal,
          maxRisk: Math.max(flood, sal),
          channels: f.notificationPrefs.channels,
          language: u?.language ?? "en",
          phone: u?.phone ? `${u.phone.slice(0, 5)}•••${u.phone.slice(-2)}` : null,
          hasInsurance: f.hasInsurance,
        };
      })
      .sort((a, b) => b.maxRisk - a.maxRisk);

    const pt = { lat: d.lat, lon: d.lon };
    const [fc, fl] = await Promise.allSettled([getForecast([pt], 4), getRiverDischarge([pt], 7)]);
    let weather = null as null | {
      current: { tempC: number; humidity: number; precipMm: number; windKmh: number; label: string } | null;
      hourly: { time: string; precipMm: number; precipProb: number }[];
      daily: { date: string; precipMm: number; precipProb: number; tMax: number | null; tMin: number | null }[];
    };
    if (fc.status === "fulfilled" && fc.value[0]) {
      const f = fc.value[0];
      const i0 = Math.max(0, f.hourly.time.findIndex((t) => new Date(t).getTime() > Date.now()) - 1);
      weather = {
        current: f.current ? { tempC: f.current.temperature_2m, humidity: f.current.relative_humidity_2m, precipMm: f.current.precipitation, windKmh: f.current.wind_speed_10m, label: weatherLabel(f.current.weather_code) } : null,
        hourly: f.hourly.time.slice(i0, i0 + 72).map((time, k) => ({ time, precipMm: f.hourly.precipitation[i0 + k] ?? 0, precipProb: f.hourly.precipitation_probability[i0 + k] ?? 0 })),
        daily: f.daily.time.map((date, k) => ({ date, precipMm: f.daily.precipitation_sum[k] ?? 0, precipProb: f.daily.precipitation_probability_max[k] ?? 0, tMax: f.daily.temperature_2m_max[k] ?? null, tMin: f.daily.temperature_2m_min[k] ?? null })),
      };
    }
    let discharge = null as null | { date: string; discharge: number | null; mean: number | null; max: number | null; forecast: boolean }[];
    if (fl.status === "fulfilled" && fl.value[0]) {
      const dd = fl.value[0].daily;
      const today = new Date().toISOString().slice(0, 10);
      discharge = dd.time.map((date, k) => ({ date, discharge: dd.river_discharge[k] ?? null, mean: dd.river_discharge_mean[k] ?? null, max: dd.river_discharge_max[k] ?? null, forecast: date >= today }));
      if (!discharge.some((x) => x.discharge != null)) discharge = null;
    }
    const hazards = (await getHazardEvents()).map((h) => ({ ...h, distanceKm: Math.round(haversineKm(d.lat, d.lon, h.lat, h.lon)) })).filter((h) => h.distanceKm < 500);
    return {
      id: d.id,
      name: d.name,
      adminLevel: "district" as const,
      countryName: d.countryName,
      basin: d.basin,
      riverName: d.riverName,
      population: d.population,
      totalFarms: d.totalFarms,
      monitoredAreaHa: d.monitoredAreaHa,
      vulnerableAreaHa: d.vulnerableAreaHa,
      coastDistanceKm: d.coastDistanceKm,
      riskLevel: d.riskLevel,
      floodRisk: d.floodRisk,
      salinityRisk: d.salinityRisk,
      floodProb: { h24: d.floodProb24h, h48: d.floodProb48h, h72: d.floodProb72h },
      ecCurrent: d.ecCurrent,
      ecPredicted30d: d.ecPredicted30d,
      rainfall72hMm: d.rainfall72hMm,
      riverDischargeM3s: d.riverDischargeM3s,
      riverDischargeMeanM3s: d.riverDischargeMeanM3s,
      seaLevelAnomalyM: d.seaLevelAnomalyM,
      liveSource: d.liveSource,
      lastUpdated: d.lastUpdated,
      economics: e,
      farmersAtRisk: { count: e.farmsAtRisk, registered: farmers.length, registeredAtRisk: farmers.filter((f) => f.maxRisk >= 60).length, list: farmers },
      resources: districtResourceBalance(scope.orgId, d),
      recentAlerts: store.alerts
        .filter((a) => a.districtId === d.id)
        .slice(0, 8)
        .map((a) => ({ id: a.id, title: a.title, alertType: a.alertType, severity: a.severity, createdAt: a.createdAt, active: isActive(a), deliveries: a.deliveries })),
      historicalFloods: [...d.historicalFloods].sort((a, b) => b.year - a.year),
      sensors: sensorInventory(d),
      weather,
      discharge,
      hazards,
    };
  }),

  /** Live GDACS + NASA EONET events, tagged with distance to the jurisdiction. */
  getHazards: view.input(countryIn.optional()).query(async ({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    const events = await getHazardEvents();
    return events.map((h) => {
      let nearest = { name: "", km: Infinity };
      for (const d of scope.districts) {
        const km = haversineKm(d.lat, d.lon, h.lat, h.lon);
        if (km < nearest.km) nearest = { name: d.name, km };
      }
      return { ...h, nearestDistrict: nearest.name, distanceKm: Math.round(nearest.km), inJurisdiction: nearest.km < 250 };
    });
  }),

  /** Ops feed seed: recent audit trail + escalations for this ministry. */
  getOpsFeed: view.input(countryIn.optional()).query(({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    const store = getStore();
    const orgUsers = new Set(store.users.filter((u) => u.orgId === scope.orgId).map((u) => u.id));
    const districtNames = scope.districts.map((d) => d.name);
    const items = store.audit
      .filter((a) => orgUsers.has(a.userId) || ((a.userId === "system" || a.userId === "user-admin-demo") && districtNames.some((n) => a.details.includes(n))))
      .filter((a) => a.action !== "auth.signin")
      .slice(0, 40)
      .map((a) => ({ id: a.id, at: a.at, kind: a.action, actor: a.userName, text: a.details, entity: a.entity }));
    return items;
  }),

  // ─── Resources ──────────────────────────────────────────────────────────

  getResourceInventory: view.input(countryIn.optional()).query(({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    const store = getStore();
    const needs = scope.districts.map((d) => districtNeeds(d));
    const rows = store.inventory
      .filter((i) => i.orgId === scope.orgId)
      .map((i) => {
        const available = Math.max(0, i.total - i.deployed);
        const needed = needs.reduce((s, n) => s + n[i.type], 0);
        return {
          id: i.id,
          type: i.type,
          label: i.label,
          unit: i.unit,
          total: i.total,
          deployed: i.deployed,
          available,
          availablePct: i.total ? Math.round((available / i.total) * 100) : 0,
          needed,
          depots: i.depots.map((dp) => ({ ...dp, districtId: scope.districts.find((d) => dp.name.startsWith(d.name))?.id ?? null })),
        };
      });
    const depotNames = [...new Set(rows.flatMap((r) => r.depots.map((d) => d.name)))];
    const depots = depotNames.map((name) => {
      const any = rows.flatMap((r) => r.depots).find((d) => d.name === name)!;
      return {
        name,
        lat: any.lat,
        lon: any.lon,
        districtId: any.districtId,
        coverageKm: Math.max(...rows.flatMap((r) => r.depots.filter((d) => d.name === name).map((d) => d.coverageKm))),
        stock: rows.map((r) => ({ type: r.type, label: r.label, unit: r.unit, quantity: r.depots.find((d) => d.name === name)?.quantity ?? 0 })),
      };
    });
    return { rows, depots, fleet: fleetFor(scope.orgId) };
  }),

  getResourceRequests: view.input(countryIn.extend({ status: z.enum(["pending", "approved", "dispatched", "delivered", "rejected"]).optional() }).optional()).query(({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    const store = getStore();
    const gs = govState();
    return store.resourceRequests
      .filter((r) => r.orgId === scope.orgId && (!input?.status || r.status === input.status))
      .map((r) => {
        const d = scope.districts.find((x) => x.id === r.targetDistrictId);
        const inv = store.inventory.find((i) => i.orgId === scope.orgId && i.type === r.resourceType);
        return {
          ...r,
          districtName: d?.name ?? r.targetDistrictId,
          districtRisk: d?.riskLevel ?? "low",
          resourceLabel: inv?.label ?? r.resourceType,
          unit: inv?.unit ?? "units",
          dispatch: gs.dispatch[r.id] ?? null,
        };
      });
  }),

  getShortages: view.input(countryIn.optional()).query(({ ctx, input }) => shortagesFor(scopeOf(ctx, input?.country))),

  requestResources: requester
    .input(countryIn.extend({ resourceType: zResource, quantity: z.number().int().min(1).max(100000), targetDistrictId: z.string().min(2).max(40), priority: zPriority, notes: z.string().max(500).optional() }))
    .mutation(({ ctx, input }) => {
      const scope = scopeOf(ctx, input.country);
      const d = districtOrThrow(scope, input.targetDistrictId);
      const now = new Date();
      const r: ResourceRequestRecord = {
        id: nextId("req"),
        orgId: scope.orgId,
        requestedBy: ctx.user.id,
        requestedByName: ctx.user.name,
        resourceType: input.resourceType,
        quantity: input.quantity,
        targetDistrictId: d.id,
        status: "pending",
        priority: input.priority,
        notes: input.notes?.trim() || null,
        vehicle: null,
        approvedBy: null,
        approvedAt: null,
        createdAt: now,
        timeline: [{ status: "pending", at: now, by: ctx.user.name }],
      };
      getStore().resourceRequests.unshift(r);
      audit({ userId: ctx.user.id, userName: ctx.user.name, action: "resource.request", entity: "resource_request", entityId: r.id, details: `Requested ${r.quantity} ${r.resourceType} for ${d.name} (${r.priority})` });
      publishResource(scope, r);
      return r;
    }),

  approveResourceRequest: approver.input(countryIn.extend({ id: z.string(), quantity: z.number().int().min(1).max(100000).optional(), note: z.string().max(300).optional() })).mutation(({ ctx, input }) => {
    const scope = scopeOf(ctx, input.country);
    const r = requestOrThrow(scope, input.id);
    if (r.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: `Request is ${r.status}, not pending` });
    const now = new Date();
    const modified = input.quantity && input.quantity !== r.quantity ? ` (qty ${r.quantity}→${input.quantity})` : "";
    if (input.quantity) r.quantity = input.quantity;
    r.status = "approved";
    r.approvedBy = ctx.user.id;
    r.approvedAt = now;
    r.timeline.push({ status: "approved", at: now, by: `${ctx.user.name}${modified}` });
    if (input.note) r.notes = [r.notes, `Approval note: ${input.note}`].filter(Boolean).join(" · ");
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "resource.approve", entity: "resource_request", entityId: r.id, details: `Approved ${r.quantity} ${r.resourceType} → ${scope.districts.find((d) => d.id === r.targetDistrictId)?.name}${modified}` });
    publishResource(scope, r);
    return r;
  }),

  rejectResourceRequest: approver.input(countryIn.extend({ id: z.string(), reason: z.string().min(3).max(300) })).mutation(({ ctx, input }) => {
    const scope = scopeOf(ctx, input.country);
    const r = requestOrThrow(scope, input.id);
    if (r.status !== "pending" && r.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot reject a ${r.status} request` });
    const now = new Date();
    r.status = "rejected";
    r.timeline.push({ status: "rejected", at: now, by: `${ctx.user.name}: ${input.reason}` });
    r.notes = [r.notes, `Rejected: ${input.reason}`].filter(Boolean).join(" · ");
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "resource.reject", entity: "resource_request", entityId: r.id, details: `Rejected ${r.quantity} ${r.resourceType}: ${input.reason}` });
    publishResource(scope, r);
    return r;
  }),

  modifyResourceRequest: requester
    .input(countryIn.extend({ id: z.string(), quantity: z.number().int().min(1).max(100000).optional(), priority: zPriority.optional(), resourceType: zResource.optional(), targetDistrictId: z.string().optional(), notes: z.string().max(500).optional() }))
    .mutation(({ ctx, input }) => {
      const scope = scopeOf(ctx, input.country);
      const r = requestOrThrow(scope, input.id);
      if (r.status !== "pending" && r.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot modify a ${r.status} request` });
      if (r.status === "approved" && !can(ctx.user.role, "approve_resources")) throw new TRPCError({ code: "FORBIDDEN", message: "Only approvers can modify approved requests" });
      const changes: string[] = [];
      if (input.quantity && input.quantity !== r.quantity) (changes.push(`qty ${r.quantity}→${input.quantity}`), (r.quantity = input.quantity));
      if (input.priority && input.priority !== r.priority) (changes.push(`priority ${r.priority}→${input.priority}`), (r.priority = input.priority));
      if (input.resourceType && input.resourceType !== r.resourceType) (changes.push(`type ${r.resourceType}→${input.resourceType}`), (r.resourceType = input.resourceType));
      if (input.targetDistrictId && input.targetDistrictId !== r.targetDistrictId) {
        const d = districtOrThrow(scope, input.targetDistrictId);
        changes.push(`destination → ${d.name}`);
        r.targetDistrictId = d.id;
      }
      if (input.notes !== undefined) r.notes = input.notes.trim() || null;
      if (!changes.length && input.notes === undefined) return r;
      r.timeline.push({ status: "modified", at: new Date(), by: `${ctx.user.name}${changes.length ? `: ${changes.join(", ")}` : ": notes"}` });
      audit({ userId: ctx.user.id, userName: ctx.user.name, action: "resource.modify", entity: "resource_request", entityId: r.id, details: changes.join(", ") || "notes updated" });
      publishResource(scope, r);
      return r;
    }),

  /**
   * Dispatch: select resources → destination → vehicle → confirm.
   * Either an existing approved request (`requestId`) or a fast-track new one
   * (`create`, approvers only) from the district drill-down.
   */
  dispatchResources: requester
    .input(
      countryIn.extend({
        requestId: z.string().optional(),
        create: z.object({ resourceType: zResource, quantity: z.number().int().min(1).max(100000), targetDistrictId: z.string(), priority: zPriority, notes: z.string().max(500).optional() }).optional(),
        depotName: z.string().min(2).max(120),
        vehicleId: z.string().min(2).max(120),
      })
    )
    .mutation(({ ctx, input }) => {
      const scope = scopeOf(ctx, input.country);
      if (!can(ctx.user.role, "approve_resources")) throw new TRPCError({ code: "FORBIDDEN", message: "Dispatch requires approve_resources — submit a request instead" });
      const store = getStore();
      const now = new Date();
      let r: ResourceRequestRecord;
      if (input.requestId) {
        r = requestOrThrow(scope, input.requestId);
        if (r.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: `Request must be approved before dispatch (is ${r.status})` });
      } else if (input.create) {
        const d = districtOrThrow(scope, input.create.targetDistrictId);
        r = {
          id: nextId("req"),
          orgId: scope.orgId,
          requestedBy: ctx.user.id,
          requestedByName: ctx.user.name,
          resourceType: input.create.resourceType,
          quantity: input.create.quantity,
          targetDistrictId: d.id,
          status: "approved",
          priority: input.create.priority,
          notes: input.create.notes?.trim() || "Fast-track dispatch from district drill-down",
          vehicle: null,
          approvedBy: ctx.user.id,
          approvedAt: now,
          createdAt: now,
          timeline: [
            { status: "pending", at: now, by: ctx.user.name },
            { status: "approved", at: now, by: `${ctx.user.name} (fast-track)` },
          ],
        };
        store.resourceRequests.unshift(r);
      } else throw new TRPCError({ code: "BAD_REQUEST", message: "requestId or create is required" });

      const inv = inventoryOf(scope, r.resourceType);
      const depot = inv.depots.find((d) => d.name === input.depotName);
      if (!depot) throw new TRPCError({ code: "NOT_FOUND", message: "Depot not found" });
      if (depot.quantity < r.quantity) throw new TRPCError({ code: "BAD_REQUEST", message: `${depot.name} holds only ${depot.quantity} ${inv.unit} of ${inv.label}` });
      const vehicle = fleetFor(scope.orgId).find((v) => v.id === input.vehicleId);
      if (!vehicle) throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found" });
      if (vehicle.busyWith && vehicle.busyWith !== r.id) throw new TRPCError({ code: "CONFLICT", message: `${vehicle.label} is already on dispatch ${vehicle.busyWith}` });
      const dest = districtOrThrow(scope, r.targetDistrictId);
      const km = Math.round(haversineKm(depot.lat, depot.lon, dest.lat, dest.lon) * 1.3 + 4); // road-network detour factor
      const eta = Math.round((km / vehicle.speedKmh + 0.75) * 10) / 10;

      depot.quantity -= r.quantity;
      inv.deployed = Math.min(inv.total, inv.deployed + r.quantity);
      r.status = "dispatched";
      r.vehicle = vehicle.label;
      r.timeline.push({ status: "dispatched", at: now, by: `${ctx.user.name} · ${vehicle.label} from ${depot.name} · ETA ${eta} h` });
      govState().dispatch[r.id] = { requestId: r.id, depotName: depot.name, depotLat: depot.lat, depotLon: depot.lon, vehicleId: vehicle.id, vehicleLabel: vehicle.label, etaHours: eta, distanceKm: km, dispatchedAt: now };
      audit({ userId: ctx.user.id, userName: ctx.user.name, action: "resource.dispatch", entity: "resource_request", entityId: r.id, details: `Dispatched ${r.quantity} ${inv.label} ${depot.name} → ${dest.name} by ${vehicle.label} (${km} km, ETA ${eta} h)` });
      publishResource(scope, r);
      return { request: r, etaHours: eta, distanceKm: km };
    }),

  markDelivered: requester.input(countryIn.extend({ id: z.string(), note: z.string().max(300).optional() })).mutation(({ ctx, input }) => {
    const scope = scopeOf(ctx, input.country);
    const r = requestOrThrow(scope, input.id);
    if (r.status !== "dispatched") throw new TRPCError({ code: "BAD_REQUEST", message: `Request is ${r.status}, not dispatched` });
    r.status = "delivered";
    r.timeline.push({ status: "delivered", at: new Date(), by: `${ctx.user.name}${input.note ? `: ${input.note}` : ""}` });
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "resource.deliver", entity: "resource_request", entityId: r.id, details: `Delivery confirmed: ${r.quantity} ${r.resourceType} → ${scope.districts.find((d) => d.id === r.targetDistrictId)?.name}` });
    publishResource(scope, r);
    return r;
  }),

  // ─── Early warning ──────────────────────────────────────────────────────

  getAlertTemplates: view.input(countryIn.extend({ districtId: z.string().optional() }).optional()).query(({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    const d = (input?.districtId && scope.districts.find((x) => x.id === input.districtId)) || [...scope.districts].sort((a, b) => b.floodRisk - a.floodRisk)[0]!;
    return ALERT_TEMPLATES.map((t) => ({ key: t.key, name: t.name, alertType: t.alertType, defaultSeverity: t.defaultSeverity, channels: t.channels, validHours: t.validHours, districtId: d.id, districtName: d.name, ...t.build(d) }));
  }),

  /** Districts intersecting a drawn polygon ([lon,lat] ring). */
  districtsInPolygon: view.input(countryIn.extend({ ring: z.array(z.tuple([z.number(), z.number()])).min(3).max(200) })).query(({ ctx, input }) => {
    const scope = scopeOf(ctx, input.country);
    const ring = [...input.ring, input.ring[0]!] as number[][];
    return districtsInPolygon(scope.districts, ring);
  }),

  /** Exactly what each channel will show — optionally translated to the district language. */
  previewAlert: view
    .input(
      countryIn.extend({
        alertType: zAlertType,
        severity: zSeverity,
        title: z.string().min(3).max(140),
        description: z.string().min(3).max(1200),
        recommendedActions: z.array(z.string().max(200)).max(5),
        districtIds: z.array(z.string()).max(40).default([]),
        validHours: z.number().int().min(1).max(720).default(72),
        translate: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      const scope = scopeOf(ctx, input.country);
      const store = getStore();
      const ds = input.districtIds.map((id) => scope.districts.find((d) => d.id === id)).filter((d): d is DistrictRecord => !!d);
      const d0 = ds[0];
      const acts = input.recommendedActions.filter((x) => x.trim());
      const title = d0 && ds.length > 1 && !input.title.includes(d0.name) ? `${input.title} — ${d0.name}` : input.title;
      const base = { alertType: input.alertType as AlertType, severity: input.severity as AlertSeverity, title, description: input.description.replaceAll("{district}", d0?.name ?? "{district}"), recommendedActions: acts, validUntil: new Date(Date.now() + input.validHours * HOUR), shortId: "PREVIEW" };
      const render = (b: typeof base) => {
        const sms = renderSms(b);
        return { app: renderApp(b), sms: { text: sms, ...smsSegments(sms) }, whatsapp: renderWhatsApp(b), email: renderEmail(b) };
      };
      const lang = COUNTRIES.find((c) => c.code === scope.countryCode)!.language;
      let translated = null;
      if (input.translate && lang !== "en") {
        const tr = await translateMessage(base, lang, 8000);
        translated = { language: lang, provider: tr.provider, ...render({ ...base, title: tr.title, description: tr.description, recommendedActions: tr.actions }) };
      }
      // audience estimate per the same rules broadcastAlert applies
      const audience = ds.map((d) => {
        const farmers = store.farmers.filter((f) => f.districtId === d.id).length;
        return { districtId: d.id, name: d.name, registeredFarmers: farmers, roster: rosterSize(d), farmsAtRisk: districtEconomics(d).farmsAtRisk };
      });
      return { english: render(base), translated, audience, languageOfDistricts: lang };
    }),

  createAlert: alerter
    .input(
      countryIn.extend({
        alertType: zAlertType,
        severity: zSeverity,
        districtIds: z.array(z.string()).min(1).max(40),
        title: z.string().min(3).max(140),
        description: z.string().min(3).max(1200),
        recommendedActions: z.array(z.string().max(200)).max(5),
        channels: z.array(zChannel).min(1),
        validHours: z.number().int().min(1).max(720).default(72),
        sendAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scope = scopeOf(ctx, input.country);
      for (const id of input.districtIds) districtOrThrow(scope, id);
      const payload = { alertType: input.alertType, severity: input.severity, districtIds: input.districtIds, title: input.title, description: input.description, recommendedActions: input.recommendedActions.filter((x) => x.trim()), channels: input.channels, validHours: input.validHours };
      if (input.sendAt && input.sendAt.getTime() > Date.now() + 60_000) {
        const s = scheduleAlert(scope.orgId, ctx.user, payload, input.sendAt);
        return { scheduled: s, alerts: [] as { id: string; districtId: string; title: string; deliveries: { sent: number; delivered: number; read: number; actioned: number } }[] };
      }
      const alerts = await broadcastAlert({ ...payload, createdBy: ctx.user.id, source: "manual" });
      return { scheduled: null, alerts: alerts.map((a) => ({ id: a.id, districtId: a.districtId, title: a.title, deliveries: a.deliveries })) };
    }),

  cancelScheduledAlert: alerter.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    if (!cancelScheduledAlert(input.id, ctx.user)) throw new TRPCError({ code: "BAD_REQUEST", message: "Not a pending scheduled alert" });
    return { ok: true };
  }),

  /** Broadcast history with delivery receipts, read rates and per-channel breakdown. */
  getAlertHistory: view
    .input(countryIn.extend({ limit: z.number().int().min(1).max(200).default(40), offset: z.number().int().min(0).default(0), alertType: zAlertType.optional(), status: z.enum(["active", "expired"]).optional(), districtId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const scope = scopeOf(ctx, input?.country);
      await housekeeping(scope);
      const store = getStore();
      const now = Date.now();
      const all = orgAlerts(scope)
        .filter((a) => !input?.alertType || a.alertType === input.alertType)
        .filter((a) => !input?.districtId || a.districtId === input.districtId)
        .filter((a) => !input?.status || (input.status === "active" ? isActive(a, now) : !isActive(a, now)));
      const limit = input?.limit ?? 40;
      const offset = input?.offset ?? 0;
      const last30 = orgAlerts(scope).filter((a) => a.createdAt.getTime() > now - 30 * DAY);
      const sum = (xs: typeof last30, k: keyof (typeof last30)[number]["deliveries"]) => xs.reduce((s, a) => s + a.deliveries[k], 0);
      const perChannel = new Map<AlertChannel, { channel: AlertChannel; sent: number; delivered: number; read: number; actioned: number }>();
      for (const a of last30) {
        for (const r of channelBreakdown(a).rows) {
          const p = perChannel.get(r.channel) ?? { channel: r.channel, sent: 0, delivered: 0, read: 0, actioned: 0 };
          p.sent += r.sent;
          p.delivered += r.delivered;
          p.read += r.read;
          p.actioned += r.actioned;
          perChannel.set(r.channel, p);
        }
      }
      const gs = govState();
      return {
        total: all.length,
        summary: {
          alerts30d: last30.length,
          sent30d: sum(last30, "sent"),
          deliveryRate: sum(last30, "delivered") / Math.max(1, sum(last30, "sent")),
          readRate: sum(last30, "read") / Math.max(1, sum(last30, "delivered")),
          actionRate: sum(last30, "actioned") / Math.max(1, sum(last30, "delivered")),
          active: orgAlerts(scope).filter((a) => isActive(a, now)).length,
          perChannel: [...perChannel.values()],
        },
        scheduled: gs.scheduled
          .filter((s) => s.orgId === scope.orgId)
          .slice(0, 20)
          .map((s) => ({ ...s, districtNames: s.payload.districtIds.map((id) => scope.districts.find((d) => d.id === id)?.name ?? id) })),
        items: all.slice(offset, offset + limit).map((a) => {
          const creator = store.users.find((u) => u.id === a.createdBy);
          const esc = gs.escalations.filter((e) => e.alertId === a.id);
          return {
            id: a.id,
            title: a.title,
            description: a.description,
            alertType: a.alertType,
            severity: a.severity,
            districtId: a.districtId,
            districtName: scope.districts.find((d) => d.id === a.districtId)?.name ?? a.districtId,
            createdAt: a.createdAt,
            validUntil: a.validUntil,
            active: isActive(a, now),
            source: a.source,
            createdByName: a.createdBy === "system" ? "Climate scan (model)" : creator?.name ?? a.createdBy,
            channels: a.channels,
            recommendedActions: a.recommendedActions,
            predictedImpact: a.predictedImpact,
            deliveries: a.deliveries,
            deliveryRate: a.deliveries.delivered / Math.max(1, a.deliveries.sent),
            readRate: a.deliveries.read / Math.max(1, a.deliveries.delivered),
            actionRate: a.deliveries.actioned / Math.max(1, a.deliveries.delivered),
            channelBreakdown: channelBreakdown(a),
            escalations: esc.map((e) => ({ at: e.at, from: e.from, to: e.to, rule: e.ruleName })),
          };
        }),
      };
    }),

  /** Per-recipient receipts for one alert (only alerts sent through broadcastAlert have them). */
  getAlertReceipts: view.input(countryIn.extend({ alertId: z.string() })).query(({ ctx, input }) => {
    const scope = scopeOf(ctx, input.country);
    const a = getStore().alerts.find((x) => x.id === input.alertId);
    if (!a || !scope.districtIds.has(a.districtId)) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
    refreshReceipts();
    return deliveriesFor(a.id)
      .slice(0, 300)
      .map((d) => ({ id: d.id, recipientName: d.recipientName, recipientKind: d.recipientKind, channel: d.channel, language: d.language, to: d.recipientKind === "roster" ? d.to : d.to.replace(/(.{4}).+(.{2})$/, "$1•••$2"), count: d.count, status: d.status, provider: d.provider, sentAt: d.sentAt, deliveredAt: d.deliveredAt, readAt: d.readAt, actionedAt: d.actionedAt, body: d.body }));
  }),

  getEscalationRules: view.input(countryIn.optional()).query(async ({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    await evaluateEscalations({ orgId: scope.orgId });
    const gs = govState();
    return {
      rules: rulesFor(scope.orgId),
      monitor: escalationMonitor(scope.orgId),
      log: gs.escalations.filter((e) => e.orgId === scope.orgId).slice(0, 30).map((e) => ({ ...e, districtName: scope.districts.find((d) => d.id === e.districtId)?.name ?? e.districtId })),
      featureFlag: getStore().flags.find((f) => f.key === "auto_escalation")?.enabled ?? true,
    };
  }),

  setEscalationRules: approver
    .input(
      countryIn.extend({
        rules: z
          .array(
            z.object({
              id: z.string().optional(),
              name: z.string().min(3).max(100),
              enabled: z.boolean(),
              alertTypes: z.array(zAlertType).min(1),
              metric: z.enum(["floodProb72h", "floodProb24h", "floodRisk", "salinityRisk", "ecCurrent", "rainfall72hMm"]),
              threshold: z.number().min(0).max(1000),
              afterHours: z.number().min(0).max(72),
              mode: z.enum(["step", "emergency"]),
              notifyChannels: z.array(zChannel).min(1),
            })
          )
          .max(20),
      })
    )
    .mutation(({ ctx, input }) => {
      const scope = scopeOf(ctx, input.country);
      const now = new Date();
      const rules: EscalationRule[] = input.rules.map((r) => ({ ...r, id: r.id ?? nextId("escr"), updatedAt: now, updatedBy: ctx.user.name }));
      govState().rules[scope.orgId] = rules;
      audit({ userId: ctx.user.id, userName: ctx.user.name, action: "escalation.rules.update", entity: "escalation_rule", entityId: scope.orgId, details: `${rules.length} rule(s), ${rules.filter((r) => r.enabled).length} enabled` });
      return rules;
    }),

  runEscalationsNow: approver.input(countryIn.optional()).mutation(async ({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    const events = await evaluateEscalations({ orgId: scope.orgId, force: true });
    return { escalated: events.length, events };
  }),

  // ─── Analytics ──────────────────────────────────────────────────────────

  getAnalytics: view.input(countryIn.optional()).query(({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    refreshReceipts();
    const store = getStore();
    const now = Date.now();
    const alerts = orgAlerts(scope);
    const alertIds = new Set(alerts.map((a) => a.id));
    const actions = store.farmerActions.filter((x) => x.alertId && alertIds.has(x.alertId));
    const allSaved = store.farmerActions.filter((x) => x.cropSavedPct != null);
    const globalSaved = allSaved.reduce((s, x) => s + x.cropSavedPct!, 0) / Math.max(1, allSaved.length) / 100;

    // Season-over-season: predicted loss if no action vs realised with early warning
    const seasons = new Map<string, { key: string; label: string; order: number; alerts: number; withoutEw: number; delivered: number; actioned: number; saved: number[] }>();
    for (const a of alerts) {
      const s = seasonOf(a.createdAt);
      const row = seasons.get(s.key) ?? { ...s, alerts: 0, withoutEw: 0, delivered: 0, actioned: 0, saved: [] };
      row.alerts++;
      row.withoutEw += a.predictedImpact.estLossUsd * a.predictedImpact.probability;
      row.delivered += a.deliveries.delivered;
      row.actioned += a.deliveries.actioned;
      for (const x of actions) if (x.alertId === a.id && x.cropSavedPct != null) row.saved.push(x.cropSavedPct / 100);
      seasons.set(s.key, row);
    }
    const seasonRows = [...seasons.values()]
      .sort((a, b) => a.order - b.order)
      .map((r) => {
        const actionRate = r.actioned / Math.max(1, r.delivered);
        const saved = r.saved.length ? r.saved.reduce((s, v) => s + v, 0) / r.saved.length : globalSaved;
        const withEw = r.withoutEw * (1 - actionRate * saved);
        return { season: r.label, alerts: r.alerts, withoutEwUsd: Math.round(r.withoutEw), withEwUsd: Math.round(withEw), avoidedUsd: Math.round(r.withoutEw - withEw), actionRate: Math.round(actionRate * 1000) / 10, cropSavedPct: Math.round(saved * 1000) / 10, outcomeSamples: r.saved.length };
      });

    // Weekly response rate (last 12 weeks)
    const weekly = Array.from({ length: 12 }, (_, i) => {
      const end = now - (11 - i) * 7 * DAY;
      const start = end - 7 * DAY;
      const xs = alerts.filter((a) => a.createdAt.getTime() > start && a.createdAt.getTime() <= end);
      const del = xs.reduce((s, a) => s + a.deliveries.delivered, 0);
      return {
        week: new Date(start).toISOString().slice(5, 10),
        alerts: xs.length,
        sent: xs.reduce((s, a) => s + a.deliveries.sent, 0),
        readRate: del ? Math.round((xs.reduce((s, a) => s + a.deliveries.read, 0) / del) * 1000) / 10 : null,
        actionRate: del ? Math.round((xs.reduce((s, a) => s + a.deliveries.actioned, 0) / del) * 1000) / 10 : null,
      };
    });

    // Resource utilisation heatmap: allocated in last 90 days vs modelled need
    const since = now - 90 * DAY;
    const heatmap = scope.districts.map((d) => {
      const needs = districtNeeds(d);
      return {
        districtId: d.id,
        district: d.name,
        cells: RESOURCE_TYPES.map((type) => {
          const allocated = store.resourceRequests
            .filter((r) => r.orgId === scope.orgId && r.targetDistrictId === d.id && r.resourceType === type && r.createdAt.getTime() > since && ["approved", "dispatched", "delivered"].includes(r.status))
            .reduce((s, r) => s + r.quantity, 0);
          const need = needs[type];
          // capped at 300% — beyond that the cell just means "heavily over-allocated vs current need"
          return { type, allocated, need, utilisationPct: need ? Math.min(300, Math.round((allocated / need) * 100)) : allocated ? 100 : 0 };
        }),
      };
    });

    // Hotspots: flood extent by year per district (historical archive)
    const years = [...new Set(scope.districts.flatMap((d) => d.historicalFloods.map((h) => h.year)))].sort();
    const hotspotTrend = years.map((y) => {
      const row: Record<string, number | string> = { year: String(y) };
      for (const d of scope.districts) row[d.name] = d.historicalFloods.find((h) => h.year === y)?.areaHa ?? 0;
      return row;
    });
    const hotspots = scope.districts
      .map((d) => {
        const hs = [...d.historicalFloods].sort((a, b) => a.year - b.year);
        const n = hs.length;
        const mx = hs.reduce((s, h) => s + h.year, 0) / n;
        const my = hs.reduce((s, h) => s + h.areaHa, 0) / n;
        const slope = hs.reduce((s, h) => s + (h.year - mx) * (h.areaHa - my), 0) / Math.max(1, hs.reduce((s, h) => s + (h.year - mx) ** 2, 0));
        return {
          districtId: d.id,
          district: d.name,
          events: n,
          archiveAlerts: alerts.filter((a) => a.districtId === d.id && a.alertType === "flood").length,
          avgAreaHa: Math.round(my),
          totalLossUsd: hs.reduce((s, h) => s + h.lossUsd, 0),
          trendHaPerYear: Math.round(slope),
          currentRisk: d.floodRisk,
        };
      })
      .sort((a, b) => b.totalLossUsd - a.totalLossUsd);

    const totals = {
      alerts12m: alerts.filter((a) => a.createdAt.getTime() > now - 365 * DAY).length,
      sent12m: alerts.filter((a) => a.createdAt.getTime() > now - 365 * DAY).reduce((s, a) => s + a.deliveries.sent, 0),
      avoidedUsd: seasonRows.reduce((s, r) => s + r.avoidedUsd, 0),
      outcomeSamples: actions.length,
      avgCropSavedPct: Math.round(globalSaved * 1000) / 10,
    };
    return { seasons: seasonRows, weekly, heatmap, resourceTypes: RESOURCE_TYPES, hotspotTrend, hotspots, districtNames: scope.districts.map((d) => d.name), totals, generatedAt: new Date() };
  }),

  /** ERA5 rainfall anomaly: last 12 complete months vs the 2 prior years (Open-Meteo archive). */
  getRainfallAnomaly: view.input(countryIn.extend({ districtId: z.string() })).query(async ({ ctx, input }) => {
    const scope = scopeOf(ctx, input.country);
    const d = districtOrThrow(scope, input.districtId);
    try {
      const h = await getHistory({ lat: d.lat, lon: d.lon }, 3 * 365 + 20);
      const monthly = new Map<string, number>();
      h.daily.time.forEach((t, i) => monthly.set(t.slice(0, 7), (monthly.get(t.slice(0, 7)) ?? 0) + (h.daily.precipitation_sum[i] ?? 0)));
      const keys = [...monthly.keys()].sort();
      const complete = keys.slice(1, -1); // drop partial first/last month
      const recent = complete.slice(-12);
      const rows = recent.map((k) => {
        const [y, m] = k.split("-");
        const prior = [1, 2].map((dy) => monthly.get(`${Number(y) - dy}-${m}`)).filter((v): v is number => v != null);
        const clim = prior.length ? prior.reduce((s, v) => s + v, 0) / prior.length : null;
        const obs = Math.round(monthly.get(k)! * 10) / 10;
        return { month: k, observedMm: obs, baselineMm: clim == null ? null : Math.round(clim * 10) / 10, anomalyMm: clim == null ? null : Math.round((obs - clim) * 10) / 10, anomalyPct: clim ? Math.round(((obs - clim) / clim) * 1000) / 10 : null };
      });
      const obs = rows.reduce((s, r) => s + r.observedMm, 0);
      const base = rows.reduce((s, r) => s + (r.baselineMm ?? 0), 0);
      return { district: d.name, source: "ERA5 via Open-Meteo archive", rows, annualObservedMm: Math.round(obs), annualBaselineMm: Math.round(base), annualAnomalyPct: base ? Math.round(((obs - base) / base) * 1000) / 10 : null };
    } catch (e) {
      return { district: d.name, source: "ERA5 via Open-Meteo archive", rows: [], annualObservedMm: null, annualBaselineMm: null, annualAnomalyPct: null, error: (e as Error).message };
    }
  }),

  // ─── Policy ─────────────────────────────────────────────────────────────

  getPolicyBriefs: view.input(countryIn.optional()).query(({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    const now = new Date();
    const q = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
    const baseline = budgetBaseline(scope);
    const ranked = scope.districts
      .map((d) => {
        const e = districtEconomics(d);
        const hist = d.historicalFloods.reduce((s, h) => s + h.lossUsd, 0) / Math.max(1, d.historicalFloods.length);
        return { d, e, hist, score: e.expectedLossUsd + hist };
      })
      .sort((a, b) => b.score - a.score);
    const top = ranked.slice(0, 3);

    const briefs = top.map(({ d, e, hist }, i) => {
      const worst = [...d.historicalFloods].sort((a, b) => b.areaHa - a.areaHa)[0]!;
      const embankKm = Math.max(4, Math.round((d.floodExposure * worst.areaHa) / 2200));
      const sluices = d.salinityExposure > 0.4 ? Math.ceil(d.salinityExposure * 6) : 0;
      const sensors = sensorInventory(d);
      const invest = { embankment: embankKm * 850_000, sluice: sluices * 420_000, early_warning: sensors.gapCostUsd, preposition: districtNeeds(d).pumps * 2_600 };
      const salAnnual = e.salinityLossUsd / Math.max(0.35, drySeasonFactor(now.getMonth() + 1, d.lat));
      const res = computeBudget(invest, { floodAnnualLossUsd: hist, salinityAnnualLossUsd: salAnnual });
      const driver = d.salinityRisk > d.floodRisk ? "salinity" : "flood";
      const lead =
        driver === "salinity"
          ? `Based on ${q} salinity data (EC ${d.ecCurrent} dS/m now, ${d.ecPredicted30d} dS/m forecast in 30 days on the ${d.riverName})`
          : `Based on ${q} flood data (72h flood probability ${Math.round(d.floodProb72h * 100)}%, ${d.rainfall72hMm} mm forecast rainfall${d.riverDischargeM3s ? `, GloFAS discharge ${d.riverDischargeM3s.toLocaleString()} m³/s` : ""})`;
      return {
        rank: i + 1,
        districtId: d.id,
        district: d.name,
        driver,
        riskLevel: d.riskLevel,
        headline: `${d.name}: ${driver === "salinity" ? "salinity defences" : "embankment reinforcement"} is the highest-return intervention`,
        summary: `${lead}, we recommend ${driver === "salinity" && sluices ? `${sluices} automated tidal sluice gates and ` : ""}reinforcing ${embankKm} km of embankment along the ${d.riverName}, plus ${sensors.rows.reduce((s, r) => s + r.missing, 0)} additional sensors to close a ${100 - sensors.coveragePct}% monitoring gap. ${e.farmsAtRisk.toLocaleString()} farms and ${e.atRiskHa.toLocaleString()} ha are currently exposed; the ${worst.year} flood inundated ${worst.areaHa.toLocaleString()} ha.`,
        metrics: { expectedLossUsd: e.expectedLossUsd, avgAnnualFloodLossUsd: Math.round(hist), farmsAtRisk: e.farmsAtRisk, sensorCoveragePct: sensors.coveragePct },
        recommendations: [
          { item: `Embankment reinforcement (${embankKm} km)`, costUsd: invest.embankment },
          ...(sluices ? [{ item: `Tidal sluice gates (${sluices})`, costUsd: invest.sluice }] : []),
          { item: `Sensor densification (${sensors.rows.reduce((s, r) => s + r.missing, 0)} units)`, costUsd: invest.early_warning },
          { item: `Pre-positioned dewatering pumps (${districtNeeds(d).pumps})`, costUsd: invest.preposition },
        ],
        totalCostUsd: res.totalInvestUsd,
        avoidedAnnualUsd: res.avoidedAnnualUsd,
        bcr: res.bcr,
        paybackYears: res.paybackYears,
      };
    });

    const suggestedBudget = Math.round((baseline.floodAnnualLossUsd + baseline.salinityAnnualLossUsd) * 1.5 / 1_000_000) * 1_000_000;
    const recommended = optimisePortfolio(suggestedBudget, baseline, { minMarginalBcr: 1.5 });
    return {
      quarter: q,
      orgName: scope.orgName,
      briefs,
      baseline,
      categories: BUDGET_CATEGORIES,
      suggestedBudgetUsd: suggestedBudget,
      recommendedPortfolio: recommended,
      recommendedResult: computeBudget(recommended, baseline),
      generatedAt: now,
      method: "Expected-loss model: exposed cropland × FAOSTAT yields × commodity prices × flood/salinity damage curves (FAO Maas–Hoffman), live risk from Open-Meteo/GloFAS; baseline = mean annual flood loss from the district archive + dry-season-adjusted salinity loss.",
    };
  }),

  getInfrastructureGaps: view.input(countryIn.optional()).query(({ ctx, input }) => {
    const scope = scopeOf(ctx, input?.country);
    const rows = scope.districts
      .map((d) => {
        const s = sensorInventory(d);
        const hazard = Math.max(d.floodRisk, d.salinityRisk);
        return {
          districtId: d.id,
          district: d.name,
          lat: d.lat,
          lon: d.lon,
          geometry: d.geometry,
          riskLevel: d.riskLevel,
          hazard,
          areaKm2: s.areaKm2,
          coveragePct: s.coveragePct,
          gapCostUsd: s.gapCostUsd,
          sensors: s.rows,
          priority: Math.round(((100 - s.coveragePct) * hazard) / 100),
        };
      })
      .sort((a, b) => b.priority - a.priority);
    const totals = SENSOR_TYPES.map((t) => ({
      key: t.key,
      label: t.label,
      unitCost: t.unitCost,
      required: rows.reduce((s, r) => s + r.sensors.find((x) => x.key === t.key)!.required, 0),
      installed: rows.reduce((s, r) => s + r.sensors.find((x) => x.key === t.key)!.installed, 0),
      online: rows.reduce((s, r) => s + r.sensors.find((x) => x.key === t.key)!.online, 0),
    }));
    return { rows, totals, gapCostUsd: rows.reduce((s, r) => s + r.gapCostUsd, 0) };
  }),
});
