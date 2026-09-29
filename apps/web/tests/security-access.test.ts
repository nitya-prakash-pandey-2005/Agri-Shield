import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("@/auth", () => ({ auth: async () => null, signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

const { appRouter } = await import("@/server/routers/_app");
const { createCallerFactory } = await import("@/server/trpc");
const { getStore, resetStore } = await import("@/server/data/store");
const { __resetSecurityState, secState } = await import("@/server/auth/security-state");
const { cidrContains, ipAllowed, normalizeCidr, parseCidr, parseIp } = await import("@/server/auth/ip-allowlist");
const sessions = await import("@/server/services/sessions");
const roles = await import("@/server/services/custom-roles");
const { securityScore } = await import("@/server/auth/security-score");

const createCaller = createCallerFactory(appRouter);

function session(userId: string, sid?: string): Session {
  const u = getStore().users.find((x) => x.id === userId)!;
  return { user: { id: u.id, name: u.name, email: u.email, role: u.role, orgId: u.orgId, language: u.language }, sid, expires: new Date(Date.now() + 3600_000).toISOString() } as Session;
}
const caller = (userId: string, opts: { sid?: string; ip?: string } = {}) => createCaller({ session: session(userId, opts.sid), ip: opts.ip ?? "10.0.0.5", req: new Request("http://localhost:3126/api/trpc", { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0" } }) });

beforeEach(() => {
  resetStore();
  __resetSecurityState();
});

describe("IP allow-list maths", () => {
  it("parses IPv4, IPv6, mapped and loopback addresses", () => {
    expect(parseIp("203.0.113.9")?.v).toBe(4);
    expect(parseIp("2001:db8::1")?.v).toBe(6);
    expect(parseIp("::ffff:10.1.2.3")).toEqual(parseIp("10.1.2.3"));
    expect(parseIp("local")).toEqual(parseIp("127.0.0.1"));
    expect(parseIp("256.1.1.1")).toBeNull();
    expect(parseIp("2001:db8:::1")).toBeNull();
    expect(parseIp("hello")).toBeNull();
  });
  it("matches CIDR ranges", () => {
    const r = parseCidr("10.20.0.0/16")!;
    expect(cidrContains(r, "10.20.255.1")).toBe(true);
    expect(cidrContains(r, "10.21.0.1")).toBe(false);
    expect(cidrContains(parseCidr("2001:db8::/32")!, "2001:db8:ffff::5")).toBe(true);
    expect(cidrContains(parseCidr("2001:db8::/32")!, "2001:db9::5")).toBe(false);
    expect(cidrContains(parseCidr("0.0.0.0/0")!, "8.8.8.8")).toBe(true);
    expect(ipAllowed("::1", ["127.0.0.1/32"])).toBe(true);
    expect(ipAllowed("local", ["::1"])).toBe(true);
    expect(ipAllowed("198.51.100.7", ["203.0.113.0/24", "198.51.100.7"])).toBe(true);
    expect(normalizeCidr("198.51.100.7")).toBe("198.51.100.7/32");
    expect(normalizeCidr("10.0.0.0/33")).toBeNull();
    expect(normalizeCidr("10.0.0.0/8/1")).toBeNull();
  });
});

describe("session registry", () => {
  const base = { userId: "user-bank-demo", orgId: "org-bank-mekong", method: "password" as const, amr: ["pwd"], ip: "10.0.0.1", userAgent: "curl/8" };
  it("revocation takes effect on the next check", () => {
    const s = sessions.createSession(base);
    const token = { sid: s.id, uid: base.userId, authAt: s.createdAt.getTime() };
    expect(sessions.checkSession(token).ok).toBe(true);
    sessions.revokeSession(s.id, "admin");
    expect(sessions.checkSession(token)).toEqual({ ok: false, reason: "revoked" });
    expect(sessions.isSessionRevoked(s.id)).toBe(true);
  });
  it("rejects a sid presented for another user and adopts unknown sids", () => {
    const s = sessions.createSession(base);
    expect(sessions.checkSession({ sid: s.id, uid: "someone-else" })).toEqual({ ok: false, reason: "user_mismatch" });
    const adopted = sessions.checkSession({ sid: "ses_from_other_node", uid: base.userId, authAt: Date.now() });
    expect(adopted.ok && adopted.session?.method).toBe("restored");
  });
  it("sign out everywhere keeps the current session and kills legacy tokens", () => {
    const a = sessions.createSession(base);
    const b = sessions.createSession(base);
    const c = sessions.createSession({ ...base, userAgent: "Mozilla/5.0 (iPhone) Mobile Safari/604.1" });
    expect(sessions.revokeOtherSessions(base.userId, a.id, base.userId)).toBe(2);
    expect(sessions.checkSession({ sid: a.id, uid: base.userId, authAt: a.createdAt.getTime() }).ok).toBe(true);
    expect(sessions.checkSession({ sid: b.id, uid: base.userId, authAt: b.createdAt.getTime() }).ok).toBe(false);
    expect(sessions.checkSession({ sid: c.id, uid: base.userId, authAt: c.createdAt.getTime() }).ok).toBe(false);
    expect(sessions.checkSession({ uid: base.userId })).toEqual({ ok: false, reason: "not_before" }); // pre-tracking token
    expect(sessions.checkSession({ uid: base.userId, authAt: Date.now() + 5 }).ok).toBe(true); // fresh sign-in later
  });
  it("describes devices", () => {
    expect(sessions.describeUserAgent("curl/8.4.0").kind).toBe("api");
    expect(sessions.describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36").label).toBe("Chrome on Windows");
    expect(sessions.describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148 Safari/604.1").kind).toBe("mobile");
  });
});

describe("tRPC enforcement", () => {
  it("a session revoked from another context stops working immediately", async () => {
    const mine = sessions.createSession({ userId: "user-bank-demo", orgId: "org-bank-mekong", method: "password", amr: ["pwd"], ip: "10.0.0.5", userAgent: "A" });
    const other = sessions.createSession({ userId: "user-bank-demo", orgId: "org-bank-mekong", method: "password", amr: ["pwd"], ip: "10.0.0.6", userAgent: "B" });
    const a = caller("user-bank-demo", { sid: mine.id });
    const b = caller("user-bank-demo", { sid: other.id });
    expect((await b.workspace.me()).org).toBeTruthy();
    const ov = await a.developer.security.overview();
    expect(ov.sessions.map((s) => s.id)).toEqual(expect.arrayContaining([mine.id, other.id]));
    await a.developer.security.revokeSession({ id: other.id });
    await expect(b.workspace.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(a.developer.security.revokeSession({ id: mine.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // a different workspace's admin cannot see or revoke it
    await expect(caller("user-insurer-demo").developer.security.revokeSession({ id: mine.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("IP allow-list: refuses to lock the admin out, then blocks other networks", async () => {
    const admin = caller("user-bank-demo", { ip: "10.0.0.5" });
    await expect(admin.developer.security.setIpAllowlist({ enabled: true, entries: [{ cidr: "192.168.0.0/16", label: "HQ" }] })).rejects.toThrow(/lock yourself out/);
    await expect(admin.developer.security.setIpAllowlist({ enabled: true, entries: [{ cidr: "not-an-ip", label: "" }] })).rejects.toThrow(/not a valid/);
    await admin.developer.security.setIpAllowlist({ enabled: true, entries: [{ cidr: "10.0.0.0/24", label: "Office VPN" }] });
    expect((await caller("user-bank-analyst", { ip: "10.0.0.77" }).workspace.me()).org).toBeTruthy();
    await expect(caller("user-bank-analyst", { ip: "203.0.113.10" }).workspace.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
    // other workspaces are unaffected
    expect((await caller("user-insurer-demo", { ip: "203.0.113.10" }).workspace.me()).org).toBeTruthy();
  });

  it("custom roles: module + permission enforcement, backward compatible without a role", async () => {
    const admin = caller("user-insurer-demo");
    expect(await caller("user-insurer-analyst").insurance.ping()).toEqual({ ok: true });
    const role = await admin.developer.security.createRole({ name: "Claims reviewer", cloneFrom: "enterprise_analyst", permissions: ["use_workspace", "view_gov_dashboard" as never], modules: ["explorer", "portfolio"] });
    expect(role.permissions).toEqual(["use_workspace"]); // gov permission is not assignable in an insurer workspace; manage_assets was dropped
    await admin.developer.security.assignRole({ userId: "user-insurer-analyst", roleId: role.id });
    const analyst = caller("user-insurer-analyst");
    expect(await analyst.explorer.ping()).toEqual({ ok: true });
    await expect(analyst.insurance.ping()).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/Claims reviewer/) });
    expect(roles.resolvePermission({ id: "user-insurer-analyst", role: "enterprise_analyst", orgId: "org-ins-deltamutual" }, "manage_assets")).toBe(false);
    expect(roles.resolvePermission({ id: "user-insurer-analyst", role: "enterprise_analyst", orgId: "org-ins-deltamutual" }, "use_workspace", "developer.security.overview")).toBe(true);
    // own security settings stay reachable even without the developers module
    expect((await analyst.developer.security.overview()).user.customRole?.name).toBe("Claims reviewer");
    await admin.developer.security.updateRole({ id: role.id, modules: ["explorer", "portfolio", "insurance"] });
    expect(await analyst.insurance.ping()).toEqual({ ok: true });
    await admin.developer.security.assignRole({ userId: "user-insurer-analyst", roleId: null });
    expect(roles.resolvePermission({ id: "user-insurer-analyst", role: "enterprise_analyst", orgId: "org-ins-deltamutual" }, "manage_assets")).toBe(true);
    // admins can't demote themselves out of admin rights
    await expect(admin.developer.security.assignRole({ userId: "user-insurer-demo", roleId: role.id })).rejects.toThrow(/yourself/);
    // non-admins can't manage roles
    await expect(caller("user-insurer-analyst").developer.security.roles()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("deleting a role reverts members to their built-in role", async () => {
    const admin = caller("user-bank-demo");
    const r = await admin.developer.security.createRole({ name: "Read only", cloneFrom: "enterprise_analyst", modules: [] });
    await admin.developer.security.assignRole({ userId: "user-bank-analyst", roleId: r.id });
    await expect(caller("user-bank-analyst").finance.ping()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await admin.developer.security.deleteRole({ id: r.id })).reverted).toBe(1);
    expect(await caller("user-bank-analyst").finance.ping()).toEqual({ ok: true });
  });

  it("require-2FA policy, score card and audit export", async () => {
    const admin = caller("user-bank-demo");
    const before = await admin.developer.security.score();
    await admin.developer.security.setPolicy({ require2fa: true });
    const after = await admin.developer.security.score();
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.items.find((i) => i.id === "mfa_policy")?.status).toBe("good");
    const exp = await admin.developer.security.auditExport({ format: "csv", prefix: "security." });
    expect(exp.content.split("\n")[0]).toBe("id,at,userId,userName,action,entity,entityId,details");
    expect(exp.content).toContain("security.policy.require_2fa");
    expect(exp.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(securityScore("org-bank-mekong").items).toHaveLength(7);
  });

  it("challenge endpoints refuse forged tokens", async () => {
    const pub = createCaller({ session: null, ip: "10.9.9.9", req: new Request("http://localhost:3126/api/trpc") });
    expect(await pub.developer.security.challengeInfo({ challenge: "x".repeat(40) })).toMatchObject({ ok: false });
    await expect(pub.developer.security.confirmChallengeEnrolment({ challenge: "x".repeat(40), code: "123456" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(secState().totp.size).toBe(0);
  });
});
