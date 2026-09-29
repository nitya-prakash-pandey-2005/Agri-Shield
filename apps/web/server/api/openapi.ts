/**
 * Hand-written OpenAPI 3.1 description of the public REST API (spec §10).
 * Served at GET /api/v1/openapi.json.
 */
import { API_VERSION } from "./v1";

const errorRef = { $ref: "#/components/schemas/Error" };
const err = (description: string) => ({ description, content: { "application/json": { schema: errorRef } } });

export function openApiDocument(serverUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000") {
  return {
    openapi: "3.1.0",
    info: {
      title: "Agri-SHIELD Public API",
      version: API_VERSION,
      summary: "Climate decision intelligence for farmers, governments and supply chains in Asia.",
      description:
        "Point flood & salinity risk, platform health, Twilio SMS bot and inbound alert webhooks. " +
        "Anonymous calls are limited to 30 req/min per IP; send `X-API-Key` for 600 req/min per key (1000/min per organisation).",
      contact: { name: "Nitya Prakash Pandey", url: "https://agrishield.io" },
      license: { name: "Proprietary" },
    },
    servers: [{ url: serverUrl, description: "Current deployment" }],
    tags: [
      { name: "Risk", description: "Point climate-risk inference" },
      { name: "Platform", description: "Health and metadata" },
      { name: "Messaging", description: "SMS fallback for feature phones" },
      { name: "Integrations", description: "Inbound alerts and scheduled jobs" },
    ],
    paths: {
      "/api/v1/risk": {
        get: {
          tags: ["Risk"],
          operationId: "getRisk",
          summary: "Flood or salinity risk for a coordinate",
          description: "Runs the ML service model (FastAPI) with an automatic physics-formula fallback on live Open-Meteo / GloFAS data, and returns the nearest monitored district's live overlay.",
          security: [{}, { ApiKeyAuth: [] }],
          parameters: [
            { name: "lat", in: "query", required: true, schema: { type: "number", minimum: -90, maximum: 90 }, example: 22.7011 },
            { name: "lon", in: "query", required: true, schema: { type: "number", minimum: -180, maximum: 180 }, example: 90.3637 },
            { name: "type", in: "query", required: false, schema: { type: "string", enum: ["flood", "salinity"], default: "flood" } },
            { name: "crop", in: "query", required: false, schema: { type: "string", default: "rice" }, description: "Crop for salinity damage probability" },
          ],
          responses: {
            "200": { description: "Risk assessment", headers: { "X-Request-Id": { schema: { type: "string" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/RiskResponse" } } } },
            "400": err("Invalid query"),
            "401": err("Invalid API key"),
            "429": err("Rate limited"),
            "502": err("Upstream failure"),
          },
        },
      },
      "/api/v1/supply-chain/commodity-risk": {
        get: {
          tags: ["Risk"],
          operationId: "getCommodityRisk",
          summary: "Commodity disruption risk",
          description: "Per-commodity supply risk (production-weighted flood/salinity exposure, price impact, volume at risk) over a 7/14/30-day horizon. Requires an API key with scope `commodities:read`.",
          security: [{ ApiKeyAuth: [] }, { BearerKey: [] }],
          parameters: [{ name: "horizon", in: "query", required: false, schema: { type: "string", enum: ["7", "14", "30"], default: "7" } }],
          responses: {
            "200": { description: "Commodity risks", content: { "application/json": { schema: { $ref: "#/components/schemas/CommodityRiskResponse" } } } },
            "400": err("Invalid horizon"),
            "401": err("Missing or invalid API key"),
            "403": err("API key lacks commodities:read"),
            "429": err("Rate limited"),
          },
        },
      },
      "/api/v1/health": {
        get: {
          tags: ["Platform"],
          operationId: "getHealth",
          summary: "Platform health",
          description: "Web process, ML API, live probes of every open-data source (latency, last success), background jobs and store statistics. `deep=0` skips external probes.",
          parameters: [{ name: "deep", in: "query", schema: { type: "string", enum: ["0", "1"], default: "1" } }],
          responses: { "200": { description: "Health report", content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } } } },
        },
      },
      "/api/v1/sms/inbound": {
        post: {
          tags: ["Messaging"],
          operationId: "smsInbound",
          summary: "Twilio inbound SMS webhook",
          description:
            "Commands: STATUS (1), ALERT (2), ADVICE (3), HELP (0), LANG <code>, STOP/START — plus local-language keywords (e.g. অবস্থা, स्थिति, TRẠNG THÁI, KALAGAYAN, PERINGATAN). Replies in the farmer's language, ≤ 2 SMS segments. Requires a valid `X-Twilio-Signature` when TWILIO_AUTH_TOKEN is configured.",
          security: [{ TwilioSignature: [] }],
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": {
                schema: { type: "object", required: ["From", "Body"], properties: { From: { type: "string", example: "+8801711000000" }, Body: { type: "string", example: "STATUS" }, To: { type: "string" }, MessageSid: { type: "string" } } },
              },
            },
          },
          responses: {
            "200": { description: "TwiML reply", content: { "text/xml": { schema: { type: "string" }, example: '<?xml version="1.0" encoding="UTF-8"?><Response><Message>AGRI-SHIELD Barisal: HIGH risk…</Message></Response>' } } },
            "400": { description: "Invalid sender" },
            "403": { description: "Invalid Twilio signature" },
            "429": { description: "Too many messages from this number" },
          },
        },
      },
      "/api/v1/alerts/webhook": {
        post: {
          tags: ["Integrations"],
          operationId: "inboundAlert",
          summary: "Create alerts from an external system",
          description: "HMAC-signed inbound alert → broadcast to every registered farmer in the matched districts (app/SMS/WhatsApp) with field-level recommendations. Idempotent on `source_system` + `external_id`.",
          security: [{ HmacSignature: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/InboundAlert" } } } },
          responses: {
            "201": { description: "Alerts created", content: { "application/json": { schema: { type: "object", properties: { created: { type: "integer" }, alerts: { type: "array", items: { type: "object" } }, recommendationsCreated: { type: "integer" } } } } } },
            "200": { description: "Duplicate delivery (idempotent replay)" },
            "401": err("Bad signature or stale timestamp"),
            "422": err("Validation failed / no matching district"),
            "503": err("Webhook secret not configured"),
          },
        },
      },
      "/api/v1/cron/{job}": {
        get: {
          tags: ["Integrations"],
          operationId: "runJob",
          summary: "Trigger a background job",
          security: [{ CronBearer: [] }],
          parameters: [{ name: "job", in: "path", required: true, schema: { type: "string", enum: ["climate-scan", "notification-dispatch", "satellite-ingest", "model-retrain"] } }],
          responses: { "200": { description: "Run finished" }, "202": { description: "Run still in progress" }, "401": err("Missing/invalid CRON_SECRET"), "404": err("Unknown job") },
        },
      },
      "/api/v1/openapi.json": {
        get: { tags: ["Platform"], operationId: "getOpenApi", summary: "This document", responses: { "200": { description: "OpenAPI 3.1 JSON" } } },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key", description: "Organisation API key (create in Supply-Chain → Integrations)." },
        TwilioSignature: { type: "apiKey", in: "header", name: "X-Twilio-Signature", description: "base64 HMAC-SHA1 of URL + sorted params with TWILIO_AUTH_TOKEN" },
        HmacSignature: { type: "apiKey", in: "header", name: "X-Signature", description: "sha256=<hex HMAC-SHA256(raw body, INBOUND_WEBHOOK_SECRET)>" },
        CronBearer: { type: "http", scheme: "bearer", description: "CRON_SECRET" },
        BearerKey: { type: "http", scheme: "bearer", description: "Organisation API key sent as `Authorization: Bearer ags_live_…`" },
      },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } } },
        FloodRisk: {
          type: "object",
          properties: {
            probability_24h: { type: "number" },
            probability_48h: { type: "number" },
            probability_72h: { type: "number" },
            estimated_depth_m: { type: "number" },
            confidence_interval: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
            contributing_factors: { type: "array", items: { type: "string" } },
            risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
            model_version: { type: "string" },
            source: { type: "string", enum: ["ml-api", "web-fallback"] },
          },
        },
        SalinityRisk: {
          type: "object",
          properties: {
            ec_current: { type: "number" },
            ec_predicted_7d: { type: "number" },
            ec_predicted_30d: { type: "number" },
            risk_level: { type: "string" },
            crop_damage_probability: { type: "number" },
            recommended_crops: { type: "array", items: { type: "string" } },
            mitigation_actions: { type: "array", items: { type: "string" } },
            confidence: { type: "number" },
            model_version: { type: "string" },
            source: { type: "string" },
          },
        },
        RiskResponse: {
          type: "object",
          required: ["type", "location", "risk", "generatedAt"],
          properties: {
            type: { type: "string", enum: ["flood", "salinity"] },
            location: { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } } },
            risk: { oneOf: [{ $ref: "#/components/schemas/FloodRisk" }, { $ref: "#/components/schemas/SalinityRisk" }] },
            nearestDistrict: { type: ["object", "null"] },
            scenario: { type: "string" },
            authenticated: { type: "boolean" },
            generatedAt: { type: "string", format: "date-time" },
          },
        },
        CommodityRiskResponse: {
          type: "object",
          required: ["horizonDays", "commodities"],
          properties: {
            horizonDays: { type: "integer", enum: [7, 14, 30] },
            outlookSource: { type: "string" },
            commodities: { type: "array", items: { type: "object", properties: { commodity: { type: "string" }, riskScore: { type: "number" } } } },
            orgId: { type: "string" },
            generatedAt: { type: "string", format: "date-time" },
          },
        },
        Health: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok", "degraded"] },
            web: { type: "object" },
            ml: { type: ["object", "null"] },
            dataSources: {},
            jobs: { type: "array", items: { type: "object" } },
            store: { type: "object" },
          },
        },
        InboundAlert: {
          type: "object",
          required: ["alert_type", "severity", "title", "description", "source_system"],
          properties: {
            alert_type: { type: "string", enum: ["flood", "salinity", "drought", "storm", "frost"] },
            severity: { type: "string", enum: ["watch", "warning", "emergency"] },
            district_ids: { type: "array", items: { type: "string" }, example: ["bd-barisal"] },
            lat: { type: "number" },
            lon: { type: "number" },
            radius_km: { type: "number", default: 80 },
            title: { type: "string", minLength: 5, maxLength: 160 },
            description: { type: "string", minLength: 10, maxLength: 2000 },
            recommended_actions: { type: "array", items: { type: "string" }, maxItems: 6 },
            channels: { type: "array", items: { type: "string", enum: ["app", "sms", "whatsapp", "email"] } },
            valid_hours: { type: "integer", minimum: 1, maximum: 720, default: 72 },
            source_system: { type: "string", example: "BWDB-FFWC" },
            external_id: { type: "string" },
            timestamp: { type: "string", format: "date-time" },
          },
        },
      },
    },
  };
}
