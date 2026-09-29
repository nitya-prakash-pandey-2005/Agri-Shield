/**
 * GET /api/sso/start?email=<work e-mail>[&callbackUrl=/app]
 * Discovers the workspace by e-mail domain, then redirects to its OpenID
 * Connect provider with state, nonce and a PKCE S256 challenge. The
 * transaction is kept in a signed, httpOnly, 10-minute cookie.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SSO_TX_COOKIE, SSO_TX_TTL_SEC, startSso } from "@/server/services/sso";
import { rateLimit } from "@/server/rate-limit";
import { clientIpFromHeaders } from "@/server/services/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const email = req.nextUrl.searchParams.get("email");
  const orgId = req.nextUrl.searchParams.get("org");
  const callbackUrl = req.nextUrl.searchParams.get("callbackUrl");
  const back = (code: string, message: string) => {
    const u = new URL("/auth/sso", origin);
    u.searchParams.set("error", code);
    u.searchParams.set("message", message);
    if (email) u.searchParams.set("email", email);
    return NextResponse.redirect(u);
  };
  if (!rateLimit(`sso:start:${clientIpFromHeaders(req.headers)}`, 20)) return back("rate_limited", "Too many attempts — wait a minute");
  try {
    const { url, txCookie } = await startSso({ email, orgId, origin, callbackUrl });
    const res = NextResponse.redirect(url);
    res.cookies.set(SSO_TX_COOKIE, txCookie, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/api/sso", maxAge: SSO_TX_TTL_SEC });
    return res;
  } catch (e) {
    return back((e as { code?: string }).code ?? "sso_error", (e as Error).message);
  }
}
