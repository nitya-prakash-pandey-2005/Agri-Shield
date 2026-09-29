"use client";

/**
 * Split-screen "same storm, two outcomes" infographic. A shared clock (T-72h → T+24h)
 * is driven by scroll position; both timelines light up in lock-step.
 */
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

const STEPS = ["T−72 h", "T−48 h", "T−24 h", "Landfall", "T+24 h"];

const WITHOUT = [
  "A monsoon depression forms over the Bay of Bengal. Nobody downstream is told.",
  "Upstream gauges start rising. The warning sits in an agency bulletin farmers never see.",
  "Seedlings are still in the field. The nearest pumps are 200 km away.",
  "The embankment overtops at night. Fields go under before anyone can move grain.",
  "Relief trucks arrive after the loss has been counted.",
];
const WITH = [
  "Agri-SHIELD flags a 71% flood probability for Barisal and pushes it to every portal.",
  "4,120 farmers get an SMS and app alert in Bangla with three concrete actions.",
  "The district office pre-positions 12 pumps and 3,000 sandbags at two depots.",
  "Seed stock is on high ground and ripe paddy is harvested early. Buyers have already rerouted.",
  "Fields drain within 36 hours. Actions logged by farmers feed the next forecast.",
];
const LOSS_WITHOUT = [4, 9, 22, 58, 71];
const LOSS_WITH = [2, 3, 5, 12, 14];

function Column({ tone, title, items, active, loss }: { tone: "bad" | "good"; title: string; items: string[]; active: number; loss: number[] }) {
  const bad = tone === "bad";
  const accent = bad ? "#f87171" : "#34d399";
  const pct = loss[Math.max(0, active)] ?? 0;
  return (
    <div className={`relative rounded-2xl border p-5 sm:p-7 ${bad ? "border-rose-400/15 bg-[linear-gradient(180deg,rgba(127,29,29,0.14),rgba(5,10,20,0.4))]" : "border-emerald-400/20 bg-[linear-gradient(180deg,rgba(6,78,59,0.2),rgba(5,10,20,0.4))]"}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold text-white sm:text-xl">{title}</h3>
        <span className="text-xs" style={{ color: accent }}>
          {bad ? "Reactive" : "Proactive"}
        </span>
      </div>
      <ol className="mt-6 space-y-1">
        {items.map((text, i) => {
          const on = i <= active;
          return (
            <li key={i} className="grid grid-cols-[4.5rem_1fr] gap-3 rounded-lg py-2 transition-opacity duration-500" style={{ opacity: on ? 1 : 0.28 }}>
              <span className="telemetry pt-0.5 text-[11px]" style={{ color: on ? accent : "#64748b" }}>
                {STEPS[i]}
              </span>
              <span className="flex gap-2 text-sm leading-relaxed text-slate-300">
                {on && (bad ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-400/80" aria-hidden /> : <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />)}
                {text}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-6 border-t border-white/[0.06] pt-4">
        <div className="flex items-baseline justify-between text-xs text-slate-400">
          <span>Crop value lost</span>
          <span className="telemetry text-2xl font-semibold" style={{ color: accent }}>
            {pct}%
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div className="h-full rounded-full" style={{ background: accent, boxShadow: `0 0 16px ${accent}` }} animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 80, damping: 20 }} />
        </div>
      </div>
    </div>
  );
}

export function ProblemSection() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 70%"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (!reduced) setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length))));
  });
  const shown = reduced ? STEPS.length - 1 : active;

  return (
    <section id="problem" aria-labelledby="problem-title" className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32">
      <div className="max-w-3xl">
        <p className="text-sm text-rose-300/90">The problem</p>
        <h2 id="problem-title" className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
          The same storm. Two very different harvests.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">
          Forecasts already see floods coming days ahead. They just never become a decision in a paddy field, a district office or a procurement desk. Scroll to follow one cyclone through both worlds.
        </p>
      </div>

      <div ref={ref} className="mt-12">
        <div className="sticky top-16 z-10 -mx-4 mb-6 border-y border-white/[0.06] bg-[#050a14]/85 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <div className="flex items-center gap-2 sm:gap-3" role="progressbar" aria-label="Storm timeline" aria-valuemin={0} aria-valuemax={STEPS.length - 1} aria-valuenow={shown} aria-valuetext={STEPS[shown]}>
            {STEPS.map((s, i) => (
              <div key={s} className="flex flex-1 flex-col gap-1.5">
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                  <motion.div className="h-full bg-gradient-to-r from-sky-400 to-amber-300" animate={{ width: i <= shown ? "100%" : "0%" }} transition={{ duration: 0.5 }} />
                </div>
                <span className={`telemetry text-[10px] sm:text-[11px] ${i === shown ? "text-white" : "text-slate-500"}`}>{s}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Column tone="bad" title="Without Agri-SHIELD" items={WITHOUT} active={shown} loss={LOSS_WITHOUT} />
          <Column tone="good" title="With Agri-SHIELD" items={WITH} active={shown} loss={LOSS_WITH} />
        </div>
        <p className="mt-3 text-xs text-slate-500">Illustrative scenario for a 1-in-10-year riverine flood in coastal Bangladesh. Loss curves are modelled, not observed.</p>
      </div>

      <dl className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-3">
        {[
          { v: "$27B", k: "lost to salt-affected farmland every year worldwide", src: "UNU-INWEH, Qadir et al. 2014", c: "text-amber-300" },
          { v: "72 hr", k: "advance warning window, three times the typical 24 h bulletin", src: "Open-Meteo + GloFAS horizon", c: "text-sky-300" },
          { v: "3 → 1", k: "stakeholders coordinated on one live data platform", src: "Farmers · governments · supply chains", c: "text-emerald-300" },
        ].map((s) => (
          <div key={s.v} className="bg-[#050a14] p-6 sm:p-8">
            <dt className="sr-only">{s.k}</dt>
            <dd>
              <div className={`font-display text-5xl font-semibold tracking-tight sm:text-6xl ${s.c}`}>{s.v}</div>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">{s.k}</p>
              <p className="mt-2 text-xs text-slate-500">{s.src}</p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
