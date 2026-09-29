/**
 * Tide harmonics (M2/S2 spring–neap), seasonal river curve and soil bucket.
 */
import { describe, expect, it } from "vitest";
import {
  CONSTITUENT_PERIOD_H,
  HOUR,
  DAY,
  SPRING_NEAP_PERIOD_H,
  seasonalFlowRatio,
  soilMoistureStep,
  springNeapEnvelope,
  tidalConstituents,
  tideLevel,
  hourlyRain,
  type TidalConstituent,
} from "@/server/services/iot-physics";

const M2: TidalConstituent = { name: "M2", periodH: CONSTITUENT_PERIOD_H.M2, amp: 1.0, phase: 0 };
const S2: TidalConstituent = { name: "S2", periodH: CONSTITUENT_PERIOD_H.S2, amp: 0.4, phase: 0 };

describe("tide harmonics", () => {
  it("uses the astronomical periods", () => {
    expect(CONSTITUENT_PERIOD_H.M2).toBeCloseTo(12.4206, 3);
    expect(CONSTITUENT_PERIOD_H.S2).toBe(12);
  });

  it("spring–neap beat period is ≈ 14.77 days", () => {
    expect(SPRING_NEAP_PERIOD_H / 24).toBeCloseTo(14.765, 2);
  });

  it("a pure M2 tide repeats every 12.42 h and has range 2·A", () => {
    const t0 = Date.UTC(2026, 5, 1);
    for (const h of [0, 3.1, 7.7]) {
      const t = t0 + h * HOUR;
      expect(tideLevel(t, [M2])).toBeCloseTo(tideLevel(t + M2.periodH * HOUR, [M2]), 6);
    }
    const samples = Array.from({ length: 200 }, (_, i) => tideLevel(t0 + (i * M2.periodH * HOUR) / 200, [M2]));
    expect(Math.max(...samples) - Math.min(...samples)).toBeCloseTo(2, 2);
  });

  it("M2+S2 range oscillates between neap 2(A−B) and spring 2(A+B) over one beat", () => {
    const t0 = Date.UTC(2026, 5, 1);
    const dailyRanges: number[] = [];
    for (let day = 0; day < 15; day++) {
      const pts = Array.from({ length: 25 * 6 }, (_, i) => tideLevel(t0 + day * DAY + i * 10 * 60_000, [M2, S2]));
      dailyRanges.push(Math.max(...pts) - Math.min(...pts));
    }
    const spring = Math.max(...dailyRanges);
    const neap = Math.min(...dailyRanges);
    expect(spring).toBeGreaterThan(2 * (1.0 + 0.4) * 0.97);
    expect(spring).toBeLessThanOrEqual(2 * (1.0 + 0.4) + 1e-9);
    expect(neap).toBeLessThan(2 * (1.0 - 0.4) * 1.08);
    expect(neap).toBeGreaterThanOrEqual(2 * (1.0 - 0.4) - 1e-9);
  });

  it("envelope peaks (spring) and troughs (neap) half a beat apart", () => {
    const t0 = Date.UTC(2026, 5, 1);
    const env = Array.from({ length: 800 }, (_, i) => ({ t: t0 + i * HOUR, e: springNeapEnvelope(t0 + i * HOUR, M2, S2) }));
    const maxE = Math.max(...env.map((x) => x.e));
    const minE = Math.min(...env.map((x) => x.e));
    expect(maxE).toBeCloseTo(1.4, 2);
    expect(minE).toBeCloseTo(0.6, 2);
    const springs = env.filter((x, i) => i > 0 && i < env.length - 1 && x.e >= env[i - 1]!.e && x.e >= env[i + 1]!.e).map((x) => x.t);
    expect(springs.length).toBeGreaterThanOrEqual(2);
    expect((springs[1]! - springs[0]!) / HOUR).toBeCloseTo(SPRING_NEAP_PERIOD_H, -1);
  });

  it("regional presets keep M2 dominant and are deterministic per seed", () => {
    const a = tidalConstituents("bengal", 42);
    expect(a.find((c) => c.name === "M2")!.amp).toBeGreaterThan(a.find((c) => c.name === "S2")!.amp);
    expect(tidalConstituents("bengal", 42)).toEqual(a);
    expect(tidalConstituents("mekong", 1).some((c) => c.name === "K1")).toBe(true);
  });
});

describe("seasonal curve + soil bucket + rain", () => {
  it("monsoon peak is higher than dry season", () => {
    const peak = seasonalFlowRatio(Date.UTC(2026, 7, 23), 235);
    const dry = seasonalFlowRatio(Date.UTC(2026, 3, 1), 235);
    expect(peak).toBeGreaterThan(1.5);
    expect(dry).toBeLessThan(0.6);
    expect(dry).toBeGreaterThanOrEqual(0.15);
  });

  it("soil dries exponentially toward the floor and rain wets it, capped at saturation", () => {
    let m = 40;
    for (let i = 0; i < 24 * 20; i++) m = soilMoistureStep(m, 1, { rainMm: 0, irrigationMm: 0, floor: 12, saturation: 47, tauH: 72 });
    expect(m).toBeGreaterThan(12);
    expect(m).toBeLessThan(15);
    const wet = soilMoistureStep(m, 1, { rainMm: 40, irrigationMm: 0, floor: 12, saturation: 47, tauH: 72 });
    expect(wet - m).toBeGreaterThan(9);
    expect(soilMoistureStep(45, 1, { rainMm: 200, irrigationMm: 0, floor: 12, saturation: 47, tauH: 72 })).toBe(47);
  });

  it("hourly rain is deterministic, non-negative, 0.2 mm quantised and wetter in the monsoon", () => {
    const sum = (month: number) => {
      let s = 0;
      const h0 = Date.UTC(2026, month, 1) / HOUR;
      for (let h = h0; h < h0 + 24 * 30; h++) s += hourlyRain(7, h, { monsoonPeakDoy: 205, wetness: 1 });
      return s;
    };
    expect(hourlyRain(7, 500_000, { monsoonPeakDoy: 205, wetness: 1 })).toBe(hourlyRain(7, 500_000, { monsoonPeakDoy: 205, wetness: 1 }));
    const r = hourlyRain(7, 500_123, { monsoonPeakDoy: 205, wetness: 1 });
    expect(r).toBeGreaterThanOrEqual(0);
    expect(Math.abs(r * 5 - Math.round(r * 5))).toBeLessThan(1e-9);
    expect(sum(6)).toBeGreaterThan(sum(1) * 2);
  });
});
