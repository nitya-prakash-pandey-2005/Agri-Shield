import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DOCS, docBySlug } from "@/components/docs/registry";
import { Markdown, headings } from "@/components/docs/Markdown";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = docBySlug(slug);
  if (!doc) return {};
  return { title: doc.title, description: doc.summary, alternates: { canonical: `/docs/${doc.slug}` } };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = docBySlug(slug);
  if (!doc) notFound();
  const idx = DOCS.indexOf(doc);
  const prev = DOCS[idx - 1];
  const next = DOCS[idx + 1];
  const toc = headings(doc.body);

  return (
    <div className="xl:flex xl:gap-10">
      <article className="min-w-0 max-w-3xl flex-1">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
          <Link href="/docs" className="hover:text-slate-300">
            Docs
          </Link>{" "}
          / <span>{doc.group}</span>
        </nav>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">{doc.title}</h1>
        <p className="mt-3 text-lg text-slate-400">{doc.summary}</p>
        <div className="mt-8">
          <Markdown source={doc.body} />
        </div>
        <nav aria-label="Previous and next" className="mt-14 grid gap-3 border-t border-white/[0.07] pt-6 sm:grid-cols-2">
          {prev ? (
            <Link href={`/docs/${prev.slug}`} className="group rounded-xl border border-white/[0.08] p-4 hover:border-white/20">
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <ArrowLeft size={13} aria-hidden /> Previous
              </span>
              <span className="mt-1 block text-slate-100">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/docs/${next.slug}`} className="group rounded-xl border border-white/[0.08] p-4 text-right hover:border-white/20">
              <span className="flex items-center justify-end gap-1 text-xs text-slate-500">
                Next <ArrowRight size={13} aria-hidden />
              </span>
              <span className="mt-1 block text-slate-100">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>
      {toc.length > 2 && (
        <aside className="sticky top-24 hidden h-fit w-56 shrink-0 xl:block" aria-label="On this page">
          <p className="text-xs font-medium text-slate-500">On this page</p>
          <ul className="mt-3 space-y-1.5 border-l border-white/[0.08] text-[13px]">
            {toc.map((h) => (
              <li key={h.id} className={h.level === 3 ? "pl-6" : "pl-3"}>
                <a href={`#${h.id}`} className="text-slate-400 hover:text-white">
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
