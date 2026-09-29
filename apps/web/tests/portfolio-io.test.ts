/**
 * Portfolio import/export parsing edge cases (CSV + GeoJSON).
 */
import { describe, expect, it } from "vitest";
import {
  CSV_TEMPLATE,
  assetsToCsv,
  assetsToGeoJson,
  csvCell,
  detectFormat,
  geometryCentroid,
  parseCoord,
  parseCsv,
  parseImport,
  parseMoney,
  ringAreaM2,
  type ExportAsset,
} from "@/server/services/portfolio-io";

describe("CSV tokenizer", () => {
  it("handles quotes, escaped quotes, embedded newlines, CRLF and BOM", () => {
    const { rows } = parseCsv('﻿name,address\r\n"Plot ""A""","Line 1\nLine 2, Khulna"\r\nB,x\r\n\r\n');
    expect(rows).toEqual([
      ["name", "address"],
      ['Plot "A"', "Line 1\nLine 2, Khulna"],
      ["B", "x"],
    ]);
  });
  it("sniffs semicolon and tab delimiters", () => {
    expect(parseCsv("lat;lon;name\n1,5;2,5;x").delimiter).toBe(";");
    expect(parseCsv("lat\tlon\n1\t2").delimiter).toBe("\t");
  });
});

describe("value coercion", () => {
  it("parses coordinates in many notations", () => {
    expect(parseCoord("22,75")).toBe(22.75);
    expect(parseCoord(" 89.5 ")).toBe(89.5);
    expect(parseCoord("22°30'N")).toBeCloseTo(22.5);
    expect(parseCoord("10°15'30\"S")).toBeCloseTo(-10.2583, 3);
    expect(parseCoord("105.2E")).toBe(105.2);
    expect(parseCoord("12.3W")).toBe(-12.3);
    expect(parseCoord("abc")).toBeNull();
    expect(parseCoord("")).toBeNull();
  });
  it("parses money with symbols, separators and suffixes", () => {
    expect(parseMoney("$1,200")).toBe(1200);
    expect(parseMoney("1.2k")).toBe(1200);
    expect(parseMoney("3.5M")).toBe(3_500_000);
    expect(parseMoney("1.250.000,50")).toBe(1250000.5);
    expect(parseMoney("1250,50")).toBe(1250.5);
    expect(parseMoney("USD 900")).toBe(900);
    expect(parseMoney("n/a")).toBeNull();
  });
});

describe("CSV import", () => {
  it("auto-detects column aliases and builds assets", () => {
    const r = parseImport("Site Name,Latitude,Lng,Sum Insured,Crop,Policy No,Tags,Farmer\nNorth block,22.7,90.35,\"$12,500\",Paddy,POL-1,coastal;parametric,Rahim", { defaultType: "insured_plot" });
    expect(r.format).toBe("csv");
    expect(r.fatal).toBeNull();
    expect(r.mapping).toMatchObject({ "Site Name": "name", Latitude: "lat", Lng: "lon", "Sum Insured": "value", Crop: "crop", "Policy No": "ref", Tags: "tags", Farmer: null });
    const a = r.rows[0]!.asset;
    expect(a).toMatchObject({ name: "North block", lat: 22.7, lon: 90.35, valueUsd: 12500, crop: "rice", externalRef: "POL-1", tags: ["coastal", "parametric"], type: "insured_plot" });
    expect(a.meta).toEqual({ Farmer: "Rahim" });
    expect(r.validCount).toBe(1);
  });

  it("reports a fatal error when there are no location columns", () => {
    const r = parseImport("name,value\nx,1");
    expect(r.fatal).toMatch(/location columns/);
    expect(r.rows).toHaveLength(0);
  });

  it("validates ranges, Null Island, swapped coordinates and bad numbers", () => {
    const r = parseImport("name,lat,lon,value\nbad lat,95,190,1\nnull island,0,0,1\nswapped,90.4,23.1,1\nnotnum,abc,90,1\nneg,22,90,-5");
    const [badLat, nullIsland, swapped, notNum, neg] = r.rows;
    expect(badLat!.errors.join()).toMatch(/Latitude 95/);
    expect(nullIsland!.errors.join()).toMatch(/Null Island/);
    expect(swapped!.errors).toHaveLength(0);
    expect(swapped!.warnings.join()).toMatch(/swapped/);
    expect(swapped!.asset).toMatchObject({ lat: 23.1, lon: 90.4 });
    expect(notNum!.errors.join()).toMatch(/not a number/);
    expect(neg!.errors.join()).toMatch(/negative/);
    expect(r.errorCount).toBe(4);
  });

  it("marks address-only rows for geocoding and errors rows with neither", () => {
    const r = parseImport('name,lat,lon,address\nA,,,"Kalapara, Bangladesh"\nB,,,');
    expect(r.rows[0]!.needsGeocode).toBe(true);
    expect(r.rows[0]!.errors).toHaveLength(0);
    expect(r.rows[1]!.errors.join()).toMatch(/No coordinates and no address/);
    expect(r.geocodeCount).toBe(1);
  });

  it("supports a single coordinates column and semicolon files with decimal commas", () => {
    expect(parseImport('name,coordinates\nX,"22.5, 89.1"').rows[0]!.asset).toMatchObject({ lat: 22.5, lon: 89.1 });
    const r = parseImport("naam;lat;lon;waarde\nY;10,25;105,97;1.250,50");
    expect(r.rows[0]!.asset).toMatchObject({ lat: 10.25, lon: 105.97 });
  });

  it("flags duplicates inside the file (reference and name+location)", () => {
    const r = parseImport("name,lat,lon,ref\nA,22,90,R1\nB,23,91,R1\nA,22,90,\n");
    expect(r.rows[1]!.errors.join()).toMatch(/Duplicate reference "R1"/);
    expect(r.rows[2]!.errors.join()).toMatch(/Duplicate of row 1/);
  });

  it("warns on unknown type/crop, defaults names, and maps synonyms", () => {
    const r = parseImport("lat,lon,type,crop,ref\n22,90,spaceship,quinoa,REF-9\n22.1,90.1,godown,corn,", { defaultType: "farm" });
    expect(r.rows[0]!.asset).toMatchObject({ type: "farm", crop: null, name: "REF-9" });
    expect(r.rows[0]!.warnings.join()).toMatch(/Unknown type/);
    expect(r.rows[0]!.warnings.join()).toMatch(/Unknown crop/);
    expect(r.rows[1]!.asset).toMatchObject({ type: "warehouse", crop: "maize", name: "Asset 2" });
  });

  it("parses the downloadable template", () => {
    const r = parseImport(CSV_TEMPLATE);
    expect(r.fatal).toBeNull();
    expect(r.validCount).toBe(3);
    expect(r.geocodeCount).toBe(1);
  });
});

describe("GeoJSON import", () => {
  it("reads Points and Polygons (centroid + area) with property aliases", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [90.35, 22.7] }, properties: { name: "P1", value_usd: 1000, tags: ["a", "b"] } },
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[90, 22], [90.01, 22], [90.01, 22.01], [90, 22.01], [90, 22]]] },
          properties: { Name: "Field 7", crop: "rice" },
        },
        { type: "Feature", geometry: null, properties: { name: "no geom" } },
      ],
    };
    const r = parseImport(JSON.stringify(fc));
    expect(r.format).toBe("geojson");
    expect(r.rows[0]!.asset).toMatchObject({ name: "P1", lat: 22.7, lon: 90.35, valueUsd: 1000, tags: ["a", "b"] });
    const f = r.rows[1]!.asset;
    expect(f.lat).toBeCloseTo(22.005, 3);
    expect(f.lon).toBeCloseTo(90.005, 3);
    // 0.01° × 0.01° at 22°N ≈ 1.113 km × 1.032 km ≈ 114.8 ha
    expect(f.areaHa!).toBeGreaterThan(110);
    expect(f.areaHa!).toBeLessThan(120);
    expect(r.rows[2]!.errors.join()).toMatch(/No coordinates/);
  });

  it("accepts a bare Feature or geometry and rejects invalid JSON", () => {
    expect(parseImport(JSON.stringify({ type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: { name: "x" } })).rows[0]!.asset.lat).toBe(2);
    expect(parseImport(JSON.stringify({ type: "Point", coordinates: [105, 10] })).rows).toHaveLength(1);
    expect(parseImport("{ not json").fatal).toMatch(/Invalid JSON/);
    expect(parseImport(JSON.stringify({ type: "FeatureCollection", features: [] })).fatal).toMatch(/No GeoJSON features/);
  });

  it("MultiPolygon centroid is area-weighted", () => {
    const c = geometryCentroid({ type: "MultiPolygon", coordinates: [[[[0, 10], [1, 10], [1, 11], [0, 11], [0, 10]]], [[[10, 10], [10.1, 10], [10.1, 10.1], [10, 10.1], [10, 10]]]] });
    expect(c!.lon).toBeLessThan(1);
    expect(ringAreaM2([[0, 0], [1, 0]])).toBe(0);
  });

  it("detects the format from content", () => {
    expect(detectFormat('  {"type":"FeatureCollection"}')).toBe("geojson");
    expect(detectFormat("lat,lon")).toBe("csv");
  });
});

describe("export", () => {
  const row: ExportAsset = { id: "ast_1", name: '=HYPERLINK("x")', type: "farm", externalRef: null, lat: 22.5, lon: 90.1, address: "a, b", country: "Bangladesh", crop: "rice", areaHa: 1.2, valueUsd: 1000, tags: ["x", "y"], composite: 61, level: "high", floodRisk: 70, salinityRisk: 20, droughtRisk: 5, heatRisk: 0, valueAtRiskUsd: 250, change7d: -3, assessedAt: null, scoreSource: "live" };
  it("CSV neutralises formula injection and quotes separators", () => {
    const csv = assetsToCsv([row]);
    expect(csv.split("\n")[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"a, b"');
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(["x", "y"])).toBe("x;y");
  });
  it("GeoJSON uses [lon, lat] order", () => {
    const g = assetsToGeoJson([row]);
    expect(g.features[0]!.geometry.coordinates).toEqual([90.1, 22.5]);
    expect(g.features[0]!.properties).not.toHaveProperty("lat");
  });
});
