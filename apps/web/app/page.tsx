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

export const metadata: Metadata = {
  title: { absolute: "Agri-SHIELD — Act before the flood hits. Save before the salt spreads." },
  description:
    "Live 72-hour flood and saltwater-intrusion intelligence for farmers, governments and supply chains across Asia, built on open NASA, Copernicus and Open-Meteo data.",
  alternates: { canonical: "/" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Agri-SHIELD",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web, Android, iOS (PWA)",
  description: "AI-powered climate decision intelligence: flood and salinity early warning for farmers, governments and supply chains in Asia.",
  author: { "@type": "Person", name: "Nitya Prakash Pandey" },
  offers: [
    { "@type": "Offer", name: "Farmer Basic", price: "0", priceCurrency: "USD" },
    { "@type": "Offer", name: "Farmer Pro", price: "199", priceCurrency: "INR" },
    { "@type": "Offer", name: "Government Basic", price: "299", priceCurrency: "USD" },
    { "@type": "Offer", name: "Supply Chain", price: "499", priceCurrency: "USD" },
  ],
};

export default function LandingPage() {
  return (
    <div className="site-shell min-h-screen overflow-x-clip">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteNav />
      <main id="main">
        <Hero />
        <ProblemSection />
        <PipelineSection />
        <PortalsSection />
        <DemoMapSection />
        <ImpactSection />
        <PricingTeaser />
        <RequestDemoSection />
      </main>
      <SiteFooter />
    </div>
  );
}
