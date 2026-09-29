"use client";

/**
 * Field satellite thumbnail — a tiny slippy-map mosaic of Esri World Imagery
 * tiles rendered in pure SVG with the field boundary overlaid (no Leaflet).
 */
import { useMemo } from "react";

const TILE = 256;
const W = 320;
const H = 180;

function project(lon: number, lat: number, z: number) {
  const s = TILE * 2 ** z;
  const x = ((lon + 180) / 360) * s;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s;
  return { x, y };
}

export function FieldSatThumb({ ring, color = "#22c55e", label, className }: { ring: number[][]; color?: string; label?: string; className?: string }) {
  const view = useMemo(() => {
    if (ring.length < 3) return null;
    let z = 18;
    let pts: { x: number; y: number }[] = [];
    for (; z >= 12; z--) {
      pts = ring.map(([lon, lat]) => project(lon!, lat!, z));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      if (Math.max(...xs) - Math.min(...xs) < W * 0.62 && Math.max(...ys) - Math.min(...ys) < H * 0.62) break;
    }
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const x0 = cx - W / 2;
    const y0 = cy - H / 2;
    const tiles: { x: number; y: number; url: string }[] = [];
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W) / TILE); tx++)
      for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + H) / TILE); ty++)
        tiles.push({ x: tx * TILE - x0, y: ty * TILE - y0, url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}` });
    const path = pts.map((p, i) => `${i ? "L" : "M"}${(p.x - x0).toFixed(1)},${(p.y - y0).toFixed(1)}`).join(" ") + " Z";
    return { tiles, path, z };
  }, [ring]);

  if (!view) return null;
  return (
    <figure className={className ?? "relative overflow-hidden rounded-lg border border-white/10 bg-slate-900"}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label ?? "Field satellite view"}>
        {view.tiles.map((t) => (
          <image key={t.url} href={t.url} x={t.x} y={t.y} width={TILE} height={TILE} preserveAspectRatio="none" />
        ))}
        <rect width={W} height={H} fill="#020617" opacity={0.15} />
        <path d={view.path} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={2} strokeLinejoin="round" />
        <path d={view.path} fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={0.6} strokeDasharray="3 3" />
      </svg>
      <figcaption className="absolute bottom-1 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] telemetry uppercase tracking-wider text-slate-300">Esri World Imagery · z{view.z}</figcaption>
    </figure>
  );
}
