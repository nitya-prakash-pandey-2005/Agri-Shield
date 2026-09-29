"use client";

/**
 * Supply-chain portal primitives (navy + amber) layered on the shared HUD kit.
 */
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Copy, RefreshCw, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { INK } from "./theme";

export function ScHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="hud-label mb-1.5 flex items-center gap-2 text-amber-400/90">
          <span className="inline-block h-px w-6 bg-amber-400/70" />
          {eyebrow}
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white md:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ScButton({
  children,
  variant = "primary",
  className,
  loading,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger"; loading?: boolean }) {
  const styles = {
    primary: "bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-[0_0_24px_-8px_rgba(245,158,11,0.9)]",
    ghost: "text-slate-300 hover:bg-white/5",
    outline: "border border-slate-700/80 bg-[#0b1a33]/40 text-slate-200 hover:border-amber-500/60 hover:text-white",
    danger: "border border-rose-500/40 text-rose-300 hover:bg-rose-500/10",
  }[variant];
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        styles,
        className
      )}
    >
      {loading && <RefreshCw size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn("relative inline-flex rounded-lg border border-slate-700/70 bg-[#0b1a33]/60 p-0.5", className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={String(o.value)} role="tab" aria-selected={active} onClick={() => onChange(o.value)} className={cn("relative z-10 rounded-md px-3 py-1 text-xs telemetry transition-colors", active ? "text-slate-950" : "text-slate-400 hover:text-white")}>
            {active && <motion.span layoutId={`seg-${options.map((x) => x.value).join("-")}`} className="absolute inset-0 -z-10 rounded-md bg-amber-500" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, width = 720 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!mounted) return null;
  // Portal to <body>: the shell's animated page wrapper uses transforms, which would trap `position: fixed`.
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            className="fixed inset-y-0 right-0 z-[1001] flex w-full flex-col border-l border-amber-500/20 bg-[#070f22]/97 shadow-2xl backdrop-blur-xl"
            style={{ maxWidth: width }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36 }}
          >
            <header className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
              <div className="min-w-0">
                <div className="font-display text-lg font-semibold text-white">{title}</div>
                {subtitle && <div className="mt-0.5 text-xs text-slate-400">{subtitle}</div>}
              </div>
              <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close">
                <X size={18} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function CopyButton({ text, className, label }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
      className={cn("inline-flex items-center gap-1.5 rounded-md border border-slate-700/70 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-300 hover:border-amber-500/50 hover:text-white", className)}
      aria-label="Copy to clipboard"
    >
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.span key="ok" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}>
            <Check size={12} className="text-emerald-400" />
          </motion.span>
        ) : (
          <motion.span key="cp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Copy size={12} />
          </motion.span>
        )}
      </AnimatePresence>
      {label ?? (done ? "Copied" : "Copy")}
    </button>
  );
}

export function CodeBlock({ code, lang, maxHeight = 340 }: { code: string; lang?: string; maxHeight?: number }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-[#040914]">
      <div className="flex items-center justify-between border-b border-slate-800/80 px-3 py-1.5">
        <span className="hud-label">{lang ?? "code"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-auto p-3 text-[11.5px] leading-relaxed text-slate-300 telemetry" style={{ maxHeight }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function QueryError({ error, onRetry, what = "data" }: { error: { message: string } | null | undefined; onRetry?: () => void; what?: string }) {
  if (!error) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 text-sm text-rose-200">
      <AlertTriangle size={16} className="shrink-0 text-rose-400" />
      <span className="min-w-0 flex-1 truncate">Could not load {what}: {error.message}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs text-rose-200 underline-offset-2 hover:underline">
          Retry
        </button>
      )}
    </div>
  );
}

/** Dark tooltip body for Recharts `content`. */
export function ChartTip({ active, label, rows }: { active?: boolean; label?: ReactNode; rows: { name: string; value: ReactNode; color?: string }[] }) {
  if (!active) return null;
  return (
    <div className="rounded-lg border border-slate-700/80 bg-[#060c1c]/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {label != null && <div className="mb-1 telemetry text-[10px] uppercase tracking-wider text-slate-400">{label}</div>}
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          {r.color && <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />}
          <span style={{ color: INK.secondary }}>{r.name}</span>
          <span className="ml-auto pl-3 telemetry" style={{ color: INK.primary }}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export const axisProps = { stroke: INK.axis, tick: { fill: INK.muted, fontSize: 10, fontFamily: "var(--font-mono)" }, tickLine: false, axisLine: false } as const;

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="hud-label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-700/80 bg-[#060c1c]/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-amber-500/70 focus:ring-2 focus:ring-amber-500/15";

export function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition", active ? "border-amber-500/70 bg-amber-500/15 text-amber-100" : "border-slate-700/70 text-slate-400 hover:border-slate-500 hover:text-slate-200")}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}
