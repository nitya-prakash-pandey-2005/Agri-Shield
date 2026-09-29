import type { Metadata } from "next";
import { publicStatus } from "@/server/services/incidents";
import { PublicStatusView } from "@/components/incidents/PublicStatusView";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = publicStatus(slug);
  if (!s) return { title: "Status page", robots: { index: false } };
  return {
    title: `${s.statusMeta.label}: ${s.title} — ${s.org.shortName || s.org.name}`,
    description: s.updates[0]?.body.slice(0, 180) ?? s.statusMeta.meaning,
    robots: { index: false, follow: false },
  };
}

export default async function StatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicStatusView slug={slug} />;
}
