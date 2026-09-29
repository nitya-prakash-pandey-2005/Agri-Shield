/**
 * Incident command for climate events (PagerDuty/Linear-grade, built for floods,
 * cyclones, salinity intrusion, drought and heat):
 *
 *   • Incidents open from scratch, from an alert-rule firing, from an official hazard
 *     alert, from a Simulation Lab scenario, or automatically when a critical rule fires
 *     (workspace setting `autoOpenCritical`, see `openIncidentFromFiring` + the realtime
 *     bus listener at the bottom of this file).
 *   • Lifecycle Investigating → Mobilising → Responding → Monitoring → Resolved with
 *     SLA timers per severity (time to acknowledge / mobilise / resolve).
 *   • Roles (commander, field lead, comms), timeline, hazard task templates, linked
 *     firings/alerts/scenarios, stakeholder updates published to a public status page
 *     (/s/<slug>) and e-mail/SMS subscribers, post-incident review.
 *
 * Pure logic (transitions, SLA maths, templates, review drafting) is exported for tests.
 * State is in-memory on globalThis alongside the shared store (like portfolio.ts).
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { AssetRecord } from "../data/store";
import { audit, getStore } from "../data/store";
import { bus, publish, type RealtimeEnvelope } from "../realtime";
import { sendEmail, sendSms } from "../notify/channels";
import { haversineKm } from "./location-risk";
import { effectiveScore, portfolioState, valueAtRisk, workspaceAssets, type RuleFiring } from "./portfolio";
import { notifyWorkspace } from "./workspace-notifications";
import { trackUsage } from "./usage";
import { actorOf, addComment, registerActivitySource, workspaceMembers, type ActivityItem } from "./collab";
import { SEVERITIES, SEVERITY_META, STATUSES, STATUS_META, HAZARD_META, ROLES, ROLE_META, SLA_TARGETS, statusIndex, canTransition, allowedTransitions, fmtMinutes, incidentMetrics, type Severity, type IncidentStatus, type HazardType, type IncidentRole, type IncidentArea } from "@/components/incidents/meta";
export * from "@/components/incidents/meta";

// ─── Records ──────────────────────────────────────────────────────────────


export type SourceKind = "manual" | "rule_firing" | "official_alert" | "scenario" | "auto";

export interface TimelineEntry {
  id: string;
  at: Date;
  kind: "created" | "status" | "severity" | "ack" | "role" | "note" | "task" | "update" | "link" | "asset" | "area" | "review" | "firing";
  actorId: string | null;
  actorName: string;
  text: string;
}

export interface IncidentTask {
  id: string;
  title: string;
  detail: string | null;
  phase: "Mobilise" | "Respond" | "Recover" | "Comms";
  role: IncidentRole | null;
  assigneeId: string | null;
  dueAt: Date | null;
  done: boolean;
  doneAt: Date | null;
  doneBy: string | null;
  createdAt: Date;
  fromTemplate: HazardType | null;
}

export interface IncidentLink {
  kind: "firing" | "alert" | "scenario" | "report" | "asset";
  id: string;
  label: string;
  href: string | null;
  at: Date;
}

export interface StakeholderUpdate {
  id: string;
  state: "draft" | "published";
  status: IncidentStatus;
  title: string;
  body: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  publishedAt: Date | null;
  channels: ("page" | "email" | "sms")[];
  deliveries: { email: number; sms: number };
}

export interface Subscriber {
  id: string;
  kind: "email" | "sms";
  address: string;
  createdAt: Date;
}

export interface ReviewAction {
  id: string;
  text: string;
  ownerId: string | null;
  dueAt: Date | null;
  done: boolean;
}

export interface PostIncidentReview {
  whatHappened: string;
  impact: string;
  whatWorked: string;
  whatToImprove: string;
  actions: ReviewAction[];
  updatedAt: Date;
  updatedBy: string;
  completedAt: Date | null;
}

export interface Incident {
  id: string;
  workspaceId: string;
  number: number;
  slug: string;
  title: string;
  summary: string;
  severity: Severity;
  status: IncidentStatus;
  hazard: HazardType;
  source: { kind: SourceKind; refId: string | null; label: string | null };
  assetIds: string[];
  area: IncidentArea | null;
  roles: Record<IncidentRole, string | null>;
  timeline: TimelineEntry[];
  tasks: IncidentTask[];
  links: IncidentLink[];
  updates: StakeholderUpdate[];
  subscribers: Subscriber[];
  publicEnabled: boolean;
  createdAt: Date;
  createdBy: string;
  acknowledgedAt: Date | null;
  mobilisedAt: Date | null;
  resolvedAt: Date | null;
  statusChangedAt: Date;
  reopenCount: number;
  review: PostIncidentReview | null;
  demo: boolean;
}

export interface IncidentSettings {
  autoOpenCritical: boolean;
  defaultSeverity: Severity;
  autoTemplate: boolean;
}

interface IncidentState {
  incidents: Incident[];
  settings: Map<string, IncidentSettings>;
  seeded: boolean;
  counters: Map<string, number>;
}

const g = globalThis as unknown as { __agriIncidents?: IncidentState; __agriIncidentListener?: (env: RealtimeEnvelope) => void };
export const incidentState: IncidentState = (g.__agriIncidents ??= { incidents: [], settings: new Map(), seeded: false, counters: new Map() });

export class IncidentError extends Error {
  constructor(
    public code: "NOT_FOUND" | "BAD_REQUEST" | "FORBIDDEN" | "CONFLICT",
    message: string
  ) {
    super(message);
  }
}

// ─── Pure: lifecycle ──────────────────────────────────────────────────────

/** Non-blocking warnings shown before a transition. */
export function transitionWarnings(inc: Pick<Incident, "tasks" | "roles" | "updates" | "severity">, to: IncidentStatus): string[] {
  const w: string[] = [];
  const open = inc.tasks.filter((t) => !t.done).length;
  if (to === "resolved" && open) w.push(`${open} task${open === 1 ? " is" : "s are"} still open — they will stay on the record as not done.`);
  if (to === "resolved" && !inc.updates.some((u) => u.state === "published") && (inc.severity === "SEV1" || inc.severity === "SEV2")) w.push("No stakeholder update was published for this SEV1/SEV2 incident.");
  if ((to === "mobilising" || to === "responding") && !inc.roles.commander) w.push("No incident commander is assigned yet.");
  return w;
}

/**
 * Apply a status change: validates, stamps acknowledge / mobilise / resolve times the first
 * time they are reached, handles reopen, and appends a timeline entry. Mutates and returns `inc`.
 */
export function applyTransition(inc: Incident, to: IncidentStatus, actor: { id: string; name: string }, now = new Date(), note?: string): Incident {
  if (!canTransition(inc.status, to)) throw new IncidentError("BAD_REQUEST", `Cannot move from ${STATUS_META[inc.status].label} to ${STATUS_META[to].label}`);
  const from = inc.status;
  inc.status = to;
  inc.statusChangedAt = now;
  if (to !== "investigating" && !inc.acknowledgedAt) inc.acknowledgedAt = now;
  if (statusIndex(to) >= statusIndex("mobilising") && to !== "resolved" && !inc.mobilisedAt) inc.mobilisedAt = now;
  if (to === "resolved") inc.resolvedAt = now;
  if (from === "resolved") {
    inc.resolvedAt = null;
    inc.reopenCount++;
  }
  inc.timeline.push({
    id: tid(),
    at: now,
    kind: "status",
    actorId: actor.id,
    actorName: actor.name,
    text: `${from === "resolved" ? "Reopened" : "Status"}: ${STATUS_META[from].label} → ${STATUS_META[to].label}${note ? ` — ${note}` : ""}`,
  });
  return inc;
}

export function acknowledge(inc: Incident, actor: { id: string; name: string }, now = new Date()): boolean {
  if (inc.acknowledgedAt) return false;
  inc.acknowledgedAt = now;
  inc.timeline.push({ id: tid(), at: now, kind: "ack", actorId: actor.id, actorName: actor.name, text: `${actor.name} acknowledged the incident` });
  return true;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// ─── Pure: task templates ─────────────────────────────────────────────────

type Industry = "insurance" | "banking" | "ngo" | "government" | "cooperative" | "agribusiness";

export interface TemplateTask {
  phase: IncidentTask["phase"];
  title: string;
  detail?: string;
  role: IncidentRole;
  dueHours: number;
  industries?: Industry[];
}

const REVIEW_TASK = (h: number): TemplateTask => ({ phase: "Recover", title: "Schedule the post-incident review", detail: "What happened, what worked, what to change — with owners and dates.", role: "commander", dueHours: h });
const FIRST_UPDATE: TemplateTask = { phase: "Comms", title: "Publish the first stakeholder update", detail: "What we know, what we are doing, when the next update comes.", role: "comms", dueHours: 1 };

export const TASK_TEMPLATES: Record<HazardType, { name: string; tasks: TemplateTask[] }> = {
  flood: {
    name: "Flood response",
    tasks: [
      { phase: "Mobilise", title: "Confirm flood extent with observed-flood satellite layer and field reports", detail: "NASA MODIS 2-day flood map + GloFAS river discharge; call two field contacts.", role: "commander", dueHours: 2 },
      { phase: "Mobilise", title: "List affected assets and people inside the flood footprint", role: "fieldLead", dueHours: 3 },
      { phase: "Mobilise", title: "Staff safety check-in for every field team in the area", role: "fieldLead", dueHours: 4 },
      FIRST_UPDATE,
      { phase: "Respond", title: "Check parametric trigger status (rainfall / discharge) for each policy", role: "commander", dueHours: 6, industries: ["insurance"] },
      { phase: "Respond", title: "Open a claims triage queue and pre-position loss adjusters", role: "fieldLead", dueHours: 12, industries: ["insurance"] },
      { phase: "Respond", title: "Flag affected borrowers for payment holiday / restructuring review", role: "commander", dueHours: 24, industries: ["banking"] },
      { phase: "Respond", title: "Release anticipatory cash to pre-registered households", detail: "Transfer before the peak, per the activation protocol.", role: "commander", dueHours: 6, industries: ["ngo", "government"] },
      { phase: "Respond", title: "Coordinate evacuation to shelters with the local disaster committee", role: "fieldLead", dueHours: 6, industries: ["ngo", "government"] },
      { phase: "Respond", title: "Move stored grain and inputs above flood level; secure warehouses", role: "fieldLead", dueHours: 6, industries: ["cooperative", "agribusiness"] },
      { phase: "Respond", title: "Farmer advisory: drain fields, protect seedbeds, delay fertiliser", role: "comms", dueHours: 12 },
      { phase: "Recover", title: "Collect damage evidence per asset (photos + satellite before/after)", role: "fieldLead", dueHours: 72 },
      REVIEW_TASK(168),
    ],
  },
  cyclone: {
    name: "Cyclone readiness & response",
    tasks: [
      { phase: "Mobilise", title: "Track forecast cone and landfall time (GDACS / national met agency)", role: "commander", dueHours: 1 },
      { phase: "Mobilise", title: "Confirm shelter capacity and access routes near affected sites", role: "fieldLead", dueHours: 6 },
      { phase: "Comms", title: "Send early-warning message to affected farmers in the local language", role: "comms", dueHours: 2 },
      FIRST_UPDATE,
      { phase: "Respond", title: "Advise early harvest of mature crops (≥ 80 % maturity) before landfall", role: "comms", dueHours: 12 },
      { phase: "Respond", title: "Pause new policy sales inside the forecast cone (adverse selection)", role: "commander", dueHours: 2, industries: ["insurance"] },
      { phase: "Respond", title: "Pre-approve emergency top-up loans for affected borrowers", role: "commander", dueHours: 24, industries: ["banking"] },
      { phase: "Respond", title: "Pre-position dry food, water tablets and tarpaulins", role: "fieldLead", dueHours: 24, industries: ["ngo", "government"] },
      { phase: "Respond", title: "Secure boats, livestock and equipment; roll-call after landfall", role: "fieldLead", dueHours: 24 },
      { phase: "Recover", title: "Rapid damage assessment after landfall (satellite + field)", role: "fieldLead", dueHours: 48 },
      REVIEW_TASK(168),
    ],
  },
  salinity: {
    name: "Salinity intrusion",
    tasks: [
      { phase: "Mobilise", title: "Confirm EC readings from field sensors and river monitoring stations", role: "fieldLead", dueHours: 24 },
      { phase: "Mobilise", title: "Map assets where soil/water EC exceeds crop tolerance (rice ≈ 3 dS/m)", role: "commander", dueHours: 24 },
      FIRST_UPDATE,
      { phase: "Respond", title: "Farmer advisory: stop canal irrigation at high tide, store freshwater, salt-tolerant seed", role: "comms", dueHours: 24 },
      { phase: "Respond", title: "Review affected rice loans for rescheduling or working-capital top-ups", role: "commander", dueHours: 72, industries: ["banking"] },
      { phase: "Respond", title: "Estimate yield-loss exposure on area-yield policies", role: "commander", dueHours: 72, industries: ["insurance"] },
      { phase: "Respond", title: "Arrange drinking-water trucking for affected households", role: "fieldLead", dueHours: 48, industries: ["ngo", "government", "cooperative"] },
      { phase: "Recover", title: "Weekly salinity-front monitoring until monsoon flushing", role: "fieldLead", dueHours: 168 },
      REVIEW_TASK(336),
    ],
  },
  drought: {
    name: "Drought response",
    tasks: [
      { phase: "Mobilise", title: "Confirm drought indicators (SPI, soil moisture, NDVI anomaly)", role: "commander", dueHours: 24 },
      { phase: "Mobilise", title: "Identify rain-fed assets with crops at a critical growth stage", role: "fieldLead", dueHours: 48 },
      FIRST_UPDATE,
      { phase: "Respond", title: "Farmer advisory: deficit irrigation, mulching, short-duration varieties", role: "comms", dueHours: 48 },
      { phase: "Respond", title: "Check drought-index trigger status per policy", role: "commander", dueHours: 48, industries: ["insurance"] },
      { phase: "Respond", title: "Flag borrowers for restructuring review", role: "commander", dueHours: 168, industries: ["banking"] },
      { phase: "Respond", title: "Pre-arrange water trucking and fodder support", role: "fieldLead", dueHours: 72, industries: ["ngo", "government", "cooperative"] },
      { phase: "Recover", title: "Weekly monitoring until rainfall recovers", role: "fieldLead", dueHours: 168 },
      REVIEW_TASK(336),
    ],
  },
  heat: {
    name: "Extreme heat",
    tasks: [
      { phase: "Mobilise", title: "Confirm heat-wave forecast and duration (max temp, nights above 28 °C)", role: "commander", dueHours: 6 },
      FIRST_UPDATE,
      { phase: "Respond", title: "Farmer advisory: irrigate at night, shade nurseries, protect livestock", role: "comms", dueHours: 12 },
      { phase: "Respond", title: "Adjust field-work hours for staff (avoid 11:00–16:00)", role: "fieldLead", dueHours: 12 },
      { phase: "Respond", title: "Check cold-chain and storage temperatures at facilities", role: "fieldLead", dueHours: 24, industries: ["agribusiness", "cooperative"] },
      REVIEW_TASK(168),
    ],
  },
  other: {
    name: "General response",
    tasks: [
      { phase: "Mobilise", title: "Confirm what is happening and which assets are affected", role: "commander", dueHours: 2 },
      FIRST_UPDATE,
      { phase: "Respond", title: "Agree the response plan and owners", role: "commander", dueHours: 6 },
      { phase: "Recover", title: "Capture impact and costs per asset", role: "fieldLead", dueHours: 72 },
      REVIEW_TASK(168),
    ],
  },
};

/**
 * Turn a hazard template into concrete tasks for an industry: filters industry-specific
 * items, assigns each task to whoever holds its role, and sets due dates from `now`.
 */
export function instantiateTemplate(hazard: HazardType, industry: string | null | undefined, roles: Partial<Record<IncidentRole, string | null>>, now = new Date()): IncidentTask[] {
  return TASK_TEMPLATES[hazard].tasks
    .filter((t) => !t.industries || (industry != null && (t.industries as string[]).includes(industry)))
    .map((t) => ({
      id: `tsk_${randomUUID().slice(0, 8)}`,
      title: t.title,
      detail: t.detail ?? null,
      phase: t.phase,
      role: t.role,
      assigneeId: roles[t.role] ?? roles.commander ?? null,
      dueAt: new Date(now.getTime() + t.dueHours * 3_600_000),
      done: false,
      doneAt: null,
      doneBy: null,
      createdAt: now,
      fromTemplate: hazard,
    }));
}

// ─── Pure: geometry, suggestions, review ──────────────────────────────────

export function pointInPolygon(lat: number, lon: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]!;
    const [yj, xj] = poly[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inArea(area: IncidentArea, lat: number, lon: number): boolean {
  return area.type === "circle" ? haversineKm(area.lat, area.lon, lat, lon) <= area.radiusKm : area.coords.length >= 3 && pointInPolygon(lat, lon, area.coords);
}

export function areaCentroid(area: IncidentArea): [number, number] {
  if (area.type === "circle") return [area.lat, area.lon];
  const n = area.coords.length || 1;
  return [area.coords.reduce((s, c) => s + c[0], 0) / n, area.coords.reduce((s, c) => s + c[1], 0) / n];
}

/** Severity suggestion from scale of impact (share of exposure affected & worst score). */
export function suggestSeverity(affectedValue: number, totalValue: number, worstScore: number): Severity {
  const share = totalValue > 0 ? affectedValue / totalValue : 0;
  if (share >= 0.15 || worstScore >= 85) return "SEV1";
  if (share >= 0.05 || worstScore >= 70) return "SEV2";
  if (share >= 0.01 || worstScore >= 50) return "SEV3";
  return "SEV4";
}

export function slugify(title: string): string {
  return (
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "incident"
  );
}

/** First-draft review text from the record itself (the team edits it). */
export function draftReview(inc: Incident): Omit<PostIncidentReview, "updatedAt" | "updatedBy" | "completedAt"> {
  const m = incidentMetrics(inc);
  const done = inc.tasks.filter((t) => t.done);
  const late = done.filter((t) => t.dueAt && t.doneAt && t.doneAt > t.dueAt);
  const open = inc.tasks.filter((t) => !t.done);
  const statusLine = inc.timeline.filter((e) => e.kind === "status").map((e) => `${e.at.toISOString().slice(0, 16).replace("T", " ")} UTC — ${e.text}`);
  return {
    whatHappened: [
      `${HAZARD_META[inc.hazard].label} incident "${inc.title}" opened ${inc.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC as ${inc.severity} (${SEVERITY_META[inc.severity].short.toLowerCase()})${inc.source.label ? `, from ${inc.source.label}` : ""}.`,
      inc.summary,
      ...statusLine,
    ]
      .filter(Boolean)
      .join("\n"),
    impact: `${inc.assetIds.length} monitored asset${inc.assetIds.length === 1 ? "" : "s"} inside the affected area.`,
    whatWorked: [
      m.clocks[0]!.state === "met" ? `Acknowledged in ${fmtMinutes(m.tta)} (target ${fmtMinutes(SLA_TARGETS[inc.severity].ack)}).` : null,
      m.clocks[1]!.state === "met" ? `Mobilised in ${fmtMinutes(m.ttm)} (target ${fmtMinutes(SLA_TARGETS[inc.severity].mobilise)}).` : null,
      done.length ? `${done.length} of ${inc.tasks.length} tasks completed${late.length ? "" : ", all on time"}.` : null,
      inc.updates.some((u) => u.state === "published") ? `${inc.updates.filter((u) => u.state === "published").length} stakeholder update(s) published.` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    whatToImprove: [
      ...m.clocks.filter((c) => c.state === "breached").map((c) => `${c.label} missed its ${fmtMinutes(c.targetMin)} target (${fmtMinutes(c.elapsedMin)}).`),
      late.length ? `${late.length} task(s) finished after their due time: ${late.slice(0, 3).map((t) => t.title).join("; ")}.` : null,
      open.length ? `${open.length} task(s) never completed.` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    actions: open.slice(0, 5).map((t) => ({ id: `act_${randomUUID().slice(0, 8)}`, text: `Follow up: ${t.title}`, ownerId: t.assigneeId, dueAt: null, done: false })),
  };
}

// ─── Store helpers ────────────────────────────────────────────────────────

function tid() {
  return `tl_${randomUUID().slice(0, 10)}`;
}

function nextNumber(ws: string): number {
  const n = (incidentState.counters.get(ws) ?? 100) + 1;
  incidentState.counters.set(ws, n);
  return n;
}

function uniqueSlug(title: string): string {
  let slug = "";
  do slug = `${slugify(title)}-${randomBytes(3).toString("hex")}`;
  while (incidentState.incidents.some((i) => i.slug === slug));
  return slug;
}

function industryOf(ws: string): string | null {
  const o = getStore().orgs.find((x) => x.id === ws);
  return o?.industry ?? (o?.type === "government" ? "government" : null);
}

function userName(id: string | null | undefined): string {
  if (!id) return "Unassigned";
  return getStore().users.find((u) => u.id === id)?.name ?? id;
}

function isMember(ws: string, userId: string | null | undefined): boolean {
  return !userId || getStore().users.some((u) => u.id === userId && u.orgId === ws);
}

export function settingsFor(ws: string): IncidentSettings {
  let s = incidentState.settings.get(ws);
  if (!s) incidentState.settings.set(ws, (s = { autoOpenCritical: ws === "org-ins-deltamutual" || ws === "org-ngo-brac", defaultSeverity: "SEV2", autoTemplate: true }));
  return s;
}

export function updateSettings(ws: string, patch: Partial<IncidentSettings>): IncidentSettings {
  return Object.assign(settingsFor(ws), patch);
}

function emit(inc: Incident, change: string, by: string, text: string) {
  publish(`ws:${inc.workspaceId}`, { type: "incident.updated", incidentId: inc.id, workspaceId: inc.workspaceId, change, status: inc.status, severity: inc.severity, by, text });
}

export function getIncident(ws: string, id: string): Incident {
  ensureSeeded();
  const inc = incidentState.incidents.find((i) => i.id === id && i.workspaceId === ws) ?? incidentState.incidents.find((i) => i.workspaceId === ws && `inc-${i.number}` === id.toLowerCase());
  if (!inc) throw new IncidentError("NOT_FOUND", "Incident not found in this workspace");
  return inc;
}

export function assetsInArea(ws: string, area: IncidentArea): AssetRecord[] {
  return workspaceAssets(ws).filter((a) => inArea(area, a.lat, a.lon));
}

// ─── Create ───────────────────────────────────────────────────────────────

export interface CreateIncidentInput {
  title: string;
  summary?: string;
  severity?: Severity;
  hazard: HazardType;
  assetIds?: string[];
  area?: IncidentArea | null;
  /** Include every workspace asset inside the area */
  includeAreaAssets?: boolean;
  roles?: Partial<Record<IncidentRole, string | null>>;
  applyTemplate?: boolean;
  source?: { kind: SourceKind; refId?: string | null; label?: string | null };
  links?: Omit<IncidentLink, "at">[];
  at?: Date;
  demo?: boolean;
  silent?: boolean;
}

export function createIncident(ws: string, user: { id: string; name: string }, input: CreateIncidentInput): Incident {
  const now = input.at ?? new Date();
  const title = input.title.trim();
  if (title.length < 3) throw new IncidentError("BAD_REQUEST", "Give the incident a short title (3+ characters)");
  const valid = new Set(workspaceAssets(ws).map((a) => a.id));
  const ids = new Set((input.assetIds ?? []).filter((id) => valid.has(id)));
  if (input.area && input.includeAreaAssets !== false) for (const a of assetsInArea(ws, input.area)) ids.add(a.id);
  const roles: Record<IncidentRole, string | null> = { commander: null, fieldLead: null, comms: null };
  for (const r of ROLES) {
    const v = input.roles?.[r];
    if (v && isMember(ws, v)) roles[r] = v;
  }
  if (!roles.commander && user.id !== "system" && isMember(ws, user.id)) roles.commander = user.id;
  const sev = input.severity ?? settingsFor(ws).defaultSeverity;
  const inc: Incident = {
    id: `inc_${randomUUID().slice(0, 10)}`,
    workspaceId: ws,
    number: nextNumber(ws),
    slug: uniqueSlug(title),
    title: title.slice(0, 160),
    summary: (input.summary ?? "").trim().slice(0, 4000),
    severity: sev,
    status: "investigating",
    hazard: input.hazard,
    source: { kind: input.source?.kind ?? "manual", refId: input.source?.refId ?? null, label: input.source?.label ?? null },
    assetIds: [...ids],
    area: input.area ?? null,
    roles,
    timeline: [],
    tasks: [],
    links: (input.links ?? []).map((l) => ({ ...l, at: now })),
    updates: [],
    subscribers: [],
    publicEnabled: false,
    createdAt: now,
    createdBy: user.id,
    acknowledgedAt: null,
    mobilisedAt: null,
    resolvedAt: null,
    statusChangedAt: now,
    reopenCount: 0,
    review: null,
    demo: !!input.demo,
  };
  const sourceText: Record<SourceKind, string> = { manual: "Opened manually", rule_firing: "Opened from an alert-rule firing", official_alert: "Opened from an official hazard alert", scenario: "Opened from a Simulation Lab scenario", auto: "Opened automatically — critical rule fired" };
  inc.timeline.push({ id: tid(), at: now, kind: "created", actorId: user.id === "system" ? null : user.id, actorName: user.id === "system" ? "Agri-SHIELD monitor" : user.name, text: `${sourceText[inc.source.kind]}${inc.source.label ? ` (${inc.source.label})` : ""} as ${sev} · ${HAZARD_META[inc.hazard].label} · ${inc.assetIds.length} asset${inc.assetIds.length === 1 ? "" : "s"}` });
  if (roles.commander) inc.timeline.push({ id: tid(), at: now, kind: "role", actorId: user.id, actorName: user.name, text: `${userName(roles.commander)} is incident commander` });
  if (input.applyTemplate ?? settingsFor(ws).autoTemplate) inc.tasks = instantiateTemplate(inc.hazard, industryOf(ws), roles, now);
  incidentState.incidents.unshift(inc);
  if (input.silent) return inc;

  audit({ userId: user.id, userName: user.name, action: "incident.create", entity: "incident", entityId: inc.id, details: `INC-${inc.number} ${inc.title} (${sev})` });
  publish(`ws:${ws}`, { type: "incident.created", incidentId: inc.id, workspaceId: ws, number: inc.number, title: inc.title, severity: sev, auto: inc.source.kind === "auto", by: user.name });
  notifyWorkspace({
    workspaceId: ws,
    kind: "alert",
    severity: sev === "SEV1" ? "critical" : sev === "SEV2" ? "warning" : "info",
    title: `${sev} incident opened: ${inc.title}`,
    body: `${sourceText[inc.source.kind]}. ${inc.assetIds.length} asset(s) affected. Commander: ${userName(roles.commander)}.`,
    href: `/app/incidents/${inc.id}`,
    email: sev === "SEV1" ? undefined : false,
  });
  return inc;
}

/** Suggested incident from a rule firing (used by the "from firing" picker and by auto-open). */
export function draftFromFiring(f: RuleFiring) {
  const metric = Object.keys(f.matches[0]?.metrics ?? {})[0] ?? "";
  const hazard: HazardType = /salin/.test(metric) ? "salinity" : /drought/.test(metric) ? "drought" : /heat/.test(metric) ? "heat" : /flood|rain|discharge/.test(metric) ? "flood" : /salin/i.test(f.ruleName) ? "salinity" : /cyclone|storm/i.test(f.ruleName) ? "cyclone" : "flood";
  return {
    title: `${f.ruleName} — ${f.matchCount} asset${f.matchCount === 1 ? "" : "s"}`,
    hazard,
    severity: (f.severity === "critical" ? "SEV2" : f.severity === "warning" ? "SEV3" : "SEV4") as Severity,
    assetIds: f.matches.map((m) => m.assetId),
    summary: `Rule "${f.ruleName}" fired at ${f.at.toISOString().slice(0, 16).replace("T", " ")} UTC for ${f.matchCount} asset(s): ${f.matches.slice(0, 5).map((m) => `${m.name} (${m.reason})`).join("; ")}${f.matchCount > 5 ? "…" : ""}.`,
  };
}

/**
 * Open (or extend) an incident from a rule firing. If an unresolved incident already links
 * the same rule within the last 48 h, the firing is appended to it instead of opening a
 * duplicate. `auto: true` is what the critical-rule hook uses.
 */
export function openIncidentFromFiring(firingOrId: RuleFiring | string, opts: { auto?: boolean; user?: { id: string; name: string }; overrides?: Partial<CreateIncidentInput> } = {}): { incident: Incident; created: boolean } {
  ensureSeeded();
  const f = typeof firingOrId === "string" ? portfolioState.firings.find((x) => x.id === firingOrId) : firingOrId;
  if (!f) throw new IncidentError("NOT_FOUND", "Rule firing not found");
  const ws = f.workspaceId;
  const cutoff = Date.now() - 48 * 3_600_000;
  const existing = incidentState.incidents.find((i) => i.workspaceId === ws && i.status !== "resolved" && i.links.some((l) => l.kind === "firing" && l.id.startsWith(`${f.ruleId}:`)) && i.createdAt.getTime() >= cutoff);
  const link: Omit<IncidentLink, "at"> = { kind: "firing", id: `${f.ruleId}:${f.id}`, label: `${f.ruleName} · ${f.matchCount} asset(s)`, href: `/app/alerts?tab=history&firing=${f.id}` };
  const actor = opts.user ?? { id: "system", name: "Agri-SHIELD monitor" };
  if (existing) {
    if (!existing.links.some((l) => l.id === link.id)) {
      existing.links.push({ ...link, at: new Date() });
      const before = existing.assetIds.length;
      existing.assetIds = [...new Set([...existing.assetIds, ...f.matches.map((m) => m.assetId)])];
      existing.timeline.push({ id: tid(), at: new Date(), kind: "firing", actorId: null, actorName: actor.name, text: `Rule fired again: ${f.ruleName} (${f.matchCount} asset(s), ${existing.assetIds.length - before} new)` });
      emit(existing, "firing", actor.name, `Rule fired again: ${f.ruleName}`);
    }
    return { incident: existing, created: false };
  }
  const d = draftFromFiring(f);
  const inc = createIncident(ws, actor, {
    title: d.title,
    summary: d.summary,
    hazard: d.hazard,
    severity: opts.auto ? "SEV2" : d.severity,
    ...opts.overrides,
    assetIds: [...new Set([...d.assetIds, ...(opts.overrides?.assetIds ?? [])])],
    source: { kind: opts.auto ? "auto" : "rule_firing", refId: f.id, label: f.ruleName },
    links: [link],
  });
  return { incident: inc, created: true };
}

// ─── Mutations ────────────────────────────────────────────────────────────

type Actor = { id: string; name: string };

export function changeStatus(ws: string, id: string, to: IncidentStatus, actor: Actor, note?: string) {
  const inc = getIncident(ws, id);
  const warnings = transitionWarnings(inc, to);
  applyTransition(inc, to, actor, new Date(), note);
  audit({ userId: actor.id, userName: actor.name, action: "incident.status", entity: "incident", entityId: inc.id, details: `INC-${inc.number} → ${to}` });
  emit(inc, "status", actor.name, `${STATUS_META[to].label}`);
  if (to === "resolved")
    notifyWorkspace({ workspaceId: ws, kind: "alert", severity: "success", title: `Resolved: INC-${inc.number} ${inc.title}`, body: `Resolved by ${actor.name} after ${fmtMinutes(incidentMetrics(inc).ttr)}. Next: post-incident review.`, href: `/app/incidents/${inc.id}?tab=review`, email: false });
  return { incident: inc, warnings };
}

export function acknowledgeIncident(ws: string, id: string, actor: Actor) {
  const inc = getIncident(ws, id);
  if (acknowledge(inc, actor)) emit(inc, "ack", actor.name, "Acknowledged");
  return inc;
}

export function changeSeverity(ws: string, id: string, sev: Severity, actor: Actor, reason?: string) {
  const inc = getIncident(ws, id);
  if (inc.severity === sev) return inc;
  const from = inc.severity;
  inc.severity = sev;
  inc.timeline.push({ id: tid(), at: new Date(), kind: "severity", actorId: actor.id, actorName: actor.name, text: `Severity ${from} → ${sev}${reason ? ` — ${reason}` : ""}` });
  emit(inc, "severity", actor.name, `Severity ${sev}`);
  if (SEVERITIES.indexOf(sev) < SEVERITIES.indexOf(from) && sev === "SEV1")
    notifyWorkspace({ workspaceId: ws, kind: "alert", severity: "critical", title: `Escalated to SEV1: INC-${inc.number} ${inc.title}`, body: reason ?? `Escalated by ${actor.name}.`, href: `/app/incidents/${inc.id}` });
  return inc;
}

export function assignRole(ws: string, id: string, role: IncidentRole, userId: string | null, actor: Actor) {
  const inc = getIncident(ws, id);
  if (userId && !isMember(ws, userId)) throw new IncidentError("BAD_REQUEST", "That person is not a member of this workspace");
  inc.roles[role] = userId;
  inc.timeline.push({ id: tid(), at: new Date(), kind: "role", actorId: actor.id, actorName: actor.name, text: userId ? `${userName(userId)} is ${ROLE_META[role].label.toLowerCase()}` : `${ROLE_META[role].label} unassigned` });
  if (role === "commander" && userId) acknowledge(inc, { id: userId, name: userName(userId) });
  if (userId && userId !== actor.id)
    notifyWorkspace({ workspaceId: ws, userId, kind: "team", severity: "info", title: `You are ${ROLE_META[role].label.toLowerCase()} for INC-${inc.number}`, body: `${actor.name} assigned you on "${inc.title}". ${ROLE_META[role].meaning}`, href: `/app/incidents/${inc.id}`, email: false });
  emit(inc, "role", actor.name, `${ROLE_META[role].label}: ${userName(userId)}`);
  return inc;
}

export function editIncident(ws: string, id: string, patch: { title?: string; summary?: string; hazard?: HazardType }, actor: Actor) {
  const inc = getIncident(ws, id);
  if (patch.title !== undefined && patch.title.trim().length >= 3) inc.title = patch.title.trim().slice(0, 160);
  if (patch.summary !== undefined) inc.summary = patch.summary.trim().slice(0, 4000);
  if (patch.hazard && patch.hazard !== inc.hazard) {
    inc.timeline.push({ id: tid(), at: new Date(), kind: "note", actorId: actor.id, actorName: actor.name, text: `Hazard changed to ${HAZARD_META[patch.hazard].label}` });
    inc.hazard = patch.hazard;
  }
  emit(inc, "edit", actor.name, "Details edited");
  return inc;
}

export function addNote(ws: string, id: string, text: string, actor: Actor, at = new Date()) {
  const inc = getIncident(ws, id);
  const t = text.trim();
  if (!t) throw new IncidentError("BAD_REQUEST", "Note is empty");
  const entry: TimelineEntry = { id: tid(), at, kind: "note", actorId: actor.id, actorName: actor.name, text: t.slice(0, 2000) };
  inc.timeline.push(entry);
  inc.timeline.sort((a, b) => a.at.getTime() - b.at.getTime());
  emit(inc, "note", actor.name, t.slice(0, 120));
  return entry;
}

export function setAssets(ws: string, id: string, assetIds: string[], actor: Actor) {
  const inc = getIncident(ws, id);
  const valid = new Set(workspaceAssets(ws).map((a) => a.id));
  const next = [...new Set(assetIds.filter((a) => valid.has(a)))];
  const added = next.filter((a) => !inc.assetIds.includes(a)).length;
  const removed = inc.assetIds.filter((a) => !next.includes(a)).length;
  inc.assetIds = next;
  inc.timeline.push({ id: tid(), at: new Date(), kind: "asset", actorId: actor.id, actorName: actor.name, text: `Affected assets updated: +${added} / −${removed} (now ${next.length})` });
  emit(inc, "assets", actor.name, `${next.length} assets`);
  return inc;
}

export function setArea(ws: string, id: string, area: IncidentArea | null, includeAssets: boolean, actor: Actor) {
  const inc = getIncident(ws, id);
  inc.area = area;
  let added = 0;
  if (area && includeAssets) {
    for (const a of assetsInArea(ws, area))
      if (!inc.assetIds.includes(a.id)) {
        inc.assetIds.push(a.id);
        added++;
      }
  }
  inc.timeline.push({ id: tid(), at: new Date(), kind: "area", actorId: actor.id, actorName: actor.name, text: area ? `Affected area set (${area.type === "circle" ? `${area.radiusKm.toFixed(0)} km radius` : `${area.coords.length}-point polygon`})${added ? `, ${added} asset(s) added` : ""}` : "Affected area cleared" });
  emit(inc, "area", actor.name, "Area updated");
  return inc;
}

export function addTask(ws: string, id: string, t: { title: string; detail?: string | null; phase?: IncidentTask["phase"]; assigneeId?: string | null; dueAt?: Date | null }, actor: Actor) {
  const inc = getIncident(ws, id);
  if (t.assigneeId && !isMember(ws, t.assigneeId)) throw new IncidentError("BAD_REQUEST", "Assignee is not a workspace member");
  const task: IncidentTask = { id: `tsk_${randomUUID().slice(0, 8)}`, title: t.title.trim().slice(0, 200), detail: t.detail?.trim() || null, phase: t.phase ?? "Respond", role: null, assigneeId: t.assigneeId ?? null, dueAt: t.dueAt ?? null, done: false, doneAt: null, doneBy: null, createdAt: new Date(), fromTemplate: null };
  inc.tasks.push(task);
  inc.timeline.push({ id: tid(), at: new Date(), kind: "task", actorId: actor.id, actorName: actor.name, text: `Task added: ${task.title}${task.assigneeId ? ` → ${userName(task.assigneeId)}` : ""}` });
  if (task.assigneeId && task.assigneeId !== actor.id) notifyWorkspace({ workspaceId: ws, userId: task.assigneeId, kind: "team", severity: "info", title: `New task on INC-${inc.number}`, body: task.title, href: `/app/incidents/${inc.id}#tasks`, email: false });
  emit(inc, "task", actor.name, task.title);
  return task;
}

export function updateTask(ws: string, id: string, taskId: string, patch: { title?: string; done?: boolean; assigneeId?: string | null; dueAt?: Date | null; phase?: IncidentTask["phase"] }, actor: Actor) {
  const inc = getIncident(ws, id);
  const t = inc.tasks.find((x) => x.id === taskId);
  if (!t) throw new IncidentError("NOT_FOUND", "Task not found");
  if (patch.title !== undefined && patch.title.trim()) t.title = patch.title.trim().slice(0, 200);
  if (patch.phase) t.phase = patch.phase;
  if (patch.dueAt !== undefined) t.dueAt = patch.dueAt;
  if (patch.assigneeId !== undefined) {
    if (patch.assigneeId && !isMember(ws, patch.assigneeId)) throw new IncidentError("BAD_REQUEST", "Assignee is not a workspace member");
    if (patch.assigneeId !== t.assigneeId) {
      t.assigneeId = patch.assigneeId;
      if (patch.assigneeId && patch.assigneeId !== actor.id) notifyWorkspace({ workspaceId: ws, userId: patch.assigneeId, kind: "team", severity: "info", title: `Task assigned on INC-${inc.number}`, body: t.title, href: `/app/incidents/${inc.id}#tasks`, email: false });
    }
  }
  if (patch.done !== undefined && patch.done !== t.done) {
    t.done = patch.done;
    t.doneAt = patch.done ? new Date() : null;
    t.doneBy = patch.done ? actor.id : null;
    inc.timeline.push({ id: tid(), at: new Date(), kind: "task", actorId: actor.id, actorName: actor.name, text: `${patch.done ? "Done" : "Reopened"}: ${t.title}` });
  }
  emit(inc, "task", actor.name, t.title);
  return t;
}

export function deleteTask(ws: string, id: string, taskId: string, actor: Actor) {
  const inc = getIncident(ws, id);
  const i = inc.tasks.findIndex((x) => x.id === taskId);
  if (i < 0) throw new IncidentError("NOT_FOUND", "Task not found");
  const [t] = inc.tasks.splice(i, 1);
  inc.timeline.push({ id: tid(), at: new Date(), kind: "task", actorId: actor.id, actorName: actor.name, text: `Task removed: ${t!.title}` });
  emit(inc, "task", actor.name, "Task removed");
  return true;
}

export function applyTemplate(ws: string, id: string, hazard: HazardType, actor: Actor) {
  const inc = getIncident(ws, id);
  const existing = new Set(inc.tasks.map((t) => t.title));
  const fresh = instantiateTemplate(hazard, industryOf(ws), inc.roles).filter((t) => !existing.has(t.title));
  inc.tasks.push(...fresh);
  inc.timeline.push({ id: tid(), at: new Date(), kind: "task", actorId: actor.id, actorName: actor.name, text: `Checklist "${TASK_TEMPLATES[hazard].name}" applied (${fresh.length} tasks)` });
  emit(inc, "task", actor.name, "Template applied");
  return fresh.length;
}

export function linkItem(ws: string, id: string, link: Omit<IncidentLink, "at">, actor: Actor) {
  const inc = getIncident(ws, id);
  if (inc.links.some((l) => l.kind === link.kind && l.id === link.id)) return inc;
  inc.links.push({ ...link, at: new Date() });
  inc.timeline.push({ id: tid(), at: new Date(), kind: "link", actorId: actor.id, actorName: actor.name, text: `Linked ${link.kind}: ${link.label}` });
  emit(inc, "link", actor.name, link.label);
  return inc;
}

export function unlinkItem(ws: string, id: string, kind: IncidentLink["kind"], linkId: string, actor: Actor) {
  const inc = getIncident(ws, id);
  inc.links = inc.links.filter((l) => !(l.kind === kind && l.id === linkId));
  emit(inc, "link", actor.name, "Link removed");
  return inc;
}

// ─── Stakeholder updates & public page ────────────────────────────────────

export function saveUpdate(ws: string, id: string, input: { updateId?: string | null; title: string; body: string; channels: StakeholderUpdate["channels"] }, actor: Actor) {
  const inc = getIncident(ws, id);
  const body = input.body.trim();
  if (!body) throw new IncidentError("BAD_REQUEST", "Write the update first");
  let u = input.updateId ? inc.updates.find((x) => x.id === input.updateId) : undefined;
  if (u && u.state === "published") throw new IncidentError("CONFLICT", "Published updates can't be edited — post a new update instead");
  if (!u) {
    u = { id: `upd_${randomUUID().slice(0, 8)}`, state: "draft", status: inc.status, title: "", body: "", createdAt: new Date(), createdBy: actor.id, createdByName: actor.name, publishedAt: null, channels: ["page"], deliveries: { email: 0, sms: 0 } };
    inc.updates.push(u);
  }
  u.title = input.title.trim().slice(0, 160) || `${STATUS_META[inc.status].label} — update`;
  u.body = body.slice(0, 5000);
  u.channels = input.channels.length ? [...new Set(input.channels)] : ["page"];
  u.status = inc.status;
  return u;
}

function publicUrl(slug: string) {
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/s/${slug}`;
}

export async function publishUpdate(ws: string, id: string, updateId: string, actor: Actor) {
  const inc = getIncident(ws, id);
  const u = inc.updates.find((x) => x.id === updateId);
  if (!u) throw new IncidentError("NOT_FOUND", "Draft not found");
  if (u.state === "published") return u;
  u.state = "published";
  u.publishedAt = new Date();
  u.status = inc.status;
  inc.publicEnabled = true;
  const org = getStore().orgs.find((o) => o.id === ws);
  const link = publicUrl(inc.slug);
  if (u.channels.includes("email")) {
    const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;background:#0b1224;color:#e2e8f0;padding:24px;border-radius:12px"><div style="font-size:11px;letter-spacing:.12em;color:#38bdf8;text-transform:uppercase">${esc(org?.name ?? "Agri-SHIELD")} · ${esc(STATUS_META[inc.status].label)}</div><h2 style="color:#fff;font-size:18px">${esc(u.title)}</h2><p style="white-space:pre-line;line-height:1.55;color:#cbd5e1">${esc(u.body)}</p><a href="${esc(link)}" style="display:inline-block;margin-top:12px;background:#38bdf8;color:#020617;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Live status page</a><p style="font-size:11px;color:#64748b;margin-top:20px">You subscribed to updates on "${esc(inc.title)}".</p></div>`;
    for (const s of inc.subscribers.filter((x) => x.kind === "email")) {
      await sendEmail(s.address, `[${org?.shortName ?? "Update"}] ${u.title}`, html);
      u.deliveries.email++;
    }
  }
  if (u.channels.includes("sms")) {
    const text = `${org?.shortName ?? "Agri-SHIELD"}: ${u.title}. ${u.body.slice(0, 100)}${u.body.length > 100 ? "…" : ""} ${link}`;
    for (const s of inc.subscribers.filter((x) => x.kind === "sms")) {
      await sendSms(s.address, text);
      u.deliveries.sms++;
    }
  }
  if (u.deliveries.email + u.deliveries.sms) trackUsage(ws, "messages", u.deliveries.email + u.deliveries.sms);
  inc.timeline.push({ id: tid(), at: u.publishedAt, kind: "update", actorId: actor.id, actorName: actor.name, text: `Stakeholder update published: "${u.title}"${u.deliveries.email + u.deliveries.sms ? ` — sent to ${u.deliveries.email} e-mail / ${u.deliveries.sms} SMS subscriber(s)` : ""}` });
  publish(`status:${inc.slug}`, { type: "incident.update_published", slug: inc.slug, incidentId: inc.id, updateId: u.id, status: inc.status, title: u.title });
  emit(inc, "update", actor.name, u.title);
  audit({ userId: actor.id, userName: actor.name, action: "incident.update_published", entity: "incident", entityId: inc.id, details: u.title });
  return u;
}

export function deleteDraft(ws: string, id: string, updateId: string) {
  const inc = getIncident(ws, id);
  const u = inc.updates.find((x) => x.id === updateId);
  if (!u) throw new IncidentError("NOT_FOUND", "Draft not found");
  if (u.state === "published") throw new IncidentError("CONFLICT", "Published updates stay on the public record");
  inc.updates = inc.updates.filter((x) => x.id !== updateId);
  return true;
}

export function setPublic(ws: string, id: string, enabled: boolean, actor: Actor) {
  const inc = getIncident(ws, id);
  inc.publicEnabled = enabled;
  inc.timeline.push({ id: tid(), at: new Date(), kind: "update", actorId: actor.id, actorName: actor.name, text: enabled ? "Public status page enabled" : "Public status page taken offline" });
  emit(inc, "public", actor.name, enabled ? "Public page on" : "Public page off");
  return inc;
}

/** Suggested stakeholder update text from the current record (comms edits it). */
export function suggestUpdate(ws: string, id: string): { title: string; body: string } {
  const inc = getIncident(ws, id);
  const done = inc.tasks.filter((t) => t.done).length;
  const next = inc.tasks.filter((t) => !t.done).sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity)).slice(0, 3);
  const every = SEVERITY_META[inc.severity].updateEveryHours;
  const nextAt = new Date(Date.now() + every * 3_600_000);
  return {
    title: `${STATUS_META[inc.status].label}: ${inc.title}`,
    body: [
      `What is happening: ${inc.summary || `${HAZARD_META[inc.hazard].label} affecting ${inc.assetIds.length} monitored sites.`}`,
      `Status: ${STATUS_META[inc.status].label} — ${STATUS_META[inc.status].meaning}`,
      `Progress: ${done} of ${inc.tasks.length} response actions complete.`,
      next.length ? `Next steps: ${next.map((t) => t.title).join("; ")}.` : null,
      `Next update by ${nextAt.toUTCString().slice(0, 22)} UTC (or sooner if the situation changes).`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;

export function subscribe(slug: string, kind: Subscriber["kind"], address: string) {
  ensureSeeded();
  const inc = incidentState.incidents.find((i) => i.slug === slug && i.publicEnabled);
  if (!inc) throw new IncidentError("NOT_FOUND", "Status page not found");
  return addSubscriber(inc, kind, address);
}

/** Add an e-mail / SMS subscriber (validated, de-duplicated). Used by the public page and by the team. */
export function addSubscriber(inc: Incident, kind: Subscriber["kind"], address: string) {
  const addr = kind === "sms" ? address.replace(/[\s()-]/g, "") : address.trim().toLowerCase();
  if (kind === "email" ? !EMAIL_RE.test(addr) : !PHONE_RE.test(addr)) throw new IncidentError("BAD_REQUEST", kind === "email" ? "Enter a valid e-mail address" : "Enter a phone number in international format, e.g. +8801711000000");
  if (inc.subscribers.length >= 5000) throw new IncidentError("CONFLICT", "Subscriber list is full");
  if (!inc.subscribers.some((s) => s.kind === kind && s.address === addr)) inc.subscribers.push({ id: `sub_${randomUUID().slice(0, 8)}`, kind, address: addr, createdAt: new Date() });
  return { ok: true, count: inc.subscribers.length };
}

export function maskAddress(s: Subscriber): string {
  if (s.kind === "email") {
    const [u, d] = s.address.split("@");
    return `${u!.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, u!.length - 2)))}@${d}`;
  }
  return `${s.address.slice(0, 4)}••••${s.address.slice(-3)}`;
}

/** Everything the public page may show — no asset names, values, people or internal notes. */
export function publicStatus(slug: string) {
  ensureSeeded();
  const inc = incidentState.incidents.find((i) => i.slug === slug && i.publicEnabled);
  if (!inc) return null;
  const org = getStore().orgs.find((o) => o.id === inc.workspaceId);
  const published = inc.updates.filter((u) => u.state === "published").sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime());
  return {
    slug: inc.slug,
    title: inc.title,
    org: { name: org?.name ?? "Organisation", shortName: org?.shortName ?? "" },
    status: inc.status,
    statusMeta: STATUS_META[inc.status],
    severity: inc.severity,
    severityMeta: SEVERITY_META[inc.severity],
    hazard: HAZARD_META[inc.hazard].label,
    area: inc.area,
    sitesAffected: inc.assetIds.length,
    startedAt: inc.createdAt,
    resolvedAt: inc.resolvedAt,
    lastUpdatedAt: published[0]?.publishedAt ?? inc.statusChangedAt,
    updates: published.map((u) => ({ id: u.id, title: u.title, body: u.body, status: u.status, statusLabel: STATUS_META[u.status].label, publishedAt: u.publishedAt! })),
    subscribers: inc.subscribers.length,
    demo: inc.demo,
  };
}

// ─── Review ───────────────────────────────────────────────────────────────

export function saveReview(ws: string, id: string, patch: Partial<Omit<PostIncidentReview, "updatedAt" | "updatedBy" | "completedAt">> & { complete?: boolean }, actor: Actor) {
  const inc = getIncident(ws, id);
  const base = inc.review ?? { ...draftReview(inc), updatedAt: new Date(), updatedBy: actor.id, completedAt: null };
  const next: PostIncidentReview = {
    ...base,
    ...(patch.whatHappened !== undefined ? { whatHappened: patch.whatHappened.slice(0, 8000) } : {}),
    ...(patch.impact !== undefined ? { impact: patch.impact.slice(0, 4000) } : {}),
    ...(patch.whatWorked !== undefined ? { whatWorked: patch.whatWorked.slice(0, 8000) } : {}),
    ...(patch.whatToImprove !== undefined ? { whatToImprove: patch.whatToImprove.slice(0, 8000) } : {}),
    ...(patch.actions !== undefined ? { actions: patch.actions.slice(0, 30).map((a) => ({ ...a, id: a.id || `act_${randomUUID().slice(0, 8)}`, text: a.text.slice(0, 400) })) } : {}),
    updatedAt: new Date(),
    updatedBy: actor.id,
  };
  if (patch.complete && !next.completedAt) {
    next.completedAt = new Date();
    inc.timeline.push({ id: tid(), at: next.completedAt, kind: "review", actorId: actor.id, actorName: actor.name, text: `Post-incident review completed (${next.actions.length} follow-up action${next.actions.length === 1 ? "" : "s"})` });
  }
  inc.review = next;
  emit(inc, "review", actor.name, "Review saved");
  return next;
}

// ─── Queries / view models ────────────────────────────────────────────────

export function assetRows(ws: string, ids: string[]) {
  const byId = new Map(workspaceAssets(ws, true).map((a) => [a.id, a]));
  return ids
    .map((id) => byId.get(id))
    .filter((a): a is AssetRecord => !!a)
    .map((a) => {
      const e = effectiveScore(a);
      return { id: a.id, name: a.name, type: a.type, externalRef: a.externalRef, lat: a.lat, lon: a.lon, valueUsd: a.valueUsd, composite: e.composite, level: e.level, flood: e.flood, salinity: e.salinity, drought: e.drought, heat: e.heat, drivers: e.drivers, source: e.source, scoredAt: e.at, varUsd: Math.round(valueAtRisk(a.valueUsd, e)), meta: a.meta };
    })
    .sort((a, b) => b.composite - a.composite);
}

function listRow(inc: Incident, now = new Date()) {
  const rows = assetRows(inc.workspaceId, inc.assetIds);
  const m = incidentMetrics(inc, now);
  const openTasks = inc.tasks.filter((t) => !t.done);
  return {
    id: inc.id,
    number: inc.number,
    title: inc.title,
    severity: inc.severity,
    status: inc.status,
    hazard: inc.hazard,
    source: inc.source,
    commander: actorOf(inc.roles.commander),
    roles: inc.roles,
    assets: rows.length,
    exposureUsd: rows.reduce((s, r) => s + r.valueUsd, 0),
    varUsd: rows.reduce((s, r) => s + r.varUsd, 0),
    worstScore: rows[0]?.composite ?? null,
    centroid: inc.area ? areaCentroid(inc.area) : rows.length ? ([rows.reduce((s, r) => s + r.lat, 0) / rows.length, rows.reduce((s, r) => s + r.lon, 0) / rows.length] as [number, number]) : null,
    area: inc.area,
    tasksDone: inc.tasks.length - openTasks.length,
    tasksTotal: inc.tasks.length,
    overdueTasks: openTasks.filter((t) => t.dueAt && t.dueAt < now).length,
    createdAt: inc.createdAt,
    statusChangedAt: inc.statusChangedAt,
    acknowledgedAt: inc.acknowledgedAt,
    mobilisedAt: inc.mobilisedAt,
    resolvedAt: inc.resolvedAt,
    metrics: m,
    lastActivityAt: inc.timeline[inc.timeline.length - 1]?.at ?? inc.createdAt,
    publicEnabled: inc.publicEnabled,
    demo: inc.demo,
    assigneeIds: [...new Set([...Object.values(inc.roles), ...openTasks.map((t) => t.assigneeId)].filter((x): x is string => !!x))],
  };
}
export type IncidentListRow = ReturnType<typeof listRow>;

export function listIncidents(ws: string, f: { status?: IncidentStatus[]; severity?: Severity[]; hazard?: HazardType[]; q?: string; mine?: string | null; includeResolved?: boolean } = {}) {
  ensureSeeded();
  const now = new Date();
  const q = f.q?.trim().toLowerCase();
  const all = incidentState.incidents.filter((i) => i.workspaceId === ws);
  const rows = all
    .filter((i) => f.includeResolved !== false || i.status !== "resolved" || (i.resolvedAt && now.getTime() - i.resolvedAt.getTime() < 14 * 86_400_000))
    .filter((i) => !f.status?.length || f.status.includes(i.status))
    .filter((i) => !f.severity?.length || f.severity.includes(i.severity))
    .filter((i) => !f.hazard?.length || f.hazard.includes(i.hazard))
    .filter((i) => !q || `inc-${i.number} ${i.title} ${i.summary}`.toLowerCase().includes(q))
    .map((i) => listRow(i, now))
    .filter((r) => !f.mine || r.assigneeIds.includes(f.mine))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.createdAt.getTime() - a.createdAt.getTime());

  const active = all.filter((i) => i.status !== "resolved");
  const last90 = all.filter((i) => now.getTime() - i.createdAt.getTime() < 90 * 86_400_000);
  const summary = {
    active: active.length,
    sev12: active.filter((i) => i.severity === "SEV1" || i.severity === "SEV2").length,
    breached: active.reduce((s, i) => s + (incidentMetrics(i, now).breached > 0 ? 1 : 0), 0),
    medianTta: median(last90.map((i) => incidentMetrics(i, now).tta).filter((x): x is number => x != null)),
    medianTtr: median(last90.map((i) => incidentMetrics(i, now).ttr).filter((x): x is number => x != null)),
    resolved90: last90.filter((i) => i.status === "resolved").length,
    byStatus: Object.fromEntries(STATUSES.map((s) => [s, all.filter((i) => i.status === s).length])) as Record<IncidentStatus, number>,
    exposureUsd: active.reduce((s, i) => s + assetRows(ws, i.assetIds).reduce((t, r) => t + r.valueUsd, 0), 0),
  };
  return { rows, summary };
}

export function incidentDetail(ws: string, id: string) {
  const inc = getIncident(ws, id);
  const now = new Date();
  const assets = assetRows(ws, inc.assetIds);
  const members = workspaceMembers(ws);
  return {
    ...inc,
    timeline: [...inc.timeline].sort((a, b) => a.at.getTime() - b.at.getTime()).map((e) => ({ ...e, actor: actorOf(e.actorId, e.actorName) })),
    subscribers: inc.subscribers.map((s) => ({ id: s.id, kind: s.kind, address: maskAddress(s), createdAt: s.createdAt })),
    subscriberCounts: { email: inc.subscribers.filter((s) => s.kind === "email").length, sms: inc.subscribers.filter((s) => s.kind === "sms").length },
    assets,
    exposureUsd: assets.reduce((s, r) => s + r.valueUsd, 0),
    varUsd: assets.reduce((s, r) => s + r.varUsd, 0),
    metrics: incidentMetrics(inc, now),
    allowed: allowedTransitions(inc.status),
    warnings: Object.fromEntries(STATUSES.map((s) => [s, transitionWarnings(inc, s)])) as Record<IncidentStatus, string[]>,
    members,
    industry: industryOf(ws),
    publicPath: `/s/${inc.slug}`,
    nextUpdateDueAt: (() => {
      const last = inc.updates.filter((u) => u.state === "published").sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())[0];
      if (inc.status === "resolved") return null;
      return new Date((last?.publishedAt ?? inc.createdAt).getTime() + SEVERITY_META[inc.severity].updateEveryHours * 3_600_000);
    })(),
  };
}

/** Candidates for "open from…": recent firings and official alerts touching the workspace. */
export function sourceCandidates(ws: string) {
  ensureSeeded();
  const s = getStore();
  const linked = new Set(incidentState.incidents.filter((i) => i.workspaceId === ws).flatMap((i) => i.links.map((l) => l.id.split(":").pop()!)));
  const firings = portfolioState.firings
    .filter((f) => f.workspaceId === ws && f.trigger !== "test")
    .slice(0, 25)
    .map((f) => ({ id: f.id, ruleName: f.ruleName, severity: f.severity, at: f.at, matchCount: f.matchCount, linked: linked.has(f.id), draft: draftFromFiring(f) }));
  const assets = workspaceAssets(ws);
  const byDistrict = new Map<string, AssetRecord[]>();
  for (const a of assets) if (a.districtId) byDistrict.set(a.districtId, [...(byDistrict.get(a.districtId) ?? []), a]);
  const dName = new Map(s.districts.map((d) => [d.id, d]));
  const alerts = s.alerts
    .filter((al) => al.isActive && byDistrict.has(al.districtId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 25)
    .map((al) => {
      const d = dName.get(al.districtId);
      return { id: al.id, title: al.title, alertType: al.alertType, severity: al.severity, districtId: al.districtId, district: d?.name ?? al.districtId, lat: d?.lat ?? null, lon: d?.lon ?? null, createdAt: al.createdAt, source: al.source, assets: byDistrict.get(al.districtId)!.length, linked: linked.has(al.id) };
    });
  return { firings, alerts };
}

export function draftFromAlert(ws: string, alertId: string) {
  const s = getStore();
  const al = s.alerts.find((a) => a.id === alertId);
  if (!al) throw new IncidentError("NOT_FOUND", "Official alert not found");
  const d = s.districts.find((x) => x.id === al.districtId);
  const assetIds = workspaceAssets(ws).filter((a) => a.districtId === al.districtId).map((a) => a.id);
  if (!assetIds.length) throw new IncidentError("FORBIDDEN", "That alert does not cover any of your assets");
  const t = String(al.alertType);
  const hazard: HazardType = /cyclone|storm|surge/.test(t) ? "cyclone" : /salin/.test(t) ? "salinity" : /drought/.test(t) ? "drought" : /heat/.test(t) ? "heat" : /flood|rain/.test(t) ? "flood" : "other";
  return {
    title: `${al.title}${d ? ` — ${d.name}` : ""}`.slice(0, 160),
    hazard,
    severity: (al.severity === "emergency" ? "SEV1" : al.severity === "warning" ? "SEV2" : "SEV3") as Severity,
    summary: `${al.description}\n\nOfficial alert (${al.source}) valid ${al.validFrom.toISOString().slice(0, 10)} → ${al.validUntil.toISOString().slice(0, 10)}. Predicted impact: ${al.predictedImpact.farmsAffected.toLocaleString("en-US")} farms, ${al.predictedImpact.areaHa.toLocaleString("en-US")} ha.`,
    assetIds,
    area: d ? ({ type: "circle", lat: d.lat, lon: d.lon, radiusKm: 30 } as IncidentArea) : null,
    link: { kind: "alert" as const, id: al.id, label: al.title, href: null },
  };
}

// ─── Activity source ──────────────────────────────────────────────────────

registerActivitySource("incidents", (ws) => {
  ensureSeeded();
  const out: ActivityItem[] = [];
  for (const inc of incidentState.incidents) {
    if (inc.workspaceId !== ws) continue;
    for (const e of inc.timeline) {
      if (!["created", "status", "severity", "update", "review", "ack"].includes(e.kind) && !(e.kind === "task" && e.text.startsWith("Done:"))) continue;
      out.push({
        id: `inc:${inc.id}:${e.id}`,
        at: e.at,
        category: "incident",
        actor: actorOf(e.actorId, e.actorName),
        actorLabel: e.actorName,
        verb: e.kind === "created" ? "opened an incident" : e.kind === "status" ? "moved an incident" : e.kind === "update" ? "published a stakeholder update" : e.kind === "review" ? "completed a review" : e.kind === "ack" ? "acknowledged" : e.kind === "task" ? "completed a task" : "changed severity",
        title: `INC-${inc.number} ${inc.title}`,
        detail: e.text,
        href: `/app/incidents/${inc.id}`,
        severity: e.kind === "created" ? (inc.severity === "SEV1" ? "critical" : inc.severity === "SEV2" ? "warning" : "info") : e.text.includes("Resolved") ? "success" : "info",
      });
    }
  }
  return out;
});

// ─── Auto-open hook (critical rule → incident) ────────────────────────────

/**
 * Server-side listener on the realtime bus: when the portfolio monitor publishes
 * `rule.fired` with severity "critical" on `ws:<orgId>` and that workspace has
 * `autoOpenCritical` enabled, open (or extend) an incident. Re-registered on hot reload.
 */
function onBusEvent(env: RealtimeEnvelope) {
  const ev = env.event as { type: string; severity?: string; workspaceId?: string; firingId?: string };
  if (ev.type !== "rule.fired" || ev.severity !== "critical" || !ev.workspaceId || !ev.firingId) return;
  if (!settingsFor(ev.workspaceId).autoOpenCritical) return;
  const firingId = ev.firingId;
  // The firing is pushed to history right before the publish; defer a tick to be safe
  setTimeout(() => {
    try {
      if (portfolioState.firings.some((f) => f.id === firingId)) openIncidentFromFiring(firingId, { auto: true });
    } catch (e) {
      console.warn("[incidents] auto-open failed:", (e as Error).message);
    }
  }, 0);
}
if (!process.env.VITEST) {
  if (g.__agriIncidentListener) bus.off("event", g.__agriIncidentListener);
  g.__agriIncidentListener = onBusEvent;
  bus.on("event", onBusEvent);
}

// ─── Demo seed ────────────────────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function ensureSeeded() {
  if (incidentState.seeded) return;
  incidentState.seeded = true;
  try {
    seedDemoIncidents(new Date());
  } catch (e) {
    console.warn("[incidents] demo seed failed:", (e as Error).message);
  }
}

/** Three clearly-labelled demo incidents with timelines, tasks, updates and comments. */
export function seedDemoIncidents(now: Date) {
  const H = 3_600_000;
  const ago = (h: number) => new Date(now.getTime() - h * H);
  const s = getStore();
  const pickAssets = (ws: string, pred: (a: AssetRecord) => boolean, n: number) => workspaceAssets(ws).filter(pred).slice(0, n);
  const user = (id: string) => ({ id, name: userName(id) });
  const markDone = (inc: Incident, n: number, byId: string, startH: number) => {
    inc.tasks.slice(0, n).forEach((t, k) => {
      t.done = true;
      t.doneAt = ago(startH - k * 1.5);
      t.doneBy = t.assigneeId ?? byId;
      inc.timeline.push({ id: tid(), at: t.doneAt, kind: "task", actorId: t.doneBy, actorName: userName(t.doneBy), text: `Done: ${t.title}` });
    });
  };
  const publishSeed = (inc: Incident, by: string, h: number, title: string, body: string) => {
    const at = ago(h);
    inc.updates.push({ id: `upd_${randomUUID().slice(0, 8)}`, state: "published", status: inc.status, title, body, createdAt: at, createdBy: by, createdByName: userName(by), publishedAt: at, channels: ["page", "email"], deliveries: { email: inc.subscribers.filter((x) => x.kind === "email").length, sms: 0 } });
    inc.publicEnabled = true;
    inc.timeline.push({ id: tid(), at, kind: "update", actorId: by, actorName: userName(by), text: `Stakeholder update published: "${title}"` });
  };
  const moveTo = (inc: Incident, to: IncidentStatus, by: string, h: number, note?: string) => applyTransition(inc, to, user(by), ago(h), note);

  // 1 · Insurer — Satkhira embankment breach (SEV1, Responding)
  const INS = "org-ins-deltamutual";
  if (s.orgs.some((o) => o.id === INS)) {
    const sat = s.districts.find((d) => d.id === "bd-satkhira");
    const center: [number, number] = sat ? [sat.lat, sat.lon] : [22.72, 89.07];
    const assets = pickAssets(INS, (a) => a.districtId === "bd-satkhira", 14);
    const inc = createIncident(INS, user("user-insurer-demo"), {
      title: "Satkhira embankment breach — Aman insured units",
      summary: "[Demo scenario] A 300 m section of the polder embankment on the Kholpetua river breached at high tide after three days of heavy rain. Saline tidal water is entering Aman paddy at tillering stage across insured village clusters in Shyamnagar and Assasuni upazilas.",
      severity: "SEV1",
      hazard: "flood",
      assetIds: assets.map((a) => a.id),
      area: { type: "circle", lat: center[0], lon: center[1], radiusKm: 28 },
      includeAreaAssets: false,
      roles: { commander: "user-insurer-demo", fieldLead: "user-insurer-analyst", comms: "user-insurer-demo" },
      source: { kind: "rule_firing", refId: "rule_002", label: "Flood exposure — coastal book" },
      links: [{ kind: "firing", id: "rule_002:seed", label: "Flood exposure — coastal book · 14 asset(s)", href: "/app/alerts?rule=rule_002" }],
      at: ago(30),
      demo: true,
      silent: true,
    });
    inc.subscribers.push({ id: "sub_demo1", kind: "email", address: "partners@example.org", createdAt: ago(20) }, { id: "sub_demo2", kind: "sms", address: "+8801700000001", createdAt: ago(18) });
    acknowledge(inc, user("user-insurer-analyst"), ago(29.85));
    moveTo(inc, "mobilising", "user-insurer-demo", 29.2, "Loss adjusters on standby in Khulna");
    addNoteSeed(inc, "user-insurer-analyst", 28, "Field contact in Gabura confirms water over the road at the Shyamnagar–Munshiganj junction. Sending photos.");
    markDone(inc, 3, "user-insurer-analyst", 27);
    publishSeed(inc, "user-insurer-demo", 26, "Embankment breach at Shyamnagar — claims desk open", "An embankment breach on the Kholpetua river is flooding Aman paddy in parts of Shyamnagar and Assasuni. Our claims desk is open and loss adjusters are deploying from Khulna.\n\nPolicy-holders do not need to file anything yet: our field team will visit every affected village cluster. Next update within 6 hours.");
    moveTo(inc, "responding", "user-insurer-demo", 24, "Adjusters deployed to 6 unions");
    addNoteSeed(inc, "user-insurer-demo", 20, "Water Development Board expects the breach closed with sandbags within 48 h. Parametric rainfall trigger not reached (118 mm vs 150 mm) — indemnity route for these units.");
    markDoneFrom(inc, 3, 2, "user-insurer-analyst", 18);
    publishSeed(inc, "user-insurer-demo", 8, "Adjusters on the ground in 6 unions", "Loss adjusters have visited 6 unions and recorded damage on 9 of 14 insured village clusters. Water is receding in Assasuni; Shyamnagar remains flooded.\n\nNext update by 18:00 local time.");
    addComment(INS, user("user-insurer-analyst"), { entityType: "incident", entityId: inc.id, body: "Uploaded the before/after MODIS flood layer for Gabura — 9 of 14 units show standing water. @[Arif Rahman](user-insurer-demo) should we switch the remaining 5 to desk assessment?", at: ago(7), demo: true, silent: true });
    addComment(INS, user("user-insurer-demo"), { entityType: "incident", entityId: inc.id, body: "Yes — desk-assess with the Sentinel-2 composite, field-visit only if the farmer disputes. @claims please draft the reinsurer notice today.", at: ago(6.5), demo: true, silent: true });
  }

  // 2 · NGO — Cyclone readiness, Khulna coast (SEV2, Mobilising)
  const NGO = "org-ngo-brac";
  if (s.orgs.some((o) => o.id === NGO)) {
    const coastal = ["bd-khulna", "bd-satkhira", "bd-bagerhat"];
    const assets = pickAssets(NGO, (a) => coastal.includes(a.districtId ?? ""), 18);
    const inc = createIncident(NGO, user("user-ngo-demo"), {
      title: "Cyclone readiness — Khulna coast",
      summary: "[Demo scenario] A depression in the Bay of Bengal is forecast to intensify into a cyclonic storm with landfall between Satkhira and Barguna in ~60 h. Anticipatory-action protocol: pre-position cash and shelter support for coastal communities before landfall.",
      severity: "SEV2",
      hazard: "cyclone",
      assetIds: assets.map((a) => a.id),
      area: { type: "polygon", coords: [[22.95, 88.95], [22.95, 89.85], [21.85, 90.05], [21.75, 89.0]] },
      includeAreaAssets: false,
      roles: { commander: "user-ngo-demo", fieldLead: "user-ngo-demo", comms: "user-ngo-demo" },
      source: { kind: "official_alert", refId: null, label: "Bangladesh Meteorological Department — cyclone watch" },
      at: ago(10),
      demo: true,
      silent: true,
    });
    moveTo(inc, "mobilising", "user-ngo-demo", 9.5, "Activation threshold met: 72 h flood probability > 50 %");
    markDone(inc, 2, "user-ngo-demo", 8);
    addNoteSeed(inc, "user-ngo-demo", 6, "Union disaster committees in Dacope and Koyra confirmed shelter keys and generator fuel. 4 shelters need drinking-water top-up.");
    publishSeed(inc, "user-ngo-demo", 5, "Cyclone readiness activated for 18 coastal communities", "We have activated our anticipatory-action plan for 18 communities on the Khulna coast. Cash transfers to pre-registered households will start once the storm is 48 h from landfall. Shelters are being checked today.");
    addComment(NGO, user("user-ngo-demo"), { entityType: "incident", entityId: inc.id, body: "Cash partner confirmed bKash disbursement window opens at T-48h. Keeping the SMS script in Bangla ready for comms.", at: ago(4), demo: true, silent: true });
  }

  // 3 · Bank — Mekong salinity, rice borrowers (SEV3, Monitoring)
  const BANK = "org-bank-mekong";
  if (s.orgs.some((o) => o.id === BANK)) {
    const assets = pickAssets(BANK, (a) => ["vn-bentre", "vn-soctrang", "vn-travinh"].includes(a.districtId ?? "") && a.crop === "rice", 12);
    const center = assets.length ? ([assets.reduce((t, a) => t + a.lat, 0) / assets.length, assets.reduce((t, a) => t + a.lon, 0) / assets.length] as [number, number]) : ([9.95, 106.2] as [number, number]);
    const inc = createIncident(BANK, user("user-bank-demo"), {
      title: "Mekong salinity — rice borrowers",
      summary: "[Demo scenario] Salinity intrusion reached 45–60 km inland on the Hàm Luông and Hậu rivers, earlier than the seasonal norm. Rice borrowers irrigating from canals at high tide face yield losses on the winter–spring crop.",
      severity: "SEV3",
      hazard: "salinity",
      assetIds: assets.map((a) => a.id),
      area: { type: "circle", lat: center[0], lon: center[1], radiusKm: 45 },
      includeAreaAssets: false,
      roles: { commander: "user-bank-demo", fieldLead: "user-bank-analyst", comms: "user-bank-analyst" },
      source: { kind: "rule_firing", refId: "rule_003", label: "Salinity stress on rice borrowers" },
      links: [{ kind: "firing", id: "rule_003:seed", label: "Salinity stress on rice borrowers · 11 asset(s)", href: "/app/alerts?rule=rule_003" }],
      at: ago(120),
      demo: true,
      silent: true,
    });
    acknowledge(inc, user("user-bank-analyst"), ago(119.2));
    moveTo(inc, "mobilising", "user-bank-demo", 110);
    markDone(inc, 4, "user-bank-analyst", 100);
    moveTo(inc, "responding", "user-bank-demo", 96, "Branch officers contacting 12 borrowers");
    publishSeed(inc, "user-bank-analyst", 95, "Support for rice borrowers affected by salinity", "Borrowers in Bến Tre and Sóc Trăng affected by early salinity intrusion can request a repayment reschedule of up to 3 months at no fee. Branch officers will call every affected customer this week.");
    moveTo(inc, "monitoring", "user-bank-demo", 48, "11 of 12 borrowers contacted; 4 reschedules approved");
    addNoteSeed(inc, "user-bank-analyst", 30, "Salinity at Mỹ Tho station back below 1 g/L after upstream release; keep monitoring until the next spring tide.");
    addComment(BANK, user("user-bank-analyst"), { entityType: "incident", entityId: inc.id, body: "@[Trần Minh Khoa](user-bank-demo) 4 reschedules approved, total outstanding ≈ USD 9.8k. One borrower unreachable — branch visiting Thursday.", at: ago(29), demo: true, silent: true });
  }

  // Seed counters so new incidents continue after the demo numbers
  for (const inc of incidentState.incidents) incidentState.counters.set(inc.workspaceId, Math.max(incidentState.counters.get(inc.workspaceId) ?? 100, inc.number));
}

function addNoteSeed(inc: Incident, by: string, h: number, text: string) {
  inc.timeline.push({ id: tid(), at: new Date(Date.now() - h * 3_600_000), kind: "note", actorId: by, actorName: userName(by), text });
}

function markDoneFrom(inc: Incident, from: number, n: number, by: string, h: number) {
  inc.tasks.slice(from, from + n).forEach((t, k) => {
    t.done = true;
    t.doneAt = new Date(Date.now() - (h - k) * 3_600_000);
    t.doneBy = t.assigneeId ?? by;
    inc.timeline.push({ id: tid(), at: t.doneAt, kind: "task", actorId: t.doneBy, actorName: userName(t.doneBy), text: `Done: ${t.title}` });
  });
}
