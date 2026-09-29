"use client";

/** Builder dialogs: widget catalogue, new dashboard (templates), share link, TV mode. */
import { useEffect, useState } from "react";
import { BarChart3, Bell, CheckCircle2, CloudRain, Compass, Copy, Gauge, Hash, LineChart, Link2, Map as MapIcon, MonitorPlay, RefreshCw, Siren, Sparkles, StickyNote, Table } from "lucide-react";
import { toast } from "sonner";
import { Field, Modal, PfButton, Toggle, inputCls } from "@/components/portfolio/ui";
import { cn } from "@/lib/utils";
import { WIDGETS, WIDGET_KINDS, type WidgetKind } from "./catalog";

export const KIND_ICON: Record<WidgetKind, typeof Hash> = {
  kpi: Hash,
  gauge: Gauge,
  timeseries: LineChart,
  bar: BarChart3,
  map: MapIcon,
  table: Table,
  hazards: Siren,
  notifications: Bell,
  forecast: CloudRain,
  note: StickyNote,
  explorer: Compass,
  embed: Link2,
};

const KIND_TINT: Record<WidgetKind, string> = {
  kpi: "#38bdf8",
  gauge: "#a78bfa",
  timeseries: "#3987e5",
  bar: "#199e70",
  map: "#22d3ee",
  table: "#94a3b8",
  hazards: "#f87171",
  notifications: "#fbbf24",
  forecast: "#60a5fa",
  note: "#e2e8f0",
  explorer: "#34d399",
  embed: "#c084fc",
};

export function AddWidgetDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (k: WidgetKind) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add a widget" subtitle="Every widget reads live workspace data. You can change its metric, filters and thresholds after adding it." wide>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {WIDGET_KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          const m = WIDGETS[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => onAdd(k)}
              className="group flex items-start gap-3 rounded-xl border border-slate-700/60 bg-slate-900/40 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-sky-400/60 hover:bg-sky-400/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${KIND_TINT[k]}1a`, color: KIND_TINT[k] }}>
                <Icon size={17} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-slate-100 group-hover:text-white">{m.label}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-400">{m.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export interface TemplateInfo {
  id: string;
  name: string;
  audience: string;
  description: string;
  recommended: boolean;
  layout: { kind: WidgetKind; x: number; y: number; w: number; h: number; title: string }[];
}

/** Miniature of a template/dashboard layout. */
export function LayoutThumb({ layout, className }: { layout: { kind: WidgetKind; x: number; y: number; w: number; h: number }[]; className?: string }) {
  const rows = Math.max(1, ...layout.map((w) => w.y + w.h));
  return (
    <svg viewBox={`0 0 120 ${Math.max(40, rows * 5)}`} className={cn("w-full", className)} preserveAspectRatio="xMidYMin meet" aria-hidden>
      {layout.map((w, i) => (
        <rect key={i} x={w.x * 10 + 0.8} y={w.y * 5 + 0.8} width={w.w * 10 - 1.6} height={w.h * 5 - 1.6} rx={1.6} fill={`${KIND_TINT[w.kind]}33`} stroke={`${KIND_TINT[w.kind]}99`} strokeWidth={0.5} />
      ))}
    </svg>
  );
}

export function NewDashboardDialog({
  open,
  onClose,
  templates,
  onCreate,
  creating,
}: {
  open: boolean;
  onClose: () => void;
  templates: TemplateInfo[];
  onCreate: (input: { name: string; templateId: string | null }) => void;
  creating: boolean;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    if (!open) return;
    const rec = templates.find((t) => t.recommended) ?? templates[0];
    setChoice(rec?.id ?? null);
    setName(rec ? rec.name : "");
  }, [open, templates]);
  const pick = (id: string | null) => {
    setChoice(id);
    const t = templates.find((x) => x.id === id);
    setName(t ? t.name : "My dashboard");
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New dashboard"
      subtitle="Start from an industry template (you can change everything) or from a blank canvas."
      wide
      footer={
        <>
          <PfButton variant="ghost" onClick={onClose}>
            Cancel
          </PfButton>
          <PfButton loading={creating} disabled={!name.trim()} onClick={() => onCreate({ name: name.trim(), templateId: choice })}>
            <Sparkles size={14} /> Create dashboard
          </PfButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            aria-pressed={choice === t.id}
            className={cn("relative flex flex-col gap-2 rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60", choice === t.id ? "border-sky-400/70 bg-sky-400/[0.07] shadow-[0_0_30px_-12px_rgba(56,189,248,0.8)]" : "border-slate-700/60 bg-slate-900/40 hover:border-slate-500")}
          >
            {t.recommended && <span className="absolute right-2 top-2 rounded bg-emerald-500/15 px-1.5 py-0.5 telemetry text-[9px] uppercase tracking-wider text-emerald-300">for you</span>}
            <LayoutThumb layout={t.layout} className="h-24 rounded-md bg-[#050914] p-1" />
            <div>
              <div className="text-[13px] font-semibold text-slate-100">{t.name}</div>
              <div className="text-[10.5px] uppercase tracking-wider text-sky-300/70">{t.audience}</div>
              <p className="mt-1 text-[11.5px] leading-snug text-slate-400">{t.description}</p>
            </div>
          </button>
        ))}
        <button
          type="button"
          onClick={() => pick(null)}
          aria-pressed={choice === null}
          className={cn("flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-center", choice === null ? "border-sky-400/70 bg-sky-400/[0.07]" : "border-slate-700 hover:border-slate-500")}
        >
          <span className="text-[13px] font-semibold text-slate-100">Blank canvas</span>
          <span className="text-[11.5px] text-slate-400">Add widgets one by one from the catalogue.</span>
        </button>
      </div>
      <Field label="Name" className="mt-4">
        <input className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function ShareDialog({
  open,
  onClose,
  token,
  views,
  canManage,
  onToggle,
  onRotate,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  token: string | null;
  views: number;
  canManage: boolean;
  onToggle: (enabled: boolean) => void;
  onRotate: () => void;
  busy: boolean;
}) {
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/d/${token}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed — select the link and copy it manually");
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Share read-only link" subtitle="Anyone with the link can view this dashboard's live numbers without signing in. They can't edit it or see anything else in your workspace.">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <div>
            <div className="text-[13px] font-medium text-slate-100">Public link</div>
            <div className="text-[11.5px] text-slate-400">{token ? `On · opened ${views} time${views === 1 ? "" : "s"}` : "Off — nobody outside the workspace can see it"}</div>
          </div>
          <Toggle checked={!!token} onChange={onToggle} disabled={!canManage || busy} label="Public link" />
        </div>
        {!canManage && <p className="text-[11.5px] text-amber-300/90">Only workspace admins and analysts can turn public links on or off.</p>}
        {token && (
          <>
            <div className="flex gap-2">
              <input readOnly className={`${inputCls} telemetry text-[12px]`} value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
              <PfButton variant="outline" onClick={copy} aria-label="Copy link">
                <Copy size={14} />
              </PfButton>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-slate-400">
              <CheckCircle2 size={13} className="text-emerald-400" /> Shows the saved layout, refreshes automatically, hides personal and billing notifications.
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 px-3 py-1.5 text-xs text-slate-200 hover:border-sky-400/60">
                <MonitorPlay size={13} /> Open link
              </a>
              {canManage && (
                <PfButton size="sm" variant="danger" onClick={onRotate} loading={busy}>
                  <RefreshCw size={12} /> Reset link (old one stops working)
                </PfButton>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function TvDialog({ open, onClose, dashboards, currentId }: { open: boolean; onClose: () => void; dashboards: { id: string; name: string }[]; currentId: string | null }) {
  const [ids, setIds] = useState<string[]>([]);
  const [every, setEvery] = useState(60);
  useEffect(() => {
    if (open) setIds(currentId ? [currentId] : dashboards.slice(0, 1).map((d) => d.id));
  }, [open, currentId, dashboards]);
  const href = `/app/dashboards/tv?ids=${ids.join(",")}&every=${every}`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="TV mode"
      subtitle="Full-screen wall display: live auto-refresh, large type, and optional rotation between dashboards. Press F to go full screen, Space to pause, ← → to switch."
      footer={
        <>
          <PfButton variant="ghost" onClick={onClose}>
            Cancel
          </PfButton>
          <a href={href} className={cn("inline-flex items-center gap-2 rounded-lg bg-sky-400 px-3.5 py-2 text-sm font-medium text-slate-950 hover:bg-sky-300", !ids.length && "pointer-events-none opacity-40")}>
            <MonitorPlay size={14} /> Start TV mode
          </a>
        </>
      }
    >
      <div className="space-y-3">
        <div className="hud-label">Dashboards to rotate</div>
        <div className="space-y-1.5">
          {dashboards.map((d) => (
            <label key={d.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/5 px-3 py-2 text-[13px] text-slate-200 hover:bg-white/[0.03]">
              <input type="checkbox" className="accent-sky-400" checked={ids.includes(d.id)} onChange={(e) => setIds((cur) => (e.target.checked ? [...cur, d.id] : cur.filter((x) => x !== d.id)))} />
              {d.name}
            </label>
          ))}
        </div>
        <Field label="Switch every">
          <select className={inputCls} value={every} onChange={(e) => setEvery(Number(e.target.value))}>
            {[20, 30, 60, 120, 300].map((s) => (
              <option key={s} value={s}>
                {s < 60 ? `${s} seconds` : `${s / 60} minute${s === 60 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
