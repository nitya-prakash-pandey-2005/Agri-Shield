import type { Metadata } from "next";
import "@/components/landing/landing.css";
import { SiteNav } from "@/components/landing/SiteNav";
import { CheckoutClient } from "./CheckoutClient";
import { planById, type BillingInterval, type CurrencyCode } from "../plans";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

const CURRENCIES = ["USD", "INR", "BDT", "VND", "PHP", "IDR"];

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const plan = planById(one("plan") ?? "") ?? planById("farmer_pro")!;
  const interval: BillingInterval = one("interval") === "year" ? "year" : "month";
  const cur = one("currency") ?? "USD";
  const currency = (CURRENCIES.includes(cur) ? cur : "USD") as CurrencyCode;
  return (
    <div className="site-shell min-h-screen">
      <SiteNav />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-24 pt-24 sm:px-6">
        <CheckoutClient planId={plan.id} interval={interval} currency={currency} returnStatus={one("status") ?? null} provider={one("provider") ?? null} sessionId={one("session_id") ?? null} />
      </main>
    </div>
  );
}
