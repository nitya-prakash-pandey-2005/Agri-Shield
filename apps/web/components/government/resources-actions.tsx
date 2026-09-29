"use client";

/**
 * Resource-request mutations + the modals shared by the queue and kanban:
 * new request, modify, reject, and the status timeline.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Clock } from "lucide-react";
import type { ResourceType } from "@agri-shield/types";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { HudButton, RiskPill } from "@/components/hud";
import { useGovInput } from "./scope";
import { dateTime, ErrorNote, Field, fmtInt, inputCls, KeyValue, Modal, Pill, RESOURCE_COLOR, selectCls, STATUS_COLOR } from "./ui";

export type RequestRow = RouterOutputs["government"]["getResourceRequests"][number];
export type Priority = "low" | "medium" | "high" | "critical";
export const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];
export const PRIORITY_COLOR: Record<string, string> = { low: "#94a3b8", medium: "#fbbf24", high: "#fb923c", critical: "#f87171" };

export function useResourceMutations() {
  const utils = trpc.useUtils();
  const invalidate = () => {
    void utils.government.getResourceRequests.invalidate();
    void utils.government.getResourceInventory.invalidate();
    void utils.government.getShortages.invalidate();
    void utils.government.getContext.invalidate();
    void utils.government.getOverview.invalidate();
    void utils.government.getRegionMap.invalidate();
  };
  const onError = (e: { message: string }) => toast.error(e.message);
  return {
    approve: trpc.government.approveResourceRequest.useMutation({
      onSuccess: (r) => (toast.success(`Approved ${r.id}`, { description: `${fmtInt(r.quantity)} ${r.resourceType} ready for dispatch` }), invalidate()),
      onError,
    }),
    reject: trpc.government.rejectResourceRequest.useMutation({ onSuccess: (r) => (toast.message(`Rejected ${r.id}`), invalidate()), onError }),
    modify: trpc.government.modifyResourceRequest.useMutation({ onSuccess: (r) => (toast.success(`Updated ${r.id}`), invalidate()), onError }),
    request: trpc.government.requestResources.useMutation({
      onSuccess: (r) => (toast.success(`Request ${r.id} submitted`, { description: "Queued for approval" }), invalidate()),
      onError,
    }),
    deliver: trpc.government.markDelivered.useMutation({ onSuccess: (r) => (toast.success(`Delivery confirmed · ${r.id}`), invalidate()), onError }),
  };
}

type ResourceOption = { type: ResourceType; label: string; unit: string };
type DistrictOption = { id: string; name: string; riskLevel: string };

// ─── New request ──────────────────────────────────────────────────────────

export function NewRequestModal({
  open,
  onClose,
  resources,
  districts,
}: {
  open: boolean;
  onClose: () => void;
  resources: ResourceOption[];
  districts: DistrictOption[];
}) {
  const scope = useGovInput();
  const { request } = useResourceMutations();
  const [type, setType] = useState<ResourceType>("pumps");
  const [qty, setQty] = useState(10);
  const [districtId, setDistrictId] = useState("");
  const [priority, setPriority] = useState<Priority>("high");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!open) return;
    setType(resources[0]?.type ?? "pumps");
    setQty(10);
    setDistrictId(districts[0]?.id ?? "");
    setPriority("high");
    setNotes("");
    request.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const unit = resources.find((r) => r.type === type)?.unit ?? "units";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New resource request"
      subtitle="Submitted requests enter the approval queue for regional / national admins."
      footer={
        <>
          <HudButton variant="ghost" onClick={onClose}>
            Cancel
          </HudButton>
          <HudButton
            disabled={!districtId || qty < 1 || request.isPending}
            onClick={() =>
              request.mutate(
                { ...scope, resourceType: type, quantity: qty, targetDistrictId: districtId, priority, notes: notes.trim() || undefined },
                { onSuccess: onClose }
              )
            }
          >
            {request.isPending ? "Submitting…" : "Submit request"}
          </HudButton>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Resource">
          <select value={type} onChange={(e) => setType(e.target.value as ResourceType)} className={selectCls}>
            {resources.map((r) => (
              <option key={r.type} value={r.type} className="bg-slate-900">
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Quantity (${unit})`}>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className={inputCls} />
        </Field>
        <Field label="Destination district">
          <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className={selectCls}>
            {districts.map((d) => (
              <option key={d.id} value={d.id} className="bg-slate-900">
                {d.name} — {d.riskLevel}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={selectCls}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p} className="bg-slate-900">
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Situation on the ground, delivery point, contact…" className={inputCls} />
        </Field>
      </div>
      <ErrorNote className="mt-3" error={request.error} />
    </Modal>
  );
}

// ─── Modify ───────────────────────────────────────────────────────────────

export function ModifyModal({
  request: r,
  onClose,
  resources,
  districts,
}: {
  request: RequestRow | null;
  onClose: () => void;
  resources: ResourceOption[];
  districts: DistrictOption[];
}) {
  const scope = useGovInput();
  const { modify } = useResourceMutations();
  const [type, setType] = useState<ResourceType>("pumps");
  const [qty, setQty] = useState(1);
  const [districtId, setDistrictId] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!r) return;
    setType(r.resourceType);
    setQty(r.quantity);
    setDistrictId(r.targetDistrictId);
    setPriority(r.priority);
    setNotes(r.notes ?? "");
    modify.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id]);
  const unit = resources.find((x) => x.type === type)?.unit ?? "units";
  return (
    <Modal
      open={!!r}
      onClose={onClose}
      title={`Modify request ${r?.id ?? ""}`}
      subtitle={r ? `Requested by ${r.requestedByName} · status ${r.status}` : undefined}
      footer={
        <>
          <HudButton variant="ghost" onClick={onClose}>
            Cancel
          </HudButton>
          <HudButton
            disabled={!r || modify.isPending}
            onClick={() =>
              r &&
              modify.mutate(
                {
                  ...scope,
                  id: r.id,
                  quantity: qty !== r.quantity ? qty : undefined,
                  priority: priority !== r.priority ? priority : undefined,
                  resourceType: type !== r.resourceType ? type : undefined,
                  targetDistrictId: districtId !== r.targetDistrictId ? districtId : undefined,
                  notes: notes !== (r.notes ?? "") ? notes : undefined,
                },
                { onSuccess: onClose }
              )
            }
          >
            {modify.isPending ? "Saving…" : "Save changes"}
          </HudButton>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Resource">
          <select value={type} onChange={(e) => setType(e.target.value as ResourceType)} className={selectCls}>
            {resources.map((x) => (
              <option key={x.type} value={x.type} className="bg-slate-900">
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Quantity (${unit})`}>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className={inputCls} />
        </Field>
        <Field label="Destination district">
          <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className={selectCls}>
            {districts.map((d) => (
              <option key={d.id} value={d.id} className="bg-slate-900">
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={selectCls}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p} className="bg-slate-900">
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <ErrorNote className="mt-3" error={modify.error} />
    </Modal>
  );
}

// ─── Reject ───────────────────────────────────────────────────────────────

export function RejectModal({ request: r, onClose }: { request: RequestRow | null; onClose: () => void }) {
  const scope = useGovInput();
  const { reject } = useResourceMutations();
  const [reason, setReason] = useState("");
  useEffect(() => {
    setReason("");
    reject.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id]);
  return (
    <Modal
      open={!!r}
      onClose={onClose}
      width="max-w-lg"
      title={`Reject request ${r?.id ?? ""}`}
      subtitle={r ? `${fmtInt(r.quantity)} ${r.unit} of ${r.resourceLabel} → ${r.districtName}` : undefined}
      footer={
        <>
          <HudButton variant="ghost" onClick={onClose}>
            Cancel
          </HudButton>
          <HudButton variant="danger" disabled={reason.trim().length < 3 || reject.isPending} onClick={() => r && reject.mutate({ ...scope, id: r.id, reason: reason.trim() }, { onSuccess: onClose })}>
            {reject.isPending ? "Rejecting…" : "Reject request"}
          </HudButton>
        </>
      }
    >
      <Field label="Reason (sent to requester, recorded in audit trail)">
        <textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Covered by pre-positioned stock at Barisal depot" className={inputCls} />
      </Field>
      <ErrorNote className="mt-3" error={reject.error} />
    </Modal>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────

export function TimelineModal({ request: r, onClose }: { request: RequestRow | null; onClose: () => void }) {
  return (
    <Modal
      open={!!r}
      onClose={onClose}
      width="max-w-lg"
      title={r ? `${r.id} · ${r.resourceLabel}` : ""}
      subtitle={r ? `${fmtInt(r.quantity)} ${r.unit} → ${r.districtName}` : undefined}
    >
      {r && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Pill color={STATUS_COLOR[r.status]}>{r.status}</Pill>
            <Pill color={PRIORITY_COLOR[r.priority]}>{r.priority}</Pill>
            <RiskPill level={r.districtRisk} />
            <span className="h-2 w-2 rounded-full" style={{ background: RESOURCE_COLOR[r.resourceType] }} />
          </div>
          <div className="space-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <KeyValue k="Requested by" v={r.requestedByName} />
            <KeyValue k="Created" v={dateTime(r.createdAt)} />
            {r.vehicle && <KeyValue k="Vehicle" v={r.vehicle} />}
            {r.dispatch && <KeyValue k="Route" v={`${r.dispatch.depotName} → ${r.districtName} · ${r.dispatch.distanceKm} km · ETA ${r.dispatch.etaHours} h`} />}
            {r.notes && <KeyValue k="Notes" v={r.notes} />}
          </div>
          <ol className="relative ml-2 border-l border-white/10 pl-5">
            {r.timeline.map((t, i) => {
              const c = STATUS_COLOR[t.status] ?? "#94a3b8";
              const last = i === r.timeline.length - 1;
              return (
                <li key={i} className="relative pb-4 last:pb-0">
                  <span className="absolute -left-[27px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full" style={{ background: c, boxShadow: last ? `0 0 12px ${c}` : undefined }}>
                    {!last && <Check size={8} className="text-slate-950" />}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="telemetry text-[11px] uppercase tracking-wider" style={{ color: c }}>
                      {t.status}
                    </span>
                    <span className="flex items-center gap-1 telemetry text-[10px] text-slate-500">
                      <Clock size={10} /> {dateTime(t.at)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-300">{t.by}</div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Modal>
  );
}
