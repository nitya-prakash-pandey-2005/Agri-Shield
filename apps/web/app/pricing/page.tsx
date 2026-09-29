import type { Metadata } from "next";
import "@/components/landing/landing.css";
import { SiteNav } from "@/components/landing/SiteNav";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { PricingClient } from "./PricingClient";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free flood alerts for farmers. Farmer Pro from ₹199/month. Government and supply-chain plans with a 14-day free trial, no card required.",
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
