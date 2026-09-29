/**
 * Shared plumbing for the public REST API (/api/v1/*): JSON responses with
 * consistent error envelopes, optional API-key auth, per-key / per-IP rate
 * limits (spec §18) and request ids.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { getStore, type ApiKeyRecord } from "../data/store";
import { rateLimit } from "../rate-limit";
import { trackUsage } from "../services/usage";
import { hasHash, verifyApiKey } from "../services/supply-chain";

export const API_VERSION = "1.0.0";

export function json(data: unknown, init: ResponseInit & { requestId?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Request-Id", init.requestId ?? randomUUID());
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

export function apiError(status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: HeadersInit): Response {
  return json({ error: { code, message, ...extra } }, { status, headers });
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

type KeyWithHash = ApiKeyRecord & { hash?: string; keyHash?: string; hashedKey?: string; secretHash?: string; revoked?: boolean; revokedAt?: Date | null; active?: boolean };

/**
 * Resolve an X-API-Key:
 *  1. SHA-256 hash registry kept by the supply-chain service (keys created in the portal)
 *  2. a hash stored on the record itself (hash / keyHash / hashedKey / secretHash — DB mode)
 *  3. legacy seeded demo records with no hash anywhere: display prefix + ≥ 8 extra chars
 */
export function resolveApiKey(raw: string | null): { key: KeyWithHash | null; error?: string } {
  if (!raw) return { key: null };
  const key = raw.trim();
  if (key.length < 16 || key.length > 200) return { key: null, error: "malformed API key" };
  const registered = verifyApiKey(key) as KeyWithHash | null;
  if (registered) return { key: registered };
  const digest = sha256(key);
  const keys = getStore().apiKeys as KeyWithHash[];
  for (const k of keys) {
    if (k.revoked || k.revokedAt || k.active === false || hasHash(k.id)) continue;
    const h = k.hash ?? k.keyHash ?? k.hashedKey ?? k.secretHash;
    if (h) {
      if (h.length === digest.length && timingSafeEqual(Buffer.from(h), Buffer.from(digest))) return { key: k };
    } else if (key.startsWith(k.prefix) && key.length >= k.prefix.length + 8) {
      return { key: k };
    }
  }
  return { key: null, error: "invalid or revoked API key" };
}

export interface ApiAuth {
  apiKey: KeyWithHash | null;
  ip: string;
  requestId: string;
}

/**
 * Optional API-key auth + rate limiting. Anonymous: 30 req/min per IP.
 * Keyed: 600 req/min per key and 1000 req/min per org.
 * Returns a Response when the request must be rejected.
 */
export function authorize(req: Request, opts: { requireKey?: boolean; scope?: string; anonLimit?: number } = {}): ApiAuth | Response {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const ip = clientIp(req);
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(ags_\S+)$/i)?.[1] ?? null;
  const { key, error } = resolveApiKey(req.headers.get("x-api-key") ?? bearer);
  if (error) return apiError(401, "unauthorized", error);
  if (opts.requireKey && !key) return apiError(401, "unauthorized", "API key required (X-API-Key or Authorization: Bearer)");
  if (key && opts.scope && !key.scopes.includes(opts.scope) && !key.scopes.includes("*")) return apiError(403, "forbidden", `API key lacks scope ${opts.scope}`);

  const limit = key ? 600 : opts.anonLimit ?? 30;
  const bucket = key ? `api:key:${key.id}` : `api:ip:${ip}`;
  if (!rateLimit(bucket, limit) || (key && !rateLimit(`api:org:${key.orgId}`, 1000))) {
    return apiError(429, "rate_limited", `Rate limit exceeded (${limit} req/min)`, undefined, { "Retry-After": "60" });
  }
  if (key) {
    key.lastUsed = new Date();
    trackUsage(key.orgId, "apiCalls");
  }
  return { apiKey: key, ip, requestId };
}

export function preflight(): Response {
  return new Response(null, { status: 204 });
}
