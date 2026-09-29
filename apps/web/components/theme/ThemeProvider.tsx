"use client";

/**
 * Appearance provider — wraps next-themes and adds:
 *   · 4 themes (Mission Control / Daylight / Midnight OLED / High Contrast) + System + Solar Auto
 *   · accent colour and motion preference (persisted, applied pre-paint by boot.ts)
 *   · Solar Auto: follows the real sun at the workspace location (org default
 *     centre → device position if already permitted → time-zone estimate),
 *     re-evaluated every 3 minutes and whenever the tab becomes visible
 *   · cinematic switch: View Transitions circular reveal from the click point,
 *     200 ms cross-fade fallback, no animation when motion is reduced
 *   · Ctrl/⌘ + Shift + L cycles themes; printing always uses Daylight
 *
 * Author: Nitya Prakash Pandey
 */
import { MotionConfig } from "framer-motion";
import { useSession } from "next-auth/react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  STORAGE_KEYS,
  THEMES,
  THEME_IDS,
  formatClock,
  isAccentId,
  isThemeId,
  nextSolarSwitch,
  nextTheme,
  parseMode,
  parseMotion,
  placeLabel,
  solarThemeAt,
  timezoneLocation,
  type AccentId,
  type MotionPref,
  type SolarLocation,
  type ThemeId,
  type ThemeMode,
} from "./logic";
import { AppearanceContext, type AppearanceState, type TransitionOrigin } from "./useAppearance";

const SOLAR_RECHECK_MS = 3 * 60_000;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode / blocked storage: preference just won't persist */
  }
}

/** The theme currently painted on <html>. */
function paintedTheme(): ThemeId {
  const d = document.documentElement;
  return THEME_IDS.find((t) => d.classList.contains(t)) ?? "dark";
}

/** Paint a theme synchronously (next-themes re-applies the same thing right after). */
function paint(theme: ThemeId) {
  const d = document.documentElement;
  d.classList.remove(...THEME_IDS);
  d.classList.add(theme);
  d.setAttribute("data-theme", theme);
  d.style.colorScheme = theme === "light" ? "light" : "dark";
}

function toggleOrigin(): TransitionOrigin | undefined {
  const el = document.querySelector<HTMLElement>("[data-theme-toggle]");
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  if (!r.width) return undefined;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };

/** Run `apply` with the cinematic reveal (or a cross-fade / nothing). */
function transitionTheme(target: ThemeId, apply: () => void, reduced: boolean, origin?: TransitionOrigin) {
  const d = document.documentElement;
  if (paintedTheme() === target || reduced) {
    apply();
    return;
  }
  const doc = document as ViewTransitionDoc;
  if (typeof doc.startViewTransition === "function") {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = origin?.x ?? w - 48;
    const y = origin?.y ?? 28;
    const r = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
    d.classList.add("theme-vt");
    try {
      const vt = doc.startViewTransition(() => flushSync(apply));
      vt.ready
        .then(() => {
          d.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
            { duration: 650, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" }
          );
        })
        .catch(() => undefined);
      vt.finished.finally(() => d.classList.remove("theme-vt")).catch(() => undefined);
    } catch {
      d.classList.remove("theme-vt");
      apply();
    }
    return;
  }
  d.classList.add("theme-xfade");
  apply();
  window.setTimeout(() => d.classList.remove("theme-xfade"), 260);
}

function AppearanceProvider({ children }: { children: ReactNode }) {
  const { setTheme, resolvedTheme } = useTheme();
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [accent, setAccentState] = useState<AccentId>("emerald");
  const [motion, setMotionState] = useState<MotionPref>("system");
  const [osReduced, setOsReduced] = useState(false);
  const [deviceLocation, setDeviceLocation] = useState<SolarLocation | null>(null);
  const [tzLocation, setTzLocation] = useState<SolarLocation | null>(null);

  // ── hydrate preferences ────────────────────────────────────────────
  useEffect(() => {
    setModeState(parseMode(read(STORAGE_KEYS.mode)) ?? parseMode(read(STORAGE_KEYS.theme)) ?? "dark");
    const a = read(STORAGE_KEYS.accent);
    setAccentState(isAccentId(a) ? a : "emerald");
    setMotionState(parseMotion(read(STORAGE_KEYS.motion)));
    let tz: string | undefined;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {}
    setTzLocation(timezoneLocation(tz, new Date().getTimezoneOffset()));
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setOsReduced(mq.matches);
    const onMq = () => setOsReduced(mq.matches);
    mq.addEventListener?.("change", onMq);
    // Keep tabs in sync
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.mode) setModeState(parseMode(e.newValue) ?? "dark");
      if (e.key === STORAGE_KEYS.accent) setAccentState(isAccentId(e.newValue) ? e.newValue : "emerald");
      if (e.key === STORAGE_KEYS.motion) setMotionState(parseMotion(e.newValue));
    };
    window.addEventListener("storage", onStorage);
    setMounted(true);
    return () => {
      mq.removeEventListener?.("change", onMq);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const reducedMotion = motion === "reduced" || (motion === "system" && osReduced);
  const theme: ThemeId = isThemeId(resolvedTheme) ? resolvedTheme : "dark";

  // Accent + motion attributes (boot.ts sets them pre-paint; this keeps them live)
  useEffect(() => {
    if (!mounted) return;
    const d = document.documentElement;
    if (accent === "emerald") d.removeAttribute("data-accent");
    else d.setAttribute("data-accent", accent);
  }, [accent, mounted]);
  useEffect(() => {
    if (!mounted) return;
    const d = document.documentElement;
    if (reducedMotion) d.setAttribute("data-motion", "reduced");
    else d.removeAttribute("data-motion");
  }, [reducedMotion, mounted]);

  // Browser chrome colour follows the theme
  useEffect(() => {
    if (!mounted) return;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEMES[theme].chrome));
  }, [theme, mounted]);

  // ── Solar Auto location: workspace → device → time zone ─────────────
  const role = session?.user?.role;
  const wantsWorkspace = mounted && mode === "solar" && !!role && role !== "farmer";
  const me = trpc.workspace.me.useQuery(undefined, { enabled: wantsWorkspace, staleTime: 5 * 60_000, retry: false });
  const org = me.data?.org;
  const center = org?.settings?.defaultCenter;
  const workspaceLocation = useMemo<SolarLocation | null>(() => {
    if (!center || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) return null;
    return { lat: center[0], lon: center[1], label: placeLabel(center[0], center[1]), source: "workspace" };
  }, [center]);

  const locate = useCallback(
    (prompt: boolean) =>
      new Promise<boolean>((resolve) => {
        if (!("geolocation" in navigator)) return resolve(false);
        const go = () =>
          navigator.geolocation.getCurrentPosition(
            (p) => {
              const lat = Math.round(p.coords.latitude * 100) / 100;
              const lon = Math.round(p.coords.longitude * 100) / 100;
              setDeviceLocation({ lat, lon, label: placeLabel(lat, lon), source: "device" });
              resolve(true);
            },
            () => resolve(false),
            { enableHighAccuracy: false, maximumAge: 60 * 60_000, timeout: 10_000 }
          );
        if (prompt) return go();
        // Never prompt uninvited: only read the position if permission was already granted
        const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
        if (!perms?.query) return resolve(false);
        perms
          .query({ name: "geolocation" as PermissionName })
          .then((s) => (s.state === "granted" ? go() : resolve(false)))
          .catch(() => resolve(false));
      }),
    []
  );
  useEffect(() => {
    if (mounted && mode === "solar" && !deviceLocation) void locate(false);
  }, [mounted, mode, deviceLocation, locate]);

  const solarLocation = workspaceLocation ?? deviceLocation ?? tzLocation;
  const solarRef = useRef<SolarLocation | null>(null);
  solarRef.current = solarLocation;
  useEffect(() => {
    if (solarLocation) write(STORAGE_KEYS.solarLocation, JSON.stringify(solarLocation));
  }, [solarLocation]);

  // ── mode switching ───────────────────────────────────────────────────
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  const setMode = useCallback(
    (next: ThemeMode, origin?: TransitionOrigin) => {
      write(STORAGE_KEYS.mode, next);
      setModeState(next);
      let stored: string;
      let target: ThemeId;
      if (next === "system") {
        stored = "system";
        target = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      } else if (next === "solar") {
        const loc = solarRef.current;
        target = loc ? solarThemeAt(loc.lat, loc.lon, Date.now()) : paintedTheme();
        stored = target;
      } else {
        stored = target = next;
      }
      transitionTheme(target, () => {
        paint(target);
        setTheme(stored);
      }, reducedRef.current, origin);
    },
    [setTheme]
  );

  const cycle = useCallback(
    (origin?: TransitionOrigin) => {
      const next = nextTheme(paintedTheme());
      setMode(next, origin ?? toggleOrigin());
      return next;
    },
    [setMode]
  );

  const setAccent = useCallback((a: AccentId) => {
    write(STORAGE_KEYS.accent, a === "emerald" ? null : a);
    setAccentState(a);
  }, []);
  const setMotion = useCallback((m: MotionPref) => {
    write(STORAGE_KEYS.motion, m === "system" ? null : m);
    setMotionState(m);
  }, []);

  // ── Solar Auto loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted || mode !== "solar" || !solarLocation) return;
    const loc = solarLocation;
    const tick = (announce: boolean) => {
      const want = solarThemeAt(loc.lat, loc.lon, Date.now());
      if (want === paintedTheme()) return;
      transitionTheme(want, () => {
        paint(want);
        setTheme(want);
      }, reducedRef.current);
      if (announce) {
        const crossed = nextSolarSwitch(loc.lat, loc.lon, Date.now() - 6 * 3_600_000);
        const when = crossed ? ` ${formatClock(crossed.at)}` : "";
        toast(`Solar Auto: switched to ${want === "light" ? "Daylight" : "Mission Control"}`, {
          id: "solar-auto",
          description: `${want === "light" ? "Sunrise" : "Sunset"} at ${loc.label}${when} (civil twilight)`,
        });
      }
    };
    tick(false);
    const id = window.setInterval(() => tick(true), SOLAR_RECHECK_MS);
    const onVisible = () => document.visibilityState === "visible" && tick(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, mode, solarLocation?.lat, solarLocation?.lon, setTheme]);

  // ── Keyboard: Ctrl/⌘ + Shift + L cycles themes ───────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      if (e.code !== "KeyL" && e.key.toLowerCase() !== "l") return;
      e.preventDefault();
      const t = cycle();
      toast(`Appearance: ${THEMES[t].label}`, { id: "appearance", description: "Ctrl/⌘ + Shift + L to cycle · click the theme button for more" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycle]);

  // ── Printing always uses Daylight ────────────────────────────────────
  useEffect(() => {
    let before: ThemeId | null = null;
    const onBefore = () => {
      if (before !== null) return; // nested print (e.g. print preview re-render)
      before = paintedTheme();
      if (before !== "light") paint("light");
    };
    const onAfter = () => {
      if (before && before !== "light") paint(before);
      before = null;
    };
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, []);

  const value = useMemo<AppearanceState>(
    () => ({
      mode,
      theme,
      accent,
      motion,
      reducedMotion,
      solarLocation,
      mounted,
      setMode,
      cycle,
      setAccent,
      setMotion,
      requestDeviceLocation: () => locate(true),
    }),
    [mode, theme, accent, motion, reducedMotion, solarLocation, mounted, setMode, cycle, setAccent, setMotion, locate]
  );

  return (
    <AppearanceContext.Provider value={value}>
      <MotionConfig reducedMotion={motion === "reduced" ? "always" : motion === "full" ? "never" : "user"}>{children}</MotionConfig>
    </AppearanceContext.Provider>
  );
}

/** Drop-in replacement for next-themes' provider (used by app/providers.tsx). */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute={["class", "data-theme"]} defaultTheme="dark" enableSystem themes={THEME_IDS} disableTransitionOnChange={false}>
      <AppearanceProvider>{children}</AppearanceProvider>
    </NextThemesProvider>
  );
}
