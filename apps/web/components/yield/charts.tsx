"use client";

/**
 * Yield charts: drivers waterfall (% of the 5-yr normal), forecast evolution fan
 * (P10–P90 band + P50 line + normal) and the forecast distribution histogram.
 */
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, num, tooltipStyle, VIZ } from "@/components/insurance/kit";

export interface DriverIn {
  key: string;
  label: string;
  pct: number;
}

const SHORT: Record<string, string> = { trend: "Trend", water: "Water", heat: "Heat", flood: "Flood", salinity: "Salinity", ndvi: "NDVI" };

/** Multiplicative waterfall: 100 % normal → each driver → forecast. */
export function waterfallData(drivers: DriverIn[], forecastPct?: number) {
  let v = 100;
  const rows: { name: string; base: number; delta: number; value: number; kind: "total" | "up" | "down"; pct: number; label: string }[] = [{ name: "Normal", base: 0, delta: 100, value: 100, kind: "total", pct: 0, label: "FAOSTAT 5-yr normal (2020-24) for this season" }];
  for (const d of drivers) {
    const next = v * (1 + d.pct / 100);
    rows.push({ name: SHORT[d.key] ?? d.label, base: Math.min(v, next), delta: Math.abs(next - v), value: next, kind: next >= v ? "up" : "down", pct: d.pct, label: d.label });
    v = next;
  }
  const end = forecastPct ?? v;
  rows.push({ name: "Forecast", base: 0, delta: end, value: end, kind: "total", pct: end - 100, label: "Forecast P50 as % of normal" });
  return rows;
}

export function Waterfall({ drivers, forecastPct, height = 230 }: { drivers: DriverIn[]; forecastPct?: number; height?: number }) {
  const data = waterfallData(drivers, forecastPct);
  const lo = Math.max(0, Math.floor((Math.min(...data.map((d) => d.base || d.value)) - 8) / 10) * 10);
  const hi = Math.ceil((Math.max(...data.map((d) => d.base + d.delta)) + 4) / 10) * 10;
  return (
    <div style={{ height }} role="img" aria-label={`Yield drivers: ${data.map((d) => `${d.name} ${d.kind === "total" ? d.value.toFixed(0) + "%" : (d.pct > 0 ? "+" : "") + d.pct.toFixed(1) + "%"}`).join(", ")}`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 16, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis dataKey="name" {...axisProps} interval={0} fontSize={10.5} />
          <YAxis {...axisProps} domain={[lo, hi]} tickFormatter={(v) => `${v}%`} allowDataOverflow />
          <Tooltip
            {...tooltipStyle}
            formatter={(_v, _n, it) => {
              const d = it.payload as (typeof data)[number];
              return [d.kind === "total" ? `${d.value.toFixed(1)} % of normal` : `${d.pct > 0 ? "+" : ""}${d.pct.toFixed(1)} %`, d.label];
            }}
            labelFormatter={() => ""}
          />
          <ReferenceLine y={100} stroke={VIZ.ink2} strokeDasharray="3 3" />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="delta" stackId="w" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.kind === "total" ? VIZ.s1 : d.kind === "up" ? VIZ.good : VIZ.critical} fillOpacity={d.kind === "total" ? 0.85 : 0.9} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Plain-language driver sentence: "−8 % water stress, −3 % heat, −5 % flood". */
export function driverSentence(drivers: DriverIn[], min = 0.5): string {
  const parts = drivers.filter((d) => d.key !== "trend" && Math.abs(d.pct) >= min).sort((a, b) => a.pct - b.pct);
  if (!parts.length) return "no weather, flood, salinity or satellite signal is moving the forecast away from normal";
  return parts.map((d) => `${d.pct > 0 ? "+" : "−"}${Math.abs(d.pct).toFixed(1)} % ${d.label.split(" (")[0]!.toLowerCase()}`).join(", ");
}

export interface EvoPoint {
  asOf: string;
  p10: number;
  p50: number;
  p90: number;
  vsNormalPct: number;
  observedFrac: number;
}

export function EvolutionChart({ data, normal, unit, height = 230 }: { data: EvoPoint[]; normal: number; unit: string; height?: number }) {
  const rows = data.map((d) => ({ ...d, band: [d.p10, d.p90] as [number, number], label: new Date(d.asOf).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) }));
  const digits = unit === "t" ? 0 : 2;
  return (
    <div style={{ height }} role="img" aria-label={`Forecast evolution over ${rows.length} weeks, latest P50 ${num(rows[rows.length - 1]?.p50, digits)} ${unit}`}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={18} />
          <YAxis {...axisProps} width={52} tickFormatter={(v) => num(v, unit === "t" ? 0 : 1)} domain={["auto", "auto"]} />
          <Tooltip
            {...tooltipStyle}
            formatter={(v: number | [number, number], n) => (Array.isArray(v) ? [`${num(v[0], digits)} – ${num(v[1], digits)} ${unit}`, "P10–P90"] : [`${num(v, digits)} ${unit}`, n])}
          />
          <Area dataKey="band" stroke="none" fill={VIZ.s1} fillOpacity={0.22} isAnimationActive={false} name="P10–P90" />
          <Line dataKey="p50" stroke={VIZ.s1} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} name="P50" />
          <ReferenceLine y={normal} stroke={VIZ.warning} strokeDasharray="4 3" label={{ value: "5-yr normal", fill: VIZ.warning, fontSize: 10, position: "insideTopRight" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Histogram({ bins, normal, p50, height = 170 }: { bins: { mid: number; share: number; from: number; to: number }[]; normal: number; p50: number; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label="Distribution of the yield forecast">
      <ResponsiveContainer>
        <BarChart data={bins} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis dataKey="mid" {...axisProps} tickFormatter={(v) => Number(v).toFixed(1)} />
          <YAxis {...axisProps} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
          <Tooltip {...tooltipStyle} formatter={(v: number) => [`${(v * 100).toFixed(0)} % of outcomes`, "Share"]} labelFormatter={(_l, p) => (p?.[0] ? `${(p[0].payload as { from: number }).from.toFixed(2)}–${(p[0].payload as { to: number }).to.toFixed(2)} t/ha` : "")} />
          <Bar dataKey="share" isAnimationActive={false} radius={[3, 3, 0, 0]}>
            {bins.map((b, i) => (
              <Cell key={i} fill={b.to < normal ? VIZ.serious : VIZ.s3} fillOpacity={Math.abs(b.mid - p50) < (b.to - b.from) ? 1 : 0.7} />
            ))}
          </Bar>
          <ReferenceLine x={bins.reduce((best, b) => (Math.abs(b.mid - normal) < Math.abs(best.mid - normal) ? b : best), bins[0] ?? { mid: normal }).mid} stroke={VIZ.warning} strokeDasharray="4 3" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Colour for a % vs normal value (diverging, red below / green above). */
export function vsColor(pct: number): string {
  if (pct <= -20) return "#d03b3b";
  if (pct <= -10) return "#ec835a";
  if (pct <= -3) return "#fab219";
  if (pct < 3) return "#94a3b8";
  if (pct < 10) return "#4ade80";
  return "#0ca30c";
}

export function VsNormal({ pct, className }: { pct: number; className?: string }) {
  return (
    <span className={`telemetry ${className ?? ""}`} style={{ color: vsColor(pct) }}>
      {pct > 0 ? "+" : pct < 0 ? "−" : "±"}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
