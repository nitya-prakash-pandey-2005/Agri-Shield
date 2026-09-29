"use client";

/**
 * New-workspace setup checklist (persisted per workspace on the server —
 * steps tick themselves off as the real data appears).
 */
import Link from "next/link";
import { motion } from "framer-motion";
import { Check, ChevronRight, Rocket, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Panel } from "@/components/hud";
import { cn } from "@/lib/utils";

export interface ChecklistData {
  steps: { id: string; title: string; description: string; href: string; cta: string; done: boolean; completedAt: Date | string | null }[];
  done: number;
  total: number;
  pct: number;
  dismissed: boolean;
  complete: boolean;
}

export function OnboardingChecklist({ data, className }: { data: ChecklistData; className?: string }) {
  const utils = trpc.useUtils();
  const dismiss = trpc.workspace.setOnboardingDismissed.useMutation({ onSuccess: () => void utils.workspace.home.invalidate() });
  // Celebrate only when the last step is completed while the user is watching
  const wasComplete = useRef(data.complete);
  useEffect(() => {
    if (data.complete && !wasComplete.current) {
      wasComplete.current = true;
      void import("canvas-confetti").then(({ default: confetti }) => confetti({ particleCount: 90, spread: 70, origin: { y: 0.3 }, colors: ["#38bdf8", "#10b981", "#a78bfa"] }));
    }
  }, [data.complete]);
  const next = data.steps.find((s) => !s.done);
  return (
    <div data-tour="checklist" className={className}>
      <Panel
        title="Get your workspace ready"
        subtitle={data.complete ? "All done — nice work!" : `${data.done} of ${data.total} complete · about 5 minutes`}
        icon={Rocket}
        accent="cyan"
        actions={
          <button onClick={() => dismiss.mutate({ dismissed: true })} className="p-1 text-slate-500 hover:text-slate-200" aria-label="Hide checklist" title="Hide checklist (you can bring it back from Settings)">
            <X size={14} />
          </button>
        }
      >
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <motion.div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" initial={{ width: 0 }} animate={{ width: `${data.pct}%` }} transition={{ duration: 0.8 }} />
        </div>
        <ol className="space-y-1">
          {data.steps.map((s) => (
            <li key={s.id}>
              <Link href={s.href} className={cn("group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]", next?.id === s.id && "bg-cyan-500/[0.06] ring-1 ring-cyan-400/20")}>
                <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border", s.done ? "border-emerald-400 bg-emerald-500 text-slate-950" : "border-slate-600 text-slate-500")}>{s.done ? <Check size={13} strokeWidth={3} /> : null}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[13px]", s.done ? "text-slate-500 line-through decoration-slate-600" : "text-slate-100")}>{s.title}</span>
                  {!s.done && <span className="block text-[11.5px] text-slate-500">{s.description}</span>}
                </span>
                {!s.done && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-cyan-300 opacity-80 group-hover:opacity-100">
                    {s.cta} <ChevronRight size={12} />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
