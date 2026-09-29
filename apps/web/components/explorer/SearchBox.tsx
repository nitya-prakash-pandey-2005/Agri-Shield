"use client";

/**
 * Place search with autocomplete (Open-Meteo geocoding → OpenStreetMap fallback),
 * coordinate paste ("22.7, 90.35" / "22.7N 90.35E") and "use my location".
 * Keyboard: ↑/↓ to move, Enter to pick, Esc to close, "/" focuses the box.
 */
import { useEffect, useRef, useState } from "react";
import { Crosshair, Loader2, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function SearchBox({ onPick, className }: { onPick: (p: { lat: number; lon: number; name?: string | null }) => void; className?: string }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [locating, setLocating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 280);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = trpc.explorer.search.useQuery({ q: debounced }, { enabled: debounced.length >= 2, staleTime: 5 * 60_000 });
  const hits = debounced.length >= 2 ? (results.data ?? []) : [];

  const pick = (h: { lat: number; lon: number; name: string; kind: string }) => {
    onPick({ lat: h.lat, lon: h.lon, name: h.kind === "coordinates" ? null : h.name });
    setQ(h.kind === "coordinates" ? h.name : h.name);
    setOpen(false);
    inputRef.current?.blur();
  };

  const locate = () => {
    if (!navigator.geolocation) return toast.error("Your browser does not share location");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onPick({ lat: Math.round(pos.coords.latitude * 10000) / 10000, lon: Math.round(pos.coords.longitude * 10000) / 10000, name: null });
      },
      (err) => {
        setLocating(false);
        toast.error(err.code === 1 ? "Location permission denied — search or click the map instead" : "Could not get your location");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300_000 }
    );
  };

  return (
    <div className={cn("relative", className)}>
      <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#060a16]/92 px-2.5 shadow-2xl backdrop-blur-xl focus-within:border-emerald-400/50">
        <Search size={15} className="shrink-0 text-slate-500" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setIdx(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, Math.max(0, hits.length - 1)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && hits[idx]) {
              e.preventDefault();
              pick(hits[idx]!);
            } else if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder="Search a place, address or paste coordinates…"
          aria-label="Search a place or coordinates"
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls="explorer-search-results"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        {results.isFetching && <Loader2 size={14} className="animate-spin text-slate-500" />}
        <kbd className="hidden rounded border border-white/10 px-1.5 text-[10px] text-slate-500 sm:inline">/</kbd>
        <button onClick={locate} title="Use my location" aria-label="Use my location" className="ml-0.5 grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-emerald-300">
          {locating ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={15} />}
        </button>
      </div>
      {open && debounced.length >= 2 && (
        <ul id="explorer-search-results" role="listbox" className="absolute left-0 right-0 top-full z-[700] mt-1.5 overflow-hidden rounded-xl border border-white/10 bg-[#060a16]/97 shadow-2xl backdrop-blur-xl">
          {hits.length === 0 && !results.isFetching && <li className="px-3 py-2.5 text-xs text-slate-500">No match — try a nearby town, or paste coordinates like “22.70, 90.35”.</li>}
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === idx}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
                onMouseEnter={() => setIdx(i)}
                className={cn("flex w-full items-start gap-2 px-3 py-2 text-left", i === idx ? "bg-emerald-500/10" : "hover:bg-white/5")}
              >
                <MapPin size={13} className="mt-0.5 shrink-0 text-emerald-400" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-slate-100">{h.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {h.label} · <span className="telemetry">{h.lat.toFixed(3)}, {h.lon.toFixed(3)}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
