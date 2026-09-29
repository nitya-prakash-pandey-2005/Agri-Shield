"use client";

/**
 * "Connect a device" building blocks + wizard:
 *   QrProvision   scannable provisioning QR (device id, workspace, ingest URL, key)
 *   KeyReveal     one-time key display with copy
 *   SnippetTabs   curl / Python / ESP32 / Arduino / LoRaWAN (TTN) / MQTT
 *   VirtualConsole live log of the in-browser virtual device
 *   ConnectWizard 2-step modal: describe the device → credentials, code, go live
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, KeyRound, MapPin, Play, Radio, Search, ShieldAlert, Square, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { Field, Modal, PfButton, inputCls } from "@/components/portfolio/ui";
import { Explain } from "@/components/help/Explain";
import { DEVICE_TYPES, DEVICE_TYPE_KEYS, type DeviceType } from "@/server/services/iot-types";
import { deviceSnippet, type SnippetLang } from "@/server/services/iot-docs";
import { encodeQr, qrSvgPath } from "./qr";
import { TypeIcon, StatusPill, ago } from "./meta";
import { EVENTS_FOR, useVirtualDevice, virtualDevice } from "./virtual-device";

export function provisioningUri(o: { deviceId: string; orgId: string; type: DeviceType; origin: string; key?: string | null }) {
  const q = new URLSearchParams({ v: "1", d: o.deviceId, o: o.orgId, t: o.type, u: `${o.origin}/api/v1/telemetry` });
  if (o.key) q.set("k", o.key);
  return `agrishield://provision?${q.toString()}`;
}

export function QrProvision({ text, size = 168, caption }: { text: string; size?: number; caption?: string }) {
  const qr = useMemo(() => {
    try {
      return qrSvgPath(encodeQr(text));
    } catch {
      return null;
    }
  }, [text]);
  if (!qr) return <div className="text-xs text-rose-300">Provisioning payload too long for a QR code.</div>;
  return (
    <figure className="inline-flex flex-col items-center gap-1.5">
      <svg width={size} height={size} viewBox={`0 0 ${qr.size} ${qr.size}`} className="rounded-lg shadow-[0_0_30px_-8px_rgba(56,189,248,0.6)]" role="img" aria-label="Provisioning QR code" shapeRendering="crispEdges">
        <rect width={qr.size} height={qr.size} fill="#fff" />
        <path d={qr.path} fill="#020617" />
      </svg>
      {caption && <figcaption className="max-w-[200px] text-center text-[10px] text-slate-500">{caption}</figcaption>}
    </figure>
  );
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className={cn("inline-flex items-center gap-1 rounded-md border border-slate-700/70 px-2 py-1 text-[11px] text-slate-300 hover:border-sky-400/60 hover:text-white", className)}
    >
      {done ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      {done ? "Copied" : label}
    </button>
  );
}

export function KeyReveal({ deviceKey }: { deviceKey: string }) {
  return (
    <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
        <KeyRound size={13} /> Device key — shown once
        <Explain text="Every device authenticates with its own key. We store only a SHA-256 fingerprint, so this is the only time the full key is visible. Rotate it from the device page if it leaks — the old key stops working immediately." />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-slate-950/80 px-2.5 py-1.5 text-[12px] text-amber-100 telemetry">{deviceKey}</code>
        <CopyButton text={deviceKey} label="Copy key" />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">Put it in the device firmware or your TTN webhook header. Anyone with this key can post data as this device.</p>
    </div>
  );
}

const LANGS: { id: SnippetLang; label: string }[] = [
  { id: "curl", label: "curl" },
  { id: "python", label: "Python" },
  { id: "esp32", label: "ESP32" },
  { id: "arduino", label: "Arduino" },
  { id: "ttn", label: "LoRaWAN (TTN)" },
  { id: "mqtt", label: "MQTT" },
];

export function SnippetTabs({ deviceId, orgId, type, deviceKey, intervalSec }: { deviceId: string; orgId: string; type: DeviceType; deviceKey: string | null; intervalSec: number }) {
  const [lang, setLang] = useState<SnippetLang>("curl");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.agrishield.io";
  const code = deviceSnippet(lang, { origin, deviceId, orgId, key: deviceKey ?? "dk_YOUR_DEVICE_KEY_FROM_ROTATE_KEY", type, intervalSec });
  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-[#040914]">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-2 py-1.5">
        <div className="flex gap-1 overflow-x-auto" role="tablist">
          {LANGS.map((l) => (
            <button key={l.id} type="button" role="tab" aria-selected={lang === l.id} onClick={() => setLang(l.id)} className={cn("whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium", lang === l.id ? "bg-sky-400/15 text-sky-200" : "text-slate-400 hover:text-white")}>
              {l.label}
            </button>
          ))}
        </div>
        <CopyButton text={code} />
      </div>
      <pre className="max-h-72 overflow-auto p-3 text-[11px] leading-relaxed text-slate-300 telemetry">{code}</pre>
    </div>
  );
}

export function VirtualConsole({ deviceId, compact }: { deviceId?: string; compact?: boolean }) {
  const v = useVirtualDevice();
  if (!v.running && !v.log.length) return null;
  if (deviceId && v.deviceId !== deviceId) return null;
  const events = v.type ? EVENTS_FOR[v.type] : [];
  return (
    <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] text-emerald-200">
          <Radio size={14} className={v.running ? "animate-pulse" : ""} />
          <span className="font-medium">Virtual device {v.running ? "streaming" : "stopped"}</span>
          <span className="text-slate-400">· {v.deviceName}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400 telemetry">
          <span>sent {v.sent}</span>
          <span className="text-emerald-300">accepted {v.accepted}</span>
          {v.failed > 0 && <span className="text-rose-300">failed {v.failed}</span>}
          {v.running ? (
            <PfButton size="sm" variant="danger" onClick={() => virtualDevice.stop()}>
              <Square size={11} /> Stop
            </PfButton>
          ) : null}
        </div>
      </div>
      {v.running && events.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {events.map((e) => (
            <PfButton key={e.event} size="sm" variant="outline" disabled={!!v.event} onClick={() => virtualDevice.trigger(e.event)} title={e.expect}>
              <Zap size={12} className="text-amber-300" /> {v.event === e.event ? `${e.label} (${v.eventLeft} packets left)` : e.label}
            </PfButton>
          ))}
          <span className="text-[11px] text-slate-500">{events[0]!.expect}</span>
        </div>
      )}
      {!compact && (
        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-slate-950/70 p-2 text-[10.5px] telemetry">
          {v.log.map((l) => (
            <div key={l.at} className="flex gap-2">
              <span className="shrink-0 text-slate-600">{new Date(l.at).toLocaleTimeString()}</span>
              <span className={cn("shrink-0", l.ok ? "text-emerald-400" : "text-rose-400")}>{l.status ?? "ERR"}</span>
              <span className="min-w-0 truncate text-slate-400" title={l.payload}>
                POST {l.payload}
              </span>
              <span className="shrink-0 text-slate-300">→ {l.reply}</span>
            </div>
          ))}
          {!v.log.length && <div className="text-slate-600">Connecting…</div>}
        </div>
      )}
    </div>
  );
}

// ─── Wizard ──────────────────────────────────────────────────────────────

interface Created {
  id: string;
  name: string;
  type: DeviceType;
  orgId: string;
  intervalSec: number;
  key: string;
}

export function ConnectWizard({ open, onClose, center, quickVirtual, onCreated, onOpenDevice }: { open: boolean; onClose: () => void; center: [number, number]; quickVirtual?: boolean; onCreated?: () => void; onOpenDevice?: (id: string) => void }) {
  const utils = trpc.useUtils();
  const [type, setType] = useState<DeviceType>("river_gauge");
  const [name, setName] = useState("");
  const [assetQ, setAssetQ] = useState("");
  const [assetId, setAssetId] = useState<string | null>(null);
  const [lat, setLat] = useState(String(center[0].toFixed(4)));
  const [lon, setLon] = useState(String(center[1].toFixed(4)));
  const [devEui, setDevEui] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const assets = trpc.sensors.assetOptions.useQuery({ q: assetQ || undefined }, { enabled: open && !created, placeholderData: (p) => p });
  const live = trpc.sensors.device.useQuery({ id: created?.id ?? "" }, { enabled: !!created, refetchInterval: 3000 });
  const v = useVirtualDevice();

  const create = trpc.sensors.create.useMutation({
    onSuccess: (r) => {
      const c: Created = { id: r.device.id, name: r.device.name, type: r.device.type, orgId: r.device.orgId, intervalSec: r.device.intervalSec, key: r.key };
      setCreated(c);
      void utils.sensors.overview.invalidate();
      onCreated?.();
      if (quickVirtual) startVirtual(c);
    },
    onError: (e) => toast.error(e.message),
  });

  function startVirtual(c: Created) {
    virtualDevice.start({ deviceId: c.id, deviceName: c.name, type: c.type, key: c.key });
    toast.success("Virtual device streaming", { description: "Readings are POSTed from your browser to /api/v1/telemetry every 3 s." });
  }

  useEffect(() => {
    if (!open) return;
    setCreated(null);
    setAssetId(null);
    setAssetQ("");
    setDevEui("");
    setLat(center[0].toFixed(4));
    setLon(center[1].toFixed(4));
    setType("river_gauge");
    setName(quickVirtual ? `Virtual gauge · browser demo ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "");
    if (quickVirtual) {
      create.mutate({ name: `Virtual gauge · browser demo ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, type: "river_gauge", lat: center[0], lon: center[1], intervalSec: 10 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickAsset = (a: { id: string; name: string; lat: number; lon: number }) => {
    setAssetId(a.id);
    setLat(a.lat.toFixed(5));
    setLon(a.lon.toFixed(5));
    if (!name) setName(`${DEVICE_TYPES[type].short} · ${a.name}`);
  };
  const latN = Number(lat);
  const lonN = Number(lon);
  const coordsOk = Number.isFinite(latN) && Number.isFinite(lonN) && Math.abs(latN) <= 90 && Math.abs(lonN) <= 180;
  const euiOk = !devEui || /^[0-9A-Fa-f]{16}$/.test(devEui);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const status = live.data?.status ?? "never";

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={created ? `Connect “${created.name}”` : "Connect a device"}
      subtitle={created ? "Step 2 of 2 · credentials, code and first reading" : "Step 1 of 2 · what is it and where is it?"}
      footer={
        created ? (
          <>
            <span className="mr-auto flex items-center gap-2 text-[11px] text-slate-400">
              <StatusPill status={status} /> {live.data?.device.lastSeen ? `last reading ${ago(live.data.device.lastSeen)}` : "waiting for the first reading…"}
            </span>
            <PfButton variant="ghost" onClick={onClose}>
              Close
            </PfButton>
            <PfButton onClick={() => onOpenDevice?.(created.id)}>Open device</PfButton>
          </>
        ) : (
          <>
            <PfButton variant="ghost" onClick={onClose}>
              Cancel
            </PfButton>
            <PfButton loading={create.isPending} disabled={name.trim().length < 2 || !coordsOk || !euiOk} onClick={() => create.mutate({ name: name.trim(), type, lat: latN, lon: lonN, assetId, devEui: devEui || null })}>
              Create device & get key
            </PfButton>
          </>
        )
      }
    >
      <AnimatePresence mode="wait">
        {!created ? (
          <motion.div key="s1" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="space-y-4">
            {quickVirtual && create.isPending && <div className="text-sm text-slate-400">Provisioning a virtual gauge…</div>}
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">Device type</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {DEVICE_TYPE_KEYS.map((t) => (
                  <button key={t} type="button" onClick={() => setType(t)} className={cn("rounded-xl border p-2.5 text-left transition-colors", type === t ? "border-sky-400/60 bg-sky-400/10" : "border-slate-700/60 hover:border-slate-500")}>
                    <div className="flex items-center gap-2 text-[12px] font-medium text-white">
                      <TypeIcon type={t} /> {DEVICE_TYPES[t].short}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-slate-400">{DEVICE_TYPES[t].description}</div>
                    <div className="mt-1 text-[10px] text-slate-500 telemetry">
                      {DEVICE_TYPES[t].connectivity} · every {DEVICE_TYPES[t].intervalSec >= 60 ? `${DEVICE_TYPES[t].intervalSec / 60} min` : `${DEVICE_TYPES[t].intervalSec} s`}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <Field label="Name" hint="What the field team calls it — shown on maps and alerts.">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${DEVICE_TYPES[type].short} · North embankment`} maxLength={90} />
            </Field>
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Link to an asset <span className="normal-case tracking-normal text-slate-500">(optional)</span>
                <Explain text="Linking puts the sensor's readings on that asset's page and lets alert rules use ground truth (measured level / salinity) for it." />
              </div>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-2.5 text-slate-500" />
                <input className={cn(inputCls, "pl-8")} value={assetQ} onChange={(e) => setAssetQ(e.target.value)} placeholder="Search your plots, loans, sites…" />
              </div>
              <div className="mt-1.5 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {(assets.data ?? []).slice(0, 14).map((a) => (
                  <button key={a.id} type="button" onClick={() => pickAsset(a)} className={cn("rounded-full border px-2 py-0.5 text-[11px]", assetId === a.id ? "border-sky-400/70 bg-sky-400/10 text-white" : "border-slate-700/70 text-slate-400 hover:text-white")}>
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Latitude" error={coordsOk ? null : "Invalid coordinates"}>
                <input className={inputCls} value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Longitude">
                <input className={inputCls} value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" />
              </Field>
              <div className="col-span-2 flex items-end sm:col-span-1">
                <PfButton
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    navigator.geolocation?.getCurrentPosition(
                      (p) => {
                        setLat(p.coords.latitude.toFixed(5));
                        setLon(p.coords.longitude.toFixed(5));
                      },
                      () => toast.error("Location permission denied — type the coordinates or pick an asset")
                    )
                  }
                >
                  <MapPin size={13} /> Use my location
                </PfButton>
              </div>
            </div>
            {DEVICE_TYPES[type].connectivity === "LoRaWAN" && (
              <Field label={<>DevEUI <span className="normal-case tracking-normal text-slate-500">(LoRaWAN, optional)</span></>} hint="16 hex characters printed on the device. When set, TTN uplinks from any other DevEUI are rejected." error={euiOk ? null : "DevEUI must be 16 hex characters"}>
                <input className={cn(inputCls, "telemetry uppercase")} value={devEui} onChange={(e) => setDevEui(e.target.value.trim())} placeholder="70B3D57ED0012345" maxLength={16} />
              </Field>
            )}
          </motion.div>
        ) : (
          <motion.div key="s2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div className="space-y-3">
                <KeyReveal deviceKey={created.key} />
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[12px] text-slate-300">
                  <div className="mb-1 font-medium text-white">Three ways in</div>
                  <ol className="list-decimal space-y-1 pl-4 text-slate-400">
                    <li>
                      <b className="text-slate-200">HTTPS</b> — POST JSON to <code className="text-sky-300">/api/v1/telemetry</code> with header <code className="text-sky-300">X-Device-Key</code>. Units are converted for you (cm → m, µS/cm → dS/m, volts → %).
                    </li>
                    <li>
                      <b className="text-slate-200">LoRaWAN</b> — add a webhook in The Things Stack pointing at <code className="text-sky-300">/api/v1/telemetry/lorawan</code>.
                    </li>
                    <li>
                      <b className="text-slate-200">MQTT</b> — topic <code className="text-sky-300">agrishield/{created.orgId}/{created.id}/up</code> (broker planned).
                    </li>
                  </ol>
                </div>
              </div>
              <QrProvision text={provisioningUri({ deviceId: created.id, orgId: created.orgId, type: created.type, origin, key: created.key })} caption="Scan with the installer app to flash the device's ID, endpoint and key." />
            </div>
            <SnippetTabs deviceId={created.id} orgId={created.orgId} type={created.type} deviceKey={created.key} intervalSec={created.intervalSec} />
            <div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] text-slate-300">
                  <b className="text-white">No hardware at hand?</b> Start a virtual device: your browser becomes the sensor and posts real readings through the same endpoint.
                </div>
                {v.running && v.deviceId === created.id ? null : (
                  <PfButton onClick={() => startVirtual(created)}>
                    <Play size={13} /> Start virtual device
                  </PfButton>
                )}
              </div>
              <div className="mt-2">
                <VirtualConsole deviceId={created.id} />
              </div>
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
              <ShieldAlert size={12} className="mt-0.5 shrink-0" /> Limits: 120 requests/min per device, batches up to 500 readings, timestamps within the last 7 days. Duplicate timestamps are ignored, so devices can safely re-send after an outage.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}
