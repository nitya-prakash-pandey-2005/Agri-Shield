import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const DEMO = {
  farmer: { mode: "otp", identifier: "farmer@demo.agrishield.io", otp: "123456" },
  gov: { mode: "password", email: "gov@demo.agrishield.io", password: "demo2026" },
  admin: { mode: "password", email: "admin@demo.agrishield.io", password: "demo2026" },
} as const;

/** Sign in through the real NextAuth credentials endpoint; cookies land in the page's context. */
export async function signIn(page: Page, creds: Record<string, string>) {
  const req = page.request;
  const csrf = await (await req.get("/api/auth/csrf")).json();
  const res = await req.post("/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, callbackUrl: "/", json: "true", ...creds },
    maxRedirects: 0,
  });
  expect([200, 302]).toContain(res.status());
  const session = await (await req.get("/api/auth/session")).json();
  expect(session?.user?.id, "session established").toBeTruthy();
  return session.user as { id: string; role: string; name: string };
}

/** Call a tRPC procedure over HTTP (superjson envelope). */
export async function trpc<T = unknown>(req: APIRequestContext, path: string, input?: unknown, method: "query" | "mutation" = "query"): Promise<T> {
  const res =
    method === "query"
      ? await req.get(`/api/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`)
      : await req.post(`/api/trpc/${path}`, { data: { json: input ?? null } });
  const body = await res.json();
  expect(res.ok(), `${path}: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
  return body.result.data.json as T;
}
