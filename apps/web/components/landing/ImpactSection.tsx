"use client";

/** Impact stories carousel (seeded, clearly marked simulated) + programme figures. */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Quote } from "lucide-react";

const STORIES = [
  {
    who: "Rahima B.",
    role: "Rice farmer, 1.2 ha",
    place: "Satkhira, Bangladesh",
    quote: "The message said salt would reach our canal in nine days. We filled the pond with fresh water first and switched the seedbed to BINA dhan-10. Our neighbours lost the Boro crop; we kept most of ours.",
    metric: "EC 6.8 dS/m forecast · 9 days' notice",
    outcome: "78% of yield kept",
    color: "#fbbf24",
  },
  {
    who: "Nguyễn Văn T.",
    role: "Cooperative leader, 40 households",
    place: "Bến Tre, Vietnam",
    quote: "We used to close the sluice gates after the salt came in. Now the cooperative closes them when the dashboard turns orange, and we store water before the tide peaks.",
    metric: "Sluice closed 4 days before peak",
    outcome: "212 ha of coconut and rice protected",
    color: "#34d399",
  },
  {
    who: "District agriculture office",
    role: "Provincial disaster desk",
    place: "Kendrapara, Odisha",
    quote: "We moved 14 dewatering pumps to two depots two days before the cyclone crossed. For once, the equipment was waiting for the water, not the other way round.",
    metric: "14 pumps pre-positioned 48 h ahead",
    outcome: "Drainage time cut from 6 days to 2",
    color: "#38bdf8",
  },
  {
    who: "Rice procurement team",
    role: "Regional grain trader",
    place: "Central Luzon, Philippines",
    quote: "The disruption score for Pampanga crossed our threshold on a Tuesday. By Thursday we had shifted a third of that week’s volume to Nueva Ecija mills.",
    metric: "Webhook at risk score 72",
    outcome: "1,800 t rerouted without price spike",
    color: "#a78bfa",
  },
];

const FIGURES = [
  { v: "15,000+", k: "farmers onboarded", c: "text-emerald-300" },
  { v: "23", k: "government agencies", c: "text-sky-300" },
  { v: "₹450 Cr", k: "crop loss prevented", c: "text-amber-300" },
  { v: "72 h", k: "median warning lead time", c: "text-violet-300" },
];

export function ImpactSection() {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const s = STORIES[i]!;

  useEffect(() => {
    if (reduced || paused) return;
    const t = setInterval(() => setI((x) => (x + 1) % STORIES.length), 8000);
    return () => clearInterval(t);
  }, [reduced, paused]);

  const go = (d: number) => setI((x) => (x + d + STORIES.length) % STORIES.length);

  return (
    <section id="impact" aria-labelledby="impact-title" className="relative border-y border-white/[0.05] bg-[#040913] py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-sm text-amber-300/90">Impact</p>
            <h2 id="impact-title" className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
              What acting three days early looks like.
            </h2>
          </div>
          <p className="max-w-sm text-sm text-slate-400">Stories and figures below come from our simulated pilot programme and seeded demo data, not from audited deployments.</p>
        </div>

        <div
          className="mt-12 grid gap-6 lg:grid-cols-[1.6fr_1fr]"
          aria-roledescription="carousel"
          aria-label="Impact stories"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[linear-gradient(135deg,rgba(15,23,42,0.8),rgba(5,10,20,0.6))] p-6 sm:p-10">
            <AnimatePresence mode="wait">
              <motion.figure key={i} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.35 }} aria-roledescription="slide" aria-label={`${i + 1} of ${STORIES.length}`}>
                <Quote size={28} style={{ color: s.color }} aria-hidden />
                <blockquote className="mt-4 font-display text-xl leading-relaxed text-slate-100 sm:text-2xl">“{s.quote}”</blockquote>
                <figcaption className="mt-6 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-white">{s.who}</div>
                    <div className="text-sm text-slate-400">
                      {s.role} · {s.place}
                    </div>
                  </div>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-400">Simulated pilot story</span>
                </figcaption>
                <div className="mt-6 grid gap-3 border-t border-white/[0.06] pt-5 sm:grid-cols-2">
                  <div>
                    <div className="text-xs text-slate-500">Signal</div>
                    <div className="telemetry text-sm text-slate-200">{s.metric}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Outcome</div>
                    <div className="telemetry text-sm" style={{ color: s.color }}>
                      {s.outcome}
                    </div>
                  </div>
                </div>
              </motion.figure>
            </AnimatePresence>
            <div className="mt-8 flex items-center justify-between">
              <div className="flex gap-1.5" role="tablist" aria-label="Choose story">
                {STORIES.map((st, k) => (
                  <button key={st.who} role="tab" aria-selected={k === i} aria-label={`Story ${k + 1}: ${st.place}`} onClick={() => setI(k)} className="grid h-8 w-8 place-items-center">
                    <span className={`block h-1.5 rounded-full transition-all ${k === i ? "w-6 bg-white" : "w-1.5 bg-white/25"}`} />
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => go(-1)} aria-label="Previous story" className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-slate-300 hover:border-white/30 hover:text-white">
                  <ChevronLeft size={18} />
                </button>
                <button onClick={() => go(1)} aria-label="Next story" className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-slate-300 hover:border-white/30 hover:text-white">
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col">
            <dl className="grid flex-1 grid-cols-2 gap-px overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.08]">
              {FIGURES.map((f) => (
                <div key={f.k} className="flex flex-col justify-end bg-[#060c19] p-5 sm:p-6">
                  <dt className="order-2 mt-1 text-sm text-slate-400">{f.k}</dt>
                  <dd className={`order-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl ${f.c}`}>{f.v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-slate-500">Pilot programme figures (simulated), per the Agri-SHIELD 2026 demo scenario.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
