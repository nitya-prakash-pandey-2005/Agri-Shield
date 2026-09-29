"use client";

/** Worked ROI example for a solutions page — same model as /roi, with its formulas shown. */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { computeRoi, fmtInput, fmtLine, planAnnual, ROI_PLANS, ROI_PRESETS, type RoiIndustry } from "./roi";

export function RoiExample({ industry, scenario, inputs, plan }: { industry: RoiIndustry; scenario: string; inputs: Record<string, number>; plan: string }) {
  const preset = ROI_PRESETS[industry];
  const values = { ...preset.defaults, ...inputs };
  const r = computeRoi(industry, values, planAnnual(plan));
  const planLabel = ROI_PLANS.find((p) => p.id === plan)?.label ?? plan;
  const headline = [r.lines[3]!, r.lines[6]!, r.lines[7]!, r.lines[8]!];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <p className="text-xs uppercase tracking-wider text-slate-500">Worked example · illustrative</p>
        <h3 className="mt-1 font-display text-lg font-semibold text-white">{scenario}</h3>
        <dl className="mt-4 space-y-2 text-sm">
          {preset.fields.map((f) => (
            <div key={f.key} className="flex items-baseline justify-between gap-3 border-b border-white/[0.05] pb-2">
              <dt className="text-slate-400">{f.label}</dt>
              <dd className="telemetry shrink-0 text-slate-100">{fmtInput(f.kind, values[f.key] ?? 0)}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 pb-1">
            <dt className="text-slate-400">Plan</dt>
            <dd className="text-right text-slate-100">{planLabel}</dd>
          </div>
        </dl>
      </div>
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.03] p-5">
        <div className="grid grid-cols-2 gap-3">
          {headline.map((l) => (
            <div key={l.label} className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
              <div className="text-xs text-slate-400">{l.label}</div>
              <div className="telemetry mt-1 text-xl font-semibold text-white">{fmtLine(l)}</div>
            </div>
          ))}
        </div>
        <table className="mt-4 w-full text-left text-xs">
          <caption className="sr-only">How the numbers are calculated</caption>
          <tbody>
            {[...r.lines.slice(0, 3), ...r.extras].map((l) => (
              <tr key={l.label} className="border-t border-white/[0.05] align-top">
                <th scope="row" className="py-2 pr-2 font-normal text-slate-300">
                  {l.label}
                  <div className="telemetry mt-0.5 text-[10.5px] text-slate-500">= {l.formula}</div>
                </th>
                <td className="telemetry py-2 text-right text-slate-100">{fmtLine(l)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-3 list-disc space-y-1 pl-4 text-[11.5px] text-slate-500">
          {preset.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <Link href={`/roi?industry=${industry}`} className="mt-4 inline-flex items-center gap-1.5 text-sm text-emerald-300 hover:text-emerald-200">
          Change the assumptions in the ROI calculator <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
