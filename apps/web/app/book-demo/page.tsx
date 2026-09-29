import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { MarketingShell, PageHero } from "@/components/marketing/MarketingShell";
import { BookDemoClient } from "@/components/marketing/BookDemoClient";
import { industryById, type IndustryId } from "@/components/marketing/industries";

export const metadata: Metadata = {
  title: "Book a demo",
  description: "Pick a 30-minute slot in your own timezone for a walkthrough of Agri-SHIELD on live data for your locations.",
  alternates: { canonical: "/book-demo" },
};

export default async function BookDemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const ind = industryById(one("industry") ?? "");
  const plan = one("plan");
  return (
    <MarketingShell>
      <PageHero eyebrow="Book a demo" title={ind ? `See Agri-SHIELD for ${ind.title.toLowerCase()}.` : "See Agri-SHIELD on your own locations."} accent={ind?.accent}>
        <ul className="mt-1 flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
          {["30 minutes, on live data", "Tailored to your industry and region", "Sandbox logins for your team afterwards"].map((x) => (
            <li key={x} className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-400" aria-hidden /> {x}
            </li>
          ))}
        </ul>
      </PageHero>
      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <BookDemoClient initialIndustry={(ind?.id as IndustryId | undefined) ?? null} plan={plan === "enterprise" || plan === "business" ? plan : null} />
      </section>
    </MarketingShell>
  );
}
