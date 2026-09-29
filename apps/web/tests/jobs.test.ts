/**
 * Background jobs (spec §6): pure helpers + end-to-end runs against the
 * in-memory store with all outbound HTTP stubbed.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AGRI_OFFLINE = "false";
});

// Synthetic MODIS: 8 composites; Barisal loses 30 % NDVI in the last clear composite.
const DATES = ["A2026145", "A2026161", "A2026177", "A2026193", "A2026209", "A2026225", "A2026241", "A2026257"];
const CAL = ["2026-05-25", "2026-06-10", "2026-06-26", "2026-07-12", "2026-07-28", "2026-08-13", "2026-08-29", "2026-09-14"];
let modisCalls = 0;

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("http://ml.test.local/api/ml/flood-risk")) {
    return Response.json({ probability_24h: 0.5, probability_48h: 0.6, probability_72h: 0.7, estimated_depth_m: 0.4, confidence_interval: [0.6, 0.8], contributing_factors: ["test"], risk_level: "high", model_version: "flood-test-v9" });
  }
  if (url.startsWith("https://modis.ornl.gov/rst/api/v1/MOD13Q1/dates")) {
    modisCalls++;
    return Response.json({ dates: DATES.map((d, i) => ({ modis_date: d, calendar_date: CAL[i] })) });
  }
  if (url.startsWith("https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset")) {
    modisCalls++;
    const u = new URL(url);
    const lat = Number(u.searchParams.get("latitude"));
    const band = u.searchParams.get("band")!;
    const barisal = Math.abs(lat - 22.7011) < 1e-3;
    return Response.json({
      scale: band.includes("NDVI") ? "0.0001" : "1",
      subset: DATES.map((d, i) => ({
        modis_date: d,
        calendar_date: CAL[i],
        tile: "h26v06",
        data: Array.from({ length: 81 }, () =>
          band.includes("NDVI") ? (barisal && i === DATES.length - 1 ? 4200 : 6000 + i * 20) : i === 3 ? 3 : 0
        ),
      })),
    });
  }
  return new Response("unavailable", { status: 503 });
});

const { getStore, resetStore } = await import("@/server/data/store");
const { bus } = await import("@/server/realtime");
const { outbox } = await import("@/server/notify/channels");
const { compositeNdvi, detectDrop, fieldOffset, percentile, satelliteIngest, satelliteStatus } = await import("@/server/jobs/satellite-ingest");
const { climateScan, isDuplicate, floodSeverity, salinitySeverity, haversineKm, buildRecommendation } = await import("@/server/jobs/climate-scan");
const { notificationDispatch, enqueueNotification, notificationQueue } = await import("@/server/jobs/notification-dispatch");
const { modelRetrain } = await import("@/server/jobs/model-retrain");
const { runJob, jobRuns, jobOverview, __resetJobRegistry } = await import("@/server/jobs/registry");
const { nextUtc } = await import("@/server/jobs/scheduler");

beforeAll(() => vi.stubGlobal("fetch", fetchMock));
beforeEach(() => {
  resetStore();
  __resetJobRegistry();
});

describe("NDVI processing helpers", () => {
  it("averages clear pixels and scales by 0.0001", () => {
    const r = compositeNdvi([5000, 6000, 7000, -3000], [0, 1, 0, 0]);
    expect(r).toMatchObject({ ndvi: 0.6, quality: "clear" });
  });
  it("falls back to the 90th percentile for cloudy composites", () => {
    const vals = Array.from({ length: 20 }, (_, i) => 1000 + i * 300);
    const r = compositeNdvi(vals, Array(20).fill(3))!;
    expect(r.quality).toBe("cloudy");
    expect(r.ndvi).toBeCloseTo(percentile(vals.map((v) => v * 1e-4), 0.9), 3);
    expect(r.clearPct).toBe(0);
  });
  it("returns null when everything is fill", () => {
    expect(compositeNdvi([-3000, -3000], [255, 255])).toBeNull();
  });
  it("detects >20 % drops between the last two CLEAR composites only", () => {
    const p = (ndvi: number, quality: "clear" | "cloudy") => ({ date: "", modisDate: "", ndvi, quality, clearPct: 0 });
    expect(detectDrop([p(0.7, "clear"), p(0.5, "clear")])).toEqual({ changePct: -28.6, stressed: true });
    expect(detectDrop([p(0.7, "clear"), p(0.6, "clear")]).stressed).toBe(false);
    expect(detectDrop([p(0.7, "clear"), p(0.6, "clear"), p(0.2, "cloudy")]).stressed).toBe(false);
    expect(detectDrop([p(0.7, "cloudy")])).toEqual({ changePct: null, stressed: false });
  });
  it("gives each field a stable offset within ±0.05", () => {
    for (const id of ["field-1", "fld-abc", "x"]) {
      expect(fieldOffset(id)).toBe(fieldOffset(id));
      expect(Math.abs(fieldOffset(id))).toBeLessThanOrEqual(0.05);
    }
  });
});

describe("satelliteIngest (ORNL MODIS, stubbed)", () => {
  it("updates field NDVI history and flags stressed districts", async () => {
    modisCalls = 0;
    const r = await satelliteIngest({ districtIds: ["bd-barisal", "bd-sylhet"] });
    expect(r.status).toBe("success");
    expect(modisCalls).toBe(1 + 2 * 2); // dates + (NDVI + reliability) × 2 districts
    const s = getStore();
    const ratanFields = s.fields.filter((f) => f.farmerId === "farmer-000");
    for (const f of ratanFields) {
      expect(f.ndviHistory.map((h) => h.date)).toEqual(CAL); // cloudy composites are kept (90th-percentile value) but can't trigger stress
      expect(f.ndviScore).toBeCloseTo(0.42, 1);
    }
    const st = satelliteStatus().districts.find((d) => d.districtId === "bd-barisal")!;
    expect(st.stressed).toBe(true);
    expect(st.changePct).toBeCloseTo(-31.4, 0);
    expect(st.series.find((p) => p.date === CAL[3])?.quality).toBe("cloudy");
    expect(satelliteStatus().districts.find((d) => d.districtId === "bd-sylhet")!.stressed).toBe(false);
    const recs = s.recommendations.filter((x) => x.recommendationType === "crop_stress");
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((x) => ratanFields.some((f) => f.id === x.fieldId) || s.fields.find((f) => f.id === x.fieldId))).toBe(true);
    expect(notificationQueue().pending).toBeGreaterThan(0);
  });
});

describe("climate-scan helpers", () => {
  it("maps probabilities to severities", () => {
    expect([0.6, 0.72, 0.85].map(floodSeverity)).toEqual(["watch", "warning", "emergency"]);
    expect([65, 78, 92].map(salinitySeverity)).toEqual(["watch", "warning", "emergency"]);
  });
  it("dedupes same-type alerts within 6 h or active with ≥ severity", () => {
    const now = Date.now();
    const a = { districtId: "d", alertType: "flood", severity: "warning", createdAt: new Date(now - 7 * 3600_000), isActive: true, validUntil: new Date(now + 3600_000) } as never;
    expect(isDuplicate([a], "d", "flood", "warning", now)).toBe(true);
    expect(isDuplicate([a], "d", "flood", "emergency", now)).toBe(false);
    expect(isDuplicate([a], "d", "salinity", "watch", now)).toBe(false);
    const recent = { ...(a as object), isActive: false, createdAt: new Date(now - 3600_000) } as never;
    expect(isDuplicate([recent], "d", "flood", "emergency", now)).toBe(true);
  });
  it("computes great-circle distances", () => {
    expect(haversineKm(22.7011, 90.3637, 22.8456, 89.5403)).toBeGreaterThan(80);
    expect(haversineKm(22.7011, 90.3637, 22.8456, 89.5403)).toBeLessThan(90);
  });
  it("recommends harvest for mature crops under flood alerts", () => {
    const s = getStore();
    const field = { ...s.fields[0]!, plantingDate: new Date(Date.now() - 110 * 86_400_000), expectedHarvest: new Date(Date.now() + 10 * 86_400_000) };
    const rec = buildRecommendation({ alertType: "flood", severity: "emergency", id: "a" }, field, s.districts[0]!);
    expect(rec.title).toMatch(/^Harvest/);
    expect(rec.priority).toBe("urgent");
  });
});

describe("climateScan end-to-end", () => {
  it("raises deduplicated alerts with recommendations and publishes realtime events", async () => {
    const s = getStore();
    // make Sylhet unambiguously critical so the model must alert
    const sylhet = s.districts.find((d) => d.id === "bd-sylhet")!;
    sylhet.floodProb72h = 0.9;
    sylhet.floodRisk = 90;
    const events: string[] = [];
    const on = (e: { event: { type: string } }) => events.push(e.event.type);
    bus.on("event", on);
    const alertsBefore = s.alerts.length;

    const r1 = await climateScan({ triggeredBy: "test" });
    const created = r1.output!.alertsCreated as { district: string; type: string; severity: string }[];
    expect(created.length).toBeGreaterThan(0);
    expect(created).toContainEqual(expect.objectContaining({ district: "Sylhet", type: "flood", severity: "emergency" }));
    expect(s.alerts.length).toBe(alertsBefore + created.length);
    expect(r1.output!.recommendationsCreated as number).toBeGreaterThan(0);
    expect(r1.output!.mlModels).toContain("flood-test-v9 (ml-api)");
    expect(events).toEqual(expect.arrayContaining(["risk.updated", "scan.completed", "alert.created"]));

    // second pass immediately afterwards: everything deduped
    const r2 = await climateScan({ triggeredBy: "test" });
    expect(r2.output!.alertsCreated).toEqual([]);
    bus.off("event", on);
  });
});

describe("notificationDispatch", () => {
  it("drains the queue and retries failed outbox messages", async () => {
    enqueueNotification({ channel: "app", to: "user-farmer-demo", body: "hello", origin: "test" });
    outbox.unshift({ id: "msg_failed_test", channel: "sms", to: "+8801711000000", body: "retry me", at: new Date(Date.now() - 5 * 60_000), status: "failed", provider: "twilio", error: "Twilio 500" });
    const r = await notificationDispatch();
    expect(r.output!.requeued).toBeGreaterThanOrEqual(1);
    expect(r.output!.sent).toBeGreaterThanOrEqual(2); // app push + SMS retry (simulated provider)
    const again = await notificationDispatch();
    expect(again.output!.requeued).toBe(0);
  });
});

describe("modelRetrain", () => {
  it("skips gracefully when the ML API is unreachable", async () => {
    const r = await modelRetrain();
    expect(r.status).toBe("skipped");
    expect(r.summary).toContain("unreachable");
  });
});

describe("job registry + scheduler", () => {
  it("is single-flight and records history", async () => {
    let calls = 0;
    const slow = () => new Promise<{ summary: string }>((res) => setTimeout(() => (calls++, res({ summary: "done" })), 50));
    const [a, b] = await Promise.all([runJob("climate-scan", slow, "manual", "t"), runJob("climate-scan", slow, "manual", "t")]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    expect(jobRuns({ job: "climate-scan" })[0]).toMatchObject({ status: "success", summary: "done", trigger: "manual" });
  });
  it("records failures without throwing", async () => {
    const run = await runJob("model-retrain", async () => {
      throw new Error("boom");
    });
    expect(run).toMatchObject({ status: "failed", error: "boom" });
    expect(jobOverview().find((j) => j.name === "model-retrain")!.successRate).toBe(0);
  });
  it("computes next UTC wall-clock runs", () => {
    const from = new Date("2026-09-29T05:00:00Z"); // Tuesday
    expect(nextUtc(2, 0, undefined, from).toISOString()).toBe("2026-09-30T02:00:00.000Z");
    expect(nextUtc(6, 0, undefined, from).toISOString()).toBe("2026-09-29T06:00:00.000Z");
    expect(nextUtc(3, 0, 0, from).toISOString()).toBe("2026-10-04T03:00:00.000Z");
  });
});
