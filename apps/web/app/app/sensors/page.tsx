"use client";

/**
 * Sensors & IoT — fleet overview: live map (pins pulse on new data), status
 * KPIs, anomaly feed (real event vs sensor fault), forecast-vs-observed mix,
 * device list with sparklines, "Connect a device" wizard and a one-click
 * browser virtual device that streams through the real ingest API.
 */
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Activity, BatteryLow, CheckCheck, Cpu, Download, Plug, Radio, Search, Signal, Siren, Sparkles, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Meter, Panel, Skeleton, SourceTag, StatTile } from "@/components/hud";
import { Chip, PageTitle, PfButton, QueryError, Segmented, inputCls } from "@/components/portfolio/ui";
import { Explain } from "@/components/help/Explain";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/hooks/useRealtime";
import { DEVICE_TYPES, DEVICE_TYPE_KEYS, METRIC_META, type DeviceStatus, type DeviceType } from "@/server/services/iot-types";
import { ConnectWizard, VirtualConsole } from "@/components/sensors/connect";
import { Spark } from "@/components/sensors/charts";
import { ClassPill, SevDot, StatusPill, TypeIcon, VERDICT_META, VerdictPill, ago, fmtMetric } from "@/components/sensors/meta";

const FleetMap = dynamic(() => import("@/components/sensors/FleetMap"), { ssr: false, loading: () => <Skeleton className="h-[420px]" /> });

type StatusFilter = "all" | DeviceStatus | "alerts";

export default function SensorsPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: session } = useSession();
  const orgId = session?.user?.orgId ?? null;
  const overview = trpc.sensors.overview.useQuery(undefined, { refetchInterval: 30_000 });
  const [wizard, setWizard] = useState<null | "connect" | "virtual">(null);
  const [types, setTypes] = useState<DeviceType[]>([]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const [pulse, setPulse] = useState<{ ids: string[]; key: number }>({ ids: [], key: 0 });
  const lastRefetch = useRef(0);

  useRealtime(orgId ? [`ws:${orgId}`] : [], (env) => {
    const ev = env.event as unknown as { type: string; devices?: { id: string }[]; title?: string; severity?: string; deviceId?: string };
    if (ev.type === "sensors.readings" && ev.devices) {
      setPulse((p) => ({ ids: ev.devices!.map((d) => d.id), key: p.key + 1 }));
      if (Date.now() - lastRefetch.current > 8000) {
        lastRefetch.current = Date.now();
        void utils.sensors.overview.invalidate();
      }
    }
    if (ev.type === "sensor.anomaly" && ev.severity !== "info") {
      toast[ev.severity === "critical" ? "error" : "warning"](ev.title ?? "Sensor anomaly", { description: "Open the device for the explanation.", action: ev.deviceId ? { label: "Open", onClick: () => router.push(`/app/sensors/${ev.deviceId}`) } : undefined });
      void utils.sensors.overview.invalidate();
    }
  });

  const ack = trpc.sensors.ackAnomaly.useMutation({ onSuccess: () => utils.sensors.overview.invalidate(), onError: (e) => toast.error(e.message) });

  const d = overview.data;
  const filtered = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    return d.devices.filter(
      (x) =>
        (!types.length || types.includes(x.type)) &&
        (status === "all" || (status === "alerts" ? !!x.worst : x.status === status)) &&
        (!s || x.name.toLowerCase().includes(s) || (x.asset?.name ?? "").toLowerCase().includes(s) || x.id.includes(s))
    );
  }, [d, types, status, q]);

  const exportCsv = () => {
    if (!d) return;
    const rows = [["id", "name", "type", "status", "lat", "lon", "primary_metric", "primary_value", "battery_pct", "last_seen", "open_anomalies", "forecast_check", "linked_asset"]];
    for (const x of d.devices) rows.push([x.id, x.name, x.type, x.status, String(x.lat), String(x.lon), x.primary.metric, String(x.primary.value ?? ""), String(x.battery ?? ""), x.lastSeen ? new Date(x.lastSeen).toISOString() : "", String(x.openAnomalies), x.verdict, x.asset?.name ?? ""]);
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sensor-fleet-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = useMemo(() => {
    if (!d) return [];
    const out: string[] = [];
    const crit = d.recentAnomalies.filter((a) => !a.ackedAt && a.severity === "critical" && a.cls !== "sensor_fault" && a.end > Date.now() - 86_400_000);
    if (crit.length) out.push(`${crit.length} critical ground-truth event${crit.length > 1 ? "s" : ""} in the last 24 h: ${crit.slice(0, 2).map((a) => `${a.title.toLowerCase()} at ${a.deviceName}`).join("; ")}.`);
    else out.push("No critical events measured on the ground in the last 24 hours.");
    const faults = d.recentAnomalies.filter((a) => !a.ackedAt && a.cls === "sensor_fault" && a.end > Date.now() - 86_400_000).length;
    const visit = d.counts.offline + d.lowBattery;
    if (faults || visit) out.push(`${faults ? `${faults} sensor fault${faults > 1 ? "s were" : " was"} caught and kept out of your alerts` : ""}${faults && visit ? "; " : ""}${visit ? `${visit} device${visit > 1 ? "s need" : " needs"} a field visit (offline or battery < 20 %)` : ""}.`);
    const agree = (d.verdicts.confirms ?? 0) + (d.verdicts.calm ?? 0);
    const compared = d.devices.length - (d.verdicts.insufficient ?? 0);
    if (compared) out.push(`${agree} of ${compared} sensors agree with the forecast; ${(d.verdicts.ahead ?? 0) + (d.verdicts.disagrees ?? 0)} show conditions the forecast does not — check those first.`);
    return out;
  }, [d]);

  return (
    <div className="space-y-5">
      <PageTitle
        eyebrow="Monitor · ground truth"
        title="Sensors & IoT"
        description={
          <>
            Water-level gauges, soil salinity probes, tide and rain gauges report here in real time. Every reading is checked against the forecast and screened for faults, so you know when the ground <i>confirms</i> a warning — and when a sensor, not the weather, is the problem.
          </>
        }
        actions={
          <>
            <PfButton variant="outline" onClick={exportCsv} disabled={!d}>
              <Download size={14} /> CSV
            </PfButton>
            {d?.canWrite && (
              <>
                <PfButton variant="outline" onClick={() => setWizard("virtual")}>
                  <Sparkles size={14} className="text-emerald-300" /> Virtual device demo
                </PfButton>
                <PfButton onClick={() => setWizard("connect")}>
                  <Plug size={14} /> Connect a device
                </PfButton>
              </>
            )}
          </>
        }
      />

      <QueryError error={overview.error} onRetry={() => overview.refetch()} />
      <VirtualConsole compact />

      {d && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <SourceTag>{d.sim.mode === "live-tick-60s" ? "Simulator · live tick 60 s" : "Simulator · backfilled on read"}</SourceTag>
          <SourceTag>Drivers: {d.drivers.source === "seed" ? "seeded district baselines (live feed unavailable)" : d.drivers.source === "open-meteo" ? "Open-Meteo / GloFAS cache" : "mixed live + seeded"}</SourceTag>
          <SourceTag>REST · LoRaWAN ingest</SourceTag>
          <span className="text-slate-500">Demo fleet: {d.sim.simulated} simulated devices across the demo workspaces; devices you connect are real.</span>
        </div>
      )}

      {!d ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Devices" value={d.counts.total} icon={Cpu} accent="cyan" hint="Registered devices in this workspace" />
          <StatTile label="Online" value={d.counts.online} icon={Radio} accent="green" delta={`${d.counts.total ? Math.round((d.counts.online / d.counts.total) * 100) : 0} % of fleet`} deltaGood />
          <StatTile label="Stale / offline" value={d.counts.stale + d.counts.offline} icon={WifiOff} accent={d.counts.offline ? "red" : "amber"} delta={`${d.counts.offline} offline > 6 h`} deltaGood={!d.counts.offline} />
          <StatTile label="Open alerts 24 h" value={d.anomalies.critical + d.anomalies.warning} icon={Siren} accent={d.anomalies.critical ? "red" : "amber"} delta={`${d.anomalies.critical} critical · ${d.anomalies.faults} faults`} deltaGood={!d.anomalies.critical} />
          <StatTile label="Readings 24 h" value={d.readings24h} icon={Activity} accent="violet" />
          <StatTile label="Low battery" value={d.lowBattery} icon={BatteryLow} accent={d.lowBattery ? "amber" : "green"} delta="below 20 %" deltaGood={!d.lowBattery} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Live fleet map" subtitle="Pins flash when a device reports · click to open" icon={Signal} accent="cyan" live className="xl:col-span-2">
          {d ? (
            d.devices.length ? (
              <FleetMap devices={d.devices} center={d.center} pulseIds={pulse.ids} pulseKey={pulse.key} onOpen={(id) => router.push(`/app/sensors/${id}`)} height={430} />
            ) : (
              <EmptyState icon={Cpu} title="No devices yet">
                Connect your first gauge or probe — or start a virtual device to see live ingestion in 10 seconds.
              </EmptyState>
            )
          ) : (
            <Skeleton className="h-[430px]" />
          )}
        </Panel>

        <Panel title="Alerts from the ground" subtitle="Last 7 days · newest first" icon={Siren} accent="red" bodyClassName="max-h-[440px] overflow-y-auto">
          {!d ? (
            <Skeleton className="h-64" />
          ) : !d.recentAnomalies.length ? (
            <EmptyState icon={CheckCheck} title="All quiet">
              No anomalies in the last 7 days. The detector checks every reading for rapid rises, salt surges, spikes and stuck sensors.
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {d.recentAnomalies.map((a) => (
                <motion.li key={a.id} layout className={cn("rounded-lg border border-white/5 bg-white/[0.02] p-2.5", a.ackedAt && "opacity-50")}>
                  <div className="flex items-start gap-2">
                    <SevDot severity={a.severity} />
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => router.push(`/app/sensors/${a.deviceId}`)} className="block text-left text-[12.5px] font-medium text-white hover:text-sky-300">
                        {a.title}
                      </button>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        <TypeIcon type={a.deviceType} size={11} /> {a.deviceName}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <ClassPill cls={a.cls} />
                        <span className="text-[10px] text-slate-500 telemetry">{ago(a.end)}</span>
                        {a.ackedAt ? (
                          <span className="text-[10px] text-slate-500">reviewed by {a.ackedBy}</span>
                        ) : (
                          <button type="button" className="text-[10px] text-sky-300 hover:underline" onClick={() => ack.mutate({ deviceId: a.deviceId, anomalyId: a.id })}>
                            Mark reviewed
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="What this means for you" icon={Sparkles} accent="emerald" className="lg:col-span-2">
          {d ? (
            <ul className="space-y-2 text-[13px] leading-relaxed text-slate-300">
              {summary.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                  {s}
                </li>
              ))}
              <li className="flex gap-2 text-slate-400">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                <span>
                  Why it matters: forecasts are regional; a gauge on <i>your</i> river or a probe in <i>your</i> field removes the guesswork — confirmed events justify early payouts or evacuations, and unconfirmed ones avoid false alarms (<Explain term="basis_risk">basis risk</Explain>).
                </span>
              </li>
            </ul>
          ) : (
            <Skeleton className="h-24" />
          )}
        </Panel>
        <Panel title="Sensor vs forecast" subtitle="Does the ground agree with the models?" icon={CheckCheck} accent="violet">
          {d ? (
            <div className="space-y-2">
              {(["confirms", "calm", "ahead", "disagrees", "insufficient"] as const).map((k) => {
                const n = d.verdicts[k] ?? 0;
                const m = VERDICT_META[k]!;
                return (
                  <div key={k}>
                    <div className="mb-0.5 flex items-center justify-between text-[11.5px]">
                      <span style={{ color: m.color }}>{m.label}</span>
                      <span className="telemetry text-slate-300">{n}</span>
                    </div>
                    <Meter value={d.devices.length ? (n / d.devices.length) * 100 : 0} color={m.color} />
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] text-slate-500">
                Gauges are compared with <Explain term="glofas">GloFAS</Explain> river flow and forecast rain; salinity probes with the modelled district <Explain term="ec">EC</Explain>; rain gauges with gridded rainfall.
              </p>
            </div>
          ) : (
            <Skeleton className="h-40" />
          )}
        </Panel>
      </div>

      <Panel
        title="Devices"
        subtitle={d ? `${filtered.length} of ${d.devices.length}` : undefined}
        icon={Cpu}
        accent="cyan"
        actions={
          <div className="relative hidden sm:block">
            <Search size={13} className="absolute left-2.5 top-2.5 text-slate-500" />
            <input className={cn(inputCls, "h-8 w-52 py-1 pl-8 text-xs")} placeholder="Search devices or assets" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search devices" />
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All", count: d?.counts.total },
              { value: "online", label: "Online", count: d?.counts.online },
              { value: "stale", label: "Stale", count: d?.counts.stale },
              { value: "offline", label: "Offline", count: d?.counts.offline },
              { value: "alerts", label: "With alerts", count: d?.devices.filter((x) => x.worst).length },
            ]}
          />
          <div className="flex flex-wrap gap-1.5">
            {DEVICE_TYPE_KEYS.filter((t) => d?.byType[t]).map((t) => (
              <Chip key={t} active={types.includes(t)} onClick={() => setTypes((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))} color={DEVICE_TYPES[t].color}>
                {DEVICE_TYPES[t].short} · {d?.byType[t]}
              </Chip>
            ))}
          </div>
          <input className={cn(inputCls, "h-8 py-1 text-xs sm:hidden")} placeholder="Search devices or assets" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search devices" />
        </div>
        {!d ? (
          <Skeleton className="h-64" />
        ) : !filtered.length ? (
          <EmptyState icon={Search} title="No device matches these filters" />
        ) : (
          <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((x) => {
              const meta = DEVICE_TYPES[x.type];
              return (
                <motion.button
                  key={x.id}
                  type="button"
                  layout
                  whileHover={{ y: -2 }}
                  onClick={() => router.push(`/app/sensors/${x.id}`)}
                  className={cn("group rounded-xl border bg-white/[0.02] p-3 text-left transition-colors hover:border-sky-400/40", x.worst === "critical" ? "border-rose-500/40" : x.worst ? "border-amber-400/30" : "border-white/5")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium text-white">
                        <TypeIcon type={x.type} />
                        <span className="truncate">{x.name}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">
                        {meta.short}
                        {x.asset ? ` · ${x.asset.name}` : ""}
                        {!x.simulated ? " · your device" : ""}
                      </div>
                    </div>
                    <StatusPill status={x.status} />
                  </div>
                  <div className="mt-2.5 flex items-end justify-between gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">{METRIC_META[x.primary.metric].label}{x.primary.metric === "rain_mm" ? " · last report" : ""}</div>
                      <div className="text-lg font-semibold text-white telemetry">{fmtMetric(x.primary.metric, x.primary.value)}</div>
                    </div>
                    <Spark values={x.spark} color={meta.color} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-slate-400">
                    <VerdictPill verdict={x.verdict} />
                    {x.openAnomalies > 0 && (
                      <span className={cn("rounded px-1.5 py-0.5 font-medium", x.worst === "critical" ? "bg-rose-500/15 text-rose-300" : "bg-amber-400/15 text-amber-300")}>
                        {x.openAnomalies} alert{x.openAnomalies > 1 ? "s" : ""}
                      </span>
                    )}
                    <span className="ml-auto telemetry">{ago(x.lastSeen)}</span>
                    {x.battery != null && (
                      <span className={cn("telemetry", x.battery < 20 ? "text-rose-300" : "text-slate-400")} title="Battery">
                        ⚡{Math.round(x.battery)}%
                      </span>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </Panel>

      {d && <ConnectWizard open={!!wizard} quickVirtual={wizard === "virtual"} onClose={() => setWizard(null)} center={d.center} onOpenDevice={(id) => router.push(`/app/sensors/${id}`)} />}
    </div>
  );
}
