"use client";

/**
 * Workspace (cyan) primitives for the portfolio / alerts module, layered on the HUD kit.
 */
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, HelpCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function PfButton({
  children,
  variant = "primary",
  size = "md",
  className,
  loading,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" | "subtle"; size?: "sm" | "md"; loading?: boolean }) {
  const styles = {
    primary: "bg-sky-400 text-slate-950 hover:bg-sky-300 shadow-[0_0_24px_-8px_rgba(56,189,248,0.9)]",
    ghost: "text-slate-300 hover:bg-white/5",
    outline: "border border-slate-700/80 bg-slate-900/40 text-slate-200 hover:border-sky-400/60 hover:text-white",
    danger: "border border-rose-500/40 text-rose-300 hover:bg-rose-500/10",
    subtle: "bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        styles,
        className
      )}
    >
      {loading && <RefreshCw size={size === "sm" ? 12 : 14} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Chip({ active, onClick, children, color, className, title }: { active?: boolean; onClick?: () => void; children: ReactNode; color?: string; className?: string; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
        active ? "border-sky-400/60 bg-sky-400/10 text-white" : "border-slate-700/70 text-slate-400 hover:border-slate-500 hover:text-slate-200",
        className
      )}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode; count?: number }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn("inline-flex flex-wrap rounded-lg border border-slate-700/70 bg-slate-900/50 p-0.5", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("relative rounded-md px-3 py-1.5 text-xs font-medium transition-colors", value === o.value ? "text-slate-950" : "text-slate-400 hover:text-white")}
        >
          {value === o.value && <motion.span layoutId={`seg-${options.map((x) => x.value).join("")}`} className="absolute inset-0 rounded-md bg-sky-400" transition={{ type: "spring", stiffness: 450, damping: 36 }} />}
          <span className="relative inline-flex items-center gap-1.5">
            {o.label}
            {o.count !== undefined && <span className={cn("telemetry rounded px-1 text-[10px]", value === o.value ? "bg-slate-950/20" : "bg-white/5")}>{o.count}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-400/70 focus:outline-none focus:ring-1 focus:ring-sky-400/40";

export function Field({ label, hint, children, className, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; error?: string | null }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[11px] text-rose-400">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

/** Inline plain-language help (hover / focus / tap). */
export function Help({ text, className }: { text: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span ref={ref} className={cn("relative inline-flex align-middle", className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="Explain" onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className="text-slate-500 hover:text-sky-300">
        <HelpCircle size={12} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute bottom-full left-1/2 z-[1200] mb-2 w-64 -translate-x-1/2 rounded-lg border border-sky-400/30 bg-[#081225] p-2.5 text-left text-[11px] font-normal normal-case leading-relaxed tracking-normal text-slate-300 shadow-xl"
          >
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: 30, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className={cn("hud-panel flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl", wide ? "sm:max-w-4xl" : "sm:max-w-xl")}
            style={{ ["--hud-accent" as string]: "56 189 248" }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-white">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
              </div>
              <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/5 px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function QueryError({ error, onRetry }: { error: { message: string } | null | undefined; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
      <AlertTriangle size={14} />
      <span className="min-w-0 flex-1">{error.message}</span>
      {onRetry && (
        <button onClick={onRetry} className="underline underline-offset-2 hover:text-white">
          Retry
        </button>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40", checked ? "bg-sky-400" : "bg-slate-700")}
    >
      <motion.span layout className={cn("h-4 w-4 rounded-full bg-white shadow", checked ? "ml-[18px]" : "ml-0.5")} transition={{ type: "spring", stiffness: 600, damping: 35 }} />
    </button>
  );
}

export function TagPill({ tag, color, onRemove }: { tag: string; color?: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-700/70 bg-slate-900/60 px-1.5 py-0.5 text-[10px] text-slate-300">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color ?? "#38bdf8" }} />
      {tag}
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-slate-500 hover:text-rose-300" aria-label={`Remove ${tag}`}>
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export function PageTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="hud-label mb-1.5 flex items-center gap-2 text-sky-300/90">
          <span className="inline-block h-px w-6 bg-sky-400/70" />
          {eyebrow}
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white md:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
