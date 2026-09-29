"use client";

/**
 * Wall / TV mode (/app/twin?mode=wall): chrome-free ops-room view with an auto-tour
 * through ranked hotspots, narrative captions generated from data, big KPIs and a clock.
 * Keys: Space pause · ←/→ previous/next hotspot · F fullscreen · Esc exit.
 * Author: Nitya Prakash Pandey
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Maximize2, Pause, Play, X } from "lucide-react";
import type { Hotspot, TwinScene, TwinTimeline } from "@/server/services/twin";
import type { FlyTarget, GlobeProps, LayerState, Selection } from "./Globe";
import { buildTicker, fmtUsd, Ticker } from "./hud";
import { riskColor } from "@/components/hud";

const KIND_LABEL: Record<string, string> = { district: "District", hazard: "Live hazard", cyclone: "Cyclone", facility: "Facility", asset: "Asset" };
const KIND_DIST: Record<string, number> = { district: 1.36, hazard: 1.7, cyclone: 2.1, facility: 1.3, asset: 1.3 };
const LAYERS: LayerState = { assets: true, districts: true, hazards: true, cyclones: true, flows: true, terminator: true, graticule: true };

function selFor(h: Hotspot): Selection {
  if (h.kind === "facility" || h.kind === "asset") return { kind: "asset", id: h.targetId };
  if (h.kind === "district") return { kind: "district", id: h.targetId };
  if (h.kind === "hazard") return { kind: "hazard", id: h.targetId };
  return { kind: "cyclone", id: h.targetId };
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="telemetry leading-tight" data-testid="wall-clock">
      <div className="text-4xl font-semibold text-white md:text-5xl">{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
        {now.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" })} · {now.toISOString().slice(11, 16)} UTC
      </div>
    </div>
  );
}

export default function WallMode({ Globe, scene, hotspots, timeline, reduced, dwellSec, onExit }: { Globe: ComponentType<GlobeProps>; scene: TwinScene; hotspots: Hotspot[]; timeline: TwinTimeline | null; reduced: boolean; dwellSec: number; onExit: () => void }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [idle, setIdle] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const elapsed = useRef(0);
  const n = hotspots.length;
  const cur = n ? hotspots[idx % n]! : null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const go = useCallback(
    (d: number) => {
      if (!n) return;
      elapsed.current = 0;
      setIdx((i) => (((i + d) % n) + n) % n);
    },
    [n]
  );

  // auto-advance
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      if (!paused && n > 1) {
        elapsed.current += dt;
        if (elapsed.current >= dwellSec * 1000) go(1);
      }
      if (bar.current) bar.current.style.width = `${Math.min(100, (elapsed.current / (dwellSec * 1000)) * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, n, dwellSec, go]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      } else if (e.key === "Escape" && !document.fullscreenElement) onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onExit]);

  // hide cursor + hints when idle
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3500);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  const fly: FlyTarget | null = useMemo(() => (cur ? { lat: cur.lat, lon: cur.lon, dist: KIND_DIST[cur.kind] ?? 1.8, key: idx + 1 } : { lat: scene.org.center[0], lon: scene.org.center[1], dist: 2.6, key: 0 }), [cur, idx, scene.org.center]);
  const selected = cur ? selFor(cur) : null;
  const assetScores = useMemo(() => scene.assets.map((a) => a.score), [scene.assets]);
  const districtScores = useMemo(() => scene.districts.map((d) => d.composite), [scene.districts]);
  const ticker = useMemo(() => buildTicker(scene, timeline), [scene, timeline]);
  const k = scene.kpis;
  const big: { label: string; value: string; color: string }[] = scene.assets.length
    ? [
        { label: `${scene.org.assetNoun} at risk`, value: `${k.atRisk}/${k.assets}`, color: k.atRisk ? "#f87171" : "#4ade80" },
        { label: "Exposure at risk", value: fmtUsd(k.exposureAtRiskUsd), color: "#fbbf24" },
        { label: "Hazards nearby", value: `${k.nearbyHazards}`, color: k.nearbyHazards ? "#fb923c" : "#94a3b8" },
        { label: "Active cyclones", value: `${k.activeCyclones}`, color: k.activeCyclones ? "#e879f9" : "#94a3b8" },
      ]
    : [
        { label: "High-risk districts", value: `${k.districtsHigh}/${k.districts}`, color: k.districtsHigh ? "#f87171" : "#4ade80" },
        { label: "Farms exposed", value: k.farmsAtRisk.toLocaleString("en-US"), color: "#fbbf24" },
        { label: "Active alerts", value: `${k.activeAlerts}`, color: k.activeAlerts ? "#fb923c" : "#94a3b8" },
        { label: "Hazards nearby", value: `${k.nearbyHazards}`, color: k.nearbyHazards ? "#fb923c" : "#94a3b8" },
      ];

  return (
    <div className={`fixed inset-0 z-[950] overflow-hidden bg-[#01040c] text-slate-100 ${idle ? "cursor-none" : ""}`} data-testid="twin-wall" role="region" aria-label="Earth Twin wall display">
      <Globe
        scene={scene}
        assetScores={assetScores}
        districtScores={districtScores}
        timeMs={nowMs}
        layers={LAYERS}
        selected={selected}
        onSelect={() => undefined}
        onHover={() => undefined}
        fly={fly}
        reducedMotion={reduced}
        autoRotate={!n}
        initialView={{ lat: scene.org.center[0], lon: scene.org.center[1], dist: 2.8 }}
        className="absolute inset-0"
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(1,4,12,0.85)_100%)]" />
      <div className="scanlines pointer-events-none absolute inset-0 opacity-40" />

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-4 p-5 md:p-8">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
            <span className="hud-label text-emerald-300">Agri-SHIELD · Earth Twin · live</span>
          </div>
          <div className="font-display text-lg font-semibold text-white md:text-2xl">{scene.org.name}</div>
          <Clock />
        </div>
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {big.map((b) => (
            <div key={b.label} className="hud-panel min-w-[150px] px-4 py-3" style={{ ["--hud-accent" as string]: "56 189 248" }}>
              <div className="hud-label">{b.label}</div>
              <div className="telemetry text-3xl font-semibold md:text-5xl" style={{ color: b.color, textShadow: `0 0 24px ${b.color}66` }}>
                {b.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* caption */}
      <div className="pointer-events-none absolute inset-x-0 bottom-12 p-5 md:bottom-14 md:p-8">
        <AnimatePresence mode="wait">
          {cur ? (
            <motion.div key={cur.id} initial={reduced ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -12 }} transition={{ duration: 0.5 }} className="max-w-4xl" data-testid="wall-caption">
              <div className="mb-2 flex items-center gap-3">
                <span className="telemetry text-sm text-slate-400">
                  {String((idx % n) + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
                </span>
                <span className="rounded-md border border-white/15 bg-white/5 px-2 py-0.5 hud-label text-slate-200">{KIND_LABEL[cur.kind] ?? cur.kind}</span>
                <span className="telemetry text-sm" style={{ color: riskColor(cur.severity) }}>
                  severity {Math.round(cur.severity)}
                </span>
              </div>
              <h2 className="font-display text-3xl font-semibold leading-tight text-white md:text-6xl" style={{ textShadow: "0 2px 30px rgba(0,0,0,0.8)" }}>
                {cur.title}
              </h2>
              <p className="mt-2 max-w-3xl text-lg leading-snug text-slate-200 md:text-3xl" style={{ textShadow: "0 2px 20px rgba(0,0,0,0.9)" }}>
                {cur.caption}
              </p>
            </motion.div>
          ) : (
            <motion.div key="summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl">
              <h2 className="font-display text-3xl font-semibold text-white md:text-5xl">All quiet</h2>
              <p className="mt-2 text-lg text-slate-300 md:text-2xl">{scene.summary}</p>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mt-4 h-1 w-full max-w-4xl overflow-hidden rounded-full bg-white/10">
          <div ref={bar} className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: "0%" }} />
        </div>
      </div>

      {/* up next (large screens) */}
      {n > 1 && (
        <ol className="pointer-events-none absolute bottom-28 right-8 hidden w-80 space-y-1.5 xl:block">
          {hotspots.slice(0, 6).map((h, i) => (
            <li key={h.id} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${i === idx % n ? "bg-cyan-500/15 text-white" : "text-slate-400"}`}>
              <span className="telemetry text-xs text-slate-500">{String(i + 1).padStart(2, "0")}</span>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: riskColor(h.severity) }} />
              <span className="truncate">{h.title}</span>
            </li>
          ))}
        </ol>
      )}

      {/* ticker */}
      <div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-[#030814]/80 py-2.5 backdrop-blur">
        <Ticker items={ticker} onPick={() => undefined} reduced={reduced} className="text-sm" />
      </div>

      {/* controls (fade when idle) */}
      <div className={`absolute right-5 top-1/2 flex -translate-y-1/2 flex-col gap-2 transition-opacity duration-500 ${idle ? "pointer-events-none opacity-0" : "opacity-100"}`}>
        <button type="button" onClick={onExit} aria-label="Exit wall mode" className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 hover:bg-white/10">
          <X size={16} />
        </button>
        <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Resume tour" : "Pause tour"} className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 hover:bg-white/10">
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button type="button" onClick={() => go(-1)} aria-label="Previous hotspot" className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 hover:bg-white/10">
          <ChevronLeft size={16} />
        </button>
        <button type="button" onClick={() => go(1)} aria-label="Next hotspot" className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 hover:bg-white/10">
          <ChevronRight size={16} />
        </button>
        <button type="button" onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen?.().catch(() => undefined))} aria-label="Toggle fullscreen" className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 hover:bg-white/10">
          <Maximize2 size={16} />
        </button>
      </div>
      <div className={`pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 rounded-full border border-white/10 bg-black/50 px-4 py-1.5 telemetry text-[11px] text-slate-300 transition-opacity duration-500 ${idle ? "opacity-0" : "opacity-100"}`}>
        {paused ? "PAUSED · " : ""}Space pause · ←/→ hotspot · F fullscreen · Esc exit
      </div>
    </div>
  );
}
