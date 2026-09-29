import { beforeEach, describe, expect, it } from "vitest";
import { base32Decode, base32Encode, seal, signToken, unseal, verifyToken } from "@/server/auth/crypto";
import {
  confirmEnrolment,
  beginEnrolment,
  generateRecoveryCodes,
  hotp,
  isEnrolled,
  otpauthUri,
  regenerateRecoveryCodes,
  totp,
  twoFactorGate,
  verifySecondFactor,
  verifyTotp,
  openSecret,
} from "@/server/services/totp";
import { __resetSecurityState, policyFor, secState } from "@/server/auth/security-state";
import { encodeQr, pickVersion } from "@/server/auth/qr";
import { consumeChallenge, issueChallenge, lookupChallenge, registerAttempt, CHALLENGE_MAX_ATTEMPTS } from "@/server/auth/challenge";

beforeEach(() => __resetSecurityState());

describe("RFC 4226 HOTP test vectors (Appendix D)", () => {
  const secret = Buffer.from("12345678901234567890");
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  it.each(expected.map((code, counter) => [counter, code]))("counter %i → %s", (counter, code) => {
    expect(hotp(secret, counter as number)).toBe(code);
  });
});

describe("RFC 6238 TOTP test vectors (Appendix B, 8 digits)", () => {
  const seeds = {
    sha1: Buffer.from("12345678901234567890"),
    sha256: Buffer.from("12345678901234567890123456789012"),
    sha512: Buffer.from("1234567890123456789012345678901234567890123456789012345678901234"),
  };
  const vectors: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  it.each(vectors)("T=%i", (t, sha1, sha256, sha512) => {
    expect(totp(seeds.sha1, t, { digits: 8, alg: "sha1" })).toBe(sha1);
    expect(totp(seeds.sha256, t, { digits: 8, alg: "sha256" })).toBe(sha256);
    expect(totp(seeds.sha512, t, { digits: 8, alg: "sha512" })).toBe(sha512);
  });
});

describe("TOTP verification window and replay", () => {
  const secret = Buffer.from("12345678901234567890");
  const now = 1_700_000_000_000;
  it("accepts the current step and ±1 step, rejects ±2", () => {
    const t = now / 1000;
    expect(verifyTotp(secret, totp(secret, t), { now }).ok).toBe(true);
    expect(verifyTotp(secret, totp(secret, t - 30), { now })).toMatchObject({ ok: true, drift: -1 });
    expect(verifyTotp(secret, totp(secret, t + 30), { now })).toMatchObject({ ok: true, drift: 1 });
    expect(verifyTotp(secret, totp(secret, t - 60), { now })).toEqual({ ok: false, reason: "invalid" });
    expect(verifyTotp(secret, totp(secret, t + 60), { now })).toEqual({ ok: false, reason: "invalid" });
  });
  it("rejects replays of the same or older step", () => {
    const code = totp(secret, now / 1000);
    const first = verifyTotp(secret, code, { now });
    expect(first.ok).toBe(true);
    const step = (first as { step: number }).step;
    expect(verifyTotp(secret, code, { now, lastUsedStep: step })).toEqual({ ok: false, reason: "replay" });
    expect(verifyTotp(secret, totp(secret, now / 1000 - 30), { now, lastUsedStep: step })).toEqual({ ok: false, reason: "replay" });
  });
  it("rejects malformed codes", () => {
    expect(verifyTotp(secret, "12345", { now })).toEqual({ ok: false, reason: "format" });
    expect(verifyTotp(secret, "abcdef", { now })).toEqual({ ok: false, reason: "format" });
  });
});

describe("base32 / sealing / signed tokens", () => {
  it("round-trips base32 (RFC 4648 vectors)", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Encode(Buffer.from("f"))).toBe("MY");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode("mzxw 6ytb-oi").toString()).toBe("foobar");
  });
  it("seals secrets with AES-GCM and detects tampering", () => {
    const s = seal("JBSWY3DPEHPK3PXP", "totp");
    expect(s).not.toContain("JBSWY3DPEHPK3PXP");
    expect(unseal(s, "totp")).toBe("JBSWY3DPEHPK3PXP");
    expect(() => unseal(s, "other-purpose")).toThrow();
    const parts = s.split(".");
    parts[2] = parts[2]!.slice(0, -2) + (parts[2]!.endsWith("A") ? "BB" : "AA");
    expect(() => unseal(parts.join("."), "totp")).toThrow();
  });
  it("signed tokens are purpose-bound, expiring and tamper-evident", () => {
    const now = Date.now();
    const t = signToken("x", { a: 1 }, 60, now);
    expect(verifyToken("x", t, now)?.a).toBe(1);
    expect(verifyToken("y", t, now)).toBeNull();
    expect(verifyToken("x", t, now + 61_000)).toBeNull();
    expect(verifyToken("x", t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now)).toBeNull();
  });
});

describe("enrolment, recovery codes and the sign-in gate", () => {
  const user = { id: "user-bank-demo", orgId: "org-bank-mekong", role: "enterprise_admin" as const };

  it("otpauth URI carries issuer, account and parameters", () => {
    const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "bank@demo.agrishield.io" });
    expect(uri).toMatch(/^otpauth:\/\/totp\/Agri-SHIELD:bank%40demo\.agrishield\.io\?/);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Agri-SHIELD");
    expect(uri).toContain("period=30");
  });

  it("enrols only with a valid code and returns 10 hashed recovery codes", () => {
    const e = beginEnrolment("bank@demo.agrishield.io");
    const now = Date.now();
    expect(confirmEnrolment(user.id, e.sealed, "000000", now).ok).toBe(false);
    const ok = confirmEnrolment(user.id, e.sealed, totp(openSecret(e.sealed), now / 1000), now);
    expect(ok.ok).toBe(true);
    const codes = (ok as { recoveryCodes: string[] }).recoveryCodes;
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const stored = secState().totp.get(user.id)!;
    expect(stored.recovery.every((r) => r.hash.length === 64 && !codes.includes(r.hash))).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(e.secret);
    expect(isEnrolled(user.id)).toBe(true);
  });

  it("the code used to enrol cannot be replayed at sign-in; next step works", () => {
    const e = beginEnrolment("bank@demo.agrishield.io");
    const now = Date.now();
    const code = totp(openSecret(e.sealed), now / 1000);
    confirmEnrolment(user.id, e.sealed, code, now);
    expect(verifySecondFactor(user.id, code, now)).toEqual({ ok: false, reason: "replay" });
    const next = totp(openSecret(e.sealed), now / 1000 + 30);
    expect(verifySecondFactor(user.id, next, now + 30_000)).toMatchObject({ ok: true, via: "totp" });
  });

  it("recovery codes work exactly once (case/hyphen-insensitive)", () => {
    const e = beginEnrolment("bank@demo.agrishield.io");
    const now = Date.now();
    const { recoveryCodes } = confirmEnrolment(user.id, e.sealed, totp(openSecret(e.sealed), now / 1000), now) as { recoveryCodes: string[] };
    const rc = recoveryCodes[3]!;
    expect(verifySecondFactor(user.id, rc.toUpperCase().replace("-", " "), now)).toEqual({ ok: true, via: "recovery", recoveryLeft: 9 });
    expect(verifySecondFactor(user.id, rc, now)).toEqual({ ok: false, reason: "invalid" });
    const fresh = regenerateRecoveryCodes(user.id)!;
    expect(verifySecondFactor(user.id, recoveryCodes[4]!, now).ok).toBe(false);
    expect(verifySecondFactor(user.id, fresh[0]!, now)).toMatchObject({ ok: true, via: "recovery" });
  });

  it("locks out after 5 wrong codes", () => {
    const e = beginEnrolment("bank@demo.agrishield.io");
    const now = Date.now();
    confirmEnrolment(user.id, e.sealed, totp(openSecret(e.sealed), now / 1000), now);
    for (let i = 0; i < 5; i++) expect(verifySecondFactor(user.id, "000001", now + 30_000).ok).toBe(false);
    const good = totp(openSecret(e.sealed), now / 1000 + 30);
    expect(verifySecondFactor(user.id, good, now + 30_000)).toEqual({ ok: false, reason: "locked" });
  });

  it("gate: verify when enrolled, enrol when the workspace requires 2FA, farmers never gated", () => {
    expect(twoFactorGate(user)).toBe("none");
    policyFor("org-bank-mekong").require2fa = true;
    expect(twoFactorGate(user)).toBe("enrol");
    expect(twoFactorGate({ id: "f1", orgId: "org-bank-mekong", role: "farmer" })).toBe("none");
    const e = beginEnrolment("x");
    confirmEnrolment(user.id, e.sealed, totp(openSecret(e.sealed), Date.now() / 1000));
    expect(twoFactorGate(user)).toBe("verify");
  });

  it("recovery code generator never produces digit-only codes", () => {
    for (let i = 0; i < 50; i++) for (const c of generateRecoveryCodes()) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  });
});

describe("sign-in challenges", () => {
  it("are single-use, attempt-limited and signature-checked", () => {
    const { token, challenge } = issueChallenge({ userId: "u1", purpose: "verify", firstFactor: "password", ip: "1.2.3.4", userAgent: "t" });
    expect(lookupChallenge(token).ok).toBe(true);
    expect(lookupChallenge(token.slice(0, -3) + "abc").ok).toBe(false);
    for (let i = 0; i < CHALLENGE_MAX_ATTEMPTS; i++) registerAttempt(challenge);
    expect(lookupChallenge(token)).toEqual({ ok: false, reason: "too_many_attempts" });
    const b = issueChallenge({ userId: "u1", purpose: "verify", firstFactor: "password", ip: "", userAgent: "" });
    consumeChallenge(b.challenge);
    expect(lookupChallenge(b.token)).toEqual({ ok: false, reason: "used" });
    expect(lookupChallenge(b.token, Date.now() + 6 * 60_000).ok).toBe(false);
  });
});

describe("QR encoder", () => {
  it("picks the smallest level-M version and draws finder patterns", () => {
    expect(pickVersion(14)).toBe(1);
    expect(pickVersion(15)).toBe(2);
    expect(pickVersion(122)).toBe(7);
    const qr = encodeQr(otpauthUri({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", account: "bank@demo.agrishield.io" }));
    expect(qr.size).toBe(qr.version * 4 + 17);
    // top-left finder: dark ring, light ring, dark 3×3 core
    const m = qr.modules;
    expect(m[0]![0]).toBe(true);
    expect(m[1]![1]).toBe(false);
    expect(m[3]![3]).toBe(true);
    expect(m[0]![qr.size - 1]).toBe(true);
    expect(m[qr.size - 1]![0]).toBe(true);
    // dark module
    expect(m[qr.size - 8]![8]).toBe(true);
  });
});
