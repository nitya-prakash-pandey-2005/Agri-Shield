"use client";

/**
 * Custom dashboards — build your own mission-control screens.
 *
 *  - 12-column canvas: drag to move, drag the corner to resize, snap to grid,
 *    arrow keys / Shift+arrows for keyboard editing, undo/redo (Ctrl+Z / Ctrl+Y)
 *  - Widget catalogue backed by real workspace data (one server resolver)
 *  - Industry templates, several dashboards per workspace, default dashboard
 *  - Read-only share links (/d/<token>), TV mode (/app/dashboards/tv), PNG/PDF export
 *  - Auto-refresh per dashboard + realtime refresh on ws:<orgId> events
 *
 * Deep link: /app/dashboards?id=<dashboardId>[&edit=1]
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Download, FileImage, FileText, LayoutDashboard, MonitorPlay, Pencil, Plus, Redo2, Share2, Star, Trash2, Undo2, Zap } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LiveDot, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { PageTitle, PfButton, QueryError, inputCls } from "@/components/portfolio/ui";
import { cn } from "@/lib/utils";
import { can } from "@/lib/rbac";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/hooks/useRealtime";
import { REFRESH_OPTIONS, WIDGETS, type Widget, type WidgetKind } from "@/components/dashboards/catalog";
import { addItem, removeItem } from "@/components/dashboards/grid";
import { GridCanvas } from "@/components/dashboards/GridCanvas";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { ConfigPanel } from "@/components/dashboards/ConfigPanel";
import { AddWidgetDialog, NewDashboardDialog, ShareDialog, TvDialog, type TemplateInfo } from "@/components/dashboards/dialogs";
import { useHistory } from "@/components/dashboards/useHistory";
import { exportPdf, exportPng } from "@/components/dashboards/exporter";
import { ago } from "@/components/dashboards/format";

export default function DashboardsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[640px]" />}>
      <DashboardsInner />
    </Suspense>
  );
}

const newWidgetId = () => `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const REALTIME_TYPES = new Set(["portfolio.rescored", "rule.fired", "notification.created", "risk.updated", "alert.created"]);

function DashboardsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const utils = trpc.useUtils();
  const { data: session } = useSession();
  const orgId = session?.user?.orgId ?? null;
  const canManage = can(session?.user?.role, "manage_assets");

  const list = trpc.dashboards.list.useQuery(undefined, { staleTime: 30_000 });
  const templates = trpc.dashboards.templates.useQuery(undefined, { staleTime: 300_000 });
  const requested = params.get("id");
  const currentId = requested && list.data?.some((d) => d.id === requested) ? requested : (list.data?.find((d) => d.isDefault)?.id ?? list.data?.[0]?.id ?? null);
  const dash = trpc.dashboards.get.useQuery({ id: currentId ?? "" }, { enabled: !!currentId, staleTime: 5_000 });

  const hist = useHistory<Widget[]>([]);
  const widgets = hist.value;
  const [editing, setEditing] = useState(params.get("edit") === "1");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [configId, setConfigId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "add" | "new" | "share" | "tv" | "delete">(null);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [lastEvent, setLastEvent] = useState<{ type: string; at: string } | null>(null);
  const [name, setName] = useState("");
  const [exporting, setExporting] = useState<null | "png" | "pdf">(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const savedJson = useRef<string>("[]");
  const loadedFor = useRef<string | null>(null);

  // Load a dashboard into the editor (only when switching, or when not editing — never clobber local edits)
  useEffect(() => {
    const d = dash.data;
    if (!d) return;
    const json = JSON.stringify(d.widgets);
    if (loadedFor.current !== d.id || (!editing && json !== savedJson.current)) {
      loadedFor.current = d.id;
      savedJson.current = json;
      hist.reset(d.widgets);
      setName(d.name);
      setSaveState("saved");
      setSelectedId(null);
      setConfigId(null);
    }
  }, [dash.data, editing, hist.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = trpc.dashboards.update.useMutation();
  const create = trpc.dashboards.create.useMutation();
  const del = trpc.dashboards.delete.useMutation();
  const setDefault = trpc.dashboards.setDefault.useMutation();
  const share = trpc.dashboards.share.useMutation();

  // Autosave (debounced) while editing
  useEffect(() => {
    if (!currentId || loadedFor.current !== currentId) return;
    const json = JSON.stringify(widgets);
    if (json === savedJson.current) return;
    setSaveState("dirty");
    const t = setTimeout(() => {
      setSaveState("saving");
      update.mutate(
        { id: currentId, widgets },
        {
          onSuccess: (d) => {
            savedJson.current = JSON.stringify(d.widgets);
            utils.dashboards.get.setData({ id: d.id }, d);
            void utils.dashboards.list.invalidate();
            setSaveState("saved");
          },
          onError: (e) => {
            setSaveState("error");
            toast.error(`Could not save: ${e.message}`);
          },
        }
      );
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets, currentId]);

  // Realtime: refresh widget data when the workspace changes
  const lastInvalidate = useRef(0);
  useRealtime(orgId ? [`ws:${orgId}`] : [], (env) => {
    if (!REALTIME_TYPES.has(env.event.type)) return;
    setLastEvent({ type: env.event.type, at: env.at });
    const now = Date.now();
    if (now - lastInvalidate.current < 3000) return;
    lastInvalidate.current = now;
    void utils.dashboards.widget.invalidate();
  });

  // Keyboard: undo / redo / escape
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        hist.undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        hist.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, hist.undo, hist.redo]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((id: string, edit = false) => router.push(`/app/dashboards?id=${encodeURIComponent(id)}${edit ? "&edit=1" : ""}`, { scroll: false }), [router]);

  const addWidget = (kind: WidgetKind) => {
    const meta = WIDGETS[kind];
    const w: Widget = { id: newWidgetId(), kind, title: meta.defaultTitle, x: 0, y: 0, w: meta.size.w, h: meta.size.h, minW: meta.size.minW, minH: meta.size.minH, config: { ...meta.defaults } };
    hist.set((cur) => addItem(cur, w));
    setDialog(null);
    setEditing(true);
    setSelectedId(w.id);
    setConfigId(w.id);
  };
  const removeWidget = (id: string) => {
    hist.set((cur) => removeItem(cur, id));
    if (configId === id) setConfigId(null);
    setSelectedId(null);
  };
  const duplicateWidget = (id: string) => {
    const src = widgets.find((w) => w.id === id);
    if (!src) return;
    const copy = { ...src, id: newWidgetId(), title: `${src.title} (copy)`, config: structuredClone(src.config) };
    hist.set((cur) => addItem(cur, copy));
    setSelectedId(copy.id);
  };
  const patchWidget = (id: string, patch: Partial<Widget>, key: string) => hist.set((cur) => cur.map((w) => (w.id === id ? { ...w, ...patch } : w)), `${id}:${key}`);

  const saveMeta = (patch: { name?: string; refreshSec?: number }) => {
    if (!currentId) return;
    update.mutate(
      { id: currentId, ...patch },
      {
        onSuccess: (d) => {
          utils.dashboards.get.setData({ id: d.id }, (old) => (old ? { ...old, name: d.name, refreshSec: d.refreshSec, updatedAt: d.updatedAt } : d));
          void utils.dashboards.list.invalidate();
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const doExport = async (kind: "png" | "pdf") => {
    if (!exportRef.current || !dash.data) return;
    setExporting(kind);
    const wasEditing = editing;
    setEditing(false);
    await new Promise((r) => setTimeout(r, 350));
    try {
      if (kind === "png") await exportPng(exportRef.current, dash.data.name);
      else await exportPdf(exportRef.current, { title: dash.data.name, subtitle: `${session?.user?.name ?? ""} · exported ${new Date().toLocaleString("en-GB")} · live workspace data` });
      toast.success(`Exported ${kind.toUpperCase()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
      if (wasEditing) setEditing(true);
    }
  };

  const configWidget = widgets.find((w) => w.id === configId) ?? null;
  const d = dash.data;
  const refreshSec = d?.refreshSec ?? 60;
  const listItems = list.data ?? [];

  const liveLine = useMemo(() => {
    const cadence = REFRESH_OPTIONS.find((o) => o.value === refreshSec)?.label ?? `${refreshSec}s`;
    return refreshSec > 0 ? `Auto-refresh ${cadence} + realtime` : "Realtime updates only";
  }, [refreshSec]);

  if (list.error) return <QueryError error={list.error} onRetry={() => list.refetch()} />;

  return (
    <div className="pb-16">
      <PageTitle
        eyebrow="Insights · Custom dashboards"
        title={d?.name ?? "Dashboards"}
        description={
          <>
            Build your own mission-control screens from live workspace data — drag widgets to arrange them, share a read-only link with partners, or put one on the office TV.{" "}
            <Explain text="Every tile reads the same live data as Portfolio, Alerts and Satellite Lab. Hover the ⓘ on any widget to see exactly what it shows and where the numbers come from." />
          </>
        }
        actions={
          <>
            {editing ? (
              <>
                <PfButton variant="outline" size="sm" onClick={hist.undo} disabled={!hist.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
                  <Undo2 size={14} />
                </PfButton>
                <PfButton variant="outline" size="sm" onClick={hist.redo} disabled={!hist.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
                  <Redo2 size={14} />
                </PfButton>
                <PfButton variant="outline" size="sm" onClick={() => setDialog("add")}>
                  <Plus size={14} /> Add widget
                </PfButton>
                <PfButton size="sm" onClick={() => setEditing(false)}>
                  <Check size={14} /> Done
                </PfButton>
              </>
            ) : (
              <>
                <PfButton variant="outline" size="sm" onClick={() => setDialog("new")}>
                  <Plus size={14} /> New
                </PfButton>
                <PfButton variant="outline" size="sm" onClick={() => setEditing(true)} disabled={!d}>
                  <Pencil size={14} /> Edit
                </PfButton>
                <PfButton variant="outline" size="sm" onClick={() => setDialog("share")} disabled={!d}>
                  <Share2 size={14} /> Share
                </PfButton>
                <PfButton variant="outline" size="sm" onClick={() => setDialog("tv")} disabled={!d}>
                  <MonitorPlay size={14} /> TV mode
                </PfButton>
                <ExportMenu busy={exporting} onExport={doExport} disabled={!d} />
              </>
            )}
          </>
        }
      />

      {/* Dashboard switcher */}
      <div className="-mx-1 mb-3 flex items-center gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Dashboards">
        {list.isLoading && <Skeleton className="h-8 w-64" />}
        {listItems.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={x.id === currentId}
            onClick={() => x.id !== currentId && go(x.id)}
            className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors", x.id === currentId ? "border-sky-400/60 bg-sky-400/10 text-white" : "border-slate-700/60 text-slate-400 hover:border-slate-500 hover:text-slate-200")}
          >
            {x.isDefault && <Star size={11} className="fill-amber-300 text-amber-300" aria-label="Default" />}
            {x.name}
            {x.shared && <Share2 size={10} className="text-emerald-300" aria-label="Shared" />}
            <span className="telemetry text-[10px] text-slate-500">{x.widgets}</span>
          </button>
        ))}
      </div>

      {/* Status strip */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-[11.5px] text-slate-400">
        <LiveDot label="LIVE" color="#38bdf8" />
        <span>{liveLine}</span>
        {lastEvent && (
          <span className="inline-flex items-center gap-1 text-slate-300">
            <Zap size={11} className="text-amber-300" /> {lastEvent.type.replace(".", " ")} {ago(lastEvent.at)}
          </span>
        )}
        <label className="inline-flex items-center gap-1.5">
          Refresh
          <select className="rounded-md border border-slate-700/80 bg-slate-950/60 px-1.5 py-0.5 text-[11.5px] text-slate-200" value={refreshSec} onChange={(e) => saveMeta({ refreshSec: Number(e.target.value) })} disabled={!d}>
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {d && (
          <span className="hidden sm:inline">
            Edited {ago(d.updatedAt)} by {d.updatedByName}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editing && (
            <span className={cn("telemetry text-[10.5px] uppercase tracking-wider", saveState === "saved" ? "text-emerald-300" : saveState === "error" ? "text-rose-300" : "text-amber-300")}>
              {saveState === "saved" ? "All changes saved" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Unsaved…"}
            </span>
          )}
          {d && !editing && (
            <>
              {!d.isDefault && (
                <button className="inline-flex items-center gap-1 hover:text-white" onClick={() => setDefault.mutate({ id: d.id }, { onSuccess: () => { void utils.dashboards.list.invalidate(); void utils.dashboards.get.invalidate(); toast.success("Set as the workspace default"); } })}>
                  <Star size={12} /> Make default
                </button>
              )}
              <button
                className="inline-flex items-center gap-1 hover:text-white"
                onClick={() =>
                  create.mutate(
                    { name: `${d.name} (copy)`, fromId: d.id },
                    {
                      onSuccess: (n) => {
                        void utils.dashboards.list.invalidate();
                        toast.success("Dashboard duplicated");
                        go(n.id);
                      },
                      onError: (e) => toast.error(e.message),
                    }
                  )
                }
              >
                <Copy size={12} /> Duplicate
              </button>
              {canManage && (
                <button className="inline-flex items-center gap-1 hover:text-rose-300" onClick={() => setDialog("delete")}>
                  <Trash2 size={12} /> Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-400/25 bg-sky-400/[0.05] px-3 py-2.5 text-[12px] text-sky-100/90">
              <label className="flex min-w-[220px] flex-1 items-center gap-2">
                <span className="hud-label text-sky-300/80">Name</span>
                <input className={cn(inputCls, "py-1.5")} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => d && name.trim() && name !== d.name && saveMeta({ name: name.trim() })} />
              </label>
              <span className="text-[11.5px] text-sky-200/70">Drag the ⠿ handle to move · drag the corner to resize · click a widget then use arrow keys (Shift = resize) · Enter configures · Delete removes</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {dash.isLoading || (!d && list.isLoading) ? (
        <div className="grid grid-cols-12 gap-3">
          {[3, 3, 3, 3, 7, 5].map((w, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : dash.error ? (
        <QueryError error={dash.error} onRetry={() => dash.refetch()} />
      ) : !d ? (
        <EmptyState icon={LayoutDashboard} title="No dashboards yet">
          <PfButton className="mt-3" onClick={() => setDialog("new")}>
            <Plus size={14} /> Create your first dashboard
          </PfButton>
        </EmptyState>
      ) : widgets.length === 0 ? (
        <div className="hud-panel flex flex-col items-center justify-center gap-3 px-6 py-16 text-center" style={{ ["--hud-accent" as string]: "56 189 248" }}>
          <LayoutDashboard size={30} className="text-sky-400/60" />
          <div className="font-display text-lg text-white">This dashboard is empty</div>
          <p className="max-w-md text-sm text-slate-400">Add KPI tiles, maps, charts, tables, live hazard feeds, forecasts and notes. Each widget reads live workspace data and explains itself.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <PfButton onClick={() => setDialog("add")}>
              <Plus size={14} /> Add a widget
            </PfButton>
            <PfButton variant="outline" onClick={() => setDialog("new")}>
              Start from a template
            </PfButton>
          </div>
        </div>
      ) : (
        <div ref={exportRef} className={cn("rounded-2xl", exporting && "bg-[#050914] p-3")}>
          <GridCanvas
            widgets={widgets}
            editing={editing}
            onChange={(next) => hist.set(next)}
            onConfigure={(id) => setConfigId(id)}
            onRemove={removeWidget}
            selectedId={selectedId}
            onSelect={setSelectedId}
            renderWidget={(w, s) => (
              <WidgetCard
                widget={w}
                state={s}
                source={{ mode: "app" }}
                refreshSec={refreshSec}
                onConfigure={() => setConfigId(w.id)}
                onDuplicate={() => duplicateWidget(w.id)}
                onRemove={() => removeWidget(w.id)}
              />
            )}
          />
        </div>
      )}

      <div className="mt-6 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-[12.5px] leading-relaxed text-slate-400">
        <div className="hud-label mb-1 text-sky-300/80">What this means for you</div>
        One screen per audience: underwriters, credit committees, field teams or the situation room each see the numbers they act on, refreshed live. Shared links are read-only and show only this dashboard — never the rest of your workspace. Numbers are the same ones used in{" "}
        <Link href="/app/portfolio" className="text-sky-300 hover:underline">
          Portfolio
        </Link>
        ,{" "}
        <Link href="/app/alerts" className="text-sky-300 hover:underline">
          Alerts
        </Link>{" "}
        and{" "}
        <Link href="/app/imagery" className="text-sky-300 hover:underline">
          Satellite Lab
        </Link>
        , so a dashboard never disagrees with the module behind it.
      </div>

      <ConfigPanel widget={configWidget} onChange={(patch, key) => configWidget && patchWidget(configWidget.id, patch, key)} onClose={() => setConfigId(null)} />
      <AddWidgetDialog open={dialog === "add"} onClose={() => setDialog(null)} onAdd={addWidget} />
      <NewDashboardDialog
        open={dialog === "new"}
        onClose={() => setDialog(null)}
        templates={(templates.data ?? []) as TemplateInfo[]}
        creating={create.isPending}
        onCreate={(input) =>
          create.mutate(input, {
            onSuccess: (n) => {
              setDialog(null);
              void utils.dashboards.list.invalidate();
              toast.success(`"${n.name}" created`);
              go(n.id, !input.templateId);
              setEditing(!input.templateId);
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
      {d && (
        <ShareDialog
          open={dialog === "share"}
          onClose={() => setDialog(null)}
          token={d.shareToken}
          views={d.shareViews}
          canManage={canManage}
          busy={share.isPending}
          onToggle={(enabled) => share.mutate({ id: d.id, enabled }, { onSuccess: (n) => { utils.dashboards.get.setData({ id: n.id }, n); void utils.dashboards.list.invalidate(); toast.success(enabled ? "Public link created" : "Public link turned off"); }, onError: (e) => toast.error(e.message) })}
          onRotate={() => share.mutate({ id: d.id, enabled: true, rotate: true }, { onSuccess: (n) => { utils.dashboards.get.setData({ id: n.id }, n); toast.success("New link created — the old one no longer works"); }, onError: (e) => toast.error(e.message) })}
        />
      )}
      <TvDialog open={dialog === "tv"} onClose={() => setDialog(null)} dashboards={listItems.map((x) => ({ id: x.id, name: x.name }))} currentId={currentId} />
      {d && dialog === "delete" && (
        <ConfirmDelete
          name={d.name}
          busy={del.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            del.mutate(
              { id: d.id },
              {
                onSuccess: (r) => {
                  setDialog(null);
                  void utils.dashboards.list.invalidate();
                  toast.success("Dashboard deleted");
                  if (r.nextDefaultId) go(r.nextDefaultId);
                  else router.push("/app/dashboards");
                },
                onError: (e) => toast.error(e.message),
              }
            )
          }
        />
      )}
    </div>
  );
}

function ExportMenu({ busy, onExport, disabled }: { busy: null | "png" | "pdf"; onExport: (k: "png" | "pdf") => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <PfButton variant="outline" size="sm" onClick={() => setOpen((o) => !o)} loading={!!busy} disabled={disabled} aria-haspopup="menu" aria-expanded={open}>
        <Download size={14} /> Export
      </PfButton>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-[600] mt-1 w-52 overflow-hidden rounded-lg border border-slate-700/80 bg-[#0a1122] shadow-xl">
          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-slate-200 hover:bg-white/5" onClick={() => { setOpen(false); onExport("png"); }}>
            <FileImage size={14} className="text-sky-300" /> PNG image
          </button>
          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-slate-200 hover:bg-white/5" onClick={() => { setOpen(false); onExport("pdf"); }}>
            <FileText size={14} className="text-sky-300" /> PDF (A4 landscape)
          </button>
        </div>
      )}
    </div>
  );
}

function ConfirmDelete({ name, busy, onCancel, onConfirm }: { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="alertdialog" aria-modal="true" className="hud-panel w-full max-w-sm p-5" style={{ ["--hud-accent" as string]: "239 68 68" }}>
        <div className="font-display text-base text-white">Delete “{name}”?</div>
        <p className="mt-1 text-sm text-slate-400">The dashboard and its share link are removed for everyone. Widgets don't hold data, so nothing else is lost.</p>
        <div className="mt-4 flex justify-end gap-2">
          <PfButton variant="ghost" onClick={onCancel}>
            Cancel
          </PfButton>
          <PfButton variant="danger" loading={busy} onClick={onConfirm}>
            <Trash2 size={14} /> Delete
          </PfButton>
        </div>
      </div>
    </div>
  );
}
