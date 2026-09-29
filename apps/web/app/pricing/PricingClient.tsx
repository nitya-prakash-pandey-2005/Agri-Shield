"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Briefcase, Building2, Check, ChevronDown, CreditCard, Loader2, Minus, ShieldCheck, Sprout, Truck, Wallet } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { LeadForm } from "@/components/landing/LeadForm";
import { cn } from "@/lib/utils";
import { ANNUAL_MONTHS, CURRENCIES, FX, MATRIX, MATRIX_COLUMNS, PLANS, formatMoney, priceFor, type BillingInterval, type CurrencyCode, type Plan, type Cell, type PlanId } from "./plans";

const AUDIENCE_ICON = { farmer: Sprout, government: Building2, supply_chain: Truck, workspace: Briefcase } as const;
const AUDIENCE_LABEL = { farmer: "Farmers", government: "Governments", supply_chain: "Supply chains", workspace: "Companies & NGOs" } as const;

type Tab = "organisations" | "farmers" | "all";
const TABS: { id: Tab; label: string; plans: PlanId[] }[] = [
  { id: "organisations", label: "Organisations", plans: ["business", "enterprise", "supply_chain", "gov_basic", "gov_enterprise"] },
  { id: "farmers", label: "Farmers", plans: ["free", "farmer_pro"] },
  { id: "all", label: "All plans", plans: MATRIX_COLUMNS },
];

function guessCurrency(): CurrencyCode {
  try {
    const saved = localStorage.getItem("agri_currency") as CurrencyCode | null;
    if (saved && CURRENCIES.some((c) => c.code === saved)) return saved;
  } catch {
    /* ignore */
  }
  const lang = (navigator.language || "en-US").toLowerCase();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  if (lang.endsWith("-in") || lang.startsWith("hi") || tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "INR";
  if (lang.startsWith("bn") || tz === "Asia/Dhaka") return "BDT";
  if (lang.startsWith("vi") || tz === "Asia/Ho_Chi_Minh") return "VND";
  if (lang.startsWith("fil") || lang.endsWith("-ph") || tz === "Asia/Manila") return "PHP";
  if (lang.startsWith("id") || tz === "Asia/Jakarta") return "IDR";
  return "USD";
}

const FAQ = [
  {
    q: "Which plan fits an insurer, bank, agribusiness, NGO or co-op?",
    a: "Business ($1,490/month) is one workspace with up to 2,500 monitored assets, 10 seats, portfolio monitoring, alert rules, Copilot, the API and one industry module (Insurance, Lending & Finance or Anticipatory Action). Enterprise (from $4,900/month) adds unlimited assets, every module, multiple workspaces and private hosting.",
  },
  {
    q: "Is the free plan really free for farmers?",
    a: "Yes. Farmer Basic has no time limit and no card. Governments and supply-chain customers fund the platform, which is how we keep flood warnings free for smallholders.",
  },
  {
    q: "What happens when my 14-day trial ends?",
    a: "If you haven’t added a payment method by then, the account returns to the free tier automatically. Nothing is charged without your confirmation.",
  },
  {
    q: "Which payment methods do you accept?",
    a: "Cards worldwide through Stripe, and UPI, net banking and RuPay cards in India through Razorpay. Government agencies can pay by invoice and bank transfer on annual contracts.",
  },
  {
    q: "Why are some local prices different from a straight conversion?",
    a: "Farmer Pro has fixed local price points (₹199, ৳299, ₫69,000, ₱149, Rp45,000) so it stays affordable. Other plans show an indicative conversion from USD; cards are charged in USD and UPI in INR.",
  },
  {
    q: "Can a government agency run Agri-SHIELD on its own infrastructure?",
    a: "Government Enterprise includes a self-hosted option. The web app and ML API ship as Docker images, and all climate inputs are open data with no proprietary satellite dependency.",
  },
  {
    q: "Do you offer discounts for NGOs, cooperatives and researchers?",
    a: "Yes: 50% off Government Basic for registered NGOs and farmer cooperatives, and free API access for academic research. Use the contact form below.",
  },
];

function CellView({ v }: { v: Cell }) {
  if (v === true) return <Check size={16} className="mx-auto text-emerald-400" aria-label="Included" />;
  if (v === false) return <Minus size={16} className="mx-auto text-slate-600" aria-label="Not included" />;
  return <span className="text-slate-300">{v}</span>;
}

export function PricingClient() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [interval, setBillingInterval] = useState<BillingInterval>("month");
  const [currency, setCurrency] = useState<CurrencyCode>("USD");
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("organisations");
  const plansQ = trpc.billing.getPlans.useQuery();
  const sub = trpc.billing.getSubscription.useQuery(undefined, { enabled: status === "authenticated" });
  const start = trpc.billing.startCheckout.useMutation();

  useEffect(() => {
    setCurrency(guessCurrency());
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("checkout") === "cancelled") toast("Checkout cancelled", { description: "No charge was made. Your plan hasn’t changed." });
    if (sp.get("interval") === "year") setBillingInterval("year");
    const planQ = sp.get("plan");
    if (sp.get("audience") === "farmer" || planQ === "free" || planQ === "farmer_pro") setTab("farmers");
  }, []);

  const changeCurrency = (c: CurrencyCode) => {
    setCurrency(c);
    try {
      localStorage.setItem("agri_currency", c);
    } catch {
      /* ignore */
    }
  };

  const providers = plansQ.data?.providers;

  const choose = async (plan: Plan) => {
    if (plan.usdMonthly === null) {
      if (plan.audience === "workspace") router.push(`/book-demo?plan=${plan.id}`);
      else document.getElementById("contact-sales")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const checkoutPath = `/pricing/checkout?plan=${plan.id}&interval=${interval}&currency=${currency}`;
    if (status !== "authenticated") {
      if (plan.id === "free") router.push("/auth/signup?role=farmer");
      else router.push(`/auth/signin?callbackUrl=${encodeURIComponent(checkoutPath)}`);
      return;
    }
    setBusy(plan.id);
    try {
      const provider = currency === "INR" && providers?.razorpay ? "razorpay" : providers?.stripe ? "stripe" : "sandbox";
      const res = await start.mutateAsync({ plan: plan.id, interval, currency, provider });
      if (res.kind === "activated") {
        toast.success("You’re on Farmer Basic", { description: "Free flood alerts are active." });
        await sub.refetch();
        router.push(res.url);
      } else if (res.kind === "redirect") {
        window.location.href = res.url;
      } else {
        router.push(res.url);
      }
    } catch (e) {
      toast.error("Couldn’t start checkout", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const current = sub.data?.plan;
  const tabDef = TABS.find((t) => t.id === tab)!;
  const grouped = useMemo(() => tabDef.plans.map((id) => PLANS.find((p) => p.id === id)!).filter(Boolean), [tabDef]);
  const columns = tabDef.plans;

  return (
    <>
      <section className="relative overflow-hidden">
        <div aria-hidden className="site-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-16 sm:px-6 sm:pt-20">
          <div className="max-w-3xl">
            <p className="text-sm text-emerald-300/90">Pricing</p>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white sm:text-6xl">Free for the farmer. Fair for everyone else.</h1>
            <p className="mt-5 text-lg leading-relaxed text-slate-400">
              Every paid plan starts with a {plansQ.data?.trialDays ?? 14}-day free trial. No card required, cancel any time.
            </p>
          </div>

          <div role="tablist" aria-label="Plans for" className="mt-10 inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("relative min-h-[40px] rounded-lg px-4 text-sm", tab === t.id ? "text-white" : "text-slate-400 hover:text-white")}>
                {tab === t.id && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-lg bg-white/[0.08] ring-1 ring-white/15" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                <span className="relative">{t.label}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div role="radiogroup" aria-label="Billing interval" className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {(["month", "year"] as const).map((iv) => (
                <button key={iv} role="radio" aria-checked={interval === iv} onClick={() => setBillingInterval(iv)} className={cn("relative min-h-[40px] rounded-lg px-4 text-sm", interval === iv ? "text-slate-950" : "text-slate-300 hover:text-white")}>
                  {interval === iv && <motion.span layoutId="iv-pill" className="absolute inset-0 rounded-lg bg-emerald-400" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                  <span className="relative">{iv === "month" ? "Monthly" : "Annual"}</span>
                  {iv === "year" && <span className={cn("relative ml-2 rounded-full px-1.5 py-0.5 text-[10px]", interval === "year" ? "bg-slate-950/20" : "bg-emerald-400/15 text-emerald-300")}>2 months free</span>}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <span>Currency</span>
              <span className="relative">
                <select value={currency} onChange={(e) => changeCurrency(e.target.value as CurrencyCode)} className="site-input !min-h-[44px] appearance-none !py-2 !pr-9">
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
              </span>
            </label>
            {sub.data && (
              <span className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] px-3 py-2 text-sm text-emerald-100">
                Your plan: <strong>{sub.data.planName}</strong> · {sub.data.status === "trialing" ? `trial until ${new Date(sub.data.trialEndsAt ?? sub.data.currentPeriodEnd).toLocaleDateString()}` : sub.data.status}
              </span>
            )}
          </div>
        </div>
      </section>

      <section aria-label="Plans" className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className={cn("grid gap-4 sm:grid-cols-2", grouped.length === 2 ? "lg:mx-auto lg:max-w-4xl" : grouped.length >= 5 ? "lg:grid-cols-3 xl:grid-cols-5" : "lg:grid-cols-4")}>
          {grouped.map((p) => {
            const price = priceFor(p, currency, interval);
            const Icon = AUDIENCE_ICON[p.audience];
            const isCurrent = current === p.id;
            return (
              <article key={p.id} className={cn("relative flex flex-col rounded-2xl border p-5", p.highlight ? "border-emerald-400/45 bg-emerald-400/[0.05] shadow-[0_0_70px_-35px_rgba(52,211,153,0.9)]" : "border-white/[0.08] bg-white/[0.02]")} aria-labelledby={`plan-${p.id}`}>
                {p.highlight && <span className="absolute -top-3 left-5 rounded-full bg-emerald-400 px-2.5 py-0.5 text-[11px] font-semibold text-slate-950">Most popular</span>}
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Icon size={14} aria-hidden /> {AUDIENCE_LABEL[p.audience]}
                </div>
                <h2 id={`plan-${p.id}`} className="mt-2 font-display text-xl font-semibold text-white">
                  {p.name}
                </h2>
                <p className="mt-1 min-h-[40px] text-sm leading-snug text-slate-400">{p.tagline}</p>
                <div className="mt-5 min-h-[64px]">
                  {price === null && p.fromUsdMonthly ? (
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="text-xs text-slate-400">from</span>
                      <span className="font-display text-3xl font-semibold tracking-tight text-white">
                        {formatMoney(currency === "USD" ? p.fromUsdMonthly : Math.round((p.fromUsdMonthly * FX[currency]) / 1000) * 1000, currency)}
                      </span>
                      <span className="text-xs text-slate-500">/month</span>
                    </div>
                  ) : price === null ? (
                    <div className="font-display text-3xl font-semibold text-white">Custom</div>
                  ) : price === 0 ? (
                    <div className="font-display text-3xl font-semibold text-white">Free</div>
                  ) : (
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-display text-3xl font-semibold tracking-tight text-white">{formatMoney(price, currency)}</span>
                      <span className="text-xs text-slate-500">/{interval === "year" ? "year" : "month"}</span>
                    </div>
                  )}
                  <div className="mt-1 text-xs text-slate-500">
                    {p.unit}
                    {interval === "year" && price ? ` · billed yearly (${ANNUAL_MONTHS}× monthly)` : ""}
                    {p.audience === "workspace" && p.usdMonthly !== null && " · NGOs & co-ops 50% off"}
                  </div>
                </div>
                <button
                  onClick={() => choose(p)}
                  disabled={busy !== null || isCurrent}
                  className={cn(
                    "mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:opacity-60",
                    p.highlight ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400" : "border border-white/15 text-white hover:border-white/35 hover:bg-white/[0.03]"
                  )}
                >
                  {busy === p.id && <Loader2 size={15} className="animate-spin" />}
                  {isCurrent ? "Current plan" : p.cta}
                </button>
                <ul className="mt-5 space-y-2 border-t border-white/[0.06] pt-4">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] leading-snug text-slate-300">
                      <Check size={14} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <CreditCard size={14} aria-hidden /> Cards via Stripe {providers && !providers.stripe && <em className="not-italic text-slate-500">(sandbox in this environment)</em>}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Wallet size={14} aria-hidden /> UPI, net banking via Razorpay {providers && !providers.razorpay && <em className="not-italic text-slate-500">(sandbox in this environment)</em>}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={14} aria-hidden /> Card details never touch our servers
          </span>
          <span className="ml-auto text-slate-500">Non-USD prices are indicative conversions except Farmer Pro local price points.</span>
        </div>
      </section>

      <section aria-labelledby="compare-title" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <h2 id="compare-title" className="font-display text-2xl font-semibold text-white sm:text-3xl">
          Compare every feature
        </h2>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-white/[0.08]">
          <table className={cn("w-full border-collapse text-sm", columns.length > 3 ? "min-w-[860px]" : "min-w-[520px]")}>
            <caption className="sr-only">Feature comparison across Agri-SHIELD plans</caption>
            <thead>
              <tr className="bg-white/[0.03]">
                <th scope="col" className="sticky left-0 z-10 bg-[#0a1120] px-4 py-3 text-left font-medium text-slate-400">
                  Feature
                </th>
                {columns.map((id) => {
                  const p = PLANS.find((x) => x.id === id)!;
                  return (
                    <th key={p.id} scope="col" className={cn("px-3 py-3 text-center font-medium", p.highlight ? "text-emerald-300" : "text-slate-200")}>
                      {p.name}
                    </th>
                  );
                })}
              </tr>
            </thead>
            {MATRIX.map((g) => (
              <tbody key={g.group}>
                <tr>
                  <th colSpan={columns.length + 1} scope="colgroup" className="sticky left-0 bg-[#050a14] px-4 pb-2 pt-6 text-left text-xs font-medium text-slate-500">
                    {g.group}
                  </th>
                </tr>
                {g.rows.map((row) => (
                  <tr key={row.label} className="border-t border-white/[0.05]">
                    <th scope="row" className="sticky left-0 z-10 max-w-[260px] bg-[#050a14] px-4 py-3 text-left font-normal text-slate-300">
                      {row.label}
                      {row.help && <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">{row.help}</span>}
                    </th>
                    {columns.map((id) => (
                      <td key={id} className={cn("px-3 py-3 text-center text-[13px]", PLANS.find((p) => p.id === id)?.highlight && "bg-emerald-400/[0.03]")}>
                        <CellView v={row.cells[id]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      <section aria-labelledby="faq-title" className="mx-auto grid max-w-7xl gap-12 px-4 pb-24 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h2 id="faq-title" className="font-display text-2xl font-semibold text-white sm:text-3xl">
            Questions
          </h2>
          <div className="mt-6 divide-y divide-white/[0.07] border-y border-white/[0.07]">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-1">
                <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-4 text-[15px] text-slate-100 [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown size={17} className="shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="pb-4 text-sm leading-relaxed text-slate-400">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
        <div id="contact-sales" className="scroll-mt-24">
          <h2 className="font-display text-2xl font-semibold text-white sm:text-3xl">Talk to us about Enterprise</h2>
          <p className="mt-2 text-sm text-slate-400">
            Company-wide rollouts, national programmes, self-hosting, data-sharing agreements and invoicing. Prefer to pick a time?{" "}
            <a href="/book-demo?plan=enterprise" className="text-emerald-300 underline underline-offset-2">Book a demo</a>.
          </p>
          <div className="hud-panel mt-6 p-5 sm:p-6">
            <LeadForm defaultInterest="enterprise" source="pricing" compact />
          </div>
        </div>
      </section>
      {session?.user && sub.data && sub.data.plan !== "free" && <ManageSubscription />}
    </>
  );
}

function ManageSubscription() {
  const utils = trpc.useUtils();
  const cancel = trpc.billing.cancel.useMutation({
    onSuccess: (s) => {
      toast.success("Subscription cancelled", { description: s ? `You keep access until ${new Date(s.currentPeriodEnd).toLocaleDateString()}.` : undefined });
      void utils.billing.getSubscription.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const sub = trpc.billing.getSubscription.useQuery();
  if (!sub.data || sub.data.status === "cancelled") return null;
  return (
    <section aria-label="Manage subscription" className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-sm">
        <div className="text-slate-300">
          {sub.data.planName} · {sub.data.status} · {sub.data.paymentMethod ?? "no payment method on file"} · renews {new Date(sub.data.currentPeriodEnd).toLocaleDateString()}
        </div>
        <button onClick={() => cancel.mutate()} disabled={cancel.isPending} className="min-h-[40px] rounded-lg border border-rose-400/30 px-3 text-rose-200 hover:bg-rose-500/10">
          {cancel.isPending ? "Cancelling…" : "Cancel subscription"}
        </button>
      </div>
    </section>
  );
}
