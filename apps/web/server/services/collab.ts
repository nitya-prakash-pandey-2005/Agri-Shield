/**
 * Team collaboration layer shared by every workspace module:
 *
 *   Comments  · threaded discussion on any entity (incident, asset, rule, scenario, report,
 *               firing) with @mentions → notifyWorkspace() to the mentioned member
 *   Presence  · who is looking at a room right now (heartbeat every 20 s, 50 s TTL),
 *               broadcast on realtime room `presence:<orgId>:<room>`; optional typing signal
 *   Activity  · one unified, filterable stream of everything that happened in a workspace:
 *               audit trail + rule firings + reports + imports + comments + official alerts,
 *               plus any module that registers a source (incidents do)
 *
 * Pure helpers (mention parsing, avatar colours, audit → activity mapping, day grouping)
 * are exported for unit tests. State lives on globalThis so hot reload keeps it.
 */
import { randomUUID } from "node:crypto";
import { getStore, type AuditRecord, type UserRecord } from "../data/store";
import { publish, type RealtimeEvent } from "../realtime";
import { notifyWorkspace } from "./workspace-notifications";
import { portfolioState } from "./portfolio";
import { wsState } from "./workspace-state";

// ─── Types ────────────────────────────────────────────────────────────────

export const COMMENT_ENTITY_TYPES = ["incident", "asset", "rule", "scenario", "report", "firing"] as const;
export type CommentEntityType = (typeof COMMENT_ENTITY_TYPES)[number];

export interface CommentRecord {
  id: string;
  workspaceId: string;
  entityType: CommentEntityType;
  entityId: string;
  authorId: string;
  authorName: string;
  body: string;
  mentions: string[];
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  /** Seeded demonstration content */
  demo?: boolean;
}

export interface Member {
  id: string;
  name: string;
  title: string | null;
  role: string;
  email: string | null;
  handle: string;
  initials: string;
  color: string;
}

export interface PresenceUser {
  userId: string;
  name: string;
  initials: string;
  color: string;
  since: string;
}

interface PresenceEntry extends PresenceUser {
  lastSeen: number;
}

interface CollabState {
  comments: CommentRecord[];
  presence: Map<string, Map<string, PresenceEntry>>;
  sweeper: ReturnType<typeof setInterval> | null;
}

const g = globalThis as unknown as { __agriCollab?: CollabState };
export const collabState: CollabState = (g.__agriCollab ??= { comments: [], presence: new Map(), sweeper: null });

// ─── Members & avatars ────────────────────────────────────────────────────

const AVATAR_COLORS = ["#38bdf8", "#34d399", "#fbbf24", "#a78bfa", "#f472b6", "#22d3ee", "#fb7185", "#a3e635", "#f97316"];

export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function initials(name: string): string {
  const w = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return ((w[0]![0] ?? "") + (w.length > 1 ? w[w.length - 1]![0] ?? "" : w[0]![1] ?? "")).toUpperCase();
}

/** Mention handle: e-mail local part ("claims"), else name without spaces. */
export function handleOf(u: Pick<UserRecord, "email" | "name">): string {
  const local = u.email?.split("@")[0];
  return (local || u.name.replace(/\s+/g, "")).toLowerCase();
}

export function toMember(u: UserRecord): Member {
  return { id: u.id, name: u.name, title: u.title ?? null, role: u.role, email: u.email, handle: handleOf(u), initials: initials(u.name), color: avatarColor(u.id) };
}

export function workspaceMembers(ws: string): Member[] {
  return getStore()
    .users.filter((u) => u.orgId === ws && u.status !== "suspended" && u.role !== "farmer")
    .map(toMember);
}

export function actorOf(userId: string | null | undefined, fallbackName?: string): { id: string; name: string; initials: string; color: string } | null {
  if (!userId || userId === "system") return null;
  const u = getStore().users.find((x) => x.id === userId);
  const name = u?.name ?? fallbackName ?? userId;
  return { id: userId, name, initials: initials(name), color: avatarColor(userId) };
}

// ─── Mentions (pure) ──────────────────────────────────────────────────────

/** Token the composer inserts when a member is picked from the @ menu. */
export const mentionToken = (m: Pick<Member, "id" | "name">) => `@[${m.name}](${m.id})`;

const TOKEN_RE = /@\[([^\]\n]{1,80})\]\(([A-Za-z0-9_.:-]{1,80})\)/g;
const HANDLE_RE = /(^|[^\w@.])@([A-Za-z0-9][A-Za-z0-9._-]{1,40})/g;

/**
 * Resolve every member mentioned in `text`, in order of first appearance, de-duplicated.
 * Understands the composer token `@[Name](userId)` and typed handles `@claims`, `@sharmin`,
 * `@SharminAkter` (e-mail local part, first name or full name without spaces; case-insensitive).
 * Only members of the workspace can be mentioned (unknown ids / handles are ignored).
 */
export function parseMentions(text: string, members: Pick<Member, "id" | "name" | "handle">[]): string[] {
  const out: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !out.includes(id)) out.push(id);
  };
  const byId = new Map(members.map((m) => [m.id, m]));
  const found: { at: number; id: string }[] = [];
  for (const m of text.matchAll(TOKEN_RE)) if (byId.has(m[2]!)) found.push({ at: m.index ?? 0, id: m[2]! });
  const stripped = text.replace(TOKEN_RE, (s) => " ".repeat(s.length));
  const firstNames = new Map<string, string[]>();
  for (const m of members) {
    const f = m.name.split(/\s+/)[0]!.toLowerCase();
    firstNames.set(f, [...(firstNames.get(f) ?? []), m.id]);
  }
  for (const m of stripped.matchAll(HANDLE_RE)) {
    const h = m[2]!.replace(/[._-]+$/, "").toLowerCase();
    const at = (m.index ?? 0) + m[1]!.length;
    const exact = members.find((x) => x.handle === h || x.name.replace(/\s+/g, "").toLowerCase() === h);
    if (exact) found.push({ at, id: exact.id });
    else if (firstNames.get(h)?.length === 1) found.push({ at, id: firstNames.get(h)![0]! });
  }
  found.sort((a, b) => a.at - b.at).forEach((f) => add(f.id));
  return out;
}

/** `@[Sharmin Akter](user-x)` → `@Sharmin Akter` (for e-mails, notifications, excerpts). */
export function plainMentions(text: string): string {
  return text.replace(TOKEN_RE, (_s, name: string) => `@${name}`);
}

export function excerpt(text: string, n = 140): string {
  const t = plainMentions(text).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// ─── Comments ─────────────────────────────────────────────────────────────

export class CollabError extends Error {
  constructor(
    public code: "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST",
    message: string
  ) {
    super(message);
  }
}

export function entityHref(type: CommentEntityType, id: string): string {
  switch (type) {
    case "incident":
      return `/app/incidents/${id}`;
    case "asset":
      return `/app/portfolio?asset=${id}`;
    case "rule":
      return `/app/alerts?rule=${id}`;
    case "firing":
      return `/app/alerts?tab=history&firing=${id}`;
    case "scenario":
      return `/app/simulate?scenario=${id}`;
    case "report":
      return `/app/reports?report=${id}`;
  }
}

/** Assets and rules are validated against the store; other entity types are validated by their module's router. */
export function assertEntity(ws: string, type: CommentEntityType, id: string) {
  const s = getStore();
  if (type === "asset" && !s.assets.some((a) => a.id === id && a.workspaceId === ws)) throw new CollabError("NOT_FOUND", "Asset not found in this workspace");
  if (type === "rule" && !s.alertRules.some((r) => r.id === id && r.workspaceId === ws)) throw new CollabError("NOT_FOUND", "Rule not found in this workspace");
}

export function entityLabel(ws: string, type: CommentEntityType, id: string): string {
  const s = getStore();
  if (type === "asset") return s.assets.find((a) => a.id === id && a.workspaceId === ws)?.name ?? "an asset";
  if (type === "rule") return s.alertRules.find((r) => r.id === id && r.workspaceId === ws)?.name ?? "an alert rule";
  return `${type} ${id}`;
}

export function listComments(ws: string, type: CommentEntityType, id: string) {
  return collabState.comments
    .filter((c) => c.workspaceId === ws && c.entityType === type && c.entityId === id && !c.deletedAt)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((c) => ({ ...c, author: actorOf(c.authorId, c.authorName) }));
}

export function commentCounts(ws: string, type: CommentEntityType, ids: string[]): Record<string, number> {
  const set = new Set(ids);
  const out: Record<string, number> = {};
  for (const c of collabState.comments) if (c.workspaceId === ws && c.entityType === type && set.has(c.entityId) && !c.deletedAt) out[c.entityId] = (out[c.entityId] ?? 0) + 1;
  return out;
}

export function addComment(
  ws: string,
  user: { id: string; name: string },
  input: { entityType: CommentEntityType; entityId: string; body: string; label?: string; href?: string; at?: Date; demo?: boolean; silent?: boolean }
): CommentRecord {
  const body = input.body.trim();
  if (!body) throw new CollabError("BAD_REQUEST", "Comment is empty");
  if (body.length > 4000) throw new CollabError("BAD_REQUEST", "Comment is too long (4,000 characters max)");
  const members = workspaceMembers(ws);
  const mentions = parseMentions(body, members);
  const rec: CommentRecord = {
    id: `cmt_${randomUUID().slice(0, 10)}`,
    workspaceId: ws,
    entityType: input.entityType,
    entityId: input.entityId,
    authorId: user.id,
    authorName: user.name,
    body,
    mentions,
    createdAt: input.at ?? new Date(),
    editedAt: null,
    deletedAt: null,
    demo: input.demo,
  };
  collabState.comments.push(rec);
  if (input.silent) return rec;

  const href = input.href ?? entityHref(input.entityType, input.entityId);
  const label = input.label ?? entityLabel(ws, input.entityType, input.entityId);
  for (const uid of mentions) {
    if (uid === user.id) continue;
    notifyWorkspace({ workspaceId: ws, userId: uid, kind: "team", severity: "info", title: `${user.name} mentioned you on ${label}`, body: excerpt(body, 280), href, email: false });
  }
  const ev: RealtimeEvent = { type: "comment.created", commentId: rec.id, workspaceId: ws, entityType: rec.entityType, entityId: rec.entityId, authorId: user.id, authorName: user.name, mentions, excerpt: excerpt(body, 120) };
  publish(`ws:${ws}`, ev);
  return rec;
}

function ownComment(ws: string, id: string, user: { id: string; role: string }) {
  const c = collabState.comments.find((x) => x.id === id && x.workspaceId === ws && !x.deletedAt);
  if (!c) throw new CollabError("NOT_FOUND", "Comment not found");
  const admin = ["enterprise_admin", "supply_chain_admin", "national_admin", "platform_admin"].includes(user.role);
  if (c.authorId !== user.id && !admin) throw new CollabError("FORBIDDEN", "Only the author (or a workspace admin) can change this comment");
  return c;
}

export function editComment(ws: string, id: string, user: { id: string; name: string; role: string }, body: string): CommentRecord {
  const c = ownComment(ws, id, user);
  const text = body.trim();
  if (!text) throw new CollabError("BAD_REQUEST", "Comment is empty");
  const before = new Set(c.mentions);
  c.body = text.slice(0, 4000);
  c.mentions = parseMentions(c.body, workspaceMembers(ws));
  c.editedAt = new Date();
  // Newly added mentions still get notified
  for (const uid of c.mentions)
    if (!before.has(uid) && uid !== user.id)
      notifyWorkspace({ workspaceId: ws, userId: uid, kind: "team", severity: "info", title: `${user.name} mentioned you`, body: excerpt(c.body, 280), href: entityHref(c.entityType, c.entityId), email: false });
  publish(`ws:${ws}`, { type: "comment.changed", commentId: c.id, workspaceId: ws, entityType: c.entityType, entityId: c.entityId, deleted: false });
  return c;
}

export function deleteComment(ws: string, id: string, user: { id: string; role: string }): boolean {
  const c = ownComment(ws, id, user);
  c.deletedAt = new Date();
  publish(`ws:${ws}`, { type: "comment.changed", commentId: c.id, workspaceId: ws, entityType: c.entityType, entityId: c.entityId, deleted: true });
  return true;
}

// ─── Presence ─────────────────────────────────────────────────────────────

export const PRESENCE_HEARTBEAT_MS = 20_000;
export const PRESENCE_TTL_MS = 50_000;

export const presenceChannel = (ws: string, room: string) => `presence:${ws}:${room}`;

/** Drop entries not seen within the TTL. Returns true when something was removed. */
export function prunePresence(entries: Map<string, { lastSeen: number }>, now = Date.now(), ttl = PRESENCE_TTL_MS): boolean {
  let changed = false;
  for (const [k, v] of entries) {
    if (now - v.lastSeen > ttl) {
      entries.delete(k);
      changed = true;
    }
  }
  return changed;
}

function presenceKey(ws: string, room: string) {
  return `${ws}|${room}`;
}

function snapshot(entries: Map<string, PresenceEntry>): PresenceUser[] {
  return [...entries.values()].sort((a, b) => a.since.localeCompare(b.since)).map(({ userId, name, initials, color, since }) => ({ userId, name, initials, color, since }));
}

function broadcastPresence(ws: string, room: string) {
  const entries = collabState.presence.get(presenceKey(ws, room)) ?? new Map();
  publish(presenceChannel(ws, room), { type: "presence.updated", room, workspaceId: ws, users: snapshot(entries) });
}

function ensureSweeper() {
  if (collabState.sweeper || process.env.VITEST) return;
  collabState.sweeper = setInterval(() => {
    for (const [key, entries] of collabState.presence) {
      if (prunePresence(entries)) {
        const [ws, ...rest] = key.split("|");
        broadcastPresence(ws!, rest.join("|"));
      }
      if (!entries.size) collabState.presence.delete(key);
    }
  }, 15_000);
  (collabState.sweeper as { unref?: () => void }).unref?.();
}

export function heartbeat(ws: string, room: string, user: { id: string; name: string }, now = Date.now()): { channel: string; users: PresenceUser[] } {
  ensureSweeper();
  const key = presenceKey(ws, room);
  let entries = collabState.presence.get(key);
  if (!entries) collabState.presence.set(key, (entries = new Map()));
  let changed = prunePresence(entries, now);
  const cur = entries.get(user.id);
  if (cur) cur.lastSeen = now;
  else {
    entries.set(user.id, { userId: user.id, name: user.name, initials: initials(user.name), color: avatarColor(user.id), since: new Date(now).toISOString(), lastSeen: now });
    changed = true;
  }
  if (changed) broadcastPresence(ws, room);
  return { channel: presenceChannel(ws, room), users: snapshot(entries) };
}

export function leave(ws: string, room: string, userId: string) {
  const entries = collabState.presence.get(presenceKey(ws, room));
  if (entries?.delete(userId)) broadcastPresence(ws, room);
}

export function presenceIn(ws: string, room: string): PresenceUser[] {
  const entries = collabState.presence.get(presenceKey(ws, room));
  if (!entries) return [];
  prunePresence(entries);
  return snapshot(entries);
}

export function typing(ws: string, room: string, user: { id: string; name: string }, isTyping: boolean) {
  publish(presenceChannel(ws, room), { type: "presence.typing", room, workspaceId: ws, userId: user.id, name: user.name, typing: isTyping });
}

// ─── Activity feed ────────────────────────────────────────────────────────

export const ACTIVITY_CATEGORIES = ["incident", "comment", "rule", "alert", "report", "import", "asset", "team", "settings", "scenario"] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export interface ActivityActor {
  id: string;
  name: string;
  initials: string;
  color: string;
}

export interface ActivityItem {
  id: string;
  at: Date;
  category: ActivityCategory;
  actor: ActivityActor | null;
  /** Shown when there is no human actor ("Portfolio monitor", "GDACS") */
  actorLabel: string;
  verb: string;
  title: string;
  detail?: string | null;
  href?: string | null;
  severity?: "info" | "success" | "warning" | "critical";
}

export type ActivitySource = (ws: string) => ActivityItem[];
const sources = new Map<string, ActivitySource>();
/** Modules add their own events to the feed (incidents does this on load). */
export function registerActivitySource(name: string, fn: ActivitySource) {
  sources.set(name, fn);
}

const AUDIT_CATEGORY: [RegExp, ActivityCategory][] = [
  [/^asset\.import$/, "import"],
  [/^asset\./, "asset"],
  [/^rule\.(create|update|delete)$/, "rule"],
  [/^report\.(schedule|delete)/, "report"],
  [/^team\./, "team"],
  [/^(workspace|billing|apikey|webhook|security)\./, "settings"],
  [/^(scenario|simulate)\./, "scenario"],
  [/^(explorer|insurance|finance|anticipatory)\./, "report"],
];

const VERBS: Record<string, string> = {
  "asset.import": "imported assets",
  "asset.create": "added an asset",
  "asset.update": "updated an asset",
  "asset.archive": "archived an asset",
  "asset.export": "exported the portfolio",
  "asset.bulk_tag": "re-tagged assets",
  "rule.create": "created an alert rule",
  "rule.update": "edited an alert rule",
  "rule.delete": "deleted an alert rule",
  "team.invite": "invited a teammate",
  "team.invite.accept": "joined the workspace",
  "team.role.change": "changed a role",
  "team.remove": "removed a member",
  "report.schedule.create": "scheduled a report",
  "report.schedule.delete": "removed a report schedule",
  "report.delete": "deleted a report",
  "workspace.settings.update": "updated workspace settings",
  "apikey.create": "created an API key",
  "apikey.revoke": "revoked an API key",
  "webhook.create": "added a webhook",
  "scenario.run": "ran a scenario",
};

function categoryOf(action: string): ActivityCategory | null {
  for (const [re, c] of AUDIT_CATEGORY) if (re.test(action)) return c;
  return null;
}

function auditHref(a: AuditRecord, cat: ActivityCategory): string | null {
  if (a.entity === "asset") return `/app/portfolio?asset=${a.entityId}`;
  if (a.entity === "alert_rule" || cat === "rule") return `/app/alerts?rule=${a.entityId}`;
  if (cat === "import" || cat === "asset") return "/app/portfolio";
  if (cat === "team") return "/app/settings/team";
  if (cat === "report") return "/app/reports";
  if (cat === "scenario") return "/app/simulate";
  if (cat === "settings") return a.action.startsWith("apikey") || a.action.startsWith("webhook") ? "/app/developers" : "/app/settings";
  return null;
}

/**
 * Pure mapping of an audit record to an activity item for workspace `ws` (null = not this
 * workspace's business, or covered by a richer native source such as firings/reports/incidents).
 */
export function auditToActivity(a: AuditRecord, ws: string, ctx: { userOrg: (id: string) => string | null | undefined; ruleOrg: (id: string) => string | null | undefined; assetOrg: (id: string) => string | null | undefined }): ActivityItem | null {
  if (a.action === "rule.fired" || a.action === "report.generate" || a.action.startsWith("incident.") || a.action.startsWith("comment.")) return null;
  const cat = categoryOf(a.action);
  if (!cat) return null;
  const org = ctx.userOrg(a.userId) ?? (a.entity === "alert_rule" ? ctx.ruleOrg(a.entityId) : a.entity === "asset" ? ctx.assetOrg(a.entityId) : a.entity === "workspace" ? a.entityId : null);
  if (org !== ws) return null;
  const verb = VERBS[a.action] ?? a.action.replace(/[._]/g, " ");
  return {
    id: `aud:${a.id}`,
    at: a.at,
    category: cat,
    actor: actorOf(a.userId, a.userName),
    actorLabel: a.userName,
    verb,
    title: a.details || verb,
    detail: null,
    href: auditHref(a, cat),
    severity: cat === "import" ? "success" : "info",
  };
}

function nativeItems(ws: string): ActivityItem[] {
  const s = getStore();
  const users = new Map(s.users.map((u) => [u.id, u.orgId]));
  const rules = new Map(s.alertRules.map((r) => [r.id, r.workspaceId]));
  const assets = new Map(s.assets.map((x) => [x.id, x.workspaceId]));
  const out: ActivityItem[] = [];
  const ctx = { userOrg: (id: string) => users.get(id), ruleOrg: (id: string) => rules.get(id), assetOrg: (id: string) => assets.get(id) };
  for (const a of s.audit) {
    const it = auditToActivity(a, ws, ctx);
    if (it) out.push(it);
  }
  for (const f of portfolioState.firings) {
    if (f.workspaceId !== ws || f.trigger === "test") continue;
    out.push({
      id: `fire:${f.id}`,
      at: f.at,
      category: "rule",
      actor: f.trigger === "manual" ? actorOf(f.triggeredBy) : null,
      actorLabel: f.trigger === "manual" ? f.triggeredBy : "Portfolio monitor",
      verb: "rule fired",
      title: `${f.ruleName} — ${f.matchCount} asset${f.matchCount === 1 ? "" : "s"}`,
      detail: f.matches.slice(0, 2).map((m) => `${m.name}: ${m.reason}`).join(" · ") || null,
      href: `/app/alerts?tab=history&firing=${f.id}`,
      severity: f.severity === "info" ? "info" : f.severity,
    });
  }
  // Seeded rule history (lastTriggeredAt) so a fresh workspace still shows its past firings
  for (const r of s.alertRules) {
    if (r.workspaceId !== ws || !r.lastTriggeredAt) continue;
    if (portfolioState.firings.some((f) => f.ruleId === r.id && Math.abs(f.at.getTime() - r.lastTriggeredAt!.getTime()) < 60_000)) continue;
    out.push({ id: `rulelast:${r.id}:${r.lastTriggeredAt.getTime()}`, at: r.lastTriggeredAt, category: "rule", actor: null, actorLabel: "Portfolio monitor", verb: "rule fired", title: r.name, detail: r.description, href: `/app/alerts?rule=${r.id}`, severity: r.severity === "info" ? "info" : r.severity });
  }
  for (const r of wsState().reports) {
    if (r.orgId !== ws) continue;
    out.push({ id: `rep:${r.id}`, at: r.createdAt, category: "report", actor: r.trigger === "manual" ? actorOf(r.createdBy, r.createdByName) : null, actorLabel: r.trigger === "schedule" ? "Report scheduler" : r.createdByName, verb: "generated a report", title: r.title, detail: `${r.pages} page${r.pages === 1 ? "" : "s"}`, href: `/app/reports?report=${r.id}`, severity: "info" });
  }
  for (const c of collabState.comments) {
    if (c.workspaceId !== ws || c.deletedAt) continue;
    out.push({ id: `cmt:${c.id}`, at: c.createdAt, category: "comment", actor: actorOf(c.authorId, c.authorName), actorLabel: c.authorName, verb: `commented on ${c.entityType === "incident" ? "an incident" : `a ${c.entityType}`}`, title: excerpt(c.body, 160), detail: c.mentions.length ? `Mentioned ${c.mentions.map((m) => actorOf(m)?.name ?? m).join(", ")}` : null, href: `${entityHref(c.entityType, c.entityId)}${c.entityType === "incident" ? "#discussion" : ""}`, severity: "info" });
  }
  // Official hazard alerts in districts where the workspace has assets
  const districtIds = new Set(s.assets.filter((x) => x.workspaceId === ws && x.status === "active" && x.districtId).map((x) => x.districtId!));
  const dName = new Map(s.districts.map((d) => [d.id, d.name]));
  for (const al of s.alerts) {
    // Active alerts and past emergencies only — expired watches would drown the stream
    if (!districtIds.has(al.districtId) || (!al.isActive && al.severity !== "emergency")) continue;
    out.push({ id: `alert:${al.id}`, at: al.createdAt, category: "alert", actor: null, actorLabel: al.source === "gdacs" ? "GDACS" : al.source === "eonet" ? "NASA EONET" : "National agency", verb: "issued an official alert", title: al.title, detail: `${dName.get(al.districtId) ?? al.districtId} · ${al.alertType} · ${al.severity}`, href: `/app/incidents?new=1&source=alert&alertId=${al.id}`, severity: al.severity === "emergency" ? "critical" : al.severity === "warning" ? "warning" : "info" });
  }
  return out;
}

export interface ActivityQuery {
  categories?: ActivityCategory[];
  actorId?: string | null;
  q?: string | null;
  before?: Date | null;
  sinceDays?: number | null;
  limit?: number;
}

export function activityFeed(ws: string, query: ActivityQuery = {}) {
  let all = nativeItems(ws);
  for (const fn of sources.values()) {
    try {
      all = all.concat(fn(ws));
    } catch (e) {
      console.warn("[activity] source failed:", (e as Error).message);
    }
  }
  const now = Date.now();
  const since = query.sinceDays ? now - query.sinceDays * 86_400_000 : 0;
  const inWindow = all.filter((i) => i.at.getTime() <= now + 60_000 && i.at.getTime() >= since);
  const counts: Partial<Record<ActivityCategory, number>> = {};
  for (const i of inWindow) counts[i.category] = (counts[i.category] ?? 0) + 1;
  const actors = new Map<string, ActivityActor>();
  for (const i of inWindow) if (i.actor) actors.set(i.actor.id, i.actor);

  const q = query.q?.trim().toLowerCase();
  const filtered = inWindow
    .filter((i) => !query.categories?.length || query.categories.includes(i.category))
    .filter((i) => !query.actorId || i.actor?.id === query.actorId)
    .filter((i) => !q || `${i.title} ${i.detail ?? ""} ${i.verb} ${i.actor?.name ?? i.actorLabel}`.toLowerCase().includes(q))
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id));
  const start = query.before ? filtered.findIndex((i) => i.at.getTime() < query.before!.getTime()) : 0;
  const limit = query.limit ?? 50;
  const page = start < 0 ? [] : filtered.slice(start, start + limit);
  const more = start >= 0 && start + limit < filtered.length;
  return { items: page, nextBefore: more ? page[page.length - 1]!.at : null, total: filtered.length, counts, actors: [...actors.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
