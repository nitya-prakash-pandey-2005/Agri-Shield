"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, Building2, Globe2, MapPinned, ShieldX, Users, Warehouse, XCircle } from "lucide-react";
import { EmptyState, HudButton, Panel, SectionHeader, Skeleton } from "@/components/hud";
import { ErrorNote, KV, StatusBadge, TimeAgo, fmtUsd } from "@/components/admin/ui";
import { TabBar } from "@/components/admin/Overlay";
import { ROLE_LABELS } from "@/lib/rbac";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Org = RouterOutputs["admin"]["orgs"]["list"][number];
type State = "pending" | "verified" | "rejected";

export default function AdminOrganizationsPage() {
  const utils = trpc.useUtils();
  const orgs = trpc.admin.orgs.list.useQuery();
  const [tab, setTab] = useState<State>("pending");
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const byState = useMemo(() => {
    const m: Record<State, Org[]> = { pending: [], verified: [], rejected: [] };
    for (const o of orgs.data ?? []) m[o.state as State].push(o);
    return m;
  }, [orgs.data]);
  const list = byState[tab];
  const current = list.find((o) => o.id === selected) ?? list[0] ?? null;

  useEffect(() => setNote(""), [current?.id]);

  const review = trpc.admin.orgs.review.useMutation({
    onSuccess: (_r, v) => {
      toast.success(v.decision === "verify" ? "Organisation verified" : v.decision === "revoke" ? "Verification revoked" : "Organisation rejected", { description: "Decision recorded in the audit log" });
      setNote("");
      void utils.admin.orgs.list.invalidate();
      void utils.admin.overview.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Trust & Onboarding"
        title="Organisation verification"
        description="Government agencies, NGOs and supply-chain companies must be verified before they can broadcast alerts or access regional farmer data."
        actions={
          <TabBar<State>
            value={tab}
            onChange={(v) => {
              setTab(v);
              setSelected(null);
            }}
            tabs={[
              { value: "pending", label: "Pending", count: byState.pending.length },
              { value: "verified", label: "Verified", count: byState.verified.length },
              { value: "rejected", label: "Rejected", count: byState.rejected.length },
            ]}
          />
        }
      />
      <ErrorNote error={orgs.error} />

      {!orgs.data ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96 lg:col-span-3" />
        </div>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState icon={Building2} title={`No ${tab} organisations`}>
            {tab === "pending" ? "The verification queue is clear." : "Nothing here yet."}
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2 space-y-2">
            {list.map((o) => (
              <button
                key={o.id}
                onClick={() => setSelected(o.id)}
                className={cn(
                  "w-full text-left hud-panel p-3.5 transition-colors",
                  current?.id === o.id ? "ring-1 ring-violet-500/60" : "hover:ring-1 hover:ring-white/10"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-white truncate">{o.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {o.type.replace("_", " ")} · {o.country}
                    </div>
                  </div>
                  <StatusBadge status={o.state} pulse={o.state === "pending"} />
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Users size={11} /> {o.members.length}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPinned size={11} /> {o.districts} districts
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Warehouse size={11} /> {o.nodes} nodes
                  </span>
                  <span>
                    applied <TimeAgo date={o.createdAt} />
                  </span>
                </div>
              </button>
            ))}
          </div>

          {current && (
            <div className="lg:col-span-3 space-y-4">
              <Panel title={current.name} subtitle={`${current.shortName} · ${current.id}`} icon={Building2} accent="violet" actions={<StatusBadge status={current.state} />}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <KV k="Type" v={current.type.replace("_", " ")} />
                    <KV k="Country" v={current.country} />
                    <KV k="Region" v={current.region ?? "—"} />
                    <KV k="Plan tier" v={current.planTier} mono />
                    <KV k="Registered" v={new Date(current.createdAt).toISOString().slice(0, 10)} mono />
                  </div>
                  <div>
                    <KV k="Districts covered" v={current.districts} mono />
                    <KV k="Supply nodes" v={current.nodes} mono />
                    <KV k="Subscription" v={current.subscription ? <StatusBadge status={current.subscription.status} /> : "—"} />
                    <KV k="MRR" v={fmtUsd(current.subscription?.mrrUsd ?? 0)} mono />
                    <KV k="Billing provider" v={current.subscription?.provider ?? "—"} mono />
                  </div>
                </div>
                {current.review && (
                  <div className="mt-3 rounded-lg border border-white/5 bg-slate-950/50 p-3 text-[12px]">
                    <span className="hud-label">Last decision</span>
                    <div className="mt-1 text-slate-300">
                      <span className="text-white">{current.review.decision}</span> by {current.review.by} · <TimeAgo date={current.review.at} />
                      {current.review.note && <div className="mt-1 text-slate-400">“{current.review.note}”</div>}
                    </div>
                  </div>
                )}
              </Panel>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Panel title="Members" subtitle={`${current.members.length} account(s)`} icon={Users} accent="cyan">
                  {current.members.length === 0 ? (
                    <div className="text-xs text-slate-500 py-3">No members registered.</div>
                  ) : (
                    <ul className="divide-y divide-white/5">
                      {current.members.map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                          <div className="min-w-0">
                            <div className="text-[12.5px] text-slate-100 truncate">{m.name}</div>
                            <div className="text-[10.5px] text-slate-500 truncate">
                              {ROLE_LABELS[m.role]} · {m.email ?? "—"}
                            </div>
                          </div>
                          <StatusBadge status={m.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel title="History" subtitle="Audit entries for this organisation" icon={Globe2} accent="cyan">
                  {current.history.length === 0 ? (
                    <div className="text-xs text-slate-500 py-3">No audit history yet.</div>
                  ) : (
                    <ul className="space-y-2">
                      {current.history.map((h) => (
                        <li key={h.id} className="text-[12px]">
                          <span className="telemetry rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300 text-[10.5px]">{h.action}</span>{" "}
                          <span className="text-slate-400">
                            {h.userName} · <TimeAgo date={h.at} />
                          </span>
                          <div className="text-slate-300">{h.details}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>

              <Panel title="Review decision" subtitle="Recorded with your name in the audit log" icon={BadgeCheck} accent={current.state === "verified" ? "green" : "amber"}>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 500))}
                  rows={3}
                  placeholder="Reviewer note — e.g. ministry letter verified, tax ID checked, signatory confirmed by phone…"
                  className="w-full rounded-lg border border-slate-700/70 bg-slate-950/60 p-2.5 text-sm text-slate-100 outline-none focus:border-violet-500/60"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {current.state !== "verified" && (
                    <HudButton disabled={review.isPending} onClick={() => review.mutate({ id: current.id, decision: "verify", note: note.trim() || undefined })}>
                      <BadgeCheck size={14} /> Verify organisation
                    </HudButton>
                  )}
                  {current.state === "pending" && (
                    <HudButton variant="danger" disabled={review.isPending} onClick={() => review.mutate({ id: current.id, decision: "reject", note: note.trim() || undefined })}>
                      <XCircle size={14} /> Reject
                    </HudButton>
                  )}
                  {current.state === "verified" && (
                    <HudButton variant="danger" disabled={review.isPending} onClick={() => review.mutate({ id: current.id, decision: "revoke", note: note.trim() || undefined })}>
                      <ShieldX size={14} /> Revoke verification
                    </HudButton>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Verifying activates the subscription and any members pending verification. Rejecting or revoking cancels billing and blocks alert broadcasting.
                </p>
              </Panel>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
