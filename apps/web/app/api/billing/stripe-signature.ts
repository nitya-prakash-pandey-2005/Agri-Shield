/** Stripe webhook signature verification (constant-time, 5-minute replay tolerance). */
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_S = 300;

export function verifyStripeSignature(payload: string, header: string | null, secret: string, now = Math.floor(Date.now() / 1000)) {
  if (!header) return { ok: false as const, reason: "missing Stripe-Signature header" };
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || sigs.length === 0) return { ok: false as const, reason: "malformed signature header" };
  if (Math.abs(now - t) > TOLERANCE_S) return { ok: false as const, reason: "timestamp outside tolerance" };
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex"), "utf8");
  const match = sigs.some((s) => {
    const got = Buffer.from(s, "utf8");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return match ? { ok: true as const } : { ok: false as const, reason: "signature mismatch" };
}
