/**
 * i18n configuration shared by server and client (spec §9).
 * Static UI strings live in packages/i18n/locales/<code>.json; dynamic
 * content (alerts, AI answers) is translated server-side via DeepL/MyMemory.
 */
import type { SupportedLanguage } from "@agri-shield/types";
import en from "../../../../packages/i18n/locales/en.json";

export type Locale = SupportedLanguage;
export type Messages = typeof en;

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "agri_lang";
export const LOCALE_STORAGE_KEY = "agri_lang";

export interface LocaleMeta {
  code: Locale;
  name: string;
  nativeName: string;
  /** BCP-47 tag used for Intl formatting */
  intl: string;
  /** Web Speech API recognition language */
  speech: string;
  region: string;
  rtl: boolean;
}

export const LOCALES: LocaleMeta[] = [
  { code: "en", name: "English", nativeName: "English", intl: "en-GB", speech: "en-IN", region: "Global", rtl: false },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", intl: "hi-IN", speech: "hi-IN", region: "India", rtl: false },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", intl: "bn-BD", speech: "bn-BD", region: "Bangladesh · West Bengal", rtl: false },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", intl: "vi-VN", speech: "vi-VN", region: "Vietnam", rtl: false },
  { code: "fil", name: "Filipino", nativeName: "Filipino", intl: "fil-PH", speech: "fil-PH", region: "Philippines", rtl: false },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", intl: "id-ID", speech: "id-ID", region: "Indonesia", rtl: false },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", intl: "ta-IN", speech: "ta-IN", region: "Tamil Nadu · Sri Lanka", rtl: false },
  { code: "si", name: "Sinhala", nativeName: "සිංහල", intl: "si-LK", speech: "si-LK", region: "Sri Lanka", rtl: false },
];

export const LOCALE_CODES = LOCALES.map((l) => l.code);

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALE_CODES as string[]).includes(v);

export const localeMeta = (code: Locale): LocaleMeta => LOCALES.find((l) => l.code === code) ?? LOCALES[0]!;

/** Pick the best supported locale from an Accept-Language header / navigator.languages list. */
export function matchLocale(prefs: readonly string[] | string | null | undefined): Locale | null {
  if (!prefs) return null;
  const list = typeof prefs === "string" ? prefs.split(",").map((p) => p.split(";")[0]!.trim()) : prefs;
  for (const raw of list) {
    const tag = raw.toLowerCase();
    const base = tag.split("-")[0]!;
    if (tag === "tl" || base === "tl") return "fil";
    if (base === "in") return "id"; // legacy Indonesian tag
    if (isLocale(base)) return base;
  }
  return null;
}

export const ENGLISH_MESSAGES: Messages = en;

/** Lazy-load a locale bundle (code-split per language). */
export async function loadMessages(locale: Locale): Promise<Messages> {
  if (locale === "en") return en;
  try {
    const mod = (await import(`../../../../packages/i18n/locales/${locale}.json`)) as { default: Messages };
    return mod.default ?? (mod as unknown as Messages);
  } catch {
    return en;
  }
}

// ─── Currency by country (₹ ৳ ₫ ₱ Rp) ──────────────────────────────────────

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  IN: "INR",
  India: "INR",
  BD: "BDT",
  Bangladesh: "BDT",
  VN: "VND",
  Vietnam: "VND",
  PH: "PHP",
  Philippines: "PHP",
  ID: "IDR",
  Indonesia: "IDR",
  LK: "LKR",
  "Sri Lanka": "LKR",
};

export function currencyForCountry(country: string | null | undefined): string {
  return (country && CURRENCY_BY_COUNTRY[country]) || "USD";
}
