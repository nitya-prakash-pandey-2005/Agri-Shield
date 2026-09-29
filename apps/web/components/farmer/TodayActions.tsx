"use client";

/**
 * "Today's actions" — one glance at the most important item from each farmer
 * tool (irrigation, alerts, rain nowcast, market price, disease weather,
 * expert answers), ranked by urgency. Server: farmer.todayActions.
 */
import Link from "next/link";
import { motion } from "framer-motion";
import { Bell, ChevronRight, CloudRain, Droplets, ListChecks, MessageCircleQuestion, Stethoscope, Store } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Panel, Skeleton } from "@/components/hud";
import { useOfflineSnapshot } from "@/components/farmer/tools/common";

const ICON = { irrigation: Droplets, alert: Bell, price: Store, disease: Stethoscope, rain: CloudRain, question: MessageCircleQuestion } as const;
const COLOR = { irrigation: "#38bdf8", alert: "#f87171", price: "#fbbf24", disease: "#fb7185", rain: "#60a5fa", question: "#a78bfa" } as const;

export function TodayActions() {
  const { t, tx, fmt } = useI18n();
  const q = trpc.farmer.todayActions.useQuery(undefined, { staleTime: 5 * 60_000, refetchInterval: 10 * 60_000 });
  const snap = useOfflineSnapshot("today-actions", q.data);
  const data = snap.data;

  const text = (code: string, vars: Record<string, string | number>) => {
    const v: Record<string, string | number> = { ...vars };
    if (typeof v.crop === "string") v.crop = tx(`crops.${v.crop}`, undefined, v.crop);
    if (typeof v.commodity === "string") v.commodity = tx(`tools.commodity.${v.commodity}`, undefined, v.commodity);
    if (typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date)) v.date = fmt.date(`${v.date}T12:00:00`, { weekday: "long", day: "numeric", month: "short" });
    if (typeof v.month === "string" && /^\d{4}-\d{2}$/.test(v.month)) v.month = fmt.date(`${v.month}-15T12:00:00`, { month: "short", year: "numeric" });
    if (typeof v.severity === "string") v.severity = tx(`severity.${v.severity}`, undefined, v.severity);
    if (typeof v.direction === "string") v.direction = t(v.direction === "above" ? "tools.mkt.above" : "tools.mkt.below");
    if (typeof v.price === "number") v.price = fmt.number(v.price, { maximumFractionDigits: 2 });
    if (typeof v.m3 === "number") v.m3 = fmt.number(v.m3);
    return tx(`tools.today.${code}`, v, code);
  };

  return (
    <Panel title={t("tools.today.title")} subtitle={t("tools.today.subtitle")} icon={ListChecks} accent="emerald" live={!!q.data}>
      {!data ? (
        q.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <p className="text-sm text-slate-500">{t("common.errorLoad")}</p>
        )
      ) : data.items.length ? (
        <ul className="space-y-2">
          {data.items.slice(0, 5).map((it, i) => {
            const Icon = ICON[it.tool];
            const urgent = it.priority >= 60;
            return (
              <motion.li key={`${it.tool}-${it.code}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                <Link href={it.href} className={cn("group flex min-h-[60px] items-center gap-3 rounded-xl border p-2.5 transition-colors", urgent ? "border-amber-400/40 bg-amber-500/[0.07]" : "border-white/5 bg-white/[0.03] hover:border-white/15")}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${COLOR[it.tool]}22` }}>
                    <Icon size={19} style={{ color: COLOR[it.tool] }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug text-white">{text(it.code, it.vars)}</span>
                    <span className="mt-0.5 block text-[10px] telemetry text-slate-500">
                      {tx(`tools.tool.${it.tool}`)} · {it.source}
                    </span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-slate-600 group-hover:text-slate-300" />
                </Link>
              </motion.li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">{t("tools.today.allClear")}</p>
      )}
      {data && !data.marketLoaded && <p className="mt-2 text-[10px] text-slate-600">{t("tools.today.marketLoading")}</p>}
    </Panel>
  );
}
