/**
 * Satellite Lab — web-mercator tile maths, GIBS URLs and availability helpers.
 */
import { describe, expect, it } from "vitest";
import {
  LAYERS,
  addDays,
  gibsTileUrl,
  isAvailable,
  latestAvailable,
  lonLatToTileFrac,
  metresPerPixel,
  nearestAvailable,
  parseTimeValue,
  pixelToLonLat,
  stepDates,
  tileBounds,
  tileFor,
  tileFracToLonLat,
  tilesCovering,
  zoomForBBox,
} from "@/components/imagery/tile-math";

describe("tile maths", () => {
  it("maps (0,0) to the centre of the world", () => {
    expect(lonLatToTileFrac(0, 0, 1)).toEqual({ x: 1, y: 1 });
    const t = tileFor(0, 0, 1);
    expect([t.x, t.y, t.px, t.py]).toEqual([1, 1, 0, 0]);
    expect(tileFor(0.0001, -0.0001, 1)).toMatchObject({ x: 0, y: 0, px: 255, py: 255 });
  });

  it("finds Dhaka on the z9 tile the GIBS flood layer serves", () => {
    const t = tileFor(23.8, 90.4, 9);
    expect(t.x).toBe(384);
    expect(t.y).toBe(221);
    expect(t.px).toBeGreaterThanOrEqual(0);
    expect(t.px).toBeLessThan(256);
  });

  it("round-trips lat/lon → tile pixel → lat/lon within half a pixel", () => {
    for (const [lat, lon] of [
      [23.81, 90.41],
      [10.03, 105.77],
      [-6.2, 106.8],
      [51.5, -0.12],
      [-33.9, 151.2],
    ] as const) {
      for (const z of [5, 9, 12]) {
        const t = tileFor(lat, lon, z);
        const back = pixelToLonLat(t.z, t.x, t.y, t.px, t.py);
        const tol = (metresPerPixel(lat, z) / 111_000) * 1.5 + 1e-9;
        expect(Math.abs(back.lat - lat)).toBeLessThan(tol / Math.cos((lat * Math.PI) / 180) + tol);
        expect(Math.abs(back.lon - lon)).toBeLessThan(tol / Math.cos((lat * Math.PI) / 180) + tol);
      }
      const f = lonLatToTileFrac(lat, lon, 7);
      const ll = tileFracToLonLat(f.x, f.y, 7);
      expect(ll.lat).toBeCloseTo(lat, 9);
      expect(ll.lon).toBeCloseTo(lon, 9);
    }
  });

  it("computes tile bounds that contain the point", () => {
    const t = tileFor(23.8, 90.4, 9);
    const b = tileBounds(t.z, t.x, t.y);
    expect(b.south).toBeLessThan(23.8);
    expect(b.north).toBeGreaterThan(23.8);
    expect(b.west).toBeLessThan(90.4);
    expect(b.east).toBeGreaterThan(90.4);
    expect(tileBounds(0, 0, 0).north).toBeCloseTo(85.0511, 3);
  });

  it("lists tiles covering a bbox and picks a zoom within budget", () => {
    const bbox = { south: 22, west: 89, north: 25, east: 92 };
    const tiles = tilesCovering(bbox, 6);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) expect(t.z).toBe(6);
    const z = zoomForBBox(bbox, 9, 16);
    expect(tilesCovering(bbox, z).length).toBeLessThanOrEqual(16);
    expect(tilesCovering(bbox, z + 1).length).toBeGreaterThan(16);
  });

  it("gives ~305 m per z9 pixel at the equator", () => {
    expect(metresPerPixel(0, 9)).toBeCloseTo(305.7, 0);
    expect(metresPerPixel(60, 9)).toBeCloseTo(152.9, 0);
  });

  it("builds GIBS WMTS URLs in z/y/x order", () => {
    expect(gibsTileUrl("modis_flood", "2024-08-25", 9, 385, 220)).toBe(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_Flood_2-Day/default/2024-08-25/GoogleMapsCompatible_Level9/9/220/385.png"
    );
    expect(gibsTileUrl("hls_s30", "2026-09-20", 12, 1, 2)).toContain("GoogleMapsCompatible_Level12/12/2/1.png");
    expect(LAYERS.modis_tc.ext).toBe("jpg");
  });
});

describe("dates & availability", () => {
  it("steps dates", () => {
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(stepDates("2024-08-01", "2024-08-29", 7)).toEqual(["2024-08-01", "2024-08-08", "2024-08-15", "2024-08-22", "2024-08-29"]);
    expect(stepDates("2024-08-10", "2024-08-01", 1)).toEqual([]);
    expect(stepDates("2024-01-01", "2024-12-31", 1, 10)).toHaveLength(10);
  });

  it("parses GIBS time values and snaps to the nearest published date", () => {
    const ranges = ["2021-01-01/2021-01-05/P1D", "2021-03-05/2021-03-07/P1D", "2021-03-22/2021-12-20/P1D", "2022-01-01/2022-03-01/P8D"].map((v) => parseTimeValue(v)!);
    expect(parseTimeValue("2021-01-01")).toEqual({ start: "2021-01-01", end: "2021-01-01", periodDays: 1 });
    expect(ranges[3]!.periodDays).toBe(8);
    expect(isAvailable("2021-01-03", ranges)).toBe(true);
    expect(isAvailable("2021-02-10", ranges)).toBe(false);
    expect(isAvailable("2022-01-09", ranges)).toBe(true);
    expect(isAvailable("2022-01-10", ranges)).toBe(false);
    expect(nearestAvailable("2021-01-20", ranges)).toBe("2021-01-05");
    expect(nearestAvailable("2021-02-10", ranges)).toBe("2021-03-05");
    expect(nearestAvailable("2021-03-01", ranges)).toBe("2021-03-05");
    expect(nearestAvailable("2022-01-12", ranges)).toBe("2022-01-09");
    expect(nearestAvailable("2030-01-01", ranges)).toBe("2022-02-26");
    expect(nearestAvailable("2021-01-03", [])).toBeNull();
    expect(latestAvailable(ranges)).toBe("2022-03-01");
  });
});
