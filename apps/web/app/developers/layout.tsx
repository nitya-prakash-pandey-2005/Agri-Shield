import type { Metadata } from "next";
import { PublicShell } from "@/components/help/PublicShell";

export const metadata: Metadata = {
  title: "Developers",
  description: "Agri-SHIELD developer portal — REST API for climate risk, authentication, rate limits, signed webhooks and quickstarts in curl, Python, JavaScript and Go.",
  alternates: { canonical: "/developers" },
};

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
