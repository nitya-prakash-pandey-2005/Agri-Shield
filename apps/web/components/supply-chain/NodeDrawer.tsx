"use client";

import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, CloudRain, Droplets, Package, Users } from "lucide-react";
import { Meter, RiskPill, Skeleton, SourceTag, riskColor } from "@/components/hud";
import { trpc } from "@/lib/trpc";
import { DischargeChart, RainChart } from "./charts";
import { commodityColor, fmtT, fmtUsd } from "./theme";
import { Drawer, QueryError } from "./ui";

export default function NodeDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = trpc.supplyChain.getNode.useQuery({ id: id ?? "" }, { enabled: !!id });
  const d = q.data;
  const n = d?.node;
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={n ? n.name : "Loading node…"}
      subtitle={n ? `${n.typeLabel} · ${n.districtName}, ${n.country} · ${n.owned ? "Owned node" : "Partner node"} · capacity ${fmtT(n.capacityTonnes)}` : undefined}
    >
      <QueryError error={q.error} onRetry={() => q.refetch()} what="node detail" />
      {!d && !q.error && (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      )}
      {d && n && (
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <div className="hud-panel grid place-items-center p-4 text-center" style={{ ["--hud-accent" as string]: "245 158 11" }}>
              <div className="hud-label">Composite</div>
              <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="telemetry text-5xl font-bold" style={{ color: riskColor(n.composite), textShadow: `0 0 24px ${riskColor(n.composite)}66` }}>
                {n.composite}
              </motion.div>
              <RiskPill level={n.level} />
            </div>
            <div className="space-y-2.5">
              {n.factors.map((f) => (
                <div key={f.key}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">
                      {f.label} <span className="telemetry text-slate-500">w {f.weight}</span>
                    </span>
                    <span className="telemetry text-slate-200">
                      {f.value} <span className="text-slate-500">→ +{f.contribution}</span>
                    </span>
                  </div>
                  <Meter value={f.value} className="mt-1" />
                  <div className="mt-0.5 text-[11px] text-slate-500">{f.detail}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { l: "Inventory", v: fmtT(d.exposure.inventoryTonnes), s: fmtUsd(d.exposure.inventoryValueUsd), I: Package },
              { l: "Throughput", v: `${fmtT(d.exposure.weeklyThroughputTonnes)}/wk`, s: `${fmtUsd(d.exposure.weeklyThroughputUsd)}/wk`, I: ArrowUpRight },
              { l: "Network share", v: `${d.exposure.networkSharePct}%`, s: `${d.exposure.dependents} dependents`, I: Users },
              { l: "Expected delay", v: `+${d.exposure.expectedDelayDays} d`, s: "lead-time impact", I: CloudRain },
            ].map(({ l, v, s, I }) => (
              <div key={l} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex items-center gap-1.5 hud-label">
                  <I size={11} className="text-amber-400" /> {l}
                </div>
                <div className="mt-1 telemetry text-base text-white">{v}</div>
                <div className="text-[11px] text-slate-500">{s}</div>
              </div>
            ))}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <CloudRain size={14} className="text-sky-400" /> 7-day rainfall at node
              </h4>
              <div className="flex items-center gap-2">
                {d.weather && <span className="telemetry text-xs text-slate-400">72h {d.weather.rain72hMm} mm · 7d {d.weather.rain7dMm} mm</span>}
                <SourceTag href="https://open-meteo.com">Open-Meteo</SourceTag>
              </div>
            </div>
            {d.weather ? <RainChart data={d.weather.rain} /> : <p className="text-xs text-slate-500">Forecast feed unavailable — showing cached district risk only.</p>}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Droplets size={14} className="text-sky-400" /> River discharge (30d history + 7d forecast)
              </h4>
              <div className="flex items-center gap-2">
                {d.dischargeStats.ratio != null && (
                  <span className="telemetry text-xs" style={{ color: d.dischargeStats.ratio > 1.4 ? "#f87171" : "#94a3b8" }}>
                    peak/mean ×{d.dischargeStats.ratio}
                  </span>
                )}
                <SourceTag href="https://open-meteo.com/en/docs/flood-api">GloFAS</SourceTag>
              </div>
            </div>
            {d.discharge.length ? <DischargeChart data={d.discharge} /> : <p className="text-xs text-slate-500">No GloFAS river cell near this node.</p>}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            {[
              { title: "Upstream suppliers", rows: d.upstream, I: ArrowDownLeft },
              { title: "Downstream links", rows: d.downstream, I: ArrowUpRight },
            ].map(({ title, rows, I }) => (
              <div key={title}>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-200">
                  <I size={14} className="text-amber-400" /> {title}
                </h4>
                {rows.length ? (
                  <ul className="space-y-1.5">
                    {rows.map((r) => (
                      <li key={r.flowId} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-slate-200">{r.name}</span>
                          <span className="telemetry text-xs" style={{ color: riskColor(r.composite) }}>
                            {r.composite}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: commodityColor(r.commodity) }} />
                          {r.commodity} · {r.tonnesPerWeek.toLocaleString()} t/wk · {r.modeLabel} {r.km} km · {r.transitDays} d
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">{title.startsWith("Up") ? "Origin node — sources directly from farmland." : "Terminal node."}</p>
                )}
              </div>
            ))}
          </section>

          {d.buyers.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-medium text-slate-200">Downstream buyers served</h4>
              <div className="flex flex-wrap gap-2">
                {d.buyers.map((b) => (
                  <span key={b.name} className="rounded-md border border-slate-800 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-300">
                    {b.name} <span className="text-slate-500">· {b.segment} · {Math.round(b.share * 100)}%</span>
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
