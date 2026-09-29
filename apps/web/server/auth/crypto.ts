/**
 * Security primitives shared by 2-step verification, sessions and SSO.
 * Node-only (node:crypto) — never import from middleware / edge code.
 *
 *  - RFC 4648 base32 (TOTP secrets) and base64url
 *  - HMAC-signed compact tokens (challenge / assertion / SSO transaction)
 *  - AES-256-GCM sealing for secrets at rest (TOTP seeds, OIDC client secrets)
 *  - keyed hashing for recovery codes (HMAC-SHA256 with a server pepper)
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 character "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
export const fromB64url = (s: string) => Buffer.from(s, "base64url");

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Server secret used to derive every sub-key. Same source as NextAuth's secret. */
export function serverSecret(): string {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "agri-shield-dev-secret-change-me-in-production-0f3c9";
}

const subKey = (purpose: string) => createHash("sha256").update(`${serverSecret()}::${purpose}`).digest();

// ─── Signed compact tokens ────────────────────────────────────────────────

/** `<b64url(json)>.<b64url(hmac)>` — tamper-evident, purpose-bound, expiring. */
export function signToken(purpose: string, payload: Record<string, unknown>, ttlSec: number, now = Date.now()): string {
  const body = b64url(JSON.stringify({ ...payload, p: purpose, exp: Math.floor(now / 1000) + ttlSec }));
  const mac = createHmac("sha256", subKey(`token:${purpose}`)).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

export function verifyToken<T extends Record<string, unknown>>(purpose: string, token: string | null | undefined, now = Date.now()): (T & { exp: number }) | null {
  if (!token || typeof token !== "string" || token.length > 4096) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = b64url(createHmac("sha256", subKey(`token:${purpose}`)).update(body).digest());
  if (!safeEqual(mac, expected)) return null;
  try {
    const data = JSON.parse(fromB64url(body).toString("utf8")) as T & { p: string; exp: number };
    if (data.p !== purpose || typeof data.exp !== "number" || data.exp * 1000 < now) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Secrets at rest ──────────────────────────────────────────────────────

export function seal(plain: string, purpose = "seal"): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", subKey(`aes:${purpose}`), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${b64url(iv)}.${b64url(enc)}.${b64url(c.getAuthTag())}`;
}

export function unseal(sealed: string, purpose = "seal"): string {
  const [v, iv, enc, tag] = sealed.split(".");
  if (v !== "v1" || !iv || !enc || !tag) throw new Error("Unsupported sealed secret");
  const d = createDecipheriv("aes-256-gcm", subKey(`aes:${purpose}`), fromB64url(iv));
  d.setAuthTag(fromB64url(tag));
  return Buffer.concat([d.update(fromB64url(enc)), d.final()]).toString("utf8");
}

/** Keyed one-way hash (recovery codes, session ids in logs). */
export function keyedHash(value: string, purpose: string): string {
  return createHmac("sha256", subKey(`hash:${purpose}`)).update(value).digest("hex");
}

export function randomId(prefix: string, bytes = 12): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

export function sha256b64url(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}
