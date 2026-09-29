import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("@/auth", () => ({ auth: async () => null, signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const { workspaceRouter } = await import("@/server/routers/workspace");
const { authRouter } = await import("@/server/routers/auth");
const { createCallerFactory } = await import("@/server/trpc");
const { getStore, resetStore } = await import("@/server/data/store");
const { __resetWsState, checkRedeemable, inviteStatus, makeInvite, nextRunAt, rolesForOrg, workspaceShapeFor, wsState, onboardingFor, initialsOf } = await import("@/server/services/workspace-state");
const { outbox } = await import("@/server/notify/channels");

const wsCaller = createCallerFactory(workspaceRouter);
const authCaller = createCallerFactory(authRouter);
let ip = 0;
function as(userId: string | null) {
  const u = userId ? getStore().users.find((x) => x.id === userId) : null;
  const session = u ? ({ user: { id: u.id, name: u.name, email: u.email, role: u.role, orgId: u.orgId, language: u.language }, expires: new Date(Date.now() + 3600_000).toISOString() } as Session) : null;
  const ctx = { session, ip: `10.9.0.${++ip % 250}`, req: new Request("http://localhost/api/trpc") };
  return { ws: wsCaller(ctx), auth: authCaller(ctx) };
}

const ADMIN = "user-insurer-demo";
const ANALYST = "user-insurer-analyst";
const ORG = "org-ins-deltamutual";

beforeEach(() => {
  resetStore();
  __resetWsState();
});

describe("invite token lifecycle (pure)", () => {
  const by = { id: "u1", name: "Admin" };
  it("creates unguessable, pending, 7-day tokens", () => {
    const now = new Date("2026-09-29T00:00:00Z");
    const a = makeInvite({ orgId: "o", email: "  New@Example.com ", role: "enterprise_analyst", by }, now);
    const b = makeInvite({ orgId: "o", email: "x@example.com", role: "enterprise_analyst", by }, now);
    expect(a.email).toBe("new@example.com");
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.expiresAt.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(inviteStatus(a, now)).toBe("pending");
  });

  it("moves pending → expired after the TTL; accepted/revoked are terminal", () => {
    const inv = makeInvite({ orgId: "o", email: "a@b.co", role: "enterprise_analyst", by }, new Date("2026-01-01T00:00:00Z"));
    expect(inviteStatus(inv, new Date("2026-01-07T23:59:59Z"))).toBe("pending");
    expect(inviteStatus(inv, new Date("2026-01-08T00:00:01Z"))).toBe("expired");
    expect(checkRedeemable(inv, new Date("2026-01-09T00:00:00Z"))).toMatchObject({ ok: false, reason: expect.stringMatching(/expired/) });
    expect(inviteStatus({ ...inv, status: "revoked" }, new Date("2026-01-02"))).toBe("revoked");
    expect(checkRedeemable({ ...inv, status: "accepted" }, new Date("2026-01-02"))).toMatchObject({ ok: false, reason: expect.stringMatching(/already been used/) });
    expect(checkRedeemable(undefined)).toMatchObject({ ok: false });
    expect(checkRedeemable(inv, new Date("2026-01-02"))).toMatchObject({ ok: true });
  });
});

describe("invite flow through the workspace router", () => {
  it("admin invites → invitee sees details → accepts once → joins with the role", async () => {
    const admin = as(ADMIN);
    const r = await admin.ws.invite({ email: "new.analyst@deltamutual.example", role: "enterprise_analyst" });
    expect(r.link).toMatch(/^\/invite\//);
    const token = r.link.split("/").pop()!;
    expect(outbox.some((m) => m.channel === "email" && m.to === "new.analyst@deltamutual.example")).toBe(true);

    const team = await admin.ws.team();
    expect(team.invites[0]).toMatchObject({ email: "new.analyst@deltamutual.example", status: "pending" });
    expect(team.seats.pending).toBe(1);

    const anon = as(null);
    const info = await anon.ws.inviteInfo({ token });
    expect(info).toMatchObject({ valid: true, email: "new.analyst@deltamutual.example", orgName: "Delta Mutual Agri Insurance Ltd", role: "enterprise_analyst" });

    const acc = await anon.ws.acceptInvite({ token, name: "Nadia Karim", password: "correct-horse-9" });
    expect(acc.orgName).toBe("Delta Mutual Agri Insurance Ltd");
    const user = getStore().users.find((u) => u.email === "new.analyst@deltamutual.example")!;
    expect(user).toMatchObject({ orgId: ORG, role: "enterprise_analyst", status: "active" });

    // Single use
    await expect(anon.ws.acceptInvite({ token, name: "Someone Else", password: "another-pass-1" })).rejects.toThrow(/already been used/);
    expect((await anon.ws.inviteInfo({ token })).valid).toBe(false);
    expect((await admin.ws.team()).members.some((m) => m.email === "new.analyst@deltamutual.example")).toBe(true);
  });

  it("revoked and expired invites can't be redeemed; resend issues a fresh token", async () => {
    const admin = as(ADMIN);
    const r1 = await admin.ws.invite({ email: "revoke.me@example.com", role: "enterprise_analyst" });
    const inv1 = wsState().invites.find((i) => i.email === "revoke.me@example.com")!;
    await admin.ws.revokeInvite({ id: inv1.id });
    expect(await as(null).ws.inviteInfo({ token: r1.link.split("/").pop()! })).toMatchObject({ valid: false, reason: expect.stringMatching(/revoked/) });

    const r2 = await admin.ws.invite({ email: "late@example.com", role: "enterprise_analyst" });
    const inv2 = wsState().invites.find((i) => i.email === "late@example.com")!;
    inv2.expiresAt = new Date(Date.now() - 1000);
    const oldToken = r2.link.split("/").pop()!;
    await expect(as(null).ws.acceptInvite({ token: oldToken, name: "Late Person", password: "late-pass-123" })).rejects.toThrow(/expired/);

    // Pending → resend rotates token
    const r3 = await admin.ws.invite({ email: "resend@example.com", role: "enterprise_admin" });
    const re = await admin.ws.resendInvite({ id: wsState().invites.find((i) => i.email === "resend@example.com")!.id });
    expect(re.link).not.toBe(r3.link);
    expect((await as(null).ws.inviteInfo({ token: r3.link.split("/").pop()! })).valid).toBe(false);
    expect((await as(null).ws.inviteInfo({ token: re.link.split("/").pop()! })).valid).toBe(true);
  });

  it("rejects duplicates, existing accounts, foreign roles and non-admins", async () => {
    const admin = as(ADMIN);
    await admin.ws.invite({ email: "dup@example.com", role: "enterprise_analyst" });
    await expect(admin.ws.invite({ email: "dup@example.com", role: "enterprise_analyst" })).rejects.toThrow(/already pending/);
    await expect(admin.ws.invite({ email: "claims@demo.agrishield.io", role: "enterprise_analyst" })).rejects.toThrow(/already a member/);
    await expect(admin.ws.invite({ email: "bank@demo.agrishield.io", role: "enterprise_analyst" })).rejects.toThrow(/another workspace/);
    await expect(admin.ws.invite({ email: "x@example.com", role: "national_admin" })).rejects.toThrow(/role/);
    await expect(as(ANALYST).ws.invite({ email: "y@example.com", role: "enterprise_analyst" })).rejects.toThrow(/permission/i);
  });

  it("enforces seats on the plan (members + pending invites)", async () => {
    const org = getStore().orgs.find((o) => o.id === ORG)!;
    org.planTier = "free"; // 2 seats; Delta Mutual already has 2 members
    await expect(as(ADMIN).ws.invite({ email: "third@example.com", role: "enterprise_analyst" })).rejects.toThrow(/seats limit reached/i);
  });

  it("keeps at least one admin and removes members' access", async () => {
    const admin = as(ADMIN);
    await expect(admin.ws.removeMember({ userId: ADMIN })).rejects.toThrow(/yourself/);
    await admin.ws.changeRole({ userId: ANALYST, role: "enterprise_admin" });
    expect(getStore().users.find((u) => u.id === ANALYST)!.role).toBe("enterprise_admin");
    await admin.ws.changeRole({ userId: ANALYST, role: "enterprise_analyst" });
    await admin.ws.removeMember({ userId: ANALYST });
    const u = getStore().users.find((x) => x.id === ANALYST)!;
    expect(u.orgId).toBeNull();
    expect(u.status).toBe("suspended");
    expect(getStore().audit.some((a) => a.action === "team.remove" && a.entityId === ANALYST)).toBe(true);
  });
});

describe("enterprise sign-up", () => {
  it("creates an org workspace with a 14-day Business trial and the right admin role", async () => {
    const r = await as(null).auth.registerWorkspace({ orgName: "Sundarban Crop Assurance", industry: "insurance", country: "Bangladesh", name: "Rina Das", email: "rina@sca.example", password: "long-enough-1" });
    expect(r.role).toBe("enterprise_admin");
    const org = getStore().orgs.find((o) => o.id === r.orgId)!;
    expect(org).toMatchObject({ industry: "insurance", type: "insurance", planTier: "business" });
    expect(org.settings?.timezone).toBe("Asia/Dhaka");
    const days = (new Date(org.trialEndsAt!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    expect(getStore().subscriptions.find((s) => s.orgId === org.id)).toMatchObject({ plan: "business", status: "trialing" });
    // New workspace starts with an empty onboarding checklist
    expect(onboardingFor(org.id)).toMatchObject({ done: 0, total: 5, complete: false });

    await expect(as(null).auth.registerWorkspace({ orgName: "Another", industry: "banking", country: "India", name: "X Y", email: "rina@sca.example", password: "long-enough-1" })).rejects.toThrow(/already exists/);
  });

  it("maps industries to gov / supply-chain roles", async () => {
    expect(workspaceShapeFor("government")).toEqual({ type: "government", adminRole: "national_admin" });
    expect(workspaceShapeFor("agribusiness")).toEqual({ type: "supply_chain", adminRole: "supply_chain_admin" });
    expect(rolesForOrg({ type: "government" }).map((r) => r.role)).toContain("field_officer");
    const g = await as(null).auth.registerWorkspace({ orgName: "Ministry of Agriculture Testland", industry: "government", country: "Kenya", name: "Amina Otieno", email: "amina@gov.example", password: "long-enough-1" });
    expect(g.role).toBe("national_admin");
  });
});

describe("helpers", () => {
  it("nextRunAt schedules weekly and monthly runs strictly in the future", () => {
    const from = new Date("2026-09-29T10:00:00Z"); // Tuesday
    expect(nextRunAt("weekly", 1, 3, from).toISOString()).toBe("2026-10-05T03:00:00.000Z"); // next Monday
    expect(nextRunAt("weekly", 2, 12, from).toISOString()).toBe("2026-09-29T12:00:00.000Z"); // later today
    expect(nextRunAt("weekly", 2, 9, from).toISOString()).toBe("2026-10-06T09:00:00.000Z"); // already passed today
    expect(nextRunAt("monthly", 1, 3, from).toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(nextRunAt("monthly", 29, 3, from).toISOString()).toBe("2026-10-28T03:00:00.000Z"); // clamped to 28
  });

  it("initialsOf skips legal suffixes", () => {
    expect(initialsOf("Delta Mutual Agri Insurance Ltd")).toBe("DM");
    expect(initialsOf("AsiaGrain Logistics Pte Ltd")).toBe("AL");
    expect(initialsOf("BRAC")).toBe("BR");
  });
});
