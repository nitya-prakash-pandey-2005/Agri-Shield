"use client";

import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { BarChart3, Bell, LayoutDashboard, Landmark, Truck } from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/hud/DashboardShell";
import { trpc } from "@/lib/trpc";
import { CountrySelector, LiveDataBadge, RealtimeSync } from "@/components/government/GovChrome";
import { useGovInput } from "@/components/government/scope";

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
      {children}
    </DashboardShell>
  );
}
