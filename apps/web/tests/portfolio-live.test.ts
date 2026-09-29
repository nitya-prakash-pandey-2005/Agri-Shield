/**
 * Portfolio monitor end-to-end with Open-Meteo stubbed: live re-score
 * (grid-deduplicated forecast calls), history append, rule firing with a
 * signed webhook, realtime notification and the job wrapper.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.hoisted(() => {
  process.env.AGRI_OFFLINE = "false";
});

let forecastCalls = 0;
let forecastPoints = 0;
const webhookBodies: { body: string; headers: Record<string, string> }[] = [];

function forecastFor(lat: number, lon: number) {
  const start = Date.now() - 24 * 3600_000;
  const time = Array.from({ length: 9 * 24 }, (_, i) => new Date(start + i * 3600_000).toISOString().slice(0, 13) + ":00");
  const days = Array.from({ length: 9 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  return {
    latitude: lat,
    longitude: lon,
    elevation: 3,
    hourly: {
      time,
      precipitation: time.map(() => 4), // ~96 mm/day → very heavy rain
      precipitation_probability: time.map(() => 90),
      temperature_2m: time.map(() => 29),
      relative_humidity_2m: time.map(() => 90),
      wind_speed_10m: time.map(() => 20),
      soil_moisture_0_to_7cm: time.map(() => 0.45),
    },
    daily: { time: days, precipitation_sum: days.map(() => 96), precipitation_probability_max: days.map(() => 90), temperature_2m_max: days.map(() => 31), temperature_2m_min: days.map(() => 25), et0_fao_evapotranspiration: days.map(() => 3) },
  };
}

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.open-meteo.com/v1/forecast")) {
      forecastCalls++;
      const u = new URL(url);
      const lats = u.searchParams.get("latitude")!.split(",").map(Number);
      const lons = u.searchParams.get("longitude")!.split(",").map(Number);
      forecastPoints += lats.length;
      const arr = lats.map((la, i) => forecastFor(la, lons[i]!));
      return Response.json(arr.length === 1 ? arr[0] : arr);
    }
    if (url.startsWith("https://flood-api.open-meteo.com")) return new Response("down", { status: 503 });
    if (url.startsWith("https://hooks.test.example")) {
      webhookBodies.push({ body: String(init?.body), headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response("ok", { status: 200 });
    }
    return new Response("not stubbed", { status: 500 });
  })
);

const { resetStore, getStore } = await import("@/server/data/store");
const { rescoreWorkspace, evaluateWorkspaceRules, workspaceAssets, webhookSecret, ruleFirings } = await import("@/server/services/portfolio");
const { portfolioMonitor } = await import("@/server/jobs/portfolio-monitor");
const { bus } = await import("@/server/realtime");

describe("live portfolio monitoring (stubbed Open-Meteo)", () => {
  beforeEach(() => {
    resetStore();
    forecastCalls = 0;
    forecastPoints = 0;
    webhookBodies.length = 0;
  });

  it("scores live, shares ~5 km forecast cells, appends history", async () => {
    const WS = "org-coop-odisha";
    const n = workspaceAssets(WS).length;
    const r = await rescoreWorkspace(WS);
    expect(r.live).toBe(n);
    expect(r.fallback).toBe(0);
    expect(r.cells).toBeLessThanOrEqual(n);
    expect(r.cells).toBeLessThan(n); // nearby farms share a forecast cell
    expect(forecastPoints).toBeGreaterThanOrEqual(r.cells);
    const a = workspaceAssets(WS)[0]!;
    expect(a.lastAssessment?.source).toBe("open-meteo");
    expect(a.lastAssessment!.floodRisk).toBeGreaterThan(30);
    expect(a.history[a.history.length - 1]!.date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("fires a rain rule with a signed webhook + in-app realtime notification", async () => {
    const WS = "org-bank-mekong";
    const rule = getStore().alertRules.find((x) => x.id === "rule_004")!;
    rule.conditions = [{ metric: "rain_72h_mm", op: ">=", value: 150 }];
    rule.channels = ["app", "webhook"];
    rule.webhookUrl = "https://hooks.test.example/climate";
    rule.scope = {};
    const events: string[] = [];
    const on = (e: { room: string; event: { type: string } }) => e.room === `ws:${WS}` && events.push(e.event.type);
    bus.on("event", on);
    await rescoreWorkspace(WS);
    const out = await evaluateWorkspaceRules(WS, { ruleIds: ["rule_004"] });
    bus.off("event", on);
    expect(out[0]!.fired).toBe(true);
    expect(events).toContain("notification.created");
    expect(events).toContain("rule.fired");
    expect(webhookBodies).toHaveLength(1);
    const { body, headers } = webhookBodies[0]!;
    expect(headers["X-AgriShield-Signature"]).toBe(`sha256=${createHmac("sha256", webhookSecret(WS)).update(body).digest("hex")}`);
    const payload = JSON.parse(body);
    expect(payload.event).toBe("rule.fired");
    expect(payload.matches[0].reason).toMatch(/Rain 72h \d+ mm ≥ 150 mm/);
    expect(ruleFirings(WS, { ruleId: "rule_004" })[0]!.deliveries.find((d) => d.channel === "webhook")!.status).toBe("sent");
  });

  it("portfolio-monitor job covers every workspace", async () => {
    const r = await portfolioMonitor({ triggeredBy: "test", now: new Date("2026-09-29T10:00:00Z") });
    expect(r.status).toBe("success");
    const per = r.output!.workspaces as Record<string, { assets: number; live: number; digest: boolean }>;
    expect(Object.keys(per)).toEqual(expect.arrayContaining(["org-ins-deltamutual", "org-bank-mekong", "org-ngo-brac", "org-coop-odisha"]));
    expect(per["org-ngo-brac"]!.live).toBeGreaterThan(0);
    expect(per["org-ngo-brac"]!.digest).toBe(false); // Tuesday
    const monday = await portfolioMonitor({ triggeredBy: "test", now: new Date("2026-09-28T10:00:00Z"), workspaceIds: ["org-ngo-brac"] });
    expect((monday.output!.workspaces as Record<string, { digest: boolean }>)["org-ngo-brac"]!.digest).toBe(true);
  });
});
