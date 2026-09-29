"use client";

/**
 * Shared primitives for the Insurance, Lending & Finance and Anticipatory Action
 * modules: URL-synced tabs, "What this means" panels, sliders, number fields,
 * chart tokens and formatters.
 */
import { motion } from "framer-motion";
import { AlertTriangle, CloudDownload, Lightbulb, RefreshCw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─── Chart tokens (dataviz reference palette, dark steps) ────────────────

export const VIZ = {
  s1: "#3987e5", // blue
  s2: "#d95926", // orange
  s3: "#199e70", // aqua
  s4: "#c98500", // yellow
  s5: "#d55181", // magenta
  s7: "#9085e9", // violet
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
  grid: "rgba(148,163,184,0.12)",
  axis: "#64748b",
  ink: "#e2e8f0",
  ink2: "#94a3b8",
  seq: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"],
};

export const tooltipStyle = {
  contentStyle: { background: "#0b1224", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 10, fontSize: 12, color: "#e2e8f0" },
  labelStyle: { color: "#94a3b8", fontSize: 11 },
  itemStyle: { color: "#e2e8f0" },
  cursor: { fill: "rgba(148,163,184,0.08)" },
};
export const axisProps = { stroke: VIZ.axis, fontSize: 11, tickLine: false, axisLine: false } as const;

// ─── Formatters ───────────────────────────────────────────────────────────

export function usd(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : digits)}K`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}
export const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`);
export const num = (v: number | null | undefined, digits = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }));
export const dateStr = (d: string | Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ─── Tabs synced to ?tab= (shareable links) ──────────────────────────────

export function useTab<T extends string>(tabs: readonly T[], fallback: T): [T, (t: T) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const cur = (sp.get("tab") as T) ?? fallback;
  const tab = tabs.includes(cur) ? cur : fallback;
  const set = useCallback(
    (t: T) => {
      const q = new URLSearchParams(sp.toString());
      q.set("tab", t);
      router.replace(`${path}?${q.toString()}`, { scroll: false });
    },
    [sp, router, path]
  );
  return [tab, set];
}

export function TabBar<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; icon?: React.ComponentType<{ size?: number; className?: string }>; badge?: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist">
      <div className="inline-flex min-w-full gap-1 rounded-xl border border-slate-800/80 bg-slate-950/50 p-1 md:min-w-0">
        {tabs.map((t) => {
          const active = t.value === value;
          const Icon = t.icon;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.value)}
              className={cn("relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors", active ? "text-slate-950" : "text-slate-400 hover:text-white")}
            >
              {active && <motion.span layoutId={`tabbar-${tabs.map((x) => x.value).join("")}`} className="absolute inset-0 -z-0 rounded-lg bg-cyan-400" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
              <span className="relative z-10 flex items-center gap-1.5">
                {Icon && <Icon size={14} />}
                {t.label}
                {t.badge}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Plain-language panel ─────────────────────────────────────────────────

export function WhatThisMeans({ children, className, tone = "sky" }: { children: ReactNode; className?: string; tone?: "sky" | "amber" | "rose" | "emerald" }) {
  const c = { sky: "border-sky-400/15 bg-sky-400/[0.05] text-sky-300", amber: "border-amber-400/20 bg-amber-400/[0.05] text-amber-300", rose: "border-rose-400/20 bg-rose-400/[0.05] text-rose-300", emerald: "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-300" }[tone];
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cn("rounded-xl border px-4 py-3 text-[13px] leading-relaxed text-slate-300", c.split(" ").slice(0, 2).join(" "), className)}>
      <span className={cn("hud-label mr-2 inline-flex items-center gap-1", c.split(" ")[2])}>
        <Lightbulb size={12} /> What this means
      </span>
      {children}
    </motion.div>
  );
}

// ─── Form primitives ──────────────────────────────────────────────────────

export const inputCls =
  "h-9 w-full rounded-lg border border-slate-700/80 bg-slate-950/60 px-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/15 disabled:opacity-50";

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("block", className)}>
      <div className="mb-1 flex items-center gap-1.5 text-[12px] text-slate-400">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

/** Range slider with a live value read-out. */
export function Slider({ label, value, min, max, step = 1, onChange, format, hint }: { label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[12px] text-slate-400">
        <span className="flex items-center gap-1">{label}</span>
        <span className="telemetry text-slate-100">{format ? format(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-cyan-400" aria-label={typeof label === "string" ? label : undefined} />
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

/** Number input that only commits valid numbers (keeps typing smooth). */
export function NumInput({ value, onChange, min, max, step, className, suffix, ariaLabel }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; className?: string; suffix?: string; ariaLabel?: string }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  return (
    <div className="relative">
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        className={cn(inputCls, suffix && "pr-12", className)}
        value={txt}
        onChange={(e) => {
          setTxt(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(v) && (min == null || v >= min) && (max == null || v <= max)) onChange(v);
        }}
        onBlur={() => setTxt(String(value))}
        step={step}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">{suffix}</span>}
    </div>
  );
}

export function Select<T extends string | number>({ value, onChange, options, className, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; ariaLabel?: string }) {
  return (
    <select aria-label={ariaLabel} className={cn(inputCls, "pr-7", className)} value={String(value)} onChange={(e) => onChange((typeof value === "number" ? Number(e.target.value) : e.target.value) as T)}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} className="bg-slate-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Btn({ children, variant = "primary", className, loading, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "danger" | "ghost"; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "bg-cyan-400 text-slate-950 hover:bg-cyan-300",
        variant === "outline" && "border border-slate-700 text-slate-200 hover:border-cyan-400/50 hover:text-white",
        variant === "danger" && "bg-rose-500/90 text-white hover:bg-rose-500",
        variant === "ghost" && "text-slate-300 hover:bg-white/5",
        className
      )}
    >
      {loading && <RefreshCw size={13} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Kpi({ label, value, sub, tone, help }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "bad" | "neutral"; help?: ReactNode }) {
  const c = tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : tone === "bad" ? "text-rose-300" : "text-white";
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-center gap-1 text-[11px] text-slate-400">
        {label}
        {help}
      </div>
      <div className={cn("mt-0.5 telemetry text-lg font-semibold", c)}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: { message: string } | null | undefined; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[13px] text-rose-200">
      <AlertTriangle size={14} className="shrink-0" />
      <span className="flex-1">{error.message}</span>
      {onRetry && (
        <button className="text-rose-100 underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Shown while 35-year histories are still downloading in the background. */
export function PendingHistory({ pending, total, what = "historical records" }: { pending: number; total: number; what?: string }) {
  if (!pending) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] px-3 py-2 text-[12.5px] text-cyan-100">
      <CloudDownload size={14} className="shrink-0 animate-pulse" />
      <span>
        Downloading {what} for {pending} of {total} reference locations (35-year ERA5/GloFAS reanalysis, rate-limited free tier). Figures refresh automatically; locations not yet loaded are excluded or use district baselines.
      </span>
    </div>
  );
}

export function downloadFile(filename: string, content: string, type = "text/csv") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

/** WinAnsi-safe text for jsPDF standard fonts. */
export const pdfText = (s: unknown): string =>
  String(s ?? "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/±/g, "+/-")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/×/g, "x")
    .replace(/·/g, "-")
    .replace(/[−]/g, "-")
    .replace(/[Σ]/g, "Sum")
    .replace(/[Π]/g, "Prod")
    .replace(/[λσ√]/g, (c) => ({ λ: "lambda", σ: "sigma", "√": "sqrt" })[c] ?? "")
    .replace(/[³]/g, "3")
    .replace(/°/g, " deg")
    .replace(/[^\x20-\x7E\n]/g, "");
