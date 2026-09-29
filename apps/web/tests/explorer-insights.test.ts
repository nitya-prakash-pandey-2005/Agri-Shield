import { describe, expect, it } from "vitest";
import { buildInsights } from "@/components/explorer/insights";
import type { ReportBundle } from "@/components/explorer/types";

function report(over: { p72?: number; rain?: number; ec30?: number; salApplicable?: boolean; tmax?: number; hi?: number; level?: string }) {
  const hourly = Array.from({ length: 72 }, (_, i) => ({ time: `2026-09-29T${String(i % 24).padStart(2, "0")}:00`, precipMm: (over.rain ?? 0) / 72, precipProb: 50, tempC: 30, soilMoisture: 0.3, humidity: 70, windKmh: 10 }));
  return {
    location: { lat: 22.7, lon: 90.35, name: "Testville", country: "BD", elevationM: 5, nearestDistrictId: null, nearestDistrictKm: null, inCoreCoverage: false },
    generatedAt: new Date().toISOString(),
    composite: { score: 70, level: over.level ?? "high", drivers: ["Heavy rain forecast (150 mm / 72h)"], summary: "" },
    hazards: {
      flood: { score: Math.round((over.p72 ?? 0) * 100), p24: 0, p48: 0, p72: over.p72 ?? 0, depthM: 0.5, ci: [0, 1], factors: [], model: "t" },
      salinity: { score: 0, ecNow: 1, ec7d: 1, ec30d: over.ec30 ?? 1, class: "x", cropDamageProb: 0.4, applicable: over.salApplicable ?? false, model: "t" },
      drought: { score: 0, rain7dForecastMm: 10, et0_7dMm: 10, waterBalance7dMm: 0, model: "t" },
      heat: { score: 0, maxTempC: over.tmax ?? 30, hotDays: 0, model: "t", heatIndexMaxC: over.hi ?? 32, wetBulbMaxC: 24 },
    },
    forecast: { hourly, daily: [] },
    river: null,
    hazardsNearby: [],
    sources: [],
    extras: {},
  } as unknown as ReportBundle["report"];
}

describe("plain-language insights", () => {
  it("flood + farm → act-now protective action", () => {
    const i = buildInsights({ report: report({ p72: 0.72, rain: 150 }), climate: null, outlook: null }, "farm", "rice");
    expect(i.headline).toMatch(/^Act now/);
    expect(i.meaning[0]).toMatch(/72%/);
    expect(i.actions[0]!.urgency).toBe("now");
    expect(i.actions[0]!.title).toMatch(/rice/);
  });
  it("tailors the same hazard to a warehouse and to a loan book", () => {
    const wh = buildInsights({ report: report({ p72: 0.72, rain: 150 }), climate: null, outlook: null }, "warehouse", "rice");
    expect(wh.actions[0]!.title).toBe("Flood-proof the site");
    const loan = buildInsights({ report: report({ p72: 0.72, rain: 150 }), climate: null, outlook: null }, "loan", "rice");
    expect(loan.actions[0]!.detail).toMatch(/moratorium/);
  });
  it("salinity uses the crop threshold (rice 3 dS/m vs barley 8 dS/m)", () => {
    const rice = buildInsights({ report: report({ ec30: 5, salApplicable: true, level: "medium" }), climate: null, outlook: null }, "farm", "rice");
    expect(rice.actions.some((a) => a.hazard === "salinity")).toBe(true);
    const barley = buildInsights({ report: report({ ec30: 5, salApplicable: true, level: "medium" }), climate: null, outlook: null }, "farm", "barley");
    expect(barley.actions.some((a) => a.hazard === "salinity")).toBe(false);
  });
  it("calm conditions → no action needed", () => {
    const i = buildInsights({ report: report({ level: "low" }), climate: null, outlook: null }, "farm", "rice");
    expect(i.headline).toMatch(/^Low risk/);
    expect(i.actions).toHaveLength(1);
    expect(i.actions[0]!.hazard).toBe("general");
  });
});
