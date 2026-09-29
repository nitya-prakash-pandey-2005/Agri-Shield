"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { cn } from "@/lib/utils";

export const fmt = {
  n: (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })),
  pct: (p: number | null | undefined) => (p == null ? "–" : `${Math.round(p * 100)}%`),
  signed: (v: number | null | undefined, d = 0, unit = "") => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}${unit}`),
  date: (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
};

export function Block({ title, subtitle, children, className, actions }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-xl border border-white/[0.06] bg-white/[0.015] p-3.5", className)}>
      <header className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-[13px] font-semibold text-slate-100">{title}</h3>
          {subtitle && <p className="text-[11.5px] leading-snug text-slate-500">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Metric({ label, value, unit, sub, term, help, tone, className }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; term?: string; help?: ReactNode; tone?: string; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-white/[0.05] bg-slate-950/40 px-3 py-2", className)}>
      <div className="flex items-center gap-1 text-[10.5px] uppercase tracking-wider text-slate-500">
        {label}
        {(term || help) && <Explain term={term} text={help} title={term ? undefined : label} />}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="telemetry text-lg font-semibold" style={{ color: tone ?? "#f1f5f9" }}>
          {value}
        </span>
        {unit && <span className="text-[11px] text-slate-500">{unit}</span>}
      </div>
      {sub && <div className="text-[11px] leading-snug text-slate-400">{sub}</div>}
    </div>
  );
}

export function Computing({ label, detail }: { label: string; detail?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.05] px-3 py-2.5 text-[12px] text-cyan-100">
      <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-cyan-300" />
      <div>
        <div className="font-medium">{label}</div>
        {detail && <div className="mt-0.5 text-[11.5px] text-cyan-100/70">{detail}</div>}
      </div>
    </div>
  );
}

export function Unavailable({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-white/[0.06] bg-slate-900/40 px-3 py-2.5 text-[12px] text-slate-400">{children}</div>;
}

export function Sources({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <span className="text-[10px] uppercase tracking-wider text-slate-600">Sources</span>
      {items.map((s) => (
        <SourceTag key={s.label} href={s.href}>
          {s.label}
        </SourceTag>
      ))}
    </div>
  );
}

export function Bar2({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, (value / max) * 100))}%`, background: color }} />
    </div>
  );
}

export function Table({ head, rows, className }: { head: ReactNode[]; rows: ReactNode[][]; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-white/5 text-left text-[10.5px] uppercase tracking-wider text-slate-500">
            {head.map((h, i) => (
              <th key={i} className={cn("py-1.5 pr-3 font-medium", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/[0.03]">
              {r.map((c, j) => (
                <td key={j} className={cn("py-1.5 pr-3 text-slate-300", j > 0 && "telemetry text-right")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
