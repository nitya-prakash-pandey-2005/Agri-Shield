"use client";

/**
 * Earth Twin HUD: layer rail, KPI strip, live ticker, detail drawer, hover tip, sparkline.
 * Author: Nitya Prakash Pandey
 */
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Building2, CloudLightning, ExternalLink, Factory, Flame, Globe2, Layers, Map as MapIcon, MapPin, Moon, Radar, Route, Siren, Tornado, Waves, X } from "lucide-react";
import { Explain } from "@/components/help/Explain";
import { Meter, RiskPill, SourceTag, riskColor } from "@/components/hud";
import type { TwinScene, TwinTimeline } from "@/server/services/twin";
import type { LayerState, Selection } from "./Globe";
import { categoryColor, categoryLabel, hazardColor } from "./geo";

export const fmtUsd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3).toLocaleString("en-US")}k` : `$${Math.round(v)}`);
export const levelOf = (s: number) => (s >= 80 ? "critical" : s >= 60 ? "high" : s >= 35 ? "medium" : "low");
const DAY = 86_400_000;

// ─── Layer rail ───────────────────────────────────────────────────────────

const LAYER_META: { key: keyof LayerState; label: string; icon: typeof Layers; color: string; help: string }[] = [
  { key: "assets", label: "Portfolio", icon: Building2, color: "#fbbf24", help: "Your monitored assets as glowing pillars — height is the money at stake (exposure), colour is the composite risk score at the selected time. Zoomed out they merge into one column per district." },
  { key: "districts", label: "Districts", icon: MapIcon, color: "#4ade80", help: "Real administrative boundaries (geoBoundaries) of the districts your work touches, coloured by district risk." },
  { key: "hazards", label: "Live hazards", icon: Radar, color: "#fb923c", help: "Flood, cyclone and storm events reported in the last ~45-60 days by GDACS (UN / EU JRC) and NASA EONET. Rings pulse faster for red alerts." },
  { key: "cyclones", label: "Cyclone tracks", icon: Tornado, color: "#e879f9", help: "Tropical-cyclone best tracks of the last three seasons within 700 km of your footprint (NOAA IBTrACS) plus storms active now (GDACS). Colour = Saffir-Simpson category." },
  { key: "flows", label: "Commodity flows", icon: Route, color: "#fde68a", help: "Weekly supply-chain flows between your facilities; particles travel from origin to destination, more particles = more tonnes." },
  { key: "terminator", label: "Day / night", icon: Moon, color: "#93c5fd", help: "Real day/night shading from the Sun's position at the selected time." },
  { key: "graticule", label: "Grid", icon: Globe2, color: "#5eead4", help: "15° latitude/longitude grid." },
];

export function LayerRail({ layers, setLayer, scene, fpsRef, className }: { layers: LayerState; setLayer: (k: keyof LayerState, v: boolean) => void; scene: TwinScene; fpsRef?: React.MutableRefObject<HTMLSpanElement | null>; className?: string }) {
  const counts: Partial<Record<keyof LayerState, string>> = {
    assets: scene.assets.length ? `${scene.assets.length}` : scene.districts.length ? `${scene.districts.length} dist.` : "0",
    districts: `${scene.districts.length}`,
    hazards: `${scene.hazards.length}`,
    cyclones: `${scene.tracks.length}`,
    flows: `${scene.flows.length}`,
  };
  return (
    <div className={`hud-panel w-full p-3 ${className ?? ""}`} style={{ ["--hud-accent" as string]: "56 189 248" }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="hud-label text-cyan-300/80">Layers</span>
        <span ref={fpsRef} className="telemetry text-[10px] text-slate-500" aria-live="off" data-testid="twin-fps">
          — fps
        </span>
      </div>
      <ul className="space-y-1">
        {LAYER_META.map((m) => {
          const on = layers[m.key];
          const disabled = (m.key === "flows" && !scene.flows.length) || (m.key === "hazards" && !scene.hazards.length && scene.feeds.hazards !== "ok");
          return (
            <li key={m.key} className="flex items-center gap-1">
              <button
                type="button"
                role="switch"
                aria-checked={on}
                disabled={m.key === "flows" && !scene.flows.length}
                onClick={() => setLayer(m.key, !on)}
                className={`group flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition ${on ? "bg-white/[0.05] text-slate-100" : "text-slate-500 hover:text-slate-300"} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="grid h-5 w-5 place-items-center rounded-md" style={{ background: on ? `${m.color}22` : "transparent", color: on ? m.color : "#64748b" }}>
                  <m.icon size={12} />
                </span>
                <span className="flex-1 truncate">{m.key === "assets" && !scene.assets.length ? "Farm columns" : m.label}</span>
                {counts[m.key] != null && <span className={`telemetry text-[10px] ${disabled ? "text-slate-600" : "text-slate-400"}`}>{counts[m.key]}</span>}
                <span className={`h-3.5 w-6 rounded-full p-0.5 transition ${on ? "bg-cyan-500/70" : "bg-slate-700"}`}>
                  <span className={`block h-2.5 w-2.5 rounded-full bg-white transition ${on ? "translate-x-2.5" : ""}`} />
                </span>
              </button>
              <Explain text={m.help} title={m.label} side="right" />
            </li>
          );
        })}
      </ul>
      <div className="mt-3 border-t border-white/5 pt-2">
        <div className="hud-label mb-1.5">
          <Explain term="composite_score">Risk colour</Explain>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full">
          {["#4ade80", "#fbbf24", "#f87171", "#a78bfa"].map((c) => (
            <span key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between telemetry text-[9px] text-slate-500">
          <span>0</span>
          <span>35</span>
          <span>60</span>
          <span>80</span>
          <span>100</span>
        </div>
        {layers.cyclones && scene.tracks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
            {[-1, 0, 1, 2, 3, 4, 5].map((c) => (
              <span key={c} className="inline-flex items-center gap-1 telemetry text-[9px] text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: categoryColor(c) }} />
                {c < 0 ? "TD" : c === 0 ? "TS" : `C${c}`}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPI strip ────────────────────────────────────────────────────────────

export interface KpiView {
  atRisk: number;
  exposureAtRisk: number;
  districtsHigh: number;
  farmsAtRisk: number;
}

export function KpiStrip({ scene, view, offset, className, big }: { scene: TwinScene; view: KpiView; offset: number; className?: string; big?: boolean }) {
  const k = scene.kpis;
  const when = Math.abs(offset) < 0.05 ? "now" : offset < 0 ? `D${Math.round(offset)}` : `D+${Math.round(offset)}`;
  const tiles: { label: ReactNode; value: string; sub: string; color: string }[] = scene.assets.length
    ? [
        { label: <Explain term="risk_threshold">{`${scene.org.assetNoun} at risk`}</Explain>, value: `${view.atRisk}`, sub: `of ${k.assets} · ≥ ${k.threshold} · ${when}`, color: view.atRisk ? "#f87171" : "#4ade80" },
        { label: <Explain term="exposure">Exposure at risk</Explain>, value: fmtUsd(view.exposureAtRisk), sub: `of ${fmtUsd(k.exposureUsd)} · ${when}`, color: "#fbbf24" },
        { label: <Explain term="var">Value at risk</Explain>, value: fmtUsd(k.varUsd), sub: `${k.exposureUsd ? ((k.varUsd / k.exposureUsd) * 100).toFixed(1) : "0"}% of exposure · now`, color: "#a78bfa" },
        { label: <Explain term="gdacs">Hazards nearby</Explain>, value: `${k.nearbyHazards}`, sub: scene.feeds.hazards === "ok" ? `${k.activeHazards} in the region` : scene.feeds.hazards === "warming" ? "feed connecting…" : "feed unavailable", color: k.nearbyHazards ? "#fb923c" : "#94a3b8" },
        { label: "Open incidents", value: k.openIncidents == null ? "—" : `${k.openIncidents}`, sub: k.openIncidents == null ? "incident desk not connected" : `${k.activeAlerts} active alerts`, color: k.openIncidents ? "#f87171" : "#94a3b8" },
      ]
    : [
        { label: <Explain term="risk_threshold">High-risk districts</Explain>, value: `${view.districtsHigh}`, sub: `of ${k.districts} · ≥ ${k.threshold} · ${when}`, color: view.districtsHigh ? "#f87171" : "#4ade80" },
        { label: "Farms in them", value: view.farmsAtRisk.toLocaleString("en-US"), sub: `households farming · ${when}`, color: "#fbbf24" },
        { label: "Active alerts", value: `${k.activeAlerts}`, sub: "issued to your districts", color: k.activeAlerts ? "#fb923c" : "#94a3b8" },
        { label: <Explain term="gdacs">Hazards nearby</Explain>, value: `${k.nearbyHazards}`, sub: scene.feeds.hazards === "ok" ? `${k.activeHazards} in the region` : scene.feeds.hazards === "warming" ? "feed connecting…" : "feed unavailable", color: k.nearbyHazards ? "#fb923c" : "#94a3b8" },
        { label: "Open incidents", value: k.openIncidents == null ? "—" : `${k.openIncidents}`, sub: k.openIncidents == null ? "incident desk not connected" : "open now", color: k.openIncidents ? "#f87171" : "#94a3b8" },
      ];
  return (
    <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 ${className ?? ""}`} data-testid="twin-kpis">
      {tiles.map((t, i) => (
        <div key={i} className={`hud-panel px-3 py-2 ${i === 4 ? "col-span-2 sm:col-span-1" : ""}`} style={{ ["--hud-accent" as string]: "56 189 248" }}>
          <div className="hud-label truncate">{t.label}</div>
          <div className={`telemetry font-semibold ${big ? "text-4xl" : "text-xl"}`} style={{ color: t.color, textShadow: `0 0 18px ${t.color}55` }}>
            {t.value}
          </div>
          <div className="truncate text-[10.5px] text-slate-500">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Ticker ───────────────────────────────────────────────────────────────

export interface TickerItem {
  id: string;
  text: string;
  color: string;
  sel?: Selection;
  at?: string;
}

export function buildTicker(scene: TwinScene, timeline: TwinTimeline | null): TickerItem[] {
  const out: TickerItem[] = [];
  for (const t of scene.tracks.filter((x) => x.active)) out.push({ id: `c-${t.id}`, text: `CYCLONE ${t.name.toUpperCase()} · ${t.maxWindKt} kt · ${t.closestKm} km from ${t.closestTo}`, color: categoryColor(t.maxCategory), sel: { kind: "cyclone", id: t.id } });
  for (const h of scene.hazards.slice(0, 14))
    out.push({ id: `h-${h.id}`, text: `${h.source === "GDACS" ? "GDACS" : "EONET"} · ${h.title}${h.nearestKm != null && h.nearby ? ` · ${h.nearestKm} km from ${h.nearestName}` : ""}`, color: hazardColor(h.alertLevel, h.type), sel: { kind: "hazard", id: h.id }, at: h.date });
  if (timeline) {
    const recent = timeline.days.filter((d) => d.offset <= 0 && d.offset >= -7).flatMap((d) => d.events.filter((e) => e.severity === "warning" || e.severity === "critical"));
    for (const e of recent.slice(0, 10)) out.push({ id: `e-${e.id}`, text: `${e.kind.toUpperCase()} · ${e.title}`, color: e.severity === "critical" ? "#f87171" : "#fb923c", at: e.at });
  }
  const worst = [...scene.districts].sort((a, b) => b.composite - a.composite).slice(0, 3);
  for (const d of worst) out.push({ id: `d-${d.id}`, text: `${d.name.toUpperCase()} · risk ${d.composite}/100${d.dischargeRatio && d.dischargeRatio >= 1.3 ? ` · river ${d.dischargeRatio.toFixed(1)}× normal` : ""}${d.ecCurrent >= 3 ? ` · EC ${d.ecCurrent} dS/m` : ""}`, color: riskColor(d.composite), sel: { kind: "district", id: d.id } });
  return out;
}

export function Ticker({ items, onPick, reduced, className }: { items: TickerItem[]; onPick: (s: Selection) => void; reduced: boolean; className?: string }) {
  if (!items.length) return null;
  const dur = Math.max(40, items.length * 7);
  const row = (k: string) => (
    <div className="flex shrink-0 items-center gap-6 pr-6" aria-hidden={k === "b"}>
      {items.map((it) => (
        <button key={`${k}-${it.id}`} type="button" tabIndex={k === "b" ? -1 : 0} onClick={() => it.sel && onPick(it.sel)} className="inline-flex items-center gap-2 whitespace-nowrap telemetry text-[11px] text-slate-300 hover:text-white">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: it.color, boxShadow: `0 0 8px ${it.color}` }} />
          {it.text}
        </button>
      ))}
    </div>
  );
  return (
    <div className={`group relative overflow-hidden ${className ?? ""}`} data-testid="twin-ticker">
      <style>{`@keyframes twin-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>
      <div className={`flex w-max ${reduced ? "overflow-x-auto" : ""}`} style={reduced ? undefined : { animation: `twin-marquee ${dur}s linear infinite` }} onMouseEnter={(e) => (e.currentTarget.style.animationPlayState = "paused")} onMouseLeave={(e) => (e.currentTarget.style.animationPlayState = "running")}>
        {row("a")}
        {!reduced && row("b")}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-[#030814] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#030814] to-transparent" />
    </div>
  );
}

// ─── Hover tip ────────────────────────────────────────────────────────────

export function HoverTip({ tip }: { tip: { title: string; sub: string; x: number; y: number; color?: string } | null }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-30 max-w-[260px] rounded-lg border border-white/10 bg-[#050b18]/92 px-2.5 py-1.5 shadow-xl backdrop-blur" style={{ left: tip.x + 14, top: tip.y + 14 }}>
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-white">
        {tip.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tip.color }} />}
        <span className="truncate">{tip.title}</span>
      </div>
      <div className="telemetry text-[10.5px] text-slate-400">{tip.sub}</div>
    </div>
  );
}

// ─── Sparkline (past solid · future dashed · marker at scrub time) ───────

export function Sparkline({ series, todayIdx, markIdx, threshold, height = 56 }: { series: number[]; todayIdx: number; markIdx: number; threshold?: number; height?: number }) {
  const W = 300;
  const H = height;
  if (series.length < 2) return null;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => H - 4 - (Math.max(0, Math.min(100, v)) / 100) * (H - 8);
  const path = (from: number, to: number) => series.slice(from, to + 1).map((v, k) => `${k ? "L" : "M"}${x(from + k).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const mi = Math.max(0, Math.min(series.length - 1, markIdx));
  const mv = series[Math.round(mi)] ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" preserveAspectRatio="none" role="img" aria-label={`Risk score over time, ${Math.round(mv)} at the selected day`}>
      {threshold != null && <line x1={0} x2={W} y1={y(threshold)} y2={y(threshold)} stroke="#f87171" strokeOpacity={0.35} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      <line x1={x(todayIdx)} x2={x(todayIdx)} y1={0} y2={H} stroke="#94a3b8" strokeOpacity={0.35} vectorEffect="non-scaling-stroke" />
      <path d={path(0, todayIdx)} fill="none" stroke="#38bdf8" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <path d={path(todayIdx, series.length - 1)} fill="none" stroke="#38bdf8" strokeWidth={1.6} strokeDasharray="4 3" strokeOpacity={0.8} vectorEffect="non-scaling-stroke" />
      <line x1={x(mi)} x2={x(mi)} y1={0} y2={H} stroke="#fbbf24" strokeOpacity={0.7} vectorEffect="non-scaling-stroke" />
      <circle cx={x(mi)} cy={y(mv)} r={3} fill={riskColor(mv)} />
    </svg>
  );
}

// ─── Detail drawer ────────────────────────────────────────────────────────

function Row({ label, value, color }: { label: ReactNode; value: ReactNode; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] py-1.5 text-[12px]">
      <span className="text-slate-400">{label}</span>
      <span className="telemetry text-right text-slate-100" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

function LinkBtn({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  const cls = "inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11.5px] font-medium text-cyan-100 hover:border-cyan-400/60 hover:bg-cyan-500/20";
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children} <ExternalLink size={11} />
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children} <ArrowRight size={11} />
    </Link>
  );
}

function Meaning({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-2.5 text-[12px] leading-relaxed text-slate-200">
      <div className="hud-label mb-1 text-emerald-300/80">What this means</div>
      {children}
    </div>
  );
}

export interface DrawerCtx {
  scene: TwinScene;
  timeline: TwinTimeline | null;
  assetScores: number[];
  districtScores: number[];
  dayIndex: number;
  offset: number;
  onSelect: (s: Selection | null) => void;
}

const incidentHref = (title: string, lat: number, lon: number, o: { assetIds?: string[]; hazard?: string; radiusKm?: number; summary?: string } = {}) => {
  const q = new URLSearchParams({ new: "1", source: "manual", title, lat: lat.toFixed(4), lon: lon.toFixed(4) });
  if (o.assetIds?.length) q.set("assetIds", o.assetIds.join(","));
  if (o.hazard) q.set("hazard", o.hazard);
  if (o.radiusKm) q.set("radiusKm", String(o.radiusKm));
  if (o.summary) q.set("summary", o.summary);
  return `/app/incidents?${q.toString()}`;
};
const dominantHazard = (a: { flood: number; salinity: number; drought: number; heat: number }) => (["flood", "salinity", "drought", "heat"] as const).reduce((b, h) => (a[h] > a[b] ? h : b), "flood" as "flood" | "salinity" | "drought" | "heat");
const hazardTypeFor = (t: string) => (t === "flood" ? "flood" : t === "cyclone" || t === "storm" ? "cyclone" : t === "drought" ? "drought" : "other");
const explorerHref = (lat: number, lon: number, name?: string) => `/app/explorer?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}${name ? `&name=${encodeURIComponent(name)}` : ""}`;

export function DetailDrawer({ sel, ctx, className }: { sel: Selection; ctx: DrawerCtx; className?: string }) {
  const { scene, timeline, onSelect } = ctx;
  const todayIdx = timeline ? -timeline.from : 0;
  const when = Math.abs(ctx.offset) < 0.05 ? "now" : ctx.offset < 0 ? `${Math.round(-ctx.offset)} days ago` : `in ${Math.round(ctx.offset)} days`;
  let body: ReactNode = null;
  let title = "";
  let kicker = "";
  let icon: ReactNode = <MapPin size={14} />;

  if (sel.kind === "asset") {
    const i = scene.assets.findIndex((a) => a.id === sel.id);
    const a = scene.assets[i];
    if (a) {
      const s = Math.round(ctx.assetScores[i] ?? a.score);
      const ser = timeline?.assetSeries.find((x) => x.id === a.id)?.s;
      const d = scene.districts.find((x) => x.id === a.districtId);
      title = a.name;
      kicker = `${a.type.replace(/_/g, " ")}${a.externalRef ? ` · ${a.externalRef}` : ""}`;
      icon = <Building2 size={14} />;
      const above = s >= scene.kpis.threshold;
      body = (
        <>
          <div className="flex items-end justify-between">
            <div>
              <div className="hud-label">
                <Explain term="composite_score">Composite risk</Explain> · {when}
              </div>
              <div className="telemetry text-4xl font-semibold" style={{ color: riskColor(s) }}>
                {s}
                <span className="text-base text-slate-500">/100</span>
              </div>
            </div>
            <RiskPill level={levelOf(s)} />
          </div>
          {ser && <Sparkline series={ser} todayIdx={todayIdx} markIdx={ctx.dayIndex} threshold={scene.kpis.threshold} />}
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {(["flood", "salinity", "drought", "heat"] as const).map((h) => (
              <div key={h}>
                <div className="flex justify-between text-[10.5px] text-slate-400">
                  <span className="capitalize">{h}</span>
                  <span className="telemetry">{a[h]}</span>
                </div>
                <Meter value={a[h]} />
              </div>
            ))}
          </div>
          <div className="mt-2">
            <Row label={<Explain term="exposure">Exposure</Explain>} value={fmtUsd(a.valueUsd)} />
            <Row label={<Explain term="var">Value at risk (now)</Explain>} value={fmtUsd(a.varUsd)} color="#a78bfa" />
            <Row label="District" value={d ? `${d.name}, ${d.countryName}` : a.country} />
            <Row label="Main driver" value={<span className="text-[11px]">{a.driver || "—"}</span>} />
            <Row label="Coordinates" value={`${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}`} />
          </div>
          <Meaning>
            {above
              ? `This ${scene.org.assetNounSingular} is at or above your risk threshold of ${scene.kpis.threshold} ${when}. About ${fmtUsd(a.varUsd)} of its ${fmtUsd(a.valueUsd)} could be lost in a bad event — review it and consider early action.`
              : `This ${scene.org.assetNounSingular} is below your risk threshold of ${scene.kpis.threshold} ${when}. Keep monitoring; ${a.driver ? `the main pressure is: ${a.driver.toLowerCase()}.` : "no single hazard dominates."}`}
          </Meaning>
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkBtn href={`/app/portfolio/${a.id}`}>Open in Portfolio</LinkBtn>
            <LinkBtn href={explorerHref(a.lat, a.lon, a.name)}>Full risk report</LinkBtn>
            {above && <LinkBtn href={incidentHref(`${a.name}: risk ${s}/100`, a.lat, a.lon, { assetIds: [a.id], hazard: dominantHazard(a), summary: `Raised from Earth Twin. Main driver: ${a.driver || "composite risk"}.` })}>Open incident</LinkBtn>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <SourceTag>{a.source === "live" ? "Portfolio re-score (live)" : a.source === "fallback" ? "Last stored score" : "District baseline"}</SourceTag>
          </div>
        </>
      );
    }
  } else if (sel.kind === "district" || sel.kind === "cluster") {
    const i = scene.districts.findIndex((x) => x.id === sel.id);
    const d = scene.districts[i];
    if (d) {
      const s = Math.round(ctx.districtScores[i] ?? d.composite);
      const ser = timeline?.districtSeries.find((x) => x.id === d.id)?.s;
      const inside = scene.assets.map((a, k) => ({ a, s: ctx.assetScores[k] ?? a.score })).filter((x) => x.a.districtId === d.id).sort((x, y) => y.s - x.s);
      title = d.name;
      kicker = `District · ${d.countryName} · ${d.river}`;
      icon = <MapIcon size={14} />;
      body = (
        <>
          <div className="flex items-end justify-between">
            <div>
              <div className="hud-label">District risk · {when}</div>
              <div className="telemetry text-4xl font-semibold" style={{ color: riskColor(s) }}>
                {s}
                <span className="text-base text-slate-500">/100</span>
              </div>
            </div>
            <RiskPill level={levelOf(s)} />
          </div>
          {ser && <Sparkline series={ser} todayIdx={todayIdx} markIdx={ctx.dayIndex} threshold={scene.kpis.threshold} />}
          <div className="mt-1">
            <Row label={<Explain term="flood_probability">Flood probability (72 h)</Explain>} value={`${d.floodProb72h}%`} color={riskColor(d.floodProb72h)} />
            <Row label={<Explain term="ec">Soil salinity (EC)</Explain>} value={`${d.ecCurrent} dS/m → ${d.ecPredicted30d} in 30 d`} color={d.ecCurrent >= 3 ? "#fbbf24" : undefined} />
            <Row label={<Explain term="discharge_ratio">River vs normal</Explain>} value={d.dischargeRatio != null ? `${d.dischargeRatio.toFixed(2)}×` : "not measured"} />
            <Row label="Rain, next 72 h" value={`${d.rain72hMm} mm`} />
            <Row label="Farms" value={d.farms.toLocaleString("en-US")} />
            {d.assets > 0 && <Row label={`Your ${scene.org.assetNoun}`} value={`${d.assets} · ${fmtUsd(d.exposureUsd)}`} />}
            {d.assets > 0 && <Row label={<Explain term="var">Value at risk</Explain>} value={fmtUsd(d.varUsd)} color="#a78bfa" />}
          </div>
          {inside.length > 0 && (
            <div className="mt-2">
              <div className="hud-label mb-1">Highest-risk {scene.org.assetNoun} here</div>
              <ul className="space-y-0.5">
                {inside.slice(0, 5).map(({ a, s: v }) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => onSelect({ kind: "asset", id: a.id })} className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[11.5px] hover:bg-white/5">
                      <span className="truncate text-slate-200">{a.name}</span>
                      <span className="telemetry" style={{ color: riskColor(v) }}>
                        {Math.round(v)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Meaning>
            {s >= scene.kpis.threshold
              ? `${d.name} is under high pressure ${when}. ${d.assets ? `${d.assets} of your ${scene.org.assetNoun} (${fmtUsd(d.exposureUsd)}) sit here.` : `About ${d.farms.toLocaleString("en-US")} farms are exposed.`} Check alerts and consider anticipatory action.`
              : `${d.name} is below your high-risk threshold ${when}. ${d.ecCurrent >= 3 ? "Salinity is above the rice tolerance limit, so salt-sensitive crops may still suffer." : "No immediate action needed."}`}
          </Meaning>
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkBtn href={explorerHref(d.lat, d.lon, d.name)}>Full risk report</LinkBtn>
            <LinkBtn href="/app/alerts">Alerts & rules</LinkBtn>
            {s >= scene.kpis.threshold && <LinkBtn href={incidentHref(`${d.name}: district risk ${s}/100`, d.lat, d.lon, { assetIds: inside.slice(0, 50).map((x) => x.a.id), hazard: d.flood >= d.salinity ? "flood" : "salinity", radiusKm: 40, summary: `Raised from Earth Twin: ${d.name} district risk ${s}/100.` })}>Open incident</LinkBtn>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <SourceTag>{d.liveSource === "open-meteo" ? "Open-Meteo + GloFAS (live)" : "Model baseline (live feed paused)"}</SourceTag>
            <SourceTag href="https://www.geoboundaries.org">geoBoundaries</SourceTag>
          </div>
        </>
      );
    } else if (sel.kind === "cluster") {
      title = "Cluster";
      body = <p className="text-sm text-slate-400">Zoom in to see individual {scene.org.assetNoun}.</p>;
    }
  } else if (sel.kind === "hazard") {
    const h = scene.hazards.find((x) => x.id === sel.id);
    if (h) {
      title = h.title;
      kicker = `${h.source} · ${h.type}${h.country ? ` · ${h.country}` : ""}`;
      icon = h.type === "flood" ? <Waves size={14} /> : h.type === "cyclone" ? <Tornado size={14} /> : h.type === "drought" ? <Flame size={14} /> : <CloudLightning size={14} />;
      body = (
        <>
          <div className="flex items-center gap-2">
            <span className="rounded-md px-2 py-0.5 telemetry text-[11px] font-semibold uppercase" style={{ background: `${hazardColor(h.alertLevel, h.type)}22`, color: hazardColor(h.alertLevel, h.type) }}>
              {h.alertLevel ? `${h.alertLevel} alert` : "reported"}
            </span>
            <span className="telemetry text-[11px] text-slate-400">{new Date(h.date).toISOString().slice(0, 10)}</span>
          </div>
          <div className="mt-2">
            <Row label="Nearest of yours" value={h.nearestKm != null ? `${h.nearestKm} km · ${h.nearestName}` : "—"} />
            {scene.assets.length > 0 && <Row label={`${scene.org.assetNoun} within 300 km`} value={`${h.assetsWithin}`} color={h.assetsWithin ? "#fb923c" : undefined} />}
            {scene.assets.length > 0 && <Row label="Exposure within 300 km" value={fmtUsd(h.exposureWithinUsd)} />}
            <Row label="Location" value={`${h.lat.toFixed(2)}, ${h.lon.toFixed(2)}`} />
          </div>
          <Meaning>
            {h.assetsWithin > 0
              ? `${h.assetsWithin} of your ${scene.org.assetNoun} (${fmtUsd(h.exposureWithinUsd)}) are within 300 km of this event. Check their latest scores and warn the people on the ground.`
              : h.nearby
                ? `This event is ${h.nearestKm} km from ${h.nearestName}. Nothing of yours is inside 300 km, but keep an eye on how it develops.`
                : "This event is far from your footprint — shown for regional awareness."}
          </Meaning>
          <div className="mt-3 flex flex-wrap gap-2">
            {h.url && (
              <LinkBtn href={h.url} external>
                Source report
              </LinkBtn>
            )}
            <LinkBtn href={explorerHref(h.lat, h.lon, h.title)}>Assess this location</LinkBtn>
            {h.assetsWithin > 0 && <LinkBtn href={incidentHref(h.title, h.lat, h.lon, { hazard: hazardTypeFor(h.type), radiusKm: 300, summary: `${h.source} report${h.alertLevel ? ` (${h.alertLevel} alert)` : ""}: ${h.assetsWithin} ${scene.org.assetNoun} within 300 km.` })}>Open incident</LinkBtn>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <SourceTag href={h.source === "GDACS" ? "https://www.gdacs.org" : "https://eonet.gsfc.nasa.gov"}>{h.source}</SourceTag>
          </div>
        </>
      );
    }
  } else if (sel.kind === "cyclone") {
    const t = scene.tracks.find((x) => x.id === sel.id);
    if (t) {
      title = t.name.startsWith("Unnamed") ? t.name : `Cyclone ${t.name}`;
      kicker = `${t.season} · basin ${t.basin}${t.provisional ? " · provisional track" : ""}`;
      icon = <Tornado size={14} />;
      const winds = t.points.map((p) => p[3] ?? 0);
      const maxW = Math.max(1, ...winds);
      body = (
        <>
          <div className="flex items-center gap-2">
            <span className="rounded-md px-2 py-0.5 telemetry text-[11px] font-semibold uppercase" style={{ background: `${categoryColor(t.maxCategory)}22`, color: categoryColor(t.maxCategory) }}>
              {categoryLabel(t.maxCategory)}
            </span>
            {t.active && <span className="rounded-md bg-rose-500/15 px-2 py-0.5 telemetry text-[11px] font-semibold text-rose-300">ACTIVE</span>}
          </div>
          <svg viewBox="0 0 300 50" className="mt-2 h-12 w-full" preserveAspectRatio="none" role="img" aria-label="Wind speed along the track">
            {winds.map((w, i) => (
              <rect key={i} x={(i / winds.length) * 300} y={50 - (w / maxW) * 46} width={Math.max(1, 300 / winds.length - 1)} height={(w / maxW) * 46} fill={categoryColor(t.points[i]![4])} opacity={0.85} />
            ))}
          </svg>
          <div className="mt-1">
            <Row label={<Explain text="Highest 1-minute sustained wind recorded along the track (1 kt = 1.85 km/h). Saffir-Simpson categories start at 64 kt (Category 1).">Peak wind</Explain>} value={`${t.maxWindKt} kt · ${Math.round(t.maxWindKt * 1.852)} km/h`} />
            {t.minPresHpa && <Row label="Lowest pressure" value={`${t.minPresHpa} hPa`} />}
            <Row label="Closest approach" value={`${t.closestKm} km · ${t.closestTo}`} color={t.closestKm < 200 ? "#f87171" : undefined} />
            <Row label="When" value={new Date(t.closestAt).toISOString().slice(0, 10)} />
            <Row label="Lifetime" value={`${t.start.slice(0, 10)} → ${t.end.slice(0, 10)}`} />
          </div>
          <Meaning>
            {t.closestKm < 200
              ? `${t.name} passed within ${t.closestKm} km of ${t.closestTo}. Storms this close bring damaging wind, storm surge and heavy rain — compare your losses and claims around ${new Date(t.closestAt).toISOString().slice(0, 10)} with this track.`
              : `${t.name} stayed ${t.closestKm} km from your nearest location (${t.closestTo}). Its outer rain bands may still have caused flooding.`}
          </Meaning>
          <div className="mt-3 flex flex-wrap gap-2">
            {t.gdacsUrl && (
              <LinkBtn href={t.gdacsUrl} external>
                GDACS report
              </LinkBtn>
            )}
            {!t.provisional && t.source !== "GDACS" && (
              <LinkBtn href={`https://ncics.org/ibtracs/index.php?name=v04r01-${t.id}`} external>
                IBTrACS record
              </LinkBtn>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <SourceTag href="https://www.ncei.noaa.gov/products/international-best-track-archive">NOAA IBTrACS v04r01</SourceTag>
            {t.source !== "IBTrACS" && <SourceTag href="https://www.gdacs.org">GDACS</SourceTag>}
          </div>
        </>
      );
    }
  } else if (sel.kind === "flow") {
    const f = scene.flows.find((x) => x.id === sel.id);
    if (f) {
      title = `${f.from.name} → ${f.to.name}`;
      kicker = `${f.commodity} flow`;
      icon = <Factory size={14} />;
      const riskier = f.from.risk >= f.to.risk ? f.from : f.to;
      body = (
        <>
          <Row label="Volume" value={`${f.tonnesPerWeek.toLocaleString("en-US")} t/week`} />
          <Row label={`Origin risk · ${f.from.type}`} value={`${f.from.risk}/100`} color={riskColor(f.from.risk)} />
          <Row label={`Destination risk · ${f.to.type}`} value={`${f.to.risk}/100`} color={riskColor(f.to.risk)} />
          <Meaning>
            {f.risk >= scene.kpis.threshold
              ? `One end of this lane (${riskier.name}) is at high risk. A disruption there would hold up about ${f.tonnesPerWeek.toLocaleString("en-US")} t of ${f.commodity} a week — line up an alternative route or buffer stock.`
              : `Both ends of this lane are below your risk threshold. ${f.tonnesPerWeek.toLocaleString("en-US")} t of ${f.commodity} move along it each week.`}
          </Meaning>
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkBtn href={explorerHref(riskier.lat, riskier.lon, riskier.name)}>Assess {riskier.name}</LinkBtn>
          </div>
        </>
      );
    }
  }

  if (!body)
    return (
      <aside className={className}>
        <div className="hud-panel p-4 text-sm text-slate-400">This item is not in the current view. <button className="underline" onClick={() => onSelect(null)}>Close</button></div>
      </aside>
    );

  return (
    <aside className={className} aria-label={`Details: ${title}`} data-testid="twin-drawer">
      <div className="hud-panel flex max-h-full min-h-0 flex-col overflow-hidden" style={{ ["--hud-accent" as string]: "56 189 248" }}>
        <header className="flex items-start gap-2 border-b border-white/5 px-4 pb-2.5 pt-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cyan-500/10 text-cyan-300">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="hud-label truncate">{kicker}</div>
            <h2 className="font-display text-[15px] font-semibold leading-snug text-white">{title}</h2>
          </div>
          <button type="button" onClick={() => onSelect(null)} aria-label="Close details" className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white">
            <X size={16} />
          </button>
        </header>
        <div className="overflow-y-auto px-4 pb-4 pt-3">{body}</div>
      </div>
    </aside>
  );
}

// ─── Feed status chips ───────────────────────────────────────────────────

export function FeedChips({ scene, timeline }: { scene: TwinScene; timeline: TwinTimeline | null }) {
  const chips = useMemo(() => {
    const c: { label: string; ok: boolean; title: string }[] = [];
    c.push({ label: scene.feeds.hazards === "ok" ? "GDACS · EONET live" : scene.feeds.hazards === "warming" ? "Hazard feeds connecting" : "Hazard feeds unavailable", ok: scene.feeds.hazards === "ok", title: "Live hazard reports (GDACS, NASA EONET), refreshed every 30 min" });
    c.push({ label: scene.feeds.forecast === "live" ? "Forecast live" : "Forecast paused · climatology", ok: scene.feeds.forecast === "live", title: timeline?.forecast.note ?? "" });
    c.push({ label: `IBTrACS ${scene.feeds.tracksGenerated}`, ok: true, title: scene.feeds.tracksSource });
    return c;
  }, [scene, timeline]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c.label} title={c.title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 telemetry text-[9.5px] uppercase tracking-wider ${c.ok ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}`}>
          {c.ok ? <span className="h-1 w-1 rounded-full bg-emerald-400" /> : <AlertTriangle size={9} />}
          {c.label}
        </span>
      ))}
    </div>
  );
}

export { Siren, DAY };
