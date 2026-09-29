"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck, Compass } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { GlobeStage } from "./GlobeStage";
import { LiveCounters } from "./LiveCounters";
import { HazardTicker } from "./HazardTicker";


export function Hero() {
  const stats = trpc.public.stats.useQuery(undefined, { refetchInterval: 30_000 });

  return (
    <section id="top" className="relative overflow-hidden pt-16" aria-labelledby="hero-title">
      {/* atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="site-grid absolute inset-0" />
        <div className="absolute -right-40 top-10 h-[640px] w-[640px] rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.16),transparent_65%)]" />
        <div className="absolute -left-40 bottom-0 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.10),transparent_65%)]" />
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-6 px-4 pb-10 pt-10 sm:px-6 lg:min-h-[calc(100svh-7rem)] lg:grid-cols-[1.05fr_1fr] lg:gap-4 lg:pt-4">
        <div className="relative z-10">
          <p style={{ animationDelay: "0ms" }} className="site-in inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1 text-xs text-emerald-200">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            {stats.data ? `Watching ${stats.data.districtsMonitored} districts across ${stats.data.countries} countries, live` : "Connecting to live climate feeds"}
          </p>

          <h1 id="hero-title" className="mt-6 font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl xl:text-[4.6rem]">
            <span style={{ animationDelay: "80ms" }} className="site-in block bg-gradient-to-r from-white via-sky-100 to-sky-300 bg-clip-text text-transparent">
              Act before the flood hits.
            </span>
            <span style={{ animationDelay: "160ms" }} className="site-in block bg-gradient-to-r from-amber-200 via-amber-300 to-orange-400 bg-clip-text text-transparent">
              Save before the salt spreads.
            </span>
          </h1>

          <p style={{ animationDelay: "240ms" }} className="site-in mt-6 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
            Climate-risk intelligence for the organisations that carry farm risk: insurers, lenders, agribusiness, governments, NGOs and co-ops. Live flood, salinity, drought and heat scores for every asset you hold, for any location on Earth.
          </p>

          <div style={{ animationDelay: "320ms" }} className="site-in mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/book-demo"
              className="group inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-[15px] font-semibold text-slate-950 shadow-[0_10px_40px_-12px_rgba(16,185,129,0.9)] transition-all hover:bg-emerald-400 active:scale-[0.98]"
            >
              <CalendarCheck size={17} aria-hidden />
              Book a demo
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <Link
              href="/explore"
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-600/70 bg-slate-950/40 px-6 text-[15px] font-medium text-slate-100 backdrop-blur transition-colors hover:border-slate-400 hover:bg-slate-900/60"
            >
              <Compass size={17} aria-hidden />
              Explore any location
            </Link>
          </div>

          <p style={{ animationDelay: "360ms" }} className="site-in mt-4 text-sm text-slate-400">
            Farmer?{" "}
            <Link href="/auth/signup?role=farmer" className="text-emerald-300 underline decoration-emerald-400/30 underline-offset-4 hover:text-emerald-200">
              Get flood alerts free
            </Link>
          </p>

          <div className="site-in" style={{ animationDelay: "400ms" }}>
            <LiveCounters />
          </div>
        </div>

        <div
          className="site-in relative mx-auto w-full max-w-[420px] sm:max-w-[520px] lg:max-w-none"
        >
          <GlobeStage />
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#4ade80]" />Low</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#fbbf24]" />Medium</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#f87171]" />High</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#a78bfa]" />Critical</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-px w-4 bg-amber-400" />Salinity creep</span>
          </div>
        </div>
      </div>

      <HazardTicker />
    </section>
  );
}
