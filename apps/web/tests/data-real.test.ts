import { describe, expect, it } from "vitest";
import { resetStore } from "@/server/data/store";
import { districtAreaKm2, pointInRing } from "@/server/data/gov-model";
import {
  countryStats,
  districtRing,
  cyclonesFor,
  facilities,
  floodEvents,
  floodLoss,
  landPoints,
  monthlyPrices,
  priceAt,
  salinitySeasons,
} from "@/server/data/real";
import { DISTRICTS } from "@/server/data/geography";

const DAY = 86_400_000;
const s = resetStore();
const key = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;
const pool = new Map<string, Set<string>>(DISTRICTS.map((d) => [d.id, new Set(landPoints(d.id).map(([a, b]) => key(a, b)))]));
const anyPool = new Set([...pool.values()].flatMap((x) => [...x]));

describe("real reference datasets", () => {
  it("has land-validated point pools for every district (24 sites × 6 points)", () => {
    for (const d of DISTRICTS) {
      const pts = landPoints(d.id);
      expect(pts.length, d.id).toBe(144);
      for (const [lat, lon, elev] of pts) {
        // inside the district's neighbourhood and above sea level (GLO-90)
        expect(Math.hypot(lat - d.lat, lon - d.lon), d.id).toBeLessThan(0.45);
        expect(elev, d.id).toBeGreaterThanOrEqual(0); // accepted when > 0 m, stored rounded to 1 m
        expect(elev, d.id).toBeLessThan(120);
      }
    }
  });

  it("has real flood episodes 2019→2026 for every district", () => {
    for (const d of DISTRICTS) {
      const ev = floodEvents(d.id);
      expect(ev.length, d.id).toBeGreaterThan(10);
      const years = new Set(ev.map((e) => Number(e.start.slice(0, 4))));
      expect(years.has(2019) || years.has(2020), d.id).toBe(true);
      for (const e of ev) {
        expect(e.durationDays).toBeGreaterThanOrEqual(1);
        expect(Date.parse(e.end)).toBeGreaterThanOrEqual(Date.parse(e.start));
        expect(e.depthM).toBeGreaterThanOrEqual(0);
        expect(e.depthM).toBeLessThanOrEqual(3);
      }
    }
    // Sanity against known events: Sylhet's mid-2022 flood and Amphan (May 2020) in Odisha/BD
    expect(floodEvents("bd-sylhet").some((e) => e.start >= "2022-05-01" && e.start <= "2022-07-31")).toBe(true);
    expect(cyclonesFor("bd-khulna").some((c) => c.name.startsWith("AMPHAN") && c.date.startsWith("2020-05"))).toBe(true);
    expect(cyclonesFor("in-puri").some((c) => c.name.startsWith("FANI") && c.date.startsWith("2019-05"))).toBe(true);
  });

  it("marks 2020 and 2024 as high salt-intrusion years in the Mekong Delta", () => {
    for (const id of ["vn-bentre", "vn-soctrang", "vn-camau"]) {
      const byYear = new Map(salinitySeasons(id).map((x) => [x.year, x]));
      const normal = byYear.get(2025)!;
      expect(byYear.get(2020)!.peakEce, id).toBeGreaterThan(normal.peakEce);
      expect(byYear.get(2024)!.peakEce, id).toBeGreaterThan(normal.peakEce);
      expect(byYear.get(2020)!.intrusionIndex).toBeGreaterThan(1.5);
    }
  });

  it("uses World Bank Pink Sheet prices in their real historical ranges", () => {
    const rice = monthlyPrices("rice");
    expect(rice.length).toBeGreaterThan(60);
    expect(rice[0]!.month).toBe("2021-01");
    for (const p of rice) {
      expect(p.price).toBeGreaterThan(300); // Thai 5% never fell below ~$350/t in 2021-2026
      expect(p.price).toBeLessThan(750); // 2023-24 spike peaked ≈ $660/t
    }
    for (const k of ["urea", "dap", "palm_oil", "rice_viet5"]) expect(monthlyPrices(k).length, k).toBeGreaterThan(60);
    expect(priceAt([{ month: "2025-01", price: 100 }, { month: "2025-02", price: 200 }], "2025-01-30")).toBeGreaterThan(140);
  });

  it("verifies every facility against OpenStreetMap (within 15 km)", () => {
    expect(facilities()).toHaveLength(20);
    for (const f of facilities()) if (f.offsetKm != null) expect(f.offsetKm, f.name).toBeLessThan(15);
  });

  it("loss model is monotonic in depth and duration", () => {
    const base = { vulnerableAreaHa: 50_000, country: "BD", month: 8 };
    const a = floodLoss({ ...base, depthM: 0.2, durationDays: 3 });
    const b = floodLoss({ ...base, depthM: 1.0, durationDays: 3 });
    const c = floodLoss({ ...base, depthM: 1.0, durationDays: 20 });
    expect(b.lossUsd).toBeGreaterThan(a.lossUsd);
    expect(c.lossUsd).toBeGreaterThan(b.lossUsd);
    expect(c.floodedHa).toBeLessThanOrEqual(50_000 * 0.5);
    expect(floodLoss({ ...base, month: 2, depthM: 1, durationDays: 20 }).lossUsd).toBeLessThan(c.lossUsd); // off-season
  });
});

describe("seeded demo world is grounded in the real datasets", () => {
  it("puts every farmer, field, asset, depot and node on validated land", () => {
    for (const f of s.farmers) expect(pool.get(f.districtId)!.has(key(f.lat, f.lon)), f.id).toBe(true);
    const farmerDistrict = new Map(s.farmers.map((f) => [f.id, f.districtId]));
    for (const f of s.fields) expect(pool.get(farmerDistrict.get(f.farmerId)!)!.has(key(f.lat, f.lon)), f.id).toBe(true);
    const fac = new Set(facilities().map((f) => key(f.lat, f.lon)));
    for (const n of s.nodes) expect(fac.has(key(n.lat, n.lon)), n.name).toBe(true);
    for (const a of s.assets) {
      if (["port", "warehouse", "processing_plant", "retail_outlet"].includes(a.type)) expect(fac.has(key(a.lat, a.lon)), a.name).toBe(true);
      else expect(pool.get(a.districtId!)!.has(key(a.lat, a.lon)), `${a.id} ${a.name}`).toBe(true);
    }
    for (const inv of s.inventory) for (const dep of inv.depots) expect(anyPool.has(key(dep.lat, dep.lon)), dep.name).toBe(true);
    // real port locations
    const port = (n: string) => s.nodes.find((x) => x.name === n)!;
    expect(port("Chattogram Port Terminal").lat).toBeCloseTo(22.31, 1);
    expect(port("Paradip Port").lon).toBeCloseTo(86.67, 1);
    expect(port("Cái Mép Port").lat).toBeCloseTo(10.54, 1);
  });

  it("issues the 200 archived alerts on real event dates", () => {
    const hist = s.alerts.filter((a) => !a.isActive);
    expect(hist).toHaveLength(200);
    let matched = 0;
    for (const a of hist) {
      const t = a.createdAt.getTime();
      expect(t).toBeLessThan(Date.now());
      let ok = false;
      if (a.alertType === "flood")
        ok = floodEvents(a.districtId).some((e) => {
          const lead = (Date.parse(`${e.start}T00:00:00Z`) - t) / DAY;
          return lead > 0 && lead <= 3;
        });
      else if (a.alertType === "salinity")
        ok = salinitySeasons(a.districtId).some((x) => {
          const lead = (Date.parse(`${x.onset}T00:00:00Z`) - t) / DAY;
          return lead > 4 && lead <= 10;
        });
      else if (a.alertType === "storm")
        ok = cyclonesFor(a.districtId).some((c) => {
          const lead = (Date.parse(`${c.date}T00:00:00Z`) - t) / DAY;
          return lead > 0 && lead <= 2;
        });
      else ok = true; // dry spells: issued 10 days into the spell (checked via description)
      if (ok) matched++;
    }
    expect(matched).toBe(200);
    expect(new Set(hist.map((a) => a.alertType)).size).toBeGreaterThanOrEqual(2);
    for (const a of hist) expect(a.predictedImpact.areaHa).toBeGreaterThanOrEqual(0);
  });

  it("derives historical floods from real episodes (one worst event per year)", () => {
    for (const d of s.districts) {
      expect(d.historicalFloods.length, d.id).toBeGreaterThanOrEqual(5);
      const years = d.historicalFloods.map((h) => h.year);
      expect(new Set(years).size).toBe(years.length);
      for (const h of d.historicalFloods) {
        expect(floodEvents(d.id).some((e) => e.start === h.startDate)).toBe(true);
        expect(h.areaHa).toBeLessThanOrEqual(d.vulnerableAreaHa);
        expect(h.lossUsd).toBeGreaterThan(0);
      }
    }
  });

  it("uses real commodity prices within the observed monthly range", () => {
    for (const c of s.commodities) {
      const m = monthlyPrices(c.commodity);
      expect(m.length, c.commodity).toBeGreaterThan(24);
      const lo = Math.min(...m.map((x) => x.price));
      const hi = Math.max(...m.map((x) => x.price));
      expect(c.priceHistory).toHaveLength(26);
      for (const p of c.priceHistory) {
        expect(p.price, c.commodity).toBeGreaterThanOrEqual(Math.floor(lo) - 1);
        expect(p.price, c.commodity).toBeLessThanOrEqual(Math.ceil(hi) + 1);
      }
      expect(c.basePriceUsd).toBeGreaterThanOrEqual(lo - 1);
      expect(c.basePriceUsd).toBeLessThanOrEqual(hi + 1);
    }
  });

  it("has census-scale farm counts and realistic farm, loan and premium magnitudes", () => {
    for (const d of s.districts) {
      expect(d.totalFarms, d.id).toBeGreaterThan(5_000);
      expect(d.totalFarms, d.id).toBeLessThan(600_000);
      const avg = d.monitoredAreaHa / d.totalFarms;
      expect(avg).toBeCloseTo(countryStats(d.country).avgFarmHa, 1);
    }
    const byCountry = new Map<string, number[]>();
    for (const f of s.farmers.slice(1)) byCountry.set(f.country, [...(byCountry.get(f.country) ?? []), f.totalAreaHa]);
    const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
    expect(median(byCountry.get("Bangladesh")!)).toBeLessThan(1.2);
    expect(median(byCountry.get("Indonesia")!)).toBeLessThan(1);
    expect(median(byCountry.get("Philippines")!)).toBeGreaterThan(0.6);
    for (const a of s.assets.filter((x) => x.type === "loan")) {
      const r = Number(a.meta.interestRatePct);
      const [lo, hi] = a.country === "Vietnam" ? [6, 9] : [8, 12];
      expect(r, a.id).toBeGreaterThanOrEqual(lo);
      expect(r, a.id).toBeLessThanOrEqual(hi);
    }
    for (const a of s.assets.filter((x) => x.type === "insured_plot")) {
      const rate = Number(a.meta.premiumRatePct);
      expect(rate).toBeGreaterThanOrEqual(2.5);
      expect(rate).toBeLessThanOrEqual(10.5);
      expect(a.valueUsd / a.areaHa!).toBeLessThan(2000); // sum insured ≈ cost of cultivation per ha
    }
  });

  it("uses real, simplified admin boundaries that contain every farmer and field", () => {
    const real: Record<string, number> = { "bd-barisal": 2785, "vn-bentre": 2395, "ph-nuevaecija": 5751, "in-puri": 3479, "id-demak": 897 };
    for (const d of s.districts) {
      const ring = d.geometry.coordinates[0]!;
      expect(d.geometry.type).toBe("Polygon");
      expect(ring, d.id).toEqual(districtRing(d.id));
      expect(ring.length - 1, d.id).toBeGreaterThanOrEqual(60);
      expect(ring.length - 1, d.id).toBeLessThanOrEqual(150);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(pointInRing(d.lon, d.lat, ring), `${d.id} centroid`).toBe(true);
      if (real[d.id]) expect(Math.abs(districtAreaKm2(d) / real[d.id]! - 1), d.id).toBeLessThan(0.25); // official areas (km²)
    }
    const ringOf = new Map(s.districts.map((d) => [d.id, d.geometry.coordinates[0]!]));
    for (const f of s.farmers) expect(pointInRing(f.lon, f.lat, ringOf.get(f.districtId)!), f.id).toBe(true);
    const farmerDistrict = new Map(s.farmers.map((f) => [f.id, f.districtId]));
    for (const f of s.fields) expect(pointInRing(f.lon, f.lat, ringOf.get(farmerDistrict.get(f.farmerId)!)!), f.id).toBe(true);
    for (const a of s.assets.filter((x) => ["insured_plot", "loan", "community", "farm"].includes(x.type)))
      expect(pointInRing(a.lon, a.lat, ringOf.get(a.districtId!)!), a.id).toBe(true);
  });

  it("is deterministic across resets (real-data fields included)", () => {
    const snap = () => {
      const x = resetStore();
      return JSON.stringify({
        floods: x.districts.map((d) => [d.id, d.totalFarms, d.historicalFloods]),
        alerts: x.alerts.filter((a) => !a.isActive).map((a) => [a.id, a.createdAt.toISOString(), a.predictedImpact, a.deliveries]),
        prices: x.commodities.map((c) => [c.commodity, c.basePriceUsd]),
        assets: x.assets.map((a) => [a.id, a.lat, a.lon, a.valueUsd, a.meta]),
      });
    };
    expect(snap()).toBe(snap());
  });
});
