import type { Metadata } from "next";
import { getSnapshot } from "@/server/services/explorer-reports";
import { SharedReportView } from "@/components/explorer/SharedReportView";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = getSnapshot(id);
  if (!r) return { title: "Shared report", robots: { index: false } };
  const loc = r.report.location;
  return {
    title: r.title,
    description: `${r.report.composite.level.toUpperCase()} climate risk (${r.report.composite.score}/100) at ${loc.name ?? `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`}. ${r.report.composite.drivers[0] ?? ""}`,
    robots: { index: false, follow: false },
  };
}

export default async function SharedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SharedReportView id={id} />;
}
