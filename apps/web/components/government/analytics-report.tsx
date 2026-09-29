"use client";

/** PDF report builder panel — choose sections, generate a ministry-submission PDF. */
import { useState } from "react";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { HudButton, Panel } from "@/components/hud";
import { cn } from "@/lib/utils";
import { useGovInput } from "./scope";
import { Field, inputCls } from "./ui";
import { generateReport, REPORT_SECTIONS, type ReportSection } from "./pdf-report";

export function ReportBuilder() {
  const scope = useGovInput();
  const utils = trpc.useUtils();
  const { data: session } = useSession();
  const [title, setTitle] = useState("Climate Risk & Early Warning Report");
  const [recipient, setRecipient] = useState("Ministry submission");
  const [sections, setSections] = useState<ReportSection[]>(["cover", "districts", "seasons", "response", "utilisation", "hotspots", "briefs", "gaps"]);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  const toggle = (k: ReportSection) => setSections((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const needs = (...ks: ReportSection[]) => ks.some((k) => sections.includes(k));

  const run = async () => {
    setBusy(true);
    try {
      const [context, overview, regionMap, analytics, briefs, gaps] = await Promise.all([
        utils.government.getContext.fetch(scope),
        utils.government.getOverview.fetch(scope),
        utils.government.getRegionMap.fetch(scope),
        needs("seasons", "response", "utilisation", "hotspots") ? utils.government.getAnalytics.fetch(scope) : Promise.resolve(undefined),
        needs("briefs") ? utils.government.getPolicyBriefs.fetch(scope) : Promise.resolve(undefined),
        needs("gaps") ? utils.government.getInfrastructureGaps.fetch(scope) : Promise.resolve(undefined),
      ]);
      const file = await generateReport({
        title: title.trim() || "Climate Risk Report",
        recipient: recipient.trim() || "Ministry submission",
        preparedBy: session?.user?.name ?? "Government operations desk",
        sections: REPORT_SECTIONS.map((s) => s.key).filter((k) => sections.includes(k)),
        context,
        overview,
        regionMap,
        analytics,
        briefs,
        gaps,
      });
      setLast(file);
      toast.success("Report generated", { description: file });
    } catch (e) {
      toast.error(`Report failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="PDF report builder" subtitle="Branded A4 report for ministry submission" icon={FileText} accent="emerald" className="h-full">
      <div className="space-y-3">
        <Field label="Report title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} maxLength={90} />
        </Field>
        <Field label="Recipient">
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} className={inputCls} maxLength={90} />
        </Field>
        <div>
          <div className="hud-label mb-1.5">Sections</div>
          <div className="grid grid-cols-2 gap-1.5">
            {REPORT_SECTIONS.map((s) => {
              const on = sections.includes(s.key);
              return (
                <button
                  key={s.key}
                  onClick={() => toggle(s.key)}
                  className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[11.5px] transition active:scale-[0.98]", on ? "border-emerald-500/50 bg-emerald-500/10 text-slate-100" : "border-white/5 text-slate-400 hover:border-white/15")}
                  aria-pressed={on}
                >
                  <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-emerald-400 bg-emerald-500 text-slate-950" : "border-slate-600")}>{on && <Check size={11} strokeWidth={3} />}</span>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
        <HudButton onClick={run} disabled={busy || !sections.length} className="w-full">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {busy ? "Compiling live data…" : `Generate PDF (${sections.length} sections)`}
        </HudButton>
        <AnimatePresence>
          {last && !busy && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
              <Check size={13} /> <span className="truncate telemetry">{last}</span>
            </motion.div>
          )}
        </AnimatePresence>
        <p className="text-[10.5px] leading-relaxed text-slate-500">Compiled at generation time from the live registry and open-data overlays. Footer on every page cites Open-Meteo, GloFAS, ERA5, GDACS and NASA EONET.</p>
      </div>
    </Panel>
  );
}
