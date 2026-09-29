"use client";

/**
 * Parametric product designer — pick an index, thresholds, payout curve and
 * coverage window; backtest live on 35 years of ERA5 + GloFAS reanalysis at the
 * chosen location; price it; check basis risk; save and attach to insured plots.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Download, FlaskConical, MapPin, Save, Search, ShieldCheck, Target } from "lucide-react";
import { toast } from "sonner";
import { Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { trpc, type RouterInputs, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { axisProps, Btn, downloadFile, ErrorBox, Field, inputCls, Kpi, MONTHS, num, NumInput, pct, Select, Slider, toCsv, tooltipStyle, usd, VIZ, WhatThisMeans } from "./kit";
import AttachDialog from "./AttachDialog";

const LocationMap = dynamic(() => import("./LocationMap"), { ssr: false, loading: () => <Skeleton className="h-[240px]" /> });

type Spec = RouterInputs["insurance"]["backtest"]["spec"];
type Meta = RouterOutputs["insurance"]["meta"];
type Product = RouterOutputs["insurance"]["products"][number];

function useDebounced<T>(v: T, ms = 350): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

const DAYS = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
const MONTH_OPTS = MONTHS.map((m, i) => ({ value: i + 1, label: m }));

export default function Designer({ meta, editing, onEdited }: { meta: Meta; editing: Product | null; onEdited: () => void }) {
  const utils = trpc.useUtils();
  const sat = meta.districts.find((d) => d.name === "Satkhira") ?? meta.districts[0];
  const [loc, setLoc] = useState<{ lat: number; lon: number; name: string }>({ lat: sat?.lat ?? 22.7185, lon: sat?.lon ?? 89.0705, name: sat?.name ?? "Satkhira" });
  const [spec, setSpec] = useState<Spec>(meta.defaultSpec);
  const [name, setName] = useState("Aman Excess-Rain Cover — Satkhira");
  const [si, setSi] = useState(100_000);
  const [load, setLoad] = useState({ expenseLoadPct: 25, riskLoadSigma: 0.3 });
  const [startYear, setStartYear] = useState(1995);
  const [rp, setRp] = useState(5);
  const [lossYearsTxt, setLossYearsTxt] = useState("");
  const [productId, setProductId] = useState<string | undefined>(undefined);
  const [q, setQ] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);

  // load a saved product into the designer
  useEffect(() => {
    if (!editing) return;
    setProductId(editing.id);
    setSpec(editing.spec);
    setName(editing.name);
    setLoad(editing.pricing);
    setLoc({ lat: editing.reference.lat, lon: editing.reference.lon, name: editing.reference.name });
    onEdited();
  }, [editing, onEdited]);

  const lossYears = useMemo(
    () =>
      lossYearsTxt
        .split(/[,\s]+/)
        .map(Number)
        .filter((y) => y >= 1991 && y <= 2100),
    [lossYearsTxt]
  );
  const input = useDebounced({ spec, locations: [{ ...loc, sumInsuredUsd: si }], load, startYear, proxyReturnPeriod: rp, lossYears: lossYears.length ? lossYears : undefined });
  const bt = trpc.insurance.backtest.useQuery(input, { placeholderData: (p) => p, retry: 1, staleTime: 10 * 60_000 });
  const geo = trpc.insurance.geocode.useQuery({ q }, { enabled: q.length >= 3 });
  const save = trpc.insurance.saveProduct.useMutation({
    onSuccess: (p) => {
      setProductId(p.id);
      utils.insurance.products.invalidate();
      toast.success(`Saved “${p.name}”`, { description: p.status === "active" ? "Active — attach it to insured units to monitor live triggers." : "Saved as draft." });
    },
    onError: (e) => toast.error("Could not save", { description: e.message }),
  });

  const im = meta.indexTypes.find((t) => t.value === spec.indexType)!;
  const r = bt.data?.results[0];
  const pr = r?.pricing;
  const set = (p: Partial<Spec>) => setSpec((s) => ({ ...s, ...p }));
  const setSeason = (p: Partial<Spec["season"]>) => setSpec((s) => ({ ...s, season: { ...s.season, ...p } }));

  const changeIndex = (t: Spec["indexType"]) => {
    const defaults: Record<string, Partial<Spec>> = {
      rain_max_nday: { trigger: 150, exit: 350, windowDays: 5 },
      rain_total: { trigger: 800, exit: 400 },
      discharge_max: { trigger: r?.dischargeStats?.p95 ?? 500, exit: Math.round((r?.dischargeStats?.p99 ?? 800) * 1.4) },
      dry_spell: { trigger: 15, exit: 35 },
      heat_days: { trigger: 5, exit: 20, heatThresholdC: 35 },
    };
    setSpec((s) => ({ ...s, indexType: t, ...defaults[t] }));
  };

  const local = spec.calibration?.mode === "local";
  // thresholds actually applied at this location (local calibration resolves per location)
  const applied = local && r ? r.applied : { trigger: spec.trigger, exit: spec.exit };
  const eff = { ...spec, ...applied };
  const sliderMax = Math.max(10, Math.ceil(((r?.indexStats.max ?? spec.exit) * 1.4) / 10) * 10, applied.exit, applied.trigger);
  const yearsData = (r?.years ?? []).map((y) => ({ ...y, payoutPct: y.payoutFraction * 100, paid: y.payoutFraction > 0 }));
  const curve = useMemo(() => {
    const out: { x: number; payout: number }[] = [];
    const hi = sliderMax;
    for (let i = 0; i <= 60; i++) {
      const x = (hi * i) / 60;
      out.push({ x: Math.round(x * 10) / 10, payout: payoutPct(eff, x) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, sliderMax, applied.trigger, applied.exit]);

  const b = r?.basis;
  const unit = im.unit;
  const describe = () =>
    local && spec.calibration
      ? `${im.short} (${bt.data?.seasonLabel}) reaching the location's own 1-in-${spec.calibration.triggerRp}-season level; full payout at its 1-in-${spec.calibration.exitRp} level (at ${loc.name}: ${num(applied.trigger, 1)} → ${num(applied.exit, 1)} ${unit}).`
      : `${im.short} ${im.direction === "above" ? "≥" : "≤"} ${spec.trigger} ${unit} (${bt.data?.seasonLabel}); full payout at ${spec.exit} ${unit}.`;
  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      {/* ── Controls ── */}
      <div className="space-y-4">
        <Panel title="1 · Where" icon={MapPin} accent="cyan" subtitle="Click the map, search any place, or pick an insured district">
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <Select
                ariaLabel="Insured district"
                value={meta.districts.find((d) => Math.abs(d.lat - loc.lat) < 1e-4 && Math.abs(d.lon - loc.lon) < 1e-4)?.id ?? ""}
                onChange={(id) => {
                  const d = meta.districts.find((x) => x.id === id);
                  if (d) setLoc({ lat: d.lat, lon: d.lon, name: d.name });
                }}
                options={[{ value: "", label: "District…" }, ...meta.districts.map((d) => ({ value: d.id, label: `${d.name}${d.plots ? ` · ${d.plots} units` : ""}` }))]}
              />
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input className={cn(inputCls, "pl-7")} placeholder="Search place" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search place" />
                {q.length >= 3 && !!geo.data?.length && (
                  <div className="absolute z-[600] mt-1 w-64 overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-xl">
                    {geo.data.map((g) => (
                      <button key={`${g.latitude},${g.longitude}`} className="block w-full px-3 py-1.5 text-left text-[12.5px] text-slate-200 hover:bg-cyan-400/10" onClick={() => (setLoc({ lat: g.latitude, lon: g.longitude, name: g.name }), setQ(""))}>
                        {g.name}
                        <span className="text-slate-500"> · {[g.admin1, g.country].filter(Boolean).join(", ")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <LocationMap point={loc} onPick={(lat, lon) => setLoc({ lat, lon, name: `${lat.toFixed(3)}, ${lon.toFixed(3)}` })} height={210} zoom={8} />
            <div className="flex items-center justify-between text-[11.5px] text-slate-400">
              <span className="truncate">
                <b className="text-slate-200">{loc.name}</b> · {loc.lat.toFixed(3)}, {loc.lon.toFixed(3)}
              </span>
              {r?.cells.era5 && <span className="telemetry text-slate-500">ERA5 cell {r.cells.era5.lat.toFixed(2)},{r.cells.era5.lon.toFixed(2)}</span>}
            </div>
          </div>
        </Panel>

        <Panel title="2 · Index & payout" icon={Target} accent="cyan">
          <div className="space-y-3">
            <Field label="Product name">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
              label={
                <>
                  Index <Explain text={im.explain} title={im.short} />
                </>
              }
            >
              <Select value={spec.indexType} onChange={changeIndex} options={meta.indexTypes.map((t) => ({ value: t.value, label: t.label }))} />
            </Field>
            {spec.indexType === "rain_max_nday" && <Slider label="Rolling window N (days)" value={spec.windowDays} min={1} max={30} onChange={(v) => set({ windowDays: v })} format={(v) => `${v} d`} />}
            {spec.indexType === "dry_spell" && <Slider label="Dry day = rain below" value={spec.dryDayMm} min={0.5} max={10} step={0.5} onChange={(v) => set({ dryDayMm: v })} format={(v) => `${v} mm`} />}
            {spec.indexType === "heat_days" && <Slider label="Heat threshold (Tmax ≥)" value={spec.heatThresholdC} min={30} max={45} step={0.5} onChange={(v) => set({ heatThresholdC: v })} format={(v) => `${v} °C`} />}
            <Field label="Coverage window (season)">
              <div className="grid grid-cols-4 gap-1.5">
                <Select ariaLabel="Start day" value={spec.season.startDay} onChange={(v) => setSeason({ startDay: v })} options={DAYS} />
                <Select ariaLabel="Start month" value={spec.season.startMonth} onChange={(v) => setSeason({ startMonth: v })} options={MONTH_OPTS} />
                <Select ariaLabel="End day" value={spec.season.endDay} onChange={(v) => setSeason({ endDay: v })} options={DAYS} />
                <Select ariaLabel="End month" value={spec.season.endMonth} onChange={(v) => setSeason({ endMonth: v })} options={MONTH_OPTS} />
              </div>
            </Field>
            <div className="flex rounded-lg border border-slate-700/80 p-0.5 text-[12px]" role="tablist" aria-label="Threshold mode">
              {(["absolute", "local"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={(spec.calibration?.mode ?? "absolute") === m}
                  onClick={() => set({ calibration: m === "local" ? { mode: "local", triggerRp: spec.calibration?.triggerRp ?? 5, exitRp: spec.calibration?.exitRp ?? 30 } : undefined })}
                  className={cn("flex-1 rounded-md px-2 py-1", (spec.calibration?.mode ?? "absolute") === m ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:text-white")}
                >
                  {m === "absolute" ? "Fixed thresholds" : "Local return periods"}
                </button>
              ))}
            </div>
            {local && spec.calibration && (
              <>
                <Slider label={<>Trigger at the local 1-in-N season <Explain term="return_period" /></>} value={spec.calibration.triggerRp} min={2} max={25} onChange={(v) => set({ calibration: { ...spec.calibration!, triggerRp: v } })} format={(v) => `1-in-${v}`} hint={r ? `= ${num(applied.trigger, 1)} ${unit} at ${loc.name}` : undefined} />
                <Slider label="Full payout at the local 1-in-N season" value={spec.calibration.exitRp} min={3} max={100} onChange={(v) => set({ calibration: { ...spec.calibration!, exitRp: v } })} format={(v) => `1-in-${v}`} hint={r ? `= ${num(applied.exit, 1)} ${unit} — each insured area gets thresholds from its own climate` : undefined} />
              </>
            )}
            {!local && (<>
            <Slider
              label={
                <>
                  Trigger <Explain term="trigger" />
                </>
              }
              value={spec.trigger}
              min={0}
              max={sliderMax}
              step={spec.indexType === "dry_spell" || spec.indexType === "heat_days" ? 1 : 5}
              onChange={(v) => set({ trigger: v })}
              format={(v) => `${num(v)} ${unit}`}
              hint={im.direction === "above" ? "Payout starts when the index reaches this value" : "Payout starts when the index falls to this value"}
            />
            <Slider label="Exit (full payout)" value={spec.exit} min={0} max={sliderMax} step={spec.indexType === "dry_spell" || spec.indexType === "heat_days" ? 1 : 5} onChange={(v) => set({ exit: v })} format={(v) => `${num(v)} ${unit}`} />
            </>)}
            <div className="grid grid-cols-2 gap-3">
              <Slider label="Payout at trigger" value={spec.entryPayoutPct} min={0} max={50} onChange={(v) => set({ entryPayoutPct: v })} format={(v) => `${v}%`} />
              <Slider label="Maximum payout" value={spec.maxPayoutPct} min={10} max={100} step={5} onChange={(v) => set({ maxPayoutPct: v })} format={(v) => `${v}%`} />
            </div>
            <div className="h-[110px]">
              <ResponsiveContainer>
                <ComposedChart data={curve} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="x" type="number" domain={[0, sliderMax]} {...axisProps} tickFormatter={(v) => num(v)} />
                  <YAxis {...axisProps} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v.toFixed(1)}% of sum insured`, "Payout"]} labelFormatter={(l) => `Index ${num(Number(l))} ${unit}`} />
                  <Line dataKey="payout" stroke={VIZ.s1} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Scatter data={yearsData.filter((y) => y.index != null).map((y) => ({ x: y.index, payout: y.payoutPct, year: y.year }))} dataKey="payout" fill={VIZ.s2} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[11px] text-slate-500">Payout curve (blue) with each historical season plotted (orange dots).</div>
          </div>
        </Panel>

        <Panel title="3 · Pricing assumptions" icon={ShieldCheck} accent="cyan">
          <div className="space-y-3">
            <Field label={<>Sum insured (USD) <Explain term="sum_insured" /></>}>
              <NumInput value={si} onChange={setSi} min={100} max={1e9} suffix="USD" />
            </Field>
            <Slider label="Expense & commission load" value={load.expenseLoadPct} min={0} max={45} onChange={(v) => setLoad((l) => ({ ...l, expenseLoadPct: v }))} format={(v) => `${v}%`} />
            <Slider label={<>Risk margin (λ × σ) <Explain text="A capital charge for volatility: the premium adds λ times the standard deviation of annual payouts. 0.2–0.5 is typical for index covers." /></>} value={load.riskLoadSigma} min={0} max={1} step={0.05} onChange={(v) => setLoad((l) => ({ ...l, riskLoadSigma: v }))} format={(v) => v.toFixed(2)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Backtest from">
                <Select value={startYear} onChange={setStartYear} options={[1991, 1995, 2000, 2005].map((y) => ({ value: y, label: String(y) }))} />
              </Field>
              <Field label={<>Damage proxy <Explain term="basis_risk" /></>}>
                <Select value={rp} onChange={setRp} options={[3, 5, 10].map((v) => ({ value: v, label: `Worst 1-in-${v} yrs` }))} />
              </Field>
            </div>
            <Field label="Known loss years (optional)" hint="From your claims history — overrides the damage proxy in the basis-risk check">
              <input className={inputCls} placeholder="e.g. 2007, 2011, 2017" value={lossYearsTxt} onChange={(e) => setLossYearsTxt(e.target.value)} />
            </Field>
          </div>
        </Panel>
      </div>

      {/* ── Results ── */}
      <div className="min-w-0 space-y-4">
        <ErrorBox error={bt.error} onRetry={() => bt.refetch()} />
        <Panel
          title={`Backtest · ${r ? `${r.years[0]?.year}–${r.years[r.years.length - 1]?.year}` : "…"} at ${loc.name}`}
          subtitle={bt.data ? `${bt.data.meta.short} · ${bt.data.seasonLabel} · trigger ${num(applied.trigger, 1)} ${unit} → exit ${num(applied.exit, 1)} ${unit}${local ? " (local 1-in-" + spec.calibration!.triggerRp + " → 1-in-" + spec.calibration!.exitRp + ")" : ""}` : "Fetching 35 years of daily reanalysis…"}
          icon={FlaskConical}
          accent="cyan"
          live={bt.isFetching}
          actions={
            <div className="flex flex-wrap gap-1.5">
              <Btn
                variant="outline"
                disabled={!r}
                onClick={() => r && downloadFile(`backtest-${loc.name.replace(/\W+/g, "-")}.csv`, toCsv(r.years.map((y) => ({ season: y.year, index: y.index, unit, payout_pct: (y.payoutFraction * 100).toFixed(2), payout_usd: y.payoutUsd, loss_ratio_pct: y.lossRatioPct, damage_proxy: y.proxy, proxy_event: y.proxyEvent }))))}
              >
                <Download size={13} /> CSV
              </Btn>
              <Btn variant="outline" disabled={!pr || save.isPending} onClick={() => pr && save.mutate({ id: productId, name, description: describe(), spec, status: "draft", pricing: load, reference: loc, lastBacktest: { years: pr.years, frequencyPct: pr.frequencyPct, burningCostPct: pr.burningCostPct, premiumRatePct: pr.premiumRatePct } })}>
                <Save size={13} /> Save draft
              </Btn>
              <Btn loading={save.isPending} disabled={!pr} onClick={() => pr && save.mutate({ id: productId, name, description: describe(), spec, status: "active", pricing: load, reference: loc, lastBacktest: { years: pr.years, frequencyPct: pr.frequencyPct, burningCostPct: pr.burningCostPct, premiumRatePct: pr.premiumRatePct } }, { onSuccess: () => setAttachOpen(true) })}>
                <ShieldCheck size={13} /> Save & attach
              </Btn>
            </div>
          }
        >
          {!pr ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[68px]" />)}</div>
          ) : (
            <div className={cn("space-y-4 transition-opacity", bt.isFetching && "opacity-60")}>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
                <Kpi label="Payout frequency" value={`${pr.payoutYears}/${pr.years} yrs`} sub={`${pct(pr.frequencyPct, 0)} of seasons`} tone={pr.frequencyPct > 40 ? "warn" : "neutral"} />
                <Kpi label={<>Burning cost</>} help={<Explain term="burning_cost" />} value={pct(pr.burningCostPct, 2)} sub={`${usd(pr.purePremiumUsd)} / yr pure premium`} />
                <Kpi label="Loaded premium" help={<Explain term="premium_rate" />} value={usd(pr.loadedPremiumUsd)} sub={`rate ${pct(pr.premiumRatePct, 2)} of SI`} />
                <Kpi label="Expected loss ratio" help={<Explain term="loss_ratio" />} value={pct(pr.expectedLossRatioPct, 0)} sub={`σ ${pct(pr.stdevPct, 1)} · risk load ${usd(pr.riskLoadUsd)}`} tone={pr.expectedLossRatioPct > 75 ? "bad" : "good"} />
                <Kpi label="Worst year" value={pr.worstYear ? `${pr.worstYear.year}` : "none"} sub={pr.worstYear ? `${pct(pr.worstYear.payoutPct, 0)} payout · ${usd((pr.worstYear.payoutPct / 100) * si)}` : "no payouts"} tone={pr.worstYear && pr.worstYear.payoutPct >= 50 ? "warn" : "neutral"} />
                <Kpi label="1-in-10 / 1-in-20" help={<Explain term="return_period" />} value={`${pct(pr.oneIn10Pct, 0)} / ${pct(pr.oneIn20Pct, 0)}`} sub="payout of SI (empirical)" />
              </div>

              <WhatThisMeans>
                Over the last <b className="text-white">{pr.years} seasons</b> this cover would have paid in <b className="text-white">{pr.payoutYears}</b> of them — on average{" "}
                <b className="text-white">{usd(pr.purePremiumUsd)}</b> a year on {usd(si)} insured (burning cost {pct(pr.burningCostPct, 1)}). Charging {usd(pr.loadedPremiumUsd)} ({pct(pr.premiumRatePct, 1)}) covers expenses and volatility, leaving an expected loss ratio of {pct(pr.expectedLossRatioPct, 0)}.{" "}
                {pr.frequencyPct > 40 ? "It pays very often — consider raising the trigger to target genuinely damaging seasons and lower the premium." : pr.payoutYears === 0 ? "It never paid in the record — the trigger is probably too extreme to be valuable to farmers." : "Payout frequency is in the usual range for catastrophe-style index covers (1-in-3 to 1-in-10 years)."}{" "}
                {b && b.falseNegatives.length > 0 && (
                  <>
                    Basis risk: in <b className="text-rose-300">{b.falseNegatives.join(", ")}</b> the damage proxy shows a bad season but the index did not pay.
                  </>
                )}
              </WhatThisMeans>

              <div className="grid gap-4 2xl:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[12px] text-slate-400">
                    <span>Index value by season ({unit})</span>
                    <span className="flex items-center gap-3 text-[11px]">
                      <Legend color={VIZ.s1} label="paid" />
                      <Legend color="#475569" label="no payout" />
                      <Legend color={VIZ.s2} label="trigger / exit" line />
                    </span>
                  </div>
                  <div className="h-[220px]">
                    <ResponsiveContainer>
                      <BarChart data={yearsData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid stroke={VIZ.grid} vertical={false} />
                        <XAxis dataKey="year" {...axisProps} interval="preserveStartEnd" minTickGap={14} />
                        <YAxis {...axisProps} tickFormatter={(v) => num(v)} />
                        <Tooltip {...tooltipStyle} formatter={(v: number, _n, p) => [`${num(v, 1)} ${unit}${p.payload.paid ? ` → pays ${p.payload.payoutPct.toFixed(1)}%` : ""}`, "Index"]} />
                        <ReferenceLine y={applied.trigger} stroke={VIZ.s2} strokeDasharray="4 3" />
                        <ReferenceLine y={applied.exit} stroke={VIZ.s2} strokeDasharray="1 3" />
                        <Bar dataKey="index" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                          {yearsData.map((y) => (
                            <Cell key={y.year} fill={y.paid ? VIZ.s1 : "#475569"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[12px] text-slate-400">
                    <span>Payout by season (USD)</span>
                    <span className="flex items-center gap-3 text-[11px]">
                      <Legend color={VIZ.s1} label="payout" />
                      <Legend color={VIZ.critical} label="damage-proxy year" />
                    </span>
                  </div>
                  <div className="h-[220px]">
                    <ResponsiveContainer>
                      <BarChart data={yearsData} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                        <CartesianGrid stroke={VIZ.grid} vertical={false} />
                        <XAxis dataKey="year" {...axisProps} interval="preserveStartEnd" minTickGap={14} />
                        <YAxis {...axisProps} tickFormatter={(v) => usd(v, 0)} />
                        <Tooltip {...tooltipStyle} formatter={(v: number, _n, p) => [`${usd(v)}${p.payload.proxyEvent ? " · damage proxy: bad season" : ""}`, "Payout"]} />
                        <Bar dataKey="payoutUsd" radius={[4, 4, 0, 0]} isAnimationActive={false} minPointSize={2}>
                          {yearsData.map((y) => (
                            <Cell key={y.year} fill={y.proxyEvent ? (y.paid ? VIZ.s1 : VIZ.critical) : y.paid ? VIZ.s1 : "#334155"} stroke={y.proxyEvent ? VIZ.critical : "none"} strokeWidth={y.proxyEvent ? 1.5 : 0} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[11px] text-slate-500">Red outline = a damaging season according to the independent proxy; a red stub with no payout is a missed loss.</div>
                </div>
              </div>

              {b && r && (
                <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1 text-[13px] font-medium text-slate-200">
                        Basis-risk check <Explain term="basis_risk" />
                      </span>
                      <span className={cn("rounded-md px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider", b.verdict === "low" ? "bg-emerald-500/15 text-emerald-300" : b.verdict === "moderate" ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300")}>{b.verdict} basis risk</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-center text-[12px]">
                      <Cell2 label="Paid & damaging (hit)" v={b.hits.length} tone="good" />
                      <Cell2 label="Damaging, not paid (miss)" v={b.falseNegatives.length} tone="bad" />
                      <Cell2 label="Paid, not damaging" v={b.falsePositives.length} tone="warn" />
                      <Cell2 label="Quiet & no payout" v={b.correctNegatives} tone="neutral" />
                    </div>
                    <div className="mt-2 space-y-0.5 text-[11.5px] text-slate-400">
                      <div>
                        Detection of damaging seasons: <b className="text-slate-200">{b.detectionPct == null ? "—" : `${b.detectionPct}%`}</b> · mismatch rate <b className="text-slate-200">{b.basisRiskPct}%</b> · rank agreement ρ = <b className="text-slate-200">{b.spearman ?? "—"}</b>
                      </div>
                      <div>Proxy: {r.proxy.rule}.</div>
                      {b.falseNegatives.length > 0 && <div className="text-rose-300">Missed: {b.falseNegatives.join(", ")}</div>}
                      {b.falsePositives.length > 0 && <div className="text-amber-300">Paid without proxy damage: {b.falsePositives.join(", ")}</div>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 text-[12px] text-slate-400">
                    <div className="mb-1.5 text-[13px] font-medium text-slate-200">Index distribution & method</div>
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      {(
                        [
                          ["Median", r.indexStats.p50],
                          ["1-in-5 (P80)", r.indexStats.p80],
                          ["1-in-10 (P90)", r.indexStats.p90],
                        ] as const
                      ).map(([l, v]) => (
                        <div key={l} className="rounded-lg bg-slate-900/60 px-2 py-1.5">
                          <div className="text-[10.5px] text-slate-500">{l}</div>
                          <div className="telemetry text-slate-100">
                            {num(v, 0)} <span className="text-[10px] text-slate-500">{unit}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {r.dischargeStats && (
                      <div className="mt-1.5">
                        GloFAS daily flow here: median {num(r.dischargeStats.p50, 1)} · P95 {num(r.dischargeStats.p95, 1)} · P99 {num(r.dischargeStats.p99, 1)} m³/s
                      </div>
                    )}
                    <p className="mt-2 leading-relaxed">
                      Each season the index is computed from daily reanalysis; payout = linear from {spec.entryPayoutPct}% at the trigger to {spec.maxPayoutPct}% at the exit. Pure premium = burning cost × SI; loaded premium = (burning cost + λσ) ÷ (1 − expense load).
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <SourceTag href="https://open-meteo.com/en/docs/historical-weather-api">{r.provider === "NASA POWER" ? "NASA POWER (MERRA-2)" : "ERA5 · Open-Meteo"}</SourceTag>
                      <SourceTag href="https://open-meteo.com/en/docs/flood-api">GloFAS v4</SourceTag>
                      <SourceTag>{r.dataSource}</SourceTag>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
      <AttachDialog open={attachOpen} onClose={() => setAttachOpen(false)} productId={productId ?? null} productName={name} />
    </div>
  );
}

function payoutPct(spec: Spec, x: number): number {
  const above = spec.indexType !== "rain_total";
  const cap = spec.maxPayoutPct;
  const entry = Math.min(spec.entryPayoutPct, cap);
  if (above) {
    if (x < spec.trigger) return 0;
    if (spec.exit <= spec.trigger || x >= spec.exit) return cap;
    return entry + ((cap - entry) * (x - spec.trigger)) / (spec.exit - spec.trigger);
  }
  if (x > spec.trigger) return 0;
  if (spec.exit >= spec.trigger || x <= spec.exit) return cap;
  return entry + ((cap - entry) * (spec.trigger - x)) / (spec.trigger - spec.exit);
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-slate-400">
      <span className={line ? "h-0.5 w-3" : "h-2 w-2 rounded-sm"} style={{ background: color }} />
      {label}
    </span>
  );
}

function Cell2({ label, v, tone }: { label: string; v: number; tone: "good" | "bad" | "warn" | "neutral" }) {
  const c = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : tone === "warn" ? "text-amber-300" : "text-slate-300";
  return (
    <div className="rounded-lg bg-slate-900/60 px-2 py-2">
      <div className={cn("telemetry text-lg font-semibold", c)}>{v}</div>
      <div className="text-[10.5px] text-slate-500">{label}</div>
    </div>
  );
}
