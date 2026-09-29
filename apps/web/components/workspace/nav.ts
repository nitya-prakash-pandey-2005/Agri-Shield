import {
  Activity, Bell, Bot, Code2, Compass, FileText, FlaskConical, Globe2, HandHeart, Home, Landmark, LayoutDashboard, Layers, Leaf, Radio, Satellite, Settings, ShieldCheck, Siren, Wheat,
} from "lucide-react";
import type { NavItem } from "@/components/hud/DashboardShell";

/** Workspace navigation. Module owners may add badges but keep these routes stable. */
export const WORKSPACE_NAV: NavItem[] = [
  { href: "/app", label: "Home", icon: Home, section: "Monitor" },
  { href: "/app/twin", label: "Earth Twin", icon: Globe2, section: "Monitor" },
  { href: "/app/explorer", label: "Risk Explorer", icon: Compass, section: "Monitor" },
  { href: "/app/portfolio", label: "Portfolio", icon: Layers, section: "Monitor" },
  { href: "/app/sensors", label: "Sensors & IoT", icon: Radio, section: "Monitor" },
  { href: "/app/imagery", label: "Satellite Lab", icon: Satellite, section: "Monitor" },
  { href: "/app/alerts", label: "Alerts & Rules", icon: Bell, section: "Respond" },
  { href: "/app/incidents", label: "Incidents", icon: Siren, section: "Respond" },
  { href: "/app/simulate", label: "Simulation Lab", icon: FlaskConical, section: "Respond" },
  { href: "/app/anticipatory", label: "Anticipatory Action", icon: HandHeart, section: "Respond" },
  { href: "/app/insurance", label: "Insurance", icon: ShieldCheck, section: "Industry" },
  { href: "/app/finance", label: "Lending & Finance", icon: Landmark, section: "Industry" },
  { href: "/app/yield", label: "Yield Forecast", icon: Wheat, section: "Industry" },
  { href: "/app/sustainability", label: "Sustainability & Carbon", icon: Leaf, section: "Industry" },
  { href: "/app/dashboards", label: "Dashboards", icon: LayoutDashboard, section: "Insights" },
  { href: "/app/reports", label: "Reports", icon: FileText, section: "Insights" },
  { href: "/app/copilot", label: "Copilot", icon: Bot, section: "Insights" },
  { href: "/app/activity", label: "Activity", icon: Activity, section: "Insights" },
  { href: "/app/developers", label: "Developers", icon: Code2, section: "Workspace" },
  { href: "/app/settings", label: "Settings", icon: Settings, section: "Workspace" },
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
  const item = items.find((n) => n.href === primary);
  if (!item) return items;
  // Lift the industry's key module to the top of its own section, and move that
  // whole section up to follow "Monitor" — sections stay contiguous.
  const sections: string[] = [];
  for (const n of items) if (n.section && !sections.includes(n.section)) sections.push(n.section);
  const bySection = new Map(sections.map((sec) => [sec, items.filter((n) => n.section === sec)]));
  const own = bySection.get(item.section ?? "")!;
  own.splice(own.indexOf(item), 1);
  own.unshift(item);
  const order = [...sections];
  const from = order.indexOf(item.section ?? "");
  if (from > 1) {
    order.splice(from, 1);
    order.splice(1, 0, item.section!);
  }
  return order.flatMap((sec) => bySection.get(sec)!);
}
