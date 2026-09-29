"use client";

/**
 * Farmer portal chrome — mobile-first PWA layout:
 *   · mobile: sticky top bar + fixed bottom nav (Home / Map / Tools / Alerts / Advisor);
 *     Profile sits in the top bar, the extra tools live on the Tools hub
 *   · desktop: sidebar with live risk mini-panel
 * Also: onboarding redirect, offline banner, demo-preview banner and the
 * realtime subscription (farmer + district rooms) that refreshes data and toasts.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { Bell, Bot, CalendarDays, Droplets, Home, LayoutGrid, LogOut, Map as MapIcon, MessageCircleQuestion, Shield, Stethoscope, Store, User, Wallet, WifiOff, Eye } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useRealtime } from "@/hooks/useRealtime";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { LiveDot, riskColor } from "@/components/hud";

const BASE = "/dashboard/farmer";

export function FarmerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? BASE;
  const router = useRouter();
  const { t, tx } = useI18n();
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const status = trpc.farmer.onboardingStatus.useQuery(undefined, { staleTime: 60_000 });
  const profile = trpc.farmer.getProfile.useQuery(undefined, { retry: false, staleTime: 60_000, enabled: status.data?.onboarded === true });
  const alerts = trpc.farmer.getAlerts.useQuery({ category: "all", includeArchived: false }, { staleTime: 60_000, enabled: profile.isSuccess });
  const risk = trpc.farmer.getCurrentRisk.useQuery(undefined, { staleTime: 5 * 60_000, enabled: profile.isSuccess });
  const [online, setOnline] = useState(true);

  // New farmers without a profile → onboarding wizard
  useEffect(() => {
    if (status.data?.onboarded === false || profile.error?.message === "ONBOARDING_REQUIRED") router.replace("/onboarding/farmer");
  }, [status.data?.onboarded, profile.error, router]);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      toast.success(t("common.backOnline"));
      void utils.farmer.invalidate();
    };
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const farmerId = profile.data?.farmer.id;
  const districtId = profile.data?.district.id;
  const rooms = farmerId && districtId ? ["global", `farmer:${farmerId}`, `district:${districtId}`] : ["global"];
  useRealtime(rooms, (env) => {
    const e = env.event;
    if (e.type === "alert.created" && (!districtId || e.districtId === districtId)) {
      toast.warning(e.title, { description: `${tx(`severity.${e.severity}`, undefined, e.severity)} · ${tx(`alertType.${e.alertType}`, undefined, e.alertType)}`, action: { label: t("nav.alerts"), onClick: () => router.push(`${BASE}/alerts`) } });
      void utils.farmer.getAlerts.invalidate();
    }
    if (e.type === "alert.actioned" && e.farmerId === farmerId) void utils.farmer.getAlerts.invalidate();
    if (e.type === "risk.updated" && (!districtId || e.districtIds.includes(districtId))) void utils.farmer.getCurrentRisk.invalidate();
    if (e.type === "scan.completed") void utils.farmer.getAlerts.invalidate();
  });

  const activeCount = alerts.data?.active.filter((a) => !a.actioned && a.kind !== "advisory").length ?? 0;
  // Bottom nav holds max 5 items; Profile moves to the top bar on mobile.
  const nav = [
    { href: BASE, label: t("nav.home"), icon: Home },
    { href: `${BASE}/map`, label: t("nav.map"), icon: MapIcon },
    { href: `${BASE}/tools`, label: t("nav.tools"), icon: LayoutGrid },
    { href: `${BASE}/alerts`, label: t("nav.alerts"), icon: Bell, badge: activeCount },
    { href: `${BASE}/advisor`, label: t("nav.advisor"), icon: Bot },
  ];
  const sideNav = [...nav, { href: `${BASE}/profile`, label: t("nav.profile"), icon: User }];
  const toolLinks = [
    { href: `${BASE}/tools/irrigation`, label: t("tools.irr.title"), icon: Droplets },
    { href: `${BASE}/tools/planner`, label: t("tools.plan.title"), icon: CalendarDays },
    { href: `${BASE}/tools/market`, label: t("tools.mkt.title"), icon: Store },
    { href: `${BASE}/tools/doctor`, label: t("tools.doc.title"), icon: Stethoscope },
    { href: `${BASE}/tools/finance`, label: t("tools.fin.title"), icon: Wallet },
    { href: `${BASE}/tools/ask`, label: t("tools.ask.title"), icon: MessageCircleQuestion },
  ];
  const isActive = (href: string) => (href === BASE ? pathname === BASE : pathname.startsWith(href));
  const isMap = pathname.startsWith(`${BASE}/map`);
  const name = profile.data?.user?.name ?? session?.user?.name ?? "";
  const overall = risk.data?.overall.score;

  return (
    <div className="min-h-screen hud-bg text-slate-200" style={{ ["--hud-accent" as string]: "var(--user-accent, 16 185 129)" }}>
      {/* Top bar */}
      <header className="sticky top-0 z-[1100] border-b border-white/5 bg-[#060a16]/85 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <Link href={BASE} className="flex items-center gap-2 min-w-0" aria-label="Agri-SHIELD home">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_0_18px_-4px_rgba(16,185,129,0.8)]">
              <Shield size={16} className="text-slate-950" />
            </span>
            <span className="hidden xs:inline font-display font-semibold text-white tracking-tight sm:inline">
              Agri<span className="text-emerald-400">-SHIELD</span>
            </span>
          </Link>
          <span className="hidden md:inline hud-label border-l border-white/10 pl-3">{t("nav.portal")}</span>
          {profile.data && (
            <div className="min-w-0 border-l border-white/10 pl-3 leading-tight">
              <div className="truncate text-xs font-medium text-slate-100">{profile.data.farmer.farmName}</div>
              <div className="truncate text-[10px] telemetry text-slate-500">
                {profile.data.district.name} · {profile.data.district.countryName}
              </div>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {overall != null && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[10px] telemetry uppercase tracking-wider" style={{ color: riskColor(overall) }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: riskColor(overall) }} />
                {tx(`risk.${risk.data!.overall.level}`)} · {overall}%
              </span>
            )}
            <LiveDot className="hidden sm:inline-flex" label={t("common.live").toUpperCase()} />
            <ThemeToggle compact />
            <LanguageSwitcher />
            <Link href={`${BASE}/profile`} className={cn("grid h-9 w-9 place-items-center rounded-full lg:hidden", pathname.startsWith(`${BASE}/profile`) ? "bg-emerald-500 text-slate-950" : "bg-white/5 text-slate-300")} aria-label={t("nav.profile")}>
              {name ? <span className="text-xs font-semibold">{name[0]}</span> : <User size={16} />}
            </Link>
            {name && (
              <div className="hidden lg:flex items-center gap-2 pl-3 border-l border-white/10">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500 text-xs font-semibold text-slate-950">{name[0]}</div>
                <button onClick={() => signOut({ callbackUrl: "/" })} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/5" title={t("common.signOut")} aria-label={t("common.signOut")}>
                  <LogOut size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
        <AnimatePresence>
          {!online && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden bg-amber-500/15 text-amber-300">
              <div className="flex items-center gap-2 px-4 py-1.5 text-xs">
                <WifiOff size={13} /> {t("common.offline")}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex sticky top-14 h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col border-r border-white/5 bg-[#070c1a]/70" aria-label={t("nav.mainNavigation")}>
          <nav className="flex flex-col gap-1 overflow-y-auto p-3">
            {sideNav.map(({ href, label, icon: Icon, badge }) => {
              const active = isActive(href);
              return (
                <Link key={href} href={href} className={cn("group relative flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm transition-colors", active ? "text-white" : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.03]")} aria-current={active ? "page" : undefined}>
                  {active && <motion.span layoutId="farmer-nav" className="absolute inset-0 rounded-lg bg-emerald-500/10 shadow-[inset_2px_0_0_rgb(16,185,129)]" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
                  <Icon size={17} className={cn("relative", active && "text-emerald-400")} />
                  <span className="relative">{label}</span>
                  {!!badge && <span className="relative ml-auto rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white telemetry">{badge}</span>}
                </Link>
              );
            })}
            <div className="mt-2 border-t border-white/5 pt-2">
              <div className="hud-label px-3 pb-1">{t("nav.tools")}</div>
              {toolLinks.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link key={href} href={href} className={cn("flex min-h-[38px] items-center gap-2.5 rounded-lg px-3 text-[13px]", active ? "bg-emerald-500/10 text-white" : "text-slate-500 hover:bg-white/[0.03] hover:text-slate-200")} aria-current={active ? "page" : undefined}>
                    <Icon size={15} className={active ? "text-emerald-400" : undefined} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </nav>
          <div className="mt-auto p-3">
            <div className="hud-panel p-3 text-[11px]">
              <div className="hud-label mb-2">{t("common.source")}</div>
              <ul className="space-y-1 text-slate-400 telemetry text-[10px]">
                <li>Open-Meteo · GloFAS v4</li>
                <li>ERA5 · Copernicus DEM</li>
                <li>NASA MODIS · IMERG</li>
                <li>OpenStreetMap · GDACS</li>
              </ul>
            </div>
          </div>
        </aside>

        <main className={cn("min-w-0 flex-1", isMap ? "p-0" : "px-3 pt-4 pb-28 sm:px-5 lg:p-8 lg:pb-10")}>
          {profile.data?.isDemoFallback && !isMap && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-200">
              <Eye size={14} className="shrink-0" /> {t("common.demoPreview")}
            </div>
          )}
          {profile.isSuccess ? (
            <motion.div key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
              {children}
            </motion.div>
          ) : (
            // Hold the page back until we know this farmer has a profile — a brand-new
            // account is sent to onboarding without firing the page's data queries.
            <div className="space-y-4" aria-busy="true" aria-live="polite">
              {profile.error && profile.error.message !== "ONBOARDING_REQUIRED" ? (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {profile.error.message}
                  <button onClick={() => void profile.refetch()} className="ml-3 underline">{t("common.retry")}</button>
                </div>
              ) : (
                <>
                  <div className="skeleton h-8 w-56 rounded-lg" />
                  <div className="skeleton h-48 rounded-2xl" />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="skeleton h-24 rounded-xl" />
                    <div className="skeleton h-24 rounded-xl" />
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed inset-x-0 bottom-0 z-[1100] border-t border-white/10 bg-[#060a16]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]" aria-label={t("nav.mainNavigation")}>
        <ul className="grid grid-cols-5">
          {nav.map(({ href, label, icon: Icon, badge }) => {
            const active = isActive(href);
            return (
              <li key={href}>
                <Link href={href} className="relative flex h-16 flex-col items-center justify-center gap-1 text-[10.5px]" aria-current={active ? "page" : undefined}>
                  {active && <motion.span layoutId="farmer-bottom" className="absolute top-0 h-0.5 w-10 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.9)]" />}
                  <span className="relative">
                    <Icon size={21} className={active ? "text-emerald-400" : "text-slate-500"} />
                    {!!badge && <span className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-rose-500 px-1 text-center text-[9px] font-bold leading-4 text-white">{badge}</span>}
                  </span>
                  <span className={active ? "text-white" : "text-slate-500"}>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
