"use client";

/** Climate stress tests: PD, EL and IRB capital under five physical-risk scenarios. */
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Flame, Gauge } from "lucide-react";
import { Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { axisProps, ErrorBox, Kpi, pct, tooltipStyle, usd, VIZ, WhatThisMeans } from "@/components/insurance/kit";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { RatingBadge } from "./Credit";

export default function Stress({ onOpen }: { onOpen: (id: string) => void }) {
  const st = trpc.finance.stress.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [sel, setSel] = useState<string>("flood_50");
  if (st.isLoading) return <Skeleton className="h-[520px]" />;
  if (!st.data) return <ErrorBox error={st.error} onRetry={() => st.refetch()} />;
  const d = st.data;
  const r = d.results.find((x) => x.id === sel) ?? d.results[0]!;
  const worst = [...d.results].sort((a, b) => b.elUsd - a.elUsd)[0]!;
  const chart = [{ name: "Today (climate-adj.)", el: d.base.elUsd, cap: d.base.capitalUsd, id: "base" }, ...d.results.map((x) => ({ name: x.short, el: x.elUsd, cap: x.capitalUsd, id: x.id }))];
  const shift = r.climateShift;
  return (
    <div className="space-y-4">
      <WhatThisMeans tone="amber">
        The harshest scenario is <b className="text-white">{worst.name}</b>: expected loss rises to <b className="text-amber-200">{usd(worst.elUsd)}</b> ({worst.elMultiple.toFixed(1)}× today) and regulatory-style capital by <b className="text-amber-200">{usd(worst.capitalDeltaUsd)}</b>. That is {pct(worst.elPctOfEad, 1)} of the book lost in a single bad year — compare it with your provisions and the capital buffer you hold for agriculture.
      </WhatThisMeans>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={<>Expected loss by scenario <Explain term="stress_test" /></>} subtitle="12-month EL, USD — click a bar for details" icon={Flame} accent="cyan">
          <div className="h-[250px]">
            <ResponsiveContainer>
              <BarChart data={chart} margin={{ top: 6, right: 6, left: -4, bottom: 0 }} onClick={(e) => e?.activePayload?.[0] && e.activePayload[0].payload.id !== "base" && setSel(e.activePayload[0].payload.id)}>
                <CartesianGrid stroke={VIZ.grid} vertical={false} />
                <XAxis dataKey="name" {...axisProps} interval={0} tick={{ fontSize: 10 }} />
                <YAxis {...axisProps} tickFormatter={(v) => usd(v, 0)} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [usd(v), "Expected loss"]} />
                <ReferenceLine y={d.base.elUsd} stroke={VIZ.ink2} strokeDasharray="3 3" />
                <Bar dataKey="el" radius={[4, 4, 0, 0]} isAnimationActive={false} cursor="pointer">
                  {chart.map((c) => (
                    <Cell key={c.id} fill={c.id === "base" ? "#475569" : c.id === sel ? VIZ.s2 : VIZ.s1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Capital impact (IRB-style)" subtitle="Unexpected-loss capital K × EAD, Basel 'other retail' curve" icon={Gauge} accent="cyan">
          <div className="h-[250px]">
            <ResponsiveContainer>
              <BarChart data={chart} margin={{ top: 6, right: 6, left: -4, bottom: 0 }}>
                <CartesianGrid stroke={VIZ.grid} vertical={false} />
                <XAxis dataKey="name" {...axisProps} interval={0} tick={{ fontSize: 10 }} />
                <YAxis {...axisProps} tickFormatter={(v) => usd(v, 0)} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [usd(v), "Capital requirement"]} />
                <ReferenceLine y={d.base.capitalUsd} stroke={VIZ.ink2} strokeDasharray="3 3" />
                <Bar dataKey="cap" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {chart.map((c) => (
                    <Cell key={c.id} fill={c.id === "base" ? "#475569" : VIZ.s3} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {d.results.map((x) => (
          <button key={x.id} onClick={() => setSel(x.id)} className={cn("rounded-lg border px-3 py-1.5 text-[12.5px]", sel === x.id ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200" : "border-slate-700 text-slate-300 hover:border-slate-500")}>
            {x.name}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <Panel title={r.name} accent="cyan">
          <p className="mb-3 text-[12.5px] leading-relaxed text-slate-400">{r.description}</p>
          <div className="grid grid-cols-2 gap-2">
            <Kpi label={<Explain term="pd">Avg PD</Explain>} value={pct(r.pdPct, 1)} sub={`today ${pct(d.base.pdPct, 1)}`} tone="warn" />
            <Kpi label="Expected loss" value={usd(r.elUsd)} sub={`+${usd(r.elDeltaUsd)} (${r.elMultiple.toFixed(2)}×)`} tone="bad" />
            <Kpi label="Capital (K·EAD)" value={usd(r.capitalUsd)} sub={`+${usd(r.capitalDeltaUsd)} · RWA ${usd(r.rwaUsd)}`} tone="warn" />
            <Kpi label="Rating downgrades" value={String(r.downgrades)} sub={`EL = ${pct(r.elPctOfEad, 2)} of EAD`} />
          </div>
          {shift && (
            <div className="mt-3 rounded-lg bg-slate-900/60 p-2.5 text-[11.5px] text-slate-400">
              <div className="mb-1 text-slate-300">CMIP6 change factors (2031–2050 vs 1995–2014)</div>
              {shift.map((s) =>
                s.shift ? (
                  <div key={s.country}>
                    {s.country}: heavy-rain days ×{s.shift.heavyRainFreqFactor.toFixed(2)}, wettest 5 days ×{s.shift.rx5dayFactor.toFixed(2)}, dry days ×{s.shift.dryDaysFactor.toFixed(2)}, +{s.shift.hotDaysDelta.toFixed(0)} days ≥ 35 °C, Tmax +{s.shift.meanTmaxDeltaC.toFixed(1)} °C ({s.shift.models.join(", ")})
                  </div>
                ) : (
                  <div key={s.country}>{s.country}: CMIP6 service unavailable — literature defaults used (heavy rain ×1.35, dry days ×1.08, +25 hot days).</div>
                )
              )}
            </div>
          )}
          <div className="mt-3 text-[11.5px] text-slate-400">By region (stressed EL vs today):</div>
          <div className="mt-1 space-y-1">
            {r.byRegion.slice(0, 6).map((g) => (
              <div key={g.region} className="flex items-center justify-between text-[12px]">
                <span className="text-slate-300">{g.region}</span>
                <span className="telemetry text-slate-400">
                  {usd(g.elBaseUsd)} → <span className="text-amber-200">{usd(g.elUsd)}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Most affected loans" subtitle="Largest increase in expected loss" accent="cyan" bodyClassName="px-0 pb-2">
          <div className="divide-y divide-slate-800/60">
            {r.topLoans.map((l) => (
              <button key={l.id} onClick={() => onOpen(l.id)} className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left hover:bg-white/[0.03]">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] text-slate-200">{l.name}</span>
                  <span className="block text-[11px] text-slate-500">
                    {l.region} · {l.crop} · {usd(l.eadUsd)} EAD · PD {pct(l.pdPct, 1)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <RatingBadge r={l.rating} />
                  <span className="telemetry text-[12px] text-amber-200">+{usd(l.deltaElUsd)}</span>
                </span>
              </button>
            ))}
          </div>
        </Panel>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <SourceTag>ERA5 + GloFAS reanalysis hazard frequencies</SourceTag>
        <SourceTag href="https://open-meteo.com/en/docs/climate-api">CMIP6 HighResMIP via Open-Meteo</SourceTag>
        <SourceTag>Basel IRB retail risk-weight function</SourceTag>
      </div>
    </div>
  );
}
