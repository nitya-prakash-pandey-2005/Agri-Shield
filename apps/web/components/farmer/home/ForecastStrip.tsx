"use client";

/**
 * Next-72h strip (spec §4.4): hour-by-hour rain-probability bars with the
 * model's flood-probability curve on the same 0–100 % axis, selective mm
 * labels, day separators, and a per-hour hover/tap readout. Beneath it: GloFAS
 * river discharge trend and the salinity trend arrow.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CloudRain, Waves, Droplets } from "lucide-react";
import { Panel, SourceTag, Skeleton } from "@/components/hud";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { FarmerRisk, FarmerWeather } from "../hooks";
import { TrendArrow } from "./RiskStatus";

const COL = 16; // px per hour
const H = 112;

const rainShade = (p: number) => (p >= 80 ? "#38bdf8" : p >= 60 ? "#0ea5e9" : p >= 40 ? "#0284c7" : p >= 20 ? "#075985" : "#1e3a5f");

export function ForecastStrip({ weather, risk, loading }: { weather?: FarmerWeather; risk?: FarmerRisk; loading: boolean }) {
  const { t, fmt } = useI18n();
  const [sel, setSel] = useState<number | null>(null);
  const hours = weather?.hourly ?? [];
  const floodByTime = useMemo(() => new Map((risk?.hourly ?? []).map((h) => [h.time.slice(0, 13), h.probability])), [risk?.hourly]);

  if (loading) return <Panel title={t("home.forecast72")} icon={CloudRain}><Skeleton className="h-36 w-full" /></Panel>;
  if (!hours.length) return <Panel title={t("home.forecast72")} icon={CloudRain}><p className="text-sm text-slate-500">{t("common.errorLoad")}</p></Panel>;

  const width = hours.length * COL;
  const floodPts = hours
    .map((h, k) => {
      const p = floodByTime.get(h.time.slice(0, 13));
      return p == null ? null : `${k * COL + COL / 2},${H - p * H}`;
    })
    .filter(Boolean)
    .join(" ");
  const cur = sel != null ? hours[sel] : null;
  const curFlood = cur ? floodByTime.get(cur.time.slice(0, 13)) : null;
  const d = weather!.discharge;
  const sal = risk?.salinity;

  return (
    <Panel
      title={t("home.forecast72")}
      subtitle={t("home.forecast72Hint")}
      icon={CloudRain}
      accent="cyan"
      actions={<SourceTag href="https://open-meteo.com">Open-Meteo</SourceTag>}
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-sky-500" /> {t("home.rainProbability")}
        </span>
        {floodPts && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-rose-400" /> {t("risk.flood")}
          </span>
        )}
        <span className="telemetry">
          {t("home.rainNext72h")}: <b className="text-white">{fmt.number(weather!.rain72, { maximumFractionDigits: 1 })} mm</b>
        </span>
        {weather!.peakRain && <span className="telemetry">{t("home.peakRainAt", { time: `${weather!.peakRain.time.slice(5, 10)} ${weather!.peakRain.time.slice(11, 16)}` })}</span>}
      </div>

      {/* readout */}
      <div className="mb-1 h-5 text-[11px] telemetry text-slate-300" aria-live="polite">
        {cur ? (
          <>
            {cur.time.slice(5, 10)} {cur.time.slice(11, 16)} · <span className="text-sky-300">{cur.precipProb}%</span> · {fmt.number(cur.precipMm, { maximumFractionDigits: 1 })} mm · {cur.tempC != null ? `${Math.round(cur.tempC)}°C` : ""}
            {curFlood != null && <span className="text-rose-300"> · {t("risk.flood")} {Math.round(curFlood * 100)}%</span>}
          </>
        ) : (
          <span className="text-slate-600">↔</span>
        )}
      </div>

      <div className="relative -mx-1 overflow-x-auto no-scrollbar pb-1" onMouseLeave={() => setSel(null)}>
        <div className="relative px-1" style={{ width: width + 8 }}>
          {/* gridlines */}
          <div className="pointer-events-none absolute inset-x-1 top-0" style={{ height: H }}>
            {[25, 50, 75].map((g) => (
              <div key={g} className="absolute inset-x-0 border-t border-dashed border-slate-700/40" style={{ top: H - (g / 100) * H }}>
                <span className="absolute -top-2 left-0 bg-[#0b1224] pr-1 text-[8px] telemetry text-slate-600">{g}%</span>
              </div>
            ))}
          </div>
          <div className="relative flex items-end" style={{ height: H }}>
            {hours.map((h, k) => {
              const newDay = h.time.slice(11, 13) === "00";
              return (
                <button
                  key={h.time}
                  type="button"
                  onMouseEnter={() => setSel(k)}
                  onFocus={() => setSel(k)}
                  onClick={() => setSel(k)}
                  className="group relative flex h-full shrink-0 items-end justify-center"
                  style={{ width: COL }}
                  aria-label={`${h.time.replace("T", " ")}: ${h.precipProb}% rain, ${h.precipMm} mm`}
                >
                  {newDay && <span className="absolute inset-y-0 left-0 w-px bg-slate-600/60" />}
                  <motion.span
                    className="relative w-[10px] rounded-t-[4px]"
                    style={{ background: sel === k ? "#7dd3fc" : rainShade(h.precipProb) }}
                    initial={{ height: 0 }}
                    animate={{ height: Math.max(2, (h.precipProb / 100) * H) }}
                    transition={{ duration: 0.6, delay: k * 0.006, ease: [0.16, 1, 0.3, 1] }}
                  />
                  {h.precipMm >= 2 && (
                    <span className="absolute text-[8px] telemetry text-sky-200" style={{ bottom: Math.max(2, (h.precipProb / 100) * H) + 2 }}>
                      {Math.round(h.precipMm)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {floodPts && (
            <svg className="pointer-events-none absolute left-1 top-0" width={width} height={H} aria-hidden>
              <polyline points={floodPts} fill="none" stroke="#fb7185" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          )}
          {/* x labels */}
          <div className="relative mt-1 h-7">
            {hours.map((h, k) => {
              const hr = h.time.slice(11, 13);
              if ((hr !== "00" && hr !== "06" && hr !== "12" && hr !== "18" && k !== 0) || (k > 0 && k < 4)) return null;
              return (
                <span key={h.time} className="absolute text-[9px] telemetry text-slate-500" style={{ left: k * COL }}>
                  {hr === "00" || k === 0 ? <b className="block text-slate-300">{fmt.date(`${h.time.slice(0, 10)}T12:00:00`, { weekday: "short", day: "numeric" })}</b> : null}
                  {hr}:00
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {/* River discharge */}
        <div className="rounded-lg bg-slate-900/60 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-slate-300">
              <Waves size={13} className="text-sky-400" /> {t("home.riverDischarge")}
            </span>
            {d ? <SourceTag href="https://www.globalfloods.eu">GloFAS v4</SourceTag> : null}
          </div>
          {d ? (
            <>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="telemetry text-xl font-semibold text-white">{d.today != null ? fmt.number(d.today, { maximumFractionDigits: 0 }) : "—"}</span>
                <span className="text-[10px] text-slate-500">m³/s</span>
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-300">
                  <TrendArrow trend={d.trend} /> {t(`home.${d.trend}` as "home.rising")}
                </span>
              </div>
              {d.ratio != null && <div className="text-[10px] telemetry text-slate-500">{t("home.vsMean", { pct: Math.round(d.ratio * 100) })}</div>}
              <div className="mt-2 h-20">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={d.series.map((x) => ({ date: x.date.slice(5), obs: x.forecast ? null : x.value, fc: x.forecast ? x.value : null }))} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dis" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" hide />
                    <YAxis hide domain={["auto", "auto"]} />
                    {d.mean30d != null && <ReferenceLine y={d.mean30d} stroke="#64748b" strokeDasharray="3 3" />}
                    <Tooltip contentStyle={{ background: "#0b1224", border: "1px solid #1e293b", borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [`${Math.round(v)} m³/s`]} />
                    <Area type="monotone" dataKey="obs" stroke="#38bdf8" strokeWidth={2} fill="url(#dis)" connectNulls isAnimationActive />
                    <Area type="monotone" dataKey="fc" stroke="#38bdf8" strokeWidth={2} strokeDasharray="4 3" fill="none" connectNulls />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <p className="mt-2 text-xs text-slate-500">—</p>
          )}
        </div>
        {/* Salinity trend */}
        <div className="rounded-lg bg-slate-900/60 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-slate-300">
              <Droplets size={13} className="text-amber-400" /> {t("home.salinityTrend")}
            </span>
            {weather?.seaLevel ? <SourceTag>Open-Meteo Marine</SourceTag> : <SourceTag>{sal?.modelVersion ?? "model"}</SourceTag>}
          </div>
          {sal ? (
            <div className="mt-2 flex items-center gap-3">
              <motion.div initial={{ rotate: -30, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} className="grid h-12 w-12 place-items-center rounded-full bg-slate-800">
                <TrendArrow trend={sal.trend} className="h-7 w-7" />
              </motion.div>
              <div className="flex-1">
                <div className="text-sm font-medium text-white">{t(`home.${sal.trend}` as "home.rising")}</div>
                <div className="mt-0.5 flex items-center gap-1.5 telemetry text-[11px] text-slate-400">
                  <span>{fmt.number(sal.ecCurrent, { maximumFractionDigits: 1 })}</span>→<span>{fmt.number(sal.ec7d, { maximumFractionDigits: 1 })}</span>→
                  <span className={sal.ec30d > sal.ecThreshold ? "text-rose-300" : "text-emerald-300"}>{fmt.number(sal.ec30d, { maximumFractionDigits: 1 })}</span>
                  <span className="text-slate-600">dS/m · now/7d/30d</span>
                </div>
                {weather?.seaLevel?.max != null && <div className="mt-1 text-[10px] telemetry text-slate-500">{t("home.tideMax", { m: fmt.number(weather.seaLevel.max, { maximumFractionDigits: 2 }) })}</div>}
              </div>
            </div>
          ) : (
            <Skeleton className="mt-2 h-12 w-full" />
          )}
        </div>
      </div>
    </Panel>
  );
}
