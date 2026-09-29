"use client";

/** How it works: Satellite data → ML processing → role-specific intelligence → action. */
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { BrainCircuit, Radio, Satellite, Users, type LucideIcon } from "lucide-react";

interface Step {
  title: string;
  lead: string;
  icon: LucideIcon;
  color: string;
  detail: { heading: string; points: { k: string; v: string }[] };
}

const STEPS: Step[] = [
  {
    title: "Satellite & sensor data",
    lead: "Free, open Earth-observation feeds pulled every 20 minutes.",
    icon: Satellite,
    color: "#38bdf8",
    detail: {
      heading: "What we ingest",
      points: [
        { k: "Open-Meteo forecast", v: "Hourly rain, soil moisture 0–7 cm, temperature, wind for 22 districts" },
        { k: "Copernicus GloFAS", v: "Daily river discharge vs 30-day mean, via the Open-Meteo Flood API" },
        { k: "ERA5 reanalysis", v: "90-day rainfall history for anomaly baselines" },
        { k: "NASA GIBS", v: "MODIS true colour, 8-day NDVI and GPM IMERG rain-rate tiles" },
        { k: "ISRIC SoilGrids", v: "Clay fraction, organic carbon and pH at field points" },
        { k: "GDACS · NASA EONET", v: "Live flood, cyclone and storm events across Asia-Pacific" },
      ],
    },
  },
  {
    title: "Model processing",
    lead: "Trained ensembles, with transparent formulas as fallback.",
    icon: BrainCircuit,
    color: "#a78bfa",
    detail: {
      heading: "How risk is scored",
      points: [
        { k: "Flood 24/48/72 h", v: "Temporal MLP + gradient-boosted trees trained on 2019–2025 ERA5 and GloFAS for 22 districts; 40-draw Monte Carlo interval" },
        { k: "Salinity EC", v: "Gradient-boosted EC forecast at 0/7/30/90 days from rain deficit, tide, discharge and coastal exposure" },
        { k: "Supply-chain impact", v: "Monte Carlo with correlated flood shocks across regions, depth-duration damage curves and price elasticity" },
        { k: "Crop damage", v: "EC compared with FAO crop tolerance thresholds (Ayers & Westcot, FAO-29)" },
        { k: "Outcome loop", v: "Farmer actions and outcomes are logged; drift is tracked and models retrain on schedule" },
      ],
    },
  },
  {
    title: "Role-specific intelligence",
    lead: "One signal, rewritten for each person who must act on it.",
    icon: Users,
    color: "#34d399",
    detail: {
      heading: "Who sees what",
      points: [
        { k: "Farmers", v: "Field-level risk and three concrete actions in their own language" },
        { k: "Governments", v: "District ranking, resource gaps and a broadcast console" },
        { k: "Supply chains", v: "Commodity exposure, disruption probability and price impact" },
      ],
    },
  },
  {
    title: "Action",
    lead: "Delivered where people already are, even offline.",
    icon: Radio,
    color: "#fbbf24",
    detail: {
      heading: "How it reaches people",
      points: [
        { k: "SMS & WhatsApp", v: "Twilio delivery with a STATUS / ALERT / ADVICE command set for feature phones" },
        { k: "Offline PWA", v: "Last 72 h of alerts cached; actions queue and sync on reconnect" },
        { k: "Dispatch", v: "Pumps, sandbags and boats requested and approved in one workflow" },
        { k: "Webhooks", v: "HMAC-signed events for ERP and procurement systems" },
      ],
    },
  },
];

export function PipelineSection() {
  const [active, setActive] = useState(0);
  const step = STEPS[active]!;

  return (
    <section id="how-it-works" aria-labelledby="how-title" className="relative border-t border-white/[0.05] bg-[linear-gradient(180deg,#050a14,#060d1b_50%,#050a14)] py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-3xl">
          <p className="text-sm text-sky-300/90">How it works</p>
          <h2 id="how-title" className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            From orbit to a farmer’s phone, automatically.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">No proprietary satellites or sensors. Every input is open data, and every output says where it came from.</p>
        </div>

        {/* pipeline rail */}
        <div className="relative mt-14">
          <svg className="pointer-events-none absolute left-0 right-0 top-[38px] hidden h-2 w-full lg:block" preserveAspectRatio="none" viewBox="0 0 100 2" aria-hidden>
            <line x1="12" y1="1" x2="88" y2="1" stroke="rgba(148,163,184,0.18)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
            <line x1="12" y1="1" x2="88" y2="1" stroke="#5eead4" strokeWidth="2" vectorEffect="non-scaling-stroke" className="site-flow" />
          </svg>
          <ol className="grid gap-3 lg:grid-cols-4 lg:gap-6" role="tablist" aria-label="Pipeline stages">
            {STEPS.map((s, i) => {
              const on = i === active;
              const Icon = s.icon;
              return (
                <li key={s.title} role="presentation">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={on}
                    aria-controls="pipeline-detail"
                    id={`pipeline-tab-${i}`}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onClick={() => setActive(i)}
                    className="group relative flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition-colors lg:flex-col lg:items-center lg:text-center"
                    style={{ borderColor: on ? `${s.color}66` : "rgba(148,163,184,0.1)", background: on ? `${s.color}0f` : "rgba(15,23,42,0.35)" }}
                  >
                    <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl border bg-[#050a14]" style={{ borderColor: `${s.color}55`, boxShadow: on ? `0 0 30px -6px ${s.color}` : "none" }}>
                      <Icon size={24} style={{ color: s.color }} aria-hidden />
                      <span className="telemetry absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-[#0b1426] text-[10px] text-slate-300 ring-1 ring-white/10">{i + 1}</span>
                    </span>
                    <span>
                      <span className="block font-display text-base font-semibold text-white">{s.title}</span>
                      <span className="mt-1 block text-sm leading-snug text-slate-400">{s.lead}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div id="pipeline-detail" role="tabpanel" aria-labelledby={`pipeline-tab-${active}`} className="hud-panel mt-6 min-h-[220px] p-5 sm:p-7" style={{ ["--hud-accent" as string]: step.color.replace("#", "").match(/.{2}/g)!.map((h) => parseInt(h, 16)).join(" ") }}>
          <AnimatePresence mode="wait">
            <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
              <h3 className="font-display text-lg font-semibold text-white">
                {step.detail.heading}
                <span className="ml-2 text-sm font-normal text-slate-500">step {active + 1} of 4</span>
              </h3>
              <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {step.detail.points.map((p) => (
                  <div key={p.k} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: step.color }} />
                    <div>
                      <dt className="text-sm font-medium text-slate-100">{p.k}</dt>
                      <dd className="text-sm leading-relaxed text-slate-400">{p.v}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
