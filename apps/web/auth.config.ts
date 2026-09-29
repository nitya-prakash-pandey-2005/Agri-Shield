/**
 * Edge-safe NextAuth config (used by middleware). No providers that touch data.
 * Session revocation, 2-step verification and SSO are enforced node-side in
 * auth.ts (jwt callback wrapper) and server/trpc.ts — nothing here may import
 * node:crypto or the store.
 */
import type { NextAuthConfig } from "next-auth";
import type { UserRole, SupportedLanguage } from "@agri-shield/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email?: string | null;
      role: UserRole;
      orgId: string | null;
      language: SupportedLanguage;
    };
    /** Server-side session id (see server/services/sessions.ts) */
    sid?: string;
    /** Authentication methods used at sign-in (RFC 8176): pwd, otp, mfa, sso… */
    amr?: string[];
  }
  interface User {
    role?: UserRole;
    orgId?: string | null;
    language?: SupportedLanguage;
    sid?: string;
    amr?: string[];
  }
}

export const authConfig = {
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "agri-shield-dev-secret-change-me-in-production-0f3c9",
  trustHost: true,
  session: { strategy: "jwt", maxAge: 7 * 24 * 3600 },
  pages: { signIn: "/auth/signin", error: "/auth/signin" },
  logger: {
    // A wrong password / OTP is a normal outcome, not a server error — keep logs clean
    error(error) {
      if ((error as { type?: string }).type === "CredentialsSignin" || error.name === "CredentialsSignin") return;
      console.error("[auth]", error);
    },
  },
  providers: [],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        token.orgId = user.orgId ?? null;
        token.language = user.language ?? "en";
        if (user.sid) token.sid = user.sid;
        if (user.amr) token.amr = user.amr;
        token.authAt = Date.now();
      }
      if (trigger === "update" && session?.language) token.language = session.language;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      session.user.role = token.role as UserRole;
      session.user.orgId = (token.orgId as string | null) ?? null;
      session.user.language = (token.language as SupportedLanguage) ?? "en";
      if (token.sid) session.sid = token.sid as string;
      if (token.amr) session.amr = token.amr as string[];
      return session;
    },
  },
} satisfies NextAuthConfig;
