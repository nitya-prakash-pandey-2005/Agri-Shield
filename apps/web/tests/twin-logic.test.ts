/**
 * Earth Twin — pure logic: sun position / terminator, track parsing & proximity,
 * timeline bucketing, forecast series, hotspot ranking & captions.
 */
import { describe, expect, it } from "vitest";
import { haversineKm as geoHaversine, isDaylight, latLonToVec3, sampleSeries, slerpPath, solarElevation, sunPosition, terminatorLine, vec3ToLatLon, distanceForSpan } from "@/components/twin/geo";
import {
  bucketEvents,
  categoryFromWind,
  forecastSeries,
  hotspotCaption,
  hotspotScore,
  parseGdacsTrack,
  parseTracks,
  rankHotspots,
  simplifyRing,
  thinTrack,
  trackClosest,
  type HotspotCandidate,
  type TimelineEvent,
  type TrackFile,
} from "@/server/services/twin";
import trackJson from "@/server/data/real/cyclone-tracks.json";

describe("sun position & terminator", () => {
  it("declination ≈ 0 at the March equinox and ≈ +23.44° at the June solstice", () => {
    expect(Math.abs(sunPosition(Date.UTC(2024, 2, 20, 3, 6)).lat)).toBeLessThan(0.1);
    expect(sunPosition(Date.UTC(2024, 5, 20, 20, 51)).lat).toBeCloseTo(23.44, 1);
    expect(sunPosition(Date.UTC(2024, 11, 21, 9, 20)).lat).toBeCloseTo(-23.44, 1);
  });

  it("sub-solar longitude tracks UTC noon within the equation of time (±4.5°)", () => {
    for (const [m, d] of [[0, 15], [3, 15], [6, 15], [10, 3]] as const) {
      const s = sunPosition(Date.UTC(2025, m, d, 12, 0));
      expect(Math.abs(s.lon)).toBeLessThan(4.5);
    }
    // 06:00 UTC → sun over ~90°E (Bay of Bengal)
    expect(sunPosition(Date.UTC(2025, 3, 15, 6, 0)).lon).toBeGreaterThan(85);
    expect(sunPosition(Date.UTC(2025, 3, 15, 6, 0)).lon).toBeLessThan(95);
  });

  it("solar elevation is 90° at the sub-solar point and daylight flips across the globe", () => {
    const t = Date.UTC(2026, 8, 29, 6, 0);
    const s = sunPosition(t);
    expect(solarElevation(s.lat, s.lon, t)).toBeCloseTo(90, 3);
    expect(isDaylight(23.8, 90.4, t)).toBe(true); // Dhaka at noon local
    expect(isDaylight(40.7, -74, t)).toBe(false); // New York at 02:00 local
  });

  it("terminator points have ~0° solar elevation", () => {
    const t = Date.UTC(2026, 5, 1, 0, 0);
    const line = terminatorLine(t, 37);
    expect(line).toHaveLength(37);
    for (const p of line) expect(Math.abs(solarElevation(p.lat, p.lon, t))).toBeLessThan(0.05);
  });

  it("lat/lon ↔ vector round-trips and slerp stays on the unit sphere", () => {
    for (const [lat, lon] of [[22.7, 90.36], [-6.9, 110.4], [0, -179.5], [60, 10]] as const) {
      const r = vec3ToLatLon(latLonToVec3(lat, lon));
      expect(r.lat).toBeCloseTo(lat, 6);
      expect(r.lon).toBeCloseTo(lon, 6);
    }
    const path = slerpPath({ lat: 22.3, lon: 91.8 }, { lat: 10.5, lon: 107 }, 9);
    expect(path).toHaveLength(9);
    for (const v of path) expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    expect(geoHaversine(22.3, 91.8, 22.3, 91.8)).toBe(0);
    expect(distanceForSpan(300)).toBeLessThan(distanceForSpan(4000));
    expect(sampleSeries([0, 10, 20], 1.5)).toBe(15);
    expect(sampleSeries([0, 10, 20], 9)).toBe(20);
  });
});

describe("cyclone tracks", () => {
  const file = trackJson as unknown as TrackFile;
  const tracks = parseTracks(file);

  it("parses the committed IBTrACS file (Asia-Pacific, ≥ TS strength, absolute times)", () => {
    expect(tracks.length).toBeGreaterThan(50);
    for (const t of tracks) {
      expect(t.points.length).toBeGreaterThanOrEqual(2);
      expect(t.endMs).toBeGreaterThan(t.startMs);
      expect(t.maxWindKt).toBeGreaterThanOrEqual(34);
      expect(t.points.some(([, lat, lon]) => lon >= 60 && lon <= 160 && lat >= -20 && lat <= 45)).toBe(true);
    }
    // real storms that hit the monitored deltas
    expect(tracks.some((t) => t.name === "Remal" && t.season === 2024)).toBe(true);
    expect(tracks.some((t) => t.name === "Yagi" && t.season === 2024 && t.maxCategory >= 4)).toBe(true);
  });

  it("drops malformed rows and fills missing categories from wind", () => {
    const parsed = parseTracks({
      generated: "x",
      source: "x",
      tracks: [
        { id: "a", name: "A", season: 2025, basin: "NI", start: "2025-05-01T00:00Z", maxWindKt: 70, minPresHpa: 980, maxCategory: 1, points: [[0, 15, 88, 40, 1000, 0], [6, 16, 88.5, 70, 980, NaN as unknown as number]] },
        { id: "b", name: "B", season: 2025, basin: "NI", start: "bad", maxWindKt: 70, minPresHpa: null, maxCategory: 1, points: [[0, 1, 1, 1, 1, 1], [6, 1, 1, 1, 1, 1]] },
        { id: "c", name: "C", season: 2025, basin: "NI", start: "2025-05-01T00:00Z", maxWindKt: 70, minPresHpa: null, maxCategory: 1, points: [[0, 1, 1, 1, 1, 1]] },
      ],
    });
    expect(parsed.map((t) => t.id)).toEqual(["a"]);
    expect(parsed[0]!.points[1]![4]).toBe(1);
    expect(parsed[0]!.endMs - parsed[0]!.startMs).toBe(6 * 3_600_000);
  });

  it("category thresholds follow Saffir-Simpson", () => {
    expect([20, 34, 63, 64, 83, 96, 113, 137, null].map((w) => categoryFromWind(w))).toEqual([-1, 0, 0, 1, 2, 3, 4, 5, -1]);
  });

  it("closest approach finds Remal 2024 near coastal Bangladesh", () => {
    const remal = tracks.find((t) => t.name === "Remal" && t.season === 2024)!;
    const c = trackClosest(remal, [{ lat: 22.36, lon: 90.33, name: "Patuakhali" }, { lat: 9.18, lon: 105.15, name: "Cà Mau" }]);
    expect(c.to).toBe("Patuakhali");
    expect(c.km).toBeLessThan(150);
    expect(new Date(c.atMs).toISOString().slice(0, 7)).toBe("2024-05");
  });

  it("thinning keeps the peak and the last fix", () => {
    const pts = Array.from({ length: 11 }, (_, i) => [i * 6, 10 + i, 90, i === 5 ? 120 : 40, i === 5 ? 4 : 0] as [number, number, number, number, number]);
    const thin = thinTrack(pts, 3);
    expect(thin.some((p) => p[3] === 120)).toBe(true);
    expect(thin[thin.length - 1]).toEqual(pts[10]);
    expect(thin.length).toBeLessThan(pts.length);
  });

  it("parses GDACS wind-circle geometry into ordered fixes", () => {
    const circle = (lon: number, lat: number) => {
      const ring = Array.from({ length: 16 }, (_, i) => [lon + Math.cos((i / 16) * 2 * Math.PI), lat + Math.sin((i / 16) * 2 * Math.PI)]);
      return [...ring, ring[0]!];
    };
    const feats = [
      { geometry: { type: "Polygon", coordinates: [circle(134.3, 18.2)] }, properties: { Class: "Point_Polygon_Point_3", key: "09240000" } },
      { geometry: { type: "Polygon", coordinates: [circle(138.4, 16)] }, properties: { Class: "Point_Polygon_Point_0", key: "09230600" } },
      { geometry: { type: "Polygon", coordinates: [circle(100, 0)] }, properties: { Class: "Poly_Red" } },
    ];
    const pts = parseGdacsTrack(feats, 2026);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ lat: 16, lon: 138.4, ms: Date.UTC(2026, 8, 23, 6, 0) });
    expect(pts[1]!.lon).toBeCloseTo(134.3, 1);
  });
});

describe("timeline bucketing", () => {
  const now = Date.UTC(2026, 8, 29, 11, 0);
  const ev = (id: string, at: string, kind: TimelineEvent["kind"], severity: TimelineEvent["severity"]): TimelineEvent => ({ id, at, kind, severity, title: id, lat: null, lon: null, href: null });

  it("buckets by UTC day with offsets relative to today, counting all and keeping the worst", () => {
    const b = bucketEvents(
      [
        ev("a", "2026-09-29T01:00:00Z", "alert", "watch"),
        ev("b", "2026-09-29T23:59:00Z", "hazard", "critical"),
        ev("c", "2026-09-28T12:00:00Z", "flood", "warning"),
        ev("d", "2026-08-01T00:00:00Z", "alert", "critical"), // outside window
        ev("e", "2026-10-15T00:00:00Z", "cyclone", "warning"), // +16
        ev("f", "not a date", "alert", "critical"),
      ],
      now,
      -30,
      16
    );
    expect(b).toHaveLength(47);
    expect(b[0]!.offset).toBe(-30);
    expect(b[0]!.date).toBe("2026-08-30");
    const today = b.find((x) => x.offset === 0)!;
    expect(today.date).toBe("2026-09-29");
    expect(today.counts.alert).toBe(1);
    expect(today.counts.hazard).toBe(1);
    expect(today.worst).toBe("critical");
    expect(today.events[0]!.id).toBe("b");
    expect(b.find((x) => x.offset === -1)!.counts.flood).toBe(1);
    expect(b[b.length - 1]!.counts.cyclone).toBe(1);
    expect(b.reduce((t, x) => t + x.counts.alert, 0)).toBe(1);
  });

  it("caps the events kept per day but not the counts", () => {
    const many = Array.from({ length: 10 }, (_, i) => ev(`x${i}`, "2026-09-29T05:00:00Z", "alert", i === 7 ? "critical" : "info"));
    const [b] = bucketEvents(many, now, 0, 0, 3);
    expect(b!.counts.alert).toBe(10);
    expect(b!.events).toHaveLength(3);
    expect(b!.events[0]!.id).toBe("x7");
  });
});

describe("forecast series", () => {
  const d = { id: "bd-khulna", floodRisk: 40, salinityRisk: 50, floodProb24h: 60, floodProb48h: 70, floodProb72h: 80, ecCurrent: 4, ecPredicted30d: 7 };
  it("is continuous with today, moves to the 72 h probability, then relaxes to climatology", () => {
    const s = forecastSeries(d, Date.UTC(2026, 8, 29), 16, () => 0.1);
    expect(s).toHaveLength(17);
    expect(Math.abs(s[1]! - s[0]!)).toBeLessThan(15); // no jump at "now"
    expect(s[3]!).toBeGreaterThan(s[1]!); // rising to the 72 h peak
    expect(s[16]!).toBeLessThan(s[3]!); // relaxes toward the (low) climatology
    for (const v of s) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of s) expect(v).toBeLessThanOrEqual(100);
    const wet = forecastSeries(d, Date.UTC(2026, 8, 29), 16, () => 0.9);
    expect(wet[16]!).toBeGreaterThan(s[16]!);
  });
});

describe("hotspot ranking & captions", () => {
  const base = (over: Partial<HotspotCandidate>): HotspotCandidate => ({ id: "x", kind: "district", targetId: "x", name: "X", lat: 10, lon: 105, severity: 50, impact: 0.2, ageHours: 0, facts: {}, ...over });

  it("scores severity × impact × recency", () => {
    expect(hotspotScore({ severity: 80, impact: 1, ageHours: 0 })).toBeGreaterThan(hotspotScore({ severity: 80, impact: 0.1, ageHours: 0 }));
    expect(hotspotScore({ severity: 80, impact: 0.5, ageHours: 72 })).toBeCloseTo(hotspotScore({ severity: 80, impact: 0.5, ageHours: 0 }) / 2, 0);
    expect(hotspotScore({ severity: 0, impact: 1, ageHours: 0 })).toBe(0);
  });

  it("ranks, de-duplicates nearby hotspots of the same kind and limits", () => {
    const hs = rankHotspots(
      [
        base({ id: "a", name: "An Giang", lat: 10.52, lon: 105.13, severity: 72, impact: 0.3 }),
        base({ id: "b", name: "Near An Giang", lat: 10.6, lon: 105.2, severity: 60, impact: 0.3 }), // same kind, ~12 km
        base({ id: "c", name: "Cà Mau", lat: 9.18, lon: 105.15, severity: 90, impact: 0.4 }),
        base({ id: "d", kind: "hazard", name: "Flood", lat: 12, lon: 105, severity: 30, impact: 0 }),
        base({ id: "z", name: "Zero", severity: 0 }),
      ],
      { limit: 3 }
    );
    expect(hs.map((h) => h.id)).toEqual(["c", "a", "d"]);
    expect(hs[0]!.rank).toBe(1);
    expect(hs[0]!.href).toContain("/app/explorer?lat=9.1800&lon=105.1500");
  });

  it("writes data-driven captions", () => {
    expect(hotspotCaption(base({ name: "Mekong — An Giang", facts: { dischargeRatio: 2.14, count: 17, noun: "loans", nounSingular: "loan", exposureUsd: 2_300_000 } })).caption).toBe(
      "Mekong — An Giang: river discharge 2.1× normal — 17 loans exposed ($2.3M)"
    );
    expect(hotspotCaption(base({ name: "Khulna", facts: { ecCurrent: 6.2, floodProb72h: 10, farms: 120000 } })).caption).toBe(
      "Khulna: soil salinity 6.2 dS/m — above the rice limit of 3 — 120,000 farms in the district"
    );
    expect(hotspotCaption(base({ kind: "cyclone", name: "Cyclone Remal", facts: { category: 1, windKt: 75, active: false, date: "2024-05-26", distanceKm: 42, nearestName: "Patuakhali" } })).caption).toBe(
      "Cyclone Remal (Category 1, 75 kt) passed 2024-05-26 — closest 42 km to Patuakhali"
    );
    expect(hotspotCaption(base({ kind: "hazard", name: "Flood in Assam", facts: { hazardType: "flood", alertLevel: "orange", distanceKm: 210, nearestName: "Sylhet", count: 1, noun: "communities", nounSingular: "community" } })).caption).toBe(
      "Flood in Assam: flood Orange alert, 210 km from Sylhet — 1 community within 300 km"
    );
  });

  it("simplifies rings and keeps them closed", () => {
    const ring = Array.from({ length: 200 }, (_, i) => [90 + Math.cos(i / 32), 22 + Math.sin(i / 32)]);
    const r = simplifyRing(ring, 40);
    expect(r.length).toBeLessThanOrEqual(42);
    expect(r[0]).toEqual(r[r.length - 1]);
  });
});
