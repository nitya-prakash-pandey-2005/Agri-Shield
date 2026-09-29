import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LocaleRoot } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Set up your farm" };

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <LocaleRoot>
      <div className="min-h-screen hud-bg text-slate-200">{children}</div>
    </LocaleRoot>
  );
}
