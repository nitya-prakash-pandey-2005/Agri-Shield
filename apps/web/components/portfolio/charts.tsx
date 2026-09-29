"use client";

/**
 * Portfolio charts (Recharts, dark). Single-series charts carry no legend box
 * (the panel title names them); level/hazard colours always come with a text
 * label; every mark has a hover tooltip.
 */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HAZARD_META, LEVEL_COLOR, fmtUsd, levelOf, type HazardKey } from "./format";

const AXIS = { stroke: "#475569", fontSize: 10, tickLine: false, axisLine: false } as const;
const GRID = { stroke: "#1e293b", strokeDasharray: "2 4", vertical: false } as const;

function TipBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-white/10 bg-[#070d1c]/95 px-3 py-2 text-[11px] text-slate-300 shadow-xl">{children}</div>;
}

/** Tiny inline trend line for table rows. */
export function Sparkline({ values, width = 84, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-[10px] text-slate-600">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const last = values[values.length - 1]!;
  const c = LEVEL_COLOR[levelOf(last)]!;
  return (
    <svg width={width} height={height} className="overflow-visible" aria-label={`30-day composite from ${values[0]} to ${last}`}>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={c} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r={2.2} fill={c} />
    </svg>
  );
}

/** Distribution of composite scores (10-point bins), bars coloured by the level they fall in. */
export function RiskHistogram({ data, threshold, height = 190 }: { data: { bin: string; from: number; count: number; exposure: number }[]; threshold: number; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -22, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="from" {...AXIS} tickFormatter={(v: number) => `${v}`} />
        <YAxis {...AXIS} allowDecimals={false} />
        <ReferenceLine x={Math.floor(threshold / 10) * 10} stroke="#f87171" strokeDasharray="3 3" label={{ value: `at-risk ≥ ${threshold}`, fill: "#f87171", fontSize: 10, position: "insideTopRight" }} />
        <Tooltip
          cursor={{ fill: "rgba(148,163,184,0.06)" }}
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <TipBox>
                <div className="font-medium text-white">Score {(payload[0].payload as { bin: string }).bin}</div>
                <div>{(payload[0].payload as { count: number }).count} assets · {fmtUsd((payload[0].payload as { exposure: number }).exposure)} exposure</div>
              </TipBox>
            ) : null
          }
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={36}>
          {data.map((d) => (
            <Cell key={d.bin} fill={LEVEL_COLOR[levelOf(d.from + 5)]} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Value-at-risk by hazard (horizontal bars, direct-labelled). */
export function HazardBars({ data }: { data: { hazard: string; varUsd: number; avgScore: number; dominantCount: number; mdr: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.varUsd));
  return (
    <div className="space-y-3">
      {data.map((d) => {
        const m = HAZARD_META[d.hazard as HazardKey];
        return (
          <div key={d.hazard} className="group" title={`${m.label}: value-at-risk ${fmtUsd(d.varUsd, false)}; exposure-weighted score ${d.avgScore}/100; dominant hazard for ${d.dominantCount} assets; mean damage ratio ${Math.round(d.mdr * 100)}%`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-slate-300">
                <span className="h-2 w-2 rounded-sm" style={{ background: m.color }} />
                {m.label}
                <span className="text-slate-500">· score {d.avgScore} · top hazard for {d.dominantCount}</span>
              </span>
              <span className="telemetry text-slate-200">{fmtUsd(d.varUsd)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800/80">
              <div className="h-full rounded-full transition-all duration-700 group-hover:brightness-125" style={{ width: `${(d.varUsd / max) * 100}%`, background: m.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 30-day average composite (single series). */
export function TrendChart({ data, height = 180, threshold }: { data: { date: string; avg: number; weighted: number | null }[]; height?: number; threshold?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="pf-trend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
        <YAxis {...AXIS} domain={[0, 100]} ticks={[0, 35, 60, 80, 100]} />
        {threshold != null && <ReferenceLine y={threshold} stroke="#f87171" strokeDasharray="3 3" />}
        <Tooltip
          cursor={{ stroke: "#64748b", strokeDasharray: "3 3" }}
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <TipBox>
                <div className="font-medium text-white">{(payload[0].payload as { date: string }).date}</div>
                <div>Average composite {(payload[0].payload as { avg: number }).avg}</div>
                {(payload[0].payload as { weighted: number | null }).weighted != null && <div className="text-slate-400">Exposure-weighted {(payload[0].payload as { weighted: number }).weighted}</div>}
              </TipBox>
            ) : null
          }
        />
        <Area type="monotone" dataKey="avg" stroke="#38bdf8" strokeWidth={2} fill="url(#pf-trend)" dot={false} activeDot={{ r: 4, stroke: "#0b1224", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Asset composite history with level bands. */
export function HistoryChart({ data, height = 220 }: { data: { date: string; composite: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="pf-hist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => d.slice(5)} minTickGap={28} />
        <YAxis {...AXIS} domain={[0, 100]} ticks={[0, 35, 60, 80, 100]} />
        <ReferenceLine y={35} stroke={LEVEL_COLOR.medium} strokeOpacity={0.35} strokeDasharray="2 4" />
        <ReferenceLine y={60} stroke={LEVEL_COLOR.high} strokeOpacity={0.35} strokeDasharray="2 4" />
        <ReferenceLine y={80} stroke={LEVEL_COLOR.critical} strokeOpacity={0.35} strokeDasharray="2 4" />
        <Tooltip
          cursor={{ stroke: "#64748b", strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const p = payload[0].payload as { date: string; composite: number };
            return (
              <TipBox>
                <div className="font-medium text-white">{p.date}</div>
                <div>
                  Composite <b style={{ color: LEVEL_COLOR[levelOf(p.composite)] }}>{p.composite}</b> · {levelOf(p.composite)}
                </div>
              </TipBox>
            );
          }}
        />
        <Area type="monotone" dataKey="composite" stroke="#38bdf8" strokeWidth={2} fill="url(#pf-hist)" dot={false} activeDot={{ r: 4, stroke: "#0b1224", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Daily rain bars for the full location report. */
export function RainBars({ data, height = 150 }: { data: { date: string; precipMm: number; precipProb: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -24, bottom: 0 }} barCategoryGap={4}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => d.slice(5)} />
        <YAxis {...AXIS} />
        <Tooltip
          cursor={{ fill: "rgba(148,163,184,0.06)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const p = payload[0].payload as { date: string; precipMm: number; precipProb: number };
            return (
              <TipBox>
                <div className="font-medium text-white">{p.date}</div>
                <div>
                  {p.precipMm.toFixed(1)} mm · {p.precipProb}% chance of rain
                </div>
              </TipBox>
            );
          }}
        />
        <Bar dataKey="precipMm" fill="#3494d4" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
