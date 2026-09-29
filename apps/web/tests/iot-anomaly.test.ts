/**
 * Anomaly detector: spikes vs real events, flatlines, rapid rise with / without
 * a physical driver, EC surge classification, gaps and change-points.
 */
import { describe, expect, it } from "vitest";
import { detectAnomalies, ewma, mad, median, robustZ, rollingMedian, trailingRise, type Sample } from "@/server/services/iot-anomaly";

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);
const MIN = 60_000;

/** deterministic pseudo-noise */
const noise = (i: number, a = 0.004) => a * Math.sin(i * 12.9898) * Math.cos(i * 78.233);

function series(n: number, stepMs: number, f: (i: number, t: number) => number): Sample[] {
  return Array.from({ length: n }, (_, i) => ({ t: T0 + i * stepMs, v: f(i, T0 + i * stepMs) }));
}

describe("robust statistics", () => {
  it("median / MAD / rolling median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
    expect(rollingMedian([1, 1, 50, 1, 1], 3)).toEqual([1, 1, 1, 1, 1]);
  });

  it("robust z flags an injected outlier only", () => {
    const xs = Array.from({ length: 50 }, (_, i) => 2 + noise(i, 0.02));
    xs[25] = 9;
    const { z } = robustZ(xs, 7, 0.001);
    expect(Math.abs(z[25]!)).toBeGreaterThan(6);
    expect(z.filter((v, i) => i !== 25 && Math.abs(v) > 6)).toHaveLength(0);
  });

  it("EWMA is time-aware and trailing rise uses a sliding minimum", () => {
    const s = [{ t: 0, v: 0 }, { t: H, v: 10 }];
    expect(ewma(s, H)[1]).toBeCloseTo(10 * (1 - Math.exp(-1)), 6);
    const tr = trailingRise(series(10, H, (i) => (i < 5 ? 5 - i : i - 5)), 3 * H);
    expect(tr[9]!.rise).toBe(3); // from 1 (i=6) to 4 (i=9) within 3 h
  });
});

describe("detectAnomalies", () => {
  it("isolated, physically impossible jump → sensor-fault spike (not an alert)", () => {
    const s = series(300, 5 * MIN, (i) => 2.1 + noise(i, 0.03));
    s[150]!.v = 34;
    const a = detectAnomalies(s, { deviceId: "d1", metric: "soil_ec", intervalMs: 5 * MIN });
    const spikes = a.filter((x) => x.kind === "spike");
    expect(spikes).toHaveLength(1);
    expect(spikes[0]!.cls).toBe("sensor_fault");
    expect(a.some((x) => x.kind === "ec_surge")).toBe(false);
  });

  it("identical readings for hours on a normally noisy sensor → flatline fault", () => {
    const s = series(400, 5 * MIN, (i) => (i >= 200 ? 3.21 : 3 + noise(i, 0.05)));
    const a = detectAnomalies(s, { deviceId: "d2", metric: "soil_ec", intervalMs: 5 * MIN });
    const flat = a.find((x) => x.kind === "flatline");
    expect(flat).toBeDefined();
    expect(flat!.cls).toBe("sensor_fault");
    expect(flat!.start).toBe(s[200]!.t);
    expect(flat!.score).toBeGreaterThan(16);
  });

  it("rapid rise explained by measured rain → critical real event", () => {
    const s = series(24 * 60, MIN, (i) => 3 + noise(i) + (i > 900 ? Math.min(1.2, (i - 900) * 0.006) : 0));
    const a = detectAnomalies(s, { deviceId: "g1", metric: "water_level_m", intervalMs: MIN, context: { rainBetween: () => 110 } });
    const rise = a.find((x) => x.kind === "rapid_rise");
    expect(rise).toBeDefined();
    expect(rise!.cls).toBe("real_event");
    expect(rise!.severity).toBe("critical");
    expect(rise!.explanation).toMatch(/110 mm/);
  });

  it("same rise with no driver → suspect, check the device", () => {
    const s = series(24 * 60, MIN, (i) => 3 + noise(i) + (i > 900 ? Math.min(0.8, (i - 900) * 0.006) : 0));
    const a = detectAnomalies(s, { deviceId: "g2", metric: "water_level_m", intervalMs: MIN, context: { rainBetween: () => 0 } });
    const rise = a.find((x) => x.kind === "rapid_rise");
    expect(rise?.cls).toBe("suspect");
    expect(rise?.severity).toBe("warning");
    expect(rise?.explanation).toMatch(/check the device/);
  });

  it("slow seasonal rise and tidal wiggle do not trigger", () => {
    const s = series(48 * 60, MIN, (i, t) => 3 + (0.3 * (t - T0)) / (48 * H) + 0.2 * Math.cos((2 * Math.PI * (t - T0)) / (12.42 * H)) + noise(i));
    const a = detectAnomalies(s, { deviceId: "g3", metric: "water_level_m", intervalMs: MIN });
    expect(a.filter((x) => x.kind !== "outlier")).toHaveLength(0);
  });

  it("sustained EC surge at a tidal site → real event; too-fast step → sensor fault", () => {
    const surge = series(400, 5 * MIN, (i) => 2.5 + noise(i, 0.03) + (i > 200 ? Math.min(4.5, (i - 200) * 0.15) : 0));
    const a = detectAnomalies(surge, { deviceId: "p1", metric: "soil_ec", intervalMs: 5 * MIN, context: { tidal: true } });
    const ev = a.find((x) => x.kind === "ec_surge");
    expect(ev?.cls).toBe("real_event");
    expect(ev?.severity).toBe("critical");

    const inland = detectAnomalies(surge, { deviceId: "p2", metric: "soil_ec", intervalMs: 5 * MIN, context: { tidal: false } });
    expect(inland.find((x) => x.kind === "ec_surge")?.cls).toBe("suspect");

    const step = series(400, 5 * MIN, (i) => 2.5 + noise(i, 0.03) + (i > 200 ? 6 : 0));
    const b = detectAnomalies(step, { deviceId: "p3", metric: "soil_ec", intervalMs: 5 * MIN, context: { tidal: true } });
    expect(b.find((x) => x.kind === "ec_surge")?.cls).toBe("sensor_fault");
  });

  it("reports gaps (packet loss / outage)", () => {
    const s = series(200, 5 * MIN, (i) => 1 + noise(i, 0.02)).filter((_, i) => i < 80 || i > 110);
    const a = detectAnomalies(s, { deviceId: "p4", metric: "soil_moisture", intervalMs: 5 * MIN });
    const gap = a.find((x) => x.kind === "gap");
    expect(gap).toBeDefined();
    expect((gap!.end - gap!.start) / MIN).toBe(160); // last sample i=79 → next i=111
  });

  it("rain: bursts are normal, only impossible intensities are flagged", () => {
    const s = series(120, MIN, (i) => (i > 50 && i < 70 ? 0.8 : 0));
    expect(detectAnomalies(s, { deviceId: "r1", metric: "rain_mm", intervalMs: MIN })).toHaveLength(0);
    s[100]!.v = 40; // 40 mm in one minute = 2400 mm/h
    const a = detectAnomalies(s, { deviceId: "r1", metric: "rain_mm", intervalMs: MIN });
    expect(a[0]?.kind).toBe("spike");
    expect(a[0]?.cls).toBe("sensor_fault");
  });

  it("step change in soil moisture → EWMA change-point", () => {
    const s = series(400, 5 * MIN, (i) => (i > 250 ? 38 : 24) + noise(i, 0.2));
    const a = detectAnomalies(s, { deviceId: "m1", metric: "soil_moisture", intervalMs: 5 * MIN });
    const cp = a.find((x) => x.kind === "level_shift");
    expect(cp).toBeDefined();
    expect(cp!.start).toBeGreaterThanOrEqual(s[250]!.t);
    expect(cp!.title).toMatch(/Step up/);
  });

  it("anomaly ids are stable across re-runs (for once-only notifications)", () => {
    const s = series(300, 5 * MIN, (i) => 2.1 + noise(i, 0.03));
    s[150]!.v = 34;
    const a = detectAnomalies(s, { deviceId: "d1", metric: "soil_ec", intervalMs: 5 * MIN });
    const b = detectAnomalies([...s, { t: s[299]!.t + 5 * MIN, v: 2.1 }], { deviceId: "d1", metric: "soil_ec", intervalMs: 5 * MIN });
    expect(b.find((x) => x.kind === "spike")!.id).toBe(a.find((x) => x.kind === "spike")!.id);
  });
  it("tidal reach: the normal tide is not a rapid rise, a flood on top of it is", () => {
    const tide = (t: number) => 1.2 * Math.cos((2 * Math.PI * (t - T0)) / (12.42 * H));
    const calm = series(48 * 60, MIN, (i, t) => 2 + tide(t) + noise(i));
    expect(detectAnomalies(calm, { deviceId: "t1", metric: "water_level_m", intervalMs: MIN }).some((a) => a.kind === "rapid_rise")).toBe(true); // raw stage alone would false-alarm
    expect(detectAnomalies(calm, { deviceId: "t1", metric: "water_level_m", intervalMs: MIN, context: { tidal: true } }).some((a) => a.kind === "rapid_rise")).toBe(false);
    const flood = series(48 * 60, MIN, (i, t) => 2 + tide(t) + noise(i) + (i > 40 * 60 ? Math.min(1.2, (i - 40 * 60) * 0.006) : 0));
    const hit = detectAnomalies(flood, { deviceId: "t2", metric: "water_level_m", intervalMs: MIN, context: { tidal: true, rainBetween: () => 60 } }).find((a) => a.kind === "rapid_rise");
    expect(hit?.cls).toBe("real_event");
    expect(hit?.explanation).toMatch(/after removing the normal tide/);
  });
});

