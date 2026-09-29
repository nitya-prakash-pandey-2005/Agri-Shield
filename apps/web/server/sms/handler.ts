/**
 * Inbound SMS conversation handler — resolves the farmer by phone, executes the
 * command against the live store, translates into the farmer's language and
 * fits the reply into ≤ 2 SMS segments. Used by POST /api/v1/sms/inbound.
 */
import { phonesMatch } from "../auth/phone";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupportedLanguage } from "@agri-shield/types";
import { audit, getStore } from "../data/store";
import { translate } from "../live/translate";
import { publish } from "../realtime";
import {
  HELP_TEXT,
  buildAdviceReply,
  buildAlertReply,
  buildStatusReply,
  fitSegments,
  languageForPhone,
  maskPhone,
  needsCompact,
  normalizePhone,
  parseSms,
  smsSegments,
  type SmsCommand,
} from "./commands";
import { restore, track } from "../persist";

export interface SmsExchange {
  id: string;
  at: Date;
  from: string;
  fromMasked: string;
  farmerId: string | null;
  farmerName: string | null;
  body: string;
  command: SmsCommand;
  language: SupportedLanguage;
  reply: string;
  segments: number;
  encoding: string;
  translatedBy: string;
  latencyMs: number;
}

const g = globalThis as unknown as { __agriSmsLog?: SmsExchange[]; __agriSmsOptOut?: Set<string> };
const SMS_VERSION = 1;
const savedSms =
  g.__agriSmsLog && g.__agriSmsOptOut
    ? undefined
    : restore<{ log: SmsExchange[]; optOut: Set<string> }>("sms", SMS_VERSION, (v) => {
        const x = v as { log?: unknown; optOut?: unknown };
        return Array.isArray(x.log) && x.optOut instanceof Set;
      });
export const smsLog = (g.__agriSmsLog ??= savedSms?.log ?? []);
const optOut = (g.__agriSmsOptOut ??= savedSms?.optOut ?? new Set());
track("sms", SMS_VERSION, () => (g.__agriSmsLog || g.__agriSmsOptOut ? { log: g.__agriSmsLog ?? [], optOut: g.__agriSmsOptOut ?? new Set() } : undefined));

export function findFarmerByPhone(phone: string) {
  const s = getStore();
  const p = normalizePhone(phone);
  if (!p) return null;
  // Exact match first, then tolerant match (national vs international formats)
  const user = s.users.find((u) => u.phone && normalizePhone(u.phone) === p) ?? s.users.find((u) => phonesMatch(u.phone, phone));
  if (!user) return null;
  const farmer = s.farmers.find((f) => f.userId === user.id) ?? null;
  return { user, farmer };
}

async function localize(text: string, lang: SupportedLanguage): Promise<{ text: string; provider: string }> {
  if (lang === "en") return { text, provider: "none" };
  const r = await translate(text, lang);
  return r;
}

export async function handleInboundSms(fromRaw: string, body: string): Promise<SmsExchange> {
  const t0 = Date.now();
  const s = getStore();
  const from = normalizePhone(fromRaw);
  const parsed = parseSms(body);
  const found = findFarmerByPhone(from);
  const user = found?.user ?? null;
  const farmer = found?.farmer ?? null;

  let lang: SupportedLanguage = parsed.detectedLang ?? user?.language ?? languageForPhone(from);
  let english = "";
  let fixed: string | null = null; // already-localised text (skip MT)

  if (!user && parsed.command !== "HELP") {
    english = `AGRI-SHIELD: this number is not registered. Sign up free at ${process.env.NEXT_PUBLIC_APP_URL ?? "agrishield.io"}/auth/signup or ask your field officer. Reply HELP for commands.`;
  } else {
    const district = farmer ? s.districts.find((d) => d.id === farmer.districtId) : undefined;
    const fields = farmer ? s.fields.filter((f) => f.farmerId === farmer.id) : [];
    const compact = needsCompact(lang);
    switch (parsed.command) {
      case "STATUS":
        english = district
          ? buildStatusReply(
              {
                farmerName: user?.name ?? "",
                district: district.name,
                fields: fields.map((f) => ({ name: f.name, crop: f.cropType, floodRisk: f.floodRisk, salinityRisk: f.salinityRisk, soilEc: f.soilEc })),
                floodProb72h: district.floodProb72h,
                rainfall72hMm: district.rainfall72hMm,
                ecCurrent: district.ecCurrent,
                riskLevel: district.riskLevel,
              },
              compact
            )
          : "No farm registered yet. Complete onboarding in the app.";
        break;
      case "ALERT": {
        const now = Date.now();
        const active = district ? s.alerts.filter((a) => a.districtId === district.id && a.isActive && a.validUntil.getTime() > now) : [];
        english = buildAlertReply(
          district?.name ?? "your area",
          active.map((a) => ({ severity: a.severity, alertType: a.alertType, title: a.title, validUntil: a.validUntil, firstAction: a.recommendedActions[0] })),
          compact
        );
        break;
      }
      case "ADVICE": {
        const ids = new Set(fields.map((f) => f.id));
        const now = Date.now();
        const recs = s.recommendations.filter((r) => ids.has(r.fieldId) && r.expiresAt.getTime() > now);
        english = buildAdviceReply(recs, compact);
        break;
      }
      case "LANG":
        if (parsed.langArg && user) {
          const prev = user.language;
          user.language = parsed.langArg;
          lang = parsed.langArg;
          audit({ userId: user.id, userName: user.name, action: "user.language", entity: "user", entityId: user.id, details: `SMS LANG ${prev} → ${lang}` });
          english = "Language updated. Reply HELP for commands.";
        } else english = "Usage: LANG en | bn | hi | vi | fil | id | ta | si";
        break;
      case "STOP":
        optOut.add(from);
        english = "You will no longer receive SMS alerts. Reply START to re-subscribe. In-app alerts continue.";
        break;
      case "START":
        optOut.delete(from);
        english = "SMS alerts re-enabled. Reply HELP for commands.";
        break;
      case "HELP":
        fixed = HELP_TEXT[lang] ?? null;
        english = HELP_TEXT.en!;
        break;
      default:
        english = `Sorry, "${parsed.raw.slice(0, 20)}" is not a command. ${HELP_TEXT.en}`;
    }
  }

  let reply = fixed ?? english;
  let translatedBy = fixed ? "curated" : "none";
  if (!fixed && lang !== "en") {
    const tr = await localize(english, lang);
    reply = tr.text;
    translatedBy = tr.provider;
  }
  reply = fitSegments(reply, 2);
  const seg = smsSegments(reply);

  const ex: SmsExchange = {
    id: `sms_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    at: new Date(),
    from,
    fromMasked: maskPhone(from),
    farmerId: farmer?.id ?? null,
    farmerName: user?.name ?? null,
    body: parsed.raw,
    command: parsed.command,
    language: lang,
    reply,
    segments: seg.segments,
    encoding: seg.encoding,
    translatedBy,
    latencyMs: Date.now() - t0,
  };
  smsLog.unshift(ex);
  if (smsLog.length > 500) smsLog.length = 500;
  publish("global", { type: "sms.inbound", from: ex.fromMasked, command: ex.command });
  return ex;
}

export function isOptedOut(phone: string) {
  return optOut.has(normalizePhone(phone));
}

/**
 * Twilio request validation: base64(HMAC-SHA1(authToken, url + Σ sorted(key+value))).
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Public URL Twilio called (proxy-aware; override with TWILIO_WEBHOOK_URL). */
export function publicUrl(req: Request): string {
  if (process.env.TWILIO_WEBHOOK_URL) return process.env.TWILIO_WEBHOOK_URL;
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  return `${proto}://${host}${u.pathname}${u.search}`;
}
