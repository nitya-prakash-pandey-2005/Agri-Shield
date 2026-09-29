"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Link2, Search } from "lucide-react";
import { toast } from "sonner";
import { GLOSSARY, GLOSSARY_CATEGORIES, searchGlossary, type GlossaryCategory } from "@/components/help/glossary";
import { cn } from "@/lib/utils";

export default function GlossaryPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<GlossaryCategory | "all">("all");
  const [hash, setHash] = useState("");
  const dq = useDeferredValue(q);

  useEffect(() => {
    const h = decodeURIComponent(window.location.hash.slice(1));
    setHash(h);
    if (h) setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
  }, []);

  const entries = useMemo(
    () =>
      searchGlossary(dq)
        .filter((e) => cat === "all" || e.category === cat)
        .sort((a, b) => (dq ? 0 : a.title.localeCompare(b.title))),
    [dq, cat]
  );
  const letters = useMemo(() => [...new Set(entries.map((e) => e.title[0]!.toUpperCase()))], [entries]);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-10 sm:px-6">
      <Link href="/help" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
        <ArrowLeft size={14} /> Help centre
      </Link>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-white">Glossary</h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            {Object.keys(GLOSSARY).length} climate, insurance and finance terms in plain language. These are the same explanations you see when you hover an <span className="text-cyan-300">ⓘ</span> in the app.
          </p>
        </div>
        <label className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms…" className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/70 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none" aria-label="Search glossary" />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5" role="tablist">
        {(["all", ...Object.keys(GLOSSARY_CATEGORIES)] as (GlossaryCategory | "all")[]).map((c) => (
          <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={cn("rounded-full border px-3 py-1 text-[12.5px] transition-colors", cat === c ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100" : "border-white/10 text-slate-400 hover:text-white")}>
            {c === "all" ? "All" : GLOSSARY_CATEGORIES[c]}
          </button>
        ))}
      </div>

      {!dq && (
        <div className="mt-4 flex flex-wrap gap-1 text-[12px]">
          {letters.map((l) => (
            <a key={l} href={`#letter-${l}`} className="grid h-7 w-7 place-items-center rounded-md border border-white/5 text-slate-400 hover:border-cyan-400/40 hover:text-white">
              {l}
            </a>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {entries.length === 0 && <div className="col-span-2 rounded-xl border border-white/10 p-6 text-center text-sm text-slate-400">No terms match “{q}”.</div>}
        {entries.map((e, i) => {
          const first = !dq && (i === 0 || entries[i - 1]!.title[0]!.toUpperCase() !== e.title[0]!.toUpperCase());
          return (
            <article
              key={e.key}
              id={e.key}
              className={cn("relative scroll-mt-28 rounded-2xl border bg-white/[0.02] p-4 transition-colors", hash === e.key ? "border-cyan-400/60 shadow-[0_0_30px_-12px_rgba(56,189,248,0.8)]" : "border-white/10")}
            >
              {first && <span id={`letter-${e.title[0]!.toUpperCase()}`} className="absolute -top-24" />}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-cyan-300/70">{GLOSSARY_CATEGORIES[e.category]}</div>
                  <h2 className="mt-0.5 font-display text-[16px] font-semibold text-white">{e.title}</h2>
                </div>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/help/glossary#${e.key}`;
                    void navigator.clipboard?.writeText(url).then(() => toast.success("Link copied"));
                    history.replaceState(null, "", `#${e.key}`);
                    setHash(e.key);
                  }}
                  className="p-1 text-slate-500 hover:text-cyan-300"
                  aria-label={`Copy link to ${e.title}`}
                >
                  <Link2 size={14} />
                </button>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-200">{e.short}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{e.body}</p>
              {e.example && (
                <p className="mt-2 rounded-lg bg-slate-900/70 px-3 py-2 text-[12.5px] text-slate-300">
                  <span className="text-slate-500">Example: </span>
                  {e.example}
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {e.unit && <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-400">Unit: {e.unit}</span>}
                {e.related?.map((r) =>
                  GLOSSARY[r] ? (
                    <a key={r} href={`#${r}`} onClick={() => setHash(r)} className="inline-flex items-center gap-1 rounded bg-cyan-500/10 px-1.5 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/20">
                      <BookOpen size={10} /> {GLOSSARY[r]!.title.split(" (")[0]}
                    </a>
                  ) : null
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
