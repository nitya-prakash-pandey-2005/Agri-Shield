/**
 * MOCK OpenID Connect identity provider — DEVELOPMENT / DEMO ONLY.
 *
 * Lets the full SSO flow (discovery → authorize → code + PKCE → token → RS256
 * ID token → JWKS verification → JIT provisioning) be demonstrated without an
 * external IdP. It performs no real authentication: whoever uses the form can
 * assert any e-mail. It is disabled when NODE_ENV=production and demo mode is
 * off (see mockIdpEnabled) and every page it renders is labelled as a mock.
 */
import { createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { b64url, safeEqual, sha256b64url } from "./crypto";
import { secState } from "./security-state";
import { MOCK_IDP } from "../services/sso";

interface MockState {
  kid: string;
  privateKey: KeyObject;
  publicJwk: Record<string, unknown>;
  codes: Map<string, { email: string; name: string; emailVerified: boolean; clientId: string; redirectUri: string; nonce: string | null; challenge: string; exp: number; used: boolean }>;
  tokens: Map<string, { email: string; name: string; exp: number }>;
}

const g = globalThis as unknown as { __agriMockIdp?: MockState };

function mock(): MockState {
  if (g.__agriMockIdp) return g.__agriMockIdp;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `mock-${randomBytes(6).toString("hex")}`;
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  return (g.__agriMockIdp = { kid, privateKey, publicJwk: { ...jwk, kid, use: "sig", alg: "RS256" }, codes: new Map(), tokens: new Map() });
}

export const issuerFor = (origin: string) => `${origin}${MOCK_IDP.path}`;

export function discoveryDoc(origin: string) {
  const iss = issuerFor(origin);
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/authorize`,
    token_endpoint: `${iss}/token`,
    userinfo_endpoint: `${iss}/userinfo`,
    jwks_uri: `${iss}/jwks`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "email", "profile"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    claims_supported: ["sub", "email", "email_verified", "name", "amr"],
    "x-agrishield-mock": "Development/demo identity provider — not for production use",
  };
}

export const jwks = () => ({ keys: [mock().publicJwk] });

export function signJwt(payload: Record<string, unknown>): string {
  const m = mock();
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: m.kid }));
  const body = b64url(JSON.stringify(payload));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(m.privateKey);
  return `${head}.${body}.${b64url(sig)}`;
}

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  state: string;
  nonce: string | null;
  code_challenge: string;
  code_challenge_method: string;
  login_hint: string | null;
  scope: string;
}

export function readAuthorizeParams(src: URLSearchParams): AuthorizeParams {
  return {
    client_id: src.get("client_id") ?? "",
    redirect_uri: src.get("redirect_uri") ?? "",
    response_type: src.get("response_type") ?? "",
    state: src.get("state") ?? "",
    nonce: src.get("nonce"),
    code_challenge: src.get("code_challenge") ?? "",
    code_challenge_method: src.get("code_challenge_method") ?? "",
    login_hint: src.get("login_hint"),
    scope: src.get("scope") ?? "",
  };
}

/** Only this app's own callback may receive codes from the mock. */
export function validateAuthorize(p: AuthorizeParams, origin: string): string | null {
  if (p.client_id !== MOCK_IDP.clientId) return `Unknown client_id "${p.client_id}" (the mock IdP only knows ${MOCK_IDP.clientId})`;
  if (p.redirect_uri !== `${origin}/api/sso/callback`) return "redirect_uri is not registered for this client";
  if (p.response_type !== "code") return "Only response_type=code is supported";
  if (p.code_challenge_method !== "S256" || p.code_challenge.length < 43) return "PKCE with S256 is required";
  if (!p.scope.split(" ").includes("openid")) return "scope must include openid";
  if (!p.state) return "state is required";
  return null;
}

export function issueCode(p: AuthorizeParams, who: { email: string; name: string; emailVerified: boolean }): string {
  const m = mock();
  const code = randomBytes(24).toString("base64url");
  m.codes.set(code, { ...who, clientId: p.client_id, redirectUri: p.redirect_uri, nonce: p.nonce, challenge: p.code_challenge, exp: Date.now() + 60_000, used: false });
  return code;
}

export function tokenExchange(form: URLSearchParams, authHeader: string | null, origin: string): { status: number; body: Record<string, unknown> } {
  const err = (status: number, error: string, error_description: string) => ({ status, body: { error, error_description } });
  let clientId = form.get("client_id") ?? "";
  let secret = form.get("client_secret") ?? "";
  const basic = authHeader?.match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    const [id, s] = Buffer.from(basic, "base64").toString("utf8").split(":");
    clientId = decodeURIComponent(id ?? "");
    secret = decodeURIComponent(s ?? "");
  }
  if (clientId !== MOCK_IDP.clientId || !safeEqual(secret, MOCK_IDP.clientSecret)) return err(401, "invalid_client", "Client authentication failed");
  if (form.get("grant_type") !== "authorization_code") return err(400, "unsupported_grant_type", "Only authorization_code");
  const m = mock();
  const code = form.get("code") ?? "";
  const rec = m.codes.get(code);
  if (!rec || rec.used || rec.exp < Date.now()) return err(400, "invalid_grant", "Code is invalid, expired or already used");
  rec.used = true;
  if (rec.clientId !== clientId || rec.redirectUri !== form.get("redirect_uri")) return err(400, "invalid_grant", "redirect_uri / client mismatch");
  const verifier = form.get("code_verifier") ?? "";
  if (!verifier || sha256b64url(verifier) !== rec.challenge) return err(400, "invalid_grant", "PKCE verification failed");
  const now = Math.floor(Date.now() / 1000);
  const sub = sha256b64url(`mock-idp:${rec.email}`).slice(0, 24);
  const idToken = signJwt({ iss: issuerFor(origin), sub, aud: clientId, azp: clientId, iat: now, exp: now + 300, auth_time: now, nonce: rec.nonce ?? undefined, email: rec.email, email_verified: rec.emailVerified, name: rec.name, amr: ["pwd", "mfa"] });
  const access = randomBytes(24).toString("base64url");
  m.tokens.set(access, { email: rec.email, name: rec.name, exp: Date.now() + 300_000 });
  return { status: 200, body: { access_token: access, token_type: "Bearer", expires_in: 300, id_token: idToken, scope: "openid email profile" } };
}

export function userinfo(authHeader: string | null): { status: number; body: Record<string, unknown> } {
  const tok = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  const rec = tok ? mock().tokens.get(tok) : undefined;
  if (!rec || rec.exp < Date.now()) return { status: 401, body: { error: "invalid_token" } };
  return { status: 200, body: { sub: sha256b64url(`mock-idp:${rec.email}`).slice(0, 24), email: rec.email, email_verified: true, name: rec.name } };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Example identities for the domains that point at this mock. */
function suggestions(origin: string): { email: string; name: string; org: string }[] {
  const out: { email: string; name: string; org: string }[] = [];
  for (const c of secState().sso.values()) {
    if (!c.issuer.startsWith(issuerFor(origin))) continue;
    for (const d of c.allowedDomains.slice(0, 2)) {
      out.push({ email: `linh.pham@${d}`, name: "Linh Pham", org: c.orgId });
      out.push({ email: `omar.farouk@${d}`, name: "Omar Farouk", org: c.orgId });
    }
  }
  return out.slice(0, 6);
}

export function authorizePage(p: AuthorizeParams, origin: string, error: string | null): string {
  const hidden = Object.entries(p)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`)
    .join("");
  const hint = p.login_hint ?? "";
  const picks = suggestions(origin)
    .map((s) => `<button type="button" class="pick" data-email="${esc(s.email)}" data-name="${esc(s.name)}">${esc(s.email)}</button>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock IdP · Agri-SHIELD dev</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#030712;background-image:linear-gradient(rgba(56,189,248,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,.06) 1px,transparent 1px);background-size:32px 32px;font:15px/1.5 ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif;color:#e2e8f0;padding:16px}
.card{width:100%;max-width:440px;border:1px solid rgba(245,158,11,.45);border-radius:16px;background:rgba(15,23,42,.92);padding:24px;box-shadow:0 0 60px -20px rgba(245,158,11,.5)}
.badge{display:inline-block;font:600 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:#fbbf24;border:1px solid rgba(245,158,11,.5);border-radius:999px;padding:6px 10px}
h1{font-size:20px;margin:14px 0 4px;color:#fff}p{margin:0 0 14px;color:#94a3b8;font-size:13px}label{display:block;font-size:13px;color:#cbd5e1;margin:12px 0 6px}
input[type=email],input[type=text]{width:100%;min-height:44px;border-radius:10px;border:1px solid #334155;background:#020617;color:#f8fafc;padding:0 12px;font-size:15px}
.row{display:flex;gap:8px;margin-top:18px}.btn{flex:1;min-height:46px;border-radius:10px;border:0;font-weight:600;font-size:15px;cursor:pointer}.go{background:#f59e0b;color:#111827}.no{background:transparent;border:1px solid #475569;color:#cbd5e1}
.err{border:1px solid rgba(244,63,94,.5);background:rgba(244,63,94,.1);color:#fecdd3;border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:10px}
.meta{margin-top:16px;font:12px/1.6 ui-monospace,Consolas,monospace;color:#64748b;word-break:break-all}.pick{margin:4px 6px 0 0;border:1px solid #334155;background:#0f172a;color:#7dd3fc;border-radius:999px;padding:5px 10px;font-size:12px;cursor:pointer}
.chk{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;color:#cbd5e1}
</style></head><body><main class="card" role="main">
<span class="badge">⚠ Mock identity provider · dev/demo only</span>
<h1>Sign in to “Demo Corporate IdP”</h1>
<p>This page simulates your company's identity provider (Okta, Entra ID, Google Workspace…). It does not check a password — any e-mail you enter is asserted. Real deployments point SSO at your own IdP.</p>
${error ? `<div class="err">${esc(error)}</div>` : ""}
<form method="post" action="${esc(issuerFor(origin))}/authorize">${hidden}
<label for="email">Work e-mail</label><input id="email" name="email" type="email" required value="${esc(hint)}" autocomplete="off">
<label for="name">Display name</label><input id="name" name="name" type="text" value="${esc(hint ? hint.split("@")[0]!.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "")}">
${picks ? `<div style="margin-top:10px;font-size:12px;color:#94a3b8">Example identities on SSO domains:</div><div>${picks}</div>` : ""}
<label class="chk"><input type="checkbox" name="email_verified" value="true" checked> Assert e-mail as verified</label>
<div class="row"><button class="btn no" name="decision" value="deny">Deny</button><button class="btn go" name="decision" value="allow" autofocus>Sign in &amp; continue</button></div>
</form>
<div class="meta">client_id=${esc(p.client_id)}<br>scope=${esc(p.scope)} · PKCE ${esc(p.code_challenge_method)}<br>issuer=${esc(issuerFor(origin))}</div>
</main><script>document.querySelectorAll('.pick').forEach(function(b){b.addEventListener('click',function(){document.getElementById('email').value=b.dataset.email;document.getElementById('name').value=b.dataset.name;});});</script></body></html>`;
}
