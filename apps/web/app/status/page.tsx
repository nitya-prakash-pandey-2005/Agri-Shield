"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, RefreshCw, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const COLOR: Record<string, string> = { up: "#22c55e", degraded: "#f59e0b", down: "#ef4444", offline: "#64748b" };
const LABEL: Record<string, string> = { up: "Operational", degraded: "Degraded", down: "Outage", offline: "Offline mode" };
const OVERALL = {
  operational: { text: "All systems operational", color: "#22c55e", icon: CheckCircle2 },
  degraded: { text: "Some systems are degraded", color: "#f59e0b", icon: AlertTriangle },
  major_outage: { text: "Major outage", color: "#ef4444", icon: XCircle },
};

const dur = (ms: number) => (ms < 60_000 ? "under a minute" : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round((ms / 3_600_000) * 10) / 10} h`);

function barColor(b: { uptimePct: number | null; worst: string | null }) {
  if (b.uptimePct === null) return "#1e293b";
  if (b.uptimePct >= 99.5 && b.worst !== "down") return "#22c55e";
  if (b.uptimePct >= 95) return "#84cc16";
  if (b.uptimePct >= 80) return "#f59e0b";
  return "#ef4444";
}

export default function StatusPage() {
  const utils = trpc.useUtils();
  const q = trpc.workspace.status.useQuery(undefined, { refetchInterval: 60_000 });
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const d = q.data;
  const o = d ? OVERALL[d.overall] : null;

  const forceRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await utils.workspace.status.fetch({ force: true });
      utils.workspace.status.setData(undefined, fresh);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20 pt-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-white">System status</h1>
          <p className="mt-1 text-sm text-slate-400">Real probes against the platform and every open-data source it depends on. Checked every 5 minutes.</p>
        </div>
        <button onClick={forceRefresh} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-cyan-400/50 disabled:opacity-50">
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check now
        </button>
      </div>

      {!d || !o ? (
        <div className="mt-8 space-y-3">
          <div className="skeleton h-20 rounded-2xl" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-8 flex items-center gap-3 rounded-2xl border p-5" style={{ borderColor: `${o.color}55`, background: `${o.color}12` }}>
            <o.icon size={26} style={{ color: o.color }} />
            <div>
              <div className="font-display text-xl font-semibold text-white">{o.text}</div>
              <div className="text-[12.5px] text-slate-400">
                Last checked {formatDistanceToNowStrict(new Date(d.checkedAt), { addSuffix: true })} · history since last restart ({new Date(d.bootAt).toUTCString().replace(" GMT", " UTC")})
              </div>
            </div>
          </motion.div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            {d.components.map((c) => (
              <div key={c.id} className="border-b border-white/[0.06] last:border-0">
                <button onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.02]" aria-expanded={open === c.id}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR[c.status], boxShadow: `0 0 10px ${COLOR[c.status]}` }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-white">{c.name}</span>
                    <span className="block truncate text-[12px] text-slate-500">{c.description}</span>
                  </span>
                  <span className="hidden text-right sm:block">
                    <span className="block text-[12.5px]" style={{ color: COLOR[c.status] }}>
                      {LABEL[c.status]}
                    </span>
                    <span className="block text-[11px] telemetry text-slate-500">
                      {c.uptimeSinceBootPct === null ? "no checks yet" : `${c.uptimeSinceBootPct}% up`}
                      {c.latencyMs !== null ? ` · ${c.latencyMs} ms` : ""}
                    </span>
                  </span>
                  <ChevronDown size={15} className={cn("shrink-0 text-slate-500 transition-transform", open === c.id && "rotate-180")} />
                </button>
                <div className="px-4 pb-3">
                  <div className="flex h-7 items-end gap-[2px]" role="img" aria-label={`${c.name}: 90-day uptime bars; days before the last restart have no data`}>
                    {c.bars.map((b) => (
                      <span key={b.date} className="h-full flex-1 rounded-[2px] transition-opacity hover:opacity-70" style={{ background: barColor(b) }} title={`${b.date}: ${b.uptimePct === null ? "no data (before last restart)" : `${b.uptimePct}% up · ${b.samples} checks${b.worst && b.worst !== "up" ? ` · worst: ${b.worst}` : ""}`}`} />
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[10.5px] text-slate-600">
                    <span>90 days ago</span>
                    <span>{c.checks} checks since restart</span>
                    <span>Today</span>
                  </div>
                </div>
                {open === c.id && (
                  <div className="space-y-1.5 bg-slate-950/40 px-4 py-3">
                    {c.detail.length === 0 && <div className="text-[12px] text-slate-500">This component is measured by the app itself (it answered this request).</div>}
                    {c.detail.map((x) => (
                      <div key={x.name} className="flex flex-wrap items-center gap-2 text-[12px]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: COLOR[x.status] }} />
                        <span className="text-slate-200">{x.name}</span>
                        <span className="telemetry text-slate-500">{x.latencyMs !== null ? `${x.latencyMs} ms` : "—"}</span>
                        {x.error && <span className="text-rose-300/80">{x.error}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-[#22c55e]" /> ≥ 99.5%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-[#84cc16]" /> ≥ 95%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-[#f59e0b]" /> ≥ 80%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-[#ef4444]" /> &lt; 80%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-[#1e293b]" /> no data (before last restart)
            </span>
          </div>

          <section className="mt-10">
            <h2 className="font-display text-lg font-semibold text-white">Incidents since last restart</h2>
            {d.incidents.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">No incidents recorded since the server started.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {d.incidents.map((i) => (
                  <li key={`${i.componentId}-${i.startedAt}`} className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: `${COLOR[i.status]}22`, color: COLOR[i.status] }}>
                        {LABEL[i.status]}
                      </span>
                      <span className="text-[14px] text-white">{i.componentName}</span>
                      <span className="ml-auto text-[11.5px] text-slate-500">{i.endedAt ? "Resolved" : "Ongoing"}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-slate-400">
                      Started {new Date(i.startedAt).toUTCString().replace(" GMT", " UTC")}
                      {i.endedAt ? ` · lasted ${dur(i.endedAt - i.startedAt)} · resolved ${formatDistanceToNowStrict(new Date(i.endedAt), { addSuffix: true })}` : ` · ongoing for ${dur(Date.now() - i.startedAt)}`} · {i.samples} failed check{i.samples === 1 ? "" : "s"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="mt-10 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-[12.5px] leading-relaxed text-slate-400">
            How this page works: every 5 minutes the platform makes a small real request to each provider (with a timeout) and to its own ML service. History is kept in memory, so bars before the last server restart show as “no data” rather than a made-up 100%. When a provider is down, Agri-SHIELD keeps serving the last good value and labels it as a fallback. See the{" "}
            <Link href="/trust" className="text-cyan-300 hover:underline">
              Trust centre
            </Link>{" "}
            for SLAs.
          </p>
        </>
      )}
    </div>
  );
}
