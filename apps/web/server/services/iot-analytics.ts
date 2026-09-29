/**
 * Sensors & IoT — analytics on top of the time-series store:
 *   • anomaly detection per device (with rain / river / tide context)
 *   • device health (battery drain, packet loss, signal, uptime)
 *   • forecast vs observed ("sensor confirms forecast" / "sensor disagrees")
 *   • latestSensorMetrics(orgId) — per-asset ground truth for the rule engine
 */
import { getStore, type DistrictRecord } from "../data/store";
import { haversineKm } from "./location-risk";
import { detectAnomalies, type Sample as TSample } from "./iot-anomaly";
import { DEVICE_TYPES, METRIC_META, type Anomaly, type MetricKey } from "./iot-types";
import { aggregate, deviceAnomalies, iot, logAnomalies, orgDevices, querySeries, rawSamples, statusOf, RAW_WINDOW_MS, type DeviceRecord, type LoggedAnomaly } from "./iot-store";

const H = 3_600_000;
const DAY = 86_400_000;

export function districtOf(d: Pick<DeviceRecord, "districtId" | "lat" | "lon">): DistrictRecord | null {
  const s = getStore();
  if (d.districtId) {
    const hit = s.districts.find((x) => x.id === d.districtId);
    if (hit) return hit;
  }
  let best: DistrictRecord | null = null;
  let bestKm = 120;
  for (const x of s.districts) {
    const km = haversineKm(d.lat, d.lon, x.lat, x.lon);
    if (km < bestKm) {
      bestKm = km;
      best = x;
    }
  }
  return best;
}

export const isCoastal = (district: DistrictRecord | null) => (district?.salinityRisk ?? 0) >= 20;

/** Nearest rain-measuring device of the same workspace (same district or within 40 km) (tenant data never crosses workspaces). */
export function nearestRainDevice(d: DeviceRecord): { device: DeviceRecord; km: number } | null {
  let best: { device: DeviceRecord; km: number } | null = null;
  for (const o of orgDevices(d.orgId)) {
    if (!DEVICE_TYPES[o.type].metrics.includes("rain_mm")) continue;
    const km = o.id === d.id ? 0 : haversineKm(d.lat, d.lon, o.lat, o.lon);
    // same district (shared rain climate) or within 40 km
    if ((km <= 40 || (d.districtId && o.districtId === d.districtId && km <= 90)) && (!best || km < best.km)) best = { device: o, km };
  }
  return best;
}

/** Live GloFAS discharge ratio for the device's district, when the live overlay has it. */
export function liveDischargeRatio(district: DistrictRecord | null): number | null {
  if (!district || district.liveSource !== "open-meteo" || district.riverDischargeM3s == null || !district.riverDischargeMeanM3s) return null;
  const r = district.riverDischargeM3s / district.riverDischargeMeanM3s;
  return Number.isFinite(r) ? Math.round(r * 100) / 100 : null;
}

const DETECT_SKIP = new Set<MetricKey>(["battery_pct", "rssi_dbm", "snr_db", "soil_temp_c", "humidity_pct", "wind_ms", "air_temp_c"]);

/** Run the detector over the device's raw window and merge into the anomaly log. Returns newly seen anomalies. */
export function runDetection(d: DeviceRecord, now = Date.now()): LoggedAnomaly[] {
  const district = districtOf(d);
  const rainDev = nearestRainDevice(d);
  const raw = rawSamples(d.id, now - RAW_WINDOW_MS, now);
  const found: Anomaly[] = [];
  for (const metric of DEVICE_TYPES[d.type].metrics) {
    if (DETECT_SKIP.has(metric)) continue;
    const series: TSample[] = [];
    for (const s of raw) {
      const v = s.v[metric];
      if (v != null) series.push({ t: s.t, v });
    }
    found.push(
      ...detectAnomalies(series, {
        deviceId: d.id,
        metric,
        intervalMs: d.intervalSec * 1000,
        riseThresholdM: d.thresholds.danger && d.thresholds.danger < 4 ? 0.35 : 0.5,
        zThreshold: metric === "tide_level_m" ? 7 : 6,
        context: {
          tidal: isCoastal(district),
          dischargeRatio: liveDischargeRatio(district),
          forecastRain72hMm: district?.liveSource === "open-meteo" ? district.rainfall72hMm : null,
          rainBetween: rainDev ? (from, to) => aggregate(rainDev.device.id, "rain_mm", from, to, now) : undefined,
        },
      })
    );
  }
  return logAnomalies(d.id, found);
}

// ─── Health ──────────────────────────────────────────────────────────────

export interface DeviceHealth {
  battery: number | null;
  drainPerDay: number | null;
  daysToEmpty: number | null;
  packetLoss24h: number | null;
  received24h: number;
  expected24h: number;
  rssiAvg: number | null;
  snrAvg: number | null;
  uptime7d: number | null;
  firmwareLatest: string;
  firmwareOutdated: boolean;
  score: number;
  issues: string[];
}

/** Ordinary least squares slope (y per x-unit). */
export function olsSlope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den ? num / den : null;
}

const cmpVer = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

export function deviceHealth(d: DeviceRecord, now = Date.now()): DeviceHealth {
  const meta = DEVICE_TYPES[d.type];
  const battery = d.lastValues.battery_pct ?? null;
  // Daily mean battery over 7 days removes the solar charge cycle before fitting the drain
  const daily = querySeries(d.id, "battery_pct", now - 7 * DAY, now, 7);
  const slope = olsSlope(daily.map((p) => p.t / DAY), daily.map((p) => p.v));
  const drainPerDay = slope != null ? Math.round(-slope * 100) / 100 : null;
  const daysToEmpty = battery != null && drainPerDay != null && drainPerDay > 0.02 ? Math.round(battery / drainPerDay) : null;
  const installed = d.installedAt.getTime();
  const window = Math.min(DAY, Math.max(0, now - Math.max(installed, d.createdAt.getTime())));
  const expected24h = Math.max(1, Math.floor(window / (d.intervalSec * 1000)));
  const received24h = rawSamples(d.id, now - DAY, now).length;
  const packetLoss24h = window > 10 * 60_000 ? Math.max(0, Math.min(1, 1 - received24h / expected24h)) : null;
  const rssi = aggregate(d.id, "rssi_dbm", now - DAY, now, now);
  const snr = aggregate(d.id, "snr_db", now - DAY, now, now);
  const hours = querySeries(d.id, meta.primary, now - 7 * DAY, now, 100_000, now).length;
  const uptime7d = Math.min(1, hours / Math.max(1, Math.min(168, (now - installed) / H)));
  const firmwareOutdated = cmpVer(d.firmware, meta.latestFirmware) < 0;
  const issues: string[] = [];
  const status = statusOf(d, now);
  if (status === "offline") issues.push("Offline for more than 6 hours");
  else if (status === "stale") issues.push("Missed several reports");
  if (battery != null && battery < 20) issues.push(`Battery low (${Math.round(battery)} %)`);
  if (daysToEmpty != null && daysToEmpty < 30) issues.push(`Battery empty in ~${daysToEmpty} days at the current drain`);
  if (packetLoss24h != null && packetLoss24h > 0.15) issues.push(`${Math.round(packetLoss24h * 100)} % packet loss in 24 h`);
  if (rssi != null && rssi < -115) issues.push(`Weak radio signal (${Math.round(rssi)} dBm)`);
  if (firmwareOutdated) issues.push(`Firmware ${d.firmware} — ${meta.latestFirmware} available`);
  const score = Math.max(
    0,
    Math.round(
      100 -
        (status === "offline" ? 60 : status === "stale" ? 25 : 0) -
        (battery != null && battery < 20 ? 20 : 0) -
        (packetLoss24h ?? 0) * 60 -
        (rssi != null && rssi < -115 ? 10 : 0) -
        (firmwareOutdated ? 5 : 0)
    )
  );
  return {
    battery: battery != null ? Math.round(battery) : null,
    drainPerDay,
    daysToEmpty,
    packetLoss24h: packetLoss24h != null ? Math.round(packetLoss24h * 1000) / 1000 : null,
    received24h,
    expected24h,
    rssiAvg: rssi != null ? Math.round(rssi) : null,
    snrAvg: snr != null ? Math.round(snr * 10) / 10 : null,
    uptime7d: Math.round(uptime7d * 1000) / 1000,
    firmwareLatest: meta.latestFirmware,
    firmwareOutdated,
    score,
    issues,
  };
}

// ─── Forecast vs observed ────────────────────────────────────────────────

export type Verdict = "confirms" | "disagrees" | "ahead" | "calm" | "insufficient";

export interface ForecastComparison {
  verdict: Verdict;
  headline: string;
  detail: string;
  observed: { label: string; value: string }[];
  forecast: { label: string; value: string }[];
  source: string;
  live: boolean;
}

const f = (v: number | null | undefined, d = 1, unit = "") => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}${unit}`);

function percentile(values: number[], x: number): number {
  if (!values.length) return 50;
  return Math.round((values.filter((v) => v <= x).length / values.length) * 100);
}

export function forecastVsObserved(d: DeviceRecord, now = Date.now()): ForecastComparison {
  const district = districtOf(d);
  const live = district?.liveSource === "open-meteo";
  const ratio = liveDischargeRatio(district);
  const rain72 = district?.rainfall72hMm ?? null;
  const p72 = district?.floodProb72h != null ? Math.round(district.floodProb72h * (district.floodProb72h <= 1 ? 100 : 1)) : null;
  const src = live ? `Open-Meteo / GloFAS (cached ${district?.lastUpdated ? new Date(district.lastUpdated).toISOString().slice(11, 16) : ""} UTC) for ${district?.name}` : `Seeded district baseline for ${district?.name ?? "the nearest district"} — live forecast unavailable, comparison is indicative`;
  const noData = (why: string): ForecastComparison => ({ verdict: "insufficient", headline: "Not enough data yet", detail: why, observed: [], forecast: [], source: src, live });
  const last = d.lastSeen;
  if (last == null) return noData("The device has not reported yet. Once it sends a few hours of readings we compare them with the forecast.");
  if (now - last > 6 * H) return { ...noData(`The device has been silent for ${Math.round((now - last) / H)} h, so there is no current ground truth to compare. Restore it (battery / radio) to resume the check.`), headline: "Device offline — no comparison" };

  const primary = DEVICE_TYPES[d.type].primary;
  const history = rawSamples(d.id, now - RAW_WINDOW_MS, now);
  const spanH = history.length ? (history[history.length - 1]!.t - history[0]!.t) / H : 0;
  if (history.length < 12 || spanH < 6) return noData(`Only ${history.length} reading${history.length === 1 ? "" : "s"} over ${spanH.toFixed(1)} h so far — the comparison needs at least 6 hours of data to separate a trend from noise.`);
  const forecastRows = [
    { label: "Rain forecast / recent 72 h", value: f(rain72, 0, " mm") },
    ...(ratio != null ? [{ label: "River flow vs normal (GloFAS)", value: f(ratio, 2, "×") }] : []),
    ...(p72 != null ? [{ label: "Modelled flood chance (72 h)", value: `${p72} %` }] : []),
  ];
  const forecastHigh = (ratio != null && ratio >= 1.3) || (rain72 ?? 0) >= 90 || (p72 ?? 0) >= 50;
  const forecastLow = (ratio == null || ratio <= 1.05) && (rain72 ?? 0) < 35 && (p72 ?? 0) < 25;

  if (primary === "water_level_m") {
    const nowV = aggregate(d.id, primary, last - H, last, now);
    const dayAgo = aggregate(d.id, primary, last - 25 * H, last - 23 * H, now);
    const change = nowV != null && dayAgo != null ? nowV - dayAgo : null;
    const month = querySeries(d.id, primary, now - 30 * DAY, now, 100_000, now).map((p) => p.v);
    const pct = nowV != null ? percentile(month, nowV) : null;
    const rising = (change ?? 0) >= 0.25 || (pct ?? 0) >= 90;
    const falling = (change ?? 0) <= -0.15;
    const observed = [
      { label: "Level now", value: f(nowV, 2, " m") },
      { label: "Change in 24 h", value: change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)} m` },
      { label: "Rank vs last 30 days", value: pct == null ? "—" : `${pct}th percentile` },
      ...(d.thresholds.danger ? [{ label: "Danger level", value: `${d.thresholds.danger.toFixed(2)} m` }] : []),
    ];
    let verdict: Verdict;
    let headline: string;
    let detail: string;
    if (forecastHigh && rising) {
      verdict = "confirms";
      headline = "Sensor confirms the forecast";
      detail = `The forecast signals high water and the gauge is already ${change != null && change > 0 ? `up ${change.toFixed(2)} m in 24 h` : "near its 30-day high"}. Treat the flood warning as confirmed on the ground.`;
    } else if (forecastHigh && (falling || !rising)) {
      verdict = "disagrees";
      headline = "Sensor disagrees — check the device";
      detail = `The forecast expects rising water but the gauge is ${falling ? "falling" : "steady"}. Either the flood wave has not arrived yet (upstream travel time) or the sensor is obstructed / mis-calibrated. Verify the staff gauge on site.`;
    } else if (!forecastHigh && rising) {
      verdict = "ahead";
      headline = "Sensor shows a rise the forecast missed";
      detail = "Water is rising although the forecast is calm — typical of local downpours, sluice releases or embankment seepage that global models cannot see. Ground truth wins: watch this site closely.";
    } else {
      verdict = "calm";
      headline = forecastLow ? "Consistent — calm conditions" : "Consistent — no significant change";
      detail = "Forecast and gauge agree: no flood signal right now.";
    }
    return { verdict, headline, detail, observed, forecast: forecastRows, source: src, live };
  }

  if (primary === "soil_ec") {
    const ec = aggregate(d.id, "soil_ec", last - 6 * H, last, now);
    const model = district?.ecCurrent ?? null;
    const moist = d.lastValues.soil_moisture ?? null;
    if (ec == null || model == null) return noData("Waiting for a few hours of salinity readings.");
    const r = ec / Math.max(0.1, model);
    const observed = [
      { label: "Measured EC (6 h mean)", value: f(ec, 2, " dS/m") },
      { label: "Soil moisture", value: f(moist, 1, " %") },
    ];
    const forecast = [{ label: "Modelled district EC", value: f(model, 1, " dS/m") }, { label: "Modelled EC in 30 days", value: f(district?.ecPredicted30d, 1, " dS/m") }];
    if (r > 1.5)
      return { verdict: "ahead", headline: "Field is saltier than the model", detail: `The probe reads ${r.toFixed(1)}× the modelled district salinity. Local salt intrusion (canal water, a breached dyke or tidal flooding) is stronger here than the regional model assumes — use the sensor value for this field.${ec > 3 ? " Above 3 dS/m rice starts losing yield." : ""}`, observed, forecast, source: src, live };
    if (r < 0.6)
      return { verdict: "disagrees", headline: "Field is fresher than the model", detail: `The probe reads ${Math.round(r * 100)} % of the modelled salinity — good news if the field is freshly irrigated or flushed by rain; if not, check the probe is in contact with the soil.`, observed, forecast, source: src, live };
    return { verdict: "confirms", headline: "Sensor confirms the salinity model", detail: `Measured salinity is within ${Math.round(Math.abs(r - 1) * 100)} % of the modelled value for ${district?.name}.`, observed, forecast, source: src, live };
  }

  if (primary === "rain_mm" || d.type === "weather_station") {
    const rain72obs = aggregate(d.id, "rain_mm", now - 72 * H, now, now);
    if (rain72obs == null) return noData("Waiting for rain-gauge data.");
    const observed = [
      { label: "Measured rain, last 72 h", value: f(rain72obs, 1, " mm") },
      { label: "Measured rain, last 24 h", value: f(aggregate(d.id, "rain_mm", now - DAY, now, now), 1, " mm") },
    ];
    const ref = rain72 ?? 0;
    const diff = rain72obs - ref;
    const agree = Math.abs(diff) <= Math.max(15, 0.4 * Math.max(ref, rain72obs));
    return agree
      ? { verdict: "confirms", headline: "Gauge agrees with the rain forecast", detail: `Measured ${rain72obs.toFixed(0)} mm vs ${ref.toFixed(0)} mm in the gridded product — parametric triggers based on the gridded data are well-founded here (low basis risk).`, observed, forecast: forecastRows, source: src, live }
      : diff > 0
        ? { verdict: "ahead", headline: "More rain on the ground than forecast", detail: `The gauge caught ${diff.toFixed(0)} mm more than the gridded data. Convective storms are often narrower than the model grid — this is basis risk for gridded parametric products.`, observed, forecast: forecastRows, source: src, live }
        : { verdict: "disagrees", headline: "Less rain on the ground than forecast", detail: `The gauge measured ${Math.abs(diff).toFixed(0)} mm less than the gridded data. If the funnel is clean this is real spatial variability; if not, clean the funnel and check the bucket.`, observed, forecast: forecastRows, source: src, live };
  }

  if (primary === "tide_level_m") {
    const day = querySeries(d.id, "tide_level_m", now - 25 * H, now, 100_000, now);
    if (day.length < 10) return noData("Waiting for a full tidal cycle (25 h).");
    const hi = Math.max(...day.map((p) => p.max ?? p.v));
    const lo = Math.min(...day.map((p) => p.min ?? p.v));
    const mean25 = day.reduce((a, p) => a + p.v, 0) / day.length;
    const week = aggregate(d.id, "tide_level_m", now - 7 * DAY, now - 25 * H, now);
    const setup = week != null ? mean25 - week : null;
    const sla = district?.seaLevelAnomalyM ?? null;
    const observed = [
      { label: "Tidal range (25 h)", value: f(hi - lo, 2, " m") },
      { label: "High water (25 h)", value: f(hi, 2, " m") },
      { label: "Mean-level set-up vs 7 days", value: setup == null ? "—" : `${setup >= 0 ? "+" : ""}${setup.toFixed(2)} m` },
    ];
    const forecast = [{ label: "Sea-level anomaly (Open-Meteo marine)", value: sla == null ? "not available" : `${sla >= 0 ? "+" : ""}${sla.toFixed(2)} m` }];
    if (setup != null && setup > 0.2)
      return { verdict: sla != null && sla > 0.1 ? "confirms" : "ahead", headline: "Storm surge / set-up detected", detail: `The 25-hour mean water level is ${setup.toFixed(2)} m above the previous week — wind-driven set-up on top of the astronomical tide. High tides will overtop low embankments sooner and push salt further inland.`, observed, forecast, source: src, live };
    return { verdict: "calm", headline: "Normal astronomical tide", detail: `Range ${(hi - lo).toFixed(2)} m with no surge component. Spring tides (around new and full moon) raise the range; plan sluice-gate operations around them.`, observed, forecast, source: src, live };
  }

  // piezometer
  const depthNow = aggregate(d.id, "groundwater_depth_m", now - DAY, now, now);
  const depthMonth = aggregate(d.id, "groundwater_depth_m", now - 30 * DAY, now - 23 * DAY, now);
  if (depthNow == null) return noData("Waiting for groundwater readings.");
  const trend = depthMonth != null ? depthNow - depthMonth : null;
  const observed = [
    { label: "Depth to water (24 h mean)", value: f(depthNow, 2, " m bgl") },
    { label: "Change vs 4 weeks ago", value: trend == null ? "—" : `${trend >= 0 ? "+" : ""}${trend.toFixed(2)} m` },
  ];
  const recharging = trend != null && trend < -0.05;
  return {
    verdict: recharging === (rain72 ?? 0) > 20 || trend == null ? "confirms" : "disagrees",
    headline: recharging ? "Aquifer recharging" : trend != null && trend > 0.15 ? "Water table falling" : "Water table stable",
    detail: recharging ? "The water table is rising after monsoon rain — consistent with the recent rainfall." : trend != null && trend > 0.15 ? "The water table is dropping — pumping exceeds recharge. In coastal aquifers this draws saline water inland; stagger pumping hours." : "No meaningful change over four weeks.",
    observed,
    forecast: forecastRows.slice(0, 1),
    source: src,
    live,
  };
}

// ─── Rule-engine bridge ──────────────────────────────────────────────────

export interface AssetSensorMetrics {
  assetId: string;
  water_level_m: number | null;
  /** rise over the last 6 h (m) — the flash-flood signal */
  water_level_rise_6h_m: number | null;
  soil_ec: number | null;
  soil_moisture: number | null;
  tide_level_m: number | null;
  rain_24h_mm: number | null;
  groundwater_depth_m: number | null;
  deviceIds: string[];
  at: Date;
}

/**
 * Latest ground-truth metrics per linked asset for a workspace. Only devices
 * that reported within the last 6 h count (stale data never fires a rule);
 * flat-lined or spiking sensors are excluded while the fault is active.
 */
export function latestSensorMetrics(orgId: string, now = Date.now()): Record<string, AssetSensorMetrics> {
  const out: Record<string, AssetSensorMetrics> = {};
  for (const d of orgDevices(orgId)) {
    if (!d.assetId || d.lastSeen == null || now - d.lastSeen > 6 * H) continue;
    // A fault stays "ongoing" until the sensor has reported cleanly for a while. Detection is
    // throttled (≤ 1 run / 45 s per device), so the logged fault can end a reading or two
    // before lastSeen — an exact match would briefly let a stuck value leak into rules.
    const faultGrace = Math.max(2 * d.intervalSec * 1000, 10 * 60_000);
    const faulty = new Set(deviceAnomalies(d.id, now - 2 * H).filter((a) => a.cls === "sensor_fault" && (a.kind === "flatline" || a.kind === "spike") && a.end >= d.lastSeen! - faultGrace).map((a) => a.metric));
    const cur = (out[d.assetId] ??= { assetId: d.assetId, water_level_m: null, water_level_rise_6h_m: null, soil_ec: null, soil_moisture: null, tide_level_m: null, rain_24h_mm: null, groundwater_depth_m: null, deviceIds: [], at: new Date(d.lastSeen) });
    cur.deviceIds.push(d.id);
    if (d.lastSeen > cur.at.getTime()) cur.at = new Date(d.lastSeen);
    const lv = d.lastValues;
    const take = (k: MetricKey, v: number | undefined) => (v != null && !faulty.has(k) ? Math.round(v * 1000) / 1000 : null);
    if (lv.water_level_m != null) {
      cur.water_level_m = take("water_level_m", lv.water_level_m);
      const before = aggregate(d.id, "water_level_m", d.lastSeen - 6.5 * H, d.lastSeen - 5.5 * H, now);
      cur.water_level_rise_6h_m = before != null && cur.water_level_m != null ? Math.round((cur.water_level_m - before) * 100) / 100 : null;
    }
    if (lv.soil_ec != null) cur.soil_ec = take("soil_ec", aggregate(d.id, "soil_ec", d.lastSeen - H, d.lastSeen, now) ?? lv.soil_ec);
    if (lv.soil_moisture != null) cur.soil_moisture = take("soil_moisture", lv.soil_moisture);
    if (lv.tide_level_m != null) cur.tide_level_m = take("tide_level_m", lv.tide_level_m);
    if (DEVICE_TYPES[d.type].metrics.includes("rain_mm")) {
      const r = aggregate(d.id, "rain_mm", now - DAY, now, now);
      if (r != null) cur.rain_24h_mm = Math.max(cur.rain_24h_mm ?? 0, Math.round(r * 10) / 10);
    }
    if (lv.groundwater_depth_m != null) cur.groundwater_depth_m = take("groundwater_depth_m", lv.groundwater_depth_m);
  }
  return out;
}

export function metricLabel(k: MetricKey) {
  return `${METRIC_META[k].label} (${METRIC_META[k].unit})`;
}

export function anomalyCounts(orgId: string, since: number) {
  let critical = 0;
  let warning = 0;
  let faults = 0;
  let events = 0;
  for (const d of orgDevices(orgId))
    for (const a of deviceAnomalies(d.id, since)) {
      if (a.ackedAt || a.kind === "gap" || a.severity === "info") continue;
      if (a.severity === "critical") critical++;
      else warning++;
      if (a.cls === "sensor_fault") faults++;
      else events++;
    }
  return { critical, warning, faults, events };
}

export { iot };
