"use client";

/**
 * Workspace (multi-tenant SaaS) shell — every organisation user lands here.
 * Modules: Explorer, Portfolio, Alerts & Rules, Insurance, Finance,
 * Anticipatory Action, Reports, Copilot, Settings.
 */
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { DashboardShell } from "@/components/hud/DashboardShell";
import { WORKSPACE_NAV } from "@/components/workspace/nav";


export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const orgId = session?.user?.orgId ?? "none";
  return (
    <DashboardShell product="Workspace" nav={WORKSPACE_NAV} accent="cyan" rooms={["global", `ws:${orgId}`]}>
      {children}
    </DashboardShell>
  );
}
