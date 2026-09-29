/**
 * Developer platform: API explorer proxy, per-key usage ledger, sandbox keys
 * and the webhook delivery inspector.
 *
 * Usage metering: the in-app API explorer records every call it proxies
 * (status, latency, endpoint). Direct REST calls are recorded through
 * `onApiKeyAuthorized(req, key)` — a one-line hook for `authorize()` in
 * server/api/v1.ts (owned by the platform module; see the report).
 */
import { openApiDocument } from "../api/openapi";
import { resolveApiKey } from "../api/v1";
import { audit, getStore, type ApiKeyRecord } from "../data/store";
import { scState } from "../data/sc-state";
import { createApiKey } from "./supply-chain";
import { usageDaily } from "./usage";

export const EXPLORER_HEADER = "x-agrishield-explorer";
export const SANDBOX_TTL_DAYS = 30;
export const SANDBOX_SCOPES = ["risk:read", "commodities:read", "network:read"];

export interface ApiCallRecord {
  id: string;
  at: Date;
  orgId: string;
  keyId: string | null;
  method: string;
  path: string;
  status: number | null;
  ms: number | null;
  source: "explorer" | "api";
}

interface DevState {
  calls: ApiCallRecord[];
  /** orgId → keyId|"anonymous" → day → counters */
  daily: Map<string, Map<string, Map<string, { calls: number; errors: number; totalMs: number; timed: number }>>>;
  sandbox: Map<string, { orgId: string; expiresAt: Date; createdBy: string }>;
  seq: number;
}

const g = globalThis as unknown as { __agriDevPlatform?: DevState };
export function devState(): DevState {
  return (g.__agriDevPlatform ??= { calls: [], daily: new Map(), sandbox: new Map(), seq: 0 });
}
export function __resetDevState() {
  g.__agriDevPlatform = undefined;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function recordApiCall(r: Omit<ApiCallRecord, "id">) {
  const st = devState();
  st.seq += 1;
  st.calls.unshift({ ...r, id: `call_${st.seq.toString(36)}` });
  if (st.calls.length > 5000) st.calls.length = 5000;
  let byKey = st.daily.get(r.orgId);
  if (!byKey) st.daily.set(r.orgId, (byKey = new Map()));
  const k = r.keyId ?? "anonymous";
  let byDay = byKey.get(k);
  if (!byDay) byKey.set(k, (byDay = new Map()));
  const d = dayKey(r.at);
  const row = byDay.get(d) ?? { calls: 0, errors: 0, totalMs: 0, timed: 0 };
  row.calls += 1;
  if (r.status === null || r.status >= 400) row.errors += 1;
  if (r.ms !== null) {
    row.totalMs += r.ms;
    row.timed += 1;
  }
  byDay.set(d, row);
}

/**
 * Hook for server/api/v1.ts `authorize()` — call right after a key was
 * accepted:  `onApiKeyAuthorized(req, key);`
 * Explorer-proxied calls carry EXPLORER_HEADER and are recorded by the proxy
 * with status/latency instead, so they are not double counted.
 */
export function onApiKeyAuthorized(req: Request, key: Pick<ApiKeyRecord, "id" | "orgId">) {
  try {
    if (req.headers.get(EXPLORER_HEADER)) return;
    recordApiCall({ at: new Date(), orgId: key.orgId, keyId: key.id, method: req.method, path: new URL(req.url).pathname, status: null, ms: null, source: "api" });
  } catch {
    /* metering must never break the API */
  }
}

// ─── Sandbox keys ────────────────────────────────────────────────────────

export function sweepSandboxKeys(now = new Date()): number {
  const st = devState();
  const s = getStore();
  let n = 0;
  for (const [id, meta] of st.sandbox) {
    if (meta.expiresAt.getTime() > now.getTime()) continue;
    s.apiKeys = s.apiKeys.filter((k) => k.id !== id);
    scState().keyHashes.delete(id);
    st.sandbox.delete(id);
    n++;
  }
  return n;
}

export function createSandboxKey(orgId: string, name: string, by: { id: string; name: string }, now = new Date()) {
  const { record, key } = createApiKey(orgId, `Sandbox · ${name}`, SANDBOX_SCOPES, "test", by);
  const expiresAt = new Date(now.getTime() + SANDBOX_TTL_DAYS * 86_400_000);
  devState().sandbox.set(record.id, { orgId, expiresAt, createdBy: by.id });
  audit({ userId: by.id, userName: by.name, action: "apikey.sandbox.create", entity: "api_key", entityId: record.id, details: `${name} · read-only · expires ${expiresAt.toISOString().slice(0, 10)}` });
  return { record, key, expiresAt };
}

export function revokeKey(orgId: string, id: string, by: { id: string; name: string }): boolean {
  const s = getStore();
  const k = s.apiKeys.find((x) => x.id === id && x.orgId === orgId);
  if (!k) return false;
  s.apiKeys = s.apiKeys.filter((x) => x.id !== id);
  scState().keyHashes.delete(id);
  devState().sandbox.delete(id);
  audit({ userId: by.id, userName: by.name, action: "apikey.revoke", entity: "api_key", entityId: id, details: k.name });
  return true;
}

export function keysFor(orgId: string, now = new Date()) {
  sweepSandboxKeys(now);
  const st = devState();
  const since = new Date(now.getTime() - 7 * 86_400_000);
  return getStore()
    .apiKeys.filter((k) => k.orgId === orgId)
    .map((k) => {
      const sb = st.sandbox.get(k.id);
      const calls7d = st.calls.filter((c) => c.keyId === k.id && c.at >= since).length;
      return { id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdAt: k.createdAt, lastUsed: k.lastUsed, sandbox: !!sb || k.prefix.startsWith("ags_test_"), expiresAt: sb?.expiresAt ?? null, ageDays: Math.floor((now.getTime() - new Date(k.createdAt).getTime()) / 86_400_000), calls7d, usable: scState().keyHashes.has(k.id) };
    });
}

// ─── Usage analytics ─────────────────────────────────────────────────────

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

export function usageFor(orgId: string, days = 14, now = new Date()) {
  const st = devState();
  const dayList = Array.from({ length: days }, (_, i) => dayKey(new Date(now.getTime() - (days - 1 - i) * 86_400_000)));
  const keys = getStore().apiKeys.filter((k) => k.orgId === orgId);
  const byKey = st.daily.get(orgId) ?? new Map();
  const since = new Date(now.getTime() - days * 86_400_000);
  const calls = st.calls.filter((c) => c.orgId === orgId && c.at >= since);
  const series = [...new Set([...keys.map((k) => k.id), ...byKey.keys()])].map((keyId) => {
    const k = keys.find((x) => x.id === keyId);
    const rows = byKey.get(keyId);
    const points = dayList.map((d) => ({ date: d, calls: rows?.get(d)?.calls ?? 0, errors: rows?.get(d)?.errors ?? 0 }));
    const lat = calls.filter((c) => (c.keyId ?? "anonymous") === keyId && c.ms !== null).map((c) => c.ms!);
    return { keyId, name: k?.name ?? (keyId === "anonymous" ? "No key (anonymous)" : "Revoked key"), prefix: k?.prefix ?? null, revoked: !k && keyId !== "anonymous", points, total: points.reduce((a, p) => a + p.calls, 0), errors: points.reduce((a, p) => a + p.errors, 0), p50: pct(lat, 50), p95: pct(lat, 95) };
  });
  const endpoints = new Map<string, { path: string; method: string; calls: number; errors: number; ms: number[] }>();
  for (const c of calls) {
    const e = endpoints.get(`${c.method} ${c.path}`) ?? { path: c.path, method: c.method, calls: 0, errors: 0, ms: [] };
    e.calls++;
    if (c.status === null || c.status >= 400) e.errors++;
    if (c.ms !== null) e.ms.push(c.ms);
    endpoints.set(`${c.method} ${c.path}`, e);
  }
  const statuses = new Map<string, number>();
  for (const c of calls) {
    const cls = c.status === null ? "unknown" : `${Math.floor(c.status / 100)}xx`;
    statuses.set(cls, (statuses.get(cls) ?? 0) + 1);
  }
  const org = usageDaily(orgId).filter((r) => dayList.includes(r.date));
  return {
    days: dayList,
    keys: series.sort((a, b) => b.total - a.total),
    endpoints: [...endpoints.values()].map((e) => ({ path: e.path, method: e.method, calls: e.calls, errors: e.errors, p50: pct(e.ms, 50), p95: pct(e.ms, 95) })).sort((a, b) => b.calls - a.calls),
    statuses: [...statuses.entries()].map(([cls, n]) => ({ cls, n })),
    recent: calls.slice(0, 40).map((c) => ({ ...c, keyName: keys.find((k) => k.id === c.keyId)?.name ?? null })),
    orgApiCalls: dayList.map((d) => ({ date: d, apiCalls: org.find((r) => r.date === d)?.apiCalls ?? 0 })),
    totals: { calls: calls.length, errors: calls.filter((c) => c.status === null || c.status >= 400).length, p95: pct(calls.filter((c) => c.ms !== null).map((c) => c.ms!), 95) },
  };
}

// ─── API explorer ────────────────────────────────────────────────────────

export interface ExplorerParam {
  name: string;
  in: "query" | "path" | "header";
  required: boolean;
  type: string;
  enum: string[] | null;
  default: unknown;
  example: unknown;
  description: string | null;
  minimum: number | null;
  maximum: number | null;
}

export interface ExplorerOperation {
  id: string;
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  tag: string;
  params: ExplorerParam[];
  bodySchema: unknown | null;
  auth: string[];
  /** true when the spec lists an empty security requirement (anonymous calls allowed) */
  authOptional: boolean;
  scope: string | null;
  callable: boolean;
  notCallableReason: string | null;
  responses: { status: string; description: string }[];
}

/** Endpoints that must never be fired from the explorer (they act on the world or need server secrets). */
const NOT_CALLABLE: Record<string, string> = {
  smsInbound: "Twilio calls this webhook with a signed request — test it with your Twilio console.",
  inboundAlert: "Broadcasts real alerts to farmers and needs an HMAC signature — use the signed curl example instead.",
  runJob: "Requires the deployment's CRON_SECRET; background jobs are triggered by the scheduler.",
};

/** Safer defaults for the explorer form (keeps upstream quotas intact). */
const EXPLORER_DEFAULTS: Record<string, Record<string, unknown>> = { getHealth: { deep: "0" } };

type OApiParam = { name: string; in: string; required?: boolean; description?: string; example?: unknown; schema?: { type?: string | string[]; enum?: unknown[]; default?: unknown; minimum?: number; maximum?: number } };
type OApiOp = { operationId: string; summary?: string; description?: string; tags?: string[]; parameters?: OApiParam[]; requestBody?: { content?: Record<string, { schema?: unknown }> }; security?: Record<string, unknown>[]; responses?: Record<string, { description?: string }> };

export function explorerOperations(origin: string): ExplorerOperation[] {
  const doc = openApiDocument(origin) as unknown as { paths: Record<string, Record<string, OApiOp>> };
  const ops: ExplorerOperation[] = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [m, op] of Object.entries(methods)) {
      const method = m.toUpperCase() as "GET" | "POST";
      const auth = [...new Set((op.security ?? []).flatMap((s) => Object.keys(s)))];
      const scope = /scope `([a-z:]+)`/.exec(op.description ?? "")?.[1] ?? null;
      const defaults = EXPLORER_DEFAULTS[op.operationId] ?? {};
      ops.push({
        id: op.operationId,
        method,
        path,
        summary: op.summary ?? op.operationId,
        description: op.description ?? "",
        tag: op.tags?.[0] ?? "Other",
        params: (op.parameters ?? []).map((p) => ({
          name: p.name,
          in: p.in as ExplorerParam["in"],
          required: !!p.required,
          type: Array.isArray(p.schema?.type) ? p.schema!.type[0]! : (p.schema?.type ?? "string"),
          enum: p.schema?.enum ? p.schema.enum.map(String) : null,
          default: p.name in defaults ? defaults[p.name] : (p.schema?.default ?? null),
          example: p.example ?? null,
          description: p.description ?? null,
          minimum: p.schema?.minimum ?? null,
          maximum: p.schema?.maximum ?? null,
        })),
        bodySchema: op.requestBody?.content ? (Object.values(op.requestBody.content)[0]?.schema ?? null) : null,
        auth,
        authOptional: !op.security || op.security.length === 0 || op.security.some((s) => Object.keys(s).length === 0),
        scope,
        callable: !NOT_CALLABLE[op.operationId],
        notCallableReason: NOT_CALLABLE[op.operationId] ?? null,
        responses: Object.entries(op.responses ?? {}).map(([status, r]) => ({ status, description: r.description ?? "" })),
      });
    }
  }
  return ops;
}

export function buildRequestUrl(origin: string, op: ExplorerOperation, values: Record<string, string>): string {
  let path = op.path;
  const q = new URLSearchParams();
  for (const p of op.params) {
    const v = values[p.name];
    if (v === undefined || v === "") {
      if (p.required) throw new Error(`${p.name} is required`);
      continue;
    }
    if (p.enum && !p.enum.includes(v)) throw new Error(`${p.name} must be one of ${p.enum.join(", ")}`);
    if (p.type === "number" || p.type === "integer") {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${p.name} must be a number`);
      if (p.minimum !== null && n < p.minimum) throw new Error(`${p.name} must be ≥ ${p.minimum}`);
      if (p.maximum !== null && n > p.maximum) throw new Error(`${p.name} must be ≤ ${p.maximum}`);
    }
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(v));
    else if (p.in === "query") q.set(p.name, v);
  }
  const qs = q.toString();
  return `${origin}${path}${qs ? `?${qs}` : ""}`;
}

export function curlFor(url: string, method: string, apiKey: string | null, masked = true): string {
  const key = apiKey ? (masked ? `${apiKey.slice(0, 13)}…` : apiKey) : null;
  return [`curl -sS${method !== "GET" ? ` -X ${method}` : ""} "${url}"`, key ? `  -H "X-API-Key: ${key}"` : null, `  -H "Accept: application/json"`].filter(Boolean).join(" \\\n");
}

export interface ExplorerResult {
  ok: boolean;
  status: number | null;
  statusText: string;
  ms: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  contentType: string | null;
  error: string | null;
  curl: string;
  keyId: string | null;
}

export async function explorerSend(p: { origin: string; orgId: string; operationId: string; values: Record<string, string>; apiKey: string | null; ip: string }): Promise<ExplorerResult> {
  const op = explorerOperations(p.origin).find((o) => o.id === p.operationId);
  if (!op) throw new Error("Unknown operation");
  if (!op.callable) throw new Error(op.notCallableReason ?? "This endpoint can't be called from the explorer");
  const url = buildRequestUrl(p.origin, op, p.values);
  let keyId: string | null = null;
  if (p.apiKey) {
    const r = resolveApiKey(p.apiKey);
    if (r.key && r.key.orgId !== p.orgId) throw new Error("That API key belongs to another workspace");
    keyId = r.key?.id ?? null;
  }
  const started = Date.now();
  const headers: Record<string, string> = { accept: "application/json", [EXPLORER_HEADER]: "1", "user-agent": "Agri-SHIELD-API-Explorer/1.0", "x-forwarded-for": p.ip === "local" ? "127.0.0.1" : p.ip };
  if (p.apiKey) headers["x-api-key"] = p.apiKey;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  let res: Response | null = null;
  let error: string | null = null;
  let text = "";
  try {
    res = await fetch(url, { method: op.method, headers, signal: ctrl.signal, cache: "no-store", redirect: "manual" });
    text = await res.text();
  } catch (e) {
    error = (e as Error).name === "AbortError" ? "Timed out after 25 s" : (e as Error).message;
  } finally {
    clearTimeout(timer);
  }
  const ms = Date.now() - started;
  recordApiCall({ at: new Date(), orgId: p.orgId, keyId, method: op.method, path: new URL(url).pathname, status: res?.status ?? null, ms, source: "explorer" });
  const keep = ["content-type", "x-request-id", "cache-control", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining"];
  const outHeaders: Record<string, string> = {};
  res?.headers.forEach((v, k) => {
    if (keep.includes(k.toLowerCase())) outHeaders[k] = v;
  });
  const LIMIT = 200_000;
  return {
    ok: !!res && res.ok,
    status: res?.status ?? null,
    statusText: res?.statusText ?? "",
    ms,
    url,
    method: op.method,
    headers: outHeaders,
    body: text.slice(0, LIMIT),
    truncated: text.length > LIMIT,
    contentType: res?.headers.get("content-type") ?? null,
    error,
    curl: curlFor(url, op.method, p.apiKey),
    keyId,
  };
}

// ─── Webhook delivery inspector ──────────────────────────────────────────

export function deliveriesFor(orgId: string, opts: { webhookId?: string | null; onlyFailed?: boolean; limit?: number } = {}) {
  const sc = scState();
  const hooks = getStore().webhooks.filter((w) => w.orgId === orgId);
  const rows = sc.deliveries.filter((d) => d.orgId === orgId && (!opts.webhookId || d.webhookId === opts.webhookId) && (!opts.onlyFailed || !d.ok));
  const all = sc.deliveries.filter((d) => d.orgId === orgId);
  return {
    webhooks: hooks.map((w) => {
      const ds = all.filter((d) => d.webhookId === w.id);
      return { id: w.id, name: sc.webhookNames.get(w.id) ?? safeHost(w.url), url: w.url, events: w.events, active: w.active, deliveries: ds.length, failures: ds.filter((d) => !d.ok).length, lastDelivery: w.lastDelivery };
    }),
    deliveries: rows.slice(0, opts.limit ?? 60).map((d) => ({ ...d, webhookName: sc.webhookNames.get(d.webhookId) ?? safeHost(d.url) })),
    stats: { total: all.length, ok: all.filter((d) => d.ok).length, failed: all.filter((d) => !d.ok).length, p95: pct(all.filter((d) => d.latencyMs !== null).map((d) => d.latencyMs!), 95) },
  };
}

function safeHost(u: string) {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}

/**
 * Origin the explorer proxy may call. Never trust an arbitrary Host header
 * (SSRF): only loopback or the configured public app URL are accepted.
 */
export function trustedOrigin(requestUrl: string | undefined): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? null;
  try {
    const u = new URL(requestUrl ?? "");
    if (["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return u.origin;
    if (configured && new URL(configured).host === u.host) return new URL(configured).origin;
  } catch {
    /* fall through */
  }
  if (configured) return new URL(configured).origin;
  throw new Error("Set NEXT_PUBLIC_APP_URL to use the API explorer on this host");
}
