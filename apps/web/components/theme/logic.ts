/**
 * Appearance — pure logic shared by the provider, the toggle, the ⌘K palette
 * and unit tests. No React / DOM imports here.
 *
 *   Themes  : Mission Control (dark) · Daylight (light) · Midnight OLED · High Contrast
 *   Modes   : any theme, "system" (follow the OS) or "solar" (follow the real sun
 *             at the workspace location — Daylight while the sun is above civil
 *             twilight, Mission Control after dusk)
 *   Accent  : Emerald (default, portal signature colours) · Cyan · Violet · Amber · Rose
 *   Motion  : system · full · reduced
 *
 * Author: Nitya Prakash Pandey
 */
import { solarElevation } from "@/components/twin/geo";

export type ThemeId = "dark" | "light" | "midnight" | "contrast";
export type ThemeMode = ThemeId | "system" | "solar";
export type AccentId = "emerald" | "cyan" | "violet" | "amber" | "rose";
export type MotionPref = "system" | "full" | "reduced";

export const STORAGE_KEYS = {
  /** next-themes key — always holds the concrete theme (or "system") */
  theme: "theme",
  mode: "agri_theme_mode",
  accent: "agri_accent",
  motion: "agri_motion",
  solarLocation: "agri_solar_loc",
} as const;

export const THEME_IDS: ThemeId[] = ["dark", "light", "midnight", "contrast"];
/** Order used by Ctrl/⌘ + Shift + L */
export const THEME_CYCLE: ThemeId[] = ["dark", "light", "midnight", "contrast"];

export interface ThemePalette {
  bg: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  grid: string;
  line: string;
  bracket: string;
  glow: boolean;
}

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  tagline: string;
  icon: "moon" | "sun" | "eclipse" | "contrast";
  palette: ThemePalette;
  /** browser UI colour (meta theme-color) */
  chrome: string;
}

export const THEMES: Record<ThemeId, ThemeMeta> = {
  dark: {
    id: "dark",
    label: "Mission Control",
    tagline: "The signature command-centre look",
    icon: "moon",
    chrome: "#050a14",
    palette: { bg: "#060a16", panel: "#0c1426", border: "rgba(148,163,184,0.16)", text: "#f1f5f9", muted: "#64748b", grid: "rgba(148,163,184,0.08)", line: "#34d399", bracket: "rgba(52,211,153,0.8)", glow: true },
  },
  light: {
    id: "light",
    label: "Daylight",
    tagline: "Paper-white for offices, projectors & print",
    icon: "sun",
    chrome: "#f3f5f9",
    palette: { bg: "#f3f5f9", panel: "#ffffff", border: "rgba(15,23,42,0.1)", text: "#0f172a", muted: "#64748b", grid: "rgba(15,23,42,0.06)", line: "#059669", bracket: "rgba(5,150,105,0.5)", glow: false },
  },
  midnight: {
    id: "midnight",
    label: "Midnight OLED",
    tagline: "True black, low glow — kind to phone batteries",
    icon: "eclipse",
    chrome: "#000000",
    palette: { bg: "#000000", panel: "#050608", border: "rgba(255,255,255,0.1)", text: "#ffffff", muted: "#98a5b7", grid: "rgba(255,255,255,0.04)", line: "#34d399", bracket: "rgba(52,211,153,0.55)", glow: false },
  },
  contrast: {
    id: "contrast",
    label: "High Contrast",
    tagline: "Maximum legibility, loud focus rings",
    icon: "contrast",
    chrome: "#000000",
    palette: { bg: "#000000", panel: "#000000", border: "rgba(255,255,255,0.8)", text: "#ffffff", muted: "#ebebeb", grid: "transparent", line: "#6ee7b7", bracket: "#6ee7b7", glow: false },
  },
};

export interface AccentMeta {
  id: AccentId;
  label: string;
  /** "r g b" triplets: base (500) / hover (400) / soft text on dark (300) / deep text on white (700) */
  rgb: string;
  hi: string;
  soft: string;
  deep: string;
  hex: string;
}

export const ACCENTS: Record<AccentId, AccentMeta> = {
  emerald: { id: "emerald", label: "Emerald", rgb: "16 185 129", hi: "52 211 153", soft: "110 231 183", deep: "4 120 87", hex: "#10b981" },
  cyan: { id: "cyan", label: "Cyan", rgb: "6 182 212", hi: "34 211 238", soft: "103 232 249", deep: "14 116 144", hex: "#06b6d4" },
  violet: { id: "violet", label: "Violet", rgb: "139 92 246", hi: "167 139 250", soft: "196 181 253", deep: "109 40 217", hex: "#8b5cf6" },
  amber: { id: "amber", label: "Amber", rgb: "245 158 11", hi: "251 191 36", soft: "252 211 77", deep: "180 83 9", hex: "#f59e0b" },
  rose: { id: "rose", label: "Rose", rgb: "244 63 94", hi: "251 113 133", soft: "253 164 175", deep: "190 18 60", hex: "#f43f5e" },
};
export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];

/**
 * CSS custom properties an accent contributes. Emerald is the product default and
 * returns nothing, so every portal keeps its signature accent (pixel-identical).
 */
export function accentTokens(accent: AccentId): Record<string, string> {
  if (accent === "emerald") return {};
  const a = ACCENTS[accent];
  return { "--user-accent": a.rgb, "--user-accent-hi": a.hi, "--user-accent-soft": a.soft, "--user-accent-deep": a.deep };
}

export const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && (THEME_IDS as string[]).includes(v);
export const isAccentId = (v: unknown): v is AccentId => typeof v === "string" && v in ACCENTS;

export function parseMode(raw: string | null | undefined): ThemeMode | null {
  if (raw === "system" || raw === "solar") return raw;
  return isThemeId(raw) ? raw : null;
}
export function parseMotion(raw: string | null | undefined): MotionPref {
  return raw === "full" || raw === "reduced" ? raw : "system";
}

/** Next theme for Ctrl/⌘ + Shift + L. Unknown input starts the cycle at Daylight. */
export function nextTheme(current: string | null | undefined, dir: 1 | -1 = 1): ThemeId {
  const i = THEME_CYCLE.indexOf(current as ThemeId);
  if (i < 0) return dir === 1 ? "light" : "contrast";
  return THEME_CYCLE[(i + dir + THEME_CYCLE.length) % THEME_CYCLE.length]!;
}

export function modeLabel(mode: ThemeMode): string {
  if (mode === "system") return "System";
  if (mode === "solar") return "Solar Auto";
  return THEMES[mode].label;
}

// ─── Solar Auto ──────────────────────────────────────────────────────────

/** Civil twilight: the sky is bright enough to work by until the sun is 6° below the horizon. */
export const CIVIL_TWILIGHT_DEG = -6;

export function solarThemeAt(lat: number, lon: number, when: Date | number): "light" | "dark" {
  return solarElevation(lat, lon, when) > CIVIL_TWILIGHT_DEG ? "light" : "dark";
}

export interface SolarSwitch {
  at: Date;
  to: "light" | "dark";
  /** "sunrise" = dawn civil twilight (switch to Daylight), "sunset" = dusk */
  kind: "sunrise" | "sunset";
}

/**
 * When will Solar Auto next flip? Scans forward in 10-minute steps (up to
 * `horizonHours`), then bisects to ~15 s. Returns null during polar day/night
 * when the sun never crosses civil twilight inside the horizon.
 */
export function nextSolarSwitch(lat: number, lon: number, from: Date | number, horizonHours = 48): SolarSwitch | null {
  const t0 = typeof from === "number" ? from : from.getTime();
  const start = solarThemeAt(lat, lon, t0);
  const step = 10 * 60_000;
  let prev = t0;
  for (let t = t0 + step; t <= t0 + horizonHours * 3_600_000; t += step) {
    if (solarThemeAt(lat, lon, t) !== start) {
      let lo = prev;
      let hi = t;
      while (hi - lo > 15_000) {
        const mid = (lo + hi) / 2;
        if (solarThemeAt(lat, lon, mid) === start) lo = mid;
        else hi = mid;
      }
      const to = start === "light" ? "dark" : "light";
      return { at: new Date(hi), to, kind: to === "light" ? "sunrise" : "sunset" };
    }
    prev = t;
  }
  return null;
}

/** Solar elevation samples around `now` for the sun-path sparkline in the panel. */
export function sunPath(lat: number, lon: number, now: Date | number, hoursBack = 12, hoursAhead = 12, stepMin = 20): { t: number; el: number }[] {
  const t0 = typeof now === "number" ? now : now.getTime();
  const out: { t: number; el: number }[] = [];
  for (let m = -hoursBack * 60; m <= hoursAhead * 60; m += stepMin) {
    const t = t0 + m * 60_000;
    out.push({ t, el: solarElevation(lat, lon, t) });
  }
  return out;
}

export type SolarSource = "workspace" | "device" | "timezone";
export interface SolarLocation {
  lat: number;
  lon: number;
  label: string;
  source: SolarSource;
}

/** Rough longitude from a UTC offset (15° per hour). `offsetMinutes` = Date#getTimezoneOffset(). */
export function timezoneLongitude(offsetMinutes: number): number {
  const lon = (-offsetMinutes / 60) * 15;
  return Math.max(-180, Math.min(180, lon));
}

/** Reference places for friendly labels and timezone-based estimates. */
export const PLACES: { name: string; lat: number; lon: number; tz?: string }[] = [
  { name: "Dhaka", lat: 23.81, lon: 90.41, tz: "Asia/Dhaka" },
  { name: "Khulna", lat: 22.82, lon: 89.55 },
  { name: "Barisal", lat: 22.7, lon: 90.37 },
  { name: "Chittagong", lat: 22.36, lon: 91.78 },
  { name: "Satkhira", lat: 22.72, lon: 89.07 },
  { name: "Kolkata", lat: 22.57, lon: 88.36, tz: "Asia/Kolkata" },
  { name: "Bhubaneswar", lat: 20.3, lon: 85.82 },
  { name: "Cuttack", lat: 20.46, lon: 85.88 },
  { name: "Delhi", lat: 28.61, lon: 77.21 },
  { name: "Mumbai", lat: 19.08, lon: 72.88 },
  { name: "Chennai", lat: 13.08, lon: 80.27 },
  { name: "Bengaluru", lat: 12.97, lon: 77.59 },
  { name: "Patna", lat: 25.59, lon: 85.14 },
  { name: "Guwahati", lat: 26.14, lon: 91.74 },
  { name: "Kathmandu", lat: 27.72, lon: 85.32, tz: "Asia/Kathmandu" },
  { name: "Colombo", lat: 6.93, lon: 79.86, tz: "Asia/Colombo" },
  { name: "Karachi", lat: 24.86, lon: 67.0, tz: "Asia/Karachi" },
  { name: "Lahore", lat: 31.55, lon: 74.34 },
  { name: "Yangon", lat: 16.84, lon: 96.17, tz: "Asia/Yangon" },
  { name: "Bangkok", lat: 13.76, lon: 100.5, tz: "Asia/Bangkok" },
  { name: "Ho Chi Minh City", lat: 10.82, lon: 106.63, tz: "Asia/Ho_Chi_Minh" },
  { name: "Can Tho", lat: 10.03, lon: 105.79 },
  { name: "Ben Tre", lat: 10.24, lon: 106.38 },
  { name: "Hanoi", lat: 21.03, lon: 105.85 },
  { name: "Phnom Penh", lat: 11.56, lon: 104.93, tz: "Asia/Phnom_Penh" },
  { name: "Vientiane", lat: 17.98, lon: 102.63, tz: "Asia/Vientiane" },
  { name: "Manila", lat: 14.6, lon: 120.98, tz: "Asia/Manila" },
  { name: "Jakarta", lat: -6.2, lon: 106.85, tz: "Asia/Jakarta" },
  { name: "Singapore", lat: 1.35, lon: 103.82, tz: "Asia/Singapore" },
  { name: "Kuala Lumpur", lat: 3.14, lon: 101.69, tz: "Asia/Kuala_Lumpur" },
  { name: "Shanghai", lat: 31.23, lon: 121.47, tz: "Asia/Shanghai" },
  { name: "Hong Kong", lat: 22.32, lon: 114.17, tz: "Asia/Hong_Kong" },
  { name: "Tokyo", lat: 35.68, lon: 139.69, tz: "Asia/Tokyo" },
  { name: "Seoul", lat: 37.57, lon: 126.98, tz: "Asia/Seoul" },
  { name: "Dubai", lat: 25.2, lon: 55.27, tz: "Asia/Dubai" },
  { name: "Nairobi", lat: -1.29, lon: 36.82, tz: "Africa/Nairobi" },
  { name: "Lagos", lat: 6.52, lon: 3.38, tz: "Africa/Lagos" },
  { name: "Cairo", lat: 30.04, lon: 31.24, tz: "Africa/Cairo" },
  { name: "Johannesburg", lat: -26.2, lon: 28.05, tz: "Africa/Johannesburg" },
  { name: "London", lat: 51.51, lon: -0.13, tz: "Europe/London" },
  { name: "Paris", lat: 48.86, lon: 2.35, tz: "Europe/Paris" },
  { name: "Berlin", lat: 52.52, lon: 13.4, tz: "Europe/Berlin" },
  { name: "Rome", lat: 41.9, lon: 12.5, tz: "Europe/Rome" },
  { name: "Madrid", lat: 40.42, lon: -3.7, tz: "Europe/Madrid" },
  { name: "New York", lat: 40.71, lon: -74.01, tz: "America/New_York" },
  { name: "Chicago", lat: 41.88, lon: -87.63, tz: "America/Chicago" },
  { name: "Denver", lat: 39.74, lon: -104.99, tz: "America/Denver" },
  { name: "Los Angeles", lat: 34.05, lon: -118.24, tz: "America/Los_Angeles" },
  { name: "Mexico City", lat: 19.43, lon: -99.13, tz: "America/Mexico_City" },
  { name: "São Paulo", lat: -23.55, lon: -46.63, tz: "America/Sao_Paulo" },
  { name: "Sydney", lat: -33.87, lon: 151.21, tz: "Australia/Sydney" },
  { name: "Reykjavik", lat: 64.15, lon: -21.94, tz: "Atlantic/Reykjavik" },
  { name: "Tromsø", lat: 69.65, lon: 18.96 },
];

function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * R) / 2) ** 2 + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin(((lon2 - lon1) * R) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Nearest reference place within `maxKm`, for labels like "Day at Khulna". */
export function nearestPlace(lat: number, lon: number, maxKm = 160): { name: string; km: number } | null {
  let best: { name: string; km: number } | null = null;
  for (const p of PLACES) {
    const km = distKm(lat, lon, p.lat, p.lon);
    if (km <= maxKm && (!best || km < best.km)) best = { name: p.name, km };
  }
  return best;
}

export function formatCoord(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
}

export function placeLabel(lat: number, lon: number): string {
  return nearestPlace(lat, lon)?.name ?? formatCoord(lat, lon);
}

/** Best location guess from the browser's IANA zone (+ offset fallback for longitude). */
const TZ_ALIASES: Record<string, string> = { "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Rangoon": "Asia/Yangon", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Dacca": "Asia/Dhaka" };

export function timezoneLocation(tz: string | undefined, offsetMinutes: number): SolarLocation {
  const zone = tz ? (TZ_ALIASES[tz] ?? tz) : undefined;
  const hit = zone ? PLACES.find((p) => p.tz === zone) : undefined;
  if (hit) return { lat: hit.lat, lon: hit.lon, label: hit.name, source: "timezone" };
  const city = tz?.split("/").pop()?.replace(/_/g, " ");
  // Latitude is unknown from an offset alone; 20° is a reasonable prior for this product's markets.
  return { lat: 20, lon: timezoneLongitude(offsetMinutes), label: city || "your time zone", source: "timezone" };
}

/** Resolve a mode to the concrete theme to paint right now. */
export function resolveMode(mode: ThemeMode, ctx: { systemDark: boolean; location?: SolarLocation | null; now?: Date | number }): ThemeId {
  if (mode === "system") return ctx.systemDark ? "dark" : "light";
  if (mode === "solar") {
    const loc = ctx.location;
    if (!loc) return ctx.systemDark ? "dark" : "light";
    return solarThemeAt(loc.lat, loc.lon, ctx.now ?? Date.now());
  }
  return mode;
}

/** "17:52" in the viewer's clock (or a given IANA zone). */
export function formatClock(d: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

/** Plain-language Solar Auto status for the panel and toasts. */
export function solarSummary(loc: SolarLocation, now: Date | number, timeZone?: string): { isDay: boolean; text: string; next: SolarSwitch | null; elevation: number; when: string | null } {
  const t = typeof now === "number" ? now : now.getTime();
  const elevation = solarElevation(loc.lat, loc.lon, t);
  const isDay = elevation > CIVIL_TWILIGHT_DEG;
  const next = nextSolarSwitch(loc.lat, loc.lon, t);
  const where = loc.label;
  if (!next) {
    return { isDay, next, elevation, when: null, text: isDay ? `Midnight sun at ${where} — stays in Daylight` : `Polar night at ${where} — stays in Mission Control` };
  }
  const sameDay = new Date(t).toDateString() === next.at.toDateString();
  const when = `${formatClock(next.at, timeZone)}${sameDay ? "" : " tomorrow"}`;
  return {
    isDay,
    next,
    elevation,
    when,
    text: `${isDay ? "Day" : "Night"} at ${where} — switches to ${next.to === "light" ? "Daylight" : "Mission Control"} at ${when}`,
  };
}
