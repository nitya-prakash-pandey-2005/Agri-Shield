"use client";

/**
 * B2B narrative for the landing page: who it's for (industry switcher),
 * explore-any-location CTA, capability map, data credibility, trust strip,
 * and the 4-week rollout timeline.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Bell,
  Bot,
  Building2,
  CalendarCheck,
  Compass,
  Database,
  FileText,
  HandHeart,
  KeyRound,
  Landmark,
  Layers,
  Lock,
  MapPin,
  Satellite,
  Search,
  ShieldCheck,
  Sprout,
  Truck,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { INDUSTRIES, type IndustryId } from "@/components/marketing/industries";
import { ScreenMock } from "@/components/marketing/ScreenMocks";
import { DemoLoginButton } from "@/components/marketing/DemoLoginButton";
import { cn } from "@/lib/utils";

const IND_ICON: Record<IndustryId, LucideIcon> = {
  insurance: ShieldCheck,
  banking: Landmark,
  agribusiness: Truck,
  government: Building2,
  ngo: HandHeart,
  cooperative: Users,
  farmers: Sprout,
};

export function IndustrySwitcher() {
  const [active, setActive] = useState<IndustryId>("insurance");
  const ind = INDUSTRIES.find((i) => i.id === active)!;
  return (
    <section id="who" aria-labelledby="who-title" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28">
      <div className="max-w-3xl">
        <p className="text-sm text-sky-300/90">Who it’s for</p>
        <h2 id="who-title" className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
          One risk engine. A workspace for every organisation that carries farm risk.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">Pick your organisation to see the outcomes, the screens your team would use and a live demo workspace.</p>
      </div>

      <div role="tablist" aria-label="Industry" className="mt-10 flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none] sm:flex-wrap">
        {INDUSTRIES.map((i) => {
          const Icon = IND_ICON[i.id];
          const on = i.id === active;
          return (
            <button
              key={i.id}
              role="tab"
              id={`tab-${i.id}`}
              aria-selected={on}
              aria-controls="industry-panel"
              onClick={() => setActive(i.id)}
              className={cn("relative inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border px-3.5 text-sm transition-colors", on ? "border-transparent text-slate-950" : "border-white/10 text-slate-300 hover:border-white/25 hover:text-white")}
            >
              {on && <motion.span layoutId="ind-pill" className="absolute inset-0 rounded-xl" style={{ background: i.accent }} transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
              <Icon size={15} className="relative" aria-hidden />
              <span className="relative font-medium">{i.label}</span>
            </button>
          );
        })}
      </div>

      <div id="industry-panel" role="tabpanel" aria-labelledby={`tab-${active}`} className="mt-6">
        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }} className="grid gap-6 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-8 lg:grid-cols-[1fr_1.05fr]">
            <div className="min-w-0">
              <p className="text-sm" style={{ color: ind.accent }}>
                {ind.title}
              </p>
              <h3 className="mt-2 font-display text-2xl font-semibold leading-tight text-white sm:text-3xl">{ind.headline}</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-400 sm:text-base">{ind.subhead}</p>
              <dl className="mt-6 grid gap-3 sm:grid-cols-3">
                {ind.outcomes.map((o) => (
                  <div key={o.label} className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
                    <dt className="sr-only">{o.label}</dt>
                    <dd>
                      <div className="font-display text-xl font-semibold text-white">{o.value}</div>
                      <div className="mt-1 text-xs leading-snug text-slate-400">{o.label}</div>
                    </dd>
                  </div>
                ))}
              </dl>
              <ul className="mt-6 space-y-2.5">
                {ind.jobs.slice(0, 3).map((j) => (
                  <li key={j.job} className="text-sm">
                    <span className="font-medium text-slate-100">{j.job}.</span> <span className="text-slate-400">{j.how}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <DemoLoginButton demo={ind.demo} label="Try the demo workspace" />
                <Link href={`/solutions/${ind.id}`} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/15 px-5 text-[15px] text-white hover:border-white/35">
                  {ind.title} in detail <ArrowRight size={15} aria-hidden />
                </Link>
              </div>
            </div>
            <div className="min-w-0">
              <ScreenMock kind={ind.screens[0]!.kind} caption={ind.screens[0]!.caption} />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

export function ExploreCta() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const go = (e: FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/explore?q=${encodeURIComponent(q.trim())}` : "/explore");
  };
  return (
    <section aria-labelledby="explore-title" className="relative overflow-hidden border-y border-white/[0.05]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_320px_at_80%_50%,rgba(56,189,248,0.14),transparent_65%)]" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="inline-flex items-center gap-2 text-sm text-sky-300/90">
            <Compass size={15} aria-hidden /> Explore any location, free
          </p>
          <h2 id="explore-title" className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Type a place anywhere on Earth. Get its climate risk in seconds.
          </h2>
          <p className="mt-4 max-w-xl text-slate-400">Flood, salinity, drought and heat scores with the drivers explained, a 7-day forecast, river discharge and nearby hazard events. No sign-in needed.</p>
        </div>
        <form onSubmit={go} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/30 p-2 sm:flex-row" role="search" aria-label="Explore a location">
          <label className="flex min-h-[48px] flex-1 items-center gap-2 rounded-xl px-3">
            <Search size={17} className="shrink-0 text-slate-500" aria-hidden />
            <span className="sr-only">Place name</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Can Tho, Vietnam" className="w-full bg-transparent text-[15px] text-white placeholder:text-slate-500 focus:outline-none" />
          </label>
          <button type="submit" className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 text-[15px] font-semibold text-slate-950 hover:bg-sky-300">
            <MapPin size={16} aria-hidden /> Explore
          </button>
        </form>
      </div>
    </section>
  );
}

const CAPABILITIES: { layer: string; color: string; items: { icon: LucideIcon; name: string; detail: string; href?: string }[] }[] = [
  {
    layer: "Data",
    color: "#38bdf8",
    items: [
      { icon: Satellite, name: "Forecasts & satellites", detail: "Hourly weather, river discharge, sea level, NDVI, observed flood extent" },
      { icon: Database, name: "Your assets", detail: "Plots, loans, facilities, communities via CSV or API" },
    ],
  },
  {
    layer: "Intelligence",
    color: "#a78bfa",
    items: [
      { icon: Compass, name: "Risk Explorer", detail: "Full hazard report for any coordinate", href: "/explore" },
      { icon: Layers, name: "Portfolio scoring", detail: "Every asset re-scored against live forecasts" },
      { icon: Bot, name: "Copilot", detail: "Ask your portfolio questions in plain language" },
    ],
  },
  {
    layer: "Workflows",
    color: "#fbbf24",
    items: [
      { icon: ShieldCheck, name: "Insurance", detail: "Trigger watch, expected loss, claims evidence", href: "/solutions/insurance" },
      { icon: Landmark, name: "Lending & Finance", detail: "Climate-adjusted EL, restructuring watch-list", href: "/solutions/banking" },
      { icon: HandHeart, name: "Anticipatory Action", detail: "Pre-agreed triggers and release stages", href: "/solutions/ngo" },
    ],
  },
  {
    layer: "Delivery",
    color: "#34d399",
    items: [
      { icon: Bell, name: "Alert rules", detail: "App, email, SMS, WhatsApp, Slack" },
      { icon: Webhook, name: "API & webhooks", detail: "Scores and events into your own systems", href: "/docs/api-reference" },
      { icon: FileText, name: "Reports", detail: "PDF, CSV and GeoJSON exports" },
    ],
  },
];

export function CapabilityMap() {
  return (
    <section id="platform" aria-labelledby="cap-title" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28">
      <div className="max-w-3xl">
        <p className="text-sm text-violet-300/90">Platform</p>
        <h2 id="cap-title" className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
          From raw forecast to a decision your team can act on.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">Four layers in one workspace, so underwriting, credit, logistics and field teams work from the same numbers.</p>
      </div>
      <div className="mt-12 grid gap-4 lg:grid-cols-4">
        {CAPABILITIES.map((c, ci) => (
          <motion.div key={c.layer} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: ci * 0.08 }} className="relative rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between">
              <span className="telemetry text-[11px] uppercase tracking-[0.2em]" style={{ color: c.color }}>
                {String(ci + 1).padStart(2, "0")} · {c.layer}
              </span>
              {ci < CAPABILITIES.length - 1 && <ArrowRight size={14} className="hidden text-slate-600 lg:block" aria-hidden />}
            </div>
            <ul className="mt-4 space-y-2">
              {c.items.map((it) => {
                const inner = (
                  <>
                    <it.icon size={16} className="mt-0.5 shrink-0" style={{ color: c.color }} aria-hidden />
                    <span>
                      <span className="block text-sm font-medium text-slate-100">{it.name}</span>
                      <span className="block text-xs leading-snug text-slate-400">{it.detail}</span>
                    </span>
                  </>
                );
                return (
                  <li key={it.name}>
                    {it.href ? (
                      <Link href={it.href} className="flex gap-2.5 rounded-xl border border-white/[0.05] bg-black/20 p-2.5 transition-colors hover:border-white/20">
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex gap-2.5 rounded-xl border border-white/[0.05] bg-black/20 p-2.5">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

const SOURCES = [
  { name: "Open-Meteo", what: "Hourly forecasts (ECMWF, GFS, national models), ERA5 history" },
  { name: "Copernicus GloFAS", what: "River discharge forecasts, 30-day history" },
  { name: "NASA GIBS / MODIS / VIIRS", what: "Satellite imagery, NDVI, observed flood extent" },
  { name: "JRC Global Surface Water", what: "Where water has been since 1984" },
  { name: "GDACS · NASA EONET", what: "Live cyclone, flood and storm events" },
  { name: "Copernicus DEM", what: "Elevation for flood exposure" },
];

export function DataSourcesStrip() {
  return (
    <section aria-labelledby="sources-title" className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="sources-title" className="font-display text-xl font-semibold text-white sm:text-2xl">
          Built on data your risk team already trusts
        </h2>
        <Link href="/docs/data-sources" className="inline-flex items-center gap-1.5 text-sm text-emerald-300 hover:text-emerald-200">
          Methodology & attribution <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SOURCES.map((s) => (
          <li key={s.name} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
            <div className="text-sm font-medium text-slate-100">{s.name}</div>
            <div className="mt-0.5 text-xs text-slate-400">{s.what}</div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-slate-500">Every number in the product carries a source tag showing where it came from and when it was fetched.</p>
    </section>
  );
}

const TRUST = [
  { icon: Lock, t: "Isolated workspaces", d: "Each organisation sees only its own assets and users." },
  { icon: KeyRound, t: "Role-based access", d: "Workspace admins and analysts; API keys scoped to one workspace." },
  { icon: FileText, t: "Full audit log", d: "Every change is recorded with who made it and when." },
  { icon: ShieldCheck, t: "Privacy by design", d: "No farmer personal data needed for portfolio scoring." },
];

export function TrustStrip() {
  return (
    <section aria-labelledby="trust-title" className="border-y border-white/[0.05] bg-white/[0.015]">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="trust-title" className="font-display text-xl font-semibold text-white sm:text-2xl">
            Security your procurement team will ask about
          </h2>
          <Link href="/trust" className="inline-flex items-center gap-1.5 text-sm text-emerald-300 hover:text-emerald-200">
            Visit the Trust centre <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map(({ icon: Icon, t, d }) => (
            <li key={t} className="flex gap-3 rounded-xl border border-white/[0.07] bg-[#050a14] p-4">
              <Icon size={18} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />
              <div>
                <div className="text-sm font-medium text-slate-100">{t}</div>
                <div className="mt-0.5 text-xs leading-snug text-slate-400">{d}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const WEEKS = [
  { w: "Week 1", t: "Connect", d: "Kick-off call. Import your assets (CSV or API); every one is scored the same day. Invite your team." },
  { w: "Week 2", t: "Configure", d: "Set thresholds and alert rules with us, pick channels, switch on your industry module." },
  { w: "Week 3", t: "Operate", d: "Weekly risk review on real forecasts. Your team acts on alerts; we tune rules to cut noise." },
  { w: "Week 4", t: "Prove", d: "Pilot report: alerts sent, actions taken, exposure trend, and a go/no-go against agreed success criteria." },
];

export function RolloutTimeline() {
  return (
    <section id="rollout" aria-labelledby="rollout-title" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28">
      <div className="max-w-3xl">
        <p className="text-sm text-amber-300/90">How a customer rolls it out</p>
        <h2 id="rollout-title" className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
          Live on your own portfolio in four weeks.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">No integration project up front. Start with a spreadsheet, connect the API when it earns its place.</p>
      </div>
      <ol className="relative mt-12 grid gap-4 md:grid-cols-4">
        <div aria-hidden className="absolute left-[19px] top-2 h-[calc(100%-1rem)] w-px bg-gradient-to-b from-emerald-400/60 via-sky-400/40 to-transparent md:left-0 md:top-[19px] md:h-px md:w-full md:bg-gradient-to-r" />
        {WEEKS.map((w, i) => (
          <motion.li key={w.w} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="relative pl-12 md:pl-0 md:pt-12">
            <span className="absolute left-0 top-0 grid h-10 w-10 place-items-center rounded-full border border-emerald-400/40 bg-[#050a14] text-emerald-300">
              <CalendarCheck size={17} aria-hidden />
            </span>
            <div className="telemetry text-[11px] uppercase tracking-[0.2em] text-slate-500">{w.w}</div>
            <div className="mt-1 font-display text-lg font-semibold text-white">{w.t}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{w.d}</p>
          </motion.li>
        ))}
      </ol>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Link href="/book-demo" className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-[15px] font-semibold text-slate-950 hover:bg-emerald-400">
          Book a demo <ArrowRight size={16} aria-hidden />
        </Link>
        <Link href="/roi" className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/15 px-6 text-[15px] text-white hover:border-white/35">
          Estimate your ROI
        </Link>
      </div>
    </section>
  );
}
