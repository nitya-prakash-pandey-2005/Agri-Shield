"use client";

/**
 * Fleet map — one pin per device, coloured by status, ring for open anomalies.
 * `pulse(ids)` (via the pulseKey/pulseIds props) flashes the pins that just
 * reported. Import via next/dynamic({ ssr:false }).
 */
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import BaseMap from "@/components/maps/BaseMap";
import { DEVICE_TYPES, METRIC_META, STATUS_META, type DeviceStatus, type DeviceType, type MetricKey } from "@/server/services/iot-types";

export interface MapDevice {
  id: string;
  name: string;
  type: DeviceType;
  lat: number;
  lon: number;
  status: DeviceStatus;
  primary: { metric: MetricKey; value: number | null };
  worst: string | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const GLYPH: Record<DeviceType, string> = { river_gauge: "≈", soil_probe: "EC", tide_gauge: "⚓", rain_gauge: "☂", weather_station: "☁", piezometer: "↓" };

const CSS = `
.iot-pin{position:relative;width:26px;height:26px;border-radius:9px;display:grid;place-items:center;font:700 10px 'JetBrains Mono',monospace;color:#020617;transform:rotate(0);transition:transform .2s}
.iot-pin:hover{transform:scale(1.15)}
.iot-pin .ring{position:absolute;inset:-5px;border-radius:12px;border:2px solid transparent}
.iot-pin.alert-critical .ring{border-color:#f87171;animation:iotRing 1.6s ease-out infinite}
.iot-pin.alert-warning .ring{border-color:#fbbf24}
.iot-pin.pulse::after{content:"";position:absolute;inset:-2px;border-radius:10px;border:2px solid currentColor;animation:iotPulse 1.4s ease-out forwards}
.iot-pin.sel{outline:2px solid #fff;outline-offset:3px}
@keyframes iotPulse{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(2.6)}}
@keyframes iotRing{0%{opacity:1}50%{opacity:.35}100%{opacity:1}}
`;

export default function FleetMap({
  devices,
  center,
  height = 420,
  pulseIds,
  pulseKey,
  selectedId,
  onOpen,
  onPick,
  pickMode,
  zoom = 6,
}: {
  devices: MapDevice[];
  center: [number, number];
  height?: number | string;
  pulseIds?: string[];
  pulseKey?: number;
  selectedId?: string | null;
  onOpen?: (id: string) => void;
  onPick?: (lat: number, lon: number) => void;
  pickMode?: boolean;
  zoom?: number;
}) {
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const fitted = useRef(false);
  const cb = useRef({ onOpen, onPick, pickMode });
  cb.current = { onOpen, onPick, pickMode };
  const [ready, setReady] = useState(0);

  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    layerRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    layerRef.current = group;
    markers.current.clear();
    for (const d of devices) {
      const st = STATUS_META[d.status];
      const html = `<div class="iot-pin ${d.worst ? `alert-${d.worst}` : ""} ${selectedId === d.id ? "sel" : ""}" style="background:${st.color};color:${st.color};box-shadow:0 0 14px ${st.color}99"><span class="ring"></span><span style="color:#020617">${GLYPH[d.type]}</span></div>`;
      const m = L.marker([d.lat, d.lon], { icon: L.divIcon({ className: "", html, iconSize: [26, 26], iconAnchor: [13, 13] }), keyboard: true, title: d.name }).addTo(group);
      const meta = METRIC_META[d.primary.metric];
      m.bindTooltip(
        `<div style="font:12px Inter,sans-serif;min-width:180px"><b>${esc(d.name)}</b><br/><span style="color:#94a3b8">${DEVICE_TYPES[d.type].short}</span> · <span style="color:${st.color}">${st.label}</span><br/>${meta.label}: <b>${d.primary.value == null ? "—" : `${d.primary.value.toFixed(meta.decimals)} ${meta.unit}`}</b>${d.worst ? `<br/><span style="color:${d.worst === "critical" ? "#f87171" : "#fbbf24"}">● open ${d.worst} anomaly</span>` : ""}<br/><span style="color:#64748b">Click to open</span></div>`,
        { direction: "top", offset: [0, -12] }
      );
      m.on("click", () => cb.current.onOpen?.(d.id));
      markers.current.set(d.id, m);
    }
    if (!fitted.current && devices.length) {
      fitted.current = true;
      if (devices.length === 1) map.setView([devices[0]!.lat, devices[0]!.lon], 11);
      else map.fitBounds(L.latLngBounds(devices.map((d) => [d.lat, d.lon] as [number, number])).pad(0.15), { maxZoom: 10 });
    }
  }, [devices, ready, selectedId]);

  useEffect(() => {
    if (!pulseIds?.length) return;
    for (const id of pulseIds) {
      const el = markers.current.get(id)?.getElement()?.querySelector(".iot-pin");
      if (!el) continue;
      el.classList.remove("pulse");
      void (el as HTMLElement).offsetWidth;
      el.classList.add("pulse");
      setTimeout(() => el.classList.remove("pulse"), 1500);
    }
  }, [pulseKey, pulseIds]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/5" style={{ height }}>
      <style>{CSS}</style>
      <BaseMap
        center={center}
        zoom={zoom}
        className="h-full w-full"
        onReady={(map, L) => {
          mapRef.current = map;
          LRef.current = L;
          map.on("click", (e: Leaflet.LeafletMouseEvent) => cb.current.pickMode && cb.current.onPick?.(e.latlng.lat, e.latlng.lng));
          setReady((r) => r + 1);
          return () => {
            mapRef.current = null;
          };
        }}
      />
      <div className="pointer-events-none absolute right-2 top-2 z-[500] flex flex-wrap gap-2 rounded-lg bg-[#050a16]/85 px-2.5 py-1.5 text-[10px] text-slate-300 backdrop-blur">
        {(["online", "stale", "offline"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: STATUS_META[s].color }} />
            {STATUS_META[s].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm border-2 border-rose-400" />
          open alert
        </span>
      </div>
      {pickMode && <div className="pointer-events-none absolute left-1/2 top-2 z-[500] -translate-x-1/2 rounded-md bg-sky-400 px-2 py-1 text-[11px] font-medium text-slate-950">Click the map to place the device</div>}
    </div>
  );
}
