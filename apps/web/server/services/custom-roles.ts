/**
 * Custom roles — per-workspace permission sets cloned from a built-in role.
 *
 * A custom role = base role (routing, labels) + a subset of the permissions in
 * lib/rbac.ts that the workspace's own built-in roles hold (a role can never
 * grant more than the workspace's admin role) + the workspace modules
 * ("capabilities") its members may use.
 *
 * Enforcement is live and backward-compatible: `permitted(perm)` in
 * server/trpc.ts calls `resolvePermission`, which falls back to the built-in
 * RBAC table when no custom role is assigned, and additionally blocks module
 * routers (explorer, insurance, finance…) the custom role does not include.
 */
import type { UserRole } from "@agri-shield/types";
import { PERMISSIONS, ROLE_LABELS, can, type Permission } from "@/lib/rbac";
import { audit, getStore, type OrgRecord, type UserRecord } from "../data/store";
import { rolesForOrg } from "./workspace-state";
import { randomId } from "../auth/crypto";
import { secState, type CustomRole } from "../auth/security-state";

export const PERMISSION_INFO: Record<Permission, { label: string; description: string; locked?: boolean; never?: boolean }> = {
  use_workspace: { label: "Use the workspace", description: "Sign in to /app and read workspace data. Required for every workspace role.", locked: true },
  manage_workspace: { label: "Administer workspace", description: "Team & invites, billing, API keys, webhooks, security settings, exports." },
  manage_assets: { label: "Manage assets", description: "Add, edit, import and delete portfolio assets and alert rules." },
  manage_integrations: { label: "Manage integrations", description: "Supply-chain API keys, webhooks and data connectors." },
  view_supply_chain: { label: "Supply-chain intelligence", description: "Facilities, commodity risk and scenario tools." },
  view_gov_dashboard: { label: "Government dashboard", description: "District command centre and official alerts." },
  create_alert: { label: "Issue official alerts", description: "Broadcast alerts to farmers by SMS / app." },
  request_resources: { label: "Request resources", description: "Raise resource requests (pumps, seed, feed)." },
  approve_resources: { label: "Approve resources", description: "Approve or reject resource requests." },
  view_farm_data: { label: "Farm-level data", description: "Individual farmer and field records." },
  access_admin_panel: { label: "Platform admin", description: "Agri-SHIELD staff only — never assignable.", never: true },
};

export interface WorkspaceModule {
  id: string;
  label: string;
  href: string;
  /** Top-level tRPC routers that belong to the module */
  routers: string[];
}

/** Modules whose API is enforced per role (their tRPC routers are gated). */
export const WORKSPACE_MODULES: WorkspaceModule[] = [
  { id: "explorer", label: "Risk Explorer", href: "/app/explorer", routers: ["explorer"] },
  { id: "portfolio", label: "Portfolio, alerts & rules", href: "/app/portfolio", routers: ["portfolio"] },
  { id: "twin", label: "Earth Twin", href: "/app/twin", routers: ["twin"] },
  { id: "sensors", label: "Sensors & IoT", href: "/app/sensors", routers: ["sensors"] },
  { id: "imagery", label: "Satellite Lab", href: "/app/imagery", routers: ["imagery"] },
  { id: "incidents", label: "Incidents", href: "/app/incidents", routers: ["incidents"] },
  { id: "simulate", label: "Simulation Lab", href: "/app/simulate", routers: ["simulate"] },
  { id: "insurance", label: "Insurance", href: "/app/insurance", routers: ["insurance"] },
  { id: "finance", label: "Lending & Finance", href: "/app/finance", routers: ["finance"] },
  { id: "sustainability", label: "Sustainability & Carbon", href: "/app/sustainability", routers: ["sustainability"] },
  { id: "dashboards", label: "Dashboards", href: "/app/dashboards", routers: ["dashboards"] },
  { id: "copilot", label: "Copilot", href: "/app/copilot", routers: ["copilot"] },
  { id: "developers", label: "Developers (API explorer, usage)", href: "/app/developers", routers: ["developer"] },
];

export const ALL_MODULE_IDS = WORKSPACE_MODULES.map((m) => m.id);

/** tRPC paths that stay reachable whatever the module set (own security settings). */
const ALWAYS_ALLOWED_PREFIXES = ["developer.security."];

export function moduleForPath(path: string | undefined | null): string | null {
  if (!path || ALWAYS_ALLOWED_PREFIXES.some((p) => path.startsWith(p))) return null;
  const top = path.split(".")[0]!;
  return WORKSPACE_MODULES.find((m) => m.routers.includes(top))?.id ?? null;
}

/** Permissions a custom role in this workspace may hold: the union of its built-in roles' permissions. */
export function assignablePermissions(org: Pick<OrgRecord, "type">): Permission[] {
  const roles = rolesForOrg(org).map((r) => r.role);
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => !PERMISSION_INFO[p].never && roles.some((r) => can(r, p)));
}

export function builtInPermissions(role: UserRole): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}

export function rolesOf(orgId: string): CustomRole[] {
  return secState().roles.filter((r) => r.orgId === orgId);
}

export function customRoleOf(userId: string, orgId: string | null): CustomRole | null {
  if (!orgId) return null;
  const id = secState().roleAssignments.get(userId);
  if (!id) return null;
  return secState().roles.find((r) => r.id === id && r.orgId === orgId) ?? null;
}

function sanitize(org: OrgRecord, perms: Permission[], modules: string[]): { permissions: Permission[]; modules: string[] } {
  const allowed = new Set(assignablePermissions(org));
  const permissions = [...new Set<Permission>(["use_workspace", ...perms.filter((p) => allowed.has(p))])];
  const mods = [...new Set(modules.filter((m) => ALL_MODULE_IDS.includes(m)))];
  return { permissions, modules: mods };
}

export function createCustomRole(org: OrgRecord, input: { name: string; description?: string; cloneFrom: string; permissions?: Permission[]; modules?: string[] }, by: { id: string; name: string }): CustomRole {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 40) throw new Error("Role name must be 2–40 characters");
  if (rolesOf(org.id).some((r) => r.name.toLowerCase() === name.toLowerCase()) || rolesForOrg(org).some((r) => r.label.toLowerCase() === name.toLowerCase())) throw new Error("A role with that name already exists");
  if (rolesOf(org.id).length >= 20) throw new Error("A workspace can have at most 20 custom roles");
  const source = rolesOf(org.id).find((r) => r.id === input.cloneFrom);
  const builtIn = rolesForOrg(org).find((r) => r.role === input.cloneFrom);
  if (!source && !builtIn) throw new Error("Choose a role to clone");
  const baseRole = source?.baseRole ?? builtIn!.role;
  const basePerms = source?.permissions ?? builtInPermissions(baseRole);
  const baseModules = source?.modules ?? ALL_MODULE_IDS;
  const { permissions, modules } = sanitize(org, input.permissions ?? basePerms, input.modules ?? baseModules);
  const now = new Date();
  const role: CustomRole = { id: randomId("role", 8), orgId: org.id, name, description: (input.description ?? "").trim().slice(0, 200), baseRole, permissions, modules, createdAt: now, createdBy: by.id, updatedAt: now };
  secState().roles.push(role);
  audit({ userId: by.id, userName: by.name, action: "security.role.create", entity: "role", entityId: role.id, details: `${name} (cloned from ${source?.name ?? ROLE_LABELS[baseRole]}) · ${permissions.length} permissions · ${modules.length} modules` });
  return role;
}

export function updateCustomRole(org: OrgRecord, id: string, patch: { name?: string; description?: string; permissions?: Permission[]; modules?: string[] }, by: { id: string; name: string }): CustomRole {
  const role = rolesOf(org.id).find((r) => r.id === id);
  if (!role) throw new Error("Role not found");
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (n.length < 2 || n.length > 40) throw new Error("Role name must be 2–40 characters");
    if (rolesOf(org.id).some((r) => r.id !== id && r.name.toLowerCase() === n.toLowerCase())) throw new Error("A role with that name already exists");
    role.name = n;
  }
  if (patch.description !== undefined) role.description = patch.description.trim().slice(0, 200);
  const s = sanitize(org, patch.permissions ?? role.permissions, patch.modules ?? role.modules);
  const before = `${role.permissions.join(",")}|${role.modules.join(",")}`;
  role.permissions = s.permissions;
  role.modules = s.modules;
  role.updatedAt = new Date();
  if (before !== `${role.permissions.join(",")}|${role.modules.join(",")}` || patch.name || patch.description) {
    audit({ userId: by.id, userName: by.name, action: "security.role.update", entity: "role", entityId: role.id, details: `${role.name}: ${role.permissions.join(", ")} · modules ${role.modules.length}/${ALL_MODULE_IDS.length}` });
  }
  return role;
}

export function deleteCustomRole(org: OrgRecord, id: string, by: { id: string; name: string }): number {
  const st = secState();
  const role = rolesOf(org.id).find((r) => r.id === id);
  if (!role) throw new Error("Role not found");
  let n = 0;
  for (const [uid, rid] of st.roleAssignments) if (rid === id) {
    st.roleAssignments.delete(uid);
    n++;
  }
  st.roles = st.roles.filter((r) => r.id !== id);
  audit({ userId: by.id, userName: by.name, action: "security.role.delete", entity: "role", entityId: id, details: `${role.name} deleted · ${n} member(s) reverted to ${ROLE_LABELS[role.baseRole]}` });
  return n;
}

/** Assign a custom role (or null to go back to the built-in role). */
export function assignCustomRole(org: OrgRecord, userId: string, roleId: string | null, by: { id: string; name: string }): UserRecord {
  const user = getStore().users.find((u) => u.id === userId && u.orgId === org.id);
  if (!user) throw new Error("Member not found");
  const st = secState();
  if (roleId === null) {
    st.roleAssignments.delete(userId);
    audit({ userId: by.id, userName: by.name, action: "security.role.unassign", entity: "user", entityId: userId, details: `${user.name} → built-in ${ROLE_LABELS[user.role]}` });
    return user;
  }
  const role = rolesOf(org.id).find((r) => r.id === roleId);
  if (!role) throw new Error("Role not found");
  if (userId === by.id && !role.permissions.includes("manage_workspace")) throw new Error("You can't assign yourself a role without admin rights — ask another admin");
  user.role = role.baseRole;
  st.roleAssignments.set(userId, role.id);
  audit({ userId: by.id, userName: by.name, action: "security.role.assign", entity: "user", entityId: userId, details: `${user.name} → ${role.name}` });
  return user;
}

export interface Principal {
  id: string;
  role: UserRole;
  orgId: string | null;
}

/**
 * Live permission check used by tRPC `permitted()`. The store's current role
 * wins over the (possibly stale) role in the session token.
 */
export function resolvePermission(principal: Principal, permission: Permission, path?: string | null): boolean {
  const fresh = getStore().users.find((u) => u.id === principal.id);
  const role = fresh?.role ?? principal.role;
  const orgId = fresh?.orgId ?? principal.orgId;
  if (role === "platform_admin") return can(role, permission);
  const custom = customRoleOf(principal.id, orgId);
  if (!custom) return can(role, permission);
  if (!custom.permissions.includes(permission)) return false;
  const mod = moduleForPath(path);
  if (mod && !custom.modules.includes(mod)) return false;
  return true;
}

export function accessSummary(principal: Principal): { role: UserRole; customRole: { id: string; name: string } | null; permissions: Permission[]; modules: string[] } {
  const fresh = getStore().users.find((u) => u.id === principal.id);
  const role = fresh?.role ?? principal.role;
  const custom = customRoleOf(principal.id, fresh?.orgId ?? principal.orgId);
  return custom ? { role, customRole: { id: custom.id, name: custom.name }, permissions: custom.permissions, modules: custom.modules } : { role, customRole: null, permissions: builtInPermissions(role), modules: ALL_MODULE_IDS };
}

/** Human-readable reason for a FORBIDDEN answer. */
export function denialMessage(principal: Principal, permission: Permission, path?: string | null): string {
  const fresh = getStore().users.find((u) => u.id === principal.id);
  const custom = customRoleOf(principal.id, fresh?.orgId ?? principal.orgId);
  if (custom && custom.permissions.includes(permission)) {
    const mod = WORKSPACE_MODULES.find((m) => m.id === moduleForPath(path));
    return `Your role "${custom.name}" doesn't include ${mod?.label ?? "this module"}. Ask a workspace admin.`;
  }
  if (custom) return `Your role "${custom.name}" doesn't include "${PERMISSION_INFO[permission].label}".`;
  return `Missing permission: ${permission}`;
}
