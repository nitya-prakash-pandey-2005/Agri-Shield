"use client";

/**
 * Compact portfolio map for Home: one dot per asset, coloured by composite
 * risk, sized by value. Click a dot for details; "Open portfolio" for more.
 */
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import { riskColor } from "@/components/hud";

const BaseMap = dynamic(() => import("@/components/maps/BaseMap"), { ssr: false, loading: () => <div className="skeleton h-full w-full rounded-xl" /> });

export interface MiniMapPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  composite: number;
  level: string;
  valueUsd: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function MiniMap({ points, center, zoom, className, onSelect }: { points: MiniMapPoint[]; center: [number, number]; zoom: number; className?: string; onSelect?: (id: string) => void }) {
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  const draw = () => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    layerRef.current?.remove();
    const g = L.layerGroup();
    const maxV = Math.max(1, ...points.map((p) => p.valueUsd));
    for (const p of [...points].sort((a, b) => a.composite - b.composite)) {
      const c = riskColor(p.composite);
      const m = L.circleMarker([p.lat, p.lon], { radius: 3.5 + Math.sqrt(p.valueUsd / maxV) * 6, color: c, weight: 1, fillColor: c, fillOpacity: 0.75 });
      m.bindPopup(`<div style="font:12px Inter,sans-serif"><b>${esc(p.name)}</b><br/>Composite risk <b style="color:${c}">${p.composite}/100</b><br/>Value $${p.valueUsd.toLocaleString("en-US")}</div>`);
      m.on("click", () => selectRef.current?.(p.id));
      m.addTo(g);
    }
    g.addTo(map);
    layerRef.current = g;
    if (points.length > 1) {
      const b = L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]));
      map.fitBounds(b.pad(0.15), { maxZoom: 9, animate: false });
    }
  };

  useEffect(draw, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={className}>
      <BaseMap
        center={center}
        zoom={zoom}
        showBasemapSwitcher={false}
        className="h-full w-full"
        onReady={(map, L) => {
          mapRef.current = map;
          LRef.current = L;
          draw();
        }}
      />
    </div>
  );
}
