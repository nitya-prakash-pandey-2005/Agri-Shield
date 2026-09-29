/**
 * Sensors & IoT — realistic demo fleet simulator.
 *
 * ~40 devices across the five demo workspaces, placed next to real portfolio
 * assets. Each device carries a SimProfile and a small state vector that is
 * stepped forward in time (catch-up generation), so the same code backfills
 * 30 days on first use, ticks every 60 s in-process, and fills gaps on read
 * when the scheduler is disabled.
 *
 * Drivers (no bulk upstream calls — everything comes from data already in memory):
 *   • district live overlay (store.districts): 72 h rain (Open-Meteo when cached,
 *     otherwise the seeded baseline) sets the storm "wetness"; GloFAS discharge
 *     vs its mean, when cached, scales the seasonal river curve;
 *   • district EC estimate seeds soil salinity; salinity risk → coastal/tidal;
 *   • everything else is stochastic but deterministic (hash-seeded noise).
 *
 * Scripted scenarios (relative to the seed time T0) give the demo something to
 * detect: a flash flood, an unexplained rise, a tidal salt surge, a stuck probe,
 * a spiky probe, a dead battery, an intermittent link and a low battery.
 */
import type { AssetRecord, DistrictRecord } from "../data/store";
import { DEVICE_TYPES, type DeviceType, type MetricKey } from "./iot-types";
import {
  DAY,
  HOUR,
  diurnal,
  gauss,
  hash01,
  hashStr,
  hourlyRain,
  reservoirStep,
  seasonalFlowRatio,
  smoothNoise,
  soilMoistureStep,
  stageFromFlowRatio,
  tidalConstituents,
  tideLevel,
  type TidalConstituent,
} from "./iot-physics";
import type { DeviceRecord } from "./iot-store";

export type Scenario = "flash_flood" | "unexplained_rise" | "surge" | "ec_surge" | "flatline" | "spikes" | "dead_battery" | "intermittent" | "low_battery";
type Regime = "bengal" | "odisha" | "mekong" | "luzon";

export interface SimDrivers {
  /** storm frequency/intensity multiplier from the district's 72 h rain */
  wetness: number;
  /** live GloFAS discharge ratio when cached, else null */
  liveFlowRatio: number | null;
  ecNow: number;
  seaLevelAnomalyM: number;
  source: "open-meteo" | "seed";
}

export interface SimProfile {
  deviceId: string;
  type: DeviceType;
  seed: number;
  cell: number;
  regime: Regime;
  coastal: boolean;
  peakDoy: number;
  lon: number;
  t0: number;
  scenario: Scenario | null;
  // river
  base: number;
  scale: number;
  respM: number;
  tauH: number;
  tidalInfluence: number;
  tide: TidalConstituent[];
  // soil
  ecBase: number;
  // groundwater
  gwBase: number;
  // radio / power
  rssiBase: number;
  lossRate: number;
  batteryStart: number;
  drainPerDay: number;
  solar: boolean;
  drivers: SimDrivers;
  state: { t: number; runoff: number; moisture: number; salt: number; ecExcess: number; recharge: number; rainCarry: number; frozen: Partial<Record<MetricKey, number>> | null };
}

interface Burst {
  cell: number;
  at: number;
  hours: number;
  totalMm: number;
}
interface SimState {
  profiles: Map<string, SimProfile>;
  t0: number | null;
  bursts: Burst[];
}
const g = globalThis as unknown as { __agriIotSim?: SimState };
export const sim: SimState = (g.__agriIotSim ??= { profiles: new Map(), t0: null, bursts: [] });
const bursts = sim.bursts;

// ─── Scripted rain bursts (per rain cell) ────────────────────────────────

const cellOf = (districtId: string | null, lat: number, lon: number) => hashStr(districtId ?? `${lat.toFixed(1)},${lon.toFixed(1)}`);

/** Rain (mm) falling on a cell during [t0, t1). */
export function cellRain(p: Pick<SimProfile, "cell" | "peakDoy" | "drivers" | "scenario" | "t0">, t0: number, t1: number): number {
  if (t1 <= t0) return 0;
  let mm = 0;
  for (let h = Math.floor(t0 / HOUR); h * HOUR < t1; h++) {
    const a = Math.max(t0, h * HOUR);
    const b = Math.min(t1, (h + 1) * HOUR);
    if (b <= a) continue;
    const frac = (b - a) / HOUR;
    // unexplained-rise site: keep the cell dry around the event so nothing explains it
    const dryWindow = p.scenario === "unexplained_rise" && h * HOUR > p.t0 - 40 * HOUR && h * HOUR < p.t0 - 4 * HOUR;
    const base = dryWindow ? 0 : hourlyRain(p.cell, h, { monsoonPeakDoy: p.peakDoy, wetness: p.drivers.wetness });
    let burst = 0;
    for (const bu of bursts) if (bu.cell === p.cell && h * HOUR >= bu.at && h * HOUR < bu.at + bu.hours * HOUR) burst += (bu.totalMm / bu.hours) * (0.6 + 0.8 * hash01(p.cell, h));
    mm += (base + burst) * frac;
  }
  return mm;
}

// ─── Profiles ────────────────────────────────────────────────────────────

const REGIME_OF = (country: string): Regime => (country === "IN" ? "odisha" : country === "VN" ? "mekong" : country === "PH" ? "luzon" : "bengal");
const PEAK_DOY: Record<Regime, number> = { bengal: 205, odisha: 220, mekong: 268, luzon: 222 };

/** River-gauge hydraulics per district (datum-relative stage, not national datums). */
const RIVER: Record<string, { base: number; scale: number; respM: number; tauH: number; tidal: number; warning: number; danger: number }> = {
  "bd-sylhet": { base: 2.0, scale: 4.0, respM: 0.012, tauH: 20, tidal: 0, warning: 7.0, danger: 7.8 },
  "vn-angiang": { base: 0.6, scale: 3.4, respM: 0.003, tauH: 80, tidal: 0.18, warning: 4.0, danger: 4.5 },
  "ph-pampanga": { base: 1.0, scale: 3.0, respM: 0.008, tauH: 30, tidal: 0.05, warning: 4.6, danger: 5.4 },
  "bd-patuakhali": { base: 0.9, scale: 0.9, respM: 0.006, tauH: 24, tidal: 0.8, warning: 2.9, danger: 3.3 },
  "in-balasore": { base: 1.1, scale: 2.2, respM: 0.009, tauH: 26, tidal: 0.25, warning: 3.9, danger: 4.6 },
};
const riverParams = (districtId: string | null, coastal: boolean) =>
  (districtId && RIVER[districtId]) || (coastal ? { base: 1.0, scale: 1.6, respM: 0.006, tauH: 30, tidal: 0.5, warning: 3.3, danger: 3.9 } : { base: 1.5, scale: 3.0, respM: 0.008, tauH: 30, tidal: 0, warning: 5.0, danger: 5.8 });

export function driversFrom(d: DistrictRecord | null): SimDrivers {
  if (!d) return { wetness: 1, liveFlowRatio: null, ecNow: 1.2, seaLevelAnomalyM: 0, source: "seed" };
  const live = d.liveSource === "open-meteo";
  const ratio = d.riverDischargeM3s != null && d.riverDischargeMeanM3s ? d.riverDischargeM3s / d.riverDischargeMeanM3s : null;
  return {
    wetness: Math.min(2.2, Math.max(0.4, (d.rainfall72hMm || 60) / 70)),
    liveFlowRatio: live && ratio != null && Number.isFinite(ratio) ? Math.min(4, Math.max(0.2, ratio)) : null,
    ecNow: Math.max(0.3, d.ecCurrent || 1),
    seaLevelAnomalyM: d.seaLevelAnomalyM ?? 0,
    source: live ? "open-meteo" : "seed",
  };
}

export function makeProfile(dev: Pick<DeviceRecord, "id" | "type" | "lat" | "lon" | "districtId">, district: DistrictRecord | null, t0: number, scenario: Scenario | null): SimProfile {
  const seed = hashStr(dev.id);
  const country = district?.country ?? "BD";
  const regime = REGIME_OF(country);
  const coastal = (district?.salinityRisk ?? 0) >= 20;
  const rp = riverParams(dev.districtId, coastal);
  const r = (k: number) => hash01(seed, k);
  const drivers = driversFrom(district);
  const solar = dev.type === "weather_station" || dev.type === "tide_gauge";
  return {
    deviceId: dev.id,
    type: dev.type,
    seed,
    cell: cellOf(dev.districtId, dev.lat, dev.lon),
    regime,
    coastal,
    peakDoy: PEAK_DOY[regime] + Math.round((r(1) - 0.5) * 10),
    lon: dev.lon,
    t0,
    scenario,
    base: rp.base,
    scale: rp.scale,
    respM: rp.respM,
    tauH: rp.tauH,
    tidalInfluence: rp.tidal,
    tide: tidalConstituents(regime, seed % 997),
    ecBase: drivers.ecNow * (0.75 + 0.5 * r(2)),
    gwBase: coastal ? 2.5 + 3 * r(3) : 5 + 6 * r(3),
    rssiBase: -80 - 30 * r(4),
    lossRate: scenario === "intermittent" ? 0.3 : 0.004 + 0.03 * r(5),
    batteryStart: scenario === "low_battery" ? 23 : scenario === "dead_battery" ? 9 : 62 + 36 * r(6),
    drainPerDay: scenario === "low_battery" ? 1.25 : scenario === "dead_battery" ? 3 : 0.03 + 0.09 * r(7),
    solar,
    drivers,
    state: { t: 0, runoff: 0, moisture: 26 + 8 * r(8), salt: 0, ecExcess: 0, recharge: 0, rainCarry: 0, frozen: null },
  };
}

export function riverThresholds(districtId: string | null, coastal: boolean) {
  const rp = riverParams(districtId, coastal);
  return { warning: rp.warning, danger: rp.danger };
}

// ─── Physics per step ────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function flowRatio(p: SimProfile, t: number): number {
  const seasonal = seasonalFlowRatio(t, p.peakDoy, p.regime === "mekong" ? 0.85 : 0.75);
  if (p.drivers.liveFlowRatio == null) return seasonal;
  // Blend the live GloFAS ratio in over the last 10 days so "now" matches the forecast
  const nowSeasonal = seasonalFlowRatio(p.t0, p.peakDoy, p.regime === "mekong" ? 0.85 : 0.75);
  const adj = clamp(p.drivers.liveFlowRatio / nowSeasonal, 0.4, 2.5);
  const w = clamp(1 - (p.t0 - t) / (10 * DAY), 0, 1);
  return seasonal * (1 + (adj - 1) * w);
}

function scenarioPulse(p: SimProfile, t: number): number {
  if (p.scenario === "unexplained_rise") {
    // sluice / upstream release: +0.85 m over 2 h, then recession (τ 14 h)
    const at = p.t0 - 14 * HOUR;
    if (t < at) return 0;
    const h = (t - at) / HOUR;
    return h < 2 ? 0.85 * (h / 2) : 0.85 * Math.exp(-(h - 2) / 14);
  }
  return 0;
}

function surge(p: SimProfile, t: number): number {
  if (p.scenario !== "surge") return 0;
  const at = p.t0 - 10 * HOUR;
  const x = (t - at) / (5 * HOUR);
  return 0.75 * Math.exp(-x * x);
}

function battery(p: SimProfile, t: number, raining: boolean): number {
  const days = (p.t0 - t) / DAY; // days before the seed time (negative = after)
  if (p.scenario === "low_battery") {
    // failing solar panel: ~14 % at T0, draining 1.25 %/day, tiny daytime top-up
    return clamp(14 + p.drainPerDay * days + 2 * Math.max(0, diurnal(t, p.lon)), 1, 100);
  }
  if (p.scenario === "dead_battery") {
    // primary cell ran flat three days before T0
    return clamp(3 + p.drainPerDay * (days - 3), 0, 100);
  }
  if (p.solar) return clamp(84 + 12 * Math.max(0, diurnal(t, p.lon)) - (raining ? 4 : 0), 1, 100);
  // primary cells: linear drain from install
  return clamp(p.batteryStart + p.drainPerDay * days, 0, 100);
}

/** Is a packet delivered at t? (radio loss, outages, dead battery) */
function delivered(p: SimProfile, t: number): boolean {
  if (p.scenario === "dead_battery" && t > p.t0 - 3 * DAY) return false;
  if (p.scenario === "intermittent") {
    // gateway outage pattern: silent ~40 % of each 9-hour cycle, and never within the final 5 h before T0+
    const phase = ((t / HOUR + (p.seed % 9)) % 9 + 9) % 9;
    if (phase < 3.6) return false;
  }
  return hash01(p.seed ^ 0x5bd1e995, Math.floor(t / 1000)) > p.lossRate;
}

/**
 * Step the device state from p.state.t to t and return the reading, or null
 * when the packet is lost (state still advances).
 */
export function stepDevice(p: SimProfile, t: number): Partial<Record<MetricKey, number>> | null {
  const st = p.state;
  const prevT = st.t || t - 15 * 60_000;
  const dtH = Math.max(1 / 3600, (t - prevT) / HOUR);
  const rain = cellRain(p, prevT, t);
  // smooth "wet" factor (0-1) from the rain rate around t, so temperature/pressure respond gradually
  const wet = clamp(cellRain(p, t - 45 * 60_000, t + 15 * 60_000) / 3, 0, 1);
  const raining = wet > 0.5;
  const k = Math.floor(t / 1000);
  const n = (i: number) => gauss(p.seed + i * 7919, k);
  const v: Partial<Record<MetricKey, number>> = {};

  switch (p.type) {
    case "river_gauge": {
      st.runoff = reservoirStep(st.runoff, rain, dtH, p.tauH);
      const ratio = flowRatio(p, t);
      const tidal = p.tidalInfluence > 0 ? (p.tidalInfluence / (0.6 + 0.4 * ratio)) * tideLevel(t, p.tide) : 0;
      const level = stageFromFlowRatio(ratio, p.base, p.scale) + st.runoff * p.respM + tidal + scenarioPulse(p, t) + 0.004 * n(1);
      v.water_level_m = round(level, 3);
      break;
    }
    case "tide_gauge": {
      const monsoonSetup = 0.25 * (seasonalFlowRatio(t, p.peakDoy + 20, 0.6) - 1);
      const windSetup = 0.04 * smoothNoise(p.seed, t, 3 * HOUR);
      v.tide_level_m = round(tideLevel(t, p.tide) + monsoonSetup + windSetup + p.drivers.seaLevelAnomalyM * 0.5 + surge(p, t) + 0.006 * n(1), 3);
      break;
    }
    case "soil_probe": {
      const localH = ((t / HOUR + p.lon / 15) % 24 + 24) % 24;
      const prevLocalH = ((prevT / HOUR + p.lon / 15) % 24 + 24) % 24;
      const crossed6 = (prevLocalH < 6 && localH >= 6) || (dtH >= 24);
      const season = seasonalFlowRatio(t, p.peakDoy, 0.75);
      let irrigation = 0;
      if (crossed6 && st.moisture < 22 && rain < 1) {
        irrigation = 35;
        if (p.coastal) st.salt += 0.05 * p.ecBase; // brackish canal water
      }
      st.moisture = soilMoistureStep(st.moisture || 28, dtH, { rainMm: rain, irrigationMm: irrigation, floor: 11, saturation: 47, tauH: 70 / (0.7 + 0.3 * Math.max(0.2, 1.4 - season)) });
      // salt: relaxes to the seasonal base, leached by rain
      const dry = clamp(1.2 - season / 1.5, 0, 1);
      const dryNow = clamp(1.2 - seasonalFlowRatio(p.t0, p.peakDoy, 0.75) / 1.5, 0, 1);
      const target = p.ecBase * ((0.6 + 0.8 * dry) / (0.6 + 0.8 * dryNow));
      if (!st.salt) st.salt = target;
      st.salt += (target - st.salt) * (1 - Math.exp(-dtH / 240)) - Math.min(st.salt * 0.3, rain * 0.0015 * st.salt);
      // tidal salt surge (scenario): ramps in over 3 h at T0−9 h, then leaches out over days
      if (p.scenario === "ec_surge") {
        const at = p.t0 - 9 * HOUR;
        if (t >= at && prevT < at + 3 * HOUR) st.ecExcess += 5.2 * Math.min(1, (Math.min(t, at + 3 * HOUR) - Math.max(prevT, at)) / (3 * HOUR));
      }
      st.ecExcess *= Math.exp(-dtH / 96);
      const tidalEc = p.coastal ? 0.06 * p.ecBase * Math.max(0, tideLevel(t - 2 * HOUR, p.tide)) : 0;
      const ec = (st.salt + st.ecExcess) * Math.pow(30 / Math.max(8, st.moisture), 0.5) + tidalEc + 0.025 * n(1);
      v.soil_ec = round(Math.max(0.05, ec), 2);
      v.soil_moisture = round(st.moisture + 0.12 * n(2), 1);
      v.soil_temp_c = round(27.5 - 2.5 * (season - 1) + 3.2 * diurnal(t - 2 * HOUR, p.lon) - (raining ? 1 : 0) + 0.1 * n(3), 1);
      if (p.scenario === "spikes" && hash01(p.seed, k) < 0.006) v.soil_ec = round(18 + 20 * hash01(p.seed + 1, k), 2);
      if (p.scenario === "flatline" && t >= p.t0 - 20 * HOUR) {
        st.frozen ??= { soil_ec: v.soil_ec, soil_moisture: v.soil_moisture };
        Object.assign(v, st.frozen);
      }
      break;
    }
    case "rain_gauge": {
      // tipping bucket: report whole 0.2 mm tips
      st.rainCarry += rain;
      const tips = Math.floor(st.rainCarry / 0.2 + 1e-9);
      st.rainCarry -= tips * 0.2;
      v.rain_mm = round(tips * 0.2, 1);
      break;
    }
    case "weather_station": {
      st.rainCarry += rain;
      const tips = Math.floor(st.rainCarry / 0.2 + 1e-9);
      st.rainCarry -= tips * 0.2;
      const season = seasonalFlowRatio(t, p.peakDoy, 0.75);
      const dnl = diurnal(t, p.lon);
      const temp = 29.5 + 1.5 * (1 - season) + (4.2 - 1.7 * wet) * dnl - 1.8 * wet + 0.3 * smoothNoise(p.seed, t, 2 * HOUR) + 0.08 * n(1);
      v.air_temp_c = round(temp, 1);
      v.humidity_pct = round(clamp(80 - 14 * dnl + 14 * wet + 3 * smoothNoise(p.seed + 3, t, 3 * HOUR) + 0.6 * n(2), 25, 100), 0);
      v.rain_mm = round(tips * 0.2, 1);
      v.wind_ms = round(Math.max(0, 2.6 + 1.4 * dnl + 3.5 * wet + 0.9 * Math.abs(n(3))), 1);
      const semiDiurnalP = 1.1 * Math.cos((4 * Math.PI * (((t / HOUR + p.lon / 15) % 24) - 10)) / 24);
      v.pressure_hpa = round(1009 - 3.5 * (season - 1) + semiDiurnalP - 1.5 * wet + 0.8 * smoothNoise(p.seed + 5, t, 6 * HOUR) + 0.05 * n(4), 1);
      break;
    }
    case "piezometer": {
      st.recharge = reservoirStep(st.recharge, rain, dtH, 24 * 20);
      const lagged = seasonalFlowRatio(t - 40 * DAY, p.peakDoy, 0.75);
      const localH = ((t / HOUR + p.lon / 15) % 24 + 24) % 24;
      const pumping = lagged < 0.9 && localH > 6 && localH < 14 ? 0.35 * Math.sin((Math.PI * (localH - 6)) / 8) : 0;
      const depth = p.gwBase + 1.8 * (1 - Math.min(1.6, lagged) / 1.6) - st.recharge * 0.0009 + pumping + 0.003 * n(1);
      v.groundwater_depth_m = round(Math.max(0.2, depth), 3);
      break;
    }
  }

  v.battery_pct = round(battery(p, t, raining), 0);
  if (DEVICE_TYPES[p.type].metrics.includes("rssi_dbm")) v.rssi_dbm = round(p.rssiBase - 3 * wet + 2.5 * n(9), 0);
  if (DEVICE_TYPES[p.type].metrics.includes("snr_db")) v.snr_db = round(9 + (p.rssiBase + 95) / 3 + 1.5 * n(10), 1);

  st.t = t;
  return delivered(p, t) ? v : null;
}

// ─── Fleet seed ──────────────────────────────────────────────────────────

export interface SeedSpec {
  org: string;
  type: DeviceType;
  district?: string;
  facility?: AssetRecord["type"];
  name: string;
  scenario?: Scenario;
}

const DM = "org-ins-deltamutual";
const MK = "org-bank-mekong";
const BR = "org-ngo-brac";
const OD = "org-coop-odisha";
const AG = "org-sc-asiagrain";

export const FLEET: SeedSpec[] = [
  // Delta Mutual — insured village clusters (BD / Odisha)
  { org: DM, type: "river_gauge", district: "bd-sylhet", name: "Surma river gauge · Sylhet haor", scenario: "flash_flood" },
  { org: DM, type: "weather_station", district: "bd-sylhet", name: "Weather station · Sylhet cluster" },
  { org: DM, type: "tide_gauge", district: "bd-khulna", name: "Pasur estuary tide gauge · Dacope" },
  { org: DM, type: "soil_probe", district: "bd-satkhira", name: "Soil EC probe · Shyamnagar cluster" },
  { org: DM, type: "soil_probe", district: "bd-khulna", name: "Soil EC probe · Koyra cluster" },
  { org: DM, type: "rain_gauge", district: "bd-barisal", name: "Rain gauge · Barisal cluster" },
  { org: DM, type: "rain_gauge", district: "in-balasore", name: "Rain gauge · Balasore cluster" },
  { org: DM, type: "piezometer", district: "bd-satkhira", name: "Observation well · Satkhira", scenario: "intermittent" },
  // Mekong Agri Bank — borrower farms (VN / PH)
  { org: MK, type: "river_gauge", district: "vn-angiang", name: "Hậu River gauge · Châu Đốc", scenario: "unexplained_rise" },
  { org: MK, type: "tide_gauge", district: "vn-bentre", name: "Hàm Luông estuary tide gauge" },
  { org: MK, type: "soil_probe", district: "vn-bentre", name: "Soil EC probe · Bình Đại orchard" },
  { org: MK, type: "soil_probe", district: "vn-soctrang", name: "Soil EC probe · Trần Đề rice" },
  { org: MK, type: "soil_probe", district: "vn-camau", name: "Soil EC probe · Cà Mau rice–shrimp", scenario: "flatline" },
  { org: MK, type: "weather_station", district: "vn-cantho", name: "Weather station · Cần Thơ" },
  { org: MK, type: "river_gauge", district: "ph-pampanga", name: "Pampanga river gauge · Arayat" },
  { org: MK, type: "rain_gauge", district: "ph-nuevaecija", name: "Rain gauge · Nueva Ecija" },
  // BRAC-style NGO — communities (BD)
  { org: BR, type: "river_gauge", district: "bd-sylhet", name: "Kushiyara gauge · Sylhet communities" },
  { org: BR, type: "rain_gauge", district: "bd-sylhet", name: "Community rain gauge · Sylhet" },
  { org: BR, type: "tide_gauge", district: "bd-satkhira", name: "Kholpetua tide gauge · Gabura", scenario: "surge" },
  { org: BR, type: "soil_probe", district: "bd-satkhira", name: "Soil EC probe · Gabura homesteads", scenario: "ec_surge" },
  { org: BR, type: "river_gauge", district: "bd-patuakhali", name: "Canal gauge · Kalapara polder" },
  { org: BR, type: "weather_station", district: "bd-khulna", name: "Weather station · Koyra shelter" },
  { org: BR, type: "piezometer", district: "bd-patuakhali", name: "Drinking-water well · Patuakhali" },
  { org: BR, type: "rain_gauge", district: "bd-barisal", name: "Community rain gauge · Barisal", scenario: "dead_battery" },
  // Odisha co-operative — member farms
  { org: OD, type: "soil_probe", district: "in-kendrapara", name: "Soil EC probe · Mahakalapada farm" },
  { org: OD, type: "soil_probe", district: "in-jagatsinghpur", name: "Soil EC probe · Ersama farm" },
  { org: OD, type: "soil_probe", district: "in-puri", name: "Soil EC probe · Astaranga farm", scenario: "spikes" },
  { org: OD, type: "river_gauge", district: "in-balasore", name: "Budhabalanga canal gauge" },
  { org: OD, type: "tide_gauge", district: "in-jagatsinghpur", name: "Mahanadi mouth tide gauge" },
  { org: OD, type: "rain_gauge", district: "in-puri", name: "Rain gauge · Puri co-op" },
  { org: OD, type: "weather_station", district: "in-kendrapara", name: "Weather station · Kendrapara co-op", scenario: "low_battery" },
  { org: OD, type: "piezometer", district: "in-balasore", name: "Irrigation tube-well · Balasore" },
  // AsiaGrain — ports, plants, warehouses
  { org: AG, type: "tide_gauge", facility: "port", name: "Berth tide gauge" },
  { org: AG, type: "river_gauge", facility: "warehouse", name: "Flood gauge" },
  { org: AG, type: "river_gauge", facility: "warehouse", name: "Flood gauge" },
  { org: AG, type: "rain_gauge", facility: "warehouse", name: "Rain gauge" },
  { org: AG, type: "weather_station", facility: "processing_plant", name: "Weather station" },
  { org: AG, type: "piezometer", facility: "processing_plant", name: "Process-water well" },
  { org: AG, type: "soil_probe", facility: "retail_outlet", name: "Soil EC probe (supplier farm)" },
  { org: AG, type: "river_gauge", facility: "processing_plant", name: "Flood gauge" },
];

/** Deterministic small offset (0.3–2.5 km) so the device sits next to, not on, the asset. */
export function offsetNear(lat: number, lon: number, seed: number): [number, number] {
  const r = (0.3 + 2.2 * hash01(seed, 91)) / 111;
  const a = 2 * Math.PI * hash01(seed, 92);
  return [Math.round((lat + r * Math.sin(a)) * 1e5) / 1e5, Math.round((lon + (r * Math.cos(a)) / Math.cos((lat * Math.PI) / 180)) * 1e5) / 1e5];
}

export function registerScenarioBursts(p: SimProfile) {
  if (p.scenario === "flash_flood" && !bursts.some((b) => b.cell === p.cell)) bursts.push({ cell: p.cell, at: p.t0 - 20 * HOUR, hours: 6, totalMm: 150 });
}
