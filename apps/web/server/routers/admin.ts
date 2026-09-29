/**
 * adminRouter — platform administration (spec §4.7). Every procedure requires
 * the "access_admin_panel" permission (platform_admin); every mutation is audited.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { UserRole } from "@agri-shield/types";
import { permitted, router } from "../trpc";
import { audit, getStore, resetStore, DAY, type ScenarioMode } from "../data/store";
import { ensureLiveRisk, ensureLiveRiskAwait, invalidateLiveRisk, liveRiskStatus } from "../live/district-risk";
import { getModelMetrics, mlHealth, ML_API_URL } from "../ml-client";
import { outbox } from "../notify/channels";
import { checkSources, summarize } from "../health/sources";
import { jobOverview, jobRuns, notificationQueue, satelliteStatus, schedulerState, triggerJob, JOB_NAMES, type JobName } from "../jobs";
import { smsLog, twilioSignature } from "../sms/handler";
import { normalizePhone } from "../sms/commands";
import { requestFlush, restore, track } from "../persist";

const proc = permitted("access_admin_panel");

const ROLES = ["farmer", "field_officer", "regional_admin", "national_admin", "supply_chain_analyst", "supply_chain_admin", "enterprise_analyst", "enterprise_admin", "platform_admin"] as const satisfies readonly UserRole[];
const SCENARIOS = ["live", "monsoon_surge", "cyclone_landfall", "dry_season_salinity"] as const satisfies readonly ScenarioMode[];

type Actor = { id: string; name: string };
const actor = (ctx: { user: { id: string; name?: string | null } }): Actor => ({ id: ctx.user.id, name: ctx.user.name ?? ctx.user.id });

function log(a: Actor, action: string, entity: string, entityId: string, details: string) {
  audit({ userId: a.id, userName: a.name, action, entity, entityId, details });
}

const g = globalThis as unknown as { __agriOrgReviews?: Map<string, { decision: "verified" | "rejected"; note: string | null; by: string; at: Date }> };
const ORG_REVIEWS_VERSION = 1;
track("admin.org-reviews", ORG_REVIEWS_VERSION, () => g.__agriOrgReviews);
const orgReviews = (g.__agriOrgReviews ??=
  restore<Map<string, { decision: "verified" | "rejected"; note: string | null; by: string; at: Date }>>("admin.org-reviews", ORG_REVIEWS_VERSION, (v) => v instanceof Map) ?? new Map());

/** PSI drift bands (industry convention). */
export function driftBand(psi: number | undefined | null): "stable" | "moderate" | "significant" | "unknown" {
  if (psi == null) return "unknown";
  return psi < 0.1 ? "stable" : psi < 0.25 ? "moderate" : "significant";
}

function districtSnapshot() {
  return getStore().districts.map((d) => ({
    id: d.id,
    name: d.name,
    country: d.country,
    floodRisk: d.floodRisk,
    floodProb72h: d.floodProb72h,
    salinityRisk: d.salinityRisk,
    ecCurrent: d.ecCurrent,
    riskLevel: d.riskLevel,
    rainfall72hMm: d.rainfall72hMm,
    liveSource: d.liveSource,
  }));
}

export const adminRouter = router({
  ping: proc.query(() => ({ ok: true })),

  // ─── Overview ──────────────────────────────────────────────────────────
  overview: proc.query(() => {
    const s = getStore();
    const now = Date.now();
    const activeSubs = s.subscriptions.filter((x) => x.status === "active");
    const mrr = activeSubs.reduce((n, x) => n + x.mrrUsd, 0);
    const days = Array.from({ length: 30 }, (_, i) => {
      const start = new Date(now - (29 - i) * DAY);
      start.setUTCHours(0, 0, 0, 0);
      return { date: start.toISOString().slice(0, 10), start: start.getTime() };
    });
    const alertsPerDay = days.map(({ date, start }) => {
      const list = s.alerts.filter((a) => a.createdAt.getTime() >= start && a.createdAt.getTime() < start + DAY);
      return {
        date,
        model: list.filter((a) => a.source === "model").length,
        manual: list.filter((a) => a.source === "manual").length,
        hazard: list.filter((a) => a.source === "gdacs" || a.source === "eonet").length,
        deliveries: list.reduce((n, a) => n + a.deliveries.sent, 0),
      };
    });
    const byRole = ROLES.map((role) => ({ role, count: s.users.filter((u) => u.role === role).length }));
    const jobs = jobOverview();
    return {
      users: {
        total: s.users.length,
        active24h: s.users.filter((u) => now - u.lastActive.getTime() < DAY).length,
        active7d: s.users.filter((u) => now - u.lastActive.getTime() < 7 * DAY).length,
        suspended: s.users.filter((u) => u.status === "suspended").length,
        byRole,
      },
      farmers: s.farmers.length,
      fields: s.fields.length,
      hectares: Math.round(s.fields.reduce((n, f) => n + f.areaHa, 0) * 10) / 10,
      orgs: { total: s.orgs.length, pending: s.orgs.filter((o) => !o.verified && orgReviews.get(o.id)?.decision !== "rejected").length },
      billing: { mrr, arr: mrr * 12, paying: activeSubs.filter((x) => x.mrrUsd > 0).length, pastDue: s.subscriptions.filter((x) => x.status === "past_due").length },
      alerts: {
        active: s.alerts.filter((a) => a.isActive).length,
        last24h: s.alerts.filter((a) => now - a.createdAt.getTime() < DAY).length,
        last30d: alertsPerDay.reduce((n, d) => n + d.model + d.manual + d.hazard, 0),
        deliveries30d: alertsPerDay.reduce((n, d) => n + d.deliveries, 0),
        perDay: alertsPerDay,
      },
      messaging: {
        outbox: outbox.length,
        failed: outbox.filter((m) => m.status === "failed").length,
        smsInbound: smsLog.length,
      },
      districts: { total: s.districts.length, live: s.districts.filter((d) => d.liveSource === "open-meteo").length, critical: s.districts.filter((d) => d.riskLevel === "critical" || d.riskLevel === "high").length },
      liveRisk: liveRiskStatus(),
      scenario: s.scenario,
      scheduler: schedulerState(),
      jobs: jobs.map((j) => ({ name: j.name, label: j.label, running: j.running, lastStatus: j.lastRun?.status ?? null, lastRunAt: j.lastRun?.finishedAt ?? null, nextRunAt: j.nextRunAt })),
      seededAt: s.seededAt,
      recentAudit: s.audit.slice(0, 8),
    };
  }),

  // ─── Users ─────────────────────────────────────────────────────────────
  users: router({
    list: proc
      .input(
        z.object({
          q: z.string().max(80).optional(),
          role: z.enum(ROLES).optional(),
          status: z.enum(["active", "suspended", "pending_verification"]).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
      )
      .query(({ input }) => {
        const s = getStore();
        const q = input.q?.toLowerCase().trim();
        const rows = s.users.filter(
          (u) =>
            (!input.role || u.role === input.role) &&
            (!input.status || u.status === input.status) &&
            (!q || u.name.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.phone?.includes(q) || u.id.includes(q))
        );
        const orgName = new Map(s.orgs.map((o) => [o.id, o.shortName]));
        return {
          total: rows.length,
          rows: rows
            .sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime())
            .slice(input.offset, input.offset + input.limit)
            .map(({ password: _p, ...u }) => ({
              ...u,
              orgName: u.orgId ? orgName.get(u.orgId) ?? u.orgId : null,
              farmerId: s.farmers.find((f) => f.userId === u.id)?.id ?? null,
              subscription: s.subscriptions.find((x) => x.userId === u.id) ?? null,
            })),
        };
      }),

    update: proc
      .input(z.object({ id: z.string().max(64), role: z.enum(ROLES).optional(), language: z.enum(["en", "hi", "bn", "vi", "fil", "id", "ta", "si"]).optional(), name: z.string().min(2).max(120).optional() }))
      .mutation(({ ctx, input }) => {
        const s = getStore();
        const u = s.users.find((x) => x.id === input.id);
        if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        if (u.id === ctx.user.id && input.role && input.role !== "platform_admin") throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove your own admin role" });
        const changes: string[] = [];
        if (input.role && input.role !== u.role) {
          changes.push(`role ${u.role} → ${input.role}`);
          u.role = input.role;
        }
        if (input.language && input.language !== u.language) {
          changes.push(`language ${u.language} → ${input.language}`);
          u.language = input.language;
        }
        if (input.name && input.name !== u.name) {
          changes.push(`name "${u.name}" → "${input.name}"`);
          u.name = input.name;
        }
        if (changes.length) log(actor(ctx), "user.update", "user", u.id, changes.join("; "));
        return { ok: true, changes };
      }),

    setStatus: proc
      .input(z.object({ id: z.string().max(64), status: z.enum(["active", "suspended"]), reason: z.string().max(300).optional() }))
      .mutation(({ ctx, input }) => {
        const u = getStore().users.find((x) => x.id === input.id);
        if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        if (u.id === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot suspend yourself" });
        const prev = u.status;
        u.status = input.status;
        log(actor(ctx), input.status === "suspended" ? "user.suspend" : "user.reactivate", "user", u.id, `${prev} → ${input.status}${input.reason ? ` — ${input.reason}` : ""}`);
        return { ok: true, status: u.status };
      }),
  }),

  // ─── Organizations ─────────────────────────────────────────────────────
  orgs: router({
    list: proc.query(() => {
      const s = getStore();
      return s.orgs
        .map((o) => {
          const review = orgReviews.get(o.id) ?? null;
          return {
            ...o,
            state: o.verified ? "verified" : review?.decision === "rejected" ? "rejected" : "pending",
            review,
            members: s.users.filter((u) => u.orgId === o.id).map((u) => ({ id: u.id, name: u.name, role: u.role, email: u.email, status: u.status })),
            districts: s.districts.filter((d) => d.orgId === o.id).length,
            nodes: s.nodes.filter((n) => n.orgId === o.id).length,
            subscription: s.subscriptions.find((x) => x.orgId === o.id) ?? null,
            history: s.audit.filter((a) => a.entityId === o.id).slice(0, 10),
          };
        })
        .sort((a, b) => (a.state === "pending" ? -1 : 0) - (b.state === "pending" ? -1 : 0) || b.createdAt.getTime() - a.createdAt.getTime());
    }),

    review: proc
      .input(z.object({ id: z.string().max(64), decision: z.enum(["verify", "reject", "revoke"]), note: z.string().max(500).optional() }))
      .mutation(({ ctx, input }) => {
        const s = getStore();
        const o = s.orgs.find((x) => x.id === input.id);
        if (!o) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
        const sub = s.subscriptions.find((x) => x.orgId === o.id);
        const PLAN_MRR = { free: 0, farmer_pro: 3, gov_basic: 299, gov_enterprise: 2400, supply_chain: 499, business: 1490, enterprise: 4900 } as const;
        if (input.decision === "verify") {
          o.verified = true;
          orgReviews.set(o.id, { decision: "verified", note: input.note ?? null, by: ctx.user.name ?? ctx.user.id, at: new Date() });
          if (sub && sub.status === "trialing") {
            sub.status = "active";
            sub.mrrUsd = PLAN_MRR[sub.plan];
          }
          for (const u of s.users) if (u.orgId === o.id && u.status === "pending_verification") u.status = "active";
          log(actor(ctx), "org.verify", "organization", o.id, `${o.name} verified${input.note ? ` — ${input.note}` : ""}`);
        } else {
          o.verified = false;
          orgReviews.set(o.id, { decision: "rejected", note: input.note ?? null, by: ctx.user.name ?? ctx.user.id, at: new Date() });
          if (sub) {
            sub.status = "cancelled";
            sub.mrrUsd = 0;
          }
          log(actor(ctx), input.decision === "revoke" ? "org.revoke" : "org.reject", "organization", o.id, `${o.name} ${input.decision === "revoke" ? "verification revoked" : "rejected"}${input.note ? ` — ${input.note}` : ""}`);
        }
        return { ok: true, verified: o.verified };
      }),
  }),

  // ─── Models ────────────────────────────────────────────────────────────
  models: proc.query(async () => {
    const [metrics, health] = await Promise.all([getModelMetrics(), mlHealth()]);
    const s = getStore();
    const labelled = s.farmerActions.filter((a) => a.cropSavedPct != null);
    return {
      source: metrics.source,
      mlApi: { url: ML_API_URL, ...health },
      thresholds: { psiModerate: 0.1, psiSignificant: 0.25, minAuc: 0.8 },
      models: metrics.models.map((m) => ({ ...m, drift: driftBand(m.drift_psi) })),
      feedback: {
        actions: s.farmerActions.length,
        labelled: labelled.length,
        meanCropSavedPct: labelled.length ? Math.round((labelled.reduce((n, a) => n + (a.cropSavedPct ?? 0), 0) / labelled.length) * 10) / 10 : null,
      },
      retrainRuns: jobRuns({ job: "model-retrain", limit: 10 }),
    };
  }),

  retrain: proc.mutation(async ({ ctx }) => {
    log(actor(ctx), "model.retrain", "ml_model", "all", "Manual retrain requested");
    const run = await triggerJob("model-retrain", "manual", ctx.user.name ?? ctx.user.id);
    return run;
  }),

  // ─── Data sources ──────────────────────────────────────────────────────
  sources: proc.input(z.object({ force: z.boolean().default(false) }).optional()).query(async ({ input }) => {
    const sources = await checkSources(input?.force ?? false);
    const sat = satelliteStatus();
    return {
      summary: summarize(sources),
      sources,
      liveRisk: liveRiskStatus(),
      liveDistricts: getStore().districts.filter((d) => d.liveSource === "open-meteo").length,
      totalDistricts: getStore().districts.length,
      satellite: {
        lastRunAt: sat.lastRunAt,
        lastSuccessAt: sat.lastSuccessAt,
        latestComposite: sat.latestComposite,
        districts: sat.districts.map((d) => ({ districtId: d.districtId, name: d.name, tile: d.tile, latest: d.latest, changePct: d.changePct, stressed: d.stressed, fieldsUpdated: d.fieldsUpdated, error: d.error, series: d.series })),
      },
    };
  }),

  // ─── Jobs ──────────────────────────────────────────────────────────────
  jobs: proc.input(z.object({ job: z.enum(JOB_NAMES as [JobName, ...JobName[]]).optional(), limit: z.number().int().min(1).max(300).default(60) }).optional()).query(async ({ input }) => {
    let bull: Record<string, Record<string, number>> | null = null;
    if (schedulerState().mode === "bullmq") {
      try {
        bull = await (await import("../workers/queues")).bullStats();
      } catch {
        bull = null;
      }
    }
    return { jobs: jobOverview(), runs: jobRuns({ job: input?.job, limit: input?.limit ?? 60 }), scheduler: schedulerState(), queue: notificationQueue(), bull };
  }),

  runJob: proc.input(z.object({ job: z.enum(JOB_NAMES as [JobName, ...JobName[]]) })).mutation(async ({ ctx, input }) => {
    log(actor(ctx), "job.run", "job", input.job, `Manual run of ${input.job}`);
    const run = triggerJob(input.job, "manual", ctx.user.name ?? ctx.user.id);
    const done = await Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), 20_000))]);
    return done ?? { job: input.job, status: "running" as const, summary: "Still running — watch the history table" };
  }),

  // ─── Audit ─────────────────────────────────────────────────────────────
  audit: proc
    .input(
      z.object({
        q: z.string().max(80).optional(),
        action: z.string().max(40).optional(),
        entity: z.string().max(40).optional(),
        userId: z.string().max(64).optional(),
        sinceHours: z.number().int().min(1).max(24 * 365).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(({ input }) => {
      const s = getStore();
      const q = input.q?.toLowerCase();
      const since = input.sinceHours ? Date.now() - input.sinceHours * 3_600_000 : 0;
      const rows = s.audit.filter(
        (a) =>
          (!input.action || a.action.startsWith(input.action)) &&
          (!input.entity || a.entity === input.entity) &&
          (!input.userId || a.userId === input.userId) &&
          a.at.getTime() >= since &&
          (!q || a.details.toLowerCase().includes(q) || a.userName.toLowerCase().includes(q) || a.entityId.toLowerCase().includes(q))
      );
      return {
        total: rows.length,
        rows: rows.slice(0, input.limit),
        actions: [...new Set(s.audit.map((a) => a.action))].sort(),
        entities: [...new Set(s.audit.map((a) => a.entity))].sort(),
      };
    }),

  alertAudit: proc
    .input(
      z.object({
        type: z.enum(["flood", "salinity", "drought", "storm", "frost"]).optional(),
        severity: z.enum(["watch", "warning", "emergency"]).optional(),
        source: z.enum(["model", "manual", "gdacs", "eonet"]).optional(),
        districtId: z.string().max(64).optional(),
        activeOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(300).default(100),
      })
    )
    .query(({ input }) => {
      const s = getStore();
      const users = new Map(s.users.map((u) => [u.id, u.name]));
      const districts = new Map(s.districts.map((d) => [d.id, `${d.name}, ${d.country}`]));
      const rows = s.alerts.filter(
        (a) =>
          (!input.type || a.alertType === input.type) &&
          (!input.severity || a.severity === input.severity) &&
          (!input.source || a.source === input.source) &&
          (!input.districtId || a.districtId === input.districtId) &&
          (!input.activeOnly || a.isActive)
      );
      const totals = rows.reduce((t, a) => ({ sent: t.sent + a.deliveries.sent, delivered: t.delivered + a.deliveries.delivered, read: t.read + a.deliveries.read, actioned: t.actioned + a.deliveries.actioned }), { sent: 0, delivered: 0, read: 0, actioned: 0 });
      return {
        total: rows.length,
        totals,
        districts: s.districts.map((d) => ({ id: d.id, name: d.name, country: d.country })),
        rows: rows.slice(0, input.limit).map((a) => ({
          id: a.id,
          alertType: a.alertType,
          severity: a.severity,
          title: a.title,
          district: districts.get(a.districtId) ?? a.districtId,
          source: a.source,
          createdBy: a.createdBy === "system" ? "system (climate-scan)" : users.get(a.createdBy) ?? a.createdBy,
          createdAt: a.createdAt,
          validUntil: a.validUntil,
          isActive: a.isActive,
          channels: a.channels,
          deliveries: a.deliveries,
          probability: a.predictedImpact.probability,
        })),
      };
    }),

  // ─── Billing ───────────────────────────────────────────────────────────
  billing: proc.query(() => {
    const s = getStore();
    const subs = s.subscriptions;
    const plans = ["free", "farmer_pro", "gov_basic", "gov_enterprise", "supply_chain"] as const;
    const byPlan = plans.map((plan) => {
      const list = subs.filter((x) => x.plan === plan);
      return { plan, total: list.length, active: list.filter((x) => x.status === "active").length, mrr: list.filter((x) => x.status === "active").reduce((n, x) => n + x.mrrUsd, 0) };
    });
    const providers = ["stripe", "razorpay", "paymongo", "none"] as const;
    const byProvider = providers.map((p) => ({ provider: p, count: subs.filter((x) => x.provider === p).length, mrr: subs.filter((x) => x.provider === p && x.status === "active").reduce((n, x) => n + x.mrrUsd, 0) }));
    const name = (x: (typeof subs)[number]) => (x.userId ? s.users.find((u) => u.id === x.userId)?.name : s.orgs.find((o) => o.id === x.orgId)?.name) ?? x.userId ?? x.orgId ?? "—";
    const mrr = byPlan.reduce((n, p) => n + p.mrr, 0);
    const now = Date.now();
    return {
      mrr,
      arr: mrr * 12,
      arpa: Math.round((mrr / Math.max(1, subs.filter((x) => x.status === "active" && x.mrrUsd > 0).length)) * 100) / 100,
      byPlan,
      byProvider,
      byStatus: (["active", "trialing", "past_due", "cancelled"] as const).map((st) => ({ status: st, count: subs.filter((x) => x.status === st).length })),
      pastDue: subs.filter((x) => x.status === "past_due").map((x) => ({ ...x, customer: name(x), atRiskMrr: x.mrrUsd })),
      trialing: subs.filter((x) => x.status === "trialing").map((x) => ({ ...x, customer: name(x) })),
      renewals7d: subs.filter((x) => x.status === "active" && x.currentPeriodEnd.getTime() - now < 7 * DAY && x.mrrUsd > 0).map((x) => ({ ...x, customer: name(x) })),
    };
  }),

  // ─── Feature flags ─────────────────────────────────────────────────────
  flags: proc.query(() => getStore().flags),

  updateFlag: proc
    .input(z.object({ key: z.string().max(60), enabled: z.boolean().optional(), rolloutPct: z.number().int().min(0).max(100).optional() }))
    .mutation(({ ctx, input }) => {
      const f = getStore().flags.find((x) => x.key === input.key);
      if (!f) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown flag" });
      const before = `${f.enabled ? "on" : "off"} ${f.rolloutPct}%`;
      if (input.enabled !== undefined) f.enabled = input.enabled;
      if (input.rolloutPct !== undefined) f.rolloutPct = input.rolloutPct;
      log(actor(ctx), "flag.update", "feature_flag", f.key, `${before} → ${f.enabled ? "on" : "off"} ${f.rolloutPct}%`);
      return f;
    }),

  // ─── Notification outbox ───────────────────────────────────────────────
  outbox: proc
    .input(z.object({ channel: z.enum(["sms", "whatsapp", "email", "app"]).optional(), status: z.enum(["sent", "simulated", "failed"]).optional(), limit: z.number().int().min(1).max(500).default(150) }).optional())
    .query(({ input }) => {
      const rows = outbox.filter((m) => (!input?.channel || m.channel === input.channel) && (!input?.status || m.status === input.status));
      const count = (k: "channel" | "status") => Object.entries(outbox.reduce<Record<string, number>>((acc, m) => ((acc[m[k]] = (acc[m[k]] ?? 0) + 1), acc), {})).map(([key, n]) => ({ key, n }));
      return {
        total: rows.length,
        rows: rows.slice(0, input?.limit ?? 150),
        byChannel: count("channel"),
        byStatus: count("status"),
        providers: {
          twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
          whatsapp: !!process.env.TWILIO_WHATSAPP_NUMBER,
          resend: !!process.env.RESEND_API_KEY,
        },
        queue: notificationQueue(),
        sms: smsLog.slice(0, 50),
      };
    }),

  // ─── Scenario control ──────────────────────────────────────────────────
  scenario: proc.query(() => ({ scenario: getStore().scenario, districts: districtSnapshot(), liveRisk: liveRiskStatus() })),

  setScenario: proc
    .input(z.object({ mode: z.enum(SCENARIOS), intensity: z.number().min(0).max(1).default(0.7), runScan: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const s = getStore();
      const before = districtSnapshot();
      const prev = { ...s.scenario };
      s.scenario = { mode: input.mode, intensity: input.intensity, setAt: new Date(), setBy: ctx.user.name ?? ctx.user.id };
      log(actor(ctx), "scenario.set", "scenario", input.mode, `${prev.mode}@${prev.intensity} → ${input.mode}@${input.intensity}${input.runScan ? " + climate scan" : ""}`);
      invalidateLiveRisk();
      await ensureLiveRiskAwait(25_000);
      const after = districtSnapshot();
      let scan: { id: string; status: string; summary: string } | null = null;
      if (input.runScan) {
        const run = await Promise.race([triggerJob("climate-scan", "scenario", ctx.user.name ?? ctx.user.id), new Promise<null>((r) => setTimeout(() => r(null), 25_000))]);
        scan = run ? { id: run.id, status: run.status, summary: run.summary } : { id: "pending", status: "running", summary: "Climate scan still running" };
      }
      return { scenario: s.scenario, before, after, scan };
    }),

  resetDemo: proc.input(z.object({ confirm: z.literal("RESET") })).mutation(({ ctx }) => {
    const prev = getStore();
    const counts = { alerts: prev.alerts.length, audit: prev.audit.length };
    resetStore();
    requestFlush(); // save the fresh seed promptly so a restart does not bring the old data back
    invalidateLiveRisk();
    ensureLiveRisk();
    log(actor(ctx), "demo.reset", "store", "all", `Demo data reset (had ${counts.alerts} alerts, ${counts.audit} audit entries)`);
    return { ok: true, seededAt: getStore().seededAt };
  }),

  // ─── SMS simulator ─────────────────────────────────────────────────────
  smsContacts: proc.query(() => {
    const s = getStore();
    return s.farmers
      .map((f) => {
        const u = s.users.find((x) => x.id === f.userId);
        const d = s.districts.find((x) => x.id === f.districtId);
        return u?.phone ? { farmerId: f.id, name: u.name, phone: normalizePhone(u.phone), language: u.language, district: d?.name ?? f.districtId, country: d?.countryName ?? f.country, status: u.status } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }),

  /** Returns a valid X-Twilio-Signature for the simulator when TWILIO_AUTH_TOKEN is configured. */
  smsSign: proc.input(z.object({ url: z.string().url().max(300), params: z.record(z.string().max(40), z.string().max(480)) })).mutation(({ ctx, input }) => {
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!token) return { signature: null as string | null, signing: false };
    log(actor(ctx), "sms.simulate", "sms", input.params.From ?? "?", "Signed simulator request");
    return { signature: twilioSignature(token, input.url, input.params), signing: true };
  }),

  smsLog: proc.query(() => smsLog.slice(0, 100)),
});
