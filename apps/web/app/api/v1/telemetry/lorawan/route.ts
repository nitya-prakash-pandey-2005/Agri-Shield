/**
 * POST /api/v1/telemetry/lorawan — The Things Stack (TTN v3) webhook.
 *
 * In the TTN console: Integrations → Webhooks → Custom webhook
 *   Base URL:        https://<your-host>/api/v1/telemetry/lorawan
 *   Uplink message:  enabled (path empty)
 *   Additional headers:  X-Device-Key: dk_…   (the Agri-SHIELD key of this device)
 * Add a payload formatter (uplink decoder) so `uplink_message.decoded_payload`
 * carries named values, e.g. { "water_level_cm": 342, "BatV": 3.6 }. Keys go through
 * the same alias/unit normaliser as the REST endpoint; the strongest gateway's
 * RSSI/SNR are stored as link-quality metrics. If the device has a DevEUI
 * registered, the uplink's dev_eui must match.
 */
import { apiError, clientIp, json } from "@/server/api/v1";
import { rateLimit } from "@/server/rate-limit";
import { deviceKeyFrom, mapTtnUplink } from "@/server/services/iot-ingest";
import { ensureIot, ingest } from "@/server/services/iot-service";
import { deviceByKey, statusOf } from "@/server/services/iot-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  ensureIot();
  if (!rateLimit(`tele:ip:${clientIp(req)}`, 600)) return apiError(429, "rate_limited", "Rate limit exceeded (600 req/min per IP)", undefined, { "Retry-After": "60" });
  const device = deviceByKey(deviceKeyFrom(req.headers));
  if (!device) return apiError(401, "unauthorized", "Add the header X-Device-Key: dk_… to the TTN webhook (Additional headers)");
  if (!rateLimit(`tele:dev:${device.id}`, 120)) return apiError(429, "rate_limited", "Rate limit exceeded (120 req/min per device)", undefined, { "Retry-After": "60" });
  const raw = await req.text();
  if (raw.length > 64_000) return apiError(413, "payload_too_large", "Uplink body exceeds 64 KB");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return apiError(400, "invalid_json", "Body must be valid JSON");
  }
  const m = mapTtnUplink(body);
  if (!m.ok) return apiError(422, "invalid_uplink", m.reason);
  if (device.devEui && m.devEui && device.devEui.toUpperCase() !== m.devEui) {
    return apiError(409, "dev_eui_mismatch", `Uplink dev_eui ${m.devEui} does not match the DevEUI registered for ${device.id} (${device.devEui})`);
  }
  const res = ingest(device, [m.reading], "lorawan");
  const payload = { ...res, lorawan: { ttnDeviceId: m.ttnDeviceId, devEui: m.devEui, gateways: m.gateways, fCnt: m.fCnt }, device: { id: device.id, status: statusOf(device) } };
  if (!res.accepted && !res.duplicates) return json({ error: { code: "no_valid_readings", message: res.rejected[0]?.reason ?? "No valid metrics in decoded_payload", ...payload } }, { status: 422 });
  return json(payload, { status: 202 });
}
