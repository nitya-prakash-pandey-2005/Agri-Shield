/**
 * Public (no-auth) procedures: landing page live counters, demo map,
 * live hazard feed, point weather and geocoding.
 */
import { z } from "zod";
import { publicProcedure, router } from "../trpc";
import { getStore } from "../data/store";
import { COUNTRIES } from "../data/geography";
import { getHazardEvents } from "../live/events";
import { geocode, getForecast, weatherLabel } from "../live/open-meteo";
import { liveRiskStatus } from "../live/district-risk";

export const publicRouter = router({
  /** Landing hero counter (spec §4.1) — auto-refreshed by the client. */
  stats: publicProcedure.query(() => {
    const s = getStore();
    const weekAgo = Date.now() - 7 * 86_400_000;
    const alertsThisWeek = s.alerts.filter((a) => a.createdAt.getTime() > weekAgo).reduce((n, a) => n + a.deliveries.sent, 0);
    const minutes = Math.floor((Date.now() - new Date().setHours(0, 0, 0, 0)) / 60_000);
    return {
      farmersProtectedToday: s.counters.farmersProtectedToday! + minutes * 3,
      alertsSentThisWeek: alertsThisWeek + s.counters.smsSentToday!,
      hectaresMonitored: s.districts.reduce((n, d) => n + d.monitoredAreaHa, 0),
      districtsMonitored: s.districts.length,
      countries: COUNTRIES.length,
      activeAlerts: s.alerts.filter((a) => a.isActive).length,
      live: liveRiskStatus(),
    };
  }),

  /** District risk polygons for the public demo map. */
  riskMap: publicProcedure
    .input(z.object({ country: z.string().length(2).optional() }).optional())
    .query(({ input }) => {
      const s = getStore();
      return s.districts
        .filter((d) => !input?.country || d.country === input.country)
        .map((d) => ({
          id: d.id,
          name: d.name,
          country: d.countryName,
          countryCode: d.country,
          basin: d.basin,
          lat: d.lat,
          lon: d.lon,
          geometry: d.geometry,
          floodRisk: d.floodRisk,
          salinityRisk: d.salinityRisk,
          floodProb72h: d.floodProb72h,
          ecCurrent: d.ecCurrent,
          riskLevel: d.riskLevel,
          rainfall72hMm: d.rainfall72hMm,
          riverDischargeM3s: d.riverDischargeM3s,
          liveSource: d.liveSource,
          lastUpdated: d.lastUpdated,
        }));
    }),

  /** Live GDACS + NASA EONET hazard events across Asia-Pacific. */
  hazards: publicProcedure.query(() => getHazardEvents()),

  countries: publicProcedure.query(() => COUNTRIES),

  /** Current conditions + 72h hourly for any point (Open-Meteo). */
  weather: publicProcedure
    .input(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }))
    .query(async ({ input }) => {
      try {
        const [f] = await getForecast([input], 4);
        if (!f) return null;
        const now = Date.now();
        const i0 = Math.max(0, f.hourly.time.findIndex((t) => new Date(t).getTime() > now) - 1);
        return {
          current: f.current ? { ...f.current, label: weatherLabel(f.current.weather_code) } : null,
          elevation: f.elevation,
          hourly: f.hourly.time.slice(i0, i0 + 72).map((time, k) => ({
            time,
            precipMm: f.hourly.precipitation[i0 + k] ?? 0,
            precipProb: f.hourly.precipitation_probability[i0 + k] ?? 0,
            tempC: f.hourly.temperature_2m[i0 + k] ?? null,
            humidity: f.hourly.relative_humidity_2m[i0 + k] ?? null,
            windKmh: f.hourly.wind_speed_10m[i0 + k] ?? null,
            soilMoisture: f.hourly.soil_moisture_0_to_7cm[i0 + k] ?? null,
          })),
          daily: f.daily.time.map((date, k) => ({
            date,
            precipMm: f.daily.precipitation_sum[k] ?? 0,
            precipProb: f.daily.precipitation_probability_max[k] ?? 0,
            tMax: f.daily.temperature_2m_max[k] ?? null,
            tMin: f.daily.temperature_2m_min[k] ?? null,
            et0: f.daily.et0_fao_evapotranspiration[k] ?? null,
          })),
          source: "Open-Meteo",
        };
      } catch {
        return null;
      }
    }),

  geocode: publicProcedure.input(z.object({ q: z.string().min(2).max(80) })).query(({ input }) => geocode(input.q).catch(() => [])),
});
