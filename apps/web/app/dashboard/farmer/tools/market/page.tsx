"use client";

/**
 * Market prices — real WFP food-price data (HDX) for the farmer's country:
 * nearest markets with distance, local vs regional trend, seasonality,
 * a clearly-labelled "sell now or store?" heuristic and price alerts.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { ArrowDownRight, ArrowUpRight, Bell, BellRing, Loader2, MapPin, Store, Trash2, TrendingUp, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { EmptyState, HudButton, Panel, Skeleton, SourceTag } from "@/components/hud";
import { useTranslated } from "@/components/farmer/hooks";
import { CachedNote, Chip, HelpTip, ToolHeader, useOfflineSnapshot } from "@/components/farmer/tools/common";

type Data = RouterOutputs["farmer"]["marketPrices"];
type Commodity = Data["commodities"][number];

const monthLabel = (fmt: ReturnType<typeof useI18n>["fmt"], ym: string, year = true) => fmt.date(`${ym}-15T12:00:00`, year ? { month: "short", year: "numeric" } : { month: "long" });

function Change({ v }: { v: number | null }) {
  if (v == null) return <span className="text-slate-500">—</span>;
  const up = v >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold", up ? "text-emerald-300" : "text-rose-300")}>
      {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {up ? "+" : ""}
      {v}%
    </span>
  );
}

function AlertForm({ c }: { c: Commodity }) {
  const { t, tx } = useI18n();
  const utils = trpc.useUtils();
  const [dir, setDir] = useState<"above" | "below">("above");
  const [target, setTarget] = useState<number>(Math.round((c.latest?.price ?? 0) * 1.1));
  const add = trpc.farmer.setPriceAlert.useMutation({
    onSuccess: () => {
      toast.success(t("tools.mkt.alertSaved"));
      void utils.farmer.marketPrices.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (target > 0) add.mutate({ commodity: c.key, direction: dir, target, unit: c.unit });
      }}
    >
      <div className="flex rounded-xl bg-slate-900 p-1">
        {(["above", "below"] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDir(d)} className={cn("min-h-[40px] rounded-lg px-3 text-sm", dir === d ? "bg-emerald-500 font-semibold text-slate-950" : "text-slate-300")}>
            {t(d === "above" ? "tools.mkt.above" : "tools.mkt.below")}
          </button>
        ))}
      </div>
      <label className="grid gap-1 text-xs text-slate-400">
        {t("tools.mkt.targetPrice", { unit: `${c.currency}/${c.unit}` })}
        <input type="number" step="0.5" min={0} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="min-h-[44px] w-32 rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white" />
      </label>
      <HudButton type="submit" disabled={add.isPending} className="min-h-[44px]">
        {add.isPending ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />} {t("tools.mkt.addAlert", { commodity: tx(`tools.commodity.${c.key}`, undefined, c.label) })}
      </HudButton>
    </form>
  );
}

export default function MarketPage() {
  const { t, tx, fmt } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.farmer.marketPrices.useQuery(undefined, {
    staleTime: 30 * 60_000,
    refetchInterval: (query) => (query.state.data?.status === "loading" ? 8000 : false),
  });
  const snap = useOfflineSnapshot("market", q.data?.status === "ready" ? q.data : undefined);
  const data = q.data?.status === "ready" ? q.data : snap.data;
  const [sel, setSel] = useState<string | null>(null);
  const c = data?.commodities.find((x) => x.key === sel) ?? data?.commodities[0];
  const del = trpc.farmer.deletePriceAlert.useMutation({ onSuccess: () => void utils.farmer.marketPrices.invalidate() });
  const tr = useTranslated(c?.advice.reasons ?? []);
  const chart = useMemo(() => (c?.series ?? []).map((p) => ({ m: monthLabel(fmt, p.month), local: p.local, regional: p.regional })), [c, fmt]);
  const lastDate = data?.lastDate ? monthLabel(fmt, data.lastDate.slice(0, 7)) : null;
  const unitLabel = c ? `${c.currency} / ${c.unit}` : "";

  return (
    <div className="mx-auto max-w-5xl">
      <ToolHeader icon={Store} color="#fbbf24" title={t("tools.mkt.title")} subtitle={t("tools.mkt.subtitle")} />
      {snap.fromCache && q.data?.status !== "ready" && <CachedNote savedAt={snap.savedAt} />}
      {!data ? (
        q.isLoading || q.data?.status === "loading" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
              <Loader2 size={16} className="animate-spin text-amber-300" /> {t("tools.mkt.loading")}
            </div>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <EmptyState icon={Store} title={t("tools.mkt.unavailable")}>{q.data?.status === "unavailable" && q.data.error ? q.data.error : t("tools.tryAgainLater")}</EmptyState>
        )
      ) : !c ? (
        <EmptyState icon={Store} title={t("tools.mkt.noCommodities")}>{t("tools.tryAgainLater")}</EmptyState>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {t("tools.mkt.dataNote", { date: lastDate ?? "—", country: data.country })}
          </div>

          {data.missingCrops.length > 0 && <p className="text-xs text-slate-400">{t("tools.mkt.missingCrops", { crops: data.missingCrops.map((m) => tx(`crops.${m}`, undefined, m)).join(", ") })}</p>}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {data.commodities.map((x) => (
              <Chip key={x.key} active={x.key === c.key} onClick={() => setSel(x.key)} color="#fbbf24">
                {tx(`tools.commodity.${x.key}`, undefined, x.label)}
                {x.forCrops.length > 0 && <span className="text-[10px] text-emerald-300">★</span>}
              </Chip>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <motion.div key={c.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="hud-panel p-4 lg:col-span-1">
              <div className="hud-label">{c.commodity} · {c.pricetype}</div>
              {c.latest ? (
                <>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-display text-3xl font-semibold text-white">{fmt.number(c.latest.price, { maximumFractionDigits: 2 })}</span>
                    <span className="text-sm text-slate-400">{unitLabel}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    <MapPin size={11} className="mr-1 inline" />
                    {t("tools.mkt.atMarket", { market: c.latest.market, km: c.latest.distanceKm, month: monthLabel(fmt, c.latest.month) })}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-white/[0.03] p-2">
                      <div className="text-slate-500">{t("tools.mkt.change3m")}</div>
                      <Change v={c.change3mPct} />
                    </div>
                    <div className="rounded-lg bg-white/[0.03] p-2">
                      <div className="text-slate-500">{t("tools.mkt.change12m")}</div>
                      <Change v={c.change12mPct} />
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{t("tools.mkt.retailNote")}</p>
                </>
              ) : (
                <p className="text-sm text-slate-500">—</p>
              )}
            </motion.div>

            <Panel
              className="lg:col-span-2"
              title={t("tools.mkt.sellOrStore")}
              icon={c.advice.kind === "store" ? Warehouse : TrendingUp}
              accent={c.advice.kind === "store" ? "cyan" : c.advice.kind === "wait_short" ? "amber" : "emerald"}
              actions={
                <>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">{t("tools.mkt.heuristic")}</span>
                  <HelpTip title={t("tools.mkt.sellOrStore")}>{t("tools.mkt.heuristicHelp")}</HelpTip>
                </>
              }
            >
              <div className="font-display text-lg font-semibold text-white">
                {c.advice.kind === "store"
                  ? t("tools.mkt.adviceStore", { month: tx(`tools.month.${c.advice.untilMonth}`), gain: c.advice.expectedGainPct ?? 0 })
                  : c.advice.kind === "wait_short"
                    ? t("tools.mkt.adviceWait")
                    : t("tools.mkt.adviceSell")}
              </div>
              <ul className="mt-2 space-y-1 text-sm text-slate-300">
                {c.advice.reasons.map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                    {tr.get(r) ?? r}
                  </li>
                ))}
              </ul>
              {c.seasonality && (
                <div className="mt-3">
                  <div className="hud-label mb-1">{t("tools.mkt.seasonal")}</div>
                  <div className="flex h-16 items-end gap-1" role="img" aria-label={t("tools.mkt.seasonal")}>
                    {c.seasonality.map((s) => {
                      const h = Math.max(8, Math.min(100, 50 + (s.index - 1) * 400));
                      const cur = s.month === new Date().getMonth() + 1;
                      return (
                        <div key={s.month} className="flex flex-1 flex-col items-center gap-0.5" title={`${tx(`tools.month.${s.month}`)}: ${Math.round((s.index - 1) * 100)}%`}>
                          <div className={cn("w-full rounded-t", s.index >= 1 ? "bg-amber-400/70" : "bg-slate-600", cur && "ring-2 ring-white")} style={{ height: `${h}%` }} />
                          <span className={cn("text-[9px]", cur ? "text-white" : "text-slate-500")}>{tx(`tools.month.${s.month}`).slice(0, 1)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <Panel title={t("tools.mkt.trend")} subtitle={t("tools.mkt.trendHint", { unit: unitLabel })} icon={TrendingUp} accent="amber" actions={<SourceTag href={data.csvUrl ?? "https://data.humdata.org"}>WFP · HDX</SourceTag>}>
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <LineChart data={chart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="m" tick={{ fill: "#94a3b8", fontSize: 10 }} minTickGap={24} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#0b1224", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line dataKey="local" name={c.latest?.market ?? t("tools.mkt.nearest")} stroke="#fbbf24" strokeWidth={2} dot={false} connectNulls />
                  <Line dataKey="regional" name={t("tools.mkt.regional")} stroke="#64748b" strokeWidth={2} strokeDasharray="4 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("tools.mkt.nearbyMarkets")} icon={MapPin} accent="cyan">
              <ul className="divide-y divide-white/5">
                {c.nearby.map((m) => (
                  <li key={m.id} className="flex min-h-[48px] items-center gap-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white">{m.name}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {m.admin} · {monthLabel(fmt, m.month)}
                      </div>
                    </div>
                    <span className="text-xs telemetry text-slate-400">{t("tools.mkt.km", { km: m.distanceKm })}</span>
                    <span className="w-20 text-right font-semibold text-white">{fmt.number(m.price, { maximumFractionDigits: 2 })}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-slate-500">{unitLabel}</p>
            </Panel>

            <Panel title={t("tools.mkt.alerts")} subtitle={t("tools.mkt.alertsHint")} icon={BellRing} accent="violet">
              <AlertForm key={c.key} c={c} />
              <ul className="mt-3 space-y-2">
                {data.alerts.map((a) => (
                  <li key={a.id} className={cn("flex min-h-[48px] items-center gap-3 rounded-lg border px-3", a.hit ? "border-emerald-400/50 bg-emerald-500/10" : "border-white/5 bg-white/[0.02]")}>
                    {a.hit ? <BellRing size={16} className="text-emerald-300" /> : <Bell size={16} className="text-slate-500" />}
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="text-white">
                        {tx(`tools.commodity.${a.commodity}`, undefined, a.commodity)} {t(a.direction === "above" ? "tools.mkt.above" : "tools.mkt.below")} {fmt.number(a.target)} {a.unit}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {a.hit ? t("tools.mkt.alertHit", { price: fmt.number(a.lastPrice ?? 0, { maximumFractionDigits: 2 }), market: a.market ?? "" }) : a.lastPrice != null ? t("tools.mkt.alertWaiting", { price: fmt.number(a.lastPrice, { maximumFractionDigits: 2 }) }) : ""}
                      </div>
                    </div>
                    <button onClick={() => del.mutate({ id: a.id })} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:text-rose-400" aria-label={t("common.remove")}>
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
                {!data.alerts.length && <li className="text-sm text-slate-500">{t("tools.mkt.noAlerts")}</li>}
              </ul>
            </Panel>
          </div>
          <p className="text-[11px] text-slate-500">{t("tools.mkt.sourceLine", { source: data.source, fetched: data.fetchedAt ? fmt.relative(data.fetchedAt) : "—" })}</p>
        </div>
      )}
    </div>
  );
}
