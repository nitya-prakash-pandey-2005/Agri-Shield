"use client";

/**
 * Asset detail — everything about one monitored site: map + satellite,
 * hazard scores in plain language, value-at-risk, 30-90 day history, live
 * rule metrics, the full location report on demand, rules that apply,
 * firing history, district alerts, notes and edit.
 */
import { Comments } from "@/components/collab";
import { PresenceAvatars } from "@/components/collab/PresenceAvatars";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Archive, ArrowLeft, Bell, Compass, Droplets, FileText, Flame, History, Info, MessageSquare, MessagesSquare, Pencil, RefreshCw, RotateCcw, Satellite, Sprout, Sun, Trash2, Waves, Zap } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Meter, Panel, RiskPill, Skeleton, SourceTag } from "@/components/hud";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/hooks/useRealtime";
import { HistoryChart, RainBars } from "@/components/portfolio/charts";
import { HAZARD_META, LEVEL_COLOR, TYPE_LABEL, esriSnapshotUrl, fmtNum, fmtUsd, hlsSnapshotUrl, modisSnapshotUrl, timeAgo, type HazardKey } from "@/components/portfolio/format";
import { Field, Help, Modal, PfButton, QueryError, TagPill, inputCls } from "@/components/portfolio/ui";

const BaseMap = dynamic(() => import("@/components/maps/BaseMap"), { ssr: false, loading: () => <Skeleton className="h-full" /> });

const HAZARD_ICON: Record<HazardKey, typeof Waves> = { flood: Waves, salinity: Droplets, drought: Sun, heat: Flame };

function levelWord(score: number) {
  return score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "moderate" : "low";
}

export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: session } = useSession();
  const orgId = session?.user?.orgId ?? null;
  const q = trpc.portfolio.getAsset.useQuery({ id }, { retry: false });
  const [showReport, setShowReport] = useState(false);
  const report = trpc.portfolio.assetReport.useQuery({ id }, { enabled: showReport, staleTime: 10 * 60_000, retry: false });
  const [editOpen, setEditOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sat, setSat] = useState<{ kind: "hls" | "modis"; daysAgo: number }>({ kind: "hls", daysAgo: 5 });

  useRealtime(orgId ? [`ws:${orgId}`] : [], (env) => {
    const t = (env.event as unknown as { type: string }).type;
    if (t === "portfolio.rescored" || t === "rule.fired") utils.portfolio.getAsset.invalidate({ id });
  });

  const rescore = trpc.portfolio.rescore.useMutation({
    onSuccess: () => {
      toast.success("Re-scored against the latest forecast");
      utils.portfolio.getAsset.invalidate({ id });
    },
    onError: (e) => toast.error(e.message),
  });
  const archive = trpc.portfolio.archiveAsset.useMutation({
    onSuccess: (r) => {
      toast.success(r.status === "archived" ? "Asset archived — monitoring stopped" : "Asset restored");
      utils.portfolio.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const addNote = trpc.portfolio.addNote.useMutation({
    onSuccess: () => {
      setNote("");
      utils.portfolio.getAsset.invalidate({ id });
    },
    onError: (e) => toast.error(e.message),
  });
  const delNote = trpc.portfolio.deleteNote.useMutation({ onSuccess: () => utils.portfolio.getAsset.invalidate({ id }), onError: (e) => toast.error(e.message) });

  if (q.error) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <EmptyState icon={Info} title={q.error.data?.code === "NOT_FOUND" ? "Asset not found" : "Could not load this asset"}>
          {q.error.message}
        </EmptyState>
        <Link href="/app/portfolio">
          <PfButton variant="outline" className="mt-2">
            <ArrowLeft size={14} /> Back to portfolio
          </PfButton>
        </Link>
      </div>
    );
  }
  const d = q.data;
  if (!d) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-[360px] lg:col-span-2" />
          <Skeleton className="h-[360px]" />
        </div>
        <Skeleton className="h-[160px]" />
      </div>
    );
  }
  const a = d.asset;
  const sc = d.score;
  const archived = a.status === "archived";
  const satDate = new Date(Date.now() - sat.daysAgo * 86_400_000).toISOString().slice(0, 10);
  const topHazard = (["flood", "salinity", "drought", "heat"] as HazardKey[]).reduce((b, h) => (sc[h] > sc[b] ? h : b), "flood" as HazardKey);

  return (
    <div>
      <Link href="/app/portfolio" className="mb-3 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
        <ArrowLeft size={13} /> Portfolio
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="hud-label mb-1 text-sky-300/90">
            {TYPE_LABEL[a.type] ?? a.type}
            {a.externalRef ? ` · ${a.externalRef}` : ""}
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white md:text-[28px]">{a.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RiskPill level={sc.level} />
            <span className="telemetry text-sm text-white">{sc.composite}/100</span>
            {d.row.change7d != null && (
              <span className={`telemetry text-xs ${d.row.change7d > 0 ? "text-rose-400" : d.row.change7d < 0 ? "text-emerald-400" : "text-slate-400"}`}>
                {d.row.change7d > 0 ? "▲ +" : d.row.change7d < 0 ? "▼ " : "± "}
                {d.row.change7d} vs 7 days ago
              </span>
            )}
            {archived && <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">archived</span>}
            {a.tags.map((t) => (
              <TagPill key={t} tag={t} />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/app/explorer?lat=${a.lat}&lon=${a.lon}&name=${encodeURIComponent(a.name)}${a.crop ? `&crop=${a.crop}` : ""}`}>
            <PfButton variant="outline">
              <Compass size={14} /> Open in Explorer
            </PfButton>
          </Link>
          {d.canWrite && (
            <>
              <PfButton variant="outline" onClick={() => rescore.mutate({ assetIds: [a.id] })} loading={rescore.isPending} disabled={archived}>
                {!rescore.isPending && <RefreshCw size={14} />} Re-score
              </PfButton>
              <PfButton variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil size={14} /> Edit
              </PfButton>
              <PfButton variant={archived ? "outline" : "danger"} onClick={() => archive.mutate({ id: a.id, archived: !archived })} loading={archive.isPending}>
                {archived ? <RotateCcw size={14} /> : <Archive size={14} />} {archived ? "Restore" : "Archive"}
              </PfButton>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Location" subtitle={`${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}${d.district ? ` · ${d.district.name}, ${d.district.country}` : ` · ${a.country}`}`} icon={Satellite} accent="cyan" className="lg:col-span-2" bodyClassName="p-0">
          <div className="relative h-[340px]">
            <BaseMap
              center={[a.lat, a.lon]}
              zoom={14}
              basemap="satellite"
              onReady={(map, L) => {
                L.circle([a.lat, a.lon], { radius: a.areaHa ? Math.sqrt((a.areaHa * 10_000) / Math.PI) : 120, color: LEVEL_COLOR[sc.level], weight: 2, fillOpacity: 0.12 }).addTo(map);
                L.circleMarker([a.lat, a.lon], { radius: 7, color: "#fff", weight: 2, fillColor: LEVEL_COLOR[sc.level], fillOpacity: 1 }).addTo(map).bindTooltip(a.name);
              }}
            />
          </div>
        </Panel>

        <Panel title="Overall climate risk" subtitle={sc.at ? `Scored ${timeAgo(sc.at)}` : "District baseline — live score pending"} icon={Zap} accent={sc.composite >= 60 ? "red" : sc.composite >= 35 ? "amber" : "green"} actions={<SourceTag href="https://open-meteo.com">{sc.source === "live" ? "Open-Meteo · GloFAS" : "district baseline"}</SourceTag>}>
          <div className="flex items-end gap-3">
            <span className="telemetry text-5xl font-semibold" style={{ color: LEVEL_COLOR[sc.level] }}>
              {sc.composite}
            </span>
            <span className="pb-2 text-xs text-slate-400">/ 100 composite</span>
          </div>
          <Meter value={sc.composite} className="mt-2" />
          <p className="mt-3 text-[13px] leading-relaxed text-slate-300">
            <span className="hud-label mr-1 text-sky-300">What this means</span>
            {levelWord(sc.composite) === "low"
              ? `No significant hazard is expected at this site in the forecast window.`
              : `${HAZARD_META[topHazard].label} is the main threat here (${sc[topHazard]}/100).${sc.source === "live" && sc.drivers[0] ? ` ${sc.drivers[0]}.` : ""}`}{" "}
            If today’s hazards play out, the expected loss is about <b className="text-amber-200">{fmtUsd(d.varUsd)}</b> of the {fmtUsd(a.valueUsd)} exposure.
          </p>
          <ul className="mt-3 space-y-1 text-xs text-slate-400">
            {sc.drivers.map((x) => (
              <li key={x} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sky-400" />
                {x}
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-white/[0.03] p-2.5">
              <div className="hud-label">Exposure</div>
              <div className="telemetry mt-0.5 text-base text-white">{fmtUsd(a.valueUsd, false)}</div>
            </div>
            <div className="rounded-lg bg-white/[0.03] p-2.5">
              <div className="hud-label flex items-center gap-1">
                Value-at-risk <Help text="Exposure × (composite ÷ 100) × the hazard-weighted typical damage ratio (flood 45 %, drought 35 %, salinity 30 %, heat 20 %). An expected-loss indicator for triage, not a regulatory VaR." />
              </div>
              <div className="telemetry mt-0.5 text-base text-amber-200">{fmtUsd(d.varUsd, false)}</div>
            </div>
          </div>
        </Panel>
      </div>

      {/* Hazards */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(["flood", "salinity", "drought", "heat"] as HazardKey[]).map((h, i) => {
          const Icon = HAZARD_ICON[h];
          const m = HAZARD_META[h];
          const v = sc[h];
          return (
            <motion.div key={h} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="hud-panel p-4" style={{ ["--hud-accent" as string]: "56 189 248" }}>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-white">
                  <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${m.color}22`, color: m.color }}>
                    <Icon size={14} />
                  </span>
                  {m.label}
                </span>
                <span className="telemetry text-xl" style={{ color: LEVEL_COLOR[v >= 80 ? "critical" : v >= 60 ? "high" : v >= 35 ? "medium" : "low"] }}>
                  {v}
                </span>
              </div>
              <Meter value={v} className="mt-3" />
              <p className="mt-3 text-[11.5px] leading-relaxed text-slate-400">{m.explain}</p>
              <div className="mt-2 flex justify-between text-[11px] text-slate-500">
                <span>{levelWord(v)} risk</span>
                <span className="telemetry">VaR {fmtUsd((d.varByHazard as Record<string, number>)[h] ?? 0)}</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Risk history" subtitle={`${d.history.length} daily composite scores · dashed lines = medium / high / critical`} icon={History} accent="cyan" className="lg:col-span-2">
          {d.history.length ? <HistoryChart data={d.history} height={240} /> : <EmptyState title="No history yet">A point is added every day the asset is scored.</EmptyState>}
        </Panel>
        <Panel title="Live alert metrics" subtitle="What your alert rules see for this asset" icon={Bell} accent="violet" actions={d.quick ? <SourceTag>{d.quick.source}</SourceTag> : <SourceTag>baseline</SourceTag>}>
          <ul className="divide-y divide-white/5">
            {d.metrics.map((m) => (
              <li key={m.metric} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                <span className="inline-flex items-center gap-1.5 text-slate-400">
                  {m.short} <Help text={m.help} />
                </span>
                <span className="telemetry text-slate-100">{m.value == null ? <span className="text-slate-600">no data</span> : `${fmtNum(m.value, m.unit === "dS/m" || m.unit === "×" ? 2 : m.unit === "mm" ? 1 : 0)} ${m.unit}`}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* Satellite + report */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Satellite view" subtitle="High-resolution basemap + recent 30 m Landsat/Sentinel (HLS)" icon={Satellite} accent="cyan">
          <div className="space-y-3">
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={esriSnapshotUrl(a.lat, a.lon)} alt={`High-resolution imagery around ${a.name}`} className="h-40 w-full rounded-lg object-cover" loading="lazy" />
              <figcaption className="mt-1 flex justify-between text-[10px] text-slate-500">
                ~1.2 km across <SourceTag href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9">Esri World Imagery</SourceTag>
              </figcaption>
            </figure>
            <figure>
              <div className="mb-1.5 flex flex-wrap gap-1">
                {[
                  { kind: "hls" as const, daysAgo: 3, label: "HLS −3 d" },
                  { kind: "hls" as const, daysAgo: 5, label: "HLS −5 d" },
                  { kind: "hls" as const, daysAgo: 9, label: "HLS −9 d" },
                  { kind: "modis" as const, daysAgo: 1, label: "MODIS yesterday" },
                ].map((o) => (
                  <button
                    key={o.label}
                    onClick={() => setSat(o)}
                    className={`rounded-md px-2 py-0.5 text-[10px] ${sat.kind === o.kind && sat.daysAgo === o.daysAgo ? "bg-sky-400 text-slate-950" : "bg-white/5 text-slate-400 hover:text-white"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={`${sat.kind}-${satDate}`}
                src={sat.kind === "hls" ? hlsSnapshotUrl(a.lat, a.lon, satDate) : modisSnapshotUrl(a.lat, a.lon, satDate)}
                alt={`${sat.kind === "hls" ? "Harmonized Landsat-Sentinel" : "MODIS"} image near ${a.name}`}
                className="h-40 w-full rounded-lg bg-slate-900 object-cover"
                loading="lazy"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = "0.2")}
              />
              <figcaption className="mt-1 flex justify-between gap-2 text-[10px] text-slate-500">
                <span>
                  {sat.kind === "hls" ? "~6 km · 30 m Landsat/Sentinel-2" : "~60 km · 250 m daily — clouds & floodwater"} · {satDate}
                  {sat.kind === "hls" && " (black = no clear pass that day, try another date)"}
                </span>
                <SourceTag href={sat.kind === "hls" ? "https://www.earthdata.nasa.gov/data/projects/hls" : "https://earthdata.nasa.gov/gibs"}>{sat.kind === "hls" ? "NASA HLS" : "NASA MODIS"}</SourceTag>
              </figcaption>
            </figure>
          </div>
        </Panel>

        <Panel
          title="Full location report"
          subtitle="ML flood & salinity models, 7-day forecast, river discharge, nearby disasters"
          icon={FileText}
          accent="cyan"
          className="lg:col-span-2"
          actions={
            <Link href={`/app/explorer?lat=${a.lat}&lon=${a.lon}&name=${encodeURIComponent(a.name)}`} className="text-[11px] text-sky-300 hover:underline">
              Explorer →
            </Link>
          }
        >
          {!showReport ? (
            <div className="py-6 text-center">
              <p className="mx-auto max-w-md text-xs text-slate-400">Runs the full Agri-SHIELD engine for this exact coordinate (counts as one assessment on your plan).</p>
              <PfButton className="mt-3" onClick={() => setShowReport(true)}>
                <FileText size={14} /> Generate full report
              </PfButton>
            </div>
          ) : report.isLoading ? (
            <Skeleton className="h-[260px]" />
          ) : report.error ? (
            <QueryError error={report.error} onRetry={() => report.refetch()} />
          ) : report.data ? (
            <div className="space-y-4">
              <p className="text-[13px] text-slate-300">{report.data.composite.summary}</p>
              <div className="grid gap-2 text-xs sm:grid-cols-4">
                <Stat label="Flood 24/48/72 h" value={`${Math.round(report.data.hazards.flood.p24 * 100)} / ${Math.round(report.data.hazards.flood.p48 * 100)} / ${Math.round(report.data.hazards.flood.p72 * 100)}%`} hint={`Est. depth ${report.data.hazards.flood.depthM.toFixed(2)} m · model ${report.data.hazards.flood.model}`} />
                <Stat label="Soil salinity EC" value={report.data.hazards.salinity.applicable ? `${report.data.hazards.salinity.ecNow.toFixed(1)} → ${report.data.hazards.salinity.ec30d.toFixed(1)} dS/m` : "n/a (inland)"} hint="Now → 30-day forecast. Rice tolerance ≈ 3 dS/m" />
                <Stat label="7-day water balance" value={`${report.data.hazards.drought.waterBalance7dMm > 0 ? "+" : ""}${report.data.hazards.drought.waterBalance7dMm} mm`} hint={`Rain ${report.data.hazards.drought.rain7dForecastMm} mm − evaporation ${report.data.hazards.drought.et0_7dMm} mm`} />
                <Stat label="Max temperature" value={report.data.hazards.heat.maxTempC != null ? `${report.data.hazards.heat.maxTempC.toFixed(1)} °C` : "—"} hint={`${report.data.hazards.heat.hotDays} day(s) ≥ 35 °C`} />
              </div>
              {report.data.forecast.daily.length > 0 && (
                <div>
                  <div className="hud-label mb-1">Daily rain forecast (mm)</div>
                  <RainBars data={report.data.forecast.daily} />
                </div>
              )}
              {report.data.river?.ratio != null && (
                <p className="text-xs text-slate-400">
                  River discharge peak <b className="text-slate-200">{fmtNum(report.data.river.dischargeM3s)} m³/s</b>, <b className="text-slate-200">{report.data.river.ratio}×</b> its 30-day mean.
                </p>
              )}
              {report.data.hazardsNearby.length > 0 && (
                <div>
                  <div className="hud-label mb-1">Active disasters within 800 km</div>
                  <ul className="space-y-1 text-xs text-slate-300">
                    {report.data.hazardsNearby.slice(0, 4).map((h) => (
                      <li key={h.id}>
                        {h.title} <span className="text-slate-500">· {h.distanceKm} km</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {report.data.sources.map((s) => (
                  <SourceTag key={s.name} href={s.url.startsWith("http") ? s.url : undefined}>
                    {s.ok ? "✓" : "✕"} {s.name}
                  </SourceTag>
                ))}
              </div>
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Alert rules for this asset" subtitle="Rules whose scope includes it, checked against its current metrics" icon={Bell} accent="violet" actions={<Link href="/app/alerts" className="text-[11px] text-sky-300 hover:underline">Manage →</Link>}>
          {d.rules.length ? (
            <ul className="space-y-2">
              {d.rules.map((r) => (
                <li key={r.id} className="rounded-lg border border-white/5 p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-200">{r.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.matched ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/10 text-emerald-300"}`}>{r.matched ? "CONDITIONS MET" : "OK"}</span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {r.results.map((c, i) => (
                      <li key={i} className="telemetry text-[11px] text-slate-400">
                        {c.pass ? "●" : "○"} {c.metric} {c.op} {c.value} · now {c.actual == null ? "no data" : fmtNum(c.actual, 1)}
                      </li>
                    ))}
                  </ul>
                  {!r.enabled && <div className="mt-1 text-[10px] text-slate-500">rule disabled</div>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No rules cover this asset">
              <Link href="/app/alerts?new=1" className="text-sky-300 hover:underline">
                Create a rule
              </Link>{" "}
              to be notified when it crosses a threshold.
            </EmptyState>
          )}
        </Panel>

        <Panel title="Firings & alerts" subtitle="Rule firings for this asset + official alerts in its district (30 days)" icon={Zap} accent="red">
          {d.firings.length || d.relatedAlerts.length ? (
            <ul className="space-y-2 text-xs">
              {d.firings.map((f) => (
                <li key={f.id} className="flex gap-2">
                  <Zap size={12} className="mt-0.5 shrink-0" style={{ color: f.severity === "critical" ? "#f87171" : f.severity === "warning" ? "#fbbf24" : "#38bdf8" }} />
                  <span className="min-w-0">
                    <Link href={`/app/alerts?tab=history&firing=${f.id}`} className="text-slate-200 hover:text-sky-300">
                      {f.ruleName}
                    </Link>
                    <span className="block text-[10.5px] text-slate-500">
                      {timeAgo(f.at)} · {f.reason}
                    </span>
                  </span>
                </li>
              ))}
              {d.relatedAlerts.map((al) => (
                <li key={al.id} className="flex gap-2">
                  <Sprout size={12} className="mt-0.5 shrink-0 text-amber-300" />
                  <span className="min-w-0">
                    <span className="text-slate-200">{al.title}</span>
                    <span className="block text-[10.5px] text-slate-500">
                      {al.severity} · {al.source} · {timeAgo(al.createdAt)}
                      {al.isActive ? " · active" : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Quiet so far">No rule has fired for this asset and there are no recent official alerts in its district.</EmptyState>
          )}
        </Panel>

        <Panel title="Notes" subtitle="Shared with your workspace" icon={MessageSquare} accent="cyan">
          {d.canWrite && (
            <form
              className="mb-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) addNote.mutate({ assetId: a.id, text: note.trim() });
              }}
            >
              <input className={cn(inputCls, "py-1.5")} placeholder="e.g. Field visit: embankment repaired" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
              <PfButton size="sm" type="submit" disabled={!note.trim()} loading={addNote.isPending}>
                Add
              </PfButton>
            </form>
          )}
          {d.notes.length ? (
            <ul className="space-y-2">
              {d.notes.map((n) => (
                <li key={n.id} className="group rounded-lg bg-white/[0.02] p-2.5 text-xs">
                  <div className="whitespace-pre-wrap text-slate-200">{n.text}</div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                    <span>
                      {n.userName} · {timeAgo(n.at)}
                    </span>
                    {d.canWrite && (
                      <button className="opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100" onClick={() => delNote.mutate({ assetId: a.id, noteId: n.id })} aria-label="Delete note">
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">No notes yet. Record field visits, claims or borrower conversations here.</p>
          )}
          <div className="mt-4 border-t border-white/5 pt-3">
            <div className="hud-label mb-1.5">Details</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <dt className="text-slate-500">Country</dt>
              <dd className="text-slate-300">{a.country}</dd>
              {a.crop && (
                <>
                  <dt className="text-slate-500">Crop</dt>
                  <dd className="text-slate-300">{a.crop}</dd>
                </>
              )}
              {a.areaHa != null && (
                <>
                  <dt className="text-slate-500">Area</dt>
                  <dd className="text-slate-300">{a.areaHa} ha</dd>
                </>
              )}
              {a.address && (
                <>
                  <dt className="text-slate-500">Address</dt>
                  <dd className="truncate text-slate-300" title={a.address}>
                    {a.address}
                  </dd>
                </>
              )}
              {Object.entries(a.meta)
                .filter(([, v]) => v !== null && v !== "")
                .slice(0, 12)
                .map(([k, v]) => (
                  <Detail key={k} k={k} v={v} />
                ))}
              <dt className="text-slate-500">Added</dt>
              <dd className="text-slate-300">{new Date(a.createdAt).toISOString().slice(0, 10)}</dd>
            </dl>
          </div>
        </Panel>

        <Panel title="Discussion" subtitle="Comment and @mention teammates — they're notified instantly" icon={MessagesSquare} accent="cyan" actions={<PresenceAvatars room={`asset:${a.id}`} />}>
          <Comments entityType="asset" entityId={a.id} />
        </Panel>
      </div>

      {d.canWrite && <EditAssetDialog open={editOpen} onClose={() => setEditOpen(false)} asset={a} onSaved={() => { utils.portfolio.getAsset.invalidate({ id }); router.refresh(); }} />}
    </div>
  );
}

function Detail({ k, v }: { k: string; v: unknown }) {
  const label = k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return (
    <>
      <dt className="truncate capitalize text-slate-500">{label}</dt>
      <dd className="truncate text-slate-300" title={String(v)}>
        {typeof v === "number" && /usd/i.test(k) ? fmtUsd(v, false) : typeof v === "boolean" ? (v ? "yes" : "no") : String(v)}
      </dd>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] p-2.5" title={hint}>
      <div className="hud-label">{label}</div>
      <div className="telemetry mt-0.5 text-sm text-white">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}

type EditableAsset = { id: string; name: string; type: string; valueUsd: number; crop: string | null; externalRef: string | null; tags: string[]; lat: number; lon: number; address: string | null; areaHa: number | null };

function EditAssetDialog({ open, onClose, asset, onSaved }: { open: boolean; onClose: () => void; asset: EditableAsset; onSaved: () => void }) {
  const meta = trpc.portfolio.meta.useQuery(undefined, { staleTime: 3600_000 });
  const [f, setF] = useState({ name: "", type: "", value: "", crop: "", ref: "", tags: "", lat: "", lon: "", address: "", area: "" });
  useEffect(() => {
    if (open)
      setF({
        name: asset.name,
        type: asset.type,
        value: String(asset.valueUsd),
        crop: asset.crop ?? "",
        ref: asset.externalRef ?? "",
        tags: asset.tags.join(", "),
        lat: String(asset.lat),
        lon: String(asset.lon),
        address: asset.address ?? "",
        area: asset.areaHa == null ? "" : String(asset.areaHa),
      });
  }, [open, asset]);
  const update = trpc.portfolio.updateAsset.useMutation({
    onSuccess: () => {
      toast.success("Asset updated");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const lat = Number(f.lat);
  const lon = Number(f.lon);
  const bad = !f.name.trim() || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit asset"
      subtitle="Moving the location re-scores the asset immediately."
      footer={
        <>
          <PfButton variant="ghost" onClick={onClose}>
            Cancel
          </PfButton>
          <PfButton
            disabled={bad}
            loading={update.isPending}
            onClick={() =>
              update.mutate({
                id: asset.id,
                patch: {
                  name: f.name.trim(),
                  type: f.type as never,
                  valueUsd: Number(f.value) || 0,
                  crop: (f.crop || null) as never,
                  externalRef: f.ref || null,
                  tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
                  lat,
                  lon,
                  address: f.address || null,
                  areaHa: f.area ? Number(f.area) : null,
                },
              })
            }
          >
            Save changes
          </PfButton>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <input className={inputCls} value={f.name} onChange={set("name")} />
        </Field>
        <Field label="Type">
          <select className={inputCls} value={f.type} onChange={set("type")}>
            {meta.data?.assetTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Crop">
          <select className={inputCls} value={f.crop} onChange={set("crop")}>
            <option value="">—</option>
            {meta.data?.crops.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Value (USD)">
          <input className={inputCls} inputMode="numeric" value={f.value} onChange={set("value")} />
        </Field>
        <Field label="Reference">
          <input className={inputCls} value={f.ref} onChange={set("ref")} />
        </Field>
        <Field label="Latitude">
          <input className={inputCls} inputMode="decimal" value={f.lat} onChange={set("lat")} />
        </Field>
        <Field label="Longitude">
          <input className={inputCls} inputMode="decimal" value={f.lon} onChange={set("lon")} />
        </Field>
        <Field label="Area (ha)">
          <input className={inputCls} inputMode="decimal" value={f.area} onChange={set("area")} />
        </Field>
        <Field label="Tags" hint="Comma-separated">
          <input className={inputCls} value={f.tags} onChange={set("tags")} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <input className={inputCls} value={f.address} onChange={set("address")} />
        </Field>
      </div>
    </Modal>
  );
}
