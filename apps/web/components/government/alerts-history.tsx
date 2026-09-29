"use client";

/**
 * Broadcast history: every alert issued in the jurisdiction with delivery
 * receipts, read/action rates, per-channel breakdown, escalations and
 * per-recipient receipts; scheduled queue; per-channel 30-day summary chart.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock, ChevronDown, History, Inbox, Radio, TrendingUp, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { AlertType } from "@agri-shield/types";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { EmptyState, HudButton, Panel, RiskPill, Skeleton, SourceTag } from "@/components/hud";
import { cn } from "@/lib/utils";
import { useGovInput } from "./scope";
import {
  ago,
  ALERT_ICON,
  ALERT_LABEL,
  CHANNEL_ICON,
  CHANNEL_LABEL,
  CHART,
  ChartTooltip,
  dateTime,
  ErrorNote,
  fmtInt,
  fmtNum,
  fmtPct,
  fmtUsd,
  Pill,
  selectCls,
  SEVERITY_COLOR,
} from "./ui";

type History = RouterOutputs["government"]["getAlertHistory"];
type Item = History["items"][number];

const PAGE = 25;

function Funnel({ d }: { d: Item["deliveries"] }) {
  const steps = [
    { k: "Sent", v: d.sent, c: "#64748b" },
    { k: "Delivered", v: d.delivered, c: CHART.cyan },
    { k: "Read", v: d.read, c: CHART.emerald },
    { k: "Actioned", v: d.actioned, c: CHART.amber },
  ];
  const max = Math.max(1, d.sent);
  return (
    <div className="w-full min-w-[140px] space-y-0.5">
      {steps.map((s) => (
        <div key={s.k} className="flex items-center gap-1.5" title={`${s.k}: ${s.v.toLocaleString()}`}>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
            <motion.div className="h-full rounded-full" style={{ background: s.c }} initial={{ width: 0 }} animate={{ width: `${(s.v / max) * 100}%` }} transition={{ duration: 0.8 }} />
          </div>
          <span className="telemetry w-10 text-right text-[9.5px] text-slate-400">{fmtNum(s.v)}</span>
        </div>
      ))}
    </div>
  );
}

function Receipts({ alertId }: { alertId: string }) {
  const scope = useGovInput();
  const q = trpc.government.getAlertReceipts.useQuery({ ...scope, alertId });
  if (q.isLoading) return <Skeleton className="h-24" />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data?.length)
    return <p className="text-[11px] text-slate-500">Per-recipient receipts exist for alerts sent through the Agri-SHIELD broadcast service. This archived alert only carries aggregate delivery counts.</p>;
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-white/5">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-[#0a0f1e]">
          <tr className="text-left text-slate-500">
            {["Recipient", "Channel", "Lang", "To", "Status", "Sent", "Read", "Actioned"].map((h) => (
              <th key={h} className="px-2 py-1.5 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {q.data.map((r) => {
            const Icon = CHANNEL_ICON[r.channel]!;
            return (
              <tr key={r.id} className="border-t border-white/5" title={r.body}>
                <td className="px-2 py-1.5 text-slate-200">
                  {r.recipientName}
                  <span className="ml-1 text-[9.5px] uppercase text-slate-500">{r.recipientKind}</span>
                  {r.count > 1 && <span className="ml-1 telemetry text-emerald-300">×{fmtInt(r.count)}</span>}
                </td>
                <td className="px-2 py-1.5">
                  <span className="inline-flex items-center gap-1 text-slate-300">
                    <Icon size={11} /> {CHANNEL_LABEL[r.channel]}
                  </span>
                </td>
                <td className="px-2 py-1.5 telemetry uppercase text-slate-400">{r.language}</td>
                <td className="px-2 py-1.5 telemetry text-slate-400">{r.to}</td>
                <td className="px-2 py-1.5">
                  <Pill color={r.status === "failed" ? "#f43f5e" : r.status === "sent" ? "#10b981" : "#94a3b8"}>{r.status}</Pill>
                  <span className="ml-1 text-[9.5px] text-slate-500">{r.provider}</span>
                </td>
                <td className="px-2 py-1.5 telemetry text-slate-400">{dateTime(r.sentAt)}</td>
                <td className="px-2 py-1.5 telemetry text-emerald-300">{r.readAt ? dateTime(r.readAt) : "—"}</td>
                <td className="px-2 py-1.5 telemetry text-amber-300">{r.actionedAt ? dateTime(r.actionedAt) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AlertRow({ a }: { a: Item }) {
  const [open, setOpen] = useState(false);
  const Icon = ALERT_ICON[a.alertType]!;
  return (
    <div className={cn("rounded-xl border transition", open ? "border-emerald-500/30 bg-white/[0.02]" : "border-white/5 hover:border-white/15")} style={{ borderLeft: `3px solid ${SEVERITY_COLOR[a.severity]}` }}>
      <button onClick={() => setOpen((v) => !v)} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 text-left md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_160px_110px_20px]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon size={14} style={{ color: SEVERITY_COLOR[a.severity] }} className="shrink-0" />
            <span className="truncate text-sm font-medium text-slate-100">{a.title}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-slate-500">
            <RiskPill level={a.severity} />
            {a.active && <Pill color="#10b981">active</Pill>}
            {a.escalations.length > 0 && <Pill color="#f97316">escalated</Pill>}
            <span>{a.districtName}</span>
            <span>·</span>
            <span>{ago(a.createdAt)}</span>
            <span>·</span>
            <span>{a.createdByName}</span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-1.5">
          <Pill color={a.source === "manual" ? "#38bdf8" : "#a78bfa"}>{a.source}</Pill>
          {a.channels.map((c) => {
            const CI = CHANNEL_ICON[c]!;
            return <CI key={c} size={12} className="text-slate-400" aria-label={CHANNEL_LABEL[c]} />;
          })}
        </div>
        <div className="hidden md:block">
          <Funnel d={a.deliveries} />
        </div>
        <div className="hidden md:block text-right telemetry text-[11px]">
          <div className="text-emerald-300">{fmtPct(a.readRate)} read</div>
          <div className="text-amber-300">{fmtPct(a.actionRate)} acted</div>
        </div>
        <ChevronDown size={14} className={cn("text-slate-500 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="grid gap-4 border-t border-white/5 px-3 py-3 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-slate-300">{a.description}</p>
                {a.recommendedActions.length > 0 && (
                  <ol className="space-y-0.5 text-xs text-slate-200">
                    {a.recommendedActions.map((x, i) => (
                      <li key={i}>
                        <span className="telemetry text-emerald-400">{i + 1}.</span> {x}
                      </li>
                    ))}
                  </ol>
                )}
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="rounded-lg bg-black/20 p-2">
                    <div className="hud-label">Farms</div>
                    <div className="telemetry text-slate-100">{fmtInt(a.predictedImpact.farmsAffected)}</div>
                  </div>
                  <div className="rounded-lg bg-black/20 p-2">
                    <div className="hud-label">Est. loss</div>
                    <div className="telemetry text-slate-100">{fmtUsd(a.predictedImpact.estLossUsd)}</div>
                  </div>
                  <div className="rounded-lg bg-black/20 p-2">
                    <div className="hud-label">Probability</div>
                    <div className="telemetry text-slate-100">{fmtPct(a.predictedImpact.probability)}</div>
                  </div>
                </div>
                {a.escalations.length > 0 && (
                  <div>
                    <div className="hud-label mb-1">Escalations</div>
                    {a.escalations.map((e, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-slate-300">
                        <TrendingUp size={11} className="text-orange-400" />
                        <span className="telemetry">{dateTime(e.at)}</span>
                        <RiskPill level={e.from} /> → <RiskPill level={e.to} />
                        <span className="text-slate-500">{e.rule}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="hud-label">Per-channel receipts</span>
                  {a.channelBreakdown.estimated && <Pill color="#94a3b8">estimated from channel mix</Pill>}
                </div>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-slate-500">
                      {["Channel", "Sent", "Delivered", "Read", "Actioned", "Failed"].map((h) => (
                        <th key={h} className={cn("py-1 font-normal", h !== "Channel" && "text-right")}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="telemetry">
                    {a.channelBreakdown.rows.map((r) => {
                      const CI = CHANNEL_ICON[r.channel]!;
                      return (
                        <tr key={r.channel} className="border-t border-white/5">
                          <td className="py-1 font-sans text-slate-200">
                            <span className="inline-flex items-center gap-1">
                              <CI size={11} /> {CHANNEL_LABEL[r.channel]}
                            </span>
                          </td>
                          <td className="py-1 text-right">{fmtInt(r.sent)}</td>
                          <td className="py-1 text-right text-cyan-300">{fmtInt(r.delivered)}</td>
                          <td className="py-1 text-right text-emerald-300">{fmtInt(r.read)}</td>
                          <td className="py-1 text-right text-amber-300">{fmtInt(r.actioned)}</td>
                          <td className="py-1 text-right text-rose-300">{fmtInt(r.failed)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="lg:col-span-2">
                <div className="hud-label mb-1.5">Recipient receipts</div>
                <Receipts alertId={a.id} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AlertHistory({ canCreate }: { canCreate: boolean }) {
  const scope = useGovInput();
  const utils = trpc.useUtils();
  const ctx = trpc.government.getContext.useQuery(scope);
  const [alertType, setAlertType] = useState<AlertType | "">("");
  const [status, setStatus] = useState<"" | "active" | "expired">("");
  const [districtId, setDistrictId] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const q = trpc.government.getAlertHistory.useQuery(
    { ...scope, limit, offset: 0, alertType: alertType || undefined, status: status || undefined, districtId: districtId || undefined },
    { placeholderData: (p) => p, refetchInterval: 30_000 }
  );
  const cancel = trpc.government.cancelScheduledAlert.useMutation({
    onSuccess: () => {
      toast.success("Scheduled alert cancelled");
      void utils.government.getAlertHistory.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const data = q.data;
  const scheduled = data?.scheduled ?? [];
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Channel performance · 30 days" subtitle="Sent vs read vs actioned per channel" icon={Radio} actions={<SourceTag>Agri-SHIELD registry</SourceTag>}>
          {!data ? (
            <Skeleton className="h-56" />
          ) : !data.summary.perChannel.length ? (
            <EmptyState icon={Radio} title="No broadcasts in the last 30 days" />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.summary.perChannel.map((c) => ({ ...c, name: CHANNEL_LABEL[c.channel] }))} barGap={2}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="name" tick={CHART.axis} axisLine={false} tickLine={false} />
                  <YAxis tick={CHART.axis} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtNum(v)} width={44} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
                  <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
                  <Bar dataKey="sent" name="Sent" fill={CHART.slate} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="read" name="Read" fill={CHART.emerald} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="actioned" name="Actioned" fill={CHART.amber} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
        <Panel title="Scheduled broadcasts" subtitle="Queued alerts send automatically at the set time" icon={CalendarClock} actions={<span className="telemetry text-[10px] text-slate-500">{scheduled.filter((s) => s.status === "scheduled").length} PENDING</span>}>
          {!data ? (
            <Skeleton className="h-40" />
          ) : !scheduled.length ? (
            <EmptyState icon={CalendarClock} title="No scheduled alerts">
              Use "Schedule for later" in the wizard to queue a broadcast.
            </EmptyState>
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {scheduled.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-lg border border-white/5 px-3 py-2 text-xs">
                  <RiskPill level={s.payload.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-slate-100">{s.payload.title}</div>
                    <div className="text-[10.5px] text-slate-500">
                      {s.districtNames.join(", ")} · by {s.createdByName}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="telemetry text-[11px] text-slate-200">{dateTime(s.sendAt)}</div>
                    <Pill color={s.status === "scheduled" ? "#38bdf8" : s.status === "sent" ? "#10b981" : s.status === "failed" ? "#f43f5e" : "#64748b"}>{s.status}</Pill>
                  </div>
                  {s.status === "scheduled" && canCreate && (
                    <button onClick={() => cancel.mutate({ id: s.id })} disabled={cancel.isPending} className="rounded p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300" title="Cancel">
                      <XCircle size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Broadcast history"
        subtitle={data ? `${fmtInt(data.total)} alerts match · delivery receipts and read rates` : "Loading"}
        icon={History}
        actions={
          <div className="flex flex-wrap gap-1.5">
            <select value={alertType} onChange={(e) => (setAlertType(e.target.value as AlertType | ""), setLimit(PAGE))} className={cn(selectCls, "w-auto py-1 text-xs")}>
              <option value="" className="bg-slate-900">
                All types
              </option>
              {(["flood", "salinity", "storm", "drought", "frost"] as const).map((t) => (
                <option key={t} value={t} className="bg-slate-900">
                  {ALERT_LABEL[t]}
                </option>
              ))}
            </select>
            <select value={status} onChange={(e) => (setStatus(e.target.value as typeof status), setLimit(PAGE))} className={cn(selectCls, "w-auto py-1 text-xs")}>
              <option value="" className="bg-slate-900">
                Any status
              </option>
              <option value="active" className="bg-slate-900">
                Active
              </option>
              <option value="expired" className="bg-slate-900">
                Expired
              </option>
            </select>
            <select value={districtId} onChange={(e) => (setDistrictId(e.target.value), setLimit(PAGE))} className={cn(selectCls, "w-auto py-1 text-xs")}>
              <option value="" className="bg-slate-900">
                All districts
              </option>
              {ctx.data?.districts.map((d) => (
                <option key={d.id} value={d.id} className="bg-slate-900">
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <ErrorNote error={q.error} className="mb-3" />
        <div className="mb-2 hidden md:grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_160px_110px_20px] gap-3 px-3 hud-label">
          <span>Alert</span>
          <span>Source · channels</span>
          <span>Sent → delivered → read → acted</span>
          <span className="text-right">Response</span>
          <span />
        </div>
        {!data ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !data.items.length ? (
          <EmptyState icon={Inbox} title="No alerts match these filters" />
        ) : (
          <div className="space-y-1.5">
            {data.items.map((a) => (
              <AlertRow key={a.id} a={a} />
            ))}
          </div>
        )}
        {data && data.items.length < data.total && (
          <div className="mt-4 flex justify-center">
            <HudButton variant="outline" onClick={() => setLimit((l) => Math.min(200, l + PAGE))} disabled={q.isFetching || limit >= 200}>
              {q.isFetching ? "Loading…" : `Load more (${fmtInt(data.total - data.items.length)} older)`}
            </HudButton>
          </div>
        )}
      </Panel>
    </div>
  );
}
