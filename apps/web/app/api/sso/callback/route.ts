/**
 * GET /api/sso/callback — OpenID Connect redirect URI.
 * Verifies state, exchanges the code (PKCE), verifies the ID token against the
 * IdP's JWKS, applies domain / JIT rules and sets a one-time assertion cookie
 * that /auth/sso redeems to create the NextAuth session.
 */
import { NextResponse, type NextRequest } from "next/server";
import { completeSso, SSO_TX_COOKIE } from "@/server/services/sso";
import { ASSERTION_TTL_SEC, SSO_ASSERTION_COOKIE } from "@/server/auth/challenge";
import { clientIpFromHeaders } from "@/server/services/sessions";
import { audit } from "@/server/data/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const q = req.nextUrl.searchParams;
  const result = await completeSso({
    code: q.get("code"),
    state: q.get("state"),
    error: q.get("error_description") ?? q.get("error"),
    txToken: req.cookies.get(SSO_TX_COOKIE)?.value ?? null,
    ip: clientIpFromHeaders(req.headers),
    userAgent: req.headers.get("user-agent") ?? "",
  });
  const target = new URL("/auth/sso", origin);
  if (!result.ok) {
    target.searchParams.set("error", result.code);
    target.searchParams.set("message", result.message);
    audit({ userId: "anonymous", userName: "SSO", action: "auth.sso.failed", entity: "sso", entityId: result.code, details: result.message });
  } else {
    target.searchParams.set("complete", "1");
    if (result.callbackUrl) target.searchParams.set("callbackUrl", result.callbackUrl);
    if (result.provisioned) target.searchParams.set("new", "1");
  }
  const res = NextResponse.redirect(target);
  res.cookies.set(SSO_TX_COOKIE, "", { path: "/api/sso", maxAge: 0 });
  if (result.ok) res.cookies.set(SSO_ASSERTION_COOKIE, result.assertion, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/api/auth", maxAge: ASSERTION_TTL_SEC });
  return res;
}
