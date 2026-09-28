/**
 * Role-based access control (spec §11). Shared by middleware, tRPC and UI.
 */
import type { UserRole } from "@agri-shield/types";

export const GOV_ROLES: UserRole[] = ["field_officer", "regional_admin", "national_admin"];
export const SC_ROLES: UserRole[] = ["supply_chain_analyst", "supply_chain_admin"];

export const PERMISSIONS = {
  view_farm_data: ["farmer", ...GOV_ROLES, "platform_admin"],
  view_gov_dashboard: [...GOV_ROLES, "platform_admin"],
  create_alert: [...GOV_ROLES, "platform_admin"],
  request_resources: [...GOV_ROLES, "platform_admin"],
  approve_resources: ["regional_admin", "national_admin", "platform_admin"],
  view_supply_chain: [...SC_ROLES, "platform_admin"],
  manage_integrations: ["supply_chain_admin", "platform_admin"],
  access_admin_panel: ["platform_admin"],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole | undefined | null, permission: Permission): boolean {
  return !!role && (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

/** Where a user lands after sign-in. */
export function homeForRole(role: UserRole | undefined | null): string {
  if (!role) return "/auth/signin";
  if (role === "farmer") return "/dashboard/farmer";
  if (GOV_ROLES.includes(role)) return "/dashboard/government";
  if (SC_ROLES.includes(role)) return "/dashboard/supply-chain";
  return "/admin";
}

/** Route prefix → permission required. Order matters (first match wins). */
export const PROTECTED_ROUTES: { prefix: string; permission: Permission | null }[] = [
  { prefix: "/admin", permission: "access_admin_panel" },
  { prefix: "/dashboard/government", permission: "view_gov_dashboard" },
  { prefix: "/dashboard/supply-chain", permission: "view_supply_chain" },
  { prefix: "/dashboard/farmer", permission: "view_farm_data" },
  { prefix: "/onboarding", permission: null },
];

export const ROLE_LABELS: Record<UserRole, string> = {
  farmer: "Farmer",
  field_officer: "Field Officer",
  regional_admin: "Regional Admin",
  national_admin: "National Admin",
  supply_chain_analyst: "Supply Chain Analyst",
  supply_chain_admin: "Supply Chain Admin",
  platform_admin: "Platform Admin",
};
