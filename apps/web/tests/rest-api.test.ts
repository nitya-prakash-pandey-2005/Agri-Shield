/**
 * REST handlers (app/api/v1/**) called directly with `new Request(...)`.
 * All outbound HTTP is intercepted with a stubbed global fetch.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AGRI_OFFLINE = "false"; // let fetchJson reach the stubbed fetch
});

const ML_FLOOD = {
  probability_24h: 0.41,
  probability_48h: 0.58,
  probability_72h: 0.73,
  estimated_depth_m: 0.6,
  confidence_interval: [0.65, 0.8],
  contributing_factors: ["above_avg_rainfall_72h"],
  risk_level: "high",
  model_version: "flood-ensemble-test",
};

let mlUp = true;
const calls: string[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  calls.push(url);
  if (url.startsWith("http://ml.test.local")) {
    if (!mlUp) throw new TypeError("fetch failed");
    if (url.includes("/api/ml/flood-risk")) return Response.json(ML_FLOOD);
    if (url.includes("/health")) return Response.json({ status: "ok", version: "test" });
    return new Response("not found", { status: 404 });
  }
  if (url.includes("api.mymemory.translated.net")) {
    const q = new URL(url).searchParams.get("q") ?? "";
    return Response.json({ responseStatus: 200, responseData: { translatedText: `[bn] ${q.slice(0, 40)}` } });
  }
  return new Response("upstream unavailable in tests", { status: 503 });
});

const risk = await import("@/app/api/v1/risk/route");
const health = await import("@/app/api/v1/health/route");
const sms = await import("@/app/api/v1/sms/inbound/route");
const webhook = await import("@/app/api/v1/alerts/webhook/route");
const openapi = await import("@/app/api/v1/openapi.json/route");
const cron = await import("@/app/api/v1/cron/[job]/route");
const commodity = await import("@/app/api/v1/supply-chain/commodity-risk/route");
const { getStore, resetStore } = await import("@/server/data/store");
const { signBody, DEV_WEBHOOK_SECRET } = await import("@/server/api/webhook-auth");
const { twilioSignature } = await import("@/server/sms/handler");
const { createApiKey } = await import("@/server/services/supply-chain");

let ip = 0;
const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`http://localhost:3000${path}`, { ...init, headers: { "x-forwarded-for": `192.0.2.${++ip % 250}`, ...init.headers } });

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const message = (xml: string) => xml.match(/<Message>([\s\S]*)<\/Message>/)?.[1] ?? "";

beforeAll(() => vi.stubGlobal("fetch", fetchMock));
beforeEach(() => {
  resetStore();
  mlUp = true;
  calls.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/v1/risk", () => {
  it("returns ML flood risk + nearest district overlay", async () => {
    const res = await risk.GET(req("/api/v1/risk?lat=22.7011&lon=90.3637&type=flood"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.risk).toMatchObject({ probability_72h: 0.73, source: "ml-api", model_version: "flood-ensemble-test" });
    expect(body.nearestDistrict).toMatchObject({ id: "bd-barisal", inCoverage: true });
    expect(body.nearestDistrict.distanceKm).toBeLessThan(1);
    expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("falls back to the web formula when the ML API is down", async () => {
    mlUp = false;
    const res = await risk.GET(req("/api/v1/risk?lat=10.0452&lon=105.7469"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.risk.source).toBe("web-fallback");
    expect(body.risk.probability_72h).toBeGreaterThanOrEqual(0);
    expect(body.nearestDistrict.id).toBe("vn-cantho");
  });

  it("serves salinity with crop-specific damage", async () => {
    mlUp = false;
    const body = await (await risk.GET(req("/api/v1/risk?lat=10.24&lon=106.37&type=salinity&crop=rice"))).json();
    expect(body.type).toBe("salinity");
    expect(body.risk).toHaveProperty("crop_damage_probability");
  });

  it.each(["lat=91&lon=90", "lat=abc&lon=90", "lon=90", "lat=22&lon=90&type=drought"])("rejects %s with 400", async (q) => {
    const res = await risk.GET(req(`/api/v1/risk?${q}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("authenticates API keys (hashed portal keys and legacy demo prefixes)", async () => {
    const bad = await risk.GET(req("/api/v1/risk?lat=22.7&lon=90.3", { headers: { "x-api-key": "ags_live_notarealkey000000" } }));
    expect(bad.status).toBe(401);

    const { key } = createApiKey("org-sc-asiagrain", "test", ["risk:read"], "live", { id: "u", name: "U" });
    const ok = await risk.GET(req("/api/v1/risk?lat=22.7&lon=90.3", { headers: { "x-api-key": key } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).authenticated).toBe(true);

    const legacy = await risk.GET(req("/api/v1/risk?lat=22.7&lon=90.3", { headers: { "x-api-key": "ags_live_7Hq2-demo-2026-key" } }));
    expect((await legacy.json()).authenticated).toBe(true);
  });

  it("enforces key scopes", async () => {
    const { key } = createApiKey("org-sc-asiagrain", "no-risk", ["commodities:read"], "test", { id: "u", name: "U" });
    const res = await risk.GET(req("/api/v1/risk?lat=22.7&lon=90.3", { headers: { "x-api-key": key } }));
    expect(res.status).toBe(403);
  });

  it("rate-limits anonymous callers at 30 req/min per IP", async () => {
    mlUp = true;
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await risk.GET(new Request("http://localhost/api/v1/risk?lat=22.7&lon=90.3", { headers: { "x-forwarded-for": "203.0.113.9" } }))).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(30);
    expect(statuses.slice(-2)).toEqual([429, 429]);
  });
});

describe("GET /api/v1/health", () => {
  it("cheap liveness with deep=0", async () => {
    const res = await health.GET(req("/api/v1/health?deep=0"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.web.status).toBe("up");
    expect(body.store.farmers).toBe(50);
    expect(body.jobs.map((j: { name: string }) => j.name)).toEqual(["climate-scan", "notification-dispatch", "satellite-ingest", "model-retrain"]);
    expect(calls).toHaveLength(0);
  });

  it("deep check probes every data source and the ML API", async () => {
    const body = await (await health.GET(req("/api/v1/health"))).json();
    const ids = body.dataSources.sources.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["open-meteo-forecast", "open-meteo-flood", "gdacs", "nasa-eonet", "nasa-gibs", "ornl-modis", "soilgrids", "mymemory", "world-bank", "ml-api"]));
    expect(body.ml.status).toBe("up");
    const mm = body.dataSources.sources.find((s: { id: string }) => s.id === "mymemory");
    expect(mm.status).toBe("up");
    const om = body.dataSources.sources.find((s: { id: string }) => s.id === "open-meteo-forecast");
    expect(om.status).toBe("down"); // stub returns 503
  });
});

describe("POST /api/v1/sms/inbound", () => {
  const post = (params: Record<string, string>, headers: Record<string, string> = {}) =>
    sms.POST(req("/api/v1/sms/inbound", { method: "POST", body: form(params), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } }));

  it("STATUS for the demo farmer returns TwiML with district risk", async () => {
    const res = await post({ From: "+8801711000000", Body: "STATUS" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><Response><Message>')).toBe(true);
    expect(message(xml)).toContain("Barisal");
    expect(res.headers.get("x-agri-command")).toBe("STATUS");
    expect(Number(res.headers.get("x-agri-segments"))).toBeLessThanOrEqual(2);
  });

  it("ALERT and ADVICE use live store data", async () => {
    const a = message(await (await post({ From: "+8801711000000", Body: "alert" })).text());
    expect(a).toMatch(/WARNING flood|No active alerts/);
    const adv = message(await (await post({ From: "whatsapp:+8801711000000", Body: "3" })).text());
    expect(adv).toContain("1)");
  });

  it("unregistered numbers get sign-up instructions", async () => {
    const xml = await (await post({ From: "+14155550199", Body: "STATUS" })).text();
    expect(message(xml)).toContain("not registered");
  });

  it("replies in the farmer's language (Bengali via MT) and LANG switches it", async () => {
    const bn = getStore().users.find((u) => u.role === "farmer" && u.language === "bn" && u.phone)!;
    const res = await post({ From: bn.phone!, Body: "STATUS" });
    expect(res.headers.get("x-agri-language")).toBe("bn");
    expect(message(await res.text())).toContain("[bn]");

    const sw = await post({ From: bn.phone!, Body: "LANG en" });
    expect(sw.headers.get("x-agri-language")).toBe("en");
    expect(getStore().users.find((u) => u.id === bn.id)!.language).toBe("en");
    expect(getStore().audit[0]!.action).toBe("user.language");
  });

  it("local keyword HELP returns the curated menu", async () => {
    const xml = await (await post({ From: "+8801711000000", Body: "সাহায্য" })).text();
    expect(message(xml)).toContain("এগ্রি-শিল্ড");
  });

  it("validates X-Twilio-Signature when TWILIO_AUTH_TOKEN is set", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "test_auth_token_123");
    const params = { From: "+8801711000000", Body: "STATUS" };
    expect((await post(params)).status).toBe(403);
    expect((await post(params, { "x-twilio-signature": "bogus" })).status).toBe(403);
    const sig = twilioSignature("test_auth_token_123", "http://localhost:3000/api/v1/sms/inbound", params);
    expect((await post(params, { "x-twilio-signature": sig })).status).toBe(200);
  });

  it("rejects invalid senders and rate-limits per number", async () => {
    expect((await post({ From: "hello", Body: "STATUS" })).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await post({ From: "+8801711999999", Body: "HELP" })).status);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("POST /api/v1/alerts/webhook", () => {
  const payload = {
    alert_type: "flood",
    severity: "warning",
    district_ids: ["bd-sylhet"],
    title: "FFWC: Surma above danger level",
    description: "Surma at Sylhet is 42 cm above danger level and rising.",
    recommended_actions: ["Move livestock to raised ground"],
    channels: ["app", "sms"],
    source_system: "BWDB-FFWC",
    external_id: "ffwc-2026-0929-01",
  };
  const send = (body: string, sig?: string) =>
    webhook.POST(req("/api/v1/alerts/webhook", { method: "POST", body, headers: { "content-type": "application/json", ...(sig ? { "x-signature": sig } : {}) } }));

  it("creates a manual-source alert with a valid HMAC", async () => {
    const body = JSON.stringify(payload);
    const res = await send(body, signBody(body, DEV_WEBHOOK_SECRET));
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.created).toBe(1);
    const alert = getStore().alerts.find((a) => a.id === out.alerts[0].id)!;
    expect(alert).toMatchObject({ source: "manual", districtId: "bd-sylhet", alertType: "flood", severity: "warning", createdBy: "webhook:BWDB-FFWC" });
    expect(getStore().audit.some((a) => a.action === "alert.webhook")).toBe(true);
  });

  it("is idempotent on external_id", async () => {
    const body = JSON.stringify({ ...payload, external_id: "dup-1" });
    const sig = signBody(body, DEV_WEBHOOK_SECRET);
    expect((await send(body, sig)).status).toBe(201);
    const again = await send(body, sig);
    expect(again.status).toBe(200);
    expect((await again.json()).duplicate).toBe(true);
  });

  it("maps lat/lon to districts within radius", async () => {
    const body = JSON.stringify({ ...payload, district_ids: undefined, lat: 22.8, lon: 89.5, radius_km: 40, external_id: "geo-1" });
    const out = await (await send(body, signBody(body, DEV_WEBHOOK_SECRET))).json();
    expect(out.alerts.map((a: { districtId: string }) => a.districtId)).toContain("bd-khulna");
  });

  it("rejects bad signatures, bad JSON, invalid payloads and stale timestamps", async () => {
    const body = JSON.stringify(payload);
    expect((await send(body)).status).toBe(401);
    expect((await send(body, signBody(body, "wrong-secret"))).status).toBe(401);
    expect((await send("{nope", signBody("{nope", DEV_WEBHOOK_SECRET))).status).toBe(400);
    const invalid = JSON.stringify({ ...payload, severity: "apocalyptic" });
    expect((await send(invalid, signBody(invalid, DEV_WEBHOOK_SECRET))).status).toBe(422);
    const stale = JSON.stringify({ ...payload, external_id: "stale", timestamp: "2020-01-01T00:00:00Z" });
    expect((await send(stale, signBody(stale, DEV_WEBHOOK_SECRET))).status).toBe(401);
  });

  it("refuses to run in production without a configured secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INBOUND_WEBHOOK_SECRET", "");
    const body = JSON.stringify(payload);
    expect((await send(body, signBody(body, DEV_WEBHOOK_SECRET))).status).toBe(503);
  });
});

describe("GET /api/v1/supply-chain/commodity-risk", () => {
  it("requires a valid key", async () => {
    expect((await commodity.GET(req("/api/v1/supply-chain/commodity-risk"))).status).toBe(401);
    expect((await commodity.GET(req("/api/v1/supply-chain/commodity-risk", { headers: { authorization: "Bearer ags_live_invalidinvalidinvalid" } }))).status).toBe(401);
  });

  it("returns commodity risks for Bearer and X-API-Key auth", async () => {
    const { key } = createApiKey("org-sc-asiagrain", "erp", ["commodities:read"], "live", { id: "u", name: "U" });
    const res = await commodity.GET(req("/api/v1/supply-chain/commodity-risk?horizon=14", { headers: { authorization: `Bearer ${key}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.horizonDays).toBe(14);
    expect(body.commodities.length).toBeGreaterThan(0);
    expect(body.orgId).toBe("org-sc-asiagrain");
    const viaHeader = await commodity.GET(req("/api/v1/supply-chain/commodity-risk", { headers: { "x-api-key": key } }));
    expect((await viaHeader.json()).horizonDays).toBe(7);
  });

  it("validates horizon and scope", async () => {
    const { key } = createApiKey("org-sc-asiagrain", "erp", ["commodities:read"], "live", { id: "u", name: "U" });
    expect((await commodity.GET(req("/api/v1/supply-chain/commodity-risk?horizon=9", { headers: { "x-api-key": key } }))).status).toBe(400);
    const { key: riskOnly } = createApiKey("org-sc-asiagrain", "risk", ["risk:read"], "test", { id: "u", name: "U" });
    expect((await commodity.GET(req("/api/v1/supply-chain/commodity-risk", { headers: { "x-api-key": riskOnly } }))).status).toBe(403);
  });
});

describe("GET /api/v1/openapi.json", () => {
  it("is a valid-looking OpenAPI 3.1 document covering every endpoint", async () => {
    const doc = await openapi.GET(req("/api/v1/openapi.json")).json();
    expect(doc.openapi).toBe("3.1.0");
    for (const p of ["/api/v1/risk", "/api/v1/supply-chain/commodity-risk", "/api/v1/health", "/api/v1/sms/inbound", "/api/v1/alerts/webhook", "/api/v1/cron/{job}"]) expect(doc.paths).toHaveProperty([p]);
    const refs = JSON.stringify(doc).match(/#\/components\/schemas\/(\w+)/g) ?? [];
    for (const r of refs) expect(doc.components.schemas).toHaveProperty([r.split("/").pop()!]);
  });
});

describe("GET /api/v1/cron/[job]", () => {
  const run = (job: string, headers: Record<string, string> = {}) => cron.GET(req(`/api/v1/cron/${job}`, { headers }), { params: Promise.resolve({ job }) });

  it("404s on unknown jobs", async () => {
    expect((await run("mine-bitcoin")).status).toBe(404);
  });

  it("requires the bearer secret when CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await run("notification-dispatch")).status).toBe(401);
    const ok = await run("notification-dispatch", { authorization: "Bearer s3cret" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("success");
  });
});
