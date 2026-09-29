/**
 * supplyChainRouter — Supply-chain portal (spec §4.6 + §5.4).
 * Reads are guarded by "view_supply_chain"; integration writes by "manage_integrations".
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { permitted, router } from "../trpc";
import { audit, getStore, nextId } from "../data/store";
import { API_SCOPES, COMMODITY_LABEL, CROP_YIELD_T_HA, WEBHOOK_EVENTS } from "../data/sc-reference";
import { scState } from "../data/sc-state";
import {
  alternativeSuppliers,
  assertSafeWebhookUrl,
  computeCommodityRisks,
  createApiKey,
  deliverWebhook,
  evaluateWebhooks,
  getNetwork,
  getNodeDetail,
  getOverview,
  getScenario,
  hasHash,
  historicalAnalogs,
  latestPrice,
  listScenarios,
  maskSecret,
  newWebhookSecret,
  priceHistoryWithForecast,
  productionContext,
  runScenario,
  sampleEventData,
  signPayload,
} from "../services/supply-chain";
import type { WebhookRecord } from "../data/store";

const view = permitted("view_supply_chain");
const manage = permitted("manage_integrations");

const horizon = z.union([z.literal(7), z.literal(14), z.literal(30)]);
const commodity = z.string().min(2).max(32);
const eventIds = WEBHOOK_EVENTS.map((e) => e.id) as [string, ...string[]];

type Ctx = { user: { id: string; name?: string | null; orgId: string | null; role: string } };
const orgOf = (ctx: Ctx) => ctx.user.orgId ?? "org-sc-asiagrain";
const actor = (ctx: Ctx) => ({ id: ctx.user.id, name: ctx.user.name ?? ctx.user.id });

function publicWebhook(w: WebhookRecord) {
  const st = scState();
  const deliveries = st.deliveries.filter((d) => d.webhookId === w.id);
  const ok = deliveries.filter((d) => d.ok).length;
  return {
    id: w.id,
    name: st.webhookNames.get(w.id) ?? new URL(w.url).hostname,
    url: w.url,
    commodities: w.commodities,
    riskThreshold: w.riskThreshold,
    events: w.events,
    active: w.active,
    secretMasked: maskSecret(w.secret),
    createdAt: w.createdAt,
    lastDelivery: w.lastDelivery,
    deliveries: deliveries.length,
    successRate: deliveries.length ? Math.round((ok / deliveries.length) * 100) : null,
  };
}

function ownedWebhook(ctx: Ctx, id: string) {
  const w = getStore().webhooks.find((x) => x.id === id && (x.orgId === orgOf(ctx) || ctx.user.role === "platform_admin"));
  if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
  return w;
}

const webhookInput = z.object({
  name: z.string().trim().min(2).max(60),
  url: z.string().url().max(500),
  commodities: z.array(commodity).min(1).max(10),
  riskThreshold: z.number().int().min(1).max(100),
  events: z.array(z.enum(eventIds)).min(1),
});

export const supplyChainRouter = router({
  ping: view.query(() => ({ ok: true })),

  // ─── Risk overview ───────────────────────────────────────────────────
  getOverview: view.query(({ ctx }) => getOverview(ctx.user.orgId)),
  getNetwork: view.query(({ ctx }) => getNetwork(ctx.user.orgId)),
  getNode: view.input(z.object({ id: z.string().min(3).max(40) })).query(async ({ ctx, input }) => {
    const r = await getNodeDetail(input.id, ctx.user.orgId);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
    return r;
  }),

  // ─── Commodities ─────────────────────────────────────────────────────
  getCommodityRisks: view.input(z.object({ horizon: horizon.default(7) }).nullish()).query(({ input }) => computeCommodityRisks(input?.horizon ?? 7)),
  getHistoricalAnalogs: view.input(z.object({ commodity })).query(({ input }) => historicalAnalogs(input.commodity)),
  getPriceHistory: view.input(z.object({ commodity, horizon: horizon.default(14) })).query(async ({ input }) => {
    const r = await priceHistoryWithForecast(input.commodity, input.horizon);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown commodity" });
    return r;
  }),
  getProductionContext: view.query(() => productionContext()),

  // ─── Scenarios ───────────────────────────────────────────────────────
  getScenarioOptions: view.query(() => {
    const s = getStore();
    return {
      commodities: s.commodities.map((c) => ({ id: c.commodity, label: COMMODITY_LABEL[c.commodity] ?? c.commodity, price: latestPrice(c), producingDistricts: c.producingDistricts, yieldTHa: CROP_YIELD_T_HA[c.commodity] ?? null })),
      regions: s.districts.map((d) => ({ id: d.id, name: d.name, country: d.countryName, basin: d.basin, floodRisk: d.floodRisk, salinityRisk: d.salinityRisk, primaryCrops: d.primaryCrops })),
    };
  }),
  runScenario: view
    .input(
      z.object({
        commodity,
        regionIds: z.array(z.string().min(3).max(40)).min(1).max(12),
        intensity: z.number().min(1).max(5),
        durationDays: z.number().int().min(1).max(30),
        simulations: z.number().int().min(200).max(10000).default(2000),
        label: z.string().max(120).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await runScenario(input, ctx.user);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
    }),
  listScenarios: view.query(({ ctx }) => listScenarios(ctx.user.orgId)),
  getScenario: view.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const r = getScenario(input.id, ctx.user.orgId);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Scenario not found" });
    return r;
  }),

  // ─── Procurement ─────────────────────────────────────────────────────
  getAlternativeSuppliers: view
    .input(z.object({ commodity, excludeDistrictIds: z.array(z.string()).max(20).default([]) }))
    .query(async ({ ctx, input }) => {
      const r = await alternativeSuppliers(input.commodity, input.excludeDistrictIds, ctx.user.orgId);
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown commodity" });
      return r;
    }),

  // ─── Webhooks ────────────────────────────────────────────────────────
  listWebhooks: view.query(({ ctx }) => ({
    webhooks: getStore().webhooks.filter((w) => w.orgId === orgOf(ctx)).map(publicWebhook),
    events: WEBHOOK_EVENTS,
    commodities: getStore().commodities.map((c) => ({ id: c.commodity, label: COMMODITY_LABEL[c.commodity] ?? c.commodity })),
  })),
  createWebhook: manage.input(webhookInput).mutation(({ ctx, input }) => {
    let url: string;
    try {
      url = assertSafeWebhookUrl(input.url);
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
    }
    const secret = newWebhookSecret();
    const w: WebhookRecord = { id: nextId("whk"), orgId: orgOf(ctx), url, commodities: input.commodities, riskThreshold: input.riskThreshold, events: input.events, active: true, secret, createdAt: new Date(), lastDelivery: null };
    getStore().webhooks.unshift(w);
    scState().webhookNames.set(w.id, input.name);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "webhook.create", entity: "webhook", entityId: w.id, details: `${input.name} → ${url}` });
    return { webhook: publicWebhook(w), secret };
  }),
  updateWebhook: manage.input(webhookInput.partial().extend({ id: z.string() })).mutation(({ ctx, input }) => {
    const w = ownedWebhook(ctx, input.id);
    if (input.url) {
      try {
        w.url = assertSafeWebhookUrl(input.url);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
    }
    if (input.commodities) w.commodities = input.commodities;
    if (input.riskThreshold != null) w.riskThreshold = input.riskThreshold;
    if (input.events) w.events = input.events;
    if (input.name) scState().webhookNames.set(w.id, input.name);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "webhook.update", entity: "webhook", entityId: w.id, details: w.url });
    return publicWebhook(w);
  }),
  toggleWebhook: manage.input(z.object({ id: z.string(), active: z.boolean() })).mutation(({ ctx, input }) => {
    const w = ownedWebhook(ctx, input.id);
    w.active = input.active;
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: input.active ? "webhook.enable" : "webhook.disable", entity: "webhook", entityId: w.id, details: w.url });
    return publicWebhook(w);
  }),
  deleteWebhook: manage.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const w = ownedWebhook(ctx, input.id);
    const s = getStore();
    s.webhooks = s.webhooks.filter((x) => x.id !== w.id);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "webhook.delete", entity: "webhook", entityId: w.id, details: w.url });
    return { ok: true };
  }),
  rotateWebhookSecret: manage.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const w = ownedWebhook(ctx, input.id);
    w.secret = newWebhookSecret();
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "webhook.rotate_secret", entity: "webhook", entityId: w.id, details: w.url });
    return { secret: w.secret };
  }),
  sendTestWebhook: manage.input(z.object({ id: z.string(), event: z.enum(eventIds).optional() })).mutation(async ({ ctx, input }) => {
    const w = ownedWebhook(ctx, input.id);
    const event = input.event ?? w.events[0] ?? "commodity.risk.threshold";
    const data = await sampleEventData(event, w.commodities);
    const d = await deliverWebhook(w, event, { threshold: w.riskThreshold, ...data }, "test");
    return { ...d, at: d.at.toISOString() };
  }),
  listDeliveries: view.input(z.object({ webhookId: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) }).nullish()).query(({ ctx, input }) =>
    scState()
      .deliveries.filter((d) => d.orgId === orgOf(ctx) && (!input?.webhookId || d.webhookId === input.webhookId))
      .slice(0, input?.limit ?? 30)
      .map((d) => ({ ...d, at: d.at.toISOString() }))
  ),
  evaluateWebhooksNow: manage.mutation(({ ctx }) => evaluateWebhooks({ orgId: orgOf(ctx), force: true })),

  // ─── API keys ────────────────────────────────────────────────────────
  listApiKeys: view.query(({ ctx }) => ({
    keys: getStore()
      .apiKeys.filter((k) => k.orgId === orgOf(ctx))
      .map((k) => ({ ...k, managedHash: hasHash(k.id) })),
    scopes: API_SCOPES,
  })),
  createApiKey: manage
    .input(z.object({ name: z.string().trim().min(2).max(60), scopes: z.array(z.enum(API_SCOPES)).min(1), environment: z.enum(["live", "test"]).default("live") }))
    .mutation(({ ctx, input }) => {
      const { record, key } = createApiKey(orgOf(ctx), input.name, input.scopes, input.environment, actor(ctx));
      return { record, key };
    }),
  revokeApiKey: manage.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const s = getStore();
    const k = s.apiKeys.find((x) => x.id === input.id && x.orgId === orgOf(ctx));
    if (!k) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
    s.apiKeys = s.apiKeys.filter((x) => x.id !== k.id);
    scState().keyHashes.delete(k.id);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "apikey.revoke", entity: "api_key", entityId: k.id, details: k.name });
    return { ok: true };
  }),

  // ─── Integration docs ────────────────────────────────────────────────
  getIntegrationDocs: view.query(async ({ ctx }) => {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const sampleSecret = "whsec_your_signing_secret";
    const samples = await Promise.all(
      WEBHOOK_EVENTS.map(async (e) => {
        const data = await sampleEventData(e.id, ["rice", "jute"]);
        const payload = { id: "dlv_3f9a0c1e7b2d4a6c8e10", event: e.id, created: Math.floor(Date.now() / 1000), test: false, org_id: orgOf(ctx), webhook_id: "whk_example", data };
        const raw = JSON.stringify(payload, null, 2);
        return { event: e.id, label: e.label, payload: raw, signature: signPayload(sampleSecret, JSON.stringify(payload)) };
      })
    );
    return {
      baseUrl: base,
      headers: [
        { name: "X-AgriShield-Event", description: "Event type, e.g. commodity.risk.threshold" },
        { name: "X-AgriShield-Signature", description: "sha256=<hex HMAC-SHA256 of the raw request body using your webhook secret>" },
        { name: "X-AgriShield-Delivery", description: "Unique delivery id — use it to de-duplicate retries" },
        { name: "X-AgriShield-Timestamp", description: "Unix seconds when the payload was signed; reject if older than 5 minutes" },
      ],
      samples,
      snippets: {
        curlRest: `curl -s "${base}/api/v1/supply-chain/commodity-risk?horizon=7" \\\n  -H "Authorization: Bearer ags_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"`,
        curlVerify: `# Re-create a signature locally to debug your endpoint\nBODY='{"id":"dlv_test","event":"commodity.risk.threshold"}'\nprintf '%s' "$BODY" | openssl dgst -sha256 -hmac "$AGRISHIELD_WEBHOOK_SECRET" | sed 's/^.* /sha256=/'`,
        node: `import crypto from "node:crypto";
import express from "express";

const app = express();
// Keep the raw body — the signature is computed over the exact bytes we sent.
app.post("/hooks/agrishield", express.raw({ type: "application/json" }), (req, res) => {
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.AGRISHIELD_WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex");
  const given = req.get("X-AgriShield-Signature") ?? "";
  const ok = given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  const fresh = Math.abs(Date.now() / 1000 - Number(req.get("X-AgriShield-Timestamp"))) < 300;
  if (!ok || !fresh) return res.status(401).send("invalid signature");

  const event = JSON.parse(req.body.toString("utf8"));
  if (event.event === "commodity.risk.threshold") {
    // e.g. raise a purchase requisition / reroute in your ERP
    console.log(event.data.commodity, event.data.risk_score, event.data.price_impact_pct);
  }
  res.sendStatus(204);
});
app.listen(8080);`,
        python: `import hmac, hashlib, os, time, json
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
SECRET = os.environ["AGRISHIELD_WEBHOOK_SECRET"].encode()

@app.post("/hooks/agrishield")
async def agrishield_hook(request: Request):
    raw = await request.body()  # exact bytes that were signed
    expected = "sha256=" + hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
    given = request.headers.get("X-AgriShield-Signature", "")
    ts = int(request.headers.get("X-AgriShield-Timestamp", "0"))
    if not hmac.compare_digest(given, expected) or abs(time.time() - ts) > 300:
        raise HTTPException(status_code=401, detail="invalid signature")

    event = json.loads(raw)
    if event["event"] == "commodity.risk.threshold":
        d = event["data"]
        print(d["commodity"], d["risk_score"], d["price_impact_pct"])
    return {"received": True}`,
      },
      retryPolicy: "Non-2xx responses and timeouts (10 s) are logged in the delivery log; threshold events re-fire after 6 h or when risk rises ≥5 points.",
      rateLimits: "REST: 100 requests/min per key, 1,000/min per organisation.",
    };
  }),
});
