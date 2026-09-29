"use client";

/** Report tabs about the long view: Climate history, Outlook (seasonal + 2050), Soil & terrain. */
import { Explain } from "@/components/help/Explain";
import type { ReportBundle } from "./types";
import { AnnualTrendChart, C, ChartFrame, LegendKey, NormalsChart, SeasonalAnomalyChart } from "./charts";
import { Bar2, Block, Computing, Metric, Sources, Table, Unavailable, fmt } from "./report-ui";

type Trend = { slopePerDecade: number; r2: number; pValue: number; significant: boolean; intercept: number };

function TrendBadge({ t, unit, d = 1 }: { t: Trend; unit: string; d?: number }) {
  return (
    <span className={`telemetry rounded-md px-1.5 py-0.5 text-[10.5px] ${t.significant ? "bg-amber-400/15 text-amber-200" : "bg-slate-700/40 text-slate-400"}`} title={`p = ${t.pValue.toFixed(3)} (Mann-Kendall), R² = ${t.r2.toFixed(2)}`}>
      {fmt.signed(t.slopePerDecade, d)} {unit}/decade {t.significant ? "· significant" : "· not significant"}
    </span>
  );
}

export function ClimateTab({ b }: { b: ReportBundle }) {
  const h = b.climate?.history ?? b.report.extras?.climate ?? null;
  if (!h) {
    if (b.climate && !b.climate.ready)
      return (
        <Computing
          label="Downloading 40 years of ERA5 reanalysis for this site…"
          detail={
            <>
              About 15 000 days of daily rain and temperature (1985 → last year). First load for a new place can take 1–3 minutes because the free data service limits heavy requests; results are cached for everyone afterwards.
              {b.climate.queue && <span className="block telemetry text-[10.5px] opacity-70">queue load {b.climate.queue.weightLastMinute}/{b.climate.queue.budget} per min</span>}
            </>
          }
        />
      );
    return <Unavailable>{b.climate?.error ? `Climate history unavailable: ${b.climate.error}` : "Climate history is not included in this snapshot."}</Unavailable>;
  }
  const t = h.trends;
  return (
    <div className="space-y-3">
      <Block title={`${h.period[0]}–${h.period[1]} at a glance`} subtitle={h.source}>
        <ul className="space-y-1.5">
          {h.headline.map((l) => (
            <li key={l} className="flex gap-2 text-[12.5px] leading-snug text-slate-300">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
              {l}
            </li>
          ))}
        </ul>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Annual rain" value={fmt.n(h.summary.meanAnnualRainMm)} unit="mm" sub={`wettest ${h.summary.wettestYear} · driest ${h.summary.driestYear}`} />
          <Metric label="Rain trend" value={fmt.signed(h.summary.rainTrendPctPerDecade, 1, "%")} unit="/decade" tone={t.rain.significant ? "#fbbf24" : undefined} sub={t.rain.significant ? "statistically significant" : "not significant"} />
          <Metric label="Hottest day (avg)" value={fmt.n(h.summary.meanHottestDayC, 1)} unit="°C" sub={`record year ${h.summary.hottestYear ?? "–"}`} />
          <Metric label="Days ≥ 35 °C" value={fmt.n(h.summary.meanHotDays, 1)} unit="/yr" />
        </div>
      </Block>

      <ChartFrame title="Annual rainfall" subtitle="Bars = each year; dashed = linear trend" height={170} legend={<TrendBadge t={t.rain} unit="mm" d={0} />}>
        <AnnualTrendChart data={h.annual} dataKey="rainMm" unit="mm" color={C.rain} trend={t.rain} />
      </ChartFrame>
      <ChartFrame title="Wettest 3 days of each year" subtitle="What drives river and flash floods" height={160} legend={<TrendBadge t={t.wettest3d} unit="mm" d={1} />}>
        <AnnualTrendChart data={h.annual} dataKey="wettest3dMm" unit="mm" color="#0ea5e9" trend={t.wettest3d} />
      </ChartFrame>
      <ChartFrame title="Hottest day of each year" height={160} legend={<TrendBadge t={t.hottestDay} unit="°C" d={2} />}>
        <AnnualTrendChart data={h.annual} dataKey="hottestDayC" unit="°C" color={C.heat} trend={t.hottestDay} />
      </ChartFrame>

      <Block title={<span className="flex items-center gap-1">Return periods — how big is a rare storm here? <Explain term="return_period" /></span>} subtitle={<>A <Explain title="Gumbel distribution" text="A standard extreme-value curve fitted to the largest rainfall of each year. It lets us estimate how big a storm that happens once every 10, 25 or 50 years would be, even from 40 years of data.">Gumbel</Explain> fit to each year&apos;s maximum. A 1-in-25-year day has a 4% chance of happening in any year.</>}>
        <Table
          head={["Return period", "Chance per year", "1-day rain", "3-day rain"]}
          rows={h.returnPeriods.map((r) => [`1-in-${r.years} years`, `${Math.round(100 / r.years)}%`, `${r.dailyRainMm} mm`, `${r.threeDayRainMm} mm`])}
        />
      </Block>

      <div className="grid gap-3 md:grid-cols-2">
        <ChartFrame title="Normal year (1991–2020)" subtitle="Average monthly rainfall" height={150}>
          <NormalsChart normals={h.normals} />
        </ChartFrame>
        <Block title="All trends" subtitle="Change per decade · Mann-Kendall significance (p < 0.05)">
          <Table
            head={["Indicator", "Trend / decade", <span key="p" className="inline-flex items-center gap-1">p-value <Explain title="p-value (Mann-Kendall test)" text="The chance that a trend this strong would appear by luck in a series with no real trend. Below 0.05 we call the trend statistically significant." /></span>]}
            rows={[
              ["Annual rain (mm)", fmt.signed(t.rain.slopePerDecade, 0), t.rain.pValue.toFixed(3)],
              ["Wettest day (mm)", fmt.signed(t.maxDaily.slopePerDecade, 1), t.maxDaily.pValue.toFixed(3)],
              ["Wettest 3 days (mm)", fmt.signed(t.wettest3d.slopePerDecade, 1), t.wettest3d.pValue.toFixed(3)],
              ["Hottest day (°C)", fmt.signed(t.hottestDay.slopePerDecade, 2), t.hottestDay.pValue.toFixed(3)],
              ["Days ≥ 35 °C", fmt.signed(t.hotDays.slopePerDecade, 1), t.hotDays.pValue.toFixed(3)],
              ["Longest dry spell (d)", fmt.signed(t.drySpell.slopePerDecade, 1), t.drySpell.pValue.toFixed(3)],
            ]}
          />
        </Block>
      </div>
      <Sources items={[{ label: "ERA5 reanalysis (Copernicus C3S)", href: "https://open-meteo.com/en/docs/historical-weather-api" }, { label: "Gumbel EV-I · Mann-Kendall" }]} />
    </div>
  );
}

export function OutlookTab({ b }: { b: ReportBundle }) {
  const seasonal = b.outlook?.seasonal ?? b.report.extras?.seasonal ?? null;
  const proj = b.outlook?.projection ?? b.report.extras?.projection ?? null;
  const applied = b.outlook?.applied ?? null;
  const computing = b.outlook && !b.outlook.ready;
  return (
    <div className="space-y-3">
      <Block title={<span className="flex items-center gap-1">Next 6 months <Explain term="seasonal_forecast" /></span>} subtitle={seasonal ? `${seasonal.model} · anomalies vs the model's own climatology` : undefined}>
        {seasonal ? (
          <>
            <p className="mb-2 text-[13px] font-medium text-slate-100">{seasonal.summary}</p>
            <ChartFrame title="Rain vs normal, by month" height={160} legend={<><LegendKey color={C.wet} label="Wetter" kind="bar" /><LegendKey color={C.dry} label="Drier" kind="bar" /></>}>
              <SeasonalAnomalyChart months={seasonal.months} />
            </ChartFrame>
            <Table
              className="mt-2"
              head={["Month", "Rain", "vs normal", "Temp", "vs normal"]}
              rows={seasonal.months.map((m) => [
                new Date(`${m.month}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
                `${Math.round(m.precipMm)} mm`,
                m.precipAnomPct == null ? fmt.signed(m.precipAnomMm, 0, " mm") : fmt.signed(m.precipAnomPct, 0, "%"),
                `${m.tempC} °C`,
                fmt.signed(m.tempAnomC, 1, " °C"),
              ])}
            />
            <p className="mt-2 text-[11px] text-slate-500">Seasonal forecasts give odds, not certainty: skill is highest in the tropics and during El Niño / La Niña years.</p>
          </>
        ) : computing ? (
          <Computing label="Loading the ECMWF seasonal forecast…" />
        ) : (
          <Unavailable>{b.outlook?.seasonalError ? `Seasonal outlook unavailable: ${b.outlook.seasonalError}` : "Seasonal outlook not available."}</Unavailable>
        )}
      </Block>

      <Block
        title={<span className="flex items-center gap-1">Around 2050 — climate projection <Explain term="climate_projection" /></span>}
        subtitle={proj ? <>{proj.scenario} <Explain term="ssp" /> · {proj.future} vs {proj.baseline}</> : undefined}
      >
        {proj ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Annual rain" value={fmt.signed(proj.ensemble.annualRainPct.mean, 0, "%")} sub={`models: ${fmt.signed(proj.ensemble.annualRainPct.min, 0)} to ${fmt.signed(proj.ensemble.annualRainPct.max, 0)}%`} />
              <Metric label="Wettest day" value={fmt.signed(proj.ensemble.rx1dayPct.mean, 0, "%")} sub={`range ${fmt.signed(proj.ensemble.rx1dayPct.min, 0)} to ${fmt.signed(proj.ensemble.rx1dayPct.max, 0)}%`} help="Change in the average annual-maximum 1-day rainfall — a proxy for flash-flood intensity." />
              <Metric label="Days ≥ 50 mm" value={fmt.signed(proj.ensemble.heavyRainDays.mean, 1)} unit="/yr" sub={`range ${fmt.signed(proj.ensemble.heavyRainDays.min, 1)} to ${fmt.signed(proj.ensemble.heavyRainDays.max, 1)}`} />
              <Metric label="Days ≥ 35 °C" value={fmt.signed(proj.ensemble.hotDays.mean, 0)} unit="/yr" tone={proj.ensemble.hotDays.mean >= 10 ? "#f87171" : undefined} sub={`range ${fmt.signed(proj.ensemble.hotDays.min, 0)} to ${fmt.signed(proj.ensemble.hotDays.max, 0)}`} />
              <Metric label="Avg daily max temp" value={fmt.signed(proj.ensemble.tmaxC.mean, 1, " °C")} sub={`range ${fmt.signed(proj.ensemble.tmaxC.min, 1)} to ${fmt.signed(proj.ensemble.tmaxC.max, 1)}`} />
              {applied && <Metric label="1-in-10-yr storm by 2050" value={applied.rp10ReturnPeriod2050 ? `1-in-${Math.max(1, Math.round(applied.rp10ReturnPeriod2050))}` : "–"} unit="yr" sub={`today's ${applied.rp10TodayMm} mm day becomes this frequent`} />}
            </div>
            {applied && (
              <p className="mt-2 rounded-lg bg-violet-400/[0.06] px-3 py-2 text-[12.5px] text-violet-100">
                Applied to this site&apos;s observed climate: about <b>{applied.projectedHotDays}</b> days ≥ 35 °C per year (from {applied.baselineHotDays}), <b>{applied.projectedRainMm.toLocaleString("en-US")} mm</b> annual rain (from {applied.baselineRainMm.toLocaleString("en-US")}), and a typical wettest day of <b>{applied.projectedRx1dayMm} mm</b> (from {applied.baselineRx1dayMm}).
              </p>
            )}
            <Table
              className="mt-3"
              head={["Model", "Rain %", "Wettest day %", "Hot days", "Tmax °C"]}
              rows={proj.models.map((m) => [m.label, fmt.signed(m.change.annualRainPct, 0), fmt.signed(m.change.rx1dayPct, 0), fmt.signed(m.change.hotDays, 0), fmt.signed(m.change.tmaxC, 1)])}
            />
            <p className="mt-2 text-[11px] leading-snug text-slate-500">{proj.caveat}</p>
          </>
        ) : computing ? (
          <Computing label="Running 5 CMIP6 climate models for this site…" detail="Two 10-year windows of daily data per model. First load for a new place can take a minute or two; cached afterwards." />
        ) : (
          <Unavailable>{b.outlook?.projectionError ? `Projection unavailable: ${b.outlook.projectionError}` : "Climate projection not included in this snapshot."}</Unavailable>
        )}
      </Block>
      <Sources items={[{ label: "ECMWF SEAS5", href: "https://open-meteo.com/en/docs/seasonal-forecast-api" }, { label: "CMIP6 HighResMIP", href: "https://open-meteo.com/en/docs/climate-api" }]} />
    </div>
  );
}

export function SoilTab({ b }: { b: ReportBundle }) {
  const x = b.report.extras ?? {};
  const soil = x.soil ?? null;
  const terr = x.terrain ?? null;
  const pendingSoil = x.pending?.includes("soil");
  return (
    <div className="space-y-3">
      <Block title="Soil (topsoil 0–30 cm)" subtitle={soil ? soil.source : "ISRIC SoilGrids 2.0 (250 m)"}>
        {soil ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Texture" value={<span className="text-[15px]">{soil.texture ?? "–"}</span>} help="USDA texture class from the sand / silt / clay mix. Controls drainage and how much water the soil holds." />
              <Metric label="pH" value={fmt.n(soil.ph, 1)} tone={soil.ph != null && (soil.ph < 5.5 || soil.ph > 8) ? "#fbbf24" : undefined} help="Soil acidity: 7 is neutral. Most crops prefer 5.5–7.5." />
              <Metric label="Organic carbon" value={fmt.n(soil.socGkg, 1)} unit="g/kg" help="Soil organic carbon (SOC): more carbon = better structure, water holding and fertility." />
              <Metric label="CEC" value={fmt.n(soil.cecCmolKg, 1)} unit="cmol/kg" help="Cation-exchange capacity: how many nutrients the soil can hold. Low (<10) = nutrients leach quickly." />
            </div>
            <div className="mt-3 space-y-1.5">
              {[
                ["Clay", soil.clayPct, "#a16207"],
                ["Silt", soil.siltPct, "#ca8a04"],
                ["Sand", soil.sandPct, "#eab308"],
              ].map(([k, v, c]) => (
                <div key={String(k)} className="flex items-center gap-2 text-[12px]">
                  <span className="w-10 text-slate-400">{k}</span>
                  <Bar2 value={Number(v ?? 0)} color={String(c)} />
                  <span className="telemetry w-12 text-right text-slate-300">{fmt.n(v as number | null, 0)}%</span>
                </div>
              ))}
            </div>
            <ul className="mt-3 space-y-1">
              {soil.notes.map((n) => (
                <li key={n} className="flex gap-2 text-[12.5px] text-slate-300">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                  {n}
                </li>
              ))}
            </ul>
          </>
        ) : pendingSoil ? (
          <Computing label="SoilGrids is responding slowly…" detail="The global soil service can take 10–30 s; reopen the report in a minute." />
        ) : (
          <Unavailable>Soil data is temporarily unavailable from ISRIC SoilGrids (the service is often overloaded) or this point is water/urban. Try again later.</Unavailable>
        )}
      </Block>
      <Block title="Terrain" subtitle="Copernicus GLO-90 DEM · 25 sample points around the site">
        {terr ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Elevation" value={fmt.n(terr.elevationM)} unit="m" term="elevation" />
              <Metric label="Local relief" value={fmt.n(terr.reliefM)} unit="m" help="Height difference within ~1 km. Very flat land (< 5 m) drains slowly." />
              <Metric label="Slope" value={fmt.n(terr.slopePct, 1)} unit="%" />
              <Metric label="Position" value={<span className="text-[14px] capitalize">{terr.position}</span>} help="Compared with the ring of points 1 km around it: a depression collects water; high ground sheds it." />
            </div>
            <ul className="mt-3 space-y-1">
              {terr.notes.map((n) => (
                <li key={n} className="flex gap-2 text-[12.5px] text-slate-300">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
                  {n}
                </li>
              ))}
              {!terr.notes.length && <li className="text-[12.5px] text-slate-400">No terrain-related amplifiers detected.</li>}
            </ul>
          </>
        ) : (
          <Unavailable>Terrain data unavailable right now.</Unavailable>
        )}
      </Block>
      <Sources items={[{ label: "ISRIC SoilGrids 2.0", href: "https://soilgrids.org" }, { label: "Copernicus GLO-90 DEM", href: "https://open-meteo.com/en/docs/elevation-api" }]} />
    </div>
  );
}
