"use client";

/** Live status per protocol & community (Monitoring / Readiness / Activation) + activation launch. */
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { BellRing, Radio, Siren, Users } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Panel, Skeleton, SourceTag, StatTile } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, ErrorBox, Field, inputCls, num, usd, VIZ, WhatThisMeans } from "@/components/insurance/kit";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const LocationMap = dynamic(() => import("@/components/insurance/LocationMap"), { ssr: false, loading: () => <Skeleton className="h-[320px]" /> });

type St = RouterOutputs["insurance"]["aa"]["status"][number];

export const LEVEL = {
  monitoring: { label: "Monitoring", cls: "bg-emerald-500/15 text-emerald-300", color: VIZ.good },
  readiness: { label: "Readiness", cls: "bg-amber-500/15 text-amber-300", color: VIZ.warning },
  activation: { label: "Activation met", cls: "bg-rose-500/15 text-rose-300", color: VIZ.critical },
  activated: { label: "ACTIVATED", cls: "bg-rose-500/20 text-rose-200", color: VIZ.critical },
} as const;

export default function Status({ canWrite, goActivations }: { canWrite: boolean; goActivations: () => void }) {
  const st = trpc.insurance.aa.status.useQuery(undefined, { refetchInterval: 5 * 60_000 });
  const [pi, setPi] = useState(0);
  if (st.isLoading) return <Skeleton className="h-[560px]" />;
  if (!st.data) return <ErrorBox error={st.error} onRetry={() => st.refetch()} />;
  if (!st.data.length)
    return (
      <Panel>
        <EmptyState icon={Radio} title="No trigger protocols yet">
          Create one in the Protocols tab: pick a forecast metric, Readiness and Activation thresholds, the early actions and the cash envelope.
        </EmptyState>
      </Panel>
    );
  const p = st.data[Math.min(pi, st.data.length - 1)]!;
  return (
    <div className="space-y-4">
      {st.data.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {st.data.map((x, i) => (
            <button key={x.protocol.id} onClick={() => setPi(i)} className={cn("rounded-lg border px-3 py-1.5 text-[12.5px]", i === pi ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200" : "border-slate-700 text-slate-300")}>
              {x.protocol.name} · <span className={LEVEL[x.status === "activated" ? "activated" : x.status === "readiness" ? "readiness" : "monitoring"].cls.split(" ")[1]}>{x.status}</span>
            </button>
          ))}
        </div>
      )}
      <ProtocolStatus s={p} canWrite={canWrite} goActivations={goActivations} />
    </div>
  );
}

function ProtocolStatus({ s, canWrite, goActivations }: { s: St; canWrite: boolean; goActivations: () => void }) {
  const utils = trpc.useUtils();
  const p = s.protocol;
  const lvl = s.status === "activated" ? LEVEL.activated : s.status === "readiness" ? LEVEL.readiness : LEVEL.monitoring;
  const [sel, setSel] = useState<Set<string>>(() => new Set(s.communities.filter((c) => c.level === "activation").map((c) => c.id)));
  const [reason, setReason] = useState(`${s.metricMeta.label} ≥ ${p.activation}${s.metricMeta.unit === "%" ? "%" : ` ${s.metricMeta.unit}`} at ${s.communitiesAtActivation} communities (forecast ${new Date().toLocaleDateString("en-GB")})`);
  const act = trpc.insurance.aa.activate.useMutation({
    onSuccess: () => {
      toast.success("Protocol activated", { description: "Field teams and the workspace have been notified." });
      utils.insurance.aa.invalidate();
      goActivations();
    },
    onError: (e) => toast.error(e.message),
  });
  const dots = useMemo(() => s.communities.map((c) => ({ lat: c.lat, lon: c.lon, color: LEVEL[c.level].color, radius: 4 + Math.sqrt(c.households / 2400) * 8, id: c.id, label: `${c.name} · ${num(c.households)} households · ${s.metricMeta.label}: ${c.value ?? "—"} ${s.metricMeta.unit} (${LEVEL[c.level].label})` })), [s]);
  const selHh = s.communities.filter((c) => sel.has(c.id)).reduce((t, c) => t + c.households, 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={cn("hud-panel flex flex-col justify-center p-4", s.status === "activated" && "ring-1 ring-rose-500/50")}>
          <div className="hud-label">Protocol status</div>
          <div className={cn("mt-1 inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 font-display text-lg font-semibold", lvl.cls)}>
            {s.status === "activated" ? <Siren size={16} /> : <Radio size={16} />}
            {s.status === "activated" ? (s.openActivationId ? "Activated" : "Trigger met") : s.status === "readiness" ? "Readiness" : "Monitoring"}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">{s.openActivationId ? "operation open" : s.triggerMet ? "trigger met — awaiting activation" : "no open operation"}</div>
        </div>
        <StatTile label="At activation threshold" value={s.communitiesAtActivation} accent="red" delta={`need ≥ ${p.minCommunities} to activate`} deltaGood={!s.triggerMet} icon={Siren} />
        <StatTile label="At readiness or above" value={s.communitiesAtReadiness} accent="amber" delta={`of ${s.communities.length} communities`} deltaGood={!s.communitiesAtReadiness} icon={BellRing} />
        <StatTile label="Cash envelope if activated" value={s.activationPlan.totalUsd / 1e3} decimals={0} prefix="$" suffix="k" accent="violet" delta={`${num(s.activationPlan.householdsTargeted)} households · budget ${usd(p.budgetUsd)}`} deltaGood={!s.activationPlan.fundingGapUsd} icon={Users} />
      </div>

      <WhatThisMeans tone={s.status === "monitoring" ? "sky" : s.status === "readiness" ? "amber" : "rose"}>
        {s.status === "monitoring" ? (
          <>No community is near the trigger. The forecast is checked continuously; teams stay on normal duty.</>
        ) : s.status === "readiness" ? (
          <>
            <b className="text-white">{s.communitiesAtReadiness}</b> communities crossed the Readiness level ({p.readiness} {s.metricMeta.unit}). Put volunteers on standby, confirm mobile-money lists and check stock — activation needs {p.minCommunities} communities above {p.activation} {s.metricMeta.unit}.
          </>
        ) : (
          <>
            <b className="text-rose-200">{s.communitiesAtActivation} communities</b> are above the Activation level ({p.activation} {s.metricMeta.unit}) with about {p.leadTimeDays} days of lead time. {s.openActivationId ? "An operation is already open — track it in Activations." : `Activating now releases ${usd(s.activationPlan.totalUsd)} to ${num(s.activationPlan.householdsTargeted)} households before the peak.`}
          </>
        )}
      </WhatThisMeans>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Panel title={p.name} subtitle={`${s.metricMeta.label} · Readiness ≥ ${p.readiness} · Activation ≥ ${p.activation} ${s.metricMeta.unit} at ≥ ${p.minCommunities} communities · lead time ${p.leadTimeDays} d`} icon={Radio} accent="cyan" live>
          <LocationMap dots={dots} fit height={340} zoom={7} onDotClick={(id) => setSel((x) => (x.has(id) ? (x.delete(id), new Set(x)) : new Set(x.add(id))))} />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            {(["monitoring", "readiness", "activation"] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL[k].color }} /> {LEVEL[k].label}
              </span>
            ))}
            <span>· circle size = households · click to select</span>
            <SourceTag>{s.metricMeta.source}</SourceTag>
          </div>
        </Panel>
        <Panel title="Communities" subtitle={`${sel.size} selected for activation · ${num(selHh)} households`} icon={Users} accent="cyan" bodyClassName="px-0 pb-2">
          <div className="max-h-[300px] overflow-auto">
            <table className="w-full text-[12.5px]">
              <tbody>
                {s.communities.map((c) => (
                  <tr key={c.id} className={cn("cursor-pointer border-b border-slate-800/60 hover:bg-white/[0.03]", sel.has(c.id) && "bg-cyan-400/[0.06]")} onClick={() => setSel((x) => (x.has(c.id) ? (x.delete(c.id), new Set(x)) : new Set(x.add(c.id))))}>
                    <td className="py-1.5 pl-4">
                      <input type="checkbox" readOnly checked={sel.has(c.id)} className="accent-cyan-400" aria-label={`Select ${c.name}`} />
                    </td>
                    <td className="py-1.5">
                      <div className="text-slate-200">{c.name}</div>
                      <div className="line-clamp-1 text-[11px] text-slate-500">
                        {num(c.households)} households · {c.drivers[0] ?? ""}
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-1.5 pl-2 text-right telemetry text-slate-100">
                      {c.value ?? "—"}
                      <span className="text-[10px] text-slate-500"> {s.metricMeta.unit}</span>
                    </td>
                    <td className="py-1.5 pr-4 text-right">
                      <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium", LEVEL[c.level].cls)}>{LEVEL[c.level].label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canWrite && !s.openActivationId && (
            <div className="space-y-2 border-t border-slate-800 px-4 pt-3">
              <Field label="Reason (recorded in the audit trail)">
                <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Btn variant={s.triggerMet ? "danger" : "outline"} className="w-full" loading={act.isPending} disabled={!sel.size} onClick={() => act.mutate({ protocolId: p.id, communityIds: [...sel], reason, trigger: s.triggerMet ? "forecast" : "manual" })}>
                <Siren size={14} /> {s.triggerMet ? "Activate protocol" : "Activate manually"} for {sel.size} communities
              </Btn>
              <p className="text-[11px] text-slate-500">
                Activation notifies the workspace (bell + e-mail for critical), opens an operation with the cash plan and starts the audit trail. <Explain term="anticipatory_action" />
              </p>
            </div>
          )}
          {s.openActivationId && (
            <div className="px-4 pt-3">
              <Btn variant="outline" className="w-full" onClick={goActivations}>
                View the open operation
              </Btn>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
