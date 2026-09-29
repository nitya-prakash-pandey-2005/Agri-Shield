/**
 * Workspace security score card — a transparent, weighted checklist (0–100).
 * Every item says what was measured and how to fix it.
 */
import { getStore } from "../data/store";
import { isAdminRole } from "../services/workspace-state";
import { secState, policyFor } from "./security-state";
import { activeSessionsForOrg } from "../services/sessions";

export interface ScoreItem {
  id: string;
  label: string;
  status: "good" | "warn" | "bad";
  detail: string;
  points: number;
  max: number;
  fix: string | null;
}

export function securityScore(orgId: string, now = new Date()) {
  const s = getStore();
  const st = secState();
  const policy = policyFor(orgId);
  const members = s.users.filter((u) => u.orgId === orgId && u.status !== "suspended");
  const enrolled = members.filter((u) => st.totp.has(u.id)).length;
  const coverage = members.length ? enrolled / members.length : 0;
  const sso = st.sso.get(orgId);
  const keys = s.apiKeys.filter((k) => k.orgId === orgId);
  const oldKeys = keys.filter((k) => now.getTime() - new Date(k.createdAt).getTime() > 90 * 86_400_000);
  const sessions = activeSessionsForOrg(orgId, now);
  const stale = sessions.filter((x) => now.getTime() - x.lastSeen.getTime() > 3 * 86_400_000);
  const admins = members.filter((u) => isAdminRole(u.role) || [...st.roles].some((r) => r.orgId === orgId && st.roleAssignments.get(u.id) === r.id && r.permissions.includes("manage_workspace")));
  const adminShare = members.length ? admins.length / members.length : 0;

  const item = (id: string, label: string, max: number, frac: number, detail: string, fix: string | null): ScoreItem => {
    const points = Math.round(max * Math.max(0, Math.min(1, frac)));
    return { id, label, max, points, detail, fix: points >= max ? null : fix, status: points >= max ? "good" : points >= max * 0.5 ? "warn" : "bad" };
  };

  const items: ScoreItem[] = [
    item("mfa_coverage", "2-step verification coverage", 30, coverage, `${enrolled} of ${members.length} members use an authenticator app (${Math.round(coverage * 100)}%)`, "Ask members to enrol, or require 2FA for everyone"),
    item("mfa_policy", "2FA required for all members", 10, policy.require2fa ? 1 : 0, policy.require2fa ? `Enforced at sign-in since ${policy.require2faSince?.toISOString().slice(0, 10) ?? "—"}` : "Members may sign in with a password only", "Turn on “Require 2-step verification”"),
    item("sso", "Single sign-on", 15, sso?.enabled ? 1 : sso ? 0.4 : 0, sso?.enabled ? `OIDC via ${new URL(sso.issuer).host} · ${sso.allowedDomains.join(", ")}` : sso ? "Configured but not enabled" : "Not configured — accounts are managed separately from your IdP", "Connect your identity provider (OIDC)"),
    item("ip", "Network restrictions", 10, policy.ipAllowlist.enabled ? 1 : 0, policy.ipAllowlist.enabled ? `${policy.ipAllowlist.entries.length} allowed range(s)` : "Workspace reachable from any network", "Add your office / VPN ranges to the IP allow-list"),
    item("keys", "API key hygiene", 15, keys.length ? 1 - oldKeys.length / keys.length : 1, keys.length ? `${keys.length} key(s), ${oldKeys.length} older than 90 days` : "No API keys issued", "Rotate keys older than 90 days"),
    item("sessions", "Session hygiene", 10, sessions.length ? 1 - stale.length / sessions.length : 1, `${sessions.length} active session(s), ${stale.length} idle for 3+ days`, "Revoke idle sessions below"),
    item("admins", "Least privilege", 10, adminShare <= 0.5 ? 1 : adminShare <= 0.75 ? 0.5 : 0, `${admins.length} of ${members.length} members have admin rights`, "Use a custom role with fewer permissions for non-admins"),
  ];
  const score = items.reduce((a, i) => a + i.points, 0);
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "E";
  return { score, grade, items, members: members.length, enrolled, computedAt: now };
}
