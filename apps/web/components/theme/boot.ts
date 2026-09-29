/**
 * Pre-paint appearance boot script (runs in <head>, before next-themes' own
 * script and before first paint) so there is never a flash of the wrong theme:
 *
 *   · Solar Auto  → computes the sun's elevation at the cached location and writes
 *                   the concrete theme into next-themes' storage key, which the
 *                   next-themes script then applies.
 *   · Accent      → sets <html data-accent="…"> (Emerald = no attribute).
 *   · Motion      → sets <html data-motion="reduced"> when reduced (explicitly, or
 *                   by the OS when the preference is "system").
 *
 * The function is serialised with Function#toString, so it must stay fully
 * self-contained (no imports, no closures). The sun maths mirrors
 * components/twin/geo.ts — tests/theme-logic.test.ts checks they agree.
 * Author: Nitya Prakash Pandey
 */
export function bootAppearance(): void {
  try {
    var d = document.documentElement;
    var ls = window.localStorage;
    var mode = ls.getItem("agri_theme_mode");
    if (mode === "solar") {
      var lat = 20;
      var lon = (-new Date().getTimezoneOffset() / 60) * 15;
      try {
        var loc = JSON.parse(ls.getItem("agri_solar_loc") || "null");
        if (loc && typeof loc.lat === "number" && typeof loc.lon === "number") {
          lat = loc.lat;
          lon = loc.lon;
        }
      } catch (e) {}
      var RAD = Math.PI / 180;
      var n = Date.now() / 86400000 + 2440587.5 - 2451545.0;
      var L = (280.46 + 0.9856474 * n) % 360;
      var g = ((357.528 + 0.9856003 * n) % 360) * RAD;
      var lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
      var eps = (23.439 - 0.0000004 * n) * RAD;
      var ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
      var dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
      var gmst = (18.697374558 + 24.06570982441908 * n) % 24;
      if (gmst < 0) gmst += 24;
      var subLon = ra / RAD - gmst * 15;
      var h = (lon - subLon) * RAD;
      var el = Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(h)) / RAD;
      ls.setItem("theme", el > -6 ? "light" : "dark");
    }
    var accent = ls.getItem("agri_accent");
    if (accent && accent !== "emerald") d.setAttribute("data-accent", accent);
    var motion = ls.getItem("agri_motion");
    var reduce = motion === "reduced" || (motion !== "full" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (reduce) d.setAttribute("data-motion", "reduced");
  } catch (e) {}
}

export const APPEARANCE_BOOT_SCRIPT = `(${bootAppearance.toString()})()`;
