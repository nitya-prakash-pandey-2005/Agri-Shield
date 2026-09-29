"use client";

/**
 * Hero globe wrapper: live district risk from `public.riskMap`, WebGL globe when
 * motion is allowed, and a static orthographic SVG (same projection) otherwise.
 * The static layer doubles as the loading state, so the hero never pops.
 */
import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { riskColor } from "@/components/hud";
import type { GlobeMarker } from "./HeroGlobe";

const HeroGlobe = dynamic(() => import("./HeroGlobe"), { ssr: false });

const CENTER = { lat: 15, lon: 100 };
const R = 290 / 600; // globe radius as fraction of the square (matches asia-dots.svg)

function project(lat: number, lon: number) {
  const d = Math.PI / 180;
  const la0 = CENTER.lat * d;
  const lo0 = CENTER.lon * d;
  const la = lat * d;
  const lo = lon * d;
  const x = 0.5 + R * Math.cos(la) * Math.sin(lo - lo0);
  const y = 0.5 - R * (Math.cos(la0) * Math.sin(la) - Math.sin(la0) * Math.cos(la) * Math.cos(lo - lo0));
  return { x: x * 100, y: y * 100 };
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function GlobeStage() {
  const reduced = useReducedMotion();
  const [canGl, setCanGl] = useState<boolean | null>(null);
  const [glReady, setGlReady] = useState(false);
  const [hover, setHover] = useState<{ m: GlobeMarker; x: number; y: number } | null>(null);
  const [focus, setFocus] = useState<GlobeMarker | null>(null);
  const risk = trpc.public.riskMap.useQuery(undefined, { refetchInterval: 5 * 60_000 });

  useEffect(() => {
    setCanGl(webglAvailable());
    // let the static layer paint first, then bring in the WebGL chunk when idle
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const go = () => setGlReady(true);
    if (idle) idle(go, { timeout: 1200 });
    else setTimeout(go, 400);
  }, []);

  const markers: GlobeMarker[] = useMemo(
    () =>
      (risk.data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        country: d.country,
        countryCode: d.countryCode,
        lat: d.lat,
        lon: d.lon,
        flood: d.floodRisk,
        salinity: d.salinityRisk,
      })),
    [risk.data]
  );

  const useGl = !reduced && canGl && glReady;
  const byId = useMemo(() => new Map((risk.data ?? []).map((d) => [d.id, d])), [risk.data]);
  const card = hover?.m ?? focus;
  const detail = card ? byId.get(card.id) : undefined;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[640px] select-none">
      {/* static layer: reduced-motion view + loading state */}
      <div className={`absolute inset-0 transition-opacity duration-700 ${useGl ? "opacity-0" : "opacity-100"}`} aria-hidden={useGl ? true : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/globe/asia-dots.svg" alt="" className="h-full w-full" width={600} height={600} fetchPriority="high" />
        {!useGl &&
          markers.map((m) => {
            const p = project(m.lat, m.lon);
            const score = Math.max(m.flood, m.salinity);
            return (
              <button
                key={m.id}
                type="button"
                onMouseEnter={() => setFocus(m)}
                onFocus={() => setFocus(m)}
                onMouseLeave={() => setFocus(null)}
                onBlur={() => setFocus(null)}
                aria-label={`${m.name}, ${m.country}: flood risk ${Math.round(m.flood)}, salinity risk ${Math.round(m.salinity)}`}
                className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${p.x}%`, top: `${p.y}%`, background: riskColor(score), boxShadow: `0 0 0 4px ${riskColor(score)}33, 0 0 14px ${riskColor(score)}` }}
              />
            );
          })}
      </div>

      {useGl && (
        <div className="absolute inset-0 animate-[fade-in_1.2s_ease_forwards]">
          <HeroGlobe markers={markers} onHover={(m, pos) => setHover(m && pos ? { m, ...pos } : null)} />
        </div>
      )}

      {/* hover / focus readout */}
      {card && detail && (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-xl border border-white/10 bg-[#060d1c]/95 p-3 text-xs shadow-2xl backdrop-blur"
          style={
            hover
              ? { left: Math.min(hover.x + 14, 9999), top: hover.y + 14 }
              : { left: `${Math.min(70, project(card.lat, card.lon).x)}%`, top: `${project(card.lat, card.lon).y + 3}%` }
          }
          role="status"
        >
          <div className="font-display text-sm font-semibold text-white">{detail.name}</div>
          <div className="text-slate-400">
            {detail.country} · {detail.basin}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 telemetry">
            <dt className="text-slate-500">Flood 72h</dt>
            <dd style={{ color: riskColor(detail.floodRisk) }}>{Math.round(detail.floodProb72h * 100)}%</dd>
            <dt className="text-slate-500">Salinity</dt>
            <dd style={{ color: riskColor(detail.salinityRisk) }}>{detail.ecCurrent.toFixed(1)} dS/m</dd>
            <dt className="text-slate-500">Rain 72h</dt>
            <dd className="text-sky-300">{Math.round(detail.rainfall72hMm)} mm</dd>
          </dl>
          <div className="mt-2 text-[10px] text-slate-500">{detail.liveSource === "open-meteo" ? "Live · Open-Meteo / GloFAS" : "Seeded baseline · live refresh pending"}</div>
        </div>
      )}
    </div>
  );
}
