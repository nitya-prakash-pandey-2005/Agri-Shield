"use client";

/** Small form primitives shared by Settings, Reports and the invite page. */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const inputCls =
  "h-10 w-full rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/15 disabled:opacity-50";

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-center gap-1.5 text-[13px] text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40", checked ? "bg-cyan-500" : "bg-slate-700")}
    >
      <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}

export function Btn({ children, variant = "primary", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "danger" | "ghost" }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "bg-cyan-400 text-slate-950 hover:bg-cyan-300",
        variant === "outline" && "border border-slate-700 text-slate-200 hover:border-cyan-400/50 hover:text-white",
        variant === "danger" && "bg-rose-500/90 text-white hover:bg-rose-500",
        variant === "ghost" && "text-slate-300 hover:bg-white/5",
        className
      )}
    >
      {children}
    </button>
  );
}

export function downloadBlob(filename: string, content: string | Blob, type = "application/octet-stream") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(columns: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}

/** Accessible modal rendered in a portal (escapes transformed ancestors). */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[150] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }} className={cn("hud-panel max-h-[90vh] w-full overflow-y-auto p-5", wide ? "max-w-2xl" : "max-w-md")} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-lg font-semibold text-white">{title}</h3>
              <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="mt-3">{children}</div>
            {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
