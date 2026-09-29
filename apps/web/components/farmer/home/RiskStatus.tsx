"use client";

import { motion } from "framer-motion";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CloudRain, Cloudy, Droplets, Gauge, Satellite, ShieldAlert, Thermometer, Wind } from "lucide-react";
import { Panel, SourceTag, Skeleton, riskColor } from "@/components/hud";
import { RiskMeter } from "@/components/ui/RiskMeter";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { FarmerField, FarmerRisk, FarmerWeather } from "../hooks";

const levelOf = (v: number) => (v >= 80 ? "critical" : v >= 60 ? "high" : v >= 35 ? "medium" : "low");

export function TrendArrow({ trend, className }: { trend: "rising" | "falling" | "steady"; className?: string }) {
  const Icon = trend === "rising" ? ArrowUpRight : trend === "falling" ? ArrowDownRight : ArrowRight;
  const color = trend === "rising" ? "#f87171" : trend === "falling" ? "#4ade80" : "#94a3b8";
  return <Icon size={16} style={{ color }} className={className} aria-hidden />;
}

export function RiskStatus({ risk, loading }: { risk?: FarmerRisk; loading: boolean }) {
  const { t, tx, fmt } = useI18n();
  if (loading || !risk)
    return (
      <Panel title={t("home.riskStatus")} icon={ShieldAlert} sweep>
        <div className="grid grid-cols-2 gap-4 py-2">
          <Skeleton className="mx-auto h-[120px] w-[120px] rounded-full sm:h-[180px] sm:w-[180px]" />
          <Skeleton className="mx-auto h-[120px] w-[120px] rounded-full sm:h-[180px] sm:w-[180px]" />
        </div>
        <Skeleton className="mt-3 h-16 w-full" />
      </Panel>
    );
  const f = risk.flood;
  const s = risk.salinity;
  const probs = [
    { k: "24h", v: f.p24 },
    { k: "48h", v: f.p48 },
    { k: "72h", v: f.p72 },
  ];
  const mlLive = f.source === "ml-api";
  return (
    <Panel
      title={t("home.riskStatus")}
      icon={ShieldAlert}
      live
      sweep
      accent={f.score >= 60 ? "red" : f.score >= 35 ? "amber" : "green"}
      actions={<SourceTag>{mlLive ? `Model ${f.modelVersion}` : f.modelVersion}</SourceTag>}
    >
      <div className="grid grid-cols-2 gap-2 sm:gap-6">
        {/* Flood */}
        <div className="flex flex-col items-center">
          <div className="sm:hidden">
            <RiskMeter value={f.score} size="md" levelLabel={tx(`risk.${levelOf(f.score)}`)} />
          </div>
          <div className="hidden sm:block">
            <RiskMeter value={f.score} size="lg" levelLabel={tx(`risk.${levelOf(f.score)}`)} caption={f.depthM && f.depthM >= 0.05 ? `~${fmt.number(f.depthM, { maximumFractionDigits: 1 })} m` : undefined} />
          </div>
          <div className="mt-1 hud-label text-center">{t("home.floodRisk72h")}</div>
          <div className="mt-2 grid w-full max-w-[220px] grid-cols-3 gap-1.5">
            {probs.map((p) => (
              <div key={p.k} className="rounded-md bg-slate-900/70 px-1.5 py-1 text-center">
                <div className="text-[9px] telemetry text-slate-500">{p.k}</div>
                <div className="telemetry text-sm font-semibold" style={{ color: riskColor(p.v * 100) }}>
                  {Math.round(p.v * 100)}%
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Salinity */}
        <div className="flex flex-col items-center">
          <div className="sm:hidden">
            <RiskMeter value={s.score} size="md" levelLabel={tx(`risk.${levelOf(s.score)}`)} />
          </div>
          <div className="hidden sm:block">
            <RiskMeter value={s.score} size="lg" levelLabel={tx(`risk.${levelOf(s.score)}`)} caption={`EC ${fmt.number(s.ecCurrent, { maximumFractionDigits: 1 })} dS/m`} />
          </div>
          <div className="mt-1 hud-label text-center">{t("home.salinityRisk")}</div>
          <div className="mt-2 w-full max-w-[220px] rounded-md bg-slate-900/70 px-2 py-1.5">
            <div className="flex items-center justify-between text-[10px] telemetry text-slate-500">
              <span>{t("home.soilEc")}</span>
              <span className="inline-flex items-center gap-1">
                {tx(`home.${s.trend}`)} <TrendArrow trend={s.trend} className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between telemetry">
              <span className="text-sm font-semibold text-white">{fmt.number(s.ecCurrent, { maximumFractionDigits: 1 })}</span>
              <span className="text-[10px] text-slate-500">→ 30d</span>
              <span className="text-sm font-semibold" style={{ color: s.ec30d > s.ecThreshold ? "#f87171" : "#4ade80" }}>
                {fmt.number(s.ec30d, { maximumFractionDigits: 1 })}
              </span>
            </div>
            <div className="relative mt-1 h-1.5 rounded-full bg-slate-800">
              <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: s.ecCurrent > s.ecThreshold ? "#f87171" : "#fbbf24" }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, (s.ecCurrent / (s.ecThreshold * 2)) * 100)}%` }} transition={{ duration: 1 }} />
              <span className="absolute -top-0.5 h-2.5 w-px bg-white/70" style={{ left: "50%" }} title={`${tx(`crops.${s.crop}`)} ${s.ecThreshold} dS/m`} />
            </div>
            <div className="mt-0.5 text-right text-[9px] telemetry text-slate-500">
              {tx(`crops.${s.crop}`)} ≤ {s.ecThreshold} dS/m
            </div>
          </div>
        </div>
      </div>

      <div className="hud-divider my-4" />
      <div>
        <div className="hud-label mb-2">{t("home.why")}</div>
        <div className="flex flex-wrap gap-1.5">
          {f.factors.map((k) => (
            <span key={k} className="rounded-md border border-slate-700/70 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-300">
              {tx(`risk.factors.${k}`, undefined, k.replace(/_/g, " "))}
            </span>
          ))}
          {f.historyMultiplier > 1 && <span className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-300">{t("risk.historyFactor", { mult: f.historyMultiplier })}</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <SourceTag>{f.source === "ml-api" ? "Agri-SHIELD ML API" : f.source === "web-fallback" ? "Open-Meteo + GloFAS formula" : "District overlay"}</SourceTag>
          <SourceTag>Salinity {s.modelVersion}</SourceTag>
          {risk.scenario !== "live" && <SourceTag>Scenario: {risk.scenario.replace(/_/g, " ")}</SourceTag>}
          <SourceTag>{t("common.updated", { time: fmt.time(risk.updatedAt) })}</SourceTag>
        </div>
      </div>
    </Panel>
  );
}

export function WeatherToday({ weather, loading }: { weather?: FarmerWeather; loading: boolean }) {
  const { t, fmt } = useI18n();
  if (loading) return <Panel title={t("home.weatherToday")} icon={CloudRain}><Skeleton className="h-24 w-full" /></Panel>;
  const c = weather?.current;
  if (!c) return <Panel title={t("home.weatherToday")} icon={CloudRain}><p className="text-sm text-slate-500">{t("common.errorLoad")}</p></Panel>;
  const tiles = [
    { icon: Thermometer, label: t("home.temperature"), value: `${fmt.number(c.tempC, { maximumFractionDigits: 1 })}°C`, sub: weather?.today?.tMax != null ? `${Math.round(weather.today.tMin ?? 0)}–${Math.round(weather.today.tMax)}°` : null },
    { icon: Droplets, label: t("home.humidity"), value: `${fmt.number(c.humidity)}%`, sub: null },
    { icon: CloudRain, label: t("home.rainfall"), value: `${fmt.number(weather?.today?.precipMm ?? c.precipMm, { maximumFractionDigits: 1 })} mm`, sub: weather?.today ? `${weather.today.precipProb}%` : null },
    { icon: Wind, label: t("home.wind"), value: `${fmt.number(c.windKmh, { maximumFractionDigits: 0 })} km/h`, sub: null },
  ];
  return (
    <Panel title={t("home.weatherToday")} subtitle={c.label} icon={Cloudy} accent="cyan" actions={<SourceTag href="https://open-meteo.com">Open-Meteo</SourceTag>}>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(({ icon: Icon, label, value, sub }) => (
          <div key={label} className="rounded-lg bg-slate-900/60 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <Icon size={12} className="text-cyan-400" /> {label}
            </div>
            <div className="mt-1 telemetry text-lg font-semibold text-white">{value}</div>
            {sub && <div className="telemetry text-[10px] text-slate-500">{sub}</div>}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] telemetry text-slate-500">
        <span>
          {t("home.cloudCover")} {c.cloudCover}%
        </span>
        <span>{fmt.time(c.time)}</span>
      </div>
    </Panel>
  );
}

export function SatelliteCard({ fields, loading }: { fields?: FarmerField[]; loading: boolean }) {
  const { t, tx, fmt } = useI18n();
  if (loading || !fields) return <Panel title={t("home.satelliteScan")} icon={Satellite}><Skeleton className="h-24 w-full" /></Panel>;
  const area = fields.reduce((a, f) => a + f.areaHa, 0) || 1;
  const ndvi = fields.reduce((a, f) => a + f.ndvi * f.areaHa, 0) / area;
  const last = fields.reduce<Date | null>((b, f) => (!b || new Date(f.lastSatelliteScan) > b ? new Date(f.lastSatelliteScan) : b), null);
  const health = ndvi >= 0.65 ? "Excellent" : ndvi >= 0.5 ? "Good" : ndvi >= 0.35 ? "Moderate" : "Stressed";
  const color = ndvi >= 0.5 ? "#4ade80" : ndvi >= 0.35 ? "#fbbf24" : "#f87171";
  return (
    <Panel title={t("home.satelliteScan")} subtitle={last ? fmt.relative(last) : undefined} icon={Satellite} accent="violet" actions={<SourceTag>Sentinel-2 / MODIS</SourceTag>}>
      <div className="flex items-end justify-between">
        <div>
          <div className="hud-label">{t("home.ndviHealth")}</div>
          <div className="telemetry text-3xl font-semibold" style={{ color }}>
            {fmt.number(ndvi, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs" style={{ color }}>
            {tx(`fields.health${health}`)}
          </div>
        </div>
        <Gauge size={34} className="text-slate-700" />
      </div>
      {/* NDVI scale */}
      <div className="relative mt-3 h-2 rounded-full" style={{ background: "linear-gradient(90deg,#a16207,#eab308,#84cc16,#16a34a,#14532d)" }}>
        <motion.span className="absolute -top-1 h-4 w-1 rounded bg-white shadow" initial={{ left: 0 }} animate={{ left: `${Math.max(0, Math.min(1, ndvi)) * 100}%` }} transition={{ duration: 1.1 }} />
      </div>
      <div className="mt-1 flex justify-between text-[9px] telemetry text-slate-600">
        <span>0.0</span>
        <span>0.5</span>
        <span>1.0</span>
      </div>
      {last && <div className="mt-2 text-[10px] telemetry text-slate-500">{fmt.dateTime(last)}</div>}
    </Panel>
  );
}
