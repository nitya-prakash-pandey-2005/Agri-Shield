"use client";

/** Incoming request queue (pending): approve (with optional qty change), reject, modify. */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Inbox, Pencil, X } from "lucide-react";
import { Panel, EmptyState, HudButton, RiskPill, Skeleton } from "@/components/hud";
import { useGovInput } from "./scope";
import { PRIORITY_COLOR, useResourceMutations, type RequestRow } from "./resources-actions";
import { ago, ErrorNote, fmtInt, Pill, RESOURCE_COLOR, RESOURCE_ICON } from "./ui";

export function RequestQueue({
  requests,
  loading,
  error,
  canApprove,
  canRequest,
  onModify,
  onReject,
  onOpen,
}: {
  requests: RequestRow[];
  loading: boolean;
  error: { message: string } | null;
  canApprove: boolean;
  canRequest: boolean;
  onModify: (r: RequestRow) => void;
  onReject: (r: RequestRow) => void;
  onOpen: (r: RequestRow) => void;
}) {
  const scope = useGovInput();
  const { approve } = useResourceMutations();
  const [qty, setQty] = useState<Record<string, number>>({});
  const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const pending = requests.filter((r) => r.status === "pending").sort((a, b) => order[a.priority] - order[b.priority] || +new Date(a.createdAt) - +new Date(b.createdAt));

  return (
    <Panel title="Request queue" subtitle={`${pending.length} awaiting decision · from district & field officers`} icon={Inbox} accent="amber" className="h-full" bodyClassName="max-h-[470px] overflow-y-auto">
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : error ? (
        <ErrorNote error={error} />
      ) : !pending.length ? (
        <EmptyState icon={Inbox} title="Queue clear">
          No pending requests. New requests from district officers appear here in real time.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {pending.map((r) => {
              const Icon = RESOURCE_ICON[r.resourceType] ?? Inbox;
              const color = RESOURCE_COLOR[r.resourceType] ?? "#94a3b8";
              const q = qty[r.id] ?? r.quantity;
              return (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24, height: 0 }}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
                  style={{ boxShadow: `inset 3px 0 0 ${PRIORITY_COLOR[r.priority]}` }}
                >
                  <button onClick={() => onOpen(r)} className="block w-full text-left">
                    <div className="flex items-center gap-2">
                      <Icon size={14} style={{ color }} />
                      <span className="text-sm font-medium text-slate-100">
                        <span className="telemetry">{fmtInt(r.quantity)}</span> {r.unit} · {r.resourceLabel}
                      </span>
                      <Pill color={PRIORITY_COLOR[r.priority]} className="ml-auto">
                        {r.priority}
                      </Pill>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span className="text-slate-200">{r.districtName}</span>
                      <RiskPill level={r.districtRisk} />
                      <span>· {r.requestedByName}</span>
                      <span className="telemetry text-slate-500">· {ago(r.createdAt)}</span>
                    </div>
                    {r.notes && <p className="mt-1.5 line-clamp-2 text-[11px] italic text-slate-400">“{r.notes}”</p>}
                  </button>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {canApprove && (
                      <>
                        <input
                          type="number"
                          min={1}
                          aria-label="Approved quantity"
                          value={q}
                          onChange={(e) => setQty((s) => ({ ...s, [r.id]: Math.max(1, Number(e.target.value) || 1) }))}
                          className="w-20 rounded-md border border-white/10 bg-[#060a16]/80 px-2 py-1 text-xs telemetry text-slate-100 outline-none focus:border-emerald-500/60"
                        />
                        <HudButton
                          className="px-2.5 py-1 text-xs"
                          disabled={approve.isPending}
                          onClick={() => approve.mutate({ ...scope, id: r.id, quantity: q !== r.quantity ? q : undefined })}
                        >
                          <Check size={12} /> Approve{q !== r.quantity ? ` ${fmtInt(q)}` : ""}
                        </HudButton>
                        <HudButton variant="outline" className="px-2.5 py-1 text-xs" onClick={() => onReject(r)}>
                          <X size={12} /> Reject
                        </HudButton>
                      </>
                    )}
                    {canRequest && (
                      <HudButton variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => onModify(r)}>
                        <Pencil size={12} /> Modify
                      </HudButton>
                    )}
                    {!canApprove && <span className="text-[10px] text-slate-500">Awaiting regional / national approval</span>}
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}
