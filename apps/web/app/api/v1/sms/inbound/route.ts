/**
 * POST /api/v1/sms/inbound — Twilio Messaging webhook (spec §7 SMS fallback).
 * Body: application/x-www-form-urlencoded (From, Body, …).
 * When TWILIO_AUTH_TOKEN is set every request must carry a valid X-Twilio-Signature.
 * Replies with TwiML <Response><Message>…</Message></Response> (≤ 2 SMS segments).
 */
import { handleInboundSms, publicUrl, verifyTwilioSignature } from "@/server/sms/handler";
import { normalizePhone, twiml } from "@/server/sms/commands";
import { rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const xml = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 8_000) return xml(twiml("Message too long."), 413);
  const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;

  const token = process.env.TWILIO_AUTH_TOKEN;
  if (token && !verifyTwilioSignature(token, publicUrl(req), params, req.headers.get("x-twilio-signature"))) {
    return new Response("Invalid Twilio signature", { status: 403 });
  }

  const from = normalizePhone(params.From);
  if (!from || !/^\+\d{7,15}$/.test(from)) return xml(twiml("Invalid sender."), 400);
  if (!rateLimit(`sms:${from}`, 10)) return xml(twiml("Too many messages. Please wait a minute."), 429);

  const ex = await handleInboundSms(from, params.Body ?? "");
  return new Response(twiml(ex.reply), {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Agri-Command": ex.command,
      "X-Agri-Language": ex.language,
      "X-Agri-Segments": String(ex.segments),
      "X-Agri-Encoding": ex.encoding,
    },
  });
}
