"use client";

/** Pre-arranged cash transfer + pre-positioned stock calculator. */
import { useEffect, useState } from "react";
import { Download, Package, Plus, Trash2, Wallet } from "lucide-react";
import { Panel, Skeleton, StatTile } from "@/components/hud";
import { Btn, downloadFile, ErrorBox, Field, inputCls, num, NumInput, Slider, toCsv, usd, WhatThisMeans } from "@/components/insurance/kit";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export default function CashCalc() {
  const meta = trpc.insurance.aa.meta.useQuery();
  const protos = trpc.insurance.aa.protocols.useQuery();
  const [tags, setTags] = useState<string[]>([]);
  const [coverage, setCoverage] = useState(40);
  const [cash, setCash] = useState(85);
  const [fee, setFee] = useState(1.5);
  const [budget, setBudget] = useState(1_200_000);
  const [stock, setStock] = useState([
    { item: "Water-purification tablets (strip)", perHousehold: 2, unitCostUsd: 1.2 },
    { item: "ORS sachets", perHousehold: 6, unitCostUsd: 0.15 },
    { item: "Tarpaulin", perHousehold: 0.5, unitCostUsd: 9 },
  ]);
  // start from the first protocol's parameters
  useEffect(() => {
    const p = protos.data?.[0];
    if (!p) return;
    setCoverage(p.coveragePct);
    setCash(p.cashPerHouseholdUsd);
    setFee(p.deliveryFeePct);
    setBudget(p.budgetUsd);
    setStock(p.stock);
  }, [protos.data]);
  const q = trpc.insurance.aa.cashPlan.useQuery({ scopeTags: tags, coveragePct: coverage, cashPerHouseholdUsd: cash, deliveryFeePct: fee, budgetUsd: budget, stock }, { placeholderData: (p) => p });
  const d = q.data;
  if (!meta.data) return <Skeleton className="h-[500px]" />;
  const plan = d?.plan;
  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Panel title="Transfer design" icon={Wallet} accent="cyan">
        <div className="space-y-3">
          <Field label="Communities (by tag — none = all)">
            <div className="flex flex-wrap gap-1.5">
              {meta.data.tags.map((t) => (
                <button key={t} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])} className={cn("rounded-md border px-2 py-0.5 text-[11.5px]", tags.includes(t) ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200" : "border-slate-700 text-slate-400")}>
                  {t}
                </button>
              ))}
            </div>
          </Field>
          <Slider label="Households targeted (most vulnerable)" value={coverage} min={5} max={100} onChange={setCoverage} format={(v) => `${v}%`} />
          <Slider label="Transfer per household" value={cash} min={10} max={250} step={5} onChange={setCash} format={(v) => usd(v)} hint="e.g. one month of food + emergency needs" />
          <Slider label="Delivery / mobile-money fee" value={fee} min={0} max={8} step={0.5} onChange={setFee} format={(v) => `${v}%`} />
          <Field label="Pre-arranged budget (USD)">
            <NumInput value={budget} min={0} onChange={setBudget} />
          </Field>
          <Field label="Pre-positioned stock per household">
            <div className="space-y-1.5">
              <div className="grid grid-cols-[1fr_56px_64px_22px] gap-1.5 text-[10.5px] text-slate-500">
                <span>Item</span>
                <span>Per hh</span>
                <span>Unit USD</span>
              </div>
              {stock.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_56px_64px_22px] items-center gap-1.5">
                  <input className={inputCls} value={s.item} onChange={(e) => setStock(stock.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} aria-label="Item" />
                  <NumInput value={s.perHousehold} min={0} onChange={(v) => setStock(stock.map((x, j) => (j === i ? { ...x, perHousehold: v } : x)))} ariaLabel="Per household" />
                  <NumInput value={s.unitCostUsd} min={0} onChange={(v) => setStock(stock.map((x, j) => (j === i ? { ...x, unitCostUsd: v } : x)))} ariaLabel="Unit cost" />
                  <button onClick={() => setStock(stock.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-300" aria-label="Remove item">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button onClick={() => setStock([...stock, { item: "New item", perHousehold: 1, unitCostUsd: 1 }])} className="inline-flex items-center gap-1 text-[12px] text-cyan-300 hover:underline">
                <Plus size={12} /> Add item
              </button>
            </div>
          </Field>
        </div>
      </Panel>
      <div className="min-w-0 space-y-4">
        <ErrorBox error={q.error} />
        {!plan || !d ? (
          <Skeleton className="h-80" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Households targeted" value={plan.householdsTargeted} accent="cyan" delta={`${d.communities.length} communities · ${coverage}% of ${num(d.communities.reduce((t, c) => t + c.households, 0))}`} deltaGood />
              <StatTile label="Total envelope" value={plan.totalUsd / 1e3} decimals={0} prefix="$" suffix="k" accent="amber" delta={`${usd(plan.perHouseholdUsd)} per household all-in`} deltaGood />
              <StatTile label="Funding gap" value={plan.fundingGapUsd / 1e3} decimals={0} prefix="$" suffix="k" accent={plan.fundingGapUsd ? "red" : "green"} delta={plan.fundingGapUsd ? "above the pre-arranged budget" : "fully funded"} deltaGood={!plan.fundingGapUsd} />
              <StatTile label="Budget covers" value={plan.coverageOfTargetPct} decimals={0} suffix="%" accent="violet" delta={`${num(plan.affordableHouseholds)} households`} deltaGood={plan.coverageOfTargetPct >= 100} />
            </div>
            <WhatThisMeans tone={plan.fundingGapUsd ? "amber" : "emerald"}>
              Reaching {num(plan.householdsTargeted)} households with {usd(cash)} each plus stock costs <b className="text-white">{usd(plan.totalUsd)}</b> ({usd(plan.cashUsd)} cash, {usd(plan.feesUsd)} fees, {usd(plan.stockUsd)} stock).{" "}
              {plan.fundingGapUsd ? (
                <>
                  Your {usd(budget)} pre-arranged budget covers {plan.coverageOfTargetPct}% of them — top up by <b className="text-amber-200">{usd(plan.fundingGapUsd)}</b> or prioritise the highest-risk communities.
                </>
              ) : (
                <>It fits inside your {usd(budget)} pre-arranged budget with {usd(budget - plan.totalUsd)} to spare.</>
              )}
            </WhatThisMeans>
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Pre-positioned stock" icon={Package} accent="cyan" bodyClassName="px-0 pb-2">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {plan.stockLines.map((s) => (
                      <tr key={s.item} className="border-b border-slate-800/60">
                        <td className="px-4 py-1.5 text-slate-200">{s.item}</td>
                        <td className="whitespace-nowrap py-1.5 pl-2 text-right telemetry text-slate-400">{num(s.quantity)} units</td>
                        <td className="px-4 py-1.5 text-right telemetry text-slate-200">{usd(s.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <Panel
                title="By community"
                accent="cyan"
                bodyClassName="px-0 pb-2"
                actions={
                  <Btn variant="outline" onClick={() => downloadFile("pre-arranged-cash-plan.csv", toCsv(d.communities.map((c, i) => ({ community: c.name, households: c.households, targeted: plan.perCommunity[i], cash_usd: (plan.perCommunity[i] ?? 0) * cash, total_usd: Math.round((plan.perCommunity[i] ?? 0) * plan.perHouseholdUsd) }))))}>
                    <Download size={13} /> CSV
                  </Btn>
                }
              >
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {d.communities.map((c, i) => (
                        <tr key={c.id} className="border-b border-slate-800/60">
                          <td className="px-4 py-1.5 text-slate-200">{c.name}</td>
                          <td className="whitespace-nowrap py-1.5 pl-2 text-right telemetry text-slate-400">
                            {num(plan.perCommunity[i])} / {num(c.households)} hh
                          </td>
                          <td className="px-4 py-1.5 text-right telemetry text-slate-200">{usd((plan.perCommunity[i] ?? 0) * plan.perHouseholdUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
