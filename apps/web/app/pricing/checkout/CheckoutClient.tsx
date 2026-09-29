"use client";

/**
 * Checkout. With STRIPE/RAZORPAY keys the pricing page redirects to the real hosted
 * checkout and returns here with ?status=success. Without keys this page is a clearly
 * labelled SANDBOX: card form with Luhn validation (test card 4242…), UPI for INR,
 * or start the trial without any payment method.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, CreditCard, FlaskConical, Loader2, Lock, Smartphone } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { homeForRole } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { formatMoney, planById, priceFor, TRIAL_DAYS, type BillingInterval, type CurrencyCode, type PlanId } from "../plans";

// ─── Card helpers ─────────────────────────────────────────────────────────
export function luhn(num: string) {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function brandOf(num: string): { name: string; cvc: number; lengths: number[] } {
  const d = num.replace(/\D/g, "");
  if (/^3[47]/.test(d)) return { name: "Amex", cvc: 4, lengths: [15] };
  if (/^(5[1-5]|2(2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/.test(d)) return { name: "Mastercard", cvc: 3, lengths: [16] };
  if (/^(508[5-9]|60|65|81|82)/.test(d)) return { name: "RuPay", cvc: 3, lengths: [16] };
  if (/^4/.test(d)) return { name: "Visa", cvc: 3, lengths: [13, 16, 19] };
  return { name: "Card", cvc: 3, lengths: [16] };
}

function formatCard(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 19);
  if (/^3[47]/.test(d)) return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(" ");
  return d.replace(/(.{4})/g, "$1 ").trim();
}

function formatExpiry(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

function expiryValid(v: string) {
  const m = v.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const end = new Date(year, month, 1); // first day after expiry month
  return end.getTime() > Date.now();
}

type Method = "card" | "upi";

export function CheckoutClient({
  planId,
  interval,
  currency,
  returnStatus,
  provider,
  sessionId,
}: {
  planId: PlanId;
  interval: BillingInterval;
  currency: CurrencyCode;
  returnStatus: string | null;
  provider: string | null;
  sessionId: string | null;
}) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const plan = planById(planId)!;
  const price = priceFor(plan, currency, interval) ?? 0;
  const [method, setMethod] = useState<Method>(currency === "INR" ? "upi" : "card");
  const [card, setCard] = useState({ number: "", expiry: "", cvc: "", name: "" });
  const [upi, setUpi] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [upiWaiting, setUpiWaiting] = useState(false);
  const confirm = trpc.billing.confirmSandbox.useMutation();
  const confirmStripe = trpc.billing.confirmStripeSession.useMutation();
  const sub = trpc.billing.getSubscription.useQuery(undefined, { enabled: status === "authenticated" && !!returnStatus });
  const fired = useRef(false);

  // anonymous → sign in first, then come back here
  useEffect(() => {
    if (status === "unauthenticated") {
      const back = `/pricing/checkout?plan=${planId}&interval=${interval}&currency=${currency}`;
      router.replace(`/auth/signin?callbackUrl=${encodeURIComponent(back)}`);
    }
  }, [status, router, planId, interval, currency]);

  // returning from a real provider
  useEffect(() => {
    if (status !== "authenticated" || returnStatus !== "success" || fired.current) return;
    fired.current = true;
    if (provider === "stripe" && sessionId) confirmStripe.mutate({ sessionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, returnStatus, provider, sessionId]);

  const brand = brandOf(card.number);
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const digits = card.number.replace(/\D/g, "");
    if (!luhn(digits) || !brand.lengths.includes(digits.length)) e.number = "Card number isn’t valid. In sandbox, use 4242 4242 4242 4242.";
    if (!expiryValid(card.expiry)) e.expiry = "Use a future date as MM/YY";
    if (!new RegExp(`^\\d{${brand.cvc}}$`).test(card.cvc)) e.cvc = `${brand.cvc} digits`;
    if (card.name.trim().length < 2) e.name = "Name as printed on the card";
    return e;
  }, [card, brand]);
  const upiValid = /^[\w.-]{2,64}@[a-zA-Z]{2,32}$/.test(upi);

  const succeeded = confirm.isSuccess || confirmStripe.data?.confirmed || (returnStatus === "success" && provider === "razorpay");

  useEffect(() => {
    if (!succeeded) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    import("canvas-confetti").then(({ default: confetti }) => {
      const colors = ["#34d399", "#38bdf8", "#fbbf24", "#a78bfa"];
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.35 }, colors, disableForReducedMotion: true });
      setTimeout(() => confetti({ particleCount: 80, angle: 60, spread: 60, origin: { x: 0, y: 0.6 }, colors }), 250);
      setTimeout(() => confetti({ particleCount: 80, angle: 120, spread: 60, origin: { x: 1, y: 0.6 }, colors }), 400);
    });
  }, [succeeded]);

  const payCard = (e: FormEvent) => {
    e.preventDefault();
    setTouched({ number: true, expiry: true, cvc: true, name: true });
    if (Object.keys(errors).length) return;
    const digits = card.number.replace(/\D/g, "");
    confirm.mutate({ plan: plan.id, interval, currency, method: "card", last4: digits.slice(-4), brand: brand.name });
  };

  const payUpi = (e: FormEvent) => {
    e.preventDefault();
    setTouched({ upi: true });
    if (!upiValid) return;
    setUpiWaiting(true);
    // sandbox: simulate the collect-request approval round trip
    setTimeout(() => {
      setUpiWaiting(false);
      confirm.mutate({ plan: plan.id, interval, currency, method: "upi", upiId: upi });
    }, 1800);
  };

  const noCard = () => confirm.mutate({ plan: plan.id, interval, currency, method: "none" });

  const home = session?.user ? homeForRole(session.user.role) : "/dashboard/farmer";
  const activeSub = confirm.data?.subscription ?? confirmStripe.data?.subscription ?? sub.data;

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-slate-400">
        <Loader2 className="mr-2 animate-spin" size={18} /> {status === "unauthenticated" ? "Redirecting to sign in…" : "Loading checkout…"}
      </div>
    );
  }

  if (plan.usdMonthly === null) {
    return (
      <div className="mx-auto mt-16 max-w-lg text-center">
        <h1 className="font-display text-3xl font-semibold text-white">{plan.name} is quoted per contract</h1>
        <p className="mt-3 text-slate-400">National rollouts are priced on provinces, farmers reached and hosting. Tell us what you need and we’ll send a proposal.</p>
        <Link href="/pricing#contact-sales" className="mt-6 inline-flex min-h-[48px] items-center rounded-xl bg-emerald-500 px-6 font-semibold text-slate-950 hover:bg-emerald-400">
          Contact sales
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/pricing" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
        <ArrowLeft size={15} /> Back to plans
      </Link>

      <AnimatePresence mode="wait">
        {succeeded ? (
          <motion.section key="done" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-10 max-w-xl text-center" role="status" aria-live="polite">
            <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 220, damping: 14 }} className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-400/15 ring-1 ring-emerald-400/40">
              <Check size={40} className="text-emerald-300" strokeWidth={2.5} />
            </motion.div>
            <h1 className="mt-6 font-display text-3xl font-semibold text-white sm:text-4xl">{plan.trialDays ? `Your ${TRIAL_DAYS}-day ${plan.name} trial is live` : `${plan.name} is active`}</h1>
            <p className="mt-3 text-slate-400">
              {provider === "razorpay"
                ? "Payment received by Razorpay. Your plan activates as soon as the signed webhook arrives, usually within seconds."
                : activeSub?.trialEndsAt
                  ? `Nothing is charged until ${new Date(activeSub.trialEndsAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}. Cancel any time from the pricing page.`
                  : "Your subscription is active."}
            </p>
            {activeSub && (
              <dl className="mx-auto mt-8 grid max-w-md grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 text-left text-sm">
                {[
                  ["Plan", activeSub.planName],
                  ["Status", activeSub.status],
                  ["Billing", `${activeSub.interval === "year" ? "Annual" : "Monthly"} · ${activeSub.currency}`],
                  ["Payment", activeSub.paymentMethod ?? "Add before trial ends"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-[#07101f] p-3">
                    <dt className="text-xs text-slate-500">{k}</dt>
                    <dd className="mt-0.5 capitalize text-slate-100">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href={home} className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-emerald-500 px-6 font-semibold text-slate-950 hover:bg-emerald-400">
                Open my dashboard
              </Link>
              <Link href="/docs/getting-started" className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-white/15 px-6 text-white hover:border-white/35">
                Read the getting-started guide
              </Link>
            </div>
          </motion.section>
        ) : (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.15fr]">
            {/* summary */}
            <section aria-labelledby="summary-title" className="order-2 lg:order-1">
              <div className="hud-panel p-6">
                <h1 id="summary-title" className="font-display text-2xl font-semibold text-white">
                  {plan.name}
                </h1>
                <p className="mt-1 text-sm text-slate-400">{plan.tagline}</p>
                <dl className="mt-6 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-400">{interval === "year" ? "Annual plan" : "Monthly plan"}</dt>
                    <dd className="telemetry text-slate-200">
                      {formatMoney(price, currency)}/{interval === "year" ? "yr" : "mo"}
                    </dd>
                  </div>
                  {plan.trialDays > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-400">{TRIAL_DAYS}-day free trial</dt>
                      <dd className="telemetry text-emerald-300">−{formatMoney(price, currency)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-white/10 pt-3 text-base">
                    <dt className="text-white">Due today</dt>
                    <dd className="telemetry font-semibold text-white">{formatMoney(plan.trialDays > 0 ? 0 : price, currency)}</dd>
                  </div>
                </dl>
                <ul className="mt-6 space-y-2 border-t border-white/10 pt-5">
                  {plan.features.slice(0, 5).map((f) => (
                    <li key={f} className="flex gap-2 text-sm text-slate-300">
                      <Check size={14} className="mt-1 shrink-0 text-emerald-400" aria-hidden /> {f}
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-xs text-slate-500">Signed in as {session?.user?.email ?? session?.user?.name}. Org plans apply to your whole organisation.</p>
              </div>
            </section>

            {/* payment */}
            <section aria-labelledby="pay-title" className="order-1 lg:order-2">
              <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-4 text-sm text-amber-100" role="note">
                <FlaskConical size={18} className="mt-0.5 shrink-0 text-amber-300" aria-hidden />
                <div>
                  <strong className="font-semibold">Sandbox checkout. No real money moves.</strong>
                  <div className="mt-0.5 text-amber-100/80">
                    Use test card <button type="button" className="telemetry underline decoration-dotted underline-offset-2" onClick={() => setCard((c) => ({ ...c, number: "4242 4242 4242 4242", expiry: c.expiry || "12/30", cvc: c.cvc || "123", name: c.name || session?.user?.name || "" }))}>4242 4242 4242 4242</button>, any future expiry and any CVC. Live Stripe and Razorpay checkout switch on automatically when API keys are configured.
                  </div>
                </div>
              </div>

              <h2 id="pay-title" className="mt-6 font-display text-lg font-semibold text-white">
                Payment method
              </h2>
              <div role="tablist" aria-label="Payment method" className="mt-3 grid grid-cols-2 gap-2">
                {(
                  [
                    { id: "card", label: "Card", icon: CreditCard, sub: "Visa · Mastercard · Amex · RuPay" },
                    { id: "upi", label: "UPI", icon: Smartphone, sub: currency === "INR" ? "GPay · PhonePe · Paytm · BHIM" : "Available with INR" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    role="tab"
                    aria-selected={method === m.id}
                    disabled={m.id === "upi" && currency !== "INR"}
                    onClick={() => setMethod(m.id)}
                    className={cn("flex min-h-[64px] items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40", method === m.id ? "border-emerald-400/60 bg-emerald-400/[0.07]" : "border-white/10 hover:border-white/25")}
                  >
                    <m.icon size={20} className={method === m.id ? "text-emerald-300" : "text-slate-400"} aria-hidden />
                    <span>
                      <span className="block text-sm font-medium text-white">{m.label}</span>
                      <span className="block text-[11px] text-slate-500">{m.sub}</span>
                    </span>
                  </button>
                ))}
              </div>

              {method === "card" ? (
                <form onSubmit={payCard} noValidate className="mt-5 space-y-4" aria-label="Card details">
                  <label className="block">
                    <span className="mb-1.5 flex justify-between text-xs text-slate-400">
                      Card number <span className="telemetry text-slate-500">{card.number ? brand.name : ""}</span>
                    </span>
                    <input
                      inputMode="numeric"
                      autoComplete="cc-number"
                      placeholder="1234 1234 1234 1234"
                      value={card.number}
                      onChange={(e) => setCard({ ...card, number: formatCard(e.target.value) })}
                      onBlur={() => setTouched((t) => ({ ...t, number: true }))}
                      aria-invalid={!!(touched.number && errors.number)}
                      aria-describedby="cc-err"
                      className="site-input telemetry tracking-wider"
                    />
                    {touched.number && errors.number && (
                      <span id="cc-err" className="mt-1 block text-xs text-rose-300">
                        {errors.number}
                      </span>
                    )}
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                      <span className="mb-1.5 block text-xs text-slate-400">Expiry</span>
                      <input inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" value={card.expiry} onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })} onBlur={() => setTouched((t) => ({ ...t, expiry: true }))} aria-invalid={!!(touched.expiry && errors.expiry)} className="site-input telemetry" />
                      {touched.expiry && errors.expiry && <span className="mt-1 block text-xs text-rose-300">{errors.expiry}</span>}
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs text-slate-400">CVC</span>
                      <input inputMode="numeric" autoComplete="cc-csc" placeholder={brand.cvc === 4 ? "1234" : "123"} value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, "").slice(0, brand.cvc) })} onBlur={() => setTouched((t) => ({ ...t, cvc: true }))} aria-invalid={!!(touched.cvc && errors.cvc)} className="site-input telemetry" />
                      {touched.cvc && errors.cvc && <span className="mt-1 block text-xs text-rose-300">{errors.cvc}</span>}
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-slate-400">Name on card</span>
                    <input autoComplete="cc-name" value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} onBlur={() => setTouched((t) => ({ ...t, name: true }))} aria-invalid={!!(touched.name && errors.name)} className="site-input" />
                    {touched.name && errors.name && <span className="mt-1 block text-xs text-rose-300">{errors.name}</span>}
                  </label>
                  <button type="submit" disabled={confirm.isPending} className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60">
                    {confirm.isPending ? <Loader2 size={17} className="animate-spin" /> : <Lock size={16} />}
                    {plan.trialDays ? `Start ${TRIAL_DAYS}-day trial` : `Pay ${formatMoney(price, currency)}`}
                  </button>
                </form>
              ) : (
                <form onSubmit={payUpi} noValidate className="mt-5 space-y-4" aria-label="UPI payment">
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-slate-400">UPI ID</span>
                    <input value={upi} onChange={(e) => setUpi(e.target.value.trim())} placeholder="yourname@okaxis" autoComplete="off" aria-invalid={!!(touched.upi && !upiValid)} className="site-input telemetry" />
                    {touched.upi && !upiValid && <span className="mt-1 block text-xs text-rose-300">Enter a UPI ID like name@bank</span>}
                  </label>
                  <button type="submit" disabled={upiWaiting || confirm.isPending} className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60">
                    {upiWaiting || confirm.isPending ? <Loader2 size={17} className="animate-spin" /> : <Smartphone size={16} />}
                    {upiWaiting ? "Approve the request in your UPI app…" : plan.trialDays ? "Set up UPI AutoPay & start trial" : `Pay ${formatMoney(price, currency)}`}
                  </button>
                </form>
              )}

              {confirm.error && (
                <p className="mt-3 text-sm text-rose-300" role="alert">
                  {confirm.error.message}
                </p>
              )}

              {plan.trialDays > 0 && (
                <div className="mt-6 border-t border-white/10 pt-5 text-center">
                  <button type="button" onClick={noCard} disabled={confirm.isPending} className="text-sm text-slate-300 underline decoration-slate-600 underline-offset-4 hover:text-white">
                    Start the trial without a payment method
                  </button>
                  <p className="mt-1 text-xs text-slate-500">You can add one any time before day {TRIAL_DAYS}.</p>
                </div>
              )}
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
