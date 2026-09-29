"use client";

/**
 * Incident war-room: status stepper + SLA clocks, live presence, affected-area map with
 * live asset scores, timeline, task checklist, roles, stakeholder comms (public status
 * page), team discussion with @mentions, linked items and the post-incident review.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, BellRing, Check, Circle, ClipboardList, FileWarning, FlaskConical, Hexagon, Link2, ListTree, Map as MapIcon, Megaphone, MessagesSquare, Pencil, RefreshCw, ShieldCheck, Target, Users, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Panel, RiskPill, Skeleton, SourceTag } from "@/components/hud";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Modal, PfButton, QueryError, Segmented } from "@/components/portfolio/ui";
import { fmtUsd, timeAgo, TYPE_LABEL } from "@/components/portfolio/format";
import { Explain } from "@/components/help/Explain";
import { Comments } from "@/components/collab/Comments";
import { PresenceAvatars } from "@/components/collab/PresenceAvatars";
import { Avatar } from "@/components/collab/Avatar";
import { useRoomEvents } from "@/components/collab/useRoomEvents";
import { ROLES, ROLE_META, SEVERITIES, SEVERITY_META, STATUS_META, type IncidentArea, type IncidentStatus, type Severity } from "@/components/incidents/meta";
import { HazardChip, SeverityBadge, SlaPanel, StatusStepper } from "@/components/incidents/ui";
import { Timeline } from "@/components/incidents/Timeline";
import { TaskList } from "@/components/incidents/TaskList";
import { StakeholderComms } from "@/components/incidents/StakeholderComms";
import { ReviewPanel } from "@/components/incidents/ReviewPanel";

const IncidentMap = dynamic(() => import("@/components/incidents/IncidentMap"), { ssr: false, loading: () => <Skeleton className="h-[340px]" /> });

const LEVEL_COLOR: Record<string, string> = { low: "#4ade80", medium: "#fbbf24", high: "#f87171", critical: "#a78bfa" };
const LINK_ICON = { firing: BellRing, alert: FileWarning, scenario: FlaskConical, report: ClipboardList, asset: Target } as const;

export default function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const orgId = session?.user?.orgId;
  const utils = trpc.useUtils();
  const q = trpc.incidents.get.useQuery({ id }, { retry: 1 });
  const me = trpc.workspace.me.useQuery(undefined, { staleTime: 60_000 });
  const [tab, setTab] = useState<"room" | "review">(search.get("tab") === "review" ? "review" : "room");
  const [confirm, setConfirm] = useState<{ to: IncidentStatus; warnings: string[] } | null>(null);
  const [note, setNote] = useState("");
  const [editArea, setEditArea] = useState<{ mode: "circle" | "polygon"; area: IncidentArea | null; radius: number } | null>(null);
  const [editTitle, setEditTitle] = useState<string | null>(null);

  const setStatus = trpc.incidents.setStatus.useMutation();
  const setSeverity = trpc.incidents.setSeverity.useMutation();
  const ack = trpc.incidents.acknowledge.useMutation();
  const assign = trpc.incidents.assignRole.useMutation();
  const edit = trpc.incidents.edit.useMutation();
  const setArea = trpc.incidents.setArea.useMutation();
  const refresh = trpc.incidents.refreshScores.useMutation();
  const unlink = trpc.incidents.unlink.useMutation();

  const invalidate = () => utils.incidents.get.invalidate({ id });

  useRoomEvents([orgId ? `ws:${orgId}` : "none"], (env) => {
    const ev = env.event as { type: string; incidentId?: string; by?: string; text?: string; change?: string };
    if (ev.type === "incident.updated" && ev.incidentId === q.data?.id) {
      void invalidate();
      if (ev.by && ev.by !== me.data?.user?.name && ["status", "severity", "role", "update", "task"].includes(ev.change ?? "")) toast(`${ev.by}: ${ev.text}`, { duration: 3500 });
    }
    if (ev.type === "portfolio.rescored") void invalidate();
  });

  const inc = q.data;
  const points = useMemo(() => (inc?.assets ?? []).map((a) => ({ id: a.id, lat: a.lat, lon: a.lon, color: LEVEL_COLOR[a.level] ?? "#38bdf8", label: `${a.name} · score ${a.composite} (${a.level})`, size: 6 })), [inc?.assets]);
  const areas = useMemo(() => (inc?.area && !editArea ? [{ id: inc.id, area: inc.area, color: SEVERITY_META[inc.severity].color, label: "Affected area" }] : []), [inc?.area, inc?.id, inc?.severity, editArea]);

  if (q.isLoading) return <Skeleton className="h-[640px]" />;
  if (q.error || !inc)
    return (
      <Panel>
        <EmptyState icon={FileWarning} title="Incident not found">
          It may belong to another workspace or the link is wrong.
        </EmptyState>
        <div className="flex justify-center pb-4">
          <Link href="/app/incidents" className="text-sm text-sky-300 underline">
            Back to incidents
          </Link>
        </div>
      </Panel>
    );

  const tz = (me.data?.org?.settings?.timezone as string | undefined) ?? "UTC";
  const resolved = inc.status === "resolved";

  const move = async (to: IncidentStatus, force = false) => {
    const warnings = inc.warnings[to] ?? [];
    if (!force && (warnings.length || to === "resolved")) {
      setConfirm({ to, warnings });
      return;
    }
    try {
      await setStatus.mutateAsync({ id: inc.id, to, note: note || undefined });
      toast.success(`${STATUS_META[to].label}`, { description: STATUS_META[to].meaning });
      setConfirm(null);
      setNote("");
      void invalidate();
      if (to === "resolved") setTab("review");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const center: [number, number] = inc.area ? (inc.area.type === "circle" ? [inc.area.lat, inc.area.lon] : inc.area.coords[0]!) : inc.assets[0] ? [inc.assets[0].lat, inc.assets[0].lon] : [22.5, 89.5];
  const highRisk = inc.assets.filter((a) => a.level === "high" || a.level === "critical").length;

  return (
    <div className="space-y-4">
      <Link href="/app/incidents" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-sky-300">
        <ArrowLeft size={12} /> All incidents
      </Link>

      {/* ── Command header ── */}
      <section className="hud-panel relative overflow-hidden p-4" style={{ ["--hud-accent" as string]: "244 63 94" }}>
        <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: `radial-gradient(600px 160px at 0% 0%, ${SEVERITY_META[inc.severity].color}26, transparent)` }} />
        <div className="relative flex flex-col gap-3 md:flex-row md:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="telemetry text-xs text-slate-400">INC-{inc.number}</span>
              <SeverityBadge severity={inc.severity} size="md" explain />
              <HazardChip hazard={inc.hazard} />
              {inc.demo && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">Demo data</span>}
              <span className="text-[11px] text-slate-500">
                opened {timeAgo(inc.createdAt)} · {inc.source.kind === "auto" ? "auto-opened" : inc.source.kind.replace("_", " ")}
                {inc.source.label ? ` · ${inc.source.label}` : ""}
              </span>
            </div>
            {editTitle == null ? (
              <h1 className="mt-1.5 flex items-start gap-2 font-display text-xl font-semibold leading-tight text-white md:text-2xl">
                {inc.title}
                {!resolved && (
                  <button onClick={() => setEditTitle(inc.title)} className="mt-1 text-slate-500 hover:text-sky-300" aria-label="Edit title">
                    <Pencil size={14} />
                  </button>
                )}
              </h1>
            ) : (
              <form
                className="mt-1.5 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await edit.mutateAsync({ id: inc.id, title: editTitle }).catch((err) => toast.error(err.message));
                  setEditTitle(null);
                  void invalidate();
                }}
              >
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-lg text-white focus:outline-none" autoFocus aria-label="Title" />
                <PfButton size="sm" type="submit">
                  <Check size={12} />
                </PfButton>
                <PfButton size="sm" variant="ghost" onClick={() => setEditTitle(null)}>
                  <X size={12} />
                </PfButton>
              </form>
            )}
            {inc.summary && <p className="mt-1.5 line-clamp-4 max-w-4xl whitespace-pre-line text-sm text-slate-400 md:line-clamp-none">{inc.summary}</p>}
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <PresenceAvatars room={`incident:${inc.id}`} label="in the war-room" />
            <div className="flex flex-wrap gap-2 md:justify-end">
              {!inc.acknowledgedAt && (
                <PfButton
                  size="sm"
                  onClick={async () => {
                    await ack.mutateAsync({ id: inc.id }).catch((e) => toast.error(e.message));
                    toast.success("Acknowledged — the clock stops for time-to-acknowledge");
                    void invalidate();
                  }}
                >
                  <ShieldCheck size={12} /> Acknowledge
                </PfButton>
              )}
              <select
                value={inc.severity}
                disabled={resolved}
                onChange={async (e) => {
                  await setSeverity.mutateAsync({ id: inc.id, severity: e.target.value as Severity }).catch((err) => toast.error(err.message));
                  void invalidate();
                }}
                className="rounded-lg border border-slate-700/80 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200"
                aria-label="Severity"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_META[s].label}
                  </option>
                ))}
              </select>
              <PfButton size="sm" variant={tab === "review" ? "primary" : "outline"} onClick={() => setTab(tab === "review" ? "room" : "review")}>
                <ListTree size={12} /> {tab === "review" ? "War room" : "Review"}
              </PfButton>
            </div>
          </div>
        </div>
        <div className="relative mt-4">
          <StatusStepper status={inc.status} allowed={inc.allowed} onMove={(to) => void move(to)} busy={setStatus.isPending} />
          <p className="mt-1.5 text-[11.5px] text-slate-400">
            <b style={{ color: STATUS_META[inc.status].color }}>{STATUS_META[inc.status].label}:</b> {STATUS_META[inc.status].meaning} <span className="text-slate-600">Click a stage to move the incident.</span>
          </p>
        </div>
      </section>

      <QueryError error={q.error} />

      {tab === "review" ? (
        <ReviewPanel inc={inc} orgName={me.data?.org?.name ?? "Workspace"} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-12">
          {/* ── Left: situation ── */}
          <div className="space-y-4 xl:col-span-7">
            <Panel
              title="Situation map"
              subtitle={`${inc.assets.length} affected assets · ${highRisk} high/critical · colours = live composite risk`}
              icon={MapIcon}
              accent="red"
              live
              actions={
                editArea ? (
                  <>
                    <Segmented value={editArea.mode} onChange={(m) => setEditArea({ ...editArea, mode: m, area: null })} options={[{ value: "circle", label: <Circle size={11} /> }, { value: "polygon", label: <Hexagon size={11} /> }]} />
                    <PfButton
                      size="sm"
                      disabled={!editArea.area || (editArea.area.type === "polygon" && editArea.area.coords.length < 3)}
                      onClick={async () => {
                        const r = await setArea.mutateAsync({ id: inc.id, area: editArea.area, includeAssets: true }).catch((e) => (toast.error(e.message), null));
                        if (r) toast.success(`Area saved — ${r.count} assets now linked`);
                        setEditArea(null);
                        void invalidate();
                      }}
                    >
                      Save area
                    </PfButton>
                    <PfButton size="sm" variant="ghost" onClick={() => setEditArea(null)}>
                      Cancel
                    </PfButton>
                  </>
                ) : (
                  !resolved && (
                    <PfButton size="sm" variant="outline" onClick={() => setEditArea({ mode: inc.area?.type ?? "circle", area: inc.area, radius: inc.area?.type === "circle" ? inc.area.radiusKm : 25 })}>
                      <Pencil size={11} /> Edit area
                    </PfButton>
                  )
                )
              }
            >
              {editArea?.mode === "circle" && (
                <label className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
                  Click the map to set the centre · radius
                  <input type="range" min={2} max={150} value={editArea.radius} onChange={(e) => setEditArea({ ...editArea, radius: +e.target.value, area: editArea.area?.type === "circle" ? { ...editArea.area, radiusKm: +e.target.value } : editArea.area })} className="accent-pink-400" />
                  <span className="telemetry text-slate-200">{editArea.radius} km</span>
                </label>
              )}
              <IncidentMap center={center} zoom={8} height={340} areas={areas} points={points} fitKey={inc.id} edit={editArea ? { mode: editArea.mode, area: editArea.area, radiusKm: editArea.radius, onChange: (a) => setEditArea((cur) => (cur ? { ...cur, area: a } : cur)) } : undefined} />
              <div className="mt-2 flex flex-wrap gap-3 text-[10.5px] text-slate-400">
                {Object.entries(LEVEL_COLOR).map(([k, c]) => (
                  <span key={k} className="inline-flex items-center gap-1 capitalize">
                    <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                    {k}
                  </span>
                ))}
                <span className="ml-auto">
                  <SourceTag>Agri-SHIELD location engine</SourceTag>
                </span>
              </div>
            </Panel>

            <Panel
              title="Affected assets"
              subtitle={`Exposure ${fmtUsd(inc.exposureUsd)} · modelled value at risk ${fmtUsd(inc.varUsd)}`}
              icon={Target}
              accent="amber"
              actions={
                <PfButton
                  size="sm"
                  variant="outline"
                  loading={refresh.isPending}
                  onClick={async () => {
                    const r = await refresh.mutateAsync({ id: inc.id }).catch((e) => (toast.error(e.message), null));
                    if (r) toast[r.live ? "success" : "warning"](r.live ? `${r.live} assets re-scored on live forecasts` : "Live forecast feed unavailable — showing last known scores", { description: r.fallback ? `${r.fallback} kept their last score` : undefined });
                    void invalidate();
                  }}
                >
                  <RefreshCw size={11} /> Re-score
                </PfButton>
              }
            >
              <p className="mb-2 text-[11.5px] text-slate-400">
                <b className="text-slate-200">What this means:</b> {highRisk ? `${highRisk} of ${inc.assets.length} assets are at high or critical risk right now — prioritise them in field visits.` : "None of the affected assets is currently at high risk; keep monitoring."}{" "}
                <Explain term="value at risk" />
              </p>
              <div className="max-h-[300px] overflow-auto rounded-lg border border-white/5">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="sticky top-0 bg-[#081225] text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5">Asset</th>
                      <th className="px-2 py-1.5">Risk</th>
                      <th className="px-2 py-1.5 text-right">Flood</th>
                      <th className="px-2 py-1.5 text-right">Salinity</th>
                      <th className="px-2 py-1.5 text-right">Value</th>
                      <th className="px-2 py-1.5 text-right">VaR</th>
                      <th className="px-2 py-1.5">Scored</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {inc.assets.map((a) => (
                      <tr key={a.id} className="hover:bg-white/[0.03]">
                        <td className="px-2 py-1.5">
                          <Link href={`/app/portfolio?asset=${a.id}`} className="text-slate-200 hover:text-sky-300">
                            {a.name}
                          </Link>
                          <div className="text-[10px] text-slate-500">
                            {TYPE_LABEL[a.type] ?? a.type}
                            {a.externalRef ? ` · ${a.externalRef}` : ""}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="telemetry text-slate-100">{a.composite}</span>
                            <RiskPill level={a.level} />
                          </span>
                        </td>
                        <td className="telemetry px-2 py-1.5 text-right text-slate-300">{a.flood}</td>
                        <td className="telemetry px-2 py-1.5 text-right text-slate-300">{a.salinity}</td>
                        <td className="telemetry px-2 py-1.5 text-right text-slate-300">{fmtUsd(a.valueUsd)}</td>
                        <td className="telemetry px-2 py-1.5 text-right text-amber-200">{fmtUsd(a.varUsd)}</td>
                        <td className="px-2 py-1.5 text-[10px] text-slate-500">{a.source === "baseline" ? "baseline" : `${a.source} · ${timeAgo(a.scoredAt)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!inc.assets.length && <p className="p-4 text-center text-xs text-slate-500">No assets linked. Draw the affected area to pull in every asset inside it.</p>}
              </div>
            </Panel>

            <Panel title="Timeline" subtitle="Automatic milestones + the team's log" icon={ListTree} accent="cyan">
              <Timeline incidentId={inc.id} entries={inc.timeline} timeZone={tz} />
            </Panel>
          </div>

          {/* ── Right: command & comms ── */}
          <div className="space-y-4 xl:col-span-5">
            <Panel title="Response clocks" subtitle={`${inc.severity} service levels`} icon={Target} accent="violet">
              <SlaPanel inc={inc} />
            </Panel>

            <Panel title="Roles" subtitle="One owner per job — assigning notifies the person" icon={Users} accent="violet">
              <div className="space-y-2">
                {ROLES.map((r) => {
                  const who = inc.members.find((m) => m.id === inc.roles[r]);
                  return (
                    <div key={r} className="flex items-center gap-2">
                      <Avatar user={who} size={26} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-slate-500">
                          <Explain text={ROLE_META[r].meaning}>{ROLE_META[r].label}</Explain>
                        </div>
                        <select
                          value={inc.roles[r] ?? ""}
                          disabled={resolved}
                          onChange={async (e) => {
                            await assign.mutateAsync({ id: inc.id, role: r, userId: e.target.value || null }).catch((err) => toast.error(err.message));
                            void invalidate();
                          }}
                          className="w-full bg-transparent text-sm text-slate-100 focus:outline-none"
                          aria-label={ROLE_META[r].label}
                        >
                          <option value="">Unassigned</option>
                          {inc.members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                              {m.title ? ` — ${m.title}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Tasks" subtitle="Hazard playbook + your own actions" icon={ClipboardList} accent="cyan">
              <TaskList inc={inc} readOnly={false} />
            </Panel>

            <Panel title="Stakeholder updates" subtitle="Partners, regulators, farmer groups" icon={Megaphone} accent="amber">
              <StakeholderComms inc={inc} />
            </Panel>

            <Panel title="Team discussion" icon={MessagesSquare} accent="cyan">
              <Comments entityType="incident" entityId={inc.id} title="Discussion" maxHeight={360} />
            </Panel>

            <Panel title="Linked" subtitle="Where this incident came from and related items" icon={Link2}>
              <ul className="space-y-1.5">
                {inc.links.map((l) => {
                  const Icon = LINK_ICON[l.kind];
                  return (
                    <li key={`${l.kind}:${l.id}`} className="group flex items-center gap-2 text-xs">
                      <Icon size={13} className="text-slate-400" />
                      {l.href ? (
                        <Link href={l.href} className="min-w-0 flex-1 truncate text-slate-200 hover:text-sky-300">
                          {l.label}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-slate-200">{l.label}</span>
                      )}
                      <span className="text-[10px] capitalize text-slate-500">{l.kind}</span>
                      <button
                        className="hidden text-slate-600 hover:text-rose-300 group-hover:block"
                        aria-label="Unlink"
                        onClick={async () => {
                          await unlink.mutateAsync({ id: inc.id, kind: l.kind, linkId: l.id }).catch(() => null);
                          void invalidate();
                        }}
                      >
                        <X size={11} />
                      </button>
                    </li>
                  );
                })}
                {!inc.links.length && <li className="text-xs text-slate-500">Opened manually — nothing linked.</li>}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <Link href={`/app/simulate?lat=${center[0]}&lon=${center[1]}&hazard=${inc.hazard}`} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-slate-300 hover:border-violet-400/50 hover:text-violet-200">
                  <FlaskConical size={11} /> Simulate this area
                </Link>
                <Link href={`/app/explorer?lat=${center[0]}&lon=${center[1]}`} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-slate-300 hover:border-sky-400/50 hover:text-sky-200">
                  <MapIcon size={11} /> Open in Risk Explorer
                </Link>
                <button onClick={() => router.push("/app/activity?category=incident")} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-slate-300 hover:border-sky-400/50">
                  <ListTree size={11} /> Workspace activity
                </button>
              </div>
            </Panel>
          </div>
        </div>
      )}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm ? `Move to ${STATUS_META[confirm.to].label}?` : ""}
        subtitle={confirm ? STATUS_META[confirm.to].meaning : undefined}
        footer={
          <>
            <PfButton variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </PfButton>
            <PfButton onClick={() => confirm && void move(confirm.to, true)} loading={setStatus.isPending}>
              Move to {confirm ? STATUS_META[confirm.to].label : ""}
            </PfButton>
          </>
        }
      >
        {confirm?.warnings.length ? (
          <ul className="mb-3 space-y-1.5">
            {confirm.warnings.map((w) => (
              <li key={w} className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
                {w}
              </li>
            ))}
          </ul>
        ) : null}
        <label className="block text-[11px] uppercase tracking-wider text-slate-400">
          Note for the timeline (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={cn("mt-1 w-full rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 focus:outline-none")} placeholder={confirm?.to === "resolved" ? "e.g. Embankment closed, water receded in all unions" : "Why are we moving?"} />
        </label>
      </Modal>
    </div>
  );
}

