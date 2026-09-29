"use client";

import { useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Activity, BarChart3, Gauge, ListOrdered } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import { EmptyState, Panel, Skeleton, SourceTag, StatTile } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { cn } from "@/lib/utils";
import { METHOD_TONE } from "./ApiExplorer";

/** Categorical slots (dark-surface steps of the validated reference palette), fixed order. */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"];
const OTHER = "#64748b";

export function UsagePanel() {
  const [days, setDays] = useState(14);
  const q = trpc.developer.usage.useQuery({ days }, { refetchInterval: 30_000 });
  const d = q.data;

  // Colour follows the key (stable id order), never its rank
  const { chart, legend } = useMemo(() => {
    if (!d) return { chart: [], legend: [] as { id: string; name: string; color: string; total: number }[] };
    const active = d.keys.filter((k) => k.total > 0);
    const stable = [...active].sort((a, b) => a.keyId.localeCompare(b.keyId));
    const shown = stable.slice(0, SERIES.length);
    const rest = stable.slice(SERIES.length);
    const legend = [...shown.map((k, i) => ({ id: k.keyId, name: k.name, color: SERIES[i]!, total: k.total })), ...(rest.length ? [{ id: "__other", name: `Other (${rest.length})`, color: OTHER, total: rest.reduce((a, k) => a + k.total, 0) }] : [])];
    const chart = d.days.map((date, i) => {
      const row: Record<string, number | string> = { date: date.slice(5) };
      for (const k of shown) row[k.keyId] = k.points[i]!.calls;
      if (rest.length) row.__other = rest.reduce((a, k) => a + k.points[i]!.calls, 0);
      return row;
    });
    return { chart, legend };
  }, [d]);

  if (!d) return <Skeleton className="h-96" />;
  const errRate = d.totals.calls ? (d.totals.errors / d.totals.calls) * 100 : 0;
  const metered = d.orgApiCalls.reduce((a, r) => a + r.apiCalls, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[12.5px] text-slate-400">
          <b className="text-slate-200">What this means:</b> how much your systems use the API, per key and per day, how fast it answers and how often calls fail. Recorded since this server started.
        </p>
        <div className="flex gap-1 rounded-lg bg-slate-900/70 p-1" role="group" aria-label="Time range">
          {[7, 14, 30].map((n) => (
            <button key={n} onClick={() => setDays(n)} className={cn("rounded-md px-2.5 py-1 text-[12px]", days === n ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:text-white")}>
              {n} days
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Requests" value={d.totals.calls} icon={Activity} accent="cyan" hint="Calls recorded for this workspace in the selected range" />
        <StatTile label="Error rate" value={errRate} decimals={1} suffix="%" icon={Gauge} accent={errRate > 5 ? "red" : "green"} hint="Share of calls answered with 4xx/5xx or no response" />
        <StatTile label="p95 latency" value={d.totals.p95 ?? 0} unit="ms" icon={BarChart3} accent="violet" hint="95% of timed calls finished faster than this" />
        <StatTile label="Billed API calls" value={metered} icon={ListOrdered} accent="amber" hint="Keyed calls counted against your plan's API-call limit" />
      </div>

      <Panel
        title={
          <span className="flex items-center gap-1.5">
            Requests per day by API key <Explain text="Each bar is one day; each coloured segment is one key. Up to four keys get their own colour, the rest are grouped as Other." />
          </span>
        }
        accent="cyan"
        actions={<SourceTag>API explorer + REST metering</SourceTag>}
      >
        {d.totals.calls === 0 ? (
          <EmptyState icon={BarChart3} title="No API calls recorded yet">
            Send a request from the Explorer tab (or call /api/v1 with a key) and it will appear here within seconds.
          </EmptyState>
        ) : (
          <>
            <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-300" aria-label="Legend">
              {legend.map((l) => (
                <li key={l.id} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
                  {l.name} <span className="telemetry text-slate-500">{l.total}</span>
                </li>
              ))}
            </ul>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 6, right: 4, left: -18, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.1)" />
                  <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "rgba(148,163,184,0.2)" }} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(56,189,248,0.06)" }}
                    contentStyle={{ background: "#0b1325", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: "#e2e8f0" }}
                    itemStyle={{ color: "#cbd5e1" }}
                    formatter={(v: number, k: string) => [v, legend.find((l) => l.id === k)?.name ?? k]}
                  />
                  {legend.map((l, i) => (
                    <Bar key={l.id} dataKey={l.id} stackId="k" fill={l.color} stroke="#0b1325" strokeWidth={1} radius={i === legend.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={28} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Per key" accent="violet">
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[440px] text-[12.5px]">
              <thead className="hud-label text-left text-slate-500">
                <tr>
                  <th className="py-1.5 font-normal">Key</th>
                  <th className="py-1.5 text-right font-normal">Calls</th>
                  <th className="py-1.5 text-right font-normal">Errors</th>
                  <th className="py-1.5 text-right font-normal">p50</th>
                  <th className="py-1.5 text-right font-normal">p95</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {d.keys.map((k) => (
                  <tr key={k.keyId} className={cn(k.revoked && "opacity-50")}>
                    <td className="py-1.5">
                      <div className="text-slate-200">{k.name}</div>
                      {k.prefix && <div className="telemetry text-[10.5px] text-slate-500">{k.prefix}…</div>}
                    </td>
                    <td className="telemetry py-1.5 text-right text-slate-200">{k.total}</td>
                    <td className={cn("telemetry py-1.5 text-right", k.errors ? "text-amber-300" : "text-slate-500")}>{k.errors}</td>
                    <td className="telemetry py-1.5 text-right text-slate-400">{k.p50 !== null ? `${k.p50} ms` : "—"}</td>
                    <td className="telemetry py-1.5 text-right text-slate-400">{k.p95 !== null ? `${k.p95} ms` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Endpoints & recent calls" accent="emerald">
          {d.endpoints.length === 0 ? (
            <p className="text-[12.5px] text-slate-500">No calls yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.endpoints.slice(0, 6).map((e) => (
                <li key={`${e.method} ${e.path}`} className="flex items-center gap-2 text-[12px]">
                  <span className={cn("telemetry w-11 shrink-0 rounded px-1 py-0.5 text-center text-[10px]", METHOD_TONE[e.method])}>{e.method}</span>
                  <span className="telemetry min-w-0 flex-1 truncate text-slate-300">{e.path}</span>
                  <span className="telemetry text-slate-400">{e.calls}×</span>
                  {e.p95 !== null && <span className="telemetry w-24 shrink-0 whitespace-nowrap text-right text-slate-500">p95 {e.p95} ms</span>}
                </li>
              ))}
            </ul>
          )}
          {d.recent.length > 0 && (
            <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto border-t border-white/5 pt-3">
              {d.recent.slice(0, 15).map((c) => (
                <li key={c.id} className="telemetry flex items-center gap-2 text-[11px]">
                  <span className={cn("w-9 shrink-0 text-center", c.status === null ? "text-slate-500" : c.status < 300 ? "text-emerald-300" : c.status < 500 ? "text-amber-300" : "text-rose-300")}>{c.status ?? "—"}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-400">{c.path}</span>
                  <span className="hidden text-slate-500 sm:inline">{c.keyName ?? "anonymous"}</span>
                  <span className="w-16 text-right text-slate-500">{c.ms !== null ? `${c.ms}ms` : c.source}</span>
                  <span className="w-20 text-right text-slate-600">{formatDistanceToNowStrict(new Date(c.at))}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
