/**
 * Demo fleet + service: seeding near assets, 30-day backfill, scripted
 * scenarios are detected and classified, ingest dedupe, rule-engine bridge.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ensureIot, ingest, simulatorState } from "@/server/services/iot-service";
import { deviceAnomalies, iot, orgDevices, querySeries, registerDevice, statusOf } from "@/server/services/iot-store";
import { deviceHealth, forecastVsObserved, latestSensorMetrics } from "@/server/services/iot-analytics";
import { getStore } from "@/server/data/store";
import { haversineKm } from "@/server/services/location-risk";

const ORGS = ["org-ins-deltamutual", "org-bank-mekong", "org-ngo-brac", "org-coop-odisha", "org-sc-asiagrain"];
const DAY = 86_400_000;

beforeAll(() => ensureIot());

describe("demo fleet", () => {
  it("seeds 40 devices, 8 per workspace, each within 3 km of a linked asset", () => {
    expect(iot.devices.size).toBe(40);
    const s = getStore();
    for (const o of ORGS) expect(orgDevices(o)).toHaveLength(8);
    for (const d of iot.devices.values()) {
      const a = s.assets.find((x) => x.id === d.assetId)!;
      expect(a.workspaceId).toBe(d.orgId);
      expect(haversineKm(d.lat, d.lon, a.lat, a.lon)).toBeLessThan(3);
    }
    expect(simulatorState()).toMatchObject({ seeded: true, loopRunning: false, schedulerDisabled: true, mode: "backfill-on-read" });
  });

  it("backfills 30 days so 7 d / 30 d charts are populated and current", () => {
    const d = iot.devices.get("dev_insdelt_01")!;
    const now = Date.now();
    expect(querySeries(d.id, "water_level_m", now - 30 * DAY, now, 300).length).toBeGreaterThan(250);
    expect(querySeries(d.id, "water_level_m", now - 7 * DAY, now, 1000).length).toBeGreaterThan(150);
    expect(querySeries(d.id, "water_level_m", now - 3_600_000, now, 1000).length).toBeGreaterThan(50);
    expect(statusOf(d)).toBe("online");
  });

  it("detects and classifies the scripted scenarios", () => {
    const kinds = (id: string) => deviceAnomalies(id).filter((a) => a.kind !== "gap" && a.severity !== "info").map((a) => `${a.metric}:${a.kind}:${a.cls}:${a.severity}`);
    expect(kinds("dev_insdelt_01")).toContain("water_level_m:rapid_rise:real_event:critical"); // flash flood + measured rain
    expect(kinds("dev_bankmek_01").some((k) => k.startsWith("water_level_m:rapid_rise:suspect"))).toBe(true); // unexplained release
    expect(kinds("dev_bankmek_05")).toContain("soil_ec:flatline:sensor_fault:warning"); // stuck probe
    expect(kinds("dev_coopodi_03")).toContain("soil_ec:spike:sensor_fault:warning"); // glitchy probe
    expect(kinds("dev_ngobrac_04")).toContain("soil_ec:ec_surge:real_event:critical"); // tidal salt surge
    expect(statusOf(iot.devices.get("dev_ngobrac_08")!)).toBe("offline"); // dead battery
    expect(deviceHealth(iot.devices.get("dev_coopodi_07")!).daysToEmpty).toBeLessThan(30); // failing solar
  });

  it("raises one workspace notification per critical real event", () => {
    const n = getStore().notifications.filter((x) => x.href?.startsWith("/app/sensors/"));
    expect(n.some((x) => x.workspaceId === "org-ngo-brac" && /Salinity surge/.test(x.title))).toBe(true);
    expect(n.some((x) => x.workspaceId === "org-ins-deltamutual" && /Rapid rise/.test(x.title))).toBe(true);
    ensureIot(Date.now() + 25_000);
    expect(getStore().notifications.filter((x) => x.href?.startsWith("/app/sensors/")).length).toBe(n.length);
  });

  it("compares sensors with the forecast for every device", () => {
    for (const d of iot.devices.values()) {
      const f = forecastVsObserved(d);
      expect(["confirms", "disagrees", "ahead", "calm", "insufficient"]).toContain(f.verdict);
      expect(f.headline.length).toBeGreaterThan(5);
    }
  });

  it("exposes per-asset ground truth for the rule engine, excluding stuck sensors", () => {
    const brac = latestSensorMetrics("org-ngo-brac");
    const gauge = iot.devices.get("dev_ngobrac_01")!;
    expect(brac[gauge.assetId!]!.water_level_m).toBeGreaterThan(0);
    const probe = iot.devices.get("dev_ngobrac_04")!;
    expect(brac[probe.assetId!]!.soil_ec).toBeGreaterThan(4);
    const stuck = iot.devices.get("dev_bankmek_05")!;
    expect(latestSensorMetrics("org-bank-mekong")[stuck.assetId!]!.soil_ec).toBeNull();
    expect(Object.values(brac).every((m) => m.deviceIds.every((id) => iot.devices.get(id)!.orgId === "org-ngo-brac"))).toBe(true);
  });
});

describe("ingest via service", () => {
  it("accepts, normalises, dedupes by timestamp and filters foreign metrics", () => {
    const { device } = registerDevice({ id: "dev_test_ingest", orgId: "org-coop-odisha", name: "Test gauge", type: "river_gauge", lat: 20, lon: 86, assetId: null, districtId: null, installedAt: new Date(), firmware: "2.4.1", intervalSec: 60, devEui: null, thresholds: { warning: null, danger: null }, notes: null, simulated: false, createdAt: new Date(), createdBy: "test" });
    const now = Date.now();
    const ts = new Date(now - 60_000).toISOString();
    const r1 = ingest(device, [{ ts, water_level_cm: 250, soil_ec: 3 }, { ts: now - 120_000, values: { level: { value: 2.48, unit: "m" } } }, { ts: "bad" }], "rest", now);
    expect(r1.accepted).toBe(2);
    expect(r1.rejected).toHaveLength(1);
    expect(r1.warnings.some((w) => /soil_ec not measured/.test(w.warning))).toBe(true);
    expect(device.lastValues.water_level_m).toBe(2.5);
    const r2 = ingest(device, [{ ts, water_level_m: 2.5 }], "rest", now);
    expect(r2).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(statusOf(device, now)).toBe("online");
  });
});
