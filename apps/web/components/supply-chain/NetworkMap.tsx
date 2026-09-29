"use client";

/**
 * Supply-chain network map: node pins (shape = type, colour = composite risk,
 * filled = owned), animated commodity flow arcs weighted by tonnes/week,
 * district risk footprints and live GDACS / NASA EONET hazard markers.
 * Always load through next/dynamic({ ssr:false }).
 */
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import BaseMap from "@/components/maps/BaseMap";
import { riskColor } from "@/components/hud";
import type { RouterOutputs } from "@/lib/trpc";
import { commodityColor, fmtT, fmtUsd, nodeGlyph } from "./theme";

type Network = RouterOutputs["supplyChain"]["getNetwork"];

export const MAP_CSS = `
.sc-flow { stroke-dasharray: 5 9; animation: sc-dash 1.4s linear infinite; }
.sc-flow-hot { stroke-dasharray: 4 6; animation: sc-dash 0.8s linear infinite; }
@keyframes sc-dash { to { stroke-dashoffset: -28; } }
.sc-pin { position: relative; display: grid; place-items: center; filter: drop-shadow(0 0 6px rgba(0,0,0,.6)); transition: transform .15s; }
.sc-pin:hover { transform: scale(1.18); }
.sc-pin-sel { transform: scale(1.3); }
.sc-pulse { position:absolute; inset:-9px; border-radius:9999px; border:2px solid var(--c); animation: sc-ping 1.8s cubic-bezier(0,0,.2,1) infinite; }
@keyframes sc-ping { 0% { transform: scale(.55); opacity:.9 } 100% { transform: scale(1.35); opacity:0 } }
.sc-hz { width:18px; height:18px; display:grid; place-items:center; border-radius:4px; font: 700 11px var(--font-mono), monospace; color:#060a16; box-shadow: 0 0 12px var(--c); }
.sc-popup .leaflet-popup-content { margin: 10px 12px; min-width: 250px; }
.leaflet-tooltip.sc-tip { background: rgba(8,13,28,.96); border: 1px solid rgba(148,163,184,.25); color: #e2e8f0; border-radius: 10px; padding: 8px 10px; box-shadow: 0 10px 30px -10px rgba(0,0,0,.8); font-size: 11.5px; line-height: 1.45; }
.leaflet-tooltip.sc-tip::before { display: none; }
.sc-open { margin-top: 9px; width: 100%; border-radius: 7px; padding: 6px 8px; background: #f59e0b; color: #060a16; font-weight: 600; font-size: 11.5px; cursor: pointer; border: 0; }
.sc-open:hover { background: #fbbf24; }
.sc-bar { height:5px; border-radius:3px; background: rgba(148,163,184,.15); overflow:hidden; }
.sc-bar > span { display:block; height:100%; border-radius:3px; }
`;

/** Quadratic arc between two points so parallel flows stay legible. */
export function arcLatLngs(a: [number, number], b: [number, number], bend = 0.16, n = 28): [number, number][] {
  const [x1, y1] = [a[1], a[0]];
  const [x2, y2] = [b[1], b[0]];
  const mx = (x1 + x2) / 2 - (y2 - y1) * bend;
  const my = (y1 + y2) / 2 + (x2 - x1) * bend;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const x = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * mx + t * t * x2;
    const y = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * my + t * t * y2;
    return [y, x];
  });
}

function popupHtml(n: Network["nodes"][number]) {
  const bars = n.factors
    .map(
      (f) => `<div style="margin-top:6px">
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:#94a3b8"><span>${f.label} <span style="color:#64748b">×${f.weight}</span></span><span style="font-family:var(--font-mono);color:#e2e8f0">${f.value} → ${f.contribution}</span></div>
        <div class="sc-bar"><span style="width:${f.value}%;background:${riskColor(f.value)}"></span></div>
      </div>`
    )
    .join("");
  return `<div style="font-family:var(--font-inter)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div><div style="font-weight:600;color:#fff;font-size:13px">${n.name}</div>
      <div style="font-size:10.5px;color:#94a3b8">${n.typeLabel} · ${n.districtName}, ${n.country}${n.owned ? "" : " · partner"}</div></div>
      <div style="text-align:right"><div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:${riskColor(n.composite)}">${n.composite}</div><div style="font-size:9px;letter-spacing:.12em;color:#64748b">COMPOSITE</div></div>
    </div>
    ${bars}
    <div style="margin-top:8px;display:flex;gap:10px;font-size:10.5px;color:#94a3b8;font-family:var(--font-mono)">
      <span>INV ${fmtT(n.inventoryTonnes)}</span><span>${fmtUsd(n.inventoryValueUsd)}</span><span>${n.utilizationPct}% util</span>
    </div>
    <div style="margin-top:4px;font-size:9.5px;color:#64748b">Sources: Open-Meteo · GloFAS · GDACS/EONET · Agri-SHIELD network</div>
    <button class="sc-open" data-open="${n.id}">Open live telemetry →</button>
  </div>`;
}

export default function NetworkMap({
  data,
  selectedId,
  onSelect,
  layers,
  height = 520,
}: {
  data: Network;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  layers: { flows: boolean; hazards: boolean; districts: boolean; commodity: string | null };
  height?: number;
}) {
  const [ctx, setCtx] = useState<{ map: Leaflet.Map; L: typeof Leaflet } | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!ctx) return;
    const { map, L } = ctx;
    if (!fitted.current) {
      fitted.current = true;
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(data.nodes.map((n) => [n.lat, n.lon] as [number, number])).pad(0.08));
    }
    const group = L.layerGroup().addTo(map);
    const svg = L.svg({ padding: 0.4 });

    if (layers.districts) {
      for (const d of data.districts) {
        L.geoJSON(d.geometry as never, {
          style: { color: riskColor(d.floodRisk), weight: 1, opacity: 0.45, fillColor: riskColor(d.floodRisk), fillOpacity: 0.07, dashArray: "3 4" },
          interactive: false,
        }).addTo(group);
      }
    }

    if (layers.flows) {
      const maxT = Math.max(...data.flows.map((f) => f.tonnesPerWeek));
      for (const f of data.flows) {
        if (layers.commodity && f.commodity !== layers.commodity) continue;
        const pts = arcLatLngs(f.coords[0]!, f.coords[1]!);
        const w = 1.5 + (f.tonnesPerWeek / maxT) * 5;
        const col = commodityColor(f.commodity);
        L.polyline(pts, { renderer: svg, color: col, weight: w + 5, opacity: 0.08, interactive: false }).addTo(group);
        L.polyline(pts, { renderer: svg, color: col, weight: w, opacity: 0.9, className: f.risk >= 60 ? "sc-flow-hot" : "sc-flow" })
          .bindTooltip(
            `<b>${f.fromName} → ${f.toName}</b><br/>${f.commodity} · ${f.tonnesPerWeek.toLocaleString()} t/wk · ${fmtUsd(f.valueUsdPerWeek)}/wk<br/>${f.modeLabel} · ${f.km} km · ${f.transitDays} d · route risk <b style="color:${riskColor(f.risk)}">${f.risk}</b>`,
            { sticky: true, direction: "top", className: "sc-tip" }
          )
          .addTo(group);
      }
    }

    if (layers.hazards) {
      for (const e of data.hazards) {
        const c = e.alertLevel === "red" ? "#ef4444" : e.alertLevel === "orange" ? "#f97316" : e.alertLevel === "green" ? "#22c55e" : "#38bdf8";
        const glyph = e.type === "flood" ? "F" : e.type === "cyclone" ? "C" : e.type === "drought" ? "D" : "S";
        L.marker([e.lat, e.lon], { icon: L.divIcon({ className: "", html: `<div class="sc-hz" style="--c:${c};background:${c}">${glyph}</div>`, iconSize: [18, 18], iconAnchor: [9, 9] }) })
          .bindPopup(`<div style="font-size:12px"><b>${e.title}</b><br/><span style="color:#94a3b8">${e.source} · ${e.type}${e.alertLevel ? ` · ${e.alertLevel.toUpperCase()}` : ""} · ${new Date(e.date).toISOString().slice(0, 10)}</span>${e.url ? `<br/><a href="${e.url}" target="_blank" rel="noreferrer" style="color:#fbbf24">Source report ↗</a>` : ""}</div>`)
          .addTo(group);
      }
    }

    const maxCap = Math.max(...data.nodes.map((n) => n.capacityTonnes));
    for (const n of data.nodes) {
      if (layers.commodity && !n.commodities.includes(layers.commodity)) continue;
      const c = riskColor(n.composite);
      const size = Math.round(16 + Math.sqrt(n.capacityTonnes / maxCap) * 14);
      const sel = n.id === selectedId;
      const html = `<div class="sc-pin ${sel ? "sc-pin-sel" : ""}" style="--c:${c};width:${size}px;height:${size}px">${n.composite >= 60 ? '<span class="sc-pulse"></span>' : ""}${nodeGlyph(n.type, c, size, n.owned)}</div>`;
      L.marker([n.lat, n.lon], { icon: L.divIcon({ className: "", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), zIndexOffset: sel ? 1000 : n.composite * 5, riseOnHover: true })
        .bindPopup(popupHtml(n), { className: "sc-popup", maxWidth: 320 })
        .on("popupopen", (e) => {
          const btn = (e as Leaflet.PopupEvent).popup.getElement()?.querySelector<HTMLButtonElement>("[data-open]");
          if (btn) btn.onclick = () => onSelect?.(n.id);
        })
        .addTo(group);
    }

    return () => {
      group.remove();
    };
  }, [ctx, data, layers.flows, layers.hazards, layers.districts, layers.commodity, selectedId, onSelect]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-800/80" style={{ height }}>
      <style>{MAP_CSS}</style>
      <BaseMap
        center={[15, 98]}
        zoom={4}
        className="relative h-full w-full"
        onReady={(map, L) => {
          setTimeout(() => setCtx({ map, L }), 80);
        }}
      />
    </div>
  );
}
