"use client";

/**
 * Flood inundation simulator — pick an area, raise the water, watch it spread.
 * The server computes the connectivity-aware bathtub once for 0…5 m; the
 * client paints any level instantly and animates the rise.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Crosshair, Droplets, Gauge, Home, Layers, MapPin, Pause, Play, Waves, Zap } from "lucide-react";
import { Panel, Skeleton, SourceTag } from "@/components/hud";
import { axisProps, Btn, ErrorBox, Kpi, num, Select, Slider, tooltipStyle, usd, VIZ, WhatThisMeans } from "@/components/insurance/kit";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { decodeFlood, depthAt, DEPTH_LEGEND, paintFlood, rasterIndex, type FloodRaster } from "./codec";
import { Caveats, Chip, exportCsv, exportPdf, ha, MethodExplain, people, ResultActions, TYPE_LABEL, useMapHandle } from "./common";

const BaseMap = dynamic(() => import("@/components/maps/BaseMap"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

type Ctx = RouterOutputs["simulate"]["context"];
type Result = RouterOutputs["simulate"]["runFlood"];
export interface FloodPrefill {
  center: { lat: number; lon: number };
  sizeKm: number;
  sources?: "sea" | "rivers" | "both";
  reference?: "source" | "lowpct";
  rainExcessMm?: number;
  riseM: number;
  label?: string;
}

type AreaSel = { lat: number; lon: number; sizeKm: number; label: string };

export default function FloodLab({ ctx, prefill }: { ctx: Ctx; prefill?: FloodPrefill | null }) {
  const firstPlace = ctx.places[0]!;
  const defaultArea = useMemo<AreaSel>(() => {
    // start where the workspace has the most assets
    const d = ctx.districts.find((x) => x.assets > 0);
    return d ? { lat: d.lat, lon: d.lon, sizeKm: 40, label: `${d.name} (${d.assets} assets)` } : { lat: firstPlace.lat, lon: firstPlace.lon, sizeKm: firstPlace.sizeKm, label: firstPlace.label };
  }, [ctx, firstPlace]);
  const [area, setArea] = useState<AreaSel>(defaultArea);
  const [mode, setMode] = useState<"place" | "district" | "group" | "click">("place");
  const [sources, setSources] = useState<"sea" | "rivers" | "both">("both");
  const [reference, setReference] = useState<"source" | "lowpct">("source");
  const [rainMm, setRainMm] = useState(0);
  const [rise, setRise] = useState(1.5);
  const [playing, setPlaying] = useState(false);
  const [layers, setLayers] = useState({ water: true, terrain: false });
  const [result, setResult] = useState<Result | null>(null);
  const [raster, setRaster] = useState<FloodRaster | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; elev: number; depth: number; cls: number } | null>(null);
  const run = trpc.simulate.runFlood.useMutation({
    onSuccess: async (r) => {
      setResult(r);
      setRaster(await decodeFlood(r.raster));
    },
  });
  const presets = trpc.simulate.floodPresets.useQuery({ lat: area.lat, lon: area.lon }, { staleTime: 5 * 60_000 });

  const doRun = (over?: Partial<FloodPrefill>) => {
    const a = over?.center ? { ...area, lat: over.center.lat, lon: over.center.lon, sizeKm: over.sizeKm ?? area.sizeKm } : area;
    run.mutate({
      center: { lat: a.lat, lon: a.lon },
      sizeKm: a.sizeKm,
      sources: over?.sources ?? sources,
      reference: over?.reference ?? reference,
      rainExcessMm: over?.rainExcessMm ?? rainMm,
      riseM: over?.riseM ?? rise,
      maxRiseM: 5,
      label: a.label,
    });
  };

  // open a saved scenario
  const prefillKey = useRef<string | null>(null);
  useEffect(() => {
    if (!prefill) return;
    const k = JSON.stringify(prefill);
    if (prefillKey.current === k) return;
    prefillKey.current = k;
    setArea({ lat: prefill.center.lat, lon: prefill.center.lon, sizeKm: prefill.sizeKm, label: prefill.label ?? "Saved scenario" });
    if (prefill.sources) setSources(prefill.sources);
    if (prefill.reference) setReference(prefill.reference);
    setRainMm(prefill.rainExcessMm ?? 0);
    setRise(prefill.riseM);
    doRun(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // ── animation ──
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setRise((r) => {
        const n = Math.round((r + 0.1) * 10) / 10;
        if (n > 5) {
          setPlaying(false);
          return 5;
        }
        return n;
      });
    }, 160);
    return () => clearInterval(id);
  }, [playing]);

  const k = result ? Math.min(result.levels.length - 1, Math.round(rise / 0.1)) : 0;
  const L = result?.levels[k];

  // ── map ──
  const { handle, onReady } = useMapHandle();
  const overlayRef = useRef<Leaflet.ImageOverlay | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rectRef = useRef<Leaflet.Rectangle | null>(null);
  const markersRef = useRef<Leaflet.LayerGroup | null>(null);
  const cbRef = useRef({ mode, setArea, area, raster, rise });
  cbRef.current = { mode, setArea, area, raster, rise };

  useEffect(() => {
    if (!handle) return;
    const { map } = handle;
    const click = (e: Leaflet.LeafletMouseEvent) => {
      const c = cbRef.current;
      if (c.mode !== "click") return;
      c.setArea({ lat: e.latlng.lat, lon: e.latlng.lng, sizeKm: c.area.sizeKm, label: `Custom area ${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)}` });
    };
    const move = (e: Leaflet.LeafletMouseEvent) => {
      const c = cbRef.current;
      if (!c.raster) return setHover(null);
      const i = rasterIndex(c.raster, e.latlng.lat, e.latlng.lng);
      if (i == null) return setHover(null);
      setHover({ x: e.containerPoint.x, y: e.containerPoint.y, elev: c.raster.elev[i]! / 10, depth: depthAt(c.raster, i, c.rise), cls: c.raster.cls[i]! });
    };
    const out = () => setHover(null);
    map.on("click", click);
    map.on("mousemove", move);
    map.on("mouseout", out);
    return () => {
      map.off("click", click);
      map.off("mousemove", move);
      map.off("mouseout", out);
    };
  }, [handle]);

  // area rectangle
  useEffect(() => {
    if (!handle) return;
    const { map, L: Lf } = handle;
    const dLat = area.sizeKm / 2 / 111.32;
    const dLon = area.sizeKm / 2 / (111.32 * Math.cos((area.lat * Math.PI) / 180));
    const b: Leaflet.LatLngBoundsExpression = [
      [area.lat - dLat, area.lon - dLon],
      [area.lat + dLat, area.lon + dLon],
    ];
    rectRef.current?.remove();
    rectRef.current = Lf.rectangle(b, { color: "#22d3ee", weight: 1.5, dashArray: "6 5", fill: false, interactive: false }).addTo(map);
    if (!result) map.fitBounds(b, { padding: [20, 20], maxZoom: 11 });
  }, [handle, area, result]);

  // raster overlay (repaint on level / layer change)
  useEffect(() => {
    if (!handle || !raster) return;
    const { map, L: Lf } = handle;
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    paintFlood(canvas, raster, rise, { showWater: layers.water, showTerrain: layers.terrain });
    const url = canvas.toDataURL();
    const bounds: Leaflet.LatLngBoundsExpression = [
      [raster.bounds.south, raster.bounds.west],
      [raster.bounds.north, raster.bounds.east],
    ];
    if (!overlayRef.current) {
      overlayRef.current = Lf.imageOverlay(url, bounds, { opacity: 0.92, interactive: false, className: "sim-raster" }).addTo(map);
      map.fitBounds(bounds, { padding: [10, 10] });
    } else {
      overlayRef.current.setUrl(url);
      overlayRef.current.setBounds(Lf.latLngBounds(bounds));
    }
  }, [handle, raster, rise, layers]);

  useEffect(() => () => void overlayRef.current?.remove(), []);
  useEffect(() => {
    // new run → drop old overlay so it refits
    overlayRef.current?.remove();
    overlayRef.current = null;
  }, [result?.id]);

  // assets
  useEffect(() => {
    if (!handle) return;
    const { map, L: Lf } = handle;
    markersRef.current?.remove();
    const g = Lf.layerGroup().addTo(map);
    markersRef.current = g;
    const byId = new Map((result?.assets ?? []).map((a) => [a.id, a]));
    for (const a of ctx.assets) {
      const r = byId.get(a.id);
      const d = r ? r.depthM[k] ?? 0 : 0;
      const wet = r ? (r.sharePct[k] ?? 0) > 0 : false;
      const color = !r ? "#94a3b8" : wet ? (d >= 1 ? "#f43f5e" : "#fb923c") : "#4ade80";
      Lf.circleMarker([a.lat, a.lon], { radius: r ? 6 : 4, color: "#020617", weight: 1.5, fillColor: color, fillOpacity: r ? 0.95 : 0.6 })
        .bindTooltip(`<b>${a.name}</b><br/>${TYPE_LABEL[a.type] ?? a.type} · ${usd(a.valueUsd)}${r ? `<br/>Depth at +${rise.toFixed(1)} m: <b>${d.toFixed(2)} m</b> · ${r.sharePct[k]}% of footprint wet<br/>Loss ${usd(r.lossUsd[k] ?? 0)}${r.floodsAtM != null ? `<br/>First wet at +${r.floodsAtM.toFixed(1)} m` : ""}` : ""}`, { direction: "top" })
        .addTo(g);
    }
    return () => void g.remove();
  }, [handle, ctx.assets, result, k, rise]);

  // ── narrative ──
  const landHa = result ? Math.round((result.grid.cells * result.grid.pixelM ** 2 * (1 - (result.sourcesFound.seaPct + result.sourcesFound.riverPct) / 100)) / 10_000) : 0;
  const firstWet = result ? result.assets.filter((a) => a.floodsAtM != null).sort((a, b) => a.floodsAtM! - b.floodsAtM!)[0] : null;
  const deepest = L ? (["< 0.5 m", "0.5–1 m", "1–2 m", "> 2 m"] as const)[L.bandsHa.indexOf(Math.max(...L.bandsHa))] : null;
  const narrative = result && L ? `If the water stood ${rise.toFixed(1)} m above normal around ${result.input.label ?? "this area"}, about ${ha(L.floodedHa)} (${landHa ? Math.round((L.floodedHa / landHa) * 100) : 0}% of the land in the ${result.input.sizeKm} km box) would be under water, mostly ${deepest} deep (average ${L.meanDepthM.toFixed(2)} m). ${L.assetsHit ? `${L.assetsHit} of your ${result.assets.length} assets here would get wet, with an estimated ${usd(L.lossUsd)} of damage${L.insuredLossUsd ? ` (${usd(L.insuredLossUsd)} insured loss after deductibles)` : ""}${L.elUpliftUsd ? ` and ${usd(L.elUpliftUsd)} of extra expected credit loss` : ""}.` : result.assets.length ? `None of your ${result.assets.length} assets in this area would get wet at this level.` : "You have no assets inside this area — the map still shows who and what would be exposed."} ${L.households ? `${num(L.households)} households in your communities are in flooded footprints. ` : ""}${L.people != null ? `Roughly ${people(L.people)} people live on the flooded land (census density). ` : ""}${firstWet ? `Your first asset to flood is ${firstWet.name}, at +${firstWet.floodsAtM!.toFixed(1)} m.` : ""}` : "";

  const rows = () =>
    (result?.assets ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      lat: a.lat,
      lon: a.lon,
      value_usd: a.valueUsd,
      elevation_m: a.elevationM,
      floods_at_rise_m: a.floodsAtM ?? "",
      rise_m: rise,
      depth_m: a.depthM[k],
      footprint_wet_pct: a.sharePct[k],
      loss_usd: a.lossUsd[k],
      insured_loss_usd: a.insuredLossUsd?.[k] ?? "",
      el_uplift_usd: a.elUpliftUsd?.[k] ?? "",
      damage_curve: `JRC Asia ${a.curve}`,
    }));

  const tableAssets = useMemo(() => (result ? [...result.assets].sort((a, b) => (b.lossUsd[k] ?? 0) - (a.lossUsd[k] ?? 0) || (a.floodsAtM ?? 99) - (b.floodsAtM ?? 99)) : []), [result, k]);

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      {/* ── controls ── */}
      <div className="space-y-4">
        <Panel title="1 · Area" icon={MapPin} accent="cyan" subtitle={area.label}>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Chip active={mode === "place"} onClick={() => setMode("place")}>Places</Chip>
            <Chip active={mode === "district"} onClick={() => setMode("district")}>District</Chip>
            <Chip active={mode === "group"} onClick={() => setMode("group")}>Asset group</Chip>
            <Chip active={mode === "click"} onClick={() => setMode("click")} title="Click anywhere on the map">
              <Crosshair size={12} className="mr-1 inline" />
              Click map
            </Chip>
          </div>
          {mode === "place" && (
            <div className="space-y-1.5">
              {ctx.places.map((p) => (
                <button key={p.id} onClick={() => ((setArea({ lat: p.lat, lon: p.lon, sizeKm: p.sizeKm, label: p.label }), setRise(p.riseM)))} className={`block w-full rounded-lg border px-2.5 py-1.5 text-left text-[12px] ${area.label === p.label ? "border-cyan-400/50 bg-cyan-400/10 text-white" : "border-slate-800 text-slate-300 hover:border-slate-600"}`}>
                  {p.label} <span className="telemetry text-slate-500">· +{p.riseM} m</span>
                </button>
              ))}
            </div>
          )}
          {mode === "district" && (
            <Select
              ariaLabel="District"
              value={ctx.districts.find((d) => area.label.startsWith(d.name))?.id ?? ""}
              onChange={(id) => {
                const d = ctx.districts.find((x) => x.id === id);
                if (d) setArea({ lat: d.lat, lon: d.lon, sizeKm: 40, label: `${d.name} (${d.assets} assets)` });
              }}
              options={[{ value: "", label: "Choose a district…" }, ...ctx.districts.map((d) => ({ value: d.id, label: `${d.name}, ${d.country}${d.assets ? ` · ${d.assets} assets` : ""}` }))]}
            />
          )}
          {mode === "group" &&
            (ctx.groups.length ? (
              <Select
                ariaLabel="Asset group"
                value=""
                onChange={(tag) => {
                  const gr = ctx.groups.find((x) => x.tag === tag);
                  if (gr) setArea({ lat: gr.center.lat, lon: gr.center.lon, sizeKm: Math.min(60, Math.max(10, gr.spanKm)), label: `Group “${gr.tag}” (${gr.count} assets)` });
                }}
                options={[{ value: "", label: "Choose a tag…" }, ...ctx.groups.map((gr) => ({ value: gr.tag, label: `${gr.tag} · ${gr.count} assets · ${gr.spanKm} km` }))]}
              />
            ) : (
              <p className="text-[12px] text-slate-500">Tag assets in the Portfolio to simulate a group.</p>
            ))}
          {mode === "click" && <p className="text-[12px] text-cyan-200/80">Click the map to centre the simulation box there.</p>}
          <div className="mt-3">
            <Slider label="Box size" value={area.sizeKm} min={5} max={60} step={5} onChange={(v) => setArea({ ...area, sizeKm: v })} format={(v) => `${v} × ${v} km`} hint="≤ 25 km runs at ~18 m pixels, ≤ 60 km at ~35 m" />
          </div>
        </Panel>

        <Panel title="2 · Water sources" icon={Waves} accent="cyan">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {(["both", "sea", "rivers"] as const).map((s) => (
                <Chip key={s} active={sources === s} onClick={() => setSources(s)}>
                  {s === "both" ? "Sea + rivers" : s === "sea" ? "Sea only (coastal)" : "Rivers only"}
                </Chip>
              ))}
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1 text-[12px] text-slate-400">
                Reference level <MethodExplain k="hand" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip active={reference === "source"} onClick={() => setReference("source")}>Normal sea / bank-full</Chip>
                <Chip active={reference === "lowpct"} onClick={() => setReference("lowpct")}>Local low ground (p5)</Chip>
              </div>
            </div>
            <Slider label={<span className="flex items-center gap-1">Rain ponding (excess) <MethodExplain k="ponding" /></span>} value={rainMm} min={0} max={300} step={10} onChange={setRainMm} format={(v) => (v ? `${v} mm` : "off")} hint="Rain that can't soak in, pooling in hollows" />
            <Btn className="w-full" onClick={() => doRun()} loading={run.isPending}>
              <Zap size={14} /> {result ? "Re-run simulation" : "Run simulation"}
            </Btn>
            {run.isPending && <p className="text-[11px] text-slate-500">Downloading elevation & surface-water tiles (first time per area ~5–15 s, then cached) and flooding ~2 M cells…</p>}
            <ErrorBox error={run.error} onRetry={() => doRun()} />
          </div>
        </Panel>

        <Panel title="Presets" icon={Gauge} accent="amber" subtitle={presets.data?.district ? `History & outlook: ${presets.data.district.name} (${presets.data.district.km} km)` : "Sea-level scenarios"}>
          {presets.isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="space-y-1.5">
              {(presets.data?.presets ?? []).map((p) => (
                <button
                  key={p.id}
                  title={p.basis}
                  onClick={() => {
                    setRise(Math.min(5, p.riseM));
                    if (!result) doRun({ riseM: Math.min(5, p.riseM) });
                  }}
                  className="block w-full rounded-lg border border-slate-800 px-2.5 py-1.5 text-left text-[12px] text-slate-300 hover:border-amber-400/40 hover:text-white"
                >
                  <span className="mr-1 rounded bg-amber-400/10 px-1 text-[10px] uppercase text-amber-300">{p.kind === "forecast" ? "indicative" : p.kind}</span>
                  {p.label} <span className="telemetry text-slate-500">→ +{p.riseM} m</span>
                </button>
              ))}
              <p className="pt-1 text-[10.5px] text-slate-500">Hover a preset for its basis. Forecast presets are indicative mappings, not official warnings.</p>
            </div>
          )}
        </Panel>
      </div>

      {/* ── map + results ── */}
      <div className="min-w-0 space-y-4">
        <Panel
          title={
            <span className="flex items-center gap-1">
              Inundation map <MethodExplain k="bathtub" />
            </span>
          }
          icon={Droplets}
          accent="cyan"
          subtitle={result ? `${result.grid.width}×${result.grid.height} cells @ ${result.grid.pixelM} m · z${result.grid.z} · computed in ${(result.timings.computeMs / 1000).toFixed(2)} s` : "Pick an area and run"}
          live={!!result}
          actions={
            result && (
              <div className="hidden items-center gap-1 sm:flex">
                <Chip active={layers.water} onClick={() => setLayers((l) => ({ ...l, water: !l.water }))}>
                  <Layers size={11} className="mr-1 inline" />
                  Water
                </Chip>
                <Chip active={layers.terrain} onClick={() => setLayers((l) => ({ ...l, terrain: !l.terrain }))}>
                  Low ground
                </Chip>
              </div>
            )
          }
          bodyClassName="px-0 pb-0"
        >
          <div className="relative h-[420px] md:h-[520px]">
            <BaseMap center={[area.lat, area.lon]} zoom={9} onReady={onReady} basemap="satellite" />
            {hover && (
              <div className="pointer-events-none absolute z-[600] rounded-md border border-cyan-400/30 bg-[#050b18]/90 px-2 py-1 text-[11px] text-slate-200 telemetry" style={{ left: Math.min(hover.x + 14, 9999), top: hover.y + 10 }}>
                {hover.cls === 1 ? "Sea" : hover.cls === 2 ? "River / lake (source)" : hover.cls === 3 ? "Pond / aquaculture" : `Ground ${hover.elev.toFixed(1)} m`}
                {hover.depth > 0 && <span className="ml-2 text-cyan-300">water {hover.depth.toFixed(2)} m</span>}
              </div>
            )}
            {run.isPending && (
              <div className="absolute inset-0 z-[550] grid place-items-center bg-[#050b18]/50 backdrop-blur-[1px]">
                <div className="flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-[#050b18]/90 px-3 py-2 text-[12px] text-cyan-100">
                  <Waves size={14} className="animate-pulse" /> Flooding the terrain…
                </div>
              </div>
            )}
            {result && (
              <div className="absolute right-2 top-2 z-[500] rounded-lg border border-white/10 bg-[#050b18]/85 p-2 text-[10px] text-slate-300 backdrop-blur">
                <div className="hud-label mb-1">Depth</div>
                {DEPTH_LEGEND.map((l) => (
                  <div key={l.label} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-3.5 rounded-sm" style={{ background: l.color }} /> {l.label}
                  </div>
                ))}
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> asset ≥ 1 m
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> asset dry
                </div>
              </div>
            )}
          </div>
          {/* level bar */}
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-800/80 px-4 py-3">
            <button
              onClick={() => {
                if (!result) return;
                if (rise >= 5) setRise(0);
                setPlaying((p) => !p);
              }}
              disabled={!result}
              className="grid h-9 w-9 place-items-center rounded-full bg-cyan-400 text-slate-950 disabled:opacity-40"
              aria-label={playing ? "Pause" : "Play the water rising"}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <div className="min-w-[180px] flex-1">
              <input type="range" min={0} max={5} step={0.1} value={rise} onChange={(e) => (setPlaying(false), setRise(Number(e.target.value)))} className="w-full accent-cyan-400" aria-label="Water-level rise" />
              <div className="flex justify-between text-[10px] text-slate-500 telemetry">
                <span>0 m</span>
                <span>+1</span>
                <span>+2</span>
                <span>+3</span>
                <span>+4</span>
                <span>+5 m</span>
              </div>
            </div>
            <div className="telemetry text-2xl font-semibold text-cyan-200" style={{ textShadow: "0 0 18px rgba(34,211,238,0.6)" }}>+{rise.toFixed(1)} m</div>
          </div>
        </Panel>

        {result && L ? (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              <Kpi label="Flooded" value={ha(L.floodedHa)} sub={`mean ${L.meanDepthM.toFixed(2)} m`} tone={L.floodedHa > 0 ? "warn" : "good"} />
              <Kpi label="Assets hit" value={`${L.assetsHit} / ${result.assets.length}`} sub={usd(L.exposureHitUsd) + " exposed"} tone={L.assetsHit ? "bad" : "good"} />
              <Kpi label={<>Loss <MethodExplain k="depthDamage" /></>} value={usd(L.lossUsd)} sub="JRC depth–damage" tone={L.lossUsd ? "bad" : "neutral"} />
              <Kpi label="Insured loss" value={usd(L.insuredLossUsd)} sub="after deductibles" />
              <Kpi label="Households" value={num(L.households)} sub="in your communities" />
              <Kpi label="People (est.)" value={people(L.people)} sub={result.population.densityPerKm2 ? `${result.population.densityPerKm2}/km² census` : "no census district"} />
            </div>

            <WhatThisMeans tone={L.assetsHit ? "amber" : "sky"}>{narrative}</WhatThisMeans>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Area & loss as the water rises" icon={Waves} accent="cyan" subtitle="Click the chart to jump to a level">
                <div className="h-[240px]">
                  <ResponsiveContainer>
                    <ComposedChart data={result.levels} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} onClick={(e) => e?.activeLabel != null && (setPlaying(false), setRise(Number(e.activeLabel)))}>
                      <CartesianGrid stroke={VIZ.grid} vertical={false} />
                      <XAxis dataKey="riseM" {...axisProps} tickFormatter={(v) => `+${v}`} interval={9} />
                      <YAxis yAxisId="a" {...axisProps} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}K` : v)} width={44} />
                      <YAxis yAxisId="l" orientation="right" {...axisProps} tickFormatter={(v) => usd(v, 0)} width={52} />
                      <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => (n === "Loss" ? usd(v) : `${num(v)} ha`)} labelFormatter={(v) => `Rise +${v} m`} />
                      <Area yAxisId="a" dataKey="floodedHa" name="Flooded" stroke={VIZ.s1} fill={VIZ.s1} fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />
                      <Line yAxisId="l" dataKey="lossUsd" name="Loss" stroke={VIZ.s2} dot={false} strokeWidth={2} isAnimationActive={false} />
                      <ReferenceLine yAxisId="a" x={L.riseM} stroke="#67e8f9" strokeDasharray="4 3" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: VIZ.s1 }} /> Flooded area (ha)</span>
                  <span className="flex items-center gap-1"><span className="h-0.5 w-3" style={{ background: VIZ.s2 }} /> Portfolio loss (USD)</span>
                </div>
              </Panel>
              <Panel title="Depth mix at this level" icon={Droplets} accent="cyan" subtitle={`+${rise.toFixed(1)} m · land ${result.landElevation.p5}–${result.landElevation.p95} m (p5–p95)`}>
                <div className="space-y-2.5 pt-1">
                  {L.bandsHa.map((v, i) => {
                    const tot = Math.max(1, L.floodedHa);
                    return (
                      <div key={i}>
                        <div className="mb-0.5 flex justify-between text-[12px] text-slate-300">
                          <span>{DEPTH_LEGEND[i]!.label}</span>
                          <span className="telemetry">{ha(v)} · {Math.round((v / tot) * 100)}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full transition-all" style={{ width: `${(v / tot) * 100}%`, background: DEPTH_LEGEND[i]!.color }} />
                        </div>
                      </div>
                    );
                  })}
                  <div className="grid grid-cols-3 gap-2 pt-2 text-[11px] text-slate-400">
                    <div>Sea <span className="telemetry text-slate-200">{result.sourcesFound.seaPct}%</span></div>
                    <div>Rivers/lakes <span className="telemetry text-slate-200">{result.sourcesFound.riverPct}%</span></div>
                    <div>Ponds <span className="telemetry text-slate-200">{result.sourcesFound.pondPct}%</span></div>
                  </div>
                  <p className="text-[11px] text-slate-500">Share of the box that is water today (JRC 1984–2021). Isolated ponds and aquaculture are not treated as flood sources.</p>
                </div>
              </Panel>
            </div>

            <Panel title="Assets in the area" icon={Home} accent="cyan" subtitle={`${result.assets.length} assets · depth, share of footprint under water and loss at +${rise.toFixed(1)} m`} bodyClassName="px-0">
              {result.assets.length ? (
                <div className="max-h-[360px] overflow-auto">
                  <table className="w-full min-w-[640px] text-[12px]">
                    <thead className="sticky top-0 bg-[#070d1c] text-left text-[10.5px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-2">Asset</th>
                        <th className="px-2 py-2 text-right">Ground</th>
                        <th className="px-2 py-2 text-right">First wet</th>
                        <th className="px-2 py-2 text-right">Depth</th>
                        <th className="px-2 py-2 text-right">Wet</th>
                        <th className="px-2 py-2 text-right">Value</th>
                        <th className="px-4 py-2 text-right">Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableAssets.map((a) => (
                        <tr key={a.id} className="border-t border-slate-800/70 hover:bg-white/[0.02]">
                          <td className="px-4 py-1.5">
                            <div className="text-slate-100">{a.name}</div>
                            <div className="text-[10.5px] text-slate-500">{TYPE_LABEL[a.type] ?? a.type}{a.crop ? ` · ${a.crop}` : ""}</div>
                          </td>
                          <td className="px-2 text-right telemetry text-slate-300">{a.elevationM.toFixed(1)} m</td>
                          <td className="px-2 text-right telemetry text-slate-300">{a.floodsAtM != null ? `+${a.floodsAtM.toFixed(1)} m` : "> +5 m"}</td>
                          <td className={`px-2 text-right telemetry ${(a.depthM[k] ?? 0) >= 1 ? "text-rose-300" : (a.depthM[k] ?? 0) > 0 ? "text-amber-300" : "text-slate-400"}`}>{(a.depthM[k] ?? 0).toFixed(2)} m</td>
                          <td className="px-2 text-right telemetry text-slate-300">{a.sharePct[k]}%</td>
                          <td className="px-2 text-right telemetry text-slate-300">{usd(a.valueUsd)}</td>
                          <td className="px-4 text-right telemetry text-white">{usd(a.lossUsd[k] ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 pb-2 text-[12px] text-slate-400">None of this workspace's assets are inside the box. Move the box over your portfolio (Asset group / District) to see portfolio impacts.</p>
              )}
            </Panel>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <ResultActions
                simId={result.id}
                riseM={rise}
                defaultName={`Flood +${rise.toFixed(1)} m · ${result.input.label ?? "custom area"}`}
                csv={() => exportCsv(`flood-sim-${rise.toFixed(1)}m.csv`, rows())}
                pdf={() =>
                  exportPdf(
                    {
                      title: `Flood scenario: +${rise.toFixed(1)} m`,
                      subtitle: `${result.input.label ?? ""} · ${result.input.sizeKm} km box centred ${result.input.center.lat.toFixed(3)}, ${result.input.center.lon.toFixed(3)} · sources: ${result.input.sources} · ${new Date(result.createdAt).toUTCString()}`,
                      narrative,
                      kpis: [
                        ["Flooded area", ha(L.floodedHa)],
                        ["Mean depth", `${L.meanDepthM} m`],
                        ["Assets hit", `${L.assetsHit} of ${result.assets.length}`],
                        ["Exposure hit", usd(L.exposureHitUsd)],
                        ["Loss (JRC depth-damage)", usd(L.lossUsd)],
                        ["Insured loss", usd(L.insuredLossUsd)],
                        ["Extra expected credit loss", usd(L.elUpliftUsd)],
                        ["Households (communities)", num(L.households)],
                        ["People on flooded land (est.)", people(L.people)],
                      ],
                      table: { head: ["Asset", "Type", "Ground m", "First wet", "Depth m", "Wet %", "Loss"], body: tableAssets.slice(0, 40).map((a) => [a.name, TYPE_LABEL[a.type] ?? a.type, a.elevationM, a.floodsAtM != null ? `+${a.floodsAtM}` : ">5", a.depthM[k] ?? 0, a.sharePct[k] ?? 0, usd(a.lossUsd[k] ?? 0)]) },
                      caveats: result.caveats,
                      sources: result.sources,
                      image: canvasRef.current?.toDataURL() ?? null,
                    },
                    `flood-scenario-${rise.toFixed(1)}m.pdf`
                  )
                }
                incident={{ title: `Flood scenario +${rise.toFixed(1)} m — ${result.input.label ?? "area"}`, summary: narrative }}
              />
              <div className="flex flex-wrap gap-1.5">
                <SourceTag>{`Tiles ${result.timings.tiles.fromNetwork} downloaded · ${result.timings.tiles.fromDisk} cached`}</SourceTag>
                <SourceTag>{`fetch ${(result.timings.fetchMs / 1000).toFixed(1)} s · compute ${(result.timings.computeMs / 1000).toFixed(2)} s`}</SourceTag>
              </div>
            </div>
            <Caveats items={result.caveats} sources={result.sources} />
          </>
        ) : (
          !run.isPending && (
            <WhatThisMeans>
              Choose an area (one of the reference coasts, a district, a group of your assets, or click the map), then <b>Run simulation</b>. We download the real terrain and surface-water maps for that box and work out, for every water level from 0 to 5 m, which land the water can actually reach — then drag the slider or press play to watch it rise over your assets.
            </WhatThisMeans>
          )
        )}
      </div>
    </div>
  );
}
