/**
 * insuranceRouter — parametric product design & backtesting, live trigger
 * monitor, claims validation, book/PML view, and Anticipatory Action (`aa.*`).
 * Reads need "use_workspace"; writes need "manage_assets". Every procedure is
 * scoped to ctx.user.orgId (platform_admin may pass `orgId`).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { permitted, router } from "../trpc";
import { getStore } from "../data/store";
import { geocode } from "../live/open-meteo";
import { HISTORY_SOURCES } from "../live/history";
import { trackUsage } from "../services/usage";
import {
  archiveProduct,
  attachProduct,
  backtestProduct,
  bookBacktest,
  DEFAULT_SPEC,
  getProduct,
  INDEX_META,
  INDEMNITY_SEASON,
  listProducts,
  liveMonitor,
  reinsuranceLayer,
  saveProduct,
  seasonLabel,
  validateSpec,
  type IndexType,
} from "../services/parametric";
import { CLAIM_PERILS, listClaims, validateClaim, type ClaimPeril } from "../services/claims";
import {
  AA_METRICS,
  activate,
  archiveProtocol,
  assignTeams,
  backtestProtocol,
  cashPlan,
  getProtocol,
  listActivations,
  listProtocols,
  liveStatus,
  recordDisbursement,
  review,
  saveProtocol,
  scopedCommunities,
  transition,
} from "../services/anticipatory";

const read = permitted("use_workspace");
const write = permitted("manage_assets");

type Ctx = { user: { id: string; name: string; role: string; orgId: string | null } };
function wsOf(ctx: Ctx, orgId?: string | null): string {
  if (orgId && ctx.user.role === "platform_admin") return orgId;
  if (!ctx.user.orgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is not attached to a workspace" });
  return ctx.user.orgId;
}
const who = (ctx: Ctx) => ({ id: ctx.user.id, name: ctx.user.name });
async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e), cause: e });
  }
}

const orgZ = z.string().max(80).optional();
const seasonZ = z.object({ startMonth: z.number().int().min(1).max(12), startDay: z.number().int().min(1).max(31), endMonth: z.number().int().min(1).max(12), endDay: z.number().int().min(1).max(31) });
const specZ = z.object({
  indexType: z.enum(Object.keys(INDEX_META) as [IndexType, ...IndexType[]]),
  windowDays: z.number().int().min(1).max(60),
  dryDayMm: z.number().min(0).max(20),
  heatThresholdC: z.number().min(25).max(50),
  trigger: z.number().min(0).max(1e7),
  exit: z.number().min(0).max(1e7),
  season: seasonZ,
  entryPayoutPct: z.number().min(0).max(100),
  maxPayoutPct: z.number().min(1).max(100),
  calibration: z.object({ mode: z.enum(["absolute", "local"]), triggerRp: z.number().min(1.1).max(200), exitRp: z.number().min(1.1).max(500) }).optional(),
});
const locZ = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), name: z.string().max(120), sumInsuredUsd: z.number().min(0).max(1e10) });
const loadZ = z.object({ expenseLoadPct: z.number().min(0).max(60), riskLoadSigma: z.number().min(0).max(2) });

// ─── Anticipatory Action sub-router ──────────────────────────────────────

const actionZ = z.object({ id: z.string().max(40), name: z.string().min(1).max(160), owner: z.string().max(80), costUsd: z.number().min(0).max(1e8), hoursBeforeImpact: z.number().min(0).max(720) });
const stockZ = z.object({ item: z.string().min(1).max(120), perHousehold: z.number().min(0).max(100), unitCostUsd: z.number().min(0).max(10000) });
const protocolZ = z.object({
  id: z.string().max(60).optional(),
  name: z.string().min(3).max(140),
  hazard: z.enum(["flood", "cyclone", "heavy_rain"]),
  metric: z.enum(["flood_prob_72h", "rain_5d_mm", "discharge_ratio"]),
  readiness: z.number().min(0).max(10000),
  activation: z.number().min(0).max(10000),
  minCommunities: z.number().int().min(1).max(500),
  leadTimeDays: z.number().int().min(1).max(15),
  scopeTags: z.array(z.string().max(60)).max(20),
  actions: z.array(actionZ).max(30),
  budgetUsd: z.number().min(0).max(1e10),
  cashPerHouseholdUsd: z.number().min(0).max(10000),
  coveragePct: z.number().min(1).max(100),
  deliveryFeePct: z.number().min(0).max(20),
  stock: z.array(stockZ).max(20),
  status: z.enum(["active", "draft"]),
});

const aaRouter = router({
  meta: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => {
    const ws = wsOf(ctx, input?.orgId);
    const comms = getStore().assets.filter((a) => a.workspaceId === ws && a.status === "active" && a.type === "community");
    const tags = [...new Set(comms.flatMap((c) => c.tags))].sort();
    return {
      metrics: AA_METRICS,
      tags,
      communities: comms.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon, households: Number(c.meta.households ?? 0), tags: c.tags, ref: c.externalRef })),
      totalHouseholds: comms.reduce((t, c) => t + Number(c.meta.households ?? 0), 0),
    };
  }),
  protocols: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => listProtocols(wsOf(ctx, input?.orgId))),
  status: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => guard(() => liveStatus(wsOf(ctx, input?.orgId)))),
  save: write.input(protocolZ.extend({ orgId: orgZ })).mutation(({ ctx, input }) =>
    guard(() => {
      if (input.activation < input.readiness) throw new Error("Activation threshold must be at or above the Readiness threshold.");
      const { orgId, ...p } = input;
      return saveProtocol(wsOf(ctx, orgId), who(ctx), p);
    })
  ),
  archive: write.input(z.object({ id: z.string().max(60), orgId: orgZ })).mutation(({ ctx, input }) => guard(() => archiveProtocol(wsOf(ctx, input.orgId), input.id, who(ctx)))),
  backtest: read
    .input(z.object({ orgId: orgZ, protocolId: z.string().max(60).optional(), draft: protocolZ.pick({ metric: true, readiness: true, activation: true, minCommunities: true, leadTimeDays: true, scopeTags: true }).optional(), startYear: z.number().int().min(1991).max(2015).default(1995) }))
    .query(({ ctx, input }) =>
      guard(async () => {
        const ws = wsOf(ctx, input.orgId);
        const p = input.draft ? { ...input.draft, workspaceId: ws } : input.protocolId ? getProtocol(ws, input.protocolId) : null;
        if (!p) throw new Error("Choose a protocol to backtest");
        trackUsage(ws, "assessments");
        return backtestProtocol(p, input.startYear);
      })
    ),
  cashPlan: read
    .input(z.object({ orgId: orgZ, communityIds: z.array(z.string().max(40)).max(1000).optional(), scopeTags: z.array(z.string().max(60)).max(20).default([]), coveragePct: z.number().min(0).max(100), cashPerHouseholdUsd: z.number().min(0).max(10000), deliveryFeePct: z.number().min(0).max(20), budgetUsd: z.number().min(0).max(1e10), stock: z.array(stockZ).max(20) }))
    .query(({ ctx, input }) => {
      const ws = wsOf(ctx, input.orgId);
      const comms = scopedCommunities({ workspaceId: ws, scopeTags: input.scopeTags } as never).filter((c) => !input.communityIds?.length || input.communityIds.includes(c.id));
      return { communities: comms.map((c) => ({ id: c.id, name: c.name, households: Number(c.meta.households ?? 0) })), plan: cashPlan({ ...input, households: comms.map((c) => Number(c.meta.households ?? 0)) }) };
    }),
  activations: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => listActivations(wsOf(ctx, input?.orgId))),
  activate: write
    .input(z.object({ orgId: orgZ, protocolId: z.string().max(60), communityIds: z.array(z.string().max(40)).min(1).max(1000), reason: z.string().min(3).max(500), trigger: z.enum(["manual", "forecast"]) }))
    .mutation(({ ctx, input }) => guard(() => activate(wsOf(ctx, input.orgId), who(ctx), input))),
  assignTeams: write
    .input(z.object({ orgId: orgZ, id: z.string().max(60), teams: z.array(z.object({ name: z.string().min(1).max(80), lead: z.string().min(1).max(80), contact: z.string().max(80), communityIds: z.array(z.string().max(40)).max(1000) })).min(1).max(30) }))
    .mutation(({ ctx, input }) => guard(() => assignTeams(wsOf(ctx, input.orgId), who(ctx), input.id, input.teams))),
  disburse: write
    .input(z.object({ orgId: orgZ, id: z.string().max(60), communityId: z.string().max(40), households: z.number().int().min(1).max(100000), amountUsd: z.number().min(0).max(1e9), channel: z.string().min(1).max(60) }))
    .mutation(({ ctx, input }) => guard(() => recordDisbursement(wsOf(ctx, input.orgId), who(ctx), input.id, input))),
  transition: write
    .input(z.object({ orgId: orgZ, id: z.string().max(60), to: z.enum(["completed", "cancelled"]), reason: z.string().min(2).max(500) }))
    .mutation(({ ctx, input }) => guard(() => transition(wsOf(ctx, input.orgId), who(ctx), input.id, input.to, input.reason))),
  review: write
    .input(z.object({ orgId: orgZ, id: z.string().max(60), eventOccurred: z.boolean(), outcome: z.string().min(3).max(1000), lessons: z.string().max(2000) }))
    .mutation(({ ctx, input }) => guard(() => review(wsOf(ctx, input.orgId), who(ctx), input.id, input))),
});

// ─── Insurance router ─────────────────────────────────────────────────────

export const insuranceRouter = router({
  ping: read.query(() => ({ ok: true })),

  meta: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => {
    const ws = wsOf(ctx, input?.orgId);
    const s = getStore();
    const plots = s.assets.filter((a) => a.workspaceId === ws && a.status === "active" && a.type === "insured_plot");
    const districtIds = new Set(plots.map((p) => p.districtId));
    return {
      indexTypes: Object.entries(INDEX_META).map(([value, m]) => ({ value: value as IndexType, ...m })),
      perils: CLAIM_PERILS,
      defaultSpec: DEFAULT_SPEC,
      indemnitySeason: seasonLabel(INDEMNITY_SEASON),
      districts: s.districts
        .filter((d) => districtIds.has(d.id) || d.country === "BD")
        .map((d) => ({ id: d.id, name: d.name, country: d.countryName, lat: d.lat, lon: d.lon, plots: plots.filter((p) => p.districtId === d.id).length }))
        .sort((a, b) => b.plots - a.plots || a.name.localeCompare(b.name)),
      plotCount: plots.length,
      sources: HISTORY_SOURCES,
    };
  }),

  plots: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => {
    const ws = wsOf(ctx, input?.orgId);
    const s = getStore();
    const dist = new Map(s.districts.map((d) => [d.id, d.name]));
    const prods = new Map(listProducts(ws).map((p) => [p.id, p.name]));
    return s.assets
      .filter((a) => a.workspaceId === ws && a.status === "active" && a.type === "insured_plot")
      .map((a) => ({
        id: a.id,
        name: a.name,
        ref: a.externalRef,
        lat: a.lat,
        lon: a.lon,
        district: (a.districtId && dist.get(a.districtId)) || "—",
        districtId: a.districtId,
        country: a.country,
        crop: a.crop,
        areaHa: a.areaHa,
        sumInsuredUsd: a.valueUsd,
        premiumUsd: Number(a.meta.premiumUsd ?? 0),
        product: String(a.meta.product ?? ""),
        productId: (a.meta.parametricProductId as string | null) ?? null,
        productName: a.meta.parametricProductId ? (prods.get(String(a.meta.parametricProductId)) ?? null) : null,
        tags: a.tags,
      }));
  }),

  geocode: read.input(z.object({ q: z.string().min(2).max(120) })).query(({ input }) => guard(() => geocode(input.q))),

  products: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => listProducts(wsOf(ctx, input?.orgId)).map((p) => ({ ...p, meta: INDEX_META[p.spec.indexType], seasonLabel: seasonLabel(p.spec.season) }))),

  backtest: read
    .input(z.object({ orgId: orgZ, spec: specZ, locations: z.array(locZ).min(1).max(40), load: loadZ, startYear: z.number().int().min(1991).max(2015).default(1995), proxyReturnPeriod: z.number().min(2).max(20).default(5), lossYears: z.array(z.number().int().min(1991).max(2100)).max(60).optional() }))
    .query(({ ctx, input }) =>
      guard(async () => {
        const ws = wsOf(ctx, input.orgId);
        const errs = validateSpec(input.spec);
        if (errs.length) throw new Error(errs[0]);
        trackUsage(ws, "assessments", input.locations.length);
        const r = await backtestProduct(input.spec, input.locations, { startYear: input.startYear, ...input.load, proxyReturnPeriod: input.proxyReturnPeriod, lossYears: input.lossYears });
        if (!r.results.length) throw new Error("The ERA5/GloFAS archive did not respond for this location — try again in a moment.");
        return r;
      })
    ),

  saveProduct: write
    .input(
      z.object({
        orgId: orgZ,
        id: z.string().max(60).optional(),
        name: z.string().min(3).max(120),
        description: z.string().max(600),
        spec: specZ,
        status: z.enum(["draft", "active"]),
        pricing: loadZ,
        reference: z.object({ lat: z.number(), lon: z.number(), name: z.string().max(120) }),
        lastBacktest: z.object({ years: z.number(), frequencyPct: z.number(), burningCostPct: z.number(), premiumRatePct: z.number() }).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      guard(() => {
        const errs = validateSpec(input.spec);
        if (errs.length) throw new Error(errs[0]);
        const { orgId, lastBacktest, ...rest } = input;
        return saveProduct(wsOf(ctx, orgId), who(ctx), { ...rest, lastBacktest: lastBacktest ? { ...lastBacktest, at: new Date() } : undefined });
      })
    ),

  archiveProduct: write.input(z.object({ orgId: orgZ, id: z.string().max(60) })).mutation(({ ctx, input }) => guard(() => archiveProduct(wsOf(ctx, input.orgId), input.id, who(ctx)))),

  attach: write
    .input(z.object({ orgId: orgZ, productId: z.string().max(60).nullable(), assetIds: z.array(z.string().max(40)).min(1).max(5000) }))
    .mutation(({ ctx, input }) => guard(() => ({ updated: attachProduct(wsOf(ctx, input.orgId), input.productId, input.assetIds, who(ctx)) }))),

  monitor: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => guard(() => liveMonitor(wsOf(ctx, input?.orgId)))),

  book: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) =>
    guard(async () => {
      const b = await bookBacktest(wsOf(ctx, input?.orgId));
      return b;
    })
  ),

  layer: read
    .input(z.object({ orgId: orgZ, attachmentUsd: z.number().min(0).max(1e11), limitUsd: z.number().min(0).max(1e11), loadingMultiple: z.number().min(1).max(5).default(1.8) }))
    .query(({ ctx, input }) =>
      guard(async () => {
        const b = await bookBacktest(wsOf(ctx, input.orgId));
        return reinsuranceLayer(b.fit, input.attachmentUsd, input.limitUsd, input.loadingMultiple);
      })
    ),

  claims: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => listClaims(wsOf(ctx, input?.orgId))),

  validateClaim: write
    .input(
      z.object({
        orgId: orgZ,
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        assetId: z.string().max(40).nullish(),
        lossDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        peril: z.enum(CLAIM_PERILS.map((p) => p.value) as [ClaimPeril, ...ClaimPeril[]]),
        claimedUsd: z.number().min(0).max(1e9).nullish(),
        notes: z.string().max(1000).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      guard(async () => {
        const ws = wsOf(ctx, input.orgId);
        trackUsage(ws, "assessments");
        return validateClaim(ws, who(ctx), input);
      })
    ),

  product: read.input(z.object({ orgId: orgZ, id: z.string().max(60) })).query(({ ctx, input }) => {
    const p = getProduct(wsOf(ctx, input.orgId), input.id);
    if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
    return { ...p, meta: INDEX_META[p.spec.indexType], seasonLabel: seasonLabel(p.spec.season) };
  }),

  aa: aaRouter,
});
