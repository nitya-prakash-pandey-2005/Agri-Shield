import type { Metadata } from "next";
import { Suspense } from "react";
import "@/components/landing/landing.css";
import { SiteNav } from "@/components/landing/SiteNav";
import { PublicExplorer } from "@/components/explorer/PublicExplorer";

export const metadata: Metadata = {
  title: "Explore climate risk for any place",
  description: "Free climate-risk check for any location on Earth: flood probability, rain forecast with uncertainty, drought and heat stress. Powered by ECMWF, Copernicus GloFAS and NASA data.",
  alternates: { canonical: "/explore" },
};

export default function ExplorePage() {
  return (
    <div className="site-shell min-h-screen overflow-x-clip">
      <SiteNav />
      <main id="main" className="pt-16">
        <Suspense fallback={<div className="h-[calc(100dvh-4rem)] hud-bg" />}>
          <PublicExplorer />
        </Suspense>
      </main>
    </div>
  );
}
