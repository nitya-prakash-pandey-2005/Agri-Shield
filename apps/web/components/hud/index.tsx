"use client";

/**
 * HUD kit — the shared visual language for every Agri-SHIELD portal.
 * Panel · StatTile · LiveDot · SourceTag · RiskPill · Skeleton · EmptyState · SectionHeader
 */
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCENTS = {
  green: "34 197 94",
  cyan: "56 189 248",
  amber: "245 158 11",
  red: "239 68 68",
  violet: "139 92 246",
  emerald: "16 185 129",
} as const;
export type Accent = keyof typeof ACCENTS;

export function Panel({
  title,
  subtitle,
  icon: Icon,
  actions,
  accent = "green",
  className,
  bodyClassName,
  children,
  live,
  sweep,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  accent?: Accent;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  live?: boolean;
  sweep?: boolean;
}) {
  return (
    <section
      className={cn("hud-panel overflow-hidden", sweep && "hud-sweep", className)}
      style={{ "--hud-accent": ACCENTS[accent] } as CSSProperties}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            {Icon && <Icon size={14} style={{ color: `rgb(${ACCENTS[accent]})` }} className="shrink-0" />}
            <div className="min-w-0">
              <h3 className="font-display text-[13px] font-semibold tracking-wide text-slate-100 truncate">{title}</h3>
              {subtitle && <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>}
            </div>
            {live && <LiveDot className="ml-1" />}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn("px-4 pb-4", !title && !actions && "pt-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function AnimatedNumber({ value, decimals = 0, prefix = "", suffix = "", className }: { value: number; decimals?: number; prefix?: string; suffix?: string; className?: string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => `${prefix}${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`);
  useEffect(() => {
    const c = animate(mv, value, { duration: 1.2, ease: [0.16, 1, 0.3, 1] });
    return c.stop;
  }, [mv, value]);
  return <motion.span className={cn("telemetry", className)}>{text}</motion.span>;
}

export function StatTile({
  label,
  value,
  decimals,
  prefix,
  suffix,
  unit,
  delta,
  deltaGood,
  icon: Icon,
  accent = "green",
  hint,
}: {
  label: string;
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  unit?: string;
  delta?: string;
  deltaGood?: boolean;
  icon?: LucideIcon;
  accent?: Accent;
  hint?: string;
}) {
  const rgb = ACCENTS[accent];
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="hud-panel p-4"
      style={{ "--hud-accent": rgb } as CSSProperties}
      title={hint}
    >
      <div className="flex items-center justify-between">
        <span className="hud-label">{label}</span>
        {Icon && (
          <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: `rgb(${rgb} / 0.12)` }}>
            <Icon size={14} style={{ color: `rgb(${rgb})` }} />
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <AnimatedNumber value={value} decimals={decimals} prefix={prefix} suffix={suffix} className="text-2xl font-semibold text-white" />
        {unit && <span className="text-xs text-slate-400">{unit}</span>}
      </div>
      {delta && (
        <div className={cn("mt-1 text-[11px] telemetry", deltaGood ? "text-emerald-400" : "text-rose-400")}>{delta}</div>
      )}
    </motion.div>
  );
}

export function LiveDot({ label = "LIVE", color = "#22c55e", className }: { label?: string; color?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] telemetry tracking-widest", className)} style={{ background: `${color}1a`, color }}>
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: color }} />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      </span>
      {label}
    </span>
  );
}

/** Small provenance tag — every number on screen should say where it came from. */
export function SourceTag({ children, href }: { children: ReactNode; href?: string }) {
  const inner = (
    <span className="inline-flex items-center gap-1 rounded border border-slate-700/60 bg-slate-900/60 px-1.5 py-0.5 text-[9.5px] telemetry uppercase tracking-wider text-slate-400">
      <span className="h-1 w-1 rounded-full bg-cyan-400" />
      {children}
    </span>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="hover:opacity-80">
      {inner}
    </a>
  ) : (
    inner
  );
}

const RISK_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  low: { bg: "rgba(34,197,94,0.12)", fg: "#4ade80", label: "LOW" },
  medium: { bg: "rgba(245,158,11,0.14)", fg: "#fbbf24", label: "MEDIUM" },
  high: { bg: "rgba(239,68,68,0.14)", fg: "#f87171", label: "HIGH" },
  critical: { bg: "rgba(139,92,246,0.18)", fg: "#a78bfa", label: "CRITICAL" },
  watch: { bg: "rgba(234,179,8,0.14)", fg: "#facc15", label: "WATCH" },
  warning: { bg: "rgba(249,115,22,0.15)", fg: "#fb923c", label: "WARNING" },
  emergency: { bg: "rgba(239,68,68,0.18)", fg: "#f87171", label: "EMERGENCY" },
};

export function RiskPill({ level, className }: { level: string; className?: string }) {
  const s = RISK_STYLE[level] ?? RISK_STYLE.low!;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold telemetry tracking-wider", className)} style={{ background: s.bg, color: s.fg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.fg }} />
      {s.label}
    </span>
  );
}

export const riskColor = (score: number) => (score >= 80 ? "#a78bfa" : score >= 60 ? "#f87171" : score >= 35 ? "#fbbf24" : "#4ade80");

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

export function EmptyState({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      {Icon && <Icon size={28} className="text-slate-600 mb-3" />}
      <div className="text-sm font-medium text-slate-300">{title}</div>
      {children && <div className="text-xs text-slate-500 mt-1 max-w-xs">{children}</div>}
    </div>
  );
}

export function SectionHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
      <div>
        {eyebrow && <div className="hud-label mb-1 text-emerald-400/80">{eyebrow}</div>}
        <h1 className="font-display text-2xl md:text-[28px] font-semibold text-white tracking-tight">{title}</h1>
        {description && <p className="text-sm text-slate-400 mt-1 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Horizontal meter bar (0-100). */
export function Meter({ value, color, className }: { value: number; color?: string; className?: string }) {
  const c = color ?? riskColor(value);
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-slate-800 overflow-hidden", className)}>
      <motion.div className="h-full rounded-full" style={{ background: c, boxShadow: `0 0 var(--t-meter-glow, 10px) ${c}` }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, Math.max(0, value))}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
    </div>
  );
}

export function HudButton({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "outline" }) {
  const styles = {
    primary: "bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-[0_0_24px_-6px_rgba(16,185,129,0.8)]",
    ghost: "text-slate-300 hover:bg-white/5",
    danger: "bg-rose-500/90 text-white hover:bg-rose-500",
    outline: "border border-slate-700 text-slate-200 hover:border-emerald-500/50 hover:text-white",
  }[variant];
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none",
        styles,
        className
      )}
    >
      {children}
    </button>
  );
}
