/**
 * Supply-chain intelligence service (spec §4.6 + §5.4).
 *
 * Everything here is computed from the shared store (nodes, flows, fields,
 * districts with the live Open-Meteo/GloFAS overlay), live hazard feeds
 * (GDACS + NASA EONET), a 16-day Open-Meteo precipitation outlook, World Bank
 * open data and a Monte Carlo engine (Python ML service, or the TS fallback).
 *
 * Exports used outside the router:
 *   computeCommodityRisks(horizonDays)  — commodity → region risk table
 *   evaluateWebhooks(opts)              — fire signed webhooks on threshold breach
 *   verifyApiKey(rawKey)                — for the public REST surface
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { SupplyChainNodeType } from "@agri-shield/types";
import { CROP_EC_THRESHOLDS } from "@agri-shield/types";
import {
  audit,
  getStore,
  nextId,
  riskLevelFromScore,
  type ApiKeyRecord,
  type CommodityRecord,
  type DistrictRecord,
  type FieldRecord,
  type SupplyNodeRecord,
  type WebhookRecord,
} from "../data/store";
import {
  COMMODITY_LABEL,
  CROP_YIELD_T_HA,
  DEFAULT_CROP_SHARE,
  DELAY_USD_PER_T_WEEK,
  DETOUR,
  DOWNSTREAM_BUYERS,
  FORWARD_PREMIUM_PCT,
  HOLDING_USD_PER_T_WEEK,
  MARKET_SHARE_OF_DELTAS,
  MODE_SPEC,
  NODE_TYPE_LABEL,
  PARAMETRIC_LOADING,
  PRICE_FLEXIBILITY,
  SOURCING_WINDOW_WEEKS,
  asCrop,
  pickMode,
  type TransportMode,
} from "../data/sc-reference";
import { logDelivery, saveScenario, scState, type WebhookDelivery } from "../data/sc-state";
import { runMonteCarlo, type MCOutput } from "../data/sc-montecarlo";
import { getForecast, getRiverDischarge } from "../live/open-meteo";
import { getHazardEvents, type HazardEvent } from "../live/events";
import { cached, fetchJson } from "../live/http";
import { clamp01, cropDamageProbability, floodCropLoss, scoreFlood } from "../risk/scoring";
import { runScenarioRemote, type ScenarioResult } from "../ml-client";
import { publish, type RealtimeEvent } from "../realtime";

// ─── small helpers ─────────────────────────────────────────────────────────

const R_EARTH = 6371;
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

const districtIndex = () => new Map(getStore().districts.map((d) => [d.id, d]));
const nodeIndex = () => new Map(getStore().nodes.map((n) => [n.id, n]));
const commodityRec = (c: string) => getStore().commodities.find((x) => x.commodity === c);
export const latestPrice = (c: CommodityRecord) => c.priceHistory[c.priceHistory.length - 1]?.price ?? c.basePriceUsd;

function nodePriceUsd(node: SupplyNodeRecord) {
  const prices = node.primaryCommodities.map((c) => {
    const rec = commodityRec(c);
    return rec ? latestPrice(rec) : 400;
  });
  return prices.length ? sum(prices) / prices.length : 400;
}

async function hazards(): Promise<HazardEvent[]> {
  return withTimeout(getHazardEvents(), 5000, []);
}

// ─── Node composite risk ───────────────────────────────────────────────────

export interface RiskFactor {
  key: "flood" | "salinity" | "hazard" | "upstream" | "capacity";
  label: string;
  value: number; // 0-100
  weight: number;
  contribution: number;
  detail: string;
}

export interface NodeRisk {
  id: string;
  name: string;
  type: SupplyChainNodeType;
  typeLabel: string;
  districtId: string;
  districtName: string;
  country: string;
  lat: number;
  lon: number;
  owned: boolean;
  capacityTonnes: number;
  utilizationPct: number;
  commodities: string[];
  composite: number;
  level: ReturnType<typeof riskLevelFromScore>;
  baseRiskScore: number;
  floodRisk: number;
  salinityRisk: number;
  factors: RiskFactor[];
  inventoryTonnes: number;
  inventoryValueUsd: number;
  weeklyInTonnes: number;
  weeklyOutTonnes: number;
  nearestHazard: { title: string; source: string; km: number; type: string; alertLevel: string | null } | null;
  liveSource: string;
}

const WEIGHTS = { flood: 0.4, salinity: 0.15, hazard: 0.15, upstream: 0.2, capacity: 0.1 } as const;

export function computeNodeRisks(events: HazardEvent[], orgId: string | null): NodeRisk[] {
  const s = getStore();
  const dIdx = districtIndex();
  const nIdx = nodeIndex();
  return s.nodes.map((n) => {
    const d = dIdx.get(n.districtId);
    const inflows = s.flows.filter((f) => f.to === n.id);
    const outflows = s.flows.filter((f) => f.from === n.id);
    const maxSalSens = Math.max(0.3, ...n.primaryCommodities.map((c) => commodityRec(c)?.salinitySensitivity ?? 0.4));
    const maxFloodSens = Math.max(0.3, ...n.primaryCommodities.map((c) => commodityRec(c)?.floodSensitivity ?? 0.5));

    // hazard proximity (GDACS / EONET within 600 km)
    let nearest: NodeRisk["nearestHazard"] = null;
    let hazardV = 0;
    for (const e of events) {
      const km = haversineKm(n, e);
      if (km > 600) continue;
      const mult = e.alertLevel === "red" ? 1 : e.alertLevel === "orange" ? 0.8 : e.alertLevel === "green" ? 0.45 : 0.6;
      const ageDays = (Date.now() - new Date(e.date).getTime()) / 86_400_000;
      const fresh = ageDays < 10 ? 1 : ageDays < 30 ? 0.6 : 0.35;
      const v = 100 * (1 - km / 600) * mult * fresh;
      if (v > hazardV) {
        hazardV = v;
        nearest = { title: e.title, source: e.source, km: Math.round(km), type: e.type, alertLevel: e.alertLevel };
      }
    }

    // upstream exposure: tonnage-weighted flood risk of suppliers, else producing hinterland
    let upstreamV: number;
    let upstreamDetail: string;
    const inT = sum(inflows.map((f) => f.tonnesPerWeek));
    if (inflows.length && inT > 0) {
      upstreamV = sum(inflows.map((f) => (nIdx.get(f.from)?.floodRisk ?? 50) * f.tonnesPerWeek)) / inT;
      const worst = inflows.map((f) => nIdx.get(f.from)!).filter(Boolean).sort((a, b) => b.floodRisk - a.floodRisk)[0];
      upstreamDetail = `${inflows.length} supplier link(s), ${inT.toLocaleString()} t/wk; most exposed: ${worst?.name ?? "—"} (${worst?.floodRisk ?? "—"})`;
    } else {
      upstreamV = (d?.floodRisk ?? 50) * maxFloodSens;
      upstreamDetail = `Origin node — sourcing from ${d?.name ?? "local"} farmland (flood ${d?.floodRisk ?? "—"} × crop sensitivity ${maxFloodSens})`;
    }

    const capV = clamp01((n.utilizationPct - 55) / 40) * 100;
    const salV = clamp(n.salinityRisk * (maxSalSens / 0.7), 0, 100);

    const factors: RiskFactor[] = [
      {
        key: "flood",
        label: "Flood exposure",
        value: n.floodRisk,
        weight: WEIGHTS.flood,
        contribution: 0,
        detail: d
          ? `${d.name}: 72h flood p=${Math.round(d.floodProb72h * 100)}%, rain 72h ${d.rainfall72hMm} mm${d.riverDischargeM3s != null ? `, GloFAS ${d.riverDischargeM3s} m³/s vs mean ${d.riverDischargeMeanM3s}` : ""}`
          : "—",
      },
      { key: "salinity", label: "Salinity / quality", value: Math.round(salV), weight: WEIGHTS.salinity, contribution: 0, detail: d ? `EC ${d.ecCurrent} dS/m → ${d.ecPredicted30d} in 30d; commodity salt sensitivity ${maxSalSens}` : "—" },
      { key: "hazard", label: "Live hazard proximity", value: Math.round(hazardV), weight: WEIGHTS.hazard, contribution: 0, detail: nearest ? `${nearest.source}: ${nearest.title} — ${nearest.km} km` : "No GDACS/EONET event within 600 km" },
      { key: "upstream", label: "Upstream dependency", value: Math.round(upstreamV), weight: WEIGHTS.upstream, contribution: 0, detail: upstreamDetail },
      { key: "capacity", label: "Capacity stress", value: Math.round(capV), weight: WEIGHTS.capacity, contribution: 0, detail: `Utilisation ${n.utilizationPct}% of ${n.capacityTonnes.toLocaleString()} t` },
    ];
    for (const f of factors) f.contribution = r1(f.value * f.weight);
    const composite = Math.round(clamp(sum(factors.map((f) => f.contribution)), 0, 100));
    const inventoryTonnes = Math.round((n.capacityTonnes * n.utilizationPct) / 100);
    return {
      id: n.id,
      name: n.name,
      type: n.type,
      typeLabel: NODE_TYPE_LABEL[n.type],
      districtId: n.districtId,
      districtName: d?.name ?? n.districtId,
      country: n.country,
      lat: n.lat,
      lon: n.lon,
      owned: !orgId || n.orgId === orgId,
      capacityTonnes: n.capacityTonnes,
      utilizationPct: n.utilizationPct,
      commodities: n.primaryCommodities,
      composite,
      level: riskLevelFromScore(composite),
      baseRiskScore: n.riskScore,
      floodRisk: n.floodRisk,
      salinityRisk: n.salinityRisk,
      factors,
      inventoryTonnes,
      inventoryValueUsd: Math.round(inventoryTonnes * nodePriceUsd(n)),
      weeklyInTonnes: inT,
      weeklyOutTonnes: sum(outflows.map((f) => f.tonnesPerWeek)),
      nearestHazard: nearest,
      liveSource: d?.liveSource ?? "seed",
    };
  });
}

function flowCorridor(a: { lat: number; lon: number; country: string }, b: { lat: number; lon: number; country: string }) {
  const gc = haversineKm(a, b);
  const mode: TransportMode = pickMode(a.country, b.country, gc);
  const km = Math.round(gc * DETOUR[mode]);
  const spec = MODE_SPEC[mode];
  return { mode, modeLabel: spec.label, km, transitDays: r1(km / spec.kmPerDay + spec.handlingDays), freightUsdPerT: r1(km * spec.usdPerTkm + spec.fixedUsdPerT) };
}

// ─── Production estimates from field data ─────────────────────────────────

interface DistrictCrop {
  areaHa: number;
  standingTonnes: number;
  sampleFields: FieldRecord[];
  sampleAreaHa: number;
  harvestDueDays: number[]; // days until harvest for each sampled field
  shareSource: "field-sample" | "regional-default";
}

function fieldsByDistrict(): Map<string, FieldRecord[]> {
  const s = getStore();
  const farmerDistrict = new Map(s.farmers.map((f) => [f.id, f.districtId]));
  const m = new Map<string, FieldRecord[]>();
  for (const f of s.fields) {
    const did = farmerDistrict.get(f.farmerId);
    if (!did) continue;
    (m.get(did) ?? m.set(did, []).get(did)!).push(f);
  }
  return m;
}

function districtCrop(d: DistrictRecord, commodity: string, fbd: Map<string, FieldRecord[]>): DistrictCrop {
  const all = fbd.get(d.id) ?? [];
  const sampleTotal = sum(all.map((f) => f.areaHa));
  const crop = all.filter((f) => f.cropType === commodity);
  const cropArea = sum(crop.map((f) => f.areaHa));
  const yieldT = CROP_YIELD_T_HA[commodity] ?? 4;
  let share: number;
  let shareSource: DistrictCrop["shareSource"];
  const prior = DEFAULT_CROP_SHARE[commodity] ?? 0.05;
  if (sampleTotal > 0 && cropArea > 0) {
    // empirical-Bayes shrinkage of the field-sample share toward the regional prior
    const wSample = all.length / (all.length + 10);
    share = wSample * (cropArea / sampleTotal) + (1 - wSample) * prior;
    shareSource = "field-sample";
  } else {
    share = prior * 0.5;
    shareSource = "regional-default";
  }
  const areaHa = d.monitoredAreaHa * share;
  const now = Date.now();
  return {
    areaHa: Math.round(areaHa),
    standingTonnes: Math.round(areaHa * yieldT),
    sampleFields: crop,
    sampleAreaHa: r1(cropArea),
    harvestDueDays: crop.map((f) => Math.round((f.expectedHarvest.getTime() - now) / 86_400_000)),
    shareSource,
  };
}

function producingDistricts(c: CommodityRecord): DistrictRecord[] {
  const idx = districtIndex();
  const ids = new Set(c.producingDistricts);
  for (const d of getStore().districts) if (d.primaryCrops.includes(c.commodity)) ids.add(d.id);
  return [...ids].map((id) => idx.get(id)).filter((d): d is DistrictRecord => !!d);
}

// ─── 30-day district outlook (16-day Open-Meteo forecast + persistence) ───

interface DayOutlook {
  date: string;
  rainMm: number;
  flood: number;
  salinity: number;
  forecast: boolean;
}

function monsoonFactor(month: number, lat: number) {
  if (lat < 0) return [1, 1, 1, 0.7, 0.45, 0.4, 0.4, 0.4, 0.45, 0.55, 0.7, 1][month - 1]!;
  return [0.35, 0.35, 0.4, 0.5, 0.7, 0.95, 1, 1, 1, 0.9, 0.7, 0.45][month - 1]!;
}

async function districtOutlook(): Promise<{ byDistrict: Map<string, DayOutlook[]>; source: "open-meteo" | "seed" }> {
  const s = getStore();
  const pts = s.districts.map((d) => ({ lat: d.lat, lon: d.lon }));
  const fc = await withTimeout(
    cached("sc:fc16", 30 * 60_000, () => getForecast(pts, 16)),
    9000,
    null as Awaited<ReturnType<typeof getForecast>> | null
  );
  const byDistrict = new Map<string, DayOutlook[]>();
  const today = new Date();
  s.districts.forEach((d, i) => {
    const f = fc?.[i];
    const baseline = d.floodExposure * 70 * monsoonFactor(today.getMonth() + 1, d.lat);
    const salEnd = clamp01(d.ecPredicted30d / 9) * 100;
    const days: DayOutlook[] = [];
    const dis = d.riverDischargeM3s != null && d.riverDischargeMeanM3s ? d.riverDischargeM3s / d.riverDischargeMeanM3s : null;
    let soil = 0.3;
    if (f) {
      const nowIdx = Math.max(0, f.hourly.time.findIndex((t) => new Date(t).getTime() > Date.now()) - 1);
      soil = f.hourly.soil_moisture_0_to_7cm[nowIdx] ?? 0.3;
    }
    const rainAt = (k: number) => (f ? f.daily.precipitation_sum[k + 1] ?? 0 : 0); // index 0 = yesterday (past_days=1)
    const raw: number[] = [];
    for (let t = 0; t < 30; t++) {
      const date = new Date(today.getTime() + t * 86_400_000).toISOString().slice(0, 10);
      let flood: number;
      const forecastDay = !!f && t < 15;
      if (forecastDay) {
        const r24 = rainAt(t);
        const r48 = r24 + rainAt(t - 1);
        const r72 = r48 + rainAt(t - 2);
        soil = clamp(soil * 0.93 + r24 / 250, 0.1, 0.5);
        const disR = dis == null ? null : 1 + (dis - 1) * Math.exp(-t / 10);
        flood = scoreFlood({ rain24hMm: r24, rain48hMm: r48, rain72hMm: r72, soilMoisture: soil, dischargeRatio: disR, exposure: d.floodExposure }).score;
      } else if (f) {
        const last = raw[14] ?? baseline;
        flood = baseline + (last - baseline) * Math.exp(-(t - 14) / 6);
      } else {
        flood = baseline + (d.floodRisk - baseline) * Math.exp(-t / 7);
      }
      raw.push(flood);
      days.push({ date, rainMm: r1(forecastDay ? rainAt(t) : 0), flood, salinity: d.salinityRisk + ((salEnd - d.salinityRisk) * t) / 29, forecast: forecastDay });
    }
    // anchor day 0 on the live district score (includes discharge + sea level overlay)
    const delta = d.floodRisk - (raw[0] ?? d.floodRisk);
    days.forEach((x, t) => {
      x.flood = Math.round(clamp(x.flood + delta * Math.exp(-t / 4), 0, 100));
      x.salinity = Math.round(clamp(x.salinity, 0, 100));
    });
    byDistrict.set(d.id, days);
  });
  return { byDistrict, source: fc ? "open-meteo" : "seed" };
}

// ─── Commodity risk ────────────────────────────────────────────────────────

export interface CommodityRegionRisk {
  districtId: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  floodRisk: number;
  salinityRisk: number;
  ecCurrent: number;
  peakRisk: number;
  level: string;
  lossPct: number;
  areaHa: number;
  standingTonnes: number;
  atRiskTonnes: number;
  sampleFields: number;
  shareSource: string;
  qualityFlag: string | null;
}

export interface CommodityRisk {
  commodity: string;
  label: string;
  unit: string;
  horizonDays: number;
  currentPrice: number;
  basePrice: number;
  weeklyVolumeTonnes: number;
  riskScore: number;
  riskLevel: string;
  supplyDisruptionPct: number;
  priceImpactPct: number;
  priceImpactBand: [number, number];
  atRiskVolumeTonnes: number;
  atRiskValueUsd: number;
  standingVolumeTonnes: number;
  /** share of the standing regional crop that flows through the organisation's network in a harvest window */
  sourcingSharePct: number;
  networkAtRiskTonnes: number;
  networkValueAtRiskUsd: number;
  monitored: { fields: number; areaHa: number; atRiskTonnes: number; harvestDueInHorizon: number };
  regions: CommodityRegionRisk[];
  timeline: { day: number; date: string; risk: number; flood: number; salinity: number; forecast: boolean }[];
  drivers: string[];
  volatilityWeeklyPct: number;
  momentum4wPct: number;
}

function priceStats(c: CommodityRecord) {
  const p = c.priceHistory.map((x) => x.price);
  const rets = p.slice(1).map((v, i) => Math.log(v / p[i]!));
  const mu = sum(rets) / Math.max(1, rets.length);
  const sd = Math.sqrt(sum(rets.map((r) => (r - mu) ** 2)) / Math.max(1, rets.length - 1));
  const last = p[p.length - 1] ?? c.basePriceUsd;
  const m4 = p.length > 4 ? (last / p[p.length - 5]! - 1) * 100 : 0;
  // largest 3-week run-up observed in the history
  let maxRunup = 0;
  for (let i = 0; i + 3 < p.length; i++) maxRunup = Math.max(maxRunup, (p[i + 3]! / p[i]! - 1) * 100);
  return { sd, mu, last, momentum4w: m4, maxRunup3w: maxRunup };
}

function qualityFlagFor(commodity: string, d: DistrictRecord): string | null {
  const t = CROP_EC_THRESHOLDS[asCrop(commodity)];
  const flags: string[] = [];
  if (t && d.ecCurrent > t.sensitive) {
    flags.push(
      commodity === "rice"
        ? `Salinity EC ${d.ecCurrent} dS/m > ${t.sensitive}: chalky kernels, lower head-rice recovery`
        : `Salinity EC ${d.ecCurrent} dS/m > ${t.sensitive}: salt stress lowers grade`
    );
  }
  if (d.floodRisk >= 60) flags.push("Flood-exposed: high moisture / mould risk at intake");
  return flags.length ? flags.join(" · ") : null;
}

export async function computeCommodityRisks(horizonDays: 7 | 14 | 30 = 7): Promise<{ horizonDays: number; outlookSource: string; commodities: CommodityRisk[] }> {
  const s = getStore();
  const { byDistrict, source } = await districtOutlook();
  const fbd = fieldsByDistrict();
  const h = horizonDays;

  const commodities = s.commodities.map((c): CommodityRisk => {
    const ds = producingDistricts(c);
    const fs = c.floodSensitivity;
    const ss = c.salinitySensitivity;
    const stats = priceStats(c);
    const crops = ds.map((d) => ({ d, crop: districtCrop(d, c.commodity, fbd) }));
    const totalStanding = sum(crops.map((x) => x.crop.standingTonnes)) || 1;

    const regions: CommodityRegionRisk[] = crops.map(({ d, crop }) => {
      const days = byDistrict.get(d.id)!.slice(0, h);
      const peakFlood = Math.max(...days.map((x) => x.flood));
      const salAt = days[days.length - 1]!.salinity;
      const pFlood = peakFlood / 100;
      const depth = Math.max(0.1, (pFlood - 0.3) * 1.4 + d.floodExposure * 0.3);
      const duration = 1 + 7 * pFlood * d.floodExposure;
      // only part of a district's cropland is inundated: vulnerable share × p² (spatial extent grows with probability)
      const vulnerableShare = clamp01(d.vulnerableAreaHa / Math.max(1, d.monitoredAreaHa));
      const inundated = vulnerableShare * pFlood * pFlood * 0.4;
      const floodLoss = inundated * floodCropLoss(depth, duration, fs);
      const ecH = d.ecCurrent + ((d.ecPredicted30d - d.ecCurrent) * h) / 30;
      const salineShare = d.salinityExposure * 0.6; // coastal / tidal part of the district
      const salLoss = cropDamageProbability(asCrop(c.commodity), ecH) * ss * 0.45 * salineShare;
      const loss = 1 - (1 - floodLoss) * (1 - salLoss);
      const peakRisk = Math.round(100 * (1 - (1 - pFlood * fs) * (1 - (salAt / 100) * ss)));
      return {
        districtId: d.id,
        name: d.name,
        country: d.countryName,
        lat: d.lat,
        lon: d.lon,
        floodRisk: d.floodRisk,
        salinityRisk: d.salinityRisk,
        ecCurrent: d.ecCurrent,
        peakRisk,
        level: riskLevelFromScore(peakRisk),
        lossPct: r1(loss * 100),
        areaHa: crop.areaHa,
        standingTonnes: crop.standingTonnes,
        atRiskTonnes: Math.round(crop.standingTonnes * loss),
        sampleFields: crop.sampleFields.length,
        shareSource: crop.shareSource,
        qualityFlag: qualityFlagFor(c.commodity, d),
      };
    });

    const w = (id: string) => (regions.find((r) => r.districtId === id)?.standingTonnes ?? 0) / totalStanding;
    const weightedRisk = sum(regions.map((r) => r.peakRisk * w(r.districtId)));
    const maxRisk = Math.max(0, ...regions.map((r) => r.peakRisk));
    const riskScore = Math.round(0.6 * weightedRisk + 0.4 * maxRisk);
    const atRisk = sum(regions.map((r) => r.atRiskTonnes));
    const sourcingShare = clamp01((c.weeklyVolumeTonnes * SOURCING_WINDOW_WEEKS) / totalStanding);
    const disruption = (atRisk / totalStanding) * 100;
    const flex = PRICE_FLEXIBILITY[c.commodity] ?? 1;
    const share = MARKET_SHARE_OF_DELTAS[c.commodity] ?? 0.3;
    const impact = flex * disruption * share * (0.55 + 0.45 * Math.min(1, h / 14)) + stats.momentum4w * 0.25;
    const band = 1.28 * stats.sd * Math.sqrt(h / 7) * 100;

    // monitored field sample (actual farm field records in affected zones)
    let mFields = 0,
      mArea = 0,
      mRisk = 0,
      mDue = 0;
    for (const { d, crop } of crops) {
      const reg = regions.find((r) => r.districtId === d.id);
      const lossFrac = reg ? reg.lossPct / 100 : 0;
      mFields += crop.sampleFields.length;
      mArea += crop.sampleAreaHa;
      mRisk += crop.sampleAreaHa * (CROP_YIELD_T_HA[c.commodity] ?? 4) * lossFrac;
      mDue += crop.harvestDueDays.filter((x) => x >= 0 && x <= h).length;
    }

    const timeline = Array.from({ length: 30 }, (_, t) => {
      let risk = 0,
        fl = 0,
        sa = 0,
        fcst = false;
      for (const r of regions) {
        const day = byDistrict.get(r.districtId)![t]!;
        const wt = w(r.districtId);
        risk += wt * 100 * (1 - (1 - (day.flood / 100) * fs) * (1 - (day.salinity / 100) * ss));
        fl += wt * day.flood;
        sa += wt * day.salinity;
        fcst = fcst || day.forecast;
      }
      return { day: t + 1, date: byDistrict.get(regions[0]?.districtId ?? s.districts[0]!.id)![t]!.date, risk: Math.round(risk), flood: Math.round(fl), salinity: Math.round(sa), forecast: fcst };
    });

    const drivers: string[] = [];
    const topRegion = [...regions].sort((a, b) => b.atRiskTonnes - a.atRiskTonnes)[0];
    if (topRegion) drivers.push(`${topRegion.name} holds ${Math.round((topRegion.atRiskTonnes / Math.max(1, atRisk)) * 100)}% of at-risk volume`);
    const rainPeak = Math.max(...timeline.slice(0, h).map((x) => x.flood));
    if (rainPeak > 60) drivers.push(`Forecast flood index peaks at ${rainPeak} within ${h}d`);
    const salty = regions.filter((r) => r.qualityFlag?.includes("Salinity")).length;
    if (salty) drivers.push(`${salty} region(s) above crop salinity threshold`);
    if (Math.abs(stats.momentum4w) > 3) drivers.push(`Price momentum ${stats.momentum4w > 0 ? "+" : ""}${r1(stats.momentum4w)}% over 4 weeks`);

    return {
      commodity: c.commodity,
      label: COMMODITY_LABEL[c.commodity] ?? c.commodity,
      unit: c.unit,
      horizonDays: h,
      currentPrice: stats.last,
      basePrice: c.basePriceUsd,
      weeklyVolumeTonnes: c.weeklyVolumeTonnes,
      riskScore,
      riskLevel: riskLevelFromScore(riskScore),
      supplyDisruptionPct: r1(disruption),
      priceImpactPct: r1(impact),
      priceImpactBand: [r1(impact - band), r1(impact + band)],
      atRiskVolumeTonnes: Math.round(atRisk),
      atRiskValueUsd: Math.round(atRisk * stats.last),
      standingVolumeTonnes: Math.round(totalStanding),
      sourcingSharePct: r1(sourcingShare * 100),
      networkAtRiskTonnes: Math.round(atRisk * sourcingShare),
      networkValueAtRiskUsd: Math.round(atRisk * sourcingShare * stats.last),
      monitored: { fields: mFields, areaHa: r1(mArea), atRiskTonnes: r1(mRisk), harvestDueInHorizon: mDue },
      regions: regions.sort((a, b) => b.peakRisk - a.peakRisk),
      timeline,
      drivers,
      volatilityWeeklyPct: r1(stats.sd * 100),
      momentum4wPct: r1(stats.momentum4w),
    };
  });

  return { horizonDays: h, outlookSource: source, commodities: commodities.sort((a, b) => b.riskScore - a.riskScore) };
}

// ─── Historical analogs ────────────────────────────────────────────────────

export function historicalAnalogs(commodity: string) {
  const c = commodityRec(commodity);
  if (!c) return { commodity, analogs: [] as Analog[], basis: "" };
  const ds = producingDistricts(c);
  const fbd = fieldsByDistrict();
  const stats = priceStats(c);
  const flex = PRICE_FLEXIBILITY[commodity] ?? 1;
  const share = MARKET_SHARE_OF_DELTAS[commodity] ?? 0.3;
  const crop = new Map(ds.map((d) => [d.id, districtCrop(d, commodity, fbd)]));
  const totalArea = sum([...crop.values()].map((x) => x.areaHa)) || 1;

  const years = [...new Set(ds.flatMap((d) => d.historicalFloods.map((f) => f.year)))].sort();
  const curVec = ds.map((d) => d.floodRisk / 100);
  const curIntensity = sum(curVec) / Math.max(1, curVec.length);
  const yearAreas = years.map((y) => sum(ds.map((d) => d.historicalFloods.find((f) => f.year === y)?.areaHa ?? 0)));
  const maxArea = Math.max(1, ...yearAreas);

  const analogs: Analog[] = years.map((year, yi) => {
    const evts = ds.map((d) => ({ d, f: d.historicalFloods.find((f) => f.year === year) })).filter((x) => x.f);
    const vec = ds.map((d) => (d.historicalFloods.find((f) => f.year === year)?.areaHa ?? 0) / maxArea);
    const dot = sum(vec.map((v, i) => v * curVec[i]!));
    const cos = dot / (Math.sqrt(sum(vec.map((v) => v * v))) * Math.sqrt(sum(curVec.map((v) => v * v))) || 1);
    const intensity = yearAreas[yi]! / maxArea;
    const similarity = Math.round(100 * cos * (1 - 0.5 * Math.abs(intensity - curIntensity)));
    // share of the commodity's planted area flooded in that event (field crop shares × flooded area)
    const floodedCropHa = sum(evts.map(({ d, f }) => f!.areaHa * ((crop.get(d.id)?.areaHa ?? 0) / Math.max(1, d.monitoredAreaHa))));
    const shortfallPct = (floodedCropHa / totalArea) * 100 * 0.8;
    const modelSpike = flex * shortfallPct * Math.sqrt(share); // local markets are more concentrated than the traded market
    const spike = r1(0.7 * modelSpike + 0.3 * stats.maxRunup3w * intensity);
    const byArea = [...evts].sort((a, b) => b.f!.areaHa - a.f!.areaHa);
    const months = [...new Set(byArea.map((x) => x.f!.month))];
    const peakMonth = months[0] ?? "Jul";
    const weeks = Math.max(2, Math.round(2 + 3 * (1 - intensity) + (["Jul", "Aug"].includes(peakMonth) ? 1 : 0)));
    const top = [...evts].sort((a, b) => b.f!.areaHa - a.f!.areaHa).slice(0, 3);
    return {
      year,
      months,
      districts: top.map((x) => x.d.name),
      floodedAreaHa: Math.round(sum(evts.map((x) => x.f!.areaHa))),
      lossUsd: Math.round(sum(evts.map((x) => x.f!.lossUsd))),
      farmsAffected: Math.round(sum(evts.map((x) => x.f!.farmsAffected))),
      similarityPct: clamp(similarity, 0, 99),
      priceSpikePct: spike,
      weeksToPeak: weeks,
      text: `Similar flood events in ${year} (peak ${peakMonth}; ${top.map((x) => x.d.name).join(", ")}) caused a ${spike}% ${commodity} price spike in ${weeks} weeks`,
    };
  });
  analogs.sort((a, b) => b.similarityPct - a.similarityPct);
  return {
    commodity,
    analogs: analogs.slice(0, 4),
    basis: `Event catalogue: district flood records ${years[0]}–${years[years.length - 1]} across ${ds.length} producing districts; spike = price flexibility ${flex} × crop-area shortfall × delta market share ${share}, calibrated to the largest observed 3-week run-up (${r1(stats.maxRunup3w)}%) in the 26-week price series.`,
  };
}
export interface Analog {
  year: number;
  months: string[];
  districts: string[];
  floodedAreaHa: number;
  lossUsd: number;
  farmsAffected: number;
  similarityPct: number;
  priceSpikePct: number;
  weeksToPeak: number;
  text: string;
}

// ─── Price history + forecast band ────────────────────────────────────────

export async function priceHistoryWithForecast(commodity: string, horizon: 7 | 14 | 30 = 14) {
  const c = commodityRec(commodity);
  if (!c) return null;
  const risks = await computeCommodityRisks(horizon);
  const cr = risks.commodities.find((x) => x.commodity === commodity)!;
  const st = priceStats(c);
  const last = st.last;
  const lastDate = new Date(c.priceHistory[c.priceHistory.length - 1]!.date);
  const weeks = 8;
  const forecast = Array.from({ length: weeks }, (_, i) => {
    const w = i + 1;
    const ramp = 1 - Math.exp(-w / 2.2); // shock passes through over ~3 weeks, then persists
    const median = last * (1 + (cr.priceImpactPct / 100) * ramp);
    const sd = st.sd * Math.sqrt(w);
    return {
      date: new Date(lastDate.getTime() + w * 7 * 86_400_000).toISOString().slice(0, 10),
      median: Math.round(median),
      p10: Math.round(median * Math.exp(-1.28 * sd)),
      p90: Math.round(median * Math.exp(1.28 * sd)),
    };
  });
  return {
    commodity,
    unit: c.unit,
    history: c.priceHistory,
    forecast,
    current: last,
    changeVsBasePct: r1((last / c.basePriceUsd - 1) * 100),
    volatilityWeeklyPct: r1(st.sd * 100),
    priceImpactPct: cr.priceImpactPct,
  };
}

// ─── World Bank production context ────────────────────────────────────────

const WB_COUNTRIES = [
  { iso3: "BGD", code: "BD", name: "Bangladesh" },
  { iso3: "VNM", code: "VN", name: "Vietnam" },
  { iso3: "PHL", code: "PH", name: "Philippines" },
  { iso3: "IND", code: "IN", name: "India" },
  { iso3: "IDN", code: "ID", name: "Indonesia" },
];

interface WbRow {
  countryiso3code: string;
  date: string;
  value: number | null;
}

async function wbIndicator(ind: string) {
  const url = `https://api.worldbank.org/v2/country/BD;VN;PH;IN;ID/indicator/${ind}?format=json&per_page=400&date=2008:2025`;
  const r = await fetchJson<[unknown, WbRow[] | null]>(url, 15000);
  const rows = r[1] ?? [];
  const years = [...new Set(rows.filter((x) => x.value != null).map((x) => Number(x.date)))].sort();
  const series = years.map((y) => {
    const o: Record<string, number | null> & { year: number } = { year: y } as never;
    for (const c of WB_COUNTRIES) o[c.code] = rows.find((x) => x.countryiso3code === c.iso3 && Number(x.date) === y)?.value ?? null;
    return o;
  });
  const latest = WB_COUNTRIES.map((c) => {
    const vals = rows.filter((x) => x.countryiso3code === c.iso3 && x.value != null).sort((a, b) => Number(b.date) - Number(a.date));
    const [a, b] = vals;
    return { code: c.code, name: c.name, year: a ? Number(a.date) : null, value: a?.value ?? null, yoyPct: a && b && b.value ? r1(((a.value! - b.value) / b.value) * 100) : null };
  });
  return { indicator: ind, url, series, latest };
}

export function productionContext() {
  return cached("sc:worldbank", 24 * 3600_000, async () => {
    const [crop, cereal] = await Promise.all([wbIndicator("AG.PRD.CROP.XD"), wbIndicator("AG.YLD.CREL.KG")]);
    return {
      available: true as const,
      countries: WB_COUNTRIES.map(({ code, name }) => ({ code, name })),
      cropIndex: { ...crop, label: "Crop production index (2014-2016 = 100)" },
      cerealYield: { ...cereal, label: "Cereal yield (kg per hectare)" },
      fetchedAt: new Date().toISOString(),
    };
  }).catch((e: Error) => ({ available: false as const, error: e.message, countries: WB_COUNTRIES.map(({ code, name }) => ({ code, name })) }));
}

// ─── Network, overview, node detail ───────────────────────────────────────

export async function getNetwork(orgId: string | null) {
  const s = getStore();
  const events = await hazards();
  const nodes = computeNodeRisks(events, orgId);
  const nById = new Map(nodes.map((n) => [n.id, n]));
  const flows = s.flows.map((f) => {
    const a = nById.get(f.from)!;
    const b = nById.get(f.to)!;
    const corridor = flowCorridor(a, b);
    const price = commodityRec(f.commodity) ? latestPrice(commodityRec(f.commodity)!) : 400;
    return {
      id: f.id,
      from: f.from,
      to: f.to,
      fromName: a.name,
      toName: b.name,
      commodity: f.commodity,
      tonnesPerWeek: f.tonnesPerWeek,
      valueUsdPerWeek: Math.round(f.tonnesPerWeek * price),
      risk: Math.max(a.composite, b.composite),
      ...corridor,
      coords: [
        [a.lat, a.lon],
        [b.lat, b.lon],
      ] as [number, number][],
    };
  });

  // Sankey: producing region → origin node → … → terminal node
  const dIdx = districtIndex();
  const sankeyNodes: { id: string; name: string; kind: string; risk: number }[] = [];
  const sankeyLinks: { source: string; target: string; value: number; commodity: string; risk: number }[] = [];
  const add = (id: string, name: string, kind: string, risk: number) => {
    if (!sankeyNodes.find((x) => x.id === id)) sankeyNodes.push({ id, name, kind, risk });
  };
  for (const n of nodes) {
    const inbound = s.flows.filter((f) => f.to === n.id);
    const outbound = s.flows.filter((f) => f.from === n.id);
    if (!outbound.length && !inbound.length) continue;
    add(n.id, n.name, n.type, n.composite);
    if (!inbound.length) {
      const d = dIdx.get(n.districtId)!;
      const rid = `region:${d.id}`;
      add(rid, `${d.name} farmland`, "region", d.floodRisk);
      for (const o of outbound) sankeyLinks.push({ source: rid, target: n.id, value: o.tonnesPerWeek, commodity: o.commodity, risk: d.floodRisk });
    }
  }
  for (const f of flows) sankeyLinks.push({ source: f.from, target: f.to, value: f.tonnesPerWeek, commodity: f.commodity, risk: f.risk });

  const districts = s.districts.map((d) => ({
    id: d.id,
    name: d.name,
    country: d.countryName,
    lat: d.lat,
    lon: d.lon,
    floodRisk: d.floodRisk,
    salinityRisk: d.salinityRisk,
    level: d.riskLevel,
    geometry: d.geometry,
  }));

  return {
    nodes,
    flows,
    districts,
    hazards: events.slice(0, 40),
    sankey: { nodes: sankeyNodes, links: sankeyLinks },
    weights: WEIGHTS,
    liveSource: s.districts.some((d) => d.liveSource === "open-meteo") ? "open-meteo" : "seed",
    lastUpdated: new Date(Math.max(...s.districts.map((d) => d.lastUpdated.getTime()))).toISOString(),
  };
}

export async function getOverview(orgId: string | null) {
  const s = getStore();
  const [net, risks] = await Promise.all([getNetwork(orgId), computeCommodityRisks(7)]);
  const atRiskNodes = net.nodes.filter((n) => n.composite >= 60);
  // inventory at risk: stock × P(flood) × storage damage share
  const inventoryVaR = sum(net.nodes.map((n) => n.inventoryValueUsd * (n.floodRisk / 100) * 0.12 * (n.composite / 100)));
  const harvestVaR = sum(risks.commodities.map((c) => c.networkValueAtRiskUsd));
  const regionalHarvestVaR = sum(risks.commodities.map((c) => c.atRiskValueUsd));
  const leadImpact = (() => {
    const tot = sum(net.flows.map((f) => f.tonnesPerWeek));
    const days = sum(net.flows.map((f) => f.tonnesPerWeek * (f.risk >= 35 ? ((f.risk - 35) / 65) * (f.transitDays * 0.9 + 4) : 0)));
    return tot ? days / tot : 0;
  })();

  const nodeDistricts = new Set(s.nodes.map((n) => n.districtId));
  const activeAlerts = s.alerts.filter((a) => a.isActive && nodeDistricts.has(a.districtId));
  const hazardNear = net.hazards.filter((e) => net.nodes.some((n) => haversineKm(n, e) < 400));
  const disruptions = [
    ...net.nodes.filter((n) => n.composite >= 70).map((n) => ({ id: `node-${n.id}`, kind: "node" as const, title: `${n.name} — composite risk ${n.composite}`, detail: [...n.factors].sort((a, b) => b.contribution - a.contribution)[0]!.detail, severity: n.level, source: "Agri-SHIELD network", at: new Date().toISOString(), lat: n.lat, lon: n.lon })),
    ...activeAlerts.map((a) => ({ id: a.id, kind: "alert" as const, title: a.title, detail: a.description.slice(0, 160), severity: a.severity, source: a.source === "model" ? "Agri-SHIELD model" : a.source.toUpperCase(), at: a.createdAt.toISOString(), lat: s.districts.find((d) => d.id === a.districtId)?.lat ?? 0, lon: s.districts.find((d) => d.id === a.districtId)?.lon ?? 0 })),
    ...hazardNear.map((e) => ({ id: e.id, kind: "hazard" as const, title: e.title, detail: `${e.type}${e.country ? ` · ${e.country}` : ""}${e.alertLevel ? ` · ${e.alertLevel.toUpperCase()} alert` : ""}`, severity: e.alertLevel === "red" ? "emergency" : e.alertLevel === "orange" ? "warning" : "watch", source: e.source, at: e.date, lat: e.lat, lon: e.lon, url: e.url })),
  ];

  return {
    kpis: {
      nodesAtRisk: atRiskNodes.length,
      nodesTotal: net.nodes.length,
      valueAtRiskUsd: Math.round(harvestVaR + inventoryVaR),
      harvestValueAtRiskUsd: Math.round(harvestVaR),
      inventoryValueAtRiskUsd: Math.round(inventoryVaR),
      atRiskVolumeTonnes: sum(risks.commodities.map((c) => c.networkAtRiskTonnes)),
      regionalAtRiskVolumeTonnes: sum(risks.commodities.map((c) => c.atRiskVolumeTonnes)),
      regionalHarvestValueAtRiskUsd: Math.round(regionalHarvestVaR),
      monitoredFieldsAtRiskTonnes: r1(sum(risks.commodities.map((c) => c.monitored.atRiskTonnes))),
      avgLeadTimeImpactDays: r1(leadImpact),
      activeDisruptions: disruptions.length,
      weeklyThroughputTonnes: sum(net.flows.map((f) => f.tonnesPerWeek)),
      weeklyThroughputUsd: sum(net.flows.map((f) => f.valueUsdPerWeek)),
    },
    topNodes: [...net.nodes].sort((a, b) => b.composite - a.composite).slice(0, 6),
    commodityTop: risks.commodities.slice(0, 4).map((c) => ({ commodity: c.commodity, label: c.label, riskScore: c.riskScore, riskLevel: c.riskLevel, priceImpactPct: c.priceImpactPct, supplyDisruptionPct: c.supplyDisruptionPct })),
    disruptions: disruptions.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 25),
    liveSource: net.liveSource,
    outlookSource: risks.outlookSource,
    lastUpdated: net.lastUpdated,
    scenarioMode: s.scenario.mode,
  };
}

export async function getNodeDetail(id: string, orgId: string | null) {
  const s = getStore();
  const events = await hazards();
  const all = computeNodeRisks(events, orgId);
  const node = all.find((n) => n.id === id);
  if (!node) return null;
  const nById = new Map(all.map((n) => [n.id, n]));
  const pt = { lat: node.lat, lon: node.lon };
  const [fc, fl] = await Promise.allSettled([withTimeout(getForecast([pt], 7), 9000, null), withTimeout(getRiverDischarge([pt], 7), 9000, null)]);
  const f = fc.status === "fulfilled" ? fc.value?.[0] ?? null : null;
  const q = fl.status === "fulfilled" ? fl.value?.[0] ?? null : null;
  const today = new Date().toISOString().slice(0, 10);

  const rain = f
    ? f.daily.time.map((t, i) => ({ date: t, rainMm: r1(f.daily.precipitation_sum[i] ?? 0), probability: f.daily.precipitation_probability_max[i] ?? null, tmax: f.daily.temperature_2m_max[i] ?? null })).filter((x) => x.date >= today)
    : [];
  let discharge: { date: string; discharge: number | null; mean: number | null; max: number | null; forecast: boolean }[] = [];
  let dischargeStats: { current: number | null; mean30d: number | null; peak7d: number | null; ratio: number | null } = { current: null, mean30d: null, peak7d: null, ratio: null };
  if (q) {
    discharge = q.daily.time.map((t, i) => ({ date: t, discharge: q.daily.river_discharge[i] ?? null, mean: q.daily.river_discharge_mean[i] ?? null, max: q.daily.river_discharge_max[i] ?? null, forecast: t >= today }));
    const past = discharge.filter((x) => !x.forecast && x.discharge != null).map((x) => x.discharge!);
    const fut = discharge.filter((x) => x.forecast && x.discharge != null).map((x) => x.discharge!);
    const mean = past.length ? sum(past) / past.length : null;
    const peak = fut.length ? Math.max(...fut) : null;
    dischargeStats = { current: fut[0] ?? past[past.length - 1] ?? null, mean30d: mean == null ? null : r1(mean), peak7d: peak == null ? null : r1(peak), ratio: mean && peak ? r2(peak / mean) : null };
  }

  const link = (fid: string, other: string, commodity: string, t: number, dir: "in" | "out") => {
    const o = nById.get(other)!;
    return { flowId: fid, nodeId: o.id, name: o.name, type: o.type, commodity, tonnesPerWeek: t, composite: o.composite, level: o.level, direction: dir, ...flowCorridor(node, o) };
  };
  const upstream = s.flows.filter((x) => x.to === id).map((x) => link(x.id, x.from, x.commodity, x.tonnesPerWeek, "in"));
  const downstream = s.flows.filter((x) => x.from === id).map((x) => link(x.id, x.to, x.commodity, x.tonnesPerWeek, "out"));
  const totalNet = sum(s.flows.map((x) => x.tonnesPerWeek));
  const through = Math.max(node.weeklyInTonnes, node.weeklyOutTonnes);
  const price = nodePriceUsd(s.nodes.find((n) => n.id === id)!);

  return {
    node,
    weather: f
      ? { current: f.current ?? null, rain, rain72hMm: r1(sum(rain.slice(0, 3).map((x) => x.rainMm))), rain7dMm: r1(sum(rain.map((x) => x.rainMm))), elevationM: f.elevation }
      : null,
    discharge,
    dischargeStats,
    upstream,
    downstream,
    buyers: DOWNSTREAM_BUYERS[id] ?? [],
    exposure: {
      inventoryTonnes: node.inventoryTonnes,
      inventoryValueUsd: node.inventoryValueUsd,
      weeklyThroughputTonnes: through,
      weeklyThroughputUsd: Math.round(through * price),
      networkSharePct: totalNet ? r1((through / totalNet) * 100) : 0,
      dependents: downstream.length + (DOWNSTREAM_BUYERS[id]?.length ?? 0),
      expectedDelayDays: r1(node.composite >= 35 ? ((node.composite - 35) / 65) * 7 : 0),
    },
    sources: { forecast: !!f, glofas: !!q },
  };
}

// ─── Alternative suppliers ────────────────────────────────────────────────

export async function alternativeSuppliers(commodity: string, excludeDistrictIds: string[], orgId: string | null) {
  const c = commodityRec(commodity);
  if (!c) return null;
  const risks = await computeCommodityRisks(14);
  const cr = risks.commodities.find((x) => x.commodity === commodity)!;
  const regionRisk = new Map(cr.regions.map((r) => [r.districtId, r]));
  const s = getStore();
  const dIdx = districtIndex();

  let affectedIds = excludeDistrictIds.filter((id) => dIdx.has(id));
  if (!affectedIds.length) {
    // default: high-risk regions in the basin (country) of the single most exposed region
    const top = cr.regions[0];
    affectedIds = cr.regions.filter((r) => r.peakRisk >= 60 && r.country === top?.country).map((r) => r.districtId);
  }
  if (!affectedIds.length) affectedIds = cr.regions.slice(0, 1).map((r) => r.districtId);
  const affected = affectedIds.map((id) => dIdx.get(id)!);
  const centroid = { lat: sum(affected.map((d) => d.lat)) / affected.length, lon: sum(affected.map((d) => d.lon)) / affected.length };

  // Hubs that normally take this commodity (nodes handling it outside the affected districts)
  const hubs = s.nodes.filter((n) => n.primaryCommodities.includes(commodity) && !affectedIds.includes(n.districtId) && (n.type === "processor" || n.type === "port" || n.type === "warehouse"));
  const affectedCountry = affected[0]?.countryName ?? "";
  const destination =
    [...hubs].sort(
      (a, b) =>
        (a.country === affectedCountry ? 0 : 1) - (b.country === affectedCountry ? 0 : 1) ||
        (!orgId || a.orgId === orgId ? 0 : 1) - (!orgId || b.orgId === orgId ? 0 : 1) ||
        haversineKm(a, centroid) - haversineKm(b, centroid)
    ).filter((n) => n.country === affectedCountry)[0] ??
    // every hub in the affected market is itself flooded: deliver to its port / wholesale market instead
    s.nodes
      .filter((n) => n.country === affectedCountry && n.primaryCommodities.includes(commodity))
      .sort((a, b) => (["port", "retailer"].includes(a.type) ? 0 : 1) - (["port", "retailer"].includes(b.type) ? 0 : 1) || a.floodRisk - b.floodRisk)[0] ??
    hubs[0] ??
    s.nodes.find((n) => n.primaryCommodities.includes(commodity)) ??
    s.nodes[0]!;
  const destCountry = destination.country;

  const lostWeekly = sum(cr.regions.filter((r) => affectedIds.includes(r.districtId)).map((r) => r.atRiskTonnes)) / 8;

  const candidates = producingDistricts(c).filter((d) => !affectedIds.includes(d.id));
  const alternatives = candidates
    .map((d) => {
      const rr = regionRisk.get(d.id);
      const risk = rr?.peakRisk ?? d.floodRisk;
      const gc = haversineKm(d, destination);
      const mode = pickMode(d.countryName, destCountry, gc);
      const spec = MODE_SPEC[mode];
      const km = Math.round(gc * DETOUR[mode]);
      const leadTimeDays = r1(2 + km / spec.kmPerDay + spec.handlingDays + (mode === "short_sea" ? 3 : 0)); // +2 procurement, +3 customs/phyto
      const freight = r1(km * spec.usdPerTkm + spec.fixedUsdPerT);
      const standing = rr?.standingTonnes ?? 0;
      const lossPct = rr?.lossPct ?? 0;
      const weeklySurplus = Math.round((standing * (1 - lossPct / 100) * 0.3) / 8); // 30% marketable surplus over an 8-week window
      const quality = qualityFlagFor(commodity, d);
      const premiumPct = r1(2 + (mode === "short_sea" ? 5 : 0) + (risk / 100) * 4);
      const status = risk >= 60 ? "constrained" : risk >= 35 ? "watch" : "available";
      const score = leadTimeDays * 2 + risk * 0.25 + (quality ? 6 : 0) - Math.min(8, (weeklySurplus / Math.max(1, lostWeekly)) * 8);
      return {
        districtId: d.id,
        name: d.name,
        country: d.countryName,
        lat: d.lat,
        lon: d.lon,
        risk,
        level: riskLevelFromScore(risk),
        status,
        distanceKm: km,
        greatCircleKm: Math.round(gc),
        mode,
        modeLabel: spec.label,
        leadTimeDays,
        freightUsdPerT: freight,
        pricePremiumPct: premiumPct,
        landedCostUsdPerT: Math.round(latestPrice(c) * (1 + premiumPct / 100) + freight),
        weeklyCapacityTonnes: weeklySurplus,
        coverPct: lostWeekly > 0 ? Math.min(100, Math.round((weeklySurplus / lostWeekly) * 100)) : 100,
        qualityFlag: quality,
        salinityEc: d.ecCurrent,
        score: r1(score),
      };
    })
    .sort((a, b) => (a.status === "constrained" ? 1 : 0) - (b.status === "constrained" ? 1 : 0) || a.score - b.score);

  return {
    commodity,
    label: COMMODITY_LABEL[commodity] ?? commodity,
    price: latestPrice(c),
    affected: affected.map((d) => ({ id: d.id, name: d.name, country: d.countryName, lat: d.lat, lon: d.lon, risk: regionRisk.get(d.id)?.peakRisk ?? d.floodRisk, atRiskTonnes: regionRisk.get(d.id)?.atRiskTonnes ?? 0 })),
    lostWeeklyTonnes: Math.round(lostWeekly),
    destination: { id: destination.id, name: destination.name, type: destination.type, lat: destination.lat, lon: destination.lon, country: destination.country, owned: !orgId || destination.orgId === orgId },
    nodes: s.nodes.filter((n) => n.primaryCommodities.includes(commodity)).map((n) => ({ id: n.id, name: n.name, type: n.type, lat: n.lat, lon: n.lon, owned: !orgId || n.orgId === orgId, floodRisk: n.floodRisk })),
    alternatives,
    producingRegions: cr.regions.map((r) => ({ id: r.districtId, name: r.name, lat: r.lat, lon: r.lon, risk: r.peakRisk })),
  };
}

// ─── Scenario modelling ───────────────────────────────────────────────────

export interface ScenarioInput {
  commodity: string;
  regionIds: string[];
  intensity: number;
  durationDays: number;
  simulations: number;
  label?: string;
}

export interface CascadeNode {
  id: string;
  name: string;
  stage: "producer" | "warehouse" | "processor" | "port" | "retailer" | "buyer";
  impactPct: number;
  tonnesAtRisk: number;
  country: string;
  detail: string;
}
export interface CascadeLink {
  source: string;
  target: string;
  tonnes: number;
  impactPct: number;
  corridor: string;
}
export interface Mitigation {
  id: "reroute" | "forward" | "safety_stock" | "parametric";
  title: string;
  description: string;
  costUsd: number;
  lossAvoidedUsd: number;
  riskReductionPct: number;
  p90ReductionPct: number;
  roi: number;
  leadTimeDays: number;
  recommended: boolean;
}

export interface ScenarioRun {
  id: string;
  orgId: string;
  label: string;
  createdAt: string;
  createdBy: string;
  input: ScenarioInput;
  engine: "ml-api" | "ts-monte-carlo";
  result: ScenarioResult & {
    mean_loss_usd: number;
    p90_loss_usd: number;
    p95_loss_usd: number;
    price_ci: [number, number];
    recovery_ci: [number, number];
    region_loss: MCOutput["region_loss"];
    components: MCOutput["components"];
    mean_depth_m: number;
    baseline_volume_tonnes: number;
    price_exposure_usd: number;
    sourcing_share_pct: number;
    network_volume_loss_tonnes: number;
  };
  regions: { id: string; name: string; country: string; floodRisk: number; standingTonnes: number }[];
  cascade: { nodes: CascadeNode[]; links: CascadeLink[] };
  mitigations: Mitigation[];
  recovery: { day: number; p50: number; p90: number }[];
  narrative: string;
}

function hashSeed(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function runScenario(input: ScenarioInput, user: { id: string; name?: string | null; orgId: string | null }): Promise<ScenarioRun> {
  const s = getStore();
  const c = commodityRec(input.commodity);
  if (!c) throw new Error(`Unknown commodity ${input.commodity}`);
  const dIdx = districtIndex();
  const regions = input.regionIds.map((id) => dIdx.get(id)).filter((d): d is DistrictRecord => !!d);
  if (!regions.length) throw new Error("Select at least one region");
  const fbd = fieldsByDistrict();
  const price = latestPrice(c);
  const flex = PRICE_FLEXIBILITY[c.commodity] ?? 1;
  const share = MARKET_SHARE_OF_DELTAS[c.commodity] ?? 0.3;
  const allProducing = producingDistricts(c);
  const marketSupply = sum(allProducing.map((d) => districtCrop(d, c.commodity, fbd).standingTonnes)) / share;

  const mcRegions = regions.map((d) => ({ id: d.id, floodRisk: d.floodRisk, floodExposure: d.floodExposure, salinityRisk: d.salinityRisk, standingTonnes: districtCrop(d, c.commodity, fbd).standingTonnes }));
  const baseline = sum(mcRegions.map((r) => r.standingTonnes));
  const regionIds = new Set(regions.map((d) => d.id));
  const mcNodes = s.nodes
    .filter((n) => regionIds.has(n.districtId) && n.primaryCommodities.includes(c.commodity))
    .map((n) => {
      const through = Math.max(sum(s.flows.filter((f) => f.from === n.id).map((f) => f.tonnesPerWeek)), sum(s.flows.filter((f) => f.to === n.id).map((f) => f.tonnesPerWeek)));
      return { id: n.id, districtId: n.districtId, flood_risk: n.floodRisk, capacity_tonnes: n.capacityTonnes, weekly_tonnes: through, inventory_tonnes: Math.round((n.capacityTonnes * n.utilizationPct) / 100 / Math.max(1, n.primaryCommodities.length)) };
    });

  // share of the regional crop that flows through the network over a harvest window
  const intake = sum(
    s.nodes
      .filter((n) => regionIds.has(n.districtId))
      .map((n) => {
        const inbound = s.flows.filter((f) => f.to === n.id && f.commodity === c.commodity);
        if (inbound.some((f) => regionIds.has(nodeIndex().get(f.from)?.districtId ?? ""))) return 0; // counted at origin
        return sum(s.flows.filter((f) => f.from === n.id && f.commodity === c.commodity).map((f) => f.tonnesPerWeek));
      })
  );
  const allStanding = sum(allProducing.map((d) => districtCrop(d, c.commodity, fbd).standingTonnes)) || 1;
  const regionalShare = baseline / allStanding;
  const sourcingShare = clamp01((Math.max(intake, c.weeklyVolumeTonnes * regionalShare) * SOURCING_WINDOW_WEEKS) / Math.max(1, baseline));

  const seed = hashSeed(JSON.stringify([input.commodity, [...input.regionIds].sort(), input.intensity, input.durationDays, input.simulations]));
  const local = runMonteCarlo({
    commodity: c.commodity,
    floodSensitivity: c.floodSensitivity,
    priceUsd: price,
    flexibility: flex,
    marketSupplyTonnes: marketSupply,
    sourcingShare,
    regions: mcRegions,
    nodes: mcNodes,
    intensity: input.intensity,
    durationDays: input.durationDays,
    simulations: input.simulations,
    delayUsdPerTWeek: DELAY_USD_PER_T_WEEK,
    seed,
  });

  const remote = await runScenarioRemote({
    commodity: c.commodity,
    region_ids: input.regionIds,
    intensity: input.intensity,
    duration_days: input.durationDays,
    simulations: input.simulations,
    baseline_volume_tonnes: baseline,
    base_price_usd: price,
    nodes: mcNodes.map((n) => ({ id: n.id, flood_risk: n.flood_risk, capacity_tonnes: n.capacity_tonnes })),
  });
  const engine: ScenarioRun["engine"] = remote ? "ml-api" : "ts-monte-carlo";
  const core: Omit<ScenarioResult, "source"> = remote ?? local;

  // weekly procurement through the affected corridor, exposed to the price move
  const weeklyPurchase = sum(mcNodes.map((n) => n.weekly_tonnes)) || c.weeklyVolumeTonnes * 0.1;
  const disruptionWeeks = Math.max(1, core.recovery_days / 7);
  const priceExposure = Math.round(weeklyPurchase * disruptionWeeks * price * (core.price_impact_pct / 100));

  const result: ScenarioRun["result"] = {
    ...core,
    source: remote ? "ml-api" : "web-fallback",
    mean_loss_usd: remote ? core.estimated_loss_usd : local.mean_loss_usd,
    p90_loss_usd: remote ? Math.round(core.estimated_loss_usd + (core.loss_usd_ci[1] - core.estimated_loss_usd) * 0.78) : local.p90_loss_usd,
    p95_loss_usd: remote ? core.loss_usd_ci[1] : local.p95_loss_usd,
    price_ci: local.price_ci,
    recovery_ci: local.recovery_ci,
    region_loss: local.region_loss,
    components: local.components,
    mean_depth_m: local.mean_depth_m,
    baseline_volume_tonnes: baseline,
    price_exposure_usd: priceExposure,
    sourcing_share_pct: r1(sourcingShare * 100),
    network_volume_loss_tonnes: remote ? Math.round(core.volume_loss_tonnes * sourcingShare) : local.network_volume_loss_tonnes,
  };

  const cascade = buildCascade(c.commodity, regions, mcRegions, result);
  const alt = await alternativeSuppliers(c.commodity, input.regionIds, user.orgId).catch(() => null);
  const mitigations = buildMitigations(result, weeklyPurchase, price, alt);
  const recovery = recoveryCurve(result, input.durationDays);

  const regionNames = regions.map((d) => d.name).join(", ");
  const cat = Math.round(input.intensity);
  const run: ScenarioRun = {
    id: nextId("scn"),
    orgId: user.orgId ?? "platform",
    label: input.label?.trim() || `${COMMODITY_LABEL[c.commodity] ?? c.commodity} · ${regionNames} · Cat ${cat} · ${input.durationDays}d`,
    createdAt: new Date().toISOString(),
    createdBy: user.name ?? user.id,
    input,
    engine,
    result,
    regions: regions.map((d) => ({ id: d.id, name: d.name, country: d.countryName, floodRisk: d.floodRisk, standingTonnes: mcRegions.find((r) => r.id === d.id)!.standingTonnes })),
    cascade,
    mitigations,
    recovery,
    narrative:
      `If a Category ${cat} flood hits ${regionNames} for ${input.durationDays} days, ${Math.round(result.disruption_probability * 100)}% of ${input.simulations.toLocaleString()} simulations disrupt >5% of standing ${c.commodity}. ` +
      `Median network loss ${fmtUsd(result.estimated_loss_usd)} (90% CI ${fmtUsd(result.loss_usd_ci[0])}–${fmtUsd(result.loss_usd_ci[1])}); ${result.volume_loss_tonnes.toLocaleString()} t of regional crop lost, ${result.network_volume_loss_tonnes.toLocaleString()} t of it in your sourcing footprint; ` +
      `price +${result.price_impact_pct}% and ~${result.recovery_days} days to recover. ${cascade.nodes.filter((n) => n.stage !== "producer" && n.impactPct >= 20).length} downstream nodes/buyers see ≥20% impact.`,
  };
  saveScenario(run);
  audit({ userId: user.id, userName: user.name ?? user.id, action: "scenario.run", entity: "supply_chain_scenario", entityId: run.id, details: run.label });
  return run;
}

function fmtUsd(v: number) {
  if (Math.abs(v) >= 1e9) return `$${r1(v / 1e9)}B`;
  if (Math.abs(v) >= 1e6) return `$${r1(v / 1e6)}M`;
  if (Math.abs(v) >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

function buildCascade(commodity: string, regions: DistrictRecord[], mcRegions: { id: string; standingTonnes: number }[], result: ScenarioRun["result"]) {
  const s = getStore();
  const nIdx = nodeIndex();
  const direct = new Map(result.affected_nodes.map((a) => [a.id, a.impact_pct]));
  const regionLoss = new Map(result.region_loss.map((r) => [r.id, r.loss_pct]));
  const flows = s.flows.filter((f) => f.commodity === commodity).length ? s.flows.filter((f) => f.commodity === commodity) : s.flows;
  const nodes = new Map<string, CascadeNode>();
  const links: CascadeLink[] = [];
  const impact = new Map<string, number>();

  // producers → nodes in the same district (or nearest same-country node handling the commodity)
  for (const d of regions) {
    const loss = regionLoss.get(d.id) ?? 0;
    const standing = mcRegions.find((r) => r.id === d.id)?.standingTonnes ?? 0;
    nodes.set(`region:${d.id}`, { id: `region:${d.id}`, name: `${d.name} producers`, stage: "producer", impactPct: r1(loss), tonnesAtRisk: Math.round((standing * loss) / 100), country: d.countryName, detail: `${standing.toLocaleString()} t standing ${commodity}; hit probability ${Math.round((result.region_loss.find((r) => r.id === d.id)?.hit_probability ?? 0) * 100)}%` });
    let targets = s.nodes.filter((n) => n.districtId === d.id && n.primaryCommodities.includes(commodity));
    if (!targets.length) targets = s.nodes.filter((n) => n.country === d.countryName && n.primaryCommodities.includes(commodity) && n.type !== "port").sort((a, b) => haversineKm(a, d) - haversineKm(b, d)).slice(0, 1);
    for (const t of targets) {
      const out = sum(flows.filter((f) => f.from === t.id).map((f) => f.tonnesPerWeek)) || sum(flows.filter((f) => f.to === t.id).map((f) => f.tonnesPerWeek)) || 500;
      const corridor = flowCorridor({ lat: d.lat, lon: d.lon, country: d.countryName }, t);
      links.push({ source: `region:${d.id}`, target: t.id, tonnes: out, impactPct: r1(loss), corridor: `${corridor.modeLabel} · ${corridor.km} km` });
      impact.set(t.id, Math.max(impact.get(t.id) ?? 0, direct.get(t.id) ?? loss * 0.8));
    }
  }
  for (const [id, v] of direct) impact.set(id, Math.max(impact.get(id) ?? 0, v));

  // propagate downstream along flows (share of inbound volume from impacted suppliers)
  for (let iter = 0; iter < 6; iter++) {
    for (const n of s.nodes) {
      const inflows = flows.filter((f) => f.to === n.id);
      const totalIn = sum(inflows.map((f) => f.tonnesPerWeek));
      if (!totalIn) continue;
      const propagated = sum(inflows.map((f) => (impact.get(f.from) ?? 0) * f.tonnesPerWeek)) / totalIn;
      if (propagated > (impact.get(n.id) ?? 0)) impact.set(n.id, propagated);
    }
  }

  const involved = new Set<string>();
  for (const [id, v] of impact) if (v >= 1) involved.add(id);
  for (const f of flows) {
    if (!involved.has(f.from)) continue;
    involved.add(f.to);
    const a = nIdx.get(f.from)!;
    const b = nIdx.get(f.to)!;
    const corridor = flowCorridor(a, b);
    links.push({ source: f.from, target: f.to, tonnes: f.tonnesPerWeek, impactPct: r1(impact.get(f.from) ?? 0), corridor: `${corridor.modeLabel} · ${corridor.km} km · ${corridor.transitDays} d` });
  }
  for (const id of involved) {
    const n = nIdx.get(id)!;
    const v = impact.get(id) ?? 0;
    const through = Math.max(sum(flows.filter((f) => f.from === id).map((f) => f.tonnesPerWeek)), sum(flows.filter((f) => f.to === id).map((f) => f.tonnesPerWeek)));
    nodes.set(id, { id, name: n.name, stage: n.type, impactPct: r1(v), tonnesAtRisk: Math.round((through * v) / 100), country: n.country, detail: `${NODE_TYPE_LABEL[n.type]} · ${through.toLocaleString()} t/wk · ${direct.has(id) ? "directly inundated" : "knock-on supply gap"}` });
    // terminal nodes → downstream buyers
    const hasOut = flows.some((f) => f.from === id);
    const buyers = (DOWNSTREAM_BUYERS[id] ?? []).filter((b) => !b.commodities || b.commodities.includes(commodity));
    const shareSum = sum(buyers.map((b) => b.share)) || 1;
    if (!hasOut && buyers.length) {
      for (const b of buyers) {
        const bid = `buyer:${id}:${b.name}`;
        const t = Math.round((through * b.share) / shareSum);
        nodes.set(bid, { id: bid, name: b.name, stage: "buyer", impactPct: r1(v), tonnesAtRisk: Math.round((t * v) / 100), country: n.country, detail: `${b.segment} · ${t.toLocaleString()} t/wk offtake` });
        links.push({ source: id, target: bid, tonnes: t, impactPct: r1(v), corridor: b.segment });
      }
    }
  }
  // de-duplicate links
  const seen = new Set<string>();
  const uniq = links.filter((l) => {
    const k = `${l.source}>${l.target}`;
    if (seen.has(k) || !nodes.has(l.source) || !nodes.has(l.target)) return false;
    seen.add(k);
    return true;
  });
  return { nodes: [...nodes.values()], links: uniq };
}

function buildMitigations(res: ScenarioRun["result"], weeklyPurchase: number, price: number, alt: Awaited<ReturnType<typeof alternativeSuppliers>> | null): Mitigation[] {
  const E = res.mean_loss_usd + res.price_exposure_usd;
  const P90 = res.p90_loss_usd + res.price_exposure_usd;
  const weeks = Math.max(1, res.recovery_days / 7);
  const out: Mitigation[] = [];

  const best = alt?.alternatives.find((a) => a.status !== "constrained");
  if (best) {
    const lostWeekly = res.network_volume_loss_tonnes / weeks;
    const cover = Math.min(1, best.weeklyCapacityTonnes / Math.max(1, lostWeekly));
    const tonnes = Math.min(res.network_volume_loss_tonnes, best.weeklyCapacityTonnes * weeks);
    const cost = tonnes * (best.freightUsdPerT + price * (best.pricePremiumPct / 100));
    const avoided = (res.components.crop_usd + res.components.logistics_usd * 0.5) * cover * (1 - best.risk / 100) * 0.85;
    out.push({ id: "reroute", title: `Reroute to ${best.name}, ${best.country}`, description: `${best.modeLabel}, ${best.distanceKm} km to ${alt!.destination.name}; lead time ${best.leadTimeDays} d; covers ~${Math.round(cover * 100)}% of the weekly gap${best.qualityFlag ? ` (quality flag: ${best.qualityFlag})` : ""}.`, costUsd: Math.round(cost), lossAvoidedUsd: Math.round(avoided), riskReductionPct: 0, p90ReductionPct: r1((avoided * 1.1 / Math.max(1, P90)) * 100), roi: 0, leadTimeDays: best.leadTimeDays, recommended: false });
  }

  const hedgeRatio = 0.6;
  const notional = weeklyPurchase * weeks * price * hedgeRatio;
  out.push({ id: "forward", title: "Pre-purchase forward contracts (60% hedge)", description: `Lock ${Math.round(weeklyPurchase * weeks * hedgeRatio).toLocaleString()} t at today's ${Math.round(price)} USD/t for the ${Math.round(weeks)}-week disruption window; premium ${(FORWARD_PREMIUM_PCT * 100).toFixed(1)}% of notional.`, costUsd: Math.round(notional * FORWARD_PREMIUM_PCT), lossAvoidedUsd: Math.round(res.price_exposure_usd * hedgeRatio), riskReductionPct: 0, p90ReductionPct: r1(((res.price_exposure_usd * hedgeRatio * 1.3) / Math.max(1, P90)) * 100), roi: 0, leadTimeDays: 2, recommended: false });

  const bufferWeeks = 2;
  const bufferT = weeklyPurchase * bufferWeeks;
  const cover = Math.min(1, bufferWeeks / weeks);
  out.push({ id: "safety_stock", title: `Build ${bufferWeeks}-week safety stock upstream-safe`, description: `Position ${Math.round(bufferT).toLocaleString()} t in an unaffected warehouse before landfall; holding ${HOLDING_USD_PER_T_WEEK} USD/t/wk + capital cost.`, costUsd: Math.round(bufferT * HOLDING_USD_PER_T_WEEK * (weeks + bufferWeeks) + bufferT * price * 0.08 * ((weeks + bufferWeeks) / 52)), lossAvoidedUsd: Math.round(res.components.logistics_usd * cover + res.components.crop_usd * 0.15 * cover), riskReductionPct: 0, p90ReductionPct: r1(((res.components.logistics_usd * cover) / Math.max(1, P90)) * 100), roi: 0, leadTimeDays: 3, recommended: false });

  // Parametric cover: pays 70% of loss between P50 and P95 on a GloFAS discharge / depth trigger
  const layer = Math.max(0, res.p95_loss_usd - res.estimated_loss_usd);
  const expectedPayout = layer * 0.7 * 0.3; // tail layer is hit ~30% of the time on average
  out.push({ id: "parametric", title: "Parametric flood insurance (GloFAS trigger)", description: `Index cover paying 70% of losses from ${fmtUsd(res.estimated_loss_usd)} (P50) to ${fmtUsd(res.p95_loss_usd)} (P95) when forecast discharge exceeds the 1-in-5-year threshold; settles in ~10 days, basis risk ~15%.`, costUsd: Math.round(expectedPayout * PARAMETRIC_LOADING), lossAvoidedUsd: Math.round(expectedPayout * 0.85), riskReductionPct: 0, p90ReductionPct: r1(((Math.max(0, res.p90_loss_usd - res.estimated_loss_usd) * 0.7 * 0.85) / Math.max(1, P90)) * 100), roi: 0, leadTimeDays: 7, recommended: false });

  for (const m of out) {
    m.riskReductionPct = r1(Math.min(95, (m.lossAvoidedUsd / Math.max(1, E)) * 100));
    m.p90ReductionPct = Math.min(95, m.p90ReductionPct);
    m.roi = m.costUsd > 0 ? r2((m.lossAvoidedUsd - m.costUsd) / m.costUsd) : 0;
  }
  const ranked = [...out].sort((a, b) => b.roi - a.roi);
  ranked.slice(0, 2).forEach((m) => (m.recommended = m.roi > 0));
  return out;
}

function recoveryCurve(res: ScenarioRun["result"], duration: number) {
  const trough = Math.min(95, (res.volume_loss_tonnes / Math.max(1, res.baseline_volume_tonnes)) * 100 * 0.6 + Math.max(0, ...res.affected_nodes.map((a) => a.impact_pct)) * 0.4);
  const troughP90 = Math.min(98, trough * (res.p90_loss_usd / Math.max(1, res.estimated_loss_usd)));
  const T = Math.max(res.recovery_days, duration + 2);
  const T90 = Math.max(res.recovery_ci[1], T + 3);
  const horizon = Math.ceil(T90 * 1.15);
  const curve = (t: number, tr: number, total: number) => {
    if (t <= 1) return 100 - tr * t;
    if (t <= duration) return 100 - tr;
    const x = (t - duration) / Math.max(1, total - duration);
    return 100 - tr * Math.max(0, 1 - 1 / (1 + Math.exp(-10 * (x - 0.5))));
  };
  return Array.from({ length: horizon + 1 }, (_, t) => ({ day: t, p50: r1(curve(t, trough, T)), p90: r1(curve(t, troughP90, T90)) }));
}

export function listScenarios(orgId: string | null) {
  const key = orgId ?? "platform";
  return scState()
    .scenarios.filter((r) => r.orgId === key)
    .map((r) => ({ id: r.id, label: r.label, createdAt: r.createdAt, engine: r.engine, commodity: r.input.commodity, intensity: r.input.intensity, durationDays: r.input.durationDays, p50: r.result.estimated_loss_usd, p90: r.result.p90_loss_usd, priceImpact: r.result.price_impact_pct }));
}
export function getScenario(id: string, orgId: string | null) {
  return scState().scenarios.find((r) => r.id === id && r.orgId === (orgId ?? "platform")) ?? null;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────

export function signPayload(secret: string, rawBody: string) {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|\[::1\]|172\.(1[6-9]|2\d|3[01])\.)/i;
export function assertSafeWebhookUrl(raw: string) {
  const u = new URL(raw);
  if (!["https:", "http:"].includes(u.protocol)) throw new Error("Webhook URL must be http(s)");
  if (PRIVATE_HOST.test(u.hostname) && process.env.NODE_ENV === "production") throw new Error("Private/loopback hosts are not allowed");
  return u.toString();
}

export async function deliverWebhook(wh: WebhookRecord, event: string, data: Record<string, unknown>, trigger: WebhookDelivery["trigger"]): Promise<WebhookDelivery> {
  const deliveryId = `dlv_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = { id: deliveryId, event, created: timestamp, test: trigger === "test", org_id: wh.orgId, webhook_id: wh.id, data };
  const raw = JSON.stringify(payload);
  const signature = signPayload(wh.secret, raw);
  const started = Date.now();
  let status: number | null = null;
  let snippet: string | null = null;
  let error: string | null = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(assertSafeWebhookUrl(wh.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Agri-SHIELD-Webhooks/1.0",
        "X-AgriShield-Event": event,
        "X-AgriShield-Signature": signature,
        "X-AgriShield-Delivery": deliveryId,
        "X-AgriShield-Timestamp": String(timestamp),
      },
      body: raw,
      signal: ctrl.signal,
      cache: "no-store",
    });
    status = res.status;
    snippet = (await res.text()).slice(0, 4000);
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    error = err.name === "AbortError" ? "Timed out after 10 s" : err.cause?.code ? `${err.message} (${err.cause.code})` : err.message;
  } finally {
    clearTimeout(timer);
  }
  const d: WebhookDelivery = {
    id: deliveryId,
    webhookId: wh.id,
    orgId: wh.orgId,
    event,
    url: wh.url,
    at: new Date(),
    status,
    ok: status != null && status >= 200 && status < 300,
    latencyMs: Date.now() - started,
    signature,
    requestBody: raw.slice(0, 4000),
    responseSnippet: snippet,
    error,
    trigger,
  };
  logDelivery(d);
  wh.lastDelivery = { at: d.at, status: status ?? 0 };
  publish(`sc:${wh.orgId}`, { type: "webhook.delivered", webhookId: wh.id, deliveryId, status, ok: d.ok, event } as unknown as RealtimeEvent);
  return d;
}

function commodityPayload(c: CommodityRisk) {
  return {
    commodity: c.commodity,
    risk_score: c.riskScore,
    risk_level: c.riskLevel,
    horizon_days: c.horizonDays,
    supply_disruption_pct: c.supplyDisruptionPct,
    price_impact_pct: c.priceImpactPct,
    price_impact_band_pct: c.priceImpactBand,
    at_risk_volume_tonnes: c.atRiskVolumeTonnes,
    current_price_usd_per_t: c.currentPrice,
    regions: c.regions.slice(0, 5).map((r) => ({ district_id: r.districtId, name: r.name, country: r.country, risk: r.peakRisk, loss_pct: r.lossPct, quality_flag: r.qualityFlag })),
    drivers: c.drivers,
    dashboard_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/dashboard/supply-chain/commodities?c=${c.commodity}`,
  };
}

export async function sampleEventData(event: string, commodities: string[]) {
  const risks = await computeCommodityRisks(7);
  const c = risks.commodities.find((x) => commodities.includes(x.commodity)) ?? risks.commodities[0]!;
  if (event === "node.flood.warning") {
    const nodes = computeNodeRisks([], null).filter((n) => n.commodities.some((x) => commodities.includes(x))).sort((a, b) => b.composite - a.composite).slice(0, 3);
    return { nodes: nodes.map((n) => ({ node_id: n.id, name: n.name, type: n.type, composite_risk: n.composite, flood_risk: n.floodRisk, factors: n.factors.map((f) => ({ key: f.key, value: f.value, weight: f.weight })) })) };
  }
  if (event === "scenario.critical") {
    const last = scState().scenarios[0];
    return last
      ? { scenario_id: last.id, label: last.label, p50_loss_usd: last.result.estimated_loss_usd, p90_loss_usd: last.result.p90_loss_usd, price_impact_pct: last.result.price_impact_pct, recovery_days: last.result.recovery_days }
      : { scenario_id: null, note: "Run a scenario to populate this payload" };
  }
  if (event === "supplier.alternative.available") {
    const alt = await alternativeSuppliers(c.commodity, [], null);
    return { commodity: c.commodity, affected: alt?.affected.map((a) => a.name), alternatives: alt?.alternatives.slice(0, 3).map((a) => ({ district_id: a.districtId, name: a.name, country: a.country, lead_time_days: a.leadTimeDays, weekly_capacity_tonnes: a.weeklyCapacityTonnes, quality_flag: a.qualityFlag })) };
  }
  return commodityPayload(c);
}

/**
 * Evaluate every active webhook against live commodity + node risk and POST a
 * signed payload when a threshold is crossed. Called by the climate-scan job.
 * Duplicate suppression: a webhook/commodity pair re-fires only after 6 h or
 * when the score rises by ≥5 points.
 */
export async function evaluateWebhooks(opts: { orgId?: string; force?: boolean } = {}): Promise<{
  evaluated: number;
  fired: number;
  deliveries: { webhookId: string; event: string; subject: string; status: number | null; ok: boolean; latencyMs: number | null }[];
}> {
  const s = getStore();
  const state = scState();
  const hooks = s.webhooks.filter((w) => w.active && (!opts.orgId || w.orgId === opts.orgId));
  if (!hooks.length) return { evaluated: 0, fired: 0, deliveries: [] };
  const risks = await computeCommodityRisks(7);
  const nodes = computeNodeRisks(await hazards(), null);
  const out: { webhookId: string; event: string; subject: string; status: number | null; ok: boolean; latencyMs: number | null }[] = [];

  const shouldFire = (key: string, score: number) => {
    const prev = state.lastFired.get(key);
    if (opts.force || !prev) return true;
    return Date.now() - prev.at > 6 * 3600_000 || score >= prev.score + 5;
  };

  for (const wh of hooks) {
    if (wh.events.includes("commodity.risk.threshold")) {
      for (const c of risks.commodities.filter((x) => wh.commodities.includes(x.commodity) && x.riskScore >= wh.riskThreshold)) {
        const key = `${wh.id}|${c.commodity}`;
        if (!shouldFire(key, c.riskScore)) continue;
        const d = await deliverWebhook(wh, "commodity.risk.threshold", { threshold: wh.riskThreshold, ...commodityPayload(c) }, "evaluation");
        state.lastFired.set(key, { at: Date.now(), score: c.riskScore });
        out.push({ webhookId: wh.id, event: d.event, subject: c.commodity, status: d.status, ok: d.ok, latencyMs: d.latencyMs });
      }
    }
    if (wh.events.includes("node.flood.warning")) {
      const hit = nodes.filter((n) => n.composite >= wh.riskThreshold && n.commodities.some((x) => wh.commodities.includes(x)));
      const maxScore = Math.max(0, ...hit.map((n) => n.composite));
      const key = `${wh.id}|nodes`;
      if (hit.length && shouldFire(key, maxScore)) {
        const d = await deliverWebhook(wh, "node.flood.warning", { threshold: wh.riskThreshold, nodes: hit.map((n) => ({ node_id: n.id, name: n.name, type: n.type, composite_risk: n.composite, flood_risk: n.floodRisk, district: n.districtName, country: n.country })) }, "evaluation");
        state.lastFired.set(key, { at: Date.now(), score: maxScore });
        out.push({ webhookId: wh.id, event: d.event, subject: `${hit.length} node(s)`, status: d.status, ok: d.ok, latencyMs: d.latencyMs });
      }
    }
  }
  return { evaluated: hooks.length, fired: out.length, deliveries: out };
}

export function newWebhookSecret() {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

export function maskSecret(secret: string) {
  return `${secret.slice(0, 6)}••••${secret.slice(-4)}`;
}

// ─── API keys ─────────────────────────────────────────────────────────────

const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function base62(len: number) {
  const bytes = randomBytes(len * 2);
  let out = "";
  for (let i = 0; out.length < len && i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b < 248) out += B62[b % 62];
  }
  while (out.length < len) out += B62[randomBytes(1)[0]! % 62];
  return out;
}
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export function createApiKey(orgId: string, name: string, scopes: string[], env: "live" | "test", user: { id: string; name: string }) {
  const secret = base62(32);
  const key = `ags_${env}_${secret}`;
  const rec: ApiKeyRecord = { id: nextId("key"), orgId, name, prefix: `ags_${env}_${secret.slice(0, 4)}`, createdAt: new Date(), lastUsed: null, scopes };
  getStore().apiKeys.unshift(rec);
  scState().keyHashes.set(rec.id, sha256(key));
  audit({ userId: user.id, userName: user.name, action: "apikey.create", entity: "api_key", entityId: rec.id, details: `${name} (${scopes.join(", ")})` });
  return { record: rec, key };
}

/** Resolve a raw API key to its record (constant-time-ish hash compare), updating lastUsed. */
export function verifyApiKey(raw: string): ApiKeyRecord | null {
  const h = sha256(raw);
  const st = scState();
  for (const k of getStore().apiKeys) {
    if (st.keyHashes.get(k.id) === h) {
      k.lastUsed = new Date();
      return k;
    }
  }
  return null;
}

export const hasHash = (id: string) => scState().keyHashes.has(id);
