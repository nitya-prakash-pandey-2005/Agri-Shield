"use client";

/**
 * OfficerInbox — "Farmer questions" panel for extension officers.
 *
 * NOT YET WIRED into the government portal (owned by another module). To add it:
 *
 *   // app/dashboard/government/page.tsx (or any gov page / drawer)
 *   import { OfficerInbox } from "@/components/farmer/OfficerInbox";
 *   ...
 *   <OfficerInbox />                       // all districts of the officer's organisation
 *   <OfficerInbox districtId="bd-barisal" /> // one district
 *
 * Data: `farmer.listQuestions` (government roles see questions from their own
 * organisation's districts; platform admins see all) and `farmer.answerQuestion`
 * (permission `view_gov_dashboard`, organisation-scoped). New questions also
 * raise a workspace notification for the district's government org
 * (`notifyWorkspace` → realtime `ws:<orgId>`), so the bell updates live.
 *
 * Works outside the farmer I18nProvider (English UI strings, no i18n context
 * needed) because the government portal is English-first.
 */
import { useState } from "react";
import { CheckCircle2, Inbox, Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Panel, Skeleton } from "@/components/hud";

const ago = (d: Date) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function OfficerInbox({ districtId, className }: { districtId?: string; className?: string }) {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"open" | "answered" | "all">("open");
  const q = trpc.farmer.listQuestions.useQuery({ status: filter, districtId }, { refetchInterval: 60_000 });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const answer = trpc.farmer.answerQuestion.useMutation({
    onSuccess: (r) => {
      toast.success("Answer sent to the farmer");
      setDrafts((d) => ({ ...d, [r.id]: "" }));
      void utils.farmer.listQuestions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Panel
      className={className}
      title="Farmer questions"
      subtitle="Questions from farmers in your districts — answer in plain language"
      icon={MessageCircleQuestion}
      accent="violet"
      actions={
        <div className="flex rounded-lg bg-slate-900 p-0.5 text-[11px]">
          {(["open", "answered", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn("min-h-[32px] rounded-md px-2.5 capitalize", filter === f ? "bg-violet-500 font-semibold text-white" : "text-slate-400")}>
              {f}
            </button>
          ))}
        </div>
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.error ? (
        <p className="text-sm text-rose-300">{q.error.message}</p>
      ) : !q.data?.length ? (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Inbox size={16} /> No {filter === "all" ? "" : filter} questions right now.
        </div>
      ) : (
        <ul className="space-y-3">
          {q.data.map((x) => (
            <li key={x.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  <b className="text-slate-300">{x.farmerName}</b> · {x.districtName}
                  {x.crop ? ` · ${x.crop}` : ""} · {ago(x.createdAt)}
                </span>
                {x.status === "answered" ? (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <CheckCircle2 size={12} /> answered
                  </span>
                ) : (
                  <span className="text-amber-300">awaiting answer</span>
                )}
              </div>
              <p className="mt-1 text-sm text-white">{x.text}</p>
              {x.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={x.photo} alt="Farmer's photo" className="mt-2 max-h-48 rounded-lg" />
              )}
              {x.answers.map((a) => (
                <div key={a.id} className="mt-2 rounded-lg bg-emerald-500/5 p-2 text-xs text-slate-300">
                  <span className="text-emerald-300">{a.byName}:</span> {a.text}
                </div>
              ))}
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = (drafts[x.id] ?? "").trim();
                  if (text.length >= 4) answer.mutate({ id: x.id, text });
                }}
              >
                <input
                  value={drafts[x.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [x.id]: e.target.value }))}
                  maxLength={2000}
                  placeholder={x.status === "answered" ? "Add a follow-up…" : "Write your advice…"}
                  className="min-h-[40px] flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white placeholder:text-slate-600"
                />
                <button type="submit" disabled={answer.isPending} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-violet-500 px-3 text-sm font-semibold text-white disabled:opacity-50">
                  {answer.isPending && answer.variables?.id === x.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default OfficerInbox;
