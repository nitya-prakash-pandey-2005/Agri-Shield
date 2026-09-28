/**
 * Edge-safe NextAuth config (used by middleware). No providers that touch data.
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
  }
  interface User {
    role?: UserRole;
    orgId?: string | null;
    language?: SupportedLanguage;
  }
}

export const authConfig = {
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "agri-shield-dev-secret-change-me-in-production-0f3c9",
  trustHost: true,
  session: { strategy: "jwt", maxAge: 7 * 24 * 3600 },
  pages: { signIn: "/auth/signin", error: "/auth/signin" },
  providers: [],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        token.orgId = user.orgId ?? null;
        token.language = user.language ?? "en";
      }
      if (trigger === "update" && session?.language) token.language = session.language;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      session.user.role = token.role as UserRole;
      session.user.orgId = (token.orgId as string | null) ?? null;
      session.user.language = (token.language as SupportedLanguage) ?? "en";
      return session;
    },
  },
} satisfies NextAuthConfig;
