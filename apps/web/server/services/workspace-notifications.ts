/**
 * Workspace notification centre — the single path by which any workspace
 * module (portfolio rules, reports, billing, team, copilot…) tells users
 * something happened.
 *
 *   notifyWorkspace({ workspaceId, userId?, kind, title, body, href, severity })
 *     → writes store.notifications (newest first)
 *     → publishes realtime "notification.created" to room `ws:<workspaceId>`
 *       (the top-bar bell listens there and increments live)
 *     → for severity "critical" (or `email: true`) also e-mails the workspace
 *       members through server/notify/channels.ts (Resend, or the outbox)
 *     → for fired alert rules, warning/critical alerts and anything critical (or
 *       `push: true`) also sends a Web Push notification to members' subscribed
 *       devices (server/notify/webpush.ts), deep-linking to `href`
 *
 *   listNotifications / unreadCount / markRead / markAllRead — per-user read state
 *   (`readBy` holds user ids, so one broadcast notification can be read
 *   independently by every member).
 */
import { getStore, nextId, type NotificationRecord } from "../data/store";
import { publish, type RealtimeEvent } from "../realtime";
import { sendEmail } from "../notify/channels";
import { firePushToOrg, firePushToUser, pushSeverityFor } from "../notify/webpush";

export type NotificationKind = NotificationRecord["kind"];
export type NotificationSeverity = NotificationRecord["severity"];

export interface NotifyWorkspaceInput {
  workspaceId: string;
  /** Target one member; omit/null = every member of the workspace */
  userId?: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string | null;
  severity: NotificationSeverity;
  /** true = e-mail members; array = e-mail these addresses; default: only for critical */
  email?: boolean | string[];
  /** Web Push to members' devices; default: rule firings, warning/critical alerts, anything critical */
  push?: boolean;
}

/** Realtime payload published on `ws:<orgId>` (cast: the shared RealtimeEvent union predates it). */
export interface NotificationCreatedEvent {
  type: "notification.created";
  notificationId: string;
  workspaceId: string;
  userId: string | null;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string | null;
}

const MAX_PER_WORKSPACE = 500;

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function emailHtml(n: Pick<NotificationRecord, "title" | "body" | "href" | "severity">, appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000") {
  const colour = n.severity === "critical" ? "#ef4444" : n.severity === "warning" ? "#f59e0b" : n.severity === "success" ? "#22c55e" : "#38bdf8";
  const link = n.href ? `${appUrl.replace(/\/$/, "")}${n.href}` : appUrl;
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;background:#0b1224;color:#e2e8f0;padding:24px;border-radius:12px">
<div style="font-size:11px;letter-spacing:.12em;color:${colour};text-transform:uppercase">Agri-SHIELD · ${esc(n.severity)}</div>
<h2 style="margin:8px 0 12px;color:#fff;font-size:18px">${esc(n.title)}</h2>
<p style="line-height:1.55;color:#cbd5e1">${esc(n.body)}</p>
<a href="${esc(link)}" style="display:inline-block;margin-top:12px;background:#38bdf8;color:#020617;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open in Agri-SHIELD</a>
<p style="font-size:11px;color:#64748b;margin-top:20px">You receive this because you are a member of this workspace. Manage alert rules under Alerts &amp; Rules.</p></div>`;
}

/** Members' e-mail addresses (optionally one user). */
export function workspaceEmails(workspaceId: string, userId?: string | null): string[] {
  return getStore()
    .users.filter((u) => u.orgId === workspaceId && u.status !== "suspended" && (!userId || u.id === userId) && !!u.email)
    .map((u) => u.email!);
}

export function notifyWorkspace(input: NotifyWorkspaceInput): NotificationRecord {
  const s = getStore();
  const rec: NotificationRecord = {
    id: nextId("ntf"),
    workspaceId: input.workspaceId,
    userId: input.userId ?? null,
    kind: input.kind,
    title: input.title.slice(0, 200),
    body: input.body.slice(0, 2000),
    href: input.href ?? null,
    severity: input.severity,
    createdAt: new Date(),
    readBy: [],
  };
  s.notifications.unshift(rec);
  // Cap per workspace so a noisy rule can never grow memory unbounded
  let seen = 0;
  for (let i = 0; i < s.notifications.length; i++) {
    if (s.notifications[i]!.workspaceId !== input.workspaceId) continue;
    if (++seen > MAX_PER_WORKSPACE) {
      s.notifications.splice(i, 1);
      i--;
    }
  }

  const event: NotificationCreatedEvent = {
    type: "notification.created",
    notificationId: rec.id,
    workspaceId: input.workspaceId,
    userId: rec.userId,
    kind: rec.kind,
    severity: rec.severity,
    title: rec.title,
    body: rec.body,
    href: rec.href,
  };
  publish(`ws:${input.workspaceId}`, event as unknown as RealtimeEvent);

  const to = Array.isArray(input.email) ? input.email : input.email === true || (input.email === undefined && rec.severity === "critical") ? workspaceEmails(input.workspaceId, rec.userId) : [];
  if (to.length) {
    const html = emailHtml(rec);
    const subject = `[Agri-SHIELD] ${rec.title}`;
    for (const addr of [...new Set(to)]) void sendEmail(addr, subject, html).catch(() => {});
  }

  const push = input.push ?? (rec.kind === "rule" || rec.severity === "critical" || (rec.kind === "alert" && rec.severity === "warning"));
  if (push) {
    const payload = { title: rec.title, body: rec.body, severity: pushSeverityFor(rec.severity), tag: rec.id, alertId: rec.id, url: rec.href ?? "/app/alerts" };
    if (rec.userId) firePushToUser(rec.userId, payload);
    else firePushToOrg(input.workspaceId, payload);
  }
  return rec;
}

// ─── Per-user queries ─────────────────────────────────────────────────────

export function visibleTo(n: NotificationRecord, workspaceId: string, userId: string): boolean {
  return n.workspaceId === workspaceId && (n.userId == null || n.userId === userId);
}

export function listNotifications(
  workspaceId: string,
  userId: string,
  opts: { unreadOnly?: boolean; kind?: NotificationKind; limit?: number; cursor?: string | null } = {}
) {
  const all = getStore().notifications.filter((n) => visibleTo(n, workspaceId, userId) && (!opts.kind || n.kind === opts.kind) && (!opts.unreadOnly || !n.readBy.includes(userId)));
  const start = opts.cursor ? Math.max(0, all.findIndex((n) => n.id === opts.cursor) + 1) : 0;
  const limit = opts.limit ?? 30;
  const page = all.slice(start, start + limit);
  return {
    items: page.map((n) => ({ ...n, read: n.readBy.includes(userId), readBy: undefined })),
    nextCursor: start + limit < all.length ? page[page.length - 1]?.id ?? null : null,
    total: all.length,
  };
}

export function unreadCount(workspaceId: string, userId: string): number {
  let c = 0;
  for (const n of getStore().notifications) if (visibleTo(n, workspaceId, userId) && !n.readBy.includes(userId)) c++;
  return c;
}

export function markRead(workspaceId: string, userId: string, ids: string[]): number {
  const set = new Set(ids);
  let c = 0;
  for (const n of getStore().notifications) {
    if (set.has(n.id) && visibleTo(n, workspaceId, userId) && !n.readBy.includes(userId)) {
      n.readBy.push(userId);
      c++;
    }
  }
  return c;
}

export function markAllRead(workspaceId: string, userId: string): number {
  let c = 0;
  for (const n of getStore().notifications) {
    if (visibleTo(n, workspaceId, userId) && !n.readBy.includes(userId)) {
      n.readBy.push(userId);
      c++;
    }
  }
  return c;
}
