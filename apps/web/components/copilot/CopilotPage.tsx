"use client";

import { BarChart3, Bell, Bot, Building2, Compass, FileQuestion, GitCompare, Keyboard, Landmark, ListOrdered, MapPin, Radar, ShieldCheck, Sun, Users } from "lucide-react";
import { Panel, SectionHeader } from "@/components/hud";
import { trpc } from "@/lib/trpc";
import { CopilotChat } from "./CopilotChat";

const CAPABILITIES = [
  { icon: BarChart3, label: "Portfolio summary", hint: "counts, exposure & value at risk, risk mix, trend" },
  { icon: ListOrdered, label: "Rank & filter assets", hint: "“top 10 coastal plots by flood risk above 60%”" },
  { icon: Building2, label: "One asset in depth", hint: "by name, policy / loan reference or ID" },
  { icon: MapPin, label: "Any place on Earth", hint: "flood, salinity, drought & heat for a named place" },
  { icon: Sun, label: "Forecasts", hint: "rain, temperature and water balance up to 16 days" },
  { icon: GitCompare, label: "Compare places", hint: "two to four locations side by side" },
  { icon: Bell, label: "Alerts & rules", hint: "what fired, what's active, official warnings" },
  { icon: Radar, label: "Hazards near assets", hint: "live GDACS & NASA EONET events" },
  { icon: ShieldCheck, label: "Insurance book", hint: "sum insured, premium, parametric trigger watch" },
  { icon: Landmark, label: "Loan book", hint: "past due, outstanding at climate risk" },
  { icon: Users, label: "Anticipatory action", hint: "households, readiness triggers, cash to pre-position" },
  { icon: FileQuestion, label: "Explain any metric", hint: "EC, SPI, return period, basis risk…" },
];

export function CopilotPage({ initialQuestion }: { initialQuestion: string | null }) {
  const status = trpc.copilot.status.useQuery(undefined, { staleTime: 5 * 60_000 });
  const planner = status.data?.planner;
  return (
    <div>
      <SectionHeader
        eyebrow="Workspace · Copilot"
        title="Ask anything about your climate risk"
        description={
          <>
            A climate-risk analyst that answers from {status.data?.orgName ?? "your workspace"}&apos;s own portfolio, rules and live forecasts — never from guesswork. Every answer shows the tools it used and where the numbers came from.
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <Panel title="Conversation" icon={Bot} accent="cyan" live bodyClassName="p-0" className="min-w-0">
          <div className="h-[calc(100dvh-230px)] min-h-[520px] px-3 pb-3 md:px-4">
            <CopilotChat variant="page" initialQuestion={initialQuestion} />
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel title="What I can do" icon={Compass} accent="cyan">
            <ul className="space-y-2.5 px-4 pb-4">
              {CAPABILITIES.map((c) => (
                <li key={c.label} className="flex gap-2.5">
                  <c.icon size={14} className="mt-0.5 shrink-0 text-cyan-400" />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-slate-200">{c.label}</div>
                    <div className="text-[11px] leading-snug text-slate-500">{c.hint}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="How answers are made" icon={Keyboard} accent="cyan">
            <div className="space-y-2 px-4 pb-4 text-[12px] leading-relaxed text-slate-400">
              <p>
                <span className="text-slate-200">Planner:</span>{" "}
                {planner?.mode === "llm" ? `${planner.provider} · ${planner.model} (function calling)` : "deterministic intent router — recognises places, assets, hazards, time windows and thresholds, then calls the right tools."}
              </p>
              <p>
                <span className="text-slate-200">Grounding:</span> answers are composed only from tool outputs scoped to your workspace; when data is missing, Copilot says so.
              </p>
              <p>
                <span className="text-slate-200">Shortcuts:</span> <kbd className="rounded border border-slate-700 px-1 telemetry text-[10px]">Enter</kbd> send ·{" "}
                <kbd className="rounded border border-slate-700 px-1 telemetry text-[10px]">Shift+Enter</kbd> new line ·{" "}
                <kbd className="rounded border border-slate-700 px-1 telemetry text-[10px]">Ctrl+J</kbd> Copilot on any page.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
