"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Building2, Check, Sprout, Truck, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { AnimatedNumber, Skeleton, SourceTag } from "@/components/hud";
import { LiveDemoMap } from "@/components/landing/LiveDemoMap";
import { LeadForm } from "@/components/landing/LeadForm";
import { LogoMark } from "@/components/landing/Logo";
import { PLANS, formatMoney } from "../pricing/plans";

export function SlideTitle({ kicker, children, sub }: { kicker: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="max-w-3xl">
      <p className="text-sm text-emerald-300/90">{kicker}</p>
      <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">{children}</h2>
      {sub && <p className="mt-4 text-base leading-relaxed text-slate-400 sm:text-lg">{sub}</p>}
    </div>
  );
}

// ─── 1. Cover ────────────────────────────────────────────────────────────────
export function CoverSlide() {
  const stats = trpc.public.stats.useQuery(undefined, { refetchInterval: 30_000 });
  return (
    <div className="relative w-full">
      <div className="flex items-center gap-3">
        <LogoMark size={44} />
        <span className="rounded-full border border-emerald-400/25 bg-emerald-400/[0.06] px-3 py-1 text-xs text-emerald-200">Asian Hackathon for Green Future 2026 · Water resources & climate-resilient agriculture</span>
      </div>
      <h1 className="mt-8 max-w-5xl font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] text-white sm:text-7xl">
        Climate forecasts already see the flood coming.
        <span className="block text-slate-400">Agri-SHIELD makes sure someone acts on it.</span>
      </h1>
      <p className="mt-8 max-w-2xl text-lg leading-relaxed text-slate-300">
        72-hour flood and saltwater-intrusion intelligence for farmers, governments and supply chains across Asia’s deltas. Built entirely on open data.
      </p>
      <dl className="mt-12 grid max-w-3xl grid-cols-3 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
        {[
          { k: "districts watched live", v: stats.data?.districtsMonitored },
          { k: "hectares monitored", v: stats.data?.hectaresMonitored },
          { k: "alerts this week", v: stats.data?.alertsSentThisWeek },
        ].map((s) => (
          <div key={s.k} className="flex flex-col bg-[#050a14] p-4 sm:p-5">
            <dt className="order-2 mt-1 text-xs text-slate-400">{s.k}</dt>
            <dd className="order-1 text-base font-semibold text-white min-[420px]:text-xl sm:text-3xl">{s.v === undefined ? <Skeleton className="h-8 w-20" /> : <AnimatedNumber value={s.v} />}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-10 text-sm text-slate-500">
        Nitya Prakash Pandey · Founder · Press <kbd className="telemetry rounded border border-white/15 px-1">→</kbd> to advance, <kbd className="telemetry rounded border border-white/15 px-1">P</kbd> for presenter mode
      </p>
    </div>
  );
}

// ─── 2. Problem (animated data viz) ──────────────────────────────────────────
const PER_SECOND = 123e9 / (365 * 86400); // FAO 2023: USD 123B/yr average, 1991–2021

function LossTicker() {
  const [secs, setSecs] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    const t0 = performance.now();
    const id = setInterval(() => setSecs((performance.now() - t0) / 1000), reduced ? 1000 : 100);
    return () => clearInterval(id);
  }, [reduced]);
  return <span className="telemetry">${Math.round(secs * PER_SECOND).toLocaleString("en-US")}</span>;
}

function Bar({ label, value, max, color, note, delay }: { label: string; value: number; max: number; color: string; note: string; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  return (
    <div ref={ref}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="telemetry text-white">${value}B / yr</span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div className="h-full rounded-full" style={{ background: color, boxShadow: `0 0 18px ${color}` }} initial={{ width: 0 }} animate={{ width: inView ? `${(value / max) * 100}%` : 0 }} transition={{ duration: 1.4, delay, ease: [0.16, 1, 0.3, 1] }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

export function ProblemSlide() {
  return (
    <div className="w-full">
      <SlideTitle kicker="The problem" sub="Disasters erase a slice of the world’s harvest every year, and the losses concentrate in low-lying Asian deltas where rice, jute and coconut feed hundreds of millions.">
        Warnings exist. Decisions don’t follow.
      </SlideTitle>
      <div className="mt-12 grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-7">
          <Bar label="Crop & livestock lost to disasters" value={123} max={130} color="#f87171" note="Average 1991–2021, USD 3.8 trillion in total (FAO, 2023)" delay={0} />
          <Bar label="Crop losses on salt-affected land" value={27} max={130} color="#fbbf24" note="Salt-induced land degradation (UNU-INWEH, Qadir et al., 2014)" delay={0.2} />
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <div className="text-sm text-slate-400">Agricultural value lost to disasters since you opened this page</div>
            <div className="mt-2 font-display text-4xl font-semibold text-rose-300 sm:text-5xl">
              <LossTicker />
            </div>
            <div className="mt-1 text-xs text-slate-500">≈ $3,900 every second, derived from the FAO annual average</div>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-6">
          <div className="rounded-2xl border border-sky-400/20 bg-sky-400/[0.04] p-6">
            <div className="font-display text-5xl font-semibold text-sky-300">30%</div>
            <p className="mt-2 text-slate-300">less damage from just 24 hours’ warning of a coming storm.</p>
            <p className="mt-1 text-xs text-slate-500">Global Commission on Adaptation, “Adapt Now” (2019)</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex items-end gap-6">
              <div>
                <div className="telemetry text-3xl text-slate-400">24 h</div>
                <div className="text-xs text-slate-500">typical bulletin lead</div>
              </div>
              <div className="h-px flex-1 bg-gradient-to-r from-slate-600 to-emerald-400" />
              <div className="text-right">
                <div className="telemetry text-3xl text-emerald-300">72 h</div>
                <div className="text-xs text-slate-500">Agri-SHIELD horizon</div>
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-400">Three days is the difference between watching water rise and harvesting early, moving seed and pre-positioning pumps.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 3. Solution: animated 3-portal flow ─────────────────────────────────────
export function SolutionSlide() {
  const reduced = useReducedMotion();
  const nodes = [
    { x: 80, y: 60, label: "Open-Meteo", sub: "forecast · ERA5" },
    { x: 80, y: 150, label: "Copernicus GloFAS", sub: "river discharge" },
    { x: 80, y: 240, label: "NASA GIBS / EONET", sub: "MODIS · IMERG · events" },
    { x: 80, y: 330, label: "SoilGrids · GDACS", sub: "soil · disaster alerts" },
  ];
  const portals = [
    { x: 720, y: 90, label: "Farmers", color: "#34d399", icon: Sprout, what: "Field alerts + advisor" },
    { x: 720, y: 200, label: "Governments", color: "#10b981", icon: Building2, what: "Dispatch + broadcast" },
    { x: 720, y: 310, label: "Supply chains", color: "#f59e0b", icon: Truck, what: "Exposure + reroute" },
  ];
  const core = { x: 420, y: 200 };
  return (
    <div className="w-full">
      <SlideTitle kicker="The solution" sub="One risk engine, three role-specific portals, and a feedback loop: what farmers do after an alert makes the next forecast better.">
        One signal. Three people who must act on it.
      </SlideTitle>
      <ol className="mt-8 space-y-2 sm:hidden">
        {[
          ["Open data in", "Open-Meteo, Copernicus GloFAS, NASA GIBS / EONET, SoilGrids, GDACS", "#38bdf8"],
          ["Agri-SHIELD risk engine", "Flood, salinity and supply-chain impact models", "#34d399"],
          ["Farmers", "Field alerts + advisor", "#34d399"],
          ["Governments", "Dispatch + broadcast", "#10b981"],
          ["Supply chains", "Exposure + reroute", "#f59e0b"],
          ["Feedback loop", "Farmer actions and outcomes recalibrate the models", "#a78bfa"],
        ].map(([t, d, c]) => (
          <li key={t} className="rounded-xl border bg-[#0a1426] p-3" style={{ borderColor: `${c}55` }}>
            <div className="text-sm font-semibold text-white">{t}</div>
            <div className="text-xs text-slate-400">{d}</div>
          </li>
        ))}
      </ol>
      <div className="mt-10 hidden sm:block">
        <svg viewBox="0 0 900 400" className="w-full" role="img" aria-label="Open data sources flow into the Agri-SHIELD risk engine, which serves the farmer, government and supply chain portals">
          <defs>
            <radialGradient id="core-g">
              <stop offset="0" stopColor="#34d399" stopOpacity="0.35" />
              <stop offset="1" stopColor="#34d399" stopOpacity="0" />
            </radialGradient>
          </defs>
          {nodes.map((n, i) => {
            const d = `M${n.x + 110} ${n.y} C ${n.x + 220} ${n.y}, ${core.x - 140} ${core.y}, ${core.x - 60} ${core.y}`;
            return (
              <g key={n.label}>
                <path d={d} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="1.5" />
                <path d={d} fill="none" stroke="#38bdf8" strokeWidth="2" className={reduced ? "" : "site-flow"} style={{ animationDelay: `${i * 0.3}s` }} />
                <rect x={n.x - 70} y={n.y - 26} width="180" height="52" rx="12" fill="#0a1426" stroke="rgba(56,189,248,0.35)" />
                <text x={n.x + 20} y={n.y - 3} textAnchor="middle" fill="#e2e8f0" fontSize="14" fontWeight="600">{n.label}</text>
                <text x={n.x + 20} y={n.y + 15} textAnchor="middle" fill="#64748b" fontSize="11">{n.sub}</text>
              </g>
            );
          })}
          {portals.map((p, i) => {
            const d = `M${core.x + 60} ${core.y} C ${core.x + 160} ${core.y}, ${p.x - 200} ${p.y}, ${p.x - 90} ${p.y}`;
            return (
              <g key={p.label}>
                <path d={d} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="1.5" />
                <path d={d} fill="none" stroke={p.color} strokeWidth="2.5" className={reduced ? "" : "site-flow"} style={{ animationDelay: `${i * 0.25}s` }} />
                <rect x={p.x - 90} y={p.y - 34} width="190" height="68" rx="14" fill="#0a1426" stroke={p.color} strokeOpacity="0.55" />
                <text x={p.x + 5} y={p.y - 4} textAnchor="middle" fill="#fff" fontSize="16" fontWeight="600">{p.label}</text>
                <text x={p.x + 5} y={p.y + 16} textAnchor="middle" fill="#94a3b8" fontSize="12">{p.what}</text>
              </g>
            );
          })}
          {/* feedback loop */}
          <path d={`M${portals[0]!.x - 20} ${portals[0]!.y - 34} C ${portals[0]!.x - 80} 10, ${core.x + 40} 40, ${core.x + 20} ${core.y - 62}`} fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeDasharray="3 6" className={reduced ? "" : "site-flow"} />
          <text x={560} y={34} fill="#a78bfa" fontSize="11">farmer actions + outcomes → recalibration</text>
          <circle cx={core.x} cy={core.y} r="120" fill="url(#core-g)" />
          <circle cx={core.x} cy={core.y} r="62" fill="#07111f" stroke="#34d399" strokeWidth="2" />
          <text x={core.x} y={core.y - 6} textAnchor="middle" fill="#fff" fontSize="15" fontWeight="700">Agri-SHIELD</text>
          <text x={core.x} y={core.y + 13} textAnchor="middle" fill="#6ee7b7" fontSize="11">risk engine</text>
          <text x={core.x} y={core.y + 28} textAnchor="middle" fill="#64748b" fontSize="10">flood · salinity · impact</text>
        </svg>
      </div>
    </div>
  );
}

// ─── 4. Live demo ────────────────────────────────────────────────────────────
export function DemoSlide() {
  return (
    <div className="w-full">
      <SlideTitle kicker="Live demo" sub="Not a mock-up: this map is scored right now from Open-Meteo forecasts and Copernicus GloFAS discharge for 22 districts in 5 countries.">
        Today’s risk, live.
      </SlideTitle>
      <div className="mt-8">
        <LiveDemoMap height="h-[460px]" />
      </div>
    </div>
  );
}

// ─── 5. Impact metrics (computed) ────────────────────────────────────────────
export function ImpactSlide() {
  const risk = trpc.public.riskMap.useQuery();
  const stats = trpc.public.stats.useQuery();
  const metrics = trpc.ml.getModelMetrics.useQuery();
  const m = useMemo(() => {
    const d = risk.data ?? [];
    const high = d.filter((x) => Math.max(x.floodRisk, x.salinityRisk) >= 60);
    const avgProb = d.length ? d.reduce((n, x) => n + x.floodProb72h, 0) / d.length : 0;
    const salineHigh = d.filter((x) => x.ecCurrent >= 4).length;
    // Simulated avoided loss: monitored ha × share of high-risk districts × USD 1,150/ha rice gross value × 30% avoided (GCA 24 h early-warning effect)
    const ha = stats.data?.hectaresMonitored ?? 0;
    const share = d.length ? high.length / d.length : 0;
    const avoided = ha * share * 1150 * 0.3;
    return { high: high.length, total: d.length, avgProb, salineHigh, avoided };
  }, [risk.data, stats.data]);

  const flood = metrics.data?.models.find((x) => x.auc !== undefined);
  const sal = metrics.data?.models.find((x) => x.r2 !== undefined);

  return (
    <div className="w-full">
      <SlideTitle kicker="Impact" sub="Computed live from the platform’s own data store and risk feed. Avoided-loss figures are simulated and labelled as such.">
        What the platform sees this hour.
      </SlideTitle>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { k: "districts at high or critical risk", v: m.high, suffix: ` / ${m.total || 22}`, c: "text-rose-300" },
          { k: "mean 72 h flood probability", v: Math.round(m.avgProb * 100), suffix: "%", c: "text-sky-300" },
          { k: "districts with soil EC ≥ 4 dS/m", v: m.salineHigh, suffix: "", c: "text-amber-300" },
          { k: "farmers protected today", v: stats.data?.farmersProtectedToday ?? 0, suffix: "", c: "text-emerald-300" },
        ].map((s) => (
          <div key={s.k} className="hud-panel p-5">
            <div className={`font-display text-4xl font-semibold ${s.c}`}>{risk.isLoading ? <Skeleton className="h-10 w-24" /> : <AnimatedNumber value={s.v} suffix={s.suffix} />}</div>
            <div className="mt-2 text-sm text-slate-400">{s.k}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="hud-panel p-6">
          <div className="text-sm text-slate-400">Crop value protected across monitored area (simulated)</div>
          <div className="mt-2 font-display text-5xl font-semibold text-emerald-300">
            <AnimatedNumber value={Math.round(m.avoided / 1e6)} prefix="$" suffix="M" />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            = hectares monitored × share of districts at high risk × $1,150/ha rice gross value × 30% avoided damage (Global Commission on Adaptation early-warning effect). Methodology in <a className="underline" href="/docs/impact-methodology">docs</a>.
          </p>
        </div>
        <div className="hud-panel p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-400">Model quality</div>
            <SourceTag>{metrics.data?.source === "ml-api" ? "ML service" : "reference values"}</SourceTag>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
            {[
              ["Flood AUC", flood?.auc?.toFixed(2)],
              ["Brier", flood?.brier?.toFixed(2)],
              ["Salinity R²", sal?.r2?.toFixed(2)],
            ].map(([k, v]) => (
              <div key={k}>
                <dd className="telemetry text-2xl text-white">{v ?? "—"}</dd>
                <dt className="text-xs text-slate-500">{k}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            {metrics.data?.source === "ml-api" ? "Held-out test set (2024–2025) from the ML service’s last training run." : "ML service offline: showing reference values, not the live evaluation."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── 6. Technology ───────────────────────────────────────────────────────────
const STACK: { group: string; items: string[] }[] = [
  { group: "Product", items: ["Next.js 15 App Router", "React 19", "TypeScript", "Tailwind CSS", "Framer Motion", "three.js", "Leaflet", "Recharts"] },
  { group: "Platform", items: ["tRPC v11", "NextAuth v5 + RBAC", "Zod on every input", "Socket.io / SSE realtime", "BullMQ jobs", "PostgreSQL + PostGIS (Drizzle)"] },
  { group: "Intelligence", items: ["FastAPI ML service", "Flood ensemble: temporal MLP + HistGBM", "Salinity HistGBM (EC 0–90 d)", "Monte Carlo supply-chain impact", "RAG advisor, multi-LLM with offline fallback", "FAO-29 crop EC thresholds"] },
  { group: "Delivery", items: ["Offline-first PWA + background sync", "Twilio SMS / WhatsApp", "Web Push", "HMAC-signed webhooks", "Stripe · Razorpay"] },
];
const DATA = [
  ["Open-Meteo", "CC BY 4.0"],
  ["Copernicus GloFAS", "Copernicus licence"],
  ["ECMWF ERA5", "Copernicus licence"],
  ["NASA GIBS · MODIS", "NASA open data"],
  ["NASA GPM IMERG", "NASA open data"],
  ["NASA EONET", "NASA open data"],
  ["GDACS (UN · EC JRC)", "open"],
  ["ISRIC SoilGrids", "CC BY 4.0"],
  ["OpenStreetMap · CARTO", "ODbL"],
  ["World Bank data", "CC BY 4.0"],
];
export function TechSlide() {
  return (
    <div className="w-full">
      <SlideTitle kicker="Technology" sub="No proprietary satellites, sensors or paid data feeds. Every input is free and open, so a ministry can run it on its own servers.">
        Built on open data, shipped as a real product.
      </SlideTitle>
      <div className="mt-10 grid gap-4 lg:grid-cols-4">
        {STACK.map((s) => (
          <div key={s.group} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <h3 className="text-sm font-medium text-white">{s.group}</h3>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {s.items.map((i) => (
                <li key={i} className="rounded-md border border-white/10 bg-[#0a1324] px-2 py-1 text-xs text-slate-300">
                  {i}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <h3 className="mt-10 text-sm text-slate-400">Open data sources</h3>
      <ul className="mt-3 flex flex-wrap gap-2">
        {DATA.map(([name, lic]) => (
          <li key={name} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] px-3 py-2 text-sm text-slate-200">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            {name}
            <span className="telemetry text-[10px] text-slate-500">{lic}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── 7. Differentiators ──────────────────────────────────────────────────────
const DIFF = [
  ["72-hour lead time", "Three days of warning, against the 24 h typical of public bulletins."],
  ["Three portals, one data platform", "Farmers, governments and buyers see the same event, rewritten for each role."],
  ["Salinity intrusion forecasting", "Slow-onset salt creep predicted per field, not reported after the crop dies."],
  ["Advisor that knows your farm", "Answers grounded in the field’s own risk, crop and soil, in 8 languages."],
  ["Supply-chain financial impact", "Links district risk to commodity volume and price exposure."],
  ["SMS fallback", "STATUS, ALERT and ADVICE commands for feature phones."],
  ["Outcome feedback loop", "Farmer actions and results recalibrate thresholds."],
  ["Resource coordination built in", "Pumps, sandbags and boats dispatched in the same system that raised the alert."],
  ["Offline-first PWA", "Cached alerts and queued actions for low-connectivity paddies."],
  ["Open data only", "NASA, Copernicus, Open-Meteo, GDACS. No hardware to buy."],
];
export function DiffSlide() {
  return (
    <div className="w-full">
      <SlideTitle kicker="Why Agri-SHIELD">Ten things no single competitor does together.</SlideTitle>
      <ol className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {DIFF.map(([t, d], i) => (
          <li key={t} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <span className="telemetry text-xs text-emerald-400">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="mt-2 text-[15px] font-semibold leading-snug text-white">{t}</h3>
            <p className="mt-1.5 text-sm leading-snug text-slate-400">{d}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── 8. Business model ───────────────────────────────────────────────────────
export function BusinessSlide() {
  const paid = PLANS.filter((p) => p.id !== "free");
  return (
    <div className="w-full">
      <SlideTitle kicker="Business model" sub="Farmers never pay to be warned. Agencies and buyers, who gain most from coordinated early action, fund the platform.">
        Free at the edge. Paid at the centre.
      </SlideTitle>
      <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <caption className="sr-only">Plans and prices</caption>
            <thead className="bg-white/[0.03] text-left text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Plan</th>
                <th scope="col" className="px-4 py-3 font-medium">Who pays</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-white/[0.06]">
                <td className="px-4 py-3 text-white">Farmer Basic</td>
                <td className="px-4 py-3 text-slate-400">Nobody</td>
                <td className="telemetry px-4 py-3 text-right text-emerald-300">Free</td>
              </tr>
              {paid.map((p) => (
                <tr key={p.id} className="border-t border-white/[0.06]">
                  <td className="px-4 py-3 text-white">{p.name}</td>
                  <td className="px-4 py-3 text-slate-400">{p.unit}</td>
                  <td className="telemetry px-4 py-3 text-right text-slate-200">{p.usdMonthly === null ? "Custom" : p.id === "farmer_pro" ? "₹199 / $3" : formatMoney(p.usdMonthly, "USD")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ol className="space-y-3">
          {[
            ["Pilot", "One district, free for 90 days, co-designed with the agriculture office."],
            ["Province", "Government Basic at $299/month plus farmer onboarding through extension workers."],
            ["National", "Enterprise contract, self-hosted option, API access for insurers and relief agencies."],
            ["Buyers", "Supply-chain subscriptions monetise the same risk feed for traders and lenders."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <span className="telemetry grid h-8 w-8 shrink-0 place-items-center rounded-full border border-emerald-400/40 text-sm text-emerald-300">{i + 1}</span>
              <div>
                <h3 className="font-semibold text-white">{t}</h3>
                <p className="text-sm text-slate-400">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ─── 9. SDGs ─────────────────────────────────────────────────────────────────
const SDGS = [
  { n: 2, t: "Zero hunger", c: "#dda63a", d: "Fewer harvests lost to floods and salt means more food and income for smallholders." },
  { n: 13, t: "Climate action", c: "#3f7e44", d: "Early warning and adaptation for the deltas most exposed to sea-level rise and extreme rain." },
  { n: 17, t: "Partnerships for the goals", c: "#19486a", d: "One shared data platform for ministries, NGOs, researchers and the private sector." },
];
export function SdgSlide() {
  return (
    <div className="w-full">
      <SlideTitle kicker="Sustainable Development Goals">Aligned with three SDGs by design.</SlideTitle>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {SDGS.map((s) => (
          <div key={s.n} className="overflow-hidden rounded-2xl border border-white/10">
            <div className="flex aspect-[5/3] flex-col justify-between p-5" style={{ background: s.c }}>
              <span className="font-display text-6xl font-bold leading-none text-white">{s.n}</span>
              <span className="font-display text-lg font-semibold uppercase leading-tight tracking-wide text-white">{s.t}</span>
            </div>
            <p className="bg-white/[0.02] p-5 text-sm leading-relaxed text-slate-300">{s.d}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500">Goal colours follow the UN SDG guidelines; tiles are drawn for this page and are not the official icons.</p>
    </div>
  );
}

// ─── 10. Team ────────────────────────────────────────────────────────────────
export function TeamSlide() {
  return (
    <div className="w-full">
      <SlideTitle kicker="Team">Built end to end by one founder. Hiring next.</SlideTitle>
      <div className="mt-10 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="hud-panel flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <div className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-sky-500 font-display text-3xl font-bold text-slate-950" aria-hidden>
            NP
          </div>
          <div>
            <h3 className="font-display text-2xl font-semibold text-white">Nitya Prakash Pandey</h3>
            <p className="text-emerald-300">Founder · Full-stack & ML</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Designed and built Agri-SHIELD: the three portals, the flood and salinity risk engines, the live open-data pipeline, the offline PWA and the billing stack.
            </p>
          </div>
        </div>
        <ul className="grid gap-3">
          {["ML engineer (hydrology / time series)", "Agronomist, South & South-East Asia", "Government partnerships lead"].map((r) => (
            <li key={r} className="flex items-center gap-3 rounded-2xl border border-dashed border-white/15 p-4">
              <UserPlus size={18} className="text-slate-500" aria-hidden />
              <span className="text-sm text-slate-300">
                <span className="text-slate-500">Hiring:</span> {r}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── 11. Contact ─────────────────────────────────────────────────────────────
export function ContactSlide() {
  return (
    <div className="grid w-full gap-10 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <SlideTitle kicker="Partner with us" sub="Ministries, disaster agencies, NGOs, insurers, grain buyers and investors: we’d like to hear from you.">
          Let’s get the next warning to the field in time.
        </SlideTitle>
        <ul className="mt-8 space-y-3 text-sm text-slate-300">
          {["District pilots start with live data in a week", "Research and NGO pricing available", "Investment and grant conversations welcome"].map((x) => (
            <li key={x} className="flex gap-3">
              <Check size={16} className="mt-0.5 text-emerald-400" aria-hidden />
              {x}
            </li>
          ))}
        </ul>
      </div>
      <div className="hud-panel p-5 sm:p-7">
        <LeadForm defaultInterest="partnership" source="pitch" />
      </div>
    </div>
  );
}
