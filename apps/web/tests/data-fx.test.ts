import { describe, expect, it } from "vitest";
import { committedFx, fromUsd, fxSnapshot, rateOf, toUsd } from "@/server/live/fx";

describe("FX conversion (committed snapshot fallback)", () => {
  it("serves the committed snapshot when no live refresh has happened", () => {
    const t = fxSnapshot();
    expect(t.base).toBe("USD");
    expect(t.rates.USD).toBe(1);
    expect(committedFx().live).toBe(false);
    for (const c of ["BDT", "VND", "PHP", "INR", "IDR"]) expect(t.rates[c], c).toBeGreaterThan(1);
  });

  it("round-trips amounts and is case-insensitive", () => {
    expect(toUsd(100, "USD")).toBe(100);
    const bdt = fromUsd(50, "bdt");
    expect(bdt).toBeGreaterThan(50 * 80); // BDT has been > 80/USD since 2022
    expect(toUsd(bdt, "BDT")).toBeCloseTo(50, 8);
    expect(toUsd(25_000_000, "VND")).toBeGreaterThan(700);
    expect(toUsd(25_000_000, "VND")).toBeLessThan(1_300);
    expect(rateOf("INR")).toBeGreaterThan(60);
  });

  it("rejects unknown currency codes", () => {
    expect(() => toUsd(1, "XXX")).toThrow(/Unknown currency/);
  });
});
