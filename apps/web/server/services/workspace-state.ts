/**
 * Side-car state for the SaaS platform layer (the shared store keeps the core
 * records; this module keeps what only the workspace platform needs):
 *   invites · onboarding progress · product-tour state · generated reports ·
 *   report schedules · support tickets · security preferences · deletion
 *   requests · plan-change history (for invoices)
 *
 * Pure helpers (token lifecycle, schedule maths, onboarding derivation, role
 * catalogue) are exported for unit tests. Kept on globalThis so Next.js hot
 * reload doesn't drop it.
 */
import { randomBytes } from "node:crypto";
import type { Industry, SubscriptionPlan, UserRole } from "@agri-shield/types";
import { getStore, type OrgRecord } from "../data/store";

// ─── Types ────────────────────────────────────────────────────────────────

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InviteRecord {
  id: string;
  token: string;
  orgId: string;
  email: string;
  role: UserRole;
  invitedBy: string;
  invitedByName: string;
  createdAt: Date;
  expiresAt: Date;
  status: Exclude<InviteStatus, "expired">;
  acceptedAt: Date | null;
  acceptedUserId: string | null;
}

export type OnboardingStep = "add_asset" | "invite_teammate" | "create_rule" | "generate_report" | "connect_api";

export interface OnboardingRecord {
  completed: Partial<Record<OnboardingStep, Date>>;
  dismissed: boolean;
  startedAt: Date;
}

export type ReportType = "portfolio_summary" | "location_dd" | "physical_risk" | "weekly_digest" | "board_pack";

export interface ReportSection {
  heading: string;
  paragraphs?: string[];
  kpis?: { label: string; value: string; hint?: string }[];
  table?: { columns: string[]; rows: (string | number)[][] };
  bullets?: string[];
}

export interface ReportSnapshot {
  type: ReportType;
  title: string;
  subtitle: string;
  orgName: string;
  generatedAt: string;
  generatedBy: string;
  summary: string;
  sections: ReportSection[];
  sources: string[];
}

export interface ReportRecord {
  id: string;
  orgId: string;
  type: ReportType;
  title: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  trigger: "manual" | "schedule";
  scheduleId: string | null;
  params: Record<string, unknown>;
  snapshot: ReportSnapshot;
  pages: number;
  downloads: number;
}

export type Cadence = "weekly" | "monthly";

export interface ReportSchedule {
  id: string;
  orgId: string;
  type: ReportType;
  cadence: Cadence;
  /** weekly: 0-6 (Sun-Sat); monthly: 1-28 */
  day: number;
  hourUtc: number;
  recipients: string[];
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  lastRunAt: Date | null;
  nextRunAt: Date;
  runs: number;
}

export interface SupportTicket {
  id: string;
  at: Date;
  name: string;
  email: string;
  orgId: string | null;
  userId: string | null;
  topic: "getting_started" | "billing" | "data" | "api" | "bug" | "security" | "other";
  subject: string;
  message: string;
  status: "open" | "answered" | "closed";
  priority: "normal" | "high";
}

export interface SecurityPrefs {
  twoFactor: boolean;
  method: "totp" | "sms" | "email";
  updatedAt: Date;
}

export interface DeletionRequest {
  orgId: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: Date;
  scheduledFor: Date;
  reason: string;
  status: "pending" | "cancelled";
}

export interface PlanEvent {
  orgId: string;
  at: Date;
  plan: SubscriptionPlan;
  status: "trialing" | "active" | "cancelled";
  note: string;
}

export interface WorkspaceProfile {
  logoInitials: string;
  logoColor: string;
}

interface State {
  invites: InviteRecord[];
  onboarding: Map<string, OnboardingRecord>;
  tour: Map<string, { completedAt: Date | null; dismissedAt: Date | null; step: number }>;
  reports: ReportRecord[];
  schedules: ReportSchedule[];
  tickets: SupportTicket[];
  security: Map<string, SecurityPrefs>;
  revokedSessions: Set<string>;
  deletion: Map<string, DeletionRequest>;
  planEvents: PlanEvent[];
  profiles: Map<string, WorkspaceProfile>;
  counter: number;
}

const g = globalThis as unknown as { __agriWsState?: State };

export function wsState(): State {
  return (g.__agriWsState ??= {
    invites: [],
    onboarding: new Map(),
    tour: new Map(),
    reports: [],
    schedules: [],
    tickets: [],
    security: new Map(),
    revokedSessions: new Set(),
    deletion: new Map(),
    planEvents: [],
    profiles: new Map(),
    counter: 0,
  });
}

/** Test helper */
export function __resetWsState() {
  g.__agriWsState = undefined;
}

export function wsId(prefix: string): string {
  const s = wsState();
  s.counter += 1;
  return `${prefix}_${Date.now().toString(36)}${s.counter.toString(36)}${randomBytes(2).toString("hex")}`;
}

// ─── Roles per workspace kind ─────────────────────────────────────────────

export interface RoleOption {
  role: UserRole;
  label: string;
  description: string;
  admin: boolean;
}

export function rolesForOrg(org: Pick<OrgRecord, "type">): RoleOption[] {
  if (org.type === "government")
    return [
      { role: "national_admin", label: "Admin", description: "Full access incl. team, billing and settings", admin: true },
      { role: "regional_admin", label: "Regional manager", description: "Approve resources, manage alerts and assets", admin: false },
      { role: "field_officer", label: "Field officer", description: "View risk, add assets, raise requests", admin: false },
    ];
  if (org.type === "supply_chain")
    return [
      { role: "supply_chain_admin", label: "Admin", description: "Full access incl. team, billing, API keys", admin: true },
      { role: "supply_chain_analyst", label: "Analyst", description: "Portfolio, scenarios, reports", admin: false },
    ];
  return [
    { role: "enterprise_admin", label: "Admin", description: "Full access incl. team, billing, API keys", admin: true },
    { role: "enterprise_analyst", label: "Analyst", description: "Portfolio, alerts, reports — no billing or team changes", admin: false },
  ];
}

export const isAdminRole = (role: UserRole) => ["enterprise_admin", "supply_chain_admin", "national_admin", "platform_admin"].includes(role);

/** Org type + admin role for a new workspace of a given industry. */
export function workspaceShapeFor(industry: Industry): { type: OrgRecord["type"]; adminRole: UserRole } {
  switch (industry) {
    case "government":
      return { type: "government", adminRole: "national_admin" };
    case "agribusiness":
      return { type: "supply_chain", adminRole: "supply_chain_admin" };
    case "insurance":
      return { type: "insurance", adminRole: "enterprise_admin" };
    case "banking":
      return { type: "bank", adminRole: "enterprise_admin" };
    case "ngo":
      return { type: "ngo", adminRole: "enterprise_admin" };
    case "cooperative":
      return { type: "cooperative", adminRole: "enterprise_admin" };
  }
}

// ─── Invite token lifecycle (pure) ────────────────────────────────────────

export const INVITE_TTL_DAYS = 7;

export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function inviteStatus(inv: Pick<InviteRecord, "status" | "expiresAt">, now = new Date()): InviteStatus {
  if (inv.status !== "pending") return inv.status;
  return new Date(inv.expiresAt).getTime() < now.getTime() ? "expired" : "pending";
}

export function makeInvite(p: { orgId: string; email: string; role: UserRole; by: { id: string; name: string } }, now = new Date()): InviteRecord {
  return {
    id: wsId("inv"),
    token: newInviteToken(),
    orgId: p.orgId,
    email: p.email.trim().toLowerCase(),
    role: p.role,
    invitedBy: p.by.id,
    invitedByName: p.by.name,
    createdAt: now,
    expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000),
    status: "pending",
    acceptedAt: null,
    acceptedUserId: null,
  };
}

/** Validate that an invite token can be redeemed. Returns the reason when it can't. */
export function checkRedeemable(inv: InviteRecord | undefined, now = new Date()): { ok: true; invite: InviteRecord } | { ok: false; reason: string } {
  if (!inv) return { ok: false, reason: "This invite link is not valid." };
  const st = inviteStatus(inv, now);
  if (st === "accepted") return { ok: false, reason: "This invite has already been used." };
  if (st === "revoked") return { ok: false, reason: "This invite was revoked by a workspace admin." };
  if (st === "expired") return { ok: false, reason: `This invite expired on ${new Date(inv.expiresAt).toISOString().slice(0, 10)}. Ask your admin for a new one.` };
  return { ok: true, invite: inv };
}

export function findInvite(token: string): InviteRecord | undefined {
  return wsState().invites.find((i) => i.token === token);
}

// ─── Schedules (pure) ─────────────────────────────────────────────────────

/** Next run strictly after `from` for a weekly (day = weekday 0-6) or monthly (day = 1-28) cadence, at hourUtc. */
export function nextRunAt(cadence: Cadence, day: number, hourUtc: number, from = new Date()): Date {
  const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hourUtc, 0, 0));
  if (cadence === "weekly") {
    const delta = (day - base.getUTCDay() + 7) % 7;
    const cand = new Date(base.getTime() + delta * 86_400_000);
    return cand.getTime() > from.getTime() ? cand : new Date(cand.getTime() + 7 * 86_400_000);
  }
  const d = Math.min(28, Math.max(1, day));
  let cand = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), d, hourUtc, 0, 0));
  if (cand.getTime() <= from.getTime()) cand = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, d, hourUtc, 0, 0));
  return cand;
}

export function dueSchedules(schedules: ReportSchedule[], now = new Date()): ReportSchedule[] {
  return schedules.filter((s) => s.enabled && s.nextRunAt.getTime() <= now.getTime());
}

// ─── Onboarding ───────────────────────────────────────────────────────────

export const ONBOARDING_STEPS: { id: OnboardingStep; title: string; description: string; href: string; cta: string }[] = [
  { id: "add_asset", title: "Add your first asset", description: "A plot, loan, farm, warehouse or community you want monitored.", href: "/app/portfolio", cta: "Add asset" },
  { id: "invite_teammate", title: "Invite a teammate", description: "Share the workspace with your analysts, claims or credit team.", href: "/app/settings/team", cta: "Invite" },
  { id: "create_rule", title: "Create an alert rule", description: "Get told automatically when risk on your assets crosses a line.", href: "/app/alerts", cta: "Create rule" },
  { id: "generate_report", title: "Generate a report", description: "A PDF portfolio summary you can share with your board or regulator.", href: "/app/reports", cta: "Generate" },
  { id: "connect_api", title: "Connect the API", description: "Create an API key or webhook to pull risk into your own systems.", href: "/app/settings/api", cta: "Connect" },
];

/** Which steps are satisfied by the workspace's real data right now. */
export function detectOnboarding(orgId: string): Record<OnboardingStep, boolean> {
  const s = getStore();
  const st = wsState();
  return {
    add_asset: s.assets.some((a) => a.workspaceId === orgId),
    invite_teammate: st.invites.some((i) => i.orgId === orgId) || s.users.filter((u) => u.orgId === orgId).length > 1,
    create_rule: s.alertRules.some((r) => r.workspaceId === orgId),
    generate_report: st.reports.some((r) => r.orgId === orgId),
    connect_api: s.apiKeys.some((k) => k.orgId === orgId) || s.webhooks.some((w) => w.orgId === orgId),
  };
}

/** Merge detected progress into the persisted record (first-seen timestamps are kept). */
export function onboardingFor(orgId: string, now = new Date()) {
  const st = wsState();
  let rec = st.onboarding.get(orgId);
  if (!rec) st.onboarding.set(orgId, (rec = { completed: {}, dismissed: false, startedAt: now }));
  const detected = detectOnboarding(orgId);
  for (const step of ONBOARDING_STEPS) if (detected[step.id] && !rec.completed[step.id]) rec.completed[step.id] = now;
  const steps = ONBOARDING_STEPS.map((x) => ({ ...x, done: !!rec!.completed[x.id], completedAt: rec!.completed[x.id] ?? null }));
  const done = steps.filter((x) => x.done).length;
  return { steps, done, total: steps.length, pct: Math.round((done / steps.length) * 100), dismissed: rec.dismissed, complete: done === steps.length };
}

// ─── Profile / branding ───────────────────────────────────────────────────

export function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["ltd", "llc", "pte", "jsc", "the", "of", "and", "inc", "co"]);
  const sig = words.filter((w) => !stop.has(w.toLowerCase()));
  return ((sig[0]?.[0] ?? "W") + (sig[1]?.[0] ?? sig[0]?.[1] ?? "")).toUpperCase();
}

const LOGO_COLORS = ["#38bdf8", "#10b981", "#f59e0b", "#a78bfa", "#f472b6", "#22d3ee", "#fb7185"];

export function profileFor(org: Pick<OrgRecord, "id" | "name">): WorkspaceProfile {
  const st = wsState();
  let p = st.profiles.get(org.id);
  if (!p) {
    const h = [...org.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
    p = { logoInitials: initialsOf(org.name), logoColor: LOGO_COLORS[h % LOGO_COLORS.length]! };
    st.profiles.set(org.id, p);
  }
  return p;
}
