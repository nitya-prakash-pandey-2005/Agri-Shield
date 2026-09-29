/**
 * simulateRouter — the Simulation Lab ("what if" physics on the workspace's
 * real portfolio): flood inundation on a real DEM, cyclone wind/surge replays,
 * drought & heat seasons, and a per-workspace scenario library.
 * Guarded by "use_workspace"; everything is scoped to ctx.user.orgId
 * (platform_admin may pass orgId).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { permitted, router } from "../trpc";
import { audit, getStore } from "../data/store";
import { trackUsage } from "../services/usage";
import { workspaceAssets } from "../services/portfolio";
import { FLOOD_CAVEATS, floodPresets, runFloodSim, simCache, type FloodSimResult } from "../services/sim-flood";
import { CYCLONE_CAVEATS, listTracks, runCycloneSim, SSHS, trackPreview, type CycloneSimResult } from "../services/sim-cyclone";
import { DROUGHT_CAVEATS, droughtPresets, runDroughtSim, type DroughtSimResult } from "../services/sim-drought";
import { DAMAGE_SOURCE, HEAT_SENS, JRC_ASIA, JRC_DEPTHS, KY, WIND_FRAGILITY, WIND_SOURCE } from "../services/sim-impact";
import { restore, track } from "../persist";

const read = permitted("use_workspace");

type Ctx = { user: { id: string; name: string; role: string; orgId: string | null } };
function wsOf(ctx: Ctx, orgId?: string | null): string {
  if (orgId && ctx.user.role === "platform_admin") return orgId;
  if (!ctx.user.orgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is not attached to a workspace" });
  return ctx.user.orgId;
}
async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    const offline = /fetch failed|ENOTFOUND|ECONN|timeout|aborted|offline/i.test(msg);
    throw new TRPCError({ code: offline ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST", message: offline ? `Elevation/water tiles could not be downloaded (${msg}). Areas you have simulated before still work from the cache.` : msg, cause: e });
  }
}
const orgZ = z.string().max(80).optional();
const latZ = z.number().min(-85).max(85);
const lonZ = z.number().min(-180).max(180);

// ─── Scenario library (per workspace, in memory like the rest of the store) ─

export interface SavedScenario {
  id: string;
  workspaceId: string;
  kind: "flood" | "cyclone" | "drought";
  name: string;
  notes: string;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  input: unknown;
  summary: {
    headline: string;
    areaHa: number | null;
    assetsHit: number;
    exposureUsd: number;
    lossUsd: number;
    insuredLossUsd: number;
    elUpliftUsd: number;
    households: number;
    people: number | null;
    metrics: { label: string; value: string }[];
  };
}

const g = globalThis as unknown as { __agriSimLibrary?: Map<string, SavedScenario[]> };
const SIM_LIBRARY_VERSION = 1;
track("simulate.library", SIM_LIBRARY_VERSION, () => g.__agriSimLibrary);
const library: Map<string, SavedScenario[]> = (g.__agriSimLibrary ??=
  restore<Map<string, SavedScenario[]>>("simulate.library", SIM_LIBRARY_VERSION, (v) => v instanceof Map) ?? new Map());
const libOf = (ws: string) => {
  let l = library.get(ws);
  if (!l) library.set(ws, (l = []));
  return l;
};

const usd = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);

export function summarise(r: FloodSimResult | CycloneSimResult | DroughtSimResult): SavedScenario["summary"] {
  if (r.kind === "flood") {
    const k = Math.min(r.levels.length - 1, Math.max(0, Math.round(r.input.riseM / 0.1)));
    const L = r.levels[k]!;
    return {
      headline: `+${L.riseM.toFixed(1)} m water level: ${L.floodedHa.toLocaleString("en-US")} ha flooded, ${L.assetsHit} assets hit, ${usd(L.lossUsd)} loss`,
      areaHa: L.floodedHa,
      assetsHit: L.assetsHit,
      exposureUsd: L.exposureHitUsd,
      lossUsd: L.lossUsd,
      insuredLossUsd: L.insuredLossUsd,
      elUpliftUsd: L.elUpliftUsd,
      households: L.households,
      people: L.people,
      metrics: [
        { label: "Water-level rise", value: `+${L.riseM.toFixed(1)} m` },
        { label: "Mean depth", value: `${L.meanDepthM.toFixed(2)} m` },
        { label: "Area", value: `${r.input.sizeKm} km box @ ${r.input.center.lat.toFixed(3)}, ${r.input.center.lon.toFixed(3)}` },
        { label: "Sources", value: r.input.sources },
      ],
    };
  }
  if (r.kind === "cyclone") {
    return {
      headline: `${r.storm.name}${r.storm.season ? ` ${r.storm.season}` : ""}: ${r.totals.assetsHit} assets in gale-force winds or surge, ${usd(r.totals.lossUsd)} loss`,
      areaHa: r.areaHa.cat1,
      assetsHit: r.totals.assetsHit,
      exposureUsd: r.totals.exposureHitUsd,
      lossUsd: r.totals.lossUsd,
      insuredLossUsd: r.totals.insuredLossUsd,
      elUpliftUsd: r.totals.elUpliftUsd,
      households: r.totals.households,
      people: r.people.cat1,
      metrics: [
        { label: "Peak wind (track)", value: `${Math.round(r.storm.peakWindMs * 3.6)} km/h` },
        { label: "Max footprint wind", value: `${Math.round(r.footprint.maxMs * 3.6)} km/h` },
        { label: "Max surge index", value: `${r.surgeMaxM.toFixed(1)} m` },
        { label: "Intensity scale", value: `×${(r.input.intensityScale ?? 1).toFixed(2)}` },
      ],
    };
  }
  return {
    headline: `−${r.input.deficitPct}% rain, +${r.input.tempAnomalyC} °C: mean yield loss ${r.totals.meanYieldLossPct}%, ${usd(r.totals.revenueLossUsd)} revenue lost`,
    areaHa: r.totals.areaHa,
    assetsHit: r.totals.assetsSevere,
    exposureUsd: r.totals.revenueUsd,
    lossUsd: r.totals.revenueLossUsd,
    insuredLossUsd: r.totals.insuredLossUsd,
    elUpliftUsd: r.totals.elUpliftUsd,
    households: r.totals.householdsSevere,
    people: null,
    metrics: [
      { label: "Rainfall deficit", value: `${r.input.deficitPct}%` },
      { label: "Temperature anomaly", value: `+${r.input.tempAnomalyC} °C` },
      { label: "Mean yield loss", value: `${r.totals.meanYieldLossPct}%` },
      { label: "Irrigation", value: r.input.irrigation },
    ],
  };
}

// ─── Input schemas ────────────────────────────────────────────────────────

const floodInput = z.object({
  orgId: orgZ,
  center: z.object({ lat: latZ, lon: lonZ }),
  sizeKm: z.number().min(2).max(60),
  zoom: z.union([z.literal("auto"), z.number().int().min(11).max(13)]).optional(),
  sources: z.enum(["sea", "rivers", "both"]).default("both"),
  reference: z.enum(["source", "lowpct"]).default("source"),
  lowPercentile: z.number().min(1).max(50).optional(),
  maxRiseM: z.number().min(0.5).max(8).optional(),
  rainExcessMm: z.number().min(0).max(500).optional(),
  catchmentRatio: z.number().min(1).max(10).optional(),
  riseM: z.number().min(0).max(8),
  tag: z.string().max(60).nullish(),
  label: z.string().max(120).optional(),
});

const cycloneInput = z.object({
  orgId: orgZ,
  trackId: z.string().max(40).optional(),
  custom: z
    .object({
      name: z.string().max(60).optional(),
      speedKmh: z.number().min(5).max(60),
      points: z.array(z.object({ lat: latZ, lon: lonZ, windKt: z.number().min(20).max(185), presHpa: z.number().min(870).max(1012).nullish() })).min(2).max(40),
    })
    .optional(),
  intensityScale: z.number().min(0.5).max(1.6).optional(),
  shelfFactor: z.number().min(500).max(10000).optional(),
  surgeFocus: z.object({ lat: latZ, lon: lonZ }).nullish(),
  runSurgeFlood: z.boolean().optional(),
  label: z.string().max(120).optional(),
});

const droughtInput = z.object({
  orgId: orgZ,
  deficitPct: z.number().min(0).max(90),
  tempAnomalyC: z.number().min(-2).max(6),
  irrigation: z.enum(["asset", "rainfed", "irrigated"]).default("asset"),
  season: z.string().max(40).optional(),
  tag: z.string().max(60).nullish(),
  label: z.string().max(120).optional(),
});

export const METHODOLOGY = {
  flood: {
    model: "Connectivity-aware bathtub (priority-flood from sea/river sources on the SRTM/Terrarium DEM, 4-connected), HAND-style reference, optional level-pool ponding of rainfall excess",
    damage: { source: DAMAGE_SOURCE, depths: JRC_DEPTHS, curves: JRC_ASIA },
    caveats: FLOOD_CAVEATS,
  },
  cyclone: {
    model: "Holland (1980) parametric wind profile with Vickery & Wadhera (2008) Rmax/B, 0.8 surface reduction, forward-motion asymmetry; surge index = inverse barometer + steady wind set-up",
    wind: { source: WIND_SOURCE, fragility: WIND_FRAGILITY },
    scale: SSHS,
    caveats: CYCLONE_CAVEATS,
  },
  drought: { model: "FAO-33 1 − Ya/Ym = Ky·(1 − ETa/ETm) + heat penalty (Zhao et al. 2017)", ky: KY, heat: HEAT_SENS, caveats: DROUGHT_CAVEATS },
};

// ─── Router ───────────────────────────────────────────────────────────────

export const simulateRouter = router({
  ping: read.query(() => ({ ok: true })),

  /** Everything the lab needs to set up: map centre, assets, groups, districts, verification presets. */
  context: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) =>
    guard(() => {
      const ws = wsOf(ctx, input?.orgId);
      const s = getStore();
      const org = s.orgs.find((o) => o.id === ws);
      const assets = workspaceAssets(ws);
      const tags = new Map<string, { n: number; s: number; w: number; e: number; nn: number; lat: number; lon: number }>();
      for (const a of assets)
        for (const t of a.tags) {
          const m = tags.get(t) ?? { n: 0, s: 90, w: 180, e: -180, nn: -90, lat: 0, lon: 0 };
          m.n++;
          m.s = Math.min(m.s, a.lat);
          m.nn = Math.max(m.nn, a.lat);
          m.w = Math.min(m.w, a.lon);
          m.e = Math.max(m.e, a.lon);
          m.lat += a.lat;
          m.lon += a.lon;
          tags.set(t, m);
        }
      const districts = s.districts.map((d) => {
        const inD = assets.filter((a) => a.districtId === d.id);
        return { id: d.id, name: d.name, country: d.countryName, lat: d.lat, lon: d.lon, assets: inD.length };
      });
      return {
        workspace: { id: ws, name: org?.name ?? ws, industry: (org as { industry?: string } | undefined)?.industry ?? null, center: org?.settings?.defaultCenter ?? [20, 95], zoom: org?.settings?.defaultZoom ?? 6 },
        assets: assets.map((a) => ({ id: a.id, name: a.name, type: a.type, lat: a.lat, lon: a.lon, valueUsd: a.valueUsd, crop: a.crop, districtId: a.districtId, tags: a.tags })),
        groups: [...tags.entries()]
          .filter(([, m]) => m.n >= 2)
          .map(([tag, m]) => {
            const kmLat = (m.nn - m.s) * 111.32;
            const kmLon = (m.e - m.w) * 111.32 * Math.cos((((m.s + m.nn) / 2) * Math.PI) / 180);
            return { tag, count: m.n, center: { lat: m.lat / m.n, lon: m.lon / m.n }, spanKm: Math.round(Math.max(kmLat, kmLon) + 6) };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 30),
        districts: districts.sort((a, b) => b.assets - a.assets || a.name.localeCompare(b.name)),
        places: [
          { id: "satkhira", label: "Satkhira–Shyamnagar coast (Bangladesh)", lat: 22.45, lon: 89.1, sizeKm: 50, riseM: 1.5 },
          { id: "khulna", label: "Khulna–Mongla polders (Bangladesh)", lat: 22.6, lon: 89.55, sizeKm: 50, riseM: 1.5 },
          { id: "bentre", label: "Bến Tre, Mekong Delta (Vietnam)", lat: 10.2, lon: 106.4, sizeKm: 50, riseM: 1.0 },
          { id: "demak", label: "Demak subsiding coast (Java, Indonesia)", lat: -6.89, lon: 110.6, sizeKm: 40, riseM: 0.8 },
          { id: "kendrapara", label: "Kendrapara / Mahanadi delta (Odisha, India)", lat: 20.45, lon: 86.6, sizeKm: 50, riseM: 1.5 },
          { id: "pampanga", label: "Pampanga river delta (Philippines)", lat: 14.85, lon: 120.7, sizeKm: 40, riseM: 1.0 },
        ],
      };
    })
  ),

  floodPresets: read.input(z.object({ lat: latZ, lon: lonZ })).query(({ input }) => guard(() => floodPresets(input.lat, input.lon))),

  runFlood: read.input(floodInput).mutation(({ ctx, input }) =>
    guard(async () => {
      const ws = wsOf(ctx, input.orgId);
      const assetIds = input.tag ? workspaceAssets(ws).filter((a) => a.tags.includes(input.tag!)).map((a) => a.id) : undefined;
      const r = await runFloodSim(ws, { center: input.center, sizeKm: input.sizeKm, zoom: input.zoom ?? "auto", sources: input.sources, reference: input.reference, lowPercentile: input.lowPercentile, maxRiseM: input.maxRiseM, rainExcessMm: input.rainExcessMm, catchmentRatio: input.catchmentRatio, riseM: input.riseM, label: input.label }, { assetIds });
      trackUsage(ws, "assessments");
      return r;
    })
  ),

  tracks: read.input(z.object({ orgId: orgZ, near: z.enum(["portfolio", "all"]).default("portfolio") }).optional()).query(({ ctx, input }) =>
    guard(() => {
      const ws = wsOf(ctx, input?.orgId);
      const pts = workspaceAssets(ws).map((a) => ({ lat: a.lat, lon: a.lon }));
      // thin the portfolio to ≤ 60 probe points for the distance scan
      const probe = pts.filter((_, i) => i % Math.max(1, Math.ceil(pts.length / 60)) === 0);
      const near = input?.near !== "all" && probe.length ? listTracks(probe, 500) : [];
      return { tracks: near.length ? near : listTracks(), filtered: near.length > 0 };
    })
  ),

  trackPoints: read.input(z.object({ id: z.string().max(40) })).query(({ input }) =>
    guard(() => {
      const t = trackPreview(input.id);
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown storm track" });
      return t;
    })
  ),

  runCyclone: read.input(cycloneInput).mutation(({ ctx, input }) =>
    guard(async () => {
      const ws = wsOf(ctx, input.orgId);
      const { orgId: _o, ...rest } = input;
      const r = await runCycloneSim(ws, rest);
      trackUsage(ws, "assessments");
      return r;
    })
  ),

  droughtPresets: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => guard(() => droughtPresets(wsOf(ctx, input?.orgId)))),

  runDrought: read.input(droughtInput).mutation(({ ctx, input }) =>
    guard(async () => {
      const ws = wsOf(ctx, input.orgId);
      const { orgId: _o, ...rest } = input;
      const r = await runDroughtSim(ws, rest);
      trackUsage(ws, "assessments");
      return r;
    })
  ),

  methodology: read.query(() => METHODOLOGY),

  library: router({
    list: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => guard(() => libOf(wsOf(ctx, input?.orgId)).slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()))),

    save: read
      .input(z.object({ orgId: orgZ, simId: z.string().max(60), name: z.string().min(1).max(120), notes: z.string().max(1000).default(""), riseM: z.number().min(0).max(8).optional() }))
      .mutation(({ ctx, input }) =>
        guard(() => {
          const ws = wsOf(ctx, input.orgId);
          const r = simCache.get(input.simId) as FloodSimResult | CycloneSimResult | DroughtSimResult | undefined;
          if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "This result has expired — run the simulation again, then save." });
          const res = r.kind === "flood" && input.riseM != null ? { ...r, input: { ...r.input, riseM: input.riseM } } : r;
          const rec: SavedScenario = {
            id: `scn-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
            workspaceId: ws,
            kind: res.kind,
            name: input.name,
            notes: input.notes,
            createdBy: ctx.user.id,
            createdByName: ctx.user.name,
            createdAt: new Date(),
            input: res.input,
            summary: summarise(res),
          };
          const lib = libOf(ws);
          lib.unshift(rec);
          if (lib.length > 100) lib.length = 100;
          audit({ userId: ctx.user.id, userName: ctx.user.name, action: "simulation.save", entity: "scenario", entityId: rec.id, details: `${rec.kind}: ${rec.name} — ${rec.summary.headline}` });
          return rec;
        })
      ),

    rename: read.input(z.object({ orgId: orgZ, id: z.string(), name: z.string().min(1).max(120), notes: z.string().max(1000).optional() })).mutation(({ ctx, input }) =>
      guard(() => {
        const rec = libOf(wsOf(ctx, input.orgId)).find((x) => x.id === input.id);
        if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Scenario not found" });
        rec.name = input.name;
        if (input.notes != null) rec.notes = input.notes;
        return rec;
      })
    ),

    remove: read.input(z.object({ orgId: orgZ, id: z.string() })).mutation(({ ctx, input }) =>
      guard(() => {
        const ws = wsOf(ctx, input.orgId);
        const lib = libOf(ws);
        const i = lib.findIndex((x) => x.id === input.id);
        if (i < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Scenario not found" });
        const [rec] = lib.splice(i, 1);
        audit({ userId: ctx.user.id, userName: ctx.user.name, action: "simulation.delete", entity: "scenario", entityId: rec!.id, details: rec!.name });
        return { ok: true };
      })
    ),
  }),
});
