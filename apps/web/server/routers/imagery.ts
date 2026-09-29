/**
 * imageryRouter — Satellite Lab: GIBS layer availability, quick-pick places,
 * portfolio flood scan (MODIS 2-day flood pixels at asset locations) and
 * point NDVI anomaly series. Guarded by "use_workspace"; always scoped to
 * ctx.user.orgId (platform_admin may pass orgId).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { permitted, router } from "../trpc";
import { getStore } from "../data/store";
import { trackUsage } from "../services/usage";
import { LAYERS, LAYER_IDS } from "@/components/imagery/tile-math";
import { FLOOD_CAVEAT, FLOOD_SOURCE, floodScan, imageryPlaces, lastFloodScan, lastFloodScanResult, layerAvailability, ndviSeries, notifyFloodScan } from "../services/imagery";

const proc = permitted("use_workspace");

type Ctx = { user: { id: string; name: string; role: string; orgId: string | null } };
function wsOf(ctx: Ctx, orgId?: string | null): string {
  if (orgId && ctx.user.role === "platform_admin") return orgId;
  if (!ctx.user.orgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is not attached to a workspace" });
  return ctx.user.orgId;
}
const orgZ = z.string().max(80).optional();
const dateZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const imageryRouter = router({
  ping: proc.query(() => ({ ok: true })),

  layers: proc.query(async () => {
    const av = await layerAvailability();
    return {
      layers: LAYER_IDS.map((id) => ({ ...LAYERS[id], ...av.layers[id], ranges: av.layers[id].ranges })),
      availabilitySource: av.source,
      fetchedAt: av.fetchedAt,
    };
  }),

  places: proc.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => imageryPlaces(wsOf(ctx, input?.orgId))),

  floodScan: proc
    .input(z.object({ orgId: orgZ, date: dateZ, windowDays: z.number().int().min(1).max(10).optional(), assetIds: z.array(z.string().max(80)).max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const ws = wsOf(ctx, input.orgId);
      const today = new Date().toISOString().slice(0, 10);
      if (input.date > today) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a date that is not in the future" });
      if (input.date < "2021-01-01") throw new TRPCError({ code: "BAD_REQUEST", message: "The MODIS Combined Flood layer starts in January 2021" });
      const r = await floodScan(ws, input.date, { assetIds: input.assetIds, windowDays: input.windowDays });
      trackUsage(ws, "assessments", 1);
      return r;
    }),

  lastFloodScan: proc.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => {
    const ws = wsOf(ctx, input?.orgId);
    return { last: lastFloodScan(ws), result: lastFloodScanResult(ws), source: FLOOD_SOURCE, caveat: FLOOD_CAVEAT };
  }),

  notifyFloodScan: permitted("manage_assets")
    .input(z.object({ orgId: orgZ }).optional())
    .mutation(({ ctx, input }) => {
      try {
        const n = notifyFloodScan(wsOf(ctx, input?.orgId), ctx.user.name);
        return { id: n.id, title: n.title };
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }
    }),

  ndvi: proc
    .input(z.object({ orgId: orgZ, assetId: z.string().max(80).optional(), lat: z.number().min(-60).max(75).optional(), lon: z.number().min(-180).max(180).optional(), name: z.string().max(120).optional() }))
    .query(async ({ ctx, input }) => {
      const ws = wsOf(ctx, input.orgId);
      let point: { lat: number; lon: number; name: string | null };
      if (input.assetId) {
        const a = getStore().assets.find((x) => x.id === input.assetId && x.workspaceId === ws);
        if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found in this workspace" });
        point = { lat: a.lat, lon: a.lon, name: a.name };
      } else if (input.lat != null && input.lon != null) point = { lat: input.lat, lon: input.lon, name: input.name ?? null };
      else throw new TRPCError({ code: "BAD_REQUEST", message: "Pick an asset or a point" });
      try {
        const r = await ndviSeries(point);
        if (r.source.current === "fetched on demand") trackUsage(ws, "assessments", 1);
        return r;
      } catch (e) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: `MODIS NDVI service (ORNL DAAC) unavailable: ${e instanceof Error ? e.message : String(e)}` });
      }
    }),
});
