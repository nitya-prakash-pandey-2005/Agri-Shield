import { describe, expect, it } from "vitest";
import type { UserRole } from "@agri-shield/types";
import { PERMISSIONS, PROTECTED_ROUTES, can, homeForRole, type Permission } from "@/lib/rbac";

const ROLES: UserRole[] = ["farmer", "field_officer", "regional_admin", "national_admin", "supply_chain_analyst", "supply_chain_admin", "platform_admin"];

// Expected matrix from spec §11 (+ portal-specific permissions)
const MATRIX: Record<Permission, UserRole[]> = {
  view_farm_data: ["farmer", "field_officer", "regional_admin", "national_admin", "platform_admin"],
  view_gov_dashboard: ["field_officer", "regional_admin", "national_admin", "platform_admin"],
  create_alert: ["field_officer", "regional_admin", "national_admin", "platform_admin"],
  request_resources: ["field_officer", "regional_admin", "national_admin", "platform_admin"],
  approve_resources: ["regional_admin", "national_admin", "platform_admin"],
  view_supply_chain: ["supply_chain_analyst", "supply_chain_admin", "platform_admin"],
  manage_integrations: ["supply_chain_admin", "platform_admin"],
  access_admin_panel: ["platform_admin"],
};

describe("RBAC permissions matrix", () => {
  for (const [perm, allowed] of Object.entries(MATRIX) as [Permission, UserRole[]][]) {
    it(`${perm}`, () => {
      for (const role of ROLES) expect(can(role, perm), `${role} → ${perm}`).toBe(allowed.includes(role));
    });
  }

  it("covers every declared permission", () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  it("denies missing roles", () => {
    expect(can(undefined, "view_farm_data")).toBe(false);
    expect(can(null, "access_admin_panel")).toBe(false);
  });

  it("platform_admin holds every permission; farmers never see admin or supply chain", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) expect(can("platform_admin", p)).toBe(true);
    expect(can("farmer", "access_admin_panel")).toBe(false);
    expect(can("farmer", "view_supply_chain")).toBe(false);
    expect(can("farmer", "create_alert")).toBe(false);
  });

  it("routes each role to its home portal", () => {
    expect(homeForRole("farmer")).toBe("/dashboard/farmer");
    expect(homeForRole("field_officer")).toBe("/dashboard/government");
    expect(homeForRole("supply_chain_analyst")).toBe("/dashboard/supply-chain");
    expect(homeForRole("platform_admin")).toBe("/admin");
    expect(homeForRole(undefined)).toBe("/auth/signin");
  });

  it("protects /admin with access_admin_panel", () => {
    expect(PROTECTED_ROUTES.find((r) => "/admin/users".startsWith(r.prefix))?.permission).toBe("access_admin_panel");
    for (const role of ROLES) {
      const home = homeForRole(role);
      const rule = PROTECTED_ROUTES.find((r) => home.startsWith(r.prefix));
      if (rule?.permission) expect(can(role, rule.permission), `${role} can open own home ${home}`).toBe(true);
    }
  });
});
