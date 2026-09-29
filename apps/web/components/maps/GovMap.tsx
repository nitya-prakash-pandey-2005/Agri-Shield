"use client";

/**
 * Government operations map (Leaflet via the shared BaseMap).
 * Draws district polygons coloured by the active layer, live hazard markers
 * (GDACS / NASA EONET), resource depots with coverage radii, dispatch routes,
 * and supports multi-select + free-hand polygon drawing for alert targeting.
 *
 * Always import with next/dynamic({ ssr: false }).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type * as Leaflet from "leaflet";
import BaseMap, { RAIN_OVERLAY } from "./BaseMap";

export interface GovMapDistrict {
  id: string;
  name: string;
  geometry: { type: "Polygon"; coordinates: number[][][] };
  lat: number;
  lon: number;
  color: string;
  fillOpacity?: number;
  tooltip: string;
  label?: string;
  pulse?: boolean;
}

export interface GovMapHazard {
  id: string;
  lat: number;
  lon: number;
  title: string;
  type: string;
  source: string;
  alertLevel: string | null;
  date: string;
  url: string | null;
  distanceKm?: number;
  nearestDistrict?: string;
}

export interface GovMapDepot {
  name: string;
  lat: number;
  lon: number;
  coverageKm: number;
  html: string;
  color?: string;
  dim?: boolean;
}

export interface GovMapRoute {
  id: string;
  from: [number, number];
  to: [number, number];
  color: string;
  label?: string;
}

const HAZARD_COLOR: Record<string, string> = { flood: "#38bdf8", cyclone: "#c084fc", storm: "#a78bfa", drought: "#f59e0b", other: "#94a3b8" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export default function GovMap({
  center,
  zoom = 7,
  districts,
  selectedIds,
  highlightId,
  onDistrictClick,
  hazards,
  depots,
  routes,
  drawMode = false,
  onPolygonComplete,
  fitKey,
  showRain = false,
  className = "relative h-full w-full",
  children,
}: {
  center: [number, number];
  zoom?: number;
  districts: GovMapDistrict[];
  selectedIds?: string[];
  highlightId?: string | null;
  onDistrictClick?: (id: string) => void;
  hazards?: GovMapHazard[];
  depots?: GovMapDepot[];
  routes?: GovMapRoute[];
  drawMode?: boolean;
  onPolygonComplete?: (ringLonLat: [number, number][]) => void;
  fitKey?: string;
  showRain?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [ml, setMl] = useState<{ map: Leaflet.Map; L: typeof Leaflet } | null>(null);
  const groups = useRef<Record<string, Leaflet.LayerGroup>>({});
  const clickRef = useRef(onDistrictClick);
  clickRef.current = onDistrictClick;
  const drawRef = useRef(drawMode);
  drawRef.current = drawMode;
  const completeRef = useRef(onPolygonComplete);
  completeRef.current = onPolygonComplete;
  const [vertices, setVertices] = useState<[number, number][]>([]); // lat, lon

  const group = (key: string) => {
    if (!ml) return null;
    if (!groups.current[key]) groups.current[key] = ml.L.layerGroup().addTo(ml.map);
    return groups.current[key]!;
  };

  // District polygons
  useEffect(() => {
    const g = group("districts");
    if (!ml || !g) return;
    const { L } = ml;
    g.clearLayers();
    const sel = new Set(selectedIds ?? []);
    for (const d of districts) {
      const latlngs = d.geometry.coordinates[0]!.map(([lon, lat]) => [lat!, lon!] as [number, number]);
      const selected = sel.has(d.id) || highlightId === d.id;
      const base = {
        color: selected ? "#ecfdf5" : d.color,
        weight: selected ? 2.6 : 1.2,
        opacity: selected ? 1 : 0.85,
        fillColor: d.color,
        fillOpacity: (d.fillOpacity ?? 0.38) + (selected ? 0.14 : 0),
        dashArray: selected ? undefined : "3 3",
      };
      const poly = L.polygon(latlngs, base);
      poly.bindTooltip(d.tooltip, { sticky: true, className: "gov-tip", direction: "top", offset: [0, -8] });
      poly.on("mouseover", () => poly.setStyle({ weight: 2.8, fillOpacity: base.fillOpacity + 0.15, color: "#ffffff", dashArray: undefined }));
      poly.on("mouseout", () => poly.setStyle(base));
      poly.on("click", () => {
        if (!drawRef.current) clickRef.current?.(d.id);
      });
      poly.addTo(g);
      if (d.label) {
        L.marker([d.lat, d.lon], {
          interactive: false,
          icon: L.divIcon({ className: "", html: `<div class="gov-label">${esc(d.label)}</div>`, iconSize: [0, 0] }),
        }).addTo(g);
      }
      if (d.pulse) {
        L.marker([d.lat, d.lon], { interactive: false, icon: L.divIcon({ className: "", html: `<span class="gov-pulse" style="--c:${d.color}"></span>`, iconSize: [0, 0] }) }).addTo(g);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ml, districts, selectedIds?.join(","), highlightId]);

  // Fit to districts when the jurisdiction changes
  useEffect(() => {
    if (!ml || !districts.length) return;
    const b = ml.L.latLngBounds(districts.flatMap((d) => d.geometry.coordinates[0]!.map(([lon, lat]) => [lat!, lon!] as [number, number])));
    ml.map.fitBounds(b, { padding: [30, 30], maxZoom: 9 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ml, fitKey]);

  // Hazards
  useEffect(() => {
    const g = group("hazards");
    if (!ml || !g) return;
    const { L } = ml;
    g.clearLayers();
    for (const h of hazards ?? []) {
      const c = h.alertLevel === "red" ? "#ef4444" : h.alertLevel === "orange" ? "#f97316" : HAZARD_COLOR[h.type] ?? "#94a3b8";
      const m = L.marker([h.lat, h.lon], {
        icon: L.divIcon({ className: "", html: `<span class="gov-hazard" style="--c:${c}"><i></i></span>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 800,
      });
      m.bindPopup(
        `<div style="min-width:210px;font-size:12px">
          <div style="font:600 10px var(--font-mono),monospace;letter-spacing:.12em;color:${c};text-transform:uppercase">${esc(h.source)} · ${esc(h.type)}${h.alertLevel ? ` · ${esc(h.alertLevel)}` : ""}</div>
          <div style="margin:4px 0 6px;font-weight:600;color:#fff">${esc(h.title)}</div>
          <div style="color:#94a3b8">${new Date(h.date).toUTCString().slice(0, 22)} UTC</div>
          ${h.nearestDistrict ? `<div style="color:#94a3b8">${h.distanceKm?.toLocaleString()} km from ${esc(h.nearestDistrict)}</div>` : ""}
          ${h.url ? `<a href="${esc(h.url)}" target="_blank" rel="noreferrer" style="color:#34d399">Source report ↗</a>` : ""}
        </div>`
      );
      m.addTo(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ml, hazards]);

  // Depots + coverage
  useEffect(() => {
    const g = group("depots");
    if (!ml || !g) return;
    const { L } = ml;
    g.clearLayers();
    for (const d of depots ?? []) {
      const c = d.color ?? "#10b981";
      L.circle([d.lat, d.lon], { radius: d.coverageKm * 1000, color: c, weight: 1, opacity: d.dim ? 0.3 : 0.7, dashArray: "4 4", fillColor: c, fillOpacity: d.dim ? 0.03 : 0.07, interactive: false }).addTo(g);
      const m = L.marker([d.lat, d.lon], { icon: L.divIcon({ className: "", html: `<span class="gov-depot" style="--c:${c};opacity:${d.dim ? 0.5 : 1}"></span>`, iconSize: [14, 14], iconAnchor: [7, 7] }), zIndexOffset: 600 });
      m.bindPopup(d.html);
      m.addTo(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ml, depots]);

  // Routes (SVG renderer so the dash animation runs)
  useEffect(() => {
    const g = group("routes");
    if (!ml || !g) return;
    const { L } = ml;
    g.clearLayers();
    const svg = L.svg();
    for (const r of routes ?? []) {
      const line = L.polyline([r.from, r.to], { color: r.color, weight: 2.5, opacity: 0.95, dashArray: "8 8", className: "gov-route", renderer: svg });
      if (r.label) line.bindTooltip(r.label, { className: "gov-tip", sticky: true });
      line.addTo(g);
      L.circleMarker(r.to, { radius: 4, color: r.color, fillColor: r.color, fillOpacity: 1, weight: 1 }).addTo(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ml, routes]);

  // Rain overlay (NASA GPM IMERG)
  useEffect(() => {
    const g = group("rain");
    if (!ml || !g) return;
    g.clearLayers();
    if (showRain) ml.L.tileLayer(RAIN_OVERLAY.url, { attribution: RAIN_OVERLAY.attribution, maxNativeZoom: RAIN_OVERLAY.maxNativeZoom, opacity: 0.55 }).addTo(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ml, showRain]);

  // Polygon drawing
  useEffect(() => {
    if (!ml) return;
    const { map } = ml;
    if (drawMode) {
      map.doubleClickZoom.disable();
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = "";
      setVertices([]);
    }
    const onClick = (e: Leaflet.LeafletMouseEvent) => {
      if (!drawRef.current) return;
      setVertices((v) => [...v, [e.latlng.lat, e.latlng.lng]]);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [ml, drawMode]);

  useEffect(() => {
    const g = group("draw");
    if (!ml || !g) return;
    const { L } = ml;
    g.clearLayers();
    if (!vertices.length) return;
    if (vertices.length >= 3) L.polygon(vertices, { color: "#34d399", weight: 2, dashArray: "6 4", fillColor: "#34d399", fillOpacity: 0.12, interactive: false }).addTo(g);
    else L.polyline(vertices, { color: "#34d399", weight: 2, dashArray: "6 4", interactive: false }).addTo(g);
    vertices.forEach((v, i) => L.circleMarker(v, { radius: i === 0 ? 6 : 4, color: "#ecfdf5", weight: 2, fillColor: "#10b981", fillOpacity: 1, interactive: false }).addTo(g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ml, vertices]);

  const finish = () => {
    if (vertices.length < 3) return;
    completeRef.current?.(vertices.map(([lat, lon]) => [lon, lat]));
    setVertices([]);
  };

  return (
    <div className={className}>
      <style>{`
        .gov-tip{background:rgba(6,10,22,.94)!important;border:1px solid rgba(148,163,184,.25)!important;color:#e2e8f0!important;border-radius:10px!important;box-shadow:0 12px 30px -10px rgba(0,0,0,.8)!important;padding:8px 10px!important;font-size:11.5px;line-height:1.45}
        .gov-tip::before{display:none}
        .gov-label{transform:translate(-50%,-50%);white-space:nowrap;font:600 10px var(--font-mono),monospace;letter-spacing:.08em;color:#f1f5f9;text-shadow:0 1px 3px #000,0 0 8px #000;pointer-events:none;text-transform:uppercase}
        .gov-pulse{position:absolute;left:-22px;top:-22px;width:44px;height:44px;border-radius:9999px;border:2px solid var(--c);animation:govpulse 2.2s ease-out infinite;pointer-events:none}
        @keyframes govpulse{0%{transform:scale(.35);opacity:.9}100%{transform:scale(1.6);opacity:0}}
        .gov-hazard{position:relative;display:block;width:18px;height:18px}
        .gov-hazard i{position:absolute;inset:4px;border-radius:9999px;background:var(--c);box-shadow:0 0 12px var(--c)}
        .gov-hazard::after{content:"";position:absolute;inset:-6px;border-radius:9999px;border:1.5px solid var(--c);animation:govpulse 1.8s ease-out infinite}
        .gov-depot{display:block;width:14px;height:14px;transform:rotate(45deg);background:var(--c);border:2px solid #ecfdf5;box-shadow:0 0 12px var(--c)}
        .gov-route{animation:govdash 1s linear infinite}
        @keyframes govdash{to{stroke-dashoffset:-16}}
      `}</style>
      <BaseMap center={center} zoom={zoom} onReady={(map, L) => setMl({ map, L })} />
      {drawMode && (
        <div className="absolute left-1/2 top-3 z-[600] -translate-x-1/2 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-[#060a16]/90 px-3 py-1.5 text-[11px] text-slate-200 backdrop-blur">
          <span className="telemetry text-emerald-300">DRAW</span>
          <span className="text-slate-400">Click to add vertices ({vertices.length})</span>
          <button onClick={() => setVertices((v) => v.slice(0, -1))} disabled={!vertices.length} className="rounded px-2 py-0.5 text-slate-300 hover:bg-white/10 disabled:opacity-40">
            Undo
          </button>
          <button onClick={finish} disabled={vertices.length < 3} className="rounded bg-emerald-500 px-2 py-0.5 font-semibold text-slate-950 disabled:opacity-40">
            Select districts
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
