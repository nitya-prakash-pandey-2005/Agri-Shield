import { describe, expect, it } from "vitest";
import { computeDrought, dayOfYear, heatStressFromHourly, requestWeight, summariseHistory, summariseRiver, windowStats } from "@/server/live/climate";
import { soilNotes, usdaTexture } from "@/server/live/soil";
import { classifyTerrain, ringPoints } from "@/server/live/terrain";
import { parseCoordinates } from "@/server/live/geosearch";
import { salinityElevationGate, salinityExposure } from "@/server/services/location-risk";
import { takePublicQuota } from "@/server/services/explorer-reports";

const DAY = 86_400_000;

/** Deterministic synthetic daily record: seasonal rain with a wet spike every year, warming Tmax. */
function synthRecord(years = 30, start = 1990) {
  const precip: number[] = [];
  const tmax: number[] = [];
  const t0 = Date.UTC(start, 0, 1);
  const n = Math.round((Date.UTC(start + years, 0, 1) - t0) / DAY);
  for (let i = 0; i < n; i++) {
    const d = new Date(t0 + i * DAY);
    const doy = dayOfYear(d.toISOString());
    const y = d.getUTCFullYear() - start;
    const monsoon = doy > 150 && doy < 280;
    precip.push(monsoon ? ((i * 7919) % 13) + (doy === 200 ? 60 + y * 2 : 0) : (i % 11 === 0 ? 3 : 0));
    tmax.push(30 + 4 * Math.sin(((doy - 80) / 365) * 2 * Math.PI) + y * 0.03 + (doy === 120 ? 6 : 0));
  }
  return { start: `${start}-01-01`, precip, tmax, source: "synthetic" };
}

describe("climate history summary", () => {
  const rec = synthRecord();
  const h = summariseHistory(rec);
  it("builds one row per full year with sane annual metrics", () => {
    expect(h.annual).toHaveLength(30);
    expect(h.period).toEqual([1990, 2019]);
    const a = h.annual[0]!;
    expect(a.maxDailyRainMm).toBeGreaterThanOrEqual(60);
    expect(a.wettest3dMm).toBeGreaterThanOrEqual(a.maxDailyRainMm);
    expect(a.longestDrySpellDays).toBeGreaterThan(5);
  });
  it("detects the built-in intensification of the wettest day and warming", () => {
    expect(h.trends.maxDaily.slopePerDecade).toBeGreaterThan(15); // +2 mm/yr spike
    expect(h.trends.maxDaily.significant).toBe(true);
    expect(h.trends.hottestDay.slopePerDecade).toBeGreaterThan(0.2);
  });
  it("return levels increase with the return period", () => {
    const rp = h.returnPeriods.map((r) => r.dailyRainMm);
    for (let i = 1; i < rp.length; i++) expect(rp[i]!).toBeGreaterThanOrEqual(rp[i - 1]!);
    expect(h.normals).toHaveLength(12);
    expect(h.headline.length).toBeGreaterThan(1);
  });
});

describe("SPI drought index", () => {
  const rec = synthRecord(30, 1990);
  const lastTime = Date.UTC(2019, 11, 31);
  const recent = (mult: number) => {
    const time: string[] = [];
    const precip: number[] = [];
    for (let k = 99; k >= 0; k--) {
      const i = rec.precip.length - 1 - k;
      time.push(new Date(lastTime - k * DAY).toISOString().slice(0, 10));
      precip.push(rec.precip[i]! * mult);
    }
    return { time, precip };
  };
  it("normal rain → SPI near zero; no rain → drought", () => {
    // reference: first 29 years only, "recent" = last 100 days of the final year
    const ref = { ...rec, precip: rec.precip.slice(0, rec.precip.length - 365), tmax: rec.tmax.slice(0, rec.tmax.length - 365) };
    const normal = computeDrought(ref, recent(1));
    expect(Math.abs(normal.spi90 ?? 99)).toBeLessThan(1);
    expect(normal.referenceYears).toBeGreaterThan(20);
    const dry = computeDrought(ref, recent(0.05));
    expect(dry.spi90!).toBeLessThan(-1.5);
    expect(dry.score).toBeGreaterThan(40);
    expect(dry.pctOfNormal90!).toBeLessThan(20);
  });
});

describe("river record summary", () => {
  it("percentiles, seasonal band and Gumbel return levels", () => {
    const time: string[] = [];
    const q: number[] = [];
    const t0 = Date.UTC(2014, 0, 1);
    for (let i = 0; i < 365 * 11; i++) {
      const d = new Date(t0 + i * DAY).toISOString().slice(0, 10);
      time.push(d);
      const doy = dayOfYear(d);
      q.push(200 + 800 * Math.max(0, Math.sin(((doy - 150) / 120) * Math.PI)) + ((i * 31) % 50) + (doy === 230 ? (i % 7) * 100 : 0));
    }
    const today = new Date().toISOString().slice(0, 10);
    const series = [{ date: today, value: 5000 }];
    const r = summariseRiver({ time, q }, series);
    expect(r.significantRiver).toBe(true);
    expect(r.seasonalBand).toHaveLength(366);
    expect(r.current!.percentileAll).toBeGreaterThan(99);
    expect(r.forecastPeak!.returnPeriodYears!).toBeGreaterThan(10);
    expect(r.returnLevels.map((l) => l.years)).toEqual([2, 5, 10, 25, 50]);
    expect(r.summary).toMatch(/percentile/);
  });
});

describe("CMIP window statistics", () => {
  it("annual rain, hot days and rx1day per year", () => {
    const time = Array.from({ length: 730 }, (_, i) => new Date(Date.UTC(2045, 0, 1) + i * DAY).toISOString().slice(0, 10));
    const p = time.map((_, i) => (i === 10 ? 80 : i === 400 ? 60 : 2));
    const t = time.map((_, i) => (i % 10 === 0 ? 36 : 30));
    const s = windowStats(time, p, t, 2)!;
    expect(s.annualRainMm).toBe(Math.round((728 * 2 + 140) / 2));
    expect(s.heavyRainDays).toBe(1);
    expect(s.hotDays).toBe(36.5);
    expect(s.rx1dayMm).toBe(70);
  });
  it("Open-Meteo request weights", () => {
    expect(requestWeight(2, 14)).toBe(1);
    expect(requestWeight(2, 28)).toBe(2);
    expect(requestWeight(20, 14)).toBe(2);
    expect(Math.round(requestWeight(10, 3650))).toBe(261);
  });
});

describe("heat stress from hourly forecast", () => {
  it("aggregates daily maxima and flags danger hours", () => {
    const time = Array.from({ length: 48 }, (_, i) => new Date(Date.UTC(2026, 4, 1, i)).toISOString().slice(0, 16));
    const temperature_2m = time.map((_, i) => (i % 24 >= 11 && i % 24 <= 15 ? 38 : 29));
    const relative_humidity_2m = time.map(() => 65);
    const h = heatStressFromHourly({ time, temperature_2m, relative_humidity_2m })!;
    expect(h.days).toHaveLength(2);
    expect(h.heatIndexMaxC).toBeGreaterThan(50);
    expect(h.dangerHours).toBe(10);
    expect(h.level).toBeGreaterThanOrEqual(3);
    expect(h.score).toBe(100);
  });
});

describe("soil, terrain, coordinates", () => {
  it("USDA texture triangle", () => {
    expect(usdaTexture(90, 5, 5)).toBe("Sand");
    expect(usdaTexture(40, 40, 20)).toBe("Loam");
    expect(usdaTexture(10, 30, 60)).toBe("Clay");
    expect(usdaTexture(20, 65, 15)).toBe("Silt loam");
    expect(usdaTexture(10, 50, 40)).toBe("Silty clay");
    expect(soilNotes({ clayPct: 45, sandPct: 10, ph: 8.4, socGkg: 6 }).drainage).toBe("poor");
  });
  it("terrain classification and coast detection", () => {
    const t = classifyTerrain(3, [8, 9, 7, 8, 9, 8, 7, 8], [5, 0, 4, 6, 3, 2, 5, 4], [10, 12, 0, 8, 9, 11, 7, 6]);
    expect(t.position).toBe("depression");
    expect(t.coastKm).toBe(25);
    const inland = classifyTerrain(300, [300, 301, 299, 300, 300, 302, 298, 300], [350, 320, 330, 310, 305, 340, 360, 300], [400, 500, 420, 390, 410, 380, 450, 470]);
    expect(inland.coastKm).toBeNull();
    const pts = ringPoints(10, 100, 25, 8);
    expect(pts).toHaveLength(8);
    expect(Math.abs(pts[0]!.lat - (10 + 25 / 111.32))).toBeLessThan(1e-6);
  });
  it("parses pasted coordinates", () => {
    expect(parseCoordinates("22.7, 90.35")).toEqual({ lat: 22.7, lon: 90.35 });
    expect(parseCoordinates("6.2S 106.85E")).toEqual({ lat: -6.2, lon: 106.85 });
    expect(parseCoordinates("42.03 -93.62")).toEqual({ lat: 42.03, lon: -93.62 });
    expect(parseCoordinates("Barisal")).toBeNull();
    expect(parseCoordinates("95, 10")).toBeNull();
  });
});

describe("salinity applicability", () => {
  it("gates by elevation and coast proximity", () => {
    expect(salinityElevationGate(3)).toBe(1);
    expect(salinityElevationGate(40)).toBe(0);
    expect(salinityExposure(0.15, 4, 25)).toBeGreaterThanOrEqual(0.5); // low coastal land far from districts
    expect(salinityExposure(0.8, 4, null)).toBeLessThanOrEqual(0.08); // inland: no sea within 60 km
    expect(salinityExposure(0.7, 200, 25)).toBe(0); // coastal but high ground
  });
});

describe("public explore quota", () => {
  it("allows 5 reports per hour per IP", () => {
    const ip = `test-${Math.random()}`;
    const now = Date.now();
    for (let i = 0; i < 5; i++) expect(takePublicQuota(ip, 5, now + i).ok).toBe(true);
    const blocked = takePublicQuota(ip, 5, now + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.resetInMin).toBeGreaterThan(55);
    expect(takePublicQuota(ip, 5, now + 3601_000).ok).toBe(true);
  });
});
