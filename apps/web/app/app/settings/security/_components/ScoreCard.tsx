"use client";

import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, ChevronRight, Gauge, XCircle } from "lucide-react";
import type { RouterOutputs } from "@/lib/trpc";
import { Panel, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { cn } from "@/lib/utils";

type Score = RouterOutputs["developer"]["security"]["score"];

const FIX_VIEW: Record<string, string> = { mfa_coverage: "members", mfa_policy: "members", sso: "sso", ip: "network", keys: "api", sessions: "members", admins: "roles" };
const colorFor = (s: number) => (s >= 75 ? "#34d399" : s >= 50 ? "#fbbf24" : "#fb7185");

export function ScoreCard({ score, onNavigate }: { score: Score; onNavigate: (view: string) => void }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const col = colorFor(score.score);
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          Security score <Explain text="A weighted checklist of the controls auditors and bank security teams ask about: 2FA coverage and policy, SSO, network restrictions, API-key age, idle sessions and least privilege. Each line shows what was measured." title="Security score" />
        </span>
      }
      subtitle="Live from this workspace's configuration"
      icon={Gauge}
      accent="violet"
      actions={<SourceTag>computed {new Date(score.computedAt).toISOString().slice(11, 16)} UTC</SourceTag>}
    >
      <div className="grid items-center gap-5 md:grid-cols-[180px,1fr]">
        <div className="relative mx-auto h-[150px] w-[150px]">
          <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
            <circle cx="64" cy="64" r={R} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="10" />
            <circle cx="64" cy="64" r={R + 9} fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1" strokeDasharray="2 5" />
            <motion.circle cx="64" cy="64" r={R} fill="none" stroke={col} strokeWidth="10" strokeLinecap="round" strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - score.score / 100) }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }} style={{ filter: `drop-shadow(0 0 6px ${col})` }} />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="font-display text-4xl font-semibold text-white">{score.score}</div>
              <div className="telemetry text-[10px] uppercase tracking-[0.14em] text-slate-500">of 100</div>
              <div className="telemetry mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: col }}>
                grade {score.grade}
              </div>
            </div>
          </div>
        </div>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {score.items.map((i) => {
            const Icon = i.status === "good" ? CheckCircle2 : i.status === "warn" ? AlertTriangle : XCircle;
            return (
              <li key={i.id}>
                <button
                  type="button"
                  disabled={!i.fix}
                  onClick={() => onNavigate(FIX_VIEW[i.id] ?? "overview")}
                  className={cn("group flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors", i.fix ? "border-white/5 hover:border-cyan-400/30 hover:bg-white/[0.02]" : "cursor-default border-transparent")}
                >
                  <Icon size={15} className={cn("mt-0.5 shrink-0", i.status === "good" ? "text-emerald-400" : i.status === "warn" ? "text-amber-400" : "text-rose-400")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-[12.5px] text-slate-100">
                      {i.label}
                      <span className="telemetry text-[10.5px] text-slate-500">
                        {i.points}/{i.max}
                      </span>
                    </span>
                    <span className="block text-[11px] leading-snug text-slate-500">{i.detail}</span>
                    {i.fix && (
                      <span className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-cyan-300 group-hover:underline">
                        {i.fix} <ChevronRight size={11} />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}
