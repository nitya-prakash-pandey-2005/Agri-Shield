"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Layers, MapPin, Mountain, Sprout, Droplets } from "lucide-react";
import { Meter, Panel, RiskPill, Skeleton, SourceTag, riskColor } from "@/components/hud";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { CropIcon } from "../crops";
import { FieldSatThumb } from "../FieldSatThumb";
import type { FarmerField } from "../hooks";

const HEALTH_COLOR = { excellent: "#22c55e", good: "#84cc16", moderate: "#f59e0b", stressed: "#ef4444" } as const;
const PRIORITY_COLOR: Record<string, string> = { urgent: "#f87171", high: "#fb923c", medium: "#fbbf24", low: "#4ade80" };

function Sparkline({ data, color }: { data: { date: string; ndvi: number }[]; color: string }) {
  if (data.length < 2) return null;
  const w = 160;
  const h = 36;
  const min = Math.min(...data.map((d) => d.ndvi), 0.1);
  const max = Math.max(...data.map((d) => d.ndvi), 0.9);
  const pts = data.map((d, i) => [(i / (data.length - 1)) * w, h - ((d.ndvi - min) / (max - min || 1)) * (h - 4) - 2] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r={3} fill={color} />
    </svg>
  );
}

export function FieldCard({ f, index }: { f: FarmerField; index: number }) {
  const { t, tx, fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const hc = HEALTH_COLOR[f.ndviHealth];
  const rc = riskColor(f.riskScore);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -2 }}
      className="hud-panel overflow-hidden"
      style={{ ["--hud-accent" as string]: rc === "#4ade80" ? "34 197 94" : rc === "#fbbf24" ? "245 158 11" : "239 68 68" }}
    >
      <button onClick={() => setOpen((o) => !o)} className="block w-full p-4 text-left" aria-expanded={open}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-800/80">
              <CropIcon crop={f.cropType} size={18} />
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium text-white">{f.name}</div>
              <div className="text-[11px] text-slate-400">
                {tx(`crops.${f.cropType}`)} · <span className="telemetry">{fmt.number(f.areaHa, { maximumFractionDigits: 2 })} ha</span>
              </div>
            </div>
          </div>
          <RiskPill level={f.riskLevel} />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-slate-900/70 py-1.5">
            <div className="text-[9px] telemetry uppercase text-slate-500">NDVI</div>
            <div className="telemetry text-sm font-semibold" style={{ color: hc }}>
              {fmt.number(f.ndvi, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[9px]" style={{ color: hc }}>
              {tx(`fields.health${f.ndviHealth[0]!.toUpperCase()}${f.ndviHealth.slice(1)}`)}
            </div>
          </div>
          <div className="rounded-md bg-slate-900/70 py-1.5">
            <div className="text-[9px] telemetry uppercase text-slate-500">{t("risk.flood")}</div>
            <div className="telemetry text-sm font-semibold" style={{ color: riskColor(f.floodRisk) }}>
              {f.floodRisk}%
            </div>
          </div>
          <div className="rounded-md bg-slate-900/70 py-1.5">
            <div className="text-[9px] telemetry uppercase text-slate-500">EC</div>
            <div className="telemetry text-sm font-semibold" style={{ color: f.soilEc > f.ecThreshold ? "#f87171" : "#4ade80" }}>
              {fmt.number(f.soilEc, { maximumFractionDigits: 1 })}
            </div>
            <div className="text-[9px] text-slate-500">dS/m</div>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px]">
            <span className="text-slate-400">{t("fields.growth")}</span>
            <span className="telemetry text-slate-300">{f.daysToHarvest > 0 ? t("fields.daysToHarvest", { days: fmt.number(f.daysToHarvest) }) : t("fields.readyToHarvest")}</span>
          </div>
          <Meter value={f.growthPct} color="#34d399" />
        </div>
        <div className="mt-2 flex items-center justify-center text-[10px] text-slate-500">
          {open ? t("fields.hideDetails") : t("fields.showDetails")}
          <ChevronDown size={12} className={cn("ml-1 transition-transform", open && "rotate-180")} />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-3 border-t border-white/5 p-4 pt-3">
              <FieldSatThumb ring={f.geometry.coordinates[0] ?? []} color={rc} label={`${f.name} — ${t("fields.satelliteView")}`} />
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="hud-label">{t("fields.ndviTrend")}</span>
                  <SourceTag>Sentinel-2 / MODIS</SourceTag>
                </div>
                <Sparkline data={f.ndviHistory} color={hc} />
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { icon: Sprout, k: t("fields.planted", { date: fmt.date(f.plantingDate) }), v: "" },
                  { icon: Layers, k: t("fields.soil"), v: tx(`soil.${f.soilType}`) },
                  { icon: Droplets, k: t("fields.irrigation"), v: tx(`irrigation.${f.irrigationType}`) },
                  { icon: Mountain, k: t("fields.elevation"), v: `${fmt.number(f.elevationM, { maximumFractionDigits: 1 })} m` },
                ].map(({ icon: Icon, k, v }) => (
                  <div key={k} className="flex items-center gap-1.5 rounded-md bg-slate-900/60 px-2 py-1.5">
                    <Icon size={12} className="shrink-0 text-slate-500" />
                    <dt className="text-slate-400">{k}</dt>
                    {v && <dd className="ml-auto telemetry text-slate-200">{v}</dd>}
                  </div>
                ))}
              </dl>
              <div>
                <div className="hud-label mb-1.5">{t("fields.fieldRecommendations")}</div>
                {f.recommendations.length ? (
                  <ul className="space-y-1.5">
                    {f.recommendations.map((r) => (
                      <li key={r.id} className="rounded-md border-l-2 bg-slate-900/60 px-2.5 py-2" style={{ borderColor: PRIORITY_COLOR[r.priority] }}>
                        <div className="text-[13px] font-medium text-slate-100">{r.title}</div>
                        <div className="mt-0.5 text-[11px] text-slate-400">{r.actions.join(" · ")}</div>
                        <div className="mt-1 text-[9px] telemetry uppercase text-slate-600">
                          {r.generatedBy} · {Math.round(r.confidence * 100)}%
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">{t("fields.noRecommendations")}</p>
                )}
              </div>
              <Link href={`/dashboard/farmer/map?field=${encodeURIComponent(f.id)}`} className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-700 text-xs text-slate-200 hover:border-emerald-500/50">
                <MapPin size={13} /> {t("fields.viewOnMap")}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function FieldsGrid({ fields, loading }: { fields?: FarmerField[]; loading: boolean }) {
  const { t, fmt } = useI18n();
  const area = fields?.reduce((a, f) => a + f.areaHa, 0) ?? 0;
  return (
    <section aria-labelledby="my-fields">
      <div className="mb-3 flex items-end justify-between">
        <h2 id="my-fields" className="font-display text-lg font-semibold text-white">
          {t("home.myFields")}
        </h2>
        {fields && <span className="text-xs telemetry text-slate-400">{t("home.fieldsSummary", { count: fields.length, area: fmt.number(area, { maximumFractionDigits: 1 }) })}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {loading || !fields ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />) : fields.map((f, i) => <FieldCard key={f.id} f={f} index={i} />)}
      </div>
    </section>
  );
}
