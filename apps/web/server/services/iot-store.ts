/**
 * Sensors & IoT — device registry + in-memory time-series store.
 *
 * Per device:
 *   raw     sorted samples at native resolution for the last 48 h (≤ 4096)
 *   hourly  hourly aggregates (sum / n / min / max per metric) for 90 days
 *   seen    timestamp set for de-duplication
 * Reads ≤ 48 h come from `raw`, longer ranges from `hourly`; both are
 * bucketed down to `maxPoints` (mean + min/max envelope; rain is summed).
 *
 * Swap for TimescaleDB / InfluxDB in production: the public surface is
 * insertReading / querySeries / latest / countSince.
 */
import { createHash, randomBytes } from "node:crypto";
import { DEVICE_TYPES, METRIC_META, deviceStatus, type Anomaly, type DeviceStatus, type DeviceType, type MetricKey, type SeriesPoint } from "./iot-types";

export const RAW_WINDOW_MS = 48 * 3_600_000;
const RAW_CAP = 4096;
const HOURLY_RETENTION_MS = 90 * 86_400_000;
const HOUR = 3_600_000;

export interface DeviceRecord {
  id: string;
  orgId: string;
  name: string;
  type: DeviceType;
  lat: number;
  lon: number;
  assetId: string | null;
  districtId: string | null;
  installedAt: Date;
  firmware: string;
  intervalSec: number;
  /** sha256(device key) — the key itself is only ever shown once */
  keyHash: string;
  keyPrefix: string;
  keyRotatedAt: Date;
  /** LoRaWAN DevEUI (optional, checked on TTN uplinks) */
  devEui: string | null;
  /** water-level gauges: warning / danger stage in metres */
  thresholds: { warning: number | null; danger: number | null };
  notes: string | null;
  /** driven by the in-process simulator (demo fleet) */
  simulated: boolean;
  createdAt: Date;
  createdBy: string;
  lastSeen: number | null;
  lastValues: Partial<Record<MetricKey, number>>;
  counters: { received: number; duplicates: number; rejected: number; lastIngestVia: "simulator" | "rest" | "lorawan" | "mqtt" | null };
}

export interface Sample {
  t: number;
  v: Partial<Record<MetricKey, number>>;
}

interface Agg {
  t: number;
  sum: Partial<Record<MetricKey, number>>;
  n: Partial<Record<MetricKey, number>>;
  min: Partial<Record<MetricKey, number>>;
  max: Partial<Record<MetricKey, number>>;
}

interface Series {
  raw: Sample[];
  hourly: Agg[];
  seen: Set<number>;
}

interface IotState {
  devices: Map<string, DeviceRecord>;
  series: Map<string, Series>;
  anomalies: Map<string, Map<string, Anomaly & { ackedBy?: string | null; ackedAt?: Date | null; notified?: boolean }>>;
  seq: number;
}

const g = globalThis as unknown as { __agriIot?: IotState };
export const iot: IotState = (g.__agriIot ??= { devices: new Map(), series: new Map(), anomalies: new Map(), seq: 0 });

// ─── Keys ────────────────────────────────────────────────────────────────

const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function generateDeviceKey(): string {
  const bytes = randomBytes(32);
  let s = "dk_";
  for (let i = 0; i < 32; i++) s += B62[bytes[i]! % 62];
  return s;
}
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function deviceByKey(key: string | null): DeviceRecord | null {
  if (!key) return null;
  const h = hashKey(key);
  for (const d of iot.devices.values()) if (d.keyHash === h) return d;
  return null;
}

export function nextDeviceId(): string {
  iot.seq++;
  let id: string;
  do id = `dev_${randomBytes(5).toString("hex")}`;
  while (iot.devices.has(id));
  return id;
}

// ─── Registry ────────────────────────────────────────────────────────────

export function registerDevice(d: Omit<DeviceRecord, "keyHash" | "keyPrefix" | "keyRotatedAt" | "lastSeen" | "lastValues" | "counters">): { device: DeviceRecord; key: string } {
  const key = generateDeviceKey();
  const device: DeviceRecord = {
    ...d,
    keyHash: hashKey(key),
    keyPrefix: key.slice(0, 7),
    keyRotatedAt: new Date(),
    lastSeen: null,
    lastValues: {},
    counters: { received: 0, duplicates: 0, rejected: 0, lastIngestVia: null },
  };
  iot.devices.set(device.id, device);
  iot.series.set(device.id, { raw: [], hourly: [], seen: new Set() });
  return { device, key };
}

export function rotateDeviceKey(d: DeviceRecord): string {
  const key = generateDeviceKey();
  d.keyHash = hashKey(key);
  d.keyPrefix = key.slice(0, 7);
  d.keyRotatedAt = new Date();
  return key;
}

export function removeDevice(id: string) {
  iot.devices.delete(id);
  iot.series.delete(id);
  iot.anomalies.delete(id);
}

export function orgDevices(orgId: string): DeviceRecord[] {
  return [...iot.devices.values()].filter((d) => d.orgId === orgId);
}

export function statusOf(d: DeviceRecord, now = Date.now()): DeviceStatus {
  return deviceStatus(d.lastSeen, d.intervalSec, now);
}

// ─── Time series ─────────────────────────────────────────────────────────

function seriesOf(id: string): Series {
  let s = iot.series.get(id);
  if (!s) {
    s = { raw: [], hourly: [], seen: new Set() };
    iot.series.set(id, s);
  }
  return s;
}

function lowerBound<T extends { t: number }>(arr: T[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function rollup(s: Series, t: number, v: Partial<Record<MetricKey, number>>) {
  const ht = Math.floor(t / HOUR) * HOUR;
  const i = lowerBound(s.hourly, ht);
  let a = s.hourly[i];
  if (!a || a.t !== ht) {
    a = { t: ht, sum: {}, n: {}, min: {}, max: {} };
    s.hourly.splice(i, 0, a);
  }
  for (const [k, val] of Object.entries(v) as [MetricKey, number][]) {
    a.sum[k] = (a.sum[k] ?? 0) + val;
    a.n[k] = (a.n[k] ?? 0) + 1;
    a.min[k] = Math.min(a.min[k] ?? Infinity, val);
    a.max[k] = Math.max(a.max[k] ?? -Infinity, val);
  }
}

export type InsertResult = "accepted" | "duplicate";

/** Insert one normalised reading (dedupe on exact timestamp per device). */
export function insertReading(d: DeviceRecord, t: number, v: Partial<Record<MetricKey, number>>, now = Date.now()): InsertResult {
  const s = seriesOf(d.id);
  if (s.seen.has(t)) {
    d.counters.duplicates++;
    return "duplicate";
  }
  s.seen.add(t);
  if (t >= now - RAW_WINDOW_MS) {
    const last = s.raw[s.raw.length - 1];
    if (!last || last.t < t) s.raw.push({ t, v });
    else s.raw.splice(lowerBound(s.raw, t), 0, { t, v });
  }
  rollup(s, t, v);
  d.counters.received++;
  if (d.lastSeen == null || t >= d.lastSeen) {
    d.lastSeen = t;
    d.lastValues = { ...d.lastValues, ...v };
  }
  return "accepted";
}

/** Drop samples outside the retention windows (called periodically). */
export function trimSeries(now = Date.now()) {
  for (const s of iot.series.values()) {
    const rawStart = now - RAW_WINDOW_MS;
    let cut = lowerBound(s.raw, rawStart);
    if (s.raw.length - cut > RAW_CAP) cut = s.raw.length - RAW_CAP;
    if (cut > 0) s.raw.splice(0, cut);
    const hCut = lowerBound(s.hourly, now - HOURLY_RETENTION_MS);
    if (hCut > 0) s.hourly.splice(0, hCut);
    if (s.seen.size > 12_000) {
      const keep = now - 8 * 86_400_000;
      for (const t of s.seen) if (t < keep) s.seen.delete(t);
    }
  }
}

export function rawSamples(id: string, from = 0, to = Infinity): Sample[] {
  const s = iot.series.get(id);
  if (!s) return [];
  return s.raw.slice(lowerBound(s.raw, from), lowerBound(s.raw, to === Infinity ? Number.MAX_SAFE_INTEGER : to + 1));
}

export function lastSampleTime(id: string): number | null {
  const s = iot.series.get(id);
  if (!s) return null;
  const r = s.raw[s.raw.length - 1]?.t ?? null;
  const h = s.hourly[s.hourly.length - 1]?.t ?? null;
  return r ?? h;
}

export function countSince(id: string, from: number): number {
  const s = iot.series.get(id);
  if (!s) return 0;
  return s.raw.length - lowerBound(s.raw, from);
}

/** Metric series for [from, to], downsampled to ≤ maxPoints buckets. */
export function querySeries(id: string, metric: MetricKey, from: number, to: number, maxPoints = 300, now = Date.now()): SeriesPoint[] {
  const s = iot.series.get(id);
  if (!s) return [];
  const sum = METRIC_META[metric].agg === "sum";
  let pts: SeriesPoint[];
  if (from >= now - RAW_WINDOW_MS) {
    pts = [];
    for (let i = lowerBound(s.raw, from); i < s.raw.length && s.raw[i]!.t <= to; i++) {
      const v = s.raw[i]!.v[metric];
      if (v != null) pts.push({ t: s.raw[i]!.t, v });
    }
  } else {
    pts = [];
    for (let i = lowerBound(s.hourly, Math.floor(from / HOUR) * HOUR); i < s.hourly.length && s.hourly[i]!.t <= to; i++) {
      const a = s.hourly[i]!;
      const n = a.n[metric];
      if (!n) continue;
      pts.push({ t: a.t, v: sum ? a.sum[metric]! : a.sum[metric]! / n, min: a.min[metric], max: a.max[metric], n });
    }
  }
  if (pts.length <= maxPoints) return pts;
  // bucket downsample: mean (or sum) with min/max envelope
  const span = (to - from) / maxPoints;
  const out: SeriesPoint[] = [];
  let b: { t: number; sum: number; n: number; min: number; max: number } | null = null;
  const flush = () => {
    if (b) out.push({ t: b.t, v: sum ? b.sum : b.sum / b.n, min: b.min, max: b.max, n: b.n });
  };
  for (const p of pts) {
    const bt = from + Math.floor((p.t - from) / span) * span;
    if (!b || b.t !== bt) {
      flush();
      b = { t: bt, sum: 0, n: 0, min: Infinity, max: -Infinity };
    }
    b.sum += p.v;
    b.n++;
    b.min = Math.min(b.min, p.min ?? p.v);
    b.max = Math.max(b.max, p.max ?? p.v);
  }
  flush();
  return out.map((p) => ({ ...p, v: Math.round(p.v * 10_000) / 10_000 }));
}

/** Sum (rain) or mean of a metric over [from, to] using the best available tier. */
export function aggregate(id: string, metric: MetricKey, from: number, to: number, now = Date.now()): number | null {
  const pts = querySeries(id, metric, from, to, 100_000, now);
  if (!pts.length) return null;
  const sum = METRIC_META[metric].agg === "sum";
  const total = pts.reduce((a, p) => a + p.v * (sum ? 1 : p.n ?? 1), 0);
  const n = pts.reduce((a, p) => a + (p.n ?? 1), 0);
  return sum ? total : total / n;
}

export function primaryMetric(d: DeviceRecord): MetricKey {
  return DEVICE_TYPES[d.type].primary;
}

// ─── Anomaly log ─────────────────────────────────────────────────────────

export type LoggedAnomaly = Anomaly & { ackedBy?: string | null; ackedAt?: Date | null; notified?: boolean };

export function logAnomalies(deviceId: string, found: Anomaly[]): LoggedAnomaly[] {
  let m = iot.anomalies.get(deviceId);
  if (!m) {
    m = new Map();
    iot.anomalies.set(deviceId, m);
  }
  const fresh: LoggedAnomaly[] = [];
  for (const a of found) {
    const prev = m.get(a.id);
    if (prev) {
      // extend an ongoing event, keep ack / notified state
      Object.assign(prev, { ...a, ackedBy: prev.ackedBy, ackedAt: prev.ackedAt, notified: prev.notified });
    } else {
      const rec: LoggedAnomaly = { ...a, ackedBy: null, ackedAt: null, notified: false };
      m.set(a.id, rec);
      fresh.push(rec);
    }
  }
  if (m.size > 250) {
    const sorted = [...m.values()].sort((a, b) => b.end - a.end);
    for (const a of sorted.slice(250)) m.delete(a.id);
  }
  return fresh;
}

export function deviceAnomalies(deviceId: string, since = 0): LoggedAnomaly[] {
  return [...(iot.anomalies.get(deviceId)?.values() ?? [])].filter((a) => a.end >= since).sort((a, b) => b.end - a.end);
}
