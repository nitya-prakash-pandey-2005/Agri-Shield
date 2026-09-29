"use client";

/**
 * ⌘K command palette: navigate anywhere, jump to any monitored district on the
 * live map, sign in as a demo role, switch appearance (theme / accent / motion).
 * Loaded lazily by CommandPaletteHost.
 */
import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter, usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Building2,
  CreditCard,
  FileCode2,
  Home,
  KeyRound,
  Link2,
  LogIn,
  LogOut,
  Map as MapIcon,
  MapPin,
  Monitor,
  Palette,
  SlidersHorizontal,
  Sunrise,
  Zap,
  Presentation,
  Search,
  ShieldCheck,
  Sprout,
  Truck,
  UserPlus,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { riskColor } from "@/components/hud";
import { ACCENTS, ACCENT_IDS, THEMES, THEME_IDS, modeLabel, type ThemeMode } from "@/components/theme/logic";
import { THEME_ICONS } from "@/components/theme/ThemeToggle";
import { openAppearancePanel, useAppearance } from "@/components/theme/useAppearance";

import { FOCUS_DISTRICT_EVENT } from "./events";

const PAGES: { label: string; href: string; icon: LucideIcon; keywords?: string[] }[] = [
  { label: "Home", href: "/", icon: Home, keywords: ["landing"] },
  { label: "Live risk map", href: "/#demo", icon: MapIcon, keywords: ["demo", "flood", "salinity"] },
  { label: "Pricing & plans", href: "/pricing", icon: CreditCard, keywords: ["billing", "subscription", "upgrade"] },
  { label: "Pitch", href: "/pitch", icon: Presentation, keywords: ["hackathon", "deck", "investors"] },
  { label: "Documentation", href: "/docs", icon: BookOpen, keywords: ["help", "guide"] },
  { label: "API reference", href: "/docs/api-reference", icon: FileCode2, keywords: ["rest", "endpoints", "openapi"] },
  { label: "Methodology: flood model", href: "/docs/methodology-flood", icon: FileCode2, keywords: ["model", "science"] },
  { label: "Data sources & licences", href: "/docs/data-sources", icon: FileCode2, keywords: ["attribution", "open data", "nasa"] },
  { label: "Farmer portal", href: "/dashboard/farmer", icon: Sprout, keywords: ["alerts", "advisor", "fields"] },
  { label: "Farmer alerts", href: "/dashboard/farmer/alerts", icon: Sprout, keywords: ["warnings"] },
  { label: "AI farm advisor", href: "/dashboard/farmer/advisor", icon: Sprout, keywords: ["ask", "chat", "advice"] },
  { label: "Farm risk map", href: "/dashboard/farmer/map", icon: MapIcon, keywords: ["fields"] },
  { label: "Government portal", href: "/dashboard/government", icon: Building2, keywords: ["overview", "command"] },
  { label: "Government: resources", href: "/dashboard/government/resources", icon: Building2, keywords: ["pumps", "dispatch", "sandbags"] },
  { label: "Government: broadcast alerts", href: "/dashboard/government/alerts", icon: Building2, keywords: ["sms", "broadcast"] },
  { label: "Government: analytics", href: "/dashboard/government/analytics", icon: Building2, keywords: ["reports"] },
  { label: "Supply chain portal", href: "/dashboard/supply-chain", icon: Truck, keywords: ["network"] },
  { label: "Supply chain: scenarios", href: "/dashboard/supply-chain/scenarios", icon: Truck, keywords: ["monte carlo", "what-if"] },
  { label: "Supply chain: commodities", href: "/dashboard/supply-chain/commodities", icon: Truck, keywords: ["rice", "jute", "price"] },
  { label: "Supply chain: integrations", href: "/dashboard/supply-chain/integrations", icon: Truck, keywords: ["webhooks", "api keys"] },
  { label: "Admin panel", href: "/admin", icon: ShieldCheck, keywords: ["users", "audit"] },
  { label: "Sign in", href: "/auth/signin", icon: LogIn },
  { label: "Create an account", href: "/auth/signup", icon: UserPlus, keywords: ["register", "signup"] },
  { label: "Offline mode", href: "/offline", icon: WifiOff },
];

const DEMO_ROLES = [
  { label: "Sign in as demo farmer", sub: "Ratan Das · Barisal, Bangladesh", icon: Sprout, creds: { mode: "otp", identifier: "farmer@demo.agrishield.io", otp: "123456" }, home: "/dashboard/farmer" },
  { label: "Sign in as government officer", sub: "Ministry of Agriculture, BD", icon: Building2, creds: { mode: "password", email: "gov@demo.agrishield.io", password: "demo2026" }, home: "/dashboard/government" },
  { label: "Sign in as supply chain manager", sub: "Rice & jute sourcing", icon: Truck, creds: { mode: "password", email: "supply@demo.agrishield.io", password: "demo2026" }, home: "/dashboard/supply-chain" },
  { label: "Sign in as platform admin", sub: "Users, audit log, flags", icon: KeyRound, creds: { mode: "password", email: "admin@demo.agrishield.io", password: "demo2026" }, home: "/admin" },
] as const;

function Item({ onSelect, icon: Icon, children, hint, value, keywords }: { onSelect: () => void; icon: LucideIcon; children: ReactNode; hint?: ReactNode; value: string; keywords?: string[] }) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="group flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 outline-none data-[selected=true]:bg-emerald-500/10 data-[selected=true]:text-white"
    >
      <Icon size={16} className="shrink-0 text-slate-500 group-data-[selected=true]:text-emerald-400" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-slate-500">{hint}</span>}
    </Command.Item>
  );
}

const groupCls =
  "px-1 pb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-slate-500";

export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const appearance = useAppearance();
  const centre = () => ({ x: window.innerWidth / 2, y: window.innerHeight * 0.3 });
  const setMode = (m: ThemeMode) =>
    run(() => {
      appearance.setMode(m, centre());
      toast(`Appearance: ${modeLabel(m)}`, { id: "appearance" });
    });
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const districts = trpc.public.riskMap.useQuery(undefined, { enabled: open, staleTime: 5 * 60_000 });

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      restoreRef.current?.focus?.();
    };
  }, [open, onOpenChange]);

  const run = (fn: () => void | Promise<void>) => {
    onOpenChange(false);
    void fn();
  };

  const go = (href: string) => run(() => router.push(href));

  const focusDistrict = (id: string, name: string) =>
    run(() => {
      if (pathname === "/") {
        window.dispatchEvent(new CustomEvent(FOCUS_DISTRICT_EVENT, { detail: { id } }));
        document.getElementById("demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        router.push(`/?district=${encodeURIComponent(id)}#demo`);
      }
      toast(`Focusing ${name}`, { description: "Live Open-Meteo · GloFAS values on the demo map." });
    });

  const demoSignIn = (role: (typeof DEMO_ROLES)[number]) =>
    run(async () => {
      const id = toast.loading(`${role.label}…`);
      const res = await signIn("credentials", { ...role.creds, redirect: false });
      if (res?.error) {
        toast.error("Demo sign-in failed", { id, description: "The demo account is unavailable. Try again from /auth/signin." });
        return;
      }
      toast.success("Signed in", { id });
      router.push(role.home);
      router.refresh();
    });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[2000] flex items-start justify-center px-3 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <button aria-label="Close command palette" tabIndex={-1} className="absolute inset-0 bg-[#02050c]/70 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ y: -12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -8, scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="hud-panel relative w-full max-w-xl overflow-hidden !bg-[#070d1b]/95 shadow-[0_40px_120px_-30px_rgba(16,185,129,0.35)]"
          >
            <Command label="Command palette" loop className="flex max-h-[70vh] flex-col">
              <div className="flex items-center gap-2 border-b border-white/5 px-4">
                <Search size={16} className="text-emerald-400" aria-hidden />
                <Command.Input
                  ref={inputRef}
                  placeholder="Search pages, districts, actions…"
                  className="h-14 flex-1 bg-transparent text-[15px] text-white placeholder:text-slate-500 outline-none"
                />
                <kbd className="hidden rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 telemetry sm:inline">ESC</kbd>
              </div>
              <Command.List className="flex-1 overflow-y-auto overscroll-contain p-1">
                <Command.Empty className="px-4 py-10 text-center text-sm text-slate-500">No match. Try a district name like “Khulna” or a page like “pricing”.</Command.Empty>

                <Command.Group heading="Go to" className={groupCls}>
                  {PAGES.map((p) => (
                    <Item key={p.href} value={`page ${p.label}`} keywords={p.keywords} icon={p.icon} onSelect={() => go(p.href)} hint={<span className="telemetry">{p.href}</span>}>
                      {p.label}
                    </Item>
                  ))}
                </Command.Group>

                <Command.Group heading="Appearance" className={groupCls}>
                  {THEME_IDS.map((t) => (
                    <Item
                      key={t}
                      value={`appearance theme ${THEMES[t].label}`}
                      keywords={["theme", t, t === "light" ? "light mode day" : t === "dark" ? "dark mode night" : t === "midnight" ? "oled black battery" : "accessibility a11y wcag"]}
                      icon={THEME_ICONS[t]}
                      onSelect={() => setMode(t)}
                      hint={appearance.mode === t ? "Current" : THEMES[t].tagline}
                    >
                      Appearance: {THEMES[t].label}
                    </Item>
                  ))}
                  <Item value="appearance theme system" keywords={["os", "auto", "follow"]} icon={Monitor} onSelect={() => setMode("system")} hint={appearance.mode === "system" ? "Current" : "Follow your OS"}>
                    Appearance: System
                  </Item>
                  <Item value="appearance theme solar auto" keywords={["sun", "sunrise", "sunset", "auto", "day night"]} icon={Sunrise} onSelect={() => setMode("solar")} hint={appearance.mode === "solar" ? "Current" : "Follow the real sun"}>
                    Appearance: Solar Auto
                  </Item>
                  {ACCENT_IDS.map((id) => (
                    <Item key={id} value={`appearance accent ${ACCENTS[id].label}`} keywords={["colour", "color", "accent"]} icon={Palette} onSelect={() => run(() => appearance.setAccent(id))} hint={appearance.accent === id ? "Current" : undefined}>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: ACCENTS[id].hex }} aria-hidden />
                        Accent: {ACCENTS[id].label}
                      </span>
                    </Item>
                  ))}
                  <Item
                    value="appearance motion reduce animations"
                    keywords={["motion", "animation", "reduce", "accessibility"]}
                    icon={Zap}
                    onSelect={() => run(() => appearance.setMotion(appearance.reducedMotion ? "full" : "reduced"))}
                    hint={appearance.reducedMotion ? "Reduced now" : "Full now"}
                  >
                    Motion: {appearance.reducedMotion ? "turn animations on" : "reduce animations"}
                  </Item>
                  <Item value="appearance settings panel" keywords={["theme", "customise", "customize"]} icon={SlidersHorizontal} onSelect={() => run(() => openAppearancePanel())} hint="Ctrl/⌘ ⇧ L cycles">
                    Appearance settings…
                  </Item>
                </Command.Group>

                <Command.Group heading="Monitored districts" className={groupCls}>
                  {districts.isLoading && <div className="px-3 py-2 text-xs text-slate-500">Loading live district risk…</div>}
                  {districts.data?.map((d) => {
                    const score = Math.max(d.floodRisk, d.salinityRisk);
                    return (
                      <Item
                        key={d.id}
                        value={`district ${d.name} ${d.country} ${d.basin}`}
                        keywords={[d.countryCode, d.basin]}
                        icon={MapPin}
                        onSelect={() => focusDistrict(d.id, d.name)}
                        hint={
                          <span className="telemetry flex items-center gap-2">
                            <span style={{ color: riskColor(d.floodRisk) }}>F{Math.round(d.floodRisk)}</span>
                            <span style={{ color: riskColor(d.salinityRisk) }}>S{Math.round(d.salinityRisk)}</span>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: riskColor(score) }} />
                          </span>
                        }
                      >
                        {d.name} <span className="text-slate-500">· {d.country}</span>
                      </Item>
                    );
                  })}
                </Command.Group>

                <Command.Group heading="Demo accounts" className={groupCls}>
                  {DEMO_ROLES.map((r) => (
                    <Item key={r.label} value={r.label} keywords={["demo", "login", "role"]} icon={r.icon} onSelect={() => demoSignIn(r)} hint={r.sub}>
                      {r.label}
                    </Item>
                  ))}
                </Command.Group>

                <Command.Group heading="Preferences" className={groupCls}>
                  <Item
                    value="copy link to this page"
                    icon={Link2}
                    onSelect={() =>
                      run(async () => {
                        await navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
                        toast.success("Link copied");
                      })
                    }
                  >
                    Copy link to this page
                  </Item>
                  {session?.user && (
                    <Item value="sign out logout" icon={LogOut} onSelect={() => run(() => signOut({ callbackUrl: "/" }))} hint={session.user.name ?? undefined}>
                      Sign out
                    </Item>
                  )}
                </Command.Group>
              </Command.List>
              <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 text-[11px] text-slate-500">
                <span>
                  <kbd className="telemetry">↑↓</kbd> navigate · <kbd className="telemetry">↵</kbd> open
                </span>
                <span className="telemetry">Agri-SHIELD ⌘K</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
