import type { Metadata } from "next";
import { Suspense } from "react";
import { ExplorerApp } from "@/components/explorer/ExplorerApp";

export const metadata: Metadata = {
  title: "Risk Explorer",
  description: "Climate due-diligence for any place on Earth: flood, salinity, drought, heat, 40-year climate trends and 2050 projections.",
};

export default function ExplorerPage() {
  return (
    <Suspense fallback={<div className="-m-4 h-[calc(100dvh-3.5rem)] hud-bg md:-m-6 lg:-m-8" />}>
      <ExplorerApp />
    </Suspense>
  );
}
