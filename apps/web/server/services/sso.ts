/**
 * Workspace single sign-on (OpenID Connect, authorization-code flow + PKCE).
 *
 *   sign-in page → /api/sso/start?email=… (domain discovery)
 *     → IdP /authorize (state, nonce, S256 code challenge)
 *     → /api/sso/callback?code&state → token endpoint (client auth + code_verifier)
 *     → ID token verified against the IdP JWKS (signature, iss, aud, exp, nonce)
 *     → allowed e-mail domain + JIT provisioning → one-time assertion cookie
 *     → /auth/sso completes the NextAuth sign-in (Credentials "sso" mode)
 *
 * The transaction (state, nonce, PKCE verifier) never leaves the server
 * unsigned: it rides in an HMAC-signed, httpOnly, 10-minute cookie.
 */
import type { UserRole } from "@agri-shield/types";
import { audit, getStore, nextId, type OrgRecord, type UserRecord } from "../data/store";
import { rolesForOrg } from "./workspace-state";
import { notifyWorkspace } from "./workspace-notifications";
import { randomId, seal, signToken, unseal, verifyToken } from "../auth/crypto";
import { secState, type SsoConfig } from "../auth/security-state";
import { OidcError, assertSafeIssuer, discover, exchangeCode, getJwks, normalizeIssuer, pkcePair, verifyIdTokenRemote, type IdTokenClaims } from "../auth/oidc";
import { issueAssertion } from "../auth/challenge";

export const SSO_TX_COOKIE = "ags_sso_tx";
export const SSO_TX_TTL_SEC = 10 * 60;

/** Consumer mailbox providers can never be claimed as a workspace SSO domain. */
const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "yandex.com", "mail.com", "zoho.com", "qq.com", "163.com", "demo.agrishield.io"]);

export const MOCK_IDP = {
  path: "/api/dev/mock-idp",
  clientId: "agrishield-demo",
  clientSecret: "mock-idp-demo-secret",
};

export const mockIdpEnabled = () => process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEMO_MODE !== "false" || process.env.ENABLE_MOCK_IDP === "true";

export const domainOf = (email: string) => email.trim().toLowerCase().split("@")[1] ?? "";

export function validateDomain(d: string): string | null {
  const v = d.trim().toLowerCase().replace(/^@/, "");
  if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v)) return null;
  return v;
}

export interface SsoConfigView {
  enabled: boolean;
  configured: boolean;
  protocol: "oidc";
  issuer: string;
  clientId: string;
  hasClientSecret: boolean;
  allowedDomains: string[];
  defaultRole: UserRole;
  jitProvisioning: boolean;
  enforceForDomains: boolean;
  updatedAt: Date | null;
  lastLoginAt: Date | null;
  lastError: string | null;
  logins: number;
  isMockIdp: boolean;
}

export function ssoView(orgId: string, origin?: string): SsoConfigView {
  const c = secState().sso.get(orgId);
  const org = getStore().orgs.find((o) => o.id === orgId);
  const defaultRole = (org ? rolesForOrg(org).find((r) => !r.admin)?.role : undefined) ?? "enterprise_analyst";
  if (!c) return { enabled: false, configured: false, protocol: "oidc", issuer: "", clientId: "", hasClientSecret: false, allowedDomains: [], defaultRole, jitProvisioning: true, enforceForDomains: false, updatedAt: null, lastLoginAt: null, lastError: null, logins: 0, isMockIdp: false };
  return {
    enabled: c.enabled,
    configured: true,
    protocol: "oidc",
    issuer: c.issuer,
    clientId: c.clientId,
    hasClientSecret: !!c.clientSecretSealed,
    allowedDomains: c.allowedDomains,
    defaultRole: c.defaultRole,
    jitProvisioning: c.jitProvisioning,
    enforceForDomains: c.enforceForDomains,
    updatedAt: c.updatedAt,
    lastLoginAt: c.lastLoginAt,
    lastError: c.lastError,
    logins: c.logins,
    isMockIdp: c.issuer.endsWith(MOCK_IDP.path) && (!origin || c.issuer.startsWith(origin)),
  };
}

export interface SsoConfigInput {
  enabled: boolean;
  issuer: string;
  clientId: string;
  /** empty/undefined keeps the stored secret */
  clientSecret?: string | null;
  allowedDomains: string[];
  defaultRole: UserRole;
  jitProvisioning: boolean;
  enforceForDomains: boolean;
}

export function saveSsoConfig(org: OrgRecord, input: SsoConfigInput, by: { id: string; name: string }): SsoConfigView {
  assertSafeIssuer(input.issuer);
  const domains = [...new Set(input.allowedDomains.map((d) => validateDomain(d)))];
  if (domains.some((d) => !d)) throw new OidcError("bad_domain", "One of the e-mail domains is not a valid domain name");
  const clean = domains as string[];
  if (input.enabled && clean.length === 0) throw new OidcError("bad_domain", "Add at least one e-mail domain your IdP signs in (e.g. yourbank.com)");
  const publicHit = clean.find((d) => PUBLIC_DOMAINS.has(d));
  if (publicHit) throw new OidcError("bad_domain", `${publicHit} is a shared mailbox provider and cannot be claimed for SSO`);
  for (const [orgId, other] of secState().sso) {
    if (orgId === org.id) continue;
    const clash = clean.find((d) => other.allowedDomains.includes(d));
    if (clash) throw new OidcError("bad_domain", `${clash} is already claimed by another workspace`);
  }
  if (!rolesForOrg(org).some((r) => r.role === input.defaultRole)) throw new OidcError("bad_role", "Default role is not valid for this workspace");
  if (!input.clientId.trim()) throw new OidcError("bad_client", "Client ID is required");
  const prev = secState().sso.get(org.id);
  const secret = input.clientSecret?.trim() ? seal(input.clientSecret.trim(), "oidc-client") : (prev?.clientSecretSealed ?? null);
  const rec: SsoConfig = {
    orgId: org.id,
    enabled: input.enabled,
    protocol: "oidc",
    issuer: normalizeIssuer(input.issuer),
    clientId: input.clientId.trim(),
    clientSecretSealed: secret,
    allowedDomains: clean,
    defaultRole: input.defaultRole,
    jitProvisioning: input.jitProvisioning,
    enforceForDomains: input.enforceForDomains,
    updatedAt: new Date(),
    updatedBy: by.id,
    lastLoginAt: prev?.lastLoginAt ?? null,
    lastError: prev?.lastError ?? null,
    logins: prev?.logins ?? 0,
  };
  secState().sso.set(org.id, rec);
  audit({ userId: by.id, userName: by.name, action: "security.sso.update", entity: "organization", entityId: org.id, details: `OIDC ${rec.enabled ? "enabled" : "disabled"} · ${rec.issuer} · domains ${clean.join(", ") || "—"} · JIT ${rec.jitProvisioning ? "on" : "off"}` });
  return ssoView(org.id);
}

/** Probe discovery + JWKS so admins see a clear result before enabling. */
export async function testSsoConfig(orgId: string): Promise<{ ok: boolean; checks: { label: string; ok: boolean; detail: string }[] }> {
  const c = secState().sso.get(orgId);
  if (!c) return { ok: false, checks: [{ label: "Configuration", ok: false, detail: "Save a configuration first" }] };
  const checks: { label: string; ok: boolean; detail: string }[] = [];
  try {
    const d = await discover(c.issuer, true);
    checks.push({ label: "Discovery document", ok: true, detail: `${c.issuer}/.well-known/openid-configuration` });
    const pkce = !d.code_challenge_methods_supported || d.code_challenge_methods_supported.includes("S256");
    checks.push({ label: "PKCE (S256)", ok: pkce, detail: pkce ? "Supported" : "IdP does not advertise S256" });
    const jwks = await getJwks(d.jwks_uri, true);
    const sig = jwks.keys.filter((k) => !k.use || k.use === "sig");
    checks.push({ label: "Signing keys (JWKS)", ok: sig.length > 0, detail: `${sig.length} key(s): ${sig.map((k) => `${k.kty}${k.alg ? `/${k.alg}` : ""}${k.kid ? ` kid=${k.kid.slice(0, 10)}` : ""}`).join(", ")}` });
    checks.push({ label: "Client secret", ok: !!c.clientSecretSealed, detail: c.clientSecretSealed ? "Stored encrypted (AES-256-GCM)" : "Missing — public clients must still use PKCE" });
  } catch (e) {
    checks.push({ label: "Discovery", ok: false, detail: (e as Error).message });
  }
  const ok = checks.every((x) => x.ok);
  c.lastError = ok ? null : (checks.find((x) => !x.ok)?.detail ?? null);
  return { ok, checks };
}

export function orgForEmail(email: string): { org: OrgRecord; config: SsoConfig } | null {
  const d = domainOf(email);
  if (!d) return null;
  for (const c of secState().sso.values()) {
    if (c.enabled && c.allowedDomains.includes(d)) {
      const org = getStore().orgs.find((o) => o.id === c.orgId);
      if (org) return { org, config: c };
    }
  }
  return null;
}

/** Password/OTP sign-in is refused for addresses on a domain whose workspace enforces SSO. */
export function ssoEnforcedFor(email: string | null | undefined): boolean {
  if (!email) return false;
  const hit = orgForEmail(email);
  return !!hit && hit.config.enforceForDomains;
}

// ─── Flow ────────────────────────────────────────────────────────────────

interface TxPayload {
  [k: string]: unknown;
  state: string;
  nonce: string;
  verifier: string;
  orgId: string;
  cb: string | null;
  redirectUri: string;
}

export async function startSso(p: { email?: string | null; orgId?: string | null; origin: string; callbackUrl?: string | null }): Promise<{ url: string; txCookie: string }> {
  const hit = p.email ? orgForEmail(p.email) : p.orgId ? (() => {
    const c = secState().sso.get(p.orgId!);
    const org = getStore().orgs.find((o) => o.id === p.orgId);
    return c && c.enabled && org ? { org, config: c } : null;
  })() : null;
  if (!hit) throw new OidcError("no_sso", "No workspace has single sign-on set up for that e-mail domain");
  const disc = await discover(hit.config.issuer);
  const { verifier, challenge } = pkcePair();
  const state = randomId("st", 18);
  const nonce = randomId("nc", 18);
  const redirectUri = `${p.origin}/api/sso/callback`;
  const cb = p.callbackUrl && p.callbackUrl.startsWith("/") && !p.callbackUrl.startsWith("//") ? p.callbackUrl : null;
  const tx = signToken("sso-tx", { state, nonce, verifier, orgId: hit.org.id, cb, redirectUri } satisfies TxPayload, SSO_TX_TTL_SEC);
  const u = new URL(disc.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", hit.config.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (p.email) u.searchParams.set("login_hint", p.email.trim().toLowerCase());
  return { url: u.toString(), txCookie: tx };
}

export type SsoResult = { ok: true; assertion: string; callbackUrl: string | null; user: UserRecord; provisioned: boolean } | { ok: false; code: string; message: string };

export async function completeSso(p: { code: string | null; state: string | null; error?: string | null; txToken: string | null; ip: string; userAgent: string }): Promise<SsoResult> {
  const tx = verifyToken<TxPayload>("sso-tx", p.txToken);
  if (!tx) return { ok: false, code: "sso_expired", message: "The sign-in attempt expired. Start again." };
  const config = secState().sso.get(tx.orgId);
  const fail = (code: string, message: string): SsoResult => {
    if (config) config.lastError = `${new Date().toISOString().slice(0, 16)} · ${message}`;
    return { ok: false, code, message };
  };
  if (p.error) return fail("idp_error", `The identity provider returned: ${p.error}`);
  if (!p.state || p.state !== tx.state) return fail("bad_state", "State mismatch — the response did not come from this sign-in attempt");
  if (!p.code) return fail("no_code", "The identity provider did not return an authorization code");
  if (!config || !config.enabled) return fail("sso_disabled", "Single sign-on is not enabled for this workspace");
  const org = getStore().orgs.find((o) => o.id === tx.orgId);
  if (!org) return fail("no_org", "Workspace not found");

  let claims: IdTokenClaims;
  try {
    const disc = await discover(config.issuer);
    const tokens = await exchangeCode(disc, { code: p.code, redirectUri: tx.redirectUri, clientId: config.clientId, clientSecret: config.clientSecretSealed ? unseal(config.clientSecretSealed, "oidc-client") : null, codeVerifier: tx.verifier });
    claims = await verifyIdTokenRemote(tokens.id_token, disc, { clientId: config.clientId, nonce: tx.nonce });
  } catch (e) {
    return fail(e instanceof OidcError ? e.code : "sso_error", (e as Error).message);
  }

  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const verified = claims.email_verified === true || claims.email_verified === "true";
  if (!email || !verified) return fail("email_unverified", "The identity provider did not assert a verified e-mail address");
  if (!config.allowedDomains.includes(domainOf(email))) return fail("domain_not_allowed", `${domainOf(email)} is not an allowed domain for ${org.name}`);

  const store = getStore();
  let user = store.users.find((u) => u.email?.toLowerCase() === email);
  let provisioned = false;
  if (user) {
    if (user.orgId !== org.id) return fail("wrong_workspace", "This e-mail belongs to a different account — ask your admin");
    if (user.status === "suspended") return fail("suspended", "This account is suspended");
  } else {
    if (!config.jitProvisioning) return fail("no_account", `No ${org.name} account exists for ${email} and just-in-time provisioning is off`);
    const name = (typeof claims.name === "string" && claims.name.trim()) || [claims.given_name, claims.family_name].filter(Boolean).join(" ") || email.split("@")[0]!;
    user = {
      id: nextId("user"),
      email,
      phone: null,
      name: String(name).slice(0, 80),
      role: config.defaultRole,
      language: "en",
      orgId: org.id,
      subscriptionTier: org.planTier,
      status: "active",
      createdAt: new Date(),
      lastActive: new Date(),
      title: "Provisioned via SSO",
    };
    store.users.push(user);
    provisioned = true;
    audit({ userId: user.id, userName: user.name, action: "user.jit_provision", entity: "user", entityId: user.id, details: `Created by SSO (${config.issuer}) as ${config.defaultRole}` });
    notifyWorkspace({ workspaceId: org.id, userId: null, kind: "team", title: `${user.name} joined via SSO`, body: `${email} was provisioned just-in-time from your identity provider with the default role.`, href: "/app/settings/team", severity: "info" });
  }
  config.lastLoginAt = new Date();
  config.lastError = null;
  config.logins += 1;
  const assertion = issueAssertion({ userId: user.id, orgId: org.id, ip: p.ip, userAgent: p.userAgent });
  return { ok: true, assertion, callbackUrl: tx.cb, user, provisioned };
}
