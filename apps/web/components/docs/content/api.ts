export const API_REFERENCE = `The public REST API lives under \`/api/v1\`. It returns JSON (TwiML for SMS), is described by an OpenAPI 3.1 document at [/api/v1/openapi.json](/api/v1/openapi.json), and shares its data with the web portals.

## Conventions

- **Base URL**: \`https://<your-deployment>/api/v1\` (locally \`http://localhost:3000/api/v1\`).
- **Authentication**: send an API key in the \`X-API-Key\` header. Keys are optional for \`/risk\` today (anonymous calls get lower limits); when sent, the key must carry the right scope. \`Authorization: Bearer\` is **not** accepted for API keys.
- **Errors** always look like \`{"error": {"code": "...", "message": "..."}}\`; validation errors add \`issues\`.
- **Request IDs**: every JSON response carries \`X-Request-Id\` (echoed from your \`x-request-id\` if you send one).
- **CORS**: allowed for the configured app origin (\`CORS_ORIGINS\`), methods \`GET, POST, OPTIONS\`.

| Caller | Limit |
| --- | --- |
| Anonymous (per IP) | 30 requests / minute |
| With API key (per key) | 600 requests / minute |
| Per organisation (all keys) | 1,000 requests / minute |

Over the limit you get \`429 rate_limited\` with \`Retry-After: 60\`.

### API keys and scopes

Create keys in the supply-chain portal under **Integrations**. Keys look like \`ags_live_\` or \`ags_test_\` followed by 32 base-62 characters. Only a SHA-256 hash is stored, so copy the key when it is shown.

| Scope | Grants |
| --- | --- |
| \`risk:read\` | \`GET /api/v1/risk\` |
| \`commodities:read\` | Commodity risk in the portal API |
| \`network:read\` | Supply-chain network |
| \`scenarios:run\` | Scenario runs |
| \`webhooks:manage\` | Create and rotate webhooks |

## GET /risk

Point flood or salinity risk for any coordinate, enriched with the nearest monitored district's live values.

| Query | Type | Default | Notes |
| --- | --- | --- | --- |
| \`lat\` | number | required | −90 to 90 |
| \`lon\` | number | required | −180 to 180 |
| \`type\` | \`flood\` \\| \`salinity\` | \`flood\` | |
| \`crop\` | string | \`rice\` | rice, wheat, maize, sugarcane, jute, coconut, vegetables, sorghum, barley, potato, onion, cotton, tobacco, banana, mango |

\`\`\`bash
curl -H "X-API-Key: $AGRI_KEY" \\
  "https://agrishield.io/api/v1/risk?lat=22.70&lon=90.36&type=flood"
\`\`\`

\`\`\`json
{
  "type": "flood",
  "location": { "lat": 22.7, "lon": 90.36 },
  "risk": {
    "probability_24h": 0.41,
    "probability_48h": 0.55,
    "probability_72h": 0.63,
    "estimated_depth_m": 0.46,
    "confidence_interval": [0.54, 0.7],
    "contributing_factors": ["above_avg_rainfall_72h", "high_soil_saturation"],
    "risk_level": "high",
    "model_version": "flood-ens-v2.1.0",
    "hourly": [{ "time": "2026-09-29T06:00", "precip_mm": 3.2, "probability": 0.44 }],
    "engine": "ml",
    "source": "ml-api"
  },
  "nearestDistrict": {
    "id": "bd-barisal", "name": "Barisal", "country": "Bangladesh", "distanceKm": 0.4,
    "inCoverage": true, "floodRisk": 63, "floodProb72h": 0.63, "salinityRisk": 41,
    "ecCurrent": 3.8, "riskLevel": "high", "liveSource": "open-meteo",
    "lastUpdated": "2026-09-29T05:40:00.000Z"
  },
  "scenario": "live",
  "apiVersion": "1.0.0",
  "authenticated": true,
  "generatedAt": "2026-09-29T05:52:10.114Z",
  "attribution": "..."
}
\`\`\`

With \`type=salinity\` the \`risk\` object contains \`ec_current\`, \`ec_predicted_7d\`, \`ec_predicted_30d\` (dS/m), \`risk_level\` (\`safe\`, \`sensitive\`, \`moderate\`, \`severe\`), \`crop_damage_probability\`, \`recommended_crops\`, \`mitigation_actions\`, \`confidence\` and \`model_version\`. When the ML service answers you also get \`ec_predicted_90d\`, \`crop_thresholds\`, \`features\` and \`degraded_inputs\`. If the ML service is down, the web formula answers with \`source: "web-fallback"\`.

Responses are cacheable (\`s-maxage=300\`). Errors: \`400 invalid_request\`, \`401\`, \`403\` (missing scope), \`429\`, \`502 upstream_error\`.

## GET /health

Uptime and dependency status, no auth. \`?deep=0\` skips the external probes for cheap load-balancer checks.

\`\`\`json
{
  "status": "ok",
  "checkedAt": "2026-09-29T05:52:00.000Z",
  "web": { "status": "up", "apiVersion": "1.0.0", "uptimeSec": 5230, "dataMode": "in-memory" },
  "ml": { "status": "up", "latencyMs": 38, "url": "http://localhost:8000", "fallback": null },
  "dataSources": { "summary": "operational", "sources": [ { "name": "Open-Meteo forecast", "status": "up", "latencyMs": 212 } ] },
  "liveRisk": { "lastRefresh": "2026-09-29T05:40:00.000Z" },
  "jobs": [ { "name": "climate-scan", "schedule": "*/30 * * * *", "lastStatus": "success" } ],
  "store": { "districts": 22, "liveDistricts": 22, "activeAlerts": 9 }
}
\`\`\`

\`status\` becomes \`degraded\` on a major outage of the data sources. The HTTP status is always 200, so alert on the body.

## POST /sms/inbound

Twilio Messaging webhook for feature-phone farmers. Point your Twilio number's *A message comes in* webhook here.

- **Body**: \`application/x-www-form-urlencoded\` from Twilio (\`From\`, \`Body\`, …), max 8,000 characters.
- **Signature**: when \`TWILIO_AUTH_TOKEN\` is set, \`X-Twilio-Signature\` is verified (HMAC-SHA1 over the URL plus sorted parameters). Set \`TWILIO_WEBHOOK_URL\` if a proxy rewrites the host.
- **Limit**: 10 messages per minute per phone number.
- **Reply**: TwiML \`<Response><Message>…</Message></Response>\`, trimmed to two SMS segments. Headers \`X-Agri-Command\`, \`X-Agri-Language\`, \`X-Agri-Segments\` and \`X-Agri-Encoding\` show how it was handled.

| Command | Aliases | Reply |
| --- | --- | --- |
| \`STATUS\` | \`RISK\`, \`1\` | Flood and salinity risk for the registered farm |
| \`ALERT\` | \`ALERTS\`, \`2\` | Active alerts |
| \`ADVICE\` | \`TIPS\`, \`3\` | Top three recommendations |
| \`HELP\` | \`MENU\`, \`0\`, \`?\` | Command list |
| \`LANG bn\` | \`LANGUAGE\` | Switch reply language (en, bn, hi, vi, fil, id, ta, si) |
| \`STOP\` / \`START\` | \`UNSUBSCRIBE\` / \`SUBSCRIBE\` | Opt out / back in |

Local-language keywords also work, for example Filipino \`KALAGAYAN\`, \`BABALA\`, \`PAYO\` and Indonesian \`RISIKO\`, \`PERINGATAN\`, \`SARAN\`.

\`\`\`bash
curl -X POST http://localhost:3000/api/v1/sms/inbound \\
  -d "From=+8801711000000" -d "Body=STATUS"
\`\`\`

## POST /alerts/webhook

Lets national met services, river-gauge networks and partner NGOs push alerts into Agri-SHIELD. Alerts are matched to districts, broadcast to the portals and written to the audit log.

**Signature**: \`X-Signature: sha256=<hex>\` where hex is HMAC-SHA256 of the raw body with \`INBOUND_WEBHOOK_SECRET\`. Outside production the default secret is \`agri-shield-dev-webhook-secret\`; in production the endpoint returns 503 until a secret is set.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| \`alert_type\` | \`flood\` \\| \`salinity\` \\| \`drought\` \\| \`storm\` \\| \`frost\` | yes | |
| \`severity\` | \`watch\` \\| \`warning\` \\| \`emergency\` | yes | |
| \`title\` | string 5-160 | yes | |
| \`description\` | string 10-2000 | yes | |
| \`source_system\` | string 2-60 | yes | e.g. \`BMD\`, \`FFWC\` |
| \`district_ids\` | string[] ≤ 30 | one of | e.g. \`["bd-barisal"]\` |
| \`lat\`, \`lon\`, \`radius_km\` | numbers | one of | radius 1-300 km, default 80 |
| \`recommended_actions\` | string[] ≤ 6 | no | |
| \`channels\` | \`app\`, \`sms\`, \`whatsapp\`, \`email\` | no | default \`["app","sms"]\` |
| \`valid_hours\` | 1-720 | no | default 72 |
| \`external_id\` | string ≤ 120 | no | makes delivery idempotent per \`source_system\` |
| \`timestamp\` | ISO 8601 | no | if present must be within ±10 minutes |

\`\`\`json
{
  "alert_type": "flood",
  "severity": "warning",
  "title": "Kirtankhola above danger level",
  "description": "Water level at Barisal gauge 0.4 m above danger level and rising.",
  "district_ids": ["bd-barisal", "bd-patuakhali"],
  "recommended_actions": ["Move livestock to raised platforms", "Harvest mature paddy"],
  "source_system": "FFWC",
  "external_id": "ffwc-2026-09-29-0600",
  "timestamp": "2026-09-29T06:00:00Z"
}
\`\`\`

Responses: \`201 {"created": 2, "alerts": [{"id", "districtId", "title", "severity", "validUntil"}], "recommendationsCreated": 4}\`; a repeated \`external_id\` returns \`200 {"duplicate": true, "alertIds": [...]}\`. Errors: \`401 invalid_signature\` / \`stale_request\`, \`400 invalid_json\`, \`413 payload_too_large\` (> 32 kB), \`422 invalid_payload\` / \`no_districts\`, \`429\` (60/min per IP).

## GET /cron/{job}

Triggers background jobs from Vercel Cron, GitHub Actions or an uptime pinger: \`climate-scan\`, \`notification-dispatch\`, \`satellite-ingest\`, \`model-retrain\`. Requires \`Authorization: Bearer $CRON_SECRET\` in production. Waits up to 50 s; returns \`200\` with a run summary, or \`202\` if the job is still running.

## GET /openapi.json

Machine-readable OpenAPI 3.1 description of the endpoints above, with security schemes \`ApiKeyAuth\`, \`HmacSignature\`, \`TwilioSignature\` and \`CronBearer\`. Import it into Postman, Insomnia or a code generator.

## Billing webhooks

| Endpoint | Provider | Verification |
| --- | --- | --- |
| \`POST /api/billing/webhook\` | Stripe | \`Stripe-Signature: t=…,v1=…\`, HMAC-SHA256 of \`t.payload\` with \`STRIPE_WEBHOOK_SECRET\`, 5-minute tolerance |
| \`POST /api/billing/razorpay\` | Razorpay | \`X-Razorpay-Signature\`, HMAC-SHA256 of the raw body with \`RAZORPAY_WEBHOOK_SECRET\` |

Handled Stripe events: \`checkout.session.completed\`, \`customer.subscription.created|updated|deleted\`, \`invoice.payment_failed\`. Razorpay: \`payment_link.paid\`.
`;

export const ML_API = `The ML service is a FastAPI app (\`apps/ml-api\`, port 8000). The web platform calls it through \`server/ml-client.ts\` with the \`ML_API_URL\` base URL and falls back to its own formulas if it is unreachable. Interactive docs are served by the service itself at \`/docs\` (Swagger UI) and \`/redoc\`.

> [!NOTE]
> The \`/api/ml/*\` endpoints have no authentication of their own and should sit on a private network behind the web app. Only \`/api/ml/retrain\` checks \`X-API-Key\` against \`ML_API_KEY\` when that variable is set.

## POST /api/ml/flood-risk

\`\`\`json
{ "lat": 22.70, "lon": 90.36, "forecast_days": 3 }
\`\`\`

Returns 24/48/72 h probabilities, \`estimated_depth_m\`, a 90% \`confidence_interval\` from 40 Monte Carlo draws, \`contributing_factors\`, \`factor_contributions\`, \`features\` (\`rain_next_24h_mm\`, \`rain_next_72h_mm\`, \`rain_past_7d_mm\`, \`soil_moisture\`, \`discharge_ratio_p95\`, \`elevation_m\`, \`coast_distance_km\`, \`flood_exposure_prior\`), \`site\` (matched and nearest district), \`data_sources\`, \`degraded_inputs\`, \`engine\` and \`model_version\`. 503 if prediction fails.

## POST /api/ml/salinity-risk

\`\`\`json
{ "lat": 10.24, "lon": 106.38, "crop_type": "rice", "prediction_horizon_days": 30 }
\`\`\`

Returns \`ec_current\`, \`ec_predicted_7d\`, \`ec_predicted_30d\`, \`ec_predicted_90d\` (dS/m), \`risk_level\`, \`crop_damage_probability\`, \`crop_thresholds\`, \`recommended_crops\`, \`mitigation_actions\`, \`confidence\` and \`model_version\`.

## POST /api/ml/advisor

\`\`\`json
{
  "question": "Should I transplant this week?",
  "farmer_context": { "name": "Ratan", "crops": ["rice"], "area_ha": 1.2, "district": "Barisal", "country": "Bangladesh",
                      "flood_probability": 0.63, "salinity_ec": 3.8, "forecast_summary": "92 mm rain in 72 h" },
  "language": "bn",
  "history": []
}
\`\`\`

Response: \`answer\` (Markdown), \`actions[]\` (\`id\`, \`label\`, \`description\`, \`urgency\`), \`sources[]\` (retrieved knowledge snippets with scores), \`confidence\`, \`language\`, \`provider\`, \`translation\`, \`latency_ms\`.

Answers are grounded with TF-IDF retrieval over the service's agronomy knowledge base (top 5 chunks). The first configured LLM provider answers: Anthropic (\`ANTHROPIC_API_KEY\`), OpenAI (\`OPENAI_API_KEY\`), Groq (\`GROQ_API_KEY\`) or a local Ollama (\`OLLAMA_BASE_URL\`). With none configured, a deterministic composer builds the answer from the retrieved guidance (\`provider: "local-grounded"\`) and it is translated with DeepL or MyMemory.

## POST /api/ml/supply-chain/scenario

\`\`\`json
{ "commodity": "rice", "region_ids": ["vn-bentre", "vn-soctrang"], "intensity": 4, "duration_days": 10, "simulations": 5000, "seed": 42 }
\`\`\`

Runs the Monte Carlo described in [Supply-chain impact](/docs/supply-chain-model). Returns \`disruption_probability\`, \`volume_loss_tonnes\` and \`volume_loss_ci\`, \`estimated_loss_usd\` and \`loss_usd_ci\`, \`value_at_risk_95_usd\`, \`price_impact_pct\` and \`price_impact_ci\`, \`recovery_days\`, a 20-bucket \`histogram\`, \`affected_nodes\`, per-region \`regions\` and \`model_version\`.

## GET /api/ml/metrics

\`\`\`json
{
  "models": [
    { "name": "flood-ensemble (temporal-MLP + HistGBM)", "version": "v2.1.0", "auc": 0.968, "f1": 0.759, "brier": 0.036,
      "trained_at": "…", "drift_psi": 0.018, "samples": 56188 },
    { "name": "salinity-histgbm (EC 0/7/30/90 d)", "version": "v1.5.0", "rmse": 1.066, "r2": 0.859 },
    { "name": "supply-chain-impact (Monte Carlo)", "version": "v1.2.0" }
  ],
  "status": "ok",
  "last_retrain": null
}
\`\`\`

Metrics come from the held-out 2024-2025 test split at training time. See [Flood model](/docs/methodology-flood) for what they mean.

## POST /api/ml/retrain

\`{"refresh_data": false, "force": false}\` retrains candidates and promotes them only if they beat the deployed model (\`decision\`: \`promoted\`, \`kept_deployed\` or \`skipped\`). Triggered weekly by the \`model-retrain\` job.

## Legacy formula endpoints

\`/api/v1/weather/current\`, \`/api/v1/flood-risk/predict\`, \`/api/v1/salinity/predict\`, \`/api/v1/crop-health/score\`, \`/api/v1/supply-chain/risk\` and \`/api/v1/alerts/generate\` remain available on the ML service for transparent, formula-based scoring. Health: \`/health\`, \`/health/ready\`, \`/health/live\`.
`;

export const TRPC_REFERENCE = `The web app talks to its server through **tRPC v11** at \`/api/trpc\` (superjson transformer, batched HTTP). These procedures are internal to the web app rather than a stable public API, but they are typed end to end and every input is validated with Zod.

## Access levels

| Level | Meaning |
| --- | --- |
| public | No session needed. Rate-limited to 100/min per IP |
| protected | Signed-in user |
| permission | Role must hold the permission in \`lib/rbac.ts\` |

## Routers

| Router | Access | Procedures |
| --- | --- | --- |
| \`public\` | public | \`stats\`, \`riskMap\`, \`hazards\`, \`countries\`, \`weather\`, \`geocode\` |
| \`auth\` | mixed | \`requestOtp\`, \`register\` (public); \`me\`, \`setLanguage\` (protected) |
| \`ml\` | mixed | \`getFloodRisk\`, \`getSalinityRisk\`, \`getModelMetrics\`, \`health\` (public); \`askAdvisor\` (protected) |
| \`farmer\` | \`view_farm_data\` | \`getProfile\`, \`getFields\`, \`getCurrentRisk\`, \`getWeather\`, \`getHistory\`, \`getAlerts\`, \`getRecommendations\`, \`markAlertActioned\`, \`logFarmerAction\`, \`getActions\`, \`updateNotificationPrefs\`, \`updateProfile\`, \`updateField\`, \`exportData\`, \`getReferral\`, \`getMapLayers\`, \`getAdvisorContext\`, \`translateText\`, \`completeOnboarding\` |
| \`government\` | \`view_gov_dashboard\` (+ \`request_resources\`, \`approve_resources\`, \`create_alert\` for writes) | \`getOverview\`, \`getRegionMap\`, \`getDistrict\`, \`getHazards\`, \`getOpsFeed\`, \`getResourceInventory\`, \`getResourceRequests\`, \`getShortages\`, \`requestResources\`, \`approveResourceRequest\`, \`rejectResourceRequest\`, \`dispatchResources\`, \`markDelivered\`, \`getAlertTemplates\`, \`previewAlert\`, \`createAlert\`, \`getAlertHistory\`, \`getAlertReceipts\`, \`getEscalationRules\`, \`getAnalytics\`, \`getRainfallAnomaly\`, \`getPolicyBriefs\`, \`getInfrastructureGaps\` |
| \`supplyChain\` | \`view_supply_chain\` (+ \`manage_integrations\` for writes) | \`getOverview\`, \`getNetwork\`, \`getNode\`, \`getCommodityRisks\`, \`getPriceHistory\`, \`runScenario\`, \`listScenarios\`, \`getAlternativeSuppliers\`, \`listWebhooks\`, \`createWebhook\`, \`rotateWebhookSecret\`, \`sendTestWebhook\`, \`listDeliveries\`, \`listApiKeys\`, \`createApiKey\`, \`revokeApiKey\` |
| \`admin\` | \`access_admin_panel\` | \`overview\`, \`users.*\`, \`orgs.*\`, \`models\`, \`retrain\`, \`sources\`, \`jobs\`, \`runJob\`, \`audit\`, \`billing\`, \`flags\`, \`outbox\`, \`scenario\`, \`setScenario\`, \`resetDemo\` |
| \`billing\` | mixed | \`getPlans\`, \`submitLead\` (public); \`getSubscription\`, \`startCheckout\`, \`confirmSandbox\`, \`confirmStripeSession\`, \`cancel\` (protected); \`listLeads\` (admin) |

## Calling from React

\`\`\`tsx
import { trpc } from "@/lib/trpc";

const risk = trpc.public.riskMap.useQuery({ country: "BD" });
const act = trpc.farmer.markAlertActioned.useMutation();
act.mutate({ id: alertId, actions: ["Opened bunds"], note: "Drained by 6 pm" });
\`\`\`

## Offline behaviour

The service worker caches successful \`GET\` calls to \`farmer.*\` and \`public.*\` for 72 hours and serves them when offline. \`farmer.markAlertActioned\` and \`farmer.logFarmerAction\` mutations made offline are queued in IndexedDB and replayed on reconnect; the UI receives \`{ queued: true }\` immediately.

## Realtime

\`GET /api/realtime?rooms=global,district:bd-barisal\` is a Server-Sent Events stream of \`alert.created\`, \`alert.actioned\`, \`resource.updated\`, \`risk.updated\`, \`scan.completed\` and \`sms.inbound\` events (Socket.io \`agri:event\` when run with the custom server).
`;

export const INTEGRATION_GUIDE = `How to connect ERP, procurement, insurance or government systems to Agri-SHIELD.

## 1. Get an API key

In the supply-chain portal go to **Integrations → API keys → Create key**, choose scopes, and copy the key (shown once). Send it as \`X-API-Key\`:

\`\`\`bash
curl -H "X-API-Key: ags_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" \\
  "https://agrishield.io/api/v1/risk?lat=10.24&lon=106.38&type=salinity&crop=rice"
\`\`\`

## 2. Receive webhooks

Create a webhook under **Integrations → Webhooks** with an HTTPS URL, the commodities to watch and a risk threshold (1-100). Agri-SHIELD evaluates thresholds on every climate scan (every 30 minutes) and posts JSON when they are crossed.

| Event | When |
| --- | --- |
| \`commodity.risk.threshold\` | A watched commodity's risk score crosses your threshold |
| \`node.flood.warning\` | One of your supply nodes crosses the threshold for flooding |
| \`scenario.critical\` | Sent by **Send test** with sample data (automatic delivery planned) |
| \`supplier.alternative.available\` | Sent by **Send test** with sample data (automatic delivery planned) |

A pair re-fires only after 6 hours or when the score rises by 5 points or more.

### Headers

| Header | Value |
| --- | --- |
| \`X-AgriShield-Event\` | Event name |
| \`X-AgriShield-Delivery\` | Unique delivery id (same as payload \`id\`) |
| \`X-AgriShield-Timestamp\` | Unix seconds |
| \`X-AgriShield-Signature\` | \`sha256=\` + hex HMAC-SHA256 of the raw body, keyed with your \`whsec_…\` secret |
| \`User-Agent\` | \`Agri-SHIELD-Webhooks/1.0\` |

### Payload

\`\`\`json
{
  "id": "dlv_4f9a0c1e7b2d3a6f8e10",
  "event": "commodity.risk.threshold",
  "created": 1790659200,
  "test": false,
  "org_id": "org-sc-asiagrain",
  "webhook_id": "wh_…",
  "data": {
    "threshold": 60,
    "commodity": "rice",
    "risk_score": 72,
    "risk_level": "high",
    "horizon_days": 7,
    "supply_disruption_pct": 18.4,
    "price_impact_pct": 6.2,
    "at_risk_volume_tonnes": 12400,
    "regions": [{ "district_id": "vn-bentre", "name": "Bến Tre", "country": "Vietnam", "risk": 78, "loss_pct": 21 }],
    "drivers": ["salinity intrusion", "above-normal discharge"],
    "dashboard_url": "https://agrishield.io/dashboard/supply-chain/commodities"
  }
}
\`\`\`

Deliveries are attempted once with a 10-second timeout and logged (request and response) under **Integrations → Deliveries**; respond \`2xx\` quickly and process asynchronously. Use **Evaluate now** to force a re-check.

## 3. Verify signatures

Compute HMAC-SHA256 over the **exact raw body bytes**, compare in constant time, and reject timestamps older than 5 minutes. Deduplicate on \`X-AgriShield-Delivery\`.

### Node.js (Express)

\`\`\`js
import crypto from "node:crypto";
import express from "express";

const app = express();
const SECRET = process.env.AGRISHIELD_WEBHOOK_SECRET; // whsec_...

app.post("/hooks/agrishield", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.get("X-AgriShield-Signature") || "";
  const ts = Number(req.get("X-AgriShield-Timestamp"));
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(req.body).digest("hex");

  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  const fresh = Math.abs(Date.now() / 1000 - ts) < 300;
  if (!ok || !fresh) return res.status(401).send("bad signature");

  const event = JSON.parse(req.body.toString("utf8"));
  queue.add(event.event, event); // process async
  res.sendStatus(204);
});
\`\`\`

### Python (FastAPI)

\`\`\`python
import hashlib, hmac, os, time
from fastapi import FastAPI, Header, HTTPException, Request

app = FastAPI()
SECRET = os.environ["AGRISHIELD_WEBHOOK_SECRET"].encode()

@app.post("/hooks/agrishield", status_code=204)
async def agrishield(request: Request,
                     x_agrishield_signature: str = Header(""),
                     x_agrishield_timestamp: str = Header("0")):
    body = await request.body()
    expected = "sha256=" + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(x_agrishield_signature, expected):
        raise HTTPException(401, "bad signature")
    if abs(time.time() - int(x_agrishield_timestamp)) > 300:
        raise HTTPException(401, "stale")
    event = await request.json()
    # enqueue event["event"], event["data"]
\`\`\`

## 4. Send alerts into Agri-SHIELD

Government systems can push alerts with the signed [inbound webhook](/docs/api-reference#post-alertswebhook):

\`\`\`bash
BODY='{"alert_type":"flood","severity":"warning","title":"Kirtankhola above danger level","description":"Barisal gauge 0.4 m above danger level and rising.","district_ids":["bd-barisal"],"source_system":"FFWC","external_id":"ffwc-0600"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$INBOUND_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST https://agrishield.io/api/v1/alerts/webhook \\
  -H "Content-Type: application/json" -H "X-Signature: sha256=$SIG" -d "$BODY"
\`\`\`

## 5. ERP patterns

- **SAP / Oracle procurement**: map \`commodity.risk.threshold\` to a purchase-requisition review workflow; use \`regions[].district_id\` to look up affected suppliers.
- **Warehouse systems**: subscribe to \`node.flood.warning\` and trigger stock-transfer orders for nodes with \`composite_risk\` above 70.
- **Insurers and lenders**: poll \`/api/v1/risk\` for portfolio coordinates daily (cache for 5 minutes) and flag loans in districts at high or critical risk.

## Environment variables

| Variable | Used for |
| --- | --- |
| \`INBOUND_WEBHOOK_SECRET\` | Verifying \`/api/v1/alerts/webhook\` |
| \`TWILIO_ACCOUNT_SID\`, \`TWILIO_AUTH_TOKEN\`, \`TWILIO_PHONE_NUMBER\`, \`TWILIO_WHATSAPP_NUMBER\`, \`TWILIO_WEBHOOK_URL\` | SMS / WhatsApp delivery and inbound verification |
| \`CRON_SECRET\` | \`/api/v1/cron/*\` |
| \`ML_API_URL\`, \`ML_API_KEY\` | Web → ML service |
| \`STRIPE_SECRET_KEY\`, \`STRIPE_WEBHOOK_SECRET\` | Live card checkout |
| \`RAZORPAY_KEY_ID\`, \`RAZORPAY_KEY_SECRET\`, \`RAZORPAY_WEBHOOK_SECRET\` | Live UPI / INR checkout |
| \`CORS_ORIGINS\` | Allowed browser origin for \`/api/v1\` |
`;
