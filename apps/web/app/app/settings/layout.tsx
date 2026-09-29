"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { CreditCard, KeyRound, ScrollText, Settings2, ShieldCheck, Users } from "lucide-react";
import { SectionHeader } from "@/components/hud";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/app/settings", label: "General", icon: Settings2 },
  { href: "/app/settings/team", label: "Team", icon: Users },
  { href: "/app/settings/billing", label: "Plan & billing", icon: CreditCard },
  { href: "/app/settings/api", label: "API & integrations", icon: KeyRound },
  { href: "/app/settings/security", label: "Security", icon: ShieldCheck },
  { href: "/app/settings/audit", label: "Audit log", icon: ScrollText },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div>
      <SectionHeader eyebrow="Workspace" title="Settings" description="Your organisation's profile, team, plan, integrations and security — changes apply to everyone in the workspace." />
      <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-white/5 px-1 pb-px" aria-label="Settings sections">
        {TABS.map((t) => {
          const active = t.href === "/app/settings" ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className={cn("relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm transition-colors", active ? "text-white" : "text-slate-400 hover:text-slate-200")}>
              <t.icon size={14} className={active ? "text-cyan-300" : ""} />
              {t.label}
              {active && <motion.span layoutId="settings-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cyan-400" />}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
