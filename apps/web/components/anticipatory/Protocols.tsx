"use client";

/** Trigger-protocol editor with a live historical backtest of the trigger. */
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Archive, History, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { axisProps, Btn, ErrorBox, Field, inputCls, Kpi, NumInput, pct, Select, Slider, tooltipStyle, usd, VIZ, WhatThisMeans } from "@/components/insurance/kit";
import { trpc, type RouterInputs, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Draft = Omit<RouterInputs["insurance"]["aa"]["save"], "orgId">;
type Proto = RouterOutputs["insurance"]["aa"]["protocols"][number];

const BLANK: Draft = {
  name: "Cyclone & storm-surge early action",
  hazard: "cyclone",
  metric: "rain_5d_mm",
  readiness: 120,
  activation: 200,
  minCommunities: 3,
  leadTimeDays: 3,
  scopeTags: [],
  actions: [
    { id: "a1", name: "Evacuation messaging via volunteers & loudspeakers", owner: "Field coordinator", costUsd: 2000, hoursBeforeImpact: 72 },
    { id: "a2", name: "Unconditional mobile-money transfer", owner: "Cash & voucher lead", costUsd: 0, hoursBeforeImpact: 48 },
  ],
  budgetUsd: 500_000,
  cashPerHouseholdUsd: 60,
  coveragePct: 30,
  deliveryFeePct: 1.5,
  stock: [{ item: "Dry food pack (3 days)", perHousehold: 1, unitCostUsd: 7.5 }],
  status: "active",
};

function useDebounced<T>(v: T, ms = 450): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function Protocols({ canWrite }: { canWrite: boolean }) {
  const utils = trpc.useUtils();
  const meta = trpc.insurance.aa.meta.useQuery();
  const list = trpc.insurance.aa.protocols.useQuery();
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (!draft && list.data?.[0]) setDraft(toDraft(list.data[0]));
  }, [list.data, draft]);
  const save = trpc.insurance.aa.save.useMutation({
    onSuccess: (p) => {
      toast.success(`Saved “${p.name}”`);
      utils.insurance.aa.invalidate();
      setDraft(toDraft(p));
    },
    onError: (e) => toast.error(e.message),
  });
  const archive = trpc.insurance.aa.archive.useMutation({ onSuccess: () => (utils.insurance.aa.invalidate(), setDraft(null), toast.success("Protocol archived")) });
  const [startYear, setStartYear] = useState(1995);
  const bin = useDebounced(draft ? { draft: { metric: draft.metric, readiness: draft.readiness, activation: draft.activation, minCommunities: draft.minCommunities, leadTimeDays: draft.leadTimeDays, scopeTags: draft.scopeTags }, startYear } : null);
  const bt = trpc.insurance.aa.backtest.useQuery(bin ?? { startYear }, { enabled: !!bin, placeholderData: (p) => p, staleTime: 10 * 60_000, refetchInterval: (q) => ((q.state.data?.pending ?? 0) > 0 ? 8000 : false) });
  if (!draft || !meta.data) return <Skeleton className="h-[600px]" />;
  const m = meta.data.metrics[draft.metric];
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d!, ...p }));
  const b = bt.data;
  const unitMax = draft.metric === "flood_prob_72h" ? 100 : draft.metric === "rain_5d_mm" ? 500 : 6;
  const step = draft.metric === "discharge_ratio" ? 0.1 : draft.metric === "rain_5d_mm" ? 5 : 1;
  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <div className="space-y-4">
        <Panel title="Trigger protocols" icon={History} accent="cyan" bodyClassName="px-2 pb-2" actions={canWrite && <Btn variant="ghost" onClick={() => setDraft({ ...BLANK })}><Plus size={13} /> New</Btn>}>
          <div className="space-y-1">
            {(list.data ?? []).map((p) => (
              <button key={p.id} onClick={() => setDraft(toDraft(p))} className={cn("w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]", draft.id === p.id && "bg-cyan-400/[0.07]")}>
                <div className="text-[12.5px] text-slate-200">{p.name}</div>
                <div className="text-[11px] text-slate-500">
                  {meta.data.metrics[p.metric].label} · {p.readiness}/{p.activation} {meta.data.metrics[p.metric].unit} · {p.status}
                </div>
              </button>
            ))}
            {!draft.id && <div className="rounded-lg bg-cyan-400/[0.07] px-2 py-1.5 text-[12.5px] text-cyan-200">New: {draft.name}</div>}
          </div>
        </Panel>
        <Panel title={draft.id ? "Edit protocol" : "New protocol"} accent="cyan">
          <div className="space-y-3">
            <Field label="Name">
              <input className={inputCls} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Hazard">
                <Select value={draft.hazard} onChange={(v) => set({ hazard: v })} options={[{ value: "flood", label: "Riverine flood" }, { value: "cyclone", label: "Cyclone / surge" }, { value: "heavy_rain", label: "Heavy rain" }]} />
              </Field>
              <Field label={<>Forecast metric <Explain text={m.explain} /></>}>
                <Select
                  value={draft.metric}
                  onChange={(v) => set({ metric: v, ...(v === "flood_prob_72h" ? { readiness: 50, activation: 70 } : v === "rain_5d_mm" ? { readiness: 120, activation: 200 } : { readiness: 1.5, activation: 2.2 }) })}
                  options={Object.entries(meta.data.metrics).map(([k, v]) => ({ value: k as Draft["metric"], label: v.label }))}
                />
              </Field>
            </div>
            <Slider label="Readiness when ≥" value={draft.readiness} min={0} max={unitMax} step={step} onChange={(v) => set({ readiness: v, activation: Math.max(v, draft.activation) })} format={(v) => `${v} ${m.unit}`} hint="Pre-alert: volunteers on standby, lists checked, stock readied" />
            <Slider label="Activation when ≥" value={draft.activation} min={0} max={unitMax} step={step} onChange={(v) => set({ activation: v, readiness: Math.min(v, draft.readiness) })} format={(v) => `${v} ${m.unit}`} hint="Money moves and early actions start" />
            <div className="grid grid-cols-2 gap-3">
              <Slider label="…at ≥ communities" value={draft.minCommunities} min={1} max={20} onChange={(v) => set({ minCommunities: v })} />
              <Slider label={<>Lead time <Explain term="lead_time" /></>} value={draft.leadTimeDays} min={1} max={10} onChange={(v) => set({ leadTimeDays: v })} format={(v) => `${v} d`} />
            </div>
            <Field label="Scope (community tags — empty = all)">
              <div className="flex flex-wrap gap-1.5">
                {meta.data.tags.map((t) => (
                  <button key={t} onClick={() => set({ scopeTags: draft.scopeTags.includes(t) ? draft.scopeTags.filter((x) => x !== t) : [...draft.scopeTags, t] })} className={cn("rounded-md border px-2 py-0.5 text-[11.5px]", draft.scopeTags.includes(t) ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200" : "border-slate-700 text-slate-400")}>
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Early actions">
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_76px_64px_24px] gap-1.5 text-[10.5px] text-slate-500">
                  <span>Action</span>
                  <span>Cost (USD)</span>
                  <span>Hours before</span>
                </div>
                {draft.actions.map((a, i) => (
                  <div key={a.id} className="grid grid-cols-[1fr_76px_64px_24px] items-center gap-1.5">
                    <input className={inputCls} value={a.name} onChange={(e) => set({ actions: draft.actions.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label="Action" />
                    <NumInput value={a.costUsd} min={0} onChange={(v) => set({ actions: draft.actions.map((x, j) => (j === i ? { ...x, costUsd: v } : x)) })} ariaLabel="Cost USD" />
                    <NumInput value={a.hoursBeforeImpact} min={0} max={720} onChange={(v) => set({ actions: draft.actions.map((x, j) => (j === i ? { ...x, hoursBeforeImpact: v } : x)) })} ariaLabel="Hours before impact" />
                    <button onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })} className="text-slate-500 hover:text-rose-300" aria-label="Remove action">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button onClick={() => set({ actions: [...draft.actions, { id: `a${Date.now()}`, name: "New action", owner: "", costUsd: 0, hoursBeforeImpact: 24 }] })} className="text-[12px] text-cyan-300 hover:underline">
                  + Add action
                </button>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Budget (USD)">
                <NumInput value={draft.budgetUsd} min={0} onChange={(v) => set({ budgetUsd: v })} />
              </Field>
              <Field label="Cash per household">
                <NumInput value={draft.cashPerHouseholdUsd} min={0} onChange={(v) => set({ cashPerHouseholdUsd: v })} suffix="USD" />
              </Field>
              <Field label="Households targeted">
                <NumInput value={draft.coveragePct} min={1} max={100} onChange={(v) => set({ coveragePct: v })} suffix="%" />
              </Field>
              <Field label="Delivery fee">
                <NumInput value={draft.deliveryFeePct} min={0} max={20} onChange={(v) => set({ deliveryFeePct: v })} suffix="%" />
              </Field>
            </div>
            {canWrite && (
              <div className="flex gap-2">
                <Btn className="flex-1" loading={save.isPending} onClick={() => save.mutate(draft)}>
                  <Save size={13} /> Save protocol
                </Btn>
                {draft.id && (
                  <Btn variant="outline" onClick={() => archive.mutate({ id: draft.id! })} aria-label="Archive protocol">
                    <Archive size={13} />
                  </Btn>
                )}
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="min-w-0 space-y-4">
        <ErrorBox error={bt.error} onRetry={() => bt.refetch()} />
        <Panel title={`Backtest ${b ? `${b.startYear}–${b.endYear}` : ""}`} subtitle={b ? b.metricRule : "Replaying the trigger on 30+ years of reanalysis…"} icon={History} accent="cyan" live={bt.isFetching} actions={<Select value={startYear} onChange={setStartYear} options={[1991, 1995, 2000, 2005].map((y) => ({ value: y, label: `from ${y}` }))} ariaLabel="Start year" className="w-32" />}>
          {!b ? (
            <Skeleton className="h-72" />
          ) : (
            <div className={cn("space-y-4", bt.isFetching && "opacity-60")}>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
                <Kpi label="Activations" value={b.totals.activations} sub={`${b.totals.activationsPerYear}/yr`} tone={b.totals.activationsPerYear > 2 ? "warn" : "neutral"} />
                <Kpi label="Flood events" value={b.totals.events} sub="observed" />
                <Kpi label="Hit rate" value={b.totals.hitRatePct == null ? "—" : `${b.totals.hitRatePct}%`} sub={`${b.totals.hits} caught early`} tone={(b.totals.hitRatePct ?? 0) >= 70 ? "good" : "warn"} />
                <Kpi label={<Explain term="false_alarm">False alarms</Explain>} value={b.totals.falseAlarms} sub={`${b.totals.falseAlarmRatioPct ?? "—"}% of activations`} tone={(b.totals.falseAlarmRatioPct ?? 0) > 60 ? "bad" : "neutral"} />
                <Kpi label="Missed events" value={b.totals.missed} tone={b.totals.missed ? "bad" : "good"} />
                <Kpi label="Mean lead time" value={b.totals.meanLeadDays == null ? "—" : `${b.totals.meanLeadDays} d`} sub={`target ${draft.leadTimeDays} d`} />
              </div>
              <WhatThisMeans tone={(b.totals.hitRatePct ?? 0) >= 70 && (b.totals.falseAlarmRatioPct ?? 100) <= 60 ? "emerald" : "amber"}>
                Had this protocol run since {b.startYear}, it would have activated <b className="text-white">{b.totals.activations}</b> times (about {b.totals.activationsPerYear} a year), catching <b className="text-white">{b.totals.hits}</b> of {b.totals.events} damaging floods ahead of time and missing {b.totals.missed}. {b.totals.falseAlarms} activations were not followed by a flood — each costs the early-action budget (≈ {usd(draft.actions.reduce((t, a) => t + a.costUsd, 0))} in fixed actions plus cash).{" "}
                {(b.totals.falseAlarmRatioPct ?? 0) > 60 ? "Raise the Activation threshold or the minimum number of communities to cut false alarms." : (b.totals.hitRatePct ?? 0) < 60 ? "Lower the Activation threshold or lengthen the lead time to catch more events." : "A reasonable balance for a no-regret cash protocol."}
              </WhatThisMeans>
              <div className="h-[240px]">
                <ResponsiveContainer>
                  <BarChart data={b.years} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={VIZ.grid} vertical={false} />
                    <XAxis dataKey="year" {...axisProps} minTickGap={12} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="hits" name="Hit (activated before flood)" stackId="a" fill={VIZ.s1} isAnimationActive={false} />
                    <Bar dataKey="falseAlarms" name="False alarm" stackId="a" fill={VIZ.s2} isAnimationActive={false} />
                    <Bar dataKey="missed" name="Missed flood" stackId="a" fill={VIZ.s3} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="text-[11.5px] leading-relaxed text-slate-400">
                  <div>
                    <b className="text-slate-300">Observed event:</b> {b.eventRule}.
                  </div>
                  <div>
                    <b className="text-slate-300">Trigger:</b> {b.metricRule}.
                  </div>
                  <div className="mt-1">Hit = the protocol was active in the {draft.leadTimeDays + 3} days before a flood began; false alarm = no flood within {draft.leadTimeDays + 5} days after an activation ended. Hindcasts use reanalysis as a “perfect forecast”, so real skill will be somewhat lower.</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <SourceTag>{b.providers.join(" + ")} reanalysis</SourceTag>
                    <SourceTag>GloFAS v4</SourceTag>
                    <SourceTag>{b.communities} communities · {b.cells} reference points</SourceTag>
                  </div>
                </div>
                <div className="max-h-44 overflow-auto rounded-lg bg-slate-900/50 p-2 text-[11.5px]">
                  {b.recent.map((r) => (
                    <div key={`${r.date}-${r.kind}`} className="flex gap-2 py-0.5">
                      <span className="shrink-0 whitespace-nowrap telemetry text-slate-500">{r.date}</span>
                      <span className={"shrink-0 whitespace-nowrap " + (r.kind === "hit" ? "text-sky-300" : r.kind === "missed" ? "text-emerald-300" : "text-orange-300")}>{r.kind.replace("_", " ")}</span>
                      <span className="truncate text-slate-400">{r.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Panel>
        <Panel title="Early-action plan" subtitle="Hours before expected impact" accent="cyan">
          <ol className="relative space-y-2 border-l border-slate-700 pl-4">
            {[...draft.actions].sort((a, c) => c.hoursBeforeImpact - a.hoursBeforeImpact).map((a) => (
              <li key={a.id} className="text-[12.5px]">
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-cyan-400" />
                <span className="telemetry text-cyan-300">T−{a.hoursBeforeImpact} h</span> <span className="text-slate-200">{a.name}</span>
                <span className="text-slate-500">{a.owner ? ` · ${a.owner}` : ""}{a.costUsd ? ` · ${usd(a.costUsd)}` : ""}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-slate-500">
            Cash: {usd(draft.cashPerHouseholdUsd)} to {pct(draft.coveragePct, 0)} of households in activated communities (+{draft.deliveryFeePct}% delivery), within a {usd(draft.budgetUsd)} envelope — see the Cash calculator tab.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function toDraft(p: Proto): Draft {
  return { id: p.id, name: p.name, hazard: p.hazard, metric: p.metric, readiness: p.readiness, activation: p.activation, minCommunities: p.minCommunities, leadTimeDays: p.leadTimeDays, scopeTags: p.scopeTags, actions: p.actions, budgetUsd: p.budgetUsd, cashPerHouseholdUsd: p.cashPerHouseholdUsd, coveragePct: p.coveragePct, deliveryFeePct: p.deliveryFeePct, stock: p.stock, status: p.status === "archived" ? "active" : p.status };
}
