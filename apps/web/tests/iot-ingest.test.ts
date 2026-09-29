/**
 * Telemetry ingest contract: validation, unit normalisation, batch splitting,
 * device-key extraction and The Things Stack (LoRaWAN) uplink mapping.
 */
import { describe, expect, it } from "vitest";
import { convertUnit, deviceKeyFrom, liIonPct, mapTtnUplink, normalizeReading, parseTs, resolveKey, splitBody, DEVICE_KEY_RE } from "@/server/services/iot-ingest";
import { generateDeviceKey, hashKey } from "@/server/services/iot-store";

const NOW = Date.UTC(2026, 8, 29, 10, 0, 0);

describe("timestamps", () => {
  it("accepts ISO, epoch seconds, epoch ms and numeric strings; defaults to now", () => {
    expect(parseTs("2026-09-29T09:00:00Z", NOW)).toBe(NOW - 3_600_000);
    expect(parseTs(NOW / 1000, NOW)).toBe(NOW);
    expect(parseTs(NOW, NOW)).toBe(NOW);
    expect(parseTs(String(NOW / 1000), NOW)).toBe(NOW);
    expect(parseTs(undefined, NOW)).toBe(NOW);
    expect(parseTs("yesterday-ish", NOW)).toBeNull();
  });
});

describe("keys & units", () => {
  it("resolves aliases and unit suffixes", () => {
    expect(resolveKey("water_level_m")).toEqual({ metric: "water_level_m", unit: null });
    expect(resolveKey("Water-Level")).toEqual({ metric: "water_level_m", unit: null });
    expect(resolveKey("water_level_cm")).toEqual({ metric: "water_level_m", unit: "cm" });
    expect(resolveKey("soil_ec_us_cm")).toEqual({ metric: "soil_ec", unit: "us/cm" });
    expect(resolveKey("BatV")).toEqual({ metric: "battery_pct", unit: "v" });
    expect(resolveKey("colour")).toBeNull();
  });

  it("converts to canonical units", () => {
    expect(convertUnit("water_level_m", 342, "cm")).toBeCloseTo(3.42);
    expect(convertUnit("water_level_m", 10, "ft")).toBeCloseTo(3.048);
    expect(convertUnit("soil_ec", 2500, "µS/cm")).toBeCloseTo(2.5);
    expect(convertUnit("soil_ec", 0.25, "S/m")).toBeCloseTo(2.5);
    expect(convertUnit("soil_ec", 2.5, "mS/cm")).toBeCloseTo(2.5);
    expect(convertUnit("soil_moisture", 0.31, "m3/m3")).toBeCloseTo(31);
    expect(convertUnit("air_temp_c", 86, "F")).toBeCloseTo(30);
    expect(convertUnit("wind_ms", 36, "km/h")).toBeCloseTo(10);
    expect(convertUnit("rain_mm", 5, "tips")).toBeCloseTo(1);
    expect(convertUnit("pressure_hpa", 101.3, "kPa")).toBeCloseTo(1013);
    expect(convertUnit("water_level_m", 1, "furlongs")).toBeNull();
    expect(liIonPct(4.2)).toBe(100);
    expect(liIonPct(3.0)).toBe(0);
    expect(liIonPct(3.6)).toBe(100); // primary Li-SOCl2 at nominal
  });
});

describe("normalizeReading", () => {
  it("normalises the structured `values` form", () => {
    const r = normalizeReading({ ts: "2026-09-29T09:59:00Z", values: { water_level: { value: 342, unit: "cm" }, battery: 87 } }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reading.values).toEqual({ water_level_m: 3.42, battery_pct: 87 });
      expect(r.reading.t).toBe(NOW - 60_000);
    }
  });

  it("normalises the flat form with unit suffixes and a units map", () => {
    const r = normalizeReading({ ts: NOW / 1000, soil_ec_us_cm: 3100, moisture: 0.28, battery_v: 3.9, units: { moisture: "m3/m3" } }, NOW);
    expect(r.ok && r.reading.values).toEqual({ soil_ec: 3.1, soil_moisture: 28, battery_pct: 75 });
  });

  it("rejects future, too-old and unparseable timestamps", () => {
    expect(normalizeReading({ ts: NOW + 10 * 60_000, water_level_m: 1 }, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/future/) });
    expect(normalizeReading({ ts: NOW - 8 * 86_400_000, water_level_m: 1 }, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/older than 7 days/) });
    expect(normalizeReading({ ts: "not a date", water_level_m: 1 }, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/timestamp/) });
  });

  it("drops implausible values and unknown keys with warnings, fails when nothing is left", () => {
    const r = normalizeReading({ water_level_m: 3, soil_ec: 900, colour: "blue" }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reading.values).toEqual({ water_level_m: 3 });
      expect(r.reading.warnings.join(" ")).toMatch(/soil_ec.*outside plausible range/);
      expect(r.reading.warnings.join(" ")).toMatch(/colour: unknown metric/);
    }
    expect(normalizeReading({ colour: "blue" }, NOW).ok).toBe(false);
    expect(normalizeReading("hello", NOW).ok).toBe(false);
    expect(normalizeReading({ water_level: { value: "high" } }, NOW).ok).toBe(false);
  });
});

describe("splitBody", () => {
  it("handles single, { readings }, bare arrays and limits", () => {
    expect(splitBody({ water_level_m: 1 })).toMatchObject({ ok: true, readings: [{ water_level_m: 1 }] });
    expect(splitBody({ device_id: "dev_1", readings: [{ a: 1 }, { a: 2 }] })).toMatchObject({ ok: true, deviceId: "dev_1" });
    expect(splitBody([{ a: 1 }])).toMatchObject({ ok: true });
    expect(splitBody({ readings: [] })).toMatchObject({ ok: false });
    expect(splitBody({ readings: "x" })).toMatchObject({ ok: false });
    expect(splitBody(Array.from({ length: 501 }, () => ({})))).toMatchObject({ ok: false, reason: expect.stringMatching(/500/) });
    expect(splitBody(42)).toMatchObject({ ok: false });
  });
});

describe("device keys", () => {
  it("generates dk_ keys, hashes with sha256 and reads either header", () => {
    const k = generateDeviceKey();
    expect(k).toMatch(DEVICE_KEY_RE);
    expect(generateDeviceKey()).not.toBe(k);
    expect(hashKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceKeyFrom(new Headers({ "x-device-key": k }))).toBe(k);
    expect(deviceKeyFrom(new Headers({ authorization: `Bearer ${k}` }))).toBe(k);
    expect(deviceKeyFrom(new Headers({ authorization: "Bearer ags_live_xxx" }))).toBeNull();
  });
});

describe("LoRaWAN (The Things Stack v3) uplink mapping", () => {
  const uplink = {
    end_device_ids: { device_id: "gauge-sylhet-01", application_ids: { application_id: "agri-shield" }, dev_eui: "70b3d57ed0012345" },
    received_at: "2026-09-29T09:58:30.123Z",
    uplink_message: {
      f_port: 2,
      f_cnt: 1841,
      frm_payload: "AVQBDw==",
      decoded_payload: { water_level_cm: 342, BatV: 3.61, meta: { fw: "2.4.1" } },
      rx_metadata: [
        { gateway_ids: { gateway_id: "gw-a" }, rssi: -112, snr: -4.5 },
        { gateway_ids: { gateway_id: "gw-b" }, rssi: -97, snr: 6.25 },
      ],
      settings: { data_rate: { lora: { bandwidth: 125000, spreading_factor: 9 } } },
    },
  };

  it("maps decoded_payload + best gateway RSSI/SNR + received_at", () => {
    const m = mapTtnUplink(uplink);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.ttnDeviceId).toBe("gauge-sylhet-01");
    expect(m.devEui).toBe("70B3D57ED0012345");
    expect(m.gateways).toBe(2);
    expect(m.fCnt).toBe(1841);
    expect(m.reading).toMatchObject({ water_level_cm: 342, BatV: 3.61, rssi: -97, snr: 6.25, ts: "2026-09-29T09:58:30.123Z" });
    expect(m.reading).not.toHaveProperty("meta");
    const n = normalizeReading(m.reading, NOW);
    expect(n.ok && n.reading.values).toEqual({ water_level_m: 3.42, battery_pct: 100, rssi_dbm: -97, snr_db: 6.25 });
  });

  it("rejects non-TTN bodies and uplinks without a decoder", () => {
    expect(mapTtnUplink({ hello: 1 })).toMatchObject({ ok: false });
    expect(mapTtnUplink({ ...uplink, uplink_message: { ...uplink.uplink_message, decoded_payload: undefined } })).toMatchObject({ ok: false, reason: expect.stringMatching(/payload formatter/) });
  });
});
