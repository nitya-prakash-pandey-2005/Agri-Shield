"use client";

/**
 * Time-lapse: composes NASA GIBS tiles for a square area around a place onto
 * a <canvas>, one frame per date, with play / pause / scrub / speed. The
 * date stamp, legend and attribution are burned into every frame so the
 * exported video stands on its own.
 *
 * Export: canvas.captureStream() + MediaRecorder → WebM. Browsers without
 * MediaRecorder get the frames as numbered PNG downloads instead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Film, Pause, Play, RefreshCw, SkipBack, SkipForward } from "lucide-react";
import { Panel, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { WhatThisMeans } from "@/components/insurance/kit";
import { Segmented } from "@/components/portfolio/ui";
import { cn } from "@/lib/utils";
import { DateField, LayerSelect, PlacePicker, download, inputCls, type LayerInfo, type Place, type PlacesOut } from "./common";
import { LAYERS, TILE_SIZE, addDays, daysBetween, gibsTileUrl, isAvailable, lonLatToTileFrac, metresPerPixel, stepDates, type LayerId } from "./tile-math";

const W = 960;
const H = 600;
const MAX_FRAMES = 60;

const STEPS = [
  { value: "1", label: "Daily" },
  { value: "7", label: "Weekly" },
  { value: "8", label: "8-day" },
  { value: "16", label: "16-day" },
] as const;

const SPANS = [25, 50, 100, 200, 400];

interface FrameTiles {
  date: string;
  base: (CanvasImageSource | null)[];
  over: (CanvasImageSource | null)[];
  missing: boolean;
}

function loadImageOnce(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** GIBS occasionally answers a burst with a transient error page — retry once. */
async function loadImage(url: string): Promise<HTMLImageElement | null> {
  const first = await loadImageOnce(url);
  if (first) return first;
  await new Promise((r) => setTimeout(r, 400));
  return loadImageOnce(`${url}?retry=1`);
}

/**
 * The flood layer paints "insufficient data" (cloud) pixels opaque grey, which
 * would hide the true-colour picture underneath; fade them to a light veil.
 */
function fadeCloudPixels(img: HTMLImageElement | null): CanvasImageSource | null {
  if (!img) return null;
  try {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || TILE_SIZE;
    c.height = img.naturalHeight || TILE_SIZE;
    const ctx = c.getContext("2d");
    if (!ctx) return img;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3]! > 0 && Math.abs(px[i]! - 175) < 8 && Math.abs(px[i + 1]! - 175) < 8 && Math.abs(px[i + 2]! - 175) < 8) px[i + 3] = 40;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  } catch {
    return img; // canvas tainted (no CORS) — draw as-is
  }
}

/** Zoom whose native pixels best match the requested ground span on a W-px canvas. */
function zoomFor(lat: number, spanKm: number, maxLevel: number) {
  const wanted = (spanKm * 1000) / W; // m per canvas px
  let z = maxLevel;
  while (z > 2 && metresPerPixel(lat, z) < wanted * 0.75) z--;
  return z;
}

export default function Timelapse({
  places,
  place,
  onPlace,
  layers,
  initial,
}: {
  places: PlacesOut | undefined;
  place: Place | null;
  onPlace: (p: Place) => void;
  layers: Map<LayerId, LayerInfo>;
  initial?: { date?: string | null };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [layer, setLayer] = useState<LayerId>("modis_tc");
  const [floodOver, setFloodOver] = useState(true);
  const [spanKm, setSpanKm] = useState(100);
  const [step, setStep] = useState<"1" | "7" | "8" | "16">("7");
  const latestTc = layers.get("modis_tc")?.latest ?? null;
  const defaultTo = initial?.date ?? (latestTc ? addDays(latestTc, -1) : addDays(new Date().toISOString().slice(0, 10), -2));
  const [to, setTo] = useState(defaultTo);
  const [from, setFrom] = useState(addDays(defaultTo, -84));
  const [frames, setFrames] = useState<FrameTiles[]>([]);
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(3);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const loadToken = useRef(0);

  useEffect(() => {
    if (initial?.date) {
      setTo(initial.date);
      setFrom(addDays(initial.date, -84));
    }
  }, [initial?.date]);

  const info = LAYERS[layer];
  const dates = useMemo(() => {
    const all = stepDates(from, to, Number(step), 400);
    if (all.length <= MAX_FRAMES) return all;
    const k = Math.ceil(all.length / MAX_FRAMES);
    return all.filter((_, i) => i % k === 0);
  }, [from, to, step]);

  const geom = useMemo(() => {
    if (!place) return null;
    const z = zoomFor(place.lat, spanKm, info.level);
    const c = lonLatToTileFrac(place.lat, place.lon, z);
    const cx = c.x * TILE_SIZE;
    const cy = c.y * TILE_SIZE;
    const mpp = metresPerPixel(place.lat, z);
    const scale = mpp / ((spanKm * 1000) / W); // canvas px per world px
    const halfW = W / 2 / scale;
    const halfH = H / 2 / scale;
    const n = 2 ** z;
    const tiles: { x: number; y: number }[] = [];
    for (let ty = Math.floor((cy - halfH) / TILE_SIZE); ty <= Math.floor((cy + halfH) / TILE_SIZE); ty++)
      for (let tx = Math.floor((cx - halfW) / TILE_SIZE); tx <= Math.floor((cx + halfW) / TILE_SIZE); tx++) if (ty >= 0 && ty < n) tiles.push({ x: tx, y: ty });
    return { z, cx, cy, scale, tiles, n };
  }, [place, spanKm, info.level]);

  const assetsInView = useMemo(() => {
    if (!geom || !places) return [];
    return places.assets
      .map((a) => {
        const f = lonLatToTileFrac(a.lat, a.lon, geom.z);
        return { ...a, px: (f.x * TILE_SIZE - geom.cx) * geom.scale + W / 2, py: (f.y * TILE_SIZE - geom.cy) * geom.scale + H / 2 };
      })
      .filter((a) => a.px >= 0 && a.px <= W && a.py >= 0 && a.py <= H);
  }, [geom, places]);

  const draw = useCallback(
    (i: number) => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#040914";
      ctx.fillRect(0, 0, W, H);
      const f = frames[i];
      if (!f || !geom) {
        ctx.fillStyle = "#64748b";
        ctx.font = "14px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(place ? "Press “Load frames” to fetch imagery" : "Pick a place to start", W / 2, H / 2);
        ctx.textAlign = "left";
        return;
      }
      const size = TILE_SIZE * geom.scale;
      const put = (img: CanvasImageSource | null, t: { x: number; y: number }) => {
        if (!img) return;
        const dx = (t.x * TILE_SIZE - geom.cx) * geom.scale + W / 2;
        const dy = (t.y * TILE_SIZE - geom.cy) * geom.scale + H / 2;
        ctx.drawImage(img, Math.floor(dx), Math.floor(dy), Math.ceil(size) + 1, Math.ceil(size) + 1);
      };
      ctx.imageSmoothingEnabled = geom.scale < 1;
      geom.tiles.forEach((t, k) => put(f.base[k] ?? null, t));
      geom.tiles.forEach((t, k) => put(f.over[k] ?? null, t));
      // assets
      for (const a of assetsInView) {
        ctx.beginPath();
        ctx.arc(a.px, a.py, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#22d3ee";
        ctx.strokeStyle = "#020617";
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
      }
      // HUD overlay
      ctx.fillStyle = "rgba(2,6,23,0.72)";
      ctx.fillRect(12, 12, 300, 58);
      ctx.strokeStyle = "rgba(34,211,238,0.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(12.5, 12.5, 300, 58);
      ctx.fillStyle = "#67e8f9";
      ctx.font = "bold 22px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(f.date, 24, 40);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(`${info.short}${floodOver && info.kind === "truecolor" && info.level === 9 ? " + MODIS flood" : ""} · ${place?.name ?? ""}`.slice(0, 46), 24, 60);
      if (f.missing) {
        ctx.fillStyle = "#fbbf24";
        ctx.fillText("no image published this day", 24, 84);
      }
      ctx.fillStyle = "rgba(2,6,23,0.72)";
      ctx.fillRect(W - 250, H - 24, 250, 24);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(`NASA EOSDIS GIBS · Agri-SHIELD · ${spanKm} km`, W - 242, H - 9);
      // progress bar
      ctx.fillStyle = "rgba(148,163,184,0.25)";
      ctx.fillRect(0, H - 3, W, 3);
      ctx.fillStyle = "#22d3ee";
      ctx.fillRect(0, H - 3, (W * (i + 1)) / Math.max(1, frames.length), 3);
    },
    [frames, geom, assetsInView, info, floodOver, place, spanKm]
  );

  useEffect(() => draw(idx), [draw, idx]);

  // playback
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % frames.length), 1000 / fps);
    return () => clearInterval(t);
  }, [playing, fps, frames.length]);

  const load = useCallback(async () => {
    if (!geom || !dates.length) return;
    const token = ++loadToken.current;
    setPlaying(false);
    setFrames([]);
    setIdx(0);
    setNote(null);
    const overlay = floodOver && info.kind === "truecolor" && info.level === 9;
    const ranges = layers.get(layer)?.ranges ?? [];
    const total = dates.length * geom.tiles.length * (overlay ? 2 : 1);
    let done = 0;
    setLoading({ done, total });
    const wrapX = (x: number) => ((x % geom.n) + geom.n) % geom.n;
    const out: FrameTiles[] = [];
    let failures = 0;
    for (const date of dates) {
      const fetchSet = (id: LayerId) =>
        Promise.all(
          geom.tiles.map(async (t): Promise<CanvasImageSource | null> => {
            const img = await loadImage(gibsTileUrl(id, date, geom.z, wrapX(t.x), t.y));
            done++;
            if (!img) failures++;
            return id === "modis_flood" ? fadeCloudPixels(img) : img;
          })
        );
      const [base, over] = await Promise.all([fetchSet(layer), overlay ? fetchSet("modis_flood") : Promise.resolve([])]);
      if (token !== loadToken.current) return;
      out.push({ date, base, over, missing: ranges.length ? !isAvailable(date, ranges) : false });
      setLoading({ done, total });
      setFrames([...out]);
    }
    setLoading(null);
    if (failures) setNote(`${failures} tile request(s) returned nothing — usually days with no pass over this area.`);
    setPlaying(true);
  }, [geom, dates, floodOver, info, layers, layer]);

  const exportVideo = useCallback(async () => {
    const c = canvas.current;
    if (!c || !frames.length) return;
    setPlaying(false);
    const name = `agri-shield-timelapse-${info.short.replace(/\s+/g, "")}-${from}_${to}`.toLowerCase();
    const canRecord = typeof MediaRecorder !== "undefined" && typeof c.captureStream === "function";
    const mime = canRecord ? ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) : undefined;
    if (!canRecord || !mime) {
      // Fallback: numbered PNG frames
      for (let i = 0; i < frames.length; i++) {
        draw(i);
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
        if (blob) download(`${name}-${String(i + 1).padStart(3, "0")}.png`, blob);
        await new Promise((r) => setTimeout(r, 250));
      }
      setNote("Your browser can't record video here, so the frames were downloaded as PNGs.");
      return;
    }
    setRecording(true);
    try {
      const stream = c.captureStream(fps);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
      rec.start();
      for (let i = 0; i < frames.length; i++) {
        draw(i);
        setIdx(i);
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }
      await new Promise((r) => setTimeout(r, 1000 / fps));
      rec.stop();
      await stopped;
      download(`${name}.webm`, new Blob(chunks, { type: "video/webm" }));
    } catch (e) {
      setNote(`Recording failed: ${e instanceof Error ? e.message : String(e)}. Some tiles may have blocked canvas export.`);
    } finally {
      setRecording(false);
    }
  }, [frames, fps, draw, info.short, from, to]);

  const range = daysBetween(from, to);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel title="Time-lapse" subtitle={place ? `${place.name} · ${spanKm} × ${Math.round((spanKm * H) / W)} km · ${dates.length} frames` : "Pick a place"} icon={Film} accent="cyan" live={playing}>
        <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-[#040914]">
          <canvas ref={canvas} width={W} height={H} className="block h-auto w-full" aria-label="Time-lapse frame" />
          {loading && (
            <div className="absolute inset-x-0 bottom-0 bg-slate-950/80 px-3 py-2 text-[11px] text-cyan-200">
              <div className="mb-1 flex justify-between telemetry">
                <span>Fetching tiles…</span>
                <span>
                  {loading.done}/{loading.total}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded bg-slate-800">
                <div className="h-full bg-cyan-400 transition-all" style={{ width: `${(loading.done / Math.max(1, loading.total)) * 100}%` }} />
              </div>
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Previous frame" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={!frames.length} className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:border-cyan-400/50 disabled:opacity-40">
            <SkipBack size={14} />
          </button>
          <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)} disabled={frames.length < 2} className="rounded-lg bg-cyan-400 p-2 text-slate-950 hover:bg-cyan-300 disabled:opacity-40">
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button type="button" aria-label="Next frame" onClick={() => setIdx((i) => Math.min(frames.length - 1, i + 1))} disabled={!frames.length} className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:border-cyan-400/50 disabled:opacity-40">
            <SkipForward size={14} />
          </button>
          <input type="range" min={0} max={Math.max(0, frames.length - 1)} value={idx} onChange={(e) => (setPlaying(false), setIdx(Number(e.target.value)))} className="min-w-[120px] flex-1 accent-cyan-400" aria-label="Scrub frames" disabled={!frames.length} />
          <span className="telemetry w-24 text-right text-[11px] text-slate-400">{frames[idx]?.date ?? "—"}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-slate-400">
          <label className="flex items-center gap-2">
            Speed
            <input type="range" min={1} max={10} value={fps} onChange={(e) => setFps(Number(e.target.value))} className="w-24 accent-cyan-400" aria-label="Frames per second" />
            <span className="telemetry text-slate-200">{fps} fps</span>
          </label>
          <button type="button" onClick={exportVideo} disabled={!frames.length || recording || !!loading} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-[12px] text-slate-200 hover:border-cyan-400/50 disabled:opacity-40">
            {recording ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
            {recording ? "Recording…" : "Export WebM"}
          </button>
        </div>
        {note && <p className="mt-2 text-[11.5px] text-amber-300/90">{note}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <SourceTag href="https://www.earthdata.nasa.gov/gibs">NASA EOSDIS GIBS</SourceTag>
          <SourceTag>{info.label}</SourceTag>
          {floodOver && info.level === 9 && info.kind === "truecolor" && <SourceTag>MODIS Combined Flood 2-Day</SourceTag>}
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel title="Set up" accent="cyan">
          <div className="space-y-3">
            <PlacePicker places={places} value={place} onChange={onPlace} compact />
            <div>
              <div className="mb-1 text-[12px] text-slate-400">Layer</div>
              <LayerSelect value={layer} onChange={setLayer} />
              <p className="mt-1 text-[11px] leading-snug text-slate-500">{info.description}</p>
            </div>
            {info.kind === "truecolor" && info.level === 9 && (
              <label className="flex items-center gap-2 text-[12px] text-slate-300">
                <input type="checkbox" checked={floodOver} onChange={(e) => setFloodOver(e.target.checked)} className="accent-cyan-400" />
                Overlay observed flood water (MODIS 2-day)
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <DateField label="From" value={from} onChange={setFrom} layer={layers.get(layer)} />
              <DateField label="To" value={to} onChange={setTo} layer={layers.get(layer)} min={from} />
            </div>
            <div>
              <div className="mb-1 text-[12px] text-slate-400">Step</div>
              <Segmented value={step} onChange={(v) => setStep(v as typeof step)} options={STEPS.map((s) => ({ value: s.value, label: s.label }))} />
            </div>
            <label className="block text-[12px] text-slate-400">
              Area width
              <select className={cn(inputCls, "mt-1")} value={spanKm} onChange={(e) => setSpanKm(Number(e.target.value))}>
                {SPANS.map((s) => (
                  <option key={s} value={s} className="bg-slate-900">
                    {s} km
                  </option>
                ))}
              </select>
            </label>
            <div className="text-[11px] text-slate-500">
              {range < 0 ? <span className="text-rose-300">“From” must be before “To”.</span> : <>{dates.length} frames · {geom ? `${geom.tiles.length} tiles/frame at zoom ${geom.z}` : "—"}{stepDates(from, to, Number(step), 400).length > MAX_FRAMES && ` · thinned to ${MAX_FRAMES} frames`}</>}
            </div>
            <button type="button" onClick={load} disabled={!place || range < 0 || !!loading} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-[13px] font-medium text-slate-950 hover:bg-cyan-300 disabled:opacity-40">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Film size={14} />}
              {loading ? "Loading frames…" : frames.length ? "Reload frames" : "Load frames"}
            </button>
          </div>
        </Panel>
        <WhatThisMeans>
          Each frame is the real satellite picture for that date. Weekly <Explain term="modis">MODIS</Explain> frames through a monsoon show rivers widening and fields turning to water (red = flood detected), then draining. Grey smudges are clouds — the satellite can't see the ground that day. Tip: use 16-day steps with the NDVI layer to watch a crop season green up and brown down.
        </WhatThisMeans>
      </div>
    </div>
  );
}
