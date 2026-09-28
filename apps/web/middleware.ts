import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { PROTECTED_ROUTES, can, homeForRole } from "./lib/rbac";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const rule = PROTECTED_ROUTES.find((r) => pathname.startsWith(r.prefix));
  if (!rule) return NextResponse.next();

  const user = req.auth?.user;
  if (!user) {
    const url = new URL("/auth/signin", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (rule.permission && !can(user.role, rule.permission)) {
    return NextResponse.redirect(new URL(homeForRole(user.role), req.nextUrl.origin));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/onboarding/:path*"],
};
