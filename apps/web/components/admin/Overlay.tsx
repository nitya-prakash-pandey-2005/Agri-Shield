"use client";

/**
 * Admin overlays + small primitives: Modal (centered dialog), Drawer (right
 * side sheet), TabBar, and CSV export helper.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer, className }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  useEsc(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn("hud-panel w-full max-w-md", className)}
            style={{ "--hud-accent": "139 92 246" } as React.CSSProperties}
            initial={{ y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h3 className="font-display text-sm font-semibold text-white">{title}</h3>
              <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200">
                <X size={16} />
              </button>
            </div>
            <div className="px-4 pb-4 text-sm text-slate-300">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-white/5 px-4 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEsc(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[60] bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            className="fixed inset-y-0 right-0 z-[61] w-full max-w-md overflow-y-auto border-l border-violet-500/20 bg-[#070c1a] shadow-2xl"
            initial={{ x: 480 }}
            animate={{ x: 0 }}
            exit={{ x: 480 }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-white/5 bg-[#070c1a]/95 px-4 backdrop-blur">
              <div className="font-display text-sm font-semibold text-white truncate">{title}</div>
              <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200">
                <X size={18} />
              </button>
            </div>
            <div className="p-4">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function TabBar<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-white/5 bg-slate-950/50 p-1" role="tablist">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn("relative rounded-lg px-3 py-1.5 text-[12.5px] transition-colors", active ? "text-white" : "text-slate-400 hover:text-slate-200")}
          >
            {active && <motion.span layoutId={`tab-${tabs.map((x) => x.value).join("-")}`} className="absolute inset-0 rounded-lg bg-violet-500/15 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.4)]" />}
            <span className="relative">
              {t.label}
              {t.count !== undefined && <span className="ml-1.5 telemetry text-[10.5px] text-slate-500">{t.count}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Client-side CSV download of plain row objects. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms, setV]);
  return v;
}


/** Masks the middle digits of a phone/identifier: +8801711****00 */
export function maskMiddle(s: string): string {
  if (/^\+?\d{8,}$/.test(s.replace(/^whatsapp:/, ""))) {
    const x = s.replace(/^whatsapp:/, "");
    return `${x.slice(0, Math.max(4, x.length - 6))}****${x.slice(-2)}`;
  }
  if (s.includes("@")) {
    const [u, d] = s.split("@");
    return `${u!.slice(0, 2)}***@${d}`;
  }
  return s.length > 10 ? `${s.slice(0, 6)}…${s.slice(-3)}` : s;
}
