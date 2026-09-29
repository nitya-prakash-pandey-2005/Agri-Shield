/**
 * Sensors & IoT — ingest contract (pure, unit-tested).
 *
 * REST  POST /api/v1/telemetry           X-Device-Key: dk_…   (or Authorization: Bearer dk_…)
 *   single:  { "ts": "2026-09-29T10:00:00Z", "values": { "water_level": { "value": 342, "unit": "cm" }, "battery": 3.9 } }
 *   flat:    { "ts": 1790000000, "water_level_cm": 342, "battery_v": 3.9 }
 *   batch:   { "readings": [ …up to 500 of the above… ] }   or a bare JSON array
 * LoRaWAN POST /api/v1/telemetry/lorawan  — The Things Stack v3 uplink webhook body;
 *   `uplink_message.decoded_payload` goes through the same normaliser, gateway RSSI/SNR are added.
 * MQTT (future broker)  agrishield/<orgId>/<deviceId>/up   payload = the REST body.
 *
 * Normalisation: alias → canonical metric, unit → canonical unit (see UNIT_RULES),
 * timestamps (ISO, epoch s or epoch ms) → epoch ms; range checks per METRIC_META.
 */
import { z } from "zod";
import { METRIC_META, type MetricKey } from "./iot-types";

// ─── Schemas ────────────────────────────────────────────────────────────

export const ReadingZ = z
  .object({
    ts: z.union([z.string().max(40), z.number()]).optional(),
    time: z.union([z.string().max(40), z.number()]).optional(),
    timestamp: z.union([z.string().max(40), z.number()]).optional(),
    device_id: z.string().max(80).optional(),
    values: z.record(z.string().max(48), z.unknown()).optional(),
    units: z.record(z.string().max(48), z.string().max(16)).optional(),
  })
  .catchall(z.unknown());

export type RawReading = z.infer<typeof ReadingZ>;

export interface NormalizedReading {
  t: number;
  values: Partial<Record<MetricKey, number>>;
  /** keys that were recognised but whose values/units were rejected */
  warnings: string[];
}

export type NormalizeResult = { ok: true; reading: NormalizedReading } | { ok: false; reason: string };

// ─── Aliases & units ────────────────────────────────────────────────────

/** alias (lower-case, no unit suffix) → canonical metric */
const ALIASES: Record<string, MetricKey> = {
  water_level: "water_level_m", level: "water_level_m", stage: "water_level_m", river_level: "water_level_m", wl: "water_level_m", gauge_height: "water_level_m",
  tide: "tide_level_m", tide_level: "tide_level_m", sea_level: "tide_level_m",
  soil_ec: "soil_ec", ec: "soil_ec", conductivity: "soil_ec", salinity_ec: "soil_ec", ec_bulk: "soil_ec", soil_conductivity: "soil_ec", conduct_soil: "soil_ec",
  soil_moisture: "soil_moisture", moisture: "soil_moisture", vwc: "soil_moisture", water_soil: "soil_moisture", soil_water: "soil_moisture",
  soil_temp: "soil_temp_c", soil_temperature: "soil_temp_c", temp_soil: "soil_temp_c",
  rain: "rain_mm", rainfall: "rain_mm", precipitation: "rain_mm", precip: "rain_mm",
  air_temp: "air_temp_c", temperature: "air_temp_c", temp: "air_temp_c", tempc_sht: "air_temp_c",
  humidity: "humidity_pct", rh: "humidity_pct", relative_humidity: "humidity_pct", hum_sht: "humidity_pct",
  wind: "wind_ms", wind_speed: "wind_ms", windspeed: "wind_ms",
  pressure: "pressure_hpa", barometric_pressure: "pressure_hpa", baro: "pressure_hpa",
  groundwater_depth: "groundwater_depth_m", depth_to_water: "groundwater_depth_m", gw_depth: "groundwater_depth_m", water_table_depth: "groundwater_depth_m",
  battery: "battery_pct", bat: "battery_pct", batv: "battery_pct", battery_level: "battery_pct", battery_voltage: "battery_pct", vbat: "battery_pct",
  rssi: "rssi_dbm", snr: "snr_db",
};

/** Default unit when none is given (canonical, except where devices usually send something else) */
const DEFAULT_UNIT: Partial<Record<MetricKey, string>> = {};

type Conv = (v: number) => number;
/** canonical metric → accepted unit spellings → converter to canonical */
const UNIT_RULES: Record<MetricKey, Record<string, Conv>> = {
  water_level_m: { m: (v) => v, cm: (v) => v / 100, mm: (v) => v / 1000, ft: (v) => v * 0.3048, in: (v) => v * 0.0254 },
  tide_level_m: { m: (v) => v, cm: (v) => v / 100, mm: (v) => v / 1000, ft: (v) => v * 0.3048 },
  groundwater_depth_m: { m: (v) => v, cm: (v) => v / 100, mm: (v) => v / 1000, ft: (v) => v * 0.3048 },
  soil_ec: { "ds/m": (v) => v, "ms/cm": (v) => v, "us/cm": (v) => v / 1000, "µs/cm": (v) => v / 1000, "s/m": (v) => v * 10, "ms/m": (v) => v / 100 },
  soil_moisture: { "%": (v) => v, pct: (v) => v, "%vwc": (v) => v, vwc: (v) => v, "m3/m3": (v) => v * 100, fraction: (v) => v * 100 },
  soil_temp_c: { c: (v) => v, "°c": (v) => v, degc: (v) => v, f: (v) => ((v - 32) * 5) / 9, "°f": (v) => ((v - 32) * 5) / 9, k: (v) => v - 273.15 },
  air_temp_c: { c: (v) => v, "°c": (v) => v, degc: (v) => v, f: (v) => ((v - 32) * 5) / 9, "°f": (v) => ((v - 32) * 5) / 9, k: (v) => v - 273.15 },
  rain_mm: { mm: (v) => v, cm: (v) => v * 10, in: (v) => v * 25.4, tips: (v) => v * 0.2 },
  humidity_pct: { "%": (v) => v, pct: (v) => v, fraction: (v) => v * 100 },
  wind_ms: { "m/s": (v) => v, ms: (v) => v, "km/h": (v) => v / 3.6, kmh: (v) => v / 3.6, kph: (v) => v / 3.6, mph: (v) => v * 0.44704, kn: (v) => v * 0.514444, kt: (v) => v * 0.514444, knots: (v) => v * 0.514444 },
  pressure_hpa: { hpa: (v) => v, mbar: (v) => v, mb: (v) => v, kpa: (v) => v * 10, pa: (v) => v / 100, inhg: (v) => v * 33.8639 },
  battery_pct: { "%": (v) => v, pct: (v) => v, v: (v) => liIonPct(v), mv: (v) => liIonPct(v / 1000) },
  rssi_dbm: { dbm: (v) => v },
  snr_db: { db: (v) => v },
};

/**
 * Battery voltage → %. Ambiguous by nature, so two chemistries are assumed:
 *   ≤ 3.65 V  primary lithium (Li-SOCl₂, 3.6 V nominal, e.g. Dragino/Milesight): 3.0 V empty … 3.6 V full
 *   > 3.65 V  rechargeable Li-ion / LiPo: 3.0 V empty … 4.2 V full
 */
export function liIonPct(volts: number): number {
  const pct = volts <= 3.65 ? ((volts - 3.0) / 0.6) * 100 : ((volts - 3.0) / 1.2) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

/** Unit suffixes allowed on flat keys, e.g. water_level_cm, soil_ec_us_cm, battery_v */
const SUFFIX_UNITS: [string, string][] = [
  ["_us_cm", "us/cm"], ["_ms_cm", "ms/cm"], ["_ds_m", "ds/m"], ["_ms_m", "ms/m"], ["_s_m", "s/m"],
  ["_m3m3", "m3/m3"], ["_pct", "%"], ["_percent", "%"], ["_vwc", "%"],
  ["_hpa", "hpa"], ["_kpa", "kpa"], ["_pa", "pa"], ["_mbar", "mbar"],
  ["_kmh", "km/h"], ["_mph", "mph"], ["_kn", "kn"], ["_ms", "m/s"],
  ["_mm", "mm"], ["_cm", "cm"], ["_ft", "ft"], ["_in", "in"], ["_m", "m"],
  ["_degc", "c"], ["_c", "c"], ["_f", "f"], ["_k", "k"],
  ["_mv", "mv"], ["_v", "v"], ["_dbm", "dbm"], ["_db", "db"], ["_tips", "tips"],
];

/** Resolve a payload key (with optional unit suffix) to a canonical metric + unit. */
export function resolveKey(rawKey: string): { metric: MetricKey; unit: string | null } | null {
  const key = rawKey.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((METRIC_META as Record<string, unknown>)[key]) {
    // canonical key → canonical unit implied
    return { metric: key as MetricKey, unit: null };
  }
  if (ALIASES[key]) return { metric: ALIASES[key]!, unit: key === "batv" || key === "battery_voltage" || key === "vbat" ? "v" : null };
  for (const [suf, unit] of SUFFIX_UNITS) {
    if (key.endsWith(suf)) {
      const base = key.slice(0, -suf.length);
      const metric = ALIASES[base] ?? ((METRIC_META as Record<string, unknown>)[base] ? (base as MetricKey) : null);
      if (metric) return { metric, unit };
    }
  }
  return null;
}

export function convertUnit(metric: MetricKey, value: number, unit: string | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  const u = (unit ?? DEFAULT_UNIT[metric] ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!u) return value;
  const conv = UNIT_RULES[metric][u];
  return conv ? conv(value) : null;
}

/** ISO string, epoch seconds or epoch milliseconds → epoch ms. */
export function parseTs(ts: unknown, now = Date.now()): number | null {
  if (ts == null) return now;
  if (typeof ts === "number") {
    if (!Number.isFinite(ts)) return null;
    return ts < 1e11 ? Math.round(ts * 1000) : Math.round(ts);
  }
  if (typeof ts === "string") {
    if (/^\d+(\.\d+)?$/.test(ts)) return parseTs(Number(ts), now);
    const t = Date.parse(ts);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

const RESERVED = new Set(["ts", "time", "timestamp", "device_id", "values", "units", "dev_eui", "seq", "fcnt"]);

export const MAX_FUTURE_MS = 5 * 60_000;
export const MAX_AGE_MS = 7 * 86_400_000;

/** Validate + normalise one reading. */
export function normalizeReading(raw: unknown, now = Date.now()): NormalizeResult {
  const parsed = ReadingZ.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "reading must be a JSON object" };
  const r = parsed.data;
  const t = parseTs(r.ts ?? r.time ?? r.timestamp, now);
  if (t == null) return { ok: false, reason: "unparseable timestamp (use ISO-8601, epoch seconds or epoch ms)" };
  if (t > now + MAX_FUTURE_MS) return { ok: false, reason: "timestamp is in the future (clock drift > 5 min?)" };
  if (t < now - MAX_AGE_MS) return { ok: false, reason: "timestamp older than 7 days" };

  const entries: [string, unknown, string | undefined][] = [];
  for (const [k, v] of Object.entries(r.values ?? {})) entries.push([k, v, r.units?.[k]]);
  for (const [k, v] of Object.entries(r)) if (!RESERVED.has(k)) entries.push([k, v, r.units?.[k]]);

  const values: Partial<Record<MetricKey, number>> = {};
  const warnings: string[] = [];
  for (const [k, v, explicitUnit] of entries) {
    const res = resolveKey(k);
    if (!res) {
      warnings.push(`${k}: unknown metric (ignored)`);
      continue;
    }
    let num: number;
    let unit = explicitUnit ?? res.unit;
    if (typeof v === "number") num = v;
    else if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) num = Number(v);
    else if (v && typeof v === "object" && "value" in v) {
      num = Number((v as { value: unknown }).value);
      unit = (v as { unit?: string }).unit ?? unit;
    } else {
      warnings.push(`${k}: value must be a number`);
      continue;
    }
    const c = convertUnit(res.metric, num, unit);
    if (c == null) {
      warnings.push(`${k}: unsupported unit "${unit}" for ${res.metric}`);
      continue;
    }
    const m = METRIC_META[res.metric];
    if (c < m.min || c > m.max) {
      warnings.push(`${k}: ${c} ${m.unit} outside plausible range ${m.min}…${m.max}`);
      continue;
    }
    values[res.metric] = Math.round(c * 10_000) / 10_000;
  }
  if (!Object.keys(values).length) return { ok: false, reason: warnings.length ? `no valid metrics (${warnings.join("; ")})` : "no metrics in reading" };
  return { ok: true, reading: { t, values, warnings } };
}

/** Split a request body into raw readings (single, { readings: [] } or bare array). */
export const MAX_BATCH = 500;

export function splitBody(body: unknown): { ok: true; readings: unknown[]; deviceId: string | null } | { ok: false; reason: string } {
  const check = (arr: unknown[], deviceId: string | null) =>
    arr.length === 0 ? ({ ok: false, reason: "empty batch" } as const) : arr.length > MAX_BATCH ? ({ ok: false, reason: `batch larger than ${MAX_BATCH} readings` } as const) : ({ ok: true, readings: arr, deviceId } as const);
  if (Array.isArray(body)) return check(body, null);
  if (!body || typeof body !== "object") return { ok: false, reason: "body must be a reading object, { readings: [...] } (≤ 500) or an array" };
  const b = body as Record<string, unknown>;
  const deviceId = typeof b.device_id === "string" ? b.device_id.slice(0, 80) : null;
  if ("readings" in b) return Array.isArray(b.readings) ? check(b.readings, deviceId) : { ok: false, reason: "readings must be an array" };
  return { ok: true, readings: [b], deviceId };
}

// ─── The Things Stack (TTN v3) uplink ───────────────────────────────────

export const TtnUplinkZ = z.object({
  end_device_ids: z.object({
    device_id: z.string().max(64),
    dev_eui: z.string().max(32).optional(),
    application_ids: z.object({ application_id: z.string().max(64) }).partial().optional(),
  }),
  received_at: z.string().max(40).optional(),
  uplink_message: z.object({
    f_port: z.number().int().optional(),
    f_cnt: z.number().int().optional(),
    frm_payload: z.string().max(512).optional(),
    decoded_payload: z.record(z.string(), z.unknown()).optional(),
    rx_metadata: z.array(z.object({ rssi: z.number().optional(), channel_rssi: z.number().optional(), snr: z.number().optional(), gateway_ids: z.object({ gateway_id: z.string() }).partial().optional() }).passthrough()).optional(),
    received_at: z.string().max(40).optional(),
    settings: z.object({ time: z.string().optional() }).passthrough().optional(),
  }),
});
export type TtnUplink = z.infer<typeof TtnUplinkZ>;

/**
 * Map a TTN uplink to a raw reading for normalizeReading(): decoded_payload
 * keys pass through the alias/unit resolver; the strongest gateway's RSSI/SNR
 * are attached; the timestamp is the network's received_at.
 */
export function mapTtnUplink(body: unknown): { ok: true; reading: Record<string, unknown>; ttnDeviceId: string; devEui: string | null; gateways: number; fCnt: number | null } | { ok: false; reason: string } {
  const p = TtnUplinkZ.safeParse(body);
  if (!p.success) return { ok: false, reason: "not a The Things Stack uplink (end_device_ids + uplink_message required)" };
  const u = p.data;
  const dp = u.uplink_message.decoded_payload;
  if (!dp || !Object.keys(dp).length) return { ok: false, reason: "uplink has no decoded_payload — add a payload formatter (uplink decoder) in The Things Stack console" };
  const reading: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dp)) {
    // Common decoder shapes: { water_level: 1.23 } or { water_level: { value, unit } }; skip nested non-metric objects
    if (typeof v === "number" || typeof v === "string" || (v && typeof v === "object" && "value" in (v as object))) reading[k] = v;
  }
  const rx = u.uplink_message.rx_metadata ?? [];
  const best = rx.reduce<{ rssi?: number; snr?: number } | null>((b, g) => {
    const rssi = g.rssi ?? g.channel_rssi;
    return rssi != null && (!b || (b.rssi ?? -999) < rssi) ? { rssi, snr: g.snr } : b;
  }, null);
  if (best?.rssi != null && reading.rssi == null) reading.rssi = best.rssi;
  if (best?.snr != null && reading.snr == null) reading.snr = best.snr;
  reading.ts = u.received_at ?? u.uplink_message.received_at ?? u.uplink_message.settings?.time ?? undefined;
  return { ok: true, reading, ttnDeviceId: u.end_device_ids.device_id, devEui: u.end_device_ids.dev_eui?.toUpperCase() ?? null, gateways: rx.length, fCnt: u.uplink_message.f_cnt ?? null };
}

// ─── Device keys ────────────────────────────────────────────────────────

export const DEVICE_KEY_RE = /^dk_[A-Za-z0-9]{32}$/;

/** Extract the device key from X-Device-Key or Authorization: Bearer dk_… */
export function deviceKeyFrom(headers: Headers): string | null {
  const direct = headers.get("x-device-key")?.trim();
  if (direct) return direct;
  const bearer = headers.get("authorization")?.match(/^Bearer\s+(dk_\S+)$/i)?.[1];
  return bearer ?? null;
}

export const MQTT_TOPICS = {
  up: "agrishield/{orgId}/{deviceId}/up",
  status: "agrishield/{orgId}/{deviceId}/status",
  down: "agrishield/{orgId}/{deviceId}/down",
} as const;
