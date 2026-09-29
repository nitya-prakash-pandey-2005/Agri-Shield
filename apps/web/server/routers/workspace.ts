/**
 * workspaceRouter — the SaaS platform layer: Home, onboarding & tour,
 * notifications, settings, team & invites, plan & usage, API keys &
 * webhooks, security, audit log, reports hub, plus the public status page,
 * invite redemption and support tickets.
 *
 * Everything is scoped to ctx.user.orgId (platform_admin may pass orgId).
 */
import { z } from "zod";
import { notifyWorkspace } from "../services/workspace-notifications";
import { TRPCError } from "@trpc/server";
import type { SubscriptionPlan, UserRole } from "@agri-shield/types";
import { permitted, publicProcedure, router } from "../trpc";
import { audit, getStore, nextId, type OrgRecord, type UserRecord } from "../data/store";
import { sendEmail } from "../notify/channels";
import { ROLE_LABELS } from "@/lib/rbac";
import { createApiKey, assertSafeWebhookUrl, deliverWebhook, newWebhookSecret } from "../services/supply-chain";
import { scState } from "../data/sc-state";
import { checkLimit, enforceLimit, PLAN_LABEL, PLAN_LIMITS, PLAN_PRICE_USD, planOf, trackUsage, usageDaily, usageSummary } from "../services/usage";
import {
  checkRedeemable,
  dueSchedules,
  findInvite,
  inviteStatus,
  isAdminRole,
  makeInvite,
  nextRunAt,
  onboardingFor,
  profileFor,
  rolesForOrg,
  wsId,
  wsState,
  type ReportRecord,
  type ReportSchedule,
  type ReportType,
} from "../services/workspace-state";
import { buildBriefing, computeMetrics, fmtUsd, greeting, hazardsNear, industryOf, INDUSTRY_LABEL, kpiTiles, portfolioScores, QUICK_ACTIONS } from "../services/workspace-home";
import { buildReport, estimatePages, REPORT_CATALOGUE } from "../services/workspace-reports";
import { statusReport } from "../services/status-history";
import { API_SCOPES } from "../data/sc-reference";

const proc = permitted("use_workspace");
const admin = permitted("manage_workspace");

type Ctx = { user: { id: string; name: string; role: UserRole; orgId: string | null } };

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function orgIdOf(ctx: Ctx, override?: string | null): string {
  if (override && ctx.user.role === "platform_admin") return override;
  if (!ctx.user.orgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is not linked to a workspace." });
  return ctx.user.orgId;
}

function orgOf(ctx: Ctx, override?: string | null): OrgRecord {
  const id = orgIdOf(ctx, override);
  const org = getStore().orgs.find((o) => o.id === id);
  if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  return org;
}

const actor = (ctx: Ctx) => ({ id: ctx.user.id, name: getStore().users.find((u) => u.id === ctx.user.id)?.name ?? ctx.user.name ?? "user" });

function members(orgId: string): UserRecord[] {
  return getStore().users.filter((u) => u.orgId === orgId);
}

function subscriptionOf(orgId: string) {
  return getStore().subscriptions.find((s) => s.orgId === orgId) ?? null;
}

function trialInfo(org: OrgRecord) {
  const sub = subscriptionOf(org.id);
  const ends = org.trialEndsAt ? new Date(org.trialEndsAt) : sub?.status === "trialing" ? sub.currentPeriodEnd : null;
  const trialing = sub?.status === "trialing" || (!!ends && ends.getTime() > Date.now() && !sub);
  const daysLeft = ends ? Math.ceil((ends.getTime() - Date.now()) / 86_400_000) : null;
  return { trialing: trialing && (daysLeft ?? 0) > 0, expired: trialing && daysLeft !== null && daysLeft <= 0, endsAt: ends, daysLeft };
}

function notify(orgId: string, n: { kind: "system" | "report" | "billing" | "team"; title: string; body: string; href: string | null; severity: "info" | "success" | "warning" | "critical"; userId?: string | null }) {
  // Goes through the shared notifier so the bell updates in realtime
  notifyWorkspace({ workspaceId: orgId, userId: n.userId ?? null, kind: n.kind, title: n.title, body: n.body, href: n.href, severity: n.severity });
}

// ─── Webhooks (workspace events) ─────────────────────────────────────────

export const WS_WEBHOOK_EVENTS = [
  { id: "report.ready", label: "A report finished generating" },
  { id: "rule.triggered", label: "An alert rule fired" },
  { id: "asset.risk.threshold", label: "An asset crossed the risk threshold" },
  { id: "alert.official", label: "Official hazard alert in a district with assets" },
] as const;
const wsEventIds = WS_WEBHOOK_EVENTS.map((e) => e.id) as [string, ...string[]];

async function fireWorkspaceEvent(orgId: string, event: string, data: Record<string, unknown>) {
  const hooks = getStore().webhooks.filter((w) => w.orgId === orgId && w.active && w.events.includes(event));
  await Promise.allSettled(hooks.map((w) => deliverWebhook(w, event, data, "evaluation")));
}

// ─── Report scheduler ────────────────────────────────────────────────────

async function generateAndStore(org: OrgRecord, by: { id: string; name: string }, type: ReportType, params: Record<string, unknown>, trigger: "manual" | "schedule", scheduleId: string | null): Promise<ReportRecord> {
  const snapshot = await buildReport(type, org, by, params as never);
  const rec: ReportRecord = {
    id: wsId("rpt"),
    orgId: org.id,
    type,
    title: `${snapshot.title}${snapshot.subtitle ? ` — ${snapshot.subtitle}` : ""}`,
    createdAt: new Date(),
    createdBy: by.id,
    createdByName: by.name,
    trigger,
    scheduleId,
    params,
    snapshot,
    pages: estimatePages(snapshot),
    downloads: 0,
  };
  const st = wsState();
  st.reports.unshift(rec);
  if (st.reports.length > 1000) st.reports.length = 1000;
  trackUsage(org.id, "reports");
  notify(org.id, { kind: "report", title: `${snapshot.title} ready`, body: snapshot.summary, href: `/app/reports?open=${rec.id}`, severity: "info" });
  void fireWorkspaceEvent(org.id, "report.ready", { reportId: rec.id, type, title: rec.title, url: `${APP_URL()}/app/reports?open=${rec.id}` });
  return rec;
}

async function runSchedule(sch: ReportSchedule, now = new Date()) {
  const s = getStore();
  const org = s.orgs.find((o) => o.id === sch.orgId);
  if (!org) return;
  const creator = s.users.find((u) => u.id === sch.createdBy);
  sch.lastRunAt = now;
  sch.nextRunAt = nextRunAt(sch.cadence, sch.day, sch.hourUtc, now);
  sch.runs += 1;
  if (!checkLimit(org.id, "reports", 1).ok) {
    notify(org.id, { kind: "billing", title: "Scheduled report skipped", body: "Your plan's monthly report limit is reached. Upgrade to resume scheduled reports.", href: "/app/settings/billing", severity: "warning" });
    return;
  }
  const rec = await generateAndStore(org, { id: sch.createdBy, name: `${creator?.name ?? "Scheduler"} (scheduled)` }, sch.type, {}, "schedule", sch.id);
  for (const to of sch.recipients) {
    await sendEmail(to, `[Agri-SHIELD] ${rec.snapshot.title} — ${org.shortName}`, `<p>${esc(rec.snapshot.summary)}</p><p><a href="${APP_URL()}/app/reports?open=${rec.id}">Open and download the PDF</a></p><p style="color:#64748b">Scheduled ${sch.cadence} report. Manage schedules in Reports.</p>`).catch(() => undefined);
  }
}

export async function runDueReportSchedules(orgId?: string, now = new Date()) {
  const due = dueSchedules(wsState().schedules, now).filter((x) => !orgId || x.orgId === orgId);
  for (const sch of due) await runSchedule(sch, now).catch(() => undefined);
  return due.length;
}

const gSched = globalThis as unknown as { __agriReportSched?: ReturnType<typeof setInterval> };
function ensureReportScheduler() {
  if (gSched.__agriReportSched || process.env.DISABLE_SCHEDULER === "true" || process.env.VITEST) return;
  gSched.__agriReportSched = setInterval(() => void runDueReportSchedules().catch(() => undefined), 10 * 60_000);
  (gSched.__agriReportSched as unknown as { unref?: () => void }).unref?.();
}

// ─── Invoices derived from subscription history ──────────────────────────

function invoicesFor(org: OrgRecord) {
  const st = wsState();
  const sub = subscriptionOf(org.id);
  const events = st.planEvents.filter((e) => e.orgId === org.id).sort((a, b) => a.at.getTime() - b.at.getTime());
  // Seeded workspaces have no plan-change history: they've been on their current plan since creation.
  const planAt = (d: Date): { plan: SubscriptionPlan; status: string } => {
    const past = events.filter((e) => e.at.getTime() <= d.getTime()).at(-1);
    if (past) return { plan: past.plan, status: past.status };
    if (events.length) return { plan: events[0]!.plan, status: events[0]!.status };
    return { plan: org.planTier, status: sub?.status === "trialing" ? "trialing" : "active" };
  };
  const out: { id: string; period: string; issuedAt: Date; plan: string; amountUsd: number; status: "paid" | "trial" | "upcoming" | "void"; note: string }[] = [];
  const start = new Date(Math.max(org.createdAt.getTime(), Date.now() - 365 * 86_400_000));
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const now = new Date();
  while (cur.getTime() <= now.getTime()) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const probe = new Date(Math.min(next.getTime() - 1, now.getTime()));
    const isCurrent = next.getTime() > now.getTime();
    const { plan, status } = isCurrent ? { plan: org.planTier, status: sub?.status ?? "active" } : planAt(probe);
    const amount = status === "trialing" ? 0 : PLAN_PRICE_USD[plan];
    out.push({
      id: `INV-${org.shortName.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6)}-${cur.toISOString().slice(0, 7).replace("-", "")}`,
      period: cur.toISOString().slice(0, 7),
      issuedAt: isCurrent ? next : cur,
      plan: PLAN_LABEL[plan],
      amountUsd: amount,
      status: status === "cancelled" ? "void" : status === "trialing" ? "trial" : isCurrent ? "upcoming" : "paid",
      note: status === "trialing" ? "Free trial — no charge" : plan === "free" ? "Free plan" : `${PLAN_LABEL[plan]} subscription`,
    });
    cur = next;
  }
  return out.reverse();
}

const WORKSPACE_PLANS: { id: SubscriptionPlan; name: string; priceUsd: number | null; fromUsd?: number; blurb: string; features: string[] }[] = [
  { id: "free", name: "Free", priceUsd: 0, blurb: "Try Agri-SHIELD on a handful of locations.", features: ["25 monitored assets", "250 assessments / month", "2 seats", "5 reports / month"] },
  { id: "business", name: "Business", priceUsd: PLAN_PRICE_USD.business, blurb: "One workspace for an insurer, lender, agribusiness, NGO or co-op.", features: ["2,500 monitored assets", "10 seats", "25,000 assessments / month", "API + signed webhooks", "Scheduled reports"] },
  { id: "enterprise", name: "Enterprise", priceUsd: null, fromUsd: 4900, blurb: "Every module, unlimited assets, your security and hosting requirements.", features: ["Unlimited assets, usage & seats", "Multiple workspaces", "99.9% uptime SLA", "Dedicated success manager", "Private hosting / data residency"] },
];

// ─── Router ───────────────────────────────────────────────────────────────

const settingsInput = z.object({
  orgId: z.string().optional(),
  name: z.string().trim().min(2).max(120).optional(),
  shortName: z.string().trim().min(1).max(24).optional(),
  logoInitials: z.string().trim().min(1).max(3).optional(),
  logoColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  industry: z.enum(["government", "insurance", "banking", "agribusiness", "ngo", "cooperative"]).optional(),
  settings: z
    .object({
      units: z.enum(["metric", "imperial"]),
      timezone: z.string().min(2).max(64),
      currency: z.string().regex(/^[A-Z]{3}$/),
      locale: z.string().min(2).max(16),
      defaultCenter: z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]),
      defaultZoom: z.number().int().min(2).max(14),
      riskThreshold: z.number().int().min(10).max(95),
      weeklyDigest: z.boolean(),
    })
    .partial()
    .optional(),
});

const reportTypeInput = z.enum(["portfolio_summary", "location_dd", "physical_risk", "weekly_digest", "board_pack"]);

export const workspaceRouter = router({
  ping: proc.query(() => ({ ok: true })),

  /** Shell context: org, plan/trial, unread count, onboarding progress. */
  me: proc.input(z.object({ orgId: z.string().optional() }).optional()).query(({ ctx, input }) => {
    const s = getStore();
    const org = ctx.user.orgId || input?.orgId ? orgOf(ctx, input?.orgId) : null;
    const u = s.users.find((x) => x.id === ctx.user.id);
    if (!org) return { org: null, user: { id: ctx.user.id, name: u?.name ?? ctx.user.name, role: ctx.user.role, roleLabel: ROLE_LABELS[ctx.user.role], title: u?.title ?? null }, unread: 0, isAdmin: ctx.user.role === "platform_admin", onboarding: null, trial: null, deletion: null };
    const plan = planOf(org.id);
    const unread = s.notifications.filter((n) => n.workspaceId === org.id && (!n.userId || n.userId === ctx.user.id) && !n.readBy.includes(ctx.user.id)).length;
    const ob = onboardingFor(org.id);
    const del = wsState().deletion.get(org.id);
    return {
      org: { id: org.id, name: org.name, shortName: org.shortName, industry: industryOf(org), industryLabel: INDUSTRY_LABEL[industryOf(org)], country: org.country, plan, planLabel: PLAN_LABEL[plan], ...profileFor(org), settings: org.settings ?? null },
      user: { id: ctx.user.id, name: u?.name ?? ctx.user.name, role: ctx.user.role, roleLabel: ROLE_LABELS[ctx.user.role], title: u?.title ?? null },
      unread,
      isAdmin: isAdminRole(ctx.user.role),
      onboarding: { done: ob.done, total: ob.total, dismissed: ob.dismissed, complete: ob.complete },
      trial: trialInfo(org),
      deletion: del && del.status === "pending" ? { scheduledFor: del.scheduledFor } : null,
    };
  }),

  /** Workspace Home: greeting, briefing, KPI tiles, map points, notifications, hazards. */
  home: proc.input(z.object({ orgId: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    ensureReportScheduler();
    const org = orgOf(ctx, input?.orgId);
    void runDueReportSchedules(org.id).catch(() => undefined);
    const s = getStore();
    const assets = s.assets.filter((a) => a.workspaceId === org.id && a.status === "active");
    const scores = await portfolioScores(org.id);
    const m = computeMetrics(org, assets, scores);
    const near = assets.length ? await hazardsNear(assets) : [];
    const brief = buildBriefing(m, near.length);
    const u = s.users.find((x) => x.id === ctx.user.id);
    const tz = org.settings?.timezone ?? "UTC";
    const notes = s.notifications
      .filter((n) => n.workspaceId === org.id && (!n.userId || n.userId === ctx.user.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 6)
      .map((n) => ({ ...n, read: n.readBy.includes(ctx.user.id) }));
    const scoredAt = [...scores.values()].reduce((t, x) => Math.max(t, x.at.getTime()), 0);
    const industry = industryOf(org);
    return {
      greeting: greeting(tz),
      firstName: (u?.name ?? ctx.user.name ?? "there").split(" ")[0],
      org: { id: org.id, name: org.name, shortName: org.shortName, industry, industryLabel: INDUSTRY_LABEL[industry], ...profileFor(org) },
      today: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date()),
      timezone: tz,
      briefing: brief,
      metrics: { total: m.total, exposureUsd: m.exposureUsd, atRisk: m.atRisk, atRiskPct: m.atRiskPct, atRiskExposureUsd: m.atRiskExposureUsd, threshold: m.threshold, avgComposite: m.avgComposite, avgComposite7dAgo: m.avgComposite7dAgo, levels: m.levels, activeAlerts: m.activeAlerts, noun: m.noun, highFlood: m.highFlood, highSalinity: m.highSalinity },
      kpis: kpiTiles(m, assets, scores),
      top: m.top.slice(0, 5),
      byDistrict: m.byDistrict.slice(0, 6),
      points: assets.slice(0, 800).map((a) => {
        const sc = scores.get(a.id);
        return { id: a.id, name: a.name, lat: a.lat, lon: a.lon, composite: Math.round(sc?.composite ?? 0), level: sc?.level ?? "low", valueUsd: a.valueUsd };
      }),
      mapCenter: org.settings?.defaultCenter ?? (assets[0] ? [assets[0].lat, assets[0].lon] : [15, 100]),
      mapZoom: org.settings?.defaultZoom ?? 5,
      notifications: notes,
      hazards: near,
      quickActions: QUICK_ACTIONS[industry],
      source: { scoredAt: scoredAt ? new Date(scoredAt) : new Date(), mix: m.sourceMix },
      onboarding: onboardingFor(org.id),
      trial: trialInfo(org),
    };
  }),

  // ─── Notifications ───────────────────────────────────────────────────
  notifications: proc.input(z.object({ limit: z.number().int().min(1).max(100).default(20), unreadOnly: z.boolean().default(false) }).optional()).query(({ ctx, input }) => {
    const org = orgOf(ctx);
    const list = getStore()
      .notifications.filter((n) => n.workspaceId === org.id && (!n.userId || n.userId === ctx.user.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((n) => ({ ...n, read: n.readBy.includes(ctx.user.id) }));
    return { items: (input?.unreadOnly ? list.filter((n) => !n.read) : list).slice(0, input?.limit ?? 20), unread: list.filter((n) => !n.read).length };
  }),
  markNotificationsRead: proc.input(z.object({ ids: z.array(z.string()).max(200).optional() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    let n = 0;
    for (const x of getStore().notifications) {
      if (x.workspaceId !== org.id || (x.userId && x.userId !== ctx.user.id)) continue;
      if (input.ids && !input.ids.includes(x.id)) continue;
      if (!x.readBy.includes(ctx.user.id)) (x.readBy.push(ctx.user.id), (n += 1));
    }
    return { marked: n };
  }),

  // ─── Onboarding & tour ──────────────────────────────────────────────
  onboarding: proc.query(({ ctx }) => onboardingFor(orgIdOf(ctx))),
  setOnboardingDismissed: proc.input(z.object({ dismissed: z.boolean() })).mutation(({ ctx, input }) => {
    const id = orgIdOf(ctx);
    onboardingFor(id);
    wsState().onboarding.get(id)!.dismissed = input.dismissed;
    return onboardingFor(id);
  }),
  tourState: proc.query(({ ctx }) => {
    const t = wsState().tour.get(ctx.user.id);
    return { seen: !!(t?.completedAt || t?.dismissedAt), completedAt: t?.completedAt ?? null, dismissedAt: t?.dismissedAt ?? null, step: t?.step ?? 0 };
  }),
  setTour: proc.input(z.object({ action: z.enum(["complete", "dismiss", "reset", "progress"]), step: z.number().int().min(0).max(50).default(0) })).mutation(({ ctx, input }) => {
    const st = wsState();
    const t = st.tour.get(ctx.user.id) ?? { completedAt: null, dismissedAt: null, step: 0 };
    if (input.action === "complete") t.completedAt = new Date();
    if (input.action === "dismiss") t.dismissedAt = new Date();
    if (input.action === "reset") (t.completedAt = null), (t.dismissedAt = null), (t.step = 0);
    if (input.action === "progress") t.step = input.step;
    st.tour.set(ctx.user.id, t);
    return { ok: true };
  }),

  // ─── Settings: general ──────────────────────────────────────────────
  getSettings: proc.input(z.object({ orgId: z.string().optional() }).optional()).query(({ ctx, input }) => {
    const org = orgOf(ctx, input?.orgId);
    return { id: org.id, name: org.name, shortName: org.shortName, country: org.country, industry: industryOf(org), type: org.type, createdAt: org.createdAt, verified: org.verified, settings: org.settings!, ...profileFor(org), canEdit: isAdminRole(ctx.user.role) };
  }),
  updateSettings: admin.input(settingsInput).mutation(({ ctx, input }) => {
    const org = orgOf(ctx, input.orgId);
    const changes: string[] = [];
    if (input.name && input.name !== org.name) (org.name = input.name), changes.push("name");
    if (input.shortName && input.shortName !== org.shortName) (org.shortName = input.shortName), changes.push("short name");
    if (input.industry && input.industry !== org.industry) (org.industry = input.industry), changes.push(`industry → ${input.industry}`);
    const p = profileFor(org);
    if (input.logoInitials) (p.logoInitials = input.logoInitials.toUpperCase()), changes.push("logo");
    if (input.logoColor) (p.logoColor = input.logoColor), changes.push("logo colour");
    if (input.settings) {
      org.settings = { ...org.settings!, ...input.settings };
      changes.push(...Object.keys(input.settings));
    }
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "workspace.settings.update", entity: "organization", entityId: org.id, details: changes.join(", ") || "no changes" });
    return { ok: true, changes };
  }),

  // ─── Team & invites ─────────────────────────────────────────────────
  team: proc.query(({ ctx }) => {
    const org = orgOf(ctx);
    const s = getStore();
    const now = new Date();
    const invites = wsState()
      .invites.filter((i) => i.orgId === org.id)
      .map((i) => ({ id: i.id, email: i.email, role: i.role, roleLabel: ROLE_LABELS[i.role], status: inviteStatus(i, now), createdAt: i.createdAt, expiresAt: i.expiresAt, invitedByName: i.invitedByName, acceptedAt: i.acceptedAt, link: isAdminRole(ctx.user.role) ? `/invite/${i.token}` : null }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const seats = checkLimit(org.id, "seats");
    const pending = invites.filter((i) => i.status === "pending").length;
    return {
      members: members(org.id).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, roleLabel: ROLE_LABELS[u.role], title: u.title ?? null, status: u.status, lastActive: u.lastActive, createdAt: u.createdAt, isYou: u.id === ctx.user.id })),
      invites,
      roles: rolesForOrg(org),
      seats: { used: seats.used, pending, limit: seats.limit, plan: PLAN_LABEL[seats.plan] },
      canManage: isAdminRole(ctx.user.role),
    };
  }),
  invite: admin.input(z.object({ email: z.string().trim().email().max(120), role: z.string() })).mutation(async ({ ctx, input }) => {
    const org = orgOf(ctx);
    const s = getStore();
    const st = wsState();
    const email = input.email.toLowerCase();
    const role = rolesForOrg(org).find((r) => r.role === input.role)?.role;
    if (!role) throw new TRPCError({ code: "BAD_REQUEST", message: "That role isn't available in this workspace" });
    if (members(org.id).some((u) => u.email?.toLowerCase() === email)) throw new TRPCError({ code: "CONFLICT", message: "This person is already a member" });
    if (s.users.some((u) => u.email?.toLowerCase() === email)) throw new TRPCError({ code: "CONFLICT", message: "This email already has an Agri-SHIELD account in another workspace" });
    const pending = st.invites.filter((i) => i.orgId === org.id && inviteStatus(i) === "pending");
    if (pending.some((i) => i.email === email)) throw new TRPCError({ code: "CONFLICT", message: "An invite is already pending for this email — copy or resend it" });
    enforceLimit(org.id, "seats", pending.length + 1);
    const inv = makeInvite({ orgId: org.id, email, role, by: actor(ctx) });
    st.invites.unshift(inv);
    const link = `${APP_URL()}/invite/${inv.token}`;
    await sendEmail(email, `${actor(ctx).name} invited you to ${org.name} on Agri-SHIELD`, `<p>${esc(actor(ctx).name)} invited you to join <b>${esc(org.name)}</b> as ${ROLE_LABELS[role]}.</p><p><a href="${link}">Accept the invite</a> (valid 7 days)</p>`).catch(() => undefined);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "team.invite", entity: "invite", entityId: inv.id, details: `${email} as ${ROLE_LABELS[role]}` });
    notify(org.id, { kind: "team", title: `Invite sent to ${email}`, body: `${actor(ctx).name} invited ${email} as ${ROLE_LABELS[role]}.`, href: "/app/settings/team", severity: "info" });
    return { id: inv.id, link: `/invite/${inv.token}`, expiresAt: inv.expiresAt };
  }),
  resendInvite: admin.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const org = orgOf(ctx);
    const inv = wsState().invites.find((i) => i.id === input.id && i.orgId === org.id);
    if (!inv || inv.status !== "pending") throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or already used" });
    const fresh = makeInvite({ orgId: org.id, email: inv.email, role: inv.role, by: actor(ctx) });
    inv.token = fresh.token;
    inv.expiresAt = fresh.expiresAt;
    await sendEmail(inv.email, `Reminder: join ${org.name} on Agri-SHIELD`, `<p><a href="${APP_URL()}/invite/${inv.token}">Accept the invite</a> (valid 7 days)</p>`).catch(() => undefined);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "team.invite.resend", entity: "invite", entityId: inv.id, details: inv.email });
    return { link: `/invite/${inv.token}`, expiresAt: inv.expiresAt };
  }),
  revokeInvite: admin.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const inv = wsState().invites.find((i) => i.id === input.id && i.orgId === org.id);
    if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
    if (inv.status === "accepted") throw new TRPCError({ code: "BAD_REQUEST", message: "Invite already accepted — remove the member instead" });
    inv.status = "revoked";
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "team.invite.revoke", entity: "invite", entityId: inv.id, details: inv.email });
    return { ok: true };
  }),
  changeRole: admin.input(z.object({ userId: z.string(), role: z.string() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const u = members(org.id).find((x) => x.id === input.userId);
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
    const opt = rolesForOrg(org).find((r) => r.role === input.role);
    if (!opt) throw new TRPCError({ code: "BAD_REQUEST", message: "That role isn't available in this workspace" });
    const admins = members(org.id).filter((x) => isAdminRole(x.role) && x.status !== "suspended");
    if (isAdminRole(u.role) && !opt.admin && admins.length <= 1) throw new TRPCError({ code: "BAD_REQUEST", message: "A workspace needs at least one admin" });
    const from = u.role;
    u.role = opt.role;
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "team.role.change", entity: "user", entityId: u.id, details: `${u.name}: ${ROLE_LABELS[from]} → ${ROLE_LABELS[opt.role]}` });
    notify(org.id, { kind: "team", title: `${u.name} is now ${opt.label}`, body: "Role changes apply at their next sign-in.", href: "/app/settings/team", severity: "info" });
    return { ok: true };
  }),
  removeMember: admin.input(z.object({ userId: z.string() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const u = members(org.id).find((x) => x.id === input.userId);
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
    if (u.id === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You can't remove yourself — ask another admin" });
    const admins = members(org.id).filter((x) => isAdminRole(x.role) && x.status !== "suspended");
    if (isAdminRole(u.role) && admins.length <= 1) throw new TRPCError({ code: "BAD_REQUEST", message: "A workspace needs at least one admin" });
    u.orgId = null;
    u.status = "suspended";
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "team.remove", entity: "user", entityId: u.id, details: `${u.name} <${u.email}> removed; access revoked` });
    notify(org.id, { kind: "team", title: `${u.name} was removed`, body: `${actor(ctx).name} removed ${u.name} from the workspace.`, href: "/app/settings/team", severity: "warning" });
    return { ok: true };
  }),

  /** Public: what an invite link points to. */
  inviteInfo: publicProcedure.input(z.object({ token: z.string().min(10).max(80) })).query(({ input }) => {
    const inv = findInvite(input.token);
    const chk = checkRedeemable(inv);
    if (!chk.ok) return { valid: false as const, reason: chk.reason };
    const org = getStore().orgs.find((o) => o.id === chk.invite.orgId);
    if (!org) return { valid: false as const, reason: "The workspace for this invite no longer exists." };
    return { valid: true as const, email: chk.invite.email, role: chk.invite.role, roleLabel: rolesForOrg(org).find((r) => r.role === chk.invite.role)?.label ?? ROLE_LABELS[chk.invite.role], orgName: org.name, orgShort: org.shortName, industry: INDUSTRY_LABEL[industryOf(org)], invitedByName: chk.invite.invitedByName, expiresAt: chk.invite.expiresAt, ...profileFor(org) };
  }),
  /** Public: redeem an invite by creating the account inside the workspace. */
  acceptInvite: publicProcedure
    .input(z.object({ token: z.string().min(10).max(80), name: z.string().trim().min(2).max(80), password: z.string().min(8).max(128), title: z.string().trim().max(80).optional() }))
    .mutation(({ input }) => {
      const s = getStore();
      const inv = findInvite(input.token);
      const chk = checkRedeemable(inv);
      if (!chk.ok) throw new TRPCError({ code: "BAD_REQUEST", message: chk.reason });
      const org = s.orgs.find((o) => o.id === chk.invite.orgId);
      if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace no longer exists" });
      if (s.users.some((u) => u.email?.toLowerCase() === chk.invite.email)) throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists — sign in instead." });
      const now = new Date();
      const user: UserRecord = { id: nextId("user"), email: chk.invite.email, phone: null, name: input.name, role: chk.invite.role, language: "en", orgId: org.id, subscriptionTier: org.planTier, status: "active", createdAt: now, lastActive: now, password: input.password, title: input.title || undefined };
      s.users.push(user);
      chk.invite.status = "accepted";
      chk.invite.acceptedAt = now;
      chk.invite.acceptedUserId = user.id;
      audit({ userId: user.id, userName: user.name, action: "team.invite.accept", entity: "invite", entityId: chk.invite.id, details: `Joined ${org.name} as ${ROLE_LABELS[user.role]}` });
      notify(org.id, { kind: "team", title: `${user.name} joined the workspace`, body: `${ROLE_LABELS[user.role]} · invited by ${chk.invite.invitedByName}`, href: "/app/settings/team", severity: "success" });
      return { email: user.email!, orgName: org.name };
    }),

  // ─── Plan & billing ─────────────────────────────────────────────────
  billing: proc.query(({ ctx }) => {
    const org = orgOf(ctx);
    const sub = subscriptionOf(org.id);
    const usage = usageSummary(org.id);
    return {
      usage,
      daily: usageDaily(org.id),
      subscription: sub ? { plan: sub.plan, planLabel: PLAN_LABEL[sub.plan], status: sub.status, provider: sub.provider, currentPeriodEnd: sub.currentPeriodEnd, mrrUsd: sub.mrrUsd } : null,
      trial: trialInfo(org),
      invoices: invoicesFor(org),
      plans: WORKSPACE_PLANS.map((p) => ({ ...p, limits: PLAN_LIMITS[p.id], current: p.id === usage.plan })),
      canManage: isAdminRole(ctx.user.role),
    };
  }),
  changePlan: admin
    .input(z.object({ plan: z.enum(["free", "enterprise"]), message: z.string().trim().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const org = orgOf(ctx);
      const s = getStore();
      const who = actor(ctx);
      const email = s.users.find((u) => u.id === ctx.user.id)?.email ?? "unknown@workspace";
      if (input.plan === "enterprise") {
        const st = wsState();
        st.tickets.unshift({ id: `TCK-${(1000 + st.tickets.length + 1).toString()}${Date.now().toString(36).slice(-2).toUpperCase()}`, at: new Date(), name: who.name, email, orgId: org.id, userId: ctx.user.id, topic: "billing", subject: `Enterprise upgrade request — ${org.name}`, message: input.message ?? `Enterprise upgrade request from workspace ${org.id}`, status: "open", priority: "high" });
        await sendEmail(process.env.SALES_EMAIL ?? "partners@agrishield.io", `Enterprise upgrade request: ${org.name}`, `<p>${esc(who.name)} &lt;${esc(email)}&gt; asked for Enterprise for ${esc(org.name)} (${org.id}).</p><p>${esc(input.message ?? "")}</p>`).catch(() => undefined);
        audit({ userId: ctx.user.id, userName: who.name, action: "billing.enterprise_request", entity: "organization", entityId: org.id, details: "Enterprise quote requested" });
        notify(org.id, { kind: "billing", title: "Enterprise request received", body: "Our team will reply within one business day with a quote.", href: "/app/settings/billing", severity: "success" });
        return { kind: "requested" as const };
      }
      if (input.plan === "free") {
        const assets = s.assets.filter((a) => a.workspaceId === org.id && a.status === "active").length;
        const seats = members(org.id).length;
        if (assets > (PLAN_LIMITS.free.assets ?? 0) || seats > (PLAN_LIMITS.free.seats ?? 0)) throw new TRPCError({ code: "BAD_REQUEST", message: `The Free plan allows ${PLAN_LIMITS.free.assets} assets and ${PLAN_LIMITS.free.seats} seats — archive assets or remove members first (you have ${assets} assets, ${seats} seats).` });
      }
      let sub = subscriptionOf(org.id);
      if (!sub) {
        sub = { id: nextId("sub"), userId: null, orgId: org.id, plan: input.plan, status: "active", mrrUsd: 0, currentPeriodEnd: new Date(), provider: "none" };
        s.subscriptions.unshift(sub);
      }
      const now = new Date();
      sub.plan = input.plan;
      sub.status = "active";
      sub.mrrUsd = PLAN_PRICE_USD[input.plan];
      sub.currentPeriodEnd = new Date(now.getTime() + 30 * 86_400_000);
      org.planTier = input.plan;
      org.trialEndsAt = null;
      for (const u of members(org.id)) u.subscriptionTier = input.plan;
      wsState().planEvents.push({ orgId: org.id, at: now, plan: input.plan, status: "active", note: "Downgraded to Free" });
      audit({ userId: ctx.user.id, userName: who.name, action: `billing.plan.${input.plan}`, entity: "subscription", entityId: sub.id, details: `${PLAN_LABEL[input.plan]} (downgrade)` });
      notify(org.id, { kind: "billing", title: `Plan changed to ${PLAN_LABEL[input.plan]}`, body: "Limits now follow the Free plan.", href: "/app/settings/billing", severity: "success" });
      return { kind: "activated" as const, plan: input.plan };
    }),

  // ─── API keys & webhooks ────────────────────────────────────────────
  api: proc.query(({ ctx }) => {
    const org = orgOf(ctx);
    const s = getStore();
    const sc = scState();
    return {
      keys: s.apiKeys.filter((k) => k.orgId === org.id).map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsed: k.lastUsed, scopes: k.scopes, hashed: sc.keyHashes.has(k.id) })),
      webhooks: s.webhooks
        .filter((w) => w.orgId === org.id)
        .map((w) => ({ id: w.id, name: sc.webhookNames.get(w.id) ?? new URL(w.url).hostname, url: w.url, events: w.events, active: w.active, createdAt: w.createdAt, lastDelivery: w.lastDelivery, secretHint: `${w.secret.slice(0, 10)}…` })),
      deliveries: sc.deliveries.filter((d) => d.orgId === org.id).slice(0, 15).map((d) => ({ id: d.id, webhookId: d.webhookId, event: d.event, at: d.at, status: d.status, ok: d.ok, latencyMs: d.latencyMs, error: d.error })),
      scopes: API_SCOPES,
      events: WS_WEBHOOK_EVENTS,
      usage: checkLimit(org.id, "apiCalls"),
      canManage: isAdminRole(ctx.user.role),
      baseUrl: APP_URL(),
    };
  }),
  createApiKey: admin.input(z.object({ name: z.string().trim().min(2).max(60), scopes: z.array(z.enum(API_SCOPES)).min(1), environment: z.enum(["live", "test"]).default("live") })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const { record, key } = createApiKey(org.id, input.name, input.scopes, input.environment, actor(ctx));
    return { id: record.id, prefix: record.prefix, key };
  }),
  revokeApiKey: admin.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const s = getStore();
    const k = s.apiKeys.find((x) => x.id === input.id && x.orgId === org.id);
    if (!k) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
    s.apiKeys = s.apiKeys.filter((x) => x.id !== k.id);
    scState().keyHashes.delete(k.id);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "apikey.revoke", entity: "api_key", entityId: k.id, details: k.name });
    return { ok: true };
  }),
  createWebhook: admin.input(z.object({ name: z.string().trim().min(2).max(60), url: z.string().url().max(500), events: z.array(z.enum(wsEventIds)).min(1) })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    let url: string;
    try {
      url = assertSafeWebhookUrl(input.url);
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
    }
    const secret = newWebhookSecret();
    const w = { id: nextId("whk"), orgId: org.id, url, commodities: [], riskThreshold: org.settings?.riskThreshold ?? 60, events: input.events, active: true, secret, createdAt: new Date(), lastDelivery: null };
    getStore().webhooks.unshift(w);
    scState().webhookNames.set(w.id, input.name);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "webhook.create", entity: "webhook", entityId: w.id, details: `${input.name} → ${url}` });
    return { id: w.id, secret };
  }),
  toggleWebhook: admin.input(z.object({ id: z.string(), active: z.boolean() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const w = getStore().webhooks.find((x) => x.id === input.id && x.orgId === org.id);
    if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
    w.active = input.active;
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: input.active ? "webhook.enable" : "webhook.disable", entity: "webhook", entityId: w.id, details: w.url });
    return { ok: true };
  }),
  deleteWebhook: admin.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const s = getStore();
    const w = s.webhooks.find((x) => x.id === input.id && x.orgId === org.id);
    if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
    s.webhooks = s.webhooks.filter((x) => x.id !== w.id);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "webhook.delete", entity: "webhook", entityId: w.id, details: w.url });
    return { ok: true };
  }),
  testWebhook: admin.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const org = orgOf(ctx);
    const w = getStore().webhooks.find((x) => x.id === input.id && x.orgId === org.id);
    if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
    const d = await deliverWebhook(w, w.events[0] ?? "report.ready", { test: true, workspace: org.name, message: "Test delivery from Agri-SHIELD Settings → API & integrations" }, "test");
    return { ok: d.ok, status: d.status, latencyMs: d.latencyMs, error: d.error };
  }),

  // ─── Security ───────────────────────────────────────────────────────
  security: proc.query(({ ctx }) => {
    const org = orgOf(ctx);
    const st = wsState();
    const s = getStore();
    const signins = s.audit.filter((a) => a.userId === ctx.user.id && a.action === "auth.signin").slice(0, 10);
    const ua = ctx.req?.headers.get("user-agent") ?? "";
    const device = /iphone|android|mobile/i.test(ua) ? "Mobile browser" : /windows/i.test(ua) ? "Windows · browser" : /mac os/i.test(ua) ? "macOS · browser" : /curl/i.test(ua) ? "API client (curl)" : "Browser";
    const sessions = signins.map((a, i) => ({ id: a.id, at: a.at, method: a.details.replace("Signed in via ", ""), device: i === 0 ? device : "Previous sign-in", ip: i === 0 ? ctx.ip : "—", current: i === 0, revoked: st.revokedSessions.has(a.id), expiresAt: new Date(a.at.getTime() + 7 * 86_400_000) }));
    const prefs = st.security.get(ctx.user.id) ?? { twoFactor: false, method: "totp" as const, updatedAt: null };
    const del = st.deletion.get(org.id);
    return { sessions, twoFactor: prefs, deletion: del ?? null, orgName: org.name, canManage: isAdminRole(ctx.user.role) };
  }),
  setTwoFactor: proc.input(z.object({ enabled: z.boolean(), method: z.enum(["totp", "sms", "email"]).default("totp") })).mutation(({ ctx, input }) => {
    wsState().security.set(ctx.user.id, { twoFactor: input.enabled, method: input.method, updatedAt: new Date() });
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: input.enabled ? "security.2fa.enable" : "security.2fa.disable", entity: "user", entityId: ctx.user.id, details: `2-step verification ${input.enabled ? `on (${input.method})` : "off"}` });
    return { ok: true };
  }),
  revokeSession: proc.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const a = getStore().audit.find((x) => x.id === input.id && x.userId === ctx.user.id && x.action === "auth.signin");
    if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
    wsState().revokedSessions.add(a.id);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "security.session.revoke", entity: "session", entityId: a.id, details: `Sign-in of ${a.at.toISOString().slice(0, 16)}` });
    return { ok: true };
  }),
  exportWorkspace: admin.mutation(({ ctx }) => {
    const org = orgOf(ctx);
    const s = getStore();
    const st = wsState();
    const ids = new Set(members(org.id).map((u) => u.id));
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "workspace.export", entity: "organization", entityId: org.id, details: "Full JSON export" });
    return {
      exportedAt: new Date().toISOString(),
      format: "agri-shield.workspace.v1",
      organization: { ...org, profile: profileFor(org) },
      members: members(org.id).map(({ password: _pw, ...u }) => u),
      assets: s.assets.filter((a) => a.workspaceId === org.id),
      alertRules: s.alertRules.filter((r) => r.workspaceId === org.id),
      notifications: s.notifications.filter((n) => n.workspaceId === org.id),
      reports: st.reports.filter((r) => r.orgId === org.id).map(({ snapshot, ...r }) => ({ ...r, summary: snapshot.summary })),
      reportSchedules: st.schedules.filter((x) => x.orgId === org.id),
      invites: st.invites.filter((i) => i.orgId === org.id).map(({ token: _t, ...i }) => i),
      apiKeys: s.apiKeys.filter((k) => k.orgId === org.id),
      webhooks: s.webhooks.filter((w) => w.orgId === org.id).map(({ secret: _s, ...w }) => w),
      subscription: subscriptionOf(org.id),
      usage: usageSummary(org.id),
      audit: s.audit.filter((a) => ids.has(a.userId)),
    };
  }),
  requestDeletion: admin.input(z.object({ confirmName: z.string(), reason: z.string().trim().max(500).default("") })).mutation(async ({ ctx, input }) => {
    const org = orgOf(ctx);
    if (input.confirmName.trim() !== org.name) throw new TRPCError({ code: "BAD_REQUEST", message: "Type the workspace name exactly to confirm" });
    const now = new Date();
    const req = { orgId: org.id, requestedBy: ctx.user.id, requestedByName: actor(ctx).name, requestedAt: now, scheduledFor: new Date(now.getTime() + 30 * 86_400_000), reason: input.reason, status: "pending" as const };
    wsState().deletion.set(org.id, req);
    for (const a of members(org.id).filter((u) => isAdminRole(u.role) && u.email)) {
      await sendEmail(a.email!, `Deletion requested for ${org.name}`, `<p>${esc(actor(ctx).name)} requested permanent deletion of the workspace <b>${esc(org.name)}</b>. It will be deleted on ${req.scheduledFor.toISOString().slice(0, 10)} unless an admin cancels in Settings → Security.</p>`).catch(() => undefined);
    }
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "workspace.delete.request", entity: "organization", entityId: org.id, details: `Scheduled ${req.scheduledFor.toISOString().slice(0, 10)}${input.reason ? ` — ${input.reason}` : ""}` });
    notify(org.id, { kind: "system", title: "Workspace deletion scheduled", body: `Scheduled for ${req.scheduledFor.toISOString().slice(0, 10)}. Any admin can cancel in Settings → Security.`, href: "/app/settings/security", severity: "critical" });
    return req;
  }),
  cancelDeletion: admin.mutation(({ ctx }) => {
    const org = orgOf(ctx);
    const req = wsState().deletion.get(org.id);
    if (!req || req.status !== "pending") throw new TRPCError({ code: "NOT_FOUND", message: "No pending deletion request" });
    req.status = "cancelled";
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "workspace.delete.cancel", entity: "organization", entityId: org.id, details: "Deletion request cancelled" });
    notify(org.id, { kind: "system", title: "Workspace deletion cancelled", body: `${actor(ctx).name} cancelled the deletion request.`, href: "/app/settings/security", severity: "success" });
    return { ok: true };
  }),

  // ─── Audit log ──────────────────────────────────────────────────────
  auditLog: proc
    .input(z.object({ q: z.string().max(80).optional(), action: z.string().max(40).optional(), userId: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(({ ctx, input }) => {
      const org = orgOf(ctx);
      const ids = new Set(members(org.id).map((u) => u.id));
      const invIds = new Set(wsState().invites.filter((i) => i.orgId === org.id).map((i) => i.id));
      const q = input?.q?.toLowerCase();
      const scoped = getStore().audit.filter((a) => ids.has(a.userId) || a.entityId === org.id || invIds.has(a.entityId));
      const rows = scoped.filter((a) => (!input?.action || a.action.startsWith(input.action)) && (!input?.userId || a.userId === input.userId) && (!q || `${a.action} ${a.details} ${a.userName} ${a.entity}`.toLowerCase().includes(q)));
      const actions = [...new Set(scoped.map((a) => a.action.split(".")[0]!))].sort();
      return { rows: rows.slice(0, input?.limit ?? 100), total: rows.length, actions, users: members(org.id).map((u) => ({ id: u.id, name: u.name })) };
    }),

  // ─── Reports hub ────────────────────────────────────────────────────
  reports: proc.query(async ({ ctx }) => {
    ensureReportScheduler();
    const org = orgOf(ctx);
    await runDueReportSchedules(org.id);
    const st = wsState();
    const assets = getStore().assets.filter((a) => a.workspaceId === org.id && a.status === "active").map((a) => ({ id: a.id, name: a.name, lat: a.lat, lon: a.lon, crop: a.crop }));
    return {
      catalogue: REPORT_CATALOGUE,
      history: st.reports.filter((r) => r.orgId === org.id).slice(0, 100).map(({ snapshot, ...r }) => ({ ...r, summary: snapshot.summary })),
      schedules: st.schedules.filter((x) => x.orgId === org.id),
      assets: assets.slice(0, 500),
      usage: checkLimit(org.id, "reports"),
      defaultRecipient: getStore().users.find((u) => u.id === ctx.user.id)?.email ?? "",
    };
  }),
  generateReport: proc
    .input(z.object({ type: reportTypeInput, params: z.object({ lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(), name: z.string().max(120).optional(), assetId: z.string().optional(), crop: z.enum(["rice", "wheat", "maize", "sugarcane", "jute", "vegetables", "coconut", "mango", "onion"]).optional() }).default({}) }))
    .mutation(async ({ ctx, input }) => {
      const org = orgOf(ctx);
      enforceLimit(org.id, "reports", 1);
      if (input.type === "location_dd") {
        enforceLimit(org.id, "assessments", 1);
        trackUsage(org.id, "assessments");
      }
      const rec = await generateAndStore(org, actor(ctx), input.type, input.params, "manual", null);
      audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "report.generate", entity: "report", entityId: rec.id, details: rec.title });
      return rec;
    }),
  getReport: proc.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const r = wsState().reports.find((x) => x.id === input.id && x.orgId === org.id);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
    r.downloads += 1;
    return r;
  }),
  deleteReport: proc.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const st = wsState();
    const r = st.reports.find((x) => x.id === input.id && x.orgId === org.id);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
    st.reports = st.reports.filter((x) => x.id !== r.id);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "report.delete", entity: "report", entityId: r.id, details: r.title });
    return { ok: true };
  }),
  createSchedule: proc
    .input(z.object({ type: reportTypeInput.refine((t) => t !== "location_dd", "Location reports can't be scheduled"), cadence: z.enum(["weekly", "monthly"]), day: z.number().int().min(0).max(28), hourUtc: z.number().int().min(0).max(23).default(3), recipients: z.array(z.string().email()).min(1).max(20) }))
    .mutation(({ ctx, input }) => {
      const org = orgOf(ctx);
      if (input.cadence === "weekly" && input.day > 6) throw new TRPCError({ code: "BAD_REQUEST", message: "Weekly schedules need a weekday (0-6)" });
      if (input.cadence === "monthly" && input.day < 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Monthly schedules need a day between 1 and 28" });
      const sch: ReportSchedule = { id: wsId("sch"), orgId: org.id, type: input.type, cadence: input.cadence, day: input.day, hourUtc: input.hourUtc, recipients: input.recipients.map((r) => r.toLowerCase()), enabled: true, createdBy: ctx.user.id, createdAt: new Date(), lastRunAt: null, nextRunAt: nextRunAt(input.cadence, input.day, input.hourUtc), runs: 0 };
      wsState().schedules.unshift(sch);
      audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "report.schedule.create", entity: "report_schedule", entityId: sch.id, details: `${input.type} ${input.cadence} → ${input.recipients.join(", ")}` });
      return sch;
    }),
  toggleSchedule: proc.input(z.object({ id: z.string(), enabled: z.boolean() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const sch = wsState().schedules.find((x) => x.id === input.id && x.orgId === org.id);
    if (!sch) throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" });
    sch.enabled = input.enabled;
    if (input.enabled) sch.nextRunAt = nextRunAt(sch.cadence, sch.day, sch.hourUtc);
    return sch;
  }),
  deleteSchedule: proc.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const st = wsState();
    const sch = st.schedules.find((x) => x.id === input.id && x.orgId === org.id);
    if (!sch) throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" });
    st.schedules = st.schedules.filter((x) => x.id !== sch.id);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "report.schedule.delete", entity: "report_schedule", entityId: sch.id, details: sch.type });
    return { ok: true };
  }),
  runScheduleNow: proc.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const org = orgOf(ctx);
    const sch = wsState().schedules.find((x) => x.id === input.id && x.orgId === org.id);
    if (!sch) throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" });
    enforceLimit(org.id, "reports", 1);
    const keepNext = sch.nextRunAt;
    await runSchedule(sch);
    sch.nextRunAt = keepNext.getTime() > Date.now() ? keepNext : sch.nextRunAt;
    return { ok: true };
  }),

  // ─── Public: status page, support tickets ───────────────────────────
  status: publicProcedure.input(z.object({ force: z.boolean().default(false) }).optional()).query(({ input }) => statusReport(input?.force ?? false)),

  submitTicket: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(80),
        email: z.string().trim().email().max(120),
        topic: z.enum(["getting_started", "billing", "data", "api", "bug", "security", "other"]),
        subject: z.string().trim().min(4).max(140),
        message: z.string().trim().min(10).max(4000),
        website: z.string().max(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const st = wsState();
      const u = ctx.session?.user;
      const recent = st.tickets.filter((t) => t.email === input.email.toLowerCase() && Date.now() - t.at.getTime() < 60_000).length;
      if (recent >= 3) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait a minute before sending another request." });
      const t = { id: `TCK-${(1000 + st.tickets.length + 1).toString()}${Date.now().toString(36).slice(-2).toUpperCase()}`, at: new Date(), name: input.name, email: input.email.toLowerCase(), orgId: u?.orgId ?? null, userId: u?.id ?? null, topic: input.topic, subject: input.subject, message: input.message, status: "open" as const, priority: input.topic === "security" || input.topic === "bug" ? ("high" as const) : ("normal" as const) };
      st.tickets.unshift(t);
      const inbox = process.env.SUPPORT_EMAIL ?? "support@agrishield.io";
      await Promise.all([
        sendEmail(inbox, `[${t.id}] ${input.topic.replace("_", " ")} — ${input.subject}`, `<p><b>${esc(input.name)}</b> &lt;${esc(input.email)}&gt;${t.orgId ? ` · workspace ${esc(t.orgId)}` : ""}</p><p>${esc(input.message)}</p>`),
        sendEmail(input.email, `We received your request (${t.id})`, `<p>Hi ${esc(input.name.split(" ")[0] ?? input.name)},</p><p>Thanks — ticket <b>${t.id}</b> is open. We reply within ${t.priority === "high" ? "4 business hours" : "1 business day"}.</p><p>— Agri-SHIELD support</p>`),
      ]).catch(() => undefined);
      audit({ userId: u?.id ?? "anonymous", userName: input.name, action: "support.ticket", entity: "ticket", entityId: t.id, details: `${input.topic}: ${input.subject}` });
      if (t.orgId) notify(t.orgId, { kind: "system", title: `Support ticket ${t.id} opened`, body: input.subject, href: "/help#contact", severity: "info", userId: u?.id ?? null });
      return { id: t.id, priority: t.priority, at: t.at };
    }),
  myTickets: proc.query(({ ctx }) => {
    const email = getStore().users.find((u) => u.id === ctx.user.id)?.email;
    return wsState().tickets.filter((t) => t.userId === ctx.user.id || (email && t.email === email)).slice(0, 20);
  }),

  /** Nav badges: unread alert-ish notifications. */
  navBadges: proc.query(({ ctx }) => {
    if (!ctx.user.orgId) return { alerts: 0, reports: 0 };
    const s = getStore();
    const mine = s.notifications.filter((n) => n.workspaceId === ctx.user.orgId && (!n.userId || n.userId === ctx.user.id) && !n.readBy.includes(ctx.user.id));
    return { alerts: mine.filter((n) => n.kind === "alert" || n.kind === "rule").length, reports: mine.filter((n) => n.kind === "report").length };
  }),

  /** KPI helper for other modules' empty states. */
  exposureSummary: proc.query(async ({ ctx }) => {
    const org = orgOf(ctx);
    const assets = getStore().assets.filter((a) => a.workspaceId === org.id && a.status === "active");
    const m = computeMetrics(org, assets, await portfolioScores(org.id));
    return { total: m.total, exposure: fmtUsd(m.exposureUsd), atRiskPct: m.atRiskPct };
  }),
});
