"use client";

/** Kanban (drag a card to change status) and table views of incidents. */
import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, CheckSquare, Globe, MoveRight } from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { fmtUsd, timeAgo } from "@/components/portfolio/format";
import { Avatar } from "@/components/collab/Avatar";
import { STATUSES, STATUS_META, canTransition, type IncidentStatus } from "./meta";
import { HazardChip, SeverityBadge, SlaTimer, StatusBadge } from "./ui";

export type IncidentRow = RouterOutputs["incidents"]["list"]["rows"][number];

function Card({ r, onDragStart }: { r: IncidentRow; onDragStart: (id: string) => void }) {
  return (
    <motion.div layout layoutId={`card-${r.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Link
        href={`/app/incidents/${r.id}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/incident", r.id);
          e.dataTransfer.effectAllowed = "move";
          onDragStart(r.id);
        }}
        className="group relative block overflow-hidden rounded-lg border border-white/5 bg-slate-950/60 p-3 transition hover:border-sky-400/40 hover:bg-slate-900/70"
      >
        <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: r.severity === "SEV1" ? "#f43f5e" : r.severity === "SEV2" ? "#f97316" : r.severity === "SEV3" ? "#fbbf24" : "#38bdf8" }} />
        <div className="flex items-center gap-1.5">
          <span className="telemetry text-[10px] text-slate-500">INC-{r.number}</span>
          <SeverityBadge severity={r.severity} />
          {r.demo && <span className="rounded bg-slate-800 px-1 text-[9px] uppercase text-slate-400">demo</span>}
          {r.publicEnabled && <Globe size={11} className="text-emerald-400" aria-label="Public status page" />}
          <span className="ml-auto">
            <Avatar user={r.commander} size={20} title={r.commander ? `Commander: ${r.commander.name}` : "No commander"} />
          </span>
        </div>
        <div className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug text-slate-100 group-hover:text-white">{r.title}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <HazardChip hazard={r.hazard} />
          <span className="text-[10.5px] text-slate-400">
            {r.assets} assets · {fmtUsd(r.exposureUsd)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          {r.status !== "resolved" ? <SlaTimer inc={r} compact /> : <span className="text-[10px] text-emerald-300">Resolved {timeAgo(r.resolvedAt)}</span>}
          <span className={cn("ml-auto inline-flex items-center gap-1 text-[10px] telemetry", r.overdueTasks ? "text-rose-300" : "text-slate-400")}>
            <CheckSquare size={10} />
            {r.tasksDone}/{r.tasksTotal}
            {r.overdueTasks ? ` · ${r.overdueTasks} late` : ""}
          </span>
        </div>
        {r.tasksTotal > 0 && (
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-sky-400" style={{ width: `${(r.tasksDone / r.tasksTotal) * 100}%` }} />
          </div>
        )}
      </Link>
    </motion.div>
  );
}

export function IncidentBoard({ rows }: { rows: IncidentRow[] }) {
  const utils = trpc.useUtils();
  const move = trpc.incidents.setStatus.useMutation();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<IncidentStatus | null>(null);
  const draggingRow = rows.find((r) => r.id === dragging);

  const drop = async (id: string, to: IncidentStatus) => {
    setOver(null);
    setDragging(null);
    const r = rows.find((x) => x.id === id);
    if (!r || r.status === to) return;
    if (!canTransition(r.status, to)) {
      toast.error(`Can't move from ${STATUS_META[r.status].label} straight back to ${STATUS_META[to].label} — step back one stage at a time.`);
      return;
    }
    try {
      const res = await move.mutateAsync({ id, to });
      toast.success(`INC-${r.number} → ${STATUS_META[to].label}`, { description: res.warnings.join(" ") || undefined });
      void utils.incidents.list.invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="-mx-1 overflow-x-auto pb-2">
      <div className="grid min-w-[1060px] grid-cols-5 gap-3 px-1">
        {STATUSES.map((s) => {
          const col = rows.filter((r) => r.status === s);
          const m = STATUS_META[s];
          const allowed = draggingRow ? canTransition(draggingRow.status, s) : false;
          return (
            <div
              key={s}
              onDragOver={(e) => {
                if (!draggingRow || !allowed) return;
                e.preventDefault();
                setOver(s);
              }}
              onDragLeave={() => setOver((o) => (o === s ? null : o))}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/incident");
                if (id) void drop(id, s);
              }}
              className={cn("flex min-h-[320px] flex-col rounded-xl border bg-slate-950/30 p-2 transition", over === s ? "border-sky-400/60 bg-sky-400/5" : dragging && allowed ? "border-dashed border-sky-400/30" : "border-white/5", dragging && !allowed && draggingRow?.status !== s && "opacity-50")}
            >
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="h-2 w-2 rounded-full" style={{ background: m.color, boxShadow: `0 0 8px ${m.color}` }} />
                <span className="text-xs font-semibold text-slate-200">{m.label}</span>
                <span className="telemetry rounded bg-white/5 px-1.5 text-[10px] text-slate-400">{col.length}</span>
              </div>
              <p className="mb-2 px-1 text-[10px] leading-snug text-slate-500">{m.meaning}</p>
              <div className="flex-1 space-y-2">
                {col.map((r) => (
                  <Card key={r.id} r={r} onDragStart={setDragging} />
                ))}
                {!col.length && <div className="grid h-20 place-items-center rounded-lg border border-dashed border-white/5 text-[10px] text-slate-600">{dragging && allowed ? <span className="inline-flex items-center gap-1 text-sky-300"><MoveRight size={12} />Drop to move</span> : "Nothing here"}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function IncidentTable({ rows }: { rows: IncidentRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2">Incident</th>
            <th className="px-3 py-2">Severity</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Commander</th>
            <th className="px-3 py-2 text-right">Assets</th>
            <th className="px-3 py-2 text-right">Value at risk</th>
            <th className="px-3 py-2">SLA</th>
            <th className="px-3 py-2">Tasks</th>
            <th className="px-3 py-2">Opened</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => (
            <tr key={r.id} className="group hover:bg-white/[0.03]">
              <td className="px-3 py-2.5">
                <Link href={`/app/incidents/${r.id}`} className="block">
                  <span className="telemetry text-[10px] text-slate-500">INC-{r.number}</span>
                  <span className="ml-2 font-medium text-slate-100 group-hover:text-sky-200">{r.title}</span>
                  <span className="ml-2">
                    <HazardChip hazard={r.hazard} />
                  </span>
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <SeverityBadge severity={r.severity} />
              </td>
              <td className="px-3 py-2.5">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-slate-300">
                  <Avatar user={r.commander} size={20} />
                  {r.commander?.name ?? "—"}
                </span>
              </td>
              <td className="telemetry px-3 py-2.5 text-right text-slate-200">{r.assets}</td>
              <td className="telemetry px-3 py-2.5 text-right text-slate-200">{fmtUsd(r.varUsd)}</td>
              <td className="px-3 py-2.5">{r.status === "resolved" ? <span className="text-emerald-300">Met {r.metrics.clocks.filter((c) => c.state === "met").length}/3</span> : <SlaTimer inc={r} compact />}</td>
              <td className="telemetry px-3 py-2.5 text-slate-300">
                {r.tasksDone}/{r.tasksTotal}
                {r.overdueTasks ? <span className="ml-1 text-rose-300">({r.overdueTasks} late)</span> : null}
              </td>
              <td className="px-3 py-2.5 text-slate-400">{timeAgo(r.createdAt)}</td>
              <td className="px-3 py-2.5 text-right">
                <Link href={`/app/incidents/${r.id}`} className="text-slate-500 group-hover:text-sky-300" aria-label="Open">
                  <ArrowRight size={14} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
