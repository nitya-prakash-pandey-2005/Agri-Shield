"use client";

/**
 * Sensors & IoT — device detail: live values, charts (1 h / 24 h / 7 d / 30 d)
 * with anomaly shading, forecast-vs-observed verdict, anomaly log with
 * plain-language explanations, device health, metadata / provisioning,
 * key rotation, edit, delete and a browser virtual-device stream.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMemo, useState } from "react";
import { ArrowLeft, BatteryMedium, CheckCheck, Cpu, FileDown, HeartPulse, History, KeyRound, LineChart, MapPin, Pencil, Play, Scale, Siren, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { EmptyState, Meter, Panel, Skeleton, SourceTag } from "@/components/hud";
import { Field, Modal, PfButton, QueryError, Segmented, inputCls } from "@/components/portfolio/ui";
import { Explain } from "@/components/help/Explain";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/hooks/useRealtime";
import { DEVICE_TYPES, METRIC_META, type MetricKey } from "@/server/services/iot-types";
import { MetricChart } from "@/components/sensors/charts";
import { ClassPill, SevDot, StatusPill, TypeIcon, VerdictPill, ago, fmtMetric } from "@/components/sensors/meta";
import { KeyReveal, QrProvision, SnippetTabs, VirtualConsole, provisioningUri } from "@/components/sensors/connect";
import { useVirtualDevice, virtualDevice } from "@/components/sensors/virtual-device";

const FleetMap = dynamic(() => import("@/components/sensors/FleetMap"), { ssr: false, loading: () => <Skeleton className="h-[220px]" /> });

type Range = "1h" | "24h" | "7d" | "30d";
const HIDDEN_IN_TILES = new Set<MetricKey>(["rssi_dbm", "snr_db"]);
const GLOSSARY: Partial<Record<MetricKey, string>> = { soil_ec: "ec", soil_moisture: "soil_moisture" };

export default function DevicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: session } = useSession();
  const orgId = session?.user?.orgId ?? null;
  const [range, setRange] = useState<Range>("24h");
  const [editOpen, setEditOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const v = useVirtualDevice();

  const q = trpc.sensors.device.useQuery({ id }, { refetchInterval: 15_000, retry: 1 });
  const series = trpc.sensors.series.useQuery({ id, range }, { refetchInterval: range === "1h" ? 10_000 : range === "24h" ? 30_000 : 120_000, placeholderData: (p) => p });

  useRealtime(orgId ? [`ws:${orgId}`] : [], (env) => {
    const ev = env.event as unknown as { type: string; devices?: { id: string }[]; deviceId?: string };
    if ((ev.type === "sensors.readings" && ev.devices?.some((x) => x.id === id)) || (ev.type === "sensor.anomaly" && ev.deviceId === id)) {
      void utils.sensors.device.invalidate({ id });
      if (range === "1h" || range === "24h") void utils.sensors.series.invalidate({ id, range });
    }
  });

  const ack = trpc.sensors.ackAnomaly.useMutation({ onSuccess: () => utils.sensors.device.invalidate({ id }) });
  const rotate = trpc.sensors.rotateKey.useMutation({
    onSuccess: (r) => {
      setNewKey(r.key);
      if (v.running && v.deviceId === id) virtualDevice.stop();
      void utils.sensors.device.invalidate({ id });
      toast.success("Key rotated", { description: "The old key stopped working immediately." });
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.sensors.remove.useMutation({
    onSuccess: () => {
      if (v.deviceId === id) virtualDevice.stop();
      toast.success("Device removed");
      void utils.sensors.overview.invalidate();
      router.push("/app/sensors");
    },
    onError: (e) => toast.error(e.message),
  });

  const d = q.data;
  const dev = d?.device;
  const meta = dev ? DEVICE_TYPES[dev.type] : null;
  const chartMetrics = useMemo(() => (meta ? meta.metrics.filter((m) => m !== "rssi_dbm" && m !== "snr_db") : []), [meta]);

  if (q.error) {
    return (
      <div className="space-y-4">
        <Link href="/app/sensors" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
          <ArrowLeft size={13} /> All sensors
        </Link>
        <EmptyState icon={Cpu} title="Device not found">
          It may have been removed, or it belongs to another workspace.
        </EmptyState>
      </div>
    );
  }
  if (!d || !dev || !meta) return <Skeleton className="h-[640px]" />;

  const exportCsv = () => {
    const s = series.data;
    if (!s) return;
    const times = [...new Set(Object.values(s.series).flatMap((pts) => pts.map((p) => p.t)))].sort((a, b) => a - b);
    const idx = Object.fromEntries(Object.entries(s.series).map(([k, pts]) => [k, new Map(pts.map((p) => [p.t, p.v]))]));
    const keys = Object.keys(s.series);
    const csv = [["time_utc", ...keys].join(","), ...times.map((t) => [new Date(t).toISOString(), ...keys.map((k) => idx[k]!.get(t) ?? "")].join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dev.id}-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const h = d.health;
  const rangePicker = <Segmented<Range> value={range} onChange={setRange} options={[{ value: "1h", label: "1 h" }, { value: "24h", label: "24 h" }, { value: "7d", label: "7 d" }, { value: "30d", label: "30 d" }]} />;
  const cmp = d.comparison;
  const streaming = v.running && v.deviceId === dev.id;

  return (
    <div className="space-y-5">
      <Link href="/app/sensors" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
        <ArrowLeft size={13} /> All sensors
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="hud-label mb-1.5 flex items-center gap-2 text-sky-300/90">
            <TypeIcon type={dev.type} /> {meta.label}
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white md:text-[28px]">{dev.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
            <StatusPill status={d.status} />
            <span className="telemetry">last reading {ago(dev.lastSeen)}</span>
            {d.asset && (
              <Link href={`/app/portfolio/${d.asset.id}`} className="text-sky-300 hover:underline">
                ↳ {d.asset.name}
              </Link>
            )}
            {d.district && <span>· {d.district.name}, {d.district.country}</span>}
            <SourceTag>{dev.simulated ? "Simulated demo device" : `Your device · via ${dev.counters.lastIngestVia ?? "—"}`}</SourceTag>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PfButton variant="outline" onClick={exportCsv}>
            <FileDown size={14} /> CSV
          </PfButton>
          {d.canWrite && (
            <>
              <PfButton variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil size={14} /> Edit
              </PfButton>
              <PfButton variant="outline" onClick={() => { setNewKey(null); setRotateOpen(true); }}>
                <KeyRound size={14} /> Rotate key
              </PfButton>
              <PfButton variant="danger" onClick={() => setDelOpen(true)}>
                <Trash2 size={14} />
              </PfButton>
            </>
          )}
        </div>
      </div>

      <VirtualConsole deviceId={dev.id} />

      {/* live values */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {meta.metrics.filter((m) => !HIDDEN_IN_TILES.has(m)).map((m) => (
          <div key={m} className="hud-panel p-3" style={{ ["--hud-accent" as string]: "56 189 248" }}>
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
              {METRIC_META[m].label}
              {GLOSSARY[m] ? <Explain term={GLOSSARY[m]} /> : <Explain text={METRIC_META[m].help} />}
            </div>
            <div className="mt-1.5 text-xl font-semibold text-white telemetry" style={{ textShadow: `0 0 18px ${METRIC_META[m].color}66` }}>
              {fmtMetric(m, dev.lastValues[m])}
            </div>
            {m === "water_level_m" && dev.thresholds.danger != null && dev.lastValues.water_level_m != null && (
              <div className="mt-1.5">
                <Meter value={(dev.lastValues.water_level_m / dev.thresholds.danger) * 100} color={dev.lastValues.water_level_m >= dev.thresholds.danger ? "#f87171" : dev.thresholds.warning != null && dev.lastValues.water_level_m >= dev.thresholds.warning ? "#fbbf24" : "#38bdf8"} />
                <div className="mt-0.5 text-[10px] text-slate-500 telemetry">{(dev.thresholds.danger - dev.lastValues.water_level_m).toFixed(2)} m below danger</div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Panel
          title="Readings"
          subtitle={range === "1h" || range === "24h" ? "Native resolution" : "Hourly+ aggregates · band = min–max"}
          icon={LineChart}
          accent="cyan"
          live={d.status === "online"}
          className="xl:col-span-2"
          actions={<div className="hidden sm:block">{rangePicker}</div>}
        >
          <div className="mb-3 sm:hidden">{rangePicker}</div>
          {!series.data ? (
            <Skeleton className="h-72" />
          ) : (
            <div className="space-y-4">
              {chartMetrics.map((m, i) => {
                const pts = series.data.series[m] ?? [];
                return (
                  <div key={m}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-medium" style={{ color: METRIC_META[m].color }}>
                        {METRIC_META[m].label} <span className="text-slate-500">({METRIC_META[m].unit})</span>
                      </span>
                      <span className="text-slate-500 telemetry">{pts.length} pts</span>
                    </div>
                    {pts.length ? (
                      <MetricChart points={pts} metric={m} range={range} from={new Date(series.data.from).getTime()} to={new Date(series.data.to).getTime()} anomalies={series.data.anomalies} thresholds={series.data.thresholds} height={i === 0 ? 230 : 150} />
                    ) : (
                      <div className="grid h-24 place-items-center rounded-lg border border-dashed border-white/10 text-[11px] text-slate-500">No readings in this window</div>
                    )}
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-3 text-[10.5px] text-slate-500">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-rose-400/40" /> real event</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-amber-400/40" /> check device</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-slate-400/40" /> sensor fault</span>
              </div>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Sensor vs forecast" icon={Scale} accent="violet">
            <div className="flex items-center gap-2">
              <VerdictPill verdict={cmp.verdict} />
            </div>
            <div className="mt-2 text-[14px] font-semibold text-white">{cmp.headline}</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-300">{cmp.detail}</p>
            {(cmp.observed.length > 0 || cmp.forecast.length > 0) && (
              <div className="mt-3 grid grid-cols-2 gap-3 text-[11.5px]">
                <div>
                  <div className="hud-label mb-1">Measured</div>
                  {cmp.observed.map((r) => (
                    <div key={r.label} className="flex justify-between gap-2 border-b border-white/5 py-1">
                      <span className="text-slate-400">{r.label}</span>
                      <span className="text-right text-white telemetry">{r.value}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="hud-label mb-1">Forecast / model</div>
                  {cmp.forecast.map((r) => (
                    <div key={r.label} className="flex justify-between gap-2 border-b border-white/5 py-1">
                      <span className="text-slate-400">{r.label}</span>
                      <span className="text-right text-white telemetry">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-2">
              <SourceTag>{cmp.source}</SourceTag>
            </div>
          </Panel>

          <Panel title="Device health" subtitle={`score ${h.score}/100`} icon={HeartPulse} accent={h.score >= 80 ? "green" : h.score >= 50 ? "amber" : "red"}>
            <div className="space-y-2.5 text-[12px]">
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="flex items-center gap-1 text-slate-400"><BatteryMedium size={13} /> Battery</span>
                  <span className="text-white telemetry">{h.battery ?? "—"} %</span>
                </div>
                <Meter value={h.battery ?? 0} color={(h.battery ?? 0) < 20 ? "#f87171" : (h.battery ?? 0) < 40 ? "#fbbf24" : "#4ade80"} />
                <div className="mt-0.5 text-[10.5px] text-slate-500">
                  {h.drainPerDay != null && h.drainPerDay > 0.02 ? `draining ${h.drainPerDay} %/day${h.daysToEmpty != null ? ` · empty in ~${h.daysToEmpty} days` : ""}` : "stable (solar or negligible drain)"}
                </div>
              </div>
              <Row label={<>Packet loss 24 h <Explain text="Share of expected reports that never arrived. Above ~15 % usually means a weak radio link, an obstructed antenna or a gateway problem." /></>} value={h.packetLoss24h == null ? "—" : `${(h.packetLoss24h * 100).toFixed(1)} % (${h.received24h}/${h.expected24h})`} warn={(h.packetLoss24h ?? 0) > 0.15} />
              <Row label={<>Signal (RSSI / SNR) <Explain text={METRIC_META.rssi_dbm.help} /></>} value={h.rssiAvg == null ? "—" : `${h.rssiAvg} dBm${h.snrAvg != null ? ` / ${h.snrAvg} dB` : ""}`} warn={(h.rssiAvg ?? 0) < -115} />
              <Row label="Uptime 7 d" value={h.uptime7d == null ? "—" : `${Math.round(h.uptime7d * 100)} %`} warn={(h.uptime7d ?? 1) < 0.9} />
              <Row label="Firmware" value={`${dev.firmware}${h.firmwareOutdated ? ` → ${h.firmwareLatest}` : " (latest)"}`} warn={h.firmwareOutdated} />
              {h.issues.length > 0 ? (
                <ul className="space-y-1 rounded-lg bg-amber-400/5 p-2 text-[11.5px] text-amber-200">
                  {h.issues.map((i) => <li key={i}>• {i}</li>)}
                </ul>
              ) : (
                <div className="rounded-lg bg-emerald-400/5 p-2 text-[11.5px] text-emerald-300">No maintenance needed.</div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Panel title="Anomalies" subtitle="Last 30 days · detector: robust z-score, EWMA change-point, flatline & spike screens" icon={Siren} accent="red" className="xl:col-span-2" bodyClassName="max-h-[460px] overflow-y-auto">
          {!d.anomalies.length ? (
            <EmptyState icon={CheckCheck} title="Nothing unusual">
              Every reading passed the checks for rapid rises, salinity surges, spikes, stuck values and gaps.
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {d.anomalies.map((a) => (
                <li key={a.id} className={cn("rounded-lg border border-white/5 bg-white/[0.02] p-3", a.ackedAt && "opacity-55")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <SevDot severity={a.severity} />
                    <span className="text-[13px] font-medium text-white">{a.title}</span>
                    <ClassPill cls={a.cls} />
                    <span className="ml-auto text-[10.5px] text-slate-500 telemetry">
                      {new Date(a.start).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {a.end - a.start > 60_000 ? ` → ${new Date(a.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-slate-300">{a.explanation}</p>
                  <div className="mt-1.5 flex items-center gap-3 text-[10.5px] text-slate-500">
                    <span>{METRIC_META[a.metric].label}</span>
                    {a.ackedAt ? (
                      <span>reviewed by {a.ackedBy}</span>
                    ) : (
                      <button type="button" className="text-sky-300 hover:underline" onClick={() => ack.mutate({ deviceId: dev.id, anomalyId: a.id })}>
                        Mark reviewed
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Device & provisioning" icon={Cpu} accent="cyan">
          <div className="space-y-3 text-[12px]">
            <FleetMap devices={[{ id: dev.id, name: dev.name, type: dev.type, lat: dev.lat, lon: dev.lon, status: d.status, primary: { metric: meta.primary, value: dev.lastValues[meta.primary] ?? null }, worst: null }]} center={[dev.lat, dev.lon]} height={180} zoom={11} />
            <Row label="Device ID" value={dev.id} />
            <Row label="Connectivity" value={`${meta.connectivity} · every ${dev.intervalSec >= 60 ? `${Math.round(dev.intervalSec / 60)} min` : `${dev.intervalSec} s`}`} />
            <Row label="Installed" value={new Date(dev.installedAt).toLocaleDateString()} />
            <Row label="Location" value={`${dev.lat.toFixed(4)}, ${dev.lon.toFixed(4)}`} icon={<MapPin size={11} />} />
            {dev.devEui && <Row label="DevEUI" value={dev.devEui} />}
            {dev.type === "river_gauge" && <Row label="Warning / danger" value={`${dev.thresholds.warning ?? "—"} / ${dev.thresholds.danger ?? "—"} m`} />}
            <Row label={<>Key <Explain term="api_key" /></>} value={`${dev.keyPrefix}… · rotated ${ago(dev.keyRotatedAt)}`} />
            <Row label="MQTT topic" value={`agrishield/${dev.orgId}/${dev.id}/up`} />
            <Row label="Packets" value={`${dev.counters.received.toLocaleString()} ok · ${dev.counters.duplicates} dup · ${dev.counters.rejected} rejected`} />
            <div className="flex justify-center pt-1">
              <QrProvision text={provisioningUri({ deviceId: dev.id, orgId: dev.orgId, type: dev.type, origin: typeof window !== "undefined" ? window.location.origin : "" })} size={132} caption="Provisioning code (ID + endpoint). Rotate the key to get a code that also carries a new key." />
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Panel title="Send data to this device" subtitle="Copy-paste examples" icon={Play} accent="emerald" className="xl:col-span-2">
          <SnippetTabs deviceId={dev.id} orgId={dev.orgId} type={dev.type} deviceKey={newKey} intervalSec={dev.intervalSec} />
          {!newKey && <p className="mt-2 text-[11px] text-slate-500">Keys are shown only once. Rotate the key to fill it into these snippets (the device will need the new key).</p>}
        </Panel>
        <Panel title="Recent packets" subtitle="Newest first · as stored (normalised units)" icon={History} accent="violet" bodyClassName="max-h-[340px] overflow-y-auto">
          {!d.packets.length ? (
            <EmptyState icon={History} title="No packets in 24 h" />
          ) : (
            <ul className="space-y-1 text-[10.5px] telemetry">
              {d.packets.map((p) => (
                <li key={String(p.t)} className="border-b border-white/5 pb-1">
                  <span className="text-slate-500">{new Date(p.t).toLocaleTimeString()}</span>{" "}
                  <span className="text-slate-300">
                    {Object.entries(p.v)
                      .filter(([k]) => k !== "rssi_dbm" && k !== "snr_db")
                      .map(([k, val]) => `${METRIC_META[k as MetricKey].short} ${fmtMetric(k as MetricKey, val as number)}`)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {editOpen && <EditDevice device={dev} onClose={() => setEditOpen(false)} />}

      <Modal
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        title={newKey ? "New device key" : "Rotate device key?"}
        subtitle={newKey ? "Shown once — update the firmware or TTN webhook now." : "The current key stops working immediately. Use this if a key leaked or a device was re-flashed."}
        footer={
          newKey ? (
            <>
              {!streaming && (
                <PfButton
                  variant="outline"
                  onClick={() => {
                    virtualDevice.start({ deviceId: dev.id, deviceName: dev.name, type: dev.type, key: newKey, history: false });
                    setRotateOpen(false);
                  }}
                >
                  <Play size={13} /> Stream from this browser
                </PfButton>
              )}
              <PfButton onClick={() => setRotateOpen(false)}>Done</PfButton>
            </>
          ) : (
            <>
              <PfButton variant="ghost" onClick={() => setRotateOpen(false)}>
                Cancel
              </PfButton>
              <PfButton variant="danger" loading={rotate.isPending} onClick={() => rotate.mutate({ id: dev.id })}>
                Rotate key
              </PfButton>
            </>
          )
        }
      >
        {newKey ? (
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <KeyReveal deviceKey={newKey} />
            <QrProvision text={provisioningUri({ deviceId: dev.id, orgId: dev.orgId, type: dev.type, origin: window.location.origin, key: newKey })} size={150} caption="Scan to re-provision" />
          </div>
        ) : (
          <p className="text-sm text-slate-300">
            Device <b>{dev.name}</b> currently uses key <code className="telemetry text-sky-300">{dev.keyPrefix}…</code>. {dev.simulated ? "This is a simulated demo device — after rotating you can post real readings to it yourself." : ""}
          </p>
        )}
      </Modal>

      <Modal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="Remove this device?"
        subtitle="Its readings, anomalies and key are deleted. This cannot be undone."
        footer={
          <>
            <PfButton variant="ghost" onClick={() => setDelOpen(false)}>
              Cancel
            </PfButton>
            <PfButton variant="danger" loading={remove.isPending} onClick={() => remove.mutate({ id: dev.id })}>
              Remove device
            </PfButton>
          </>
        }
      >
        <p className="text-sm text-slate-300">{dev.name}</p>
      </Modal>
    </div>
  );
}

function Row({ label, value, warn, icon }: { label: React.ReactNode; value: string; warn?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-1.5">
      <span className="flex items-center gap-1 text-slate-400">{label}</span>
      <span className={cn("flex min-w-0 items-center gap-1 truncate text-right telemetry", warn ? "text-amber-300" : "text-slate-200")} title={value}>
        {icon}
        {value}
      </span>
    </div>
  );
}

type Dev = inferRouterOutputs<AppRouter>["sensors"]["device"]["device"];

function EditDevice({ device, onClose }: { device: Dev; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(device.name);
  const [lat, setLat] = useState(String(device.lat));
  const [lon, setLon] = useState(String(device.lon));
  const [interval, setInterval_] = useState(String(device.intervalSec));
  const [warning, setWarning] = useState(device.thresholds.warning == null ? "" : String(device.thresholds.warning));
  const [danger, setDanger] = useState(device.thresholds.danger == null ? "" : String(device.thresholds.danger));
  const [devEui, setDevEui] = useState(device.devEui ?? "");
  const [notes, setNotes] = useState(device.notes ?? "");
  const [assetId, setAssetId] = useState<string | null>(device.assetId);
  const [assetQ, setAssetQ] = useState("");
  const assets = trpc.sensors.assetOptions.useQuery({ q: assetQ || undefined }, { placeholderData: (p) => p });
  const save = trpc.sensors.update.useMutation({
    onSuccess: () => {
      toast.success("Device updated");
      void utils.sensors.device.invalidate({ id: device.id });
      void utils.sensors.overview.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const valid = name.trim().length >= 2 && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180 && Number(interval) >= 10 && (!devEui || /^[0-9A-Fa-f]{16}$/.test(devEui));
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit device"
      footer={
        <>
          <PfButton variant="ghost" onClick={onClose}>
            Cancel
          </PfButton>
          <PfButton
            loading={save.isPending}
            disabled={!valid}
            onClick={() =>
              save.mutate({
                id: device.id,
                name: name.trim(),
                lat: Number(lat),
                lon: Number(lon),
                intervalSec: Math.round(Number(interval)),
                assetId,
                devEui: devEui || null,
                notes: notes || null,
                ...(device.type === "river_gauge" ? { thresholds: { warning: num(warning), danger: num(danger) } } : {}),
              })
            }
          >
            Save
          </PfButton>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={90} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude">
            <input className={inputCls} value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Longitude">
            <input className={inputCls} value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Reporting interval (s)" hint="Used for online/stale status and packet-loss maths.">
            <input className={inputCls} value={interval} onChange={(e) => setInterval_(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="DevEUI (LoRaWAN)">
            <input className={cn(inputCls, "telemetry uppercase")} value={devEui} onChange={(e) => setDevEui(e.target.value.trim())} maxLength={16} />
          </Field>
          {device.type === "river_gauge" && (
            <>
              <Field label="Warning level (m)">
                <input className={inputCls} value={warning} onChange={(e) => setWarning(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Danger level (m)">
                <input className={inputCls} value={danger} onChange={(e) => setDanger(e.target.value)} inputMode="decimal" />
              </Field>
            </>
          )}
        </div>
        <Field label="Linked asset">
          <input className={inputCls} value={assetQ} onChange={(e) => setAssetQ(e.target.value)} placeholder="Search assets…" />
          <div className="mt-1.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
            <button type="button" onClick={() => setAssetId(null)} className={cn("rounded-full border px-2 py-0.5 text-[11px]", !assetId ? "border-sky-400/70 text-white" : "border-slate-700/70 text-slate-400")}>
              none
            </button>
            {(assets.data ?? []).slice(0, 12).map((a) => (
              <button key={a.id} type="button" onClick={() => setAssetId(a.id)} className={cn("rounded-full border px-2 py-0.5 text-[11px]", assetId === a.id ? "border-sky-400/70 bg-sky-400/10 text-white" : "border-slate-700/70 text-slate-400 hover:text-white")}>
                {a.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Notes">
          <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>
      </div>
    </Modal>
  );
}
