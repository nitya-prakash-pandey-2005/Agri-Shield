import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

// web-push is mocked: nothing here touches the network.
const wp = vi.hoisted(() => ({
  sendNotification: vi.fn(async (..._args: unknown[]) => ({ statusCode: 201, body: "", headers: {} })),
  generateVAPIDKeys: vi.fn(() => ({ publicKey: `BPUB${Math.random().toString(36).slice(2, 10)}`, privateKey: `PRIV${Math.random().toString(36).slice(2, 10)}` })),
}));
vi.mock("web-push", () => ({ default: wp, ...wp }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const push = await import("@/server/notify/webpush");
const { outbox } = await import("@/server/notify/channels");
const { appRouter } = await import("@/server/routers/_app");
const { createCallerFactory } = await import("@/server/trpc");
const { getStore } = await import("@/server/data/store");
const { notifyWorkspace } = await import("@/server/services/workspace-notifications");

const ENV_KEYS = ["AGRI_PUSH_IN_TESTS", "AGRI_PUSH_PERSIST", "AGRI_DATA_DIR", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "WEB_PUSH_DISABLED"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const tmpDirs: string[] = [];

let seq = 0;
function fakeSub(host = "fcm.googleapis.com") {
  seq++;
  return { endpoint: `https://${host}/fcm/send/device-${seq}-${Date.now()}`, expirationTime: null, keys: { p256dh: `BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM${seq}`, auth: "tBHItJI5svbpez7KI4CCXg" } };
}

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.AGRI_PUSH_IN_TESTS = "true";
  push.__resetWebPushForTests();
  wp.sendNotification.mockReset();
  wp.sendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  wp.generateVAPIDKeys.mockClear();
});

afterEach(() => {
  push.__resetWebPushForTests();
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("subscription store", () => {
  it("saves, lists, re-assigns and removes subscriptions", () => {
    const a = fakeSub();
    const rec = push.saveSubscription({ userId: "u1", orgId: "org-1", subscription: a, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36" });
    expect(rec).toMatchObject({ userId: "u1", orgId: "org-1", endpoint: a.endpoint, label: "Chrome on Android", service: "FCM", failures: 0, lastSuccessAt: null });
    push.saveSubscription({ userId: "u1", orgId: "org-1", subscription: fakeSub("updates.push.services.mozilla.com"), userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0" });
    expect(push.listSubscriptions("u1").map((s) => s.label).sort()).toEqual(["Chrome on Android", "Firefox on Windows"]);
    expect(push.orgSubscriptions("org-1")).toHaveLength(2);

    // same endpoint re-subscribed = upsert (id kept, no duplicate)
    const again = push.saveSubscription({ userId: "u1", orgId: "org-1", subscription: a });
    expect(again.id).toBe(rec.id);
    expect(push.subscriptionCount()).toBe(2);

    // another account signs in on the same device → the endpoint moves
    push.saveSubscription({ userId: "u2", orgId: "org-2", subscription: a });
    expect(push.listSubscriptions("u1")).toHaveLength(1);
    expect(push.listSubscriptions("u2")[0]!.endpoint).toBe(a.endpoint);

    // users can only remove their own devices
    expect(push.removeSubscription({ endpoint: a.endpoint }, "u1")).toBe(false);
    expect(push.removeSubscription({ id: push.listSubscriptions("u2")[0]!.id }, "u2")).toBe(true);
    expect(push.listSubscriptions("u2")).toHaveLength(0);
  });

  it("only accepts real push-service endpoints (no SSRF)", () => {
    expect(push.pushServiceFor("https://fcm.googleapis.com/fcm/send/abc")).toBe("FCM");
    expect(push.pushServiceFor("https://web.push.apple.com/QGx")).toBe("Apple");
    expect(push.pushServiceFor("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe("Windows");
    expect(push.pushServiceFor("http://fcm.googleapis.com/fcm/send/abc")).toBeNull();
    expect(push.pushServiceFor("https://evil.example.com/fcm.googleapis.com")).toBeNull();
    expect(push.pushServiceFor("https://169.254.169.254/latest")).toBeNull();
    expect(() => push.saveSubscription({ userId: "u1", orgId: null, subscription: fakeSub("internal.local") })).toThrow(/Unsupported/);
  });

  it("labels devices from the user agent", () => {
    expect(push.deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(push.deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0")).toBe("Edge on Windows");
    expect(push.deviceLabel(null)).toBe("Browser");
  });
});

describe("sending", () => {
  it("sendPushToUser sends the sw.js payload shape with severity-based urgency + TTL", async () => {
    const s = fakeSub();
    push.saveSubscription({ userId: "farmer-1", orgId: null, subscription: s });
    const before = outbox.length;

    const r = await push.sendPushToUser("farmer-1", { title: "EMERGENCY · Flood", body: "Move livestock to high ground", severity: "emergency", tag: "alr_1", alertId: "alr_1", url: "/dashboard/farmer/alerts" });
    expect(r).toEqual({ attempted: 1, sent: 1, failed: 0, removed: 0 });
    expect(wp.sendNotification).toHaveBeenCalledTimes(1);
    const [subArg, body, opts] = wp.sendNotification.mock.calls[0]! as [{ endpoint: string; keys: unknown }, string, { TTL: number; urgency: string; vapidDetails: { subject: string; publicKey: string; privateKey: string } }];
    expect(subArg).toEqual({ endpoint: s.endpoint, keys: s.keys });
    expect(JSON.parse(body)).toEqual({ title: "EMERGENCY · Flood", body: "Move livestock to high ground", severity: "emergency", tag: "alr_1", alertId: "alr_1", url: "/dashboard/farmer/alerts" });
    expect(opts.urgency).toBe("high");
    expect(opts.TTL).toBe(24 * 3600);
    expect(opts.vapidDetails.subject).toMatch(/^mailto:/);
    expect(opts.vapidDetails.publicKey).toBe(push.vapidPublicKey());

    expect(outbox.length).toBe(before + 1);
    expect(outbox[0]).toMatchObject({ channel: "app", status: "sent", provider: "webpush" });
    expect(push.listSubscriptions("farmer-1")[0]!.lastSuccessAt).toBeInstanceOf(Date);
  });

  it("maps severities and normalises payloads", async () => {
    expect(push.urgencyFor("emergency")).toBe("high");
    expect(push.urgencyFor("warning")).toBe("normal");
    expect(push.urgencyFor("watch")).toBe("normal");
    expect(push.pushSeverityFor("critical")).toBe("emergency");
    expect(push.pushSeverityFor("warning")).toBe("warning");
    expect(push.pushSeverityFor("info")).toBe("watch");
    expect(push.buildPayload({ title: "t", body: "b", url: "https://evil.example.com" })).toEqual({ title: "t", body: "b", severity: "watch", tag: "agri-alert", alertId: null, url: "/" });

    push.saveSubscription({ userId: "u-w", orgId: null, subscription: fakeSub() });
    await push.sendPushToUser("u-w", { title: "Warning", body: "x", severity: "warning" });
    const opts = wp.sendNotification.mock.calls[0]![2] as { urgency: string; TTL: number };
    expect(opts).toMatchObject({ urgency: "normal", TTL: 12 * 3600 });
  });

  it("removes a subscription when the push service answers 410 Gone", async () => {
    push.saveSubscription({ userId: "u-gone", orgId: null, subscription: fakeSub() });
    wp.sendNotification.mockRejectedValueOnce(Object.assign(new Error("Received unexpected response code"), { statusCode: 410 }));
    const r = await push.sendPushToUser("u-gone", { title: "t", body: "b" });
    expect(r).toEqual({ attempted: 1, sent: 0, failed: 1, removed: 1 });
    expect(push.listSubscriptions("u-gone")).toHaveLength(0);
    expect(outbox[0]).toMatchObject({ status: "failed", provider: "webpush" });
    expect(outbox[0]!.error).toMatch(/410/);
  });

  it("records transient failures and keeps the subscription", async () => {
    push.saveSubscription({ userId: "u-flaky", orgId: null, subscription: fakeSub() });
    wp.sendNotification.mockRejectedValueOnce(Object.assign(new Error("server error"), { statusCode: 500 }));
    const r = await push.sendPushToUser("u-flaky", { title: "t", body: "b" });
    expect(r).toMatchObject({ failed: 1, removed: 0 });
    const [sub] = push.listSubscriptions("u-flaky");
    expect(sub).toMatchObject({ failures: 1, lastError: "HTTP 500" });
    expect(outbox[0]).toMatchObject({ status: "failed", provider: "webpush", error: "HTTP 500" });

    // next success resets the failure counter
    await push.sendPushToUser("u-flaky", { title: "t", body: "b" });
    expect(push.listSubscriptions("u-flaky")[0]).toMatchObject({ failures: 0, lastError: null });
  });

  it("sendPushToOrg reaches every member device and honours the filter", async () => {
    push.saveSubscription({ userId: "a", orgId: "org-x", subscription: fakeSub() });
    push.saveSubscription({ userId: "b", orgId: "org-x", subscription: fakeSub() });
    push.saveSubscription({ userId: "c", orgId: "org-y", subscription: fakeSub() });
    expect(await push.sendPushToOrg("org-x", { title: "Rule fired", body: "3 assets" })).toMatchObject({ attempted: 2, sent: 2 });
    wp.sendNotification.mockClear();
    expect(await push.sendPushToOrg("org-x", { title: "Rule fired", body: "3 assets" }, (s) => s.userId === "b")).toMatchObject({ attempted: 1, sent: 1 });
  });

  it("never sends under vitest unless explicitly enabled", async () => {
    delete process.env.AGRI_PUSH_IN_TESTS;
    push.saveSubscription({ userId: "u-off", orgId: null, subscription: fakeSub() });
    const r = await push.sendPushToUser("u-off", { title: "t", body: "b" });
    expect(r.skipped).toBe("disabled");
    push.firePushToUser("u-off", { title: "t", body: "b" });
    expect(wp.sendNotification).not.toHaveBeenCalled();
  });
});

describe("VAPID keys", () => {
  it("prefers environment keys", () => {
    process.env.VAPID_PUBLIC_KEY = "BENVPUBLIC";
    process.env.VAPID_PRIVATE_KEY = "envprivate";
    process.env.VAPID_SUBJECT = "https://agrishield.example";
    expect(push.vapidConfig()).toEqual({ publicKey: "BENVPUBLIC", privateKey: "envprivate", subject: "https://agrishield.example", source: "env" });
    expect(wp.generateVAPIDKeys).not.toHaveBeenCalled();
  });

  it("generates a key pair once, saves it, and reloads it after a restart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agri-vapid-"));
    tmpDirs.push(dir);
    process.env.AGRI_DATA_DIR = dir;
    process.env.AGRI_PUSH_PERSIST = "true";
    process.env.VAPID_SUBJECT = "not-a-valid-subject";

    const first = push.vapidConfig();
    expect(first.source).toBe("generated");
    expect(first.subject).toBe("mailto:alerts@agrishield.io");
    expect(wp.generateVAPIDKeys).toHaveBeenCalledTimes(1);
    expect(push.vapidConfig().publicKey).toBe(first.publicKey); // cached
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "vapid.json"), "utf8"));
    expect(saved).toMatchObject({ publicKey: first.publicKey, privateKey: first.privateKey });

    push.__resetWebPushForTests(); // simulate a process restart
    const second = push.vapidConfig();
    expect(second).toMatchObject({ publicKey: first.publicKey, privateKey: first.privateKey, source: "file" });
    expect(wp.generateVAPIDKeys).toHaveBeenCalledTimes(1);
  });

  it("falls back to in-memory keys without persistence", () => {
    const k = push.vapidConfig();
    expect(k.source).toBe("generated");
    expect(push.vapidPublicKey()).toBe(k.publicKey);
  });
});

describe("push router", () => {
  const createCaller = createCallerFactory(appRouter);
  let ip = 0;
  const caller = (userId: string | null) => {
    const u = userId ? getStore().users.find((x) => x.id === userId) : null;
    const session = u ? ({ user: { id: u.id, name: u.name, email: u.email, role: u.role, orgId: u.orgId, language: u.language }, expires: new Date(Date.now() + 3600_000).toISOString() } as Session) : null;
    return createCaller({ session, ip: `10.9.0.${++ip % 250}`, req: new Request("http://localhost/api/trpc", { headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile Safari/537.36" } }) });
  };

  it("requires a session", async () => {
    await expect(caller(null).push.publicKey()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(null).push.subscribe({ subscription: fakeSub() })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("subscribe → list → test → unsubscribe", async () => {
    const c = caller("user-farmer-demo");
    const { publicKey } = await c.push.publicKey();
    expect(publicKey).toBe(push.vapidPublicKey());

    await expect(c.push.test()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const s = fakeSub();
    const dev = await c.push.subscribe({ subscription: s });
    expect(dev).toMatchObject({ endpoint: s.endpoint, label: "Chrome on Android", service: "FCM" });
    expect(await c.push.list()).toHaveLength(1);

    const r = await c.push.test();
    expect(r).toMatchObject({ attempted: 1, sent: 1 });
    expect(JSON.parse(wp.sendNotification.mock.calls[0]![1] as string)).toMatchObject({ severity: "watch", tag: "agri-test", url: "/dashboard/farmer/alerts" });

    // another user cannot remove it
    expect(await caller("user-gov-demo").push.unsubscribe({ endpoint: s.endpoint })).toEqual({ removed: false });
    expect(await c.push.unsubscribe({ endpoint: s.endpoint })).toEqual({ removed: true });
    expect(await c.push.list()).toHaveLength(0);
  });

  it("validates the subscription and rate-limits test sends", async () => {
    const c = caller("user-gov-demo");
    await expect(c.push.subscribe({ subscription: { ...fakeSub(), endpoint: "https://attacker.example/collect" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(c.push.subscribe({ subscription: { ...fakeSub(), keys: { p256dh: "short", auth: "x" } } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await c.push.subscribe({ subscription: fakeSub() });
    for (let i = 0; i < 3; i++) await c.push.test();
    await expect(c.push.test()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("alert delivery wiring", () => {
  it("farmer alert broadcasts push to the farmer's devices, deep-linking to their alerts", async () => {
    const { broadcastAlert } = await import("@/server/services/alerts");
    const farmer = getStore().farmers.find((f) => f.userId === "user-farmer-demo")!;
    farmer.notificationPrefs.channels = ["app"];
    push.saveSubscription({ userId: "user-farmer-demo", orgId: null, subscription: fakeSub() });
    const [alert] = await broadcastAlert({ alertType: "flood", severity: "emergency", districtIds: [farmer.districtId], title: "River overtopping", description: "Water expected in low fields within 24 h.", recommendedActions: ["Move seed stock up"], channels: ["app"], createdBy: "system" });
    await vi.waitFor(() => expect(wp.sendNotification).toHaveBeenCalled());
    const payloads = wp.sendNotification.mock.calls.map((c) => JSON.parse(c[1] as string));
    expect(payloads).toContainEqual(expect.objectContaining({ severity: "emergency", alertId: alert!.id, tag: alert!.id, url: "/dashboard/farmer/alerts" }));
    expect((wp.sendNotification.mock.calls[0]![2] as { urgency: string }).urgency).toBe("high");
  });

  it("fired workspace rules push to members' devices with a deep link", async () => {
    push.saveSubscription({ userId: "user-insurer-demo", orgId: "org-ins-deltamutual", subscription: fakeSub() });
    notifyWorkspace({ workspaceId: "org-ins-deltamutual", kind: "rule", title: "Flood exposure: 2 assets", body: "Plot A (flood 72h 81%)", href: "/app/alerts?tab=history&firing=f1", severity: "critical", email: false });
    await vi.waitFor(() => expect(wp.sendNotification).toHaveBeenCalledTimes(1));
    expect(JSON.parse(wp.sendNotification.mock.calls[0]![1] as string)).toMatchObject({ title: "Flood exposure: 2 assets", severity: "emergency", url: "/app/alerts?tab=history&firing=f1" });

    // routine info notifications stay in-app only
    wp.sendNotification.mockClear();
    notifyWorkspace({ workspaceId: "org-ins-deltamutual", kind: "team", title: "Someone joined", body: "x", severity: "info", email: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(wp.sendNotification).not.toHaveBeenCalled();
  });
});
