"use client";

/**
 * Claims validation — plot/location + loss date + claimed peril → evidence pack
 * from ERA5, GloFAS, MODIS NDVI and the NASA observed-flood layer, a consistency
 * score and a downloadable PDF evidence report.
 */
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ExternalLink, FileDown, FileSearch, History, Satellite } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { claimEvidencePdf } from "./claimPdf";
import { axisProps, Btn, dateStr, Field, inputCls, NumInput, Select, tooltipStyle, usd, VIZ, WhatThisMeans } from "./kit";

const LocationMap = dynamic(() => import("./LocationMap"), { ssr: false, loading: () => <Skeleton className="h-[220px]" /> });

type Meta = RouterOutputs["insurance"]["meta"];
type Claim = RouterOutputs["insurance"]["validateClaim"];

const VERDICT = {
  consistent: { label: "Consistent", cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300", tone: "emerald" as const },
  partially_consistent: { label: "Partially consistent", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300", tone: "amber" as const },
  not_supported: { label: "Not supported", cls: "border-rose-400/40 bg-rose-400/10 text-rose-300", tone: "rose" as const },
};

export default function Claims({ meta, orgName }: { meta: Meta; orgName: string }) {
  const utils = trpc.useUtils();
  const plots = trpc.insurance.plots.useQuery();
  const history = trpc.insurance.claims.useQuery();
  const [plotId, setPlotId] = useState("");
  const [pt, setPt] = useState({ lat: 22.7185, lon: 89.0705 });
  const [lossDate, setLossDate] = useState("2024-05-27");
  const [peril, setPeril] = useState<Claim["input"]["peril"]>("cyclone");
  const [claimed, setClaimed] = useState(2500);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<Claim | null>(null);
  const run = trpc.insurance.validateClaim.useMutation({
    onSuccess: (c) => {
      setResult(c);
      utils.insurance.claims.invalidate();
    },
    onError: (e) => toast.error("Validation failed", { description: e.message }),
  });
  const plot = plots.data?.find((p) => p.id === plotId);
  const point = plot ? { lat: plot.lat, lon: plot.lon } : pt;
  const dots = useMemo(() => (plots.data ?? []).map((p) => ({ lat: p.lat, lon: p.lon, color: "#64748b", radius: 3, id: p.id, label: p.name })), [plots.data]);
  const perilLabel = (v: string) => meta.perils.find((p) => p.value === v)?.label ?? v;
  const c = result;
  const maxDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <Panel title="Claim details" icon={FileSearch} accent="cyan" subtitle="Pick an insured plot or click the map">
          <div className="space-y-3">
            <Field label="Insured unit (optional)">
              <Select
                value={plotId}
                onChange={setPlotId}
                options={[{ value: "", label: "— use map point —" }, ...(plots.data ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${p.ref ?? ""}` }))]}
                ariaLabel="Insured unit"
              />
            </Field>
            <LocationMap point={point} dots={dots} onDotClick={setPlotId} onPick={(lat, lon) => (setPlotId(""), setPt({ lat, lon }))} height={210} zoom={9} />
            <div className="text-[11.5px] text-slate-400">
              {plot ? (
                <>
                  <b className="text-slate-200">{plot.name}</b> · {plot.crop} · {usd(plot.sumInsuredUsd)} insured
                </>
              ) : (
                <>
                  Point {point.lat.toFixed(4)}, {point.lon.toFixed(4)}
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Loss date">
                <input type="date" className={inputCls} min="1991-02-01" max={maxDate} value={lossDate} onChange={(e) => setLossDate(e.target.value)} />
              </Field>
              <Field label="Claimed peril">
                <Select value={peril} onChange={setPeril} options={meta.perils} />
              </Field>
            </div>
            <Field label="Claimed amount (USD)">
              <NumInput value={claimed} onChange={setClaimed} min={0} suffix="USD" />
            </Field>
            <Field label="Notes">
              <textarea className={cn(inputCls, "h-16 py-2")} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. farmer reports standing water for 6 days" />
            </Field>
            <Btn className="w-full" loading={run.isPending} onClick={() => run.mutate({ lat: point.lat, lon: point.lon, assetId: plotId || null, lossDate, peril, claimedUsd: claimed, notes })}>
              <FileSearch size={14} /> Validate against the record
            </Btn>
            <div className="text-[11px] text-slate-500">Try: Cyclone Remal (27 May 2024) or Amphan (20 May 2020) on the Satkhira coast; a Jul-2011 flood; or a drought claim in a wet month to see a “not supported” verdict.</div>
          </div>
        </Panel>
        <Panel title="Recent validations" icon={History} accent="cyan" bodyClassName="px-2 pb-2">
          {!history.data?.length ? (
            <div className="px-2 pb-2 text-[12px] text-slate-500">No claims validated yet in this workspace.</div>
          ) : (
            <div className="max-h-72 space-y-1 overflow-auto">
              {history.data.map((h) => (
                <button key={h.id} onClick={() => setResult(h)} className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]", c?.id === h.id && "bg-cyan-400/[0.07]")}>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] text-slate-200">
                      {perilLabel(h.input.peril)} · {h.input.lossDate}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">{h.input.assetName ?? `${h.input.lat.toFixed(3)}, ${h.input.lon.toFixed(3)}`}</span>
                  </span>
                  <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10.5px] font-semibold", VERDICT[h.verdict].cls)}>{h.score}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="min-w-0 space-y-4">
        {run.isPending && <Skeleton className="h-[480px]" />}
        {!run.isPending && !c && (
          <Panel>
            <EmptyState icon={FileSearch} title="No claim validated yet">
              Enter the plot, loss date and peril. We pull 35 years of reanalysis weather, river flow and satellite vegetation for that spot and tell you whether the claim matches what was observed.
            </EmptyState>
          </Panel>
        )}
        {!run.isPending && c && (
          <>
            <Panel
              title={`${perilLabel(c.input.peril)} on ${dateStr(c.input.lossDate)}`}
              subtitle={`${c.input.assetName ?? "Map point"} · ${c.input.lat.toFixed(4)}, ${c.input.lon.toFixed(4)} · ref ${c.id}`}
              icon={FileSearch}
              accent="cyan"
              actions={
                <Btn variant="outline" onClick={() => claimEvidencePdf(c, perilLabel(c.input.peril), orgName).then(() => toast.success("Evidence report downloaded"))}>
                  <FileDown size={13} /> PDF report
                </Btn>
              }
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className={cn("rounded-xl border px-4 py-3", VERDICT[c.verdict].cls)}>
                  <div className="text-[11px] uppercase tracking-wider opacity-80">Verdict</div>
                  <div className="font-display text-xl font-semibold">{VERDICT[c.verdict].label}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Consistency score</div>
                  <div className="telemetry text-3xl font-semibold text-white">
                    {c.score}
                    <span className="text-base text-slate-500">/100</span>
                  </div>
                </div>
                {c.input.claimedUsd != null && (
                  <div>
                    <div className="text-[11px] text-slate-400">Claimed</div>
                    <div className="telemetry text-xl text-slate-100">{usd(c.input.claimedUsd)}</div>
                  </div>
                )}
              </div>
              <WhatThisMeans className="mt-3" tone={VERDICT[c.verdict].tone}>
                {c.summary}
              </WhatThisMeans>
              {c.dataNotes.map((n) => (
                <div key={n} className="mt-2 text-[11.5px] text-amber-300/90">
                  ⚑ {n}
                </div>
              ))}
            </Panel>

            <Panel title="Evidence pack" subtitle="Percentiles compare with the same time of year in every other year since 1991" icon={Satellite} accent="cyan" bodyClassName="px-0 pb-2">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-2 font-medium">Signal</th>
                      <th className="py-2 font-medium">Observed</th>
                      <th className="py-2 font-medium">Context</th>
                      <th className="px-4 py-2 font-medium">Supports claim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.evidence.map((e) => (
                      <tr key={e.key} className={cn("border-b border-slate-800/60", !e.weight && "opacity-55")}>
                        <td className="px-4 py-2">
                          <div className="text-slate-200">{e.label}</div>
                          <div className="text-[10.5px] text-slate-500">{e.source}</div>
                        </td>
                        <td className="py-2 telemetry text-slate-100">{e.value}</td>
                        <td className="py-2 pr-3 text-slate-400">{e.detail}</td>
                        <td className="w-40 px-4 py-2">
                          {e.support == null ? (
                            <span className="text-[11px] text-slate-500">n/a</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                                <div className="h-full rounded-full" style={{ width: `${Math.round(e.support * 100)}%`, background: e.support >= 0.65 ? VIZ.good : e.support >= 0.35 ? VIZ.warning : VIZ.critical }} />
                              </div>
                              <span className="w-9 text-right telemetry text-[11px] text-slate-300">{Math.round(e.support * 100)}%</span>
                            </div>
                          )}
                          {!!e.weight && <div className="text-[10px] text-slate-500">weight {Math.round(e.weight * 100)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <div className="grid gap-4 2xl:grid-cols-2">
              <Panel title="Daily rainfall around the loss date" subtitle="ERA5 · mm/day · red = loss date" accent="cyan">
                <div className="h-[200px]">
                  <ResponsiveContainer>
                    <BarChart data={c.rainSeries} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={VIZ.grid} vertical={false} />
                      <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => d.slice(5)} minTickGap={20} />
                      <YAxis {...axisProps} />
                      <Tooltip {...tooltipStyle} labelFormatter={(l) => dateStr(String(l))} formatter={(v: number) => [`${v?.toFixed(1)} mm`, "Rain"]} />
                      <Bar dataKey="rain" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                        {c.rainSeries.map((s) => (
                          <Cell key={s.date} fill={s.date === c.input.lossDate ? VIZ.critical : VIZ.s1} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <Panel title={c.rainSeries.some((s) => s.discharge != null) ? "River discharge (GloFAS)" : "Daily max temperature"} subtitle={c.rainSeries.some((s) => s.discharge != null) ? "m³/s" : "°C"} accent="cyan">
                <div className="h-[200px]">
                  <ResponsiveContainer>
                    <LineChart data={c.rainSeries} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                      <CartesianGrid stroke={VIZ.grid} vertical={false} />
                      <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => d.slice(5)} minTickGap={20} />
                      <YAxis {...axisProps} domain={["auto", "auto"]} />
                      <Tooltip {...tooltipStyle} labelFormatter={(l) => dateStr(String(l))} />
                      <ReferenceLine x={c.input.lossDate} stroke={VIZ.critical} strokeDasharray="4 3" />
                      <Line dataKey={c.rainSeries.some((s) => s.discharge != null) ? "discharge" : "tmax"} name={c.rainSeries.some((s) => s.discharge != null) ? "Discharge m³/s" : "Tmax °C"} stroke={VIZ.s1} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>

            <Panel title="Observed flood extent (NASA MODIS 2-day)" subtitle={`Layer for ${c.input.lossDate} — blue/red pixels are detected water/flood; clouds leave gaps`} icon={Satellite} accent="cyan" actions={<a href={c.worldviewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-cyan-300 hover:underline">Open in NASA Worldview <ExternalLink size={12} /></a>}>
              <LocationMap point={{ lat: c.input.lat, lon: c.input.lon }} overlayUrl={c.floodLayerUrl} height={260} zoom={9} />
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-400">
                {c.ndviChangePct != null && (
                  <span>
                    <Explain term="ndvi">NDVI</Explain> change across the date: <b className={c.ndviChangePct < -10 ? "text-rose-300" : "text-slate-200"}>{c.ndviChangePct}%</b> ({c.ndvi.length} MODIS composites).
                  </span>
                )}
                <SourceTag href="https://www.earthdata.nasa.gov/gibs">NASA GIBS</SourceTag>
                <SourceTag href="https://modis.ornl.gov/data/modis_webservice.html">MODIS MOD13Q1 · ORNL</SourceTag>
                <SourceTag href="https://open-meteo.com">ERA5 · GloFAS</SourceTag>
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
