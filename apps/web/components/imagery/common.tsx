"use client";

/**
 * Satellite Lab shared UI: layer catalogue + availability, place picker
 * (workspace assets, district points, typed coordinates, map clicks),
 * availability-aware date field and small formatting helpers.
 */
import { useMemo, useState } from "react";
import { CalendarCheck2, CalendarX2, Crosshair, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { LAYERS, addDays, isAvailable, isoDate, nearestAvailable, type DateRange, type LayerId } from "./tile-math";

export type LayersOut = RouterOutputs["imagery"]["layers"];
export type PlacesOut = RouterOutputs["imagery"]["places"];
export type LayerInfo = LayersOut["layers"][number];

export interface Place {
  lat: number;
  lon: number;
  name: string;
  assetId?: string | null;
  districtId?: string | null;
}

export const inputCls =
  "h-9 w-full rounded-lg border border-slate-700/80 bg-slate-950/60 px-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/15 disabled:opacity-50";

export function useLayerMeta() {
  const q = trpc.imagery.layers.useQuery(undefined, { staleTime: 30 * 60_000 });
  const byId = useMemo(() => {
    const m = new Map<LayerId, LayerInfo>();
    for (const l of q.data?.layers ?? []) m.set(l.id, l);
    return m;
  }, [q.data]);
  return { query: q, byId, source: q.data?.availabilitySource ?? null };
}

/** Safe default date for a layer: latest published minus a processing buffer. */
export function defaultDate(layer: LayerInfo | undefined, lagDays = 1): string {
  const latest = layer?.latest ?? addDays(isoDate(new Date()), -2);
  return addDays(latest, -lagDays);
}

export function rangesFor(layer: LayerInfo | undefined): DateRange[] {
  return layer?.ranges ?? [];
}

export function LayerSelect({ value, onChange, allowed, ariaLabel }: { value: LayerId; onChange: (v: LayerId) => void; allowed?: LayerId[]; ariaLabel?: string }) {
  const ids = allowed ?? (Object.keys(LAYERS) as LayerId[]);
  return (
    <select aria-label={ariaLabel ?? "Imagery layer"} className={cn(inputCls, "pr-7")} value={value} onChange={(e) => onChange(e.target.value as LayerId)}>
      {ids.map((id) => (
        <option key={id} value={id} className="bg-slate-900">
          {LAYERS[id].label}
        </option>
      ))}
    </select>
  );
}

/** Date input that tells the user whether GIBS has published imagery for that day. */
export function DateField({
  label,
  value,
  onChange,
  layer,
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  layer: LayerInfo | undefined;
  min?: string;
}) {
  const ranges = rangesFor(layer);
  const ok = !ranges.length || isAvailable(value, ranges);
  const nearest = !ok ? nearestAvailable(value, ranges) : null;
  const max = layer?.latest ?? isoDate(new Date());
  const hls = layer?.level === 12;
  return (
    <div>
      <label className="mb-1 block text-[12px] text-slate-400">
        {label}
        <input type="date" className={cn(inputCls, "mt-1 telemetry")} value={value} min={min ?? layer?.earliest ?? "2000-02-24"} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} />
      </label>
      <div className="min-h-[18px] text-[11px]">
        {!layer ? null : ok ? (
          <span className="inline-flex items-center gap-1 text-emerald-300/90">
            <CalendarCheck2 size={11} /> Published{hls ? " — HLS only covers the strips a satellite passed that day" : ""}
          </span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-1 text-amber-300">
            <CalendarX2 size={11} /> No {layer.short} image that day.
            {nearest && (
              <button type="button" className="underline underline-offset-2 hover:text-white" onClick={() => onChange(nearest)}>
                Use {nearest}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** Pick an asset, a district point, or type coordinates. */
export function PlacePicker({ places, value, onChange, compact }: { places: PlacesOut | undefined; value: Place | null; onChange: (p: Place) => void; compact?: boolean }) {
  const [coords, setCoords] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const selKey = value?.assetId ? `a:${value.assetId}` : value?.districtId ? `d:${value.districtId}` : "";
  const apply = () => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(coords);
    if (!m) return setErr("Type “lat, lon”, e.g. 23.81, 90.41");
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return setErr("Out of range");
    setErr(null);
    onChange({ lat, lon, name: `${lat.toFixed(3)}, ${lon.toFixed(3)}` });
  };
  return (
    <div className={cn("grid gap-2", compact ? "" : "sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)]")}>
      <label className="block text-[12px] text-slate-400">
        <span className="flex items-center gap-1">
          <MapPin size={11} /> Place
        </span>
        <select
          aria-label="Place"
          className={cn(inputCls, "mt-1 pr-7")}
          value={selKey}
          onChange={(e) => {
            const [kind, id] = [e.target.value.slice(0, 1), e.target.value.slice(2)];
            if (kind === "a") {
              const a = places?.assets.find((x) => x.id === id);
              if (a) onChange({ lat: a.lat, lon: a.lon, name: a.name, assetId: a.id });
            } else if (kind === "d") {
              const d = places?.districts.find((x) => x.id === id);
              if (d) onChange({ lat: d.lat, lon: d.lon, name: `${d.name}, ${d.country}`, districtId: d.id });
            }
          }}
        >
          <option value="" className="bg-slate-900">
            {value && !value.assetId && !value.districtId ? `Custom point · ${value.name}` : "Choose an asset or district…"}
          </option>
          {!!places?.assets.length && (
            <optgroup label={`Your assets (${places.assets.length})`} className="bg-slate-900">
              {places.assets.map((a) => (
                <option key={a.id} value={`a:${a.id}`} className="bg-slate-900">
                  {a.name} · {a.country}
                </option>
              ))}
            </optgroup>
          )}
          {!!places?.districts.length && (
            <optgroup label="Monitored districts" className="bg-slate-900">
              {places.districts.map((d) => (
                <option key={d.id} value={`d:${d.id}`} className="bg-slate-900">
                  {d.name}, {d.country}
                  {d.ndviCached ? " · NDVI cached" : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label className="block text-[12px] text-slate-400">
        <span className="flex items-center gap-1">
          <Crosshair size={11} /> Or coordinates
        </span>
        <div className="mt-1 flex gap-1.5">
          <input className={cn(inputCls, "telemetry")} placeholder="23.81, 90.41" value={coords} onChange={(e) => setCoords(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} aria-label="Coordinates" />
          <button type="button" onClick={apply} className="shrink-0 rounded-lg border border-slate-700 px-2.5 text-[12px] text-slate-200 hover:border-cyan-400/50">
            Go
          </button>
        </div>
        {err && <span className="mt-0.5 block text-[11px] text-rose-300">{err}</span>}
      </label>
    </div>
  );
}

export const VERDICT_META = {
  observed_flooded: { label: "Observed flooded", color: "#f43f5e", short: "Flooded" },
  flood_nearby: { label: "Flood within ~300 m", color: "#f59e0b", short: "Nearby" },
  cloud: { label: "Cloud / no data", color: "#94a3b8", short: "Cloud" },
  unavailable: { label: "Tile unavailable", color: "#64748b", short: "N/A" },
  normal_water: { label: "Normal surface water", color: "#38bdf8", short: "Water" },
  dry: { label: "No water seen", color: "#34d399", short: "Dry" },
} as const;
export type Verdict = keyof typeof VERDICT_META;

export function usd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `$${Math.round(v / 1e3)}k`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

export function download(filename: string, content: Blob | string, type = "text/plain") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
