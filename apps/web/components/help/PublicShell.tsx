import type { ReactNode } from "react";
import "@/components/landing/landing.css";
import { SiteNav } from "@/components/landing/SiteNav";
import { SiteFooter } from "@/components/landing/SiteFooter";

/** Public-site chrome for Help, Status, Changelog and Trust pages. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell min-h-screen overflow-x-clip">
      <SiteNav />
      <main id="main" className="relative pt-16">
        <div className="site-grid pointer-events-none absolute inset-x-0 top-0 h-[520px]" />
        <div className="relative">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
