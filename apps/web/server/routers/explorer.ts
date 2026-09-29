/**
 * explorerRouter — Risk Explorer ("climate due-diligence for any place on Earth").
 *
 * Workspace (use_workspace): assess · climate · outlook · compare · saveReport ·
 *                             listSavedReports · deleteSavedReport
 * Public (no login):          search · reverse · radarFrames · getSharedReport ·
 *                             publicAssess (5 reports / hour / IP, summary + forecast only)
 * Workspace data is always scoped to ctx.user.orgId.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { permitted, publicProcedure, router } from "../trpc";
import { getStore } from "../data/store";
import { audit } from "../data/store";
import { assessLocation, locationEnrichments, type LocationRiskReport } from "../services/location-risk";
import { within } from "../live/disk-cache";
import { heavyQueueStats } from "../live/climate";
import { gumbelReturnPeriod, round } from "../live/climate-math";
import { reverseGeocode, searchPlaces } from "../live/geosearch";
import { getRadarFrames } from "../live/radar";
import { deleteSnapshot, getSnapshot, listSnapshots, peekPublicQuota, saveSnapshot, takePublicQuota, type AssetType } from "../services/explorer-reports";
import { trackUsage } from "../services/usage";

const proc = permitted("use_workspace");

const CROPS = ["rice", "wheat", "maize", "sugarcane", "jute", "coconut", "vegetables", "sorghum", "barley", "potato", "onion", "cotton", "tobacco", "banana", "mango"] as const;
const coord = { lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) };
const ASSET_TYPES = ["farm", "field", "warehouse", "processing_plant", "port", "retail_outlet", "insured_plot", "loan", "community", "office"] as const;

const settle = async <T,>(p: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false; computing: boolean; error: string }> => {
  try {
    return { ok: true, value: await within(p, ms, "enrichment") };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, computing: error.includes("still computing"), error };
  }
};

function ipOf(ctx: { ip: string; req: Request }) {
  return ctx.req.headers.get("x-real-ip") ?? ctx.ip ?? "local";
}

export const explorerRouter = router({
  ping: proc.query(() => ({ ok: true })),

  // ─── Public helpers ──────────────────────────────────────────────────
  search: publicProcedure.input(z.object({ q: z.string().min(1).max(120) })).query(({ input }) => searchPlaces(input.q)),

  reverse: publicProcedure.input(z.object(coord)).query(async ({ input }) => {
    try {
      return await within(reverseGeocode(input.lat, input.lon), 8000, "reverse");
    } catch {
      return null;
    }
  }),

  radarFrames: publicProcedure.query(async () => {
    try {
      return await getRadarFrames();
    } catch {
      return null;
    }
  }),

  // ─── Full report (workspace) ─────────────────────────────────────────
  assess: proc
    .input(z.object({ ...coord, crop: z.enum(CROPS).optional(), name: z.string().max(120).nullish(), budgetMs: z.number().min(2000).max(25000).optional() }))
    .query(async ({ ctx, input }) => {
      const report = await assessLocation(input.lat, input.lon, { crop: input.crop, name: input.name ?? null, budgetMs: input.budgetMs ?? 9000, enrich: "full" });
      trackUsage(ctx.user.orgId, "assessments");
      return report;
    }),

  /** 40-year ERA5 history, trends, return periods + SPI drought index. Slow on first call → polls. */
  climate: proc.input(z.object(coord)).query(async ({ input }) => {
    const [hist, drought] = await Promise.all([settle(locationEnrichments.climate(input.lat, input.lon), 20000), settle(locationEnrichments.drought(input.lat, input.lon), 20000)]);
    return {
      ready: hist.ok || !("computing" in hist && hist.computing),
      history: hist.ok ? hist.value : null,
      drought: drought.ok ? drought.value : null,
      error: hist.ok ? null : hist.error,
      droughtError: drought.ok ? null : drought.error,
      queue: heavyQueueStats(),
    };
  }),

  /** Seasonal outlook (SEAS5) + 2050 projection (CMIP6), with the change applied to the site's observed climate. */
  outlook: proc.input(z.object(coord)).query(async ({ input }) => {
    const [seas, proj, hist] = await Promise.all([
      settle(locationEnrichments.seasonal(input.lat, input.lon), 15000),
      settle(locationEnrichments.projection(input.lat, input.lon), 20000),
      settle(locationEnrichments.climateCached(input.lat, input.lon), 3000),
    ]);
    let applied: { baselineHotDays: number; projectedHotDays: number; baselineRainMm: number; projectedRainMm: number; baselineRx1dayMm: number; projectedRx1dayMm: number; rp10TodayMm: number; rp10ReturnPeriod2050: number | null } | null = null;
    if (proj.ok && hist.ok) {
      const base = hist.value.annual.filter((a) => a.year >= 1995 && a.year <= 2014);
      if (base.length >= 10) {
        const m = (k: "hotDays" | "rainMm" | "maxDailyRainMm") => base.reduce((s, a) => s + a[k], 0) / base.length;
        const e = proj.value.ensemble;
        const rp10 = hist.value.returnPeriods.find((r) => r.years === 10)?.dailyRainMm ?? 0;
        // If extremes intensify by x %, today's 1-in-10-year day becomes more frequent:
        const g = hist.value.gumbel.daily;
        const scaled = g ? { ...g, mu: g.mu * (1 + e.rx1dayPct.mean / 100), beta: g.beta * (1 + e.rx1dayPct.mean / 100) } : null;
        applied = {
          baselineHotDays: round(m("hotDays")),
          projectedHotDays: round(Math.max(0, m("hotDays") + e.hotDays.mean)),
          baselineRainMm: Math.round(m("rainMm")),
          projectedRainMm: Math.round(m("rainMm") * (1 + e.annualRainPct.mean / 100)),
          baselineRx1dayMm: Math.round(m("maxDailyRainMm")),
          projectedRx1dayMm: Math.round(m("maxDailyRainMm") * (1 + e.rx1dayPct.mean / 100)),
          rp10TodayMm: rp10,
          rp10ReturnPeriod2050: scaled && rp10 ? round(gumbelReturnPeriod(scaled, rp10), 1) : null,
        };
      }
    }
    return {
      ready: (seas.ok || !("computing" in seas && seas.computing)) && (proj.ok || !("computing" in proj && proj.computing)),
      seasonal: seas.ok ? seas.value : null,
      projection: proj.ok ? proj.value : null,
      applied,
      seasonalError: seas.ok ? null : seas.error,
      projectionError: proj.ok ? null : proj.error,
      queue: heavyQueueStats(),
    };
  }),

  /** Side-by-side comparison of up to 4 places. */
  compare: proc
    .input(z.object({ places: z.array(z.object({ ...coord, name: z.string().max(120).nullish() })).min(1).max(4), crop: z.enum(CROPS).optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await Promise.all(
        input.places.map(async (p) => {
          const r = await assessLocation(p.lat, p.lon, { crop: input.crop, name: p.name ?? null, budgetMs: 6000 });
          const x = r.extras ?? {};
          return {
            lat: p.lat,
            lon: p.lon,
            name: r.location.name ?? `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`,
            country: r.location.country,
            elevationM: r.location.elevationM,
            composite: r.composite.score,
            level: r.composite.level,
            topDriver: r.composite.drivers[0] ?? "",
            flood: r.hazards.flood.score,
            floodP72: r.hazards.flood.p72,
            salinity: r.hazards.salinity.score,
            salinityApplicable: r.hazards.salinity.applicable,
            drought: r.hazards.drought.score,
            heat: r.hazards.heat.score,
            rain72hMm: round(r.forecast.hourly.reduce((s, h) => s + h.precipMm, 0)),
            rain14dP50: x.ensemble?.totals.days14.p50 ?? null,
            rain14dP90: x.ensemble?.totals.days14.p90 ?? null,
            heatIndexMaxC: x.heatStress?.heatIndexMaxC ?? null,
            spi90: x.drought?.spi90 ?? null,
            meanAnnualRainMm: x.climate?.summary.meanAnnualRainMm ?? null,
            rainTrendPctPerDecade: x.climate?.summary.rainTrendPctPerDecade ?? null,
            rp10DailyMm: x.climate?.returnPeriods.find((q) => q.years === 10)?.dailyRainMm ?? null,
            seasonalSummary: x.seasonal?.summary ?? null,
            hotDays2050Change: x.projection?.ensemble.hotDays.mean ?? null,
            rain2050ChangePct: x.projection?.ensemble.annualRainPct.mean ?? null,
            soilTexture: x.soil?.texture ?? null,
            coastKm: x.terrain?.coastKm ?? null,
          };
        })
      );
      trackUsage(ctx.user.orgId, "assessments", rows.length);
      return rows;
    }),

  // ─── Shareable snapshots ─────────────────────────────────────────────
  saveReport: proc
    .input(z.object({ ...coord, crop: z.enum(CROPS).optional(), name: z.string().max(120).nullish(), assetType: z.enum(ASSET_TYPES).default("farm"), note: z.string().max(600).nullish(), title: z.string().max(140).nullish() }))
    .mutation(async ({ ctx, input }) => {
      const report = await assessLocation(input.lat, input.lon, { crop: input.crop, name: input.name ?? null, budgetMs: 12000, enrich: "full" });
      const [hist, drought, seas, proj] = await Promise.all([
        settle(locationEnrichments.climateCached(input.lat, input.lon), 2500),
        settle(locationEnrichments.droughtCached(input.lat, input.lon), 2500),
        settle(locationEnrichments.seasonal(input.lat, input.lon), 2500),
        settle(locationEnrichments.projectionCached(input.lat, input.lon), 2500),
      ]);
      const org = getStore().orgs.find((o) => o.id === ctx.user.orgId);
      const name = report.location.name ?? `${input.lat.toFixed(3)}, ${input.lon.toFixed(3)}`;
      const snap = saveSnapshot({
        orgId: ctx.user.orgId ?? "none",
        orgName: org?.name ?? null,
        createdBy: ctx.user.id,
        createdByName: ctx.user.name ?? "Analyst",
        title: input.title?.trim() || `Climate due-diligence — ${name}`,
        note: input.note ?? null,
        assetType: input.assetType as AssetType,
        crop: input.crop ?? null,
        report,
        climate: hist.ok ? hist.value : (report.extras?.climate ?? null),
        drought: drought.ok ? drought.value : (report.extras?.drought ?? null),
        seasonal: seas.ok ? seas.value : (report.extras?.seasonal ?? null),
        projection: proj.ok ? proj.value : (report.extras?.projection ?? null),
      });
      trackUsage(ctx.user.orgId, "reports");
      audit({ userId: ctx.user.id, userName: ctx.user.name ?? "", action: "explorer.report.share", entity: "report", entityId: snap.id, details: `${name} (${input.lat.toFixed(3)}, ${input.lon.toFixed(3)})` });
      return { id: snap.id, url: `/r/${snap.id}`, title: snap.title, createdAt: snap.createdAt };
    }),

  listSavedReports: proc.query(({ ctx }) =>
    listSnapshots(ctx.user.orgId ?? "none").map((r) => ({
      id: r.id,
      url: `/r/${r.id}`,
      title: r.title,
      name: r.report.location.name,
      lat: r.report.location.lat,
      lon: r.report.location.lon,
      composite: r.report.composite.score,
      level: r.report.composite.level,
      assetType: r.assetType,
      crop: r.crop,
      createdAt: r.createdAt,
      createdByName: r.createdByName,
      views: r.views,
    }))
  ),

  deleteSavedReport: proc.input(z.object({ id: z.string().min(6).max(40) })).mutation(({ ctx, input }) => {
    if (!deleteSnapshot(ctx.user.orgId ?? "none", input.id)) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found in this workspace" });
    return { ok: true };
  }),

  getSharedReport: publicProcedure.input(z.object({ id: z.string().min(6).max(40) })).query(({ input }) => {
    const r = getSnapshot(input.id, true);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "This shared report does not exist or has expired." });
    const { orgId: _o, createdBy: _c, ...rest } = r;
    void _o;
    void _c;
    return rest;
  }),

  // ─── Public explorer (lead-gen) ──────────────────────────────────────
  publicQuota: publicProcedure.query(({ ctx }) => ({ remaining: peekPublicQuota(ipOf(ctx)), limit: 5 })),

  publicAssess: publicProcedure.input(z.object({ ...coord, name: z.string().max(120).nullish() })).query(async ({ ctx, input }) => {
    const q = takePublicQuota(ipOf(ctx));
    if (!q.ok) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Free limit reached (5 reports per hour). Try again in ${q.resetInMin} min — or create a free workspace for unlimited reports.` });
    const r = await assessLocation(input.lat, input.lon, { name: input.name ?? null, budgetMs: 7000 });
    const x = r.extras ?? {};
    // Lead-gen view: summary + forecast only. River record, salinity detail, climate history,
    // projections and soil stay in the workspace (the UI shows them as locked).
    const report: LocationRiskReport = {
      ...r,
      river: null,
      extras: { place: x.place ?? null, ensemble: x.ensemble ?? null, heatStress: x.heatStress ?? null, seasonal: x.seasonal ?? null, terrain: x.terrain ?? null, forecastRarity: x.forecastRarity ?? null },
      sources: r.sources.filter((s) => s.ok),
    };
    return { remaining: q.remaining, report };
  }),
});
