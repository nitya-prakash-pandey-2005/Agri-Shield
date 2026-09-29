"use client";

/**
 * Vegetation time series: MODIS MOD13Q1 250 m NDVI at a point vs the same
 * 16-day composites of the previous three years (mean ± 1σ band), anomaly
 * bars and "stress detected" markers.
 */
import { useMemo } from "react";
import { AlertTriangle, CloudFog, Leaf, Sprout } from "lucide-react";
import { Area, Bar, BarChart, Cell, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { EmptyState, Panel, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { ErrorBox, Kpi, VIZ, WhatThisMeans, axisProps, tooltipStyle } from "@/components/insurance/kit";
import { trpc } from "@/lib/trpc";
import { PlacePicker, type Place, type PlacesOut } from "./common";

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });

export default function Vegetation({ places, place, onPlace }: { places: PlacesOut | undefined; place: Place | null; onPlace: (p: Place) => void }) {
  const input = place?.assetId ? { assetId: place.assetId } : place ? { lat: place.lat, lon: place.lon, name: place.name } : null;
  const q = trpc.imagery.ndvi.useQuery(input ?? { lat: 0, lon: 0 }, { enabled: !!input, staleTime: 30 * 60_000, retry: 1 });
  const d = q.data;

  const chart = useMemo(
    () =>
      (d?.points ?? []).map((p) => ({
        ...p,
        label: fmtDate(p.date),
        band: p.lower != null && p.upper != null ? [p.lower, p.upper] : null,
      })),
    [d]
  );
  const stressPts = chart.filter((p) => p.stress);
  const minVal = Math.min(0, ...chart.flatMap((p) => [p.ndvi, p.lower ?? p.ndvi]));
  const yLo = Math.floor(minVal * 5) / 5;
  const yTicks = Array.from({ length: Math.round((1 - yLo) / 0.2) + 1 }, (_, i) => Math.round((yLo + i * 0.2) * 10) / 10);
  const toneColour = d?.tone === "critical" ? "rose" : d?.tone === "warning" ? "amber" : d?.tone === "ok" ? "emerald" : "sky";

  return (
    <div className="space-y-4">
      <Panel title="Vegetation health (NDVI)" subtitle="Pick an asset or point — one satellite point is fetched on demand and cached" icon={Leaf} accent="emerald">
        <PlacePicker places={places} value={place} onChange={onPlace} />
      </Panel>

      {!place ? (
        <Panel>
          <EmptyState icon={Sprout} title="Choose a place to chart its vegetation">
            Pick one of your assets or a monitored district above (districts marked “NDVI cached” load instantly), or type coordinates.
          </EmptyState>
        </Panel>
      ) : q.isLoading ? (
        <Panel>
          <div className="space-y-3">
            <div className="text-[12px] text-slate-400">Fetching MODIS composites from NASA ORNL DAAC (this season + the same weeks of 3 previous years — up to a minute the first time, instant afterwards)…</div>
            <Skeleton className="h-[280px]" />
          </div>
        </Panel>
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : d && !d.points.length ? (
        <Panel>
          <EmptyState icon={CloudFog} title="No usable composites">
            MODIS returned no valid NDVI for this point in the last 150 days (open water, persistent cloud or outside land). Try a nearby field.
          </EmptyState>
        </Panel>
      ) : d ? (
        <>
          <WhatThisMeans tone={toneColour as "sky" | "amber" | "rose" | "emerald"}>
            {d.summary} <span className="text-slate-400">The shaded band is what's normal for each date (average of {d.baselineYears.join(", ") || "no previous years"} ± 1 standard deviation). A point well below the band means the crop is browner than usual.</span>
          </WhatThisMeans>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={<><Explain term="ndvi">NDVI</Explain> latest</>} value={d.latest ? d.latest.ndvi.toFixed(2) : "—"} sub={d.latest ? fmtDate(d.latest.date) : undefined} tone={d.latest && d.latest.ndvi >= 0.5 ? "good" : "neutral"} />
            <Kpi label="vs normal" value={d.latest?.anomaly != null ? `${d.latest.anomaly > 0 ? "+" : ""}${d.latest.anomaly.toFixed(2)}` : "—"} sub={d.latest?.z != null ? `z = ${d.latest.z}` : "no baseline"} tone={d.latest?.anomaly != null ? (d.latest.anomaly <= -0.1 ? "bad" : d.latest.anomaly <= -0.05 ? "warn" : "good") : "neutral"} />
            <Kpi label="Stress markers" value={d.stressCount} sub={`${d.points.length} composites`} tone={d.stressCount ? "bad" : "good"} />
            <Kpi label="Baseline years" value={d.baselineYears.length} sub={d.baselineYears.join(" · ") || "unavailable"} />
          </div>

          <Panel title={d.name ?? `${d.lat.toFixed(3)}, ${d.lon.toFixed(3)}`} subtitle="NDVI this season vs the multi-year normal" icon={Leaf} accent="emerald">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 10, right: 12, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="label" {...axisProps} minTickGap={16} />
                  <YAxis {...axisProps} domain={[yLo, 1]} ticks={yTicks} tickFormatter={(v: number) => v.toFixed(1)} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(v: unknown, name: string) => (Array.isArray(v) ? [`${Number(v[0]).toFixed(2)} – ${Number(v[1]).toFixed(2)}`, name] : [typeof v === "number" ? v.toFixed(3) : String(v), name])}
                  />
                  <Area dataKey="band" name="Normal range (±1σ)" stroke="none" fill={VIZ.s3} fillOpacity={0.18} isAnimationActive={false} connectNulls />
                  <Line dataKey="mean" name="Multi-year mean" stroke={VIZ.s3} strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line dataKey="ndvi" name="NDVI this season" stroke="#4ade80" strokeWidth={2.5} dot={{ r: 3, fill: "#4ade80", strokeWidth: 0 }} isAnimationActive={false} />
                  {stressPts.map((p) => (
                    <ReferenceDot key={p.date} x={p.label} y={p.ndvi} r={7} fill={p.possibleCloud ? "#94a3b8" : VIZ.critical} fillOpacity={0.35} stroke={p.possibleCloud ? "#cbd5e1" : "#f87171"} strokeWidth={1.5} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#4ade80]" /> This season</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed" style={{ borderColor: VIZ.s3 }} /> Multi-year mean</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm" style={{ background: `${VIZ.s3}40` }} /> Normal range</span>
              <span className="inline-flex items-center gap-1.5"><AlertTriangle size={11} className="text-rose-400" /> Stress detected</span>
              <span className="inline-flex items-center gap-1.5"><CloudFog size={11} className="text-slate-300" /> Dip that recovered (likely cloud)</span>
            </div>
          </Panel>

          <Panel title="Anomaly vs normal" subtitle="NDVI minus the multi-year mean for the same 16-day composite" accent="emerald">
            <div className="h-[170px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 6, right: 12, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="label" {...axisProps} minTickGap={16} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => v.toFixed(2)} />
                  <Tooltip {...tooltipStyle} formatter={(v: unknown) => [typeof v === "number" ? v.toFixed(3) : "—", "Anomaly"]} />
                  <ReferenceLine y={0} stroke={VIZ.axis} />
                  <ReferenceLine y={-0.1} stroke={VIZ.critical} strokeDasharray="3 3" />
                  <Bar dataKey="anomaly" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                    {chart.map((p) => (
                      <Cell key={p.date} fill={p.anomaly == null ? "#334155" : p.anomaly <= -0.1 ? VIZ.critical : p.anomaly < 0 ? VIZ.warning : "#4ade80"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SourceTag href="https://modis.ornl.gov/data/modis_webservice.html">{d.source.product}</SourceTag>
              <SourceTag>{d.source.current === "satellite-ingest cache" ? `from satellite-ingest cache${d.source.district ? ` · ${d.source.district}` : ""}` : "fetched on demand · cached"}</SourceTag>
              <SourceTag>{d.source.baseline}</SourceTag>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Stress rule: NDVI at least 0.10 below normal <em>and</em> 1.5 standard deviations low, or a fall of 20 % or more since the previous composite. Single-pixel values can be dragged down by cloud or haze; a dip that bounces back by the next composite is shown grey.
            </p>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
