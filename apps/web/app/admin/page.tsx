"use client";

import Link from "next/link";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, ArrowRight, Building2, CreditCard, Cpu, Map as MapIcon, Radar, ScrollText, Sprout, Users } from "lucide-react";
import { EmptyState, Meter, Panel, SectionHeader, Skeleton, StatTile, LiveDot } from "@/components/hud";
import { ErrorNote, StatusBadge, TimeAgo, chartTooltip, fmtNum, fmtUsd } from "@/components/admin/ui";
import { ROLE_LABELS } from "@/lib/rbac";
import { trpc } from "@/lib/trpc";

const SCENARIO_LABEL: Record<string, string> = {
  live: "Live observations",
  monsoon_surge: "Monsoon surge drill",
  cyclone_landfall: "Cyclone landfall drill",
  dry_season_salinity: "Dry-season salinity drill",
};

export default function AdminOverviewPage() {
  const overview = trpc.admin.overview.useQuery(undefined, { refetchInterval: 30_000 });
  const sources = trpc.admin.sources.useQuery(undefined, { refetchInterval: 60_000 });
  const d = overview.data;

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Platform Admin"
        title="Mission Control"
        description="Platform-wide telemetry: users, revenue, alert throughput, data-source health and background jobs — all live from the system of record."
        actions={<LiveDot label={overview.isFetching ? "SYNCING" : "LIVE"} />}
      />
      <ErrorNote error={overview.error} />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {!d ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        ) : (
          <>
            <StatTile label="Users" value={d.users.total} icon={Users} accent="violet" delta={`${fmtNum(d.users.active7d)} active 7d · ${d.users.active24h} 24h`} deltaGood />
            <StatTile label="Farmers" value={d.farmers} icon={Sprout} accent="green" delta={`${d.fields} fields · ${fmtNum(d.hectares, 1)} ha`} deltaGood />
            <StatTile label="MRR" value={d.billing.mrr} prefix="$" icon={CreditCard} accent="emerald" delta={`ARR ${fmtUsd(d.billing.arr)} · ${d.billing.paying} paying`} deltaGood />
            <StatTile label="Active alerts" value={d.alerts.active} icon={AlertTriangle} accent="amber" delta={`${d.alerts.last24h} raised in 24h`} deltaGood={d.alerts.last24h === 0} />
            <StatTile label="Pending orgs" value={d.orgs.pending} icon={Building2} accent="cyan" delta={`${d.orgs.total} organisations`} deltaGood={d.orgs.pending === 0} />
            <StatTile label="Live districts" value={d.districts.live} suffix={`/${d.districts.total}`} icon={MapIcon} accent="red" delta={`${d.districts.critical} high/critical`} deltaGood={d.districts.critical === 0} />
          </>
        )}
      </div>

      {/* Health strip */}
      <Panel
        title="System health"
        subtitle={sources.data ? `${sources.data.summary.up}/${sources.data.summary.total} sources up · ${sources.data.summary.degraded} degraded · ${sources.data.summary.down} down` : "Probing open-data sources…"}
        icon={Activity}
        accent="violet"
        live
        actions={
          <Link href="/admin/data-sources" className="text-[11px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
            Details <ArrowRight size={12} />
          </Link>
        }
      >
        {!sources.data ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 13 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-40" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sources.data.sources.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-white/5 bg-slate-950/50 px-2.5 py-1.5" title={s.error ?? s.usedFor}>
                <StatusBadge status={s.status} label={s.status} />
                <span className="text-[12px] text-slate-200">{s.name}</span>
                <span className="telemetry text-[10.5px] text-slate-500">{s.latencyMs != null ? `${s.latencyMs} ms` : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Alerts per day */}
        <Panel title="Alert throughput · 30 days" subtitle="Alerts raised by source, with farmer deliveries" icon={AlertTriangle} accent="amber" className="xl:col-span-2">
          {!d ? (
            <Skeleton className="h-[260px]" />
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={d.alerts.perDay} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.06)" />
                  <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} interval={4} />
                  <YAxis yAxisId="a" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis yAxisId="d" orientation="right" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip {...chartTooltip} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} iconSize={8} />
                  <Bar yAxisId="a" dataKey="model" stackId="s" name="Model" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
                  <Bar yAxisId="a" dataKey="manual" stackId="s" name="Manual" fill="#38bdf8" />
                  <Bar yAxisId="a" dataKey="hazard" stackId="s" name="GDACS/EONET" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="d" type="monotone" dataKey="deliveries" name="Deliveries" stroke="#10b981" strokeWidth={1.8} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {d && (
            <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-slate-400">
              <span>
                30-day alerts <span className="telemetry text-slate-100">{fmtNum(d.alerts.last30d)}</span>
              </span>
              <span>
                Deliveries <span className="telemetry text-slate-100">{fmtNum(d.alerts.deliveries30d)}</span>
              </span>
              <span>
                Outbox <span className="telemetry text-slate-100">{fmtNum(d.messaging.outbox)}</span> ({d.messaging.failed} failed)
              </span>
              <span>
                Inbound SMS <span className="telemetry text-slate-100">{fmtNum(d.messaging.smsInbound)}</span>
              </span>
            </div>
          )}
        </Panel>

        {/* Users by role */}
        <Panel title="Users by role" subtitle={d ? `${d.users.suspended} suspended` : undefined} icon={Users} accent="violet">
          {!d ? (
            <Skeleton className="h-[260px]" />
          ) : (
            <div className="space-y-3 pt-1">
              {d.users.byRole.map((r) => {
                const max = Math.max(...d.users.byRole.map((x) => x.count), 1);
                return (
                  <div key={r.role}>
                    <div className="flex justify-between text-[12px] mb-1">
                      <span className="text-slate-300">{ROLE_LABELS[r.role] ?? r.role}</span>
                      <span className="telemetry text-slate-100">{r.count}</span>
                    </div>
                    <Meter value={(r.count / max) * 100} color="#8b5cf6" />
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Jobs */}
        <Panel
          title="Background jobs"
          subtitle={d ? `Scheduler: ${d.scheduler.mode} · ${d.scheduler.detail}` : undefined}
          icon={Cpu}
          accent="cyan"
          actions={
            <Link href="/admin/jobs" className="text-[11px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
              Jobs <ArrowRight size={12} />
            </Link>
          }
        >
          {!d ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="space-y-2">
              {d.jobs.map((j) => (
                <div key={j.name} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-slate-950/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-slate-100 truncate">{j.label}</div>
                    <div className="text-[10.5px] text-slate-500">
                      last <TimeAgo date={j.lastRunAt} /> · next {j.nextRunAt ? <TimeAgo date={j.nextRunAt} /> : "—"}
                    </div>
                  </div>
                  <StatusBadge status={j.running ? "running" : j.lastStatus ?? "unknown"} label={j.running ? "running" : j.lastStatus ?? "no runs"} />
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Scenario */}
        <Panel title="Data scenario" subtitle="Live observations or injected drill" icon={Radar} accent={d?.scenario.mode === "live" ? "green" : "amber"}>
          {!d ? (
            <Skeleton className="h-40" />
          ) : (
            <Link href="/admin/scenario" className="block rounded-xl border border-white/5 bg-slate-950/40 p-4 hover:border-violet-500/40 transition-colors">
              <div className="flex items-center justify-between">
                <span className="hud-label">Active mode</span>
                <StatusBadge status={d.scenario.mode === "live" ? "up" : "degraded"} label={d.scenario.mode === "live" ? "live" : "drill"} pulse />
              </div>
              <div className="mt-2 font-display text-lg text-white">{SCENARIO_LABEL[d.scenario.mode] ?? d.scenario.mode}</div>
              {d.scenario.mode !== "live" && (
                <div className="mt-2">
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>Intensity</span>
                    <span className="telemetry text-slate-200">{Math.round(d.scenario.intensity * 100)}%</span>
                  </div>
                  <Meter value={d.scenario.intensity * 100} color="#f59e0b" />
                </div>
              )}
              <div className="mt-3 text-[11px] text-slate-500">
                Set by {d.scenario.setBy} · <TimeAgo date={d.scenario.setAt} />
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Live overlay refreshed <TimeAgo date={d.liveRisk.lastRefresh} />
                {d.liveRisk.refreshing && " · refreshing…"}
              </div>
              <div className="mt-3 inline-flex items-center gap-1 text-[11px] text-violet-300">
                Open scenario control <ArrowRight size={12} />
              </div>
            </Link>
          )}
        </Panel>

        {/* Recent audit */}
        <Panel
          title="Recent activity"
          subtitle="Audit trail"
          icon={ScrollText}
          accent="violet"
          actions={
            <Link href="/admin/audit" className="text-[11px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
              All <ArrowRight size={12} />
            </Link>
          }
        >
          {!d ? (
            <Skeleton className="h-40" />
          ) : d.recentAudit.length === 0 ? (
            <EmptyState icon={ScrollText} title="No audit entries yet" />
          ) : (
            <ol className="relative space-y-3 border-l border-white/5 pl-4">
              {d.recentAudit.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.9)]" />
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="telemetry rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300">{a.action}</span>
                    <TimeAgo date={a.at} className="text-slate-500" />
                  </div>
                  <div className="mt-0.5 text-[12px] text-slate-300 line-clamp-2">
                    <span className="text-slate-100">{a.userName}</span> — {a.details}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
      {d && <div className="text-[10.5px] text-slate-600 telemetry">Demo store seeded {new Date(d.seededAt).toISOString().replace("T", " ").slice(0, 19)} UTC</div>}
    </div>
  );
}
