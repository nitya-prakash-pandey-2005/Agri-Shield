import { describe, expect, it } from "vitest";
import { cropDamageProbability, drySeasonFactor, floodCropLoss, riskLevel, salinityClass, scoreFlood, scoreSalinity } from "@/server/risk/scoring";

const base = { rain24hMm: 10, rain48hMm: 20, rain72hMm: 30, soilMoisture: 0.3, dischargeRatio: 1, exposure: 0.6, elevationM: 4 };

describe("scoreFlood", () => {
  it("is monotonic non-decreasing in rainfall", () => {
    let prev = -1;
    for (const mm of [0, 10, 25, 50, 80, 120, 200, 400]) {
      const r = scoreFlood({ ...base, rain24hMm: mm / 3, rain48hMm: (mm * 2) / 3, rain72hMm: mm });
      expect(r.p72).toBeGreaterThanOrEqual(prev);
      prev = r.p72;
    }
  });

  it("keeps probabilities within [0,1] and p24 ≤ p48 ≤ p72", () => {
    const extremes = [
      { ...base, rain24hMm: 0, rain48hMm: 0, rain72hMm: 0, soilMoisture: 0, dischargeRatio: 0, exposure: 0, elevationM: 100 },
      { ...base, rain24hMm: 900, rain48hMm: 1500, rain72hMm: 2000, soilMoisture: 0.6, dischargeRatio: 9, exposure: 1, elevationM: 0 },
      { ...base, dischargeRatio: null, elevationM: null },
    ];
    for (const i of extremes) {
      const r = scoreFlood(i);
      for (const p of [r.p24, r.p48, r.p72]) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      expect(r.p24).toBeLessThanOrEqual(r.p48);
      expect(r.p48).toBeLessThanOrEqual(r.p72);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.depthM).toBeGreaterThanOrEqual(0);
      expect(r.factors.length).toBeGreaterThan(0);
    }
  });

  it("rises with discharge, soil saturation and exposure", () => {
    const lo = scoreFlood(base).p72;
    expect(scoreFlood({ ...base, dischargeRatio: 2.5 }).p72).toBeGreaterThan(lo);
    expect(scoreFlood({ ...base, soilMoisture: 0.5 }).p72).toBeGreaterThan(lo);
    expect(scoreFlood({ ...base, exposure: 0.95 }).p72).toBeGreaterThan(lo);
    expect(scoreFlood({ ...base, elevationM: 0.5 }).p72).toBeGreaterThan(scoreFlood({ ...base, elevationM: 14 }).p72);
  });

  it("names contributing factors", () => {
    const r = scoreFlood({ ...base, rain72hMm: 150, rain48hMm: 120, soilMoisture: 0.45, dischargeRatio: 2, exposure: 0.8, elevationM: 1 });
    expect(r.factors).toEqual(expect.arrayContaining(["above_avg_rainfall_72h", "high_soil_saturation", "river_discharge_above_normal", "low_lying_floodplain"]));
  });
});

describe("scoreSalinity", () => {
  const s = { exposure: 0.9, rain30dMm: 50, seaLevelM: 0.4, latitude: 22.7 };
  it("dry season (Apr) exceeds wet season (Aug) in the northern hemisphere", () => {
    expect(scoreSalinity({ ...s, month: 4 }).ecCurrent).toBeGreaterThan(scoreSalinity({ ...s, month: 8 }).ecCurrent);
    expect(scoreSalinity({ ...s, month: 4 }).score).toBeGreaterThan(scoreSalinity({ ...s, month: 8 }).score);
  });
  it("inverts seasonality south of the equator", () => {
    expect(drySeasonFactor(10, -6.9)).toBeGreaterThan(drySeasonFactor(4, -6.9));
  });
  it("rain dilutes and tides amplify EC", () => {
    expect(scoreSalinity({ ...s, month: 4, rain30dMm: 400 }).ecCurrent).toBeLessThan(scoreSalinity({ ...s, month: 4, rain30dMm: 0 }).ecCurrent);
    expect(scoreSalinity({ ...s, month: 4, seaLevelM: 1.5 }).ecCurrent).toBeGreaterThan(scoreSalinity({ ...s, month: 4, seaLevelM: -0.5 }).ecCurrent);
  });
  it("keeps score within 0-100 and 30-day forecast ≥ current", () => {
    for (let m = 1; m <= 12; m++) {
      const r = scoreSalinity({ ...s, month: m });
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.ecPredicted30d).toBeGreaterThanOrEqual(r.ecCurrent);
    }
  });
});

describe("crop damage & classes", () => {
  it("rice damage follows FAO thresholds (3 / 10 dS/m)", () => {
    expect(cropDamageProbability("rice", 1)).toBeLessThan(0.15);
    expect(cropDamageProbability("rice", 3)).toBeCloseTo(0.15, 2);
    expect(cropDamageProbability("rice", 6.5)).toBeGreaterThan(0.15);
    expect(cropDamageProbability("rice", 6.5)).toBeLessThan(0.97);
    expect(cropDamageProbability("rice", 12)).toBe(0.97);
  });
  it("salt-tolerant barley suffers less than rice at the same EC", () => {
    expect(cropDamageProbability("barley", 7)).toBeLessThan(cropDamageProbability("rice", 7));
  });
  it("is monotonic in EC", () => {
    let prev = -1;
    for (let ec = 0; ec <= 14; ec += 0.5) {
      const p = cropDamageProbability("jute", ec);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
  it("classifies EC and risk levels at boundaries", () => {
    expect(salinityClass(1.9)).toBe("safe");
    expect(salinityClass(2)).toBe("sensitive");
    expect(salinityClass(4)).toBe("moderate");
    expect(salinityClass(8)).toBe("severe");
    expect([34, 35, 59, 60, 79, 80].map(riskLevel)).toEqual(["low", "medium", "medium", "high", "high", "critical"]);
  });
  it("flood crop loss grows with depth and duration and is bounded", () => {
    expect(floodCropLoss(0.8, 5)).toBeGreaterThan(floodCropLoss(0.2, 1));
    expect(floodCropLoss(5, 30)).toBeLessThanOrEqual(1);
    expect(floodCropLoss(0, 0)).toBe(0);
  });
});
