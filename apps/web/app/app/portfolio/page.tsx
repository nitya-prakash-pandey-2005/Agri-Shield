"use client";

/**
 * Portfolio overview — every monitored asset scored against live forecasts:
 * KPIs (exposure, value-at-risk, % at risk), clustered risk map with
 * box-select bulk tagging, distribution, hazard exposure, movers,
 * concentration, 30-day trend and the full asset table.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Archive, Download, FileUp, Gauge, Layers, MapPin, MousePointerClick, Plus, RefreshCw, Search, ShieldAlert, Tag, TrendingDown, TrendingUp, Upload, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Panel, RiskPill, Skeleton, SourceTag, StatTile } from "@/components/hud";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/hooks/useRealtime";
import { AddAssetDialog } from "@/components/portfolio/AddAssetDialog";
import { AssetTable, type SortKey } from "@/components/portfolio/AssetTable";
import { HazardBars, RiskHistogram, TrendChart } from "@/components/portfolio/charts";
import { LEVELS, LEVEL_COLOR, TYPE_LABEL, downloadText, fmtUsd, timeAgo, type Level } from "@/components/portfolio/format";
import { Chip, Help, PageTitle, PfButton, QueryError, inputCls } from "@/components/portfolio/ui";

const PortfolioMap = dynamic(() => import("@/components/portfolio/PortfolioMap"), { ssr: false, loading: () => <Skeleton className="h-[460px]" /> });

const SORT_KEYS: SortKey[] = ["name", "composite", "value", "var", "change7d", "createdAt", "type", "country", "flood", "salinity", "drought", "heat"];

/**
 * Deep links (used by Copilot actions and shared URLs):
 *   ?asset=<id>                                   → asset page
 *   ?sort=flood|salinity|drought|heat|composite|value|var|change7d&dir=asc|desc
 *   &tag=<tag>&country=<country>&level=high,critical&type=loan&q=<search>
 */
export default function PortfolioPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px]" />}>
      <PortfolioInner />
    </Suspense>
  );
}

function PortfolioInner() {
  const router = useRouter();
  const params = useSearchParams();
  const utils = trpc.useUtils();
  const { data: session } = useSession();
  const orgId = session?.user?.orgId ?? null;

  const initialSort = params.get("sort") as SortKey | null;
  const [levels, setLevels] = useState<Level[]>(() => (params.get("level") ?? "").split(",").filter((l): l is Level => (LEVELS as readonly string[]).includes(l)));
  const [types, setTypes] = useState<string[]>(() => (params.get("type") ?? "").split(",").filter(Boolean));
  const [tag, setTag] = useState<string>(params.get("tag") ?? "");
  const [country, setCountry] = useState<string>(params.get("country") ?? "");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [sort, setSort] = useState<SortKey>(initialSort && SORT_KEYS.includes(initialSort) ? initialSort : "composite");
  const [dir, setDir] = useState<"asc" | "desc">(params.get("dir") === "asc" ? "asc" : "desc");

  useEffect(() => {
    const asset = params.get("asset");
    if (asset) router.replace(`/app/portfolio/${encodeURIComponent(asset)}`);
  }, [params, router]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const [addOpen, setAddOpen] = useState<null | "search" | "map" | "coords">(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [levels, types, tag, country, q]);

  const filters = useMemo(
    () => ({ levels: levels.length ? levels : undefined, types: types.length ? (types as never[]) : undefined, tags: tag ? [tag] : undefined, countries: country ? [country] : undefined, search: q || undefined }),
    [levels, types, tag, country, q]
  );

  const meta = trpc.portfolio.meta.useQuery(undefined, { staleTime: 3600_000 });
  const summary = trpc.portfolio.summary.useQuery(undefined, { refetchInterval: 5 * 60_000 });
  const list = trpc.portfolio.listAssets.useQuery({ ...filters, sort, dir, page, pageSize: 20 }, { placeholderData: (p) => p });
  const map = trpc.portfolio.mapAssets.useQuery(filters, { placeholderData: (p) => p });

  const invalidateAll = () => {
    utils.portfolio.summary.invalidate();
    utils.portfolio.listAssets.invalidate();
    utils.portfolio.mapAssets.invalidate();
  };

  useRealtime(orgId ? [`ws:${orgId}`] : [], (env) => {
    const t = (env.event as unknown as { type: string }).type;
    if (t === "portfolio.rescored") invalidateAll();
  });

  const rescore = trpc.portfolio.rescore.useMutation({
    onSuccess: (r) => {
      toast.success(`Re-scored ${r.count} assets`, { description: `${r.live} on live forecasts${r.fallback ? `, ${r.fallback} kept last known score (live feed unavailable)` : ""} · ${(r.durationMs / 1000).toFixed(1)} s${r.levelChanges.length ? ` · ${r.levelChanges.length} changed level` : ""}` });
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });
  const exportM = trpc.portfolio.exportAssets.useMutation({
    onSuccess: (f) => {
      downloadText(f.filename, f.content, f.mime);
      toast.success(`Exported ${f.count} assets`);
    },
    onError: (e) => toast.error(e.message),
  });
  const tagM = trpc.portfolio.bulkTag.useMutation({
    onSuccess: (r) => {
      toast.success(`Tagged ${r.updated} assets`);
      setBulkTag("");
      invalidateAll();
      utils.portfolio.listTags.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const archiveM = trpc.portfolio.bulkArchive.useMutation({
    onSuccess: (r) => {
      toast.success(`Archived ${r.updated} assets`, { description: "Archived assets stop being monitored. Restore them from the Archived filter." });
      setSelected(new Set());
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const s = summary.data;
  const canWrite = meta.data?.canWrite ?? false;
  const isEmpty = s && s.counts.assets === 0;
  const onSort = (k: SortKey) => {
    if (k === sort) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(k);
      setDir(k === "name" || k === "country" || k === "type" ? "asc" : "desc");
    }
  };
  const toggle = (id: string) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const facets = list.data?.facets;
  const center = (s?.workspace.center as [number, number] | null) ?? null;

  return (
    <div>
      <PageTitle
        eyebrow="Portfolio monitoring"
        title={s ? `${s.workspace.name}` : "Portfolio"}
        description="Every site you have money or people at, scored 0-100 for flood, salinity, drought and heat from live forecasts — with the dollars at stake."
        actions={
          <>
            {s?.liveFeed === "unavailable" ? (
              <span className="telemetry hidden text-[11px] text-amber-400/80 md:inline" title="Open-Meteo did not answer (rate limit or outage). Last known scores are kept; the monitor retries hourly.">
                live feed unavailable · showing last known scores
              </span>
            ) : s?.lastRescore ? (
              <span className="telemetry hidden text-[11px] text-slate-500 md:inline">
                scored {timeAgo(s.lastRescore.at)} · {s.lastRescore.live} live
              </span>
            ) : s && s.counts.baseline > 0 ? (
              <span className="telemetry hidden text-[11px] text-amber-400/80 md:inline">{s.rescoring ? "live scoring in progress…" : "showing district baselines"}</span>
            ) : null}
            {canWrite && (
              <>
                <PfButton variant="outline" onClick={() => rescore.mutate({ evaluateRules: true })} loading={rescore.isPending || s?.rescoring} disabled={!s?.counts.assets}>
                  {!(rescore.isPending || s?.rescoring) && <RefreshCw size={14} />} Re-score now
                </PfButton>
                <Link href="/app/portfolio/import">
                  <PfButton variant="outline">
                    <Upload size={14} /> Import
                  </PfButton>
                </Link>
                <PfButton onClick={() => setAddOpen("search")}>
                  <Plus size={14} /> Add asset
                </PfButton>
              </>
            )}
          </>
        }
      />

      <QueryError error={summary.error} onRetry={() => summary.refetch()} />

      {isEmpty ? (
        <EmptyPortfolio canWrite={canWrite} onAdd={(m) => setAddOpen(m)} archived={s.counts.archived} />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {s ? (
              <>
                <StatTile label="Assets monitored" value={s.counts.assets} icon={Layers} accent="cyan" delta={s.counts.baseline ? `${s.counts.live} live · ${s.counts.baseline} baseline` : `all ${s.counts.live} on live data`} deltaGood={!s.counts.baseline} hint="Active assets in this workspace" />
                <StatTile label="Total exposure" value={s.kpis.totalExposureUsd / 1e6} decimals={2} prefix="$" suffix="M" icon={Wallet} accent="violet" delta={`avg ${fmtUsd(s.kpis.totalExposureUsd / Math.max(1, s.counts.assets))} per asset`} deltaGood hint="Sum of sums insured / loans outstanding / asset values (USD)" />
                <StatTile label="Value-at-risk" value={s.kpis.valueAtRiskUsd / 1e3} decimals={1} prefix="$" suffix="k" icon={ShieldAlert} accent="amber" delta={`${s.kpis.varRatio}% of exposure`} deltaGood={s.kpis.varRatio < 5} hint={s.methodology.var} />
                <StatTile label="At risk now" value={s.kpis.pctAtRisk} decimals={1} suffix="%" icon={Gauge} accent="red" delta={`${s.kpis.atRisk} assets · ${fmtUsd(s.kpis.exposureAtRiskUsd)}`} deltaGood={s.kpis.pctAtRisk < 10} hint={s.methodology.atRisk} />
              </>
            ) : (
              [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px]" />)
            )}
          </div>

          {s && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 rounded-xl border border-sky-400/15 bg-sky-400/[0.04] px-4 py-3 text-[13px] leading-relaxed text-slate-300">
              <span className="hud-label mr-2 text-sky-300">What this means</span>
              {s.kpis.atRisk > 0 ? (
                <>
                  <b className="text-white">{s.kpis.atRisk}</b> of your {s.counts.assets} assets ({fmtUsd(s.kpis.exposureAtRiskUsd)} of exposure) score at or above your {s.threshold}/100 risk threshold.{" "}
                </>
              ) : (
                <>No asset is above your {s.threshold}/100 risk threshold right now. </>
              )}
              Expected loss if today’s hazards play out is about <b className="text-amber-200">{fmtUsd(s.kpis.valueAtRiskUsd)}</b>
              {s.hazardMix.length ? `, mostly from ${[...s.hazardMix].sort((a, b) => b.varUsd - a.varUsd)[0]!.hazard}` : ""}.
              {s.topMovers[0] && s.topMovers[0].change > 0 && (
                <>
                  {" "}
                  Fastest riser this week: <Link className="text-sky-300 hover:underline" href={`/app/portfolio/${s.topMovers[0].id}`}>{s.topMovers[0].name}</Link> (+{s.topMovers[0].change}).
                </>
              )}
            </motion.div>
          )}

          {/* Map + distribution */}
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Panel
              title="Risk map"
              subtitle="Clusters take the colour of their worst asset · click to zoom · “Select area” to bulk-tag"
              icon={MapPin}
              accent="cyan"
              className="xl:col-span-2"
              actions={<SourceTag href="https://open-meteo.com">Open-Meteo · GloFAS</SourceTag>}
            >
              <div className="mb-3 flex flex-wrap gap-1.5">
                {LEVELS.map((l) => (
                  <Chip key={l} active={levels.includes(l)} color={LEVEL_COLOR[l]} onClick={() => setLevels(levels.includes(l) ? levels.filter((x) => x !== l) : [...levels, l])}>
                    {l} {s ? <span className="telemetry text-slate-500">{s.byLevel[l]}</span> : null}
                  </Chip>
                ))}
                <span className="mx-1 w-px bg-white/10" />
                {s?.byType.map((t) => (
                  <Chip key={t.type} active={types.includes(t.type)} onClick={() => setTypes(types.includes(t.type) ? types.filter((x) => x !== t.type) : [...types, t.type])}>
                    {TYPE_LABEL[t.type] ?? t.type} <span className="telemetry text-slate-500">{t.count}</span>
                  </Chip>
                ))}
                {(levels.length > 0 || types.length > 0 || tag || country || q) && (
                  <button className="ml-1 text-[11px] text-slate-400 underline-offset-2 hover:text-white hover:underline" onClick={() => { setLevels([]); setTypes([]); setTag(""); setCountry(""); setSearch(""); }}>
                    Clear filters
                  </button>
                )}
              </div>
              <PortfolioMap
                points={map.data ?? []}
                center={center}
                zoom={s?.workspace.zoom ?? 6}
                height={460}
                selectedIds={selected}
                onOpen={(id) => router.push(`/app/portfolio/${id}`)}
                onBoxSelect={canWrite ? (ids) => {
                  setSelected(new Set(ids));
                  toast.message(`${ids.length} assets selected`, { description: ids.length ? "Use the bar below the map to tag or archive them." : "No assets inside that rectangle." });
                } : undefined}
              />
            </Panel>

            <div className="space-y-4">
              <Panel title="Risk distribution" subtitle="Assets by composite score (0-100)" icon={Gauge} accent="cyan">
                {s ? <RiskHistogram data={s.histogram} threshold={s.threshold} /> : <Skeleton className="h-[190px]" />}
                {s && (
                  <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]">
                    {LEVELS.map((l) => (
                      <div key={l} className="rounded-md bg-white/[0.02] py-1">
                        <div className="telemetry text-sm" style={{ color: LEVEL_COLOR[l] }}>{s.byLevel[l]}</div>
                        <div className="uppercase tracking-wider text-slate-500">{l}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
              <Panel
                title={
                  <span className="inline-flex items-center gap-1.5">
                    Exposure by hazard <Help text="Value-at-risk split by hazard: each asset's expected loss is divided among hazards in proportion to their scores, times each hazard's typical damage ratio (flood 45 %, drought 35 %, salinity 30 %, heat 20 %)." />
                  </span>
                }
                subtitle="Value-at-risk (USD) by hazard"
                icon={ShieldAlert}
                accent="amber"
              >
                {s ? <HazardBars data={s.hazardMix} /> : <Skeleton className="h-[160px]" />}
              </Panel>
            </div>
          </div>

          {/* Movers / concentration / trend */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Panel title="Top risk movers" subtitle="Biggest change in composite vs 7 days ago" icon={TrendingUp} accent="red">
              {s ? (
                s.topMovers.length ? (
                  <ul className="divide-y divide-white/5">
                    {s.topMovers.map((m) => (
                      <li key={m.id}>
                        <Link href={`/app/portfolio/${m.id}`} className="flex items-center gap-3 py-2 text-xs hover:bg-white/[0.02]">
                          <span className={`telemetry w-10 text-right font-semibold ${m.change > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                            {m.change > 0 ? <TrendingUp size={11} className="mr-0.5 inline" /> : <TrendingDown size={11} className="mr-0.5 inline" />}
                            {m.change > 0 ? `+${m.change}` : m.change}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-slate-200">{m.name}</span>
                            <span className="block truncate text-[10px] text-slate-500">{m.driver}</span>
                          </span>
                          <RiskPill level={m.level} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No history yet">Movers appear once assets have a week of daily scores.</EmptyState>
                )
              ) : (
                <Skeleton className="h-[300px]" />
              )}
            </Panel>
            <Panel
              title={
                <span className="inline-flex items-center gap-1.5">
                  Concentration <Help text="Where your exposure is clustered. The HHI (Herfindahl index) is the sum of squared exposure shares: below 0.15 is diversified, above 0.25 means one flood could hit a large share of the book." />
                </span>
              }
              subtitle={s ? `Exposure by district · HHI ${s.concentration.hhi}${s.concentration.hhi > 0.25 ? " (concentrated)" : s.concentration.hhi > 0.15 ? " (moderate)" : " (diversified)"}` : "Exposure by district"}
              icon={Layers}
              accent="violet"
            >
              {s ? (
                <ul className="space-y-2">
                  {s.concentration.byDistrict.slice(0, 8).map((d) => (
                    <li key={d.key} className="text-xs" title={`${d.count} assets · VaR ${fmtUsd(d.varUsd)} · avg composite ${d.avgComposite}`}>
                      <div className="mb-0.5 flex justify-between gap-2">
                        <span className="truncate text-slate-300">
                          {d.label} <span className="text-slate-500">· {d.count}</span>
                        </span>
                        <span className="telemetry shrink-0 text-slate-200">
                          {fmtUsd(d.exposure)} <span className="text-slate-500">{d.share}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, d.share * 2)}%`, background: LEVEL_COLOR[d.avgComposite >= 80 ? "critical" : d.avgComposite >= 60 ? "high" : d.avgComposite >= 35 ? "medium" : "low"] }} />
                      </div>
                    </li>
                  ))}
                  <li className="pt-1 text-[10px] text-slate-500">Bar colour = average risk level in that district. Countries: {s.concentration.byCountry.map((c) => `${c.label} ${c.share}%`).join(" · ")}</li>
                </ul>
              ) : (
                <Skeleton className="h-[300px]" />
              )}
            </Panel>
            <Panel title="30-day risk trend" subtitle="Average composite score across the portfolio" icon={TrendingUp} accent="cyan" actions={<SourceTag>daily history</SourceTag>}>
              {s ? <TrendChart data={s.trend} threshold={s.threshold} height={250} /> : <Skeleton className="h-[250px]" />}
            </Panel>
          </div>

          {/* Asset table */}
          <Panel
            title="Assets"
            subtitle={list.data ? `${list.data.total} matching · exposure ${fmtUsd(list.data.totals.exposure)} · value-at-risk ${fmtUsd(list.data.totals.varUsd)}` : "Loading…"}
            icon={Layers}
            accent="cyan"
            className="mt-4"
            actions={
              <div className="flex gap-1.5">
                <PfButton size="sm" variant="outline" loading={exportM.isPending && exportM.variables?.format === "csv"} onClick={() => exportM.mutate({ ...filters, format: "csv" })}>
                  <Download size={12} /> CSV
                </PfButton>
                <PfButton size="sm" variant="outline" loading={exportM.isPending && exportM.variables?.format === "geojson"} onClick={() => exportM.mutate({ ...filters, format: "geojson" })}>
                  <Download size={12} /> GeoJSON
                </PfButton>
              </div>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input className={cn(inputCls, "py-1.5 pl-8")} placeholder="Search name, reference, tag…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search assets" />
              </div>
              <select className={cn(inputCls, "w-auto py-1.5")} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
                <option value="">All tags</option>
                {tag && !facets?.tags.some((t) => t.value === tag) && <option value={tag}>{tag}</option>}
                {facets?.tags.slice(0, 60).map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.value} ({t.count})
                  </option>
                ))}
              </select>
              <select className={cn(inputCls, "w-auto py-1.5")} value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Filter by country">
                <option value="">All countries</option>
                {country && !facets?.countries.some((c) => c.value === country) && <option value={country}>{country}</option>}
                {facets?.countries.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.value} ({c.count})
                  </option>
                ))}
              </select>
            </div>

            {selected.size > 0 && canWrite && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-400/[0.06] px-3 py-2 text-xs">
                <span className="font-medium text-sky-200">{selected.size} selected</span>
                <span className="mx-1 h-4 w-px bg-white/10" />
                <Tag size={13} className="text-slate-400" />
                <input
                  className="w-36 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-white outline-none focus:border-sky-400"
                  placeholder="tag name"
                  value={bulkTag}
                  onChange={(e) => setBulkTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && bulkTag.trim() && tagM.mutate({ ids: [...selected], add: [bulkTag.trim()] })}
                  list="pf-tags"
                />
                <datalist id="pf-tags">
                  {facets?.tags.map((t) => (
                    <option key={t.value} value={t.value} />
                  ))}
                </datalist>
                <PfButton size="sm" disabled={!bulkTag.trim()} loading={tagM.isPending} onClick={() => tagM.mutate({ ids: [...selected], add: [bulkTag.trim()] })}>
                  Add tag
                </PfButton>
                <PfButton size="sm" variant="outline" disabled={!bulkTag.trim()} onClick={() => tagM.mutate({ ids: [...selected], add: [], remove: [bulkTag.trim().toLowerCase()] })}>
                  Remove tag
                </PfButton>
                <PfButton size="sm" variant="danger" loading={archiveM.isPending} onClick={() => confirm(`Archive ${selected.size} assets? They will stop being monitored.`) && archiveM.mutate({ ids: [...selected] })}>
                  <Archive size={12} /> Archive
                </PfButton>
                <button className="ml-auto inline-flex items-center gap-1 text-slate-400 hover:text-white" onClick={() => setSelected(new Set())}>
                  <X size={12} /> Clear
                </button>
              </motion.div>
            )}

            <QueryError error={list.error} onRetry={() => list.refetch()} />
            {list.data ? (
              list.data.rows.length ? (
                <AssetTable
                  rows={list.data.rows}
                  sort={sort}
                  dir={dir}
                  onSort={onSort}
                  selected={selected}
                  onToggle={toggle}
                  onToggleAll={(ids, on) => setSelected((prev) => {
                    const n = new Set(prev);
                    ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
                    return n;
                  })}
                  page={list.data.page}
                  pages={list.data.pages}
                  total={list.data.total}
                  onPage={setPage}
                  loading={list.isFetching}
                />
              ) : (
                <EmptyState icon={Search} title="No assets match these filters">
                  Try clearing a filter or searching for part of a name or reference.
                </EmptyState>
              )
            ) : (
              <Skeleton className="h-[420px]" />
            )}
          </Panel>
        </>
      )}

      <AddAssetDialog open={!!addOpen} initialMode={addOpen ?? "search"} onClose={() => setAddOpen(null)} points={map.data ?? []} center={center} />
    </div>
  );
}

function EmptyPortfolio({ canWrite, onAdd, archived }: { canWrite: boolean; onAdd: (m: "search" | "map" | "coords") => void; archived: number }) {
  const ways = [
    { icon: MousePointerClick, title: "Click on a map", body: "Drop a pin exactly on the field, warehouse or village.", action: () => onAdd("map"), cta: "Open map" },
    { icon: Search, title: "Search a place", body: "Type a village, town or address — we find the coordinates.", action: () => onAdd("search"), cta: "Search" },
    { icon: FileUp, title: "Import a spreadsheet", body: "Upload a CSV or GeoJSON of policies, loans or sites. Addresses are geocoded.", href: "/app/portfolio/import", cta: "Import CSV" },
  ];
  return (
    <div className="hud-panel mt-2 p-6 md:p-10" style={{ ["--hud-accent" as string]: "56 189 248" }}>
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-sky-400/10 text-sky-300">
          <MapPin size={26} />
        </div>
        <h2 className="font-display text-xl font-semibold text-white">Add your first asset</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
          An asset is anything with climate exposure you care about — an insured plot, a borrower’s farm, a warehouse, a community. Once added, Agri-SHIELD scores it every hour for flood, salinity, drought and heat, and alerts you when it crosses your thresholds.
          {archived ? ` (${archived} archived asset${archived === 1 ? "" : "s"} can be restored from the asset list.)` : ""}
        </p>
      </div>
      <div className="mx-auto mt-8 grid max-w-4xl gap-3 md:grid-cols-3">
        {ways.map((w, i) => (
          <motion.div key={w.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
            <w.icon size={20} className="text-sky-300" />
            <div className="mt-3 font-medium text-white">
              <span className="telemetry mr-2 text-sky-400/70">{i + 1}</span>
              {w.title}
            </div>
            <p className="mt-1 text-xs text-slate-400">{w.body}</p>
            {canWrite &&
              (w.href ? (
                <Link href={w.href}>
                  <PfButton size="sm" className="mt-4">
                    {w.cta}
                  </PfButton>
                </Link>
              ) : (
                <PfButton size="sm" className="mt-4" onClick={w.action}>
                  {w.cta}
                </PfButton>
              ))}
          </motion.div>
        ))}
      </div>
      {!canWrite && <p className="mt-6 text-center text-xs text-slate-500">Ask a workspace admin to add assets — your role can view but not edit the portfolio.</p>}
    </div>
  );
}
