"use client";

/**
 * Time machine: scrub −30 days (real alerts, rule firings, hazard reports, cyclone
 * approaches, flood episodes) … +16 days (forecast risk with a widening band).
 * Author: Nitya Prakash Pandey
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, History, Pause, Play } from "lucide-react";
import { Explain } from "@/components/help/Explain";
import type { TwinTimeline } from "@/server/services/twin";

const KIND_COLORS: Record<string, string> = { alert: "#fbbf24", firing: "#f472b6", hazard: "#fb923c", cyclone: "#e879f9", flood: "#38bdf8" };
const KIND_LABEL: Record<string, string> = { alert: "alerts", firing: "rule firings", hazard: "hazard reports", cyclone: "cyclone approaches", flood: "flood episodes" };
const DAY = 86_400_000;

export function fmtDay(ms: number) {
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
export function offsetLabel(o: number) {
  const r = Math.round(o);
  if (Math.abs(o) < 0.05) return "Now";
  if (r === 0) return o < 0 ? "Earlier today" : "Later today";
  return r < 0 ? `${-r} day${r === -1 ? "" : "s"} ago` : `in ${r} day${r === 1 ? "" : "s"}`;
}

export function TimeMachine({ timeline, offset, setOffset, nowMs, reduced, loading, className }: { timeline: TwinTimeline | null; offset: number; setOffset: (o: number) => void; nowMs: number; reduced: boolean; loading?: boolean; className?: string }) {
  const from = timeline?.from ?? -30;
  const to = timeline?.to ?? 16;
  const [playing, setPlaying] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el);
    setW(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);

  // playback: 1 day per second (4 days/s when reduced motion is off and far from the end)
  const offRef = useRef(offset);
  offRef.current = offset;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      const next = offRef.current + dt * (reduced ? 1 : 1.5);
      if (next >= to) {
        setOffset(to);
        setPlaying(false);
        return;
      }
      setOffset(next);
      raf = requestAnimationFrame(step);
    };
    if (offRef.current >= to - 0.01) setOffset(from);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, from, to, reduced, setOffset]);

  const H = 74;
  const PADX = 8;
  const chartTop = 16;
  const chartH = H - chartTop - 14;
  const x = (o: number) => PADX + ((o - from) / Math.max(1, to - from)) * (w - PADX * 2);
  const y = (v: number) => chartTop + chartH - (Math.max(0, Math.min(100, v)) / 100) * chartH;
  const days = timeline?.days ?? [];
  const lo = days.length ? Math.max(0, Math.min(...days.map((d) => d.band?.[0] ?? d.risk)) - 6) : 0;
  const hi = days.length ? Math.min(100, Math.max(...days.map((d) => d.band?.[1] ?? d.risk)) + 6) : 100;
  const yy = (v: number) => y(((v - lo) / Math.max(1, hi - lo)) * 100);

  const paths = useMemo(() => {
    if (!days.length) return null;
    const past = days.filter((d) => d.offset <= 0).map((d, i) => `${i ? "L" : "M"}${x(d.offset).toFixed(1)},${yy(d.risk).toFixed(1)}`).join("");
    const fut = days.filter((d) => d.offset >= 0).map((d, i) => `${i ? "L" : "M"}${x(d.offset).toFixed(1)},${yy(d.risk).toFixed(1)}`).join("");
    const bandPts = days.filter((d) => d.offset >= 0);
    const band =
      bandPts.map((d, i) => `${i ? "L" : "M"}${x(d.offset).toFixed(1)},${yy(d.band?.[1] ?? d.risk).toFixed(1)}`).join("") +
      [...bandPts].reverse().map((d) => `L${x(d.offset).toFixed(1)},${yy(d.band?.[0] ?? d.risk).toFixed(1)}`).join("") +
      "Z";
    return { past, fut, band };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, w, lo, hi]);

  const cur = days.find((d) => d.offset === Math.round(offset));
  const total = cur ? Object.values(cur.counts).reduce((t, n) => t + n, 0) : 0;
  const timeMs = nowMs + offset * DAY;
  const climatology = timeline?.forecast.source === "climatology";

  return (
    <div className={`hud-panel px-3 pb-2 pt-2 ${className ?? ""}`} style={{ ["--hud-accent" as string]: "251 191 36" }} data-testid="twin-timemachine">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause time machine" : "Play time machine"} className="grid h-7 w-7 place-items-center rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25">
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button type="button" onClick={() => { setPlaying(false); setOffset(0); }} className={`rounded-lg px-2 py-1 telemetry text-[10px] uppercase tracking-wider ${Math.abs(offset) < 0.05 ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>
          Now
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] text-slate-100">
            <History size={12} className="text-amber-300" />
            <span className="telemetry">{fmtDay(timeMs)}</span>
            <span className={`telemetry text-[11px] ${offset > 0.05 ? "text-sky-300" : offset < -0.05 ? "text-amber-300" : "text-emerald-300"}`}>· {offsetLabel(offset)}</span>
          </div>
        </div>
        <span className="hud-label ml-auto hidden sm:inline">
          <Explain text="Drag through the last 30 days to replay what happened (alerts, rule firings, hazard reports, cyclone approaches, real flood episodes) and into the next 16 days to see the forecast risk. Colours on the globe and the KPIs follow the selected day.">Time machine</Explain>
        </span>
        {offset > 0.05 && climatology && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10.5px] text-amber-200" title={timeline?.forecast.note}>
            <AlertTriangle size={10} /> Forecast feed paused — showing climatology
          </span>
        )}
      </div>
      <div ref={wrap} className="relative mt-1.5 select-none" style={{ height: H }}>
        {loading && !days.length ? (
          <div className="h-full w-full animate-pulse rounded-lg bg-slate-800/50" />
        ) : (
          <svg width={w} height={H} className="block" aria-hidden>
            {/* phases */}
            <rect x={x(0)} y={chartTop - 2} width={Math.max(0, x(to) - x(0))} height={chartH + 4} fill="#38bdf8" opacity={0.04} />
            {/* event dots */}
            {days.map((d) => {
              const kinds = (Object.keys(d.counts) as (keyof typeof d.counts)[]).filter((k) => d.counts[k] > 0);
              return kinds.slice(0, 3).map((k, j) => <circle key={`${d.date}-${k}`} cx={x(d.offset)} cy={4 + j * 4.5} r={1.9} fill={KIND_COLORS[k]} opacity={0.95} />);
            })}
            {paths && (
              <>
                <path d={paths.band} fill="#38bdf8" opacity={0.12} />
                <path d={paths.past} fill="none" stroke="#fbbf24" strokeWidth={1.6} />
                <path d={paths.fut} fill="none" stroke="#38bdf8" strokeWidth={1.6} strokeDasharray="4 3" />
              </>
            )}
            {/* today */}
            <line x1={x(0)} x2={x(0)} y1={chartTop - 4} y2={H - 12} stroke="#34d399" strokeOpacity={0.7} />
            <text x={x(0) + 3} y={H - 3} fill="#34d399" fontSize={9} className="telemetry">
              TODAY
            </text>
            <text x={PADX} y={H - 3} fill="#64748b" fontSize={9} className="telemetry">
              {from}d
            </text>
            <text x={w - PADX} y={H - 3} fill="#64748b" fontSize={9} textAnchor="end" className="telemetry">
              +{to}d
            </text>
            {/* scrub handle */}
            <line x1={x(offset)} x2={x(offset)} y1={0} y2={H - 12} stroke="#fde68a" strokeWidth={1.5} />
            <circle cx={x(offset)} cy={H - 12} r={4.5} fill="#fde68a" stroke="#0b1020" strokeWidth={1.5} />
          </svg>
        )}
        <input
          type="range"
          min={from}
          max={to}
          step={0.25}
          value={offset}
          onChange={(e) => {
            setPlaying(false);
            setOffset(Number(e.target.value));
          }}
          aria-label="Time machine: day relative to today"
          aria-valuetext={`${fmtDay(timeMs)}, ${offsetLabel(offset)}`}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
      <div className="mt-0.5 flex min-h-[18px] flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400" aria-live="polite">
        {cur && total > 0 ? (
          <>
            {(Object.keys(cur.counts) as (keyof typeof cur.counts)[])
              .filter((k) => cur.counts[k] > 0)
              .map((k) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND_COLORS[k] }} />
                  {cur.counts[k]} {KIND_LABEL[k]}
                </span>
              ))}
            {cur.events[0] && <span className="min-w-0 truncate text-slate-300">— {cur.events[0].title}</span>}
          </>
        ) : cur ? (
          <span>
            Risk index {cur.risk.toFixed(0)}/100{cur.band ? ` (likely ${cur.band[0]}–${cur.band[1]})` : ""} · {cur.phase === "future" ? (climatology ? "climatology-based outlook" : "forecast") : "no recorded events this day"}
          </span>
        ) : (
          <span>Loading history…</span>
        )}
      </div>
    </div>
  );
}
