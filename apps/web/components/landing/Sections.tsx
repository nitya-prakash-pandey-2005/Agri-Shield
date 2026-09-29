"use client";

/** Smaller landing sections: live demo wrapper, pricing teaser, demo request. */
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { LiveDemoMap } from "./LiveDemoMap";
import { LeadForm } from "./LeadForm";

export function DemoMapSection() {
  return (
    <section id="demo" aria-labelledby="demo-title" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <p className="text-sm text-sky-300/90">Live demo, no sign-in</p>
          <h2 id="demo-title" className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            Today’s risk across five deltas.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">
            Every polygon is scored from this hour’s Open-Meteo forecast and Copernicus GloFAS river discharge. Switch between flood and salinity, overlay NASA’s satellite rain rate, and open any district for the numbers behind its colour.
          </p>
        </div>
      </div>
      <div className="mt-10">
        <LiveDemoMap />
      </div>
    </section>
  );
}

const TEASER = [
  { name: "Farmer Basic", price: "Free", unit: "forever", points: ["Flood alerts 24 h ahead", "2 fields, SMS + app"], href: "/auth/signup?role=farmer", cta: "Start free" },
  { name: "Farmer Pro", price: "₹199", unit: "per month · $3", points: ["Flood + salinity, 72 h ahead", "AI advisor in 8 languages"], href: "/pricing?plan=farmer_pro", cta: "Try 14 days free", highlight: true },
  { name: "Agencies & supply chains", price: "$299", unit: "from, per month", points: ["Regional command dashboard", "API, webhooks, scenarios"], href: "/pricing", cta: "Compare plans" },
];

export function PricingTeaser() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32">
      <div className="max-w-2xl">
        <p className="text-sm text-emerald-300/90">Pricing</p>
        <h2 id="pricing-title" className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
          Free for the farmer. Paid by those who plan.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">Every paid plan starts with a 14-day trial and no card. Prices shown in local currency on the pricing page.</p>
      </div>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {TEASER.map((t) => (
          <div key={t.name} className={`relative flex flex-col rounded-2xl border p-6 ${t.highlight ? "border-emerald-400/40 bg-emerald-400/[0.05] shadow-[0_0_60px_-30px_rgba(52,211,153,0.8)]" : "border-white/[0.08] bg-white/[0.02]"}`}>
            {t.highlight && <span className="absolute -top-3 left-6 rounded-full bg-emerald-400 px-2.5 py-0.5 text-[11px] font-semibold text-slate-950">Most farmers choose this</span>}
            <h3 className="text-sm text-slate-300">{t.name}</h3>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-4xl font-semibold tracking-tight text-white">{t.price}</span>
              <span className="text-sm text-slate-500">{t.unit}</span>
            </div>
            <ul className="mt-5 space-y-2">
              {t.points.map((p) => (
                <li key={p} className="flex items-start gap-2 text-sm text-slate-300">
                  <Check size={15} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
            <Link href={t.href} className={`mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-sm font-semibold ${t.highlight ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400" : "border border-white/15 text-white hover:border-white/30"}`}>
              {t.cta}
            </Link>
          </div>
        ))}
      </div>
      <Link href="/pricing" className="mt-6 inline-flex items-center gap-2 text-sm text-emerald-300 hover:text-emerald-200">
        See the full feature comparison <ArrowRight size={15} aria-hidden />
      </Link>
    </section>
  );
}

export function RequestDemoSection() {
  return (
    <section id="request-demo" aria-labelledby="request-title" className="relative scroll-mt-20 overflow-hidden border-t border-white/[0.05]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_400px_at_20%_0%,rgba(16,185,129,0.12),transparent_60%)]" />
      <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="text-sm text-emerald-300/90">For ministries, disaster agencies and buyers</p>
          <h2 id="request-title" className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            See your own provinces on the map.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-400 sm:text-lg">
            A 30-minute walkthrough on live data for the districts you manage: risk ranking, resource pre-positioning and the alert broadcast console.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            {["Configured for your districts before the call", "Sandbox logins for your team afterwards", "Data-sharing and hosting options for government networks"].map((x) => (
              <li key={x} className="flex gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden /> {x}
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm text-slate-500">
            Prefer to explore first? Press <kbd className="telemetry rounded border border-white/15 px-1">⌘K</kbd> and choose “Sign in as government officer”.
          </p>
        </div>
        <div className="hud-panel p-5 sm:p-8">
          <LeadForm source="landing" />
        </div>
      </div>
    </section>
  );
}
