"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertOctagon, Download, Laptop, Loader2, LogOut, ShieldCheck, Smartphone, Trash2, Undo2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, Panel, Skeleton, SourceTag } from "@/components/hud";
import { Btn, Field, Modal, Toggle, downloadBlob, inputCls } from "@/components/workspace/ui";
import { cn } from "@/lib/utils";

export default function SecuritySettings() {
  const utils = trpc.useUtils();
  const q = trpc.workspace.security.useQuery();
  const set2fa = trpc.workspace.setTwoFactor.useMutation({ onSuccess: () => void utils.workspace.security.invalidate() });
  const revoke = trpc.workspace.revokeSession.useMutation({ onSuccess: () => void utils.workspace.security.invalidate() });
  const exportWs = trpc.workspace.exportWorkspace.useMutation();
  const requestDel = trpc.workspace.requestDeletion.useMutation();
  const cancelDel = trpc.workspace.cancelDeletion.useMutation();
  const [delOpen, setDelOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");

  const d = q.data;
  if (!d) return <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>;
  const pendingDel = d.deletion && d.deletion.status === "pending" ? d.deletion : null;

  const doExport = async () => {
    try {
      const data = await exportWs.mutateAsync();
      const name = `agri-shield-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      downloadBlob(name, JSON.stringify(data, null, 2), "application/json");
      toast.success(`Exported ${data.assets.length} assets, ${data.members.length} members, ${data.audit.length} audit events`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Active sessions" subtitle="Your recent sign-ins" icon={Laptop} accent="cyan" actions={<SourceTag>derived from sign-in audit events</SourceTag>}>
        {d.sessions.length === 0 ? (
          <EmptyState icon={Laptop} title="No sign-ins recorded since the last restart" />
        ) : (
          <ul className="divide-y divide-white/5">
            {d.sessions.map((s) => (
              <li key={s.id} className={cn("flex items-center gap-3 py-2.5", s.revoked && "opacity-50")}>
                {/mobile/i.test(s.device) ? <Smartphone size={16} className="text-slate-400" /> : <Laptop size={16} className="text-slate-400" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-slate-100">
                    {s.device} {s.current && <span className="ml-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">This device</span>}
                    {s.revoked && <span className="ml-1 rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-400">Revoked</span>}
                  </div>
                  <div className="text-[11.5px] text-slate-500">
                    Signed in {formatDistanceToNowStrict(new Date(s.at), { addSuffix: true })} via {s.method} · IP {s.ip} · expires {new Date(s.expiresAt).toISOString().slice(0, 10)}
                  </div>
                </div>
                {!s.current && !s.revoked && (
                  <button onClick={() => revoke.mutate({ id: s.id }, { onSuccess: () => toast.success("Session revoked") })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-slate-400 hover:bg-rose-500/10 hover:text-rose-300">
                    <LogOut size={12} /> Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11.5px] text-slate-500">Sessions are signed tokens that expire after 7 days. Revoking marks the session in your audit trail; change your password to force every device to sign in again.</p>
      </Panel>

      <Panel title="2-step verification" icon={ShieldCheck} accent="emerald">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-3">
          <div>
            <div className="text-[13px] text-slate-100">Require a second step when I sign in</div>
            <div className="text-[11.5px] text-slate-500">{d.twoFactor.twoFactor ? `On · ${d.twoFactor.method === "totp" ? "authenticator app" : d.twoFactor.method.toUpperCase()} · updated ${d.twoFactor.updatedAt ? formatDistanceToNowStrict(new Date(d.twoFactor.updatedAt), { addSuffix: true }) : ""}` : "Off"}</div>
          </div>
          <Toggle checked={d.twoFactor.twoFactor} label="2-step verification" onChange={(v) => set2fa.mutate({ enabled: v, method: d.twoFactor.method }, { onSuccess: () => toast.success(v ? "2-step verification preference saved" : "2-step verification turned off") })} />
        </div>
        <Field label="Method" className="mt-3">
          <select className={inputCls} value={d.twoFactor.method} onChange={(e) => set2fa.mutate({ enabled: d.twoFactor.twoFactor, method: e.target.value as "totp" | "sms" | "email" })}>
            <option value="totp">Authenticator app (TOTP)</option>
            <option value="sms">SMS code</option>
            <option value="email">Email code</option>
          </select>
        </Field>
        <p className="mt-3 rounded-lg bg-slate-900/60 px-3 py-2 text-[11.5px] text-slate-400">Your preference is stored and audited now. Enforcement at sign-in is enabled per workspace on Enterprise (SSO/SAML) — email/OTP codes already protect farmer and OTP sign-ins.</p>
      </Panel>

      <Panel title="Export workspace data" icon={Download} accent="violet">
        <p className="text-[13px] text-slate-300">Download everything in this workspace as one JSON file: organisation settings, members (without passwords), assets, alert rules, notifications, reports, schedules, invites, API key prefixes, webhooks (without secrets), usage and the audit log.</p>
        <Btn className="mt-3" onClick={doExport} disabled={exportWs.isPending || !d.canManage}>
          {exportWs.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export JSON
        </Btn>
        {!d.canManage && <p className="mt-2 text-[11.5px] text-slate-500">Only admins can export the whole workspace.</p>}
      </Panel>

      <Panel title="Delete workspace" icon={AlertOctagon} accent="red">
        {pendingDel ? (
          <>
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-200">
              Deletion requested by {pendingDel.requestedByName} {formatDistanceToNowStrict(new Date(pendingDel.requestedAt), { addSuffix: true })}. Scheduled for <b>{new Date(pendingDel.scheduledFor).toISOString().slice(0, 10)}</b>.
            </div>
            {d.canManage && (
              <Btn
                variant="outline"
                className="mt-3"
                onClick={async () => {
                  await cancelDel.mutateAsync();
                  toast.success("Deletion cancelled");
                  await Promise.all([utils.workspace.security.invalidate(), utils.workspace.me.invalidate()]);
                }}
              >
                <Undo2 size={14} /> Cancel deletion
              </Btn>
            )}
          </>
        ) : (
          <>
            <p className="text-[13px] text-slate-300">Permanently delete {d.orgName} and all its data. There's a 30-day grace period during which any admin can cancel. We recommend exporting first.</p>
            <Btn variant="danger" className="mt-3" disabled={!d.canManage} onClick={() => setDelOpen(true)}>
              <Trash2 size={14} /> Request deletion
            </Btn>
          </>
        )}
      </Panel>

      <Modal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="Delete this workspace?"
        footer={
          <>
            <Btn variant="outline" onClick={() => setDelOpen(false)}>
              Keep workspace
            </Btn>
            <Btn
              variant="danger"
              disabled={confirmName !== d.orgName || requestDel.isPending}
              onClick={async () => {
                try {
                  await requestDel.mutateAsync({ confirmName, reason });
                  toast.success("Deletion scheduled in 30 days — admins have been emailed");
                  setDelOpen(false);
                  await Promise.all([utils.workspace.security.invalidate(), utils.workspace.me.invalidate()]);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Schedule deletion
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-slate-300">All assets, rules, reports, members and integrations will be removed after 30 days. API keys stop working at that point.</p>
          <Field label={<>Type <b className="text-white">{d.orgName}</b> to confirm</>}>
            <input className={inputCls} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          </Field>
          <Field label="Why are you leaving? (optional)">
            <textarea className={cn(inputCls, "h-20 py-2")} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
