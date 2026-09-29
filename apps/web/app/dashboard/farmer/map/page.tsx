"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CloudRain, Crosshair, Droplets, Layers, Leaf, Loader2, Pause, Play, Radar, Satellite, Sprout, Waves, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Skeleton, SourceTag } from "@/components/hud";
import type { FarmerMapLayers } from "@/components/maps/FarmerMap";
import { NowcastHint } from "@/components/farmer/NowcastHint";

const FarmerMap = dynamic(() => import("@/components/maps/FarmerMap"), { ssr: false, loading: () => <Skeleton className="h-full w-full rounded-none" /> });
const RadarMap = dynamic(() => import("@/components/farmer/RadarMap"), { ssr: false, loading: () => <Skeleton className="h-full w-full rounded-none" /> });

const LEVEL = (s: number) => (s >= 80 ? "critical" : s >= 60 ? "high" : s >= 35 ? "medium" : "low");
const clamp = (v: number) => Math.max(0, Math.min(100, v));

function Toggle({ on, onChange, label, icon: Icon, color }: { on: boolean; onChange: (v: boolean) => void; label: string; icon: typeof Layers; color: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-slate-200 hover:bg-white/5">
      <Icon size={15} style={{ color }} />
      <span className="flex-1">{label}</span>
      <span className={cn("relative h-5 w-9 rounded-full transition-colors", on ? "bg-emerald-500" : "bg-slate-700")}>
        <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow", on ? "right-0.5" : "left-0.5")} />
      </span>
    </button>
  );
}

function MapScreen() {
  const { t, tx, fmt } = useI18n();
  const params = useSearchParams();
  const focus = params?.get("field") ?? null;
  const fields = trpc.farmer.getFields.useQuery();
  const risk = trpc.farmer.getCurrentRisk.useQuery();
  const layersQ = trpc.farmer.getMapLayers.useQuery({ withWater: true }, { staleTime: 30 * 60_000 });
  const [mode, setMode] = useState<"forecast" | "history">("forecast");
  const history = trpc.farmer.getHistory.useQuery({ days: 30 }, { enabled: mode === "history", staleTime: 60 * 60_000 });
  const [layers, setLayers] = useState<FarmerMapLayers>({ flood: true, salinity: false, ndvi: false, rain: false, water: true, fields: true, satellite: false });
  const [opacity, setOpacity] = useState<Record<string, number>>({ flood: 0.5, salinity: 0.5, ndvi: 0.7, rain: 0.75, fields: 0.65, water: 0.85 });
  const [panel, setPanel] = useState(false);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const [radar, setRadar] = useState(params?.get("radar") === "1");
  const nowcast = trpc.farmer.nowcast.useQuery(undefined, { staleTime: 5 * 60_000, refetchInterval: 10 * 60_000 });

  useEffect(() => setPanel(window.innerWidth >= 1024), []);

  const hourly = risk.data?.hourly ?? [];
  const days = history.data?.daily ?? [];
  const steps = mode === "forecast" ? hourly.length : days.length;
  useEffect(() => setIdx(mode === "forecast" ? 0 : Math.max(0, days.length - 1)), [mode, days.length]);
  useEffect(() => {
    if (!playing || steps < 2) return;
    const tm = setInterval(() => setIdx((i) => (i + 1) % steps), mode === "forecast" ? 120 : 260);
    return () => clearInterval(tm);
  }, [playing, steps, mode]);

  // Time-scaled field scores: forecast → hourly model probability relative to the 72h peak;
  // history → ERA5-derived daily flood index relative to today's.
  const p72 = risk.data?.flood.p72 || 0.01;
  const nowFlood = days.length ? Math.max(1, days[days.length - 1]!.floodIndex) : 1;
  const factor = mode === "forecast" ? (hourly[idx] ? hourly[idx]!.probability / p72 : 1) : days[idx] ? days[idx]!.floodIndex / nowFlood : 1;
  const mapFields = useMemo(
    () =>
      (fields.data ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        crop: f.cropType,
        ring: f.geometry.coordinates[0] ?? [],
        lat: f.lat,
        lon: f.lon,
        floodRisk: f.floodRisk,
        salinityRisk: f.salinityRisk,
        soilEc: f.soilEc,
        ndvi: f.ndvi,
        score: clamp(Math.max(f.floodRisk * Math.min(1.6, factor), f.salinityRisk * 0.9 * (layers.salinity ? 1 : 0))),
      })),
    [fields.data, factor, layers.salinity]
  );
  const districts = useMemo(() => (layersQ.data?.districts ?? []).map((d) => ({ id: d.id, name: d.name, ring: d.geometry.coordinates[0] ?? [], floodRisk: d.floodRisk, salinityRisk: d.salinityRisk, floodProb72h: d.floodProb72h, ecCurrent: d.ecCurrent })), [layersQ.data]);
  const center: [number, number] | null = layersQ.data ? [layersQ.data.center.lat, layersQ.data.center.lon] : null;

  const labels = useMemo(
    () => ({
      flood: t("map.floodProbability"),
      salinity: t("map.salinity"),
      ndvi: "NDVI",
      ec: "EC",
      district: t("map.district"),
      probability72h: `${t("map.floodProbability")} 72h`,
      meaning: (s: number) => tx(`map.meaning${LEVEL(s)[0]!.toUpperCase()}${LEVEL(s).slice(1)}`),
      level: (s: number) => tx(`risk.${LEVEL(s)}`),
      crop: (c: string) => tx(`crops.${c}`, undefined, c),
    }),
    [t, tx]
  );

  const stepLabel =
    mode === "forecast"
      ? hourly[idx]
        ? `${idx === 0 ? t("common.now") : `+${idx}h`} · ${hourly[idx]!.time.slice(5, 10)} ${hourly[idx]!.time.slice(11, 16)}`
        : "—"
      : days[idx]
        ? fmt.date(`${days[idx]!.date}T12:00:00`, { day: "numeric", month: "short" })
        : "—";
  const stepValue = mode === "forecast" ? (hourly[idx] ? `${Math.round(hourly[idx]!.probability * 100)}% · ${t("map.rainAtTime", { mm: fmt.number(hourly[idx]!.precipMm, { maximumFractionDigits: 1 }) })}` : "") : days[idx] ? `${days[idx]!.floodIndex}% · ${t("map.rainAtTime", { mm: fmt.number(days[idx]!.rainMm, { maximumFractionDigits: 1 }) })}` : "";

  const LAYER_DEFS: { key: keyof FarmerMapLayers; label: string; icon: typeof Layers; color: string; opacity?: boolean }[] = [
    { key: "fields", label: t("map.layerFields"), icon: Sprout, color: "#10b981", opacity: true },
    { key: "flood", label: t("map.layerFlood"), icon: Waves, color: "#ef4444", opacity: true },
    { key: "salinity", label: t("map.layerSalinity"), icon: Droplets, color: "#f59e0b", opacity: true },
    { key: "ndvi", label: t("map.layerNdvi"), icon: Leaf, color: "#84cc16", opacity: true },
    { key: "rain", label: t("map.layerRain"), icon: CloudRain, color: "#38bdf8", opacity: true },
    { key: "water", label: t("map.layerWater"), icon: Waves, color: "#38bdf8" },
    { key: "satellite", label: t("map.satellite"), icon: Satellite, color: "#a78bfa" },
  ];

  return (
    <div className="relative h-[calc(100dvh-3.5rem-4rem-env(safe-area-inset-bottom))] lg:h-[calc(100vh-3.5rem)] w-full overflow-hidden">
      {radar ? (
        nowcast.data?.radar?.frames.length ? (
          <RadarMap
            center={[nowcast.data.center.lat, nowcast.data.center.lon]}
            host={nowcast.data.radar.host}
            frames={nowcast.data.radar.frames}
            rings={mapFields.map((f) => f.ring)}
            labels={{ play: t("map.play"), pause: t("map.pause"), forecast: t("tools.now.forecastFrame"), past: t("tools.now.pastFrame"), now: t("common.now") }}
          />
        ) : nowcast.isLoading ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : (
          <div className="grid h-full place-items-center text-sm text-slate-400">{t("tools.now.radarUnavailable")}</div>
        )
      ) : center ? (
        <FarmerMap center={center} fields={mapFields} districts={districts} waterways={layersQ.data?.waterways ?? null} layers={layers} opacity={opacity} focusFieldId={focus} recenterKey={recenter} labels={labels} />
      ) : (
        <Skeleton className="h-full w-full rounded-none" />
      )}

      {/* Rain nowcast + radar toggle */}
      <div className="absolute left-3 right-3 top-[72px] z-[550] flex flex-col items-start gap-2 sm:right-auto sm:w-80">
        <button
          onClick={() => { setRadar((r) => !r); setPlaying(false); }}
          aria-pressed={radar}
          className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3 text-sm backdrop-blur", radar ? "border-sky-400/60 bg-sky-500/25 text-white" : "border-white/10 bg-[#060a16]/90 text-slate-200 hover:text-sky-300")}
        >
          <Radar size={16} /> {radar ? t("tools.now.backToRisk") : t("tools.now.showRadar")}
        </button>
        <NowcastHint nc={nowcast.data?.nowcast} className="w-full" />
      </div>

      {/* Title */}
      <div className="pointer-events-none absolute left-14 top-3 z-[500] max-w-[calc(100%-10rem)]">
        <div className="pointer-events-auto rounded-xl border border-white/10 bg-[#060a16]/85 px-3 py-2 backdrop-blur">
          <div className="hud-label text-emerald-400/80">{t("nav.map")}</div>
          <div className="font-display text-sm font-semibold text-white">{t("map.title")}</div>
        </div>
      </div>

      {/* Layer control (top-right) */}
      <div className={cn("absolute right-3 top-3 z-[600] flex flex-col items-end gap-2", radar && "hidden")}>
        <div className="flex gap-2">
          <button onClick={() => setRecenter((n) => n + 1)} className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-[#060a16]/90 text-slate-200 backdrop-blur hover:text-emerald-400" aria-label={t("map.centerFarm")} title={t("map.centerFarm")}>
            <Crosshair size={18} />
          </button>
          <button onClick={() => setPanel((p) => !p)} className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-[#060a16]/90 text-slate-200 backdrop-blur hover:text-emerald-400" aria-label={t("map.layers")} aria-expanded={panel}>
            {panel ? <X size={18} /> : <Layers size={18} />}
          </button>
        </div>
        <AnimatePresence>
          {panel && (
            <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} className="hud-panel w-64 p-2">
              <div className="hud-label px-2 pb-1 pt-1">{t("map.layers")}</div>
              {LAYER_DEFS.map((d) => (
                <div key={d.key}>
                  <Toggle on={layers[d.key]} onChange={(v) => setLayers((l) => ({ ...l, [d.key]: v }))} label={d.label} icon={d.icon} color={d.color} />
                  {d.opacity && layers[d.key] && (
                    <label className="flex items-center gap-2 px-2 pb-1.5 text-[10px] text-slate-500">
                      <span className="w-12">{t("map.opacity")}</span>
                      <input type="range" min={0.1} max={1} step={0.05} value={opacity[d.key] ?? 0.6} onChange={(e) => setOpacity((o) => ({ ...o, [d.key]: Number(e.target.value) }))} className="h-1 flex-1 accent-emerald-500" aria-label={`${d.label} ${t("map.opacity")}`} />
                    </label>
                  )}
                </div>
              ))}
              {layers.water && layersQ.data && !layersQ.data.waterways && <p className="px-2 pb-1 text-[10px] text-slate-500">OSM —</p>}
              {layersQ.isFetching && <p className="flex items-center gap-1 px-2 pb-1 text-[10px] text-slate-500"><Loader2 size={10} className="animate-spin" /> {t("map.loadingWater")}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Legend (bottom-left, above timeline) */}
      <div className={cn("absolute bottom-[132px] left-3 z-[500] hidden rounded-xl border border-white/10 bg-[#060a16]/85 p-2.5 backdrop-blur", !radar && "sm:block")}>
        <div className="hud-label mb-1.5">{t("map.legend")}</div>
        {(["low", "medium", "high", "critical"] as const).map((l, i) => (
          <div key={l} className="flex items-center gap-2 text-[11px] text-slate-300">
            <span className="h-2.5 w-4 rounded-sm" style={{ background: ["#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"][i] }} />
            {tx(`risk.${l}`)} <span className="ml-auto pl-3 telemetry text-slate-500">{["<35", "35–60", "60–80", "≥80"][i]}%</span>
          </div>
        ))}
        <div className="mt-1.5 flex flex-wrap gap-1">
          <SourceTag>Open-Meteo · GloFAS</SourceTag>
          {layers.water && layersQ.data?.waterSource && <SourceTag>OSM</SourceTag>}
          {(layers.ndvi || layers.rain) && <SourceTag>NASA GIBS</SourceTag>}
        </div>
      </div>

      {/* Timeline slider */}
      <div className={cn("absolute inset-x-3 bottom-3 z-[600] mx-auto max-w-3xl rounded-2xl border border-white/10 bg-[#060a16]/90 p-3 backdrop-blur-xl", radar && "hidden")}>
        <div className="mb-2 flex items-center gap-2">
          <span className="hud-label">{t("map.timeline")}</span>
          <div className="ml-auto flex rounded-lg bg-slate-900 p-0.5 text-[11px]">
            {(["forecast", "history"] as const).map((m) => (
              <button key={m} onClick={() => { setPlaying(false); setMode(m); }} className={cn("min-h-[32px] rounded-md px-2.5", mode === m ? "bg-emerald-500 text-slate-950 font-semibold" : "text-slate-400")}>
                {m === "forecast" ? t("map.forecast72") : t("map.history30")}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setPlaying((p) => !p)} disabled={steps < 2} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-500 text-slate-950 disabled:opacity-40 active:scale-[0.97]" aria-label={playing ? t("map.pause") : t("map.play")}>
            {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>
          <div className="min-w-0 flex-1">
            <input type="range" min={0} max={Math.max(0, steps - 1)} value={Math.min(idx, Math.max(0, steps - 1))} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} className="w-full accent-emerald-500" aria-label={t("map.timeline")} disabled={steps < 2} />
            <div className="mt-0.5 flex items-center justify-between text-[11px] telemetry">
              <span className="text-white">{mode === "history" && history.isLoading ? t("common.loading") : stepLabel}</span>
              <span className="text-slate-400">{stepValue}</span>
            </div>
          </div>
        </div>
        <div className="mt-1 text-[9px] telemetry uppercase tracking-wider text-slate-600">{mode === "forecast" ? `${risk.data?.flood.modelVersion ?? ""} · Open-Meteo` : history.data?.source ?? "ERA5"}</div>
      </div>
    </div>
  );
}

export default function FarmerMapPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[70vh] w-full" />}>
      <MapScreen />
    </Suspense>
  );
}
