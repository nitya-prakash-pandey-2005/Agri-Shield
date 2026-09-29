import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Minus, CircleDot } from "lucide-react";
import { Faq, MarketingShell, PageHero, SectionTitle } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = {
  title: "Compare approaches",
  description: "An honest comparison of Agri-SHIELD with the categories of tools organisations use today: weather APIs, government flood portals, farm-management apps, climate-risk analytics vendors and spreadsheets.",
  alternates: { canonical: "/compare" },
};

type V = "yes" | "partial" | "no";
const COLS = ["Agri-SHIELD", "Generic weather APIs", "Government flood portals", "Farm-management apps", "Climate-risk analytics vendors", "Spreadsheets"] as const;

/** [capability, note, ...six cells] — "typical" for each category; individual products vary. */
const ROWS: { cap: string; note?: string; cells: [V, V, V, V, V, V] }[] = [
  { cap: "Short-range forecast (0-7 days) for any coordinate", cells: ["yes", "yes", "partial", "partial", "partial", "no"] },
  { cap: "Flood probability, not just rainfall", note: "Rain in mm vs. probability the field floods", cells: ["yes", "no", "yes", "no", "partial", "no"] },
  { cap: "Saltwater-intrusion (salinity) forecast", cells: ["yes", "no", "partial", "no", "no", "no"] },
  { cap: "Score your own portfolio of assets", note: "Plots, loans, facilities, communities", cells: ["yes", "no", "no", "partial", "yes", "partial"] },
  { cap: "Re-scored automatically as forecasts change", cells: ["yes", "partial", "no", "partial", "partial", "no"] },
  { cap: "Alert rules to email / SMS / webhook", cells: ["yes", "partial", "partial", "partial", "partial", "no"] },
  { cap: "Insurance, lending and anticipatory-action workflows", cells: ["yes", "no", "no", "no", "partial", "partial"] },
  { cap: "Farmer-facing app and SMS in local languages", cells: ["yes", "no", "partial", "yes", "no", "no"] },
  { cap: "Plain-language explanation of every score", cells: ["yes", "no", "partial", "partial", "partial", "no"] },
  { cap: "Long-term climate scenarios (2030-2100)", cells: ["partial", "partial", "no", "no", "yes", "no"] },
  { cap: "Regulatory climate-disclosure reports", cells: ["partial", "no", "no", "no", "yes", "partial"] },
  { cap: "Official warning authority", note: "The legal source of evacuation orders", cells: ["no", "no", "yes", "no", "no", "no"] },
  { cap: "Field operations records (inputs, labour, harvest)", cells: ["no", "no", "no", "yes", "no", "partial"] },
  { cap: "Open, documented data sources and methodology", cells: ["yes", "partial", "yes", "partial", "partial", "no"] },
  { cap: "Self-serve trial, priced for emerging markets", cells: ["yes", "yes", "yes", "yes", "partial", "yes"] },
];

const BETTER = [
  { cat: "Generic weather APIs", when: "You only need raw forecast variables inside your own product and have a data-science team to turn them into risk scores." },
  { cat: "Government flood portals", when: "You need the official warning of record. They are the legal authority for evacuation and are free. We ingest public data and complement them; we never replace them." },
  { cat: "Farm-management apps", when: "The job is running the farm: input records, labour, traceability and agronomy plans. Many co-ops use one alongside Agri-SHIELD." },
  { cat: "Climate-risk analytics vendors", when: "You need long-horizon scenario analysis (2050+, multiple emissions pathways) for regulatory disclosure across global real-estate or corporate assets. Our strength is the next 72 hours to the next season." },
  { cat: "Spreadsheets", when: "You have a handful of locations, no need for alerts, and an analyst with time to update them by hand." },
];

function Cell({ v }: { v: V }) {
  if (v === "yes") return <Check size={17} className="mx-auto text-emerald-400" aria-label="Yes" />;
  if (v === "partial") return <CircleDot size={15} className="mx-auto text-amber-300" aria-label="Partly or in some products" />;
  return <Minus size={16} className="mx-auto text-slate-600" aria-label="No" />;
}

export default function ComparePage() {
  return (
    <MarketingShell>
      <PageHero eyebrow="Compare approaches" title="How Agri-SHIELD compares with what you use today.">
        We compare against <em>categories</em> of tools, not named products, because individual products differ and change. Where another approach is the better choice, we say so.
      </PageHero>

      <section aria-labelledby="matrix" className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <h2 id="matrix" className="sr-only">
          Capability matrix
        </h2>
        <div className="flex flex-wrap gap-4 pb-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Check size={14} className="text-emerald-400" aria-hidden /> Typically yes
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CircleDot size={13} className="text-amber-300" aria-hidden /> Partly, or only in some products
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Minus size={14} className="text-slate-600" aria-hidden /> Typically no
          </span>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <caption className="sr-only">Capabilities of Agri-SHIELD and five categories of alternative tools</caption>
            <thead>
              <tr className="bg-white/[0.03]">
                <th scope="col" className="sticky left-0 z-10 w-[30%] bg-[#0a1120] px-4 py-3 text-left font-medium text-slate-400">
                  Capability
                </th>
                {COLS.map((c, i) => (
                  <th key={c} scope="col" className={i === 0 ? "bg-emerald-400/[0.06] px-3 py-3 text-center font-semibold text-emerald-200" : "px-3 py-3 text-center font-medium text-slate-300"}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.cap} className="border-t border-white/[0.05]">
                  <th scope="row" className="sticky left-0 z-10 bg-[#050a14] px-4 py-3 text-left font-normal text-slate-200">
                    {r.cap}
                    {r.note && <div className="text-xs text-slate-500">{r.note}</div>}
                  </th>
                  {r.cells.map((v, i) => (
                    <td key={i} className={i === 0 ? "bg-emerald-400/[0.04] px-3 py-3" : "px-3 py-3"}>
                      <Cell v={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          “Partly” for Agri-SHIELD on long-term scenarios and disclosure: we provide CMIP6-based projections and exportable physical-risk summaries, not a full regulatory reporting suite.
        </p>
      </section>

      <section aria-labelledby="better" className="border-y border-white/[0.05] bg-white/[0.015]">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <SectionTitle eyebrow="Honesty section" title="When another approach is the better choice" id="better" />
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {BETTER.map((b) => (
              <li key={b.cat} className="rounded-2xl border border-white/[0.08] bg-[#050a14] p-5">
                <h3 className="font-display text-base font-semibold text-white">{b.cat}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{b.when}</p>
              </li>
            ))}
            <li className="rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.04] p-5">
              <h3 className="font-display text-base font-semibold text-white">Agri-SHIELD is the right fit when…</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                you hold farm-linked risk across many locations (policies, loans, facilities, communities or member farms) and need to know which ones need action in the next days to weeks, with alerts and a workflow to act on them.
              </p>
            </li>
          </ul>
        </div>
      </section>

      <section aria-labelledby="cfaq" className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
        <SectionTitle eyebrow="FAQ" title="Common questions" id="cfaq" />
        <Faq
          items={[
            { q: "Why don't you name competitors?", a: "Products change quickly and we can't verify every vendor's current feature set. Comparing categories keeps this page accurate. In a demo we're happy to discuss the specific tools you use." },
            { q: "Can I use Agri-SHIELD alongside my current tools?", a: "Yes, and most customers do. The REST API and webhooks push our scores into your core systems, BI tools or farm-management app." },
            { q: "Is your forecast better than the weather APIs?", a: "We build on the same numerical weather models (via Open-Meteo) plus river discharge and our own flood and salinity models. The difference is what we do with the forecast: risk per asset, explained, with alerts and workflows." },
          ]}
        />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 sm:flex-row sm:items-center">
          <p className="text-slate-300">See the difference on your own locations.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/explore" className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/15 px-5 text-sm text-white hover:border-white/35">
              Explore a location
            </Link>
            <Link href="/book-demo" className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
              Book a demo <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
