import { describe, expect, it } from "vitest";
import {
  gammaCdf,
  gammaFit,
  gammaP,
  gumbelFit,
  gumbelReturnLevel,
  gumbelReturnPeriod,
  heatIndexC,
  heatIndexCategory,
  linearTrend,
  longestDrySpell,
  mannKendall,
  maxRollingSum,
  normalCdf,
  normalInv,
  percentileRank,
  quantile,
  spi,
  spiCategory,
  wetBulbC,
} from "@/server/live/climate-math";

describe("empirical distribution", () => {
  it("quantile matches numpy type-7 interpolation", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5);
    expect(quantile([10, 0, 5], 0.1)).toBeCloseTo(1);
    expect(quantile([null, 3, undefined, 1], 1)).toBe(3);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
  it("percentileRank uses mid-ranks for ties", () => {
    expect(percentileRank([1, 2, 3, 4], 2)).toBeCloseTo(37.5);
    expect(percentileRank([1, 2, 3, 4], 10)).toBe(100);
    expect(percentileRank([1, 2, 3, 4], 0)).toBe(0);
  });
});

describe("normal distribution", () => {
  it("CDF and inverse are consistent with standard tables", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalInv(0.975)).toBeCloseTo(1.95996, 4);
    expect(normalInv(0.5)).toBeCloseTo(0, 8);
    expect(normalInv(0.001)).toBeCloseTo(-3.0902, 3);
  });
});

describe("trend", () => {
  it("recovers slope per decade of a perfect line", () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: 2000 + i, y: 2 * (2000 + i) + 1 }));
    const t = linearTrend(pts);
    expect(t.slopePerDecade).toBeCloseTo(20, 6);
    expect(t.r2).toBeCloseTo(1, 6);
    expect(t.significant).toBe(true);
    expect(t.n).toBe(20);
  });
  it("finds no significant trend in an alternating series", () => {
    const y = Array.from({ length: 30 }, (_, i) => (i % 2 ? 10 : 12));
    const mk = mannKendall(y);
    expect(mk.pValue).toBeGreaterThan(0.3);
    expect(linearTrend(y.map((v, i) => ({ x: i, y: v }))).significant).toBe(false);
  });
  it("ignores nulls and short series", () => {
    expect(linearTrend([{ x: 1, y: null }, { x: 2, y: 3 }]).n).toBe(1);
  });
});

describe("Gumbel return periods", () => {
  const maxima = [62, 85, 71, 110, 95, 58, 77, 140, 88, 66, 102, 73, 90, 81, 125, 69, 99, 84, 76, 93];
  const fit = gumbelFit(maxima)!;
  it("fits by method of moments", () => {
    const m = maxima.reduce((a, b) => a + b, 0) / maxima.length;
    expect(fit.beta).toBeGreaterThan(0);
    // 2-year level of a Gumbel is mu + 0.3665·beta, slightly below the mean
    expect(gumbelReturnLevel(fit, 2)).toBeCloseTo(fit.mu + 0.36651 * fit.beta, 3);
    expect(gumbelReturnLevel(fit, 2)).toBeLessThan(m);
  });
  it("return levels grow with T and invert to their period", () => {
    const levels = [2, 5, 10, 25, 50].map((T) => gumbelReturnLevel(fit, T));
    for (let i = 1; i < levels.length; i++) expect(levels[i]!).toBeGreaterThan(levels[i - 1]!);
    for (const T of [2, 5, 10, 25, 100]) expect(gumbelReturnPeriod(fit, gumbelReturnLevel(fit, T))).toBeCloseTo(T, 4);
    expect(gumbelReturnPeriod(fit, 0)).toBe(1);
  });
  it("needs at least 5 years", () => {
    expect(gumbelFit([1, 2, 3])).toBeNull();
  });
});

describe("gamma distribution and SPI", () => {
  it("regularised incomplete gamma matches the exponential special case", () => {
    for (const x of [0.1, 1, 3, 8]) expect(gammaP(1, x)).toBeCloseTo(1 - Math.exp(-x), 8);
    expect(gammaP(3, 2)).toBeCloseTo(0.3233235838, 7);
  });
  it("fits and evaluates a mixed gamma", () => {
    const ref = [0, 12, 30, 45, 55, 60, 72, 80, 95, 110, 130, 150, 40, 65, 88, 20, 35, 101, 77, 58];
    const fit = gammaFit(ref)!;
    expect(fit.q0).toBeCloseTo(0.05);
    expect(gammaCdf(fit, 0)).toBeCloseTo(0.05);
    expect(gammaCdf(fit, 1000)).toBeCloseTo(1, 5);
  });
  it("SPI ~0 at the median, strongly negative when very dry, positive when wet", () => {
    const ref = [120, 95, 140, 160, 80, 110, 130, 150, 100, 170, 90, 125, 135, 115, 105, 145, 155, 85, 118, 128];
    const med = quantile(ref, 0.5);
    expect(Math.abs(spi(ref, med)!)).toBeLessThan(0.2);
    expect(spi(ref, 40)!).toBeLessThan(-2);
    expect(spi(ref, 220)!).toBeGreaterThan(1.5);
    expect(spi(ref, 0)!).toBeGreaterThanOrEqual(-3);
    expect(spiCategory(-1.7).severity).toBe("severe");
    expect(spiCategory(0.3).label).toBe("Near normal");
  });
});

describe("heat stress", () => {
  it("heat index follows the NOAA table", () => {
    // NOAA: 90 °F & 70 % RH → 106 °F (41.1 °C)
    expect(heatIndexC(32.22, 70)).toBeCloseTo(41.1, 0);
    // 80 °F & 40 % → ~80 °F: no amplification in mild, dry air
    expect(heatIndexC(26.67, 40)).toBeCloseTo(26.8, 0);
    expect(heatIndexCategory(42).label).toBe("Danger");
  });
  it("wet-bulb matches Stull (2011) reference point", () => {
    expect(wetBulbC(20, 50)).toBeCloseTo(13.7, 1);
    expect(wetBulbC(35, 75)).toBeGreaterThan(30);
  });
});

describe("series helpers", () => {
  it("rolling sums and dry spells", () => {
    expect(maxRollingSum([1, 5, 10, 0, 2, 30, 1], 3)).toBe(33);
    expect(longestDrySpell([0, 0, 5, 0, 0, 0, 0.2, 3])).toBe(4);
  });
});
