/**
 * NOTIFICATION_DISPATCH (spec §6).
 *
 * Alert broadcasts send inline (sub-30 s delivery, spec §19), so this job is
 * the reliability layer:
 *   • drains a pending-delivery queue (digests, NDVI stress notices, SMS replies…)
 *   • picks up FAILED outbox messages (Twilio/Resend errors) and retries them
 *     with exponential backoff — 1, 2, 4 min — up to 3 attempts, then dead-letters.
 */
import { outbox, recordAppPush, sendEmail, sendSms, sendWhatsApp, type OutboxMessage } from "../notify/channels";
import { firePushToUser } from "../notify/webpush";
import type { JobResult } from "./registry";

export interface PendingDelivery {
  id: string;
  channel: OutboxMessage["channel"];
  to: string;
  body: string;
  subject?: string;
  attempts: number;
  nextAttemptAt: number;
  createdAt: Date;
  origin: string;
  status: "pending" | "sent" | "dead";
  lastError?: string;
  retryOf?: string;
}

const MAX_ATTEMPTS = 3;

const g = globalThis as unknown as { __agriNotifyQ?: { queue: PendingDelivery[]; retried: Set<string>; seq: number } };
const q = (g.__agriNotifyQ ??= { queue: [], retried: new Set(), seq: 0 });

export function enqueueNotification(d: { channel: OutboxMessage["channel"]; to: string; body: string; subject?: string; origin: string }): PendingDelivery {
  const item: PendingDelivery = {
    ...d,
    id: `dlv_${(++q.seq).toString(36)}_${Date.now().toString(36)}`,
    attempts: 0,
    nextAttemptAt: Date.now(),
    createdAt: new Date(),
    status: "pending",
  };
  q.queue.push(item);
  if (q.queue.length > 2000) q.queue.splice(0, q.queue.length - 2000);
  return item;
}

export function notificationQueue() {
  const pending = q.queue.filter((d) => d.status === "pending");
  return {
    pending: pending.length,
    dead: q.queue.filter((d) => d.status === "dead").length,
    sent: q.queue.filter((d) => d.status === "sent").length,
    items: q.queue.slice(-100).reverse(),
  };
}

async function deliver(d: PendingDelivery): Promise<OutboxMessage> {
  switch (d.channel) {
    case "sms":
      return sendSms(d.to, d.body);
    case "whatsapp":
      return sendWhatsApp(d.to, d.body);
    case "email":
      return sendEmail(d.to, d.subject ?? d.body.slice(0, 80), `<p>${d.body.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</p>`);
    default: {
      // `to` is a user id for app deliveries: record in-app + push to their devices
      const [first, ...rest] = d.body.split("\n");
      firePushToUser(d.to, { title: rest.length ? first! : "Agri-SHIELD", body: rest.length ? rest.join(" ") : d.body, severity: "watch", tag: `dlv-${d.id}`, url: d.origin === "satellite-ingest" ? "/dashboard/farmer" : "/dashboard/farmer/alerts" });
      return recordAppPush(d.to, d.body);
    }
  }
}

export async function notificationDispatch(): Promise<JobResult> {
  const now = Date.now();

  // 1. Pick up failed outbox messages (last 24 h) that nobody retried yet
  let requeued = 0;
  for (const m of outbox) {
    if (m.status !== "failed" || q.retried.has(m.id) || now - m.at.getTime() > 24 * 3_600_000) continue;
    // Web Push failures are per device: push services store-and-forward (TTL) and dead endpoints are removed
    if (m.provider === "webpush") continue;
    q.retried.add(m.id);
    const item = enqueueNotification({ channel: m.channel, to: m.to, body: m.body, subject: m.channel === "email" ? m.body : undefined, origin: `retry:${m.provider}` });
    item.attempts = 1; // the original send counts as attempt #1
    item.retryOf = m.id;
    item.nextAttemptAt = m.at.getTime() + 60_000;
    requeued++;
  }

  // 2. Drain due items
  let sent = 0;
  let failed = 0;
  let dead = 0;
  const byChannel: Record<string, number> = {};
  for (const d of q.queue) {
    if (d.status !== "pending" || d.nextAttemptAt > now) continue;
    d.attempts++;
    const res = await deliver(d).catch((e) => ({ status: "failed", error: (e as Error).message }) as OutboxMessage);
    if (res.status === "failed") {
      failed++;
      d.lastError = res.error;
      // the failed resend is itself in the outbox — don't pick it up again
      if ("id" in res && res.id) q.retried.add(res.id);
      if (d.attempts >= MAX_ATTEMPTS) {
        d.status = "dead";
        dead++;
      } else d.nextAttemptAt = now + 60_000 * 2 ** (d.attempts - 1);
    } else {
      d.status = "sent";
      sent++;
      byChannel[d.channel] = (byChannel[d.channel] ?? 0) + 1;
    }
  }

  const pending = q.queue.filter((d) => d.status === "pending").length;
  return {
    status: failed && !sent ? "partial" : "success",
    summary: `${sent} delivered, ${failed} failed (${dead} dead-lettered), ${requeued} failed outbox message(s) re-queued, ${pending} pending`,
    output: { sent, failed, dead, requeued, pending, byChannel, outboxSize: outbox.length },
  };
}
