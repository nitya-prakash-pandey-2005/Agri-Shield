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
