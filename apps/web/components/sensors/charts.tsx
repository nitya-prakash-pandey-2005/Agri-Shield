"use client";

/**
 * Sensor charts (Recharts, dark). One metric per chart (never dual axes):
 * mean line + min/max envelope for downsampled ranges, rain as bars,
 * anomaly spans shaded by class, warning/danger stage lines, crosshair tooltip.
 */
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { METRIC_META, type Anomaly, type MetricKey, type SeriesPoint } from "@/server/services/iot-types";
import { CLASS_META, fmtMetric } from "./meta";

const AXIS = { stroke: "#475569", fontSize: 10, tickLine: false, axisLine: false } as const;
const GRID = { stroke: "#1e293b", strokeDasharray: "2 4", vertical: false } as const;

function tickFmt(range: string) {
  return (t: number) => {
    const d = new Date(t);
    if (range === "1h" || range === "24h") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { day: "numeric", month: "short" });
  };
}

export function MetricChart({
  points,
  metric,
  range,
  from,
  to,
  anomalies = [],
  thresholds,
  height = 210,
}: {
  points: SeriesPoint[];
  metric: MetricKey;
  range: string;
  from: number;
  to: number;
  anomalies?: Pick<Anomaly, "id" | "start" | "end" | "cls" | "title" | "metric" | "kind">[];
  thresholds?: { warning: number | null; danger: number | null };
  height?: number;
}) {
  const meta = METRIC_META[metric];
  const data = points.map((p) => ({ t: p.t, v: p.v, band: p.min != null && p.max != null ? [p.min, p.max] : undefined }));
  const hasBand = data.some((d) => d.band && d.band[0] !== d.band[1]);
  const isRain = meta.agg === "sum";
  const values = points.flatMap((p) => [p.min ?? p.v, p.max ?? p.v]);
  const showThr = metric === "water_level_m" && thresholds;
  if (showThr) {
    if (thresholds.warning != null) values.push(thresholds.warning);
    if (thresholds.danger != null) values.push(thresholds.danger);
  }
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const pad = Math.max((hi - lo) * 0.08, 10 ** -meta.decimals);
  const domain: [number, number] = isRain ? [0, Math.max(1, hi * 1.1)] : [lo - pad, hi + pad];
  const mine = anomalies.filter((a) => a.metric === metric && a.end >= from);
  const gid = `g-${metric}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={meta.color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={meta.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="t" type="number" scale="time" domain={[from, to]} tickFormatter={tickFmt(range)} {...AXIS} minTickGap={40} />
        <YAxis domain={domain} {...AXIS} width={46} tickFormatter={(v: number) => v.toFixed(hi - lo < 0.2 ? 2 : hi - lo < 3 ? Math.max(1, Math.min(2, meta.decimals)) : hi - lo < 30 ? Math.min(1, meta.decimals) : 0)} />
        {mine.map((a) => (
          <ReferenceArea key={a.id} x1={a.start} x2={Math.max(a.end, a.start + (to - from) / 150)} fill={CLASS_META[a.cls].color} fillOpacity={0.14} stroke={CLASS_META[a.cls].color} strokeOpacity={0.35} ifOverflow="hidden" />
        ))}
        {showThr && thresholds.warning != null && <ReferenceLine y={thresholds.warning} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: `warning ${thresholds.warning} m`, fill: "#fbbf24", fontSize: 10, position: "insideTopLeft" }} />}
        {showThr && thresholds.danger != null && <ReferenceLine y={thresholds.danger} stroke="#f87171" strokeDasharray="4 4" label={{ value: `danger ${thresholds.danger} m`, fill: "#f87171", fontSize: 10, position: "insideTopLeft" }} />}
        <Tooltip
          cursor={{ stroke: "#64748b", strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as { t: number; v: number; band?: [number, number] };
            const hit = mine.find((a) => p.t >= a.start - (to - from) / 300 && p.t <= a.end + (to - from) / 300);
            return (
              <div className="rounded-lg border border-white/10 bg-[#070d1c]/95 px-3 py-2 text-[11px] text-slate-300 shadow-xl">
                <div className="text-slate-500">{new Date(p.t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                <div className="font-medium text-white telemetry">
                  {isRain && range !== "1h" && range !== "24h" ? "Total " : ""}
                  {fmtMetric(metric, p.v)}
                </div>
                {p.band && p.band[0] !== p.band[1] && !isRain && (
                  <div className="text-slate-500">
                    range {fmtMetric(metric, p.band[0], false)} – {fmtMetric(metric, p.band[1])}
                  </div>
                )}
                {hit && <div className="mt-1 max-w-[220px]" style={{ color: CLASS_META[hit.cls].color }}>{hit.title}</div>}
              </div>
            );
          }}
        />
        {isRain && <Bar dataKey="v" fill={meta.color} fillOpacity={0.85} radius={[2, 2, 0, 0]} isAnimationActive={false} />}
        {!isRain && hasBand && <Area dataKey="band" stroke="none" fill={meta.color} fillOpacity={0.14} isAnimationActive={false} activeDot={false} />}
        {!isRain && <Area dataKey="v" stroke="none" fill={`url(#${gid})`} isAnimationActive={false} activeDot={false} baseValue={domain[0]} />}
        {!isRain && <Line dataKey="v" stroke={meta.color} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#070d1c" }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Tiny inline trend line for device rows / cards. */
export function Spark({ values, color, width = 96, height = 26 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-[10px] text-slate-600">no data</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      <circle cx={last[0]} cy={last[1]} r={2.2} fill={color} />
    </svg>
  );
}
