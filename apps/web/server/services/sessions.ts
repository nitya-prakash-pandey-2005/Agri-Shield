/**
 * Server-side session registry for NextAuth JWT sessions.
 *
 * Every sign-in gets a session id (`sid`) that is embedded in the signed JWT.
 * The node-side `jwt` callback (auth.ts) and the tRPC context consult this
 * registry on every request, so a revoked session stops working immediately —
 * even though the JWT itself is still cryptographically valid until it expires.
 *
 * "Sign out all other sessions" revokes every other sid and also sets a
 * not-before watermark that kills tokens minted before session tracking existed.
 */
import { secState, type SessionRecord, type SignInMethod } from "../auth/security-state";
import { randomId } from "../auth/crypto";

export const SESSION_TTL_MS = 7 * 24 * 3600_000; // matches authConfig.session.maxAge
const TOUCH_EVERY_MS = 30_000;

export function clientIpFromHeaders(h: Headers | null | undefined): string {
  if (!h) return "local";
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "local";
}

export function createSession(p: { userId: string; orgId: string | null; method: SignInMethod; amr: string[]; ip: string; userAgent: string }, now = new Date()): SessionRecord {
  const rec: SessionRecord = {
    id: randomId("ses", 16),
    userId: p.userId,
    orgId: p.orgId,
    createdAt: now,
    lastSeen: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    ip: p.ip,
    userAgent: p.userAgent.slice(0, 400),
    method: p.method,
    amr: p.amr,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  };
  secState().sessions.set(rec.id, rec);
  pruneSessions(now);
  return rec;
}

export type SessionCheck = { ok: true; session: SessionRecord | null } | { ok: false; reason: "revoked" | "expired" | "user_mismatch" | "not_before" };

/**
 * Validate the session behind a JWT.
 *  - sid known → must belong to the user, not revoked, not expired
 *  - sid unknown (token minted by another server process / before a restart)
 *    → adopted as a "restored" session so it can be listed and revoked
 *  - no sid (legacy token) → only the not-before watermark applies
 */
export function checkSession(token: { sid?: string | null; uid?: string | null; authAt?: number | null; orgId?: string | null }, now = new Date()): SessionCheck {
  const st = secState();
  const uid = token.uid ?? null;
  if (uid) {
    // "Sign out everywhere" watermark (ms). authAt is stamped once at sign-in and
    // survives token refreshes; legacy tokens without it count as issued at 0.
    const nb = st.notBefore.get(uid);
    if (nb && (token.authAt ?? 0) < nb.at && (!token.sid || token.sid !== nb.keepSid)) return { ok: false, reason: "not_before" };
  }
  if (!token.sid) return { ok: true, session: null };
  let rec = st.sessions.get(token.sid);
  if (!rec) {
    if (!uid) return { ok: true, session: null };
    rec = {
      id: token.sid,
      userId: uid,
      orgId: token.orgId ?? null,
      createdAt: token.authAt ? new Date(token.authAt) : now,
      lastSeen: now,
      expiresAt: new Date((token.authAt ?? now.getTime()) + SESSION_TTL_MS),
      ip: "—",
      userAgent: "",
      method: "restored",
      amr: [],
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    };
    st.sessions.set(rec.id, rec);
  }
  if (uid && rec.userId !== uid) return { ok: false, reason: "user_mismatch" };
  if (rec.revokedAt) return { ok: false, reason: "revoked" };
  if (rec.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, session: rec };
}

/** Record activity (throttled): last seen, current IP and user agent. */
export function touchSession(sid: string | null | undefined, p: { ip?: string; userAgent?: string } = {}, now = new Date()) {
  if (!sid) return;
  const rec = secState().sessions.get(sid);
  if (!rec || rec.revokedAt) return;
  if (p.ip && p.ip !== "local") rec.ip = p.ip;
  else if (p.ip && rec.ip === "—") rec.ip = p.ip;
  if (p.userAgent && !rec.userAgent) rec.userAgent = p.userAgent.slice(0, 400);
  if (now.getTime() - rec.lastSeen.getTime() >= TOUCH_EVERY_MS) rec.lastSeen = now;
}

export function revokeSession(sid: string, by: string, reason = "revoked", now = new Date()): SessionRecord | null {
  const rec = secState().sessions.get(sid);
  if (!rec || rec.revokedAt) return rec ?? null;
  rec.revokedAt = now;
  rec.revokedBy = by;
  rec.revokeReason = reason;
  return rec;
}

/** Revoke every other active session of a user; returns how many were revoked. */
export function revokeOtherSessions(userId: string, keepSid: string | null, by: string, now = new Date()): number {
  const st = secState();
  let n = 0;
  for (const s of st.sessions.values()) {
    if (s.userId === userId && s.id !== keepSid && !s.revokedAt) {
      revokeSession(s.id, by, "signed out everywhere", now);
      n++;
    }
  }
  st.notBefore.set(userId, { at: now.getTime(), keepSid });
  return n;
}

export function revokeAllForUser(userId: string, by: string, reason: string, now = new Date()): number {
  const st = secState();
  let n = 0;
  for (const s of st.sessions.values()) {
    if (s.userId === userId && !s.revokedAt) {
      revokeSession(s.id, by, reason, now);
      n++;
    }
  }
  st.notBefore.set(userId, { at: now.getTime() + 1, keepSid: null });
  return n;
}

export function sessionsForUser(userId: string, now = new Date()): SessionRecord[] {
  return [...secState().sessions.values()]
    .filter((s) => s.userId === userId && (s.revokedAt ? now.getTime() - s.revokedAt.getTime() < 7 * 86_400_000 : s.expiresAt.getTime() > now.getTime()))
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
}

export function activeSessionsForOrg(orgId: string, now = new Date()): SessionRecord[] {
  return [...secState().sessions.values()].filter((s) => s.orgId === orgId && !s.revokedAt && s.expiresAt.getTime() > now.getTime());
}

function pruneSessions(now: Date) {
  const st = secState();
  if (st.sessions.size < 2000) return;
  for (const [id, s] of st.sessions) if (s.expiresAt.getTime() < now.getTime() - 86_400_000) st.sessions.delete(id);
}

export interface DeviceInfo {
  kind: "desktop" | "mobile" | "api" | "unknown";
  browser: string;
  os: string;
  label: string;
}

export function describeUserAgent(ua: string): DeviceInfo {
  if (!ua) return { kind: "unknown", browser: "Unknown", os: "", label: "Unknown device" };
  if (/curl|wget|python-requests|httpie|postman|go-http-client|node-fetch|undici/i.test(ua)) {
    const tool = ua.match(/(curl|wget|python-requests|HTTPie|PostmanRuntime|Go-http-client|node-fetch|undici)/i)?.[1] ?? "API client";
    return { kind: "api", browser: tool, os: "", label: `API client (${tool})` };
  }
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? (/HeadlessChrome/.test(ua) ? "Headless Chrome" : "Chrome") : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const kind = /Mobile|Android|iPhone/.test(ua) ? "mobile" : "desktop";
  return { kind, browser, os, label: os ? `${browser} on ${os}` : browser };
}

/** Cheap check for request paths that already hold a decoded session. */
export function isSessionRevoked(sid: string | null | undefined): boolean {
  if (!sid) return false;
  const rec = secState().sessions.get(sid);
  return !!rec?.revokedAt;
}
