"use client";

/**
 * 2D fallback for devices without WebGL (or ?renderer=2d): same data, Leaflet map.
 * Author: Nitya Prakash Pandey
 */
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { TwinScene } from "@/server/services/twin";
import type { LayerState, Selection } from "./Globe";
import { categoryColor, hazardColor, riskHexStr } from "./geo";

const BaseMap = dynamic(() => import("@/components/maps/BaseMap"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-slate-900" /> });

export default function FallbackMap({ scene, assetScores, districtScores, layers, onSelect, timeMs }: { scene: TwinScene; assetScores: number[]; districtScores: number[]; layers: LayerState; onSelect: (s: Selection | null) => void; timeMs: number }) {
  const ref = useRef<{ map: Leaflet.Map; L: typeof Leaflet; group: Leaflet.LayerGroup } | null>(null);
  const [ready, setReady] = useState(0);
  const sel = useRef(onSelect);
  sel.current = onSelect;

  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    const { L, group } = r;
    group.clearLayers();
    if (layers.districts)
      scene.districts.forEach((d, i) => {
        const c = riskHexStr(districtScores[i] ?? d.composite);
        L.polygon(
          d.ring.map(([lon, lat]) => [lat, lon] as [number, number]),
          { color: c, weight: 1.5, fillColor: c, fillOpacity: 0.25 }
        )
          .bindTooltip(`${d.name} · risk ${Math.round(districtScores[i] ?? d.composite)}/100`)
          .on("click", () => sel.current({ kind: "district", id: d.id }))
          .addTo(group);
      });
    if (layers.cyclones)
      for (const t of scene.tracks) {
        for (let i = 1; i < t.points.length; i++) {
          const a = t.points[i - 1]!;
          const b = t.points[i]!;
          if (Math.abs(a[2] - b[2]) > 180) continue;
          L.polyline([[a[1], a[2]], [b[1], b[2]]], { color: categoryColor(b[4]), weight: 2, opacity: Date.parse(t.start) > timeMs ? 0.15 : 0.7 })
            .on("click", () => sel.current({ kind: "cyclone", id: t.id }))
            .addTo(group);
        }
      }
    if (layers.flows)
      for (const f of scene.flows)
        L.polyline([[f.from.lat, f.from.lon], [f.to.lat, f.to.lon]], { color: "#fde68a", weight: 1 + Math.sqrt(f.tonnesPerWeek) / 30, opacity: 0.6, dashArray: "4 6" })
          .on("click", () => sel.current({ kind: "flow", id: f.id }))
          .addTo(group);
    if (layers.assets)
      scene.assets.forEach((a, i) => {
        const s = assetScores[i] ?? a.score;
        L.circleMarker([a.lat, a.lon], { radius: 3 + Math.sqrt(a.valueUsd) / 400, color: riskHexStr(s), weight: 1, fillOpacity: 0.85 })
          .bindTooltip(`${a.name} · risk ${Math.round(s)}/100`)
          .on("click", () => sel.current({ kind: "asset", id: a.id }))
          .addTo(group);
      });
    if (layers.hazards)
      for (const h of scene.hazards)
        if (Date.parse(h.date) <= timeMs + 86_400_000)
          L.circleMarker([h.lat, h.lon], { radius: 9, color: hazardColor(h.alertLevel, h.type), weight: 2, fillOpacity: 0.15 })
            .bindTooltip(h.title)
            .on("click", () => sel.current({ kind: "hazard", id: h.id }))
            .addTo(group);
  }, [ready, scene, assetScores, districtScores, layers, timeMs]);

  return (
    <BaseMap
      center={scene.org.center}
      zoom={scene.districts.length > 10 ? 4 : 6}
      className="absolute inset-0"
      onReady={(map, L) => {
        const group = L.layerGroup().addTo(map);
        ref.current = { map, L, group };
        const pts = [...scene.assets.map((a) => [a.lat, a.lon] as [number, number]), ...scene.districts.map((d) => [d.lat, d.lon] as [number, number])];
        if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
        setReady((n) => n + 1);
        return () => {
          group.remove();
          ref.current = null;
        };
      }}
    />
  );
}
