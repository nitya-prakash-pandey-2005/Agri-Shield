"use client";

/** Infrastructure gap analysis — sensor coverage map, per-district table, network totals. */
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Radar } from "lucide-react";
import type { RouterOutputs } from "@/lib/trpc";
import { Meter, Panel, RiskPill, Skeleton, SourceTag } from "@/components/hud";
import type { GovMapDistrict } from "@/components/maps/GovMap";
import { cn } from "@/lib/utils";
import { fmtInt, fmtUsd, ramp } from "./ui";

const GovMap = dynamic(() => import("@/components/maps/GovMap"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

type Gaps = RouterOutputs["government"]["getInfrastructureGaps"];

const SHORT: Record<string, string> = { rain: "Rain", river: "River", salinity: "EC", soil: "Soil" };

export function InfrastructureGaps({ data, center, fitKey }: { data: Gaps; center: [number, number]; fitKey: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const districts: GovMapDistrict[] = useMemo(
    () =>
      data.rows.map((r) => ({
        id: r.districtId,
        name: r.district,
        geometry: r.geometry,
        lat: r.lat,
        lon: r.lon,
        color: ramp.coverage(r.coveragePct),
        fillOpacity: 0.42,
        label: `${r.district} ${r.coveragePct}%`,
        tooltip: `<div style="font-weight:600;color:#fff">${r.district}</div>
          <div style="color:#94a3b8;margin-bottom:4px">Sensor coverage <b style="color:#fff">${r.coveragePct}%</b> · gap ${fmtUsd(r.gapCostUsd)}</div>
          ${r.sensors.map((s) => `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#94a3b8">${s.label}</span><span style="font-family:var(--font-mono)">${s.installed}/${s.required} (${s.coveragePct}%)</span></div>`).join("")}`,
      })),
    [data.rows]
  );
  const maxReq = Math.max(1, ...data.totals.map((t) => t.required));

  return (
    <Panel
      title="Infrastructure gap analysis"
      subtitle="Where sensor networks are missing — installed vs required density (WMO-168 guidance), weighted by hazard"
      icon={Radar}
      accent="amber"
      actions={
        <>
          <span className="telemetry text-xs text-slate-300">Total gap {fmtUsd(data.gapCostUsd)}</span>
          <SourceTag>Agri-SHIELD registry</SourceTag>
        </>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[1fr,1.15fr]">
        <div className="relative h-[380px] overflow-hidden rounded-xl border border-white/5">
          <GovMap center={center} zoom={7} districts={districts} highlightId={sel} onDistrictClick={(id) => setSel((s) => (s === id ? null : id))} fitKey={fitKey}>
            <div className="absolute bottom-6 left-2 z-[500] rounded-lg border border-white/10 bg-[#060a16]/85 px-2.5 py-2 backdrop-blur">
              <div className="hud-label mb-1">Sensor coverage</div>
              {[
                ["≥ 90%", 95],
                ["60–89%", 70],
                ["35–59%", 45],
                ["< 35%", 10],
              ].map(([l, v]) => (
                <div key={l} className="flex items-center gap-2 text-[10.5px] text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ramp.coverage(v as number) }} />
                  {l}
                </div>
              ))}
            </div>
          </GovMap>
        </div>
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="hud-label text-left">
                  <th className="pb-2 font-normal">#</th>
                  <th className="pb-2 font-normal">District</th>
                  <th className="pb-2 font-normal">Risk</th>
                  <th className="pb-2 font-normal">Coverage</th>
                  {data.totals.map((t) => (
                    <th key={t.key} className="pb-2 text-right font-normal" title={`Missing ${t.label}`}>
                      −{SHORT[t.key] ?? t.key}
                    </th>
                  ))}
                  <th className="pb-2 text-right font-normal">Gap cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.rows.map((r, i) => (
                  <tr key={r.districtId} onClick={() => setSel((s) => (s === r.districtId ? null : r.districtId))} className={cn("cursor-pointer transition-colors hover:bg-white/[0.03]", sel === r.districtId && "bg-emerald-500/10")}>
                    <td className="py-2 telemetry text-slate-500">{i + 1}</td>
                    <td className="py-2 text-slate-100">{r.district}</td>
                    <td className="py-2">
                      <RiskPill level={r.riskLevel} />
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <Meter value={r.coveragePct} color={ramp.coverage(r.coveragePct)} className="w-16" />
                        <span className="telemetry text-[10.5px] text-slate-300">{r.coveragePct}%</span>
                      </div>
                    </td>
                    {r.sensors.map((s) => (
                      <td key={s.key} className={cn("py-2 text-right telemetry", s.missing ? "text-amber-200" : "text-slate-600")}>
                        {s.missing}
                      </td>
                    ))}
                    <td className="py-2 text-right telemetry text-slate-100">{fmtUsd(r.gapCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="hud-label">Network totals</span>
              <span className="flex items-center gap-3 text-[10.5px] text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-slate-700" /> Required
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-emerald-700" /> Installed
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-emerald-400" /> Online
                </span>
              </span>
            </div>
            <div className="space-y-2.5">
              {data.totals.map((t) => (
                <div key={t.key}>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="text-slate-300">{t.label}</span>
                    <span className="telemetry text-slate-400">
                      <span className="text-emerald-300">{fmtInt(t.online)}</span> online · {fmtInt(t.installed)} / {fmtInt(t.required)} · {fmtUsd(t.unitCost)} ea
                    </span>
                  </div>
                  <div className="relative h-2.5 rounded-sm bg-slate-800" style={{ width: `${(t.required / maxReq) * 100}%`, minWidth: "30%" }}>
                    <div className="absolute inset-y-0 left-0 rounded-sm bg-emerald-700" style={{ width: `${(t.installed / Math.max(1, t.required)) * 100}%` }} />
                    <div className="absolute inset-y-0 left-0 rounded-sm bg-emerald-400" style={{ width: `${(t.online / Math.max(1, t.required)) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
