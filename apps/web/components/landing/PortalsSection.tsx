"use client";

/** Three portals, each with a miniature of its real dashboard (live values where available). */
import Link from "next/link";
import { ArrowUpRight, Building2, Check, Sprout, Truck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { riskColor } from "@/components/hud";

type District = { id: string; name: string; countryCode: string; lat: number; lon: number; floodRisk: number; salinityRisk: number; floodProb72h: number; ecCurrent: number; rainfall72hMm: number };

function Gauge({ value, color }: { value: number; color: string }) {
  const r = 30;
  const c = Math.PI * r;
  return (
    <svg viewBox="0 0 80 46" className="w-full" aria-hidden>
      <path d="M10 40 A30 30 0 0 1 70 40" fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="7" strokeLinecap="round" />
      <path d="M10 40 A30 30 0 0 1 70 40" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(c * value) / 100} ${c}`} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      <text x="40" y="38" textAnchor="middle" className="telemetry" fontSize="13" fill="#fff" fontWeight="600">
        {Math.round(value)}%
      </text>
    </svg>
  );
}

function FarmerMock({ d }: { d?: District }) {
  const p = d ? d.floodProb72h * 100 : 64;
  const color = riskColor(p);
  return (
    <div className="mx-auto w-[190px] rounded-[26px] border border-white/10 bg-[#07111f] p-2">
      <div className="rounded-[20px] bg-[#050b16] p-3">
        <div className="flex items-center justify-between text-[9px] text-slate-500">
          <span>{d?.name ?? "Barisal"} · my fields</span>
          <span className="telemetry">72h</span>
        </div>
        <div className="mx-auto mt-1 w-28">
          <Gauge value={p} color={color} />
        </div>
        <div className="-mt-1 text-center text-[9px] text-slate-400">flood probability</div>
        <div className="mt-2 rounded-lg border-l-2 bg-white/[0.03] p-2" style={{ borderColor: color }}>
          <div className="text-[10px] font-semibold text-white">{p >= 60 ? "Drain seedbeds today" : p >= 35 ? "Clear field drains this week" : "No flood action needed today"}</div>
          <div className="text-[9px] leading-snug text-slate-400">{d ? `${Math.round(d.rainfall72hMm)} mm rain expected in 72 h` : "Heavy rain expected in 72 h"}</div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {["Alerts", "Advisor", "Map"].map((t) => (
            <span key={t} className="rounded-md bg-white/[0.04] py-1 text-center text-[8.5px] text-slate-400">
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function GovMock({ list }: { list: District[] }) {
  const bd = list.filter((d) => d.countryCode === "BD");
  const xs = bd.map((d) => d.lon);
  const ys = bd.map((d) => d.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs, 89), Math.max(...xs, 92), Math.min(...ys, 22), Math.max(...ys, 25)];
  const high = list.filter((d) => Math.max(d.floodRisk, d.salinityRisk) >= 60).length;
  return (
    <div className="grid grid-cols-[1.2fr_1fr] gap-2 rounded-xl border border-white/10 bg-[#07111f] p-2.5">
      <div className="relative aspect-square rounded-lg bg-[radial-gradient(circle_at_40%_40%,#0d2238,#050b16)]">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <line key={i} x1="0" x2="100" y1={i * 25} y2={i * 25} stroke="rgba(148,163,184,0.08)" />
          ))}
          {(bd.length ? bd : []).map((d) => {
            const x = 12 + ((d.lon - x0) / (x1 - x0 || 1)) * 76;
            const y = 88 - ((d.lat - y0) / (y1 - y0 || 1)) * 76;
            const c = riskColor(Math.max(d.floodRisk, d.salinityRisk));
            return (
              <g key={d.id}>
                <circle cx={x} cy={y} r="9" fill={c} opacity="0.18" />
                <circle cx={x} cy={y} r="3" fill={c} />
              </g>
            );
          })}
        </svg>
        <span className="absolute bottom-1 left-1.5 text-[8px] text-slate-500">Bangladesh · live</span>
      </div>
      <div className="flex flex-col gap-1.5 text-[9px]">
        <div className="rounded-md bg-white/[0.04] p-1.5">
          <div className="text-slate-500">High-risk districts</div>
          <div className="telemetry text-base font-semibold text-rose-300">{list.length ? high : "—"}</div>
        </div>
        {[
          { k: "Pumps", v: 72 },
          { k: "Sandbags", v: 46 },
          { k: "Boats", v: 88 },
        ].map((r) => (
          <div key={r.k}>
            <div className="flex justify-between text-slate-400">
              <span>{r.k}</span>
              <span className="telemetry">{r.v}%</span>
            </div>
            <div className="mt-0.5 h-1 rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${r.v}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScMock({ list }: { list: District[] }) {
  const avg = (cc: string) => {
    const xs = list.filter((d) => d.countryCode === cc);
    return xs.length ? xs.reduce((n, d) => n + 0.65 * d.floodRisk + 0.35 * d.salinityRisk, 0) / xs.length : null;
  };
  const rows = [
    { c: "Rice · Mekong", r: avg("VN"), s: [3, 4, 3, 5, 6, 5, 7, 8] },
    { c: "Jute · Ganges", r: avg("BD"), s: [5, 5, 6, 5, 4, 5, 6, 6] },
    { c: "Rice · Luzon", r: avg("PH"), s: [4, 3, 4, 4, 5, 6, 5, 6] },
    { c: "Coconut · Java", r: avg("ID"), s: [2, 3, 3, 2, 3, 4, 4, 5] },
  ];
  return (
    <div className="rounded-xl border border-white/10 bg-[#07111f] p-2.5 text-[9.5px]">
      <div className="mb-1.5 grid grid-cols-[1fr_52px_36px] text-[8.5px] text-slate-500">
        <span>Commodity</span>
        <span>30 d trend</span>
        <span className="text-right">Risk</span>
      </div>
      {rows.map((r) => {
        const c = r.r === null ? "#64748b" : riskColor(r.r);
        const max = Math.max(...r.s);
        return (
          <div key={r.c} className="grid grid-cols-[1fr_52px_36px] items-center border-t border-white/[0.05] py-1.5">
            <span className="text-slate-300">{r.c}</span>
            <svg viewBox="0 0 50 14" className="h-3.5 w-12" aria-hidden>
              <polyline points={r.s.map((v, i) => `${(i / (r.s.length - 1)) * 50},${14 - (v / max) * 12}`).join(" ")} fill="none" stroke={c} strokeWidth="1.4" />
            </svg>
            <span className="telemetry text-right font-semibold" style={{ color: c }}>
              {r.r === null ? "—" : Math.round(r.r)}
            </span>
          </div>
        );
      })}
      <div className="mt-1.5 rounded-md bg-amber-400/10 px-2 py-1 text-amber-200">Scenario: reroute 18% of volume via Chattogram</div>
    </div>
  );
}

function PortalCard({ title, icon: Icon, color, who, href, mock, features }: { title: string; icon: LucideIcon; color: string; who: string; href: string; mock: ReactNode; features: string[] }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(15,23,42,0.6),rgba(5,10,20,0.6))] transition-colors hover:border-white/20 focus-within:border-white/20">
      <div className="flex items-center gap-3 p-5 pb-0 sm:p-6 sm:pb-0">
        <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: `${color}1a` }}>
          <Icon size={19} style={{ color }} aria-hidden />
        </span>
        <div>
          <h3 className="font-display text-lg font-semibold text-white">{title}</h3>
          <p className="text-xs text-slate-400">{who}</p>
        </div>
      </div>
      <div className="relative mt-5 h-[270px] overflow-hidden px-5 sm:px-6">
        <div className="transition-all duration-500 [@media(hover:hover)]:group-hover:-translate-y-4 [@media(hover:hover)]:group-hover:opacity-20 [@media(hover:hover)]:group-focus-within:opacity-20">{mock}</div>
        <ul className="absolute inset-x-5 bottom-4 space-y-1.5 opacity-0 transition-all duration-500 sm:inset-x-6 [@media(hover:hover)]:translate-y-6 [@media(hover:hover)]:group-hover:translate-y-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:translate-y-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:none)]:hidden">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-slate-100">
              <Check size={15} className="mt-0.5 shrink-0" style={{ color }} aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      </div>
      {/* touch devices: features listed plainly */}
      <ul className="hidden space-y-1.5 px-5 pt-4 [@media(hover:none)]:block">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
            <Check size={15} className="mt-0.5 shrink-0" style={{ color }} aria-hidden />
            {f}
          </li>
        ))}
      </ul>
      <Link href={href} className="mt-auto flex items-center justify-between border-t border-white/[0.06] px-5 py-4 text-sm font-medium text-slate-200 transition-colors hover:text-white sm:px-6">
        Open {title.toLowerCase()}
        <ArrowUpRight size={16} style={{ color }} aria-hidden />
      </Link>
    </article>
  );
}

export function PortalsSection() {
  const q = trpc.public.riskMap.useQuery(undefined, { staleTime: 5 * 60_000 });
  const list = (q.data ?? []) as District[];
  const barisal = list.find((d) => d.id === "bd-barisal");

  return (
    <section id="portals" aria-labelledby="portals-title" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <p className="text-sm text-emerald-300/90">Three portals, one data platform</p>
          <h2 id="portals-title" className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            Everyone downstream of the storm, on the same page.
          </h2>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-slate-400">The miniatures below are drawn from the live risk feed. Hover or focus a card to see what each portal does.</p>
      </div>
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        <PortalCard
          title="Farmer portal"
          who="Smallholders, cooperatives, extension workers"
          icon={Sprout}
          color="#34d399"
          href="/dashboard/farmer"
          mock={<FarmerMock d={barisal} />}
          features={["72 h flood and salt alerts per field", "AI advisor in 8 languages, voice input", "Works offline; SMS for feature phones", "Log actions, earn better forecasts"]}
        />
        <PortalCard
          title="Government portal"
          who="Agriculture ministries, disaster agencies"
          icon={Building2}
          color="#10b981"
          href="/dashboard/government"
          mock={<GovMock list={list} />}
          features={["National and district risk map", "Pre-position pumps, sandbags, boats", "Broadcast alerts to registered farmers", "Policy briefs and monthly reports"]}
        />
        <PortalCard
          title="Supply chain portal"
          who="Traders, processors, insurers, lenders"
          icon={Truck}
          color="#f59e0b"
          href="/dashboard/supply-chain"
          mock={<ScMock list={list} />}
          features={["Commodity exposure by sourcing region", "Disruption scenarios and price impact", "Alternate sourcing suggestions", "Signed webhooks into your ERP"]}
        />
      </div>
    </section>
  );
}
