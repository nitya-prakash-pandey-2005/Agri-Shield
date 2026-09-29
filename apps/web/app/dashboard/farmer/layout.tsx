import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LocaleRoot } from "@/lib/i18n/server";
import { FarmerShell } from "@/components/farmer/FarmerShell";

export const metadata: Metadata = {
  title: "Farmer Portal",
  description: "Live flood and salinity risk, alerts and AI advice for your fields.",
};

export default function FarmerLayout({ children }: { children: ReactNode }) {
  return (
    <LocaleRoot>
      <FarmerShell>{children}</FarmerShell>
    </LocaleRoot>
  );
}
