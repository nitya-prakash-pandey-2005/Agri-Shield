/**
 * Simulation Lab — damage/yield functions and the Holland cyclone model.
 */
import { describe, expect, it } from "vitest";
import { combineDamage, curveForAsset, depthDamage, emanuelDamage, insuredLoss, JRC_ASIA, loanShock, WIND_FRAGILITY, windFragilityFor, yieldImpact, type CreditFns } from "@/server/services/sim-impact";
import { categoryOf, cdGarratt, customTrack, hollandB, hollandWind, interpolate, ktFromPc, parameterise, pcFromKt, radiusOf, rmaxVickery, surgeIndex, windAt } from "@/server/services/sim-cyclone";

describe("JRC depth–damage (Asia)", () => {
  it("interpolates linearly between tabulated depths and saturates at 6 m", () => {
    expect(depthDamage("residential", 0)).toBe(0);
    expect(depthDamage("residential", 0.5)).toBeCloseTo(0.327, 6);
    expect(depthDamage("residential", 0.75)).toBeCloseTo((0.327 + 0.494) / 2, 6);
    expect(depthDamage("agriculture", 2.5)).toBeCloseTo((0.558 + 0.66) / 2, 6);
    expect(depthDamage("industrial", 9)).toBe(1);
    expect(depthDamage("commercial", -1)).toBe(0);
  });
  it("every curve is monotone non-decreasing", () => {
    for (const c of Object.values(JRC_ASIA)) for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
  });
  it("maps asset types to curves", () => {
    expect(curveForAsset("community")).toBe("residential");
    expect(curveForAsset("warehouse")).toBe("industrial");
    expect(curveForAsset("office")).toBe("commercial");
    expect(curveForAsset("insured_plot")).toBe("agriculture");
  });
});

describe("wind fragility (Emanuel 2011)", () => {
  it("is 0 below the threshold and exactly 0.5 at V½", () => {
    const f = WIND_FRAGILITY.community!;
    expect(emanuelDamage(20, f)).toBe(0);
    expect(emanuelDamage(f.vHalf, f)).toBeCloseTo(0.5, 9);
    expect(emanuelDamage(120, f)).toBeGreaterThan(0.95);
  });
  it("crops are more fragile than buildings", () => {
    const rice = windFragilityFor("insured_plot", "rice");
    const house = windFragilityFor("community", null);
    expect(emanuelDamage(35, rice)).toBeGreaterThan(emanuelDamage(35, house));
  });
  it("combines independent damages", () => {
    expect(combineDamage(0.5, 0.5)).toBeCloseTo(0.75, 9);
    expect(combineDamage(0, 0.3)).toBeCloseTo(0.3, 9);
  });
});

describe("FAO-33 yield response + heat", () => {
  it("no deficit and no warming → no loss", () => {
    expect(yieldImpact("rice", 0, 0).yieldLoss).toBe(0);
  });
  it("follows 1 − Ya/Ym = Ky·(1 − ETa/ETm) for a rain-fed crop", () => {
    const r = yieldImpact("maize", 0.4, 0, 1);
    expect(r.etDeficit).toBeCloseTo(0.4, 6);
    expect(r.waterLoss).toBeCloseTo(1.25 * 0.4, 6);
  });
  it("irrigation buffers the deficit; warming adds heat loss (Zhao et al. 2017)", () => {
    expect(yieldImpact("rice", 0.4, 0, 0.25).yieldLoss).toBeLessThan(yieldImpact("rice", 0.4, 0, 0.9).yieldLoss);
    const heat = yieldImpact("wheat", 0, 2, 0.25);
    expect(heat.heatLoss).toBeCloseTo(0.12, 6);
    expect(heat.yieldLoss).toBeGreaterThan(0.12);
  });
  it("is monotone in the deficit", () => {
    let prev = -1;
    for (let d = 0; d <= 0.9; d += 0.1) {
      const y = yieldImpact("vegetables", d, 1).yieldLoss;
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });
});

describe("finance helpers", () => {
  it("insured loss applies the % deductible of the sum insured", () => {
    expect(insuredLoss(1000, 0.5, 20)).toBe(300);
    expect(insuredLoss(1000, 0.1, 20)).toBe(0);
  });
  it("loan shock raises PD and EL when damage occurs", () => {
    const fns: CreditFns = {
      baselinePd: () => ({ pd: 0.05, stage: 1 }),
      climatePd: (pd, p, s, _seg, sev = {}) => 1 - (1 - pd) * (1 - p.flood * s.flood * 0.08 * (sev.flood ?? 1)) * (1 - p.drought * s.drought * 0.06 * (sev.drought ?? 1)),
      sensitivity: () => ({ flood: 1, drought: 0.8, salinity: 1, heat: 0.6 }),
      lgdFor: () => 0.5,
    };
    const a = { valueUsd: 2000, crop: "rice", tags: [], meta: { internalRating: "BB" } };
    const none = loanShock(a, "flood", 0, fns);
    expect(none.elUpliftUsd).toBe(0);
    const hit = loanShock(a, "flood", 0.9, fns);
    expect(hit.pdStressed).toBeGreaterThan(hit.pdBase);
    expect(hit.elUpliftUsd).toBeGreaterThan(0);
    expect(hit.elStressedUsd).toBe(Math.round(hit.pdStressed * 0.5 * 2000));
  });
});

describe("Holland (1980) cyclone model", () => {
  it("Atkinson–Holliday wind ↔ pressure are inverses", () => {
    for (const kt of [40, 80, 120, 150]) expect(ktFromPc(pcFromKt(kt))).toBeCloseTo(kt, 6);
  });
  it("Vickery–Wadhera Rmax shrinks with intensity and grows with latitude", () => {
    expect(rmaxVickery(80, 20)).toBeLessThan(rmaxVickery(20, 20));
    expect(rmaxVickery(50, 25)).toBeGreaterThan(rmaxVickery(50, 10));
  });
  it("B calibrated from Vmax reproduces the best-track peak wind at Rmax (±8 %)", () => {
    const p = parameterise({ t: 0, lat: 18, lon: 88, windKt: 120, presHpa: 935 });
    const vmax = 120 * 0.514444;
    // peak of the symmetric profile ≈ Vmax (Coriolis term makes it slightly lower)
    let peak = 0;
    for (let r = 2; r < 200; r += 0.5) peak = Math.max(peak, hollandWind(r, p));
    expect(Math.abs(peak - vmax) / vmax).toBeLessThan(0.08);
    expect(hollandB(null, 60, 30, 20)).toBeGreaterThanOrEqual(1);
  });
  it("wind decays outward and the right side is stronger for a moving NH storm", () => {
    const steps = interpolate(customTrack([{ lat: 18, lon: 88, windKt: 100 }, { lat: 20, lon: 88, windKt: 100 }], 20), 1);
    const s = steps[Math.floor(steps.length / 2)]!;
    const east = windAt(s.lat, s.lon + 0.6, s).v; // right of a northward track
    const west = windAt(s.lat, s.lon - 0.6, s).v;
    expect(east).toBeGreaterThan(west);
    expect(hollandWind(300, s)).toBeLessThan(hollandWind(s.rmax, s));
    expect(radiusOf(17.5, s)).toBeGreaterThan(radiusOf(33, s));
  });
  it("custom track timing follows distance ÷ forward speed", () => {
    const tr = customTrack([{ lat: 0, lon: 90, windKt: 60 }, { lat: 1, lon: 90, windKt: 60 }], 11.132);
    expect(tr[1]!.t).toBeCloseTo(10, 1);
  });
  it("surge index: ~1 cm per hPa inverse barometer; no set-up for offshore wind", () => {
    const s = surgeIndex(0, 1, 50, 4000);
    expect(s.ib).toBeCloseTo(0.497, 2);
    expect(surgeIndex(40, -1, 0, 4000).total).toBe(0);
    expect(surgeIndex(50, 1, 0, 4000).setup).toBeGreaterThan(2);
    expect(cdGarratt(100)).toBe(2.5e-3);
  });
  it("Saffir–Simpson categories", () => {
    expect(categoryOf(20)).toBe("TS");
    expect(categoryOf(45)).toBe("2");
    expect(categoryOf(75)).toBe("5");
  });
});
