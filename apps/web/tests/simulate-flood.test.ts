/**
 * Simulation Lab — raster maths (PNG decoding, Web-Mercator, water classification,
 * connectivity-aware bathtub, ponding, level statistics). Synthetic grids only.
 */
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeOccurrence, decodePng, decodeTerrarium, latToPx, lonToPx, pixelSizeM, pxToLat, pxToLon } from "@/server/live/dem";
import { CLS_LAND, CLS_POND, CLS_RIVER, CLS_SEA, classifyWater, fillDepressions, floodField, levelStats, pondDepth, sourceBase, windowMin } from "@/server/services/sim-flood";

// ─── tiny PNG encoder for tests (all five filter types) ──────────────────
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function encodePng(w: number, h: number, bpp: 3 | 4, px: Uint8Array): Uint8Array {
  const stride = w * bpp;
  const raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const ft = y % 5; // exercise every filter
    raw[y * (stride + 1)] = ft;
    for (let i = 0; i < stride; i++) {
      const x = px[y * stride + i]!;
      const a = i >= bpp ? px[y * stride + i - bpp]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + i]! : 0;
      const c = i >= bpp && y > 0 ? px[(y - 1) * stride + i - bpp]! : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, pr][ft]!;
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = bpp === 3 ? 2 : 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

describe("PNG + tile decoding", () => {
  it("round-trips RGB and RGBA through every PNG filter type", () => {
    const w = 7;
    const h = 10;
    for (const bpp of [3, 4] as const) {
      const px = new Uint8Array(w * h * bpp).map((_, i) => (i * 37 + (i >> 3) * 11) & 255);
      const d = decodePng(encodePng(w, h, bpp, px));
      expect(d.width).toBe(w);
      expect(d.height).toBe(h);
      expect(d.channels).toBe(bpp);
      expect(Array.from(d.data)).toEqual(Array.from(px));
    }
  });

  it("decodes Terrarium elevation (R·256 + G + B/256 − 32768)", () => {
    const px = new Uint8Array([128, 0, 0, 127, 255, 255, 128, 10, 128, 100, 0, 0]);
    const e = decodeTerrarium(decodePng(encodePng(2, 2, 3, px)));
    expect(e[0]).toBe(0);
    expect(e[1]).toBeCloseTo(-0.0039, 3);
    expect(e[2]).toBeCloseTo(10.5, 5);
    expect(e[3]).toBe(100 * 256 - 32768);
  });

  it("decodes JRC occurrence from the blue channel, transparent = never water", () => {
    const px = new Uint8Array([0, 0, 0, 0, 0, 0, 255, 255, 128, 0, 127, 127, 2, 0, 252, 252]);
    const o = decodeOccurrence(decodePng(encodePng(2, 2, 4, px)));
    expect(Array.from(o)).toEqual([0, 100, 50, 99]);
  });
});

describe("Web-Mercator helpers", () => {
  it("round-trips lat/lon ↔ global pixels", () => {
    for (const [lat, lon] of [[22.45, 89.1], [-6.89, 110.6], [0, 0], [60, -120]] as const) {
      expect(pxToLat(latToPx(lat, 12), 12)).toBeCloseTo(lat, 8);
      expect(pxToLon(lonToPx(lon, 12), 12)).toBeCloseTo(lon, 8);
    }
  });
  it("pixel size ≈ 38.2 m at the equator for z12 and shrinks with cos(lat)", () => {
    expect(pixelSizeM(0, 12)).toBeCloseTo(38.22, 1);
    expect(pixelSizeM(60, 12) / pixelSizeM(0, 12)).toBeCloseTo(0.5, 3);
  });
});

// ─── synthetic landscapes ─────────────────────────────────────────────────
function grid(w: number, h: number, f: (x: number, y: number) => number) {
  const e = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) e[y * w + x] = f(x, y);
  return e;
}

describe("water classification", () => {
  it("finds the sea (≤ 0 m touching the edge) and separates an isolated pond from a river", () => {
    const w = 40;
    const h = 30;
    // sea in the first 8 columns, land 2 m, an inland ≤0 pit (not sea)
    const elev = grid(w, h, (x, y) => (x < 8 ? -2 : x > 20 && x < 23 && y > 10 && y < 13 ? -0.5 : 2));
    const occ = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) occ[y * w + 30] = 90; // river crossing the whole area (touches edges)
    for (let y = 3; y < 7; y++) for (let x = 12; x < 16; x++) occ[y * w + x] = 95; // small isolated pond
    const cls = classifyWater(elev, occ, w, h, { sea: true, rivers: true });
    expect(cls[5 * w + 2]).toBe(CLS_SEA);
    expect(cls[11 * w + 21]).toBe(CLS_LAND); // inland pit is not sea
    expect(cls[15 * w + 30]).toBe(CLS_RIVER);
    expect(cls[4 * w + 13]).toBe(CLS_POND);
    // sea disabled → shown as water but not a source
    const noSea = classifyWater(elev, occ, w, h, { sea: false, rivers: true });
    expect(noSea[5 * w + 2]).toBe(CLS_POND);
  });

  it("windowMin is a true (2R+1)² masked minimum", () => {
    const w = 9;
    const h = 7;
    const v = grid(w, h, (x, y) => (x * 7 + y * 3) % 11);
    const mask = new Uint8Array(w * h).map((_, i) => (i % 3 ? 1 : 0));
    const m = windowMin(v, w, h, 1, mask);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let best = 1e9;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) if (mask[yy * w + xx]) best = Math.min(best, v[yy * w + xx]!);
        expect(m[y * w + x]).toBe(best);
      }
  });
});

describe("connectivity-aware bathtub", () => {
  // columns: 0-2 sea (−1 m) · 3-5 beach 0.5 m · 6 levee 2.0 m · 7-15 basin 0.8 m · 16-19 upland 6 m
  const w = 20;
  const h = 5;
  const elev = grid(w, h, (x) => (x < 3 ? -1 : x < 6 ? 0.5 : x === 6 ? 2 : x < 16 ? 0.8 : 6));
  const cls = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < 3; x++) cls[y * w + x] = CLS_SEA;
  const base = sourceBase(elev, cls, w, h, "source", 0);
  const f = floodField(elev, cls, base, w, h, 5);

  it("floods the beach at +0.5 m but NOT the basin behind the 2 m levee", () => {
    expect(f.rise[2 * w + 4]).toBeCloseTo(0.5, 5);
    expect(f.rise[2 * w + 10]).toBeCloseTo(2.0, 5); // must overtop the levee first
    const floodedAt = (h0: number, x: number) => f.rise[2 * w + x]! < h0;
    expect(floodedAt(1.5, 4)).toBe(true);
    expect(floodedAt(1.5, 10)).toBe(false); // plain bathtub would flood 0.8 m land here
    expect(floodedAt(2.1, 10)).toBe(true);
  });

  it("depth = h − HAND once connected; upland beyond maxRise never floods", () => {
    expect(2.5 + f.d0[2 * w + 10]!).toBeCloseTo(2.5 - 0.8, 5);
    expect(f.rise[2 * w + 18]).toBe(Infinity);
  });

  it("cells below the reference are clamped to the reference (no metre-deep water at +0.1 m)", () => {
    const e2 = grid(6, 1, (x) => (x === 0 ? 0 : -1.5));
    const c2 = new Uint8Array(6);
    c2[0] = CLS_SEA;
    const f2 = floodField(e2, c2, sourceBase(e2, c2, 6, 1, "source", 0), 6, 1, 5);
    expect(f2.rise[3]).toBe(0);
    expect(0.1 + f2.d0[3]!).toBeCloseTo(0.1, 6);
  });

  it("uniform low-percentile reference lifts every source to the same level", () => {
    const b2 = sourceBase(elev, cls, w, h, "lowpct", 0.5);
    const f2 = floodField(elev, cls, b2, w, h, 5);
    expect(f2.rise[2 * w + 4]).toBeCloseTo(0, 5); // beach is at the reference
    expect(f2.rise[2 * w + 10]).toBeCloseTo(1.5, 5); // levee 2.0 − 0.5
  });

  it("river base never sits above dry land next to it (HAND-style)", () => {
    const e3 = grid(9, 9, (x) => (x === 4 ? 5 : 3)); // noisy-high river pixels, banks at 3 m
    const c3 = new Uint8Array(81);
    for (let y = 0; y < 9; y++) c3[y * 9 + 4] = CLS_RIVER;
    const b3 = sourceBase(e3, c3, 9, 9, "source", 0);
    expect(b3[4 * 9 + 4]).toBe(3);
  });
});

describe("ponding & level statistics", () => {
  it("level-pool ponding conserves the rain volume inside a closed depression", () => {
    const w = 11;
    const h = 11;
    // bowl: rim 3 m, floor rises from 0 m at the centre
    const elev = grid(w, h, (x, y) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 3 : Math.hypot(x - 5, y - 5) * 0.3));
    const cls = new Uint8Array(w * h);
    const filled = fillDepressions(elev, cls, w, h);
    const rowArea = new Float32Array(h).fill(100); // 10 m pixels
    const R = 0.05; // 50 mm excess, catchment ratio 2
    const pond = pondDepth(elev, filled, w, h, rowArea, R, 2);
    let depArea = 0;
    let vol = 0;
    for (let i = 0; i < w * h; i++) {
      if (filled[i]! - elev[i]! > 0.01) depArea += 100;
      vol += pond[i]! * 100;
    }
    expect(vol).toBeCloseTo(R * 2 * depArea, 3);
    expect(pond[5 * w + 5]).toBeGreaterThan(pond[5 * w + 8]!);
  });

  it("difference-array level stats equal a brute-force scan", () => {
    const w = 60;
    const h = 40;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const elev = grid(w, h, (x) => (x < 4 ? -1 : x * 0.08 + rnd() * 1.2));
    const cls = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < 4; x++) cls[y * w + x] = CLS_SEA;
    const base = sourceBase(elev, cls, w, h, "source", 0);
    const f = floodField(elev, cls, base, w, h, 3);
    const rowArea = new Float32Array(h).map((_, y) => 900 + y * 10);
    const pond = new Float32Array(w * h);
    pond[20 * w + 50] = 0.4;
    const levels = Array.from({ length: 31 }, (_, k) => Math.round(k * 10) / 100);
    const fast = levelStats(f, cls, pond, w, h, rowArea, levels);
    levels.forEach((hl, k) => {
      let a = 0;
      let ds = 0;
      const bands = [0, 0, 0, 0];
      for (let i = 0; i < w * h; i++) {
        if (cls[i] === CLS_SEA) continue;
        let d = f.rise[i]! < hl ? hl + f.d0[i]! : 0;
        if (pond[i]! > d) d = pond[i]!;
        if (d <= 0.02) continue;
        const ar = rowArea[Math.floor(i / w)]!;
        a += ar;
        ds += ar * d;
        bands[d < 0.5 ? 0 : d < 1 ? 1 : d < 2 ? 2 : 3]! += ar;
      }
      expect(fast[k]!.floodedHa).toBe(Math.round(a / 10_000));
      expect(fast[k]!.meanDepthM).toBeCloseTo(a ? ds / a : 0, 1);
      fast[k]!.bandsHa.forEach((b, q) => expect(Math.abs(b - Math.round(bands[q]! / 10_000))).toBeLessThanOrEqual(1));
    });
  });

  it("flooded area is non-decreasing with the water level", () => {
    const w = 50;
    const h = 50;
    const elev = grid(w, h, (x, y) => (x === 0 ? -1 : Math.sin(x / 5) + y * 0.05 + 1));
    const cls = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) cls[y * w] = CLS_SEA;
    const f = floodField(elev, cls, sourceBase(elev, cls, w, h, "source", 0), w, h, 5);
    const s = levelStats(f, cls, null, w, h, new Float32Array(h).fill(1e4), Array.from({ length: 51 }, (_, k) => k / 10));
    for (let k = 1; k < s.length; k++) expect(s[k]!.floodedHa).toBeGreaterThanOrEqual(s[k - 1]!.floodedHa);
  });
});
