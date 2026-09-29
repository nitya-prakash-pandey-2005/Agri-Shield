"use client";

/** "Rain arriving in N minutes" nowcast banner (Open-Meteo 15-minutely precipitation). */
import { CloudRain, CloudSun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { RouterOutputs } from "@/lib/trpc";

type Nowcast = NonNullable<RouterOutputs["farmer"]["nowcast"]["nowcast"]>;

export function NowcastHint({ nc, className }: { nc: Nowcast | null | undefined; className?: string }) {
  const { t, fmt } = useI18n();
  if (!nc) return null;
  const wet = nc.rainInMinutes != null;
  const msg = nc.raining
    ? nc.stopsInMinutes != null
      ? t("tools.now.rainingStops", { minutes: nc.stopsInMinutes })
      : t("tools.now.raining")
    : wet
      ? t("tools.now.rainIn", { minutes: nc.rainInMinutes! })
      : t("tools.now.dry");
  const max = Math.max(0.5, ...nc.steps.map((s) => s.mm));
  return (
    <div className={cn("rounded-2xl border px-3 py-2 backdrop-blur", wet ? "border-sky-400/40 bg-sky-500/15" : "border-white/10 bg-[#060a16]/85", className)} role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        {wet ? <CloudRain size={18} className="shrink-0 text-sky-300" /> : <CloudSun size={18} className="shrink-0 text-slate-400" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">{msg}</div>
          {wet && <div className="text-[11px] text-sky-200">{t("tools.now.amount", { mm: fmt.number(nc.totalMm, { maximumFractionDigits: 1 }), peak: fmt.number(nc.peakMmPerHour, { maximumFractionDigits: 1 }) })}</div>}
        </div>
        <div className="flex h-8 items-end gap-[2px]" aria-hidden>
          {nc.steps.slice(0, 24).map((s, i) => (
            <span key={i} className={cn("w-[3px] rounded-t", s.mm >= 0.2 ? "bg-sky-400" : "bg-slate-700")} style={{ height: `${Math.max(8, (s.mm / max) * 100)}%` }} />
          ))}
        </div>
      </div>
      <div className="mt-0.5 text-[9px] telemetry uppercase tracking-wider text-slate-500">{t("tools.now.next6h")} · {nc.source}</div>
    </div>
  );
}
