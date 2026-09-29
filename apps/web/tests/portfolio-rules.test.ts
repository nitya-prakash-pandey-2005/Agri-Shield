/**
 * Alert-rule engine: scope, all/any matching, missing data, cooldown,
 * payload signing and formatting.
 */
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  compare,
  cooldownUntil,
  describeRule,
  evaluateConditions,
  evaluateRule,
  explainResults,
  inScope,
  isCoolingDown,
  signWebhook,
  slackMessage,
  smsText,
  snapshotFrom,
  webhookPayload,
  type MetricSnapshot,
} from "@/server/services/rules";

const snap = (over: Partial<MetricSnapshot> = {}): MetricSnapshot => ({
  flood_prob_72h: 20,
  flood_prob_24h: 10,
  salinity_ec: 1.5,
  composite: 30,
  rain_24h_mm: 5,
  rain_72h_mm: 12,
  drought_risk: 10,
  heat_risk: 5,
  river_discharge_ratio: 1.1,
  sensor_water_level_m: null,
  sensor_water_rise_6h_m: null,
  sensor_soil_ec: null,
  sensor_soil_moisture: null,
  ...over,
});

const assets = [
  { id: "a1", name: "Coastal plot", type: "insured_plot", tags: ["coastal", "parametric"], country: "Bangladesh", status: "active" },
  { id: "a2", name: "Inland plot", type: "insured_plot", tags: ["inland"], country: "Bangladesh", status: "active" },
  { id: "a3", name: "Rice loan", type: "loan", tags: ["rice"], country: "Vietnam", status: "active" },
  { id: "a4", name: "Archived plot", type: "insured_plot", tags: ["coastal"], country: "Bangladesh", status: "archived" },
];

const baseRule = {
  id: "r1",
  enabled: true,
  scope: {},
  conditions: [{ metric: "flood_prob_72h" as const, op: ">" as const, value: 60 }],
  match: "all" as const,
  lastTriggeredAt: null as Date | null,
  cooldownHours: 12,
};

describe("compare", () => {
  it("handles all operators including boundaries", () => {
    expect(compare(60, ">", 60)).toBe(false);
    expect(compare(60, ">=", 60)).toBe(true);
    expect(compare(59.9, "<", 60)).toBe(true);
    expect(compare(60, "<=", 60)).toBe(true);
  });
});

describe("scope", () => {
  it("empty scope matches every active asset, never archived", () => {
    expect(assets.filter((a) => inScope({}, a)).map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });
  it("tags are any-of and case-insensitive", () => {
    expect(assets.filter((a) => inScope({ tags: ["COASTAL", "rice"] }, a)).map((a) => a.id)).toEqual(["a1", "a3"]);
  });
  it("criteria combine with AND", () => {
    expect(assets.filter((a) => inScope({ tags: ["coastal", "rice"], types: ["loan"] }, a)).map((a) => a.id)).toEqual(["a3"]);
    expect(assets.filter((a) => inScope({ countries: ["bangladesh"], types: ["insured_plot"] }, a)).map((a) => a.id)).toEqual(["a1", "a2"]);
  });
  it("explicit asset ids restrict scope", () => {
    expect(assets.filter((a) => inScope({ assetIds: ["a2", "a4"] }, a)).map((a) => a.id)).toEqual(["a2"]);
  });
});

describe("conditions", () => {
  it("all = every condition must pass", () => {
    const rule = { match: "all" as const, conditions: [{ metric: "flood_prob_72h" as const, op: ">" as const, value: 50 }, { metric: "rain_72h_mm" as const, op: ">=" as const, value: 100 }] };
    expect(evaluateConditions(rule, snap({ flood_prob_72h: 70, rain_72h_mm: 90 })).matched).toBe(false);
    expect(evaluateConditions(rule, snap({ flood_prob_72h: 70, rain_72h_mm: 100 })).matched).toBe(true);
  });
  it("any = at least one condition", () => {
    const rule = { match: "any" as const, conditions: [{ metric: "salinity_ec" as const, op: ">" as const, value: 4 }, { metric: "heat_risk" as const, op: ">" as const, value: 50 }] };
    expect(evaluateConditions(rule, snap({ salinity_ec: 2, heat_risk: 70 })).matched).toBe(true);
    expect(evaluateConditions(rule, snap({ salinity_ec: 2, heat_risk: 10 })).matched).toBe(false);
  });
  it("missing metric never passes (below-threshold rules do not fire on no data)", () => {
    const rule = { match: "all" as const, conditions: [{ metric: "river_discharge_ratio" as const, op: "<" as const, value: 5 }] };
    const r = evaluateConditions(rule, snap({ river_discharge_ratio: null }));
    expect(r.matched).toBe(false);
    expect(r.results[0]!.actual).toBeNull();
  });
  it("a rule without conditions never matches", () => {
    expect(evaluateConditions({ match: "any", conditions: [] }, snap()).matched).toBe(false);
  });
});

describe("evaluateRule", () => {
  const snaps = new Map<string, MetricSnapshot>([
    ["a1", snap({ flood_prob_72h: 82 })],
    ["a2", snap({ flood_prob_72h: 65 })],
    ["a3", snap({ flood_prob_72h: 10 })],
    ["a4", snap({ flood_prob_72h: 99 })],
  ]);

  it("returns matches worst-first with a readable reason", () => {
    const ev = evaluateRule(baseRule, assets, snaps);
    expect(ev.inScope).toBe(3);
    expect(ev.matches.map((m) => m.assetId)).toEqual(["a1", "a2"]);
    expect(ev.matches[0]!.reason).toBe("Flood 72h 82% > 60%");
    expect(ev.fires).toBe(true);
    expect(ev.blockedBy).toBeNull();
  });

  it("accepts a plain object of snapshots and counts assets with data", () => {
    const ev = evaluateRule(baseRule, assets, { a1: snaps.get("a1")! });
    expect(ev.withData).toBe(1);
    expect(ev.matches).toHaveLength(1);
  });

  it("respects the cooldown window", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    const recent = { ...baseRule, lastTriggeredAt: new Date("2026-09-29T06:00:00Z") };
    const ev = evaluateRule(recent, assets, snaps, { now });
    expect(ev.fires).toBe(false);
    expect(ev.blockedBy).toBe("cooldown");
    expect(ev.matches).toHaveLength(2);
    expect(cooldownUntil(recent)!.toISOString()).toBe("2026-09-29T18:00:00.000Z");
    expect(isCoolingDown(recent, new Date("2026-09-29T18:00:01Z"))).toBe(false);
    expect(evaluateRule(recent, assets, snaps, { now, ignoreCooldown: true }).fires).toBe(true);
  });

  it("zero cooldown never blocks", () => {
    expect(isCoolingDown({ lastTriggeredAt: new Date(), cooldownHours: 0 })).toBe(false);
  });

  it("disabled rules report blockedBy=disabled unless ignoreEnabled", () => {
    const off = { ...baseRule, enabled: false };
    expect(evaluateRule(off, assets, snaps).blockedBy).toBe("disabled");
    expect(evaluateRule(off, assets, snaps, { ignoreEnabled: true }).fires).toBe(true);
  });

  it("no-match when nothing crosses the threshold", () => {
    const ev = evaluateRule({ ...baseRule, conditions: [{ metric: "flood_prob_72h", op: ">", value: 95 }] }, assets, snaps);
    expect(ev.blockedBy).toBe("no-match");
    expect(ev.fires).toBe(false);
  });

  it("below-threshold rules sort lowest first", () => {
    const ev = evaluateRule({ ...baseRule, conditions: [{ metric: "flood_prob_72h", op: "<", value: 90 }] }, assets, snaps);
    expect(ev.matches.map((m) => m.assetId)).toEqual(["a3", "a2", "a1"]);
  });
});

describe("snapshotFrom", () => {
  it("maps a quick assessment (24h probability to %, fallback rain → null)", () => {
    const q = { floodRisk: 64, floodProb24h: 0.315, salinityRisk: 40, salinityEc: 3.6, droughtRisk: 12, heatRisk: 3, composite: 70, rain24hMm: 40, rain72hMm: 130, dischargeRatio: 1.8, source: "open-meteo" };
    const s = snapshotFrom(q, null);
    expect(s.flood_prob_24h).toBe(31.5);
    expect(s.rain_72h_mm).toBe(130);
    expect(snapshotFrom({ ...q, source: "fallback" }, null).rain_72h_mm).toBeNull();
  });
  it("derives EC from the stored salinity score when only an assessment exists", () => {
    const s = snapshotFrom(null, { floodRisk: 50, salinityRisk: 50, droughtRisk: 0, heatRisk: 0, composite: 55 });
    expect(s.salinity_ec).toBe(4.5);
    expect(s.rain_24h_mm).toBeNull();
  });
});

describe("payloads", () => {
  const p = webhookPayload({
    firingId: "fire_1",
    workspaceId: "org-x",
    rule: { id: "r1", name: "Flood watch", severity: "critical", description: "d" },
    firedAt: "2026-09-29T00:00:00Z",
    matchCount: 12,
    matches: Array.from({ length: 12 }, (_, i) => ({ assetId: `a${i}`, name: `Plot ${i}`, reason: "Flood 72h 80% > 60%", metrics: { flood_prob_72h: 80 } })),
    link: "https://app/x",
  });

  it("signs the raw body with HMAC-SHA256", () => {
    const body = JSON.stringify(p);
    expect(signWebhook("whsec_test", body)).toBe(`sha256=${createHmac("sha256", "whsec_test").update(body).digest("hex")}`);
  });
  it("builds a Slack Block Kit message capped at 8 lines", () => {
    const m = slackMessage(p);
    expect(m.text).toContain("Flood watch");
    const list = (m.blocks[2] as { text: { text: string } }).text.text;
    expect(list.split("\n")).toHaveLength(9);
    expect(list).toContain("and 4 more");
  });
  it("keeps SMS short", () => {
    expect(smsText(p).length).toBeLessThanOrEqual(320);
    expect(smsText(p)).toContain("CRITICAL");
  });
  it("describes rules in plain language", () => {
    const text = describeRule({ conditions: [{ metric: "rain_72h_mm", op: ">=", value: 150 }, { metric: "flood_prob_72h", op: ">", value: 50 }], match: "any", scope: { tags: ["parametric"] }, channels: ["app", "email"], cooldownHours: 12 });
    expect(text).toBe("If rain forecast (next 72 h) is at least 150 mm OR flood probability (next 72 h) is above 50% for assets tagged parametric, notify via app, email (then wait 12 h before repeating).");
    expect(explainResults([{ metric: "salinity_ec", op: ">", value: 3, actual: 4.25, pass: true }])).toBe("Salinity 4.3 dS/m > 3.0 dS/m");
  });
});

describe("sensor ground-truth metrics", () => {
  it("fires on a gauge rise only when a fresh sensor reading exists", () => {
    const rule = { conditions: [{ metric: "sensor_water_rise_6h_m" as const, op: ">=" as const, value: 0.5 }], match: "all" as const };
    expect(evaluateConditions(rule, snap({ sensor_water_rise_6h_m: 0.8 })).matched).toBe(true);
    expect(evaluateConditions(rule, snap({ sensor_water_rise_6h_m: 0.2 })).matched).toBe(false);
    // no sensor linked / stale / faulty → null → never fires
    expect(evaluateConditions(rule, snap()).matched).toBe(false);
  });

  it("snapshots built from forecasts leave sensor metrics empty", () => {
    const s = snapshotFrom(null, { floodRisk: 50, salinityRisk: 20, droughtRisk: 10, heatRisk: 5, composite: 55 });
    expect(s.sensor_soil_ec).toBeNull();
    expect(s.sensor_water_level_m).toBeNull();
  });
});
