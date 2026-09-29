"use client";

/**
 * Alternative-supplier map: affected producing regions, unaffected candidate
 * regions (sized by weekly surplus), routes to the receiving hub and the
 * rest of the commodity network. Load through next/dynamic({ ssr:false }).
 */
import { useEffect, useState } from "react";
import type * as Leaflet from "leaflet";
import BaseMap from "@/components/maps/BaseMap";
import { riskColor } from "@/components/hud";
import type { RouterOutputs } from "@/lib/trpc";
import { MAP_CSS, arcLatLngs } from "./NetworkMap";
import { fmtT, nodeGlyph } from "./theme";

type Alt = RouterOutputs["supplyChain"]["getAlternativeSuppliers"];

const STATUS_COLOR: Record<string, string> = { available: "#4ade80", watch: "#fbbf24", constrained: "#f87171" };
const MODE_DASH: Record<string, string> = { road: "2 6", river_barge: "8 6", short_sea: "14 8" };

export default function ProcurementMap({ data, highlight, onPick, height = 480 }: { data: Alt; highlight?: string | null; onPick?: (id: string) => void; height?: number }) {
  const [ctx, setCtx] = useState<{ map: Leaflet.Map; L: typeof Leaflet } | null>(null);

  useEffect(() => {
    if (!ctx) return;
    const { map, L } = ctx;
    const g = L.layerGroup().addTo(map);
    const svg = L.svg({ padding: 0.4 });
    const dest: [number, number] = [data.destination.lat, data.destination.lon];

    for (const n of data.nodes) {
      if (n.id === data.destination.id) continue;
      L.marker([n.lat, n.lon], { icon: L.divIcon({ className: "", html: `<div style="opacity:.55">${nodeGlyph(n.type, riskColor(n.floodRisk), 12, n.owned)}</div>`, iconSize: [12, 12], iconAnchor: [6, 6] }) })
        .bindTooltip(`${n.name}`, { className: "sc-tip", direction: "top" })
        .addTo(g);
    }

    const maxCap = Math.max(1, ...data.alternatives.map((a) => a.weeklyCapacityTonnes));
    data.alternatives.forEach((a, i) => {
      const c = STATUS_COLOR[a.status] ?? "#94a3b8";
      const top = i < 3 && a.status !== "constrained";
      const hl = highlight === a.districtId;
      if (a.status !== "constrained") {
        L.polyline(arcLatLngs([a.lat, a.lon], dest, 0.14), { renderer: svg, color: c, weight: hl ? 3.5 : top ? 2.5 : 1.2, opacity: hl || top ? 0.9 : 0.35, dashArray: MODE_DASH[a.mode], className: top || hl ? "sc-flow" : undefined })
          .bindTooltip(`<b>${a.name} → ${data.destination.name}</b><br/>${a.modeLabel} · ${a.distanceKm.toLocaleString()} km · lead ${a.leadTimeDays} d · ${a.freightUsdPerT} USD/t freight`, { sticky: true, className: "sc-tip" })
          .addTo(g);
      }
      const r = 7 + Math.sqrt(a.weeklyCapacityTonnes / maxCap) * 16;
      L.circleMarker([a.lat, a.lon], { renderer: svg, radius: r, color: c, weight: hl ? 3 : 1.5, fillColor: c, fillOpacity: 0.22 })
        .bindTooltip(
          `<b>${a.name}, ${a.country}</b> · <span style="color:${c}">${a.status.toUpperCase()}</span><br/>risk ${a.risk} · surplus ${fmtT(a.weeklyCapacityTonnes)}/wk · covers ${a.coverPct}%<br/>lead ${a.leadTimeDays} d · landed ${a.landedCostUsdPerT} USD/t${a.qualityFlag ? `<br/><span style="color:#fbbf24">⚑ ${a.qualityFlag}</span>` : ""}`,
          { className: "sc-tip", direction: "top" }
        )
        .on("click", () => onPick?.(a.districtId))
        .addTo(g);
      if (top) L.marker([a.lat, a.lon], { icon: L.divIcon({ className: "", html: `<div style="font:700 11px var(--font-mono);color:#060a16;background:${c};border-radius:9px;padding:0 5px;box-shadow:0 0 10px ${c}">${i + 1}</div>`, iconSize: [18, 14], iconAnchor: [9, r + 12] }), interactive: false }).addTo(g);
    });

    for (const a of data.affected) {
      L.circleMarker([a.lat, a.lon], { renderer: svg, radius: 14, color: "#ef4444", weight: 2, fillColor: "#ef4444", fillOpacity: 0.25, className: "sc-flow-hot" })
        .bindTooltip(`<b>${a.name}</b> — affected<br/>risk ${a.risk} · ${fmtT(a.atRiskTonnes)} at risk`, { className: "sc-tip", direction: "top" })
        .addTo(g);
    }

    L.marker(dest, {
      icon: L.divIcon({ className: "", html: `<div class="sc-pin" style="--c:#f59e0b;width:26px;height:26px"><span class="sc-pulse"></span>${nodeGlyph(data.destination.type, "#f59e0b", 26, true)}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      zIndexOffset: 2000,
    })
      .bindTooltip(`<b>${data.destination.name}</b><br/>receiving hub · ${data.destination.country}`, { className: "sc-tip", direction: "top" })
      .addTo(g);

    const pts: [number, number][] = [dest, ...data.affected.map((a) => [a.lat, a.lon] as [number, number]), ...data.alternatives.slice(0, 6).map((a) => [a.lat, a.lon] as [number, number])];
    map.fitBounds(L.latLngBounds(pts).pad(0.2), { animate: true });
    return () => {
      g.remove();
    };
  }, [ctx, data, highlight, onPick]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-800/80" style={{ height }}>
      <style>{MAP_CSS}</style>
      <BaseMap center={[15, 100]} zoom={4} className="relative h-full w-full" onReady={(map, L) => {
          setTimeout(() => (map.invalidateSize(), setCtx({ map, L })), 80);
        }} />
    </div>
  );
}
