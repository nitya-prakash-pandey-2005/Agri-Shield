"use client";

/**
 * useAppearance() — the single entry point for theme / accent / motion state.
 * Provided by <AppearanceProvider> (components/theme/ThemeProvider.tsx).
 * Author: Nitya Prakash Pandey
 */
import { createContext, useContext } from "react";
import type { AccentId, MotionPref, SolarLocation, ThemeId, ThemeMode } from "./logic";

export interface TransitionOrigin {
  x: number;
  y: number;
}

export interface AppearanceState {
  /** What the user picked (a theme, "system" or "solar") */
  mode: ThemeMode;
  /** What is painted right now */
  theme: ThemeId;
  accent: AccentId;
  motion: MotionPref;
  /** Effective motion after applying the OS preference */
  reducedMotion: boolean;
  /** Where Solar Auto looks at the sun (null until known) */
  solarLocation: SolarLocation | null;
  mounted: boolean;
  setMode: (mode: ThemeMode, origin?: TransitionOrigin) => void;
  cycle: (origin?: TransitionOrigin) => ThemeId;
  setAccent: (accent: AccentId) => void;
  setMotion: (motion: MotionPref) => void;
  /** Ask the browser for a precise position for Solar Auto (prompts once) */
  requestDeviceLocation: () => Promise<boolean>;
}

const noop = () => undefined;
export const AppearanceContext = createContext<AppearanceState>({
  mode: "dark",
  theme: "dark",
  accent: "emerald",
  motion: "system",
  reducedMotion: false,
  solarLocation: null,
  mounted: false,
  setMode: noop,
  cycle: () => "dark",
  setAccent: noop,
  setMotion: noop,
  requestDeviceLocation: async () => false,
});

export function useAppearance(): AppearanceState {
  return useContext(AppearanceContext);
}

/** Window event any component can dispatch to open the Appearance panel. */
export const APPEARANCE_OPEN_EVENT = "agri:appearance";
export function openAppearancePanel() {
  window.dispatchEvent(new CustomEvent(APPEARANCE_OPEN_EVENT));
}
