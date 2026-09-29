"use client";

/**
 * Shared Leaflet base map with free basemaps + satellite overlays (no keys):
 *   dark      — Esri World Dark Gray canvas + reference labels
 *               (Daylight theme: Esri World Light Gray canvas + labels, switched live)
 *   satellite — Esri World Imagery
 *   modis     — NASA GIBS MODIS Terra true colour (yesterday)
 *   ndvi      — NASA GIBS MODIS Terra 8-day NDVI
 *   rain      — NASA GIBS IMERG precipitation rate (overlay)
 *
 * Usage (always via next/dynamic with ssr:false):
 *   <BaseMap center={[22.7, 90.3]} zoom={7} onReady={(map, L) => { ...add layers... }} />
 * The callback receives the Leaflet map + module so pages can draw anything.
 */
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useTheme } from "next-themes";

export type Basemap = "dark" | "satellite" | "modis" | "ndvi";

const gibsDate = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

export const BASEMAPS: Record<Basemap, { label: string; url: string; attribution: string; maxNativeZoom?: number }> = {
  dark: {
    label: "Dark",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
    maxNativeZoom: 16,
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
  },
  modis: {
    label: "MODIS (NASA)",
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${gibsDate(1)}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    attribution: 'NASA EOSDIS <a href="https://earthdata.nasa.gov/gibs">GIBS</a>',
    maxNativeZoom: 9,
  },
  ndvi: {
    label: "NDVI (NASA)",
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/${gibsDate(10)}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`,
    attribution: 'NASA EOSDIS <a href="https://earthdata.nasa.gov/gibs">GIBS</a> MODIS NDVI',
    maxNativeZoom: 9,
  },
};

const DARK_LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
export const LIGHT_BASE = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
export const LIGHT_LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}";

/** Canvas basemap + label URLs for the painted theme (Daylight gets the light-grey canvas). */
export function canvasTiles(light: boolean): { base: string; labels: string } {
  return light ? { base: LIGHT_BASE, labels: LIGHT_LABELS } : { base: BASEMAPS.dark.url, labels: DARK_LABELS };
}

export const RAIN_OVERLAY = {
  url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/${gibsDate(1)}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
  attribution: "NASA GPM IMERG",
  maxNativeZoom: 6,
};

export default function BaseMap({
  center,
  zoom = 7,
  basemap = "dark",
  className,
  onReady,
  showBasemapSwitcher = true,
}: {
  center: [number, number];
  zoom?: number;
  basemap?: Basemap;
  className?: string;
  onReady?: (map: Leaflet.Map, L: typeof Leaflet) => void | (() => void);
  showBasemapSwitcher?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const tileRef = useRef<Leaflet.TileLayer | null>(null);
  const labelRef = useRef<Leaflet.TileLayer | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const [current, setCurrent] = useState<Basemap>(basemap);
  useEffect(() => setCurrent(basemap), [basemap]);
  const { resolvedTheme } = useTheme();
  const light = resolvedTheme === "light";
  const lightRef = useRef(light);
  lightRef.current = light;

  useEffect(() => {
    let cleanup: void | (() => void);
    let disposed = false;
    let resizeObs: ResizeObserver | null = null;
    import("leaflet").then((mod) => {
      const L = (mod.default ?? mod) as typeof Leaflet;
      if (disposed || !el.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(el.current, { center, zoom, zoomControl: true, attributionControl: true, preferCanvas: true });
      mapRef.current = map;
      const b = BASEMAPS[current];
      const canvas = canvasTiles(lightRef.current);
      tileRef.current = L.tileLayer(current === "dark" ? canvas.base : b.url, { attribution: b.attribution, maxNativeZoom: b.maxNativeZoom, maxZoom: 18 }).addTo(map);
      if (current === "dark") labelRef.current = L.tileLayer(canvas.labels, { maxNativeZoom: 16, maxZoom: 18, pane: "shadowPane" }).addTo(map);
      L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
      // Keep Leaflet in sync with layout changes (drawers, tabs, responsive grids)
      resizeObs = new ResizeObserver(() => map.invalidateSize({ pan: false }));
      resizeObs.observe(el.current);
      // Hand the map to the page only once it has its real size, so fitBounds() is accurate
      requestAnimationFrame(() => {
        if (disposed) return;
        map.invalidateSize({ pan: false });
        cleanup = onReady?.(map, L);
      });
    });
    return () => {
      disposed = true;
      resizeObs?.disconnect();
      if (typeof cleanup === "function") cleanup();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    tileRef.current?.remove();
    labelRef.current?.remove();
    labelRef.current = null;
    const b = BASEMAPS[current];
    const canvas = canvasTiles(light);
    tileRef.current = L.tileLayer(current === "dark" ? canvas.base : b.url, { attribution: b.attribution, maxNativeZoom: b.maxNativeZoom, maxZoom: 18 }).addTo(map);
    tileRef.current.bringToBack();
    if (current === "dark") labelRef.current = L.tileLayer(canvas.labels, { maxNativeZoom: 16, maxZoom: 18, pane: "shadowPane" }).addTo(map);
  }, [current, light]);

  return (
    <div className={className ?? "relative h-full w-full"}>
      <div ref={el} className="absolute inset-0 rounded-[inherit]" />
      {showBasemapSwitcher && (
        <div className="absolute bottom-6 right-2 z-[500] flex gap-1 rounded-lg border border-white/10 bg-[#060a16]/85 p-1 backdrop-blur">
          {(Object.keys(BASEMAPS) as Basemap[]).map((k) => (
            <button
              key={k}
              onClick={() => setCurrent(k)}
              className={`rounded-md px-2 py-1 text-[10px] telemetry uppercase tracking-wider ${current === k ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"}`}
            >
              {k === "dark" && light ? "Light" : BASEMAPS[k].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
