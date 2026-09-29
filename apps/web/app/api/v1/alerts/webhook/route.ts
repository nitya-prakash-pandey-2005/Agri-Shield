/**
 * POST /api/v1/alerts/webhook — inbound alerts from external systems
 * (national met services, river-gauge networks, partner NGOs).
 *
 * Auth: HMAC-SHA256 of the raw body with INBOUND_WEBHOOK_SECRET, sent as
 *   X-Signature: sha256=<hex>     (bare <hex> also accepted)
 * Dev default secret (non-production only): "agri-shield-dev-webhook-secret".
 * Optional `timestamp` (ISO) in the body must be within ±10 min (replay guard);
 * `external_id` makes delivery idempotent.
 */
import { z } from "zod";
import { audit, getStore } from "@/server/data/store";
import { broadcast } from "@/server/jobs/services";
import { generateRecommendations, haversineKm } from "@/server/jobs/climate-scan";
import { apiError, clientIp, json } from "@/server/api/v1";
import { rateLimit } from "@/server/rate-limit";
import { verifyBodySignature, webhookSecret } from "@/server/api/webhook-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    alert_type: z.enum(["flood", "salinity", "drought", "storm", "frost"]),
    severity: z.enum(["watch", "warning", "emergency"]),
    district_ids: z.array(z.string().max(64)).max(30).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    radius_km: z.number().min(1).max(300).default(80),
    title: z.string().min(5).max(160),
    description: z.string().min(10).max(2000),
    recommended_actions: z.array(z.string().min(3).max(200)).max(6).default([]),
    channels: z.array(z.enum(["app", "sms", "whatsapp", "email"])).min(1).default(["app", "sms"]),
    valid_hours: z.number().int().min(1).max(720).default(72),
    source_system: z.string().min(2).max(60),
    external_id: z.string().min(1).max(120).optional(),
    timestamp: z.string().datetime().optional(),
  })
  .refine((b) => (b.district_ids?.length ?? 0) > 0 || (b.lat != null && b.lon != null), { message: "Provide district_ids or lat+lon" });

const g = globalThis as unknown as { __agriWebhookSeen?: Map<string, string[]> };
const seen = (g.__agriWebhookSeen ??= new Map());

export async function POST(req: Request) {
  const secret = webhookSecret();
  if (!secret) return apiError(503, "not_configured", "INBOUND_WEBHOOK_SECRET is not configured");
  if (!rateLimit(`whk-in:${clientIp(req)}`, 60)) return apiError(429, "rate_limited", "Rate limit exceeded (60 req/min)");

  const raw = await req.text();
  if (raw.length > 32_000) return apiError(413, "payload_too_large", "Body exceeds 32 KB");
  if (!verifyBodySignature(raw, req.headers.get("x-signature"), secret)) {
    return apiError(401, "invalid_signature", "X-Signature must be sha256=HMAC_SHA256(body, INBOUND_WEBHOOK_SECRET)");
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return apiError(400, "invalid_json", "Body must be JSON");
  }
  const parsed = Body.safeParse(data);
  if (!parsed.success) return apiError(422, "invalid_payload", "Payload failed validation", { issues: parsed.error.flatten() });
  const b = parsed.data;

  if (b.timestamp && Math.abs(Date.now() - new Date(b.timestamp).getTime()) > 10 * 60_000) {
    return apiError(401, "stale_request", "timestamp outside ±10 min window");
  }
  const idemKey = b.external_id ? `${b.source_system}:${b.external_id}` : null;
  if (idemKey && seen.has(idemKey)) return json({ duplicate: true, alertIds: seen.get(idemKey) }, { status: 200 });

  const s = getStore();
  let districtIds = (b.district_ids ?? []).filter((id) => s.districts.some((d) => d.id === id));
  if (!districtIds.length && b.lat != null && b.lon != null) {
    districtIds = s.districts.filter((d) => haversineKm(b.lat!, b.lon!, d.lat, d.lon) <= b.radius_km).map((d) => d.id);
  }
  if (!districtIds.length) return apiError(422, "no_districts", "No monitored district matches district_ids or lat/lon within radius_km");

  const { alerts, via } = await broadcast({
    alertType: b.alert_type,
    severity: b.severity,
    districtIds,
    title: b.title,
    description: `${b.description}\n\nSource: ${b.source_system}${b.external_id ? ` (#${b.external_id})` : ""}`,
    recommendedActions: b.recommended_actions,
    channels: b.channels,
    createdBy: `webhook:${b.source_system}`,
    source: "manual",
    validHours: b.valid_hours,
  });
  let recs = 0;
  for (const a of alerts) {
    const d = s.districts.find((x) => x.id === a.districtId);
    if (d) recs += generateRecommendations(a, d);
  }
  const ids = alerts.map((a) => a.id);
  if (idemKey) seen.set(idemKey, ids);
  audit({ userId: `webhook:${b.source_system}`, userName: b.source_system, action: "alert.webhook", entity: "climate_alert", entityId: ids.join(","), details: `${b.severity} ${b.alert_type} → ${districtIds.join(", ")} (via ${via})` });

  return json(
    { created: alerts.length, alerts: alerts.map((a) => ({ id: a.id, districtId: a.districtId, title: a.title, severity: a.severity, validUntil: a.validUntil })), recommendationsCreated: recs },
    { status: 201 }
  );
}
