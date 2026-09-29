/**
 * Billing & leads (spec §12, §17).
 *
 * Checkout providers, chosen at runtime by environment:
 *   STRIPE_SECRET_KEY            → real Stripe Checkout Session (subscription, 14-day trial, card optional)
 *   RAZORPAY_KEY_ID + _SECRET    → real Razorpay order + hosted Payment Link (UPI / cards / net banking, INR)
 *   neither                      → clearly-labelled sandbox checkout at /pricing/checkout
 *
 * Status sync: /api/billing/webhook (Stripe, signed) and /api/billing/razorpay (signed).
 * Everything is persisted in the shared demo store (subscriptions + audit log).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { SubscriptionPlan } from "@agri-shield/types";
import { permitted, protectedProcedure, publicProcedure, router } from "../trpc";
import { audit, getStore, nextId, type SubscriptionRecord } from "../data/store";
import { sendEmail } from "../notify/channels";
import { PLANS, TRIAL_DAYS, minorUnits, planById, priceFor, type BillingInterval, type PlanId } from "@/app/pricing/plans";

const DAY = 86_400_000;
const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

// ─── Side-car metadata the core SubscriptionRecord doesn't carry ───────────
export interface BillingMeta {
  interval: BillingInterval;
  currency: string;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  paymentMethod: string | null;
  externalId: string | null; // Stripe subscription id / Razorpay payment link id
  checkoutRef: string | null;
  updatedAt: Date;
}

export interface LeadRecord {
  id: string;
  at: Date;
  name: string;
  email: string;
  organisation: string;
  role: string | null;
  country: string | null;
  interest: "government_demo" | "partnership" | "investment" | "enterprise" | "supply_chain" | "other";
  message: string;
  source: string;
  status: "new" | "contacted";
}

const g = globalThis as unknown as { __agriBillingMeta?: Map<string, BillingMeta>; __agriLeads?: LeadRecord[] };
const meta = (g.__agriBillingMeta ??= new Map());
export const leads = (g.__agriLeads ??= []);

const PLAN_MRR: Record<SubscriptionPlan, number> = { free: 0, farmer_pro: 3, gov_basic: 299, gov_enterprise: 2400, supply_chain: 499, business: 1490, enterprise: 4900 };

export function providersAvailable() {
  return {
    stripe: !!process.env.STRIPE_SECRET_KEY,
    razorpay: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    sandbox: true,
  };
}

/** Org-level plans attach to the user's organisation when they have one. */
const isOrgPlan = (plan: PlanId) => plan === "gov_basic" || plan === "gov_enterprise" || plan === "supply_chain";

function findSubscription(userId: string, orgId: string | null) {
  const s = getStore();
  return s.subscriptions.find((x) => x.userId === userId) ?? (orgId ? s.subscriptions.find((x) => x.orgId === orgId) : undefined);
}

/**
 * Single source of truth for activating / updating a subscription —
 * used by the sandbox, Stripe session confirmation and both webhooks.
 */
export function applySubscription(input: {
  userId: string;
  plan: PlanId;
  status: SubscriptionRecord["status"];
  provider: SubscriptionRecord["provider"];
  interval?: BillingInterval;
  currency?: string;
  trial?: boolean;
  periodEnd?: Date;
  paymentMethod?: string | null;
  externalId?: string | null;
  checkoutRef?: string | null;
  actor?: string;
}) {
  const s = getStore();
  const user = s.users.find((u) => u.id === input.userId);
  if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  const orgId = isOrgPlan(input.plan) ? user.orgId : null;
  const now = new Date();
  const trialEnds = input.trial ? new Date(now.getTime() + TRIAL_DAYS * DAY) : null;
  const interval = input.interval ?? "month";
  const periodEnd = input.periodEnd ?? trialEnds ?? new Date(now.getTime() + (interval === "year" ? 365 : 30) * DAY);

  let sub = orgId ? s.subscriptions.find((x) => x.orgId === orgId) : s.subscriptions.find((x) => x.userId === user.id);
  if (!sub) {
    sub = { id: nextId("sub"), userId: orgId ? null : user.id, orgId, plan: input.plan, status: input.status, mrrUsd: 0, currentPeriodEnd: periodEnd, provider: input.provider };
    s.subscriptions.unshift(sub);
  }
  sub.plan = input.plan;
  sub.status = input.status;
  sub.provider = input.provider;
  sub.currentPeriodEnd = periodEnd;
  sub.mrrUsd = input.status === "active" ? PLAN_MRR[input.plan] : 0;

  user.subscriptionTier = input.plan;
  if (orgId) {
    const org = s.orgs.find((o) => o.id === orgId);
    if (org) org.planTier = input.plan;
  }

  const prev = meta.get(sub.id);
  meta.set(sub.id, {
    interval,
    currency: input.currency ?? prev?.currency ?? "USD",
    trialEndsAt: input.trial ? trialEnds : input.status === "trialing" ? (prev?.trialEndsAt ?? null) : null,
    cancelAtPeriodEnd: input.status === "cancelled" ? true : false,
    paymentMethod: input.paymentMethod ?? prev?.paymentMethod ?? null,
    externalId: input.externalId ?? prev?.externalId ?? null,
    checkoutRef: input.checkoutRef ?? prev?.checkoutRef ?? null,
    updatedAt: now,
  });

  audit({
    userId: user.id,
    userName: input.actor ?? user.name,
    action: `billing.${input.status}`,
    entity: "subscription",
    entityId: sub.id,
    details: `${input.plan} via ${input.provider}${input.trial ? ` (${TRIAL_DAYS}-day trial)` : ""}`,
  });
  return sub;
}

function describe(sub: SubscriptionRecord | undefined) {
  if (!sub) return null;
  const m = meta.get(sub.id);
  const plan = planById(sub.plan);
  return {
    id: sub.id,
    plan: sub.plan,
    planName: plan?.name ?? sub.plan,
    status: sub.status,
    provider: sub.provider,
    mrrUsd: sub.mrrUsd,
    currentPeriodEnd: sub.currentPeriodEnd,
    interval: m?.interval ?? "month",
    currency: m?.currency ?? "USD",
    trialEndsAt: m?.trialEndsAt ?? (sub.status === "trialing" ? sub.currentPeriodEnd : null),
    cancelAtPeriodEnd: m?.cancelAtPeriodEnd ?? sub.status === "cancelled",
    paymentMethod: m?.paymentMethod ?? null,
    scope: sub.orgId ? ("organisation" as const) : ("personal" as const),
  };
}

// ─── Provider calls (plain REST, no SDKs) ──────────────────────────────────
async function stripe<T>(path: string, params: Record<string, string>, method: "POST" | "GET" = "POST"): Promise<T> {
  const url = `https://api.stripe.com/v1/${path}${method === "GET" && Object.keys(params).length ? `?${new URLSearchParams(params)}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20" },
    body: method === "POST" ? new URLSearchParams(params) : undefined,
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `Stripe: ${json.error?.message ?? res.status}` });
  return json;
}

async function razorpay<T>(path: string, body: unknown): Promise<T> {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { description?: string } };
  if (!res.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `Razorpay: ${json.error?.description ?? res.status}` });
  return json;
}

const planInput = z.enum(["free", "farmer_pro", "gov_basic", "gov_enterprise", "supply_chain"]);
const currencyInput = z.enum(["USD", "INR", "BDT", "VND", "PHP", "IDR"]);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const billingRouter = router({
  getPlans: publicProcedure.query(() => ({ plans: PLANS, providers: providersAvailable(), trialDays: TRIAL_DAYS })),

  getSubscription: protectedProcedure.query(({ ctx }) => {
    const sub = findSubscription(ctx.user.id, ctx.user.orgId ?? null);
    return describe(sub);
  }),

  startCheckout: protectedProcedure
    .input(
      z.object({
        plan: planInput,
        provider: z.enum(["stripe", "razorpay", "sandbox"]).default("sandbox"),
        interval: z.enum(["month", "year"]).default("month"),
        currency: currencyInput.default("USD"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const plan = planById(input.plan)!;
      if (plan.usdMonthly === null) throw new TRPCError({ code: "BAD_REQUEST", message: "Enterprise plans are quoted — use the contact form." });
      const user = getStore().users.find((u) => u.id === ctx.user.id);
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });

      if (plan.id === "free") {
        applySubscription({ userId: user.id, plan: "free", status: "active", provider: "none" });
        return { kind: "activated" as const, url: "/dashboard/farmer" };
      }

      const avail = providersAvailable();
      const base = APP_URL();
      const ref = nextId("chk");

      if (input.provider === "stripe" && avail.stripe) {
        const session = await stripe<{ id: string; url: string }>("checkout/sessions", {
          mode: "subscription",
          "line_items[0][quantity]": "1",
          "line_items[0][price_data][currency]": "usd",
          "line_items[0][price_data][unit_amount]": String(minorUnits(plan, "USD", input.interval)),
          "line_items[0][price_data][recurring][interval]": input.interval,
          "line_items[0][price_data][product_data][name]": `Agri-SHIELD ${plan.name}`,
          "subscription_data[trial_period_days]": String(plan.trialDays),
          "subscription_data[metadata][plan]": plan.id,
          "subscription_data[metadata][user_id]": user.id,
          payment_method_collection: "if_required",
          client_reference_id: user.id,
          "metadata[plan]": plan.id,
          "metadata[interval]": input.interval,
          "metadata[ref]": ref,
          ...(user.email ? { customer_email: user.email } : {}),
          success_url: `${base}/pricing/checkout?plan=${plan.id}&status=success&provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${base}/pricing?checkout=cancelled`,
        });
        audit({ userId: user.id, userName: user.name, action: "billing.checkout_started", entity: "subscription", entityId: session.id, details: `${plan.id} via stripe` });
        return { kind: "redirect" as const, url: session.url, provider: "stripe" as const };
      }

      if (input.provider === "razorpay" && avail.razorpay) {
        const amount = minorUnits(plan, "INR", input.interval);
        const order = await razorpay<{ id: string }>("orders", { amount, currency: "INR", receipt: ref, notes: { plan: plan.id, user_id: user.id, interval: input.interval } });
        // Hosted payment link keeps us CSP-safe (no third-party checkout.js on our origin).
        const link = await razorpay<{ id: string; short_url: string }>("payment_links", {
          amount,
          currency: "INR",
          reference_id: order.id,
          description: `Agri-SHIELD ${plan.name} (${input.interval === "year" ? "annual" : "monthly"})`,
          customer: { name: user.name, ...(user.email ? { email: user.email } : {}), ...(user.phone ? { contact: user.phone } : {}) },
          notify: { sms: false, email: false },
          notes: { plan: plan.id, user_id: user.id, interval: input.interval, order_id: order.id },
          callback_url: `${base}/pricing/checkout?plan=${plan.id}&status=success&provider=razorpay`,
          callback_method: "get",
        });
        audit({ userId: user.id, userName: user.name, action: "billing.checkout_started", entity: "subscription", entityId: order.id, details: `${plan.id} via razorpay` });
        return { kind: "redirect" as const, url: link.short_url, provider: "razorpay" as const, orderId: order.id };
      }

      const q = new URLSearchParams({ plan: plan.id, interval: input.interval, currency: input.currency });
      return { kind: "sandbox" as const, url: `/pricing/checkout?${q}` };
    }),

  /** Sandbox checkout completion — card already Luhn-checked client-side; only last4 is sent. */
  confirmSandbox: protectedProcedure
    .input(
      z.object({
        plan: planInput,
        interval: z.enum(["month", "year"]).default("month"),
        currency: currencyInput.default("USD"),
        method: z.enum(["card", "upi", "none"]),
        last4: z.string().regex(/^\d{4}$/).optional(),
        brand: z.string().max(20).optional(),
        upiId: z.string().regex(/^[\w.-]{2,64}@[a-zA-Z]{2,32}$/).optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const plan = planById(input.plan)!;
      if (plan.usdMonthly === null) throw new TRPCError({ code: "BAD_REQUEST", message: "Enterprise plans are quoted — use the contact form." });
      if (input.method === "card" && !input.last4) throw new TRPCError({ code: "BAD_REQUEST", message: "Card details missing" });
      if (input.method === "upi" && !input.upiId) throw new TRPCError({ code: "BAD_REQUEST", message: "UPI ID missing" });
      const pm = input.method === "card" ? `${input.brand ?? "Card"} •••• ${input.last4}` : input.method === "upi" ? `UPI ${input.upiId!.replace(/^(.{2}).*(@.*)$/, "$1•••$2")}` : null;
      const sub = applySubscription({
        userId: ctx.user.id,
        plan: plan.id,
        status: plan.trialDays > 0 ? "trialing" : "active",
        provider: "none",
        interval: input.interval,
        currency: input.currency,
        trial: plan.trialDays > 0,
        paymentMethod: pm,
        checkoutRef: nextId("sbx"),
      });
      return { subscription: describe(sub), amount: priceFor(plan, input.currency, input.interval) };
    }),

  /** Stripe success redirect: confirm the session server-side (works without webhooks in local dev). */
  confirmStripeSession: protectedProcedure.input(z.object({ sessionId: z.string().regex(/^cs_[\w]+$/) })).mutation(async ({ ctx, input }) => {
    if (!providersAvailable().stripe) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Stripe is not configured" });
    const session = await stripe<{ status: string; client_reference_id: string | null; subscription: string | null; metadata: Record<string, string> }>(`checkout/sessions/${input.sessionId}`, {}, "GET");
    if (session.client_reference_id !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Session belongs to another user" });
    if (session.status !== "complete") return { confirmed: false as const };
    const plan = planInput.parse(session.metadata.plan);
    const sub = applySubscription({ userId: ctx.user.id, plan, status: "trialing", provider: "stripe", trial: true, interval: (session.metadata.interval as BillingInterval) ?? "month", externalId: session.subscription });
    return { confirmed: true as const, subscription: describe(sub) };
  }),

  cancel: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = findSubscription(ctx.user.id, ctx.user.orgId ?? null);
    if (!sub || sub.plan === "free") throw new TRPCError({ code: "NOT_FOUND", message: "No paid subscription to cancel" });
    const m = meta.get(sub.id);
    if (sub.provider === "stripe" && m?.externalId && providersAvailable().stripe) {
      await stripe(`subscriptions/${m.externalId}`, { cancel_at_period_end: "true" });
    }
    sub.status = "cancelled";
    sub.mrrUsd = 0;
    if (m) {
      m.cancelAtPeriodEnd = true;
      m.updatedAt = new Date();
    }
    audit({ userId: ctx.user.id, userName: ctx.user.name ?? "user", action: "billing.cancelled", entity: "subscription", entityId: sub.id, details: `${sub.plan} — access until ${sub.currentPeriodEnd.toISOString().slice(0, 10)}` });
    return describe(sub);
  }),

  /** Pitch / pricing / landing contact form. Honeypot `website` must stay empty. */
  submitLead: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(80),
        email: z.string().trim().email().max(120),
        organisation: z.string().trim().min(2).max(120),
        role: z.string().trim().max(80).optional(),
        country: z.string().trim().max(60).optional(),
        interest: z.enum(["government_demo", "partnership", "investment", "enterprise", "supply_chain", "other"]),
        message: z.string().trim().max(2000).default(""),
        source: z.string().max(40).default("site"),
        website: z.string().max(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const lead: LeadRecord = {
        id: nextId("lead"),
        at: new Date(),
        name: input.name,
        email: input.email.toLowerCase(),
        organisation: input.organisation,
        role: input.role || null,
        country: input.country || null,
        interest: input.interest,
        message: input.message,
        source: input.source,
        status: "new",
      };
      leads.unshift(lead);
      if (leads.length > 500) leads.length = 500;
      audit({ userId: ctx.session?.user?.id ?? "anonymous", userName: input.name, action: "lead.created", entity: "lead", entityId: lead.id, details: `${input.interest} — ${input.organisation} (${input.source})` });
      const inbox = process.env.SALES_EMAIL ?? "partners@agrishield.io";
      await Promise.all([
        sendEmail(
          inbox,
          `New ${input.interest.replace("_", " ")} lead: ${input.organisation}`,
          `<p><b>${esc(input.name)}</b> &lt;${esc(input.email)}&gt; — ${esc(input.organisation)}${input.role ? `, ${esc(input.role)}` : ""}${input.country ? ` (${esc(input.country)})` : ""}</p><p>${esc(input.message)}</p>`
        ),
        sendEmail(
          input.email,
          "Agri-SHIELD — we received your request",
          `<p>Hi ${esc(input.name.split(" ")[0] ?? input.name)},</p><p>Thanks for reaching out about Agri-SHIELD. We'll reply within one business day with next steps for ${esc(input.organisation)}.</p><p>— Nitya Prakash Pandey, Agri-SHIELD</p>`
        ),
      ]).catch(() => undefined);
      return { id: lead.id, receivedAt: lead.at };
    }),

  listLeads: permitted("access_admin_panel").query(() => leads.slice(0, 200)),
});
