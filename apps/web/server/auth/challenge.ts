/**
 * Short-lived, single-use sign-in challenges.
 *
 *  - 2-step challenge: issued after a correct first factor (password / email
 *    OTP) for a user who must present a second factor. The client only gets an
 *    HMAC-signed token referencing a server-side record; the NextAuth session is
 *    minted only when the token is redeemed together with a valid TOTP /
 *    recovery code (or after an enrolment was confirmed with one).
 *  - SSO assertion: issued by the OIDC callback after the ID token was
 *    verified; carried in an httpOnly cookie and redeemed once by the
 *    Credentials provider to mint the session.
 */
import { randomId, signToken, verifyToken } from "./crypto";
import { secState, type Challenge, type SsoAssertion } from "./security-state";

export const CHALLENGE_TTL_SEC = 5 * 60;
export const CHALLENGE_MAX_ATTEMPTS = 5;
export const ASSERTION_TTL_SEC = 120;
export const SSO_ASSERTION_COOKIE = "ags_sso_assert";

function prune(now: number) {
  const st = secState();
  for (const [id, c] of st.challenges) if (c.expiresAt.getTime() < now - 60_000) st.challenges.delete(id);
  for (const [id, a] of st.assertions) if (a.expiresAt.getTime() < now - 60_000) st.assertions.delete(id);
}

export function issueChallenge(p: { userId: string; purpose: Challenge["purpose"]; firstFactor: Challenge["firstFactor"]; ip: string; userAgent: string; pendingSecretSealed?: string | null }, now = Date.now()): { token: string; challenge: Challenge } {
  prune(now);
  const c: Challenge = {
    id: randomId("chl", 16),
    userId: p.userId,
    purpose: p.purpose,
    firstFactor: p.firstFactor,
    createdAt: new Date(now),
    expiresAt: new Date(now + CHALLENGE_TTL_SEC * 1000),
    attempts: 0,
    state: "pending",
    satisfiedWith: null,
    pendingSecretSealed: p.pendingSecretSealed ?? null,
    ip: p.ip,
    userAgent: p.userAgent,
  };
  secState().challenges.set(c.id, c);
  return { token: signToken("2fa-challenge", { cid: c.id, uid: c.userId }, CHALLENGE_TTL_SEC, now), challenge: c };
}

export type ChallengeLookup = { ok: true; challenge: Challenge } | { ok: false; reason: "invalid" | "expired" | "used" | "too_many_attempts" };

/** Resolve a challenge token to its live record (signature, expiry, single use, attempts). */
export function lookupChallenge(token: string | null | undefined, now = Date.now()): ChallengeLookup {
  const data = verifyToken<{ cid: string; uid: string }>("2fa-challenge", token, now);
  if (!data) return { ok: false, reason: token ? "expired" : "invalid" };
  const c = secState().challenges.get(data.cid);
  if (!c || c.userId !== data.uid) return { ok: false, reason: "invalid" };
  if (c.state === "consumed") return { ok: false, reason: "used" };
  if (c.expiresAt.getTime() < now) return { ok: false, reason: "expired" };
  if (c.attempts >= CHALLENGE_MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };
  return { ok: true, challenge: c };
}

export function registerAttempt(c: Challenge) {
  c.attempts += 1;
}

export function consumeChallenge(c: Challenge) {
  c.state = "consumed";
}

// ─── SSO assertions ──────────────────────────────────────────────────────

export function issueAssertion(p: { userId: string; orgId: string; ip: string; userAgent: string }, now = Date.now()): string {
  prune(now);
  const a: SsoAssertion = { id: randomId("asr", 16), userId: p.userId, orgId: p.orgId, expiresAt: new Date(now + ASSERTION_TTL_SEC * 1000), consumed: false, ip: p.ip, userAgent: p.userAgent };
  secState().assertions.set(a.id, a);
  return signToken("sso-assertion", { aid: a.id, uid: a.userId }, ASSERTION_TTL_SEC, now);
}

/** Redeem once. */
export function redeemAssertion(token: string | null | undefined, now = Date.now()): SsoAssertion | null {
  const data = verifyToken<{ aid: string; uid: string }>("sso-assertion", token, now);
  if (!data) return null;
  const a = secState().assertions.get(data.aid);
  if (!a || a.consumed || a.userId !== data.uid || a.expiresAt.getTime() < now) return null;
  a.consumed = true;
  return a;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
