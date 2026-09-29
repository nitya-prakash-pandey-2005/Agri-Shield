"use client";

import { motion } from "framer-motion";
import { History, LineChart as LineIcon, MapPin, Sprout, TrendingUp } from "lucide-react";
import { RiskPill, Skeleton, SourceTag, riskColor } from "@/components/hud";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { PriceBandChart, RiskTimelineChart } from "./charts";
import { commodityColor, fmtPct, fmtT, fmtUsd } from "./theme";
import { Drawer, QueryError } from "./ui";

type CommodityRisk = RouterOutputs["supplyChain"]["getCommodityRisks"]["commodities"][number];

export default function CommodityDrawer({ risk, horizon, onClose }: { risk: CommodityRisk | null; horizon: 7 | 14 | 30; onClose: () => void }) {
  const c = risk?.commodity ?? "";
  const price = trpc.supplyChain.getPriceHistory.useQuery({ commodity: c, horizon }, { enabled: !!risk });
  const analogs = trpc.supplyChain.getHistoricalAnalogs.useQuery({ commodity: c }, { enabled: !!risk });
  const top = analogs.data?.analogs[0];

  return (
    <Drawer
      open={!!risk}
      onClose={onClose}
      width={860}
      title={
        risk ? (
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: commodityColor(risk.commodity) }} />
            {risk.label}
            <RiskPill level={risk.riskLevel} />
          </span>
        ) : (
          ""
        )
      }
      subtitle={risk ? `${risk.regions.length} producing regions · ${horizon}-day horizon · spot ${risk.currentPrice} USD/${risk.unit}` : undefined}
    >
      {risk && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { l: "Risk score", v: String(risk.riskScore), c: riskColor(risk.riskScore), s: `peak within ${horizon}d` },
              { l: "Supply disruption", v: fmtPct(risk.supplyDisruptionPct), c: "#fbbf24", s: "of standing crop" },
              { l: "Price impact", v: fmtPct(risk.priceImpactPct, 1, true), c: risk.priceImpactPct > 5 ? "#f87171" : "#fbbf24", s: `80% band ${fmtPct(risk.priceImpactBand[0], 1, true)} … ${fmtPct(risk.priceImpactBand[1], 1, true)}` },
              { l: "Volatility", v: fmtPct(risk.volatilityWeeklyPct), c: "#e2e8f0", s: `weekly σ · 4w ${fmtPct(risk.momentum4wPct, 1, true)}` },
            ].map((x, i) => (
              <motion.div key={x.l} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="hud-label">{x.l}</div>
                <div className="mt-1 telemetry text-xl font-semibold" style={{ color: x.c }}>
                  {x.v}
                </div>
                <div className="text-[11px] text-slate-500">{x.s}</div>
              </motion.div>
            ))}
          </div>

          {/* At-risk harvest volume */}
          <section className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-sm font-medium text-amber-100">
                <Sprout size={14} className="text-amber-400" /> At-risk harvest volume
              </h4>
              <SourceTag>Agri-SHIELD field registry</SourceTag>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="hud-label">Monitored farm fields</div>
                <div className="telemetry text-lg text-white">{fmtT(risk.monitored.atRiskTonnes)}</div>
                <div className="text-[11px] text-slate-500">
                  {risk.monitored.fields} fields · {risk.monitored.areaHa} ha · {risk.monitored.harvestDueInHorizon} harvesting within {horizon}d
                </div>
              </div>
              <div>
                <div className="hud-label">Producing regions (extrapolated)</div>
                <div className="telemetry text-lg text-white">{fmtT(risk.atRiskVolumeTonnes)}</div>
                <div className="text-[11px] text-slate-500">of {fmtT(risk.standingVolumeTonnes)} standing · {fmtUsd(risk.atRiskValueUsd)}</div>
              </div>
              <div>
                <div className="hud-label">Your sourcing footprint</div>
                <div className="telemetry text-lg text-amber-300">{fmtT(risk.networkAtRiskTonnes)}</div>
                <div className="text-[11px] text-slate-500">
                  {risk.sourcingSharePct}% sourcing share · {fmtUsd(risk.networkValueAtRiskUsd)}
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              Area × FAO yield ({risk.unit}/ha) × loss fraction, where loss combines the inundated share of cropland (vulnerable area × flood probability²) × the depth–duration damage curve, and the Maas–Hoffman salinity damage at the projected EC. Crop shares come from the field registry, shrunk toward regional priors.
            </p>
          </section>

          {/* Historical analog */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <History size={14} className="text-amber-400" /> Historical comparison
              </h4>
              <SourceTag>District flood records</SourceTag>
            </div>
            {analogs.isLoading ? (
              <Skeleton className="h-20" />
            ) : top ? (
              <>
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-transparent p-4">
                  <div className="absolute right-3 top-3 telemetry text-[10px] text-amber-300/80">{top.similarityPct}% similar</div>
                  <p className="pr-20 text-[15px] leading-snug text-amber-50">&ldquo;{top.text}.&rdquo;</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400 telemetry">
                    <span>{Math.round(top.floodedAreaHa).toLocaleString()} ha flooded</span>
                    <span>{fmtUsd(top.lossUsd)} crop loss</span>
                    <span>{top.farmsAffected.toLocaleString()} farms</span>
                  </div>
                </motion.div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {analogs.data!.analogs.slice(1).map((a) => (
                    <div key={a.year} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5 text-[11px]">
                      <div className="flex justify-between">
                        <span className="telemetry text-slate-200">{a.year}</span>
                        <span className="text-slate-500">{a.similarityPct}% similar</span>
                      </div>
                      <div className="mt-0.5 text-slate-400">
                        +{a.priceSpikePct}% in {a.weeksToPeak} wk · {a.districts.join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">{analogs.data!.basis}</p>
              </>
            ) : (
              <p className="text-xs text-slate-500">No comparable events on record.</p>
            )}
          </section>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <TrendingUp size={14} className="text-amber-400" /> 30-day risk timeline
              </h4>
              <SourceTag href="https://open-meteo.com">Open-Meteo 16-day + persistence</SourceTag>
            </div>
            <RiskTimelineChart data={risk.timeline} horizon={horizon} />
            <div className="flex flex-wrap gap-4 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-amber-500" />commodity risk</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: "#3987e5" }} />flood index</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed" style={{ borderColor: "#9085e9" }} />salinity index</span>
              <span>shaded = beyond {horizon}d horizon</span>
            </div>
          </section>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <LineIcon size={14} className="text-amber-400" /> Price history & 8-week forecast band
              </h4>
              <SourceTag>Agri-SHIELD price model</SourceTag>
            </div>
            <QueryError error={price.error} onRetry={() => price.refetch()} what="price history" />
            {price.data ? (
              <>
                <PriceBandChart history={price.data.history} forecast={price.data.forecast} unit={price.data.unit} />
                <div className="text-[11px] text-slate-500">
                  26-week series · median path = spot × (1 + risk-driven impact, passed through over ~3 weeks) · band = ±1.28σ√weeks from observed weekly volatility ({price.data.volatilityWeeklyPct}%).
                </div>
              </>
            ) : (
              <Skeleton className="h-60" />
            )}
          </section>

          <section>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-200">
              <MapPin size={14} className="text-amber-400" /> Producing regions
            </h4>
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-xs">
                <thead className="bg-slate-900/60 text-left">
                  <tr className="hud-label">
                    <th className="px-3 py-2">Region</th>
                    <th className="px-3 py-2 text-right">Risk</th>
                    <th className="px-3 py-2 text-right">Loss</th>
                    <th className="px-3 py-2 text-right">Standing</th>
                    <th className="px-3 py-2 text-right">At risk</th>
                    <th className="px-3 py-2">Quality flag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {risk.regions.map((r) => (
                    <tr key={r.districtId} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2">
                        <div className="text-slate-200">{r.name}</div>
                        <div className="text-[10px] text-slate-500">
                          {r.country} · {r.sampleFields} sampled fields
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right telemetry" style={{ color: riskColor(r.peakRisk) }}>
                        {r.peakRisk}
                      </td>
                      <td className="px-3 py-2 text-right telemetry text-slate-300">{r.lossPct}%</td>
                      <td className="px-3 py-2 text-right telemetry text-slate-400">{fmtT(r.standingTonnes)}</td>
                      <td className="px-3 py-2 text-right telemetry text-amber-200">{fmtT(r.atRiskTonnes)}</td>
                      <td className="max-w-[260px] px-3 py-2 text-[11px] text-slate-400">{r.qualityFlag ?? <span className="text-emerald-400/80">Standard grade</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {risk.drivers.length > 0 && (
            <section className="flex flex-wrap gap-2">
              {risk.drivers.map((d) => (
                <span key={d} className="rounded-md border border-slate-800 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-300">
                  {d}
                </span>
              ))}
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
