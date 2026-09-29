"use client";

/**
 * Carbon programme dashboard — IPCC Tier 1 emissions, AWD adoption, avoided
 * emissions, adoption scenario and indicative credit revenue (sliders recompute live).
 */
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { BadgeCheck, Coins, Factory, Gauge, Leaf, Map as MapIcon, TrendingDown } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { axisProps, Kpi, num, Slider, tooltipStyle, usd, VIZ, WhatThisMeans } from "@/components/insurance/kit";
import type { RouterOutputs } from "@/lib/trpc";

const LocationMap = dynamic(() => import("@/components/insurance/LocationMap"), { ssr: false, loading: () => <Skeleton className="h-[300px]" /> });

export type ProgrammeT = RouterOutputs["sustainability"]["carbon"]["programme"];
export interface ProgOpts {
  priceUsd: number;
  targetAdoptionPct: number;
  efMode: "global" | "regional";
  deductionPct: number;
}

export function IndicativeBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-2 py-0.5 text-[11px] text-amber-200">
      Indicative, not a Verra VM0051 verified estimate
    </span>
  );
}

export function Controls({ opts, setOpts }: { opts: ProgOpts; setOpts: (o: ProgOpts) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Slider label={<>Carbon price <Explain text="Voluntary-market price for agricultural methane-reduction credits varies widely (≈ USD 5-40 / t CO2e). Use your offtake price." /></>} value={opts.priceUsd} min={5} max={40} onChange={(v) => setOpts({ ...opts, priceUsd: v })} format={(v) => `$${v}/t`} />
      <Slider label="AWD adoption target (of eligible area)" value={opts.targetAdoptionPct} min={0} max={100} step={5} onChange={(v) => setOpts({ ...opts, targetAdoptionPct: v })} format={(v) => `${v}%`} />
      <Slider label={<>Conservativeness deduction <Explain text="Share of avoided emissions not credited, to cover uncertainty, leakage and buffer requirements of a crediting methodology." /></>} value={opts.deductionPct} min={0} max={50} onChange={(v) => setOpts({ ...opts, deductionPct: v })} format={(v) => `${v}%`} />
      <div>
        <div className="mb-1 flex items-center gap-1 text-[12px] text-slate-400">
          Baseline methane factor <Explain text="IPCC 2019 Table 5.11: global default EF_c = 1.19 kg CH4/ha/day for continuously flooded rice without organic amendment. Table 5.11A gives regional values (South Asia 0.85, South-East Asia 1.22)." />
        </div>
        <div className="flex rounded-lg border border-slate-800 p-0.5 text-[12px]">
          {(["global", "regional"] as const).map((m) => (
            <button key={m} className={`flex-1 rounded-md px-2 py-1 ${opts.efMode === m ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400"}`} onClick={() => setOpts({ ...opts, efMode: m })}>
              {m === "global" ? "Global 1.19" : "IPCC regional"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Programme({ p, opts, setOpts, onOpenFarms }: { p: ProgrammeT; opts: ProgOpts; setOpts: (o: ProgOpts) => void; onOpenFarms: () => void }) {
  const t = p.totals;
  const dots = useMemo(
    () =>
      p.rows
        .filter((r) => r.crop === "rice")
        .map((r) => ({
          id: r.id,
          lat: r.lat,
          lon: r.lon,
          color: r.practice.awd ? "#22c55e" : r.practice.eligible ? "#38bdf8" : "#64748b",
          radius: 3 + Math.min(9, Math.sqrt(r.areaHa) * 1.2),
          label: `${r.name} · ${num(r.areaHa, 1)} ha · ${r.practice.awd ? `AWD (${r.practice.awdStatus?.replace("_", " ")})` : r.practice.eligible ? "eligible, not adopted" : "rain-fed — not eligible"} · ${r.baseline.tCo2e.toFixed(1)} t CO2e/season`,
        })),
    [p.rows]
  );
  const sourceData = [
    { name: "CH4", v: t.bySource.ch4 },
    { name: "N2O", v: t.bySource.n2o },
    { name: "Urea CO2", v: t.bySource.ureaCo2 },
  ];
  const compare = [
    { name: "Baseline", v: t.baselineSeasonTCo2e },
    { name: "Today", v: t.emissionsSeasonTCo2e },
    { name: `${p.scenario.targetAdoptionPct}%`, v: Math.max(0, t.baselineSeasonTCo2e - p.scenario.avoidedSeasonTCo2e) },
  ];
  const noRice = t.riceAssets === 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label={<>Season emissions</>} value={`${num(t.emissionsSeasonTCo2e)} t CO2e`} sub={`${num(t.emissionsAnnualTCo2e)} t CO2e / yr`} help={<Explain text="Carbon-dioxide equivalent using IPCC AR6 100-year warming potentials: methane (non-fossil) 27, nitrous oxide 273." />} />
        <Kpi label="Emissions intensity" value={t.intensityTCo2ePerT == null ? "—" : `${t.intensityTCo2ePerT.toFixed(2)} t/t`} sub={t.riceIntensityTCo2ePerT == null ? "t CO2e per t crop" : `rice ${t.riceIntensityTCo2ePerT.toFixed(2)} t CO2e/t paddy`} />
        <Kpi label="AWD adoption" value={`${t.adoptionPctArea.toFixed(0)} %`} sub={`${t.adoptedAssets} of ${t.eligibleAssets} eligible · ${num(t.adoptedFarmers)} farmers`} tone={t.adoptionPctArea >= 30 ? "good" : "warn"} help={<Explain text="Alternate Wetting and Drying: irrigated paddy is allowed to dry until the water table is ~15 cm below the surface, then re-flooded. It cuts methane (IPCC SF_w 1.00 → 0.55) and irrigation water by ~25-30 % without yield loss when done safely." />} />
        <Kpi label="Avoided (achieved)" value={`${num(p.achieved.avoidedAnnualTCo2e)} t/yr`} sub={`range ${num(p.achieved.avoidedAnnualRange.low)}–${num(p.achieved.avoidedAnnualRange.high)}`} tone="good" />
        <Kpi label="Indicative credit revenue" value={`${usd(p.achieved.revenue.usd)}/yr`} sub={`${num(p.achieved.revenue.credits)} credits at $${opts.priceUsd}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <IndicativeBadge />
        <span className="text-[11.5px] text-slate-500">IPCC 2019 Refinement Tier 1 · AR6 GWP-100 · {opts.efMode === "global" ? "EF_c 1.19 kg CH4/ha/day" : "regional EF_c (Table 5.11A)"}</span>
      </div>

      <WhatThisMeans tone="emerald">
        {noRice ? (
          <>This workspace has no rice assets, so there is no paddy methane to reduce. Emissions shown are fertiliser N2O and urea CO2 on your crop area.</>
        ) : (
          <>
            Your {t.riceAssets} rice assets ({num(t.riceAreaHa)} ha) emit about {num(t.bySource.ch4)} t CO2e of methane this season. {t.eligibleAssets} of them ({num(t.eligibleAreaHa)} ha) have the water control needed for AWD; {t.adoptedAssets} have adopted it, avoiding ~{num(p.achieved.avoidedAnnualTCo2e)} t CO2e a year. Reaching {p.scenario.targetAdoptionPct} % of eligible area would avoid ~{num(p.scenario.avoidedAnnualTCo2e)} t CO2e/yr — about {usd(p.scenario.revenue.usd)} a year at ${opts.priceUsd}/t after a {opts.deductionPct} % deduction ({usd(p.scenario.revenue.perFarmerUsd)} per participating farmer) — and save ~{num(p.scenario.waterSavedM3 / 1000)} thousand m³ of irrigation water.{" "}
            <button className="text-cyan-300 underline" onClick={onOpenFarms}>
              Update adoption farm by farm →
            </button>
          </>
        )}
      </WhatThisMeans>

      <Panel title="Scenario controls" subtitle="Everything on this page recomputes as you move a slider" icon={Gauge} accent="cyan">
        <Controls opts={opts} setOpts={setOpts} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title="Adoption curve" subtitle="Avoided t CO2e/yr and indicative revenue as AWD adoption grows across eligible area" icon={TrendingDown} accent="green">
          <div className="h-[260px]" role="img" aria-label="Avoided emissions and revenue vs adoption">
            <ResponsiveContainer>
              <ComposedChart data={p.curve} margin={{ top: 8, right: 6, left: -4, bottom: 0 }}>
                <CartesianGrid stroke={VIZ.grid} vertical={false} />
                <XAxis dataKey="adoptionPct" {...axisProps} tickFormatter={(v) => `${v}%`} />
                <YAxis yAxisId="t" {...axisProps} tickFormatter={(v) => num(v)} width={52} />
                <YAxis yAxisId="u" orientation="right" {...axisProps} tickFormatter={(v) => usd(v, 0)} width={56} />
                <Tooltip {...tooltipStyle} formatter={(v: number, n) => (n === "Revenue" ? [usd(v), n] : [`${num(v)} t CO2e/yr`, n])} labelFormatter={(l) => `${l}% of eligible area on AWD`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="t" dataKey="avoidedTCo2eYr" name="Avoided" fill={VIZ.s3} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="u" dataKey="revenueUsdYr" name="Revenue" stroke={VIZ.s4} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11.5px] text-slate-500">Full potential: {num(p.fullPotential.avoidedAnnualTCo2e)} t CO2e/yr ({p.fullPotential.sharePctOfRiceEmissions.toFixed(0)} % of eligible-area baseline). Uncertainty scales with the IPCC EF_c range 0.80–1.76.</p>
        </Panel>
        <Panel className="xl:col-span-2" title="Emissions by source & scenario" subtitle="t CO2e this season · left: rice CH4, fertiliser N2O, urea CO2 · right: baseline, today, target adoption" icon={Factory} accent="amber">
          <div className="grid grid-cols-2 gap-2">
            <div className="h-[230px]">
              <ResponsiveContainer>
                <BarChart data={sourceData} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="name" {...axisProps} fontSize={10} interval={0} />
                  <YAxis {...axisProps} tickFormatter={(v) => num(v)} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`${num(v, 1)} t CO2e`, "Emissions"]} />
                  <Bar dataKey="v" fill={VIZ.s2} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-[230px]">
              <ResponsiveContainer>
                <BarChart data={compare} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="name" {...axisProps} fontSize={10} interval={0} />
                  <YAxis {...axisProps} tickFormatter={(v) => num(v)} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`${num(v, 1)} t CO2e`, "Season"]} />
                  <Bar dataKey="v" fill={VIZ.s1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title="Rice assets & adoption status" subtitle="Green = AWD adopted · blue = eligible · grey = rain-fed (not eligible)" icon={MapIcon} accent="green">
          {dots.length ? <LocationMap dots={dots} fit height={300} /> : <p className="py-10 text-center text-[13px] text-slate-500">No rice assets to map.</p>}
        </Panel>
        <Panel className="xl:col-span-2" title="Verification of adoption" subtitle="MRV evidence status of adopting farms" icon={BadgeCheck} accent="violet">
          <div className="space-y-2">
            {(
              [
                ["field_verified", "Field-verified (water tube / visit)", "#22c55e"],
                ["remote_sensed", "Remote-sensing flag (drying events)", "#38bdf8"],
                ["self_reported", "Self-reported", "#f59e0b"],
              ] as const
            ).map(([k, label, c]) => {
              const n = t.verification[k];
              return (
                <div key={k}>
                  <div className="flex justify-between text-[12px] text-slate-300">
                    <span>{label}</span>
                    <span className="telemetry">{n}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-800">
                    <div className="h-2 rounded-full" style={{ width: `${t.adoptedAssets ? (n / t.adoptedAssets) * 100 : 0}%`, background: c }} />
                  </div>
                </div>
              );
            })}
            <p className="pt-1 text-[11.5px] text-slate-500">A crediting programme would require field or remote-sensing evidence for every adopting plot; self-reported plots should be prioritised for visits.</p>
          </div>
        </Panel>
      </div>

      <div className="flex flex-wrap gap-2">
        <SourceTag href="https://www.ipcc-nggip.iges.or.jp/public/2019rf/vol4.html">IPCC 2019 Refinement Vol.4 Ch.5 & 11</SourceTag>
        <SourceTag>IPCC AR6 WG1 GWP-100</SourceTag>
        <SourceTag>Carrijo et al. 2017 (AWD water −25.7 %)</SourceTag>
        <SourceTag href="https://verra.org/methodologies/vm0051-improved-management-in-rice-production-systems-v1-0/">Verra VM0051 (reference only)</SourceTag>
        <SourceTag>
          <Coins size={10} className="mr-1 inline" />
          Season lengths & yields from Yield Forecast
        </SourceTag>
        <SourceTag>
          <Leaf size={10} className="mr-1 inline" />
          Generated {new Date(p.generatedAt).toLocaleString("en-GB")}
        </SourceTag>
      </div>
    </div>
  );
}
