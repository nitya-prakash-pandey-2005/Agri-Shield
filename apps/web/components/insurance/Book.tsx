"use client";

/**
 * Insurance book view — sum insured by peril/region, expected (average annual)
 * loss, PML from backtested annual aggregate losses, accumulation hotspots and
 * an excess-of-loss reinsurance attachment helper. Also lists saved products.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Archive, Download, Layers, Link2, Map as MapIcon, Pencil, Shield, Umbrella } from "lucide-react";
import { toast } from "sonner";
import { Panel, Skeleton, SourceTag, StatTile } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import AttachDialog from "./AttachDialog";
import { axisProps, Btn, downloadFile, ErrorBox, num, PendingHistory, pct, Slider, toCsv, tooltipStyle, usd, VIZ, WhatThisMeans } from "./kit";

const LocationMap = dynamic(() => import("./LocationMap"), { ssr: false, loading: () => <Skeleton className="h-[320px]" /> });
type Product = RouterOutputs["insurance"]["products"][number];

const PERIL_LABEL: Record<string, string> = { excess_rain: "Excess rain (index)", flood: "River flood (index)", drought: "Drought (index)", heat: "Heat (index)", "multi-peril": "Indemnity / area-yield" };

export default function Book({ onEdit, canWrite }: { onEdit: (p: Product) => void; canWrite: boolean }) {
  const utils = trpc.useUtils();
  const book = trpc.insurance.book.useQuery(undefined, { refetchInterval: (q) => ((q.state.data?.pending ?? 0) > 0 ? 8000 : false) });
  const products = trpc.insurance.products.useQuery();
  const archive = trpc.insurance.archiveProduct.useMutation({ onSuccess: () => (utils.insurance.products.invalidate(), toast.success("Product archived")) });
  const [attach, setAttach] = useState<Product | null>(null);
  const b = book.data;
  const pml100 = b?.pml.find((p) => p.T === 100)?.lossUsd ?? 0;
  const pml10 = b?.pml.find((p) => p.T === 10)?.lossUsd ?? 0;
  const [att, setAtt] = useState(0);
  const [lim, setLim] = useState(0);
  useEffect(() => {
    if (b && !att) {
      setAtt(Math.max(1000, Math.round(pml10 / 1000) * 1000));
      setLim(Math.max(1000, Math.round((pml100 - pml10) / 1000) * 1000));
    }
  }, [b, att, pml10, pml100]);
  const layer = trpc.insurance.layer.useQuery({ attachmentUsd: att, limitUsd: lim }, { enabled: !!b && att > 0 && lim > 0, placeholderData: (p) => p });
  const dots = useMemo(() => {
    if (!b) return [];
    const maxSi = Math.max(1, ...b.cells.map((c) => c.sumInsuredUsd));
    return b.cells.map((c) => ({
      lat: c.lat,
      lon: c.lon,
      radius: 5 + Math.sqrt(c.sumInsuredUsd / maxSi) * 16,
      color: c.lossRatePct >= 10 ? VIZ.critical : c.lossRatePct >= 5 ? VIZ.serious : c.lossRatePct >= 2 ? VIZ.warning : VIZ.s1,
      label: `${c.plots} units · ${usd(c.sumInsuredUsd)} insured · expected loss ${usd(c.expectedLossUsd)}/yr (${c.lossRatePct}% of SI)`,
    }));
  }, [b]);

  if (book.isLoading)
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
        <Skeleton className="col-span-full h-96" />
      </div>
    );
  if (!b) return <ErrorBox error={book.error} onRetry={() => book.refetch()} />;
  const worst = b.empiricalWorst;
  return (
    <div className="space-y-4">
      <PendingHistory pending={b.pending} total={b.refLocations} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total sum insured" value={b.totals.sumInsuredUsd / 1e6} decimals={1} prefix="$" suffix="M" accent="cyan" delta={`${b.totals.plots} insured units · premium ${usd(b.totals.premiumUsd)}`} deltaGood />
        <StatTile label="Average annual loss" value={b.totals.expectedLossUsd / 1e3} decimals={1} prefix="$" suffix="k" accent="amber" delta={`expected loss ratio ${pct(b.totals.expectedLossRatioPct, 0)}`} deltaGood={b.totals.expectedLossRatioPct < 70} hint="Mean of backtested annual aggregate losses" />
        <StatTile label="PML 1-in-100" value={pml100 / 1e3} decimals={0} prefix="$" suffix="k" accent="red" delta={`${pct(b.pml.find((p) => p.T === 100)?.pctOfSi, 1)} of sum insured`} deltaGood={false} />
        <StatTile label="Worst year on record" value={(worst?.lossUsd ?? 0) / 1e3} decimals={1} prefix="$" suffix="k" accent="violet" delta={worst ? `season ${worst.year} (${b.startYear}–${b.annual[b.annual.length - 1]?.year})` : "—"} deltaGood={false} />
      </div>
      <WhatThisMeans>
        If the last {b.annual.length} seasons repeated on today’s book, you would pay on average <b className="text-white">{usd(b.totals.expectedLossUsd)}</b> a year against <b className="text-white">{usd(b.totals.premiumUsd)}</b> of premium. The worst replayed season ({worst?.year}) would cost {usd(worst?.lossUsd)}; a 1-in-100-year season is estimated at <b className="text-rose-300">{usd(pml100)}</b> ({pct(b.pml.find((p) => p.T === 100)?.pctOfSi, 1)} of sum insured) — the capital or reinsurance you need to survive it. Biggest concentration: <b className="text-white">{b.byRegion[0]?.region}</b> ({usd(b.byRegion[0]?.sumInsuredUsd)}).
      </WhatThisMeans>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Annual aggregate loss — backtest" subtitle={`Today’s book replayed on every season ${b.startYear}–${b.annual[b.annual.length - 1]?.year}`} icon={Layers} accent="cyan" actions={<Btn variant="outline" onClick={() => downloadFile("book-annual-losses.csv", toCsv(b.annual))}><Download size={13} /> CSV</Btn>}>
          <div className="h-[250px]">
            <ResponsiveContainer>
              <BarChart data={b.annual} margin={{ top: 6, right: 6, left: -4, bottom: 0 }}>
                <CartesianGrid stroke={VIZ.grid} vertical={false} />
                <XAxis dataKey="year" {...axisProps} minTickGap={14} />
                <YAxis {...axisProps} tickFormatter={(v) => usd(v, 0)} />
                <Tooltip {...tooltipStyle} formatter={(v: number, n) => [usd(v), n]} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar dataKey="parametricUsd" name="Index (parametric) payouts" stackId="a" fill={VIZ.s1} isAnimationActive={false} />
                <Bar dataKey="indemnityUsd" name="Indemnity / area-yield (modelled)" stackId="a" fill={VIZ.s2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Index plots use their attached product’s payout curve. Indemnity plots use an ERA5 damage function over the Aman season (flood: 5-day rain 220→520 mm ⇒ 0→60 % loss; drought: water balance −200→−600 mm ⇒ 0→50 %; heat: 3→15 days ≥ 38 °C ⇒ 0→30 %) minus the policy deductible.
          </p>
        </Panel>
        <Panel title={<>Probable maximum loss <Explain term="pml" /></>} subtitle="Zero-inflated lognormal fitted to the annual losses" icon={Shield} accent="cyan">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-1 font-medium">Return period</th>
                <th className="py-1 text-right font-medium">Annual loss</th>
                <th className="py-1 text-right font-medium">% of SI</th>
              </tr>
            </thead>
            <tbody>
              {b.pml.map((p) => (
                <tr key={p.T} className="border-t border-slate-800/60">
                  <td className="py-1.5 text-slate-300">1-in-{p.T} years</td>
                  <td className="py-1.5 text-right telemetry text-slate-100">{usd(p.lossUsd)}</td>
                  <td className="py-1.5 text-right telemetry text-slate-400">{pct(p.pctOfSi, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            {Math.round(b.fit.p0 * 100)}% of seasons had no loss; loss years fit a lognormal by moments (μ {b.fit.mu.toFixed(2)}, σ {b.fit.sigma.toFixed(2)}). Beyond ~1-in-{b.annual.length} the figures are extrapolations — treat as order-of-magnitude.
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Panel title={<>Accumulation hotspots <Explain term="accumulation" /></>} subtitle="Circle size = sum insured per 0.25° cell; colour = expected loss rate" icon={MapIcon} accent="cyan">
          <LocationMap dots={dots} fit height={330} zoom={6} />
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
            {[
              [VIZ.s1, "< 2 % of SI / yr"],
              [VIZ.warning, "2–5 %"],
              [VIZ.serious, "5–10 %"],
              [VIZ.critical, "≥ 10 %"],
            ].map(([c, l]) => (
              <span key={l} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} /> {l}
              </span>
            ))}
          </div>
        </Panel>
        <Panel title={<>Reinsurance helper <Explain term="reinsurance" /></>} subtitle="Excess-of-loss layer on annual aggregate losses" icon={Umbrella} accent="cyan">
          <div className="space-y-3">
            <Slider label="Attachment (retention)" value={att} min={0} max={Math.max(10000, Math.round(pml100 * 1.5))} step={1000} onChange={setAtt} format={(v) => usd(v)} hint={`1-in-10 loss = ${usd(pml10)}`} />
            <Slider label="Layer limit" value={lim} min={1000} max={Math.max(10000, Math.round(b.totals.sumInsuredUsd * 0.6))} step={1000} onChange={setLim} format={(v) => usd(v)} hint={`covers up to ${usd(att + lim)} (1-in-100 = ${usd(pml100)})`} />
            {layer.data && (
              <div className="grid grid-cols-2 gap-2 text-center">
                <Mini label="Chance the layer is hit" v={`${pct(layer.data.attachProbPct, 1)}`} sub={layer.data.attachReturnPeriod ? `≈ 1-in-${layer.data.attachReturnPeriod} yrs` : ""} />
                <Mini label="Chance it is exhausted" v={pct(layer.data.exhaustProbPct, 1)} />
                <Mini label="Expected layer loss" v={usd(layer.data.expectedLayerLossUsd)} sub="per year" />
                <Mini label="Indicative premium" v={usd(layer.data.indicativePremiumUsd)} sub={`rate-on-line ${pct(layer.data.rateOnLinePct, 1)} (1.8× EL)`} />
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-slate-500">Rate-on-line = premium ÷ limit. Market pricing for cat layers is typically 1.5–3× expected loss; this is a benchmark, not a quote.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Exposure by peril & region" icon={Layers} accent="cyan" bodyClassName="px-0 pb-2">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-1.5 font-medium">Peril / cover</th>
                <th className="py-1.5 text-right font-medium">Plots</th>
                <th className="py-1.5 text-right font-medium">Sum insured</th>
                <th className="px-4 py-1.5 text-right font-medium">Exp. loss / yr</th>
              </tr>
            </thead>
            <tbody>
              {b.byPeril.map((p) => (
                <tr key={p.peril} className="border-b border-slate-800/50">
                  <td className="px-4 py-1.5 text-slate-200">{PERIL_LABEL[p.peril] ?? p.peril}</td>
                  <td className="py-1.5 text-right telemetry text-slate-400">{p.plots}</td>
                  <td className="py-1.5 text-right telemetry text-slate-200">{usd(p.sumInsuredUsd)}</td>
                  <td className="px-4 py-1.5 text-right telemetry text-amber-200">{usd(p.expectedLossUsd)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-slate-500">
                  Top regions
                </td>
              </tr>
              {b.byRegion.slice(0, 8).map((r) => (
                <tr key={`${r.region}-${r.country}`} className="border-b border-slate-800/50">
                  <td className="px-4 py-1.5 text-slate-200">
                    {r.region} <span className="text-slate-500">· {r.country}</span>
                  </td>
                  <td className="py-1.5 text-right telemetry text-slate-400">{r.plots}</td>
                  <td className="py-1.5 text-right telemetry text-slate-200">{usd(r.sumInsuredUsd)}</td>
                  <td className="px-4 py-1.5 text-right telemetry text-amber-200">{usd(r.expectedLossUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Parametric products" subtitle="Saved designs in this workspace" icon={Shield} accent="cyan" bodyClassName="px-2 pb-2">
          <div className="space-y-1.5">
            {(products.data ?? []).map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-slate-100">
                      {p.name} <span className={p.status === "active" ? "text-[10.5px] text-emerald-300" : "text-[10.5px] text-slate-500"}>· {p.status}</span>
                    </div>
                    <div className="text-[11.5px] text-slate-400">
                      {p.meta.short} {p.spec.calibration?.mode === "local" ? `at the local 1-in-${p.spec.calibration.triggerRp} level → full payout at 1-in-${p.spec.calibration.exitRp}` : `${p.meta.direction === "above" ? "≥" : "≤"} ${num(p.spec.trigger)} ${p.meta.unit} → ${num(p.spec.exit)} ${p.meta.unit}`} · {p.seasonLabel}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {p.attachedCount} units · {usd(p.attachedSumInsuredUsd)} insured{p.lastBacktest ? ` · backtest: pays ${pct(p.lastBacktest.frequencyPct, 0)} of years, burning cost ${pct(p.lastBacktest.burningCostPct, 1)}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Btn variant="ghost" onClick={() => onEdit(p)} aria-label="Open in designer">
                      <Pencil size={13} /> Open
                    </Btn>
                    {canWrite && (
                      <>
                        <Btn variant="ghost" onClick={() => setAttach(p)}>
                          <Link2 size={13} /> Attach
                        </Btn>
                        <Btn variant="ghost" onClick={() => archive.mutate({ id: p.id })} aria-label="Archive">
                          <Archive size={13} />
                        </Btn>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <SourceTag>{b.providers.join(" + ") || "ERA5"} reanalysis</SourceTag>
        <SourceTag>GloFAS v4</SourceTag>
        <SourceTag>{b.refLocations} reference locations</SourceTag>
        <SourceTag>computed {new Date(b.generatedAt).toLocaleString()}</SourceTag>
      </div>
      <AttachDialog open={!!attach} onClose={() => setAttach(null)} productId={attach?.id ?? null} productName={attach?.name ?? ""} />
    </div>
  );
}

function Mini({ label, v, sub }: { label: string; v: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-900/60 px-2 py-2">
      <div className="text-[10.5px] text-slate-500">{label}</div>
      <div className="telemetry text-slate-100">{v}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
