"use client";

/**
 * Budget planning tool — cost of inaction vs proactive investment.
 * Runs the same pure model as the server (`gov-budget.ts`) on every slider move.
 */
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Calculator, RotateCcw, Sparkles } from "lucide-react";
import { AnimatedNumber, HudButton, Panel, SourceTag } from "@/components/hud";
import type { RouterOutputs } from "@/lib/trpc";
import { computeBudget, type BudgetCategory } from "@/server/data/gov-budget";
import { cn } from "@/lib/utils";
import { CHART, ChartTooltip, fmtUsd } from "./ui";

type Briefs = RouterOutputs["government"]["getPolicyBriefs"];

const INACTION = "#d97706";
const PROACTIVE = "#059669";

function Slider({ label, value, min, max, step, onChange, format, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-slate-200">{label}</span>
        <span className="telemetry text-[12px] text-emerald-300">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 w-full cursor-pointer accent-emerald-500" />
      {hint && <div className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{hint}</div>}
    </label>
  );
}

function Out({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
      <div className="hud-label text-[9.5px]">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold", tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-amber-300" : "text-white")}>{children}</div>
    </div>
  );
}

export function BudgetPlanner({ data }: { data: Briefs }) {
  const toM = (p: Partial<Record<BudgetCategory, number>>) => Object.fromEntries(data.categories.map((c) => [c.key, Math.round((p[c.key] ?? 0) / 100_000) / 10])) as Record<BudgetCategory, number>;
  const [invest, setInvest] = useState<Record<BudgetCategory, number>>(() => toM(data.recommendedPortfolio));
  const [horizon, setHorizon] = useState(15);
  const [rate, setRate] = useState(8);
  const [trend, setTrend] = useState(2.5);
  useEffect(() => setInvest(toM(data.recommendedPortfolio)), [data.recommendedPortfolio]); // eslint-disable-line react-hooks/exhaustive-deps

  const res = useMemo(
    () =>
      computeBudget(
        Object.fromEntries(Object.entries(invest).map(([k, v]) => [k, v * 1_000_000])),
        { floodAnnualLossUsd: data.baseline.floodAnnualLossUsd, salinityAnnualLossUsd: data.baseline.salinityAnnualLossUsd },
        { horizonYears: horizon, discountRate: rate / 100, climateTrendPct: trend }
      ),
    [invest, horizon, rate, trend, data.baseline]
  );
  const breakEven = res.yearly.find((y) => y.proactive <= y.inaction)?.year ?? null;
  const chartData = useMemo(() => res.yearly.map((y) => ({ ...y, label: `Year ${y.year}` })), [res.yearly]);
  const maxAvoided = Math.max(1, ...res.perCategory.map((c) => c.avoidedAnnualUsd));

  return (
    <Panel
      title="Budget planning — cost of inaction vs proactive investment"
      subtitle={`Baseline annual loss ${fmtUsd(data.baseline.floodAnnualLossUsd + data.baseline.salinityAnnualLossUsd)} (flood ${fmtUsd(data.baseline.floodAnnualLossUsd)} from archive · salinity ${fmtUsd(data.baseline.salinityAnnualLossUsd)} from live EC)`}
      icon={Calculator}
      accent="emerald"
      actions={
        <>
          <HudButton variant="outline" className="h-8 px-2.5 text-xs" onClick={() => setInvest(toM(data.recommendedPortfolio))}>
            <Sparkles size={13} /> Recommended ({fmtUsd(data.suggestedBudgetUsd)})
          </HudButton>
          <HudButton variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setInvest(toM({}))}>
            <RotateCcw size={13} /> Reset
          </HudButton>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[340px,1fr]">
        <div className="space-y-4">
          <div className="hud-label">Capital investment by category ($M)</div>
          {data.categories.map((c) => (
            <Slider
              key={c.key}
              label={c.label}
              value={invest[c.key]}
              min={0}
              max={Math.max(5, Math.round((c.scaleUsd * 3) / 1e6))}
              step={0.5}
              onChange={(v) => setInvest((s) => ({ ...s, [c.key]: v }))}
              format={(v) => `$${v.toFixed(1)}M`}
              hint={`${c.description} · ${c.hazard} · ${c.lifetimeYears}-yr life`}
            />
          ))}
          <div className="hud-divider" />
          <div className="hud-label">Appraisal assumptions</div>
          <Slider label="Horizon" value={horizon} min={5} max={30} step={1} onChange={setHorizon} format={(v) => `${v} yrs`} />
          <Slider label="Discount rate" value={rate} min={0} max={15} step={0.5} onChange={setRate} format={(v) => `${v}%`} />
          <Slider label="Climate loss trend" value={trend} min={0} max={6} step={0.5} onChange={setTrend} format={(v) => `+${v}%/yr`} hint="Annual growth of baseline losses under climate change" />
        </div>

        <div className="space-y-5 min-w-0">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            <Out label="Total investment">
              <AnimatedNumber value={res.totalInvestUsd / 1e6} decimals={1} prefix="$" suffix="M" />
            </Out>
            <Out label="Avoided loss / year" tone="good">
              <AnimatedNumber value={res.avoidedAnnualUsd / 1e6} decimals={1} prefix="$" suffix="M" />
            </Out>
            <Out label="Benefit–cost ratio" tone={res.bcr >= 1 ? "good" : "bad"}>
              <AnimatedNumber value={res.bcr} decimals={2} suffix="×" />
            </Out>
            <Out label="Payback">{res.paybackYears == null ? <span className="telemetry text-slate-500">—</span> : <AnimatedNumber value={res.paybackYears} decimals={1} suffix=" yrs" />}</Out>
            <Out label={`NPV · ${horizon} yrs`} tone={res.npvUsd >= 0 ? "good" : "bad"}>
              <AnimatedNumber value={res.npvUsd / 1e6} decimals={1} prefix="$" suffix="M" />
            </Out>
            <Out label="Cost of inaction (PV)" tone="bad">
              <AnimatedNumber value={res.costOfInactionUsd / 1e6} decimals={1} prefix="$" suffix="M" />
            </Out>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="hud-label">Cumulative cost over {horizon} years</span>
              <span className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: INACTION }} /> Inaction (losses)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PROACTIVE }} /> Proactive (capex + O&amp;M + residual loss)
                </span>
              </span>
            </div>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="bp-in" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={INACTION} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={INACTION} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="bp-pro" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PROACTIVE} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={PROACTIVE} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={CHART.axis} axisLine={false} tickLine={false} tickFormatter={(v: string) => v.replace("Year ", "Y")} />
                  <YAxis tick={CHART.axis} axisLine={false} tickLine={false} tickFormatter={(v) => fmtUsd(v)} width={56} />
                  <Tooltip content={<ChartTooltip format={(v) => fmtUsd(v)} />} cursor={{ stroke: "#334155" }} />
                  {breakEven && <ReferenceLine x={`Year ${breakEven}`} stroke="#e2e8f0" strokeDasharray="4 3" label={{ value: `Break-even Y${breakEven}`, fill: "#e2e8f0", fontSize: 10, position: "insideTopLeft" }} />}
                  <Area type="monotone" dataKey="inaction" name="Inaction" stroke={INACTION} strokeWidth={2} fill="url(#bp-in)" />
                  <Area type="monotone" dataKey="proactive" name="Proactive" stroke={PROACTIVE} strokeWidth={2} fill="url(#bp-pro)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {breakEven ? `Proactive spending becomes cheaper than inaction in year ${breakEven}.` : res.totalInvestUsd ? "Within this horizon the portfolio does not break even — shift budget toward categories with higher marginal BCR." : "No investment: cumulative losses grow with the climate trend."}
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="hud-label">Contribution by category · avoided loss per year</span>
              <span className="hud-label">marginal BCR of next $1M</span>
            </div>
            <div className="space-y-2">
              {res.perCategory.map((c) => (
                <div key={c.key} className="grid grid-cols-[minmax(120px,190px),1fr,64px] items-center gap-3 text-[11.5px]">
                  <span className="truncate text-slate-300" title={c.label}>
                    {c.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 flex-1 rounded-sm bg-slate-800/70">
                      <div className="h-full rounded-sm bg-emerald-600 transition-[width] duration-500" style={{ width: `${(c.avoidedAnnualUsd / maxAvoided) * 100}%` }} />
                    </div>
                    <span className="w-16 text-right telemetry text-slate-100">{fmtUsd(c.avoidedAnnualUsd)}</span>
                  </div>
                  <span className={cn("text-right telemetry", c.marginalBcr >= 1 ? "text-emerald-300" : "text-slate-500")}>{c.marginalBcr.toFixed(2)}×</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <SourceTag>Flood archive 2020–2025</SourceTag>
            <SourceTag>Live EC · Open-Meteo marine</SourceTag>
            <SourceTag>Saturating-return model</SourceTag>
          </div>
        </div>
      </div>
    </Panel>
  );
}
