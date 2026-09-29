import { describe, expect, it, vi } from "vitest";
import { solarElevation } from "@/components/twin/geo";
import {
  ACCENTS,
  ACCENT_IDS,
  CIVIL_TWILIGHT_DEG,
  THEMES,
  THEME_CYCLE,
  accentTokens,
  formatCoord,
  nearestPlace,
  nextSolarSwitch,
  nextTheme,
  parseMode,
  parseMotion,
  resolveMode,
  solarSummary,
  solarThemeAt,
  sunPath,
  timezoneLocation,
  timezoneLongitude,
} from "@/components/theme/logic";
import { bootAppearance } from "@/components/theme/boot";

const DHAKA = { lat: 23.81, lon: 90.41 };
const utc = (s: string) => new Date(`${s}Z`).getTime();

describe("Solar Auto decision", () => {
  it("is Daylight at local noon and Mission Control at local midnight (Dhaka, UTC+6)", () => {
    expect(solarThemeAt(DHAKA.lat, DHAKA.lon, utc("2026-09-29T06:00:00"))).toBe("light"); // 12:00 local
    expect(solarThemeAt(DHAKA.lat, DHAKA.lon, utc("2026-09-29T18:00:00"))).toBe("dark"); // 00:00 local
  });

  it("uses civil twilight (−6°), not the geometric horizon", () => {
    // Find an instant just after sunset where the sun is between 0° and −6°: still Daylight
    let t = utc("2026-09-29T11:00:00");
    while (solarElevation(DHAKA.lat, DHAKA.lon, t) > -2) t += 60_000;
    const el = solarElevation(DHAKA.lat, DHAKA.lon, t);
    expect(el).toBeLessThan(0);
    expect(el).toBeGreaterThan(CIVIL_TWILIGHT_DEG);
    expect(solarThemeAt(DHAKA.lat, DHAKA.lon, t)).toBe("light");
  });

  it("handles polar day and polar night (no switch within 48 h)", () => {
    const tromso = { lat: 69.65, lon: 18.96 };
    const midsummer = utc("2026-06-21T00:00:00");
    const midwinter = utc("2026-12-21T12:00:00");
    expect(solarThemeAt(tromso.lat, tromso.lon, midsummer)).toBe("light");
    expect(nextSolarSwitch(tromso.lat, tromso.lon, midsummer)).toBeNull();
    // Deep polar night at 80°N: even noon twilight stays below −6°
    expect(solarThemeAt(80, 15, midwinter)).toBe("dark");
    expect(nextSolarSwitch(80, 15, midwinter)).toBeNull();
    const s = solarSummary({ lat: 80, lon: 15, label: "Svalbard", source: "device" }, midwinter);
    expect(s.text).toMatch(/Polar night at Svalbard/);
    expect(s.when).toBeNull();
  });

  it("finds the next switch to within a minute, and the state really flips there", () => {
    const from = utc("2026-09-29T06:00:00"); // Dhaka midday
    const sw = nextSolarSwitch(DHAKA.lat, DHAKA.lon, from)!;
    expect(sw).not.toBeNull();
    expect(sw.to).toBe("dark");
    expect(sw.kind).toBe("sunset");
    // Dhaka, 29 Sep: sunset ≈ 17:50, civil dusk ≈ 18:12 local (≈ 12:12 UTC)
    const hoursUtc = new Date(sw.at).getUTCHours() + new Date(sw.at).getUTCMinutes() / 60;
    expect(hoursUtc).toBeGreaterThan(11.95);
    expect(hoursUtc).toBeLessThan(12.4);
    expect(Math.abs(solarElevation(DHAKA.lat, DHAKA.lon, sw.at) - CIVIL_TWILIGHT_DEG)).toBeLessThan(0.2);
    expect(solarThemeAt(DHAKA.lat, DHAKA.lon, sw.at.getTime() - 60_000)).toBe("light");
    expect(solarThemeAt(DHAKA.lat, DHAKA.lon, sw.at.getTime() + 60_000)).toBe("dark");
    // …and the following one is the next dawn
    const dawn = nextSolarSwitch(DHAKA.lat, DHAKA.lon, sw.at.getTime() + 60_000)!;
    expect(dawn.to).toBe("light");
    expect(dawn.kind).toBe("sunrise");
    expect(dawn.at.getTime() - sw.at.getTime()).toBeGreaterThan(9 * 3_600_000);
    expect(dawn.at.getTime() - sw.at.getTime()).toBeLessThan(13 * 3_600_000);
  });

  it("works across the antimeridian and the southern hemisphere", () => {
    // Fiji (−18°, 178°E): noon local ≈ 00:00 UTC
    expect(solarThemeAt(-18.1, 178.4, utc("2026-09-29T00:10:00"))).toBe("light");
    expect(solarThemeAt(-18.1, 178.4, utc("2026-09-29T12:10:00"))).toBe("dark");
    expect(nextSolarSwitch(-18.1, 178.4, utc("2026-09-29T00:10:00"))?.to).toBe("dark");
  });

  it("summarises the status in plain language", () => {
    const s = solarSummary({ ...DHAKA, label: "Dhaka", source: "workspace" }, utc("2026-09-29T06:00:00"), "Asia/Dhaka");
    expect(s.isDay).toBe(true);
    expect(s.text).toMatch(/^Day at Dhaka — switches to Mission Control at 18:\d\d$/);
    const n = solarSummary({ ...DHAKA, label: "Dhaka", source: "workspace" }, utc("2026-09-29T20:00:00"), "Asia/Dhaka");
    expect(n.isDay).toBe(false);
    expect(n.text).toMatch(/switches to Daylight at 0[5-6]:\d\d/);
  });

  it("samples a sun path centred on now", () => {
    const p = sunPath(DHAKA.lat, DHAKA.lon, utc("2026-09-29T06:00:00"), 12, 12, 60);
    expect(p).toHaveLength(25);
    expect(p[12]!.el).toBeGreaterThan(50); // near local noon
    expect(Math.min(...p.map((x) => x.el))).toBeLessThan(-30);
  });
});

describe("Solar Auto location fallbacks", () => {
  it("estimates longitude from the UTC offset", () => {
    expect(timezoneLongitude(-360)).toBe(90); // UTC+6
    expect(timezoneLongitude(300)).toBe(-75); // UTC−5
    expect(timezoneLongitude(-840)).toBe(180); // clamps UTC+14
  });
  it("uses a known city for a known IANA zone, else the offset", () => {
    expect(timezoneLocation("Asia/Dhaka", -360)).toMatchObject({ label: "Dhaka", source: "timezone", lat: 23.81 });
    expect(timezoneLocation("Asia/Calcutta", -330).label).toBe("Kolkata"); // legacy IANA alias
    const est = timezoneLocation("Pacific/Chatham", -825);
    expect(est.label).toBe("Chatham");
    expect(est.lon).toBe(180); // UTC+13:45 clamps to the antimeridian
  });
  it("labels coordinates with the nearest reference place", () => {
    expect(nearestPlace(22.9, 89.9)?.name).toBe("Khulna");
    expect(nearestPlace(0, -140)).toBeNull();
    expect(formatCoord(-6.2, -35.5)).toBe("6.2°S, 35.5°W");
  });
});

describe("theme cycling & parsing", () => {
  it("cycles Mission Control → Daylight → Midnight → High Contrast → Mission Control", () => {
    expect(THEME_CYCLE).toEqual(["dark", "light", "midnight", "contrast"]);
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("midnight");
    expect(nextTheme("midnight")).toBe("contrast");
    expect(nextTheme("contrast")).toBe("dark");
    expect(nextTheme("dark", -1)).toBe("contrast");
    expect(nextTheme(undefined)).toBe("light");
    expect(nextTheme("system")).toBe("light");
  });
  it("parses stored values defensively", () => {
    expect(parseMode("solar")).toBe("solar");
    expect(parseMode("midnight")).toBe("midnight");
    expect(parseMode("sepia")).toBeNull();
    expect(parseMode(null)).toBeNull();
    expect(parseMotion("reduced")).toBe("reduced");
    expect(parseMotion("bogus")).toBe("system");
  });
  it("resolves modes to a painted theme", () => {
    expect(resolveMode("contrast", { systemDark: true })).toBe("contrast");
    expect(resolveMode("system", { systemDark: false })).toBe("light");
    expect(resolveMode("solar", { systemDark: true, location: { ...DHAKA, label: "Dhaka", source: "device" }, now: utc("2026-09-29T06:00:00") })).toBe("light");
    expect(resolveMode("solar", { systemDark: true, location: null })).toBe("dark");
  });
  it("describes every theme", () => {
    expect(THEMES.dark.label).toBe("Mission Control");
    expect(THEMES.light.label).toBe("Daylight");
    expect(THEMES.midnight.palette.bg).toBe("#000000");
  });
});

describe("accent tokens", () => {
  it("Emerald is the default and adds no override (portals keep their signature accent)", () => {
    expect(accentTokens("emerald")).toEqual({});
  });
  it("other accents map to rgb triplets for base / hover / soft / deep", () => {
    for (const id of ACCENT_IDS.filter((a) => a !== "emerald")) {
      const t = accentTokens(id);
      expect(Object.keys(t).sort()).toEqual(["--user-accent", "--user-accent-deep", "--user-accent-hi", "--user-accent-soft"]);
      for (const v of Object.values(t)) expect(v).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      expect(t["--user-accent"]).toBe(ACCENTS[id].rgb);
    }
    expect(accentTokens("violet")["--user-accent"]).toBe("139 92 246");
  });
  it("deep accent shades are dark enough for text on white (WCAG AA)", () => {
    const lum = (rgb: string) => {
      const [r, g, b] = rgb.split(" ").map((v) => {
        const c = Number(v) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (const a of Object.values(ACCENTS)) expect((1.05 / (lum(a.deep) + 0.05))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("pre-paint boot script", () => {
  function runBoot(store: Record<string, string>, reducedOS = false) {
    const attrs: Record<string, string> = {};
    const ls = {
      getItem: (k: string) => (k in store ? store[k]! : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    vi.stubGlobal("window", { localStorage: ls, matchMedia: () => ({ matches: reducedOS }) });
    vi.stubGlobal("document", { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } });
    try {
      bootAppearance();
    } finally {
      vi.unstubAllGlobals();
    }
    return { store, attrs };
  }

  it("agrees with the shared sun maths for Solar Auto", () => {
    const loc = { lat: 22.7, lon: 90.37 };
    for (const iso of ["2026-09-29T06:00:00", "2026-09-29T12:20:00", "2026-09-29T12:50:00", "2026-09-29T20:00:00", "2026-12-21T00:30:00"]) {
      vi.useFakeTimers();
      vi.setSystemTime(utc(iso));
      const { store } = runBoot({ agri_theme_mode: "solar", agri_solar_loc: JSON.stringify(loc) });
      vi.useRealTimers();
      expect(store.theme, iso).toBe(solarThemeAt(loc.lat, loc.lon, utc(iso)));
    }
  });

  it("applies accent and motion attributes, and leaves explicit themes alone", () => {
    const { store, attrs } = runBoot({ agri_theme_mode: "midnight", theme: "midnight", agri_accent: "violet", agri_motion: "reduced" });
    expect(store.theme).toBe("midnight");
    expect(attrs["data-accent"]).toBe("violet");
    expect(attrs["data-motion"]).toBe("reduced");
    const def = runBoot({}, false);
    expect(def.attrs).toEqual({}); // Mission Control default: nothing touched
    expect(runBoot({}, true).attrs["data-motion"]).toBe("reduced"); // OS prefers reduced motion
    expect(runBoot({ agri_motion: "full" }, true).attrs["data-motion"]).toBeUndefined();
    expect(runBoot({ agri_accent: "emerald" }).attrs["data-accent"]).toBeUndefined();
  });

  it("survives blocked storage", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("SecurityError");
      },
    });
    vi.stubGlobal("document", { documentElement: { setAttribute: () => undefined } });
    expect(() => bootAppearance()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
