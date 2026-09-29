/**
 * incidentsRouter — incident command + team collaboration + activity feed.
 *
 *   incidents.*           incident lifecycle, tasks, roles, stakeholder updates, review
 *   incidents.collab.*    comments with @mentions (any entity), presence, typing
 *   incidents.activity.*  unified workspace activity stream
 *   incidents.status.*    PUBLIC stakeholder status page (/s/<slug>) + subscribe
 *
 * Everything workspace-scoped uses ctx.user.orgId (platform_admin may pass orgId).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { can } from "@/lib/rbac";
import { permitted, publicProcedure, router } from "../trpc";
import { getStore } from "../data/store";
import * as inc from "../services/incidents";
import * as collab from "../services/collab";
import { rescoreWorkspace, workspaceAssets, effectiveScore } from "../services/portfolio";

const proc = permitted("use_workspace");

type Ctx = { user: { id: string; orgId?: string | null; role: string; name?: string | null } };

function wsOf(ctx: Ctx, orgId?: string | null): string {
  if (orgId && ctx.user.role === "platform_admin") return orgId;
  if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "No workspace" });
  return ctx.user.orgId;
}

function actor(ctx: Ctx) {
  const u = getStore().users.find((x) => x.id === ctx.user.id);
  return { id: ctx.user.id, name: u?.name ?? ctx.user.name ?? "Member" };
}

/** Map service errors onto tRPC codes. */
function run<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw toTrpc(e);
  }
}
async function runAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toTrpc(e);
  }
}
function toTrpc(e: unknown) {
  if (e instanceof inc.IncidentError || e instanceof collab.CollabError) return new TRPCError({ code: e.code === "CONFLICT" ? "CONFLICT" : e.code, message: e.message });
  return e;
}

const zSeverity = z.enum(inc.SEVERITIES);
const zStatus = z.enum(inc.STATUSES);
const zHazard = z.enum(inc.HAZARDS);
const zRole = z.enum(inc.ROLES);
const zLat = z.number().min(-90).max(90);
const zLon = z.number().min(-180).max(180);
const zArea = z.union([
  z.object({ type: z.literal("circle"), lat: zLat, lon: zLon, radiusKm: z.number().min(0.2).max(1000) }),
  z.object({ type: z.literal("polygon"), coords: z.array(z.tuple([zLat, zLon])).min(3).max(200) }),
]);
const zId = z.string().min(1).max(80);
const zPhase = z.enum(["Mobilise", "Respond", "Recover", "Comms"]);
const zEntity = z.enum(collab.COMMENT_ENTITY_TYPES);

function assertCommentEntity(ws: string, type: collab.CommentEntityType, id: string): { label: string; href: string } {
  if (type === "incident") {
    const i = run(() => inc.getIncident(ws, id));
    return { label: `INC-${i.number} ${i.title}`, href: `/app/incidents/${i.id}#discussion` };
  }
  run(() => collab.assertEntity(ws, type, id));
  return { label: collab.entityLabel(ws, type, id), href: collab.entityHref(type, id) };
}

// ─── Collaboration (reusable by any module) ───────────────────────────────

const collabRouter = router({
  members: proc.input(z.object({ orgId: z.string().optional() }).optional()).query(({ ctx, input }) => collab.workspaceMembers(wsOf(ctx, input?.orgId))),

  comments: proc.input(z.object({ entityType: zEntity, entityId: zId })).query(({ ctx, input }) => {
    const ws = wsOf(ctx);
    assertCommentEntity(ws, input.entityType, input.entityId);
    return collab.listComments(ws, input.entityType, input.entityId);
  }),

  commentCounts: proc.input(z.object({ entityType: zEntity, entityIds: z.array(zId).max(500) })).query(({ ctx, input }) => collab.commentCounts(wsOf(ctx), input.entityType, input.entityIds)),

  addComment: proc.input(z.object({ entityType: zEntity, entityId: zId, body: z.string().min(1).max(4000) })).mutation(({ ctx, input }) => {
    const ws = wsOf(ctx);
    const target = assertCommentEntity(ws, input.entityType, input.entityId);
    return run(() => collab.addComment(ws, actor(ctx), { entityType: input.entityType, entityId: input.entityId, body: input.body, label: target.label, href: target.href }));
  }),

  editComment: proc.input(z.object({ id: zId, body: z.string().min(1).max(4000) })).mutation(({ ctx, input }) => run(() => collab.editComment(wsOf(ctx), input.id, { ...actor(ctx), role: ctx.user.role }, input.body))),

  deleteComment: proc.input(z.object({ id: zId })).mutation(({ ctx, input }) => run(() => collab.deleteComment(wsOf(ctx), input.id, { id: ctx.user.id, role: ctx.user.role }))),

  heartbeat: proc.input(z.object({ room: z.string().min(1).max(120).regex(/^[\w:.-]+$/) })).mutation(({ ctx, input }) => collab.heartbeat(wsOf(ctx), input.room, actor(ctx))),

  leave: proc.input(z.object({ room: z.string().min(1).max(120).regex(/^[\w:.-]+$/) })).mutation(({ ctx, input }) => {
    collab.leave(wsOf(ctx), input.room, ctx.user.id);
    return { ok: true };
  }),

  presence: proc.input(z.object({ room: z.string().min(1).max(120) })).query(({ ctx, input }) => ({ channel: collab.presenceChannel(wsOf(ctx), input.room), users: collab.presenceIn(wsOf(ctx), input.room) })),

  typing: proc.input(z.object({ room: z.string().min(1).max(120).regex(/^[\w:.-]+$/), typing: z.boolean() })).mutation(({ ctx, input }) => {
    collab.typing(wsOf(ctx), input.room, actor(ctx), input.typing);
    return { ok: true };
  }),
});

// ─── Activity ─────────────────────────────────────────────────────────────

const activityRouter = router({
  feed: proc
    .input(
      z.object({
        categories: z.array(z.enum(collab.ACTIVITY_CATEGORIES)).optional(),
        actorId: z.string().max(80).nullish(),
        q: z.string().max(120).nullish(),
        before: z.coerce.date().nullish(),
        sinceDays: z.number().int().min(1).max(365).nullish(),
        limit: z.number().int().min(5).max(100).default(40),
        orgId: z.string().optional(),
      })
    )
    .query(({ ctx, input }) => collab.activityFeed(wsOf(ctx, input.orgId), input)),
});

// ─── Public status page ───────────────────────────────────────────────────

const statusRouter = router({
  get: publicProcedure.input(z.object({ slug: z.string().min(3).max(80) })).query(({ input }) => {
    const s = inc.publicStatus(input.slug);
    if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "This status page does not exist or is no longer public." });
    return s;
  }),
  subscribe: publicProcedure
    .input(z.object({ slug: z.string().min(3).max(80), kind: z.enum(["email", "sms"]), address: z.string().min(5).max(120) }))
    .mutation(({ input }) => run(() => inc.subscribe(input.slug, input.kind, input.address))),
});

// ─── Incidents ────────────────────────────────────────────────────────────

export const incidentsRouter = router({
  ping: proc.query(() => ({ ok: true })),
  collab: collabRouter,
  activity: activityRouter,
  status: statusRouter,

  meta: proc.query(() => ({
    severities: inc.SEVERITIES.map((s) => ({ id: s, ...inc.SEVERITY_META[s], sla: inc.SLA_TARGETS[s] })),
    statuses: inc.STATUSES.map((s) => ({ id: s, ...inc.STATUS_META[s] })),
    hazards: inc.HAZARDS.map((h) => ({ id: h, ...inc.HAZARD_META[h], template: inc.TASK_TEMPLATES[h].name, tasks: inc.TASK_TEMPLATES[h].tasks.length })),
    roles: inc.ROLES.map((r) => ({ id: r, ...inc.ROLE_META[r] })),
  })),

  list: proc
    .input(
      z
        .object({
          status: z.array(zStatus).optional(),
          severity: z.array(zSeverity).optional(),
          hazard: z.array(zHazard).optional(),
          q: z.string().max(120).optional(),
          mine: z.boolean().optional(),
          includeResolved: z.boolean().optional(),
        })
        .optional()
    )
    .query(({ ctx, input }) => inc.listIncidents(wsOf(ctx), { ...input, mine: input?.mine ? ctx.user.id : null })),

  get: proc.input(z.object({ id: zId })).query(({ ctx, input }) => run(() => inc.incidentDetail(wsOf(ctx), input.id))),

  settings: proc.query(({ ctx }) => ({ ...inc.settingsFor(wsOf(ctx)), canEdit: can(ctx.user.role as never, "manage_workspace") })),

  updateSettings: permitted("manage_workspace")
    .input(z.object({ autoOpenCritical: z.boolean().optional(), defaultSeverity: zSeverity.optional(), autoTemplate: z.boolean().optional() }))
    .mutation(({ ctx, input }) => inc.updateSettings(wsOf(ctx), input)),

  candidates: proc.query(({ ctx }) => inc.sourceCandidates(wsOf(ctx))),

  draftFromAlert: proc.input(z.object({ alertId: zId })).query(({ ctx, input }) => run(() => inc.draftFromAlert(wsOf(ctx), input.alertId))),

  /** What an area would contain: asset count, exposure, worst score, suggested severity. */
  previewArea: proc.input(z.object({ area: zArea })).query(({ ctx, input }) => {
    const ws = wsOf(ctx);
    const inArea = inc.assetsInArea(ws, input.area);
    const all = workspaceAssets(ws);
    const total = all.reduce((s, a) => s + a.valueUsd, 0);
    const value = inArea.reduce((s, a) => s + a.valueUsd, 0);
    const worst = inArea.reduce((m, a) => Math.max(m, effectiveScore(a).composite), 0);
    return { count: inArea.length, assetIds: inArea.map((a) => a.id), valueUsd: value, shareOfBook: total ? value / total : 0, worstScore: worst, suggested: inc.suggestSeverity(value, total, worst) };
  }),

  /** Lightweight asset list for pickers (id, name, score, coords). */
  assetOptions: proc.input(z.object({ q: z.string().max(80).optional() }).optional()).query(({ ctx, input }) => {
    const q = input?.q?.toLowerCase().trim();
    return workspaceAssets(wsOf(ctx))
      .filter((a) => !q || `${a.name} ${a.externalRef ?? ""} ${a.tags.join(" ")}`.toLowerCase().includes(q))
      .map((a) => {
        const e = effectiveScore(a);
        return { id: a.id, name: a.name, ref: a.externalRef, lat: a.lat, lon: a.lon, composite: e.composite, level: e.level, valueUsd: a.valueUsd, districtId: a.districtId };
      })
      .sort((a, b) => b.composite - a.composite)
      .slice(0, 400);
  }),

  create: proc
    .input(
      z.object({
        title: z.string().min(3).max(160),
        summary: z.string().max(4000).optional(),
        severity: zSeverity.optional(),
        hazard: zHazard,
        assetIds: z.array(zId).max(2000).optional(),
        area: zArea.nullish(),
        includeAreaAssets: z.boolean().optional(),
        roles: z.object({ commander: z.string().nullish(), fieldLead: z.string().nullish(), comms: z.string().nullish() }).partial().optional(),
        applyTemplate: z.boolean().optional(),
        source: z
          .object({ kind: z.enum(["manual", "rule_firing", "official_alert", "scenario"]), refId: z.string().max(120).nullish(), label: z.string().max(200).nullish() })
          .optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const ws = wsOf(ctx);
      const me = actor(ctx);
      // Rule firing → reuse the de-duplicating path (links + timeline)
      if (input.source?.kind === "rule_firing" && input.source.refId) {
        const f = run(() => inc.openIncidentFromFiring(input.source!.refId!, { user: me, overrides: { ...input, source: undefined } }));
        return { id: f.incident.id, number: f.incident.number, created: f.created };
      }
      const links: Omit<inc.IncidentLink, "at">[] = [];
      if (input.source?.kind === "official_alert" && input.source.refId) {
        const al = getStore().alerts.find((a) => a.id === input.source!.refId);
        if (al) links.push({ kind: "alert", id: al.id, label: al.title, href: null });
      }
      if (input.source?.kind === "scenario" && input.source.refId) links.push({ kind: "scenario", id: input.source.refId, label: input.source.label ?? "Simulation Lab scenario", href: `/app/simulate?scenario=${encodeURIComponent(input.source.refId)}` });
      const i = run(() => inc.createIncident(ws, me, { ...input, source: input.source ? { kind: input.source.kind, refId: input.source.refId ?? null, label: input.source.label ?? null } : undefined, links }));
      return { id: i.id, number: i.number, created: true };
    }),

  openFromFiring: proc.input(z.object({ firingId: zId })).mutation(({ ctx, input }) => {
    const ws = wsOf(ctx);
    const f = run(() => inc.openIncidentFromFiring(input.firingId, { user: actor(ctx) }));
    if (f.incident.workspaceId !== ws) throw new TRPCError({ code: "NOT_FOUND", message: "Rule firing not found" });
    return { id: f.incident.id, number: f.incident.number, created: f.created };
  }),

  setStatus: proc.input(z.object({ id: zId, to: zStatus, note: z.string().max(500).optional() })).mutation(({ ctx, input }) => {
    const r = run(() => inc.changeStatus(wsOf(ctx), input.id, input.to, actor(ctx), input.note));
    return { status: r.incident.status, warnings: r.warnings };
  }),

  acknowledge: proc.input(z.object({ id: zId })).mutation(({ ctx, input }) => ({ acknowledgedAt: run(() => inc.acknowledgeIncident(wsOf(ctx), input.id, actor(ctx))).acknowledgedAt })),

  setSeverity: proc.input(z.object({ id: zId, severity: zSeverity, reason: z.string().max(300).optional() })).mutation(({ ctx, input }) => ({ severity: run(() => inc.changeSeverity(wsOf(ctx), input.id, input.severity, actor(ctx), input.reason)).severity })),

  assignRole: proc.input(z.object({ id: zId, role: zRole, userId: z.string().max(80).nullable() })).mutation(({ ctx, input }) => ({ roles: run(() => inc.assignRole(wsOf(ctx), input.id, input.role, input.userId, actor(ctx))).roles })),

  edit: proc.input(z.object({ id: zId, title: z.string().min(3).max(160).optional(), summary: z.string().max(4000).optional(), hazard: zHazard.optional() })).mutation(({ ctx, input }) => {
    run(() => inc.editIncident(wsOf(ctx), input.id, input, actor(ctx)));
    return { ok: true };
  }),

  addNote: proc.input(z.object({ id: zId, text: z.string().min(1).max(2000) })).mutation(({ ctx, input }) => run(() => inc.addNote(wsOf(ctx), input.id, input.text, actor(ctx)))),

  setAssets: proc.input(z.object({ id: zId, assetIds: z.array(zId).max(2000) })).mutation(({ ctx, input }) => ({ count: run(() => inc.setAssets(wsOf(ctx), input.id, input.assetIds, actor(ctx))).assetIds.length })),

  setArea: proc.input(z.object({ id: zId, area: zArea.nullable(), includeAssets: z.boolean().default(true) })).mutation(({ ctx, input }) => ({ count: run(() => inc.setArea(wsOf(ctx), input.id, input.area, input.includeAssets, actor(ctx))).assetIds.length })),

  refreshScores: proc.input(z.object({ id: zId })).mutation(({ ctx, input }) =>
    runAsync(async () => {
      const ws = wsOf(ctx);
      const i = inc.getIncident(ws, input.id);
      if (!i.assetIds.length) return { count: 0, live: 0, fallback: 0 };
      const r = await rescoreWorkspace(ws, { assetIds: i.assetIds, trigger: "incident", by: ctx.user.id });
      return { count: r.count, live: r.live, fallback: r.fallback };
    })
  ),

  addTask: proc
    .input(z.object({ id: zId, title: z.string().min(2).max(200), detail: z.string().max(1000).nullish(), phase: zPhase.optional(), assigneeId: z.string().max(80).nullish(), dueAt: z.coerce.date().nullish() }))
    .mutation(({ ctx, input }) => run(() => inc.addTask(wsOf(ctx), input.id, input, actor(ctx)))),

  updateTask: proc
    .input(z.object({ id: zId, taskId: zId, title: z.string().max(200).optional(), done: z.boolean().optional(), assigneeId: z.string().max(80).nullish(), dueAt: z.coerce.date().nullish(), phase: zPhase.optional() }))
    .mutation(({ ctx, input }) => {
      const { id, taskId, ...patch } = input;
      const p: Parameters<typeof inc.updateTask>[3] = { title: patch.title, done: patch.done, phase: patch.phase };
      if (patch.assigneeId !== undefined) p.assigneeId = patch.assigneeId;
      if (patch.dueAt !== undefined) p.dueAt = patch.dueAt;
      return run(() => inc.updateTask(wsOf(ctx), id, taskId, p, actor(ctx)));
    }),

  deleteTask: proc.input(z.object({ id: zId, taskId: zId })).mutation(({ ctx, input }) => run(() => inc.deleteTask(wsOf(ctx), input.id, input.taskId, actor(ctx)))),

  applyTemplate: proc.input(z.object({ id: zId, hazard: zHazard })).mutation(({ ctx, input }) => ({ added: run(() => inc.applyTemplate(wsOf(ctx), input.id, input.hazard, actor(ctx))) })),

  link: proc
    .input(z.object({ id: zId, link: z.object({ kind: z.enum(["firing", "alert", "scenario", "report", "asset"]), id: zId, label: z.string().min(1).max(200), href: z.string().max(300).nullable() }) }))
    .mutation(({ ctx, input }) => {
      if (input.link.href && !input.link.href.startsWith("/")) throw new TRPCError({ code: "BAD_REQUEST", message: "Links must be in-app paths" });
      run(() => inc.linkItem(wsOf(ctx), input.id, input.link, actor(ctx)));
      return { ok: true };
    }),

  unlink: proc.input(z.object({ id: zId, kind: z.enum(["firing", "alert", "scenario", "report", "asset"]), linkId: zId })).mutation(({ ctx, input }) => {
    run(() => inc.unlinkItem(wsOf(ctx), input.id, input.kind, input.linkId, actor(ctx)));
    return { ok: true };
  }),

  suggestUpdate: proc.input(z.object({ id: zId })).query(({ ctx, input }) => run(() => inc.suggestUpdate(wsOf(ctx), input.id))),

  saveUpdate: proc
    .input(z.object({ id: zId, updateId: z.string().max(80).nullish(), title: z.string().max(160), body: z.string().min(1).max(5000), channels: z.array(z.enum(["page", "email", "sms"])).max(3) }))
    .mutation(({ ctx, input }) => run(() => inc.saveUpdate(wsOf(ctx), input.id, input, actor(ctx)))),

  publishUpdate: proc.input(z.object({ id: zId, updateId: zId })).mutation(({ ctx, input }) => runAsync(() => inc.publishUpdate(wsOf(ctx), input.id, input.updateId, actor(ctx)))),

  deleteDraft: proc.input(z.object({ id: zId, updateId: zId })).mutation(({ ctx, input }) => run(() => inc.deleteDraft(wsOf(ctx), input.id, input.updateId))),

  setPublic: proc.input(z.object({ id: zId, enabled: z.boolean() })).mutation(({ ctx, input }) => ({ publicEnabled: run(() => inc.setPublic(wsOf(ctx), input.id, input.enabled, actor(ctx))).publicEnabled })),

  addSubscriber: proc
    .input(z.object({ id: zId, kind: z.enum(["email", "sms"]), address: z.string().min(5).max(120) }))
    .mutation(({ ctx, input }) => run(() => inc.addSubscriber(inc.getIncident(wsOf(ctx), input.id), input.kind, input.address))),

  draftReview: proc.input(z.object({ id: zId })).query(({ ctx, input }) => run(() => inc.draftReview(inc.getIncident(wsOf(ctx), input.id)))),

  saveReview: proc
    .input(
      z.object({
        id: zId,
        whatHappened: z.string().max(8000).optional(),
        impact: z.string().max(4000).optional(),
        whatWorked: z.string().max(8000).optional(),
        whatToImprove: z.string().max(8000).optional(),
        actions: z.array(z.object({ id: z.string().max(40), text: z.string().min(1).max(400), ownerId: z.string().max(80).nullable(), dueAt: z.coerce.date().nullable(), done: z.boolean() })).max(30).optional(),
        complete: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input;
      return run(() => inc.saveReview(wsOf(ctx), id, patch, actor(ctx)));
    }),
});
