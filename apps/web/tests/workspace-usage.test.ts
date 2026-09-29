import { beforeEach, describe, expect, it } from "vitest";
import { getStore, resetStore } from "@/server/data/store";
import { checkLimit, effectivePlan, enforceLimit, evaluateLimit, monthStart, needsRollover, PLAN_LIMITS, planOf, trackUsage, usageDaily, usageOf, usageSummary } from "@/server/services/usage";

const ORG = "org-ins-deltamutual";

describe("usage metering", () => {
  beforeEach(() => {
    resetStore();
  });

  it("tracks usage on the org record and the daily ledger", () => {
    const before = usageOf(ORG).assessments;
    const st = trackUsage(ORG, "assessments", 3);
    expect(st).not.toBeNull();
    expect(usageOf(ORG).assessments).toBe(before + 3);
    expect(st!.used).toBe(before + 3);
    const today = new Date().toISOString().slice(0, 10);
    expect(usageDaily(ORG).find((d) => d.date === today)?.assessments).toBeGreaterThanOrEqual(3);
  });

  it("ignores unknown orgs, null orgs and non-positive amounts without throwing", () => {
    expect(trackUsage(null, "reports")).toBeNull();
    expect(trackUsage("org-does-not-exist", "reports")).toBeNull();
    expect(trackUsage(ORG, "reports", 0)).toBeNull();
  });

  it("rolls the metering period over at the start of a new month", () => {
    const org = getStore().orgs.find((o) => o.id === ORG)!;
    org.usage = { periodStart: new Date(Date.UTC(2020, 0, 1)), assessments: 999, apiCalls: 5, reports: 5, messages: 5 };
    const u = usageOf(ORG);
    expect(u.assessments).toBe(0);
    expect(u.periodStart.getTime()).toBe(monthStart().getTime());
  });

  it("needsRollover compares UTC month and year", () => {
    expect(needsRollover(new Date(Date.UTC(2026, 8, 1)), new Date(Date.UTC(2026, 8, 30, 23)))).toBe(false);
    expect(needsRollover(new Date(Date.UTC(2026, 8, 1)), new Date(Date.UTC(2026, 9, 1)))).toBe(true);
    expect(needsRollover(new Date(Date.UTC(2025, 9, 1)), new Date(Date.UTC(2026, 9, 1)))).toBe(true);
    // Local-midnight period starts east of UTC still belong to their month
    expect(needsRollover(new Date("2026-08-31T18:30:00Z"), new Date("2026-09-29T08:00:00Z"))).toBe(false);
  });

  it("raises a billing notification once when crossing 80% and 100%", () => {
    const org = getStore().orgs.find((o) => o.id === ORG)!;
    org.planTier = "free";
    org.usage = { periodStart: monthStart(), assessments: 0, apiCalls: 0, reports: 0, messages: 0 };
    const count = () => getStore().notifications.filter((n) => n.workspaceId === ORG && n.kind === "billing").length;
    const base = count();
    trackUsage(ORG, "reports", 4); // 4/5 = 80%
    expect(count()).toBe(base + 1);
    trackUsage(ORG, "reports", 0); // no-op
    expect(count()).toBe(base + 1);
    trackUsage(ORG, "reports", 1); // 5/5 = 100%
    expect(count()).toBe(base + 2);
    trackUsage(ORG, "reports", 1); // over, already warned
    expect(count()).toBe(base + 2);
  });

  it("summarises every meter for the billing page", () => {
    const s = usageSummary(ORG);
    expect(s.meters.map((m) => m.kind)).toEqual(["assessments", "apiCalls", "reports", "messages", "seats", "assets"]);
    const assets = s.meters.find((m) => m.kind === "assets")!;
    expect(assets.used).toBe(getStore().assets.filter((a) => a.workspaceId === ORG && a.status === "active").length);
    expect(s.periodEnd.getTime()).toBeGreaterThan(s.periodStart.getTime());
  });
});

describe("limits", () => {
  beforeEach(() => {
    resetStore();
  });

  it("evaluateLimit handles finite, zero and unlimited quotas", () => {
    expect(evaluateLimit("free", "reports", 4, 1)).toMatchObject({ ok: true, limit: 5, remaining: 1, pct: 80 });
    expect(evaluateLimit("free", "reports", 5, 1)).toMatchObject({ ok: false, remaining: 0, pct: 100 });
    expect(evaluateLimit("enterprise", "assessments", 10_000_000, 1)).toMatchObject({ ok: true, limit: null, remaining: null, pct: 0 });
    expect(evaluateLimit("farmer_pro", "apiCalls", 0, 1)).toMatchObject({ ok: false, limit: 0, pct: 100 });
  });

  it("checkLimit counts seats and assets from the store", () => {
    const seats = checkLimit(ORG, "seats");
    expect(seats.used).toBe(getStore().users.filter((u) => u.orgId === ORG && u.status !== "suspended").length);
    expect(seats.plan).toBe("business");
    expect(seats.ok).toBe(true);
  });

  it("enforceLimit throws FORBIDDEN with an upgrade hint when exhausted", () => {
    const org = getStore().orgs.find((o) => o.id === ORG)!;
    org.planTier = "free";
    org.usage = { periodStart: monthStart(), assessments: 250, apiCalls: 0, reports: 0, messages: 0 };
    expect(() => enforceLimit(ORG, "assessments")).toThrowError(/limit reached.*upgrade/i);
    expect(() => enforceLimit(ORG, "reports")).not.toThrow();
    expect(enforceLimit(null, "reports")).toBeNull();
  });

  it("an expired trial falls back to the Free plan", () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    expect(effectivePlan({ planTier: "business", trialEndsAt: past }, "trialing")).toBe("free");
    expect(effectivePlan({ planTier: "business", trialEndsAt: future }, "trialing")).toBe("business");
    expect(effectivePlan({ planTier: "business", trialEndsAt: past }, "active")).toBe("business");
    expect(effectivePlan({ planTier: "enterprise", trialEndsAt: null }, null)).toBe("enterprise");
    const org = getStore().orgs.find((o) => o.id === ORG)!;
    org.trialEndsAt = past;
    const sub = getStore().subscriptions.find((s) => s.orgId === ORG)!;
    sub.status = "trialing";
    sub.currentPeriodEnd = future; // e.g. a later checkout restarted the trial on the subscription
    expect(planOf(ORG)).toBe("business");
    sub.currentPeriodEnd = past;
    expect(planOf(ORG)).toBe("free");
  });

  it("seeded tenants start within their plan limits (demo never shows a blocked workspace)", () => {
    for (const o of getStore().orgs) {
      for (const k of ["assessments", "apiCalls", "reports", "messages", "seats", "assets"] as const) {
        const st = checkLimit(o.id, k);
        expect(st.ok, `${o.id} ${k} ${st.used}/${st.limit}`).toBe(true);
      }
    }
  });
});

describe("PLAN_LIMITS", () => {
  it("covers every plan and every limit kind", () => {
    for (const plan of ["free", "farmer_pro", "gov_basic", "gov_enterprise", "supply_chain", "business", "enterprise"] as const) {
      for (const k of ["assessments", "apiCalls", "reports", "messages", "seats", "assets"] as const) {
        expect(PLAN_LIMITS[plan][k] === null || typeof PLAN_LIMITS[plan][k] === "number").toBe(true);
      }
    }
  });

  it("is monotonic: free ≤ business ≤ enterprise for every quota", () => {
    const rank = (v: number | null) => (v === null ? Infinity : v);
    for (const k of ["assessments", "apiCalls", "reports", "messages", "seats", "assets"] as const) {
      expect(rank(PLAN_LIMITS.free[k])).toBeLessThanOrEqual(rank(PLAN_LIMITS.business[k]));
      expect(rank(PLAN_LIMITS.business[k])).toBeLessThanOrEqual(rank(PLAN_LIMITS.enterprise[k]));
      expect(rank(PLAN_LIMITS.gov_basic[k])).toBeLessThanOrEqual(rank(PLAN_LIMITS.gov_enterprise[k]));
    }
  });
});
