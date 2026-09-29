"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, CheckCircle2, Flag, Globe, Link2, MapPinned, Megaphone, NotebookPen, PlayCircle, ShieldAlert, UserCog, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Avatar } from "@/components/collab/Avatar";
import { clockTime, groupByDay, relTime } from "@/components/collab/shared";
import { PfButton } from "@/components/portfolio/ui";

type Entry = RouterOutputs["incidents"]["get"]["timeline"][number];

const KIND: Record<Entry["kind"], { icon: LucideIcon; color: string }> = {
  created: { icon: PlayCircle, color: "#f472b6" },
  status: { icon: Flag, color: "#38bdf8" },
  severity: { icon: ShieldAlert, color: "#f97316" },
  ack: { icon: CheckCircle2, color: "#34d399" },
  role: { icon: UserCog, color: "#a78bfa" },
  note: { icon: NotebookPen, color: "#e2e8f0" },
  task: { icon: CheckCircle2, color: "#22d3ee" },
  update: { icon: Megaphone, color: "#fbbf24" },
  link: { icon: Link2, color: "#94a3b8" },
  asset: { icon: Users, color: "#94a3b8" },
  area: { icon: MapPinned, color: "#f472b6" },
  review: { icon: Globe, color: "#34d399" },
  firing: { icon: BellRing, color: "#f87171" },
};

export function Timeline({ incidentId, entries, timeZone, readOnly }: { incidentId: string; entries: Entry[]; timeZone?: string; readOnly?: boolean }) {
  const utils = trpc.useUtils();
  const add = trpc.incidents.addNote.useMutation();
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<"all" | "notes" | "status">("all");
  const shown = [...entries]
    .filter((e) => filter === "all" || (filter === "notes" ? e.kind === "note" : ["status", "severity", "created", "ack"].includes(e.kind)))
    .reverse();
  const groups = groupByDay(shown, timeZone ?? "UTC");

  const submit = async () => {
    if (!text.trim()) return;
    try {
      await add.mutateAsync({ id: incidentId, text });
      setText("");
      void utils.incidents.get.invalidate({ id: incidentId });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div>
      {!readOnly && (
        <div className="mb-3 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} placeholder="Log what just happened (field report, decision, call made)…" className="min-w-0 flex-1 rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-400/70 focus:outline-none" aria-label="Add timeline note" />
          <PfButton size="sm" onClick={() => void submit()} loading={add.isPending} disabled={!text.trim()}>
            Log
          </PfButton>
        </div>
      )}
      <div className="mb-2 flex gap-1 text-[11px]">
        {(["all", "status", "notes"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-2 py-0.5 capitalize ${filter === f ? "bg-sky-400/15 text-sky-200" : "text-slate-500 hover:text-slate-300"}`}>
            {f === "status" ? "Milestones" : f}
          </button>
        ))}
      </div>
      <div className="max-h-[520px] space-y-4 overflow-y-auto pr-1">
        {groups.map((g) => (
          <div key={g.day}>
            <div className="hud-label sticky top-0 z-10 mb-2 bg-[#070d1c]/90 py-1 backdrop-blur">{g.label}</div>
            <ol className="relative ml-3 border-l border-white/10">
              <AnimatePresence initial={false}>
                {g.items.map((e) => {
                  const k = KIND[e.kind];
                  const Icon = k.icon;
                  return (
                    <motion.li key={e.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="relative mb-3 pl-5">
                      <span className="absolute -left-[9px] top-0.5 grid h-[18px] w-[18px] place-items-center rounded-full border border-white/10 bg-[#070d1c]" style={{ color: k.color }}>
                        <Icon size={10} />
                      </span>
                      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                        <span className="telemetry text-slate-400" title={new Date(e.at).toISOString()}>
                          {clockTime(e.at, timeZone)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Avatar user={e.actor} size={14} />
                          {e.actorName}
                        </span>
                        <span>· {relTime(e.at)}</span>
                      </div>
                      <p className={`mt-0.5 text-[13px] leading-snug ${e.kind === "note" ? "text-slate-200" : "text-slate-300"}`}>{e.text}</p>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
          </div>
        ))}
        {!shown.length && <p className="text-xs text-slate-500">Nothing logged yet.</p>}
      </div>
    </div>
  );
}
