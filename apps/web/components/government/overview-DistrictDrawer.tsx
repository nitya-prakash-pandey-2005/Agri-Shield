"use client";

/**
 * Right-side drill-down panel for a district (spec §4.5 "Drill-Down District Panel").
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bell, CloudRain, History, MapPin, Radar, Send, Users, Waves, X } from "lucide-react";
import type { ResourceType } from "@agri-shield/types";
import { trpc } from "@/lib/trpc";
import { HudButton, LiveDot, Meter, RiskPill, Skeleton, SourceTag, riskColor } from "@/components/hud";
import { useGovInput } from "./scope";
import { DispatchModal } from "./DispatchModal";
import { ago, ALERT_ICON, CHART, ChartTooltip, dateShort, ErrorNote, fmtInt, fmtNum, fmtUsd, KeyValue, RESOURCE_COLOR, RESOURCE_ICON, SEVERITY_COLOR } from "./ui";

function ProbBar({ label, p, delay }: { label: string; p: number; delay: number }) {
  const pct = Math.round(p * 100);
  const c = riskColor(pct);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-24 w-full rounded-md bg-slate-800/60 overflow-hidden">
        <motion.div
          className="absolute inset-x-0 bottom-0 rounded-md"
          style={{ background: `linear-gradient(180deg, ${c}, ${c}55)`, boxShadow: `0 0 16px ${c}66` }}
          initial={{ height: 0 }}
          animate={{ height: `${pct}%` }}
          transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
        />
        <div className="absolute inset-x-0 top-1.5 text-center telemetry text-sm font-semibold text-white drop-shadow">{pct}%</div>
      </div>
      <span className="hud-label">{label}</span>
    </div>
  );
}

function Section({ icon: Icon, title, children, extra }: { icon: typeof Bell; title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="border-t border-white/5 px-4 py-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon size={13} className="text-emerald-400" />
          <h4 className="hud-label text-slate-300">{title}</h4>
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function DistrictDrawer({ districtId, onClose }: { districtId: string; onClose: () => void }) {
  const scope = useGovInput();
  const q = trpc.government.getDistrict.useQuery({ ...scope, id: districtId }, { refetchInterval: 120_000 });
  const ctx = trpc.government.getContext.useQuery(scope);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchType, setDispatchType] = useState<ResourceType | undefined>();
  const d = q.data;
  const suggestedKey = d ? d.resources.map((r) => `${r.type}:${r.gap}:${r.needed}`).join("|") : "";
  const target = useMemo(() => {
    if (!d) return null;
    const suggested = Object.fromEntries(d.resources.map((r) => [r.type, Math.max(1, r.gap || Math.ceil(r.needed * 0.25))])) as Partial<Record<ResourceType, number>>;
    return { kind: "new" as const, districtId: d.id, resourceType: dispatchType ?? (d.resources.find((r) => r.gap > 0)?.type as ResourceType | undefined), suggested };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.id, dispatchType, suggestedKey]);

  return (
    <motion.aside
      key={districtId}
      initial={{ x: "105%", opacity: 0.4 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "105%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      className="absolute inset-y-0 right-0 z-[700] flex w-full sm:w-[420px] flex-col border-l border-white/10 bg-[#070c1a]/95 backdrop-blur-xl shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.8)]"
    >
      <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
        {d ? (
          <div className="min-w-0">
            <div className="hud-label text-emerald-400/80">
              District · {d.countryName} · {d.basin}
            </div>
            <h3 className="mt-0.5 font-display text-xl font-semibold text-white truncate">{d.name}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <RiskPill level={d.riskLevel} />
              {d.liveSource === "open-meteo" ? <LiveDot label="LIVE" /> : <SourceTag>Seed baseline</SourceTag>}
              <span className="telemetry text-[10px] text-slate-500">upd {ago(d.lastUpdated)}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-6 w-32" />
          </div>
        )}
        <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close district panel">
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <ErrorNote error={q.error} className="mx-4" />
        {!d ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-20" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <>
            <Section icon={Waves} title="Flood probability timeline" extra={<SourceTag>Model v2.3.1 · Open-Meteo</SourceTag>}>
              <div className="grid grid-cols-3 gap-3">
                <ProbBar label="24 h" p={d.floodProb.h24} delay={0} />
                <ProbBar label="48 h" p={d.floodProb.h48} delay={0.08} />
                <ProbBar label="72 h" p={d.floodProb.h72} delay={0.16} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
                <KeyValue k="Rain 72h" v={`${d.rainfall72hMm} mm`} />
                <KeyValue k="Est. depth" v={`${d.economics.depthM} m`} />
                <KeyValue k="Salinity EC" v={`${d.ecCurrent} → ${d.ecPredicted30d} dS/m`} />
                <KeyValue k="Sea level" v={d.seaLevelAnomalyM == null ? "—" : `${d.seaLevelAnomalyM} m`} />
              </div>
            </Section>

            <Section icon={Users} title="Farmers at risk" extra={<SourceTag>Agri-SHIELD registry</SourceTag>}>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-white/[0.03] p-2.5">
                  <div className="telemetry text-lg font-semibold text-white">{fmtNum(d.farmersAtRisk.count)}</div>
                  <div className="text-[10px] text-slate-500">farms exposed</div>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-2.5">
                  <div className="telemetry text-lg font-semibold text-white">{fmtNum(d.economics.atRiskHa)}</div>
                  <div className="text-[10px] text-slate-500">ha at risk</div>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-2.5">
                  <div className="telemetry text-lg font-semibold text-rose-300">{fmtUsd(d.economics.expectedLossUsd)}</div>
                  <div className="text-[10px] text-slate-500">loss if no action</div>
                </div>
              </div>
              <div className="mt-2.5 space-y-1">
                <div className="text-[10px] text-slate-500">
                  Registered on platform: {d.farmersAtRisk.registered} · {d.farmersAtRisk.registeredAtRisk} above 60% field risk
                </div>
                {d.farmersAtRisk.list.slice(0, 5).map((f) => (
                  <div key={f.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/[0.03]">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: riskColor(f.maxRisk) }} />
                    <span className="text-slate-200 truncate">{f.name}</span>
                    <span className="text-slate-500 truncate">
                      {f.areaHa} ha · {f.crops.join("/")}
                    </span>
                    <span className="ml-auto telemetry" style={{ color: riskColor(f.maxRisk) }}>
                      {f.maxRisk}%
                    </span>
                  </div>
                ))}
              </div>
            </Section>

            <Section
              icon={Radar}
              title="Resources needed vs available"
              extra={
                <HudButton className="px-2.5 py-1 text-xs" onClick={() => (setDispatchType(undefined), setDispatchOpen(true))} disabled={!ctx.data?.permissions.requestResources}>
                  <Send size={12} /> Dispatch Resources
                </HudButton>
              }
            >
              <div className="space-y-2.5">
                {d.resources.map((r) => {
                  const Icon = RESOURCE_ICON[r.type]!;
                  return (
                    <button key={r.type} className="block w-full text-left group" onClick={() => (setDispatchType(r.type), setDispatchOpen(true))} disabled={!ctx.data?.permissions.requestResources}>
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        <Icon size={12} style={{ color: RESOURCE_COLOR[r.type] }} />
                        <span className="text-slate-300 group-hover:text-white">{r.label}</span>
                        <span className="ml-auto telemetry text-slate-400">
                          <span className={r.gap ? "text-amber-300" : "text-emerald-300"}>{fmtInt(r.available)}</span> / {fmtInt(r.needed)}
                        </span>
                      </div>
                      <Meter value={r.coveragePct} color={r.coveragePct >= 90 ? "#10b981" : r.coveragePct >= 50 ? "#f59e0b" : "#ef4444"} />
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">Need = Sphere/SOD planning ratios × modelled severe-flood area & evacuees. Available = district depot + already deployed.</p>
            </Section>

            <Section icon={CloudRain} title="Live weather · 72h rainfall" extra={<SourceTag href="https://open-meteo.com">Open-Meteo</SourceTag>}>
              {d.weather ? (
                <>
                  {d.weather.current && (
                    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
                      <span>{d.weather.current.label}</span>
                      <span className="telemetry">{d.weather.current.tempC}°C</span>
                      <span className="telemetry">{d.weather.current.humidity}% RH</span>
                      <span className="telemetry">{d.weather.current.windKmh} km/h</span>
                    </div>
                  )}
                  <div className="h-28">
                    <ResponsiveContainer>
                      <BarChart data={d.weather.hourly.map((h) => ({ t: h.time.slice(5, 13).replace("T", " "), mm: h.precipMm, p: h.precipProb }))}>
                        <CartesianGrid stroke={CHART.grid} vertical={false} />
                        <XAxis dataKey="t" tick={CHART.axis} interval={11} tickLine={false} axisLine={false} />
                        <YAxis tick={CHART.axis} width={28} tickLine={false} axisLine={false} />
                        <Tooltip content={<ChartTooltip format={(v, n) => (n === "Rain" ? `${v} mm` : `${v}%`)} />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
                        <Bar dataKey="mm" name="Rain" fill={CHART.cyan} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500">Open-Meteo unreachable — showing model values only.</p>
              )}
            </Section>

            <Section icon={Waves} title={`River discharge · ${d.riverName}`} extra={<SourceTag href="https://open-meteo.com/en/docs/flood-api">GloFAS v4</SourceTag>}>
              {d.discharge ? (
                <div className="h-32">
                  <ResponsiveContainer>
                    <ComposedChart data={d.discharge.map((x) => ({ date: x.date.slice(5), q: x.discharge, mean: x.mean, max: x.max, fc: x.forecast ? x.discharge : null }))}>
                      <defs>
                        <linearGradient id="qgrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART.emerald} stopOpacity={0.45} />
                          <stop offset="100%" stopColor={CHART.emerald} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="date" tick={CHART.axis} interval={6} tickLine={false} axisLine={false} />
                      <YAxis tick={CHART.axis} width={40} tickLine={false} axisLine={false} tickFormatter={(v) => fmtNum(v)} />
                      <Tooltip content={<ChartTooltip format={(v) => `${Math.round(v).toLocaleString()} m³/s`} />} />
                      <Area dataKey="q" name="Discharge" stroke={CHART.emerald} fill="url(#qgrad)" strokeWidth={1.5} connectNulls />
                      <Line dataKey="fc" name="Forecast" stroke={CHART.amber} strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
                      <Line dataKey="max" name="Ensemble max" stroke={CHART.rose} strokeWidth={1} strokeOpacity={0.6} dot={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-xs text-slate-500">No GloFAS reach at this point — discharge unavailable.</p>
              )}
              {d.riverDischargeM3s != null && (
                <div className="mt-1.5 text-[11px] text-slate-400">
                  Peak next 72h <span className="telemetry text-white">{fmtInt(d.riverDischargeM3s)} m³/s</span> vs 30-day mean{" "}
                  <span className="telemetry text-white">{fmtInt(d.riverDischargeMeanM3s)}</span>
                </div>
              )}
            </Section>

            <Section icon={Bell} title="Recent alerts">
              {d.recentAlerts.length ? (
                <div className="space-y-1.5">
                  {d.recentAlerts.slice(0, 5).map((a) => {
                    const Icon = ALERT_ICON[a.alertType]!;
                    return (
                      <div key={a.id} className="flex items-start gap-2 rounded-md border-l-2 bg-white/[0.02] px-2.5 py-1.5" style={{ borderColor: SEVERITY_COLOR[a.severity] }}>
                        <Icon size={13} className="mt-0.5 shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs text-slate-200">{a.title}</div>
                          <div className="telemetry text-[10px] text-slate-500">
                            {ago(a.createdAt)} · {fmtNum(a.deliveries.sent)} sent · {Math.round((a.deliveries.read / Math.max(1, a.deliveries.delivered)) * 100)}% read
                          </div>
                        </div>
                        {a.active && <LiveDot label="ACTIVE" color={SEVERITY_COLOR[a.severity]} />}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No alerts on record.</p>
              )}
            </Section>

            <Section icon={History} title="Historical flood events" extra={<SourceTag>Agri-SHIELD archive</SourceTag>}>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-1 font-normal">Year</th>
                    <th className="pb-1 font-normal text-right">Area</th>
                    <th className="pb-1 font-normal text-right">Farms</th>
                    <th className="pb-1 font-normal text-right">Damage</th>
                  </tr>
                </thead>
                <tbody className="telemetry">
                  {d.historicalFloods.map((h) => (
                    <tr key={h.year} className="border-t border-white/5">
                      <td className="py-1 text-slate-300">
                        {h.month} {h.year}
                      </td>
                      <td className="py-1 text-right text-slate-200">{fmtNum(h.areaHa)} ha</td>
                      <td className="py-1 text-right text-slate-200">{fmtNum(h.farmsAffected)}</td>
                      <td className="py-1 text-right text-rose-300">{fmtUsd(h.lossUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {d.hazards.length > 0 && (
              <Section icon={MapPin} title="Live hazards within 500 km" extra={<SourceTag>GDACS · NASA EONET</SourceTag>}>
                <div className="space-y-1">
                  {d.hazards.slice(0, 5).map((h) => (
                    <a key={h.id} href={h.url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-white/[0.03]">
                      <span className="telemetry text-[10px] text-slate-500">{h.source}</span>
                      <span className="truncate text-slate-200">{h.title}</span>
                      <span className="ml-auto telemetry text-slate-400">{h.distanceKm} km</span>
                    </a>
                  ))}
                </div>
              </Section>
            )}
            <div className="px-4 pb-4 pt-1 text-[10px] text-slate-600">
              Pop. {fmtNum(d.population)} · {fmtNum(d.totalFarms)} farms · {fmtNum(d.monitoredAreaHa)} ha monitored · coast {d.coastDistanceKm} km · sensors {d.sensors.coveragePct}% coverage · updated {dateShort(d.lastUpdated)}
            </div>
          </>
        )}
      </div>
      <DispatchModal open={dispatchOpen} onClose={() => setDispatchOpen(false)} target={target} />
    </motion.aside>
  );
}
