"use client";

/**
 * Field boundary drawing on satellite imagery (Leaflet via BaseMap).
 * Tap to add vertices; parent owns the vertex list, undo/finish and saved fields.
 * Load with next/dynamic({ ssr:false }).
 */
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import BaseMap from "@/components/maps/BaseMap";

export interface DrawnField {
  key: string;
  name: string;
  polygon: [number, number][]; // [lon, lat]
}

export default function FieldDrawMap({
  center,
  zoom = 15,
  fields,
  drawing,
  onAddPoint,
  flyTo,
}: {
  center: [number, number];
  zoom?: number;
  fields: DrawnField[];
  drawing: [number, number][];
  onAddPoint: (p: [number, number]) => void;
  /** change the object identity to fly the map somewhere */
  flyTo?: { lat: number; lon: number; zoom?: number } | null;
}) {
  const [ready, setReady] = useState<{ map: Leaflet.Map; L: typeof Leaflet } | null>(null);
  const addRef = useRef(onAddPoint);
  addRef.current = onAddPoint;
  const saved = useRef<Leaflet.LayerGroup | null>(null);
  const draft = useRef<Leaflet.LayerGroup | null>(null);

  useEffect(() => {
    if (!ready) return;
    const { map, L } = ready;
    saved.current?.remove();
    const g = L.featureGroup();
    fields.forEach((f, i) => {
      L.polygon(f.polygon.map(([lon, lat]) => [lat, lon] as [number, number]), { color: "#10b981", weight: 2, fillColor: "#10b981", fillOpacity: 0.25 })
        .bindTooltip(`${i + 1}. ${f.name.replace(/[<>&]/g, "")}`, { permanent: true, direction: "center", className: "!bg-transparent !border-0 !shadow-none !text-white !font-semibold" })
        .addTo(g);
    });
    g.addTo(map);
    saved.current = g;
  }, [ready, fields]);

  useEffect(() => {
    if (!ready) return;
    const { map, L } = ready;
    draft.current?.remove();
    const g = L.layerGroup();
    const pts = drawing.map(([lon, lat]) => [lat, lon] as [number, number]);
    if (pts.length >= 2) L.polyline(pts, { color: "#fbbf24", weight: 2, dashArray: "5 5" }).addTo(g);
    if (pts.length >= 3) L.polygon(pts, { color: "#fbbf24", weight: 0, fillColor: "#fbbf24", fillOpacity: 0.18 }).addTo(g);
    pts.forEach((p, i) => L.circleMarker(p, { radius: i === 0 ? 7 : 5, color: "#fff", weight: 2, fillColor: i === 0 ? "#f59e0b" : "#fbbf24", fillOpacity: 1 }).addTo(g));
    g.addTo(map);
    draft.current = g;
  }, [ready, drawing]);

  useEffect(() => {
    if (ready && flyTo) ready.map.flyTo([flyTo.lat, flyTo.lon], flyTo.zoom ?? 16, { duration: 1.2 });
  }, [ready, flyTo]);

  return (
    <BaseMap
      center={center}
      zoom={zoom}
      basemap="satellite"
      className="relative h-full w-full"
      onReady={(map, L) => {
        map.getContainer().style.cursor = "crosshair";
        map.on("click", (e: Leaflet.LeafletMouseEvent) => addRef.current([Math.round(e.latlng.lng * 1e6) / 1e6, Math.round(e.latlng.lat * 1e6) / 1e6]));
        setReady({ map, L });
      }}
    />
  );
}
