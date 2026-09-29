import type { Metadata } from "next";
import { PublicShell } from "@/components/help/PublicShell";

export const metadata: Metadata = {
  title: "Trust centre",
  description: "How Agri-SHIELD handles security, data residency, privacy and service levels — and every data provider we rely on.",
};

export default function TrustLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
