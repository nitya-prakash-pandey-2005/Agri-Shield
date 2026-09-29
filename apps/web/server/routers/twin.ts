/**
 * twinRouter — Earth Twin (3D mission-control globe + wall mode).
 * Guarded by "use_workspace"; scoped to ctx.user.orgId (platform_admin may pass an orgId,
 * or none for the all-regions platform view).
 *
 *  scene({ orgId? })          → one compact payload: assets, districts, hazards, cyclone tracks, flows, KPIs (cached 60 s per org)
 *  timeline({ from?, to?, orgId? }) → day buckets −30…+16 with events, risk index + per-asset / per-district series
 *  hotspots({ limit?, orgId? })     → ranked hotspots with plain-language captions for the auto-tour
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { permitted, router } from "../trpc";
import { getHotspots, getTimeline, getTwinScene, TIMELINE_FUTURE_DAYS, TIMELINE_PAST_DAYS } from "../services/twin";

const proc = permitted("use_workspace");
const orgZ = z.string().max(60).optional().nullable();

type Ctx = { user: { role: string; orgId?: string | null } };
function scopeOf(ctx: Ctx, orgId?: string | null): string | null {
  if (ctx.user.role === "platform_admin") return orgId ?? ctx.user.orgId ?? null;
  if (!ctx.user.orgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is not attached to a workspace" });
  return ctx.user.orgId;
}

export const twinRouter = router({
  ping: proc.query(() => ({ ok: true })),
  scene: proc.input(z.object({ orgId: orgZ }).nullish()).query(({ ctx, input }) => getTwinScene(scopeOf(ctx, input?.orgId))),
  timeline: proc
    .input(z.object({ from: z.number().int().min(-TIMELINE_PAST_DAYS).max(0).optional(), to: z.number().int().min(0).max(TIMELINE_FUTURE_DAYS).optional(), orgId: orgZ }).nullish())
    .query(({ ctx, input }) => getTimeline(scopeOf(ctx, input?.orgId), input?.from ?? -TIMELINE_PAST_DAYS, input?.to ?? TIMELINE_FUTURE_DAYS)),
  hotspots: proc.input(z.object({ limit: z.number().int().min(1).max(20).optional(), orgId: orgZ }).nullish()).query(({ ctx, input }) => getHotspots(scopeOf(ctx, input?.orgId), input?.limit ?? 10)),
});
