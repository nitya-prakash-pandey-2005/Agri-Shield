import Link from "next/link";
import { ArrowRight, Megaphone, Sparkles, Wrench, Zap } from "lucide-react";
import { CHANGELOG } from "@/components/help/articles";

const TAG = {
  new: { label: "New", icon: Sparkles, cls: "bg-cyan-500/15 text-cyan-200" },
  improved: { label: "Improved", icon: Zap, cls: "bg-emerald-500/15 text-emerald-200" },
  fixed: { label: "Fixed", icon: Wrench, cls: "bg-amber-500/15 text-amber-200" },
} as const;

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-12 sm:px-6">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
        <Megaphone size={13} /> Changelog
      </div>
      <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">What's new in Agri-SHIELD</h1>
      <p className="mt-2 text-slate-400">Product updates, newest first.</p>
      <ol className="relative mt-10 border-l border-white/10 pl-6">
        {CHANGELOG.map((c) => {
          const t = TAG[c.tag];
          return (
            <li key={c.version} id={`v${c.version}`} className="mb-12 scroll-mt-24">
              <span className="absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-[#050a14] bg-cyan-400 shadow-[0_0_12px_rgba(56,189,248,0.8)]" />
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <time dateTime={c.date} className="text-slate-400">
                  {new Date(`${c.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
                </time>
                <span className="telemetry rounded bg-white/5 px-1.5 py-0.5 text-slate-300">v{c.version}</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${t.cls}`}>
                  <t.icon size={11} /> {t.label}
                </span>
              </div>
              <h2 className="mt-2 font-display text-xl font-semibold text-white">{c.title}</h2>
              <ul className="mt-3 space-y-2">
                {c.items.map((i) => (
                  <li key={i} className="flex gap-2.5 text-[14.5px] leading-relaxed text-slate-300">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/80" />
                    {i}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-sm text-slate-300">
        Want something built? <Link href="/help#contact" className="inline-flex items-center gap-1 text-cyan-300 hover:underline">Tell us <ArrowRight size={13} /></Link>
      </div>
    </div>
  );
}
