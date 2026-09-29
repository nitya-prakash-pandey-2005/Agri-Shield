import type { Metadata } from "next";
import { MarketingShell, PageHero } from "@/components/marketing/MarketingShell";
import { RoiCalculator } from "@/components/marketing/RoiCalculator";
import { ROI_PRESETS, type RoiIndustry } from "@/components/marketing/roi";

export const metadata: Metadata = {
  title: "ROI calculator",
  description: "Estimate avoided losses, claims and monitoring savings, expected-loss reduction and payback for your organisation, with every formula shown.",
  alternates: { canonical: "/roi" },
};

export default async function RoiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const ind = (one("industry") ?? "insurance") as RoiIndustry;
  const industry: RoiIndustry = ind in ROI_PRESETS ? ind : "insurance";
  const values: Record<string, number> = {};
  for (const f of ROI_PRESETS[industry].fields) {
    const v = Number(one(f.key));
    if (one(f.key) !== undefined && Number.isFinite(v) && v >= 0) values[f.key] = v;
  }
  return (
    <MarketingShell>
      <PageHero eyebrow="ROI calculator" title="What is early warning worth to you?">
        Move the sliders to match your organisation. Every result shows the formula behind it, and the link in your address bar keeps your scenario so you can share it.
      </PageHero>
      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <RoiCalculator initialIndustry={industry} initialValues={values} initialPlan={one("plan")} />
      </section>
    </MarketingShell>
  );
}
