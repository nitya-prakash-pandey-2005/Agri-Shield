"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, BellRing, CheckCircle2, Lightbulb, ShieldCheck, Trophy } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { AnimatedNumber, EmptyState, Panel, Skeleton, SourceTag } from "@/components/hud";
import { AlertCard, AlertCardSkeleton } from "@/components/ui/AlertCard";
import { RiskStatus, SatelliteCard, WeatherToday } from "@/components/farmer/home/RiskStatus";
import { ForecastStrip } from "@/components/farmer/home/ForecastStrip";
import { FieldsGrid } from "@/components/farmer/home/FieldsGrid";
import { useMarkActioned, useTranslated } from "@/components/farmer/hooks";
import { TodayActions } from "@/components/farmer/TodayActions";

const PRIORITY_COLOR: Record<string, string> = { urgent: "#f87171", high: "#fb923c", medium: "#fbbf24", low: "#4ade80" };

function Greeting() {
  const { t, fmt } = useI18n();
  const profile = trpc.farmer.getProfile.useQuery(undefined, { retry: false });
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);
  const name = profile.data?.user?.name?.split(" ")[0] ?? "";
  const key = hour == null ? "home.greetingMorning" : hour < 12 ? "home.greetingMorning" : hour < 17 ? "home.greetingAfternoon" : "home.greetingEvening";
  if (!profile.data) return <Skeleton className="mb-5 h-14 w-72" />;
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="hud-label mb-1 text-emerald-400/80">{hour != null ? fmt.date(new Date(), { weekday: "long", day: "numeric", month: "long" }) : " "}</div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white md:text-[28px]">{t(key as "home.greetingMorning", { name })}</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          {t("home.farmLocation", { farm: profile.data.farmer.farmName, district: profile.data.district.name, country: profile.data.district.countryName })}
        </p>
      </div>
    </div>
  );
}

function ActiveAlerts() {
  const { t } = useI18n();
  const q = trpc.farmer.getAlerts.useQuery({ category: "all", includeArchived: false });
  const mark = useMarkActioned();
  const items = (q.data?.active ?? []).filter((a) => a.kind !== "advisory").slice(0, 3);
  const tr = useTranslated(items.map((a) => a.description));
  return (
    <Panel
      title={t("home.activeAlerts")}
      icon={BellRing}
      accent={items.some((a) => a.severity === "emergency") ? "red" : "amber"}
      actions={
        <Link href="/dashboard/farmer/alerts" className="inline-flex min-h-[36px] items-center gap-1 text-xs text-emerald-400 hover:underline">
          {t("nav.alerts")} <ArrowRight size={12} />
        </Link>
      }
    >
      {q.isLoading ? (
        <div className="space-y-3">
          <AlertCardSkeleton />
          <AlertCardSkeleton />
        </div>
      ) : items.length ? (
        <div className="space-y-3">
          {items.map((a, i) => (
            <AlertCard key={a.id} alert={a} index={i} description={tr.get(a.description) ?? a.description} onMarkActioned={(al, actions, note) => mark(al, actions, note)} />
          ))}
        </div>
      ) : (
        <EmptyState icon={ShieldCheck} title={t("home.noActiveAlerts")}>
          {t("home.noActiveAlertsHint")}
        </EmptyState>
      )}
    </Panel>
  );
}

function Recommendations() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const recs = trpc.farmer.getRecommendations.useQuery();
  const profile = trpc.farmer.getProfile.useQuery(undefined, { retry: false });
  const log = trpc.farmer.logFarmerAction.useMutation({
    onSuccess: (_d, v) => {
      toast.success(t("advisor.actionLogged", { action: v.actionTaken }));
      void utils.farmer.getRecommendations.invalidate();
      void utils.farmer.getProfile.invalidate();
    },
  });
  const list = (recs.data ?? []).filter((r) => r.priority !== "low").slice(0, 4);
  const tr = useTranslated(list.map((r) => r.title));
  const stats = profile.data?.stats;
  return (
    <div className="space-y-4">
      <Panel title={t("home.recommended")} icon={Lightbulb} accent="emerald">
        {recs.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ul className="space-y-2">
            {list.map((r, i) => (
              <motion.li key={r.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="rounded-lg border-l-2 bg-slate-900/60 p-2.5" style={{ borderColor: PRIORITY_COLOR[r.priority] }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-snug text-slate-100">{tr.get(r.title) ?? r.title}</div>
                    <div className="mt-0.5 text-[10px] telemetry text-slate-500">
                      {r.fieldName} · {r.generatedBy}
                    </div>
                  </div>
                  {r.done ? (
                    <CheckCircle2 size={18} className="shrink-0 text-emerald-400" aria-label={t("alerts.actioned")} />
                  ) : (
                    <button
                      onClick={() => log.mutate({ actionTaken: r.actions[0] ?? r.title, recommendationId: r.id })}
                      disabled={log.isPending}
                      className="shrink-0 rounded-md bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 active:scale-[0.97]"
                    >
                      {t("advisor.logAction")}
                    </button>
                  )}
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={t("home.impact")} icon={Trophy} accent="violet" actions={<SourceTag>Outcome loop</SourceTag>}>
        {stats ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="hud-label">{t("home.actionsLogged")}</div>
              <AnimatedNumber value={stats.actions} className="text-2xl font-semibold text-white" />
            </div>
            <div>
              <div className="hud-label">{t("home.avgCropSaved")}</div>
              {stats.avgCropSavedPct != null ? <AnimatedNumber value={stats.avgCropSavedPct} suffix="%" className="text-2xl font-semibold text-emerald-400" /> : <span className="text-2xl text-slate-600">—</span>}
            </div>
          </div>
        ) : (
          <Skeleton className="h-12 w-full" />
        )}
      </Panel>
    </div>
  );
}

export default function FarmerHome() {
  const risk = trpc.farmer.getCurrentRisk.useQuery(undefined, { refetchInterval: 10 * 60_000 });
  const weather = trpc.farmer.getWeather.useQuery(undefined, { refetchInterval: 20 * 60_000 });
  const fields = trpc.farmer.getFields.useQuery();

  return (
    <div className="mx-auto max-w-[1400px]">
      <Greeting />
      <div className="mb-4">
        <TodayActions />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RiskStatus risk={risk.data} loading={risk.isLoading} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <WeatherToday weather={weather.data} loading={weather.isLoading} />
          <SatelliteCard fields={fields.data} loading={fields.isLoading} />
        </div>
      </div>
      <div className="mt-4">
        <ForecastStrip weather={weather.data} risk={risk.data} loading={weather.isLoading} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActiveAlerts />
        </div>
        <Recommendations />
      </div>
      <div className="mt-6">
        <FieldsGrid fields={fields.data} loading={fields.isLoading} />
      </div>
    </div>
  );
}
