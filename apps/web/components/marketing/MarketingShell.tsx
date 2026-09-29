import type { ReactNode } from "react";
import "@/components/landing/landing.css";
import { SiteNav } from "@/components/landing/SiteNav";
import { SiteFooter } from "@/components/landing/SiteFooter";

/** Public marketing page chrome (nav, footer, dark site surface). */
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell min-h-screen overflow-x-clip">
      <SiteNav />
      <main id="main" className="pt-16">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/** Page hero used by the solutions / roi / compare / customers / book-demo pages. */
export function PageHero({ eyebrow, title, children, accent = "#34d399" }: { eyebrow: string; title: ReactNode; children?: ReactNode; accent?: string }) {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="site-grid pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-20 h-[520px] w-[520px] rounded-full opacity-60" style={{ background: `radial-gradient(circle, ${accent}22, transparent 65%)` }} />
      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-14 sm:px-6 sm:pt-20">
        <p className="site-in text-sm" style={{ color: accent }}>
          {eyebrow}
        </p>
        <h1 className="site-in mt-3 max-w-4xl font-display text-[2.2rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl" style={{ animationDelay: "60ms" }}>
          {title}
        </h1>
        {children && (
          <div className="site-in mt-5 max-w-3xl text-base leading-relaxed text-slate-400 sm:text-lg" style={{ animationDelay: "120ms" }}>
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

export function SectionTitle({ eyebrow, title, children, id }: { eyebrow?: string; title: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <div className="max-w-3xl">
      {eyebrow && <p className="text-sm text-emerald-300/90">{eyebrow}</p>}
      <h2 id={id} className="mt-2 font-display text-2xl font-semibold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      {children && <div className="mt-4 text-base leading-relaxed text-slate-400">{children}</div>}
    </div>
  );
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
      {items.map((f) => (
        <details key={f.q} className="group py-1">
          <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-4 text-[15px] text-slate-100 [&::-webkit-details-marker]:hidden">
            {f.q}
            <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 text-slate-400 transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="pb-4 text-sm leading-relaxed text-slate-400">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
