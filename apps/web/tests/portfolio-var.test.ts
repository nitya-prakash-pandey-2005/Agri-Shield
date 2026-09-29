/**
 * Value-at-risk maths + store-backed portfolio service flows (offline:
 * the location engine falls back to district baselines, no network).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetStore, getStore } from "@/server/data/store";
import { outbox } from "@/server/notify/channels";
import { bus, type RealtimeEnvelope } from "@/server/realtime";
import {
  MEAN_DAMAGE_RATIO,
  change7d,
  commitImport,
  createAsset,
  damageFactor,
  dispatchFiring,
  evaluateWorkspaceRules,
  hazardWeights,
  isoWeekKey,
  portfolioSummary,
  portfolioVaR,
  previewImport,
  rescoreWorkspace,
  ruleFirings,
  sendWeeklyDigest,
  valueAtRisk,
  valueAtRiskByHazard,
  workspaceAssets,
  PortfolioError,
} from "@/server/services/portfolio";
import { evaluateRule } from "@/server/services/rules";
import { listNotifications, markAllRead, markRead, notifyWorkspace, unreadCount } from "@/server/services/workspace-notifications";

describe("value-at-risk formula", () => {
  it("hazard weights are score shares (equal when all zero)", () => {
    expect(hazardWeights({ composite: 50, flood: 60, salinity: 20, drought: 20, heat: 0 })).toEqual({ flood: 0.6, salinity: 0.2, drought: 0.2, heat: 0 });
    expect(hazardWeights({ composite: 0, flood: 0, salinity: 0, drought: 0, heat: 0 })).toEqual({ flood: 0.25, salinity: 0.25, drought: 0.25, heat: 0.25 });
  });

  it("VaR = value × composite/100 × Σ wₕ·MDRₕ", () => {
    const s = { composite: 80, flood: 60, salinity: 20, drought: 20, heat: 0 };
    const mdr = 0.6 * MEAN_DAMAGE_RATIO.flood + 0.2 * MEAN_DAMAGE_RATIO.salinity + 0.2 * MEAN_DAMAGE_RATIO.drought;
    expect(damageFactor(s)).toBeCloseTo(0.8 * mdr, 10);
    expect(valueAtRisk(10_000, s)).toBeCloseTo(10_000 * 0.8 * mdr, 6);
  });

  it("pure-flood asset at composite 100 loses exactly the flood MDR", () => {
    expect(valueAtRisk(1000, { composite: 100, flood: 100, salinity: 0, drought: 0, heat: 0 })).toBeCloseTo(450);
  });

  it("zero composite, zero or negative value → zero VaR; composite is clamped", () => {
    expect(valueAtRisk(1000, { composite: 0, flood: 90, salinity: 0, drought: 0, heat: 0 })).toBe(0);
    expect(valueAtRisk(-5, { composite: 90, flood: 90, salinity: 0, drought: 0, heat: 0 })).toBe(0);
    expect(damageFactor({ composite: 150, flood: 100, salinity: 0, drought: 0, heat: 0 })).toBeCloseTo(0.45);
  });

  it("hazard split sums to the total and the portfolio aggregates", () => {
    const s = { composite: 64, flood: 40, salinity: 30, drought: 20, heat: 10 };
    const parts = valueAtRiskByHazard(5000, s);
    expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBeCloseTo(valueAtRisk(5000, s), 8);
    const p = portfolioVaR([
      { valueUsd: 5000, scores: s },
      { valueUsd: 1000, scores: { composite: 100, flood: 100, salinity: 0, drought: 0, heat: 0 } },
    ]);
    expect(p.exposure).toBe(6000);
    expect(p.total).toBeCloseTo(valueAtRisk(5000, s) + 450, 6);
    expect(p.byHazard.flood).toBeCloseTo(parts.flood + 450, 6);
    expect(p.ratio).toBeCloseTo(p.total / 6000);
  });
});

describe("portfolio service (store-backed, offline)", () => {
  const WS = "org-ins-deltamutual";
  const user = { id: "user-insurer-demo", name: "Arif Rahman" };
  beforeEach(() => {
    resetStore();
    outbox.length = 0;
  });

  it("summary before any live score uses district baselines and is internally consistent", () => {
    const s = portfolioSummary(WS);
    expect(s.counts.assets).toBe(140);
    expect(s.counts.baseline).toBe(140);
    expect(s.byLevel.low + s.byLevel.medium + s.byLevel.high + s.byLevel.critical).toBe(140);
    expect(s.histogram.reduce((t, b) => t + b.count, 0)).toBe(140);
    expect(s.kpis.valueAtRiskUsd).toBeLessThanOrEqual(s.kpis.totalExposureUsd * 0.45 + 1);
    expect(s.hazardMix.reduce((t, h) => t + h.varUsd, 0)).toBeGreaterThan(s.kpis.valueAtRiskUsd - 5);
    expect(s.topMovers.length).toBe(10);
    expect(Math.abs(s.topMovers[0]!.change)).toBeGreaterThanOrEqual(Math.abs(s.topMovers[9]!.change));
    expect(s.trend.length).toBe(30);
    expect(s.concentration.byDistrict.reduce((t, d) => t + d.share, 0)).toBeLessThanOrEqual(100.5);
  });

  it("change7d compares with the history entry 7 days ago", () => {
    const a = workspaceAssets(WS)[0]!;
    const today = new Date("2026-09-29T10:00:00Z");
    a.history = [
      { date: "2026-09-20", composite: 30 },
      { date: "2026-09-22", composite: 40 },
      { date: "2026-09-25", composite: 50 },
    ];
    expect(change7d(a, 55, today)).toBe(15);
    a.history = [];
    expect(change7d(a, 55, today)).toBeNull();
  });

  it("rescore with the live feed down keeps last known scores (no fallback overwrite) and publishes realtime", async () => {
    const events: RealtimeEnvelope[] = [];
    const on = (e: RealtimeEnvelope) => events.push(e);
    bus.on("event", on);
    const ids = workspaceAssets(WS).slice(0, 3).map((a) => a.id);
    const before = getStore().assets.find((x) => x.id === ids[0])!.history.length;
    const r = await rescoreWorkspace(WS, { assetIds: ids });
    bus.off("event", on);
    expect(r.count).toBe(3);
    expect(r.fallback).toBe(3);
    expect(r.live).toBe(0);
    expect(r.cells).toBeLessThanOrEqual(3);
    const a = getStore().assets.find((x) => x.id === ids[0])!;
    expect(a.lastAssessment).toBeNull();
    expect(a.history.length).toBe(before);
    expect(events.some((e) => e.room === `ws:${WS}` && (e.event as { type: string }).type === "portfolio.rescored")).toBe(true);
  });

  it("createAsset validates, dedupes and scores", async () => {
    await expect(createAsset(WS, user, { name: "x", type: "farm", lat: 0, lon: 0 })).rejects.toBeInstanceOf(PortfolioError);
    const a = await createAsset(WS, user, { name: "Test plot", type: "insured_plot", lat: 22.55, lon: 89.95, valueUsd: 3000, tags: ["Pilot"] });
    expect(a.tags).toEqual(["pilot"]);
    expect(a.country).toBeTruthy();
    expect(a.districtId === null || typeof a.districtId === "string").toBe(true);
    await expect(createAsset(WS, user, { name: "Test plot", type: "insured_plot", lat: 22.5501, lon: 89.9501 })).rejects.toThrow(/duplicate/i);
  });

  it("import preview flags workspace duplicates; commit creates and skips", async () => {
    const existing = workspaceAssets(WS)[0]!;
    const csv = `name,lat,lon,value,ref\nNew A,21.9,89.6,1000,NEW-1\n${existing.name},${existing.lat},${existing.lon},5,\nBroken,999,1,1,`;
    const prev = previewImport(WS, csv, "auto");
    expect(prev.duplicatesInWorkspace).toHaveLength(1);
    expect(prev.errorCount).toBe(1);
    const res = await commitImport(WS, user, csv, { format: "auto", extraTags: ["batch-1"] });
    expect(res.created).toHaveLength(1);
    expect(res.skipped.map((s) => s.row).sort()).toEqual([2, 3]);
    const created = getStore().assets.find((a) => a.id === res.created[0])!;
    expect(created.tags).toContain("batch-1");
    expect(created.type).toBe("insured_plot"); // industry default for an insurer
  });

  it("rules fire → in-app notification + e-mail outbox + history, then cooldown blocks a repeat", async () => {
    const rule = getStore().alertRules.find((r) => r.id === "rule_002")!; // coastal flood > 60
    rule.conditions = [{ metric: "composite", op: ">=", value: 0 }];
    rule.channels = ["app", "email", "webhook"];
    rule.webhookUrl = null;
    rule.lastTriggeredAt = null;
    const before = unreadCount(WS, "user-insurer-demo");
    const out = await evaluateWorkspaceRules(WS, { ruleIds: ["rule_002"], trigger: "manual", by: "test" });
    expect(out[0]!.fired).toBe(true);
    expect(out[0]!.matchCount).toBeGreaterThan(0);
    expect(unreadCount(WS, "user-insurer-demo")).toBe(before + 1);
    expect(outbox.filter((m) => m.channel === "email").map((m) => m.to).sort()).toEqual(["claims@demo.agrishield.io", "insurer@demo.agrishield.io"]);
    const f = ruleFirings(WS, { ruleId: "rule_002" })[0]!;
    expect(f.deliveries.find((d) => d.channel === "webhook")!.status).toBe("skipped");
    expect(rule.triggerCount).toBe(3);
    const again = await evaluateWorkspaceRules(WS, { ruleIds: ["rule_002"], trigger: "manual" });
    expect(again[0]!.blockedBy).toBe("cooldown");
  });

  it("automatic monitor runs ignore assets without a fresh live score (no alert storms on stale data)", async () => {
    const rule = getStore().alertRules.find((r) => r.id === "rule_002")!;
    rule.conditions = [{ metric: "composite", op: ">=", value: 0 }];
    rule.lastTriggeredAt = null;
    const out = await evaluateWorkspaceRules(WS, { ruleIds: ["rule_002"] });
    expect(out[0]!.fired).toBe(false);
    expect(out[0]!.blockedBy).toBe("no-match");
  });

  it("dispatch resolves SMS recipients to member phone numbers", async () => {
    const rule = getStore().alertRules.find((r) => r.id === "rule_005")!;
    rule.channels = ["sms"];
    rule.recipients = ["ngo@demo.agrishield.io", "+8801711000000"];
    const assets = workspaceAssets("org-ngo-brac");
    const ev = evaluateRule({ ...rule, conditions: [{ metric: "composite", op: ">=", value: 0 }] }, assets, new Map(assets.map((a) => [a.id, { flood_prob_72h: 1, flood_prob_24h: 1, salinity_ec: 1, composite: 50, rain_24h_mm: 1, rain_72h_mm: 1, drought_risk: 1, heat_risk: 1, river_discharge_ratio: 1 }])), { ignoreCooldown: true });
    const f = await dispatchFiring(rule, ev, "manual", "test");
    const sms = f.deliveries.filter((d) => d.channel === "sms");
    expect(sms.some((d) => d.to === "+8801711000000" && d.status === "simulated")).toBe(true);
  });

  it("notification read state is per user", () => {
    const n = notifyWorkspace({ workspaceId: WS, kind: "system", title: "Hello", body: "b", href: null, severity: "info" });
    const n2 = notifyWorkspace({ workspaceId: WS, userId: "user-insurer-analyst", kind: "team", title: "Only claims", body: "b", severity: "info" });
    expect(listNotifications(WS, "user-insurer-demo").items.some((x) => x.id === n2.id)).toBe(false);
    expect(markRead(WS, "user-insurer-demo", [n.id, n2.id])).toBe(1);
    expect(listNotifications(WS, "user-insurer-analyst").items.find((x) => x.id === n.id)!.read).toBe(false);
    markAllRead(WS, "user-insurer-analyst");
    expect(unreadCount(WS, "user-insurer-analyst")).toBe(0);
    expect(listNotifications("org-bank-mekong", "user-bank-demo").items.some((x) => x.id === n.id)).toBe(false);
  });

  it("critical notifications e-mail members by default", () => {
    notifyWorkspace({ workspaceId: "org-bank-mekong", kind: "rule", title: "Critical thing", body: "b", severity: "critical" });
    expect(outbox.filter((m) => m.channel === "email").map((m) => m.to).sort()).toEqual(["bank@demo.agrishield.io", "credit@demo.agrishield.io"]);
  });

  it("weekly digest sends once per ISO week", () => {
    expect(isoWeekKey(new Date("2026-09-28T00:00:00Z"))).toBe("2026-W40");
    expect(sendWeeklyDigest(WS)).toBe(true);
    expect(sendWeeklyDigest(WS)).toBe(false);
    expect(getStore().notifications[0]!.title).toMatch(/Weekly portfolio digest/);
  });
});
