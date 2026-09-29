/**
 * 2-step verification with authenticator apps.
 *
 *  - HOTP (RFC 4226) and TOTP (RFC 6238) implemented on node:crypto HMAC
 *    (SHA-1 default — what Google Authenticator / Authy / 1Password / Microsoft
 *    Authenticator expect; SHA-256/512 supported for the RFC test vectors)
 *  - ±1 time-step tolerance (clock drift of up to 30 s either way)
 *  - replay protection: a code's time-step can be used once, and never an
 *    older step than the last accepted one
 *  - 10 single-use recovery codes, stored only as keyed hashes
 *  - lockout after 5 wrong codes in 15 minutes
 */
import { createHmac, randomBytes, randomInt } from "node:crypto";
import type { UserRecord } from "../data/store";
import { base32Decode, base32Encode, keyedHash, safeEqual, seal, unseal } from "../auth/crypto";
import { policyFor, secState, type TotpEnrolment } from "../auth/security-state";

export type HashAlg = "sha1" | "sha256" | "sha512";

export const TOTP_STEP = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;
export const ISSUER = "Agri-SHIELD";

// ─── RFC 4226 / 6238 ──────────────────────────────────────────────────────

export function hotp(secret: Buffer, counter: number | bigint, digits = TOTP_DIGITS, alg: HashAlg = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(alg, secret).update(msg).digest();
  // Dynamic truncation (RFC 4226 §5.3)
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const timeStep = (unixSeconds: number, step = TOTP_STEP) => Math.floor(unixSeconds / step);

export function totp(secret: Buffer, unixSeconds: number, opts: { step?: number; digits?: number; alg?: HashAlg } = {}): string {
  return hotp(secret, timeStep(unixSeconds, opts.step), opts.digits, opts.alg);
}

export type TotpCheck = { ok: true; step: number; drift: number } | { ok: false; reason: "format" | "invalid" | "replay" };

/**
 * Verify a TOTP code within ±window steps. `lastUsedStep` rejects replays of
 * the same or an earlier step (RFC 6238 §5.2).
 */
export function verifyTotp(secret: Buffer, code: string, opts: { now?: number; window?: number; lastUsedStep?: number; digits?: number; alg?: HashAlg } = {}): TotpCheck {
  const digits = opts.digits ?? TOTP_DIGITS;
  const clean = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return { ok: false, reason: "format" };
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const current = timeStep(now);
  const window = opts.window ?? TOTP_WINDOW;
  let matched: number | null = null;
  // Check every candidate (no early exit) to keep timing independent of which step matched
  for (let d = -window; d <= window; d++) {
    if (safeEqual(hotp(secret, current + d, digits, opts.alg), clean) && matched === null) matched = d;
  }
  if (matched === null) return { ok: false, reason: "invalid" };
  const step = current + matched;
  if (opts.lastUsedStep !== undefined && step <= opts.lastUsedStep) return { ok: false, reason: "replay" };
  return { ok: true, step, drift: matched };
}

export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** Key URI format understood by every authenticator app. */
export function otpauthUri({ secret, account, issuer = ISSUER }: { secret: string; account: string; issuer?: string }): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const q = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** Group a base32 secret in blocks of 4 for manual entry. */
export const formatSecret = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

// ─── Recovery codes ──────────────────────────────────────────────────────

const RC_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i ambiguity

export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const one = () => Array.from({ length: 10 }, () => RC_ALPHABET[randomInt(RC_ALPHABET.length)]).join("");
  const set = new Set<string>();
  while (set.size < n) {
    const c = one();
    if (/[a-z]/.test(c)) set.add(`${c.slice(0, 5)}-${c.slice(5)}`); // always distinguishable from a TOTP code
  }
  return [...set];
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
export const hashRecoveryCode = (code: string) => keyedHash(normalizeRecoveryCode(code), "recovery-code");
export const looksLikeRecoveryCode = (code: string) => normalizeRecoveryCode(code).length === 10 && /[a-z]/i.test(code);

/** Consume a recovery code (single use). Returns remaining count or null when not valid. */
export function consumeRecoveryCode(enrolment: TotpEnrolment, code: string, now = new Date()): number | null {
  const h = hashRecoveryCode(code);
  const hit = enrolment.recovery.find((r) => !r.usedAt && safeEqual(r.hash, h));
  if (!hit) return null;
  hit.usedAt = now;
  return enrolment.recovery.filter((r) => !r.usedAt).length;
}

// ─── Enrolment lifecycle ─────────────────────────────────────────────────

export const sealSecret = (secret: string) => seal(secret, "totp");
export const openSecret = (sealed: string) => base32Decode(unseal(sealed, "totp"));

export function enrolmentOf(userId: string): TotpEnrolment | null {
  return secState().totp.get(userId) ?? null;
}

export const isEnrolled = (userId: string) => secState().totp.has(userId);

/** Start enrolment: a fresh secret (not yet active) + the URI the QR encodes. */
export function beginEnrolment(account: string): { secret: string; sealed: string; uri: string } {
  const secret = generateSecret();
  return { secret, sealed: sealSecret(secret), uri: otpauthUri({ secret, account }) };
}

/**
 * Activate an enrolment once the user proves the app is set up by entering a
 * valid code. Returns the plain recovery codes (shown once).
 */
export function confirmEnrolment(userId: string, sealedSecret: string, code: string, now = Date.now()): { ok: true; recoveryCodes: string[] } | { ok: false; reason: string } {
  const check = verifyTotp(openSecret(sealedSecret), code, { now });
  if (!check.ok) return { ok: false, reason: check.reason === "format" ? "Enter the 6-digit code from your app" : "That code doesn't match — check your phone's clock and try the newest code" };
  const recoveryCodes = generateRecoveryCodes();
  secState().totp.set(userId, {
    userId,
    secretSealed: sealedSecret,
    createdAt: new Date(now),
    lastUsedStep: check.step,
    lastUsedAt: new Date(now),
    recovery: recoveryCodes.map((c) => ({ hash: hashRecoveryCode(c), usedAt: null })),
  });
  return { ok: true, recoveryCodes };
}

export function regenerateRecoveryCodes(userId: string): string[] | null {
  const e = enrolmentOf(userId);
  if (!e) return null;
  const codes = generateRecoveryCodes();
  e.recovery = codes.map((c) => ({ hash: hashRecoveryCode(c), usedAt: null }));
  return codes;
}

export function disableTotp(userId: string): boolean {
  return secState().totp.delete(userId);
}

// ─── Lockout ─────────────────────────────────────────────────────────────

const LOCK_WINDOW_MS = 15 * 60_000;
const LOCK_MAX = 5;

export function isLockedOut(userId: string, now = Date.now()): boolean {
  const f = (secState().failures.get(userId) ?? []).filter((t) => now - t < LOCK_WINDOW_MS);
  return f.length >= LOCK_MAX;
}

function recordFailure(userId: string, now = Date.now()) {
  const st = secState();
  const f = (st.failures.get(userId) ?? []).filter((t) => now - t < LOCK_WINDOW_MS);
  f.push(now);
  st.failures.set(userId, f);
}

export type SecondFactorResult = { ok: true; via: "totp" | "recovery"; recoveryLeft?: number } | { ok: false; reason: "locked" | "not_enrolled" | "invalid" | "replay" | "format" };

/** Verify a TOTP or recovery code for an enrolled user (with replay + lockout). */
export function verifySecondFactor(userId: string, code: string, now = Date.now()): SecondFactorResult {
  if (isLockedOut(userId, now)) return { ok: false, reason: "locked" };
  const e = enrolmentOf(userId);
  if (!e) return { ok: false, reason: "not_enrolled" };
  const trimmed = code.trim();
  if (looksLikeRecoveryCode(trimmed)) {
    const left = consumeRecoveryCode(e, trimmed, new Date(now));
    if (left === null) {
      recordFailure(userId, now);
      return { ok: false, reason: "invalid" };
    }
    secState().failures.delete(userId);
    return { ok: true, via: "recovery", recoveryLeft: left };
  }
  const check = verifyTotp(openSecret(e.secretSealed), trimmed, { now, lastUsedStep: e.lastUsedStep });
  if (!check.ok) {
    if (check.reason !== "format") recordFailure(userId, now);
    return { ok: false, reason: check.reason };
  }
  e.lastUsedStep = check.step;
  e.lastUsedAt = new Date(now);
  secState().failures.delete(userId);
  return { ok: true, via: "totp" };
}

// ─── Sign-in gate ────────────────────────────────────────────────────────

/**
 * What the second step at sign-in must be for this user:
 *  - "verify": enrolled → ask for a code
 *  - "enrol":  not enrolled but the workspace requires 2FA → enrol now
 *  - "none":   no second step
 * Farmers (phone OTP) are never gated by workspace policy.
 */
export function twoFactorGate(user: Pick<UserRecord, "id" | "orgId" | "role">): "none" | "verify" | "enrol" {
  if (isEnrolled(user.id)) return "verify";
  if (user.role !== "farmer" && user.orgId && policyFor(user.orgId).require2fa) return "enrol";
  return "none";
}
