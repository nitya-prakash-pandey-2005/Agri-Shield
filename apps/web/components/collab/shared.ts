/**
 * Client-safe collaboration helpers (pure): mention-token splitting for rendering,
 * day grouping for feeds, relative time.
 */

export const MENTION_TOKEN_RE = /@\[([^\]\n]{1,80})\]\(([A-Za-z0-9_.:-]{1,80})\)/g;

export type BodyPart = { kind: "text"; text: string } | { kind: "mention"; name: string; userId: string };

/** Split a comment body into text and mention parts for rendering. */
export function splitMentions(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_TOKEN_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ kind: "text", text: body.slice(last, i) });
    parts.push({ kind: "mention", name: m[1]!, userId: m[2]! });
    last = i + m[0].length;
  }
  if (last < body.length) parts.push({ kind: "text", text: body.slice(last) });
  return parts;
}

/** Group items into calendar days (in the given IANA timezone), preserving order (newest first expected). */
export function groupByDay<T extends { at: Date | string }>(items: T[], timeZone = "UTC", now = new Date()): { day: string; label: string; items: T[] }[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const key = (d: Date) => fmt.format(d);
  const today = key(now);
  const yesterday = key(new Date(now.getTime() - 86_400_000));
  const groups: { day: string; label: string; items: T[] }[] = [];
  for (const it of items) {
    const d = new Date(it.at);
    const k = key(d);
    let grp = groups[groups.length - 1];
    if (!grp || grp.day !== k) {
      const label = k === today ? "Today" : k === yesterday ? "Yesterday" : new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
      groups.push((grp = { day: k, label, items: [] }));
    }
    grp.items.push(it);
  }
  return groups;
}

export function relTime(d: Date | string, now = Date.now()): string {
  const s = Math.round((now - new Date(d).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(d).toISOString().slice(0, 10);
}

export function clockTime(d: Date | string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(d));
}
