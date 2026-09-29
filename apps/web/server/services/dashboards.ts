/**
 * Custom dashboards — every workspace can build its own mission-control
 * screens from the widget catalogue (components/dashboards/catalog.ts).
 *
 *   list / get / create (blank · template · duplicate) / update / delete
 *   set default · tokenised read-only share links · per-dashboard refresh
 *
 * Side-car state on globalThis (survives hot reload), mirrored to a JSON file
 * in the OS temp dir so dashboards and share links survive a dev-server
 * restart (swap for the DB in production). Each workspace gets one dashboard
 * from its industry template on first visit so the page is never empty.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Industry } from "@agri-shield/types";
import { audit, getStore } from "../data/store";
import { WIDGETS, type Widget, type WidgetKind } from "@/components/dashboards/catalog";
import { clampItem, compact } from "@/components/dashboards/grid";

export interface DashboardRecord {
  id: string;
  orgId: string;
  name: string;
  description: string;
  widgets: Widget[];
  isDefault: boolean;
  /** auto-refresh cadence in seconds (0 = off) */
  refreshSec: number;
  shareToken: string | null;
  sharedAt: Date | null;
  shareViews: number;
  templateId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  updatedByName: string;
}

export class DashboardError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "BAD_REQUEST" = "BAD_REQUEST"
  ) {
    super(message);
  }
}

export const MAX_WIDGETS = 40;
export const MAX_DASHBOARDS = 30;

// ─── Templates ────────────────────────────────────────────────────────────

type TW = Omit<Widget, "id" | "minW" | "minH">;
const tw = (kind: WidgetKind, x: number, y: number, w: number, h: number, title: string, config: Widget["config"] = {}): TW => ({ kind, x, y, w, h, title, config: { ...WIDGETS[kind].defaults, ...config } });

export interface DashboardTemplate {
  id: string;
  name: string;
  industry: Industry | null;
  audience: string;
  description: string;
  widgets: TW[];
}

export const TEMPLATES: DashboardTemplate[] = [
  {
    id: "insurer-ops",
    name: "Insurer ops",
    industry: "insurance",
    audience: "Underwriting & claims teams",
    description: "Sum insured, value at risk, rules in alarm and satellite-observed flooding across the insured book, with the plots that need attention first.",
    widgets: [
      tw("kpi", 0, 0, 3, 2, "Sum insured", { metric: "insured_sum" }),
      tw("kpi", 3, 0, 3, 2, "Value at risk", { metric: "var" }),
      tw("kpi", 6, 0, 3, 2, "Rules in alarm", { metric: "active_alerts" }),
      tw("kpi", 9, 0, 3, 2, "Observed flooded (satellite)", { metric: "observed_flooded" }),
      tw("map", 0, 2, 7, 5, "Insured units by composite risk", { metric: "composite", mapMode: "points" }),
      tw("table", 7, 2, 5, 5, "Insured units with the highest value at risk", { metric: "var", limit: 8 }),
      tw("timeseries", 0, 7, 6, 4, "Book composite trend (30 days)", { series: "composite", days: 30 }),
      tw("bar", 6, 7, 6, 4, "Value at risk by hazard", { dimension: "hazard", measure: "var" }),
      tw("gauge", 0, 11, 3, 4, "% of book at risk", { metric: "pct_at_risk" }),
      tw("kpi", 3, 11, 3, 2, "Annual expected loss", { metric: "expected_loss" }),
      tw("kpi", 3, 13, 3, 2, "Rule firings (7 days)", { metric: "rule_firings", days: 7 }),
      tw("hazards", 6, 11, 6, 4, "Disasters near insured plots"),
    ],
  },
  {
    id: "credit-risk",
    name: "Credit risk",
    industry: "banking",
    audience: "Agri-lending & credit risk",
    description: "Loan-book exposure, VaR ratio, borrowers above the risk threshold and concentration by country and crop — for early-warning and provisioning conversations.",
    widgets: [
      tw("kpi", 0, 0, 3, 2, "Loan exposure", { metric: "exposure" }),
      tw("kpi", 3, 0, 3, 2, "Exposure at risk", { metric: "exposure_at_risk" }),
      tw("kpi", 6, 0, 3, 2, "Borrowers at risk", { metric: "at_risk" }),
      tw("gauge", 9, 0, 3, 4, "VaR as % of exposure", { metric: "var_ratio" }),
      tw("kpi", 0, 2, 3, 2, "Value at risk", { metric: "var" }),
      tw("kpi", 3, 2, 3, 2, "Rules in alarm", { metric: "active_alerts" }),
      tw("kpi", 6, 2, 3, 2, "Critical borrowers", { metric: "critical_assets" }),
      tw("map", 0, 4, 6, 5, "Districts by average composite", { metric: "composite", mapMode: "choropleth" }),
      tw("table", 6, 4, 6, 5, "Loans with the highest value at risk", { metric: "var", limit: 8 }),
      tw("bar", 0, 9, 6, 4, "Exposure by crop", { dimension: "crop", measure: "exposure" }),
      tw("timeseries", 6, 9, 6, 4, "Borrowers at risk (30 days)", { series: "at_risk", days: 30 }),
    ],
  },
  {
    id: "ngo-readiness",
    name: "NGO readiness",
    industry: "ngo",
    audience: "Anticipatory action & programme teams",
    description: "Which communities face flood risk in the next 72 hours, what the rules and satellites say, and the local 7-day outlook — the morning readiness check.",
    widgets: [
      tw("kpi", 0, 0, 3, 2, "Communities monitored", { metric: "assets" }),
      tw("kpi", 3, 0, 3, 2, "Communities at risk", { metric: "at_risk" }),
      tw("kpi", 6, 0, 3, 2, "Readiness rules in alarm", { metric: "active_alerts" }),
      tw("kpi", 9, 0, 3, 2, "Observed flooded (satellite)", { metric: "observed_flooded" }),
      tw("map", 0, 2, 7, 5, "Communities by flood score", { metric: "flood", mapMode: "points" }),
      tw("table", 7, 2, 5, 5, "Communities with the highest flood score", { metric: "flood", limit: 8 }),
      tw("forecast", 0, 7, 6, 3, "7-day outlook"),
      tw("hazards", 6, 7, 6, 4, "GDACS / EONET events nearby"),
      tw("timeseries", 0, 10, 6, 4, "Communities at risk (30 days)", { series: "at_risk", days: 30 }),
      tw("notifications", 6, 11, 6, 4, "Latest alerts"),
      tw("note", 0, 14, 6, 3, "Readiness checklist", { text: "## Morning readiness check\n1. Any community **above threshold**? Open it in Portfolio.\n2. Check the **7-day outlook** and GDACS events.\n3. If the trigger is near, pre-position cash and alert field teams in **Anticipatory Action**." }),
    ],
  },
  {
    id: "agri-sourcing",
    name: "Agribusiness sourcing",
    industry: "agribusiness",
    audience: "Sourcing, logistics & procurement",
    description: "Facility and sourcing-region risk by crop and asset type, live disasters near the supply chain and the facilities most exposed right now.",
    widgets: [
      tw("kpi", 0, 0, 3, 2, "Asset value", { metric: "exposure" }),
      tw("kpi", 3, 0, 3, 2, "Value at risk", { metric: "var" }),
      tw("kpi", 6, 0, 3, 2, "Critical sites", { metric: "critical_assets" }),
      tw("gauge", 9, 0, 3, 4, "Average composite", { metric: "avg_composite" }),
      tw("kpi", 0, 2, 3, 2, "Average flood score", { metric: "flood_avg" }),
      tw("kpi", 3, 2, 3, 2, "Average heat score", { metric: "heat_avg" }),
      tw("kpi", 6, 2, 3, 2, "Rules in alarm", { metric: "active_alerts" }),
      tw("map", 0, 4, 7, 5, "Supply sites by composite risk", { metric: "composite" }),
      tw("hazards", 7, 4, 5, 5, "Disasters near the supply chain"),
      tw("bar", 0, 9, 6, 4, "Average composite by crop", { dimension: "crop", measure: "avg_composite" }),
      tw("bar", 6, 9, 6, 4, "Exposure by asset type", { dimension: "type", measure: "exposure" }),
      tw("table", 0, 13, 12, 4, "Most exposed sites", { metric: "composite", limit: 6 }),
    ],
  },
  {
    id: "gov-overview",
    name: "Government overview",
    industry: "government",
    audience: "Disaster management & agriculture departments",
    description: "District choropleth of flood risk, live disasters, the 7-day outlook and latest alerts for situation-room screens.",
    widgets: [
      tw("map", 0, 0, 8, 6, "Districts by flood risk", { metric: "flood", mapMode: "choropleth" }),
      tw("kpi", 8, 0, 4, 2, "Average composite score", { metric: "avg_composite" }),
      tw("kpi", 8, 2, 4, 2, "Rules in alarm", { metric: "active_alerts" }),
      tw("kpi", 8, 4, 4, 2, "Notifications (rule firings, 7 d)", { metric: "rule_firings", days: 7 }),
      tw("hazards", 0, 6, 6, 4, "Live disasters (GDACS / EONET)"),
      tw("forecast", 6, 6, 6, 3, "7-day outlook"),
      tw("bar", 0, 10, 6, 4, "Assets by district", { dimension: "district", measure: "count" }),
      tw("notifications", 6, 9, 6, 5, "Latest notifications"),
    ],
  },
  {
    id: "coop-field",
    name: "Co-operative field ops",
    industry: "cooperative",
    audience: "Producer co-operatives & extension teams",
    description: "Member farms at risk, drought and flood pressure, the local outlook and the farms to visit first.",
    widgets: [
      tw("kpi", 0, 0, 3, 2, "Member farms", { metric: "assets" }),
      tw("kpi", 3, 0, 3, 2, "Farms at risk", { metric: "at_risk" }),
      tw("kpi", 6, 0, 3, 2, "Average drought score", { metric: "drought_avg" }),
      tw("kpi", 9, 0, 3, 2, "Average flood score", { metric: "flood_avg" }),
      tw("map", 0, 2, 7, 5, "Member farms by composite risk", { metric: "composite" }),
      tw("table", 7, 2, 5, 5, "Farms to visit first", { metric: "composite", limit: 8 }),
      tw("forecast", 0, 7, 6, 3, "7-day outlook"),
      tw("bar", 6, 7, 6, 4, "Farms by risk level", { dimension: "level", measure: "count" }),
      tw("timeseries", 0, 10, 6, 4, "Average composite (30 days)", { series: "composite", days: 30 }),
    ],
  },
];

export const TEMPLATE_BY_INDUSTRY: Record<string, string> = {
  insurance: "insurer-ops",
  banking: "credit-risk",
  ngo: "ngo-readiness",
  agribusiness: "agri-sourcing",
  government: "gov-overview",
  cooperative: "coop-field",
};

// ─── State ────────────────────────────────────────────────────────────────

interface DashState {
  byOrg: Map<string, DashboardRecord[]>;
  loaded: boolean;
  seq: number;
}
const g = globalThis as unknown as { __agriDashboards?: DashState };
const state: DashState = (g.__agriDashboards ??= { byOrg: new Map(), loaded: false, seq: 0 });

const FILE = join(process.env.AGRI_CACHE_DIR ?? join(tmpdir(), "agri-shield-cache"), "dashboards.json");
const persistEnabled = () => process.env.AGRI_OFFLINE !== "true";

function load() {
  if (state.loaded) return;
  state.loaded = true;
  if (!persistEnabled()) return;
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as DashboardRecord[];
    for (const d of raw) {
      const rec: DashboardRecord = { ...d, createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt), sharedAt: d.sharedAt ? new Date(d.sharedAt) : null };
      const list = state.byOrg.get(rec.orgId) ?? [];
      if (!list.some((x) => x.id === rec.id)) list.push(rec);
      state.byOrg.set(rec.orgId, list);
    }
  } catch {
    /* first run */
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  if (!persistEnabled()) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      mkdirSync(join(FILE, ".."), { recursive: true });
      writeFileSync(FILE, JSON.stringify([...state.byOrg.values()].flat()));
    } catch {
      /* read-only FS: memory only */
    }
  }, 300);
}

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(state.seq++).toString(36)}${randomBytes(3).toString("hex")}`;
export const newShareToken = () => randomBytes(18).toString("base64url");

// ─── Sanitising ───────────────────────────────────────────────────────────

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : undefined);

/** Allowed embed targets: this app's share pages or https URLs. */
export function safeEmbedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (/^\/(r|d)\/[A-Za-z0-9_-]{4,80}$/.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function sanitizeWidgets(input: Widget[]): Widget[] {
  const seen = new Set<string>();
  const cleaned = input.slice(0, MAX_WIDGETS).map((w) => {
    const meta = WIDGETS[w.kind];
    let id = typeof w.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(w.id) ? w.id : newId("w");
    if (seen.has(id)) id = newId("w");
    seen.add(id);
    const c = w.config ?? {};
    const config: Widget["config"] = {
      ...c,
      text: clip(c.text, 4000),
      url: c.url != null ? safeEmbedUrl(c.url) : c.url,
      filters: c.filters ? { tags: c.filters.tags?.slice(0, 20), types: c.filters.types?.slice(0, 12), countries: c.filters.countries?.slice(0, 20) } : undefined,
      place: c.place ? { lat: Math.max(-90, Math.min(90, c.place.lat)), lon: Math.max(-180, Math.min(180, c.place.lon)), name: clip(c.place.name, 120) ?? "Place" } : c.place,
    };
    for (const k of Object.keys(config) as (keyof typeof config)[]) if (config[k] === undefined) delete config[k];
    return clampItem({ ...w, id, title: clip(w.title, 120) || meta.defaultTitle, minW: meta.size.minW, minH: meta.size.minH, config });
  });
  return compact(cleaned);
}

function fromTemplate(t: DashboardTemplate): Widget[] {
  return sanitizeWidgets(t.widgets.map((w) => ({ ...w, id: newId("w"), minW: WIDGETS[w.kind].size.minW, minH: WIDGETS[w.kind].size.minH })));
}

// ─── Queries & mutations ──────────────────────────────────────────────────

type Who = { id: string; name: string };

function orgIndustry(orgId: string): Industry | null {
  const org = getStore().orgs.find((o) => o.id === orgId);
  if (!org) return null;
  if (org.industry) return org.industry;
  return org.type === "government" ? "government" : org.type === "bank" ? "banking" : org.type === "supply_chain" ? "agribusiness" : org.type === "ngo" ? "ngo" : org.type === "cooperative" ? "cooperative" : org.type === "insurance" ? "insurance" : null;
}

export function defaultTemplateFor(orgId: string): DashboardTemplate {
  const ind = orgIndustry(orgId);
  return TEMPLATES.find((t) => t.id === TEMPLATE_BY_INDUSTRY[ind ?? ""]) ?? TEMPLATES[0]!;
}

function ensureSeeded(orgId: string): DashboardRecord[] {
  load();
  let list = state.byOrg.get(orgId);
  if (!list) {
    const t = defaultTemplateFor(orgId);
    const now = new Date();
    list = [
      {
        id: newId("dash"),
        orgId,
        name: `${t.name} — mission control`,
        description: t.description,
        widgets: fromTemplate(t),
        isDefault: true,
        refreshSec: 60,
        shareToken: null,
        sharedAt: null,
        shareViews: 0,
        templateId: t.id,
        createdBy: "system",
        createdByName: "Agri-SHIELD (starter)",
        createdAt: now,
        updatedAt: now,
        updatedByName: "Agri-SHIELD (starter)",
      },
    ];
    state.byOrg.set(orgId, list);
    save();
  }
  return list;
}

export function listDashboards(orgId: string) {
  return ensureSeeded(orgId)
    .slice()
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((d) => ({ id: d.id, name: d.name, description: d.description, isDefault: d.isDefault, widgets: d.widgets.length, kinds: [...new Set(d.widgets.map((w) => w.kind))], refreshSec: d.refreshSec, shared: !!d.shareToken, templateId: d.templateId, updatedAt: d.updatedAt, updatedByName: d.updatedByName }));
}

export function getDashboard(orgId: string, id: string): DashboardRecord {
  const d = ensureSeeded(orgId).find((x) => x.id === id);
  if (!d) throw new DashboardError("Dashboard not found", "NOT_FOUND");
  return d;
}

export function createDashboard(orgId: string, who: Who, input: { name: string; description?: string; templateId?: string | null; fromId?: string | null }): DashboardRecord {
  const list = ensureSeeded(orgId);
  if (list.length >= MAX_DASHBOARDS) throw new DashboardError(`A workspace can hold up to ${MAX_DASHBOARDS} dashboards — delete one first.`);
  let widgets: Widget[] = [];
  let templateId: string | null = null;
  let description = input.description ?? "";
  if (input.fromId) {
    const src = getDashboard(orgId, input.fromId);
    widgets = sanitizeWidgets(src.widgets.map((w) => ({ ...w, id: newId("w") })));
    templateId = src.templateId;
    description ||= src.description;
  } else if (input.templateId) {
    const t = TEMPLATES.find((x) => x.id === input.templateId);
    if (!t) throw new DashboardError("Unknown template");
    widgets = fromTemplate(t);
    templateId = t.id;
    description ||= t.description;
  }
  const now = new Date();
  const d: DashboardRecord = {
    id: newId("dash"),
    orgId,
    name: input.name.trim().slice(0, 80) || "Untitled dashboard",
    description: description.slice(0, 400),
    widgets,
    isDefault: list.length === 0,
    refreshSec: 60,
    shareToken: null,
    sharedAt: null,
    shareViews: 0,
    templateId,
    createdBy: who.id,
    createdByName: who.name,
    createdAt: now,
    updatedAt: now,
    updatedByName: who.name,
  };
  list.push(d);
  save();
  audit({ userId: who.id, userName: who.name, action: "dashboard.create", entity: "dashboard", entityId: d.id, details: `${d.name}${templateId ? ` (template ${templateId})` : ""}` });
  return d;
}

export function updateDashboard(orgId: string, id: string, who: Who, patch: { name?: string; description?: string; widgets?: Widget[]; refreshSec?: number }): DashboardRecord {
  const d = getDashboard(orgId, id);
  if (patch.name !== undefined) d.name = patch.name.trim().slice(0, 80) || d.name;
  if (patch.description !== undefined) d.description = patch.description.slice(0, 400);
  if (patch.widgets) d.widgets = sanitizeWidgets(patch.widgets);
  if (patch.refreshSec !== undefined) d.refreshSec = Math.max(0, Math.min(3600, Math.round(patch.refreshSec)));
  d.updatedAt = new Date();
  d.updatedByName = who.name;
  save();
  return d;
}

export function deleteDashboard(orgId: string, id: string, who: Who): { deleted: true; nextDefaultId: string | null } {
  const list = ensureSeeded(orgId);
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) throw new DashboardError("Dashboard not found", "NOT_FOUND");
  const [d] = list.splice(idx, 1);
  if (d!.isDefault && list[0]) list[0].isDefault = true;
  save();
  audit({ userId: who.id, userName: who.name, action: "dashboard.delete", entity: "dashboard", entityId: id, details: d!.name });
  return { deleted: true, nextDefaultId: list.find((x) => x.isDefault)?.id ?? null };
}

export function setDefaultDashboard(orgId: string, id: string): DashboardRecord {
  const list = ensureSeeded(orgId);
  const d = getDashboard(orgId, id);
  for (const x of list) x.isDefault = x.id === id;
  save();
  return d;
}

export function setSharing(orgId: string, id: string, who: Who, enabled: boolean, rotate = false): DashboardRecord {
  const d = getDashboard(orgId, id);
  if (!enabled) {
    d.shareToken = null;
    d.sharedAt = null;
  } else if (!d.shareToken || rotate) {
    d.shareToken = newShareToken();
    d.sharedAt = new Date();
    d.shareViews = 0;
  }
  save();
  audit({ userId: who.id, userName: who.name, action: enabled ? (rotate ? "dashboard.share.rotate" : "dashboard.share") : "dashboard.unshare", entity: "dashboard", entityId: id, details: d.name });
  return d;
}

/** Public lookup by share token (read-only view). */
export function getByShareToken(token: string, countView = false): DashboardRecord | null {
  load();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  for (const list of state.byOrg.values()) {
    const d = list.find((x) => x.shareToken === token);
    if (d) {
      if (countView) {
        d.shareViews++;
        save();
      }
      return d;
    }
  }
  return null;
}

export function orgDisplayName(orgId: string): string {
  const o = getStore().orgs.find((x) => x.id === orgId);
  return o?.name ?? "Workspace";
}

/** Test hook. */
export function _resetDashboards() {
  state.byOrg.clear();
  state.loaded = true;
}
