import type { Metadata } from "next";
import "@/components/landing/landing.css";
import { SiteNav } from "@/components/landing/SiteNav";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { DocsSidebar } from "@/components/docs/DocsSidebar";
import { searchIndex } from "@/components/docs/registry";

export const metadata: Metadata = {
  title: { default: "Documentation", template: "%s · Docs | Agri-SHIELD" },
  description: "Guides, API reference, methodology, data sources and policies for Agri-SHIELD.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell min-h-screen">
      <SiteNav />
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-24 sm:px-6 lg:flex lg:gap-10">
        <DocsSidebar index={searchIndex()} />
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
