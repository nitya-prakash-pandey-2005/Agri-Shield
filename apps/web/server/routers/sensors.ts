/**
 * sensorsRouter — Sensors & IoT workspace module.
 * Reads need "use_workspace", device management needs "manage_assets".
 * Everything is scoped to ctx.user.orgId (platform_admin may pass orgId).
 *
 *   overview        fleet KPIs, device list with sparklines, recent anomalies, verdict mix
 *   device          one device: metadata, health, forecast-vs-observed, anomalies, packets
 *   series          chart data for 1h / 24h / 7d / 30d (downsampled) + anomaly markers
 *   create / update / remove / rotateKey   registry CRUD (device key shown once)
 *   assetOptions    workspace assets to link a device to
 *   ackAnomaly      mark an anomaly as reviewed
 *   ruleMetrics     latestSensorMetrics(orgId) — per-asset ground truth for alert rules
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { can } from "@/lib/rbac";
import { audit, getStore } from "../data/store";
import { permitted, router } from "../trpc";
import { DEVICE_TYPES, DEVICE_TYPE_KEYS, METRIC_META, type DeviceType, type MetricKey } from "../services/iot-types";
import { ensureIot, detectFor, simulatorState } from "../services/iot-service";
import { anomalyCounts, deviceHealth, districtOf, forecastVsObserved, latestSensorMetrics, type Verdict } from "../services/iot-analytics";
import { countSince, deviceAnomalies, iot, nextDeviceId, orgDevices, querySeries, rawSamples, registerDevice, removeDevice, rotateDeviceKey, statusOf, type DeviceRecord } from "../services/iot-store";

const read = permitted("use_workspace");
const write = permitted("manage_assets");

type Ctx = { user: { id: string; name: string; role: string; orgId: string | null } };
const orgZ = z.string().max(80).optional();

function wsOf(ctx: Ctx, orgId?: string | null): string {
  if (orgId && ctx.user.role === "platform_admin") return orgId;
  if (!ctx.user.orgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is not attached to a workspace" });
  return ctx.user.orgId;
}

function deviceOf(ctx: Ctx, id: string): DeviceRecord {
  const d = iot.devices.get(id);
  if (!d || (d.orgId !== ctx.user.orgId && ctx.user.role !== "platform_admin")) throw new TRPCError({ code: "NOT_FOUND", message: "Device not found in this workspace" });
  return d;
}

const H = 3_600_000;
const DAY = 86_400_000;
const RANGE_MS = { "1h": H, "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY } as const;
const typeZ = z.enum(DEVICE_TYPE_KEYS as [DeviceType, ...DeviceType[]]);

function publicDevice(d: DeviceRecord) {
  const { keyHash: _k, ...rest } = d;
  return rest;
}

function assetLite(assetId: string | null) {
  if (!assetId) return null;
  const a = getStore().assets.find((x) => x.id === assetId);
  return a ? { id: a.id, name: a.name, type: a.type, valueUsd: a.valueUsd, level: a.lastAssessment?.level ?? null, composite: a.lastAssessment?.composite ?? null } : null;
}

const deviceInputZ = z.object({
  name: z.string().trim().min(2).max(90),
  type: typeZ,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  assetId: z.string().max(40).nullable().optional(),
  installedAt: z.coerce.date().optional(),
  firmware: z.string().trim().max(20).optional(),
  intervalSec: z.number().int().min(10).max(86_400).optional(),
  devEui: z.string().trim().regex(/^[0-9A-Fa-f]{16}$/, "DevEUI must be 16 hex characters").nullable().optional(),
  thresholds: z.object({ warning: z.number().min(-5).max(40).nullable(), danger: z.number().min(-5).max(40).nullable() }).optional(),
  notes: z.string().max(500).nullable().optional(),
});

function checkAsset(orgId: string, assetId: string | null | undefined) {
  if (!assetId) return null;
  const a = getStore().assets.find((x) => x.id === assetId && x.workspaceId === orgId);
  if (!a) throw new TRPCError({ code: "BAD_REQUEST", message: "Linked asset not found in this workspace" });
  return a;
}

export const sensorsRouter = router({
  ping: read.query(() => ({ ok: true })),

  overview: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => {
    const orgId = wsOf(ctx, input?.orgId);
    ensureIot();
    const now = Date.now();
    const devices = orgDevices(orgId);
    const counts = { total: devices.length, online: 0, stale: 0, offline: 0, never: 0 };
    const byType: Partial<Record<DeviceType, number>> = {};
    const verdicts: Partial<Record<Verdict, number>> = {};
    let readings24h = 0;
    let lowBattery = 0;
    const rows = devices.map((d) => {
      const status = statusOf(d, now);
      counts[status]++;
      byType[d.type] = (byType[d.type] ?? 0) + 1;
      readings24h += countSince(d.id, now - DAY);
      const primary = DEVICE_TYPES[d.type].primary;
      const spark = querySeries(d.id, primary, now - DAY, now, 48, now).map((p) => Math.round(p.v * 1000) / 1000);
      const open = deviceAnomalies(d.id, now - DAY).filter((a) => !a.ackedAt && a.kind !== "gap" && a.severity !== "info");
      const worst = open.some((a) => a.severity === "critical") ? "critical" : open.length ? "warning" : null;
      const cmp = forecastVsObserved(d, now);
      verdicts[cmp.verdict] = (verdicts[cmp.verdict] ?? 0) + 1;
      const battery = d.lastValues.battery_pct ?? null;
      if (battery != null && battery < 20) lowBattery++;
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        lat: d.lat,
        lon: d.lon,
        status,
        lastSeen: d.lastSeen ? new Date(d.lastSeen) : null,
        primary: { metric: primary, value: d.lastValues[primary] ?? null },
        battery,
        spark,
        openAnomalies: open.length,
        worst,
        verdict: cmp.verdict,
        verdictHeadline: cmp.headline,
        asset: assetLite(d.assetId),
        simulated: d.simulated,
        via: d.counters.lastIngestVia,
        thresholds: d.thresholds,
      };
    });
    const recent = devices
      .flatMap((d) => deviceAnomalies(d.id, now - 7 * DAY).filter((a) => a.kind !== "gap" && a.severity !== "info").map((a) => ({ ...a, deviceName: d.name, deviceType: d.type })))
      .sort((a, b) => (a.ackedAt ? 1 : 0) - (b.ackedAt ? 1 : 0) || b.end - a.end)
      .slice(0, 20);
    const districts = new Set(devices.map((d) => districtOf(d)).filter(Boolean).map((x) => x!));
    const live = [...districts].filter((x) => x.liveSource === "open-meteo").length;
    const lat = devices.length ? devices.reduce((a, d) => a + d.lat, 0) / devices.length : 22.5;
    const lon = devices.length ? devices.reduce((a, d) => a + d.lon, 0) / devices.length : 90;
    return {
      sim: simulatorState(),
      counts,
      byType,
      verdicts,
      readings24h,
      lowBattery,
      anomalies: anomalyCounts(orgId, now - DAY),
      devices: rows,
      recentAnomalies: recent,
      drivers: { districts: districts.size, live, source: live === 0 ? "seed" : live === districts.size ? "open-meteo" : "mixed" },
      center: [lat, lon] as [number, number],
      canWrite: can(ctx.user.role as never, "manage_assets"),
      now: new Date(now),
    };
  }),

  device: read.input(z.object({ id: z.string().max(60) })).query(({ ctx, input }) => {
    ensureIot();
    const d = deviceOf(ctx, input.id);
    const now = Date.now();
    detectFor(d, now);
    const district = districtOf(d);
    return {
      device: publicDevice(d),
      status: statusOf(d, now),
      health: deviceHealth(d, now),
      comparison: forecastVsObserved(d, now),
      anomalies: deviceAnomalies(d.id, now - 30 * DAY).filter((a) => a.kind !== "gap" || a.end - a.start > 2 * H).slice(0, 60),
      asset: assetLite(d.assetId),
      district: district ? { id: district.id, name: district.name, country: district.countryName, live: district.liveSource === "open-meteo", coastal: district.salinityRisk >= 20 } : null,
      packets: rawSamples(d.id, now - DAY, now).slice(-15).reverse().map((s) => ({ t: new Date(s.t), v: s.v })),
      canWrite: can(ctx.user.role as never, "manage_assets"),
      now: new Date(now),
    };
  }),

  series: read
    .input(z.object({ id: z.string().max(60), range: z.enum(["1h", "24h", "7d", "30d"]), metrics: z.array(z.string().max(40)).max(10).optional(), maxPoints: z.number().int().min(20).max(1000).optional() }))
    .query(({ ctx, input }) => {
      ensureIot();
      const d = deviceOf(ctx, input.id);
      const now = Date.now();
      const from = now - RANGE_MS[input.range];
      const metrics = (input.metrics?.length ? input.metrics : DEVICE_TYPES[d.type].metrics).filter((m): m is MetricKey => m in METRIC_META);
      const series = Object.fromEntries(metrics.map((m) => [m, querySeries(d.id, m, from, now, input.maxPoints ?? 300, now)]));
      const anomalies = deviceAnomalies(d.id, from).filter((a) => a.kind !== "gap" && metrics.includes(a.metric));
      return { range: input.range, from: new Date(from), to: new Date(now), series, anomalies, thresholds: d.thresholds };
    }),

  assetOptions: read.input(z.object({ q: z.string().max(80).optional(), orgId: orgZ }).optional()).query(({ ctx, input }) => {
    const orgId = wsOf(ctx, input?.orgId);
    const q = input?.q?.trim().toLowerCase();
    return getStore()
      .assets.filter((a) => a.workspaceId === orgId && a.status === "active" && (!q || a.name.toLowerCase().includes(q) || (a.externalRef ?? "").toLowerCase().includes(q)))
      .slice(0, 40)
      .map((a) => ({ id: a.id, name: a.name, type: a.type, lat: a.lat, lon: a.lon, country: a.country }));
  }),

  create: write.input(deviceInputZ.extend({ orgId: orgZ })).mutation(({ ctx, input }) => {
    const orgId = wsOf(ctx, input.orgId);
    ensureIot();
    if (orgDevices(orgId).length >= 500) throw new TRPCError({ code: "FORBIDDEN", message: "Device limit reached for this workspace (500)" });
    checkAsset(orgId, input.assetId);
    const meta = DEVICE_TYPES[input.type];
    const district = districtOf({ districtId: null, lat: input.lat, lon: input.lon });
    const { device, key } = registerDevice({
      id: nextDeviceId(),
      orgId,
      name: input.name,
      type: input.type,
      lat: input.lat,
      lon: input.lon,
      assetId: input.assetId ?? null,
      districtId: district?.id ?? null,
      installedAt: input.installedAt ?? new Date(),
      firmware: input.firmware || meta.latestFirmware,
      intervalSec: input.intervalSec ?? meta.intervalSec,
      devEui: input.devEui ? input.devEui.toUpperCase() : null,
      thresholds: input.thresholds ?? { warning: null, danger: null },
      notes: input.notes ?? null,
      simulated: false,
      createdAt: new Date(),
      createdBy: ctx.user.id,
    });
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "sensor.create", entity: "device", entityId: device.id, details: `${meta.short} "${device.name}"` });
    return { device: publicDevice(device), key };
  }),

  update: write.input(deviceInputZ.partial().extend({ id: z.string().max(60) })).mutation(({ ctx, input }) => {
    const d = deviceOf(ctx, input.id);
    if (input.assetId !== undefined) checkAsset(d.orgId, input.assetId);
    const { id: _id, ...patch } = input;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (d as unknown as Record<string, unknown>)[k] = k === "devEui" && typeof v === "string" ? v.toUpperCase() : v;
    if (input.lat != null || input.lon != null) d.districtId = districtOf({ districtId: null, lat: d.lat, lon: d.lon })?.id ?? null;
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "sensor.update", entity: "device", entityId: d.id, details: Object.keys(patch).join(", ") });
    return publicDevice(d);
  }),

  remove: write.input(z.object({ id: z.string().max(60) })).mutation(({ ctx, input }) => {
    const d = deviceOf(ctx, input.id);
    removeDevice(d.id);
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "sensor.delete", entity: "device", entityId: d.id, details: d.name });
    return { ok: true };
  }),

  rotateKey: write.input(z.object({ id: z.string().max(60) })).mutation(({ ctx, input }) => {
    const d = deviceOf(ctx, input.id);
    const key = rotateDeviceKey(d);
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "sensor.rotate_key", entity: "device", entityId: d.id, details: `new key ${d.keyPrefix}…` });
    return { key, keyPrefix: d.keyPrefix, rotatedAt: d.keyRotatedAt };
  }),

  ackAnomaly: read.input(z.object({ deviceId: z.string().max(60), anomalyId: z.string().max(200) })).mutation(({ ctx, input }) => {
    const d = deviceOf(ctx, input.deviceId);
    const a = iot.anomalies.get(d.id)?.get(input.anomalyId);
    if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Anomaly not found" });
    a.ackedBy = ctx.user.name;
    a.ackedAt = new Date();
    return { ok: true };
  }),

  ruleMetrics: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => {
    const orgId = wsOf(ctx, input?.orgId);
    ensureIot();
    const m = latestSensorMetrics(orgId);
    const s = getStore();
    return Object.values(m).map((x) => ({ ...x, assetName: s.assets.find((a) => a.id === x.assetId)?.name ?? x.assetId }));
  }),
});
