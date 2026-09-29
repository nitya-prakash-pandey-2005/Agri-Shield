"use client";

/** Workspace ESG summary — physical risk, emissions intensity, water, smallholder reach; CSV/PDF export. */
import { useState } from "react";
import { toast } from "sonner";
import { Download, Droplets, Factory, FileText, ShieldAlert, Users, Wheat } from "lucide-react";
import { Panel, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, downloadFile, ErrorBox, Kpi, num, toCsv, usd, WhatThisMeans } from "@/components/insurance/kit";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type E = RouterOutputs["sustainability"]["esg"]["summary"];

export function esgCsv(e: E) {
  const rows: Record<string, unknown>[] = [];
  const add = (section: string, metric: string, value: unknown, unit: string) => rows.push({ section, metric, value, unit });
  const r = e.physicalRisk;
  add("physical_risk", "assets", r.assets, "count");
  add("physical_risk", "exposure", r.exposureUsd, "USD");
  add("physical_risk", "value_at_risk", r.valueAtRiskUsd, "USD");
  add("physical_risk", "var_ratio", r.varRatioPct, "%");
  add("physical_risk", "assets_at_risk", r.atRiskAssets, "count");
  add("physical_risk", "exposure_at_risk", r.atRiskExposureUsd, "USD");
  for (const [k, v] of Object.entries(r.byHazardUsd)) add("physical_risk", `var_${k}`, v, "USD");
  add("production", "production_p50", e.production.productionT.p50, "t");
  add("production", "production_p10", e.production.productionT.p10, "t");
  add("production", "production_p90", e.production.productionT.p90, "t");
  add("production", "vs_normal", e.production.vsNormalPct, "%");
  add("emissions", "season", e.emissions.seasonTCo2e, "t CO2e");
  add("emissions", "annual", e.emissions.annualTCo2e, "t CO2e/yr");
  add("emissions", "rice_ch4", e.emissions.bySource.ch4, "t CO2e");
  add("emissions", "n2o", e.emissions.bySource.n2o, "t CO2e");
  add("emissions", "urea_co2", e.emissions.bySource.ureaCo2, "t CO2e");
  add("emissions", "intensity", e.emissions.intensityTCo2ePerT ?? "", "t CO2e/t");
  add("emissions", "avoided_awd", e.emissions.avoidedAnnualTCo2e, "t CO2e/yr");
  add("water", "withdrawal", e.water.withdrawalM3, "m3");
  add("water", "green", e.water.greenM3, "m3");
  add("water", "blue", e.water.blueM3, "m3");
  add("water", "footprint", e.water.footprintM3PerT ?? "", "m3/t");
  add("water", "awd_saved", e.water.awdSavedM3, "m3");
  add("reach", "farmers", e.reach.farmers, "count");
  add("reach", "area", e.reach.areaHa, "ha");
  add("reach", "women_headed", e.reach.womenHeadedPct ?? "not recorded", "%");
  add("reach", "awd_farmers", e.reach.awdFarmers, "count");
  return toCsv(rows);
}

export default function Esg({ preparedBy }: { preparedBy: string }) {
  const q = trpc.sustainability.esg.summary.useQuery(undefined, { staleTime: 5 * 60_000 });
  const exp = trpc.sustainability.esg.recordExport.useMutation();
  const [busy, setBusy] = useState(false);
  const e = q.data;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!e) return <Skeleton className="h-96" />;
  const r = e.physicalRisk;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-slate-400">
          One page for sustainability reports, lenders and investors — structured for <Explain term="tcfd">TCFD / ISSB IFRS S2</Explain>, SBTi FLAG and TNFD water questions.
        </p>
        <div className="flex gap-2">
          <Btn variant="outline" onClick={() => (downloadFile(`esg-summary-${new Date().toISOString().slice(0, 10)}.csv`, esgCsv(e)), exp.mutate({ kind: "esg_csv" }))}>
            <Download size={13} /> CSV
          </Btn>
          <Btn
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { esgPdf } = await import("./pdf");
                await esgPdf(e, preparedBy);
                exp.mutate({ kind: "esg_pdf" });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "PDF failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            <FileText size={13} /> PDF
          </Btn>
        </div>
      </div>
      <WhatThisMeans tone="sky">
        {e.workspace.name}: {usd(r.exposureUsd)} of exposure across {r.assets} assets has a physical-risk value at risk of {usd(r.valueAtRiskUsd)} ({r.varRatioPct} %), mostly from {Object.entries(r.byHazardUsd).sort((a, b) => b[1] - a[1])[0]?.[0]}. The crop area you finance, insure or aggregate emits about {num(e.emissions.annualTCo2e)} t CO2e a year
        {e.emissions.intensityTCo2ePerT != null && ` (${e.emissions.intensityTCo2ePerT} t CO2e per tonne of crop)`}, and reaches {num(e.reach.farmers)} farming households{e.reach.womenHeadedPct != null && `, ${e.reach.womenHeadedPct} % women-headed`}.
      </WhatThisMeans>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Physical climate risk" subtitle="From the Portfolio module's live hazard scores" icon={ShieldAlert} accent="red">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Exposure" value={usd(r.exposureUsd)} sub={`${r.assets} assets`} />
            <Kpi label={<>Value at risk <Explain term="var" /></>} value={usd(r.valueAtRiskUsd)} sub={`${r.varRatioPct} % of exposure`} tone={r.varRatioPct > 15 ? "bad" : "warn"} />
            <Kpi label={`At/above threshold ${r.threshold}`} value={`${r.atRiskAssets} assets`} sub={usd(r.atRiskExposureUsd)} />
            <Kpi label="Mean composite score" value={`${r.meanComposite}`} sub="0-100" />
          </div>
          <div className="mt-3 space-y-1.5">
            {Object.entries(r.byHazardUsd).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-[12px]">
                <span className="w-16 capitalize text-slate-400">{k}</span>
                <div className="h-2 flex-1 rounded-full bg-slate-800">
                  <div className="h-2 rounded-full bg-rose-400/70" style={{ width: `${r.valueAtRiskUsd ? (v / r.valueAtRiskUsd) * 100 : 0}%` }} />
                </div>
                <span className="telemetry w-20 text-right text-slate-300">{usd(v)}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Emissions" subtitle="IPCC 2019 Tier 1 on portfolio crop area · AR6 GWP-100" icon={Factory} accent="amber">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Annual" value={`${num(e.emissions.annualTCo2e)} t CO2e`} sub={`season ${num(e.emissions.seasonTCo2e)} t`} />
            <Kpi label="Intensity" value={e.emissions.intensityTCo2ePerT == null ? "—" : `${e.emissions.intensityTCo2ePerT} t/t`} sub={e.emissions.riceIntensityTCo2ePerT == null ? "t CO2e per t crop" : `rice ${e.emissions.riceIntensityTCo2ePerT} t CO2e/t`} />
            <Kpi label="Rice methane (season)" value={`${num(e.emissions.bySource.ch4)} t`} sub={`N2O ${num(e.emissions.bySource.n2o)} · urea CO2 ${num(e.emissions.bySource.ureaCo2)} t CO2e`} />
            <Kpi label="Avoided by AWD" value={`${num(e.emissions.avoidedAnnualTCo2e)} t/yr`} sub={`${e.emissions.awdAdoptionPctArea} % of eligible area`} tone="good" />
          </div>
        </Panel>
        <Panel title="Water" icon={Droplets} accent="cyan">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Irrigation withdrawal" value={`${num(e.water.withdrawalM3 / 1000)}k m³`} sub="season" />
            <Kpi label="Water footprint" value={e.water.footprintM3PerT == null ? "—" : `${num(e.water.footprintM3PerT)} m³/t`} sub="green + blue ET" />
            <Kpi label="Green / blue" value={`${num(e.water.greenM3 / 1000)}k / ${num(e.water.blueM3 / 1000)}k`} sub="m³ consumptive" />
            <Kpi label="Saved by AWD" value={`${num(e.water.awdSavedM3 / 1000)}k m³`} tone="good" />
          </div>
        </Panel>
        <Panel title="Smallholder reach & production" icon={Users} accent="violet">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Farming households" value={num(e.reach.farmers)} sub={`${num(e.reach.areaHa)} ha`} />
            <Kpi label="Women-headed" value={e.reach.womenHeadedPct == null ? "not recorded" : `${e.reach.womenHeadedPct} %`} sub={e.reach.womenHeadedPct == null ? "add femaleHeadedPct on import" : "household-weighted"} />
            <Kpi label="Practising AWD" value={num(e.reach.awdFarmers)} sub="farmers" />
            <Kpi label={<><Wheat size={11} className="inline" /> Production P50</>} value={`${num(e.production.productionT.p50)} t`} sub={`${e.production.vsNormalPct > 0 ? "+" : ""}${e.production.vsNormalPct} % vs normal`} />
          </div>
          {e.reach.womenHeadedPct == null && <p className="mt-2 text-[11.5px] text-slate-500">{e.reach.womenHeadedBasis}</p>}
        </Panel>
      </div>
      <p className="text-[11.5px] text-slate-500">{e.notes.join(" ")}</p>
    </div>
  );
}
