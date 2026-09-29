import type { Metadata } from "next";
import "@/components/landing/landing.css";
import { SiteNav } from "@/components/landing/SiteNav";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { Hero } from "@/components/landing/Hero";
import { ProblemSection } from "@/components/landing/ProblemSection";
import { PipelineSection } from "@/components/landing/PipelineSection";
import { PortalsSection } from "@/components/landing/PortalsSection";
import { ImpactSection } from "@/components/landing/ImpactSection";
import { DemoMapSection, PricingTeaser, RequestDemoSection } from "@/components/landing/Sections";
import { CapabilityMap, DataSourcesStrip, ExploreCta, IndustrySwitcher, RolloutTimeline, TrustStrip } from "@/components/landing/B2BSections";

export const metadata: Metadata = {
  title: { absolute: "Agri-SHIELD — Climate-risk intelligence for insurers, lenders, agribusiness and governments" },
  description:
    "Live flood, salinity, drought and heat risk for every plot, loan, facility and community you hold, for any location on Earth. Portfolio monitoring, alert rules, insurance, lending and anticipatory-action workflows, built on open NASA, Copernicus and Open-Meteo data.",
  alternates: { canonical: "/" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Agri-SHIELD",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web, Android, iOS (PWA)",
  description:
    "Climate-risk intelligence SaaS: live flood, salinity, drought and heat risk for insurers, banks and MFIs, agribusiness, governments, NGOs, co-operatives and farmers.",
  author: { "@type": "Person", name: "Nitya Prakash Pandey" },
  offers: [
    { "@type": "Offer", name: "Farmer Basic", price: "0", priceCurrency: "USD" },
    { "@type": "Offer", name: "Farmer Pro", price: "199", priceCurrency: "INR" },
    { "@type": "Offer", name: "Government Basic", price: "299", priceCurrency: "USD" },
    { "@type": "Offer", name: "Supply Chain", price: "499", priceCurrency: "USD" },
    { "@type": "Offer", name: "Business", price: "1490", priceCurrency: "USD" },
    {
      "@type": "Offer",
      name: "Enterprise",
      priceCurrency: "USD",
      priceSpecification: { "@type": "UnitPriceSpecification", minPrice: "4900", priceCurrency: "USD", unitText: "MONTH" },
    },
  ],
};

export default function LandingPage() {
  return (
    <div className="site-shell min-h-screen overflow-x-clip">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteNav />
      <main id="main">
        <Hero />
        <IndustrySwitcher />
        <ProblemSection />
        <CapabilityMap />
        <ExploreCta />
        <PipelineSection />
        <DataSourcesStrip />
        <PortalsSection />
        <DemoMapSection />
        <RolloutTimeline />
        <ImpactSection />
        <TrustStrip />
        <PricingTeaser />
        <RequestDemoSection />
      </main>
      <SiteFooter />
    </div>
  );
}
