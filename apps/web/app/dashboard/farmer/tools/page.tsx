"use client";

/**
 * Tools hub — big touch-target tiles for the everyday farm tools, each with a
 * live one-line status from Today's actions.
 */
import Link from "next/link";
import { motion } from "framer-motion";
import { CalendarDays, ChevronRight, Droplets, MessageCircleQuestion, Radar, Stethoscope, Store, Umbrella, Wallet, type LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { TodayActions } from "@/components/farmer/TodayActions";

interface Tile {
  href: string;
  icon: LucideIcon;
  color: string;
  title: string;
  desc: string;
  tool?: string;
}

export default function ToolsHub() {
  const { t } = useI18n();
  const today = trpc.farmer.todayActions.useQuery(undefined, { staleTime: 5 * 60_000 });
  const questions = trpc.farmer.listQuestions.useQuery({ status: "all" }, { staleTime: 60_000 });
  const openQ = (questions.data ?? []).filter((q) => q.status === "open").length;
  const tiles: Tile[] = [
    { href: "/dashboard/farmer/tools/irrigation", icon: Droplets, color: "#38bdf8", title: t("tools.irr.title"), desc: t("tools.hub.irrigation"), tool: "irrigation" },
    { href: "/dashboard/farmer/tools/planner", icon: CalendarDays, color: "#a3e635", title: t("tools.plan.title"), desc: t("tools.hub.planner") },
    { href: "/dashboard/farmer/tools/market", icon: Store, color: "#fbbf24", title: t("tools.mkt.title"), desc: t("tools.hub.market"), tool: "price" },
    { href: "/dashboard/farmer/tools/doctor", icon: Stethoscope, color: "#f87171", title: t("tools.doc.title"), desc: t("tools.hub.doctor"), tool: "disease" },
    { href: "/dashboard/farmer/tools/finance", icon: Wallet, color: "#34d399", title: t("tools.fin.title"), desc: t("tools.hub.finance") },
    { href: "/dashboard/farmer/tools/finance#insurance", icon: Umbrella, color: "#22d3ee", title: t("tools.fin.tabInsurance"), desc: t("tools.hub.insurance") },
    { href: "/dashboard/farmer/map?radar=1", icon: Radar, color: "#60a5fa", title: t("tools.hub.radarTitle"), desc: t("tools.hub.radar"), tool: "rain" },
    { href: "/dashboard/farmer/tools/ask", icon: MessageCircleQuestion, color: "#a78bfa", title: t("tools.ask.title"), desc: openQ ? t("tools.hub.askOpen", { count: openQ }) : t("tools.hub.ask"), tool: "question" },
  ];
  const urgentBy = new Set((today.data?.items ?? []).filter((i) => i.priority >= 60).map((i) => i.tool as string));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <div className="hud-label mb-1 text-emerald-400/80">{t("nav.tools")}</div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">{t("tools.hub.title")}</h1>
        <p className="mt-0.5 text-sm text-slate-400">{t("tools.hub.subtitle")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile, i) => (
          <motion.div key={tile.href} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Link href={tile.href} className="group relative flex h-full min-h-[132px] flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 transition-colors hover:border-white/25 active:scale-[0.98]">
              {tile.tool && urgentBy.has(tile.tool) && <span className="absolute right-3 top-3 h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" aria-label={t("tools.hub.needsAttention")} />}
              <span className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: `${tile.color}1f` }}>
                <tile.icon size={22} style={{ color: tile.color }} />
              </span>
              <span className="mt-3 font-display text-[15px] font-semibold leading-tight text-white">{tile.title}</span>
              <span className="mt-1 flex-1 text-xs leading-snug text-slate-400">{tile.desc}</span>
              <ChevronRight size={16} className="mt-1 self-end text-slate-600 group-hover:text-slate-300" />
            </Link>
          </motion.div>
        ))}
      </div>
      <div className="mt-5">
        <TodayActions />
      </div>
    </div>
  );
}
