/**
 * OpenID Connect relying-party primitives on node:crypto (no dependencies):
 *  - discovery (/.well-known/openid-configuration) with issuer check
 *  - JWKS fetch with caching and one forced refresh on an unknown `kid`
 *  - ID-token (JWS) verification: RS256/384/512, PS256/384/512, ES256/384/512
 *    signatures; iss / aud / azp / exp / nbf / iat / nonce claim checks
 *  - PKCE (RFC 7636, S256)
 * "none" and HMAC algorithms are refused (an attacker could otherwise sign
 * with the public key or skip the signature).
 */
import { createPublicKey, randomBytes, verify as cryptoVerify, constants, type JsonWebKey as NodeJwk, type KeyObject } from "node:crypto";
import { fromB64url, sha256b64url } from "./crypto";

export interface Jwk {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}
export interface Jwks {
  keys: Jwk[];
}

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  id_token_signing_alg_values_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nbf?: number;
  nonce?: string;
  azp?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
  family_name?: string;
  amr?: string[];
  [k: string]: unknown;
}

export class OidcError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

const ALGS: Record<string, { hash: string; kty: "RSA" | "EC"; pss?: boolean; ecSize?: number }> = {
  RS256: { hash: "sha256", kty: "RSA" },
  RS384: { hash: "sha384", kty: "RSA" },
  RS512: { hash: "sha512", kty: "RSA" },
  PS256: { hash: "sha256", kty: "RSA", pss: true },
  PS384: { hash: "sha384", kty: "RSA", pss: true },
  PS512: { hash: "sha512", kty: "RSA", pss: true },
  ES256: { hash: "sha256", kty: "EC", ecSize: 32 },
  ES384: { hash: "sha384", kty: "EC", ecSize: 48 },
  ES512: { hash: "sha512", kty: "EC", ecSize: 66 },
};

export const SUPPORTED_ALGS = Object.keys(ALGS);

export function decodeJwt(token: string): { header: { alg: string; kid?: string; typ?: string }; payload: IdTokenClaims; signingInput: string; signature: Buffer } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new OidcError("malformed", "ID token is not a compact JWS");
  try {
    const header = JSON.parse(fromB64url(parts[0]!).toString("utf8"));
    const payload = JSON.parse(fromB64url(parts[1]!).toString("utf8"));
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: fromB64url(parts[2]!) };
  } catch {
    throw new OidcError("malformed", "ID token header or payload is not valid JSON");
  }
}

export function jwkToKey(jwk: Jwk): KeyObject {
  return createPublicKey({ key: jwk as unknown as NodeJwk, format: "jwk" });
}

export function verifyJwsSignature(token: string, jwks: Jwks): { header: { alg: string; kid?: string }; payload: IdTokenClaims; kid: string | null } {
  const { header, payload, signingInput, signature } = decodeJwt(token);
  const spec = ALGS[header.alg];
  if (!spec) throw new OidcError("alg_not_allowed", `Signing algorithm ${header.alg ?? "none"} is not allowed`);
  const candidates = jwks.keys.filter((k) => k.kty === spec.kty && (!k.use || k.use === "sig") && (!k.alg || k.alg === header.alg) && (!header.kid || k.kid === header.kid));
  if (candidates.length === 0) throw new OidcError("unknown_kid", `No JWKS key matches kid ${header.kid ?? "(none)"}`);
  for (const jwk of candidates) {
    let key: KeyObject;
    try {
      key = jwkToKey(jwk);
    } catch {
      continue;
    }
    const ok = cryptoVerify(
      spec.hash,
      Buffer.from(signingInput),
      spec.kty === "EC" ? { key, dsaEncoding: "ieee-p1363" } : spec.pss ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST } : key,
      signature
    );
    if (ok) return { header, payload, kid: jwk.kid ?? null };
  }
  throw new OidcError("bad_signature", "ID token signature does not verify against the provider's JWKS");
}

/** Full ID-token validation (OIDC Core §3.1.3.7). */
export function validateIdToken(token: string, jwks: Jwks, expect: { issuer: string; clientId: string; nonce?: string | null; now?: number; skewSec?: number; maxAgeSec?: number }): IdTokenClaims {
  const { payload: c } = verifyJwsSignature(token, jwks);
  const now = Math.floor((expect.now ?? Date.now()) / 1000);
  const skew = expect.skewSec ?? 60;
  if (normalizeIssuer(c.iss) !== normalizeIssuer(expect.issuer)) throw new OidcError("bad_iss", `Issuer mismatch (got ${c.iss})`);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(expect.clientId)) throw new OidcError("bad_aud", "ID token was not issued for this client");
  if (aud.length > 1 && c.azp && c.azp !== expect.clientId) throw new OidcError("bad_azp", "Authorized party mismatch");
  if (typeof c.exp !== "number" || c.exp + skew < now) throw new OidcError("expired", "ID token has expired");
  if (typeof c.nbf === "number" && c.nbf - skew > now) throw new OidcError("not_yet_valid", "ID token is not valid yet");
  if (typeof c.iat !== "number" || c.iat - skew > now) throw new OidcError("bad_iat", "ID token issued in the future");
  if (expect.maxAgeSec && now - c.iat > expect.maxAgeSec) throw new OidcError("stale", "ID token is too old");
  if (expect.nonce !== undefined && expect.nonce !== null && c.nonce !== expect.nonce) throw new OidcError("bad_nonce", "Nonce mismatch — possible replay");
  if (!c.sub) throw new OidcError("no_sub", "ID token has no subject");
  return c;
}

export const normalizeIssuer = (iss: string) => iss.trim().replace(/\/+$/, "");

// ─── PKCE ────────────────────────────────────────────────────────────────

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url"); // 64 chars
  return { verifier, challenge: sha256b64url(verifier) };
}

export const pkceChallenge = (verifier: string) => sha256b64url(verifier);

// ─── Discovery & JWKS (network) ──────────────────────────────────────────

const g = globalThis as unknown as { __agriOidcCache?: Map<string, { at: number; value: unknown }> };
const cache = (g.__agriOidcCache ??= new Map());
const TTL = 10 * 60_000;

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store", headers: { accept: "application/json", ...(init?.headers ?? {}) } });
    const text = await res.text();
    if (!res.ok) throw new OidcError("http", `${new URL(url).pathname} → HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof OidcError) throw e;
    throw new OidcError("network", `Could not reach ${new URL(url).host}: ${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
}

export function assertSafeIssuer(issuer: string): URL {
  let u: URL;
  try {
    u = new URL(issuer);
  } catch {
    throw new OidcError("bad_issuer", "Issuer must be an absolute URL");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new OidcError("bad_issuer", "Issuer must use https (http is allowed only for localhost)");
  return u;
}

export async function discover(issuer: string, force = false): Promise<OidcDiscovery> {
  assertSafeIssuer(issuer);
  const key = `disc:${normalizeIssuer(issuer)}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.value as OidcDiscovery;
  const doc = await getJson<OidcDiscovery>(`${normalizeIssuer(issuer)}/.well-known/openid-configuration`);
  if (normalizeIssuer(doc.issuer ?? "") !== normalizeIssuer(issuer)) throw new OidcError("bad_iss", `Discovery issuer ${doc.issuer} does not match ${issuer}`);
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) if (!doc[k]) throw new OidcError("discovery", `Discovery document is missing ${k}`);
  cache.set(key, { at: Date.now(), value: doc });
  return doc;
}

export async function getJwks(uri: string, force = false): Promise<Jwks> {
  const key = `jwks:${uri}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.value as Jwks;
  const jwks = await getJson<Jwks>(uri);
  if (!Array.isArray(jwks.keys)) throw new OidcError("jwks", "JWKS has no keys array");
  cache.set(key, { at: Date.now(), value: jwks });
  return jwks;
}

/** Verify with cached JWKS; on unknown kid refresh once (key rotation). */
export async function verifyIdTokenRemote(token: string, disc: OidcDiscovery, expect: { clientId: string; nonce?: string | null }): Promise<IdTokenClaims> {
  try {
    return validateIdToken(token, await getJwks(disc.jwks_uri), { issuer: disc.issuer, ...expect });
  } catch (e) {
    if (e instanceof OidcError && (e.code === "unknown_kid" || e.code === "bad_signature")) return validateIdToken(token, await getJwks(disc.jwks_uri, true), { issuer: disc.issuer, ...expect });
    throw e;
  }
}

export async function exchangeCode(disc: OidcDiscovery, p: { code: string; redirectUri: string; clientId: string; clientSecret: string | null; codeVerifier: string }): Promise<{ id_token: string; access_token?: string; token_type?: string; expires_in?: number }> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, client_id: p.clientId, code_verifier: p.codeVerifier });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (p.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(p.clientId)}:${encodeURIComponent(p.clientSecret)}`).toString("base64")}`;
  const res = await getJson<{ id_token?: string; error?: string; error_description?: string; access_token?: string }>(disc.token_endpoint, { method: "POST", headers, body: body.toString() });
  if (!res.id_token) throw new OidcError("no_id_token", res.error_description ?? res.error ?? "Token endpoint returned no id_token");
  return res as { id_token: string };
}
