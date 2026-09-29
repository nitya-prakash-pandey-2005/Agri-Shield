"use client";

/**
 * Alert creation wizard (spec §4.5 Early Warning Management):
 * type → geography (map select / list / drawn polygon) → severity → message
 * (template library) → channels → schedule → review & send, with a live
 * multi-channel preview beside it from the message step onwards.
 */
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertOctagon,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Layers,
  ListChecks,
  MapPinned,
  Megaphone,
  PenTool,
  Plus,
  Radio,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { AlertChannel, AlertSeverity, AlertType } from "@agri-shield/types";
import { trpc, type RouterInputs, type RouterOutputs } from "@/lib/trpc";
import { EmptyState, HudButton, Panel, RiskPill, Skeleton, SourceTag } from "@/components/hud";
import { cn } from "@/lib/utils";
import type { GovMapDistrict } from "@/components/maps/GovMap";
import { useGovInput } from "./scope";
import { AlertPreviewPanel, useAlertPreview } from "./alerts-preview";
import {
  ALERT_ICON,
  ALERT_LABEL,
  CHANNEL_ICON,
  CHANNEL_LABEL,
  ErrorNote,
  Field,
  fmtInt,
  fmtUsd,
  inputCls,
  KeyValue,
  Modal,
  ramp,
  SEVERITY_COLOR,
} from "./ui";

const GovMap = dynamic(() => import("@/components/maps/GovMap"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

const STEPS = [
  { label: "Type", icon: Layers },
  { label: "Geography", icon: MapPinned },
  { label: "Severity", icon: AlertOctagon },
  { label: "Message", icon: FileText },
  { label: "Channels", icon: Radio },
  { label: "Schedule", icon: CalendarClock },
  { label: "Review", icon: ListChecks },
] as const;

const TYPES: AlertType[] = ["flood", "salinity", "storm", "drought", "frost"];
const TYPE_HINT: Record<AlertType, string> = {
  flood: "Riverine / flash flooding, embankment breach",
  salinity: "Saltwater intrusion into rivers and soils",
  storm: "Cyclone landfall, storm surge, damaging wind",
  drought: "Dry spell, heat stress at flowering",
  frost: "Cold wave damaging seedbeds",
};
const SEVERITIES: { value: AlertSeverity; label: string; text: string; hours: number }[] = [
  { value: "watch", label: "Watch", text: "Conditions are developing. Farmers should monitor and prepare. Delivered to farmers with a low or medium alert threshold.", hours: 168 },
  { value: "warning", label: "Warning", text: "Hazard is expected within the validity window. Farmers should take protective action now. Delivered to all opted-in farmers.", hours: 72 },
  { value: "emergency", label: "Emergency", text: "Imminent or ongoing danger to life and crops. Overrides farmer preferences (life-safety SMS fallback) and notifies officers.", hours: 48 },
];
const CHANNELS: AlertChannel[] = ["app", "sms", "whatsapp", "email"];
const CHANNEL_HINT: Record<AlertChannel, string> = {
  app: "Push to the Agri-SHIELD farmer app",
  sms: "Feature phones + ministry SMS roster",
  whatsapp: "Rich card with quick-reply buttons",
  email: "HTML briefing to government officers",
};

type PreviewInput = RouterInputs["government"]["previewAlert"];

function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AlertWizard({ canCreate }: { canCreate: boolean }) {
  const scope = useGovInput();
  const utils = trpc.useUtils();
  const ctx = trpc.government.getContext.useQuery(scope);
  const map = trpc.government.getRegionMap.useQuery(scope);

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [alertType, setAlertType] = useState<AlertType>("flood");
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [districtIds, setDistrictIds] = useState<string[]>([]);
  const [drawMode, setDrawMode] = useState(false);
  const [severity, setSeverity] = useState<AlertSeverity>("warning");
  const [validHours, setValidHours] = useState(72);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [actions, setActions] = useState<string[]>([""]);
  const [channels, setChannels] = useState<AlertChannel[]>(["app", "sms", "whatsapp"]);
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [sendAt, setSendAt] = useState(() => localInput(new Date(Date.now() + 2 * 3_600_000)));
  const [confirm, setConfirm] = useState(false);

  const templates = trpc.government.getAlertTemplates.useQuery({ ...scope, districtId: districtIds[0] });

  const applyTemplate = (key: string) => {
    const t = templates.data?.find((x) => x.key === key);
    if (!t) return;
    setTemplateKey(key);
    setAlertType(t.alertType);
    setSeverity(t.defaultSeverity);
    setChannels(t.channels);
    setValidHours(t.validHours);
    const multi = districtIds.length > 1;
    setTitle(multi ? t.title.replace(` — ${t.districtName}`, "").replace(t.districtName, "").replace(/\s+—\s*$/, "").trim() : t.title);
    setDescription(multi ? t.description.replaceAll(t.districtName, "{district}") : t.description);
    setActions(t.recommendedActions.slice(0, 5));
  };

  const districts = map.data ?? [];
  const mapDistricts: GovMapDistrict[] = useMemo(
    () =>
      districts.map((d) => {
        const v = alertType === "salinity" ? d.salinityRisk : d.floodRisk;
        return {
          id: d.id,
          name: d.name,
          geometry: d.geometry,
          lat: d.lat,
          lon: d.lon,
          color: alertType === "salinity" ? ramp.salinity(v) : ramp.risk(v),
          fillOpacity: 0.32,
          label: d.name,
          tooltip: `<b>${d.name}</b><br/>${alertType === "salinity" ? `Salinity risk ${d.salinityRisk} · EC ${d.ecCurrent} dS/m` : `Flood risk ${d.floodRisk} · 72h ${Math.round(d.floodProb72h * 100)}%`}<br/>${d.activeAlerts} active alert(s)`,
        };
      }),
    [districts, alertType]
  );

  const toggle = (id: string) => setDistrictIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const onPolygon = async (ring: [number, number][]) => {
    try {
      const ids = await utils.government.districtsInPolygon.fetch({ ...scope, ring });
      setDistrictIds((s) => [...new Set([...s, ...ids])]);
      toast.success(ids.length ? `${ids.length} district(s) intersect the drawn area` : "No districts intersect the drawn area");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setDrawMode(false);
  };

  const cleanActions = actions.map((a) => a.trim()).filter(Boolean);
  const previewInput: PreviewInput | null =
    title.trim().length >= 3 && description.trim().length >= 3
      ? { ...scope, alertType, severity, title: title.trim(), description: description.trim(), recommendedActions: cleanActions, districtIds, validHours, translate: false }
      : null;
  const audience = useAlertPreview(step >= 4 ? previewInput : null);

  const sendAtDate = sendMode === "later" ? new Date(sendAt) : undefined;
  const sendAtValid = sendMode === "now" || (!!sendAtDate && !Number.isNaN(sendAtDate.getTime()) && sendAtDate.getTime() > Date.now() + 60_000);

  const valid = [
    true,
    districtIds.length > 0,
    validHours >= 1,
    title.trim().length >= 3 && description.trim().length >= 3,
    channels.length > 0,
    sendAtValid,
    true,
  ];
  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    setStep(n);
  };

  const create = trpc.government.createAlert.useMutation({
    onSuccess: (r) => {
      if (r.scheduled) toast.success("Alert scheduled", { description: `Sends ${new Date(r.scheduled.sendAt).toLocaleString("en-GB")} to ${r.scheduled.payload.districtIds.length} district(s)` });
      else {
        const sent = r.alerts.reduce((s, a) => s + a.deliveries.sent, 0);
        toast.success(`Alert broadcast to ${fmtInt(sent)} recipients`, { description: `${r.alerts.length} district alert(s) · ${channels.map((c) => CHANNEL_LABEL[c]).join(", ")}` });
      }
      void utils.government.getAlertHistory.invalidate();
      void utils.government.getOverview.invalidate();
      void utils.government.getContext.invalidate();
      void utils.government.getRegionMap.invalidate();
      void utils.government.getEscalationRules.invalidate();
      setConfirm(false);
      setStep(0);
      setTemplateKey(null);
      setDistrictIds([]);
      setTitle("");
      setDescription("");
      setActions([""]);
      setSendMode("now");
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () =>
    create.mutate({ ...scope, alertType, severity, districtIds, title: title.trim(), description: description.trim(), recommendedActions: cleanActions, channels, validHours, sendAt: sendAtDate });

  const selected = districts.filter((d) => districtIds.includes(d.id));
  const aud = audience.data?.audience ?? [];

  return (
    <div className={cn("grid gap-5", step >= 3 && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
      <Panel title="Alert creation wizard" subtitle={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]!.label}`} icon={Megaphone} accent="emerald">
        {!canCreate && <ErrorNote className="mb-3" error={{ message: "Your role cannot issue alerts — you can draft and preview, but sending requires create_alert." }} />}
        {/* Stepper */}
        <ol className="mb-5 flex gap-1 overflow-x-auto pb-1">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            const reachable = valid.slice(0, i).every(Boolean);
            return (
              <li key={s.label} className="flex-1 min-w-[76px]">
                <button
                  disabled={!reachable}
                  onClick={() => go(i)}
                  className={cn(
                    "relative flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10.5px] transition",
                    i === step ? "border-emerald-500/60 bg-emerald-500/10 text-white" : done ? "border-emerald-500/20 text-emerald-300" : "border-white/5 text-slate-500",
                    !reachable && "opacity-40"
                  )}
                >
                  <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full", i <= step ? "bg-emerald-500 text-slate-950" : "bg-slate-800")}>{done ? <Check size={9} /> : <Icon size={9} />}</span>
                  <span className="telemetry uppercase tracking-wider truncate">{s.label}</span>
                  {i === step && <motion.span layoutId="alert-step" className="absolute -bottom-1 left-2 right-2 h-0.5 rounded bg-emerald-400" />}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="min-h-[360px]">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div key={step} custom={dir} initial={{ opacity: 0, x: 24 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 * dir }} transition={{ duration: 0.22 }}>
              {step === 0 && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {TYPES.map((t) => {
                      const Icon = ALERT_ICON[t]!;
                      const sel = t === alertType;
                      return (
                        <motion.button
                          key={t}
                          whileHover={{ y: -2 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => setAlertType(t)}
                          className={cn("rounded-xl border p-3 text-left transition", sel ? "border-emerald-500/60 bg-emerald-500/10 shadow-[0_0_24px_-10px_rgba(16,185,129,0.9)]" : "border-white/5 hover:border-white/20")}
                        >
                          <Icon size={18} className={sel ? "text-emerald-300" : "text-slate-400"} />
                          <div className="mt-2 text-sm font-medium text-slate-100">{ALERT_LABEL[t]}</div>
                          <div className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{TYPE_HINT[t]}</div>
                        </motion.button>
                      );
                    })}
                  </div>
                  <TemplateLibrary templates={templates.data} loading={templates.isLoading} activeKey={templateKey} onPick={applyTemplate} filterType={alertType} />
                </div>
              )}

              {step === 1 && (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                  <div className="relative h-[380px] overflow-hidden rounded-xl border border-white/5">
                    {ctx.data && (
                      <GovMap
                        center={ctx.data.center}
                        zoom={7}
                        districts={mapDistricts}
                        selectedIds={districtIds}
                        onDistrictClick={toggle}
                        drawMode={drawMode}
                        onPolygonComplete={onPolygon}
                        fitKey={ctx.data.orgId}
                      />
                    )}
                    <div className="absolute left-14 top-2 z-[600] flex gap-1.5">
                      <button
                        onClick={() => setDrawMode((v) => !v)}
                        className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] backdrop-blur", drawMode ? "border-emerald-400 bg-emerald-500 text-slate-950" : "border-white/10 bg-[#060a16]/85 text-slate-200 hover:border-emerald-500/50")}
                      >
                        {drawMode ? <X size={12} /> : <PenTool size={12} />} {drawMode ? "Cancel drawing" : "Draw polygon"}
                      </button>
                    </div>
                    <div className="absolute bottom-6 left-2 z-[500] rounded-lg border border-white/10 bg-[#060a16]/85 px-2 py-1 text-[10px] text-slate-400 backdrop-blur">
                      Click districts to toggle · colour = {alertType === "salinity" ? "salinity" : "flood"} risk
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="hud-label">{districtIds.length} selected</span>
                      <div className="flex gap-1">
                        <button onClick={() => setDistrictIds(districts.filter((d) => d.riskLevel === "high" || d.riskLevel === "critical").map((d) => d.id))} className="rounded px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/10">
                          High/critical
                        </button>
                        <button onClick={() => setDistrictIds(districts.map((d) => d.id))} className="rounded px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/5">
                          All
                        </button>
                        <button onClick={() => setDistrictIds([])} className="rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-white/5">
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
                      {map.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}
                      {districts.map((d) => {
                        const on = districtIds.includes(d.id);
                        return (
                          <label key={d.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition", on ? "border-emerald-500/50 bg-emerald-500/10" : "border-white/5 hover:border-white/15")}>
                            <input type="checkbox" checked={on} onChange={() => toggle(d.id)} className="accent-emerald-500" />
                            <span className="flex-1 text-slate-100">{d.name}</span>
                            <RiskPill level={d.riskLevel} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {SEVERITIES.map((s) => {
                      const sel = s.value === severity;
                      const c = SEVERITY_COLOR[s.value]!;
                      return (
                        <motion.button
                          key={s.value}
                          whileHover={{ y: -2 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => {
                            setSeverity(s.value);
                            if (!templateKey) setValidHours(s.hours);
                          }}
                          className="rounded-xl border p-4 text-left transition"
                          style={{ borderColor: sel ? `${c}aa` : "rgba(255,255,255,0.06)", background: sel ? `${c}14` : undefined, boxShadow: sel ? `0 0 28px -12px ${c}` : undefined }}
                        >
                          <RiskPill level={s.value} />
                          <div className="mt-2 text-sm font-semibold text-white">{s.label}</div>
                          <p className="mt-1 text-[11px] leading-snug text-slate-400">{s.text}</p>
                        </motion.button>
                      );
                    })}
                  </div>
                  <Field label={`Validity window — ${validHours} h`} hint={`Expires ${new Date(Date.now() + validHours * 3_600_000).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} (from send time)`}>
                    <input type="range" min={6} max={336} step={6} value={validHours} onChange={(e) => setValidHours(Number(e.target.value))} className="w-full accent-emerald-500" />
                  </Field>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <TemplateLibrary compact templates={templates.data} loading={templates.isLoading} activeKey={templateKey} onPick={applyTemplate} filterType={alertType} />
                  <Field label="Title" hint={`${title.length}/140`}>
                    <input value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Flood warning — Barisal" className={inputCls} />
                  </Field>
                  <Field label="Description" hint={`${description.length}/1200 · use {district} to insert each district's name`}>
                    <textarea value={description} maxLength={1200} rows={4} onChange={(e) => setDescription(e.target.value)} className={cn(inputCls, "resize-y")} placeholder="What is happening, where, and how likely." />
                  </Field>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="hud-label">Recommended actions ({actions.length}/5)</span>
                      <button disabled={actions.length >= 5} onClick={() => setActions((a) => [...a, ""])} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30">
                        <Plus size={12} /> Add
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      <AnimatePresence initial={false}>
                        {actions.map((a, i) => (
                          <motion.div key={i} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2">
                            <span className="telemetry w-5 text-right text-[11px] text-emerald-400">{i + 1}.</span>
                            <input value={a} maxLength={200} onChange={(e) => setActions((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} className={inputCls} placeholder="Short imperative action" />
                            <button onClick={() => setActions((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : [""]))} className="rounded p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300" aria-label="Remove action">
                              <Trash2 size={13} />
                            </button>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CHANNELS.map((c) => {
                      const Icon = CHANNEL_ICON[c]!;
                      const on = channels.includes(c);
                      return (
                        <button
                          key={c}
                          onClick={() => setChannels((s) => (on ? s.filter((x) => x !== c) : [...s, c]))}
                          className={cn("flex items-center gap-3 rounded-xl border p-3 text-left transition", on ? "border-emerald-500/60 bg-emerald-500/10" : "border-white/5 hover:border-white/20")}
                        >
                          <span className={cn("grid h-9 w-9 place-items-center rounded-lg", on ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-400")}>
                            <Icon size={16} />
                          </span>
                          <span className="flex-1">
                            <span className="block text-sm font-medium text-slate-100">{CHANNEL_LABEL[c]}</span>
                            <span className="block text-[11px] text-slate-500">{CHANNEL_HINT[c]}</span>
                          </span>
                          <span className={cn("grid h-5 w-5 place-items-center rounded border", on ? "border-emerald-400 bg-emerald-500 text-slate-950" : "border-slate-600")}>{on && <Check size={12} />}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Users size={13} className="text-emerald-400" />
                      <span className="hud-label">Audience estimate</span>
                      <span className="ml-auto">
                        <SourceTag>Agri-SHIELD registry</SourceTag>
                      </span>
                    </div>
                    {audience.isLoading && !aud.length ? (
                      <Skeleton className="h-16" />
                    ) : aud.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-slate-500">
                              <th className="py-1 font-normal">District</th>
                              <th className="py-1 text-right font-normal">Registered farmers</th>
                              <th className="py-1 text-right font-normal">SMS roster</th>
                              <th className="py-1 text-right font-normal">Farms at risk</th>
                            </tr>
                          </thead>
                          <tbody className="telemetry">
                            {aud.map((a) => (
                              <tr key={a.districtId} className="border-t border-white/5">
                                <td className="py-1.5 font-sans text-slate-200">{a.name}</td>
                                <td className="py-1.5 text-right text-slate-100">{fmtInt(a.registeredFarmers)}</td>
                                <td className={cn("py-1.5 text-right", channels.includes("sms") ? "text-slate-100" : "text-slate-600 line-through")}>{fmtInt(a.roster)}</td>
                                <td className="py-1.5 text-right text-amber-300">{fmtInt(a.farmsAtRisk)}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-white/10 text-emerald-300">
                              <td className="py-1.5 font-sans">Total</td>
                              <td className="py-1.5 text-right">{fmtInt(aud.reduce((s, a) => s + a.registeredFarmers, 0))}</td>
                              <td className="py-1.5 text-right">{channels.includes("sms") ? fmtInt(aud.reduce((s, a) => s + a.roster, 0)) : "—"}</td>
                              <td className="py-1.5 text-right">{fmtInt(aud.reduce((s, a) => s + a.farmsAtRisk, 0))}</td>
                            </tr>
                          </tbody>
                        </table>
                        <p className="mt-2 text-[10.5px] text-slate-500">Registered farmers are filtered by their own alert-type, threshold and channel preferences at send time. Email goes to ministry officers.</p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Complete the message to estimate the audience.</p>
                    )}
                  </div>
                </div>
              )}

              {step === 5 && (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        { v: "now", label: "Send now", text: "Broadcast immediately on confirmation.", icon: Send },
                        { v: "later", label: "Schedule for later", text: "Queue the broadcast for a set time (e.g. before a forecast peak).", icon: Clock },
                      ] as const
                    ).map((o) => {
                      const Icon = o.icon;
                      const sel = sendMode === o.v;
                      return (
                        <button key={o.v} onClick={() => setSendMode(o.v)} className={cn("flex items-start gap-3 rounded-xl border p-4 text-left transition", sel ? "border-emerald-500/60 bg-emerald-500/10" : "border-white/5 hover:border-white/20")}>
                          <Icon size={18} className={sel ? "text-emerald-300" : "text-slate-500"} />
                          <span>
                            <span className="block text-sm font-medium text-white">{o.label}</span>
                            <span className="block text-[11px] text-slate-400">{o.text}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {sendMode === "later" && (
                    <Field label="Send at (local time)" hint={sendAtValid ? `In ${Math.round(((sendAtDate?.getTime() ?? 0) - Date.now()) / 60_000)} minutes` : "Pick a time at least 1 minute in the future"}>
                      <input type="datetime-local" value={sendAt} min={localInput(new Date())} onChange={(e) => setSendAt(e.target.value)} className={cn(inputCls, "[color-scheme:dark]")} />
                    </Field>
                  )}
                </div>
              )}

              {step === 6 && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <KeyValue k="Type" v={ALERT_LABEL[alertType]} />
                      <KeyValue k="Severity" v={<RiskPill level={severity} />} />
                      <KeyValue k="Validity" v={`${validHours} h`} />
                      <KeyValue k="Channels" v={channels.map((c) => CHANNEL_LABEL[c]).join(" · ")} />
                      <KeyValue k="Send" v={sendMode === "now" ? "Immediately" : sendAtDate?.toLocaleString("en-GB")} />
                    </div>
                    <div className="space-y-2">
                      <KeyValue k="Districts" v={selected.map((d) => d.name).join(", ")} />
                      <KeyValue k="Farms at risk" v={fmtInt(selected.reduce((s, d) => s + d.farmsAtRisk, 0))} />
                      <KeyValue k="Expected loss if no action" v={fmtUsd(selected.reduce((s, d) => s + d.expectedLossUsd, 0))} />
                      <KeyValue k="Recipients (est.)" v={aud.length ? fmtInt(aud.reduce((s, a) => s + a.registeredFarmers + (channels.includes("sms") ? a.roster : 0), 0)) : "—"} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                    <div className="text-sm font-semibold text-white">{title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">{description}</p>
                    {cleanActions.length > 0 && (
                      <ol className="mt-2 space-y-0.5 text-xs text-slate-200">
                        {cleanActions.map((a, i) => (
                          <li key={i}>
                            <span className="telemetry text-emerald-400">{i + 1}.</span> {a}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                  <HudButton className="w-full py-3" disabled={!canCreate || create.isPending || !valid.every(Boolean)} onClick={() => setConfirm(true)}>
                    <Send size={15} /> {sendMode === "now" ? "Review & send broadcast" : "Review & schedule"}
                  </HudButton>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4">
          <HudButton variant="ghost" disabled={step === 0} onClick={() => go(step - 1)}>
            <ChevronLeft size={14} /> Back
          </HudButton>
          <span className="text-[11px] text-slate-500">{!valid[step] && (step === 1 ? "Select at least one district" : step === 3 ? "Title and description are required" : step === 4 ? "Pick at least one channel" : step === 5 ? "Choose a valid send time" : "")}</span>
          {step < STEPS.length - 1 && (
            <HudButton disabled={!valid[step]} onClick={() => go(step + 1)}>
              Next <ChevronRight size={14} />
            </HudButton>
          )}
        </div>
      </Panel>

      {step >= 3 && (
        <div className="xl:sticky xl:top-20 self-start">
          <AlertPreviewPanel input={previewInput} />
        </div>
      )}

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={sendMode === "now" ? "Confirm broadcast" : "Confirm schedule"}
        subtitle="This notifies real recipients through the configured providers (Twilio / Resend) or the outbox when keys are absent."
        width="max-w-md"
        footer={
          <>
            <HudButton variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </HudButton>
            <HudButton variant={severity === "emergency" ? "danger" : "primary"} onClick={submit} disabled={create.isPending}>
              <Send size={14} /> {create.isPending ? "Sending…" : sendMode === "now" ? "Send now" : "Schedule"}
            </HudButton>
          </>
        }
      >
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            <RiskPill level={severity} /> <span className="ml-1 font-semibold text-white">{title}</span>
          </p>
          <p>
            {selected.length} district(s): {selected.map((d) => d.name).join(", ")}
          </p>
          <p>Channels: {channels.map((c) => CHANNEL_LABEL[c]).join(", ")}</p>
          {sendMode === "later" && <p>Scheduled for {sendAtDate?.toLocaleString("en-GB")}</p>}
          <ErrorNote error={create.error} />
        </div>
      </Modal>
    </div>
  );
}

type Template = RouterOutputs["government"]["getAlertTemplates"][number];

function TemplateLibrary({
  templates,
  loading,
  activeKey,
  onPick,
  filterType,
  compact,
}: {
  templates: Template[] | undefined;
  loading: boolean;
  activeKey: string | null;
  onPick: (key: string) => void;
  filterType: AlertType;
  compact?: boolean;
}) {
  const sorted = [...(templates ?? [])].sort((a, b) => Number(b.alertType === filterType) - Number(a.alertType === filterType));
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <FileText size={12} className="text-emerald-400" />
        <span className="hud-label">Template library</span>
        {templates?.[0] && <span className="text-[10.5px] text-slate-500">filled with live values for {templates[0].districtName}</span>}
        <span className="ml-auto">
          <SourceTag>Open-Meteo · GloFAS</SourceTag>
        </span>
      </div>
      {loading ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : !sorted.length ? (
        <EmptyState icon={FileText} title="No templates available" />
      ) : (
        <div className={cn("grid gap-2", compact ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-2 lg:grid-cols-3")}>
          {sorted.map((t) => {
            const Icon = ALERT_ICON[t.alertType]!;
            const on = activeKey === t.key;
            return (
              <button
                key={t.key}
                onClick={() => onPick(t.key)}
                title={t.description}
                className={cn("rounded-lg border p-2.5 text-left transition", on ? "border-emerald-500/60 bg-emerald-500/10" : "border-white/5 hover:border-white/20", t.alertType !== filterType && !on && "opacity-60")}
              >
                <div className="flex items-center gap-1.5">
                  <Icon size={13} style={{ color: SEVERITY_COLOR[t.defaultSeverity] }} />
                  <span className={cn("font-medium text-slate-100", compact ? "text-[11px] leading-tight" : "text-xs")}>{t.name}</span>
                </div>
                {!compact && <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-slate-500">{t.description}</p>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
