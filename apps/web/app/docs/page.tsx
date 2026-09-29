import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, BookOpen, Code2, FlaskConical, Scale, Sprout } from "lucide-react";
import { DOCS } from "@/components/docs/registry";

export const metadata: Metadata = {
  title: { absolute: "Documentation | Agri-SHIELD" },
  alternates: { canonical: "/docs" },
};

const GROUP_ICON: Record<string, typeof BookOpen> = {
  "Getting started": Sprout,
  Developers: Code2,
  Methodology: FlaskConical,
  Reference: BookOpen,
  Legal: Scale,
};

export default function DocsHome() {
  const groups = [...new Set(DOCS.map((d) => d.group))];
  return (
    <div>
      <p className="text-sm text-emerald-300/90">Documentation</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">Build on Agri-SHIELD</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-400">
        Guides for farmers, agencies and supply-chain teams; the REST, ML and webhook APIs; and exactly how every model and number works. Press <kbd className="telemetry rounded border border-white/15 px-1 text-sm">/</kbd> to search.
      </p>

      <div className="mt-10 grid gap-3 sm:grid-cols-3">
        {[
          { href: "/docs/getting-started", t: "Try the demo", d: "Demo accounts and what is live" },
          { href: "/docs/api-reference", t: "Call the API", d: "/api/v1/risk in one curl" },
          { href: "/docs/methodology-flood", t: "Check the science", d: "Model, evaluation, limits" },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="group rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-5 transition-colors hover:border-emerald-400/50">
            <div className="flex items-center justify-between font-medium text-white">
              {c.t}
              <ArrowUpRight size={16} className="text-emerald-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
            </div>
            <p className="mt-1 text-sm text-slate-400">{c.d}</p>
          </Link>
        ))}
      </div>

      {groups.map((g) => {
        const Icon = GROUP_ICON[g] ?? BookOpen;
        return (
          <section key={g} className="mt-12" aria-labelledby={`g-${g}`}>
            <h2 id={`g-${g}`} className="flex items-center gap-2 font-display text-xl font-semibold text-white">
              <Icon size={18} className="text-slate-500" aria-hidden /> {g}
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {DOCS.filter((d) => d.group === g).map((d) => (
                <li key={d.slug}>
                  <Link href={`/docs/${d.slug}`} className="block h-full rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-white/20">
                    <span className="block text-[15px] font-medium text-slate-100">{d.title}</span>
                    <span className="mt-1 block text-sm leading-snug text-slate-400">{d.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
