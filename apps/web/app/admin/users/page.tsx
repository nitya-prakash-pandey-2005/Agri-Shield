"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Eye, UserCheck, UserX, Users } from "lucide-react";
import type { UserRole } from "@agri-shield/types";
import { EmptyState, HudButton, Panel, SectionHeader, Skeleton } from "@/components/hud";
import { DataTable, ErrorNote, KV, SearchInput, Select, StatusBadge, Td, TimeAgo, fmtUsd } from "@/components/admin/ui";
import { Drawer, Modal, maskMiddle, useDebounced } from "@/components/admin/Overlay";
import { ROLE_LABELS } from "@/lib/rbac";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type Row = RouterOutputs["admin"]["users"]["list"]["rows"][number];
const ROLES = Object.keys(ROLE_LABELS) as UserRole[];
const PAGE = 50;
type Status = "active" | "suspended" | "pending_verification";

export default function AdminUsersPage() {
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<UserRole | "">("");
  const [status, setStatus] = useState<Status | "">("");
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState<{ user: Row; to: "active" | "suspended" } | null>(null);
  const [reason, setReason] = useState("");
  const dq = useDebounced(q, 250);

  const list = trpc.admin.users.list.useQuery({ q: dq || undefined, role: role || undefined, status: status || undefined, limit: PAGE, offset }, { placeholderData: (p) => p });

  const refresh = () => {
    void utils.admin.users.list.invalidate();
    void utils.admin.overview.invalidate();
  };
  const update = trpc.admin.users.update.useMutation({
    onSuccess: (r) => {
      toast.success(r.changes.length ? `Updated: ${r.changes.join("; ")}` : "No changes");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const setUserStatus = trpc.admin.users.setStatus.useMutation({
    onSuccess: (r) => {
      toast.success(`Account ${r.status === "active" ? "reactivated" : "suspended"} (audited)`);
      setConfirm(null);
      setReason("");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const total = list.data?.total ?? 0;
  const rows = list.data?.rows ?? [];

  return (
    <div className="space-y-5">
      <SectionHeader eyebrow="Identity & Access" title="User management" description="Search, re-role, suspend or reactivate any account across farmer, government and supply-chain portals. Every change is written to the audit log." />
      <ErrorNote error={list.error} />

      <Panel
        title="Accounts"
        subtitle={list.data ? `${total} matching` : "Loading…"}
        icon={Users}
        accent="violet"
        actions={
          <div className="hidden md:flex items-center gap-2">
            <StatusBadge status="active" label={`${rows.filter((r) => r.status === "active").length} active on page`} />
          </div>
        }
      >
        <div className="mb-3 flex flex-col sm:flex-row flex-wrap gap-2">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setOffset(0);
            }}
            placeholder="Name, e-mail, phone or id…"
          />
          <Select<UserRole>
            label="Role filter"
            value={role}
            onChange={(v) => {
              setRole(v);
              setOffset(0);
            }}
            options={[{ value: "", label: "All roles" }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))]}
          />
          <Select<Status>
            label="Status filter"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setOffset(0);
            }}
            options={[
              { value: "", label: "Any status" },
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
              { value: "pending_verification", label: "Pending verification" },
            ]}
          />
        </div>

        {!list.data ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="No users match these filters" />
        ) : (
          <DataTable head={["Name", "Contact", "Role", "Organisation", "Lang", "Tier", "Status", "Last active", ""]}>
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-white/[0.02]">
                <Td>
                  <div className="text-slate-100">{u.name}</div>
                  <div className="telemetry text-[10.5px] text-slate-500">{u.id}</div>
                </Td>
                <Td mono className="text-slate-400">
                  {u.email ?? (u.phone ? maskMiddle(u.phone) : "—")}
                </Td>
                <Td>
                  <Select<UserRole>
                    label={`Role for ${u.name}`}
                    value={u.role}
                    onChange={(v) => v && v !== u.role && update.mutate({ id: u.id, role: v })}
                    options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
                    className="h-8 text-xs"
                  />
                </Td>
                <Td className="text-slate-400">{u.orgName ?? "—"}</Td>
                <Td mono>{u.language}</Td>
                <Td mono className="text-slate-400">
                  {u.subscriptionTier}
                </Td>
                <Td>
                  <StatusBadge status={u.status} />
                </Td>
                <Td>
                  <TimeAgo date={u.lastActive} className="text-slate-400" />
                </Td>
                <Td className="whitespace-nowrap text-right">
                  <button onClick={() => setDetail(u)} className="p-1.5 text-slate-400 hover:text-violet-300" aria-label="View details" title="Details">
                    <Eye size={15} />
                  </button>
                  {u.status === "suspended" ? (
                    <button onClick={() => setConfirm({ user: u, to: "active" })} className="p-1.5 text-emerald-400 hover:text-emerald-300" aria-label="Reactivate" title="Reactivate">
                      <UserCheck size={15} />
                    </button>
                  ) : (
                    <button onClick={() => setConfirm({ user: u, to: "suspended" })} className="p-1.5 text-rose-400 hover:text-rose-300" aria-label="Suspend" title="Suspend">
                      <UserX size={15} />
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}

        {total > PAGE && (
          <div className="mt-3 flex items-center justify-between text-[12px] text-slate-400">
            <span className="telemetry">
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
            </span>
            <div className="flex gap-1">
              <HudButton variant="outline" className="h-8 px-2" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} aria-label="Previous page">
                <ChevronLeft size={14} />
              </HudButton>
              <HudButton variant="outline" className="h-8 px-2" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} aria-label="Next page">
                <ChevronRight size={14} />
              </HudButton>
            </div>
          </div>
        )}
      </Panel>

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ""}>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-violet-500 font-semibold text-slate-950">{detail.name[0]}</div>
              <div>
                <div className="text-white">{detail.name}</div>
                <div className="text-xs text-slate-400">{ROLE_LABELS[detail.role]}</div>
              </div>
              <StatusBadge status={detail.status} className="ml-auto" />
            </div>
            <div className="hud-panel p-3">
              <KV k="User id" v={detail.id} mono />
              <KV k="E-mail" v={detail.email ?? "—"} mono />
              <KV k="Phone" v={detail.phone ? maskMiddle(detail.phone) : "—"} mono />
              <KV k="Language" v={detail.language} mono />
              <KV k="Organisation" v={detail.orgName ?? "—"} />
              <KV k="Farmer profile" v={detail.farmerId ?? "—"} mono />
              <KV k="Created" v={new Date(detail.createdAt).toISOString().slice(0, 10)} mono />
              <KV k="Last active" v={<TimeAgo date={detail.lastActive} />} />
            </div>
            <div className="hud-panel p-3">
              <div className="hud-label mb-2">Subscription</div>
              {detail.subscription ? (
                <>
                  <KV k="Plan" v={detail.subscription.plan} mono />
                  <KV k="Status" v={<StatusBadge status={detail.subscription.status} />} />
                  <KV k="MRR" v={fmtUsd(detail.subscription.mrrUsd)} mono />
                  <KV k="Provider" v={detail.subscription.provider} mono />
                  <KV k="Period end" v={new Date(detail.subscription.currentPeriodEnd).toISOString().slice(0, 10)} mono />
                </>
              ) : (
                <div className="text-xs text-slate-500">Covered by organisation plan / none.</div>
              )}
            </div>
            <div className="flex gap-2">
              {detail.status === "suspended" ? (
                <HudButton className="flex-1" onClick={() => setConfirm({ user: detail, to: "active" })}>
                  <UserCheck size={14} /> Reactivate
                </HudButton>
              ) : (
                <HudButton variant="danger" className="flex-1" onClick={() => setConfirm({ user: detail, to: "suspended" })}>
                  <UserX size={14} /> Suspend
                </HudButton>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.to === "suspended" ? `Suspend ${confirm.user.name}?` : `Reactivate ${confirm?.user.name}?`}
        footer={
          <>
            <HudButton variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </HudButton>
            <HudButton
              variant={confirm?.to === "suspended" ? "danger" : "primary"}
              disabled={setUserStatus.isPending}
              onClick={() => confirm && setUserStatus.mutate({ id: confirm.user.id, status: confirm.to, reason: reason.trim() || undefined })}
            >
              {setUserStatus.isPending ? "Saving…" : confirm?.to === "suspended" ? "Suspend account" : "Reactivate"}
            </HudButton>
          </>
        }
      >
        <p className="text-xs text-slate-400 mb-3">
          {confirm?.to === "suspended" ? "The user will be blocked from signing in. Alerts already queued are still delivered." : "The user regains access immediately."} This action is audited.
        </p>
        <label className="hud-label">Reason (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 300))}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-700/70 bg-slate-950/60 p-2 text-sm text-slate-100 outline-none focus:border-violet-500/60"
          placeholder="e.g. duplicate account, abuse report #412"
        />
      </Modal>
    </div>
  );
}
