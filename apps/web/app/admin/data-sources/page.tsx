"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, CheckCircle2, Globe2, Leaf, RefreshCw, Satellite, ServerCrash, TriangleAlert } from "lucide-react";
import { EmptyState, HudButton, Panel, SectionHeader, Skeleton, SourceTag, StatTile, LiveDot } from "@/components/hud";
import { DataTable, ErrorNote, KV, StatusBadge, Td, TimeAgo, chartTooltip, fmtMs } from "@/components/admin/ui";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Sources = RouterOutputs["admin"]["sources"];
type Source = Sources["sources"][number];
type SatDistrict = Sources["satellite"]["districts"][number];

const CATEGORY_LABEL: Record<string, string> = {
  weather: "Weather",
  hydrology: "Hydrology",
  ocean: "Ocean",
  terrain: "Terrain",
  hazards: "Hazard feeds",
  satellite: "Satellite",
  soil: "Soil",
  translation: "Translation",
  economics: "Economics",
  ml: "ML inference",
};

function LatencyBar({ ms }: { ms: number | null }) {
  const pct = ms == null ? 0 : Math.min(100, (ms / 3000) * 100);
  const color = ms == null ? "#475569" : ms < 800 ? "#10b981" : ms < 2000 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
      <span className="telemetry w-14 text-right text-[11px]" style={{ color }}>
        {fmtMs(ms)}
      </span>
    </div>
  );
}

function SourceCard({ s }: { s: Source }) {
  return (
    <div className="hud-panel p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-100">{s.name}</div>
          <div className="truncate text-[11px] text-slate-500">
            <span className="mr-1.5 rounded bg-violet-500/10 px-1 py-px text-[9.5px] uppercase tracking-wider text-violet-300">{CATEGORY_LABEL[s.category] ?? s.category}</span>
            {s.provider}
          </div>
        </div>
        <StatusBadge status={s.status} pulse={s.status === "up"} />
      </div>
      <p className="mt-2 line-clamp-2 min-h-[32px] text-[11.5px] text-slate-400">{s.usedFor}</p>
      <div className="mt-2">
        <LatencyBar ms={s.latencyMs} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 text-[10.5px] text-slate-500">
        <span>
          HTTP <span className="telemetry text-slate-300">{s.httpStatus ?? "—"}</span>
        </span>
        <span className="text-right">
          checked <TimeAgo date={s.checkedAt} className="text-slate-300" />
        </span>
        <span className="col-span-2">
          last success <TimeAgo date={s.lastSuccessAt} className="text-slate-300" />
        </span>
      </div>
      {s.error && <div className="mt-2 truncate rounded bg-rose-500/10 px-2 py-1 text-[10.5px] text-rose-300" title={s.error}>{s.error}</div>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate telemetry text-[10px] text-slate-600" title={s.url}>
          {s.url.replace(/^https?:\/\//, "")}
        </span>
        <SourceTag href={s.docs}>docs</SourceTag>
      </div>
    </div>
  );
}

function Spark({ series }: { series: SatDistrict["series"] }) {
  if (!series.length) return <span className="text-[10px] text-slate-600">no data</span>;
  return (
    <div className="h-8 w-28">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series}>
          <YAxis hide domain={[0, 1]} />
          <Line
            type="monotone"
            dataKey="ndvi"
            stroke="#10b981"
            strokeWidth={1.5}
            isAnimationActive={false}
            dot={(p: { cx?: number; cy?: number; payload?: { quality: string }; index?: number }) => (
              <circle key={p.index} cx={p.cx} cy={p.cy} r={2} fill={p.payload?.quality === "clear" ? "#10b981" : "#334155"} stroke="none" />
            )}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DataSourcesPage() {
  const utils = trpc.useUtils();
  const [probing, setProbing] = useState(false);
  const q = trpc.admin.sources.useQuery({ force: false }, { refetchInterval: 60_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const run = trpc.admin.runJob.useMutation({
    onSuccess: (r) => {
      toast.message(`Satellite ingest: ${r.status}`, { description: r.summary });
      utils.admin.sources.invalidate();
      utils.admin.jobs.invalidate();
    },
    onError: (e) => toast.error("Could not start satellite ingest", { description: e.message }),
  });

  const d = q.data;
  const grouped = useMemo(() => {
    const m = new Map<string, Source[]>();
    for (const s of d?.sources ?? []) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()];
  }, [d]);

  const sat = d?.satellite;
  const current = sat?.districts.find((x) => x.districtId === selected) ?? sat?.districts.find((x) => x.series.length) ?? null;

  /** Bypass the 60 s probe cache and write the fresh result into the page's query. */
  const refresh = async () => {
    setProbing(true);
    try {
      const fresh = await utils.admin.sources.fetch({ force: true });
      utils.admin.sources.setData({ force: false }, fresh);
      toast.success(`Probed ${fresh.summary.total} sources`, { description: `${fresh.summary.up} up · ${fresh.summary.degraded} degraded · ${fresh.summary.down} down` });
    } catch (e) {
      toast.error("Probe failed", { description: (e as Error).message });
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="DATA PLANE"
        title="Open-Data Source Health"
        description="Every free/open feed Agri-SHIELD depends on, probed live with a real request. Cached 60 s; latency, HTTP status and last successful contact are shown per source."
        actions={
          <HudButton variant="outline" onClick={refresh} disabled={probing}>
            <RefreshCw size={14} className={probing || q.isFetching ? "animate-spin" : ""} /> {probing ? "Probing…" : "Probe now"}
          </HudButton>
        }
      />
      <ErrorNote error={q.error} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="hud-panel p-4" style={{ ["--hud-accent" as string]: "139 92 246" }}>
          <div className="hud-label">Platform data status</div>
          <div className="mt-3">{d ? <StatusBadge status={d.summary.status} className="text-xs" pulse /> : <Skeleton className="h-6 w-28" />}</div>
          <div className="mt-2 text-[11px] text-slate-500">{d ? `${d.summary.total} sources monitored` : "probing…"}</div>
        </div>
        <StatTile label="Up" value={d?.summary.up ?? 0} icon={CheckCircle2} accent="emerald" />
        <StatTile label="Degraded" value={d?.summary.degraded ?? 0} icon={TriangleAlert} accent="amber" />
        <StatTile label="Down / offline" value={d?.summary.down ?? 0} icon={ServerCrash} accent="red" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Live risk overlay" subtitle="Open-Meteo forecast + GloFAS + marine → 22 districts" icon={Globe2} accent="cyan" live={!!d?.liveRisk.lastRefresh}>
          {!d ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <KV k="Last refresh" v={<TimeAgo date={d.liveRisk.lastRefresh} />} />
              <KV k="Refreshing now" v={d.liveRisk.refreshing ? <StatusBadge status="running" /> : "no"} />
              <KV k="Districts on live data" v={`${d.liveDistricts} / 22`} mono />
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full bg-cyan-400" style={{ width: `${(d.liveDistricts / 22) * 100}%` }} />
              </div>
            </>
          )}
        </Panel>
        <Panel
          title="Satellite ingest"
          subtitle="ORNL DAAC · MODIS MOD13Q1 250 m 16-day NDVI"
          icon={Satellite}
          accent="emerald"
          className="lg:col-span-2"
          actions={
            <HudButton variant="outline" onClick={() => run.mutate({ job: "satellite-ingest" })} disabled={run.isPending} className="py-1.5 text-xs">
              <Satellite size={13} className={run.isPending ? "animate-pulse" : ""} /> {run.isPending ? "Ingesting…" : "Run ingest now"}
            </HudButton>
          }
        >
          {!sat ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
              <div>
                <KV k="Last run" v={<TimeAgo date={sat.lastRunAt} />} />
                <KV k="Last success" v={<TimeAgo date={sat.lastSuccessAt} />} />
                <KV k="Latest composite" v={sat.latestComposite ?? "—"} mono />
                <KV k="Districts ingested" v={`${sat.districts.filter((x) => !x.error).length} / ${sat.districts.length || 22}`} mono />
                <KV k="Stress flags" v={sat.districts.filter((x) => x.stressed).length} mono />
              </div>
              {current ? (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-slate-300">
                      NDVI · <span className="font-semibold text-white">{current.name}</span> <span className="telemetry text-slate-500">{current.tile}</span>
                    </span>
                    <span className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" /> clear <span className="h-2 w-2 rounded-full bg-slate-600" /> cloud-filled
                    </span>
                  </div>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={current.series}>
                        <defs>
                          <linearGradient id="ndviFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                        <YAxis domain={[0, 1]} tick={{ fill: "#64748b", fontSize: 10 }} width={30} />
                        <Tooltip {...chartTooltip} formatter={(v: number, _n, p) => [`${v.toFixed(3)} (${(p.payload as { quality: string }).quality}, ${(p.payload as { clearPct: number }).clearPct}% clear px)`, "NDVI"]} />
                        <Area
                          type="monotone"
                          dataKey="ndvi"
                          stroke="#10b981"
                          strokeWidth={2}
                          fill="url(#ndviFill)"
                          dot={(p: { cx?: number; cy?: number; payload?: { quality: string }; index?: number }) => (
                            <circle key={p.index} cx={p.cx} cy={p.cy} r={3.5} fill={p.payload?.quality === "clear" ? "#10b981" : "#334155"} stroke="#0f172a" />
                          )}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <EmptyState icon={Leaf} title="No NDVI ingested yet">
                  The ingest runs ~45 s after boot and daily at 02:00 UTC (≈2 min of polite API calls).
                </EmptyState>
              )}
            </div>
          )}
        </Panel>
      </div>

      {!d ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Activity size={12} className="text-violet-400" />
            <span className="hud-label">Feeds · grouped by category</span>
            <span className="h-px flex-1 bg-white/5" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {grouped.flatMap(([, list]) => list).map((s) => (
              <SourceCard key={s.id} s={s} />
            ))}
          </div>
        </div>
      )}

      {sat && sat.districts.length > 0 && (
        <Panel title="Per-district NDVI" subtitle="Click a row to chart it · 3×3 km window, pixel-reliability screened" icon={Leaf} accent="emerald" actions={<LiveDot label="MODIS" color="#10b981" />}>
          <DataTable head={["District", "Tile", "Latest NDVI", "Quality", "Δ last clear", "Trend", "Fields", "Status"]}>
            {sat.districts.map((x) => (
              <tr key={x.districtId} onClick={() => setSelected(x.districtId)} className={cn("cursor-pointer hover:bg-white/[0.02]", current?.districtId === x.districtId && "bg-emerald-500/[0.05]")}>
                <Td className="font-medium text-slate-100">{x.name}</Td>
                <Td mono>{x.tile ?? "—"}</Td>
                <Td mono>{x.latest ? x.latest.ndvi.toFixed(3) : "—"}</Td>
                <Td>{x.latest ? <StatusBadge status={x.latest.quality === "clear" ? "ok" : "skipped"} label={`${x.latest.quality} ${x.latest.clearPct}%`} /> : "—"}</Td>
                <Td mono className={x.changePct == null ? "" : x.changePct <= -20 ? "text-rose-400" : x.changePct < 0 ? "text-amber-300" : "text-emerald-400"}>
                  {x.changePct == null ? "n/a" : `${x.changePct > 0 ? "+" : ""}${x.changePct}%`}
                </Td>
                <Td>
                  <Spark series={x.series} />
                </Td>
                <Td mono>{x.fieldsUpdated}</Td>
                <Td>{x.error ? <StatusBadge status="failed" label="error" /> : x.stressed ? <StatusBadge status="significant" label="stress" /> : <StatusBadge status="ok" />}</Td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      )}
    </div>
  );
}
