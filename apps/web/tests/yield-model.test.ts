import { describe, expect, it } from "vitest";
import {
  aggregate,
  bands,
  baselineFor,
  cropParams,
  floodShareDamage,
  heatDegreeDays,
  heatLoss,
  kcAt,
  kySeasonal,
  kyYield,
  maasHoffman,
  ndviExpected,
  ndviFactor,
  olsAt,
  pickSeason,
  quantile,
  simulateWater,
  stageAt,
  yieldBook,
  type DayWx,
} from "@/server/services/yield-model";

const T = (s: string) => Date.parse(`${s}T12:00:00Z`);

describe("FAO-33 yield response to water (Ky)", () => {
  it("seasonal form: 1 − Ya/Ym = Ky (1 − ETa/ETm)", () => {
    // maize Ky 1.25, ETa 400 of ETm 500 mm → 1 − 1.25 × 0.2 = 0.75
    expect(kySeasonal(400, 500, 1.25)).toBeCloseTo(0.75, 10);
    expect(kySeasonal(500, 500, 1.25)).toBe(1);
    expect(kySeasonal(0, 500, 1.25)).toBe(0);
  });
  it("stage form multiplies stage responses (hand-computed)", () => {
    // maize: [100/100, 150/200, 200/250, 50/50] with Ky [0.4, 0.4, 1.3, 0.2] → 1 × 0.9 × 0.74 × 1 = 0.666
    expect(kyYield([100, 150, 200, 50], [100, 200, 250, 50], [0.4, 0.4, 1.3, 0.2])).toBeCloseTo(0.666, 10);
  });
  it("FAO-56 Kc curve for rice (1.05 → 1.20 → 0.75)", () => {
    const p = cropParams("rice")!;
    expect(kcAt(p, 0.1)).toBeCloseTo(1.05);
    expect(kcAt(p, 0.3)).toBeCloseTo(1.125); // halfway through development
    expect(kcAt(p, 0.5)).toBeCloseTo(1.2);
    expect(kcAt(p, 1)).toBeCloseTo(0.75);
    expect(stageAt(p, 0.1)).toBe(0);
    expect(stageAt(p, 0.7)).toBe(2);
    expect(stageAt(p, 0.95)).toBe(3);
  });
  it("water balance: no stress when wet, stress when dry, irrigation removes stress", () => {
    const maize = cropParams("maize")!;
    const wet: DayWx[] = Array.from({ length: 120 }, () => ({ rain: 10, et0: 4, tmax: 30 }));
    const dry: DayWx[] = Array.from({ length: 120 }, () => ({ rain: 0, et0: 5, tmax: 33 }));
    expect(simulateWater(wet, maize, 0, 0).relYield).toBeCloseTo(1, 6);
    const rf = simulateWater(dry, maize, 0, 0);
    expect(rf.relYield).toBeLessThan(0.3);
    expect(rf.stressDays).toBeGreaterThan(60);
    const irr = simulateWater(dry, maize, 1, 0);
    expect(irr.relYield).toBeGreaterThan(0.99);
    expect(irr.irrigationMm).toBeGreaterThan(400);
    // ETc = Σ Kc·ET0 is independent of water supply
    expect(irr.etcMm).toBeCloseTo(rf.etcMm, 6);
  });
  it("paddy loses 3 mm/day to percolation while ponded", () => {
    const rice = cropParams("rice")!;
    const w: DayWx[] = Array.from({ length: 100 }, () => ({ rain: 20, et0: 4, tmax: 30 }));
    const r = simulateWater(w, rice, 0, 0);
    expect(r.percolationMm).toBeCloseTo(300, 6);
    expect(r.relYield).toBe(1);
  });
});

describe("heat, salinity, flood, NDVI components", () => {
  it("heat degree-days above the anthesis threshold", () => {
    expect(heatDegreeDays([34, 36, 37.5, 33], 35)).toBeCloseTo(3.5);
    expect(heatLoss(10)).toBeCloseTo(1 - Math.exp(-0.2), 10);
    expect(heatLoss(0)).toBe(0);
  });
  it("Maas–Hoffman (FAO-29): rice a = 3 dS/m, b = 12 %", () => {
    expect(maasHoffman(5, 3, 12)).toBeCloseTo(0.76, 10);
    expect(maasHoffman(2, 3, 12)).toBe(1);
    expect(maasHoffman(20, 3, 12)).toBe(0);
  });
  it("flood share × damage uses the platform loss curves", () => {
    const f = floodShareDamage(1, 14);
    expect(f.share).toBeCloseTo(0.005 + 0.35 * (1 - Math.exp(-1 / 0.7)), 10);
    expect(f.damage).toBeCloseTo(0.2 + 0.6 * (1 - Math.exp(-1.25)) + 0.012 * 14, 10);
    // episode days capped at 21 (merged episodes are not continuous submergence)
    expect(floodShareDamage(1, 60).damage).toBeCloseTo(floodShareDamage(1, 21).damage, 12);
  });
  it("NDVI factor is neutral early in the season and capped", () => {
    const rice = cropParams("rice")!;
    expect(ndviExpected(rice, 0)).toBeCloseTo(0.25);
    expect(ndviExpected(rice, rice.ndvi.peakFrac)).toBeCloseTo(0.78);
    expect(ndviFactor(0.3, 0.6, 0.1, 1).factor).toBe(1);
    expect(ndviFactor(0.1, 0.7, 0.9, 1).factor).toBe(0.88);
  });
});

describe("baselines, calendars and statistics", () => {
  it("FAOSTAT normal × Odisha ratio (hand-computed)", () => {
    const b = baselineFor("IN", "rice", "kharif", 2026)!;
    const normal = ((4.059 + 4.203 + 4.239 + 4.314 + 4.313) / 5) * 0.778;
    expect(b.normalTHa).toBeCloseTo(normal, 2);
    expect(b.trendTHa / b.normalTHa).toBeLessThanOrEqual(1.08 + 1e-9);
    const aman = baselineFor("BD", "rice", "aman", 2026)!;
    expect(aman.seasonFactor).toBe(0.78);
  });
  it("OLS trend and quantiles", () => {
    expect(olsAt([1, 2, 3], [1, 2, 3], 5)).toBeCloseTo(5);
    expect(olsAt([1, 2, 3, 4], [2, null, 6, 8], 5)).toBeCloseTo(10);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([0, 10], 0.1)).toBeCloseTo(1);
  });
  it("crop calendar picks the season containing today, else the last harvested, else the next", () => {
    expect(pickSeason("IN", "rice", T("2026-09-29"))).toMatchObject({ id: "kharif", status: "in_season", sow: "2026-06-25" });
    expect(pickSeason("BD", "vegetables", T("2026-09-29"))).toMatchObject({ id: "kharif", status: "harvested" });
    expect(pickSeason("VN", "rice", T("2026-09-29"))).toMatchObject({ id: "autumn_winter", status: "in_season" });
    expect(pickSeason("BD", "rice", T("2026-02-10"))).toMatchObject({ id: "boro", status: "in_season", sowYear: 2025 });
    expect(pickSeason("ID", "rice", T("2026-12-20"))).toMatchObject({ id: "mt1", status: "in_season" });
  });
  it("bands widen with structural error", () => {
    const b0 = bands([1, 1, 1], 0);
    expect(b0.p10).toBe(1);
    expect(b0.p90).toBe(1);
    const b1 = bands([1, 1, 1], 0.1);
    expect(b1.p10).toBeLessThan(1);
    expect(b1.p90).toBeGreaterThan(1);
    expect(b1.p50).toBeCloseTo(1);
  });
});

describe("aggregation", () => {
  it("sums production member-by-member (coherent weather years)", () => {
    const rows = [
      { areaHa: 1, memberYield: [1, 2, 3], cv: 0, p50: 2, normal: 2, price: 100 },
      { areaHa: 2, memberYield: [2, 2, 2], cv: 0, p50: 2, normal: 2.5, price: 100 },
    ];
    const a = aggregate(rows);
    // totals per member: [1+4, 2+4, 3+4] = [5, 6, 7]
    expect(a.p50).toBe(6);
    expect(a.p10).toBeGreaterThanOrEqual(5);
    expect(a.p90).toBeLessThanOrEqual(7);
    expect(a.normal).toBe(Math.round(1 * 2 + 2 * 2.5));
    expect(a.area).toBe(3);
    expect(a.value).toBe(600);
  });
  it("portfolio book: every crop asset forecast with ordered bands and consistent totals", async () => {
    const b = await yieldBook("org-coop-odisha", { force: true, budgetMs: 1500 });
    expect(b.assets.length + b.skipped.length).toBe(90);
    for (const r of b.assets) {
      expect(r.forecast.yieldTHa.p10).toBeLessThanOrEqual(r.forecast.yieldTHa.p50);
      expect(r.forecast.yieldTHa.p50).toBeLessThanOrEqual(r.forecast.yieldTHa.p90);
      expect(r.productionT.p50).toBeCloseTo(r.forecast.yieldTHa.p50 * r.areaHa, 1);
    }
    const sumCrop = b.byCrop.reduce((a, g) => a + g.assets, 0);
    expect(sumCrop).toBe(b.assets.length);
    expect(b.totals.productionT.p10).toBeLessThanOrEqual(b.totals.productionT.p50);
    expect(b.totals.productionT.p50).toBeLessThanOrEqual(b.totals.productionT.p90);
    expect(b.evolution).toHaveLength(16);
    expect(b.districts.length).toBeGreaterThan(0);
  }, 60_000);
});
