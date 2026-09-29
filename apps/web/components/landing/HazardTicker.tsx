"use client";

/** Live GDACS + NASA EONET hazard marquee (Asia-Pacific window). */
import { CloudRain, Sun, Tornado, Waves, Wind } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

const ICON = { flood: Waves, cyclone: Tornado, storm: Wind, drought: Sun, other: CloudRain } as const;
const LEVEL: Record<string, string> = { red: "#f87171", orange: "#fb923c", green: "#4ade80" };

function when(iso: string) {
  const d = new Date(iso);
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} d ago`;
}

export function HazardTicker() {
  // start slightly later so the slow external GDACS/EONET pull isn't batched with the hero counters
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 1200);
    return () => clearTimeout(t);
  }, []);
  const q = trpc.public.hazards.useQuery(undefined, { enabled: armed, refetchInterval: 10 * 60_000 });
  const events = (q.data ?? []).slice(0, 24);

  return (
    <section aria-label="Live hazard feed" className="relative border-y border-white/[0.06] bg-[#040913]/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-stretch">
        <div className="z-10 flex shrink-0 items-center gap-2 border-r border-white/[0.06] bg-[#040913] px-4 py-3 text-xs sm:px-6">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
          </span>
          <span className="font-medium text-slate-200">Hazards now</span>
          <span className="hidden text-slate-500 sm:inline">GDACS · NASA EONET</span>
        </div>
        <div className="site-marquee-wrap relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_4%,#000_96%,transparent)]">
          {!armed || q.isLoading ? (
            <div className="px-4 py-3 text-xs text-slate-500">Pulling live disaster alerts…</div>
          ) : events.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No active flood, cyclone or drought events reported in the Asia-Pacific window right now.</div>
          ) : (
            <ul className="site-marquee flex w-max items-center" style={{ ["--marquee-duration" as string]: `${Math.max(40, events.length * 7)}s` }}>
              {[...events, ...events].map((e, i) => {
                const Icon = ICON[e.type] ?? CloudRain;
                const color = e.alertLevel ? LEVEL[e.alertLevel] : "#38bdf8";
                const body = (
                  <>
                    <Icon size={14} style={{ color }} aria-hidden />
                    <span className="text-slate-200">{e.title}</span>
                    {e.country && <span className="text-slate-500">{e.country}</span>}
                    <span className="telemetry text-[10px] text-slate-500">{when(e.date)}</span>
                    <span className="telemetry rounded border border-white/10 px-1 text-[9.5px] text-slate-400">{e.source}</span>
                  </>
                );
                return (
                  <li key={`${e.id}-${i}`} aria-hidden={i >= events.length ? true : undefined} className="flex shrink-0 items-center border-r border-white/[0.05] px-5 py-3 text-xs">
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noreferrer" tabIndex={i >= events.length ? -1 : 0} className="flex items-center gap-2 hover:opacity-80">
                        {body}
                      </a>
                    ) : (
                      <span className="flex items-center gap-2">{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
