"use client";

import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, BarChart3, ChevronRight, Globe2, Wheat } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, Panel, RiskPill, Skeleton, SourceTag, riskColor } from "@/components/hud";
import CommodityDrawer from "@/components/supply-chain/CommodityDrawer";
import { ProductionChart, Sparkline, countryColor } from "@/components/supply-chain/charts";
import { commodityColor, fmtPct, fmtT, fmtUsd } from "@/components/supply-chain/theme";
import { QueryError, ScHeader, Segmented } from "@/components/supply-chain/ui";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type Row = RouterOutputs["supplyChain"]["getCommodityRisks"]["commodities"][number];
type SortKey = "commodity" | "riskScore" | "supplyDisruptionPct" | "priceImpactPct" | "atRiskVolumeTonnes" | "networkValueAtRiskUsd";

export default function CommoditiesPage() {
  const [horizon, setHorizon] = useState<7 | 14 | 30>(7);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "riskScore", dir: -1 });
  const [open, setOpen] = useState<string | null>(null);
  const [wbMetric, setWbMetric] = useState<"cropIndex" | "cerealYield">("cropIndex");
  const q = trpc.supplyChain.getCommodityRisks.useQuery({ horizon }, { placeholderData: (p) => p });
  const wb = trpc.supplyChain.getProductionContext.useQuery(undefined, { staleTime: 3600_000 });

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setOpen(c);
  }, []);

  const rows = useMemo(() => {
    const r = [...(q.data?.commodities ?? [])];
    r.sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
    });
    return r;
  }, [q.data, sort]);

  const selected = q.data?.commodities.find((c) => c.commodity === open) ?? null;

  const th = (key: SortKey, label: string, right = true) => (
    <th className={`px-3 py-2.5 ${right ? "text-right" : "text-left"}`}>
      <button className="inline-flex items-center gap-1 hover:text-amber-300" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))} aria-label={`Sort by ${label}`}>
        {label}
        {sort.key === key && (sort.dir === -1 ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );

  return (
    <div>
      <ScHeader
        eyebrow="Supply chain · commodity risk tracker"
        title="Commodity Risk Tracker"
        description="For each commodity: which regions grow it, how exposed they are, how much supply could be lost and how prices may react. Harvest at risk is built up from registered farm fields in the affected zones."
        actions={
          <>
            <span className="hud-label">Horizon</span>
            <Segmented value={horizon} onChange={setHorizon} options={[7, 14, 30].map((v) => ({ value: v as 7 | 14 | 30, label: `${v}d` }))} />
          </>
        }
      />
      <QueryError error={q.error} onRetry={() => q.refetch()} what="commodity risk" />

      {/* Top cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {q.data
          ? q.data.commodities.slice(0, 4).map((c, i) => (
              <motion.button
                key={c.commodity}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                whileHover={{ y: -2 }}
                onClick={() => setOpen(c.commodity)}
                className="hud-panel p-4 text-left"
                style={{ ["--hud-accent" as string]: "245 158 11" }}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-slate-100">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: commodityColor(c.commodity) }} />
                    {c.label}
                  </span>
                  <RiskPill level={c.riskLevel} />
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="telemetry text-2xl font-semibold" style={{ color: riskColor(c.riskScore) }}>
                      {c.riskScore}
                    </div>
                    <div className="telemetry text-[11px] text-slate-400">
                      price {fmtPct(c.priceImpactPct, 1, true)} · supply −{fmtPct(c.supplyDisruptionPct)}
                    </div>
                  </div>
                  <Sparkline values={c.timeline.slice(0, horizon).map((t) => t.risk)} />
                </div>
              </motion.button>
            ))
          : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[112px]" />)}
      </div>

      <Panel
        className="mt-5"
        title="Risk tracker"
        subtitle={`Commodity → producing regions → risk → supply disruption → price impact · ${horizon}-day horizon`}
        icon={Wheat}
        accent="amber"
        live
        actions={
          <div className="flex flex-wrap gap-1.5">
            <SourceTag href="https://open-meteo.com">{q.data?.outlookSource === "open-meteo" ? "Open-Meteo 16d" : "Seeded outlook"}</SourceTag>
            <SourceTag>GloFAS</SourceTag>
            <SourceTag>Agri-SHIELD fields</SourceTag>
          </div>
        }
        bodyClassName="px-0 pb-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-y border-white/5 bg-[#0b1a33]/50">
              <tr className="hud-label">
                {th("commodity", "Commodity", false)}
                <th className="px-3 py-2.5 text-left">Producing regions</th>
                {th("riskScore", "Risk")}
                <th className="px-3 py-2.5 text-left">{horizon}d timeline</th>
                {th("supplyDisruptionPct", "Supply disruption")}
                {th("priceImpactPct", "Price impact")}
                {th("atRiskVolumeTonnes", "At-risk volume")}
                {th("networkValueAtRiskUsd", "Network VaR")}
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {q.isLoading &&
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={9} className="px-3 py-2">
                      <Skeleton className="h-9" />
                    </td>
                  </tr>
                ))}
              {rows.map((c: Row, i) => (
                <motion.tr key={c.commodity} layout initial={{ opacity: 0 }} animate={{ opacity: q.isFetching ? 0.55 : 1 }} transition={{ delay: i * 0.03 }} onClick={() => setOpen(c.commodity)} className="cursor-pointer transition-colors hover:bg-amber-500/[0.04]">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: commodityColor(c.commodity) }} />
                      <span className="text-slate-100">{c.label}</span>
                    </div>
                    <div className="telemetry text-[10.5px] text-slate-500">
                      {c.currentPrice} USD/{c.unit}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.regions.slice(0, 3).map((r) => (
                        <span key={r.districtId} className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900/60 px-1.5 py-0.5 text-[10.5px] text-slate-300">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: riskColor(r.peakRisk) }} />
                          {r.name}
                        </span>
                      ))}
                      {c.regions.length > 3 && <span className="text-[10.5px] text-slate-500">+{c.regions.length - 3}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="telemetry font-semibold" style={{ color: riskColor(c.riskScore) }}>
                        {c.riskScore}
                      </span>
                      <RiskPill level={c.riskLevel} />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Sparkline values={c.timeline.slice(0, horizon).map((t) => t.risk)} width={110} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="telemetry text-slate-100">{fmtPct(c.supplyDisruptionPct)}</div>
                    <div className="ml-auto mt-1 h-1 w-24 overflow-hidden rounded bg-slate-800">
                      <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, c.supplyDisruptionPct * 3)}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="telemetry" style={{ color: c.priceImpactPct >= 5 ? "#f87171" : c.priceImpactPct >= 2 ? "#fbbf24" : "#cbd5e1" }}>
                      {fmtPct(c.priceImpactPct, 1, true)}
                    </div>
                    <div className="telemetry text-[10.5px] text-slate-500">
                      {fmtPct(c.priceImpactBand[0], 1, true)} … {fmtPct(c.priceImpactBand[1], 1, true)}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="telemetry text-slate-100">{fmtT(c.atRiskVolumeTonnes)}</div>
                    <div className="telemetry text-[10.5px] text-slate-500">fields {fmtT(c.monitored.atRiskTonnes)}</div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="telemetry text-amber-200">{fmtUsd(c.networkValueAtRiskUsd)}</div>
                    <div className="telemetry text-[10.5px] text-slate-500">{c.sourcingSharePct}% share</div>
                  </td>
                  <td className="px-2 py-3 text-slate-600">
                    <ChevronRight size={16} />
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        {q.data && !rows.length && <EmptyState icon={Wheat} title="No commodities tracked" />}
      </Panel>

      {/* World Bank production context */}
      <Panel
        className="mt-5"
        title="Production context"
        subtitle="Structural production trend in the five monitored countries — context for how much slack each market has"
        icon={Globe2}
        accent="amber"
        actions={
          <div className="flex items-center gap-2">
            <Segmented
              value={wbMetric}
              onChange={setWbMetric}
              options={[
                { value: "cropIndex", label: "Crop index" },
                { value: "cerealYield", label: "Cereal yield" },
              ]}
            />
            <SourceTag href="https://data.worldbank.org/indicator/AG.PRD.CROP.XD">World Bank</SourceTag>
          </div>
        }
      >
        {wb.isLoading ? (
          <Skeleton className="h-56" />
        ) : wb.data?.available ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <div className="mb-1 text-[11px] text-slate-500">{wb.data[wbMetric].label}</div>
              <ProductionChart series={wb.data[wbMetric].series} countries={wb.data.countries} unit={wbMetric === "cerealYield" ? " kg/ha" : ""} />
            </div>
            <ul className="space-y-2">
              {wb.data[wbMetric].latest.map((c) => (
                <li key={c.code} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm text-slate-200">
                    <span className="h-2 w-2 rounded-full" style={{ background: countryColor(c.code) }} />
                    {c.name}
                  </span>
                  <span className="text-right">
                    <span className="telemetry text-sm text-white">{c.value?.toLocaleString() ?? "—"}</span>
                    <span className="block telemetry text-[10.5px]" style={{ color: (c.yoyPct ?? 0) >= 0 ? "#4ade80" : "#f87171" }}>
                      {c.year} · {fmtPct(c.yoyPct, 1, true)} YoY
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState icon={BarChart3} title="World Bank API unreachable">
            {wb.data && !wb.data.available ? wb.data.error : "The production context panel will populate when api.worldbank.org responds."}
          </EmptyState>
        )}
      </Panel>

      <CommodityDrawer risk={selected} horizon={horizon} onClose={() => setOpen(null)} />
    </div>
  );
}
