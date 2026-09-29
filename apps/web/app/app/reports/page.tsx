"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { motion } from "framer-motion";
import { BarChart3, CalendarClock, Clock, Download, Eye, FileSpreadsheet, FileText, Landmark, Loader2, MapPin, Newspaper, Play, Plus, Presentation, ScrollText, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, Meter, Panel, SectionHeader, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, Field, Modal, Toggle, downloadBlob, inputCls } from "@/components/workspace/ui";
import { renderReportPdf, reportCsv, reportFileName } from "@/components/workspace/reportPdf";
import type { ReportSnapshot, ReportType } from "@/server/services/workspace-state";
import { cn } from "@/lib/utils";

const ICON: Record<ReportType, typeof FileText> = { portfolio_summary: BarChart3, location_dd: MapPin, physical_risk: Landmark, weekly_digest: Newspaper, board_pack: Presentation };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function SnapshotPreview({ snap }: { snap: ReportSnapshot }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/5 p-3 font-display text-[15px] text-white">{snap.summary}</div>
      {snap.sections.map((s, i) => (
        <section key={i}>
          <h4 className="mb-1.5 border-l-2 border-cyan-400 pl-2 font-display text-[13.5px] font-semibold text-white">{s.heading}</h4>
          {s.paragraphs?.map((p, k) => (
            <p key={k} className="mb-1.5 text-[12.5px] leading-relaxed text-slate-300">
              {p}
            </p>
          ))}
          {s.kpis && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {s.kpis.map((k) => (
                <div key={k.label} className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{k.label}</div>
                  <div className="telemetry text-[14px] font-semibold text-white">{k.value}</div>
                </div>
              ))}
            </div>
          )}
          {s.bullets && (
            <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-slate-300">
              {s.bullets.map((b, k) => (
                <li key={k}>{b}</li>
              ))}
            </ul>
          )}
          {s.table && (
            <div className="mt-1 overflow-x-auto rounded-lg border border-white/5">
              <table className="w-full text-[11.5px]">
                <thead className="bg-white/[0.03]">
                  <tr>
                    {s.table.columns.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-slate-400">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {s.table.rows.map((r, k) => (
                    <tr key={k}>
                      {r.map((c, j) => (
                        <td key={j} className="whitespace-nowrap px-2 py-1 text-slate-300">
                          {typeof c === "number" ? c.toLocaleString("en-US") : c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
      <div className="border-t border-white/5 pt-2 text-[11px] text-slate-500">Sources: {snap.sources.join(" · ")}</div>
    </div>
  );
}

function ReportsHub() {
  const params = useSearchParams();
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.workspace.me.useQuery();
  const q = trpc.workspace.reports.useQuery();
  const gen = trpc.workspace.generateReport.useMutation();
  const getReport = trpc.workspace.getReport.useMutation();
  const del = trpc.workspace.deleteReport.useMutation();
  const createSch = trpc.workspace.createSchedule.useMutation();
  const toggleSch = trpc.workspace.toggleSchedule.useMutation();
  const deleteSch = trpc.workspace.deleteSchedule.useMutation();
  const runSch = trpc.workspace.runScheduleNow.useMutation();

  const focus = params?.get("type") as ReportType | null;
  const openId = params?.get("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; title: string; snapshot: ReportSnapshot } | null>(null);
  const [locOpen, setLocOpen] = useState(false);
  const [loc, setLoc] = useState<{ assetId: string; lat: string; lon: string; name: string }>({ assetId: "", lat: "", lon: "", name: "" });
  const [schOpen, setSchOpen] = useState<ReportType | null>(null);
  const [sch, setSch] = useState({ cadence: "weekly" as "weekly" | "monthly", day: 1, hourUtc: 3, recipients: "" });

  const refresh = () => Promise.all([utils.workspace.reports.invalidate(), utils.workspace.onboarding.invalidate(), utils.workspace.navBadges.invalidate()]);
  const logo = me.data?.org ? { logoInitials: me.data.org.logoInitials, logoColor: me.data.org.logoColor } : {};

  useEffect(() => {
    if (!openId) return;
    getReport.mutateAsync({ id: openId }).then((r) => setPreview({ id: r.id, title: r.title, snapshot: r.snapshot })).catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  useEffect(() => {
    if (focus && q.data) document.getElementById(`report-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus, q.data]);

  const downloadPdf = async (snap: ReportSnapshot) => {
    const blob = await renderReportPdf(snap, logo);
    downloadBlob(reportFileName(snap), blob, "application/pdf");
  };

  const generate = async (type: ReportType, p: Record<string, unknown> = {}) => {
    setBusy(type);
    try {
      const r = await gen.mutateAsync({ type, params: p as never });
      await downloadPdf(r.snapshot);
      setPreview({ id: r.id, title: r.title, snapshot: r.snapshot });
      toast.success(`${r.snapshot.title} generated — PDF downloaded`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const historyDownload = async (id: string, kind: "pdf" | "csv" | "view") => {
    try {
      const r = await getReport.mutateAsync({ id });
      if (kind === "pdf") await downloadPdf(r.snapshot);
      else if (kind === "csv") downloadBlob(reportFileName(r.snapshot, "csv"), reportCsv(r.snapshot), "text/csv");
      else setPreview({ id: r.id, title: r.title, snapshot: r.snapshot });
      void utils.workspace.reports.invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const d = q.data;
  const assetOptions = useMemo(() => d?.assets ?? [], [d]);
  useEffect(() => {
    if (d && !sch.recipients) setSch((x) => ({ ...x, recipients: d.defaultRecipient }));
  }, [d, sch.recipients]);

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Workspace"
        title="Reports"
        description="Board-ready PDFs built from your live portfolio data. Generate one now, schedule it weekly or monthly, and find everything you've made in the history below."
        actions={
          d && (
            <div className="hud-panel min-w-[220px] px-3 py-2">
              <div className="flex justify-between text-[11.5px] text-slate-400">
                <span>Reports this month</span>
                <span className="telemetry text-slate-200">
                  {d.usage.used} / {d.usage.limit ?? "∞"}
                </span>
              </div>
              {d.usage.limit !== null && <Meter value={d.usage.pct} color="#38bdf8" className="mt-1.5" />}
            </div>
          )
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {!d
          ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-60" />)
          : d.catalogue.map((c, i) => {
              const Icon = ICON[c.type];
              return (
                <motion.div
                  key={c.type}
                  id={`report-${c.type}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={cn("hud-panel flex flex-col p-4", focus === c.type && "ring-2 ring-cyan-400/70")}
                >
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-cyan-500/10">
                    <Icon size={17} className="text-cyan-300" />
                  </span>
                  <h3 className="mt-3 font-display text-[15px] font-semibold text-white">
                    {c.title} {c.type === "physical_risk" && <Explain term="tcfd" />}
                  </h3>
                  <p className="mt-1 flex-1 text-[12.5px] leading-relaxed text-slate-400">{c.description}</p>
                  <div className="mt-2 text-[11px] text-slate-500">
                    {c.audience} · {c.pages}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Btn className="flex-1" disabled={!!busy} onClick={() => (c.needsLocation ? setLocOpen(true) : generate(c.type))}>
                      {busy === c.type ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Generate
                    </Btn>
                    {!c.needsLocation && (
                      <Btn variant="outline" onClick={() => setSchOpen(c.type)} aria-label={`Schedule ${c.title}`} title="Schedule">
                        <CalendarClock size={14} />
                      </Btn>
                    )}
                  </div>
                </motion.div>
              );
            })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Report history" subtitle="Every report generated in this workspace — download again any time" icon={ScrollText} accent="cyan" className="lg:col-span-2">
          {!d ? (
            <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : d.history.length === 0 ? (
            <EmptyState icon={FileText} title="No reports yet">
              Generate your first report above — it takes a few seconds and downloads as a PDF.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-white/5">
              {d.history.map((r) => {
                const Icon = ICON[r.type];
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <Icon size={16} className="shrink-0 text-cyan-300" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-slate-100">{r.title}</div>
                      <div className="truncate text-[11.5px] text-slate-500">
                        {r.trigger === "schedule" ? (
                          <span className="text-violet-300">
                            <Clock size={10} className="mr-0.5 inline" />
                            scheduled
                          </span>
                        ) : (
                          r.createdByName
                        )}{" "}
                        · {formatDistanceToNowStrict(new Date(r.createdAt), { addSuffix: true })} · ~{r.pages} pages · {r.downloads} download{r.downloads === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => historyDownload(r.id, "view")} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Preview" title="Preview">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => historyDownload(r.id, "pdf")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-cyan-300 hover:bg-white/5" title="Download PDF">
                        <Download size={12} /> PDF
                      </button>
                      <button onClick={() => historyDownload(r.id, "csv")} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Download CSV" title="Tables as CSV">
                        <FileSpreadsheet size={14} />
                      </button>
                      <button
                        onClick={async () => {
                          await del.mutateAsync({ id: r.id });
                          toast.success("Report deleted");
                          await refresh();
                        }}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                        aria-label="Delete report"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Schedules" subtitle="Generated automatically and emailed to recipients" icon={CalendarClock} accent="violet" actions={<Btn variant="outline" className="h-7 px-2 py-0 text-[11.5px]" onClick={() => setSchOpen("weekly_digest")}><Plus size={12} /> New</Btn>}>
          {!d ? (
            <Skeleton className="h-24" />
          ) : d.schedules.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Nothing scheduled">
              Schedule the weekly digest so the whole team gets a Monday summary by email.
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {d.schedules.map((s) => (
                <li key={s.id} className="rounded-lg border border-white/5 bg-white/[0.015] p-2.5">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-slate-100">{d.catalogue.find((c) => c.type === s.type)?.title}</div>
                      <div className="text-[11px] text-slate-500">
                        {s.cadence === "weekly" ? `Every ${DAYS[s.day]}` : `Monthly on day ${s.day}`} · {String(s.hourUtc).padStart(2, "0")}:00 UTC
                      </div>
                    </div>
                    <Toggle checked={s.enabled} label="Enabled" onChange={async (v) => (await toggleSch.mutateAsync({ id: s.id, enabled: v }), await refresh())} />
                  </div>
                  <div className="mt-1.5 truncate text-[11px] text-slate-500">→ {s.recipients.join(", ")}</div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">
                      {s.enabled ? `Next ${formatDistanceToNowStrict(new Date(s.nextRunAt), { addSuffix: true })}` : "Paused"} · {s.runs} run{s.runs === 1 ? "" : "s"}
                    </span>
                    <span className="flex gap-1">
                      <button
                        onClick={async () => {
                          try {
                            await runSch.mutateAsync({ id: s.id });
                            toast.success("Report generated and emailed to recipients");
                            await refresh();
                          } catch (e) {
                            toast.error((e as Error).message);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-cyan-300 hover:bg-white/5"
                      >
                        <Play size={11} /> Run now
                      </button>
                      <button onClick={async () => (await deleteSch.mutateAsync({ id: s.id }), await refresh())} className="rounded p-1 text-slate-500 hover:text-rose-300" aria-label="Delete schedule">
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Location due-diligence */}
      <Modal
        open={locOpen}
        onClose={() => setLocOpen(false)}
        title="Location due-diligence report"
        footer={
          <>
            <Btn variant="outline" onClick={() => setLocOpen(false)}>
              Cancel
            </Btn>
            <Btn
              disabled={!!busy || (!loc.assetId && (!loc.lat || !loc.lon))}
              onClick={async () => {
                setLocOpen(false);
                await generate("location_dd", loc.assetId ? { assetId: loc.assetId } : { lat: Number(loc.lat), lon: Number(loc.lon), name: loc.name || undefined });
              }}
            >
              <FileText size={14} /> Generate
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Pick one of your assets">
            <select className={inputCls} value={loc.assetId} onChange={(e) => setLoc((x) => ({ ...x, assetId: e.target.value }))}>
              <option value="">— or enter coordinates below —</option>
              {assetOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <div className={cn("grid grid-cols-2 gap-3", loc.assetId && "pointer-events-none opacity-40")}>
            <Field label="Latitude">
              <input className={inputCls} inputMode="decimal" placeholder="22.35" value={loc.lat} onChange={(e) => setLoc((x) => ({ ...x, lat: e.target.value }))} />
            </Field>
            <Field label="Longitude">
              <input className={inputCls} inputMode="decimal" placeholder="89.12" value={loc.lon} onChange={(e) => setLoc((x) => ({ ...x, lon: e.target.value }))} />
            </Field>
            <Field label="Site name (optional)" className="col-span-2">
              <input className={inputCls} value={loc.name} onChange={(e) => setLoc((x) => ({ ...x, name: e.target.value }))} placeholder="Prospective borrower — Shyamnagar" />
            </Field>
          </div>
          <p className="text-[11.5px] text-slate-500">Uses live forecasts, GloFAS river flow, the ML flood & salinity models and nearby disaster feeds. Counts as 1 location assessment.</p>
        </div>
      </Modal>

      {/* Schedule */}
      <Modal
        open={!!schOpen}
        onClose={() => setSchOpen(null)}
        title="Schedule a report"
        footer={
          <>
            <Btn variant="outline" onClick={() => setSchOpen(null)}>
              Cancel
            </Btn>
            <Btn
              disabled={createSch.isPending}
              onClick={async () => {
                try {
                  const recipients = sch.recipients.split(/[,;\s]+/).filter(Boolean);
                  await createSch.mutateAsync({ type: schOpen as Exclude<ReportType, "location_dd">, cadence: sch.cadence, day: sch.cadence === "weekly" ? Math.min(6, sch.day) : Math.max(1, sch.day), hourUtc: sch.hourUtc, recipients });
                  toast.success("Schedule created");
                  setSchOpen(null);
                  await refresh();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <CalendarClock size={14} /> Create schedule
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Report">
            <select className={inputCls} value={schOpen ?? ""} onChange={(e) => setSchOpen(e.target.value as ReportType)}>
              {d?.catalogue.filter((c) => !c.needsLocation).map((c) => (
                <option key={c.type} value={c.type}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Every">
              <select className={inputCls} value={sch.cadence} onChange={(e) => setSch((x) => ({ ...x, cadence: e.target.value as "weekly" | "monthly", day: 1 }))}>
                <option value="weekly">Week</option>
                <option value="monthly">Month</option>
              </select>
            </Field>
            <Field label={sch.cadence === "weekly" ? "On" : "Day"}>
              <select className={inputCls} value={sch.day} onChange={(e) => setSch((x) => ({ ...x, day: Number(e.target.value) }))}>
                {sch.cadence === "weekly"
                  ? DAYS.map((dname, i) => (
                      <option key={dname} value={i}>
                        {dname}
                      </option>
                    ))
                  : Array.from({ length: 28 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}
                      </option>
                    ))}
              </select>
            </Field>
            <Field label="At (UTC)">
              <select className={inputCls} value={sch.hourUtc} onChange={(e) => setSch((x) => ({ ...x, hourUtc: Number(e.target.value) }))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Email to" hint="Separate addresses with commas">
            <input className={inputCls} value={sch.recipients} onChange={(e) => setSch((x) => ({ ...x, recipients: e.target.value }))} />
          </Field>
        </div>
      </Modal>

      {/* Preview */}
      <Modal
        open={!!preview}
        wide
        onClose={() => {
          setPreview(null);
          if (openId) router.replace("/app/reports");
        }}
        title={preview?.snapshot.title ?? ""}
        footer={
          preview && (
            <>
              <Btn variant="outline" onClick={() => downloadBlob(reportFileName(preview.snapshot, "csv"), reportCsv(preview.snapshot), "text/csv")}>
                <FileSpreadsheet size={14} /> CSV
              </Btn>
              <Btn onClick={() => downloadPdf(preview.snapshot)}>
                <Download size={14} /> Download PDF
              </Btn>
            </>
          )
        }
      >
        {preview && (
          <>
            <div className="mb-3 text-[11.5px] text-slate-500">
              {preview.snapshot.subtitle} · generated {new Date(preview.snapshot.generatedAt).toLocaleString()} by {preview.snapshot.generatedBy}
            </div>
            <SnapshotPreview snap={preview.snapshot} />
          </>
        )}
      </Modal>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense>
      <ReportsHub />
    </Suspense>
  );
}
