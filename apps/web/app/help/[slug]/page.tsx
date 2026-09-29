import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock, Lightbulb } from "lucide-react";
import { HELP_ARTICLES } from "@/components/help/articles";

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = HELP_ARTICLES.find((x) => x.slug === slug);
  return a ? { title: a.title, description: a.summary } : { title: "Not found" };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = HELP_ARTICLES.find((x) => x.slug === slug);
  if (!a) notFound();
  const related = HELP_ARTICLES.filter((x) => x.category === a.category && x.slug !== a.slug).slice(0, 3);
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6">
      <Link href="/help" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
        <ArrowLeft size={14} /> Help centre
      </Link>
      <div className="mt-6 text-xs uppercase tracking-wider text-cyan-300/80">{a.category}</div>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white">{a.title}</h1>
      <p className="mt-2 text-slate-400">{a.summary}</p>
      <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500">
        <Clock size={12} /> {a.minutes}-minute read
      </div>
      <article className="mt-8 space-y-5">
        {a.body.map((b, i) => (
          <section key={i}>
            {b.h && <h2 className="mb-2 font-display text-lg font-semibold text-white">{b.h}</h2>}
            {b.p && <p className="text-[15px] leading-relaxed text-slate-300">{b.p}</p>}
            {b.list && (
              <ul className="mt-2 space-y-1.5">
                {b.list.map((l) => (
                  <li key={l} className="flex gap-2 text-[14.5px] leading-relaxed text-slate-300">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                    {l}
                  </li>
                ))}
              </ul>
            )}
            {b.steps && (
              <ol className="mt-2 space-y-2">
                {b.steps.map((s, k) => (
                  <li key={s} className="flex gap-3 text-[14.5px] leading-relaxed text-slate-300">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-500/15 text-xs font-semibold text-cyan-300">{k + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            )}
            {b.tip && (
              <div className="mt-2 flex gap-2.5 rounded-xl border border-amber-400/25 bg-amber-500/[0.06] p-3.5 text-[14px] text-amber-100">
                <Lightbulb size={16} className="mt-0.5 shrink-0 text-amber-300" />
                {b.tip}
              </div>
            )}
            {b.link && (
              <Link href={b.link.href} className="mt-2 inline-flex items-center gap-1 text-sm text-cyan-300 hover:underline">
                {b.link.label} <ArrowRight size={13} />
              </Link>
            )}
          </section>
        ))}
      </article>
      <div className="mt-12 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="text-sm text-slate-300">Still stuck?</div>
        <Link href="/help#contact" className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-cyan-300 hover:underline">
          Contact support <ArrowRight size={13} />
        </Link>
      </div>
      {related.length > 0 && (
        <div className="mt-8">
          <div className="text-xs uppercase tracking-wider text-slate-500">Related</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {related.map((r) => (
              <Link key={r.slug} href={`/help/${r.slug}`} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-slate-200 hover:border-cyan-400/40">
                {r.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
