"use client";

/** Workspace data export + deletion (platform procedures in workspaceRouter). */
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertOctagon, Download, Loader2, Trash2, Undo2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Panel, Skeleton } from "@/components/hud";
import { Btn, Field, Modal, downloadBlob, inputCls } from "@/components/workspace/ui";
import { cn } from "@/lib/utils";

export function DataPanel() {
  const utils = trpc.useUtils();
  const q = trpc.workspace.security.useQuery();
  const exportWs = trpc.workspace.exportWorkspace.useMutation();
  const requestDel = trpc.workspace.requestDeletion.useMutation();
  const cancelDel = trpc.workspace.cancelDeletion.useMutation();
  const [delOpen, setDelOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");

  const d = q.data;
  if (!d) return <Skeleton className="h-56" />;
  const pendingDel = d.deletion && d.deletion.status === "pending" ? d.deletion : null;

  const doExport = async () => {
    try {
      const data = await exportWs.mutateAsync();
      downloadBlob(`agri-shield-workspace-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json");
      toast.success(`Exported ${data.assets.length} assets, ${data.members.length} members, ${data.audit.length} audit events`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
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
            <p className="text-[13px] text-slate-300">Permanently delete {d.orgName} and all its data. There&apos;s a 30-day grace period during which any admin can cancel. We recommend exporting first.</p>
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
          <Field
            label={
              <>
                Type <b className="text-white">{d.orgName}</b> to confirm
              </>
            }
          >
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
