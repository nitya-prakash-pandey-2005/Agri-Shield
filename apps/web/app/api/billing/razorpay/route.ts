/**
 * Razorpay webhook → subscription activation.
 * Verifies `X-Razorpay-Signature` = HMAC-SHA256(RAZORPAY_WEBHOOK_SECRET, rawBody) (hex).
 * Handles `payment_link.paid` (hosted links created by billing.startCheckout).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { applySubscription } from "@/server/routers/billing";
import { audit, getStore } from "@/server/data/store";
import { planById, type PlanId } from "@/app/pricing/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "RAZORPAY_WEBHOOK_SECRET not configured" }, { status: 501 });
  const payload = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  const event = JSON.parse(payload) as { event: string; payload?: { payment_link?: { entity?: { id: string; notes?: Record<string, string> } } } };
  const link = event.payload?.payment_link?.entity;
  const notes = link?.notes ?? {};
  if (event.event === "payment_link.paid" && notes.user_id && notes.plan && planById(notes.plan) && getStore().users.some((u) => u.id === notes.user_id)) {
    applySubscription({ userId: notes.user_id, plan: notes.plan as PlanId, status: "active", provider: "razorpay", currency: "INR", interval: notes.interval === "year" ? "year" : "month", externalId: link?.id ?? null, paymentMethod: "Razorpay", actor: "razorpay-webhook" });
  }
  audit({ userId: notes.user_id ?? "razorpay", userName: "razorpay-webhook", action: "billing.webhook", entity: "razorpay_event", entityId: link?.id ?? "n/a", details: event.event });
  return NextResponse.json({ received: true });
}
