"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Cpu, FlaskConical, GitCompare, Play, ShieldCheck, Timer, TrendingUp, Waves, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AnimatedNumber, EmptyState, Panel, Skeleton, SourceTag, riskColor } from "@/components/hud";
import SankeyDiagram from "@/components/supply-chain/SankeyDiagram";
import { LossHistogram, RecoveryChart } from "@/components/supply-chain/charts";
import { commodityColor, fmtPct, fmtT, fmtUsd, timeAgo } from "@/components/supply-chain/theme";
import { Chip, Field, QueryError, ScButton, ScHeader, Segmented, inputCls } from "@/components/supply-chain/ui";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type Run = RouterOutputs["supplyChain"]["runScenario"];

const CATEGORY = ["", "Minor — localised waterlogging", "Moderate — riverbank overtopping", "Severe — widespread inundation", "Major — embankment breaches", "Extreme — delta-wide flooding"];
const STAGE_ORDER = ["producer", "warehouse", "processor", "port", "retailer", "buyer"];

export default function ScenariosPage() {
  const utils = trpc.useUtils();
  const opts = trpc.supplyChain.getScenarioOptions.useQuery();
  const saved = trpc.supplyChain.listScenarios.useQuery();
  const [commodity, setCommodity] = useState("rice");
  const [regions, setRegions] = useState<string[]>([]);
  const [intensity, setIntensity] = useState(3);
  const [duration, setDuration] = useState(5);
  const [sims, setSims] = useState(2000);
  const [label, setLabel] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [loadId, setLoadId] = useState<string | null>(null);
  const [compare, setCompare] = useState<[string | null, string | null]>([null, null]);

  // default selection: Mekong Delta rice regions (from live options, not hardcoded ids)
  useEffect(() => {
    if (opts.data && !regions.length) setRegions(opts.data.regions.filter((r) => r.country === "Vietnam" && r.primaryCrops.includes("rice") && r.floodRisk >= 0).slice(0, 3).map((r) => r.id));
  }, [opts.data, regions.length]);

  const mutation = trpc.supplyChain.runScenario.useMutation({
    onSuccess: (r) => {
      setRun(r);
      utils.supplyChain.listScenarios.invalidate();
      toast.success("Scenario complete", { description: `${r.input.simulations.toLocaleString()} simulations · ${r.engine === "ml-api" ? "ML service" : "TypeScript Monte Carlo engine"}` });
    },
    onError: (e) => toast.error("Scenario failed", { description: e.message }),
  });
  const loaded = trpc.supplyChain.getScenario.useQuery({ id: loadId ?? "" }, { enabled: !!loadId });
  useEffect(() => {
    if (loaded.data) setRun(loaded.data);
  }, [loaded.data]);

  const byCountry = useMemo(() => {
    const m = new Map<string, NonNullable<typeof opts.data>["regions"]>();
    for (const r of opts.data?.regions ?? []) m.set(r.country, [...(m.get(r.country) ?? []), r]);
    return [...m.entries()];
  }, [opts.data]);

  const regionNames = regions.map((id) => opts.data?.regions.find((r) => r.id === id)?.name).filter(Boolean);
  const basin = opts.data?.regions.find((r) => r.id === regions[0])?.basin;

  const submit = () => mutation.mutate({ commodity, regionIds: regions, intensity, durationDays: duration, simulations: sims, label: label || undefined });

  return (
    <div>
      <ScHeader
        eyebrow="Supply chain · disruption scenarios"
        title="Scenario Modeler"
        description="Model a flood hitting chosen regions at a set strength and duration. Thousands of simulations give a range of losses, the knock-on effect through warehouses, ports and buyers, and the mitigation options that pay back."
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        {/* Form */}
        <Panel title="Scenario definition" icon={FlaskConical} accent="amber" className="h-fit">
          {opts.isLoading ? (
            <Skeleton className="h-96" />
          ) : (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-[13px] leading-relaxed text-amber-50">
                If a flood hits <b className="text-amber-300">{regionNames.length ? regionNames.join(", ") : "…"}</b>
                {basin ? <span className="text-slate-400"> ({basin})</span> : null} at <b className="text-amber-300">Category {intensity}</b> intensity for <b className="text-amber-300">{duration} days</b>, what happens to{" "}
                <b className="text-amber-300">{commodity}</b> supply?
              </div>

              <Field label="Commodity">
                <div className="flex flex-wrap gap-1.5">
                  {opts.data?.commodities.map((c) => (
                    <Chip key={c.id} active={commodity === c.id} color={commodityColor(c.id)} onClick={() => setCommodity(c.id)}>
                      {c.id}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label={`Affected regions (${regions.length})`} hint="Live flood risk shown per district">
                <div className="max-h-56 space-y-2.5 overflow-y-auto pr-1">
                  {byCountry.map(([country, list]) => (
                    <div key={country}>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{country}</span>
                        <button type="button" className="hover:text-amber-300" onClick={() => setRegions(list.map((r) => r.id))}>
                          select basin
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {list.map((r) => (
                          <Chip key={r.id} active={regions.includes(r.id)} color={riskColor(r.floodRisk)} onClick={() => setRegions((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))}>
                            {r.name} <span className="telemetry text-[10px] opacity-70">{r.floodRisk}</span>
                          </Chip>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Field>

              <Field label={`Intensity — Category ${intensity}`} hint={CATEGORY[intensity]}>
                <input type="range" min={1} max={5} step={1} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} className="w-full accent-amber-500" aria-label="Intensity" />
                <div className="flex justify-between telemetry text-[10px] text-slate-500">
                  {[1, 2, 3, 4, 5].map((c) => (
                    <span key={c}>C{c}</span>
                  ))}
                </div>
              </Field>

              <Field label={`Duration — ${duration} days`}>
                <input type="range" min={1} max={21} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full accent-amber-500" aria-label="Duration in days" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Simulations">
                  <Segmented value={sims} onChange={setSims} options={[1000, 2000, 5000].map((v) => ({ value: v, label: v.toLocaleString() }))} />
                </Field>
                <Field label="Label (optional)">
                  <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Mekong C3 drill" maxLength={120} />
                </Field>
              </div>

              <ScButton type="submit" className="w-full py-2.5" loading={mutation.isPending} disabled={!regions.length}>
                {!mutation.isPending && <Play size={15} />} {mutation.isPending ? `Running ${sims.toLocaleString()} simulations…` : "Run Monte Carlo"}
              </ScButton>
            </form>
          )}
        </Panel>

        {/* Results */}
        <div className="min-w-0 space-y-5">
          <AnimatePresence mode="wait">
            {mutation.isPending ? (
              <motion.div key="run" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hud-panel hud-sweep grid h-80 place-items-center" style={{ ["--hud-accent" as string]: "245 158 11" }}>
                <div className="text-center">
                  <Cpu className="mx-auto animate-pulse text-amber-400" size={30} />
                  <div className="mt-3 telemetry text-sm text-amber-200">Sampling depth · duration · inundation · outage …</div>
                  <div className="telemetry text-[11px] text-slate-500">n = {sims.toLocaleString()} · seeded mulberry32</div>
                </div>
              </motion.div>
            ) : run ? (
              <ScenarioResults key={run.id} run={run} />
            ) : (
              <motion.div key="empty" className="hud-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <EmptyState icon={Waves} title="No scenario yet">
                  Define a flood event on the left and run it — or load a saved scenario below.
                </EmptyState>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Saved + compare */}
      <Panel className="mt-5" title="Saved scenarios & comparison" subtitle="Pick any two to compare side by side" icon={GitCompare} accent="amber">
        <QueryError error={saved.error} what="saved scenarios" />
        {saved.data?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="hud-label text-left">
                  <th className="px-2 py-2">A</th>
                  <th className="px-2 py-2">B</th>
                  <th className="px-2 py-2">Scenario</th>
                  <th className="px-2 py-2 text-right">P50 loss</th>
                  <th className="px-2 py-2 text-right">P90 loss</th>
                  <th className="px-2 py-2 text-right">Price</th>
                  <th className="px-2 py-2 text-right">Run</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {saved.data.map((s) => (
                  <tr key={s.id} className="hover:bg-white/[0.02]">
                    <td className="px-2 py-2">
                      <input type="radio" name="cmpA" className="accent-amber-500" checked={compare[0] === s.id} onChange={() => setCompare(([, b]) => [s.id, b === s.id ? null : b])} aria-label="Compare as A" />
                    </td>
                    <td className="px-2 py-2">
                      <input type="radio" name="cmpB" className="accent-amber-500" checked={compare[1] === s.id} onChange={() => setCompare(([a]) => [a === s.id ? null : a, s.id])} aria-label="Compare as B" />
                    </td>
                    <td className="px-2 py-2">
                      <div className="text-slate-100">{s.label}</div>
                      <div className="telemetry text-[10.5px] text-slate-500">
                        {s.engine === "ml-api" ? "ML service" : "TS Monte Carlo"} · {s.id}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right telemetry text-amber-200">{fmtUsd(s.p50)}</td>
                    <td className="px-2 py-2 text-right telemetry text-rose-300">{fmtUsd(s.p90)}</td>
                    <td className="px-2 py-2 text-right telemetry text-slate-200">{fmtPct(s.priceImpact, 1, true)}</td>
                    <td className="px-2 py-2 text-right telemetry text-[11px] text-slate-500">{timeAgo(s.createdAt)}</td>
                    <td className="px-2 py-2 text-right">
                      <button className="text-xs text-amber-300 hover:underline" onClick={() => setLoadId(s.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={GitCompare} title="Nothing saved yet">
            Every run is saved automatically. Run two scenarios (e.g. Category 3 vs Category 5) to compare them.
          </EmptyState>
        )}
        {compare[0] && compare[1] && <Comparison a={compare[0]} b={compare[1]} />}
      </Panel>
    </div>
  );
}

function ScenarioResults({ run }: { run: Run }) {
  const r = run.result;
  const cascade = useMemo(() => {
    const impactColor = (v: number) => riskColor(Math.min(100, v * 2.2));
    const nodes = [...run.cascade.nodes]
      .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
      .map((n) => ({ id: n.id, name: n.name, color: impactColor(n.impactPct), sub: `${n.impactPct}%` }));
    const links = run.cascade.links.map((l) => ({ source: l.source, target: l.target, value: Math.max(1, l.tonnes), color: impactColor(l.impactPct), label: l.corridor, opacity: 0.35 }));
    return { nodes, links };
  }, [run]);
  const byStage = STAGE_ORDER.map((s) => ({ stage: s, items: run.cascade.nodes.filter((n) => n.stage === s).sort((a, b) => b.impactPct - a.impactPct) })).filter((g) => g.items.length);

  const cards = [
    { l: "P50 network loss", v: r.estimated_loss_usd, fmt: "usd", c: "#fbbf24", s: `90% CI ${fmtUsd(r.loss_usd_ci[0])} – ${fmtUsd(r.loss_usd_ci[1])}` },
    { l: "P90 network loss", v: r.p90_loss_usd, fmt: "usd", c: "#f87171", s: `P95 ${fmtUsd(r.p95_loss_usd)} · mean ${fmtUsd(r.mean_loss_usd)}` },
    { l: "Disruption probability", v: r.disruption_probability * 100, fmt: "pct", c: riskColor(r.disruption_probability * 100), s: "sims with >5% crop loss" },
    { l: "Price impact", v: r.price_impact_pct, fmt: "pctS", c: "#fbbf24", s: `90% CI ${fmtPct(r.price_ci[0], 1, true)} … ${fmtPct(r.price_ci[1], 1, true)}` },
    { l: "Recovery", v: r.recovery_days, fmt: "days", c: "#a78bfa", s: `90% CI ${r.recovery_ci[0]}–${r.recovery_ci[1]} days` },
    { l: "Crop volume lost", v: r.volume_loss_tonnes, fmt: "t", c: "#e2e8f0", s: `${fmtT(r.network_volume_loss_tonnes)} in your footprint (${r.sourcing_share_pct}%)` },
  ];

  return (
    <motion.div key={run.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
      <div className="hud-panel p-4" style={{ ["--hud-accent" as string]: "245 158 11" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-display text-base font-semibold text-white">{run.label}</div>
          <div className="flex gap-1.5">
            <SourceTag>{`Monte Carlo n=${run.input.simulations.toLocaleString()}`}</SourceTag>
            <SourceTag>{run.engine === "ml-api" ? "ML service" : "TS engine (ML service offline)"}</SourceTag>
          </div>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-300">{run.narrative}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {cards.map((c, i) => (
          <motion.div key={c.l} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 * i }} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
            <div className="hud-label">{c.l}</div>
            <div className="mt-1 text-2xl font-semibold" style={{ color: c.c }}>
              {c.fmt === "usd" ? (
                <AnimatedNumber value={c.v / 1e6} decimals={1} prefix="$" suffix="M" />
              ) : c.fmt === "pct" ? (
                <AnimatedNumber value={c.v} suffix="%" />
              ) : c.fmt === "pctS" ? (
                <AnimatedNumber value={c.v} decimals={1} prefix={c.v > 0 ? "+" : ""} suffix="%" />
              ) : c.fmt === "days" ? (
                <AnimatedNumber value={c.v} suffix=" d" />
              ) : (
                <AnimatedNumber value={c.v / 1000} decimals={1} suffix=" kt" />
              )}
            </div>
            <div className="text-[11px] text-slate-500">{c.s}</div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <Panel title="Loss distribution" subtitle="Network loss across simulations · shaded = 90% confidence interval" icon={TrendingUp} accent="amber" actions={<SourceTag>{`Monte Carlo n=${run.input.simulations}`}</SourceTag>}>
          <LossHistogram histogram={r.histogram} p50={r.estimated_loss_usd} p90={r.p90_loss_usd} ci={r.loss_usd_ci} />
          <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: "#3987e5" }} />below P50</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-amber-500" />P50–P90</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-rose-400" />tail ≥ P90</span>
            <span className="telemetry">crop {fmtUsd(r.components.crop_usd)} · logistics {fmtUsd(r.components.logistics_usd)} · inventory {fmtUsd(r.components.inventory_usd)}</span>
          </div>
        </Panel>
        <Panel title="Recovery timeline" subtitle="Supply capacity through affected corridor (% of normal)" icon={Timer} accent="amber" actions={<SourceTag>Monte Carlo</SourceTag>}>
          <RecoveryChart data={run.recovery} />
          <div className="mt-1 text-[11px] text-slate-500">
            Mean simulated flood depth {r.mean_depth_m} m · median recovery {r.recovery_days} d (P50) vs {r.recovery_ci[1]} d stress case (P90 curve).
          </div>
        </Panel>
      </div>

      <Panel title="Impact cascade" subtitle="Producer regions → warehouses & processors → ports → downstream buyers · colour = expected impact · width = t/week" icon={Workflow} accent="amber" actions={<SourceTag>Agri-SHIELD network</SourceTag>}>
        {cascade.links.length ? (
          <SankeyDiagram
            nodes={cascade.nodes}
            links={cascade.links}
            align="left"
            height={Math.max(300, Math.min(560, cascade.nodes.length * 30))}
            renderTip={(x) => {
              if (x.kind === "node") {
                const n = run.cascade.nodes.find((c) => c.id === x.node.id)!;
                return (
                  <div>
                    <div className="font-medium text-white">{n.name}</div>
                    <div className="text-slate-400">{n.detail}</div>
                    <div className="telemetry" style={{ color: x.node.color }}>
                      impact {n.impactPct}% · {fmtT(n.tonnesAtRisk)} at risk
                    </div>
                  </div>
                );
              }
              return (
                <div>
                  <div className="font-medium text-white">
                    {x.source.name} → {x.target.name}
                  </div>
                  <div className="telemetry text-slate-400">
                    {x.link.value.toLocaleString()} t/wk · {x.link.label}
                  </div>
                </div>
              );
            }}
          />
        ) : (
          <EmptyState icon={Workflow} title="No downstream links for this commodity in the selected regions" />
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {byStage.map((g) => (
            <div key={g.stage}>
              <div className="hud-label mb-1.5">{g.stage === "retailer" ? "wholesale" : g.stage}s</div>
              <ul className="space-y-1">
                {g.items.slice(0, 5).map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 text-[11px]">
                    <span className="truncate text-slate-300" title={n.name}>
                      {n.name}
                    </span>
                    <span className="telemetry" style={{ color: riskColor(Math.min(100, n.impactPct * 2.2)) }}>
                      {n.impactPct}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Mitigation options" subtitle="Cost vs expected loss avoided (incl. price exposure) · ROI = (avoided − cost) / cost" icon={ShieldCheck} accent="amber">
        <div className="grid gap-3 md:grid-cols-2">
          {[...run.mitigations]
            .sort((a, b) => b.roi - a.roi)
            .map((m, i) => (
              <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} whileHover={{ scale: 1.01 }} className={`relative rounded-xl border p-4 ${m.recommended ? "border-amber-500/50 bg-amber-500/[0.06]" : "border-slate-800 bg-slate-900/40"}`}>
                {m.recommended && (
                  <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-slate-950">
                    <BadgeCheck size={11} /> RECOMMENDED
                  </span>
                )}
                <div className="pr-28 text-sm font-medium text-white">{m.title}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{m.description}</p>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  {[
                    { l: "Cost", v: fmtUsd(m.costUsd), c: "#e2e8f0" },
                    { l: "Avoided", v: fmtUsd(m.lossAvoidedUsd), c: "#4ade80" },
                    { l: "Risk ↓", v: `${m.riskReductionPct}%`, c: "#fbbf24" },
                    { l: "ROI", v: `${m.roi > 0 ? "+" : ""}${m.roi.toFixed(1)}×`, c: m.roi > 0 ? "#4ade80" : "#f87171" },
                  ].map((x) => (
                    <div key={x.l} className="rounded-md bg-black/20 py-1.5">
                      <div className="hud-label !text-[9px]">{x.l}</div>
                      <div className="telemetry text-sm" style={{ color: x.c }}>
                        {x.v}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  P90 tail reduced {m.p90ReductionPct}% · lead time {m.leadTimeDays} d
                </div>
              </motion.div>
            ))}
        </div>
      </Panel>
    </motion.div>
  );
}

function Comparison({ a, b }: { a: string; b: string }) {
  const qa = trpc.supplyChain.getScenario.useQuery({ id: a });
  const qb = trpc.supplyChain.getScenario.useQuery({ id: b });
  if (!qa.data || !qb.data) return <Skeleton className="mt-4 h-48" />;
  const A = qa.data;
  const B = qb.data;
  const rows: { l: string; a: number; b: number; f: (v: number) => string; worseHigher?: boolean }[] = [
    { l: "Category / duration", a: A.input.intensity * 100 + A.input.durationDays, b: B.input.intensity * 100 + B.input.durationDays, f: () => "" },
    { l: "P50 network loss", a: A.result.estimated_loss_usd, b: B.result.estimated_loss_usd, f: (v) => fmtUsd(v), worseHigher: true },
    { l: "P90 network loss", a: A.result.p90_loss_usd, b: B.result.p90_loss_usd, f: (v) => fmtUsd(v), worseHigher: true },
    { l: "Disruption probability", a: A.result.disruption_probability * 100, b: B.result.disruption_probability * 100, f: (v) => `${v.toFixed(0)}%`, worseHigher: true },
    { l: "Crop volume lost", a: A.result.volume_loss_tonnes, b: B.result.volume_loss_tonnes, f: (v) => fmtT(v), worseHigher: true },
    { l: "Price impact", a: A.result.price_impact_pct, b: B.result.price_impact_pct, f: (v) => fmtPct(v, 1, true), worseHigher: true },
    { l: "Recovery (days)", a: A.result.recovery_days, b: B.result.recovery_days, f: (v) => `${v} d`, worseHigher: true },
    { l: "Nodes/buyers ≥20% impact", a: A.cascade.nodes.filter((n) => n.stage !== "producer" && n.impactPct >= 20).length, b: B.cascade.nodes.filter((n) => n.stage !== "producer" && n.impactPct >= 20).length, f: (v) => String(v), worseHigher: true },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2 overflow-x-auto rounded-xl border border-amber-500/20">
        <table className="w-full text-sm">
          <thead className="bg-[#0b1a33]/60">
            <tr className="hud-label text-left">
              <th className="px-3 py-2">Metric</th>
              <th className="px-3 py-2 text-right">A · {A.label}</th>
              <th className="px-3 py-2 text-right">B · {B.label}</th>
              <th className="px-3 py-2 text-right">Δ (B − A)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((r, i) =>
              i === 0 ? (
                <tr key={r.l}>
                  <td className="px-3 py-2 text-slate-400">{r.l}</td>
                  <td className="px-3 py-2 text-right telemetry text-slate-200">
                    C{A.input.intensity} · {A.input.durationDays} d · {A.input.commodity}
                  </td>
                  <td className="px-3 py-2 text-right telemetry text-slate-200">
                    C{B.input.intensity} · {B.input.durationDays} d · {B.input.commodity}
                  </td>
                  <td />
                </tr>
              ) : (
                <tr key={r.l}>
                  <td className="px-3 py-2 text-slate-400">{r.l}</td>
                  <td className="px-3 py-2 text-right telemetry text-slate-200">{r.f(r.a)}</td>
                  <td className="px-3 py-2 text-right telemetry text-slate-200">{r.f(r.b)}</td>
                  <td className="px-3 py-2 text-right telemetry" style={{ color: r.b === r.a ? "#94a3b8" : (r.b > r.a) === !!r.worseHigher ? "#f87171" : "#4ade80" }}>
                    {r.a ? `${r.b >= r.a ? "+" : ""}${(((r.b - r.a) / Math.abs(r.a)) * 100).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
      {[A, B].map((s, i) => (
        <div key={s.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-1 text-xs text-slate-300">
            <span className="telemetry text-amber-300">{i ? "B" : "A"}</span> · {s.label}
          </div>
          <LossHistogram histogram={s.result.histogram} p50={s.result.estimated_loss_usd} p90={s.result.p90_loss_usd} ci={s.result.loss_usd_ci} height={180} />
        </div>
      ))}
    </motion.div>
  );
}
