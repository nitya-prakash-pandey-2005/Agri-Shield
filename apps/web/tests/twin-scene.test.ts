/**
 * Earth Twin — scene/timeline/hotspot assembly against the seeded store (offline:
 * live hazard feeds are unavailable, so the scene must degrade gracefully).
 */
import { describe, expect, it } from "vitest";
import { buildScene, getTimeline, hotspotCandidates, rankHotspots, hotspotHref } from "@/server/services/twin";

const ORGS = ["org-ins-deltamutual", "org-bank-mekong", "org-ngo-brac", "org-sc-asiagrain", "org-gov-bd", "org-coop-odisha"];

describe("twin scene", () => {
  it.each(ORGS)("builds a compact, scoped payload for %s", async (org) => {
    const scene = await buildScene(org);
    const bytes = Buffer.byteLength(JSON.stringify(scene));
    expect(bytes).toBeLessThan(300_000);
    expect(scene.org.id).toBe(org);
    expect(scene.districts.length).toBeGreaterThan(0);
    for (const d of scene.districts) {
      expect(d.ring.length).toBeGreaterThan(3);
      expect(d.composite).toBeGreaterThanOrEqual(0);
    }
    for (const a of scene.assets) {
      expect(a.score).toBeGreaterThanOrEqual(0);
      expect(a.score).toBeLessThanOrEqual(100);
    }
    expect(scene.kpis.assets).toBe(scene.assets.length);
    expect(scene.kpis.atRisk).toBeLessThanOrEqual(scene.kpis.assets);
    expect(scene.feeds.hazards).not.toBe("ok"); // offline in tests
    expect(scene.summary.length).toBeGreaterThan(20);
    // tracks are near the workspace (≤ 700 km) or active
    for (const t of scene.tracks) expect(t.active || t.closestKm <= 700).toBe(true);
  });

  it("government workspace has districts but no assets; supply chain has flows", async () => {
    const gov = await buildScene("org-gov-bd");
    expect(gov.assets).toHaveLength(0);
    expect(gov.districts.every((d) => d.country === "BD")).toBe(true);
    expect(gov.org.assetNoun).toBe("farms");
    const sc = await buildScene("org-sc-asiagrain");
    expect(sc.flows.length).toBeGreaterThan(5);
    expect(sc.flows.every((f) => Number.isFinite(f.from.lat) && Number.isFinite(f.to.lon))).toBe(true);
    const bank = await buildScene("org-bank-mekong");
    expect(bank.flows).toHaveLength(0);
    expect(bank.org.assetNoun).toBe("loans");
  });

  it("ranks hotspots with captions for the tour", async () => {
    for (const org of ["org-bank-mekong", "org-gov-bd", "org-sc-asiagrain"]) {
      const scene = await buildScene(org);
      const hs = rankHotspots(hotspotCandidates(scene), { limit: 8, href: hotspotHref });
      expect(hs.length).toBeGreaterThan(0);
      for (let i = 1; i < hs.length; i++) expect(hs[i - 1]!.score).toBeGreaterThanOrEqual(hs[i]!.score);
      for (const h of hs) expect(h.caption.length).toBeGreaterThan(10);
    }
  });
});

describe("twin timeline", () => {
  it("returns 47 days with aligned asset and district series", async () => {
    const tl = await getTimeline("org-ins-deltamutual");
    expect(tl.days).toHaveLength(47);
    expect(tl.days.filter((d) => d.phase === "today")).toHaveLength(1);
    expect(tl.days[30]!.phase).toBe("today");
    for (const s of tl.assetSeries) expect(s.s).toHaveLength(47);
    for (const s of tl.districtSeries) expect(s.s).toHaveLength(47);
    expect(tl.days.slice(31).every((d) => d.band && d.band[0] <= d.risk && d.band[1] >= d.risk)).toBe(true);
    expect(["live", "climatology"]).toContain(tl.forecast.source);
    const events = tl.days.reduce((t, d) => t + d.counts.flood + d.counts.alert + d.counts.cyclone + d.counts.firing, 0);
    expect(events).toBeGreaterThanOrEqual(0);
  });

  it("clamps the window and works for a district-only (government) workspace", async () => {
    const tl = await getTimeline("org-gov-bd", -7, 3);
    expect(tl.days).toHaveLength(11);
    expect(tl.assetSeries).toHaveLength(0);
    expect(tl.districtSeries.length).toBeGreaterThan(0);
    expect(tl.days.every((d) => d.risk > 0)).toBe(true);
  });
});
