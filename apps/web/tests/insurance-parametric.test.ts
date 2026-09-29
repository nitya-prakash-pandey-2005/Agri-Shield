import { describe, expect, it } from "vitest";
import {
  basisRisk,
  computeIndex,
  damageProxy,
  DEFAULT_SPEC,
  indemnityLoss,
  payoutFraction,
  pricing,
  resolveSpec,
  seasonOutlook,
  seasonSlices,
  validateSpec,
  type ProductSpec,
} from "@/server/services/parametric";
import { calendarClimatology, consistencyScore, longestDryRun, ndviChange, windowMax, windowSum } from "@/server/services/claims";
import { empiricalReturnLevel, fitZiln, normCdf, normInv, percentileRank, quantile, spearman, zilnExceedance, zilnLayerLoss, zilnReturnLevel } from "@/server/services/risk-math";
import { extraterrestrialMm, hargreavesEt0, type DailyHistory } from "@/server/live/history";

/** Build a contiguous daily series from `start` for `years` years with a value function. */
function series(startYear: number, years: number, f: (d: Date, i: number) => number) {
  const time: string[] = [];
  const vals: number[] = [];
  const t0 = Date.UTC(startYear, 0, 1);
  const end = Date.UTC(startYear + years, 0, 1);
  for (let t = t0, i = 0; t < end; t += 86_400_000, i++) {
    const d = new Date(t);
    time.push(d.toISOString().slice(0, 10));
    vals.push(f(d, i));
  }
  return { time, vals };
}

function hist(time: string[], rain: number[], extra: Partial<DailyHistory> = {}): DailyHistory {
  return { lat: 22.7, lon: 89.07, provider: "ERA5", era5Cell: null, glofasCell: null, elevationM: 5, time, rain, tmax: rain.map(() => 32), et0: rain.map(() => 4), gust: rain.map(() => 20), discharge: null, fetchedAt: "", source: "live", ...extra };
}

const spec = (p: Partial<ProductSpec> = {}): ProductSpec => ({ ...DEFAULT_SPEC, ...p });

describe("payout curve", () => {
  it("is zero below the trigger, linear to the exit and capped", () => {
    const s = spec({ trigger: 150, exit: 350, entryPayoutPct: 0, maxPayoutPct: 100 });
    expect(payoutFraction(s, 149.9)).toBe(0);
    expect(payoutFraction(s, 150)).toBe(0);
    expect(payoutFraction(s, 250)).toBeCloseTo(0.5, 6);
    expect(payoutFraction(s, 350)).toBe(1);
    expect(payoutFraction(s, 900)).toBe(1);
    expect(payoutFraction(s, null)).toBe(0);
  });
  it("supports an entry payout and a cap below 100 %", () => {
    const s = spec({ trigger: 100, exit: 200, entryPayoutPct: 10, maxPayoutPct: 60 });
    expect(payoutFraction(s, 100)).toBeCloseTo(0.1, 6);
    expect(payoutFraction(s, 150)).toBeCloseTo(0.35, 6);
    expect(payoutFraction(s, 250)).toBeCloseTo(0.6, 6);
  });
  it("mirrors for deficit (below) indices", () => {
    const s = spec({ indexType: "rain_total", trigger: 800, exit: 400 });
    expect(payoutFraction(s, 900)).toBe(0);
    expect(payoutFraction(s, 600)).toBeCloseTo(0.5, 6);
    expect(payoutFraction(s, 300)).toBe(1);
  });
  it("validates threshold ordering by direction", () => {
    expect(validateSpec(spec({ trigger: 300, exit: 200 }))).toHaveLength(1);
    expect(validateSpec(spec({ indexType: "rain_total", trigger: 400, exit: 800 }))).toHaveLength(1);
    expect(validateSpec(spec({ trigger: 150, exit: 350 }))).toHaveLength(0);
    expect(validateSpec(spec({ calibration: { mode: "local", triggerRp: 10, exitRp: 5 } }))).toHaveLength(1);
  });
});

describe("index computation", () => {
  const rain = [0, 10, 50, 60, 40, 0, 0, 5, 0, 0];
  const v = { rain, tmax: [30, 36, 37, 33, 38, 30, 30, 36, 30, 30], discharge: [1, 2, 9, 4, 3, 2, 1, 1, 1, 1] };
  it("max N-day rolling rainfall", () => {
    expect(computeIndex(spec({ windowDays: 3 }), v, 0, 9)).toBe(150);
    expect(computeIndex(spec({ windowDays: 1 }), v, 0, 9)).toBe(60);
  });
  it("season total, peak discharge, dry spell and heat days", () => {
    expect(computeIndex(spec({ indexType: "rain_total" }), v, 0, 9)).toBe(165);
    expect(computeIndex(spec({ indexType: "discharge_max" }), v, 0, 9)).toBe(9);
    expect(computeIndex(spec({ indexType: "dry_spell", dryDayMm: 1 }), v, 0, 9)).toBe(2);
    expect(computeIndex(spec({ indexType: "heat_days", heatThresholdC: 36 }), v, 0, 9)).toBe(4);
  });
  it("returns null when > 10 % of days are missing", () => {
    const r = [1, null, null, 3, 4, 5, 6, 7, 8, 9];
    expect(computeIndex(spec({ indexType: "rain_total" }), { rain: r, tmax: r, discharge: null }, 0, 9)).toBeNull();
    expect(computeIndex(spec({ indexType: "discharge_max" }), { rain: rain, tmax: rain, discharge: null }, 0, 9)).toBeNull();
  });
});

describe("season slicing", () => {
  const { time } = series(2000, 3, () => 0);
  it("finds each window and flags completeness", () => {
    const sl = seasonSlices(time, { startMonth: 7, startDay: 1, endMonth: 9, endDay: 30 });
    expect(sl.map((s) => s.year)).toEqual([2000, 2001, 2002]);
    expect(sl[0]!.i1 - sl[0]!.i0 + 1).toBe(92);
    expect(sl.every((s) => s.complete)).toBe(true);
    const partial = seasonSlices(time, { startMonth: 7, startDay: 1, endMonth: 9, endDay: 30 }, time.indexOf("2002-08-01"));
    expect(partial[2]!.complete).toBe(false);
  });
  it("handles windows that cross the new year and clamps month ends", () => {
    const sl = seasonSlices(time, { startMonth: 11, startDay: 15, endMonth: 2, endDay: 31 });
    expect(sl[0]!.start).toBe("2000-11-15");
    expect(sl[0]!.end).toBe("2001-02-28");
    expect(sl[1]!.end).toBe("2002-02-28");
    expect(sl[2]!.complete).toBe(false); // ends in 2003, beyond the record
  });
});

describe("pricing", () => {
  const years = [0, 0, 0.5, 0, 1, 0, 0, 0, 0.25, 0].map((f, i) => ({ year: 2000 + i, payoutFraction: f }));
  it("computes burning cost, frequency and a loaded premium", () => {
    const p = pricing(years, 100_000, { expenseLoadPct: 25, riskLoadSigma: 0 });
    expect(p.years).toBe(10);
    expect(p.payoutYears).toBe(3);
    expect(p.frequencyPct).toBe(30);
    expect(p.burningCostPct).toBeCloseTo(17.5, 6);
    expect(p.purePremiumUsd).toBe(17_500);
    expect(p.loadedPremiumUsd).toBe(Math.round(17_500 / 0.75));
    expect(p.expectedLossRatioPct).toBeCloseTo(75, 1);
    expect(p.worstYear).toEqual({ year: 2004, payoutPct: 100 });
  });
  it("adds a volatility (λσ) load", () => {
    const a = pricing(years, 1000, { expenseLoadPct: 0, riskLoadSigma: 0 });
    const b = pricing(years, 1000, { expenseLoadPct: 0, riskLoadSigma: 0.5 });
    expect(b.loadedPremiumUsd).toBeGreaterThan(a.loadedPremiumUsd);
    expect(b.riskLoadUsd).toBeGreaterThan(0);
  });
});

describe("basis risk & damage proxy", () => {
  it("classifies hits, false negatives and false positives", () => {
    const yrs = [
      { year: 1, payoutFraction: 0.5, index: 300 },
      { year: 2, payoutFraction: 0, index: 100 },
      { year: 3, payoutFraction: 0.2, index: 200 },
      { year: 4, payoutFraction: 0, index: 90 },
    ];
    const proxy = [
      { year: 1, magnitude: 10, severity: 10, event: true },
      { year: 2, magnitude: 9, severity: 9, event: true },
      { year: 3, magnitude: 1, severity: 1, event: false },
      { year: 4, magnitude: 0, severity: 0, event: false },
    ];
    const b = basisRisk(yrs, proxy, "above");
    expect(b.hits).toEqual([1]);
    expect(b.falseNegatives).toEqual([2]);
    expect(b.falsePositives).toEqual([3]);
    expect(b.correctNegatives).toBe(1);
    expect(b.basisRiskPct).toBe(50);
    expect(b.detectionPct).toBe(50);
  });
  it("uses supplied loss years over the proxy", () => {
    const { time, vals } = series(2000, 6, (d) => (d.getUTCMonth() === 7 && d.getUTCDate() < 4 ? 100 : 1));
    const h = hist(time, vals);
    const sl = seasonSlices(time, DEFAULT_SPEC.season).filter((s) => s.complete);
    const p = damageProxy(DEFAULT_SPEC, h, sl, { lossYears: [2003] });
    expect(p.years.filter((y) => y.event).map((y) => y.year)).toEqual([2003]);
    expect(p.name).toMatch(/10-day/); // no river cell → rainfall proxy
  });
});

describe("local calibration", () => {
  it("sets trigger/exit at the location's own return levels", () => {
    // wettest 5-day total of year k is 100 + 10k mm
    const { time, vals } = series(1991, 30, (d) => (d.getUTCMonth() === 7 && d.getUTCDate() <= 5 ? (100 + 10 * (d.getUTCFullYear() - 1991)) / 5 : 0));
    const h = hist(time, vals);
    const r = resolveSpec(spec({ calibration: { mode: "local", triggerRp: 5, exitRp: 30 } }), h);
    const idx = Array.from({ length: 30 }, (_, k) => 100 + 10 * k);
    expect(r.trigger).toBeCloseTo(quantile(idx, 0.8), 0);
    expect(r.exit).toBeGreaterThan(r.trigger);
    expect(resolveSpec(spec({ trigger: 123 }), h).trigger).toBe(123); // absolute untouched
  });
});

describe("season outlook (conditional climatology)", () => {
  it("is certain when the observed part already exceeds the exit", () => {
    const { time, vals } = series(1991, 36, (d) => (d.getUTCFullYear() === 2026 && d.getUTCMonth() === 6 && d.getUTCDate() <= 5 ? 100 : 0.5));
    const h = hist(time, vals);
    const merged = { time, rain: vals, tmax: vals.map(() => 30), et0: vals.map(() => 4), gust: vals.map(() => 10), discharge: null, lastObsIdx: time.indexOf("2026-08-15"), todayIdx: time.indexOf("2026-08-16") };
    const o = seasonOutlook(spec({ trigger: 150, exit: 350 }), merged, undefined, 1991, "2026-08-16");
    expect(o?.status).toBe("in_season");
    expect(o?.indexToDate).toBeGreaterThanOrEqual(500);
    expect(o?.probabilityPct).toBe(100);
    expect(o?.expectedPayoutFraction).toBe(1);
    void h;
  });
  it("falls back to climatology frequency before the window opens", () => {
    // every 4th year has a 400 mm spell in August → 25 % payout frequency
    const full = series(1991, 36, (d) => (d.getUTCFullYear() % 4 === 0 && d.getUTCMonth() === 7 && d.getUTCDate() <= 5 ? 80 : 0));
    // the merged record ends 16 days after "today" (end of the forecast horizon)
    const cut = full.time.indexOf("2026-05-18") + 1;
    const time = full.time.slice(0, cut);
    const vals = full.vals.slice(0, cut);
    const merged = { time, rain: vals, tmax: vals.map(() => 30), et0: vals.map(() => 4), gust: vals.map(() => 10), discharge: null, lastObsIdx: time.indexOf("2026-05-01"), todayIdx: time.indexOf("2026-05-02") };
    const o = seasonOutlook(spec({ trigger: 150, exit: 350 }), merged, undefined, 1991, "2026-05-02");
    expect(o?.status).toBe("upcoming");
    expect(o!.probabilityPct).toBeGreaterThan(15);
    expect(o!.probabilityPct).toBeLessThan(40);
  });
});

describe("indemnity damage function", () => {
  it("is zero in a benign season and grows with extreme rain", () => {
    const { time, vals } = series(2000, 2, () => 5);
    const h = hist(time, vals, { et0: vals.map(() => 3) });
    const sl = seasonSlices(time, { startMonth: 7, startDay: 1, endMonth: 11, endDay: 30 })[0]!;
    expect(indemnityLoss(h, sl, 0).loss).toBe(0);
    const wet = [...vals];
    for (let i = sl.i0 + 10; i < sl.i0 + 15; i++) wet[i] = 100; // 500 mm in 5 days
    const l = indemnityLoss(hist(time, wet, { et0: vals.map(() => 3) }), sl, 20);
    expect(l.components.flood).toBeGreaterThan(0.5);
    expect(l.paid).toBeCloseTo(l.loss - 0.2, 6);
  });
});

describe("risk maths", () => {
  it("normal cdf / inverse are consistent", () => {
    for (const p of [0.001, 0.05, 0.5, 0.9, 0.999]) expect(normCdf(normInv(p))).toBeCloseTo(p, 5);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
  });
  it("quantile, percentile rank, spearman", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentileRank(3, [1, 2, 3, 4])).toBe(62.5);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 9);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 9);
  });
  it("zero-inflated lognormal return levels increase with return period and respect the cap", () => {
    const losses = [0, 0, 100, 200, 400, 800, 1600, 0, 300, 50];
    const fit = fitZiln(losses, 5000);
    expect(fit.p0).toBeCloseTo(0.3, 6);
    const l10 = zilnReturnLevel(fit, 10);
    const l100 = zilnReturnLevel(fit, 100);
    expect(l100).toBeGreaterThan(l10);
    expect(zilnReturnLevel(fit, 1e9)).toBeLessThanOrEqual(5000);
    expect(zilnExceedance(fit, l10)).toBeCloseTo(0.1, 2);
    // layer loss is bounded by the limit and by the ground-up mean
    const layer = zilnLayerLoss(fit, l10, 1000);
    expect(layer).toBeGreaterThan(0);
    expect(layer).toBeLessThan(1000 * zilnExceedance(fit, l10) + 1e-6);
  });
  it("empirical return level uses Weibull plotting positions", () => {
    const v = Array.from({ length: 29 }, (_, i) => i + 1); // n=29 → rank 1 ≈ 1-in-30
    expect(empiricalReturnLevel(v, 30)).toBe(29);
    expect(empiricalReturnLevel(v, 100)).toBeNull();
  });
});

describe("claims evidence helpers", () => {
  it("window sums/max and dry runs", () => {
    const a = [1, null, 3, 0, 0, 0, 5];
    expect(windowSum(a, 0, 2)).toBe(4);
    expect(windowMax(a, 0, 6)).toBe(5);
    expect(longestDryRun([0, 0, 2, 0, 0, 0, 0.5, 3], 0, 7, 1)).toBe(4);
  });
  it("calendar climatology excludes the loss year and compares like with like", () => {
    const { time, vals } = series(2000, 5, (d) => d.getUTCFullYear());
    const li = time.indexOf("2003-07-10");
    const clim = calendarClimatology(time, li, (e) => vals[e]!, 0);
    expect(clim.sort()).toEqual([2000, 2001, 2002, 2004]);
  });
  it("consistency score is a weighted mean with verdict bands", () => {
    expect(consistencyScore([{ support: 1, weight: 1 }, { support: 0.5, weight: 1 }])).toEqual({ score: 75, verdict: "consistent" });
    expect(consistencyScore([{ support: 0.5, weight: 1 }, { support: null, weight: 5 }]).verdict).toBe("partially_consistent");
    expect(consistencyScore([{ support: 0.1, weight: 1 }]).verdict).toBe("not_supported");
  });
  it("NDVI change before/after the loss date", () => {
    const r = ndviChange(
      [
        { date: "2024-05-01", ndvi: 0.6 },
        { date: "2024-05-17", ndvi: 0.6 },
        { date: "2024-06-02", ndvi: 0.3 },
        { date: "2024-06-18", ndvi: 0.3 },
      ],
      "2024-05-27"
    );
    expect(r.changePct).toBe(-50);
  });
});

describe("Hargreaves ET0 (NASA POWER fallback)", () => {
  it("gives plausible tropical values", () => {
    expect(extraterrestrialMm(22.7, 180)).toBeGreaterThan(14);
    const et0 = hargreavesEt0(33, 26, 22.7, 180);
    expect(et0).toBeGreaterThan(3);
    expect(et0).toBeLessThan(7);
  });
});
