"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileDown, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Field, PfButton, inputCls } from "@/components/portfolio/ui";
import { Panel } from "@/components/hud";
import { renderReviewPdf } from "./reviewPdf";

type Detail = RouterOutputs["incidents"]["get"];
type Action = { id: string; text: string; ownerId: string | null; dueAt: Date | null; done: boolean };

export function ReviewPanel({ inc, orgName }: { inc: Detail; orgName: string }) {
  const utils = trpc.useUtils();
  const draft = trpc.incidents.draftReview.useQuery({ id: inc.id }, { enabled: !inc.review });
  const save = trpc.incidents.saveReview.useMutation();
  const src = inc.review ?? draft.data;
  const [f, setF] = useState<{ whatHappened: string; impact: string; whatWorked: string; whatToImprove: string; actions: Action[] } | null>(null);

  useEffect(() => {
    if (src && !f) setF({ whatHappened: src.whatHappened, impact: src.impact, whatWorked: src.whatWorked, whatToImprove: src.whatToImprove, actions: src.actions.map((a) => ({ ...a, dueAt: a.dueAt ? new Date(a.dueAt) : null })) });
  }, [src, f]);

  if (!f) return <div className="skeleton h-80 rounded-xl" />;

  const persist = async (complete = false) => {
    try {
      await save.mutateAsync({ id: inc.id, ...f, complete });
      toast.success(complete ? "Review completed and logged on the timeline" : "Review saved");
      void utils.incidents.get.invalidate({ id: inc.id });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const exportPdf = async () => {
    const blob = await renderReviewPdf(inc, { ...f, completedAt: inc.review?.completedAt ?? null }, orgName);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `INC-${inc.number}-post-incident-review.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const area = (k: "whatHappened" | "impact" | "whatWorked" | "whatToImprove", label: string, hint: string, rows = 5) => (
    <Field label={label} hint={hint}>
      <textarea value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} rows={rows} className={inputCls} />
    </Field>
  );

  return (
    <Panel
      title="Post-incident review"
      subtitle={inc.review?.completedAt ? `Completed ${new Date(inc.review.completedAt).toLocaleString()}` : inc.status === "resolved" ? "Capture what happened while it's fresh — blameless, specific, with owners." : "You can start the review now; it's usually completed after the incident is resolved."}
      icon={CheckCircle2}
      accent="emerald"
      actions={
        <>
          <PfButton size="sm" variant="outline" onClick={() => void exportPdf()}>
            <FileDown size={12} /> PDF
          </PfButton>
          <PfButton size="sm" variant="outline" onClick={() => void persist(false)} loading={save.isPending}>
            Save
          </PfButton>
          {!inc.review?.completedAt && (
            <PfButton size="sm" onClick={() => void persist(true)} loading={save.isPending}>
              Complete review
            </PfButton>
          )}
        </>
      }
    >
      {!inc.review && (
        <p className="mb-3 flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-100/90">
          <Sparkles size={12} /> First draft written from the timeline, SLA clocks and tasks. Edit it with the team, then complete.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {area("whatHappened", "What happened", "Timeline of the event and the response, in plain words.", 8)}
        <div className="space-y-4">
          {area("impact", "Impact", "Assets, people, money affected.", 3)}
          {area("whatWorked", "What worked", "Keep doing these.", 4)}
        </div>
        {area("whatToImprove", "What to improve", "Gaps, delays, surprises — about systems, not people.", 5)}
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">Follow-up actions</div>
          <ul className="space-y-1.5">
            {f.actions.map((a, i) => (
              <li key={a.id || i} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-slate-950/40 p-2">
                <input type="checkbox" checked={a.done} onChange={(e) => setF({ ...f, actions: f.actions.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} className="accent-emerald-400" aria-label="Done" />
                <input value={a.text} onChange={(e) => setF({ ...f, actions: f.actions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 focus:outline-none" aria-label="Action" />
                <select value={a.ownerId ?? ""} onChange={(e) => setF({ ...f, actions: f.actions.map((x, j) => (j === i ? { ...x, ownerId: e.target.value || null } : x)) })} className="max-w-[120px] bg-transparent text-[11px] text-slate-400" aria-label="Owner">
                  <option value="">No owner</option>
                  {inc.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <input type="date" value={a.dueAt ? new Date(a.dueAt).toISOString().slice(0, 10) : ""} onChange={(e) => setF({ ...f, actions: f.actions.map((x, j) => (j === i ? { ...x, dueAt: e.target.value ? new Date(e.target.value) : null } : x)) })} className="bg-transparent text-[11px] text-slate-400 [color-scheme:dark]" aria-label="Due" />
                <button onClick={() => setF({ ...f, actions: f.actions.filter((_, j) => j !== i) })} className="text-slate-600 hover:text-rose-300" aria-label="Remove action">
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
          <button onClick={() => setF({ ...f, actions: [...f.actions, { id: "", text: "New action", ownerId: null, dueAt: null, done: false }] })} className="mt-2 inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200">
            <Plus size={12} /> Add action
          </button>
        </div>
      </div>
    </Panel>
  );
}
