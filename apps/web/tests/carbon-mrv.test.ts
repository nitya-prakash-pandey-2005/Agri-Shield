import { describe, expect, it } from "vitest";
import { carbonProgramme, creditRevenue, ef1For, n2oDirectKg, n2oIndirectKg, riceCh4Kg, seasonEmissions, sfo, tCo2e, ureaCo2Kg } from "@/server/services/carbon";
import { awdWaterSaving, waterFootprint } from "@/server/services/water-footprint";
import { getStore } from "@/server/data/store";

describe("IPCC 2019 Tier 1 rice methane (hand-computed)", () => {
  it("continuously flooded, 1 ha, 120 days: 1.19 × 120 = 142.8 kg CH4 = 3.8556 t CO2e", () => {
    const kg = riceCh4Kg({ efc: 1.19, sfw: 1, sfp: 1, sfo: 1, days: 120, areaHa: 1 });
    expect(kg).toBeCloseTo(142.8, 10);
    expect(tCo2e({ ch4Kg: kg })).toBeCloseTo(3.8556, 10);
  });
  it("AWD (multiple drainage 0.55) avoids 45 % → 1.73502 t CO2e/ha/season", () => {
    const base = riceCh4Kg({ efc: 1.19, sfw: 1, sfp: 1, sfo: 1, days: 120, areaHa: 1 });
    const awd = riceCh4Kg({ efc: 1.19, sfw: 0.55, sfp: 1, sfo: 1, days: 120, areaHa: 1 });
    expect(awd).toBeCloseTo(78.54, 10);
    expect(tCo2e({ ch4Kg: base - awd })).toBeCloseTo(1.73502, 10);
    // single drainage 0.71, 2.5 ha, 100 days, SF_p 0.89
    expect(riceCh4Kg({ efc: 1.19, sfw: 0.71, sfp: 0.89, sfo: 1, days: 100, areaHa: 2.5 })).toBeCloseTo(1.19 * 0.71 * 0.89 * 100 * 2.5, 10);
  });
  it("organic amendment scaling SF_o = (1 + Σ ROA·CFOA)^0.59", () => {
    expect(sfo([])).toBe(1);
    expect(sfo([{ cfoa: 1, tPerHa: 2 }])).toBeCloseTo(Math.pow(3, 0.59), 12);
    expect(sfo([{ cfoa: 1, tPerHa: 2 }])).toBeCloseTo(1.912, 3);
    expect(sfo([{ cfoa: 0.21, tPerHa: 5 }])).toBeCloseTo(1.527, 3);
  });
});

describe("N2O and urea CO2", () => {
  it("direct N2O: 100 kg N × EF1 × 44/28", () => {
    expect(n2oDirectKg(100, 0.01)).toBeCloseTo(1.571428, 5);
    expect(n2oDirectKg(100, 0.004)).toBeCloseTo(0.628571, 5);
    expect(ef1For("rice", "continuously_flooded")).toBe(0.003);
    expect(ef1For("rice", "multiple_drainage")).toBe(0.005);
    expect(ef1For("rice", "continuously_flooded", false)).toBe(0.004);
    expect(ef1For("maize", "upland")).toBe(0.01);
  });
  it("indirect N2O: 100 kg N × (0.11 × 0.010 + 0.24 × 0.011) × 44/28", () => {
    expect(n2oIndirectKg(100)).toBeCloseTo(100 * (0.0011 + 0.00264) * (44 / 28), 8);
  });
  it("urea CO2: 100 kg N → 217.4 kg urea × 0.20 × 44/12 = 159.4 kg CO2", () => {
    expect(ureaCo2Kg(100)).toBeCloseTo((100 / 0.46) * 0.2 * (44 / 12), 8);
    expect(ureaCo2Kg(100)).toBeCloseTo(159.42, 2);
  });
  it("season emissions add up with AR6 GWPs (CH4 27, N2O 273)", () => {
    const e = seasonEmissions({ crop: "rice", areaHa: 1, days: 120, efc: 1.19, regime: "continuously_flooded", preseason: "non_flooded_lt180", organic: "none", organicT: 0, nKgHa: 100 });
    const n2o = n2oDirectKg(100, 0.003) + n2oIndirectKg(100);
    expect(e.ch4Kg).toBeCloseTo(142.8, 8);
    expect(e.n2oKg).toBeCloseTo(n2o, 10);
    expect(e.tCo2e).toBeCloseTo((142.8 * 27 + n2o * 273 + ureaCo2Kg(100)) / 1000, 10);
    const rf = seasonEmissions({ crop: "rice", areaHa: 1, days: 120, efc: 1.19, regime: "regular_rainfed", preseason: "non_flooded_lt180", organic: "none", organicT: 0, nKgHa: 0 });
    expect(rf.ch4Kg).toBeCloseTo(142.8 * 0.54, 8);
  });
  it("indicative credit revenue applies the conservativeness deduction", () => {
    expect(creditRevenue(100, 15, 15)).toEqual({ credits: 85, usd: 1275 });
  });
});

describe("water footprint & AWD saving", () => {
  it("splits ET into green and blue and scales to m³/t", () => {
    // ETa 500, irrigation 300, percolation 300 → effective rain 500 → blue share 300/800
    const w = waterFootprint({ etaMm: 500, rainMm: 900, irrigationMm: 300, percolationMm: 300 }, 2, 5);
    expect(w.blueMm).toBe(Math.round(500 * (300 / 800)));
    expect(w.greenMm).toBe(Math.round(500 * (500 / 800)));
    expect(w.withdrawalM3).toBe(300 * 10 * 2);
    expect(w.wfM3PerT).toBe(1000);
    expect(awdWaterSaving(10_000).m3).toBe(2700);
    expect(awdWaterSaving(10_000).lowM3).toBe(2500);
    expect(awdWaterSaving(10_000).highM3).toBe(3000);
  });
});

describe("programme", () => {
  it("seeds ~20 % AWD adoption among eligible rice assets and reports avoided emissions", async () => {
    const p = await carbonProgramme("org-bank-mekong", { priceUsd: 20 });
    expect(p.totals.eligibleAssets).toBeGreaterThan(10);
    const share = p.totals.adoptedAssets / p.totals.eligibleAssets;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.35);
    expect(p.achieved.avoidedAnnualTCo2e).toBeGreaterThan(0);
    expect(p.scenario.avoidedAnnualTCo2e).toBeGreaterThanOrEqual(p.achieved.avoidedAnnualTCo2e);
    expect(p.label).toMatch(/not a Verra VM0051/);
    // adopting one more eligible asset raises the avoided total
    const before = p.achieved.avoidedSeasonTCo2e;
    const cand = p.rows.find((r) => r.practice.eligible && !r.practice.awd)!;
    getStore().assets.find((a) => a.id === cand.id)!.meta.mrv_awd = true;
    const p2 = await carbonProgramme("org-bank-mekong", { priceUsd: 20 });
    expect(p2.achieved.avoidedSeasonTCo2e).toBeGreaterThan(before);
  }, 60_000);
});
