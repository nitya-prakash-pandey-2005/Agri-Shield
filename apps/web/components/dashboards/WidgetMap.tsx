"use client";

/**
 * Map widget (Leaflet, client-only). Assets as dots coloured by the chosen
 * metric, or districts as a choropleth. Tiles are requested with CORS so the
 * dashboard PNG/PDF export can include the basemap.
 */
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import type { MapData } from "@/server/services/widget-data";
import { fmtValue } from "./format";

const SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
const LEVEL = (v: number) => (v >= 80 ? "#a78bfa" : v >= 60 ? "#f87171" : v >= 35 ? "#fbbf24" : "#4ade80");

export function colorScale(data: Pick<MapData, "unit" | "metric">, values: number[]) {
  if (data.metric === "change7d") return (v: number) => (v >= 5 ? "#f87171" : v >= 1 ? "#fca5a5" : v <= -5 ? "#34d399" : v <= -1 ? "#a7f3d0" : "#94a3b8");
  if (data.unit === "score") return LEVEL;
  const sorted = [...values].sort((a, b) => a - b);
  return (v: number) => {
    if (!sorted.length) return SEQ[3]!;
    let lo = 0;
    while (lo < sorted.length && sorted[lo]! < v) lo++;
    const q = lo / Math.max(1, sorted.length - 1);
    return SEQ[Math.min(SEQ.length - 1, Math.floor(q * SEQ.length))]!;
  };
}

export default function WidgetMap({ data, interactive = true, linkAssets = true }: { data: MapData; interactive?: boolean; linkAssets?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    import("leaflet").then((mod) => {
      const L = (mod.default ?? mod) as typeof Leaflet;
      if (disposed || !el.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(el.current, { center: data.center ?? [20, 90], zoom: 6, zoomControl: interactive, attributionControl: true, preferCanvas: true, scrollWheelZoom: false, dragging: interactive });
      mapRef.current = map;
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 18, crossOrigin: "anonymous", attribution: "Esri" }).addTo(map);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 18, crossOrigin: "anonymous", pane: "shadowPane" }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      ro = new ResizeObserver(() => map.invalidateSize({ pan: false }));
      ro.observe(el.current);
      draw();
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = layerRef.current;
    if (!L || !map || !group) return;
    group.clearLayers();
    const bounds: [number, number][] = [];
    if (data.mode === "choropleth") {
      const color = colorScale(data, data.districts.map((d) => d.value));
      for (const d of data.districts) {
        const gj = L.geoJSON({ type: "Feature", properties: {}, geometry: d.geometry } as never, {
          style: { color: "#0f172a", weight: 1, fillColor: color(d.value), fillOpacity: 0.62 },
        });
        gj.bindTooltip(`<b>${escapeHtml(d.name)}</b><br/>${fmtValue(d.value, data.unit)}${d.assets ? ` · ${d.assets} asset${d.assets === 1 ? "" : "s"}` : " · district live risk"}`, { sticky: true });
        gj.addTo(group);
        for (const ring of d.geometry.coordinates) for (const [lon, lat] of ring) bounds.push([lat!, lon!]);
      }
    } else {
      const color = colorScale(data, data.points.map((p) => p.value));
      const sorted = [...data.points].sort((a, b) => a.value - b.value); // worst on top
      for (const p of sorted) {
        const m = L.circleMarker([p.lat, p.lon], { radius: 5.5, color: "#0b1224", weight: 1.5, fillColor: color(p.value), fillOpacity: 0.95 });
        m.bindTooltip(`<b>${escapeHtml(p.name)}</b><br/>${fmtValue(p.value, data.unit)}`, { direction: "top" });
        if (interactive && linkAssets) m.on("click", () => window.open(`/app/portfolio?asset=${encodeURIComponent(p.id)}`, "_self"));
        m.addTo(group);
        bounds.push([p.lat, p.lon]);
      }
    }
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.08), { maxZoom: 9, animate: false });
  };

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return <div ref={el} className="absolute inset-0 rounded-lg" />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
