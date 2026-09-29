/**
 * /api/dev/mock-idp/* — MOCK OpenID Connect provider for development & demos.
 * Not a real identity provider: see server/auth/mock-idp.ts. Disabled in
 * production unless demo mode / ENABLE_MOCK_IDP is on.
 *
 *   GET  .well-known/openid-configuration   discovery
 *   GET  jwks                                RS256 public key
 *   GET  authorize   → consent/identity form   POST authorize → redirect with code
 *   POST token                               code + PKCE → ID token
 *   GET  userinfo
 */
import { NextResponse, type NextRequest } from "next/server";
import { authorizePage, discoveryDoc, issueCode, jwks, readAuthorizeParams, tokenExchange, userinfo, validateAuthorize } from "@/server/auth/mock-idp";
import { mockIdpEnabled } from "@/server/services/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const headers = { "Cache-Control": "no-store", "X-Mock-IdP": "development-only" };
const html = (body: string, status = 200) => new NextResponse(body, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY" } });
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export async function GET(req: NextRequest, { params }: Ctx) {
  if (!mockIdpEnabled()) return json({ error: "not_found" }, 404);
  const path = (await params).path.join("/");
  const origin = req.nextUrl.origin;
  if (path === ".well-known/openid-configuration") return json(discoveryDoc(origin));
  if (path === "jwks") return json(jwks());
  if (path === "userinfo") {
    const r = userinfo(req.headers.get("authorization"));
    return json(r.body, r.status);
  }
  if (path === "authorize") {
    const p = readAuthorizeParams(req.nextUrl.searchParams);
    const err = validateAuthorize(p, origin);
    if (err) return html(`<!doctype html><meta charset="utf-8"><title>Mock IdP error</title><body style="font-family:system-ui;background:#020617;color:#fecdd3;padding:24px"><h1>Mock IdP — invalid request</h1><p>${err.replace(/</g, "&lt;")}</p></body>`, 400);
    return html(authorizePage(p, origin, null));
  }
  return json({ error: "not_found" }, 404);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  if (!mockIdpEnabled()) return json({ error: "not_found" }, 404);
  const path = (await params).path.join("/");
  const origin = req.nextUrl.origin;
  const form = new URLSearchParams(await req.text());
  if (path === "token") {
    const r = tokenExchange(form, req.headers.get("authorization"), origin);
    return json(r.body, r.status);
  }
  if (path === "authorize") {
    const p = readAuthorizeParams(form);
    const err = validateAuthorize(p, origin);
    if (err) return html(`<!doctype html><meta charset="utf-8"><body>${err.replace(/</g, "&lt;")}</body>`, 400);
    const back = new URL(p.redirect_uri);
    back.searchParams.set("state", p.state);
    if (form.get("decision") !== "allow") {
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("error_description", "The user denied the sign-in at the identity provider");
      return NextResponse.redirect(back, 303);
    }
    const email = (form.get("email") ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return html(authorizePage(p, origin, "Enter a valid e-mail address"), 400);
    const code = issueCode(p, { email, name: (form.get("name") ?? "").trim() || email.split("@")[0]!, emailVerified: form.get("email_verified") === "true" });
    back.searchParams.set("code", code);
    return NextResponse.redirect(back, 303);
  }
  return json({ error: "not_found" }, 404);
}
