import { beforeEach, describe, expect, it } from "vitest";
import { auditToActivity, collabState, heartbeat, leave, parseMentions, plainMentions, presenceIn, prunePresence, addComment, activityFeed } from "@/server/services/collab";
import { groupByDay } from "@/components/collab/shared";
import { getStore } from "@/server/data/store";
import { incidentState, openIncidentFromFiring, createIncident, changeStatus, listIncidents, publicStatus, saveUpdate, publishUpdate, subscribe, getIncident } from "@/server/services/incidents";
import { portfolioState, type RuleFiring } from "@/server/services/portfolio";

const members = [
  { id: "user-insurer-demo", name: "Arif Rahman", handle: "insurer" },
  { id: "user-insurer-analyst", name: "Sharmin Akter", handle: "claims" },
  { id: "u-3", name: "Sharmin Begum", handle: "sbegum" },
];

describe("mention parsing", () => {
  it("resolves composer tokens and typed handles in order, de-duplicated", () => {
    const text = "Hi @[Arif Rahman](user-insurer-demo), can @claims check this? cc @insurer and @[Arif Rahman](user-insurer-demo)";
    expect(parseMentions(text, members)).toEqual(["user-insurer-demo", "user-insurer-analyst"]);
  });

  it("matches full names without spaces and unique first names, ignores ambiguous or unknown", () => {
    expect(parseMentions("@ArifRahman please", members)).toEqual(["user-insurer-demo"]);
    expect(parseMentions("@arif please", members)).toEqual(["user-insurer-demo"]);
    expect(parseMentions("@sharmin is ambiguous", members)).toEqual([]);
    expect(parseMentions("@nobody here", members)).toEqual([]);
    expect(parseMentions("@[Mallory](user-evil) injected", members)).toEqual([]);
  });

  it("does not treat e-mail addresses as mentions and trims trailing punctuation", () => {
    expect(parseMentions("write to ops@claims.example", members)).toEqual([]);
    expect(parseMentions("thanks @claims.", members)).toEqual(["user-insurer-analyst"]);
  });

  it("renders tokens as plain text", () => {
    expect(plainMentions("ok @[Sharmin Akter](user-insurer-analyst)!")).toBe("ok @Sharmin Akter!");
  });
});

describe("presence", () => {
  beforeEach(() => collabState.presence.clear());
  it("tracks heartbeats per room and expires stale viewers", () => {
    const t = 1_000_000;
    heartbeat("ws1", "incident:a", { id: "u1", name: "Arif Rahman" }, t);
    const r = heartbeat("ws1", "incident:a", { id: "u2", name: "Sharmin Akter" }, t + 5_000);
    expect(r.channel).toBe("presence:ws1:incident:a");
    expect(r.users.map((u) => u.initials)).toEqual(["AR", "SA"]);
    const entries = collabState.presence.get("ws1|incident:a")!;
    expect(prunePresence(entries, t + 52_000)).toBe(true); // u1 last seen 52 s ago
    expect([...entries.keys()]).toEqual(["u2"]);
    leave("ws1", "incident:a", "u2");
    expect(presenceIn("ws1", "incident:a")).toEqual([]);
  });
});

describe("activity", () => {
  const ctx = { userOrg: (id: string) => (id === "u1" ? "ws1" : id === "u9" ? "other" : undefined), ruleOrg: () => "ws1", assetOrg: () => null };
  it("maps audit records to workspace activity and skips covered/foreign ones", () => {
    const base = { id: "a1", at: new Date(), userId: "u1", userName: "Arif", entity: "workspace", entityId: "ws1", details: "Imported 12 assets" };
    expect(auditToActivity({ ...base, action: "asset.import" }, "ws1", ctx)).toMatchObject({ category: "import", verb: "imported assets", href: "/app/portfolio" });
    expect(auditToActivity({ ...base, action: "rule.fired" }, "ws1", ctx)).toBeNull();
    expect(auditToActivity({ ...base, action: "flag.toggle" }, "ws1", ctx)).toBeNull();
    expect(auditToActivity({ ...base, userId: "u9", action: "asset.create", entity: "asset", entityId: "x" }, "ws1", ctx)).toBeNull();
    expect(auditToActivity({ ...base, userId: "system", action: "rule.update", entity: "alert_rule", entityId: "r1" }, "ws1", ctx)).toMatchObject({ category: "rule", href: "/app/alerts?rule=r1" });
  });

  it("groups items into days with Today/Yesterday labels", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    const g = groupByDay([{ at: "2026-09-29T08:00:00Z" }, { at: "2026-09-29T01:00:00Z" }, { at: "2026-09-28T22:00:00Z" }, { at: "2026-09-20T10:00:00Z" }], "UTC", now);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
      ["Sunday, 20 September 2026", 1],
    ]);
  });
});

describe("incident store integration (demo seed, firing de-dup, public page)", () => {
  const WS = "org-ins-deltamutual";
  const me = { id: "user-insurer-demo", name: "Arif Rahman" };

  it("seeds three clearly-labelled demo incidents across workspaces", () => {
    const ins = listIncidents(WS).rows;
    expect(ins.some((r) => r.title.startsWith("Satkhira embankment breach") && r.demo && r.severity === "SEV1")).toBe(true);
    expect(listIncidents("org-ngo-brac").rows[0]!.title).toBe("Cyclone readiness — Khulna coast");
    expect(listIncidents("org-bank-mekong").rows[0]!.status).toBe("monitoring");
    expect(incidentState.incidents.filter((i) => i.demo).every((i) => i.summary.startsWith("[Demo scenario]"))).toBe(true);
  });

  it("opens one incident per rule and appends repeat firings", () => {
    const asset = getStore().assets.find((a) => a.workspaceId === WS)!;
    const mk = (id: string): RuleFiring => ({ id, ruleId: "rule_001", ruleName: "Parametric trigger watch — heavy rain", workspaceId: WS, at: new Date(), severity: "critical", trigger: "monitor", triggeredBy: "system", matchCount: 1, matches: [{ assetId: asset.id, name: asset.name, reason: "flood 72h 71%", metrics: { rain_72h_mm: 131 } }], deliveries: [], notificationId: null });
    portfolioState.firings.unshift(mk("fire_t1"), mk("fire_t2"));
    const a = openIncidentFromFiring("fire_t1", { auto: true });
    expect(a.created).toBe(true);
    expect(a.incident.source.kind).toBe("auto");
    expect(a.incident.hazard).toBe("flood");
    const b = openIncidentFromFiring("fire_t2", { auto: true });
    expect(b.created).toBe(false);
    expect(b.incident.id).toBe(a.incident.id);
    expect(b.incident.links.filter((l) => l.kind === "firing")).toHaveLength(2);
  });

  it("publishes an update to the public page without leaking internals", async () => {
    const inc = createIncident(WS, me, { title: "Test breach", hazard: "flood", severity: "SEV2", summary: "internal notes", silent: true });
    expect(publicStatus(inc.slug)).toBeNull();
    const u = saveUpdate(WS, inc.id, { title: "We are responding", body: "Adjusters deployed.", channels: ["page", "email"] }, me);
    await publishUpdate(WS, inc.id, u.id, me);
    subscribe(inc.slug, "email", "Partner@Example.org");
    expect(() => subscribe(inc.slug, "sms", "01711")).toThrow(/international format/);
    const pub = publicStatus(inc.slug)!;
    expect(pub.updates).toHaveLength(1);
    expect(pub.subscribers).toBe(1);
    expect(JSON.stringify(pub)).not.toMatch(/internal notes|user-insurer|assetIds|partner@/i);
    changeStatus(WS, inc.id, "resolved", me);
    expect(getIncident(WS, inc.id).resolvedAt).not.toBeNull();
  });

  it("comments notify mentioned members only (not the author)", () => {
    const before = getStore().notifications.length;
    addComment(WS, me, { entityType: "incident", entityId: "inc_x", body: "@claims and @insurer please look", label: "INC-1", href: "/app/incidents/inc_x" });
    const added = getStore().notifications.slice(0, getStore().notifications.length - before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ userId: "user-insurer-analyst", kind: "team" });
    const feed = activityFeed(WS, { categories: ["comment"] });
    expect(feed.items[0]!.title).toMatch(/@claims and @insurer/);
  });
});
