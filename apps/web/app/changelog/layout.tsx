import type { Metadata } from "next";
import { PublicShell } from "@/components/help/PublicShell";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Product updates to Agri-SHIELD — new features, improvements and fixes.",
};

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
