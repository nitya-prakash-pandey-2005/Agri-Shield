"use client";

/**
 * Earth Twin — 3D mission-control view of the workspace's world + wall (TV) mode.
 * Data: trpc.twin.scene / timeline / hotspots. Globe: ./Globe (react-three-fiber, lazy).
 * Author: Nitya Prakash Pandey
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { Compass, Crosshair, Globe2, Layers, Link2, MonitorPlay, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, Panel, SourceTag, riskColor } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { trpc } from "@/lib/trpc";
import type { Hotspot } from "@/server/services/twin";
import type { FlyTarget, GlobeProps, HoverInfo, LayerState, Selection } from "./Globe";
import { distanceForSpan, haversineKm, sampleSeries } from "./geo";
import { buildTicker, DetailDrawer, FeedChips, HoverTip, KpiStrip, LayerRail, Ticker, type KpiView } from "./hud";
import { TimeMachine } from "./TimeMachine";
import WallMode from "./WallMode";
import FallbackMap from "./FallbackMap";

const DAY = 86_400_000;

function GlobeLoading() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-40 w-40 animate-pulse rounded-full border border-cyan-500/20 bg-[radial-gradient(circle_at_35%_35%,rgba(56,189,248,0.25),rgba(2,6,17,0.9)_70%)] shadow-[0_0_80px_-10px_rgba(56,189,248,0.5)]" />
        <span className="hud-label text-cyan-300/80">Spinning up the Earth twin…</span>
      </div>
    </div>
  );
}
const Globe = dynamic(() => import("./Globe"), { ssr: false, loading: GlobeLoading }) as unknown as React.ComponentType<GlobeProps>;

class GlobeBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[twin] 3D view failed, using 2D map", err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function detectWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const DEFAULT_LAYERS: LayerState = { assets: true, districts: true, hazards: true, cyclones: true, flows: true, terminator: true, graticule: true };
const LAYER_KEY = "agri.twin.layers";

function loadLayers(): LayerState {
  try {
    const raw = window.localStorage.getItem(LAYER_KEY);
    if (raw) return { ...DEFAULT_LAYERS, ...(JSON.parse(raw) as Partial<LayerState>) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LAYERS;
}

function parseSel(v: string | null): Selection | null {
  if (!v) return null;
  const i = v.indexOf(":");
  if (i < 1) return null;
  const kind = v.slice(0, i) as Selection["kind"];
  if (!["asset", "district", "hazard", "cyclone", "flow", "cluster"].includes(kind)) return null;
  return { kind, id: v.slice(i + 1) };
}

export default function TwinApp() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const reduced = useReducedMotion() ?? false;
  const mode = params.get("mode") === "wall" ? "wall" : "ops";
  const force2d = params.get("renderer") === "2d";
  const dwell = Math.max(5, Math.min(120, Number(params.get("dwell")) || 12));

  const sceneQ = trpc.twin.scene.useQuery(undefined, { refetchInterval: 60_000, staleTime: 30_000 });
  const tlQ = trpc.twin.timeline.useQuery(undefined, { refetchInterval: 5 * 60_000, staleTime: 60_000 });
  const hsQ = trpc.twin.hotspots.useQuery({ limit: 10 }, { refetchInterval: 60_000, staleTime: 30_000 });
  const scene = sceneQ.data ?? null;
  const timeline = tlQ.data ?? null;
  const hotspots: Hotspot[] = hsQ.data ?? [];

  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => setWebgl(!force2d && detectWebGL()), [force2d]);

  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  useEffect(() => setLayers(loadLayers()), []);
  const setLayer = useCallback((k: keyof LayerState, v: boolean) => {
    setLayers((l) => {
      const next = { ...l, [k]: v };
      try {
        window.localStorage.setItem(LAYER_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // time
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [offset, setOffset] = useState(() => {
    const t = Number(params.get("t"));
    return Number.isFinite(t) ? Math.max(-30, Math.min(16, t)) : 0;
  });
  const timeMs = nowMs + offset * DAY;
  const dayIndex = timeline ? offset - timeline.from : 0;

  // selection + camera
  const [selected, setSelected] = useState<Selection | null>(() => parseSel(params.get("sel")));
  const [fly, setFly] = useState<FlyTarget | null>(null);
  const flyKey = useRef(1);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const fpsRef = useRef<HTMLSpanElement | null>(null);

  const assetScores = useMemo(() => {
    if (!scene) return [];
    if (!timeline || Math.abs(offset) < 0.01) return scene.assets.map((a) => a.score);
    const m = new Map(timeline.assetSeries.map((s) => [s.id, s.s]));
    return scene.assets.map((a) => {
      const s = m.get(a.id);
      return s ? sampleSeries(s, dayIndex) : a.score;
    });
  }, [scene, timeline, offset, dayIndex]);
  const districtScores = useMemo(() => {
    if (!scene) return [];
    if (!timeline || Math.abs(offset) < 0.01) return scene.districts.map((d) => d.composite);
    const m = new Map(timeline.districtSeries.map((s) => [s.id, s.s]));
    return scene.districts.map((d) => {
      const s = m.get(d.id);
      return s ? sampleSeries(s, dayIndex) : d.composite;
    });
  }, [scene, timeline, offset, dayIndex]);

  const kpiView: KpiView = useMemo(() => {
    if (!scene) return { atRisk: 0, exposureAtRisk: 0, districtsHigh: 0, farmsAtRisk: 0 };
    const th = scene.kpis.threshold;
    let atRisk = 0;
    let exp = 0;
    scene.assets.forEach((a, i) => {
      if ((assetScores[i] ?? a.score) >= th) {
        atRisk++;
        exp += a.valueUsd;
      }
    });
    let dh = 0;
    let farms = 0;
    scene.districts.forEach((d, i) => {
      if ((districtScores[i] ?? d.composite) >= th) {
        dh++;
        farms += d.farms;
      }
    });
    return { atRisk, exposureAtRisk: exp, districtsHigh: dh, farmsAtRisk: farms };
  }, [scene, assetScores, districtScores]);

  const locate = useCallback(
    (s: Selection): { lat: number; lon: number; dist: number } | null => {
      if (!scene) return null;
      if (s.kind === "asset") {
        const a = scene.assets.find((x) => x.id === s.id);
        return a ? { lat: a.lat, lon: a.lon, dist: 1.24 } : null;
      }
      if (s.kind === "district") {
        const d = scene.districts.find((x) => x.id === s.id);
        return d ? { lat: d.lat, lon: d.lon, dist: 1.3 } : null;
      }
      if (s.kind === "cluster") {
        const d = scene.districts.find((x) => x.id === s.id);
        return d ? { lat: d.lat, lon: d.lon, dist: 1.3 } : null;
      }
      if (s.kind === "hazard") {
        const h = scene.hazards.find((x) => x.id === s.id);
        return h ? { lat: h.lat, lon: h.lon, dist: 1.6 } : null;
      }
      if (s.kind === "cyclone") {
        const t = scene.tracks.find((x) => x.id === s.id);
        if (!t) return null;
        const a = t.points[0]!;
        const b = t.points[t.points.length - 1]!;
        const mid = t.points[Math.floor(t.points.length / 2)]!;
        return { lat: mid[1], lon: mid[2], dist: distanceForSpan(haversineKm(a[1], a[2], b[1], b[2]) * 1.1) };
      }
      if (s.kind === "flow") {
        const f = scene.flows.find((x) => x.id === s.id);
        return f ? { lat: (f.from.lat + f.to.lat) / 2, lon: (f.from.lon + f.to.lon) / 2, dist: distanceForSpan(haversineKm(f.from.lat, f.from.lon, f.to.lat, f.to.lon) * 1.3) } : null;
      }
      return null;
    },
    [scene]
  );

  const select = useCallback(
    (s: Selection | null, opts: { fly?: boolean } = { fly: true }) => {
      // clusters open their district drawer
      const sel = s && s.kind === "cluster" ? (scene?.districts.some((d) => d.id === s.id) ? { kind: "district" as const, id: s.id } : null) : s;
      setSelected(sel);
      if (sel && opts.fly !== false) {
        const loc = locate(sel);
        if (loc) setFly({ ...loc, key: ++flyKey.current });
      }
      const q = new URLSearchParams(Array.from(params.entries()));
      if (sel) q.set("sel", `${sel.kind}:${sel.id}`);
      else q.delete("sel");
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [locate, params, pathname, router, scene]
  );

  // fly to a URL-provided selection once the scene arrives
  const didInitialFly = useRef(false);
  useEffect(() => {
    if (!scene || didInitialFly.current) return;
    didInitialFly.current = true;
    if (selected) {
      const loc = locate(selected);
      if (loc) setFly({ ...loc, key: ++flyKey.current });
    }
  }, [scene, selected, locate]);

  // persist the time offset in the URL (debounced) for shareable links
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams(Array.from(params.entries()));
      const r = Math.round(offset * 4) / 4;
      if (Math.abs(r) < 0.01) q.delete("t");
      else q.set("t", String(r));
      const next = `${pathname}?${q.toString()}`;
      if (next !== `${pathname}?${params.toString()}`) router.replace(next, { scroll: false });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  // keyboard (ops mode)
  useEffect(() => {
    if (mode !== "ops") return;
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      if (e.key === "Escape") select(null, { fly: false });
      else if (e.key === "[") setOffset((o) => Math.max(-30, Math.round(o) - 1));
      else if (e.key === "]") setOffset((o) => Math.min(16, Math.round(o) + 1));
      else if (e.key === "w" && !e.metaKey && !e.ctrlKey) router.push(`${pathname}?mode=wall`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, select, router, pathname]);

  const initialView = useMemo(() => {
    if (!scene) return { lat: 15, lon: 100, dist: 2.8 };
    const pts = scene.assets.length ? scene.assets : scene.districts;
    let span = 400;
    for (const p of pts) span = Math.max(span, haversineKm(scene.org.center[0], scene.org.center[1], p.lat, p.lon) * 2);
    return { lat: scene.org.center[0] - 6, lon: scene.org.center[1], dist: Math.min(3.2, distanceForSpan(span * 1.5) + 0.35) };
  }, [scene]);

  const ticker = useMemo(() => (scene ? buildTicker(scene, timeline) : []), [scene, timeline]);

  const resetView = () => setFly({ ...initialView, key: ++flyKey.current });
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied — it opens this exact view");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  // ── Loading / error ──
  if (sceneQ.error)
    return (
      <Panel title="Earth Twin" icon={Globe2}>
        <EmptyState icon={Globe2} title="The Earth twin could not load">
          {sceneQ.error.message}.{" "}
          <button className="underline" onClick={() => sceneQ.refetch()}>
            Try again
          </button>
        </EmptyState>
      </Panel>
    );

  if (mode === "wall") {
    if (!scene)
      return (
        <div className="fixed inset-0 z-[950] grid place-items-center bg-[#01040c]">
          <GlobeLoading />
        </div>
      );
    return <WallMode Globe={webgl === false ? (FallbackAsGlobe as unknown as React.ComponentType<GlobeProps>) : Globe} scene={scene} hotspots={hotspots} timeline={timeline} reduced={reduced} dwellSec={dwell} onExit={() => router.push(pathname)} />;
  }

  const empty = scene && !scene.assets.length && !scene.districts.length;

  return (
    <div className="-mx-1 space-y-4 md:mx-0">
      {/* Stage */}
      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/15 bg-[#01040c] shadow-[0_0_60px_-20px_rgba(56,189,248,0.35)] lg:h-[calc(100dvh-8.5rem)] lg:min-h-[640px]" data-testid="twin-stage">
        <div className="relative h-[62dvh] min-h-[380px] lg:absolute lg:inset-0 lg:h-auto" onMouseLeave={() => setHover(null)}>
          {!scene || webgl === null ? (
            <GlobeLoading />
          ) : webgl && !empty ? (
            <GlobeBoundary fallback={<FallbackMap scene={scene} assetScores={assetScores} districtScores={districtScores} layers={layers} onSelect={select} timeMs={timeMs} />}>
              <Globe
                scene={scene}
                assetScores={assetScores}
                districtScores={districtScores}
                timeMs={timeMs}
                layers={layers}
                selected={selected}
                onSelect={select}
                onHover={setHover}
                fly={fly}
                reducedMotion={reduced}
                initialView={initialView}
                fpsRef={fpsRef}
              />
            </GlobeBoundary>
          ) : empty ? (
            <div className="grid h-full place-items-center">
              <EmptyState icon={Globe2} title="Nothing to show on the globe yet">
                Add assets in <Link href="/app/portfolio/import" className="text-cyan-300 underline">Portfolio → Import</Link> and they will appear here with live risk.
              </EmptyState>
            </div>
          ) : (
            <>
              <FallbackMap scene={scene} assetScores={assetScores} districtScores={districtScores} layers={layers} onSelect={select} timeMs={timeMs} />
              <div className="absolute left-1/2 top-16 z-[600] -translate-x-1/2 rounded-full border border-amber-500/30 bg-[#060a16]/90 px-3 py-1 text-[11px] text-amber-200">
                3D view unavailable on this device — showing the 2D map
              </div>
            </>
          )}
          <div className="scanlines pointer-events-none absolute inset-0 opacity-30" />
          <HoverTip tip={hover} />

          {/* top bar */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-[#01040c] via-[#01040c]/70 to-transparent px-3 pb-6 pt-3">
            <div className="pointer-events-auto flex flex-wrap items-center gap-2">
              <div className="mr-2 min-w-0">
                <div className="hud-label text-cyan-300/80">Monitor · Earth Twin</div>
                <h1 className="truncate font-display text-lg font-semibold text-white md:text-xl">{scene?.org.name ?? "Loading…"}</h1>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <button type="button" onClick={() => setRailOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12px] text-slate-200 hover:bg-white/10 lg:hidden" aria-expanded={railOpen}>
                  <Layers size={13} /> Layers
                </button>
                <button type="button" onClick={resetView} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12px] text-slate-200 hover:bg-white/10" title="Back to your region">
                  <Crosshair size={13} /> <span className="hidden sm:inline">Reset view</span>
                </button>
                <button type="button" onClick={copyLink} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12px] text-slate-200 hover:bg-white/10" title="Copy a link to this view">
                  <Link2 size={13} /> <span className="hidden sm:inline">Share</span>
                </button>
                <Link href={`${pathname}?mode=wall`} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-1.5 text-[12px] font-medium text-cyan-100 hover:bg-cyan-500/25" title="Full-screen auto-tour for ops-room screens (W)">
                  <MonitorPlay size={13} /> Wall mode
                </Link>
              </div>
            </div>
            {scene && (
              <div className="pointer-events-auto mt-2 rounded-lg border border-white/5 bg-[#030814]/70 py-1 backdrop-blur">
                <Ticker items={ticker} onPick={(s) => select(s)} reduced={reduced} />
              </div>
            )}
          </div>

          {/* left rail */}
          {scene && (
            <div className={`absolute left-3 top-[118px] z-10 w-[232px] ${railOpen ? "block" : "hidden"} lg:block`}>
              <LayerRail layers={layers} setLayer={setLayer} scene={scene} fpsRef={fpsRef} />
              <div className="mt-2 hidden lg:block">
                <FeedChips scene={scene} timeline={timeline} />
              </div>
            </div>
          )}
        </div>

        {/* right drawer */}
        {scene && selected && (
          <>
            <DetailDrawer
              sel={selected}
              ctx={{ scene, timeline, assetScores, districtScores, dayIndex, offset, onSelect: (s) => select(s) }}
              className="fixed inset-x-2 bottom-2 z-[950] flex max-h-[70dvh] flex-col lg:absolute lg:inset-x-auto lg:bottom-[256px] lg:right-3 lg:top-[118px] lg:z-20 lg:max-h-none lg:w-[340px]"
            />
          </>
        )}

        {/* bottom: KPIs + time machine */}
        {scene && (
          <div className="relative z-10 space-y-2 p-2 lg:absolute lg:inset-x-0 lg:bottom-0 lg:bg-gradient-to-t lg:from-[#01040c] lg:via-[#01040c]/80 lg:to-transparent lg:p-3 lg:pt-10">
            <KpiStrip scene={scene} view={kpiView} offset={offset} />
            <TimeMachine timeline={timeline} offset={offset} setOffset={setOffset} nowMs={nowMs} reduced={reduced} loading={tlQ.isLoading} />
          </div>
        )}
      </div>

      {/* Below the stage: briefing, hotspots, sources */}
      {scene && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="What this means for you" icon={Sparkles} accent="emerald" className="lg:col-span-1">
            <p className="text-sm leading-relaxed text-slate-200" data-testid="twin-summary">
              {scene.summary}
            </p>
            <ul className="mt-3 space-y-1.5 text-[12px] text-slate-400">
              <li>• Pillars are your {scene.assets.length ? scene.org.assetNoun : "districts"}: taller = more money (or farms) at stake, colour = <Explain term="composite_score">risk score</Explain>.</li>
              <li>• Drag the time machine back to replay the last 30 days, forward to see the 16-day outlook.</li>
              <li>• Click anything on the globe for numbers, a plain-language read-out and links to act.</li>
            </ul>
            <div className="mt-3 lg:hidden">
              <FeedChips scene={scene} timeline={timeline} />
            </div>
          </Panel>
          <Panel title="Hotspots right now" subtitle="Ranked by severity × what you have at stake × how recent" icon={Compass} accent="amber" className="lg:col-span-2" actions={<button type="button" onClick={() => hsQ.refetch()} className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Refresh hotspots"><RefreshCw size={13} className={hsQ.isFetching ? "animate-spin" : ""} /></button>}>
            {hsQ.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-800/50" />
                ))}
              </div>
            ) : hotspots.length ? (
              <ol className="divide-y divide-white/5" data-testid="twin-hotspots">
                {hotspots.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 py-2">
                    <span className="telemetry w-6 text-xs text-slate-500">{String(h.rank).padStart(2, "0")}</span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: riskColor(h.severity), boxShadow: `0 0 10px ${riskColor(h.severity)}` }} />
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => select(h.kind === "facility" || h.kind === "asset" ? { kind: "asset", id: h.targetId } : { kind: h.kind === "district" ? "district" : h.kind === "hazard" ? "hazard" : "cyclone", id: h.targetId })}>
                      <div className="truncate text-[13px] text-slate-100 hover:text-white">{h.caption}</div>
                      <div className="telemetry text-[10.5px] uppercase tracking-wider text-slate-500">
                        {h.kind} · score {h.score}
                      </div>
                    </button>
                    <Link href={h.href} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-cyan-300 hover:bg-cyan-500/10">
                      Act →
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon={Compass} title="No hotspots — all quiet">
                Nothing in your footprint is above normal pressure right now.
              </EmptyState>
            )}
          </Panel>
          <div className="flex flex-wrap items-center gap-1.5 lg:col-span-3">
            <span className="hud-label mr-1">Sources</span>
            <SourceTag href="https://www.gdacs.org">GDACS (UN / EU JRC)</SourceTag>
            <SourceTag href="https://eonet.gsfc.nasa.gov">NASA EONET</SourceTag>
            <SourceTag href="https://www.ncei.noaa.gov/products/international-best-track-archive">NOAA IBTrACS v04r01</SourceTag>
            <SourceTag>GloFAS / ERA5 flood episodes 2019-2026</SourceTag>
            <SourceTag href="https://www.geoboundaries.org">geoBoundaries</SourceTag>
            <SourceTag>NASA GIBS land mask</SourceTag>
            <SourceTag>Agri-SHIELD portfolio scores</SourceTag>
            <span className="ml-auto hidden text-[11px] text-slate-500 md:inline">
              Keys: <kbd className="telemetry">[</kbd>/<kbd className="telemetry">]</kbd> day · <kbd className="telemetry">Esc</kbd> close · <kbd className="telemetry">W</kbd> wall mode
            </span>
          </div>
        </div>
      )}
      {selected && <button type="button" className="sr-only" onClick={() => select(null, { fly: false })}><X /> Close details</button>}
    </div>
  );
}

/** Wall mode without WebGL: the 2D map in the Globe slot. */
function FallbackAsGlobe(p: GlobeProps) {
  return (
    <div className={p.className}>
      <FallbackMap scene={p.scene} assetScores={p.assetScores} districtScores={p.districtScores} layers={p.layers} onSelect={p.onSelect} timeMs={p.timeMs} />
    </div>
  );
}
