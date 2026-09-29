/**
 * Workspace metering & plan limits — the single place every module reports
 * billable usage to and checks quotas against.
 *
 *   trackUsage(orgId, "assessments")          → counts one unit, returns the new limit state
 *   checkLimit(orgId, "reports")              → { ok, used, limit, plan, … } without counting
 *   enforceLimit(orgId, "apiCalls", n)        → throws a TRPCError (FORBIDDEN) when the quota is exhausted
 *   PLAN_LIMITS                               → quotas per subscription plan
 *
 * Usage lives on `org.usage` (store) and rolls over on the 1st of each month
 * (UTC). A per-day ledger (since server start) backs the usage charts.
 */
import { TRPCError } from "@trpc/server";
import type { SubscriptionPlan } from "@agri-shield/types";
import { getStore, nextId, type OrgRecord, type WorkspaceUsage } from "../data/store";
import { notifyWorkspace } from "./workspace-notifications";
import { restore, track } from "../persist";

export type UsageKind = "assessments" | "apiCalls" | "reports" | "messages";
export type LimitKind = UsageKind | "seats" | "assets";

export const USAGE_KINDS: UsageKind[] = ["assessments", "apiCalls", "reports", "messages"];

/** null = unlimited */
export type PlanLimits = Record<LimitKind, number | null>;

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: { assessments: 250, apiCalls: 1_000, reports: 5, messages: 100, seats: 2, assets: 25 },
  farmer_pro: { assessments: 500, apiCalls: 0, reports: 10, messages: 200, seats: 1, assets: 50 },
  gov_basic: { assessments: 10_000, apiCalls: 100_000, reports: 50, messages: 5_000, seats: 10, assets: 1_000 },
  supply_chain: { assessments: 15_000, apiCalls: 250_000, reports: 100, messages: 10_000, seats: 15, assets: 2_000 },
  business: { assessments: 25_000, apiCalls: 500_000, reports: 200, messages: 20_000, seats: 10, assets: 2_500 },
  gov_enterprise: { assessments: null, apiCalls: null, reports: null, messages: null, seats: null, assets: null },
  enterprise: { assessments: null, apiCalls: null, reports: null, messages: null, seats: null, assets: null },
};

export const PLAN_LABEL: Record<SubscriptionPlan, string> = {
  free: "Free",
  farmer_pro: "Farmer Pro",
  gov_basic: "Government Basic",
  gov_enterprise: "Government Enterprise",
  supply_chain: "Supply Chain",
  business: "Business",
  enterprise: "Enterprise",
};

/** List price per month (USD) — used for invoices; mirrors the billing router's MRR table. */
export const PLAN_PRICE_USD: Record<SubscriptionPlan, number> = { free: 0, farmer_pro: 3, gov_basic: 299, gov_enterprise: 2400, supply_chain: 499, business: 1490, enterprise: 4900 };

export const KIND_LABEL: Record<LimitKind, string> = {
  assessments: "Location assessments",
  apiCalls: "API calls",
  reports: "Reports generated",
  messages: "Alert messages sent",
  seats: "Team seats",
  assets: "Monitored assets",
};

export interface LimitState {
  ok: boolean;
  used: number;
  /** null = unlimited */
  limit: number | null;
  remaining: number | null;
  /** 0-100 (0 when unlimited) */
  pct: number;
  plan: SubscriptionPlan;
  kind: LimitKind;
}

// ─── Pure helpers (unit-tested) ───────────────────────────────────────────

export function monthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Has the metering period rolled into a new month? The period is identified
 * by the month its start falls in, judged a few days in so a start stamped at
 * local midnight (e.g. 1 Sep 00:00 IST = 31 Aug 18:30 UTC) still counts as September.
 */
export function needsRollover(periodStart: Date, now = new Date()): boolean {
  const p = new Date(new Date(periodStart).getTime() + 3 * 86_400_000);
  return p.getUTCFullYear() !== now.getUTCFullYear() || p.getUTCMonth() !== now.getUTCMonth();
}

export function evaluateLimit(plan: SubscriptionPlan, kind: LimitKind, used: number, adding = 0): LimitState {
  const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free)[kind];
  if (limit === null) return { ok: true, used, limit: null, remaining: null, pct: 0, plan, kind };
  return {
    ok: used + adding <= limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    pct: limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 1000) / 10),
    plan,
    kind,
  };
}

/** The plan that is actually in force — an expired trial falls back to Free. */
export function effectivePlan(org: Pick<OrgRecord, "planTier" | "trialEndsAt">, subscriptionStatus?: string | null, now = new Date(), subscriptionPeriodEnd?: Date | null): SubscriptionPlan {
  if (!org.trialEndsAt || (subscriptionStatus ?? "trialing") !== "trialing") return org.planTier;
  // A later checkout may have started a new trial period on the subscription itself
  const ends = Math.max(new Date(org.trialEndsAt).getTime(), subscriptionPeriodEnd ? new Date(subscriptionPeriodEnd).getTime() : 0);
  return ends < now.getTime() ? "free" : org.planTier;
}

// ─── Store-backed API ─────────────────────────────────────────────────────

const g = globalThis as unknown as { __agriUsageLedger?: Map<string, Map<string, Record<UsageKind, number>>>; __agriUsageWarned?: Set<string> };
const USAGE_VERSION = 1;
const savedUsage =
  g.__agriUsageLedger && g.__agriUsageWarned
    ? undefined
    : restore<{ ledger: Map<string, Map<string, Record<UsageKind, number>>>; warned: Set<string> }>("usage", USAGE_VERSION, (v) => {
        const x = v as { ledger?: unknown; warned?: unknown };
        return x.ledger instanceof Map && x.warned instanceof Set;
      });
const ledger = (g.__agriUsageLedger ??= savedUsage?.ledger ?? new Map());
const warned = (g.__agriUsageWarned ??= savedUsage?.warned ?? new Set());
track("usage", USAGE_VERSION, () => (g.__agriUsageLedger ? { ledger: g.__agriUsageLedger, warned: g.__agriUsageWarned ?? new Set() } : undefined));

function orgOf(orgId: string): OrgRecord | undefined {
  return getStore().orgs.find((o) => o.id === orgId);
}

export function planOf(orgId: string): SubscriptionPlan {
  const org = orgOf(orgId);
  if (!org) return "free";
  const sub = getStore().subscriptions.find((s) => s.orgId === orgId);
  return effectivePlan(org, sub?.status ?? null, new Date(), sub?.currentPeriodEnd ?? null);
}

/** Current usage record, rolled over to this month if needed. */
export function usageOf(orgId: string, now = new Date()): WorkspaceUsage {
  const org = orgOf(orgId);
  const fresh: WorkspaceUsage = { periodStart: monthStart(now), assessments: 0, apiCalls: 0, reports: 0, messages: 0 };
  if (!org) return fresh;
  if (!org.usage || needsRollover(org.usage.periodStart, now)) org.usage = fresh;
  return org.usage;
}

function countOf(orgId: string, kind: LimitKind): number {
  const s = getStore();
  if (kind === "seats") return s.users.filter((u) => u.orgId === orgId && u.status !== "suspended").length;
  if (kind === "assets") return s.assets.filter((a) => a.workspaceId === orgId && a.status === "active").length;
  return usageOf(orgId)[kind];
}

export function checkLimit(orgId: string, kind: LimitKind, adding = 0): LimitState {
  return evaluateLimit(planOf(orgId), kind, countOf(orgId, kind), adding);
}

/** Every meter for the workspace (settings → Plan & billing). */
export function usageSummary(orgId: string) {
  const plan = planOf(orgId);
  const usage = usageOf(orgId);
  const start = monthStart(new Date(new Date(usage.periodStart).getTime() + 3 * 86_400_000));
  return {
    plan,
    planLabel: PLAN_LABEL[plan],
    periodStart: start,
    periodEnd: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)),
    meters: (["assessments", "apiCalls", "reports", "messages", "seats", "assets"] as LimitKind[]).map((k) => ({ ...checkLimit(orgId, k), label: KIND_LABEL[k] })),
  };
}

function bumpLedger(orgId: string, kind: UsageKind, n: number) {
  const day = new Date().toISOString().slice(0, 10);
  let byDay = ledger.get(orgId);
  if (!byDay) ledger.set(orgId, (byDay = new Map()));
  const row = byDay.get(day) ?? { assessments: 0, apiCalls: 0, reports: 0, messages: 0 };
  row[kind] += n;
  byDay.set(day, row);
}

/** Daily usage recorded since the server started (honest: not persisted across restarts). */
export function usageDaily(orgId: string): { date: string; assessments: number; apiCalls: number; reports: number; messages: number }[] {
  const byDay = ledger.get(orgId);
  if (!byDay) return [];
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, r]) => ({ date, ...r }));
}

function warnOnce(orgId: string, state: LimitState) {
  if (state.limit === null) return;
  const level = state.used >= state.limit ? 100 : state.pct >= 80 ? 80 : 0;
  if (!level) return;
  const key = `${orgId}:${state.kind}:${level}:${usageOf(orgId).periodStart.toISOString().slice(0, 7)}`;
  if (warned.has(key)) return;
  warned.add(key);
  notifyWorkspace({
    workspaceId: orgId,
    userId: null,
    kind: "billing",
    title: level === 100 ? `${KIND_LABEL[state.kind]} limit reached` : `${KIND_LABEL[state.kind]} at ${Math.round(state.pct)}% of plan`,
    body: `${state.used.toLocaleString("en-US")} of ${state.limit.toLocaleString("en-US")} used this month on the ${PLAN_LABEL[state.plan]} plan.${level === 100 ? " Upgrade to keep going." : ""}`,
    href: "/app/settings/billing",
    severity: level === 100 ? "critical" : "warning",
  });
}

/**
 * Record `n` units of billable usage. Never throws (metering must not break
 * the feature); call `enforceLimit` first when the action should be blocked.
 */
export function trackUsage(orgId: string | null | undefined, kind: UsageKind, n = 1): LimitState | null {
  if (!orgId || n <= 0) return null;
  const org = orgOf(orgId);
  if (!org) return null;
  const usage = usageOf(orgId);
  usage[kind] += n;
  bumpLedger(orgId, kind, n);
  const state = checkLimit(orgId, kind);
  warnOnce(orgId, state);
  return state;
}

/** Throw FORBIDDEN with an upgrade hint when `n` more units would exceed the plan. */
export function enforceLimit(orgId: string | null | undefined, kind: LimitKind, n = 1): LimitState | null {
  if (!orgId) return null;
  const state = checkLimit(orgId, kind, n);
  if (!state.ok) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${KIND_LABEL[kind]} limit reached (${state.used.toLocaleString("en-US")}/${state.limit?.toLocaleString("en-US")}) on the ${PLAN_LABEL[state.plan]} plan — upgrade in Settings → Plan & billing.`,
    });
  }
  return state;
}
