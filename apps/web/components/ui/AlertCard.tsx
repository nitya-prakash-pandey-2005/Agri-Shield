"use client";

/**
 * AlertCard (spec §8): 4px severity border, type icon in coloured circle,
 * live countdown, slide-in from the right, pulse on emergency, and a
 * 3-tap action flow (Take action → tick actions → Confirm).
 * Backward compatible: `alert` accepts the shared ClimateAlert type, and
 * `onAction(alertId)` / `onDismiss` / `compact` behave as before.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  CloudLightning,
  Droplets,
  ExternalLink,
  Lightbulb,
  Loader2,
  Snowflake,
  Sun,
  Waves,
  Wind,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";

export interface AlertCardData {
  id: string;
  alertType: string;
  severity: "watch" | "warning" | "emergency" | string;
  title: string;
  description: string;
  recommendedActions?: string[];
  validUntil: Date | string;
  kind?: "alert" | "advisory" | "hazard";
  category?: string;
  probability?: number | null;
  farmsAffected?: number | null;
  source?: string;
  actioned?: boolean;
  fieldName?: string | null;
  distanceKm?: number | null;
  url?: string | null;
}

interface AlertCardProps {
  alert: AlertCardData;
  onAction?: (alertId: string) => void;
  onDismiss?: (alertId: string) => void;
  /** 3-tap flow: called with the ticked actions on confirm */
  onMarkActioned?: (alert: AlertCardData, actions: string[], note?: string) => Promise<unknown> | void;
  compact?: boolean;
  className?: string;
  /** translated description (falls back to alert.description) */
  description?: string;
  /** extra content under the description (translation toggle, impact text…) */
  children?: React.ReactNode;
  showNote?: boolean;
  index?: number;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  flood: Waves,
  salinity: Droplets,
  drought: Sun,
  storm: Wind,
  cyclone: CloudLightning,
  frost: Snowflake,
};

export const SEVERITY_COLOR: Record<string, string> = {
  emergency: "#ef4444",
  warning: "#f97316",
  watch: "#eab308",
};

function useCountdown(until: Date | string) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now == null) return null;
  return new Date(until).getTime() - now;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function AlertCard({ alert, onAction, onDismiss, onMarkActioned, compact = false, className, description, children, showNote = false, index = 0 }: AlertCardProps) {
  const { t, tx, fmt } = useI18n();
  const color = SEVERITY_COLOR[alert.severity] ?? SEVERITY_COLOR.watch!;
  const Icon = alert.kind === "advisory" || alert.category === "advisory" ? Lightbulb : TYPE_ICON[alert.alertType] ?? AlertTriangle;
  const remaining = useCountdown(alert.validUntil);
  const actions = alert.recommendedActions ?? [];
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(!!alert.actioned);
  useEffect(() => setDone(!!alert.actioned), [alert.actioned]);

  const typeLabel = alert.kind === "advisory" ? t("alertType.advisory") : tx(`alertType.${alert.alertType}`, undefined, alert.alertType);
  const sevLabel = tx(`severity.${alert.severity}`, undefined, alert.severity);

  let timeText: string;
  let urgent = false;
  if (remaining == null) timeText = "—";
  else if (alert.kind === "hazard") timeText = t("alerts.ongoing");
  else if (remaining <= 0) timeText = t("alerts.expired");
  else {
    const h = Math.floor(remaining / 3_600_000);
    const m = Math.floor((remaining % 3_600_000) / 60_000);
    const s = Math.floor((remaining % 60_000) / 1000);
    urgent = remaining < 12 * 3_600_000;
    timeText = t("alerts.remaining", { time: h >= 48 ? fmt.duration(remaining) : `${pad(h)}:${pad(m)}:${pad(s)}` });
  }

  const confirm = async () => {
    if (!onMarkActioned) return;
    setBusy(true);
    try {
      await onMarkActioned(alert, picked, note || undefined);
      setDone(true);
      setStep(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ type: "spring", stiffness: 320, damping: 30, delay: Math.min(index, 6) * 0.05 }}
      whileHover={{ scale: 1.005 }}
      className={cn("relative overflow-hidden rounded-xl border bg-slate-950/60 backdrop-blur", className)}
      style={{ borderColor: `${color}40`, borderLeft: `4px solid ${color}`, boxShadow: alert.severity === "emergency" && !done ? `0 0 28px -10px ${color}` : undefined }}
      aria-label={`${sevLabel} ${typeLabel}: ${alert.title}`}
    >
      {alert.severity === "emergency" && !done && (
        <span className="absolute top-2.5 right-2.5 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: color }} />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        </span>
      )}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}40` }}>
            <Icon size={18} style={{ color }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider telemetry" style={{ background: `${color}22`, color }}>
                {sevLabel}
              </span>
              <span className="rounded-md bg-slate-800/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300 telemetry">{typeLabel}</span>
              {alert.fieldName && <span className="text-[10px] text-slate-500 telemetry truncate">· {alert.fieldName}</span>}
              {done && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400 telemetry">
                  <Check size={10} /> {t("alerts.actioned")}
                </span>
              )}
            </div>
            <h4 className="text-[15px] font-semibold leading-snug text-white">{alert.title}</h4>
            {!compact && <p className="mt-1 text-sm leading-relaxed text-slate-400">{description ?? alert.description}</p>}
            {!compact && children}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-400">
              <span className={cn("inline-flex items-center gap-1.5 telemetry", urgent && remaining! > 0 && "text-rose-300")}>
                <Clock size={12} />
                {timeText}
              </span>
              {alert.probability != null && alert.kind !== "advisory" && <span className="telemetry">{t("alerts.probability", { pct: Math.round(alert.probability * 100) })}</span>}
              {alert.farmsAffected != null && alert.farmsAffected > 0 && <span className="telemetry">{t("alerts.farmsInArea", { count: fmt.number(alert.farmsAffected) })}</span>}
              {alert.distanceKm != null && <span className="telemetry">{t("alerts.distanceAway", { km: alert.distanceKm })}</span>}
              {alert.source && <span className="telemetry text-slate-500">{t("alerts.issuedBy", { source: alert.source })}</span>}
              {alert.url && (
                <a href={alert.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:underline">
                  <ExternalLink size={11} /> GDACS
                </a>
              )}
            </div>
          </div>
          {onDismiss && (
            <button onClick={() => onDismiss(alert.id)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-slate-200" aria-label={t("common.close")}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* 3-tap action flow */}
        {!compact && onMarkActioned && !done && (
          <div className="mt-3">
            <AnimatePresence initial={false} mode="wait">
              {step === 0 ? (
                <motion.button
                  key="start"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    setStep(1);
                    setPicked([]);
                  }}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors"
                  style={{ background: `${color}22`, color, boxShadow: `inset 0 0 0 1px ${color}55` }}
                >
                  {t("alerts.takeAction")} <ChevronRight size={16} />
                </motion.button>
              ) : (
                <motion.div key="flow" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <ol className="mb-2 flex items-center gap-2 text-[10px] telemetry uppercase tracking-wider">
                    {[t("alerts.stepReview"), t("alerts.stepChoose"), t("alerts.stepConfirm")].map((s, i) => (
                      <li key={s} className={cn("flex items-center gap-1.5", i <= step ? "text-emerald-400" : "text-slate-600")}>
                        <span className={cn("grid h-4 w-4 place-items-center rounded-full border text-[9px]", i <= step ? "border-emerald-400" : "border-slate-600")}>{i + 1}</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                  <p className="mb-2 text-xs text-slate-400">{t("alerts.selectDone")}</p>
                  <ul className="space-y-1.5">
                    {actions.map((a) => {
                      const on = picked.includes(a);
                      return (
                        <li key={a}>
                          <button
                            onClick={() => {
                              setPicked((p) => (on ? p.filter((x) => x !== a) : [...p, a]));
                              setStep(2);
                            }}
                            role="checkbox"
                            aria-checked={on}
                            className={cn("flex min-h-[44px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors", on ? "border-emerald-500/50 bg-emerald-500/10 text-white" : "border-slate-700/70 text-slate-300 hover:border-slate-500")}
                          >
                            <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border", on ? "border-emerald-400 bg-emerald-500 text-slate-950" : "border-slate-600")}>{on && <Check size={13} strokeWidth={3} />}</span>
                            {a}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {showNote && (
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value.slice(0, 500))}
                      placeholder={t("alerts.addNote")}
                      rows={2}
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
                    />
                  )}
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => setStep(0)} className="min-h-[44px] rounded-lg px-4 text-sm text-slate-400 hover:bg-white/5">
                      {t("common.cancel")}
                    </button>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      disabled={busy}
                      onClick={confirm}
                      className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                      {picked.length ? t("alerts.confirmActions", { count: picked.length }) : t("alerts.markActioned")}
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {!onMarkActioned && onAction && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAction(alert.id);
            }}
            className="mt-3 inline-flex min-h-[40px] items-center gap-1 rounded-lg px-3 text-xs font-semibold"
            style={{ background: `${color}20`, color }}
          >
            {t("alerts.takeAction")} <ChevronRight size={12} />
          </button>
        )}
      </div>
    </motion.article>
  );
}

export function AlertCardSkeleton() {
  return (
    <div className="rounded-xl border border-white/5 border-l-4 border-l-slate-700 bg-slate-950/40 p-4">
      <div className="flex items-start gap-3">
        <div className="skeleton h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <div className="skeleton h-4 w-16 rounded" />
            <div className="skeleton h-4 w-14 rounded" />
          </div>
          <div className="skeleton h-4 w-3/4 rounded" />
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-2/3 rounded" />
        </div>
      </div>
    </div>
  );
}

export default AlertCard;
