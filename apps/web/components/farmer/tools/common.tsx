"use client";

/**
 * Shared building blocks for the farmer tools: page header with back link,
 * tap-to-open help tips (jargon explained in plain words), big touch-target
 * choice chips, an offline snapshot hook (last good data in localStorage) and
 * client-side photo compression for Crop Doctor / Ask-an-expert.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, HelpCircle, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";

export const TOOLS_BASE = "/dashboard/farmer/tools";

export function ToolHeader({ icon: Icon, title, subtitle, color = "#10b981", actions }: { icon: LucideIcon; title: string; subtitle?: ReactNode; color?: string; actions?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="mb-4 flex flex-wrap items-start gap-3">
      <Link href={TOOLS_BASE} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white" aria-label={t("tools.backToTools")}>
        <ArrowLeft size={18} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${color}22` }}>
            <Icon size={15} style={{ color }} />
          </span>
          <h1 className="font-display text-xl font-semibold tracking-tight text-white md:text-2xl">{title}</h1>
        </div>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Small (?) button that opens a plain-language explanation. */
export function HelpTip({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span ref={ref} className={cn("relative inline-flex align-middle", className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="grid h-7 w-7 place-items-center rounded-full text-slate-500 hover:text-emerald-300" aria-label={title} aria-expanded={open}>
        <HelpCircle size={15} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            role="dialog"
            className="absolute left-1/2 top-8 z-[1200] w-[min(18rem,80vw)] -translate-x-1/2 rounded-xl border border-white/10 bg-[#0b1224] p-3 text-left text-xs leading-relaxed text-slate-300 shadow-2xl"
          >
            <span className="mb-1 flex items-center justify-between gap-2 font-semibold text-white">
              {title}
              <button type="button" onClick={() => setOpen(false)} className="text-slate-500 hover:text-white" aria-label="close">
                <X size={13} />
              </button>
            </span>
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export function Chip({ active, onClick, children, className, color }: { active: boolean; onClick: () => void; children: ReactNode; className?: string; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 text-sm transition-all active:scale-[0.97]",
        active ? "border-emerald-400/60 bg-emerald-500/15 text-white" : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20",
        className
      )}
      style={active && color ? { borderColor: `${color}99`, background: `${color}22` } : undefined}
    >
      {children}
    </button>
  );
}

/** Keeps the last successful data in localStorage so a tool still shows something offline. */
export function useOfflineSnapshot<T>(key: string, data: T | undefined): { data: T | undefined; fromCache: boolean; savedAt: number | null } {
  const [cached, setCached] = useState<{ data: T; at: number } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`agri-snap:${key}`);
      if (raw) setCached(JSON.parse(raw) as { data: T; at: number });
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  useEffect(() => {
    if (data === undefined) return;
    try {
      localStorage.setItem(`agri-snap:${key}`, JSON.stringify({ data, at: Date.now() }));
    } catch {
      /* quota / private mode */
    }
  }, [key, data]);
  if (data !== undefined) return { data, fromCache: false, savedAt: null };
  return { data: cached?.data, fromCache: !!cached, savedAt: cached?.at ?? null };
}

/** Resize to ≤ maxPx and JPEG-encode (≈ 60–150 kB) — enough for an officer to see the symptom. */
export async function compressImage(file: File, maxPx = 960, quality = 0.72): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, maxPx / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    let q = quality;
    let out = c.toDataURL("image/jpeg", q);
    while (out.length > 600_000 && q > 0.35) {
      q -= 0.12;
      out = c.toDataURL("image/jpeg", q);
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function CachedNote({ savedAt }: { savedAt: number | null }) {
  const { t, fmt } = useI18n();
  if (!savedAt) return null;
  return <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{t("tools.showingSaved", { time: fmt.relative(savedAt) })}</div>;
}

export const fmtDay = (fmt: ReturnType<typeof useI18n>["fmt"], iso: string, o: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) => fmt.date(`${iso}T12:00:00`, o);
