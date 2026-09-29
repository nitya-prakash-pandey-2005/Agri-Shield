/**
 * Sensors & IoT — orchestration.
 *
 *   ensureIot()            lazy boot: seed the demo fleet (30-day backfill) once,
 *                          then catch every simulated device up to "now"
 *                          (so charts are current even with DISABLE_SCHEDULER=true)
 *   startSimulatorLoop()   60 s in-process tick (skipped when DISABLE_SCHEDULER=true)
 *   ingest(device, raw[])  shared by REST, LoRaWAN and (future) MQTT paths
 *
 * Every new reading batch publishes `sensors.readings` on `ws:<orgId>` (the UI
 * pulses the map pin), and new critical anomalies raise a workspace
 * notification + `sensor.anomaly` realtime event.
 */
import { getStore, audit } from "../data/store";
import { publish, type RealtimeEvent } from "../realtime";
import { notifyWorkspace } from "./workspace-notifications";
import { normalizeReading, type NormalizedReading } from "./iot-ingest";
import { districtOf, isCoastal, runDetection } from "./iot-analytics";
import { DEVICE_TYPES, METRIC_META, type Anomaly, type DeviceType } from "./iot-types";
import { FLEET, driversFrom, makeProfile, offsetNear, registerScenarioBursts, riverThresholds, sim, stepDevice } from "./iot-simulator";
import { hash01, hashStr } from "./iot-physics";
import { RAW_WINDOW_MS, insertReading, iot, registerDevice, trimSeries, type DeviceRecord, type LoggedAnomaly } from "./iot-store";

const H = 3_600_000;
const DAY = 86_400_000;
const BACKFILL_DAYS = 30;

interface Runtime {
  seeded: boolean;
  seeding: boolean;
  loop: ReturnType<typeof setInterval> | null;
  lastCatchUp: number;
  lastDetect: Map<string, number>;
  lastNotify: Map<string, number>;
  ticks: number;
  lastTickAt: number | null;
}
const g = globalThis as unknown as { __agriIotRt?: Runtime };
const rt: Runtime = (g.__agriIotRt ??= { seeded: false, seeding: false, loop: null, lastCatchUp: 0, lastDetect: new Map(), lastNotify: new Map(), ticks: 0, lastTickAt: null });

export const schedulerDisabled = () => process.env.DISABLE_SCHEDULER === "true";

const pub = (room: string, event: Record<string, unknown>) => publish(room, event as unknown as RealtimeEvent);

// ─── Seed ────────────────────────────────────────────────────────────────

const FIRMWARE_OLD: Record<DeviceType, string> = { river_gauge: "2.3.0", soil_probe: "1.8.2", tide_gauge: "3.1.2", rain_gauge: "1.6.4", weather_station: "3.9.1", piezometer: "1.2.7" };

function seedFleet(now: number) {
  const s = getStore();
  sim.t0 = now;
  const usedAssets = new Set<string>();
  const perOrgIdx = new Map<string, number>();
  for (const spec of FLEET) {
    const pool = s.assets.filter((a) => a.workspaceId === spec.org && a.status === "active" && (spec.district ? a.districtId === spec.district : a.type === spec.facility));
    const candidates = pool.filter((a) => !usedAssets.has(a.id));
    const list = candidates.length ? candidates : pool;
    if (!list.length) continue;
    const asset = list[hashStr(spec.name + spec.org) % list.length]!;
    usedAssets.add(asset.id);
    const idx = (perOrgIdx.get(spec.org) ?? 0) + 1;
    perOrgIdx.set(spec.org, idx);
    const id = `dev_${spec.org.replace(/^org-/, "").slice(0, 8).replace(/-/g, "")}_${idx.toString().padStart(2, "0")}`;
    if (iot.devices.has(id)) continue;
    const seed = hashStr(id);
    const [lat, lon] = offsetNear(asset.lat, asset.lon, seed);
    const district = districtOf({ districtId: asset.districtId, lat, lon });
    const meta = DEVICE_TYPES[spec.type];
    const name = spec.facility ? `${spec.name} · ${asset.name}` : spec.name;
    const coastal = isCoastal(district);
    const { device } = registerDevice({
      id,
      orgId: spec.org,
      name,
      type: spec.type,
      lat,
      lon,
      assetId: asset.id,
      districtId: district?.id ?? null,
      installedAt: new Date(now - (BACKFILL_DAYS + 20 + Math.floor(hash01(seed, 3) * 400)) * DAY),
      firmware: hash01(seed, 4) < 0.3 ? FIRMWARE_OLD[spec.type] : meta.latestFirmware,
      intervalSec: meta.intervalSec,
      devEui: meta.connectivity === "LoRaWAN" ? `70B3D57ED00${(seed % 0xfffff).toString(16).toUpperCase().padStart(5, "0")}` : null,
      thresholds: spec.type === "river_gauge" ? riverThresholds(district?.id ?? null, coastal) : { warning: null, danger: null },
      notes: null,
      simulated: true,
      createdAt: new Date(now - (BACKFILL_DAYS + 10) * DAY),
      createdBy: "provisioning",
    });
    device.keyRotatedAt = device.installedAt;
    const p = makeProfile(device, district, now, spec.scenario ?? null);
    sim.profiles.set(device.id, p);
    registerScenarioBursts(p);
  }
  // 30-day backfill: 15-min steps until the raw window, native interval after
  for (const d of iot.devices.values()) {
    const p = sim.profiles.get(d.id);
    if (!p) continue;
    p.state.t = now - BACKFILL_DAYS * DAY - 15 * 60_000;
    advance(d, now, now);
  }
}

/** Generate the simulated device's samples from its last state time up to `until`. */
function advance(d: DeviceRecord, until: number, now: number): number {
  const p = sim.profiles.get(d.id);
  if (!p) return 0;
  const step = d.intervalSec * 1000;
  let n = 0;
  let t = p.state.t || until - step;
  while (true) {
    const coarse = t < now - RAW_WINDOW_MS - H;
    const dt = coarse ? Math.max(step, 15 * 60_000) : step;
    const next = Math.floor((t + dt) / dt) * dt; // aligned timestamps
    if (next > until) break;
    const v = stepDevice(p, next);
    if (v) {
      insertReading(d, next, v, now);
      d.counters.lastIngestVia = "simulator";
      n++;
    }
    t = next;
  }
  return n;
}

// ─── Detection + notifications ───────────────────────────────────────────

function notifyNew(d: DeviceRecord, fresh: LoggedAnomaly[], now: number) {
  for (const a of fresh) {
    if (a.kind === "gap" || a.severity === "info") continue;
    pub(`ws:${d.orgId}`, { type: "sensor.anomaly", deviceId: d.id, anomalyId: a.id, severity: a.severity, title: a.title, cls: a.cls });
    if (a.severity !== "critical" || a.cls === "sensor_fault" || a.end < now - 24 * H) {
      a.notified = true;
      continue;
    }
    const key = `${d.id}:${a.kind}`;
    if ((rt.lastNotify.get(key) ?? 0) > now - 6 * H) {
      a.notified = true;
      continue;
    }
    rt.lastNotify.set(key, now);
    a.notified = true;
    notifyWorkspace({
      workspaceId: d.orgId,
      kind: "alert",
      severity: "critical",
      title: `${d.name}: ${a.title}`,
      body: a.explanation,
      href: `/app/sensors/${d.id}`,
      email: false,
    });
  }
}

export function detectFor(d: DeviceRecord, now = Date.now(), force = false): LoggedAnomaly[] {
  if (!force && (rt.lastDetect.get(d.id) ?? 0) > now - 45_000) return [];
  rt.lastDetect.set(d.id, now);
  const fresh = runDetection(d, now);
  notifyNew(d, fresh, now);
  return fresh;
}

// ─── Catch-up / loop ─────────────────────────────────────────────────────

function refreshDrivers() {
  for (const d of iot.devices.values()) {
    const p = sim.profiles.get(d.id);
    if (p) p.drivers = { ...driversFrom(districtOf(d)), ecNow: p.drivers.ecNow };
  }
}

/** Advance every simulated device to now; publish + detect for devices with new data. */
export function catchUp(now = Date.now(), opts: { publish?: boolean } = {}) {
  rt.lastCatchUp = now;
  if (rt.ticks % 10 === 0) refreshDrivers();
  rt.ticks++;
  rt.lastTickAt = now;
  const byOrg = new Map<string, { id: string; primary: number | null }[]>();
  for (const d of iot.devices.values()) {
    if (!d.simulated) continue;
    const n = advance(d, now, now);
    if (!n) continue;
    detectFor(d, now);
    const list = byOrg.get(d.orgId) ?? [];
    list.push({ id: d.id, primary: d.lastValues[DEVICE_TYPES[d.type].primary] ?? null });
    byOrg.set(d.orgId, list);
  }
  if (opts.publish !== false) for (const [orgId, devices] of byOrg) pub(`ws:${orgId}`, { type: "sensors.readings", orgId, devices, at: new Date(now).toISOString(), via: "simulator" });
  if (rt.ticks % 30 === 0) trimSeries(now);
}

export function startSimulatorLoop() {
  if (rt.loop || schedulerDisabled()) return;
  rt.loop = setInterval(() => {
    try {
      catchUp(Date.now());
    } catch (e) {
      console.warn("[iot] simulator tick failed", e);
    }
  }, 60_000);
  (rt.loop as { unref?: () => void }).unref?.();
}

/**
 * Lazy boot + freshness. Cheap to call on every sensors query: seeds once,
 * then catches up at most every 20 s (the loop does it every 60 s anyway).
 */
export function ensureIot(now = Date.now()) {
  if (!rt.seeded && !rt.seeding) {
    rt.seeding = true;
    try {
      seedFleet(now);
      for (const d of iot.devices.values()) detectFor(d, now, true);
      rt.seeded = true;
    } finally {
      rt.seeding = false;
    }
  }
  if (now - rt.lastCatchUp > 20_000) catchUp(now);
  startSimulatorLoop();
}

/** True once the device fleet has been seeded (by the scheduler at boot or a sensors query). */
export const iotReady = () => rt.seeded;

export function simulatorState() {
  return {
    seeded: rt.seeded,
    loopRunning: !!rt.loop,
    schedulerDisabled: schedulerDisabled(),
    mode: rt.loop ? "live-tick-60s" : "backfill-on-read",
    lastTickAt: rt.lastTickAt ? new Date(rt.lastTickAt) : null,
    devices: iot.devices.size,
    simulated: [...iot.devices.values()].filter((d) => d.simulated).length,
  };
}

// ─── Ingest (REST / LoRaWAN / MQTT) ──────────────────────────────────────

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: { index: number; reason: string }[];
  warnings: { index: number; warning: string }[];
  lastTs: string | null;
  anomalies: Pick<Anomaly, "kind" | "cls" | "severity" | "title">[];
}

export function ingest(d: DeviceRecord, raws: unknown[], via: "rest" | "lorawan" | "mqtt", now = Date.now()): IngestResult {
  const res: IngestResult = { accepted: 0, duplicates: 0, rejected: [], warnings: [], lastTs: null, anomalies: [] };
  const ok: NormalizedReading[] = [];
  raws.forEach((raw, index) => {
    const r = normalizeReading(raw, now);
    if (!r.ok) {
      res.rejected.push({ index, reason: r.reason });
      d.counters.rejected++;
      return;
    }
    for (const w of r.reading.warnings) res.warnings.push({ index, warning: w });
    ok.push(r.reading);
  });
  ok.sort((a, b) => a.t - b.t);
  for (const r of ok) {
    // only keep metrics that belong to this device type (plus radio/battery)
    const allowed = new Set(DEVICE_TYPES[d.type].metrics);
    const values = Object.fromEntries(Object.entries(r.values).filter(([k]) => allowed.has(k as never) || k === "battery_pct" || k === "rssi_dbm" || k === "snr_db"));
    const dropped = Object.keys(r.values).filter((k) => !(k in values));
    if (dropped.length) res.warnings.push({ index: -1, warning: `${dropped.join(", ")} not measured by a ${DEVICE_TYPES[d.type].short} — ignored` });
    if (!Object.keys(values).length) {
      res.rejected.push({ index: -1, reason: `no metrics valid for a ${DEVICE_TYPES[d.type].short} (expects ${DEVICE_TYPES[d.type].metrics.map((m) => METRIC_META[m].short).join(", ")})` });
      continue;
    }
    if (insertReading(d, r.t, values, now) === "accepted") {
      res.accepted++;
      res.lastTs = new Date(r.t).toISOString();
    } else res.duplicates++;
  }
  if (res.accepted) {
    d.counters.lastIngestVia = via;
    const fresh = detectFor(d, now, res.accepted >= 5);
    res.anomalies = fresh.filter((a) => a.kind !== "gap").map((a) => ({ kind: a.kind, cls: a.cls, severity: a.severity, title: a.title }));
    pub(`ws:${d.orgId}`, { type: "sensors.readings", orgId: d.orgId, devices: [{ id: d.id, primary: d.lastValues[DEVICE_TYPES[d.type].primary] ?? null }], at: new Date(now).toISOString(), via });
    if (d.counters.received === res.accepted) audit({ userId: `device:${d.id}`, userName: d.name, action: "sensor.first_reading", entity: "device", entityId: d.id, details: `First reading via ${via}` });
  }
  return res;
}
