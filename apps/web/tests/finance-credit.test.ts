import { describe, expect, it } from "vitest";
import { assessLoan, baselinePd, climatePd, hazardFrequencies, irbRetailK, lgdFor, lifetimePd, notchesBetween, portfolioSummary, ratingFromPd, sensitivity } from "@/server/services/credit-risk";
import { stressLoan } from "@/server/services/stress-test";
import { climateShiftFromSeries, type DailyHistory } from "@/server/live/history";
import type { AssetRecord } from "@/server/data/store";

const zero = { flood: 0, drought: 0, salinity: 0, heat: 0 };

function loanAsset(over: Partial<AssetRecord> = {}, meta: Record<string, string | number | null> = {}): AssetRecord {
  return {
    id: "ast_test",
    workspaceId: "org-bank-mekong",
    type: "loan",
    name: "Rice loan · Test",
    externalRef: "MRCB-TEST",
    lat: 10,
    lon: 105.8,
    address: null,
    districtId: null,
    country: "Vietnam",
    areaHa: 2,
    crop: "rice",
    valueUsd: 10_000,
    tags: ["rice", "smallholder"],
    meta: { principalUsd: 10_000, tenorMonths: 12, interestRatePct: 9, daysPastDue: 0, internalRating: "BBB", collateral: "Land-use certificate", ...meta },
    status: "active",
    createdAt: new Date(),
    createdBy: "test",
    lastAssessment: null,
    history: [],
    ...over,
  };
}

describe("rating ↔ PD mapping", () => {
  it("maps internal ratings to documented baseline PDs and back", () => {
    expect(baselinePd("A", 0).pd).toBe(0.01);
    expect(baselinePd("BBB", 0).pd).toBe(0.025);
    expect(baselinePd("BB", 0).pd).toBe(0.05);
    expect(baselinePd("B", 0).pd).toBe(0.1);
    for (const r of ["A", "BBB", "BB", "B"] as const) expect(ratingFromPd(baselinePd(r, 0).pd)).toBe(r);
    expect(ratingFromPd(0.5)).toBe("D");
    expect(notchesBetween("A", "BB")).toBe(2);
  });
  it("applies the delinquency overlay and IFRS 9 stages", () => {
    expect(baselinePd("BBB", 10).pd).toBeCloseTo(0.0375, 12);
    expect(baselinePd("BBB", 10).stage).toBe(1);
    expect(baselinePd("BBB", 45).pd).toBeCloseTo(0.0625, 12);
    expect(baselinePd("BBB", 45).stage).toBe(2);
    expect(baselinePd("BBB", 95)).toEqual({ pd: 1, stage: 3 });
  });
});

describe("climate-adjusted PD", () => {
  it("equals the baseline with no hazard and rises monotonically with hazard frequency", () => {
    const s = sensitivity("rice");
    expect(climatePd(0.025, zero, s, "smallholder")).toBeCloseTo(0.025, 12);
    let prev = 0;
    for (const f of [0, 0.1, 0.3, 0.6, 1]) {
      const pd = climatePd(0.025, { ...zero, flood: f }, s, "smallholder");
      expect(pd).toBeGreaterThanOrEqual(prev);
      prev = pd;
    }
    // flood every year for a fully sensitive rice farmer adds k = 8 pp on the survivors
    expect(climatePd(0.025, { ...zero, flood: 1 }, s, "smallholder")).toBeCloseTo(1 - 0.975 * 0.92, 10);
  });
  it("SME segment and less sensitive crops get a smaller uplift", () => {
    const p = { ...zero, flood: 0.3, salinity: 0.3 };
    const small = climatePd(0.05, p, sensitivity("rice"), "smallholder");
    expect(climatePd(0.05, p, sensitivity("rice"), "sme")).toBeLessThan(small);
    expect(climatePd(0.05, p, sensitivity("coconut"), "smallholder")).toBeLessThan(small);
  });
  it("stays within [0,1] and keeps defaulted loans at 100 %", () => {
    expect(climatePd(1, { flood: 1, drought: 1, salinity: 1, heat: 1 }, sensitivity("rice"), "smallholder", { flood: 50 })).toBe(1);
    expect(climatePd(0.2, { flood: 1, drought: 1, salinity: 1, heat: 1 }, sensitivity("rice"), "smallholder", { flood: 50 })).toBeLessThanOrEqual(1);
  });
});

describe("LGD, lifetime PD and IRB capital", () => {
  it("haircuts land collateral in flood-prone / salinising cells", () => {
    expect(lgdFor("Land-use certificate", zero)).toBe(0.35);
    expect(lgdFor("Land-use certificate", { ...zero, flood: 0.3, salinity: 0.25 })).toBeCloseTo(0.45, 10);
    expect(lgdFor("None", zero)).toBe(0.7);
  });
  it("converts annual PD to lifetime PD", () => {
    expect(lifetimePd(0.1, 12)).toBeCloseTo(0.1, 10);
    expect(lifetimePd(0.1, 24)).toBeCloseTo(0.19, 10);
    expect(lifetimePd(1, 6)).toBe(1);
  });
  it("IRB retail K is positive, increasing in LGD and zero for defaulted exposures", () => {
    const k = irbRetailK(0.02, 0.45);
    expect(k).toBeGreaterThan(0.03);
    expect(k).toBeLessThan(0.15);
    expect(irbRetailK(0.02, 0.6)).toBeGreaterThan(k);
    expect(irbRetailK(1, 0.45)).toBe(0);
  });
});

function history(years: number, f: (y: number, doy: number) => { rain: number; tmax?: number; dis?: number }): DailyHistory {
  const time: string[] = [];
  const rain: number[] = [];
  const tmax: number[] = [];
  const dis: number[] = [];
  for (let t = Date.UTC(1995, 0, 1), end = Date.UTC(1995 + years, 0, 1); t < end; t += 86_400_000) {
    const d = new Date(t);
    const doy = Math.floor((t - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000);
    const v = f(d.getUTCFullYear(), doy);
    time.push(d.toISOString().slice(0, 10));
    rain.push(v.rain);
    tmax.push(v.tmax ?? 30);
    dis.push(v.dis ?? 100);
  }
  // one extra day so the last full year counts as complete
  time.push(`${1995 + years}-01-01`);
  rain.push(0);
  tmax.push(30);
  dis.push(100);
  return { lat: 10, lon: 105.8, provider: "ERA5", era5Cell: null, glofasCell: null, elevationM: 2, time, rain, tmax, et0: rain.map(() => 4), gust: rain.map(() => 20), discharge: dis, fetchedAt: "", source: "live" };
}

describe("hazard frequencies from reanalysis", () => {
  it("counts severe flood years (absolute floor and local 1-in-5) and river peaks", () => {
    // 20 years; 4 years get a 300 mm 5-day spell; 2 other years a river peak 3× normal
    const h = history(20, (y, doy) => ({ rain: [1996, 2000, 2004, 2008].includes(y) && doy >= 200 && doy < 205 ? 60 : 3, dis: [2010, 2012].includes(y) && doy === 250 ? 400 : 100 }));
    const f = hazardFrequencies(h, { flood: 1, salinity: 0 }, 1995);
    expect(f.years).toBe(20);
    expect(f.flood).toBeCloseTo(6 / 20, 6); // exposure 1 → factor 1
    expect(f.salinity).toBe(0);
    expect(f.evidence.flood).toMatch(/6 of 20/);
  });
  it("detects drought years below 75 % of median annual rain", () => {
    const h = history(20, (y) => ({ rain: [1997, 2003].includes(y) ? 2 : 5 }));
    const f = hazardFrequencies(h, { flood: 0.5, salinity: 0.8 }, 1995);
    expect(f.drought).toBeCloseTo(2 / 20, 6);
    expect(f.salinity).toBeGreaterThan(0);
  });
});

describe("loan assessment & portfolio", () => {
  it("explains drivers, downgrades a hazard-exposed loan and computes EL = PD·LGD·EAD", () => {
    const a = loanAsset();
    const l = assessLoan(a, { freq: { flood: 0.5, drought: 0.2, salinity: 0.4, heat: 0, years: 30, evidence: { flood: "x", drought: "y", salinity: "z", heat: "w" } }, exposure: { flood: 0.8, salinity: 0.8 } }, "Test", "Test");
    expect(l.pdClimate).toBeGreaterThan(l.pdBase);
    expect(l.notches).toBeGreaterThanOrEqual(1);
    expect(l.elUsd).toBeCloseTo(l.pdClimate * l.lgd * l.eadUsd, 6);
    expect(l.elBaseUsd).toBeCloseTo(0.025 * 0.35 * 10_000, 6);
    expect(l.drivers.length).toBeGreaterThan(0);
    expect(l.drivers.join(" ")).toMatch(/Flood/);
    const sum = portfolioSummary([l, assessLoan(loanAsset({ id: "b", crop: "coconut" }, { internalRating: "A" }), { freq: null, exposure: { flood: 0.1, salinity: 0 } }, "Other", "Other")]);
    expect(sum.loans).toBe(2);
    expect(sum.elUsd).toBeGreaterThan(sum.elBaseUsd);
    expect(sum.byRating.find((r) => r.rating === "BBB")!.baseCount).toBe(1);
  });
  it("stress scenarios never reduce expected loss and 1-in-50 ≥ 1-in-10", () => {
    const l = assessLoan(loanAsset(), { freq: { flood: 0.15, drought: 0.1, salinity: 0.2, heat: 0.05, years: 30, evidence: { flood: "", drought: "", salinity: "", heat: "" } }, exposure: { flood: 0.7, salinity: 0.6 } }, "T", "T");
    const f10 = stressLoan(l, "flood_10", null);
    const f50 = stressLoan(l, "flood_50", null);
    expect(f10.el).toBeGreaterThanOrEqual(l.elUsd);
    expect(f50.el).toBeGreaterThanOrEqual(f10.el);
    for (const sc of ["drought", "salinity", "ssp585_2050"] as const) expect(stressLoan(l, sc, null).el).toBeGreaterThanOrEqual(l.elUsd - 1e-9);
  });
});

describe("CMIP6 change factors", () => {
  it("measures more heavy-rain and hot days in a warmer, wetter future", () => {
    const time: string[] = [];
    const rain: number[] = [];
    const tmax: number[] = [];
    for (let y = 1995; y <= 2050; y++)
      for (let d = 0; d < 365; d++) {
        time.push(`${y}-${String(Math.floor(d / 31) + 1).padStart(2, "0")}-01`);
        const fut = y >= 2031;
        rain.push(d % (fut ? 25 : 50) === 0 ? 100 : 2);
        tmax.push(fut && d % 10 === 0 ? 36 : 32);
      }
    const s = climateShiftFromSeries(time, rain, tmax);
    expect(s.heavyRainFreqFactor).toBeGreaterThan(1.5);
    expect(s.hotDaysDelta).toBeGreaterThan(30);
    expect(s.meanTmaxDeltaC).toBeGreaterThan(0);
  });
});
