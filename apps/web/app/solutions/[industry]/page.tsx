import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarCheck, CheckCircle2, CircleAlert } from "lucide-react";
import { Faq, MarketingShell, PageHero, SectionTitle } from "@/components/marketing/MarketingShell";
import { INDUSTRIES, industryById } from "@/components/marketing/industries";
import { ScreenMock } from "@/components/marketing/ScreenMocks";
import { DemoLoginButton } from "@/components/marketing/DemoLoginButton";
import { RoiExample } from "@/components/marketing/RoiExample";

export const dynamicParams = false;

export function generateStaticParams() {
  return INDUSTRIES.map((i) => ({ industry: i.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ industry: string }> }): Promise<Metadata> {
  const { industry } = await params;
  const ind = industryById(industry);
  if (!ind) return { title: "Solutions" };
  return {
    title: `${ind.title} · Solutions`,
    description: `${ind.headline} ${ind.subhead}`.slice(0, 300),
    alternates: { canonical: `/solutions/${ind.id}` },
  };
}

export default async function SolutionPage({ params }: { params: Promise<{ industry: string }> }) {
  const { industry } = await params;
  const ind = industryById(industry);
  if (!ind) notFound();

  return (
    <MarketingShell>
      <PageHero eyebrow={`Solutions · ${ind.title}`} title={ind.headline} accent={ind.accent}>
        <p>{ind.subhead}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <DemoLoginButton demo={ind.demo} />
          <Link href={`/book-demo?industry=${ind.id}`} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/15 px-6 text-[15px] font-medium text-white hover:border-white/35">
            <CalendarCheck size={17} aria-hidden /> Book a demo
          </Link>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Demo signs you in as <span className="telemetry text-slate-400">{ind.demo.email}</span> · {ind.demo.who}. All demo data is illustrative.
        </p>
      </PageHero>

      <section aria-label="Outcomes" className="mx-auto max-w-7xl px-4 sm:px-6">
        <dl className="grid gap-3 sm:grid-cols-3">
          {ind.outcomes.map((o) => (
            <div key={o.label} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <dt className="sr-only">{o.label}</dt>
              <dd>
                <div className="font-display text-3xl font-semibold" style={{ color: ind.accent }}>
                  {o.value}
                </div>
                <div className="mt-1 text-sm text-slate-400">{o.label}</div>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="problem" className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
        <SectionTitle eyebrow="The problem" title={ind.problem.title} id="problem" />
        <ul className="space-y-3">
          {ind.problem.points.map((p) => (
            <li key={p} className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-[15px] leading-relaxed text-slate-300">
              <CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-400" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="jobs" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <SectionTitle eyebrow="Jobs to be done" title="What your team gets done with Agri-SHIELD" id="jobs" />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {ind.jobs.map((j, i) => (
            <div key={j.job} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="telemetry text-xs" style={{ color: ind.accent }}>
                {String(i + 1).padStart(2, "0")}
              </div>
              <h3 className="mt-1 font-display text-lg font-semibold text-white">{j.job}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{j.how}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="screens" className="border-y border-white/[0.05] bg-white/[0.015]">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <SectionTitle eyebrow="Product" title="The screens your team would use" id="screens">
            Miniatures of the real workspace, filled with this hour’s district risk from the platform. Open the demo workspace to use the full versions.
          </SectionTitle>
          <div className="mt-10 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {ind.screens.map((s) => (
              <ScreenMock key={s.kind} kind={s.kind} caption={s.caption} />
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="workflow" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionTitle eyebrow="Workflow" title="From sign-up to acting on a warning" id="workflow" />
        <ol className="mt-10 grid gap-4 md:grid-cols-4">
          {ind.workflow.map((w, i) => (
            <li key={w.title} className="relative rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <span className="grid h-8 w-8 place-items-center rounded-full text-sm font-semibold text-slate-950" style={{ background: ind.accent }}>
                {i + 1}
              </span>
              <h3 className="mt-3 font-display text-base font-semibold text-white">{w.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{w.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="roi" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <SectionTitle eyebrow="Return on investment" title="What it could be worth, with the maths shown" id="roi">
          Conservative defaults you can replace with your own loss history. Nothing here is a measured customer result.
        </SectionTitle>
        <div className="mt-8">
          <RoiExample industry={ind.id} scenario={ind.roiExample.scenario} inputs={ind.roiExample.inputs} plan={ind.roiExample.plan} />
        </div>
      </section>

      <section aria-labelledby="faq" className="mx-auto grid max-w-7xl gap-10 px-4 pb-20 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
        <SectionTitle eyebrow="FAQ" title={`Questions from ${ind.label.toLowerCase()}`} id="faq" />
        <Faq items={ind.faqs} />
      </section>

      <section aria-label="Get started" className="relative overflow-hidden border-t border-white/[0.05]">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(700px 300px at 20% 0%, ${ind.accent}22, transparent 60%)` }} />
        <div className="relative mx-auto flex max-w-7xl flex-col items-start gap-6 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold text-white sm:text-3xl">See it on your own locations.</h2>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-400">
              {["30-minute walkthrough on live data", "Sandbox workspace for your team", "Four-week pilot plan with success criteria"].map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-emerald-400" aria-hidden /> {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link href={`/book-demo?industry=${ind.id}`} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-[15px] font-semibold text-slate-950 hover:bg-emerald-400">
              Book a demo <ArrowRight size={16} aria-hidden />
            </Link>
            <DemoLoginButton demo={ind.demo} label="Try the demo" variant="ghost" />
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
