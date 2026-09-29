"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Lock, Radar, Satellite, Shield, Waves } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { AnimatedNumber, LiveDot, SourceTag } from "@/components/hud";

export const authInput =
  "min-h-[48px] w-full rounded-xl border bg-slate-950/60 px-3.5 text-[15px] text-slate-100 placeholder:text-slate-500 transition-colors focus:outline-none focus:ring-2";
export const inputState = (err?: unknown) => (err ? "border-rose-500/70 focus:border-rose-400 focus:ring-rose-500/20" : "border-slate-700 focus:border-emerald-500/70 focus:ring-emerald-500/20");

/** Only same-origin relative paths are allowed as post-login destinations. */
export function safeCallback(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("/") && !decoded.startsWith("//") && !decoded.startsWith("/auth")) return decoded;
  } catch {}
  return null;
}

function LiveStats() {
  const { t, fmt } = useI18n();
  const s = trpc.public.stats.useQuery(undefined, { refetchInterval: 60_000 });
  const items = s.data
    ? [
        { icon: Shield, label: t("auth.statFarmers"), value: s.data.farmersProtectedToday },
        { icon: Radar, label: t("auth.statDistricts"), value: s.data.districtsMonitored },
        { icon: Waves, label: t("auth.statAlerts"), value: s.data.activeAlerts },
        { icon: Satellite, label: t("auth.statHectares"), value: s.data.hectaresMonitored },
      ]
    : [];
  return (
    <div className="grid grid-cols-2 gap-3">
      {s.data
        ? items.map(({ icon: Icon, label, value }) => (
            <div key={label} className="hud-panel p-3">
              <Icon size={14} className="text-emerald-400" />
              <AnimatedNumber value={value} className="mt-1.5 block text-xl font-semibold text-white" />
              <div className="text-[10px] text-slate-400">{label}</div>
            </div>
          ))
        : [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[86px] rounded-xl" />)}
      <div className="col-span-2 flex items-center gap-2">
        <LiveDot label={t("common.live").toUpperCase()} />
        <SourceTag>Open-Meteo · GloFAS · GDACS</SourceTag>
        {s.data?.live.lastRefresh && <span className="text-[10px] telemetry text-slate-500">{fmt.time(s.data.live.lastRefresh)}</span>}
      </div>
    </div>
  );
}

export function AuthShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="relative min-h-screen overflow-hidden hud-bg text-slate-200">
      {/* ambient orbs */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 scanlines opacity-40" />

      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_0_18px_-4px_rgba(16,185,129,0.8)]">
            <Shield size={17} className="text-slate-950" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight text-white">
            Agri<span className="text-emerald-400">-SHIELD</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </header>

      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-2 sm:px-8 lg:grid-cols-2 lg:pt-8">
        <aside className="hidden lg:block">
          <div className="hud-label text-emerald-400/80">{t("auth.heroEyebrow")}</div>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight text-white">{t("common.tagline")}</h2>
          <p className="mt-4 max-w-md text-slate-400">{t("auth.heroBody")}</p>
          <div className="mt-8 max-w-md">
            <LiveStats />
          </div>
        </aside>
        <motion.main initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} className={wide ? "mx-auto w-full max-w-xl" : "mx-auto w-full max-w-md"}>
          <div className="relative rounded-2xl bg-gradient-to-br from-emerald-500/40 via-slate-700/30 to-cyan-500/40 p-px shadow-[0_30px_80px_-30px_rgba(16,185,129,0.45)]">
            <div className="hud-panel rounded-2xl bg-[#0a1122]/95 p-5 sm:p-7">{children}</div>
          </div>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
            <Lock size={11} /> {t("auth.secureNote")}
          </p>
        </motion.main>
      </div>
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  return (
    <motion.div initial={false} animate={{ height: message ? "auto" : 0, opacity: message ? 1 : 0 }} className="overflow-hidden">
      {message && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
          {message}
        </div>
      )}
    </motion.div>
  );
}

export function FieldError({ message }: { message?: string }) {
  return (
    <motion.span initial={false} animate={{ height: message ? "auto" : 0, opacity: message ? 1 : 0, x: message ? [0, -4, 4, -2, 0] : 0 }} transition={{ duration: 0.3 }} className="block overflow-hidden text-xs text-rose-400" role={message ? "alert" : undefined}>
      <span className="block pt-1">{message}</span>
    </motion.span>
  );
}

/** After a successful credentials sign-in: resolve role → destination, adopt profile language. */
export async function destinationAfterLogin(callbackUrl: string | null): Promise<string> {
  const { getSession } = await import("next-auth/react");
  const { homeForRole } = await import("@/lib/rbac");
  const { persistLocaleClient } = await import("@/lib/i18n/I18nProvider");
  const s = await getSession();
  const lang = s?.user?.language;
  let explicit = false;
  try {
    explicit = !!localStorage.getItem("agri_lang");
  } catch {}
  if (lang && lang !== "en" && !explicit) persistLocaleClient(lang);
  return callbackUrl ?? homeForRole(s?.user?.role);
}
