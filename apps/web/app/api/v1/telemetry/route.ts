/**
 * POST /api/v1/telemetry — device telemetry ingest.
 *
 * Auth:   X-Device-Key: dk_…   (or Authorization: Bearer dk_…) — shown once when the
 *         device is provisioned / its key rotated; only the SHA-256 is stored.
 * Body:   one reading, { "readings": [ … ≤ 500 ] } or a bare array. Each reading:
 *           { "ts": ISO | epoch s | epoch ms (default now),
 *             "values": { "<metric>": number | { "value": n, "unit": "cm" } },
 *             …or flat keys with unit suffixes: "water_level_cm": 342, "battery_v": 3.9 }
 *         Units are normalised (cm→m, µS/cm→dS/m, m³/m³→%, °F→°C, V→%, …);
 *         readings with an existing timestamp are ignored (dedupe);
 *         timestamps must be within [now − 7 d, now + 5 min].
 * Limits: 256 KB body, 120 requests/min per device, 600/min per IP.
 * Reply:  202 { accepted, duplicates, rejected[], warnings[], device{ id, status, lastSeen }, anomalies[] }
 *         422 when nothing was accepted.
 *
 * GET returns the machine-readable contract (metrics, units, aliases, MQTT topics).
 */
import { apiError, clientIp, json } from "@/server/api/v1";
import { rateLimit } from "@/server/rate-limit";
import { deviceKeyFrom, splitBody } from "@/server/services/iot-ingest";
import { ensureIot, ingest } from "@/server/services/iot-service";
import { deviceByKey, statusOf } from "@/server/services/iot-store";
import { telemetryContract } from "@/server/services/iot-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Key, Authorization",
};

async function trackApiCall(orgId: string) {
  try {
    const { trackUsage } = await import("@/server/services/usage");
    trackUsage(orgId, "apiCalls");
  } catch {
    /* usage metering is best-effort */
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET(req: Request) {
  return json(telemetryContract(new URL(req.url).origin), { headers: CORS });
}

export async function POST(req: Request) {
  ensureIot();
  const ip = clientIp(req);
  if (!rateLimit(`tele:ip:${ip}`, 600)) return apiError(429, "rate_limited", "Rate limit exceeded (600 req/min per IP)", undefined, { ...CORS, "Retry-After": "60" });
  const key = deviceKeyFrom(req.headers);
  if (!key) return apiError(401, "unauthorized", "Device key required: X-Device-Key: dk_… (or Authorization: Bearer dk_…)", undefined, CORS);
  const device = deviceByKey(key);
  if (!device) return apiError(401, "unauthorized", "Unknown or rotated device key", undefined, CORS);
  if (!rateLimit(`tele:dev:${device.id}`, 120)) return apiError(429, "rate_limited", "Rate limit exceeded (120 req/min per device) — batch readings instead", undefined, { ...CORS, "Retry-After": "60" });

  const raw = await req.text();
  if (raw.length > 256_000) return apiError(413, "payload_too_large", "Body exceeds 256 KB — split the batch", undefined, CORS);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return apiError(400, "invalid_json", "Body must be valid JSON", undefined, CORS);
  }
  const split = splitBody(body);
  if (!split.ok) return apiError(422, "invalid_payload", split.reason, undefined, CORS);
  if (split.deviceId && split.deviceId !== device.id) return apiError(403, "device_mismatch", `device_id "${split.deviceId}" does not match the key's device (${device.id})`, undefined, CORS);

  const res = ingest(device, split.readings, "rest");
  void trackApiCall(device.orgId);
  const payload = {
    ...res,
    device: { id: device.id, name: device.name, status: statusOf(device), lastSeen: device.lastSeen ? new Date(device.lastSeen).toISOString() : null },
  };
  if (!res.accepted && !res.duplicates) return json({ error: { code: "no_valid_readings", message: "No reading was accepted", ...payload } }, { status: 422, headers: CORS });
  return json(payload, { status: 202, headers: CORS });
}
