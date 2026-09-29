"use client";

/** Status board: Pending → Approved → Dispatched → Delivered (+ collapsed Rejected). */
import { useEffect, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { CheckCircle2, ChevronDown, Clock, KanbanSquare, PackageCheck, Send, Truck } from "lucide-react";
import { HudButton, Panel, Skeleton } from "@/components/hud";
import { cn } from "@/lib/utils";
import { useGovInput } from "./scope";
import { PRIORITY_COLOR, useResourceMutations, type RequestRow } from "./resources-actions";
import { ago, ErrorNote, fmtInt, hhmm, Pill, RESOURCE_COLOR, RESOURCE_ICON, STATUS_COLOR } from "./ui";

const COLUMNS = [
  { key: "pending", label: "Pending", icon: Clock },
  { key: "approved", label: "Approved", icon: CheckCircle2 },
  { key: "dispatched", label: "Dispatched", icon: Truck },
  { key: "delivered", label: "Delivered", icon: PackageCheck },
] as const;

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Card({
  r,
  now,
  canApprove,
  canRequest,
  onOpen,
  onDispatch,
}: {
  r: RequestRow;
  now: number;
  canApprove: boolean;
  canRequest: boolean;
  onOpen: (r: RequestRow) => void;
  onDispatch: (r: RequestRow) => void;
}) {
  const scope = useGovInput();
  const { deliver } = useResourceMutations();
  const Icon = RESOURCE_ICON[r.resourceType] ?? Truck;
  const color = RESOURCE_COLOR[r.resourceType] ?? "#94a3b8";
  const last = r.timeline[r.timeline.length - 1];
  let progress: number | null = null;
  let remaining: number | null = null;
  if (r.status === "dispatched") {
    const start = r.dispatch ? +new Date(r.dispatch.dispatchedAt) : +new Date(r.timeline.find((t) => t.status === "dispatched")?.at ?? r.createdAt);
    const eta = r.dispatch?.etaHours ?? null;
    if (eta) {
      const el = (now - start) / 3_600_000;
      progress = Math.min(100, (el / eta) * 100);
      remaining = Math.max(0, eta - el);
    }
  }
  return (
    <motion.div
      layout
      layoutId={`req-${r.id}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
      whileHover={{ y: -2 }}
      onClick={() => onOpen(r)}
      className="cursor-pointer rounded-lg border border-white/[0.06] bg-[#0b1224]/80 p-2.5 text-xs"
      style={{ boxShadow: `inset 2px 0 0 ${PRIORITY_COLOR[r.priority]}` }}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={12} style={{ color }} />
        <span className="truncate font-medium text-slate-100">
          <span className="telemetry">{fmtInt(r.quantity)}</span> {r.resourceLabel}
        </span>
        <span className="ml-auto telemetry text-[9px] text-slate-500">{r.id.slice(-6)}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-slate-400">
        <span className="text-slate-300">{r.districtName}</span>
        <Pill color={PRIORITY_COLOR[r.priority]} className="px-1 py-0 text-[8.5px]">
          {r.priority}
        </Pill>
        <span className="ml-auto telemetry text-[10px]">{last ? ago(last.at) : ago(r.createdAt)}</span>
      </div>
      {r.status === "dispatched" && (
        <div className="mt-2 space-y-1">
          <div className="truncate telemetry text-[10px] text-violet-300">{r.vehicle ?? "Vehicle assigned"}</div>
          {progress != null ? (
            <>
              <div className="h-1 overflow-hidden rounded-full bg-slate-800">
                <motion.div className="h-full rounded-full bg-violet-400" initial={{ width: 0 }} animate={{ width: `${progress}%` }} style={{ boxShadow: "0 0 8px #a78bfa" }} />
              </div>
              <div className="flex justify-between telemetry text-[9.5px] text-slate-500">
                <span>{r.dispatch ? `${r.dispatch.distanceKm} km · ETA ${r.dispatch.etaHours} h` : ""}</span>
                <span>{remaining! > 0 ? `${remaining!.toFixed(1)} h left` : "arriving"}</span>
              </div>
            </>
          ) : (
            <div className="telemetry text-[9.5px] text-slate-500">In transit (legacy dispatch, no ETA)</div>
          )}
          {canRequest && (
            <HudButton
              variant="outline"
              className="mt-1 w-full px-2 py-1 text-[11px]"
              disabled={deliver.isPending}
              onClick={(e) => {
                e.stopPropagation();
                deliver.mutate({ ...scope, id: r.id });
              }}
            >
              <PackageCheck size={12} /> Mark delivered
            </HudButton>
          )}
        </div>
      )}
      {r.status === "approved" && canApprove && (
        <HudButton
          className="mt-2 w-full px-2 py-1 text-[11px]"
          onClick={(e) => {
            e.stopPropagation();
            onDispatch(r);
          }}
        >
          <Send size={12} /> Dispatch
        </HudButton>
      )}
      {r.status === "delivered" && last && <div className="mt-1 telemetry text-[9.5px] text-emerald-400/80">Delivered {hhmm(last.at)} UTC</div>}
    </motion.div>
  );
}

export function RequestKanban({
  requests,
  loading,
  error,
  canApprove,
  canRequest,
  onOpen,
  onDispatch,
}: {
  requests: RequestRow[];
  loading: boolean;
  error: { message: string } | null;
  canApprove: boolean;
  canRequest: boolean;
  onOpen: (r: RequestRow) => void;
  onDispatch: (r: RequestRow) => void;
}) {
  const now = useNow();
  const [showRejected, setShowRejected] = useState(false);
  const rejected = requests.filter((r) => r.status === "rejected");
  return (
    <Panel title="Status tracking" subtitle="Pending → Approved → Dispatched → Delivered · updates in real time" icon={KanbanSquare} live>
      {loading ? (
        <div className="grid gap-3 md:grid-cols-4">
          {COLUMNS.map((c) => (
            <Skeleton key={c.key} className="h-60" />
          ))}
        </div>
      ) : error ? (
        <ErrorNote error={error} />
      ) : (
        <LayoutGroup>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const items = requests.filter((r) => r.status === col.key);
              const CIcon = col.icon;
              const c = STATUS_COLOR[col.key]!;
              return (
                <div key={col.key} className="flex min-h-[200px] flex-col rounded-xl border border-white/5 bg-[#060a16]/50">
                  <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
                    <CIcon size={13} style={{ color: c }} />
                    <span className="telemetry text-[10.5px] uppercase tracking-widest text-slate-300">{col.label}</span>
                    <motion.span key={items.length} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="ml-auto rounded-full px-1.5 telemetry text-[10px]" style={{ background: `${c}22`, color: c }}>
                      {items.length}
                    </motion.span>
                  </div>
                  <div className="flex max-h-[420px] flex-1 flex-col gap-2 overflow-y-auto p-2">
                    <AnimatePresence mode="popLayout">
                      {items.map((r) => (
                        <Card key={r.id} r={r} now={now} canApprove={canApprove} canRequest={canRequest} onOpen={onOpen} onDispatch={onDispatch} />
                      ))}
                    </AnimatePresence>
                    {!items.length && <div className="py-8 text-center text-[11px] text-slate-600">No requests</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {rejected.length > 0 && (
            <div className="mt-3 rounded-xl border border-rose-500/15 bg-rose-500/[0.03]">
              <button onClick={() => setShowRejected((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                <span className="telemetry text-[10.5px] uppercase tracking-widest text-rose-300">Rejected</span>
                <span className="rounded-full bg-rose-500/20 px-1.5 telemetry text-[10px] text-rose-300">{rejected.length}</span>
                <ChevronDown size={13} className={cn("ml-auto text-slate-500 transition-transform", showRejected && "rotate-180")} />
              </button>
              <AnimatePresence initial={false}>
                {showRejected && (
                  <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-4">
                      {rejected.map((r) => (
                        <Card key={r.id} r={r} now={now} canApprove={canApprove} canRequest={canRequest} onOpen={onOpen} onDispatch={onDispatch} />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </LayoutGroup>
      )}
    </Panel>
  );
}
