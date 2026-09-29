"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, Clock, DollarSign, ExternalLink, Layers, MapPin, Network, RefreshCw, Satellite, Scale, Waves } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { EmptyState, LiveDot, Panel, RiskPill, Skeleton, SourceTag, StatTile, riskColor } from "@/components/hud";
import NodeDrawer from "@/components/supply-chain/NodeDrawer";
import SankeyDiagram from "@/components/supply-chain/SankeyDiagram";
import { COMMODITY_ORDER, commodityColor, fmtT, fmtUsd, nodeGlyph, timeAgo } from "@/components/supply-chain/theme";
import { Chip, QueryError, ScButton, ScHeader } from "@/components/supply-chain/ui";
import { useRealtime } from "@/hooks/useRealtime";
import { trpc } from "@/lib/trpc";

const NetworkMap = dynamic(() => import("@/components/supply-chain/NetworkMap"), { ssr: false, loading: () => <Skeleton className="h-[520px]" /> });

export default function SupplyChainOverviewPage() {
  const utils = trpc.useUtils();
  const overview = trpc.supplyChain.getOverview.useQuery(undefined, { refetchInterval: 5 * 60_000 });
  const network = trpc.supplyChain.getNetwork.useQuery(undefined, { refetchInterval: 5 * 60_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const [layers, setLayers] = useState({ flows: true, hazards: true, districts: true, commodity: null as string | null });
  const onSelect = useCallback((id: string) => setSelected(id), []);

  useRealtime(["global"], (env) => {
    if (env.event.type === "risk.updated" || env.event.type === "scan.completed") {
      utils.supplyChain.getOverview.invalidate();
      utils.supplyChain.getNetwork.invalidate();
    }
  });

  const k = overview.data?.kpis;
  const flowCommodities = useMemo(() => COMMODITY_ORDER.filter((c) => network.data?.flows.some((f) => f.commodity === c)), [network.data]);

  const sankey = useMemo(() => {
    const s = network.data?.sankey;
    if (!s) return null;
    return {
      nodes: s.nodes.map((n) => ({ id: n.id, name: n.name, color: riskColor(n.risk), sub: n.kind === "region" ? "farmland" : undefined })),
      links: s.links.map((l) => ({ source: l.source, target: l.target, value: l.value, color: commodityColor(l.commodity), label: l.commodity })),
      meta: s,
    };
  }, [network.data]);

  return (
    <div>
      <ScHeader
        eyebrow="Supply chain · risk overview"
        title="Network Risk Command"
        description="Every warehouse, port and processor scored 0-100 from live flood and salinity signals, nearby disasters, supplier dependence and capacity stress, with commodity flows traced end to end."
        actions={
          <>
            <LiveDot label={overview.data?.liveSource === "open-meteo" ? "LIVE CLIMATE" : "SEEDED"} color={overview.data?.liveSource === "open-meteo" ? "#22c55e" : "#f59e0b"} />
            {overview.data && <span className="telemetry text-[11px] text-slate-500">updated {timeAgo(overview.data.lastUpdated)}</span>}
            <ScButton
              variant="outline"
              loading={overview.isFetching || network.isFetching}
              onClick={() => {
                overview.refetch();
                network.refetch();
              }}
            >
              {!(overview.isFetching || network.isFetching) && <RefreshCw size={14} />} Refresh
            </ScButton>
          </>
        }
      />

      <QueryError error={overview.error ?? network.error} onRetry={() => (overview.refetch(), network.refetch())} what="network risk" />

      {/* KPI row */}
      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {k ? (
          <>
            <StatTile label="Nodes at risk" value={k.nodesAtRisk} suffix={` / ${k.nodesTotal}`} icon={MapPin} accent="red" hint="Composite score ≥ 60" delta={`${fmtT(k.weeklyThroughputTonnes)}/wk through the network`} deltaGood />
            <StatTile label="Value at risk" value={k.valueAtRiskUsd / 1e6} decimals={1} prefix="$" suffix="M" icon={DollarSign} accent="amber" hint="Network-sourced harvest + inventory" delta={`Regional harvest ${fmtUsd(k.regionalHarvestValueAtRiskUsd)}`} />
            <StatTile label="At-risk volume" value={k.atRiskVolumeTonnes / 1000} decimals={1} suffix=" kt" icon={Scale} accent="amber" hint="Your sourcing share of harvest at risk (7d)" delta={`Monitored fields ${fmtT(k.monitoredFieldsAtRiskTonnes)}`} />
            <StatTile label="Lead-time impact" value={k.avgLeadTimeImpactDays} decimals={1} prefix="+" suffix=" d" icon={Clock} accent="violet" hint="Tonnage-weighted expected delay across all flows" delta="tonnage-weighted avg" />
            <StatTile label="Active disruptions" value={k.activeDisruptions} icon={AlertTriangle} accent="red" hint="Critical nodes + active alerts + hazards within 400 km" delta="nodes · alerts · hazards" />
          </>
        ) : (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <SourceTag href="https://open-meteo.com">Open-Meteo</SourceTag>
        <SourceTag href="https://www.globalfloods.eu">GloFAS</SourceTag>
        <SourceTag href="https://www.gdacs.org">GDACS</SourceTag>
        <SourceTag href="https://eonet.gsfc.nasa.gov">NASA EONET</SourceTag>
        <SourceTag>Agri-SHIELD network</SourceTag>
      </div>

      {/* Map + ranking */}
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Supply network — live risk"
          subtitle="Pin shape = node type · colour = composite risk · filled = owned · arcs = commodity flows (t/wk)"
          icon={Layers}
          accent="amber"
          live
          actions={<SourceTag>Agri-SHIELD network</SourceTag>}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Chip active={layers.flows} onClick={() => setLayers((l) => ({ ...l, flows: !l.flows }))}>
              Flows
            </Chip>
            <Chip active={layers.hazards} onClick={() => setLayers((l) => ({ ...l, hazards: !l.hazards }))}>
              GDACS / EONET hazards
            </Chip>
            <Chip active={layers.districts} onClick={() => setLayers((l) => ({ ...l, districts: !l.districts }))}>
              District risk
            </Chip>
            <span className="mx-1 h-4 w-px bg-slate-700" />
            <Chip active={layers.commodity === null} onClick={() => setLayers((l) => ({ ...l, commodity: null }))}>
              All commodities
            </Chip>
            {flowCommodities.map((c) => (
              <Chip key={c} active={layers.commodity === c} color={commodityColor(c)} onClick={() => setLayers((l) => ({ ...l, commodity: l.commodity === c ? null : c }))}>
                {c}
              </Chip>
            ))}
          </div>
          {network.data ? <NetworkMap data={network.data} selectedId={selected} onSelect={onSelect} layers={layers} height={600} /> : <Skeleton className="h-[520px]" />}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-400">
            {(["port", "processor", "warehouse", "retailer"] as const).map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span dangerouslySetInnerHTML={{ __html: nodeGlyph(t, "#fbbf24", 14, true) }} /> {t === "retailer" ? "wholesale" : t}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span dangerouslySetInnerHTML={{ __html: nodeGlyph("warehouse", "#fbbf24", 14, false) }} /> partner-owned
            </span>
            <span className="ml-auto inline-flex items-center gap-2">
              {[
                ["low", 20],
                ["medium", 45],
                ["high", 70],
                ["critical", 90],
              ].map(([l, v]) => (
                <span key={l} className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: riskColor(v as number) }} />
                  {l}
                </span>
              ))}
            </span>
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Top-risk nodes" subtitle="Composite 0-100 · click for live telemetry" icon={Activity} accent="amber">
            {overview.data ? (
              <ul className="space-y-1.5">
                {overview.data.topNodes.map((n, i) => {
                  const top = [...n.factors].sort((a, b) => b.contribution - a.contribution)[0]!;
                  return (
                    <motion.li key={n.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                      <button onClick={() => setSelected(n.id)} className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition hover:border-amber-500/30 hover:bg-amber-500/5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg telemetry text-sm font-bold" style={{ background: `${riskColor(n.composite)}1f`, color: riskColor(n.composite) }}>
                          {n.composite}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-100">{n.name}</span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {n.typeLabel} · {n.country} · driver: {top.label.toLowerCase()}
                          </span>
                        </span>
                        <RiskPill level={n.level} />
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
            ) : (
              <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
            )}
          </Panel>

          <Panel title="Live disruption feed" subtitle="Nodes ≥ 70 · active alerts · hazards within 400 km" icon={Satellite} accent="amber" live bodyClassName="px-0 pb-2">
            {overview.data ? (
              overview.data.disruptions.length ? (
                <ul className="max-h-[330px] divide-y divide-white/5 overflow-y-auto px-4">
                  {overview.data.disruptions.map((d) => (
                    <li key={d.id} className="py-2.5">
                      <div className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: d.kind === "hazard" ? "#38bdf8" : d.kind === "alert" ? "#fb923c" : "#f87171" }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13px] text-slate-100">{d.title}</span>
                            {"url" in d && d.url && (
                              <a href={d.url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-amber-300" aria-label="Open source report">
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">{d.detail}</div>
                          <div className="mt-1 flex items-center gap-2">
                            <RiskPill level={d.severity} />
                            <SourceTag>{d.source}</SourceTag>
                            <span className="telemetry text-[10px] text-slate-500">{timeAgo(d.at)}</span>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={Waves} title="No active disruptions">
                  No node above 70, no active alerts and no GDACS/EONET events near the network.
                </EmptyState>
              )
            ) : (
              <div className="space-y-2 px-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
            )}
          </Panel>
        </div>
      </div>

      {/* Sankey */}
      <Panel className="mt-5" title="Commodity flow network" subtitle="Producing farmland → origin nodes → ports & markets · width = tonnes/week · node colour = risk · link colour = commodity" icon={Network} accent="amber" actions={<SourceTag>Agri-SHIELD network</SourceTag>}>
        {sankey ? (
          <>
            <SankeyDiagram
              nodes={sankey.nodes}
              links={sankey.links}
              height={440}
              valueFormat={(v) => `${v.toLocaleString()} t/wk`}
              renderTip={(x) =>
                x.kind === "node" ? (
                  <div>
                    <div className="font-medium text-white">{x.node.name}</div>
                    <div className="telemetry text-slate-400">{x.value.toLocaleString()} t/wk</div>
                    <div className="telemetry" style={{ color: x.node.color }}>
                      risk {sankey.meta.nodes.find((n) => n.id === x.node.id)?.risk}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="font-medium text-white">
                      {x.source.name} → {x.target.name}
                    </div>
                    <div className="telemetry text-slate-400">
                      {x.link.label} · {x.link.value.toLocaleString()} t/wk
                    </div>
                  </div>
                )
              }
            />
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
              {flowCommodities.map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-sm" style={{ background: commodityColor(c) }} />
                  {c}
                </span>
              ))}
            </div>
          </>
        ) : (
          <Skeleton className="h-[440px]" />
        )}
      </Panel>

      <NodeDrawer id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
