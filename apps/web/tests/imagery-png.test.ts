/**
 * Satellite Lab — PNG decoder (every filter type, palette + tRNS, RGBA,
 * greyscale, low bit depths), MODIS flood pixel classes, capabilities
 * parsing, NDVI anomaly maths and an end-to-end flood scan over a stubbed
 * GIBS tile.
 */
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getStore, resetStore } from "@/server/data/store";
import {
  classifyFloodPixel,
  decodePng,
  describeNdvi,
  extractLayerRanges,
  floodScan,
  lastFloodScan,
  mergeDaySamples,
  ndviAnomalies,
  sampleNeighbourhood,
  verdictFor,
  type NdviComposite,
} from "@/server/services/imagery";
import { tileFor } from "@/components/imagery/tile-math";

// ─── tiny PNG encoder for fixtures ────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Encode raw scanlines (already packed) with the given filter per row. */
function encodePng(opts: { width: number; height: number; colorType: number; bitDepth: number; rows: Uint8Array[]; filters: number[]; plte?: number[]; trns?: number[] }): Buffer {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[opts.colorType]!;
  const bpp = Math.max(1, (channels * opts.bitDepth) >> 3);
  const out: number[] = [];
  opts.rows.forEach((row, y) => {
    const ft = opts.filters[y % opts.filters.length]!;
    const prev = y > 0 ? opts.rows[y - 1]! : new Uint8Array(row.length);
    out.push(ft);
    for (let x = 0; x < row.length; x++) {
      const a = x >= bpp ? row[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      const pred = ft === 0 ? 0 : ft === 1 ? a : ft === 2 ? b : ft === 3 ? (a + b) >> 1 : paeth(a, b, c);
      out.push((row[x]! - pred) & 0xff);
    }
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(opts.width, 0);
  ihdr.writeUInt32BE(opts.height, 4);
  ihdr[8] = opts.bitDepth;
  ihdr[9] = opts.colorType;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    ...(opts.plte ? [chunk("PLTE", Uint8Array.from(opts.plte))] : []),
    ...(opts.trns ? [chunk("tRNS", Uint8Array.from(opts.trns))] : []),
    chunk("IDAT", deflateSync(Uint8Array.from(out))),
    chunk("IEND", new Uint8Array()),
  ]);
}

// GIBS MODIS_Flood palette: 0 nodata · 1 no water · 2 surface water · 3 recurring · 4 flood · 5 insufficient data
const FLOOD_PLTE = [0, 0, 0, 0, 0, 1, 50, 210, 245, 255, 255, 0, 250, 30, 36, 175, 175, 175];
const FLOOD_TRNS = [0, 0, 255, 255, 255, 255];

function floodTilePng(fill: (x: number, y: number) => number): Buffer {
  const rows = Array.from({ length: 256 }, (_, y) => Uint8Array.from({ length: 256 }, (_, x) => fill(x, y)));
  return encodePng({ width: 256, height: 256, colorType: 3, bitDepth: 8, rows, filters: [0, 1, 2, 3, 4], plte: FLOOD_PLTE, trns: FLOOD_TRNS });
}

describe("decodePng", () => {
  it("decodes RGBA with every filter type", () => {
    const w = 7, h = 10;
    const px = (x: number, y: number) => [(x * 37 + y * 11) & 255, (x * 5 + y * 61) & 255, (x * y * 13) & 255, (200 + x + y) & 255];
    const rows = Array.from({ length: h }, (_, y) => Uint8Array.from(Array.from({ length: w }, (_, x) => px(x, y)).flat()));
    for (const f of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
      const png = decodePng(encodePng({ width: w, height: h, colorType: 6, bitDepth: 8, rows, filters: f }));
      expect(png.width).toBe(w);
      expect(png.height).toBe(h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(png.pixel(x, y)).toEqual(px(x, y));
    }
  });

  it("decodes RGB, grey+alpha and greyscale", () => {
    const rgbRows = [Uint8Array.from([10, 20, 30, 40, 50, 60]), Uint8Array.from([70, 80, 90, 100, 110, 120])];
    const rgb = decodePng(encodePng({ width: 2, height: 2, colorType: 2, bitDepth: 8, rows: rgbRows, filters: [4] }));
    expect(rgb.pixel(1, 1)).toEqual([100, 110, 120, 255]);
    const ga = decodePng(encodePng({ width: 2, height: 1, colorType: 4, bitDepth: 8, rows: [Uint8Array.from([9, 99, 200, 0])], filters: [1] }));
    expect(ga.pixel(1, 0)).toEqual([200, 200, 200, 0]);
    // 2-bit greyscale: values 0..3 scale to 0..255
    const g2 = decodePng(encodePng({ width: 4, height: 1, colorType: 0, bitDepth: 2, rows: [Uint8Array.from([0b00011011])], filters: [0] }));
    expect([0, 1, 2, 3].map((x) => g2.pixel(x, 0)[0])).toEqual([0, 85, 170, 255]);
  });

  it("decodes palette PNGs with tRNS and low bit depths", () => {
    const tile = decodePng(floodTilePng((x) => x % 6));
    expect(tile.colorType).toBe(3);
    expect(tile.index(4, 3)).toBe(4);
    expect(tile.pixel(4, 3)).toEqual([250, 30, 36, 255]);
    expect(tile.pixel(1, 0)).toEqual([0, 0, 1, 0]);
    expect(tile.pixel(5, 200)).toEqual([175, 175, 175, 255]);
    // 4-bit palette, two pixels per byte
    const p4 = decodePng(encodePng({ width: 3, height: 1, colorType: 3, bitDepth: 4, rows: [Uint8Array.from([0x42, 0x10])], filters: [0], plte: FLOOD_PLTE, trns: FLOOD_TRNS }));
    expect([0, 1, 2].map((x) => p4.index(x, 0))).toEqual([4, 2, 1]);
    expect(p4.pixel(0, 0)).toEqual([250, 30, 36, 255]);
  });

  it("rejects non-PNG and interlaced input", () => {
    expect(() => decodePng(Buffer.from("not a png at all"))).toThrow(/Not a PNG/);
    const png = encodePng({ width: 1, height: 1, colorType: 6, bitDepth: 8, rows: [Uint8Array.from([1, 2, 3, 4])], filters: [0] });
    png[8 + 8 + 12] = 1; // interlace byte in IHDR (CRC now wrong — we don't verify CRCs)
    expect(() => decodePng(png)).toThrow(/Interlaced/);
  });
});

describe("flood pixel classes", () => {
  it("maps the GIBS MODIS_Flood colormap", () => {
    expect(classifyFloodPixel([250, 30, 36, 255])).toBe("flood");
    expect(classifyFloodPixel([255, 255, 0, 255])).toBe("recurring_flood");
    expect(classifyFloodPixel([50, 210, 245, 255])).toBe("surface_water");
    expect(classifyFloodPixel([175, 175, 175, 255])).toBe("no_data");
    expect(classifyFloodPixel([0, 0, 1, 0])).toBe("no_water");
    expect(classifyFloodPixel([0, 0, 0, 0])).toBe("no_data");
    expect(classifyFloodPixel([245, 40, 40, 255])).toBe("flood"); // resampled edge
    expect(classifyFloodPixel([20, 120, 20, 255])).toBe("no_water"); // unrelated colour
  });

  it("samples a 3×3 neighbourhood and derives a verdict", () => {
    const classes = new Uint8Array(256 * 256).fill(1); // no_water
    classes[10 * 256 + 11] = 4; // flood right of (10,10)
    const s = sampleNeighbourhood(classes, 10, 10);
    expect(s).toEqual({ centre: "no_water", flood: 1, cloud: 0 });
    expect(verdictFor(s.centre, s.flood)).toBe("flood_nearby");
    expect(verdictFor("flood", 3)).toBe("observed_flooded");
    expect(verdictFor("recurring_flood", 1)).toBe("observed_flooded");
    expect(verdictFor("no_data", 0)).toBe("cloud");
    expect(verdictFor("surface_water", 0)).toBe("normal_water");
    expect(verdictFor(null, 0)).toBe("unavailable");
    // corner clamps inside the tile
    expect(sampleNeighbourhood(classes, 0, 0).flood).toBe(0);
  });
});

describe("GIBS capabilities parsing", () => {
  it("extracts time ranges for one layer only", () => {
    const caps = `<Contents><Layer><ows:Title>A</ows:Title><ows:Identifier>Other</ows:Identifier><Dimension><Value>2020-01-01/2020-01-02/P1D</Value></Dimension></Layer>
      <Layer><ows:Identifier>MODIS_Combined_Flood_2-Day</ows:Identifier><Dimension><ows:Identifier>Time</ows:Identifier><Default>2026-09-29</Default><Value>2021-01-01/2021-01-05/P1D</Value><Value>2025-07-29/2026-09-29/P1D</Value></Dimension></Layer></Contents>`;
    const r = extractLayerRanges(caps, "MODIS_Combined_Flood_2-Day");
    expect(r).toEqual([
      { start: "2021-01-01", end: "2021-01-05", periodDays: 1 },
      { start: "2025-07-29", end: "2026-09-29", periodDays: 1 },
    ]);
    expect(extractLayerRanges(caps, "Missing")).toEqual([]);
  });
});

describe("NDVI anomalies", () => {
  const c = (date: string, doy: number, ndvi: number, quality?: "clear" | "cloudy"): NdviComposite => ({ date, doy, ndvi, quality });
  const base = [2023, 2024, 2025].map((year, k) => ({
    year,
    composites: [c(`${year}-06-10`, 161, 0.7 + k * 0.01), c(`${year}-06-26`, 177, 0.72 + k * 0.01), c(`${year}-07-12`, 193, 0.74 + k * 0.01), c(`${year}-07-28`, 209, 0.75 + k * 0.01)],
  }));

  it("flags a persistent drop as stress and an isolated dip as possible cloud", () => {
    const pts = ndviAnomalies([c("2026-06-10", 161, 0.71), c("2026-06-26", 177, 0.45), c("2026-07-12", 193, 0.73), c("2026-07-28", 209, 0.5)], base);
    expect(pts[0]!.mean).toBeCloseTo(0.71, 3);
    expect(pts[0]!.stress).toBe(false);
    expect(pts[1]!.stress).toBe(true);
    expect(pts[1]!.possibleCloud).toBe(true); // recovered next composite
    expect(pts[3]!.stress).toBe(true);
    expect(pts[3]!.possibleCloud).toBe(false);
    expect(pts[3]!.anomaly).toBeCloseTo(0.5 - 0.76, 3);
    expect(pts[3]!.z!).toBeLessThan(-1.5);
    expect(pts[3]!.years).toBe(3);
    const d = describeNdvi(pts);
    expect(d.tone).toBe("warning");
    expect(d.summary).toMatch(/stress detected/i);
  });

  it("handles missing baseline and empty series", () => {
    const pts = ndviAnomalies([c("2026-06-10", 161, 0.6)], []);
    expect(pts[0]!.mean).toBeNull();
    expect(pts[0]!.stress).toBe(false);
    expect(describeNdvi([]).tone).toBe("info");
    const water = ndviAnomalies([c("2026-06-10", 161, 0.6), c("2026-06-26", 177, -0.1)], []);
    expect(describeNdvi(water).summary).toMatch(/water/);
  });
});

describe("floodScan (stubbed GIBS)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("flags assets under flood pixels and remembers the last scan", async () => {
    resetStore();
    const ws = "org-ngo-brac";
    const assets = getStore().assets.filter((a) => a.workspaceId === ws && a.status === "active");
    expect(assets.length).toBeGreaterThan(3);
    const target = assets[0]!;
    const t = tileFor(target.lat, target.lon, 9);
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(url);
        const m = /\/9\/(\d+)\/(\d+)\.png$/.exec(url)!;
        const [y, x] = [Number(m[1]), Number(m[2])];
        // The target's tile: flood at the target pixel; every other pixel dry
        const png = floodTilePng((px, py) => (x === t.x && y === t.y && px === t.px && py === t.py ? 4 : 1));
        return new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } });
      })
    );
    const r = await floodScan(ws, "2099-01-01");
    expect(requested.every((u) => u.includes("MODIS_Combined_Flood_2-Day/default/2099-01-01/GoogleMapsCompatible_Level9/9/"))).toBe(true);
    expect(r.summary.assets).toBe(assets.length);
    expect(r.summary.tilesFailed).toBe(0);
    const row = r.rows.find((x) => x.assetId === target.id)!;
    expect(row.verdict).toBe("observed_flooded");
    expect(r.rows[0]!.verdict).toBe("observed_flooded"); // flooded first
    expect(r.summary.flooded).toBeGreaterThanOrEqual(1);
    expect(r.summary.exposureFloodedUsd).toBeGreaterThanOrEqual(target.valueUsd);
    expect(r.source).toMatch(/250 m/);
    const last = lastFloodScan(ws)!;
    expect(last.date).toBe("2099-01-01");
    expect(last.floodedAssetIds).toContain(target.id);
  });

  it("merges a multi-day window: flood beats cloud, latest clear look otherwise", async () => {
    const d = (date: string, verdict: Parameters<typeof mergeDaySamples>[0][number]["verdict"]) => ({ date, verdict, pixel: null, floodNeighbours: 0, cloudNeighbours: 0 });
    expect(mergeDaySamples([d("2026-09-03", "cloud"), d("2026-09-02", "observed_flooded"), d("2026-09-01", "dry")])).toMatchObject({ date: "2026-09-02", verdict: "observed_flooded", clearDays: 2 });
    expect(mergeDaySamples([d("2026-09-03", "cloud"), d("2026-09-02", "dry"), d("2026-09-01", "flood_nearby")])!.verdict).toBe("flood_nearby");
    expect(mergeDaySamples([d("2026-09-03", "cloud"), d("2026-09-02", "normal_water"), d("2026-09-01", "dry")])).toMatchObject({ date: "2026-09-02", verdict: "normal_water" });
    expect(mergeDaySamples([d("2026-09-03", "unavailable"), d("2026-09-02", "cloud")])).toMatchObject({ verdict: "cloud", clearDays: 0 });
    expect(mergeDaySamples([])).toBeNull();

    // End-to-end: cloud on the last day, flood two days earlier
    resetStore();
    const ws = "org-ngo-brac";
    const target = getStore().assets.find((a) => a.workspaceId === ws && a.status === "active")!;
    const t = tileFor(target.lat, target.lon, 9);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const day = /default\/(\d{4}-\d{2}-\d{2})\//.exec(url)![1];
        const png = floodTilePng((px, py) => (day === "2099-03-01" ? 5 : day === "2099-02-27" && px === t.px && py === t.py ? 4 : 1));
        return new Response(new Uint8Array(png), { status: 200 });
      })
    );
    const r = await floodScan(ws, "2099-03-01", { windowDays: 3 });
    expect(r.from).toBe("2099-02-27");
    expect(r.windowDays).toBe(3);
    const row = r.rows.find((x) => x.assetId === target.id)!;
    expect(row).toMatchObject({ verdict: "observed_flooded", observedOn: "2099-02-27" });
    const other = r.rows.find((x) => x.assetId !== target.id && x.verdict === "dry")!;
    expect(other.observedOn).toBe("2099-02-28"); // latest clear day, not the cloudy last day
    expect(other.clearDays).toBe(2);
  });

  it("marks assets unavailable when GIBS fails", async () => {
    resetStore();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const r = await floodScan("org-coop-odisha", "2099-01-02");
    expect(r.summary.unavailable).toBe(r.summary.assets);
    expect(r.summary.tilesFailed).toBeGreaterThan(0);
  });
});
