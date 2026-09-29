"use client";

/** Data-generated policy briefs — top-3 districts by expected + historical loss. */
import { motion } from "framer-motion";
import { Copy, Droplets, FileText, Waves } from "lucide-react";
import { toast } from "sonner";
import type { RouterOutputs } from "@/lib/trpc";
import { Panel, RiskPill, SourceTag } from "@/components/hud";
import { fmtUsd, KeyValue, Pill } from "./ui";

type Briefs = RouterOutputs["government"]["getPolicyBriefs"];

function briefText(b: Briefs["briefs"][number], quarter: string, org: string) {
  return [
    `POLICY BRIEF ${b.rank} — ${b.district} (${quarter})`,
    `Issuing authority: ${org}`,
    "",
    b.headline,
    "",
    b.summary,
    "",
    "Recommended investments:",
    ...b.recommendations.map((r) => `  - ${r.item}: ${fmtUsd(r.costUsd)}`),
    `Total: ${fmtUsd(b.totalCostUsd)} | Avoided annual loss: ${fmtUsd(b.avoidedAnnualUsd)} | BCR ${b.bcr} | Payback ${b.paybackYears ?? "n/a"} years`,
    "",
    "Source: Agri-SHIELD (Open-Meteo, GloFAS, district flood archive).",
  ].join("\n");
}

export function PolicyBriefs({ data }: { data: Briefs }) {
  const copy = async (b: Briefs["briefs"][number]) => {
    try {
      await navigator.clipboard.writeText(briefText(b, data.quarter, data.orgName));
      toast.success(`Brief for ${b.district} copied`);
    } catch {
      toast.error("Clipboard unavailable in this browser");
    }
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-3">
        {data.briefs.map((b, i) => {
          const DriverIcon = b.driver === "salinity" ? Droplets : Waves;
          return (
            <motion.div key={b.districtId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} whileHover={{ y: -2 }} className="h-full">
              <Panel
                className="h-full"
                accent={b.driver === "salinity" ? "violet" : "cyan"}
                title={
                  <span className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-emerald-500/15 telemetry text-[11px] text-emerald-300">{b.rank}</span>
                    {b.district}
                  </span>
                }
                actions={
                  <button onClick={() => copy(b)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5 hover:text-white" title="Copy brief">
                    <Copy size={12} /> Copy brief
                  </button>
                }
              >
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <Pill color={b.driver === "salinity" ? "#c084fc" : "#38bdf8"}>
                    <DriverIcon size={10} /> {b.driver} driver
                  </Pill>
                  <RiskPill level={b.riskLevel} />
                </div>
                <h4 className="font-display text-sm font-semibold leading-snug text-white">{b.headline}</h4>
                <p className="mt-2 text-[12.5px] leading-relaxed text-slate-300">{b.summary}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    ["Expected loss now", fmtUsd(b.metrics.expectedLossUsd)],
                    ["Avg annual flood loss", fmtUsd(b.metrics.avgAnnualFloodLossUsd)],
                    ["Farms at risk", b.metrics.farmsAtRisk.toLocaleString("en-US")],
                    ["Sensor coverage", `${b.metrics.sensorCoveragePct}%`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
                      <div className="hud-label text-[9px]">{k}</div>
                      <div className="telemetry text-sm text-slate-100">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
                  {b.recommendations.map((r) => (
                    <KeyValue key={r.item} k={r.item} v={fmtUsd(r.costUsd)} />
                  ))}
                  <div className="hud-divider my-2" />
                  <KeyValue k={<span className="text-slate-200">Total investment</span>} v={<span className="text-white">{fmtUsd(b.totalCostUsd)}</span>} />
                  <KeyValue k="Avoided annual loss" v={<span className="text-emerald-300">{fmtUsd(b.avoidedAnnualUsd)}</span>} />
                  <KeyValue k="Benefit–cost ratio · payback" v={`${b.bcr.toFixed(2)} · ${b.paybackYears ?? "—"} yrs`} />
                </div>
              </Panel>
            </motion.div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-start gap-2 text-[11px] text-slate-500">
        <FileText size={12} className="mt-0.5 shrink-0" />
        <span className="max-w-4xl">{data.method}</span>
        <SourceTag>Generated from live data · {data.quarter}</SourceTag>
      </div>
    </div>
  );
}
