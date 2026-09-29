"use client";

/**
 * Live weather radar for the farm — RainViewer composite radar (past ~2 h +
 * nowcast frames), animated with play/pause and a scrubber. Frames are
 * pre-loaded as Leaflet tile layers and cross-faded via opacity so playback is
 * smooth on slow connections. Farm fields are outlined on top.
 * Load with next/dynamic({ ssr: false }).
 */
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { Pause, Play } from "lucide-react";
import BaseMap from "@/components/maps/BaseMap";

/** RainViewer tiles go through the same-origin proxy (CSP img-src does not list rainviewer). */
const tileUrl = (host: string, path: string) =>
  host === "https://tilecache.rainviewer.com" ? `/dashboard/farmer/radar-tile${path}/256/{z}/{x}/{y}/2/1_1.png` : `${host}${path}/256/{z}/{x}/{y}/2/1_1.png`;

export interface RadarFrame {
  time: number;
  path: string;
  nowcast: boolean;
}

export default function RadarMap({
  center,
  host,
  frames,
  rings,
  labels,
  zoom = 8,
}: {
  center: [number, number];
  host: string;
  frames: RadarFrame[];
  rings: number[][][];
  labels: { play: string; pause: string; forecast: string; past: string; now: string };
  zoom?: number;
}) {
  const [ready, setReady] = useState<{ map: Leaflet.Map; L: typeof Leaflet } | null>(null);
  const layers = useRef<Leaflet.TileLayer[]>([]);
  const nowIdx = Math.max(0, frames.reduce((last, f, i) => (f.nowcast ? last : i), -1));
  const [idx, setIdx] = useState(nowIdx);
  const [playing, setPlaying] = useState(true);

  // build one tile layer per frame (opacity 0), recreated when the frame list changes
  useEffect(() => {
    if (!ready) return;
    const { map, L } = ready;
    layers.current.forEach((l) => map.removeLayer(l));
    layers.current = frames.map((f) =>
      L.tileLayer(tileUrl(host, f.path), { opacity: 0, zIndex: 300, maxNativeZoom: 7, maxZoom: 18, attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>' }).addTo(map)
    );
    return () => {
      layers.current.forEach((l) => map.removeLayer(l));
      layers.current = [];
    };
  }, [ready, frames, host]);

  useEffect(() => {
    layers.current.forEach((l, i) => l.setOpacity(i === idx ? 0.75 : 0));
  }, [idx, frames, ready]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const tm = setInterval(() => setIdx((i) => (i + 1) % frames.length), 700);
    return () => clearInterval(tm);
  }, [playing, frames.length]);

  useEffect(() => {
    if (!ready) return;
    const { map, L } = ready;
    const g = L.layerGroup(rings.map((r) => L.polygon(r.map(([lon, lat]) => [lat!, lon!] as [number, number]), { color: "#10b981", weight: 2, fillOpacity: 0.15 })));
    g.addTo(map);
    const pin = L.circleMarker(center, { radius: 7, color: "#fff", weight: 2, fillColor: "#10b981", fillOpacity: 1 }).addTo(map);
    return () => {
      map.removeLayer(g);
      map.removeLayer(pin);
    };
  }, [ready, rings, center]);

  const f = frames[idx];
  const time = f ? new Date(f.time * 1000) : null;
  const rel = f ? Math.round((f.time * 1000 - (frames[nowIdx]?.time ?? f.time) * 1000) / 60000) : 0;

  return (
    <div className="relative h-full w-full">
      <BaseMap center={center} zoom={zoom} basemap="dark" showBasemapSwitcher={false} className="relative h-full w-full" onReady={(map, L) => { setReady({ map, L }); return () => setReady(null); }} />
      <div className="absolute inset-x-3 bottom-3 z-[600] mx-auto max-w-xl rounded-2xl border border-white/10 bg-[#060a16]/90 p-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button onClick={() => setPlaying((p) => !p)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sky-500 text-slate-950 active:scale-[0.97]" aria-label={playing ? labels.pause : labels.play}>
            {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>
          <div className="min-w-0 flex-1">
            <input type="range" min={0} max={Math.max(0, frames.length - 1)} value={idx} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} className="w-full accent-sky-500" aria-label="radar time" />
            <div className="mt-0.5 flex justify-between text-[11px] telemetry">
              <span className="text-white">{time ? time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
              <span className={f?.nowcast ? "text-sky-300" : "text-slate-400"}>{rel === 0 ? labels.now : `${rel > 0 ? "+" : ""}${rel} min · ${f?.nowcast ? labels.forecast : labels.past}`}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
