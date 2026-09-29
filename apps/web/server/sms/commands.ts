/**
 * SMS bot for feature phones (spec §7 "SMS Fallback") — pure, testable logic.
 *
 * Commands (case/diacritic-insensitive, first word wins):
 *   STATUS | 1   current risk for the farmer's registered fields
 *   ALERT  | 2   active alerts in the farmer's district
 *   ADVICE | 3   top 3 recommendations
 *   HELP   | 0   list of commands
 *   LANG <code|name>   switch reply language (en, bn, hi, vi, fil, id, ta, si)
 *   STOP / START       opt out / in of SMS alerts
 * Local-language keywords are accepted for every command (বাংলা, हिन्दी, Tiếng Việt,
 * Filipino, Bahasa Indonesia, தமிழ், සිංහල) and also set the reply language.
 */
import type { SupportedLanguage } from "@agri-shield/types";

export type SmsCommand = "STATUS" | "ALERT" | "ADVICE" | "HELP" | "LANG" | "STOP" | "START" | "UNKNOWN";

export interface ParsedSms {
  command: SmsCommand;
  /** language implied by a local-language keyword */
  detectedLang: SupportedLanguage | null;
  /** LANG target (validated) */
  langArg: SupportedLanguage | null;
  raw: string;
}

export const SMS_LANGS: SupportedLanguage[] = ["en", "bn", "hi", "vi", "fil", "id", "ta", "si"];

/** Strip Latin diacritics + upper-case; leaves non-Latin scripts intact. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

type Keyword = [SmsCommand, SupportedLanguage | null];

/** Keyword → command (+ language). Keys are normalizeText()'d. */
const KEYWORDS: Record<string, Keyword> = {
  // English + numeric shortcuts
  STATUS: ["STATUS", null], RISK: ["STATUS", null], "1": ["STATUS", null],
  ALERT: ["ALERT", null], ALERTS: ["ALERT", null], "2": ["ALERT", null],
  ADVICE: ["ADVICE", null], TIPS: ["ADVICE", null], "3": ["ADVICE", null],
  HELP: ["HELP", null], MENU: ["HELP", null], "0": ["HELP", null], "?": ["HELP", null],
  LANG: ["LANG", null], LANGUAGE: ["LANG", null],
  STOP: ["STOP", null], UNSUBSCRIBE: ["STOP", null], START: ["START", null], SUBSCRIBE: ["START", null],
  // Bengali
  "অবস্থা": ["STATUS", "bn"], "ঝুঁকি": ["STATUS", "bn"], "সতর্কতা": ["ALERT", "bn"], "পরামর্শ": ["ADVICE", "bn"], "সাহায্য": ["HELP", "bn"], "ভাষা": ["LANG", "bn"],
  // Hindi
  "स्थिति": ["STATUS", "hi"], "जोखिम": ["STATUS", "hi"], "चेतावनी": ["ALERT", "hi"], "सलाह": ["ADVICE", "hi"], "मदद": ["HELP", "hi"], "सहायता": ["HELP", "hi"], "भाषा": ["LANG", "hi"],
  // Vietnamese (diacritics stripped)
  "TRANG THAI": ["STATUS", "vi"], "RUI RO": ["STATUS", "vi"], "CANH BAO": ["ALERT", "vi"], "TU VAN": ["ADVICE", "vi"], "LOI KHUYEN": ["ADVICE", "vi"], "GIUP": ["HELP", "vi"], "TRO GIUP": ["HELP", "vi"], "NGON NGU": ["LANG", "vi"],
  // Filipino
  KALAGAYAN: ["STATUS", "fil"], PANGANIB: ["STATUS", "fil"], BABALA: ["ALERT", "fil"], PAYO: ["ADVICE", "fil"], TULONG: ["HELP", "fil"], WIKA: ["LANG", "fil"],
  // Bahasa Indonesia
  RISIKO: ["STATUS", "id"], PERINGATAN: ["ALERT", "id"], SARAN: ["ADVICE", "id"], BANTUAN: ["HELP", "id"], BAHASA: ["LANG", "id"],
  // Tamil
  "நிலை": ["STATUS", "ta"], "எச்சரிக்கை": ["ALERT", "ta"], "ஆலோசனை": ["ADVICE", "ta"], "உதவி": ["HELP", "ta"], "மொழி": ["LANG", "ta"],
  // Sinhala
  "තත්ත්වය": ["STATUS", "si"], "අනතුරු": ["ALERT", "si"], "උපදෙස්": ["ADVICE", "si"], "උදව්": ["HELP", "si"], "භාෂාව": ["LANG", "si"],
};

const LANG_NAMES_RAW: Record<string, SupportedLanguage> = {
  EN: "en", ENGLISH: "en",
  BN: "bn", BENGALI: "bn", BANGLA: "bn", "বাংলা": "bn",
  HI: "hi", HINDI: "hi", "हिन्दी": "hi", "हिंदी": "hi",
  VI: "vi", VIETNAMESE: "vi", "TIENG VIET": "vi",
  FIL: "fil", TL: "fil", FILIPINO: "fil", TAGALOG: "fil",
  ID: "id", INDONESIAN: "id", INDONESIA: "id", "BAHASA INDONESIA": "id",
  TA: "ta", TAMIL: "ta", "தமிழ்": "ta",
  SI: "si", SINHALA: "si", "සිංහල": "si",
};

// Keys normalised once (NFD can decompose Indic vowel signs, so raw keys may not match input).
const norm = <T,>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [normalizeText(k), v]));
const KW = norm(KEYWORDS);
const LANG_NAMES = norm(LANG_NAMES_RAW);

export function parseLanguage(arg: string | undefined | null): SupportedLanguage | null {
  if (!arg) return null;
  const n = normalizeText(arg);
  return LANG_NAMES[n] ?? LANG_NAMES[n.split(" ")[0]!] ?? null;
}

export function parseSms(body: string): ParsedSms {
  const raw = (body ?? "").slice(0, 480);
  const n = normalizeText(raw.replace(/[.!,;:#*]+/g, " "));
  if (!n) return { command: "HELP", detectedLang: null, langArg: null, raw };
  const words = n.split(" ");
  // try two-word keywords first (e.g. "TRANG THAI", "CANH BAO")
  const two = words.slice(0, 2).join(" ");
  const hit: Keyword | undefined = KW[two] ?? KW[words[0]!];
  const consumed = KW[two] ? 2 : 1;
  if (!hit) return { command: "UNKNOWN", detectedLang: null, langArg: null, raw };
  const [command, detectedLang] = hit;
  const langArg = command === "LANG" ? parseLanguage(words.slice(consumed).join(" ")) : null;
  return { command, detectedLang, langArg, raw };
}

/** E.164-ish normalisation: strips "whatsapp:", spaces, dashes, brackets; keeps leading +. */
export function normalizePhone(p: string | null | undefined): string {
  if (!p) return "";
  let s = p.replace(/^whatsapp:/i, "").replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+") && /^\d{8,15}$/.test(s)) s = `+${s}`;
  return s;
}

/** Guess a reply language from the calling code when the number isn't registered. */
export function languageForPhone(phone: string): SupportedLanguage {
  const p = normalizePhone(phone);
  if (p.startsWith("+880")) return "bn";
  if (p.startsWith("+84")) return "vi";
  if (p.startsWith("+63")) return "fil";
  if (p.startsWith("+62")) return "id";
  if (p.startsWith("+94")) return "si";
  if (p.startsWith("+91")) return "hi";
  return "en";
}

/** Masks a phone for logs/realtime: +8801711****00 */
export function maskPhone(p: string): string {
  const s = normalizePhone(p);
  return s.length > 6 ? `${s.slice(0, s.length - 6)}****${s.slice(-2)}` : "****";
}

// ─── SMS segment maths (GSM-7 vs UCS-2) ───────────────────────────────────

const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

export function isGsm7(text: string): boolean {
  for (const ch of text) if (!GSM7.includes(ch) && !GSM7_EXT.includes(ch)) return false;
  return true;
}

/** Number of septets/code units as the carrier counts them. */
function smsLength(text: string, gsm: boolean): number {
  if (!gsm) return text.length; // UTF-16 code units
  let n = 0;
  for (const ch of text) n += GSM7_EXT.includes(ch) ? 2 : 1;
  return n;
}

export function smsSegments(text: string): { encoding: "GSM-7" | "UCS-2"; length: number; segments: number } {
  const gsm = isGsm7(text);
  const length = smsLength(text, gsm);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return { encoding: gsm ? "GSM-7" : "UCS-2", length, segments: length <= single ? 1 : Math.ceil(length / multi) };
}

/** Trim to at most `maxSegments` SMS segments, ending with an ellipsis if cut. */
export function fitSegments(text: string, maxSegments = 2): string {
  const clean = text.replace(/[ \t]+/g, " ").trim();
  const gsm = isGsm7(clean);
  const budget = maxSegments === 1 ? (gsm ? 160 : 70) : (gsm ? 153 : 67) * maxSegments;
  if (smsLength(clean, gsm) <= budget) return clean;
  const ell = gsm ? "..." : "…";
  let out = "";
  for (const ch of clean) {
    if (smsLength(out + ch, gsm) > budget - smsLength(ell, gsm)) break;
    out += ch;
  }
  return out.replace(/\s+\S*$/, "") + ell;
}

// ─── Reply builders (English source text; translated by the handler) ─────

export interface StatusContext {
  farmerName: string;
  district: string;
  fields: { name: string; crop: string; floodRisk: number; salinityRisk: number; soilEc: number }[];
  floodProb72h: number;
  rainfall72hMm: number;
  ecCurrent: number;
  riskLevel: string;
}

const lvl = (score: number) => (score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW");

export function buildStatusReply(c: StatusContext, compact = false): string {
  const worst = [...c.fields].sort((a, b) => Math.max(b.floodRisk, b.salinityRisk) - Math.max(a.floodRisk, a.salinityRisk))[0];
  const flood = Math.round(c.floodProb72h * 100);
  if (compact)
    return `${c.district}: flood risk ${flood}% (72h), rain ${Math.round(c.rainfall72hMm)}mm, salt EC ${c.ecCurrent}. Level ${c.riskLevel.toUpperCase()}.`;
  return (
    `AGRI-SHIELD ${c.district}: ${c.riskLevel.toUpperCase()} risk. Flood 72h ${flood}%, rain ${Math.round(c.rainfall72hMm)}mm, soil EC ${c.ecCurrent} dS/m.` +
    (worst ? ` Most exposed: ${worst.name} (${worst.crop}) flood ${worst.floodRisk}% ${lvl(worst.floodRisk)}.` : "") +
    ` Reply ALERT or ADVICE.`
  );
}

export interface AlertLine {
  severity: string;
  alertType: string;
  title: string;
  validUntil: Date;
  firstAction?: string;
}

export function buildAlertReply(district: string, alerts: AlertLine[], compact = false): string {
  if (!alerts.length) return compact ? `No active alerts for ${district}.` : `AGRI-SHIELD: No active alerts for ${district}. We will SMS you if risk rises. Reply STATUS for current risk.`;
  const sorted = [...alerts].sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
  if (compact) {
    const a = sorted[0]!;
    return `${a.severity.toUpperCase()} ${a.alertType}: ${a.firstAction ?? a.title}`;
  }
  const lines = sorted.slice(0, 2).map((a) => `${a.severity.toUpperCase()} ${a.alertType} until ${a.validUntil.toISOString().slice(5, 16).replace("T", " ")}Z${a.firstAction ? ` - ${a.firstAction}` : ""}`);
  return `AGRI-SHIELD ${alerts.length} alert(s): ${lines.join(" | ")}`;
}

const sevRank = (s: string) => ({ emergency: 2, warning: 1, watch: 0 })[s as "watch"] ?? 0;

export function buildAdviceReply(recs: { title: string; priority: string }[], compact = false): string {
  if (!recs.length) return "No new advice. Your fields look stable. Reply STATUS any time.";
  const order = { urgent: 3, high: 2, medium: 1, low: 0 } as Record<string, number>;
  const top = [...recs].sort((a, b) => (order[b.priority] ?? 0) - (order[a.priority] ?? 0)).slice(0, compact ? 2 : 3);
  return top.map((r, i) => `${i + 1}) ${r.title.replace(/\s+—\s+/g, ": ")}`).join(compact ? " " : "\n");
}

/** Hand-written HELP menus (no machine translation for the most-used message). */
export const HELP_TEXT: Partial<Record<SupportedLanguage, string>> = {
  en: "AGRI-SHIELD SMS: STATUS (1) farm risk, ALERT (2) active alerts, ADVICE (3) top actions, LANG bn/hi/vi/fil/id/ta/si to change language, STOP to opt out.",
  bn: "এগ্রি-শিল্ড: অবস্থা(1) ঝুঁকি, সতর্কতা(2), পরামর্শ(3), ভাষা বদলাতে LANG en",
  hi: "एग्री-शील्ड: स्थिति(1) जोखिम, चेतावनी(2), सलाह(3), भाषा बदलें: LANG en",
  vi: "AGRI-SHIELD: TRANG THAI (1) rủi ro, CANH BAO (2), TU VAN (3), đổi ngôn ngữ: LANG en",
  fil: "AGRI-SHIELD SMS: KALAGAYAN (1) panganib, BABALA (2) mga alerto, PAYO (3) mga gagawin, LANG en para magpalit ng wika, STOP para huminto.",
  id: "AGRI-SHIELD SMS: STATUS (1) risiko lahan, PERINGATAN (2) peringatan aktif, SARAN (3) tindakan utama, LANG en ganti bahasa, STOP berhenti.",
};

/** Non-Latin / diacritic languages go through UCS-2 (70 chars/segment) → use compact source text. */
export const needsCompact = (lang: SupportedLanguage) => !["en", "fil", "id"].includes(lang);

export function twiml(message: string): string {
  const esc = message.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc}</Message></Response>`;
}
