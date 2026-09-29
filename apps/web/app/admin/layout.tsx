"use client";

import type { ReactNode } from "react";
import {
  Building2,
  BrainCircuit,
  CreditCard,
  Cpu,
  LayoutDashboard,
  MessageSquareText,
  Radar,
  Satellite,
  ScrollText,
  Send,
  ToggleRight,
  Users,
} from "lucide-react";
import { DashboardShell, type NavItem } from "@/components/hud/DashboardShell";
import { ScenarioBadge } from "@/components/admin/ScenarioBadge";
import { trpc } from "@/lib/trpc";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const overview = trpc.admin.overview.useQuery(undefined, { refetchInterval: 30_000 });
  const nav: NavItem[] = [
    { href: "/admin", label: "Overview", icon: LayoutDashboard },
    { href: "/admin/users", label: "Users", icon: Users, badge: overview.data?.users.suspended || undefined },
    { href: "/admin/organizations", label: "Organizations", icon: Building2, badge: overview.data?.orgs.pending || undefined },
    { href: "/admin/models", label: "Models", icon: BrainCircuit },
    { href: "/admin/data-sources", label: "Data Sources", icon: Satellite },
    { href: "/admin/jobs", label: "Jobs", icon: Cpu },
    { href: "/admin/scenario", label: "Scenario Control", icon: Radar },
    { href: "/admin/audit", label: "Audit Logs", icon: ScrollText },
    { href: "/admin/billing", label: "Billing", icon: CreditCard, badge: overview.data?.billing.pastDue || undefined },
    { href: "/admin/flags", label: "Feature Flags", icon: ToggleRight },
    { href: "/admin/outbox", label: "Notification Outbox", icon: Send, badge: overview.data?.messaging.failed || undefined },
    { href: "/admin/sms", label: "SMS Simulator", icon: MessageSquareText },
  ];
  return (
    <DashboardShell product="Platform Admin · Mission Control" nav={nav} accent="violet" rooms={["global"]} topbarExtra={<ScenarioBadge />}>
      {children}
    </DashboardShell>
  );
}
