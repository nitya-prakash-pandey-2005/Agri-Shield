"use client";

/**
 * Government-portal UI helpers on top of the shared HUD kit:
 * formatters, dark chart styling, modal, segmented control, form classes,
 * icon/colour maps for resources, alert types, channels, severities.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Bus,
  CloudLightning,
  Droplets,
  HeartPulse,
  Mail,
  MessageCircle,
  MessageSquare,
  Package,
  Smartphone,
  Snowflake,
  Sun,
  Waves,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";

// ─── Formatters ───────────────────────────────────────────────────────────

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const fmtNum = (n: number | null | undefined) => (n == null ? "—" : Math.abs(n) >= 10_000 ? compact.format(n) : n.toLocaleString("en-US"));
export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const fmtUsd = (n: number | null | undefined) => (n == null ? "—" : `$${compact.format(n)}`);
export const fmtPct = (r: number | null | undefined, dp = 0) => (r == null ? "—" : `${(r * 100).toFixed(dp)}%`);
export const ago = (d: Date | string | null | undefined) => (d ? `${formatDistanceToNowStrict(new Date(d))} ago` : "—");
export const until = (d: Date | string) => formatDistanceToNowStrict(new Date(d));
export const hhmm = (d: Date | string) => new Date(d).toISOString().slice(11, 16);
export const dateShort = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
export const dateTime = (d: Date | string) =>
  new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

// ─── Charts (Recharts dark styling) ───────────────────────────────────────

export const CHART = {
  grid: "#1e293b",
  axis: { fill: "#64748b", fontSize: 10, fontFamily: "var(--font-mono), monospace" },
  emerald: "#10b981",
  cyan: "#38bdf8",
  amber: "#f59e0b",
  rose: "#f43f5e",
  violet: "#a78bfa",
  slate: "#475569",
  series: ["#10b981", "#38bdf8", "#f59e0b", "#a78bfa", "#f43f5e", "#22d3ee", "#84cc16"],
};

interface TipPayload {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: TipPayload[];
  label?: string | number;
  format?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#070c1a]/95 px-3 py-2 shadow-2xl backdrop-blur-md">
      {label !== undefined && <div className="hud-label mb-1 text-slate-300">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px]">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}</span>
          <span className="ml-auto pl-3 telemetry text-slate-100">
            {typeof p.value === "number" ? (format ? format(p.value, String(p.name)) : p.value.toLocaleString("en-US")) : String(p.value ?? "—")}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "max-w-2xl",
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: string;
  footer?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!mounted) return null;
  // Portal to <body> so transformed ancestors (drawers, motion panels) can't clip the overlay
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center p-0 sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn("hud-panel relative w-full max-h-[92vh] flex flex-col", width)}
            initial={{ y: 24, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 16, scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <header className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
              <div>
                <h2 className="font-display text-base font-semibold text-white">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
              </div>
              <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close">
                <X size={16} />
              </button>
            </header>
            <div className="overflow-y-auto px-5 py-4">{children}</div>
            {footer && <footer className="flex items-center justify-end gap-2 border-t border-white/5 px-5 py-3">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ─── Segmented control ────────────────────────────────────────────────────

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  className,
  layoutId,
}: {
  options: { value: T; label: ReactNode; icon?: LucideIcon }[];
  value: T;
  onChange: (v: T) => void;
  size?: "xs" | "sm";
  className?: string;
  layoutId?: string;
}) {
  return (
    <div className={cn("inline-flex flex-wrap gap-0.5 rounded-lg border border-white/10 bg-[#060a16]/80 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-md telemetry uppercase tracking-wider transition-colors",
              size === "xs" ? "px-2 py-1 text-[9.5px]" : "px-2.5 py-1.5 text-[10.5px]",
              active ? "text-slate-950" : "text-slate-400 hover:text-white"
            )}
          >
            {active && <motion.span layoutId={layoutId ?? "seg"} className="absolute inset-0 rounded-md bg-emerald-400" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
            {Icon && <Icon size={12} className="relative" />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Forms ────────────────────────────────────────────────────────────────

export const inputCls =
  "w-full rounded-lg border border-white/10 bg-[#060a16]/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/15";
export const selectCls = inputCls + " appearance-none cursor-pointer";

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="hud-label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ error, className }: { error: { message: string } | null | undefined; className?: string }) {
  if (!error) return null;
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300", className)}>
      <AlertTriangle size={14} /> {error.message}
    </div>
  );
}

// ─── Icon & colour maps ───────────────────────────────────────────────────

export const RESOURCE_ICON: Record<string, LucideIcon> = { pumps: Wrench, sandbags: Package, evacuation_buses: Bus, medical: HeartPulse, food_aid: Package };
export const RESOURCE_COLOR: Record<string, string> = { pumps: "#38bdf8", sandbags: "#f59e0b", evacuation_buses: "#a78bfa", medical: "#f43f5e", food_aid: "#10b981" };
export const ALERT_ICON: Record<string, LucideIcon> = { flood: Waves, salinity: Droplets, drought: Sun, storm: CloudLightning, frost: Snowflake };
export const ALERT_LABEL: Record<string, string> = { flood: "Flood", salinity: "Salinity", drought: "Dry spell", storm: "Cyclone / storm", frost: "Cold wave" };
export const CHANNEL_ICON: Record<string, LucideIcon> = { app: Smartphone, sms: MessageSquare, whatsapp: MessageCircle, email: Mail };
export const CHANNEL_LABEL: Record<string, string> = { app: "App push", sms: "SMS", whatsapp: "WhatsApp", email: "Email" };
export const SEVERITY_COLOR: Record<string, string> = { watch: "#facc15", warning: "#fb923c", emergency: "#f87171" };
export const STATUS_COLOR: Record<string, string> = { pending: "#facc15", approved: "#38bdf8", dispatched: "#a78bfa", delivered: "#10b981", rejected: "#f43f5e", modified: "#94a3b8" };
export const HAZARD_COLOR: Record<string, string> = { flood: "#38bdf8", cyclone: "#c084fc", storm: "#a78bfa", drought: "#f59e0b", other: "#94a3b8" };

/** Map colour ramps */
export const ramp = {
  risk: (v: number) => (v >= 80 ? "#a78bfa" : v >= 60 ? "#f87171" : v >= 35 ? "#fbbf24" : "#4ade80"),
  salinity: (v: number) => (v >= 80 ? "#e879f9" : v >= 60 ? "#f472b6" : v >= 35 ? "#fb923c" : "#67e8f9"),
  density: (v: number, max: number) => {
    const t = Math.min(1, v / Math.max(1, max));
    const stops = ["#0f766e", "#14b8a6", "#5eead4", "#fde68a", "#f59e0b"];
    return stops[Math.min(stops.length - 1, Math.floor(t * stops.length))]!;
  },
  coverage: (pct: number) => (pct >= 90 ? "#10b981" : pct >= 60 ? "#84cc16" : pct >= 35 ? "#f59e0b" : "#ef4444"),
  history: (v: number, max: number) => {
    const t = Math.min(1, v / Math.max(1, max));
    return t > 0.8 ? "#dc2626" : t > 0.6 ? "#f97316" : t > 0.4 ? "#f59e0b" : t > 0.2 ? "#a3a3a3" : "#525252";
  },
};

export function Pill({ children, color = "#94a3b8", className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold telemetry uppercase tracking-wider", className)} style={{ background: `${color}1f`, color }}>
      {children}
    </span>
  );
}

export function KeyValue({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 text-xs", className)}>
      <span className="text-slate-400">{k}</span>
      <span className="telemetry text-slate-100 text-right">{v}</span>
    </div>
  );
}
