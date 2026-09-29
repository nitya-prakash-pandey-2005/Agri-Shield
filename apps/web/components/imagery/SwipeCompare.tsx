"use client";

/**
 * Before/after comparison controls around SwipeMap: layer + date per side
 * with availability hints, swipe / side-by-side / blend modes, presets.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Columns2, ExternalLink, Layers2, SplitSquareHorizontal } from "lucide-react";
import { Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { WhatThisMeans } from "@/components/insurance/kit";
import { Segmented } from "@/components/portfolio/ui";
import { DateField, LayerSelect, PlacePicker, type LayerInfo, type Place, type PlacesOut } from "./common";
import { LAYERS, addDays, worldviewUrl, type LayerId } from "./tile-math";
import type { Side } from "./SwipeMap";

const SwipeMap = dynamic(() => import("./SwipeMap"), { ssr: false, loading: () => <Skeleton className="h-[520px]" /> });

type Mode = "swipe" | "side" | "blend";

export default function SwipeCompare({
  places,
  place,
  onPlace,
  layers,
  initialDate,
}: {
  places: PlacesOut | undefined;
  place: Place | null;
  onPlace: (p: Place) => void;
  layers: Map<LayerId, LayerInfo>;
  initialDate?: string | null;
}) {
  const latest = layers.get("modis_tc")?.latest ?? null;
  const afterDefault = initialDate ?? (latest ? addDays(latest, -1) : addDays(new Date().toISOString().slice(0, 10), -2));
  const [before, setBefore] = useState<Side>({ layer: "modis_tc", date: addDays(afterDefault, -30) });
  const [after, setAfter] = useState<Side>({ layer: "modis_tc", date: afterDefault });
  const [mode, setMode] = useState<Mode>("swipe");
  const [opacity, setOpacity] = useState(0.6);
  const [touched, setTouched] = useState(false);
  const [height, setHeight] = useState(520);

  useEffect(() => {
    const f = () => setHeight(window.innerWidth < 640 ? 380 : 520);
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  // Once availability loads, move untouched defaults onto real dates
  useEffect(() => {
    if (touched || !latest || initialDate) return;
    const a = addDays(latest, -1);
    setAfter((s) => ({ ...s, date: a }));
    setBefore((s) => ({ ...s, date: addDays(a, -30) }));
  }, [latest, touched, initialDate]);
  useEffect(() => {
    if (!initialDate) return;
    setAfter((s) => ({ ...s, date: initialDate }));
    setBefore((s) => ({ ...s, date: addDays(initialDate, -30) }));
  }, [initialDate]);

  const markers = useMemo(() => (places?.assets ?? []).map((a) => ({ id: a.id, lat: a.lat, lon: a.lon, name: a.name })), [places]);
  const center: [number, number] = place ? [place.lat, place.lon] : places?.center ?? [22.7, 90.3];
  const maxLevel = Math.max(LAYERS[before.layer].level, LAYERS[after.layer].level);
  const focus = place ? { lat: place.lat, lon: place.lon, zoom: maxLevel >= 12 ? 12 : 9, key: `${place.lat},${place.lon}` } : null;

  const preset = (b: Side, a: Side) => {
    setTouched(true);
    setBefore(b);
    setAfter(a);
  };
  const recent = latest ? addDays(latest, -1) : after.date;

  return (
    <div className="space-y-4">
      <Panel title="Before / after" subtitle={place ? place.name : "Click the map or pick a place"} icon={SplitSquareHorizontal} accent="cyan">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: "swipe", label: <><ArrowLeftRight size={12} /> Swipe</> }, { value: "side", label: <><Columns2 size={12} /> Side by side</> }, { value: "blend", label: <><Layers2 size={12} /> Blend</> }]} />
          <span className="text-[11px] text-slate-500">Tip: click any asset dot or spot on the map to focus it.</span>
        </div>
        <SwipeMap
          key={mode === "side" ? "side" : "single"}
          center={center}
          zoom={9}
          before={before}
          after={after}
          mode={mode}
          opacity={opacity}
          markers={markers}
          focus={focus}
          height={height}
          onPick={(lat, lon, id) => {
            const a = id ? places?.assets.find((x) => x.id === id) : null;
            onPlace(a ? { lat: a.lat, lon: a.lon, name: a.name, assetId: a.id } : { lat, lon, name: `${lat.toFixed(3)}, ${lon.toFixed(3)}` });
          }}
        />
        {mode === "blend" && (
          <label className="mt-3 flex items-center gap-3 text-[12px] text-slate-400">
            After-image opacity
            <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1 accent-cyan-400" aria-label="After image opacity" />
            <span className="telemetry w-10 text-right text-slate-200">{Math.round(opacity * 100)}%</span>
          </label>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <SourceTag href="https://www.earthdata.nasa.gov/gibs">NASA EOSDIS GIBS</SourceTag>
          <SourceTag>{LAYERS[before.layer].short} {before.date}</SourceTag>
          <SourceTag>{LAYERS[after.layer].short} {after.date}</SourceTag>
          {place && (
            <a className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-cyan-300 hover:underline" href={worldviewUrl(after.date, place.lat, place.lon, `${LAYERS[after.layer].gibsId}`)} target="_blank" rel="noreferrer">
              Open in NASA Worldview <ExternalLink size={11} />
            </a>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Place" accent="cyan">
          <PlacePicker places={places} value={place} onChange={onPlace} compact />
          <div className="mt-3 text-[11px] text-slate-500">Quick comparisons</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button type="button" className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-cyan-400/50" onClick={() => preset({ layer: "modis_tc", date: addDays(recent, -30) }, { layer: "modis_tc", date: recent })}>
              Last 30 days (MODIS)
            </button>
            <button type="button" className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-cyan-400/50" onClick={() => preset({ layer: "modis_tc", date: recent }, { layer: "modis_flood", date: recent })}>
              Photo vs flood map
            </button>
            <button type="button" className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-cyan-400/50" onClick={() => preset({ layer: "modis_ndvi", date: addDays(recent, -365) }, { layer: "modis_ndvi", date: addDays(recent, -3) })}>
              NDVI vs a year ago
            </button>
            <button type="button" className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-cyan-400/50" onClick={() => preset({ layer: "modis_tc", date: "2024-08-10" }, { layer: "modis_flood", date: "2024-08-25" })}>
              Bangladesh Aug 2024 flood
            </button>
          </div>
        </Panel>
        <Panel title="Before" accent="cyan">
          <div className="space-y-2">
            <LayerSelect value={before.layer} onChange={(v) => (setTouched(true), setBefore((s) => ({ ...s, layer: v })))} ariaLabel="Before layer" />
            <DateField label="Date" value={before.date} onChange={(d) => (setTouched(true), setBefore((s) => ({ ...s, date: d })))} layer={layers.get(before.layer)} />
            <p className="text-[11px] leading-snug text-slate-500">{LAYERS[before.layer].resolution} · {LAYERS[before.layer].cadence}</p>
          </div>
        </Panel>
        <Panel title="After" accent="cyan">
          <div className="space-y-2">
            <LayerSelect value={after.layer} onChange={(v) => (setTouched(true), setAfter((s) => ({ ...s, layer: v })))} ariaLabel="After layer" />
            <DateField label="Date" value={after.date} onChange={(d) => (setTouched(true), setAfter((s) => ({ ...s, date: d })))} layer={layers.get(after.layer)} />
            <p className="text-[11px] leading-snug text-slate-500">{LAYERS[after.layer].resolution} · {LAYERS[after.layer].cadence}</p>
          </div>
        </Panel>
      </div>

      <WhatThisMeans>
        Drag the divider (or focus it and use ← →) to wipe between two satellite pictures of the same place. Use daily <Explain term="modis">MODIS</Explain> to see a flood arrive, and 30 m <Explain term="sentinel">HLS Sentinel-2/Landsat</Explain> to inspect individual fields — HLS only has a picture on days a satellite passed, so blank areas mean “no pass”, not “no land”. Clouds look white; the red/yellow <Explain term="gibs">GIBS</Explain> flood layer marks water where there normally is none.
      </WhatThisMeans>
    </div>
  );
}
