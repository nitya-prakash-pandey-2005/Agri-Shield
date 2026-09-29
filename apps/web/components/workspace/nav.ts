import { Bell, Bot, Compass, FileText, HandHeart, Home, Landmark, Layers, Settings, ShieldCheck } from "lucide-react";
import type { NavItem } from "@/components/hud/DashboardShell";

/** Workspace navigation. Module owners may add badges but keep these routes stable. */
export const WORKSPACE_NAV: NavItem[] = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/app/explorer", label: "Risk Explorer", icon: Compass },
  { href: "/app/portfolio", label: "Portfolio", icon: Layers },
  { href: "/app/alerts", label: "Alerts & Rules", icon: Bell },
  { href: "/app/insurance", label: "Insurance", icon: ShieldCheck },
  { href: "/app/finance", label: "Lending & Finance", icon: Landmark },
  { href: "/app/anticipatory", label: "Anticipatory Action", icon: HandHeart },
  { href: "/app/reports", label: "Reports", icon: FileText },
  { href: "/app/copilot", label: "Copilot", icon: Bot },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

/** The module each industry cares about most is lifted to sit right after Portfolio. */
const PRIMARY_MODULE: Record<string, string | undefined> = {
  insurance: "/app/insurance",
  banking: "/app/finance",
  ngo: "/app/anticipatory",
  government: "/app/anticipatory",
  cooperative: "/app/alerts",
  agribusiness: "/app/alerts",
};

/**
 * Same routes as WORKSPACE_NAV, reordered for the workspace's industry and
 * decorated with badges (e.g. unread alert notifications). Home stays first,
 * Settings stays last.
 */
export function navForIndustry(industry: string | null | undefined, badges: Partial<Record<string, number>> = {}): NavItem[] {
  const items = WORKSPACE_NAV.map((n) => ({ ...n, badge: badges[n.href] || undefined }));
  const primary = industry ? PRIMARY_MODULE[industry] : undefined;
  if (!primary) return items;
  const idx = items.findIndex((n) => n.href === primary);
  const portfolioIdx = items.findIndex((n) => n.href === "/app/portfolio");
  if (idx < 0 || portfolioIdx < 0 || idx === portfolioIdx + 1) return items;
  const [item] = items.splice(idx, 1);
  items.splice(items.findIndex((n) => n.href === "/app/portfolio") + 1, 0, item!);
  return items;
}
