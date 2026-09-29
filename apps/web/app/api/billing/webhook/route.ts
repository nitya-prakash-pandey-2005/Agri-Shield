/**
 * Stripe webhook → subscription status sync.
 *
 * Verifies the `Stripe-Signature` header exactly as Stripe documents it:
 *   header  = "t=<unix>,v1=<hex>[,v1=<hex>…]"
 *   signed  = `${t}.${rawBody}`
 *   v1      = HMAC-SHA256(STRIPE_WEBHOOK_SECRET, signed)  (hex)
 * with a constant-time compare and a 5-minute replay tolerance.
 */
import { NextResponse } from "next/server";
import { applySubscription } from "@/server/routers/billing";
import { audit, getStore } from "@/server/data/store";
import { planById, type PlanId } from "@/app/pricing/plans";
import { verifyStripeSignature } from "../stripe-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> & { metadata?: Record<string, string> } };
};

const STATUS_MAP: Record<string, "active" | "trialing" | "past_due" | "cancelled"> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  unpaid: "past_due",
  incomplete: "past_due",
  canceled: "cancelled",
  incomplete_expired: "cancelled",
};

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET not configured" }, { status: 501 });

  const payload = await req.text();
  const check = verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret);
  if (!check.ok) return NextResponse.json({ error: `Invalid signature: ${check.reason}` }, { status: 400 });

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const obj = event.data.object;
  const md = obj.metadata ?? {};
  const userId = (obj.client_reference_id as string | undefined) ?? md.user_id;
  const plan = md.plan as PlanId | undefined;
  const known = !!userId && !!plan && !!planById(plan) && getStore().users.some((u) => u.id === userId);

  switch (event.type) {
    case "checkout.session.completed":
      if (known) applySubscription({ userId: userId!, plan: plan!, status: "trialing", provider: "stripe", trial: true, interval: md.interval === "year" ? "year" : "month", externalId: (obj.subscription as string) ?? null, actor: "stripe-webhook" });
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const status = event.type.endsWith("deleted") ? "cancelled" : STATUS_MAP[String(obj.status)] ?? "active";
      const periodEnd = typeof obj.current_period_end === "number" ? new Date(obj.current_period_end * 1000) : undefined;
      if (known) applySubscription({ userId: userId!, plan: plan!, status, provider: "stripe", periodEnd, externalId: obj.id as string, actor: "stripe-webhook" });
      break;
    }
    case "invoice.payment_failed": {
      const sub = (obj.subscription_details as { metadata?: Record<string, string> } | undefined)?.metadata;
      if (sub?.user_id && sub.plan && planById(sub.plan)) applySubscription({ userId: sub.user_id, plan: sub.plan as PlanId, status: "past_due", provider: "stripe", actor: "stripe-webhook" });
      break;
    }
    default:
      break;
  }

  audit({ userId: userId ?? "stripe", userName: "stripe-webhook", action: "billing.webhook", entity: "stripe_event", entityId: event.id, details: `${event.type}${known ? "" : " (no matching user/plan)"}` });
  return NextResponse.json({ received: true, type: event.type });
}
