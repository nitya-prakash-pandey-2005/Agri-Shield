"use client";

/**
 * Click-to-pick location map (Leaflet via BaseMap). Draws the chosen point,
 * optional context points (e.g. insured plots) and an optional overlay tile
 * layer (e.g. NASA GIBS observed-flood for a date). Load with next/dynamic({ ssr:false }).
 */
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import BaseMap from "@/components/maps/BaseMap";

export interface MapDot {
  lat: number;
  lon: number;
  color: string;
  radius?: number;
  label?: string;
  id?: string;
}

export default function LocationMap({
  point,
  onPick,
  dots = [],
  overlayUrl,
  height = 260,
  zoom = 8,
  onDotClick,
  fit,
}: {
  point?: { lat: number; lon: number } | null;
  onPick?: (lat: number, lon: number) => void;
  dots?: MapDot[];
  overlayUrl?: string | null;
  height?: number;
  zoom?: number;
  onDotClick?: (id: string) => void;
  /** fit the map to the dots on change */
  fit?: boolean;
}) {
  const [ctx, setCtx] = useState<{ map: Leaflet.Map; L: typeof Leaflet } | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const dotRef = useRef(onDotClick);
  dotRef.current = onDotClick;

  useEffect(() => {
    if (!ctx) return;
    const h = (e: Leaflet.LeafletMouseEvent) => pickRef.current?.(Math.round(e.latlng.lat * 10000) / 10000, Math.round(e.latlng.lng * 10000) / 10000);
    ctx.map.on("click", h);
    return () => {
      ctx.map.off("click", h);
    };
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    const { map, L } = ctx;
    const g = L.layerGroup().addTo(map);
    for (const d of dots) {
      const m = L.circleMarker([d.lat, d.lon], { radius: d.radius ?? 5, color: d.color, weight: 1.5, fillColor: d.color, fillOpacity: 0.35 });
      if (d.label) m.bindTooltip(d.label, { direction: "top" });
      if (d.id) m.on("click", (ev) => {
        L.DomEvent.stopPropagation(ev);
        dotRef.current?.(d.id!);
      });
      m.addTo(g);
    }
    if (point) {
      L.circleMarker([point.lat, point.lon], { radius: 9, color: "#22d3ee", weight: 3, fillColor: "#22d3ee", fillOpacity: 0.25 }).addTo(g);
      L.circleMarker([point.lat, point.lon], { radius: 2.5, color: "#fff", weight: 0, fillColor: "#fff", fillOpacity: 1 }).addTo(g);
    }
    if (fit && dots.length > 1) map.fitBounds(L.latLngBounds(dots.map((d) => [d.lat, d.lon] as [number, number])).pad(0.15), { animate: false });
    else if (point) map.setView([point.lat, point.lon], Math.max(map.getZoom(), zoom), { animate: true });
    return () => {
      g.remove();
    };
  }, [ctx, dots, point, fit, zoom]);

  useEffect(() => {
    if (!ctx || !overlayUrl) return;
    const layer = ctx.L.tileLayer(overlayUrl, { maxNativeZoom: 9, maxZoom: 18, opacity: 0.65 }).addTo(ctx.map);
    return () => {
      layer.remove();
    };
  }, [ctx, overlayUrl]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-800/80" style={{ height }}>
      <BaseMap center={point ? [point.lat, point.lon] : [22.9, 89.9]} zoom={zoom} onReady={(map, L) => setCtx({ map, L })} />
    </div>
  );
}
