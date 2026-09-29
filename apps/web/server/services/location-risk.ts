/**
 * Location Intelligence engine — climate risk for ANY coordinate on Earth.
 *
 *  assessMany(points)      → fast batched scoring for portfolios (hundreds of assets;
 *                            Open-Meteo multi-location + GloFAS in a few HTTP calls)
 *  assessLocation(lat,lon) → full report for one site (ML flood/salinity models,
 *                            forecast, river discharge, and — as the engine grows —
 *                            ensemble spread, seasonal outlook, climate projections,
 *                            observed flood extent, soil, nearby hazards)
 *
 * The shapes below are the stable contract used by the Explorer, Portfolio,
 * Insurance, Finance and Copilot modules. Extend with optional fields only.
 */
import type { CropType, RiskLevel } from "@agri-shield/types";
import { getStore } from "../data/store";
import { cached } from "../live/http";
import { getForecast, getRiverDischarge, type ForecastResult, type FloodResult } from "../live/open-meteo";
import { getHazardEvents, type HazardEvent } from "../live/events";
import { getFloodRisk, getSalinityRisk } from "../ml-client";
import { clamp01, riskLevel, scoreFlood, scoreSalinity } from "../risk/scoring";

// ─── Contract ─────────────────────────────────────────────────────────────

export interface QuickAssessment {
  floodRisk: number; // 0-100 (72h probability)
  floodProb24h: number; // 0-1
  salinityRisk: number; // 0-100
  salinityEc: number; // dS/m
  droughtRisk: number; // 0-100
  heatRisk: number; // 0-100
  composite: number; // 0-100
  level: RiskLevel;
  drivers: string[];
  rain24hMm: number;
  rain72hMm: number;
  maxTempC: number | null;
  dischargeRatio: number | null;
  source: "open-meteo" | "fallback";
}

export interface DataSourceStamp {
  name: string;
  url: string;
  ok: boolean;
  fetchedAt: string;
  note?: string;
}

export interface LocationRiskReport {
  location: {
    lat: number;
    lon: number;
    name: string | null;
    country: string | null;
    elevationM: number | null;
    nearestDistrictId: string | null;
    nearestDistrictKm: number | null;
    inCoreCoverage: boolean;
  };
  generatedAt: string;
  composite: { score: number; level: RiskLevel; drivers: string[]; summary: string };
  hazards: {
    flood: { score: number; p24: number; p48: number; p72: number; depthM: number; ci: [number, number]; factors: string[]; model: string };
    salinity: { score: number; ecNow: number; ec7d: number; ec30d: number; class: string; cropDamageProb: number; applicable: boolean; model: string };
    drought: { score: number; rain7dForecastMm: number; et0_7dMm: number; waterBalance7dMm: number; model: string };
    heat: { score: number; maxTempC: number | null; hotDays: number; model: string };
  };
  forecast: {
    hourly: { time: string; precipMm: number; precipProb: number; tempC: number | null; soilMoisture: number | null; floodProb?: number }[];
    daily: { date: string; precipMm: number; precipProb: number; tMax: number | null; tMin: number | null; et0: number | null }[];
  };
  river: { dischargeM3s: number | null; meanM3s: number | null; ratio: number | null; series: { date: string; value: number | null }[] } | null;
  hazardsNearby: (HazardEvent & { distanceKm: number })[];
  sources: DataSourceStamp[];
  /** Optional enrichments filled by the full engine (seasonal, climate, observed, soil…) */
  extras?: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Nearest monitored district and exposure priors (decay to a neutral prior with distance). */
export function exposurePriors(lat: number, lon: number) {
  const s = getStore();
  let best: { d: (typeof s.districts)[number]; km: number } | null = null;
  for (const d of s.districts) {
    const km = haversineKm(lat, lon, d.lat, d.lon);
    if (!best || km < best.km) best = { d, km };
  }
  const w = best ? Math.exp(-best.km / 120) : 0; // full weight inside a district, ~0 beyond ~400 km
  return {
    district: best?.d ?? null,
    km: best?.km ?? null,
    flood: best ? w * best.d.floodExposure + (1 - w) * 0.45 : 0.45,
    salinity: best ? w * best.d.salinityExposure + (1 - w) * 0.15 : 0.15,
  };
}

const sum = (a: (number | null | undefined)[]) => a.reduce<number>((t, v) => t + (v ?? 0), 0);
const nowIdx = (times: string[]) => {
  const now = Date.now();
  const i = times.findIndex((t) => new Date(t).getTime() > now);
  return i < 0 ? times.length - 1 : Math.max(0, i - 1);
};

function dischargeRatio(f: FloodResult | undefined): { ratio: number | null; peak: number | null; mean: number | null } {
  const daily = f?.daily;
  if (!daily) return { ratio: null, peak: null, mean: null };
  const today = new Date().toISOString().slice(0, 10);
  const ti = Math.max(0, daily.time.indexOf(today));
  const hist = daily.river_discharge.slice(0, ti).filter((v): v is number => v != null && v > 0);
  const fut = daily.river_discharge.slice(ti, ti + 4).filter((v): v is number => v != null);
  if (hist.length < 5 || !fut.length) return { ratio: null, peak: null, mean: null };
  const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
  const peak = Math.max(...fut);
  return { ratio: mean > 0 ? peak / mean : null, peak, mean };
}

function droughtScore(f: ForecastResult): { score: number; rain7: number; et07: number } {
  const rain7 = sum(f.daily.precipitation_sum.slice(1, 8));
  const et07 = sum(f.daily.et0_fao_evapotranspiration.slice(1, 8));
  const deficit = et07 - rain7; // mm over the next week
  return { score: Math.round(clamp01((deficit - 10) / 35) * 100), rain7, et07 };
}

function heatScore(f: ForecastResult): { score: number; tmax: number | null; hot: number } {
  const t = f.daily.temperature_2m_max.filter((v): v is number => v != null);
  if (!t.length) return { score: 0, tmax: null, hot: 0 };
  const tmax = Math.max(...t);
  const hot = t.filter((v) => v >= 35).length;
  return { score: Math.round(clamp01((tmax - 32) / 10) * 100), tmax, hot };
}

export function compositeScore(p: { flood: number; salinity: number; drought: number; heat: number }): number {
  // Dominant hazard drives the score; secondary hazards add a compounding bonus
  const sorted = [p.flood, p.salinity * 0.9, p.drought * 0.85, p.heat * 0.7].sort((a, b) => b - a);
  return Math.round(Math.min(100, sorted[0]! + 0.25 * sorted[1]! + 0.1 * sorted[2]!));
}

function driversFor(q: { flood: number; salinity: number; drought: number; heat: number; rain72: number; ratio: number | null }): string[] {
  const d: string[] = [];
  if (q.flood >= 35) d.push(q.rain72 > 80 ? `Heavy rain forecast (${Math.round(q.rain72)} mm / 72h)` : "Elevated flood probability");
  if (q.ratio != null && q.ratio > 1.4) d.push(`River discharge ${q.ratio.toFixed(1)}× its 30-day mean`);
  if (q.salinity >= 35) d.push("Saltwater intrusion pressure");
  if (q.drought >= 35) d.push("Evaporation exceeds rainfall (dry spell)");
  if (q.heat >= 35) d.push("Heat stress on crops");
  if (!d.length) d.push("No significant hazard in the forecast window");
  return d;
}

// ─── Batched quick assessment (portfolios) ───────────────────────────────

export async function assessMany(points: { id: string; lat: number; lon: number; crop?: CropType | null }[]): Promise<Map<string, QuickAssessment>> {
  const out = new Map<string, QuickAssessment>();
  const CHUNK = 50;
  const month = new Date().getMonth() + 1;
  for (let i = 0; i < points.length; i += CHUNK) {
    const chunk = points.slice(i, i + CHUNK);
    // Round to ~1 km so nearby assets share cache entries
    const pts = chunk.map((p) => ({ lat: Math.round(p.lat * 100) / 100, lon: Math.round(p.lon * 100) / 100 }));
    const [fc, fl] = await Promise.allSettled([getForecast(pts, 8), getRiverDischarge(pts, 7)]);
    chunk.forEach((p, k) => {
      const pri = exposurePriors(p.lat, p.lon);
      const f = fc.status === "fulfilled" ? fc.value[k] : undefined;
      if (!f) {
        const d = pri.district;
        const flood = d ? d.floodRisk : 30;
        const salinity = d ? d.salinityRisk : 10;
        const composite = compositeScore({ flood, salinity, drought: 20, heat: 10 });
        out.set(p.id, { floodRisk: flood, floodProb24h: d?.floodProb24h ?? 0.2, salinityRisk: salinity, salinityEc: d?.ecCurrent ?? 1, droughtRisk: 20, heatRisk: 10, composite, level: riskLevel(composite), drivers: ["Using last known district baseline (live feed unavailable)"], rain24hMm: 0, rain72hMm: d?.rainfall72hMm ?? 0, maxTempC: null, dischargeRatio: null, source: "fallback" });
        return;
      }
      const i0 = nowIdx(f.hourly.time);
      const pr = f.hourly.precipitation;
      const r24 = sum(pr.slice(i0, i0 + 24));
      const r48 = sum(pr.slice(i0, i0 + 48));
      const r72 = sum(pr.slice(i0, i0 + 72));
      const dis = dischargeRatio(fl.status === "fulfilled" ? fl.value[k] : undefined);
      const flood = scoreFlood({ rain24hMm: r24, rain48hMm: r48, rain72hMm: r72, soilMoisture: f.hourly.soil_moisture_0_to_7cm[i0] ?? 0.3, dischargeRatio: dis.ratio, exposure: pri.flood, elevationM: f.elevation });
      const sal = scoreSalinity({ exposure: pri.salinity, month, rain30dMm: sum(f.daily.precipitation_sum) * 4, seaLevelM: null, latitude: p.lat });
      const dr = droughtScore(f);
      const ht = heatScore(f);
      const composite = compositeScore({ flood: flood.score, salinity: sal.score, drought: dr.score, heat: ht.score });
      out.set(p.id, {
        floodRisk: flood.score,
        floodProb24h: flood.p24,
        salinityRisk: sal.score,
        salinityEc: sal.ecCurrent,
        droughtRisk: dr.score,
        heatRisk: ht.score,
        composite,
        level: riskLevel(composite),
        drivers: driversFor({ flood: flood.score, salinity: sal.score, drought: dr.score, heat: ht.score, rain72: r72, ratio: dis.ratio }),
        rain24hMm: Math.round(r24 * 10) / 10,
        rain72hMm: Math.round(r72 * 10) / 10,
        maxTempC: ht.tmax,
        dischargeRatio: dis.ratio == null ? null : Math.round(dis.ratio * 100) / 100,
        source: "open-meteo",
      });
    });
  }
  return out;
}

// ─── Full single-site report ─────────────────────────────────────────────

export async function assessLocation(lat: number, lon: number, opts: { crop?: CropType; name?: string | null } = {}): Promise<LocationRiskReport> {
  const key = `loc:${lat.toFixed(3)},${lon.toFixed(3)}:${opts.crop ?? "rice"}`;
  return cached(key, 10 * 60_000, async () => {
    const pri = exposurePriors(lat, lon);
    const stamp = (name: string, url: string, ok: boolean, note?: string): DataSourceStamp => ({ name, url, ok, fetchedAt: new Date().toISOString(), note });
    const [fcR, flR, floodR, salR, hazR] = await Promise.allSettled([
      getForecast([{ lat, lon }], 8),
      getRiverDischarge([{ lat, lon }], 7),
      getFloodRisk(lat, lon, pri.flood),
      getSalinityRisk(lat, lon, opts.crop ?? "rice", pri.salinity),
      getHazardEvents(),
    ]);
    const f = fcR.status === "fulfilled" ? fcR.value[0] : undefined;
    const fl = flR.status === "fulfilled" ? flR.value[0] : undefined;
    const flood = floodR.status === "fulfilled" ? floodR.value : null;
    const sal = salR.status === "fulfilled" ? salR.value : null;
    const dis = dischargeRatio(fl);

    const i0 = f ? nowIdx(f.hourly.time) : 0;
    const hourly = f
      ? f.hourly.time.slice(i0, i0 + 72).map((time, k) => ({
          time,
          precipMm: f.hourly.precipitation[i0 + k] ?? 0,
          precipProb: f.hourly.precipitation_probability[i0 + k] ?? 0,
          tempC: f.hourly.temperature_2m[i0 + k] ?? null,
          soilMoisture: f.hourly.soil_moisture_0_to_7cm[i0 + k] ?? null,
          floodProb: flood?.hourly?.[k]?.probability,
        }))
      : [];
    const daily = f
      ? f.daily.time.map((date, k) => ({ date, precipMm: f.daily.precipitation_sum[k] ?? 0, precipProb: f.daily.precipitation_probability_max[k] ?? 0, tMax: f.daily.temperature_2m_max[k] ?? null, tMin: f.daily.temperature_2m_min[k] ?? null, et0: f.daily.et0_fao_evapotranspiration[k] ?? null }))
      : [];

    const floodScore = flood ? Math.round(flood.probability_72h * 100) : 0;
    const salApplicable = pri.salinity > 0.2;
    const salScore = sal && salApplicable ? Math.round(clamp01(sal.ec_predicted_30d / 9) * 100) : 0;
    const dr = f ? droughtScore(f) : { score: 0, rain7: 0, et07: 0 };
    const ht = f ? heatScore(f) : { score: 0, tmax: null, hot: 0 };
    const composite = compositeScore({ flood: floodScore, salinity: salScore, drought: dr.score, heat: ht.score });
    const rain72 = hourly.reduce((t, h) => t + h.precipMm, 0);
    const drivers = driversFor({ flood: floodScore, salinity: salScore, drought: dr.score, heat: ht.score, rain72, ratio: dis.ratio });
    const level = riskLevel(composite);

    const hazards = (hazR.status === "fulfilled" ? hazR.value : [])
      .map((h) => ({ ...h, distanceKm: Math.round(haversineKm(lat, lon, h.lat, h.lon)) }))
      .filter((h) => h.distanceKm <= 800)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 8);

    return {
      location: {
        lat,
        lon,
        name: opts.name ?? null,
        country: pri.district && (pri.km ?? 999) < 150 ? pri.district.countryName : null,
        elevationM: f?.elevation ?? null,
        nearestDistrictId: pri.district?.id ?? null,
        nearestDistrictKm: pri.km == null ? null : Math.round(pri.km),
        inCoreCoverage: (pri.km ?? 999) < 80,
      },
      generatedAt: new Date().toISOString(),
      composite: {
        score: composite,
        level,
        drivers,
        summary: `${level[0]!.toUpperCase()}${level.slice(1)} overall climate risk (${composite}/100). ${drivers[0]}.`,
      },
      hazards: {
        flood: flood
          ? { score: floodScore, p24: flood.probability_24h, p48: flood.probability_48h, p72: flood.probability_72h, depthM: flood.estimated_depth_m, ci: flood.confidence_interval, factors: flood.contributing_factors, model: flood.model_version }
          : { score: 0, p24: 0, p48: 0, p72: 0, depthM: 0, ci: [0, 0], factors: [], model: "unavailable" },
        salinity: sal
          ? { score: salScore, ecNow: sal.ec_current, ec7d: sal.ec_predicted_7d, ec30d: sal.ec_predicted_30d, class: sal.risk_level, cropDamageProb: sal.crop_damage_probability, applicable: salApplicable, model: sal.model_version }
          : { score: 0, ecNow: 0, ec7d: 0, ec30d: 0, class: "unknown", cropDamageProb: 0, applicable: false, model: "unavailable" },
        drought: { score: dr.score, rain7dForecastMm: Math.round(dr.rain7 * 10) / 10, et0_7dMm: Math.round(dr.et07 * 10) / 10, waterBalance7dMm: Math.round((dr.rain7 - dr.et07) * 10) / 10, model: "fao56-water-balance-v1" },
        heat: { score: ht.score, maxTempC: ht.tmax, hotDays: ht.hot, model: "tmax-threshold-v1" },
      },
      forecast: { hourly, daily },
      river: fl ? { dischargeM3s: dis.peak == null ? null : Math.round(dis.peak), meanM3s: dis.mean == null ? null : Math.round(dis.mean), ratio: dis.ratio == null ? null : Math.round(dis.ratio * 100) / 100, series: fl.daily.time.map((date, k) => ({ date, value: fl.daily.river_discharge[k] ?? null })) } : null,
      hazardsNearby: hazards,
      sources: [
        stamp("Open-Meteo forecast", "https://open-meteo.com", !!f),
        stamp("GloFAS v4 river discharge", "https://open-meteo.com/en/docs/flood-api", !!fl),
        stamp("Agri-SHIELD flood model", "/docs/methodology-flood", !!flood, flood?.model_version),
        stamp("Agri-SHIELD salinity model", "/docs/methodology-salinity", !!sal, sal?.model_version),
        stamp("GDACS + NASA EONET", "https://www.gdacs.org", hazR.status === "fulfilled"),
      ],
    };
  });
}
