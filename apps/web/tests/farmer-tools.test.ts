import { describe, expect, it } from "vitest";
import { KC_TABLE, effectiveRain, kcOn, planIrrigation, stageLengths, waterVolume, depletionFromMoisture, type DayWeather } from "@/server/services/farm-irrigation";
import { nowcastFrom } from "@/server/services/farm-weather";
import { nextOccurrence, outlookMonth, pickSowingWindow, suggestVarieties } from "@/server/services/farm-season";
import { createWfpAccumulator, splitCsvLine } from "@/server/live/market-prices";
import { alertHit, analyseMarkets, seasonalIndex, sellOrStore } from "@/server/services/farm-market";
import { diagnose, symptomsFor, CAUSES, SYMPTOMS } from "@/server/services/farm-doctor";
import { fertiliserPlan, insuranceBook, ledgerSummary, seasonLabel } from "@/server/services/farm-finance";

const days = (start: string, n: number, f: (i: number) => Partial<DayWeather>, today: string): DayWeather[] =>
  Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    return { date, et0: 5, rainMm: 0, rainProb: null, forecast: date >= today, ...f(i) };
  });

describe("FAO-56 crop coefficients", () => {
  it("scales stage lengths to the season and keeps the total", () => {
    const s = stageLengths("rice", 120);
    expect(s.reduce((a, b) => a + b, 0)).toBe(120);
    expect(stageLengths("coconut", 120)).toEqual(KC_TABLE.coconut.stages);
  });
  it("follows the Kc curve ini → mid → end", () => {
    expect(kcOn("maize", 5, 125).kc).toBe(0.3);
    expect(kcOn("maize", 5, 125).stage).toBe("initial");
    expect(kcOn("maize", 70, 125).kc).toBe(1.2);
    const dev = kcOn("maize", 37, 125);
    expect(dev.stage).toBe("development");
    expect(dev.kc).toBeGreaterThan(0.3);
    expect(dev.kc).toBeLessThan(1.2);
    expect(kcOn("maize", 125, 125).kc).toBeCloseTo(0.5, 2);
    expect(kcOn("coconut", 999, 365).kc).toBe(1);
  });
  it("counts only effective rain", () => {
    expect(effectiveRain(3)).toBe(0);
    expect(effectiveRain(20)).toBe(16);
    expect(effectiveRain(20, 50)).toBe(8);
  });
  it("converts mm to m³ and pump hours", () => {
    expect(waterVolume(25, 2)).toEqual({ m3: 500, pumpHours: 17.4 });
  });
  it("derives depletion from model soil moisture", () => {
    expect(depletionFromMoisture(0.4, "clay")).toBe(0);
    expect(depletionFromMoisture(0.24, "clay")).toBe(1);
    expect(depletionFromMoisture(null, "clay")).toBeNull();
  });
});

describe("irrigation planner", () => {
  const base = { soil: "loam", irrigationType: "canal", plantingDate: "2026-08-01", harvestDate: "2026-12-04", areaHa: 1.5, today: "2026-09-29", logs: [] };
  it("upland: dry hot week triggers irrigation equal to the refill need", () => {
    const plan = planIrrigation({ ...base, crop: "maize", days: days("2026-09-22", 15, () => ({}), "2026-09-29"), initialDepletionFrac: 0.3 });
    expect(plan.mode).toBe("upland");
    expect(plan.next.kind).toBe("irrigate");
    const first = plan.days.find((d) => d.action === "irrigate")!;
    expect(first.irrigationMm).toBeGreaterThan(plan.raw! * 0.9);
    expect(first.irrigationMm).toBeLessThanOrEqual(plan.taw!);
    expect(plan.days.every((d) => d.level >= 0 && d.level <= d.capacity + 0.1)).toBe(true);
  });
  it("upland: heavy forecast rain → no irrigation", () => {
    const plan = planIrrigation({ ...base, crop: "jute", days: days("2026-09-22", 15, (i) => (i >= 7 ? { rainMm: 30, rainProb: 90, et0: 3 } : { rainMm: 25, et0: 3 }), "2026-09-29"), initialDepletionFrac: 0 });
    expect(plan.next.kind).toBe("rain");
    expect(plan.totals.irrigationNext7).toBe(0);
  });
  it("paddy: AWD lets the water drop to −15 cm before re-flooding to +5 cm", () => {
    const plan = planIrrigation({ ...base, crop: "rice", soil: "clay", days: days("2026-09-01", 36, () => ({ et0: 5 }), "2026-09-29"), initialDepletionFrac: 0 });
    expect(plan.mode).toBe("paddy");
    expect(plan.awd?.phase).toBe("awd");
    const irr = plan.days.filter((d) => d.forecast && d.action === "irrigate");
    for (const d of irr) expect(d.level).toBeGreaterThan(0);
    const before = plan.days.filter((d) => !d.forecast);
    expect(Math.min(...before.map((d) => d.level))).toBeLessThan(0);
  });
  it("paddy: drain in the last 14 days", () => {
    const plan = planIrrigation({ ...base, crop: "rice", harvestDate: "2026-10-05", days: days("2026-09-22", 15, () => ({}), "2026-09-29") });
    expect(plan.next.kind).toBe("drain");
  });
  it("logged irrigation reduces depletion", () => {
    const d = days("2026-09-22", 15, () => ({}), "2026-09-29");
    const a = planIrrigation({ ...base, crop: "maize", days: d, initialDepletionFrac: 0.3 });
    const b = planIrrigation({ ...base, crop: "maize", days: d, initialDepletionFrac: 0.3, logs: [{ date: "2026-09-28", mm: 60 }] });
    expect(b.days.find((x) => x.date === "2026-09-28")!.level).toBeLessThan(a.days.find((x) => x.date === "2026-09-28")!.level);
  });
});

describe("nowcast", () => {
  const times = Array.from({ length: 12 }, (_, i) => `2026-09-29T${String(10 + Math.floor((i * 15) / 60)).padStart(2, "0")}:${String((i * 15) % 60).padStart(2, "0")}`);
  it("finds the minutes until rain starts", () => {
    const mm = times.map((_, i) => (i >= 5 ? 0.8 : 0));
    const n = nowcastFrom(times, mm, "2026-09-29T10:05:00");
    expect(n.raining).toBe(false);
    expect(n.rainInMinutes).toBe(55);
    expect(n.peakMmPerHour).toBe(3.2);
  });
  it("reports ongoing rain and when it stops", () => {
    const mm = times.map((_, i) => (i <= 3 ? 1 : 0));
    const n = nowcastFrom(times, mm, "2026-09-29T10:00:00");
    expect(n.raining).toBe(true);
    expect(n.rainInMinutes).toBe(0);
    expect(n.stopsInMinutes).toBe(45);
  });
});

describe("season planner", () => {
  it("handles year-wrapping windows", () => {
    const o = nextOccurrence([12, 15], [2, 10], new Date("2026-01-20T00:00:00Z"));
    expect(o.start.toISOString().slice(0, 10)).toBe("2025-12-15");
    expect(o.end.toISOString().slice(0, 10)).toBe("2026-02-10");
  });
  it("computes rain anomaly % against the model normal", () => {
    const m = outlookMonth("2026-10", 114.4, -30.5, 26.8, 0.6);
    expect(m.rainNormalMm).toBe(144.9);
    expect(m.rainAnomalyPct).toBe(-21);
    expect(outlookMonth("2026-12", 7.9, -0.6, 20.9, 0.9).rainAnomalyPct).toBeNull();
  });
  it("recommends the Boro window with salinity advice for a coastal Bangladesh farm", () => {
    const outlook = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"].map((mo) => outlookMonth(mo, 50, -5, 22, 0.8));
    const r = pickSowingWindow({ crop: "rice", country: "BD", today: new Date("2026-09-29T00:00:00Z"), outlook, floodRisk: 60, salinityRisk: 65, irrigated: true });
    const boro = r.plans.find((p) => p.season.id === "boro")!;
    expect(boro.status).toBe("upcoming");
    expect(boro.reasons.some((x) => x.code === "salinity_dry")).toBe(true);
    expect(boro.harvestFrom! > boro.bestFrom).toBe(true);
  });
  it("suggests salt-tolerant Boro and Sub1 Aman varieties", () => {
    const boro = suggestVarieties({ crop: "rice", country: "BD", seasonId: "boro", floodRisk: 30, salinityRisk: 70, soilEc: 5, droughtSignal: false, heatSignal: false });
    expect(boro[0]!.tolerances).toContain("salinity");
    const aman = suggestVarieties({ crop: "rice", country: "BD", seasonId: "aman", floodRisk: 75, salinityRisk: 10, soilEc: 1, droughtSignal: false, heatSignal: false });
    expect(aman[0]!.tolerances).toContain("submergence");
  });
});

describe("WFP market prices", () => {
  const csv = [
    "date,admin1,admin2,market,market_id,latitude,longitude,category,commodity,commodity_id,unit,priceflag,pricetype,currency,price,usdprice",
    "#date,#adm1+name,#adm2+name,#loc+market+name,#loc+market+code,#geo+lat,#geo+lon,#item+type,#item+name,#item+code,#item+unit,#item+price+flag,#item+price+type,#currency+code,#value,#value+usd",
    '2019-01-15,Barisal,Barisal,Barisal Sadar,1,22.71,90.36,cereals and tubers,"Rice (coarse)",1,KG,actual,Retail,BDT,40,0.5',
  ];
  // 36 months of rice with a seasonal peak in March, and a national average row without coordinates
  for (let i = 0; i < 36; i++) {
    const d = new Date(Date.UTC(2023, 8 + i, 15)).toISOString().slice(0, 10);
    const m = Number(d.slice(5, 7));
    const p = 50 + (m === 3 ? 6 : m === 11 ? -4 : 0) + i * 0.1;
    csv.push(`${d},Barisal,Barisal,Barisal Sadar,1,22.71,90.36,cereals and tubers,"Rice (coarse)",1,KG,actual,Retail,BDT,${p},0.4`);
    csv.push(`${d},Barisal,Bhola,Bhola Sadar,2,22.69,90.64,cereals and tubers,"Rice (coarse)",1,KG,actual,Retail,BDT,${p + 1},0.4`);
    csv.push(`${d},National,,National Average,99,,,cereals and tubers,"Rice (coarse)",1,KG,actual,Retail,BDT,${p},0.4`);
    csv.push(`${d},Barisal,Barisal,Barisal Sadar,1,22.71,90.36,non-food,"Fuel (petrol)",9,L,actual,Retail,BDT,120,1`);
  }
  it("splits quoted CSV fields", () => {
    expect(splitCsvLine('a,"b, c","d ""q"""')).toEqual(["a", "b, c", 'd "q"']);
  });
  it("streams rows, keeps relevant commodities since the cutoff and skips unlocated averages", () => {
    const acc = createWfpAccumulator("BD", "bangladesh", "x", "2023-01-01");
    csv.forEach((l) => acc.line(l));
    const d = acc.result();
    expect(d.series.map((s) => s.group)).toEqual(["rice"]);
    expect(Object.keys(d.markets).sort()).toEqual(["1", "2"]);
    expect(d.obs.length).toBe(72);
    expect(d.lastDate).toBe("2026-08-15");
    const an = analyseMarkets(d, { lat: 22.7011, lon: 90.3637 }, ["rice"], new Date("2026-09-29T00:00:00Z"));
    const rice = an.find((c) => c.key === "rice")!;
    expect(rice.latest!.market).toBe("Barisal Sadar");
    expect(rice.latest!.distanceKm).toBeLessThan(3);
    expect(rice.nearby.map((m) => m.name)).toEqual(["Barisal Sadar", "Bhola Sadar"]);
    expect(rice.seasonality!.find((s) => s.month === 3)!.index).toBeGreaterThan(1.05);
    expect(rice.series.length).toBe(36);
  });
  it("seasonal index needs ≥ 24 months", () => {
    expect(seasonalIndex([{ month: "2025-01", value: 1 }])).toBeNull();
  });
  it("sell-or-store heuristic nets out storage cost", () => {
    const flat = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, index: 1 }));
    expect(sellOrStore({ seasonality: flat, currentMonth: 11, trendPctPerMonth: 0, storable: true }).kind).toBe("sell");
    const peaky = flat.map((s) => (s.month === 2 ? { ...s, index: 1.15 } : s));
    const adv = sellOrStore({ seasonality: peaky, currentMonth: 11, trendPctPerMonth: 0, storable: true });
    expect(adv.kind).toBe("store");
    expect(adv.untilMonth).toBe(2);
    expect(sellOrStore({ seasonality: peaky, currentMonth: 11, trendPctPerMonth: 0, storable: false }).kind).toBe("sell");
  });
  it("price alerts fire on crossing", () => {
    expect(alertHit("above", 50, 52)).toBe(true);
    expect(alertHit("below", 50, 52)).toBe(false);
    expect(alertHit("below", 50, null)).toBe(false);
  });
});

describe("Crop Doctor", () => {
  it("every cause sign refers to a known symptom", () => {
    const ids = new Set(SYMPTOMS.map((s) => s.id));
    for (const c of CAUSES) for (const s of Object.keys(c.signs)) expect(ids.has(s), `${c.id}:${s}`).toBe(true);
  });
  it("ranks blast first for diamond spots on rice, boosted by humidity", () => {
    const r = diagnose("rice", ["diamond_spots"], { humid: true });
    expect(r[0]!.cause.id).toBe("blast");
  });
  it("uses salinity context to separate salt injury from potassium deficiency", () => {
    const withSalt = diagnose("rice", ["white_burnt_tips"], { salinity: true });
    expect(withSalt[0]!.cause.id).toBe("salt_injury");
  });
  it("flood context ranks submergence damage", () => {
    expect(diagnose("jute", ["rotting_after_flood"], { flood: true })[0]!.cause.id).toBe("submergence");
  });
  it("filters symptoms by crop and part", () => {
    expect(symptomsFor("rice", "grain").map((s) => s.id)).toContain("white_head");
    expect(symptomsFor("onion", "leaf").map((s) => s.id)).toContain("purple_lesions_onion");
    expect(symptomsFor("onion", "leaf").map((s) => s.id)).not.toContain("diamond_spots");
  });
});

describe("farm finance", () => {
  it("converts nutrient targets into product kg and cost", () => {
    const p = fertiliserPlan("rice", 1, {}, "BD");
    const urea = p.lines.find((l) => l.product === "urea")!;
    expect(urea.kgPerHa).toBe(174); // 80 kg N / 0.46
    expect(Math.abs(urea.cost - urea.kg * 27)).toBeLessThan(2);
    expect(p.total).toBe(p.lines.reduce((s, l) => s + l.cost, 0));
  });
  it("summarises profit per season and field", () => {
    const e = (over: object) => ({ id: "x", farmerId: "f", season: "Boro 2026", fieldId: "a", date: "2026-02-01", kind: "expense" as const, category: "seed" as const, amount: 100, note: null, sample: false, createdAt: new Date(), ...over });
    const s = ledgerSummary([e({}), e({ kind: "income", category: "sale", amount: 500, date: "2026-05-01" })], [{ id: "a", name: "A", areaHa: 2, cropType: "rice" }]);
    expect(s.seasons[0]!.profit).toBe(400);
    expect(s.seasons[0]!.perField[0]!.profitPerHa).toBe(200);
  });
  it("names seasons", () => {
    expect(seasonLabel("BD", "rice", new Date("2026-07-20"))).toBe("Aman 2026");
    expect(seasonLabel("BD", "rice", new Date("2026-01-10"))).toBe("Boro 2026");
  });
  it("derives the weather-index premium rate from the insurer's book", () => {
    const a = (v: number, prem: number) => ({ workspaceId: "w", type: "insured_plot", crop: "rice", areaHa: 1, valueUsd: v, districtId: "d", status: "active", meta: { product: "Weather-index (rainfall)", premiumUsd: prem } });
    const b = insuranceBook([a(1000, 45), a(2000, 90), { ...a(1000, 80), districtId: "other" }], "w", "Ins", "d")!;
    expect(b.premiumRate).toBe(0.045);
    expect(b.bookPremiumRate).toBe(0.054);
    expect(b.sumInsuredPerHaUsd.rice).toBe(1333);
  });
});
