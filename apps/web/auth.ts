/**
 * NextAuth v5 — credentials (email+password for orgs) and phone/email OTP for farmers.
 * Demo mode: OTP 123456 is accepted for any registered farmer (spec §15).
 * Production: set TWILIO_* to deliver real OTPs (see server/notify/sms.ts).
 *
 * Enterprise security (node-side only — auth.config.ts stays edge-safe):
 *  - 2-step verification: a correct first factor for a user with TOTP (or whose
 *    workspace requires 2FA) does NOT create a session. authorize() throws a
 *    `mfa_required:<challenge>` / `mfa_enrol:<challenge>` code; the client goes
 *    to /auth/two-factor and redeems the short-lived signed challenge with a
 *    TOTP / recovery code (mode "mfa") — only then is the session minted.
 *  - SSO: /api/sso/callback verifies the OIDC ID token and sets a one-time
 *    assertion cookie; mode "sso" redeems it.
 *  - Sessions: every sign-in registers a server-side session (sid in the JWT);
 *    the jwt callback below rejects revoked sessions on every auth() call.
 */
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { getStore, audit, nextId, type UserRecord } from "./server/data/store";
import { otpKey, verifyOtp } from "./server/auth/otp";
import { isPhoneLike, normalizePhone, phonesMatch } from "./server/auth/phone";
import { consumeChallenge, issueChallenge, lookupChallenge, readCookie, redeemAssertion, registerAttempt, SSO_ASSERTION_COOKIE } from "./server/auth/challenge";
import { beginEnrolment, isLockedOut, twoFactorGate, verifySecondFactor } from "./server/services/totp";
import { checkSession, clientIpFromHeaders, createSession } from "./server/services/sessions";
import { ssoEnforcedFor } from "./server/services/sso";
import type { SignInMethod } from "./server/auth/security-state";

class InvalidLogin extends CredentialsSignin {
  code = "invalid_credentials";
}
class Suspended extends CredentialsSignin {
  code = "account_suspended";
}
class Coded extends CredentialsSignin {
  constructor(code: string) {
    super();
    this.code = code;
  }
}

const schema = z.union([
  z.object({ mode: z.literal("password"), email: z.string().email(), password: z.string().min(4).max(128) }),
  z.object({ mode: z.literal("otp"), identifier: z.string().min(5).max(128), otp: z.string().regex(/^\d{6}$/) }),
  z.object({ mode: z.literal("mfa"), challenge: z.string().min(20).max(1024), code: z.string().max(32).optional() }),
  z.object({ mode: z.literal("sso") }),
]);

function finish(user: UserRecord, method: SignInMethod, amr: string[], request: Request | undefined) {
  if (user.status === "suspended") throw new Suspended();
  user.lastActive = new Date();
  const session = createSession({ userId: user.id, orgId: user.orgId, method, amr, ip: clientIpFromHeaders(request?.headers), userAgent: request?.headers.get("user-agent") ?? "" });
  audit({ userId: user.id, userName: user.name, action: "auth.signin", entity: "user", entityId: user.id, details: `Signed in via ${method}` });
  return { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, language: user.language, sid: session.id, amr };
}

/** After a correct first factor: mint a session, or hand out a 2-step challenge. */
function afterFirstFactor(user: UserRecord, firstFactor: "password" | "otp", request: Request | undefined) {
  if (user.status === "suspended") throw new Suspended();
  const gate = twoFactorGate(user);
  if (gate === "none") return finish(user, firstFactor, [firstFactor === "password" ? "pwd" : "otp"], request);
  if (isLockedOut(user.id)) throw new Coded("mfa_locked");
  const ip = clientIpFromHeaders(request?.headers);
  const ua = request?.headers.get("user-agent") ?? "";
  const pending = gate === "enrol" ? beginEnrolment(user.email ?? user.id).sealed : null;
  const { token } = issueChallenge({ userId: user.id, purpose: gate === "enrol" ? "enrol" : "verify", firstFactor, ip, userAgent: ua, pendingSecretSealed: pending });
  audit({ userId: user.id, userName: user.name, action: gate === "enrol" ? "auth.2fa.enrol_required" : "auth.2fa.challenge", entity: "user", entityId: user.id, details: `${firstFactor} accepted — second step required` });
  throw new Coded(`${gate === "enrol" ? "mfa_enrol" : "mfa_required"}:${token}`);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Node-side wrapper: same claims as the edge config + session denylist check
    jwt(params) {
      const token = authConfig.callbacks.jwt(params);
      if (params.user || !token) return token;
      const check = checkSession({ sid: token.sid as string | undefined, uid: token.uid as string | undefined, authAt: token.authAt as number | undefined, orgId: (token.orgId as string | null) ?? null });
      return check.ok ? token : null;
    },
  },
  providers: [
    Credentials({
      credentials: { mode: {}, email: {}, password: {}, identifier: {}, otp: {}, challenge: {}, code: {} },
      async authorize(raw, request) {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) throw new InvalidLogin();
        const store = getStore();
        const data = parsed.data;

        if (data.mode === "mfa") {
          const look = lookupChallenge(data.challenge);
          if (!look.ok) throw new Coded(look.reason === "too_many_attempts" ? "mfa_locked" : "mfa_expired");
          const c = look.challenge;
          const user = store.users.find((u) => u.id === c.userId);
          if (!user) throw new InvalidLogin();
          const first = c.firstFactor === "password" ? "pwd" : "otp";
          if (c.state === "satisfied") {
            // Enrolment was just confirmed with a valid code (developer.security.confirmChallengeEnrolment)
            consumeChallenge(c);
            return finish(user, `${c.firstFactor}+${c.satisfiedWith ?? "totp"}` as SignInMethod, [first, "otp", "mfa"], request);
          }
          if (c.purpose === "enrol" || !data.code) throw new Coded("mfa_invalid");
          registerAttempt(c);
          const res = verifySecondFactor(user.id, data.code);
          if (!res.ok) {
            audit({ userId: user.id, userName: user.name, action: "auth.2fa.failed", entity: "user", entityId: user.id, details: `Second step rejected (${res.reason})` });
            throw new Coded(res.reason === "locked" ? "mfa_locked" : res.reason === "replay" ? "mfa_replay" : "mfa_invalid");
          }
          consumeChallenge(c);
          if (res.via === "recovery") audit({ userId: user.id, userName: user.name, action: "auth.2fa.recovery_used", entity: "user", entityId: user.id, details: `Recovery code used · ${res.recoveryLeft} left` });
          return finish(user, `${c.firstFactor}+${res.via}` as SignInMethod, [first, res.via === "totp" ? "otp" : "rc", "mfa"], request);
        }

        if (data.mode === "sso") {
          const assertion = redeemAssertion(readCookie(request?.headers.get("cookie"), SSO_ASSERTION_COOKIE));
          if (!assertion) throw new Coded("sso_failed");
          const user = store.users.find((u) => u.id === assertion.userId && u.orgId === assertion.orgId);
          if (!user) throw new Coded("sso_failed");
          return finish(user, "sso", ["sso"], request);
        }

        let user;
        if (data.mode === "password") {
          user = store.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
          if (!user || !user.password || user.password !== data.password) throw new InvalidLogin();
          if (ssoEnforcedFor(user.email)) throw new Coded("sso_required");
          return afterFirstFactor(user, "password", request);
        } else {
          const raw = data.identifier.trim();
          const phone = isPhoneLike(raw);
          const email = raw.toLowerCase();
          user = phone ? store.users.find((u) => phonesMatch(u.phone, raw)) : store.users.find((u) => u.email?.toLowerCase() === email);
          if (!verifyOtp(otpKey(raw), data.otp)) throw new InvalidLogin();
          if (!user && phone) {
            // Phone-first sign-up: a verified number that is new to us becomes a farmer
            // account; the farmer app then routes them through onboarding.
            user = {
              id: nextId("user"),
              email: null,
              phone: normalizePhone(raw),
              name: "New farmer",
              role: "farmer" as const,
              language: "en" as const,
              orgId: null,
              subscriptionTier: "free" as const,
              status: "active" as const,
              createdAt: new Date(),
              lastActive: new Date(),
            };
            store.users.push(user);
            audit({ userId: user.id, userName: user.name, action: "user.register", entity: "user", entityId: user.id, details: "Registered via phone OTP" });
          }
          if (!user) throw new InvalidLogin();
          if (!phone && ssoEnforcedFor(user.email)) throw new Coded("sso_required");
          return afterFirstFactor(user, "otp", request);
        }
      },
    }),
  ],
});
