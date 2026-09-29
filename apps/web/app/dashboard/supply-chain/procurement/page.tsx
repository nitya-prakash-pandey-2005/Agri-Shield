"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { AlertTriangle, Clock, Flag, PackageSearch, Route, Ship, Truck, Waves } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { EmptyState, Panel, RiskPill, Skeleton, SourceTag, StatTile, riskColor } from "@/components/hud";
import { COMMODITY_ORDER, commodityColor, fmtT } from "@/components/supply-chain/theme";
import { Chip, QueryError, ScHeader } from "@/components/supply-chain/ui";
import { trpc } from "@/lib/trpc";

const ProcurementMap = dynamic(() => import("@/components/supply-chain/ProcurementMap"), { ssr: false, loading: () => <Skeleton className="h-[480px]" /> });

const MODE_ICON = { road: Truck, river_barge: Waves, short_sea: Ship } as const;
const STATUS_STYLE: Record<string, string> = { available: "text-emerald-300 bg-emerald-500/10", watch: "text-amber-300 bg-amber-500/10", constrained: "text-rose-300 bg-rose-500/10" };

export default function ProcurementPage() {
  const [commodity, setCommodity] = useState("rice");
  const [exclude, setExclude] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const q = trpc.supplyChain.getAlternativeSuppliers.useQuery({ commodity, excludeDistrictIds: exclude }, { placeholderData: (p) => p });
  const d = q.data;
  const onPick = useCallback((id: string) => setHighlight(id), []);

  const summary = useMemo(() => {
    if (!d) return null;
    const usable = d.alternatives.filter((a) => a.status !== "constrained");
    const best = usable[0];
    const cover3 = Math.min(100, usable.slice(0, 3).reduce((s, a) => s + a.coverPct, 0));
    const flagged = d.alternatives.filter((a) => a.qualityFlag).length;
    return { best, cover3, flagged, usable: usable.length };
  }, [d]);

  return (
    <div>
      <ScHeader
        eyebrow="Supply chain · procurement intelligence"
        title="Alternative Supplier Finder"
        description="If a producing region floods, find the nearest regions that are not affected and can supply the same commodity. Distances are by road, inland waterway or short-sea route; lead times, spare capacity and grade risk are estimated from live risk and field data."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="hud-label mr-1">Commodity</span>
        {COMMODITY_ORDER.map((c) => (
          <Chip
            key={c}
            active={commodity === c}
            color={commodityColor(c)}
            onClick={() => {
              setCommodity(c);
              setExclude([]);
              setHighlight(null);
            }}
          >
            {c}
          </Chip>
        ))}
      </div>

      <QueryError error={q.error} onRetry={() => q.refetch()} what="alternative suppliers" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {d && summary ? (
          <>
            <StatTile label="Supply gap" value={d.lostWeeklyTonnes / 1000} decimals={1} suffix=" kt/wk" icon={AlertTriangle} accent="red" hint="At-risk volume in affected regions over an 8-week harvest window" delta={`${d.affected.length} affected region(s)`} />
            <StatTile label="Fastest viable lead time" value={summary.best?.leadTimeDays ?? 0} decimals={1} suffix=" d" icon={Clock} accent="amber" delta={summary.best ? `${summary.best.name} · ${summary.best.modeLabel}` : "no viable source"} deltaGood />
            <StatTile label="Gap covered by top 3" value={summary.cover3} suffix="%" icon={Route} accent="emerald" delta={`${summary.usable} viable regions`} deltaGood={summary.cover3 >= 60} />
            <StatTile label="Quality flags" value={summary.flagged} icon={Flag} accent="violet" delta="salinity / moisture grade risk" />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          title="Alternative supplier map"
          subtitle={d ? `Affected regions (red) → candidate regions sized by weekly surplus → receiving hub: ${d.destination.name}` : "Loading…"}
          icon={PackageSearch}
          accent="amber"
          live
          actions={<SourceTag>Agri-SHIELD network</SourceTag>}
        >
          {d ? <ProcurementMap data={d} highlight={highlight} onPick={onPick} height={560} /> : <Skeleton className="h-[480px]" />}
          <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-rose-500 bg-rose-500/30" />affected</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />available</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />watch</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400/60" />constrained</span>
            <span>dash pattern: short = road · medium = waterway · long = sea</span>
          </div>
        </Panel>

        <Panel title="Affected regions" subtitle="Toggle to re-plan sourcing; default = high-risk regions (14d) in the most exposed basin" icon={AlertTriangle} accent="amber">
          {d ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {d.producingRegions.map((r) => {
                  const active = exclude.length ? exclude.includes(r.id) : d.affected.some((a) => a.id === r.id);
                  return (
                    <Chip
                      key={r.id}
                      active={active}
                      color={riskColor(r.risk)}
                      onClick={() => {
                        const base = exclude.length ? exclude : d.affected.map((a) => a.id);
                        setExclude(base.includes(r.id) ? base.filter((x) => x !== r.id) : [...base, r.id]);
                      }}
                    >
                      {r.name} <span className="telemetry text-[10px] opacity-70">{r.risk}</span>
                    </Chip>
                  );
                })}
              </div>
              <ul className="space-y-1.5">
                {d.affected.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2 text-xs">
                    <span className="text-slate-200">
                      {a.name} <span className="text-slate-500">· {a.country}</span>
                    </span>
                    <span className="telemetry text-rose-300">{fmtT(a.atRiskTonnes)}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-[11px] leading-relaxed text-slate-400">
                Receiving hub <b className="text-amber-300">{d.destination.name}</b> ({d.destination.country}
                {d.destination.owned ? "" : ", partner"}) — where replacement {commodity} is delivered: the nearest unaffected hub in the affected market, or its port / wholesale market if every hub there is flooded. Spot {d.price} USD/t.
              </div>
            </div>
          ) : (
            <Skeleton className="h-64" />
          )}
        </Panel>
      </div>

      <Panel className="mt-5" title="Ranked alternatives" subtitle="Lead time = procurement 2 d + transit + handling (+3 d customs if cross-border) · surplus = 30% marketable share of the unaffected standing crop over 8 weeks" icon={Route} accent="amber" bodyClassName="px-0 pb-0" actions={<SourceTag>Agri-SHIELD network</SourceTag>}>
        {d ? (
          d.alternatives.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="border-y border-white/5 bg-[#0b1a33]/50">
                  <tr className="hud-label text-left">
                    <th className="px-3 py-2.5">#</th>
                    <th className="px-3 py-2.5">Region</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Risk</th>
                    <th className="px-3 py-2.5">Route</th>
                    <th className="px-3 py-2.5 text-right">Lead time</th>
                    <th className="px-3 py-2.5 text-right">Surplus / wk</th>
                    <th className="px-3 py-2.5 text-right">Gap cover</th>
                    <th className="px-3 py-2.5 text-right">Landed cost</th>
                    <th className="px-3 py-2.5">Quality flag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {d.alternatives.map((a, i) => {
                    const Icon = MODE_ICON[a.mode as keyof typeof MODE_ICON] ?? Truck;
                    return (
                      <motion.tr key={a.districtId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} onMouseEnter={() => setHighlight(a.districtId)} onMouseLeave={() => setHighlight(null)} className={`transition-colors hover:bg-amber-500/[0.04] ${highlight === a.districtId ? "bg-amber-500/[0.05]" : ""}`}>
                        <td className="px-3 py-2.5 telemetry text-slate-500">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <div className="text-slate-100">{a.name}</div>
                          <div className="text-[10.5px] text-slate-500">{a.country}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase telemetry ${STATUS_STYLE[a.status]}`}>{a.status}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="telemetry" style={{ color: riskColor(a.risk) }}>
                            {a.risk}
                          </span>{" "}
                          <RiskPill level={a.level} className="ml-1" />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5 text-slate-300">
                            <Icon size={13} className="text-amber-400" /> {a.modeLabel}
                          </div>
                          <div className="telemetry text-[10.5px] text-slate-500">
                            {a.distanceKm.toLocaleString()} km · {a.freightUsdPerT} USD/t
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right telemetry text-white">{a.leadTimeDays} d</td>
                        <td className="px-3 py-2.5 text-right telemetry text-slate-200">{fmtT(a.weeklyCapacityTonnes)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="telemetry text-slate-200">{a.coverPct}%</div>
                          <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded bg-slate-800">
                            <div className="h-full bg-emerald-400" style={{ width: `${a.coverPct}%` }} />
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="telemetry text-slate-200">{a.landedCostUsdPerT} USD/t</div>
                          <div className="telemetry text-[10.5px] text-slate-500">+{a.pricePremiumPct}% premium</div>
                        </td>
                        <td className="max-w-[280px] px-3 py-2.5 text-[11px]">
                          {a.qualityFlag ? (
                            <span className="inline-flex items-start gap-1 text-amber-200/90">
                              <Flag size={11} className="mt-0.5 shrink-0" /> {a.qualityFlag}
                            </span>
                          ) : (
                            <span className="text-emerald-400/80">Standard grade expected</span>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={PackageSearch} title="No alternative producing regions">
              Every other region growing {commodity} is in the affected set.
            </EmptyState>
          )
        ) : (
          <div className="p-4">
            <Skeleton className="h-64" />
          </div>
        )}
      </Panel>
    </div>
  );
}
