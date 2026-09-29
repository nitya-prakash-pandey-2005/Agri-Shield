"use client";

/** Depot map: coverage radii, district allocation coverage, live dispatch routes. */
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Map as MapIcon } from "lucide-react";
import type { GovMapDepot, GovMapDistrict, GovMapRoute } from "@/components/maps/GovMap";
import { trpc } from "@/lib/trpc";
import { Panel, Skeleton, SourceTag } from "@/components/hud";
import { useGovInput } from "./scope";
import { ErrorNote, fmtInt, ramp, RESOURCE_COLOR, Segmented } from "./ui";

const GovMap = dynamic(() => import("@/components/maps/GovMap"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function DepotMap() {
  const scope = useGovInput();
  const ctx = trpc.government.getContext.useQuery(scope);
  const inv = trpc.government.getResourceInventory.useQuery(scope);
  const regions = trpc.government.getRegionMap.useQuery(scope);
  const reqs = trpc.government.getResourceRequests.useQuery(scope);
  const [filter, setFilter] = useState<string>("all");

  const districts = useMemo<GovMapDistrict[]>(
    () =>
      (regions.data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        geometry: d.geometry,
        lat: d.lat,
        lon: d.lon,
        color: ramp.coverage(d.resourceAllocationPct),
        fillOpacity: 0.22,
        label: d.name,
        tooltip: `<div style="font-weight:600;color:#fff">${esc(d.name)}</div>
          <div>Resource coverage of modelled need: <b style="color:${ramp.coverage(d.resourceAllocationPct)}">${d.resourceAllocationPct}%</b></div>
          <div>Units deployed in district: <b>${fmtInt(d.deployedUnits)}</b></div>
          <div>Farms at risk: <b>${fmtInt(d.farmsAtRisk)}</b> · risk ${d.riskLevel.toUpperCase()}</div>`,
      })),
    [regions.data]
  );

  const depots = useMemo<GovMapDepot[]>(
    () =>
      (inv.data?.depots ?? []).map((d) => {
        const stockOf = filter === "all" ? d.stock.reduce((s, x) => s + x.quantity, 0) : d.stock.find((x) => x.type === filter)?.quantity ?? 0;
        return {
          name: d.name,
          lat: d.lat,
          lon: d.lon,
          coverageKm: d.coverageKm,
          color: filter === "all" ? "#10b981" : RESOURCE_COLOR[filter] ?? "#10b981",
          dim: stockOf === 0,
          html: `<div style="min-width:200px;font-size:12px">
            <div style="font:600 10px var(--font-mono),monospace;letter-spacing:.12em;color:#34d399">DEPOT · ${d.coverageKm} KM COVERAGE</div>
            <div style="margin:3px 0 6px;font-weight:600;color:#fff">${esc(d.name)}</div>
            ${d.stock
              .map(
                (s) =>
                  `<div style="display:flex;justify-content:space-between;gap:12px;${filter !== "all" && s.type !== filter ? "opacity:.45" : ""}"><span style="color:${RESOURCE_COLOR[s.type] ?? "#94a3b8"}">${esc(s.label)}</span><b style="font-family:var(--font-mono),monospace;color:${s.quantity ? "#e2e8f0" : "#f87171"}">${fmtInt(s.quantity)} ${esc(s.unit)}</b></div>`
              )
              .join("")}
          </div>`,
        };
      }),
    [inv.data, filter]
  );

  const routes = useMemo<GovMapRoute[]>(() => {
    const ds = ctx.data?.districts ?? [];
    return (reqs.data ?? [])
      .filter((r) => r.status === "dispatched" && r.dispatch && (filter === "all" || r.resourceType === filter))
      .flatMap((r): GovMapRoute[] => {
        const d = ds.find((x) => x.id === r.targetDistrictId);
        if (!d || !r.dispatch) return [];
        return [{
          id: r.id,
          from: [r.dispatch.depotLat, r.dispatch.depotLon] as [number, number],
          to: [d.lat, d.lon] as [number, number],
          color: RESOURCE_COLOR[r.resourceType] ?? "#10b981",
          label: `${r.id}: ${fmtInt(r.quantity)} ${r.unit} ${r.resourceLabel} → ${r.districtName} · ${r.vehicle ?? ""} · ETA ${r.dispatch.etaHours} h`,
        }];
      });
  }, [reqs.data, ctx.data, filter]);

  const options = [{ value: "all", label: "All" }, ...(inv.data?.rows ?? []).map((r) => ({ value: r.type as string, label: r.label.split(" ")[0]! }))];

  return (
    <Panel
      title="Depots & coverage"
      subtitle="Depot pins with coverage radius · districts coloured by % of modelled need covered · animated routes = in-transit dispatches"
      icon={MapIcon}
      live
      actions={<SourceTag>Agri-SHIELD registry</SourceTag>}
      bodyClassName="px-0 pb-0"
    >
      <div className="px-4 pb-3">
        <Segmented options={options} value={filter} onChange={setFilter} size="xs" layoutId="depot-filter" />
      </div>
      <div className="relative h-[420px] border-t border-white/5">
        {ctx.error || inv.error ? (
          <div className="p-4">
            <ErrorNote error={ctx.error ?? inv.error} />
          </div>
        ) : !ctx.data ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : (
          <GovMap center={ctx.data.center} zoom={7} districts={districts} depots={depots} routes={routes} fitKey={ctx.data.orgId}>
            <div className="pointer-events-none absolute bottom-6 left-2 z-[500] rounded-lg border border-white/10 bg-[#060a16]/85 px-2.5 py-2 backdrop-blur">
              <div className="hud-label mb-1">Need covered</div>
              {[
                { l: "≥ 90%", v: 95 },
                { l: "60–89%", v: 70 },
                { l: "35–59%", v: 45 },
                { l: "< 35%", v: 10 },
              ].map((x) => (
                <div key={x.l} className="flex items-center gap-1.5 text-[10px] text-slate-300">
                  <span className="h-2 w-3 rounded-sm" style={{ background: ramp.coverage(x.v) }} />
                  {x.l}
                </div>
              ))}
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-300">
                <span className="h-2 w-2 rotate-45 bg-emerald-500" /> Depot · {routes.length} in transit
              </div>
            </div>
          </GovMap>
        )}
      </div>
    </Panel>
  );
}
