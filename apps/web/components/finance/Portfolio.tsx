"use client";

/**
 * Loan-book view: EL and EL uplift, rating migration (baseline vs climate),
 * crop/region concentration heatmap, watchlist and 72-hour early-warning list.
 */
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertOctagon, BarChart3, Eye, Grid3x3, Landmark, TrendingDown, Wallet } from "lucide-react";
import { EmptyState, Panel, StatTile } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { axisProps, pct, tooltipStyle, usd, VIZ, WhatThisMeans } from "@/components/insurance/kit";
import { RatingBadge, type FinBook } from "./Credit";

export default function Portfolio({ book, onOpen }: { book: FinBook; onOpen: (id: string) => void }) {
  const s = book.summary;
  const watch = [...book.loans].filter((l) => l.notches > 0 && l.stage !== 3).sort((a, b) => b.notches - a.notches || b.elUpliftUsd - a.elUpliftUsd).slice(0, 12);
  const early = book.loans.filter((l) => l.activeHazard && l.dpd > 0).sort((a, b) => b.dpd - a.dpd);
  const hazardOnly = book.loans.filter((l) => l.activeHazard && l.dpd === 0).length;
  const maxEad = Math.max(1, ...s.heatmap.rows.flatMap((r) => r.cells.map((c) => c.eadUsd)));
  const seqColor = (v: number) => VIZ.seq[Math.min(VIZ.seq.length - 1, Math.floor((v / maxEad) * (VIZ.seq.length - 0.01)))]!;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Exposure at default" value={s.eadUsd / 1e3} decimals={0} prefix="$" suffix="k" icon={Wallet} accent="cyan" delta={`${s.loans} loans · avg LGD ${pct(s.lgdPct, 0)}`} deltaGood />
        <StatTile label="Expected loss (12 m, climate)" value={s.elUsd / 1e3} decimals={1} prefix="$" suffix="k" icon={Landmark} accent="amber" delta={`baseline ${usd(s.elBaseUsd)} · lifetime ${usd(s.lifetimeElUsd)}`} deltaGood={false} />
        <StatTile label="EL uplift from climate" value={s.elUpliftPct} decimals={0} prefix="+" suffix="%" icon={TrendingDown} accent="red" delta={`+${usd(s.elUpliftUsd)} a year`} deltaGood={false} />
        <StatTile label="Climate downgrades" value={s.downgraded} icon={AlertOctagon} accent="violet" delta={`${usd(s.downgradedEadUsd)} EAD · ${s.stage2} Stage 2 · ${s.stage3} Stage 3`} deltaGood={false} />
      </div>
      <WhatThisMeans tone={early.length ? "amber" : "sky"}>
        Flood and salinity drive most of the climate uplift ({s.hazardShare.map((h) => `${h.hazard} +${h.pp.toFixed(2)} pp`).join(", ")} of average PD). The largest pocket of risk is <b className="text-white">{s.byRegion[0]?.key}</b> with {usd(s.byRegion[0]?.eadUsd)} outstanding.{" "}
        {early.length ? (
          <>
            <b className="text-amber-200">{early.length} borrower{early.length > 1 ? "s are" : " is"} already in arrears and facing an active hazard in the next 72 h</b> — call them now to restructure or defer instalments before the loss crystallises.
          </>
        ) : (
          <>No borrower in arrears faces an active hazard right now{hazardOnly ? ` (${hazardOnly} performing loans do — worth a courtesy call)` : ""}.</>
        )}
      </WhatThisMeans>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Rating distribution — baseline vs climate-adjusted" subtitle="Exposure (EAD) by rating band" icon={BarChart3} accent="cyan">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={s.byRating} margin={{ top: 6, right: 6, left: -4, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke={VIZ.grid} vertical={false} />
                <XAxis dataKey="rating" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={(v) => usd(v, 0)} />
                <Tooltip {...tooltipStyle} formatter={(v: number, n) => [usd(v), n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="baseEadUsd" name="Internal rating" fill={VIZ.s1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="climateEadUsd" name="Climate-adjusted" fill={VIZ.s2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Expected loss by crop" subtitle="Baseline vs climate-adjusted (12 m)" icon={BarChart3} accent="cyan">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={s.byCrop} margin={{ top: 6, right: 6, left: -4, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke={VIZ.grid} vertical={false} />
                <XAxis dataKey="key" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={(v) => usd(v, 0)} />
                <Tooltip {...tooltipStyle} formatter={(v: number, n) => [usd(v), n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="elBaseUsd" name="Baseline EL" fill={VIZ.s1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="elUsd" name="Climate EL" fill={VIZ.s2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title={<>Concentration heatmap <Explain term="exposure" /></>} subtitle="Cell shade = exposure (EAD); number = EL uplift from climate" icon={Grid3x3} accent="cyan" bodyClassName="px-0 pb-3">
        <div className="overflow-x-auto px-4">
          <table className="w-full min-w-[640px] border-separate border-spacing-[2px] text-[11.5px]">
            <thead>
              <tr>
                <th className="py-1 text-left font-medium text-slate-500">Region</th>
                {s.heatmap.crops.map((c) => (
                  <th key={c} className="py-1 font-medium capitalize text-slate-400">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.heatmap.rows.map((r) => (
                <tr key={r.region}>
                  <td className="whitespace-nowrap pr-2 text-slate-300">{r.region}</td>
                  {r.cells.map((c) => (
                    <td key={c.crop} title={`${r.region} · ${c.crop}: ${c.loans} loans, EAD ${usd(c.eadUsd)}, EL ${usd(c.elUsd)} (+${c.upliftPct.toFixed(0)}% from climate)`} className="h-9 rounded text-center telemetry" style={{ background: c.eadUsd ? seqColor(c.eadUsd) : "rgba(148,163,184,0.05)", color: c.eadUsd / maxEad > 0.45 ? "#e2e8f0" : "#0f172a" }}>
                      {c.eadUsd ? `+${c.upliftPct.toFixed(0)}%` : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
            EAD
            {VIZ.seq.map((c) => (
              <span key={c} className="h-2.5 w-6 rounded-sm" style={{ background: c }} />
            ))}
            {usd(maxEad)}
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Watchlist — top climate downgrades" icon={Eye} accent="cyan" bodyClassName="px-0 pb-2">
          <List loans={watch} onOpen={onOpen} extra={(l) => `+${usd(l.elUpliftUsd)} EL`} />
        </Panel>
        <Panel title="Early warning — hazard in next 72 h & in arrears" icon={AlertOctagon} accent="red" live bodyClassName="px-0 pb-2">
          {early.length ? (
            <>
              <List loans={early.slice(0, 12)} onOpen={onOpen} extra={(l) => `${l.dpd} DPD · ${l.activeHazard}`} />
              {early.length > 12 && <div className="px-4 pt-2 text-[11.5px] text-slate-500">+{early.length - 12} more — export the loan book CSV from the Credit risk tab for the full list.</div>}
            </>
          ) : (
            <EmptyState icon={AlertOctagon} title="No early-warning cases">
              No borrower with days-past-due faces an active flood, salinity or drought hazard in the live forecast.
            </EmptyState>
          )}
        </Panel>
      </div>
    </div>
  );
}

function List({ loans, onOpen, extra }: { loans: FinBook["loans"]; onOpen: (id: string) => void; extra: (l: FinBook["loans"][number]) => string }) {
  return (
    <div className="divide-y divide-slate-800/60">
      {loans.map((l) => (
        <button key={l.id} onClick={() => onOpen(l.id)} className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left hover:bg-white/[0.03]">
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] text-slate-200">{l.name}</span>
            <span className="block truncate text-[11px] text-slate-500">
              {l.region}, {l.country} · {usd(l.eadUsd)} · {l.drivers[0]?.split(":")[0]}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <RatingBadge r={l.ratingBase} />→<RatingBadge r={l.ratingClimate} />
            <span className="hidden w-32 text-right text-[11px] text-amber-200 sm:inline">{extra(l)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
