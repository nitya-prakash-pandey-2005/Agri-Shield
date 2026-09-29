import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("@/auth", () => ({ auth: async () => null, signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const { workspaceRouter } = await import("@/server/routers/workspace");
const { createCallerFactory } = await import("@/server/trpc");
const { getStore, resetStore } = await import("@/server/data/store");
const { __resetWsState, wsState } = await import("@/server/services/workspace-state");
const { buildBriefing, computeMetrics, portfolioScores } = await import("@/server/services/workspace-home");
const { dailyBars, deriveIncidents } = await import("@/server/services/status-history");
const { GLOSSARY, lookupTerm, searchGlossary } = await import("@/components/help/glossary");
const { checkLimit } = await import("@/server/services/usage");

const caller = createCallerFactory(workspaceRouter);
let ip = 0;
function as(userId: string) {
  const u = getStore().users.find((x) => x.id === userId)!;
  return caller({ session: { user: { id: u.id, name: u.name, email: u.email, role: u.role, orgId: u.orgId, language: u.language }, expires: new Date(Date.now() + 3600_000).toISOString() } as Session, ip: `10.8.0.${++ip % 250}`, req: new Request("http://localhost/api/trpc") });
}

beforeEach(() => {
  resetStore();
  __resetWsState();
});

describe("home briefing uses real portfolio numbers", () => {
  it("counts match the store for the insurer workspace", async () => {
    const org = getStore().orgs.find((o) => o.id === "org-ins-deltamutual")!;
    const assets = getStore().assets.filter((a) => a.workspaceId === org.id && a.status === "active");
    const scores = await portfolioScores(org.id);
    expect(scores.size).toBe(assets.length);
    const m = computeMetrics(org, assets, scores);
    expect(m.total).toBe(140);
    expect(m.exposureUsd).toBe(assets.reduce((n, a) => n + a.valueUsd, 0));
    const atRisk = assets.filter((a) => scores.get(a.id)!.composite >= m.threshold).length;
    expect(m.atRisk).toBe(atRisk);
    expect(m.levels.low + m.levels.medium + m.levels.high + m.levels.critical).toBe(140);
    const b = buildBriefing(m, 0);
    // Headline states the real count whether the book is calm ("All 140 of your insured units…") or stressed
    expect(b.headline).toMatch(/140 (of your )?insured units/);
    if (m.atRisk > 0) expect(b.lines.some((l) => l.text.includes(`${m.atRisk} `))).toBe(true);
    else expect(b.headline).toMatch(/below your risk threshold/);
  });

  it("home procedure returns industry KPIs, map points and checklist", async () => {
    const h = await as("user-insurer-demo").home();
    expect(h.kpis.map((k) => k.key)).toContain("trigger");
    expect(h.points).toHaveLength(140);
    expect(h.onboarding.total).toBe(5);
    const bank = await as("user-bank-demo").home();
    expect(bank.kpis.map((k) => k.key)).toContain("dpd");
    expect(bank.briefing.headline).toMatch(/agri loans/);
  });

  it("a workspace with no assets gets a helpful empty briefing", () => {
    const b = buildBriefing({ total: 0, noun: { one: "asset", many: "assets", value: "value" } } as never, 0);
    expect(b.headline).toMatch(/Add your first asset/);
  });
});

describe("reports", () => {
  it("generates a portfolio summary from live data, stores it, meters usage and ticks onboarding", async () => {
    const ws = as("user-insurer-demo");
    const before = checkLimit("org-ins-deltamutual", "reports").used;
    const rec = await ws.generateReport({ type: "portfolio_summary", params: {} });
    expect(rec.snapshot.sections.map((s) => s.heading)).toContain("Top 10 assets by risk");
    const top = rec.snapshot.sections.find((s) => s.heading === "Top 10 assets by risk")!.table!;
    expect(top.rows).toHaveLength(10);
    expect(checkLimit("org-ins-deltamutual", "reports").used).toBe(before + 1);
    const list = await ws.reports();
    expect(list.history[0]!.id).toBe(rec.id);
    expect((await ws.onboarding()).steps.find((s) => s.id === "generate_report")!.done).toBe(true);
    const again = await ws.getReport({ id: rec.id });
    expect(again.downloads).toBe(1);
  });

  it("board pack, disclosure and digest build for every industry", async () => {
    for (const u of ["user-bank-demo", "user-ngo-demo", "user-coop-demo"]) {
      for (const type of ["board_pack", "physical_risk", "weekly_digest"] as const) {
        const r = await as(u).generateReport({ type, params: {} });
        expect(r.snapshot.sections.length, `${u} ${type}`).toBeGreaterThan(3);
      }
    }
  });

  it("scheduled reports run when due and email recipients", async () => {
    const ws = as("user-insurer-demo");
    const sch = await ws.createSchedule({ type: "weekly_digest", cadence: "weekly", day: 1, hourUtc: 3, recipients: ["risk@deltamutual.example"] });
    wsState().schedules[0]!.nextRunAt = new Date(Date.now() - 1000);
    const list = await ws.reports();
    expect(list.history.some((h) => h.scheduleId === sch.id && h.trigger === "schedule")).toBe(true);
    const s = list.schedules.find((x) => x.id === sch.id)!;
    expect(s.runs).toBe(1);
    expect(new Date(s.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("blocks generation when the plan's report quota is exhausted", async () => {
    const org = getStore().orgs.find((o) => o.id === "org-coop-odisha")!;
    org.planTier = "free";
    org.usage!.reports = 5;
    await expect(as("user-coop-demo").generateReport({ type: "board_pack", params: {} })).rejects.toThrow(/Reports generated limit reached/);
  });
});

describe("settings, security & audit", () => {
  it("updates settings (admin only) and scopes the audit log to the workspace", async () => {
    const ws = as("user-insurer-demo");
    await ws.updateSettings({ settings: { riskThreshold: 45 }, logoInitials: "dm" });
    expect(getStore().orgs.find((o) => o.id === "org-ins-deltamutual")!.settings!.riskThreshold).toBe(45);
    await expect(as("user-insurer-analyst").updateSettings({ settings: { riskThreshold: 70 } })).rejects.toThrow(/permission/i);
    const log = await ws.auditLog({ limit: 500 });
    const members = new Set(getStore().users.filter((u) => u.orgId === "org-ins-deltamutual").map((u) => u.id));
    expect(log.rows[0]!.action).toBe("workspace.settings.update");
    expect(log.rows.every((r) => members.has(r.userId) || r.entityId === "org-ins-deltamutual")).toBe(true);
  });

  it("exports the workspace without secrets and schedules/cancels deletion", async () => {
    const ws = as("user-bank-demo");
    const dump = await ws.exportWorkspace();
    expect(dump.assets).toHaveLength(160);
    expect(dump.members.every((m) => !("password" in m))).toBe(true);
    await expect(ws.requestDeletion({ confirmName: "wrong", reason: "" })).rejects.toThrow(/exactly/);
    const req = await ws.requestDeletion({ confirmName: "Mekong Rural Credit Bank", reason: "test" });
    expect((req.scheduledFor.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29);
    expect((await ws.me()).deletion).not.toBeNull();
    await ws.cancelDeletion();
    expect((await ws.me()).deletion).toBeNull();
  });

  it("API keys are created hashed and revocable", async () => {
    const ws = as("user-ngo-demo");
    const k = await ws.createApiKey({ name: "GIS sync", scopes: ["risk:read"], environment: "live" });
    expect(k.key).toMatch(/^ags_live_/);
    const api = await ws.api();
    expect(api.keys.find((x) => x.id === k.id)).toMatchObject({ hashed: true });
    expect(JSON.stringify(api)).not.toContain(k.key);
    await ws.revokeApiKey({ id: k.id });
    expect((await ws.api()).keys.find((x) => x.id === k.id)).toBeUndefined();
  });
});

describe("status aggregation", () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 8, 29, 12);
  it("shows no-data bars before boot and computes uptime per day", () => {
    const samples = [
      { at: now - 2 * 3_600_000, status: "up" as const, latencyMs: 100 },
      { at: now - 3_600_000, status: "down" as const, latencyMs: null },
      { at: now - 60_000, status: "up" as const, latencyMs: 90 },
      { at: now - 60_000, status: "degraded" as const, latencyMs: 4000 },
    ];
    const bars = dailyBars(samples, 90, now);
    expect(bars).toHaveLength(90);
    expect(bars.slice(0, 89).every((b) => b.uptimePct === null)).toBe(true);
    expect(bars[89]).toMatchObject({ uptimePct: 75, worst: "down", samples: 4 });
    expect(bars[0]!.date).toBe(new Date(now - 89 * DAY).toISOString().slice(0, 10));
  });

  it("derives incidents from contiguous failing samples", () => {
    const s = (m: number, status: "up" | "down" | "degraded") => ({ at: m * 60_000, status, latencyMs: null });
    const inc = deriveIncidents("x", "X", [s(1, "up"), s(2, "down"), s(3, "degraded"), s(4, "up"), s(5, "down")]);
    expect(inc).toHaveLength(2);
    expect(inc[0]).toMatchObject({ status: "down", startedAt: 120_000, endedAt: 240_000, samples: 2 });
    expect(inc[1]).toMatchObject({ endedAt: null, samples: 1 });
  });
});

describe("glossary", () => {
  it("has 60+ plain-language terms incl. the jargon other modules use", () => {
    expect(Object.keys(GLOSSARY).length).toBeGreaterThanOrEqual(60);
    for (const t of ["ec", "dS/m", "SPI", "NDVI", "GloFAS", "ERA5", "return period", "AUC", "Brier score", "basis risk", "burning cost", "PD", "LGD", "EAD", "PML", "lead time", "ensemble", "CMIP6", "SSP", "composite score", "value-at-risk"]) {
      expect(lookupTerm(t), t).not.toBeNull();
    }
    for (const e of Object.values(GLOSSARY)) {
      expect(e.short.length).toBeLessThan(200);
      for (const r of e.related ?? []) expect(GLOSSARY[r], `related ${r}`).toBeDefined();
    }
  });

  it("search ranks title matches first", () => {
    expect(searchGlossary("salinity")[0]!.key).toBe("salinity");
    expect(searchGlossary("zzzz-nothing")).toHaveLength(0);
  });
});
