import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

// NextAuth is not needed for caller tests — sessions are injected directly.
vi.mock("@/auth", () => ({ auth: async () => null, signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const { appRouter } = await import("@/server/routers/_app");
const { createCallerFactory } = await import("@/server/trpc");
const { getStore, resetStore } = await import("@/server/data/store");

const createCaller = createCallerFactory(appRouter);

function session(userId: string): Session | null {
  const u = getStore().users.find((x) => x.id === userId);
  if (!u) return null;
  return { user: { id: u.id, name: u.name, email: u.email, role: u.role, orgId: u.orgId, language: u.language }, expires: new Date(Date.now() + 3600_000).toISOString() } as Session;
}

let ipSeq = 0;
function caller(userId: string | null) {
  return createCaller({ session: userId ? session(userId) : null, ip: `10.0.0.${++ipSeq % 250}`, req: new Request("http://localhost/api/trpc") });
}

beforeEach(() => {
  resetStore();
});

describe("public router", () => {
  it("stats returns live landing counters", async () => {
    const s = await caller(null).public.stats();
    expect(s.districtsMonitored).toBe(22);
    expect(s.countries).toBe(5);
    expect(s.activeAlerts).toBe(5);
    expect(s.farmersProtectedToday).toBeGreaterThan(15_000);
    expect(s.hectaresMonitored).toBeGreaterThan(0);
  });

  it("riskMap filters by country", async () => {
    const all = await caller(null).public.riskMap();
    const bd = await caller(null).public.riskMap({ country: "BD" });
    expect(all).toHaveLength(22);
    expect(bd.every((d) => d.countryCode === "BD")).toBe(true);
    expect(bd.length).toBe(5);
  });

  it("validates inputs with Zod", async () => {
    await expect(caller(null).public.riskMap({ country: "BGD" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("admin router authorization", () => {
  const cases: [string, string | null, string][] = [
    ["anonymous", null, "UNAUTHORIZED"],
    ["farmer", "user-farmer-demo", "FORBIDDEN"],
    ["government", "user-gov-demo", "FORBIDDEN"],
    ["supply chain", "user-supply-demo", "FORBIDDEN"],
  ];
  for (const [label, uid, code] of cases) {
    it(`${label} → ${code}`, async () => {
      const c = caller(uid);
      await expect(c.admin.overview()).rejects.toMatchObject({ code });
      await expect(c.admin.users.list({})).rejects.toMatchObject({ code });
      await expect(c.admin.setScenario({ mode: "monsoon_surge" })).rejects.toMatchObject({ code });
      await expect(c.admin.resetDemo({ confirm: "RESET" })).rejects.toMatchObject({ code });
    });
  }
});

describe("admin router (platform_admin)", () => {
  const admin = () => caller("user-admin-demo");

  it("overview aggregates KPIs", async () => {
    const o = await admin().admin.overview();
    expect(o.users.total).toBe(getStore().users.length);
    expect(o.alerts.perDay).toHaveLength(30);
    expect(o.billing.mrr).toBeGreaterThan(0);
    expect(o.billing.arr).toBe(o.billing.mrr * 12);
    expect(o.orgs.pending).toBe(2);
  });

  it("lists and searches users without leaking passwords", async () => {
    const r = await admin().admin.users.list({ q: "ratan" });
    expect(r.rows[0]?.name).toBe("Ratan Das");
    expect(r.rows.every((u) => !("password" in u))).toBe(true);
    const gov = await admin().admin.users.list({ role: "national_admin", limit: 100 });
    expect(gov.rows.every((u) => u.role === "national_admin")).toBe(true);
  });

  it("suspends / reactivates a user and audits it", async () => {
    await admin().admin.users.setStatus({ id: "user-farmer-001", status: "suspended", reason: "fraud check" });
    expect(getStore().users.find((u) => u.id === "user-farmer-001")!.status).toBe("suspended");
    expect(getStore().audit[0]).toMatchObject({ action: "user.suspend", entityId: "user-farmer-001", userId: "user-admin-demo" });
    await admin().admin.users.setStatus({ id: "user-farmer-001", status: "active" });
    expect(getStore().audit[0]!.action).toBe("user.reactivate");
  });

  it("refuses self-suspension and self-demotion", async () => {
    await expect(admin().admin.users.setStatus({ id: "user-admin-demo", status: "suspended" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().admin.users.update({ id: "user-admin-demo", role: "farmer" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("changes a role (audited)", async () => {
    const r = await admin().admin.users.update({ id: "user-officer-barisal", role: "regional_admin" });
    expect(r.changes[0]).toContain("field_officer → regional_admin");
    expect(getStore().audit[0]!.action).toBe("user.update");
  });

  it("verifies a pending organisation and activates its subscription", async () => {
    const orgs = await admin().admin.orgs.list();
    const pending = orgs.find((o) => o.state === "pending")!;
    await admin().admin.orgs.review({ id: pending.id, decision: "verify", note: "Docs checked" });
    const o = getStore().orgs.find((x) => x.id === pending.id)!;
    expect(o.verified).toBe(true);
    expect(getStore().subscriptions.find((x) => x.orgId === o.id)!.status).toBe("active");
    expect(getStore().audit[0]!.action).toBe("org.verify");
  });

  it("toggles a feature flag with rollout", async () => {
    const f = await admin().admin.updateFlag({ key: "camera_disease", enabled: true, rolloutPct: 25 });
    expect(f).toMatchObject({ enabled: true, rolloutPct: 25 });
    await expect(admin().admin.updateFlag({ key: "camera_disease", rolloutPct: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("billing splits MRR by plan and provider", async () => {
    const b = await admin().admin.billing();
    expect(b.byPlan.reduce((n, p) => n + p.mrr, 0)).toBe(b.mrr);
    expect(b.byProvider.map((p) => p.provider)).toEqual(["stripe", "razorpay", "paymongo", "none"]);
  });

  it("filters alert audit and the audit log", async () => {
    const a = await admin().admin.alertAudit({ type: "salinity", activeOnly: true });
    expect(a.total).toBe(2);
    const log = await admin().admin.audit({ action: "alert" });
    expect(log.rows.every((r) => r.action.startsWith("alert"))).toBe(true);
  });

  it("switches scenario and reports before/after", async () => {
    const r = await admin().admin.setScenario({ mode: "dry_season_salinity", intensity: 0.8 });
    expect(r.scenario.mode).toBe("dry_season_salinity");
    expect(r.before).toHaveLength(22);
    expect(r.after).toHaveLength(22);
    expect(getStore().audit[0]!.action).toBe("scenario.set");
  });

  it("resets demo data only with explicit confirmation", async () => {
    getStore().alerts.unshift({ ...getStore().alerts[0]!, id: "alr-temp" });
    // @ts-expect-error — confirmation literal is enforced
    await expect(admin().admin.resetDemo({ confirm: "yes" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await admin().admin.resetDemo({ confirm: "RESET" });
    expect(getStore().alerts.some((a) => a.id === "alr-temp")).toBe(false);
    expect(getStore().audit[0]!.action).toBe("demo.reset");
  });

  it("smsSign is a no-op without TWILIO_AUTH_TOKEN", async () => {
    const r = await admin().admin.smsSign({ url: "http://localhost:3000/api/v1/sms/inbound", params: { From: "+8801711000000", Body: "STATUS" } });
    expect(r).toEqual({ signature: null, signing: false });
  });
});
