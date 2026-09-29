/**
 * HMAC auth for inbound alert webhooks (POST /api/v1/alerts/webhook).
 * X-Signature: sha256=<hex HMAC-SHA256(raw body, INBOUND_WEBHOOK_SECRET)>
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Documented dev default — refused in production (endpoint returns 503 until a secret is set). */
export const DEV_WEBHOOK_SECRET = "agri-shield-dev-webhook-secret";

export function webhookSecret(): string | null {
  if (process.env.INBOUND_WEBHOOK_SECRET) return process.env.INBOUND_WEBHOOK_SECRET;
  return process.env.NODE_ENV === "production" ? null : DEV_WEBHOOK_SECRET;
}

export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function verifyBodySignature(body: string, header: string | null, secret: string): boolean {
  const sig = (header ?? "").trim();
  if (!sig) return false;
  const provided = sig.startsWith("sha256=") ? sig : `sha256=${sig}`;
  const expected = signBody(body, secret);
  return provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
