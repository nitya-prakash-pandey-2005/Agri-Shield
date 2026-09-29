"use client";

/**
 * Cyclone simulator — replay a real IBTrACS storm (or draw your own) over the
 * workspace portfolio: Holland wind footprint, surge index, surge flooding via
 * the inundation engine, wind/surge damage, insured loss and loan PD shock.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Eraser, Hand, Home, Pause, Play, Search, Tornado, Waves, Wind, Zap } from "lucide-react";
import { Panel, Skeleton } from "@/components/hud";
import { axisProps, Btn, ErrorBox, Kpi, num, Slider, tooltipStyle, usd, VIZ, WhatThisMeans, inputCls } from "@/components/insurance/kit";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { decodeFlood, decodeWind, paintFlood, paintWind, surgeColor, WIND_LEGEND, type WindRaster } from "./codec";
import { Caveats, Chip, exportCsv, exportPdf, ha, MethodExplain, people, ResultActions, TYPE_LABEL, useMapHandle } from "./common";

const BaseMap = dynamic(() => import("@/components/maps/BaseMap"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

type Ctx = RouterOutputs["simulate"]["context"];
type Result = RouterOutputs["simulate"]["runCyclone"];
export interface CyclonePrefill {
  trackId?: string;
  custom?: { name?: string; speedKmh: number; points: { lat: number; lon: number; windKt: number }[] };
  intensityScale?: number;
  shelfFactor?: number;
}

const kmh = (ms: number) => Math.round(ms * 3.6);
const catOf = (v: number) => (v >= 70 ? "5" : v >= 58 ? "4" : v >= 50 ? "3" : v >= 43 ? "2" : v >= 33 ? "1" : v >= 17.5 ? "TS" : "TD");
const catColor = (v: number) => {
  let c = "#94a3b8";
  for (const s of WIND_LEGEND) if (v >= s.min) c = `rgb(${s.color.join(",")})`;
  return c;
};

/** Holland (1980) symmetric surface wind for the profile chart (mirrors the server). */
function holland(rKm: number, p: { rmax: number; b: number; pc: number; lat: number }) {
  const r = Math.max(0.5, rKm) * 1000;
  const R = p.rmax * 1000;
  const dp = Math.max(1, 1010 - p.pc) * 100;
  const f = Math.abs(2 * 7.292e-5 * Math.sin((p.lat * Math.PI) / 180));
  const x = Math.pow(R / r, p.b);
  return 0.8 * (Math.sqrt((p.b / 1.15) * x * dp * Math.exp(-x) + ((r * f) / 2) ** 2) - (r * f) / 2);
}

export default function CycloneLab({ ctx, prefill }: { ctx: Ctx; prefill?: CyclonePrefill | null }) {
  const [scope, setScope] = useState<"portfolio" | "all">("portfolio");
  const tracks = trpc.simulate.tracks.useQuery({ near: scope });
  const [q, setQ] = useState("");
  const [trackId, setTrackId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [custom, setCustom] = useState<{ lat: number; lon: number; windKt: number }[]>([]);
  const [speed, setSpeed] = useState(18);
  const [scale, setScale] = useState(1);
  const [shelf, setShelf] = useState(4000);
  const [landOnly, setLandOnly] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [wind, setWind] = useState<WindRaster | null>(null);
  const [tIdx, setTIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const preview = trpc.simulate.trackPoints.useQuery({ id: trackId ?? "" }, { enabled: !!trackId && !drawMode });
  const run = trpc.simulate.runCyclone.useMutation({
    onSuccess: async (r) => {
      setResult(r);
      setWind(await decodeWind(r.footprint));
      setTIdx(null);
    },
  });

  useEffect(() => {
    if (!trackId && tracks.data?.tracks.length) setTrackId(tracks.data.tracks.find((t) => /amphan|remal|sidr|fani/i.test(t.name))?.id ?? tracks.data.tracks[0]!.id);
  }, [tracks.data, trackId]);

  const doRun = (over?: CyclonePrefill) => {
    const useCustom = over ? !!over.custom : drawMode;
    if (useCustom) {
      const c = over?.custom ?? { speedKmh: speed, points: custom, name: "Custom storm" };
      if (c.points.length < 2) return;
      run.mutate({ custom: { name: c.name ?? "Custom storm", speedKmh: c.speedKmh, points: c.points }, intensityScale: over?.intensityScale ?? scale, shelfFactor: over?.shelfFactor ?? shelf });
    } else {
      const id = over?.trackId ?? trackId;
      if (!id) return;
      run.mutate({ trackId: id, intensityScale: over?.intensityScale ?? scale, shelfFactor: over?.shelfFactor ?? shelf });
    }
  };

  const prefillKey = useRef<string | null>(null);
  useEffect(() => {
    if (!prefill) return;
    const k = JSON.stringify(prefill);
    if (prefillKey.current === k) return;
    prefillKey.current = k;
    if (prefill.custom) {
      setDrawMode(true);
      setCustom(prefill.custom.points);
      setSpeed(prefill.custom.speedKmh);
    } else if (prefill.trackId) {
      setDrawMode(false);
      setTrackId(prefill.trackId);
    }
    setScale(prefill.intensityScale ?? 1);
    setShelf(prefill.shelfFactor ?? 4000);
    doRun(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // playback
  const steps = result?.track ?? [];
  useEffect(() => {
    if (!playing || !steps.length) return;
    const id = setInterval(() => {
      setTIdx((i) => {
        const n = (i ?? -1) + 1;
        if (n >= steps.length) {
          setPlaying(false);
          return null;
        }
        return n;
      });
    }, 120);
    return () => clearInterval(id);
  }, [playing, steps.length]);
  const cur = tIdx != null ? steps[tIdx] : null;

  // ── map ──
  const { handle, onReady } = useMapHandle();
  const layers = useRef<{ fp?: Leaflet.ImageOverlay; sf?: Leaflet.ImageOverlay; track?: Leaflet.LayerGroup; assets?: Leaflet.LayerGroup; storm?: Leaflet.LayerGroup; surge?: Leaflet.LayerGroup; draw?: Leaflet.LayerGroup }>({});
  const fpCanvas = useRef<HTMLCanvasElement | null>(null);
  const cb = useRef({ drawMode, setCustom });
  cb.current = { drawMode, setCustom };

  useEffect(() => {
    if (!handle) return;
    const click = (e: Leaflet.LeafletMouseEvent) => {
      if (!cb.current.drawMode) return;
      cb.current.setCustom((pts) => (pts.length >= 40 ? pts : [...pts, { lat: Math.round(e.latlng.lat * 100) / 100, lon: Math.round(e.latlng.lng * 100) / 100, windKt: pts.length ? pts[pts.length - 1]!.windKt : 90 }]));
    };
    handle.map.on("click", click);
    return () => void handle.map.off("click", click);
  }, [handle]);

  // footprint overlay (grows during playback)
  useEffect(() => {
    if (!handle || !wind) return;
    const canvas = (fpCanvas.current ??= document.createElement("canvas"));
    paintWind(canvas, wind, landOnly, cur ? cur.t : Infinity);
    const b: Leaflet.LatLngBoundsExpression = [
      [wind.bounds.south, wind.bounds.west],
      [wind.bounds.north, wind.bounds.east],
    ];
    if (!layers.current.fp) {
      layers.current.fp = handle.L.imageOverlay(canvas.toDataURL(), b, { opacity: 0.75, interactive: false }).addTo(handle.map);
    } else {
      layers.current.fp.setUrl(canvas.toDataURL());
      layers.current.fp.setBounds(handle.L.latLngBounds(b));
    }
  }, [handle, wind, landOnly, cur]);

  useEffect(() => {
    // new result → reset overlays & fit
    for (const k of ["fp", "sf"] as const) {
      layers.current[k]?.remove();
      layers.current[k] = undefined;
    }
    if (!handle || !result) return;
    const lats = result.track.map((p) => p.lat);
    const lons = result.track.map((p) => p.lon);
    const inWin = result.assets.map((a) => [a.lat, a.lon] as [number, number]);
    const pts: [number, number][] = inWin.length ? inWin : lats.map((la, i) => [la, lons[i]!]);
    if (result.storm.landfall) pts.push([result.storm.landfall.lat, result.storm.landfall.lon]);
    handle.map.fitBounds(handle.L.latLngBounds(pts).pad(0.35), { maxZoom: 8 });
    // surge-flood focus raster at its fixed level
    if (result.surgeFlood) {
      const sfr = result.surgeFlood;
      void decodeFlood(sfr.raster).then((r) => {
        const c = document.createElement("canvas");
        paintFlood(c, r, sfr.input.riseM, { showWater: false, showTerrain: false });
        layers.current.sf?.remove();
        layers.current.sf = handle.L.imageOverlay(c.toDataURL(), [
          [r.bounds.south, r.bounds.west],
          [r.bounds.north, r.bounds.east],
        ], { opacity: 0.9, interactive: false }).addTo(handle.map);
      });
    }
  }, [handle, result]);

  // track (preview, custom or result) + surge points + storm marker + assets
  useEffect(() => {
    if (!handle) return;
    const { map, L } = handle;
    layers.current.track?.remove();
    const g = L.layerGroup().addTo(map);
    layers.current.track = g;
    const line: { lat: number; lon: number; v: number }[] = drawMode
      ? custom.map((p) => ({ lat: p.lat, lon: p.lon, v: p.windKt * 0.5144 * scale ** 0.5 }))
      : result
        ? result.track.map((p) => ({ lat: p.lat, lon: p.lon, v: p.vmax }))
        : (preview.data?.points ?? []).map((p) => ({ lat: p.lat, lon: p.lon, v: p.windMs }));
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!;
      const b = line[i]!;
      L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: catColor(Math.max(a.v, b.v)), weight: 3, opacity: 0.9 }).addTo(g);
    }
    line.forEach((p, i) => {
      if (drawMode || i % (result ? 6 : 1) === 0) L.circleMarker([p.lat, p.lon], { radius: drawMode ? 5 : 3, color: "#020617", weight: 1, fillColor: catColor(p.v), fillOpacity: 1 }).bindTooltip(`${kmh(p.v)} km/h · Cat ${catOf(p.v)}`).addTo(g);
    });
    if (!result && line.length && !drawMode) map.fitBounds(L.latLngBounds(line.map((p) => [p.lat, p.lon] as [number, number])).pad(0.2), { maxZoom: 7 });
  }, [handle, drawMode, custom, preview.data, result, scale]);

  useEffect(() => {
    if (!handle) return;
    const { map, L } = handle;
    layers.current.surge?.remove();
    const g = L.layerGroup().addTo(map);
    layers.current.surge = g;
    for (const [la, lo, m] of result?.surgePoints ?? []) L.circleMarker([la, lo], { radius: 3 + Math.min(5, m), color: surgeColor(m), weight: 0, fillColor: surgeColor(m), fillOpacity: 0.85 }).bindTooltip(`Surge index ${m.toFixed(1)} m`).addTo(g);
  }, [handle, result]);

  useEffect(() => {
    if (!handle) return;
    const { map, L } = handle;
    layers.current.storm?.remove();
    if (!cur) return;
    const g = L.layerGroup().addTo(map);
    layers.current.storm = g;
    if (cur.r17) L.circle([cur.lat, cur.lon], { radius: cur.r17 * 1000, color: "#facc15", weight: 1, fillOpacity: 0.04, dashArray: "4 4" }).addTo(g);
    if (cur.r33) L.circle([cur.lat, cur.lon], { radius: cur.r33 * 1000, color: "#ef4444", weight: 1.5, fillOpacity: 0.08 }).addTo(g);
    L.marker([cur.lat, cur.lon], { icon: L.divIcon({ className: "", html: `<div style="width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 18px ${catColor(cur.vmax)};background:${catColor(cur.vmax)};animation:spin 1.2s linear infinite"></div>` }) }).addTo(g);
  }, [handle, cur]);

  useEffect(() => {
    if (!handle) return;
    const { map, L } = handle;
    layers.current.assets?.remove();
    const g = L.layerGroup().addTo(map);
    layers.current.assets = g;
    const byId = new Map((result?.assets ?? []).map((a) => [a.id, a]));
    for (const a of ctx.assets) {
      const r = byId.get(a.id);
      const color = !r ? "#94a3b8" : r.damage >= 0.5 ? "#f43f5e" : r.damage >= 0.15 ? "#fb923c" : r.damage > 0.01 ? "#facc15" : "#4ade80";
      L.circleMarker([a.lat, a.lon], { radius: r ? 5 : 3, color: "#020617", weight: 1, fillColor: color, fillOpacity: r ? 0.95 : 0.5 })
        .bindTooltip(`<b>${a.name}</b><br/>${TYPE_LABEL[a.type] ?? a.type} · ${usd(a.valueUsd)}${r ? `<br/>Peak wind ${kmh(r.maxWindMs)} km/h (Cat ${r.category})${r.surgeDepthM ? `<br/>Surge depth ${r.surgeDepthM.toFixed(2)} m` : ""}<br/>Damage ${Math.round(r.damage * 100)}% → ${usd(r.lossUsd)}` : ""}`)
        .addTo(g);
    }
  }, [handle, ctx.assets, result]);

  useEffect(
    () => () => {
      for (const l of Object.values(layers.current)) l?.remove();
    },
    []
  );

  const list = useMemo(() => (tracks.data?.tracks ?? []).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || String(t.season).includes(q)), [tracks.data, q]);
  const peakStep = steps.length ? steps.reduce((a, b) => (b.vmax > a.vmax ? b : a)) : null;
  const profile = useMemo(() => (peakStep ? Array.from({ length: 61 }, (_, i) => ({ r: i * 5, v: Math.round(holland(i * 5, peakStep) * 3.6) })) : []), [peakStep]);

  const T = result?.totals;
  const narrative = result && T
    ? `${result.storm.name}${result.storm.season ? ` (${result.storm.season})` : ""} peaked at ${kmh(result.storm.peakWindMs)} km/h${result.storm.landfall ? ` and made landfall near ${result.storm.landfall.lat.toFixed(1)}°, ${result.storm.landfall.lon.toFixed(1)}°` : ""}${(result.input.intensityScale ?? 1) !== 1 ? ` (here re-run ${(result.input.intensityScale ?? 1) > 1 ? "stronger" : "weaker"}, ×${(result.input.intensityScale ?? 1).toFixed(2)} pressure drop)` : ""}. Hurricane-force winds (≥ 119 km/h) covered ${ha(result.areaHa.cat1)} of land${result.people.cat1 ? ` where about ${people(result.people.cat1)} people live` : ""}. ${T.assetsHit ? `${T.assetsHit} of your assets were in gale-force winds or surge; estimated damage ${usd(T.lossUsd)} (${usd(T.windLossUsd)} wind, ${usd(T.surgeLossUsd)} surge)${T.insuredLossUsd ? `, insured loss ${usd(T.insuredLossUsd)}` : ""}${T.elUpliftUsd ? `, extra expected credit loss ${usd(T.elUpliftUsd)}` : ""}.` : "None of your assets were in damaging winds."} ${T.households ? `${num(T.households)} households in your communities were in the storm's path. ` : ""}The surge index reached ${result.surgeMaxM.toFixed(1)} m on the most exposed coast${result.surgeFlood ? `; flooding the nearest coast to your assets at that level wets ${ha(result.surgeFlood.levels[Math.round(result.surgeFlood.input.riseM / 0.1)]?.floodedHa ?? 0)}` : ""}.`
    : "";

  const rows = () =>
    (result?.assets ?? []).map((a) => ({ id: a.id, name: a.name, type: a.type, crop: a.crop ?? "", lat: a.lat, lon: a.lon, value_usd: a.valueUsd, max_wind_kmh: kmh(a.maxWindMs), category: a.category, hour_of_max: a.hourOfMax, wind_damage_pct: Math.round(a.windDamage * 100), surge_index_m: a.surgeM, surge_depth_m: a.surgeDepthM, surge_method: a.method, damage_pct: Math.round(a.damage * 100), loss_usd: a.lossUsd, insured_loss_usd: a.insuredLossUsd ?? "", el_uplift_usd: a.elUpliftUsd ?? "", pd_base: a.pdBase ?? "", pd_stressed: a.pdStressed ?? "" }));

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <Panel title="1 · Storm" icon={Tornado} accent="violet" subtitle={drawMode ? "Custom track — click the map to add points" : "Real best tracks (NOAA IBTrACS)"}>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Chip active={!drawMode} onClick={() => setDrawMode(false)}>Historical</Chip>
            <Chip active={drawMode} onClick={() => setDrawMode(true)}>
              <Hand size={11} className="mr-1 inline" />
              Draw custom
            </Chip>
          </div>
          {!drawMode ? (
            <>
              <div className="mb-2 flex gap-1.5">
                <Chip active={scope === "portfolio"} onClick={() => setScope("portfolio")}>Near my assets</Chip>
                <Chip active={scope === "all"} onClick={() => setScope("all")}>All ({"Asia-Pacific"})</Chip>
              </div>
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-2.5 text-slate-500" />
                <input className={`${inputCls} pl-7`} placeholder="Search Amphan, 2024…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search storms" />
              </div>
              <div className="max-h-[260px] space-y-1 overflow-auto pr-1">
                {tracks.isLoading && <Skeleton className="h-40" />}
                {list.map((t) => (
                  <button key={t.id} onClick={() => setTrackId(t.id)} className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] ${trackId === t.id ? "border-violet-400/60 bg-violet-400/10 text-white" : "border-slate-800 text-slate-300 hover:border-slate-600"}`}>
                    <span>
                      <b>{t.name}</b> {t.season} <span className="text-[10px] text-slate-500">{t.basin}{t.source.includes("classic") ? " · classic" : ""}</span>
                    </span>
                    <span className="telemetry text-[11px] text-slate-400">
                      {t.maxWindKt ? `${Math.round(t.maxWindKt * 1.852)} km/h` : "—"}
                      {t.closestKm != null ? ` · ${t.closestKm} km` : ""}
                    </span>
                  </button>
                ))}
                {!tracks.isLoading && !list.length && <p className="text-[12px] text-slate-500">No storm matches.</p>}
              </div>
              {tracks.data?.filtered && <p className="mt-1 text-[10.5px] text-slate-500">Storms whose track passed within 500 km of your assets (km = closest approach).</p>}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-[12px] text-cyan-200/80">Click the map to add track points in order (≥ 2). Set wind per point in knots.</p>
              <div className="max-h-[220px] space-y-1 overflow-auto">
                {custom.map((p, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[11.5px] text-slate-300">
                    <span className="w-5 telemetry text-slate-500">{i + 1}</span>
                    <span className="flex-1 telemetry">{p.lat.toFixed(2)}, {p.lon.toFixed(2)}</span>
                    <input type="number" min={20} max={185} value={p.windKt} onChange={(e) => setCustom((c) => c.map((x, j) => (j === i ? { ...x, windKt: Math.max(20, Math.min(185, Number(e.target.value) || 20)) } : x)))} className={`${inputCls} h-7 w-16 px-1.5 text-[12px]`} aria-label={`Wind at point ${i + 1} (kt)`} />
                    <span className="text-slate-500">kt</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={() => setCustom((c) => c.slice(0, -1))} disabled={!custom.length}>Undo</Btn>
                <Btn variant="ghost" onClick={() => setCustom([])} disabled={!custom.length}>
                  <Eraser size={13} /> Clear
                </Btn>
              </div>
              <Slider label="Forward speed" value={speed} min={5} max={40} onChange={setSpeed} format={(v) => `${v} km/h`} />
            </div>
          )}
        </Panel>
        <Panel title="2 · What if…" icon={Zap} accent="violet">
          <div className="space-y-3">
            <Slider label="Intensity (pressure drop)" value={scale} min={0.7} max={1.4} step={0.05} onChange={setScale} format={(v) => `×${v.toFixed(2)}`} hint="×1.2 ≈ a storm 10 % windier than recorded (V ∝ √Δp)" />
            <Slider label={<span className="flex items-center gap-1">Shelf factor L/h <MethodExplain k="surge" /></span>} value={shelf} min={1000} max={8000} step={500} onChange={setShelf} format={(v) => v.toLocaleString("en-US")} hint="4000 ≈ broad shallow shelf (N. Bay of Bengal); 1500 ≈ steep coast" />
            <Btn className="w-full" onClick={() => doRun()} loading={run.isPending} disabled={drawMode ? custom.length < 2 : !trackId}>
              <Wind size={14} /> Run storm
            </Btn>
            {run.isPending && <p className="text-[11px] text-slate-500">Rebuilding the wind field hour by hour, then flooding the most exposed coast near your assets…</p>}
            <ErrorBox error={run.error} onRetry={() => doRun()} />
          </div>
        </Panel>
        {peakStep && (
          <Panel title={<span className="flex items-center gap-1">Wind profile at peak <MethodExplain k="holland" /></span>} icon={Wind} accent="violet" subtitle={`Rmax ${peakStep.rmax} km · B ${peakStep.b} · ${peakStep.pc} hPa`}>
            <div className="h-[150px]">
              <ResponsiveContainer>
                <LineChart data={profile} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="r" {...axisProps} tickFormatter={(v) => `${v}`} interval={11} />
                  <YAxis {...axisProps} width={40} />
                  <Tooltip {...tooltipStyle} labelFormatter={(v) => `${v} km from centre`} formatter={(v: number) => [`${v} km/h`, "Wind"]} />
                  <ReferenceLine x={Math.round(peakStep.rmax / 5) * 5} stroke="#a78bfa" strokeDasharray="3 3" />
                  <Line dataKey="v" stroke={VIZ.s7} dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10.5px] text-slate-500">Distance from the eye (km) vs 1-min wind (km/h); dashed = radius of maximum winds.</p>
          </Panel>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <Panel
          title="Storm replay"
          icon={Tornado}
          accent="violet"
          live={!!result}
          subtitle={result ? `${result.storm.name} · ${result.footprint.width}×${result.footprint.height} cells · ${(result.timings.computeMs / 1000).toFixed(1)} s` : drawMode ? `${custom.length} custom points` : preview.data ? `${preview.data.meta.name} ${preview.data.meta.season} — press Run storm` : "Choose a storm"}
          actions={result && <Chip active={landOnly} onClick={() => setLandOnly((v) => !v)}>Land only</Chip>}
          bodyClassName="px-0 pb-0"
        >
          <div className="relative h-[420px] md:h-[520px]">
            <BaseMap center={ctx.workspace.center as [number, number]} zoom={5} onReady={onReady} />
            {run.isPending && (
              <div className="absolute inset-0 z-[550] grid place-items-center bg-[#050b18]/50">
                <div className="flex items-center gap-2 rounded-lg border border-violet-400/30 bg-[#050b18]/90 px-3 py-2 text-[12px] text-violet-100">
                  <Tornado size={14} className="animate-spin" /> Spinning up the vortex…
                </div>
              </div>
            )}
            <div className="absolute bottom-8 left-2 z-[500] rounded-lg border border-white/10 bg-[#050b18]/85 p-2 text-[10px] text-slate-300">
              <div className="hud-label mb-1">Peak wind</div>
              {WIND_LEGEND.map((l) => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-3.5 rounded-sm" style={{ background: `rgb(${l.color.join(",")})` }} /> {l.label}
                </div>
              ))}
              <div className="mt-1 hud-label">Surge index</div>
              {[0.5, 1, 2, 3].map((m) => (
                <div key={m} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: surgeColor(m) }} /> {m === 3 ? "≥ 3 m" : `≥ ${m} m`}
                </div>
              ))}
            </div>
            {cur && (
              <div className="absolute right-2 top-2 z-[500] rounded-lg border border-violet-400/30 bg-[#050b18]/90 px-3 py-2 text-[11px] text-slate-200 telemetry">
                T+{Math.round(cur.t)} h · {kmh(cur.vmax)} km/h · Cat {catOf(cur.vmax)} · {cur.pc} hPa
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-800/80 px-4 py-3">
            <button onClick={() => (steps.length ? (setPlaying((p) => !p), tIdx == null && setTIdx(0)) : undefined)} disabled={!result} className="grid h-9 w-9 place-items-center rounded-full bg-violet-400 text-slate-950 disabled:opacity-40" aria-label={playing ? "Pause" : "Play storm"}>
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <input type="range" min={0} max={Math.max(0, steps.length - 1)} value={tIdx ?? Math.max(0, steps.length - 1)} onChange={(e) => (setPlaying(false), setTIdx(Number(e.target.value)))} disabled={!result} className="min-w-[160px] flex-1 accent-violet-400" aria-label="Storm time" />
            <span className="telemetry text-[12px] text-slate-400">{cur ? `T+${Math.round(cur.t)} h` : result ? "full footprint" : "—"}</span>
          </div>
        </Panel>

        {result && T ? (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              <Kpi label="Peak wind" value={`${kmh(result.storm.peakWindMs)} km/h`} sub={`Cat ${catOf(result.storm.peakWindMs)} · ${result.storm.minPcHpa} hPa`} tone="bad" />
              <Kpi label="≥ Cat 1 land" value={ha(result.areaHa.cat1)} sub={`${people(result.people.cat1)} people`} tone={result.areaHa.cat1 ? "warn" : "neutral"} />
              <Kpi label="Assets hit" value={`${T.assetsHit} / ${result.assets.length}`} sub={`${usd(T.exposureHitUsd)} exposed`} tone={T.assetsHit ? "bad" : "good"} />
              <Kpi label={<>Loss <MethodExplain k="fragility" /></>} value={usd(T.lossUsd)} sub={`wind ${usd(T.windLossUsd)} · surge ${usd(T.surgeLossUsd)}`} tone={T.lossUsd ? "bad" : "neutral"} />
              <Kpi label="Insured / credit" value={usd(T.insuredLossUsd || T.elUpliftUsd)} sub={T.insuredLossUsd ? "insured loss" : T.elUpliftUsd ? "extra expected credit loss" : "—"} />
              <Kpi label={<>Max surge <MethodExplain k="surge" /></>} value={`${result.surgeMaxM.toFixed(1)} m`} sub={result.surgeFlood ? `flooded ${ha(result.surgeFlood.levels[Math.round(result.surgeFlood.input.riseM / 0.1)]?.floodedHa ?? 0)}` : "index"} tone={result.surgeMaxM >= 2 ? "bad" : "warn"} />
            </div>
            <WhatThisMeans tone={T.lossUsd ? "rose" : "sky"}>{narrative}</WhatThisMeans>
            <Panel title="Assets in the storm window" icon={Home} accent="violet" subtitle={`${result.assets.length} assets · sorted by loss`} bodyClassName="px-0">
              {result.assets.length ? (
                <div className="max-h-[360px] overflow-auto">
                  <table className="w-full min-w-[680px] text-[12px]">
                    <thead className="sticky top-0 bg-[#070d1c] text-left text-[10.5px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-2">Asset</th>
                        <th className="px-2 py-2 text-right">Peak wind</th>
                        <th className="px-2 py-2 text-right">Surge</th>
                        <th className="px-2 py-2 text-right">Damage</th>
                        <th className="px-2 py-2 text-right">Loss</th>
                        <th className="px-4 py-2 text-right">Insured / ΔPD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.assets.slice(0, 200).map((a) => (
                        <tr key={a.id} className="border-t border-slate-800/70">
                          <td className="px-4 py-1.5">
                            <div className="text-slate-100">{a.name}</div>
                            <div className="text-[10.5px] text-slate-500">{TYPE_LABEL[a.type] ?? a.type}{a.crop ? ` · ${a.crop}` : ""}</div>
                          </td>
                          <td className="px-2 text-right telemetry" style={{ color: catColor(a.maxWindMs) }}>
                            {kmh(a.maxWindMs)} km/h <span className="text-[10px] text-slate-500">{a.category !== "—" ? `Cat ${a.category}` : ""}</span>
                          </td>
                          <td className="px-2 text-right telemetry text-slate-300" title={a.method === "engine" ? "Connectivity-aware inundation engine" : "Point estimate: coast surge − 10 cm/km inland − ground height"}>
                            {a.surgeDepthM > 0 ? `${a.surgeDepthM.toFixed(2)} m` : "—"}
                          </td>
                          <td className="px-2 text-right telemetry text-slate-200">{Math.round(a.damage * 100)}%</td>
                          <td className="px-2 text-right telemetry text-white">{usd(a.lossUsd)}</td>
                          <td className="px-4 text-right telemetry text-slate-300">{a.insuredLossUsd != null ? usd(a.insuredLossUsd) : a.pdStressed != null ? `${(a.pdBase! * 100).toFixed(1)}→${(a.pdStressed * 100).toFixed(1)}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 pb-2 text-[12px] text-slate-400">No assets of this workspace fall inside the storm window.</p>
              )}
            </Panel>
            <ResultActions
              simId={result.id}
              defaultName={`Cyclone ${result.storm.name}${result.storm.season ? ` ${result.storm.season}` : ""}${(result.input.intensityScale ?? 1) !== 1 ? ` ×${(result.input.intensityScale ?? 1).toFixed(2)}` : ""}`}
              csv={() => exportCsv(`cyclone-${result.storm.name.toLowerCase()}.csv`, rows())}
              pdf={() =>
                exportPdf(
                  {
                    title: `Cyclone scenario: ${result.storm.name}${result.storm.season ? ` ${result.storm.season}` : ""}`,
                    subtitle: `${result.storm.source} · intensity ×${(result.input.intensityScale ?? 1).toFixed(2)} · shelf factor ${result.input.shelfFactor ?? 4000} · ${new Date(result.createdAt).toUTCString()}`,
                    narrative,
                    kpis: [
                      ["Peak wind (track)", `${kmh(result.storm.peakWindMs)} km/h`],
                      ["Land in >= Cat 1 winds", ha(result.areaHa.cat1)],
                      ["People in >= Cat 1 winds", people(result.people.cat1)],
                      ["Assets hit", `${T.assetsHit} of ${result.assets.length}`],
                      ["Loss (wind + surge)", usd(T.lossUsd)],
                      ["Insured loss", usd(T.insuredLossUsd)],
                      ["Extra expected credit loss", usd(T.elUpliftUsd)],
                      ["Max surge index", `${result.surgeMaxM} m`],
                    ],
                    table: { head: ["Asset", "Type", "Peak km/h", "Cat", "Surge m", "Damage %", "Loss"], body: result.assets.slice(0, 40).map((a) => [a.name, TYPE_LABEL[a.type] ?? a.type, kmh(a.maxWindMs), a.category, a.surgeDepthM, Math.round(a.damage * 100), usd(a.lossUsd)]) },
                    caveats: result.caveats,
                    sources: result.sources,
                    image: fpCanvas.current?.toDataURL() ?? null,
                  },
                  `cyclone-${result.storm.name.toLowerCase()}.pdf`
                )
              }
              incident={{ title: `Cyclone ${result.storm.name} impact scenario`, summary: narrative }}
            />
            <Caveats items={result.caveats} sources={result.sources} />
          </>
        ) : (
          !run.isPending && (
            <WhatThisMeans>
              Pick a real storm that passed near your assets (Amphan, Remal, Sidr, Fani…) or draw your own track, then <b>Run storm</b>. We rebuild its winds hour by hour from the official best track, estimate the storm surge along the coast, flood the most exposed shoreline near your portfolio and price the damage to every asset. Press play to watch the storm cross.
            </WhatThisMeans>
          )
        )}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
