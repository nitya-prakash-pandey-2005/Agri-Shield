"use client";

/**
 * Dark-styled Recharts for the supply-chain portal. One y-axis per chart,
 * thin marks, recessive grid, crosshair tooltips.
 */
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { riskColor } from "@/components/hud";
import { AMBER, INK, fmtUsd } from "./theme";
import { ChartTip, axisProps } from "./ui";

const grid = <CartesianGrid stroke={INK.grid} vertical={false} />;
const cursor = { stroke: "rgba(245,158,11,0.45)", strokeWidth: 1 };

type TipProps = { active?: boolean; label?: string | number; payload?: { name?: string; value?: number | string | [number, number]; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }[] };

export function RiskTimelineChart({ data, horizon, height = 220 }: { data: { day: number; date: string; risk: number; flood: number; salinity: number; forecast: boolean }[]; horizon: number; height?: number }) {
  const lastForecast = [...data].reverse().find((d) => d.forecast)?.day ?? 0;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="sc-risk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AMBER} stopOpacity={0.35} />
            <stop offset="100%" stopColor={AMBER} stopOpacity={0} />
          </linearGradient>
        </defs>
        {grid}
        {lastForecast < data.length && <ReferenceArea x1={lastForecast + 0.5} x2={data.length} fill="rgba(148,163,184,0.05)" />}
        <ReferenceArea x1={horizon + 0.5} x2={data.length} fill="rgba(6,10,22,0.45)" />
        <XAxis dataKey="day" {...axisProps} tickFormatter={(d) => `D${d}`} interval={4} />
        <YAxis domain={[0, 100]} {...axisProps} width={42} />
        <ReferenceLine y={60} stroke="rgba(248,113,113,0.35)" strokeDasharray="3 4" />
        <Tooltip
          cursor={cursor}
          content={({ active, payload }: TipProps) => {
            const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
            return p ? (
              <ChartTip
                active={active}
                label={`${p.date} · ${p.forecast ? "Open-Meteo forecast" : "seasonal persistence"}`}
                rows={[
                  { name: "Commodity risk", value: p.risk, color: AMBER },
                  { name: "Flood index", value: p.flood, color: "#3987e5" },
                  { name: "Salinity index", value: p.salinity, color: "#9085e9" },
                ]}
              />
            ) : null;
          }}
        />
        <Area type="monotone" dataKey="risk" stroke={AMBER} strokeWidth={2} fill="url(#sc-risk)" isAnimationActive />
        <Line type="monotone" dataKey="flood" stroke="#3987e5" strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="salinity" stroke="#9085e9" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function PriceBandChart({
  history,
  forecast,
  unit,
  height = 240,
}: {
  history: { date: string; price: number }[];
  forecast: { date: string; median: number; p10: number; p90: number }[];
  unit: string;
  height?: number;
}) {
  const last = history[history.length - 1];
  const rows = [
    ...history.map((h) => ({ date: h.date, price: h.price as number | null, median: null as number | null, band: null as [number, number] | null })),
    ...(last ? [{ date: last.date, price: null, median: last.price, band: [last.price, last.price] as [number, number] }] : []),
    ...forecast.map((f) => ({ date: f.date, price: null, median: f.median, band: [f.p10, f.p90] as [number, number] })),
  ];
  // merge the join point
  const merged = rows.reduce<typeof rows>((acc, r) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.date === r.date) {
      prev.median = r.median ?? prev.median;
      prev.band = r.band ?? prev.band;
    } else acc.push({ ...r });
    return acc;
  }, []);
  const all = [...history.map((h) => h.price), ...forecast.flatMap((f) => [f.p10, f.p90])];
  const lo = Math.floor(Math.min(...all) * 0.97);
  const hi = Math.ceil(Math.max(...all) * 1.03);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={merged} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
        {grid}
        <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => d.slice(5)} minTickGap={28} />
        <YAxis domain={[lo, hi]} {...axisProps} width={48} />
        {last && <ReferenceLine x={last.date} stroke="rgba(245,158,11,0.4)" strokeDasharray="3 3" label={{ value: "NOW", fill: INK.muted, fontSize: 9, position: "insideTopRight" }} />}
        <Tooltip
          cursor={cursor}
          content={({ active, payload, label }: TipProps) => {
            const p = payload?.[0]?.payload as (typeof merged)[number] | undefined;
            if (!p) return null;
            return (
              <ChartTip
                active={active}
                label={label}
                rows={
                  p.price != null
                    ? [{ name: `Price (USD/${unit})`, value: p.price, color: INK.primary }]
                    : [
                        { name: "Forecast median", value: p.median, color: AMBER },
                        { name: "80% band", value: p.band ? `${p.band[0]}–${p.band[1]}` : "—", color: "rgba(245,158,11,0.4)" },
                      ]
                }
              />
            );
          }}
        />
        <Area dataKey="band" stroke="none" fill={AMBER} fillOpacity={0.16} connectNulls isAnimationActive />
        <Line dataKey="price" stroke={INK.primary} strokeWidth={2} dot={false} connectNulls />
        <Line dataKey="median" stroke={AMBER} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function LossHistogram({ histogram, p50, p90, ci, height = 240 }: { histogram: { bucket: number; count: number }[]; p50: number; p90: number; ci: [number, number]; height?: number }) {
  const step = histogram.length > 1 ? histogram[1]!.bucket - histogram[0]!.bucket : 1;
  const data = histogram.map((h) => ({ ...h, mid: h.bucket + step / 2 }));
  const total = histogram.reduce((s, h) => s + h.count, 0) || 1;
  const bucketOf = (v: number) => data.reduce((best, d) => (Math.abs(d.mid - v) < Math.abs(best.mid - v) ? d : best), data[0]!).mid;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: -18 }} barCategoryGap={2}>
        {grid}
        <ReferenceArea x1={bucketOf(ci[0])} x2={bucketOf(ci[1])} fill="rgba(245,158,11,0.07)" stroke="rgba(245,158,11,0.25)" strokeDasharray="3 3" />
        <XAxis dataKey="mid" {...axisProps} tickFormatter={(v: number) => fmtUsd(v, 0)} minTickGap={24} />
        <YAxis {...axisProps} width={42} />
        <Tooltip
          cursor={{ fill: "rgba(245,158,11,0.08)" }}
          content={({ active, payload }: TipProps) => {
            const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
            return p ? <ChartTip active={active} label={`${fmtUsd(p.bucket)} – ${fmtUsd(p.bucket + step)}`} rows={[{ name: "Simulations", value: `${p.count} (${((p.count / total) * 100).toFixed(1)}%)`, color: AMBER }]} /> : null;
          }}
        />
        <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive animationDuration={900}>
          {data.map((d) => (
            <Cell key={d.bucket} fill={d.mid >= p90 ? "#f87171" : d.mid >= p50 ? AMBER : "#3987e5"} fillOpacity={0.85} />
          ))}
        </Bar>
        <ReferenceLine x={bucketOf(p50)} stroke={AMBER} strokeWidth={1.5} label={{ value: "P50", fill: AMBER, fontSize: 10, position: "top" }} />
        <ReferenceLine x={bucketOf(p90)} stroke="#f87171" strokeWidth={1.5} label={{ value: "P90", fill: "#f87171", fontSize: 10, position: "top" }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RecoveryChart({ data, height = 200 }: { data: { day: number; p50: number; p90: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        {grid}
        <XAxis dataKey="day" {...axisProps} tickFormatter={(d) => `D${d}`} minTickGap={20} />
        <YAxis domain={[0, 100]} {...axisProps} width={42} tickFormatter={(v) => `${v}%`} />
        <Tooltip
          cursor={cursor}
          content={({ active, payload, label }: TipProps) => (
            <ChartTip
              active={active}
              label={`Day ${label}`}
              rows={[
                { name: "Supply capacity P50", value: `${payload?.[0]?.payload?.p50 ?? "—"}%`, color: AMBER },
                { name: "Supply capacity P90 (stress)", value: `${payload?.[0]?.payload?.p90 ?? "—"}%`, color: "#f87171" },
              ]}
            />
          )}
        />
        <Area type="monotone" dataKey="p50" stroke={AMBER} strokeWidth={2} fill={AMBER} fillOpacity={0.12} />
        <Line type="monotone" dataKey="p90" stroke="#f87171" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const COUNTRY_COLORS: Record<string, string> = { BD: "#3987e5", VN: "#d95926", PH: "#199e70", IN: "#c98500", ID: "#d55181" };
export function ProductionChart({ series, countries, height = 220, unit = "" }: { series: Record<string, number | null>[]; countries: { code: string; name: string }[]; height?: number; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
        {grid}
        <XAxis dataKey="year" {...axisProps} minTickGap={16} />
        <YAxis {...axisProps} width={48} domain={["auto", "auto"]} />
        <Tooltip
          cursor={cursor}
          content={({ active, payload, label }: TipProps) => (
            <ChartTip active={active} label={label} rows={(payload ?? []).map((p) => ({ name: countries.find((c) => c.code === p.dataKey)?.name ?? String(p.dataKey), value: p.value == null ? "—" : `${Number(p.value).toLocaleString()}${unit}`, color: p.color }))} />
          )}
        />
        {countries.map((c) => (
          <Line key={c.code} dataKey={c.code} name={c.name} stroke={COUNTRY_COLORS[c.code]} strokeWidth={2} dot={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
export const countryColor = (code: string) => COUNTRY_COLORS[code] ?? "#94a3b8";

export function RainChart({ data, height = 150 }: { data: { date: string; rainMm: number; probability: number | null }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -22 }}>
        {grid}
        <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => d.slice(5)} />
        <YAxis {...axisProps} width={40} />
        <Tooltip
          cursor={{ fill: "rgba(56,189,248,0.08)" }}
          content={({ active, payload, label }: TipProps) => (
            <ChartTip active={active} label={label} rows={[{ name: "Rain", value: `${payload?.[0]?.payload?.rainMm ?? 0} mm`, color: "#38bdf8" }, { name: "Probability", value: `${payload?.[0]?.payload?.probability ?? "—"}%` }]} />
          )}
        />
        <Bar dataKey="rainMm" radius={[3, 3, 0, 0]} fill="#38bdf8" fillOpacity={0.8} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DischargeChart({ data, height = 150 }: { data: { date: string; discharge: number | null; mean: number | null; forecast: boolean }[]; height?: number }) {
  const firstF = data.find((d) => d.forecast)?.date;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
        {grid}
        <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
        <YAxis {...axisProps} width={44} />
        {firstF && <ReferenceArea x1={firstF} x2={data[data.length - 1]!.date} fill="rgba(245,158,11,0.06)" />}
        <Tooltip
          cursor={cursor}
          content={({ active, payload, label }: TipProps) => (
            <ChartTip
              active={active}
              label={`${label}${payload?.[0]?.payload?.forecast ? " · forecast" : ""}`}
              rows={[
                { name: "Discharge", value: `${payload?.[0]?.payload?.discharge ?? "—"} m³/s`, color: "#38bdf8" },
                { name: "Ensemble mean", value: `${payload?.[0]?.payload?.mean ?? "—"} m³/s`, color: INK.muted },
              ]}
            />
          )}
        />
        <Area type="monotone" dataKey="discharge" stroke="#38bdf8" strokeWidth={2} fill="#38bdf8" fillOpacity={0.1} connectNulls />
        <Line type="monotone" dataKey="mean" stroke={INK.muted} strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Inline SVG sparkline for table rows. */
export function Sparkline({ values, width = 96, height = 26, color }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values) + 4;
  const min = Math.max(0, Math.min(...values) - 4);
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const c = color ?? riskColor(Math.max(...values));
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={`${d}L${x(values.length - 1)},${height}L${x(0)},${height}Z`} fill={c} fillOpacity={0.12} />
      <path d={d} fill="none" stroke={c} strokeWidth={1.5} />
    </svg>
  );
}
