/**
 * Server-side security state: TOTP enrolments, the session registry and its
 * denylist, pending 2-step challenges, SSO configurations and one-time
 * assertions, per-workspace security policy (require 2FA, IP allow-list) and
 * custom roles.
 *
 * Like the rest of the demo system of record (server/data/store.ts) it lives on
 * globalThis so Next.js hot reloads keep it; production swaps this module for a
 * Postgres/Redis-backed implementation with the same shape. Secrets are never
 * kept in clear: TOTP seeds and OIDC client secrets are AES-256-GCM sealed,
 * recovery codes are stored as keyed hashes.
 */
import type { UserRole } from "@agri-shield/types";
import type { Permission } from "@/lib/rbac";

export interface RecoveryCode {
  hash: string;
  usedAt: Date | null;
}

export interface TotpEnrolment {
  userId: string;
  secretSealed: string;
  createdAt: Date;
  /** Highest 30-second time-step already accepted — replay protection */
  lastUsedStep: number;
  lastUsedAt: Date | null;
  recovery: RecoveryCode[];
}

export type SignInMethod = "password" | "otp" | "password+totp" | "password+recovery" | "otp+totp" | "otp+recovery" | "sso" | "restored";

export interface SessionRecord {
  id: string;
  userId: string;
  orgId: string | null;
  createdAt: Date;
  lastSeen: Date;
  expiresAt: Date;
  ip: string;
  userAgent: string;
  method: SignInMethod;
  /** Authentication method references (RFC 8176): pwd, otp, mfa, sso… */
  amr: string[];
  revokedAt: Date | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export interface Challenge {
  id: string;
  userId: string;
  purpose: "verify" | "enrol";
  /** First factor used ("password" | "otp") */
  firstFactor: "password" | "otp";
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  state: "pending" | "satisfied" | "consumed";
  /** How the second factor was satisfied (for the session record) */
  satisfiedWith: "totp" | "recovery" | null;
  /** Sealed secret generated for an enrolment challenge */
  pendingSecretSealed: string | null;
  ip: string;
  userAgent: string;
}

export interface SsoConfig {
  orgId: string;
  enabled: boolean;
  protocol: "oidc";
  issuer: string;
  clientId: string;
  clientSecretSealed: string | null;
  allowedDomains: string[];
  defaultRole: UserRole;
  jitProvisioning: boolean;
  /** When on, password sign-in is refused for users on the allowed domains */
  enforceForDomains: boolean;
  updatedAt: Date;
  updatedBy: string;
  lastLoginAt: Date | null;
  lastError: string | null;
  logins: number;
}

export interface SsoAssertion {
  id: string;
  userId: string;
  orgId: string;
  expiresAt: Date;
  consumed: boolean;
  ip: string;
  userAgent: string;
}

export interface IpRule {
  cidr: string;
  label: string;
}

export interface OrgSecurityPolicy {
  require2fa: boolean;
  require2faSince: Date | null;
  ipAllowlist: { enabled: boolean; entries: IpRule[] };
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface CustomRole {
  id: string;
  orgId: string;
  name: string;
  description: string;
  /** Built-in role this was cloned from — used for routing & labels */
  baseRole: UserRole;
  permissions: Permission[];
  /** Workspace modules (capabilities) members with this role can use */
  modules: string[];
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
}

export interface SecurityState {
  totp: Map<string, TotpEnrolment>;
  sessions: Map<string, SessionRecord>;
  /** userId → epoch ms; sessions authenticated before this (except keepSid) are rejected */
  notBefore: Map<string, { at: number; keepSid: string | null }>;
  challenges: Map<string, Challenge>;
  sso: Map<string, SsoConfig>;
  assertions: Map<string, SsoAssertion>;
  policies: Map<string, OrgSecurityPolicy>;
  roles: CustomRole[];
  roleAssignments: Map<string, string>;
  /** failed second-factor attempts per user (rolling) for lockout */
  failures: Map<string, number[]>;
}

const g = globalThis as unknown as { __agriSecurity?: SecurityState };

export function secState(): SecurityState {
  return (g.__agriSecurity ??= {
    totp: new Map(),
    sessions: new Map(),
    notBefore: new Map(),
    challenges: new Map(),
    sso: new Map(),
    assertions: new Map(),
    policies: new Map(),
    roles: [],
    roleAssignments: new Map(),
    failures: new Map(),
  });
}

/** Test helper */
export function __resetSecurityState() {
  g.__agriSecurity = undefined;
}

export function policyFor(orgId: string | null | undefined): OrgSecurityPolicy {
  const empty: OrgSecurityPolicy = { require2fa: false, require2faSince: null, ipAllowlist: { enabled: false, entries: [] }, updatedAt: null, updatedBy: null };
  if (!orgId) return empty;
  const st = secState();
  let p = st.policies.get(orgId);
  if (!p) st.policies.set(orgId, (p = empty));
  return p;
}
