/**
 * securityRouter — mounted at `developer.security` (see developer.ts).
 *
 *  Pre-session (public, challenge-token bound): challengeInfo, confirmChallengeEnrolment, ssoDiscover
 *  Personal: overview, startEnrolment, confirmEnrolment, disable2fa, regenerateRecovery,
 *            revokeSession, revokeOtherSessions
 *  Workspace admin (manage_workspace): setPolicy, setIpAllowlist, members, memberSessions,
 *            revokeMemberSessions, resetMember2fa, sso*, roles*, auditExport, score
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { UserRole } from "@agri-shield/types";
import { ROLE_LABELS, type Permission, PERMISSIONS } from "@/lib/rbac";
import { permitted, protectedProcedure, publicProcedure, router } from "../trpc";
import { audit, getStore, type OrgRecord } from "../data/store";
import { isAdminRole, rolesForOrg } from "../services/workspace-state";
import { notifyWorkspace } from "../services/workspace-notifications";
import { signToken, verifyToken } from "../auth/crypto";
import { qrSvgPath, encodeQr } from "../auth/qr";
import { lookupChallenge, registerAttempt } from "../auth/challenge";
import { policyFor, secState } from "../auth/security-state";
import { ipAllowed, normalizeCidr } from "../auth/ip-allowlist";
import { securityScore } from "../auth/security-score";
import { OidcError } from "../auth/oidc";
import {
  beginEnrolment,
  confirmEnrolment,
  disableTotp,
  enrolmentOf,
  formatSecret,
  isEnrolled,
  otpauthUri,
  regenerateRecoveryCodes,
  verifySecondFactor,
  openSecret,
} from "../services/totp";
import { base32Encode } from "../auth/crypto";
import { describeUserAgent, revokeAllForUser, revokeOtherSessions, revokeSession, sessionsForUser } from "../services/sessions";
import { MOCK_IDP, mockIdpEnabled, orgForEmail, saveSsoConfig, ssoView, testSsoConfig } from "../services/sso";
import {
  ALL_MODULE_IDS,
  PERMISSION_INFO,
  WORKSPACE_MODULES,
  accessSummary,
  assignCustomRole,
  assignablePermissions,
  builtInPermissions,
  createCustomRole,
  customRoleOf,
  deleteCustomRole,
  rolesOf,
  updateCustomRole,
} from "../services/custom-roles";

const admin = permitted("manage_workspace");
const USER_ROLES = ["farmer", "field_officer", "regional_admin", "national_admin", "supply_chain_analyst", "supply_chain_admin", "enterprise_analyst", "enterprise_admin", "platform_admin"] as const satisfies readonly UserRole[];
const PERMISSION_KEYS = Object.keys(PERMISSIONS) as [Permission, ...Permission[]];

type Ctx = { user: { id: string; name: string; role: UserRole; orgId: string | null }; session: { sid?: string } | null; ip: string; req?: Request };

function orgOf(ctx: Ctx): OrgRecord {
  if (!ctx.user.orgId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is not linked to a workspace." });
  const org = getStore().orgs.find((o) => o.id === ctx.user.orgId);
  if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  return org;
}
const me = (ctx: Ctx) => getStore().users.find((u) => u.id === ctx.user.id);
const actor = (ctx: Ctx) => ({ id: ctx.user.id, name: me(ctx)?.name ?? ctx.user.name ?? "user" });
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const origin = (ctx: Ctx) => {
  try {
    return new URL(ctx.req?.url ?? "").origin;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  }
};
const maskEmail = (e: string | null | undefined) => (e ? e.replace(/^(.)(.*)(.@.*)$/, (_, a: string, mid: string, b: string) => `${a}${"•".repeat(Math.min(6, mid.length))}${b}`) : "your account");

function qrFor(uri: string) {
  const qr = encodeQr(uri);
  const { path, viewBox } = qrSvgPath(qr, 3);
  return { path, viewBox, version: qr.version };
}

function sessionRows(userId: string, currentSid: string | null | undefined) {
  return sessionsForUser(userId).map((s) => ({
    id: s.id,
    current: s.id === currentSid,
    createdAt: s.createdAt,
    lastSeen: s.lastSeen,
    expiresAt: s.expiresAt,
    ip: s.ip,
    device: describeUserAgent(s.userAgent),
    method: s.method,
    mfa: s.amr.includes("mfa") || s.amr.includes("sso"),
    revokedAt: s.revokedAt,
    revokeReason: s.revokeReason,
  }));
}

/** Re-authentication for sensitive changes: password (if the account has one) + a current second factor. */
function reauth(ctx: Ctx, input: { password?: string; code: string }) {
  const user = me(ctx);
  if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
  if (user.password && input.password !== user.password) throw bad("Your password is incorrect");
  const r = verifySecondFactor(user.id, input.code);
  if (!r.ok) throw bad(r.reason === "locked" ? "Too many wrong codes — try again in 15 minutes" : r.reason === "replay" ? "That code was already used — wait for the next one" : "That code is not valid");
  return user;
}

// ─── Enrolment tokens (personal, signed-in) ──────────────────────────────

const ENROL_TTL = 10 * 60;

export const securityRouter = router({
  // ═══ Pre-session: 2-step challenge at sign-in ═══════════════════════════
  challengeInfo: publicProcedure.input(z.object({ challenge: z.string().min(20).max(1024) })).query(({ input }) => {
    const look = lookupChallenge(input.challenge);
    if (!look.ok) return { ok: false as const, reason: look.reason };
    const c = look.challenge;
    const user = getStore().users.find((u) => u.id === c.userId);
    const org = user?.orgId ? getStore().orgs.find((o) => o.id === user.orgId) : null;
    const base = { ok: true as const, purpose: c.purpose, state: c.state, account: maskEmail(user?.email), orgName: org?.name ?? null, expiresAt: c.expiresAt, attemptsLeft: Math.max(0, 5 - c.attempts), firstFactor: c.firstFactor };
    if (c.purpose !== "enrol" || !c.pendingSecretSealed) return { ...base, enrol: null };
    const secret = base32Encode(openSecret(c.pendingSecretSealed));
    const uri = otpauthUri({ secret, account: user?.email ?? user?.id ?? "account" });
    return { ...base, enrol: { uri, manualKey: formatSecret(secret), qr: qrFor(uri) } };
  }),

  confirmChallengeEnrolment: publicProcedure.input(z.object({ challenge: z.string().min(20).max(1024), code: z.string().trim().min(6).max(10) })).mutation(({ input }) => {
    const look = lookupChallenge(input.challenge);
    if (!look.ok) throw bad(look.reason === "too_many_attempts" ? "Too many attempts — sign in again" : "This sign-in attempt expired — sign in again");
    const c = look.challenge;
    if (c.purpose !== "enrol" || !c.pendingSecretSealed || c.state !== "pending") throw bad("Nothing to enrol");
    registerAttempt(c);
    const r = confirmEnrolment(c.userId, c.pendingSecretSealed, input.code);
    if (!r.ok) throw bad(r.reason);
    c.state = "satisfied";
    c.satisfiedWith = "totp";
    const user = getStore().users.find((u) => u.id === c.userId);
    audit({ userId: c.userId, userName: user?.name ?? "user", action: "security.2fa.enable", entity: "user", entityId: c.userId, details: "Authenticator app enrolled at sign-in (workspace requires 2FA)" });
    return { recoveryCodes: r.recoveryCodes };
  }),

  /** Home-realm discovery for "Sign in with SSO". */
  ssoDiscover: publicProcedure.input(z.object({ email: z.string().trim().email().max(200) })).query(({ input }) => {
    const hit = orgForEmail(input.email);
    return hit ? { sso: true as const, orgName: hit.org.name, enforced: hit.config.enforceForDomains } : { sso: false as const };
  }),

  // ═══ Personal ═══════════════════════════════════════════════════════════
  overview: protectedProcedure.query(({ ctx }) => {
    const user = me(ctx);
    const e = enrolmentOf(ctx.user.id);
    const org = ctx.user.orgId ? getStore().orgs.find((o) => o.id === ctx.user.orgId) : null;
    const policy = policyFor(ctx.user.orgId);
    const sso = org ? ssoView(org.id, origin(ctx)) : null;
    const access = accessSummary({ id: ctx.user.id, role: ctx.user.role, orgId: ctx.user.orgId });
    return {
      user: { id: ctx.user.id, name: user?.name ?? ctx.user.name, email: user?.email ?? null, hasPassword: !!user?.password, role: access.role, roleLabel: ROLE_LABELS[access.role], customRole: access.customRole },
      twoFactor: e ? { enrolled: true, since: e.createdAt, lastUsedAt: e.lastUsedAt, recoveryLeft: e.recovery.filter((r) => !r.usedAt).length } : { enrolled: false, since: null, lastUsedAt: null, recoveryLeft: 0 },
      sessions: sessionRows(ctx.user.id, ctx.session?.sid),
      currentSid: ctx.session?.sid ?? null,
      currentIp: ctx.ip,
      org: org ? { id: org.id, name: org.name } : null,
      policy: { require2fa: policy.require2fa, require2faSince: policy.require2faSince, ipAllowlist: policy.ipAllowlist },
      sso: sso ? { enabled: sso.enabled, issuerHost: sso.issuer ? new URL(sso.issuer).host : null, domains: sso.allowedDomains } : null,
      canManage: isAdminRole(access.role) || access.permissions.includes("manage_workspace"),
    };
  }),

  startEnrolment: protectedProcedure.mutation(({ ctx }) => {
    const user = me(ctx);
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
    if (isEnrolled(user.id)) throw bad("2-step verification is already on — disable it first to re-enrol");
    const e = beginEnrolment(user.email ?? user.id);
    return { token: signToken("totp-enrol", { uid: user.id, s: e.sealed }, ENROL_TTL), uri: e.uri, manualKey: formatSecret(e.secret), qr: qrFor(e.uri), expiresInSec: ENROL_TTL };
  }),

  confirmEnrolment: protectedProcedure.input(z.object({ token: z.string().max(2048), code: z.string().trim().min(6).max(8) })).mutation(({ ctx, input }) => {
    const t = verifyToken<{ uid: string; s: string }>("totp-enrol", input.token);
    if (!t || t.uid !== ctx.user.id) throw bad("Setup expired — start again");
    if (isEnrolled(ctx.user.id)) throw bad("Already enrolled");
    const r = confirmEnrolment(ctx.user.id, t.s, input.code);
    if (!r.ok) throw bad(r.reason);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "security.2fa.enable", entity: "user", entityId: ctx.user.id, details: "Authenticator app (TOTP) enrolled · 10 recovery codes issued" });
    return { recoveryCodes: r.recoveryCodes };
  }),

  disable2fa: protectedProcedure.input(z.object({ password: z.string().max(128).optional(), code: z.string().trim().min(6).max(16) })).mutation(({ ctx, input }) => {
    if (!isEnrolled(ctx.user.id)) throw bad("2-step verification is not on");
    if (policyFor(ctx.user.orgId).require2fa) throw new TRPCError({ code: "FORBIDDEN", message: "Your workspace requires 2-step verification — it can't be turned off. Use a recovery code or ask an admin to reset it if you lost your phone." });
    reauth(ctx, input);
    disableTotp(ctx.user.id);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "security.2fa.disable", entity: "user", entityId: ctx.user.id, details: "Authenticator app removed (re-authenticated with password + code)" });
    return { ok: true };
  }),

  regenerateRecovery: protectedProcedure.input(z.object({ password: z.string().max(128).optional(), code: z.string().trim().min(6).max(16) })).mutation(({ ctx, input }) => {
    if (!isEnrolled(ctx.user.id)) throw bad("2-step verification is not on");
    reauth(ctx, input);
    const codes = regenerateRecoveryCodes(ctx.user.id)!;
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "security.2fa.recovery_regenerated", entity: "user", entityId: ctx.user.id, details: "10 new recovery codes; old codes invalidated" });
    return { recoveryCodes: codes };
  }),

  revokeSession: protectedProcedure.input(z.object({ id: z.string().max(100) })).mutation(({ ctx, input }) => {
    const rec = secState().sessions.get(input.id);
    if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
    const own = rec.userId === ctx.user.id;
    const canAdmin = !own && !!ctx.user.orgId && rec.orgId === ctx.user.orgId && accessSummary({ id: ctx.user.id, role: ctx.user.role, orgId: ctx.user.orgId }).permissions.includes("manage_workspace");
    if (!own && !canAdmin) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
    if (input.id === ctx.session?.sid) throw bad("Use Sign out to end the session you're using");
    revokeSession(rec.id, ctx.user.id, own ? "revoked by owner" : `revoked by admin ${actor(ctx).name}`);
    const who = getStore().users.find((u) => u.id === rec.userId);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "security.session.revoke", entity: "session", entityId: rec.id, details: `${who?.name ?? rec.userId} · ${describeUserAgent(rec.userAgent).label} · IP ${rec.ip}` });
    return { ok: true };
  }),

  revokeOtherSessions: protectedProcedure.mutation(({ ctx }) => {
    const n = revokeOtherSessions(ctx.user.id, ctx.session?.sid ?? null, ctx.user.id);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "security.session.revoke_others", entity: "user", entityId: ctx.user.id, details: `Signed out ${n} other session(s)` });
    return { revoked: n };
  }),

  // ═══ Workspace admin ════════════════════════════════════════════════════
  score: admin.query(({ ctx }) => securityScore(orgOf(ctx).id)),

  setPolicy: admin.input(z.object({ require2fa: z.boolean() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const p = policyFor(org.id);
    if (p.require2fa === input.require2fa) return { ok: true };
    p.require2fa = input.require2fa;
    p.require2faSince = input.require2fa ? new Date() : null;
    p.updatedAt = new Date();
    p.updatedBy = ctx.user.id;
    const missing = getStore().users.filter((u) => u.orgId === org.id && !isEnrolled(u.id)).length;
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: input.require2fa ? "security.policy.require_2fa" : "security.policy.optional_2fa", entity: "organization", entityId: org.id, details: input.require2fa ? `2FA required · ${missing} member(s) will enrol at next sign-in` : "2FA now optional" });
    if (input.require2fa) notifyWorkspace({ workspaceId: org.id, userId: null, kind: "system", title: "2-step verification is now required", body: `${actor(ctx).name} turned on mandatory 2-step verification. Members without an authenticator app will set one up at their next sign-in.`, href: "/app/settings/security", severity: "warning" });
    return { ok: true, membersToEnrol: missing };
  }),

  setIpAllowlist: admin.input(z.object({ enabled: z.boolean(), entries: z.array(z.object({ cidr: z.string().trim().max(64), label: z.string().trim().max(60).default("") })).max(50) })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const entries = input.entries.map((e) => {
      const cidr = normalizeCidr(e.cidr);
      if (!cidr) throw bad(`"${e.cidr}" is not a valid IP address or CIDR range`);
      return { cidr, label: e.label };
    });
    if (input.enabled && entries.length === 0) throw bad("Add at least one address or range before turning the allow-list on");
    if (input.enabled && !ipAllowed(ctx.ip, entries.map((e) => e.cidr))) throw bad(`Your current address (${ctx.ip === "local" ? "127.0.0.1" : ctx.ip}) is not in the list — add it first so you don't lock yourself out`);
    const p = policyFor(org.id);
    p.ipAllowlist = { enabled: input.enabled, entries };
    p.updatedAt = new Date();
    p.updatedBy = ctx.user.id;
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "security.policy.ip_allowlist", entity: "organization", entityId: org.id, details: `${input.enabled ? "Enabled" : "Disabled"} · ${entries.map((e) => e.cidr).join(", ") || "no entries"}` });
    return { ok: true, currentIp: ctx.ip };
  }),

  members: admin.query(({ ctx }) => {
    const org = orgOf(ctx);
    const st = secState();
    const now = Date.now();
    return getStore()
      .users.filter((u) => u.orgId === org.id)
      .map((u) => {
        const sessions = [...st.sessions.values()].filter((s) => s.userId === u.id && !s.revokedAt && s.expiresAt.getTime() > now);
        const custom = customRoleOf(u.id, org.id);
        return { id: u.id, name: u.name, email: u.email, title: u.title ?? null, role: u.role, roleLabel: ROLE_LABELS[u.role], customRoleId: custom?.id ?? null, customRoleName: custom?.name ?? null, twoFactor: isEnrolled(u.id), activeSessions: sessions.length, lastSeen: sessions.reduce<Date | null>((a, s) => (!a || s.lastSeen > a ? s.lastSeen : a), null) ?? u.lastActive, sso: u.title === "Provisioned via SSO", status: u.status, isMe: u.id === ctx.user.id };
      })
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name));
  }),

  memberSessions: admin.input(z.object({ userId: z.string() })).query(({ ctx, input }) => {
    const org = orgOf(ctx);
    const u = getStore().users.find((x) => x.id === input.userId && x.orgId === org.id);
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
    return sessionRows(u.id, ctx.session?.sid);
  }),

  revokeMemberSessions: admin.input(z.object({ userId: z.string() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const u = getStore().users.find((x) => x.id === input.userId && x.orgId === org.id);
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
    if (u.id === ctx.user.id) throw bad("Use “Sign out all other sessions” for your own account");
    const n = revokeAllForUser(u.id, ctx.user.id, `signed out by admin ${actor(ctx).name}`);
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "security.session.revoke_member", entity: "user", entityId: u.id, details: `${u.name}: ${n} session(s) revoked` });
    return { revoked: n };
  }),

  resetMember2fa: admin.input(z.object({ userId: z.string() })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const u = getStore().users.find((x) => x.id === input.userId && x.orgId === org.id);
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
    if (u.id === ctx.user.id) throw bad("Reset your own 2-step verification from “Your account” with re-authentication");
    if (!disableTotp(u.id)) throw bad(`${u.name} has no authenticator enrolled`);
    const n = revokeAllForUser(u.id, ctx.user.id, "2FA reset by admin");
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "security.2fa.reset", entity: "user", entityId: u.id, details: `${u.name}: authenticator removed, ${n} session(s) signed out` });
    notifyWorkspace({ workspaceId: org.id, userId: u.id, kind: "system", title: "Your 2-step verification was reset", body: `${actor(ctx).name} reset your authenticator. ${policyFor(org.id).require2fa ? "You'll set up a new one at your next sign-in." : "Set up a new one in Settings → Security."}`, href: "/app/settings/security", severity: "warning" });
    return { ok: true };
  }),

  // ─── SSO ──────────────────────────────────────────────────────────────
  sso: admin.query(({ ctx }) => {
    const org = orgOf(ctx);
    return { config: ssoView(org.id, origin(ctx)), roles: rolesForOrg(org), redirectUri: `${origin(ctx)}/api/sso/callback`, mockAvailable: mockIdpEnabled(), mock: mockIdpEnabled() ? { issuer: `${origin(ctx)}${MOCK_IDP.path}`, clientId: MOCK_IDP.clientId, clientSecret: MOCK_IDP.clientSecret } : null };
  }),

  saveSso: admin
    .input(
      z.object({
        enabled: z.boolean(),
        issuer: z.string().trim().url().max(300),
        clientId: z.string().trim().min(1).max(200),
        clientSecret: z.string().max(500).optional().nullable(),
        allowedDomains: z.array(z.string().trim().max(253)).max(20),
        defaultRole: z.enum(USER_ROLES),
        jitProvisioning: z.boolean(),
        enforceForDomains: z.boolean(),
      })
    )
    .mutation(({ ctx, input }) => {
      const org = orgOf(ctx);
      if (input.enforceForDomains && input.enabled && ssoView(org.id).logins === 0) {
        // Never lock password users out before the IdP connection is proven
        throw bad("Complete at least one successful SSO sign-in before enforcing SSO for your domains");
      }
      try {
        return saveSsoConfig(org, input, actor(ctx));
      } catch (e) {
        throw bad((e as Error).message);
      }
    }),

  testSso: admin.mutation(async ({ ctx }) => testSsoConfig(orgOf(ctx).id)),

  disableSso: admin.mutation(({ ctx }) => {
    const org = orgOf(ctx);
    const c = secState().sso.get(org.id);
    if (!c) throw bad("SSO is not configured");
    c.enabled = false;
    c.updatedAt = new Date();
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "security.sso.disable", entity: "organization", entityId: org.id, details: `OIDC ${c.issuer} disabled` });
    return { ok: true };
  }),

  // ─── Custom roles ─────────────────────────────────────────────────────
  roles: admin.query(({ ctx }) => {
    const org = orgOf(ctx);
    const assignable = assignablePermissions(org);
    const members = getStore().users.filter((u) => u.orgId === org.id);
    const st = secState();
    return {
      permissions: assignable.map((p) => ({ id: p, ...PERMISSION_INFO[p] })),
      modules: WORKSPACE_MODULES.map(({ id, label, href }) => ({ id, label, href })),
      builtIn: rolesForOrg(org).map((r) => ({ id: r.role, name: r.label, description: r.description, admin: r.admin, permissions: builtInPermissions(r.role).filter((p) => assignable.includes(p)), modules: ALL_MODULE_IDS, members: members.filter((m) => m.role === r.role && !st.roleAssignments.has(m.id)).length })),
      custom: rolesOf(org.id).map((r) => ({ ...r, baseLabel: ROLE_LABELS[r.baseRole], members: members.filter((m) => st.roleAssignments.get(m.id) === r.id).map((m) => ({ id: m.id, name: m.name })) })),
    };
  }),

  createRole: admin.input(z.object({ name: z.string().max(40), description: z.string().max(200).optional(), cloneFrom: z.string().max(60), permissions: z.array(z.enum(PERMISSION_KEYS)).optional(), modules: z.array(z.string().max(40)).optional() })).mutation(({ ctx, input }) => {
    try {
      return createCustomRole(orgOf(ctx), input, actor(ctx));
    } catch (e) {
      throw bad((e as Error).message);
    }
  }),

  updateRole: admin.input(z.object({ id: z.string(), name: z.string().max(40).optional(), description: z.string().max(200).optional(), permissions: z.array(z.enum(PERMISSION_KEYS)).optional(), modules: z.array(z.string().max(40)).optional() })).mutation(({ ctx, input }) => {
    const { id, ...patch } = input;
    try {
      return updateCustomRole(orgOf(ctx), id, patch, actor(ctx));
    } catch (e) {
      throw bad((e as Error).message);
    }
  }),

  deleteRole: admin.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    try {
      return { reverted: deleteCustomRole(orgOf(ctx), input.id, actor(ctx)) };
    } catch (e) {
      throw bad((e as Error).message);
    }
  }),

  assignRole: admin.input(z.object({ userId: z.string(), roleId: z.string().nullable() })).mutation(({ ctx, input }) => {
    try {
      const u = assignCustomRole(orgOf(ctx), input.userId, input.roleId, actor(ctx));
      return { ok: true, userId: u.id };
    } catch (e) {
      throw bad((e as Error).message);
    }
  }),

  // ─── Audit export ─────────────────────────────────────────────────────
  auditExport: admin.input(z.object({ from: z.string().optional(), to: z.string().optional(), prefix: z.string().max(40).optional(), format: z.enum(["csv", "json"]).default("csv") })).mutation(({ ctx, input }) => {
    const org = orgOf(ctx);
    const ids = new Set(getStore().users.filter((u) => u.orgId === org.id).map((u) => u.id));
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(new Date(input.to).getTime() + 86_400_000 - 1) : null;
    const rows = getStore().audit.filter((a) => (ids.has(a.userId) || a.entityId === org.id) && (!from || a.at >= from) && (!to || a.at <= to) && (!input.prefix || a.action.startsWith(input.prefix)));
    const cols = ["id", "at", "userId", "userName", "action", "entity", "entityId", "details"] as const;
    const cell = (v: unknown) => {
      const s = v instanceof Date ? v.toISOString() : String(v ?? "");
      return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
    };
    const content = input.format === "json" ? JSON.stringify({ workspace: { id: org.id, name: org.name }, exportedAt: new Date().toISOString(), exportedBy: actor(ctx).name, rows }, null, 2) : [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
    const sha256 = createHash("sha256").update(content).digest("hex");
    audit({ userId: ctx.user.id, userName: actor(ctx).name, action: "security.audit.export", entity: "organization", entityId: org.id, details: `${rows.length} events · ${input.format.toUpperCase()} · sha256 ${sha256.slice(0, 12)}…` });
    return { filename: `agri-shield-audit-${org.shortName ?? org.id}-${new Date().toISOString().slice(0, 10)}.${input.format}`, content, sha256, rows: rows.length, format: input.format };
  }),

  /** Admin preview of the effective access a member has (for the role editor). */
  effectiveAccess: admin.input(z.object({ userId: z.string() })).query(({ ctx, input }) => {
    const org = orgOf(ctx);
    const u = getStore().users.find((x) => x.id === input.userId && x.orgId === org.id);
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
    return accessSummary({ id: u.id, role: u.role, orgId: u.orgId });
  }),
});
