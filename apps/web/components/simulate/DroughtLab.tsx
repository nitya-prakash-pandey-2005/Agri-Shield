"use client";

/**
 * Drought & heat season simulator — rainfall deficit + temperature anomaly →
 * FAO-33 yield loss per crop → revenue, insurance and credit impacts.
 * Recomputes live as the sliders move.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CloudSun, Home, Sprout, Sun, ThermometerSun } from "lucide-react";
import { Panel, Skeleton } from "@/components/hud";
import { axisProps, ErrorBox, Kpi, num, Select, Slider, tooltipStyle, usd, VIZ, WhatThisMeans } from "@/components/insurance/kit";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Caveats, Chip, exportCsv, exportPdf, ha, MethodExplain, ResultActions, TYPE_LABEL } from "./common";

type Ctx = RouterOutputs["simulate"]["context"];
type Result = RouterOutputs["simulate"]["runDrought"];
export interface DroughtPrefill {
  deficitPct: number;
  tempAnomalyC: number;
  irrigation?: "asset" | "rainfed" | "irrigated";
  tag?: string | null;
}

const SERIES = [VIZ.s1, VIZ.s2, VIZ.s3, VIZ.s4, VIZ.s5, VIZ.s7];

export default function DroughtLab({ ctx, prefill }: { ctx: Ctx; prefill?: DroughtPrefill | null }) {
  const [deficit, setDeficit] = useState(30);
  const [temp, setTemp] = useState(1);
  const [irrigation, setIrrigation] = useState<"asset" | "rainfed" | "irrigated">("asset");
  const [tag, setTag] = useState<string>("");
  const [result, setResult] = useState<Result | null>(null);
  const presets = trpc.simulate.droughtPresets.useQuery();
  const run = trpc.simulate.runDrought.useMutation({ onSuccess: setResult });
  const mutate = run.mutate;

  useEffect(() => {
    if (!prefill) return;
    setDeficit(prefill.deficitPct);
    setTemp(prefill.tempAnomalyC);
    if (prefill.irrigation) setIrrigation(prefill.irrigation);
    setTag(prefill.tag ?? "");
  }, [prefill]);

  // live recompute (debounced)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => mutate({ deficitPct: deficit, tempAnomalyC: temp, irrigation, tag: tag || null }), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [deficit, temp, irrigation, tag, mutate]);

  const T = result?.totals;
  const crops = useMemo(() => (result?.byCrop.length ? result.byCrop.map((c) => c.crop) : ["rice"]), [result]);
  const worst = result?.byCrop[0];
  const narrative =
    result && T
      ? `A season with ${deficit}% less rain than normal${temp ? ` and ${temp > 0 ? "+" : ""}${temp} °C warmer` : ""} would cut yields on your ${num(T.areaHa)} ha by about ${T.meanYieldLossPct}% on average${worst ? ` — ${worst.crop} hardest hit (${worst.yieldLossPct}% loss, Ky ${worst.ky})` : ""}. That is roughly ${usd(T.revenueLossUsd)} of farm revenue lost${T.insuredLossUsd ? `, ${usd(T.insuredLossUsd)} of insurance claims` : ""}${T.elUpliftUsd ? ` and ${usd(T.elUpliftUsd)} of extra expected credit losses` : ""}. ${T.assetsSevere ? `${T.assetsSevere} assets would lose more than 30% of their harvest` : "No asset would lose more than 30% of its harvest"}${T.householdsSevere ? `, affecting about ${num(T.householdsSevere)} farm households in your communities` : ""}. ${irrigation === "asset" ? "Irrigated farms are buffered in proportion to how much of their water comes from rain." : irrigation === "irrigated" ? "Assuming every farm is irrigated (canals/tubewells keep working)." : "Assuming every farm is rain-fed (worst case)."}`
      : "";

  const rows = () =>
    (result?.assets ?? []).map((a) => ({ id: a.id, name: a.name, type: a.type, crop: a.crop, country: a.country, area_ha: a.areaHa, rain_dependency: a.rainDependency, yield_loss_pct: a.yieldLossPct, water_loss_pct: a.waterLossPct, heat_loss_pct: a.heatLossPct, revenue_usd: a.revenueUsd, revenue_loss_usd: a.revenueLossUsd, insured_loss_usd: a.insuredLossUsd ?? "", el_uplift_usd: a.elUpliftUsd ?? "", pd_base: a.pdBase ?? "", pd_stressed: a.pdStressed ?? "", households_severe: a.households ?? "" }));

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <Panel title="Season scenario" icon={CloudSun} accent="amber" subtitle="Moves recompute instantly">
          <div className="space-y-4">
            <Slider label="Rainfall deficit" value={deficit} min={0} max={80} step={5} onChange={setDeficit} format={(v) => `−${v}%`} hint="Whole-season rain below the long-term normal" />
            <Slider label="Temperature anomaly" value={temp} min={-1} max={4} step={0.25} onChange={setTemp} format={(v) => `${v > 0 ? "+" : ""}${v} °C`} hint="Growing-season mean vs normal" />
            <div>
              <div className="mb-1 text-[12px] text-slate-400">Irrigation assumption</div>
              <div className="flex flex-wrap gap-1.5">
                <Chip active={irrigation === "asset"} onClick={() => setIrrigation("asset")}>Per farm record</Chip>
                <Chip active={irrigation === "rainfed"} onClick={() => setIrrigation("rainfed")}>All rain-fed</Chip>
                <Chip active={irrigation === "irrigated"} onClick={() => setIrrigation("irrigated")}>All irrigated</Chip>
              </div>
            </div>
            {ctx.groups.length > 0 && (
              <div>
                <div className="mb-1 text-[12px] text-slate-400">Scope</div>
                <Select ariaLabel="Asset group" value={tag} onChange={setTag} options={[{ value: "", label: `Whole portfolio (${ctx.assets.length} assets)` }, ...ctx.groups.map((g) => ({ value: g.tag, label: `Tag: ${g.tag} (${g.count})` }))]} />
              </div>
            )}
            <ErrorBox error={run.error} />
          </div>
        </Panel>
        <Panel title="Presets" icon={Sun} accent="amber">
          {presets.isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="space-y-1.5">
              {(presets.data ?? []).map((p) => (
                <button key={p.id} title={p.basis} onClick={() => (setDeficit(Math.min(80, Math.round(p.deficitPct / 5) * 5)), setTemp(p.tempAnomalyC))} className="block w-full rounded-lg border border-slate-800 px-2.5 py-1.5 text-left text-[12px] text-slate-300 hover:border-amber-400/40 hover:text-white">
                  <span className="mr-1 rounded bg-amber-400/10 px-1 text-[10px] uppercase text-amber-300">{p.id === "record" ? "real" : "illustrative"}</span>
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={<span className="flex items-center gap-1">How yield responds <MethodExplain k="ky" /></span>} icon={Sprout} accent="amber" subtitle="FAO-33: loss = Ky × water shortfall">
          <p className="text-[12px] leading-relaxed text-slate-400">
            Each crop's <b className="text-slate-200">Ky</b> says how sharply yield falls when it gets less water than it needs. The chart on the right shows yield loss for your crops as the deficit grows (rain-fed, at the chosen temperature).
          </p>
        </Panel>
      </div>

      <div className="min-w-0 space-y-4">
        {!result ? (
          <Skeleton className="h-[420px]" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              <Kpi label="Mean yield loss" value={`${T!.meanYieldLossPct}%`} sub={`${ha(T!.areaHa)} cropped`} tone={T!.meanYieldLossPct >= 30 ? "bad" : T!.meanYieldLossPct >= 10 ? "warn" : "good"} />
              <Kpi label="Revenue lost" value={usd(T!.revenueLossUsd)} sub={`of ${usd(T!.revenueUsd)} normal`} tone={T!.revenueLossUsd ? "bad" : "neutral"} />
              <Kpi label="Assets > 30% loss" value={num(T!.assetsSevere)} sub={`of ${T!.assets}`} tone={T!.assetsSevere ? "bad" : "good"} />
              <Kpi label="Insured loss" value={usd(T!.insuredLossUsd)} sub="SI × loss − deductible" />
              <Kpi label="Extra credit loss" value={usd(T!.elUpliftUsd)} sub="ΔPD × LGD × EAD" />
              <Kpi label="Households hit" value={num(T!.householdsSevere)} sub="losing > 30% harvest" />
            </div>
            <WhatThisMeans tone={T!.meanYieldLossPct >= 20 ? "rose" : "amber"}>{narrative}</WhatThisMeans>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Yield loss vs rainfall deficit" icon={ThermometerSun} accent="amber" subtitle={`rain-fed · ${temp > 0 ? "+" : ""}${temp} °C`}>
                <div className="h-[240px]">
                  <ResponsiveContainer>
                    <LineChart data={result.curves} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
                      <CartesianGrid stroke={VIZ.grid} vertical={false} />
                      <XAxis dataKey="deficitPct" {...axisProps} tickFormatter={(v) => `−${v}%`} interval={3} />
                      <YAxis {...axisProps} tickFormatter={(v) => `${v}%`} width={42} domain={[0, 100]} />
                      <Tooltip {...tooltipStyle} labelFormatter={(v) => `Rain −${v}%`} formatter={(v: number, n: string) => [`${v}% yield loss`, n]} />
                      <ReferenceLine x={deficit} stroke="#fbbf24" strokeDasharray="4 3" />
                      {crops.slice(0, 6).map((c, i) => (
                        <Line key={c} dataKey={c} stroke={SERIES[i % SERIES.length]} dot={false} strokeWidth={2} isAnimationActive={false} />
                      ))}
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <Panel title="Revenue lost by crop" icon={Sprout} accent="amber">
                <div className="h-[240px]">
                  <ResponsiveContainer>
                    <BarChart data={result.byCrop} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
                      <CartesianGrid stroke={VIZ.grid} horizontal={false} />
                      <XAxis type="number" {...axisProps} tickFormatter={(v) => usd(v, 0)} />
                      <YAxis type="category" dataKey="crop" {...axisProps} width={78} />
                      <Tooltip {...tooltipStyle} formatter={(v: number) => usd(v)} />
                      <Bar dataKey="revenueLossUsd" name="Revenue lost" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                        {result.byCrop.map((c, i) => (
                          <Cell key={c.crop} fill={SERIES[i % SERIES.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-[11.5px]">
                    <thead className="text-left text-[10px] uppercase text-slate-500">
                      <tr>
                        <th className="py-1">Crop</th>
                        <th className="text-right">Ky</th>
                        <th className="text-right">Heat/°C</th>
                        <th className="text-right">Area</th>
                        <th className="text-right">Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.byCrop.map((c) => (
                        <tr key={c.crop} className="border-t border-slate-800/70 text-slate-300" title={`Ky source: ${c.kySource}`}>
                          <td className="py-1 capitalize">{c.crop}</td>
                          <td className="text-right telemetry">{c.ky}</td>
                          <td className="text-right telemetry">{c.heatPerDegPct}%</td>
                          <td className="text-right telemetry">{ha(c.areaHa)}</td>
                          <td className="text-right telemetry text-white">{c.yieldLossPct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
            <Panel title="Most affected assets" icon={Home} accent="amber" bodyClassName="px-0">
              <div className="max-h-[340px] overflow-auto">
                <table className="w-full min-w-[640px] text-[12px]">
                  <thead className="sticky top-0 bg-[#070d1c] text-left text-[10.5px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Asset</th>
                      <th className="px-2 text-right">Rain reliance</th>
                      <th className="px-2 text-right">Yield loss</th>
                      <th className="px-2 text-right">Water / heat</th>
                      <th className="px-2 text-right">Revenue lost</th>
                      <th className="px-4 text-right">Insured / ΔPD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.assets.slice(0, 150).map((a) => (
                      <tr key={a.id} className="border-t border-slate-800/70">
                        <td className="px-4 py-1.5">
                          <div className="text-slate-100">{a.name}</div>
                          <div className="text-[10.5px] text-slate-500">{TYPE_LABEL[a.type] ?? a.type} · {a.crop}{a.areaHa ? ` · ${a.areaHa} ha` : ""}</div>
                        </td>
                        <td className="px-2 text-right telemetry text-slate-300">{Math.round(a.rainDependency * 100)}%</td>
                        <td className={`px-2 text-right telemetry ${a.yieldLossPct >= 30 ? "text-rose-300" : a.yieldLossPct >= 10 ? "text-amber-300" : "text-slate-300"}`}>{a.yieldLossPct}%</td>
                        <td className="px-2 text-right telemetry text-slate-400">{a.waterLossPct}% / {a.heatLossPct}%</td>
                        <td className="px-2 text-right telemetry text-white">{usd(a.revenueLossUsd)}</td>
                        <td className="px-4 text-right telemetry text-slate-300">{a.insuredLossUsd != null ? usd(a.insuredLossUsd) : a.pdStressed != null ? `${(a.pdBase! * 100).toFixed(1)}→${(a.pdStressed * 100).toFixed(1)}%` : a.households != null ? `${num(a.households)} hh` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <ResultActions
              simId={result.id}
              defaultName={`Drought −${deficit}% rain, ${temp > 0 ? "+" : ""}${temp} °C`}
              csv={() => exportCsv(`drought-${deficit}pct-${temp}c.csv`, rows())}
              pdf={() =>
                exportPdf(
                  {
                    title: `Drought & heat scenario: -${deficit}% rain, ${temp > 0 ? "+" : ""}${temp} C`,
                    subtitle: `Irrigation: ${irrigation} · ${tag ? `tag ${tag}` : "whole portfolio"} · ${new Date(result.createdAt).toUTCString()}`,
                    narrative,
                    kpis: [
                      ["Mean yield loss", `${T!.meanYieldLossPct}%`],
                      ["Cropped area", ha(T!.areaHa)],
                      ["Revenue lost", usd(T!.revenueLossUsd)],
                      ["Assets > 30% loss", String(T!.assetsSevere)],
                      ["Insured loss", usd(T!.insuredLossUsd)],
                      ["Extra expected credit loss", usd(T!.elUpliftUsd)],
                      ["Households losing > 30%", num(T!.householdsSevere)],
                    ],
                    table: { head: ["Asset", "Type", "Crop", "Yield loss %", "Revenue lost"], body: result.assets.slice(0, 40).map((a) => [a.name, TYPE_LABEL[a.type] ?? a.type, a.crop, a.yieldLossPct, usd(a.revenueLossUsd)]) },
                    caveats: result.caveats,
                    sources: result.sources,
                  },
                  `drought-${deficit}pct.pdf`
                )
              }
              incident={{ title: `Drought scenario −${deficit}% rain, ${temp > 0 ? "+" : ""}${temp} °C`, summary: narrative }}
            />
            <Caveats items={result.caveats} sources={result.sources} />
          </>
        )}
      </div>
    </div>
  );
}
