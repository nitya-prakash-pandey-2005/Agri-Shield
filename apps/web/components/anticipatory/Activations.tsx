"use client";

/** Activation workflow: activate → assign teams → record disbursements → complete → post-event review, with audit trail. */
import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Download, HandCoins, Siren, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Panel, Skeleton } from "@/components/hud";
import { Btn, downloadFile, ErrorBox, Field, inputCls, num, NumInput, Select, toCsv, usd, WhatThisMeans } from "@/components/insurance/kit";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Act = RouterOutputs["insurance"]["aa"]["activations"][number];
const STEPS = [
  { key: "activated", label: "Activated" },
  { key: "teams_assigned", label: "Teams assigned" },
  { key: "disbursing", label: "Disbursing" },
  { key: "completed", label: "Completed" },
  { key: "reviewed", label: "Reviewed" },
] as const;

export default function Activations({ canWrite }: { canWrite: boolean }) {
  const acts = trpc.insurance.aa.activations.useQuery(undefined, { refetchInterval: 30_000 });
  const meta = trpc.insurance.aa.meta.useQuery();
  const [sel, setSel] = useState<string | null>(null);
  if (acts.isLoading) return <Skeleton className="h-[500px]" />;
  if (!acts.data) return <ErrorBox error={acts.error} onRetry={() => acts.refetch()} />;
  if (!acts.data.length)
    return (
      <Panel>
        <EmptyState icon={Siren} title="No activations yet">
          When a protocol’s trigger is met (or you decide to act early), activate it from the Live status tab. The operation — teams, cash disbursements and the post-event review — is tracked here with a full audit trail.
        </EmptyState>
      </Panel>
    );
  const a = acts.data.find((x) => x.id === sel) ?? acts.data[0]!;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Panel title="Operations" accent="cyan" className="self-start" bodyClassName="px-2 pb-2">
        <div className="space-y-1">
          {acts.data.map((x) => (
            <button key={x.id} onClick={() => setSel(x.id)} className={cn("w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]", a.id === x.id && "bg-cyan-400/[0.07]")}>
              <div className="text-[12.5px] text-slate-200">{x.protocolName}</div>
              <div className="text-[11px] text-slate-500">
                {new Date(x.createdAt).toLocaleString()} · {x.status.replace("_", " ")} · {x.communityIds.length} communities
              </div>
            </button>
          ))}
        </div>
      </Panel>
      <div className="min-w-0">{meta.data && <Operation key={a.id} a={a} canWrite={canWrite} communities={meta.data.communities} />}</div>
    </div>
  );
}

function Operation({ a, canWrite, communities }: { a: Act; canWrite: boolean; communities: RouterOutputs["insurance"]["aa"]["meta"]["communities"] }) {
  const utils = trpc.useUtils();
  const inv = () => utils.insurance.aa.invalidate();
  const onErr = (e: { message: string }) => toast.error(e.message);
  const assign = trpc.insurance.aa.assignTeams.useMutation({ onSuccess: () => (inv(), toast.success("Teams assigned")), onError: onErr });
  const disb = trpc.insurance.aa.disburse.useMutation({ onSuccess: () => (inv(), toast.success("Disbursement recorded")), onError: onErr });
  const trans = trpc.insurance.aa.transition.useMutation({ onSuccess: () => (inv(), toast.success("Status updated")), onError: onErr });
  const rev = trpc.insurance.aa.review.useMutation({ onSuccess: () => (inv(), toast.success("Review saved")), onError: onErr });
  const cm = useMemo(() => new Map(communities.map((c) => [c.id, c])), [communities]);
  const actComms = a.communityIds.map((id) => cm.get(id)).filter(Boolean) as typeof communities;
  const stepIdx = a.status === "cancelled" ? -1 : STEPS.findIndex((s) => s.key === a.status);
  const paid = a.disbursements.reduce((t, d) => t + d.amountUsd, 0);
  const hh = a.disbursements.reduce((t, d) => t + d.households, 0);
  // team form
  const [teams, setTeams] = useState([{ name: "Team North", lead: "", contact: "", communityIds: actComms.slice(0, Math.ceil(actComms.length / 2)).map((c) => c.id) }, { name: "Team South", lead: "", contact: "", communityIds: actComms.slice(Math.ceil(actComms.length / 2)).map((c) => c.id) }]);
  // disbursement form
  const [dc, setDc] = useState(actComms[0]?.id ?? "");
  const dcHh = Math.round((cm.get(dc)?.households ?? 0) * 0.4);
  const [dHh, setDHh] = useState(dcHh || 100);
  const [dAmt, setDAmt] = useState((dcHh || 100) * 85);
  const [channel, setChannel] = useState("bKash mobile money");
  const [review, setReview] = useState({ eventOccurred: true, outcome: "", lessons: "" });
  return (
    <div className="space-y-4">
      <Panel
        title={a.protocolName}
        subtitle={`${a.trigger === "forecast" ? "Forecast-triggered" : "Manual"} activation by ${a.createdBy} · ${new Date(a.createdAt).toLocaleString()} · ${a.id}`}
        icon={Siren}
        accent={a.status === "cancelled" ? "amber" : "red"}
        actions={
          <Btn variant="outline" onClick={() => downloadFile(`${a.id}-audit-trail.csv`, toCsv(a.trail.map((t) => ({ at: new Date(t.at).toISOString(), by: t.by, action: t.action, detail: t.detail }))))}>
            <Download size={13} /> Audit CSV
          </Btn>
        }
      >
        <div className="flex flex-wrap items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1">
              <span className={cn("rounded-full px-2.5 py-1 text-[11.5px]", i <= stepIdx ? "bg-cyan-400/15 text-cyan-200" : "bg-slate-800/60 text-slate-500", i === stepIdx && "ring-1 ring-cyan-400/60")}>
                {i < stepIdx ? "✓ " : ""}
                {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="text-slate-600">→</span>}
            </div>
          ))}
          {a.status === "cancelled" && <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11.5px] text-amber-300">Cancelled</span>}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini k="Communities" v={String(a.communityIds.length)} />
          <Mini k="Planned envelope" v={usd(a.plannedUsd)} />
          <Mini k="Disbursed" v={usd(paid)} sub={`${a.plannedUsd ? Math.round((paid / a.plannedUsd) * 100) : 0}% of plan`} />
          <Mini k="Households reached" v={num(hh)} />
        </div>
        <WhatThisMeans className="mt-3">
          {a.status === "activated" && "Next: assign field teams to the activated communities so volunteers and cash agents know where to go."}
          {a.status === "teams_assigned" && "Teams are deployed. Record each mobile-money or cash disbursement as it is confirmed — the envelope and reach update live."}
          {a.status === "disbursing" && `${usd(paid)} delivered to ${num(hh)} households so far. Mark the operation completed when all transfers are confirmed.`}
          {a.status === "completed" && "Operation closed. Complete the post-event review within 30 days: did the flood happen, what worked, what to change in the trigger."}
          {a.status === "reviewed" && a.review && `Reviewed by ${a.review.by}: ${a.review.eventOccurred ? "the event materialised" : "the event did not materialise (false alarm)"}. ${a.review.outcome}`}
          {a.status === "cancelled" && "This activation was cancelled; the reason is in the audit trail."}
        </WhatThisMeans>
      </Panel>

      {canWrite && (a.status === "activated" || a.status === "teams_assigned") && (
        <Panel title="Assign field teams" icon={Users} accent="cyan">
          <div className="space-y-2">
            {teams.map((t, i) => (
              <div key={i} className="grid gap-1.5 sm:grid-cols-[1fr_1fr_1fr]">
                <input className={inputCls} value={t.name} onChange={(e) => setTeams(teams.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Team name" />
                <input className={inputCls} placeholder="Team lead" value={t.lead} onChange={(e) => setTeams(teams.map((x, j) => (j === i ? { ...x, lead: e.target.value } : x)))} aria-label="Team lead" />
                <input className={inputCls} placeholder="Phone / radio" value={t.contact} onChange={(e) => setTeams(teams.map((x, j) => (j === i ? { ...x, contact: e.target.value } : x)))} aria-label="Contact" />
                <div className="text-[11px] text-slate-500 sm:col-span-3">{t.communityIds.map((id) => cm.get(id)?.name).join(" · ") || "no communities"}</div>
              </div>
            ))}
            <div className="flex gap-2">
              <Btn loading={assign.isPending} disabled={teams.some((t) => !t.lead.trim())} onClick={() => assign.mutate({ id: a.id, teams })}>
                <Users size={13} /> Assign {teams.length} teams
              </Btn>
              <Btn variant="outline" onClick={() => trans.mutate({ id: a.id, to: "cancelled", reason: "Forecast downgraded — stand down" })}>
                <XCircle size={13} /> Stand down
              </Btn>
            </div>
          </div>
        </Panel>
      )}

      {canWrite && (a.status === "teams_assigned" || a.status === "disbursing") && (
        <Panel title="Record disbursement" icon={HandCoins} accent="cyan">
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Community" className="sm:col-span-2">
              <Select
                value={dc}
                onChange={(v) => {
                  setDc(v);
                  const h = Math.round((cm.get(v)?.households ?? 0) * 0.4);
                  setDHh(h);
                  setDAmt(h * 85);
                }}
                options={actComms.map((c) => ({ value: c.id, label: `${c.name} (${num(c.households)} hh)` }))}
              />
            </Field>
            <Field label="Households">
              <NumInput value={dHh} min={1} onChange={setDHh} />
            </Field>
            <Field label="Amount (USD)">
              <NumInput value={dAmt} min={0} onChange={setDAmt} />
            </Field>
            <Field label="Channel" className="sm:col-span-2">
              <Select value={channel} onChange={setChannel} options={["bKash mobile money", "Nagad mobile money", "Cash in envelope", "Bank transfer"].map((v) => ({ value: v, label: v }))} />
            </Field>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Btn loading={disb.isPending} onClick={() => disb.mutate({ id: a.id, communityId: dc, households: dHh, amountUsd: dAmt, channel })}>
                <HandCoins size={13} /> Record
              </Btn>
              {a.status === "disbursing" && (
                <Btn variant="outline" onClick={() => trans.mutate({ id: a.id, to: "completed", reason: "All planned transfers confirmed" })}>
                  <CheckCircle2 size={13} /> Mark completed
                </Btn>
              )}
            </div>
          </div>
        </Panel>
      )}

      {canWrite && a.status === "completed" && (
        <Panel title="Post-event review" icon={ClipboardCheck} accent="cyan">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[12.5px] text-slate-300">
              <input type="checkbox" className="accent-cyan-400" checked={review.eventOccurred} onChange={(e) => setReview({ ...review, eventOccurred: e.target.checked })} /> The forecast flood materialised
            </label>
            <Field label="Outcome">
              <textarea className={cn(inputCls, "h-16 py-2")} value={review.outcome} onChange={(e) => setReview({ ...review, outcome: e.target.value })} placeholder="e.g. 92% of targeted households received cash 36 h before peak; livestock moved in 5 of 6 unions" />
            </Field>
            <Field label="Lessons / trigger changes">
              <textarea className={cn(inputCls, "h-16 py-2")} value={review.lessons} onChange={(e) => setReview({ ...review, lessons: e.target.value })} />
            </Field>
            <Btn loading={rev.isPending} disabled={review.outcome.trim().length < 3} onClick={() => rev.mutate({ id: a.id, ...review })}>
              <ClipboardCheck size={13} /> Save review
            </Btn>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Disbursements" icon={HandCoins} accent="cyan" bodyClassName="px-0 pb-2">
          {a.disbursements.length ? (
            <table className="w-full text-[12.5px]">
              <tbody>
                {a.disbursements.map((d) => (
                  <tr key={d.id} className="border-b border-slate-800/60">
                    <td className="px-4 py-1.5">
                      <div className="text-slate-200">{d.communityName}</div>
                      <div className="text-[11px] text-slate-500">
                        {d.channel} · {d.by} · {new Date(d.at).toLocaleString()}
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-1.5 pl-2 text-right telemetry text-slate-400">{num(d.households)} hh</td>
                    <td className="px-4 py-1.5 text-right telemetry text-emerald-300">{usd(d.amountUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 text-[12px] text-slate-500">No disbursements recorded yet.</div>
          )}
          {!!a.teams.length && (
            <div className="mt-2 px-4 text-[11.5px] text-slate-400">
              Teams: {a.teams.map((t) => `${t.name} (${t.lead}${t.contact ? `, ${t.contact}` : ""})`).join(" · ")}
            </div>
          )}
        </Panel>
        <Panel title="Audit trail" icon={ClipboardCheck} accent="cyan">
          <ol className="relative space-y-2.5 border-l border-slate-700 pl-4">
            {[...a.trail].reverse().map((t, i) => (
              <li key={i} className="text-[12.5px]">
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-cyan-400" />
                <div className="text-slate-200">
                  {t.action} <span className="text-[11px] text-slate-500">· {t.by} · {new Date(t.at).toLocaleString()}</span>
                </div>
                <div className="text-[11.5px] text-slate-400">{t.detail}</div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}

function Mini({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-900/60 px-2.5 py-2">
      <div className="text-[10.5px] text-slate-500">{k}</div>
      <div className="telemetry text-slate-100">{v}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
