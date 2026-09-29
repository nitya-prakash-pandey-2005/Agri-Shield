"use client";

/**
 * Planting & season planner — crop calendar for the farmer's country, 6-month
 * seasonal outlook (Open-Meteo / ECMWF SEAS5: rain & temperature anomaly), best
 * sowing window with reasons, expected harvest and stress-tolerant varieties.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CalendarDays, CheckCircle2, Info, Sprout, Sun, Wheat } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { EmptyState, Panel, Skeleton, SourceTag } from "@/components/hud";
import { CropIcon } from "@/components/farmer/crops";
import { useTranslated } from "@/components/farmer/hooks";
import { CachedNote, Chip, HelpTip, ToolHeader, fmtDay, useOfflineSnapshot } from "@/components/farmer/tools/common";

type Data = RouterOutputs["farmer"]["seasonPlanner"];
const MONTHS = Array.from({ length: 12 }, (_, i) => i);

function CalendarStrip({ plans, bestId }: { plans: Data["plans"]; bestId: string | null }) {
  const { t, fmt } = useI18n();
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const span = 365 * 86_400_000;
  const pos = (iso: string) => Math.max(0, Math.min(100, ((Date.parse(`${iso}T00:00:00Z`) - start.getTime()) / span) * 100));
  return (
    <div>
      <div className="relative grid grid-cols-12 text-center text-[10px] text-slate-500">
        {MONTHS.map((i) => {
          const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
          return (
            <div key={i} className="border-l border-white/5 py-1">
              {fmt.date(d, { month: "short" })}
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        {plans.map((p) => (
          <div key={p.season.id} className="relative h-9 rounded-lg bg-white/[0.03]">
            <div className="absolute inset-y-1 rounded-md bg-emerald-500/25" style={{ left: `${pos(p.windowFrom)}%`, width: `${Math.max(1.5, pos(p.windowTo) - pos(p.windowFrom))}%` }} title={t("tools.plan.window")} />
            <div className={cn("absolute inset-y-1 rounded-md", p.season.id === bestId ? "bg-emerald-400" : "bg-emerald-400/60")} style={{ left: `${pos(p.bestFrom)}%`, width: `${Math.max(1.2, pos(p.bestTo) - pos(p.bestFrom))}%` }} />
            {p.harvestFrom && pos(p.harvestFrom) < 100 && <div className="absolute inset-y-1 rounded-md bg-amber-400/70" style={{ left: `${pos(p.harvestFrom)}%`, width: `${Math.max(1.2, pos(p.harvestTo ?? p.harvestFrom) - pos(p.harvestFrom))}%` }} />}
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-white drop-shadow">{p.season.name}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-emerald-500/25" /> {t("tools.plan.window")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-emerald-400" /> {t("tools.plan.bestDates")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-amber-400/70" /> {t("tools.plan.harvest")}</span>
      </div>
    </div>
  );
}

function OutlookChart({ months }: { months: Data["outlook"] }) {
  const { t, fmt } = useI18n();
  const rows = months.map((m) => ({ m: fmt.date(`${m.month}-15T12:00:00`, { month: "short" }), rain: m.rainMm, normal: m.rainNormalMm, anom: m.tempAnomalyC }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 0, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis dataKey="m" tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <YAxis yAxisId="mm" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis yAxisId="t" orientation="right" tick={{ fill: "#94a3b8", fontSize: 10 }} width={34} domain={[-2, 3]} />
          <Tooltip contentStyle={{ background: "#0b1224", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="mm" dataKey="normal" name={t("tools.plan.normalRain")} fill="#334155" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar yAxisId="mm" dataKey="rain" name={t("tools.plan.forecastRain")} fill="#38bdf8" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Line yAxisId="t" dataKey="anom" name={t("tools.plan.tempAnomaly")} stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PlannerPage() {
  const { t, tx, fmt } = useI18n();
  const [crop, setCrop] = useState<string | undefined>(undefined);
  const q = trpc.farmer.seasonPlanner.useQuery(crop ? { crop } : undefined, { staleTime: 60 * 60_000 });
  const snap = useOfflineSnapshot(`planner:${crop ?? "own"}`, q.data);
  const data = snap.data;
  const best = data?.plans.find((p) => p.season.id === data.bestSeasonId) ?? data?.plans[0];
  const reasons = best?.reasons.map((r) => r.text) ?? [];
  const varietiesFor = data?.varieties.find((v) => v.seasonId === best?.season.id)?.list ?? [];
  const tr = useTranslated([...reasons, ...varietiesFor.map((v) => v.note), ...(data?.plans.flatMap((p) => p.reasons.map((r) => r.text)) ?? [])]);

  return (
    <div className="mx-auto max-w-5xl">
      <ToolHeader icon={CalendarDays} color="#a3e635" title={t("tools.plan.title")} subtitle={t("tools.plan.subtitle")} />
      {snap.fromCache && <CachedNote savedAt={snap.savedAt} />}
      {data && (
        <div className="mb-4 flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {data.crops.map((c) => (
            <Chip key={c} active={c === data.crop} onClick={() => setCrop(c)}>
              <CropIcon crop={c} size={16} /> {tx(`crops.${c}`, undefined, c)}
              {data.ownCrops.includes(c) && <span className="text-[10px] text-emerald-300">★</span>}
            </Chip>
          ))}
        </div>
      )}
      {!data ? (
        q.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        ) : (
          <EmptyState icon={CalendarDays} title={t("common.errorLoad")}>{t("tools.tryAgainLater")}</EmptyState>
        )
      ) : !best ? (
        <EmptyState icon={CalendarDays} title={t("tools.plan.noWindow")}>{t("tools.plan.noWindowHint")}</EmptyState>
      ) : (
        <div className="space-y-4">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-lime-400/40 bg-gradient-to-br from-lime-500/15 to-transparent p-4">
            <div className="hud-label mb-1 text-lime-300">{t("tools.plan.bestWindow")} · {best.season.name}</div>
            {best.season.perennialYears ? (
              <div className="font-display text-lg font-semibold text-white md:text-xl">{t("tools.plan.plantBetween", { from: fmtDay(fmt, best.bestFrom, { day: "numeric", month: "long" }), to: fmtDay(fmt, best.bestTo, { day: "numeric", month: "long", year: "numeric" }) })}</div>
            ) : (
              <>
                <div className="font-display text-lg font-semibold text-white md:text-xl">{t("tools.plan.sowBetween", { from: fmtDay(fmt, best.bestFrom, { day: "numeric", month: "long" }), to: fmtDay(fmt, best.bestTo, { day: "numeric", month: "long", year: "numeric" }) })}</div>
                {best.harvestFrom && <div className="mt-1 text-sm text-slate-300">{t("tools.plan.expectHarvest", { from: fmtDay(fmt, best.harvestFrom, { day: "numeric", month: "short" }), to: fmtDay(fmt, best.harvestTo ?? best.harvestFrom, { day: "numeric", month: "short", year: "numeric" }), days: best.season.fieldDays })}</div>}
              </>
            )}
            {best.season.perennialYears && <div className="mt-1 text-sm text-slate-300">{t("tools.plan.firstHarvestYears", { years: best.season.perennialYears })}</div>}
            <ul className="mt-3 space-y-1.5">
              {best.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  {r.tone === "warn" ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" /> : r.tone === "good" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" /> : <Info size={16} className="mt-0.5 shrink-0 text-sky-400" />}
                  <span className="text-slate-200">{tr.get(r.text) ?? r.text}</span>
                </li>
              ))}
            </ul>
            {data.currentFields.length > 0 && (
              <div className="mt-3 text-xs text-slate-400">
                {t("tools.plan.currentCrop", { field: data.currentFields[0]!.name, date: fmtDay(fmt, data.currentFields[0]!.harvestDate, { day: "numeric", month: "long" }) })}
              </div>
            )}
          </motion.div>

          <Panel title={t("tools.plan.calendar")} subtitle={t("tools.plan.calendarHint")} icon={CalendarDays} accent="emerald">
            <CalendarStrip plans={data.plans} bestId={data.bestSeasonId} />
            <div className="mt-2"><SourceTag>{data.calendarSource}</SourceTag></div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-5">
            <Panel
              className="lg:col-span-3"
              title={t("tools.plan.outlook")}
              subtitle={t("tools.plan.outlookHint")}
              icon={Sun}
              accent="amber"
              actions={
                <>
                  <HelpTip title={t("tools.plan.outlook")}>{t("tools.plan.outlookHelp")}</HelpTip>
                  <SourceTag href="https://open-meteo.com/en/docs/seasonal-forecast-api">{data.outlookSource ?? "—"}</SourceTag>
                </>
              }
            >
              {data.outlook.length ? (
                <>
                  <OutlookChart months={data.outlook} />
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {data.outlook.map((m) => (
                      <div key={m.month} className="rounded-lg bg-white/[0.03] p-2 text-center">
                        <div className="text-[10px] text-slate-500">{fmt.date(`${m.month}-15T12:00:00`, { month: "short" })}</div>
                        <div className={cn("text-sm font-semibold", m.rainAnomalyPct == null ? "text-slate-400" : m.rainAnomalyPct <= -20 ? "text-amber-300" : m.rainAnomalyPct >= 20 ? "text-sky-300" : "text-emerald-300")}>
                          {m.rainAnomalyPct == null ? "—" : `${m.rainAnomalyPct > 0 ? "+" : ""}${m.rainAnomalyPct}%`}
                        </div>
                        <div className="text-[10px] text-orange-300">{m.tempAnomalyC != null ? `${m.tempAnomalyC > 0 ? "+" : ""}${m.tempAnomalyC}°C` : ""}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">{t("tools.weatherUnavailable")}</p>
              )}
            </Panel>

            <Panel className="lg:col-span-2" title={t("tools.plan.varieties")} subtitle={t("tools.plan.varietiesHint")} icon={Wheat} accent="green">
              {varietiesFor.length ? (
                <ul className="space-y-2">
                  {varietiesFor.map((v) => (
                    <li key={v.name} className="rounded-lg border border-white/5 bg-white/[0.03] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-white">{v.name}</span>
                        <span className="text-[10px] telemetry text-slate-500">{t("tools.plan.days", { days: v.durationDays })}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {v.tolerances.map((tol) => (
                          <span key={tol} className={cn("rounded px-1.5 py-0.5 text-[10px]", v.matched.includes(tol) ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-800 text-slate-400")}>
                            {tx(`tools.tol.${tol}`)}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{tr.get(v.note) ?? v.note}</p>
                      <div className="mt-1 text-[10px] text-slate-600">{v.source}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">{t("tools.plan.noVarieties")}</p>
              )}
            </Panel>
          </div>

          {data.plans.length > 1 && (
            <Panel title={t("tools.plan.allSeasons")} icon={Sprout} accent="emerald">
              <div className="grid gap-3 md:grid-cols-2">
                {data.plans.map((p) => (
                  <div key={p.season.id} className={cn("rounded-xl border p-3", p.season.id === data.bestSeasonId ? "border-lime-400/40 bg-lime-500/5" : "border-white/5 bg-white/[0.02]")}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">{p.season.name}</span>
                      <span className={cn("rounded px-2 py-0.5 text-[10px]", p.status === "open" ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-800 text-slate-300")}>{p.status === "open" ? t("tools.plan.openNow") : t("tools.plan.inDays", { days: p.daysUntil })}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {fmtDay(fmt, p.windowFrom, { day: "numeric", month: "short" })} – {fmtDay(fmt, p.windowTo, { day: "numeric", month: "short" })}
                      {p.harvestFrom && <> · {t("tools.plan.harvest")}: {fmtDay(fmt, p.harvestFrom, { day: "numeric", month: "short" })}</>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{tr.get(p.reasons[p.reasons.length - 1]?.text ?? "") ?? p.reasons[p.reasons.length - 1]?.text}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
