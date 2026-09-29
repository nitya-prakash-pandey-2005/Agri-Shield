"use client";

/**
 * Report tabs about the present and near future: Overview, Forecast, Flood,
 * Salinity, Drought & Heat. Pure presentation over a ReportBundle.
 */
import { AlertTriangle, ArrowRight, CalendarClock, Clock, Droplets, Flame, MapPin, Mountain, Sun, Waves } from "lucide-react";
import { CROP_EC_THRESHOLDS, type CropType } from "@agri-shield/types";
import { Meter, RiskPill, riskColor } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { heatIndexC } from "@/server/live/climate-math";
import { cn } from "@/lib/utils";
import { buildInsights, type Urgency } from "./insights";
import { CROP_OPTIONS, cropLabel, type ReportBundle } from "./types";
import { C, ChartFrame, DailyForecastChart, EnsembleFanChart, Gauge, HeatDaysChart, HourlyRainChart, HourlyTempChart, LegendKey, RiverChart } from "./charts";
import { Bar2, Block, Computing, Metric, Sources, Table, Unavailable, fmt } from "./report-ui";
import type { OverlayKey } from "./ExplorerMap";

const URGENCY_STYLE: Record<Urgency, string> = {
  now: "bg-rose-500/15 text-rose-300 border-rose-400/30",
  "this week": "bg-amber-500/15 text-amber-200 border-amber-400/30",
  "this season": "bg-sky-500/15 text-sky-200 border-sky-400/30",
  "long term": "bg-violet-500/15 text-violet-200 border-violet-400/30",
};

const HAZARD_ICON = { flood: Waves, salinity: Droplets, drought: Sun, heat: Flame, climate: CalendarClock, general: ArrowRight } as const;

export function OverviewTab({ b, limitedActions }: { b: ReportBundle; limitedActions?: boolean }) {
  const r = b.report;
  const x = r.extras ?? {};
  const ins = buildInsights(b, b.assetType, b.crop);
  const hz = r.hazards;
  const cards = [
    { key: "flood", label: "Flood", icon: Waves, score: hz.flood.score, line: `${fmt.pct(hz.flood.p72)} chance in 72 h`, term: "flood_probability" },
    { key: "salinity", label: "Salinity", icon: Droplets, score: hz.salinity.score, line: hz.salinity.applicable ? `${hz.salinity.ec30d.toFixed(1)} dS/m in 30 days` : "Not applicable here", term: "salinity" },
    { key: "drought", label: "Drought", icon: Sun, score: hz.drought.score, line: hz.drought.spi90 != null ? `SPI-90 ${hz.drought.spi90.toFixed(1)}` : `${fmt.signed(hz.drought.waterBalance7dMm, 0, " mm")} water balance (7 d)`, term: "drought" },
    { key: "heat", label: "Heat", icon: Flame, score: hz.heat.score, line: hz.heat.heatIndexMaxC != null ? `Feels like ${Math.round(hz.heat.heatIndexMaxC)} °C` : `Max ${fmt.n(hz.heat.maxTempC)} °C`, term: "heat_stress" },
  ];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 pt-2 pb-3">
          <Gauge score={r.composite.score} />
          <div className="-mt-1 flex items-center gap-1.5">
            <RiskPill level={r.composite.level} />
            <Explain term="composite_score" />
          </div>
        </div>
        <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-3.5">
          <div className="hud-label text-emerald-300/80">What this means</div>
          <p className="mt-1 font-display text-[15px] font-semibold leading-snug text-white">{ins.headline}</p>
          <ul className="mt-2 space-y-1.5">
            {ins.meaning.slice(0, 6).map((m) => (
              <li key={m} className="flex gap-2 text-[12.5px] leading-snug text-slate-300">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                {m}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.key} className="rounded-xl border border-white/[0.06] bg-slate-950/40 p-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400">
                <c.icon size={12} style={{ color: riskColor(c.score) }} /> {c.label}
                <Explain term={c.term} />
              </span>
              <span className="telemetry text-sm font-semibold" style={{ color: riskColor(c.score) }}>
                {c.score}
              </span>
            </div>
            <Meter value={c.score} className="mt-1.5" />
            <div className="mt-1.5 truncate text-[11px] text-slate-400" title={c.line}>
              {c.line}
            </div>
          </div>
        ))}
      </div>

      {!limitedActions && (
        <Block title="Recommended actions" subtitle={`Tailored to: ${b.assetType.replace("_", " ")}${["farm", "field", "insured_plot", "loan"].includes(b.assetType) ? ` · ${cropLabel(b.crop).toLowerCase()}` : ""}`}>
          <ol className="space-y-2">
            {ins.actions.map((a) => {
              const Icon = HAZARD_ICON[a.hazard];
              return (
                <li key={a.title} className="flex gap-2.5">
                  <span className={cn("mt-0.5 h-fit shrink-0 rounded-md border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider", URGENCY_STYLE[a.urgency])}>{a.urgency}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-100">
                      <Icon size={13} className="text-slate-400" />
                      {a.title}
                    </div>
                    <p className="text-[12px] leading-snug text-slate-400">{a.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Block>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Block title="Top drivers" subtitle="Why the score is what it is">
          <ul className="space-y-1.5">
            {r.composite.drivers.map((d) => (
              <li key={d} className="flex gap-2 text-[12.5px] text-slate-300">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
                {d}
              </li>
            ))}
          </ul>
        </Block>
        <Block title="Site facts">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
            <dt className="text-slate-500">Coordinates</dt>
            <dd className="telemetry text-right text-slate-300">{r.location.lat.toFixed(4)}, {r.location.lon.toFixed(4)}</dd>
            <dt className="text-slate-500">Region</dt>
            <dd className="truncate text-right text-slate-300">{[r.location.admin1, r.location.country].filter(Boolean).join(", ") || "–"}</dd>
            <dt className="flex items-center gap-1 text-slate-500">Elevation <Explain term="elevation" /></dt>
            <dd className="telemetry text-right text-slate-300">{fmt.n(r.location.elevationM)} m</dd>
            <dt className="text-slate-500">Coast</dt>
            <dd className="text-right text-slate-300">{x.terrain ? (x.terrain.coastKm ? `within ~${x.terrain.coastKm} km` : "> 60 km away") : "–"}</dd>
            <dt className="text-slate-500">Terrain</dt>
            <dd className="text-right capitalize text-slate-300">{x.terrain?.position ?? "–"}</dd>
            <dt className="text-slate-500">Model coverage</dt>
            <dd className="text-right text-slate-300">{r.location.inCoreCoverage ? "Calibrated district" : "Global model"}</dd>
          </dl>
        </Block>
      </div>

      {r.hazardsNearby.length > 0 && (
        <Block title="Active hazards nearby" subtitle="GDACS & NASA EONET events within 800 km">
          <ul className="space-y-1">
            {r.hazardsNearby.slice(0, 5).map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="flex min-w-0 items-center gap-1.5 text-slate-300">
                  <MapPin size={12} className="shrink-0 text-orange-400" />
                  <span className="truncate">{h.title}</span>
                </span>
                <span className="telemetry shrink-0 text-slate-500">{h.distanceKm} km</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
      <Sources items={r.sources.filter((s) => s.ok).slice(0, 8).map((s) => ({ label: s.name, href: s.url.startsWith("http") ? s.url : undefined }))} />
    </div>
  );
}

export function ForecastTab({ b }: { b: ReportBundle }) {
  const r = b.report;
  const ens = r.extras?.ensemble ?? null;
  const hourly = r.forecast.hourly.map((h) => ({ ...h, heatIndexC: h.tempC != null && h.humidity != null ? Math.round(heatIndexC(h.tempC, h.humidity) * 10) / 10 : null }));
  const rain24 = hourly.slice(0, 24).reduce((s, h) => s + h.precipMm, 0);
  const rain72 = hourly.reduce((s, h) => s + h.precipMm, 0);
  const tMax = Math.max(...hourly.map((h) => h.tempC ?? -99));
  const hiMax = Math.max(...hourly.map((h) => h.heatIndexC ?? -99));
  const wind = Math.max(...hourly.map((h) => h.windKmh ?? 0));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Rain next 24 h" value={fmt.n(rain24, 1)} unit="mm" />
        <Metric label="Rain next 72 h" value={fmt.n(rain72, 1)} unit="mm" />
        <Metric label="Max temperature" value={tMax > -99 ? fmt.n(tMax, 1) : "–"} unit="°C" sub={hiMax > -99 ? `feels like ${Math.round(hiMax)} °C` : undefined} help="'Feels like' is the NOAA heat index: how hot it feels once humidity is taken into account." />
        <Metric label="Max wind" value={fmt.n(wind, 0)} unit="km/h" />
      </div>
      <ChartFrame title="Next 72 hours — rain" subtitle="Hourly rainfall (mm/h), Open-Meteo best-match forecast" height={150}>
        <HourlyRainChart hourly={hourly} />
      </ChartFrame>
      <ChartFrame title="Next 72 hours — temperature" subtitle="Air temperature and heat index (°C)" height={150} legend={<><LegendKey color={C.temp} label="Air temp" /><LegendKey color={C.heat} label="Feels like" kind="dash" /></>}>
        <HourlyTempChart hourly={hourly} />
      </ChartFrame>
      {ens ? (
        <>
          <ChartFrame
            title={<span className="flex items-center gap-1">Next {ens.days.length} days — ensemble rain outlook <Explain term="ensemble" /></span>}
            subtitle={`${ens.model}: the band holds 80% of the ${ens.members} forecast runs — a wide band means an uncertain forecast.`}
            height={180}
            legend={<><LegendKey color={C.rain} label="Median" /><LegendKey color={C.rainSoft} label="10–90% range" kind="band" /></>}
          >
            <EnsembleFanChart days={ens.days} />
          </ChartFrame>
          <Block title="Rain totals with uncertainty" subtitle="Summed per forecast run, then ranked (p10 = dry case, p90 = wet case)">
            <Table
              head={["Window", "Dry case (p10)", "Likely (p50)", "Wet case (p90)"]}
              rows={[
                ["Next 3 days", ...[ens.totals.days3.p10, ens.totals.days3.p50, ens.totals.days3.p90].map((v) => `${fmt.n(v, 0)} mm`)],
                ["Next 7 days", ...[ens.totals.days7.p10, ens.totals.days7.p50, ens.totals.days7.p90].map((v) => `${fmt.n(v, 0)} mm`)],
                [`Next ${ens.days.length} days`, ...[ens.totals.days14.p10, ens.totals.days14.p50, ens.totals.days14.p90].map((v) => `${fmt.n(v, 0)} mm`)],
              ]}
            />
            <p className="mt-2 text-[11.5px] text-slate-400">
              Chance that some 3-day window gets more than 100 mm: <span className="telemetry text-slate-200">{fmt.pct(ens.prob3dOver100mm)}</span>
            </p>
          </Block>
        </>
      ) : (
        <Unavailable>Ensemble spread unavailable right now — the deterministic forecast above still applies.</Unavailable>
      )}
      <ChartFrame title="Daily rain vs evaporation" subtitle="When evaporation (ET₀) stays above rain, soils dry out" height={160} legend={<><LegendKey color={C.rain} label="Rain" kind="bar" /><LegendKey color={C.dry} label="ET₀" /></>}>
        <DailyForecastChart daily={r.forecast.daily} />
      </ChartFrame>
      <Sources items={[{ label: "Open-Meteo forecast", href: "https://open-meteo.com" }, { label: "ECMWF IFS ensemble", href: "https://open-meteo.com/en/docs/ensemble-api" }]} />
    </div>
  );
}

export function FloodTab({ b, onOverlay }: { b: ReportBundle; onOverlay?: (k: OverlayKey) => void }) {
  const r = b.report;
  const f = r.hazards.flood;
  const x = r.extras ?? {};
  const rh = x.riverHistory ?? null;
  const rar = x.forecastRarity ?? null;
  const pending = x.pending?.includes("river");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          ["24 h", f.p24],
          ["48 h", f.p48],
          ["72 h", f.p72],
        ].map(([k, p]) => (
          <div key={String(k)} className="rounded-xl border border-white/[0.06] bg-slate-950/40 p-3 text-center">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-500">Within {k}</div>
            <div className="telemetry text-2xl font-semibold" style={{ color: riskColor(Number(p) * 100) }}>
              {fmt.pct(Number(p))}
            </div>
            <div className="text-[10.5px] text-slate-500">flood chance</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Likely depth if flooded" value={fmt.n(f.depthM, 2)} unit="m" help="Model estimate of standing-water depth in the most likely flood scenario over the next 72 hours." />
        <Metric label="Confidence range" value={`${fmt.pct(f.ci[0])}–${fmt.pct(f.ci[1])}`} term="confidence" />
        <Metric
          label="Forecast rain rarity"
          value={rar ? (Math.max(rar.threeDayReturnPeriodYears ?? 0, rar.dailyReturnPeriodYears ?? 0) >= 2 ? `1-in-${Math.round(Math.max(rar.threeDayReturnPeriodYears ?? 0, rar.dailyReturnPeriodYears ?? 0))} yr` : "Not unusual") : "–"}
          term="return_period"
          sub={rar ? `wettest day ${fmt.n(rar.maxDailyMm, 0)} mm, 3 days ${fmt.n(rar.max3dMm, 0)} mm` : "needs the site's 40-yr record (Climate tab)"}
        />
      </div>
      {f.factors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {f.factors.map((k) => (
            <span key={k} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-slate-300">
              {k.replace(/_/g, " ")}
            </span>
          ))}
          <span className="text-[11px] text-slate-500">· model {f.model}</span>
        </div>
      )}

      {r.river ? (
        <>
          <ChartFrame
            title={<span className="flex items-center gap-1">River discharge — last 30 days + 7-day forecast <Explain term="river_discharge" /></span>}
            subtitle={
              r.river.cell?.snapped
                ? `GloFAS cell on the main channel ${r.river.cell.distanceKm} km from the site. Grey band = normal range for each date (${rh ? `${rh.period[0]}–${rh.period[1]}` : "record"}).`
                : `GloFAS v4 at the site. Grey band = normal range for each date${rh ? ` (${rh.period[0]}–${rh.period[1]})` : ""}.`
            }
            height={200}
            legend={<><LegendKey color={C.river} label="Discharge" /><LegendKey color={C.median} label="Normal (median)" kind="dash" /><LegendKey color={C.band} label="Usual range" kind="band" /></>}
          >
            <RiverChart series={r.river.series} returnLevels={rh?.returnLevels} />
          </ChartFrame>
          {rh ? (
            <Block title="How unusual is the river right now?" subtitle={rh.summary}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Flow now" value={fmt.n(rh.current?.valueM3s, 0)} unit="m³/s" />
                <Metric label="For the season" value={rh.current ? `${rh.current.percentileSeason}th` : "–"} unit="pct" help="Percentile vs the same ±15 days of every year in the record: 90th = higher than on 90% of those days." />
                <Metric label="Forecast peak" value={fmt.n(rh.forecastPeak?.valueM3s, 0)} unit="m³/s" sub={rh.forecastPeak?.returnPeriodYears ? `≈ 1-in-${Math.max(1, Math.round(rh.forecastPeak.returnPeriodYears))}-yr flow` : undefined} />
                <Metric label="Record high" value={fmt.n(rh.recordMax?.valueM3s, 0)} unit="m³/s" sub={rh.recordMax ? fmt.date(rh.recordMax.date) : undefined} />
              </div>
              {rh.returnLevels.length > 0 && (
                <Table className="mt-3" head={[<span key="h" className="flex items-center gap-1">Return period <Explain term="return_period" /></span>, "Peak flow (m³/s)"]} rows={rh.returnLevels.map((l) => [`1-in-${l.years} years`, fmt.n(l.dischargeM3s)])} />
              )}
            </Block>
          ) : pending ? (
            <Computing label="Loading the river's multi-year GloFAS record…" detail="Used to judge whether today's flow is unusual. This can take up to a minute the first time for a new place." />
          ) : (
            <Unavailable>The river's historical record could not be loaded right now; the forecast above still applies.</Unavailable>
          )}
        </>
      ) : (
        <Unavailable>No river-discharge data for this point (GloFAS covers rivers on a ~5 km grid).</Unavailable>
      )}
      <Block title="Observed flooding from space" subtitle="Check current satellite-detected flood water around the site">
        <div className="flex flex-wrap gap-2">
          {onOverlay ? (
            <>
              <button onClick={() => onOverlay("flood")} className="rounded-lg border border-cyan-400/30 px-2.5 py-1.5 text-[12px] text-cyan-200 hover:bg-cyan-400/10">Show NASA observed flood (2-day)</button>
              <button onClick={() => onOverlay("water")} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-slate-300 hover:bg-white/5">Show 37-year water history</button>
              <button onClick={() => onOverlay("radar")} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-slate-300 hover:bg-white/5">Show live radar</button>
            </>
          ) : (
            <span className="text-[12px] text-slate-500">Open the live explorer to overlay NASA observed-flood and JRC water-history layers.</span>
          )}
        </div>
      </Block>
      <Sources items={[{ label: "Agri-SHIELD flood model" }, { label: "GloFAS v4 (Copernicus EMS)", href: "https://open-meteo.com/en/docs/flood-api" }, { label: "NASA GIBS MODIS flood", href: "https://earthdata.nasa.gov/gibs" }]} />
    </div>
  );
}

export function SalinityTab({ b }: { b: ReportBundle }) {
  const s = b.report.hazards.salinity;
  const t = CROP_EC_THRESHOLDS[b.crop as CropType] ?? CROP_EC_THRESHOLDS.rice;
  if (!s.applicable)
    return (
      <div className="space-y-3">
        <Unavailable>
          <div className="font-medium text-slate-200">Saltwater intrusion is not a hazard here.</div>
          <div className="mt-1">{s.reason ?? "The site is outside known saline-intrusion zones."} Soil salinity from irrigation can still occur in dry climates — test soil EC if yields fall.</div>
        </Unavailable>
        <Sources items={[{ label: "Copernicus DEM (coast & elevation)" }, { label: "Agri-SHIELD salinity model" }]} />
      </div>
    );
  const color = (ec: number) => (ec >= t.moderate ? "#f87171" : ec >= t.sensitive ? "#fbbf24" : "#4ade80");
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-400">{s.reason}. Salinity is measured as <Explain term="ec">electrical conductivity (EC)</Explain> in <Explain term="ds_m">dS/m</Explain>.</p>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="EC now" value={s.ecNow.toFixed(1)} unit="dS/m" tone={color(s.ecNow)} />
        <Metric label="In 7 days" value={s.ec7d.toFixed(1)} unit="dS/m" tone={color(s.ec7d)} />
        <Metric label="In 30 days" value={s.ec30d.toFixed(1)} unit="dS/m" tone={color(s.ec30d)} sub={s.class} />
      </div>
      <Block title={`What it means for ${cropLabel(b.crop).toLowerCase()}`} subtitle={`${cropLabel(b.crop)} starts losing yield above ${t.sensitive} dS/m; severe losses above ${t.moderate} dS/m.`}>
        <div className="relative mt-1 h-3 w-full overflow-hidden rounded-full" style={{ background: `linear-gradient(90deg, #22c55e 0%, #22c55e ${(t.sensitive / 12) * 100}%, #f59e0b ${(t.sensitive / 12) * 100}%, #f59e0b ${(t.moderate / 12) * 100}%, #ef4444 ${(t.moderate / 12) * 100}%)`, opacity: 0.75 }}>
          <div className="absolute top-0 h-full w-1 rounded bg-white shadow" style={{ left: `${Math.min(99, (s.ec30d / 12) * 100)}%` }} />
        </div>
        <div className="mt-1 flex justify-between telemetry text-[10px] text-slate-500">
          <span>0</span>
          <span>{t.sensitive}</span>
          <span>{t.moderate}</span>
          <span>12 dS/m</span>
        </div>
        <p className="mt-2 text-[12.5px] text-slate-300">
          Chance of crop damage within 30 days: <span className="telemetry font-semibold text-white">{fmt.pct(s.cropDamageProb)}</span>
        </p>
      </Block>
      <Block title="Which crops tolerate the 30-day level?" subtitle="FAO salt-tolerance thresholds (Maas–Hoffman)">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {CROP_OPTIONS.map((c) => {
            const th = CROP_EC_THRESHOLDS[c.value];
            const ok = s.ec30d < th.sensitive;
            const mid = !ok && s.ec30d < th.moderate;
            return (
              <div key={c.value} className="flex items-center gap-2 text-[12px]">
                <span className="w-20 text-slate-300">{c.label}</span>
                <Bar2 value={th.moderate} max={18} color={ok ? "#4ade80" : mid ? "#fbbf24" : "#f87171"} />
                <span className={cn("w-16 text-right text-[11px]", ok ? "text-emerald-300" : mid ? "text-amber-300" : "text-rose-300")}>{ok ? "safe" : mid ? "yield loss" : "severe"}</span>
              </div>
            );
          })}
        </div>
      </Block>
      <Sources items={[{ label: `Model ${s.model}` }, { label: "Copernicus DEM (coast & elevation)" }, { label: "FAO crop salt tolerance" }]} />
    </div>
  );
}

export function DroughtHeatTab({ b }: { b: ReportBundle }) {
  const r = b.report;
  const d = b.climate?.drought ?? r.extras?.drought ?? null;
  const hs = r.extras?.heatStress ?? null;
  const computing = b.climate && !b.climate.ready;
  const spiColor = (v: number | null) => (v == null ? "#94a3b8" : v <= -1.5 ? "#f87171" : v <= -1 ? "#fbbf24" : v >= 1 ? "#38bdf8" : "#4ade80");
  return (
    <div className="space-y-3">
      <Block title={<span className="flex items-center gap-1">Drought — how dry has it been? <Explain term="spi" /></span>} subtitle="SPI compares recent rain with the same weeks in each of the last 40 years (0 = normal, below −1 = drought)">
        {d ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="SPI-30" value={d.spi30 == null ? "–" : d.spi30.toFixed(2)} tone={spiColor(d.spi30)} sub={d.category30} />
            <Metric label="SPI-90" value={d.spi90 == null ? "–" : d.spi90.toFixed(2)} tone={spiColor(d.spi90)} sub={d.category90} />
            <Metric label="Rain, last 30 d" value={fmt.n(d.rain30Mm)} unit="mm" sub={`normal ${d.normal30Mm} mm (${d.pctOfNormal30 ?? "–"}%)`} />
            <Metric label="Rain, last 90 d" value={fmt.n(d.rain90Mm)} unit="mm" sub={`normal ${d.normal90Mm} mm (${d.pctOfNormal90 ?? "–"}%)`} />
          </div>
        ) : computing ? (
          <Computing label="Computing the drought index from 40 years of ERA5 data…" detail="The first time for a new place this downloads ~15 000 days of reanalysis; it is cached afterwards." />
        ) : (
          <Unavailable>{b.climate?.error ? `Drought index unavailable: ${b.climate.error}` : "Open this tab to compute the drought index."}</Unavailable>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Metric label="Rain next 7 d" value={fmt.n(r.hazards.drought.rain7dForecastMm, 0)} unit="mm" />
          <Metric label="Evaporation 7 d" value={fmt.n(r.hazards.drought.et0_7dMm, 0)} unit="mm" help="Reference evapotranspiration (FAO-56 ET₀): water a well-watered grass crop would use." />
          <Metric label="Water balance" value={fmt.signed(r.hazards.drought.waterBalance7dMm, 0)} unit="mm" tone={r.hazards.drought.waterBalance7dMm < -15 ? "#fbbf24" : undefined} />
        </div>
      </Block>
      <Block title={<span className="flex items-center gap-1">Heat stress this week <Explain term="heat_stress" /></span>} subtitle="Heat index = how hot it feels with humidity; wet-bulb = whether sweat can still cool the body">
        {hs ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Max heat index" value={fmt.n(hs.heatIndexMaxC, 1)} unit="°C" tone={hs.heatIndexMaxC >= 41 ? "#f87171" : hs.heatIndexMaxC >= 32 ? "#fbbf24" : undefined} sub={hs.category} help="NOAA heat index. 27–32 °C caution, 32–41 extreme caution, 41–54 danger, above 54 extreme danger." />
              <Metric label="Max wet-bulb" value={fmt.n(hs.wetBulbMaxC, 1)} unit="°C" tone={hs.wetBulbMaxC >= 28 ? "#f87171" : undefined} help="Wet-bulb temperature (Stull 2011). Above ~28 °C heavy outdoor work becomes dangerous; 31 °C+ is life-threatening even at rest in shade for long periods." />
              <Metric label="Danger hours" value={hs.dangerHours} unit="h" sub="heat index ≥ 41 °C" />
              <Metric label="Hottest day" value={fmt.n(r.hazards.heat.maxTempC, 1)} unit="°C" sub={`${r.hazards.heat.hotDays} day(s) ≥ 35 °C`} />
            </div>
            <p className="mt-2 rounded-lg bg-amber-400/[0.06] px-3 py-2 text-[12.5px] text-amber-100">{hs.labourAdvice}</p>
            <div className="mt-2">
              <ChartFrame title="Daily maxima" height={170} legend={<><LegendKey color={C.temp} label="Air" /><LegendKey color={C.heat} label="Heat index" /><LegendKey color="#a78bfa" label="Wet-bulb" kind="dash" /></>}>
                <HeatDaysChart days={hs.days} />
              </ChartFrame>
            </div>
          </>
        ) : (
          <Unavailable>Heat-stress data unavailable (forecast humidity missing).</Unavailable>
        )}
      </Block>
      <Sources items={[{ label: "ERA5 (SPI reference)", href: "https://open-meteo.com/en/docs/historical-weather-api" }, { label: "Open-Meteo forecast" }, { label: "NOAA heat index · Stull wet-bulb" }]} />
    </div>
  );
}

export function LockedTab({ title, onCta }: { title: string; onCta: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-400/25 bg-emerald-400/[0.03] px-6 py-10 text-center">
      <Mountain size={26} className="text-emerald-400/70" />
      <div className="mt-2 font-display text-[15px] font-semibold text-white">{title} is in the full report</div>
      <p className="mt-1 max-w-sm text-[12.5px] text-slate-400">Create a free workspace to unlock river records, salinity forecasts, 40-year climate trends, 2050 projections, soil data, PDF due-diligence reports and portfolio alerts.</p>
      <button onClick={onCta} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
        Get the full report <ArrowRight size={14} />
      </button>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500"><Clock size={11} /> Takes 30 seconds · no card required</p>
    </div>
  );
}
