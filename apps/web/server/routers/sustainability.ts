/**
 * sustainabilityRouter — Yield Forecast (sub-router `yield`), Sustainability & carbon MRV
 * (`carbon`) and the workspace ESG summary (`esg`). Guarded by "use_workspace"; writes need
 * "manage_assets". Always scoped to ctx.user.orgId (platform_admin may pass orgId).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { permitted, router } from "../trpc";
import { audit, getStore } from "../data/store";
import { trackUsage } from "../services/usage";
import { assetDetail, districtDetail, yieldBook, yieldCacheBust, YIELD_METHODOLOGY, type YieldAssetRow } from "../services/yield-model";
import { carbonProgramme, CARBON_METHODOLOGY, ensureMrvSeed, esgSummary, IPCC, ORGANIC_KEYS, practiceOf, SFP_KEYS, SFW_KEYS } from "../services/carbon";
import { WATER_REFERENCE } from "../services/water-footprint";

const read = permitted("use_workspace");
const manage = permitted("manage_assets");

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
    throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e), cause: e });
  }
}
const orgZ = z.string().max(80).optional();

/** Book rows without the heavy per-member arrays (they stay server-side). */
function slim(r: YieldAssetRow) {
  const { memberYield: _m, baseline, ...f } = r.forecast;
  const { series: _s, ...b } = baseline;
  const { meta: _meta, ...rest } = r;
  return { ...rest, forecast: { ...f, baseline: b } };
}

const yieldRouter = router({
  book: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) =>
    guard(async () => {
      const b = await yieldBook(wsOf(ctx, input?.orgId));
      return { ...b, assets: b.assets.map(slim) };
    })
  ),

  /** Drop cached forecasts and recompute from the latest cached weather, flood record and NDVI. */
  refresh: read.input(z.object({ orgId: orgZ }).optional()).mutation(async ({ ctx, input }) => {
    const ws = wsOf(ctx, input?.orgId);
    yieldCacheBust(ws);
    trackUsage(ws, "assessments");
    const b = await yieldBook(ws, { force: true });
    return { ok: true, assets: b.assets.length, generatedAt: b.generatedAt };
  }),

  asset: read.input(z.object({ orgId: orgZ, id: z.string().max(40) })).query(({ ctx, input }) =>
    guard(async () => {
      const d = await assetDetail(wsOf(ctx, input.orgId), input.id);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "No yield forecast for this asset (not a crop asset, or missing crop/area)" });
      const { memberYield: _m, ...f } = d.row.forecast;
      return { ...d, row: { ...d.row, forecast: f } };
    })
  ),

  district: read.input(z.object({ orgId: orgZ, districtId: z.string().max(40) })).query(({ ctx, input }) =>
    guard(async () => {
      const d = await districtDetail(wsOf(ctx, input.orgId), input.districtId);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "District not in this workspace's scope" });
      const { memberYield: _m, ...f } = d.district.forecast;
      return { ...d, district: { ...d.district, forecast: f } };
    })
  ),

  methodology: read.query(() => YIELD_METHODOLOGY),
});

const programmeInput = z
  .object({
    orgId: orgZ,
    priceUsd: z.number().min(0).max(200).optional(),
    targetAdoptionPct: z.number().min(0).max(100).optional(),
    efMode: z.enum(["global", "regional"]).optional(),
    deductionPct: z.number().min(0).max(60).optional(),
    awdWaterSavingPct: z.number().min(10).max(40).optional(),
  })
  .optional();

const carbonRouter = router({
  programme: read.input(programmeInput).query(({ ctx, input }) => guard(() => carbonProgramme(wsOf(ctx, input?.orgId), input ?? {}))),

  methodology: read.query(() => ({ carbon: CARBON_METHODOLOGY, water: WATER_REFERENCE, keys: { sfw: SFW_KEYS, sfp: SFP_KEYS, organic: ORGANIC_KEYS } })),

  /** Mark AWD adopted / not adopted on one or many rice assets (farmer-level adoption tracker). */
  setAdoption: manage
    .input(
      z.object({
        orgId: orgZ,
        assetIds: z.array(z.string().max(40)).min(1).max(500),
        adopted: z.boolean(),
        status: z.enum(["self_reported", "field_verified", "remote_sensed"]).optional(),
        since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        note: z.string().max(280).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      guard(() => {
        const ws = wsOf(ctx, input.orgId);
        ensureMrvSeed(ws);
        const s = getStore();
        let changed = 0;
        const skipped: { id: string; reason: string }[] = [];
        for (const id of input.assetIds) {
          const a = s.assets.find((x) => x.id === id && x.workspaceId === ws);
          if (!a) {
            skipped.push({ id, reason: "not found" });
            continue;
          }
          const p = practiceOf(a);
          if (input.adopted && !p.eligible) {
            skipped.push({ id, reason: a.crop !== "rice" ? "not a rice asset" : "not eligible (no water control: rain-fed or deep-water rice)" });
            continue;
          }
          a.meta.mrv_awd = input.adopted;
          if (input.adopted) {
            a.meta.mrv_status = input.status ?? (typeof a.meta.mrv_status === "string" ? a.meta.mrv_status : "self_reported");
            a.meta.mrv_since = input.since ?? (typeof a.meta.mrv_since === "string" ? a.meta.mrv_since : new Date().toISOString().slice(0, 10));
            a.meta.mrv_verifiedBy = input.status === "field_verified" ? ctx.user.name : (a.meta.mrv_verifiedBy ?? null);
          }
          if (input.note != null) a.meta.mrv_note = input.note;
          a.meta.mrv_seeded = false;
          changed++;
        }
        if (changed) audit({ userId: ctx.user.id, userName: ctx.user.name, action: input.adopted ? "mrv.awd_adopt" : "mrv.awd_unadopt", entity: "asset", entityId: input.assetIds.slice(0, 5).join(","), details: `${changed} asset(s)${input.status ? ` · ${input.status}` : ""}` });
        return { changed, skipped };
      })
    ),

  /** Record known field practice (water regime, pre-season, organic amendment, N rate, seasons/year) or reset to defaults. */
  setPractice: manage
    .input(
      z.object({
        orgId: orgZ,
        assetId: z.string().max(40),
        regime: z.enum(SFW_KEYS as [string, ...string[]]).nullable().optional(),
        preseason: z.enum(SFP_KEYS as [string, ...string[]]).nullable().optional(),
        organic: z.enum(ORGANIC_KEYS as [string, ...string[]]).nullable().optional(),
        organicT: z.number().min(0).max(30).nullable().optional(),
        nKgHa: z.number().min(0).max(400).nullable().optional(),
        seasonsPerYear: z.number().min(1).max(3).nullable().optional(),
        reset: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      guard(() => {
        const ws = wsOf(ctx, input.orgId);
        const a = getStore().assets.find((x) => x.id === input.assetId && x.workspaceId === ws);
        if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found in this workspace" });
        const keys: [keyof typeof input, string][] = [
          ["regime", "mrv_regime"],
          ["preseason", "mrv_preseason"],
          ["organic", "mrv_organic"],
          ["organicT", "mrv_organicT"],
          ["nKgHa", "mrv_nKgHa"],
          ["seasonsPerYear", "mrv_seasons"],
        ];
        for (const [k, m] of keys) {
          if (input.reset) delete a.meta[m];
          else if (input[k] === null) delete a.meta[m];
          else if (input[k] !== undefined) a.meta[m] = input[k] as string | number;
        }
        audit({ userId: ctx.user.id, userName: ctx.user.name, action: "mrv.practice", entity: "asset", entityId: a.id, details: input.reset ? "reset to defaults" : keys.filter(([k]) => input[k] !== undefined).map(([k]) => k).join(", ") });
        return { practice: practiceOf(a) };
      })
    ),

  reference: read.query(() => ({ price: IPCC.creditPrice, conservativenessPct: IPCC.conservativenessPct, awd: IPCC.awd })),
});

const esgRouter = router({
  summary: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => guard(() => esgSummary(wsOf(ctx, input?.orgId)))),

  /** Record an export (CSV/PDF built client-side) for usage metering and the audit trail. */
  recordExport: read.input(z.object({ orgId: orgZ, kind: z.enum(["esg_pdf", "esg_csv", "mrv_pdf", "mrv_csv", "yield_csv", "yield_pdf"]) })).mutation(({ ctx, input }) => {
    const ws = wsOf(ctx, input.orgId);
    trackUsage(ws, "reports");
    audit({ userId: ctx.user.id, userName: ctx.user.name, action: "report.export", entity: "workspace", entityId: ws, details: input.kind });
    return { ok: true };
  }),
});

export const sustainabilityRouter = router({
  ping: read.query(() => ({ ok: true })),
  yield: yieldRouter,
  carbon: carbonRouter,
  esg: esgRouter,
});
