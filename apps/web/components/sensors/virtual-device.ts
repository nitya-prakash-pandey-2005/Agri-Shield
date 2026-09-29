"use client";

/**
 * Browser "virtual device": posts physically plausible readings to the REAL
 * ingest endpoint (POST /api/v1/telemetry with the device key) every few
 * seconds, so a buyer can watch ingestion, normalisation, dedupe and anomaly
 * detection work end-to-end. One virtual device runs at a time and keeps
 * streaming while the user navigates inside the app.
 *
 * Payloads deliberately use the device-friendly shapes a real sensor would send
 * (unit suffixes, battery volts) so the normaliser is exercised too.
 */
import { useSyncExternalStore } from "react";
import type { DeviceType } from "@/server/services/iot-types";

export interface VirtualLog {
  at: number;
  status: number | null;
  payload: string;
  reply: string;
  ok: boolean;
}

export type VirtualEvent = "flood" | "glitch" | "storm";

export const EVENTS_FOR: Record<DeviceType, { event: VirtualEvent; label: string; expect: string }[]> = {
  river_gauge: [{ event: "flood", label: "Send a flood pulse", expect: "Water rises ~1.3 m in under a minute → the detector raises a critical “rapid rise” and a workspace notification (classified “check device”, because no rain gauge nearby explains it)." }],
  tide_gauge: [{ event: "storm", label: "Add a storm surge", expect: "+0.6 m on top of the tide — watch the level jump on the chart." }],
  soil_probe: [{ event: "glitch", label: "Simulate a probe glitch", expect: "One impossible 35 dS/m reading → classified as a sensor fault (spike) and kept out of alerts." }],
  rain_gauge: [{ event: "storm", label: "Start a downpour", expect: "Bursts of 2-4 mm per packet — the gauge total and forecast comparison update." }],
  weather_station: [{ event: "storm", label: "Start a storm", expect: "Rain, gusts, humidity up, pressure down." }],
  piezometer: [{ event: "glitch", label: "Simulate a logger glitch", expect: "One impossible reading → classified as a sensor fault." }],
};

interface VState {
  running: boolean;
  deviceId: string | null;
  deviceName: string | null;
  type: DeviceType | null;
  sent: number;
  accepted: number;
  failed: number;
  log: VirtualLog[];
  event: VirtualEvent | null;
  eventLeft: number;
}

let state: VState = { running: false, deviceId: null, deviceName: null, type: null, sent: 0, accepted: 0, failed: 0, log: [], event: null, eventLeft: 0 };
let timer: ReturnType<typeof setInterval> | null = null;
let key: string | null = null;
let phys = { level: 2.4, ec: 2.2, moisture: 28, tide: 0, temp: 30.5, gw: 4.2, battery: 3.95, t0: Date.now() };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (p: Partial<VState>) => {
  state = { ...state, ...p };
  emit();
};

const jitter = (a: number) => (Math.random() - 0.5) * 2 * a;
const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function nextPayload(type: DeviceType): Record<string, number | string> {
  const hours = (Date.now() - phys.t0) / 3_600_000;
  const ev = state.event;
  phys.battery = Math.max(3.3, phys.battery - 0.0004);
  const ts = new Date().toISOString();
  switch (type) {
    case "river_gauge":
      phys.level += ev === "flood" ? 0.11 + jitter(0.01) : (2.4 - phys.level) * 0.03 + jitter(0.004);
      return { ts, water_level_cm: r(phys.level * 100, 1), battery_v: r(phys.battery, 2), rssi: Math.round(-92 + jitter(4)) };
    case "tide_gauge":
      phys.tide = 1.1 * Math.cos((2 * Math.PI * hours * 60) / 12.42) + (ev === "storm" ? 0.6 : 0) + jitter(0.01); // accelerated ×60 so the demo shows a tide
      return { ts, tide_level_m: r(phys.tide, 3), battery: 92 };
    case "soil_probe":
      phys.ec += (2.2 - phys.ec) * 0.04 + jitter(0.02);
      phys.moisture += (28 - phys.moisture) * 0.03 + jitter(0.15);
      return { ts, soil_ec_us_cm: Math.round((ev === "glitch" && state.eventLeft === 12 ? 35 : phys.ec) * 1000), soil_moisture: r(phys.moisture / 100, 3), soil_temp_c: r(29 + jitter(0.2), 1), battery_v: r(phys.battery, 2), units: JSON.stringify({ soil_moisture: "m3/m3" }) };
    case "rain_gauge":
      return { ts, rain_tips: ev === "storm" ? Math.round(8 + Math.random() * 10) : Math.random() < 0.15 ? 1 : 0, battery_v: r(phys.battery, 2) };
    case "weather_station":
      phys.temp += (30.5 - phys.temp) * 0.05 + jitter(0.1) - (ev === "storm" ? 0.2 : 0);
      return { ts, temperature: r(phys.temp, 1), humidity: Math.round(ev === "storm" ? 96 : 76 + jitter(2)), rain_mm: ev === "storm" ? r(2 + Math.random() * 3, 1) : 0, wind_kmh: r((ev === "storm" ? 45 : 11) + jitter(3), 1), pressure_hpa: r((ev === "storm" ? 998 : 1007) + jitter(0.2), 1), battery: 90 };
    case "piezometer":
      phys.gw += jitter(0.003);
      return { ts, groundwater_depth_m: r(ev === "glitch" && state.eventLeft === 12 ? phys.gw + 25 : phys.gw, 3), battery_v: r(phys.battery, 2) };
  }
}

/**
 * Store-and-forward flush: like a real logger coming back online, the virtual
 * device first uploads its last 6 h buffer (10-min readings) in ONE batch.
 */
async function flushHistory(type: DeviceType) {
  if (!key) return;
  const now = Date.now();
  const readings = [];
  for (let i = 36; i >= 1; i--) {
    const p = nextPayload(type);
    readings.push({ ...p, ts: new Date(now - i * 10 * 60_000).toISOString(), ...(p.units ? { units: JSON.parse(String(p.units)) } : {}) });
  }
  const payload = JSON.stringify({ readings });
  try {
    const res = await fetch("/api/v1/telemetry", { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": key }, body: payload });
    const j = (await res.json()) as { accepted?: number; duplicates?: number; error?: { message: string } };
    set({ sent: state.sent + 1, accepted: state.accepted + (j.accepted ?? 0), log: [{ at: Date.now(), status: res.status, payload: `{"readings":[ …36 buffered readings, 6 h … ]}`, reply: j.error ? j.error.message : `batch: accepted ${j.accepted}, duplicates ${j.duplicates}`, ok: res.status === 202 }, ...state.log] });
  } catch {
    set({ failed: state.failed + 1 });
  }
}

async function tick() {
  if (!state.running || !key || !state.type) return;
  const body = nextPayload(state.type);
  // "units" travels as an object in the real payload
  const payload = JSON.stringify(body.units ? { ...body, units: JSON.parse(String(body.units)) } : body);
  let status: number | null = null;
  let reply = "";
  try {
    const res = await fetch("/api/v1/telemetry", { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": key }, body: payload });
    status = res.status;
    const j = (await res.json()) as { accepted?: number; error?: { message: string }; anomalies?: { title: string }[]; warnings?: { warning: string }[] };
    reply = j.error ? j.error.message : `accepted ${j.accepted}${j.anomalies?.length ? ` · anomaly: ${j.anomalies.map((a) => a.title).join("; ")}` : ""}${j.warnings?.length ? ` · ${j.warnings.length} warning(s)` : ""}`;
    if (res.status === 202) set({ accepted: state.accepted + (j.accepted ?? 0) });
    else set({ failed: state.failed + 1 });
  } catch (e) {
    reply = e instanceof Error ? e.message : "network error";
    set({ failed: state.failed + 1 });
  }
  const eventLeft = Math.max(0, state.eventLeft - 1);
  set({ sent: state.sent + 1, log: [{ at: Date.now(), status, payload, reply, ok: status === 202 }, ...state.log].slice(0, 30), eventLeft, event: eventLeft ? state.event : null });
}

export const virtualDevice = {
  start(opts: { deviceId: string; deviceName: string; type: DeviceType; key: string; everyMs?: number; history?: boolean }) {
    this.stop();
    key = opts.key;
    phys = { level: 2.4, ec: 2.2, moisture: 28, tide: 0, temp: 30.5, gw: 4.2, battery: 3.95, t0: Date.now() };
    set({ running: true, deviceId: opts.deviceId, deviceName: opts.deviceName, type: opts.type, sent: 0, accepted: 0, failed: 0, log: [], event: null, eventLeft: 0 });
    if (opts.history !== false) void flushHistory(opts.type).then(() => tick());
    else void tick();
    timer = setInterval(() => void tick(), opts.everyMs ?? 3000);
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = null;
    key = null;
    if (state.running) set({ running: false });
  },
  /** Inject a physical event for the next ~12 packets. */
  trigger(event: VirtualEvent) {
    set({ event, eventLeft: 12 });
  },
  get: () => state,
};

export function useVirtualDevice(): VState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}
