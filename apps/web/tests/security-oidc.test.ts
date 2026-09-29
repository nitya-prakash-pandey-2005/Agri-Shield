import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSign, generateKeyPairSync, sign as cryptoSign, constants, type KeyObject } from "node:crypto";

vi.mock("@/auth", () => ({ auth: async () => null, signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const { validateIdToken, verifyJwsSignature, pkcePair, pkceChallenge, OidcError } = await import("@/server/auth/oidc");
const { __resetSecurityState } = await import("@/server/auth/security-state");
const { getStore, resetStore } = await import("@/server/data/store");
const sso = await import("@/server/services/sso");
const mockIdp = await import("@/server/auth/mock-idp");
const { redeemAssertion } = await import("@/server/auth/challenge");

const b64u = (x: Buffer | string) => Buffer.from(x).toString("base64url");

function makeJwt(alg: string, key: KeyObject, payload: Record<string, unknown>, kid = "k1") {
  const head = b64u(JSON.stringify({ alg, kid, typ: "JWT" }));
  const body = b64u(JSON.stringify(payload));
  const input = Buffer.from(`${head}.${body}`);
  let sig: Buffer;
  if (alg.startsWith("RS")) sig = createSign(`RSA-SHA${alg.slice(2)}`).update(input).sign(key);
  else if (alg.startsWith("PS")) sig = cryptoSign(`sha${alg.slice(2)}`, input, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST });
  else sig = cryptoSign(`sha${alg.slice(2)}`, input, { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64u(sig)}`;
}

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = {
  keys: [
    { ...(rsa.publicKey.export({ format: "jwk" }) as object), kid: "k1", use: "sig" },
    { ...(ec.publicKey.export({ format: "jwk" }) as object), kid: "e1", use: "sig" },
  ],
} as unknown as { keys: { kty: string; kid?: string }[] };

const now = 1_760_000_000_000;
const base = { iss: "https://idp.example.com", aud: "client-1", sub: "abc", iat: now / 1000, exp: now / 1000 + 300, nonce: "n-1", email: "a@corp.example" };
const expect_ = { issuer: "https://idp.example.com/", clientId: "client-1", nonce: "n-1", now };

describe("JWKS / ID token verification", () => {
  it("verifies RS256, PS256 and ES256 signatures", () => {
    expect(validateIdToken(makeJwt("RS256", rsa.privateKey, base), jwks, expect_).sub).toBe("abc");
    expect(validateIdToken(makeJwt("PS256", rsa.privateKey, base), jwks, expect_).sub).toBe("abc");
    expect(validateIdToken(makeJwt("ES256", ec.privateKey, base, "e1"), jwks, expect_).sub).toBe("abc");
  });

  it("rejects a token signed by a key not in the JWKS", () => {
    expect(() => validateIdToken(makeJwt("RS256", other.privateKey, base), jwks, expect_)).toThrow(/signature/);
  });

  it("rejects unknown kid, alg=none and HS256 (key-confusion)", () => {
    expect(() => validateIdToken(makeJwt("RS256", rsa.privateKey, base, "nope"), jwks, expect_)).toThrow(/kid/);
    const none = `${b64u(JSON.stringify({ alg: "none" }))}.${b64u(JSON.stringify(base))}.`;
    expect(() => validateIdToken(none, jwks, expect_)).toThrow(/not allowed/);
    const hs = `${b64u(JSON.stringify({ alg: "HS256", kid: "k1" }))}.${b64u(JSON.stringify(base))}.${b64u("x")}`;
    expect(() => validateIdToken(hs, jwks, expect_)).toThrow(/not allowed/);
  });

  it("rejects tampered payloads", () => {
    const t = makeJwt("RS256", rsa.privateKey, base).split(".");
    t[1] = b64u(JSON.stringify({ ...base, email: "ceo@corp.example" }));
    expect(() => validateIdToken(t.join("."), jwks, expect_)).toThrow(/signature/);
  });

  it("checks iss, aud, exp, nbf, iat and nonce", () => {
    const tok = (p: Record<string, unknown>) => makeJwt("RS256", rsa.privateKey, { ...base, ...p });
    const code = (fn: () => unknown) => {
      try {
        fn();
        return "ok";
      } catch (e) {
        return (e as InstanceType<typeof OidcError>).code;
      }
    };
    expect(code(() => validateIdToken(tok({ iss: "https://evil.example" }), jwks, expect_))).toBe("bad_iss");
    expect(code(() => validateIdToken(tok({ aud: "someone-else" }), jwks, expect_))).toBe("bad_aud");
    expect(code(() => validateIdToken(tok({ aud: ["client-1", "x"], azp: "x" }), jwks, expect_))).toBe("bad_azp");
    expect(code(() => validateIdToken(tok({ exp: now / 1000 - 120 }), jwks, expect_))).toBe("expired");
    expect(code(() => validateIdToken(tok({ exp: now / 1000 - 30 }), jwks, expect_))).toBe("ok"); // within 60 s skew
    expect(code(() => validateIdToken(tok({ nbf: now / 1000 + 600 }), jwks, expect_))).toBe("not_yet_valid");
    expect(code(() => validateIdToken(tok({ iat: now / 1000 + 600 }), jwks, expect_))).toBe("bad_iat");
    expect(code(() => validateIdToken(tok({ nonce: "replayed" }), jwks, expect_))).toBe("bad_nonce");
  });

  it("reports the verifying kid", () => {
    expect(verifyJwsSignature(makeJwt("ES256", ec.privateKey, base, "e1"), jwks).kid).toBe("e1");
  });

  it("PKCE S256 matches RFC 7636 Appendix B", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const p = pkcePair();
    expect(p.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkceChallenge(p.verifier)).toBe(p.challenge);
  });
});

describe("SSO end-to-end against the built-in mock IdP (fetch stubbed to the mock handlers)", () => {
  const origin = "http://localhost:3999";
  beforeEach(() => {
    resetStore();
    __resetSecurityState();
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/dev/mock-idp/", "");
      const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (path === ".well-known/openid-configuration") return res(mockIdp.discoveryDoc(origin));
      if (path === "jwks") return res(mockIdp.jwks());
      if (path === "token") {
        const r = mockIdp.tokenExchange(new URLSearchParams(String(init?.body)), new Headers(init?.headers).get("authorization"), origin);
        return res(r.body, r.status);
      }
      return res({ error: "not_found" }, 404);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const configure = (over: Partial<Parameters<typeof sso.saveSsoConfig>[1]> = {}) => {
    const org = getStore().orgs.find((o) => o.id === "org-bank-mekong")!;
    return sso.saveSsoConfig(org, { enabled: true, issuer: `${origin}/api/dev/mock-idp`, clientId: sso.MOCK_IDP.clientId, clientSecret: sso.MOCK_IDP.clientSecret, allowedDomains: ["mekongcredit.example"], defaultRole: "enterprise_analyst", jitProvisioning: true, enforceForDomains: false, ...over }, { id: "user-bank-demo", name: "Admin" });
  };

  async function runFlow(email: string, verified = true) {
    const start = await sso.startSso({ email, origin, callbackUrl: "/app" });
    const authUrl = new URL(start.url);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    const params = mockIdp.readAuthorizeParams(authUrl.searchParams);
    expect(mockIdp.validateAuthorize(params, origin)).toBeNull();
    const code = mockIdp.issueCode(params, { email, name: "Linh Pham", emailVerified: verified });
    return sso.completeSso({ code, state: params.state, txToken: start.txCookie, ip: "10.1.1.1", userAgent: "vitest" });
  }

  it("discovers by domain, verifies the RS256 ID token and JIT-provisions the user", async () => {
    configure();
    const before = getStore().users.length;
    const r = await runFlow("linh.pham@mekongcredit.example");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provisioned).toBe(true);
    expect(r.user).toMatchObject({ email: "linh.pham@mekongcredit.example", orgId: "org-bank-mekong", role: "enterprise_analyst" });
    expect(getStore().users.length).toBe(before + 1);
    expect(r.callbackUrl).toBe("/app");
    const a = redeemAssertion(r.assertion);
    expect(a?.userId).toBe(r.user.id);
    expect(redeemAssertion(r.assertion)).toBeNull(); // single use
    const again = await runFlow("linh.pham@mekongcredit.example");
    expect(again.ok && again.provisioned).toBe(false);
  });

  it("refuses unverified e-mail, other domains, JIT-off and tampered state", async () => {
    configure();
    expect(await runFlow("x@mekongcredit.example", false)).toMatchObject({ ok: false, code: "email_unverified" });
    await expect(sso.startSso({ email: "x@other.example", origin })).rejects.toThrow(/No workspace/);
    configure({ jitProvisioning: false });
    expect(await runFlow("new.person@mekongcredit.example")).toMatchObject({ ok: false, code: "no_account" });
    const start = await sso.startSso({ email: "linh@mekongcredit.example", origin });
    expect(await sso.completeSso({ code: "x", state: "forged", txToken: start.txCookie, ip: "", userAgent: "" })).toMatchObject({ ok: false, code: "bad_state" });
    expect(await sso.completeSso({ code: "x", state: "x", txToken: "garbage", ip: "", userAgent: "" })).toMatchObject({ ok: false, code: "sso_expired" });
  });

  it("rejects a wrong PKCE verifier at the token endpoint", () => {
    const params = mockIdp.readAuthorizeParams(new URLSearchParams({ client_id: sso.MOCK_IDP.clientId, redirect_uri: `${origin}/api/sso/callback`, response_type: "code", state: "s", nonce: "n", code_challenge: pkcePair().challenge, code_challenge_method: "S256", scope: "openid email" }));
    const code = mockIdp.issueCode(params, { email: "a@b.example", name: "A", emailVerified: true });
    const r = mockIdp.tokenExchange(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: params.redirect_uri, client_id: sso.MOCK_IDP.clientId, client_secret: sso.MOCK_IDP.clientSecret, code_verifier: pkcePair().verifier }), null, origin);
    expect(r.status).toBe(400);
    expect(r.body.error_description).toMatch(/PKCE/);
  });

  it("validates configuration: public domains, domain clashes, http issuers", () => {
    const org = getStore().orgs.find((o) => o.id === "org-bank-mekong")!;
    const by = { id: "u", name: "A" };
    const cfg = { enabled: true, issuer: "https://idp.example.com", clientId: "c", clientSecret: "s", allowedDomains: ["gmail.com"], defaultRole: "enterprise_analyst" as const, jitProvisioning: true, enforceForDomains: false };
    expect(() => sso.saveSsoConfig(org, cfg, by)).toThrow(/shared mailbox/);
    expect(() => sso.saveSsoConfig(org, { ...cfg, issuer: "http://idp.example.com", allowedDomains: ["corp.example"] }, by)).toThrow(/https/);
    sso.saveSsoConfig(org, { ...cfg, allowedDomains: ["corp.example"] }, by);
    const ins = getStore().orgs.find((o) => o.id === "org-ins-deltamutual")!;
    expect(() => sso.saveSsoConfig(ins, { ...cfg, allowedDomains: ["corp.example"] }, by)).toThrow(/already claimed/);
    expect(sso.ssoView(org.id).hasClientSecret).toBe(true);
    expect(JSON.stringify(sso.ssoView(org.id))).not.toContain('"s"');
  });

  it("SSO enforcement blocks password sign-in for the domain", () => {
    configure({ enforceForDomains: true });
    expect(sso.ssoEnforcedFor("someone@mekongcredit.example")).toBe(true);
    expect(sso.ssoEnforcedFor("bank@demo.agrishield.io")).toBe(false);
  });
});
