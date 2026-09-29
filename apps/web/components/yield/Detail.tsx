"use client";

/** Slide-over detail for one crop asset or one district forecast. */
import { AnimatePresence, motion } from "framer-motion";
import { CloudRain, Droplets, Flame, Leaf, Satellite, Thermometer, Waves, X } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReactNode } from "react";
import { Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { axisProps, ErrorBox, Kpi, num, tooltipStyle, usd, VIZ, WhatThisMeans } from "@/components/insurance/kit";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { driverSentence, EvolutionChart, Histogram, VsNormal, Waterfall } from "./charts";

type Fc = RouterOutputs["sustainability"]["yield"]["asset"]["row"]["forecast"];

export function Drawer({ open, onClose, title, subtitle, children, eyebrow = "Yield forecast" }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; eyebrow?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[760px] flex-col border-l border-cyan-400/15 bg-[#060c1a] shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-slate-800/80 px-4 py-3">
              <div className="min-w-0">
                <div className="hud-label text-cyan-300">{eyebrow}</div>
                <h2 className="truncate font-display text-[16px] font-semibold text-white">{title}</h2>
                {subtitle && <div className="truncate text-[12px] text-slate-400">{subtitle}</div>}
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close" autoFocus>
                <X size={18} />
              </button>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Section({ title, icon: Icon, children, help }: { title: string; icon: React.ComponentType<{ size?: number; className?: string }>; children: ReactNode; help?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
      <h3 className="mb-2 flex items-center gap-1.5 font-display text-[12.5px] font-semibold tracking-wide text-slate-200">
        <Icon size={13} className="text-cyan-300" /> {title} {help}
      </h3>
      {children}
    </section>
  );
}

/** Season bar with stage segments and a "today" marker. */
export function SeasonBar({ f, stages }: { f: Fc; stages: number[] }) {
  const s = f.season;
  const colors = ["#38bdf8", "#22c55e", "#f59e0b", "#a78bfa"];
  const names = ["Establish", "Vegetative", "Flowering", "Ripening"];
  return (
    <div>
      <div className="relative flex h-3 overflow-hidden rounded-full bg-slate-800">
        {stages.map((w, i) => (
          <div key={i} style={{ width: `${w * 100}%`, background: colors[i], opacity: 0.55 }} title={names[i]} />
        ))}
        {s.status === "in_season" && <div className="absolute top-[-3px] h-[18px] w-[2px] bg-white shadow-[0_0_8px_#fff]" style={{ left: `${s.progress * 100}%` }} />}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>Sown {new Date(s.sow).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
        <span className="text-slate-300">
          {s.status === "in_season" ? `Day ${Math.round(s.progress * s.days)} of ${s.days} · ${s.stage}` : s.stage}
        </span>
        <span>Harvest {new Date(s.harvest).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[10.5px] text-slate-500">
        {names.map((n, i) => (
          <span key={n} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: colors[i], opacity: 0.7 }} />
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

function Evidence({ f }: { f: Fc }) {
  const w = f.water;
  const c = f.climWater;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Section title="Water balance this season" icon={Droplets} help={<Explain text="FAO-56 daily soil-water balance: crop water need ETc = Kc × ET0; actual ETa falls below ETc when the root zone (or the paddy pond) dries. FAO-33: yield loss = Ky × (1 − ETa/ETc) per growth stage." />}>
        {w ? (
          <table className="w-full text-[12px]">
            <thead className="text-[10.5px] uppercase text-slate-500">
              <tr>
                <th className="text-left font-medium">mm</th>
                <th className="text-right font-medium">This season*</th>
                <th className="text-right font-medium">Normal</th>
              </tr>
            </thead>
            <tbody className="telemetry text-slate-300">
              {(
                [
                  ["Crop need ETc", w.etcMm, c?.etcMm],
                  ["Actual ETa", w.etaMm, c?.etaMm],
                  ["Rain", w.rainMm, c?.rainMm],
                  ["Irrigation", w.irrigationMm, c?.irrigationMm],
                  ["Percolation", w.percolationMm, c?.percolationMm],
                ] as [string, number, number | undefined][]
              ).map(([k, a, b]) => (
                <tr key={k}>
                  <td className="py-0.5 font-sans text-slate-400">{k}</td>
                  <td className="text-right">{num(a)}</td>
                  <td className="text-right text-slate-500">{b == null ? "—" : num(b)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-0.5 font-sans text-slate-400">Stress days</td>
                <td className="text-right">{w.stressDays}</td>
                <td />
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-[12px] text-slate-500">No cached daily weather for this location yet — the water term is neutral and the band is wider.</p>
        )}
        <p className="mt-1 text-[10.5px] text-slate-500">*Median member: observed to {f.weather.lastObs ?? "—"}, then past-season weather.</p>
      </Section>
      <Section title="Floods this season" icon={Waves} help={<Explain term="glofas" />}>
        {f.flood.events.length ? (
          <ul className="space-y-1 text-[12px]">
            {f.flood.events.map((e) => (
              <li key={e.start} className="flex justify-between gap-2">
                <span className="text-slate-300">
                  {new Date(e.start).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}–{new Date(e.end).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} <span className="text-slate-500">({e.driver})</span>
                </span>
                <span className="telemetry text-slate-400">{e.depthM.toFixed(2)} m</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-slate-500">No flood episode in the record for this season so far.</p>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
          <div>
            <div className="text-slate-500">Realised loss</div>
            <div className="telemetry text-rose-300">{f.flood.realisedLossPct.toFixed(1)} %</div>
          </div>
          <div>
            <div className="text-slate-500">Normal season</div>
            <div className="telemetry text-slate-300">{f.flood.seasonalNormalLossPct.toFixed(1)} %</div>
          </div>
          <div>
            <div className="text-slate-500">Live 72 h</div>
            <div className="telemetry text-slate-300">{f.flood.liveLossPct.toFixed(1)} %</div>
          </div>
        </div>
      </Section>
      <Section title="Heat at flowering" icon={Thermometer} help={<Explain term="heat_stress" />}>
        <p className="text-[12px] text-slate-300">
          {f.heatHdd == null ? "Not heat-sensitive at flowering in this model." : `${f.heatHdd.toFixed(1)} °C·days above the anthesis threshold expected in the flowering window (median member).`}
        </p>
      </Section>
      <Section title="Salinity" icon={CloudRain} help={<Explain term="ec" />}>
        <p className="text-[12px] text-slate-300">
          Maas–Hoffman factor vs a normal season: <span className="telemetry">{((f.salinityFactor - 1) * 100).toFixed(1)} %</span> (season-mean ECe from the platform salinity model with this season&apos;s 30-day rainfall).
        </p>
      </Section>
    </div>
  );
}

function Provenance({ f, extra }: { f: Fc; extra?: ReactNode }) {
  const b = f.baseline;
  return (
    <div className="space-y-1.5 text-[11.5px] text-slate-400">
      <div>
        <b className="text-slate-300">Baseline:</b> FAOSTAT national {num(b.nationalNormalTHa, 2)} t/ha (2020-24) × season factor {b.seasonFactor} {b.regionFactor !== 1 && `× regional factor ${b.regionFactor}`} = normal {num(b.normalTHa, 2)} t/ha; trend {num(b.trendTHa, 2)} t/ha.
        {b.proxy && <span className="text-amber-200"> {b.proxy}.</span>}
      </div>
      {b.regionNote && <div className="text-slate-500">{b.regionNote}</div>}
      <div>
        <b className="text-slate-300">Weather:</b> {f.weather.source}, cell {f.weather.cell}, observed to {f.weather.lastObs ?? "—"}, {f.weather.analogYears} past seasons for the rest of the season.
      </div>
      <div>
        <b className="text-slate-300">Irrigation:</b> {f.irrigation.label} (meets {Math.round(f.irrigation.reliability * 100)} % of a deficit){f.irrigation.assumed && " — assumed from the national irrigated share; record it on the asset to refine"}.
      </div>
      <div>
        <b className="text-slate-300">Uncertainty:</b> structural CV {Math.round(f.cv * 100)} %, {Math.round(f.observedFrac * 100)} % of the season observed.
      </div>
      {extra}
    </div>
  );
}

export function AssetDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = trpc.sustainability.yield.asset.useQuery({ id: id ?? "" }, { enabled: !!id, staleTime: 5 * 60_000 });
  const d = q.data;
  const f = d?.row.forecast;
  return (
    <Drawer open={!!id} onClose={onClose} title={d?.row.name ?? "Loading…"} subtitle={d ? `${d.row.externalRef ?? d.row.id} · ${d.crop.label} · ${d.row.district ?? d.row.country} · ${num(d.row.areaHa, 2)} ha` : undefined}>
      <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      {!d || !f ? (
        !q.error && (
          <div className="space-y-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        )
      ) : (
        <>
          <SeasonBar f={f} stages={d.crop.stages} />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Yield P50" value={`${f.yieldTHa.p50.toFixed(2)} t/ha`} sub={`P10–P90 ${f.yieldTHa.p10.toFixed(2)}–${f.yieldTHa.p90.toFixed(2)}`} />
            <Kpi label="vs 5-yr normal" value={<VsNormal pct={f.vsNormalPct} />} sub={`normal ${f.baseline.normalTHa.toFixed(2)} t/ha`} />
            <Kpi label="Production" value={`${num(d.row.productionT.p50, 1)} t`} sub={`${num(d.row.productionT.p10, 1)}–${num(d.row.productionT.p90, 1)} t`} />
            <Kpi label="P(below normal)" value={`${f.probBelowNormalPct} %`} sub={`value ${usd(d.row.grossValueUsd)}`} tone={f.probBelowNormalPct > 66 ? "bad" : f.probBelowNormalPct > 50 ? "warn" : "good"} />
          </div>
          <WhatThisMeans tone={f.vsNormalPct <= -10 ? "rose" : f.vsNormalPct <= -3 ? "amber" : "emerald"}>
            {d.row.name} is expected to harvest about {f.yieldTHa.p50.toFixed(2)} t/ha of {d.crop.label.toLowerCase()} ({f.vsNormalPct >= 0 ? "+" : "−"}
            {Math.abs(f.vsNormalPct).toFixed(1)} % vs normal); in 8 of 10 outcomes between {f.yieldTHa.p10.toFixed(2)} and {f.yieldTHa.p90.toFixed(2)} t/ha. Drivers: {driverSentence(f.drivers)}.
            {d.row.outlook.insurer && ` Area-yield index view: ${d.row.outlook.insurer.payoutProbPct} % chance the yield falls below the ${d.row.outlook.insurer.thresholdTHa.toFixed(2)} t/ha threshold; expected payout ${usd(d.row.outlook.insurer.expectedPayoutUsd)} on ${usd(d.row.outlook.insurer.sumInsuredUsd)} sum insured.`}
            {d.row.outlook.bank && ` Crop revenue covers this season's ${usd(d.row.outlook.bank.debtServiceUsd)} debt service ${d.row.outlook.bank.coverP50.toFixed(2)}× (P50) and ${d.row.outlook.bank.coverP10.toFixed(2)}× in a bad year (P10).`}
          </WhatThisMeans>
          <div className="grid gap-3 md:grid-cols-2">
            <Section title="Drivers (% of normal)" icon={Flame}>
              <Waterfall drivers={f.drivers} forecastPct={(f.yieldTHa.p50 / f.baseline.normalTHa) * 100} height={210} />
            </Section>
            <Section title="Forecast distribution (t/ha)" icon={Leaf}>
              <Histogram bins={d.histogram} normal={f.baseline.normalTHa} p50={f.yieldTHa.p50} />
              <p className="text-[10.5px] text-slate-500">Orange bins are below the 5-yr normal ({f.baseline.normalTHa.toFixed(2)} t/ha).</p>
            </Section>
          </div>
          <Section title="How this forecast evolved (t/ha)" icon={Leaf}>
            <EvolutionChart data={d.evolution} normal={f.baseline.normalTHa} unit="t/ha" height={210} />
          </Section>
          {d.ndviSeries.length > 0 && (
            <Section title="Vegetation (NDVI) vs expected for the stage" icon={Satellite} help={<Explain term="ndvi" />}>
              <div className="h-[170px]">
                <ResponsiveContainer>
                  <LineChart data={d.ndviSeries.map((p) => ({ ...p, label: new Date(p.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) }))} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke={VIZ.grid} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} minTickGap={16} />
                    <YAxis {...axisProps} domain={[0, 1]} />
                    <Tooltip {...tooltipStyle} formatter={(v: number, n) => [v == null ? "—" : Number(v).toFixed(2), n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line dataKey="ndvi" name="Observed (district fields)" stroke={VIZ.s3} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                    <Line dataKey="expected" name="Expected for stage" stroke={VIZ.ink2} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10.5px] text-slate-500">
                Source: {d.ndviSource}. {f.ndvi.weight > 0 ? `Weight ${Math.round(f.ndvi.weight * 100)} % → ${((f.ndvi.factor - 1) * 100).toFixed(1)} % yield adjustment.` : "Too early in the season for NDVI to carry yield information."}
              </p>
            </Section>
          )}
          <Evidence f={f} />
          <Section title="Data & method" icon={CloudRain}>
            <Provenance f={f} extra={d.crop.assumed ? <div className="text-amber-200/80">{d.crop.assumed}</div> : <div className="text-slate-500">{d.crop.src}</div>} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SourceTag href="https://www.fao.org/faostat/en/#data/QCL">FAOSTAT</SourceTag>
              <SourceTag href="https://www.fao.org/4/i2800e/i2800e.pdf">FAO-33 Ky {d.crop.kySeasonal}</SourceTag>
              <SourceTag>{f.weather.source}</SourceTag>
              <SourceTag>{d.memberYears.length} analogue seasons {d.memberYears.length ? `${d.memberYears[d.memberYears.length - 1]}–${d.memberYears[0]}` : ""}</SourceTag>
            </div>
          </Section>
        </>
      )}
    </Drawer>
  );
}

export function DistrictDetail({ id, onClose, onOpenAsset }: { id: string | null; onClose: () => void; onOpenAsset: (id: string) => void }) {
  const q = trpc.sustainability.yield.district.useQuery({ districtId: id ?? "" }, { enabled: !!id, staleTime: 5 * 60_000 });
  const d = q.data?.district;
  const f = d?.forecast;
  return (
    <Drawer open={!!id} onClose={onClose} title={d ? `${d.name}, ${d.country}` : "Loading…"} subtitle={d ? `${d.crop} · ${f?.season.name} · est. ${num(d.cropAreaHa)} ha cropped · ${Math.round(d.irrigatedShare * 100)} % irrigated` : undefined}>
      <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      {!d || !f ? (
        !q.error && <Skeleton className="h-72" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Yield P50" value={`${f.yieldTHa.p50.toFixed(2)} t/ha`} sub={`${f.yieldTHa.p10.toFixed(2)}–${f.yieldTHa.p90.toFixed(2)}`} />
            <Kpi label="vs 5-yr normal" value={<VsNormal pct={f.vsNormalPct} />} />
            <Kpi label="Production P50" value={`${num(d.productionT.p50)} t`} sub={`normal ${num(d.normalProductionT)} t`} />
            <Kpi label="Value" value={usd(d.valueUsd)} sub={`${usd(d.priceUsdT)}/t farm-gate`} />
          </div>
          <WhatThisMeans tone={f.vsNormalPct <= -10 ? "rose" : f.vsNormalPct <= -3 ? "amber" : "emerald"}>
            {d.name}&apos;s {d.crop} harvest is forecast at {num(d.productionT.p50)} t ({num(d.productionT.p10)}–{num(d.productionT.p90)} t), {f.vsNormalPct >= 0 ? "above" : "below"} a normal {num(d.normalProductionT)} t. Drivers: {driverSentence(f.drivers)}.
          </WhatThisMeans>
          <SeasonBar f={f} stages={[0.2, 0.2, 0.4, 0.2]} />
          <div className="grid gap-3 md:grid-cols-2">
            <Section title="Drivers (% of normal)" icon={Flame}>
              <Waterfall drivers={f.drivers} forecastPct={(f.yieldTHa.p50 / f.baseline.normalTHa) * 100} height={210} />
            </Section>
            <Section title="Weekly evolution (t/ha)" icon={Leaf}>
              <EvolutionChart data={q.data!.evolution} normal={f.baseline.normalTHa} unit="t/ha" height={210} />
            </Section>
          </div>
          <Evidence f={f} />
          {q.data!.assets.length > 0 && (
            <Section title={`Your assets in ${d.name}`} icon={Leaf}>
              <ul className="divide-y divide-slate-800/60 text-[12.5px]">
                {q.data!.assets.map((a) => (
                  <li key={a.id}>
                    <button className="flex w-full justify-between gap-2 py-1.5 text-left hover:text-white" onClick={() => onOpenAsset(a.id)}>
                      <span className="truncate text-slate-300">
                        {a.name} <span className="capitalize text-slate-500">· {a.crop}</span>
                      </span>
                      <span className="telemetry">
                        {a.yieldP50.toFixed(2)} t/ha <VsNormal pct={a.vsNormalPct} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Data & method" icon={CloudRain}>
            <Provenance f={f} />
          </Section>
        </>
      )}
    </Drawer>
  );
}
