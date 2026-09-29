"use client";

/**
 * Live trigger monitor — every active parametric product × reference location:
 * season-to-date index vs trigger, 15-day ensemble forecast and the conditional-
 * climatology probability of paying out this season, rolled up to book liability.
 */
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Radar } from "lucide-react";
import { EmptyState, Meter, Panel, Skeleton, SourceTag, StatTile } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { axisProps, dateStr, ErrorBox, num, PendingHistory, pct, tooltipStyle, usd, VIZ, WhatThisMeans } from "./kit";

type Mon = RouterOutputs["insurance"]["monitor"];
type Row = Mon["rows"][number];

const STATUS: Record<string, { label: string; cls: string }> = {
  in_season: { label: "In season", cls: "bg-cyan-400/15 text-cyan-300" },
  upcoming: { label: "Not started", cls: "bg-slate-500/15 text-slate-300" },
  closed: { label: "Season closed", cls: "bg-violet-500/15 text-violet-300" },
};

export default function Monitor() {
  const mon = trpc.insurance.monitor.useQuery(undefined, { refetchInterval: (q) => ((q.state.data?.totals.pending ?? 0) > 0 ? 8000 : 5 * 60_000) });
  const [sel, setSel] = useState<number>(0);
  const d = mon.data;
  const row = d?.rows[sel];
  if (mon.isLoading)
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
        <Skeleton className="col-span-full h-80" />
      </div>
    );
  if (!d) return <ErrorBox error={mon.error} onRetry={() => mon.refetch()} />;
  if (!d.rows.length)
    return (
      <Panel>
        <EmptyState icon={Radar} title="No parametric plots to monitor">
          Design a product in the Designer tab, then “Save & attach” it to insured plots — they appear here with live trigger probabilities.
        </EmptyState>
      </Panel>
    );
  const top = d.rows.filter((r) => r.outlook && r.outlook.probabilityPct >= 50);
  return (
    <div className="space-y-4">
      <PendingHistory pending={d.totals.pending} total={d.totals.cells} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Sum insured under index cover" value={d.totals.sumInsuredUsd / 1e6} decimals={1} prefix="$" suffix="M" accent="cyan" delta={`${d.totals.plots} insured units · ${d.totals.cells} reference locations`} deltaGood />
        <StatTile label="Expected payout this season" value={d.totals.expectedPayoutUsd / 1e3} decimals={1} prefix="$" suffix="k" accent="amber" delta={`${pct((d.totals.expectedPayoutUsd / Math.max(1, d.totals.sumInsuredUsd)) * 100, 1)} of sum insured`} deltaGood={d.totals.expectedPayoutUsd === 0} />
        <StatTile label="P90 liability" value={d.totals.p90PayoutUsd / 1e3} decimals={1} prefix="$" suffix="k" accent="red" delta="1-in-10 bad outcome for the book" deltaGood={false} />
        <StatTile label="Locations ≥ 50% payout chance" value={top.length} accent="violet" delta={`of ${d.rows.length} product × location cells`} deltaGood={!top.length} />
      </div>

      <WhatThisMeans tone={top.length ? "amber" : "sky"}>
        {d.byProduct.map((p, i) => (
          <span key={p.id}>
            {i > 0 && " "}
            <b className="text-white">{p.name}</b> ({p.seasonLabel}): {usd(p.sumInsuredUsd)} insured on {p.plots} plots, a <b className="text-white">{pct(p.weightedProbPct, 0)}</b> exposure-weighted chance of paying this season and an expected liability of <b className="text-amber-200">{usd(p.expectedPayoutUsd)}</b>.
          </span>
        ))}{" "}
        Probabilities combine what has already been observed this season with the next 15 days of the {d.rows.find((r) => r.outlook)?.outlook?.forecastModel ?? "forecast"} and, for the rest of the season, how each of the past 30+ years played out. Reserve for the P90 figure if you want a 1-in-10 buffer.
      </WhatThisMeans>

      <div className="grid gap-4 2xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Trigger watch" subtitle="Click a row for the season chart" icon={Activity} accent="cyan" live bodyClassName="px-0 pb-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12.5px]">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 font-medium">Location · product</th>
                  <th className="py-2 font-medium">Index to date vs trigger</th>
                  <th className="py-2 text-right font-medium">P(payout)</th>
                  <th className="px-4 py-2 text-right font-medium">Expected</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r, i) => {
                  const o = r.outlook;
                  const p = d.byProduct.find((x) => x.id === r.productId)!;
                  const above = p.meta.direction === "above";
                  const prog = o?.indexToDate == null ? 0 : above ? (o.indexToDate / r.trigger) * 100 : ((r.trigger * 1.6 - o.indexToDate) / (r.trigger * 0.6)) * 100;
                  return (
                    <tr key={`${r.productId}-${i}`} onClick={() => setSel(i)} className={cn("cursor-pointer border-b border-slate-800/60 hover:bg-white/[0.03]", sel === i && "bg-cyan-400/[0.06]")}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5 text-slate-200">
                          {r.region}
                          {o ? <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS[o.status]!.cls)}>{STATUS[o.status]!.label}</span> : <span className="text-[11px] text-slate-500">loading…</span>}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {r.productName} · {r.plots} plots · {usd(r.sumInsuredUsd)}
                        </div>
                      </td>
                      <td className="w-[30%] py-2 pr-3">
                        {o && (
                          <>
                            <div className="flex justify-between text-[11px] text-slate-400">
                              <span className="telemetry text-slate-200">
                                {num(o.indexToDate, 0)} {p.meta.unit}
                              </span>
                              <span>
                                {above ? "≥" : "≤"} {num(r.trigger, 0)}
                              </span>
                            </div>
                            <Meter value={Math.min(100, Math.max(0, prog))} color={o.probabilityPct >= 50 ? VIZ.serious : VIZ.s1} />
                          </>
                        )}
                      </td>
                      <td className="py-2 text-right telemetry text-slate-100">{o ? pct(o.probabilityPct, 0) : "—"}</td>
                      <td className="px-4 py-2 text-right telemetry text-amber-200">{usd(r.expectedPayoutUsd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        {row && <SeasonChart row={row} mon={d} />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <SourceTag href="https://open-meteo.com/en/docs/historical-weather-api">ERA5 reanalysis</SourceTag>
        <SourceTag href="https://open-meteo.com/en/docs/ensemble-api">ECMWF IFS ENS 51 members</SourceTag>
        <SourceTag href="https://open-meteo.com/en/docs/flood-api">GloFAS v4</SourceTag>
        <SourceTag>updated {new Date(d.generatedAt).toLocaleTimeString()}</SourceTag>
      </div>
    </div>
  );
}

function SeasonChart({ row, mon }: { row: Row; mon: Mon }) {
  const p = mon.byProduct.find((x) => x.id === row.productId)!;
  const o = row.outlook;
  const data = useMemo(() => {
    if (!o) return [];
    const s = p.spec;
    const out: { date: string; observed: number | null; forecast: number | null }[] = [];
    let cum = 0;
    let run = 0;
    const win: number[] = [];
    o.series.forEach((pt, i) => {
      const v = pt.value ?? 0;
      let idx: number;
      if (s.indexType === "rain_max_nday") {
        win.push(v);
        if (win.length > s.windowDays) win.shift();
        idx = win.reduce((a, b) => a + b, 0);
      } else if (s.indexType === "rain_total") idx = cum += v;
      else if (s.indexType === "dry_spell") idx = run = v < s.dryDayMm ? run + 1 : 0;
      else if (s.indexType === "heat_days") idx = cum += v >= s.heatThresholdC ? 1 : 0;
      else idx = v;
      const obs = pt.kind === "observed";
      const nextFc = o.series[i + 1]?.kind === "forecast";
      out.push({ date: pt.date, observed: obs ? Math.round(idx * 10) / 10 : null, forecast: !obs || nextFc ? Math.round(idx * 10) / 10 : null });
    });
    return out;
  }, [o, p.spec]);
  const label = { rain_max_nday: `Rolling ${p.spec.windowDays}-day rain (mm)`, rain_total: "Cumulative season rain (mm)", discharge_max: "River discharge (m³/s)", dry_spell: "Current dry-spell length (days)", heat_days: `Days ≥ ${p.spec.heatThresholdC} °C (cumulative)` }[p.spec.indexType];
  return (
    <Panel title={row.region} subtitle={`${row.productName} · ${p.seasonLabel}`} icon={Radar} accent="cyan">
      {!o ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-900/60 px-2 py-2">
              <div className="text-[10.5px] text-slate-500">Index to date</div>
              <div className="telemetry text-slate-100">
                {num(o.indexToDate, 1)} {p.meta.unit}
              </div>
            </div>
            <div className="rounded-lg bg-slate-900/60 px-2 py-2">
              <div className="text-[10.5px] text-slate-500">
                P(payout) <Explain term="exceedance_probability" />
              </div>
              <div className={cn("telemetry", o.probabilityPct >= 50 ? "text-amber-300" : "text-slate-100")}>{pct(o.probabilityPct, 1)}</div>
            </div>
            <div className="rounded-lg bg-slate-900/60 px-2 py-2">
              <div className="text-[10.5px] text-slate-500">Expected / P90</div>
              <div className="telemetry text-slate-100">
                {usd(row.expectedPayoutUsd)} / {usd(row.p90PayoutUsd)}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11.5px] text-slate-400">
            <span>{label}</span>
            <span className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="h-0.5 w-3" style={{ background: VIZ.s1 }} /> observed
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-0.5 w-3 border-t border-dashed" style={{ borderColor: VIZ.s2 }} /> forecast
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-0.5 w-3" style={{ background: VIZ.critical }} /> trigger
              </span>
            </span>
          </div>
          <div className="h-[230px]">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={VIZ.grid} vertical={false} />
                <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                <YAxis {...axisProps} />
                <Tooltip {...tooltipStyle} labelFormatter={(l) => dateStr(String(l))} formatter={(v: number, n) => [`${num(v, 1)} ${p.meta.unit}`, n === "observed" ? "Observed" : "Forecast"]} />
                <ReferenceLine y={row.trigger} stroke={VIZ.critical} strokeDasharray="4 3" label={{ value: "trigger", fill: "#94a3b8", fontSize: 10, position: "insideTopRight" }} />
                <Line dataKey="observed" stroke={VIZ.s1} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
                <Line dataKey="forecast" stroke={VIZ.s2} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11.5px] leading-relaxed text-slate-400">
            {o.status === "closed"
              ? `The ${o.seasonYear} window closed on ${dateStr(o.windowEnd)} — the final index is ${num(o.indexToDate, 1)} ${p.meta.unit}, so the payout is settled at ${pct(o.expectedPayoutFraction * 100, 1)} of sum insured.`
              : o.status === "upcoming"
                ? `The ${o.seasonYear} window opens ${dateStr(o.windowStart)}. Until then the probability is the historical frequency, nudged by the forecast for any window days within the next 15 days.`
                : `${o.daysElapsed} of ${o.daysTotal} window days observed. ${o.scenarios.toLocaleString()} scenarios = ${o.forecastModel} × past seasons for the remaining days.`}
          </p>
        </div>
      )}
    </Panel>
  );
}
