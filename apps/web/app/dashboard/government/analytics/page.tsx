"use client";

import { Bell, MessageSquare, PiggyBank, Sprout, ClipboardCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SectionHeader, Skeleton, SourceTag, StatTile } from "@/components/hud";
import { useGovInput } from "@/components/government/scope";
import { ErrorNote } from "@/components/government/ui";
import { HotspotPanel, RainfallAnomalyPanel, ResponseRateCharts, SeasonLossChart, UtilisationHeatmap } from "@/components/government/analytics-charts";
import { ReportBuilder } from "@/components/government/analytics-report";

export default function GovAnalyticsPage() {
  const scope = useGovInput();
  const q = trpc.government.getAnalytics.useQuery(scope);
  const ctx = trpc.government.getContext.useQuery(scope);
  const t = q.data?.totals;

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Analytics & reporting"
        title="Impact of early warning"
        description={`Season-over-season outcomes, farmer response, resource utilisation and flood hotspots${ctx.data ? ` for ${ctx.data.orgName}` : ""}. Every figure is computed from the alert archive, delivery receipts and farmer outcome reports.`}
        actions={
          <>
            <SourceTag>Agri-SHIELD registry</SourceTag>
            <SourceTag>ERA5</SourceTag>
          </>
        }
      />
      <ErrorNote error={q.error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {t ? (
          <>
            <StatTile label="Alerts · 12 months" value={t.alerts12m} icon={Bell} accent="amber" />
            <StatTile label="Messages sent · 12 months" value={t.sent12m} icon={MessageSquare} accent="cyan" />
            <StatTile label="Crop loss avoided" value={t.avoidedUsd / 1e6} decimals={1} prefix="$" suffix="M" icon={PiggyBank} accent="emerald" hint="Sum over seasons of (loss without EW − loss with EW)" />
            <StatTile label="Avg crop saved" value={t.avgCropSavedPct} decimals={1} suffix="%" icon={Sprout} accent="green" hint="Mean crop-saved % across farmer outcome reports" />
            <StatTile label="Outcome reports" value={t.outcomeSamples} icon={ClipboardCheck} accent="violet" hint="Farmer actions linked to alerts in this jurisdiction" />
          </>
        ) : (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[92px]" />)
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr,340px]">
        {q.data ? <SeasonLossChart data={q.data.seasons} /> : <Skeleton className="h-[360px]" />}
        <ReportBuilder />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {q.data ? <ResponseRateCharts data={q.data.weekly} /> : <Skeleton className="h-[380px]" />}
        {q.data ? <UtilisationHeatmap data={q.data.heatmap} types={q.data.resourceTypes} /> : <Skeleton className="h-[380px]" />}
      </div>

      {q.data ? <HotspotPanel trend={q.data.hotspotTrend} hotspots={q.data.hotspots} districtNames={q.data.districtNames} /> : <Skeleton className="h-[340px]" />}

      <RainfallAnomalyPanel districts={ctx.data?.districts ?? []} />
    </div>
  );
}
