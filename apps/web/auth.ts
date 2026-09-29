/**
 * NextAuth v5 — credentials (email+password for orgs) and phone/email OTP for farmers.
 * Demo mode: OTP 123456 is accepted for any registered farmer (spec §15).
 * Production: set TWILIO_* to deliver real OTPs (see server/notify/sms.ts).
 */
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { getStore, audit, nextId } from "./server/data/store";
import { otpKey, verifyOtp } from "./server/auth/otp";
import { isPhoneLike, normalizePhone, phonesMatch } from "./server/auth/phone";

class InvalidLogin extends CredentialsSignin {
  code = "invalid_credentials";
}
class Suspended extends CredentialsSignin {
  code = "account_suspended";
}

const schema = z.union([
  z.object({ mode: z.literal("password"), email: z.string().email(), password: z.string().min(4).max(128) }),
  z.object({ mode: z.literal("otp"), identifier: z.string().min(5).max(128), otp: z.string().regex(/^\d{6}$/) }),
]);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { mode: {}, email: {}, password: {}, identifier: {}, otp: {} },
      async authorize(raw) {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) throw new InvalidLogin();
        const store = getStore();
        const data = parsed.data;
        let user;
        if (data.mode === "password") {
          user = store.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
          if (!user || !user.password || user.password !== data.password) throw new InvalidLogin();
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
        }
        if (user.status === "suspended") throw new Suspended();
        user.lastActive = new Date();
        audit({ userId: user.id, userName: user.name, action: "auth.signin", entity: "user", entityId: user.id, details: `Signed in via ${data.mode}` });
        return { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, language: user.language };
      },
    }),
  ],
});
