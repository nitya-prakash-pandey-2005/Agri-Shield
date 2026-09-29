/**
 * Notification channels. Real providers activate when env keys exist;
 * otherwise messages are recorded to an in-memory outbox (visible in the
 * admin panel + alert delivery receipts) so the pipeline is demonstrable.
 *
 *  SMS / WhatsApp → Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, TWILIO_WHATSAPP_NUMBER)
 *  Email          → Resend (RESEND_API_KEY)
 *  Push           → Web Push with VAPID (RFC 8030 / 8291 / 8292), see ./webpush.ts.
 *                   Free, no Firebase account: the browser's own push service
 *                   (FCM for Chrome/Android, Mozilla, Apple, WNS) delivers to the
 *                   service worker (public/sw.js). Keys come from VAPID_PUBLIC_KEY /
 *                   VAPID_PRIVATE_KEY / VAPID_SUBJECT, or are generated once and kept
 *                   in AGRI_DATA_DIR (default apps/web/.data/vapid.json). Every
 *                   "app" delivery is recorded in-app here; device pushes are
 *                   recorded alongside with provider "webpush".
 */
export interface OutboxMessage {
  id: string;
  channel: "sms" | "whatsapp" | "email" | "app";
  to: string;
  body: string;
  at: Date;
  status: "sent" | "simulated" | "failed";
  provider: string;
  error?: string;
}

const g = globalThis as unknown as { __agriOutbox?: OutboxMessage[] };
export const outbox = (g.__agriOutbox ??= []);

/** Append a message to the outbox (newest first, capped at 1000). */
export function recordOutbox(m: Omit<OutboxMessage, "id" | "at">) {
  const msg = { ...m, id: `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date() };
  outbox.unshift(msg);
  if (outbox.length > 1000) outbox.length = 1000;
  return msg;
}

async function twilio(to: string, from: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}`);
}

export async function sendSms(to: string, body: string) {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    try {
      await twilio(to, process.env.TWILIO_PHONE_NUMBER, body);
      return recordOutbox({ channel: "sms", to, body, status: "sent", provider: "twilio" });
    } catch (e) {
      return recordOutbox({ channel: "sms", to, body, status: "failed", provider: "twilio", error: (e as Error).message });
    }
  }
  return recordOutbox({ channel: "sms", to, body, status: "simulated", provider: "outbox" });
}

export async function sendWhatsApp(to: string, body: string) {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER) {
    try {
      await twilio(`whatsapp:${to}`, `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`, body);
      return recordOutbox({ channel: "whatsapp", to, body, status: "sent", provider: "twilio" });
    } catch (e) {
      return recordOutbox({ channel: "whatsapp", to, body, status: "failed", provider: "twilio", error: (e as Error).message });
    }
  }
  return recordOutbox({ channel: "whatsapp", to, body, status: "simulated", provider: "outbox" });
}

export async function sendEmail(to: string, subject: string, html: string) {
  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.RESEND_FROM ?? "Agri-SHIELD <alerts@agrishield.io>", to, subject, html }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}`);
      return recordOutbox({ channel: "email", to, body: subject, status: "sent", provider: "resend" });
    } catch (e) {
      return recordOutbox({ channel: "email", to, body: subject, status: "failed", provider: "resend", error: (e as Error).message });
    }
  }
  return recordOutbox({ channel: "email", to, body: subject, status: "simulated", provider: "outbox" });
}

export function recordAppPush(to: string, body: string) {
  return recordOutbox({ channel: "app", to, body, status: "sent", provider: "in-app" });
}
