"use client";

/**
 * Escalation rules editor + live monitor (spec §4.5: "auto-escalate severity
 * if risk threshold is crossed at T+6h"). Rules are evaluated server-side on
 * read and by the platform scan job; this view edits them and shows every
 * (active alert × rule) pair with its live metric against the threshold.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, ListTree, Play, Plus, Save, ShieldAlert, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { AlertChannel, AlertType } from "@agri-shield/types";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { EmptyState, HudButton, Meter, Panel, RiskPill, Skeleton, SourceTag } from "@/components/hud";
import { cn } from "@/lib/utils";
import { useGovInput } from "./scope";
import { ago, ALERT_ICON, ALERT_LABEL, CHANNEL_ICON, CHANNEL_LABEL, dateTime, ErrorNote, inputCls, Pill, selectCls, until } from "./ui";

type Data = RouterOutputs["government"]["getEscalationRules"];
type Metric = Data["rules"][number]["metric"];

interface DraftRule {
  id?: string;
  name: string;
  enabled: boolean;
  alertTypes: AlertType[];
  metric: Metric;
  threshold: number;
  afterHours: number;
  mode: "step" | "emergency";
  notifyChannels: AlertChannel[];
}

const METRICS: Record<Metric, { label: string; unit: string; scale: number; step: number; max: number }> = {
  floodProb72h: { label: "Flood probability (72h)", unit: "%", scale: 100, step: 1, max: 100 },
  floodProb24h: { label: "Flood probability (24h)", unit: "%", scale: 100, step: 1, max: 100 },
  floodRisk: { label: "Flood risk score", unit: "/100", scale: 1, step: 1, max: 100 },
  salinityRisk: { label: "Salinity risk score", unit: "/100", scale: 1, step: 1, max: 100 },
  ecCurrent: { label: "Salinity EC", unit: "dS/m", scale: 1, step: 0.1, max: 40 },
  rainfall72hMm: { label: "Rainfall next 72h", unit: "mm", scale: 1, step: 5, max: 1000 },
};
const TYPES: AlertType[] = ["flood", "salinity", "storm", "drought", "frost"];
const CHANNELS: AlertChannel[] = ["app", "sms", "whatsapp", "email"];
const STATE_COLOR: Record<string, string> = { armed: "#38bdf8", breached: "#f43f5e", below: "#64748b", escalated: "#f97316", max: "#a78bfa" };
const STATE_TEXT: Record<string, string> = {
  armed: "Over threshold — escalates at check time",
  breached: "Over threshold — escalates on next evaluation",
  below: "Below threshold",
  escalated: "Escalated by this rule",
  max: "Already at emergency",
};

const fmtMetric = (m: Metric, v: number) => {
  const meta = METRICS[m];
  const x = v * meta.scale;
  return `${meta.step < 1 ? x.toFixed(1) : Math.round(x)}${meta.unit === "%" ? "%" : ` ${meta.unit}`}`;
};

export function EscalationRules({ canEdit }: { canEdit: boolean }) {
  const scope = useGovInput();
  const utils = trpc.useUtils();
  const q = trpc.government.getEscalationRules.useQuery(scope, { refetchInterval: 30_000 });
  const [draft, setDraft] = useState<DraftRule[] | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (q.data && !dirty) setDraft(q.data.rules.map(({ id, name, enabled, alertTypes, metric, threshold, afterHours, mode, notifyChannels }) => ({ id, name, enabled, alertTypes, metric, threshold, afterHours, mode, notifyChannels })));
  }, [q.data, dirty]);

  const save = trpc.government.setEscalationRules.useMutation({
    onSuccess: (r) => {
      toast.success(`Saved ${r.length} escalation rule(s)`);
      setDirty(false);
      void utils.government.getEscalationRules.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const run = trpc.government.runEscalationsNow.useMutation({
    onSuccess: (r) => {
      if (r.escalated) toast.warning(`${r.escalated} alert(s) escalated`, { description: r.events.map((e) => `${e.from.toUpperCase()} → ${e.to.toUpperCase()}`).join(", ") });
      else toast.info("Evaluation complete — no rule breached at its check time");
      void utils.government.getEscalationRules.invalidate();
      void utils.government.getAlertHistory.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const update = (i: number, patch: Partial<DraftRule>) => {
    setDraft((d) => d!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const valid = draft?.every((r) => r.name.trim().length >= 3 && r.alertTypes.length && r.notifyChannels.length) ?? false;

  return (
    <div className="space-y-5">
      <Panel
        title="Escalation rules"
        subtitle="Auto-escalate an active alert when the district's live metric crosses the threshold at T+N hours after issue"
        icon={ShieldAlert}
        actions={
          <div className="flex items-center gap-2">
            {q.data && !q.data.featureFlag && <Pill color="#f59e0b">auto_escalation flag off</Pill>}
            {canEdit && (
              <>
                <HudButton variant="outline" className="py-1.5 text-xs" onClick={() => run.mutate(scope)} disabled={run.isPending}>
                  <Play size={12} /> {run.isPending ? "Evaluating…" : "Run evaluation now"}
                </HudButton>
                {dirty && (
                  <HudButton variant="ghost" className="py-1.5 text-xs" onClick={() => setDirty(false)}>
                    <Undo2 size={12} /> Discard
                  </HudButton>
                )}
                <HudButton className="py-1.5 text-xs" disabled={!dirty || !valid || save.isPending} onClick={() => draft && save.mutate({ ...scope, rules: draft.map((r) => ({ ...r, name: r.name.trim() })) })}>
                  <Save size={12} /> {save.isPending ? "Saving…" : "Save rules"}
                </HudButton>
              </>
            )}
          </div>
        }
      >
        {!canEdit && <p className="mb-3 text-[11px] text-slate-500">Read-only — editing requires approve_resources (regional or national admin).</p>}
        <ErrorNote error={q.error ?? save.error} className="mb-3" />
        {!draft ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {draft.map((r, i) => {
                const meta = METRICS[r.metric];
                return (
                  <motion.div
                    key={r.id ?? `new-${i}`}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className={cn("rounded-xl border p-3", r.enabled ? "border-white/10 bg-white/[0.015]" : "border-white/5 opacity-60")}
                  >
                    <fieldset disabled={!canEdit} className="grid gap-3 lg:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1.6fr)_auto]">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.enabled}
                        onClick={() => update(i, { enabled: !r.enabled })}
                        className={cn("relative mt-1 h-5 w-9 shrink-0 rounded-full transition", r.enabled ? "bg-emerald-500" : "bg-slate-700")}
                        title={r.enabled ? "Enabled" : "Disabled"}
                      >
                        <motion.span layout className="absolute top-0.5 h-4 w-4 rounded-full bg-white" style={{ left: r.enabled ? 18 : 2 }} />
                      </button>
                      <div className="space-y-2">
                        <input value={r.name} onChange={(e) => update(i, { name: e.target.value })} className={cn(inputCls, "py-1.5")} maxLength={100} />
                        <div className="flex flex-wrap gap-1">
                          {TYPES.map((t) => {
                            const Icon = ALERT_ICON[t]!;
                            const on = r.alertTypes.includes(t);
                            return (
                              <button type="button" key={t} onClick={() => update(i, { alertTypes: toggleIn(r.alertTypes, t) })} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px]", on ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-white/5 text-slate-500")}>
                                <Icon size={11} /> {ALERT_LABEL[t]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <label className="col-span-2">
                          <span className="hud-label mb-1 block">Metric</span>
                          <select value={r.metric} onChange={(e) => update(i, { metric: e.target.value as Metric })} className={cn(selectCls, "py-1.5 text-xs")}>
                            {(Object.keys(METRICS) as Metric[]).map((m) => (
                              <option key={m} value={m} className="bg-slate-900">
                                {METRICS[m].label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="hud-label mb-1 block">Threshold ({meta.unit})</span>
                          <input
                            type="number"
                            step={meta.step}
                            min={0}
                            max={meta.max}
                            value={Math.round(r.threshold * meta.scale * 10) / 10}
                            onChange={(e) => update(i, { threshold: Math.max(0, Number(e.target.value) || 0) / meta.scale })}
                            className={cn(inputCls, "py-1.5 text-xs telemetry")}
                          />
                        </label>
                        <label>
                          <span className="hud-label mb-1 block">Check at T+h</span>
                          <input type="number" min={0} max={72} value={r.afterHours} onChange={(e) => update(i, { afterHours: Math.min(72, Math.max(0, Number(e.target.value) || 0)) })} className={cn(inputCls, "py-1.5 text-xs telemetry")} />
                        </label>
                        <label className="col-span-2">
                          <span className="hud-label mb-1 block">Action</span>
                          <select value={r.mode} onChange={(e) => update(i, { mode: e.target.value as DraftRule["mode"] })} className={cn(selectCls, "py-1.5 text-xs")}>
                            <option value="step" className="bg-slate-900">
                              Escalate one step (watch → warning → emergency)
                            </option>
                            <option value="emergency" className="bg-slate-900">
                              Escalate straight to emergency
                            </option>
                          </select>
                        </label>
                        <div className="col-span-2">
                          <span className="hud-label mb-1 block">Re-notify via</span>
                          <div className="flex flex-wrap gap-1">
                            {CHANNELS.map((c) => {
                              const Icon = CHANNEL_ICON[c]!;
                              const on = r.notifyChannels.includes(c);
                              return (
                                <button type="button" key={c} onClick={() => update(i, { notifyChannels: toggleIn(r.notifyChannels, c) })} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10.5px]", on ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-white/5 text-slate-500")}>
                                  <Icon size={11} /> {CHANNEL_LABEL[c]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft((d) => d!.filter((_, j) => j !== i));
                          setDirty(true);
                        }}
                        className="self-start rounded p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                        aria-label="Remove rule"
                      >
                        <Trash2 size={14} />
                      </button>
                    </fieldset>
                    <p className="mt-2 text-[10.5px] text-slate-500">
                      If an active {r.alertTypes.map((t) => ALERT_LABEL[t]!.toLowerCase()).join("/")} alert's district has {meta.label.toLowerCase()} ≥ {fmtMetric(r.metric, r.threshold)} at T+{r.afterHours}h, {r.mode === "step" ? "raise severity one step" : "raise to EMERGENCY"} and re-notify via {r.notifyChannels.map((c) => CHANNEL_LABEL[c]).join(", ")}.
                    </p>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {canEdit && draft.length < 20 && (
              <button
                onClick={() => {
                  setDraft((d) => [...(d ?? []), { name: "New rule", enabled: true, alertTypes: ["flood"], metric: "floodProb72h", threshold: 0.7, afterHours: 6, mode: "step", notifyChannels: ["app", "sms"] }]);
                  setDirty(true);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/10 py-2.5 text-xs text-slate-400 hover:border-emerald-500/50 hover:text-emerald-300"
              >
                <Plus size={13} /> Add rule
              </button>
            )}
          </div>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Live escalation monitor" subtitle="Every active alert × enabled rule, against live district metrics" icon={Activity} live actions={<SourceTag>Open-Meteo · GloFAS</SourceTag>}>
          {!q.data ? (
            <Skeleton className="h-48" />
          ) : !q.data.monitor.length ? (
            <EmptyState icon={Activity} title="Nothing to monitor">
              No active alerts match an enabled rule.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-[11px]">
                <thead>
                  <tr className="text-left text-slate-500">
                    {["Alert", "Rule", "Observed vs threshold", "Check", "State"].map((h) => (
                      <th key={h} className="pb-1.5 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.data.monitor.map((m) => {
                    const rule = q.data.rules.find((r) => r.id === m.ruleId);
                    const metric = rule?.metric ?? "floodProb72h";
                    const ratio = m.threshold ? m.observed / m.threshold : 0;
                    const due = new Date(m.checkAt).getTime() <= Date.now();
                    return (
                      <tr key={`${m.alertId}-${m.ruleId}`} className="border-t border-white/5 align-middle">
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-1.5">
                            <RiskPill level={m.severity} />
                            <span className="text-slate-200">{m.districtName}</span>
                          </div>
                          <div className="max-w-[200px] truncate text-[10px] text-slate-500">{m.alertTitle}</div>
                        </td>
                        <td className="py-2 pr-2 text-slate-400">{m.ruleName}</td>
                        <td className="w-44 py-2 pr-2">
                          <div className="mb-1 flex justify-between telemetry text-[10px]">
                            <span className={ratio >= 1 ? "text-rose-300" : "text-slate-300"}>{fmtMetric(metric, m.observed)}</span>
                            <span className="text-slate-500">≥ {fmtMetric(metric, m.threshold)}</span>
                          </div>
                          <Meter value={Math.min(100, ratio * 100)} color={ratio >= 1 ? "#f43f5e" : ratio > 0.85 ? "#f59e0b" : "#10b981"} />
                        </td>
                        <td className="py-2 pr-2 telemetry text-slate-400">{due ? <span className="text-slate-300">due</span> : `in ${until(m.checkAt)}`}</td>
                        <td className="py-2" title={STATE_TEXT[m.state]}>
                          <Pill color={STATE_COLOR[m.state]}>{m.state}</Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Escalation log" subtitle="Automatic severity changes" icon={ListTree}>
          {!q.data ? (
            <Skeleton className="h-48" />
          ) : !q.data.log.length ? (
            <EmptyState icon={ListTree} title="No escalations yet">
              Rules fire when a live metric crosses its threshold at the check time.
            </EmptyState>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {q.data.log.map((e) => (
                <div key={e.id} className="rounded-lg border border-white/5 px-3 py-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <RiskPill level={e.from} /> <span className="text-slate-500">→</span> <RiskPill level={e.to} />
                    <span className="ml-1 text-slate-200">{e.districtName}</span>
                    <span className="ml-auto telemetry text-slate-500" title={dateTime(e.at)}>
                      {ago(e.at)}
                    </span>
                  </div>
                  <div className="mt-1 text-slate-400">
                    {e.ruleName}: {fmtMetric(e.metric, e.observed)} ≥ {fmtMetric(e.metric, e.threshold)} · {e.notified.toLocaleString()} re-notified
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
