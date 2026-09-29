"use client";

/**
 * Shared portal chrome: collapsible sidebar (desktop), top bar with live
 * clock, scenario badge, realtime toast feed, user menu. Mobile gets a
 * drawer. Each portal passes its own nav + accent.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { LogOut, Menu, Shield, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/rbac";
import { useRealtime } from "@/hooks/useRealtime";
import { LiveDot } from "./index";
import { NotificationBell } from "@/components/notifications/NotificationBell";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number | string;
}

const ACCENT_RGB = { emerald: "16 185 129", amber: "245 158 11", green: "34 197 94", violet: "139 92 246", cyan: "56 189 248" };

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <span className="telemetry text-[11px] text-slate-400 hidden md:inline">
      {now.toISOString().slice(0, 10)} <span className="text-slate-200">{now.toISOString().slice(11, 19)}</span> UTC
    </span>
  );
}

export function DashboardShell({
  product,
  nav,
  accent = "emerald",
  rooms = ["global"],
  children,
  topbarExtra,
}: {
  product: string;
  nav: NavItem[];
  accent?: keyof typeof ACCENT_RGB;
  rooms?: string[];
  children: ReactNode;
  topbarExtra?: ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const rgb = ACCENT_RGB[accent];

  useRealtime(rooms, (env) => {
    const e = env.event;
    if (e.type === "alert.created") toast.warning(e.title, { description: `${e.severity.toUpperCase()} · ${e.alertType}` });
    if (e.type === "resource.updated") toast.info(`Resource request ${e.requestId} → ${e.status}`);
    if (e.type === "scan.completed" && e.alertsCreated > 0) toast.message(`Climate scan: ${e.alertsCreated} new alert(s)`);
  });

  const isActive = (href: string) => (href === nav[0]?.href ? pathname === href : pathname.startsWith(href));

  const sidebar = (
    <nav className="flex flex-col gap-1 p-3">
      {nav.map(({ href, label, icon: Icon, badge }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              active ? "text-white" : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.03]"
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-lg"
                style={{ background: `rgb(${rgb} / 0.1)`, boxShadow: `inset 2px 0 0 rgb(${rgb})` }}
                transition={{ type: "spring", stiffness: 400, damping: 34 }}
              />
            )}
            <Icon size={16} className="relative" style={active ? { color: `rgb(${rgb})` } : undefined} />
            <span className="relative">{label}</span>
            {badge !== undefined && badge !== 0 && (
              <span className="relative ml-auto rounded-full bg-rose-500/90 px-1.5 text-[10px] font-semibold text-white telemetry">{badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen hud-bg text-slate-200" style={{ "--hud-accent": rgb } as CSSProperties}>
      {/* Top bar */}
      <header className="sticky top-0 z-40 h-14 border-b border-white/5 bg-[#060a16]/80 backdrop-blur-xl no-print">
        <div className="flex h-full items-center gap-3 px-4">
          <button className="lg:hidden p-1.5 -ml-1 text-slate-300" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `linear-gradient(135deg, rgb(${rgb}), rgb(${rgb} / 0.5))` }}>
              <Shield size={16} className="text-slate-950" />
            </span>
            <span className="font-display font-semibold text-white tracking-tight">
              Agri<span style={{ color: `rgb(${rgb})` }}>-SHIELD</span>
            </span>
          </Link>
          <span className="hidden sm:inline hud-label border-l border-white/10 pl-3">{product}</span>
          <div className="ml-auto flex items-center gap-3">
            {topbarExtra}
            <NotificationBell />
            <Clock />
            <LiveDot />
            {session?.user && (
              <div className="flex items-center gap-2 pl-3 border-l border-white/10">
                <div className="hidden md:block text-right leading-tight">
                  <div className="text-xs text-slate-100">{session.user.name}</div>
                  <div className="text-[10px] text-slate-500">{ROLE_LABELS[session.user.role] ?? session.user.role}</div>
                </div>
                <div className="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-slate-950" style={{ background: `rgb(${rgb})` }}>
                  {session.user.name?.[0] ?? "?"}
                </div>
                <button onClick={() => signOut({ callbackUrl: "/" })} className="p-1.5 text-slate-500 hover:text-rose-400" title="Sign out" aria-label="Sign out">
                  <LogOut size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden lg:block sticky top-14 h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r border-white/5 bg-[#070c1a]/70 no-print">
          {sidebar}
        </aside>

        <AnimatePresence>
          {open && (
            <>
              <motion.div className="fixed inset-0 z-50 bg-black/60 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
              <motion.aside
                className="fixed inset-y-0 left-0 z-50 w-72 border-r border-white/10 bg-[#070c1a] lg:hidden"
                initial={{ x: -300 }}
                animate={{ x: 0 }}
                exit={{ x: -300 }}
                transition={{ type: "spring", stiffness: 380, damping: 36 }}
              >
                <div className="flex h-14 items-center justify-between px-4 border-b border-white/5">
                  <span className="hud-label">{product}</span>
                  <button onClick={() => setOpen(false)} aria-label="Close navigation">
                    <X size={18} />
                  </button>
                </div>
                {sidebar}
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">
          <motion.div key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
