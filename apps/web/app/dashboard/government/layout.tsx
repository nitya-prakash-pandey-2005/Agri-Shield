"use client";

import { Suspense, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { BarChart3, Bell, LayoutDashboard, Landmark, ShieldCheck, Truck, X } from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/hud/DashboardShell";
import { trpc } from "@/lib/trpc";
import { CountrySelector, LiveDataBadge, RealtimeSync } from "@/components/government/GovChrome";
import { useGovInput } from "@/components/government/scope";

/** Shown after a new organisation signs up (?verification=pending) until an admin verifies it. */
function VerificationBanner() {
  const params = useSearchParams();
  const [hidden, setHidden] = useState(false);
  if (hidden || params.get("verification") !== "pending") return null;
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <ShieldCheck size={18} className="mt-0.5 shrink-0 text-amber-400" />
      <div className="flex-1">
        <div className="font-medium text-amber-100">Organisation verification pending</div>
        <div className="text-amber-200/80 text-xs mt-0.5">
          You have full trial access. A platform administrator will verify your agency within one business day; alert broadcasting to
          registered farmers unlocks once verified.
        </div>
      </div>
      <button onClick={() => setHidden(true)} aria-label="Dismiss" className="text-amber-300/70 hover:text-amber-100">
        <X size={16} />
      </button>
    </div>
  );
}

export default function GovernmentLayout({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const input = useGovInput();
  const ctx = trpc.government.getContext.useQuery(input, { enabled: !!session?.user, refetchInterval: 60_000 });
  const orgId = ctx.data?.orgId ?? session?.user?.orgId ?? "org-gov-bd";
  const rooms = [`gov:${orgId}`];

  const nav: NavItem[] = [
    { href: "/dashboard/government", label: "Overview", icon: LayoutDashboard },
    { href: "/dashboard/government/resources", label: "Resources", icon: Truck, badge: ctx.data?.badges.pendingRequests },
    { href: "/dashboard/government/alerts", label: "Early Warnings", icon: Bell, badge: ctx.data?.badges.activeAlerts },
    { href: "/dashboard/government/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/dashboard/government/policy", label: "Policy", icon: Landmark },
  ];

  return (
    <DashboardShell
      product={ctx.data ? `Gov Ops · ${ctx.data.orgName}` : "Government Operations"}
      nav={nav}
      accent="emerald"
      rooms={rooms}
      topbarExtra={
        <>
          <CountrySelector />
          <LiveDataBadge />
        </>
      }
    >
      <RealtimeSync rooms={rooms} />
      <Suspense fallback={null}>
        <VerificationBanner />
      </Suspense>
      {children}
    </DashboardShell>
  );
}
