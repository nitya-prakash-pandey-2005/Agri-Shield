"use client";

/**
 * Analytics charts for the government portal (spec §4.5 Analytics & Reporting).
 * Dark HUD styling; categorical palette validated for the dark chart surface
 * (OKLCH L 0.48–0.67, adjacent CVD ΔE ≥ 16). One y-axis per chart — measures
 * with different units are split into stacked small multiples.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CloudRain, Flame, Grid3x3, LineChart as LineIcon, TrendingDown, TrendingUp, Users } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { EmptyState, Meter, Panel, Skeleton, SourceTag } from "@/components/hud";
import { cn } from "@/lib/utils";
import { useGovInput } from "./scope";
import { CHART, ChartTooltip, ErrorNote, fmtInt, fmtUsd, RESOURCE_COLOR, RESOURCE_ICON, selectCls } from "./ui";

type Analytics = RouterOutputs["government"]["getAnalytics"];

/** Categorical order for entities (districts) — validated on the dark surface. */
export const VIZ = ["#059669", "#0284c7", "#d97706", "#8b5cf6", "#e11d48"];
/** Secondary encoding for lines that cross (CVD safety across all pairs). */
const DASH = ["", "6 3", "2 3", "8 3 2 3", "1 4"];

/** neutral "baseline" bars — slate-500 clears 3:1 on the dark surface */
const NEUTRAL = "#64748b";
const axisProps = { tick: CHART.axis, axisLine: false, tickLine: false } as const;
const usdTick = (v: number) => fmtUsd(v);

function Legend({ items }: { items: { label: string; color: string; dash?: string; kind?: "bar" | "line" }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-300">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.kind === "line" ? (
            <svg width="16" height="6" aria-hidden>
              <line x1="0" y1="3" x2="16" y2="3" stroke={i.color} strokeWidth="2" strokeDasharray={i.dash || undefined} />
            </svg>
          ) : (
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ─── Season-over-season crop loss ─────────────────────────────────────────

function SeasonTip({ active, payload, label }: { active?: boolean; payload?: { payload: Analytics["seasons"][number] }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const r = payload[0]!.payload;
  const rows: [string, string, string][] = [
    ["Loss without early warning", fmtUsd(r.withoutEwUsd), NEUTRAL],
    ["Loss with early warning", fmtUsd(r.withEwUsd), CHART.emerald],
    ["Loss avoided", fmtUsd(r.avoidedUsd), CHART.cyan],
  ];
  return (
    <div className="rounded-lg border border-white/10 bg-[#070c1a]/95 px-3 py-2 shadow-2xl backdrop-blur-md">
      <div className="hud-label mb-1 text-slate-300">{label}</div>
      {rows.map(([k, v, c]) => (
        <div key={k} className="flex items-center gap-2 text-[11px]">
          <span className="h-2 w-2 rounded-sm" style={{ background: c }} />
          <span className="text-slate-400">{k}</span>
          <span className="ml-auto pl-3 telemetry text-slate-100">{v}</span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-white/5 pt-1.5 text-[11px] text-slate-400">
        {r.alerts} alerts · action rate <span className="telemetry text-slate-100">{r.actionRate}%</span> · crop saved{" "}
        <span className="telemetry text-slate-100">{r.cropSavedPct}%</span>
        <div className="text-[10px] text-slate-500">{r.outcomeSamples ? `${r.outcomeSamples} farmer outcome reports` : "network-average outcome (no reports this season)"}</div>
      </div>
    </div>
  );
}

export function SeasonLossChart({ data }: { data: Analytics["seasons"] }) {
  return (
    <Panel
      title="Crop loss: with vs without early warning"
      subtitle="Probability-weighted predicted loss per season vs loss after farmer action (alerts × outcomes)"
      icon={LineIcon}
      accent="emerald"
      actions={
        <>
          <SourceTag>Agri-SHIELD registry</SourceTag>
          <SourceTag>Model v2.3.1</SourceTag>
        </>
      }
    >
      {data.length ? (
        <>
          <Legend
            items={[
              { label: "Without early warning", color: NEUTRAL },
              { label: "With early warning", color: CHART.emerald },
              { label: "Loss avoided", color: CHART.cyan, kind: "line" },
            ]}
          />
          <div className="mt-3 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="season" {...axisProps} interval={0} tick={{ ...CHART.axis, fontSize: 9.5 }} />
                <YAxis {...axisProps} tickFormatter={usdTick} width={52} />
                <Tooltip content={<SeasonTip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="withoutEwUsd" name="Without early warning" fill={NEUTRAL} radius={[4, 4, 0, 0]} maxBarSize={34} />
                <Bar dataKey="withEwUsd" name="With early warning" fill={CHART.emerald} radius={[4, 4, 0, 0]} maxBarSize={34} />
                <Line dataKey="avoidedUsd" name="Loss avoided" stroke={CHART.cyan} strokeWidth={2} dot={{ r: 4, fill: CHART.cyan, stroke: "#0b1222", strokeWidth: 2 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <EmptyState icon={LineIcon} title="No alert seasons yet">Seasons appear once alerts have been issued in this jurisdiction.</EmptyState>
      )}
    </Panel>
  );
}

// ─── Weekly response ──────────────────────────────────────────────────────

export function ResponseRateCharts({ data }: { data: Analytics["weekly"] }) {
  const has = data.some((w) => w.alerts > 0);
  return (
    <Panel title="Alert response rate by week" subtitle="Share of delivered messages read and acted on · last 12 weeks" icon={Users} accent="cyan" actions={<SourceTag>Delivery receipts</SourceTag>}>
      {has ? (
        <>
          <Legend
            items={[
              { label: "Read rate", color: CHART.cyan, kind: "line" },
              { label: "Action rate", color: CHART.emerald, kind: "line" },
            ]}
          />
          <div className="mt-2 h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} syncId="weekly" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="week" {...axisProps} hide />
                <YAxis {...axisProps} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={40} />
                <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={{ stroke: "#334155" }} />
                <Line dataKey="readRate" name="Read rate" stroke={CHART.cyan} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
                <Line dataKey="actionRate" name="Action rate" stroke={CHART.emerald} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="hud-label mt-3 mb-1">Messages sent</div>
          <div className="h-[92px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} syncId="weekly" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="week" {...axisProps} />
                <YAxis {...axisProps} width={40} tickFormatter={(v) => fmtUsd(v).slice(1)} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="sent" name="Messages sent" fill="#0284c7" radius={[3, 3, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <EmptyState icon={Users} title="No alerts in the last 12 weeks" />
      )}
    </Panel>
  );
}

// ─── Resource utilisation heatmap ─────────────────────────────────────────

const HEAT = [
  { min: 100, color: "#6ee7b7", ink: "#022c22", label: "≥100%" },
  { min: 80, color: "#10b981", ink: "#022c22", label: "80–99" },
  { min: 60, color: "#059669", ink: "#ecfdf5", label: "60–79" },
  { min: 40, color: "#047857", ink: "#ecfdf5", label: "40–59" },
  { min: 20, color: "#065f46", ink: "#d1fae5", label: "20–39" },
  { min: 0, color: "#0f2e28", ink: "#94a3b8", label: "0–19" },
];
const heat = (pct: number) => HEAT.find((h) => pct >= h.min)!;

const RES_LABEL: Record<string, string> = { pumps: "Pumps", sandbags: "Sandbags", evacuation_buses: "Buses", medical: "Medical", food_aid: "Food aid" };

export function UtilisationHeatmap({ data, types }: { data: Analytics["heatmap"]; types: string[] }) {
  const [hover, setHover] = useState<{ d: string; t: string; a: number; n: number; p: number } | null>(null);
  return (
    <Panel title="Resource utilisation heatmap" subtitle="Allocated in last 90 days ÷ modelled need, by district × resource" icon={Grid3x3} accent="emerald" actions={<SourceTag>Requests ledger</SourceTag>}>
      <div className="overflow-x-auto">
        <div className="min-w-[440px]">
          <div className="grid gap-[2px]" style={{ gridTemplateColumns: `minmax(90px,1.2fr) repeat(${types.length}, minmax(56px,1fr))` }}>
            <div />
            {types.map((t) => {
              const Icon = RESOURCE_ICON[t]!;
              return (
                <div key={t} className="flex flex-col items-center gap-1 pb-1.5 text-[10px] text-slate-400">
                  <Icon size={12} style={{ color: RESOURCE_COLOR[t] }} />
                  <span className="telemetry uppercase tracking-wider">{RES_LABEL[t] ?? t}</span>
                </div>
              );
            })}
            {data.map((row) => (
              <div key={row.districtId} className="contents">
                <div className="flex items-center pr-2 text-xs text-slate-200">{row.district}</div>
                {row.cells.map((c) => {
                  const none = c.need === 0 && c.allocated === 0;
                  const h = heat(c.utilisationPct);
                  return (
                    <div
                      key={c.type}
                      onMouseEnter={() => setHover({ d: row.district, t: c.type, a: c.allocated, n: c.need, p: c.utilisationPct })}
                      onMouseLeave={() => setHover(null)}
                      title={`${row.district} · ${RES_LABEL[c.type]}: ${fmtInt(c.allocated)} allocated / ${fmtInt(c.need)} needed`}
                      className={cn("grid h-10 place-items-center rounded-[4px] telemetry text-[11px] transition-transform hover:scale-[1.06] hover:ring-1 hover:ring-white/40", none && "bg-slate-800/40 text-slate-600")}
                      style={none ? undefined : { background: h.color, color: h.ink }}
                    >
                      {none ? "—" : `${Math.min(999, c.utilisationPct)}%`}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-[2px]">
          {[...HEAT].reverse().map((h) => (
            <div key={h.label} className="flex flex-col items-center">
              <span className="h-2.5 w-9 first:rounded-l last:rounded-r" style={{ background: h.color }} />
              <span className="mt-0.5 telemetry text-[9px] text-slate-500">{h.label}</span>
            </div>
          ))}
        </div>
        <div className="min-h-[18px] text-[11px] text-slate-400">
          {hover ? (
            <>
              <span className="text-slate-200">{hover.d}</span> · {RES_LABEL[hover.t]}: <span className="telemetry text-slate-100">{fmtInt(hover.a)}</span> allocated of{" "}
              <span className="telemetry text-slate-100">{fmtInt(hover.n)}</span> needed ({hover.p}%)
            </>
          ) : (
            "Hover a cell for allocated vs needed"
          )}
        </div>
      </div>
    </Panel>
  );
}

// ─── Hotspots ─────────────────────────────────────────────────────────────

export function HotspotPanel({ trend, hotspots, districtNames }: { trend: Analytics["hotspotTrend"]; hotspots: Analytics["hotspots"]; districtNames: string[] }) {
  const color = (name: string) => VIZ[districtNames.indexOf(name) % VIZ.length]!;
  const dash = (name: string) => DASH[districtNames.indexOf(name) % DASH.length]!;
  return (
    <Panel title="Hotspot analysis — which districts flood most" subtitle="Flood extent by year (ha) from the district flood archive, with loss totals and trend" icon={Flame} accent="amber" actions={<SourceTag>Flood archive 2020–2025</SourceTag>}>
      <div className="grid gap-5 xl:grid-cols-[1.1fr,1fr]">
        <div>
          <Legend items={districtNames.map((n) => ({ label: n, color: color(n), dash: dash(n), kind: "line" as const }))} />
          <div className="mt-2 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="year" {...axisProps} />
                <YAxis {...axisProps} width={48} tickFormatter={(v) => fmtUsd(v).slice(1)} />
                <Tooltip content={<ChartTooltip format={(v) => `${fmtInt(v)} ha`} />} cursor={{ stroke: "#334155" }} />
                {districtNames.map((n) => (
                  <Line key={n} dataKey={n} name={n} stroke={color(n)} strokeWidth={2} strokeDasharray={dash(n) || undefined} dot={{ r: 4, fill: color(n), stroke: "#0b1222", strokeWidth: 2 }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-xs">
            <thead>
              <tr className="hud-label text-left">
                <th className="pb-2 font-normal">#</th>
                <th className="pb-2 font-normal">District</th>
                <th className="pb-2 text-right font-normal">Events</th>
                <th className="pb-2 text-right font-normal">Alerts</th>
                <th className="pb-2 text-right font-normal">Avg area</th>
                <th className="pb-2 text-right font-normal">Total loss</th>
                <th className="pb-2 text-right font-normal">Trend</th>
                <th className="pb-2 pl-3 font-normal">Risk now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {hotspots.map((h, i) => (
                <tr key={h.districtId} className="hover:bg-white/[0.02]">
                  <td className="py-2 telemetry text-slate-500">{i + 1}</td>
                  <td className="py-2">
                    <span className="inline-flex items-center gap-1.5 text-slate-100">
                      <span className="h-2 w-2 rounded-full" style={{ background: color(h.district) }} />
                      {h.district}
                    </span>
                  </td>
                  <td className="py-2 text-right telemetry text-slate-300">{h.events}</td>
                  <td className="py-2 text-right telemetry text-slate-300">{h.archiveAlerts}</td>
                  <td className="py-2 text-right telemetry text-slate-300">{fmtInt(h.avgAreaHa)} ha</td>
                  <td className="py-2 text-right telemetry text-slate-100">{fmtUsd(h.totalLossUsd)}</td>
                  <td className="py-2 text-right telemetry">
                    <span className={cn("inline-flex items-center gap-1", h.trendHaPerYear > 0 ? "text-rose-300" : "text-emerald-300")}>
                      {h.trendHaPerYear > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {h.trendHaPerYear > 0 ? "+" : ""}
                      {fmtInt(h.trendHaPerYear)}/yr
                    </span>
                  </td>
                  <td className="py-2 pl-3">
                    <div className="flex items-center gap-2">
                      <Meter value={h.currentRisk} className="w-16" />
                      <span className="telemetry text-[10px] text-slate-400">{h.currentRisk}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

// ─── ERA5 rainfall anomaly ────────────────────────────────────────────────

export function RainfallAnomalyPanel({ districts }: { districts: { id: string; name: string; riskLevel: string }[] }) {
  const scope = useGovInput();
  const [districtId, setDistrictId] = useState<string>("");
  useEffect(() => {
    if (!districts.length || districts.some((d) => d.id === districtId)) return;
    setDistrictId((districts.find((d) => d.riskLevel === "critical") ?? districts.find((d) => d.riskLevel === "high") ?? districts[0]!).id);
  }, [districts, districtId]);
  const q = trpc.government.getRainfallAnomaly.useQuery({ ...scope, districtId }, { enabled: !!districtId, staleTime: 30 * 60_000 });
  const rows = useMemo(() => (q.data?.rows ?? []).map((r) => ({ ...r, label: new Date(`${r.month}-15`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) })), [q.data]);
  const hasErr = q.data && "error" in q.data && q.data.error;
  return (
    <Panel
      title="Rainfall anomaly (ERA5 reanalysis)"
      subtitle="Last 12 complete months vs mean of the same months in the two prior years"
      icon={CloudRain}
      accent="cyan"
      actions={
        <>
          <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className={cn(selectCls, "h-8 w-40 py-1 text-xs")} aria-label="District">
            {districts.map((d) => (
              <option key={d.id} value={d.id} className="bg-slate-900">
                {d.name}
              </option>
            ))}
          </select>
          <SourceTag href="https://open-meteo.com/en/docs/historical-weather-api">ERA5 · Open-Meteo</SourceTag>
        </>
      }
    >
      {q.isLoading || !districtId ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[220px]" />
          <Skeleton className="h-[220px]" />
        </div>
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : hasErr || !rows.length ? (
        <EmptyState icon={CloudRain} title="ERA5 archive unavailable">
          The Open-Meteo archive did not respond{hasErr ? ` (${String(q.data?.error)})` : ""}. Try again shortly — results are cached for 12 hours once retrieved.
        </EmptyState>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-6 text-xs">
            <div>
              <div className="hud-label">12-month observed</div>
              <div className="telemetry text-lg text-white">{fmtInt(q.data?.annualObservedMm)} mm</div>
            </div>
            <div>
              <div className="hud-label">Baseline</div>
              <div className="telemetry text-lg text-slate-300">{fmtInt(q.data?.annualBaselineMm)} mm</div>
            </div>
            <div>
              <div className="hud-label">Anomaly</div>
              <div className={cn("telemetry text-lg", (q.data?.annualAnomalyPct ?? 0) >= 0 ? "text-sky-300" : "text-amber-300")}>
                {q.data?.annualAnomalyPct == null ? "—" : `${q.data.annualAnomalyPct > 0 ? "+" : ""}${q.data.annualAnomalyPct}%`}
              </div>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <Legend
                items={[
                  { label: "Observed (mm)", color: "#0284c7" },
                  { label: "Baseline (mm)", color: "#cbd5e1", kind: "line", dash: "4 3" },
                ]}
              />
              <div className="mt-2 h-[210px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} interval={1} />
                    <YAxis {...axisProps} width={40} />
                    <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)} mm`} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                    <Bar dataKey="observedMm" name="Observed" fill="#0284c7" radius={[4, 4, 0, 0]} maxBarSize={22} />
                    <Line dataKey="baselineMm" name="Baseline" stroke="#cbd5e1" strokeDasharray="4 3" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <Legend
                items={[
                  { label: "Wetter than baseline", color: "#38bdf8" },
                  { label: "Drier than baseline", color: "#f59e0b" },
                ]}
              />
              <div className="mt-2 h-[210px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} interval={1} />
                    <YAxis {...axisProps} width={44} tickFormatter={(v) => `${v}%`} />
                    <ReferenceLine y={0} stroke="#64748b" />
                    <Tooltip content={<ChartTooltip format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                    <Bar dataKey="anomalyPct" name="Anomaly" radius={[4, 4, 4, 4]} maxBarSize={22}>
                      {rows.map((r) => (
                        <Cell key={r.month} fill={(r.anomalyPct ?? 0) >= 0 ? "#38bdf8" : "#f59e0b"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
