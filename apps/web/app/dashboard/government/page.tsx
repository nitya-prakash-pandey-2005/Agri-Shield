"use client";

/**
 * Government Overview (spec §4.5): KPI row, operational map with layer
 * switcher + live hazards, district drill-down, ops feed, top-risk districts.
 */
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  CloudRain,
  Droplets,
  Globe2,
  History,
  Layers,
  Radar,
  RefreshCw,
  Siren,
  TrendingDown,
  Truck,
  Users,
  Waves,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, Meter, Panel, RiskPill, SectionHeader, Skeleton, SourceTag, StatTile } from "@/components/hud";
import type { GovMapDistrict, GovMapHazard } from "@/components/maps/GovMap";
import { useGovInput } from "@/components/government/scope";
import { DistrictDrawer } from "@/components/government/overview-DistrictDrawer";
import { OpsFeed } from "@/components/government/overview-OpsFeed";
import { OfficerInbox } from "@/components/farmer/OfficerInbox";
import { ago, ErrorNote, fmtInt, fmtNum, fmtUsd, HAZARD_COLOR, ramp, Segmented } from "@/components/government/ui";

const GovMap = dynamic(() => import("@/components/maps/GovMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 skeleton" />,
});

type Layer = "flood" | "salinity" | "density" | "resources" | "history";

const LAYERS: { value: Layer; label: string; icon: typeof Waves }[] = [
  { value: "flood", label: "Flood", icon: Waves },
  { value: "salinity", label: "Salinity", icon: Droplets },
  { value: "density", label: "Farmers", icon: Users },
  { value: "resources", label: "Resources", icon: Truck },
  { value: "history", label: "History", icon: History },
];

const LEGENDS: Record<Layer, { title: string; items: { c: string; l: string }[]; source: string }> = {
  flood: { title: "Flood risk (72h model)", source: "Open-Meteo · GloFAS · Model v2.3.1", items: [{ c: "#4ade80", l: "Low <35" }, { c: "#fbbf24", l: "Medium 35–60" }, { c: "#f87171", l: "High 60–80" }, { c: "#a78bfa", l: "Critical ≥80" }] },
  salinity: { title: "Salinity intrusion risk", source: "Open-Meteo Marine · Model", items: [{ c: "#67e8f9", l: "Low" }, { c: "#fb923c", l: "Moderate" }, { c: "#f472b6", l: "High" }, { c: "#e879f9", l: "Severe" }] },
  density: { title: "Farm density (farms / km²)", source: "Agri-SHIELD registry", items: [{ c: "#0f766e", l: "Sparse" }, { c: "#5eead4", l: "" }, { c: "#fde68a", l: "" }, { c: "#f59e0b", l: "Dense" }] },
  resources: { title: "Resource coverage vs need", source: "Agri-SHIELD registry · Model", items: [{ c: "#ef4444", l: "<35%" }, { c: "#f59e0b", l: "35–60%" }, { c: "#84cc16", l: "60–90%" }, { c: "#10b981", l: "≥90%" }] },
  history: { title: "Historical flood losses (2020–25)", source: "Agri-SHIELD archive", items: [{ c: "#525252", l: "Low" }, { c: "#a3a3a3", l: "" }, { c: "#f59e0b", l: "" }, { c: "#f97316", l: "" }, { c: "#dc2626", l: "Highest" }] },
};

export default function GovernmentOverviewPage() {
  const scope = useGovInput();
  const ctx = trpc.government.getContext.useQuery(scope);
  const overview = trpc.government.getOverview.useQuery(scope, { refetchInterval: 90_000 });
  const regions = trpc.government.getRegionMap.useQuery(scope, { refetchInterval: 120_000 });
  const hazards = trpc.government.getHazards.useQuery(scope, { staleTime: 10 * 60_000 });
  const [layer, setLayer] = useState<Layer>("flood");
  const [selected, setSelected] = useState<string | null>(null);
  const [showHazards, setShowHazards] = useState(true);
  const [showRain, setShowRain] = useState(false);

  const k = overview.data?.kpis;

  const mapDistricts: GovMapDistrict[] = useMemo(() => {
    const rows = regions.data ?? [];
    const maxDensity = Math.max(1, ...rows.map((r) => r.farmerDensity));
    const maxLoss = Math.max(1, ...rows.map((r) => r.historicalLossUsd));
    return rows.map((r) => {
      const color =
        layer === "flood"
          ? ramp.risk(r.floodRisk)
          : layer === "salinity"
            ? ramp.salinity(r.salinityRisk)
            : layer === "density"
              ? ramp.density(r.farmerDensity, maxDensity)
              : layer === "resources"
                ? ramp.coverage(r.resourceAllocationPct)
                : ramp.history(r.historicalLossUsd, maxLoss);
      const metric =
        layer === "flood"
          ? `Flood risk <b>${r.floodRisk}</b> · P24 ${Math.round(r.floodProb24h * 100)}% · P72 ${Math.round(r.floodProb72h * 100)}%<br/>Rain 72h ${r.rainfall72hMm} mm${r.riverDischargeM3s ? ` · ${r.riverName} ${r.riverDischargeM3s.toLocaleString()} m³/s` : ""}`
          : layer === "salinity"
            ? `Salinity risk <b>${r.salinityRisk}</b> · EC ${r.ecCurrent} dS/m`
            : layer === "density"
              ? `<b>${r.farmerDensity}</b> farms/km² · ${r.totalFarms.toLocaleString()} farms · ${r.areaKm2.toLocaleString()} km²`
              : layer === "resources"
                ? `Coverage <b>${r.resourceAllocationPct}%</b> of modelled need · ${r.deployedUnits.toLocaleString()} units deployed`
                : `${r.historicalEvents} flood seasons · loss <b>$${(r.historicalLossUsd / 1e6).toFixed(1)}M</b>${r.worstYear ? `<br/>Worst: ${r.worstYear.year} (${r.worstYear.areaHa.toLocaleString()} ha)` : ""}`;
      return {
        id: r.id,
        name: r.name,
        geometry: r.geometry,
        lat: r.lat,
        lon: r.lon,
        color,
        fillOpacity: 0.42,
        label: r.name,
        pulse: layer === "flood" && (r.riskLevel === "critical" || r.maxSeverity === "emergency"),
        tooltip: `<div style="font-weight:600;color:#fff;margin-bottom:2px">${r.name} <span style="font:600 9px monospace;color:${ramp.risk(Math.max(r.floodRisk, r.salinityRisk))}">${r.riskLevel.toUpperCase()}</span></div>${metric}<br/><span style="color:#94a3b8">${r.farmsAtRisk.toLocaleString()} farms at risk${r.activeAlerts ? ` · ${r.activeAlerts} active alert(s)` : ""}</span>`,
      };
    });
  }, [regions.data, layer]);

  const mapHazards: GovMapHazard[] = useMemo(() => (showHazards ? (hazards.data ?? []) : []), [hazards.data, showHazards]);
  const nearHazards = (hazards.data ?? []).filter((h) => h.distanceKm < 1500).sort((a, b) => a.distanceKm - b.distanceKm);
  const legend = LEGENDS[layer];

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={ctx.data ? `National Operations Centre · ${ctx.data.countryName}` : "National Operations Centre"}
        title="Climate Risk Overview"
        description={ctx.data ? `${ctx.data.orgName} — ${ctx.data.districts.length} monitored districts, live Open-Meteo / GloFAS risk overlay and GDACS / NASA EONET hazard feeds.` : undefined}
        actions={
          <button
            onClick={() => {
              void overview.refetch();
              void regions.refetch();
              void hazards.refetch();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500/50 hover:text-white"
          >
            <RefreshCw size={12} className={overview.isFetching ? "animate-spin" : ""} />
            {overview.data ? `Updated ${ago(overview.data.generatedAt)}` : "Loading"}
          </button>
        }
      />

      <ErrorNote error={overview.error} />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {!k ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        ) : (
          <>
            <StatTile label="Monitored area" value={k.monitoredHa} unit="ha" icon={Globe2} accent="emerald" delta={`${k.districts} districts`} deltaGood hint="Σ monitored cropland across districts (registry)" />
            <StatTile label="High-risk zones" value={k.highRiskZones} unit="active" icon={AlertTriangle} accent="red" delta={k.criticalZones ? `${k.criticalZones} critical` : k.highRiskNames.slice(0, 2).join(", ") || "none"} hint={k.highRiskNames.join(", ")} />
            <StatTile label="Farmers in alert zones" value={k.farmersInAlertZones} icon={Users} accent="amber" delta={`${k.registeredInAlertZones} on platform`} deltaGood hint="Farms in vulnerable zones of high/critical districts or districts with active alerts" />
            <StatTile label="Dispatched today" value={k.resourcesDispatchedToday} unit="units" icon={Truck} accent="cyan" delta={`${k.dispatchesToday} dispatches · ${k.dispatchesYesterday} yesterday`} deltaGood={k.dispatchesToday >= k.dispatchesYesterday} />
            <StatTile label="Alerts sent this week" value={k.alertsSentThisWeek} icon={Bell} accent="violet" delta={`${k.alertsIssuedThisWeek} alerts · ${k.alertsSentPrevWeek ? `${Math.round(((k.alertsSentThisWeek - k.alertsSentPrevWeek) / k.alertsSentPrevWeek) * 100)}% WoW` : "new"}`} deltaGood />
            <StatTile label="Est. crop loss if no action" value={k.estCropLossUsd / 1e6} decimals={1} prefix="$" suffix="M" icon={TrendingDown} accent="red" delta={`of ${fmtUsd(k.cropValueAtRiskUsd)} standing crop`} hint="Exposed cropland × FAOSTAT yield × price × flood/salinity damage curves" />
          </>
        )}
      </div>

      {/* Map + side column */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          title="Operational map"
          subtitle={`${legend.title} · click a district to drill down`}
          icon={Layers}
          live
          className="xl:self-start xl:sticky xl:top-20"
          bodyClassName="p-0"
          actions={
            <div className="hidden md:flex items-center gap-2">
              <SourceTag>{legend.source}</SourceTag>
            </div>
          }
        >
          <div className="relative h-[560px] md:h-[640px] overflow-hidden rounded-b-[14px]">
            {ctx.data && regions.data ? (
              <GovMap
                center={ctx.data.center as [number, number]}
                zoom={7}
                districts={mapDistricts}
                highlightId={selected}
                onDistrictClick={setSelected}
                hazards={mapHazards}
                showRain={showRain}
                fitKey={ctx.data.orgId}
              />
            ) : (
              <div className="absolute inset-0 skeleton" />
            )}

            {/* Layer control */}
            <div className="absolute right-3 top-3 z-[650] flex flex-col items-end gap-2">
              <Segmented options={LAYERS} value={layer} onChange={setLayer} layoutId="gov-layer" />
              <div className="flex gap-1.5">
                <button
                  onClick={() => setShowHazards((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] telemetry uppercase tracking-wider backdrop-blur ${showHazards ? "border-sky-400/50 bg-sky-400/10 text-sky-300" : "border-white/10 bg-[#060a16]/80 text-slate-400"}`}
                >
                  <Siren size={11} /> Hazards {hazards.data ? `(${hazards.data.length})` : ""}
                </button>
                <button
                  onClick={() => setShowRain((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] telemetry uppercase tracking-wider backdrop-blur ${showRain ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-300" : "border-white/10 bg-[#060a16]/80 text-slate-400"}`}
                >
                  <CloudRain size={11} /> IMERG rain
                </button>
              </div>
            </div>

            {/* Legend */}
            <div className="absolute bottom-7 left-3 z-[650] rounded-lg border border-white/10 bg-[#060a16]/85 px-3 py-2 backdrop-blur">
              <div className="hud-label mb-1.5">{legend.title}</div>
              <div className="flex items-center gap-2">
                {legend.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <span className="h-2.5 w-4 rounded-sm" style={{ background: it.c }} />
                    {it.l && <span className="text-[10px] text-slate-400">{it.l}</span>}
                  </div>
                ))}
              </div>
              {showHazards && (
                <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-400">
                  {Object.entries(HAZARD_COLOR)
                    .slice(0, 4)
                    .map(([t, c]) => (
                      <span key={t} className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
                        {t}
                      </span>
                    ))}
                </div>
              )}
            </div>

            <AnimatePresence>{selected && <DistrictDrawer key={selected} districtId={selected} onClose={() => setSelected(null)} />}</AnimatePresence>
          </div>
        </Panel>

        <div className="space-y-4 min-w-0">
          <Panel title="Highest expected loss" subtitle="If no action is taken in the next 72h" icon={Radar} actions={<SourceTag>Model v2.3.1</SourceTag>}>
            {!overview.data ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : (
              <ul className="space-y-1">
                {overview.data.topDistricts.map((d, i) => (
                  <motion.li key={d.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                    <button onClick={() => setSelected(d.id)} className={`w-full rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.04] ${selected === d.id ? "bg-emerald-500/10" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className="telemetry text-[10px] text-slate-500">{String(i + 1).padStart(2, "0")}</span>
                        <span className="text-sm text-slate-100">{d.name}</span>
                        <RiskPill level={d.riskLevel} />
                        <span className="ml-auto telemetry text-sm text-rose-300">{fmtUsd(d.expectedLossUsd)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Meter value={d.floodProb72h * 100} className="flex-1" />
                        <span className="telemetry text-[10px] text-slate-400 w-24 text-right">{fmtNum(d.farmsAtRisk)} farms</span>
                      </div>
                    </button>
                  </motion.li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Live hazard feed"
            subtitle="Nearest global disaster events"
            icon={Siren}
            live
            actions={
              <>
                <SourceTag href="https://www.gdacs.org">GDACS</SourceTag>
                <SourceTag href="https://eonet.gsfc.nasa.gov">NASA EONET</SourceTag>
              </>
            }
            bodyClassName="max-h-[240px] overflow-y-auto"
          >
            {hazards.isLoading ? (
              <Skeleton className="h-24" />
            ) : nearHazards.length ? (
              <ul className="space-y-1">
                {nearHazards.slice(0, 12).map((h) => (
                  <li key={h.id}>
                    <a href={h.url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.03]">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: h.alertLevel === "red" ? "#ef4444" : h.alertLevel === "orange" ? "#f97316" : HAZARD_COLOR[h.type], boxShadow: `0 0 8px ${HAZARD_COLOR[h.type]}` }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-slate-200">{h.title}</span>
                        <span className="block telemetry text-[10px] text-slate-500">
                          {h.source} · {h.type} · {ago(h.date)}
                        </span>
                      </span>
                      <span className={`telemetry text-[10px] ${h.inJurisdiction ? "text-rose-300" : "text-slate-400"}`}>{fmtInt(h.distanceKm)} km</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Siren} title="No hazard events near your jurisdiction">
                GDACS and NASA EONET report no flood/cyclone events within 1,500 km in the last 45–60 days.
              </EmptyState>
            )}
          </Panel>

          <OpsFeed />
          <OfficerInbox />
        </div>
      </div>
    </div>
  );
}
