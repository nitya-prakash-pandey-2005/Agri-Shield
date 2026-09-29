"use client";

/**
 * Public live demo map: district polygons coloured by live flood or salinity risk
 * (public.riskMap → Open-Meteo forecast + GloFAS discharge), NASA IMERG rain overlay,
 * region focus presets. Mounted only when scrolled near, to keep the landing light.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { CloudRain, Droplets, Waves } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { RiskPill, Skeleton, SourceTag, riskColor } from "@/components/hud";
import { RAIN_OVERLAY } from "@/components/maps/BaseMap";
import { FOCUS_DISTRICT_EVENT } from "@/components/command/events";

const BaseMap = dynamic(() => import("@/components/maps/BaseMap"), { ssr: false, loading: () => <Skeleton className="absolute inset-0 rounded-none" /> });

type District = RouterOutputs["public"]["riskMap"][number];
type Metric = "flood" | "salinity";

const REGIONS: { id: string; label: string; center: [number, number]; zoom: number }[] = [
  { id: "asia", label: "All regions", center: [12, 100], zoom: 4 },
  { id: "mekong", label: "Mekong Delta", center: [9.95, 105.75], zoom: 8 },
  { id: "bengal", label: "Bay of Bengal", center: [22.9, 90.0], zoom: 7 },
  { id: "philippines", label: "Philippine coasts", center: [15.1, 120.85], zoom: 8 },
  { id: "odisha", label: "Odisha", center: [20.4, 86.4], zoom: 8 },
  { id: "java", label: "Java", center: [-6.75, 109.6], zoom: 7 },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function popupHtml(d: District) {
  const f = riskColor(d.floodRisk);
  const s = riskColor(d.salinityRisk);
  const live = d.liveSource === "open-meteo";
  const updated = new Date(d.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `
  <div style="min-width:220px;font-family:var(--font-inter),sans-serif">
    <div style="font-family:var(--font-display),sans-serif;font-weight:600;font-size:14px;color:#fff">${esc(d.name)}</div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:8px">${esc(d.country)} · ${esc(d.basin)}</div>
    <table style="width:100%;font-size:11.5px;border-collapse:collapse;font-family:var(--font-mono),monospace">
      <tr><td style="color:#94a3b8;padding:2px 0">Flood risk</td><td style="text-align:right;color:${f};font-weight:600">${Math.round(d.floodRisk)}/100</td></tr>
      <tr><td style="color:#94a3b8;padding:2px 0">Flood prob. 72 h</td><td style="text-align:right;color:${f}">${Math.round(d.floodProb72h * 100)}%</td></tr>
      <tr><td style="color:#94a3b8;padding:2px 0">Rain next 72 h</td><td style="text-align:right;color:#7dd3fc">${Math.round(d.rainfall72hMm)} mm</td></tr>
      <tr><td style="color:#94a3b8;padding:2px 0">River discharge</td><td style="text-align:right;color:#e2e8f0">${d.riverDischargeM3s == null ? "n/a" : `${Math.round(d.riverDischargeM3s).toLocaleString()} m³/s`}</td></tr>
      <tr><td style="color:#94a3b8;padding:2px 0">Salinity risk</td><td style="text-align:right;color:${s};font-weight:600">${Math.round(d.salinityRisk)}/100</td></tr>
      <tr><td style="color:#94a3b8;padding:2px 0">Soil EC now</td><td style="text-align:right;color:${s}">${d.ecCurrent.toFixed(1)} dS/m</td></tr>
    </table>
    <div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:6px">
      <span style="display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(100,116,139,.5);border-radius:4px;padding:1px 5px;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;font-family:var(--font-mono),monospace"><span style="width:4px;height:4px;border-radius:9px;background:#22d3ee"></span>${live ? "Open-Meteo · GloFAS" : "Seeded baseline"}</span>
      <span style="font-size:10px;color:#64748b">${updated}</span>
    </div>
  </div>`;
}

export function LiveDemoMap({ height = "h-[520px]" }: { height?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [metric, setMetric] = useState<Metric>("flood");
  const [rain, setRain] = useState(false);
  const [region, setRegion] = useState("asia");
  const [ready, setReady] = useState(0);

  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const rainRef = useRef<Leaflet.TileLayer | null>(null);
  const polysRef = useRef<Map<string, Leaflet.GeoJSON>>(new Map());
  const pendingFocus = useRef<string | null>(null);

  const q = trpc.public.riskMap.useQuery(undefined, { enabled: near, refetchInterval: 5 * 60_000 });
  const districts = useMemo(() => q.data ?? [], [q.data]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    const id = new URLSearchParams(window.location.search).get("district");
    if (id) {
      pendingFocus.current = id;
      setNear(true);
    }
    return () => io.disconnect();
  }, []);

  const focusDistrict = useCallback(
    (id: string) => {
      const map = mapRef.current;
      const poly = polysRef.current.get(id);
      const d = districts.find((x) => x.id === id);
      if (!map || !d) {
        pendingFocus.current = id;
        return;
      }
      map.flyTo([d.lat, d.lon], 9, { duration: 1.2 });
      setRegion("");
      window.setTimeout(() => poly?.openPopup([d.lat, d.lon]), 1250);
    },
    [districts]
  );

  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) {
        setNear(true);
        focusDistrict(id);
      }
    };
    window.addEventListener(FOCUS_DISTRICT_EVENT, on);
    return () => window.removeEventListener(FOCUS_DISTRICT_EVENT, on);
  }, [focusDistrict]);

  // draw / redraw polygons
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    layerRef.current?.remove();
    polysRef.current.clear();
    const group = L.layerGroup().addTo(map);
    for (const d of districts) {
      const score = metric === "flood" ? d.floodRisk : d.salinityRisk;
      const color = riskColor(score);
      const poly = L.geoJSON(d.geometry as GeoJSON.Polygon, {
        style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.18 + (score / 100) * 0.32, opacity: 0.9 },
      });
      poly.bindPopup(popupHtml(d), { maxWidth: 280, className: "agri-popup" });
      poly.bindTooltip(`${d.name} · ${Math.round(score)}`, { direction: "top", sticky: true, opacity: 0.9 });
      poly.on("mouseover", () => poly.setStyle({ weight: 3 }));
      poly.on("mouseout", () => poly.setStyle({ weight: 1.5 }));
      poly.addTo(group);
      polysRef.current.set(d.id, poly);
      L.circleMarker([d.lat, d.lon], { radius: 5, color: "#050a14", weight: 1, fillColor: color, fillOpacity: 1, interactive: false }).addTo(group);
    }
    layerRef.current = group;
    if (pendingFocus.current && districts.length) {
      const id = pendingFocus.current;
      pendingFocus.current = null;
      window.setTimeout(() => focusDistrict(id), 300);
    }
  }, [districts, metric, ready, focusDistrict]);

  // rain overlay
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    if (rain && !rainRef.current) {
      rainRef.current = L.tileLayer(RAIN_OVERLAY.url, { attribution: RAIN_OVERLAY.attribution, maxNativeZoom: RAIN_OVERLAY.maxNativeZoom, maxZoom: 18, opacity: 0.65 }).addTo(map);
    } else if (!rain && rainRef.current) {
      rainRef.current.remove();
      rainRef.current = null;
    }
  }, [rain, ready]);

  const goRegion = (id: string) => {
    const r = REGIONS.find((x) => x.id === id)!;
    setRegion(id);
    mapRef.current?.flyTo(r.center, r.zoom, { duration: 1.1 });
  };

  const ranked = [...districts].sort((a, b) => (metric === "flood" ? b.floodRisk - a.floodRisk : b.salinityRisk - a.salinityRisk)).slice(0, 7);
  const liveCount = districts.filter((d) => d.liveSource === "open-meteo").length;

  return (
    <div ref={wrapRef} className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className={`hud-panel relative overflow-hidden !rounded-2xl ${height}`}>
        {near ? (
          <BaseMap
            center={REGIONS[0]!.center}
            zoom={REGIONS[0]!.zoom}
            className="absolute inset-0"
            onReady={(map, L) => {
              mapRef.current = map;
              LRef.current = L;
              map.scrollWheelZoom.disable();
              map.on("focus", () => map.scrollWheelZoom.enable());
              map.on("blur", () => map.scrollWheelZoom.disable());
              setReady((n) => n + 1);
              return () => {
                mapRef.current = null;
                LRef.current = null;
                rainRef.current = null;
                layerRef.current = null;
              };
            }}
          />
        ) : (
          <Skeleton className="absolute inset-0 rounded-none" />
        )}

        {/* controls */}
        <div className="absolute left-14 right-3 top-3 z-[500] flex flex-wrap items-start justify-between gap-2">
          <div role="radiogroup" aria-label="Risk layer" className="flex rounded-lg border border-white/10 bg-[#060a16]/90 p-1 backdrop-blur">
            {(
              [
                { id: "flood", label: "Flood", icon: Waves },
                { id: "salinity", label: "Salinity", icon: Droplets },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button key={id} role="radio" aria-checked={metric === id} onClick={() => setMetric(id)} className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3 text-xs font-medium ${metric === id ? (id === "flood" ? "bg-sky-500 text-slate-950" : "bg-amber-400 text-slate-950") : "text-slate-300 hover:text-white"}`}>
                <Icon size={14} aria-hidden /> {label}
              </button>
            ))}
          </div>
          <button onClick={() => setRain((r) => !r)} aria-pressed={rain} className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 text-xs backdrop-blur ${rain ? "border-sky-400/60 bg-sky-500/20 text-sky-100" : "border-white/10 bg-[#060a16]/90 text-slate-300 hover:text-white"}`}>
            <CloudRain size={14} aria-hidden /> NASA IMERG rain
          </button>
        </div>

        <div className="absolute bottom-3 left-3 z-[500] hidden rounded-lg border border-white/10 bg-[#060a16]/90 p-2.5 text-[10.5px] text-slate-300 backdrop-blur sm:block">
          <div className="mb-1 text-slate-400">{metric === "flood" ? "Flood risk (72 h)" : "Salinity risk (30 d)"}</div>
          <div className="flex items-center gap-2">
            {[
              ["#4ade80", "Low"],
              ["#fbbf24", "Med"],
              ["#f87171", "High"],
              ["#a78bfa", "Crit"],
            ].map(([c, l]) => (
              <span key={l} className="inline-flex items-center gap-1">
                <i className="h-2 w-2 rounded-sm" style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
        </div>
      </div>

      <aside className="flex flex-col gap-4" aria-label="Map controls and ranking">
        <div className="hud-panel p-4">
          <div className="text-xs text-slate-400">Jump to</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REGIONS.map((r) => (
              <button key={r.id} onClick={() => goRegion(r.id)} aria-pressed={region === r.id} className={`min-h-[34px] rounded-lg border px-2.5 text-xs transition-colors ${region === r.id ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100" : "border-white/10 text-slate-300 hover:border-white/25 hover:text-white"}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="hud-panel flex-1 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">Highest {metric} risk now</div>
            <SourceTag>{liveCount ? "Open-Meteo · GloFAS" : "Seeded"}</SourceTag>
          </div>
          <ol className="mt-3 space-y-1">
            {q.isLoading || !near
              ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)
              : ranked.map((d, i) => {
                  const score = metric === "flood" ? d.floodRisk : d.salinityRisk;
                  const level = score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low";
                  return (
                    <li key={d.id}>
                      <button onClick={() => focusDistrict(d.id)} className="flex min-h-[40px] w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-white/[0.04]">
                        <span className="telemetry w-4 text-[11px] text-slate-500">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-100">{d.name}</span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {d.country} · {metric === "flood" ? `${Math.round(d.rainfall72hMm)} mm / 72 h` : `${d.ecCurrent.toFixed(1)} dS/m`}
                          </span>
                        </span>
                        <RiskPill level={level} />
                      </button>
                    </li>
                  );
                })}
          </ol>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            {liveCount ? `${liveCount} of ${districts.length} districts on live data.` : "Live refresh in progress."} Click a district for rainfall, discharge and soil salinity.
          </p>
        </div>
      </aside>
    </div>
  );
}
