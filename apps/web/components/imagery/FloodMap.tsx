"use client";

/**
 * Portfolio flood map: MODIS true colour + MODIS Combined Flood 2-Day for the
 * chosen date, with every asset coloured by its sampled flood verdict.
 * Load with next/dynamic (ssr:false).
 */
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { gibsTemplate } from "./tile-math";

export interface FloodMarker {
  id: string;
  lat: number;
  lon: number;
  name: string;
  color: string;
  label: string;
  emphasis?: boolean;
}

const LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";

export default function FloodMap({ date, markers, center, zoom = 7, height = 460, selected, onSelect }: { date: string; markers: FloodMarker[]; center: [number, number]; zoom?: number; height?: number; selected?: string | null; onSelect?: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layers = useRef<Leaflet.TileLayer[]>([]);
  const group = useRef<Leaflet.LayerGroup | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const selRef = useRef(onSelect);
  selRef.current = onSelect;

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    import("leaflet").then((mod) => {
      const L = (mod.default ?? mod) as typeof Leaflet;
      if (disposed || !el.current) return;
      LRef.current = L;
      const m = L.map(el.current, { center, zoom, maxZoom: 13, minZoom: 2, worldCopyJump: true });
      map.current = m;
      m.createPane("labels").style.zIndex = "380";
      m.getPane("labels")!.style.pointerEvents = "none";
      L.tileLayer(LABELS, { maxNativeZoom: 16, maxZoom: 13, pane: "labels" }).addTo(m);
      L.control.scale({ imperial: false, position: "bottomleft" }).addTo(m);
      ro = new ResizeObserver(() => m.invalidateSize({ pan: false }));
      ro.observe(el.current);
      requestAnimationFrame(() => !disposed && setReady(true));
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const L = LRef.current;
    const m = map.current;
    if (!L || !m) return;
    layers.current.forEach((l) => l.remove());
    layers.current = [
      L.tileLayer(gibsTemplate("modis_tc", date), { maxNativeZoom: 9, maxZoom: 13, attribution: "NASA EOSDIS GIBS · MODIS Terra", opacity: 0.85, crossOrigin: "anonymous" }),
      L.tileLayer(gibsTemplate("modis_flood", date), { maxNativeZoom: 9, maxZoom: 13, attribution: "MODIS Combined Flood 2-Day", crossOrigin: "anonymous" }),
    ].map((l) => l.addTo(m));
  }, [ready, date]);

  useEffect(() => {
    const L = LRef.current;
    const m = map.current;
    if (!L || !m) return;
    group.current?.remove();
    const g = L.layerGroup();
    const sorted = [...markers].sort((a, b) => Number(!!a.emphasis) - Number(!!b.emphasis));
    for (const mk of sorted) {
      const isSel = mk.id === selected;
      const c = L.circleMarker([mk.lat, mk.lon], { radius: isSel ? 9 : mk.emphasis ? 7 : 5, color: isSel ? "#ffffff" : "#020617", weight: isSel ? 2.5 : 1.5, fillColor: mk.color, fillOpacity: 0.95 });
      c.bindTooltip(`<b>${mk.name.replace(/</g, "&lt;")}</b><br/>${mk.label}`, { direction: "top", offset: [0, -4] });
      c.on("click", () => selRef.current?.(mk.id));
      c.addTo(g);
    }
    g.addTo(m);
    group.current = g;
    if (!fitted.current && markers.length) {
      fitted.current = true;
      m.fitBounds(L.latLngBounds(markers.map((x) => [x.lat, x.lon] as [number, number])).pad(0.15), { maxZoom: 9 });
    }
  }, [ready, markers, selected]);

  useEffect(() => {
    const m = map.current;
    const mk = markers.find((x) => x.id === selected);
    if (m && mk) m.setView([mk.lat, mk.lon], Math.max(m.getZoom(), 10), { animate: true });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950" style={{ height }}>
      <div ref={el} className="absolute inset-0" />
      <div className="pointer-events-none absolute right-2 top-2 z-[500] rounded-lg border border-white/10 bg-[#050b18]/85 px-2.5 py-2 text-[10px] text-slate-300 backdrop-blur">
        <div className="hud-label mb-1 text-cyan-300">MODIS pixels · {date}</div>
        {[
          ["#fa1e24", "Flood"],
          ["#ffff00", "Recurring flood"],
          ["#32d2f5", "Normal water"],
          ["#afafaf", "Cloud / no data"],
        ].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm" style={{ background: c }} />
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
