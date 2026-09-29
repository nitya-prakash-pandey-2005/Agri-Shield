"use client";

/**
 * Explorer charts (Recharts, dark HUD styling). One y-axis per chart; ranges
 * are shaded bands, medians are 2 px lines; every chart has a hover tooltip.
 */
import type { ReactNode } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";
import { riskColor } from "@/components/hud";

export const C = {
  rain: "#38bdf8",
  rainSoft: "rgba(56,189,248,0.22)",
  temp: "#f59e0b",
  heat: "#f43f5e",
  river: "#22d3ee",
  band: "rgba(148,163,184,0.18)",
  median: "#94a3b8",
  green: "#34d399",
  dry: "#d97706",
  wet: "#0ea5e9",
  grid: "rgba(148,163,184,0.10)",
  axis: "#64748b",
};

const tick = { fill: C.axis, fontSize: 10, fontFamily: "var(--font-mono)" };

export function ChartFrame({ title, subtitle, children, height = 200, legend }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; height?: number; legend?: ReactNode }) {
  return (
    <figure className="rounded-xl border border-white/5 bg-slate-950/40 p-3">
      <figcaption className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-medium text-slate-200">{title}</div>
          {subtitle && <div className="text-[11px] text-slate-500">{subtitle}</div>}
        </div>
        {legend && <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-slate-400">{legend}</div>}
      </figcaption>
      <div style={{ height }}>{children}</div>
    </figure>
  );
}

export function LegendKey({ color, label, kind = "line" }: { color: string; label: string; kind?: "line" | "band" | "bar" | "dash" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {kind === "band" ? (
        <span className="h-2.5 w-4 rounded-sm" style={{ background: color }} />
      ) : kind === "bar" ? (
        <span className="h-2.5 w-2 rounded-sm" style={{ background: color }} />
      ) : (
        <span className="h-0.5 w-4" style={{ background: kind === "dash" ? `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 6px)` : color }} />
      )}
      {label}
    </span>
  );
}

type TipRow = { label: string; value: string; color?: string };
function Tip({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#081022]/95 px-2.5 py-2 text-[11px] shadow-xl backdrop-blur">
      <div className="mb-1 telemetry text-slate-400">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-400">
            {r.color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="telemetry text-slate-100">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Generic tooltip that renders rows from a formatter over the hovered datum. */
function tooltip<T>(title: (d: T) => string, rows: (d: T) => TipRow[]) {
  function TooltipContent({ active, payload }: { active?: boolean; payload?: { payload: T }[] }) {
    if (!active || !payload?.length) return null;
    const d = payload[0]!.payload;
    return <Tip title={title(d)} rows={rows(d)} />;
  }
  return <Tooltip cursor={{ stroke: "rgba(148,163,184,0.35)", strokeWidth: 1 }} content={<TooltipContent />} />;
}

const fmtHour = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const n1 = (v: number | null | undefined, u = "") => (v == null ? "–" : `${Math.round(v * 10) / 10}${u}`);

// ─── Composite gauge ─────────────────────────────────────────────────────

export function Gauge({ score, size = 168, label = "Composite risk" }: { score: number; size?: number; label?: string }) {
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from / 100);
    const a1 = Math.PI * (1 - to / 100);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  const color = riskColor(score);
  return (
    <svg width={size} height={size / 2 + 26} viewBox={`0 0 ${size} ${size / 2 + 26}`} role="img" aria-label={`${label}: ${score} out of 100`}>
      {[
        [0, 35, "#4ade80"],
        [35, 60, "#fbbf24"],
        [60, 80, "#f87171"],
        [80, 100, "#a78bfa"],
      ].map(([a, b, c]) => (
        <path key={String(a)} d={arc(Number(a) + 0.8, Number(b) - 0.8)} stroke={String(c)} strokeOpacity={0.22} strokeWidth={10} fill="none" strokeLinecap="butt" />
      ))}
      <motion.path d={arc(0.5, Math.max(1, score))} stroke={color} strokeWidth={10} fill="none" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
      <text x={cx} y={cy - 8} textAnchor="middle" className="telemetry" fill="#fff" fontSize={size / 5} fontWeight={600}>
        {score}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#64748b" fontSize={10} letterSpacing={1.5}>
        / 100
      </text>
    </svg>
  );
}

// ─── Forecast ────────────────────────────────────────────────────────────

export function HourlyRainChart({ hourly }: { hourly: { time: string; precipMm: number; precipProb: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={hourly} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="time" tick={tick} tickFormatter={(t: string) => new Date(t).toLocaleString("en-GB", { weekday: "short", hour: "2-digit" })} interval={11} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={40} />
        {tooltip<(typeof hourly)[number]>((d) => fmtHour(d.time), (d) => [
          { label: "Rain", value: `${n1(d.precipMm)} mm/h`, color: C.rain },
          { label: "Chance of rain", value: `${Math.round(d.precipProb)}%` },
        ])}
        <Bar dataKey="precipMm" fill={C.rain} radius={[2, 2, 0, 0]} maxBarSize={8} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function HourlyTempChart({ hourly }: { hourly: { time: string; tempC: number | null; heatIndexC?: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={hourly} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="time" tick={tick} tickFormatter={(t: string) => new Date(t).toLocaleString("en-GB", { weekday: "short", hour: "2-digit" })} interval={11} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={40} domain={["dataMin - 2", "dataMax + 2"]} tickFormatter={(v: number) => `${Math.round(v)}°`} />
        {tooltip<(typeof hourly)[number]>((d) => fmtHour(d.time), (d) => [
          { label: "Air temperature", value: n1(d.tempC, " °C"), color: C.temp },
          { label: "Feels like (heat index)", value: n1(d.heatIndexC, " °C"), color: C.heat },
        ])}
        <Line dataKey="tempC" stroke={C.temp} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="heatIndexC" stroke={C.heat} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function EnsembleFanChart({ days }: { days: { date: string; p10: number; p50: number; p90: number; mean: number; probHeavy: number }[] }) {
  const data = days.map((d) => ({ ...d, range: [d.p10, d.p90] as [number, number] }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -4 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" tick={tick} tickFormatter={fmtDay} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={40} />
        {tooltip<(typeof data)[number]>((d) => fmtDay(d.date), (d) => [
          { label: "Likely (median)", value: `${n1(d.p50)} mm`, color: C.rain },
          { label: "Range (80% of runs)", value: `${n1(d.p10)}–${n1(d.p90)} mm` },
          { label: "Chance ≥ 20 mm", value: `${Math.round(d.probHeavy * 100)}%` },
        ])}
        <Area dataKey="range" stroke="none" fill={C.rainSoft} isAnimationActive={false} />
        <Line dataKey="p50" stroke={C.rain} strokeWidth={2} dot={{ r: 2.5, fill: C.rain, strokeWidth: 0 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function DailyForecastChart({ daily }: { daily: { date: string; precipMm: number; tMax: number | null; tMin: number | null; et0: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" tick={tick} tickFormatter={fmtDay} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={40} />
        {tooltip<(typeof daily)[number]>((d) => fmtDay(d.date), (d) => [
          { label: "Rain", value: `${n1(d.precipMm)} mm`, color: C.rain },
          { label: "Evaporation (ET₀)", value: `${n1(d.et0)} mm`, color: C.dry },
          { label: "Max / min", value: `${n1(d.tMax)}° / ${n1(d.tMin)}°` },
        ])}
        <Bar dataKey="precipMm" fill={C.rain} radius={[3, 3, 0, 0]} maxBarSize={18} />
        <Line dataKey="et0" stroke={C.dry} strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── River ───────────────────────────────────────────────────────────────

export function RiverChart({ series, returnLevels }: { series: { date: string; value: number | null; p10?: number; p50?: number; p90?: number }[]; returnLevels?: { years: number; dischargeM3s: number }[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const data = series.map((s) => ({ ...s, band: s.p10 != null && s.p90 != null ? ([s.p10, s.p90] as [number, number]) : undefined }));
  const lastDate = data[data.length - 1]?.date;
  const maxV = Math.max(...data.map((d) => Math.max(d.value ?? 0, d.p90 ?? 0)));
  const rl2 = returnLevels?.find((r) => r.years === 2);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 2 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" tick={tick} tickFormatter={fmtDay} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)))} />
        {lastDate && today <= lastDate && <ReferenceArea x1={today} x2={lastDate} fill="rgba(56,189,248,0.06)" stroke="none" label={{ value: "FORECAST", fill: "#475569", fontSize: 9, position: "insideTopRight" }} />}
        {rl2 && rl2.dischargeM3s <= maxV * 1.6 && <ReferenceLine y={rl2.dischargeM3s} stroke="#f87171" strokeDasharray="4 4" label={{ value: "1-in-2-yr flow", fill: "#f87171", fontSize: 9, position: "insideTopLeft" }} />}
        {tooltip<(typeof data)[number]>((d) => fmtDay(d.date) + (d.date >= today ? " · forecast" : ""), (d) => [
          { label: "Discharge", value: `${n1(d.value)} m³/s`, color: C.river },
          { label: "Normal for date (median)", value: `${n1(d.p50)} m³/s`, color: C.median },
          { label: "Usual range (p10–p90)", value: d.p10 != null ? `${n1(d.p10)}–${n1(d.p90)}` : "–" },
        ])}
        <Area dataKey="band" stroke="none" fill={C.band} isAnimationActive={false} />
        <Line dataKey="p50" stroke={C.median} strokeWidth={1.25} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
        <Line dataKey="value" stroke={C.river} strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── Climate history ─────────────────────────────────────────────────────

export function AnnualTrendChart<T extends { year: number }>({ data, dataKey, unit, color, trend }: { data: T[]; dataKey: keyof T & string; unit: string; color: string; trend?: { slopePerDecade: number; intercept: number } }) {
  const rows = data.map((d) => ({ ...d, fit: trend ? trend.intercept + (trend.slopePerDecade / 10) * d.year : undefined }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="year" tick={tick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={20} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={46} domain={["auto", "auto"]} />
        {tooltip<(typeof rows)[number]>((d) => String(d.year), (d) => [
          { label: "Observed", value: `${n1(d[dataKey] as number)} ${unit}`, color },
          ...(d.fit != null ? [{ label: "Trend line", value: `${n1(d.fit)} ${unit}`, color: "#e2e8f0" }] : []),
        ])}
        <Bar dataKey={dataKey} fill={color} fillOpacity={0.75} radius={[2, 2, 0, 0]} maxBarSize={10} />
        {trend && <Line dataKey="fit" stroke="#e2e8f0" strokeWidth={1.75} strokeDasharray="5 3" dot={false} isAnimationActive={false} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function NormalsChart({ normals }: { normals: { month: number; rainMm: number; tMaxC: number | null }[] }) {
  const M = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const full = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={normals} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="month" tick={tick} tickFormatter={(m: number) => M[m - 1]!} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={40} />
        {tooltip<(typeof normals)[number]>((d) => `${full[d.month - 1]} (1991–2020 normal)`, (d) => [
          { label: "Rain", value: `${d.rainMm} mm`, color: C.rain },
          { label: "Avg daily max", value: n1(d.tMaxC, " °C") },
        ])}
        <Bar dataKey="rainMm" fill={C.rain} radius={[3, 3, 0, 0]} maxBarSize={20} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── Outlook ─────────────────────────────────────────────────────────────

export function SeasonalAnomalyChart({ months }: { months: { month: string; precipAnomPct: number | null; precipMm: number; precipAnomMm: number; tempAnomC: number }[] }) {
  const data = months.map((m) => ({ ...m, v: m.precipAnomPct ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="month" tick={tick} axisLine={false} tickLine={false} tickFormatter={(m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" })} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`} />
        <ReferenceLine y={0} stroke="#475569" />
        {tooltip<(typeof data)[number]>((d) => new Date(`${d.month}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }), (d) => [
          { label: "Rain vs normal", value: d.precipAnomPct == null ? "–" : `${d.precipAnomPct > 0 ? "+" : ""}${d.precipAnomPct}%`, color: d.v >= 0 ? C.wet : C.dry },
          { label: "Expected rain", value: `${Math.round(d.precipMm)} mm (normal ${Math.round(d.precipMm - d.precipAnomMm)})` },
          { label: "Temperature vs normal", value: `${d.tempAnomC > 0 ? "+" : ""}${d.tempAnomC} °C` },
        ])}
        <Bar dataKey="v" radius={[3, 3, 3, 3]} maxBarSize={26}>
          {data.map((d) => (
            <Cell key={d.month} fill={d.v >= 0 ? C.wet : C.dry} fillOpacity={Math.abs(d.v) < 10 ? 0.45 : 0.9} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function HeatDaysChart({ days }: { days: { date: string; tMaxC: number; heatIndexMaxC: number; wetBulbMaxC: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={days} margin={{ top: 6, right: 4, bottom: 0, left: -4 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" tick={tick} tickFormatter={fmtDay} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={40} domain={["dataMin - 3", "dataMax + 3"]} tickFormatter={(v: number) => `${Math.round(v)}°`} />
        <ReferenceArea y1={41} y2={60} fill="rgba(244,63,94,0.07)" stroke="none" />
        <ReferenceLine y={41} stroke="#f43f5e" strokeDasharray="4 4" label={{ value: "Danger 41°", fill: "#f43f5e", fontSize: 9, position: "insideTopLeft" }} />
        {tooltip<(typeof days)[number]>((d) => fmtDay(d.date), (d) => [
          { label: "Max air temp", value: `${d.tMaxC} °C`, color: C.temp },
          { label: "Max heat index", value: `${d.heatIndexMaxC} °C`, color: C.heat },
          { label: "Max wet-bulb", value: `${d.wetBulbMaxC} °C`, color: "#a78bfa" },
        ])}
        <Line dataKey="tMaxC" stroke={C.temp} strokeWidth={2} dot={{ r: 3, fill: C.temp, strokeWidth: 0 }} isAnimationActive={false} />
        <Line dataKey="heatIndexMaxC" stroke={C.heat} strokeWidth={2} dot={{ r: 3, fill: C.heat, strokeWidth: 0 }} isAnimationActive={false} />
        <Line dataKey="wetBulbMaxC" stroke="#a78bfa" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3, fill: "#a78bfa", strokeWidth: 0 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
