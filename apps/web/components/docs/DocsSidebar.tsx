"use client";

/** Docs sidebar with client-side full-text filter (press / to focus). */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Menu, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchEntry } from "./registry";

function snippet(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return null;
  const start = Math.max(0, i - 40);
  return (start > 0 ? "…" : "") + text.slice(start, i + q.length + 60).trim() + "…";
}

export function DocsSidebar({ index }: { index: SearchEntry[] }) {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !t.closest("input, textarea")) {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return null;
    return index
      .map((d) => {
        const inTitle = d.title.toLowerCase().includes(term) ? 3 : 0;
        const inSummary = d.summary.toLowerCase().includes(term) ? 2 : 0;
        const inText = d.text.toLowerCase().includes(term) ? 1 : 0;
        return { d, score: inTitle + inSummary + inText, snip: inTitle || inSummary ? d.summary : snippet(d.text, term) };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [q, index]);

  const groups = useMemo(() => {
    const m = new Map<string, SearchEntry[]>();
    index.forEach((d) => m.set(d.group, [...(m.get(d.group) ?? []), d]));
    return [...m.entries()];
  }, [index]);

  const nav = (
    <div className="flex h-full flex-col">
      <label className="relative block">
        <span className="sr-only">Search documentation</span>
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search docs" className="site-input !pl-9 !pr-8" />
        <kbd className="telemetry pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-white/10 px-1 text-[10px] text-slate-500">/</kbd>
      </label>
      <nav aria-label="Documentation" className="mt-5 flex-1 overflow-y-auto pb-8">
        {results ? (
          <div>
            <p className="px-2 text-xs text-slate-500" role="status">
              {results.length} result{results.length === 1 ? "" : "s"} for “{q}”
            </p>
            <ul className="mt-2 space-y-1">
              {results.map(({ d, snip }) => (
                <li key={d.slug}>
                  <Link href={`/docs/${d.slug}`} onClick={() => setQ("")} className="block rounded-lg px-2 py-2 hover:bg-white/[0.04]">
                    <span className="block text-sm text-slate-100">{d.title}</span>
                    {snip && <span className="mt-0.5 block text-xs leading-snug text-slate-500">{snip}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <Link href="/docs" className={cn("mb-3 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm", pathname === "/docs" ? "bg-emerald-400/10 text-emerald-200" : "text-slate-300 hover:text-white")}>
              <BookOpen size={15} aria-hidden /> Documentation home
            </Link>
            {groups.map(([g, items]) => (
              <div key={g} className="mb-5">
                <h2 className="px-2 text-xs font-medium text-slate-500">{g}</h2>
                <ul className="mt-1.5 space-y-0.5">
                  {items.map((d) => {
                    const active = pathname === `/docs/${d.slug}`;
                    return (
                      <li key={d.slug}>
                        <Link href={`/docs/${d.slug}`} aria-current={active ? "page" : undefined} className={cn("block rounded-lg border-l-2 px-2 py-1.5 text-sm transition-colors", active ? "border-emerald-400 bg-emerald-400/[0.07] text-white" : "border-transparent text-slate-400 hover:text-white")}>
                          {d.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </>
        )}
      </nav>
    </div>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mb-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/10 px-3 text-sm text-slate-300 lg:hidden" aria-expanded={open} aria-controls="docs-drawer">
        <Menu size={16} /> Browse docs
      </button>
      <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] w-64 shrink-0 lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-[1000] lg:hidden" role="dialog" aria-modal="true" aria-label="Documentation navigation">
          <button className="absolute inset-0 bg-black/60" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div id="docs-drawer" className="absolute inset-y-0 left-0 w-[86%] max-w-xs border-r border-white/10 bg-[#060b17] p-4 pt-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display font-semibold text-white">Docs</span>
              <button onClick={() => setOpen(false)} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-white/5">
                <X size={18} />
              </button>
            </div>
            {nav}
          </div>
        </div>
      )}
    </>
  );
}
