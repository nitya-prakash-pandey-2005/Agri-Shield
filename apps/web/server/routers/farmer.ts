/**
 * farmerRouter — the farmer portal API (spec §4.3, §4.4, §10).
 * Guarded by "view_farm_data". Farmers see their own farm; officers/admins
 * preview the demo farmer (farmer-000). All climate numbers come from live
 * open data (Open-Meteo / GloFAS / ERA5 / MODIS / OSM) or the ML service,
 * with graceful fallbacks so every screen keeps working offline.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { AlertChannel, CropType } from "@agri-shield/types";
import { CROP_EC_THRESHOLDS } from "@agri-shield/types";
import { permitted, publicProcedure, router } from "../trpc";
import { audit, DAY, getStore, HOUR, nextId, riskLevelFromScore, type FieldRecord } from "../data/store";
import { COUNTRIES, DISTRICTS, countryByCode } from "../data/geography";
import {
  CROP_CYCLE_DAYS,
  CROP_LIST,
  IRRIGATION_LIST,
  SEVERITY_RANK,
  SOIL_LIST,
  alertCategory,
  byPriority,
  draftRecommendations,
  farmerFields,
  fieldView,
  ndviHealth,
  persistRecommendations,
  priorityToSeverity,
  resolveFarmer,
  toCsv,
  type AlertCategory,
} from "../data/farmer-context";
import { closeRing, haversineKm, ringAreaHa, ringCentroid } from "../data/farmer-geometry";
import { estimateCoastKm, getModisNdvi, getWaterways, nearestDistrict, nearestWaterway } from "../data/farmer-geo";
import { getFloodRisk, getSalinityRisk, type FloodRisk, type SalinityRisk } from "../ml-client";
import { getElevation, getForecast, getHistory, getRiverDischarge, getSeaLevel, weatherLabel } from "../live/open-meteo";
import { getHazardEvents } from "../live/events";
import { translate } from "../live/translate";
import { publish } from "../realtime";
import { sendEmail } from "../notify/channels";
import { markDeliveryRead } from "../data/gov-store";
import { cropDamageProbability, scoreFlood } from "../risk/scoring";

const proc = permitted("view_farm_data");

const LANGS = ["en", "hi", "bn", "vi", "fil", "id", "ta", "si"] as const;
const CHANNELS = ["app", "sms", "whatsapp", "email"] as const;
const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

const HISTORY_MULT = { never: 0.9, rarely: 1, sometimes: 1.06, often: 1.12 } as const;
const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;
const sum = (a: (number | null | undefined)[]) => a.reduce<number>((s, v) => s + (v ?? 0), 0);

function nowIndex(times: string[]) {
  const now = Date.now();
  return Math.max(0, times.findIndex((t) => new Date(t).getTime() > now) - 1);
}

// ─── Core computations (shared by several procedures) ─────────────────────

async function computeRisk(user: { id: string; role: Parameters<typeof resolveFarmer>[0]["role"] }) {
  const { farmer, district, isDemoFallback } = resolveFarmer(user);
  const s = getStore();
  const fields = farmerFields(farmer.id);
  const totalArea = fields.reduce((a, f) => a + f.areaHa, 0) || 1;
  const primaryCrop: CropType = [...fields].sort((a, b) => b.areaHa - a.areaHa)[0]?.cropType ?? farmer.primaryCrops[0] ?? "rice";

  const [flood, sal] = await Promise.all([
    getFloodRisk(farmer.lat, farmer.lon, district.floodExposure).catch(() => null as FloodRisk | null),
    getSalinityRisk(farmer.lat, farmer.lon, primaryCrop, district.salinityExposure).catch(() => null as SalinityRisk | null),
  ]);

  const mult = HISTORY_MULT[farmer.floodHistory] ?? 1;
  const scenario = s.scenario.mode;
  let p24 = flood ? flood.probability_24h : district.floodProb24h;
  let p48 = flood ? flood.probability_48h : district.floodProb48h;
  let p72 = flood ? flood.probability_72h : district.floodProb72h;
  if (scenario !== "live") {
    p24 = Math.max(p24, district.floodProb24h);
    p48 = Math.max(p48, district.floodProb48h);
    p72 = Math.max(p72, district.floodProb72h);
  }
  const weightedSal = fields.reduce((a, f) => a + f.salinityRisk * f.areaHa, 0) / totalArea;
  const weightedFlood = fields.reduce((a, f) => a + f.floodRisk * f.areaHa, 0) / totalArea;
  const weightedEc = fields.length ? fields.reduce((a, f) => a + f.soilEc * f.areaHa, 0) / totalArea : district.ecCurrent;
  // Ensemble: point model (ML service or live formula) 60% + field-level live district overlay 40%
  const modelP72 = Math.max(0.01, p72);
  const blendK = fields.length ? (0.6 * p72 + 0.4 * (weightedFlood / 100)) / modelP72 : 1;
  const floodScale = blendK * mult;
  [p24, p48, p72] = [p24, p48, p72].map((p) => Math.min(0.99, round(p * floodScale, 3)));

  // Salinity: trust the ML service; otherwise use the live district overlay (tides + rainfall) at field level
  const mlSal = sal?.source === "ml-api";
  const ecNow = round(mlSal ? sal!.ec_current : weightedEc, 1);
  const ec30 = round(mlSal ? sal!.ec_predicted_30d : district.ecCurrent > 0 ? ecNow * (district.ecPredicted30d / district.ecCurrent) : ecNow, 1);
  const ec7 = round(mlSal ? sal!.ec_predicted_7d : ecNow + (ec30 - ecNow) * 0.25, 1);
  const cropDamage = mlSal ? sal!.crop_damage_probability : cropDamageProbability(primaryCrop, ec30);
  const salinityScore = Math.round(Math.min(99, 0.6 * (fields.length ? weightedSal : district.salinityRisk) + 0.4 * cropDamage * 100 + (farmer.salinityObserved ? 4 : 0)));
  const floodScore = Math.round(p72 * 100);

  // 72h hourly probability curve — model-provided when the ML service returns one,
  // else interpolated through p24/p48/p72 and weighted by the live rainfall profile.
  let hourly: { time: string; precipMm: number; probability: number }[] = [];
  if (flood?.source === "ml-api" && flood.hourly?.length) {
    hourly = flood.hourly.map((h) => ({ time: h.time, precipMm: h.precip_mm, probability: Math.min(0.99, round(h.probability * floodScale, 3)) }));
  } else {
    const fc = await getForecast([{ lat: farmer.lat, lon: farmer.lon }], 7).catch(() => null);
    const f = fc?.[0];
    if (f) {
      const i0 = nowIndex(f.hourly.time);
      const precip = f.hourly.precipitation.slice(i0, i0 + 72);
      const total = sum(precip) || 1;
      let cum = 0;
      const p0 = p24 * 0.82;
      const anchor = (k: number) => (k <= 24 ? p0 + (p24 - p0) * (k / 24) : k <= 48 ? p24 + (p48 - p24) * ((k - 24) / 24) : p48 + (p72 - p48) * ((k - 48) / 24));
      hourly = f.hourly.time.slice(i0, i0 + 72).map((time, k) => {
        cum += precip[k] ?? 0;
        const frac = cum / total;
        const pr = p0 + (p72 - p0) * (0.5 * ((k + 1) / 72) + 0.5 * frac);
        return { time, precipMm: precip[k] ?? 0, probability: round(Math.min(anchor(k + 1) + 0.03, pr), 3) };
      });
    }
  }

  const ecThreshold = CROP_EC_THRESHOLDS[primaryCrop]?.sensitive ?? 3;
  const fieldsAtRisk = fields.filter((f) => Math.max(f.floodRisk, f.salinityRisk * 0.9) >= 60).length;
  const overall = Math.max(floodScore, Math.round(salinityScore * 0.9));

  return {
    farmer,
    district,
    isDemoFallback,
    primaryCrop,
    result: {
      flood: {
        p24,
        p48,
        p72,
        score: floodScore,
        level: riskLevelFromScore(floodScore),
        depthM: flood?.estimated_depth_m ?? null,
        confidenceInterval: flood?.confidence_interval ?? null,
        factors: flood?.contributing_factors ?? ["seasonal_baseline"],
        modelVersion: flood?.model_version ?? "district-overlay",
        source: flood?.source ?? "district-overlay",
        historyMultiplier: mult,
        ensemble: { model: round(modelP72, 3), fieldOverlay: round(weightedFlood / 100, 3) },
      },
      salinity: {
        score: salinityScore,
        level: riskLevelFromScore(salinityScore),
        ecCurrent: ecNow,
        ec7d: ec7,
        ec30d: ec30,
        ecThreshold,
        crop: primaryCrop,
        trend: (ec7 - ecNow > 0.15 ? "rising" : ec7 - ecNow < -0.15 ? "falling" : "steady") as "rising" | "falling" | "steady",
        cropDamageProbability: cropDamage,
        class: sal?.risk_level ?? null,
        recommendedCrops: sal?.recommended_crops ?? [],
        mitigation: sal?.mitigation_actions ?? [],
        modelVersion: sal?.model_version ?? "district-overlay",
        source: sal?.source ?? "district-overlay",
      },
      hourly,
      overall: { score: overall, level: riskLevelFromScore(overall) },
      fields: { count: fields.length, atRisk: fieldsAtRisk, weightedFlood: Math.round(weightedFlood), weightedSalinity: Math.round(weightedSal) },
      district: {
        id: district.id,
        name: district.name,
        floodRisk: district.floodRisk,
        salinityRisk: district.salinityRisk,
        liveSource: district.liveSource,
        lastUpdated: district.lastUpdated,
      },
      scenario,
      updatedAt: new Date(),
    },
  };
}

async function computeWeather(farmer: { lat: number; lon: number }) {
  const pt = { lat: farmer.lat, lon: farmer.lon };
  const [fc, fl, sea] = await Promise.allSettled([
    getForecast([pt], 7),
    // GloFAS cells are 0.05°: probe a 5×5 neighbourhood and use the main channel (largest mean flow)
    getRiverDischarge(
      [-2, -1, 0, 1, 2].flatMap((i) => [-2, -1, 0, 1, 2].map((j) => ({ lat: round(pt.lat + i * 0.05, 3), lon: round(pt.lon + j * 0.05, 3) }))),
      7
    ),
    getSeaLevel([{ lat: pt.lat - 0.25, lon: pt.lon }]),
  ]);
  const f = fc.status === "fulfilled" ? fc.value[0] : undefined;
  let hourly: { time: string; precipMm: number; precipProb: number; tempC: number | null; humidity: number | null; windKmh: number | null; soilMoisture: number | null }[] = [];
  let daily: { date: string; precipMm: number; precipProb: number; tMax: number | null; tMin: number | null; et0: number | null }[] = [];
  if (f) {
    const i0 = nowIndex(f.hourly.time);
    hourly = f.hourly.time.slice(i0, i0 + 72).map((time, k) => ({
      time,
      precipMm: f.hourly.precipitation[i0 + k] ?? 0,
      precipProb: f.hourly.precipitation_probability[i0 + k] ?? 0,
      tempC: f.hourly.temperature_2m[i0 + k] ?? null,
      humidity: f.hourly.relative_humidity_2m[i0 + k] ?? null,
      windKmh: f.hourly.wind_speed_10m[i0 + k] ?? null,
      soilMoisture: f.hourly.soil_moisture_0_to_7cm[i0 + k] ?? null,
    }));
    daily = f.daily.time.map((date, k) => ({
      date,
      precipMm: f.daily.precipitation_sum[k] ?? 0,
      precipProb: f.daily.precipitation_probability_max[k] ?? 0,
      tMax: f.daily.temperature_2m_max[k] ?? null,
      tMin: f.daily.temperature_2m_min[k] ?? null,
      et0: f.daily.et0_fao_evapotranspiration[k] ?? null,
    }));
  }
  const rain72 = round(sum(hourly.map((h) => h.precipMm)), 1);
  const peak = hourly.reduce<(typeof hourly)[number] | null>((b, h) => (!b || h.precipMm > b.precipMm ? h : b), null);

  let discharge: {
    series: { date: string; value: number | null; mean: number | null; max: number | null; forecast: boolean }[];
    today: number | null;
    mean30d: number | null;
    peak7d: number | null;
    ratio: number | null;
    trend: "rising" | "falling" | "steady";
  } | null = null;
  const channel =
    fl.status === "fulfilled"
      ? fl.value.reduce<{ r: (typeof fl.value)[number] | null; mean: number }>((best, r) => {
          const v = r.daily.river_discharge.filter((x): x is number => x != null);
          const m = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
          return m > best.mean ? { r, mean: m } : best;
        }, { r: null, mean: -1 }).r
      : null;
  if (channel) {
    const d = channel.daily;
    const today = new Date().toISOString().slice(0, 10);
    const ti = Math.max(0, d.time.indexOf(today));
    const hist = d.river_discharge.slice(0, ti).filter((v): v is number => v != null);
    const fut = d.river_discharge.slice(ti).filter((v): v is number => v != null);
    const mean = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
    const cur = d.river_discharge[ti] ?? null;
    const in3 = d.river_discharge[Math.min(d.time.length - 1, ti + 3)] ?? cur;
    const peak7 = fut.length ? Math.max(...fut) : null;
    discharge = {
      series: d.time.slice(Math.max(0, ti - 14)).map((date, k) => {
        const idx = Math.max(0, ti - 14) + k;
        return { date, value: d.river_discharge[idx] ?? null, mean: d.river_discharge_mean[idx] ?? null, max: d.river_discharge_max[idx] ?? null, forecast: idx >= ti };
      }),
      today: cur == null ? null : round(cur, 1),
      mean30d: mean == null ? null : round(mean, 1),
      peak7d: peak7 == null ? null : round(peak7, 1),
      ratio: mean && peak7 ? round(peak7 / mean, 2) : null,
      trend: cur != null && in3 != null ? (in3 > cur * 1.05 ? "rising" : in3 < cur * 0.95 ? "falling" : "steady") : "steady",
    };
  }

  let seaLevel: { series: { time: string; m: number }[]; max: number | null } | null = null;
  if (sea.status === "fulfilled" && sea.value[0]) {
    const h = sea.value[0].hourly;
    const series = h.time.map((time, k) => ({ time, m: h.sea_level_height_msl[k] })).filter((x): x is { time: string; m: number } => x.m != null).slice(0, 72);
    if (series.length) seaLevel = { series, max: round(Math.max(...series.map((x) => x.m)), 2) };
  }

  return {
    current: f?.current
      ? {
          tempC: f.current.temperature_2m,
          humidity: f.current.relative_humidity_2m,
          precipMm: f.current.precipitation,
          windKmh: f.current.wind_speed_10m,
          cloudCover: f.current.cloud_cover,
          code: f.current.weather_code,
          label: weatherLabel(f.current.weather_code),
          time: f.current.time,
        }
      : null,
    today: daily.find((d) => d.date === new Date().toISOString().slice(0, 10)) ?? daily[1] ?? daily[0] ?? null,
    hourly,
    daily,
    rain72,
    peakRain: peak && peak.precipMm > 0 ? { time: peak.time, mm: peak.precipMm } : null,
    maxRainProb: hourly.length ? Math.max(...hourly.map((h) => h.precipProb)) : null,
    discharge,
    seaLevel,
    elevation: f?.elevation ?? null,
    sources: { forecast: f ? "Open-Meteo" : null, discharge: discharge ? "GloFAS v4 (Copernicus)" : null, sea: seaLevel ? "Open-Meteo Marine" : null },
    available: !!f,
    updatedAt: new Date(),
  };
}

function forecastSummary(w: Awaited<ReturnType<typeof computeWeather>>): string {
  if (!w.available) return "live forecast unavailable";
  const temps = w.hourly.map((h) => h.tempC).filter((x): x is number => x != null);
  const parts = [`${w.rain72} mm rain expected in the next 72h`];
  if (w.peakRain) parts.push(`peak ${w.peakRain.mm} mm/h at ${w.peakRain.time.replace("T", " ")}`);
  if (w.maxRainProb != null) parts.push(`max rain probability ${w.maxRainProb}%`);
  if (temps.length) parts.push(`temperature ${Math.round(Math.min(...temps))}–${Math.round(Math.max(...temps))}°C`);
  if (w.discharge?.ratio) parts.push(`river discharge peak ${w.discharge.ratio}× the 30-day mean (${w.discharge.trend})`);
  return parts.join(", ");
}

function actionOf(farmerId: string, alertId: string) {
  return getStore().farmerActions.filter((a) => a.farmerId === farmerId && a.alertId === alertId).sort((a, b) => b.actionDate.getTime() - a.actionDate.getTime())[0] ?? null;
}

// ─── Router ───────────────────────────────────────────────────────────────

const fieldInput = z.object({
  name: z.string().trim().min(1).max(60),
  cropType: z.enum(CROP_LIST),
  plantingDate: z.coerce.date(),
  irrigationType: z.enum(IRRIGATION_LIST),
  soilType: z.enum(SOIL_LIST).optional(),
  /** [lon, lat] ring, ≥3 vertices */
  polygon: z.array(z.tuple([lon, lat])).min(3).max(200),
});

const prefsInput = z.object({
  alertTypes: z.array(z.enum(["flood", "salinity", "planting", "weather"])).max(4),
  channels: z.array(z.enum(CHANNELS)).min(1).max(4),
  timing: z.enum(["immediate", "daily", "weekly"]),
  threshold: z.enum(["low", "medium", "high"]),
  whatsappNumber: z.string().trim().max(20).optional(),
});

export const farmerRouter = router({
  ping: proc.query(() => ({ ok: true })),

  getProfile: proc.query(({ ctx }) => {
    const { farmer, district, isDemoFallback } = resolveFarmer(ctx.user);
    const s = getStore();
    const user = s.users.find((u) => u.id === farmer.userId);
    const fields = farmerFields(farmer.id);
    const actions = s.farmerActions.filter((a) => a.farmerId === farmer.id);
    const saved = actions.map((a) => a.cropSavedPct).filter((x): x is number => x != null);
    const sub = s.subscriptions.find((x) => x.userId === farmer.userId);
    const c = countryByCode(district.country);
    return {
      isDemoFallback,
      farmer: { ...farmer },
      user: user ? { id: user.id, name: user.name, email: user.email, phone: user.phone, language: user.language, subscriptionTier: user.subscriptionTier, createdAt: user.createdAt } : null,
      district: {
        id: district.id,
        name: district.name,
        country: district.country,
        countryName: district.countryName,
        basin: district.basin,
        riverName: district.riverName,
        coastDistanceKm: district.coastDistanceKm,
        lat: district.lat,
        lon: district.lon,
        orgId: district.orgId,
      },
      currency: c?.currency ?? "USD",
      subscription: sub ? { plan: sub.plan, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, provider: sub.provider } : { plan: user?.subscriptionTier ?? "free", status: "active" as const, currentPeriodEnd: null, provider: "none" as const },
      stats: {
        fields: fields.length,
        areaHa: round(fields.reduce((a, f) => a + f.areaHa, 0), 1),
        actions: actions.length,
        avgCropSavedPct: saved.length ? Math.round(saved.reduce((a, b) => a + b, 0) / saved.length) : null,
      },
    };
  }),

  getFields: proc.query(({ ctx }) => {
    const { farmer } = resolveFarmer(ctx.user);
    const now = Date.now();
    return farmerFields(farmer.id)
      .map((f) => fieldView(f, now))
      .sort((a, b) => b.riskScore - a.riskScore);
  }),

  getCurrentRisk: proc.query(async ({ ctx }) => (await computeRisk(ctx.user)).result),

  getWeather: proc.query(async ({ ctx }) => {
    const { farmer } = resolveFarmer(ctx.user);
    return computeWeather(farmer);
  }),

  /** ERA5 rainfall history + MODIS NDVI + derived daily flood index (for charts & the 30-day map timeline). */
  getHistory: proc.input(z.object({ days: z.number().int().min(7).max(365).default(90) }).optional()).query(async ({ ctx, input }) => {
    const { farmer, district } = resolveFarmer(ctx.user);
    const days = input?.days ?? 90;
    const fields = farmerFields(farmer.id);
    const probe = fields[0] ?? { lat: farmer.lat, lon: farmer.lon };
    const [era, modis] = await Promise.all([
      getHistory({ lat: farmer.lat, lon: farmer.lon }, days).catch(() => null),
      withTimeout(getModisNdvi(probe.lat, probe.lon), 9000, null),
    ]);
    let daily: { date: string; rainMm: number; tempC: number | null; floodIndex: number }[] = [];
    if (era) {
      const r = era.daily.precipitation_sum.map((v) => v ?? 0);
      daily = era.daily.time.map((date, i) => {
        const r1 = r[i] ?? 0;
        const r2 = r1 + (r[i - 1] ?? 0);
        const r3 = r2 + (r[i - 2] ?? 0);
        const soil = Math.min(0.5, 0.2 + sum(r.slice(Math.max(0, i - 6), i + 1)) / 600);
        const sc = scoreFlood({ rain24hMm: r1, rain48hMm: r2, rain72hMm: r3, soilMoisture: soil, dischargeRatio: null, exposure: district.floodExposure });
        return { date, rainMm: round(r1, 1), tempC: era.daily.temperature_2m_mean[i] ?? null, floodIndex: Math.round(sc.p24 * 100) };
      });
    }
    const totalRain = round(sum(daily.map((d) => d.rainMm)), 1);
    const ndvi = modis?.length
      ? { source: "MODIS MOD13Q1 (NASA / ORNL DAAC)", series: modis }
      : {
          source: "Sentinel-2 / MODIS (cached)",
          series: (() => {
            const byDate = new Map<string, number[]>();
            for (const f of fields) for (const h of f.ndviHistory) byDate.set(h.date, [...(byDate.get(h.date) ?? []), h.ndvi]);
            return [...byDate.entries()].sort().map(([date, v]) => ({ date, ndvi: round(v.reduce((a, b) => a + b, 0) / v.length, 3) }));
          })(),
        };
    return {
      days,
      daily,
      totalRainMm: totalRain,
      wetDays: daily.filter((d) => d.rainMm >= 1).length,
      maxDay: daily.reduce<(typeof daily)[number] | null>((b, d) => (!b || d.rainMm > b.rainMm ? d : b), null),
      ndvi,
      source: era ? "ERA5 reanalysis (Open-Meteo archive)" : null,
    };
  }),

  getAlerts: proc
    .input(z.object({ category: z.enum(["all", "flood", "salinity", "weather", "advisory"]).default("all"), includeArchived: z.boolean().default(true) }).optional())
    .query(async ({ ctx, input }) => {
      const { farmer, district } = resolveFarmer(ctx.user);
      const s = getStore();
      const now = Date.now();
      const cat = input?.category ?? "all";
      const want = (c: AlertCategory) => cat === "all" || cat === c;

      type Item = {
        id: string;
        kind: "alert" | "advisory" | "hazard";
        category: AlertCategory;
        alertType: string;
        severity: "watch" | "warning" | "emergency";
        title: string;
        description: string;
        recommendedActions: string[];
        probability: number | null;
        farmsAffected: number | null;
        validFrom: Date;
        validUntil: Date;
        createdAt: Date;
        source: string;
        isActive: boolean;
        actioned: boolean;
        myAction: { actionTaken: string; actionDate: Date; outcome: string | null; cropSavedPct: number | null } | null;
        districtActionRate: number | null;
        url: string | null;
        distanceKm: number | null;
        fieldName: string | null;
      };

      const districtAlerts = s.alerts.filter((a) => a.districtId === district.id);
      const toItem = (a: (typeof districtAlerts)[number]): Item => {
        const mine = actionOf(farmer.id, a.id);
        return {
          id: a.id,
          kind: "alert",
          category: alertCategory(a.alertType),
          alertType: a.alertType,
          severity: a.severity,
          title: a.title,
          description: a.description,
          recommendedActions: a.recommendedActions,
          probability: a.predictedImpact.probability,
          farmsAffected: a.predictedImpact.farmsAffected,
          validFrom: a.validFrom,
          validUntil: a.validUntil,
          createdAt: a.createdAt,
          source: a.source === "model" ? "Agri-SHIELD model" : a.source === "manual" ? `${district.name} agriculture office` : a.source.toUpperCase(),
          isActive: a.isActive && a.validUntil.getTime() > now,
          actioned: !!mine,
          myAction: mine ? { actionTaken: mine.actionTaken, actionDate: mine.actionDate, outcome: mine.outcome, cropSavedPct: mine.cropSavedPct } : null,
          districtActionRate: a.deliveries.sent ? round(a.deliveries.actioned / a.deliveries.sent, 2) : null,
          url: null,
          distanceKm: null,
          fieldName: null,
        };
      };

      const active: Item[] = districtAlerts.filter((a) => a.isActive && a.validUntil.getTime() > now).map(toItem);
      // Delivery receipts: viewing active alerts in the app counts as "read" for the government dashboard
      for (const a of active) {
        try {
          markDeliveryRead(a.id, farmer.id);
        } catch {}
      }

      // Field advisories (high/urgent model recommendations)
      const fields = farmerFields(farmer.id);
      const fieldName = new Map(fields.map((f) => [f.id, f.name]));
      for (const r of s.recommendations) {
        if (!fieldName.has(r.fieldId) || r.expiresAt.getTime() < now || (r.priority !== "urgent" && r.priority !== "high")) continue;
        const mine = s.farmerActions.find((a) => a.farmerId === farmer.id && a.recommendationId === r.id) ?? null;
        active.push({
          id: r.id,
          kind: "advisory",
          category: "advisory",
          alertType: r.recommendationType,
          severity: priorityToSeverity(r.priority),
          title: r.title,
          description: r.description,
          recommendedActions: r.actions,
          probability: r.confidenceScore,
          farmsAffected: null,
          validFrom: r.createdAt,
          validUntil: r.expiresAt,
          createdAt: r.createdAt,
          source: r.generatedBy,
          isActive: true,
          actioned: !!mine,
          myAction: mine ? { actionTaken: mine.actionTaken, actionDate: mine.actionDate, outcome: mine.outcome, cropSavedPct: mine.cropSavedPct } : null,
          districtActionRate: null,
          url: null,
          distanceKm: null,
          fieldName: fieldName.get(r.fieldId) ?? null,
        });
      }

      // Live GDACS / NASA EONET events within 500 km (don't block on a cold feed)
      const hazards = await withTimeout(getHazardEvents(), 3500, []);
      for (const h of hazards) {
        const km = haversineKm(farmer.lat, farmer.lon, h.lat, h.lon);
        if (km > 500) continue;
        const mine = actionOf(farmer.id, h.id);
        active.push({
          id: h.id,
          kind: "hazard",
          category: h.type === "flood" ? "flood" : "weather",
          alertType: h.type,
          severity: h.alertLevel === "red" ? "emergency" : h.alertLevel === "orange" ? "warning" : "watch",
          title: h.title,
          description: `${h.source} reports a ${h.type} event ${Math.round(km)} km from your farm${h.country ? ` (${h.country})` : ""}.`,
          recommendedActions: h.type === "flood" ? ["Move seed and equipment to raised ground", "Clear field drainage channels"] : ["Secure loose structures", "Harvest ready produce early"],
          probability: null,
          farmsAffected: null,
          validFrom: new Date(h.date),
          validUntil: new Date(Math.max(now + 24 * HOUR, new Date(h.date).getTime() + 7 * DAY)),
          createdAt: new Date(h.date),
          source: h.source,
          isActive: true,
          actioned: !!mine,
          myAction: mine ? { actionTaken: mine.actionTaken, actionDate: mine.actionDate, outcome: mine.outcome, cropSavedPct: mine.cropSavedPct } : null,
          districtActionRate: null,
          url: h.url,
          distanceKm: Math.round(km),
          fieldName: null,
        });
      }

      const sortFn = (a: Item, b: Item) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || b.createdAt.getTime() - a.createdAt.getTime();
      const filteredActive = active.filter((i) => want(i.category)).sort(sortFn);

      const archived = input?.includeArchived === false
        ? []
        : districtAlerts
            .filter((a) => !(a.isActive && a.validUntil.getTime() > now))
            .map(toItem)
            .filter((i) => want(i.category))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, 15);

      const counts = { all: 0, flood: 0, salinity: 0, weather: 0, advisory: 0 } as Record<"all" | AlertCategory, number>;
      for (const i of active) {
        counts.all++;
        counts[i.category]++;
      }
      return { active: filteredActive, archived, counts, district: { id: district.id, name: district.name } };
    }),

  getRecommendations: proc.query(({ ctx }) => {
    const { farmer } = resolveFarmer(ctx.user);
    const s = getStore();
    const now = Date.now();
    const fields = farmerFields(farmer.id);
    const names = new Map(fields.map((f) => [f.id, f.name]));
    return s.recommendations
      .filter((r) => names.has(r.fieldId) && r.expiresAt.getTime() > now)
      .sort(byPriority)
      .map((r) => ({
        id: r.id,
        fieldId: r.fieldId,
        fieldName: names.get(r.fieldId)!,
        title: r.title,
        description: r.description,
        priority: r.priority,
        actions: r.actions,
        confidence: r.confidenceScore,
        generatedBy: r.generatedBy,
        type: r.recommendationType,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        done: s.farmerActions.some((a) => a.farmerId === farmer.id && a.recommendationId === r.id),
      }));
  }),

  markAlertActioned: proc
    .input(z.object({ id: z.string().min(1).max(80), kind: z.enum(["alert", "advisory", "hazard"]).default("alert"), actions: z.array(z.string().max(200)).max(10).default([]), note: z.string().max(500).optional() }))
    .mutation(({ ctx, input }) => {
      const { farmer, district } = resolveFarmer(ctx.user);
      const s = getStore();
      const actionTaken = (input.actions.length ? input.actions.join("; ") : "Acknowledged and acted") + (input.note ? ` — ${input.note}` : "");

      if (input.kind === "advisory") {
        const rec = s.recommendations.find((r) => r.id === input.id);
        if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
        const existing = s.farmerActions.find((a) => a.farmerId === farmer.id && a.recommendationId === rec.id);
        if (existing) {
          existing.actionTaken = actionTaken;
          existing.actionDate = new Date();
          return { ok: true, actionId: existing.id, actionedCount: null, alreadyActioned: true };
        }
        const rec2 = { id: nextId("act"), farmerId: farmer.id, alertId: rec.alertId, recommendationId: rec.id, actionTaken, actionDate: new Date(), outcome: null, cropSavedPct: null };
        s.farmerActions.push(rec2);
        publish(`farmer:${farmer.id}`, { type: "alert.actioned", alertId: rec.id, farmerId: farmer.id });
        return { ok: true, actionId: rec2.id, actionedCount: null, alreadyActioned: false };
      }

      const alert = s.alerts.find((a) => a.id === input.id);
      if (input.kind === "alert" && !alert) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      const existing = s.farmerActions.find((a) => a.farmerId === farmer.id && a.alertId === input.id);
      let actionId: string;
      if (existing) {
        existing.actionTaken = actionTaken;
        existing.actionDate = new Date();
        actionId = existing.id;
      } else {
        actionId = nextId("act");
        s.farmerActions.push({ id: actionId, farmerId: farmer.id, alertId: input.id, recommendationId: null, actionTaken, actionDate: new Date(), outcome: null, cropSavedPct: null });
        if (alert) alert.deliveries.actioned = Math.min(alert.deliveries.sent || Infinity, alert.deliveries.actioned + 1);
      }
      const ev = { type: "alert.actioned" as const, alertId: input.id, farmerId: farmer.id };
      publish(`gov:${district.orgId}`, ev);
      publish(`district:${district.id}`, ev);
      publish(`farmer:${farmer.id}`, ev);
      const user = s.users.find((u) => u.id === farmer.userId);
      audit({ userId: ctx.user.id, userName: user?.name ?? ctx.user.name ?? "farmer", action: "alert.actioned", entity: "climate_alert", entityId: input.id, details: actionTaken.slice(0, 160) });
      return { ok: true, actionId, actionedCount: alert?.deliveries.actioned ?? null, alreadyActioned: !!existing };
    }),

  logFarmerAction: proc
    .input(
      z.object({
        actionTaken: z.string().trim().min(2).max(300),
        alertId: z.string().max(80).nullish(),
        recommendationId: z.string().max(80).nullish(),
        outcome: z.string().max(300).nullish(),
        cropSavedPct: z.number().min(0).max(100).nullish(),
        actionId: z.string().max(80).optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { farmer, district } = resolveFarmer(ctx.user);
      const s = getStore();
      if (input.actionId) {
        const a = s.farmerActions.find((x) => x.id === input.actionId && x.farmerId === farmer.id);
        if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Action not found" });
        if (input.outcome !== undefined) a.outcome = input.outcome ?? null;
        if (input.cropSavedPct !== undefined) a.cropSavedPct = input.cropSavedPct ?? null;
        return { ok: true, id: a.id };
      }
      const rec = { id: nextId("act"), farmerId: farmer.id, alertId: input.alertId ?? null, recommendationId: input.recommendationId ?? null, actionTaken: input.actionTaken, actionDate: new Date(), outcome: input.outcome ?? null, cropSavedPct: input.cropSavedPct ?? null };
      s.farmerActions.push(rec);
      if (input.alertId) publish(`gov:${district.orgId}`, { type: "alert.actioned", alertId: input.alertId, farmerId: farmer.id });
      return { ok: true, id: rec.id };
    }),

  getActions: proc.query(({ ctx }) => {
    const { farmer } = resolveFarmer(ctx.user);
    const s = getStore();
    return s.farmerActions
      .filter((a) => a.farmerId === farmer.id)
      .sort((a, b) => b.actionDate.getTime() - a.actionDate.getTime())
      .slice(0, 50)
      .map((a) => ({ ...a, alertTitle: a.alertId ? s.alerts.find((x) => x.id === a.alertId)?.title ?? null : null }));
  }),

  updateNotificationPrefs: proc.input(prefsInput).mutation(({ ctx, input }) => {
    const { farmer, isDemoFallback } = resolveFarmer(ctx.user);
    if (isDemoFallback && ctx.user.role !== "platform_admin") throw new TRPCError({ code: "FORBIDDEN", message: "Preview mode is read-only" });
    farmer.notificationPrefs = { alertTypes: input.alertTypes, channels: input.channels as AlertChannel[], timing: input.timing, threshold: input.threshold };
    if (input.whatsappNumber) {
      const u = getStore().users.find((x) => x.id === farmer.userId);
      if (u && !u.phone) u.phone = input.whatsappNumber.replace(/\s/g, "");
    }
    return { ok: true, prefs: farmer.notificationPrefs };
  }),

  updateProfile: proc
    .input(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        phone: z.string().trim().min(7).max(20).optional(),
        email: z.string().trim().email().optional().or(z.literal("")),
        farmName: z.string().trim().min(2).max(80).optional(),
        totalAreaHa: z.number().min(0.01).max(10000).optional(),
        experienceYears: z.number().int().min(0).max(80).optional(),
        primaryCrops: z.array(z.enum(CROP_LIST)).min(1).max(15).optional(),
        hasInsurance: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { farmer, isDemoFallback } = resolveFarmer(ctx.user);
      if (isDemoFallback && ctx.user.role !== "platform_admin") throw new TRPCError({ code: "FORBIDDEN", message: "Preview mode is read-only" });
      const s = getStore();
      const u = s.users.find((x) => x.id === farmer.userId);
      if (u) {
        if (input.name) u.name = input.name;
        if (input.phone) u.phone = input.phone.replace(/\s/g, "");
        if (input.email !== undefined) u.email = input.email ? input.email.toLowerCase() : u.email;
      }
      if (input.farmName) farmer.farmName = input.farmName;
      if (input.totalAreaHa) farmer.totalAreaHa = input.totalAreaHa;
      if (input.experienceYears !== undefined) farmer.experienceYears = input.experienceYears;
      if (input.primaryCrops) farmer.primaryCrops = input.primaryCrops;
      if (input.hasInsurance !== undefined) farmer.hasInsurance = input.hasInsurance;
      audit({ userId: ctx.user.id, userName: u?.name ?? "farmer", action: "farmer.update_profile", entity: "farmer_profile", entityId: farmer.id, details: Object.keys(input).join(", ") });
      return { ok: true };
    }),

  updateField: proc
    .input(z.object({ fieldId: z.string().max(60), name: z.string().trim().min(1).max(60).optional(), cropType: z.enum(CROP_LIST).optional(), plantingDate: z.coerce.date().optional(), irrigationType: z.enum(IRRIGATION_LIST).optional() }))
    .mutation(({ ctx, input }) => {
      const { farmer, isDemoFallback } = resolveFarmer(ctx.user);
      if (isDemoFallback && ctx.user.role !== "platform_admin") throw new TRPCError({ code: "FORBIDDEN", message: "Preview mode is read-only" });
      const f = getStore().fields.find((x) => x.id === input.fieldId && x.farmerId === farmer.id);
      if (!f) throw new TRPCError({ code: "NOT_FOUND", message: "Field not found" });
      if (input.name) f.name = input.name;
      if (input.irrigationType) f.irrigationType = input.irrigationType;
      if (input.cropType || input.plantingDate) {
        f.cropType = input.cropType ?? f.cropType;
        f.plantingDate = input.plantingDate ?? f.plantingDate;
        f.expectedHarvest = new Date(f.plantingDate.getTime() + CROP_CYCLE_DAYS[f.cropType] * DAY);
      }
      return { ok: true };
    }),

  exportData: proc.mutation(async ({ ctx }) => {
    const { farmer, district } = resolveFarmer(ctx.user);
    const s = getStore();
    const fields = farmerFields(farmer.id);
    const fieldsCsv = toCsv(
      fields.map((f) => ({
        field_id: f.id, name: f.name, crop: f.cropType, area_ha: f.areaHa, planting_date: f.plantingDate.toISOString().slice(0, 10),
        expected_harvest: f.expectedHarvest.toISOString().slice(0, 10), soil: f.soilType, irrigation: f.irrigationType, lat: f.lat, lon: f.lon,
        elevation_m: f.elevationM, ndvi: f.ndviScore, ndvi_health: ndviHealth(f.ndviScore), flood_risk_pct: Math.round(f.floodRisk),
        salinity_risk_pct: Math.round(f.salinityRisk), soil_ec_dsm: f.soilEc, last_satellite_scan: f.lastSatelliteScan,
        polygon_geojson: JSON.stringify(f.geometry),
      }))
    );
    const alertsCsv = toCsv(
      s.alerts
        .filter((a) => a.districtId === district.id)
        .map((a) => {
          const mine = actionOf(farmer.id, a.id);
          return {
            alert_id: a.id, type: a.alertType, severity: a.severity, title: a.title, created_at: a.createdAt, valid_until: a.validUntil,
            probability: a.predictedImpact.probability, active: a.isActive, source: a.source, my_action: mine?.actionTaken ?? "",
            my_outcome: mine?.outcome ?? "", crop_saved_pct: mine?.cropSavedPct ?? "",
          };
        })
    );
    const [w, hist] = await Promise.all([computeWeather(farmer), getHistory({ lat: farmer.lat, lon: farmer.lon }, 90).catch(() => null)]);
    const weatherRows: Record<string, unknown>[] = [];
    if (hist) hist.daily.time.forEach((d, i) => weatherRows.push({ kind: "observed_daily_era5", time: d, precip_mm: hist.daily.precipitation_sum[i] ?? "", temp_c: hist.daily.temperature_2m_mean[i] ?? "", precip_prob_pct: "", humidity_pct: "", wind_kmh: "", soil_moisture: "" }));
    for (const h of w.hourly) weatherRows.push({ kind: "forecast_hourly_open_meteo", time: h.time, precip_mm: h.precipMm, temp_c: h.tempC ?? "", precip_prob_pct: h.precipProb, humidity_pct: h.humidity ?? "", wind_kmh: h.windKmh ?? "", soil_moisture: h.soilMoisture ?? "" });
    if (w.discharge) for (const d of w.discharge.series) weatherRows.push({ kind: d.forecast ? "river_discharge_forecast_glofas" : "river_discharge_glofas", time: d.date, precip_mm: "", temp_c: "", precip_prob_pct: "", humidity_pct: "", wind_kmh: "", soil_moisture: "", discharge_m3s: d.value ?? "" });
    const actionsCsv = toCsv(
      s.farmerActions
        .filter((a) => a.farmerId === farmer.id)
        .map((a) => ({ action_id: a.id, date: a.actionDate, action: a.actionTaken, alert_id: a.alertId ?? "", recommendation_id: a.recommendationId ?? "", outcome: a.outcome ?? "", crop_saved_pct: a.cropSavedPct ?? "" }))
    );
    const slug = farmer.farmName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      generatedAt: new Date(),
      files: [
        { name: `agri-shield_${slug}_fields.csv`, csv: fieldsCsv, rows: fields.length },
        { name: `agri-shield_${slug}_alerts.csv`, csv: alertsCsv, rows: alertsCsv ? alertsCsv.split("\n").length - 1 : 0 },
        { name: `agri-shield_${slug}_weather.csv`, csv: toCsv(weatherRows.map((r) => ({ discharge_m3s: "", ...r }))), rows: weatherRows.length },
        { name: `agri-shield_${slug}_actions.csv`, csv: actionsCsv, rows: actionsCsv ? actionsCsv.split("\n").length - 1 : 0 },
      ],
    };
  }),

  getReferral: proc.query(({ ctx }) => {
    const { farmer } = resolveFarmer(ctx.user);
    const host = ctx.req.headers.get("x-forwarded-host") ?? ctx.req.headers.get("host") ?? "agrishield.io";
    const proto = ctx.req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    const tiers = [
      { at: 1, reward: "sms" as const },
      { at: 3, reward: "pro" as const },
      { at: 10, reward: "coop" as const },
    ];
    const next = tiers.find((t) => farmer.referrals < t.at) ?? null;
    return {
      code: farmer.referralCode,
      referrals: farmer.referrals,
      link: `${proto}://${host}/auth/signup?ref=${encodeURIComponent(farmer.referralCode)}`,
      tiers: tiers.map((t) => ({ ...t, unlocked: farmer.referrals >= t.at })),
      next: next ? { ...next, remaining: next.at - farmer.referrals } : null,
    };
  }),

  /** Onboarding metadata: countries, districts, crops, and prefill from the signed-in user. */
  getOnboardingMeta: proc.query(({ ctx }) => {
    const s = getStore();
    const user = s.users.find((u) => u.id === ctx.user.id);
    const existing = s.farmers.find((f) => f.userId === ctx.user.id) ?? null;
    return {
      countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name, basin: c.basin, center: c.center, language: c.language })),
      districts: DISTRICTS.map((d) => ({ id: d.id, name: d.name, country: d.country, lat: d.lat, lon: d.lon, riverName: d.riverName, primaryCrops: d.primaryCrops })),
      crops: CROP_LIST,
      prefill: user ? { name: user.name, phone: user.phone, email: user.email, language: user.language } : null,
      existing: existing ? { farmName: existing.farmName, districtId: existing.districtId, experienceYears: existing.experienceYears, primaryCrops: existing.primaryCrops } : null,
      isFarmer: ctx.user.role === "farmer",
    };
  }),

  /** Auto-detected site facts for a point: DEM elevation, nearest district, coast estimate, nearest OSM waterway. */
  getSiteInfo: proc.input(z.object({ lat, lon })).query(async ({ input }) => {
    const { district, km } = nearestDistrict(input.lat, input.lon);
    const [elev, ways] = await Promise.all([
      withTimeout(getElevation([{ lat: input.lat, lon: input.lon }]).then((e) => e[0] ?? null), 8000, null),
      withTimeout(getWaterways(input.lat, input.lon, 8000), 16000, null),
    ]);
    const river = ways ? nearestWaterway(input.lat, input.lon, ways) : null;
    return {
      elevationM: elev == null ? null : round(elev, 1),
      elevationSource: elev == null ? null : "Copernicus DEM GLO-90 (Open-Meteo)",
      district: { id: district.id, name: district.name, country: district.country, countryName: countryByCode(district.country)?.name ?? district.country, km },
      coastKm: estimateCoastKm(input.lat, district),
      river: river ? { ...river, source: "OpenStreetMap (Overpass)" } : null,
      riverFallback: district.riverName,
      floodExposure: district.floodExposure,
      salinityExposure: district.salinityExposure,
    };
  }),

  /** Map layers: nearby district risk polygons + OSM waterways around the farm. */
  getMapLayers: proc.input(z.object({ withWater: z.boolean().default(true) }).optional()).query(async ({ ctx, input }) => {
    const { farmer, district } = resolveFarmer(ctx.user);
    const s = getStore();
    const districts = s.districts
      .filter((d) => d.country === district.country || haversineKm(farmer.lat, farmer.lon, d.lat, d.lon) < 400)
      .map((d) => ({ id: d.id, name: d.name, geometry: d.geometry, floodRisk: d.floodRisk, salinityRisk: d.salinityRisk, floodProb72h: d.floodProb72h, ecCurrent: d.ecCurrent, riskLevel: d.riskLevel, lat: d.lat, lon: d.lon, riverName: d.riverName, coastDistanceKm: d.coastDistanceKm, liveSource: d.liveSource }));
    const water = input?.withWater === false ? null : await withTimeout(getWaterways(farmer.lat, farmer.lon, 9000), 16000, null);
    return { center: { lat: farmer.lat, lon: farmer.lon }, districtId: district.id, districts, waterways: water, waterSource: water ? "OpenStreetMap (Overpass)" : null };
  }),

  /** Ready-made advisor context from live data (crops, area, district, flood prob, EC, forecast summary). */
  getAdvisorContext: proc.query(async ({ ctx }) => {
    const r = await computeRisk(ctx.user);
    const w = await computeWeather(r.farmer);
    const s = getStore();
    const user = s.users.find((u) => u.id === r.farmer.userId);
    const fields = farmerFields(r.farmer.id);
    const soil = [...fields].sort((a, b) => b.areaHa - a.areaHa)[0]?.soilType;
    return {
      context: {
        name: user?.name ?? "Farmer",
        crops: Array.from(new Set(fields.map((f) => f.cropType).concat(r.farmer.primaryCrops))),
        area_ha: round(fields.reduce((a, f) => a + f.areaHa, 0) || r.farmer.totalAreaHa, 2),
        district: r.district.name,
        country: r.district.countryName,
        flood_probability: r.result.flood.p72,
        salinity_ec: r.result.salinity.ecCurrent,
        forecast_summary: forecastSummary(w),
        soil_type: soil,
      },
      display: {
        floodPct: r.result.flood.score,
        ec: r.result.salinity.ecCurrent,
        rain72: w.rain72,
        crops: fields.map((f) => f.cropType),
        fields: fields.length,
        dischargeRatio: w.discharge?.ratio ?? null,
        floodSource: r.result.flood.source,
        weatherSource: w.sources.forecast,
      },
    };
  }),

  translateText: proc
    .input(z.object({ texts: z.array(z.string().max(2000)).min(1).max(20), target: z.enum(LANGS) }))
    .mutation(async ({ input }) => {
      const out = await Promise.all(input.texts.map((t) => translate(t, input.target)));
      return out.map((o, i) => ({ original: input.texts[i]!, text: o.text, provider: o.provider }));
    }),

  completeOnboarding: proc
    .input(
      z.object({
        personal: z.object({
          name: z.string().trim().min(2).max(80),
          phone: z.string().trim().max(20).optional(),
          country: z.string().length(2),
          districtId: z.string().max(40),
          experienceYears: z.number().int().min(0).max(80),
          language: z.enum(LANGS),
        }),
        farm: z.object({ farmName: z.string().trim().min(2).max(80), totalAreaHa: z.number().min(0.01).max(10000), primaryCrops: z.array(z.enum(CROP_LIST)).min(1).max(15) }),
        fields: z.array(fieldInput).min(1).max(20),
        risk: z.object({ floodHistory: z.enum(["never", "rarely", "sometimes", "often"]), salinityObserved: z.boolean(), hasInsurance: z.boolean() }),
        notifications: prefsInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const s = getStore();
      const user = s.users.find((u) => u.id === ctx.user.id);
      const persist = ctx.user.role === "farmer" && !!user;
      const first = ringCentroid(input.fields[0]!.polygon);
      const district = s.districts.find((d) => d.id === input.personal.districtId) ?? s.districts.find((d) => d.id === nearestDistrict(first.lat, first.lon).district.id)!;
      const mult = HISTORY_MULT[input.risk.floodHistory];

      // Real elevation per field (Copernicus DEM) and a real NDVI probe (MODIS) — best effort.
      const cents = input.fields.map((f) => ringCentroid(f.polygon));
      const [elev, ndviSeries] = await Promise.all([
        withTimeout(getElevation(cents), 8000, null as number[] | null),
        withTimeout(getModisNdvi(first.lat, first.lon), 8000, null),
      ]);

      const existing = s.farmers.find((f) => f.userId === ctx.user.id);
      const farmerId = existing?.id ?? `farmer-${nextId("f")}`;
      const now = Date.now();
      const newFields: FieldRecord[] = input.fields.map((fi, i) => {
        const ring = closeRing(fi.polygon.map(([x, y]) => [round(x, 6), round(y, 6)]));
        const c = cents[i]!;
        const e = elev?.[i] ?? null;
        const elevAdj = e == null ? 0 : e < 3 ? 6 : e < 8 ? 0 : -8;
        const floodRisk = Math.max(3, Math.min(98, district.floodRisk * mult + elevAdj));
        const salinityRisk = Math.max(2, Math.min(98, district.salinityRisk + (input.risk.salinityObserved ? 10 : -4)));
        const soilEc = round(Math.max(0.4, district.ecCurrent + (input.risk.salinityObserved ? 0.9 : -0.3)), 1);
        const planted = fi.plantingDate;
        const cycle = CROP_CYCLE_DAYS[fi.cropType];
        const growth = Math.min(1, Math.max(0, (now - planted.getTime()) / (cycle * DAY)));
        const latestModis = ndviSeries?.[ndviSeries.length - 1]?.ndvi;
        const ndvi = round(latestModis ?? 0.25 + 0.5 * Math.sin(Math.PI * Math.min(0.95, growth)), 2);
        return {
          id: nextId("fld"),
          farmerId,
          name: fi.name,
          areaHa: round(ringAreaHa(ring), 2),
          cropType: fi.cropType,
          plantingDate: planted,
          expectedHarvest: new Date(planted.getTime() + cycle * DAY),
          soilType: fi.soilType ?? "loam",
          irrigationType: fi.irrigationType,
          geometry: { type: "Polygon", coordinates: [ring] },
          lat: round(c.lat, 5),
          lon: round(c.lon, 5),
          elevationM: e == null ? 2 : round(e, 1),
          ndviScore: ndvi,
          ndviHistory: ndviSeries?.length
            ? ndviSeries.slice(-12).map((x) => ({ date: x.date, ndvi: round(x.ndvi, 2) }))
            : [{ date: new Date(now).toISOString().slice(0, 10), ndvi }],
          lastSatelliteScan: ndviSeries?.length ? new Date(ndviSeries[ndviSeries.length - 1]!.date) : new Date(now),
          floodRisk: round(floodRisk, 0),
          salinityRisk: round(salinityRisk, 0),
          soilEc,
        };
      });

      const profile = {
        id: farmerId,
        userId: ctx.user.id,
        farmName: input.farm.farmName,
        totalAreaHa: input.farm.totalAreaHa,
        primaryCrops: input.farm.primaryCrops,
        experienceYears: input.personal.experienceYears,
        lat: round(first.lat, 5),
        lon: round(first.lon, 5),
        districtId: district.id,
        country: district.countryName,
        floodHistory: input.risk.floodHistory,
        salinityObserved: input.risk.salinityObserved,
        hasInsurance: input.risk.hasInsurance,
        referralCode: existing?.referralCode ?? `AGS-${input.personal.name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() || "FARM"}${Math.floor(100 + Math.random() * 900)}`,
        referrals: existing?.referrals ?? 0,
        notificationPrefs: { alertTypes: input.notifications.alertTypes, channels: input.notifications.channels as AlertChannel[], timing: input.notifications.timing, threshold: input.notifications.threshold },
      };

      const drafts = newFields.flatMap((f) => draftRecommendations(f, profile, district).map((d) => ({ d, f })));
      let recs: { id: string; fieldId: string; fieldName: string; title: string; description: string; priority: string; actions: string[]; confidence: number; generatedBy: string }[];

      if (persist) {
        if (existing) {
          const oldIds = new Set(s.fields.filter((f) => f.farmerId === farmerId).map((f) => f.id));
          s.fields = s.fields.filter((f) => f.farmerId !== farmerId);
          s.recommendations = s.recommendations.filter((r) => !oldIds.has(r.fieldId));
          Object.assign(existing, profile);
        } else {
          s.farmers.push(profile);
        }
        s.fields.push(...newFields);
        const saved = newFields.flatMap((f) => persistRecommendations(f.id, drafts.filter((x) => x.f === f).map((x) => x.d)));
        recs = saved.sort(byPriority).map((r) => ({ id: r.id, fieldId: r.fieldId, fieldName: newFields.find((f) => f.id === r.fieldId)!.name, title: r.title, description: r.description, priority: r.priority, actions: r.actions, confidence: r.confidenceScore, generatedBy: r.generatedBy }));
        user!.name = input.personal.name;
        user!.language = input.personal.language;
        if (input.personal.phone) user!.phone = input.personal.phone.replace(/\s/g, "");
        audit({ userId: user!.id, userName: user!.name, action: "farmer.onboarded", entity: "farmer_profile", entityId: farmerId, details: `${newFields.length} fields, ${round(newFields.reduce((a, f) => a + f.areaHa, 0), 2)} ha in ${district.name}` });
      } else {
        recs = drafts.map(({ d, f }, i) => ({ id: `preview-${i}`, fieldId: f.id, fieldName: f.name, title: d.title, description: d.description, priority: d.priority, actions: d.actions, confidence: d.confidence, generatedBy: d.model, createdAt: new Date() }))
          .sort((a, b) => ({ urgent: 4, high: 3, medium: 2, low: 1 })[b.priority as "low"] - ({ urgent: 4, high: 3, medium: 2, low: 1 })[a.priority as "low"]);
      }

      const totalArea = newFields.reduce((a, f) => a + f.areaHa, 0) || 1;
      const flood = Math.round(newFields.reduce((a, f) => a + f.floodRisk * f.areaHa, 0) / totalArea);
      const salinity = Math.round(newFields.reduce((a, f) => a + f.salinityRisk * f.areaHa, 0) / totalArea);
      return {
        farmerId,
        persisted: persist,
        district: { id: district.id, name: district.name, countryName: district.countryName },
        fields: newFields.map((f) => ({ id: f.id, name: f.name, areaHa: f.areaHa, elevationM: f.elevationM, floodRisk: f.floodRisk, salinityRisk: f.salinityRisk })),
        baseline: { flood, salinity, ec: newFields[0]!.soilEc, level: riskLevelFromScore(Math.max(flood, salinity * 0.9)), ndviSource: ndviSeries?.length ? "MODIS MOD13Q1" : "estimated", elevationSource: elev ? "Copernicus DEM" : "estimated" },
        recommendations: recs.slice(0, 3),
      };
    }),

  /** Password reset request (simulated email via the outbox when no RESEND key). Public: no session needed. */
  requestPasswordReset: publicProcedure.input(z.object({ email: z.string().trim().email().max(120) })).mutation(async ({ input }) => {
    const u = getStore().users.find((x) => x.email?.toLowerCase() === input.email.toLowerCase());
    if (u) {
      const token = Math.random().toString(36).slice(2, 12);
      await sendEmail(u.email!, "Reset your Agri-SHIELD password", `<p>Hello ${u.name},</p><p>Reset your password: /auth/reset?token=${token}</p><p>This link expires in 30 minutes.</p>`);
      audit({ userId: u.id, userName: u.name, action: "auth.password_reset_requested", entity: "user", entityId: u.id, details: "Reset link emailed" });
    }
    // Same response whether or not the account exists (no user enumeration).
    return { ok: true, expiresInMin: 30 };
  }),
});
