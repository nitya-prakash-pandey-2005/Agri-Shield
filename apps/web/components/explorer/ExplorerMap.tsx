"use client";

/**
 * Full-bleed interactive map for the Risk Explorer.
 * Click anywhere → onPick(lat, lon). Toggleable overlays (all free, no keys):
 *   radar   RainViewer global radar mosaic, animated past ~2 h
 *   flood   NASA GIBS MODIS Combined Flood (2-day observed flood water)
 *   water   JRC Global Surface Water occurrence 1984-2021
 *   hls     NASA HLS Sentinel-2 / Landsat 30 m true colour (selectable date)
 *   ndvi    NASA MODIS 8-day NDVI (vegetation health)
 *   imerg   NASA GPM IMERG satellite rain rate
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { CloudRain, Droplets, Layers, Leaf, Pause, Play, Radar, Satellite, Waves, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { RAIN_OVERLAY } from "@/components/maps/BaseMap";
import { Explain } from "@/components/help/Explain";
import { cn } from "@/lib/utils";
import type { Place } from "./types";

const BaseMap = dynamic(() => import("@/components/maps/BaseMap"), { ssr: false, loading: () => <div className="absolute inset-0 hud-bg" /> });

export type OverlayKey = "radar" | "flood" | "water" | "hls" | "ndvi" | "imerg";

const gibsDate = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

export const OVERLAYS: { key: OverlayKey; label: string; icon: typeof Radar; help: string; legend: string }[] = [
  { key: "radar", label: "Live rain radar", icon: Radar, help: "Ground weather-radar mosaic from RainViewer, updated every 10 minutes. Press play to animate the last ~2 hours and see where storms are moving.", legend: "Blue → yellow → red = light → heavy rain (past 2 h)" },
  { key: "flood", label: "Observed flooding", icon: Waves, help: "NASA MODIS 2-day flood product: water detected by satellite where there is normally dry land. Clouds can hide water, so absence is not proof of no flooding.", legend: "Coloured pixels = flood water seen by satellite in the last 2 days" },
  { key: "water", label: "Water history (1984–2021)", icon: Droplets, help: "EU JRC Global Surface Water: how often each 30 m pixel was covered by water across 37 years of Landsat images. Areas that are often wet flood again.", legend: "Pink → blue = water present rarely → permanently" },
  { key: "hls", label: "30 m satellite photo", icon: Satellite, help: "NASA Harmonized Landsat-Sentinel (HLS) true-colour imagery at 30 m for the chosen date. Each day only covers some swaths — try another date if empty.", legend: "True colour · clouds appear white" },
  { key: "ndvi", label: "Vegetation health (NDVI)", icon: Leaf, help: "MODIS 8-day NDVI: greener = denser, healthier vegetation; brown = bare soil, stressed or harvested crops.", legend: "Brown → green = sparse → dense vegetation" },
  { key: "imerg", label: "Satellite rainfall", icon: CloudRain, help: "NASA GPM IMERG precipitation rate from satellites (works over oceans and where there is no radar).", legend: "Rain rate from satellites (~10 km)" },
];

interface Props {
  selected: Place | null;
  pins: Place[];
  hazards?: { lat: number; lon: number; title: string; type: string }[];
  riverCell?: { lat: number; lon: number; snapped: boolean } | null;
  onPick: (lat: number, lon: number) => void;
  initialCenter?: [number, number];
  initialZoom?: number;
  compactControls?: boolean;
  /** turn an overlay on from outside (e.g. "Show observed flood" in the Flood tab) */
  overlayRequest?: { key: OverlayKey; n: number } | null;
}

export function ExplorerMap({ selected, pins, hazards = [], riverCell, onPick, initialCenter = [15, 60], initialZoom = 3, compactControls, overlayRequest }: Props) {
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const [ready, setReady] = useState(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [active, setActive] = useState<Record<OverlayKey, boolean>>({ radar: false, flood: false, water: false, hls: false, ndvi: false, imerg: false });
  const [hlsDays, setHlsDays] = useState(4);
  const [panelOpen, setPanelOpen] = useState(!compactControls);
  const layerRefs = useRef<Partial<Record<OverlayKey, Leaflet.Layer[]>>>({});
  const markerLayer = useRef<Leaflet.LayerGroup | null>(null);

  const handleReady = useCallback((map: Leaflet.Map, L: typeof Leaflet) => {
    mapRef.current = map;
    LRef.current = L;
    markerLayer.current = L.layerGroup().addTo(map);
    map.on("click", (e: Leaflet.LeafletMouseEvent) => onPickRef.current(Math.round(e.latlng.lat * 10000) / 10000, Math.round((((e.latlng.lng + 540) % 360) - 180) * 10000) / 10000));
    map.getContainer().style.cursor = "crosshair";
    // keep the top-left corner for the search box: zoom buttons sit below it
    const zc = map.zoomControl?.getContainer();
    if (zc) zc.style.marginTop = "112px";
    setReady(true);
    return () => {
      mapRef.current = null;
    };
  }, []);

  // ── Static tile overlays ──
  const tileSpec = useMemo(
    () => ({
      flood: [{ url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_Flood_2-Day/default/${gibsDate(2)}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`, maxNativeZoom: 9, opacity: 0.9, attribution: "NASA GIBS MODIS Flood" }],
      water: [{ url: "https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png", maxNativeZoom: 13, opacity: 0.75, attribution: "EC JRC / Google Global Surface Water" }],
      hls: [
        { url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/HLS_L30_Nadir_BRDF_Adjusted_Reflectance/default/${gibsDate(hlsDays)}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`, maxNativeZoom: 12, opacity: 1, attribution: "NASA HLS" },
        { url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/${gibsDate(hlsDays)}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`, maxNativeZoom: 12, opacity: 1, attribution: "NASA HLS (Sentinel-2)" },
      ],
      ndvi: [{ url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/${gibsDate(10)}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`, maxNativeZoom: 9, opacity: 0.7, attribution: "NASA MODIS NDVI" }],
      imerg: [{ url: RAIN_OVERLAY.url, maxNativeZoom: RAIN_OVERLAY.maxNativeZoom, opacity: 0.75, attribution: RAIN_OVERLAY.attribution }],
    }),
    [hlsDays]
  );

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    const z: Record<string, number> = { water: 3, hls: 4, ndvi: 5, flood: 6, imerg: 7 };
    (Object.keys(tileSpec) as (keyof typeof tileSpec)[]).forEach((k) => {
      layerRefs.current[k]?.forEach((l) => l.remove());
      layerRefs.current[k] = undefined;
      if (!active[k]) return;
      layerRefs.current[k] = tileSpec[k].map((s) => L.tileLayer(s.url, { maxNativeZoom: s.maxNativeZoom, maxZoom: 18, opacity: s.opacity, attribution: s.attribution, zIndex: z[k] ?? 5 }).addTo(map));
    });
  }, [ready, active, tileSpec]);

  // ── Radar (animated) ──
  const radarQ = trpc.explorer.radarFrames.useQuery(undefined, { enabled: active.radar, refetchInterval: active.radar ? 5 * 60_000 : false, staleTime: 2 * 60_000 });
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const radarLayers = useRef<Leaflet.TileLayer[]>([]);
  const frames = radarQ.data?.frames ?? [];
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    radarLayers.current.forEach((l) => l.remove());
    radarLayers.current = [];
    if (!ready || !L || !map || !active.radar || !radarQ.data) return;
    const d = radarQ.data;
    radarLayers.current = d.frames.map((f) =>
      L.tileLayer(`${d.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { maxNativeZoom: d.maxNativeZoom, maxZoom: 18, opacity: 0, zIndex: 8, attribution: d.attribution }).addTo(map)
    );
    setFrame(Math.max(0, d.frames.filter((f) => f.kind === "past").length - 1));
  }, [ready, active.radar, radarQ.data]);
  useEffect(() => {
    radarLayers.current.forEach((l, i) => l.setOpacity(i === frame ? 0.75 : 0));
  }, [frame, radarQ.data]);
  useEffect(() => {
    if (!active.radar || !playing || frames.length < 2) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % frames.length), 700);
    return () => clearInterval(t);
  }, [active.radar, playing, frames.length]);

  // ── Markers ──
  useEffect(() => {
    const L = LRef.current;
    const g = markerLayer.current;
    if (!ready || !L || !g) return;
    g.clearLayers();
    hazards.forEach((h) =>
      L.circleMarker([h.lat, h.lon], { radius: 5, color: "#fb923c", weight: 1.5, fillColor: "#fb923c", fillOpacity: 0.35 })
        .bindTooltip(`${h.type}: ${h.title}`, { direction: "top" })
        .addTo(g)
    );
    pins.forEach((p, i) => {
      const icon = L.divIcon({ className: "", html: `<div style="transform:translate(-50%,-100%);display:grid;place-items:center;width:22px;height:22px;border-radius:9999px;background:#0b1224;border:2px solid #a78bfa;color:#e9d5ff;font:600 11px var(--font-mono)">${i + 1}</div>`, iconSize: [0, 0] });
      L.marker([p.lat, p.lon], { icon, keyboard: false }).bindTooltip(p.name ?? `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`, { direction: "top", offset: [0, -22] }).addTo(g);
    });
    if (riverCell?.snapped) {
      L.circleMarker([riverCell.lat, riverCell.lon], { radius: 6, color: "#22d3ee", weight: 2, fillOpacity: 0, dashArray: "3 3" }).bindTooltip("GloFAS river cell used for discharge", { direction: "top" }).addTo(g);
    }
    if (selected) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="position:relative;transform:translate(-50%,-50%);width:18px;height:18px"><span style="position:absolute;inset:-10px;border-radius:9999px;border:2px solid rgba(52,211,153,.55);animation:ping 1.6s cubic-bezier(0,0,.2,1) infinite"></span><span style="position:absolute;inset:0;border-radius:9999px;background:#34d399;box-shadow:0 0 16px #34d399;border:3px solid #052e1f"></span></div>`,
        iconSize: [0, 0],
      });
      L.marker([selected.lat, selected.lon], { icon, keyboard: false, interactive: false }).addTo(g);
    }
  }, [ready, selected, pins, hazards, riverCell]);

  // ── Fly to the selection ──
  const lastFly = useRef<string>("");
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selected) return;
    const k = `${selected.lat},${selected.lon}`;
    if (k === lastFly.current) return;
    lastFly.current = k;
    const z = Math.max(map.getZoom(), 9);
    // keep the point visible left of the report slide-over on wide screens
    const w = map.getContainer().clientWidth;
    const h = map.getContainer().clientHeight;
    // wide screens: report slides over the right half → shift left; phones: bottom sheet → shift up
    const offset: [number, number] = w >= 1024 ? [Math.min(360, w * 0.25), 0] : [0, h * 0.3];
    const target = map.project([selected.lat, selected.lon], z).add(offset);
    map.flyTo(map.unproject(target, z), z, { duration: 1.1 });
  }, [ready, selected]);

  useEffect(() => {
    if (!overlayRequest) return;
    setActive((a) => ({ ...a, [overlayRequest.key]: true }));
    setPanelOpen(true);
  }, [overlayRequest]);

  const toggle = (k: OverlayKey) => setActive((a) => ({ ...a, [k]: !a[k] }));
  const anyActive = OVERLAYS.filter((o) => active[o.key]);
  const frameTime = frames[frame] ? new Date(frames[frame]!.time * 1000) : null;
  const radarLabel = radarQ.isLoading ? "loading…" : frameTime ? `${frameTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}${frames[frame]?.kind === "nowcast" ? " now-cast" : ""}` : "unavailable";

  return (
    <div className="absolute inset-0">
      <BaseMap center={initialCenter} zoom={initialZoom} basemap="dark" onReady={handleReady} className="absolute inset-0" />

      {/* Layers control */}
      <div className="absolute right-3 top-3 z-[600] flex flex-col items-end gap-2">
        <button
          onClick={() => setPanelOpen((o) => !o)}
          className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs backdrop-blur", panelOpen ? "border-cyan-400/40 bg-[#081022]/90 text-cyan-200" : "border-white/10 bg-[#060a16]/85 text-slate-200 hover:border-cyan-400/40")}
          aria-expanded={panelOpen}
        >
          <Layers size={14} /> Layers {active.radar && !panelOpen && <span className="telemetry text-[10px] text-cyan-300">radar {radarLabel}</span>} {anyActive.length > 0 && <span className="rounded-full bg-cyan-500/20 px-1.5 telemetry text-[10px] text-cyan-200">{anyActive.length}</span>}
        </button>
        {panelOpen && (
          <div className="w-[264px] rounded-xl border border-white/10 bg-[#060a16]/92 p-2 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between px-1.5 pb-1.5">
              <span className="hud-label">Map overlays</span>
              <button onClick={() => setPanelOpen(false)} className="text-slate-500 hover:text-white" aria-label="Close layers">
                <X size={14} />
              </button>
            </div>
            {OVERLAYS.map((o) => (
              <div key={o.key} className={cn("rounded-lg px-1.5 py-1", active[o.key] && "bg-white/[0.04]")}>
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-slate-200">
                  <input type="checkbox" checked={active[o.key]} onChange={() => toggle(o.key)} className="h-3.5 w-3.5 accent-cyan-400" />
                  <o.icon size={13} className={active[o.key] ? "text-cyan-300" : "text-slate-500"} />
                  <span className="flex-1">{o.label}</span>
                  <Explain text={o.help} title={o.label} side="left" />
                </label>
                {active[o.key] && <div className="ml-6 mt-0.5 text-[10.5px] leading-snug text-slate-500">{o.legend}</div>}
                {o.key === "radar" && active.radar && (
                  <div className="ml-6 mt-1 flex items-center gap-2">
                    <button onClick={() => setPlaying((p) => !p)} className="text-cyan-300 hover:text-white" aria-label={playing ? "Pause radar" : "Play radar"}>
                      {playing ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <input type="range" min={0} max={Math.max(0, frames.length - 1)} value={frame} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} className="h-1 flex-1 accent-cyan-400" aria-label="Radar frame" />
                    <span className="telemetry text-[10px] text-slate-400">{radarLabel}</span>
                  </div>
                )}
                {o.key === "hls" && active.hls && (
                  <div className="ml-6 mt-1 flex items-center gap-2">
                    <input type="range" min={1} max={20} value={hlsDays} onChange={(e) => setHlsDays(Number(e.target.value))} className="h-1 flex-1 accent-cyan-400" aria-label="Image date" />
                    <span className="telemetry text-[10px] text-slate-400">{gibsDate(hlsDays)}</span>
                  </div>
                )}
              </div>
            ))}
            <p className="px-1.5 pt-1.5 text-[10px] leading-snug text-slate-500">Click anywhere on the map for a full climate-risk report.</p>
          </div>
        )}
      </div>

    </div>
  );
}
