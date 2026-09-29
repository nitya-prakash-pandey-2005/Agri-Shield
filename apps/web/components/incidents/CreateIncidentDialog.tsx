"use client";

/**
 * "Open incident" dialog. Sources: blank, alert-rule firing, official hazard alert, or a
 * Simulation Lab scenario (prefilled from /app/incidents?new=1&title=&source=&assetIds=&lat=&lon=).
 * Draw the affected area on the map → live preview of assets, exposure and a suggested severity.
 */
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BellRing, Circle, FileWarning, FlaskConical, Hexagon, ListChecks, PenLine, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Field, Modal, PfButton, Segmented, Toggle, inputCls } from "@/components/portfolio/ui";
import { fmtUsd, timeAgo } from "@/components/portfolio/format";
import { Explain } from "@/components/help/Explain";
import { HAZARDS, HAZARD_META, SEVERITIES, SEVERITY_META, type HazardType, type IncidentArea, type Severity } from "./meta";
import { HAZARD_ICON, SeverityBadge } from "./ui";

const IncidentMap = dynamic(() => import("./IncidentMap"), { ssr: false, loading: () => <div className="skeleton h-[260px] rounded-xl" /> });

export interface IncidentPrefill {
  title?: string;
  source?: "manual" | "rule_firing" | "official_alert" | "scenario";
  refId?: string | null;
  refLabel?: string | null;
  hazard?: HazardType;
  severity?: Severity;
  assetIds?: string[];
  lat?: number;
  lon?: number;
  radiusKm?: number;
  summary?: string;
}

type Src = "manual" | "rule_firing" | "official_alert" | "scenario";

export function CreateIncidentDialog({ open, onClose, prefill, center }: { open: boolean; onClose: () => void; prefill?: IncidentPrefill | null; center: [number, number] }) {
  const router = useRouter();
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const members = trpc.incidents.collab.members.useQuery(undefined, { enabled: open, staleTime: 300_000 });
  const cand = trpc.incidents.candidates.useQuery(undefined, { enabled: open });
  const settings = trpc.incidents.settings.useQuery(undefined, { enabled: open });
  const meta = trpc.incidents.meta.useQuery(undefined, { enabled: open, staleTime: Infinity });
  const create = trpc.incidents.create.useMutation();

  const [src, setSrc] = useState<Src>("manual");
  const [refId, setRefId] = useState<string | null>(null);
  const [refLabel, setRefLabel] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [hazard, setHazard] = useState<HazardType>("flood");
  const [severity, setSeverity] = useState<Severity>("SEV2");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [area, setArea] = useState<IncidentArea | null>(null);
  const [drawMode, setDrawMode] = useState<"circle" | "polygon">("circle");
  const [radius, setRadius] = useState(25);
  const [roles, setRoles] = useState<{ commander: string | null; fieldLead: string | null; comms: string | null }>({ commander: null, fieldLead: null, comms: null });
  const [template, setTemplate] = useState(true);
  const [alertId, setAlertId] = useState<string | null>(null);

  // Reset / prefill whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    const p = prefill ?? {};
    setSrc(p.source ?? "manual");
    setRefId(p.refId ?? null);
    setRefLabel(p.refLabel ?? null);
    setTitle(p.title ?? "");
    setSummary(p.summary ?? "");
    setHazard(p.hazard ?? "flood");
    setSeverity(p.severity ?? "SEV2");
    setAssetIds(p.assetIds ?? []);
    setArea(p.lat != null && p.lon != null ? { type: "circle", lat: p.lat, lon: p.lon, radiusKm: p.radiusKm ?? 25 } : null);
    setRadius(p.radiusKm ?? 25);
    setRoles({ commander: session?.user?.id ?? null, fieldLead: null, comms: null });
    setAlertId(p.source === "official_alert" ? p.refId ?? null : null);
  }, [open, prefill, session?.user?.id]);

  useEffect(() => {
    if (settings.data) setTemplate(settings.data.autoTemplate);
  }, [settings.data]);

  const alertDraft = trpc.incidents.draftFromAlert.useQuery({ alertId: alertId ?? "" }, { enabled: open && !!alertId });
  useEffect(() => {
    const d = alertDraft.data;
    if (!d) return;
    setTitle(d.title);
    setSummary(d.summary);
    setHazard(d.hazard);
    setSeverity(d.severity);
    setAssetIds(d.assetIds);
    if (d.area) {
      setArea(d.area);
      if (d.area.type === "circle") setRadius(d.area.radiusKm);
    }
    setRefId(d.link.id);
    setRefLabel(d.link.label);
  }, [alertDraft.data]);

  const preview = trpc.incidents.previewArea.useQuery({ area: area! }, { enabled: open && !!area && (area.type === "circle" || area.coords.length >= 3) });
  const assetOpts = trpc.incidents.assetOptions.useQuery(undefined, { enabled: open, staleTime: 60_000 });

  const selectedPoints = useMemo(() => {
    const ids = new Set([...assetIds, ...(preview.data?.assetIds ?? [])]);
    return (assetOpts.data ?? []).filter((a) => ids.has(a.id)).map((a) => ({ id: a.id, lat: a.lat, lon: a.lon, color: a.composite >= 80 ? "#a78bfa" : a.composite >= 60 ? "#f87171" : a.composite >= 35 ? "#fbbf24" : "#4ade80", label: `${a.name} · score ${a.composite}`, size: 5 }));
  }, [assetIds, preview.data, assetOpts.data]);

  const tmpl = meta.data?.hazards.find((h) => h.id === hazard);
  const totalAssets = new Set([...assetIds, ...(preview.data?.assetIds ?? [])]).size;

  const submit = async () => {
    try {
      const r = await create.mutateAsync({
        title,
        summary,
        hazard,
        severity,
        assetIds,
        area: area && (area.type === "circle" || area.coords.length >= 3) ? area : null,
        includeAreaAssets: true,
        roles,
        applyTemplate: template,
        source: src === "manual" ? undefined : { kind: src, refId, label: refLabel },
      });
      toast.success(r.created ? `INC-${r.number} opened` : `Added to existing INC-${r.number} (same rule fired within 48 h)`);
      void utils.incidents.list.invalidate();
      onClose();
      router.push(`/app/incidents/${r.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const srcOptions = [
    { value: "manual" as const, label: <span className="inline-flex items-center gap-1"><PenLine size={12} />Blank</span> },
    { value: "rule_firing" as const, label: <span className="inline-flex items-center gap-1"><BellRing size={12} />Rule firing</span>, count: cand.data?.firings.length },
    { value: "official_alert" as const, label: <span className="inline-flex items-center gap-1"><FileWarning size={12} />Official alert</span>, count: cand.data?.alerts.length },
    ...(src === "scenario" ? [{ value: "scenario" as const, label: <span className="inline-flex items-center gap-1"><FlaskConical size={12} />Scenario</span> }] : []),
  ];

  const mapCenter: [number, number] = area ? (area.type === "circle" ? [area.lat, area.lon] : area.coords[0] ?? center) : center;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Open an incident"
      subtitle="An incident is a shared war-room for one climate event: who is in charge, what is affected, what we are doing, and what we have told people."
      footer={
        <>
          <span className="mr-auto text-[11px] text-slate-500">
            {totalAssets} asset{totalAssets === 1 ? "" : "s"} · {template ? `${tmpl?.template ?? "hazard"} checklist` : "no checklist"}
          </span>
          <PfButton variant="ghost" onClick={onClose}>
            Cancel
          </PfButton>
          <PfButton onClick={() => void submit()} loading={create.isPending} disabled={title.trim().length < 3}>
            Open incident
          </PfButton>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented value={src} onChange={(v) => { setSrc(v); if (v !== "official_alert") setAlertId(null); }} options={srcOptions} />

        {src === "rule_firing" && (
          <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-white/5 bg-slate-950/40 p-2">
            {!cand.data?.firings.length && <p className="p-2 text-xs text-slate-500">No rule has fired in this workspace since the server started. Rules fire from Alerts &amp; Rules (Run now) or the 6-hourly monitor.</p>}
            {cand.data?.firings.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setRefId(f.id);
                  setRefLabel(f.ruleName);
                  setTitle(f.draft.title);
                  setSummary(f.draft.summary);
                  setHazard(f.draft.hazard);
                  setSeverity(f.draft.severity);
                  setAssetIds(f.draft.assetIds);
                }}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition", refId === f.id ? "bg-sky-400/15 ring-1 ring-sky-400/40" : "hover:bg-white/5")}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: f.severity === "critical" ? "#f87171" : f.severity === "warning" ? "#fbbf24" : "#38bdf8" }} />
                <span className="min-w-0 flex-1 truncate text-slate-200">{f.ruleName}</span>
                <span className="text-slate-500">{f.matchCount} assets · {timeAgo(f.at)}</span>
                {f.linked && <span className="rounded bg-slate-800 px-1 text-[9px] text-slate-400">linked</span>}
              </button>
            ))}
          </div>
        )}

        {src === "official_alert" && (
          <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-white/5 bg-slate-950/40 p-2">
            {!cand.data?.alerts.length && <p className="p-2 text-xs text-slate-500">No active official alerts cover districts where you have assets.</p>}
            {cand.data?.alerts.map((a) => (
              <button key={a.id} type="button" onClick={() => setAlertId(a.id)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition", alertId === a.id ? "bg-sky-400/15 ring-1 ring-sky-400/40" : "hover:bg-white/5")}>
                <span className="h-2 w-2 rounded-full" style={{ background: a.severity === "emergency" ? "#f87171" : a.severity === "warning" ? "#fb923c" : "#facc15" }} />
                <span className="min-w-0 flex-1 truncate text-slate-200">{a.title}</span>
                <span className="text-slate-500">
                  {a.district} · {a.assets} assets · {a.source.toUpperCase()}
                </span>
              </button>
            ))}
          </div>
        )}

        {src === "scenario" && refLabel && (
          <div className="flex items-center gap-2 rounded-lg border border-violet-400/30 bg-violet-400/5 px-3 py-2 text-xs text-violet-200">
            <FlaskConical size={14} /> From Simulation Lab: <b>{refLabel}</b>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <Field label="Title" hint="Plain words: what, where, who is affected.">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Satkhira embankment breach — Aman insured units" autoFocus />
          </Field>
          <Field label="Hazard">
            <select value={hazard} onChange={(e) => setHazard(e.target.value as HazardType)} className={inputCls}>
              {HAZARDS.map((h) => (
                <option key={h} value={h}>
                  {HAZARD_META[h].label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Severity <Explain text="Severity sets how fast the team must respond (SLA timers) and how often stakeholders get updates. You can change it any time." />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {SEVERITIES.map((s) => (
              <button key={s} type="button" onClick={() => setSeverity(s)} className={cn("rounded-lg border p-2 text-left transition", severity === s ? "border-transparent" : "border-white/5 hover:border-white/20")} style={severity === s ? { background: `${SEVERITY_META[s].color}18`, boxShadow: `inset 0 0 0 1px ${SEVERITY_META[s].color}` } : undefined}>
                <SeverityBadge severity={s} />
                <p className="mt-1 line-clamp-3 text-[10.5px] leading-snug text-slate-400">{SEVERITY_META[s].meaning}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Affected area</span>
            <Segmented value={drawMode} onChange={(v) => { setDrawMode(v); setArea(null); }} options={[{ value: "circle", label: <span className="inline-flex items-center gap-1"><Circle size={11} />Circle</span> }, { value: "polygon", label: <span className="inline-flex items-center gap-1"><Hexagon size={11} />Polygon</span> }]} />
            {drawMode === "circle" && (
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                Radius
                <input type="range" min={2} max={150} value={radius} onChange={(e) => { const r = +e.target.value; setRadius(r); if (area?.type === "circle") setArea({ ...area, radiusKm: r }); }} className="accent-pink-400" />
                <span className="telemetry w-12 text-slate-200">{radius} km</span>
              </label>
            )}
            {area && (
              <button type="button" onClick={() => setArea(null)} className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-300">
                <Trash2 size={11} /> Clear
              </button>
            )}
            <span className="ml-auto text-[10.5px] text-slate-500">{drawMode === "circle" ? "Click the map to place the centre." : "Click to add corners (3+)."}</span>
          </div>
          <IncidentMap center={mapCenter} zoom={area ? 8 : 6} height={260} points={selectedPoints} edit={{ mode: drawMode, area, radiusKm: radius, onChange: setArea }} fitKey={`${prefill?.lat ?? ""}${alertId ?? ""}${refId ?? ""}`} />
          {preview.data && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-pink-400/20 bg-pink-400/5 px-3 py-2 text-xs text-slate-300">
              <span>
                <b className="telemetry text-white">{preview.data.count}</b> assets inside
              </span>
              <span>
                <b className="telemetry text-white">{fmtUsd(preview.data.valueUsd)}</b> exposure ({(preview.data.shareOfBook * 100).toFixed(1)}% of book)
              </span>
              <span>
                worst score <b className="telemetry text-white">{preview.data.worstScore}</b>
              </span>
              <span className="inline-flex items-center gap-1">
                <Sparkles size={12} className="text-pink-300" /> Suggested <SeverityBadge severity={preview.data.suggested} />
                {preview.data.suggested !== severity && (
                  <button type="button" onClick={() => setSeverity(preview.data!.suggested)} className="underline underline-offset-2 hover:text-white">
                    use
                  </button>
                )}
              </span>
            </div>
          )}
          {assetIds.length > 0 && <p className="mt-1 text-[11px] text-slate-500">{assetIds.length} asset(s) pre-selected from the source{area ? "; assets inside the area are added too" : ""}.</p>}
        </div>

        <Field label="What we know so far" hint="Optional. You can keep adding notes on the timeline.">
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className={inputCls} placeholder="What happened, since when, what the forecast says…" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          {(["commander", "fieldLead", "comms"] as const).map((r) => (
            <Field key={r} label={r === "commander" ? "Incident commander" : r === "fieldLead" ? "Field lead" : "Comms"}>
              <select value={roles[r] ?? ""} onChange={(e) => setRoles({ ...roles, [r]: e.target.value || null })} className={inputCls}>
                <option value="">Unassigned</option>
                {members.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.id === session?.user?.id ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-slate-950/40 px-3 py-2.5">
          <ListChecks size={16} className="text-sky-300" />
          <div className="min-w-0 flex-1 text-xs">
            <div className="text-slate-200">Add the “{tmpl?.template ?? "response"}” checklist</div>
            <div className="text-slate-500">
              {tmpl?.tasks ?? "—"} proven steps for {HAZARD_META[hazard].label.toLowerCase()} events, tailored to your industry, assigned to the roles above with due times.
            </div>
          </div>
          <Toggle checked={template} onChange={setTemplate} label="Add checklist" />
        </div>
        {(() => {
          const Icon = HAZARD_ICON[hazard];
          return (
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Icon size={12} /> Everyone in the workspace is notified; SEV1 also e-mails members.
            </p>
          );
        })()}
      </div>
    </Modal>
  );
}
