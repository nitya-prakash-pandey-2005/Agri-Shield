"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, CreditCard, Download, ExternalLink, Gauge, Loader2, Receipt, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, Meter, Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, Field, Modal, inputCls } from "@/components/workspace/ui";
import { cn } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("en-US");
const METER_TERM: Record<string, string | undefined> = { apiCalls: "api_key", assets: "asset" };

async function invoicePdf(inv: { id: string; period: string; issuedAt: string | Date; plan: string; amountUsd: number; status: string; note: string }, org: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFillColor(8, 16, 34);
  doc.rect(0, 0, 595, 90, "F");
  doc.setTextColor(56, 189, 248);
  doc.setFontSize(20);
  doc.text("Agri-SHIELD", 40, 50);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text("INVOICE", 480, 50);
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  const rows: [string, string][] = [
    ["Invoice", inv.id],
    ["Billed to", org],
    ["Period", inv.period],
    ["Issued", new Date(inv.issuedAt).toISOString().slice(0, 10)],
    ["Plan", inv.plan],
    ["Description", inv.note],
    ["Status", inv.status.toUpperCase()],
  ];
  rows.forEach(([k, v], i) => {
    doc.setTextColor(100, 116, 139);
    doc.text(k, 40, 140 + i * 22);
    doc.setTextColor(15, 23, 42);
    doc.text(v, 160, 140 + i * 22);
  });
  doc.setDrawColor(203, 213, 225);
  doc.line(40, 310, 555, 310);
  doc.setFontSize(14);
  doc.text(`Total  USD ${inv.amountUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, 40, 340);
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text("Derived from your workspace subscription history. Sandbox billing — no card was charged unless a payment provider is configured.", 40, 780, { maxWidth: 515 });
  doc.save(`${inv.id}.pdf`);
}

export default function BillingSettings() {
  const utils = trpc.useUtils();
  const q = trpc.workspace.billing.useQuery();
  const me = trpc.workspace.me.useQuery();
  const change = trpc.workspace.changePlan.useMutation();
  const [checkout, setCheckout] = useState<null | "enterprise" | "free">(null);
  const [msg, setMsg] = useState("");

  const d = q.data;
  if (!d) return <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>;

  const confirm = async () => {
    if (!checkout) return;
    try {
      const r = await change.mutateAsync({ plan: checkout, message: msg || undefined });
      toast.success(r.kind === "requested" ? "Request sent — we'll reply within one business day" : "You're on the Free plan now");
      setCheckout(null);
      await Promise.all([utils.workspace.billing.invalidate(), utils.workspace.me.invalidate(), utils.workspace.team.invalidate()]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const sub = d.subscription;
  const trial = d.trial;
  const orgName = me.data?.org?.name ?? "Workspace";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Current plan" icon={CreditCard} accent="cyan">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold text-white">{d.usage.planLabel}</span>
            {sub && <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-medium capitalize", sub.status === "active" ? "bg-emerald-500/10 text-emerald-300" : sub.status === "trialing" ? "bg-cyan-500/10 text-cyan-300" : "bg-amber-500/10 text-amber-300")}>{sub.status}</span>}
          </div>
          <div className="mt-2 space-y-1 text-[12.5px] text-slate-400">
            {trial.trialing && trial.endsAt && (
              <div className="text-cyan-300">
                <Sparkles size={12} className="mr-1 inline" />
                Trial ends {new Date(trial.endsAt).toISOString().slice(0, 10)} ({trial.daysLeft} days left). No card needed until then.
              </div>
            )}
            {trial.expired && <div className="text-amber-300">Your trial has ended — Free plan limits now apply.</div>}
            {sub && (
              <div>
                {sub.mrrUsd ? `USD ${fmt(sub.mrrUsd)} / month · ` : ""}renews {new Date(sub.currentPeriodEnd).toISOString().slice(0, 10)} · via {sub.provider === "none" ? "sandbox" : sub.provider}
              </div>
            )}
            <div>
              Usage period {new Date(d.usage.periodStart).toISOString().slice(0, 10)} → {new Date(d.usage.periodEnd).toISOString().slice(0, 10)}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/pricing" className="inline-flex items-center gap-1 text-[12px] text-cyan-300 hover:underline">
              Compare all plans <ExternalLink size={11} />
            </Link>
          </div>
        </Panel>

        <Panel title="Usage this month" subtitle="Resets on the 1st (UTC)" icon={Gauge} accent="emerald" className="lg:col-span-2">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {d.usage.meters.map((m) => {
              const warn = m.limit !== null && m.pct >= 80;
              return (
                <div key={m.kind}>
                  <div className="flex items-baseline justify-between text-[12.5px]">
                    <span className="flex items-center gap-1 text-slate-300">
                      {m.label} {METER_TERM[m.kind] && <Explain term={METER_TERM[m.kind]} />}
                    </span>
                    <span className="telemetry text-slate-400">
                      <span className={cn("font-semibold", warn ? "text-amber-300" : "text-white")}>{fmt(m.used)}</span> / {m.limit === null ? "∞" : fmt(m.limit)}
                    </span>
                  </div>
                  <Meter value={m.limit === null ? 2 : m.pct} color={!m.ok ? "#f87171" : warn ? "#fbbf24" : "#38bdf8"} className="mt-1" />
                </div>
              );
            })}
          </div>
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="hud-label">Daily activity</span>
              <SourceTag>metered since last server restart</SourceTag>
            </div>
            {d.daily.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-500">No metered activity recorded since the last restart yet — generate a report or run an assessment and it appears here.</div>
            ) : (
              <div className="h-36">
                <ResponsiveContainer>
                  <BarChart data={d.daily}>
                    <CartesianGrid stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 10 }} width={30} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#0b1224", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="assessments" stackId="a" fill="#38bdf8" name="Assessments" />
                    <Bar dataKey="reports" stackId="a" fill="#10b981" name="Reports" />
                    <Bar dataKey="messages" stackId="a" fill="#fbbf24" name="Messages" />
                    <Bar dataKey="apiCalls" stackId="a" fill="#a78bfa" name="API calls" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {d.plans.map((p) => (
          <div key={p.id} className={cn("hud-panel flex flex-col p-5", p.current && "ring-1 ring-cyan-400/50")}>
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-semibold text-white">{p.name}</span>
              {p.current && <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10.5px] font-medium text-cyan-300">Current</span>}
            </div>
            <div className="mt-1 text-2xl font-semibold text-white telemetry">{p.priceUsd === null ? (p.fromUsd ? `From $${fmt(p.fromUsd)}` : "Custom") : p.priceUsd === 0 ? "$0" : `$${fmt(p.priceUsd)}`}<span className="text-xs font-normal text-slate-500">{p.priceUsd || p.fromUsd ? " / month" : ""}</span></div>
            <p className="mt-1 text-[12.5px] text-slate-400">{p.blurb}</p>
            <ul className="mt-3 flex-1 space-y-1.5">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2 text-[12.5px] text-slate-300">
                  <Check size={13} className="mt-0.5 shrink-0 text-emerald-400" /> {f}
                </li>
              ))}
            </ul>
            {d.canManage && p.id === "business" && (!p.current || trial.trialing || trial.expired) && (
              <Link href="/pricing/checkout?plan=business&interval=month&currency=USD" className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-2 text-[13px] font-medium text-slate-950 hover:bg-cyan-300">
                <CreditCard size={14} /> {p.current ? "Add payment & keep Business" : "Upgrade to Business"}
              </Link>
            )}
            {d.canManage && !p.current && p.id !== "business" && (
              <Btn variant={p.id === "free" ? "outline" : "primary"} className="mt-4 w-full" onClick={() => setCheckout(p.id as "free" | "enterprise")}>
                {p.id === "enterprise" ? "Talk to sales" : "Downgrade to Free"}
              </Btn>
            )}
          </div>
        ))}
      </div>

      <Panel title="Invoices" subtitle="Derived from your subscription history" icon={Receipt} accent="violet">
        {d.invoices.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoices yet" />
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 font-medium">Invoice</th>
                  <th className="px-2 py-2 font-medium">Period</th>
                  <th className="px-2 py-2 font-medium">Plan</th>
                  <th className="px-2 py-2 font-medium text-right">Amount</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {d.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-4 py-2 telemetry text-[12px] text-slate-300">{inv.id}</td>
                    <td className="px-2 py-2 text-slate-300">{inv.period}</td>
                    <td className="px-2 py-2 text-slate-300">{inv.plan}</td>
                    <td className="px-2 py-2 text-right telemetry text-white">${fmt(inv.amountUsd)}</td>
                    <td className="px-2 py-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] capitalize", inv.status === "paid" ? "bg-emerald-500/10 text-emerald-300" : inv.status === "upcoming" ? "bg-cyan-500/10 text-cyan-300" : inv.status === "trial" ? "bg-violet-500/10 text-violet-300" : "bg-slate-700/40 text-slate-400")}>{inv.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => invoicePdf(inv, orgName)} className="inline-flex items-center gap-1 text-[12px] text-cyan-300 hover:underline">
                        <Download size={12} /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={!!checkout}
        onClose={() => setCheckout(null)}
        title={checkout === "enterprise" ? "Talk to sales about Enterprise" : "Downgrade to Free"}
        footer={
          <>
            <Btn variant="outline" onClick={() => setCheckout(null)}>
              Cancel
            </Btn>
            <Btn variant={checkout === "free" ? "danger" : "primary"} onClick={confirm} disabled={change.isPending}>
              {change.isPending && <Loader2 size={14} className="animate-spin" />}
              {checkout === "enterprise" ? "Send request" : "Downgrade"}
            </Btn>
          </>
        }
      >
        {checkout === "enterprise" && (
          <div className="space-y-3">
            <p className="text-[13px] text-slate-300">From $4,900/month on an annual contract: unlimited assets and seats, multiple workspaces, a 99.9% SLA and a dedicated success manager. Tell us what you need and we'll send a quote within one business day.</p>
            <Field label="What should we know? (optional)">
              <textarea className={cn(inputCls, "h-24 py-2")} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Portfolio size, countries, integrations…" />
            </Field>
          </div>
        )}
        {checkout === "free" && <p className="text-[13px] text-slate-300">The Free plan allows 25 assets, 2 seats and 5 reports per month. Your data stays; features over the limit pause until you upgrade again.</p>}
      </Modal>
    </div>
  );
}
