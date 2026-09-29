"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, CloudLightning, Droplet, Flame, Siren, Sun, Timer, Waves, Wind } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Explain } from "@/components/help/Explain";
import { cn } from "@/lib/utils";
import { HAZARD_META, SEVERITY_META, SLA_TARGETS, STATUSES, STATUS_META, fmtMinutes, incidentMetrics, statusIndex, type HazardType, type IncidentStatus, type Severity, type SlaClock } from "./meta";

export const HAZARD_ICON: Record<HazardType, LucideIcon> = { flood: Waves, cyclone: Wind, salinity: Droplet, drought: Sun, heat: Flame, other: CloudLightning };

/** Re-render every `ms` so SLA timers tick. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function SeverityBadge({ severity, size = "sm", explain = false }: { severity: Severity; size?: "sm" | "md"; explain?: boolean }) {
  const m = SEVERITY_META[severity];
  const pill = (
    <span className={cn("inline-flex items-center gap-1 rounded-md font-semibold telemetry tracking-wider", size === "md" ? "px-2 py-1 text-xs" : "px-1.5 py-0.5 text-[10px]")} style={{ background: `${m.color}22`, color: m.color, boxShadow: severity === "SEV1" ? `0 0 14px -4px ${m.color}` : undefined }}>
      {severity === "SEV1" && <Siren size={size === "md" ? 12 : 10} />}
      {severity}
      {size === "md" && <span className="font-normal opacity-80">· {m.short}</span>}
    </span>
  );
  return explain ? (
    <Explain title={m.label} text={<>{m.meaning} SLA: acknowledge within {fmtMinutes(SLA_TARGETS[severity].ack)}, mobilise within {fmtMinutes(SLA_TARGETS[severity].mobilise)}, resolve within {fmtMinutes(SLA_TARGETS[severity].resolve)}.</>}>
      {pill}
    </Explain>
  ) : (
    pill
  );
}

export function StatusBadge({ status }: { status: IncidentStatus }) {
  const m = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: `${m.color}55`, color: m.color, background: `${m.color}12` }} title={m.meaning}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color, boxShadow: status !== "resolved" ? `0 0 8px ${m.color}` : undefined }} />
      {m.label}
    </span>
  );
}

export function HazardChip({ hazard }: { hazard: HazardType }) {
  const Icon = HAZARD_ICON[hazard];
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[10.5px] text-slate-300">
      <Icon size={11} className="text-sky-300" />
      {HAZARD_META[hazard].label}
    </span>
  );
}

const CLOCK_STYLE: Record<SlaClock["state"], string> = {
  met: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  running: "text-sky-200 border-sky-400/30 bg-sky-400/5",
  at_risk: "text-amber-200 border-amber-400/40 bg-amber-400/10",
  breached: "text-rose-200 border-rose-500/40 bg-rose-500/10",
};

export function SlaClockChip({ clock, compact }: { clock: SlaClock; compact?: boolean }) {
  const Icon = clock.done ? (clock.state === "met" ? CheckCircle2 : AlertTriangle) : clock.state === "breached" ? AlertTriangle : Timer;
  const label = clock.key === "ack" ? "Ack" : clock.key === "mobilise" ? "Mobilise" : "Resolve";
  const value = clock.done ? fmtMinutes(clock.elapsedMin) : clock.state === "breached" ? `${fmtMinutes(-(clock.remainingMin ?? 0))} over` : `${fmtMinutes(clock.remainingMin)} left`;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 telemetry", compact ? "text-[10px]" : "text-[11px]", CLOCK_STYLE[clock.state])} title={`${clock.label}: target ${fmtMinutes(clock.targetMin)}${clock.done ? `, took ${fmtMinutes(clock.elapsedMin)}` : ""}`}>
      <Icon size={compact ? 10 : 11} className={clock.state === "breached" && !clock.done ? "animate-pulse" : undefined} />
      {!compact && <span className="opacity-70">{label}</span>}
      {value}
    </span>
  );
}

/** The clock that matters now, ticking. */
export function SlaTimer({ inc, compact }: { inc: { createdAt: Date | string; acknowledgedAt: Date | string | null; mobilisedAt: Date | string | null; resolvedAt: Date | string | null; severity: Severity }; compact?: boolean }) {
  const now = useNow(15_000);
  const m = incidentMetrics(inc, now);
  const c = m.next ?? m.clocks[2]!;
  return <SlaClockChip clock={c} compact={compact} />;
}

export function SlaPanel({ inc }: { inc: { createdAt: Date | string; acknowledgedAt: Date | string | null; mobilisedAt: Date | string | null; resolvedAt: Date | string | null; severity: Severity } }) {
  const now = useNow(15_000);
  const m = incidentMetrics(inc, now);
  return (
    <div className="grid grid-cols-3 gap-2">
      {m.clocks.map((c) => {
        const pct = Math.min(100, (c.elapsedMin / c.targetMin) * 100);
        const col = c.state === "met" ? "#34d399" : c.state === "breached" ? "#f43f5e" : c.state === "at_risk" ? "#fbbf24" : "#38bdf8";
        return (
          <div key={c.key} className="rounded-lg border border-white/5 bg-slate-950/40 p-2.5">
            <div className="hud-label flex items-center justify-between">
              <Explain text={c.key === "ack" ? "From the moment the incident opened until someone took ownership (acknowledged it or moved it forward)." : c.key === "mobilise" ? "Until the response team, money and supplies were being assembled (status reached Mobilising)." : "Until the incident was resolved."}>{c.key === "ack" ? "Time to ack" : c.key === "mobilise" ? "Time to mobilise" : "Time to resolve"}</Explain>
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="telemetry text-lg font-semibold" style={{ color: col }}>
                {fmtMinutes(c.elapsedMin)}
              </span>
              <span className="text-[10px] text-slate-500">/ {fmtMinutes(c.targetMin)}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-800">
              <motion.div className="h-full rounded-full" style={{ background: col, boxShadow: `0 0 8px ${col}` }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-[10px] capitalize" style={{ color: col }}>
              {c.done ? (c.state === "met" ? "Met SLA" : "Missed SLA") : c.state === "breached" ? "Overdue" : c.state === "at_risk" ? "At risk" : "Running"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Clickable lifecycle stepper. */
export function StatusStepper({ status, allowed, onMove, busy }: { status: IncidentStatus; allowed: IncidentStatus[]; onMove?: (to: IncidentStatus) => void; busy?: boolean }) {
  const cur = statusIndex(status);
  return (
    <ol className="flex w-full items-stretch gap-1 overflow-x-auto" aria-label="Incident status">
      {STATUSES.map((s, i) => {
        const m = STATUS_META[s];
        const active = s === status;
        const past = i < cur;
        const can = allowed.includes(s) && !!onMove;
        return (
          <li key={s} className="min-w-[92px] flex-1">
            <button
              type="button"
              disabled={!can || busy}
              onClick={() => onMove?.(s)}
              title={`${m.label}: ${m.meaning}${can ? " — click to move here" : ""}`}
              className={cn("group relative w-full overflow-hidden rounded-lg border px-2 py-1.5 text-left transition-all", active ? "border-transparent" : past ? "border-white/5 bg-white/[0.03]" : "border-white/5", can && "hover:border-white/25 hover:bg-white/[0.05]", !can && !active && "cursor-default")}
              style={active ? { background: `${m.color}1f`, boxShadow: `inset 0 0 0 1px ${m.color}88, 0 0 20px -8px ${m.color}` } : undefined}
            >
              <span className="flex items-center gap-1.5">
                <span className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold telemetry" style={{ background: active || past ? m.color : "#1e293b", color: active || past ? "#020617" : "#64748b" }}>
                  {past ? "✓" : i + 1}
                </span>
                <span className={cn("truncate text-[11.5px] font-medium", active ? "text-white" : past ? "text-slate-300" : "text-slate-500")}>{m.label}</span>
              </span>
              {active && <motion.span layoutId="stepper-glow" className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: m.color }} />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
