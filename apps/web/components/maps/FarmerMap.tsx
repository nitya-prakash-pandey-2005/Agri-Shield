"use client";

/**
 * FarmerMap — Leaflet scene for the farmer "Live climate map":
 *   district flood / salinity choropleth · farm fields coloured by the
 *   timeline-selected risk · OSM rivers & canals · NASA GIBS NDVI and IMERG
 *   rainfall overlays · Esri satellite toggle · tap popups.
 * Always load via next/dynamic({ ssr:false }).
 */
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import BaseMap, { BASEMAPS, RAIN_OVERLAY } from "./BaseMap";

export interface FarmerMapField {
  id: string;
  name: string;
  crop: string;
  ring: number[][]; // [lon, lat]
  lat: number;
  lon: number;
  score: number; // 0-100 at the selected time
  floodRisk: number;
  salinityRisk: number;
  soilEc: number;
  ndvi: number;
}

export interface FarmerMapDistrict {
  id: string;
  name: string;
  ring: number[][];
  floodRisk: number;
  salinityRisk: number;
  floodProb72h: number;
  ecCurrent: number;
}

export interface FarmerMapLayers {
  flood: boolean;
  salinity: boolean;
  ndvi: boolean;
  rain: boolean;
  water: boolean;
  fields: boolean;
  satellite: boolean;
}

export interface FarmerMapProps {
  center: [number, number];
  fields: FarmerMapField[];
  districts: FarmerMapDistrict[];
  waterways: { id: number; name: string | null; kind: string; coords: [number, number][] }[] | null;
  layers: FarmerMapLayers;
  opacity: Partial<Record<keyof FarmerMapLayers, number>>;
  focusFieldId?: string | null;
  recenterKey?: number;
  /** localised strings for popups */
  labels: {
    flood: string;
    salinity: string;
    ndvi: string;
    ec: string;
    meaning: (score: number) => string;
    level: (score: number) => string;
    crop: (c: string) => string;
    district: string;
    probability72h: string;
  };
}

export const scoreColor = (s: number) => (s >= 80 ? "#8b5cf6" : s >= 60 ? "#ef4444" : s >= 35 ? "#f59e0b" : "#22c55e");
const salColor = (s: number) => (s >= 80 ? "#b45309" : s >= 60 ? "#d97706" : s >= 35 ? "#fbbf24" : "#fde68a");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const toLatLng = (ring: number[][]) => ring.map(([lon, lat]) => [lat!, lon!] as [number, number]);

export default function FarmerMap(props: FarmerMapProps) {
  const [ready, setReady] = useState<{ map: Leaflet.Map; L: typeof Leaflet } | null>(null);
  const groups = useRef<Record<string, Leaflet.Layer | null>>({});
  const fieldLayers = useRef<Map<string, Leaflet.Polygon>>(new Map());
  const labelsRef = useRef(props.labels);
  labelsRef.current = props.labels;

  const swap = (key: string, layer: Leaflet.Layer | null) => {
    const m = ready?.map;
    const old = groups.current[key];
    if (old && m) m.removeLayer(old);
    groups.current[key] = layer;
    if (layer && m) layer.addTo(m);
  };

  // Satellite toggle: Esri World Imagery above the shared dark basemap
  useEffect(() => {
    if (!ready) return;
    const { L } = ready;
    const g = L.layerGroup();
    if (props.layers.satellite) {
      const b = BASEMAPS.satellite;
      L.tileLayer(b.url, { attribution: b.attribution, maxZoom: 19, zIndex: 2 }).addTo(g);
    }
    swap("base", g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.layers.satellite]);

  // NASA GIBS NDVI overlay
  useEffect(() => {
    if (!ready) return;
    if (!props.layers.ndvi) return swap("ndvi", null);
    const b = BASEMAPS.ndvi;
    swap("ndvi", ready.L.tileLayer(b.url, { attribution: b.attribution, maxNativeZoom: b.maxNativeZoom, maxZoom: 18, opacity: props.opacity.ndvi ?? 0.7, zIndex: 250 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.layers.ndvi, props.opacity.ndvi]);

  // NASA IMERG rainfall overlay
  useEffect(() => {
    if (!ready) return;
    if (!props.layers.rain) return swap("rain", null);
    swap("rain", ready.L.tileLayer(RAIN_OVERLAY.url, { attribution: RAIN_OVERLAY.attribution, maxNativeZoom: RAIN_OVERLAY.maxNativeZoom, maxZoom: 18, opacity: props.opacity.rain ?? 0.75, zIndex: 260 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.layers.rain, props.opacity.rain]);

  // District choropleths (flood / salinity)
  useEffect(() => {
    if (!ready) return;
    const { L } = ready;
    const lb = labelsRef.current;
    const build = (kind: "flood" | "salinity") => {
      const g = L.layerGroup();
      for (const d of props.districts) {
        const v = kind === "flood" ? d.floodRisk : d.salinityRisk;
        const col = kind === "flood" ? scoreColor(v) : salColor(v);
        const op = props.opacity[kind] ?? 0.45;
        L.polygon(toLatLng(d.ring), { color: col, weight: 1.2, opacity: 0.9, fillColor: col, fillOpacity: op * (0.35 + v / 160), dashArray: kind === "salinity" ? "4 4" : undefined, pane: "agri-districts" })
          .bindPopup(
            `<div style="min-width:190px"><div style="font:600 10px var(--font-mono);letter-spacing:.14em;color:#94a3b8;text-transform:uppercase">${esc(lb.district)}</div>` +
              `<div style="font-weight:600;font-size:14px;margin:2px 0 6px">${esc(d.name)}</div>` +
              `<div style="display:flex;justify-content:space-between;font-size:12px"><span>${esc(lb.probability72h)}</span><b style="color:${scoreColor(d.floodProb72h * 100)}">${Math.round(d.floodProb72h * 100)}%</b></div>` +
              `<div style="display:flex;justify-content:space-between;font-size:12px"><span>${esc(lb.salinity)}</span><b style="color:${salColor(d.salinityRisk)}">${d.salinityRisk}% · ${d.ecCurrent} dS/m</b></div>` +
              `<div style="margin-top:6px;font-size:11px;color:#cbd5e1">${esc(lb.meaning(Math.max(d.floodRisk, d.salinityRisk * 0.9)))}</div></div>`
          )
          .addTo(g);
      }
      return g;
    };
    swap("flood", props.layers.flood ? build("flood") : null);
    swap("salinity", props.layers.salinity ? build("salinity") : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.districts, props.layers.flood, props.layers.salinity, props.opacity.flood, props.opacity.salinity]);

  // Rivers & canals (OSM)
  useEffect(() => {
    if (!ready) return;
    const { L } = ready;
    if (!props.layers.water || !props.waterways) return swap("water", null);
    const g = L.layerGroup();
    for (const w of props.waterways) {
      const weight = w.kind === "river" ? 3 : w.kind === "canal" ? 2 : 1.4;
      L.polyline(w.coords, { color: "#38bdf8", weight, opacity: props.opacity.water ?? 0.85, pane: "agri-water" })
        .bindTooltip(esc(w.name ?? w.kind), { sticky: true })
        .addTo(g);
    }
    swap("water", g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.waterways, props.layers.water, props.opacity.water]);

  // Fields — created once per data change, restyled on every timeline tick
  useEffect(() => {
    if (!ready) return;
    const { L } = ready;
    fieldLayers.current.clear();
    if (!props.layers.fields) return swap("fields", null);
    const g = L.featureGroup();
    for (const f of props.fields) {
      const poly = L.polygon(toLatLng(f.ring), { color: "#fff", weight: 2, fillOpacity: 0.55, pane: "agri-fields" });
      poly.bindPopup(() => {
        const lb = labelsRef.current;
        const cur = fieldLayers.current.get(f.id) as (Leaflet.Polygon & { _score?: number }) | undefined;
        const s = cur?._score ?? f.score;
        return (
          `<div style="min-width:200px"><div style="font-weight:600;font-size:14px">${esc(f.name)}</div>` +
          `<div style="font-size:11px;color:#94a3b8;margin-bottom:6px">${esc(lb.crop(f.crop))}</div>` +
          `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="width:8px;height:8px;border-radius:9px;background:${scoreColor(s)}"></span><b>${esc(lb.level(s))}</b><span style="margin-left:auto;font-family:var(--font-mono)">${Math.round(s)}%</span></div>` +
          `<div style="display:grid;grid-template-columns:1fr auto;gap:2px 10px;font-size:12px"><span>${esc(lb.flood)}</span><b>${f.floodRisk}%</b><span>${esc(lb.salinity)}</span><b>${f.salinityRisk}%</b><span>${esc(lb.ec)}</span><b>${f.soilEc} dS/m</b><span>${esc(lb.ndvi)}</span><b>${f.ndvi.toFixed(2)}</b></div>` +
          `<div style="margin-top:6px;font-size:11px;color:#cbd5e1">${esc(lb.meaning(s))}</div></div>`
        );
      });
      poly.addTo(g);
      fieldLayers.current.set(f.id, poly);
    }
    swap("fields", g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.layers.fields, props.fields.map((f) => f.id + f.ring.length).join("|")]);

  useEffect(() => {
    for (const f of props.fields) {
      const p = fieldLayers.current.get(f.id) as (Leaflet.Polygon & { _score?: number }) | undefined;
      if (!p) continue;
      p._score = f.score;
      p.setStyle({ fillColor: scoreColor(f.score), color: scoreColor(f.score), fillOpacity: (props.opacity.fields ?? 0.6) * (0.55 + f.score / 220) });
    }
  }, [props.fields, props.opacity.fields, ready, props.layers.fields]);

  // Farm marker (pulsing)
  useEffect(() => {
    if (!ready) return;
    const { L } = ready;
    const icon = L.divIcon({
      className: "",
      html: `<span style="position:relative;display:block;width:18px;height:18px"><span style="position:absolute;inset:0;border-radius:99px;background:#10b981;opacity:.35;animation:ping 1.6s cubic-bezier(0,0,.2,1) infinite"></span><span style="position:absolute;inset:4px;border-radius:99px;background:#10b981;box-shadow:0 0 12px #10b981;border:2px solid #fff"></span></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    swap("farm", L.marker(props.center, { icon, keyboard: false, zIndexOffset: 1000 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.center[0], props.center[1]]);

  // Focus a field (from ?field=) or recenter on the farm
  useEffect(() => {
    if (!ready) return;
    const target = props.focusFieldId ? fieldLayers.current.get(props.focusFieldId) : null;
    if (target) {
      ready.map.fitBounds(target.getBounds(), { maxZoom: 17, padding: [60, 60] });
      setTimeout(() => target.openPopup(), 400);
    } else if (fieldLayers.current.size) {
      const g = groups.current.fields as Leaflet.FeatureGroup | null;
      if (g) ready.map.fitBounds(g.getBounds(), { maxZoom: 16, padding: [60, 60] });
    } else ready.map.setView(props.center, 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.focusFieldId, props.recenterKey, fieldLayers.current.size]);

  return (
    <BaseMap
      center={props.center}
      zoom={14}
      basemap="dark"
      showBasemapSwitcher={false}
      className="relative h-full w-full"
      onReady={(map, L) => {
        (
          [
            ["agri-districts", 410],
            ["agri-water", 420],
            ["agri-fields", 430],
          ] as const
        ).forEach(([name, z]) => {
          if (!map.getPane(name)) map.createPane(name).style.zIndex = String(z);
        });
        setReady({ map, L });
        return () => setReady(null);
      }}
    />
  );
}
