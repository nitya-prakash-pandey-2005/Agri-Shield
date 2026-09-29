/**
 * Web Push (RFC 8030 delivery, RFC 8291 payload encryption, RFC 8292 VAPID).
 *
 * Free and standards-based: no Firebase project or vendor account. The browser
 * hands us a PushSubscription (an endpoint on its own push service: FCM for
 * Chrome/Edge/Android, Mozilla autopush, Apple, WNS) and we POST encrypted,
 * VAPID-signed messages to it. public/sw.js renders them as notifications.
 *
 *   VAPID keys   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (mailto: or https:)
 *                → otherwise generated once and kept in <AGRI_DATA_DIR>/vapid.json
 *                  (default apps/web/.data/) so existing subscriptions survive restarts.
 *   Store        subscriptions keyed by endpoint, indexed by user + org, persisted
 *                best-effort to <AGRI_DATA_DIR>/push-subscriptions.json.
 *   Sending      sendPushToUser / sendPushToOrg: TTL + urgency by severity, 404/410
 *                removes the subscription, every attempt is recorded in the outbox
 *                (channel "app", provider "webpush").
 *   Safety       only known push-service hosts are accepted as endpoints (no SSRF);
 *                under vitest nothing is sent unless AGRI_PUSH_IN_TESTS=true.
 */
import fs from "node:fs";
import path from "node:path";
import webpush, { type RequestOptions, type Urgency } from "web-push";
import { recordOutbox } from "./channels";

// ─── Types ────────────────────────────────────────────────────────────────

export type PushSeverity = "watch" | "warning" | "emergency";

/** Exactly what public/sw.js reads from `event.data.json()`. */
export interface PushPayload {
  title: string;
  body: string;
  severity: PushSeverity;
  tag: string;
  alertId: string | null;
  url: string;
}

export type PushPayloadInput = Pick<PushPayload, "title" | "body"> & Partial<Omit<PushPayload, "title" | "body">>;

export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  orgId: string | null;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime: number | null;
  /** "Chrome on Android" etc. */
  label: string;
  /** push service, e.g. "FCM", "Mozilla", "Apple" */
  service: string;
  userAgent: string | null;
  createdAt: Date;
  lastSuccessAt: Date | null;
  lastError: string | null;
  failures: number;
}

export interface PushSendResult {
  attempted: number;
  sent: number;
  failed: number;
  removed: number;
  skipped?: "disabled" | "no-subscriptions";
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
  source: "env" | "file" | "generated";
}

// ─── State ────────────────────────────────────────────────────────────────

const MAX_PER_USER = 10;
const MAX_FAILURES = 5;
const DEFAULT_SUBJECT = "mailto:alerts@agrishield.io";

interface PushState {
  subs: Map<string, PushSubscriptionRecord>;
  vapid: VapidConfig | null;
  loaded: boolean;
  seq: number;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

const g = globalThis as unknown as { __agriWebPush?: PushState };
const state = (g.__agriWebPush ??= { subs: new Map(), vapid: null, loaded: false, seq: 0, saveTimer: null });

/** Where keys + subscriptions are kept between restarts. */
export function pushDataDir(): string {
  return process.env.AGRI_DATA_DIR?.trim() || path.join(process.cwd(), ".data");
}

/** File persistence is off under vitest unless a test opts in. */
function persistenceEnabled(): boolean {
  if (process.env.AGRI_PUSH_PERSIST === "false") return false;
  return !process.env.VITEST || process.env.AGRI_PUSH_PERSIST === "true";
}

/** Real network sends: off under vitest unless explicitly enabled (tests mock web-push). */
export function pushSendingEnabled(): boolean {
  if (process.env.WEB_PUSH_DISABLED === "true") return false;
  return !process.env.VITEST || process.env.AGRI_PUSH_IN_TESTS === "true";
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(pushDataDir(), file), "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown, mode?: number): boolean {
  try {
    const dir = pushDataDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2), { encoding: "utf8", mode });
    return true;
  } catch {
    return false; // read-only / serverless filesystem: keys stay in memory for this process
  }
}

// ─── VAPID keys ───────────────────────────────────────────────────────────

function validSubject(s: string | undefined): string {
  const v = s?.trim();
  return v && /^(mailto:|https:\/\/)/i.test(v) ? v : DEFAULT_SUBJECT;
}

/** Resolve VAPID keys: env → cached → .data/vapid.json → freshly generated (and saved). */
export function vapidConfig(): VapidConfig {
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = validSubject(process.env.VAPID_SUBJECT);
  if (pub && priv) return { publicKey: pub, privateKey: priv, subject, source: "env" };
  if (state.vapid) return { ...state.vapid, subject };

  const saved = persistenceEnabled() ? readJson<{ publicKey?: string; privateKey?: string }>("vapid.json") : null;
  if (saved?.publicKey && saved.privateKey) {
    state.vapid = { publicKey: saved.publicKey, privateKey: saved.privateKey, subject, source: "file" };
    return state.vapid;
  }
  const keys = webpush.generateVAPIDKeys();
  state.vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject, source: "generated" };
  if (persistenceEnabled()) {
    const ok = writeJson("vapid.json", { publicKey: keys.publicKey, privateKey: keys.privateKey, createdAt: new Date().toISOString() }, 0o600);
    if (!ok) console.warn("[webpush] could not save generated VAPID keys; set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY so subscriptions survive restarts");
  }
  return state.vapid;
}

export function vapidPublicKey(): string {
  return vapidConfig().publicKey;
}

// ─── Subscription store ───────────────────────────────────────────────────

interface SavedSub extends Omit<PushSubscriptionRecord, "createdAt" | "lastSuccessAt"> {
  createdAt: string;
  lastSuccessAt: string | null;
}

function ensureLoaded() {
  if (state.loaded) return;
  state.loaded = true;
  if (!persistenceEnabled()) return;
  const saved = readJson<{ subscriptions?: SavedSub[] }>("push-subscriptions.json");
  for (const s of saved?.subscriptions ?? []) {
    if (!s?.endpoint || !s.keys?.p256dh || !s.keys.auth || !s.userId) continue;
    state.subs.set(s.endpoint, { ...s, createdAt: new Date(s.createdAt), lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt) : null });
  }
}

function scheduleSave() {
  if (!persistenceEnabled() || state.saveTimer) return;
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    writeJson("push-subscriptions.json", { version: 1, subscriptions: [...state.subs.values()] }, 0o600);
  }, 500);
  (state.saveTimer as { unref?: () => void }).unref?.();
}

/** Push services browsers actually use. Anything else is rejected (the server POSTs to this URL). */
const PUSH_HOSTS: [RegExp, string][] = [
  [/^(fcm|android)\.googleapis\.com$/, "FCM"],
  [/(^|\.)push\.services\.mozilla\.com$/, "Mozilla"],
  [/(^|\.)push\.apple\.com$/, "Apple"],
  [/(^|\.)notify\.windows\.com$/, "Windows"],
];

function extraHosts(): string[] {
  return (process.env.WEB_PUSH_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Returns the push service name for an allowed endpoint, or null when the endpoint is not acceptable. */
export function pushServiceFor(endpoint: string): string | null {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const known = PUSH_HOSTS.find(([re]) => re.test(host));
  if (known) return known[1];
  return extraHosts().includes(host) ? host : null;
}

/** "Chrome on Android", "Safari on iPhone", … from a User-Agent string. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg(A|iOS)?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser\//.test(ua)
      ? "Samsung Internet"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser";
  return os ? `${browser} on ${os}` : browser;
}

export interface SaveSubscriptionInput {
  userId: string;
  orgId: string | null;
  subscription: PushSubscriptionJSON;
  userAgent?: string | null;
  label?: string | null;
}

/**
 * Save (or refresh) a subscription. One endpoint = one device/browser profile;
 * if another account subscribes the same endpoint, it moves to that account.
 */
export function saveSubscription(input: SaveSubscriptionInput): PushSubscriptionRecord {
  ensureLoaded();
  const { subscription: sub } = input;
  const service = pushServiceFor(sub.endpoint);
  if (!service) throw new Error("Unsupported push endpoint");
  const existing = state.subs.get(sub.endpoint);
  const rec: PushSubscriptionRecord = {
    id: existing?.id ?? `psub_${Date.now().toString(36)}${(++state.seq).toString(36)}`,
    userId: input.userId,
    orgId: input.orgId,
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    expirationTime: sub.expirationTime ?? null,
    label: (input.label?.trim() || deviceLabel(input.userAgent)).slice(0, 60),
    service,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
    createdAt: existing && existing.userId === input.userId ? existing.createdAt : new Date(),
    lastSuccessAt: existing && existing.userId === input.userId ? existing.lastSuccessAt : null,
    lastError: null,
    failures: 0,
  };
  state.subs.set(sub.endpoint, rec);

  // Cap devices per user: drop the oldest
  const mine = listSubscriptions(input.userId);
  if (mine.length > MAX_PER_USER) for (const old of mine.slice(MAX_PER_USER)) state.subs.delete(old.endpoint);
  scheduleSave();
  return rec;
}

/** Remove by endpoint or id; with `userId` only that user's subscription is removed. */
export function removeSubscription(ref: { endpoint?: string; id?: string }, userId?: string): boolean {
  ensureLoaded();
  const rec = ref.endpoint ? state.subs.get(ref.endpoint) : [...state.subs.values()].find((s) => s.id === ref.id);
  if (!rec || (userId && rec.userId !== userId)) return false;
  state.subs.delete(rec.endpoint);
  scheduleSave();
  return true;
}

/** A user's devices, newest first. */
export function listSubscriptions(userId: string): PushSubscriptionRecord[] {
  ensureLoaded();
  return [...state.subs.values()].filter((s) => s.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function orgSubscriptions(orgId: string): PushSubscriptionRecord[] {
  ensureLoaded();
  return [...state.subs.values()].filter((s) => s.orgId === orgId);
}

export function subscriptionCount(): number {
  ensureLoaded();
  return state.subs.size;
}

// ─── Sending ──────────────────────────────────────────────────────────────

/** RFC 8030 §5.3 urgency: emergencies wake the device immediately. */
export function urgencyFor(severity: PushSeverity): Urgency {
  return severity === "emergency" ? "high" : "normal";
}

/** How long the push service keeps an undelivered message (seconds). */
export function ttlFor(severity: PushSeverity): number {
  return severity === "emergency" ? 24 * 3600 : severity === "warning" ? 12 * 3600 : 6 * 3600;
}

/** Normalise any payload into the exact shape public/sw.js expects. */
export function buildPayload(p: PushPayloadInput): PushPayload {
  const severity: PushSeverity = p.severity === "emergency" || p.severity === "warning" ? p.severity : "watch";
  const alertId = p.alertId ?? null;
  return {
    title: p.title.slice(0, 120),
    body: p.body.slice(0, 400),
    severity,
    tag: (p.tag || alertId || "agri-alert").slice(0, 64),
    alertId,
    url: p.url && p.url.startsWith("/") && !p.url.startsWith("//") ? p.url : "/",
  };
}

async function deliverTo(subs: PushSubscriptionRecord[], input: PushPayloadInput, opts: { ttl?: number } = {}): Promise<PushSendResult> {
  const result: PushSendResult = { attempted: 0, sent: 0, failed: 0, removed: 0 };
  if (!pushSendingEnabled()) return { ...result, skipped: "disabled" };
  if (!subs.length) return { ...result, skipped: "no-subscriptions" };

  const payload = buildPayload(input);
  const vapid = vapidConfig();
  const body = JSON.stringify(payload);
  const summary = `${payload.title}\n${payload.body}`;
  const options: RequestOptions = {
    TTL: opts.ttl ?? ttlFor(payload.severity),
    urgency: urgencyFor(payload.severity),
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    timeout: 10_000,
  };

  await Promise.all(
    subs.map(async (s) => {
      result.attempted++;
      const to = `${s.userId} · ${s.label}`;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, options);
        s.lastSuccessAt = new Date();
        s.failures = 0;
        s.lastError = null;
        result.sent++;
        recordOutbox({ channel: "app", to, body: summary, status: "sent", provider: "webpush" });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        const gone = status === 404 || status === 410;
        s.failures++;
        s.lastError = status ? `HTTP ${status}` : (e as Error).message;
        result.failed++;
        if (gone || s.failures >= MAX_FAILURES) {
          state.subs.delete(s.endpoint);
          result.removed++;
        }
        recordOutbox({
          channel: "app",
          to,
          body: summary,
          status: "failed",
          provider: "webpush",
          error: gone ? `subscription expired (HTTP ${status}), removed` : s.failures >= MAX_FAILURES ? `${s.lastError}; removed after ${MAX_FAILURES} failures` : s.lastError,
        });
      }
    })
  );
  scheduleSave();
  return result;
}

/** Push to every device a user has subscribed. */
export function sendPushToUser(userId: string, payload: PushPayloadInput, opts?: { ttl?: number }): Promise<PushSendResult> {
  if (!pushSendingEnabled()) return Promise.resolve({ attempted: 0, sent: 0, failed: 0, removed: 0, skipped: "disabled" });
  return deliverTo(listSubscriptions(userId), payload, opts);
}

/** Push to every subscribed device of an organisation's members (optionally filtered). */
export function sendPushToOrg(orgId: string, payload: PushPayloadInput, filter?: (s: PushSubscriptionRecord) => boolean, opts?: { ttl?: number }): Promise<PushSendResult> {
  if (!pushSendingEnabled()) return Promise.resolve({ attempted: 0, sent: 0, failed: 0, removed: 0, skipped: "disabled" });
  const subs = orgSubscriptions(orgId).filter((s) => !filter || filter(s));
  return deliverTo(subs, payload, opts);
}

/** Fire-and-forget variants for alert pipelines: never throw, never block the caller. */
export function firePushToUser(userId: string, payload: PushPayloadInput): void {
  if (!pushSendingEnabled()) return;
  void sendPushToUser(userId, payload).catch((e) => console.warn("[webpush] user push failed:", (e as Error).message));
}

export function firePushToOrg(orgId: string, payload: PushPayloadInput, filter?: (s: PushSubscriptionRecord) => boolean): void {
  if (!pushSendingEnabled()) return;
  void sendPushToOrg(orgId, payload, filter).catch((e) => console.warn("[webpush] org push failed:", (e as Error).message));
}

/** Map workspace notification severities onto the service worker's vocabulary. */
export function pushSeverityFor(severity: string): PushSeverity {
  if (severity === "critical" || severity === "emergency") return "emergency";
  if (severity === "warning" || severity === "high") return "warning";
  return "watch";
}

/** Test hook: clear subscriptions and cached keys. */
export function __resetWebPushForTests() {
  state.subs.clear();
  state.vapid = null;
  state.loaded = false;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = null;
}
