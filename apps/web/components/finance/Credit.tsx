"use client";

/**
 * Climate-adjusted credit risk per loan: sortable/filterable loan table and a
 * drill-down explaining PD, LGD, EAD and expected loss in plain language.
 */
import { useMemo, useState } from "react";
import { ArrowDownRight, Download, Search, X } from "lucide-react";
import { Panel, RiskPill } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import { Btn, downloadFile, inputCls, pct, Select, toCsv, usd, VIZ, WhatThisMeans } from "@/components/insurance/kit";
import type { RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export type FinBook = RouterOutputs["finance"]["book"];
export type Loan = FinBook["loans"][number];

const RATING_COLOR: Record<string, string> = { A: "#4ade80", BBB: "#a3e635", BB: "#fbbf24", B: "#fb923c", CCC: "#f87171", D: "#a78bfa" };
export const RatingBadge = ({ r }: { r: string }) => (
  <span className="inline-block min-w-[34px] rounded px-1.5 py-0.5 text-center text-[10.5px] font-semibold telemetry" style={{ background: `${RATING_COLOR[r] ?? "#94a3b8"}22`, color: RATING_COLOR[r] ?? "#94a3b8" }}>
    {r}
  </span>
);
const HZ_COLOR: Record<string, string> = { flood: VIZ.s1, drought: VIZ.s4, salinity: VIZ.s3, heat: VIZ.s2 };

type SortKey = "notches" | "elUpliftUsd" | "pdClimate" | "eadUsd" | "name";

export default function Credit({ book, onOpen, selected }: { book: FinBook; onOpen: (id: string | null) => void; selected: string | null }) {
  const [q, setQ] = useState("");
  const [crop, setCrop] = useState("");
  const [country, setCountry] = useState("");
  const [sort, setSort] = useState<SortKey>("elUpliftUsd");
  const loans = book.loans;
  const crops = useMemo(() => [...new Set(loans.map((l) => l.crop ?? "other"))].sort(), [loans]);
  const countries = useMemo(() => [...new Set(loans.map((l) => l.country))].sort(), [loans]);
  const rows = useMemo(
    () =>
      loans
        .filter((l) => (!q || `${l.name} ${l.ref} ${l.region}`.toLowerCase().includes(q.toLowerCase())) && (!crop || (l.crop ?? "other") === crop) && (!country || l.country === country))
        .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : (b[sort] as number) - (a[sort] as number))),
    [loans, q, crop, country, sort]
  );
  const sel = loans.find((l) => l.id === selected) ?? rows[0] ?? null;
  const s = book.summary;
  return (
    <div className="space-y-4">
      <WhatThisMeans>
        Across <b className="text-white">{s.loans} loans</b> ({usd(s.eadUsd)} outstanding), weather and water risks raise the average annual probability of default from <b className="text-white">{pct(s.pdBasePct, 1)}</b> to <b className="text-amber-200">{pct(s.pdClimatePct, 1)}</b>, lifting expected credit loss by <b className="text-amber-200">{usd(s.elUpliftUsd)}</b> (+{pct(s.elUpliftPct, 0)}). {s.downgraded} loans would sit at least one rating notch lower once climate is priced in. Click any loan for the reasons.
      </WhatThisMeans>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Loan book — climate-adjusted"
          subtitle={`${rows.length} of ${loans.length} loans`}
          accent="cyan"
          bodyClassName="px-0 pb-2"
          actions={
            <Btn variant="outline" onClick={() => downloadFile("climate-adjusted-loans.csv", toCsv(rows.map((l) => ({ ref: l.ref, name: l.name, region: l.region, country: l.country, crop: l.crop, collateral: l.collateral, ead_usd: l.eadUsd, dpd: l.dpd, rating_base: l.ratingBase, rating_climate: l.ratingClimate, pd_base_pct: (l.pdBase * 100).toFixed(2), pd_climate_pct: (l.pdClimate * 100).toFixed(2), lgd_pct: (l.lgd * 100).toFixed(1), el_base_usd: l.elBaseUsd.toFixed(0), el_climate_usd: l.elUsd.toFixed(0), lifetime_el_usd: l.lifetimeElUsd.toFixed(0) }))))}>
              <Download size={13} /> CSV
            </Btn>
          }
        >
          <div className="grid gap-2 px-4 pb-2 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input className={cn(inputCls, "pl-7")} placeholder="Search borrower, account, region" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={crop} onChange={setCrop} options={[{ value: "", label: "All crops" }, ...crops.map((c) => ({ value: c, label: c }))]} ariaLabel="Crop" />
            <Select value={country} onChange={setCountry} options={[{ value: "", label: "All countries" }, ...countries.map((c) => ({ value: c, label: c }))]} ariaLabel="Country" />
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[720px] text-[12.5px]">
              <thead className="sticky top-0 z-10 bg-[#0a1122]">
                <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <Th onClick={() => setSort("name")} active={sort === "name"} className="px-4">
                    Borrower
                  </Th>
                  <Th onClick={() => setSort("eadUsd")} active={sort === "eadUsd"} right>
                    <Explain term="ead">EAD</Explain>
                  </Th>
                  <Th onClick={() => setSort("notches")} active={sort === "notches"}>
                    Rating
                  </Th>
                  <Th onClick={() => setSort("pdClimate")} active={sort === "pdClimate"} right>
                    <Explain term="pd">PD</Explain> base → climate
                  </Th>
                  <Th onClick={() => setSort("elUpliftUsd")} active={sort === "elUpliftUsd"} right className="px-4">
                    EL uplift
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} onClick={() => onOpen(l.id)} className={cn("cursor-pointer border-b border-slate-800/60 hover:bg-white/[0.03]", sel?.id === l.id && "bg-cyan-400/[0.07]")}>
                    <td className="px-4 py-1.5">
                      <div className="text-slate-200">{l.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {l.ref} · {l.region}, {l.country} · {l.crop}
                        {l.dpd > 0 && <span className="text-rose-300"> · {l.dpd} DPD</span>}
                        {l.activeHazard && <span className="text-amber-300"> · ⚠ {l.activeHazard}</span>}
                      </div>
                    </td>
                    <td className="py-1.5 text-right telemetry text-slate-300">{usd(l.eadUsd)}</td>
                    <td className="py-1.5">
                      <span className="inline-flex items-center gap-1">
                        <RatingBadge r={l.ratingBase} />
                        {l.notches > 0 && <ArrowDownRight size={12} className="text-rose-400" />}
                        {l.notches > 0 && <RatingBadge r={l.ratingClimate} />}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-1.5 pl-2 text-right telemetry text-slate-300">
                      {pct(l.pdBase * 100, 1)} → <span className={l.pdClimate - l.pdBase > 0.02 ? "text-amber-300" : "text-slate-100"}>{pct(l.pdClimate * 100, 1)}</span>
                    </td>
                    <td className="px-4 py-1.5 text-right telemetry text-amber-200">+{usd(l.elUpliftUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <LoanDetail loan={sel} onClose={() => onOpen(null)} />
      </div>
    </div>
  );
}

function Th({ children, onClick, active, right, className }: { children: React.ReactNode; onClick: () => void; active: boolean; right?: boolean; className?: string }) {
  return (
    <th className={cn("py-2 font-medium", right && "text-right", className)}>
      <button onClick={onClick} className={cn("hover:text-slate-200", active && "text-cyan-300")}>
        {children}
        {active && " ↓"}
      </button>
    </th>
  );
}

export function LoanDetail({ loan: l, onClose }: { loan: Loan | null; onClose: () => void }) {
  if (!l)
    return (
      <Panel title="Loan drill-down" accent="cyan">
        <p className="text-[13px] text-slate-400">Select a loan to see how its climate-adjusted probability of default, loss given default and expected loss are built — and why.</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11.5px] text-slate-400">
          <div className="rounded-lg bg-slate-900/60 p-2">
            <Explain term="pd">PD</Explain> — chance the borrower defaults within a year
          </div>
          <div className="rounded-lg bg-slate-900/60 p-2">
            <Explain term="lgd">LGD</Explain> — share of the balance lost if they do
          </div>
          <div className="rounded-lg bg-slate-900/60 p-2">
            <Explain term="ead">EAD</Explain> — amount owed at default
          </div>
        </div>
      </Panel>
    );
  const hz = (["flood", "drought", "salinity", "heat"] as const).map((h) => ({ h, p: l.hazardProb[h], pp: l.hazardContribPp[h] }));
  const maxPp = Math.max(0.01, ...hz.map((x) => x.pp));
  return (
    <Panel
      title={l.name}
      subtitle={`${l.ref} · ${l.region}, ${l.country} · ${l.crop} · ${l.segment}`}
      accent="cyan"
      actions={
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-white/5" aria-label="Close">
          <X size={14} />
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-[12px] text-slate-400">
            Rating <RatingBadge r={l.ratingBase} /> → <RatingBadge r={l.ratingClimate} />
            {l.notches > 0 && <span className="text-rose-300">({l.notches} notch{l.notches > 1 ? "es" : ""} down)</span>}
          </div>
          {l.live && <RiskPill level={l.live.composite >= 80 ? "critical" : l.live.composite >= 60 ? "high" : l.live.composite >= 35 ? "medium" : "low"} />}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Box k={<Explain term="pd">PD (12 m)</Explain>} v={`${pct(l.pdBase * 100, 2)} → ${pct(l.pdClimate * 100, 2)}`} />
          <Box k={<Explain term="lgd">LGD</Explain>} v={`${pct(l.lgdBase * 100, 0)} → ${pct(l.lgd * 100, 0)}`} />
          <Box k={<Explain term="ead">EAD</Explain>} v={usd(l.eadUsd)} sub={`of ${usd(l.principalUsd)} principal`} />
          <Box k={<Explain term="expected_credit_loss">Expected loss</Explain>} v={usd(l.elUsd)} sub={`base ${usd(l.elBaseUsd)} · lifetime ${usd(l.lifetimeElUsd)}`} />
        </div>
        <div>
          <div className="mb-1 text-[12px] text-slate-400">Where the extra default risk comes from (percentage points of PD)</div>
          <div className="space-y-1.5">
            {hz.map((x) => (
              <div key={x.h} className="flex items-center gap-2 text-[12px]">
                <span className="w-16 capitalize text-slate-300">{x.h}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full" style={{ width: `${(x.pp / maxPp) * 100}%`, background: HZ_COLOR[x.h] }} />
                </div>
                <span className="w-24 text-right telemetry text-slate-300">
                  +{x.pp.toFixed(2)} pp <span className="text-slate-500">({Math.round(x.p * 100)}%/yr)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-sky-400/15 bg-sky-400/[0.04] p-3">
          <div className="hud-label mb-1 text-sky-300">Why — in plain language</div>
          <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-slate-300">
            {l.drivers.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-3 gap-2 text-[11.5px] text-slate-400">
          <div>
            Collateral: <b className="text-slate-200">{l.collateral}</b>
          </div>
          <div>
            Tenor: <b className="text-slate-200">{l.tenorMonths} m</b> ({l.remainingMonths} left)
          </div>
          <div>
            Arrears: <b className={l.dpd ? "text-rose-300" : "text-slate-200"}>{l.dpd} DPD</b> · Stage {l.stage}
          </div>
        </div>
        <div className="text-[10.5px] text-slate-500">Hazard frequencies from {l.dataSource === "reanalysis" ? "35 years of ERA5/GloFAS reanalysis at the district reference point" : "district exposure priors (reanalysis still loading)"}; live forecast from the portfolio scoring engine.</div>
      </div>
    </Panel>
  );
}

function Box({ k, v, sub }: { k: React.ReactNode; v: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-900/60 px-2 py-2">
      <div className="text-[10.5px] text-slate-500">{k}</div>
      <div className="telemetry text-[13px] text-slate-100">{v}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
