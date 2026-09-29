/**
 * Incident vocabulary shared by server and client (pure — no server imports):
 * severities with plain-language meaning, lifecycle states, hazards, roles, SLA targets,
 * transition rules and duration formatting.
 */

// ─── Vocabulary ───────────────────────────────────────────────────────────

export type IncidentArea = { type: "circle"; lat: number; lon: number; radiusKm: number } | { type: "polygon"; coords: [number, number][] };

export const SEVERITIES = ["SEV1", "SEV2", "SEV3", "SEV4"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = ["investigating", "mobilising", "responding", "monitoring", "resolved"] as const;
export type IncidentStatus = (typeof STATUSES)[number];

export const HAZARDS = ["flood", "cyclone", "salinity", "drought", "heat", "other"] as const;
export type HazardType = (typeof HAZARDS)[number];

export const ROLES = ["commander", "fieldLead", "comms"] as const;
export type IncidentRole = (typeof ROLES)[number];

export const SEVERITY_META: Record<Severity, { label: string; short: string; meaning: string; updateEveryHours: number; color: string }> = {
  SEV1: { label: "SEV1 · Critical", short: "Critical", meaning: "Lives, livelihoods or a large share of your exposure are at immediate risk. All hands: leadership informed, field teams deployed, stakeholder updates at least every 6 hours.", updateEveryHours: 6, color: "#f43f5e" },
  SEV2: { label: "SEV2 · Major", short: "Major", meaning: "Significant losses are likely across many assets or communities. A dedicated response team works on it today; updates every 12 hours.", updateEveryHours: 12, color: "#f97316" },
  SEV3: { label: "SEV3 · Moderate", short: "Moderate", meaning: "Localised impact on a few assets. Handled by the regular team within working hours; daily updates.", updateEveryHours: 24, color: "#fbbf24" },
  SEV4: { label: "SEV4 · Minor / watch", short: "Minor", meaning: "Possible impact — watch and prepare. No field deployment yet; update when something changes.", updateEveryHours: 72, color: "#38bdf8" },
};

export const STATUS_META: Record<IncidentStatus, { label: string; meaning: string; color: string }> = {
  investigating: { label: "Investigating", meaning: "Confirming what is happening, where, and who is affected.", color: "#f472b6" },
  mobilising: { label: "Mobilising", meaning: "Team, money and supplies are being assembled; field teams on standby.", color: "#fbbf24" },
  responding: { label: "Responding", meaning: "Action under way on the ground — evacuation, cash transfers, claims triage, farmer advisories.", color: "#f97316" },
  monitoring: { label: "Monitoring", meaning: "The hazard has passed or is contained. Watching for recurrence and tracking recovery.", color: "#38bdf8" },
  resolved: { label: "Resolved", meaning: "Closed. Capture lessons in the post-incident review.", color: "#34d399" },
};

export const HAZARD_META: Record<HazardType, { label: string; icon: string }> = {
  flood: { label: "Flood", icon: "waves" },
  cyclone: { label: "Cyclone / storm surge", icon: "tornado" },
  salinity: { label: "Salinity intrusion", icon: "droplet" },
  drought: { label: "Drought", icon: "sun" },
  heat: { label: "Extreme heat", icon: "thermometer" },
  other: { label: "Other hazard", icon: "alert" },
};

export const ROLE_META: Record<IncidentRole, { label: string; meaning: string }> = {
  commander: { label: "Incident commander", meaning: "Owns the incident: sets severity, makes the calls, keeps the timeline honest." },
  fieldLead: { label: "Field lead", meaning: "Coordinates people on the ground — surveyors, adjusters, loan officers, volunteers." },
  comms: { label: "Comms", meaning: "Writes stakeholder updates (public page, partners, regulators) and farmer messages." },
};

/** Minutes. Targets a buyer would write into an operations SLA. */
export const SLA_TARGETS: Record<Severity, { ack: number; mobilise: number; resolve: number }> = {
  SEV1: { ack: 15, mobilise: 60, resolve: 72 * 60 },
  SEV2: { ack: 30, mobilise: 4 * 60, resolve: 7 * 24 * 60 },
  SEV3: { ack: 4 * 60, mobilise: 24 * 60, resolve: 14 * 24 * 60 },
  SEV4: { ack: 24 * 60, mobilise: 72 * 60, resolve: 30 * 24 * 60 },
};


export const statusIndex = (s: IncidentStatus) => STATUSES.indexOf(s);

/**
 * Forward moves may skip steps (a flash flood can go straight to Responding); backward
 * moves are one step at a time (e.g. Monitoring → Responding when water rises again);
 * a Resolved incident can be reopened to any active state.
 */
export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  if (from === to) return false;
  if (from === "resolved") return true;
  const d = statusIndex(to) - statusIndex(from);
  return d > 0 || d === -1;
}

export function allowedTransitions(from: IncidentStatus): IncidentStatus[] {
  return STATUSES.filter((s) => canTransition(from, s));
}


export function fmtMinutes(min: number | null | undefined): string {
  if (min == null) return "—";
  const m = Math.round(Math.abs(min));
  const s = min < 0 && m > 0 ? "-" : "";
  if (m < 60) return `${s}${m}m`;
  if (m < 48 * 60) return `${s}${Math.floor(m / 60)}h ${m % 60}m`;
  const h = Math.round(m / 60);
  return `${s}${Math.floor(h / 24)}d ${h % 24}h`;
}


// ─── Pure: SLA metrics ────────────────────────────────────────────────────

export interface SlaClock {
  key: "ack" | "mobilise" | "resolve";
  label: string;
  targetMin: number;
  elapsedMin: number;
  /** minutes left (negative = overdue); null when done */
  remainingMin: number | null;
  done: boolean;
  state: "met" | "breached" | "running" | "at_risk";
}

const minutesBetween = (a: Date | string, b: Date | string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60_000);

export function incidentMetrics(inc: { createdAt: Date | string; acknowledgedAt: Date | string | null; mobilisedAt: Date | string | null; resolvedAt: Date | string | null; severity: Severity }, now = new Date()) {
  const t = SLA_TARGETS[inc.severity];
  const clock = (key: SlaClock["key"], label: string, stamp: Date | string | null, target: number): SlaClock => {
    const end = stamp ?? now;
    const elapsed = minutesBetween(inc.createdAt, end);
    const done = !!stamp;
    const state: SlaClock["state"] = done ? (elapsed <= target ? "met" : "breached") : elapsed > target ? "breached" : elapsed >= target * 0.75 ? "at_risk" : "running";
    return { key, label, targetMin: target, elapsedMin: Math.round(elapsed * 10) / 10, remainingMin: done ? null : Math.round((target - elapsed) * 10) / 10, done, state };
  };
  // A resolved incident that skipped straight to Resolved still counts as acknowledged/mobilised at resolution
  const ack = clock("ack", "Time to acknowledge", inc.acknowledgedAt ?? inc.resolvedAt, t.ack);
  const mob = clock("mobilise", "Time to mobilise", inc.mobilisedAt ?? inc.resolvedAt, t.mobilise);
  const res = clock("resolve", "Time to resolve", inc.resolvedAt, t.resolve);
  const clocks = [ack, mob, res];
  return {
    tta: inc.acknowledgedAt ? minutesBetween(inc.createdAt, inc.acknowledgedAt) : null,
    ttm: inc.mobilisedAt ? minutesBetween(inc.createdAt, inc.mobilisedAt) : null,
    ttr: inc.resolvedAt ? minutesBetween(inc.createdAt, inc.resolvedAt) : null,
    clocks,
    breached: clocks.filter((c) => c.state === "breached").length,
    /** The clock the team should watch right now */
    next: clocks.find((c) => !c.done) ?? null,
  };
}

