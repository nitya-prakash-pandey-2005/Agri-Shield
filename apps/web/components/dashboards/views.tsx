"use client";

/**
 * Widget bodies — one renderer per widget kind. Pure presentation: they get
 * the resolved `WidgetData` from the server and the widget's config.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, CloudOff, CloudRain, Compass, ExternalLink, LayoutDashboard, Link2, Minus, Siren, Thermometer, Waves } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RiskPill, Skeleton } from "@/components/hud";
import { cn } from "@/lib/utils";
import type { BarData, EmbedData, ExplorerData, ForecastData, HazardsData, KpiData, MapData, NotificationsData, SeriesData, TableData, WidgetData } from "@/server/services/widget-data";
import { ASSET_METRICS, TONE_COLOR, type Unit, type Widget } from "./catalog";
import { ago, fmtDelta, fmtValue, shortDate, weekday } from "./format";
import { Markdown } from "./Markdown";

const WidgetMap = dynamic(() => import("./WidgetMap"), { ssr: false, loading: () => <Skeleton className="absolute inset-0" /> });

export const VIZ = {
  s1: "#3987e5",
  s2: "#d95926",
  s3: "#199e70",
  s4: "#c98500",
  s5: "#d55181",
  grid: "rgba(148,163,184,0.12)",
  axis: "#64748b",
};
const SERIES_COLORS = [VIZ.s1, VIZ.s2, VIZ.s3, VIZ.s4];
const tooltipStyle = {
  contentStyle: { background: "#0b1224", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 10, fontSize: 12, color: "#e2e8f0" },
  labelStyle: { color: "#94a3b8", fontSize: 11 },
  itemStyle: { color: "#e2e8f0" },
  cursor: { fill: "rgba(148,163,184,0.08)" },
};
const axis = { stroke: VIZ.axis, fontSize: 10.5, tickLine: false, axisLine: false } as const;

export interface ViewCtx {
  shared: boolean;
  compact: boolean;
}

// ─── KPI ──────────────────────────────────────────────────────────────────

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <polyline points={`0,30 ${pts} 100,30`} fill={color} opacity={0.12} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function KpiView({ d, ctx }: { d: KpiData; ctx: ViewCtx }) {
  const color = TONE_COLOR[d.tone];
  const good = d.delta == null || d.delta === 0 ? null : d.higherIsWorse ? d.delta < 0 : d.delta > 0;
  return (
    <div className="flex h-full min-h-0 flex-col justify-between gap-1">
      <div className="flex items-baseline gap-2">
        <motion.span key={String(d.value)} initial={{ opacity: 0.3, y: 4 }} animate={{ opacity: 1, y: 0 }} className="telemetry text-[28px] font-semibold leading-none text-white" style={{ textShadow: d.tone === "neutral" ? undefined : `0 0 18px ${color}66` }}>
          {fmtValue(d.value, d.unit)}
        </motion.span>
        {d.tone !== "neutral" && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} title={d.tone === "crit" ? "Above critical threshold" : d.tone === "warn" ? "Above warning threshold" : "Within threshold"} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        {d.delta != null && (
          <span className={cn("inline-flex items-center gap-0.5 telemetry", good == null ? "text-slate-400" : good ? "text-emerald-400" : "text-rose-400")}>
            {d.delta > 0 ? <ArrowUpRight size={12} /> : d.delta < 0 ? <ArrowDownRight size={12} /> : <Minus size={12} />}
            {fmtDelta(d.delta, d.unit)} vs 7 d ago
          </span>
        )}
        {d.note && <span className="min-w-0 truncate text-slate-400" title={d.note}>{d.note}</span>}
      </div>
      {!ctx.compact && <Spark values={d.spark} color={d.tone === "neutral" ? "#38bdf8" : color} />}
      {d.href && !ctx.shared && (
        <Link href={d.href} className="self-start text-[10.5px] text-sky-300/80 hover:text-sky-200">
          Open →
        </Link>
      )}
    </div>
  );
}

// ─── Gauge ────────────────────────────────────────────────────────────────

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
}

function GaugeView({ d, w }: { d: KpiData; w: Widget }) {
  const max = d.max ?? 100;
  const v = Math.max(0, Math.min(max, d.value ?? 0));
  const A0 = Math.PI;
  const A1 = 2 * Math.PI;
  const at = (x: number) => A0 + (Math.max(0, Math.min(max, x)) / max) * (A1 - A0);
  const t = w.config.thresholds && (w.config.thresholds.warn != null || w.config.thresholds.crit != null) ? w.config.thresholds : null;
  const warn = t?.warn ?? null;
  const crit = t?.crit ?? null;
  const color = TONE_COLOR[d.tone];
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center">
      <svg viewBox="0 0 200 118" className="h-full max-h-[190px] w-full" role="img" aria-label={`${d.label}: ${fmtValue(d.value, d.unit)} of ${fmtValue(max, d.unit)}`}>
        <path d={arcPath(100, 100, 80, A0, A1)} stroke="rgba(148,163,184,0.15)" strokeWidth={14} fill="none" strokeLinecap="round" />
        {warn != null && <path d={arcPath(100, 100, 94, at(warn), at(crit ?? max))} stroke={TONE_COLOR.warn} strokeWidth={3} fill="none" opacity={0.7} />}
        {crit != null && <path d={arcPath(100, 100, 94, at(crit), A1)} stroke={TONE_COLOR.crit} strokeWidth={3} fill="none" opacity={0.8} />}
        {d.value != null && (
          <motion.path d={arcPath(100, 100, 80, A0, Math.max(A0 + 0.001, at(v)))} stroke={color} strokeWidth={14} fill="none" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }} style={{ filter: `drop-shadow(0 0 6px ${color}88)` }} />
        )}
        <text x={100} y={92} textAnchor="middle" className="telemetry" fontSize={28} fontWeight={600} fill="#fff">
          {fmtValue(d.value, d.unit)}
        </text>
        <text x={20} y={116} textAnchor="middle" fontSize={9} fill="#64748b">
          0
        </text>
        <text x={180} y={116} textAnchor="middle" fontSize={9} fill="#64748b">
          {fmtValue(max, d.unit)}
        </text>
      </svg>
      {(d.note || d.delta != null) && <div className="mt-1 truncate text-center text-[11px] text-slate-400">{[d.delta != null ? `${fmtDelta(d.delta, d.unit)} vs 7 d ago` : null, d.note].filter(Boolean).join(" · ")}</div>}
    </div>
  );
}

// ─── Series ───────────────────────────────────────────────────────────────

function SeriesView({ d }: { d: SeriesData }) {
  const multi = d.lines.length > 1;
  const fmt = (v: number) => fmtValue(v, d.unit);
  const Chart = d.lines.length === 1 ? AreaChart : LineChart;
  return (
    <div className="h-full min-h-0">
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={d.points} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={VIZ.grid} vertical={false} />
          <XAxis dataKey="date" {...axis} tickFormatter={shortDate} minTickGap={24} />
          <YAxis {...axis} width={d.unit === "usd" ? 58 : 44} tickFormatter={fmt} allowDecimals={d.unit !== "count"} />
          <Tooltip {...tooltipStyle} labelFormatter={(l) => shortDate(String(l))} formatter={(v: number, name: string) => [fmt(v), name]} />
          {multi && <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} iconType="plainline" />}
          {d.thresholdLine != null && <ReferenceLine y={d.thresholdLine} stroke="#f87171" strokeDasharray="4 3" label={{ value: `threshold ${d.thresholdLine}`, fill: "#f87171", fontSize: 10, position: "insideTopRight" }} />}
          {d.lines.map((l, i) =>
            d.lines.length === 1 ? (
              <Area key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={SERIES_COLORS[i]} fill={SERIES_COLORS[i]} fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false} />
            ) : (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={SERIES_COLORS[i]} strokeWidth={2} dot={false} isAnimationActive={false} />
            )
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Bars ─────────────────────────────────────────────────────────────────

function BarView({ d }: { d: BarData }) {
  const horizontal = d.bars.length > 6 || d.bars.some((b) => b.label.length > 10);
  const fmt = (v: number) => fmtValue(v, d.unit);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1 text-[10.5px] text-slate-500">{d.measureLabel}</div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {horizontal ? (
            <BarChart data={d.bars} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={3}>
              <CartesianGrid stroke={VIZ.grid} horizontal={false} />
              <XAxis type="number" {...axis} tickFormatter={fmt} />
              <YAxis type="category" dataKey="label" {...axis} width={96} tick={{ fill: "#94a3b8", fontSize: 10.5 }} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [fmt(v), d.measureLabel]} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {d.bars.map((b) => (
                  <Cell key={b.key} fill={b.color ?? VIZ.s1} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={d.bars} margin={{ top: 4, right: 4, bottom: 0, left: -8 }} barCategoryGap={4}>
              <CartesianGrid stroke={VIZ.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} interval={0} tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis {...axis} width={d.unit === "usd" ? 58 : 44} tickFormatter={fmt} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [fmt(v), d.measureLabel]} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {d.bars.map((b) => (
                  <Cell key={b.key} fill={b.color ?? VIZ.s1} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Map ──────────────────────────────────────────────────────────────────

function MapView({ d, ctx }: { d: MapData; ctx: ViewCtx }) {
  const label = ASSET_METRICS[d.metric]?.label ?? d.metric;
  return (
    <div className="relative h-full min-h-[140px] overflow-hidden rounded-lg border border-white/5">
      <WidgetMap data={d} linkAssets={!ctx.shared} />
      <div className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded-md border border-white/10 bg-[#060a16]/85 px-2 py-1 text-[10px] text-slate-300 backdrop-blur">
        <div className="mb-0.5 text-slate-400">{d.mode === "choropleth" ? `District · ${label}` : label}</div>
        {d.unit === "score" ? (
          <div className="flex items-center gap-1.5">
            {[
              ["#4ade80", "<35"],
              ["#fbbf24", "35+"],
              ["#f87171", "60+"],
              ["#a78bfa", "80+"],
            ].map(([c, t]) => (
              <span key={t} className="inline-flex items-center gap-0.5">
                <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                {t}
              </span>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            low
            <span className="h-2 w-16 rounded-sm" style={{ background: "linear-gradient(90deg,#cde2fb,#3987e5,#184f95)" }} />
            high
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────

function TableView({ d, ctx }: { d: TableData; ctx: ViewCtx }) {
  const metricLabel = ASSET_METRICS[d.metric]?.label ?? d.metric;
  return (
    <div className="h-full min-h-0 overflow-auto">
      <table className="w-full text-left text-[12px]">
        <thead className="sticky top-0 bg-[#0a1122]/95 text-[10px] uppercase tracking-wider text-slate-500 backdrop-blur">
          <tr>
            <th className="py-1.5 pr-2 font-medium">#</th>
            <th className="py-1.5 pr-2 font-medium">Asset</th>
            <th className="hidden py-1.5 pr-2 font-medium sm:table-cell">Where</th>
            <th className="py-1.5 pr-2 text-right font-medium">{metricLabel}</th>
            <th className="py-1.5 text-right font-medium">Level</th>
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.03]">
              <td className="py-1.5 pr-2 telemetry text-slate-500">{i + 1}</td>
              <td className="max-w-[180px] truncate py-1.5 pr-2 text-slate-200">
                {ctx.shared ? (
                  r.name
                ) : (
                  <Link href={`/app/portfolio?asset=${encodeURIComponent(r.id)}`} className="hover:text-sky-300">
                    {r.name}
                  </Link>
                )}
              </td>
              <td className="hidden max-w-[140px] truncate py-1.5 pr-2 text-slate-400 sm:table-cell">{r.district ?? r.country}</td>
              <td className="py-1.5 pr-2 text-right telemetry text-white">{fmtValue(r.value, d.unit)}</td>
              <td className="py-1.5 text-right">
                <RiskPill level={r.level} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.total > d.rows.length && <div className="mt-1 text-[10.5px] text-slate-500">Top {d.rows.length} of {d.total} assets</div>}
    </div>
  );
}

// ─── Feeds ────────────────────────────────────────────────────────────────

const ALERT_COLOR: Record<string, string> = { red: "#f87171", orange: "#fb923c", green: "#4ade80" };

function HazardsView({ d }: { d: HazardsData }) {
  return (
    <ul className="h-full min-h-0 space-y-1.5 overflow-auto pr-1">
      {d.items.map((e) => (
        <li key={e.id} className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md" style={{ background: `${ALERT_COLOR[e.alertLevel ?? ""] ?? "#38bdf8"}1f`, color: ALERT_COLOR[e.alertLevel ?? ""] ?? "#38bdf8" }}>
            {e.type === "flood" ? <Waves size={13} /> : e.type === "drought" ? <Thermometer size={13} /> : <Siren size={13} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] text-slate-100" title={e.title}>
              {e.title}
            </div>
            <div className="text-[10.5px] text-slate-400">
              {e.source} · {e.distanceKm} km from nearest asset · {e.assetsWithin} within 300 km · {shortDate(e.date.slice(0, 10))}
            </div>
          </div>
          {e.url && (
            <a href={e.url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-sky-300" aria-label="Open source">
              <ExternalLink size={12} />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

const SEV: Record<string, string> = { critical: "#f87171", warning: "#fbbf24", success: "#34d399", info: "#38bdf8" };

function NotificationsView({ d, ctx }: { d: NotificationsData; ctx: ViewCtx }) {
  return (
    <ul className="h-full min-h-0 space-y-1 overflow-auto pr-1">
      {d.items.map((n) => {
        const body = (
          <>
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SEV[n.severity] ?? "#38bdf8", boxShadow: `0 0 6px ${SEV[n.severity] ?? "#38bdf8"}` }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] text-slate-100">{n.title}</div>
              <div className="line-clamp-2 text-[11px] text-slate-400">{n.body}</div>
            </div>
            <span className="shrink-0 telemetry text-[10px] text-slate-500">{ago(n.createdAt)}</span>
          </>
        );
        return (
          <li key={n.id}>
            {n.href && !ctx.shared ? (
              <Link href={n.href} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                {body}
              </Link>
            ) : (
              <div className="flex items-start gap-2 rounded-lg px-2 py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ForecastView({ d }: { d: ForecastData }) {
  const maxRain = Math.max(10, ...d.days.map((x) => x.rainMm ?? 0));
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span className="truncate text-slate-200">{d.place?.name}</span>
        <span className={cn("rounded px-1.5 py-0.5 telemetry text-[9.5px] uppercase tracking-wider", d.status === "live" ? "bg-emerald-500/15 text-emerald-300" : d.status === "cached" ? "bg-amber-500/15 text-amber-300" : "bg-slate-500/15 text-slate-300")}>{d.status === "live" ? "live" : d.status === "cached" ? "cached" : "feed unavailable"}</span>
      </div>
      {d.days.length ? (
        <div className="grid min-h-0 flex-1 grid-cols-7 gap-1">
          {d.days.map((x) => (
            <div key={x.date} className="flex min-w-0 flex-col items-center justify-end gap-0.5 rounded-lg bg-white/[0.02] px-0.5 py-1" title={`${x.date}: ${x.rainMm ?? "—"} mm rain (${x.rainProb ?? "—"} % chance), ${x.tMin ?? "—"}–${x.tMax ?? "—"} °C`}>
              <span className="telemetry text-[10px] text-slate-300">{fmtValue(x.rainMm, "score")}</span>
              <div className="flex w-full flex-1 items-end justify-center">
                <div className="w-3/5 rounded-t" style={{ height: `${Math.max(3, ((x.rainMm ?? 0) / maxRain) * 100)}%`, background: (x.rainMm ?? 0) >= 50 ? "#f87171" : (x.rainMm ?? 0) >= 20 ? "#fbbf24" : "#3987e5" }} />
              </div>
              <span className="text-[10px] text-slate-400">{weekday(x.date)}</span>
              <span className="telemetry text-[9.5px] text-slate-500">
                {x.tMax != null ? Math.round(x.tMax) : "—"}°/{x.tMin != null ? Math.round(x.tMin) : "—"}°
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 rounded-lg border border-dashed border-slate-700/70 p-2.5 text-[11.5px] text-slate-400">
          <div className="flex items-start gap-2">
            <CloudOff size={14} className="mt-0.5 shrink-0 text-slate-500" />
            <span>{d.message}</span>
          </div>
          {d.district && (
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <Stat label="Flood 72 h" value={`${d.district.floodProb72h}%`} />
              <Stat label="Rain 72 h" value={`${d.district.rainfall72hMm} mm`} />
              <Stat label="Soil EC" value={`${d.district.ecCurrent} dS/m`} />
            </div>
          )}
          {d.district && <div className="text-[10.5px] text-slate-500">Nearest monitored district: {d.district.name} ({d.district.km} km)</div>}
        </div>
      )}
      {d.days.length > 0 && d.district && (
        <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500">
          <CloudRain size={11} /> Rain mm/day · bars amber ≥20 mm, red ≥50 mm · {d.district.name}: flood 72 h {d.district.floodProb72h}%
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/[0.03] px-1 py-1">
      <div className="telemetry text-[12px] text-slate-100">{value}</div>
      <div className="text-[9.5px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function ReportCard({ r, ctx }: { r: NonNullable<ExplorerData["report"]>; ctx: ViewCtx }) {
  const color = r.composite >= 80 ? "#a78bfa" : r.composite >= 60 ? "#f87171" : r.composite >= 35 ? "#fbbf24" : "#4ade80";
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto">
      <div className="flex items-center gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-2" style={{ borderColor: color, boxShadow: `0 0 16px ${color}55` }}>
          <span className="telemetry text-lg font-semibold text-white">{r.composite}</span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-slate-100">{r.place}</div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
            <RiskPill level={r.level} /> saved {shortDate(r.createdAt.slice(0, 10))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {r.hazards.map((h) => (
          <div key={h.key} className="text-[10.5px]">
            <div className="flex justify-between text-slate-400">
              <span className="capitalize">{h.key}</span>
              <span className="telemetry text-slate-200">{h.score}</span>
            </div>
            <div className="h-1 rounded-full bg-slate-800">
              <div className="h-full rounded-full" style={{ width: `${h.score}%`, background: h.score >= 60 ? "#f87171" : h.score >= 35 ? "#fbbf24" : "#4ade80" }} />
            </div>
          </div>
        ))}
      </div>
      {r.drivers.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-400 marker:text-cyan-400">
          {r.drivers.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      <a href={r.url} target={ctx.shared ? "_blank" : undefined} rel="noreferrer" className="mt-auto inline-flex items-center gap-1 self-start text-[11px] text-sky-300 hover:text-sky-200">
        Open full report <ExternalLink size={11} />
      </a>
    </div>
  );
}

function EmbedView({ d, ctx }: { d: EmbedData; ctx: ViewCtx }) {
  if (d.report) return <ReportCard r={d.report} ctx={ctx} />;
  if (d.dashboard)
    return (
      <div className="flex h-full flex-col justify-center gap-2 text-[12px] text-slate-300">
        <div className="flex items-center gap-2">
          <LayoutDashboard size={16} className="text-cyan-300" />
          <span className="font-medium text-slate-100">{d.dashboard.name}</span>
        </div>
        <div className="text-[11px] text-slate-400">
          {d.dashboard.orgName} · {d.dashboard.widgets} widgets · updated {ago(d.dashboard.updatedAt)}
        </div>
        <a href={d.url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-[11px] text-sky-300 hover:text-sky-200">
          Open shared dashboard <ExternalLink size={11} />
        </a>
      </div>
    );
  return (
    <div className="flex h-full flex-col justify-center gap-2 text-[12px] text-slate-300">
      <div className="flex items-center gap-2">
        <Link2 size={15} className="text-cyan-300" />
        <span className="truncate">{d.url}</span>
      </div>
      <p className="text-[11px] text-slate-500">External pages open in a new tab — the workspace security policy does not allow framing other sites inside dashboards.</p>
      <a href={d.url ?? "#"} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 self-start text-[11px] text-sky-300 hover:text-sky-200">
        Open link <ExternalLink size={11} />
      </a>
    </div>
  );
}

// ─── Dispatcher ───────────────────────────────────────────────────────────

export function WidgetBody({ widget, data, ctx }: { widget: Widget; data: WidgetData | undefined; ctx: ViewCtx }) {
  if (widget.kind === "note") return <div className="h-full overflow-auto pr-1"><Markdown text={widget.config.text ?? ""} /></div>;
  if (!data) return <Skeleton className="h-full min-h-[60px] w-full" />;
  if (data.empty && !(data.kind === "hazards" && data.items.length))
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
        {widget.kind === "explorer" ? <Compass size={20} className="text-slate-600" /> : <LayoutDashboard size={20} className="text-slate-600" />}
        <p className="max-w-xs text-[11.5px] text-slate-400">{data.empty}</p>
      </div>
    );
  switch (data.kind) {
    case "kpi":
      return widget.kind === "gauge" ? <GaugeView d={data} w={widget} /> : <KpiView d={data} ctx={ctx} />;
    case "timeseries":
      return <SeriesView d={data} />;
    case "bar":
      return <BarView d={data} />;
    case "map":
      return <MapView d={data} ctx={ctx} />;
    case "table":
      return <TableView d={data} ctx={ctx} />;
    case "hazards":
      return <HazardsView d={data} />;
    case "notifications":
      return <NotificationsView d={data} ctx={ctx} />;
    case "forecast":
      return <ForecastView d={data} />;
    case "explorer":
      return data.report ? <ReportCard r={data.report} ctx={ctx} /> : null;
    case "embed":
      return <EmbedView d={data} ctx={ctx} />;
    default:
      return null;
  }
}

export type { Unit };
