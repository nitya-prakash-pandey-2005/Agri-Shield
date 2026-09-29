import type { Metadata } from "next";
import { PublicShell } from "@/components/help/PublicShell";

export const metadata: Metadata = {
  title: "System status",
  description: "Live health of the Agri-SHIELD platform and every open-data source it depends on, from real probes.",
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
