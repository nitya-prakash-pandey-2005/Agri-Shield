"use client";

/**
 * Before/after satellite comparison on Leaflet (load with next/dynamic, ssr:false).
 *
 *  swipe — both layers on one map; the "after" pane is CSS-clipped to the
 *          right of a draggable divider (clip rect recomputed in layer-point
 *          space on every move/zoom/resize so it stays glued to the screen).
 *  blend — "after" drawn over "before" with adjustable opacity.
 *  side  — two synced maps (pan/zoom either one).
 *
 * Transparent overlay layers (MODIS flood) are drawn over the same-day MODIS
 * true colour so the water sits on a real picture.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { LAYERS, gibsTemplate, type LayerId } from "./tile-math";

export interface Side {
  layer: LayerId;
  date: string;
}
export interface Marker {
  id: string;
  lat: number;
  lon: number;
  name: string;
  color?: string;
}

const DARK = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";

function sideLayers(L: typeof Leaflet, s: Side, pane: string): Leaflet.TileLayer[] {
  const l = LAYERS[s.layer];
  const opts = (maxNativeZoom: number, attribution: string): Leaflet.TileLayerOptions => ({ pane, maxNativeZoom, maxZoom: 15, attribution, crossOrigin: "anonymous", bounds: [[-85, -180], [85, 180]] });
  const out: Leaflet.TileLayer[] = [];
  if (l.overlay) out.push(L.tileLayer(gibsTemplate("modis_tc", s.date), opts(9, "NASA GIBS MODIS")));
  out.push(L.tileLayer(gibsTemplate(s.layer, s.date), opts(l.level, `NASA EOSDIS GIBS · ${l.short}`)));
  return out;
}

function makeMap(L: typeof Leaflet, el: HTMLElement, center: [number, number], zoom: number) {
  const map = L.map(el, { center, zoom, zoomControl: true, attributionControl: true, maxZoom: 15, minZoom: 2, worldCopyJump: true });
  L.tileLayer(DARK, { maxNativeZoom: 16, maxZoom: 15, attribution: "Esri" }).addTo(map);
  for (const [name, z] of [
    ["before", 250],
    ["after", 260],
    ["labels", 380],
  ] as const) {
    map.createPane(name).style.zIndex = String(z);
  }
  map.getPane("labels")!.style.pointerEvents = "none";
  L.tileLayer(LABELS, { maxNativeZoom: 16, maxZoom: 15, pane: "labels" }).addTo(map);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
  return map;
}

export default function SwipeMap({
  center,
  zoom = 10,
  before,
  after,
  mode,
  opacity = 0.6,
  markers = [],
  focus,
  onPick,
  height = 520,
}: {
  center: [number, number];
  zoom?: number;
  before: Side;
  after: Side;
  mode: "swipe" | "blend" | "side";
  opacity?: number;
  markers?: Marker[];
  focus?: { lat: number; lon: number; zoom?: number; key: string } | null;
  onPick?: (lat: number, lon: number, markerId?: string) => void;
  height?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const elA = useRef<HTMLDivElement>(null);
  const elB = useRef<HTMLDivElement>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const mapA = useRef<Leaflet.Map | null>(null);
  const mapB = useRef<Leaflet.Map | null>(null);
  const layersA = useRef<{ before: Leaflet.TileLayer[]; after: Leaflet.TileLayer[] }>({ before: [], after: [] });
  const layersB = useRef<Leaflet.TileLayer[]>([]);
  const markerLayers = useRef<Leaflet.LayerGroup[]>([]);
  const [ready, setReady] = useState(0);
  const [ratio, setRatio] = useState(0.5);
  const ratioRef = useRef(0.5);
  ratioRef.current = ratio;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  const updateClip = useCallback(() => {
    const map = mapA.current;
    if (!map) return;
    const pane = map.getPane("after");
    if (!pane) return;
    if (mode !== "swipe") {
      pane.style.clip = "";
      return;
    }
    const size = map.getSize();
    const nw = map.containerPointToLayerPoint([0, 0]);
    const se = map.containerPointToLayerPoint(size);
    const x = nw.x + size.x * ratioRef.current;
    pane.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`;
  }, [mode]);

  // create map(s)
  useEffect(() => {
    let disposed = false;
    const ros: ResizeObserver[] = [];
    import("leaflet").then((mod) => {
      const L = (mod.default ?? mod) as typeof Leaflet;
      if (disposed || !elA.current) return;
      LRef.current = L;
      const a = makeMap(L, elA.current, center, zoom);
      mapA.current = a;
      a.on("click", (e: Leaflet.LeafletMouseEvent) => pickRef.current?.(e.latlng.lat, e.latlng.lng));
      if (elB.current) {
        const b = makeMap(L, elB.current, center, zoom);
        mapB.current = b;
        b.on("click", (e: Leaflet.LeafletMouseEvent) => pickRef.current?.(e.latlng.lat, e.latlng.lng));
        let syncing = false;
        const sync = (from: Leaflet.Map, to: Leaflet.Map) => () => {
          if (syncing) return;
          syncing = true;
          to.setView(from.getCenter(), from.getZoom(), { animate: false });
          syncing = false;
        };
        a.on("move", sync(a, b));
        b.on("move", sync(b, a));
      }
      for (const [m, el] of [
        [a, elA.current],
        [mapB.current, elB.current],
      ] as const) {
        if (!m || !el) continue;
        const ro = new ResizeObserver(() => m.invalidateSize({ pan: false }));
        ro.observe(el);
        ros.push(ro);
      }
      requestAnimationFrame(() => !disposed && setReady((n) => n + 1));
    });
    return () => {
      disposed = true;
      ros.forEach((r) => r.disconnect());
      mapA.current?.remove();
      mapB.current?.remove();
      mapA.current = null;
      mapB.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode === "side"]);

  // layers
  useEffect(() => {
    const L = LRef.current;
    const a = mapA.current;
    if (!L || !a) return;
    layersA.current.before.forEach((l) => l.remove());
    layersA.current.after.forEach((l) => l.remove());
    layersB.current.forEach((l) => l.remove());
    layersA.current.before = sideLayers(L, before, "before").map((l) => l.addTo(a));
    if (mode === "side" && mapB.current) {
      layersA.current.after = [];
      layersB.current = sideLayers(L, after, "before").map((l) => l.addTo(mapB.current!));
    } else {
      layersB.current = [];
      layersA.current.after = sideLayers(L, after, "after").map((l) => l.addTo(a));
    }
  }, [ready, before.layer, before.date, after.layer, after.date, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // blend opacity + clip
  useEffect(() => {
    const a = mapA.current;
    if (!a) return;
    const pane = a.getPane("after");
    if (pane) pane.style.opacity = mode === "blend" ? String(opacity) : "1";
    updateClip();
    a.on("move zoom zoomend resize viewreset", updateClip);
    return () => {
      a.off("move zoom zoomend resize viewreset", updateClip);
    };
  }, [ready, mode, opacity, updateClip]);
  useEffect(updateClip, [ratio, updateClip]);

  // markers
  useEffect(() => {
    const L = LRef.current;
    if (!L || !mapA.current) return;
    markerLayers.current.forEach((g) => g.remove());
    markerLayers.current = [];
    for (const m of [mapA.current, mapB.current]) {
      if (!m) continue;
      const g = L.layerGroup();
      for (const mk of markers) {
        const c = L.circleMarker([mk.lat, mk.lon], { radius: 5, color: "#0b1224", weight: 1.5, fillColor: mk.color ?? "#22d3ee", fillOpacity: 0.95, pane: "markerPane" });
        c.bindTooltip(mk.name, { direction: "top", offset: [0, -4] });
        c.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          pickRef.current?.(mk.lat, mk.lon, mk.id);
        });
        c.addTo(g);
      }
      g.addTo(m);
      markerLayers.current.push(g);
    }
  }, [ready, markers]);

  // focus
  useEffect(() => {
    if (!focus || !mapA.current) return;
    mapA.current.setView([focus.lat, focus.lon], focus.zoom ?? mapA.current.getZoom(), { animate: true });
  }, [ready, focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // divider drag
  const dragging = useRef(false);
  const setFromClientX = (clientX: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    setRatio(Math.min(0.98, Math.max(0.02, (clientX - r.left) / r.width)));
  };

  return (
    <div ref={wrap} className="relative w-full overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950" style={{ height }}>
      {mode === "side" ? (
        <div className="grid h-full grid-cols-2 gap-px bg-slate-800">
          <div className="relative">
            <div ref={elA} className="absolute inset-0" />
            <SideLabel side="left" prefix={LAYERS[before.layer].short} date={before.date} />
          </div>
          <div className="relative">
            <div ref={elB} className="absolute inset-0" />
            <SideLabel side="right" prefix={LAYERS[after.layer].short} date={after.date} />
          </div>
        </div>
      ) : (
        <>
          <div ref={elA} className="absolute inset-0" />
          <SideLabel side="left" prefix={`Before · ${LAYERS[before.layer].short}`} date={before.date} />
          <SideLabel side="right" prefix={`After · ${LAYERS[after.layer].short}`} date={after.date} />
        </>
      )}
      {mode === "swipe" && (
        <div
          className="absolute inset-y-0 z-[600] w-0"
          style={{ left: `${ratio * 100}%` }}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => dragging.current && setFromClientX(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          <div className="absolute inset-y-0 -left-px w-0.5 bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
          <button
            type="button"
            role="slider"
            aria-label="Swipe position — arrow keys move the divider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.02;
              if (e.key === "ArrowLeft") setRatio((r) => Math.max(0.02, r - step));
              else if (e.key === "ArrowRight") setRatio((r) => Math.min(0.98, r + step));
              else if (e.key === "Home") setRatio(0.02);
              else if (e.key === "End") setRatio(0.98);
              else return;
              e.preventDefault();
            }}
            className="absolute top-1/2 -left-4 grid h-8 w-8 -translate-y-1/2 cursor-ew-resize touch-none place-items-center rounded-full border border-cyan-300/80 bg-[#06101f]/90 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.6)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M6 3 2 8l4 5M10 3l4 5-4 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 z-[550] rounded-xl shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12),inset_0_0_60px_rgba(2,6,23,0.6)]" />
    </div>
  );
}

function SideLabel({ side, prefix, date }: { side: "left" | "right"; prefix: string; date: string }) {
  return (
    <div className={`pointer-events-none absolute top-2 z-[560] max-w-[45%] truncate rounded-md border border-cyan-400/30 bg-[#050b18]/85 px-2 py-1 text-[10px] telemetry uppercase tracking-wider text-cyan-200 backdrop-blur ${side === "left" ? "left-12" : "right-2"}`}>
      <span className="hidden sm:inline">{prefix} · </span>
      {date}
    </div>
  );
}
