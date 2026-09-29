"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { Copy, Loader2, MailPlus, RefreshCw, Trash2, UserMinus, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, Meter, Panel, Skeleton } from "@/components/hud";
import { Btn, Field, inputCls } from "@/components/workspace/ui";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = { pending: "bg-cyan-500/10 text-cyan-300", accepted: "bg-emerald-500/10 text-emerald-300", revoked: "bg-slate-700/40 text-slate-400", expired: "bg-amber-500/10 text-amber-300" };

function ConfirmButton({ onConfirm, children, label, disabled }: { onConfirm: () => void; children: React.ReactNode; label: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          setTimeout(() => setArmed(false), 3500);
        }
      }}
      className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] transition-colors disabled:opacity-30", armed ? "bg-rose-500 text-white" : "text-slate-400 hover:bg-rose-500/10 hover:text-rose-300")}
      aria-label={label}
    >
      {armed ? "Click to confirm" : children}
    </button>
  );
}

export default function TeamSettings() {
  const utils = trpc.useUtils();
  const q = trpc.workspace.team.useQuery();
  const refresh = () => Promise.all([utils.workspace.team.invalidate(), utils.workspace.onboarding.invalidate(), utils.workspace.home.invalidate()]);
  const invite = trpc.workspace.invite.useMutation();
  const resend = trpc.workspace.resendInvite.useMutation();
  const revoke = trpc.workspace.revokeInvite.useMutation();
  const changeRole = trpc.workspace.changeRole.useMutation();
  const remove = trpc.workspace.removeMember.useMutation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("");
  const [lastLink, setLastLink] = useState<string | null>(null);

  const d = q.data;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const copy = async (path: string) => {
    try {
      await navigator.clipboard.writeText(`${origin}${path}`);
      toast.success("Invite link copied");
    } catch {
      toast.message(`${origin}${path}`);
    }
  };
  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast.success(ok);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d) return;
    try {
      const r = await invite.mutateAsync({ email: email.trim(), role: role || d.roles.find((x) => !x.admin)?.role || d.roles[0]!.role });
      setLastLink(r.link);
      setEmail("");
      toast.success("Invite created — email sent and link ready to copy");
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!d) return <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-60" />)}</div>;
  const seatsUsed = d.seats.used + d.seats.pending;
  const seatPct = d.seats.limit ? Math.min(100, (seatsUsed / d.seats.limit) * 100) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel title={`Members (${d.members.length})`} icon={Users} accent="cyan">
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Role</th>
                  <th className="px-2 py-2 font-medium">Last active</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {d.members.map((m) => (
                  <tr key={m.id} className="hover:bg-white/[0.015]">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cyan-500/15 text-xs font-semibold text-cyan-200">{m.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                        <div className="min-w-0">
                          <div className="truncate text-slate-100">
                            {m.name} {m.isYou && <span className="text-[10px] text-slate-500">(you)</span>}
                          </div>
                          <div className="truncate text-[11.5px] text-slate-500">
                            {m.email} {m.title ? `· ${m.title}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      {d.canManage && !m.isYou ? (
                        <select value={m.role} onChange={(e) => run(changeRole.mutateAsync({ userId: m.id, role: e.target.value }), "Role updated — applies at their next sign-in")} className="h-8 rounded-md border border-slate-700 bg-slate-950/70 px-2 text-[12.5px] text-slate-200" aria-label={`Role for ${m.name}`}>
                          {d.roles.map((r) => (
                            <option key={r.role} value={r.role}>
                              {r.label}
                            </option>
                          ))}
                          {!d.roles.some((r) => r.role === m.role) && <option value={m.role}>{m.roleLabel}</option>}
                        </select>
                      ) : (
                        <span className="text-[12.5px] text-slate-300">{d.roles.find((r) => r.role === m.role)?.label ?? m.roleLabel}</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-[12px] text-slate-400">{formatDistanceToNowStrict(new Date(m.lastActive), { addSuffix: true })}</td>
                    <td className="px-4 py-2.5 text-right">
                      {d.canManage && !m.isYou && (
                        <ConfirmButton label={`Remove ${m.name}`} onConfirm={() => run(remove.mutateAsync({ userId: m.id }), `${m.name} removed`)}>
                          <UserMinus size={13} /> Remove
                        </ConfirmButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Invites" subtitle="Links are valid for 7 days and can be used once" icon={MailPlus} accent="emerald">
          {d.invites.length === 0 ? (
            <EmptyState icon={MailPlus} title="No invites yet">
              Invite a teammate on the right — they'll get an email and you'll get a link you can share directly.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-white/5">
              {d.invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-slate-100">{i.email}</div>
                    <div className="text-[11.5px] text-slate-500">
                      {d.roles.find((r) => r.role === i.role)?.label ?? i.roleLabel} · by {i.invitedByName} · {i.status === "pending" ? `expires ${formatDistanceToNowStrict(new Date(i.expiresAt), { addSuffix: true })}` : i.status === "accepted" && i.acceptedAt ? `joined ${formatDistanceToNowStrict(new Date(i.acceptedAt), { addSuffix: true })}` : `sent ${formatDistanceToNowStrict(new Date(i.createdAt), { addSuffix: true })}`}
                    </div>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-medium capitalize", STATUS_STYLE[i.status])}>{i.status}</span>
                  {d.canManage && i.status === "pending" && i.link && (
                    <>
                      <Btn variant="outline" className="h-7 px-2 py-0 text-[11.5px]" onClick={() => copy(i.link!)}>
                        <Copy size={12} /> Copy link
                      </Btn>
                      <button onClick={() => run(resend.mutateAsync({ id: i.id }), "Invite re-sent with a fresh 7-day link")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-slate-400 hover:bg-white/5 hover:text-white">
                        <RefreshCw size={12} /> Resend
                      </button>
                      <ConfirmButton label={`Revoke invite for ${i.email}`} onConfirm={() => run(revoke.mutateAsync({ id: i.id }), "Invite revoked")}>
                        <Trash2 size={12} /> Revoke
                      </ConfirmButton>
                    </>
                  )}
                  {d.canManage && i.status === "expired" && (
                    <button onClick={() => run(resend.mutateAsync({ id: i.id }).catch(() => invite.mutateAsync({ email: i.email, role: i.role })), "New invite link created")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-cyan-300 hover:bg-white/5">
                      <RefreshCw size={12} /> Renew
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Invite a teammate" icon={MailPlus} accent="cyan">
          {d.canManage ? (
            <form onSubmit={sendInvite} className="space-y-3">
              <Field label="Work email">
                <input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" />
              </Field>
              <Field label="Role">
                <select className={inputCls} value={role || d.roles.find((x) => !x.admin)?.role || d.roles[0]!.role} onChange={(e) => setRole(e.target.value)}>
                  {d.roles.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Btn type="submit" disabled={invite.isPending || !email} className="w-full">
                {invite.isPending ? <Loader2 size={14} className="animate-spin" /> : <MailPlus size={14} />} Send invite
              </Btn>
              {lastLink && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                  <div className="text-[11px] text-emerald-300">Share this link directly (valid 7 days):</div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-[11px] text-slate-300">
                      {origin}
                      {lastLink}
                    </code>
                    <button type="button" onClick={() => copy(lastLink)} className="text-cyan-300" aria-label="Copy invite link">
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
              )}
            </form>
          ) : (
            <p className="text-sm text-slate-400">Only workspace admins can invite people. Ask an admin to add your colleague.</p>
          )}
        </Panel>

        <Panel title="Seats" subtitle={`${d.seats.plan} plan`} icon={Users} accent="violet">
          <div className="flex items-baseline gap-1.5">
            <span className="telemetry text-2xl font-semibold text-white">{seatsUsed}</span>
            <span className="text-sm text-slate-400">/ {d.seats.limit ?? "unlimited"} seats</span>
          </div>
          <div className="mt-1 text-[11.5px] text-slate-500">
            {d.seats.used} members + {d.seats.pending} pending invite{d.seats.pending === 1 ? "" : "s"}
          </div>
          {d.seats.limit && <Meter value={seatPct} color={seatPct > 90 ? "#f87171" : "#38bdf8"} className="mt-2" />}
          <a href="/app/settings/billing" className="mt-3 inline-block text-[12px] text-cyan-300 hover:underline">
            Need more seats? Change plan →
          </a>
          <div className="mt-4 space-y-2 border-t border-white/5 pt-3">
            {d.roles.map((r) => (
              <div key={r.role} className="text-[12px]">
                <span className="text-slate-200">{r.label}</span> <span className="text-slate-500">— {r.description}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
