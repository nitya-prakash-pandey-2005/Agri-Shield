import type { Metadata } from "next";
import "@/components/landing/landing.css";
import { SiteNav } from "@/components/landing/SiteNav";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { PricingClient } from "./PricingClient";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Business workspace $1,490/month and Enterprise from $4,900/month for insurers, lenders, agribusiness, NGOs and co-ops. Free flood alerts for farmers; government and supply-chain plans with a 14-day free trial.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <div className="site-shell min-h-screen overflow-x-clip">
      <SiteNav />
      <main id="main" className="pt-16">
        <PricingClient />
      </main>
      <SiteFooter />
    </div>
  );
}
