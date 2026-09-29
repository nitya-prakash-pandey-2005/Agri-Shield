"use client";

import { useSession } from "next-auth/react";
import { FlaskConical, Network, PackageSearch, Plug, Wheat } from "lucide-react";
import type { ReactNode } from "react";
import { DashboardShell, type NavItem } from "@/components/hud/DashboardShell";
import { trpc } from "@/lib/trpc";

const NAV: NavItem[] = [
  { href: "/dashboard/supply-chain", label: "Risk Overview", icon: Network },
  { href: "/dashboard/supply-chain/commodities", label: "Commodities", icon: Wheat },
  { href: "/dashboard/supply-chain/scenarios", label: "Scenarios", icon: FlaskConical },
  { href: "/dashboard/supply-chain/procurement", label: "Procurement", icon: PackageSearch },
  { href: "/dashboard/supply-chain/integrations", label: "Integrations", icon: Plug },
];

export default function SupplyChainLayout({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const orgId = session?.user?.orgId;
  const overview = trpc.supplyChain.getOverview.useQuery(undefined, { staleTime: 60_000, refetchInterval: 5 * 60_000 });
  const nav = NAV.map((n) => (n.label === "Risk Overview" && overview.data ? { ...n, badge: overview.data.kpis.nodesAtRisk } : n));
  return (
    <DashboardShell product="Supply Chain Intelligence" nav={nav} accent="amber" rooms={["global", ...(orgId ? [`sc:${orgId}`] : [])]}>
      {/* navy + amber atmosphere over the shared HUD grid */}
      <div className="relative">
        <div aria-hidden className="pointer-events-none absolute -inset-4 -z-0 rounded-3xl md:-inset-8" style={{ background: "radial-gradient(900px 520px at 90% 0%, rgba(245,158,11,0.08), transparent 60%), radial-gradient(1100px 700px at 10% 100%, rgba(30,58,95,0.4), transparent 65%)" }} />
        <div className="relative z-[1]">{children}</div>
      </div>
    </DashboardShell>
  );
}
