"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, Check, ListPlus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/collab/Avatar";
import { PfButton } from "@/components/portfolio/ui";
import { HAZARDS, HAZARD_META, ROLE_META, type HazardType } from "./meta";

type Detail = RouterOutputs["incidents"]["get"];
type Task = Detail["tasks"][number];
const PHASES = ["Mobilise", "Comms", "Respond", "Recover"] as const;

function dueLabel(t: Task, now: number) {
  if (!t.dueAt) return null;
  const ms = new Date(t.dueAt).getTime() - now;
  const h = Math.round(Math.abs(ms) / 3_600_000);
  const txt = Math.abs(ms) < 3_600_000 ? `${Math.round(Math.abs(ms) / 60_000)}m` : h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
  return { late: !t.done && ms < 0, text: t.done ? `due ${new Date(t.dueAt).toLocaleDateString()}` : ms < 0 ? `${txt} late` : `due in ${txt}` };
}

const toLocalInput = (d: Date | string | null) => {
  if (!d) return "";
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function TaskList({ inc, readOnly }: { inc: Detail; readOnly?: boolean }) {
  const utils = trpc.useUtils();
  const upd = trpc.incidents.updateTask.useMutation();
  const add = trpc.incidents.addTask.useMutation();
  const del = trpc.incidents.deleteTask.useMutation();
  const tmpl = trpc.incidents.applyTemplate.useMutation();
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<string>("");
  const [phase, setPhase] = useState<(typeof PHASES)[number]>("Respond");
  const [hideDone, setHideDone] = useState(false);
  const [showTmpl, setShowTmpl] = useState(false);
  const now = Date.now();
  const byId = useMemo(() => new Map(inc.members.map((m) => [m.id, m])), [inc.members]);
  const refresh = () => utils.incidents.get.invalidate({ id: inc.id });

  const patch = async (taskId: string, p: Omit<Parameters<typeof upd.mutateAsync>[0], "id" | "taskId">) => {
    try {
      await upd.mutateAsync({ id: inc.id, taskId, ...p });
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const done = inc.tasks.filter((t) => t.done).length;
  const late = inc.tasks.filter((t) => !t.done && t.dueAt && new Date(t.dueAt).getTime() < now).length;

  return (
    <div id="tasks">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="telemetry text-slate-100">
              {done}/{inc.tasks.length}
            </span>
            done{late ? <span className="text-rose-300">· {late} overdue</span> : null}
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-800">
            <motion.div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400" animate={{ width: `${inc.tasks.length ? (done / inc.tasks.length) * 100 : 0}%` }} />
          </div>
        </div>
        <button onClick={() => setHideDone((v) => !v)} className="text-[11px] text-slate-500 hover:text-slate-300">
          {hideDone ? "Show done" : "Hide done"}
        </button>
        {!readOnly && (
          <div className="relative">
            <PfButton size="sm" variant="outline" onClick={() => setShowTmpl((v) => !v)}>
              <ListPlus size={12} /> Checklist
            </PfButton>
            {showTmpl && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-white/10 bg-[#081225] p-1 shadow-2xl">
                {HAZARDS.map((h: HazardType) => (
                  <button
                    key={h}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-white/5"
                    onClick={async () => {
                      setShowTmpl(false);
                      const r = await tmpl.mutateAsync({ id: inc.id, hazard: h }).catch((e) => (toast.error(e.message), null));
                      if (r) toast.success(r.added ? `${r.added} tasks added` : "All checklist tasks are already on the list");
                      void refresh();
                    }}
                  >
                    {HAZARD_META[h].label} playbook
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {PHASES.map((ph) => {
          const tasks = inc.tasks.filter((t) => t.phase === ph && (!hideDone || !t.done));
          if (!tasks.length) return null;
          return (
            <div key={ph}>
              <div className="hud-label mb-1">{ph}</div>
              <ul className="space-y-1">
                {tasks.map((t) => {
                  const d = dueLabel(t, now);
                  const who = t.assigneeId ? byId.get(t.assigneeId) : null;
                  return (
                    <motion.li key={t.id} layout className={cn("group flex items-start gap-2 rounded-lg border px-2 py-1.5 transition", t.done ? "border-transparent bg-white/[0.02]" : d?.late ? "border-rose-500/25 bg-rose-500/5" : "border-white/5 bg-slate-950/40")}>
                      <button
                        disabled={readOnly}
                        onClick={() => void patch(t.id, { done: !t.done })}
                        aria-label={t.done ? "Mark not done" : "Mark done"}
                        className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition", t.done ? "border-emerald-400 bg-emerald-400 text-slate-950" : "border-slate-600 hover:border-sky-400")}
                      >
                        {t.done && <Check size={11} strokeWidth={3} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-[12.5px] leading-snug", t.done ? "text-slate-500 line-through" : "text-slate-200")}>{t.title}</div>
                        {t.detail && !t.done && <div className="text-[10.5px] text-slate-500">{t.detail}</div>}
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px]">
                          <label className="inline-flex items-center gap-1 text-slate-400">
                            <Avatar user={who} size={16} />
                            <select disabled={readOnly} value={t.assigneeId ?? ""} onChange={(e) => void patch(t.id, { assigneeId: e.target.value || null })} className="max-w-[130px] bg-transparent text-[10.5px] text-slate-300 focus:outline-none" aria-label="Assignee">
                              <option value="">Unassigned</option>
                              {inc.members.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          {t.role && <span className="text-slate-600">{ROLE_META[t.role].label}</span>}
                          <label className={cn("inline-flex items-center gap-1", d?.late ? "text-rose-300" : "text-slate-500")} title="Due">
                            <CalendarClock size={11} />
                            {d?.text ?? "no due time"}
                            {!readOnly && <input type="datetime-local" value={toLocalInput(t.dueAt)} onChange={(e) => void patch(t.id, { dueAt: e.target.value ? new Date(e.target.value) : null })} className="w-4 cursor-pointer bg-transparent text-transparent [color-scheme:dark] focus:w-auto focus:text-slate-300" aria-label="Change due time" />}
                          </label>
                        </div>
                      </div>
                      {!readOnly && (
                        <button
                          className="hidden rounded p-0.5 text-slate-600 hover:text-rose-300 group-hover:block"
                          aria-label="Delete task"
                          onClick={async () => {
                            await del.mutateAsync({ id: inc.id, taskId: t.id }).catch((e) => toast.error(e.message));
                            void refresh();
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </motion.li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {!inc.tasks.length && <p className="rounded-lg border border-dashed border-slate-700/70 p-3 text-center text-xs text-slate-500">No tasks yet — add the hazard checklist or your own.</p>}
      </div>

      {!readOnly && (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (title.trim().length < 2) return;
            try {
              await add.mutateAsync({ id: inc.id, title, phase, assigneeId: assignee || null });
              setTitle("");
              void refresh();
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" className="min-w-0 flex-1 rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-400/70 focus:outline-none" aria-label="New task" />
          <select value={phase} onChange={(e) => setPhase(e.target.value as (typeof PHASES)[number])} className="rounded-lg border border-slate-700/80 bg-slate-950/60 px-2 text-xs text-slate-300" aria-label="Phase">
            {PHASES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="max-w-[140px] rounded-lg border border-slate-700/80 bg-slate-950/60 px-2 text-xs text-slate-300" aria-label="Assign to">
            <option value="">Unassigned</option>
            {inc.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <PfButton size="sm" type="submit" loading={add.isPending}>
            <Plus size={12} /> Add
          </PfButton>
        </form>
      )}
    </div>
  );
}
