"use client";

/** Hero live counter widget — `public.stats`, refreshed every 30 s. */
import { useEffect, useState } from "react";
import { AnimatedNumber, Skeleton } from "@/components/hud";
import { trpc } from "@/lib/trpc";

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

export function LiveCounters() {
  const stats = trpc.public.stats.useQuery(undefined, { refetchInterval: 30_000, refetchIntervalInBackground: false });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const d = stats.data;
  const items = [
    { label: "farmers protected today", value: d?.farmersProtectedToday, color: "text-emerald-300" },
    { label: "alerts sent this week", value: d?.alertsSentThisWeek, color: "text-sky-300" },
    { label: "hectares monitored", value: d?.hectaresMonitored, color: "text-amber-200" },
  ];
  const climateAt = d?.live.lastRefresh ? new Date(d.live.lastRefresh).getTime() : null;
  const nextIn = stats.dataUpdatedAt ? Math.max(0, 30 - Math.floor((now - stats.dataUpdatedAt) / 1000)) : null;

  return (
    <div className="hud-panel mt-8 max-w-xl p-4 sm:p-5" aria-busy={stats.isLoading} aria-label="Live platform counters">
      <div className="grid grid-cols-3 gap-3 sm:gap-6">
        {items.map((it, i) => (
          <div key={it.label} className={i > 0 ? "border-l border-white/[0.07] pl-3 sm:pl-6" : ""}>
            {it.value === undefined ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <AnimatedNumber value={it.value} className={`block text-[15px] font-semibold min-[400px]:text-lg sm:text-2xl ${it.color}`} />
            )}
            <div className="mt-1 text-[11px] leading-tight text-slate-400 sm:text-xs">{it.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.06] pt-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className={`absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 ${stats.isFetching ? "animate-ping" : ""}`} />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          {stats.isError ? "Live feed unreachable, retrying" : stats.dataUpdatedAt ? `Counters ${ago(now - stats.dataUpdatedAt)}${nextIn !== null ? ` · next in ${nextIn}s` : ""}` : "Connecting…"}
        </span>
        <span>
          Climate feed:{" "}
          <span className="text-slate-400">
            {d?.live.refreshing ? "refreshing now" : climateAt ? `Open-Meteo + GloFAS, ${ago(now - climateAt)}` : "seeded baseline, live pull pending"}
          </span>
        </span>
        {d && (
          <span className="telemetry text-slate-400">
            {d.activeAlerts} active alerts · {d.districtsMonitored} districts · {d.countries} countries
          </span>
        )}
      </div>
    </div>
  );
}
