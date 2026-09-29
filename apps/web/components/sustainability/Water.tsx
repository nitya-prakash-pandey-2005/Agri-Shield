"use client";

/** Irrigation water footprint and AWD water savings. */
import { useMemo } from "react";
import { Droplets, GlassWater } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { axisProps, Kpi, num, tooltipStyle, VIZ, WhatThisMeans } from "@/components/insurance/kit";
import type { ProgrammeT } from "./Programme";

const BENCH = { total: 1673, green: 1146, blue: 341 };

export default function Water({ p }: { p: ProgrammeT }) {
  const rice = p.rows.filter((r) => r.crop === "rice" && r.water);
  const agg = useMemo(() => {
    const by = new Map<string, { district: string; green: number; blue: number; withdrawal: number; prod: number; saved: number; potential: number }>();
    for (const r of rice) {
      const k = r.district ?? r.country;
      const g = by.get(k) ?? { district: k, green: 0, blue: 0, withdrawal: 0, prod: 0, saved: 0, potential: 0 };
      g.green += r.water!.greenM3;
      g.blue += r.water!.blueM3;
      g.withdrawal += r.water!.withdrawalM3;
      g.prod += r.productionT;
      g.saved += r.awdWaterSavedM3;
      g.potential += r.potentialWaterSavedM3;
      by.set(k, g);
    }
    return [...by.values()].map((g) => ({ ...g, wfGreen: g.prod ? Math.round(g.green / g.prod) : 0, wfBlue: g.prod ? Math.round(g.blue / g.prod) : 0 })).sort((a, b) => b.withdrawal - a.withdrawal);
  }, [rice]);
  const tot = agg.reduce((a, g) => ({ green: a.green + g.green, blue: a.blue + g.blue, withdrawal: a.withdrawal + g.withdrawal, prod: a.prod + g.prod, saved: a.saved + g.saved, potential: a.potential + g.potential }), { green: 0, blue: 0, withdrawal: 0, prod: 0, saved: 0, potential: 0 });
  const wf = tot.prod ? (tot.green + tot.blue) / tot.prod : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label={<>Irrigation withdrawal <Explain text="Water pumped or delivered by canal this season, including paddy percolation and seepage (normal-season water balance)." /></>} value={`${num(tot.withdrawal / 1000)}k m³`} sub="rice, this season" />
        <Kpi label={<>Rice water footprint <Explain text="Consumptive water (evapotranspiration) per tonne of paddy: green = rain, blue = irrigation. Hoekstra water-footprint convention." /></>} value={wf == null ? "—" : `${num(wf)} m³/t`} sub={`global paddy avg ${num(BENCH.total)} m³/t (incl. grey)`} tone={wf != null && wf > BENCH.green + BENCH.blue ? "warn" : "good"} />
        <Kpi label="Blue share" value={tot.green + tot.blue ? `${Math.round((tot.blue / (tot.green + tot.blue)) * 100)} %` : "—"} sub={`global avg ${Math.round((BENCH.blue / (BENCH.green + BENCH.blue)) * 100)} %`} />
        <Kpi label="Saved by AWD today" value={`${num(tot.saved / 1000)}k m³`} tone="good" sub={`${p.totals.adoptedAssets} adopting assets`} />
        <Kpi label={`Saved at ${p.scenario.targetAdoptionPct} % adoption`} value={`${num(p.scenario.waterSavedM3 / 1000)}k m³`} sub={`full potential ${num(tot.potential / 1000)}k m³`} />
      </div>
      <WhatThisMeans tone="sky">
        {rice.length ? (
          <>
            Your rice draws about {num(tot.withdrawal / 1000)} thousand m³ of irrigation water this season. Alternate wetting and drying typically saves 25–30 % of it with no yield penalty when fields are re-flooded at 15 cm below the surface — {num(tot.potential / 1000)} thousand m³ if every eligible farm adopted, enough to irrigate roughly {num(tot.potential / Math.max(1, tot.withdrawal / Math.max(1, rice.reduce((a, r) => a + r.areaHa, 0))))} more hectares.
          </>
        ) : (
          <>No rice assets with a water balance yet — water footprints appear once rice farms, plots or loans with an area are in the portfolio.</>
        )}
      </WhatThisMeans>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Water footprint by district" subtitle="m³ of evapotranspiration per tonne of paddy — green (rain) vs blue (irrigation)" icon={GlassWater} accent="cyan">
          <div className="h-[280px]">
            <ResponsiveContainer>
              <BarChart data={agg} margin={{ top: 8, right: 6, left: -6, bottom: 0 }}>
                <CartesianGrid stroke={VIZ.grid} vertical={false} />
                <XAxis dataKey="district" {...axisProps} fontSize={10.5} interval={0} />
                <YAxis {...axisProps} tickFormatter={(v) => num(v)} />
                <Tooltip {...tooltipStyle} formatter={(v: number, n) => [`${num(v)} m³/t`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="wfGreen" stackId="w" name="Green (rain)" fill={VIZ.s3} isAnimationActive={false} />
                <Bar dataKey="wfBlue" stackId="w" name="Blue (irrigation)" fill={VIZ.s1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Irrigation withdrawal & AWD savings" subtitle="thousand m³ this season" icon={Droplets} accent="cyan">
          <div className="h-[280px]">
            <ResponsiveContainer>
              <BarChart data={agg.map((g) => ({ ...g, w: g.withdrawal / 1000, s: g.saved / 1000, pot: Math.max(0, g.potential - g.saved) / 1000 }))} margin={{ top: 8, right: 6, left: -6, bottom: 0 }}>
                <CartesianGrid stroke={VIZ.grid} vertical={false} />
                <XAxis dataKey="district" {...axisProps} fontSize={10.5} interval={0} />
                <YAxis {...axisProps} tickFormatter={(v) => num(v)} />
                <Tooltip {...tooltipStyle} formatter={(v: number, n) => [`${num(v, 1)}k m³`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="w" name="Withdrawal" fill={VIZ.s7} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="s" stackId="sv" name="Saved (adopted)" fill={VIZ.good} isAnimationActive={false} />
                <Bar dataKey="pot" stackId="sv" name="Further potential" fill={VIZ.s4} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <div className="flex flex-wrap gap-2">
        <SourceTag>FAO-56 water balance (Yield Forecast engine)</SourceTag>
        <SourceTag href="https://doi.org/10.1016/j.fcr.2016.12.002">Carrijo et al. 2017 — AWD −25.7 % water</SourceTag>
        <SourceTag href="https://doi.org/10.5194/hess-15-1577-2011">Mekonnen & Hoekstra 2011 benchmark</SourceTag>
      </div>
    </div>
  );
}
