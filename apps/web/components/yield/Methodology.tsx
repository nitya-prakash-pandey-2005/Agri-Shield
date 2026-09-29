"use client";

/** Yield Forecast — methodology, sources and limitations (served by sustainability.yield.methodology). */
import { BookOpen, ExternalLink, FlaskConical, TriangleAlert } from "lucide-react";
import { Panel, Skeleton } from "@/components/hud";
import { trpc } from "@/lib/trpc";

export default function Methodology() {
  const q = trpc.sustainability.yield.methodology.useQuery(undefined, { staleTime: Infinity });
  const m = q.data;
  if (!m) return <Skeleton className="h-96" />;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel className="xl:col-span-2" title="How the forecast is made" subtitle={m.formula} icon={FlaskConical} accent="cyan">
        <ol className="space-y-3">
          {m.components.map((c, i) => (
            <li key={c.key} className="flex gap-3">
              <span className="telemetry grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-400/10 text-[11px] text-cyan-300">{i + 1}</span>
              <div>
                <div className="text-[13px] font-semibold text-slate-100">{c.title}</div>
                <p className="text-[12.5px] leading-relaxed text-slate-400">{c.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
      <div className="space-y-4">
        <Panel title="What it means by industry" icon={BookOpen} accent="violet">
          <dl className="space-y-2 text-[12.5px]">
            {Object.entries(m.industry).map(([k, v]) => (
              <div key={k}>
                <dt className="capitalize text-slate-200">{k}</dt>
                <dd className="text-slate-400">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Sources" icon={ExternalLink} accent="green">
          <ul className="space-y-1.5 text-[12.5px]">
            {m.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">
                  {s.name}
                </a>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Limitations" icon={TriangleAlert} accent="amber">
          <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-slate-400">
            {m.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
