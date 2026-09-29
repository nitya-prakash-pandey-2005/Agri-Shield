"use client";

import { Fragment, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Clock, Cpu, Inbox, Layers, Play, Timer } from "lucide-react";
import { EmptyState, HudButton, Panel, SectionHeader, Skeleton, StatTile } from "@/components/hud";
import { DataTable, ErrorNote, KV, Select, StatusBadge, Td, TimeAgo, fmtMs, fmtPct } from "@/components/admin/ui";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type JobsData = RouterOutputs["admin"]["jobs"];
type JobName = JobsData["jobs"][number]["name"];

const MODE_LABEL: Record<string, string> = { interval: "In-process timers", bullmq: "BullMQ · Redis", off: "Disabled" };

export default function JobsPage() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<JobName | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState<Set<string>>(new Set());

  const q = trpc.admin.jobs.useQuery(filter ? { job: filter, limit: 100 } : { limit: 100 }, {
    refetchInterval: (query) => (query.state.data?.jobs.some((j) => j.running) || starting.size ? 5_000 : 20_000),
  });
  const run = trpc.admin.runJob.useMutation({
    onMutate: ({ job }) => setStarting((s) => new Set(s).add(job)),
    onSuccess: (r, { job }) => {
      const status = r.status;
      const fn = status === "failed" ? toast.error : status === "running" ? toast.info : status === "skipped" || status === "partial" ? toast.warning : toast.success;
      fn(`${job}: ${status}`, { description: r.summary });
    },
    onError: (e, { job }) => toast.error(`${job} failed to start`, { description: e.message }),
    onSettled: (_r, _e, { job }) => {
      setStarting((s) => {
        const n = new Set(s);
        n.delete(job);
        return n;
      });
      utils.admin.jobs.invalidate();
      utils.admin.overview.invalidate();
    },
  });

  const d = q.data;
  const sched = d?.scheduler;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="PIPELINE"
        title="Background Jobs"
        description="The automated alert pipeline (spec §6): climate scan, notification dispatch with retries, MODIS satellite ingest and weekly model retraining. Every run is timed and summarised here."
      />
      <ErrorNote error={q.error} />

      <div className="grid gap-4 lg:grid-cols-4">
        <Panel title="Scheduler" icon={Clock} accent="violet" live={sched?.mode !== "off"} className="lg:col-span-2">
          {!sched ? (
            <Skeleton className="h-20" />
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <StatusBadge status={sched.mode === "off" ? "offline" : "active"} label={MODE_LABEL[sched.mode] ?? sched.mode} pulse={sched.mode !== "off"} />
              </div>
              <KV k="Detail" v={sched.detail} />
              <KV k="Started" v={<TimeAgo date={sched.startedAt} />} />
              <KV k="Enable BullMQ" v={<span className="telemetry text-[11px] text-slate-400">ENABLE_WORKERS=true REDIS_URL=…</span>} />
            </>
          )}
        </Panel>
        <StatTile label="Pending deliveries" value={d?.queue.pending ?? 0} icon={Inbox} accent="cyan" />
        <StatTile label="Dead-lettered" value={d?.queue.dead ?? 0} icon={Layers} accent="red" hint="Deliveries that failed 3 attempts" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {!d
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-56" />)
          : d.jobs.map((j) => {
              const busy = j.running || starting.has(j.name);
              return (
                <Panel
                  key={j.name}
                  title={j.label}
                  subtitle={
                    <span className="telemetry">
                      {j.schedule} · <span className="text-slate-500">{j.cron}</span>
                    </span>
                  }
                  icon={Cpu}
                  accent="violet"
                  sweep={busy}
                  actions={
                    <HudButton onClick={() => run.mutate({ job: j.name })} disabled={busy} className="py-1.5 text-xs bg-violet-500 text-white hover:bg-violet-400 shadow-[0_0_20px_-6px_rgba(139,92,246,0.8)]">
                      <Play size={12} /> {busy ? "Running…" : "Run now"}
                    </HudButton>
                  }
                >
                  <p className="mb-3 text-[12px] text-slate-400">{j.description}</p>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {busy ? <StatusBadge status="running" /> : j.lastRun ? <StatusBadge status={j.lastRun.status} /> : <StatusBadge status="unknown" label="never run" />}
                    {j.lastRun && <span className="text-[11px] text-slate-500">last run <TimeAgo date={j.lastRun.finishedAt ?? j.lastRun.startedAt} /></span>}
                  </div>
                  {j.lastRun && <div className="mb-3 rounded-lg border border-white/5 bg-slate-950/50 p-2.5 text-[11.5px] leading-relaxed text-slate-300">{j.lastRun.summary}</div>}
                  <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
                    <Mini label="Next run" value={<TimeAgo date={j.nextRunAt} />} />
                    <Mini label="Last success" value={<TimeAgo date={j.lastSuccessAt} />} />
                    <Mini label="Success rate" value={fmtPct(j.successRate)} />
                    <Mini label="Avg duration" value={fmtMs(j.avgDurationMs)} />
                  </div>
                  {d.bull?.[j.name] && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {Object.entries(d.bull[j.name]!).map(([k, v]) => (
                        <span key={k} className="rounded border border-slate-700/60 px-1.5 py-0.5 telemetry text-[10px] text-slate-400">
                          {k} <span className="text-slate-200">{v}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </Panel>
              );
            })}
      </div>

      <Panel
        title="Run history"
        subtitle={`${d?.runs.length ?? 0} runs · click a row for the full output`}
        icon={Timer}
        accent="violet"
        actions={
          <Select<JobName>
            label="Filter by job"
            value={filter}
            onChange={setFilter}
            options={[{ value: "", label: "All jobs" }, ...(d?.jobs ?? []).map((j) => ({ value: j.name, label: j.label }))]}
            className="h-8 text-xs"
          />
        }
      >
        {!d ? (
          <Skeleton className="h-40" />
        ) : d.runs.length === 0 ? (
          <EmptyState icon={Timer} title="No runs yet">
            The climate scan fires ~15 s after boot. Use “Run now” to trigger any job.
          </EmptyState>
        ) : (
          <DataTable head={["", "Job", "Trigger", "By", "Status", "Started", "Duration", "Summary"]}>
            {d.runs.map((r) => {
              const isOpen = open === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className={cn("cursor-pointer hover:bg-white/[0.02]", isOpen && "bg-violet-500/[0.05]")} onClick={() => setOpen(isOpen ? null : r.id)}>
                    <Td className="w-6 text-slate-500">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</Td>
                    <Td mono className="text-slate-100">{r.job}</Td>
                    <Td mono>{r.trigger}</Td>
                    <Td>{r.triggeredBy}</Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td>
                      <TimeAgo date={r.startedAt} />
                    </Td>
                    <Td mono>{fmtMs(r.durationMs)}</Td>
                    <Td className="max-w-[460px] truncate text-slate-400" title={r.summary}>
                      {r.summary}
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={8} className="pb-3">
                        {r.error && <div className="mb-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 telemetry text-[11px] text-rose-300">{r.error}</div>}
                        <div className="mb-1 text-[11px] text-slate-400">{r.summary}</div>
                        <pre className="max-h-80 overflow-auto rounded-lg border border-white/5 bg-[#040811] p-3 telemetry text-[11px] leading-relaxed text-emerald-200/90">
                          {r.output ? JSON.stringify(r.output, null, 2) : "— no structured output —"}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </DataTable>
        )}
      </Panel>

      {d && d.queue.items.length > 0 && (
        <Panel title="Delivery queue" subtitle="Pending / retried notifications (latest 100)" icon={Inbox} accent="cyan">
          <DataTable head={["Channel", "To", "Origin", "Attempts", "Status", "Created", "Last error"]}>
            {d.queue.items.slice(0, 30).map((it) => (
              <tr key={it.id}>
                <Td mono>{it.channel}</Td>
                <Td mono>{it.to}</Td>
                <Td>{it.origin}</Td>
                <Td mono>{it.attempts}</Td>
                <Td>
                  <StatusBadge status={it.status} />
                </Td>
                <Td>
                  <TimeAgo date={it.createdAt} />
                </Td>
                <Td className="max-w-[260px] truncate text-rose-300/80">{it.lastError ?? ""}</Td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="hud-label text-[9.5px]">{label}</div>
      <div className="telemetry text-[12px] text-slate-200">{value}</div>
    </div>
  );
}
