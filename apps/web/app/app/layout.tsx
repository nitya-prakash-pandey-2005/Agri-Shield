"use client";

/**
 * Workspace (multi-tenant SaaS) shell — every organisation user lands here.
 * Modules: Explorer, Portfolio, Alerts & Rules, Insurance, Finance,
 * Anticipatory Action, Reports, Copilot, Settings.
 *
 * Platform layer adds: industry-ordered nav with badges, workspace badge,
 * trial countdown, notifications bell, help menu, product tour and
 * account-state banners (trial ended, deletion scheduled).
 */
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AlertTriangle } from "lucide-react";
import { DashboardShell } from "@/components/hud/DashboardShell";
import { navForIndustry } from "@/components/workspace/nav";
import { HelpMenu, TrialChip, WorkspaceBadge } from "@/components/workspace/WorkspaceTopbar";
import { ProductTour } from "@/components/workspace/ProductTour";
// Copilot (floating launcher, Ctrl+J) — owned by the Copilot module
import { CopilotLauncher } from "@/components/copilot/CopilotLauncher";
import { trpc } from "@/lib/trpc";

function Banners() {
  const me = trpc.workspace.me.useQuery(undefined, { staleTime: 60_000 });
  const d = me.data;
  if (!d) return null;
  if (d.deletion)
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
        <AlertTriangle size={15} /> This workspace is scheduled for deletion on {new Date(d.deletion.scheduledFor).toISOString().slice(0, 10)}.
        <Link href="/app/settings/security" className="ml-auto font-medium underline">
          Review or cancel
        </Link>
      </div>
    );
  if (d.trial?.expired)
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
        <AlertTriangle size={15} /> Your Business trial has ended — the workspace now runs on Free plan limits.
        <Link href="/app/settings/billing" className="ml-auto font-medium underline">
          Choose a plan
        </Link>
      </div>
    );
  return null;
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const orgId = session?.user?.orgId ?? "none";
  const signedIn = !!session?.user;
  const me = trpc.workspace.me.useQuery(undefined, { staleTime: 60_000, enabled: signedIn });
  const badges = trpc.workspace.navBadges.useQuery(undefined, { refetchInterval: 60_000, enabled: signedIn });
  const nav = navForIndustry(me.data?.org?.industry, { "/app/alerts": badges.data?.alerts ?? 0, "/app/reports": badges.data?.reports ?? 0 });
  return (
    <DashboardShell
      product="Workspace"
      nav={nav}
      accent="cyan"
      rooms={["global", `ws:${orgId}`]}
      topbarExtra={
        signedIn ? (
          <>
            <WorkspaceBadge />
            <TrialChip />
            <HelpMenu />
          </>
        ) : null
      }
    >
      {signedIn && <Banners />}
      {children}
      {signedIn && (
        <Suspense>
          <ProductTour />
        </Suspense>
      )}
      {/* Copilot launcher — Copilot module */}
      {signedIn && <CopilotLauncher />}
    </DashboardShell>
  );
}
