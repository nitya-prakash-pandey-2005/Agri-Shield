"use client";

import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertOctagon, CalendarClock, CreditCard, DollarSign, Hourglass, PieChart as PieIcon, TrendingUp, Users } from "lucide-react";
import { EmptyState, Panel, SectionHeader, Skeleton, StatTile } from "@/components/hud";
import { DataTable, ErrorNote, StatusBadge, Td, chartTooltip, fmtNum, fmtUsd } from "@/components/admin/ui";
import { trpc } from "@/lib/trpc";

const PLAN_LABEL: Record<string, string> = { free: "Free", farmer_pro: "Farmer Pro", gov_basic: "Gov Basic", gov_enterprise: "Gov Enterprise", supply_chain: "Supply Chain" };
const PLAN_COLOR: Record<string, string> = { free: "#475569", farmer_pro: "#10b981", gov_basic: "#38bdf8", gov_enterprise: "#8b5cf6", supply_chain: "#f59e0b" };
const PROVIDER_COLOR: Record<string, string> = { stripe: "#8b5cf6", razorpay: "#38bdf8", paymongo: "#10b981", none: "#475569" };

const date = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export default function AdminBillingPage() {
  const q = trpc.admin.billing.useQuery(undefined, { refetchInterval: 60_000 });
  const b = q.data;
  const paying = b ? b.byPlan.filter((p) => p.plan !== "free").reduce((n, p) => n + p.active, 0) : 0;
  const totalSubs = b ? b.byStatus.reduce((n, s) => n + s.count, 0) : 0;

  return (
    <div className="space-y-5">
      <SectionHeader eyebrow="Revenue" title="Subscriptions & billing" description="Recurring revenue across Stripe (global), Razorpay (India/UPI) and PayMongo (Philippines). Figures are computed from the live subscription ledger." />
      <ErrorNote error={q.error} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {!b ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        ) : (
          <>
            <StatTile label="MRR" value={b.mrr} prefix="$" icon={DollarSign} accent="emerald" />
            <StatTile label="ARR (run-rate)" value={b.arr} prefix="$" icon={TrendingUp} accent="violet" />
            <StatTile label="ARPA" value={b.arpa} prefix="$" decimals={2} icon={CreditCard} accent="cyan" hint="Average revenue per paying account" />
            <StatTile label="Paying accounts" value={paying} icon={Users} accent="amber" delta={`${b.pastDue.length} past due · ${b.trialing.length} trialing`} deltaGood={b.pastDue.length === 0} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel title="MRR by plan" subtitle="Active subscriptions only" icon={CreditCard} accent="violet" className="xl:col-span-2">
          {!b ? (
            <Skeleton className="h-64" />
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={b.byPlan.map((p) => ({ ...p, label: PLAN_LABEL[p.plan] ?? p.plan }))} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                    <Tooltip {...chartTooltip} formatter={(v: number) => fmtUsd(v)} />
                    <Bar dataKey="mrr" name="MRR" radius={[4, 4, 0, 0]}>
                      {b.byPlan.map((p) => (
                        <Cell key={p.plan} fill={PLAN_COLOR[p.plan] ?? "#8b5cf6"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
                {b.byPlan.map((p) => (
                  <div key={p.plan} className="rounded-lg border border-white/5 bg-slate-950/40 px-2.5 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <span className="h-2 w-2 rounded-full" style={{ background: PLAN_COLOR[p.plan] }} />
                      {PLAN_LABEL[p.plan] ?? p.plan}
                    </div>
                    <div className="telemetry text-sm text-white">{fmtUsd(p.mrr)}</div>
                    <div className="text-[10.5px] text-slate-500">
                      {p.active}/{p.total} active
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>

        <Panel title="Payment providers" subtitle="Accounts & MRR per provider" icon={PieIcon} accent="cyan">
          {!b ? (
            <Skeleton className="h-64" />
          ) : (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={b.byProvider.filter((p) => p.count > 0)} dataKey="count" nameKey="provider" innerRadius={45} outerRadius={70} paddingAngle={2} stroke="none">
                      {b.byProvider
                        .filter((p) => p.count > 0)
                        .map((p) => (
                          <Cell key={p.provider} fill={PROVIDER_COLOR[p.provider] ?? "#8b5cf6"} />
                        ))}
                    </Pie>
                    <Tooltip {...chartTooltip} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5">
                {b.byProvider.map((p) => (
                  <div key={p.provider} className="flex items-center justify-between text-[12px]">
                    <span className="flex items-center gap-2 text-slate-300 capitalize">
                      <span className="h-2 w-2 rounded-full" style={{ background: PROVIDER_COLOR[p.provider] }} />
                      {p.provider === "none" ? "No billing (free)" : p.provider}
                    </span>
                    <span className="telemetry text-slate-100">
                      {p.count} · {fmtUsd(p.mrr)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-white/5 pt-3">
                <div className="hud-label mb-2">Status breakdown</div>
                <div className="flex h-2 overflow-hidden rounded-full bg-slate-800">
                  {b.byStatus.map((s) => (
                    <div
                      key={s.status}
                      style={{ width: `${(s.count / Math.max(1, totalSubs)) * 100}%`, background: { active: "#10b981", trialing: "#38bdf8", past_due: "#f43f5e", cancelled: "#475569" }[s.status] }}
                      title={`${s.status}: ${s.count}`}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {b.byStatus.map((s) => (
                    <StatusBadge key={s.status} status={s.status} label={`${s.status.replace("_", " ")} ${s.count}`} />
                  ))}
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Past-due accounts" subtitle={b ? `${fmtUsd(b.pastDue.reduce((n, x) => n + x.atRiskMrr, 0))} MRR at risk` : undefined} icon={AlertOctagon} accent="red">
        {!b ? (
          <Skeleton className="h-32" />
        ) : b.pastDue.length === 0 ? (
          <EmptyState icon={AlertOctagon} title="No past-due accounts" />
        ) : (
          <DataTable head={["Customer", "Plan", "Provider", "At-risk MRR", "Period end", "Status"]}>
            {b.pastDue.map((x) => (
              <tr key={x.id}>
                <Td className="text-slate-100">{x.customer}</Td>
                <Td mono>{PLAN_LABEL[x.plan] ?? x.plan}</Td>
                <Td mono className="capitalize">
                  {x.provider}
                </Td>
                <Td mono className="text-rose-300">
                  {fmtUsd(x.atRiskMrr)}
                </Td>
                <Td mono>{date(x.currentPeriodEnd)}</Td>
                <Td>
                  <StatusBadge status={x.status} />
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Trials" subtitle="14-day free trial, no card required" icon={Hourglass} accent="cyan">
          {!b ? (
            <Skeleton className="h-24" />
          ) : b.trialing.length === 0 ? (
            <EmptyState icon={Hourglass} title="No active trials" />
          ) : (
            <ul className="divide-y divide-white/5">
              {b.trialing.map((x) => (
                <li key={x.id} className="flex items-center justify-between py-2 text-[12.5px]">
                  <span className="text-slate-100">{x.customer}</span>
                  <span className="telemetry text-slate-400">
                    {PLAN_LABEL[x.plan] ?? x.plan} · ends {date(x.currentPeriodEnd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Renewals in the next 7 days" subtitle={b ? `${b.renewals7d.length} paying renewal(s) · ${fmtUsd(b.renewals7d.reduce((n, x) => n + x.mrrUsd, 0))}` : undefined} icon={CalendarClock} accent="emerald">
          {!b ? (
            <Skeleton className="h-24" />
          ) : b.renewals7d.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No renewals this week" />
          ) : (
            <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto">
              {b.renewals7d
                .slice()
                .sort((a, c) => new Date(a.currentPeriodEnd).getTime() - new Date(c.currentPeriodEnd).getTime())
                .map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 py-2 text-[12.5px]">
                    <span className="text-slate-100 truncate">{x.customer}</span>
                    <span className="telemetry text-slate-400 whitespace-nowrap">
                      {fmtUsd(x.mrrUsd)} · {x.provider} · {date(x.currentPeriodEnd)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      </div>
      {b && <div className="text-[10.5px] text-slate-600 telemetry">{fmtNum(totalSubs)} subscriptions in ledger</div>}
    </div>
  );
}
