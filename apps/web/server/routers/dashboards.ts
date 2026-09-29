/**
 * dashboardsRouter — custom dashboards (builder, templates, widget data,
 * tokenised read-only sharing). Reads & building need "use_workspace";
 * deleting and external sharing need "manage_assets". Always scoped to
 * ctx.user.orgId (platform_admin may pass `orgId`). `shared` / `sharedWidget`
 * are public (share token = capability) and read-only.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { permitted, publicProcedure, router } from "../trpc";
import { WIDGET_KINDS, type Widget, type WidgetKind } from "@/components/dashboards/catalog";
import {
  DashboardError,
  TEMPLATES,
  createDashboard,
  defaultTemplateFor,
  deleteDashboard,
  getByShareToken,
  getDashboard,
  listDashboards,
  orgDisplayName,
  setDefaultDashboard,
  setSharing,
  updateDashboard,
  type DashboardRecord,
} from "../services/dashboards";
import { resolveWidget, widgetFacets } from "../services/widget-data";

const read = permitted("use_workspace");
const manage = permitted("manage_assets");

type Ctx = { user: { id: string; name: string; role: string; orgId: string | null } };
function wsOf(ctx: Ctx, orgId?: string | null): string {
  if (orgId && ctx.user.role === "platform_admin") return orgId;
  if (!ctx.user.orgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is not attached to a workspace" });
  return ctx.user.orgId;
}
const who = (ctx: Ctx) => ({ id: ctx.user.id, name: ctx.user.name });
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof DashboardError) throw new TRPCError({ code: e.code, message: e.message });
    throw e;
  }
}

const orgZ = z.string().max(80).optional();
const strList = (max: number) => z.array(z.string().max(80)).max(max).optional();
const configZ = z
  .object({
    metric: z.string().max(40).optional(),
    series: z.string().max(40).optional(),
    dimension: z.string().max(40).optional(),
    measure: z.string().max(40).optional(),
    mapMode: z.enum(["points", "choropleth"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    days: z.number().int().min(1).max(365).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
    filters: z.object({ tags: strList(20), types: strList(12), countries: strList(20) }).optional(),
    thresholds: z.object({ warn: z.number().nullable(), crit: z.number().nullable() }).optional(),
    place: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), name: z.string().max(120) }).nullable().optional(),
    assetId: z.string().max(60).nullable().optional(),
    text: z.string().max(4000).optional(),
    reportId: z.string().max(80).nullable().optional(),
    url: z.string().max(500).nullable().optional(),
  })
  .strip();
const widgetZ = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(WIDGET_KINDS as [WidgetKind, ...WidgetKind[]]),
  title: z.string().max(120),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(500),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(24),
  minW: z.number().int().optional(),
  minH: z.number().int().optional(),
  config: configZ,
});

const full = (d: DashboardRecord) => ({
  id: d.id,
  name: d.name,
  description: d.description,
  widgets: d.widgets,
  isDefault: d.isDefault,
  refreshSec: d.refreshSec,
  shareToken: d.shareToken,
  sharedAt: d.sharedAt,
  shareViews: d.shareViews,
  templateId: d.templateId,
  createdByName: d.createdByName,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  updatedByName: d.updatedByName,
});

export const dashboardsRouter = router({
  ping: read.query(() => ({ ok: true })),

  templates: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => {
    const ws = wsOf(ctx, input?.orgId);
    const recommended = defaultTemplateFor(ws).id;
    return TEMPLATES.map((t) => ({ id: t.id, name: t.name, industry: t.industry, audience: t.audience, description: t.description, recommended: t.id === recommended, layout: t.widgets.map((w) => ({ kind: w.kind, x: w.x, y: w.y, w: w.w, h: w.h, title: w.title })) }));
  }),

  list: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => listDashboards(wsOf(ctx, input?.orgId))),

  get: read.input(z.object({ id: z.string().max(80), orgId: orgZ })).query(({ ctx, input }) => guard(() => full(getDashboard(wsOf(ctx, input.orgId), input.id)))),

  create: read
    .input(z.object({ name: z.string().min(1).max(80), description: z.string().max(400).optional(), templateId: z.string().max(40).nullish(), fromId: z.string().max(80).nullish(), orgId: orgZ }))
    .mutation(({ ctx, input }) => guard(() => full(createDashboard(wsOf(ctx, input.orgId), who(ctx), input)))),

  update: read
    .input(z.object({ id: z.string().max(80), name: z.string().max(80).optional(), description: z.string().max(400).optional(), widgets: z.array(widgetZ).max(40).optional(), refreshSec: z.number().int().min(0).max(3600).optional(), orgId: orgZ }))
    .mutation(({ ctx, input }) => guard(() => full(updateDashboard(wsOf(ctx, input.orgId), input.id, who(ctx), { ...input, widgets: input.widgets as Widget[] | undefined })))),

  delete: manage.input(z.object({ id: z.string().max(80), orgId: orgZ })).mutation(({ ctx, input }) => guard(() => deleteDashboard(wsOf(ctx, input.orgId), input.id, who(ctx)))),

  setDefault: read.input(z.object({ id: z.string().max(80), orgId: orgZ })).mutation(({ ctx, input }) => guard(() => full(setDefaultDashboard(wsOf(ctx, input.orgId), input.id)))),

  share: manage
    .input(z.object({ id: z.string().max(80), enabled: z.boolean(), rotate: z.boolean().optional(), orgId: orgZ }))
    .mutation(({ ctx, input }) => guard(() => full(setSharing(wsOf(ctx, input.orgId), input.id, who(ctx), input.enabled, input.rotate)))),

  facets: read.input(z.object({ orgId: orgZ }).optional()).query(({ ctx, input }) => widgetFacets(wsOf(ctx, input?.orgId))),

  /** Resolve one widget's data (the builder sends the live, possibly unsaved, config). */
  widget: read.input(z.object({ widget: widgetZ, orgId: orgZ })).query(({ ctx, input }) => resolveWidget(wsOf(ctx, input.orgId), input.widget as Widget, { userId: ctx.user.id })),

  // ─── Public, read-only (share token is the capability) ──────────────────

  shared: publicProcedure.input(z.object({ token: z.string().max(80), countView: z.boolean().optional() })).query(({ input }) => {
    const d = getByShareToken(input.token, !!input.countView);
    if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "This dashboard link is invalid or sharing was turned off." });
    return { name: d.name, description: d.description, widgets: d.widgets, refreshSec: d.refreshSec, orgName: orgDisplayName(d.orgId), updatedAt: d.updatedAt, sharedAt: d.sharedAt };
  }),

  sharedWidget: publicProcedure.input(z.object({ token: z.string().max(80), widgetId: z.string().max(40) })).query(async ({ input }) => {
    const d = getByShareToken(input.token);
    if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "This dashboard link is invalid or sharing was turned off." });
    const w = d.widgets.find((x) => x.id === input.widgetId);
    if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Widget not found" });
    return resolveWidget(d.orgId, w, { shared: true });
  }),
});
