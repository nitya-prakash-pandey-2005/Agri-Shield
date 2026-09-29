import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingShell, PageHero } from "@/components/marketing/MarketingShell";
import { INDUSTRIES } from "@/components/marketing/industries";

export const metadata: Metadata = {
  title: "Solutions",
  description: "Agri-SHIELD for insurers, banks and MFIs, agribusiness, governments, NGOs, co-operatives and farmers.",
  alternates: { canonical: "/solutions" },
};

export default function SolutionsIndex() {
  return (
    <MarketingShell>
      <PageHero eyebrow="Solutions" title="Built for every organisation that carries farm risk.">
        One climate-risk engine, with workflows shaped for how each kind of organisation makes decisions.
      </PageHero>
      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INDUSTRIES.map((i) => (
            <li key={i.id}>
              <Link href={`/solutions/${i.id}`} className="group flex h-full flex-col rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors hover:border-white/25">
                <span className="text-sm" style={{ color: i.accent }}>
                  {i.title}
                </span>
                <span className="mt-2 font-display text-lg font-semibold leading-snug text-white">{i.headline}</span>
                <span className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">{i.outcomes.map((o) => `${o.value} ${o.label}`).join(" · ")}</span>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm text-emerald-300">
                  Explore <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </MarketingShell>
  );
}
