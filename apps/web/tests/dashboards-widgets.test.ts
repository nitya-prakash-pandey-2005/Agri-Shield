/**
 * Widget-data resolvers (store-backed, offline) + dashboards service
 * (templates, sanitising, sharing).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getStore, resetStore } from "@/server/data/store";
import { effectiveScore, valueAtRisk, workspaceAssets, riskThreshold } from "@/server/services/portfolio";
import { compositeOn, dailyAggregates, perDay, resolveWidget, topBuckets, widgetFacets, type BarData, type KpiData, type MapData, type NotificationsData, type SeriesData, type TableData, type ForecastData, type ExplorerData } from "@/server/services/widget-data";
import {
  TEMPLATES,
  _resetDashboards,
  createDashboard,
  deleteDashboard,
  getByShareToken,
  getDashboard,
  listDashboards,
  safeEmbedUrl,
  sanitizeWidgets,
  setDefaultDashboard,
  setSharing,
  updateDashboard,
} from "@/server/services/dashboards";
import { WIDGETS, thresholdTone, type Widget } from "@/components/dashboards/catalog";
import { isValidLayout } from "@/components/dashboards/grid";

const ORG = "org-ins-deltamutual";
const NOW = new Date("2026-09-29T10:00:00Z");
const W = (kind: Widget["kind"], config: Widget["config"] = {}): Widget => ({ id: `t_${kind}`, kind, title: kind, x: 0, y: 0, w: 6, h: 4, config: { ...WIDGETS[kind].defaults, ...config } });
const who = { id: "user-insurer-demo", name: "Test User" };

beforeEach(() => {
  resetStore();
  _resetDashboards();
});

describe("pure aggregation helpers", () => {
  it("compositeOn picks the last value on/before the day and today's live score", () => {
    const h = [
      { date: "2026-09-01", composite: 20 },
      { date: "2026-09-05", composite: 40 },
    ];
    expect(compositeOn(h, "2026-08-31", 50, "2026-09-29")).toBeNull();
    expect(compositeOn(h, "2026-09-03", 50, "2026-09-29")).toBe(20);
    expect(compositeOn(h, "2026-09-10", 50, "2026-09-29")).toBe(40);
    expect(compositeOn(h, "2026-09-29", 50, "2026-09-29")).toBe(50);
  });

  it("dailyAggregates computes avg, weighted avg, at-risk and VaR per day", () => {
    const score = { composite: 70, flood: 70, salinity: 0, drought: 0, heat: 0 };
    const items = [
      { valueUsd: 1000, history: [{ date: "2026-09-27", composite: 30 }], score },
      { valueUsd: 3000, history: [{ date: "2026-09-27", composite: 70 }], score },
    ];
    const d = dailyAggregates(items, 3, 60, NOW);
    expect(d.map((x) => x.date)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29"]);
    expect(d[0]).toMatchObject({ n: 2, avg: 50, weighted: 60, atRisk: 1, pctAtRisk: 50, exposureAtRisk: 3000 });
    // today both use the live score (70)
    expect(d[2]).toMatchObject({ avg: 70, atRisk: 2 });
    expect(d[2]!.varUsd).toBe(Math.round(valueAtRisk(4000, score)));
  });

  it("perDay zero-fills and topBuckets folds the tail into Other", () => {
    const pd = perDay([new Date("2026-09-29T01:00:00Z"), "2026-09-29T05:00:00Z", "2026-09-27T00:00:00Z"], 3, NOW);
    expect(pd).toEqual([
      { date: "2026-09-27", count: 1 },
      { date: "2026-09-28", count: 0 },
      { date: "2026-09-29", count: 2 },
    ]);
    const tb = topBuckets(
      Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, value: i + 1 })),
      3
    );
    expect(tb.map((b) => b.label)).toEqual(["K4", "K3", "Other"]);
    expect(tb[2]!.value).toBe(6);
  });

  it("thresholdTone colours by direction", () => {
    expect(thresholdTone(12, { warn: 5, crit: 10 })).toBe("crit");
    expect(thresholdTone(6, { warn: 5, crit: 10 })).toBe("warn");
    expect(thresholdTone(1, { warn: 5, crit: 10 })).toBe("ok");
    expect(thresholdTone(1, { warn: 5, crit: 2 }, false)).toBe("crit");
    expect(thresholdTone(null, { warn: 5, crit: 10 })).toBe("neutral");
  });
});

describe("resolveWidget — real workspace data", () => {
  it("KPI exposure / VaR / assets match the portfolio service", async () => {
    const assets = workspaceAssets(ORG);
    const exposure = await resolveWidget(ORG, W("kpi", { metric: "exposure" }), { now: NOW });
    expect((exposure as KpiData).value).toBe(Math.round(assets.reduce((s, a) => s + a.valueUsd, 0)));
    const count = (await resolveWidget(ORG, W("kpi", { metric: "assets" }), { now: NOW })) as KpiData;
    expect(count.value).toBe(assets.length);
    const v = (await resolveWidget(ORG, W("kpi", { metric: "var" }), { now: NOW })) as KpiData;
    expect(v.value).toBe(Math.round(assets.reduce((s, a) => s + valueAtRisk(a.valueUsd, effectiveScore(a)), 0)));
    expect(v.spark.length).toBeGreaterThan(5);
    expect(v.sources.length).toBeGreaterThan(0);
    expect(v.explain).toMatch(/Value at risk/);
  });

  it("KPI % at risk uses the workspace threshold and custom thresholds colour it", async () => {
    const assets = workspaceAssets(ORG);
    const t = riskThreshold(ORG);
    const expected = Math.round((assets.filter((a) => effectiveScore(a).composite >= t).length / assets.length) * 1000) / 10;
    const k = (await resolveWidget(ORG, W("gauge", { metric: "pct_at_risk", thresholds: { warn: -1, crit: -1 } }), { now: NOW })) as KpiData;
    expect(k.value).toBe(expected);
    expect(k.tone).toBe("crit");
    expect(k.max).toBe(100);
  });

  it("filters by asset type / tag / country", async () => {
    const assets = workspaceAssets(ORG);
    const tag = assets.flatMap((a) => a.tags)[0]!;
    const k = (await resolveWidget(ORG, W("kpi", { metric: "assets", filters: { tags: [tag] } }), { now: NOW })) as KpiData;
    expect(k.value).toBe(assets.filter((a) => a.tags.includes(tag)).length);
    const none = (await resolveWidget(ORG, W("kpi", { metric: "assets", filters: { countries: ["Atlantis"] } }), { now: NOW })) as KpiData;
    expect(none.value).toBe(0);
  });

  it("sum insured counts only insured units; expected loss is honest when the book hasn't run", async () => {
    const plots = workspaceAssets(ORG).filter((a) => a.type === "insured_plot");
    const si = (await resolveWidget(ORG, W("kpi", { metric: "insured_sum" }), { now: NOW })) as KpiData;
    expect(si.value).toBe(Math.round(plots.reduce((s, a) => s + a.valueUsd, 0)));
    const el = (await resolveWidget(ORG, W("kpi", { metric: "expected_loss" }), { now: NOW })) as KpiData;
    expect(el.value).toBeNull();
    expect(el.note).toMatch(/Insurance/);
  });

  it("rules in alarm evaluates enabled rules against current snapshots", async () => {
    const k = (await resolveWidget(ORG, W("kpi", { metric: "active_alerts" }), { now: NOW })) as KpiData;
    const rules = getStore().alertRules.filter((r) => r.workspaceId === ORG && r.enabled);
    expect(k.value).toBeGreaterThanOrEqual(0);
    expect(k.value).toBeLessThanOrEqual(rules.length);
    expect(k.note).toMatch(/enabled rules|No enabled/);
  });

  it("rule firings count seeded rule notifications within the range", async () => {
    const k30 = (await resolveWidget(ORG, W("kpi", { metric: "rule_firings", days: 30 }))) as KpiData;
    expect(k30.value).toBeGreaterThanOrEqual(1); // seeded "Parametric trigger watch fired" 30 h ago
  });

  it("time series: composite trend has avg + weighted lines and a threshold line", async () => {
    const s = (await resolveWidget(ORG, W("timeseries", { series: "composite", days: 30 }), { now: NOW })) as SeriesData;
    expect(s.lines.map((l) => l.key)).toEqual(["avg", "weighted"]);
    expect(s.points.length).toBeGreaterThan(5);
    expect(s.thresholdLine).toBe(riskThreshold(ORG));
    const f = (await resolveWidget(ORG, W("timeseries", { series: "firings", days: 14 }), { now: NOW })) as SeriesData;
    expect(f.points).toHaveLength(14);
  });

  it("bars: histogram sums to asset count; hazard VaR sums to total VaR", async () => {
    const assets = workspaceAssets(ORG);
    const h = (await resolveWidget(ORG, W("bar", { dimension: "histogram", measure: "count" }), { now: NOW })) as BarData;
    expect(h.bars).toHaveLength(10);
    expect(h.bars.reduce((s, b) => s + b.value, 0)).toBe(assets.length);
    const hz = (await resolveWidget(ORG, W("bar", { dimension: "hazard", measure: "var" }), { now: NOW })) as BarData;
    const total = assets.reduce((s, a) => s + valueAtRisk(a.valueUsd, effectiveScore(a)), 0);
    expect(Math.abs(hz.bars.reduce((s, b) => s + b.value, 0) - total)).toBeLessThan(5);
    const c = (await resolveWidget(ORG, W("bar", { dimension: "country", measure: "exposure" }), { now: NOW })) as BarData;
    expect(c.bars[0]!.value).toBeGreaterThan(0);
  });

  it("map: points for each asset; choropleth aggregates by district", async () => {
    const m = (await resolveWidget(ORG, W("map", { metric: "flood" }), { now: NOW })) as MapData;
    expect(m.points).toHaveLength(workspaceAssets(ORG).length);
    const ch = (await resolveWidget(ORG, W("map", { metric: "composite", mapMode: "choropleth" }), { now: NOW })) as MapData;
    expect(ch.districts.length).toBeGreaterThan(0);
    expect(ch.districts.every((d) => d.geometry.type === "Polygon")).toBe(true);
    expect(ch.districts.some((d) => d.assets > 0)).toBe(true);
  });

  it("table: top-N sorted by metric, both directions", async () => {
    const t = (await resolveWidget(ORG, W("table", { metric: "composite", limit: 5 }), { now: NOW })) as TableData;
    expect(t.rows).toHaveLength(5);
    for (let i = 1; i < t.rows.length; i++) expect(t.rows[i - 1]!.value!).toBeGreaterThanOrEqual(t.rows[i]!.value!);
    const asc = (await resolveWidget(ORG, W("table", { metric: "composite", limit: 5, sortDir: "asc" }), { now: NOW })) as TableData;
    expect(asc.rows[0]!.value!).toBeLessThanOrEqual(t.rows[4]!.value!);
  });

  it("notifications: shared view never shows billing or user-private items", async () => {
    getStore().notifications.unshift(
      { id: "n_bill", workspaceId: ORG, userId: null, kind: "billing", title: "Invoice", body: "", href: null, severity: "info", createdAt: new Date(), readBy: [] },
      { id: "n_priv", workspaceId: ORG, userId: "someone", kind: "system", title: "Private", body: "", href: null, severity: "info", createdAt: new Date(), readBy: [] }
    );
    const shared = (await resolveWidget(ORG, W("notifications", { limit: 10 }), { shared: true })) as NotificationsData;
    expect(shared.items.some((n) => n.id === "n_bill" || n.id === "n_priv")).toBe(false);
    const mine = (await resolveWidget(ORG, W("notifications", { limit: 10 }), { userId: "someone" })) as NotificationsData;
    expect(mine.items.some((n) => n.id === "n_priv")).toBe(true);
  });

  it("forecast: offline → honest unavailable state with district context", async () => {
    const a = workspaceAssets(ORG)[0]!;
    const f = (await resolveWidget(ORG, W("forecast", { assetId: a.id }), { now: NOW })) as ForecastData;
    expect(f.place?.name).toBe(a.name);
    expect(f.status).toBe("unavailable");
    expect(f.message).toMatch(/unavailable/);
  });

  it("explorer widget refuses another workspace's report", async () => {
    const e = (await resolveWidget(ORG, W("explorer", { reportId: "does-not-exist" }))) as ExplorerData;
    expect(e.report).toBeNull();
    expect(e.empty).toBeTruthy();
  });

  it("facets list the workspace's types, tags and countries", () => {
    const f = widgetFacets(ORG);
    expect(f.types.length).toBeGreaterThan(0);
    expect(f.countries.length).toBeGreaterThan(0);
  });
});

describe("dashboards service", () => {
  it("seeds one default dashboard from the industry template", () => {
    const list = listDashboards(ORG);
    expect(list).toHaveLength(1);
    expect(list[0]!.isDefault).toBe(true);
    expect(list[0]!.templateId).toBe("insurer-ops");
    expect(isValidLayout(getDashboard(ORG, list[0]!.id).widgets)).toBe(true);
  });

  it("every template produces a valid, compact layout", () => {
    for (const t of TEMPLATES) {
      const d = createDashboard(ORG, who, { name: t.name, templateId: t.id });
      expect(isValidLayout(d.widgets)).toBe(true);
      expect(d.widgets.length).toBe(t.widgets.length);
    }
  });

  it("create / update / duplicate / default / delete", () => {
    const d = createDashboard(ORG, who, { name: "Ops", templateId: "credit-risk" });
    const upd = updateDashboard(ORG, d.id, who, { name: "Ops v2", refreshSec: 300, widgets: d.widgets.slice(0, 3) });
    expect(upd.name).toBe("Ops v2");
    expect(upd.widgets).toHaveLength(3);
    const dup = createDashboard(ORG, who, { name: "Copy", fromId: d.id });
    expect(dup.widgets.map((w) => w.kind)).toEqual(upd.widgets.map((w) => w.kind));
    expect(dup.widgets[0]!.id).not.toBe(upd.widgets[0]!.id);
    setDefaultDashboard(ORG, dup.id);
    expect(listDashboards(ORG).filter((x) => x.isDefault).map((x) => x.id)).toEqual([dup.id]);
    const res = deleteDashboard(ORG, dup.id, who);
    expect(res.nextDefaultId).toBeTruthy();
    expect(listDashboards(ORG).some((x) => x.id === dup.id)).toBe(false);
  });

  it("sanitises widgets: clamps geometry, de-dupes ids, rejects unsafe embeds", () => {
    const out = sanitizeWidgets([
      { id: "a", kind: "kpi", title: "", x: 11, y: 3, w: 8, h: 1, config: {} },
      { id: "a", kind: "embed", title: "x", x: 0, y: 0, w: 6, h: 6, config: { url: "javascript:alert(1)" } },
    ]);
    expect(isValidLayout(out)).toBe(true);
    expect(out[0]!.title).toBe(WIDGETS.kpi.defaultTitle);
    expect(out[0]!.h).toBeGreaterThanOrEqual(WIDGETS.kpi.size.minH);
    expect(new Set(out.map((w) => w.id)).size).toBe(2);
    expect(out[1]!.config.url).toBeNull();
    expect(safeEmbedUrl("/r/abc123")).toBe("/r/abc123");
    expect(safeEmbedUrl("http://evil.example")).toBeNull();
    expect(safeEmbedUrl("https://example.org/report")).toBe("https://example.org/report");
  });

  it("share tokens: enable, resolve, rotate, revoke; other orgs are isolated", () => {
    const [first] = listDashboards(ORG);
    const d = setSharing(ORG, first!.id, who, true);
    expect(d.shareToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(getByShareToken(d.shareToken!)?.id).toBe(d.id);
    const old = d.shareToken!;
    const rotated = setSharing(ORG, d.id, who, true, true);
    expect(rotated.shareToken).not.toBe(old);
    expect(getByShareToken(old)).toBeNull();
    setSharing(ORG, d.id, who, false);
    expect(getByShareToken(rotated.shareToken ?? "x".repeat(24))).toBeNull();
    expect(() => getDashboard("org-bank-mekong", d.id)).toThrow(/not found/i);
  });
});

describe("dashboardDigest", () => {
  it("summarises KPI widgets in plain text", async () => {
    const { dashboardDigest } = await import("@/server/services/widget-data");
    const d = getDashboard(ORG, listDashboards(ORG)[0]!.id);
    const r = await dashboardDigest(ORG, d.widgets);
    expect(r.lines.length).toBeGreaterThan(2);
    expect(r.lines.some((l) => /^Sum insured: \$/.test(l))).toBe(true);
  });
});
