"use client";

/** MRV evidence pack — what's inside, readiness checklist, PDF + CSV download. */
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleDashed, Download, FileCheck2, FileText } from "lucide-react";
import { Panel } from "@/components/hud";
import { Btn, downloadFile } from "@/components/insurance/kit";
import { trpc } from "@/lib/trpc";
import { mrvCsv } from "./Farms";
import { IndicativeBadge, type ProgrammeT } from "./Programme";

export default function Evidence({ p, orgName, preparedBy }: { p: ProgrammeT; orgName: string; preparedBy: string }) {
  const meth = trpc.sustainability.carbon.methodology.useQuery(undefined, { staleTime: Infinity });
  const exp = trpc.sustainability.esg.recordExport.useMutation();
  const [busy, setBusy] = useState(false);
  const t = p.totals;
  const checks: [boolean, string, string][] = [
    [t.riceAssets > 0, "Rice plots geo-located", `${t.riceAssets} rice assets with coordinates and area`],
    [t.adoptedAssets > 0, "AWD adoption recorded per plot", `${t.adoptedAssets} adopting assets with start date`],
    [t.verification.field_verified + t.verification.remote_sensed >= t.adoptedAssets * 0.5 && t.adoptedAssets > 0, "≥ 50 % of adopting plots independently verified", `${t.verification.field_verified} field-verified · ${t.verification.remote_sensed} remote-sensed · ${t.verification.self_reported} self-reported`],
    [p.rows.some((r) => r.practice.overridden), "Field practice recorded (regime, N, amendments)", p.rows.some((r) => r.practice.overridden) ? `${p.rows.filter((r) => r.practice.overridden).length} assets with recorded practice` : "all assets use IPCC / national defaults"],
    [false, "Water-level monitoring series (field tubes / sensors)", "not yet connected — link Sensors & IoT or upload readings"],
    [false, "Third-party validation & verification (VVB)", "required before any credit issuance"],
  ];
  const download = async () => {
    if (!meth.data) return;
    setBusy(true);
    try {
      const { mrvEvidencePdf } = await import("./pdf");
      await mrvEvidencePdf(p, meth.data, orgName, preparedBy);
      exp.mutate({ kind: "mrv_pdf" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <Panel className="xl:col-span-3" title="MRV evidence pack (PDF)" subtitle="Methodology, assumptions, data sources, programme results, per-farm table and adoption register" icon={FileText} accent="green">
        <div className="space-y-3 text-[13px] text-slate-300">
          <IndicativeBadge />
          <ol className="list-decimal space-y-1 pl-5 text-slate-400">
            <li>Summary — emissions, adoption, avoided t CO2e, indicative revenue and water saved (current settings: ${p.options.priceUsd}/t, {p.options.deductionPct} % deduction, {p.options.targetAdoptionPct} % scenario).</li>
            <li>Methodology — IPCC 2019 Refinement Eq. 5.1-5.3 with SF_w, SF_p and CFOA tables; N2O (Ch. 11) and urea CO2; AR6 GWP-100.</li>
            <li>Assumptions — baseline regimes, AWD eligibility, N rates, cropping intensity, deductions.</li>
            <li>Data sources — IPCC, AR6, AWD water evidence, FAOSTAT, FAO-56/33, ERA5 / NASA POWER.</li>
            <li>Per-farm / per-unit results — {t.riceAssets} rice assets.</li>
            <li>Adoption evidence register — status, start date, coordinates, notes.</li>
            <li>Limitations — why this is not a VM0051 quantification.</li>
          </ol>
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn onClick={download} loading={busy || meth.isLoading} disabled={!meth.data}>
              <FileText size={13} /> Download evidence pack (PDF)
            </Btn>
            <Btn variant="outline" onClick={() => (downloadFile(`mrv-farms-${new Date().toISOString().slice(0, 10)}.csv`, mrvCsv(p)), exp.mutate({ kind: "mrv_csv" }))}>
              <Download size={13} /> Per-farm data (CSV)
            </Btn>
          </div>
        </div>
      </Panel>
      <Panel className="xl:col-span-2" title="Readiness for a crediting project" subtitle="What a VM0051-style project would still need" icon={FileCheck2} accent="violet">
        <ul className="space-y-2">
          {checks.map(([ok, title, sub]) => (
            <li key={title} className="flex gap-2">
              {ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" /> : <CircleDashed size={15} className="mt-0.5 shrink-0 text-slate-500" />}
              <div>
                <div className={`text-[12.5px] ${ok ? "text-slate-200" : "text-slate-400"}`}>{title}</div>
                <div className="text-[11.5px] text-slate-500">{sub}</div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
