"use client";

/**
 * Leaflet map for incidents: affected areas (circle / polygon), asset dots coloured by live
 * score, incident beacons, and an edit mode to draw the affected area (click to place a
 * circle centre, or click vertices for a polygon). Import via next/dynamic({ ssr:false }).
 */
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import BaseMap from "@/components/maps/BaseMap";
import type { IncidentArea } from "./meta";

export interface MapArea {
  id: string;
  area: IncidentArea;
  color: string;
  label?: string;
}

export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  color: string;
  label: string;
  /** px radius; beacons pulse */
  size?: number;
  beacon?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export default function IncidentMap({
  areas = [],
  points = [],
  center,
  zoom = 7,
  height = 360,
  onPointClick,
  edit,
  fitKey,
}: {
  areas?: MapArea[];
  points?: MapPoint[];
  center: [number, number];
  zoom?: number;
  height?: number | string;
  onPointClick?: (id: string) => void;
  edit?: { mode: "circle" | "polygon"; area: IncidentArea | null; onChange: (a: IncidentArea | null) => void; radiusKm: number };
  /** Change to re-fit the view to the content */
  fitKey?: string;
}) {
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const editLayer = useRef<Leaflet.LayerGroup | null>(null);
  const [ready, setReady] = useState(0);
  const cb = useRef({ onPointClick, edit });
  cb.current = { onPointClick, edit };
  const fitted = useRef<string | null>(null);

  // Content layer
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    layer.current?.remove();
    const g = L.layerGroup().addTo(map);
    layer.current = g;
    const bounds: [number, number][] = [];
    for (const a of areas) {
      const opts = { color: a.color, weight: 1.6, fillColor: a.color, fillOpacity: 0.12, dashArray: "6 4" };
      const shape = a.area.type === "circle" ? L.circle([a.area.lat, a.area.lon], { ...opts, radius: a.area.radiusKm * 1000 }) : L.polygon(a.area.coords, opts);
      if (a.label) shape.bindTooltip(esc(a.label), { sticky: true, className: "incident-tip" });
      shape.addTo(g);
      const b = shape.getBounds();
      bounds.push([b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]);
    }
    for (const p of points) {
      const size = p.size ?? 7;
      if (p.beacon) {
        const icon = L.divIcon({
          className: "",
          iconSize: [size * 4, size * 4],
          html: `<div style="position:relative;width:${size * 4}px;height:${size * 4}px"><span style="position:absolute;inset:0;border-radius:9999px;border:2px solid ${p.color};animation:incPing 1.8s ease-out infinite"></span><span style="position:absolute;left:50%;top:50%;width:${size * 1.6}px;height:${size * 1.6}px;margin:-${size * 0.8}px 0 0 -${size * 0.8}px;border-radius:9999px;background:${p.color};box-shadow:0 0 14px ${p.color}"></span></div>`,
        });
        const m = L.marker([p.lat, p.lon], { icon }).addTo(g);
        m.bindTooltip(p.label, { direction: "top", offset: [0, -size], className: "incident-tip" });
        m.on("click", () => cb.current.onPointClick?.(p.id));
      } else {
        const m = L.circleMarker([p.lat, p.lon], { radius: size, color: "#020617", weight: 1, fillColor: p.color, fillOpacity: 0.95 }).addTo(g);
        m.bindTooltip(p.label, { direction: "top", className: "incident-tip" });
        m.on("click", () => cb.current.onPointClick?.(p.id));
      }
      bounds.push([p.lat, p.lon]);
    }
    const key = fitKey ?? `${areas.length}:${points.length}`;
    if (bounds.length && fitted.current !== key) {
      fitted.current = key;
      if (bounds.length === 1) map.setView(bounds[0]!, Math.max(map.getZoom(), 9));
      else map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 11 });
    }
  }, [areas, points, ready, fitKey]);

  // Edit layer (draft area + vertices)
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    editLayer.current?.remove();
    if (!edit) return;
    const g = L.layerGroup().addTo(map);
    editLayer.current = g;
    const a = edit.area;
    const style = { color: "#f472b6", weight: 2, fillColor: "#f472b6", fillOpacity: 0.12 };
    if (a?.type === "circle") L.circle([a.lat, a.lon], { ...style, radius: a.radiusKm * 1000 }).addTo(g);
    if (a?.type === "polygon") {
      if (a.coords.length >= 3) L.polygon(a.coords, style).addTo(g);
      else if (a.coords.length === 2) L.polyline(a.coords, style).addTo(g);
      a.coords.forEach((c) => L.circleMarker(c, { radius: 4, color: "#f472b6", fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(g));
    }
    map.getContainer().style.cursor = "crosshair";
    return () => {
      map.getContainer().style.cursor = "";
    };
  }, [edit, ready]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/5" style={{ height }}>
      <style>{`@keyframes incPing{0%{transform:scale(.45);opacity:.9}100%{transform:scale(1);opacity:0}} .incident-tip{background:#081225;color:#e2e8f0;border:1px solid rgba(56,189,248,.35);font-size:11px;border-radius:6px} .incident-tip:before{display:none}`}</style>
      <BaseMap
        center={center}
        zoom={zoom}
        onReady={(map, L) => {
          mapRef.current = map;
          LRef.current = L;
          map.on("click", (e: Leaflet.LeafletMouseEvent) => {
            const ed = cb.current.edit;
            if (!ed) return;
            const lat = +e.latlng.lat.toFixed(5);
            const lon = +e.latlng.lng.toFixed(5);
            if (ed.mode === "circle") ed.onChange({ type: "circle", lat, lon, radiusKm: ed.radiusKm });
            else ed.onChange({ type: "polygon", coords: [...(ed.area?.type === "polygon" ? ed.area.coords : []), [lat, lon]] });
          });
          setReady((r) => r + 1);
          return () => {
            mapRef.current = null;
          };
        }}
      />
    </div>
  );
}
