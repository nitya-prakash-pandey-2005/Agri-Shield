"use client";

/**
 * Admin-panel building blocks on top of the HUD kit: status badges, dense
 * data tables, filter controls, relative time and number formatting.
 */
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─── Formatting ───────────────────────────────────────────────────────────

export const fmtNum = (n: number | null | undefined, d = 0) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtUsd = (n: number | null | undefined, d = 0) => (n == null ? "—" : `$${fmtNum(n, d)}`);
export const fmtMs = (ms: number | null | undefined) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
export const fmtPct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);

export function relTime(date: Date | string | null | undefined, now = Date.now()): string {
  if (!date) return "never";
  const t = new Date(date).getTime();
  const s = Math.round((now - t) / 1000);
  const future = s < 0;
  const a = Math.abs(s);
  const txt = a < 45 ? `${a}s` : a < 3600 ? `${Math.round(a / 60)}m` : a < 86_400 ? `${Math.round(a / 3600)}h` : `${Math.round(a / 86_400)}d`;
  return future ? `in ${txt}` : `${txt} ago`;
}

/** Relative time that ticks every 15 s; full UTC timestamp on hover. */
export function TimeAgo({ date, className }: { date: Date | string | null | undefined; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className={cn("telemetry", className)} title={date ? new Date(date).toISOString().replace("T", " ").slice(0, 19) + " UTC" : undefined} suppressHydrationWarning>
      {relTime(date, now)}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────

const STATUS: Record<string, { fg: string; bg: string }> = {
  up: { fg: "#4ade80", bg: "rgba(34,197,94,0.12)" },
  ok: { fg: "#4ade80", bg: "rgba(34,197,94,0.12)" },
  operational: { fg: "#4ade80", bg: "rgba(34,197,94,0.12)" },
  success: { fg: "#4ade80", bg: "rgba(34,197,94,0.12)" },
  active: { fg: "#4ade80", bg: "rgba(34,197,94,0.12)" },
  verified: { fg: "#4ade80", bg: "rgba(34,197,94,0.12)" },
  sent: { fg: "#4ade80", bg: "rgba(34,197,94,0.12)" },
  stable: { fg: "#4ade80", bg: "rgba(34,197,94,0.12)" },
  delivered: { fg: "#4ade80", bg: "rgba(34,197,94,0.12)" },
  degraded: { fg: "#fbbf24", bg: "rgba(245,158,11,0.14)" },
  partial: { fg: "#fbbf24", bg: "rgba(245,158,11,0.14)" },
  pending: { fg: "#fbbf24", bg: "rgba(245,158,11,0.14)" },
  trialing: { fg: "#38bdf8", bg: "rgba(56,189,248,0.12)" },
  moderate: { fg: "#fbbf24", bg: "rgba(245,158,11,0.14)" },
  simulated: { fg: "#38bdf8", bg: "rgba(56,189,248,0.12)" },
  running: { fg: "#a78bfa", bg: "rgba(139,92,246,0.16)" },
  skipped: { fg: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
  unknown: { fg: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
  offline: { fg: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
  cancelled: { fg: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
  pending_verification: { fg: "#fbbf24", bg: "rgba(245,158,11,0.14)" },
  down: { fg: "#f87171", bg: "rgba(239,68,68,0.14)" },
  failed: { fg: "#f87171", bg: "rgba(239,68,68,0.14)" },
  suspended: { fg: "#f87171", bg: "rgba(239,68,68,0.14)" },
  rejected: { fg: "#f87171", bg: "rgba(239,68,68,0.14)" },
  past_due: { fg: "#f87171", bg: "rgba(239,68,68,0.14)" },
  significant: { fg: "#f87171", bg: "rgba(239,68,68,0.14)" },
  dead: { fg: "#f87171", bg: "rgba(239,68,68,0.14)" },
  major_outage: { fg: "#f87171", bg: "rgba(239,68,68,0.14)" },
};

export function StatusBadge({ status, label, pulse, className }: { status: string; label?: string; pulse?: boolean; className?: string }) {
  const s = STATUS[status] ?? STATUS.unknown!;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold telemetry uppercase tracking-wider whitespace-nowrap", className)} style={{ background: s.bg, color: s.fg }}>
      <span className="relative flex h-1.5 w-1.5">
        {(pulse || status === "running") && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: s.fg }} />}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: s.fg }} />
      </span>
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────

export function DataTable({ head, children, className, empty }: { head: ReactNode[]; children: ReactNode; className?: string; empty?: ReactNode }) {
  return (
    <div className={cn("overflow-x-auto -mx-4 px-4", className)}>
      <table className="w-full min-w-[640px] text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-white/5">
            {head.map((h, i) => (
              <th key={i} className="hud-label py-2 pr-3 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Td({ children, className, mono, title }: { children: ReactNode; className?: string; mono?: boolean; title?: string }) {
  return (
    <td className={cn("py-2.5 pr-3 align-middle text-slate-300", mono && "telemetry text-[11.5px]", className)} title={title}>
      {children}
    </td>
  );
}

// ─── Controls ─────────────────────────────────────────────────────────────

export function SearchInput({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn("h-9 w-full sm:w-64 rounded-lg border border-slate-700/70 bg-slate-950/60 px-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30", className)}
    />
  );
}

export function Select<T extends string>({ value, onChange, options, className, label }: { value: T | ""; onChange: (v: T | "") => void; options: { value: T | ""; label: string }[]; className?: string; label?: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T | "")}
      className={cn("h-9 rounded-lg border border-slate-700/70 bg-slate-950/60 px-2.5 text-sm text-slate-100 outline-none focus:border-violet-500/60", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-slate-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40", checked ? "border-violet-400/60 bg-violet-500/80 shadow-[0_0_14px_-2px_rgba(139,92,246,0.8)]" : "border-slate-700 bg-slate-800")}
    >
      <span className={cn("absolute top-0.5 h-4.5 w-[18px] h-[18px] rounded-full bg-white transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

export function KV({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12.5px] border-b border-white/[0.04] last:border-0">
      <span className="text-slate-400">{k}</span>
      <span className={cn("text-slate-100 text-right", mono && "telemetry")}>{v}</span>
    </div>
  );
}

export function ErrorNote({ error }: { error: { message: string } | null | undefined }) {
  if (!error) return null;
  return <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error.message}</div>;
}

/** Recharts tooltip styled for the HUD. */
export const chartTooltip = {
  contentStyle: { background: "rgba(7,12,26,0.95)", border: "1px solid rgba(139,92,246,0.35)", borderRadius: 10, fontSize: 12, color: "#e2e8f0" },
  labelStyle: { color: "#94a3b8", fontSize: 11 },
  itemStyle: { color: "#e2e8f0" },
  cursor: { fill: "rgba(139,92,246,0.08)" },
};
