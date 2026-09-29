"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, BellOff, CheckCircle2, Languages, Radar } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { EmptyState, Panel, SectionHeader, Skeleton, SourceTag } from "@/components/hud";
import { AlertCard, AlertCardSkeleton, SEVERITY_COLOR } from "@/components/ui/AlertCard";
import { useMarkActioned, useTranslated, type FarmerAlert } from "@/components/farmer/hooks";

const FILTERS = ["all", "flood", "salinity", "weather", "advisory"] as const;
type Filter = (typeof FILTERS)[number];

function Translated({ a, get, pending, active }: { a: FarmerAlert; get: (s: string) => string | null; pending: boolean; active: boolean }) {
  const { t } = useI18n();
  const [orig, setOrig] = useState(false);
  const tr = get(a.description);
  const impactKey = a.category === "flood" ? "alerts.impactFlood" : a.category === "salinity" ? "alerts.impactSalinity" : a.category === "advisory" ? "alerts.impactAdvisory" : "alerts.impactWeather";
  return (
    <div className="mt-2 space-y-2">
      <div className="rounded-lg bg-slate-900/70 p-2.5">
        <div className="hud-label mb-0.5">{t("alerts.whatItMeans")}</div>
        <p className="text-[13px] text-slate-300">{t(impactKey as "alerts.impactFlood")}</p>
      </div>
      {active && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Languages size={12} />
          {pending && !tr ? (
            t("alerts.translating")
          ) : tr && tr !== a.description ? (
            <>
              <span>{t("alerts.translated")}</span>
              <button onClick={() => setOrig((o) => !o)} className="text-cyan-400 hover:underline">
                {orig ? t("alerts.showTranslation") : t("alerts.showOriginal")}
              </button>
            </>
          ) : null}
        </div>
      )}
      {orig && <p className="text-xs italic text-slate-500">{a.description}</p>}
    </div>
  );
}

export default function FarmerAlertsPage() {
  const { t, tx, fmt } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const q = trpc.farmer.getAlerts.useQuery({ category: filter, includeArchived: true }, { refetchInterval: 60_000 });
  const mark = useMarkActioned();
  const active = q.data?.active ?? [];
  const archived = q.data?.archived ?? [];
  const tr = useTranslated(active.map((a) => a.description).concat(active.map((a) => a.title)));

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHeader
        eyebrow={t("nav.alerts")}
        title={t("alerts.title")}
        description={q.data ? t("alerts.subtitle", { district: q.data.district.name }) : undefined}
        actions={<SourceTag>GDACS · NASA EONET · Model</SourceTag>}
      />

      {/* Filters */}
      <div role="tablist" aria-label="Alert filters" className="-mx-3 mb-4 flex gap-2 overflow-x-auto px-3 no-scrollbar">
        {FILTERS.map((f) => {
          const on = f === filter;
          const count = q.data?.counts[f];
          return (
            <button
              key={f}
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(f)}
              className={cn("relative flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-4 text-sm transition-colors", on ? "border-emerald-500/60 text-white" : "border-slate-700/70 text-slate-400 hover:text-slate-200")}
            >
              {on && <motion.span layoutId="alert-filter" className="absolute inset-0 rounded-full bg-emerald-500/15" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
              <span className="relative">{f === "all" ? t("alerts.filterAll") : tx(`alertType.${f}`)}</span>
              {count != null && count > 0 && <span className="relative rounded-full bg-slate-800 px-1.5 text-[10px] telemetry">{count}</span>}
            </button>
          );
        })}
      </div>

      <section aria-labelledby="active-alerts">
        <h2 id="active-alerts" className="mb-2 flex items-center gap-2 hud-label">
          <Radar size={12} className="text-rose-400" /> {t("alerts.active")}
        </h2>
        {q.isLoading ? (
          <div className="space-y-3">
            <AlertCardSkeleton />
            <AlertCardSkeleton />
            <AlertCardSkeleton />
          </div>
        ) : active.length ? (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {active.map((a, i) => (
                <AlertCard
                  key={a.id}
                  alert={{ ...a, title: tr.get(a.title) ?? a.title }}
                  index={i}
                  description={tr.get(a.description) ?? a.description}
                  onMarkActioned={(al, actions, note) => mark(al, actions, note)}
                  showNote
                >
                  <Translated a={a} get={tr.get} pending={tr.pending} active={tr.active} />
                  {a.actioned && a.myAction && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-xs text-emerald-200">
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                      <span>
                        <b>{t("alerts.yourAction")}:</b> {a.myAction.actionTaken} · <span className="telemetry text-emerald-400/70">{fmt.relative(a.myAction.actionDate)}</span>
                      </span>
                    </div>
                  )}
                </AlertCard>
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <Panel>
            <EmptyState icon={BellOff} title={t("alerts.noAlerts")}>
              {t("home.noActiveAlertsHint")}
            </EmptyState>
          </Panel>
        )}
      </section>

      <section aria-labelledby="archived-alerts" className="mt-8">
        <h2 id="archived-alerts" className="mb-2 flex items-center gap-2 hud-label">
          <Archive size={12} /> {t("alerts.archived")}
        </h2>
        {q.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : archived.length ? (
          <Panel bodyClassName="p-0" className="overflow-hidden">
            <ul className="divide-y divide-white/5">
              {archived.map((a, i) => {
                const color = SEVERITY_COLOR[a.severity] ?? "#64748b";
                return (
                  <motion.li key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 10) * 0.03 }} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm text-slate-200">
                        <span className="truncate">{a.title}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] telemetry text-slate-500">
                        <span>{fmt.date(a.createdAt)}</span>
                        <span>{tx(`severity.${a.severity}`)}</span>
                        {a.probability != null && <span>{Math.round(a.probability * 100)}%</span>}
                      </div>
                      {a.myAction ? (
                        <div className="mt-1 text-xs text-emerald-300">
                          {t("alerts.yourAction")}: {a.myAction.actionTaken}
                          {a.myAction.outcome && <> · {t("alerts.outcome")}: {a.myAction.outcome}</>}
                          {a.myAction.cropSavedPct != null && <> · {t("alerts.cropSaved", { pct: a.myAction.cropSavedPct })}</>}
                        </div>
                      ) : null}
                    </div>
                    {a.districtActionRate != null && (
                      <div className="shrink-0 max-w-[110px] text-right text-[10px] leading-tight text-slate-400 telemetry">{t("alerts.districtResponse", { pct: Math.round(a.districtActionRate * 100) })}</div>
                    )}
                  </motion.li>
                );
              })}
            </ul>
          </Panel>
        ) : (
          <Panel>
            <EmptyState icon={Archive} title={t("alerts.noAlerts")} />
          </Panel>
        )}
      </section>
    </div>
  );
}
