"use client";

/** Physical-risk disclosure (TCFD / IFRS S2 structure) — preview + multi-page PDF. */
import { useState } from "react";
import { BookOpen, FileDown, FileText, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Panel, Skeleton } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, ErrorBox, pct, usd, WhatThisMeans } from "@/components/insurance/kit";
import { trpc } from "@/lib/trpc";
import { disclosurePdf } from "./disclosurePdf";

const SECTIONS = [
  ["1. Executive summary", "Headline exposure, PD and expected-loss uplift from physical hazards."],
  ["2. Governance", "Placeholder for board and management oversight — written by your team."],
  ["3. Strategy", "Hazards, concentration by region and crop, scenario resilience."],
  ["4. Risk management", "How risks are identified, assessed and managed; exposure bands; watchlist."],
  ["5. Metrics & targets", "Assets vulnerable to physical risk; space for your targets."],
  ["6. Methodology & limitations", "Formulas, parameters, data sources, caveats."],
] as const;

export default function Disclosure({ preparedBy }: { preparedBy: string }) {
  const [want, setWant] = useState(true);
  const d = trpc.finance.disclosure.useQuery(undefined, { enabled: want, staleTime: 10 * 60_000 });
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    setWant(true);
    const r = d.data ?? (await d.refetch()).data;
    if (!r) return;
    setBusy(true);
    try {
      await disclosurePdf(r, preparedBy);
      toast.success("Disclosure report downloaded");
    } finally {
      setBusy(false);
    }
  };
  const s = d.data?.summary;
  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
      <Panel title={<>Physical climate-risk disclosure <Explain term="tcfd" /></>} subtitle="TCFD-recommendation and IFRS S2-aligned structure · multi-page PDF" icon={FileText} accent="cyan" actions={<Btn loading={busy || d.isFetching} onClick={gen}><FileDown size={13} /> Generate PDF</Btn>}>
        <div className="space-y-2">
          {SECTIONS.map(([h, b]) => (
            <div key={h} className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2">
              <div className="text-[13px] font-medium text-slate-100">{h}</div>
              <div className="text-[12px] text-slate-400">{b}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-400/[0.06] px-3 py-2 text-[12px] text-rose-200">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          Decision-support analysis — not audited and not an assurance engagement. Governance and targets sections are left for your institution to complete.
        </div>
      </Panel>
      <div className="space-y-4">
        <ErrorBox error={d.error} onRetry={() => d.refetch()} />
        {want && !s && <Skeleton className="h-64" />}
        {s ? (
          <Panel title="Report preview — key figures" icon={BookOpen} accent="cyan">
            <div className="grid grid-cols-2 gap-2 text-[12.5px]">
              <Fig k="EAD in scope" v={usd(s.eadUsd)} />
              <Fig k="Weighted PD" v={`${pct(s.pdBasePct, 2)} → ${pct(s.pdClimatePct, 2)}`} />
              <Fig k="Expected loss (12 m)" v={`${usd(s.elBaseUsd)} → ${usd(s.elUsd)}`} />
              <Fig k="Climate downgrades" v={`${s.downgraded} loans`} />
              {d.data!.bands.map((b) => (
                <Fig key={b.band} k={b.band} v={`${b.loans} loans · ${usd(b.eadUsd)}`} />
              ))}
            </div>
            <WhatThisMeans className="mt-3">
              The PDF packages these numbers with the stress tests, watchlist and full methodology so your risk team can drop them into a TCFD/ISSB report. Every figure is reproducible from the Credit risk and Stress tests tabs.
            </WhatThisMeans>
          </Panel>
        ) : (
          !want && (
            <Panel accent="cyan">
              <p className="text-[13px] text-slate-400">Click “Generate PDF” to compute the disclosure pack (credit overlay + all five stress scenarios) and download it. It takes a few seconds.</p>
            </Panel>
          )
        )}
      </div>
    </div>
  );
}

function Fig({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-slate-900/60 px-2.5 py-2">
      <div className="text-[10.5px] text-slate-500">{k}</div>
      <div className="telemetry text-slate-100">{v}</div>
    </div>
  );
}
