import { describe, expect, it } from "vitest";
import { getStore, resetStore, nextId, audit, riskLevelFromScore } from "@/server/data/store";
import { DISTRICTS, COUNTRIES } from "@/server/data/geography";

describe("seeded demo store invariants (spec §15)", () => {
  const s = resetStore();

  it("has 50 farmers with 2–5 fields each", () => {
    expect(s.farmers).toHaveLength(50);
    for (const f of s.farmers) {
      const n = s.fields.filter((x) => x.farmerId === f.id).length;
      expect(n, f.id).toBeGreaterThanOrEqual(2);
      expect(n, f.id).toBeLessThanOrEqual(5);
    }
  });

  it("has 5 active alerts (3 flood + 2 salinity) and 200 historical", () => {
    const active = s.alerts.filter((a) => a.isActive);
    expect(active).toHaveLength(5);
    expect(active.filter((a) => a.alertType === "flood")).toHaveLength(3);
    expect(active.filter((a) => a.alertType === "salinity")).toHaveLength(2);
    expect(s.alerts.filter((a) => !a.isActive)).toHaveLength(200);
  });

  it("has 20 supply-chain nodes, 22 districts in 5 countries", () => {
    expect(s.nodes).toHaveLength(20);
    expect(s.districts).toHaveLength(DISTRICTS.length);
    expect(s.districts).toHaveLength(22);
    expect(new Set(s.districts.map((d) => d.country)).size).toBe(COUNTRIES.length);
  });

  it("has the demo accounts from spec §15", () => {
    for (const email of ["farmer@demo.agrishield.io", "gov@demo.agrishield.io", "supply@demo.agrishield.io", "admin@demo.agrishield.io"])
      expect(s.users.some((u) => u.email === email), email).toBe(true);
    const ratan = s.farmers.find((f) => f.userId === "user-farmer-demo")!;
    expect(ratan.districtId).toBe("bd-barisal");
    expect(s.fields.filter((f) => f.farmerId === ratan.id).map((f) => f.cropType)).toEqual(["rice", "jute"]);
  });

  it("keeps referential integrity", () => {
    const users = new Set(s.users.map((u) => u.id));
    const farmers = new Set(s.farmers.map((f) => f.id));
    const districts = new Set(s.districts.map((d) => d.id));
    const fields = new Set(s.fields.map((f) => f.id));
    const nodes = new Set(s.nodes.map((n) => n.id));
    for (const f of s.farmers) {
      expect(users.has(f.userId)).toBe(true);
      expect(districts.has(f.districtId)).toBe(true);
    }
    for (const f of s.fields) expect(farmers.has(f.farmerId)).toBe(true);
    for (const a of s.alerts) expect(districts.has(a.districtId)).toBe(true);
    for (const r of s.recommendations) expect(fields.has(r.fieldId)).toBe(true);
    for (const fl of s.flows) expect(nodes.has(fl.from) && nodes.has(fl.to)).toBe(true);
    expect(new Set(s.fields.map((f) => f.id)).size).toBe(s.fields.length);
    expect(new Set(s.alerts.map((a) => a.id)).size).toBe(s.alerts.length);
  });

  it("keeps values in physical ranges", () => {
    for (const d of s.districts) {
      expect(d.floodRisk).toBeGreaterThanOrEqual(0);
      expect(d.floodRisk).toBeLessThanOrEqual(100);
      expect(d.floodProb24h).toBeLessThanOrEqual(d.floodProb72h);
      expect(d.riskLevel).toBe(riskLevelFromScore(Math.max(d.floodRisk, d.salinityRisk * 0.9)));
    }
    for (const f of s.fields) {
      expect(f.ndviScore).toBeGreaterThan(-0.2);
      expect(f.ndviScore).toBeLessThan(1);
      expect(f.expectedHarvest.getTime()).toBeGreaterThan(f.plantingDate.getTime());
      expect(f.geometry.coordinates[0]!.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("is deterministic across resets", () => {
    const snap = (x: ReturnType<typeof getStore>) =>
      JSON.stringify({
        farmers: x.farmers.map((f) => [f.id, f.farmName, f.lat, f.lon, f.primaryCrops]),
        fields: x.fields.map((f) => [f.id, f.areaHa, f.cropType, f.geometry, f.floodRisk]),
        users: x.users.map((u) => [u.id, u.name, u.phone, u.role]),
        alerts: x.alerts.map((a) => [a.id, a.alertType, a.severity, a.districtId]),
        nodes: x.nodes.map((n) => [n.id, n.lat, n.lon, n.riskScore]),
      });
    const a = snap(resetStore());
    const b = snap(resetStore());
    expect(a).toBe(b);
  });

  it("supports writes: nextId is unique and audit is capped", () => {
    const st = resetStore();
    const ids = new Set(Array.from({ length: 200 }, () => nextId("x")));
    expect(ids.size).toBe(200);
    for (let i = 0; i < 600; i++) audit({ userId: "u", userName: "U", action: "t.test", entity: "t", entityId: String(i), details: "" });
    expect(st.audit.length).toBe(500);
    expect(st.audit[0]!.entityId).toBe("599");
    expect(getStore()).toBe(st);
  });
});
