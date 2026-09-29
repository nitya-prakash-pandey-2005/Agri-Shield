import type { Metadata } from "next";
import { getByShareToken } from "@/server/services/dashboards";
import { SharedDashboard } from "@/components/dashboards/Board";

/** Public, read-only shared dashboard (the token is the capability). */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const d = getByShareToken(token);
  return {
    title: d ? d.name : "Shared dashboard",
    description: d ? `Live climate-risk dashboard: ${d.description || `${d.widgets.length} widgets`}` : "Shared Agri-SHIELD dashboard",
    robots: { index: false, follow: false },
  };
}

export default async function SharedDashboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedDashboard token={token} />;
}
