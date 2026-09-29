/**
 * RainViewer global weather-radar mosaic (free, no key; attribution required).
 * Returns the ~2 hours of past 10-minute frames (+ nowcast frames when offered).
 * Tile URL: `${host}${path}/256/{z}/{x}/{y}/2/1_1.png` (colour scheme 2, smoothed, snow).
 */
import { cached, fetchJson } from "./http";

export interface RadarFrames {
  host: string;
  frames: { time: number; path: string; kind: "past" | "nowcast" }[];
  tileTemplate: string;
  maxNativeZoom: number;
  attribution: string;
  generatedAt: number;
}

export function getRadarFrames(): Promise<RadarFrames> {
  return cached("rainviewer", 3 * 60_000, async () => {
    const r = await fetchJson<{ host: string; generated: number; radar: { past?: { time: number; path: string }[]; nowcast?: { time: number; path: string }[] } }>(
      "https://api.rainviewer.com/public/weather-maps.json",
      8000
    );
    const frames = [...(r.radar.past ?? []).map((f) => ({ ...f, kind: "past" as const })), ...(r.radar.nowcast ?? []).map((f) => ({ ...f, kind: "nowcast" as const }))];
    return {
      host: r.host,
      frames,
      tileTemplate: "{host}{path}/256/{z}/{x}/{y}/2/1_1.png",
      maxNativeZoom: 7,
      attribution: '<a href="https://www.rainviewer.com/api.html" target="_blank" rel="noreferrer">RainViewer</a>',
      generatedAt: r.generated,
    };
  });
}
