"use client";

/**
 * Read-only dashboard boards: the public share page (/d/<token>) and the
 * full-screen TV mode (rotation between dashboards).
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, Loader2, Maximize2, Pause, Play, Shield, X } from "lucide-react";
import { LiveDot } from "@/components/hud";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/hooks/useRealtime";
import { GridCanvas } from "./GridCanvas";
import { WidgetCard, type DataSource } from "./WidgetCard";
import { bottom } from "./grid";
import type { Widget } from "./catalog";
import { ago } from "./format";

function ReadOnlyGrid({ widgets, source, refreshSec, rowHeight }: { widgets: Widget[]; source: DataSource; refreshSec: number; rowHeight?: number }) {
  return (
    <GridCanvas
      widgets={widgets}
      editing={false}
      onChange={() => undefined}
      selectedId={null}
      onSelect={() => undefined}
      rowHeight={rowHeight}
      renderWidget={(w, s) => <WidgetCard widget={w} state={s} source={source} refreshSec={refreshSec} />}
    />
  );
}

// ─── Public share page ────────────────────────────────────────────────────

export function SharedDashboard({ token }: { token: string }) {
  const q = trpc.dashboards.shared.useQuery({ token, countView: true }, { retry: false, refetchInterval: 120_000, refetchOnWindowFocus: false });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (q.isLoading)
    return (
      <div className="grid min-h-screen place-items-center hud-bg text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="grid min-h-screen place-items-center hud-bg px-6 text-center">
        <div>
          <div className="font-display text-xl font-semibold text-white">Dashboard not available</div>
          <p className="mt-1 max-w-sm text-sm text-slate-400">{q.error?.message ?? "This link is invalid or sharing was turned off by the workspace."}</p>
          <Link href="/" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950">
            About Agri-SHIELD <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  const d = q.data;
  return (
    <div className="min-h-screen hud-bg">
      <header className="sticky top-0 z-[700] border-b border-white/5 bg-[#050914]/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-white">
            <Shield size={18} className="text-sky-400" /> Agri-SHIELD
          </Link>
          <span className="hidden h-4 w-px bg-white/10 sm:block" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[15px] font-semibold text-white">{d.name}</h1>
            <p className="truncate text-[11px] text-slate-400">
              Shared by {d.orgName} · read-only · updated {ago(d.updatedAt)}
            </p>
          </div>
          <LiveDot label={d.refreshSec > 0 ? `LIVE · ${d.refreshSec}s` : "LIVE"} color="#38bdf8" />
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-5">
        {d.description && <p className="mb-4 max-w-3xl text-sm text-slate-400">{d.description}</p>}
        <ReadOnlyGrid widgets={d.widgets} source={{ mode: "shared", token }} refreshSec={d.refreshSec || 120} />
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4 text-[11.5px] text-slate-500">
          <span>
            Live climate-risk data from the {d.orgName} workspace. Hover ⓘ on any widget for what it shows and its data sources. Page checked {ago(new Date(now))}.
          </span>
          <Link href="/book-demo" className="text-sky-300 hover:underline">
            Build dashboards like this for your organisation →
          </Link>
        </footer>
      </main>
    </div>
  );
}

// ─── TV mode ──────────────────────────────────────────────────────────────

export function TvMode({ ids, every, orgId }: { ids: string[]; every: number; orgId: string | null }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [vh, setVh] = useState(900);
  const rootRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const id = ids[idx % Math.max(1, ids.length)] ?? "";
  const dash = trpc.dashboards.get.useQuery({ id }, { enabled: !!id, refetchInterval: 60_000 });
  // prefetch the next one so the switch is instant
  const nextId = ids[(idx + 1) % Math.max(1, ids.length)];
  useEffect(() => {
    if (nextId && nextId !== id) void utils.dashboards.get.prefetch({ id: nextId });
  }, [nextId, id, utils]);

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    onResize();
    window.addEventListener("resize", onResize);
    const c = setInterval(() => setClock(new Date()), 1000);
    return () => {
      window.removeEventListener("resize", onResize);
      clearInterval(c);
    };
  }, []);

  const step = useCallback((dir: number) => {
    setIdx((i) => (i + dir + ids.length) % Math.max(1, ids.length));
    setProgress(0);
  }, [ids.length]);

  useEffect(() => {
    if (paused || ids.length < 2) return;
    const started = Date.now() - progress * every * 1000;
    const t = setInterval(() => {
      const p = (Date.now() - started) / (every * 1000);
      if (p >= 1) step(1);
      else setProgress(p);
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, idx, every, ids.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key.toLowerCase() === "f") void (document.fullscreenElement ? document.exitFullscreen() : rootRef.current?.requestFullscreen());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  useRealtime(orgId ? [`ws:${orgId}`] : [], (env) => {
    if (["portfolio.rescored", "rule.fired", "notification.created"].includes(env.event.type)) void utils.dashboards.widget.invalidate();
  });

  const d = dash.data;
  // Fit the whole dashboard on one screen when possible (TV = no scrolling)
  const rows = d ? Math.max(1, bottom(d.widgets)) : 8;
  const rowHeight = Math.max(52, Math.min(120, Math.floor((vh - 90 - 12 * rows) / rows)));

  return (
    <div ref={rootRef} className="fixed inset-0 z-[1200] overflow-auto hud-bg">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/5 bg-[#050914]/90 px-5 py-2.5 backdrop-blur">
        <Shield size={18} className="text-sky-400" />
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div key={id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="truncate font-display text-lg font-semibold text-white">
              {d?.name ?? "Loading…"}
            </motion.div>
          </AnimatePresence>
        </div>
        <LiveDot label="LIVE" color="#38bdf8" />
        <span className="telemetry text-lg text-slate-200">{clock.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        {ids.length > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => step(-1)} className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Previous dashboard">
              <ChevronLeft size={16} />
            </button>
            <span className="telemetry text-[11px] text-slate-400">
              {idx + 1}/{ids.length}
            </span>
            <button onClick={() => step(1)} className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Next dashboard">
              <ChevronRight size={16} />
            </button>
            <button onClick={() => setPaused((p) => !p)} className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label={paused ? "Resume rotation" : "Pause rotation"}>
              {paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
          </div>
        )}
        <button onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : rootRef.current?.requestFullscreen())} className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Full screen (F)">
          <Maximize2 size={15} />
        </button>
        <Link href={id ? `/app/dashboards?id=${id}` : "/app/dashboards"} className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Exit TV mode">
          <X size={16} />
        </Link>
        {ids.length > 1 && <div className="absolute bottom-0 left-0 h-[2px] bg-sky-400/80 transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />}
      </div>
      <div className="px-4 py-3">
        {!ids.length ? (
          <div className="grid h-[60vh] place-items-center text-slate-400">No dashboards selected — open TV mode from the Dashboards page.</div>
        ) : dash.error ? (
          <div className="grid h-[60vh] place-items-center text-rose-300">{dash.error.message}</div>
        ) : !d ? (
          <div className="grid h-[60vh] place-items-center text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={d.id} initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
              <ReadOnlyGrid widgets={d.widgets} source={{ mode: "app" }} refreshSec={Math.max(30, Math.min(d.refreshSec || 60, 120))} rowHeight={rowHeight} />
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
