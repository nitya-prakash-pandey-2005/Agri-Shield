"use client";

/**
 * Interactive ROI calculator. Inputs live in the URL (shareable), outputs are
 * recomputed on every change by the pure model in ./roi.ts.
 */
import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Check, Link2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { computeRoi, fmtInput, fmtLine, fmtUsd, planAnnual, ROI_PLANS, ROI_PRESETS, type RoiField, type RoiIndustry } from "./roi";
import { INDUSTRIES } from "./industries";

function NumberField({ f, value, onChange }: { f: RoiField; value: number; onChange: (v: number) => void }) {
  const id = `roi-${f.key}`;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm text-slate-200">
          {f.label}
        </label>
        <span className="telemetry shrink-0 text-sm font-semibold text-white">{fmtInput(f.kind, value)}</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={f.min}
          max={f.max}
          step={f.step}
          value={Math.min(f.max, value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-2 flex-1 cursor-pointer accent-emerald-400"
          aria-describedby={`${id}-help`}
        />
        <input
          type="number"
          inputMode="decimal"
          min={f.min}
          step={f.kind === "pct" ? 0.1 : 1}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
          aria-label={`${f.label} (exact value)`}
          className="site-input !min-h-[36px] !w-28 !py-1 text-right text-sm"
        />
      </div>
      <p id={`${id}-help`} className="mt-1.5 text-xs leading-snug text-slate-500">
        {f.help}
      </p>
    </div>
  );
}

function Compare({ label, a, b, aLabel, bLabel }: { label: string; a: number; b: number; aLabel: string; bLabel: string }) {
  const max = Math.max(a, b, 1);
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      {[
        { v: a, l: aLabel, c: "#64748b" },
        { v: b, l: bLabel, c: "#34d399" },
      ].map((x) => (
        <div key={x.l} className="mt-1.5 grid grid-cols-[88px_1fr_64px] items-center gap-2 text-xs">
          <span className="text-slate-400">{x.l}</span>
          <div className="h-3 overflow-hidden rounded bg-white/[0.05]">
            <motion.div className="h-full rounded" style={{ background: x.c }} animate={{ width: `${(x.v / max) * 100}%` }} transition={{ type: "spring", stiffness: 160, damping: 24 }} />
          </div>
          <span className="telemetry text-right text-slate-200">{fmtUsd(x.v)}</span>
        </div>
      ))}
    </div>
  );
}

export function RoiCalculator({ initialIndustry, initialValues, initialPlan }: { initialIndustry: RoiIndustry; initialValues: Record<string, number>; initialPlan?: string }) {
  const [industry, setIndustry] = useState<RoiIndustry>(initialIndustry);
  const preset = ROI_PRESETS[industry];
  const [values, setValues] = useState<Record<string, number>>({ ...preset.defaults, ...initialValues });
  const [plan, setPlan] = useState(initialPlan && ROI_PLANS.some((p) => p.id === initialPlan) ? initialPlan : preset.defaultPlan);
  const [copied, setCopied] = useState(false);

  const switchIndustry = (id: RoiIndustry) => {
    setIndustry(id);
    setValues({ ...ROI_PRESETS[id].defaults });
    setPlan(ROI_PRESETS[id].defaultPlan);
  };

  const r = useMemo(() => computeRoi(industry, values, planAnnual(plan)), [industry, values, plan]);

  // keep the URL shareable
  useEffect(() => {
    const q = new URLSearchParams({ industry, plan });
    for (const f of preset.fields) q.set(f.key, String(values[f.key] ?? 0));
    window.history.replaceState(null, "", `/roi?${q}`);
  }, [industry, plan, values, preset.fields]);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Copy the address bar to share this scenario");
    }
  };

  const ind = INDUSTRIES.find((i) => i.id === industry)!;
  const kpis = [
    { l: "Total annual benefit", v: fmtUsd(r.totalBenefitUsd), tone: "#34d399" },
    { l: "Net of subscription", v: fmtUsd(r.netBenefitUsd), tone: r.netBenefitUsd >= 0 ? "#34d399" : "#f87171" },
    { l: "Return on subscription", v: fmtLine(r.lines[6]!), tone: "#f1f5f9" },
    { l: "Payback", v: fmtLine(r.lines[7]!), tone: "#f1f5f9" },
    { l: "Expected-loss reduction", v: fmtLine(r.lines[8]!), tone: "#f1f5f9" },
  ];

  return (
    <div>
      <div role="tablist" aria-label="Industry" className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none] sm:flex-wrap">
        {INDUSTRIES.map((i) => (
          <button
            key={i.id}
            role="tab"
            aria-selected={industry === i.id}
            onClick={() => switchIndustry(i.id)}
            className={cn("min-h-[44px] shrink-0 rounded-xl border px-3.5 text-sm transition-colors", industry === i.id ? "border-transparent font-semibold text-slate-950" : "border-white/10 text-slate-300 hover:border-white/25")}
            style={industry === i.id ? { background: i.accent } : undefined}
          >
            {i.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_1fr]">
        <section aria-label="Inputs" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-white">Your {ROI_PRESETS[industry].label.toLowerCase()} inputs</h2>
            <button type="button" onClick={() => setValues({ ...preset.defaults })} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-xs text-slate-400 hover:text-white">
              <RotateCcw size={13} aria-hidden /> Reset defaults
            </button>
          </div>
          {preset.fields.map((f) => (
            <NumberField key={f.key} f={f} value={values[f.key] ?? 0} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
          ))}
          <label className="block rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
            <span className="text-sm text-slate-200">Plan</span>
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className="site-input mt-2">
              {ROI_PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({fmtUsd(p.annualUsd)} / year)
                </option>
              ))}
            </select>
            <span className="mt-1.5 block text-xs text-slate-500">Monthly price × 12. Annual prepay is 10× monthly. Registered NGOs and co-operatives can pick the 50% rate.</span>
          </label>
        </section>

        <section aria-label="Results" aria-live="polite" className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.03] p-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {kpis.map((k, i) => (
                <div key={k.l} className={cn("rounded-xl border border-white/[0.06] bg-black/25 p-3", i === 0 && "col-span-2 sm:col-span-1")}>
                  <div className="text-[11px] text-slate-400">{k.l}</div>
                  <motion.div key={k.v} initial={{ opacity: 0.4, y: 3 }} animate={{ opacity: 1, y: 0 }} className="telemetry mt-1 text-lg font-semibold" style={{ color: k.tone }}>
                    {k.v}
                  </motion.div>
                </div>
              ))}
            </div>
            <div className="mt-5 space-y-4">
              <Compare label="Annual expected climate loss" a={r.baselineLossUsd} b={r.baselineLossUsd - r.avoidedLossUsd} aLabel="Today" bLabel="With warnings" />
              <Compare label="Benefit vs subscription" a={r.planCostUsd} b={r.totalBenefitUsd} aLabel="Subscription" bLabel="Benefit" />
            </div>

            <h3 className="mt-6 text-sm font-medium text-white">How each number is calculated</h3>
            <table className="mt-2 w-full text-left text-xs">
              <tbody>
                {[...r.lines, ...r.extras].map((l) => (
                  <tr key={l.label} className="border-t border-white/[0.05] align-top">
                    <th scope="row" className="py-2 pr-2 font-normal text-slate-300">
                      {l.label}
                      <div className="telemetry mt-0.5 text-[10.5px] text-slate-500">= {l.formula}</div>
                    </th>
                    <td className="telemetry whitespace-nowrap py-2 text-right text-slate-100">{fmtLine(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="mt-5 text-sm font-medium text-white">Assumptions</h3>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-slate-400">
              <li>Defaults are illustrative starting points, not measured customer results. Replace them with your own loss history.</li>
              {preset.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Link href={`/book-demo?industry=${industry}`} className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
                Validate this with your data
              </Link>
              <button type="button" onClick={share} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-sm text-white hover:border-white/35">
                {copied ? <Check size={15} className="text-emerald-400" aria-hidden /> : <Link2 size={15} aria-hidden />}
                {copied ? "Link copied" : "Share this scenario"}
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              See how {ind.label.toLowerCase()} use it:{" "}
              <Link href={`/solutions/${industry}`} className="text-emerald-300 hover:text-emerald-200">
                {ind.title} solution
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
