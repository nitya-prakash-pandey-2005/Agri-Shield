"use client";

/**
 * Farm finance — season ledger (income / expenses / profit per field),
 * fertiliser dose → cost calculator, and the weather-index crop insurance
 * offer from Delta Mutual's live book with an enrolment request.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Calculator, CheckCircle2, Coins, Loader2, Plus, ShieldCheck, Trash2, Umbrella, Wallet } from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { EmptyState, HudButton, Meter, Panel, Skeleton, SourceTag } from "@/components/hud";
import { CropIcon } from "@/components/farmer/crops";
import { Chip, HelpTip, ToolHeader, fmtDay } from "@/components/farmer/tools/common";
import { fertiliserPlan, type ProductId } from "@/server/services/farm-finance";

type Ledger = RouterOutputs["farmer"]["ledger"];
type Tab = "ledger" | "fertiliser" | "insurance";

function Money({ v, currency, className }: { v: number; currency: string; className?: string }) {
  const { fmt } = useI18n();
  return <span className={className}>{fmt.currency(v, null, currency)}</span>;
}

function AddEntry({ data, season, onDone }: { data: Ledger; season: string; onDone: () => void }) {
  const { t, tx } = useI18n();
  const utils = trpc.useUtils();
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState<string>("seed");
  const [amount, setAmount] = useState<string>("");
  const [fieldId, setFieldId] = useState<string | null>(data.fields[0]?.id ?? null);
  const [date, setDate] = useState(today);
  const [s, setS] = useState(season);
  const [note, setNote] = useState("");
  useEffect(() => setCategory(kind === "expense" ? "seed" : "sale"), [kind]);
  const add = trpc.farmer.addLedgerEntry.useMutation({
    onSuccess: () => {
      toast.success(t("tools.fin.added"));
      void utils.farmer.ledger.invalidate();
      setAmount("");
      setNote("");
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });
  const cats = kind === "expense" ? data.categories.expense : data.categories.income;
  return (
    <form
      className="grid gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(amount);
        if (!(n > 0)) return;
        add.mutate({ season: s, fieldId, date, kind, category: category as never, amount: n, note: note || undefined });
      }}
    >
      <div className="flex rounded-xl bg-slate-900 p-1">
        {(["expense", "income"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cn("min-h-[44px] flex-1 rounded-lg text-sm", kind === k ? (k === "expense" ? "bg-rose-500 text-white" : "bg-emerald-500 text-slate-950") + " font-semibold" : "text-slate-300")}>
            {t(k === "expense" ? "tools.fin.expense" : "tools.fin.income")}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {cats.map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)} className="min-h-[40px] px-3 text-xs">
            {tx(`tools.fin.cat.${c}`)}
          </Chip>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-slate-400">
          {t("tools.fin.amount", { currency: data.currency })}
          <input inputMode="decimal" type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required className="min-h-[48px] rounded-lg border border-white/10 bg-slate-900 px-3 text-lg text-white" />
        </label>
        <label className="grid gap-1 text-xs text-slate-400">
          {t("tools.irr.date")}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="min-h-[48px] rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white" />
        </label>
        <label className="grid gap-1 text-xs text-slate-400">
          {t("tools.fin.field")}
          <select value={fieldId ?? ""} onChange={(e) => setFieldId(e.target.value || null)} className="min-h-[48px] rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white">
            {data.fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value="">{t("tools.fin.wholeFarm")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-400">
          {t("tools.fin.season")}
          <input list="season-list" value={s} onChange={(e) => setS(e.target.value)} required maxLength={40} className="min-h-[48px] rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white" />
          <datalist id="season-list">
            {data.seasonSuggestions.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t("tools.noteOptional")} className="min-h-[44px] rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white placeholder:text-slate-600" />
      <HudButton type="submit" disabled={add.isPending} className="min-h-[48px]">
        {add.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {t("tools.fin.addEntry")}
      </HudButton>
    </form>
  );
}

function LedgerTab() {
  const { t, tx, fmt } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.farmer.ledger.useQuery();
  const [season, setSeason] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const del = trpc.farmer.deleteLedgerEntry.useMutation({ onSuccess: () => void utils.farmer.ledger.invalidate() });
  if (q.isLoading) return <Skeleton className="h-72 w-full" />;
  if (!q.data) return <EmptyState icon={Wallet} title={t("common.errorLoad")} />;
  const d = q.data;
  const cur = d.summary.seasons.find((x) => x.season === season) ?? d.summary.seasons[0];
  const rows = d.entries.filter((e) => !cur || e.season === cur.season);
  const maxCat = cur ? Math.max(1, ...Object.values(cur.byCategory)) : 1;
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {d.summary.seasons.map((s) => (
          <Chip key={s.season} active={s.season === cur?.season} onClick={() => setSeason(s.season)}>
            {s.season}
          </Chip>
        ))}
        <Chip active={adding} onClick={() => setAdding((a) => !a)} color="#10b981">
          <Plus size={15} /> {t("tools.fin.addEntry")}
        </Chip>
      </div>
      {adding && <AddEntry data={d} season={cur?.season ?? d.seasonSuggestions[0] ?? ""} onDone={() => setAdding(false)} />}
      {cur ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { l: t("tools.fin.income"), v: cur.income, c: "text-emerald-300" },
              { l: t("tools.fin.expense"), v: cur.expense, c: "text-rose-300" },
              { l: t("tools.fin.profit"), v: cur.profit, c: cur.profit >= 0 ? "text-white" : "text-rose-300" },
            ].map((x) => (
              <div key={x.l} className="hud-panel p-3">
                <div className="hud-label">{x.l}</div>
                <Money v={x.v} currency={d.currency} className={cn("mt-1 block whitespace-nowrap text-[13px] font-semibold sm:text-xl", x.c)} />
              </div>
            ))}
          </div>
          {cur.income === 0 && <p className="text-xs text-slate-400">{t("tools.fin.noIncomeYet")}</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("tools.fin.perField")} icon={Coins} accent="emerald">
              <ul className="space-y-2">
                {cur.perField.map((f) => (
                  <li key={f.fieldId} className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-2">
                    <CropIcon crop={f.crop} size={18} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-white">{f.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {fmt.number(f.areaHa)} ha · {t("tools.fin.perHa")}: {f.profitPerHa != null ? fmt.currency(f.profitPerHa, null, d.currency) : "—"}
                      </div>
                    </div>
                    <Money v={f.profit} currency={d.currency} className={cn("text-sm font-semibold", f.profit >= 0 ? "text-emerald-300" : "text-rose-300")} />
                  </li>
                ))}
                {!cur.perField.length && <li className="text-sm text-slate-500">—</li>}
              </ul>
            </Panel>
            <Panel title={t("tools.fin.whereMoneyGoes")} icon={Wallet} accent="amber">
              <ul className="space-y-2">
                {Object.entries(cur.byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <li key={k}>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-300">{tx(`tools.fin.cat.${k}`)}</span>
                        <Money v={v} currency={d.currency} className="text-slate-200" />
                      </div>
                      <Meter value={(v / maxCat) * 100} color="#f59e0b" />
                    </li>
                  ))}
              </ul>
            </Panel>
          </div>
          <Panel title={t("tools.fin.entries")} icon={Wallet} accent="violet">
            <ul className="divide-y divide-white/5">
              {rows.map((e) => (
                <li key={e.id} className="flex min-h-[52px] items-center gap-3 py-1.5">
                  <span className={cn("h-8 w-1 rounded-full", e.kind === "income" ? "bg-emerald-400" : "bg-rose-400")} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">
                      {tx(`tools.fin.cat.${e.category}`)}
                      {e.sample && <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase text-slate-400">{t("tools.fin.sample")}</span>}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {fmtDay(fmt, e.date, { day: "numeric", month: "short", year: "numeric" })} · {d.fields.find((f) => f.id === e.fieldId)?.name ?? t("tools.fin.wholeFarm")}
                      {e.note ? ` · ${e.note}` : ""}
                    </div>
                  </div>
                  <Money v={e.kind === "income" ? e.amount : -e.amount} currency={d.currency} className={cn("text-sm font-semibold", e.kind === "income" ? "text-emerald-300" : "text-slate-200")} />
                  <button onClick={() => del.mutate({ id: e.id })} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:text-rose-400" aria-label={t("common.remove")}>
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
            {d.entries.some((e) => e.sample) && <p className="mt-2 text-[11px] text-slate-500">{t("tools.fin.sampleNote")}</p>}
          </Panel>
        </>
      ) : (
        <EmptyState icon={Wallet} title={t("tools.fin.empty")}>{t("tools.fin.emptyHint")}</EmptyState>
      )}
    </div>
  );
}

function FertiliserTab() {
  const { t, tx, fmt } = useI18n();
  const q = trpc.farmer.ledger.useQuery();
  const [crop, setCrop] = useState<string | null>(null);
  const [area, setArea] = useState<number | null>(null);
  const [prices, setPrices] = useState<Partial<Record<ProductId, number>>>({});
  const d = q.data;
  const f0 = d?.fields[0];
  const c = crop ?? f0?.crop ?? "rice";
  const a = area ?? f0?.areaHa ?? 1;
  const plan = useMemo(() => (d ? fertiliserPlan(c, a, { ...d.fertiliser.prices, ...prices }, d.country) : null), [c, a, prices, d]);
  if (!d || !plan) return <Skeleton className="h-72 w-full" />;
  return (
    <div className="space-y-4">
      <Panel title={t("tools.fin.calcTitle")} subtitle={t("tools.fin.calcHint")} icon={Calculator} accent="cyan" actions={<HelpTip title={t("tools.fin.calcTitle")}>{t("tools.fin.calcHelp")}</HelpTip>}>
        <div className="flex flex-wrap gap-2">
          {d.fields.map((f) => (
            <Chip key={f.id} active={c === f.crop && a === f.areaHa} onClick={() => { setCrop(f.crop); setArea(f.areaHa); }}>
              <CropIcon crop={f.crop} size={15} /> {f.name}
            </Chip>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-slate-400">
            {t("tools.fin.crop")}
            <select value={c} onChange={(e) => setCrop(e.target.value)} className="min-h-[48px] rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white">
              {d.fertiliser.crops.map((x) => (
                <option key={x} value={x}>
                  {tx(`crops.${x}`, undefined, x)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-slate-400">
            {t("tools.fin.areaHa", { ha: fmt.number(a, { maximumFractionDigits: 2 }) })}
            <input type="range" min={0.1} max={10} step={0.1} value={a} onChange={(e) => setArea(Number(e.target.value))} className="accent-emerald-500" />
            {d.country === "BD" && <span className="text-[10px] text-slate-500">{t("tools.fin.bigha", { bigha: fmt.number(a / 0.1338, { maximumFractionDigits: 1 }) })}</span>}
          </label>
        </div>
        <div className="mt-4 -mx-1 overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-[11px] text-slate-500">
              <tr>
                <th className="px-1 font-normal">{t("tools.fin.product")}</th>
                <th className="px-1 font-normal">{t("tools.fin.kgHa")}</th>
                <th className="px-1 font-normal">{t("tools.fin.totalKg")}</th>
                <th className="px-1 font-normal">{t("tools.fin.pricePerKg", { currency: d.currency })}</th>
                <th className="px-1 text-right font-normal">{t("tools.fin.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {plan.lines.map((l) => (
                <tr key={l.product} className="border-t border-white/5">
                  <td className="px-1 py-2 text-white">{tx(`tools.fin.prod.${l.product}`)}</td>
                  <td className="px-1 telemetry">{l.kgPerHa}</td>
                  <td className="px-1 telemetry">
                    {fmt.number(l.kg)} <span className="text-[10px] text-slate-500">({t("tools.fin.bags", { n: fmt.number(l.bags50) })})</span>
                  </td>
                  <td className="px-1">
                    <input type="number" min={0} step="any" value={prices[l.product] ?? l.pricePerKg} onChange={(e) => setPrices((p) => ({ ...p, [l.product]: Number(e.target.value) }))} className="min-h-[40px] w-24 rounded border border-white/10 bg-slate-900 px-2 text-sm text-white" aria-label={t("tools.fin.pricePerKg", { currency: d.currency })} />
                  </td>
                  <td className="px-1 text-right font-semibold text-white">{fmt.currency(l.cost, null, d.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-white/[0.04] p-3">
          <span className="text-sm text-slate-300">{t("tools.fin.totalCost")}</span>
          <span className="font-display text-2xl font-semibold text-white">{fmt.currency(plan.total, null, d.currency)}</span>
          <span className="w-full text-[11px] text-slate-500">
            {t("tools.fin.perHaCost", { cost: fmt.currency(plan.perHa, null, d.currency) })} · N {plan.targets.n} · P {plan.targets.p} · K {plan.targets.k} · S {plan.targets.s}
            {plan.targets.zn ? ` · Zn ${plan.targets.zn}` : ""} kg/ha
          </span>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{t("tools.fin.calcSource")}</p>
      </Panel>
    </div>
  );
}

function InsuranceTab() {
  const { t, tx, fmt } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.farmer.insuranceOffer.useQuery();
  const [picked, setPicked] = useState<string[]>([]);
  const [phone, setPhone] = useState("");
  const req = trpc.farmer.requestInsurance.useMutation({
    onSuccess: () => {
      toast.success(t("tools.ins.requested"));
      void utils.farmer.insuranceOffer.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  if (q.isLoading) return <Skeleton className="h-72 w-full" />;
  const d = q.data;
  if (!d?.book || !d.available) return <EmptyState icon={Umbrella} title={t("tools.ins.notAvailable")}>{t("tools.ins.notAvailableHint")}</EmptyState>;
  const fx = d.fx;
  const local = (usd: number | null) => (usd == null ? "—" : fx ? `${fx.currency} ${fmt.number(Math.round(usd * fx.perUsd))}` : `USD ${fmt.number(usd)}`);
  const sel = picked.length ? picked : d.fields.map((f) => f.id);
  const selFields = d.fields.filter((f) => sel.includes(f.id));
  const sum = selFields.reduce((s, f) => s + (f.sumInsuredUsd ?? 0), 0);
  const prem = selFields.reduce((s, f) => s + (f.premiumUsd ?? 0), 0);
  const requested = new Set(d.requests.filter((r) => r.status === "requested").flatMap((r) => r.fieldIds));
  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/15 to-transparent p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10">
            <Umbrella size={24} className="text-cyan-200" />
          </span>
          <div>
            <div className="hud-label text-cyan-300">{d.book.insurer}</div>
            <div className="font-display text-lg font-semibold text-white">{d.book.product}</div>
            <p className="mt-1 text-sm text-slate-300">{t("tools.ins.explain")}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-white/10 px-2 py-1 text-white">{t("tools.ins.premiumRate", { pct: fmt.number(d.book.premiumRate * 100, { maximumFractionDigits: 1 }) })}</span>
              <span className="rounded bg-white/10 px-2 py-1 text-white">{t("tools.ins.policies", { n: d.book.policies, district: d.book.policiesInDistrict })}</span>
              {d.book.season && <span className="rounded bg-white/10 px-2 py-1 text-white">{d.book.season}</span>}
            </div>
          </div>
        </div>
      </motion.div>
      {d.hasInsurance && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{t("tools.ins.alreadyInsured")}</div>}
      <Panel title={t("tools.ins.yourFields")} icon={ShieldCheck} accent="cyan" actions={<HelpTip title={t("tools.ins.basisRisk")}>{t("tools.ins.basisRiskHelp")}</HelpTip>}>
        <ul className="space-y-2">
          {d.fields.map((f) => {
            const on = sel.includes(f.id);
            return (
              <li key={f.id}>
                <button type="button" aria-pressed={on} onClick={() => setPicked((p) => (p.length ? (on ? p.filter((x) => x !== f.id) : [...p, f.id]) : d.fields.map((x) => x.id).filter((x) => x !== f.id)))} className={cn("flex min-h-[56px] w-full items-center gap-3 rounded-xl border p-2 text-left", on ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/10 bg-white/[0.02]")}>
                  <CropIcon crop={f.crop} size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white">
                      {f.name} {requested.has(f.id) && <span className="ml-1 rounded bg-amber-500/20 px-1.5 text-[10px] text-amber-200">{t("tools.ins.pending")}</span>}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {tx(`crops.${f.crop}`, undefined, f.crop)} · {fmt.number(f.areaHa)} ha · {t("tools.ins.sumInsured")}: {local(f.sumInsuredUsd)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-white">{local(f.premiumUsd)}</div>
                    <div className="text-[10px] text-slate-500">{t("tools.ins.premium")}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white/[0.04] p-3">
            <div className="hud-label">{t("tools.ins.sumInsured")}</div>
            <div className="text-lg font-semibold text-white">{local(sum)}</div>
          </div>
          <div className="rounded-lg bg-white/[0.04] p-3">
            <div className="hud-label">{t("tools.ins.premiumSeason")}</div>
            <div className="text-lg font-semibold text-cyan-200">{local(prem)}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="grid flex-1 gap-1 text-xs text-slate-400">
            {t("tools.ins.phone")}
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={30} placeholder="+880…" className="min-h-[48px] rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white placeholder:text-slate-600" />
          </label>
          <HudButton className="min-h-[48px]" disabled={req.isPending || !selFields.length || selFields.every((f) => requested.has(f.id))} onClick={() => req.mutate({ fieldIds: selFields.filter((f) => !requested.has(f.id)).map((f) => f.id), phone: phone || undefined })}>
            {req.isPending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} {t("tools.ins.request")}
          </HudButton>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{t("tools.ins.indicative")}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <SourceTag>{t("tools.ins.bookSource", { insurer: d.book.insurer })}</SourceTag>
          {fx && <SourceTag href="https://open.er-api.com">FX {fx.currency} {fmt.number(fx.perUsd, { maximumFractionDigits: 2 })}/USD</SourceTag>}
        </div>
      </Panel>
      {d.requests.length > 0 && (
        <Panel title={t("tools.ins.myRequests")} icon={CheckCircle2} accent="emerald">
          <ul className="space-y-2 text-sm">
            {d.requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] p-2">
                <span className="text-slate-200">
                  {r.crop} · {fmt.number(r.areaHa)} ha · {fmtDay(fmt, r.createdAt.toISOString().slice(0, 10), { day: "numeric", month: "short" })}
                </span>
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-200">{tx(`tools.ins.status.${r.status}`)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500">{t("tools.ins.nextSteps")}</p>
        </Panel>
      )}
    </div>
  );
}

export default function FinancePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("ledger");
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace("#", "");
      if (h === "insurance" || h === "fertiliser" || h === "ledger") setTab(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const tabs: { id: Tab; label: string; icon: typeof Wallet }[] = [
    { id: "ledger", label: t("tools.fin.tabLedger"), icon: Wallet },
    { id: "fertiliser", label: t("tools.fin.tabFertiliser"), icon: Calculator },
    { id: "insurance", label: t("tools.fin.tabInsurance"), icon: Umbrella },
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <ToolHeader icon={Wallet} color="#34d399" title={t("tools.fin.title")} subtitle={t("tools.fin.subtitle")} />
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-900/80 p-1" role="tablist">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); history.replaceState(null, "", `#${id}`); }} className={cn("flex min-h-[48px] items-center justify-center gap-1.5 rounded-lg text-[13px]", tab === id ? "bg-emerald-500 font-semibold text-slate-950" : "text-slate-300")}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === "ledger" ? <LedgerTab /> : tab === "fertiliser" ? <FertiliserTab /> : <InsuranceTab />}
    </div>
  );
}
