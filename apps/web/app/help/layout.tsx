import type { Metadata } from "next";
import { PublicShell } from "@/components/help/PublicShell";

export const metadata: Metadata = {
  title: { default: "Help centre", template: "%s · Help | Agri-SHIELD" },
  description: "Getting started guides for insurers, banks, NGOs, co-operatives, agribusiness and governments; how risk scores work; FAQs; a plain-language glossary; and support.",
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
