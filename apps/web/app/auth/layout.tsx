import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LocaleRoot } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Sign in" };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <LocaleRoot>{children}</LocaleRoot>;
}
