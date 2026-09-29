import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FlaskConical } from "lucide-react";
import { MarketingShell, PageHero } from "@/components/marketing/MarketingShell";
import { DemoLoginButton } from "@/components/marketing/DemoLoginButton";
import { industryById, type IndustryId } from "@/components/marketing/industries";

export const metadata: Metadata = {
  title: "Pilot scenarios",
  description: "Illustrative pilot scenarios showing how insurers, banks, NGOs, co-operatives and agribusinesses would run Agri-SHIELD. Not customer testimonials.",
  alternates: { canonical: "/customers" },
};

interface Scenario {
  industry: IndustryId;
  who: string;
  region: string;
  situation: string;
  setup: string[];
  sequence: { when: string; what: string }[];
  measures: string[];
}

const SCENARIOS: Scenario[] = [
  {
    industry: "insurance",
    who: "A regional agricultural insurer",
    region: "Coastal Bangladesh · monsoon season",
    situation: "About 140 insured rice and jute plots, half on a rainfall-index product with a 150 mm / 72 h payout trigger. Underwriting learned about trigger events from farmers' calls.",
    setup: ["Imported policies from a CSV export", "Rule: 72 h rain ≥ 120 mm on parametric plots → warn underwriting", "Rule: flood probability > 60% on coastal plots → SMS claims team"],
    sequence: [
      { when: "T − 3 days", what: "Watch rule fires on plots in two districts; finance is told a payout is plausible." },
      { when: "T − 2 days", what: "Advisory SMS to indemnity policyholders: drain seedbeds, move stored fertiliser." },
      { when: "T + 1 day", what: "Claims team triages from the plot evidence pack; field visits only where evidence is ambiguous." },
    ],
    measures: [
      "Hours of notice before trigger",
      "Share of claims triaged remotely",
      "Claim settlement time",
    ],
  },
  {
    industry: "banking",
    who: "A rural credit bank",
    region: "Mekong Delta · dry-season salinity",
    situation: "About 160 crop loans, many to rice farmers in districts where salt intrusion is rising. Arrears arrive in clusters after bad salinity seasons.",
    setup: ["Loan book imported without personal data", "Rule: forecast salinity > 3 dS/m on rice loans → notify credit analysts", "Weekly watch-list to branch managers"],
    sequence: [
      { when: "Weeks ahead", what: "Salinity outlook flags rice loans in two provinces." },
      { when: "Before planting", what: "Officers call flagged borrowers: salt-tolerant varieties, delayed sowing, restructuring options." },
      { when: "Quarter end", what: "Physical-risk summary by province and crop exported for the risk committee." },
    ],
    measures: [
      "Flagged borrowers contacted before planting",
      "Arrears rate: flagged vs unflagged",
      "Officer visits per loan",
    ],
  },
  {
    industry: "ngo",
    who: "A humanitarian NGO",
    region: "Bangladesh coastal belt · cyclone season",
    situation: "48 at-risk communities with a pre-arranged cash envelope per household. Release decisions were made in meetings after landfall.",
    setup: ["Communities imported with households and shelter distance", "Readiness at 50% flood probability; activation at 70% within 72 h", "SMS + WhatsApp to field coordinators"],
    sequence: [
      { when: "T − 72 h", what: "Readiness stage for the communities in the cyclone's forecast path; teams verify beneficiary lists." },
      { when: "T − 48 h", what: "Activation: cash released to households in communities above the threshold." },
      { when: "After", what: "Trigger log with forecast evidence exported for the donor report." },
    ],
    measures: [
      "Lead time between activation and peak",
      "Households paid before the peak",
      "Cost per household reached",
    ],
  },
  {
    industry: "cooperative",
    who: "A farmer producer co-operative",
    region: "Odisha coast, India · kharif season",
    situation: "90 member farms growing paddy and vegetables near tidal rivers. Two agronomists visit farms in rotation.",
    setup: ["Member farms registered with crops and irrigation type", "Advisory rules in Odia by SMS", "Weekly committee review of the 30-day outlook"],
    sequence: [
      { when: "Weekly", what: "Agronomists visit the flagged farms first instead of rotating." },
      { when: "Before high tide", what: "Committee closes sluice gates when the salinity outlook turns orange." },
      { when: "Season end", what: "Board report of advisories sent and actions logged by members." },
    ],
    measures: [
      "Members acting on advisories",
      "Agronomist visits to at-risk farms",
      "Yield on flagged vs unflagged farms",
    ],
  },
  {
    industry: "agribusiness",
    who: "A grain trading and logistics company",
    region: "South & South-East Asia",
    situation: "19 mills, warehouses and river ports. Floods caused short-notice re-routing and spoiled stock each year.",
    setup: ["Facilities imported from the ERP", "Rule: flood probability > 55% at ports and warehouses → Slack to logistics", "Disruption scenarios per commodity"],
    sequence: [
      { when: "T − 4 days", what: "Warehouse in a flood-prone district flagged; stock moved to an upland site." },
      { when: "T − 3 days", what: "Shipments re-booked through an unaffected port at normal rates." },
      { when: "Monthly", what: "Exposure trend and avoided re-routings reviewed with finance." },
    ],
    measures: [
      "Re-routings planned vs short-notice",
      "Stock losses at flagged sites",
      "Expedite fees",
    ],
  },
];

export default function CustomersPage() {
  return (
    <MarketingShell>
      <PageHero eyebrow="Pilot scenarios" title="How organisations would run Agri-SHIELD in a four-week pilot.">
        <p>
          These are <strong className="text-slate-200">illustrative pilot scenarios</strong>, written to show the workflow. They are not customer testimonials, and the organisations described are generic. Each one matches a demo workspace you can open and explore.
        </p>
      </PageHero>
      <section className="mx-auto max-w-7xl space-y-6 px-4 pb-24 sm:px-6">
        {SCENARIOS.map((s) => {
          const ind = industryById(s.industry)!;
          return (
            <article key={s.industry} aria-labelledby={`sc-${s.industry}`} className="overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02]">
              <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-5 py-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-xs font-medium text-amber-200">
                  <FlaskConical size={12} aria-hidden /> Illustrative pilot scenario
                </span>
                <span className="text-xs" style={{ color: ind.accent }}>
                  {ind.title}
                </span>
                <span className="ml-auto text-xs text-slate-500">{s.region}</span>
              </div>
              <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_1.1fr_0.8fr]">
                <div>
                  <h2 id={`sc-${s.industry}`} className="font-display text-xl font-semibold text-white">
                    {s.who}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.situation}</p>
                  <h3 className="mt-4 text-xs uppercase tracking-wider text-slate-500">Set up in week 1</h3>
                  <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
                    {s.setup.map((x) => (
                      <li key={x} className="flex gap-2">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-500" aria-hidden />
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-slate-500">How an event would play out</h3>
                  <ol className="mt-3 space-y-3 border-l border-white/10 pl-4">
                    {s.sequence.map((q) => (
                      <li key={q.when} className="relative">
                        <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full" style={{ background: ind.accent }} aria-hidden />
                        <div className="telemetry text-xs text-slate-400">{q.when}</div>
                        <div className="text-sm text-slate-200">{q.what}</div>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/[0.06] bg-black/20 p-4">
                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-slate-500">What the pilot would measure</h3>
                    <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
                      {s.measures.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col gap-2">
                    <DemoLoginButton demo={ind.demo} label="Open this workspace" className="!min-h-[44px] !px-4 !text-sm" />
                    <Link href={`/solutions/${s.industry}`} className="inline-flex items-center gap-1.5 text-sm text-emerald-300 hover:text-emerald-200">
                      {ind.title} solution <ArrowRight size={14} aria-hidden />
                    </Link>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
        <p className="text-center text-sm text-slate-500">
          Running a real pilot?{" "}
          <Link href="/book-demo" className="text-emerald-300 hover:text-emerald-200">
            Book a demo
          </Link>{" "}
          and we’ll agree the success criteria with you up front.
        </p>
      </section>
    </MarketingShell>
  );
}
