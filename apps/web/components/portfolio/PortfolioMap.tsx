"use client";

/**
 * Portfolio map: grid-clustered markers coloured by risk level (cluster colour
 * = worst level inside), click a cluster to zoom, click an asset to open it,
 * "Select area" box-select for bulk tagging, optional click-to-place mode.
 * Always import via next/dynamic({ ssr:false }).
 */
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { BoxSelect, Crosshair, Maximize2 } from "lucide-react";
import BaseMap from "@/components/maps/BaseMap";
import { LEVEL_COLOR, TYPE_LABEL, fmtUsd } from "./format";

export interface MapPoint {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  composite: number;
  level: string;
  valueUsd: number;
  driver?: string;
}

const RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export default function PortfolioMap({
  points,
  center,
  zoom = 6,
  height = 480,
  selectedIds,
  onOpen,
  onBoxSelect,
  pickMode = false,
  onPick,
  picked,
}: {
  points: MapPoint[];
  center?: [number, number] | null;
  zoom?: number;
  height?: number | string;
  selectedIds?: Set<string>;
  onOpen?: (id: string) => void;
  onBoxSelect?: (ids: string[]) => void;
  pickMode?: boolean;
  onPick?: (lat: number, lon: number) => void;
  picked?: { lat: number; lon: number } | null;
}) {
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const pickRef = useRef<Leaflet.Marker | null>(null);
  const fittedRef = useRef(false);
  const [ready, setReady] = useState(0);
  const [boxMode, setBoxMode] = useState(false);
  const cb = useRef({ onOpen, onBoxSelect, onPick, pickMode, boxMode, points });
  cb.current = { onOpen, onBoxSelect, onPick, pickMode, boxMode, points };

  // Draw / redraw clusters
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    const draw = () => {
      layerRef.current?.remove();
      const group = L.layerGroup().addTo(map);
      layerRef.current = group;
      const z = map.getZoom();
      const cell = z >= 11 ? 0 : 56;
      const buckets = new Map<string, MapPoint[]>();
      for (const p of points) {
        const px = map.project([p.lat, p.lon], z);
        const key = cell ? `${Math.floor(px.x / cell)}:${Math.floor(px.y / cell)}` : p.id;
        const arr = buckets.get(key);
        if (arr) arr.push(p);
        else buckets.set(key, [p]);
      }
      for (const arr of buckets.values()) {
        if (arr.length === 1) {
          const p = arr[0]!;
          const sel = selectedIds?.has(p.id);
          const m = L.circleMarker([p.lat, p.lon], {
            radius: sel ? 8 : 6,
            color: sel ? "#ffffff" : LEVEL_COLOR[p.level] ?? "#4ade80",
            weight: sel ? 2.5 : 1.5,
            fillColor: LEVEL_COLOR[p.level] ?? "#4ade80",
            fillOpacity: 0.85,
          }).addTo(group);
          m.bindTooltip(
            `<div style="font:12px Inter,sans-serif"><b>${esc(p.name)}</b><br/><span style="color:#94a3b8">${TYPE_LABEL[p.type] ?? p.type} · ${fmtUsd(p.valueUsd)}</span><br/>Risk <b style="color:${LEVEL_COLOR[p.level]}">${p.composite}/100 ${p.level.toUpperCase()}</b>${p.driver ? `<br/><span style="color:#94a3b8">${esc(p.driver)}</span>` : ""}</div>`,
            { direction: "top", offset: [0, -6] }
          );
          m.on("click", () => cb.current.onOpen?.(p.id));
          continue;
        }
        const lat = arr.reduce((s, p) => s + p.lat, 0) / arr.length;
        const lon = arr.reduce((s, p) => s + p.lon, 0) / arr.length;
        const worst = arr.reduce((w, p) => (RANK[p.level]! > RANK[w]! ? p.level : w), "low");
        const c = LEVEL_COLOR[worst]!;
        const size = Math.min(54, 26 + Math.log2(arr.length) * 5);
        const counts = { low: 0, medium: 0, high: 0, critical: 0 } as Record<string, number>;
        for (const p of arr) counts[p.level] = (counts[p.level] ?? 0) + 1;
        const nSel = selectedIds ? arr.filter((p) => selectedIds.has(p.id)).length : 0;
        const icon = L.divIcon({
          className: "",
          iconSize: [size, size],
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;display:grid;place-items:center;background:${c}33;border:2px solid ${nSel ? "#fff" : c};box-shadow:0 0 16px ${c}88;color:#fff;font:600 12px 'JetBrains Mono',monospace">${arr.length}</div>`,
        });
        const m = L.marker([lat, lon], { icon }).addTo(group);
        m.bindTooltip(
          `<div style="font:12px Inter,sans-serif"><b>${arr.length} assets</b> · ${fmtUsd(arr.reduce((s, p) => s + p.valueUsd, 0))}<br/>${(["critical", "high", "medium", "low"] as const)
            .filter((l) => counts[l])
            .map((l) => `<span style="color:${LEVEL_COLOR[l]}">${counts[l]} ${l}</span>`)
            .join(" · ")}${nSel ? `<br/>${nSel} selected` : ""}<br/><span style="color:#94a3b8">Click to zoom in</span></div>`,
          { direction: "top" }
        );
        m.on("click", () => {
          const b = L.latLngBounds(arr.map((p) => [p.lat, p.lon] as [number, number]));
          map.fitBounds(b.pad(0.3), { maxZoom: 13 });
        });
      }
    };
    draw();
    if (!fittedRef.current && points.length) {
      fittedRef.current = true;
      const b = L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]));
      if (b.isValid()) map.fitBounds(b.pad(0.15), { maxZoom: 10 });
    }
    map.on("zoomend", draw);
    return () => {
      map.off("zoomend", draw);
    };
  }, [points, selectedIds, ready]);

  // Picked location marker
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    pickRef.current?.remove();
    pickRef.current = null;
    if (picked) {
      pickRef.current = L.marker([picked.lat, picked.lon], {
        icon: L.divIcon({ className: "", iconSize: [22, 22], html: `<div style="width:22px;height:22px;border-radius:50%;border:3px solid #38bdf8;background:#38bdf855;box-shadow:0 0 18px #38bdf8"></div>` }),
      }).addTo(map);
    }
  }, [picked, ready]);

  // Box select: drag a rectangle while boxMode is on
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    if (!boxMode) {
      map.dragging.enable();
      map.getContainer().style.cursor = cb.current.pickMode ? "crosshair" : "";
      return;
    }
    map.dragging.disable();
    map.getContainer().style.cursor = "crosshair";
    let start: Leaflet.LatLng | null = null;
    let rect: Leaflet.Rectangle | null = null;
    const down = (e: Leaflet.LeafletMouseEvent) => {
      start = e.latlng;
      rect = L.rectangle(L.latLngBounds(start, start), { color: "#38bdf8", weight: 1.5, dashArray: "4 4", fillOpacity: 0.08 }).addTo(map);
    };
    const move = (e: Leaflet.LeafletMouseEvent) => {
      if (start && rect) rect.setBounds(L.latLngBounds(start, e.latlng));
    };
    const up = (e: Leaflet.LeafletMouseEvent) => {
      if (!start) return;
      const b = L.latLngBounds(start, e.latlng);
      rect?.remove();
      start = null;
      rect = null;
      const ids = cb.current.points.filter((p) => b.contains([p.lat, p.lon])).map((p) => p.id);
      cb.current.onBoxSelect?.(ids);
      setBoxMode(false);
    };
    map.on("mousedown", down);
    map.on("mousemove", move);
    map.on("mouseup", up);
    return () => {
      map.off("mousedown", down);
      map.off("mousemove", move);
      map.off("mouseup", up);
      rect?.remove();
      map.dragging.enable();
      map.getContainer().style.cursor = "";
    };
  }, [boxMode, ready]);

  useEffect(() => {
    const el = mapRef.current?.getContainer();
    if (el) el.style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode, ready]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/5" style={{ height }}>
      <BaseMap
        center={center ?? [15, 95]}
        zoom={zoom}
        onReady={(map, L) => {
          mapRef.current = map;
          LRef.current = L;
          map.on("click", (e: Leaflet.LeafletMouseEvent) => {
            if (cb.current.pickMode && !cb.current.boxMode) cb.current.onPick?.(Math.round(e.latlng.lat * 1e5) / 1e5, Math.round(((((e.latlng.lng + 180) % 360) + 360) % 360 - 180) * 1e5) / 1e5);
          });
          setReady((r) => r + 1);
          return () => {
            mapRef.current = null;
          };
        }}
      />
      <div className="absolute left-12 top-2.5 z-[500] flex gap-1.5">
        {onBoxSelect && (
          <button
            type="button"
            onClick={() => setBoxMode((b) => !b)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] backdrop-blur ${boxMode ? "border-sky-400 bg-sky-400 text-slate-950" : "border-white/10 bg-[#060a16]/85 text-slate-200 hover:border-sky-400/60"}`}
            title="Drag a rectangle on the map to select assets"
          >
            <BoxSelect size={13} /> {boxMode ? "Drag to select…" : "Select area"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const map = mapRef.current;
            const L = LRef.current;
            if (!map || !L || !points.length) return;
            map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number])).pad(0.15), { maxZoom: 11 });
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#060a16]/85 px-2.5 py-1.5 text-[11px] text-slate-200 backdrop-blur hover:border-sky-400/60"
          title="Zoom to all assets"
        >
          <Maximize2 size={13} /> Fit
        </button>
        {pickMode && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/50 bg-sky-400/15 px-2.5 py-1.5 text-[11px] text-sky-200 backdrop-blur">
            <Crosshair size={13} /> Click the map to place the asset
          </span>
        )}
      </div>
    </div>
  );
}
