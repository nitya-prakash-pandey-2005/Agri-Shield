"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { Fingerprint, Laptop, LogOut, RotateCcw, ShieldCheck, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, Panel, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, Modal, Toggle } from "@/components/workspace/ui";
import { DeviceIcon, Hint, METHOD_LABEL, Pill, toastErr } from "./shared";
import { cn } from "@/lib/utils";

const ago = (d: Date | string | null) => (d ? formatDistanceToNowStrict(new Date(d), { addSuffix: true }) : "—");

export function PolicyPanel({ require2fa, since, members, enrolled, onChanged }: { require2fa: boolean; since: Date | string | null; members: number; enrolled: number; onChanged: () => void }) {
  const set = trpc.developer.security.setPolicy.useMutation();
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          Require 2-step verification <Explain text="When on, every member must use an authenticator app. Members who haven't set one up are taken through enrolment at their next sign-in — before any session is created. SSO sign-ins rely on your identity provider's MFA instead." title="2FA policy" />
        </span>
      }
      subtitle={`${enrolled} of ${members} members enrolled`}
      icon={ShieldCheck}
      accent="emerald"
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-3">
        <div>
          <div className="text-[13px] text-slate-100">Everyone in this workspace must use an authenticator app</div>
          <div className="text-[11.5px] text-slate-500">{require2fa ? `Enforced since ${since ? new Date(since).toISOString().slice(0, 10) : "today"} · ${members - enrolled} member(s) will enrol at next sign-in` : "Optional — members choose for themselves"}</div>
        </div>
        <Toggle
          checked={require2fa}
          label="Require 2-step verification"
          disabled={set.isPending}
          onChange={async (v) => {
            try {
              const r = await set.mutateAsync({ require2fa: v });
              toast.success(v ? `2FA required · ${r.membersToEnrol ?? 0} member(s) will enrol at next sign-in` : "2FA is now optional");
              onChanged();
            } catch (e) {
              toastErr(e);
            }
          }}
        />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all" style={{ width: `${members ? (enrolled / members) * 100 : 0}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">2FA coverage {members ? Math.round((enrolled / members) * 100) : 0}%</p>
    </Panel>
  );
}

export function MembersPanel({ onChanged }: { onChanged: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.developer.security.members.useQuery();
  const roles = trpc.developer.security.roles.useQuery();
  const assign = trpc.developer.security.assignRole.useMutation();
  const signOutAll = trpc.developer.security.revokeMemberSessions.useMutation();
  const reset = trpc.developer.security.resetMember2fa.useMutation();
  const [sessionsOf, setSessionsOf] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => {
    void utils.developer.security.members.invalidate();
    void utils.developer.security.roles.invalidate();
    onChanged();
  };

  return (
    <Panel title="Members" subtitle="2-step status, sessions and roles for everyone in the workspace" icon={Users} accent="cyan">
      {!q.data ? (
        <Skeleton className="h-48" />
      ) : q.data.length === 0 ? (
        <EmptyState icon={Users} title="No members yet" />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead>
              <tr className="hud-label border-b border-white/5 text-slate-500">
                <th className="py-2 pr-3 font-normal">Member</th>
                <th className="py-2 pr-3 font-normal">Role</th>
                <th className="py-2 pr-3 font-normal">2-step</th>
                <th className="py-2 pr-3 font-normal">Sessions</th>
                <th className="py-2 pr-3 font-normal">Last seen</th>
                <th className="py-2 text-right font-normal">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {q.data.map((m) => (
                <tr key={m.id} className="align-middle">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-1.5 text-slate-100">
                      {m.name}
                      {m.isMe && <Pill tone="emerald">You</Pill>}
                      {m.sso && (
                        <Pill tone="violet">
                          <Fingerprint size={10} /> SSO
                        </Pill>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">{m.email ?? "—"}</div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <select
                      aria-label={`Role for ${m.name}`}
                      className="h-8 max-w-[190px] rounded-md border border-slate-700 bg-slate-950/70 px-2 text-[12px] text-slate-200 focus:border-cyan-400/60 focus:outline-none"
                      value={m.customRoleId ?? ""}
                      disabled={assign.isPending || !roles.data}
                      onChange={async (e) => {
                        try {
                          await assign.mutateAsync({ userId: m.id, roleId: e.target.value || null });
                          toast.success(`${m.name} → ${e.target.value ? roles.data?.custom.find((r) => r.id === e.target.value)?.name : m.roleLabel}`);
                          refresh();
                        } catch (err) {
                          toastErr(err);
                        }
                      }}
                    >
                      <option value="">{m.roleLabel} (built-in)</option>
                      {roles.data?.custom.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} (custom)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2.5 pr-3">{m.twoFactor ? <Pill tone="emerald">On</Pill> : <Pill tone="amber">Off</Pill>}</td>
                  <td className="telemetry py-2.5 pr-3 text-slate-300">{m.activeSessions}</td>
                  <td className="py-2.5 pr-3 text-slate-400">{ago(m.lastSeen)}</td>
                  <td className="py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <button className="rounded-md px-2 py-1 text-[11.5px] text-slate-400 hover:bg-white/5 hover:text-white" onClick={() => setSessionsOf({ id: m.id, name: m.name })}>
                        <Laptop size={12} className="mr-1 inline" />
                        Sessions
                      </button>
                      {!m.isMe && m.activeSessions > 0 && (
                        <button
                          className="rounded-md px-2 py-1 text-[11.5px] text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"
                          onClick={async () => {
                            if (!window.confirm(`Sign ${m.name} out of every device?`)) return;
                            try {
                              const r = await signOutAll.mutateAsync({ userId: m.id });
                              toast.success(`${m.name}: ${r.revoked} session(s) signed out`);
                              refresh();
                            } catch (e) {
                              toastErr(e);
                            }
                          }}
                        >
                          <LogOut size={12} className="mr-1 inline" />
                          Sign out
                        </button>
                      )}
                      {!m.isMe && m.twoFactor && (
                        <button
                          className="rounded-md px-2 py-1 text-[11.5px] text-slate-400 hover:bg-amber-500/10 hover:text-amber-300"
                          onClick={async () => {
                            if (!window.confirm(`Reset ${m.name}'s authenticator? Use this when they lost their phone and recovery codes. They'll be signed out everywhere.`)) return;
                            try {
                              await reset.mutateAsync({ userId: m.id });
                              toast.success(`${m.name}'s 2-step verification was reset`);
                              refresh();
                            } catch (e) {
                              toastErr(e);
                            }
                          }}
                        >
                          <RotateCcw size={12} className="mr-1 inline" />
                          Reset 2FA
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3">
        <Hint>Role changes apply to a member's very next request — no need to sign them out. A custom role limits which permissions and modules they can use; the page chrome stays the same but blocked modules answer “not included in your role”.</Hint>
      </div>
      <MemberSessionsModal member={sessionsOf} onClose={() => setSessionsOf(null)} onChanged={refresh} />
    </Panel>
  );
}

function MemberSessionsModal({ member, onClose, onChanged }: { member: { id: string; name: string } | null; onClose: () => void; onChanged: () => void }) {
  const q = trpc.developer.security.memberSessions.useQuery({ userId: member?.id ?? "" }, { enabled: !!member });
  const revoke = trpc.developer.security.revokeSession.useMutation();
  return (
    <Modal open={!!member} onClose={onClose} title={`${member?.name ?? ""} · sessions`} wide footer={<Btn onClick={onClose}>Close</Btn>}>
      {!q.data ? (
        <Skeleton className="h-32" />
      ) : q.data.length === 0 ? (
        <p className="text-sm text-slate-400">No tracked sessions.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {q.data.map((s) => (
            <li key={s.id} className={cn("flex items-center gap-3 py-2.5", s.revokedAt && "opacity-50")}>
              <DeviceIcon kind={s.device.kind} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-100">
                  {s.device.label} {s.mfa && <Pill tone="cyan">2-step</Pill>} {s.revokedAt && <Pill>{s.revokeReason ?? "revoked"}</Pill>}
                </div>
                <div className="telemetry truncate text-[11px] text-slate-500">
                  IP {s.ip} · {METHOD_LABEL[s.method] ?? s.method} · signed in {ago(s.createdAt)} · active {ago(s.lastSeen)}
                </div>
              </div>
              {!s.revokedAt && !s.current && (
                <button
                  className="rounded-md px-2 py-1 text-[11.5px] text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"
                  onClick={async () => {
                    try {
                      await revoke.mutateAsync({ id: s.id });
                      toast.success("Session revoked");
                      await q.refetch();
                      onChanged();
                    } catch (e) {
                      toastErr(e);
                    }
                  }}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
