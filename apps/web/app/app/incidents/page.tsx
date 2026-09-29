"use client";

/**
 * Incidents — command board for climate events.
 * Board (Kanban by status, drag to move) · Table · Map of active incidents, with SLA timers,
 * filters and realtime updates. Deep link to open the dialog prefilled:
 *   /app/incidents?new=1&title=&source=scenario|alert|firing&scenarioId=&alertId=&firingId=&assetIds=a,b&lat=&lon=&radiusKm=&hazard=&severity=
 */
import dynamic from "next/dynamic";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AlertOctagon, Columns3, Gauge, Map as MapIcon, Plus, Search, Settings2, Siren, Table2, Timer, Wallet, Zap } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Panel, Skeleton, SourceTag, StatTile } from "@/components/hud";
import { trpc } from "@/lib/trpc";
import { Chip, PageTitle, PfButton, QueryError, Segmented, Toggle } from "@/components/portfolio/ui";
import { fmtUsd } from "@/components/portfolio/format";
import { Explain } from "@/components/help/Explain";
import { useRoomEvents } from "@/components/collab/useRoomEvents";
import { CreateIncidentDialog, type IncidentPrefill } from "@/components/incidents/CreateIncidentDialog";
import { IncidentBoard, IncidentTable } from "@/components/incidents/IncidentBoard";
import { HAZARDS, HAZARD_META, SEVERITIES, SEVERITY_META, fmtMinutes, type HazardType, type Severity } from "@/components/incidents/meta";
import { HAZARD_ICON } from "@/components/incidents/ui";

const IncidentMap = dynamic(() => import("@/components/incidents/IncidentMap"), { ssr: false, loading: () => <Skeleton className="h-[480px]" /> });

type View = "board" | "table" | "map";

export default function IncidentsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[520px]" />}>
      <IncidentsInner />
    </Suspense>
  );
}

function prefillFrom(p: URLSearchParams): IncidentPrefill | null {
  if (p.get("new") !== "1") return null;
  const num = (k: string) => {
    const v = p.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : undefined;
  };
  const src = p.get("source") ?? "";
  const source = src === "scenario" || src === "simulate" || src === "simulation" ? "scenario" : src === "alert" || src === "official_alert" ? "official_alert" : src === "firing" || src === "rule" || src === "rule_firing" ? "rule_firing" : "manual";
  const hz = p.get("hazard") as HazardType | null;
  const sev = p.get("severity") as Severity | null;
  return {
    title: p.get("title") ?? undefined,
    source,
    refId: p.get("scenarioId") ?? p.get("simId") ?? p.get("alertId") ?? p.get("firingId") ?? (source === "scenario" ? `scn-${Date.now().toString(36)}` : null),
    refLabel: p.get("scenarioName") ?? p.get("title") ?? null,
    hazard: hz && (HAZARDS as readonly string[]).includes(hz) ? hz : undefined,
    severity: sev && (SEVERITIES as readonly string[]).includes(sev) ? sev : undefined,
    assetIds: (p.get("assetIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    lat: num("lat"),
    lon: num("lon"),
    radiusKm: num("radiusKm"),
    summary: p.get("summary") ?? undefined,
  };
}

function IncidentsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const orgId = session?.user?.orgId;
  const utils = trpc.useUtils();

  const [view, setView] = useState<View>((params.get("view") as View) || "board");
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<Severity[]>([]);
  const [hz, setHz] = useState<HazardType[]>([]);
  const [mine, setMine] = useState(false);
  const [showResolved, setShowResolved] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const prefill = useMemo(() => prefillFrom(new URLSearchParams(params.toString())), [params]);

  useEffect(() => {
    if (prefill) setDialog(true);
  }, [prefill]);

  const list = trpc.incidents.list.useQuery({ q: q || undefined, severity: sev.length ? sev : undefined, hazard: hz.length ? hz : undefined, mine: mine || undefined, includeResolved: showResolved }, { placeholderData: (prev) => prev });
  const me = trpc.workspace.me.useQuery(undefined, { staleTime: 60_000 });
  const settings = trpc.incidents.settings.useQuery();
  const saveSettings = trpc.incidents.updateSettings.useMutation({ onSuccess: () => settings.refetch() });

  useRoomEvents([orgId ? `ws:${orgId}` : "none"], (env) => {
    const ev = env.event as { type: string; title?: string; number?: number; auto?: boolean; by?: string; incidentId?: string };
    if (ev.type === "incident.created") {
      void utils.incidents.list.invalidate();
      if (ev.by !== session?.user?.name) toast(`${ev.auto ? "Auto-opened" : "New"} incident INC-${ev.number}`, { description: ev.title, action: { label: "Open", onClick: () => router.push(`/app/incidents/${ev.incidentId}`) } });
    }
    if (ev.type === "incident.updated") void utils.incidents.list.invalidate();
  });

  const closeDialog = () => {
    setDialog(false);
    if (params.get("new")) router.replace("/app/incidents");
  };

  const rows = list.data?.rows ?? [];
  const s = list.data?.summary;
  const center = (me.data?.org?.settings?.defaultCenter as [number, number] | undefined) ?? [22.5, 89.5];
  const active = rows.filter((r) => r.status !== "resolved");

  const mapAreas = useMemo(() => active.filter((r) => r.area).map((r) => ({ id: r.id, area: r.area!, color: SEVERITY_META[r.severity].color, label: `INC-${r.number} ${r.title}` })), [active]);
  const mapPoints = useMemo(() => active.filter((r) => r.centroid).map((r) => ({ id: r.id, lat: r.centroid![0], lon: r.centroid![1], color: SEVERITY_META[r.severity].color, label: `INC-${r.number} · ${r.severity} · ${r.title}`, size: r.severity === "SEV1" ? 8 : 6, beacon: true })), [active]);

  return (
    <div className="space-y-5">
      <PageTitle
        eyebrow="Respond · Incident command"
        title="Incidents"
        description="One shared war-room per climate event — who is in charge, which assets are hit, what the team is doing, and what stakeholders have been told. Timers show whether you are responding within your service levels."
        actions={
          <>
            <PfButton variant="outline" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
              <Settings2 size={14} /> Automation
            </PfButton>
            <PfButton onClick={() => setDialog(true)}>
              <Plus size={14} /> Open incident
            </PfButton>
          </>
        }
      />

      {showSettings && settings.data && (
        <Panel title="Automation" icon={Zap} accent="violet" subtitle="How incidents open without anyone clicking">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-start gap-3 rounded-lg border border-white/5 bg-slate-950/40 p-3">
              <Toggle checked={settings.data.autoOpenCritical} disabled={!settings.data.canEdit} onChange={(v) => saveSettings.mutate({ autoOpenCritical: v })} label="Auto-open on critical rule" />
              <span className="text-xs">
                <span className="block text-slate-100">Auto-open an incident when a critical alert rule fires</span>
                <span className="text-slate-500">Opens as SEV2 with the matching assets and the hazard checklist. Repeat firings of the same rule within 48 h are added to the open incident instead of creating duplicates.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-white/5 bg-slate-950/40 p-3">
              <Toggle checked={settings.data.autoTemplate} disabled={!settings.data.canEdit} onChange={(v) => saveSettings.mutate({ autoTemplate: v })} label="Add checklist automatically" />
              <span className="text-xs">
                <span className="block text-slate-100">Add the hazard checklist to new incidents</span>
                <span className="text-slate-500">Flood, cyclone, salinity, drought and heat playbooks, tailored to your industry.</span>
              </span>
            </label>
          </div>
          {!settings.data.canEdit && <p className="mt-2 text-[11px] text-slate-500">Only workspace admins can change automation.</p>}
        </Panel>
      )}

      <QueryError error={list.error} onRetry={() => list.refetch()} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Active incidents" value={s?.active ?? 0} icon={Siren} accent="red" hint="Not yet resolved" />
        <StatTile label="SEV1 / SEV2 active" value={s?.sev12 ?? 0} icon={AlertOctagon} accent="amber" hint="Critical or major" />
        <StatTile label="SLA breaches" value={s?.breached ?? 0} icon={Timer} accent={s?.breached ? "red" : "emerald"} hint="Active incidents with at least one missed or overdue clock" />
        <div className="hud-panel p-4" style={{ ["--hud-accent" as string]: "56 189 248" }}>
          <span className="hud-label">
            <Explain text="Median time from an incident opening until someone took ownership, over the last 90 days. Lower is better.">Median time to ack</Explain>
          </span>
          <div className="mt-2 telemetry text-2xl font-semibold text-white">{fmtMinutes(s?.medianTta ?? null)}</div>
          <div className="text-[11px] text-slate-500">MTTR {fmtMinutes(s?.medianTtr ?? null)} · {s?.resolved90 ?? 0} resolved (90 d)</div>
        </div>
        <div className="hud-panel col-span-2 p-4 lg:col-span-1" style={{ ["--hud-accent" as string]: "139 92 246" }}>
          <span className="hud-label flex items-center gap-1">
            <Wallet size={12} /> Exposure in active incidents
          </span>
          <div className="mt-2 telemetry text-2xl font-semibold text-white">{fmtUsd(s?.exposureUsd ?? 0)}</div>
          <SourceTag>portfolio values</SourceTag>
        </div>
      </div>

      {s && (
        <p className="rounded-lg border border-sky-400/15 bg-sky-400/5 px-3 py-2 text-xs text-slate-300">
          <Gauge size={12} className="mr-1 inline text-sky-300" />
          <b className="text-white">What this means:</b>{" "}
          {s.active === 0
            ? "No active incidents — your team is on standby. Incidents open from rule firings, official alerts or Simulation Lab scenarios."
            : `${s.active} event${s.active === 1 ? " is" : "s are"} being managed${s.sev12 ? `, ${s.sev12} of them critical or major` : ""}. ${s.breached ? `${s.breached} ${s.breached === 1 ? "has" : "have"} a missed or overdue response target — open ${s.breached === 1 ? "it" : "them"} first.` : "All response targets are on track."}`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "board", label: <span className="inline-flex items-center gap-1"><Columns3 size={12} />Board</span> },
            { value: "table", label: <span className="inline-flex items-center gap-1"><Table2 size={12} />Table</span> },
            { value: "map", label: <span className="inline-flex items-center gap-1"><MapIcon size={12} />Map</span> },
          ]}
        />
        <label className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search INC-104, Satkhira…" className="w-full rounded-lg border border-slate-700/80 bg-slate-950/60 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-400/70 focus:outline-none" aria-label="Search incidents" />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {SEVERITIES.map((x) => (
            <Chip key={x} active={sev.includes(x)} color={SEVERITY_META[x].color} onClick={() => setSev((c) => (c.includes(x) ? c.filter((y) => y !== x) : [...c, x]))} title={SEVERITY_META[x].meaning}>
              {x}
            </Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-white/10" />
          {HAZARDS.filter((h) => h !== "other").map((h) => {
            const Icon = HAZARD_ICON[h];
            return (
              <Chip key={h} active={hz.includes(h)} onClick={() => setHz((c) => (c.includes(h) ? c.filter((y) => y !== h) : [...c, h]))}>
                <Icon size={11} />
                {HAZARD_META[h].label.split(" ")[0]}
              </Chip>
            );
          })}
          <span className="mx-1 h-4 w-px bg-white/10" />
          <Chip active={mine} onClick={() => setMine((v) => !v)} title="Incidents where you hold a role or have open tasks">
            Mine
          </Chip>
          <Chip active={showResolved} onClick={() => setShowResolved((v) => !v)} title="Show incidents resolved in the last 14 days">
            Recently resolved
          </Chip>
        </div>
      </div>

      {list.isLoading ? (
        <Skeleton className="h-[420px]" />
      ) : !rows.length ? (
        <Panel>
          <EmptyState icon={Siren} title={q || sev.length || hz.length || mine ? "No incidents match these filters" : "No incidents yet"}>
            {q || sev.length || hz.length || mine ? "Clear a filter to see more." : "Open one from a rule firing, an official alert, a Simulation Lab scenario — or from scratch."}
          </EmptyState>
          <div className="flex justify-center pb-4">
            <PfButton onClick={() => setDialog(true)}>
              <Plus size={14} /> Open incident
            </PfButton>
          </div>
        </Panel>
      ) : view === "board" ? (
        <IncidentBoard rows={rows} />
      ) : view === "table" ? (
        <IncidentTable rows={rows} />
      ) : (
        <Panel title="Active incidents on the map" subtitle="Beacons = incident centre (colour = severity) · dashed shapes = affected areas" icon={MapIcon} accent="red" live>
          <IncidentMap center={center} zoom={6} height={500} areas={mapAreas} points={mapPoints} onPointClick={(id) => router.push(`/app/incidents/${id}`)} />
          <div className="mt-2 flex flex-wrap gap-3 text-[10.5px] text-slate-400">
            {SEVERITIES.map((x) => (
              <span key={x} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_META[x].color }} />
                {SEVERITY_META[x].label}
              </span>
            ))}
          </div>
        </Panel>
      )}

      <CreateIncidentDialog open={dialog} onClose={closeDialog} prefill={prefill} center={center} />
    </div>
  );
}
